"use client";

import { useState, useCallback } from "react";
import { useAppStore } from "@/lib/store/app-store";
import { useCurrentRepo } from "@/hooks/use-current-repo";
import {
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Settings2,
  Zap,
  Radio,
  Brain,
  Sparkles,
  Eye,
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
}

export function SyncStatusCard() {
  const activeRepo = useCurrentRepo();
  const { apiKey, updateRepo } = useAppStore();
  const [checking, setChecking] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [checkResult, setCheckResult] = useState<SyncCheckResult | null>(null);
  const [syncProgress, setSyncProgress] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  const checkForUpdates = useCallback(async () => {
    if (!activeRepo || !apiKey) return;
    setChecking(true);
    setError(null);

    try {
      const res = await fetch(
        `/api/repos/sync/check?repo=${encodeURIComponent(activeRepo.full_name)}`,
        { headers: { "x-google-api-key": apiKey } }
      );

      if (!res.ok) throw new Error("Failed to check for updates");
      const data: SyncCheckResult = await res.json();
      setCheckResult(data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setChecking(false);
    }
  }, [activeRepo, apiKey]);

  const runSync = useCallback(async () => {
    if (!activeRepo || !apiKey) return;
    setSyncing(true);
    setSyncProgress("Starting sync...");
    setError(null);

    try {
      const res = await fetch("/api/repos/sync", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-google-api-key": apiKey,
        },
        body: JSON.stringify({ repo_full_name: activeRepo.full_name }),
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
              const data = JSON.parse(line.slice(6));
              if (data.message) setSyncProgress(data.message);
              if (data.status === "done") {
                setCheckResult(null); // Reset so user checks again
                // Refresh repo data
                updateRepo(activeRepo.full_name, {
                  last_synced_sha: data.lastSyncedSha,
                });
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
  }, [activeRepo, apiKey, updateRepo]);

  if (!activeRepo?.indexed) return null;

  const hasSha = !!activeRepo.last_synced_sha;

  return (
    <div className="rounded-xl border border-[var(--alpha-white-5)] bg-[var(--alpha-white-3)] p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-mono font-semibold text-[var(--gray-200)] flex items-center gap-2">
          <Radio size={15} className="text-[var(--accent-green)]" />
          Sync Status
        </h3>
        {activeRepo.auto_sync_enabled && (
          <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            Auto-sync ON
          </span>
        )}
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
                <p className="text-[10px] mt-1 opacity-75">
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
        <div className="mb-3 p-3 rounded-lg bg-blue-500/10 border border-blue-500/20 text-xs font-mono text-blue-300 flex items-center gap-2">
          <Loader2 size={14} className="animate-spin" />
          {syncProgress}
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
    </div>
  );
}

// ─── Sync Settings Card ────────────────────────────────────────────

const TIER_CONFIG = [
  {
    value: 1,
    label: "Quick Scan",
    icon: Eye,
    description: "Regex analysis + key file embedding only",
    cost: "~Free",
    color: "text-emerald-400",
  },
  {
    value: 2,
    label: "Standard",
    icon: Brain,
    description: "Full codebase embedding with 3072-dim vectors",
    cost: "$0.02-0.10",
    color: "text-blue-400",
  },
  {
    value: 3,
    label: "Deep Dive",
    icon: Sparkles,
    description: "Full embedding + LLM summaries per file",
    cost: "$0.10-0.50",
    color: "text-purple-400",
  },
];

export function SyncSettingsCard() {
  const activeRepo = useCurrentRepo();
  const { apiKey, updateRepo } = useAppStore();
  const [saving, setSaving] = useState(false);
  const [autoSync, setAutoSync] = useState(activeRepo?.auto_sync_enabled || false);
  const [tier, setTier] = useState<number>(activeRepo?.understanding_tier || 2);
  const [branch, setBranch] = useState(activeRepo?.watched_branch || activeRepo?.default_branch || "main");
  const [message, setMessage] = useState<string | null>(null);

  const saveSettings = useCallback(async (updates: Record<string, unknown>) => {
    if (!activeRepo || !apiKey) return;
    setSaving(true);
    setMessage(null);

    try {
      const res = await fetch("/api/repos/sync/settings", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "x-google-api-key": apiKey,
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
  }, [activeRepo, apiKey, updateRepo]);

  if (!activeRepo?.indexed) return null;

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
          <p className="text-[10px] font-mono text-[var(--gray-500)] mt-0.5">
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
      <div className="mb-4 pb-4 border-b border-[var(--alpha-white-5)]">
        <label className="text-xs font-mono text-[var(--gray-300)] block mb-1.5">Watched Branch</label>
        <div className="flex gap-2">
          <input
            type="text"
            value={branch}
            onChange={(e) => setBranch(e.target.value)}
            className="flex-1 px-3 py-1.5 text-xs font-mono rounded-lg
              bg-[var(--alpha-white-5)] border border-[var(--alpha-white-10)]
              text-[var(--gray-200)] placeholder:text-[var(--gray-600)]
              focus:outline-none focus:border-[var(--accent-green)]/50"
            placeholder="main"
          />
          <button
            onClick={() => saveSettings({ watched_branch: branch })}
            disabled={saving}
            className="px-3 py-1.5 text-xs font-mono rounded-lg
              bg-[var(--alpha-white-5)] border border-[var(--alpha-white-10)]
              text-[var(--gray-400)] hover:text-white transition-colors
              disabled:opacity-50"
          >
            Save
          </button>
        </div>
      </div>

      {/* Understanding Tier */}
      <div>
        <label className="text-xs font-mono text-[var(--gray-300)] block mb-2">Understanding Tier</label>
        <div className="space-y-2">
          {TIER_CONFIG.map((t) => (
            <button
              key={t.value}
              onClick={() => {
                setTier(t.value);
                saveSettings({ understanding_tier: t.value });
              }}
              disabled={saving}
              className={`w-full flex items-start gap-3 p-3 rounded-lg text-left transition-all ${
                tier === t.value
                  ? "bg-[var(--accent-green)]/10 border border-[var(--accent-green)]/30"
                  : "bg-[var(--alpha-white-3)] border border-[var(--alpha-white-5)] hover:border-[var(--alpha-white-10)]"
              }`}
            >
              <t.icon size={16} className={`mt-0.5 ${t.color}`} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-mono font-semibold text-[var(--gray-200)]">{t.label}</span>
                  <span className="text-[10px] font-mono text-[var(--gray-500)]">{t.cost}</span>
                </div>
                <p className="text-[10px] font-mono text-[var(--gray-500)] mt-0.5">{t.description}</p>
              </div>
            </button>
          ))}
        </div>
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
