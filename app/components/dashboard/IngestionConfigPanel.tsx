"use client";

import { motion } from "framer-motion";
import {
  GitCommitHorizontal,
  RefreshCw,
} from "lucide-react";
import { BranchDropdown } from "@/app/components/shared/BranchDropdown";

export interface IngestionConfig {
  watched_branch: string;
  backfill_timeline: boolean;
  auto_sync_enabled: boolean;
  timeline_commit_depth: number;
}

export const DEFAULT_INGESTION_CONFIG: IngestionConfig = {
  watched_branch: "main",
  backfill_timeline: true,
  auto_sync_enabled: true,
  timeline_commit_depth: 1000,
};

interface IngestionConfigPanelProps {
  config: IngestionConfig;
  onChange: (config: IngestionConfig) => void;
  repoName?: string;
  defaultBranch?: string;
  branches?: string[];
  branchesLoading?: boolean;
}


const DEPTH_OPTIONS = [
  { value: 20, label: "20" },
  { value: 50, label: "50" },
  { value: 100, label: "100" },
  { value: 1000, label: "All" },
];

function Toggle({ on }: { on: boolean }) {
  return (
    <div
      className="relative w-9 h-5 rounded-full transition-colors shrink-0"
      style={{ background: on ? "var(--accent-green)" : "var(--surface-4)" }}
    >
      <motion.div
        className="absolute top-[3px] w-3.5 h-3.5 rounded-full bg-white"
        animate={{ left: on ? 17 : 3 }}
        transition={{ type: "spring", stiffness: 500, damping: 30 }}
      />
    </div>
  );
}

export function IngestionConfigPanel({
  config,
  onChange,
  repoName,
  defaultBranch,
  branches,
  branchesLoading,
}: IngestionConfigPanelProps) {
  const update = (partial: Partial<IngestionConfig>) => {
    onChange({ ...config, ...partial });
  };

  return (
    <div className="flex flex-col">
      {/* Repo context bar */}
      {repoName && (
        <div className="px-5 py-2 border-b border-[var(--alpha-white-5)] bg-[var(--accent-green)]/5">
          <p className="font-mono text-xs text-[var(--gray-400)] m-0">
            Configuring <span className="text-[var(--accent-green)] font-medium">{repoName}</span>
          </p>
        </div>
      )}

      <div className="px-5 py-5 space-y-5">
        {/* ── 2-column: Branch + Auto-Sync ──────────────────────── */}
        <div className="grid grid-cols-2 gap-3">
          {/* Branch */}
          <div>
            <div className="font-mono text-xs font-semibold text-[var(--gray-300)] uppercase tracking-wider mb-2">
              Branch
            </div>
            <BranchDropdown
              value={config.watched_branch}
              onChange={(branch) => update({ watched_branch: branch })}
              branches={branches && branches.length > 0 ? branches : [defaultBranch || "main"]}
              loading={branchesLoading}
            />
          </div>

          {/* Auto-Sync */}
          <div>
            <div className="font-mono text-xs font-semibold text-[var(--gray-300)] uppercase tracking-wider mb-2">
              Auto-Sync
            </div>
            <button
              onClick={() => update({ auto_sync_enabled: !config.auto_sync_enabled })}
              className="w-full flex items-center justify-between rounded-lg border bg-[var(--surface-1)] px-3 py-2.5 cursor-pointer"
              style={{
                borderColor: config.auto_sync_enabled ? "rgba(63,185,80,0.3)" : "var(--alpha-white-8)",
              }}
            >
              <div className="flex items-center gap-2.5">
                <RefreshCw
                  size={14}
                  className={config.auto_sync_enabled ? "text-[var(--accent-green)]" : "text-[var(--gray-500)]"}
                />
                <span className="font-mono text-sm text-[var(--gray-200)]">
                  On push
                </span>
              </div>
              <Toggle on={config.auto_sync_enabled} />
            </button>
          </div>
        </div>

        {/* ── Timeline ──────────────────────────────────────────── */}
        <div>
          <div className="flex items-center justify-between mb-2.5">
            <div className="font-mono text-xs font-semibold text-[var(--gray-300)] uppercase tracking-wider">
              Timeline Backfill
            </div>
            <button
              onClick={() => update({ backfill_timeline: !config.backfill_timeline })}
              className="bg-transparent border-none cursor-pointer p-0"
            >
              <Toggle on={config.backfill_timeline} />
            </button>
          </div>

          {config.backfill_timeline && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              transition={{ duration: 0.15 }}
              className="overflow-hidden"
            >
              <div className="flex items-center gap-2">
                <GitCommitHorizontal size={14} className="text-[var(--accent-green)] shrink-0" />
                <span className="font-mono text-xs text-[var(--gray-400)] shrink-0">Depth:</span>
                <div className="flex gap-1.5 flex-1">
                  {DEPTH_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => update({ timeline_commit_depth: opt.value })}
                      className={`flex-1 py-1.5 rounded-md text-xs font-mono font-medium transition-all cursor-pointer border ${
                        config.timeline_commit_depth === opt.value
                          ? "bg-[var(--accent-green)]/10 border-[var(--accent-green)]/30 text-[var(--accent-green)]"
                          : "bg-transparent border-[var(--alpha-white-8)] text-[var(--gray-500)] hover:text-[var(--gray-300)]"
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            </motion.div>
          )}
        </div>
      </div>
    </div>
  );
}
