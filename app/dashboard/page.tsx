"use client";

import { useEffect, useMemo } from "react";
import { useAppStore } from "@/lib/store/app-store";
import { AppShell } from "../components/shell/AppShell";
import { SortableRepoSection } from "../components/dashboard/SortableRepoSection";
import { ActivityFeed } from "../components/dashboard/ActivityFeed";
import { GlowCard } from "../components/shared/GlowCard";
import { AnimatedCounter } from "../components/shared/AnimatedCounter";
import { Database, Code2, Users, Plus, FolderGit2, RefreshCw } from "lucide-react";
import dynamic from "next/dynamic";

const ParticleField = dynamic(
  () => import("../components/shared/ParticleField").then((m) => m.ParticleField),
  { ssr: false }
);

export default function DashboardPage() {
  const { repos, setRepos, setAddRepoModalOpen } = useAppStore();
  const repoJobs = useAppStore((s) => s.repoJobs);

  // Fetch repos on mount
  useEffect(() => {
    fetch("/api/repos")
      .then((r) => r.json())
      .then((data) => {
        if (data.repos) setRepos(data.repos);
      })
      .catch(() => {});
  }, [setRepos]);

  const indexedRepos = repos.filter((r) => r.indexed);
  const totalChunks = repos.reduce((sum, r) => sum + r.chunk_count, 0);

  // Count repos that have active sync jobs
  const activeSyncCount = useMemo(() => {
    const syncingRepos = new Set<string>();
    for (const job of Object.values(repoJobs)) {
      if (
        job.jobType === "sync" &&
        (job.status === "queued" || job.status === "running")
      ) {
        syncingRepos.add(job.repoFullName);
      }
    }
    return syncingRepos.size;
  }, [repoJobs]);

  return (
    <AppShell>
      <ParticleField />
      <div className="relative z-10 max-w-6xl mx-auto pb-8">
        <div className="space-y-8">
          {/* Header row */}
          <div className="flex items-center justify-between">
            <div>
              <h1 className="font-mono text-xl font-semibold text-[var(--gray-100)] mb-1 m-0">
                Dashboard
              </h1>
              <p className="font-mono text-sm text-[var(--gray-500)] m-0">
                Your repositories at a glance
              </p>
            </div>
            <button
              onClick={() => setAddRepoModalOpen(true)}
              className="flex items-center gap-2 px-4 py-2 rounded-lg font-mono text-sm bg-[var(--accent-green)]/10 text-[var(--accent-green)] border border-[var(--accent-green)]/20 hover:bg-[var(--accent-green)]/20 transition-colors cursor-pointer"
            >
              <Plus size={14} />
              Add Repo
            </button>
          </div>

          {/* Stats row */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <GlowCard glowColor="cyan" className="p-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg flex items-center justify-center bg-[var(--accent-green)]/10">
                  <Database size={18} className="text-[var(--accent-green)]" />
                </div>
                <div>
                  <p className="font-mono text-xs uppercase text-[var(--gray-500)] m-0">
                    Repos Added
                  </p>
                  <p className="font-mono text-2xl font-semibold text-[var(--gray-100)] m-0">
                    <AnimatedCounter value={repos.length} />
                  </p>
                </div>
              </div>
            </GlowCard>

            <GlowCard glowColor="purple" className="p-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg flex items-center justify-center bg-[var(--accent-muted)]/10">
                  <Code2 size={18} className="text-[var(--accent-muted)]" />
                </div>
                <div>
                  <p className="font-mono text-xs uppercase text-[var(--gray-500)] m-0">
                    Total Chunks
                  </p>
                  <p className="font-mono text-2xl font-semibold text-[var(--gray-100)] m-0">
                    <AnimatedCounter value={totalChunks} format="compact" />
                  </p>
                </div>
              </div>
            </GlowCard>

            <GlowCard glowColor="green" className="p-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg flex items-center justify-center bg-[var(--accent-green)]/10">
                  {activeSyncCount > 0 ? (
                    <RefreshCw size={18} className="text-blue-400 animate-spin" />
                  ) : (
                    <Users size={18} className="text-[var(--accent-green)]" />
                  )}
                </div>
                <div>
                  <p className="font-mono text-xs uppercase text-[var(--gray-500)] m-0">
                    {activeSyncCount > 0 ? 'Syncing' : 'Indexed'}
                  </p>
                  <p className="font-mono text-2xl font-semibold text-[var(--gray-100)] m-0">
                    {activeSyncCount > 0 ? (
                      <span className="text-blue-400">
                        <AnimatedCounter value={activeSyncCount} />
                      </span>
                    ) : (
                      <AnimatedCounter value={indexedRepos.length} />
                    )}
                  </p>
                  {activeSyncCount > 0 && (
                    <p className="font-mono text-xs text-blue-400/60 m-0 mt-0.5">
                      {indexedRepos.length} indexed
                    </p>
                  )}
                </div>
              </div>
            </GlowCard>
          </div>

          {/* Main content: sortable grid + activity */}
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-8">
            <div>
              {repos.length > 0 ? (
                <SortableRepoSection repos={repos} />
              ) : (
                <div
                  className="relative group flex items-center justify-between px-6 py-5 rounded-xl overflow-hidden"
                  style={{
                    background: "rgba(17, 17, 24, 0.6)",
                    backdropFilter: "blur(12px)",
                    border: "1px solid rgba(63, 185, 80, 0.08)",
                  }}
                >
                  {/* Left: icon + text */}
                  <div className="flex items-center gap-4">
                    <div className="w-11 h-11 rounded-xl flex items-center justify-center bg-[var(--accent-green)]/[0.08] border border-[var(--accent-green)]/[0.12] shrink-0">
                      <FolderGit2 size={18} className="text-[var(--accent-green)] opacity-60" />
                    </div>
                    <div>
                      <h3 className="font-mono text-sm font-medium text-[var(--gray-200)] m-0">
                        No repositories yet
                      </h3>
                      <p className="font-mono text-xs text-[var(--gray-500)] m-0 mt-0.5">
                        Add a repo to start analyzing with AI
                      </p>
                    </div>
                  </div>

                  {/* Right: add button */}
                  <button
                    onClick={() => setAddRepoModalOpen(true)}
                    className="flex items-center gap-2 px-5 py-2.5 rounded-xl shrink-0 cursor-pointer transition-all duration-200 hover:scale-[1.03] active:scale-[0.97] font-mono text-sm font-medium"
                    style={{
                      background: "linear-gradient(135deg, rgba(63,185,80,0.15), rgba(63,185,80,0.08))",
                      border: "1px solid rgba(63,185,80,0.25)",
                      color: "var(--accent-green)",
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.borderColor = "rgba(63,185,80,0.45)";
                      e.currentTarget.style.boxShadow = "0 0 20px rgba(63,185,80,0.12)";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.borderColor = "rgba(63,185,80,0.25)";
                      e.currentTarget.style.boxShadow = "none";
                    }}
                  >
                    <Plus size={16} />
                    Add your first repo
                  </button>

                  {/* Bottom gradient accent line */}
                  <div
                    className="absolute bottom-0 left-1/2 -translate-x-1/2 h-px w-48"
                    style={{
                      background: "linear-gradient(90deg, transparent, rgba(63,185,80,0.15), transparent)",
                    }}
                  />
                </div>
              )}
            </div>

            <div className="hidden lg:block">
              <GlowCard
                glowColor="green"
                className="h-[min(56vh,560px)] max-h-[calc(100vh-18rem)] min-h-[360px] overflow-hidden p-4"
              >
                <ActivityFeed />
              </GlowCard>
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
