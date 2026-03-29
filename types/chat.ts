export type ChatAnswerMode = "grounded" | "partial" | "insufficient_evidence";

export type ChatSourceMode = "indexed" | "live" | "mixed";

export interface ChatCitation {
  citation_id: string;
  index_version_id: string | null;
  commit_sha: string | null;
  file_path: string;
  line_start: number;
  line_end: number;
  language: string;
  snippet: string;
  retrieval_score: number;
  github_url: string | null;
}

export interface TimelineCitation {
  sha: string;
  date: string;
  committed_at: string;
  ai_summary: string;
  message: string;
  author: string;
  author_avatar_url: string | null;
  push_group_id: string | null;
  similarity: number;
}

export interface ChatAttachedImage {
  name: string;
  mimeType: string;
  dataUrl?: string;
}

export interface ChatFreshnessMeta {
  branch: string | null;
  indexedSha: string | null;
  liveHeadSha: string | null;
  stale: boolean;
  note: string | null;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
  citations?: ChatCitation[];
  timelineCitations?: TimelineCitation[];
  answerMode?: ChatAnswerMode;
  attachedFiles?: string[];
  attachedImages?: ChatAttachedImage[];
  sourceMode?: ChatSourceMode;
  resolvedCommitSha?: string | null;
  freshness?: ChatFreshnessMeta | null;
}

export interface PersistedChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
  citations?: ChatCitation[];
  timelineCitations?: TimelineCitation[];
  answerMode?: ChatAnswerMode;
  attachedFiles?: string[];
  attachedImages?: Array<Pick<ChatAttachedImage, "name" | "mimeType">>;
  sourceMode?: ChatSourceMode;
  resolvedCommitSha?: string | null;
  freshness?: ChatFreshnessMeta | null;
}
