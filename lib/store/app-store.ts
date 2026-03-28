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
  last_indexed_at?: string | null;
  // Sync fields
  last_synced_sha?: string | null;
  watched_branch?: string | null;
  auto_sync_enabled?: boolean;
  understanding_tier?: 1 | 2 | 3;
  webhook_id?: number | null;
  default_branch?: string | null;
  sync_blocked_reason?: string | null;
  pending_sync_head_sha?: string | null;
}

export interface IngestionState {
  status:
    | "idle"
    | "fetching"
    | "chunking"
    | "embedding"
    | "finalizing"
    | "timeline"
    | "blocked_quota"
    | "blocked_billing"
    | "blocked_model"
    | "pending_user_key_sync"
    | "done"
    | "error";
  progress: number; // 0-100
  filesTotal: number;
  filesProcessed: number;
  chunksCreated: number;
  chunksTotal: number;
  message?: string;
  error?: string;
}

export type RepoSortMode = "recent" | "stars" | "name" | "added";

interface AppState {
  // API Key (persisted)
  apiKey: string | null;
  setApiKey: (key: string | null) => void;

  // Active repository
  activeRepo: Repo | null;
  setActiveRepo: (repo: Repo | null) => void;

  // Repository list (only "added" repos)
  repos: Repo[];
  setRepos: (repos: Repo[]) => void;
  addRepo: (repo: Repo) => void;
  updateRepo: (fullName: string, updates: Partial<Repo>) => void;
  removeRepo: (fullName: string) => void;

  // Pinned repos (persisted, max 8)
  pinnedRepos: string[];
  pinRepo: (fullName: string) => void;
  unpinRepo: (fullName: string) => void;
  reorderPinnedRepos: (reordered: string[]) => void;

  // Sort mode (persisted)
  repoSortMode: RepoSortMode;
  setRepoSortMode: (mode: RepoSortMode) => void;

  // Ingestion status per repo (globally tracked for task indicator)
  ingestionStatus: Record<string, IngestionState>;
  setIngestionStatus: (repoFullName: string, state: IngestionState) => void;
  clearIngestionStatus: (repoFullName: string) => void;

  // UI state
  apiKeyModalOpen: boolean;
  setApiKeyModalOpen: (open: boolean) => void;
  addRepoModalOpen: boolean;
  setAddRepoModalOpen: (open: boolean) => void;
  addRepoDefaultUrl: string | null;
  setAddRepoDefaultUrl: (url: string | null) => void;
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
      addRepo: (repo) =>
        set((prev) => {
          // Avoid duplicates
          if (prev.repos.find((r) => r.full_name === repo.full_name)) {
            return prev;
          }
          return { repos: [repo, ...prev.repos] };
        }),
      updateRepo: (fullName, updates) =>
        set((prev) => ({
          repos: prev.repos.map((r) =>
            r.full_name === fullName ? { ...r, ...updates } : r
          ),
        })),
      removeRepo: (fullName) =>
        set((prev) => ({
          repos: prev.repos.filter((r) => r.full_name !== fullName),
          pinnedRepos: prev.pinnedRepos.filter((fn) => fn !== fullName),
        })),

      // Pinned repos
      pinnedRepos: [],
      pinRepo: (fullName) =>
        set((prev) => {
          if (prev.pinnedRepos.length >= 8) return prev;
          if (prev.pinnedRepos.includes(fullName)) return prev;
          return { pinnedRepos: [...prev.pinnedRepos, fullName] };
        }),
      unpinRepo: (fullName) =>
        set((prev) => ({
          pinnedRepos: prev.pinnedRepos.filter((fn) => fn !== fullName),
        })),
      reorderPinnedRepos: (reordered) => set({ pinnedRepos: reordered }),

      // Sort mode
      repoSortMode: "recent" as RepoSortMode,
      setRepoSortMode: (mode) => set({ repoSortMode: mode }),

      ingestionStatus: {},
      setIngestionStatus: (repoFullName, state) =>
        set((prev) => ({
          ingestionStatus: { ...prev.ingestionStatus, [repoFullName]: state },
        })),
      clearIngestionStatus: (repoFullName) =>
        set((prev) => {
          const next = { ...prev.ingestionStatus };
          delete next[repoFullName];
          return { ingestionStatus: next };
        }),

      apiKeyModalOpen: false,
      setApiKeyModalOpen: (open) => set({ apiKeyModalOpen: open }),
      addRepoModalOpen: false,
      setAddRepoModalOpen: (open) => set({ addRepoModalOpen: open }),
      addRepoDefaultUrl: null,
      setAddRepoDefaultUrl: (url) => set({ addRepoDefaultUrl: url }),
    }),
    {
      name: "kontext-app-store",
      partialize: (state) => ({
        apiKey: state.apiKey,
        pinnedRepos: state.pinnedRepos,
        repoSortMode: state.repoSortMode,
      }),
    }
  )
);
