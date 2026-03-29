import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/api/auth";
import { handleApiError } from "@/lib/api/errors";
import { runRepoChecks } from "@/lib/api/repo-checks";
import { validateRepoFullName } from "@/lib/api/validate";

/**
 * POST /api/repos/checks/run
 *
 * Body:
 * {
 *   repo_full_name: string,
 *   trigger_mode?: "manual" | "after_sync" | "daily" | "mcp",
 *   requested_check_types?: string[],
 *   head_sha?: string,
 *   base_sha?: string,
 *   changed_files?: []
 * }
 */
export async function POST(request: Request) {
  try {
    const { user, supabase } = await getAuthenticatedUser();
    const body = await request.json();
    const repoFullName = validateRepoFullName(body.repo_full_name);

    const { data: repo } = await supabase
      .from("repos")
      .select("full_name")
      .eq("user_id", user.id)
      .eq("full_name", repoFullName)
      .single();

    if (!repo) {
      return NextResponse.json({ error: "Repo not found" }, { status: 404 });
    }

    const apiKey = request.headers.get("x-google-api-key");

    const result = await runRepoChecks({
      userId: user.id,
      repoFullName,
      apiKey,
      triggerMode:
        typeof body.trigger_mode === "string" ? body.trigger_mode : "manual",
      requestedCheckTypes: body.requested_check_types,
      headSha: typeof body.head_sha === "string" ? body.head_sha : null,
      baseSha: typeof body.base_sha === "string" ? body.base_sha : null,
      changedFiles: Array.isArray(body.changed_files) ? body.changed_files : [],
    });

    return NextResponse.json(result);
  } catch (error) {
    return handleApiError(error);
  }
}
