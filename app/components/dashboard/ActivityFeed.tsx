"use client";

import { useCallback, useEffect, useState } from "react";
import type { LucideIcon } from "lucide-react";
import {
  CircleDot,
  Database,
  GitBranch,
  GitCommitHorizontal,
  GitPullRequest,
  Play,
  Plus,
  RefreshCw,
  ShieldAlert,
  Tag,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { isActivityEventType } from "@/lib/activity";
import { createClient } from "@/lib/supabase/client";

interface ActivityEvent {
  id: number;
  user_id: string;
  repo_full_name: string | null;
  source: "kontext" | "github";
  event_type: string;
  title: string;
  description: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

const EVENT_CONFIG: Record<
  string,
  { icon: LucideIcon; color: string; label: string }
> = {
  repo_added: {
    icon: Plus,
    color: "var(--accent-green)",
    label: "Repo Added",
  },
  repo_deleted: {
    icon: Trash2,
    color: "var(--accent-red)",
    label: "Repo Deleted",
  },
  repo_indexed: {
    icon: Database,
    color: "var(--accent-green)",
    label: "Indexed",
  },
  repo_synced: {
    icon: RefreshCw,
    color: "#58A6FF",
    label: "Synced",
  },
  repo_check_completed: {
    icon: ShieldAlert,
    color: "#F0883E",
    label: "Checks",
  },
  team_member_joined: {
    icon: Users,
    color: "var(--accent-yellow)",
    label: "Team",
  },
  team_invite_sent: {
    icon: Users,
    color: "var(--accent-amber)",
    label: "Invite",
  },
  push: {
    icon: GitCommitHorizontal,
    color: "#58A6FF",
    label: "Push",
  },
  pull_request: {
    icon: GitPullRequest,
    color: "#A371F7",
    label: "PR",
  },
  issue: {
    icon: CircleDot,
    color: "#3FB950",
    label: "Issue",
  },
  create: {
    icon: GitBranch,
    color: "#58A6FF",
    label: "Branch",
  },
  release: {
    icon: Tag,
    color: "#D29922",
    label: "Release",
  },
  workflow_run: {
    icon: Play,
    color: "#3FB950",
    label: "Actions",
  },
};

function getEventConfig(eventType: string) {
  return (
    EVENT_CONFIG[eventType] || {
      icon: Database,
      color: "var(--accent-muted)",
      label: eventType,
    }
  );
}

function timeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  const diffSec = Math.floor(diffMs / 1000);

  if (diffSec < 60) return "just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return `${diffDay}d ago`;
  const diffWeek = Math.floor(diffDay / 7);
  if (diffWeek < 4) return `${diffWeek}w ago`;
  return new Date(dateStr).toLocaleDateString();
}

function SourceBadge({ source }: { source: "kontext" | "github" }) {
  if (source === "github") {
    return (
      <span className="inline-flex items-center gap-1 rounded border border-white/5 bg-white/8 px-1.5 py-0.5 font-mono text-[9px] font-medium text-[var(--gray-300)]">
        <svg
          viewBox="0 0 16 16"
          width="9"
          height="9"
          fill="currentColor"
          className="opacity-70"
        >
          <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
        </svg>
        GitHub
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1 rounded border border-[var(--accent-green)]/10 bg-[var(--accent-green)]/10 px-1.5 py-0.5 font-mono text-[9px] font-medium text-[var(--accent-green)]">
      <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent-green)]" />
      Kontext
    </span>
  );
}

function ActivitySkeleton() {
  return (
    <div className="space-y-3">
      {[...Array(4)].map((_, i) => (
        <div key={i} className="flex items-start gap-3 animate-pulse">
          <div className="h-6 w-6 shrink-0 rounded-full bg-[var(--alpha-white-8)]" />
          <div className="flex-1 space-y-1.5 pt-0.5">
            <div className="h-3 w-3/4 rounded bg-[var(--alpha-white-5)]" />
            <div className="h-2 w-1/2 rounded bg-[var(--alpha-white-5)]" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function ActivityFeed() {
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [clearConfirm, setClearConfirm] = useState(false);
  const router = useRouter();

  const fetchEvents = useCallback(async () => {
    try {
      const res = await fetch("/api/activity?limit=50");
      if (res.ok) {
        const data = await res.json();
        setEvents(data.events || []);
      }
    } catch {
      // Silent fail.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  useEffect(() => {
    const supabase = createClient();

    const channel = supabase
      .channel("activity-feed")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "activity_events",
        },
        (payload) => {
          const newEvent = payload.new as ActivityEvent;
          if (!isActivityEventType(newEvent.event_type)) return;

          setEvents((prev) => {
            if (prev.find((event) => event.id === newEvent.id)) return prev;
            return [newEvent, ...prev].slice(0, 50);
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const handleDismiss = async (eventId: number, e: React.MouseEvent) => {
    e.stopPropagation();
    setEvents((prev) => prev.filter((event) => event.id !== eventId));

    try {
      await fetch(`/api/activity?id=${eventId}`, { method: "DELETE" });
    } catch {
      fetchEvents();
    }
  };

  const handleClearAll = async () => {
    if (!clearConfirm) {
      setClearConfirm(true);
      setTimeout(() => setClearConfirm(false), 3000);
      return;
    }

    setEvents([]);
    setClearConfirm(false);

    try {
      await fetch("/api/activity", { method: "DELETE" });
    } catch {
      fetchEvents();
    }
  };

  const handleClick = (event: ActivityEvent) => {
    if (!event.repo_full_name) return;
    const [owner, name] = event.repo_full_name.split("/");
    router.push(`/repo/${owner}/${name}`);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="mb-3 flex shrink-0 items-center justify-between">
        <h3 className="m-0 font-mono text-xs uppercase tracking-wider text-[var(--gray-500)]">
          Recent Activity
        </h3>
        {events.length > 0 && (
          <button
            onClick={handleClearAll}
            className={`flex cursor-pointer items-center gap-1 rounded border-none px-2 py-0.5 font-mono text-[10px] transition-all ${
              clearConfirm
                ? "bg-[var(--accent-red)]/15 text-[var(--accent-red)]"
                : "bg-transparent text-[var(--gray-600)] hover:text-[var(--gray-400)]"
            }`}
          >
            <Trash2 size={10} />
            {clearConfirm ? "Click again to confirm" : "Clear all"}
          </button>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pr-1 overscroll-contain">
        {loading ? (
          <ActivitySkeleton />
        ) : events.length === 0 ? (
          <div className="flex h-full min-h-[240px] items-center justify-center text-center">
            <div>
              <div className="mx-auto mb-2 flex h-8 w-8 items-center justify-center rounded-full bg-[var(--alpha-white-5)]">
                <Database size={14} className="text-[var(--gray-600)]" />
              </div>
              <p className="m-0 font-mono text-[11px] text-[var(--gray-600)]">
                No activity yet
              </p>
              <p className="m-0 mt-0.5 font-mono text-[10px] text-[var(--gray-700)]">
                Repo and GitHub activity will appear here
              </p>
            </div>
          </div>
        ) : (
          <div className="relative">
            <div className="absolute bottom-2 left-[11px] top-2 w-px bg-[var(--alpha-white-8)]" />

            <div className="space-y-1">
              {events.map((event, i) => {
                const config = getEventConfig(event.event_type);
                const IconComponent = config.icon;

                return (
                  <div
                    key={event.id}
                    className={`group relative -mx-2 flex items-start gap-3 rounded-lg px-2 py-1.5 transition-colors animate-fade-in-up ${
                      event.repo_full_name
                        ? "cursor-pointer hover:bg-[var(--alpha-white-5)]"
                        : ""
                    }`}
                    style={{
                      animationDelay: `${i * 40}ms`,
                      animationFillMode: "backwards",
                    }}
                    onClick={() => handleClick(event)}
                  >
                    <button
                      onClick={(e) => handleDismiss(event.id, e)}
                      className="absolute right-1 top-1 cursor-pointer rounded bg-transparent p-0.5 text-[var(--gray-600)] opacity-0 transition-opacity hover:text-[var(--gray-300)] group-hover:opacity-100 border-none"
                      title="Dismiss"
                    >
                      <X size={10} />
                    </button>

                    <div
                      className="relative z-10 flex h-6 w-6 shrink-0 items-center justify-center rounded-full"
                      style={{ background: `${config.color}15` }}
                    >
                      <IconComponent size={11} style={{ color: config.color }} />
                    </div>

                    <div className="min-w-0 flex-1 pr-4">
                      <div className="mb-0.5 flex flex-wrap items-center gap-1.5">
                        <SourceBadge source={event.source} />
                      </div>

                      <p className="m-0 line-clamp-2 font-mono text-[11px] leading-relaxed text-[var(--gray-200)]">
                        {event.title}
                      </p>

                      {event.description && (
                        <p className="m-0 mt-0.5 line-clamp-1 font-mono text-[10px] text-[var(--gray-500)]">
                          {event.description}
                        </p>
                      )}

                      <div className="mt-0.5 flex items-center gap-1.5">
                        {event.repo_full_name && (
                          <>
                            <span className="font-mono text-[10px] text-[var(--gray-500)] transition-colors group-hover:text-[var(--accent-green)]">
                              {event.repo_full_name}
                            </span>
                            <span className="text-[var(--gray-600)]">·</span>
                          </>
                        )}
                        <span className="font-mono text-[10px] text-[var(--gray-600)]">
                          {timeAgo(event.created_at)}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
