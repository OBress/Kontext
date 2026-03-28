import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/api/auth";
import { rateLimit } from "@/lib/api/rate-limit";
import { handleApiError } from "@/lib/api/errors";
import { validateRepoFullName } from "@/lib/api/validate";
import { fetchUserRepos } from "@/lib/api/github";
import { encryptToken } from "@/lib/api/crypto";

/**
 * GET /api/repos — Returns repos based on source:
 *   default:          Only repos the user has "added" (exist in Supabase repos table)
 *   ?source=github:   The user's GitHub repos, excluding any already added
 */
export async function GET(request: NextRequest) {
  try {
    const { user, supabase, githubToken } = await getAuthenticatedUser();

    const rl = rateLimit(user.id, "repos");
    if (!rl.ok) {
      return NextResponse.json(
        { error: { code: "RATE_LIMITED", message: "Too many requests" } },
        { status: 429, headers: { "Retry-After": String(Math.ceil((rl.resetAt - Date.now()) / 1000)) } }
      );
    }

    const source = request.nextUrl.searchParams.get("source");

    if (source === "github") {
      // Browse mode: return GitHub repos, excluding already-added ones
      if (!githubToken) {
        return NextResponse.json(
          { error: { code: "NO_TOKEN", message: "GitHub token not available" } },
          { status: 401 }
        );
      }

      // Get already-added repo names
      const { data: addedRepos } = await supabase
        .from("repos")
        .select("full_name")
        .eq("user_id", user.id);

      const addedSet = new Set((addedRepos || []).map((r) => r.full_name));

      const ghRepos = await fetchUserRepos(githubToken);
      const repos = ghRepos
        .filter((r) => !addedSet.has(r.full_name))
        .map((r) => ({
          id: r.id,
          full_name: r.full_name,
          name: r.name,
          owner: r.owner.login,
          description: r.description,
          language: r.language,
          stargazers_count: r.stargazers_count,
          forks_count: r.forks_count,
          updated_at: r.updated_at,
          default_branch: r.default_branch,
          private: r.private,
        }));

      return NextResponse.json({ repos });
    }

    // Default: return only added repos from Supabase
    const { data: dbRepos } = await supabase
      .from("repos")
      .select("*")
      .eq("user_id", user.id)
      .order("updated_at", { ascending: false });

    const repos = (dbRepos || []).map((r) => ({
      id: r.github_id,
      full_name: r.full_name,
      name: r.name,
      owner: r.owner,
      description: r.description,
      language: r.language,
      stargazers_count: r.stargazers_count,
      forks_count: r.forks_count,
      updated_at: r.updated_at,
      indexed: r.indexed,
      indexing: r.indexing,
      chunk_count: r.chunk_count,
    }));

    return NextResponse.json({ repos });
  } catch (error) {
    return handleApiError(error);
  }
}

/**
 * POST /api/repos — Connect/add a repo (upsert into repos + add owner to team)
 */
export async function POST(request: Request) {
  try {
    const { user, supabase } = await getAuthenticatedUser();
    const body = await request.json();

    const fullName = validateRepoFullName(body.repo_full_name);
    const [owner, name] = fullName.split("/");

    // Encrypt custom GitHub PAT if provided
    let tokenFields: Record<string, string | null> = {};
    if (body.custom_access_token) {
      const encrypted = encryptToken(body.custom_access_token);
      tokenFields = {
        custom_github_token: encrypted.ciphertext,
        custom_token_iv: encrypted.iv,
        custom_token_tag: encrypted.tag,
      };
    }

    // Upsert the repo record
    const { data: repo, error } = await supabase
      .from("repos")
      .upsert(
        {
          user_id: user.id,
          github_id: body.github_id || 0,
          full_name: fullName,
          name,
          owner,
          description: body.description || null,
          language: body.language || null,
          stargazers_count: body.stargazers_count || 0,
          forks_count: body.forks_count || 0,
          default_branch: body.default_branch || "main",
          updated_at: new Date().toISOString(),
          ...tokenFields,
        },
        { onConflict: "user_id,full_name" }
      )
      .select()
      .single();

    if (error) throw error;

    // Add caller as owner of the team
    await supabase.from("team_members").upsert(
      {
        repo_full_name: fullName,
        user_id: user.id,
        role: "owner",
      },
      { onConflict: "repo_full_name,user_id" }
    );

    return NextResponse.json({ repo, hasCustomToken: !!body.custom_access_token });
  } catch (error) {
    return handleApiError(error);
  }
}
