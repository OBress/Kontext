import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/api/auth";
import { rateLimit } from "@/lib/api/rate-limit";
import { handleApiError, ApiError } from "@/lib/api/errors";
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
import { fetchFileContent } from "@/lib/api/github";

const MAX_ATTACHED_FILES = 5;
const MAX_ATTACHED_FILE_CHARS = 8000;
const MAX_IMAGES = 3;
const MAX_IMAGE_BYTES = 4 * 1024 * 1024; // 4 MB

interface AttachedImage {
  mimeType: string;
  data: string; // base64
}

function validateAttachedFiles(input: unknown): string[] {
  if (!input) return [];
  if (!Array.isArray(input)) return [];
  const files: string[] = [];
  for (const item of input) {
    if (typeof item === "string" && item.trim().length > 0 && item.length < 1000) {
      files.push(item.trim());
    }
  }
  return files.slice(0, MAX_ATTACHED_FILES);
}

function validateAttachedImages(input: unknown): AttachedImage[] {
  if (!input) return [];
  if (!Array.isArray(input)) return [];
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
      // Rough base64 size check: base64 length * 0.75 ≈ byte size
      const approxBytes = img.data.length * 0.75;
      if (approxBytes <= MAX_IMAGE_BYTES) {
        images.push({ mimeType: img.mimeType, data: img.data });
      }
    }
  }
  return images.slice(0, MAX_IMAGES);
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

    const context = await retrieveRepoContext({
      supabase,
      userId: user.id,
      repoFullName,
      query: message,
      apiKey,
      includeTimeline: true,
      matchCount: 25,
    });

    // Fetch content for @-mentioned files
    let attachedFileBlocks = "";
    if (attachedFiles.length > 0) {
      // Look up repo for GitHub token
      const { data: repo } = await supabase
        .from("repos")
        .select("custom_github_token, custom_token_iv, custom_token_tag, last_synced_sha, default_branch, watched_branch")
        .eq("user_id", user.id)
        .eq("full_name", repoFullName)
        .single();

      let effectiveToken = githubToken;
      if (repo?.custom_github_token && repo.custom_token_iv && repo.custom_token_tag) {
        effectiveToken = decryptToken({
          ciphertext: repo.custom_github_token,
          iv: repo.custom_token_iv,
          tag: repo.custom_token_tag,
        });
      }

      if (effectiveToken) {
        const [owner, name] = repoFullName.split("/");
        const ref = repo?.last_synced_sha || repo?.watched_branch || repo?.default_branch || undefined;

        const blocks: string[] = [];
        for (const filePath of attachedFiles) {
          try {
            const content = await fetchFileContent(effectiveToken, owner, name, filePath, ref);
            if (content) {
              const trimmed = content.length > MAX_ATTACHED_FILE_CHARS
                ? content.slice(0, MAX_ATTACHED_FILE_CHARS) + "\n... (truncated)"
                : content;
              blocks.push(`--- @-mentioned file: ${filePath} ---\n${trimmed}\n`);
            }
          } catch {
            // Skip files that fail to fetch
          }
        }
        attachedFileBlocks = blocks.join("\n");
      }
    }

    const encoder = new TextEncoder();
    const combinedStream = new ReadableStream({
      async start(controller) {
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({
              type: "context",
              citations: context.dedupedCitations,
              timelineCitations: context.timelineCitations,
              answerMode: context.answerMode,
            })}\n\n`
          )
        );

        if (context.dedupedCitations.length === 0 && attachedFiles.length === 0 && attachedImages.length === 0) {
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({
                type: "text",
                content:
                  "Insufficient evidence from the indexed repository to answer that confidently. Try rephrasing the question or inspect the files that likely define the relevant behavior.",
              })}\n\n`
            )
          );
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ type: "done" })}\n\n`)
          );
          controller.close();
          return;
        }

        try {
          const aiStream = await streamRepoAnswer({
            apiKey,
            repoFullName,
            question: message,
            fileManifest: context.fileManifest,
            contextBlocks: context.contextBlocks,
            timelineBlocks: context.timelineBlocks,
            attachedFileBlocks: attachedFileBlocks || undefined,
            imageParts: attachedImages.length > 0 ? attachedImages : undefined,
          });

          const reader = aiStream.getReader();
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            controller.enqueue(value);
          }
        } catch (err: unknown) {
          const messageText =
            err instanceof Error ? err.message : "Unknown error";
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({
                type: "error",
                message: messageText,
              })}\n\n`
            )
          );
        }

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
