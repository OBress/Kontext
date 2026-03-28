"use client";

import { useCallback, useEffect, useState } from "react";
import { useAppStore, Repo } from "@/lib/store/app-store";
import { AppShell } from "./components/shell/AppShell";
import { RepoCardGrid } from "./components/dashboard/RepoCardGrid";
import { ActivityFeed } from "./components/dashboard/ActivityFeed";
import { GlowCard } from "./components/shared/GlowCard";
import { AnimatedCounter } from "./components/shared/AnimatedCounter";
import { Database, Code2, Users, Plus, GitBranch, Sparkles } from "lucide-react";
import dynamic from "next/dynamic";
import type { ConstellationNode } from "./components/dashboard/RepoConstellation";

const RepoConstellation = dynamic(
  () =>
    import("./components/dashboard/RepoConstellation").then(
      (m) => m.RepoConstellation
    ),
  { ssr: false }
);

const ParticleField = dynamic(
  () => import("./components/shared/ParticleField").then((m) => m.ParticleField),
  { ssr: false }
);

export default function DashboardPage() {
  const { repos, setRepos, setAddRepoModalOpen } = useAppStore();
  const [githubRepos, setGithubRepos] = useState<Repo[]>([]);

  // Fetch added repos on mount
  useEffect(() => {
    fetch("/api/repos")
      .then((r) => r.json())
      .then((data) => {
        if (data.repos) setRepos(data.repos);
      })
      .catch(() => {});
  }, [setRepos]);

  // Also fetch user's GitHub repos for constellation display
  useEffect(() => {
    fetch("/api/repos?source=github")
      .then((r) => r.json())
      .then((data) => {
        if (data.repos) {
          setGithubRepos(
            data.repos.map((r: any) => ({
              id: r.id,
              full_name: r.full_name,
              name: r.name,
              owner: r.owner || r.full_name?.split("/")[0] || "",
              description: r.description,
              language: r.language,
              stargazers_count: r.stargazers_count || 0,
              forks_count: r.forks_count || 0,
              updated_at: r.updated_at,
              indexed: false,
              indexing: false,
              chunk_count: 0,
            }))
          );
        }
      })
      .catch(() => {});
  }, []);

  // Merge: added repos + GitHub repos (deduped) for the constellation
  const constellationRepos = (() => {
    const addedNames = new Set(repos.map((r) => r.full_name));
    const ghOnly = githubRepos.filter((r) => !addedNames.has(r.full_name));
    return [...repos, ...ghOnly];
  })();

  const indexedRepos = repos.filter((r) => r.indexed);
  const totalChunks = repos.reduce((sum, r) => sum + r.chunk_count, 0);
  const hasRepos = repos.length > 0;

  // When a constellation node is clicked, open the add-repo modal
  const handleNodeClick = useCallback(
    (node: ConstellationNode) => {
      // For any repo, open the add modal so the user can add/ingest it
      setAddRepoModalOpen(true);
    },
    [setAddRepoModalOpen]
  );

  return (
    <AppShell>
      <ParticleField />
      <div className="relative z-10 mx-auto">
        {!hasRepos ? (
          /* ═══ Empty state — side-by-side hero ═══ */
          <div className="-m-6 flex flex-col lg:flex-row items-center justify-center min-h-[calc(100vh-3rem)] gap-8 lg:gap-12 overflow-visible">
            {/* Left — text + CTA */}
            <div className="flex flex-col justify-center items-start lg:w-[480px] shrink-0 text-left px-10 lg:pl-12 lg:pr-6">
              <h1 className="font-mono text-3xl md:text-5xl font-semibold text-gradient mb-4">
                Welcome to Kontext
              </h1>
              <p className="font-mono text-sm md:text-base text-[var(--gray-400)] max-w-lg mb-10 leading-relaxed">
                Add a repository to unlock AI-powered code intelligence,
                3D architecture visualization, and team onboarding.
              </p>
              <button
                onClick={() => setAddRepoModalOpen(true)}
                className="flex items-center gap-2 px-6 py-3 rounded-xl font-mono text-sm bg-[var(--accent-cyan)] text-black font-medium hover:opacity-90 transition-all cursor-pointer border-none hover:shadow-[0_0_30px_rgba(0,229,255,0.2)] active:scale-[0.98] mb-12"
              >
                <Plus size={16} />
                Add Repository
              </button>

              {/* Feature hints */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 w-full">
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

            {/* Right — constellation fills remaining space */}
            <div className="flex-1 w-full min-w-0 h-[50vh] lg:h-[calc(100vh-3rem)] overflow-visible">
              <RepoConstellation repos={constellationRepos} onNodeClick={handleNodeClick} fillContainer />
            </div>
          </div>
        ) : (
          /* ═══ Active dashboard ═══ */
          <div className="space-y-8">
            {/* Header row: title + constellation + add button */}
            <div className="flex flex-col items-center gap-6">
              {/* Constellation at the top of dashboard */}
              <div className="w-full flex justify-center">
                <RepoConstellation repos={constellationRepos} onNodeClick={handleNodeClick} />
              </div>

              <div className="flex items-center justify-between w-full">
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
