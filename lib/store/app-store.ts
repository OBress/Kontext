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
  isWaiting?: boolean;          // true when pausing for rate-limit cooldown
  lastCompletedBatch?: number;  // for resume-on-retry
  totalBatches?: number;
}

export interface RepoCheckRunState {
  id: number;
  repoFullName: string;
  status: "queued" | "running" | "completed" | "failed" | "skipped";
  triggerMode: "manual" | "after_sync" | "daily" | "mcp";
  summary?: string | null;
  findingsTotal: number;
  newFindings: number;
  resolvedFindings: number;
  unchangedFindings: number;
  headSha?: string | null;
  createdAt: string;
}

export interface RepoHealthSummaryState {
  openCount: number;
  criticalCount: number;
  highCount: number;
  resolvedRecently: number;
  currentHeadSha?: string | null;
  latestCompletedHeadSha?: string | null;
  isCurrent?: boolean;
  latestRun: RepoCheckRunState | null;
}

export interface RepoJobState {
  id: number;
  repoFullName: string;
  jobType:
    | "ingest"
    | "sync"
    | "repo_check"
    | "onboarding_generate"
    | "onboarding_assign"
    | "architecture_refresh";
  trigger:
    | "manual"
    | "webhook"
    | "schedule"
    | "mcp"
    | "system"
    | "invite"
    | "sync";
  status: "queued" | "running" | "completed" | "failed" | "skipped";
  title?: string | null;
  progressPercent: number;
  resultSummary?: string | null;
  errorMessage?: string | null;
  createdAt: string;
  updatedAt: string;
  metadata?: Record<string, unknown>;
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

  // Repo health + checks state
  repoCheckRuns: Record<string, RepoCheckRunState>;
  setRepoCheckRuns: (runs: RepoCheckRunState[]) => void;
  setRepoCheckRun: (repoFullName: string, run: RepoCheckRunState) => void;
  clearRepoCheckRun: (repoFullName: string) => void;
  repoHealthSummaries: Record<string, RepoHealthSummaryState>;
  setRepoHealthSummary: (
    repoFullName: string,
    summary: RepoHealthSummaryState
  ) => void;
  clearRepoHealthSummary: (repoFullName: string) => void;

  // Generic repo job state
  repoJobs: Record<number, RepoJobState>;
  setRepoJobs: (jobs: RepoJobState[]) => void;
  upsertRepoJob: (job: RepoJobState) => void;
  clearRepoJob: (jobId: number) => void;

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
          repoCheckRuns: Object.fromEntries(
            Object.entries(prev.repoCheckRuns).filter(([key]) => key !== fullName)
          ),
          repoHealthSummaries: Object.fromEntries(
            Object.entries(prev.repoHealthSummaries).filter(([key]) => key !== fullName)
          ),
          repoJobs: Object.fromEntries(
            Object.entries(prev.repoJobs).filter(([, job]) => job.repoFullName !== fullName)
          ) as Record<number, RepoJobState>,
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

      repoCheckRuns: {},
      setRepoCheckRuns: (runs) =>
        set(() => {
          const next: Record<string, RepoCheckRunState> = {};
          for (const run of runs) {
            const existing = next[run.repoFullName];
            if (
              !existing ||
              new Date(run.createdAt).getTime() >= new Date(existing.createdAt).getTime()
            ) {
              next[run.repoFullName] = run;
            }
          }
          return { repoCheckRuns: next };
        }),
      setRepoCheckRun: (repoFullName, run) =>
        set((prev) => ({
          repoCheckRuns: {
            ...prev.repoCheckRuns,
            [repoFullName]: run,
          },
        })),
      clearRepoCheckRun: (repoFullName) =>
        set((prev) => {
          const next = { ...prev.repoCheckRuns };
          delete next[repoFullName];
          return { repoCheckRuns: next };
        }),
      repoHealthSummaries: {},
      setRepoHealthSummary: (repoFullName, summary) =>
        set((prev) => ({
          repoHealthSummaries: {
            ...prev.repoHealthSummaries,
            [repoFullName]: summary,
          },
        })),
      clearRepoHealthSummary: (repoFullName) =>
        set((prev) => {
          const next = { ...prev.repoHealthSummaries };
          delete next[repoFullName];
          return { repoHealthSummaries: next };
        }),

      repoJobs: {},
      setRepoJobs: (jobs) =>
        set(() => ({
          repoJobs: Object.fromEntries(jobs.map((job) => [job.id, job])) as Record<
            number,
            RepoJobState
          >,
        })),
      upsertRepoJob: (job) =>
        set((prev) => ({
          repoJobs: {
            ...prev.repoJobs,
            [job.id]: job,
          },
        })),
      clearRepoJob: (jobId) =>
        set((prev) => {
          const next = { ...prev.repoJobs };
          delete next[jobId];
          return { repoJobs: next };
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
