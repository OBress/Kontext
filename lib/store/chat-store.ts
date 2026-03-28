"use client";

import { create } from "zustand";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
  sources?: ChatSource[];
}

export interface ChatSource {
  file_path: string;
  content: string;
  similarity: number;
  line_start?: number;
  line_end?: number;
}

interface ChatState {
  messages: ChatMessage[];
  isStreaming: boolean;
  currentSources: ChatSource[];

  addMessage: (message: ChatMessage) => void;
  updateLastMessage: (content: string) => void;
  setIsStreaming: (streaming: boolean) => void;
  setCurrentSources: (sources: ChatSource[]) => void;
  clearChat: () => void;
}

export const useChatStore = create<ChatState>((set) => ({
  messages: [],
  isStreaming: false,
  currentSources: [],

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

  setIsStreaming: (streaming) => set({ isStreaming: streaming }),

  setCurrentSources: (sources) => set({ currentSources: sources }),

  clearChat: () =>
    set({ messages: [], currentSources: [], isStreaming: false }),
}));
