import { NextResponse } from "next/server";
import { getAuthenticatedUser, createAdminClient } from "@/lib/api/auth";
import { handleApiError, ApiError } from "@/lib/api/errors";
import { validateRepoFullName, validateApiKey } from "@/lib/api/validate";
import {
  fetchChangedFiles,
  fetchFileContent,
  fetchLatestCommit,
  fetchCommitsSince,
  shouldIndexFile,
} from "@/lib/api/github";
import { chunkFile } from "@/lib/api/chunker";
import { generateEmbeddings, generateFileSummary } from "@/lib/api/embeddings";
import { extractImports } from "@/lib/api/graph-builder";
import { TaskType } from "@google/generative-ai";

/**
 * POST /api/repos/sync — Incremental sync pipeline with SSE progress
 *
 * Only re-processes files that changed since last_synced_sha.
 * Supports both manual (user-triggered) and webhook-triggered invocations.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const fullName = validateRepoFullName(body.repo_full_name);
    const [owner, name] = fullName.split("/");

    // Webhook-triggered calls pass user_id directly
    const isWebhookTriggered = body.webhook_triggered === true;

    let userId: string;
    let githubToken: string;
    let apiKey: string;
    const adminDb = await createAdminClient();

    if (isWebhookTriggered) {
      // Server-to-server call from webhook handler
      userId = body.user_id;
      if (!userId) {
        return NextResponse.json({ error: "user_id required for webhook sync" }, { status: 400 });
      }

      // Fetch tokens from DB
      const { data: tokenRow } = await adminDb
        .from("user_tokens")
        .select("encrypted_token, token_iv, token_tag")
        .eq("user_id", userId)
        .single();

      if (!tokenRow) {
        return NextResponse.json({ error: "No GitHub token for user" }, { status: 401 });
      }

      // Decrypt GitHub token
      const { decryptToken } = await import("@/lib/api/crypto");
      githubToken = decryptToken({
        ciphertext: tokenRow.encrypted_token,
        iv: tokenRow.token_iv,
        tag: tokenRow.token_tag,
      });

      // For webhook, we need the user's stored API key — not available.
      // We'll skip embedding for webhook-triggered syncs if no API key is provided.
      // In production, you'd store this or use a service API key.
      apiKey = body.api_key || "";
    } else {
      // User-triggered call
      const auth = await getAuthenticatedUser();
      userId = auth.user.id;
      githubToken = auth.githubToken!;
      apiKey = validateApiKey(request);

      if (!githubToken) {
        throw new ApiError(401, "GITHUB_TOKEN_REQUIRED", "GitHub token not available.");
      }
    }

    // Get repo state
    const { data: repo } = await adminDb
      .from("repos")
      .select("id, last_synced_sha, watched_branch, understanding_tier, indexed")
      .eq("user_id", userId)
      .eq("full_name", fullName)
      .single();

    if (!repo) {
      return NextResponse.json({ error: "Repo not found" }, { status: 404 });
    }

    if (!repo.last_synced_sha || !repo.indexed) {
      return NextResponse.json(
        { error: "Repo has not been fully ingested yet. Run full ingestion first." },
        { status: 400 }
      );
    }

    const branch = repo.watched_branch || "main";
    const understandingTier = repo.understanding_tier || 2;

    // For webhook-triggered without API key, we can only track commits, not re-embed
    const canEmbed = !!apiKey;

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const send = (data: Record<string, unknown>) => {
          try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
          } catch {
            // Controller might be closed
          }
        };

        try {
          // 1. Detect changes
          send({ status: "checking", message: "Checking for changes..." });

          const latest = await fetchLatestCommit(githubToken, owner, name, branch);
          const headSHA = body.head_sha || latest.sha;

          if (headSHA === repo.last_synced_sha) {
            send({ status: "done", message: "Already up to date.", filesChanged: 0 });
            controller.close();
            return;
          }

          // 2. Get changed files
          send({ status: "fetching", message: "Fetching changed files..." });

          const { files: changedFiles } = await fetchChangedFiles(
            githubToken, owner, name, repo.last_synced_sha!, headSHA
          );

          // Filter to indexable files only
          const indexableFiles = changedFiles.filter((f) => shouldIndexFile(f.filename));

          send({
            status: "fetching",
            message: `Found ${indexableFiles.length} changed files`,
            filesChanged: indexableFiles.length,
          });

          // 3. Categorize changes
          const removedFiles = indexableFiles.filter((f) => f.status === "removed");
          const addedOrModified = indexableFiles.filter((f) => f.status !== "removed");

          // 4. Remove old chunks for deleted/modified files
          const filesToRemove = [
            ...removedFiles.map((f) => f.filename),
            ...addedOrModified.map((f) => f.filename),
          ];

          if (filesToRemove.length > 0) {
            send({ status: "cleaning", message: `Removing ${filesToRemove.length} old file chunks...` });

            // Delete in batches of 50 paths (avoid oversized IN clause)
            for (let i = 0; i < filesToRemove.length; i += 50) {
              const batch = filesToRemove.slice(i, i + 50);
              await adminDb
                .from("repo_chunks")
                .delete()
                .eq("user_id", userId)
                .eq("repo_full_name", fullName)
                .in("file_path", batch);

              await adminDb
                .from("repo_files")
                .delete()
                .eq("user_id", userId)
                .eq("repo_full_name", fullName)
                .in("file_path", batch);
            }
          }

          // 5. Fetch, chunk, and embed new/modified files
          if (addedOrModified.length > 0 && canEmbed) {
            send({ status: "chunking", message: `Processing ${addedOrModified.length} files...` });

            const allChunks: Array<{
              content: string;
              filePath: string;
              chunkIndex: number;
              tokenCount: number;
              metadata: Record<string, unknown>;
            }> = [];

            const fileRecords: Array<{
              user_id: string;
              repo_full_name: string;
              file_path: string;
              file_name: string;
              extension: string;
              line_count: number;
              size_bytes: number;
              imports: string[];
            }> = [];

            for (let i = 0; i < addedOrModified.length; i++) {
              const file = addedOrModified[i];
              const content = await fetchFileContent(githubToken, owner, name, file.filename);

              if (content) {
                const ext = file.filename.split(".").pop() || "";
                const lines = content.split("\n").length;
                const imports = extractImports(content);

                fileRecords.push({
                  user_id: userId,
                  repo_full_name: fullName,
                  file_path: file.filename,
                  file_name: file.filename.split("/").pop() || file.filename,
                  extension: ext,
                  line_count: lines,
                  size_bytes: content.length,
                  imports,
                });

                const chunks = chunkFile(content, file.filename);
                for (const chunk of chunks) {
                  allChunks.push({
                    content: chunk.content,
                    filePath: file.filename,
                    chunkIndex: chunk.chunkIndex,
                    tokenCount: chunk.tokenCount,
                    metadata: {
                      ...chunk.metadata,
                      // Tier 3: Add LLM summary to metadata
                      ...(understandingTier === 3 ? {
                        llm_summary: await generateFileSummary(apiKey, file.filename, content)
                          .catch(() => null),
                      } : {}),
                    },
                  });
                }
              }

              if ((i + 1) % 5 === 0 || i === addedOrModified.length - 1) {
                send({
                  status: "chunking",
                  filesProcessed: i + 1,
                  filesTotal: addedOrModified.length,
                  chunksCreated: allChunks.length,
                });
              }
            }

            // 6. Generate embeddings
            if (allChunks.length > 0) {
              send({ status: "embedding", message: `Embedding ${allChunks.length} chunks...` });

              const batchSize = 50;
              const embeddings: number[][] = [];

              for (let i = 0; i < allChunks.length; i += batchSize) {
                const batch = allChunks.slice(i, i + batchSize);
                const batchTexts = batch.map((c) => c.content);
                const batchEmbeddings = await generateEmbeddings(
                  apiKey,
                  batchTexts,
                  TaskType.RETRIEVAL_DOCUMENT
                );
                embeddings.push(...batchEmbeddings);

                send({
                  status: "embedding",
                  chunksEmbedded: embeddings.length,
                  chunksTotal: allChunks.length,
                });
              }

              // 7. Insert new chunks
              const chunkRows = allChunks.map((chunk, i) => ({
                user_id: userId,
                repo_full_name: fullName,
                file_path: chunk.filePath,
                chunk_index: chunk.chunkIndex,
                content: chunk.content,
                token_count: chunk.tokenCount,
                embedding: JSON.stringify(embeddings[i]),
                metadata: chunk.metadata,
              }));

              for (let i = 0; i < chunkRows.length; i += 100) {
                await adminDb.from("repo_chunks").insert(chunkRows.slice(i, i + 100));
              }

              // 8. Insert file records
              if (fileRecords.length > 0) {
                for (let i = 0; i < fileRecords.length; i += 100) {
                  await adminDb.from("repo_files").insert(fileRecords.slice(i, i + 100));
                }
              }
            }
          }

          // 9. Store commit history
          send({ status: "timeline", message: "Updating development timeline..." });

          const newCommits = await fetchCommitsSince(
            githubToken, owner, name, branch, repo.last_synced_sha!
          );

          if (newCommits.length > 0) {
            const commitRows = newCommits.map((c) => ({
              user_id: userId,
              repo_full_name: fullName,
              sha: c.sha,
              message: c.commit.message,
              author_name: c.author?.login || c.commit.author.name,
              author_avatar_url: c.author?.avatar_url || null,
              committed_at: c.commit.author.date,
              files_changed: JSON.stringify(
                changedFiles
                  .filter(() => true) // All files for this batch
                  .map((f) => ({
                    path: f.filename,
                    status: f.status,
                    additions: f.additions,
                    deletions: f.deletions,
                  }))
              ),
              sync_triggered: true,
            }));

            // Insert in batches, ignoring duplicates
            for (let i = 0; i < commitRows.length; i += 50) {
              const batch = commitRows.slice(i, i + 50);
              await adminDb
                .from("repo_commits")
                .upsert(batch, { onConflict: "user_id,repo_full_name,sha", ignoreDuplicates: true });
            }
          }

          // 10. Update repo state
          const { count: chunkCount } = await adminDb
            .from("repo_chunks")
            .select("id", { count: "exact", head: true })
            .eq("user_id", userId)
            .eq("repo_full_name", fullName);

          await adminDb
            .from("repos")
            .update({
              last_synced_sha: headSHA,
              chunk_count: chunkCount || 0,
              last_indexed_at: new Date().toISOString(),
            })
            .eq("user_id", userId)
            .eq("full_name", fullName);

          send({
            status: "done",
            message: `Synced ${indexableFiles.length} files, ${newCommits.length} commits`,
            filesChanged: indexableFiles.length,
            commitsTracked: newCommits.length,
            newChunkCount: chunkCount,
          });
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : "Unknown error";
          console.error("[sync] Error:", err);
          send({ status: "error", message });
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
