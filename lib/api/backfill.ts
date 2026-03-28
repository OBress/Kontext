import { logActivity } from "./activity";

/**
 * Backfill recent GitHub activity for a newly added repo.
 * Fetches recent commits, PRs, and issues via the GitHub REST API
 * and logs them as activity events so the feed isn't empty.
 *
 * Fire-and-forget — errors are logged but never thrown.
 */
export async function backfillRepoActivity(params: {
  userId: string;
  repoFullName: string;
  githubToken: string;
  limit?: number;
}): Promise<void> {
  const { userId, repoFullName, githubToken, limit = 10 } = params;
  const [owner, name] = repoFullName.split("/");
  const headers = {
    Authorization: `Bearer ${githubToken}`,
    Accept: "application/vnd.github.v3+json",
  };

  try {
    // Fetch recent commits, PRs, and issues in parallel
    const [commitsRes, prsRes, issuesRes] = await Promise.allSettled([
      fetch(`https://api.github.com/repos/${owner}/${name}/commits?per_page=${limit}`, { headers }),
      fetch(`https://api.github.com/repos/${owner}/${name}/pulls?state=all&sort=updated&per_page=${limit}`, { headers }),
      fetch(`https://api.github.com/repos/${owner}/${name}/issues?state=all&sort=updated&per_page=${limit}&filter=all`, { headers }),
    ]);

    // Process commits
    if (commitsRes.status === "fulfilled" && commitsRes.value.ok) {
      const commits: Array<{ sha?: string; commit?: { message?: string; author?: { name?: string } }; author?: { login?: string; avatar_url?: string } }> = await commitsRes.value.json();
      for (const commit of commits) {
        logActivity({
          userId,
          repoFullName,
          source: "github",
          eventType: "push",
          title: `Commit to ${repoFullName}`,
          description: commit.commit?.message?.split("\n")[0]?.slice(0, 120) || "",
          metadata: {
            sha: commit.sha?.slice(0, 7),
            author: commit.commit?.author?.name || commit.author?.login || "Unknown",
            avatar_url: commit.author?.avatar_url,
            branch: "main",
            backfilled: true,
          },
        });
      }
    }

    // Process PRs
    if (prsRes.status === "fulfilled" && prsRes.value.ok) {
      const prs: Array<{ number: number; state: string; merged_at: string | null; title?: string; user?: { login?: string; avatar_url?: string } }> = await prsRes.value.json();
      for (const pr of prs.slice(0, 5)) {
        const isMerged = pr.merged_at !== null;
        const isClosed = pr.state === "closed";
        const verb = isMerged ? "merged" : isClosed ? "closed" : "opened";

        logActivity({
          userId,
          repoFullName,
          source: "github",
          eventType: "pull_request",
          title: `PR #${pr.number} ${verb}`,
          description: pr.title?.slice(0, 120),
          metadata: {
            pr_number: pr.number,
            action: verb,
            merged: isMerged,
            author: pr.user?.login,
            avatar_url: pr.user?.avatar_url,
            backfilled: true,
          },
        });
      }
    }

    // Process issues (filter out PRs which GitHub includes in issues API)
    if (issuesRes.status === "fulfilled" && issuesRes.value.ok) {
      const issues: Array<{ number: number; state: string; title?: string; pull_request?: unknown; user?: { login?: string; avatar_url?: string } }> = await issuesRes.value.json();
      const realIssues = issues.filter((i) => !i.pull_request);
      for (const issue of realIssues.slice(0, 5)) {
        const verb = issue.state === "closed" ? "closed" : "opened";

        logActivity({
          userId,
          repoFullName,
          source: "github",
          eventType: "issue",
          title: `Issue #${issue.number} ${verb}`,
          description: issue.title?.slice(0, 120),
          metadata: {
            issue_number: issue.number,
            action: verb,
            author: issue.user?.login,
            avatar_url: issue.user?.avatar_url,
            backfilled: true,
          },
        });
      }
    }

    console.log(`[backfill] Activity backfill complete for ${repoFullName}`);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error(`[backfill] Failed to backfill activity for ${repoFullName}:`, message);
  }
}
