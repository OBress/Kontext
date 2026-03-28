import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/api/auth";
import { rateLimit } from "@/lib/api/rate-limit";
import { handleApiError } from "@/lib/api/errors";
import { validateRepoFullName } from "@/lib/api/validate";
import { buildGraph } from "@/lib/api/graph-builder";

/**
 * GET /api/graph?repo=owner/name — Build dependency graph from repo_files
 */
export async function GET(request: NextRequest) {
  try {
    const { user, supabase } = await getAuthenticatedUser();

    const rl = rateLimit(user.id, "graph");
    if (!rl.ok) {
      return NextResponse.json(
        { error: { code: "RATE_LIMITED", message: "Too many requests" } },
        { status: 429 }
      );
    }

    const repoFullName = request.nextUrl.searchParams.get("repo");
    if (!repoFullName) {
      return NextResponse.json(
        { error: { code: "VALIDATION_ERROR", message: "repo query parameter is required" } },
        { status: 400 }
      );
    }

    validateRepoFullName(repoFullName);

    // Fetch cached file data from repo_files
    const { data: files, error } = await supabase
      .from("repo_files")
      .select("file_path, file_name, extension, line_count, imports")
      .eq("user_id", user.id)
      .eq("repo_full_name", repoFullName);

    if (error) throw error;

    if (!files || files.length === 0) {
      return NextResponse.json({
        nodes: [],
        links: [],
        message: "No file data available. Index the repository first.",
      });
    }

    // Build the graph
    const graph = buildGraph(files);

    return NextResponse.json(graph);
  } catch (error) {
    return handleApiError(error);
  }
}
