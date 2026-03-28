"use client";

import { useEffect, useState } from "react";
import { useAppStore } from "@/lib/store/app-store";
import { RepoSelector } from "./RepoSelector";
import { TaskIndicator } from "./TaskIndicator";
import { PulseOrb } from "../shared/PulseOrb";
import { Key, Plus, LogIn } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";

export function TopBar() {
  const { apiKey, setApiKeyModalOpen, setAddRepoModalOpen } = useAppStore();
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const router = useRouter();

  // Lightweight auth check
  useEffect(() => {
    fetch("/api/repos")
      .then((r) => setIsAuthenticated(r.ok))
      .catch(() => setIsAuthenticated(false));
  }, []);

  const handleAddRepo = () => {
    if (isAuthenticated === false) {
      router.push("/login");
    } else {
      setAddRepoModalOpen(true);
    }
  };

  return (
    <header className="fixed top-0 left-0 right-0 h-12 z-50 flex items-center justify-between px-4 border-b border-[var(--alpha-white-5)] bg-[var(--surface-0)]/90 backdrop-blur-md">
      {/* Left: Logo */}
      <Link href="/" className="flex items-center gap-2.5 min-w-[180px] no-underline hover:opacity-80 transition-opacity">
        <span className="text-[var(--accent-green)] text-lg leading-none">◆</span>
        <span className="font-mono text-sm font-semibold tracking-tight text-gradient">
          Kontext
        </span>
      </Link>

      {/* Center: Repo Selector + Add button — absolutely centered */}
      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 flex items-center gap-2 w-full max-w-sm">
        <RepoSelector />
        <button
          onClick={handleAddRepo}
          className="shrink-0 w-8 h-8 rounded-lg flex items-center justify-center border border-[var(--alpha-white-8)] bg-transparent hover:bg-[var(--accent-green)]/10 hover:border-[var(--accent-green)]/30 transition-colors cursor-pointer text-[var(--gray-400)] hover:text-[var(--accent-green)]"
          title="Add repository"
        >
          <Plus size={16} />
        </button>
      </div>

      {/* Right: Tasks + API key or Sign In */}
      <div className="flex items-center gap-2.5 min-w-[180px] justify-end">
        {isAuthenticated === false ? (
          <Link
            href="/login"
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-mono transition-colors bg-[var(--accent-green)]/10 border border-[var(--accent-green)]/20 cursor-pointer hover:bg-[var(--accent-green)]/20 text-[var(--accent-green)] no-underline"
          >
            <LogIn size={14} />
            <span>Sign In</span>
          </Link>
        ) : (
          <>
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
          </>
        )}
      </div>
    </header>
  );
}
