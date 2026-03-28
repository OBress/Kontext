import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/api/auth";
import { handleApiError } from "@/lib/api/errors";
import { validateRepoFullName } from "@/lib/api/validate";

interface CommitRow {
  id: number;
  sha: string;
  message: string;
  author_name: string;
  author_avatar_url: string | null;
  committed_at: string;
  files_changed: unknown;
  sync_triggered: boolean;
  ai_summary: string | null;
  push_group_id: string | null;
}

interface PushGroup {
  push_group_id: string;
  committed_at: string;
  author_name: string;
  author_avatar_url: string | null;
  commit_count: number;
  commits: CommitRow[];
}

/**
 * GET /api/repos/sync/timeline?repo=owner/name&limit=50&offset=0
 *
 * Returns paginated commit history for the development timeline,
 * grouped by push_group_id.
 */
export async function GET(request: Request) {
  try {
    const { user, supabase } = await getAuthenticatedUser();
    const { searchParams } = new URL(request.url);
    const repoFullName = validateRepoFullName(searchParams.get("repo") || "");
    const limit = Math.min(Number(searchParams.get("limit") || 50), 100);
    const offset = Number(searchParams.get("offset") || 0);

    // Fetch commits with pagination
    const { data: commits, count } = await supabase
      .from("repo_commits")
      .select("*", { count: "exact" })
      .eq("user_id", user.id)
      .eq("repo_full_name", repoFullName)
      .order("committed_at", { ascending: false })
      .range(offset, offset + limit - 1);

    // Gather stats
    const { count: totalCommits } = await supabase
      .from("repo_commits")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .eq("repo_full_name", repoFullName);

    const { count: syncedCommits } = await supabase
      .from("repo_commits")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .eq("repo_full_name", repoFullName)
      .eq("sync_triggered", true);

    const { count: pendingSummaries } = await supabase
      .from("repo_commits")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .eq("repo_full_name", repoFullName)
      .is("ai_summary", null);

    // Group commits by push_group_id
    const rawCommits = (commits || []) as CommitRow[];
    const groupMap = new Map<string, PushGroup>();
    const ungrouped: CommitRow[] = [];

    for (const commit of rawCommits) {
      const groupId = commit.push_group_id;
      if (groupId) {
        if (!groupMap.has(groupId)) {
          groupMap.set(groupId, {
            push_group_id: groupId,
            committed_at: commit.committed_at,
            author_name: commit.author_name,
            author_avatar_url: commit.author_avatar_url,
            commit_count: 0,
            commits: [],
          });
        }
        const group = groupMap.get(groupId)!;
        group.commits.push(commit);
        group.commit_count = group.commits.length;
        // Use the latest commit's timestamp for the group
        if (new Date(commit.committed_at) > new Date(group.committed_at)) {
          group.committed_at = commit.committed_at;
        }
      } else {
        ungrouped.push(commit);
      }
    }

    // Convert ungrouped commits into single-commit groups
    for (const commit of ungrouped) {
      const soloGroupId = `solo-${commit.sha}`;
      groupMap.set(soloGroupId, {
        push_group_id: soloGroupId,
        committed_at: commit.committed_at,
        author_name: commit.author_name,
        author_avatar_url: commit.author_avatar_url,
        commit_count: 1,
        commits: [commit],
      });
    }

    // Sort groups by most recent commit
    const pushGroups = Array.from(groupMap.values()).sort(
      (a, b) =>
        new Date(b.committed_at).getTime() - new Date(a.committed_at).getTime()
    );

    return NextResponse.json({
      pushGroups,
      commits: rawCommits, // Also return flat list for backward compatibility
      pagination: {
        total: count || 0,
        limit,
        offset,
        hasMore: (count || 0) > offset + limit,
      },
      stats: {
        totalCommits: totalCommits || 0,
        syncedCommits: syncedCommits || 0,
        pendingSummaries: pendingSummaries || 0,
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
