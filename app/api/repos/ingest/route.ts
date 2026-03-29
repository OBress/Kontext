import { createHash } from "crypto";

import { NextResponse } from "next/server";
import { createAdminClient, getAuthenticatedUser } from "@/lib/api/auth";
import { getApiErrorPayload, handleApiError, ApiError } from "@/lib/api/errors";
import { logActivity } from "@/lib/api/activity";
import { queueArchitectureRefresh } from "@/lib/api/architecture-refresh";
import { chunkFile } from "@/lib/api/chunker";
import { generateEmbeddings, generateFileSummary } from "@/lib/api/embeddings";
import { fetchFileContent, fetchLatestCommit, fetchRepoTree, fetchRecentCommits } from "@/lib/api/github";
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
    const stream = new ReadableStream({
      async start(controller) {
        const send = (data: Record<string, unknown>) => {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
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

          for (let index = 0; index < tree.length; index += 1) {
            const file = tree[index];
            const content = await fetchFileContent(
              effectiveToken,
              owner,
              name,
              file.path,
              defaultBranch
            );

            if (content) {
              const extension = file.path.split(".").pop() || "";
              const lines = content.split("\n").length;
              const imports = extractImports(content);

              fileRecords.push({
                file_path: file.path,
                file_name: file.path.split("/").pop() || file.path,
                extension,
                line_count: lines,
                size_bytes: content.length,
                content_hash: hashContent(content),
                imports,
              });

              const chunks = chunkFile(content, file.path);

              // Tier 3: generate LLM file summary for each file
              const llmSummary =
                understandingTier === 3
                  ? await generateFileSummary(apiKey, file.path, content).catch(() => null)
                  : null;

              for (const chunk of chunks) {
                preparedChunks.push({
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

            if ((index + 1) % 5 === 0 || index === tree.length - 1) {
              send({
                status: "chunking",
                filesTotal,
                filesProcessed: index + 1,
                chunksCreated: preparedChunks.length,
              });
            }
          }

          await supabase
            .from("ingestion_jobs")
            .update({
              status: "embedding",
              files_processed: tree.length,
            })
            .eq("id", job.id);

          send({
            status: "embedding",
            message: `Embedding ${preparedChunks.length} chunks...`,
            chunksTotal: preparedChunks.length,
          });

          const embeddings = await generateEmbeddings(
            apiKey,
            preparedChunks.map((chunk) => chunk.content),
            "RETRIEVAL_DOCUMENT",
            {
              onBatchComplete: (completed, total) => {
                send({
                  status: "embedding",
                  chunksEmbedded: completed,
                  chunksTotal: total,
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

          const { error: promoteError } = await adminDb.rpc("replace_repo_index", {
            p_user_id: user.id,
            p_repo_full_name: fullName,
            p_files: fileRecords,
            p_chunks: serializedChunks,
            p_chunk_count: preparedChunks.length,
            p_last_indexed_at: promotedAt,
            p_last_synced_sha: headSHA,
            p_watched_branch: defaultBranch,
            p_indexed: true,
            p_indexing: false,
            p_sync_blocked_reason: null,
            p_pending_sync_head_sha: null,
          });

          if (promoteError) {
            throw promoteError;
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
                send({ status: "timeline", message: `Summarizing ${commitRows.length} historical commits...` });
                try {
                  const { summaries, embeddings } = await summarizeAndEmbedCommits(
                    apiKey,
                    commitRows.map((c) => ({
                      sha: c.sha,
                      message: c.message,
                      files_changed: c.files_changed,
                    }))
                  );
                  for (let i = 0; i < commitRows.length; i++) {
                    await adminDb
                      .from("repo_commits")
                      .update({
                        ai_summary: summaries[i],
                        ai_summary_embedding: JSON.stringify(embeddings[i]),
                      })
                      .eq("user_id", user.id)
                      .eq("repo_full_name", fullName)
                      .eq("sha", commitRows[i].sha);
                  }
                } catch (aiErr) {
                  console.warn("[ingest] AI summary generation failed:", aiErr);
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

        controller.close();
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
