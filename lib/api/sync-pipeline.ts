/**
 * Extracted sync pipeline logic.
 *
 * Contains the core incremental-sync work (diff, chunk, embed, promote)
 * separated from HTTP/SSE concerns so it can be called by:
 *   - The SSE HTTP route (manual / frontend syncs)
 *   - The sync queue (webhook / poll background syncs)
 */

import { createHash } from "crypto";
import { TaskType } from "@google/generative-ai";
import { createAdminClient } from "@/lib/api/auth";
import { resolveAiKey } from "@/lib/api/ai-key";
import { refreshArchitectureBundle } from "@/lib/api/architecture-refresh";
import { getApiErrorPayload } from "@/lib/api/errors";
import { logActivity } from "@/lib/api/activity";
import { chunkFile } from "@/lib/api/chunker";
import { generateEmbeddings, generateFileSummary } from "@/lib/api/embeddings";
import {
  fetchChangedFiles,
  fetchCommitsSince,
  fetchFileContent,
  fetchLatestCommit,
  shouldIndexFile,
} from "@/lib/api/github";
import { extractImports } from "@/lib/api/graph-builder";
import { getAiBlockedStatus } from "@/lib/api/gemini";
import { runRepoChecks } from "@/lib/api/repo-checks";
import { resolveRepoGitHubToken } from "@/lib/api/repo-auth";
import { summarizeAndEmbedCommits } from "@/lib/api/timeline-ai";
import { enqueueAiTask } from "@/lib/api/sync-queue";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface SyncPipelineParams {
  userId: string;
  repoFullName: string;
  apiKey: string | null;
  githubToken: string;
  repo: {
    last_synced_sha: string;
    watched_branch: string | null;
    default_branch: string | null;
    understanding_tier: number | null;
    sync_blocked_reason: string | null;
    pending_sync_head_sha: string | null;
  };
  targetHeadSHA: string | null;
  isWebhookTriggered: boolean;
  onProgress?: (data: Record<string, unknown>) => void;
}

export interface SyncPipelineResult {
  status: "done" | "up_to_date" | "pending_user_key_sync" | "error";
  message: string;
  filesChanged: number;
  commitsTracked: number;
  lastSyncedSha: string | null;
  pendingHeadSha?: string | null;
  newChunkCount?: number;
}

interface PreparedFileRecord {
  file_path: string;
  file_name: string;
  extension: string;
  line_count: number;
  size_bytes: number;
  content_hash: string;
  imports: string[];
}

interface PreparedChunk {
  file_path: string;
  chunk_index: number;
  content: string;
  token_count: number;
  metadata: Record<string, unknown>;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function hashContent(content: string) {
  return createHash("sha256").update(content).digest("hex");
}

function serializeChunkRows(chunks: PreparedChunk[], embeddings: number[][]) {
  return chunks.map((chunk, index) => ({
    file_path: chunk.file_path,
    chunk_index: chunk.chunk_index,
    content: chunk.content,
    token_count: chunk.token_count,
    embedding: JSON.stringify(embeddings[index]),
    metadata: chunk.metadata,
  }));
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function runWorker() {
    while (true) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      if (currentIndex >= items.length) return;
      results[currentIndex] = await worker(items[currentIndex], currentIndex);
    }
  }

  const workerCount = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: workerCount }, () => runWorker()));
  return results;
}

/* ------------------------------------------------------------------ */
/*  Core Pipeline                                                      */
/* ------------------------------------------------------------------ */

/**
 * Run the incremental sync pipeline. Returns a result and calls
 * `onProgress` for intermediate status updates (used by SSE routes).
 */
export async function runSyncPipeline(
  params: SyncPipelineParams
): Promise<SyncPipelineResult> {
  const {
    userId,
    repoFullName,
    apiKey,
    githubToken: effectiveToken,
    repo,
    isWebhookTriggered,
  } = params;

  const [owner, name] = repoFullName.split("/");
  const branch = repo.watched_branch || repo.default_branch || "main";
  const understandingTier = repo.understanding_tier || 2;
  const adminDb = await createAdminClient();
  const send = params.onProgress || (() => {});

  let targetHeadSHA = params.targetHeadSHA;

  try {
    send({ status: "checking", message: "Checking for changes..." });

    if (!targetHeadSHA) {
      const latest = await fetchLatestCommit(effectiveToken, owner, name, branch);
      targetHeadSHA = latest.sha;
    }

    if (targetHeadSHA === repo.last_synced_sha) {
      if (repo.sync_blocked_reason || repo.pending_sync_head_sha) {
        await adminDb
          .from("repos")
          .update({ sync_blocked_reason: null, pending_sync_head_sha: null })
          .eq("user_id", userId)
          .eq("full_name", repoFullName);
      }

      const result: SyncPipelineResult = {
        status: "up_to_date",
        message: "Already up to date.",
        filesChanged: 0,
        commitsTracked: 0,
        lastSyncedSha: repo.last_synced_sha,
      };
      send({ ...result, status: "done" });
      return result;
    }

    const activeApiKey = apiKey;

    if (!activeApiKey) {
      await adminDb
        .from("repos")
        .update({
          sync_blocked_reason: "pending_user_key_sync",
          pending_sync_head_sha: targetHeadSHA,
        })
        .eq("user_id", userId)
        .eq("full_name", repoFullName);

      const result: SyncPipelineResult = {
        status: "pending_user_key_sync",
        message:
          "A repository update is waiting for your Google AI key. Re-open Kontext with your key and run sync to refresh the index safely.",
        filesChanged: 0,
        commitsTracked: 0,
        lastSyncedSha: repo.last_synced_sha,
        pendingHeadSha: targetHeadSHA,
      };
      send({ ...result, status: "pending_user_key_sync" });
      return result;
    }

    // Fetch changed files
    send({ status: "fetching", message: "Fetching changed files..." });

    const { files: changedFiles } = await fetchChangedFiles(
      effectiveToken,
      owner,
      name,
      repo.last_synced_sha,
      targetHeadSHA
    );

    const indexableFiles = changedFiles.filter(
      (file) =>
        shouldIndexFile(file.filename) ||
        (file.previous_filename ? shouldIndexFile(file.previous_filename) : false)
    );

    send({
      status: "fetching",
      message: `Found ${indexableFiles.length} changed files`,
      filesChanged: indexableFiles.length,
    });

    const filesToRemove = Array.from(
      new Set(
        indexableFiles.flatMap((file) => {
          const paths = [file.filename];
          if (file.previous_filename) paths.push(file.previous_filename);
          return paths;
        })
      )
    );

    const addedOrModified = indexableFiles.filter((file) => file.status !== "removed");
    const preparedChunks: PreparedChunk[] = [];
    const fileRecords: PreparedFileRecord[] = [];

    if (addedOrModified.length > 0) {
      send({
        status: "chunking",
        message: `Preparing ${addedOrModified.length} changed files...`,
      });
      let filesProcessed = 0;
      let chunksCreated = 0;

      const preparedResults = await mapWithConcurrency(
        addedOrModified,
        understandingTier === 3 ? 3 : 6,
        async (file) => {
          const content = await fetchFileContent(
            effectiveToken,
            owner,
            name,
            file.filename,
            targetHeadSHA || undefined
          );

          let nextFileRecord: PreparedFileRecord | null = null;
          const nextChunks: PreparedChunk[] = [];

          if (content) {
            const extension = file.filename.split(".").pop() || "";
            const lines = content.split("\n").length;
            const imports = extractImports(content);

            nextFileRecord = {
              file_path: file.filename,
              file_name: file.filename.split("/").pop() || file.filename,
              extension,
              line_count: lines,
              size_bytes: content.length,
              content_hash: hashContent(content),
              imports,
            };

            const llmSummary =
              understandingTier === 3
                ? await generateFileSummary(activeApiKey, file.filename, content).catch(
                    () => null
                  )
                : null;

            const chunks = chunkFile(content, file.filename);
            for (const chunk of chunks) {
              nextChunks.push({
                file_path: file.filename,
                chunk_index: chunk.chunkIndex,
                content: chunk.content,
                token_count: chunk.tokenCount,
                metadata: {
                  ...chunk.metadata,
                  ...(llmSummary ? { llm_summary: llmSummary } : {}),
                },
              });
            }
          }

          filesProcessed += 1;
          chunksCreated += nextChunks.length;
          send({
            status: "chunking",
            filesProcessed,
            filesTotal: addedOrModified.length,
            chunksCreated,
          });

          return { nextFileRecord, nextChunks };
        }
      );

      for (const result of preparedResults) {
        if (result.nextFileRecord) fileRecords.push(result.nextFileRecord);
        preparedChunks.push(...result.nextChunks);
      }
    }

    // Embeddings
    let serializedChunks: Array<Record<string, unknown>> = [];
    if (preparedChunks.length > 0) {
      send({
        status: "embedding",
        message: `Embedding ${preparedChunks.length} chunks...`,
        chunksTotal: preparedChunks.length,
      });

      const embeddings = await generateEmbeddings(
        activeApiKey,
        preparedChunks.map((chunk) => chunk.content),
        TaskType.RETRIEVAL_DOCUMENT,
        {
          onBatchComplete: (completed, total) => {
            send({ status: "embedding", chunksEmbedded: completed, chunksTotal: total });
          },
        }
      );

      serializedChunks = serializeChunkRows(preparedChunks, embeddings);
    }

    // Atomic promotion
    send({ status: "finalizing", message: "Promoting changed files..." });

    const promotedAt = new Date().toISOString();
    const { error: replaceError } = await adminDb.rpc("replace_repo_paths", {
      p_user_id: userId,
      p_repo_full_name: repoFullName,
      p_remove_paths: filesToRemove,
      p_files: fileRecords,
      p_chunks: serializedChunks,
      p_last_synced_sha: targetHeadSHA,
      p_last_indexed_at: promotedAt,
      p_chunk_count: null,
      p_sync_blocked_reason: null,
      p_pending_sync_head_sha: null,
    });

    if (replaceError) throw replaceError;

    // Timeline
    send({ status: "timeline", message: "Updating development timeline..." });
    const newCommits = await fetchCommitsSince(
      effectiveToken,
      owner,
      name,
      branch,
      repo.last_synced_sha
    );

    let commitsTracked = 0;

    if (newCommits.length > 0) {
      const syncGroupId = `sync-${Date.now()}`;
      const commitRows = newCommits.map((commit) => ({
        user_id: userId,
        repo_full_name: repoFullName,
        sha: commit.sha,
        message: commit.commit.message,
        author_name: commit.author?.login || commit.commit.author.name,
        author_avatar_url: commit.author?.avatar_url || null,
        committed_at: commit.commit.author.date,
        files_changed: changedFiles.map((file) => ({
          path: file.filename,
          status: file.status,
          additions: file.additions,
          deletions: file.deletions,
        })),
        sync_triggered: true,
        push_group_id: syncGroupId,
      }));

      for (let index = 0; index < commitRows.length; index += 50) {
        const batch = commitRows.slice(index, index + 50);
        await adminDb.from("repo_commits").upsert(batch, {
          onConflict: "user_id,repo_full_name,sha",
          ignoreDuplicates: true,
        });
      }

      if (activeApiKey) {
        send({
          status: "timeline",
          message: `Summarizing ${newCommits.length} commits...`,
        });
        try {
          const commitsForAi = commitRows.map((r) => ({
            sha: r.sha,
            message: r.message,
            files_changed: r.files_changed,
          }));
          const { summaries, embeddings } = await summarizeAndEmbedCommits(
            activeApiKey,
            commitsForAi
          );
          for (let i = 0; i < commitRows.length; i++) {
            await adminDb
              .from("repo_commits")
              .update({
                ai_summary: summaries[i],
                ai_summary_embedding: JSON.stringify(embeddings[i]),
              })
              .eq("user_id", userId)
              .eq("repo_full_name", repoFullName)
              .eq("sha", commitRows[i].sha);
          }
        } catch (aiErr) {
          console.warn("[sync] AI summary generation failed:", aiErr);
        }
      }

      commitsTracked = newCommits.length;
    }

    const { count: chunkCount } = await adminDb
      .from("repo_chunks")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("repo_full_name", repoFullName);

    // Activity log
    if (indexableFiles.length > 0 || newCommits.length > 0) {
      logActivity({
        userId,
        repoFullName,
        source: "kontext",
        eventType: "repo_synced",
        title: `${repoFullName} synced to ${branch}`,
        description: `${indexableFiles.length} file${indexableFiles.length === 1 ? "" : "s"} refreshed from ${newCommits.length} commit${newCommits.length === 1 ? "" : "s"}`,
        metadata: {
          branch,
          head_sha: targetHeadSHA,
          files_changed: indexableFiles.length,
          commits_tracked: newCommits.length,
          webhook_triggered: isWebhookTriggered,
        },
      });
    }

    // Post-sync AI jobs — via the queue for concurrency control
    enqueueAiTask({
      userId,
      repoFullName,
      taskId: `arch-refresh:${targetHeadSHA}`,
      execute: () =>
        refreshArchitectureBundle({
          userId,
          repoFullName,
          apiKey: activeApiKey,
          sourceSha: targetHeadSHA,
        }),
    });

    if (targetHeadSHA && (indexableFiles.length > 0 || newCommits.length > 0)) {
      enqueueAiTask({
        userId,
        repoFullName,
        taskId: `repo-check:${targetHeadSHA}`,
        execute: () =>
          runRepoChecks({
            supabase: adminDb,
            userId,
            repoFullName,
            apiKey: activeApiKey,
            triggerMode: "after_sync",
            headSha: targetHeadSHA,
            baseSha: repo.last_synced_sha,
            changedFiles: changedFiles.map((file) => ({
              filename: file.filename,
              status: file.status,
              additions: file.additions,
              deletions: file.deletions,
              previous_filename: file.previous_filename,
            })),
          }),
      });
    }

    const result: SyncPipelineResult = {
      status: "done",
      message: `Synced ${indexableFiles.length} files, ${commitsTracked} commits`,
      filesChanged: indexableFiles.length,
      commitsTracked,
      lastSyncedSha: targetHeadSHA,
      newChunkCount: chunkCount || 0,
    };
    send({ ...result, status: "done" });
    return result;
  } catch (error: unknown) {
    const payload = getApiErrorPayload(error);
    const blockedStatus = getAiBlockedStatus(payload.code);

    if (blockedStatus) {
      await adminDb
        .from("repos")
        .update({
          sync_blocked_reason: blockedStatus,
          pending_sync_head_sha: targetHeadSHA,
        })
        .eq("user_id", userId)
        .eq("full_name", repoFullName);
    }

    const failureStatus = blockedStatus || "error";
    send({
      status: failureStatus,
      message: payload.message,
      error: payload,
      pendingHeadSha: targetHeadSHA,
    });

    return {
      status: "error",
      message: payload.message,
      filesChanged: 0,
      commitsTracked: 0,
      lastSyncedSha: repo.last_synced_sha,
      pendingHeadSha: targetHeadSHA,
    };
  }
}

/* ------------------------------------------------------------------ */
/*  Background Sync Helper                                             */
/* ------------------------------------------------------------------ */

/**
 * Execute a background sync with full auth resolution.
 * Used by the sync queue for webhook/poll-triggered syncs.
 */
export async function executeBackgroundSync(params: {
  userId: string;
  repoFullName: string;
  headSHA: string;
  trigger: string;
}): Promise<void> {
  const { userId, repoFullName, headSHA } = params;
  const adminDb = await createAdminClient();

  // Resolve GitHub token
  const { data: tokenRow } = await adminDb
    .from("user_tokens")
    .select("encrypted_token, token_iv, token_tag")
    .eq("user_id", userId)
    .single();

  let fallbackGitHubToken: string | null = null;
  if (tokenRow) {
    const { decryptToken } = await import("@/lib/api/crypto");
    fallbackGitHubToken = decryptToken({
      ciphertext: tokenRow.encrypted_token,
      iv: tokenRow.token_iv,
      tag: tokenRow.token_tag,
    });
  }

  const apiKey = await resolveAiKey(userId);

  // Look up repo
  const { data: repo } = await adminDb
    .from("repos")
    .select(
      "id, indexed, last_synced_sha, watched_branch, default_branch, understanding_tier, pending_sync_head_sha, sync_blocked_reason"
    )
    .eq("user_id", userId)
    .eq("full_name", repoFullName)
    .single();

  if (!repo || !repo.indexed || !repo.last_synced_sha) {
    console.warn(
      `[sync-pipeline] Skipping background sync for ${repoFullName}: not indexed`
    );
    return;
  }

  // Skip if already at this SHA
  if (headSHA === repo.last_synced_sha) {
    console.log(
      `[sync-pipeline] ${repoFullName} already at ${headSHA.slice(0, 7)}, skipping`
    );
    return;
  }

  const { token: effectiveToken } = await resolveRepoGitHubToken(
    adminDb,
    userId,
    repoFullName,
    fallbackGitHubToken
  );

  if (!effectiveToken) {
    console.warn(
      `[sync-pipeline] No GitHub token available for ${repoFullName}, skipping`
    );
    return;
  }

  await runSyncPipeline({
    userId,
    repoFullName,
    apiKey,
    githubToken: effectiveToken,
    repo: {
      last_synced_sha: repo.last_synced_sha,
      watched_branch: repo.watched_branch,
      default_branch: repo.default_branch,
      understanding_tier: repo.understanding_tier,
      sync_blocked_reason: repo.sync_blocked_reason,
      pending_sync_head_sha: repo.pending_sync_head_sha,
    },
    targetHeadSHA: headSHA,
    isWebhookTriggered: true,
    onProgress: (data) => {
      console.log(
        `[sync-pipeline] ${repoFullName}: ${data.status}${data.message ? ` — ${data.message}` : ""}`
      );
    },
  });
}
