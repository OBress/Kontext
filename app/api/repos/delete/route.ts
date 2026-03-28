import { NextResponse } from "next/server";
import { getAuthenticatedUser, createAdminClient } from "@/lib/api/auth";
import { handleApiError } from "@/lib/api/errors";
import { validateRepoFullName } from "@/lib/api/validate";
import { ApiError } from "@/lib/api/errors";
import { deleteWebhook } from "@/lib/api/github";
import { logActivity } from "@/lib/api/activity";

/**
 * DELETE /api/repos/delete
 *
 * Permanently deletes a repository and ALL associated data:
 *   - repo_chunks (embeddings/vectors)
 *   - repo_files (file metadata)
 *   - ingestion_jobs (job history)
 *   - chat_sessions (chat history)
 *   - generated_prompts (saved prompts)
 *   - mcp_api_keys (scoped MCP keys)
 *   - team_invites (pending invites)
 *   - team_members (team memberships)
 *   - activity_events (activity log)
 *   - repos (the repo record itself — last)
 *
 * Also cleans up any registered GitHub webhooks.
 *
 * Only the repo owner can perform this action.
 */
export async function DELETE(request: Request) {
  try {
    const { user, supabase, githubToken } = await getAuthenticatedUser();
    const body = await request.json();
    const fullName = validateRepoFullName(body.repo_full_name);
    const [owner, name] = fullName.split("/");

    // ── 1. Verify ownership via repos table ─────────────────────────────
    // repos.user_id is the canonical ownership field — it's always set
    // when a repo is added, unlike team_members which may be missing.
    const { data: repo } = await supabase
      .from("repos")
      .select("webhook_id")
      .eq("user_id", user.id)
      .eq("full_name", fullName)
      .single();

    if (!repo) {
      throw new ApiError(
        404,
        "NOT_FOUND",
        "Repository not found or you are not the owner."
      );
    }

    // ── 3. Clean up GitHub webhook (best-effort) ─────────────────────
    if (repo.webhook_id && githubToken) {
      try {
        await deleteWebhook(githubToken, owner, name, repo.webhook_id);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Unknown error";
        console.warn(
          `[repo-delete] Webhook cleanup failed (may already be gone): ${message}`
        );
      }
    }

    // ── 4. Cascading delete across all tables ────────────────────────
    // Use admin client to bypass RLS — we've already verified ownership above.
    const adminDb = await createAdminClient();

    // Delete in dependency order: children first, parent (repos) last.
    // All deletes are filtered by user_id + repo_full_name for safety.

    // 4a. repo_chunks — bulk embeddings (largest table)
    await adminDb
      .from("repo_chunks")
      .delete()
      .eq("user_id", user.id)
      .eq("repo_full_name", fullName);

    // 4b. repo_files
    await adminDb
      .from("repo_files")
      .delete()
      .eq("user_id", user.id)
      .eq("repo_full_name", fullName);

    // 4c. ingestion_jobs
    await adminDb
      .from("ingestion_jobs")
      .delete()
      .eq("user_id", user.id)
      .eq("repo_full_name", fullName);

    // 4d. chat_sessions
    await adminDb
      .from("chat_sessions")
      .delete()
      .eq("user_id", user.id)
      .eq("repo_full_name", fullName);

    // 4e. generated_prompts
    await adminDb
      .from("generated_prompts")
      .delete()
      .eq("user_id", user.id)
      .eq("repo_full_name", fullName);

    // 4f. mcp_api_keys (scoped to this repo)
    await adminDb
      .from("mcp_api_keys")
      .delete()
      .eq("user_id", user.id)
      .eq("repo_full_name", fullName);

    // 4g. team_invites (invited_by = current user for this repo)
    await adminDb
      .from("team_invites")
      .delete()
      .eq("repo_full_name", fullName);

    // 4h. team_members
    await adminDb
      .from("team_members")
      .delete()
      .eq("repo_full_name", fullName);

    // 4i. activity_events
    await adminDb
      .from("activity_events")
      .delete()
      .eq("user_id", user.id)
      .eq("repo_full_name", fullName);

    // 4j. repos — the parent record, deleted last
    await adminDb
      .from("repos")
      .delete()
      .eq("user_id", user.id)
      .eq("full_name", fullName);

    // ── 5. Log activity (fire-and-forget) ────────────────────────────
    logActivity({
      userId: user.id,
      source: "kontext",
      eventType: "repo_deleted",
      title: `${fullName} was permanently deleted`,
      description: "All associated data (embeddings, chats, prompts, team) has been removed.",
    });

    return NextResponse.json({ ok: true, deleted: fullName });
  } catch (error) {
    return handleApiError(error);
  }
}
