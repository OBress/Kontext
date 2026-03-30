import { createHash } from "crypto";

import { NextResponse } from "next/server";
import { createAdminClient, getAuthenticatedUser } from "@/lib/api/auth";
import { getApiErrorPayload, handleApiError, ApiError } from "@/lib/api/errors";
import { logActivity } from "@/lib/api/activity";
import { queueArchitectureRefresh } from "@/lib/api/architecture-refresh";
import { chunkFile } from "@/lib/api/chunker";
import { generateEmbeddings, generateFileSummary } from "@/lib/api/embeddings";
import { fetchFileContent, fetchLatestCommit, fetchRepoTree, fetchRecentCommits, type GitHubTreeItem } from "@/lib/api/github";
import { extractImports } from "@/lib/api/graph-builder";
import { getAiBlockedStatus } from "@/lib/api/gemini";
import { rateLimit } from "@/lib/api/rate-limit";
import { resolveRepoGitHubToken } from "@/lib/api/repo-auth";
import { validateApiKey, validateRepoFullName } from "@/lib/api/validate";
import { summarizeAndEmbedCommits } from "@/lib/api/timeline-ai";

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

function hashContent(content: string) {
  return createHash("sha256").update(content).digest("hex");
}

function serializeChunkRows(
  chunks: PreparedChunk[],
  embeddings: number[][]
) {
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

/**
 * POST /api/repos/ingest - Full ingestion pipeline with SSE progress.
 *
 * Reliability rule: the live index is only replaced after all embeddings are ready.
 */
export async function POST(request: Request) {
  try {
    const { user, supabase, githubToken } = await getAuthenticatedUser();

    const rl = rateLimit(user.id, "ingest");
    if (!rl.ok) {
      return NextResponse.json(
        { error: { code: "RATE_LIMITED", message: "Ingestion rate limited. Try again later." } },
        { status: 429 }
      );
    }

    const body = await request.json();
    const fullName = validateRepoFullName(body.repo_full_name);
    const apiKey = validateApiKey(request);
    const [owner, name] = fullName.split("/");

    const { data: repoSettings } = await supabase
      .from("repos")
      .select("understanding_tier, default_branch")
      .eq("user_id", user.id)
      .eq("full_name", fullName)
      .single();

    const defaultBranch = repoSettings?.default_branch || "main";
    const understandingTier = repoSettings?.understanding_tier || 2;
    const backfillTimeline = body.backfill_timeline !== false;
    const timelineCommitDepth = body.timeline_commit_depth || 50;
    const { token: effectiveToken } = await resolveRepoGitHubToken(
      supabase,
      user.id,
      fullName,
      githubToken
    );

    if (!effectiveToken) {
      throw new ApiError(
        401,
        "GITHUB_TOKEN_REQUIRED",
        "GitHub token not available. Please re-authenticate or provide an access token for this repository."
      );
    }

    const adminDb = await createAdminClient();

    const { data: job, error: jobError } = await supabase
      .from("ingestion_jobs")
      .insert({
        user_id: user.id,
        repo_full_name: fullName,
        status: "fetching",
        started_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (jobError || !job) {
      throw jobError || new Error("Failed to create ingestion job");
    }

    await adminDb
      .from("repos")
      .update({
        indexing: true,
      })
      .eq("user_id", user.id)
      .eq("full_name", fullName);

    const encoder = new TextEncoder();
    const abortSignal = request.signal;
    const stream = new ReadableStream({
      async start(controller) {
        let streamClosed = false;

        const closeStream = () => {
          if (!streamClosed) {
            streamClosed = true;
            try {
              controller.close();
            } catch {
              // Already closed by runtime — safe to ignore.
            }
          }
        };

        // If the client disconnects, mark the stream as closed so we
        // stop trying to enqueue data. The pipeline itself continues
        // so the index is still built, we just can't report progress.
        abortSignal?.addEventListener("abort", () => {
          closeStream();
        });

        const send = (data: Record<string, unknown>) => {
          if (streamClosed) return;
          try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
          } catch {
            // Controller was closed between our check and the enqueue — race-safe.
            streamClosed = true;
          }
        };

        try {
          send({ status: "fetching", message: "Fetching repository tree..." });
          const tree = await fetchRepoTree(effectiveToken, owner, name, defaultBranch);
          const filesTotal = tree.length;

          await supabase
            .from("ingestion_jobs")
            .update({ status: "chunking", files_total: filesTotal })
            .eq("id", job.id);

          const fileRecords: PreparedFileRecord[] = [];
          const preparedChunks: PreparedChunk[] = [];
          let filesProcessed = 0;

          const concurrencyLimit = understandingTier === 3 ? 3 : 6;
          const fileResults = await mapWithConcurrency(
            tree,
            concurrencyLimit,
            async (file) => {
              const content = await fetchFileContent(
                effectiveToken,
                owner,
                name,
                file.path,
                defaultBranch
              );

              let record: PreparedFileRecord | null = null;
              const chunks: PreparedChunk[] = [];

              if (content) {
                const extension = file.path.split(".").pop() || "";
                const lines = content.split("\n").length;
                const imports = extractImports(content);

                record = {
                  file_path: file.path,
                  file_name: file.path.split("/").pop() || file.path,
                  extension,
                  line_count: lines,
                  size_bytes: content.length,
                  content_hash: hashContent(content),
                  imports,
                };

                const fileChunks = chunkFile(content, file.path);

                // Tier 3: generate LLM file summary for each file
                const llmSummary =
                  understandingTier === 3
                    ? await generateFileSummary(apiKey, file.path, content).catch(() => null)
                    : null;

                for (const chunk of fileChunks) {
                  chunks.push({
                    file_path: file.path,
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
              if (filesProcessed % 5 === 0 || filesProcessed === filesTotal) {
                send({
                  status: "chunking",
                  filesTotal,
                  filesProcessed,
                  chunksCreated: preparedChunks.length + chunks.length,
                });
              }

              return { record, chunks };
            }
          );

          for (const result of fileResults) {
            if (result.record) fileRecords.push(result.record);
            preparedChunks.push(...result.chunks);
          }

          await supabase
            .from("ingestion_jobs")
            .update({
              status: "embedding",
              files_processed: tree.length,
            })
            .eq("id", job.id);

          // Context carried by every embedding SSE event so the
          // client always has accurate file/chunk counts
          const embedContext = {
            filesTotal: tree.length,
            filesProcessed: tree.length,
            chunksTotal: preparedChunks.length,
          };

          send({
            status: "embedding",
            ...embedContext,
            message: `Embedding ${preparedChunks.length} chunks...`,
          });

          const embedStartMs = Date.now();

          const embeddings = await generateEmbeddings(
            apiKey,
            preparedChunks.map((chunk) => chunk.content),
            "RETRIEVAL_DOCUMENT",
            {
              onBatchComplete: (completed, total) => {
                send({
                  status: "embedding",
                  ...embedContext,
                  chunksEmbedded: completed,
                  elapsedMs: Date.now() - embedStartMs,
                  isWaiting: false,
                });
              },
              onRetry: (message) => {
                send({
                  status: "embedding",
                  ...embedContext,
                  message,
                  isWaiting: true,
                });
              },
            }
          );

          await supabase
            .from("ingestion_jobs")
            .update({ status: "finalizing" })
            .eq("id", job.id);

          send({ status: "finalizing", message: "Promoting the new index..." });

          let headSHA: string | null = null;
          try {
            const latestCommit = await fetchLatestCommit(
              effectiveToken,
              owner,
              name,
              defaultBranch
            );
            headSHA = latestCommit.sha;
          } catch {
            // Non-fatal: the repo can still be indexed, it just won't be sync-ready yet.
          }

          const promotedAt = new Date().toISOString();
          const serializedChunks = serializeChunkRows(preparedChunks, embeddings);

          // ── Batched index promotion ──────────────────────────────
          // Optimized for Supabase free tier statement timeout (~60s):
          // - Skip DELETE on first ingestion (no old data to clear)
          // - Small batch sizes to keep each INSERT under the timeout
          // - Batch DELETE operations to avoid single massive scans

          // Check if this is a re-index (has existing data)
          const { data: existingRepo } = await adminDb
            .from("repos")
            .select("chunk_count")
            .eq("user_id", user.id)
            .eq("full_name", fullName)
            .single();

          const hasExistingIndex = (existingRepo?.chunk_count || 0) > 0;

          // 1. Delete old chunks and files (skip on first ingestion)
          if (hasExistingIndex) {
            send({ status: "finalizing", message: "Clearing old index..." });

            // Batch delete chunks to stay under statement timeout
            const DELETE_BATCH_SIZE = 500;
            let deletedCount = 0;
            while (true) {
              const { data: toDelete } = await adminDb
                .from("repo_chunks")
                .select("id")
                .eq("user_id", user.id)
                .eq("repo_full_name", fullName)
                .limit(DELETE_BATCH_SIZE);

              if (!toDelete || toDelete.length === 0) break;

              const ids = toDelete.map((r: { id: number }) => r.id);
              await adminDb
                .from("repo_chunks")
                .delete()
                .in("id", ids);

              deletedCount += ids.length;
              send({
                status: "finalizing",
                message: `Clearing old chunks (${deletedCount} removed)...`,
              });
            }

            await adminDb
              .from("repo_files")
              .delete()
              .eq("user_id", user.id)
              .eq("repo_full_name", fullName);
          }

          // 2. Insert files (usually small, single batch is fine)
          if (fileRecords.length > 0) {
            const fileRows = fileRecords.map((f) => ({
              user_id: user.id,
              repo_full_name: fullName,
              ...f,
            }));
            const FILE_BATCH_SIZE = 200;
            for (let i = 0; i < fileRows.length; i += FILE_BATCH_SIZE) {
              const batch = fileRows.slice(i, i + FILE_BATCH_SIZE);
              const { error: fileErr } = await adminDb
                .from("repo_files")
                .insert(batch);
              if (fileErr) throw fileErr;
            }
          }

          // 3. Insert chunks in small batches (50 rows each to stay
          //    under the free tier statement timeout with vector data)
          const CHUNK_BATCH_SIZE = 50;
          const totalChunkBatches = Math.ceil(serializedChunks.length / CHUNK_BATCH_SIZE);
          for (let i = 0; i < serializedChunks.length; i += CHUNK_BATCH_SIZE) {
            const batch = serializedChunks.slice(i, i + CHUNK_BATCH_SIZE).map((c) => ({
              user_id: user.id,
              repo_full_name: fullName,
              file_path: c.file_path,
              chunk_index: c.chunk_index,
              content: c.content,
              token_count: c.token_count,
              embedding: c.embedding,
              metadata: c.metadata,
            }));

            const { error: chunkErr } = await adminDb
              .from("repo_chunks")
              .insert(batch);
            if (chunkErr) throw chunkErr;

            const batchNum = Math.floor(i / CHUNK_BATCH_SIZE) + 1;
            send({
              status: "finalizing",
              message: `Writing chunks to database (${batchNum}/${totalChunkBatches})...`,
            });
          }

          // 4. Update repo record
          const { error: repoUpdateError } = await adminDb
            .from("repos")
            .update({
              indexed: true,
              indexing: false,
              chunk_count: preparedChunks.length,
              last_indexed_at: promotedAt,
              last_synced_sha: headSHA,
              watched_branch: defaultBranch,
              sync_blocked_reason: null,
              pending_sync_head_sha: null,
              updated_at: new Date().toISOString(),
            })
            .eq("user_id", user.id)
            .eq("full_name", fullName);

          if (repoUpdateError) {
            throw repoUpdateError;
          }

          if (headSHA && backfillTimeline) {
            await supabase
              .from("ingestion_jobs")
              .update({ status: "timeline" })
              .eq("id", job.id);

            send({ status: "timeline", message: "Backfilling commit history..." });

            try {
              // Fetch actual commit history from GitHub
              const historicalCommits = await fetchRecentCommits(
                effectiveToken,
                owner,
                name,
                defaultBranch,
                timelineCommitDepth
              ).catch(() => []);

              const commitRows = [
                // Historical commits — each gets its own group so they
                // appear as individual items on the timeline
                ...historicalCommits.map((c) => ({
                  user_id: user.id,
                  repo_full_name: fullName,
                  sha: c.sha,
                  message: c.commit.message,
                  author_name: c.author?.login || c.commit.author.name,
                  author_avatar_url: c.author?.avatar_url || null,
                  committed_at: c.commit.author.date,
                  sync_triggered: false,
                  push_group_id: null as string | null,
                  files_changed: [] as { path: string; status: string }[],
                })),
              ];

              for (let idx = 0; idx < commitRows.length; idx += 50) {
                const batch = commitRows.slice(idx, idx + 50);
                await adminDb
                  .from("repo_commits")
                  .upsert(batch, {
                    onConflict: "user_id,repo_full_name,sha",
                    ignoreDuplicates: true,
                  });
              }

              if (commitRows.length > 0) {
                // Process commit summaries in capped batches to avoid
                // stacking API calls on top of chunk embeddings
                const COMMIT_SUMMARY_BATCH = 15;
                send({ status: "timeline", message: `Summarizing ${commitRows.length} historical commits...` });
                try {
                  for (let batchStart = 0; batchStart < commitRows.length; batchStart += COMMIT_SUMMARY_BATCH) {
                    const batchEnd = Math.min(batchStart + COMMIT_SUMMARY_BATCH, commitRows.length);
                    const commitBatch = commitRows.slice(batchStart, batchEnd);

                    const { summaries, embeddings: commitEmbeddings } = await summarizeAndEmbedCommits(
                      apiKey,
                      commitBatch.map((c) => ({
                        sha: c.sha,
                        message: c.message,
                        files_changed: c.files_changed,
                      }))
                    );
                    for (let i = 0; i < commitBatch.length; i++) {
                      await adminDb
                        .from("repo_commits")
                        .update({
                          ai_summary: summaries[i],
                          ai_summary_embedding: JSON.stringify(commitEmbeddings[i]),
                        })
                        .eq("user_id", user.id)
                        .eq("repo_full_name", fullName)
                        .eq("sha", commitBatch[i].sha);
                    }

                    // Delay between batches to ease API pressure
                    if (batchEnd < commitRows.length) {
                      send({ status: "timeline", message: `Summarized ${batchEnd}/${commitRows.length} commits...` });
                      await new Promise((r) => setTimeout(r, 2000));
                    }
                  }
                } catch (aiErr) {
                  console.warn("[ingest] AI commit summary generation failed (non-fatal):", aiErr);
                  // Non-fatal: commits are already stored, summaries can be backfilled later
                }
              }
            } catch (timelineError) {
              console.warn("[ingest] Commit backfill failed:", timelineError);
            }
          }

          await supabase
            .from("ingestion_jobs")
            .update({
              status: "done",
              chunks_created: preparedChunks.length,
              files_processed: tree.length,
              completed_at: new Date().toISOString(),
            })
            .eq("id", job.id);

          logActivity({
            userId: user.id,
            repoFullName: fullName,
            source: "kontext",
            eventType: "repo_indexed",
            title: `${fullName} was indexed`,
            description: `${preparedChunks.length} chunks from ${tree.length} files`,
            metadata: { chunks: preparedChunks.length, files: tree.length },
          });

          await queueArchitectureRefresh({
            userId: user.id,
            repoFullName: fullName,
            apiKey,
            sourceSha: headSHA,
          });

          send({
            status: "done",
            filesTotal: tree.length,
            filesProcessed: tree.length,
            chunksCreated: preparedChunks.length,
            lastSyncedSha: headSHA,
          });
        } catch (error: unknown) {
          console.error(`[ingest] Pipeline failed for ${fullName}:`, error);
          const payload = getApiErrorPayload(error);
          const blockedStatus = getAiBlockedStatus(payload.code);
          const failureStatus = blockedStatus || "error";

          send({
            status: failureStatus,
            message: payload.message,
            error: payload,
          });

          await supabase
            .from("ingestion_jobs")
            .update({
              status: failureStatus,
              error_message: payload.message,
              completed_at: new Date().toISOString(),
            })
            .eq("id", job.id);

          await adminDb
            .from("repos")
            .update({ indexing: false })
            .eq("user_id", user.id)
            .eq("full_name", fullName);
        }

        closeStream();
      },
    });

    return new NextResponse(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
