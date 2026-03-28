"use client";

import { useState, useRef, useEffect } from "react";
import { useAppStore } from "@/lib/store/app-store";
import { motion, AnimatePresence } from "framer-motion";
import {
  ListTodo,
  CheckCircle2,
  Loader2,
  AlertCircle,
  ChevronDown,
  Database,
} from "lucide-react";

export function TaskIndicator() {
  const [isOpen, setIsOpen] = useState(false);
  const ingestionStatus = useAppStore((s) => s.ingestionStatus);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const tasks = Object.entries(ingestionStatus);
  const activeTasks = tasks.filter(
    ([, s]) => s.status !== "done" && s.status !== "error" && s.status !== "idle"
  );
  const hasActive = activeTasks.length > 0;
  const hasAny = tasks.length > 0;

  if (!hasAny) return null;

  return (
    <div ref={dropdownRef} className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`relative flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-mono transition-colors bg-transparent border cursor-pointer ${
          hasActive
            ? "border-[var(--accent-green)]/30 text-[var(--accent-green)] hover:bg-[var(--accent-green)]/10"
            : "border-[var(--alpha-white-8)] text-[var(--gray-400)] hover:bg-[var(--alpha-white-5)]"
        }`}
      >
        {hasActive ? (
          <Loader2 size={14} className="animate-spin" />
        ) : (
          <ListTodo size={14} />
        )}
        <span>{activeTasks.length > 0 ? activeTasks.length : tasks.length}</span>
        {hasActive && (
          <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-[var(--accent-green)] animate-pulse" />
        )}
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: -4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={{ duration: 0.15 }}
            className="absolute top-full right-0 mt-2 w-80 glass-strong rounded-xl overflow-hidden shadow-2xl z-[70]"
          >
            <div className="px-4 py-3 border-b border-[var(--alpha-white-5)]">
              <div className="flex items-center justify-between">
                <span className="font-mono text-xs font-medium text-[var(--gray-200)]">
                  Active Tasks
                </span>
                <span className="font-mono text-[10px] text-[var(--gray-500)]">
                  {activeTasks.length} running
                </span>
              </div>
            </div>

            <div className="max-h-[320px] overflow-y-auto divide-y divide-[var(--alpha-white-5)]">
              {tasks.length === 0 ? (
                <div className="px-4 py-6 text-center">
                  <span className="font-mono text-xs text-[var(--gray-500)]">
                    No active tasks
                  </span>
                </div>
              ) : (
                tasks.map(([repoName, status]) => (
                  <TaskItem
                    key={repoName}
                    repoName={repoName}
                    status={status}
                  />
                ))
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function TaskItem({
  repoName,
  status,
}: {
  repoName: string;
  status: {
    status: string;
    progress: number;
    message?: string;
    error?: string;
  };
}) {
  const isDone = status.status === "done";
  const isError = status.status === "error";
  const isActive = !isDone && !isError && status.status !== "idle";

  return (
    <div className="px-4 py-3">
      <div className="flex items-center gap-2 mb-1.5">
        {isDone && (
          <CheckCircle2
            size={13}
            className="text-[var(--accent-green)] shrink-0"
          />
        )}
        {isError && (
          <AlertCircle
            size={13}
            className="text-[var(--accent-red)] shrink-0"
          />
        )}
        {isActive && (
          <Loader2
            size={13}
            className="text-[var(--accent-green)] animate-spin shrink-0"
          />
        )}
        <span className="font-mono text-xs text-[var(--gray-200)] truncate">
          {repoName}
        </span>
      </div>

      {/* Progress bar */}
      {isActive && (
        <div className="mb-1.5">
          <div className="w-full h-1 rounded-full bg-[var(--alpha-white-8)] overflow-hidden">
            <motion.div
              className="h-full rounded-full"
              style={{
                background:
                  "linear-gradient(90deg, #238636, #3FB950)",
              }}
              initial={{ width: "0%" }}
              animate={{ width: `${status.progress}%` }}
              transition={{ duration: 0.3, ease: "easeOut" }}
            />
          </div>
        </div>
      )}

      <span
        className={`font-mono text-[10px] ${
          isDone
            ? "text-[var(--accent-green)]"
            : isError
            ? "text-[var(--accent-red)]"
            : "text-[var(--gray-500)]"
        }`}
      >
        {status.message || status.error || "Pending..."}
      </span>
    </div>
  );
}
