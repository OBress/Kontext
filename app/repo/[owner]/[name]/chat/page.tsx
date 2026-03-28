"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import { useChatStore, ChatMessage, ChatSource } from "@/lib/store/chat-store";
import { useAppStore } from "@/lib/store/app-store";
import {
  Send,
  Square,
  Trash2,
  FileCode,
  Copy,
  Check,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { atomDark } from "react-syntax-highlighter/dist/esm/styles/prism";

/* ═══ Suggested Questions ═══ */
function SuggestedQuestions({ onSelect }: { onSelect: (q: string) => void }) {
  const questions = [
    "Explain the project architecture",
    "What authentication method is used?",
    "List all API endpoints",
    "How is the database structured?",
  ];
  return (
    <div className="flex flex-wrap gap-2 mb-4">
      {questions.map((q) => (
        <button
          key={q}
          onClick={() => onSelect(q)}
          className="px-3 py-1.5 rounded-lg text-xs font-mono bg-[var(--alpha-white-5)] text-[var(--gray-400)] border border-[var(--alpha-white-8)] hover:text-[var(--accent-green)] hover:border-[var(--accent-green)]/30 transition-colors cursor-pointer"
        >
          {q}
        </button>
      ))}
    </div>
  );
}

/* ═══ Message Bubble ═══ */
function MessageBubble({ message }: { message: ChatMessage }) {
  const [copied, setCopied] = useState<string | null>(null);

  const handleCopy = (code: string) => {
    navigator.clipboard.writeText(code);
    setCopied(code);
    setTimeout(() => setCopied(null), 2000);
  };

  if (message.role === "user") {
    return (
      <div className="flex justify-end mb-4">
        <div className="max-w-[70%] px-4 py-3 rounded-xl bg-[var(--surface-3)] text-[var(--gray-100)] font-mono text-sm">
          {message.content}
        </div>
      </div>
    );
  }

  return (
    <div className="flex justify-start mb-4">
      <div className="max-w-[85%] px-4 py-3 rounded-xl glass border-l-2 border-[var(--accent-green)]">
        <div className="prose prose-invert prose-sm max-w-none font-mono text-sm text-[var(--gray-200)] [&_p]:m-0 [&_p]:mb-2 [&_h2]:text-[var(--gray-100)] [&_h2]:text-sm [&_h2]:mt-4 [&_h2]:mb-2 [&_h3]:text-[var(--gray-200)] [&_h3]:text-sm [&_ul]:my-1 [&_li]:my-0.5 [&_code]:text-[var(--accent-green)] [&_code]:bg-[var(--alpha-white-5)] [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded [&_strong]:text-[var(--gray-100)]">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              code({ className, children, ...props }: any) {
                const match = /language-(\w+)/.exec(className || "");
                const codeStr = String(children).replace(/\n$/, "");
                if (match) {
                  return (
                    <div className="relative group my-3">
                      <button
                        onClick={() => handleCopy(codeStr)}
                        className="absolute top-2 right-2 p-1 rounded bg-[var(--alpha-white-10)] text-[var(--gray-400)] hover:text-[var(--gray-200)] opacity-0 group-hover:opacity-100 transition-opacity border-none cursor-pointer"
                      >
                        {copied === codeStr ? <Check size={12} /> : <Copy size={12} />}
                      </button>
                      <SyntaxHighlighter
                        style={atomDark}
                        language={match[1]}
                        PreTag="div"
                        customStyle={{
                          margin: 0,
                          borderRadius: "0.5rem",
                          fontSize: "0.75rem",
                          background: "var(--surface-1)",
                        }}
                      >
                        {codeStr}
                      </SyntaxHighlighter>
                    </div>
                  );
                }
                return (
                  <code className={className} {...props}>
                    {children}
                  </code>
                );
              },
            }}
          >
            {message.content}
          </ReactMarkdown>
        </div>
        <span className="font-mono text-[10px] text-[var(--gray-600)] mt-2 block">
          {message.timestamp.toLocaleTimeString()}
        </span>
      </div>
    </div>
  );
}

/* ═══ Source Chip ═══ */
function SourceChip({ source }: { source: ChatSource }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="animate-fade-in-up">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-2 rounded-lg bg-[var(--alpha-white-5)] border border-[var(--alpha-white-8)] hover:border-[var(--accent-green)]/30 transition-colors cursor-pointer text-left"
      >
        <FileCode size={14} className="text-[var(--accent-green)] shrink-0" />
        <span className="font-mono text-xs text-[var(--gray-300)] truncate flex-1">
          {source.file_path}
        </span>
        <div className="shrink-0 w-12 h-1.5 rounded-full bg-[var(--alpha-white-8)] overflow-hidden">
          <div
            className="h-full rounded-full bg-[var(--accent-green)]"
            style={{ width: `${source.similarity * 100}%` }}
          />
        </div>
        <span className="font-mono text-[10px] text-[var(--gray-500)] shrink-0">
          {Math.round(source.similarity * 100)}%
        </span>
      </button>
      {expanded && (
        <div className="mt-1 rounded-lg overflow-hidden border border-[var(--alpha-white-5)]">
          <SyntaxHighlighter
            style={atomDark}
            language="typescript"
            showLineNumbers
            startingLineNumber={source.line_start || 1}
            customStyle={{
              margin: 0,
              fontSize: "0.7rem",
              background: "var(--surface-1)",
            }}
          >
            {source.content}
          </SyntaxHighlighter>
        </div>
      )}
    </div>
  );
}

/* ═══ Chat Input ═══ */
function ChatInput({
  onSend,
  isStreaming,
  onStop,
}: {
  onSend: (msg: string) => void;
  isStreaming: boolean;
  onStop: () => void;
}) {
  const [input, setInput] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSend = () => {
    if (!input.trim() || isStreaming) return;
    onSend(input.trim());
    setInput("");
    if (textareaRef.current) textareaRef.current.style.height = "auto";
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleInput = () => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height =
        Math.min(textareaRef.current.scrollHeight, 150) + "px";
    }
  };

  return (
    <div className="border-t border-[var(--alpha-white-5)] p-4">
      <div
        className={`flex items-end gap-2 rounded-xl border transition-colors ${
          input
            ? "border-[var(--accent-green)]/30"
            : "border-[var(--alpha-white-8)]"
        } bg-[var(--surface-1)] px-4 py-3`}
      >
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onInput={handleInput}
          onKeyDown={handleKeyDown}
          placeholder="Ask about this codebase... (⌘+Enter to send)"
          rows={1}
          className="flex-1 resize-none bg-transparent border-none outline-none font-mono text-sm text-[var(--gray-200)] placeholder:text-[var(--gray-600)]"
          style={{ maxHeight: 150 }}
        />
        {isStreaming ? (
          <button
            onClick={onStop}
            className="shrink-0 w-8 h-8 rounded-lg flex items-center justify-center bg-[var(--accent-red)]/15 text-[var(--accent-red)] border-none cursor-pointer hover:bg-[var(--accent-red)]/25 transition-colors"
          >
            <Square size={14} />
          </button>
        ) : (
          <button
            onClick={handleSend}
            disabled={!input.trim()}
            className={`shrink-0 w-8 h-8 rounded-lg flex items-center justify-center border-none cursor-pointer transition-all ${
              input.trim()
                ? "bg-[var(--accent-green)] text-black glow-green"
                : "bg-[var(--alpha-white-5)] text-[var(--gray-600)]"
            }`}
          >
            <Send size={14} />
          </button>
        )}
      </div>
    </div>
  );
}

/* ═══ Main Chat Page ═══ */
export default function ChatPage() {
  const {
    messages,
    isStreaming,
    currentSources,
    addMessage,
    updateLastMessage,
    setIsStreaming,
    setCurrentSources,
    clearChat,
  } = useChatStore();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const params = useParams<{ owner: string; name: string }>();
  const { apiKey } = useAppStore();
  const repoFullName = `${params.owner}/${params.name}`;

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = useCallback(
    async (content: string) => {
      // Add user message
      addMessage({
        id: Date.now().toString(),
        role: "user",
        content,
        timestamp: new Date(),
      });

      // Add empty assistant message
      addMessage({
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: "",
        timestamp: new Date(),
      });

      setIsStreaming(true);
      setCurrentSources([]);

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(apiKey ? { "x-google-api-key": apiKey } : {}),
          },
          body: JSON.stringify({ message: content, repo_full_name: repoFullName }),
          signal: controller.signal,
        });

        const reader = res.body?.getReader();
        const decoder = new TextDecoder();
        let accumulated = "";

        while (reader) {
          const { done, value } = await reader.read();
          if (done) break;

          const text = decoder.decode(value, { stream: true });
          const lines = text.split("\n\n");

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            try {
              const data = JSON.parse(line.slice(6));
              if (data.type === "sources") {
                setCurrentSources(data.sources);
              } else if (data.type === "text") {
                accumulated += data.content;
                updateLastMessage(accumulated);
              }
            } catch {
              // skip malformed lines
            }
          }
        }
      } catch (err: unknown) {
        const errObj = err as { name?: string };
        if (errObj.name !== "AbortError") {
          updateLastMessage("An error occurred. Please try again.");
        }
      }

      setIsStreaming(false);
      abortRef.current = null;
    },
    [addMessage, updateLastMessage, setIsStreaming, setCurrentSources, apiKey, repoFullName]
  );

  const handleStop = () => {
    abortRef.current?.abort();
    setIsStreaming(false);
  };

  return (
    <div className="flex gap-4 h-[calc(100vh-200px)] min-h-[500px]">
      {/* Chat Column */}
      <div className="flex-1 flex flex-col min-w-0 rounded-xl border border-[var(--alpha-white-5)] bg-[var(--surface-0)]">
        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4">
          {messages.length === 0 && (
            <div className="text-center py-12">
              <h3 className="font-mono text-lg text-[var(--gray-200)] mb-2 m-0">
                Ask anything about this codebase
              </h3>
              <p className="font-mono text-sm text-[var(--gray-500)] mb-6 m-0">
                AI will search through indexed files to answer your questions
              </p>
              <SuggestedQuestions onSelect={handleSend} />
            </div>
          )}

          {messages.map((msg) => (
            <MessageBubble key={msg.id} message={msg} />
          ))}

          {isStreaming && (
            <div className="flex items-center gap-2 ml-4 mb-4">
              <div className="flex gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent-green)] animate-pulse" />
                <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent-green)] animate-pulse [animation-delay:0.15s]" />
                <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent-green)] animate-pulse [animation-delay:0.3s]" />
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <ChatInput
          onSend={handleSend}
          isStreaming={isStreaming}
          onStop={handleStop}
        />
      </div>

      {/* Sources panel — desktop only */}
      <div className="hidden lg:flex w-80 flex-col rounded-xl border border-[var(--alpha-white-5)] bg-[var(--surface-0)]">
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--alpha-white-5)]">
          <h3 className="font-mono text-xs uppercase tracking-wider text-[var(--gray-500)] m-0">
            Referenced Files
            {currentSources.length > 0 && (
              <span className="ml-2 text-[var(--accent-green)]">
                ({currentSources.length})
              </span>
            )}
          </h3>
          {messages.length > 0 && (
            <button
              onClick={clearChat}
              className="text-[var(--gray-500)] hover:text-[var(--accent-red)] transition-colors bg-transparent border-none cursor-pointer"
            >
              <Trash2 size={14} />
            </button>
          )}
        </div>
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {currentSources.length === 0 ? (
            <p className="font-mono text-xs text-[var(--gray-600)] text-center py-8">
              Ask a question to see referenced files
            </p>
          ) : (
            currentSources.map((source, i) => (
              <SourceChip key={`${source.file_path}-${i}`} source={source} />
            ))
          )}
        </div>
      </div>
    </div>
  );
}
