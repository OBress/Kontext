"use client";

import { Database, MessageSquare, Wand2, Users } from "lucide-react";

const activities = [
  {
    icon: Database,
    text: "acme/web-platform was indexed",
    time: "2 hours ago",
    color: "var(--accent-green)",
  },
  {
    icon: MessageSquare,
    text: "Chat session with acme/api-gateway",
    time: "5 hours ago",
    color: "var(--accent-green)",
  },
  {
    icon: Wand2,
    text: "System prompt generated for ml-pipeline",
    time: "1 day ago",
    color: "var(--accent-muted)",
  },
  {
    icon: Users,
    text: "Sarah joined acme/web-platform",
    time: "2 days ago",
    color: "var(--accent-yellow)",
  },
  {
    icon: Database,
    text: "acme/ml-pipeline was indexed",
    time: "3 days ago",
    color: "var(--accent-green)",
  },
];

export function ActivityFeed() {
  return (
    <div className="space-y-1">
      <h3 className="font-mono text-xs uppercase tracking-wider text-[var(--gray-500)] mb-3 m-0">
        Recent Activity
      </h3>
      <div className="relative">
        {/* Vertical line */}
        <div className="absolute left-[11px] top-2 bottom-2 w-px bg-[var(--alpha-white-8)]" />

        <div className="space-y-3">
          {activities.map((item, i) => (
            <div
              key={i}
              className="flex items-start gap-3 animate-fade-in-up"
              style={{ animationDelay: `${i * 80}ms`, animationFillMode: "backwards" }}
            >
              <div
                className="relative z-10 w-6 h-6 rounded-full flex items-center justify-center shrink-0"
                style={{ background: `${item.color}15` }}
              >
                <item.icon size={12} style={{ color: item.color }} />
              </div>
              <div className="min-w-0 pt-0.5">
                <p className="font-mono text-xs text-[var(--gray-300)] m-0 leading-relaxed">
                  {item.text}
                </p>
                <span className="font-mono text-[10px] text-[var(--gray-600)]">
                  {item.time}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
