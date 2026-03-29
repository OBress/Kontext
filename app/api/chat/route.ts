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
  retrieveRepoContext,
  streamRepoAnswer,
} from "@/lib/api/repo-intelligence";

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

    const context = await retrieveRepoContext({
      supabase,
      userId: user.id,
      repoFullName,
      query: message,
      apiKey,
      includeTimeline: true,
      matchCount: 25,
    });

    const encoder = new TextEncoder();
    const combinedStream = new ReadableStream({
      async start(controller) {
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({
              type: "context",
              citations: context.dedupedCitations,
              timelineCitations: context.timelineCitations,
              answerMode: context.answerMode,
            })}\n\n`
          )
        );

        if (context.dedupedCitations.length === 0) {
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
          const aiStream = await streamRepoAnswer({
            apiKey,
            repoFullName,
            question: message,
            fileManifest: context.fileManifest,
            contextBlocks: context.contextBlocks,
            timelineBlocks: context.timelineBlocks,
          });

          const reader = aiStream.getReader();
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            controller.enqueue(value);
          }
        } catch (err: unknown) {
          const messageText =
            err instanceof Error ? err.message : "Unknown error";
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({
                type: "error",
                message: messageText,
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
