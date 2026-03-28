import { createAdminClient } from "./auth";
import { encryptToken, decryptToken } from "./crypto";

/**
 * Store the user's Google AI API key (encrypted) on the server.
 * This enables background processes (webhooks) to generate AI summaries
 * without the user being online.
 */
export async function storeAiKey(
  userId: string,
  plainKey: string
): Promise<void> {
  const adminDb = await createAdminClient();
  const { ciphertext, iv, tag } = encryptToken(plainKey);

  await adminDb
    .from("user_tokens")
    .update({
      encrypted_ai_key: ciphertext,
      ai_key_iv: iv,
      ai_key_tag: tag,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", userId);
}

/**
 * Resolve the user's stored Google AI API key.
 * Returns null if not stored.
 */
export async function resolveAiKey(userId: string): Promise<string | null> {
  const adminDb = await createAdminClient();

  const { data } = await adminDb
    .from("user_tokens")
    .select("encrypted_ai_key, ai_key_iv, ai_key_tag")
    .eq("user_id", userId)
    .single();

  if (!data?.encrypted_ai_key || !data?.ai_key_iv || !data?.ai_key_tag) {
    return null;
  }

  try {
    return decryptToken({
      ciphertext: data.encrypted_ai_key,
      iv: data.ai_key_iv,
      tag: data.ai_key_tag,
    });
  } catch {
    console.error("[ai-key] Failed to decrypt AI key for user:", userId);
    return null;
  }
}

/**
 * Remove the user's stored AI key.
 */
export async function removeAiKey(userId: string): Promise<void> {
  const adminDb = await createAdminClient();

  await adminDb
    .from("user_tokens")
    .update({
      encrypted_ai_key: null,
      ai_key_iv: null,
      ai_key_tag: null,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", userId);
}
