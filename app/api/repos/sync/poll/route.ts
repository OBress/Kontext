import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/api/auth";
import { handleApiError } from "@/lib/api/errors";
import { fetchLatestCommit } from "@/lib/api/github";
import { resolveRepoGitHubToken } from "@/lib/api/repo-auth";
import { enqueueSyncTask } from "@/lib/api/sync-queue";
import { executeBackgroundSync } from "@/lib/api/sync-pipeline";

/**
 * POST /api/repos/sync/poll — Lightweight poll for repos without webhooks.
 *
 * Checks repos where auto_sync_enabled = true AND webhook_id IS NULL.
 * For each, compares the latest commit SHA to last_synced_sha.
 * If a difference is found, enqueues a sync via the sync queue.
 *
 * Called by the frontend TaskIndicator every 5 minutes as a fallback
 * for repos where webhook registration wasn't possible (e.g. public repos
 * the user doesn't have admin access to).
 */
export async function POST() {
  try {
    const { user, supabase, githubToken } = await getAuthenticatedUser();

    // Find repos that need polling: auto-sync ON, no webhook, already indexed
    const { data: repos } = await supabase
      .from("repos")
      .select("full_name, last_synced_sha, watched_branch, default_branch")
      .eq("user_id", user.id)
      .eq("auto_sync_enabled", true)
      .eq("indexed", true)
      .is("webhook_id", null);

    if (!repos || repos.length === 0) {
      return NextResponse.json({ checked: 0, syncsTriggered: 0 });
    }

    const syncsTriggered: string[] = [];

    for (const repo of repos) {
      const [owner, name] = repo.full_name.split("/");
      const branch = repo.watched_branch || repo.default_branch || "main";

      try {
        const { token: effectiveToken } = await resolveRepoGitHubToken(
          supabase,
          user.id,
          repo.full_name,
          githubToken
        );

        if (!effectiveToken) continue;

        const latest = await fetchLatestCommit(effectiveToken, owner, name, branch);

        if (latest.sha !== repo.last_synced_sha) {
          console.log(
            `[poll] ${repo.full_name} has new commits (${repo.last_synced_sha?.slice(0, 7) || "none"} → ${latest.sha.slice(0, 7)})`
          );

          const result = enqueueSyncTask({
            userId: user.id,
            repoFullName: repo.full_name,
            headSHA: latest.sha,
            trigger: "poll",
            execute: (sha) =>
              executeBackgroundSync({
                userId: user.id,
                repoFullName: repo.full_name,
                headSHA: sha,
                trigger: "poll",
              }),
          });

          console.log(
            `[poll] Sync ${result.status} for ${repo.full_name} → ${latest.sha.slice(0, 7)}`
          );

          syncsTriggered.push(repo.full_name);
        }
      } catch (err) {
        console.warn(
          `[poll] Failed to check ${repo.full_name}:`,
          err instanceof Error ? err.message : err
        );
      }
    }

    return NextResponse.json({
      checked: repos.length,
      syncsTriggered: syncsTriggered.length,
      repos: syncsTriggered,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
