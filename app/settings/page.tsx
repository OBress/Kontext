"use client";

import { useState } from "react";
import { AppShell } from "@/app/components/shell/AppShell";
import { GlowCard } from "@/app/components/shared/GlowCard";
import { PulseOrb } from "@/app/components/shared/PulseOrb";
import { useAppStore } from "@/lib/store/app-store";
import { Key, Eye, EyeOff, Check, Loader2, Monitor, Type, Sparkles, LogOut, Trash2 } from "lucide-react";
import { signOut } from "@/app/actions";

export default function SettingsPage() {
  const { apiKey, setApiKey } = useAppStore();
  const [showKey, setShowKey] = useState(false);
  const [editingKey, setEditingKey] = useState(false);
  const [keyInput, setKeyInput] = useState(apiKey || "");
  const [testStatus, setTestStatus] = useState<"idle" | "testing" | "success" | "error">("idle");

  const handleSaveKey = () => {
    setApiKey(keyInput || null);
    setEditingKey(false);
  };

  const handleTest = async () => {
    setTestStatus("testing");
    await new Promise((r) => setTimeout(r, 1200));
    setTestStatus(keyInput.length > 10 ? "success" : "error");
  };

  const maskedKey = apiKey ? `${apiKey.slice(0, 6)}${"•".repeat(20)}${apiKey.slice(-4)}` : "";

  return (
    <AppShell>
      <div className="relative z-10 max-w-2xl mx-auto space-y-6">
        <div>
          <h1 className="font-mono text-xl font-semibold text-[var(--gray-100)] mb-1 m-0">Settings</h1>
          <p className="font-mono text-sm text-[var(--gray-500)] m-0">Manage your API keys and preferences</p>
        </div>

        {/* API Key */}
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
