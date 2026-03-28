"use client";

import { create } from "zustand";

export type ChatAnswerMode = "grounded" | "partial" | "insufficient_evidence";

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

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
  citations?: ChatCitation[];
  timelineCitations?: TimelineCitation[];
  answerMode?: ChatAnswerMode;
}

interface ChatState {
  messages: ChatMessage[];
  isStreaming: boolean;
  currentCitations: ChatCitation[];

  addMessage: (message: ChatMessage) => void;
  updateLastMessage: (content: string) => void;
  setLastAssistantContext: (
    citations: ChatCitation[],
    answerMode: ChatAnswerMode,
    timelineCitations?: TimelineCitation[]
  ) => void;
  setIsStreaming: (streaming: boolean) => void;
  clearChat: () => void;
}

export const useChatStore = create<ChatState>((set) => ({
  messages: [],
  isStreaming: false,
  currentCitations: [],

  addMessage: (message) =>
    set((state) => ({ messages: [...state.messages, message] })),

  updateLastMessage: (content) =>
    set((state) => {
      const messages = [...state.messages];
      if (messages.length > 0) {
        messages[messages.length - 1] = {
          ...messages[messages.length - 1],
          content,
        };
      }
      return { messages };
    }),

  setLastAssistantContext: (citations, answerMode, timelineCitations) =>
    set((state) => {
      const messages = [...state.messages];

      for (let index = messages.length - 1; index >= 0; index -= 1) {
        if (messages[index].role === "assistant") {
          messages[index] = {
            ...messages[index],
            citations,
            timelineCitations,
            answerMode,
          };
          break;
        }
      }

      return {
        messages,
        currentCitations: citations,
      };
    }),

  setIsStreaming: (streaming) => set({ isStreaming: streaming }),

  clearChat: () =>
    set({ messages: [], currentCitations: [], isStreaming: false }),
}));
