"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import {
  useChatStore,
  ChatAnswerMode,
  ChatCitation,
  ChatMessage,
  TimelineCitation,
} from "@/lib/store/chat-store";
import { useAppStore } from "@/lib/store/app-store";
import { formatLineRange } from "@/lib/code";
import {
  Send,
  Square,
  Trash2,
  FileCode,
  Copy,
  Check,
  ExternalLink,
  Loader2,
  PanelRightOpen,
  X,
  GitCommit,
  History,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { atomDark } from "react-syntax-highlighter/dist/esm/styles/prism";

type InspectorMode = "snippet" | "file";

interface LoadedFile {
  content: string;
  language: string;
  github_url: string | null;
  commit_sha: string | null;
  last_indexed_at?: string | null;
}

function citationCacheKey(citation: ChatCitation): string {
  return `${citation.index_version_id ?? citation.commit_sha ?? "current"}:${citation.file_path}`;
}

function formatTimestamp(value?: string | null): string {
  if (!value) return "Unknown freshness";
  return `Indexed ${new Date(value).toLocaleString()}`;
}

function HighlightedCode({
  content,
  language,
  showLineNumbers = false,
  startingLineNumber = 1,
  selectedRange,
  compact = false,
}: {
  content: string;
  language: string;
  showLineNumbers?: boolean;
  startingLineNumber?: number;
  selectedRange?: { start: number; end: number } | null;
  compact?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!selectedRange || !containerRef.current) return;
    const target = containerRef.current.querySelector<HTMLElement>(
      `[data-line-number="${selectedRange.start}"]`
    );
    target?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [content, selectedRange]);

  return (
    <div
      ref={containerRef}
      className={compact ? "overflow-hidden rounded-xl" : "h-full overflow-auto no-scrollbar"}
    >
      <SyntaxHighlighter
        style={atomDark}
        language={language}
        PreTag="div"
        showLineNumbers={showLineNumbers}
        startingLineNumber={startingLineNumber}
        wrapLines
        wrapLongLines
        lineProps={(lineNumber: number) => {
          const isSelected =
            !!selectedRange &&
            lineNumber >= selectedRange.start &&
            lineNumber <= selectedRange.end;

          return {
            "data-line-number": String(lineNumber),
            style: {
              display: "block",
              background: isSelected ? "rgba(63, 185, 80, 0.14)" : "transparent",
              borderLeft: isSelected
                ? "2px solid rgba(63, 185, 80, 0.9)"
                : "2px solid transparent",
              paddingLeft: isSelected ? "0.75rem" : "calc(0.75rem + 2px)",
            },
          };
        }}
        customStyle={{
          margin: 0,
          minHeight: compact ? undefined : "100%",
          fontSize: compact ? "0.72rem" : "0.78rem",
          background: "transparent",
          padding: compact ? "0.75rem" : "1rem",
        }}
        codeTagProps={{
          style: { fontFamily: "var(--font-mono), ui-monospace, monospace" },
        }}
      >
        {content}
      </SyntaxHighlighter>
    </div>
  );
}

function SuggestedQuestions({ onSelect }: { onSelect: (question: string) => void }) {
  const questions = [
    "Explain the project architecture",
    "What authentication method is used?",
    "List the main API endpoints",
    "How does incremental sync work?",
  ];

  return (
    <div className="flex flex-wrap gap-2">
      {questions.map((question) => (
        <button
          key={question}
          onClick={() => onSelect(question)}
          className="rounded-xl border border-[var(--alpha-white-8)] bg-[var(--alpha-white-5)] px-3 py-2 text-left font-mono text-xs text-[var(--gray-400)] transition-colors hover:border-[var(--accent-green)]/30 hover:text-[var(--accent-green)]"
        >
          {question}
        </button>
      ))}
    </div>
  );
}

function AnswerModeBadge({ mode }: { mode?: ChatAnswerMode }) {
  if (!mode) return null;

  const styles: Record<ChatAnswerMode, string> = {
    grounded:
      "border-[var(--accent-green)]/30 bg-[var(--accent-green)]/10 text-[var(--accent-green)]",
    partial:
      "border-[var(--accent-yellow)]/30 bg-[var(--accent-yellow)]/10 text-[var(--accent-yellow)]",
    insufficient_evidence:
      "border-[var(--accent-red)]/25 bg-[var(--accent-red)]/10 text-[var(--accent-red)]",
  };

  const labels: Record<ChatAnswerMode, string> = {
    grounded: "Grounded",
    partial: "Partial evidence",
    insufficient_evidence: "Insufficient evidence",
  };

  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-1 font-mono text-[10px] uppercase tracking-[0.14em] ${styles[mode]}`}
    >
      {labels[mode]}
    </span>
  );
}

function CitationChip({
  citation,
  isSelected,
  onSelect,
}: {
  citation: ChatCitation;
  isSelected: boolean;
  onSelect: (citation: ChatCitation) => void;
}) {
  return (
    <button
      onClick={() => onSelect(citation)}
      className={`flex w-full items-start gap-3 rounded-xl border px-3 py-3 text-left transition-all ${
        isSelected
          ? "border-[var(--accent-green)]/35 bg-[var(--accent-green)]/8 shadow-[0_0_30px_rgba(63,185,80,0.06)]"
          : "border-[var(--alpha-white-8)] bg-[var(--alpha-white-5)] hover:border-[var(--accent-green)]/25"
      }`}
    >
      <div className="mt-0.5 rounded-lg bg-[var(--alpha-white-8)] p-2">
        <FileCode size={14} className="text-[var(--accent-green)]" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate font-mono text-xs text-[var(--gray-100)]">
          {citation.file_path}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-2 font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--gray-500)]">
          <span>{formatLineRange(citation.line_start, citation.line_end)}</span>
          <span>{Math.round(citation.retrieval_score * 100)}% match</span>
          <span>{citation.language}</span>
        </div>
      </div>
    </button>
  );
}

function TimelineCitationChip({
  citation,
}: {
  citation: TimelineCitation;
}) {
  const params = useParams<{ owner: string; name: string }>();

  return (
    <div className="flex w-full items-start gap-3 rounded-xl border border-purple-500/20 bg-purple-500/5 px-3 py-3 text-left">
      <div className="mt-0.5 rounded-lg bg-purple-500/15 p-2">
        <History size={14} className="text-purple-400" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="font-mono text-xs text-[var(--gray-200)] leading-relaxed">
          {citation.ai_summary}
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-2 font-mono text-[10px] text-[var(--gray-500)]">
          <span className="inline-flex items-center gap-1 rounded bg-purple-500/10 px-1.5 py-0.5 text-purple-400">
            <GitCommit size={10} />
            {citation.sha.slice(0, 7)}
          </span>
          <span>{citation.date}</span>
          <span>by {citation.author}</span>
          <span>{Math.round(citation.similarity * 100)}% match</span>
        </div>
        {params?.owner && params?.name && (
          <a
            href={`/repo/${params.owner}/${params.name}/timeline`}
            className="mt-1.5 inline-flex items-center gap-1 font-mono text-[10px] text-purple-400 hover:text-purple-300 transition-colors no-underline"
          >
            View in Timeline →
          </a>
        )}
      </div>
      {citation.author_avatar_url && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={citation.author_avatar_url}
          alt={citation.author}
          className="w-6 h-6 rounded-full shrink-0 mt-0.5"
        />
      )}
    </div>
  );
}

function MessageBubble({
  message,
  selectedCitationId,
  onSelectCitation,
}: {
  message: ChatMessage;
  selectedCitationId: string | null;
  onSelectCitation: (citation: ChatCitation) => void;
}) {
  const [copied, setCopied] = useState<string | null>(null);

  const handleCopy = (code: string) => {
    navigator.clipboard.writeText(code);
    setCopied(code);
    window.setTimeout(() => setCopied(null), 2000);
  };

  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] rounded-2xl bg-[var(--surface-3)] px-4 py-3 font-mono text-sm text-[var(--gray-100)]">
          {message.content}
        </div>
      </div>
    );
  }

  return (
    <div className="flex justify-start">
      <div className="w-full max-w-[92%] rounded-2xl border border-[var(--alpha-white-8)] bg-[var(--surface-1)] px-4 py-4 shadow-[0_18px_60px_rgba(0,0,0,0.18)]">
        <div className="mb-3 flex items-center gap-2">
          <AnswerModeBadge mode={message.answerMode} />
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--gray-600)]">
            {message.timestamp.toLocaleTimeString()}
          </span>
        </div>

        <div className="prose prose-invert prose-sm max-w-none font-mono text-sm text-[var(--gray-200)] [&_p]:m-0 [&_p]:mb-3 [&_h2]:mb-2 [&_h2]:mt-5 [&_h2]:text-sm [&_h2]:text-[var(--gray-100)] [&_h3]:mb-2 [&_h3]:mt-4 [&_h3]:text-sm [&_h3]:text-[var(--gray-100)] [&_pre]:m-0 [&_strong]:text-[var(--gray-100)] [&_ul]:my-2">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              code({ className, children, ...props }: any) {
                const match = /language-(\w+)/.exec(className || "");
                const codeString = String(children).replace(/\n$/, "");

                if (!match) {
                  return (
                    <code
                      className="rounded bg-[var(--alpha-white-5)] px-1 py-0.5 text-[var(--accent-green)]"
                      {...props}
                    >
                      {children}
                    </code>
                  );
                }

                return (
                  <div className="group relative my-4 overflow-hidden rounded-xl border border-[var(--alpha-white-8)] bg-[var(--surface-0)]">
                    <button
                      onClick={() => handleCopy(codeString)}
                      className="absolute right-3 top-3 z-10 rounded-lg border border-[var(--alpha-white-8)] bg-[var(--surface-2)] p-1 text-[var(--gray-400)] opacity-0 transition-opacity group-hover:opacity-100 hover:text-[var(--gray-100)]"
                    >
                      {copied === codeString ? <Check size={12} /> : <Copy size={12} />}
                    </button>
                    <HighlightedCode
                      content={codeString}
                      language={match[1]}
                      compact
                    />
                  </div>
                );
              },
            }}
          >
            {message.content}
          </ReactMarkdown>
        </div>

        {message.citations && message.citations.length > 0 && (
          <div className="mt-4 space-y-2">
            <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--gray-500)]">
              Citations
            </div>
            <div className="space-y-2">
              {message.citations.map((citation) => (
                <CitationChip
                  key={citation.citation_id}
                  citation={citation}
                  isSelected={selectedCitationId === citation.citation_id}
                  onSelect={onSelectCitation}
                />
              ))}
            </div>
          </div>
        )}

        {message.timelineCitations && message.timelineCitations.length > 0 && (
          <div className="mt-4 space-y-2">
            <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--gray-500)]">
              Timeline
            </div>
            <div className="space-y-2">
              {message.timelineCitations.map((tc) => (
                <TimelineCitationChip key={tc.sha} citation={tc} />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ChatInput({
  onSend,
  isStreaming,
  onStop,
}: {
  onSend: (message: string) => void;
  isStreaming: boolean;
  onStop: () => void;
}) {
  const [input, setInput] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSend = () => {
    if (!input.trim() || isStreaming) return;
    onSend(input.trim());
    setInput("");

    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      handleSend();
    }
  };

  const handleInput = () => {
    if (!textareaRef.current) return;
    textareaRef.current.style.height = "auto";
    textareaRef.current.style.height = `${Math.min(
      textareaRef.current.scrollHeight,
      180
    )}px`;
  };

  return (
    <div className="border-t border-[var(--alpha-white-8)] p-4">
      <div className="rounded-2xl border border-[var(--alpha-white-8)] bg-[var(--surface-1)] px-4 py-3">
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onInput={handleInput}
          onKeyDown={handleKeyDown}
          rows={1}
          placeholder="Ask about this codebase... (Cmd/Ctrl + Enter to send)"
          className="min-h-[28px] w-full resize-none bg-transparent font-mono text-sm text-[var(--gray-200)] outline-none placeholder:text-[var(--gray-600)]"
          style={{ maxHeight: 180 }}
        />
        <div className="mt-3 flex items-center justify-between">
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--gray-600)]">
            Grounded answers with code citations
          </span>
          {isStreaming ? (
            <button
              onClick={onStop}
              className="inline-flex items-center gap-2 rounded-xl bg-[var(--accent-red)]/12 px-3 py-2 font-mono text-xs text-[var(--accent-red)] transition-colors hover:bg-[var(--accent-red)]/18"
            >
              <Square size={12} />
              Stop
            </button>
          ) : (
            <button
              onClick={handleSend}
              disabled={!input.trim()}
              className={`inline-flex items-center gap-2 rounded-xl px-3 py-2 font-mono text-xs transition-all ${
                input.trim()
                  ? "bg-[var(--accent-green)] text-black shadow-[0_0_30px_rgba(63,185,80,0.18)]"
                  : "bg-[var(--alpha-white-5)] text-[var(--gray-600)]"
              }`}
            >
              <Send size={12} />
              Send
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function InspectorPanel({
  citation,
  mode,
  onModeChange,
  fileData,
  isLoading,
  error,
  lastIndexedAt,
}: {
  citation: ChatCitation | null;
  mode: InspectorMode;
  onModeChange: (mode: InspectorMode) => void;
  fileData: LoadedFile | null;
  isLoading: boolean;
  error: string | null;
  lastIndexedAt?: string | null;
}) {
  const githubUrl = fileData?.github_url || citation?.github_url || null;
  const commitSha = fileData?.commit_sha || citation?.commit_sha || null;
  const content = useMemo(() => {
    if (!citation) return null;
    if (mode === "file" && fileData?.content) return fileData.content;
    return citation.snippet;
  }, [citation, fileData, mode]);

  const language = fileData?.language || citation?.language || "text";
  const selectedRange = citation
    ? { start: citation.line_start, end: citation.line_end }
    : null;

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-[var(--alpha-white-8)] px-4 py-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--gray-500)]">
              Code Inspector
            </div>
            {citation ? (
              <>
                <div className="mt-2 truncate font-mono text-sm text-[var(--gray-100)]">
                  {citation.file_path}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-2 font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--gray-500)]">
                  <span>{formatLineRange(citation.line_start, citation.line_end)}</span>
                  <span>{citation.language}</span>
                  {commitSha && <span>commit {commitSha.slice(0, 7)}</span>}
                </div>
              </>
            ) : (
              <div className="mt-2 font-mono text-xs text-[var(--gray-500)]">
                Select a citation to inspect the code here.
              </div>
            )}
          </div>

          {githubUrl && (
            <a
              href={githubUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 rounded-xl border border-[var(--alpha-white-8)] bg-[var(--alpha-white-5)] px-3 py-2 font-mono text-xs text-[var(--gray-300)] transition-colors hover:border-[var(--accent-green)]/30 hover:text-[var(--accent-green)]"
            >
              <ExternalLink size={12} />
              GitHub
            </a>
          )}
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button
            onClick={() => onModeChange("snippet")}
            className={`rounded-xl px-3 py-2 font-mono text-xs transition-colors ${
              mode === "snippet"
                ? "bg-[var(--accent-green)] text-black"
                : "border border-[var(--alpha-white-8)] bg-[var(--alpha-white-5)] text-[var(--gray-400)]"
            }`}
          >
            Snippet
          </button>
          <button
            onClick={() => onModeChange("file")}
            className={`rounded-xl px-3 py-2 font-mono text-xs transition-colors ${
              mode === "file"
                ? "bg-[var(--accent-green)] text-black"
                : "border border-[var(--alpha-white-8)] bg-[var(--alpha-white-5)] text-[var(--gray-400)]"
            }`}
          >
            Full File
          </button>
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--gray-600)]">
            {formatTimestamp(fileData?.last_indexed_at || lastIndexedAt)}
          </span>
        </div>
      </div>

      <div className="min-h-0 flex-1 bg-[radial-gradient(circle_at_top,rgba(63,185,80,0.08),transparent_38%),var(--surface-0)]">
        {!citation && (
          <div className="flex h-full items-center justify-center px-6 text-center">
            <div>
              <div className="mb-2 font-mono text-sm text-[var(--gray-200)]">
                Citation-powered code review
              </div>
              <p className="m-0 font-mono text-xs leading-relaxed text-[var(--gray-500)]">
                Ask a question, then click a citation chip to inspect the exact
                code span and open the indexed GitHub lines.
              </p>
            </div>
          </div>
        )}

        {citation && mode === "file" && isLoading && !fileData?.content && (
          <div className="flex h-full items-center justify-center gap-3 font-mono text-xs text-[var(--gray-400)]">
            <Loader2 size={14} className="animate-spin text-[var(--accent-green)]" />
            Loading file contents...
          </div>
        )}

        {citation && error && mode === "file" && !fileData?.content && (
          <div className="flex h-full items-center justify-center px-6 text-center">
            <p className="m-0 font-mono text-xs leading-relaxed text-[var(--accent-red)]">
              {error}
            </p>
          </div>
        )}

        {citation && content && !(mode === "file" && isLoading && !fileData?.content) && (
          <HighlightedCode
            content={content}
            language={language}
            showLineNumbers
            startingLineNumber={mode === "snippet" ? citation.line_start : 1}
            selectedRange={selectedRange}
          />
        )}
      </div>
    </div>
  );
}

export default function ChatPage() {
  const {
    messages,
    isStreaming,
    currentCitations,
    addMessage,
    updateLastMessage,
    setLastAssistantContext,
    setIsStreaming,
    clearChat,
  } = useChatStore();
  const params = useParams<{ owner: string; name: string }>();
  const repoFullName = `${params.owner}/${params.name}`;
  const { apiKey, repos } = useAppStore();
  const repo = repos.find((entry) => entry.full_name === repoFullName);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [selectedCitation, setSelectedCitation] = useState<ChatCitation | null>(null);
  const [inspectorMode, setInspectorMode] = useState<InspectorMode>("snippet");
  const [mobileInspectorOpen, setMobileInspectorOpen] = useState(false);
  const [fileCache, setFileCache] = useState<Record<string, LoadedFile>>({});
  const [fileErrors, setFileErrors] = useState<Record<string, string>>({});
  const [loadingFileKey, setLoadingFileKey] = useState<string | null>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    clearChat();
    setSelectedCitation(null);
    setInspectorMode("snippet");
    setMobileInspectorOpen(false);
    setFileCache({});
    setFileErrors({});
  }, [clearChat, repoFullName]);

  const loadCitationFile = useCallback(
    async (citation: ChatCitation) => {
      const cacheKey = citationCacheKey(citation);
      if (fileCache[cacheKey] || loadingFileKey === cacheKey) return;

      setLoadingFileKey(cacheKey);
      setFileErrors((state) => {
        const next = { ...state };
        delete next[cacheKey];
        return next;
      });

      try {
        const search = new URLSearchParams({
          repo: repoFullName,
          path: citation.file_path,
        });
        if (citation.commit_sha) search.set("sha", citation.commit_sha);

        const response = await fetch(`/api/repos/file?${search.toString()}`);
        if (!response.ok) {
          const payload = await response.json().catch(() => null);
          throw new Error(
            payload?.error?.message || "Unable to load file for this citation"
          );
        }

        const data = (await response.json()) as LoadedFile;
        setFileCache((state) => ({ ...state, [cacheKey]: data }));
      } catch (error: unknown) {
        const message =
          error instanceof Error ? error.message : "Unable to load file";
        setFileErrors((state) => ({ ...state, [cacheKey]: message }));
      } finally {
        setLoadingFileKey((current) => (current === cacheKey ? null : current));
      }
    },
    [fileCache, loadingFileKey, repoFullName]
  );

  const selectCitation = useCallback(
    (citation: ChatCitation, openMobile = false) => {
      setSelectedCitation(citation);
      setInspectorMode("snippet");
      void loadCitationFile(citation);
      if (openMobile) setMobileInspectorOpen(true);
    },
    [loadCitationFile]
  );

  useEffect(() => {
    if (!selectedCitation) return;
    void loadCitationFile(selectedCitation);
  }, [loadCitationFile, selectedCitation]);

  const handleSend = useCallback(
    async (content: string) => {
      addMessage({
        id: `${Date.now()}-user`,
        role: "user",
        content,
        timestamp: new Date(),
      });
      addMessage({
        id: `${Date.now()}-assistant`,
        role: "assistant",
        content: "",
        timestamp: new Date(),
      });
      setIsStreaming(true);

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const response = await fetch("/api/chat", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(apiKey ? { "x-google-api-key": apiKey } : {}),
          },
          body: JSON.stringify({ message: content, repo_full_name: repoFullName }),
          signal: controller.signal,
        });

        if (!response.ok) {
          const payload = await response.json().catch(() => null);
          throw new Error(payload?.error?.message || "Chat request failed");
        }

        const reader = response.body?.getReader();
        if (!reader) throw new Error("Chat response body was empty");

        const decoder = new TextDecoder();
        let accumulated = "";
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          while (buffer.includes("\n\n")) {
            const boundary = buffer.indexOf("\n\n");
            const rawEvent = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary + 2);

            const lines = rawEvent
              .split("\n")
              .filter((line) => line.startsWith("data: "));

            for (const line of lines) {
              const data = JSON.parse(line.slice(6));

              if (data.type === "context") {
                setLastAssistantContext(
                  data.citations || [],
                  data.answerMode,
                  data.timelineCitations || []
                );
                if (data.citations?.[0]) {
                  selectCitation(data.citations[0]);
                } else {
                  setSelectedCitation(null);
                }
              }

              if (data.type === "text") {
                accumulated += data.content;
                updateLastMessage(accumulated);
              }

              if (data.type === "error") {
                throw new Error(data.message || "Streaming chat failed");
              }
            }
          }
        }
      } catch (error: unknown) {
        const err = error as { name?: string };
        if (err.name !== "AbortError") {
          updateLastMessage(
            error instanceof Error
              ? error.message
              : "An error occurred. Please try again."
          );
        }
      } finally {
        setIsStreaming(false);
        abortRef.current = null;
      }
    },
    [
      addMessage,
      apiKey,
      repoFullName,
      selectCitation,
      setIsStreaming,
      setLastAssistantContext,
      updateLastMessage,
    ]
  );

  const handleStop = () => {
    abortRef.current?.abort();
    setIsStreaming(false);
  };

  const handleClearChat = () => {
    clearChat();
    setSelectedCitation(null);
    setInspectorMode("snippet");
    setMobileInspectorOpen(false);
  };

  const selectedFile = selectedCitation
    ? fileCache[citationCacheKey(selectedCitation)] || null
    : null;
  const selectedFileError = selectedCitation
    ? fileErrors[citationCacheKey(selectedCitation)] || null
    : null;
  const selectedFileLoading = selectedCitation
    ? loadingFileKey === citationCacheKey(selectedCitation)
    : false;

  return (
    <>
      <div className="grid min-h-[620px] gap-4 lg:h-[calc(100vh-200px)] lg:grid-cols-[minmax(0,1.05fr)_minmax(360px,0.95fr)]">
        <div className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-[var(--alpha-white-8)] bg-[radial-gradient(circle_at_top,rgba(63,185,80,0.08),transparent_42%),var(--surface-0)] shadow-[0_24px_80px_rgba(0,0,0,0.2)]">
          <div className="flex items-center justify-between gap-3 border-b border-[var(--alpha-white-8)] px-4 py-4">
            <div>
              <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--gray-500)]">
                Repo Chat
              </div>
              <h2 className="m-0 mt-2 font-mono text-sm text-[var(--gray-100)]">
                Grounded answers with clickable citations
              </h2>
            </div>
            <div className="flex items-center gap-2">
              {selectedCitation && (
                <button
                  onClick={() => setMobileInspectorOpen(true)}
                  className="inline-flex items-center gap-2 rounded-xl border border-[var(--alpha-white-8)] bg-[var(--alpha-white-5)] px-3 py-2 font-mono text-xs text-[var(--gray-300)] lg:hidden"
                >
                  <PanelRightOpen size={12} />
                  Inspector
                </button>
              )}
              {messages.length > 0 && (
                <button
                  onClick={handleClearChat}
                  className="inline-flex items-center gap-2 rounded-xl border border-[var(--alpha-white-8)] bg-[var(--alpha-white-5)] px-3 py-2 font-mono text-xs text-[var(--gray-400)] transition-colors hover:text-[var(--accent-red)]"
                >
                  <Trash2 size={12} />
                  Clear
                </button>
              )}
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5">
            {messages.length === 0 && (
              <div className="mx-auto max-w-2xl py-12">
                <h3 className="m-0 font-mono text-xl text-[var(--gray-100)]">
                  Ask anything about this repository
                </h3>
                <p className="mb-6 mt-3 font-mono text-sm leading-relaxed text-[var(--gray-500)]">
                  Kontext will answer from indexed code, attach citations, and
                  open the relevant span in the inspector on the right.
                </p>
                <SuggestedQuestions onSelect={handleSend} />
              </div>
            )}

            <div className="space-y-5">
              {messages.map((message) => (
                <MessageBubble
                  key={message.id}
                  message={message}
                  selectedCitationId={selectedCitation?.citation_id || null}
                  onSelectCitation={(citation) =>
                    selectCitation(citation, window.innerWidth < 1024)
                  }
                />
              ))}
            </div>

            {isStreaming && (
              <div className="mt-4 flex items-center gap-2 pl-4">
                <div className="flex gap-1">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--accent-green)]" />
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--accent-green)] [animation-delay:0.15s]" />
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--accent-green)] [animation-delay:0.3s]" />
                </div>
                <span className="font-mono text-[11px] text-[var(--gray-500)]">
                  Searching indexed code...
                </span>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          <ChatInput
            onSend={handleSend}
            isStreaming={isStreaming}
            onStop={handleStop}
          />
        </div>

        <div className="hidden min-h-0 overflow-hidden rounded-2xl border border-[var(--alpha-white-8)] bg-[var(--surface-0)] shadow-[0_24px_80px_rgba(0,0,0,0.2)] lg:flex">
          <InspectorPanel
            citation={selectedCitation}
            mode={inspectorMode}
            onModeChange={setInspectorMode}
            fileData={selectedFile}
            isLoading={selectedFileLoading}
            error={selectedFileError}
            lastIndexedAt={repo?.last_indexed_at}
          />
        </div>
      </div>

      {mobileInspectorOpen && selectedCitation && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm lg:hidden">
          <div className="absolute inset-x-0 bottom-0 top-16 overflow-hidden rounded-t-[1.5rem] border border-[var(--alpha-white-8)] bg-[var(--surface-0)] shadow-[0_-24px_80px_rgba(0,0,0,0.35)]">
            <div className="flex items-center justify-between border-b border-[var(--alpha-white-8)] px-4 py-3">
              <div className="font-mono text-xs text-[var(--gray-300)]">
                Citation Inspector
              </div>
              <button
                onClick={() => setMobileInspectorOpen(false)}
                className="rounded-xl border border-[var(--alpha-white-8)] bg-[var(--alpha-white-5)] p-2 text-[var(--gray-400)]"
              >
                <X size={14} />
              </button>
            </div>
            <div className="h-[calc(100%-57px)]">
              <InspectorPanel
                citation={selectedCitation}
                mode={inspectorMode}
                onModeChange={setInspectorMode}
                fileData={selectedFile}
                isLoading={selectedFileLoading}
                error={selectedFileError}
                lastIndexedAt={repo?.last_indexed_at}
              />
            </div>
          </div>
        </div>
      )}

      {currentCitations.length > 0 && !selectedCitation && (
        <div className="mt-3 font-mono text-xs text-[var(--gray-500)]">
          Select a citation to inspect the code.
        </div>
      )}
    </>
  );
}
