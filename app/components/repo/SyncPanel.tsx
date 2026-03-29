"use client";

import { useState, useCallback, useEffect } from "react";
import { useAppStore } from "@/lib/store/app-store";
import { useCurrentRepo } from "@/hooks/use-current-repo";
import { BranchDropdown } from "@/app/components/shared/BranchDropdown";
import { fetchRepoSnapshot } from "@/lib/client/repo-store";
import {
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Settings2,
  Zap,
  Radio,
} from "lucide-react";

interface SyncCheckResult {
  hasUpdates: boolean;
  currentSha: string;
  lastSyncedSha: string | null;
  newCommitCount: number;
  latestMessage: string;
  latestAuthor: string;
  latestDate: string;
  branch: string;
  autoSyncEnabled: boolean;
  understandingTier: number;
  syncBlockedReason?: string | null;
  pendingSyncHeadSha?: string | null;
}

interface SyncStreamEvent {
  status?: string;
  message?: string;
  lastSyncedSha?: string | null;
  pendingHeadSha?: string | null;
  newChunkCount?: number;
  chunksEmbedded?: number;
  chunksTotal?: number;
  filesChanged?: number;
  commitsTracked?: number;
  baseSha?: string;
  headSha?: string | null;
  usedPendingHead?: boolean;
}

function getSyncBlockedMessage(reason: string | null | undefined) {
  switch (reason) {
    case "pending_user_key_sync":
      return "A webhook detected new commits, but no server-side Google AI key was available to re-embed the changed files. Your browser key will be synced automatically — click below to retry.";
    case "blocked_quota":
      return "Sync is blocked because the Google project behind this key hit its Gemini embedding quota.";
    case "blocked_billing":
      return "Sync is blocked because the Google project behind this key needs active billing.";
    case "blocked_model":
      return "Sync is blocked because the configured Gemini model is unavailable for this key.";
    default:
      return null;
  }
}

function formatShortSha(sha: string | null | undefined) {
  return sha ? sha.slice(0, 7) : null;
}

export function SyncStatusCard({ embedded = false }: { embedded?: boolean }) {
  const activeRepo = useCurrentRepo();
  const { apiKey, updateRepo } = useAppStore();
  const [checking, setChecking] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [checkResult, setCheckResult] = useState<SyncCheckResult | null>(null);
  const [syncProgress, setSyncProgress] = useState<string>("");
  const [syncEvent, setSyncEvent] = useState<SyncStreamEvent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [registeringWebhook, setRegisteringWebhook] = useState(false);

  const hasWebhook = !!activeRepo?.webhook_id;

  const refreshRepoFromServer = useCallback(async () => {
    if (!activeRepo) return null;
    const repo = await fetchRepoSnapshot(activeRepo.full_name);
    if (repo) {
      updateRepo(activeRepo.full_name, repo);
    }
    return repo;
  }, [activeRepo, updateRepo]);

  const checkForUpdates = useCallback(async () => {
    if (!activeRepo) return;
    setChecking(true);
    setError(null);

    try {
      const res = await fetch(
        `/api/repos/sync/check?repo=${encodeURIComponent(activeRepo.full_name)}`
      );

      if (!res.ok) throw new Error("Failed to check for updates");
      const data: SyncCheckResult = await res.json();
      setCheckResult(data);
      updateRepo(activeRepo.full_name, {
        sync_blocked_reason: data.syncBlockedReason || null,
        pending_sync_head_sha: data.pendingSyncHeadSha || null,
      });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setChecking(false);
    }
  }, [activeRepo, updateRepo]);

  const runSync = useCallback(async () => {
    if (!activeRepo || !apiKey) return;
    const requestedHeadSha =
      activeRepo.sync_blocked_reason === "pending_user_key_sync"
        ? activeRepo.pending_sync_head_sha || null
        : checkResult?.currentSha || null;

    setSyncing(true);
    setSyncProgress(
      activeRepo.sync_blocked_reason === "pending_user_key_sync"
        ? "Replaying pending sync..."
        : "Starting sync..."
    );
    setSyncEvent(null);
    setError(null);

    try {
      const res = await fetch("/api/repos/sync", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-google-api-key": apiKey,
        },
        body: JSON.stringify({
          repo_full_name: activeRepo.full_name,
          ...(requestedHeadSha ? { head_sha: requestedHeadSha } : {}),
        }),
      });

      if (!res.ok) throw new Error("Sync failed to start");

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const text = decoder.decode(value);
          const lines = text.split("\n").filter((l) => l.startsWith("data: "));

          for (const line of lines) {
            try {
              const data = JSON.parse(line.slice(6)) as SyncStreamEvent;
              setSyncEvent((previous) => ({ ...(previous || {}), ...data }));
              if (data.message) setSyncProgress(data.message);
              if (data.status === "done") {
                setCheckResult(null); // Reset so user checks again
                updateRepo(activeRepo.full_name, {
                  last_synced_sha: data.lastSyncedSha,
                  chunk_count:
                    typeof data.newChunkCount === "number"
                      ? data.newChunkCount
                      : activeRepo.chunk_count,
                  sync_blocked_reason: null,
                  pending_sync_head_sha: null,
                });
                await refreshRepoFromServer();
              }
              if (
                data.status === "blocked_quota" ||
                data.status === "blocked_billing" ||
                data.status === "blocked_model" ||
                data.status === "pending_user_key_sync"
              ) {
                updateRepo(activeRepo.full_name, {
                  sync_blocked_reason: data.status,
                  pending_sync_head_sha:
                    data.pendingHeadSha || activeRepo.pending_sync_head_sha || null,
                });
                setError(data.message);
              }
              if (data.status === "error") {
                setError(data.message);
              }
            } catch {}
          }
        }
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setSyncing(false);
      setSyncProgress("");
    }
  }, [activeRepo, apiKey, checkResult?.currentSha, refreshRepoFromServer, updateRepo]);

  const tryRegisterWebhook = useCallback(async () => {
    if (!activeRepo) return;
    setRegisteringWebhook(true);
    setError(null);

    try {
      const res = await fetch("/api/repos/sync/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          repo_full_name: activeRepo.full_name,
          auto_sync_enabled: true,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to register webhook");
      }

      // Refresh repo data to pick up webhook_id
      const settingsRes = await fetch(
        `/api/repos/sync/settings?repo=${encodeURIComponent(activeRepo.full_name)}`
      );
      if (settingsRes.ok) {
        const settings = await settingsRes.json();
        updateRepo(activeRepo.full_name, {
          auto_sync_enabled: true,
          webhook_id: settings.hasWebhook ? 1 : null, // simplified — just track presence
        });
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setRegisteringWebhook(false);
    }
  }, [activeRepo, updateRepo]);

  if (!activeRepo?.indexed) return null;

  const hasSha = !!activeRepo.last_synced_sha;
  const blockedMessage = getSyncBlockedMessage(activeRepo.sync_blocked_reason);
  const syncRangeText =
    syncEvent?.baseSha && syncEvent?.headSha
      ? `${syncEvent.usedPendingHead ? "Replaying pending sync" : "Sync range"} ${formatShortSha(syncEvent.baseSha)} -> ${formatShortSha(syncEvent.headSha)}`
      : null;
  const syncScopeText =
    typeof syncEvent?.filesChanged === "number"
      ? `${syncEvent.filesChanged} changed file${syncEvent.filesChanged === 1 ? "" : "s"}`
      : null;

  const content = (
    <>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-mono font-semibold text-[var(--gray-200)] flex items-center gap-2 m-0">
          <Radio size={15} className="text-[var(--accent-green)]" />
          Sync Status
        </h3>
        <div className="flex items-center gap-2">
          {activeRepo.auto_sync_enabled && hasWebhook && (
            <span className="text-xs font-mono px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              Webhook
            </span>
          )}
          {activeRepo.auto_sync_enabled && !hasWebhook && (
            <span className="text-xs font-mono px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20">
              Polling
            </span>
          )}
          {!activeRepo.auto_sync_enabled && (
            <span className="text-xs font-mono px-2 py-0.5 rounded-full bg-[var(--alpha-white-5)] text-[var(--gray-500)] border border-[var(--alpha-white-8)]">
              Manual
            </span>
          )}
        </div>
      </div>

      {/* Current state */}
      {hasSha && (
        <div className="mb-3 text-xs font-mono text-[var(--gray-500)]">
          Last synced: <span className="text-[var(--gray-400)]">{activeRepo.last_synced_sha?.slice(0, 7)}</span>
          {activeRepo.watched_branch && (
            <span className="ml-2">
              on <span className="text-[var(--accent-green)]">{activeRepo.watched_branch}</span>
            </span>
          )}
        </div>
      )}

      {/* Polling mode notice with re-register option */}
      {activeRepo.auto_sync_enabled && !hasWebhook && (
        <div className="mb-3 rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-3 text-xs font-mono text-amber-200">
          <p className="m-0">
            Webhook unavailable — checking for updates every 5 minutes.
            This may happen if you don&apos;t have admin access to this repository.
          </p>
          <button
            onClick={tryRegisterWebhook}
            disabled={registeringWebhook}
            className="mt-2 flex items-center gap-1.5 px-2.5 py-1 text-xs font-mono rounded-md
              bg-amber-500/10 border border-amber-500/30
              text-amber-300 hover:bg-amber-500/20
              disabled:opacity-50 disabled:cursor-not-allowed transition-all cursor-pointer"
          >
            {registeringWebhook ? <Loader2 size={11} className="animate-spin" /> : <Zap size={11} />}
            Try Register Webhook
          </button>
        </div>
      )}

      {blockedMessage && !syncing && (
        <div className="mb-3 rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-3 text-xs font-mono text-amber-200">
          <p className="m-0">{blockedMessage}</p>
          {activeRepo.pending_sync_head_sha && (
            <p className="m-0 mt-1 text-xs text-amber-300/80">
              Pending head: {activeRepo.pending_sync_head_sha.slice(0, 7)}
            </p>
          )}
          {activeRepo.sync_blocked_reason === "pending_user_key_sync" && apiKey && !syncing && (
            <button
              onClick={runSync}
              className="mt-2 flex items-center gap-1.5 px-2.5 py-1 text-xs font-mono rounded-md
                bg-amber-500/10 border border-amber-500/30
                text-amber-300 hover:bg-amber-500/20
                transition-all cursor-pointer"
            >
              <Zap size={11} />
              Replay Pending Sync
            </button>
          )}
        </div>
      )}

      {/* Check result */}
      {checkResult && (
        <div className={`mb-3 p-3 rounded-lg text-xs font-mono ${
          checkResult.hasUpdates
            ? "bg-amber-500/10 border border-amber-500/20 text-amber-300"
            : "bg-emerald-500/10 border border-emerald-500/20 text-emerald-300"
          }`}
        >
          {checkResult.hasUpdates ? (
            <div className="flex items-start gap-2">
              <AlertCircle size={14} className="mt-0.5 shrink-0" />
              <div>
                <p className="font-semibold">{checkResult.newCommitCount} new commit{checkResult.newCommitCount !== 1 ? "s" : ""}</p>
                <p className="text-xs mt-1 opacity-75">
                  Latest: &quot;{checkResult.latestMessage.slice(0, 60)}&quot; by {checkResult.latestAuthor}
                </p>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <CheckCircle2 size={14} />
              <span>Up to date</span>
            </div>
          )}
        </div>
      )}

      {/* Sync progress */}
      {syncing && (
        <div className="mb-3 p-3 rounded-lg bg-blue-500/10 border border-blue-500/20 text-xs font-mono text-blue-300">
          <div className="flex items-center gap-2">
            <Loader2 size={14} className="animate-spin" />
            <span>{syncProgress}</span>
          </div>
          {(syncRangeText || syncScopeText) && (
            <div className="mt-2 space-y-1 text-[11px] text-blue-200/80">
              {syncRangeText && <p className="m-0">{syncRangeText}</p>}
              {syncScopeText && <p className="m-0">{syncScopeText}</p>}
            </div>
          )}
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="mb-3 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-xs font-mono text-red-300">
          {error}
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-2">
        <button
          onClick={checkForUpdates}
          disabled={checking || syncing}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono rounded-lg
            bg-[var(--alpha-white-5)] border border-[var(--alpha-white-10)]
            text-[var(--gray-300)] hover:text-white hover:bg-[var(--alpha-white-8)]
            disabled:opacity-50 disabled:cursor-not-allowed transition-all"
        >
          {checking ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
          Check Now
        </button>

        {checkResult?.hasUpdates && (
          <button
            onClick={runSync}
            disabled={syncing}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono rounded-lg
              bg-[var(--accent-green)]/10 border border-[var(--accent-green)]/30
              text-[var(--accent-green)] hover:bg-[var(--accent-green)]/20
              disabled:opacity-50 disabled:cursor-not-allowed transition-all"
          >
            {syncing ? <Loader2 size={13} className="animate-spin" /> : <Zap size={13} />}
            Sync Changes
          </button>
        )}
      </div>
    </>
  );

  if (embedded) return <div>{content}</div>;

  return (
    <div className="rounded-xl border border-[var(--alpha-white-5)] bg-[var(--alpha-white-3)] p-5">
      {content}
    </div>
  );
}

// ─── Sync Settings Card ────────────────────────────────────────────

export function SyncSettingsCard() {
  const activeRepo = useCurrentRepo();
  const { updateRepo } = useAppStore();
  const [saving, setSaving] = useState(false);
  const [autoSync, setAutoSync] = useState(activeRepo?.auto_sync_enabled || false);

  const [branch, setBranch] = useState(activeRepo?.watched_branch || activeRepo?.default_branch || "main");
  const [message, setMessage] = useState<string | null>(null);
  const [branches, setBranches] = useState<string[]>([]);
  const [branchesLoading, setBranchesLoading] = useState(false);

  // Fetch branches from GitHub on mount
  useEffect(() => {
    if (!activeRepo?.full_name) return;
    setBranchesLoading(true);
    fetch(`/api/repos/branches?repo=${encodeURIComponent(activeRepo.full_name)}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.branches) {
          setBranches(data.branches.map((b: { name: string }) => b.name));
        }
      })
      .catch(() => {
        // Fallback: show current branch as only option
      })
      .finally(() => setBranchesLoading(false));
  }, [activeRepo?.full_name]);

  const saveSettings = useCallback(async (updates: Record<string, unknown>) => {
    if (!activeRepo) return;
    setSaving(true);
    setMessage(null);

    try {
      const res = await fetch("/api/repos/sync/settings", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          repo_full_name: activeRepo.full_name,
          ...updates,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to save settings");
      }

      // Update local state
      updateRepo(activeRepo.full_name, updates as Record<string, unknown>);
      setMessage("Settings saved!");
      setTimeout(() => setMessage(null), 2000);
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : "Unknown error";
      setMessage(`Error: ${errMsg}`);
    } finally {
      setSaving(false);
    }
  }, [activeRepo, updateRepo]);

  if (!activeRepo?.indexed) return null;

  // Build the branch list: fetched branches, or fallback to current + default
  const branchOptions =
    branches.length > 0
      ? branches
      : [...new Set([branch, activeRepo.default_branch].filter((b): b is string => !!b))];

  return (
    <div className="rounded-xl border border-[var(--alpha-white-5)] bg-[var(--alpha-white-3)] p-5">
      <div className="flex items-center gap-2 mb-4">
        <Settings2 size={15} className="text-[var(--accent-green)]" />
        <h3 className="text-sm font-mono font-semibold text-[var(--gray-200)]">Sync Settings</h3>
      </div>

      {/* Auto-sync toggle */}
      <div className="flex items-center justify-between mb-4 pb-4 border-b border-[var(--alpha-white-5)]">
        <div>
          <p className="text-xs font-mono text-[var(--gray-300)]">Auto-sync</p>
          <p className="text-xs font-mono text-[var(--gray-500)] mt-0.5">
            Webhook monitors pushes to the watched branch
          </p>
        </div>
        <button
          onClick={() => {
            const newValue = !autoSync;
            setAutoSync(newValue);
            saveSettings({ auto_sync_enabled: newValue });
          }}
          disabled={saving}
          className={`relative w-10 h-5 rounded-full transition-colors ${
            autoSync ? "bg-emerald-500" : "bg-[var(--alpha-white-10)]"
          }`}
        >
          <span
            className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
              autoSync ? "left-5" : "left-0.5"
            }`}
          />
        </button>
      </div>

      {/* Branch */}
      <div>
        <label className="text-xs font-mono text-[var(--gray-300)] block mb-1.5">Watched Branch</label>
        <BranchDropdown
          value={branch}
          onChange={(newBranch) => {
            setBranch(newBranch);
            saveSettings({ watched_branch: newBranch });
          }}
          branches={branchOptions}
          loading={branchesLoading}
        />
      </div>

      {/* Save message */}
      {message && (
        <p className={`mt-3 text-xs font-mono ${
          message.startsWith("Error") ? "text-red-400" : "text-emerald-400"
        }`}>
          {message}
        </p>
      )}
    </div>
  );
}
