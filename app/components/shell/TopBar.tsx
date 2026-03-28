"use client";

import { useAppStore } from "@/lib/store/app-store";
import { RepoSelector } from "./RepoSelector";
import { TaskIndicator } from "./TaskIndicator";
import { PulseOrb } from "../shared/PulseOrb";
import { Key, Plus } from "lucide-react";

export function TopBar() {
  const { apiKey, setApiKeyModalOpen, setAddRepoModalOpen } = useAppStore();

  return (
    <header className="fixed top-0 left-0 right-0 h-12 z-50 flex items-center justify-between px-4 border-b border-[var(--alpha-white-5)] bg-[var(--surface-0)]/90 backdrop-blur-md">
      {/* Left: Logo */}
      <div className="flex items-center gap-2.5 min-w-[180px]">
        <span className="text-[var(--accent-cyan)] text-lg leading-none">◆</span>
        <span className="font-mono text-sm font-semibold tracking-tight text-gradient">
          Kontext
        </span>
      </div>

      {/* Center: Repo Selector + Add button */}
      <div className="flex-1 flex items-center justify-center max-w-md mx-4 gap-2">
        <RepoSelector />
        <button
          onClick={() => setAddRepoModalOpen(true)}
          className="shrink-0 w-8 h-8 rounded-lg flex items-center justify-center border border-[var(--alpha-white-8)] bg-transparent hover:bg-[var(--accent-cyan)]/10 hover:border-[var(--accent-cyan)]/30 transition-colors cursor-pointer text-[var(--gray-400)] hover:text-[var(--accent-cyan)]"
          title="Add repository"
        >
          <Plus size={16} />
        </button>
      </div>

      {/* Right: Tasks + API key */}
      <div className="flex items-center gap-2.5 min-w-[180px] justify-end">
        <TaskIndicator />
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
