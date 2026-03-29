"use client";

import { useState, useEffect, useCallback } from "react";
import { AppShell } from "@/app/components/shell/AppShell";
import { GlowCard } from "@/app/components/shared/GlowCard";
import { PulseOrb } from "@/app/components/shared/PulseOrb";
import {
  Copy,
  Check,
  ChevronDown,
  ChevronRight,
  Pause,
  Play,
  Search,
  Plus,
  Trash2,
  Loader2,
  ToggleLeft,
  ToggleRight,
  ExternalLink,
} from "lucide-react";

// ── Tool definitions ────────────────────────────────
const mcpTools = [
  {
    name: "search_code",
    description: "Semantic search across all indexed repositories using vector similarity. Returns matching code chunks ranked by relevance.",
    params: { query: "string", max_results: "number (default: 5)" },
  },
  {
    name: "get_file",
    description: "Retrieve the full content of a specific file from the indexed codebase, reconstructed from stored chunks.",
    params: { path: "string (relative file path)" },
  },
  {
    name: "list_files",
    description: "List all indexed files, optionally filtered by a glob pattern. Returns file paths, extensions, and line counts.",
    params: { pattern: "string? (glob, e.g. 'components/**/*.tsx')" },
  },
  {
    name: "ask_question",
    description: "Ask a natural language question about the codebase. Uses RAG to find relevant code context, then generates an answer via Gemini.",
    params: { question: "string" },
  },
  {
    name: "get_repo_health",
    description: "Retrieve Kontext's latest repo health summary, including open findings and the latest automated check run.",
    params: { repo_full_name: "string? (optional when key is repo-scoped)" },
  },
  {
    name: "list_findings",
    description: "List current automated findings from Kontext checks, filtered by status or check lane.",
    params: {
      repo_full_name: "string? (optional when key is repo-scoped)",
      status: "string? (open | resolved)",
      check_type: "string? (security | optimization | consistency | change_impact)",
      limit: "number? (default: 20)",
    },
  },
  {
    name: "get_finding",
    description: "Retrieve the full details of a single finding, including evidence, severity, and recommended fix direction.",
    params: { finding_id: "number" },
  },
  {
    name: "rerun_checks",
    description: "Ask Kontext to rerun its automated checks so an external agent can verify that a fix actually resolved the issue.",
    params: {
      repo_full_name: "string? (optional when key is repo-scoped)",
      check_types: "string[]? (subset of lanes to rerun)",
    },
  },
];

// ── Mock logs ────────────────────────────────────────
const mockLogs = [
  { time: "13:24:01", tool: "search_code", status: "success", message: 'query="auth middleware" → 5 results' },
  { time: "13:23:58", tool: "get_file", status: "success", message: "path=lib/auth.ts → 80 lines" },
  { time: "13:23:45", tool: "ask_question", status: "success", message: '"How does rate limiting work?"' },
  { time: "13:23:30", tool: "list_files", status: "success", message: 'pattern="components/**/*.tsx" → 14 files' },
  { time: "13:23:12", tool: "search_code", status: "error", message: "query too short (min 3 chars)" },
  { time: "13:22:55", tool: "get_file", status: "success", message: "path=package.json → 45 lines" },
  { time: "13:22:40", tool: "ask_question", status: "success", message: '"Explain the database schema"' },
];

const statusColors: Record<string, string> = {
  success: "var(--accent-green)",
  error: "var(--accent-red)",
};

// ── Integration config templates ─────────────────────
interface IntegrationConfig {
  name: string;
  description: string;
  docsUrl?: string;
  getConfig: (serverUrl: string, apiKey: string) => string;
}

const integrations: IntegrationConfig[] = [
  {
    name: "Claude Desktop",
    description: "Add to ~/Library/Application Support/Claude/claude_desktop_config.json (macOS) or %APPDATA%\\Claude\\claude_desktop_config.json (Windows)",
    docsUrl: "https://modelcontextprotocol.io/quickstart/user",
    getConfig: (url, key) =>
      JSON.stringify(
        {
          mcpServers: {
            kontext: {
              url: `${url}/api/mcp/sse`,
              headers: {
                Authorization: `Bearer ${key || "kt_your_key_here"}`,
                "x-google-api-key": "your_google_ai_key",
              },
            },
          },
        },
        null,
        2
      ),
  },
  {
    name: "Cursor",
    description: "Add to .cursor/mcp.json in your project root or global config",
    docsUrl: "https://docs.cursor.com/context/model-context-protocol",
    getConfig: (url, key) =>
      JSON.stringify(
        {
          mcpServers: {
            kontext: {
              url: `${url}/api/mcp/sse`,
              headers: {
                Authorization: `Bearer ${key || "kt_your_key_here"}`,
                "x-google-api-key": "your_google_ai_key",
              },
            },
          },
        },
        null,
        2
      ),
  },
  {
    name: "Antigravity",
    description: "Configure in your Antigravity MCP settings",
    getConfig: (url, key) =>
      JSON.stringify(
        {
          mcpServers: {
            kontext: {
              url: `${url}/api/mcp/sse`,
              headers: {
                Authorization: `Bearer ${key || "kt_your_key_here"}`,
                "x-google-api-key": "your_google_ai_key",
              },
            },
          },
        },
        null,
        2
      ),
  },
  {
    name: "OpenAI Codex",
    description: "Add to your Codex MCP server configuration",
    getConfig: (url, key) =>
      JSON.stringify(
        {
          mcpServers: {
            kontext: {
              url: `${url}/api/mcp/sse`,
              headers: {
                Authorization: `Bearer ${key || "kt_your_key_here"}`,
                "x-google-api-key": "your_google_ai_key",
              },
            },
          },
        },
        null,
        2
      ),
  },
];

// ── MCP Key type ─────────────────────────────────────
interface McpKey {
  id: number;
  name: string;
  key_prefix: string;
  last_used_at: string | null;
  created_at: string;
}

// ═════════════════════════════════════════════════════
export default function McpPage() {
  const [uptime, setUptime] = useState(0);
  const [expandedTool, setExpandedTool] = useState<string | null>(null);
  const [toolStates, setToolStates] = useState<Record<string, boolean>>(
    Object.fromEntries(mcpTools.map((t) => [t.name, true]))
  );
  const [isPaused, setIsPaused] = useState(false);
  const [logFilter, setLogFilter] = useState("");

  // Key management
  const [mcpKeys, setMcpKeys] = useState<McpKey[]>([]);
  const [newKeyName, setNewKeyName] = useState("");
  const [creatingKey, setCreatingKey] = useState(false);
  const [newRawKey, setNewRawKey] = useState<string | null>(null);
  const [copiedRawKey, setCopiedRawKey] = useState(false);

  // Integration snippets
  const [expandedIntegration, setExpandedIntegration] = useState<string | null>(null);
  const [copiedSnippet, setCopiedSnippet] = useState<string | null>(null);

  // Server URL — use site URL env or fallback
  const serverUrl = typeof window !== "undefined" ? window.location.origin : "http://localhost:3000";

  useEffect(() => {
    const i = setInterval(() => setUptime((u) => u + 1), 1000);
    return () => clearInterval(i);
  }, []);

  const fetchMcpKeys = useCallback(async () => {
    try {
      const res = await fetch("/api/settings/mcp-keys");
      if (res.ok) {
        const data = await res.json();
        setMcpKeys(data.keys || []);
      }
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    fetchMcpKeys();
  }, [fetchMcpKeys]);

  const handleCreateKey = async () => {
    if (!newKeyName.trim()) return;
    setCreatingKey(true);
    try {
      const res = await fetch("/api/settings/mcp-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newKeyName }),
      });
      if (res.ok) {
        const data = await res.json();
        setNewRawKey(data.key.raw_key);
        setNewKeyName("");
        fetchMcpKeys();
      }
    } catch { /* ignore */ }
    setCreatingKey(false);
  };

  const handleRevokeKey = async (keyId: number) => {
    try {
      await fetch("/api/settings/mcp-keys", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key_id: keyId }),
      });
      fetchMcpKeys();
    } catch { /* ignore */ }
  };

  const handleCopySnippet = (name: string, config: string) => {
    navigator.clipboard.writeText(config);
    setCopiedSnippet(name);
    setTimeout(() => setCopiedSnippet(null), 2000);
  };

  const formatUptime = (s: number) =>
    `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m ${s % 60}s`;

  const filteredLogs = logFilter
    ? mockLogs.filter((l) => l.tool.includes(logFilter))
    : mockLogs;

  // The first created key prefix for integration snippets
  const activeKeyPrefix = mcpKeys.length > 0 ? mcpKeys[0].key_prefix : null;

  return (
    <AppShell>
      <div className="relative z-10 max-w-5xl mx-auto space-y-6">
        {/* Page title */}
        <div>
          <h1 className="font-mono text-xl font-semibold text-[var(--gray-100)] mb-1 m-0">
            MCP Server
          </h1>
          <p className="font-mono text-sm text-[var(--gray-500)] m-0">
            Connect external AI agents to your indexed repositories via the Model Context Protocol
          </p>
        </div>

        {/* ── Status Banner ─────────────────────────── */}
        <GlowCard glowColor="green" className="p-4">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <PulseOrb color="green" size="md" />
              <div>
                <h3 className="font-mono text-sm font-medium text-[var(--gray-100)] m-0">
                  MCP Server Active
                </h3>
                <p className="font-mono text-xs text-[var(--gray-500)] m-0">
                  Uptime: {formatUptime(uptime)} · 4 tools exposed
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[var(--surface-1)] border border-[var(--alpha-white-5)]">
              <span className="font-mono text-xs text-[var(--gray-400)] truncate max-w-[300px]">
                {serverUrl}/api/mcp/sse
              </span>
              <button
                onClick={() => navigator.clipboard.writeText(`${serverUrl}/api/mcp/sse`)}
                className="text-[var(--gray-500)] hover:text-[var(--gray-300)] bg-transparent border-none cursor-pointer"
              >
                <Copy size={12} />
              </button>
            </div>
          </div>
        </GlowCard>

        {/* ── Tools + Logs Grid ────────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Tools Panel */}
          <div className="space-y-3">
            <h3 className="font-mono text-xs uppercase tracking-wider text-[var(--gray-500)] m-0">
              Exposed Tools ({mcpTools.length})
            </h3>
            {mcpTools.map((tool) => (
              <GlowCard key={tool.name} glowColor="none" className="overflow-hidden">
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => setExpandedTool(expandedTool === tool.name ? null : tool.name)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setExpandedTool(expandedTool === tool.name ? null : tool.name);
                    }
                  }}
                  className="w-full flex items-center gap-3 px-4 py-3 bg-transparent border-none cursor-pointer text-left"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm text-[var(--gray-200)]">{tool.name}</span>
                    </div>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setToolStates((p) => ({ ...p, [tool.name]: !p[tool.name] }));
                    }}
                    className="p-0 bg-transparent border-none cursor-pointer"
                  >
                    {toolStates[tool.name] ? (
                      <ToggleRight size={20} className="text-[var(--accent-green)]" />
                    ) : (
                      <ToggleLeft size={20} className="text-[var(--gray-600)]" />
                    )}
                  </button>
                  {expandedTool === tool.name ? (
                    <ChevronDown size={14} className="text-[var(--gray-500)]" />
                  ) : (
                    <ChevronRight size={14} className="text-[var(--gray-500)]" />
                  )}
                </div>
                {expandedTool === tool.name && (
                  <div className="px-4 pb-3 border-t border-[var(--alpha-white-5)] pt-3">
                    <p className="font-mono text-xs text-[var(--gray-400)] mb-3 m-0">
                      {tool.description}
                    </p>
                    <div className="rounded-lg bg-[var(--surface-1)] p-3">
                      <span className="font-mono text-xs uppercase text-[var(--gray-500)] block mb-2">
                        Parameters
                      </span>
                      {Object.entries(tool.params).map(([key, type]) => (
                        <div key={key} className="flex gap-2 font-mono text-xs mb-1">
                          <span className="text-[var(--accent-green)]">{key}</span>
                          <span className="text-[var(--gray-500)]">→ {String(type)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </GlowCard>
            ))}
          </div>

          {/* Logs Panel */}
          <div className="flex flex-col rounded-xl border border-[var(--alpha-white-5)] bg-[var(--surface-0)] overflow-hidden min-h-[400px]">
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-[var(--alpha-white-5)]">
              <h3 className="font-mono text-xs uppercase tracking-wider text-[var(--gray-500)] m-0">
                Live Logs
              </h3>
              <div className="flex items-center gap-2">
                <div className="relative">
                  <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-[var(--gray-600)]" />
                  <input
                    value={logFilter}
                    onChange={(e) => setLogFilter(e.target.value)}
                    placeholder="Filter..."
                    className="pl-7 pr-2 py-1 w-24 rounded text-xs font-mono bg-[var(--surface-1)] border border-[var(--alpha-white-5)] text-[var(--gray-300)] placeholder:text-[var(--gray-600)] focus:outline-none"
                  />
                </div>
                <button
                  onClick={() => setIsPaused(!isPaused)}
                  className="p-1 bg-transparent border-none cursor-pointer text-[var(--gray-500)] hover:text-[var(--gray-300)]"
                >
                  {isPaused ? <Play size={12} /> : <Pause size={12} />}
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-2 font-mono text-xs">
              {filteredLogs.map((log, i) => (
                <div
                  key={i}
                  className="flex items-start gap-2 px-2 py-1.5 rounded hover:bg-[var(--alpha-white-5)]"
                >
                  <span
                    className="w-1.5 h-1.5 rounded-full mt-1 shrink-0"
                    style={{ backgroundColor: statusColors[log.status] || "var(--gray-500)" }}
                  />
                  <span className="text-[var(--gray-600)] shrink-0">{log.time}</span>
                  <span className="text-[var(--accent-green)] shrink-0">{log.tool}</span>
                  <span className="text-[var(--gray-400)] truncate">{log.message}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ── API Key Management ───────────────────── */}
        <GlowCard glowColor="green" className="p-5">
          <div className="flex items-center gap-2 mb-1">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-[var(--accent-green)]">
              <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.78 7.78 5.5 5.5 0 0 1 7.78-7.78zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" />
            </svg>
            <h3 className="font-mono text-sm font-medium text-[var(--gray-200)] m-0">
              API Keys
            </h3>
          </div>
          <p className="font-mono text-xs text-[var(--gray-500)] mb-4 m-0">
            Generate a key for external AI agents to access all your indexed repos. Keys grant access to every repo in your account.
          </p>

          {/* New key revealed banner */}
          {newRawKey && (
            <div className="mb-4 p-3 rounded-lg bg-[var(--accent-green)]/10 border border-[var(--accent-green)]/20">
              <p className="font-mono text-xs text-[var(--accent-green)] mb-2 m-0">
                ⚠️ Copy this key now — it won&apos;t be shown again:
              </p>
              <div className="flex items-center gap-2">
                <code className="flex-1 font-mono text-xs text-[var(--gray-200)] bg-[var(--surface-1)] px-2 py-1.5 rounded break-all">
                  {newRawKey}
                </code>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(newRawKey);
                    setCopiedRawKey(true);
                    setTimeout(() => setCopiedRawKey(false), 2000);
                  }}
                  className="shrink-0 p-1.5 rounded bg-[var(--alpha-white-5)] text-[var(--gray-400)] hover:text-[var(--gray-200)] border-none cursor-pointer"
                >
                  {copiedRawKey ? <Check size={12} className="text-[var(--accent-green)]" /> : <Copy size={12} />}
                </button>
              </div>
              <button
                onClick={() => setNewRawKey(null)}
                className="mt-2 text-xs font-mono text-[var(--gray-500)] hover:text-[var(--gray-300)] bg-transparent border-none cursor-pointer"
              >
                Dismiss
              </button>
            </div>
          )}

          {/* Create key */}
          <div className="flex gap-2 mb-4">
            <input
              value={newKeyName}
              onChange={(e) => setNewKeyName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleCreateKey(); }}
              placeholder="Key name (e.g. Claude Desktop)"
              className="flex-1 px-3 py-2 rounded-lg text-sm font-mono bg-[var(--surface-1)] border border-[var(--alpha-white-5)] text-[var(--gray-200)] placeholder:text-[var(--gray-600)] focus:outline-none focus:border-[var(--accent-green)]/40"
            />
            <button
              onClick={handleCreateKey}
              disabled={!newKeyName.trim() || creatingKey}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-mono bg-[var(--accent-green)] text-black border-none cursor-pointer hover:opacity-90 disabled:opacity-40"
            >
              {creatingKey ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
              Create
            </button>
          </div>

          {/* Key list */}
          <div className="space-y-2">
            {mcpKeys.length === 0 ? (
              <p className="font-mono text-xs text-[var(--gray-600)] text-center py-4">
                No API keys created yet
              </p>
            ) : (
              mcpKeys.map((key) => (
                <div
                  key={key.id}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-[var(--surface-1)] border border-[var(--alpha-white-5)]"
                >
                  <div className="flex-1 min-w-0">
                    <p className="font-mono text-sm text-[var(--gray-200)] m-0">{key.name}</p>
                    <p className="font-mono text-xs text-[var(--gray-500)] m-0">
                      {key.key_prefix}... · All repos ·{" "}
                      Created {new Date(key.created_at).toLocaleDateString()}
                      {key.last_used_at && ` · Last used ${new Date(key.last_used_at).toLocaleDateString()}`}
                    </p>
                  </div>
                  <button
                    onClick={() => handleRevokeKey(key.id)}
                    className="p-1.5 rounded text-[var(--gray-500)] hover:text-[var(--accent-red)] bg-transparent border-none cursor-pointer"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))
            )}
          </div>
        </GlowCard>

        {/* ── Integration Snippets ─────────────────── */}
        <GlowCard glowColor="green" className="p-5">
          <div className="flex items-center gap-2 mb-1">
            <ExternalLink size={16} className="text-[var(--accent-green)]" />
            <h3 className="font-mono text-sm font-medium text-[var(--gray-200)] m-0">
              Connect Your AI Agent
            </h3>
          </div>
          <p className="font-mono text-xs text-[var(--gray-500)] mb-4 m-0">
            Paste the config snippet into your AI client&apos;s MCP configuration file.
            {!activeKeyPrefix && (
              <span className="text-[var(--accent-amber)]"> Create an API key above first.</span>
            )}
          </p>

          <div className="space-y-2">
            {integrations.map((integration) => {
              const isExpanded = expandedIntegration === integration.name;
              const config = integration.getConfig(
                serverUrl,
                newRawKey || (activeKeyPrefix ? `${activeKeyPrefix}...` : "")
              );

              return (
                <div
                  key={integration.name}
                  className="rounded-lg border border-[var(--alpha-white-5)] bg-[var(--surface-0)] overflow-hidden"
                >
                  <button
                    onClick={() => setExpandedIntegration(isExpanded ? null : integration.name)}
                    className="w-full flex items-center gap-3 px-4 py-3 bg-transparent border-none cursor-pointer text-left"
                  >
                    <span className="font-mono text-sm text-[var(--gray-200)] flex-1">
                      {integration.name}
                    </span>
                    {isExpanded ? (
                      <ChevronDown size={14} className="text-[var(--gray-500)]" />
                    ) : (
                      <ChevronRight size={14} className="text-[var(--gray-500)]" />
                    )}
                  </button>

                  {isExpanded && (
                    <div className="px-4 pb-4 border-t border-[var(--alpha-white-5)] pt-3 space-y-3">
                      <p className="font-mono text-xs text-[var(--gray-500)] m-0">
                        {integration.description}
                      </p>

                      <div className="relative">
                        <pre className="rounded-lg bg-[var(--surface-1)] p-3 font-mono text-xs text-[var(--gray-300)] overflow-x-auto m-0 whitespace-pre">
                          {config}
                        </pre>
                        <button
                          onClick={() => handleCopySnippet(integration.name, config)}
                          className="absolute top-2 right-2 p-1.5 rounded bg-[var(--alpha-white-8)] text-[var(--gray-400)] hover:text-[var(--gray-200)] border-none cursor-pointer"
                        >
                          {copiedSnippet === integration.name ? (
                            <Check size={12} className="text-[var(--accent-green)]" />
                          ) : (
                            <Copy size={12} />
                          )}
                        </button>
                      </div>

                      {integration.docsUrl && (
                        <a
                          href={integration.docsUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 font-mono text-xs text-[var(--accent-green)] hover:underline"
                        >
                          View setup docs <ExternalLink size={10} />
                        </a>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </GlowCard>
      </div>
    </AppShell>
  );
}
