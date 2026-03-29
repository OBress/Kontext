import type { SupabaseClient } from "@supabase/supabase-js";

export const REPO_JOB_TYPES = [
  "ingest",
  "sync",
  "repo_check",
  "onboarding_generate",
  "onboarding_assign",
  "architecture_refresh",
] as const;

export type RepoJobType = (typeof REPO_JOB_TYPES)[number];

export const REPO_JOB_TRIGGERS = [
  "manual",
  "webhook",
  "schedule",
  "mcp",
  "system",
  "invite",
  "sync",
] as const;

export type RepoJobTrigger = (typeof REPO_JOB_TRIGGERS)[number];

export const REPO_JOB_STATUSES = [
  "queued",
  "running",
  "completed",
  "failed",
  "skipped",
] as const;

export type RepoJobStatus = (typeof REPO_JOB_STATUSES)[number];

export interface RepoJobRow {
  id: number;
  user_id: string;
  repo_full_name: string;
  job_type: RepoJobType;
  trigger: RepoJobTrigger;
  status: RepoJobStatus;
  title: string | null;
  progress_percent: number;
  dedupe_key: string | null;
  result_summary: string | null;
  metadata: Record<string, unknown>;
  error_message: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
  updated_at: string;
}

interface CreateRepoJobParams {
  userId: string;
  repoFullName: string;
  jobType: RepoJobType;
  trigger?: RepoJobTrigger;
  status?: RepoJobStatus;
  title?: string | null;
  progressPercent?: number;
  dedupeKey?: string | null;
  resultSummary?: string | null;
  metadata?: Record<string, unknown>;
}

interface UpdateRepoJobParams {
  status?: RepoJobStatus;
  title?: string | null;
  progressPercent?: number;
  resultSummary?: string | null;
  metadata?: Record<string, unknown>;
  errorMessage?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
}

function clampProgress(value: number | undefined) {
  if (typeof value !== "number" || Number.isNaN(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

export async function createRepoJob(
  supabase: SupabaseClient,
  params: CreateRepoJobParams
): Promise<RepoJobRow> {
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("repo_jobs")
    .insert({
      user_id: params.userId,
      repo_full_name: params.repoFullName,
      job_type: params.jobType,
      trigger: params.trigger || "manual",
      status: params.status || "queued",
      title: params.title || null,
      progress_percent: clampProgress(params.progressPercent),
      dedupe_key: params.dedupeKey || null,
      result_summary: params.resultSummary || null,
      metadata: params.metadata || {},
      started_at:
        params.status === "running" || params.status === "completed"
          ? now
          : null,
      finished_at: params.status === "completed" ? now : null,
      updated_at: now,
    })
    .select("*")
    .single();

  if (error) throw error;
  return data as RepoJobRow;
}

export async function updateRepoJob(
  supabase: SupabaseClient,
  jobId: number,
  params: UpdateRepoJobParams
): Promise<void> {
  const now = new Date().toISOString();
  const updates: Record<string, unknown> = {
    updated_at: now,
  };

  if (params.status) updates.status = params.status;
  if (params.title !== undefined) updates.title = params.title;
  if (params.progressPercent !== undefined) {
    updates.progress_percent = clampProgress(params.progressPercent);
  }
  if (params.resultSummary !== undefined) {
    updates.result_summary = params.resultSummary;
  }
  if (params.metadata !== undefined) {
    updates.metadata = params.metadata;
  }
  if (params.errorMessage !== undefined) {
    updates.error_message = params.errorMessage;
  }
  if (params.startedAt !== undefined) {
    updates.started_at = params.startedAt;
  } else if (params.status === "running") {
    updates.started_at = now;
  }
  if (params.finishedAt !== undefined) {
    updates.finished_at = params.finishedAt;
  } else if (
    params.status === "completed" ||
    params.status === "failed" ||
    params.status === "skipped"
  ) {
    updates.finished_at = now;
  }

  const { error } = await supabase.from("repo_jobs").update(updates).eq("id", jobId);
  if (error) throw error;
}

export async function completeRepoJob(
  supabase: SupabaseClient,
  jobId: number,
  resultSummary?: string | null,
  metadata?: Record<string, unknown>
) {
  await updateRepoJob(supabase, jobId, {
    status: "completed",
    progressPercent: 100,
    resultSummary: resultSummary || null,
    metadata,
  });
}

export async function failRepoJob(
  supabase: SupabaseClient,
  jobId: number,
  errorMessage: string,
  metadata?: Record<string, unknown>
) {
  await updateRepoJob(supabase, jobId, {
    status: "failed",
    errorMessage,
    metadata,
  });
}
