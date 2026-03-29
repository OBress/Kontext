"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { GlowCard } from "@/app/components/shared/GlowCard";
import {
  RepoCheckRunState,
  RepoHealthSummaryState,
  useAppStore,
} from "@/lib/store/app-store";
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Shield,
  Zap,
} from "lucide-react";

export function RepoHealthCard({
  repoFullName,
  checksHref,
}: {
  repoFullName: string;
  checksHref: string;
}) {
  const apiKey = useAppStore((s) => s.apiKey);
  const cachedSummary = useAppStore((s) => s.repoHealthSummaries[repoFullName]);
  const setRepoHealthSummary = useAppStore((s) => s.setRepoHealthSummary);
  const setRepoCheckRun = useAppStore((s) => s.setRepoCheckRun);
  const [summary, setSummary] = useState<RepoHealthSummaryState | null>(
    cachedSummary || null
  );
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const fetchSummary = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/repos/checks/summary?repo=${encodeURIComponent(repoFullName)}`
      );
      if (!res.ok) throw new Error("Failed to load repo health");
      const data = (await res.json()) as {
        openCount: number;
        criticalCount: number;
        highCount: number;
        resolvedRecently: number;
        latestRun: {
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
      };

      const normalized: RepoHealthSummaryState = {
        openCount: data.openCount || 0,
        criticalCount: data.criticalCount || 0,
        highCount: data.highCount || 0,
        resolvedRecently: data.resolvedRecently || 0,
        latestRun: data.latestRun
          ? {
              id: data.latestRun.id,
              repoFullName,
              status: data.latestRun.status,
              triggerMode: data.latestRun.trigger_mode,
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

  useEffect(() => {
    fetchSummary();
  }, [fetchSummary]);

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

      setMessage(data.summary || "Repo checks started.");
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
      await fetchSummary();
    } catch (error: unknown) {
      setMessage(error instanceof Error ? error.message : "Failed to run checks");
    } finally {
      setRunning(false);
    }
  };

  return (
    <GlowCard glowColor="none" className="p-5 md:col-span-2">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Shield size={16} className="text-[var(--accent-amber)]" />
            <h3 className="font-mono text-sm font-medium text-[var(--gray-200)] m-0">
              Repo Health
            </h3>
          </div>
          <p className="font-mono text-xs text-[var(--gray-500)] m-0">
            Continuous security, optimization, consistency, and change-impact review.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={runChecks}
            disabled={running}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-mono bg-[var(--accent-green)]/10 text-[var(--accent-green)] border border-[var(--accent-green)]/20 hover:bg-[var(--accent-green)]/20 disabled:opacity-50 cursor-pointer"
          >
            {running ? <Loader2 size={13} className="animate-spin" /> : <Zap size={13} />}
            Run Checks
          </button>
          <Link
            href={checksHref}
            className="px-3 py-1.5 rounded-lg text-xs font-mono text-[var(--gray-300)] border border-[var(--alpha-white-10)] hover:bg-[var(--alpha-white-5)] no-underline"
          >
            Open Checks
          </Link>
        </div>
      </div>

      {loading ? (
        <div className="mt-4 flex items-center gap-2 font-mono text-xs text-[var(--gray-500)]">
          <Loader2 size={14} className="animate-spin" />
          Loading repo health...
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mt-4">
            <div className="rounded-lg bg-[var(--alpha-white-5)] p-3">
              <p className="font-mono text-xs uppercase text-[var(--gray-500)] m-0 mb-1">
                Open
              </p>
              <p className="font-mono text-lg text-[var(--gray-100)] m-0">
                {summary?.openCount || 0}
              </p>
            </div>
            <div className="rounded-lg bg-[var(--alpha-white-5)] p-3">
              <p className="font-mono text-xs uppercase text-[var(--gray-500)] m-0 mb-1">
                Critical
              </p>
              <p className="font-mono text-lg text-red-300 m-0">
                {summary?.criticalCount || 0}
              </p>
            </div>
            <div className="rounded-lg bg-[var(--alpha-white-5)] p-3">
              <p className="font-mono text-xs uppercase text-[var(--gray-500)] m-0 mb-1">
                High
              </p>
              <p className="font-mono text-lg text-amber-300 m-0">
                {summary?.highCount || 0}
              </p>
            </div>
            <div className="rounded-lg bg-[var(--alpha-white-5)] p-3">
              <p className="font-mono text-xs uppercase text-[var(--gray-500)] m-0 mb-1">
                Medium
              </p>
              <p className="font-mono text-lg text-blue-300 m-0">
                {Math.max(0, (summary?.openCount || 0) - (summary?.criticalCount || 0) - (summary?.highCount || 0))}
              </p>
            </div>
            <div className="rounded-lg bg-[var(--alpha-white-5)] p-3">
              <p className="font-mono text-xs uppercase text-[var(--gray-500)] m-0 mb-1">
                Resolved
              </p>
              <p className="font-mono text-lg text-[var(--accent-green)] m-0">
                {summary?.resolvedRecently || 0}
              </p>
            </div>
          </div>

          <div className="mt-4 rounded-lg border border-[var(--alpha-white-8)] bg-[var(--alpha-white-3)] px-3 py-3">
            {summary?.latestRun ? (
              <div className="space-y-1">
                <div className="flex items-center gap-2 font-mono text-xs text-[var(--gray-300)]">
                  {(summary.openCount || 0) > 0 ? (
                    <AlertTriangle size={13} className="text-amber-300" />
                  ) : (
                    <CheckCircle2 size={13} className="text-[var(--accent-green)]" />
                  )}
                  Latest run {new Date(summary.latestRun.createdAt).toLocaleString()}
                </div>
                <p className="font-mono text-xs text-[var(--gray-500)] m-0">
                  {summary.latestRun.summary || "No summary yet."}
                </p>
                <p className="font-mono text-xs text-[var(--gray-400)] m-0">
                  {summary.latestRun.newFindings} new, {summary.latestRun.resolvedFindings} resolved,{" "}
                  {summary.latestRun.findingsTotal} current findings
                </p>
              </div>
            ) : (
              <p className="font-mono text-xs text-[var(--gray-500)] m-0">
                No automated checks have been run for this repository yet.
              </p>
            )}
          </div>

          {message && (
            <p className="mt-3 font-mono text-xs text-[var(--gray-400)] m-0">
              {message}
            </p>
          )}
        </>
      )}
    </GlowCard>
  );
}
