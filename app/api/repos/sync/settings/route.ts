import { NextResponse } from "next/server";
import { getAuthenticatedUser, createAdminClient } from "@/lib/api/auth";
import { handleApiError } from "@/lib/api/errors";
import { validateRepoFullName } from "@/lib/api/validate";
import { registerWebhook, deleteWebhook } from "@/lib/api/github";

const WEBHOOK_SECRET = process.env.GITHUB_WEBHOOK_SECRET || "";

/**
 * GET /api/repos/sync/settings?repo=owner/name — Get sync settings
 */
export async function GET(request: Request) {
  try {
    const { user, supabase } = await getAuthenticatedUser();
    const { searchParams } = new URL(request.url);
    const repoFullName = validateRepoFullName(searchParams.get("repo") || "");

    const { data: repo } = await supabase
      .from("repos")
      .select("watched_branch, auto_sync_enabled, understanding_tier, last_synced_sha, webhook_id, default_branch")
      .eq("user_id", user.id)
      .eq("full_name", repoFullName)
      .single();

    if (!repo) {
      return NextResponse.json({ error: "Repo not found" }, { status: 404 });
    }

    return NextResponse.json({
      watchedBranch: repo.watched_branch || repo.default_branch || "main",
      autoSyncEnabled: repo.auto_sync_enabled || false,
      understandingTier: repo.understanding_tier || 2,
      lastSyncedSha: repo.last_synced_sha,
      hasWebhook: !!repo.webhook_id,
    });
  } catch (error) {
    return handleApiError(error);
  }
}

/**
 * PATCH /api/repos/sync/settings — Update sync settings
 *
 * Body: { repo_full_name, watched_branch?, auto_sync_enabled?, understanding_tier? }
 */
export async function PATCH(request: Request) {
  try {
    const { user, supabase, githubToken } = await getAuthenticatedUser();
    const body = await request.json();
    const fullName = validateRepoFullName(body.repo_full_name);
    const [owner, name] = fullName.split("/");
    const adminDb = await createAdminClient();

    // Build update object
    const updates: Record<string, unknown> = {};

    if (body.watched_branch !== undefined) {
      updates.watched_branch = body.watched_branch;
    }

    if (body.understanding_tier !== undefined) {
      const tier = Number(body.understanding_tier);
      if (![1, 2, 3].includes(tier)) {
        return NextResponse.json({ error: "Understanding tier must be 1, 2, or 3" }, { status: 400 });
      }
      updates.understanding_tier = tier;
    }

    if (body.auto_sync_enabled !== undefined) {
      const enable = Boolean(body.auto_sync_enabled);
      updates.auto_sync_enabled = enable;

      if (!githubToken) {
        return NextResponse.json({ error: "GitHub token required to manage webhooks" }, { status: 401 });
      }

      if (enable) {
        // Register GitHub webhook
        if (!WEBHOOK_SECRET) {
          return NextResponse.json(
            { error: "GITHUB_WEBHOOK_SECRET not configured on server" },
            { status: 500 }
          );
        }

        const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://webhook.yourdomain.com";
        const webhookUrl = `${baseUrl}/api/webhooks/github`;

        try {
          const hookId = await registerWebhook(githubToken, owner, name, webhookUrl, WEBHOOK_SECRET);
          updates.webhook_id = hookId;
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : "Unknown error";
          console.error("[sync-settings] Webhook registration error:", message);
          return NextResponse.json(
            { error: `Failed to register webhook: ${message}` },
            { status: 500 }
          );
        }
      } else {
        // Delete existing webhook
        const { data: repo } = await supabase
          .from("repos")
          .select("webhook_id")
          .eq("user_id", user.id)
          .eq("full_name", fullName)
          .single();

        if (repo?.webhook_id) {
          try {
            await deleteWebhook(githubToken, owner, name, repo.webhook_id);
          } catch (err: unknown) {
            const message = err instanceof Error ? err.message : "Unknown error";
            console.warn("[sync-settings] Webhook deletion failed (may be already gone):", message);
          }
          updates.webhook_id = null;
        }
      }
    }

    // Apply updates
    if (Object.keys(updates).length > 0) {
      await adminDb
        .from("repos")
        .update(updates)
        .eq("user_id", user.id)
        .eq("full_name", fullName);
    }

    return NextResponse.json({ ok: true, updates });
  } catch (error) {
    return handleApiError(error);
  }
}
