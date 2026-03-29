import { createAdminClient } from "./auth";

/**
 * Store the user's Google AI API key on the server.
 * Stored as plaintext in user_tokens for reliable retrieval
 * by background processes (webhooks, polling syncs).
 */
export async function storeAiKey(
  userId: string,
  plainKey: string
): Promise<void> {
  const adminDb = await createAdminClient();

  const { error } = await adminDb
    .from("user_tokens")
    .update({
      google_ai_key: plainKey,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", userId);

  if (error) {
    console.error("[ai-key] Failed to store AI key:", error.message);
    throw new Error("Failed to store AI key");
  }

  console.log(`[ai-key] Stored AI key for user ${userId.slice(0, 8)}...`);
}

/**
 * Resolve the user's stored Google AI API key.
 * Returns null if not stored.
 */
export async function resolveAiKey(userId: string): Promise<string | null> {
  const adminDb = await createAdminClient();

  const { data, error } = await adminDb
    .from("user_tokens")
    .select("google_ai_key")
    .eq("user_id", userId)
    .single();

  if (error || !data) {
    console.warn(
      `[ai-key] No user_tokens row for user ${userId.slice(0, 8)}...:`,
      error?.message || "no data"
    );
    return null;
  }

  return data.google_ai_key || null;
}

/**
 * Remove the user's stored AI key.
 */
export async function removeAiKey(userId: string): Promise<void> {
  const adminDb = await createAdminClient();

  await adminDb
    .from("user_tokens")
    .update({
      google_ai_key: null,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", userId);
}
