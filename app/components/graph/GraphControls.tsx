"use client";

import { useGraphStore, GraphLayout } from "@/lib/store/graph-store";
import { Search, Maximize2, Minimize2, Camera, SlidersHorizontal } from "lucide-react";
import { useState } from "react";

const fileTypeColors: Record<string, { color: string; label: string }> = {
  ts: { color: "#00E5FF", label: "TypeScript" },
  js: { color: "#FFD600", label: "JavaScript" },
  css: { color: "#FF4081", label: "CSS" },
  json: { color: "#00E676", label: "JSON/YAML" },
  md: { color: "#9E9E9E", label: "Markdown" },
  config: { color: "#FFB300", label: "Config" },
  other: { color: "#FFFFFF", label: "Other" },
};

const layouts: { value: GraphLayout; label: string }[] = [
  { value: "force", label: "Force" },
  { value: "radial", label: "Radial" },
  { value: "tree", label: "Tree" },
  { value: "dag", label: "DAG" },
];

export function GraphControls() {
  const { filters, setFilters, isFullscreen, setIsFullscreen, layout, setLayout } =
    useGraphStore();
  const [isCollapsed, setIsCollapsed] = useState(false);

  return (
    <div className="absolute top-4 right-4 z-20">
      <div className="glass-strong rounded-xl overflow-hidden" style={{ width: isCollapsed ? 44 : 240 }}>
        {/* Header */}
        <button
          onClick={() => setIsCollapsed(!isCollapsed)}
          className="w-full flex items-center gap-2 px-3 py-2.5 text-[var(--gray-300)] hover:bg-[var(--alpha-white-5)] transition-colors bg-transparent border-none cursor-pointer"
        >
          <SlidersHorizontal size={15} />
          {!isCollapsed && (
            <span className="font-mono text-xs font-medium">Controls</span>
          )}
        </button>

        {!isCollapsed && (
          <div className="px-3 pb-3 space-y-4">
            {/* Search */}
            <div className="relative">
              <Search
                size={13}
                className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--gray-600)]"
              />
              <input
                value={filters.searchQuery}
                onChange={(e) => setFilters({ searchQuery: e.target.value })}
                placeholder="Find file..."
                className="w-full pl-8 pr-3 py-1.5 rounded-md text-xs font-mono bg-[var(--surface-1)] border border-[var(--alpha-white-5)] text-[var(--gray-200)] placeholder:text-[var(--gray-600)] focus:outline-none focus:border-[var(--accent-cyan)]/40 transition-colors"
              />
            </div>

            {/* File type filters */}
            <div>
              <span className="font-mono text-[10px] uppercase tracking-wider text-[var(--gray-500)] mb-2 block">
                File Types
              </span>
              <div className="space-y-1.5">
                {Object.entries(fileTypeColors).map(([key, { color, label }]) => (
                  <label
                    key={key}
                    className="flex items-center gap-2 cursor-pointer group"
                  >
                    <input
                      type="checkbox"
                      checked={filters.fileTypes[key] ?? true}
                      onChange={(e) =>
                        setFilters({
                          fileTypes: {
                            ...filters.fileTypes,
                            [key]: e.target.checked,
                          },
                        })
                      }
                      className="sr-only"
                    />
                    <span
                      className="w-3 h-3 rounded-sm border transition-colors flex items-center justify-center"
                      style={{
                        borderColor: filters.fileTypes[key] ? color : "var(--alpha-white-20)",
                        backgroundColor: filters.fileTypes[key]
                          ? color + "20"
                          : "transparent",
                      }}
                    >
                      {(filters.fileTypes[key] ?? true) && (
                        <span
                          className="w-1.5 h-1.5 rounded-[1px]"
                          style={{ backgroundColor: color }}
                        />
                      )}
                    </span>
                    <span className="font-mono text-[11px] text-[var(--gray-400)] group-hover:text-[var(--gray-200)] transition-colors">
                      {label}
                    </span>
                  </label>
                ))}
              </div>
            </div>

            {/* Min connections */}
            <div>
              <span className="font-mono text-[10px] uppercase tracking-wider text-[var(--gray-500)] mb-2 block">
                Min connections: {filters.minConnections}
              </span>
              <input
                type="range"
                min={0}
                max={5}
                value={filters.minConnections}
                onChange={(e) =>
                  setFilters({ minConnections: parseInt(e.target.value) })
                }
                className="w-full h-1 rounded-full appearance-none cursor-pointer"
                style={{
                  background: `linear-gradient(to right, var(--accent-cyan) ${
                    (filters.minConnections / 5) * 100
                  }%, var(--alpha-white-10) ${
                    (filters.minConnections / 5) * 100
                  }%)`,
                }}
              />
            </div>

            {/* Layout selector */}
            <div>
              <span className="font-mono text-[10px] uppercase tracking-wider text-[var(--gray-500)] mb-2 block">
                Layout
              </span>
              <div className="flex gap-1">
                {layouts.map((l) => (
                  <button
                    key={l.value}
                    onClick={() => setLayout(l.value)}
                    className={`flex-1 py-1 rounded text-[10px] font-mono transition-colors border-none cursor-pointer ${
                      layout === l.value
                        ? "bg-[var(--accent-cyan)]/15 text-[var(--accent-cyan)]"
                        : "bg-[var(--alpha-white-5)] text-[var(--gray-500)] hover:text-[var(--gray-300)]"
                    }`}
                  >
                    {l.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Action buttons */}
            <div className="flex gap-2 pt-1">
              <button
                onClick={() => setIsFullscreen(!isFullscreen)}
                className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md text-[11px] font-mono bg-[var(--alpha-white-5)] text-[var(--gray-400)] hover:text-[var(--gray-200)] transition-colors border-none cursor-pointer"
              >
                {isFullscreen ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
                {isFullscreen ? "Exit" : "Fullscreen"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
