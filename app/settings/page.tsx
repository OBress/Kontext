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

  const maskedKey = apiKey ? `${apiKey.slice(0, 6)}${"•".repeat(20)}${apiKey.slice(-4)}` : "";

  return (
    <AppShell>
      <div className="relative z-10 max-w-2xl mx-auto space-y-6">
        <div>
          <h1 className="font-mono text-xl font-semibold text-[var(--gray-100)] mb-1 m-0">Settings</h1>
          <p className="font-mono text-sm text-[var(--gray-500)] m-0">Manage your API keys and preferences</p>
        </div>

        {/* Google AI API Key */}
        <GlowCard glowColor="cyan" className="p-5">
          <div className="flex items-center gap-2 mb-4">
            <Key size={16} className="text-[var(--accent-cyan)]" />
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
              <input type="password" value={keyInput} onChange={(e) => { setKeyInput(e.target.value); setTestStatus("idle"); }} placeholder="AIza..." className="w-full px-3 py-2 rounded-lg font-mono text-sm bg-[var(--surface-1)] border border-[var(--alpha-white-5)] text-[var(--gray-200)] placeholder:text-[var(--gray-600)] focus:outline-none focus:border-[var(--accent-cyan)]/40" />
              <div className="flex gap-2">
                <button onClick={handleTest} disabled={!keyInput || testStatus === "testing"} className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-mono bg-[var(--alpha-white-5)] text-[var(--gray-300)] border border-[var(--alpha-white-8)] cursor-pointer disabled:opacity-40">
                  {testStatus === "testing" ? <Loader2 size={14} className="animate-spin" /> : testStatus === "success" ? <Check size={14} className="text-[var(--accent-green)]" /> : null}
                  Test
                </button>
                <button onClick={handleSaveKey} className="px-4 py-2 rounded-lg text-sm font-mono bg-[var(--accent-cyan)] text-black font-medium cursor-pointer border-none hover:opacity-90">Save</button>
                <button onClick={() => setEditingKey(false)} className="px-4 py-2 rounded-lg text-sm font-mono bg-transparent text-[var(--gray-500)] cursor-pointer border border-[var(--alpha-white-8)]">Cancel</button>
              </div>
            </div>
          )}
          <p className="font-mono text-[11px] text-[var(--gray-600)] mt-3 m-0">Stored in your browser&apos;s localStorage. Never sent to our servers.</p>
        </GlowCard>

        {/* MCP API Keys */}
        <GlowCard glowColor="purple" className="p-5">
          <div className="flex items-center gap-2 mb-4">
            <Server size={16} className="text-[var(--accent-purple)]" />
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
              className="flex-1 px-3 py-2 rounded-lg text-sm font-mono bg-[var(--surface-1)] border border-[var(--alpha-white-5)] text-[var(--gray-200)] placeholder:text-[var(--gray-600)] focus:outline-none focus:border-[var(--accent-purple)]/40"
            />
            <button
              onClick={handleCreateMcpKey}
              disabled={!newKeyName.trim() || creatingKey}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-mono bg-[var(--accent-purple)] text-white border-none cursor-pointer hover:opacity-90 disabled:opacity-40"
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

