"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAppStore, IngestionState } from "@/lib/store/app-store";
import { motion, AnimatePresence } from "framer-motion";
import {
  ListTodo,
  CheckCircle2,
  Loader2,
  AlertCircle,
  X,
  Clock,
  Database,
  FileCode,
  ArrowRight,
  Layers,
  Zap,
  ChevronRight,
} from "lucide-react";

// Friendly phase labels
const PHASE_LABELS: Record<string, { label: string; icon: typeof Loader2 }> = {
  idle: { label: "Queued", icon: Clock },
  fetching: { label: "Fetching Files", icon: FileCode },
  chunking: { label: "Chunking Code", icon: Layers },
  embedding: { label: "Generating Embeddings", icon: Zap },
  done: { label: "Complete", icon: CheckCircle2 },
  error: { label: "Failed", icon: AlertCircle },
};

function getPhaseInfo(status: string) {
  return PHASE_LABELS[status] || { label: status, icon: Loader2 };
}



export function TaskIndicator() {
  const [isOpen, setIsOpen] = useState(false);
  const [selectedTask, setSelectedTask] = useState<string | null>(null);
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
        setSelectedTask(null);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const tasks = Object.entries(ingestionStatus);
  const activeTasks = tasks.filter(
    ([, s]) => s.status !== "done" && s.status !== "error" && s.status !== "idle"
  );
  const completedTasks = tasks.filter(([, s]) => s.status === "done");
  const errorTasks = tasks.filter(([, s]) => s.status === "error");
  const activeCount = activeTasks.length;
  const hasActive = activeCount > 0;
  const totalCount = tasks.length;

  // Find the selected task data
  const selectedTaskData = selectedTask
    ? tasks.find(([name]) => name === selectedTask)
    : null;

  return (
    <div ref={dropdownRef} className="relative">
      {/* ── Trigger Button ── */}
      <button
        onClick={() => {
          setIsOpen(!isOpen);
          if (isOpen) setSelectedTask(null);
        }}
        className={`relative flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-mono transition-all duration-200 bg-transparent border cursor-pointer ${
          hasActive
            ? "border-[var(--accent-green)]/30 text-[var(--accent-green)] hover:bg-[var(--accent-green)]/10"
            : "border-[var(--alpha-white-8)] text-[var(--gray-400)] hover:bg-[var(--alpha-white-5)] hover:text-[var(--gray-300)]"
        }`}
      >
        {hasActive ? (
          <Loader2 size={14} className="animate-spin" />
        ) : (
          <ListTodo size={14} />
        )}
        <span>Tasks</span>

        {/* Badge — highlighted count when tasks exist */}
        {totalCount > 0 && (
          <span
            className={`inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 text-[10px] font-bold rounded-full transition-all duration-300 ${
              hasActive
                ? "bg-[var(--accent-green)] text-[var(--surface-0)] shadow-[0_0_8px_rgba(63,185,80,0.4)]"
                : "bg-[var(--alpha-white-10)] text-[var(--gray-400)]"
            }`}
          >
            {hasActive ? activeCount : totalCount}
          </span>
        )}

        {/* Pulse dot for active tasks */}
        {hasActive && (
          <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-[var(--accent-green)] animate-pulse" />
        )}
      </button>

      {/* ── Dropdown Panel ── */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: -4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={{ duration: 0.15 }}
            className="absolute top-full right-0 mt-2 w-[380px] glass-strong rounded-xl overflow-hidden shadow-2xl z-[70]"
          >
            {/* Header */}
            <div className="px-4 py-3 border-b border-[var(--alpha-white-5)]">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {selectedTask ? (
                    <button
                      onClick={() => setSelectedTask(null)}
                      className="text-[var(--gray-400)] hover:text-[var(--gray-200)] transition-colors cursor-pointer bg-transparent border-none p-0"
                    >
                      <ChevronRight size={14} className="rotate-180" />
                    </button>
                  ) : null}
                  <span className="font-mono text-xs font-medium text-[var(--gray-200)]">
                    {selectedTask
                      ? selectedTask.split("/").pop()
                      : "Task Manager"}
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  {!selectedTask && (
                    <div className="flex items-center gap-2">
                      {hasActive && (
                        <span className="flex items-center gap-1 font-mono text-[10px] text-[var(--accent-green)]">
                          <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent-green)] animate-pulse" />
                          {activeCount} running
                        </span>
                      )}
                      {completedTasks.length > 0 && (
                        <span className="font-mono text-[10px] text-[var(--gray-500)]">
                          {completedTasks.length} done
                        </span>
                      )}
                      {errorTasks.length > 0 && (
                        <span className="font-mono text-[10px] text-[var(--accent-red)]">
                          {errorTasks.length} failed
                        </span>
                      )}
                    </div>
                  )}
                  <button
                    onClick={() => {
                      setIsOpen(false);
                      setSelectedTask(null);
                    }}
                    className="text-[var(--gray-500)] hover:text-[var(--gray-300)] transition-colors cursor-pointer bg-transparent border-none p-0"
                  >
                    <X size={14} />
                  </button>
                </div>
              </div>
            </div>

            {/* Content */}
            <div className="max-h-[400px] overflow-y-auto">
              <AnimatePresence mode="wait">
                {selectedTask && selectedTaskData ? (
                  <motion.div
                    key="detail"
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -20 }}
                    transition={{ duration: 0.15 }}
                  >
                    <TaskDetailView
                      repoName={selectedTaskData[0]}
                      status={selectedTaskData[1]}
                    />
                  </motion.div>
                ) : (
                  <motion.div
                    key="list"
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 20 }}
                    transition={{ duration: 0.15 }}
                  >
                    {tasks.length === 0 ? (
                      <EmptyState />
                    ) : (
                      <div className="divide-y divide-[var(--alpha-white-5)]">
                        {/* Active tasks first, then errors, then completed */}
                        {[...activeTasks, ...errorTasks, ...completedTasks].map(
                          ([repoName, status]) => (
                            <TaskListItem
                              key={repoName}
                              repoName={repoName}
                              status={status}
                              onSelect={() => setSelectedTask(repoName)}
                            />
                          )
                        )}
                      </div>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ────────────────────────────────────────────
   Empty State
   ──────────────────────────────────────────── */
function EmptyState() {
  return (
    <div className="px-4 py-10 text-center">
      <div className="w-10 h-10 rounded-xl bg-[var(--alpha-white-5)] flex items-center justify-center mx-auto mb-3">
        <ListTodo size={20} className="text-[var(--gray-500)]" />
      </div>
      <p className="font-mono text-xs text-[var(--gray-400)] mb-1">
        No tasks yet
      </p>
      <p className="font-mono text-[10px] text-[var(--gray-600)]">
        Tasks will appear here when you index a repository
      </p>
    </div>
  );
}

/* ────────────────────────────────────────────
   Task List Item (summary row)
   ──────────────────────────────────────────── */
function TaskListItem({
  repoName,
  status,
  onSelect,
}: {
  repoName: string;
  status: IngestionState;
  onSelect: () => void;
}) {
  const isDone = status.status === "done";
  const isError = status.status === "error";
  const isActive =
    !isDone && !isError && status.status !== "idle";
  const phaseInfo = getPhaseInfo(status.status);

  return (
    <button
      onClick={onSelect}
      className="w-full text-left px-4 py-3 hover:bg-[var(--alpha-white-5)] transition-colors cursor-pointer bg-transparent border-none group"
    >
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          {isDone && (
            <CheckCircle2
              size={14}
              className="text-[var(--accent-green)] shrink-0"
            />
          )}
          {isError && (
            <AlertCircle
              size={14}
              className="text-[var(--accent-red)] shrink-0"
            />
          )}
          {isActive && (
            <Loader2
              size={14}
              className="text-[var(--accent-green)] animate-spin shrink-0"
            />
          )}
          {status.status === "idle" && (
            <Clock size={14} className="text-[var(--gray-500)] shrink-0" />
          )}
          <span className="font-mono text-xs text-[var(--gray-200)] truncate">
            {repoName}
          </span>
        </div>
        <ChevronRight
          size={14}
          className="text-[var(--gray-600)] group-hover:text-[var(--gray-400)] transition-colors shrink-0 ml-2"
        />
      </div>

      {/* Mini progress bar for active tasks */}
      {isActive && (
        <div className="mb-1.5">
          <div className="w-full h-1 rounded-full bg-[var(--alpha-white-8)] overflow-hidden">
            <motion.div
              className="h-full rounded-full"
              style={{
                background: "linear-gradient(90deg, #238636, #3FB950)",
              }}
              initial={{ width: "0%" }}
              animate={{ width: `${status.progress}%` }}
              transition={{ duration: 0.3, ease: "easeOut" }}
            />
          </div>
        </div>
      )}

      <div className="flex items-center justify-between">
        <span
          className={`font-mono text-[10px] ${
            isDone
              ? "text-[var(--accent-green)]"
              : isError
              ? "text-[var(--accent-red)]"
              : "text-[var(--gray-500)]"
          }`}
        >
          {phaseInfo.label}
          {isActive && status.progress > 0 ? ` · ${Math.round(status.progress)}%` : ""}
        </span>
        {isActive && (
          <span className="font-mono text-[10px] text-[var(--gray-600)]">
            {status.filesProcessed}/{status.filesTotal} files
          </span>
        )}
      </div>
    </button>
  );
}

/* ────────────────────────────────────────────
   Task Detail View (expanded)
   ──────────────────────────────────────────── */
function TaskDetailView({
  repoName,
  status,
}: {
  repoName: string;
  status: IngestionState;
}) {
  const router = useRouter();
  const { clearIngestionStatus } = useAppStore();
  const isDone = status.status === "done";
  const isError = status.status === "error";
  const isActive = !isDone && !isError && status.status !== "idle";


  const [owner, name] = repoName.split("/");

  // Navigate to repo page
  const handleGoToRepo = () => {
    router.push(`/repo/${owner}/${name}`);
  };

  // Pipeline phases
  const phases = [
    { key: "fetching", label: "Fetch Files", icon: FileCode },
    { key: "chunking", label: "Chunk Code", icon: Layers },
    { key: "embedding", label: "Embed", icon: Zap },
    { key: "done", label: "Complete", icon: CheckCircle2 },
  ];

  const currentPhaseIndex = phases.findIndex((p) => p.key === status.status);

  return (
    <div className="px-4 py-4 space-y-4">
      {/* Repo name header */}
      <div className="flex items-center gap-2">
        <Database size={14} className="text-[var(--gray-400)] shrink-0" />
        <span className="font-mono text-sm font-medium text-[var(--gray-100)]">
          {repoName}
        </span>
      </div>

      {/* Phase pipeline visualization */}
      <div className="space-y-1">
        <span className="font-mono text-[10px] text-[var(--gray-500)] uppercase tracking-wider">
          Pipeline
        </span>
        <div className="flex items-center gap-1">
          {phases.map((phase, i) => {
            const isCurrentPhase = phase.key === status.status;
            const isPast = currentPhaseIndex > i;

            const PIcon = phase.icon;

            return (
              <div key={phase.key} className="flex items-center gap-1 flex-1">
                <div
                  className={`flex items-center justify-center w-7 h-7 rounded-lg transition-all duration-300 ${
                    isPast || (isDone && phase.key === "done")
                      ? "bg-[var(--accent-green)]/15 text-[var(--accent-green)]"
                      : isCurrentPhase
                      ? "bg-[var(--accent-green)]/20 text-[var(--accent-green)] ring-1 ring-[var(--accent-green)]/30"
                      : isError && isCurrentPhase
                      ? "bg-[var(--accent-red)]/15 text-[var(--accent-red)] ring-1 ring-[var(--accent-red)]/30"
                      : "bg-[var(--alpha-white-5)] text-[var(--gray-600)]"
                  }`}
                >
                  {isCurrentPhase && isActive ? (
                    <Loader2 size={13} className="animate-spin" />
                  ) : (
                    <PIcon size={13} />
                  )}
                </div>
                {i < phases.length - 1 && (
                  <div
                    className={`flex-1 h-px transition-colors duration-300 ${
                      isPast
                        ? "bg-[var(--accent-green)]/40"
                        : "bg-[var(--alpha-white-8)]"
                    }`}
                  />
                )}
              </div>
            );
          })}
        </div>
        <div className="flex items-center">
          {phases.map((phase, i) => (
            <span
              key={phase.key}
              className={`flex-1 font-mono text-[9px] text-center ${
                phase.key === status.status
                  ? isError
                    ? "text-[var(--accent-red)]"
                    : "text-[var(--accent-green)]"
                  : currentPhaseIndex > i || isDone
                  ? "text-[var(--gray-500)]"
                  : "text-[var(--gray-700)]"
              }`}
            >
              {phase.label}
            </span>
          ))}
        </div>
      </div>

      {/* Progress bar (active only) */}
      {isActive && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[10px] text-[var(--gray-500)]">
              Progress
            </span>
            <span className="font-mono text-[10px] text-[var(--accent-green)] tabular-nums">
              {Math.round(status.progress)}%
            </span>
          </div>
          <div className="w-full h-1.5 rounded-full bg-[var(--alpha-white-8)] overflow-hidden">
            <motion.div
              className="h-full rounded-full"
              style={{
                background: "linear-gradient(90deg, #238636, #3FB950, #56D364)",
              }}
              initial={{ width: "0%" }}
              animate={{ width: `${status.progress}%` }}
              transition={{ duration: 0.3, ease: "easeOut" }}
            />
          </div>
        </div>
      )}

      {/* Stats grid */}
      <div className="grid grid-cols-2 gap-2">
        <StatCard
          icon={FileCode}
          label="Files"
          value={
            status.filesTotal > 0
              ? `${status.filesProcessed} / ${status.filesTotal}`
              : "—"
          }
          active={isActive && status.status === "fetching"}
        />
        <StatCard
          icon={Layers}
          label="Chunks"
          value={
            status.chunksTotal > 0
              ? `${status.chunksCreated} / ${status.chunksTotal}`
              : status.chunksCreated > 0
              ? `${status.chunksCreated}`
              : "—"
          }
          active={isActive && status.status === "chunking"}
        />
      </div>

      {/* Status message */}
      {(status.message || status.error) && (
        <div
          className={`px-3 py-2 rounded-lg font-mono text-[10px] ${
            isError
              ? "bg-[var(--accent-red)]/10 text-[var(--accent-red)] border border-[var(--accent-red)]/20"
              : "bg-[var(--alpha-white-5)] text-[var(--gray-400)]"
          }`}
        >
          {status.error || status.message}
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-2 pt-1">
        <button
          onClick={handleGoToRepo}
          className="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg font-mono text-xs transition-all duration-200 cursor-pointer border bg-transparent border-[var(--alpha-white-8)] text-[var(--gray-300)] hover:bg-[var(--alpha-white-5)] hover:text-[var(--gray-100)]"
        >
          <span>View Repository</span>
          <ArrowRight size={12} />
        </button>
        {(isDone || isError) && (
          <button
            onClick={() => clearIngestionStatus(repoName)}
            className="flex items-center justify-center px-3 py-2 rounded-lg font-mono text-xs transition-all duration-200 cursor-pointer border bg-transparent border-[var(--alpha-white-8)] text-[var(--gray-500)] hover:bg-[var(--accent-red)]/10 hover:text-[var(--accent-red)] hover:border-[var(--accent-red)]/20"
            title="Dismiss task"
          >
            <X size={12} />
          </button>
        )}
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────
   Stat Card
   ──────────────────────────────────────────── */
function StatCard({
  icon: Icon,
  label,
  value,
  active,
}: {
  icon: typeof FileCode;
  label: string;
  value: string;
  active?: boolean;
}) {
  return (
    <div
      className={`px-3 py-2.5 rounded-lg border transition-all duration-300 ${
        active
          ? "border-[var(--accent-green)]/20 bg-[var(--accent-green)]/5"
          : "border-[var(--alpha-white-5)] bg-[var(--alpha-white-5)]"
      }`}
    >
      <div className="flex items-center gap-1.5 mb-1">
        <Icon
          size={11}
          className={
            active ? "text-[var(--accent-green)]" : "text-[var(--gray-500)]"
          }
        />
        <span className="font-mono text-[9px] text-[var(--gray-500)] uppercase tracking-wider">
          {label}
        </span>
      </div>
      <span
        className={`font-mono text-sm tabular-nums ${
          active ? "text-[var(--accent-green)]" : "text-[var(--gray-200)]"
        }`}
      >
        {value}
      </span>
    </div>
  );
}
