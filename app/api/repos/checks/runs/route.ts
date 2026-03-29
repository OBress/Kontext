import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/api/auth";
import { handleApiError } from "@/lib/api/errors";
import { validateRepoFullName } from "@/lib/api/validate";

/**
 * GET /api/repos/checks/runs?repo=owner/name&limit=20
 * GET /api/repos/checks/runs?limit=20
 */
export async function GET(request: NextRequest) {
  try {
    const { user, supabase } = await getAuthenticatedUser();
    const repoParam = request.nextUrl.searchParams.get("repo");
    const limit = Math.min(
      Math.max(Number.parseInt(request.nextUrl.searchParams.get("limit") || "20", 10) || 20, 1),
      50
    );

    let query = supabase
      .from("repo_check_runs")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (repoParam) {
      query = query.eq("repo_full_name", validateRepoFullName(repoParam));
    }

    const { data, error } = await query;

    if (error) throw error;

    return NextResponse.json({ runs: data || [] });
  } catch (error) {
    return handleApiError(error);
  }
}
