import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/api/auth";
import { rateLimit } from "@/lib/api/rate-limit";
import { handleApiError, ApiError } from "@/lib/api/errors";
import { fetchRepoByFullName } from "@/lib/api/github";

/**
 * GET /api/repos/lookup?url=<github_url>
 * Parses a GitHub URL, fetches repo metadata, returns it for preview before adding
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

    if (!githubToken) {
      throw new ApiError(401, "NO_TOKEN", "GitHub token not available. Please re-authenticate.");
    }

    const repo = await fetchRepoByFullName(githubToken, owner, name);

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
    });
  } catch (error) {
    return handleApiError(error);
  }
}
