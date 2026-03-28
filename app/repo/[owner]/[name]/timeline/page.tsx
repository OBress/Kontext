"use client";

import { useState, useEffect, useCallback } from "react";
import { useAppStore } from "@/lib/store/app-store";
import { useCurrentRepo } from "@/hooks/use-current-repo";
import {
  GitCommit,
  FileText,
  Plus,
  Minus,
  Edit3,
  Zap,
  Loader2,
  ChevronDown,
  BarChart3,
  History,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

interface CommitFile {
  path: string;
  status: string;
  additions: number;
  deletions: number;
}

interface TimelineCommit {
  id: number;
  sha: string;
  message: string;
  author_name: string;
  author_avatar_url: string | null;
  committed_at: string;
  files_changed: CommitFile[] | string;
  sync_triggered: boolean;
}

interface TimelineStats {
  totalCommits: number;
  syncedCommits: number;
}

export default function TimelinePage() {
  const activeRepo = useCurrentRepo();
  const { apiKey } = useAppStore();
  const [commits, setCommits] = useState<TimelineCommit[]>([]);
  const [stats, setStats] = useState<TimelineStats>({ totalCommits: 0, syncedCommits: 0 });
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const [offset, setOffset] = useState(0);
  const [expandedSha, setExpandedSha] = useState<string | null>(null);

  const fetchTimeline = useCallback(async (newOffset = 0, append = false) => {
    if (!activeRepo || !apiKey) return;
    setLoading(true);

    try {
      const res = await fetch(
        `/api/repos/sync/timeline?repo=${encodeURIComponent(activeRepo.full_name)}&limit=30&offset=${newOffset}`,
        { headers: { "x-google-api-key": apiKey } }
      );

      if (!res.ok) throw new Error("Failed to fetch timeline");
      const data = await res.json();

      if (append) {
        setCommits((prev) => [...prev, ...data.commits]);
      } else {
        setCommits(data.commits);
      }

      setStats(data.stats);
      setHasMore(data.pagination.hasMore);
      setOffset(newOffset + data.commits.length);
    } catch (err) {
      console.error("Timeline fetch error:", err);
    } finally {
      setLoading(false);
    }
  }, [activeRepo, apiKey]);

  useEffect(() => {
    fetchTimeline(0);
  }, [fetchTimeline]);

  const loadMore = () => {
    fetchTimeline(offset, true);
  };

  const parseFiles = (files: CommitFile[] | string): CommitFile[] => {
    if (typeof files === "string") {
      try { return JSON.parse(files); } catch { return []; }
    }
    return files || [];
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "added": return <Plus size={11} className="text-emerald-400" />;
      case "removed": return <Minus size={11} className="text-red-400" />;
      case "modified": return <Edit3 size={11} className="text-amber-400" />;
      default: return <FileText size={11} className="text-[var(--gray-500)]" />;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "added": return "text-emerald-400";
      case "removed": return "text-red-400";
      case "modified": return "text-amber-400";
      default: return "text-[var(--gray-500)]";
    }
  };

  const formatDate = (iso: string) => {
    const date = new Date(iso);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (hours < 1) return "just now";
    if (hours < 24) return `${hours}h ago`;
    if (days < 7) return `${days}d ago`;
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  };

  if (!activeRepo?.indexed) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <History size={40} className="text-[var(--gray-600)] mb-3" />
        <p className="text-sm font-mono text-[var(--gray-400)]">
          Index the repository first to enable the development timeline.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto py-6 px-4">
      {/* Header + Stats */}
      <div className="mb-6">
        <h2 className="text-lg font-mono font-bold text-white flex items-center gap-2">
          <History size={18} className="text-[var(--accent-green)]" />
          Development Timeline
        </h2>
        <p className="text-xs font-mono text-[var(--gray-500)] mt-1">
          Track how this repository evolves over time
        </p>

        {stats.totalCommits > 0 && (
          <div className="flex gap-4 mt-4">
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[var(--alpha-white-3)] border border-[var(--alpha-white-5)]">
              <BarChart3 size={13} className="text-[var(--accent-green)]" />
              <span className="text-xs font-mono text-[var(--gray-300)]">
                <span className="text-white font-semibold">{stats.totalCommits}</span> commits tracked
              </span>
            </div>
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[var(--alpha-white-3)] border border-[var(--alpha-white-5)]">
              <Zap size={13} className="text-emerald-400" />
              <span className="text-xs font-mono text-[var(--gray-300)]">
                <span className="text-white font-semibold">{stats.syncedCommits}</span> synced
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Timeline */}
      {loading && commits.length === 0 ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 size={20} className="animate-spin text-[var(--accent-green)]" />
        </div>
      ) : commits.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <GitCommit size={40} className="text-[var(--gray-600)] mb-3" />
          <p className="text-sm font-mono text-[var(--gray-400)]">
            No commits tracked yet. Sync the repository to start tracking.
          </p>
        </div>
      ) : (
        <div className="relative">
          {/* Timeline line */}
          <div className="absolute left-4 top-0 bottom-0 w-px bg-gradient-to-b from-[var(--accent-green)]/50 via-[var(--alpha-white-10)] to-transparent" />

          <div className="space-y-0">
            <AnimatePresence>
              {commits.map((commit, idx) => {
                const files = parseFiles(commit.files_changed);
                const isExpanded = expandedSha === commit.sha;

                return (
                  <motion.div
                    key={commit.sha}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: Math.min(idx * 0.03, 0.5) }}
                    className="relative pl-10"
                  >
                    {/* Timeline dot */}
                    <div className={`absolute left-2.5 top-5 w-3 h-3 rounded-full border-2 ${
                      commit.sync_triggered
                        ? "border-[var(--accent-green)] bg-[var(--accent-green)]/30"
                        : "border-[var(--gray-600)] bg-[var(--gray-900)]"
                    }`} />

                    <div
                      className={`group py-3 px-4 mb-1 rounded-lg transition-all cursor-pointer ${
                        isExpanded
                          ? "bg-[var(--alpha-white-5)] border border-[var(--alpha-white-10)]"
                          : "hover:bg-[var(--alpha-white-3)]"
                      }`}
                      onClick={() => setExpandedSha(isExpanded ? null : commit.sha)}
                    >
                      {/* Commit header */}
                      <div className="flex items-start gap-3">
                        {/* Avatar */}
                        {commit.author_avatar_url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={commit.author_avatar_url}
                            alt={commit.author_name}
                            className="w-6 h-6 rounded-full shrink-0 mt-0.5"
                          />
                        ) : (
                          <div className="w-6 h-6 rounded-full bg-[var(--alpha-white-10)] flex items-center justify-center shrink-0 mt-0.5">
                            <span className="text-[10px] font-mono text-[var(--gray-400)]">
                              {commit.author_name?.[0]?.toUpperCase() || "?"}
                            </span>
                          </div>
                        )}

                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-mono text-[var(--gray-200)] leading-relaxed truncate">
                            {commit.message.split("\n")[0]}
                          </p>
                          <div className="flex items-center gap-2 mt-1">
                            <span className="text-[10px] font-mono text-[var(--gray-500)]">
                              {commit.author_name}
                            </span>
                            <span className="text-[10px] text-[var(--gray-700)]">·</span>
                            <span className="text-[10px] font-mono text-[var(--gray-500)]">
                              {formatDate(commit.committed_at)}
                            </span>
                            <span className="text-[10px] text-[var(--gray-700)]">·</span>
                            <span className="text-[10px] font-mono text-[var(--gray-600)]">
                              {commit.sha.slice(0, 7)}
                            </span>
                            {commit.sync_triggered && (
                              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[var(--accent-green)]/10 text-[var(--accent-green)]">
                                ⚡ Synced
                              </span>
                            )}
                          </div>
                        </div>

                        {files.length > 0 && (
                          <ChevronDown
                            size={14}
                            className={`text-[var(--gray-600)] transition-transform shrink-0 ${
                              isExpanded ? "rotate-180" : ""
                            }`}
                          />
                        )}
                      </div>

                      {/* Expanded file list */}
                      <AnimatePresence>
                        {isExpanded && files.length > 0 && (
                          <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: "auto", opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={{ duration: 0.15 }}
                            className="overflow-hidden"
                          >
                            <div className="mt-3 pt-3 border-t border-[var(--alpha-white-5)] space-y-1">
                              {files.slice(0, 30).map((file, fileIdx) => (
                                <div key={fileIdx} className="flex items-center gap-2 py-0.5">
                                  {getStatusIcon(file.status)}
                                  <span className={`text-[10px] font-mono truncate ${getStatusColor(file.status)}`}>
                                    {file.path}
                                  </span>
                                  {(file.additions > 0 || file.deletions > 0) && (
                                    <span className="text-[10px] font-mono text-[var(--gray-600)] shrink-0">
                                      {file.additions > 0 && <span className="text-emerald-500">+{file.additions}</span>}
                                      {file.deletions > 0 && <span className="text-red-500 ml-1">-{file.deletions}</span>}
                                    </span>
                                  )}
                                </div>
                              ))}
                              {files.length > 30 && (
                                <p className="text-[10px] font-mono text-[var(--gray-600)] pt-1">
                                  ... and {files.length - 30} more files
                                </p>
                              )}
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>

          {/* Load more */}
          {hasMore && (
            <div className="pl-10 pt-4">
              <button
                onClick={loadMore}
                disabled={loading}
                className="flex items-center gap-2 px-4 py-2 text-xs font-mono rounded-lg
                  bg-[var(--alpha-white-5)] border border-[var(--alpha-white-10)]
                  text-[var(--gray-400)] hover:text-white hover:bg-[var(--alpha-white-8)]
                  disabled:opacity-50 transition-all"
              >
                {loading ? <Loader2 size={13} className="animate-spin" /> : <ChevronDown size={13} />}
                Load More
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
