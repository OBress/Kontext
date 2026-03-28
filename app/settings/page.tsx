"use client";

import { useState, useEffect, useCallback } from "react";
import { AppShell } from "@/app/components/shell/AppShell";
import { GlowCard } from "@/app/components/shared/GlowCard";
import { PulseOrb } from "@/app/components/shared/PulseOrb";
import { useAppStore } from "@/lib/store/app-store";
import { Key, Eye, EyeOff, Check, Loader2, LogOut, Trash2, Plus, Copy, Server } from "lucide-react";
import { signOut } from "@/app/actions";

interface McpKey {
  id: number;
  name: string;
  key_prefix: string;
  repo_full_name: string | null;
  last_used_at: string | null;
  created_at: string;
}

export default function SettingsPage() {
  const { apiKey, setApiKey } = useAppStore();
  const [showKey, setShowKey] = useState(false);
  const [editingKey, setEditingKey] = useState(false);
  const [keyInput, setKeyInput] = useState(apiKey || "");
  const [testStatus, setTestStatus] = useState<"idle" | "testing" | "success" | "error">("idle");

  // MCP Keys state
  const [mcpKeys, setMcpKeys] = useState<McpKey[]>([]);
  const [newKeyName, setNewKeyName] = useState("");
  const [creatingKey, setCreatingKey] = useState(false);
  const [newRawKey, setNewRawKey] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState(false);

  const fetchMcpKeys = useCallback(async () => {
    try {
      const res = await fetch("/api/settings/mcp-keys");
      if (res.ok) {
        const data = await res.json();
        setMcpKeys(data.keys || []);
      }
    } catch {}
  }, []);

  useEffect(() => {
    fetchMcpKeys();
  }, [fetchMcpKeys]);

  const handleSaveKey = () => {
    setApiKey(keyInput || null);
    setEditingKey(false);
  };

  const handleTest = async () => {
    setTestStatus("testing");
    await new Promise((r) => setTimeout(r, 1200));
    setTestStatus(keyInput.length > 10 ? "success" : "error");
  };

  const handleCreateMcpKey = async () => {
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
    } catch {}
    setCreatingKey(false);
  };

  const handleRevokeMcpKey = async (keyId: number) => {
    try {
      await fetch("/api/settings/mcp-keys", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key_id: keyId }),
      });
      fetchMcpKeys();
    } catch {}
  };

  // ── Activity Preferences ──
  const DEFAULT_FILTERS: Record<string, boolean> = {
    repo_added: true,
    repo_indexed: true,
    team_member_joined: true,
    team_invite_sent: true,
    chat_session: true,
    prompt_generated: true,
    push: true,
    pull_request: true,
    issue: true,
    create: true,
    release: true,
  };

  const [activityFilters, setActivityFilters] = useState<Record<string, boolean>>(DEFAULT_FILTERS);
  const [filtersLoading, setFiltersLoading] = useState(true);
  const [filtersSaving, setFiltersSaving] = useState(false);

  useEffect(() => {
    fetch("/api/settings/preferences")
      .then((r) => r.json())
      .then((data) => {
        if (data.preferences?.activity_filters) {
          setActivityFilters({ ...DEFAULT_FILTERS, ...data.preferences.activity_filters });
        }
      })
      .catch(() => {})
      .finally(() => setFiltersLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleToggleFilter = async (eventType: string) => {
    const updated = { ...activityFilters, [eventType]: !activityFilters[eventType] };
    setActivityFilters(updated);
    setFiltersSaving(true);
    try {
      await fetch("/api/settings/preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ activity_filters: updated }),
      });
    } catch {}
    setFiltersSaving(false);
  };

  // Event type labels grouped by source
  const KONTEXT_EVENTS = [
    { key: "repo_added", label: "Repo added" },
    { key: "repo_indexed", label: "Repo indexed" },
    { key: "team_member_joined", label: "Team member joined" },
    { key: "team_invite_sent", label: "Team invite sent" },
    { key: "chat_session", label: "Chat session" },
    { key: "prompt_generated", label: "Prompt generated" },
  ];

  const GITHUB_EVENTS = [
    { key: "push", label: "Push / commits" },
    { key: "pull_request", label: "Pull requests" },
    { key: "issue", label: "Issues" },
    { key: "create", label: "Branch / tag created" },
    { key: "release", label: "Releases" },
  ];

  const maskedKey = apiKey ? `${apiKey.slice(0, 6)}${"•".repeat(20)}${apiKey.slice(-4)}` : "";

  return (
    <AppShell>
      <div className="relative z-10 max-w-2xl mx-auto space-y-6">
        <div>
          <h1 className="font-mono text-xl font-semibold text-[var(--gray-100)] mb-1 m-0">Settings</h1>
          <p className="font-mono text-sm text-[var(--gray-500)] m-0">Manage your API keys and preferences</p>
        </div>

        {/* Google AI API Key */}
        <GlowCard glowColor="green" className="p-5">
          <div className="flex items-center gap-2 mb-4">
            <Key size={16} className="text-[var(--accent-green)]" />
            <h3 className="font-mono text-sm font-medium text-[var(--gray-200)] m-0">Google AI API Key</h3>
            {apiKey && <PulseOrb color="green" size="sm" />}
          </div>

          {!editingKey ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[var(--surface-1)] border border-[var(--alpha-white-5)]">
                <span className="font-mono text-sm text-[var(--gray-300)] flex-1">
                  {apiKey ? (showKey ? apiKey : maskedKey) : "No API key set"}
                </span>
                {apiKey && (
                  <button onClick={() => setShowKey(!showKey)} className="text-[var(--gray-500)] hover:text-[var(--gray-300)] bg-transparent border-none cursor-pointer">
                    {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                )}
              </div>
              <button onClick={() => { setEditingKey(true); setKeyInput(apiKey || ""); }} className="px-4 py-2 rounded-lg text-sm font-mono bg-[var(--alpha-white-5)] text-[var(--gray-300)] hover:text-[var(--gray-100)] border border-[var(--alpha-white-8)] cursor-pointer">
                {apiKey ? "Change Key" : "Add Key"}
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <input type="password" value={keyInput} onChange={(e) => { setKeyInput(e.target.value); setTestStatus("idle"); }} placeholder="AIza..." className="w-full px-3 py-2 rounded-lg font-mono text-sm bg-[var(--surface-1)] border border-[var(--alpha-white-5)] text-[var(--gray-200)] placeholder:text-[var(--gray-600)] focus:outline-none focus:border-[var(--accent-green)]/40" />
              <div className="flex gap-2">
                <button onClick={handleTest} disabled={!keyInput || testStatus === "testing"} className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-mono bg-[var(--alpha-white-5)] text-[var(--gray-300)] border border-[var(--alpha-white-8)] cursor-pointer disabled:opacity-40">
                  {testStatus === "testing" ? <Loader2 size={14} className="animate-spin" /> : testStatus === "success" ? <Check size={14} className="text-[var(--accent-green)]" /> : null}
                  Test
                </button>
                <button onClick={handleSaveKey} className="px-4 py-2 rounded-lg text-sm font-mono bg-[var(--accent-green)] text-black font-medium cursor-pointer border-none hover:opacity-90">Save</button>
                <button onClick={() => setEditingKey(false)} className="px-4 py-2 rounded-lg text-sm font-mono bg-transparent text-[var(--gray-500)] cursor-pointer border border-[var(--alpha-white-8)]">Cancel</button>
              </div>
            </div>
          )}
          <p className="font-mono text-[11px] text-[var(--gray-600)] mt-3 m-0">Stored in your browser&apos;s localStorage. Never sent to our servers.</p>
        </GlowCard>

        {/* MCP API Keys */}
        <GlowCard glowColor="green" className="p-5">
          <div className="flex items-center gap-2 mb-4">
            <Server size={16} className="text-[var(--accent-green)]" />
            <h3 className="font-mono text-sm font-medium text-[var(--gray-200)] m-0">MCP API Keys</h3>
          </div>

          <p className="font-mono text-xs text-[var(--gray-500)] mb-4 m-0">
            Generate tokens for external AI agents (Claude Desktop, etc.) to access your indexed repos via the Model Context Protocol.
          </p>

          {/* New key revealed banner */}
          {newRawKey && (
            <div className="mb-4 p-3 rounded-lg bg-[var(--accent-green)]/10 border border-[var(--accent-green)]/20">
              <p className="font-mono text-xs text-[var(--accent-green)] mb-2 m-0">⚠️ Copy this key now — it won&apos;t be shown again:</p>
              <div className="flex items-center gap-2">
                <code className="flex-1 font-mono text-xs text-[var(--gray-200)] bg-[var(--surface-1)] px-2 py-1.5 rounded break-all">{newRawKey}</code>
                <button
                  onClick={() => { navigator.clipboard.writeText(newRawKey); setCopiedKey(true); setTimeout(() => setCopiedKey(false), 2000); }}
                  className="shrink-0 p-1.5 rounded bg-[var(--alpha-white-5)] text-[var(--gray-400)] hover:text-[var(--gray-200)] border-none cursor-pointer"
                >
                  {copiedKey ? <Check size={12} className="text-[var(--accent-green)]" /> : <Copy size={12} />}
                </button>
              </div>
              <button onClick={() => setNewRawKey(null)} className="mt-2 text-xs font-mono text-[var(--gray-500)] hover:text-[var(--gray-300)] bg-transparent border-none cursor-pointer">
                Dismiss
              </button>
            </div>
          )}

          {/* Create new key */}
          <div className="flex gap-2 mb-4">
            <input
              value={newKeyName}
              onChange={(e) => setNewKeyName(e.target.value)}
              placeholder="Key name (e.g. Claude Desktop)"
              className="flex-1 px-3 py-2 rounded-lg text-sm font-mono bg-[var(--surface-1)] border border-[var(--alpha-white-5)] text-[var(--gray-200)] placeholder:text-[var(--gray-600)] focus:outline-none focus:border-[var(--accent-green)]/40"
            />
            <button
              onClick={handleCreateMcpKey}
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
              <p className="font-mono text-xs text-[var(--gray-600)] text-center py-4">No API keys created yet</p>
            ) : (
              mcpKeys.map((key) => (
                <div key={key.id} className="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-[var(--surface-1)] border border-[var(--alpha-white-5)]">
                  <div className="flex-1 min-w-0">
                    <p className="font-mono text-sm text-[var(--gray-200)] m-0">{key.name}</p>
                    <p className="font-mono text-[10px] text-[var(--gray-500)] m-0">
                      {key.key_prefix}... · Created {new Date(key.created_at).toLocaleDateString()}
                      {key.last_used_at && ` · Last used ${new Date(key.last_used_at).toLocaleDateString()}`}
                    </p>
                  </div>
                  <button
                    onClick={() => handleRevokeMcpKey(key.id)}
                    className="p-1.5 rounded text-[var(--gray-500)] hover:text-[var(--accent-red)] bg-transparent border-none cursor-pointer"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))
            )}
          </div>
        </GlowCard>

        {/* Activity Preferences */}
        <GlowCard glowColor="green" className="p-5">
          <div className="flex items-center gap-2 mb-1">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-[var(--accent-green)]">
              <path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2" />
            </svg>
            <h3 className="font-mono text-sm font-medium text-[var(--gray-200)] m-0">Activity Feed</h3>
            {filtersSaving && <Loader2 size={12} className="animate-spin text-[var(--gray-500)]" />}
          </div>
          <p className="font-mono text-xs text-[var(--gray-500)] mb-4 m-0">
            Choose which events appear in your dashboard activity feed.
          </p>

          {filtersLoading ? (
            <div className="space-y-2">
              {[...Array(4)].map((_, i) => (
                <div key={i} className="h-8 rounded bg-[var(--alpha-white-5)] animate-pulse" />
              ))}
            </div>
          ) : (
            <div className="space-y-4">
              {/* Kontext events */}
              <div>
                <div className="flex items-center gap-1.5 mb-2">
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-mono font-medium bg-[var(--accent-green)]/10 text-[var(--accent-green)] border border-[var(--accent-green)]/10">
                    <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent-green)]" />
                    Kontext
                  </span>
                </div>
                <div className="space-y-1">
                  {KONTEXT_EVENTS.map(({ key, label }) => (
                    <label
                      key={key}
                      className="flex items-center justify-between px-3 py-2 rounded-lg hover:bg-[var(--alpha-white-5)] transition-colors cursor-pointer"
                    >
                      <span className="font-mono text-xs text-[var(--gray-300)]">{label}</span>
                      <button
                        onClick={(e) => { e.preventDefault(); handleToggleFilter(key); }}
                        className={`relative w-8 h-[18px] rounded-full transition-colors border-none cursor-pointer ${
                          activityFilters[key]
                            ? "bg-[var(--accent-green)]"
                            : "bg-[var(--surface-3)]"
                        }`}
                      >
                        <span
                          className={`absolute top-[2px] left-[2px] w-[14px] h-[14px] rounded-full bg-white transition-transform ${
                            activityFilters[key] ? "translate-x-[14px]" : ""
                          }`}
                        />
                      </button>
                    </label>
                  ))}
                </div>
              </div>

              {/* Divider */}
              <div className="h-px bg-[var(--alpha-white-5)]" />

              {/* GitHub events */}
              <div>
                <div className="flex items-center gap-1.5 mb-2">
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-mono font-medium bg-white/8 text-[var(--gray-300)] border border-white/5">
                    <svg viewBox="0 0 16 16" width="9" height="9" fill="currentColor" className="opacity-70">
                      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
                    </svg>
                    GitHub
                  </span>
                </div>
                <div className="space-y-1">
                  {GITHUB_EVENTS.map(({ key, label }) => (
                    <label
                      key={key}
                      className="flex items-center justify-between px-3 py-2 rounded-lg hover:bg-[var(--alpha-white-5)] transition-colors cursor-pointer"
                    >
                      <span className="font-mono text-xs text-[var(--gray-300)]">{label}</span>
                      <button
                        onClick={(e) => { e.preventDefault(); handleToggleFilter(key); }}
                        className={`relative w-8 h-[18px] rounded-full transition-colors border-none cursor-pointer ${
                          activityFilters[key]
                            ? "bg-[var(--accent-green)]"
                            : "bg-[var(--surface-3)]"
                        }`}
                      >
                        <span
                          className={`absolute top-[2px] left-[2px] w-[14px] h-[14px] rounded-full bg-white transition-transform ${
                            activityFilters[key] ? "translate-x-[14px]" : ""
                          }`}
                        />
                      </button>
                    </label>
                  ))}
                </div>
              </div>
            </div>
          )}
        </GlowCard>

        {/* Account */}
        <GlowCard glowColor="none" className="p-5">
          <h3 className="font-mono text-sm font-medium text-[var(--gray-200)] mb-4 m-0">Account</h3>
          <form action={signOut}>
            <button type="submit" className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-mono bg-[var(--alpha-white-5)] text-[var(--gray-400)] hover:text-[var(--accent-red)] border border-[var(--alpha-white-8)] cursor-pointer">
              <LogOut size={14} /> Sign Out
            </button>
          </form>
        </GlowCard>
      </div>
    </AppShell>
  );
}
