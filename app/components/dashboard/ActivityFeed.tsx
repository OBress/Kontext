"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import {
  Database,
  MessageSquare,
  Wand2,
  Users,
  GitCommitHorizontal,
  GitPullRequest,
  CircleDot,
  GitBranch,
  Tag,
  Plus,
  X,
  Trash2,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

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

// ── Event type → icon + color mapping ──
const EVENT_CONFIG: Record<
  string,
  { icon: LucideIcon; color: string; label: string }
> = {
  repo_added: {
    icon: Plus,
    color: "var(--accent-green)",
    label: "Repo Added",
  },
  repo_indexed: {
    icon: Database,
    color: "var(--accent-green)",
    label: "Indexed",
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
  chat_session: {
    icon: MessageSquare,
    color: "var(--accent-green)",
    label: "Chat",
  },
  prompt_generated: {
    icon: Wand2,
    color: "var(--accent-muted)",
    label: "Prompt",
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

// ── Relative time formatter ──
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

// ── Source badge component ──
function SourceBadge({ source }: { source: "kontext" | "github" }) {
  if (source === "github") {
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-mono font-medium bg-white/8 text-[var(--gray-300)] border border-white/5">
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
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-mono font-medium bg-[var(--accent-green)]/10 text-[var(--accent-green)] border border-[var(--accent-green)]/10">
      <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent-green)]" />
      Kontext
    </span>
  );
}

// ── Loading skeleton ──
function ActivitySkeleton() {
  return (
    <div className="space-y-3">
      {[...Array(4)].map((_, i) => (
        <div key={i} className="flex items-start gap-3 animate-pulse">
          <div className="w-6 h-6 rounded-full bg-[var(--alpha-white-8)] shrink-0" />
          <div className="flex-1 space-y-1.5 pt-0.5">
            <div className="h-3 bg-[var(--alpha-white-5)] rounded w-3/4" />
            <div className="h-2 bg-[var(--alpha-white-5)] rounded w-1/2" />
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

  // Fetch initial events
  const fetchEvents = useCallback(async () => {
    try {
      const res = await fetch("/api/activity?limit=15");
      if (res.ok) {
        const data = await res.json();
        setEvents(data.events || []);
      }
    } catch {
      // Silent fail
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  // Subscribe to Supabase Realtime for new events
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
          setEvents((prev) => {
            // Deduplicate
            if (prev.find((e) => e.id === newEvent.id)) return prev;
            // Add at the top, keep max 15
            return [newEvent, ...prev].slice(0, 15);
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  // ── Clear individual event ──
  const handleDismiss = async (eventId: number, e: React.MouseEvent) => {
    e.stopPropagation();
    // Optimistic removal
    setEvents((prev) => prev.filter((ev) => ev.id !== eventId));
    try {
      await fetch(`/api/activity?id=${eventId}`, { method: "DELETE" });
    } catch {
      // Re-fetch on error
      fetchEvents();
    }
  };

  // ── Clear all events (double-click) ──
  const handleClearAll = async () => {
    if (!clearConfirm) {
      setClearConfirm(true);
      // Auto-reset after 3 seconds
      setTimeout(() => setClearConfirm(false), 3000);
      return;
    }
    // Second click — actually clear
    setEvents([]);
    setClearConfirm(false);
    try {
      await fetch("/api/activity", { method: "DELETE" });
    } catch {
      fetchEvents();
    }
  };

  const handleClick = (event: ActivityEvent) => {
    if (event.repo_full_name) {
      const [owner, name] = event.repo_full_name.split("/");
      router.push(`/repo/${owner}/${name}`);
    }
  };

  return (
    <div className="space-y-1">
      {/* Header row with clear button */}
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-mono text-xs uppercase tracking-wider text-[var(--gray-500)] m-0">
          Recent Activity
        </h3>
        {events.length > 0 && (
          <button
            onClick={handleClearAll}
            className={`flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono transition-all border-none cursor-pointer ${
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

      {loading ? (
        <ActivitySkeleton />
      ) : events.length === 0 ? (
        <div className="text-center py-8">
          <div className="w-8 h-8 rounded-full bg-[var(--alpha-white-5)] flex items-center justify-center mx-auto mb-2">
            <Database size={14} className="text-[var(--gray-600)]" />
          </div>
          <p className="font-mono text-[11px] text-[var(--gray-600)] m-0">
            No activity yet
          </p>
          <p className="font-mono text-[10px] text-[var(--gray-700)] m-0 mt-0.5">
            Add a repo to get started
          </p>
        </div>
      ) : (
        <div className="relative">
          {/* Vertical timeline line */}
          <div className="absolute left-[11px] top-2 bottom-2 w-px bg-[var(--alpha-white-8)]" />

          <div className="space-y-1">
            {events.map((event, i) => {
              const config = getEventConfig(event.event_type);
              const IconComponent = config.icon;

              return (
                <div
                  key={event.id}
                  className={`relative flex items-start gap-3 animate-fade-in-up group ${
                    event.repo_full_name
                      ? "cursor-pointer hover:bg-[var(--alpha-white-5)]"
                      : ""
                  } -mx-2 px-2 py-1.5 rounded-lg transition-colors`}
                  style={{
                    animationDelay: `${i * 40}ms`,
                    animationFillMode: "backwards",
                  }}
                  onClick={() => handleClick(event)}
                >
                  {/* Dismiss button — visible on hover */}
                  <button
                    onClick={(e) => handleDismiss(event.id, e)}
                    className="absolute right-1 top-1 p-0.5 rounded opacity-0 group-hover:opacity-100 bg-transparent text-[var(--gray-600)] hover:text-[var(--gray-300)] border-none cursor-pointer transition-opacity"
                    title="Dismiss"
                  >
                    <X size={10} />
                  </button>

                  {/* Icon */}
                  <div
                    className="relative z-10 w-6 h-6 rounded-full flex items-center justify-center shrink-0"
                    style={{ background: `${config.color}15` }}
                  >
                    <IconComponent
                      size={11}
                      style={{ color: config.color }}
                    />
                  </div>

                  {/* Content */}
                  <div className="min-w-0 flex-1 pr-4">
                    {/* Source badge */}
                    <div className="flex items-center gap-1.5 mb-0.5 flex-wrap">
                      <SourceBadge source={event.source} />
                    </div>

                    <p className="font-mono text-[11px] text-[var(--gray-200)] m-0 leading-relaxed line-clamp-2">
                      {event.title}
                    </p>

                    {/* Description */}
                    {event.description && (
                      <p className="font-mono text-[10px] text-[var(--gray-500)] m-0 mt-0.5 line-clamp-1">
                        {event.description}
                      </p>
                    )}

                    {/* Repo + time */}
                    <div className="flex items-center gap-1.5 mt-0.5">
                      {event.repo_full_name && (
                        <>
                          <span className="font-mono text-[10px] text-[var(--gray-500)] group-hover:text-[var(--accent-green)] transition-colors">
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
  );
}
