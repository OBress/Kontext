import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { unauthorizedError } from "./errors";
import { decryptToken } from "./crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

export interface AuthContext {
  user: { id: string; email?: string; githubLogin?: string | null };
  supabase: SupabaseClient;
  githubToken: string | null;
}

function resolveGitHubLoginFromUser(user: {
  user_metadata?: Record<string, unknown>;
  identities?: Array<{ provider?: string; identity_data?: Record<string, unknown> | null }> | null;
}): string | null {
  const metadata = user.user_metadata || {};
  const directKeys = [
    "user_name",
    "preferred_username",
    "login",
    "nickname",
    "nick_name",
  ];

  for (const key of directKeys) {
    const value = metadata[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim().toLowerCase();
    }
  }

  const githubIdentity = (user.identities || []).find(
    (identity) => identity?.provider === "github"
  );
  const identityData = githubIdentity?.identity_data || {};

  for (const key of directKeys) {
    const value = identityData[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim().toLowerCase();
    }
  }

  return null;
}


/**
 * Extract authenticated user from request cookies.
 * Throws ApiError(401) if not authenticated.
 */
export async function getAuthenticatedUser(): Promise<AuthContext> {
  const cookieStore = await cookies();

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Server Component context — safe to ignore
          }
        },
      },
    }
  );

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    throw unauthorizedError();
  }

  // Look up stored GitHub token
  let githubToken: string | null = null;
  try {
    const { data: tokenRow } = await supabase
      .from("user_tokens")
      .select("encrypted_token, token_iv, token_tag, expires_at, refresh_token")
      .eq("user_id", user.id)
      .eq("provider", "github")
      .single();

    if (tokenRow) {
      const isExpired = tokenRow.expires_at && new Date(tokenRow.expires_at) < new Date();

      if (!isExpired) {
        // Token is still valid — use it
        githubToken = decryptToken({
          ciphertext: tokenRow.encrypted_token,
          iv: tokenRow.token_iv,
          tag: tokenRow.token_tag,
        });
      } else if (tokenRow.refresh_token) {
        // Token is expired but we have a refresh token — try auto-refresh
        const refreshed = await refreshGitHubTokenFromDB(
          supabase,
          user.id,
          tokenRow.refresh_token
        );
        if (refreshed) {
          githubToken = refreshed;
        }
      }
    }
  } catch {
    // Token lookup failed — continue without it
  }

  // If no stored token, try to get from current session (works right after login)
  if (!githubToken) {
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      if (sessionData?.session?.provider_token) {
        githubToken = sessionData.session.provider_token;
        // Store both tokens for future use
        const refreshToken = sessionData.session.provider_refresh_token || null;
        await storeGitHubToken(supabase, user.id, githubToken, refreshToken);
      }
    } catch {
      // Session token extraction failed
    }
  }

  return {
    user: {
      id: user.id,
      email: user.email,
      githubLogin: resolveGitHubLoginFromUser(user),
    },
    supabase,
    githubToken,
  };
}

/**
 * Refresh a GitHub token using a stored (encrypted) refresh token.
 * On success, stores the new tokens and returns the new access token.
 */
async function refreshGitHubTokenFromDB(
  supabase: SupabaseClient,
  userId: string,
  encryptedRefreshToken: string
): Promise<string | null> {
  const clientId = process.env.GITHUB_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GITHUB_OAUTH_SECRET;

  if (!clientId || !clientSecret) {
    console.warn("[auth] GITHUB_OAUTH_CLIENT_ID or GITHUB_OAUTH_SECRET not set — cannot refresh");
    return null;
  }

  // The refresh token is stored as a plain string (encrypted at the column level by Supabase RLS,
  // but we encrypt it ourselves for consistency). We store it encrypted with our own crypto.
  let plainRefreshToken: string;
  try {
    // The refresh token is stored as a JSON blob: {ciphertext, iv, tag}
    const parsed = JSON.parse(encryptedRefreshToken) as { ciphertext: string; iv: string; tag: string };
    plainRefreshToken = decryptToken(parsed);
  } catch {
    // If parsing fails, it might be stored as a plain string (legacy) — try using it directly
    plainRefreshToken = encryptedRefreshToken;
  }

  try {
    const res = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "refresh_token",
        refresh_token: plainRefreshToken,
      }),
    });

    const data = (await res.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      error?: string;
      error_description?: string;
    };

    if (data.error || !data.access_token) {
      console.warn("[auth] GitHub token refresh failed:", data.error, data.error_description);
      return null;
    }

    // Store the new tokens (GitHub rotates refresh tokens)
    const newRefreshToken = data.refresh_token || plainRefreshToken;
    await storeGitHubToken(supabase, userId, data.access_token, newRefreshToken);

    console.log("[auth] GitHub token refreshed successfully");
    return data.access_token;
  } catch (err) {
    console.warn("[auth] GitHub token refresh network error:", err);
    return null;
  }
}

/**
 * Store/update encrypted GitHub token (and optional refresh token) for a user
 */
export async function storeGitHubToken(
  supabase: SupabaseClient,
  userId: string,
  token: string,
  refreshToken?: string | null
): Promise<void> {
  const { encryptToken } = await import("./crypto");
  const encrypted = encryptToken(token);

  // GitHub tokens typically expire in 8 hours
  const expiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString();

  // Encrypt the refresh token as a JSON blob if provided
  let encryptedRefreshToken: string | null = null;
  if (refreshToken) {
    const encRefresh = encryptToken(refreshToken);
    encryptedRefreshToken = JSON.stringify(encRefresh);
  }

  const upsertData: Record<string, unknown> = {
    user_id: userId,
    provider: "github",
    encrypted_token: encrypted.ciphertext,
    token_iv: encrypted.iv,
    token_tag: encrypted.tag,
    expires_at: expiresAt,
    updated_at: new Date().toISOString(),
  };

  // Only overwrite refresh_token if we have a new one
  if (encryptedRefreshToken !== null) {
    upsertData.refresh_token = encryptedRefreshToken;
  }

  await supabase.from("user_tokens").upsert(upsertData, { onConflict: "user_id" });
}

/**
 * Create a Supabase admin client using the service role key.
 * Use sparingly — bypasses RLS.
 */
export async function createAdminClient(): Promise<SupabaseClient> {
  const { createClient } = await import("@supabase/supabase-js");
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}
