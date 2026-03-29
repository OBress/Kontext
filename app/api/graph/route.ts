import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/api/auth";
import { rateLimit } from "@/lib/api/rate-limit";
import { handleApiError } from "@/lib/api/errors";
import { validateRepoFullName } from "@/lib/api/validate";
import { buildGraph } from "@/lib/api/graph-builder";
import {
  getArchitectureView,
  getArchitectureSchemaVersion,
  toArchitectureBundle,
} from "@/types/architecture";

/**
 * GET /api/graph?repo=owner/name - Build dependency graph from repo_files
 * Also returns cached architecture bundle and freshness metadata.
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

    const { data: repoData } = await supabase
      .from("repos")
      .select(
        "architecture_analysis, architecture_analyzed_at, architecture_status, architecture_for_sha, architecture_error, last_synced_sha"
      )
      .eq("user_id", user.id)
      .eq("full_name", repoFullName)
      .single();

    const { data: files, error } = await supabase
      .from("repo_files")
      .select("file_path, file_name, extension, line_count, imports")
      .eq("user_id", user.id)
      .eq("repo_full_name", repoFullName);

    if (error) throw error;

    const rawArchitecture = repoData?.architecture_analysis || null;
    const architectureBundle = toArchitectureBundle(rawArchitecture);
    const schemaVersion = getArchitectureSchemaVersion(rawArchitecture);
    const hasLegacyBundle = !!rawArchitecture && schemaVersion !== null && schemaVersion < 3;

    const architectureStatus =
      hasLegacyBundle
        ? "stale"
        : repoData?.architecture_status || (architectureBundle ? "ready" : "missing");
    const architectureForSha = repoData?.architecture_for_sha || architectureBundle?.sourceSha || null;
    const isStale =
      hasLegacyBundle ||
      architectureStatus === "stale" ||
      (!!repoData?.last_synced_sha && architectureForSha !== repoData.last_synced_sha);
    const architectureError =
      hasLegacyBundle
        ? "Architecture map is on an older schema and needs to be regenerated."
        : repoData?.architecture_error || null;

    if (!files || files.length === 0) {
      return NextResponse.json({
        nodes: [],
        links: [],
        architecture: getArchitectureView(architectureBundle, "system"),
        architectureBundle,
        architectureStatus,
        architectureForSha,
        architectureError,
        analyzedAt: repoData?.architecture_analyzed_at || null,
        isStale,
        message: "No file data available. Index the repository first.",
      });
    }

    const graph = buildGraph(files);

    return NextResponse.json({
      ...graph,
      architecture: getArchitectureView(architectureBundle, "system"),
      architectureBundle,
      architectureStatus,
      architectureForSha,
      architectureError,
      analyzedAt: repoData?.architecture_analyzed_at || null,
      isStale,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
