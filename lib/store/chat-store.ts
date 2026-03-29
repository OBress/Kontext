"use client";

import { create } from "zustand";
import type {
  ChatAnswerMode,
  ChatCitation,
  ChatFreshnessMeta,
  ChatMessage,
  ChatSourceMode,
  TimelineCitation,
} from "@/types/chat";

export type {
  ChatAnswerMode,
  ChatAttachedImage,
  ChatCitation,
  ChatFreshnessMeta,
  ChatMessage,
  ChatSourceMode,
  PersistedChatMessage,
  TimelineCitation,
} from "@/types/chat";

interface LastAssistantContext {
  citations: ChatCitation[];
  answerMode: ChatAnswerMode;
  timelineCitations?: TimelineCitation[];
  sourceMode?: ChatSourceMode;
  resolvedCommitSha?: string | null;
  freshness?: ChatFreshnessMeta | null;
}

interface ChatState {
  messages: ChatMessage[];
  isStreaming: boolean;
  currentCitations: ChatCitation[];

  addMessage: (message: ChatMessage) => void;
  setMessages: (messages: ChatMessage[]) => void;
  updateLastMessage: (content: string) => void;
  setLastAssistantContext: (context: LastAssistantContext) => void;
  setIsStreaming: (streaming: boolean) => void;
  clearChat: () => void;
}

export const useChatStore = create<ChatState>((set) => ({
  messages: [],
  isStreaming: false,
  currentCitations: [],

  addMessage: (message) =>
    set((state) => ({ messages: [...state.messages, message] })),

  setMessages: (messages) =>
    set({
      messages,
      currentCitations:
        [...messages]
          .reverse()
          .find((message) => message.role === "assistant" && message.citations)
          ?.citations || [],
    }),

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

  setLastAssistantContext: ({
    citations,
    answerMode,
    timelineCitations,
    sourceMode,
    resolvedCommitSha,
    freshness,
  }) =>
    set((state) => {
      const messages = [...state.messages];

      for (let index = messages.length - 1; index >= 0; index -= 1) {
        if (messages[index].role === "assistant") {
          messages[index] = {
            ...messages[index],
            citations,
            timelineCitations,
            answerMode,
            sourceMode,
            resolvedCommitSha: resolvedCommitSha ?? null,
            freshness: freshness ?? null,
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
