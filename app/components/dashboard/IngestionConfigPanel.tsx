"use client";

import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Zap,
  Brain,
  Sparkles,
  GitBranch,
  GitCommitHorizontal,
  RefreshCw,
  ChevronDown,
  DollarSign,
  Loader2,
  Check,
} from "lucide-react";

export interface IngestionConfig {
  understanding_tier: 1 | 2 | 3;
  watched_branch: string;
  backfill_timeline: boolean;
  auto_sync_enabled: boolean;
  timeline_commit_depth: number;
}

export const DEFAULT_INGESTION_CONFIG: IngestionConfig = {
  understanding_tier: 2,
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

const TIERS = [
  { value: 1 as const, name: "Light", icon: Zap, cost: 1, color: "var(--accent-green)" },
  { value: 2 as const, name: "Standard", icon: Brain, cost: 2, color: "var(--accent-amber)" },
  { value: 3 as const, name: "Deep Dive", icon: Sparkles, cost: 3, color: "#A371F7" },
];

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

function BranchDropdown({
  value,
  onChange,
  branches,
  loading,
}: {
  value: string;
  onChange: (branch: string) => void;
  branches: string[];
  loading?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      {/* Trigger */}
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2.5 rounded-lg border border-[var(--alpha-white-8)] bg-[var(--surface-1)] px-3 py-2.5 cursor-pointer transition-colors hover:border-[var(--alpha-white-15)]"
        style={{ borderColor: open ? "var(--accent-green)40" : undefined }}
      >
        <GitBranch size={14} className="text-[var(--accent-green)] shrink-0" />
        <span className="flex-1 text-left text-sm font-mono text-[var(--gray-200)] truncate">
          {value}
        </span>
        {loading ? (
          <Loader2 size={12} className="text-[var(--gray-500)] animate-spin shrink-0" />
        ) : (
          <ChevronDown
            size={12}
            className={`text-[var(--gray-500)] shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
          />
        )}
      </button>

      {/* Dropdown */}
      <AnimatePresence>
        {open && branches.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.15 }}
            className="absolute z-50 top-full left-0 right-0 mt-1 rounded-lg border border-[var(--alpha-white-10)] bg-[var(--surface-2)] shadow-xl shadow-black/40 overflow-hidden max-h-[160px] overflow-y-auto"
          >
            {branches.map((branch) => (
              <button
                key={branch}
                onClick={() => {
                  onChange(branch);
                  setOpen(false);
                }}
                className={`w-full flex items-center gap-2 px-3 py-2 text-left text-sm font-mono transition-colors cursor-pointer border-none ${
                  branch === value
                    ? "bg-[var(--accent-green)]/10 text-[var(--accent-green)]"
                    : "bg-transparent text-[var(--gray-300)] hover:bg-[var(--alpha-white-5)] hover:text-[var(--gray-100)]"
                }`}
              >
                {branch === value ? (
                  <Check size={12} className="text-[var(--accent-green)] shrink-0" />
                ) : (
                  <span className="w-3 shrink-0" />
                )}
                {branch}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
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
        {/* ── Tier Selector ─────────────────────────────────────── */}
        <div>
          <div className="font-mono text-xs font-semibold text-[var(--gray-300)] uppercase tracking-wider mb-2.5">
            Understanding Depth
          </div>
          <div className="grid grid-cols-3 gap-2">
            {TIERS.map((tier) => {
              const isSelected = config.understanding_tier === tier.value;
              const Icon = tier.icon;
              return (
                <button
                  key={tier.value}
                  onClick={() => update({ understanding_tier: tier.value })}
                  className="relative flex items-center justify-center gap-2.5 py-3 px-2 rounded-lg transition-all cursor-pointer bg-transparent border"
                  style={{
                    borderColor: isSelected ? `${tier.color}50` : "var(--alpha-white-8)",
                    background: isSelected ? `color-mix(in srgb, ${tier.color} 8%, transparent)` : "var(--surface-1)",
                  }}
                >
                  {isSelected && (
                    <motion.div
                      layoutId="tier-ring"
                      className="absolute inset-0 rounded-lg"
                      style={{ border: `1.5px solid ${tier.color}40` }}
                      transition={{ type: "spring", stiffness: 500, damping: 30 }}
                    />
                  )}
                  <Icon size={16} style={{ color: isSelected ? tier.color : "var(--gray-500)" }} />
                  <span
                    className="font-mono text-sm font-bold relative z-10"
                    style={{ color: isSelected ? tier.color : "var(--gray-300)" }}
                  >
                    {tier.name}
                  </span>
                  <span className="flex items-center gap-0 relative z-10 ml-auto">
                    {Array.from({ length: 3 }, (_, i) => (
                      <DollarSign
                        key={i}
                        size={9}
                        className={i < tier.cost ? "text-[var(--accent-green)]" : "text-[var(--gray-700)]"}
                      />
                    ))}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

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
