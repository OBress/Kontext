import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/api/auth";
import { handleApiError } from "@/lib/api/errors";
import { validateRepoFullName } from "@/lib/api/validate";

/**
 * GET /api/repos/sync/timeline?repo=owner/name&limit=50&offset=0
 * 
 * Returns paginated commit history for the development timeline.
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

    return NextResponse.json({
      commits: commits || [],
      pagination: {
        total: count || 0,
        limit,
        offset,
        hasMore: (count || 0) > offset + limit,
      },
      stats: {
        totalCommits: totalCommits || 0,
        syncedCommits: syncedCommits || 0,
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
