"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { useAppStore, type RepoJobState } from "@/lib/store/app-store";
import { GlowCard } from "@/app/components/shared/GlowCard";
import { AnimatedCounter } from "@/app/components/shared/AnimatedCounter";
import { RepoHealthCard } from "@/app/components/repo/RepoHealthCard";
import { RepoCheckSummaryBanner } from "@/app/components/repo/RepoCheckSummaryBanner";
import { SyncStatusCard } from "@/app/components/repo/SyncPanel";
import { motion, AnimatePresence } from "framer-motion";
import {
  Database,
  MessageSquare,
  Network,
  Shield,
  Wand2,
  Server,
  Users,
  Loader2,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  X,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";

export default function RepoOverviewPage() {
  const params = useParams<{ owner: string; name: string }>();
  const basePath = `/repo/${params.owner}/${params.name}`;
  const fullName = `${params.owner}/${params.name}`;

  const repo = useAppStore((s) =>
    s.repos.find((r) => r.full_name === fullName)
  );
  const ingestionStatus = useAppStore((s) => s.ingestionStatus[fullName]);
  const repoJobs = useAppStore((s) => s.repoJobs);

  // Find the latest sync job for this repo
  const syncJob = useMemo(() => {
    const jobs = Object.values(repoJobs)
      .filter(
        (j: RepoJobState) =>
          j.repoFullName === fullName && j.jobType === "sync"
      )
      .sort(
        (a, b) =>
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      );
    return jobs[0] || null;
  }, [repoJobs, fullName]);

  const isSyncRunning =
    syncJob &&
    (syncJob.status === "queued" || syncJob.status === "running");

  // Only show completed/failed banners for syncs that finished recently (60s)
  const RECENCY_WINDOW_MS = 60_000;
  const syncFinishedRecently = syncJob?.updatedAt
    ? Date.now() - new Date(syncJob.updatedAt).getTime() < RECENCY_WINDOW_MS
    : false;
  const isSyncDone = syncJob?.status === "completed" && syncFinishedRecently;
  const isSyncFailed = syncJob?.status === "failed" && syncFinishedRecently;

  // Track whether we witnessed this sync running — prevents the completion
  // toast from flashing in when navigating to a page with an already-done sync
  const witnessedSyncIdRef = useRef<number | null>(null);
  if (isSyncRunning && syncJob) {
    witnessedSyncIdRef.current = syncJob.id;
  }
  const witnessedThisSync = syncJob
    ? witnessedSyncIdRef.current === syncJob.id
    : false;

  // Show sync completion toast — click-to-dismiss or auto-dismiss after 15s
  const [syncDoneDismissed, setSyncDoneDismissed] = useState(false);
  const showSyncDone = isSyncDone && witnessedThisSync && !syncDoneDismissed;

  // Reset dismissed state when a new sync completes
  const syncDoneKey = syncJob?.id ?? 0;
  useEffect(() => {
    setSyncDoneDismissed(false);
  }, [syncDoneKey]);

  // Auto-dismiss after 15s
  useEffect(() => {
    if (!showSyncDone) return;
    const timeout = setTimeout(() => setSyncDoneDismissed(true), 15_000);
    return () => clearTimeout(timeout);
  }, [showSyncDone]);

  // Show sync failed — only if witnessed running
  const showSyncFailed = isSyncFailed && witnessedThisSync;

  const syncMeta = syncJob?.metadata as Record<string, unknown> | undefined;
  const syncBaseSha = (syncMeta?.baseSha as string) || null;
  const syncHeadSha = (syncMeta?.headSha as string) || null;
  const syncFilesChanged = (syncMeta?.filesChanged as number) || 0;
  const syncPhase = (syncMeta?.phase as string) || null;

  const isIngesting =
    ingestionStatus &&
    ingestionStatus.status !== "done" &&
    ingestionStatus.status !== "error" &&
    ingestionStatus.status !== "blocked_quota" &&
    ingestionStatus.status !== "blocked_billing" &&
    ingestionStatus.status !== "blocked_model" &&
    ingestionStatus.status !== "pending_user_key_sync" &&
    ingestionStatus.status !== "idle";

  const isDone = ingestionStatus?.status === "done";
  const isError =
    ingestionStatus?.status === "error" ||
    ingestionStatus?.status === "blocked_quota" ||
    ingestionStatus?.status === "blocked_billing" ||
    ingestionStatus?.status === "blocked_model" ||
    ingestionStatus?.status === "pending_user_key_sync";

  return (
    <div className="space-y-6">
      {/* Ingestion Progress Panel — shown when actively ingesting */}
      {isIngesting && (() => {
        const waiting = ingestionStatus.isWaiting === true;
        const accentColor = waiting ? "#D97706" : "var(--accent-green)";
        const barGradient = waiting
          ? "linear-gradient(90deg, #D97706, #F59E0B)"
          : "linear-gradient(90deg, #238636, #3FB950)";

        return (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
          >
            <GlowCard glowColor={waiting ? "none" : "cyan"} className="p-6">
              <div className="flex items-center gap-3 mb-4">
                <Loader2
                  size={18}
                  className={waiting ? "text-amber-500 animate-pulse" : "text-[var(--accent-green)] animate-spin"}
                />
                <h3 className="font-mono text-sm font-medium text-[var(--gray-200)] m-0">
                  {waiting ? "Rate Limit — Waiting for Cooldown" : "Ingesting Repository..."}
                </h3>
                <span className="ml-auto font-mono text-lg font-semibold" style={{ color: accentColor }}>
                  {ingestionStatus.progress}%
                </span>
              </div>

              {/* Progress bar */}
              <div className="w-full h-2 rounded-full bg-[var(--alpha-white-8)] overflow-hidden mb-4">
                <motion.div
                  className={`h-full rounded-full ${waiting ? "animate-pulse" : ""}`}
                  style={{ background: barGradient }}
                  initial={{ width: "0%" }}
                  animate={{ width: `${ingestionStatus.progress}%` }}
                  transition={{ duration: 0.4, ease: "easeOut" }}
                />
              </div>

              {/* Status details */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div>
                  <p className="font-mono text-xs uppercase text-[var(--gray-500)] m-0 mb-1">Status</p>
                  <p className={`font-mono text-xs m-0 capitalize ${waiting ? "text-amber-400" : "text-[var(--gray-200)]"}`}>
                    {waiting ? "⏸ Waiting" : ingestionStatus.status}
                  </p>
                </div>
                <div>
                  <p className="font-mono text-xs uppercase text-[var(--gray-500)] m-0 mb-1">Files</p>
                  <p className="font-mono text-xs text-[var(--gray-200)] m-0">
                    {ingestionStatus.filesProcessed.toLocaleString()} / {ingestionStatus.filesTotal ? ingestionStatus.filesTotal.toLocaleString() : "—"}
                  </p>
                </div>
                <div>
                  <p className="font-mono text-xs uppercase text-[var(--gray-500)] m-0 mb-1">Chunks</p>
                  <p className="font-mono text-xs text-[var(--gray-200)] m-0">
                    {ingestionStatus.chunksTotal ? ingestionStatus.chunksTotal.toLocaleString() : ingestionStatus.chunksCreated.toLocaleString()}
                  </p>
                </div>
                <div>
                  <p className="font-mono text-xs uppercase text-[var(--gray-500)] m-0 mb-1">Embeddings</p>
                  <p className="font-mono text-xs text-[var(--gray-200)] m-0">
                    {ingestionStatus.status === "embedding" || ingestionStatus.status === "finalizing"
                      ? `${ingestionStatus.chunksCreated.toLocaleString()} / ${ingestionStatus.chunksTotal ? ingestionStatus.chunksTotal.toLocaleString() : "—"}`
                      : "Waiting..."}
                  </p>
                </div>
              </div>

              <p className={`font-mono text-xs mt-3 m-0 ${waiting ? "text-amber-400/70" : "text-[var(--gray-500)]"}`}>
                {ingestionStatus.message}
              </p>
            </GlowCard>
          </motion.div>
        );
      })()}

      {/* Error state */}
      {isError && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <GlowCard glowColor="none" className="p-5 border-[var(--accent-red)]/20">
            <div className="flex items-center gap-2 mb-2">
              <AlertCircle size={16} className="text-[var(--accent-red)]" />
              <h3 className="font-mono text-sm font-medium text-[var(--accent-red)] m-0">
                Ingestion Failed
              </h3>
              <RetryIngestionButton fullName={fullName} />
            </div>
            <p className="font-mono text-xs text-[var(--gray-400)] m-0">
              {ingestionStatus.error || "An unknown error occurred during ingestion."}
            </p>
          </GlowCard>
        </motion.div>
      )}

      {/* Done toast */}
      {isDone && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <GlowCard glowColor="green" className="p-5">
            <div className="flex items-center gap-2">
              <CheckCircle2 size={16} className="text-[var(--accent-green)]" />
              <h3 className="font-mono text-sm font-medium text-[var(--accent-green)] m-0">
                Ingestion Complete
              </h3>
              <span className="ml-auto font-mono text-xs text-[var(--gray-400)]">
                {ingestionStatus.chunksCreated} chunks embedded
              </span>
            </div>
          </GlowCard>
        </motion.div>
      )}

      {/* Background Sync Progress Banner */}
      <AnimatePresence>
        {isSyncRunning && !isIngesting && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.3 }}
          >
            <GlowCard glowColor="cyan" className="p-6">
              <div className="flex items-center gap-3 mb-4">
                <RefreshCw size={18} className="text-blue-400 animate-spin" />
                <h3 className="font-mono text-sm font-medium text-[var(--gray-200)] m-0">
                  {syncJob.title || 'Syncing Repository...'}
                </h3>
                {syncJob.progressPercent > 0 && (
                  <span className="ml-auto font-mono text-lg font-semibold text-blue-400">
                    {syncJob.progressPercent}%
                  </span>
                )}
              </div>

              {/* Progress bar */}
              <div className="w-full h-2 rounded-full bg-[var(--alpha-white-8)] overflow-hidden mb-4">
                <motion.div
                  className="h-full rounded-full"
                  style={{
                    background: "linear-gradient(90deg, #1d4ed8, #3b82f6)",
                  }}
                  initial={{ width: "0%" }}
                  animate={{ width: `${syncJob.progressPercent}%` }}
                  transition={{ duration: 0.4, ease: "easeOut" }}
                />
              </div>

              {/* Metadata grid */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div>
                  <p className="font-mono text-xs uppercase text-[var(--gray-500)] m-0 mb-1">Phase</p>
                  <p className="font-mono text-xs text-blue-300 m-0 capitalize">
                    {syncPhase || syncJob.status}
                  </p>
                </div>
                <div>
                  <p className="font-mono text-xs uppercase text-[var(--gray-500)] m-0 mb-1">Trigger</p>
                  <p className="font-mono text-xs text-[var(--gray-200)] m-0 capitalize">
                    {syncJob.trigger}
                  </p>
                </div>
                <div>
                  <p className="font-mono text-xs uppercase text-[var(--gray-500)] m-0 mb-1">Files</p>
                  <p className="font-mono text-xs text-[var(--gray-200)] m-0">
                    {syncFilesChanged > 0 ? `${syncFilesChanged} changed` : '—'}
                  </p>
                </div>
                <div>
                  <p className="font-mono text-xs uppercase text-[var(--gray-500)] m-0 mb-1">Range</p>
                  <p className="font-mono text-xs text-[var(--gray-200)] m-0">
                    {syncBaseSha && syncHeadSha
                      ? `${syncBaseSha.slice(0, 7)} → ${syncHeadSha.slice(0, 7)}`
                      : '—'}
                  </p>
                </div>
              </div>
            </GlowCard>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Sync Complete Toast */}
      <AnimatePresence>
        {showSyncDone && !isIngesting && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.3 }}
          >
            <GlowCard glowColor="cyan" className="p-5 cursor-pointer hover:border-blue-500/30 transition-colors" onClick={() => setSyncDoneDismissed(true)}>
              <div className="flex items-center gap-2">
                <CheckCircle2 size={16} className="text-blue-400" />
                <h3 className="font-mono text-sm font-medium text-blue-400 m-0">
                  Sync Complete
                </h3>
                <span className="ml-auto font-mono text-xs text-[var(--gray-400)]">
                  {syncJob?.resultSummary || `${syncFilesChanged} files synced`}
                </span>
                <X size={14} className="text-[var(--gray-500)] hover:text-[var(--gray-300)] ml-2 shrink-0" />
              </div>
            </GlowCard>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Sync Failed Alert */}
      <AnimatePresence>
        {showSyncFailed && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
          >
            <GlowCard glowColor="none" className="p-5 border-[var(--accent-red)]/20">
              <div className="flex items-center gap-2 mb-2">
                <AlertCircle size={16} className="text-[var(--accent-red)]" />
                <h3 className="font-mono text-sm font-medium text-[var(--accent-red)] m-0">
                  Sync Failed
                </h3>
              </div>
              <p className="font-mono text-xs text-[var(--gray-400)] m-0">
                {syncJob?.errorMessage || 'An unknown error occurred during sync.'}
              </p>
            </GlowCard>
          </motion.div>
        )}
      </AnimatePresence>
      {repo?.indexed && (
        <RepoCheckSummaryBanner
          repoFullName={fullName}
          checksHref={`${basePath}/checks`}
          lastSyncedSha={repo.last_synced_sha}
        />
      )}

      {/* Bento grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {repo?.indexed && (
          <RepoHealthCard
            repoFullName={fullName}
            checksHref={`${basePath}/checks`}
          />
        )}

        {/* Combined Sync + Ingestion Status Card */}
        <GlowCard glowColor="green" className="p-5 md:col-span-2 lg:col-span-1">
          {/* Sync Status Section */}
          {repo?.indexed && (
            <>
              <SyncStatusCard embedded />
              <div className="border-t border-[var(--alpha-white-8)] my-4" />
            </>
          )}

          {/* Ingestion Status Section */}
          <div className="flex items-center gap-2 mb-3">
            <Database size={16} className="text-[var(--accent-green)]" />
            <h3 className="font-mono text-sm font-medium text-[var(--gray-200)] m-0">
              Ingestion Status
            </h3>
          </div>
          <div className="flex items-center gap-4">
            <div className="relative w-16 h-16">
              <svg className="w-16 h-16 -rotate-90" viewBox="0 0 36 36">
                <circle cx="18" cy="18" r="15.5" fill="none" stroke="var(--alpha-white-5)" strokeWidth="2" />
                <circle
                  cx="18" cy="18" r="15.5" fill="none"
                  stroke={repo?.indexed ? "var(--accent-green)" : "var(--gray-600)"}
                  strokeWidth="2"
                  strokeDasharray="97.4"
                  strokeDashoffset={repo?.indexed ? "0" : "97.4"}
                  strokeLinecap="round"
                />
              </svg>
              <span className={`absolute inset-0 flex items-center justify-center font-mono text-xs ${
                repo?.indexed ? "text-[var(--accent-green)]" : "text-[var(--gray-500)]"
              }`}>
                {repo?.indexed ? "100%" : "0%"}
              </span>
            </div>
            <div className="space-y-1">
              <p className="font-mono text-xs text-[var(--gray-400)] m-0">
                <span className="text-[var(--gray-200)]">
                  <AnimatedCounter value={repo?.chunk_count || 0} />
                </span> chunks embedded
              </p>
              <p className="font-mono text-xs text-[var(--gray-400)] m-0">
                {repo?.indexed ? (
                  <span className="text-[var(--accent-green)]">Ready for AI queries</span>
                ) : (
                  <span className="text-[var(--gray-500)]">Not yet indexed</span>
                )}
              </p>
              <p className="font-mono text-xs text-[var(--gray-400)] m-0">
                1536-dim Gemini embeddings
              </p>
            </div>
          </div>
        </GlowCard>

        {/* Quick links */}
        <QuickLink
          href={`${basePath}/chat`}
          icon={MessageSquare}
          label="Chat"
          description="Ask questions about this codebase"
          color="var(--accent-green)"
          disabled={!repo?.indexed}
        />
        <QuickLink
          href={`${basePath}/graph`}
          icon={Network}
          label="Architecture"
          description="2D dependency visualization"
          color="var(--accent-muted)"
          disabled={!repo?.indexed}
        />
        <QuickLink
          href={`${basePath}/prompts`}
          icon={Wand2}
          label="Prompts"
          description="Generate AI system prompts"
          color="var(--accent-yellow)"
          disabled={!repo?.indexed}
        />
        <QuickLink
          href={`${basePath}/checks`}
          icon={Shield}
          label="Checks"
          description="Automated repo health and finding verification"
          color="var(--accent-amber)"
          disabled={!repo?.indexed}
        />
        <QuickLink
          href="/mcp"
          icon={Server}
          label="MCP Server"
          description="Model Context Protocol endpoint"
          color="var(--accent-green)"
          disabled={!repo?.indexed}
        />
        <QuickLink
          href={`${basePath}/team`}
          icon={Users}
          label="Team"
          description="Onboarding & access management"
          color="var(--accent-green)"
        />
      </div>
    </div>
  );
}

function RetryIngestionButton({ fullName }: { fullName: string }) {
  const [retrying, setRetrying] = useState(false);
  const { apiKey, setIngestionStatus, updateRepo } = useAppStore();

  const handleRetry = async () => {
    if (!apiKey || retrying) return;
    setRetrying(true);

    setIngestionStatus(fullName, {
      status: "fetching",
      progress: 0,
      filesTotal: 0,
      filesProcessed: 0,
      chunksCreated: 0,
      chunksTotal: 0,
      message: "Retrying ingestion...",
    });
    updateRepo(fullName, { indexing: true });

    try {
      const { streamIngestion } = await import("@/lib/client/ingestion-stream");
      await streamIngestion(
        fullName,
        apiKey,
        { repo_full_name: fullName },
        { setIngestionStatus, updateRepo }
      );
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : "Retry failed";
      setIngestionStatus(fullName, {
        status: "error",
        progress: 0,
        filesTotal: 0,
        filesProcessed: 0,
        chunksCreated: 0,
        chunksTotal: 0,
        error: errMsg,
        message: errMsg,
      });
      updateRepo(fullName, { indexing: false });
    } finally {
      setRetrying(false);
    }
  };

  if (!apiKey) return null;

  return (
    <button
      onClick={handleRetry}
      disabled={retrying}
      className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-mono text-xs bg-[var(--surface-2)] border border-[var(--alpha-white-10)] text-[var(--gray-300)] hover:text-[var(--gray-100)] hover:bg-[var(--surface-3)] transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
    >
      {retrying ? (
        <Loader2 size={12} className="animate-spin" />
      ) : (
        <RefreshCw size={12} />
      )}
      {retrying ? "Retrying..." : "Retry"}
    </button>
  );
}

function QuickLink({
  href,
  icon: Icon,
  label,
  description,
  color,
  disabled,
}: {
  href: string;
  icon: LucideIcon;
  label: string;
  description: string;
  color: string;
  disabled?: boolean;
}) {
  if (disabled) {
    return (
      <div className="opacity-40 cursor-not-allowed">
        <GlowCard glowColor="none" className="p-5 h-full">
          <div className="flex items-center gap-2 mb-2">
            <Icon size={16} style={{ color }} />
            <h3 className="font-mono text-sm font-medium text-[var(--gray-200)] m-0">
              {label}
            </h3>
          </div>
          <p className="font-mono text-xs text-[var(--gray-500)] m-0 leading-relaxed">
            {description}
          </p>
          <p className="font-mono text-xs text-[var(--gray-600)] mt-2 m-0">
            Available after indexing
          </p>
        </GlowCard>
      </div>
    );
  }

  return (
    <Link href={href} className="no-underline">
      <GlowCard glowColor="cyan" className="p-5 h-full hover:translate-y-[-2px] transition-transform duration-200">
        <div className="flex items-center gap-2 mb-2">
          <Icon size={16} style={{ color }} />
          <h3 className="font-mono text-sm font-medium text-[var(--gray-200)] m-0">
            {label}
          </h3>
        </div>
        <p className="font-mono text-xs text-[var(--gray-500)] m-0 leading-relaxed">
          {description}
        </p>
      </GlowCard>
    </Link>
  );
}
