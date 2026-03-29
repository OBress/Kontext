import { truncatePromptText } from "@/lib/api/prompt-contract";
import type {
  ChatAttachedImage,
  ChatFreshnessMeta,
  ChatMessage,
  PersistedChatMessage,
  ChatCitation,
  TimelineCitation,
} from "@/types/chat";

export const MAX_PERSISTED_CHAT_MESSAGES = 16;
const MAX_HISTORY_CHARS = 420;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isChatRole(value: unknown): value is "user" | "assistant" {
  return value === "user" || value === "assistant";
}

function sanitizeStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value.filter((entry): entry is string => isString(entry) && entry.trim().length > 0);
  return items.length > 0 ? items : undefined;
}

function sanitizeCitations(value: unknown): ChatCitation[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const citations = value.filter((entry): entry is ChatCitation => {
    if (!isRecord(entry)) return false;
    return (
      isString(entry.citation_id) &&
      isString(entry.file_path) &&
      typeof entry.line_start === "number" &&
      typeof entry.line_end === "number" &&
      isString(entry.language) &&
      isString(entry.snippet) &&
      typeof entry.retrieval_score === "number"
    );
  });
  return citations.length > 0 ? citations : undefined;
}

function sanitizeTimelineCitations(value: unknown): TimelineCitation[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const citations = value.filter((entry): entry is TimelineCitation => {
    if (!isRecord(entry)) return false;
    return (
      isString(entry.sha) &&
      isString(entry.date) &&
      isString(entry.committed_at) &&
      isString(entry.ai_summary) &&
      isString(entry.message) &&
      isString(entry.author) &&
      typeof entry.similarity === "number"
    );
  });
  return citations.length > 0 ? citations : undefined;
}

function sanitizeAttachedImages(
  value: unknown,
  includeDataUrl = false
): ChatAttachedImage[] | undefined {
  if (!Array.isArray(value)) return undefined;

  const images = value
    .filter((entry): entry is Record<string, unknown> => isRecord(entry))
    .map((entry) => {
      const image: ChatAttachedImage = {
        name: isString(entry.name) ? entry.name : "image",
        mimeType: isString(entry.mimeType) ? entry.mimeType : "image/*",
      };

      if (includeDataUrl && isString(entry.dataUrl)) {
        image.dataUrl = entry.dataUrl;
      }

      return image;
    });

  return images.length > 0 ? images : undefined;
}

function sanitizeFreshness(value: unknown): ChatFreshnessMeta | null | undefined {
  if (value === null) return null;
  if (!isRecord(value)) return undefined;

  return {
    branch: isString(value.branch) ? value.branch : null,
    indexedSha: isString(value.indexedSha) ? value.indexedSha : null,
    liveHeadSha: isString(value.liveHeadSha) ? value.liveHeadSha : null,
    stale: typeof value.stale === "boolean" ? value.stale : false,
    note: isString(value.note) ? value.note : null,
  };
}

export function toPersistedChatMessage(message: ChatMessage): PersistedChatMessage {
  return {
    id: message.id,
    role: message.role,
    content: message.content,
    timestamp: message.timestamp.toISOString(),
    citations: message.citations,
    timelineCitations: message.timelineCitations,
    answerMode: message.answerMode,
    attachedFiles: message.attachedFiles,
    attachedImages: message.attachedImages?.map((image) => ({
      name: image.name,
      mimeType: image.mimeType,
    })),
    sourceMode: message.sourceMode,
    resolvedCommitSha: message.resolvedCommitSha ?? null,
    freshness: message.freshness ?? null,
  };
}

export function toPersistedChatMessages(
  messages: ChatMessage[],
  maxMessages = MAX_PERSISTED_CHAT_MESSAGES
): PersistedChatMessage[] {
  return messages.slice(-maxMessages).map(toPersistedChatMessage);
}

export function normalizePersistedChatMessages(
  input: unknown,
  maxMessages = MAX_PERSISTED_CHAT_MESSAGES
): PersistedChatMessage[] {
  if (!Array.isArray(input)) return [];

  const messages = input
    .filter((entry): entry is Record<string, unknown> => isRecord(entry))
    .map((entry) => {
      if (!isString(entry.id) || !isChatRole(entry.role) || !isString(entry.content)) {
        return null;
      }

      const timestamp =
        isString(entry.timestamp) && !Number.isNaN(Date.parse(entry.timestamp))
          ? entry.timestamp
          : new Date().toISOString();

      const normalized: PersistedChatMessage = {
        id: entry.id,
        role: entry.role,
        content: entry.content,
        timestamp,
      };

      const citations = sanitizeCitations(entry.citations);
      const timelineCitations = sanitizeTimelineCitations(entry.timelineCitations);
      const attachedFiles = sanitizeStringArray(entry.attachedFiles);
      const attachedImages = sanitizeAttachedImages(entry.attachedImages, false)?.map(
        (image) => ({
          name: image.name,
          mimeType: image.mimeType,
        })
      );
      const freshness = sanitizeFreshness(entry.freshness);

      if (citations) normalized.citations = citations;
      if (timelineCitations) normalized.timelineCitations = timelineCitations;
      if (attachedFiles) normalized.attachedFiles = attachedFiles;
      if (attachedImages) normalized.attachedImages = attachedImages;
      if (
        entry.answerMode === "grounded" ||
        entry.answerMode === "partial" ||
        entry.answerMode === "insufficient_evidence"
      ) {
        normalized.answerMode = entry.answerMode;
      }
      if (
        entry.sourceMode === "indexed" ||
        entry.sourceMode === "live" ||
        entry.sourceMode === "mixed"
      ) {
        normalized.sourceMode = entry.sourceMode;
      }
      if (isString(entry.resolvedCommitSha) || entry.resolvedCommitSha === null) {
        normalized.resolvedCommitSha = entry.resolvedCommitSha as string | null;
      }
      if (freshness !== undefined) normalized.freshness = freshness;

      return normalized;
    })
    .filter((message): message is PersistedChatMessage => !!message);

  return messages.slice(-maxMessages);
}

export function toChatMessage(message: PersistedChatMessage): ChatMessage {
  return {
    id: message.id,
    role: message.role,
    content: message.content,
    timestamp: new Date(message.timestamp),
    citations: message.citations,
    timelineCitations: message.timelineCitations,
    answerMode: message.answerMode,
    attachedFiles: message.attachedFiles,
    attachedImages: message.attachedImages,
    sourceMode: message.sourceMode,
    resolvedCommitSha: message.resolvedCommitSha ?? null,
    freshness: message.freshness ?? null,
  };
}

export function toChatMessages(messages: PersistedChatMessage[]): ChatMessage[] {
  return messages.map(toChatMessage);
}

export function buildConversationHistoryBlock(
  messages: PersistedChatMessage[],
  maxMessages = 8
): string {
  const recentMessages = messages.slice(-maxMessages);
  if (recentMessages.length === 0) return "";

  return recentMessages
    .map((message) => {
      const role = message.role === "assistant" ? "Assistant" : "User";
      const details: string[] = [];

      if (message.role === "assistant" && message.resolvedCommitSha) {
        details.push(`resolved commit ${message.resolvedCommitSha.slice(0, 7)}`);
      }
      if (message.role === "assistant" && message.sourceMode) {
        details.push(`source ${message.sourceMode}`);
      }

      const label = details.length > 0 ? `${role} (${details.join(", ")})` : role;
      return `${label}: ${truncatePromptText(message.content, MAX_HISTORY_CHARS)}`;
    })
    .join("\n");
}

export function findLastResolvedCommit(
  messages: PersistedChatMessage[]
): { sha: string; sourceMode: PersistedChatMessage["sourceMode"] } | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== "assistant" || !message.resolvedCommitSha) continue;
    return {
      sha: message.resolvedCommitSha,
      sourceMode: message.sourceMode,
    };
  }

  return null;
}
