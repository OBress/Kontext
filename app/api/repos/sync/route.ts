import { NextResponse } from "next/server";
import { createAdminClient, getAuthenticatedUser } from "@/lib/api/auth";
import { resolveAiKey } from "@/lib/api/ai-key";
import { ApiError, handleApiError } from "@/lib/api/errors";
import { resolveRepoGitHubToken } from "@/lib/api/repo-auth";
import { validateApiKey, validateRepoFullName } from "@/lib/api/validate";
import { isRepoSyncing } from "@/lib/api/sync-queue";
import { runSyncPipeline } from "@/lib/api/sync-pipeline";

/**
 * POST /api/repos/sync - Incremental sync pipeline with SSE progress.
 *
 * Uses the extracted pipeline from sync-pipeline.ts and checks the
 * sync queue for per-repo mutual exclusion before starting.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const fullName = validateRepoFullName(body.repo_full_name);
    const isWebhookTriggered = body.webhook_triggered === true;
    const adminDb = await createAdminClient();

    let userId: string;
    let apiKey: string | null = null;
    let fallbackGitHubToken: string | null = null;

    if (isWebhookTriggered) {
      userId = body.user_id;
      if (!userId) {
        return NextResponse.json(
          { error: "user_id required for webhook sync" },
          { status: 400 }
        );
      }

      const { data: tokenRow } = await adminDb
        .from("user_tokens")
        .select("encrypted_token, token_iv, token_tag")
        .eq("user_id", userId)
        .single();

      if (tokenRow) {
        const { decryptToken } = await import("@/lib/api/crypto");
        fallbackGitHubToken = decryptToken({
          ciphertext: tokenRow.encrypted_token,
          iv: tokenRow.token_iv,
          tag: tokenRow.token_tag,
        });
      }

      apiKey = body.api_key || (await resolveAiKey(userId));
    } else {
      const auth = await getAuthenticatedUser();
      userId = auth.user.id;
      fallbackGitHubToken = auth.githubToken;
      apiKey = validateApiKey(request);
    }

    const { data: repo } = await adminDb
      .from("repos")
      .select(
        "id, indexed, last_synced_sha, watched_branch, default_branch, understanding_tier, pending_sync_head_sha, sync_blocked_reason"
      )
      .eq("user_id", userId)
      .eq("full_name", fullName)
      .single();

    if (!repo) {
      return NextResponse.json({ error: "Repo not found" }, { status: 404 });
    }

    if (!repo.indexed || !repo.last_synced_sha) {
      return NextResponse.json(
        {
          error:
            "Repo has not been fully ingested yet. Run full ingestion first.",
        },
        { status: 400 }
      );
    }

    // Queue gate: reject if this repo is already syncing for this user
    if (isRepoSyncing(userId, fullName)) {
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({
                status: "already_syncing",
                message:
                  "A sync is already in progress for this repository. It will pick up the latest changes automatically.",
              })}\n\n`
            )
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
    }

    const { token: effectiveToken } = await resolveRepoGitHubToken(
      adminDb,
      userId,
      fullName,
      fallbackGitHubToken
    );

    if (!effectiveToken) {
      throw new ApiError(
        401,
        "GITHUB_TOKEN_REQUIRED",
        "GitHub token not available. Please re-authenticate or provide an access token for this repository."
      );
    }

    const targetHeadSHA: string | null = body.head_sha || null;
    const encoder = new TextEncoder();

    const stream = new ReadableStream({
      async start(controller) {
        const send = (data: Record<string, unknown>) => {
          try {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify(data)}\n\n`)
            );
          } catch {
            // Controller might already be closed by the client.
          }
        };

        await runSyncPipeline({
          userId,
          repoFullName: fullName,
          apiKey,
          githubToken: effectiveToken,
          repo: {
            last_synced_sha: repo.last_synced_sha,
            watched_branch: repo.watched_branch,
            default_branch: repo.default_branch,
            understanding_tier: repo.understanding_tier,
            sync_blocked_reason: repo.sync_blocked_reason,
            pending_sync_head_sha: repo.pending_sync_head_sha,
          },
          targetHeadSHA,
          isWebhookTriggered,
          onProgress: send,
        });

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
