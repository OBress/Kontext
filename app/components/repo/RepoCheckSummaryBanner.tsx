"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Shield,
  X,
} from "lucide-react";
import { RepoCheckRunState, RepoHealthSummaryState, useAppStore } from "@/lib/store/app-store";

/** How recently a run must have completed to show informational (non-warning) banners */
const FRESH_RUN_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes

function getDismissKey(repoFullName: string, runId: number): string {
  return `kontext:banner-dismissed:${repoFullName}:${runId}`;
}

function isBannerDismissed(repoFullName: string, runId: number): boolean {
  try {
    return sessionStorage.getItem(getDismissKey(repoFullName, runId)) === "1";
  } catch {
    return false;
  }
}

function setBannerDismissed(repoFullName: string, runId: number): void {
  try {
    sessionStorage.setItem(getDismissKey(repoFullName, runId), "1");
  } catch {
    // sessionStorage unavailable
  }
}

export function RepoCheckSummaryBanner({
  repoFullName,
  checksHref,
  lastSyncedSha,
}: {
  repoFullName: string;
  checksHref: string;
  lastSyncedSha?: string | null;
}) {
  const cachedSummary = useAppStore((s) => s.repoHealthSummaries[repoFullName]);
  const observedRun = useAppStore((s) => s.repoCheckRuns[repoFullName]);
  const setRepoHealthSummary = useAppStore((s) => s.setRepoHealthSummary);
  const setRepoCheckRun = useAppStore((s) => s.setRepoCheckRun);
  const [summary, setSummary] = useState<RepoHealthSummaryState | null>(
    cachedSummary || null
  );
  const [loading, setLoading] = useState(!cachedSummary);
  const [dismissed, setDismissed] = useState(false);

  // Check sessionStorage on mount and when the run changes
  useEffect(() => {
    const runId = summary?.latestRun?.id;
    if (runId) {
      setDismissed(isBannerDismissed(repoFullName, runId));
    } else {
      setDismissed(false);
    }
  }, [repoFullName, summary?.latestRun?.id]);

  const handleDismiss = useCallback(() => {
    const runId = summary?.latestRun?.id;
    if (runId) {
      setBannerDismissed(repoFullName, runId);
    }
    setDismissed(true);
  }, [repoFullName, summary?.latestRun?.id]);

  const fetchSummary = useCallback(async () => {
    if (!repoFullName) return;
    setLoading(true);
    try {
      const res = await fetch(
        `/api/repos/checks/summary?repo=${encodeURIComponent(repoFullName)}`
      );
      if (!res.ok) throw new Error("Failed to load repo health summary");
      const data = (await res.json()) as {
        openCount: number;
        criticalCount: number;
        highCount: number;
        resolvedRecently: number;
        currentHeadSha: string | null;
        latestCompletedHeadSha: string | null;
        isCurrent: boolean;
        latestRun: {
          id: number;
          status: RepoCheckRunState["status"];
          trigger_mode?: RepoCheckRunState["triggerMode"];
          summary: string | null;
          created_at: string;
          head_sha: string | null;
          findings_total: number;
          new_findings: number;
          resolved_findings: number;
          unchanged_findings: number;
        } | null;
      };

      const normalized: RepoHealthSummaryState = {
        openCount: data.openCount || 0,
        criticalCount: data.criticalCount || 0,
        highCount: data.highCount || 0,
        resolvedRecently: data.resolvedRecently || 0,
        currentHeadSha: data.currentHeadSha || null,
        latestCompletedHeadSha: data.latestCompletedHeadSha || null,
        isCurrent: data.isCurrent === true,
        latestRun: data.latestRun
          ? {
              id: data.latestRun.id,
              repoFullName,
              status: data.latestRun.status,
              triggerMode: data.latestRun.trigger_mode || "after_sync",
              summary: data.latestRun.summary,
              findingsTotal: data.latestRun.findings_total,
              newFindings: data.latestRun.new_findings,
              resolvedFindings: data.latestRun.resolved_findings,
              unchangedFindings: data.latestRun.unchanged_findings,
              headSha: data.latestRun.head_sha,
              createdAt: data.latestRun.created_at,
            }
          : null,
      };

      setSummary(normalized);
      setRepoHealthSummary(repoFullName, normalized);
      if (normalized.latestRun) {
        setRepoCheckRun(repoFullName, normalized.latestRun);
      }
    } catch {
      setSummary(null);
    } finally {
      setLoading(false);
    }
  }, [repoFullName, setRepoCheckRun, setRepoHealthSummary]);

  const observedRunSignature = observedRun
    ? `${observedRun.id}:${observedRun.status}:${observedRun.headSha || ""}:${observedRun.createdAt}`
    : "none";

  useEffect(() => {
    fetchSummary();
  }, [fetchSummary, lastSyncedSha, observedRunSignature]);

  const banner = useMemo(() => {
    const latestRun = summary?.latestRun;
    if (!latestRun) {
      return null;
    }

    // Check if the run is recent enough to show informational banners
    const runAge = latestRun.createdAt
      ? Date.now() - new Date(latestRun.createdAt).getTime()
      : Infinity;
    const isRecent = runAge < FRESH_RUN_THRESHOLD_MS;

    if (!summary.isCurrent) {
      // Only show "catching up" warnings if a newer head exists AND the run is recent.
      // Stale out-of-date warnings are noise when the user hasn't pushed recently.
      if (!isRecent) return null;

      const isVerifyingCurrentHead =
        latestRun.status === "running" &&
        latestRun.headSha &&
        latestRun.headSha === summary.currentHeadSha;

      return {
        tone: "warn" as const,
        title: isVerifyingCurrentHead
          ? "Repo health is re-verifying fixes"
          : "Repo health results are catching up",
        body: isVerifyingCurrentHead
          ? `The latest sync reached ${summary.currentHeadSha?.slice(0, 7)} and a fresh verification run is still in progress.`
          : summary.currentHeadSha && summary.latestCompletedHeadSha
            ? `Latest completed findings are from ${summary.latestCompletedHeadSha.slice(0, 7)} while the repo is already synced to ${summary.currentHeadSha.slice(0, 7)}.`
            : "A fresh verification run is still needed for the current synced repository state.",
      };
    }

    if (latestRun.status !== "completed") {
      return null;
    }

    if (lastSyncedSha && latestRun.headSha && latestRun.headSha !== lastSyncedSha) {
      return null;
    }

    if (!lastSyncedSha && latestRun.triggerMode !== "manual") {
      return null;
    }

    // Warning banners for actual issues — always show regardless of age
    if (latestRun.newFindings > 0 || summary.openCount > 0) {
      return {
        tone: "warn" as const,
        title: `${latestRun.newFindings} new finding${latestRun.newFindings === 1 ? "" : "s"} detected`,
        body:
          latestRun.resolvedFindings > 0
            ? `${latestRun.resolvedFindings} resolved, ${summary.openCount} still open.`
            : `${summary.openCount} open finding${summary.openCount === 1 ? "" : "s"} need review.`,
      };
    }

    // Informational "all clear" banners — only show if the run is fresh
    if (!isRecent) return null;

    if (latestRun.resolvedFindings > 0) {
      return {
        tone: "good" as const,
        title: `${latestRun.resolvedFindings} finding${latestRun.resolvedFindings === 1 ? "" : "s"} resolved`,
        body: "No new issues were detected in the latest verification run.",
      };
    }

    return {
      tone: "good" as const,
      title: "No new issues detected",
      body: "The latest repo health check completed without introducing new findings.",
    };
  }, [lastSyncedSha, summary]);

  if (loading && !summary) {
    return (
      <div className="flex items-center gap-2 px-4 py-3 rounded-xl border border-[var(--alpha-white-8)] bg-[var(--alpha-white-3)] font-mono text-xs text-[var(--gray-500)]">
        <Loader2 size={14} className="animate-spin" />
        Loading latest repo health summary...
      </div>
    );
  }

  if (!banner || dismissed) return null;

  const isWarn = banner.tone === "warn";

  return (
    <div
      className={`px-4 py-3 rounded-xl border flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 ${
        isWarn
          ? "border-amber-500/20 bg-amber-500/10"
          : "border-[var(--accent-green)]/20 bg-[var(--accent-green)]/10"
      }`}
    >
      <div className="flex items-start gap-3">
        <div className="mt-0.5">
          {isWarn ? (
            <AlertTriangle size={15} className="text-amber-300" />
          ) : (
            <CheckCircle2 size={15} className="text-[var(--accent-green)]" />
          )}
        </div>
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Shield
              size={12}
              className={isWarn ? "text-amber-300" : "text-[var(--accent-green)]"}
            />
            <p
              className={`font-mono text-xs m-0 ${
                isWarn ? "text-amber-200" : "text-[var(--accent-green)]"
              }`}
            >
              {banner.title}
            </p>
          </div>
          <p className="font-mono text-xs text-[var(--gray-400)] m-0">
            {banner.body}
            {summary?.latestRun?.summary ? ` ${summary.latestRun.summary}` : ""}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <Link
          href={checksHref}
          className="px-3 py-1.5 rounded-lg border border-[var(--alpha-white-10)] bg-transparent font-mono text-xs text-[var(--gray-300)] hover:bg-[var(--alpha-white-5)] no-underline"
        >
          Open Checks
        </Link>
        <button
          onClick={handleDismiss}
          className="p-1 rounded-md text-[var(--gray-400)] hover:text-[var(--gray-200)] hover:bg-[var(--alpha-white-5)] transition-colors cursor-pointer"
          aria-label="Dismiss banner"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
}

