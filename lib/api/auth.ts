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
      .select("encrypted_token, token_iv, token_tag, expires_at")
      .eq("user_id", user.id)
      .eq("provider", "github")
      .single();

    if (tokenRow) {
      // Check if expired
      const isExpired = tokenRow.expires_at && new Date(tokenRow.expires_at) < new Date();
      if (!isExpired) {
        githubToken = decryptToken({
          ciphertext: tokenRow.encrypted_token,
          iv: tokenRow.token_iv,
          tag: tokenRow.token_tag,
        });
      }
    }
  } catch {
    // Token lookup failed — continue without it
  }

  // If no stored token, try to get from current session
  if (!githubToken) {
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      if (sessionData?.session?.provider_token) {
        githubToken = sessionData.session.provider_token;
        // Store it for future use
        await storeGitHubToken(supabase, user.id, githubToken);
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
 * Store/update encrypted GitHub token for a user
 */
export async function storeGitHubToken(
  supabase: SupabaseClient,
  userId: string,
  token: string
): Promise<void> {
  const { encryptToken } = await import("./crypto");
  const encrypted = encryptToken(token);

  // GitHub tokens typically expire in 8 hours
  const expiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString();

  await supabase.from("user_tokens").upsert(
    {
      user_id: userId,
      provider: "github",
      encrypted_token: encrypted.ciphertext,
      token_iv: encrypted.iv,
      token_tag: encrypted.tag,
      expires_at: expiresAt,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" }
  );
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
