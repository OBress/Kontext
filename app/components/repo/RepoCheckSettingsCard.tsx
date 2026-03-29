"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { ArrowUpRight, Loader2, Settings2, Shield } from "lucide-react";
import { GlowCard } from "@/app/components/shared/GlowCard";
import { useCurrentRepo } from "@/hooks/use-current-repo";
import {
  CHECK_LABELS,
  RepoCheckConfig,
  RepoCheckTriggerMode,
} from "@/app/components/repo/repo-checks-shared";

const triggerOptions: Array<{
  value: RepoCheckTriggerMode | "off";
  label: string;
}> = [
  { value: "off", label: "Off" },
  { value: "after_sync", label: "After sync" },
  { value: "manual", label: "Manual only" },
  { value: "daily", label: "Daily" },
];

export function RepoCheckSettingsCard() {
  const activeRepo = useCurrentRepo();
  const pathname = usePathname();
  const [configs, setConfigs] = useState<RepoCheckConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const checksHref = pathname.replace(/\/settings$/, "/checks");

  const loadConfigs = useCallback(async () => {
    if (!activeRepo?.full_name) return;

    setLoading(true);
    try {
      const res = await fetch(
        `/api/repos/checks/config?repo=${encodeURIComponent(activeRepo.full_name)}`
      );
      const data = (await res.json()) as { configs?: RepoCheckConfig[]; error?: string };

      if (!res.ok) {
        throw new Error(data.error || "Failed to load check automation settings");
      }

      setConfigs(data.configs || []);
    } catch (error: unknown) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Failed to load check automation settings."
      );
    } finally {
      setLoading(false);
    }
  }, [activeRepo?.full_name]);

  useEffect(() => {
    void loadConfigs();
  }, [loadConfigs]);

  const saveConfigs = useCallback(
    async (nextConfigs: RepoCheckConfig[]) => {
      if (!activeRepo?.full_name) return;

      setSaving(true);
      setMessage(null);
      setConfigs(nextConfigs);

      try {
        const res = await fetch("/api/repos/checks/config", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            repo_full_name: activeRepo.full_name,
            configs: nextConfigs.map((config) => ({
              check_type: config.check_type,
              enabled: config.enabled,
              trigger_mode: config.trigger_mode,
              notify_on_high: config.notify_on_high,
            })),
          }),
        });

        const data = (await res.json()) as { configs?: RepoCheckConfig[]; error?: string };

        if (!res.ok) {
          throw new Error(data.error || "Failed to save check automation settings");
        }

        setConfigs(data.configs || nextConfigs);
        setMessage("Check automation saved.");
      } catch (error: unknown) {
        setMessage(
          error instanceof Error
            ? error.message
            : "Failed to save check automation settings."
        );
        void loadConfigs();
      } finally {
        setSaving(false);
      }
    },
    [activeRepo?.full_name, loadConfigs]
  );

  const enabledCount = useMemo(
    () => configs.filter((config) => config.enabled).length,
    [configs]
  );

  const automatedCount = useMemo(
    () =>
      configs.filter(
        (config) => config.enabled && config.trigger_mode !== "manual"
      ).length,
    [configs]
  );

  if (!activeRepo?.indexed) return null;

  return (
    <GlowCard glowColor="none" className="p-5">
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Shield size={15} className="text-[var(--accent-green)]" />
              <h3 className="m-0 font-mono text-sm font-semibold text-[var(--gray-200)]">
                Check Automation
              </h3>
              {saving && (
                <Loader2
                  size={13}
                  className="animate-spin text-[var(--gray-500)]"
                />
              )}
            </div>
            <p className="mt-2 font-mono text-xs leading-relaxed text-[var(--gray-500)]">
              Decide which checks run automatically for{" "}
              <span className="text-[var(--gray-300)]">{activeRepo.full_name}</span>.
              Live findings and investigation stay in the Checks workspace.
            </p>
          </div>

          <Link
            href={checksHref}
            className="inline-flex items-center gap-2 self-start rounded-xl border border-[var(--alpha-white-8)] bg-[var(--alpha-white-5)] px-3 py-2 font-mono text-xs text-[var(--gray-300)] transition-colors hover:border-[var(--accent-green)]/30 hover:text-[var(--accent-green)] no-underline"
          >
            <Settings2 size={12} />
            Open Checks
            <ArrowUpRight size={12} />
          </Link>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <StatTile
            label="Enabled"
            value={enabledCount}
            tone="text-[var(--gray-100)]"
          />
          <StatTile
            label="Auto-run"
            value={automatedCount}
            tone="text-[var(--accent-green)]"
          />
          <StatTile
            label="Manual"
            value={Math.max(0, enabledCount - automatedCount)}
            tone="text-amber-300"
          />
        </div>

        {loading ? (
          <div className="flex items-center gap-2 rounded-xl border border-[var(--alpha-white-8)] bg-[var(--alpha-white-3)] px-4 py-3 font-mono text-xs text-[var(--gray-500)]">
            <Loader2 size={14} className="animate-spin" />
            Loading check automation...
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {configs.map((config) => {
              const dropdownValue = config.enabled ? config.trigger_mode : "off";

              return (
                <div
                  key={config.check_type}
                  className="rounded-2xl border border-[var(--alpha-white-8)] bg-[linear-gradient(180deg,rgba(255,255,255,0.035),rgba(255,255,255,0.02))] p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h4 className="m-0 font-mono text-sm font-semibold text-[var(--gray-100)]">
                          {CHECK_LABELS[config.check_type].title}
                        </h4>
                        <span
                          className={`rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em] ${
                            config.enabled
                              ? "border-[var(--accent-green)]/25 bg-[var(--accent-green)]/10 text-[var(--accent-green)]"
                              : "border-[var(--alpha-white-10)] bg-[var(--alpha-white-5)] text-[var(--gray-500)]"
                          }`}
                        >
                          {config.enabled ? "On" : "Off"}
                        </span>
                      </div>
                      <p className="mt-2 font-mono text-xs leading-relaxed text-[var(--gray-500)]">
                        {CHECK_LABELS[config.check_type].description}
                      </p>
                    </div>

                    <select
                      value={dropdownValue}
                      onChange={(event) => {
                        const nextValue = event.target.value as
                          | RepoCheckTriggerMode
                          | "off";

                        const nextConfigs = configs.map((currentConfig) =>
                          currentConfig.check_type === config.check_type
                            ? nextValue === "off"
                              ? { ...currentConfig, enabled: false }
                              : {
                                  ...currentConfig,
                                  enabled: true,
                                  trigger_mode: nextValue,
                                }
                            : currentConfig
                        );

                        void saveConfigs(nextConfigs);
                      }}
                      className="shrink-0 rounded-xl border border-[var(--alpha-white-10)] bg-[var(--surface-1)] px-3 py-2 font-mono text-xs text-[var(--gray-300)] outline-none"
                    >
                      {triggerOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {message && (
          <p
            className={`m-0 font-mono text-xs ${
              message.startsWith("Failed")
                ? "text-red-400"
                : "text-[var(--accent-green)]"
            }`}
          >
            {message}
          </p>
        )}
      </div>
    </GlowCard>
  );
}

function StatTile({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: string;
}) {
  return (
    <div className="rounded-2xl border border-[var(--alpha-white-8)] bg-[var(--alpha-white-3)] px-4 py-3">
      <p className="m-0 font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--gray-500)]">
        {label}
      </p>
      <p className={`mt-2 font-mono text-lg ${tone}`}>{value}</p>
    </div>
  );
}
