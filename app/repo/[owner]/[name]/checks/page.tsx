"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { GlowCard } from "@/app/components/shared/GlowCard";
import {
  RepoCheckRunState,
  RepoHealthSummaryState,
  useAppStore,
} from "@/lib/store/app-store";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  ExternalLink,
  FileCode,
  Loader2,
  Shield,
  Sparkles,
  X,
  Zap,
} from "lucide-react";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { atomDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import { detectCodeLanguage } from "@/lib/code";

interface RepoCheckConfig {
  id: number;
  check_type: "security" | "optimization" | "consistency" | "change_impact";
  enabled: boolean;
  trigger_mode: "manual" | "after_sync" | "daily";
  notify_on_high: boolean;
}

interface RepoCheckRun {
  id: number;
  status: string;
  trigger_mode: string;
  summary: string | null;
  findings_total: number;
  new_findings: number;
  resolved_findings: number;
  unchanged_findings: number;
  created_at: string;
  head_sha: string | null;
}

interface RepoCheckFinding {
  id: number;
  check_type: string;
  title: string;
  summary: string;
  severity: "low" | "medium" | "high" | "critical";
  status: "open" | "resolved";
  transition_state: "new" | "persistent" | "regressed" | "resolved";
  file_path: string | null;
  recommendation: string | null;
  evidence: string | null;
  updated_at: string;
}

interface RepoHealthSummary {
  openCount: number;
  criticalCount: number;
  highCount: number;
  resolvedRecently: number;
  latestRun?: {
    id: number;
    status: RepoCheckRunState["status"];
    trigger_mode: RepoCheckRunState["triggerMode"];
    summary: string | null;
    created_at: string;
    head_sha: string | null;
    findings_total: number;
    new_findings: number;
    resolved_findings: number;
    unchanged_findings: number;
  } | null;
}

interface LoadedFile {
  content: string;
  language: string;
  github_url: string | null;
  commit_sha: string | null;
  last_indexed_at?: string | null;
}

const CHECK_LABELS: Record<RepoCheckConfig["check_type"], { title: string; description: string }> = {
  security: {
    title: "Security",
    description: "OWASP-style issues, secrets, auth mistakes, and unsafe input handling.",
  },
  optimization: {
    title: "Optimization",
    description: "Slow paths, repeated work, bundle bloat, and expensive rendering or data access.",
  },
  consistency: {
    title: "Consistency",
    description: "Multiple ways of doing the same job, inconsistent endpoint patterns, and duplicated logic.",
  },
  change_impact: {
    title: "Change Impact",
    description: "Likely regressions, incomplete fixes, and follow-up work implied by recent changes.",
  },
};

function SeverityBadge({ severity }: { severity: RepoCheckFinding["severity"] }) {
  const color =
    severity === "critical"
      ? "text-red-300 border-red-500/30 bg-red-500/10"
      : severity === "high"
        ? "text-amber-300 border-amber-500/30 bg-amber-500/10"
        : severity === "medium"
          ? "text-blue-300 border-blue-500/30 bg-blue-500/10"
          : "text-[var(--gray-400)] border-[var(--alpha-white-10)] bg-[var(--alpha-white-5)]";

  return (
    <span className={`px-2 py-0.5 rounded-full border text-[10px] font-mono ${color}`}>
      {severity}
    </span>
  );
}

/* ---------- Highlighted code component (ported from chat) ---------- */
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

  // Find lines matching the evidence string to highlight them
  const highlightedLines = useMemo(() => {
    if (!highlightEvidence || !content) return new Set<number>();
    const lines = content.split("\n");
    const evidenceLines = highlightEvidence.split("\n").map((l) => l.trim()).filter(Boolean);
    const highlighted = new Set<number>();

    for (const evidenceLine of evidenceLines) {
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes(evidenceLine) || evidenceLine.includes(lines[i].trim())) {
          // Highlight the matching line and a couple surrounding lines for context
          for (let j = Math.max(0, i - 1); j <= Math.min(lines.length - 1, i + 1); j++) {
            highlighted.add(j + startingLineNumber);
          }
        }
      }
    }
    return highlighted;
  }, [content, highlightEvidence, startingLineNumber]);

  // Scroll to first highlighted line
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

/* ---------- Finding Inspector Modal ---------- */
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

    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const search = new URLSearchParams({
          repo: repoFullName,
          path: finding.file_path!,
        });
        const res = await fetch(`/api/repos/file?${search.toString()}`);
        if (!res.ok) {
          const payload = await res.json().catch(() => null);
          throw new Error(payload?.error?.message || "Unable to load file");
        }
        const data = (await res.json()) as LoadedFile;
        setFileData(data);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Unable to load file");
      } finally {
        setLoading(false);
      }
    };

    void load();
  }, [finding.file_path, repoFullName]);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const language = finding.file_path
    ? detectCodeLanguage(finding.file_path)
    : "text";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Overlay */}
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative w-[95vw] max-w-5xl h-[85vh] max-h-[85vh] rounded-2xl border border-[var(--alpha-white-8)] bg-[var(--surface-0)] shadow-[0_32px_120px_rgba(0,0,0,0.45)] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="shrink-0 border-b border-[var(--alpha-white-8)] px-5 py-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2 mb-2">
                <SeverityBadge severity={finding.severity} />
                <span className="px-2 py-0.5 rounded-full border border-[var(--alpha-white-10)] bg-[var(--alpha-white-5)] text-[10px] font-mono text-[var(--gray-400)]">
                  {finding.check_type}
                </span>
                <span className="px-2 py-0.5 rounded-full border border-[var(--alpha-white-10)] bg-[var(--alpha-white-5)] text-[10px] font-mono text-[var(--gray-500)]">
                  {finding.transition_state}
                </span>
              </div>
              <h3 className="font-mono text-sm text-[var(--gray-100)] m-0 mb-1">
                {finding.title}
              </h3>
              <p className="font-mono text-xs text-[var(--gray-500)] m-0 leading-relaxed">
                {finding.summary}
              </p>
              {finding.recommendation && (
                <p className="font-mono text-[11px] text-[var(--accent-green)] m-0 mt-2">
                  Fix direction: {finding.recommendation}
                </p>
              )}
            </div>

            <div className="flex items-center gap-2 shrink-0">
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
                className="rounded-xl border border-[var(--alpha-white-8)] bg-[var(--alpha-white-5)] p-2 text-[var(--gray-400)] hover:text-[var(--gray-100)] transition-colors"
              >
                <X size={14} />
              </button>
            </div>
          </div>

          {finding.file_path && (
            <div className="mt-3 flex items-center gap-2">
              <FileCode size={13} className="text-[var(--accent-green)] shrink-0" />
              <span className="font-mono text-[11px] text-[var(--gray-300)] truncate">
                {finding.file_path}
              </span>
            </div>
          )}
        </div>

        {/* Code body */}
        <div className="min-h-0 flex-1 bg-[radial-gradient(circle_at_top,rgba(63,185,80,0.08),transparent_38%),var(--surface-0)]">
          {!finding.file_path && (
            <div className="flex h-full items-center justify-center px-6 text-center">
              <div>
                <FileCode size={28} className="mx-auto mb-3 text-[var(--gray-600)]" />
                <p className="m-0 font-mono text-sm text-[var(--gray-300)]">
                  No file reference
                </p>
                <p className="m-0 mt-1 font-mono text-xs text-[var(--gray-500)]">
                  This finding doesn&apos;t reference a specific file.
                </p>
                {finding.evidence && (
                  <div className="mt-4 rounded-xl border border-[var(--alpha-white-8)] bg-[var(--alpha-white-5)] p-4 text-left">
                    <p className="font-mono text-[10px] uppercase tracking-widest text-[var(--gray-500)] m-0 mb-2">
                      Evidence
                    </p>
                    <pre className="font-mono text-xs text-[var(--gray-300)] m-0 whitespace-pre-wrap">
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
              <p className="m-0 font-mono text-xs text-[var(--accent-red)] mb-3">
                {error}
              </p>
              {finding.evidence && (
                <div className="w-full max-w-2xl rounded-xl border border-[var(--alpha-white-8)] bg-[var(--alpha-white-5)] p-4 text-left">
                  <p className="font-mono text-[10px] uppercase tracking-widest text-[var(--gray-500)] m-0 mb-2">
                    Evidence from analysis
                  </p>
                  <pre className="font-mono text-xs text-[var(--gray-300)] m-0 whitespace-pre-wrap">
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

export default function RepoChecksPage() {
  const params = useParams<{ owner: string; name: string }>();
  const repoFullName = `${params.owner}/${params.name}`;
  const apiKey = useAppStore((s) => s.apiKey);
  const setRepoHealthSummary = useAppStore((s) => s.setRepoHealthSummary);
  const setRepoCheckRun = useAppStore((s) => s.setRepoCheckRun);

  const [summary, setSummary] = useState<RepoHealthSummary | null>(null);
  const [configs, setConfigs] = useState<RepoCheckConfig[]>([]);
  const [runs, setRuns] = useState<RepoCheckRun[]>([]);
  const [findings, setFindings] = useState<RepoCheckFinding[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [inspectedFinding, setInspectedFinding] = useState<RepoCheckFinding | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [summaryRes, configRes, runRes, findingRes] = await Promise.all([
        fetch(`/api/repos/checks/summary?repo=${encodeURIComponent(repoFullName)}`),
        fetch(`/api/repos/checks/config?repo=${encodeURIComponent(repoFullName)}`),
        fetch(`/api/repos/checks/runs?repo=${encodeURIComponent(repoFullName)}&limit=10`),
        fetch(`/api/repos/checks/findings?repo=${encodeURIComponent(repoFullName)}&status=open&limit=20`),
      ]);

      const [summaryData, configData, runData, findingData] = await Promise.all([
        summaryRes.json(),
        configRes.json(),
        runRes.json(),
        findingRes.json(),
      ]);

      setSummary(summaryData);
      const normalizedSummary: RepoHealthSummaryState = {
        openCount: summaryData.openCount || 0,
        criticalCount: summaryData.criticalCount || 0,
        highCount: summaryData.highCount || 0,
        resolvedRecently: summaryData.resolvedRecently || 0,
        latestRun: summaryData.latestRun
          ? {
              id: summaryData.latestRun.id,
              repoFullName,
              status: summaryData.latestRun.status,
              triggerMode: summaryData.latestRun.trigger_mode,
              summary: summaryData.latestRun.summary,
              findingsTotal: summaryData.latestRun.findings_total,
              newFindings: summaryData.latestRun.new_findings,
              resolvedFindings: summaryData.latestRun.resolved_findings,
              unchangedFindings: summaryData.latestRun.unchanged_findings,
              headSha: summaryData.latestRun.head_sha,
              createdAt: summaryData.latestRun.created_at,
            }
          : null,
      };
      setRepoHealthSummary(repoFullName, normalizedSummary);
      if (normalizedSummary.latestRun) {
        setRepoCheckRun(repoFullName, normalizedSummary.latestRun);
      }
      setConfigs(configData.configs || []);
      setRuns(runData.runs || []);
      setFindings(findingData.findings || []);
    } catch {
      setMessage("Failed to load repo checks.");
    } finally {
      setLoading(false);
    }
  }, [repoFullName, setRepoCheckRun, setRepoHealthSummary]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const saveConfigs = async (nextConfigs: RepoCheckConfig[]) => {
    setSaving(true);
    setMessage(null);
    setConfigs(nextConfigs);

    try {
      const res = await fetch("/api/repos/checks/config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          repo_full_name: repoFullName,
          configs: nextConfigs.map((config) => ({
            check_type: config.check_type,
            enabled: config.enabled,
            trigger_mode: config.trigger_mode,
            notify_on_high: config.notify_on_high,
          })),
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error?.message || "Failed to save check settings");
      }

      setConfigs(data.configs || nextConfigs);
      setMessage("Check settings saved.");
    } catch (error: unknown) {
      setMessage(error instanceof Error ? error.message : "Failed to save check settings.");
      loadData();
    } finally {
      setSaving(false);
    }
  };

  const updateConfig = (
    checkType: RepoCheckConfig["check_type"],
    updates: Partial<RepoCheckConfig>
  ) => {
    const next = configs.map((config) =>
      config.check_type === checkType ? { ...config, ...updates } : config
    );
    void saveConfigs(next);
  };

  const runChecks = async () => {
    setRunning(true);
    setMessage(null);
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

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error?.message || "Failed to run checks");
      }

      setRepoCheckRun(repoFullName, {
        id: Number(data.runId || Date.now()),
        repoFullName,
        status: "running",
        triggerMode: "manual",
        summary: data.summary || null,
        findingsTotal: 0,
        newFindings: 0,
        resolvedFindings: 0,
        unchangedFindings: 0,
        headSha: null,
        createdAt: new Date().toISOString(),
      });
      setMessage(data.summary || "Repo checks completed.");
      await loadData();
    } catch (error: unknown) {
      setMessage(error instanceof Error ? error.message : "Failed to run checks.");
    } finally {
      setRunning(false);
    }
  };

  // Derive severity counts from the findings array for accurate breakdown
  const severityCounts = useMemo(() => {
    let critical = 0;
    let high = 0;
    let medium = 0;
    let low = 0;
    for (const f of findings) {
      switch (f.severity) {
        case "critical": critical++; break;
        case "high": high++; break;
        case "medium": medium++; break;
        case "low": low++; break;
      }
    }
    return { critical, high, medium, low };
  }, [findings]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-10 font-mono text-sm text-[var(--gray-500)]">
        <Loader2 size={16} className="animate-spin" />
        Loading repo checks...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <GlowCard glowColor="none" className="p-5">
        <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Shield size={16} className="text-[var(--accent-amber)]" />
              <h2 className="font-mono text-base font-semibold text-[var(--gray-100)] m-0">
                Automated Repo Checks
              </h2>
            </div>
            <p className="font-mono text-sm text-[var(--gray-500)] m-0">
              Continuous repo health across security, optimization, consistency, and change impact.
            </p>
          </div>

          <button
            onClick={runChecks}
            disabled={running}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-mono bg-[var(--accent-green)]/10 text-[var(--accent-green)] border border-[var(--accent-green)]/20 hover:bg-[var(--accent-green)]/20 disabled:opacity-50 cursor-pointer"
          >
            {running ? <Loader2 size={14} className="animate-spin" /> : <Zap size={14} />}
            Run Checks Now
          </button>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mt-5">
          <Metric label="Open findings" value={summary?.openCount || 0} accent="text-[var(--gray-100)]" />
          <Metric label="Critical" value={severityCounts.critical} accent="text-red-300" />
          <Metric label="High" value={severityCounts.high} accent="text-amber-300" />
          <Metric label="Medium" value={severityCounts.medium} accent="text-blue-300" />
          <Metric label="Resolved" value={summary?.resolvedRecently || 0} accent="text-[var(--accent-green)]" />
        </div>

        {message && (
          <p className="mt-4 font-mono text-xs text-[var(--gray-400)] m-0">
            {message}
          </p>
        )}
      </GlowCard>

      <GlowCard glowColor="cyan" className="p-5">
        <div className="flex items-center gap-2 mb-4">
          <Sparkles size={16} className="text-[var(--accent-green)]" />
          <h3 className="font-mono text-sm font-medium text-[var(--gray-200)] m-0">
            Check Configuration
          </h3>
          {saving && <Loader2 size={13} className="animate-spin text-[var(--gray-500)]" />}
        </div>

        <div className="space-y-3">
          {configs.map((config) => (
            <div
              key={config.check_type}
              className="rounded-xl border border-[var(--alpha-white-8)] bg-[var(--alpha-white-3)] p-4"
            >
              <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <h4 className="font-mono text-sm text-[var(--gray-200)] m-0">
                      {CHECK_LABELS[config.check_type].title}
                    </h4>
                    {config.enabled ? (
                      <span className="font-mono text-[10px] text-[var(--accent-green)] border border-[var(--accent-green)]/20 bg-[var(--accent-green)]/10 rounded-full px-2 py-0.5">
                        Enabled
                      </span>
                    ) : (
                      <span className="font-mono text-[10px] text-[var(--gray-500)] border border-[var(--alpha-white-10)] bg-[var(--alpha-white-5)] rounded-full px-2 py-0.5">
                        Disabled
                      </span>
                    )}
                  </div>
                  <p className="font-mono text-xs text-[var(--gray-500)] m-0">
                    {CHECK_LABELS[config.check_type].description}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <label className="flex items-center gap-2 font-mono text-xs text-[var(--gray-400)]">
                    <input
                      type="checkbox"
                      checked={config.enabled}
                      onChange={(e) => updateConfig(config.check_type, { enabled: e.target.checked })}
                    />
                    Enabled
                  </label>

                  <label className="flex items-center gap-2 font-mono text-xs text-[var(--gray-400)]">
                    Trigger
                    <select
                      value={config.trigger_mode}
                      onChange={(e) =>
                        updateConfig(config.check_type, {
                          trigger_mode: e.target.value as RepoCheckConfig["trigger_mode"],
                        })
                      }
                      className="px-2 py-1 rounded-lg bg-[var(--surface-1)] border border-[var(--alpha-white-10)] text-[var(--gray-300)] font-mono text-xs"
                    >
                      <option value="after_sync">After sync</option>
                      <option value="manual">Manual only</option>
                      <option value="daily">Daily</option>
                    </select>
                  </label>

                  <label className="flex items-center gap-2 font-mono text-xs text-[var(--gray-400)]">
                    <input
                      type="checkbox"
                      checked={config.notify_on_high}
                      onChange={(e) =>
                        updateConfig(config.check_type, {
                          notify_on_high: e.target.checked,
                        })
                      }
                    />
                    Notify on high
                  </label>
                </div>
              </div>
            </div>
          ))}
        </div>
      </GlowCard>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <GlowCard glowColor="none" className="p-5">
          <div className="flex items-center gap-2 mb-4">
            <AlertTriangle size={16} className="text-amber-300" />
            <h3 className="font-mono text-sm font-medium text-[var(--gray-200)] m-0">
              Open Findings
            </h3>
          </div>

          {findings.length === 0 ? (
            <div className="rounded-xl border border-[var(--alpha-white-8)] bg-[var(--alpha-white-3)] p-4">
              <div className="flex items-center gap-2 font-mono text-sm text-[var(--accent-green)]">
                <CheckCircle2 size={15} />
                No open findings right now.
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {findings.map((finding) => (
                <button
                  key={finding.id}
                  onClick={() => setInspectedFinding(finding)}
                  className="w-full text-left rounded-xl border border-[var(--alpha-white-8)] bg-[var(--alpha-white-3)] p-4 transition-all hover:border-[var(--accent-green)]/25 hover:bg-[var(--alpha-white-5)] group cursor-pointer"
                >
                  <div className="flex flex-wrap items-center gap-2 mb-2">
                    <SeverityBadge severity={finding.severity} />
                    <span className="px-2 py-0.5 rounded-full border border-[var(--alpha-white-10)] bg-[var(--alpha-white-5)] text-[10px] font-mono text-[var(--gray-400)]">
                      {finding.check_type}
                    </span>
                    <span className="px-2 py-0.5 rounded-full border border-[var(--alpha-white-10)] bg-[var(--alpha-white-5)] text-[10px] font-mono text-[var(--gray-500)]">
                      {finding.transition_state}
                    </span>
                    <ChevronRight
                      size={14}
                      className="ml-auto text-[var(--gray-600)] group-hover:text-[var(--accent-green)] transition-colors"
                    />
                  </div>
                  <h4 className="font-mono text-sm text-[var(--gray-200)] m-0 mb-2">
                    {finding.title}
                  </h4>
                  <p className="font-mono text-xs text-[var(--gray-500)] m-0 mb-2">
                    {finding.summary}
                  </p>
                  {finding.file_path && (
                    <p className="font-mono text-[11px] text-[var(--gray-400)] m-0 mb-1 flex items-center gap-1.5">
                      <FileCode size={11} className="text-[var(--accent-green)] shrink-0" />
                      {finding.file_path}
                    </p>
                  )}
                  {finding.recommendation && (
                    <p className="font-mono text-[11px] text-[var(--gray-400)] m-0">
                      Fix direction: {finding.recommendation}
                    </p>
                  )}
                </button>
              ))}
            </div>
          )}
        </GlowCard>

        <GlowCard glowColor="none" className="p-5">
          <div className="flex items-center gap-2 mb-4">
            <Zap size={16} className="text-[var(--accent-green)]" />
            <h3 className="font-mono text-sm font-medium text-[var(--gray-200)] m-0">
              Recent Runs
            </h3>
          </div>

          {runs.length === 0 ? (
            <div className="rounded-xl border border-[var(--alpha-white-8)] bg-[var(--alpha-white-3)] p-4">
              <p className="font-mono text-xs text-[var(--gray-500)] m-0">
                No automated check history yet.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {runs.map((run) => (
                <div
                  key={run.id}
                  className="rounded-xl border border-[var(--alpha-white-8)] bg-[var(--alpha-white-3)] p-4"
                >
                  <div className="flex flex-wrap items-center gap-2 mb-2">
                    <span className="px-2 py-0.5 rounded-full border border-[var(--alpha-white-10)] bg-[var(--alpha-white-5)] text-[10px] font-mono text-[var(--gray-400)]">
                      {run.trigger_mode}
                    </span>
                    <span className="px-2 py-0.5 rounded-full border border-[var(--alpha-white-10)] bg-[var(--alpha-white-5)] text-[10px] font-mono text-[var(--gray-400)]">
                      {run.status}
                    </span>
                    {run.head_sha && (
                      <span className="px-2 py-0.5 rounded-full border border-[var(--alpha-white-10)] bg-[var(--alpha-white-5)] text-[10px] font-mono text-[var(--gray-500)]">
                        {run.head_sha.slice(0, 7)}
                      </span>
                    )}
                  </div>

                  <p className="font-mono text-xs text-[var(--gray-400)] m-0 mb-1">
                    {new Date(run.created_at).toLocaleString()}
                  </p>
                  <p className="font-mono text-xs text-[var(--gray-500)] m-0 mb-2">
                    {run.summary || "No summary was generated."}
                  </p>
                  <p className="font-mono text-[11px] text-[var(--gray-400)] m-0">
                    {run.new_findings} new, {run.resolved_findings} resolved, {run.unchanged_findings} persistent,{" "}
                    {run.findings_total} total
                  </p>
                </div>
              ))}
            </div>
          )}
        </GlowCard>
      </div>

      {/* Finding Inspector Modal */}
      {inspectedFinding && (
        <FindingInspectorModal
          finding={inspectedFinding}
          repoFullName={repoFullName}
          onClose={() => setInspectedFinding(null)}
        />
      )}
    </div>
  );
}

function Metric({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent: string;
}) {
  return (
    <div className="rounded-xl bg-[var(--alpha-white-5)] p-4">
      <p className="font-mono text-[10px] uppercase text-[var(--gray-500)] m-0 mb-1">
        {label}
      </p>
      <p className={`font-mono text-xl m-0 ${accent}`}>{value}</p>
    </div>
  );
}
