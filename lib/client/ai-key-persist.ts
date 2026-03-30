import { useAppStore } from "@/lib/store/app-store";

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

/**
 * Load the user's stored AI key from the server and populate the Zustand store.
 * Called on app startup to restore the key even after localStorage is cleared.
 */
export async function loadAiKeyFromServer(): Promise<void> {
  try {
    const res = await fetch("/api/settings/ai-key");
    if (!res.ok) return;

    const data = await res.json();
    if (data.key && typeof data.key === "string") {
      const currentKey = useAppStore.getState().apiKey;
      if (!currentKey) {
        useAppStore.getState().setApiKey(data.key);
        console.log("[ai-key] Restored AI key from server");
      }
    }
  } catch {
    // Silent — non-critical
  }
}

