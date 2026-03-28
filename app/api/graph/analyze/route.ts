import { NextResponse } from "next/server";
import { getAuthenticatedUser, createAdminClient } from "@/lib/api/auth";
import { handleApiError } from "@/lib/api/errors";
import { rateLimit } from "@/lib/api/rate-limit";
import { validateApiKey, validateRepoFullName } from "@/lib/api/validate";
import { analyzeArchitecture } from "@/lib/api/architecture-analyzer";

/**
 * POST /api/graph/analyze — Run AI architecture analysis on a repo.
 *
 * Requires: x-google-api-key header, repo_full_name in body.
 * Returns: ArchitectureAnalysis JSON, also caches in repos table.
 */
export async function POST(request: Request) {
  try {
    const { user, supabase } = await getAuthenticatedUser();

    const rl = rateLimit(user.id, "graph-analyze");
    if (!rl.ok) {
      return NextResponse.json(
        { error: { code: "RATE_LIMITED", message: "Too many requests" } },
        { status: 429 }
      );
    }

    const body = await request.json();
    const fullName = validateRepoFullName(body.repo_full_name);
    const apiKey = validateApiKey(request);

    // 1. Fetch file metadata from repo_files
    const { data: files, error: filesError } = await supabase
      .from("repo_files")
      .select("file_path, file_name, extension, line_count, imports")
      .eq("user_id", user.id)
      .eq("repo_full_name", fullName);

    if (filesError) throw filesError;
    if (!files || files.length === 0) {
      return NextResponse.json(
        { error: { code: "NO_FILES", message: "No indexed files. Ingest the repository first." } },
        { status: 400 }
      );
    }

    // 2. Fetch a sample of code content from repo_chunks (first chunk per file, up to 40 files)
    // Prioritize important files: pages, routes, main config
    const priorityFiles = files
      .sort((a, b) => {
        // Sort by importance: route files first, then pages, then larger files
        const aScore = getFileImportance(a.file_path, a.line_count);
        const bScore = getFileImportance(b.file_path, b.line_count);
        return bScore - aScore;
      })
      .slice(0, 40)
      .map((f) => f.file_path);

    const { data: chunks } = await supabase
      .from("repo_chunks")
      .select("file_path, content")
      .eq("user_id", user.id)
      .eq("repo_full_name", fullName)
      .eq("chunk_index", 0)
      .in("file_path", priorityFiles);

    const chunkSamples = (chunks || []).map((c) => ({
      file_path: c.file_path,
      content: c.content,
    }));

    // 3. Run AI analysis
    const analysis = await analyzeArchitecture(
      apiKey,
      fullName,
      files.map((f) => ({
        file_path: f.file_path,
        file_name: f.file_name,
        extension: f.extension,
        line_count: f.line_count,
        imports: f.imports || [],
      })),
      chunkSamples
    );

    // 4. Cache the result using admin client to bypass RLS
    const adminDb = await createAdminClient();
    await adminDb
      .from("repos")
      .update({
        architecture_analysis: analysis,
        architecture_analyzed_at: new Date().toISOString(),
      })
      .eq("user_id", user.id)
      .eq("full_name", fullName);

    return NextResponse.json({
      analysis,
      analyzedAt: new Date().toISOString(),
    });
  } catch (error) {
    return handleApiError(error);
  }
}

/** Score file importance for sampling priority */
function getFileImportance(filePath: string, lineCount: number): number {
  let score = 0;
  const lower = filePath.toLowerCase();

  // Route/page files are highest priority
  if (lower.includes("/route.")) score += 100;
  if (lower.includes("/page.")) score += 90;
  if (lower.includes("/layout.")) score += 80;

  // Config files
  if (lower.includes("config") || lower.includes("middleware")) score += 70;

  // API/lib files
  if (lower.includes("/api/")) score += 60;
  if (lower.includes("/lib/")) score += 50;

  // Larger files tend to be more important
  score += Math.min(lineCount / 10, 30);

  // Downweight tests, types-only, and generated files
  if (lower.includes("test") || lower.includes("spec")) score -= 50;
  if (lower.includes(".d.ts")) score -= 40;
  if (lower.includes("node_modules")) score -= 200;

  return score;
}
