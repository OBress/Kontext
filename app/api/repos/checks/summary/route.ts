import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/api/auth";
import { handleApiError } from "@/lib/api/errors";
import { getRepoHealthSummary } from "@/lib/api/repo-checks";
import { validateRepoFullName } from "@/lib/api/validate";

/**
 * GET /api/repos/checks/summary?repo=owner/name
 */
export async function GET(request: NextRequest) {
  try {
    const { user, supabase } = await getAuthenticatedUser();
    const repoFullName = validateRepoFullName(
      request.nextUrl.searchParams.get("repo") || ""
    );

    const { data: repo } = await supabase
      .from("repos")
      .select("full_name")
      .eq("user_id", user.id)
      .eq("full_name", repoFullName)
      .single();

    if (!repo) {
      return NextResponse.json({ error: "Repo not found" }, { status: 404 });
    }

    const summary = await getRepoHealthSummary(supabase, user.id, repoFullName);
    return NextResponse.json(summary);
  } catch (error) {
    return handleApiError(error);
  }
}
