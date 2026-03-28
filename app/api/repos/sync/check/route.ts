import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/api/auth";
import { handleApiError } from "@/lib/api/errors";
import { validateRepoFullName } from "@/lib/api/validate";
import { fetchLatestCommit, fetchCommitsSince } from "@/lib/api/github";

/**
 * GET /api/repos/sync/check?repo=owner/name — Check for new commits
 */
export async function GET(request: Request) {
  try {
    const { user, supabase, githubToken } = await getAuthenticatedUser();
    const { searchParams } = new URL(request.url);
    const repoFullName = validateRepoFullName(searchParams.get("repo") || "");
    const [owner, name] = repoFullName.split("/");

    if (!githubToken) {
      return NextResponse.json({ error: "GitHub token required" }, { status: 401 });
    }

    // Get stored repo data
    const { data: repo } = await supabase
      .from("repos")
      .select("last_synced_sha, watched_branch, auto_sync_enabled, understanding_tier")
      .eq("user_id", user.id)
      .eq("full_name", repoFullName)
      .single();

    if (!repo) {
      return NextResponse.json({ error: "Repo not found" }, { status: 404 });
    }

    const branch = repo.watched_branch || "main";
    const latest = await fetchLatestCommit(githubToken, owner, name, branch);

    const hasUpdates = repo.last_synced_sha !== latest.sha;
    let newCommitCount = 0;

    if (hasUpdates && repo.last_synced_sha) {
      const newCommits = await fetchCommitsSince(
        githubToken, owner, name, branch, repo.last_synced_sha
      );
      newCommitCount = newCommits.length;
    }

    return NextResponse.json({
      hasUpdates,
      currentSha: latest.sha,
      lastSyncedSha: repo.last_synced_sha,
      newCommitCount,
      latestMessage: latest.commit.message.split("\n")[0], // First line only
      latestAuthor: latest.author?.login || latest.commit.author.name,
      latestDate: latest.commit.author.date,
      branch,
      autoSyncEnabled: repo.auto_sync_enabled,
      understandingTier: repo.understanding_tier,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
