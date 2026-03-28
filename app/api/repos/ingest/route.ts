import { NextResponse } from "next/server";
import { getAuthenticatedUser, createAdminClient } from "@/lib/api/auth";
import { rateLimit } from "@/lib/api/rate-limit";
import { handleApiError, ApiError } from "@/lib/api/errors";
import { validateRepoFullName, validateApiKey } from "@/lib/api/validate";
import { fetchRepoTree, fetchFileContent, fetchLatestCommit, fetchCommitsSince } from "@/lib/api/github";
import { chunkFile } from "@/lib/api/chunker";
import { generateEmbeddings } from "@/lib/api/embeddings";
import { extractImports } from "@/lib/api/graph-builder";
import { TaskType } from "@google/generative-ai";
import { logActivity } from "@/lib/api/activity";

/**
 * POST /api/repos/ingest — Full ingestion pipeline with SSE progress
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

    // Get understanding tier and custom token from repo settings
    const { data: repoSettings } = await supabase
      .from("repos")
      .select("understanding_tier, default_branch, custom_github_token, custom_token_iv, custom_token_tag")
      .eq("user_id", user.id)
      .eq("full_name", fullName)
      .single();
    // understanding_tier is queried but reserved for future use
    const defaultBranch = repoSettings?.default_branch || "main";

    // Use custom PAT if stored, otherwise fall back to OAuth token
    let effectiveToken = githubToken;
    if (repoSettings?.custom_github_token && repoSettings?.custom_token_iv && repoSettings?.custom_token_tag) {
      const { decryptToken } = await import("@/lib/api/crypto");
      try {
        effectiveToken = decryptToken({
          ciphertext: repoSettings.custom_github_token,
          iv: repoSettings.custom_token_iv,
          tag: repoSettings.custom_token_tag,
        });
      } catch {
        // Fall back to OAuth token if decryption fails
      }
    }

    if (!effectiveToken) {
      throw new ApiError(401, "GITHUB_TOKEN_REQUIRED", "GitHub token not available. Please re-authenticate or provide an access token.");
    }

    const adminDb = await createAdminClient();

    // Create ingestion job
    const { data: job } = await supabase
      .from("ingestion_jobs")
      .insert({
        user_id: user.id,
        repo_full_name: fullName,
        status: "fetching",
        started_at: new Date().toISOString(),
      })
      .select()
      .single();

    // Mark repo as indexing
    await adminDb
      .from("repos")
      .update({ indexing: true })
      .eq("user_id", user.id)
      .eq("full_name", fullName);

    // SSE stream
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const send = (data: Record<string, unknown>) => {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        };

        try {
          // 1. Fetch file tree
          send({ status: "fetching", message: "Fetching repository tree..." });
          const tree = await fetchRepoTree(effectiveToken, owner, name);
          const filesTotal = tree.length;

          await supabase
            .from("ingestion_jobs")
            .update({ status: "chunking", files_total: filesTotal })
            .eq("id", job!.id);

          send({ status: "chunking", filesTotal, filesProcessed: 0 });

          // 2. Fetch content & chunk each file
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

          for (let i = 0; i < tree.length; i++) {
            const file = tree[i];
            const content = await fetchFileContent(effectiveToken, owner, name, file.path);

            if (content) {
              const ext = file.path.split(".").pop() || "";
              const lines = content.split("\n").length;
              const imports = extractImports(content);

              fileRecords.push({
                user_id: user.id,
                repo_full_name: fullName,
                file_path: file.path,
                file_name: file.path.split("/").pop() || file.path,
                extension: ext,
                line_count: lines,
                size_bytes: content.length,
                imports,
              });

              const chunks = chunkFile(content, file.path);
              for (const chunk of chunks) {
                allChunks.push({
                  content: chunk.content,
                  filePath: file.path,
                  chunkIndex: chunk.chunkIndex,
                  tokenCount: chunk.tokenCount,
                  metadata: chunk.metadata,
                });
              }
            }

            if ((i + 1) % 5 === 0 || i === tree.length - 1) {
              send({ status: "chunking", filesTotal, filesProcessed: i + 1, chunksCreated: allChunks.length });
            }
          }

          // 3. Generate embeddings
          send({ status: "embedding", message: `Embedding ${allChunks.length} chunks...`, chunksTotal: allChunks.length });

          await supabase
            .from("ingestion_jobs")
            .update({ status: "embedding", files_processed: tree.length })
            .eq("id", job!.id);

          const batchSize = 50;
          const embeddings: number[][] = [];

          for (let i = 0; i < allChunks.length; i += batchSize) {
            const batch = allChunks.slice(i, i + batchSize);
            const batchTexts = batch.map((c) => c.content);
            const batchEmbeddings = await generateEmbeddings(apiKey, batchTexts, TaskType.RETRIEVAL_DOCUMENT);
            embeddings.push(...batchEmbeddings);

            send({
              status: "embedding",
              chunksEmbedded: embeddings.length,
              chunksTotal: allChunks.length,
            });
          }

          // 4. Delete old chunks for this repo
          await adminDb
            .from("repo_chunks")
            .delete()
            .eq("user_id", user.id)
            .eq("repo_full_name", fullName);

          // 5. Insert new chunks with embeddings
          const chunkRows = allChunks.map((chunk, i) => ({
            user_id: user.id,
            repo_full_name: fullName,
            file_path: chunk.filePath,
            chunk_index: chunk.chunkIndex,
            content: chunk.content,
            token_count: chunk.tokenCount,
            embedding: JSON.stringify(embeddings[i]),
            metadata: chunk.metadata,
          }));

          // Insert in batches of 100
          for (let i = 0; i < chunkRows.length; i += 100) {
            const batch = chunkRows.slice(i, i + 100);
            await adminDb.from("repo_chunks").insert(batch);
          }

          // 6. Upsert repo_files
          await adminDb
            .from("repo_files")
            .delete()
            .eq("user_id", user.id)
            .eq("repo_full_name", fullName);

          if (fileRecords.length > 0) {
            for (let i = 0; i < fileRecords.length; i += 100) {
              await adminDb.from("repo_files").insert(fileRecords.slice(i, i + 100));
            }
          }

          // 7. Store HEAD SHA and set branch for future incremental syncs
          send({ status: "finalizing", message: "Setting up sync tracking..." });

          let headSHA: string | null = null;
          try {
            const latestCommit = await fetchLatestCommit(effectiveToken, owner, name, defaultBranch);
            headSHA = latestCommit.sha;
          } catch {
            // Non-fatal — sync tracking just won't work
          }

          await adminDb
            .from("repos")
            .update({
              indexed: true,
              indexing: false,
              chunk_count: allChunks.length,
              last_indexed_at: new Date().toISOString(),
              last_synced_sha: headSHA,
              watched_branch: defaultBranch,
            })
            .eq("user_id", user.id)
            .eq("full_name", fullName);

          // 8. Backfill commit history (last 50 commits)
          if (headSHA) {
            try {
              send({ status: "timeline", message: "Backfilling commit history..." });
              await fetchCommitsSince(
                effectiveToken, owner, name, defaultBranch, headSHA, 50
              ).catch(() => []);

              // Also get the HEAD commit itself
              const commitRows = [{
                user_id: user.id,
                repo_full_name: fullName,
                sha: headSHA,
                message: "Initial ingestion baseline",
                author_name: "system",
                committed_at: new Date().toISOString(),
                sync_triggered: true,
              }];

              if (commitRows.length > 0) {
                await adminDb
                  .from("repo_commits")
                  .upsert(commitRows, { onConflict: "user_id,repo_full_name,sha", ignoreDuplicates: true });
              }
            } catch (e) {
              // Non-fatal
              console.warn("[ingest] Commit backfill failed:", e);
            }
          }

          // 9. Update job
          await supabase
            .from("ingestion_jobs")
            .update({
              status: "done",
              chunks_created: allChunks.length,
              files_processed: tree.length,
              completed_at: new Date().toISOString(),
            })
            .eq("id", job!.id);

          // Log activity event
          logActivity({
            userId: user.id,
            repoFullName: fullName,
            source: "kontext",
            eventType: "repo_indexed",
            title: `${fullName} was indexed`,
            description: `${allChunks.length} chunks from ${tree.length} files`,
            metadata: { chunks: allChunks.length, files: tree.length },
          });

          send({
            status: "done",
            filesTotal: tree.length,
            filesProcessed: tree.length,
            chunksCreated: allChunks.length,
          });
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : "Unknown error";
          send({ status: "error", message });

          // Update job and repo status
          await supabase
            .from("ingestion_jobs")
            .update({ status: "error", error_message: message })
            .eq("id", job!.id);

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
