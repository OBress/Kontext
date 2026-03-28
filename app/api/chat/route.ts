import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/api/auth";
import { rateLimit } from "@/lib/api/rate-limit";
import { handleApiError } from "@/lib/api/errors";
import { validateRepoFullName, validateMessage, validateApiKey } from "@/lib/api/validate";
import { generateEmbeddings, generateChatStream } from "@/lib/api/embeddings";
import { logActivity } from "@/lib/api/activity";

/**
 * POST /api/chat — RAG chatbot with streaming Gemini response
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

    // Log chat session activity (fire-and-forget)
    logActivity({
      userId: user.id,
      repoFullName,
      source: "kontext",
      eventType: "chat_session",
      title: `Chat with ${repoFullName}`,
      description: message.slice(0, 100),
    });

    // 1. Embed the user's question
    const [queryEmbedding] = await generateEmbeddings(apiKey, [message]);

    // 2. Vector search using match_chunks RPC
    const { data: chunks, error } = await supabase.rpc("match_chunks", {
      query_embedding: JSON.stringify(queryEmbedding),
      match_count: 5,
      filter_repo: repoFullName,
      filter_user_id: user.id,
    });

    if (error) {
      console.error("match_chunks error:", error);
    }

    // 3. Build sources for frontend
    interface MatchChunk { file_path: string; content: string; similarity: number }
    const sources = (chunks || []).map((c: MatchChunk) => ({
      file_path: c.file_path,
      content: c.content,
      similarity: c.similarity,
    }));

    // 4. Build system prompt with context
    const contextBlocks = sources
      .map(
        (s: MatchChunk, i: number) =>
          `--- Source ${i + 1}: ${s.file_path} (similarity: ${(s.similarity * 100).toFixed(1)}%) ---\n${s.content}\n`
      )
      .join("\n");

    const systemPrompt = `You are Kontext, an AI assistant that helps developers understand their codebase. You are analyzing the repository "${repoFullName}".

Answer the user's question based on the following code context retrieved from the repository. Be specific, cite file paths, and include code snippets when relevant.

If the context doesn't contain enough information to answer the question, say so honestly and suggest what files might be relevant.

## Retrieved Code Context

${contextBlocks || "No relevant code chunks found. Answer based on general knowledge."}`;

    // 5. Stream response
    const encoder = new TextEncoder();

    // Create a wrapper stream that sends sources first, then Gemini stream
    const combinedStream = new ReadableStream({
      async start(controller) {
        // Send sources first
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ type: "sources", sources })}\n\n`
          )
        );

        // Stream Gemini response
        try {
          const aiStream = await generateChatStream(apiKey, systemPrompt, message);
          const reader = aiStream.getReader();

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            controller.enqueue(value);
          }
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : "Unknown error";
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ type: "error", message })}\n\n`
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
