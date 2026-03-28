import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/api/auth";
import { ApiError, handleApiError } from "@/lib/api/errors";
import { fetchRepoByFullName } from "@/lib/api/github";
import { rateLimit } from "@/lib/api/rate-limit";

function parseRepoInput(rawUrl: string): { owner: string; name: string } {
  const githubUrlMatch = rawUrl.match(
    /(?:https?:\/\/)?(?:www\.)?github\.com\/([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+?)(?:\.git)?(?:\/.*)?$/
  );

  if (githubUrlMatch) {
    return { owner: githubUrlMatch[1], name: githubUrlMatch[2] };
  }

  const slashMatch = rawUrl.match(/^([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+)$/);
  if (slashMatch) {
    return { owner: slashMatch[1], name: slashMatch[2] };
  }

  throw new ApiError(
    400,
    "INVALID_URL",
    "Could not parse GitHub URL. Try: https://github.com/owner/repo or owner/repo"
  );
}

async function handleLookup(request: NextRequest, input: { url: string; access_token?: string | null }) {
  const { user, githubToken } = await getAuthenticatedUser();

  const rl = rateLimit(user.id, "repos");
  if (!rl.ok) {
    return NextResponse.json(
      { error: { code: "RATE_LIMITED", message: "Too many requests" } },
      { status: 429 }
    );
  }

  const rawUrl = input.url?.trim();
  if (!rawUrl) {
    throw new ApiError(400, "MISSING_URL", "A GitHub URL is required.");
  }

  const customToken = input.access_token?.trim() || null;
  const { owner, name } = parseRepoInput(rawUrl);
  const tokenToUse = customToken || githubToken;

  if (!tokenToUse) {
    throw new ApiError(
      401,
      "NO_TOKEN",
      "GitHub token not available. Please re-authenticate or provide an access token."
    );
  }

  let repo;
  try {
    repo = await fetchRepoByFullName(tokenToUse, owner, name);
  } catch (err: unknown) {
    const errObj = err as { status?: number; message?: string };
    if (errObj.status === 401 || errObj.message?.includes("401")) {
      throw new ApiError(
        401,
        "INVALID_TOKEN",
        customToken
          ? "The access token is invalid or expired. Please check your Personal Access Token."
          : "Your GitHub session has expired. Please re-authenticate."
      );
    }
    if (errObj.status === 403 || errObj.message?.includes("403")) {
      throw new ApiError(
        403,
        "INSUFFICIENT_SCOPE",
        customToken
          ? "The access token doesn't have permission to access this repo. Ensure your PAT has the 'repo' scope."
          : "Your GitHub token doesn't have permission to access this repo."
      );
    }
    if (errObj.status === 404 || errObj.message?.includes("404")) {
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
}

/**
 * GET /api/repos/lookup?url=<github_url>
 * POST /api/repos/lookup { url, access_token? }
 */
export async function GET(request: NextRequest) {
  try {
    return await handleLookup(request, {
      url: request.nextUrl.searchParams.get("url") || "",
      access_token: request.nextUrl.searchParams.get("access_token"),
    });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    return await handleLookup(request, {
      url: body.url || "",
      access_token: body.access_token || null,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
