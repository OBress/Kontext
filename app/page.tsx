"use client";

import { useEffect } from "react";
import { useAppStore } from "@/lib/store/app-store";
import { AppShell } from "./components/shell/AppShell";
import { RepoCardGrid } from "./components/dashboard/RepoCardGrid";
import { ActivityFeed } from "./components/dashboard/ActivityFeed";
import { GlowCard } from "./components/shared/GlowCard";
import { AnimatedCounter } from "./components/shared/AnimatedCounter";
import { Database, Code2, Users, ArrowRight } from "lucide-react";
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
  const { repos, setRepos } = useAppStore();

  useEffect(() => {
    if (repos.length === 0) {
      fetch("/api/repos")
        .then((r) => r.json())
        .then((data) => setRepos(data.repos))
        .catch(() => {});
    }
  }, [repos.length, setRepos]);

  const indexedRepos = repos.filter((r) => r.indexed);
  const totalChunks = repos.reduce((sum, r) => sum + r.chunk_count, 0);
  const hasRepos = repos.length > 0;

  return (
    <AppShell>
      <ParticleField />
      <div className="relative z-10 max-w-6xl mx-auto">
        {!hasRepos ? (
          /* ═══ Empty state ═══ */
          <div className="flex flex-col items-center justify-center min-h-[70vh] text-center">
            <HeroOrb />
            <h1 className="font-mono text-2xl md:text-3xl font-semibold text-gradient mt-6 mb-2">
              Welcome to Kontext
            </h1>
            <p className="font-mono text-sm text-[var(--gray-400)] max-w-md mb-8">
              Connect a repository to unlock AI-powered code intelligence,
              3D architecture visualization, and team onboarding.
            </p>
            <button
              onClick={() => {
                // Will trigger repo fetch once RepoSelector opens
                fetch("/api/repos")
                  .then((r) => r.json())
                  .then((data) => setRepos(data.repos));
              }}
              className="flex items-center gap-2 px-5 py-2.5 rounded-lg font-mono text-sm bg-[var(--accent-cyan)] text-black font-medium hover:opacity-90 transition-opacity cursor-pointer border-none"
            >
              Load Repositories
              <ArrowRight size={16} />
            </button>
          </div>
        ) : (
          /* ═══ Active dashboard ═══ */
          <div className="space-y-8">
            {/* Header */}
            <div>
              <h1 className="font-mono text-xl font-semibold text-[var(--gray-100)] mb-1 m-0">
                Dashboard
              </h1>
              <p className="font-mono text-sm text-[var(--gray-500)] m-0">
                Your repositories at a glance
              </p>
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
                      Repos Indexed
                    </p>
                    <p className="font-mono text-2xl font-semibold text-[var(--gray-100)] m-0">
                      <AnimatedCounter value={indexedRepos.length} />
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
                      Team Members
                    </p>
                    <p className="font-mono text-2xl font-semibold text-[var(--gray-100)] m-0">
                      <AnimatedCounter value={5} />
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
