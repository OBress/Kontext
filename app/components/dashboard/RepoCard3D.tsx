"use client";

import { Repo, useAppStore } from "@/lib/store/app-store";
import { Tilt3D } from "../shared/Tilt3D";
import { useRouter } from "next/navigation";
import {
  Star,
  GitFork,
  Clock,
  Loader2,
  Database,
  Zap,
  GripVertical,
  Pin,
} from "lucide-react";
import { motion } from "framer-motion";
import React from "react";

const langColors: Record<string, string> = {
  TypeScript: "#3178C6",
  JavaScript: "#F7DF1E",
  Python: "#3572A5",
  Rust: "#DEA584",
  Go: "#00ADD8",
  Java: "#B07219",
  Ruby: "#701516",
  CSS: "#563D7C",
  HTML: "#E34C26",
};

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const days = Math.floor(diff / 86400000);
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

interface RepoCard3DProps {
  repo: Repo;
  index: number;
  isPinned?: boolean;
  onUnpin?: () => void;
  dragHandleProps?: Record<string, unknown>;
  isDragOverlay?: boolean;
}

export function RepoCard3D({
  repo,
  index,
  isPinned,
  onUnpin,
  dragHandleProps,
  isDragOverlay,
}: RepoCard3DProps) {
  const router = useRouter();
  const langColor = langColors[repo.language || ""] || "#737373";
  const ingestionStatus = useAppStore((s) => s.ingestionStatus[repo.full_name]);

  const isIngesting =
    ingestionStatus &&
    ingestionStatus.status !== "done" &&
    ingestionStatus.status !== "error" &&
    ingestionStatus.status !== "idle";

  const handleCardClick = (e: React.MouseEvent) => {
    // Don't navigate if the user clicked on the drag handle or pin icon
    const target = e.target as HTMLElement;
    if (target.closest("[data-drag-handle]") || target.closest("[data-pin-btn]")) {
      return;
    }
    router.push(`/repo/${repo.owner}/${repo.name}`);
  };

  const cardContent = (
    <div
      onClick={isDragOverlay ? undefined : handleCardClick}
      className={`relative group rounded-xl overflow-hidden transition-all duration-300 border border-[var(--alpha-white-5)] hover:border-[rgba(63,185,80,0.15)] ${
        isDragOverlay ? "" : "cursor-pointer"
      }`}
      style={{
        background: "rgba(17, 17, 24, 0.6)",
        backdropFilter: "blur(12px)",
        animationDelay: `${index * 60}ms`,
      }}
    >
      {/* Ambient language color orb in background */}
      <div
        className="absolute -top-10 -right-10 w-32 h-32 rounded-full blur-[60px] opacity-[0.07] group-hover:opacity-[0.12] transition-opacity duration-500"
        style={{ backgroundColor: langColor }}
      />

      <div className="relative p-5">
        {/* Header */}
        <div className="flex items-start justify-between mb-3">
          <div className="min-w-0 flex-1">
            <h3 className="font-mono text-sm font-semibold text-[var(--gray-100)] truncate m-0">
              {repo.name}
            </h3>
            <span className="font-mono text-xs text-[var(--gray-500)]">
              {repo.owner}
            </span>
          </div>

          {/* Right side: pin badge + drag handle */}
          <div className="flex items-center gap-1 shrink-0 ml-2">
            {/* Pin indicator / unpin button */}
            {isPinned && (
              <button
                data-pin-btn
                onClick={(e) => {
                  e.stopPropagation();
                  onUnpin?.();
                }}
                className="flex items-center justify-center w-6 h-6 rounded-md text-[var(--accent-green)] hover:bg-[var(--accent-green)]/10 transition-colors cursor-pointer border-none bg-transparent p-0"
                title="Unpin repository"
              >
                <Pin size={12} />
              </button>
            )}

            {/* Status badge */}
            {repo.indexed && !isIngesting && (
              <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-mono bg-[var(--accent-green)]/10 text-[var(--accent-green)] border border-[var(--accent-green)]/20">
                <Database size={10} />
                Indexed
              </span>
            )}
            {isIngesting && (
              <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-mono bg-[var(--accent-green)]/10 text-[var(--accent-green)] border border-[var(--accent-green)]/20">
                <Loader2 size={10} className="animate-spin" />
                {ingestionStatus.progress}%
              </span>
            )}
            {!repo.indexed && !isIngesting && (
              <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-mono bg-[var(--alpha-white-5)] text-[var(--gray-400)] border border-[var(--alpha-white-8)]">
                <Zap size={10} />
                Pending
              </span>
            )}

            {/* 6-dot drag handle */}
            {dragHandleProps && (
              <div
                data-drag-handle
                className="drag-handle flex items-center justify-center w-6 h-6 rounded-md text-[var(--gray-600)] opacity-0 group-hover:opacity-100 hover:text-[var(--gray-400)] hover:bg-[var(--alpha-white-5)] transition-all"
                {...dragHandleProps}
              >
                <GripVertical size={14} />
              </div>
            )}
          </div>
        </div>

        {/* Description */}
        <p className="font-mono text-xs text-[var(--gray-400)] line-clamp-2 mb-4 leading-relaxed m-0">
          {repo.description || "No description"}
        </p>

        {/* Ingestion progress bar */}
        {isIngesting && (
          <div className="mb-4">
            <div className="w-full h-1.5 rounded-full bg-[var(--alpha-white-8)] overflow-hidden">
              <motion.div
                className="h-full rounded-full"
                style={{
                  background:
                    "linear-gradient(90deg, #238636, #3FB950)",
                }}
                initial={{ width: "0%" }}
                animate={{ width: `${ingestionStatus.progress}%` }}
                transition={{ duration: 0.3, ease: "easeOut" }}
              />
            </div>
            <p className="font-mono text-xs text-[var(--gray-500)] mt-1.5 m-0">
              {ingestionStatus.message}
            </p>
          </div>
        )}

        {/* Footer stats */}
        <div className="flex items-center gap-4 text-xs font-mono text-[var(--gray-500)]">
          {repo.language && (
            <span className="flex items-center gap-1.5">
              <span
                className="w-2.5 h-2.5 rounded-full"
                style={{ backgroundColor: langColor }}
              />
              {repo.language}
            </span>
          )}
          <span className="flex items-center gap-1">
            <Star size={11} />
            {repo.stargazers_count}
          </span>
          <span className="flex items-center gap-1">
            <GitFork size={11} />
            {repo.forks_count}
          </span>
          <span className="flex items-center gap-1 ml-auto">
            <Clock size={11} />
            {timeAgo(repo.updated_at)}
          </span>
        </div>

        {/* Indexed chunk count */}
        {repo.indexed && repo.chunk_count > 0 && !isIngesting && (
          <div className="mt-3 pt-3 border-t border-[var(--alpha-white-5)]">
            <span className="text-xs font-mono text-[var(--gray-500)]">
              {repo.chunk_count.toLocaleString()} chunks embedded
            </span>
          </div>
        )}
      </div>

      {/* Hover glow effect */}
      <div
        className="absolute inset-0 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none"
        style={{
          boxShadow:
            "inset 0 0 30px rgba(63,185,80,0.03), 0 0 20px rgba(63,185,80,0.05)",
        }}
      />
    </div>
  );

  // Disable tilt for drag overlay to avoid jank
  if (isDragOverlay) {
    return cardContent;
  }

  return (
    <Tilt3D maxTilt={6} scale={1.01}>
      {cardContent}
    </Tilt3D>
  );
}
