"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import { useAppStore, Repo } from "@/lib/store/app-store";
import { useRouter, usePathname } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronDown, Search, GitBranch, Star, Loader2, Plus, Database } from "lucide-react";

// Language color map for dots
const langColors: Record<string, string> = {
  TypeScript: "#3178C6",
  JavaScript: "#F7DF1E",
  Python: "#3572A5",
  Rust: "#DEA584",
  Go: "#00ADD8",
  Java: "#B07219",
  "C++": "#F34B7D",
  Ruby: "#701516",
  PHP: "#4F5D95",
  Swift: "#FA7343",
  Kotlin: "#A97BFF",
  CSS: "#563D7C",
  HTML: "#E34C26",
};

export function RepoSelector() {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const { repos, setAddRepoModalOpen } = useAppStore();
  const router = useRouter();
  const pathname = usePathname();
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Derive active repo from URL pathname: /repo/owner/name/...
  const currentRepo = useMemo(() => {
    const match = pathname.match(/^\/repo\/([^/]+)\/([^/]+)/);
    if (!match) return null;
    const fullName = `${match[1]}/${match[2]}`;
    return repos.find((r) => r.full_name === fullName) || null;
  }, [pathname, repos]);

  // Close on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const filteredRepos = repos.filter((r) =>
    r.full_name.toLowerCase().includes(search.toLowerCase())
  );

  const indexed = filteredRepos.filter((r) => r.indexed);
  const pending = filteredRepos.filter((r) => !r.indexed);

  const handleSelect = (repo: Repo) => {
    setIsOpen(false);
    setSearch("");
    router.push(`/repo/${repo.owner}/${repo.name}`);
  };

  return (
    <div ref={dropdownRef} className="relative w-full max-w-sm">
      {/* Trigger */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between gap-2 px-3 py-1.5 rounded-lg border border-[var(--alpha-white-8)] bg-[var(--surface-1)] hover:bg-[var(--surface-2)] transition-colors cursor-pointer text-left"
      >
        <div className="flex items-center gap-2 overflow-hidden">
          <GitBranch size={14} className="text-[var(--gray-500)] shrink-0" />
          <span className={`text-sm font-mono truncate ${currentRepo ? "text-[var(--gray-200)]" : "text-[var(--gray-500)]"}`}>
            {currentRepo ? currentRepo.full_name : "Select repository"}
          </span>
        </div>
        <ChevronDown
          size={14}
          className={`text-[var(--gray-500)] shrink-0 transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`}
        />
      </button>

      {/* Dropdown */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: -4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={{ duration: 0.15 }}
            className="absolute top-full left-0 right-0 mt-1 glass-strong rounded-xl overflow-hidden shadow-2xl"
            style={{ minWidth: 360 }}
          >
            {/* Search */}
            <div className="p-2 border-b border-[var(--alpha-white-5)]">
              <div className="relative">
                <Search
                  size={14}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--gray-500)]"
                />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search added repositories..."
                  autoFocus
                  className="w-full pl-9 pr-3 py-2 rounded-lg text-sm font-mono bg-[var(--surface-1)] border border-[var(--alpha-white-5)] text-[var(--gray-200)] placeholder:text-[var(--gray-600)] focus:outline-none focus:border-[var(--accent-green)]/40 transition-colors"
                />
              </div>
            </div>

            {/* Repo list */}
            <div className="max-h-[320px] overflow-y-auto py-1">
              {repos.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8 text-[var(--gray-500)]">
                  <Database size={20} className="mb-2 opacity-40" />
                  <span className="text-sm font-mono">No repositories added</span>
                  <span className="text-[11px] font-mono text-[var(--gray-600)] mt-1">
                    Add one to get started
                  </span>
                </div>
              ) : (
                <>
                  {indexed.length > 0 && (
                    <div className="px-3 py-1.5">
                      <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--gray-500)]">
                        Indexed
                      </span>
                    </div>
                  )}
                  {indexed.map((repo) => (
                    <RepoItem
                      key={repo.id}
                      repo={repo}
                      isActive={currentRepo?.full_name === repo.full_name}
                      onSelect={handleSelect}
                    />
                  ))}
                  {pending.length > 0 && (
                    <div className="px-3 py-1.5 mt-1">
                      <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--gray-500)]">
                        Pending
                      </span>
                    </div>
                  )}
                  {pending.map((repo) => (
                    <RepoItem
                      key={repo.id}
                      repo={repo}
                      isActive={currentRepo?.full_name === repo.full_name}
                      onSelect={handleSelect}
                    />
                  ))}
                  {filteredRepos.length === 0 && (
                    <div className="text-center py-6 text-sm text-[var(--gray-500)] font-mono">
                      No repositories found
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Add new repo footer */}
            <div className="border-t border-[var(--alpha-white-5)]">
              <button
                onClick={() => {
                  setIsOpen(false);
                  setAddRepoModalOpen(true);
                }}
                className="w-full flex items-center gap-2 px-3 py-2.5 text-left transition-colors cursor-pointer bg-transparent border-none hover:bg-[var(--alpha-white-5)] text-[var(--accent-green)]"
              >
                <Plus size={14} />
                <span className="text-sm font-mono">Add New Repository</span>
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function RepoItem({
  repo,
  isActive,
  onSelect,
}: {
  repo: Repo;
  isActive: boolean;
  onSelect: (r: Repo) => void;
}) {
  const langColor = langColors[repo.language || ""] || "var(--gray-500)";
  const ingestionStatus = useAppStore((s) => s.ingestionStatus[repo.full_name]);
  const isIngesting =
    ingestionStatus &&
    ingestionStatus.status !== "done" &&
    ingestionStatus.status !== "error" &&
    ingestionStatus.status !== "idle";

  return (
    <button
      onClick={() => onSelect(repo)}
      className={`
        w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors cursor-pointer bg-transparent border-none
        ${isActive
          ? "bg-[var(--alpha-white-8)]"
          : "hover:bg-[var(--alpha-white-5)]"
        }
      `}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-mono text-[var(--gray-100)] truncate">
            {repo.full_name}
          </span>
          {repo.indexed && (
            <span className="shrink-0 px-1.5 py-0.5 rounded text-[10px] font-mono bg-[var(--accent-green)]/10 text-[var(--accent-green)]">
              Indexed
            </span>
          )}
          {isIngesting && (
            <span className="shrink-0 flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono bg-[var(--accent-green)]/10 text-[var(--accent-green)]">
              <Loader2 size={10} className="animate-spin" />
              {ingestionStatus.progress}%
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 mt-1">
          {repo.language && (
            <span className="flex items-center gap-1 text-[11px] font-mono text-[var(--gray-500)]">
              <span
                className="w-2 h-2 rounded-full"
                style={{ backgroundColor: langColor }}
              />
              {repo.language}
            </span>
          )}
          <span className="flex items-center gap-1 text-[11px] font-mono text-[var(--gray-500)]">
            <Star size={10} />
            {repo.stargazers_count}
          </span>
        </div>
      </div>
    </button>
  );
}
