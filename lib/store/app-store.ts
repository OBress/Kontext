"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface Repo {
  id: number;
  full_name: string;
  name: string;
  owner: string;
  description: string | null;
  language: string | null;
  stargazers_count: number;
  forks_count: number;
  updated_at: string;
  indexed: boolean;
  indexing: boolean;
  chunk_count: number;
}

export interface IngestionState {
  status: "idle" | "indexing" | "done" | "error";
  progress: number; // 0-100
  filesTotal: number;
  filesProcessed: number;
  error?: string;
}

interface AppState {
  // API Key (persisted)
  apiKey: string | null;
  setApiKey: (key: string | null) => void;

  // Active repository
  activeRepo: Repo | null;
  setActiveRepo: (repo: Repo | null) => void;

  // Repository list
  repos: Repo[];
  setRepos: (repos: Repo[]) => void;

  // Ingestion status per repo
  ingestionStatus: Record<string, IngestionState>;
  setIngestionStatus: (repoFullName: string, state: IngestionState) => void;

  // UI state
  apiKeyModalOpen: boolean;
  setApiKeyModalOpen: (open: boolean) => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      apiKey: null,
      setApiKey: (key) => set({ apiKey: key }),

      activeRepo: null,
      setActiveRepo: (repo) => set({ activeRepo: repo }),

      repos: [],
      setRepos: (repos) => set({ repos }),

      ingestionStatus: {},
      setIngestionStatus: (repoFullName, state) =>
        set((prev) => ({
          ingestionStatus: { ...prev.ingestionStatus, [repoFullName]: state },
        })),

      apiKeyModalOpen: false,
      setApiKeyModalOpen: (open) => set({ apiKeyModalOpen: open }),
    }),
    {
      name: "kontext-app-store",
      partialize: (state) => ({
        apiKey: state.apiKey,
        activeRepo: state.activeRepo,
      }),
    }
  )
);
