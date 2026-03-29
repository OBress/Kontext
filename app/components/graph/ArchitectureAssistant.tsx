"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { createPortal } from "react-dom";
import {
  FileCode,
  Loader2,
  MessageCircleMore,
  Send,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { formatLineRange } from "@/lib/code";
import type { ArchitectureLayerId } from "@/types/architecture";
import type { ArchitectureAssistantAction } from "@/lib/api/architecture-actions";
import type { ArchitectureAssistantViewportState } from "@/lib/graph/architecture-focus";
import {
  clampAssistantWindowPosition,
  clampAssistantWindowSize,
  DEFAULT_ASSISTANT_HEIGHT,
  DEFAULT_ASSISTANT_WIDTH,
  getDefaultAssistantWindowPosition,
  type AssistantViewport,
} from "@/lib/graph/architecture-assistant-window";
import type { ChatAnswerMode, ChatCitation } from "@/lib/store/chat-store";
import { RichMarkdownMessage } from "@/app/components/chat/RichMarkdownMessage";

interface AssistantMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  citations?: ChatCitation[];
  answerMode?: ChatAnswerMode;
  playbackSummary?: string | null;
}

const STORAGE_KEY = "kontext.architecture.assistant.window.v1";

function getViewport(): AssistantViewport {
  if (typeof window === "undefined") {
    return { width: 1440, height: 960 };
  }

  return {
    width: window.innerWidth,
    height: window.innerHeight,
  };
}

function answerModeLabel(mode?: ChatAnswerMode) {
  if (!mode) return null;
  if (mode === "grounded") return "grounded";
  if (mode === "partial") return "partial";
  return "limited evidence";
}

function CitationChip({
  citation,
  onSelect,
}: {
  citation: ChatCitation;
  onSelect: (citation: ChatCitation) => void;
}) {
  const hasRealRange = !(citation.line_start === 1 && citation.line_end === 1);

  return (
    <button
      onClick={() => onSelect(citation)}
      className="architecture-assistant__citation"
      title={citation.file_path}
    >
      <FileCode size={11} className="shrink-0" />
      <span className="truncate">{citation.file_path}</span>
      {hasRealRange && (
        <span className="architecture-assistant__citation-meta">
          {formatLineRange(citation.line_start, citation.line_end)}
        </span>
      )}
    </button>
  );
}

export function ArchitectureAssistant({
  repoFullName,
  apiKey,
  layer,
  open,
  onClose,
  onClearChat,
  onViewportStateChange,
  onAction,
  onOpenCitation,
  onOpenFilePath,
}: {
  repoFullName: string;
  apiKey: string | null;
  layer: ArchitectureLayerId;
  open: boolean;
  onClose: () => void;
  onClearChat: () => void;
  onViewportStateChange: (state: ArchitectureAssistantViewportState | null) => void;
  onAction: (action: ArchitectureAssistantAction) => void;
  onOpenCitation: (citation: ChatCitation) => void;
  onOpenFilePath: (filePath: string, lineStart?: number, lineEnd?: number) => void;
}) {
  const [mounted, setMounted] = useState(false);
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [size, setSize] = useState({
    width: DEFAULT_ASSISTANT_WIDTH,
    height: DEFAULT_ASSISTANT_HEIGHT,
  });
  const [position, setPosition] = useState({ x: 24, y: 96 });
  const endRef = useRef<HTMLDivElement>(null);
  const streamAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    return () => {
      streamAbortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (!mounted || !open) {
      onViewportStateChange(null);
      return;
    }

    onViewportStateChange({
      open,
      isMobile,
      width: size.width,
    });
  }, [isMobile, mounted, onViewportStateChange, open, size.width]);

  useEffect(() => {
    if (!mounted) return;

    const updateMobile = () => {
      setIsMobile(window.innerWidth <= 900);
    };

    updateMobile();
    window.addEventListener("resize", updateMobile);
    return () => window.removeEventListener("resize", updateMobile);
  }, [mounted]);

  useEffect(() => {
    if (!mounted || !open || isMobile) return;

    const saved =
      typeof window !== "undefined" ? window.localStorage.getItem(STORAGE_KEY) : null;

    if (saved) {
      try {
        const parsed = JSON.parse(saved) as {
          position?: { x: number; y: number };
          size?: { width: number; height: number };
        };
        const viewport = getViewport();
        const nextSize = clampAssistantWindowSize(
          parsed.size || {
            width: DEFAULT_ASSISTANT_WIDTH,
            height: DEFAULT_ASSISTANT_HEIGHT,
          },
          viewport
        );
        setSize(nextSize);
        setPosition(
          clampAssistantWindowPosition(
            parsed.position || getDefaultAssistantWindowPosition(nextSize, viewport),
            nextSize,
            viewport
          )
        );
        return;
      } catch {
        // Ignore malformed persisted state and fall back to defaults.
      }
    }

    const viewport = getViewport();
    const nextSize = clampAssistantWindowSize(
      { width: DEFAULT_ASSISTANT_WIDTH, height: DEFAULT_ASSISTANT_HEIGHT },
      viewport
    );
    setSize(nextSize);
    setPosition(getDefaultAssistantWindowPosition(nextSize, viewport));
  }, [isMobile, mounted, open]);

  useEffect(() => {
    if (!mounted || !open || isMobile) return;
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        position,
        size,
      })
    );
  }, [isMobile, mounted, open, position, size]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isStreaming]);

  useEffect(() => {
    if (!mounted || !open || isMobile) return;

    const handleResize = () => {
      const viewport = getViewport();
      setSize((current) => {
        const nextSize = clampAssistantWindowSize(current, viewport);
        setPosition((currentPosition) =>
          clampAssistantWindowPosition(currentPosition, nextSize, viewport)
        );
        return nextSize;
      });
    };

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [isMobile, mounted, open]);

  const sendPrompt = useCallback(
    async (prompt: string) => {
      if (!apiKey || !prompt.trim() || isStreaming) return;

      const trimmedPrompt = prompt.trim();
      const userMessage: AssistantMessage = {
        id: `user-${Date.now()}`,
        role: "user",
        content: trimmedPrompt,
      };
      const assistantId = `assistant-${Date.now()}`;

      setMessages((prev) => [
        ...prev,
        userMessage,
        { id: assistantId, role: "assistant", content: "" },
      ]);
      setInput("");
      setIsStreaming(true);

      let assistantContent = "";
      const abortController = new AbortController();
      streamAbortRef.current = abortController;

      try {
        const response = await fetch("/api/graph/assistant", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-google-api-key": apiKey,
          },
          signal: abortController.signal,
          body: JSON.stringify({
            repo_full_name: repoFullName,
            message: trimmedPrompt,
            layer,
          }),
        });

        if (!response.ok || !response.body) {
          throw new Error("Assistant request failed");
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            const dataLine = line.replace(/^data: /, "").trim();
            if (!dataLine) continue;

            const payload = JSON.parse(dataLine) as
              | {
                  type: "context";
                  citations: ChatCitation[];
                  answerMode: ChatAnswerMode;
                }
              | { type: "action"; action: ArchitectureAssistantAction }
              | { type: "text"; content: string }
              | { type: "done" };

            if (payload.type === "context") {
              setMessages((prev) =>
                prev.map((message) =>
                  message.id === assistantId
                    ? {
                        ...message,
                        citations: payload.citations,
                        answerMode: payload.answerMode,
                      }
                    : message
                )
              );
              continue;
            }

            if (payload.type === "action") {
              const action = payload.action;

              if (action.type === "simulate_flow") {
                setMessages((prev) =>
                  prev.map((message) =>
                    message.id === assistantId
                      ? {
                          ...message,
                          playbackSummary: action.summary,
                        }
                      : message
                  )
                );
              }
              onAction(action);
              continue;
            }

            if (payload.type === "text") {
              assistantContent += payload.content;
              setMessages((prev) =>
                prev.map((message) =>
                  message.id === assistantId
                    ? { ...message, content: assistantContent }
                    : message
                )
              );
            }
          }
        }
      } catch (error) {
        if (abortController.signal.aborted) {
          return;
        }
        const messageText =
          error instanceof Error ? error.message : "Assistant request failed";
        setMessages((prev) =>
          prev.map((message) =>
            message.id === assistantId ? { ...message, content: messageText } : message
          )
        );
      } finally {
        if (streamAbortRef.current === abortController) {
          streamAbortRef.current = null;
          setIsStreaming(false);
        }
      }
    },
    [apiKey, isStreaming, layer, onAction, repoFullName]
  );

  const handleClearChat = useCallback(() => {
    streamAbortRef.current?.abort();
    streamAbortRef.current = null;
    setMessages([]);
    setInput("");
    setIsStreaming(false);
    onClearChat();
  }, [onClearChat]);

  const handleHeaderPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (isMobile) return;
      if ((event.target as HTMLElement).closest("button")) return;

      const startPointer = { x: event.clientX, y: event.clientY };
      const startPosition = position;
      const viewport = getViewport();
      const nextSize = clampAssistantWindowSize(size, viewport);

      const handlePointerMove = (moveEvent: PointerEvent) => {
        const deltaX = moveEvent.clientX - startPointer.x;
        const deltaY = moveEvent.clientY - startPointer.y;
        setPosition(
          clampAssistantWindowPosition(
            {
              x: startPosition.x + deltaX,
              y: startPosition.y + deltaY,
            },
            nextSize,
            viewport
          )
        );
      };

      const handlePointerUp = () => {
        window.removeEventListener("pointermove", handlePointerMove);
        window.removeEventListener("pointerup", handlePointerUp);
      };

      window.addEventListener("pointermove", handlePointerMove);
      window.addEventListener("pointerup", handlePointerUp);
    },
    [isMobile, position, size]
  );

  const handleResizePointerDown = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      if (isMobile) return;

      event.preventDefault();
      event.stopPropagation();

      const startPointer = { x: event.clientX, y: event.clientY };
      const startSize = size;
      const startPosition = position;
      const viewport = getViewport();

      const handlePointerMove = (moveEvent: PointerEvent) => {
        const deltaX = moveEvent.clientX - startPointer.x;
        const deltaY = moveEvent.clientY - startPointer.y;
        const nextSize = clampAssistantWindowSize(
          {
            width: startSize.width + deltaX,
            height: startSize.height + deltaY,
          },
          viewport
        );

        setSize(nextSize);
        setPosition(clampAssistantWindowPosition(startPosition, nextSize, viewport));
      };

      const handlePointerUp = () => {
        window.removeEventListener("pointermove", handlePointerMove);
        window.removeEventListener("pointerup", handlePointerUp);
      };

      window.addEventListener("pointermove", handlePointerMove);
      window.addEventListener("pointerup", handlePointerUp);
    },
    [isMobile, position, size]
  );

  const windowStyle = useMemo<CSSProperties>(() => {
    if (isMobile) return {};
    return {
      width: `${size.width}px`,
      height: `${size.height}px`,
      left: `${position.x}px`,
      top: `${position.y}px`,
    };
  }, [isMobile, position.x, position.y, size.height, size.width]);

  const renderBody = useMemo(() => {
    if (!open) return null;

    return (
      <div
        className={`architecture-assistant architecture-assistant--floating nowheel nopan ${
          isMobile ? "architecture-assistant--mobile" : ""
        }`}
        style={windowStyle}
        onWheelCapture={(event) => event.stopPropagation()}
      >
        <div
          className="architecture-assistant__header architecture-assistant__header--drag"
          onPointerDown={handleHeaderPointerDown}
        >
          <div>
            <div className="architecture-assistant__eyebrow">Architecture Assistant</div>
            <div className="architecture-assistant__title">Graph-aware copilot</div>
          </div>
          <div className="architecture-assistant__header-actions">
            {messages.length > 0 && (
              <button onClick={handleClearChat} className="architecture-assistant__clear">
                <Trash2 size={13} />
                Clear
              </button>
            )}
            <button onClick={onClose} className="architecture-assistant__close">
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="architecture-assistant__messages">
          {messages.length === 0 && (
            <div className="architecture-assistant__empty">
              <Sparkles size={18} />
              <p>Ask where a feature lives, trace a flow, or simulate how a message moves through the graph.</p>
              <div className="architecture-assistant__suggestions">
                {[
                  "Where is the user sending chat messages?",
                  "Show the code path for chat messages",
                  "Simulate a message being sent from the UI to storage",
                ].map((suggestion) => (
                  <button
                    key={suggestion}
                    onClick={() => void sendPrompt(suggestion)}
                    className="architecture-assistant__suggestion"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((message) => (
            <div
              key={message.id}
              className={`architecture-assistant__message architecture-assistant__message--${message.role}`}
            >
              {message.role === "assistant" ? (
                <>
                  <div className="architecture-assistant__message-frame">
                    <div className="architecture-assistant__message-brand">
                      <div className="architecture-assistant__brand-mark" />
                      <span>Kontext</span>
                      {answerModeLabel(message.answerMode) && (
                        <span className="architecture-assistant__mode-pill">
                          {answerModeLabel(message.answerMode)}
                        </span>
                      )}
                    </div>
                    <RichMarkdownMessage content={message.content || (isStreaming ? "Thinking..." : "")} onOpenFilePath={onOpenFilePath} />
                  </div>

                  {message.playbackSummary && (
                    <div className="architecture-assistant__playback">
                      {message.playbackSummary}
                    </div>
                  )}

                  {message.citations && message.citations.length > 0 && (
                    <div className="architecture-assistant__citations">
                      {message.citations.slice(0, 8).map((citation) => (
                        <CitationChip
                          key={citation.citation_id}
                          citation={citation}
                          onSelect={onOpenCitation}
                        />
                      ))}
                    </div>
                  )}
                </>
              ) : (
                <div className="architecture-assistant__message-frame architecture-assistant__message-frame--user">
                  <div className="architecture-assistant__user-text">{message.content}</div>
                </div>
              )}
            </div>
          ))}

          {isStreaming && messages[messages.length - 1]?.role !== "assistant" && (
            <div className="architecture-assistant__streaming">
              <Loader2 size={14} className="animate-spin" />
              Searching indexed code...
            </div>
          )}
          <div ref={endRef} />
        </div>

        <div className="architecture-assistant__composer">
          <textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void sendPrompt(input);
              }
            }}
            placeholder={
              apiKey ? "Ask the architecture copilot..." : "Set your AI key to use the assistant"
            }
            disabled={!apiKey || isStreaming}
            rows={1}
          />
          <button
            onClick={() => void sendPrompt(input)}
            disabled={!apiKey || !input.trim() || isStreaming}
            className="architecture-assistant__send"
          >
            {isStreaming ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
          </button>
        </div>

        {!isMobile && (
          <button
            type="button"
            className="architecture-assistant__resize-handle"
            onPointerDown={handleResizePointerDown}
            aria-label="Resize assistant window"
            tabIndex={-1}
          />
        )}
      </div>
    );
  }, [
    apiKey,
    handleClearChat,
    handleHeaderPointerDown,
    handleResizePointerDown,
    input,
    isMobile,
    isStreaming,
    messages,
    onClose,
    onOpenCitation,
    onOpenFilePath,
    open,
    sendPrompt,
    windowStyle,
  ]);

  if (!mounted || !open) return null;

  return createPortal(renderBody, document.body);
}

export function ArchitectureAssistantFab({
  open,
  onClick,
}: {
  open: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className="architecture-assistant-fab"
      onClick={onClick}
      title={open ? "Close architecture assistant" : "Open architecture assistant"}
    >
      {open ? <X size={18} /> : <MessageCircleMore size={18} />}
    </button>
  );
}
