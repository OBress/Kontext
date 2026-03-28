import type { SupabaseClient } from "@supabase/supabase-js";
import { decryptToken } from "./crypto";

export interface RepoGitHubTokenResolution {
  token: string | null;
  source: "custom_pat" | "oauth" | "none";
}

export async function resolveRepoGitHubToken(
  supabase: SupabaseClient,
  userId: string,
  repoFullName: string,
  fallbackToken: string | null
): Promise<RepoGitHubTokenResolution> {
  const { data: repo } = await supabase
    .from("repos")
    .select("custom_github_token, custom_token_iv, custom_token_tag")
    .eq("user_id", userId)
    .eq("full_name", repoFullName)
    .single();

  if (
    repo?.custom_github_token &&
    repo?.custom_token_iv &&
    repo?.custom_token_tag
  ) {
    try {
      return {
        token: decryptToken({
          ciphertext: repo.custom_github_token,
          iv: repo.custom_token_iv,
          tag: repo.custom_token_tag,
        }),
        source: "custom_pat",
      };
    } catch {
      // Fall through to the fallback token when custom PAT decryption fails.
    }
  }

  if (fallbackToken) {
    return { token: fallbackToken, source: "oauth" };
  }

  return { token: null, source: "none" };
}
