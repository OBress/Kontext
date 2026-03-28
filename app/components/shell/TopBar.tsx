"use client";

import { useAppStore } from "@/lib/store/app-store";
import { RepoSelector } from "./RepoSelector";
import { PulseOrb } from "../shared/PulseOrb";
import { Key } from "lucide-react";

export function TopBar() {
  const { apiKey, setApiKeyModalOpen } = useAppStore();

  return (
    <header className="fixed top-0 left-0 right-0 h-12 z-50 flex items-center justify-between px-4 border-b border-[var(--alpha-white-5)] bg-[var(--surface-0)]/90 backdrop-blur-md">
      {/* Left: Logo */}
      <div className="flex items-center gap-2.5 min-w-[180px]">
        <span className="text-[var(--accent-cyan)] text-lg leading-none">◆</span>
        <span className="font-mono text-sm font-semibold tracking-tight text-gradient">
          Kontext
        </span>
      </div>

      {/* Center: Repo Selector */}
      <div className="flex-1 flex justify-center max-w-md mx-4">
        <RepoSelector />
      </div>

      {/* Right: API key + user */}
      <div className="flex items-center gap-3 min-w-[180px] justify-end">
        <button
          onClick={() => setApiKeyModalOpen(true)}
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-mono transition-colors bg-transparent border border-[var(--alpha-white-8)] cursor-pointer hover:bg-[var(--alpha-white-5)]"
          style={{
            color: apiKey ? "var(--accent-green)" : "var(--gray-400)",
          }}
        >
          {apiKey ? (
            <>
              <PulseOrb color="green" size="sm" />
              <span>AI Connected</span>
            </>
          ) : (
            <>
              <Key size={14} />
              <span>Set API Key</span>
            </>
          )}
        </button>
      </div>
    </header>
  );
}
