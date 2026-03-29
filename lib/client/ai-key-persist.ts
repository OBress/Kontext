/**
 * Persist the user's Google AI key to the server (encrypted) for
 * background webhook use. Returns true on success, false on failure.
 */
export async function persistAiKeyToServer(apiKey: string): Promise<boolean> {
  try {
    const res = await fetch("/api/settings/ai-key", {
      method: "POST",
      headers: {
        "x-google-api-key": apiKey,
      },
    });

    if (!res.ok) {
      console.warn(
        `[ai-key] Server rejected AI key persistence: ${res.status} ${res.statusText}`
      );
      return false;
    }

    console.log("[ai-key] AI key persisted to server for background webhook use");
    return true;
  } catch (err) {
    console.warn("[ai-key] Failed to persist AI key to server:", err);
    return false;
  }
}
