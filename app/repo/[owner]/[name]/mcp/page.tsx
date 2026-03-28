"use client";

import { useState, useEffect, useRef } from "react";
import { GlowCard } from "@/app/components/shared/GlowCard";
import { PulseOrb } from "@/app/components/shared/PulseOrb";
import { Server, Copy, RotateCcw, Search, ChevronDown, ChevronRight, ToggleLeft, ToggleRight, Pause, Play } from "lucide-react";

const mcpTools = [
  { name: "search_code", description: "Semantic search across indexed codebase", params: { query: "string", max_results: "number (default: 5)" }, enabled: true, usage: 142 },
  { name: "get_file", description: "Retrieve full file content", params: { path: "string" }, enabled: true, usage: 89 },
  { name: "list_files", description: "List files matching a glob pattern", params: { pattern: "string?" }, enabled: true, usage: 56 },
  { name: "ask_question", description: "Natural language question with RAG context", params: { question: "string" }, enabled: true, usage: 203 },
];

const mockLogs = [
  { time: "13:24:01", tool: "search_code", status: "success", message: 'query="auth middleware" → 5 results' },
  { time: "13:23:58", tool: "get_file", status: "success", message: "path=lib/auth.ts → 80 lines" },
  { time: "13:23:45", tool: "ask_question", status: "success", message: '"How does rate limiting work?"' },
  { time: "13:23:30", tool: "list_files", status: "success", message: 'pattern="components/**/*.tsx" → 14 files' },
  { time: "13:23:12", tool: "search_code", status: "error", message: "query too short (min 3 chars)" },
  { time: "13:22:55", tool: "get_file", status: "success", message: "path=package.json → 45 lines" },
  { time: "13:22:40", tool: "ask_question", status: "success", message: '"Explain the database schema"' },
];

const statusColors: Record<string, string> = { success: "var(--accent-green)", error: "var(--accent-red)" };

export default function McpPage() {
  const [uptime, setUptime] = useState(3847);
  const [expandedTool, setExpandedTool] = useState<string | null>(null);
  const [toolStates, setToolStates] = useState<Record<string, boolean>>(Object.fromEntries(mcpTools.map((t) => [t.name, t.enabled])));
  const [isPaused, setIsPaused] = useState(false);
  const [logFilter, setLogFilter] = useState("");

  useEffect(() => { const i = setInterval(() => setUptime((u) => u + 1), 1000); return () => clearInterval(i); }, []);

  const formatUptime = (s: number) => `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m ${s % 60}s`;
  const serverUrl = "http://localhost:3000/api/mcp/sse";
  const filteredLogs = logFilter ? mockLogs.filter((l) => l.tool.includes(logFilter)) : mockLogs;

  return (
    <div className="space-y-6">
      {/* Status bar */}
      <GlowCard glowColor="green" className="p-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <PulseOrb color="green" size="md" />
            <div>
              <h3 className="font-mono text-sm font-medium text-[var(--gray-100)] m-0">MCP Server Connected</h3>
              <p className="font-mono text-xs text-[var(--gray-500)] m-0">Uptime: {formatUptime(uptime)}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[var(--surface-1)] border border-[var(--alpha-white-5)]">
              <span className="font-mono text-xs text-[var(--gray-400)] truncate max-w-[260px]">{serverUrl}</span>
              <button onClick={() => navigator.clipboard.writeText(serverUrl)} className="text-[var(--gray-500)] hover:text-[var(--gray-300)] bg-transparent border-none cursor-pointer"><Copy size={12} /></button>
            </div>
            <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-mono bg-[var(--alpha-white-5)] text-[var(--gray-400)] hover:text-[var(--gray-200)] border-none cursor-pointer"><RotateCcw size={12} /> Restart</button>
          </div>
        </div>
      </GlowCard>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Tools */}
        <div className="space-y-3">
          <h3 className="font-mono text-xs uppercase tracking-wider text-[var(--gray-500)] m-0">Exposed Tools ({mcpTools.length})</h3>
          {mcpTools.map((tool) => (
            <GlowCard key={tool.name} glowColor="none" className="overflow-hidden">
              <button onClick={() => setExpandedTool(expandedTool === tool.name ? null : tool.name)} className="w-full flex items-center gap-3 px-4 py-3 bg-transparent border-none cursor-pointer text-left">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm text-[var(--gray-200)]">{tool.name}</span>
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-[var(--accent-cyan)]/10 text-[var(--accent-cyan)]">{tool.usage} calls</span>
                  </div>
                </div>
                <button onClick={(e) => { e.stopPropagation(); setToolStates((p) => ({ ...p, [tool.name]: !p[tool.name] })); }} className="p-0 bg-transparent border-none cursor-pointer">
                  {toolStates[tool.name] ? <ToggleRight size={20} className="text-[var(--accent-green)]" /> : <ToggleLeft size={20} className="text-[var(--gray-600)]" />}
                </button>
                {expandedTool === tool.name ? <ChevronDown size={14} className="text-[var(--gray-500)]" /> : <ChevronRight size={14} className="text-[var(--gray-500)]" />}
              </button>
              {expandedTool === tool.name && (
                <div className="px-4 pb-3 border-t border-[var(--alpha-white-5)] pt-3">
                  <p className="font-mono text-xs text-[var(--gray-400)] mb-3 m-0">{tool.description}</p>
                  <div className="rounded-lg bg-[var(--surface-1)] p-3">
                    <span className="font-mono text-[10px] uppercase text-[var(--gray-500)] block mb-2">Parameters</span>
                    {Object.entries(tool.params).map(([key, type]) => (
                      <div key={key} className="flex gap-2 font-mono text-xs mb-1">
                        <span className="text-[var(--accent-cyan)]">{key}</span>
                        <span className="text-[var(--gray-500)]">→ {String(type)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </GlowCard>
          ))}
        </div>

        {/* Logs */}
        <div className="flex flex-col rounded-xl border border-[var(--alpha-white-5)] bg-[var(--surface-0)] overflow-hidden min-h-[400px]">
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-[var(--alpha-white-5)]">
            <h3 className="font-mono text-xs uppercase tracking-wider text-[var(--gray-500)] m-0">Live Logs</h3>
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-[var(--gray-600)]" />
                <input value={logFilter} onChange={(e) => setLogFilter(e.target.value)} placeholder="Filter..." className="pl-7 pr-2 py-1 w-24 rounded text-[10px] font-mono bg-[var(--surface-1)] border border-[var(--alpha-white-5)] text-[var(--gray-300)] placeholder:text-[var(--gray-600)] focus:outline-none" />
              </div>
              <button onClick={() => setIsPaused(!isPaused)} className="p-1 bg-transparent border-none cursor-pointer text-[var(--gray-500)] hover:text-[var(--gray-300)]">
                {isPaused ? <Play size={12} /> : <Pause size={12} />}
              </button>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-2 font-mono text-[11px]">
            {filteredLogs.map((log, i) => (
              <div key={i} className="flex items-start gap-2 px-2 py-1.5 rounded hover:bg-[var(--alpha-white-5)]">
                <span className="w-1.5 h-1.5 rounded-full mt-1 shrink-0" style={{ backgroundColor: statusColors[log.status] || "var(--gray-500)" }} />
                <span className="text-[var(--gray-600)] shrink-0">{log.time}</span>
                <span className="text-[var(--accent-cyan)] shrink-0">{log.tool}</span>
                <span className="text-[var(--gray-400)] truncate">{log.message}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
