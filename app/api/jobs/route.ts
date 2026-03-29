import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/api/auth";
import { handleApiError } from "@/lib/api/errors";

export async function GET(request: NextRequest) {
  try {
    const { user, supabase } = await getAuthenticatedUser();
    const repoFullName = request.nextUrl.searchParams.get("repo");
    const limitParam = request.nextUrl.searchParams.get("limit");
    const limit = Math.min(
      Math.max(parseInt(limitParam || "20", 10) || 20, 1),
      50
    );

    let query = supabase
      .from("repo_jobs")
      .select(
        "id, repo_full_name, job_type, trigger, status, title, progress_percent, result_summary, error_message, metadata, created_at, updated_at"
      )
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (repoFullName) {
      query = query.eq("repo_full_name", repoFullName);
    }

    const { data, error } = await query;
    if (error) throw error;

    return NextResponse.json({ jobs: data || [] });
  } catch (error) {
    return handleApiError(error);
  }
}
