import { TaskType } from "@google/generative-ai";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildGitHubBlobUrl,
  detectCodeLanguage,
  stripChunkFileHeader,
} from "@/lib/code";
import {
  generateChatStream,
  generateMultimodalChatStream,
  generateQueryEmbedding,
  generateText,
} from "./embeddings";
import {
  buildTaskSystemInstruction,
  formatEvidencePack,
  PROMPT_GENERATION_CONFIGS,
} from "./prompt-contract";

export type RepoAnswerMode = "grounded" | "partial" | "insufficient_evidence";

export interface RepoCitation {
  citation_id: string;
  index_version_id: string | null;
  commit_sha: string | null;
  file_path: string;
  line_start: number;
  line_end: number;
  language: string;
  snippet: string;
  retrieval_score: number;
  github_url: string | null;
}

export interface RepoTimelineCitation {
  sha: string;
  date: string;
  committed_at: string;
  ai_summary: string;
  message: string;
  author: string;
  author_avatar_url: string | null;
  push_group_id: string | null;
  similarity: number;
}

interface MatchChunk {
  id: number;
  file_path: string;
  content: string;
  similarity: number;
}

interface TimelineMatch {
  sha: string;
  message: string;
  ai_summary: string;
  author_name: string;
  author_avatar_url: string | null;
  committed_at: string;
  push_group_id: string | null;
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

interface RepoRow {
  last_synced_sha: string | null;
  last_indexed_at: string | null;
}

export interface RetrievedRepoContext {
  repo: RepoRow | null;
  repoLabel: string;
  citations: RepoCitation[];
  dedupedCitations: RepoCitation[];
  timelineCitations: RepoTimelineCitation[];
  answerMode: RepoAnswerMode;
  fileManifest: string;
  contextBlocks: string;
  timelineBlocks: string;
}

function parseChunkMetadata(metadata: unknown): ChunkMetadata {
  if (!metadata || typeof metadata !== "object") return {};

  const record = metadata as Record<string, unknown>;
  return {
    startLine:
      typeof record.startLine === "number" ? record.startLine : undefined,
    endLine:
      typeof record.endLine === "number" ? record.endLine : undefined,
  };
}

export function classifyAnswerMode(
  citations: Array<{ retrieval_score: number }>
): RepoAnswerMode {
  if (citations.length === 0) return "insufficient_evidence";

  const strongestMatch = Math.max(
    ...citations.map((citation) => citation.retrieval_score)
  );

  return strongestMatch >= 0.78 ? "grounded" : "partial";
}

export function buildFileManifest(
  filePaths: string[],
  matchedPaths: string[]
): string {
  if (filePaths.length <= 200) {
    return filePaths.join("\n");
  }

  const dirs = new Set<string>();
  for (const filePath of filePaths) {
    const parts = filePath.split("/");
    for (let index = 1; index < parts.length; index += 1) {
      dirs.add(parts.slice(0, index).join("/") + "/");
    }
  }

  return `Directory tree (${filePaths.length} files total):\n${[...dirs].sort().join("\n")}\n\nTop matched files:\n${[...new Set(matchedPaths)].sort().join("\n")}`;
}

export function dedupeCitationsByFile(citations: RepoCitation[]): RepoCitation[] {
  const fileMap = new Map<string, RepoCitation>();

  for (const citation of citations) {
    const existing = fileMap.get(citation.file_path);
    if (!existing || citation.retrieval_score > existing.retrieval_score) {
      fileMap.set(citation.file_path, {
        ...citation,
        snippet: "",
        line_start: 1,
        line_end: 1,
      });
    }
  }

  return [...fileMap.values()];
}

export async function retrieveRepoContext(params: {
  supabase: SupabaseClient;
  userId: string;
  repoFullName: string | null;
  query: string;
  apiKey: string;
  includeTimeline?: boolean;
  matchCount?: number;
}): Promise<RetrievedRepoContext> {
  const {
    supabase,
    userId,
    repoFullName,
    query,
    apiKey,
    includeTimeline = true,
    matchCount = 25,
  } = params;

  const repoQuery = supabase
    .from("repos")
    .select("last_synced_sha, last_indexed_at");

  const { data: repo } = repoFullName
    ? await repoQuery.eq("user_id", userId).eq("full_name", repoFullName).single()
    : { data: null };

  const queryEmbedding = await generateQueryEmbedding(
    apiKey,
    query,
    TaskType.RETRIEVAL_QUERY
  );

  const { data: chunks, error } = await supabase.rpc("hybrid_match_chunks", {
    query_text: query,
    query_embedding: JSON.stringify(queryEmbedding),
    match_count: matchCount,
    filter_repo: repoFullName,
    filter_user_id: userId,
  });

  if (error) {
    console.error("hybrid_match_chunks error:", error);
  }

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
      github_url: repoFullName
        ? buildGitHubBlobUrl(
            repoFullName,
            commitSha,
            match.file_path,
            lineStart,
            lineEnd
          )
        : null,
    };
  });

  const dedupedCitations = dedupeCitationsByFile(citations);

  const fileQuery = supabase
    .from("repo_files")
    .select("file_path")
    .eq("user_id", userId);

  const { data: repoFiles } = repoFullName
    ? await fileQuery.eq("repo_full_name", repoFullName).order("file_path")
    : await fileQuery.order("file_path");

  const allFilePaths = (repoFiles || []).map((entry: { file_path: string }) => entry.file_path);
  const fileManifest = buildFileManifest(
    allFilePaths,
    matches.map((entry) => entry.file_path)
  );

  let timelineCitations: RepoTimelineCitation[] = [];
  let timelineBlocks = "";

  if (includeTimeline) {
    const { data: timelineChunks, error: timelineError } = await supabase.rpc(
      "match_timeline",
      {
        query_embedding: JSON.stringify(queryEmbedding),
        match_count: 3,
        filter_repo: repoFullName,
        filter_user_id: userId,
      }
    );

    if (timelineError) {
      console.error("match_timeline error:", timelineError);
    }

    timelineCitations = ((timelineChunks || []) as TimelineMatch[])
      .filter((entry) => entry.similarity >= 0.5)
      .map((entry) => ({
        sha: entry.sha,
        date: new Date(entry.committed_at).toISOString().split("T")[0],
        committed_at: entry.committed_at,
        ai_summary: entry.ai_summary,
        message: entry.message,
        author: entry.author_name,
        author_avatar_url: entry.author_avatar_url,
        push_group_id: entry.push_group_id,
        similarity: entry.similarity,
      }));

    timelineBlocks = timelineCitations
      .map(
        (entry, index) =>
          `--- Timeline Entry ${index + 1}: ${entry.date} (commit ${entry.sha.slice(0, 7)} by ${entry.author}, relevance: ${(entry.similarity * 100).toFixed(1)}%) ---\n${entry.ai_summary}\nRaw commit message: ${entry.message.split("\n")[0]}\n`
      )
      .join("\n");
  }

  const contextBlocks = citations
    .map(
      (citation, index) =>
        `--- Citation ${index + 1}: ${citation.file_path}:${citation.line_start}-${citation.line_end} (retrieval score: ${(citation.retrieval_score * 100).toFixed(1)}%) ---\n${citation.snippet}\n`
    )
    .join("\n");

  return {
    repo,
    repoLabel: repoFullName || "all indexed repositories",
    citations,
    dedupedCitations,
    timelineCitations,
    answerMode: classifyAnswerMode(dedupedCitations),
    fileManifest,
    contextBlocks,
    timelineBlocks,
  };
}

export function buildRepoAnswerSystemPrompt(): string {
  return buildTaskSystemInstruction({
    task: "grounded_explainer",
    role: "Kontext, a grounded repository explainer",
    mission: "Answer repository questions using only the supplied evidence pack.",
    outputStyle: [
      "Be brief and direct. Use short paragraphs or bullets only when they add clarity.",
      "Wrap repository file paths in backticks exactly as they appear in the evidence pack.",
      "Do not emit Mermaid, JSON payloads, fenced visual blocks, or tool-call markup.",
      'If the evidence is not strong enough, say "Insufficient evidence" and suggest the next file or area to inspect.',
    ],
    taskRules: [
      "Use timeline evidence only when the question is about when or why something changed.",
      "When listing items such as files or endpoints, be thorough within the supplied evidence.",
      "Do not imply certainty beyond the retrieved context.",
    ],
  });
}

export function buildRepoAnswerPrompt(params: {
  repoFullName: string;
  fileManifest: string;
  contextBlocks: string;
  timelineBlocks?: string;
  extraInstructions?: string;
  question: string;
}): string {
  const {
    repoFullName,
    fileManifest,
    contextBlocks,
    timelineBlocks,
    extraInstructions,
    question,
  } = params;

  const evidencePack = formatEvidencePack({
    summary:
      "Use the retrieved repository evidence to answer the question. Prefer exact citations over inference.",
    facts: [
      { label: "Repository", value: repoFullName, confidence: "exact" },
      { label: "Question", value: question, confidence: "exact" },
    ],
    excerpts: [
      {
        title: "Repository file manifest",
        source: repoFullName,
        reason: "Use this to reason about likely locations when the retrieved snippets are partial.",
        content: fileManifest,
      },
      {
        title: "Retrieved code context",
        source: repoFullName,
        reason: "Primary evidence for the answer.",
        content:
          contextBlocks || "No retrieved repository code context was found.",
      },
      ...(timelineBlocks
        ? [
            {
              title: "Development timeline context",
              source: repoFullName,
              reason:
                "Use only when the question depends on when or why something changed.",
              content: timelineBlocks,
            },
          ]
        : []),
    ],
    coverageGaps: [
      contextBlocks
        ? ""
        : "No retrieved code snippet matched strongly. Be explicit about limited evidence.",
    ].filter(Boolean),
  });

  return [
    "Answer the repository question using the supplied evidence pack.",
    extraInstructions ? `Additional instruction: ${extraInstructions}` : "",
    "",
    evidencePack,
    "",
    "Answer requirements:",
    "- Start with the direct answer.",
    "- Keep the answer grounded in the evidence pack.",
    "- Mention relevant file paths in backticks when they support the answer.",
    "- Do not generate diagrams, charts, fenced JSON, or structured tool payloads.",
    "- If evidence is partial, say so briefly instead of guessing.",
  ]
    .filter(Boolean)
    .join("\n");
}

export async function answerRepoQuestion(params: {
  apiKey: string;
  repoFullName: string;
  question: string;
  fileManifest: string;
  contextBlocks: string;
  timelineBlocks?: string;
  extraInstructions?: string;
}): Promise<string> {
  return generateText(
    params.apiKey,
    buildRepoAnswerPrompt(params),
    {
      systemInstruction: buildRepoAnswerSystemPrompt(),
      generationConfig: PROMPT_GENERATION_CONFIGS.groundedAnswer,
    }
  );
}

export async function streamRepoAnswer(params: {
  apiKey: string;
  repoFullName: string;
  question: string;
  fileManifest: string;
  contextBlocks: string;
  timelineBlocks?: string;
  extraInstructions?: string;
  attachedFileBlocks?: string;
  imageParts?: Array<{ mimeType: string; data: string }>;
}): Promise<ReadableStream<Uint8Array>> {
  const promptText = buildRepoAnswerPrompt(params);
  const fullPrompt = params.attachedFileBlocks
    ? `${promptText}\n\n--- Explicitly attached file context (user-selected via @-mention) ---\n${params.attachedFileBlocks}`
    : promptText;

  const streamOptions = {
    systemInstruction: buildRepoAnswerSystemPrompt(),
    generationConfig: PROMPT_GENERATION_CONFIGS.groundedAnswer,
  };

  if (params.imageParts && params.imageParts.length > 0) {
    const parts = [
      { text: fullPrompt },
      ...params.imageParts.map((img) => ({
        inlineData: { mimeType: img.mimeType, data: img.data },
      })),
    ];
    return generateMultimodalChatStream(params.apiKey, parts, streamOptions);
  }

  return generateChatStream(params.apiKey, fullPrompt, streamOptions);
}
