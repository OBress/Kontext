import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/api/auth";
import { rateLimit } from "@/lib/api/rate-limit";
import { handleApiError } from "@/lib/api/errors";
import {
  validateRepoFullName,
  validateMessage,
  validateApiKey,
} from "@/lib/api/validate";
import {
  retrieveRepoContext,
  streamRepoAnswer,
} from "@/lib/api/repo-intelligence";
import { decryptToken } from "@/lib/api/crypto";
import { fetchLatestCommit, fetchFileContent } from "@/lib/api/github";
import {
  answerScopedCommit,
  buildChatAnswerInstruction,
  detectChatQueryIntent,
  fetchAllCommitHistory,
  formatCommitHistoryResponse,
  resolveScopedCommit,
} from "@/lib/api/chat-orchestrator";
import { clearRollingChatSession, loadRollingChatSession, saveRollingChatSession } from "@/lib/api/chat-sessions";
import {
  buildConversationHistoryBlock,
  normalizePersistedChatMessages,
  toChatMessages,
} from "@/lib/chat-messages";
import { planChatVisual } from "@/lib/api/chat-visuals";
import type {
  ChatCitation,
  ChatFreshnessMeta,
  ChatMessage,
  ChatSourceMode,
} from "@/types/chat";

const MAX_ATTACHED_FILES = 5;
const MAX_ATTACHED_FILE_CHARS = 8000;
const MAX_IMAGES = 3;
const MAX_IMAGE_BYTES = 4 * 1024 * 1024; // 4 MB

interface AttachedImage {
  mimeType: string;
  data: string; // base64
}

interface RepoTokenContext {
  last_synced_sha: string | null;
  last_indexed_at: string | null;
  default_branch: string | null;
  watched_branch: string | null;
  custom_github_token: string | null;
  custom_token_iv: string | null;
  custom_token_tag: string | null;
}

function validateAttachedFiles(input: unknown): string[] {
  if (!input || !Array.isArray(input)) return [];
  const files: string[] = [];

  for (const item of input) {
    if (typeof item === "string" && item.trim().length > 0 && item.length < 1000) {
      files.push(item.trim());
    }
  }

  return files.slice(0, MAX_ATTACHED_FILES);
}

function validateAttachedImages(input: unknown): AttachedImage[] {
  if (!input || !Array.isArray(input)) return [];
  const images: AttachedImage[] = [];

  for (const item of input) {
    if (
      item &&
      typeof item === "object" &&
      typeof (item as AttachedImage).mimeType === "string" &&
      typeof (item as AttachedImage).data === "string" &&
      (item as AttachedImage).mimeType.startsWith("image/")
    ) {
      const img = item as AttachedImage;
      const approxBytes = img.data.length * 0.75;
      if (approxBytes <= MAX_IMAGE_BYTES) {
        images.push({ mimeType: img.mimeType, data: img.data });
      }
    }
  }

  return images.slice(0, MAX_IMAGES);
}

async function resolveRepoTokenContext(params: {
  supabase: Awaited<ReturnType<typeof getAuthenticatedUser>>["supabase"];
  userId: string;
  repoFullName: string;
  githubToken: string | null;
}): Promise<{ repo: RepoTokenContext | null; effectiveToken: string | null }> {
  const { supabase, userId, repoFullName, githubToken } = params;

  const { data: repo } = await supabase
    .from("repos")
    .select(
      "custom_github_token, custom_token_iv, custom_token_tag, last_synced_sha, last_indexed_at, default_branch, watched_branch"
    )
    .eq("user_id", userId)
    .eq("full_name", repoFullName)
    .maybeSingle();

  let effectiveToken = githubToken;
  if (repo?.custom_github_token && repo.custom_token_iv && repo.custom_token_tag) {
    effectiveToken = decryptToken({
      ciphertext: repo.custom_github_token,
      iv: repo.custom_token_iv,
      tag: repo.custom_token_tag,
    });
  }

  return {
    repo: (repo as RepoTokenContext | null) || null,
    effectiveToken,
  };
}

async function buildAttachedFileBlocks(params: {
  attachedFiles: string[];
  repoFullName: string;
  repo: RepoTokenContext | null;
  effectiveToken: string | null;
}): Promise<string> {
  const { attachedFiles, repoFullName, repo, effectiveToken } = params;
  if (attachedFiles.length === 0 || !effectiveToken) return "";

  const [owner, name] = repoFullName.split("/");
  const ref = repo?.last_synced_sha || repo?.watched_branch || repo?.default_branch || undefined;
  const blocks: string[] = [];

  for (const filePath of attachedFiles) {
    try {
      const content = await fetchFileContent(effectiveToken, owner, name, filePath, ref);
      if (!content) continue;

      const trimmed =
        content.length > MAX_ATTACHED_FILE_CHARS
          ? `${content.slice(0, MAX_ATTACHED_FILE_CHARS)}\n... (truncated)`
          : content;
      blocks.push(`--- @-mentioned file: ${filePath} ---\n${trimmed}\n`);
    } catch {
      // Ignore file fetch failures for attached context.
    }
  }

  return blocks.join("\n");
}

async function buildIndexedFreshness(
  effectiveToken: string | null,
  repoFullName: string,
  repo: RepoTokenContext | null
): Promise<ChatFreshnessMeta | null> {
  if (!repo) return null;

  const branch = repo.watched_branch || repo.default_branch || "main";
  let liveHeadSha: string | null = null;

  if (effectiveToken) {
    try {
      const [owner, name] = repoFullName.split("/");
      liveHeadSha = (await fetchLatestCommit(effectiveToken, owner, name, branch)).sha;
    } catch {
      liveHeadSha = null;
    }
  }

  const stale =
    !!liveHeadSha && !!repo.last_synced_sha && liveHeadSha !== repo.last_synced_sha;

  return {
    branch,
    indexedSha: repo.last_synced_sha || null,
    liveHeadSha,
    stale,
    note: stale
      ? `GitHub HEAD is ${liveHeadSha?.slice(0, 7)} on ${branch}, newer than the indexed commit ${repo.last_synced_sha?.slice(0, 7)}.`
      : effectiveToken
        ? `Indexed data is aligned with GitHub HEAD on ${branch}.`
        : "Using indexed repository data because no GitHub token is available for live freshness checks.",
  };
}

function buildUserMessage(params: {
  message: string;
  attachedFiles: string[];
  attachedImages: AttachedImage[];
}): ChatMessage {
  const { message, attachedFiles, attachedImages } = params;
  return {
    id: `${Date.now()}-user`,
    role: "user",
    content: message,
    timestamp: new Date(),
    attachedFiles: attachedFiles.length > 0 ? attachedFiles : undefined,
    attachedImages:
      attachedImages.length > 0
        ? attachedImages.map((image, index) => ({
            name: `Image ${index + 1}`,
            mimeType: image.mimeType,
          }))
        : undefined,
  };
}

/**
 * POST /api/chat - RAG chatbot with streaming Gemini response
 * Supports attached files (@-mention) and images for multimodal queries.
 */
export async function POST(request: Request) {
  try {
    const { user, supabase, githubToken } = await getAuthenticatedUser();

    const rl = rateLimit(user.id, "chat");
    if (!rl.ok) {
      return NextResponse.json(
        { error: { code: "RATE_LIMITED", message: "Too many chat requests" } },
        { status: 429 }
      );
    }

    const body = await request.json();
    const message = validateMessage(body.message);
    const repoFullName = validateRepoFullName(body.repo_full_name);
    const apiKey = validateApiKey(request);
    const attachedFiles = validateAttachedFiles(body.attached_files);
    const attachedImages = validateAttachedImages(body.attached_images);
    const clientHistory = normalizePersistedChatMessages(body.history);
    const storedHistory = clientHistory.length > 0
      ? clientHistory
      : await loadRollingChatSession(supabase, user.id, repoFullName);

    const { repo, effectiveToken } = await resolveRepoTokenContext({
      supabase,
      userId: user.id,
      repoFullName,
      githubToken,
    });

    const attachedFileBlocks = await buildAttachedFileBlocks({
      attachedFiles,
      repoFullName,
      repo,
      effectiveToken,
    });

    const intent = detectChatQueryIntent(message);
    const conversationHistoryBlock = buildConversationHistoryBlock(storedHistory);
    const userMessage = buildUserMessage({
      message,
      attachedFiles,
      attachedImages,
    });

    const encoder = new TextEncoder();

    const combinedStream = new ReadableStream({
      async start(controller) {
        let assistantContent = "";
        let assistantCitations: ChatCitation[] = [];
        let assistantTimelineCitations: Array<unknown> = [];
        let answerMode: "grounded" | "partial" | "insufficient_evidence" = "partial";
        let sourceMode: ChatSourceMode = "indexed";
        let resolvedCommitSha: string | null = null;
        let freshness: ChatFreshnessMeta | null = null;

        const emitContext = (payload: {
          citations?: ChatCitation[];
          timelineCitations?: Array<unknown>;
          answerMode: "grounded" | "partial" | "insufficient_evidence";
          sourceMode?: ChatSourceMode;
          resolvedCommitSha?: string | null;
          freshness?: ChatFreshnessMeta | null;
        }) => {
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({
                type: "context",
                citations: payload.citations || [],
                timelineCitations: payload.timelineCitations || [],
                answerMode: payload.answerMode,
                sourceMode: payload.sourceMode || "indexed",
                resolvedCommitSha: payload.resolvedCommitSha || null,
                freshness: payload.freshness || null,
              })}\n\n`
            )
          );
        };

        try {
          if (intent.kind === "all_commits" || intent.kind === "recent_history") {
            const commits = await fetchAllCommitHistory(supabase, user.id, repoFullName);
            freshness = await buildIndexedFreshness(effectiveToken, repoFullName, repo);
            sourceMode = "indexed";
            answerMode = commits.length > 0 ? "grounded" : "insufficient_evidence";
            assistantContent = formatCommitHistoryResponse(commits, intent);

            const visualPrefix = intent.wantsTimelineVisual
              ? await planChatVisual({
                  supabase,
                  userId: user.id,
                  repoFullName,
                  query: message,
                  citationFiles: [],
                  timelineCitations: [],
                })
              : null;

            emitContext({
              answerMode,
              sourceMode,
              freshness,
            });

            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({
                  type: "text",
                  content: `${visualPrefix || ""}${assistantContent}`,
                })}\n\n`
              )
            );
            if (visualPrefix) assistantContent = `${visualPrefix}${assistantContent}`;
          } else if (intent.kind === "latest_commit" || intent.kind === "specific_commit") {
            const resolved = await resolveScopedCommit({
              supabase,
              userId: user.id,
              repoFullName,
              repo,
              githubToken: effectiveToken,
              intent,
              conversationHistory: storedHistory,
            });

            freshness = resolved.freshness;
            sourceMode = resolved.sourceMode;
            resolvedCommitSha = resolved.commit?.sha || null;
            assistantCitations = resolved.commit?.citations || [];
            answerMode = resolved.commit ? "grounded" : "insufficient_evidence";

            emitContext({
              citations: assistantCitations,
              answerMode,
              sourceMode,
              resolvedCommitSha,
              freshness,
            });

            if (!resolved.commit) {
              assistantContent =
                "Insufficient evidence. I couldn't resolve a matching commit from the indexed history or live GitHub data.";
              controller.enqueue(
                encoder.encode(
                  `data: ${JSON.stringify({ type: "text", content: assistantContent })}\n\n`
                )
              );
            } else {
              assistantContent = await answerScopedCommit({
                apiKey,
                repoFullName,
                question: message,
                intent,
                commit: resolved.commit,
                freshness,
                conversationHistory: storedHistory,
              });

              controller.enqueue(
                encoder.encode(
                  `data: ${JSON.stringify({ type: "text", content: assistantContent })}\n\n`
                )
              );
            }
          } else {
            const context = await retrieveRepoContext({
              supabase,
              userId: user.id,
              repoFullName,
              query: message,
              apiKey,
              includeTimeline: true,
              matchCount: 25,
            });

            assistantCitations = context.dedupedCitations;
            assistantTimelineCitations = context.timelineCitations;
            answerMode = context.answerMode;
            freshness = await buildIndexedFreshness(effectiveToken, repoFullName, repo);
            sourceMode = "indexed";

            emitContext({
              citations: assistantCitations,
              timelineCitations: assistantTimelineCitations,
              answerMode,
              sourceMode,
              freshness,
            });

            const visualPrefix = await planChatVisual({
              supabase,
              userId: user.id,
              repoFullName,
              query:
                intent.wantsTimelineVisual || intent.wantsArchitectureVisual
                  ? message
                  : message,
              citationFiles: context.dedupedCitations.map((citation) => citation.file_path),
              timelineCitations: context.timelineCitations,
            });

            if (visualPrefix) {
              assistantContent += visualPrefix;
              controller.enqueue(
                encoder.encode(
                  `data: ${JSON.stringify({ type: "text", content: visualPrefix })}\n\n`
                )
              );
            }

            const hasAnyContext =
              context.dedupedCitations.length > 0 ||
              context.hasSupplementalContext ||
              attachedFiles.length > 0 ||
              attachedImages.length > 0;

            if (!hasAnyContext) {
              const text =
                "Insufficient evidence from the indexed repository to answer that confidently. Try rephrasing the question or inspect the files that likely define the relevant behavior.";
              assistantContent += text;
              controller.enqueue(
                encoder.encode(
                  `data: ${JSON.stringify({ type: "text", content: text })}\n\n`
                )
              );
            } else {
              const aiStream = await streamRepoAnswer({
                apiKey,
                repoFullName,
                question: message,
                fileManifest: context.fileManifest,
                contextBlocks: context.contextBlocks,
                timelineBlocks: context.timelineBlocks,
                recentCommitsBlock: context.recentCommitsBlock || undefined,
                architectureBlock: context.architectureBlock || undefined,
                healthFindingsBlock: context.healthFindingsBlock || undefined,
                activityBlock: context.activityBlock || undefined,
                repoMetadataBlock: context.repoMetadataBlock || undefined,
                conversationHistoryBlock: conversationHistoryBlock || undefined,
                extraInstructions: buildChatAnswerInstruction(intent),
                attachedFileBlocks: attachedFileBlocks || undefined,
                imageParts: attachedImages.length > 0 ? attachedImages : undefined,
              });

              const reader = aiStream.getReader();
              const decoder = new TextDecoder();
              let buffer = "";

              while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                controller.enqueue(value);
                buffer += decoder.decode(value, { stream: true });

                while (buffer.includes("\n\n")) {
                  const boundary = buffer.indexOf("\n\n");
                  const rawEvent = buffer.slice(0, boundary);
                  buffer = buffer.slice(boundary + 2);

                  const lines = rawEvent
                    .split("\n")
                    .filter((line) => line.startsWith("data: "));

                  for (const line of lines) {
                    try {
                      const payload = JSON.parse(line.slice(6));
                      if (payload.type === "text" && typeof payload.content === "string") {
                        assistantContent += payload.content;
                      }
                    } catch {
                      // Ignore malformed streamed payloads from the model.
                    }
                  }
                }
              }
            }
          }
        } catch (err: unknown) {
          const messageText = err instanceof Error ? err.message : "Unknown error";
          assistantContent = assistantContent || messageText;
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ type: "error", message: messageText })}\n\n`
            )
          );
        }

        const nextMessages: ChatMessage[] = [
          ...toChatMessages(storedHistory),
          userMessage,
          {
            id: `${Date.now()}-assistant`,
            role: "assistant",
            content: assistantContent,
            timestamp: new Date(),
            citations: assistantCitations.length > 0 ? assistantCitations : undefined,
            timelineCitations:
              assistantTimelineCitations.length > 0
                ? (assistantTimelineCitations as ChatMessage["timelineCitations"])
                : undefined,
            answerMode,
            sourceMode,
            resolvedCommitSha,
            freshness,
          },
        ];

        try {
          if (assistantContent.trim().length > 0) {
            await saveRollingChatSession(
              supabase,
              user.id,
              repoFullName,
              nextMessages
            );
          } else if (storedHistory.length === 0) {
            await clearRollingChatSession(supabase, user.id, repoFullName);
          }
        } catch {
          // Session persistence failures should not break the streamed response.
        }

        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ type: "done" })}\n\n`)
        );
        controller.close();
      },
    });

    return new NextResponse(combinedStream, {
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
