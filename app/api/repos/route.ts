import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser, createAdminClient } from "@/lib/api/auth";
import { rateLimit } from "@/lib/api/rate-limit";
import { handleApiError } from "@/lib/api/errors";
import { validateRepoFullName } from "@/lib/api/validate";
import { fetchUserRepos, registerWebhook } from "@/lib/api/github";
import { encryptToken } from "@/lib/api/crypto";
import { logActivity } from "@/lib/api/activity";
import { backfillRepoActivity } from "@/lib/api/backfill";
import { resolveRepoGitHubToken } from "@/lib/api/repo-auth";

const WEBHOOK_SECRET = process.env.GITHUB_WEBHOOK_SECRET || "";

function serializeRepoRecord(r: Record<string, unknown>) {
  return {
    id: r.github_id as number,
    full_name: r.full_name as string,
    name: r.name as string,
    owner: r.owner as string,
    description: (r.description as string | null) || null,
    language: (r.language as string | null) || null,
    stargazers_count: (r.stargazers_count as number) || 0,
    forks_count: (r.forks_count as number) || 0,
    updated_at: r.updated_at as string,
    indexed: Boolean(r.indexed),
    indexing: Boolean(r.indexing),
    chunk_count: (r.chunk_count as number) || 0,
    last_indexed_at: (r.last_indexed_at as string | null) || null,
    last_synced_sha: (r.last_synced_sha as string | null) || null,
    watched_branch: (r.watched_branch as string | null) || null,
    default_branch: (r.default_branch as string | null) || null,
    auto_sync_enabled: Boolean(r.auto_sync_enabled),
    understanding_tier: (r.understanding_tier as number | null) || 2,
    webhook_id: (r.webhook_id as number | null) || null,
    sync_blocked_reason: (r.sync_blocked_reason as string | null) || null,
    pending_sync_head_sha: (r.pending_sync_head_sha as string | null) || null,
  };
}

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

    const repoParam = request.nextUrl.searchParams.get("repo");

    // Default: return only added repos from Supabase
    let query = supabase
      .from("repos")
      .select("*")
      .eq("user_id", user.id)
      .order("updated_at", { ascending: false });

    if (repoParam) {
      query = query.eq("full_name", validateRepoFullName(repoParam));
    }

    const { data: dbRepos } = await query;
    const repos = (dbRepos || []).map((r) => serializeRepoRecord(r as Record<string, unknown>));

    if (repoParam) {
      const repo = repos[0];
      if (!repo) {
        return NextResponse.json({ error: "Repo not found" }, { status: 404 });
      }
      return NextResponse.json({ repo });
    }

    return NextResponse.json({ repos });
  } catch (error) {
    return handleApiError(error);
  }
}

/**
 * POST /api/repos — Connect/add a repo (upsert into repos + add owner to team)
 *
 * When auto_sync_enabled is true, also registers a GitHub webhook on the repo.
 * If webhook registration fails (e.g. no admin access), the repo is still created
 * but will fall back to polling-based sync.
 */
export async function POST(request: Request) {
  try {
    const { user, supabase, githubToken } = await getAuthenticatedUser();
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
          // Ingestion config fields
          understanding_tier: body.understanding_tier || 2,
          auto_sync_enabled: body.auto_sync_enabled || false,
          watched_branch: body.watched_branch || body.default_branch || "main",
          ...tokenFields,
        },
        { onConflict: "user_id,full_name" }
      )
      .select()
      .single();

    if (error) throw error;

    // Register webhook if auto-sync requested
    let webhookRegistered = false;
    if (body.auto_sync_enabled && WEBHOOK_SECRET) {
      const { token: effectiveToken } = await resolveRepoGitHubToken(
        supabase,
        user.id,
        fullName,
        githubToken
      );

      if (effectiveToken) {
        const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://webhook.yourdomain.com";
        const webhookUrl = `${baseUrl}/api/webhooks/github`;

        try {
          const hookId = await registerWebhook(effectiveToken, owner, name, webhookUrl, WEBHOOK_SECRET);
          const adminDb = await createAdminClient();
          await adminDb
            .from("repos")
            .update({ webhook_id: hookId })
            .eq("user_id", user.id)
            .eq("full_name", fullName);
          webhookRegistered = true;
          console.log(`[repos] Webhook registered for ${fullName} (hook ID: ${hookId})`);
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : "Unknown error";
          console.warn(`[repos] Webhook registration failed for ${fullName} — will use polling fallback: ${message}`);
        }
      }
    }

    // Add caller as owner of the team
    await supabase.from("team_members").upsert(
      {
        repo_full_name: fullName,
        user_id: user.id,
        role: "owner",
      },
      { onConflict: "repo_full_name,user_id" }
    );

    // Log activity event
    logActivity({
      userId: user.id,
      repoFullName: fullName,
      source: "kontext",
      eventType: "repo_added",
      title: `${fullName} was added`,
      description: body.description || undefined,
      metadata: { language: body.language, stars: body.stargazers_count },
    });

    // Backfill recent GitHub activity (fire-and-forget)
    if (githubToken) {
      backfillRepoActivity({
        userId: user.id,
        repoFullName: fullName,
        githubToken,
      });
    }

    return NextResponse.json({ repo, hasCustomToken: !!body.custom_access_token, webhookRegistered });
  } catch (error) {
    return handleApiError(error);
  }
}
