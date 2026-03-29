import { createHash } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "./auth";
import { resolveAiKey } from "./ai-key";
import { ApiError } from "./errors";
import { generateText } from "./embeddings";
import { buildFileManifest } from "./repo-intelligence";
import { stripChunkFileHeader } from "@/lib/code";
import { logActivity } from "./activity";
import {
  completeRepoJob,
  createRepoJob,
  failRepoJob,
  updateRepoJob,
} from "./repo-jobs";

export const REPO_CHECK_TYPES = [
  "security",
  "optimization",
  "consistency",
  "change_impact",
] as const;

export type RepoCheckType = (typeof REPO_CHECK_TYPES)[number];

export const REPO_CHECK_TRIGGER_MODES = [
  "manual",
  "after_sync",
  "daily",
  "mcp",
] as const;

export type RepoCheckTriggerMode = (typeof REPO_CHECK_TRIGGER_MODES)[number];

export interface RepoCheckConfigRow {
  id: number;
  user_id: string;
  repo_full_name: string;
  check_type: RepoCheckType;
  enabled: boolean;
  trigger_mode: Exclude<RepoCheckTriggerMode, "mcp">;
  notify_on_high: boolean;
  created_at: string;
  updated_at: string;
}

export interface RepoHealthSummary {
  openCount: number;
  criticalCount: number;
  highCount: number;
  resolvedRecently: number;
  latestRun: {
    id: number;
    status: string;
    trigger_mode: RepoCheckTriggerMode;
    summary: string | null;
    created_at: string;
    head_sha: string | null;
    findings_total: number;
    new_findings: number;
    resolved_findings: number;
    unchanged_findings: number;
  } | null;
  byType: Record<
    RepoCheckType,
    { open: number; critical: number; high: number; resolvedRecently: number }
  >;
}

interface RepoCheckModelFinding {
  fingerprint_key?: string;
  title?: string;
  summary?: string;
  severity?: string;
  confidence?: number;
  category?: string;
  file_path?: string;
  symbol?: string;
  evidence?: string;
  recommendation?: string;
  related_files?: string[];
}

interface RepoCheckModelLane {
  summary?: string;
  findings?: RepoCheckModelFinding[];
}

interface RepoCheckModelResponse {
  overall_summary?: string;
  checks?: Partial<Record<RepoCheckType, RepoCheckModelLane>>;
}

interface RepoCheckRunRow {
  id: number;
  created_at: string;
  status: string;
  trigger_mode: RepoCheckTriggerMode;
  summary: string | null;
  head_sha: string | null;
  findings_total: number;
  new_findings: number;
  resolved_findings: number;
  unchanged_findings: number;
}

interface RepoCheckFindingRow {
  id: number;
  check_type: RepoCheckType;
  fingerprint: string;
  status: "open" | "resolved";
  transition_state: "new" | "persistent" | "regressed" | "resolved";
}

interface ChangedFileInput {
  filename?: string;
  path?: string;
  status?: string;
  additions?: number;
  deletions?: number;
  previous_filename?: string;
}

interface RunRepoChecksParams {
  userId: string;
  repoFullName: string;
  apiKey?: string | null;
  triggerMode?: RepoCheckTriggerMode;
  requestedCheckTypes?: RepoCheckType[];
  headSha?: string | null;
  baseSha?: string | null;
  changedFiles?: ChangedFileInput[];
  dedupeKey?: string | null;
  supabase?: SupabaseClient;
}

function clampConfidence(value: number | undefined): number {
  if (typeof value !== "number" || Number.isNaN(value)) return 0.55;
  return Math.max(0, Math.min(1, value));
}

function normalizeSeverity(value: string | undefined): "low" | "medium" | "high" | "critical" {
  switch ((value || "").toLowerCase()) {
    case "low":
    case "medium":
    case "high":
    case "critical":
      return value!.toLowerCase() as "low" | "medium" | "high" | "critical";
    default:
      return "medium";
  }
}

function isRepoCheckType(value: string): value is RepoCheckType {
  return (REPO_CHECK_TYPES as readonly string[]).includes(value);
}

function normalizeCheckTypes(values: unknown): RepoCheckType[] {
  if (!Array.isArray(values)) return [];
  return values
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim())
    .filter(isRepoCheckType);
}

function normalizeChangedFiles(changedFiles: ChangedFileInput[] | undefined): Array<{
  path: string;
  status: string;
  additions?: number;
  deletions?: number;
}> {
  return (changedFiles || [])
    .map((file) => ({
      path: typeof file.filename === "string" ? file.filename : typeof file.path === "string" ? file.path : "",
      status: file.status || "modified",
      additions: file.additions,
      deletions: file.deletions,
    }))
    .filter((file) => file.path);
}

function truncate(text: string, maxLength: number) {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}\n... [truncated]`;
}

function stripJsonFence(text: string) {
  return text
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
}

function extractJsonText(text: string): string {
  const stripped = stripJsonFence(text);
  if (stripped.startsWith("{") || stripped.startsWith("[")) {
    return stripped;
  }

  const objectStart = stripped.indexOf("{");
  const objectEnd = stripped.lastIndexOf("}");
  if (objectStart !== -1 && objectEnd > objectStart) {
    return stripped.slice(objectStart, objectEnd + 1);
  }

  const arrayStart = stripped.indexOf("[");
  const arrayEnd = stripped.lastIndexOf("]");
  if (arrayStart !== -1 && arrayEnd > arrayStart) {
    return stripped.slice(arrayStart, arrayEnd + 1);
  }

  throw new ApiError(502, "AI_PARSE_ERROR", "Repo checks response was not valid JSON.");
}

function parseRepoCheckResponse(text: string): RepoCheckModelResponse {
  const parsed = JSON.parse(extractJsonText(text)) as RepoCheckModelResponse;
  if (!parsed || typeof parsed !== "object") {
    throw new ApiError(502, "AI_PARSE_ERROR", "Repo checks response was empty.");
  }
  return parsed;
}

function buildFingerprint(checkType: RepoCheckType, finding: RepoCheckModelFinding): string {
  const stableKey = [
    checkType,
    (finding.fingerprint_key || "").trim().toLowerCase(),
    (finding.file_path || "").trim().toLowerCase(),
    (finding.symbol || "").trim().toLowerCase(),
    (finding.category || "").trim().toLowerCase(),
    (finding.title || "").trim().toLowerCase(),
  ]
    .filter(Boolean)
    .join("::");

  return createHash("sha256").update(stableKey).digest("hex");
}

function getLanePromptLabel(checkType: RepoCheckType) {
  switch (checkType) {
    case "security":
      return "Security issues such as unsafe input handling, secrets, auth/permission mistakes, and OWASP-style weaknesses.";
    case "optimization":
      return "Optimization issues such as repeated work, slow paths, unnecessary client cost, bundle bloat, or expensive queries.";
    case "consistency":
      return "Consistency issues such as multiple patterns for the same responsibility, inconsistent endpoint or data-access styles, and duplicated logic.";
    case "change_impact":
      return "Change-impact issues such as risky side effects, likely regressions, missing tests, or follow-up work implied by the change.";
    default:
      return "Actionable engineering issues.";
  }
}

export function getDefaultRepoCheckConfigs(
  userId: string,
  repoFullName: string
): Array<Pick<RepoCheckConfigRow, "user_id" | "repo_full_name" | "check_type" | "enabled" | "trigger_mode" | "notify_on_high">> {
  return REPO_CHECK_TYPES.map((checkType) => ({
    user_id: userId,
    repo_full_name: repoFullName,
    check_type: checkType,
    enabled: true,
    trigger_mode: "after_sync" as const,
    notify_on_high: true,
  }));
}

export async function ensureRepoCheckConfigs(
  supabase: SupabaseClient,
  userId: string,
  repoFullName: string
): Promise<RepoCheckConfigRow[]> {
  const defaults = getDefaultRepoCheckConfigs(userId, repoFullName);
  await supabase.from("repo_check_configs").upsert(defaults, {
    onConflict: "user_id,repo_full_name,check_type",
    ignoreDuplicates: true,
  });

  const { data, error } = await supabase
    .from("repo_check_configs")
    .select("*")
    .eq("user_id", userId)
    .eq("repo_full_name", repoFullName)
    .order("check_type", { ascending: true });

  if (error) throw error;
  return ((data || []) as RepoCheckConfigRow[]).sort(
    (a, b) => REPO_CHECK_TYPES.indexOf(a.check_type) - REPO_CHECK_TYPES.indexOf(b.check_type)
  );
}

async function collectCandidatePaths(
  supabase: SupabaseClient,
  userId: string,
  repoFullName: string,
  changedFiles: Array<{ path: string; status: string }>
) {
  const candidatePaths = new Set<string>();

  for (const file of changedFiles) {
    if (file.status !== "removed") {
      candidatePaths.add(file.path);
    }
  }

  if (candidatePaths.size === 0) {
    const { data: recentCommits } = await supabase
      .from("repo_commits")
      .select("files_changed")
      .eq("user_id", userId)
      .eq("repo_full_name", repoFullName)
      .order("committed_at", { ascending: false })
      .limit(5);

    for (const commit of recentCommits || []) {
      const filesChanged = Array.isArray(commit.files_changed) ? commit.files_changed : [];
      for (const file of filesChanged) {
        const record = file as Record<string, unknown>;
        const path = typeof record.path === "string" ? record.path : null;
        const status = typeof record.status === "string" ? record.status : "modified";
        if (path && status !== "removed") {
          candidatePaths.add(path);
        }
      }
    }
  }

  if (candidatePaths.size === 0) {
    const { data: repoFiles } = await supabase
      .from("repo_files")
      .select("file_path")
      .eq("user_id", userId)
      .eq("repo_full_name", repoFullName)
      .order("line_count", { ascending: false })
      .limit(8);

    for (const file of repoFiles || []) {
      if (file.file_path) candidatePaths.add(file.file_path);
    }
  }

  return [...candidatePaths].slice(0, 8);
}

async function loadRepoCheckContext(params: {
  supabase: SupabaseClient;
  userId: string;
  repoFullName: string;
  changedFiles: Array<{ path: string; status: string; additions?: number; deletions?: number }>;
}) {
  const candidatePaths = await collectCandidatePaths(
    params.supabase,
    params.userId,
    params.repoFullName,
    params.changedFiles
  );

  const { data: repoFiles } = await params.supabase
    .from("repo_files")
    .select("file_path")
    .eq("user_id", params.userId)
    .eq("repo_full_name", params.repoFullName)
    .order("file_path", { ascending: true });

  const manifest = buildFileManifest(
    (repoFiles || []).map((file) => file.file_path),
    candidatePaths
  );

  const { data: chunks } =
    candidatePaths.length === 0
      ? { data: [] as Array<{ file_path: string; chunk_index: number; content: string }> }
      : await params.supabase
          .from("repo_chunks")
          .select("file_path, chunk_index, content")
          .eq("user_id", params.userId)
          .eq("repo_full_name", params.repoFullName)
          .in("file_path", candidatePaths)
          .order("file_path", { ascending: true })
          .order("chunk_index", { ascending: true });

  const contentByPath = new Map<string, string[]>();
  for (const chunk of chunks || []) {
    const existing = contentByPath.get(chunk.file_path) || [];
    existing.push(stripChunkFileHeader(chunk.content));
    contentByPath.set(chunk.file_path, existing);
  }

  const fileBlocks = candidatePaths
    .map((filePath) => {
      const content = (contentByPath.get(filePath) || []).join("\n");
      if (!content.trim()) return null;
      return `### ${filePath}\n\`\`\`\n${truncate(content, 2600)}\n\`\`\``;
    })
    .filter((value): value is string => Boolean(value))
    .join("\n\n");

  const { data: recentCommits } = await params.supabase
    .from("repo_commits")
    .select("sha, message, ai_summary, committed_at")
    .eq("user_id", params.userId)
    .eq("repo_full_name", params.repoFullName)
    .order("committed_at", { ascending: false })
    .limit(4);

  const recentCommitSummary = (recentCommits || [])
    .map((commit) => {
      const summary = commit.ai_summary || commit.message.split("\n")[0];
      return `- ${commit.sha.slice(0, 7)} (${new Date(commit.committed_at).toISOString().split("T")[0]}): ${summary}`;
    })
    .join("\n");

  const { data: openFindings } = await params.supabase
    .from("repo_check_findings")
    .select("check_type, title, file_path, severity")
    .eq("user_id", params.userId)
    .eq("repo_full_name", params.repoFullName)
    .eq("status", "open")
    .order("updated_at", { ascending: false })
    .limit(12);

  const openFindingSummary = (openFindings || [])
    .map((finding) => `- [${finding.check_type}] ${finding.title}${finding.file_path ? ` (${finding.file_path})` : ""} [${finding.severity}]`)
    .join("\n");

  return {
    manifest,
    fileBlocks,
    candidatePaths,
    recentCommitSummary,
    openFindingSummary,
  };
}

function buildRepoCheckPrompt(params: {
  repoFullName: string;
  triggerMode: RepoCheckTriggerMode;
  baseSha: string | null;
  headSha: string | null;
  checkTypes: RepoCheckType[];
  changedFiles: Array<{ path: string; status: string; additions?: number; deletions?: number }>;
  manifest: string;
  fileBlocks: string;
  recentCommitSummary: string;
  openFindingSummary: string;
}) {
  const lanes = params.checkTypes
    .map((checkType) => `- ${checkType}: ${getLanePromptLabel(checkType)}`)
    .join("\n");

  const changeList =
    params.changedFiles.length === 0
      ? "No explicit changed-file list was supplied. Use the available file context and recent commits."
      : params.changedFiles
          .slice(0, 25)
          .map((file) => {
            const additions = typeof file.additions === "number" ? ` +${file.additions}` : "";
            const deletions = typeof file.deletions === "number" ? ` -${file.deletions}` : "";
            return `- ${file.path} [${file.status}]${additions}${deletions}`;
          })
          .join("\n");

  return `Analyze the repository "${params.repoFullName}" after a code update.

Trigger mode: ${params.triggerMode}
Base SHA: ${params.baseSha || "unknown"}
Head SHA: ${params.headSha || "unknown"}

Enabled analysis lanes:
${lanes}

Changed files:
${changeList}

Open findings from previous runs:
${params.openFindingSummary || "None"}

Recent commit context:
${params.recentCommitSummary || "No recent commits were available."}

Repository manifest:
${params.manifest}

Current file context:
${params.fileBlocks || "No file content was available. Use the manifest and commit context only."}

Return STRICT JSON only with this shape:
{
  "overall_summary": "1-3 sentence summary",
  "checks": {
    "security": {
      "summary": "short summary for this lane",
      "findings": [
        {
          "fingerprint_key": "stable-kebab-case-issue-key",
          "title": "short issue title",
          "summary": "what is wrong and why it matters",
          "severity": "low|medium|high|critical",
          "confidence": 0.0,
          "category": "short category",
          "file_path": "path/to/file",
          "symbol": "optional function or component name",
          "evidence": "brief code evidence",
          "recommendation": "specific fix direction",
          "related_files": ["optional/other/file.ts"]
        }
      ]
    }
  }
}

Rules:
- Only include lanes that were requested.
- Keep findings actionable and code-specific.
- Prefer 0 findings over weak speculation.
- Cap each lane at 5 findings.
- Use stable fingerprint keys so the same issue can be tracked across commits.
- For consistency, call out duplicate patterns, inconsistent endpoint shapes, mixed data-access conventions, or multiple ways of doing the same job.
- For change_impact, focus on likely regressions, incomplete fixes, or missing follow-up work caused by this change.`;
}

async function persistRepoCheckFindings(params: {
  supabase: SupabaseClient;
  userId: string;
  repoFullName: string;
  runId: number;
  headSha: string | null;
  requestedCheckTypes: RepoCheckType[];
  response: RepoCheckModelResponse;
}) {
  const { data: existingRows } = await params.supabase
    .from("repo_check_findings")
    .select("id, check_type, fingerprint, status, transition_state")
    .eq("user_id", params.userId)
    .eq("repo_full_name", params.repoFullName)
    .in("check_type", params.requestedCheckTypes);

  const existingByKey = new Map<string, RepoCheckFindingRow>();
  for (const row of (existingRows || []) as RepoCheckFindingRow[]) {
    existingByKey.set(`${row.check_type}:${row.fingerprint}`, row);
  }

  const seenKeys = new Set<string>();
  let findingsTotal = 0;
  let newFindings = 0;
  let resolvedFindings = 0;
  let unchangedFindings = 0;

  for (const checkType of params.requestedCheckTypes) {
    const lane = params.response.checks?.[checkType];
    const findings = Array.isArray(lane?.findings) ? lane!.findings! : [];

    for (const finding of findings) {
      const title = (finding.title || "").trim();
      const summary = (finding.summary || "").trim();
      if (!title || !summary) continue;

      const fingerprint = buildFingerprint(checkType, finding);
      const key = `${checkType}:${fingerprint}`;
      seenKeys.add(key);
      findingsTotal += 1;

      const existing = existingByKey.get(key);
      let transitionState: "new" | "persistent" | "regressed" = "new";

      if (existing?.status === "open") {
        transitionState = "persistent";
        unchangedFindings += 1;
      } else if (existing?.status === "resolved") {
        transitionState = "regressed";
        newFindings += 1;
      } else {
        transitionState = "new";
        newFindings += 1;
      }

      await params.supabase.from("repo_check_findings").upsert(
        {
          user_id: params.userId,
          repo_full_name: params.repoFullName,
          check_type: checkType,
          fingerprint,
          title,
          summary,
          severity: normalizeSeverity(finding.severity),
          status: "open",
          transition_state: transitionState,
          confidence: clampConfidence(finding.confidence),
          category: finding.category?.trim() || null,
          file_path: finding.file_path?.trim() || null,
          symbol: finding.symbol?.trim() || null,
          evidence: finding.evidence?.trim() || null,
          recommendation: finding.recommendation?.trim() || null,
          related_files: Array.isArray(finding.related_files) ? finding.related_files.filter(Boolean) : [],
          metadata: {
            fingerprint_key: finding.fingerprint_key || null,
            lane_summary: lane?.summary || null,
          },
          first_seen_sha:
            existing && existing.status !== "resolved" ? undefined : params.headSha,
          last_seen_sha: params.headSha,
          fixed_in_sha: null,
          last_seen_at: new Date().toISOString(),
          resolved_at: null,
          opened_in_run_id: existing ? undefined : params.runId,
          last_run_id: params.runId,
          fixed_in_run_id: null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id,repo_full_name,check_type,fingerprint" }
      );
    }
  }

  for (const row of (existingRows || []) as RepoCheckFindingRow[]) {
    const key = `${row.check_type}:${row.fingerprint}`;
    if (row.status === "open" && !seenKeys.has(key)) {
      resolvedFindings += 1;
      await params.supabase
        .from("repo_check_findings")
        .update({
          status: "resolved",
          transition_state: "resolved",
          fixed_in_sha: params.headSha,
          resolved_at: new Date().toISOString(),
          last_run_id: params.runId,
          fixed_in_run_id: params.runId,
          updated_at: new Date().toISOString(),
        })
        .eq("id", row.id);
    }
  }

  return { findingsTotal, newFindings, resolvedFindings, unchangedFindings };
}

export async function getRepoHealthSummary(
  supabase: SupabaseClient,
  userId: string,
  repoFullName: string
): Promise<RepoHealthSummary> {
  const { data: findings } = await supabase
    .from("repo_check_findings")
    .select("check_type, severity, status, transition_state")
    .eq("user_id", userId)
    .eq("repo_full_name", repoFullName);

  const byType = Object.fromEntries(
    REPO_CHECK_TYPES.map((checkType) => [
      checkType,
      { open: 0, critical: 0, high: 0, resolvedRecently: 0 },
    ])
  ) as RepoHealthSummary["byType"];

  let openCount = 0;
  let criticalCount = 0;
  let highCount = 0;
  let resolvedRecently = 0;

  for (const finding of findings || []) {
    const checkType = finding.check_type as RepoCheckType;
    if (!isRepoCheckType(checkType)) continue;

    if (finding.status === "open") {
      openCount += 1;
      byType[checkType].open += 1;
      if (finding.severity === "critical") {
        criticalCount += 1;
        byType[checkType].critical += 1;
      }
      if (finding.severity === "high" || finding.severity === "critical") {
        highCount += 1;
        byType[checkType].high += 1;
      }
    }

    if (finding.transition_state === "resolved") {
      resolvedRecently += 1;
      byType[checkType].resolvedRecently += 1;
    }
  }

  const { data: latestRun } = await supabase
    .from("repo_check_runs")
    .select("id, created_at, status, trigger_mode, summary, head_sha, findings_total, new_findings, resolved_findings, unchanged_findings")
    .eq("user_id", userId)
    .eq("repo_full_name", repoFullName)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return {
    openCount,
    criticalCount,
    highCount,
    resolvedRecently,
    latestRun: (latestRun as RepoCheckRunRow | null) || null,
    byType,
  };
}

export async function runRepoChecks(params: RunRepoChecksParams) {
  const supabase = params.supabase || (await createAdminClient());
  const requestedCheckTypes = normalizeCheckTypes(params.requestedCheckTypes || []);
  const normalizedChangedFiles = normalizeChangedFiles(params.changedFiles);
  const triggerMode = params.triggerMode || "manual";
  const availableConfigs = await ensureRepoCheckConfigs(
    supabase,
    params.userId,
    params.repoFullName
  );

  const effectiveCheckTypes =
    requestedCheckTypes.length > 0
      ? requestedCheckTypes
      : availableConfigs
          .filter((config) =>
            config.enabled &&
            (triggerMode === "manual" || triggerMode === "mcp"
              ? true
              : config.trigger_mode === triggerMode)
          )
          .map((config) => config.check_type);

  if (effectiveCheckTypes.length === 0) {
    return { skipped: true, reason: "No enabled checks for this trigger." };
  }

  const apiKey = params.apiKey || (await resolveAiKey(params.userId));
  if (!apiKey) {
    throw new ApiError(
      400,
      "API_KEY_REQUIRED",
      "A stored Google AI key or x-google-api-key header is required to run repo checks."
    );
  }

  const dedupeKey =
    params.dedupeKey ||
    (params.headSha
      ? `${params.repoFullName}:${triggerMode}:${params.headSha}:${effectiveCheckTypes.join(",")}`
      : null);

  let runId: number;
  let repoJobId: number | null = null;
  try {
    const { data: run, error } = await supabase
      .from("repo_check_runs")
      .insert({
        user_id: params.userId,
        repo_full_name: params.repoFullName,
        trigger_mode: triggerMode,
        status: "running",
        dedupe_key: dedupeKey,
        requested_check_types: effectiveCheckTypes,
        changed_files: normalizedChangedFiles,
        base_sha: params.baseSha || null,
        head_sha: params.headSha || null,
        started_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    if (error) throw error;
    runId = run.id;

    const repoJob = await createRepoJob(supabase, {
      userId: params.userId,
      repoFullName: params.repoFullName,
      jobType: "repo_check",
      trigger:
        triggerMode === "after_sync"
          ? "sync"
          : triggerMode === "daily"
            ? "schedule"
            : triggerMode,
      status: "running",
      title: "Running repo health checks",
      progressPercent: 20,
      metadata: {
        run_id: runId,
        trigger_mode: triggerMode,
        requested_check_types: effectiveCheckTypes,
        head_sha: params.headSha || null,
      },
    });

    repoJobId = repoJob.id;
  } catch (error: unknown) {
    const duplicate = error as { code?: string };
    if (duplicate?.code !== "23505") {
      throw error;
    }

    const { data: existing } = await supabase
      .from("repo_check_runs")
      .select("id, status")
      .eq("user_id", params.userId)
      .eq("dedupe_key", dedupeKey)
      .maybeSingle();

    return { skipped: true, reason: `Check run already ${existing?.status || "exists"}.`, runId: existing?.id || null };
  }

  try {
    const context = await loadRepoCheckContext({
      supabase,
      userId: params.userId,
      repoFullName: params.repoFullName,
      changedFiles: normalizedChangedFiles,
    });

    if (!context.fileBlocks && context.candidatePaths.length === 0 && normalizedChangedFiles.length === 0) {
      await supabase
        .from("repo_check_runs")
        .update({
          status: "skipped",
          summary: "No indexed context was available for analysis.",
          finished_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", runId);

      if (repoJobId) {
        await updateRepoJob(supabase, repoJobId, {
          status: "skipped",
          progressPercent: 100,
          resultSummary: "Skipped repo health checks because no indexed context was available.",
        });
      }

      return { skipped: true, runId, reason: "No indexed context was available." };
    }

    if (repoJobId) {
      await updateRepoJob(supabase, repoJobId, {
        progressPercent: 55,
        title: "Analyzing repo health",
      });
    }

    const responseText = await generateText(
      apiKey,
      buildRepoCheckPrompt({
        repoFullName: params.repoFullName,
        triggerMode,
        baseSha: params.baseSha || null,
        headSha: params.headSha || null,
        checkTypes: effectiveCheckTypes,
        changedFiles: normalizedChangedFiles,
        manifest: context.manifest,
        fileBlocks: context.fileBlocks,
        recentCommitSummary: context.recentCommitSummary,
        openFindingSummary: context.openFindingSummary,
      }),
      "You are Kontext Repo Health. Return strict JSON only. Be precise, skeptical, and action-oriented."
    );

    const parsed = parseRepoCheckResponse(responseText);
    const counts = await persistRepoCheckFindings({
      supabase,
      userId: params.userId,
      repoFullName: params.repoFullName,
      runId,
      headSha: params.headSha || null,
      requestedCheckTypes: effectiveCheckTypes,
      response: parsed,
    });

    await supabase
      .from("repo_check_runs")
      .update({
        status: "completed",
        summary: parsed.overall_summary || null,
        findings_total: counts.findingsTotal,
        new_findings: counts.newFindings,
        resolved_findings: counts.resolvedFindings,
        unchanged_findings: counts.unchangedFindings,
        finished_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", runId);

    if (repoJobId) {
      await completeRepoJob(
        supabase,
        repoJobId,
        parsed.overall_summary || null,
        {
          run_id: runId,
          findings_total: counts.findingsTotal,
          new_findings: counts.newFindings,
          resolved_findings: counts.resolvedFindings,
        }
      );
    }

    await logActivity({
      userId: params.userId,
      repoFullName: params.repoFullName,
      source: "kontext",
      eventType: "repo_check_completed",
      title: `${params.repoFullName} health check completed`,
      description: `${counts.newFindings} new, ${counts.resolvedFindings} resolved, ${counts.findingsTotal} current findings`,
      metadata: {
        run_id: runId,
        trigger_mode: triggerMode,
        head_sha: params.headSha || null,
        check_types: effectiveCheckTypes,
        findings_total: counts.findingsTotal,
        new_findings: counts.newFindings,
        resolved_findings: counts.resolvedFindings,
      },
    });

    return {
      skipped: false,
      runId,
      summary: parsed.overall_summary || null,
      ...counts,
    };
  } catch (error: unknown) {
    await supabase
      .from("repo_check_runs")
      .update({
        status: "failed",
        error_message: error instanceof Error ? error.message : "Repo check failed.",
        finished_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", runId);

    if (repoJobId) {
      await failRepoJob(
        supabase,
        repoJobId,
        error instanceof Error ? error.message : "Repo check failed."
      );
    }
    throw error;
  }
}
