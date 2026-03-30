"use client";

import { useEffect, useRef } from "react";
import { useAppStore } from "@/lib/store/app-store";
import { persistAiKeyToServer, loadAiKeyFromServer } from "@/lib/client/ai-key-persist";

/**
 * Ensures the user's API key is always synced between client and server.
 *
 * On mount: if no key in localStorage, loads from the server (survives cookie clears).
 * On change: pushes new key to the server for background processes.
 */
export function useAiKeySync() {
  const apiKey = useAppStore((s) => s.apiKey);
  const lastSyncedRef = useRef<string | null>(null);
  const loadedFromServerRef = useRef(false);

  // Pull: restore key from server if localStorage is empty
  useEffect(() => {
    if (loadedFromServerRef.current) return;
    loadedFromServerRef.current = true;

    if (!apiKey) {
      loadAiKeyFromServer();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Push: sync key changes to the server
  useEffect(() => {
    if (!apiKey) return;
    if (lastSyncedRef.current === apiKey) return;

    lastSyncedRef.current = apiKey;

    persistAiKeyToServer(apiKey).then((ok) => {
      if (!ok) {
        lastSyncedRef.current = null;
      }
    });
  }, [apiKey]);
}

