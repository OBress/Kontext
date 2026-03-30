import type { IngestionState, Repo } from "@/lib/store/app-store";
import { useAppStore } from "@/lib/store/app-store";

interface StreamCallbacks {
  setIngestionStatus: (name: string, state: IngestionState) => void;
  updateRepo: (name: string, updates: Partial<Repo>) => void;
}

/**
 * Shared SSE stream reader for ingestion events.
 *
 * Both AddRepoModal (initial ingest) and RetryIngestionButton use this
 * to avoid duplicated parsing logic. It handles merge-on-update so that
 * partial SSE events (like retry-only messages) don't nuke existing counts.
 */
export async function streamIngestion(
  repoFullName: string,
  apiKey: string,
  body: Record<string, unknown>,
  callbacks: StreamCallbacks
): Promise<void> {
  const { setIngestionStatus, updateRepo } = callbacks;

  // Running state for merge-on-update — keeps last known good values
  let lastFiles = { total: 0, processed: 0 };
  let lastChunks = { created: 0, total: 0 };
  let lastProgress = 0;

  const res = await fetch("/api/repos/ingest", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-google-api-key": apiKey,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok || !res.body) {
    throw new Error("Ingestion request failed");
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      const dataLine = line.replace(/^data: /, "").trim();
      if (!dataLine) continue;
      try {
        const event = JSON.parse(dataLine);
        processIngestionEvent(
          repoFullName,
          event,
          { lastFiles, lastChunks, lastProgress },
          (state) => {
            // Track running state for merge
            lastFiles = {
              total: state.filesTotal,
              processed: state.filesProcessed,
            };
            lastChunks = {
              created: state.chunksCreated,
              total: state.chunksTotal,
            };
            lastProgress = state.progress;
            setIngestionStatus(repoFullName, state);
          },
          updateRepo
        );
      } catch {
        // skip malformed JSON
      }
    }
  }
}

interface RunningState {
  lastFiles: { total: number; processed: number };
  lastChunks: { created: number; total: number };
  lastProgress: number;
}

/**
 * Process a single SSE event into an IngestionState update.
 * Uses merge-on-update: if an event doesn't include a field, we keep
 * the last known value instead of resetting to 0.
 */
function processIngestionEvent(
  repoFullName: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  event: Record<string, any>,
  running: RunningState,
  setStatus: (state: IngestionState) => void,
  updateRepo: (name: string, updates: Partial<Repo>) => void
) {
  const { lastFiles, lastChunks, lastProgress } = running;

  if (event.status === "fetching") {
    setStatus({
      status: "fetching",
      progress: 5,
      filesTotal: 0,
      filesProcessed: 0,
      chunksCreated: 0,
      chunksTotal: 0,
      message: event.message || "Fetching repository tree...",
      isWaiting: false,
    });
  } else if (event.status === "chunking") {
    const filesTotal = event.filesTotal || lastFiles.total;
    const filesProcessed = event.filesProcessed || 0;
    const pct = filesTotal
      ? Math.round((filesProcessed / filesTotal) * 50) + 10
      : 10;
    setStatus({
      status: "chunking",
      progress: pct,
      filesTotal,
      filesProcessed,
      chunksCreated: event.chunksCreated || 0,
      chunksTotal: 0,
      message: `Processing files (${filesProcessed}/${filesTotal})...`,
      isWaiting: false,
    });
  } else if (event.status === "embedding") {
    const isWaiting = event.isWaiting === true;

    // Merge: use event values if present, otherwise keep last known
    const filesTotal = event.filesTotal ?? lastFiles.total;
    const filesProcessed = event.filesProcessed ?? lastFiles.processed;
    const chunksEmbedded = event.chunksEmbedded ?? lastChunks.created;
    const chunksTotal = event.chunksTotal ?? lastChunks.total;

    // Progress only moves forward; during cooldown it freezes
    let pct: number;
    if (isWaiting) {
      pct = lastProgress; // freeze
    } else {
      pct = chunksTotal
        ? Math.round((chunksEmbedded / chunksTotal) * 30) + 60
        : lastProgress || 60;
    }

    setStatus({
      status: "embedding",
      progress: pct,
      filesTotal,
      filesProcessed,
      chunksCreated: chunksEmbedded,
      chunksTotal,
      message:
        event.message ||
        `Embedding chunks (${chunksEmbedded}/${chunksTotal})...`,
      isWaiting,
    });
  } else if (
    event.status === "finalizing" ||
    event.status === "timeline"
  ) {
    setStatus({
      status: event.status,
      progress: event.status === "finalizing" ? 95 : 98,
      filesTotal: event.filesTotal ?? lastFiles.total,
      filesProcessed: event.filesProcessed ?? lastFiles.processed,
      chunksCreated: event.chunksCreated ?? lastChunks.created,
      chunksTotal: event.chunksTotal ?? lastChunks.total,
      message: event.message || "Finalizing index...",
      isWaiting: false,
    });
  } else if (
    event.status === "blocked_quota" ||
    event.status === "blocked_billing" ||
    event.status === "blocked_model"
  ) {
    setStatus({
      status: event.status,
      progress: 0,
      filesTotal: event.filesTotal ?? lastFiles.total,
      filesProcessed: event.filesProcessed ?? lastFiles.processed,
      chunksCreated: event.chunksCreated ?? lastChunks.created,
      chunksTotal: event.chunksTotal ?? lastChunks.total,
      error: event.message,
      message: event.message,
      isWaiting: false,
    });
    updateRepo(repoFullName, { indexing: false });
  } else if (event.status === "done") {
    setStatus({
      status: "done",
      progress: 100,
      filesTotal: event.filesTotal ?? lastFiles.total,
      filesProcessed: event.filesProcessed ?? lastFiles.processed,
      chunksCreated: event.chunksCreated || 0,
      chunksTotal: event.chunksCreated || 0,
      message: "Ingestion complete!",
      isWaiting: false,
    });
    updateRepo(repoFullName, {
      indexed: true,
      indexing: false,
      chunk_count: event.chunksCreated || 0,
      last_synced_sha: event.lastSyncedSha || null,
      sync_blocked_reason: null,
      pending_sync_head_sha: null,
    });
    setTimeout(() => {
      useAppStore.getState().clearIngestionStatus(repoFullName);
    }, 5000);
  } else if (event.status === "error") {
    setStatus({
      status: "error",
      progress: 0,
      filesTotal: 0,
      filesProcessed: 0,
      chunksCreated: 0,
      chunksTotal: 0,
      error: event.message,
      message: event.message,
      isWaiting: false,
    });
    updateRepo(repoFullName, { indexing: false });
  }
}
