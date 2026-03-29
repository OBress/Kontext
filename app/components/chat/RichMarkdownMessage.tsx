"use client";

import { useState } from "react";
import { Check, Copy, FileCode } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { atomDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import { ChatVisualBlock } from "@/app/components/chat/ChatVisualBlocks";
import { cn } from "@/lib/utils";
import { isChatVisualLanguage } from "@/types/chat-visuals";

export const FILE_PATH_REGEX =
  /^[\w@.-]+(?:\/[\w@.-]+)+\.[a-zA-Z]{1,10}(?::L?(\d+)(?:[-–](\d+))?)?$/;

export function RichMarkdownMessage({
  content,
  className,
  onOpenFilePath,
}: {
  content: string;
  className?: string;
  onOpenFilePath?: (filePath: string, lineStart?: number, lineEnd?: number) => void;
}) {
  const [copied, setCopied] = useState<string | null>(null);

  const handleCopy = (code: string) => {
    void navigator.clipboard.writeText(code);
    setCopied(code);
    window.setTimeout(() => setCopied(null), 2000);
  };

  return (
    <div
      className={cn(
        "prose prose-invert prose-sm max-w-none font-mono text-sm text-[var(--gray-200)] [&_h2]:mb-2 [&_h2]:mt-5 [&_h2]:text-base [&_h2]:text-[var(--gray-100)] [&_h3]:mb-2 [&_h3]:mt-4 [&_h3]:text-sm [&_h3]:text-[var(--gray-100)] [&_p]:m-0 [&_p]:mb-3 [&_pre]:m-0 [&_strong]:text-[var(--gray-100)] [&_ul]:my-2",
        className
      )}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          code({ className: codeClassName, children, ...props }: any) {
            const match = /language-([A-Za-z0-9_-]+)/.exec(codeClassName || "");
            const codeString = String(children).replace(/\n$/, "");

            if (!match) {
              const pathMatch = FILE_PATH_REGEX.exec(codeString);
              if (pathMatch && onOpenFilePath) {
                const cleanPath = codeString.replace(/:L?\d+.*$/, "");
                const lineStart = pathMatch[1] ? parseInt(pathMatch[1], 10) : undefined;
                const lineEnd = pathMatch[2] ? parseInt(pathMatch[2], 10) : undefined;
                return (
                  <button
                    onClick={() => onOpenFilePath(cleanPath, lineStart, lineEnd)}
                    className="inline-flex items-center gap-1 rounded border border-[var(--accent-green)]/20 bg-[var(--accent-green)]/10 px-1.5 py-0.5 font-mono text-[0.85em] text-[var(--accent-green)] no-underline transition-all hover:border-[var(--accent-green)]/35 hover:bg-[var(--accent-green)]/18"
                  >
                    <FileCode size={11} className="shrink-0" />
                    {codeString}
                  </button>
                );
              }

              return (
                <code
                  className="rounded bg-[var(--alpha-white-5)] px-1 py-0.5 text-[var(--accent-green)]"
                  {...props}
                >
                  {children}
                </code>
              );
            }

            if (isChatVisualLanguage(match[1])) {
              return <ChatVisualBlock language={match[1]} codeString={codeString} />;
            }

            return (
              <div className="group relative my-4 overflow-hidden rounded-xl border border-[var(--alpha-white-8)] bg-[var(--surface-0)]">
                <button
                  onClick={() => handleCopy(codeString)}
                  className="absolute right-3 top-3 z-10 rounded-lg border border-[var(--alpha-white-8)] bg-[var(--surface-2)] p-1 text-[var(--gray-400)] opacity-0 transition-opacity group-hover:opacity-100 hover:text-[var(--gray-100)]"
                >
                  {copied === codeString ? <Check size={12} /> : <Copy size={12} />}
                </button>
                <SyntaxHighlighter
                  style={atomDark}
                  language={match[1]}
                  PreTag="div"
                  wrapLines
                  wrapLongLines
                  customStyle={{
                    margin: 0,
                    fontSize: "0.76rem",
                    background: "transparent",
                    padding: "0.85rem",
                  }}
                  codeTagProps={{
                    style: { fontFamily: "var(--font-mono), ui-monospace, monospace" },
                  }}
                >
                  {codeString}
                </SyntaxHighlighter>
              </div>
            );
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
