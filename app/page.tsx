"use client";

import { useCallback, useEffect, useState } from "react";
import { useAppStore, Repo } from "@/lib/store/app-store";
import { AppShell } from "./components/shell/AppShell";
import { Database, Plus, GitBranch, Sparkles, LogIn, LayoutDashboard } from "lucide-react";
import { useRouter } from "next/navigation";
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

export default function HomePage() {
  const { repos, setRepos, setAddRepoModalOpen, setAddRepoDefaultUrl } = useAppStore();
  const [githubRepos, setGithubRepos] = useState<Repo[]>([]);
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const router = useRouter();

  // Check auth status + fetch repos on mount
  useEffect(() => {
    fetch("/api/repos")
      .then((r) => {
        if (r.status === 401) {
          setIsAuthenticated(false);
          return null;
        }
        setIsAuthenticated(true);
        return r.json();
      })
      .then((data) => {
        if (data?.repos) setRepos(data.repos);
      })
      .catch(() => setIsAuthenticated(false));
  }, [setRepos]);

  // Also fetch user's GitHub repos for constellation display (only if authed)
  useEffect(() => {
    if (isAuthenticated !== true) return;

    fetch("/api/repos?source=github")
      .then((r) => {
        if (!r.ok) return null;
        return r.json();
      })
      .then((data) => {
        if (data?.repos) {
          setGithubRepos(
            data.repos.map((r: { id: number; full_name: string; name: string; owner?: string; description?: string; language?: string; stargazers_count?: number; forks_count?: number; updated_at?: string }) => ({
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
  }, [isAuthenticated]);

  // Merge: added repos + GitHub repos (deduped) for the constellation
  const constellationRepos = (() => {
    const addedNames = new Set(repos.map((r) => r.full_name));
    const ghOnly = githubRepos.filter((r) => !addedNames.has(r.full_name));
    return [...repos, ...ghOnly];
  })();

  // Gate interactive actions behind auth — redirect to login if not authenticated
  const requireAuth = useCallback(
    (action: () => void) => {
      if (isAuthenticated) {
        action();
      } else {
        router.push("/login");
      }
    },
    [isAuthenticated, router]
  );

  // When a constellation node is clicked, open the add-repo modal with the repo URL pre-filled
  const handleNodeClick = useCallback(
    (node: ConstellationNode) => {
      requireAuth(() => {
        setAddRepoDefaultUrl(`https://github.com/${node.owner}/${node.name}`);
        setAddRepoModalOpen(true);
      });
    },
    [requireAuth, setAddRepoModalOpen, setAddRepoDefaultUrl]
  );

  return (
    <AppShell hideRail>
      <ParticleField />
      <div className="relative z-10 mx-auto">
        {/* Always show the constellation hero */}
        <div className="-m-6 flex flex-col lg:flex-row items-center justify-center min-h-[calc(100vh-3rem)] gap-8 lg:gap-12 overflow-visible">
          {/* Left — text + CTA */}
          <div className="flex flex-col justify-center items-start lg:w-[480px] shrink-0 text-left px-14 lg:pl-20 lg:pr-6">
            <h1 className="font-mono text-3xl md:text-5xl font-semibold text-gradient mb-4">
              Welcome to Kontext
            </h1>
            <p className="font-mono text-sm md:text-base text-[var(--gray-400)] max-w-lg mb-10 leading-relaxed">
              Add a repository to unlock AI-powered code intelligence,
              2D architecture visualization, and team onboarding.
            </p>

            <div className="flex items-center gap-3 mb-12">
              {isAuthenticated ? (
                <>
                  <button
                    onClick={() => setAddRepoModalOpen(true)}
                    className="flex items-center gap-2 px-6 py-3 rounded-xl font-mono text-sm bg-[var(--accent-green)] text-black font-medium hover:opacity-90 transition-all cursor-pointer border-none hover:shadow-[0_0_30px_rgba(63,185,80,0.2)] active:scale-[0.98]"
                  >
                    <Plus size={16} />
                    Add Repository
                  </button>
                  <button
                    onClick={() => router.push("/dashboard")}
                    className="flex items-center gap-2 px-6 py-3 rounded-xl font-mono text-sm bg-[var(--alpha-white-10)] text-[var(--gray-100)] font-medium hover:bg-[var(--alpha-white-15)] transition-all cursor-pointer border border-[var(--alpha-white-10)] hover:border-[var(--alpha-white-20)] active:scale-[0.98]"
                  >
                    <LayoutDashboard size={16} />
                    Dashboard
                  </button>
                </>
              ) : (
                <button
                  onClick={() => router.push("/login")}
                  className="flex items-center gap-2 px-6 py-3 rounded-xl font-mono text-sm bg-[var(--accent-green)] text-black font-medium hover:opacity-90 transition-all cursor-pointer border-none hover:shadow-[0_0_30px_rgba(63,185,80,0.2)] active:scale-[0.98]"
                >
                  <LogIn size={16} />
                  Sign in with GitHub
                </button>
              )}
            </div>

            {/* Feature hints */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 w-full">
              <FeatureHint
                icon={<Sparkles size={18} className="text-[var(--accent-green)]" />}
                title="AI Chat"
                description="Ask questions about any codebase"
              />
              <FeatureHint
                icon={<GitBranch size={18} className="text-[var(--accent-muted)]" />}
                title="2D Graph"
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
      <span className="font-mono text-xs text-[var(--gray-500)] text-center">{description}</span>
    </div>
  );
}
