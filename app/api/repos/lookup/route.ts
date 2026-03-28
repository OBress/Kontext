import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/api/auth";
import { rateLimit } from "@/lib/api/rate-limit";
import { handleApiError, ApiError } from "@/lib/api/errors";
import { fetchRepoByFullName } from "@/lib/api/github";

/**
 * GET /api/repos/lookup?url=<github_url>&access_token=<optional_pat>
 * Parses a GitHub URL, fetches repo metadata, returns it for preview before adding.
 * If an access_token is provided, it's used instead of the user's OAuth token
 * (for private repos the user doesn't own but has PAT access to).
 */
export async function GET(request: NextRequest) {
  try {
    const { user, githubToken } = await getAuthenticatedUser();

    const rl = rateLimit(user.id, "repos");
    if (!rl.ok) {
      return NextResponse.json(
        { error: { code: "RATE_LIMITED", message: "Too many requests" } },
        { status: 429 }
      );
    }

    const rawUrl = request.nextUrl.searchParams.get("url")?.trim();
    if (!rawUrl) {
      throw new ApiError(400, "MISSING_URL", "A GitHub URL is required.");
    }

    // Optional custom access token for private repos
    const customToken = request.nextUrl.searchParams.get("access_token")?.trim() || null;

    // Parse GitHub URL — supports:
    //   https://github.com/owner/repo
    //   https://github.com/owner/repo.git
    //   github.com/owner/repo
    //   owner/repo
    let owner: string;
    let name: string;

    const githubUrlMatch = rawUrl.match(
      /(?:https?:\/\/)?(?:www\.)?github\.com\/([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+?)(?:\.git)?(?:\/.*)?$/
    );

    if (githubUrlMatch) {
      owner = githubUrlMatch[1];
      name = githubUrlMatch[2];
    } else {
      // Try owner/name format
      const slashMatch = rawUrl.match(/^([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+)$/);
      if (slashMatch) {
        owner = slashMatch[1];
        name = slashMatch[2];
      } else {
        throw new ApiError(400, "INVALID_URL", "Could not parse GitHub URL. Try: https://github.com/owner/repo or owner/repo");
      }
    }

    // Use custom token if provided, otherwise fall back to OAuth token
    const tokenToUse = customToken || githubToken;
    if (!tokenToUse) {
      throw new ApiError(401, "NO_TOKEN", "GitHub token not available. Please re-authenticate or provide an access token.");
    }

    // Validate the token by attempting to fetch the repo
    let repo;
    try {
      repo = await fetchRepoByFullName(tokenToUse, owner, name);
    } catch (err: any) {
      // Check for auth-specific failures
      if (err.status === 401 || err.message?.includes("401")) {
        throw new ApiError(
          401,
          "INVALID_TOKEN",
          customToken
            ? "The access token is invalid or expired. Please check your Personal Access Token."
            : "Your GitHub session has expired. Please re-authenticate."
        );
      }
      if (err.status === 403 || err.message?.includes("403")) {
        throw new ApiError(
          403,
          "INSUFFICIENT_SCOPE",
          customToken
            ? "The access token doesn't have permission to access this repo. Ensure your PAT has the 'repo' scope."
            : "Your GitHub token doesn't have permission to access this repo."
        );
      }
      if (err.status === 404 || err.message?.includes("404")) {
        throw new ApiError(
          404,
          "NOT_FOUND",
          customToken
            ? "Repository not found. Check the URL and ensure your access token has permission to view it."
            : "Repository not found. If it's private, add an access token with 'repo' scope."
        );
      }
      throw err;
    }

    return NextResponse.json({
      repo: {
        id: repo.id,
        full_name: repo.full_name,
        name: repo.name,
        owner: repo.owner.login,
        description: repo.description,
        language: repo.language,
        stargazers_count: repo.stargazers_count,
        forks_count: repo.forks_count,
        updated_at: repo.updated_at,
        default_branch: repo.default_branch,
        private: repo.private,
      },
      usedCustomToken: !!customToken,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
