import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/api/auth";
import { rateLimit } from "@/lib/api/rate-limit";
import { handleApiError } from "@/lib/api/errors";
import { validateRepoFullName } from "@/lib/api/validate";

/**
 * GET /api/repos/files?repo=owner/name
 * Returns the flat list of indexed file paths for a repository.
 * Used by the chat file tree and @-mention picker.
 */
export async function GET(request: NextRequest) {
  try {
    const { user, supabase } = await getAuthenticatedUser();

    const rl = rateLimit(user.id, "files");
    if (!rl.ok) {
      return NextResponse.json(
        { error: { code: "RATE_LIMITED", message: "Too many requests" } },
        { status: 429 }
      );
    }

    const repoFullName = validateRepoFullName(
      request.nextUrl.searchParams.get("repo")
    );

    const { data: files, error } = await supabase
      .from("repo_files")
      .select("file_path, extension, line_count")
      .eq("user_id", user.id)
      .eq("repo_full_name", repoFullName)
      .order("file_path");

    if (error) throw error;

    return NextResponse.json({ files: files || [] });
  } catch (error) {
    return handleApiError(error);
  }
}
