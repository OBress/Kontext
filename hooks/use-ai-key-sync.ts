"use client";

import { useEffect, useRef } from "react";
import { useAppStore } from "@/lib/store/app-store";
import { persistAiKeyToServer } from "@/lib/client/ai-key-persist";

/**
 * Ensures the user's API key (from localStorage) is always synced to the
 * server so background processes (webhooks, polling) can use it.
 *
 * Runs once on mount and again whenever the API key changes.
 * This closes the gap where `persistAiKeyToServer` silently fails or the
 * user sets a key on one device but uses another.
 */
export function useAiKeySync() {
  const apiKey = useAppStore((s) => s.apiKey);
  const lastSyncedRef = useRef<string | null>(null);

  useEffect(() => {
    // Nothing to sync
    if (!apiKey) return;

    // Already synced this exact key in this session
    if (lastSyncedRef.current === apiKey) return;

    // Mark it immediately to avoid duplicate calls during re-renders
    lastSyncedRef.current = apiKey;

    persistAiKeyToServer(apiKey).then((ok) => {
      if (!ok) {
        // Reset so we retry on next render
        lastSyncedRef.current = null;
      }
    });
  }, [apiKey]);
}
