import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/api/auth";
import { handleApiError } from "@/lib/api/errors";
import { fetchRepoBranches } from "@/lib/api/github";
import { resolveRepoGitHubToken } from "@/lib/api/repo-auth";

/**
 * GET /api/repos/branches?repo=owner/name
 * Returns the list of branches for a repository.
 */
export async function GET(request: Request) {
  try {
    const { user, supabase } = await getAuthenticatedUser();
    const { searchParams } = new URL(request.url);
    const repo = searchParams.get("repo");

    if (!repo || !repo.includes("/")) {
      return NextResponse.json(
        { error: { message: "Missing or invalid repo parameter (owner/name)" } },
        { status: 400 }
      );
    }

    const [owner, name] = repo.split("/");

    // Get the user's OAuth token as fallback
    const { data: { session } } = await supabase.auth.getSession();
    const oauthToken = session?.provider_token ?? null;

    const { token } = await resolveRepoGitHubToken(supabase, user.id, repo, oauthToken);

    if (!token) {
      return NextResponse.json(
        { error: { message: "No GitHub token available" } },
        { status: 401 }
      );
    }

    const branches = await fetchRepoBranches(token, owner, name);

    return NextResponse.json({
      branches: branches.map((b) => ({
        name: b.name,
        protected: b.protected,
      })),
    });
  } catch (error) {
    return handleApiError(error);
  }
}
