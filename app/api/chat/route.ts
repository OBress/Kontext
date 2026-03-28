import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/api/auth";
import { rateLimit } from "@/lib/api/rate-limit";
import { handleApiError } from "@/lib/api/errors";
import {
  validateRepoFullName,
  validateMessage,
  validateApiKey,
} from "@/lib/api/validate";
import {
  generateChatStream,
  generateQueryEmbedding,
} from "@/lib/api/embeddings";
import { logActivity } from "@/lib/api/activity";
import {
  buildGitHubBlobUrl,
  detectCodeLanguage,
  stripChunkFileHeader,
} from "@/lib/code";

type ChatAnswerMode = "grounded" | "partial" | "insufficient_evidence";

interface MatchChunk {
  id: number;
  file_path: string;
  content: string;
  similarity: number;
}

interface TimelineMatch {
  id: number;
  sha: string;
  message: string;
  ai_summary: string;
  author_name: string;
  author_avatar_url: string | null;
  committed_at: string;
  push_group_id: string | null;
  files_changed: unknown;
  similarity: number;
}

interface ChunkMetadata {
  startLine?: number;
  endLine?: number;
}

interface ChunkDetails {
  id: number;
  file_path: string;
  content: string;
  metadata: ChunkMetadata | null;
}

function parseChunkMetadata(metadata: unknown): ChunkMetadata {
  if (!metadata || typeof metadata !== "object") return {};

  const record = metadata as Record<string, unknown>;
  return {
    startLine:
      typeof record.startLine === "number" ? record.startLine : undefined,
    endLine: typeof record.endLine === "number" ? record.endLine : undefined,
  };
}

function classifyAnswerMode(
  citations: Array<{ retrieval_score: number }>
): ChatAnswerMode {
  if (citations.length === 0) return "insufficient_evidence";

  const strongestMatch = Math.max(
    ...citations.map((citation) => citation.retrieval_score)
  );

  return strongestMatch >= 0.78 ? "grounded" : "partial";
}

/**
 * POST /api/chat - RAG chatbot with streaming Gemini response
 */
export async function POST(request: Request) {
  try {
    const { user, supabase } = await getAuthenticatedUser();

    const rl = rateLimit(user.id, "chat");
    if (!rl.ok) {
      return NextResponse.json(
        { error: { code: "RATE_LIMITED", message: "Too many chat requests" } },
        { status: 429 }
      );
    }

    const body = await request.json();
    const message = validateMessage(body.message);
    const repoFullName = validateRepoFullName(body.repo_full_name);
    const apiKey = validateApiKey(request);

    logActivity({
      userId: user.id,
      repoFullName,
      source: "kontext",
      eventType: "chat_session",
      title: `Chat with ${repoFullName}`,
      description: message.slice(0, 100),
    });

    const { data: repo } = await supabase
      .from("repos")
      .select("last_synced_sha, last_indexed_at")
      .eq("user_id", user.id)
      .eq("full_name", repoFullName)
      .single();

    const queryEmbedding = await generateQueryEmbedding(apiKey, message);

    const { data: chunks, error } = await supabase.rpc("match_chunks", {
      query_embedding: JSON.stringify(queryEmbedding),
      match_count: 6,
      filter_repo: repoFullName,
      filter_user_id: user.id,
    });

    if (error) {
      console.error("match_chunks error:", error);
    }

    // Timeline vector search — find relevant development events
    const { data: timelineChunks, error: timelineError } = await supabase.rpc(
      "match_timeline",
      {
        query_embedding: JSON.stringify(queryEmbedding),
        match_count: 3,
        filter_repo: repoFullName,
        filter_user_id: user.id,
      }
    );

    if (timelineError) {
      console.error("match_timeline error:", timelineError);
    }

    const timelineMatches = (timelineChunks || []) as TimelineMatch[];

    const matches = (chunks || []) as MatchChunk[];
    const chunkIds = matches.map((chunk) => chunk.id);

    let chunkDetailsById = new Map<number, ChunkDetails>();
    if (chunkIds.length > 0) {
      const { data: chunkDetails } = await supabase
        .from("repo_chunks")
        .select("id, file_path, content, metadata")
        .in("id", chunkIds);

      chunkDetailsById = new Map(
        ((chunkDetails || []) as ChunkDetails[]).map((detail) => [
          detail.id,
          detail,
        ])
      );
    }

    const citations = matches.map((match, index) => {
      const details = chunkDetailsById.get(match.id);
      const metadata = parseChunkMetadata(details?.metadata);
      const snippet = stripChunkFileHeader(details?.content || match.content);
      const lineStart = metadata.startLine ?? 1;
      const lineEnd =
        metadata.endLine ??
        lineStart + Math.max(snippet.split("\n").length - 1, 0);
      const commitSha = repo?.last_synced_sha || null;

      return {
        citation_id: `${match.id}-${index}`,
        index_version_id: commitSha || repo?.last_indexed_at || null,
        commit_sha: commitSha,
        file_path: match.file_path,
        line_start: lineStart,
        line_end: lineEnd,
        language: detectCodeLanguage(match.file_path),
        snippet,
        retrieval_score: match.similarity,
        github_url: buildGitHubBlobUrl(
          repoFullName,
          commitSha,
          match.file_path,
          lineStart,
          lineEnd
        ),
      };
    });

    const answerMode = classifyAnswerMode(citations);

    const contextBlocks = citations
      .map(
        (citation, index) =>
          `--- Citation ${index + 1}: ${citation.file_path}:${
            citation.line_start
          }-${citation.line_end} (retrieval score: ${(
            citation.retrieval_score * 100
          ).toFixed(1)}%) ---\n${citation.snippet}\n`
      )
      .join("\n");

    // Build timeline context blocks
    const timelineCitations = timelineMatches
      .filter((t) => t.similarity >= 0.5)
      .map((t) => ({
        sha: t.sha,
        date: new Date(t.committed_at).toISOString().split("T")[0],
        committed_at: t.committed_at,
        ai_summary: t.ai_summary,
        message: t.message,
        author: t.author_name,
        author_avatar_url: t.author_avatar_url,
        push_group_id: t.push_group_id,
        similarity: t.similarity,
      }));

    const timelineBlocks = timelineCitations
      .map(
        (t, index) =>
          `--- Timeline Entry ${index + 1}: ${t.date} (commit ${t.sha.slice(0, 7)} by ${t.author}, relevance: ${(t.similarity * 100).toFixed(1)}%) ---\n${t.ai_summary}\nRaw commit message: ${t.message.split("\n")[0]}\n`
      )
      .join("\n");

    const systemPrompt = `You are Kontext, an AI assistant that helps developers understand their codebase. You are analyzing the repository "${repoFullName}".

Answer the user's question using only the retrieved repository evidence below.

Grounding rules:
- Do not claim repository facts unless they are supported by the retrieved citations.
- Reference file paths and line ranges when relevant.
- When answering questions about WHEN something was implemented or changed, use the Development Timeline Context to provide specific dates and commits.
- If the evidence is incomplete, clearly say the answer is partial.
- If there is not enough repository evidence, say "Insufficient evidence from the indexed repository" and suggest what files or symbols to inspect next.

## Retrieved Code Context

${
  contextBlocks ||
  "No retrieved repository code context was found."
}${
  timelineBlocks
    ? `\n\n## Development Timeline Context\n\nThe following development events matched the user's query:\n\n${timelineBlocks}`
    : ""
}`;

    const encoder = new TextEncoder();
    const combinedStream = new ReadableStream({
      async start(controller) {
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({
              type: "context",
              citations,
              timelineCitations,
              answerMode,
            })}\n\n`
          )
        );

        if (citations.length === 0) {
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({
                type: "text",
                content:
                  "Insufficient evidence from the indexed repository to answer that confidently. Try rephrasing the question or inspect the files that likely define the relevant behavior.",
              })}\n\n`
            )
          );
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ type: "done" })}\n\n`)
          );
          controller.close();
          return;
        }

        try {
          const aiStream = await generateChatStream(apiKey, systemPrompt, message);
          const reader = aiStream.getReader();

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            controller.enqueue(value);
          }
        } catch (err: unknown) {
          const errorMessage =
            err instanceof Error ? err.message : "Unknown error";
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({
                type: "error",
                message: errorMessage,
              })}\n\n`
            )
          );
        }

        controller.close();
      },
    });

    return new NextResponse(combinedStream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
