/**
 * Per-user sync queue and concurrency limiter.
 *
 * Solves two problems:
 * 1. Same-repo rapid pushes: only one sync runs per user+repo, with SHA coalescing
 * 2. Per-user AI rate limiting: max N concurrent AI-heavy operations per user
 *
 * In-memory only — state resets on server restart, which is safe because the
 * worst case is a single overlapping sync that the DB handles idempotently.
 */

/* ------------------------------------------------------------------ */
/*  Configuration                                                      */
/* ------------------------------------------------------------------ */

/** Max concurrent AI-heavy operations (syncs + arch refresh + checks) per user */
export const MAX_CONCURRENT_PER_USER = 3;

/** Max coalesce iterations before breaking the loop (safety cap) */
const MAX_COALESCE_ITERATIONS = 3;

/** Hard timeout for a single operation (ms) */
const TASK_TIMEOUT_MS = 5 * 60 * 1000;

/** Interval for stale-lock cleanup sweep (ms) */
const STALE_CLEANUP_INTERVAL_MS = 60_000;

/** Age after which a lock is considered stale and force-released (ms) */
const STALE_LOCK_AGE_MS = 10 * 60 * 1000;

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface EnqueueSyncResult {
  status: "started" | "coalesced" | "queued";
}

export interface EnqueueAiResult {
  status: "started" | "queued" | "deduplicated";
}

export interface QueueStatusEntry {
  repoFullName: string;
  taskType: string;
  startedAt: number;
  pendingSHA: string | null;
}

export interface UserQueueStatus {
  userId: string;
  activeCount: number;
  maxConcurrent: number;
  activeLocks: QueueStatusEntry[];
  waitQueueDepth: number;
}

interface RepoSyncLock {
  running: boolean;
  startedAt: number;
  pendingSHA: string | null;
  trigger: string;
}

interface QueuedSyncTask {
  type: "sync";
  userId: string;
  repoFullName: string;
  headSHA: string;
  trigger: string;
  execute: (headSHA: string) => Promise<unknown>;
  enqueuedAt: number;
}

interface QueuedAiTask {
  type: "ai";
  userId: string;
  repoFullName: string;
  taskId: string;
  execute: () => Promise<unknown>;
  enqueuedAt: number;
}

type QueuedTask = QueuedSyncTask | QueuedAiTask;

/* ------------------------------------------------------------------ */
/*  Internal State                                                     */
/* ------------------------------------------------------------------ */

/** Per-repo sync locks — key: "userId:repoFullName" */
const repoSyncLocks = new Map<string, RepoSyncLock>();

/** Per-user active operation count */
const userActiveCount = new Map<string, number>();

/** Per-user FIFO wait queue */
const userWaitQueues = new Map<string, QueuedTask[]>();

/** Active AI task IDs for deduplication — key: "userId:taskId" */
const activeAiTaskIds = new Set<string>();

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function lk(userId: string, repo: string): string {
  return `${userId}:${repo}`;
}

function getActive(userId: string): number {
  return userActiveCount.get(userId) || 0;
}

function incActive(userId: string): void {
  userActiveCount.set(userId, getActive(userId) + 1);
}

function decActive(userId: string): void {
  const n = getActive(userId);
  if (n <= 1) userActiveCount.delete(userId);
  else userActiveCount.set(userId, n - 1);
}

function getQueue(userId: string): QueuedTask[] {
  let q = userWaitQueues.get(userId);
  if (!q) {
    q = [];
    userWaitQueues.set(userId, q);
  }
  return q;
}

function drainQueue(userId: string): void {
  const q = userWaitQueues.get(userId);
  if (!q || q.length === 0) return;

  while (q.length > 0 && getActive(userId) < MAX_CONCURRENT_PER_USER) {
    const entry = q.shift()!;

    if (entry.type === "sync") {
      const key = lk(entry.userId, entry.repoFullName);
      const lock = repoSyncLocks.get(key);

      if (lock?.running) {
        // Repo already syncing via another path — coalesce
        lock.pendingSHA = entry.headSHA;
        console.log(
          `[sync-queue] Queued sync for ${entry.repoFullName} coalesced with running sync`
        );
        continue;
      }

      void runSyncTask(entry);
    } else {
      void runAiTask(entry);
    }
  }

  if (q.length === 0) userWaitQueues.delete(userId);
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms / 1000}s`)), ms)
    ),
  ]);
}

/* ------------------------------------------------------------------ */
/*  Sync Task Runner                                                   */
/* ------------------------------------------------------------------ */

async function runSyncTask(task: QueuedSyncTask): Promise<void> {
  const key = lk(task.userId, task.repoFullName);

  repoSyncLocks.set(key, {
    running: true,
    startedAt: Date.now(),
    pendingSHA: null,
    trigger: task.trigger,
  });
  incActive(task.userId);

  let currentSHA: string | null = task.headSHA;
  let iterations = 0;

  while (currentSHA && iterations < MAX_COALESCE_ITERATIONS) {
    iterations++;
    const lock = repoSyncLocks.get(key);
    if (lock) lock.pendingSHA = null;

    console.log(
      `[sync-queue] Sync ${task.repoFullName} → ${currentSHA.slice(0, 7)}` +
        (iterations > 1 ? ` (coalesced #${iterations})` : "")
    );

    try {
      await withTimeout(
        task.execute(currentSHA) as Promise<unknown>,
        TASK_TIMEOUT_MS,
        `Sync ${task.repoFullName}`
      );
    } catch (err) {
      console.error(
        `[sync-queue] Sync failed for ${task.repoFullName}:`,
        err instanceof Error ? err.message : err
      );
      break;
    }

    const postLock = repoSyncLocks.get(key);
    currentSHA = postLock?.pendingSHA || null;
    if (currentSHA && postLock) {
      console.log(
        `[sync-queue] Coalesced SHA for ${task.repoFullName}: ${currentSHA.slice(0, 7)}`
      );
      postLock.startedAt = Date.now();
    }
  }

  repoSyncLocks.delete(key);
  decActive(task.userId);
  drainQueue(task.userId);
}

/* ------------------------------------------------------------------ */
/*  AI Task Runner                                                     */
/* ------------------------------------------------------------------ */

async function runAiTask(task: QueuedAiTask): Promise<void> {
  const dedupeKey = `${task.userId}:${task.taskId}`;
  activeAiTaskIds.add(dedupeKey);
  incActive(task.userId);

  try {
    await withTimeout(
      task.execute() as Promise<unknown>,
      TASK_TIMEOUT_MS,
      `AI task ${task.taskId}`
    );
  } catch (err) {
    console.error(
      `[sync-queue] AI task ${task.taskId} failed:`,
      err instanceof Error ? err.message : err
    );
  }

  activeAiTaskIds.delete(dedupeKey);
  decActive(task.userId);
  drainQueue(task.userId);
}

/* ------------------------------------------------------------------ */
/*  Public API                                                         */
/* ------------------------------------------------------------------ */

/**
 * Enqueue a sync task for a user+repo. Handles:
 * - Per-repo mutual exclusion (only one sync at a time)
 * - SHA coalescing (rapid pushes collapse into one follow-up)
 * - Per-user concurrency limiting
 */
export function enqueueSyncTask(params: {
  userId: string;
  repoFullName: string;
  headSHA: string;
  trigger: string;
  execute: (headSHA: string) => Promise<unknown>;
}): EnqueueSyncResult {
  const key = lk(params.userId, params.repoFullName);
  const lock = repoSyncLocks.get(key);

  // Already syncing this repo → coalesce SHA
  if (lock?.running) {
    lock.pendingSHA = params.headSHA;
    console.log(
      `[sync-queue] Coalesced ${params.repoFullName} SHA → ${params.headSHA.slice(0, 7)} (trigger: ${params.trigger})`
    );
    return { status: "coalesced" };
  }

  // Check per-user concurrency
  if (getActive(params.userId) >= MAX_CONCURRENT_PER_USER) {
    getQueue(params.userId).push({
      type: "sync",
      userId: params.userId,
      repoFullName: params.repoFullName,
      headSHA: params.headSHA,
      trigger: params.trigger,
      execute: params.execute,
      enqueuedAt: Date.now(),
    });
    console.log(
      `[sync-queue] Queued sync for ${params.repoFullName} (user at ${MAX_CONCURRENT_PER_USER} capacity)`
    );
    return { status: "queued" };
  }

  // Start immediately
  void runSyncTask({
    type: "sync",
    userId: params.userId,
    repoFullName: params.repoFullName,
    headSHA: params.headSHA,
    trigger: params.trigger,
    execute: params.execute,
    enqueuedAt: Date.now(),
  });

  return { status: "started" };
}

/**
 * Enqueue an AI-heavy background task (architecture refresh, repo checks).
 * Respects per-user concurrency and deduplicates by taskId.
 */
export function enqueueAiTask(params: {
  userId: string;
  repoFullName: string;
  taskId: string;
  execute: () => Promise<unknown>;
}): EnqueueAiResult {
  const dedupeKey = `${params.userId}:${params.taskId}`;

  if (activeAiTaskIds.has(dedupeKey)) {
    console.log(`[sync-queue] AI task ${params.taskId} deduplicated`);
    return { status: "deduplicated" };
  }

  if (getActive(params.userId) >= MAX_CONCURRENT_PER_USER) {
    getQueue(params.userId).push({
      type: "ai",
      userId: params.userId,
      repoFullName: params.repoFullName,
      taskId: params.taskId,
      execute: params.execute,
      enqueuedAt: Date.now(),
    });
    console.log(
      `[sync-queue] Queued AI task ${params.taskId} (user at capacity)`
    );
    return { status: "queued" };
  }

  void runAiTask({
    type: "ai",
    userId: params.userId,
    repoFullName: params.repoFullName,
    taskId: params.taskId,
    execute: params.execute,
    enqueuedAt: Date.now(),
  });

  return { status: "started" };
}

/**
 * Check if a specific repo is currently syncing for a user.
 * Used by the HTTP sync route to return early if already syncing.
 */
export function isRepoSyncing(userId: string, repoFullName: string): boolean {
  const lock = repoSyncLocks.get(lk(userId, repoFullName));
  return lock?.running === true;
}

/**
 * Get queue status for monitoring / debugging.
 */
export function getQueueStatus(userId?: string): UserQueueStatus[] {
  const userIds = userId
    ? [userId]
    : [
        ...new Set([
          ...userActiveCount.keys(),
          ...userWaitQueues.keys(),
        ]),
      ];

  return userIds.map((uid) => {
    const activeLocks: QueueStatusEntry[] = [];

    for (const [key, lock] of repoSyncLocks.entries()) {
      if (key.startsWith(`${uid}:`)) {
        activeLocks.push({
          repoFullName: key.slice(uid.length + 1),
          taskType: "sync",
          startedAt: lock.startedAt,
          pendingSHA: lock.pendingSHA,
        });
      }
    }

    return {
      userId: uid,
      activeCount: getActive(uid),
      maxConcurrent: MAX_CONCURRENT_PER_USER,
      activeLocks,
      waitQueueDepth: userWaitQueues.get(uid)?.length || 0,
    };
  });
}

/* ------------------------------------------------------------------ */
/*  Stale Lock Cleanup                                                 */
/* ------------------------------------------------------------------ */

function cleanupStaleLocks() {
  const now = Date.now();

  for (const [key, lock] of repoSyncLocks.entries()) {
    if (lock.running && now - lock.startedAt > STALE_LOCK_AGE_MS) {
      const [userId] = key.split(":", 1);
      console.warn(
        `[sync-queue] Releasing stale sync lock: ${key} (age: ${Math.round((now - lock.startedAt) / 1000)}s)`
      );
      repoSyncLocks.delete(key);
      decActive(userId);
      drainQueue(userId);
    }
  }
}

// Run cleanup periodically (avoids permanently stuck locks on crashes)
const cleanupTimer = setInterval(cleanupStaleLocks, STALE_CLEANUP_INTERVAL_MS);
if (typeof cleanupTimer === "object" && "unref" in cleanupTimer) {
  cleanupTimer.unref();
}
