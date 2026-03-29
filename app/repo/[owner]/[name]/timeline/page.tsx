"use client";

import { useState, useEffect, useCallback, useRef } from "react";
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
  ChevronRight,
  BarChart3,
  History,
  Search,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

interface CommitFile {
  path: string;
  status: string;
  additions?: number;
  deletions?: number;
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
  ai_summary: string | null;
  push_group_id: string | null;
}

interface PushGroup {
  push_group_id: string;
  committed_at: string;
  author_name: string;
  author_avatar_url: string | null;
  commit_count: number;
  commits: TimelineCommit[];
}

interface TimelineStats {
  totalCommits: number;
  syncedCommits: number;
  pendingSummaries: number;
}

export default function TimelinePage() {
  const activeRepo = useCurrentRepo();
  const { apiKey } = useAppStore();
  const [pushGroups, setPushGroups] = useState<PushGroup[]>([]);
  const [stats, setStats] = useState<TimelineStats>({
    totalCommits: 0,
    syncedCommits: 0,
    pendingSummaries: 0,
  });
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const [offset, setOffset] = useState(0);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState("");
  const [backfilling, setBackfilling] = useState(false);
  const autoBackfillTriggered = useRef(false);

  const fetchTimeline = useCallback(
    async (newOffset = 0, append = false) => {
      if (!activeRepo || !apiKey) return;
      setLoading(true);

      try {
        const res = await fetch(
          `/api/repos/sync/timeline?repo=${encodeURIComponent(
            activeRepo.full_name
          )}&limit=50&offset=${newOffset}`,
          { headers: { "x-google-api-key": apiKey } }
        );

        if (!res.ok) throw new Error("Failed to fetch timeline");
        const data = await res.json();

        if (append) {
          setPushGroups((prev) => [...prev, ...(data.pushGroups || [])]);
        } else {
          setPushGroups(data.pushGroups || []);
        }

        setStats(data.stats);
        setHasMore(data.pagination.hasMore);
        setOffset(newOffset + (data.commits?.length || 0));
      } catch (err) {
        console.error("Timeline fetch error:", err);
      } finally {
        setLoading(false);
      }
    },
    [activeRepo, apiKey]
  );

  const handleBackfill = useCallback(async () => {
    if (!activeRepo || !apiKey) return;
    setBackfilling(true);
    try {
      await fetch("/api/repos/sync/timeline/backfill", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-google-api-key": apiKey,
        },
        body: JSON.stringify({ repo_full_name: activeRepo.full_name }),
      });
      // Refresh timeline after backfill
      await fetchTimeline(0);
    } catch (err) {
      console.error("Backfill error:", err);
    } finally {
      setBackfilling(false);
    }
  }, [activeRepo, apiKey, fetchTimeline]);

  useEffect(() => {
    fetchTimeline(0);
  }, [fetchTimeline]);

  // Auto-trigger AI summary backfill when pending summaries are detected
  useEffect(() => {
    if (
      stats.pendingSummaries > 0 &&
      !backfilling &&
      !autoBackfillTriggered.current &&
      activeRepo &&
      apiKey
    ) {
      autoBackfillTriggered.current = true;
      handleBackfill();
    }
  }, [stats.pendingSummaries, backfilling, activeRepo, apiKey, handleBackfill]);

  const loadMore = () => {
    fetchTimeline(offset, true);
  };

  const toggleGroup = (groupId: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) {
        next.delete(groupId);
      } else {
        next.add(groupId);
      }
      return next;
    });
  };

  const toggleFiles = (sha: string) => {
    setExpandedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(sha)) {
        next.delete(sha);
      } else {
        next.add(sha);
      }
      return next;
    });
  };

  const parseFiles = (files: CommitFile[] | string): CommitFile[] => {
    if (typeof files === "string") {
      try {
        return JSON.parse(files);
      } catch {
        return [];
      }
    }
    return files || [];
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "added":
        return <Plus size={11} className="text-emerald-400" />;
      case "removed":
        return <Minus size={11} className="text-red-400" />;
      case "modified":
        return <Edit3 size={11} className="text-amber-400" />;
      default:
        return <FileText size={11} className="text-[var(--gray-500)]" />;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "added":
        return "text-emerald-400";
      case "removed":
        return "text-red-400";
      case "modified":
        return "text-amber-400";
      default:
        return "text-[var(--gray-500)]";
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
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  // Filter push groups by search query
  const filteredGroups = searchQuery
    ? pushGroups.filter((group) =>
        group.commits.some(
          (c) =>
            c.ai_summary
              ?.toLowerCase()
              .includes(searchQuery.toLowerCase()) ||
            c.message.toLowerCase().includes(searchQuery.toLowerCase())
        )
      )
    : pushGroups;

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
          AI-narrated history of development — searchable from the chat window
        </p>

        {stats.totalCommits > 0 && (
          <div className="flex gap-3 mt-4 flex-wrap">
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[var(--alpha-white-3)] border border-[var(--alpha-white-5)]">
              <BarChart3 size={13} className="text-[var(--accent-green)]" />
              <span className="text-xs font-mono text-[var(--gray-300)]">
                <span className="text-white font-semibold">
                  {stats.totalCommits}
                </span>{" "}
                commits tracked
              </span>
            </div>
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[var(--alpha-white-3)] border border-[var(--alpha-white-5)]">
              <Zap size={13} className="text-emerald-400" />
              <span className="text-xs font-mono text-[var(--gray-300)]">
                <span className="text-white font-semibold">
                  {stats.syncedCommits}
                </span>{" "}
                synced
              </span>
            </div>
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[var(--alpha-white-3)] border border-[var(--alpha-white-5)]">
              <Zap size={13} className="text-purple-400" />
              <span className="text-xs font-mono text-[var(--gray-300)]">
                <span className="text-white font-semibold">
                  {stats.totalCommits - stats.pendingSummaries}
                </span>{" "}
                AI summaries
              </span>
            </div>
          </div>
        )}

        {/* Backfill banner */}
        {stats.pendingSummaries > 0 && (
          <div className="mt-4 flex items-center gap-3 px-4 py-3 rounded-lg bg-purple-500/10 border border-purple-500/20">
            <Loader2 size={14} className="text-purple-400 shrink-0 animate-spin" />
            <span className="text-xs font-mono text-[var(--gray-300)] flex-1">
              {backfilling
                ? `Generating AI summaries for ${stats.pendingSummaries} commits…`
                : `${stats.pendingSummaries} commits pending AI summary`}
            </span>
          </div>
        )}

        {/* Search bar */}
        <div className="relative mt-4">
          <Search
            size={14}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--gray-500)]"
          />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search timeline..."
            className="w-full pl-9 pr-4 py-2.5 rounded-lg font-mono text-sm bg-[var(--surface-1)] border border-[var(--alpha-white-5)] text-[var(--gray-200)] placeholder:text-[var(--gray-600)] focus:outline-none focus:border-[var(--accent-green)]/40 transition-colors"
          />
        </div>
      </div>

      {/* Timeline */}
      {loading && pushGroups.length === 0 ? (
        <div className="flex items-center justify-center py-20">
          <Loader2
            size={20}
            className="animate-spin text-[var(--accent-green)]"
          />
        </div>
      ) : filteredGroups.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <GitCommit size={40} className="text-[var(--gray-600)] mb-3" />
          <p className="text-sm font-mono text-[var(--gray-400)]">
            {searchQuery
              ? "No commits match your search."
              : "No commits tracked yet. Sync the repository to start tracking."}
          </p>
        </div>
      ) : (
        <div className="relative">
          {/* Timeline line */}
          <div className="absolute left-4 top-0 bottom-0 w-px bg-gradient-to-b from-[var(--accent-green)]/50 via-[var(--alpha-white-10)] to-transparent" />

          <div className="space-y-2">
            <AnimatePresence>
              {filteredGroups.map((group, groupIdx) => {
                const isGroupExpanded = expandedGroups.has(
                  group.push_group_id
                );
                const isSingleCommit = group.commit_count === 1;
                const primaryCommit = group.commits[0];

                return (
                  <motion.div
                    key={group.push_group_id}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{
                      delay: Math.min(groupIdx * 0.03, 0.5),
                    }}
                    className="relative pl-10"
                  >
                    {/* Timeline dot */}
                    <div
                      className={`absolute left-2.5 top-4 w-3 h-3 rounded-full border-2 ${
                        primaryCommit?.sync_triggered
                          ? "border-[var(--accent-green)] bg-[var(--accent-green)]/30"
                          : "border-[var(--gray-600)] bg-[var(--gray-900)]"
                      }`}
                    />

                    {/* Push group card */}
                    <div className="rounded-lg border border-[var(--alpha-white-5)] bg-[var(--alpha-white-3)] overflow-hidden">
                      {/* Group header */}
                      <button
                        onClick={() =>
                          !isSingleCommit &&
                          toggleGroup(group.push_group_id)
                        }
                        className={`w-full text-left px-4 py-3 flex items-center gap-3 ${
                          !isSingleCommit
                            ? "hover:bg-[var(--alpha-white-5)] cursor-pointer"
                            : "cursor-default"
                        } transition-colors bg-transparent border-none`}
                      >
                        {/* Avatar */}
                        {group.author_avatar_url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={group.author_avatar_url}
                            alt={group.author_name}
                            className="w-7 h-7 rounded-full shrink-0"
                          />
                        ) : (
                          <div className="w-7 h-7 rounded-full bg-[var(--alpha-white-10)] flex items-center justify-center shrink-0">
                            <span className="text-[10px] font-mono text-[var(--gray-400)]">
                              {group.author_name?.[0]?.toUpperCase() ||
                                "?"}
                            </span>
                          </div>
                        )}

                        <div className="flex-1 min-w-0">
                          {/* Show AI summary if single commit */}
                          {isSingleCommit && primaryCommit?.ai_summary ? (
                            <>
                              <p className="text-xs text-[var(--gray-200)] leading-relaxed m-0">
                                {primaryCommit.ai_summary}
                              </p>
                              <p className="text-[10px] font-mono text-[var(--gray-600)] mt-0.5 truncate m-0">
                                {primaryCommit.message.split("\n")[0]}
                              </p>
                            </>
                          ) : isSingleCommit ? (
                            <p className="text-xs font-mono text-[var(--gray-200)] leading-relaxed truncate m-0">
                              {primaryCommit?.message.split("\n")[0]}
                            </p>
                          ) : (
                            <p className="text-xs font-mono text-[var(--gray-200)] m-0">
                              {group.commit_count} commits
                            </p>
                          )}
                          <div className="flex items-center gap-2 mt-1">
                            <span className="text-[10px] font-mono text-[var(--gray-500)]">
                              {group.author_name}
                            </span>
                            <span className="text-[10px] text-[var(--gray-700)]">
                              ·
                            </span>
                            <span className="text-[10px] font-mono text-[var(--gray-500)]">
                              {formatDate(group.committed_at)}
                            </span>
                            {isSingleCommit && (
                              <>
                                <span className="text-[10px] text-[var(--gray-700)]">
                                  ·
                                </span>
                                <span className="text-[10px] font-mono text-[var(--gray-600)]">
                                  {primaryCommit?.sha.slice(0, 7)}
                                </span>
                              </>
                            )}
                            {primaryCommit?.sync_triggered && (
                              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[var(--accent-green)]/10 text-[var(--accent-green)]">
                                ⚡ Synced
                              </span>
                            )}
                            {primaryCommit?.ai_summary && (
                              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-purple-500/10 text-purple-400">
                                ✨ AI
                              </span>
                            )}
                          </div>
                        </div>

                        {!isSingleCommit && (
                          <div className="flex items-center gap-2 shrink-0">
                            <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-[var(--alpha-white-5)] text-[var(--gray-400)]">
                              {group.commit_count}
                            </span>
                            {isGroupExpanded ? (
                              <ChevronDown
                                size={14}
                                className="text-[var(--gray-500)]"
                              />
                            ) : (
                              <ChevronRight
                                size={14}
                                className="text-[var(--gray-500)]"
                              />
                            )}
                          </div>
                        )}

                        {/* Single commit file expand toggle */}
                        {isSingleCommit &&
                          parseFiles(primaryCommit?.files_changed || [])
                            .length > 0 && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleFiles(primaryCommit.sha);
                              }}
                              className="shrink-0 text-[var(--gray-600)] hover:text-[var(--gray-400)] transition-colors bg-transparent border-none cursor-pointer p-1"
                            >
                              <ChevronDown
                                size={14}
                                className={`transition-transform ${
                                  expandedFiles.has(primaryCommit.sha)
                                    ? "rotate-180"
                                    : ""
                                }`}
                              />
                            </button>
                          )}
                      </button>

                      {/* Single commit file list */}
                      {isSingleCommit &&
                        expandedFiles.has(primaryCommit?.sha || "") && (
                          <div className="px-4 pb-3 border-t border-[var(--alpha-white-5)]">
                            <div className="pt-2 space-y-0.5">
                              {parseFiles(primaryCommit?.files_changed || [])
                                .slice(0, 30)
                                .map((file, fileIdx) => (
                                  <div
                                    key={fileIdx}
                                    className="flex items-center gap-2 py-0.5"
                                  >
                                    {getStatusIcon(file.status)}
                                    <span
                                      className={`text-[10px] font-mono truncate ${getStatusColor(
                                        file.status
                                      )}`}
                                    >
                                      {file.path}
                                    </span>
                                    {((file.additions || 0) > 0 ||
                                      (file.deletions || 0) > 0) && (
                                      <span className="text-[10px] font-mono text-[var(--gray-600)] shrink-0">
                                        {(file.additions || 0) > 0 && (
                                          <span className="text-emerald-500">
                                            +{file.additions}
                                          </span>
                                        )}
                                        {(file.deletions || 0) > 0 && (
                                          <span className="text-red-500 ml-1">
                                            -{file.deletions}
                                          </span>
                                        )}
                                      </span>
                                    )}
                                  </div>
                                ))}
                            </div>
                          </div>
                        )}

                      {/* Expanded group: individual commits */}
                      <AnimatePresence>
                        {!isSingleCommit && isGroupExpanded && (
                          <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: "auto", opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={{ duration: 0.15 }}
                            className="overflow-hidden border-t border-[var(--alpha-white-5)]"
                          >
                            <div className="py-1">
                              {group.commits.map((commit) => {
                                const files = parseFiles(
                                  commit.files_changed
                                );
                                const isFilesExpanded = expandedFiles.has(
                                  commit.sha
                                );

                                return (
                                  <div
                                    key={commit.sha}
                                    className="px-4 py-2.5 hover:bg-[var(--alpha-white-3)] transition-colors"
                                  >
                                    <div className="flex items-start gap-3">
                                      {/* Commit avatar */}
                                      {commit.author_avatar_url ? (
                                        // eslint-disable-next-line @next/next/no-img-element
                                        <img
                                          src={commit.author_avatar_url}
                                          alt={commit.author_name}
                                          className="w-5 h-5 rounded-full shrink-0 mt-0.5"
                                        />
                                      ) : (
                                        <div className="w-5 h-5 rounded-full bg-[var(--alpha-white-10)] flex items-center justify-center shrink-0 mt-0.5">
                                          <span className="text-[8px] font-mono text-[var(--gray-400)]">
                                            {commit.author_name?.[0]?.toUpperCase() ||
                                              "?"}
                                          </span>
                                        </div>
                                      )}

                                      <div className="flex-1 min-w-0">
                                        {/* AI Summary */}
                                        {commit.ai_summary ? (
                                          <>
                                            <p className="text-xs text-[var(--gray-200)] leading-relaxed m-0">
                                              {commit.ai_summary}
                                            </p>
                                            <p className="text-[10px] font-mono text-[var(--gray-600)] mt-0.5 truncate m-0">
                                              {
                                                commit.message.split(
                                                  "\n"
                                                )[0]
                                              }
                                            </p>
                                          </>
                                        ) : (
                                          <p className="text-xs font-mono text-[var(--gray-200)] leading-relaxed truncate m-0">
                                            {
                                              commit.message.split(
                                                "\n"
                                              )[0]
                                            }
                                          </p>
                                        )}

                                        <div className="flex items-center gap-2 mt-1">
                                          <span className="text-[10px] font-mono text-[var(--gray-600)]">
                                            {commit.sha.slice(0, 7)}
                                          </span>
                                          <span className="text-[10px] text-[var(--gray-700)]">
                                            ·
                                          </span>
                                          <span className="text-[10px] font-mono text-[var(--gray-500)]">
                                            {commit.author_name}
                                          </span>
                                          {commit.ai_summary && (
                                            <span className="text-[10px] font-mono px-1 py-0.5 rounded bg-purple-500/10 text-purple-400">
                                              ✨
                                            </span>
                                          )}
                                        </div>
                                      </div>

                                      {files.length > 0 && (
                                        <button
                                          onClick={() =>
                                            toggleFiles(commit.sha)
                                          }
                                          className="shrink-0 text-[var(--gray-600)] hover:text-[var(--gray-400)] transition-colors bg-transparent border-none cursor-pointer p-1"
                                        >
                                          <ChevronDown
                                            size={12}
                                            className={`transition-transform ${
                                              isFilesExpanded
                                                ? "rotate-180"
                                                : ""
                                            }`}
                                          />
                                        </button>
                                      )}
                                    </div>

                                    {/* Commit file list */}
                                    <AnimatePresence>
                                      {isFilesExpanded &&
                                        files.length > 0 && (
                                          <motion.div
                                            initial={{
                                              height: 0,
                                              opacity: 0,
                                            }}
                                            animate={{
                                              height: "auto",
                                              opacity: 1,
                                            }}
                                            exit={{
                                              height: 0,
                                              opacity: 0,
                                            }}
                                            transition={{ duration: 0.1 }}
                                            className="overflow-hidden ml-8"
                                          >
                                            <div className="pt-2 space-y-0.5">
                                              {files
                                                .slice(0, 30)
                                                .map(
                                                  (file, fileIdx) => (
                                                    <div
                                                      key={fileIdx}
                                                      className="flex items-center gap-2 py-0.5"
                                                    >
                                                      {getStatusIcon(
                                                        file.status
                                                      )}
                                                      <span
                                                        className={`text-[10px] font-mono truncate ${getStatusColor(
                                                          file.status
                                                        )}`}
                                                      >
                                                        {file.path}
                                                      </span>
                                                    </div>
                                                  )
                                                )}
                                            </div>
                                          </motion.div>
                                        )}
                                    </AnimatePresence>
                                  </div>
                                );
                              })}
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
                  disabled:opacity-50 transition-all cursor-pointer"
              >
                {loading ? (
                  <Loader2 size={13} className="animate-spin" />
                ) : (
                  <ChevronDown size={13} />
                )}
                Load More
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
