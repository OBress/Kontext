import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/api/auth";
import { handleApiError, ApiError } from "@/lib/api/errors";
import { validateRepoFullName } from "@/lib/api/validate";
import { decryptToken } from "@/lib/api/crypto";
import { fetchFileContent } from "@/lib/api/github";
import { buildGitHubBlobUrl, detectCodeLanguage } from "@/lib/code";

function validateFilePath(input: string | null): string {
  if (!input || !input.trim()) {
    throw new ApiError(400, "VALIDATION_ERROR", "path is required");
  }

  const trimmed = input.trim();
  if (trimmed.length > 1000) {
    throw new ApiError(400, "VALIDATION_ERROR", "path is too long");
  }

  return trimmed;
}

/**
 * GET /api/repos/file?repo=owner/name&path=src/app.ts&sha=<optional>
 * Loads the exact repository file content for the right-hand inspector.
 */
export async function GET(request: NextRequest) {
  try {
    const { user, supabase, githubToken } = await getAuthenticatedUser();

    const repoFullName = validateRepoFullName(
      request.nextUrl.searchParams.get("repo")
    );
    const filePath = validateFilePath(request.nextUrl.searchParams.get("path"));
    const requestedSha = request.nextUrl.searchParams.get("sha");

    const { data: repo } = await supabase
      .from("repos")
      .select("*")
      .eq("user_id", user.id)
      .eq("full_name", repoFullName)
      .single();

    if (!repo) {
      throw new ApiError(404, "NOT_FOUND", "Repository not found");
    }

    let effectiveToken = githubToken;
    if (
      repo.custom_github_token &&
      repo.custom_token_iv &&
      repo.custom_token_tag
    ) {
      effectiveToken = decryptToken({
        ciphertext: repo.custom_github_token,
        iv: repo.custom_token_iv,
        tag: repo.custom_token_tag,
      });
    }

    if (!effectiveToken) {
      throw new ApiError(
        401,
        "GITHUB_TOKEN_REQUIRED",
        "GitHub token not available for file inspection"
      );
    }

    const [owner, name] = repoFullName.split("/");
    const commitSha =
      requestedSha ||
      repo.last_synced_sha ||
      repo.watched_branch ||
      repo.default_branch ||
      null;

    const content = await fetchFileContent(
      effectiveToken,
      owner,
      name,
      filePath,
      commitSha || undefined
    );

    if (!content) {
      throw new ApiError(404, "NOT_FOUND", "File content not available");
    }

    return NextResponse.json({
      file_path: filePath,
      content,
      language: detectCodeLanguage(filePath),
      commit_sha: commitSha,
      index_version_id: repo.last_synced_sha || repo.last_indexed_at || null,
      github_url: buildGitHubBlobUrl(
        repoFullName,
        commitSha,
        filePath
      ),
      last_indexed_at: repo.last_indexed_at,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
