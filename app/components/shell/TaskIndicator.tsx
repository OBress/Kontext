"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  IngestionState,
  RepoCheckRunState,
  RepoJobState,
  useAppStore,
} from "@/lib/store/app-store";
import { motion, AnimatePresence } from "framer-motion";
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  ChevronRight,
  Clock,
  Database,
  FileCode,
  Layers,
  ListTodo,
  Loader2,
  Shield,
  Sparkles,
  X,
  Zap,
} from "lucide-react";

const INGESTION_PHASE_LABELS: Record<string, { label: string; icon: typeof Loader2 }> = {
  idle: { label: "Queued", icon: Clock },
  fetching: { label: "Fetching Files", icon: FileCode },
  chunking: { label: "Chunking Code", icon: Layers },
  embedding: { label: "Generating Embeddings", icon: Zap },
  finalizing: { label: "Promoting Index", icon: Database },
  timeline: { label: "Backfilling Timeline", icon: Clock },
  blocked_quota: { label: "Blocked By Quota", icon: AlertCircle },
  blocked_billing: { label: "Billing Required", icon: AlertCircle },
  blocked_model: { label: "Model Unavailable", icon: AlertCircle },
  pending_user_key_sync: { label: "Waiting For Key", icon: Clock },
  done: { label: "Complete", icon: CheckCircle2 },
  error: { label: "Failed", icon: AlertCircle },
};

const CHECK_STATUS_LABELS: Record<
  RepoCheckRunState["status"],
  { label: string; icon: typeof Loader2 }
> = {
  queued: { label: "Queued", icon: Clock },
  running: { label: "Analyzing Repo Health", icon: Loader2 },
  completed: { label: "Checks Complete", icon: CheckCircle2 },
  failed: { label: "Checks Failed", icon: AlertCircle },
  skipped: { label: "Skipped", icon: Clock },
};

const REPO_JOB_STATUS_LABELS: Record<
  RepoJobState["status"],
  { label: string; icon: typeof Loader2 }
> = {
  queued: { label: "Queued", icon: Clock },
  running: { label: "Running", icon: Loader2 },
  completed: { label: "Complete", icon: CheckCircle2 },
  failed: { label: "Failed", icon: AlertCircle },
  skipped: { label: "Skipped", icon: Clock },
};

const REPO_JOB_TYPE_LABELS: Record<RepoJobState["jobType"], string> = {
  ingest: "Repository Ingest",
  sync: "Repository Sync",
  repo_check: "Repo Health",
  onboarding_generate: "Generate Onboarding",
  onboarding_assign: "Assign Onboarding",
  architecture_refresh: "Refresh Architecture",
};

type TaskItem =
  | {
      id: string;
      kind: "ingestion";
      repoName: string;
      ingestion: IngestionState;
      createdAt: string;
    }
  | {
      id: string;
      kind: "check";
      repoName: string;
      checkRun: RepoCheckRunState;
      createdAt: string;
    }
  | {
      id: string;
      kind: "repoJob";
      repoName: string;
      repoJob: RepoJobState;
      createdAt: string;
    };

function isIngestionBlocked(status: IngestionState["status"]) {
  return (
    status === "error" ||
    status === "blocked_quota" ||
    status === "blocked_billing" ||
    status === "blocked_model" ||
    status === "pending_user_key_sync"
  );
}

function getTaskStatusLabel(task: TaskItem) {
  if (task.kind === "ingestion") {
    return INGESTION_PHASE_LABELS[task.ingestion.status] || {
      label: task.ingestion.status,
      icon: Loader2,
    };
  }

  if (task.kind === "repoJob") {
    return REPO_JOB_STATUS_LABELS[task.repoJob.status] || {
      label: task.repoJob.status,
      icon: Loader2,
    };
  }

  return CHECK_STATUS_LABELS[task.checkRun.status] || {
    label: task.checkRun.status,
    icon: Loader2,
  };
}

function getTaskSortScore(task: TaskItem) {
  if (task.kind === "ingestion") {
    if (
      task.ingestion.status !== "done" &&
      !isIngestionBlocked(task.ingestion.status) &&
      task.ingestion.status !== "idle"
    ) {
      return 0;
    }

    if (isIngestionBlocked(task.ingestion.status)) return 1;
    return 2;
  }

  if (task.kind === "repoJob") {
    if (task.repoJob.status === "queued" || task.repoJob.status === "running") {
      return 0;
    }
    if (task.repoJob.status === "failed") return 1;
    return 2;
  }

  if (task.checkRun.status === "queued" || task.checkRun.status === "running") {
    return 0;
  }

  if (task.checkRun.status === "failed") return 1;
  return 2;
}

export function TaskIndicator() {
  const [isOpen, setIsOpen] = useState(false);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [dismissedCheckRuns, setDismissedCheckRuns] = useState<number[]>([]);
  const [dismissedRepoJobs, setDismissedRepoJobs] = useState<number[]>([]);
  const ingestionStatus = useAppStore((s) => s.ingestionStatus);
  const repoCheckRuns = useAppStore((s) => s.repoCheckRuns);
  const setRepoCheckRuns = useAppStore((s) => s.setRepoCheckRuns);
  const repoJobs = useAppStore((s) => s.repoJobs);
  const setRepoJobs = useAppStore((s) => s.setRepoJobs);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
        setSelectedTaskId(null);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  // Adaptive polling: 3s when active jobs exist, 15s when idle
  const pollIntervalRef = useRef<number | null>(null);
  const hasActiveRef = useRef(false);

  const fetchTaskData = useCallback(async () => {
    try {
      const [checkRes, jobRes] = await Promise.all([
        fetch("/api/repos/checks/runs?limit=12"),
        fetch("/api/jobs?limit=12"),
      ]);

      if (checkRes.ok) {
        const data = await checkRes.json();
        const runs = Array.isArray(data.runs)
          ? data.runs.map(
            (run: {
              id: number;
              repo_full_name: string;
              status: RepoCheckRunState["status"];
              trigger_mode: RepoCheckRunState["triggerMode"];
              summary: string | null;
              findings_total: number;
              new_findings: number;
              resolved_findings: number;
              unchanged_findings: number;
              head_sha: string | null;
              created_at: string;
            }): RepoCheckRunState => ({
              id: run.id,
              repoFullName: run.repo_full_name,
              status: run.status,
              triggerMode: run.trigger_mode,
              summary: run.summary,
              findingsTotal: run.findings_total || 0,
              newFindings: run.new_findings || 0,
              resolvedFindings: run.resolved_findings || 0,
              unchangedFindings: run.unchanged_findings || 0,
              headSha: run.head_sha,
              createdAt: run.created_at,
            })
          )
          : [];

        setRepoCheckRuns(runs);
      }

      if (jobRes.ok) {
        const data = await jobRes.json();
        const jobs = Array.isArray(data.jobs)
          ? data.jobs.map(
              (job: {
                id: number;
                repo_full_name: string;
                job_type: RepoJobState["jobType"];
                trigger: RepoJobState["trigger"];
                status: RepoJobState["status"];
                title: string | null;
                progress_percent: number;
                result_summary: string | null;
                error_message: string | null;
                metadata: Record<string, unknown> | null;
                created_at: string;
                updated_at: string;
              }): RepoJobState => ({
                id: job.id,
                repoFullName: job.repo_full_name,
                jobType: job.job_type,
                trigger: job.trigger,
                status: job.status,
                title: job.title,
                progressPercent: job.progress_percent || 0,
                resultSummary: job.result_summary,
                errorMessage: job.error_message,
                createdAt: job.created_at,
                updatedAt: job.updated_at,
                metadata: job.metadata || {},
              })
            )
          : [];

        setRepoJobs(jobs);
      }
    } catch {
      // Ignore polling errors for the task indicator.
    }
  }, [setRepoCheckRuns, setRepoJobs]);

  // Initial fetch
  useEffect(() => {
    fetchTaskData();
  }, [fetchTaskData]);

  // Poll for updates on repos without webhooks (5-minute interval)
  useEffect(() => {
    const pollForUpdates = () => {
      fetch("/api/repos/sync/poll", { method: "POST" }).catch(() => {
        // Ignore polling errors — this is a best-effort fallback.
      });
    };

    // Initial poll after 30 seconds (give time for page load)
    const initialTimeout = window.setTimeout(pollForUpdates, 30_000);
    // Then every 5 minutes
    const pollInterval = window.setInterval(pollForUpdates, 5 * 60 * 1000);

    return () => {
      window.clearTimeout(initialTimeout);
      window.clearInterval(pollInterval);
    };
  }, []);

  const tasks = useMemo(() => {
    const ingestionTasks: TaskItem[] = Object.entries(ingestionStatus).map(
      ([repoName, ingestion]) => ({
        id: `ingestion:${repoName}`,
        kind: "ingestion",
        repoName,
        ingestion,
        createdAt: new Date().toISOString(),
      })
    );

    const checkTasks: TaskItem[] = Object.values(repoCheckRuns)
      .filter((run) => !dismissedCheckRuns.includes(run.id))
      .map((run) => ({
        id: `check:${run.repoFullName}:${run.id}`,
        kind: "check" as const,
        repoName: run.repoFullName,
        checkRun: run,
        createdAt: run.createdAt,
      }));

    const genericJobs: TaskItem[] = Object.values(repoJobs)
      .filter((job) => !dismissedRepoJobs.includes(job.id))
      .filter((job) => job.jobType !== "repo_check" && job.jobType !== "ingest")
      .map((job) => ({
        id: `job:${job.id}`,
        kind: "repoJob" as const,
        repoName: job.repoFullName,
        repoJob: job,
        createdAt: job.createdAt,
      }));

    return [...ingestionTasks, ...checkTasks, ...genericJobs].sort((a, b) => {
      const scoreDiff = getTaskSortScore(a) - getTaskSortScore(b);
      if (scoreDiff !== 0) return scoreDiff;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
  }, [dismissedCheckRuns, dismissedRepoJobs, ingestionStatus, repoCheckRuns, repoJobs]);

  const activeTasks = tasks.filter((task) =>
    task.kind === "ingestion"
      ? task.ingestion.status !== "done" &&
        !isIngestionBlocked(task.ingestion.status) &&
        task.ingestion.status !== "idle"
      : task.kind === "check"
        ? task.checkRun.status === "queued" || task.checkRun.status === "running"
        : task.repoJob.status === "queued" || task.repoJob.status === "running"
  );

  // Adaptive polling: 10s when active jobs exist, 30s when idle
  // (kept slow to reduce Supabase Disk IO; SSE handles real-time ingestion updates)
  useEffect(() => {
    const hasAny = activeTasks.length > 0;
    if (hasAny === hasActiveRef.current && pollIntervalRef.current) return;
    hasActiveRef.current = hasAny;

    if (pollIntervalRef.current) {
      window.clearInterval(pollIntervalRef.current);
    }
    const ms = hasAny ? 10_000 : 30_000;
    pollIntervalRef.current = window.setInterval(fetchTaskData, ms);

    return () => {
      if (pollIntervalRef.current) {
        window.clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    };
  }, [activeTasks.length, fetchTaskData]);
  const completedTasks = tasks.filter((task) =>
    task.kind === "ingestion"
      ? task.ingestion.status === "done"
      : task.kind === "check"
        ? task.checkRun.status === "completed" || task.checkRun.status === "skipped"
        : task.repoJob.status === "completed" || task.repoJob.status === "skipped"
  );
  const errorTasks = tasks.filter((task) =>
    task.kind === "ingestion"
      ? isIngestionBlocked(task.ingestion.status)
      : task.kind === "check"
        ? task.checkRun.status === "failed"
        : task.repoJob.status === "failed"
  );

  const selectedTask = selectedTaskId
    ? tasks.find((task) => task.id === selectedTaskId) || null
    : null;

  const hasActive = activeTasks.length > 0;
  const totalCount = tasks.length;

  return (
    <div ref={dropdownRef} className="relative">
      <button
        onClick={() => {
          setIsOpen(!isOpen);
          if (isOpen) setSelectedTaskId(null);
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

        {totalCount > 0 && (
          <span
            className={`inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 text-xs font-bold rounded-full transition-all duration-300 ${
              hasActive
                ? "bg-[var(--accent-green)] text-[var(--surface-0)] shadow-[0_0_8px_rgba(63,185,80,0.4)]"
                : "bg-[var(--alpha-white-10)] text-[var(--gray-400)]"
            }`}
          >
            {hasActive ? activeTasks.length : totalCount}
          </span>
        )}

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
            className="absolute top-full right-0 mt-2 w-[400px] glass-strong rounded-xl overflow-hidden shadow-2xl z-[70]"
          >
            <div className="px-4 py-3 border-b border-[var(--alpha-white-5)]">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {selectedTask ? (
                    <button
                      onClick={() => setSelectedTaskId(null)}
                      className="text-[var(--gray-400)] hover:text-[var(--gray-200)] transition-colors cursor-pointer bg-transparent border-none p-0"
                    >
                      <ChevronRight size={14} className="rotate-180" />
                    </button>
                  ) : null}
                  <span className="font-mono text-xs font-medium text-[var(--gray-200)]">
                    {selectedTask
                      ? selectedTask.repoName.split("/").pop()
                      : "Task Manager"}
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  {!selectedTask && (
                    <div className="flex items-center gap-2">
                      {activeTasks.length > 0 && (
                        <span className="flex items-center gap-1 font-mono text-xs text-[var(--accent-green)]">
                          <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent-green)] animate-pulse" />
                          {activeTasks.length} running
                        </span>
                      )}
                      {completedTasks.length > 0 && (
                        <span className="font-mono text-xs text-[var(--gray-500)]">
                          {completedTasks.length} done
                        </span>
                      )}
                      {errorTasks.length > 0 && (
                        <span className="font-mono text-xs text-[var(--accent-red)]">
                          {errorTasks.length} failed
                        </span>
                      )}
                    </div>
                  )}
                  <button
                    onClick={() => {
                      setIsOpen(false);
                      setSelectedTaskId(null);
                    }}
                    className="text-[var(--gray-500)] hover:text-[var(--gray-300)] transition-colors cursor-pointer bg-transparent border-none p-0"
                  >
                    <X size={14} />
                  </button>
                </div>
              </div>
            </div>

            <div className="max-h-[420px] overflow-y-auto">
              <AnimatePresence mode="wait">
                {selectedTask ? (
                  <motion.div
                    key="detail"
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -20 }}
                    transition={{ duration: 0.15 }}
                  >
                    <TaskDetailView
                      task={selectedTask}
                      onDismissCheckRun={(runId) =>
                        setDismissedCheckRuns((prev) => [...prev, runId])
                      }
                      onDismissRepoJob={(jobId) =>
                        setDismissedRepoJobs((prev) => [...prev, jobId])
                      }
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
                        {[...activeTasks, ...errorTasks, ...completedTasks].map(
                          (task) => (
                            <TaskListItem
                              key={task.id}
                              task={task}
                              onSelect={() => setSelectedTaskId(task.id)}
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

function EmptyState() {
  return (
    <div className="px-4 py-10 text-center">
      <div className="w-10 h-10 rounded-xl bg-[var(--alpha-white-5)] flex items-center justify-center mx-auto mb-3">
        <ListTodo size={20} className="text-[var(--gray-500)]" />
      </div>
      <p className="font-mono text-xs text-[var(--gray-400)] mb-1">
        No tasks yet
      </p>
      <p className="font-mono text-xs text-[var(--gray-600)]">
        Ingestion, onboarding, and repo health work will appear here
      </p>
    </div>
  );
}

function TaskListItem({
  task,
  onSelect,
}: {
  task: TaskItem;
  onSelect: () => void;
}) {
  const label = getTaskStatusLabel(task);
  const isDone =
    task.kind === "ingestion"
      ? task.ingestion.status === "done"
      : task.kind === "check"
        ? task.checkRun.status === "completed" || task.checkRun.status === "skipped"
        : task.repoJob.status === "completed" || task.repoJob.status === "skipped";
  const isError =
    task.kind === "ingestion"
      ? isIngestionBlocked(task.ingestion.status)
      : task.kind === "check"
        ? task.checkRun.status === "failed"
        : task.repoJob.status === "failed";
  const isActive = !isDone && !isError;

  return (
    <button
      onClick={onSelect}
      className="w-full text-left px-4 py-3 hover:bg-[var(--alpha-white-5)] transition-colors cursor-pointer bg-transparent border-none group"
    >
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          {isDone && (
            <CheckCircle2 size={14} className="text-[var(--accent-green)] shrink-0" />
          )}
          {isError && (
            <AlertCircle size={14} className="text-[var(--accent-red)] shrink-0" />
          )}
          {isActive && (
            <Loader2 size={14} className="text-[var(--accent-green)] animate-spin shrink-0" />
          )}
          <span className="font-mono text-xs text-[var(--gray-200)] truncate">
            {task.repoName}
          </span>
          <span className="px-1.5 py-0.5 rounded-full bg-[var(--alpha-white-5)] font-mono text-xs text-[var(--gray-500)] shrink-0">
            {task.kind === "ingestion"
              ? "ingest"
              : task.kind === "check"
                ? "checks"
                : "job"}
          </span>
        </div>
        <ChevronRight
          size={14}
          className="text-[var(--gray-600)] group-hover:text-[var(--gray-400)] transition-colors shrink-0 ml-2"
        />
      </div>

      {task.kind === "ingestion" && isActive && (
        <div className="mb-1.5">
          <div className="w-full h-1 rounded-full bg-[var(--alpha-white-8)] overflow-hidden">
            <motion.div
              className="h-full rounded-full"
              style={{
                background: "linear-gradient(90deg, #238636, #3FB950)",
              }}
              initial={{ width: "0%" }}
              animate={{ width: `${task.ingestion.progress}%` }}
              transition={{ duration: 0.3, ease: "easeOut" }}
            />
          </div>
        </div>
      )}

      <div className="flex items-center justify-between gap-2">
        <span
          className={`font-mono text-xs ${
            isDone
              ? "text-[var(--accent-green)]"
              : isError
                ? "text-[var(--accent-red)]"
                : "text-[var(--gray-500)]"
          }`}
        >
          {label.label}
          {task.kind === "ingestion" && isActive && task.ingestion.progress > 0
            ? ` - ${Math.round(task.ingestion.progress)}%`
            : ""}
        </span>
        {task.kind === "ingestion" ? (
          isActive ? (
            <span className="font-mono text-xs text-[var(--gray-600)]">
              {task.ingestion.filesProcessed}/{task.ingestion.filesTotal} files
            </span>
          ) : null
        ) : task.kind === "check" ? (
          <span className="font-mono text-xs text-[var(--gray-600)]">
            {task.checkRun.newFindings} new - {task.checkRun.resolvedFindings} resolved
          </span>
        ) : (
          <span className="font-mono text-xs text-[var(--gray-600)]">
            {REPO_JOB_TYPE_LABELS[task.repoJob.jobType]}
          </span>
        )}
      </div>
    </button>
  );
}

function TaskDetailView({
  task,
  onDismissCheckRun,
  onDismissRepoJob,
}: {
  task: TaskItem;
  onDismissCheckRun: (runId: number) => void;
  onDismissRepoJob: (jobId: number) => void;
}) {
  const router = useRouter();
  const { clearIngestionStatus, clearRepoCheckRun, clearRepoJob } = useAppStore();
  const [owner, name] = task.repoName.split("/");

  const goToRepo = () => {
    router.push(`/repo/${owner}/${name}`);
  };

  const goToChecks = () => {
    router.push(`/repo/${owner}/${name}/checks`);
  };

  const goToTeam = () => {
    router.push(`/repo/${owner}/${name}/team`);
  };

  const goToGraph = () => {
    router.push(`/repo/${owner}/${name}/graph`);
  };

  if (task.kind === "check") {
    const label = getTaskStatusLabel(task);
    const isDone =
      task.checkRun.status === "completed" || task.checkRun.status === "skipped";
    const isError = task.checkRun.status === "failed";

    return (
      <div className="px-4 py-4 space-y-4">
        <div className="flex items-center gap-2">
          <Shield size={14} className="text-[var(--accent-amber)] shrink-0" />
          <span className="font-mono text-sm font-medium text-[var(--gray-100)]">
            {task.repoName}
          </span>
        </div>

        <div className="rounded-lg border border-[var(--alpha-white-8)] bg-[var(--alpha-white-5)] px-3 py-3">
          <div className="flex items-center gap-2 mb-1.5">
            {isDone ? (
              <CheckCircle2 size={14} className="text-[var(--accent-green)]" />
            ) : isError ? (
              <AlertCircle size={14} className="text-[var(--accent-red)]" />
            ) : (
              <Loader2 size={14} className="animate-spin text-[var(--accent-green)]" />
            )}
            <span className="font-mono text-xs text-[var(--gray-200)]">
              {label.label}
            </span>
            <span className="ml-auto font-mono text-xs text-[var(--gray-500)]">
              {task.checkRun.triggerMode}
            </span>
          </div>
          <p className="font-mono text-xs text-[var(--gray-500)] m-0">
            {task.checkRun.summary || "Kontext is updating repo health for the latest changes."}
          </p>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <StatCard
            icon={AlertCircle}
            label="New"
            value={String(task.checkRun.newFindings)}
            active={task.checkRun.newFindings > 0}
          />
          <StatCard
            icon={CheckCircle2}
            label="Resolved"
            value={String(task.checkRun.resolvedFindings)}
            active={task.checkRun.resolvedFindings > 0}
          />
          <StatCard
            icon={Sparkles}
            label="Open"
            value={String(task.checkRun.findingsTotal)}
            active={task.checkRun.findingsTotal > 0}
          />
        </div>

        <div className="flex items-center gap-2 pt-1">
          <button
            onClick={goToChecks}
            className="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg font-mono text-xs transition-all duration-200 cursor-pointer border bg-transparent border-[var(--alpha-white-8)] text-[var(--gray-300)] hover:bg-[var(--alpha-white-5)] hover:text-[var(--gray-100)]"
          >
            <span>Open Checks</span>
            <ArrowRight size={12} />
          </button>
          {(isDone || isError) && (
            <button
              onClick={() => {
                clearRepoCheckRun(task.repoName);
                onDismissCheckRun(task.checkRun.id);
              }}
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

  if (task.kind === "repoJob") {
    const isDone =
      task.repoJob.status === "completed" || task.repoJob.status === "skipped";
    const isError = task.repoJob.status === "failed";
    const primaryAction =
      task.repoJob.jobType === "onboarding_generate" ||
      task.repoJob.jobType === "onboarding_assign"
        ? goToTeam
        : task.repoJob.jobType === "architecture_refresh"
          ? goToGraph
          : goToRepo;

    const primaryLabel =
      task.repoJob.jobType === "onboarding_generate" ||
      task.repoJob.jobType === "onboarding_assign"
        ? "Open Team"
        : task.repoJob.jobType === "architecture_refresh"
          ? "Open Graph"
          : "Open Repository";

    return (
      <div className="px-4 py-4 space-y-4">
        <div className="flex items-center gap-2">
          <Sparkles size={14} className="text-[var(--accent-green)] shrink-0" />
          <span className="font-mono text-sm font-medium text-[var(--gray-100)]">
            {task.repoName}
          </span>
        </div>

        <div className="rounded-lg border border-[var(--alpha-white-8)] bg-[var(--alpha-white-5)] px-3 py-3">
          <div className="flex items-center gap-2 mb-1.5">
            {isDone ? (
              <CheckCircle2 size={14} className="text-[var(--accent-green)]" />
            ) : isError ? (
              <AlertCircle size={14} className="text-[var(--accent-red)]" />
            ) : (
              <Loader2 size={14} className="animate-spin text-[var(--accent-green)]" />
            )}
            <span className="font-mono text-xs text-[var(--gray-200)]">
              {task.repoJob.title || REPO_JOB_TYPE_LABELS[task.repoJob.jobType]}
            </span>
            <span className="ml-auto font-mono text-xs text-[var(--gray-500)]">
              {task.repoJob.trigger}
            </span>
          </div>
          <p className="font-mono text-xs text-[var(--gray-500)] m-0">
            {task.repoJob.resultSummary ||
              task.repoJob.errorMessage ||
              "Kontext is processing this background job."}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <StatCard
            icon={Sparkles}
            label="Job"
            value={REPO_JOB_TYPE_LABELS[task.repoJob.jobType]}
            active={task.repoJob.status === "running"}
          />
          <StatCard
            icon={Clock}
            label="Progress"
            value={`${task.repoJob.progressPercent}%`}
            active={task.repoJob.status === "running"}
          />
        </div>

        <div className="flex items-center gap-2 pt-1">
          <button
            onClick={primaryAction}
            className="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg font-mono text-xs transition-all duration-200 cursor-pointer border bg-transparent border-[var(--alpha-white-8)] text-[var(--gray-300)] hover:bg-[var(--alpha-white-5)] hover:text-[var(--gray-100)]"
          >
            <span>{primaryLabel}</span>
            <ArrowRight size={12} />
          </button>
          {(isDone || isError) && (
            <button
              onClick={() => {
                clearRepoJob(task.repoJob.id);
                onDismissRepoJob(task.repoJob.id);
              }}
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

  const status = task.ingestion;
  const isDone = status.status === "done";
  const isError = isIngestionBlocked(status.status);
  const isActive = !isDone && !isError && status.status !== "idle";

  const phases = [
    { key: "fetching", label: "Fetch Files", icon: FileCode },
    { key: "chunking", label: "Chunk Code", icon: Layers },
    { key: "embedding", label: "Embed", icon: Zap },
    { key: "finalizing", label: "Promote", icon: Database },
    { key: "done", label: "Complete", icon: CheckCircle2 },
  ];

  const currentPhaseIndex = phases.findIndex((p) => p.key === status.status);

  return (
    <div className="px-4 py-4 space-y-4">
      <div className="flex items-center gap-2">
        <Database size={14} className="text-[var(--gray-400)] shrink-0" />
        <span className="font-mono text-sm font-medium text-[var(--gray-100)]">
          {task.repoName}
        </span>
      </div>

      <div className="space-y-1">
        <span className="font-mono text-xs text-[var(--gray-500)] uppercase tracking-wider">
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
                      isPast ? "bg-[var(--accent-green)]/40" : "bg-[var(--alpha-white-8)]"
                    }`}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>

      {isActive && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="font-mono text-xs text-[var(--gray-500)]">
              Progress
            </span>
            <span className="font-mono text-xs text-[var(--accent-green)] tabular-nums">
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

      <div className="grid grid-cols-2 gap-2">
        <StatCard
          icon={FileCode}
          label="Files"
          value={
            status.filesTotal > 0
              ? `${status.filesProcessed} / ${status.filesTotal}`
              : "--"
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
                : "--"
          }
          active={isActive && status.status === "chunking"}
        />
      </div>

      {(status.message || status.error) && (
        <div
          className={`px-3 py-2 rounded-lg font-mono text-xs ${
            isError
              ? "bg-[var(--accent-red)]/10 text-[var(--accent-red)] border border-[var(--accent-red)]/20"
              : "bg-[var(--alpha-white-5)] text-[var(--gray-400)]"
          }`}
        >
          {status.error || status.message}
        </div>
      )}

      <div className="flex items-center gap-2 pt-1">
        <button
          onClick={goToRepo}
          className="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg font-mono text-xs transition-all duration-200 cursor-pointer border bg-transparent border-[var(--alpha-white-8)] text-[var(--gray-300)] hover:bg-[var(--alpha-white-5)] hover:text-[var(--gray-100)]"
        >
          <span>View Repository</span>
          <ArrowRight size={12} />
        </button>
        {(isDone || isError) && (
          <button
            onClick={() => clearIngestionStatus(task.repoName)}
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
          className={active ? "text-[var(--accent-green)]" : "text-[var(--gray-500)]"}
        />
        <span className="font-mono text-xs text-[var(--gray-500)] uppercase tracking-wider">
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
