/**
 * Persist the user's Google AI key to the server (encrypted) for
 * background webhook use. Fire-and-forget — failure doesn't block the user.
 */
export async function persistAiKeyToServer(apiKey: string): Promise<void> {
  try {
    await fetch("/api/settings/ai-key", {
      method: "POST",
      headers: {
        "x-google-api-key": apiKey,
      },
    });
  } catch {
    // Non-critical: if persistence fails, webhooks just won't have the key
    console.warn("[ai-key] Failed to persist AI key to server");
  }
}
