"use client";

import { ConstellationNode } from "./RepoConstellation";
import { getLanguageColor } from "@/lib/data/featured-repos";

interface RepoTooltipProps {
  node: ConstellationNode | null;
  position: { x: number; y: number } | null;
  visible: boolean;
}

function formatStars(stars: number): string {
  if (stars >= 1000) {
    return `${(stars / 1000).toFixed(stars >= 10000 ? 0 : 1)}k`;
  }
  return String(stars);
}

export function RepoTooltip({ node, position, visible }: RepoTooltipProps) {
  if (!node || !position || !visible) return null;

  const langColor = getLanguageColor(node.language);

  const badge = node.isUserRepo
    ? node.indexed
      ? { label: "Indexed", color: "var(--accent-green)" }
      : { label: "Your Repo", color: "var(--accent-muted)" }
    : { label: "Public", color: "var(--accent-green)" };

  return (
    <div
      className="fixed z-50 pointer-events-none animate-fade-in-up"
      style={{
        left: position.x,
        top: position.y,
        transform: "translate(-50%, -120%)",
      }}
    >
      <div
        className="glass-strong rounded-xl px-5 py-4 min-w-[280px] max-w-[380px]"
        style={{
          borderLeft: `3px solid ${langColor}`,
          boxShadow: `0 0 20px ${langColor}20, 0 8px 32px rgba(0,0,0,0.5)`,
        }}
      >
        {/* Header */}
        <div className="flex items-center gap-2 mb-1">
          <span
            className="w-2 h-2 rounded-full flex-shrink-0"
            style={{ background: langColor, boxShadow: `0 0 6px ${langColor}` }}
          />
          <span className="font-mono text-sm font-semibold text-[var(--gray-100)] truncate">
            {node.owner}/{node.name}
          </span>
        </div>

        {/* Description */}
        {node.description && (
          <p className="font-mono text-xs text-[var(--gray-400)] m-0 mb-2 leading-relaxed"
            style={{
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            {node.description}
          </p>
        )}

        {/* Footer: stars + language + badge */}
        <div className="flex items-center gap-3 font-mono text-xs">
          <span className="text-[var(--accent-yellow)] flex items-center gap-1">
            ★ {formatStars(node.stars)}
          </span>
          {node.language && (
            <span className="flex items-center gap-1">
              <span
                className="w-1.5 h-1.5 rounded-full inline-block"
                style={{ background: langColor }}
              />
              <span className="text-[var(--gray-400)]">{node.language}</span>
            </span>
          )}
          <span
            className="ml-auto px-2 py-0.5 rounded text-[10px] font-medium"
            style={{
              background: `${badge.color}15`,
              color: badge.color,
              border: `1px solid ${badge.color}30`,
            }}
          >
            {badge.label}
          </span>
        </div>
      </div>
    </div>
  );
}
