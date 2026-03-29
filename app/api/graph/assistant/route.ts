import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/api/auth";
import { rateLimit } from "@/lib/api/rate-limit";
import { handleApiError } from "@/lib/api/errors";
import {
  validateApiKey,
  validateMessage,
  validateRepoFullName,
} from "@/lib/api/validate";
import {
  answerRepoQuestion,
  retrieveRepoContext,
} from "@/lib/api/repo-intelligence";
import {
  deriveArchitectureActions,
} from "@/lib/api/architecture-actions";
import {
  type ArchitectureLayerId,
  toArchitectureBundle,
} from "@/types/architecture";

/**
 * POST /api/graph/assistant - Architecture-aware assistant for the graph page.
 */
export async function POST(request: Request) {
  try {
    const { user, supabase } = await getAuthenticatedUser();

    const rl = rateLimit(user.id, "chat");
    if (!rl.ok) {
      return NextResponse.json(
        { error: { code: "RATE_LIMITED", message: "Too many assistant requests" } },
        { status: 429 }
      );
    }

    const body = await request.json();
    const message = validateMessage(body.message);
    const repoFullName = validateRepoFullName(body.repo_full_name);
    const defaultLayer = (body.layer || "system") as ArchitectureLayerId;
    const apiKey = validateApiKey(request);

    const context = await retrieveRepoContext({
      supabase,
      userId: user.id,
      repoFullName,
      query: message,
      apiKey,
      includeTimeline: true,
      matchCount: 16,
    });

    const { data: repoData } = await supabase
      .from("repos")
      .select("architecture_analysis, architecture_for_sha, architecture_analyzed_at, last_synced_sha")
      .eq("user_id", user.id)
      .eq("full_name", repoFullName)
      .single();

    const bundle = toArchitectureBundle(repoData?.architecture_analysis || null);

    const answer = await answerRepoQuestion({
      apiKey,
      repoFullName: context.repoLabel,
      question: message,
      fileManifest: context.fileManifest,
      contextBlocks: context.contextBlocks,
      timelineBlocks: context.timelineBlocks,
      extraInstructions:
        "When possible, mention the architectural component names that best explain the flow.",
    });

    const actions = deriveArchitectureActions({
      bundle,
      defaultLayer,
      query: message,
      citationFiles: context.dedupedCitations.map((citation) => citation.file_path),
    });

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
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

        for (const action of actions) {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ type: "action", action })}\n\n`)
          );
        }

        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ type: "text", content: answer })}\n\n`
          )
        );
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ type: "done" })}\n\n`)
        );
        controller.close();
      },
    });

    return new NextResponse(stream, {
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
