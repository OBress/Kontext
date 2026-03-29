"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronRight,
  ClipboardCopy,
  ExternalLink,
  FileCode,
  Loader2,
  Settings2,
  Shield,
  Sparkles,
  X,
  Zap,
} from "lucide-react";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { atomDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import { GlowCard } from "@/app/components/shared/GlowCard";
import { detectCodeLanguage } from "@/lib/code";
import {
  RepoHealthSummaryState,
  useAppStore,
} from "@/lib/store/app-store";
import {
  CHECK_LABELS,
  RepoCheckConfig,
  RepoCheckFinding,
  RepoCheckRun,
  RepoHealthSummary,
  RepoCheckType,
  RUN_STATUS_LABELS,
  TRIGGER_MODE_LABELS,
} from "@/app/components/repo/repo-checks-shared";

interface LoadedFile {
  content: string;
  language: string;
  github_url: string | null;
  commit_sha: string | null;
  last_indexed_at?: string | null;
}

interface Notice {
  tone: "success" | "error" | "info";
  text: string;
}

type SeverityFilter = RepoCheckFinding["severity"] | "all";
type CheckTypeFilter = RepoCheckType | "all";

const severityPriority: Record<RepoCheckFinding["severity"], number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

const transitionPriority: Record<RepoCheckFinding["transition_state"], number> = {
  regressed: 0,
  new: 1,
  persistent: 2,
  resolved: 3,
};

async function fetchJson<T>(url: string, fallbackError: string): Promise<T> {
  const res = await fetch(url);
  const payload = (await res.json().catch(() => null)) as
    | (T & { error?: string; message?: string })
    | null;

  if (!res.ok) {
    throw new Error(payload?.error || payload?.message || fallbackError);
  }

  return (payload || {}) as T;
}

function SeverityBadge({
  severity,
}: {
  severity: RepoCheckFinding["severity"];
}) {
  const tone =
    severity === "critical"
      ? "border-red-500/30 bg-red-500/10 text-red-300"
      : severity === "high"
        ? "border-amber-500/30 bg-amber-500/10 text-amber-300"
        : severity === "medium"
          ? "border-blue-500/30 bg-blue-500/10 text-blue-300"
          : "border-[var(--alpha-white-10)] bg-[var(--alpha-white-5)] text-[var(--gray-400)]";

  return (
    <span className={`rounded-full border px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.12em] ${tone}`}>
      {severity}
    </span>
  );
}

function TriggerBadge({ mode }: { mode: RepoCheckRun["trigger_mode"] }) {
  return (
    <span className="rounded-full border border-[var(--alpha-white-10)] bg-[var(--alpha-white-5)] px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--gray-400)]">
      {TRIGGER_MODE_LABELS[mode]}
    </span>
  );
}

function RunStatusBadge({ status }: { status: RepoCheckRun["status"] }) {
  const tone =
    status === "completed"
      ? "border-[var(--accent-green)]/25 bg-[var(--accent-green)]/10 text-[var(--accent-green)]"
      : status === "running"
        ? "border-blue-500/25 bg-blue-500/10 text-blue-300"
        : status === "failed"
          ? "border-red-500/25 bg-red-500/10 text-red-300"
          : "border-[var(--alpha-white-10)] bg-[var(--alpha-white-5)] text-[var(--gray-400)]";

  return (
    <span className={`rounded-full border px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.12em] ${tone}`}>
      {RUN_STATUS_LABELS[status]}
    </span>
  );
}

function SummaryMetric({
  label,
  value,
  tone,
  hint,
}: {
  label: string;
  value: number | string;
  tone: string;
  hint: string;
}) {
  return (
    <div className="rounded-2xl border border-[var(--alpha-white-8)] bg-[var(--alpha-white-3)] px-4 py-3">
      <p className="m-0 font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--gray-500)]">
        {label}
      </p>
      <p className={`mt-2 font-mono text-2xl ${tone}`}>{value}</p>
      <p className="mt-1 font-mono text-xs text-[var(--gray-500)]">{hint}</p>
    </div>
  );
}

function FilterChip({
  active,
  label,
  count,
  onClick,
}: {
  active: boolean;
  label: string;
  count: number;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 font-mono text-xs transition-colors ${
        active
          ? "border-[var(--accent-green)]/30 bg-[var(--accent-green)]/10 text-[var(--accent-green)]"
          : "border-[var(--alpha-white-10)] bg-[var(--alpha-white-5)] text-[var(--gray-400)] hover:border-[var(--alpha-white-15)] hover:text-[var(--gray-300)]"
      }`}
    >
      <span>{label}</span>
      <span className="text-[10px] text-inherit/80">{count}</span>
    </button>
  );
}

function HeroPill({ label, value }: { label: string; value: number }) {
  return (
    <div className="inline-flex items-center gap-2 rounded-full border border-[var(--alpha-white-10)] bg-[var(--alpha-white-5)] px-3 py-1.5">
      <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--gray-500)]">
        {label}
      </span>
      <span className="font-mono text-xs text-[var(--gray-100)]">{value}</span>
    </div>
  );
}

function RunDeltaTile({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: string;
}) {
  return (
    <div className="rounded-xl border border-[var(--alpha-white-8)] bg-[var(--alpha-white-3)] px-3 py-2">
      <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--gray-500)]">
        {label}
      </p>
      <p className={`mt-1 font-mono text-sm ${tone}`}>{value}</p>
    </div>
  );
}

function HighlightedCode({
  content,
  language,
  showLineNumbers = false,
  startingLineNumber = 1,
  highlightEvidence,
}: {
  content: string;
  language: string;
  showLineNumbers?: boolean;
  startingLineNumber?: number;
  highlightEvidence?: string | null;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  const highlightedLines = useMemo(() => {
    if (!highlightEvidence || !content) return new Set<number>();

    const lines = content.split("\n");
    const evidenceLines = highlightEvidence
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    const nextHighlighted = new Set<number>();

    for (const evidenceLine of evidenceLines) {
      for (let index = 0; index < lines.length; index += 1) {
        if (
          lines[index].includes(evidenceLine) ||
          evidenceLine.includes(lines[index].trim())
        ) {
          for (
            let contextIndex = Math.max(0, index - 1);
            contextIndex <= Math.min(lines.length - 1, index + 1);
            contextIndex += 1
          ) {
            nextHighlighted.add(contextIndex + startingLineNumber);
          }
        }
      }
    }

    return nextHighlighted;
  }, [content, highlightEvidence, startingLineNumber]);

  useEffect(() => {
    if (highlightedLines.size === 0 || !containerRef.current) return;

    const firstLine = Math.min(...highlightedLines);
    const target = containerRef.current.querySelector<HTMLElement>(
      `[data-line-number="${firstLine}"]`
    );
    target?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [content, highlightedLines]);

  return (
    <div ref={containerRef} className="h-full overflow-auto no-scrollbar">
      <SyntaxHighlighter
        style={atomDark}
        language={language}
        PreTag="div"
        showLineNumbers={showLineNumbers}
        startingLineNumber={startingLineNumber}
        wrapLines
        wrapLongLines
        lineProps={(lineNumber: number) => {
          const isHighlighted = highlightedLines.has(lineNumber);

          return {
            "data-line-number": String(lineNumber),
            style: {
              display: "block",
              background: isHighlighted ? "rgba(63, 185, 80, 0.14)" : "transparent",
              borderLeft: isHighlighted
                ? "2px solid rgba(63, 185, 80, 0.9)"
                : "2px solid transparent",
              paddingLeft: isHighlighted ? "0.75rem" : "calc(0.75rem + 2px)",
            },
          };
        }}
        customStyle={{
          margin: 0,
          minHeight: "100%",
          fontSize: "0.78rem",
          background: "transparent",
          padding: "1rem",
        }}
        codeTagProps={{
          style: { fontFamily: "var(--font-mono), ui-monospace, monospace" },
        }}
      >
        {content}
      </SyntaxHighlighter>
    </div>
  );
}

function FindingInspectorModal({
  finding,
  repoFullName,
  onClose,
}: {
  finding: RepoCheckFinding;
  repoFullName: string;
  onClose: () => void;
}) {
  const [fileData, setFileData] = useState<LoadedFile | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!finding.file_path) return;

    const loadFile = async () => {
      setLoading(true);
      setError(null);

      try {
        const search = new URLSearchParams({
          repo: repoFullName,
          path: finding.file_path!,
        });
        const res = await fetch(`/api/repos/file?${search.toString()}`);
        const payload = (await res.json().catch(() => null)) as
          | LoadedFile
          | { error?: { message?: string } }
          | null;

        if (!res.ok) {
          throw new Error(
            (payload as { error?: { message?: string } } | null)?.error?.message ||
              "Unable to load file"
          );
        }

        setFileData(payload as LoadedFile);
      } catch (nextError: unknown) {
        setError(
          nextError instanceof Error ? nextError.message : "Unable to load file"
        );
      } finally {
        setLoading(false);
      }
    };

    void loadFile();
  }, [finding.file_path, repoFullName]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const language = finding.file_path
    ? detectCodeLanguage(finding.file_path)
    : "text";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4 py-6">
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
      />

      <div className="relative flex h-[88vh] max-h-[88vh] w-full max-w-6xl flex-col overflow-hidden rounded-3xl border border-[var(--alpha-white-8)] bg-[var(--surface-0)] shadow-[0_32px_120px_rgba(0,0,0,0.45)]">
        <div className="shrink-0 border-b border-[var(--alpha-white-8)] bg-[radial-gradient(circle_at_top_left,rgba(63,185,80,0.12),transparent_35%),rgba(13,17,23,0.92)] px-6 py-5">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <SeverityBadge severity={finding.severity} />
                <span className="rounded-full border border-[var(--alpha-white-10)] bg-[var(--alpha-white-5)] px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--gray-400)]">
                  {CHECK_LABELS[finding.check_type].title}
                </span>
                <span className="rounded-full border border-[var(--alpha-white-10)] bg-[var(--alpha-white-5)] px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--gray-500)]">
                  {finding.transition_state}
                </span>
              </div>
              <h3 className="mt-4 font-mono text-lg text-[var(--gray-100)]">
                {finding.title}
              </h3>
              <p className="mt-2 font-mono text-sm leading-relaxed text-[var(--gray-400)]">
                {finding.summary}
              </p>
              {finding.recommendation && (
                <p className="mt-3 font-mono text-xs leading-relaxed text-[var(--accent-green)]">
                  Fix direction: {finding.recommendation}
                </p>
              )}
              {finding.file_path && (
                <div className="mt-4 inline-flex max-w-full items-center gap-2 rounded-full border border-[var(--alpha-white-8)] bg-[var(--alpha-white-5)] px-3 py-1.5">
                  <FileCode
                    size={12}
                    className="shrink-0 text-[var(--accent-green)]"
                  />
                  <span className="truncate font-mono text-xs text-[var(--gray-300)]">
                    {finding.file_path}
                  </span>
                </div>
              )}
            </div>

            <div className="flex shrink-0 items-center gap-2">
              {fileData?.github_url && (
                <a
                  href={fileData.github_url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-2 rounded-xl border border-[var(--alpha-white-8)] bg-[var(--alpha-white-5)] px-3 py-2 font-mono text-xs text-[var(--gray-300)] transition-colors hover:border-[var(--accent-green)]/30 hover:text-[var(--accent-green)] no-underline"
                >
                  <ExternalLink size={12} />
                  GitHub
                </a>
              )}
              <button
                onClick={onClose}
                className="rounded-xl border border-[var(--alpha-white-8)] bg-[var(--alpha-white-5)] p-2 text-[var(--gray-400)] transition-colors hover:text-[var(--gray-100)]"
              >
                <X size={14} />
              </button>
            </div>
          </div>
        </div>

        <div className="min-h-0 flex-1 bg-[radial-gradient(circle_at_top,rgba(63,185,80,0.08),transparent_38%),var(--surface-0)]">
          {!finding.file_path && (
            <div className="flex h-full items-center justify-center px-6 text-center">
              <div className="max-w-xl">
                <FileCode size={28} className="mx-auto mb-3 text-[var(--gray-600)]" />
                <p className="m-0 font-mono text-sm text-[var(--gray-300)]">
                  No file reference
                </p>
                <p className="mt-1 font-mono text-xs text-[var(--gray-500)]">
                  This finding does not point to a specific file, so the inspector is
                  showing only the generated evidence.
                </p>
                {finding.evidence && (
                  <div className="mt-4 rounded-2xl border border-[var(--alpha-white-8)] bg-[var(--alpha-white-5)] p-4 text-left">
                    <p className="m-0 font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--gray-500)]">
                      Evidence
                    </p>
                    <pre className="mt-2 whitespace-pre-wrap font-mono text-xs text-[var(--gray-300)]">
                      {finding.evidence}
                    </pre>
                  </div>
                )}
              </div>
            </div>
          )}

          {finding.file_path && loading && (
            <div className="flex h-full items-center justify-center gap-3 font-mono text-xs text-[var(--gray-400)]">
              <Loader2 size={14} className="animate-spin text-[var(--accent-green)]" />
              Loading {finding.file_path}...
            </div>
          )}

          {finding.file_path && error && (
            <div className="flex h-full flex-col items-center justify-center px-6 text-center">
              <p className="mb-3 font-mono text-xs text-red-400">{error}</p>
              {finding.evidence && (
                <div className="w-full max-w-2xl rounded-2xl border border-[var(--alpha-white-8)] bg-[var(--alpha-white-5)] p-4 text-left">
                  <p className="m-0 font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--gray-500)]">
                    Evidence from analysis
                  </p>
                  <pre className="mt-2 whitespace-pre-wrap font-mono text-xs text-[var(--gray-300)]">
                    {finding.evidence}
                  </pre>
                </div>
              )}
            </div>
          )}

          {finding.file_path && fileData && !loading && (
            <HighlightedCode
              content={fileData.content}
              language={language}
              showLineNumbers
              highlightEvidence={finding.evidence}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function AutomationStatusCard({
  configs,
  settingsHref,
}: {
  configs: RepoCheckConfig[];
  settingsHref: string;
}) {
  const enabledCount = configs.filter((config) => config.enabled).length;
  const automatedCount = configs.filter(
    (config) => config.enabled && config.trigger_mode !== "manual"
  ).length;

  return (
    <GlowCard glowColor="none" className="overflow-hidden">
      <div className="border-b border-[var(--alpha-white-8)] px-5 py-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <Sparkles size={15} className="text-[var(--accent-green)]" />
              <h3 className="m-0 font-mono text-sm font-semibold text-[var(--gray-200)]">
                Automation Snapshot
              </h3>
            </div>
            <p className="mt-2 font-mono text-xs leading-relaxed text-[var(--gray-500)]">
              Configuration lives in Settings now, so this page can stay focused on
              triage and investigation.
            </p>
          </div>

          <Link
            href={settingsHref}
            className="inline-flex shrink-0 items-center gap-2 rounded-xl border border-[var(--alpha-white-8)] bg-[var(--alpha-white-5)] px-3 py-2 font-mono text-xs text-[var(--gray-300)] transition-colors hover:border-[var(--accent-green)]/30 hover:text-[var(--accent-green)] no-underline"
          >
            <Settings2 size={12} />
            Settings
          </Link>
        </div>
      </div>

      <div className="space-y-3 p-5">
        <div className="grid grid-cols-2 gap-3">
          <SummaryMetric
            label="Enabled"
            value={enabledCount}
            tone="text-[var(--gray-100)]"
            hint="Active check lanes"
          />
          <SummaryMetric
            label="Auto-run"
            value={automatedCount}
            tone="text-[var(--accent-green)]"
            hint="Runs without manual clicks"
          />
        </div>

        <div className="space-y-2">
          {configs.map((config) => (
            <div
              key={config.check_type}
              className="rounded-2xl border border-[var(--alpha-white-8)] bg-[var(--alpha-white-3)] px-4 py-3"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="m-0 font-mono text-sm text-[var(--gray-200)]">
                    {CHECK_LABELS[config.check_type].title}
                  </p>
                  <p className="mt-1 font-mono text-xs leading-relaxed text-[var(--gray-500)]">
                    {CHECK_LABELS[config.check_type].description}
                  </p>
                </div>

                <div className="shrink-0 text-right">
                  <span
                    className={`rounded-full border px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.12em] ${
                      config.enabled
                        ? "border-[var(--accent-green)]/25 bg-[var(--accent-green)]/10 text-[var(--accent-green)]"
                        : "border-[var(--alpha-white-10)] bg-[var(--alpha-white-5)] text-[var(--gray-500)]"
                    }`}
                  >
                    {config.enabled ? "On" : "Off"}
                  </span>
                  <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--gray-500)]">
                    {config.enabled
                      ? TRIGGER_MODE_LABELS[config.trigger_mode]
                      : "Disabled"}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </GlowCard>
  );
}

function RecentRunsCard({ runs }: { runs: RepoCheckRun[] }) {
  return (
    <GlowCard glowColor="none" className="overflow-hidden">
      <div className="border-b border-[var(--alpha-white-8)] px-5 py-4">
        <div className="flex items-center gap-2">
          <Zap size={15} className="text-[var(--accent-green)]" />
          <h3 className="m-0 font-mono text-sm font-semibold text-[var(--gray-200)]">
            Recent Runs
          </h3>
          <span className="font-mono text-xs text-[var(--gray-500)]">
            ({runs.length})
          </span>
        </div>
      </div>

      <div className="p-5">
        {runs.length === 0 ? (
          <div className="rounded-2xl border border-[var(--alpha-white-8)] bg-[var(--alpha-white-3)] p-4">
            <p className="font-mono text-xs leading-relaxed text-[var(--gray-500)]">
              No automated check history yet. Your next run will show up here with
              a summary and finding deltas.
            </p>
          </div>
        ) : (
          <div className="max-h-[32rem] space-y-3 overflow-y-auto pr-1">
            {runs.map((run) => (
              <div
                key={run.id}
                className="rounded-2xl border border-[var(--alpha-white-8)] bg-[linear-gradient(180deg,rgba(255,255,255,0.035),rgba(255,255,255,0.02))] p-4"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <RunStatusBadge status={run.status} />
                  <TriggerBadge mode={run.trigger_mode} />
                  {run.head_sha && (
                    <span className="rounded-full border border-[var(--alpha-white-10)] bg-[var(--alpha-white-5)] px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--gray-500)]">
                      {run.head_sha.slice(0, 7)}
                    </span>
                  )}
                </div>
                <p className="mt-3 font-mono text-xs text-[var(--gray-400)]">
                  {new Date(run.created_at).toLocaleString()}
                </p>
                <p className="mt-2 font-mono text-xs leading-relaxed text-[var(--gray-500)]">
                  {run.summary || "No summary was generated for this run."}
                </p>
                <div className="mt-3 grid grid-cols-3 gap-2">
                  <RunDeltaTile label="New" value={run.new_findings} tone="text-red-300" />
                  <RunDeltaTile
                    label="Resolved"
                    value={run.resolved_findings}
                    tone="text-[var(--accent-green)]"
                  />
                  <RunDeltaTile
                    label="Total"
                    value={run.findings_total}
                    tone="text-[var(--gray-100)]"
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </GlowCard>
  );
}

export function RepoChecksWorkspace() {
  const params = useParams<{ owner: string; name: string }>();
  const repoFullName = `${params.owner}/${params.name}`;
  const basePath = `/repo/${params.owner}/${params.name}`;
  const apiKey = useAppStore((state) => state.apiKey);
  const observedRun = useAppStore((state) => state.repoCheckRuns[repoFullName]);
  const setRepoHealthSummary = useAppStore((state) => state.setRepoHealthSummary);
  const setRepoCheckRun = useAppStore((state) => state.setRepoCheckRun);

  const [summary, setSummary] = useState<RepoHealthSummary | null>(null);
  const [configs, setConfigs] = useState<RepoCheckConfig[]>([]);
  const [runs, setRuns] = useState<RepoCheckRun[]>([]);
  const [findings, setFindings] = useState<RepoCheckFinding[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [inspectedFinding, setInspectedFinding] = useState<RepoCheckFinding | null>(
    null
  );
  const [copied, setCopied] = useState(false);
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>("all");
  const [checkTypeFilter, setCheckTypeFilter] = useState<CheckTypeFilter>("all");

  const loadData = useCallback(async () => {
    setLoading(true);

    const [summaryResult, configResult, runResult, findingResult] =
      await Promise.allSettled([
        fetchJson<RepoHealthSummary>(
          `/api/repos/checks/summary?repo=${encodeURIComponent(repoFullName)}`,
          "Failed to load repo health summary"
        ),
        fetchJson<{ configs?: RepoCheckConfig[] }>(
          `/api/repos/checks/config?repo=${encodeURIComponent(repoFullName)}`,
          "Failed to load check automation"
        ),
        fetchJson<{ runs?: RepoCheckRun[] }>(
          `/api/repos/checks/runs?repo=${encodeURIComponent(repoFullName)}&limit=8`,
          "Failed to load recent check runs"
        ),
        fetchJson<{ findings?: RepoCheckFinding[] }>(
          `/api/repos/checks/findings?repo=${encodeURIComponent(repoFullName)}&status=open&limit=40`,
          "Failed to load open findings"
        ),
      ]);

    const nextErrors: string[] = [];

    if (summaryResult.status === "fulfilled") {
      setSummary(summaryResult.value);
      const normalizedSummary: RepoHealthSummaryState = {
        openCount: summaryResult.value.openCount || 0,
        criticalCount: summaryResult.value.criticalCount || 0,
        highCount: summaryResult.value.highCount || 0,
        resolvedRecently: summaryResult.value.resolvedRecently || 0,
        currentHeadSha: summaryResult.value.currentHeadSha || null,
        latestCompletedHeadSha:
          summaryResult.value.latestCompletedHeadSha || null,
        isCurrent: summaryResult.value.isCurrent === true,
        latestRun: summaryResult.value.latestRun
          ? {
              id: summaryResult.value.latestRun.id,
              repoFullName,
              status: summaryResult.value.latestRun.status,
              triggerMode: summaryResult.value.latestRun.trigger_mode,
              summary: summaryResult.value.latestRun.summary,
              findingsTotal: summaryResult.value.latestRun.findings_total,
              newFindings: summaryResult.value.latestRun.new_findings,
              resolvedFindings: summaryResult.value.latestRun.resolved_findings,
              unchangedFindings: summaryResult.value.latestRun.unchanged_findings,
              headSha: summaryResult.value.latestRun.head_sha,
              createdAt: summaryResult.value.latestRun.created_at,
            }
          : null,
      };
      setRepoHealthSummary(repoFullName, normalizedSummary);
      if (normalizedSummary.latestRun) {
        setRepoCheckRun(repoFullName, normalizedSummary.latestRun);
      }
    } else {
      nextErrors.push(
        summaryResult.reason instanceof Error
          ? summaryResult.reason.message
          : "Health summary unavailable."
      );
    }

    if (configResult.status === "fulfilled") {
      setConfigs(configResult.value.configs || []);
    } else {
      nextErrors.push(
        configResult.reason instanceof Error
          ? configResult.reason.message
          : "Automation settings unavailable."
      );
    }

    if (runResult.status === "fulfilled") {
      setRuns(runResult.value.runs || []);
    } else {
      nextErrors.push(
        runResult.reason instanceof Error
          ? runResult.reason.message
          : "Run history unavailable."
      );
    }

    if (findingResult.status === "fulfilled") {
      setFindings(findingResult.value.findings || []);
    } else {
      nextErrors.push(
        findingResult.reason instanceof Error
          ? findingResult.reason.message
          : "Open findings unavailable."
      );
    }

    if (nextErrors.length > 0) {
      setNotice({
        tone: "error",
        text: nextErrors[0],
      });
    }

    setLoading(false);
  }, [repoFullName, setRepoCheckRun, setRepoHealthSummary]);

  const observedRunSignature = observedRun
    ? `${observedRun.id}:${observedRun.status}:${observedRun.headSha || ""}:${observedRun.createdAt}`
    : "none";

  useEffect(() => {
    void loadData();
  }, [loadData, observedRunSignature]);

  const runChecks = async () => {
    setRunning(true);
    setNotice(null);

    try {
      const res = await fetch("/api/repos/checks/run", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(apiKey ? { "x-google-api-key": apiKey } : {}),
        },
        body: JSON.stringify({
          repo_full_name: repoFullName,
          trigger_mode: "manual",
        }),
      });

      const data = (await res.json().catch(() => null)) as
        | { runId?: number; summary?: string; error?: { message?: string } }
        | null;

      if (!res.ok) {
        throw new Error(data?.error?.message || "Failed to run checks");
      }

      setRepoCheckRun(repoFullName, {
        id: Number(data?.runId || Date.now()),
        repoFullName,
        status: "running",
        triggerMode: "manual",
        summary: data?.summary || null,
        findingsTotal: 0,
        newFindings: 0,
        resolvedFindings: 0,
        unchangedFindings: 0,
        headSha: null,
        createdAt: new Date().toISOString(),
      });

      await loadData();
      setNotice({
        tone: "success",
        text: data?.summary || "Repo checks completed.",
      });
    } catch (error: unknown) {
      setNotice({
        tone: "error",
        text: error instanceof Error ? error.message : "Failed to run checks.",
      });
    } finally {
      setRunning(false);
    }
  };

  const severityCounts = useMemo(() => {
    let critical = 0;
    let high = 0;
    let medium = 0;
    let low = 0;

    for (const finding of findings) {
      switch (finding.severity) {
        case "critical":
          critical += 1;
          break;
        case "high":
          high += 1;
          break;
        case "medium":
          medium += 1;
          break;
        case "low":
          low += 1;
          break;
      }
    }

    return { critical, high, medium, low };
  }, [findings]);

  const filteredFindings = useMemo(() => {
    return [...findings]
      .filter((finding) =>
        severityFilter === "all" ? true : finding.severity === severityFilter
      )
      .filter((finding) =>
        checkTypeFilter === "all" ? true : finding.check_type === checkTypeFilter
      )
      .sort((left, right) => {
        const severityCompare =
          severityPriority[left.severity] - severityPriority[right.severity];
        if (severityCompare !== 0) return severityCompare;

        const transitionCompare =
          transitionPriority[left.transition_state] -
          transitionPriority[right.transition_state];
        if (transitionCompare !== 0) return transitionCompare;

        return (
          new Date(right.updated_at).getTime() - new Date(left.updated_at).getTime()
        );
      });
  }, [checkTypeFilter, findings, severityFilter]);

  const latestRun = summary?.latestRun || runs[0] || null;
  const enabledCheckCount = configs.filter((config) => config.enabled).length;
  const automatedCheckCount = configs.filter(
    (config) => config.enabled && config.trigger_mode !== "manual"
  ).length;
  const isVerifyingCurrentHead =
    !!summary?.currentHeadSha &&
    latestRun?.status === "running" &&
    latestRun.head_sha === summary.currentHeadSha;
  const staleSummaryText =
    summary?.currentHeadSha && summary?.latestCompletedHeadSha
      ? `Latest completed findings are from ${summary.latestCompletedHeadSha.slice(0, 7)}, while the repo is already synced to ${summary.currentHeadSha.slice(0, 7)}.`
      : "The findings below are older than the current synced repository state.";

  const copyVisibleFindings = useCallback(async () => {
    if (filteredFindings.length === 0) return;

    const lines: string[] = [
      `## Open Findings (${filteredFindings.length} visible)`,
      "",
    ];

    for (const finding of filteredFindings) {
      lines.push(`### [${finding.severity}] ${finding.title}`);
      lines.push(`- **Type:** ${finding.check_type}`);
      lines.push(`- **Status:** ${finding.transition_state}`);
      if (finding.file_path) lines.push(`- **File:** ${finding.file_path}`);
      lines.push(`- **Summary:** ${finding.summary}`);
      if (finding.recommendation) {
        lines.push(`- **Recommendation:** ${finding.recommendation}`);
      }
      if (finding.evidence) {
        lines.push(
          `- **Evidence:** \`${finding.evidence.replace(/\n/g, " ").slice(0, 200)}\``
        );
      }
      lines.push("");
    }

    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setNotice({
        tone: "error",
        text: "Clipboard access was blocked, so the findings could not be copied.",
      });
    }
  }, [filteredFindings]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-10 font-mono text-sm text-[var(--gray-500)]">
        <Loader2 size={16} className="animate-spin" />
        Loading repo checks...
      </div>
    );
  }

  return (
    <>
      <div className="space-y-5 pb-6">
        <GlowCard glowColor="cyan" className="overflow-hidden">
          <div className="border-b border-[var(--alpha-white-8)] bg-[radial-gradient(circle_at_top_left,rgba(63,185,80,0.12),transparent_40%),linear-gradient(180deg,rgba(13,17,23,0.95),rgba(13,17,23,0.82))] px-6 py-6">
            <div className="flex flex-col gap-6 xl:flex-row xl:items-start xl:justify-between">
              <div className="max-w-3xl">
                <div className="flex flex-wrap items-center gap-2">
                  <Shield size={16} className="text-[var(--accent-amber)]" />
                  <span className="rounded-full border border-[var(--alpha-white-10)] bg-[var(--alpha-white-5)] px-3 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--gray-400)]">
                    Repo health workspace
                  </span>
                </div>

                <h2 className="mt-4 font-mono text-2xl leading-tight text-[var(--gray-100)]">
                  Review what needs attention, not a wall of equally weighted cards.
                </h2>
                <p className="mt-3 max-w-2xl font-mono text-sm leading-relaxed text-[var(--gray-400)]">
                  Open findings stay front and center, recent runs move into a
                  secondary rail, and automation rules now live in Settings where
                  they belong.
                </p>

                <div className="mt-4 flex flex-wrap gap-2">
                  <HeroPill label="Open" value={summary?.openCount || findings.length} />
                  <HeroPill
                    label="Needs fast review"
                    value={severityCounts.critical + severityCounts.high}
                  />
                  <HeroPill label="Enabled checks" value={enabledCheckCount} />
                  <HeroPill label="Auto-run checks" value={automatedCheckCount} />
                </div>
              </div>

              <div className="w-full max-w-md rounded-3xl border border-[var(--alpha-white-8)] bg-black/20 p-5 backdrop-blur-sm">
                <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--gray-500)]">
                  Latest run
                </p>
                {latestRun ? (
                  <>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <RunStatusBadge status={latestRun.status} />
                      <TriggerBadge mode={latestRun.trigger_mode} />
                    </div>
                    <p className="mt-3 font-mono text-xs text-[var(--gray-300)]">
                      {new Date(latestRun.created_at).toLocaleString()}
                    </p>
                    <p className="mt-2 font-mono text-xs leading-relaxed text-[var(--gray-500)]">
                      {summary?.isCurrent === false && isVerifyingCurrentHead
                        ? "A fresh repo-health run is still verifying the current synced head."
                        : latestRun.summary ||
                          "The latest run did not return a summary."}
                    </p>
                  </>
                ) : (
                  <p className="mt-3 font-mono text-xs leading-relaxed text-[var(--gray-500)]">
                    No runs yet. Kick off a manual pass to seed the workspace.
                  </p>
                )}

                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    onClick={runChecks}
                    disabled={running}
                    className="inline-flex items-center gap-2 rounded-xl border border-[var(--accent-green)]/20 bg-[var(--accent-green)]/10 px-4 py-2 font-mono text-sm text-[var(--accent-green)] transition-colors hover:bg-[var(--accent-green)]/20 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {running ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      <Zap size={14} />
                    )}
                    Run Checks Now
                  </button>

                  <Link
                    href={`${basePath}/settings`}
                    className="inline-flex items-center gap-2 rounded-xl border border-[var(--alpha-white-10)] bg-[var(--alpha-white-5)] px-4 py-2 font-mono text-sm text-[var(--gray-300)] transition-colors hover:border-[var(--accent-green)]/30 hover:text-[var(--accent-green)] no-underline"
                  >
                    <Settings2 size={14} />
                    Manage Automation
                  </Link>
                </div>
              </div>
            </div>
          </div>
          {summary && summary.isCurrent === false && (
            <div className="border-t border-[var(--alpha-white-8)] px-6 py-4">
              <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 px-4 py-3">
                <p className="m-0 font-mono text-xs leading-relaxed text-amber-200">
                  {isVerifyingCurrentHead
                    ? `Verifying fixes on ${summary.currentHeadSha?.slice(0, 7)} now.`
                    : staleSummaryText}
                </p>
              </div>
            </div>
          )}
          <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-5">
            <SummaryMetric
              label="Open Findings"
              value={summary?.openCount || findings.length}
              tone="text-[var(--gray-100)]"
              hint="Currently unresolved"
            />
            <SummaryMetric
              label="Critical"
              value={severityCounts.critical}
              tone="text-red-300"
              hint="Highest priority"
            />
            <SummaryMetric
              label="High"
              value={severityCounts.high}
              tone="text-amber-300"
              hint="Review soon"
            />
            <SummaryMetric
              label="Medium"
              value={severityCounts.medium}
              tone="text-blue-300"
              hint="Still worth triage"
            />
            <SummaryMetric
              label="Resolved"
              value={summary?.resolvedRecently || 0}
              tone="text-[var(--accent-green)]"
              hint="Closed recently"
            />
          </div>
        </GlowCard>

        {notice && (
          <div
            className={`rounded-2xl border px-4 py-3 font-mono text-xs ${
              notice.tone === "error"
                ? "border-red-500/20 bg-red-500/10 text-red-300"
                : notice.tone === "success"
                  ? "border-[var(--accent-green)]/20 bg-[var(--accent-green)]/10 text-[var(--accent-green)]"
                  : "border-[var(--alpha-white-10)] bg-[var(--alpha-white-5)] text-[var(--gray-300)]"
            }`}
          >
            {notice.text}
          </div>
        )}

        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="min-w-0">
            <GlowCard glowColor="none" className="overflow-hidden">
              <div className="border-b border-[var(--alpha-white-8)] px-5 py-4">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <AlertTriangle size={15} className="text-amber-300" />
                      <h3 className="m-0 font-mono text-sm font-semibold text-[var(--gray-200)]">
                        Open Findings
                      </h3>
                      <span className="font-mono text-xs text-[var(--gray-500)]">
                        ({findings.length})
                      </span>
                    </div>
                    <p className="mt-2 font-mono text-xs leading-relaxed text-[var(--gray-500)]">
                      Focus the list by severity or check type, then open a finding
                      to inspect the file evidence directly.
                    </p>
                  </div>

                  {filteredFindings.length > 0 && (
                    <button
                      onClick={() => void copyVisibleFindings()}
                      className="inline-flex items-center gap-2 self-start rounded-xl border px-3 py-2 font-mono text-xs transition-colors"
                      style={{
                        color: copied ? "var(--accent-green)" : "var(--gray-300)",
                        borderColor: copied
                          ? "rgba(63,185,80,0.28)"
                          : "var(--alpha-white-10)",
                        background: copied
                          ? "rgba(63,185,80,0.1)"
                          : "var(--alpha-white-5)",
                      }}
                    >
                      {copied ? <Check size={13} /> : <ClipboardCopy size={13} />}
                      {copied
                        ? "Copied"
                        : filteredFindings.length === findings.length
                          ? "Copy All"
                          : "Copy Visible"}
                    </button>
                  )}
                </div>
              </div>

              <div className="space-y-4 p-5">
                <div className="space-y-3">
                  <div>
                    <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--gray-500)]">
                      Severity
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <FilterChip
                        active={severityFilter === "all"}
                        label="All"
                        count={findings.length}
                        onClick={() => setSeverityFilter("all")}
                      />
                      <FilterChip
                        active={severityFilter === "critical"}
                        label="Critical"
                        count={severityCounts.critical}
                        onClick={() => setSeverityFilter("critical")}
                      />
                      <FilterChip
                        active={severityFilter === "high"}
                        label="High"
                        count={severityCounts.high}
                        onClick={() => setSeverityFilter("high")}
                      />
                      <FilterChip
                        active={severityFilter === "medium"}
                        label="Medium"
                        count={severityCounts.medium}
                        onClick={() => setSeverityFilter("medium")}
                      />
                      <FilterChip
                        active={severityFilter === "low"}
                        label="Low"
                        count={severityCounts.low}
                        onClick={() => setSeverityFilter("low")}
                      />
                    </div>
                  </div>

                  <div>
                    <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--gray-500)]">
                      Check type
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <FilterChip
                        active={checkTypeFilter === "all"}
                        label="All"
                        count={findings.length}
                        onClick={() => setCheckTypeFilter("all")}
                      />
                      {(Object.keys(CHECK_LABELS) as RepoCheckType[]).map((checkType) => (
                        <FilterChip
                          key={checkType}
                          active={checkTypeFilter === checkType}
                          label={CHECK_LABELS[checkType].title}
                          count={
                            findings.filter((finding) => finding.check_type === checkType)
                              .length
                          }
                          onClick={() => setCheckTypeFilter(checkType)}
                        />
                      ))}
                    </div>
                  </div>
                </div>

                <div className="space-y-3">
                  {filteredFindings.length === 0 ? (
                    <div className="rounded-3xl border border-[var(--alpha-white-8)] bg-[radial-gradient(circle_at_top,rgba(63,185,80,0.06),transparent_35%),rgba(255,255,255,0.02)] px-6 py-8 text-center">
                      <CheckCircle2
                        size={20}
                        className="mx-auto text-[var(--accent-green)]"
                      />
                      <p className="mt-3 font-mono text-sm text-[var(--gray-200)]">
                        {findings.length === 0
                          ? "No open findings right now."
                          : "No findings match the active filters."}
                      </p>
                      <p className="mt-2 font-mono text-xs leading-relaxed text-[var(--gray-500)]">
                        {findings.length === 0
                          ? "Your latest checks are currently clean."
                          : "Adjust the chips above to bring findings back into view."}
                      </p>
                    </div>
                  ) : (
                    filteredFindings.map((finding) => (
                      <button
                        key={finding.id}
                        onClick={() => setInspectedFinding(finding)}
                        className="group w-full rounded-3xl border border-[var(--alpha-white-8)] bg-[linear-gradient(180deg,rgba(255,255,255,0.035),rgba(255,255,255,0.02))] px-5 py-4 text-left transition-all duration-200 hover:-translate-y-[1px] hover:border-[var(--accent-green)]/25 hover:bg-[linear-gradient(180deg,rgba(255,255,255,0.045),rgba(255,255,255,0.028))]"
                      >
                        <div className="flex flex-wrap items-start gap-2">
                          <SeverityBadge severity={finding.severity} />
                          <span className="rounded-full border border-[var(--alpha-white-10)] bg-[var(--alpha-white-5)] px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--gray-400)]">
                            {CHECK_LABELS[finding.check_type].title}
                          </span>
                          <span className="rounded-full border border-[var(--alpha-white-10)] bg-[var(--alpha-white-5)] px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--gray-500)]">
                            {finding.transition_state}
                          </span>
                          <span className="ml-auto font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--gray-600)]">
                            {new Date(finding.updated_at).toLocaleDateString()}
                          </span>
                        </div>

                        <div className="mt-4 flex items-start gap-4">
                          <div className="min-w-0 flex-1">
                            <h4 className="m-0 font-mono text-base text-[var(--gray-100)]">
                              {finding.title}
                            </h4>
                            <p className="mt-2 font-mono text-sm leading-relaxed text-[var(--gray-400)] line-clamp-2">
                              {finding.summary}
                            </p>
                            {finding.recommendation && (
                              <p className="mt-3 font-mono text-xs leading-relaxed text-[var(--accent-green)] line-clamp-2">
                                Fix direction: {finding.recommendation}
                              </p>
                            )}
                            <div className="mt-4 flex flex-wrap items-center gap-3">
                              {finding.file_path && (
                                <span className="inline-flex min-w-0 max-w-full items-center gap-2 rounded-full border border-[var(--alpha-white-8)] bg-[var(--alpha-white-5)] px-3 py-1.5 font-mono text-xs text-[var(--gray-300)]">
                                  <FileCode
                                    size={12}
                                    className="shrink-0 text-[var(--accent-green)]"
                                  />
                                  <span className="truncate">{finding.file_path}</span>
                                </span>
                              )}
                            </div>
                          </div>

                          <ChevronRight
                            size={16}
                            className="mt-1 shrink-0 text-[var(--gray-600)] transition-colors group-hover:text-[var(--accent-green)]"
                          />
                        </div>
                      </button>
                    ))
                  )}
                </div>
              </div>
            </GlowCard>
          </div>

          <div className="space-y-5 self-start xl:sticky xl:top-4">
            <AutomationStatusCard
              configs={configs}
              settingsHref={`${basePath}/settings`}
            />
            <RecentRunsCard runs={runs} />
          </div>
        </div>
      </div>

      {inspectedFinding && (
        <FindingInspectorModal
          finding={inspectedFinding}
          repoFullName={repoFullName}
          onClose={() => setInspectedFinding(null)}
        />
      )}
    </>
  );
}
