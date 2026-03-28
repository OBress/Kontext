"use client";

import { useEffect } from "react";
import { useAppStore } from "@/lib/store/app-store";
import { AppShell } from "./components/shell/AppShell";
import { RepoCardGrid } from "./components/dashboard/RepoCardGrid";
import { ActivityFeed } from "./components/dashboard/ActivityFeed";
import { GlowCard } from "./components/shared/GlowCard";
import { AnimatedCounter } from "./components/shared/AnimatedCounter";
import { Database, Code2, Users, Plus, ArrowRight, GitBranch, Sparkles } from "lucide-react";
import dynamic from "next/dynamic";

const HeroOrb = dynamic(
  () => import("./components/dashboard/HeroOrb").then((m) => m.HeroOrb),
  { ssr: false }
);

const ParticleField = dynamic(
  () => import("./components/shared/ParticleField").then((m) => m.ParticleField),
  { ssr: false }
);

export default function DashboardPage() {
  const { repos, setRepos, setAddRepoModalOpen } = useAppStore();

  // Fetch only ADDED repos on mount
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
  const hasRepos = repos.length > 0;

  return (
    <AppShell>
      <ParticleField />
      <div className="relative z-10 max-w-6xl mx-auto">
        {!hasRepos ? (
          /* ═══ Empty state — first login ═══ */
          <div className="flex flex-col items-center justify-center min-h-[70vh] text-center">
            <HeroOrb />
            <h1 className="font-mono text-2xl md:text-3xl font-semibold text-gradient mt-6 mb-2">
              Welcome to Kontext
            </h1>
            <p className="font-mono text-sm text-[var(--gray-400)] max-w-md mb-8">
              Add a repository to unlock AI-powered code intelligence,
              3D architecture visualization, and team onboarding.
            </p>
            <button
              onClick={() => setAddRepoModalOpen(true)}
              className="flex items-center gap-2 px-6 py-3 rounded-xl font-mono text-sm bg-[var(--accent-cyan)] text-black font-medium hover:opacity-90 transition-all cursor-pointer border-none hover:shadow-[0_0_30px_rgba(0,229,255,0.2)] active:scale-[0.98]"
            >
              <Plus size={16} />
              Add Repository
            </button>

            {/* Feature hints */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-16 max-w-2xl w-full">
              <FeatureHint
                icon={<Sparkles size={18} className="text-[var(--accent-cyan)]" />}
                title="AI Chat"
                description="Ask questions about any codebase"
              />
              <FeatureHint
                icon={<GitBranch size={18} className="text-[var(--accent-purple)]" />}
                title="3D Graph"
                description="Visualize architecture & dependencies"
              />
              <FeatureHint
                icon={<Database size={18} className="text-[var(--accent-green)]" />}
                title="RAG Engine"
                description="Embeddings-powered knowledge base"
              />
            </div>
          </div>
        ) : (
          /* ═══ Active dashboard ═══ */
          <div className="space-y-8">
            {/* Header with Add button */}
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
                className="flex items-center gap-2 px-4 py-2 rounded-lg font-mono text-sm bg-[var(--accent-cyan)]/10 text-[var(--accent-cyan)] border border-[var(--accent-cyan)]/20 hover:bg-[var(--accent-cyan)]/20 transition-colors cursor-pointer"
              >
                <Plus size={14} />
                Add Repo
              </button>
            </div>

            {/* Stats row */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <GlowCard glowColor="cyan" className="p-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg flex items-center justify-center bg-[var(--accent-cyan)]/10">
                    <Database size={18} className="text-[var(--accent-cyan)]" />
                  </div>
                  <div>
                    <p className="font-mono text-[11px] uppercase text-[var(--gray-500)] m-0">
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
                  <div className="w-10 h-10 rounded-lg flex items-center justify-center bg-[var(--accent-purple)]/10">
                    <Code2 size={18} className="text-[var(--accent-purple)]" />
                  </div>
                  <div>
                    <p className="font-mono text-[11px] uppercase text-[var(--gray-500)] m-0">
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
                    <Users size={18} className="text-[var(--accent-green)]" />
                  </div>
                  <div>
                    <p className="font-mono text-[11px] uppercase text-[var(--gray-500)] m-0">
                      Indexed
                    </p>
                    <p className="font-mono text-2xl font-semibold text-[var(--gray-100)] m-0">
                      <AnimatedCounter value={indexedRepos.length} />
                    </p>
                  </div>
                </div>
              </GlowCard>
            </div>

            {/* Main content: grid + activity */}
            <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-8">
              <div>
                <h2 className="font-mono text-sm uppercase tracking-wider text-[var(--gray-500)] mb-4 m-0">
                  Your Repositories
                </h2>
                <RepoCardGrid repos={repos} />
              </div>

              <div className="hidden lg:block">
                <ActivityFeed />
              </div>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}

function FeatureHint({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="flex flex-col items-center gap-2 p-4 rounded-xl bg-[var(--surface-1)] border border-[var(--alpha-white-5)]">
      <div className="w-10 h-10 rounded-lg flex items-center justify-center bg-[var(--alpha-white-5)]">
        {icon}
      </div>
      <span className="font-mono text-xs font-medium text-[var(--gray-200)]">{title}</span>
      <span className="font-mono text-[11px] text-[var(--gray-500)] text-center">{description}</span>
    </div>
  );
}
