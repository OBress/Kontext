export type RepoCheckType =
  | "security"
  | "optimization"
  | "consistency"
  | "change_impact";

export type RepoCheckTriggerMode = "manual" | "after_sync" | "daily";

export interface RepoCheckConfig {
  id: number;
  check_type: RepoCheckType;
  enabled: boolean;
  trigger_mode: RepoCheckTriggerMode;
  notify_on_high: boolean;
}

export interface RepoCheckRun {
  id: number;
  status: "queued" | "running" | "completed" | "failed" | "skipped";
  trigger_mode: RepoCheckTriggerMode | "mcp";
  summary: string | null;
  findings_total: number;
  new_findings: number;
  resolved_findings: number;
  unchanged_findings: number;
  created_at: string;
  head_sha: string | null;
}

export interface RepoCheckFinding {
  id: number;
  check_type: RepoCheckType;
  title: string;
  summary: string;
  severity: "low" | "medium" | "high" | "critical";
  status: "open" | "resolved";
  transition_state: "new" | "persistent" | "regressed" | "resolved";
  file_path: string | null;
  recommendation: string | null;
  evidence: string | null;
  updated_at: string;
  dismissed_at: string | null;
}

export interface RepoHealthSummary {
  openCount: number;
  criticalCount: number;
  highCount: number;
  resolvedRecently: number;
  currentHeadSha?: string | null;
  latestCompletedHeadSha?: string | null;
  isCurrent?: boolean;
  latestRun?: RepoCheckRun | null;
}

export const CHECK_LABELS: Record<
  RepoCheckType,
  { title: string; description: string }
> = {
  security: {
    title: "Security",
    description:
      "OWASP-style issues, secrets, auth mistakes, and unsafe input handling.",
  },
  optimization: {
    title: "Optimization",
    description:
      "Slow paths, repeated work, bundle bloat, and expensive rendering or data access.",
  },
  consistency: {
    title: "Consistency",
    description:
      "Multiple ways of doing the same job, inconsistent endpoint patterns, and duplicated logic.",
  },
  change_impact: {
    title: "Change Impact",
    description:
      "Likely regressions, incomplete fixes, and follow-up work implied by recent changes.",
  },
};

export const TRIGGER_MODE_LABELS: Record<RepoCheckTriggerMode | "mcp", string> = {
  manual: "Manual only",
  after_sync: "After sync",
  daily: "Daily",
  mcp: "MCP",
};

export const RUN_STATUS_LABELS: Record<RepoCheckRun["status"], string> = {
  queued: "Queued",
  running: "Running",
  completed: "Completed",
  failed: "Failed",
  skipped: "Skipped",
};
