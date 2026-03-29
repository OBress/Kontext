import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/api/auth";
import { handleApiError } from "@/lib/api/errors";
import { REPO_CHECK_TYPES } from "@/lib/api/repo-checks";
import { validateRepoFullName } from "@/lib/api/validate";

/**
 * GET /api/repos/checks/findings?repo=owner/name&status=open&limit=50
 */
export async function GET(request: NextRequest) {
  try {
    const { user, supabase } = await getAuthenticatedUser();
    const repoFullName = validateRepoFullName(
      request.nextUrl.searchParams.get("repo") || ""
    );
    const status = request.nextUrl.searchParams.get("status");
    const limit = Math.min(
      Math.max(Number.parseInt(request.nextUrl.searchParams.get("limit") || "50", 10) || 50, 1),
      100
    );
    const checkTypes = (request.nextUrl.searchParams.get("check_types") || "")
      .split(",")
      .map((value) => value.trim())
      .filter((value): value is (typeof REPO_CHECK_TYPES)[number] =>
        REPO_CHECK_TYPES.includes(value as (typeof REPO_CHECK_TYPES)[number])
      );

    let query = supabase
      .from("repo_check_findings")
      .select("*")
      .eq("user_id", user.id)
      .eq("repo_full_name", repoFullName)
      .order("updated_at", { ascending: false })
      .limit(limit);

    if (status === "open" || status === "resolved") {
      query = query.eq("status", status);
    }

    if (checkTypes.length > 0) {
      query = query.in("check_type", checkTypes);
    }

    const { data, error } = await query;
    if (error) throw error;

    return NextResponse.json({ findings: data || [] });
  } catch (error) {
    return handleApiError(error);
  }
}
