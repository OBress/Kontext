"use client";

import { useState, useCallback } from "react";
import { useParams } from "next/navigation";
import { useAppStore } from "@/lib/store/app-store";
import { GlowCard } from "@/app/components/shared/GlowCard";
import { TypewriterText } from "@/app/components/shared/TypewriterText";
import {
  Wand2,
  Copy,
  Check,
  Download,
  Eye,
  Code,
  Loader2,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { atomDark } from "react-syntax-highlighter/dist/esm/styles/prism";

interface StackItem {
  name: string;
  category: string;
  confidence: number;
}

const targetOptions = [
  { value: "cursor", label: "Cursor (.cursorrules)" },
  { value: "copilot", label: "GitHub Copilot" },
  { value: "claude", label: "Claude" },
  { value: "gpt", label: "ChatGPT / GPT" },
];

export default function PromptsPage() {
  const params = useParams<{ owner: string; name: string }>();
  const { apiKey } = useAppStore();
  const repoFullName = `${params.owner}/${params.name}`;

  const [prompt, setPrompt] = useState("");
  const [detectedStack, setDetectedStack] = useState<StackItem[]>([]);
  const [enabledTech, setEnabledTech] = useState<Record<string, boolean>>({});
  const [target, setTarget] = useState("cursor");
  const [customInstructions, setCustomInstructions] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [copied, setCopied] = useState(false);
  const [isAnimating, setIsAnimating] = useState(false);

  const handleGenerate = useCallback(async () => {
    setIsGenerating(true);
    setIsAnimating(true);
    try {
      const res = await fetch("/api/prompts", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(apiKey ? { "x-google-api-key": apiKey } : {}),
        },
        body: JSON.stringify({
          repo_full_name: repoFullName,
          target,
          custom_instructions: customInstructions,
        }),
      });
      const data = await res.json();
      setPrompt(data.prompt);
      setDetectedStack(data.detectedStack);
      const defaults: Record<string, boolean> = {};
      data.detectedStack.forEach((s: StackItem) => (defaults[s.name] = true));
      setEnabledTech(defaults);
    } catch {
      setPrompt("Error generating prompt. Please try again.");
    }
    setIsGenerating(false);
  }, []);

  const handleCopy = () => {
    navigator.clipboard.writeText(prompt);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    const blob = new Blob([prompt], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = target === "cursor" ? ".cursorrules" : "system-prompt.md";
    a.click();
    URL.revokeObjectURL(url);
  };

  // Group stack by category
  const categories = detectedStack.reduce(
    (acc, item) => {
      if (!acc[item.category]) acc[item.category] = [];
      acc[item.category].push(item);
      return acc;
    },
    {} as Record<string, StackItem[]>
  );

  return (
    <div className="flex flex-col lg:flex-row gap-6 min-h-[calc(100vh-200px)]">
      {/* Left: Config */}
      <div className="lg:w-[340px] shrink-0 space-y-5">
        {/* Target selector */}
        <GlowCard glowColor="none" className="p-4">
          <h3 className="font-mono text-xs uppercase tracking-wider text-[var(--gray-500)] mb-3 m-0">
            Target AI
          </h3>
          <div className="grid grid-cols-2 gap-2">
            {targetOptions.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setTarget(opt.value)}
                className={`py-2 px-3 rounded-lg text-xs font-mono transition-colors border cursor-pointer ${
                  target === opt.value
                    ? "bg-[var(--accent-green)]/10 text-[var(--accent-green)] border-[var(--accent-green)]/30"
                    : "bg-[var(--alpha-white-5)] text-[var(--gray-400)] border-[var(--alpha-white-8)] hover:text-[var(--gray-200)]"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </GlowCard>

        {/* Detected stack */}
        {detectedStack.length > 0 && (
          <GlowCard glowColor="none" className="p-4">
            <h3 className="font-mono text-xs uppercase tracking-wider text-[var(--gray-500)] mb-3 m-0">
              Detected Stack
            </h3>
            <div className="space-y-3">
              {Object.entries(categories).map(([cat, items]) => (
                <div key={cat}>
                  <span className="font-mono text-[10px] text-[var(--gray-600)] uppercase">
                    {cat}
                  </span>
                  <div className="flex flex-wrap gap-1.5 mt-1">
                    {items.map((item) => (
                      <button
                        key={item.name}
                        onClick={() =>
                          setEnabledTech((prev) => ({
                            ...prev,
                            [item.name]: !prev[item.name],
                          }))
                        }
                        className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-mono transition-colors border cursor-pointer ${
                          enabledTech[item.name]
                            ? "bg-[var(--accent-green)]/8 text-[var(--gray-200)] border-[var(--accent-green)]/20"
                            : "bg-transparent text-[var(--gray-600)] border-[var(--alpha-white-8)] line-through"
                        }`}
                      >
                        {item.name}
                        <span className="text-[9px] text-[var(--gray-600)]">
                          {item.confidence}%
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </GlowCard>
        )}

        {/* Additional instructions */}
        <GlowCard glowColor="none" className="p-4">
          <h3 className="font-mono text-xs uppercase tracking-wider text-[var(--gray-500)] mb-3 m-0">
            Additional Instructions
          </h3>
          <textarea
            value={customInstructions}
            onChange={(e) => setCustomInstructions(e.target.value)}
            placeholder="Add custom rules or context..."
            rows={4}
            className="w-full px-3 py-2 rounded-lg text-xs font-mono bg-[var(--surface-1)] border border-[var(--alpha-white-5)] text-[var(--gray-200)] placeholder:text-[var(--gray-600)] focus:outline-none focus:border-[var(--accent-green)]/40 transition-colors resize-none"
          />
        </GlowCard>

        {/* Generate button */}
        <button
          onClick={handleGenerate}
          disabled={isGenerating}
          className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg font-mono text-sm bg-[var(--accent-green)] text-black font-medium hover:opacity-90 disabled:opacity-50 transition-opacity cursor-pointer border-none"
        >
          {isGenerating ? (
            <Loader2 size={16} className="animate-spin" />
          ) : (
            <Wand2 size={16} />
          )}
          {isGenerating ? "Generating..." : "Generate System Prompt"}
        </button>
      </div>

      {/* Right: Editor */}
      <div className="flex-1 min-w-0">
        {prompt ? (
          <div className="h-full flex flex-col rounded-xl border border-[var(--alpha-white-5)] bg-[var(--surface-0)] overflow-hidden">
            {/* Toolbar */}
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-[var(--alpha-white-5)]">
              <span className="font-mono text-xs text-[var(--gray-500)]">
                {target === "cursor" ? ".cursorrules" : "system-prompt.md"}
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowPreview(!showPreview)}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] font-mono bg-[var(--alpha-white-5)] text-[var(--gray-400)] hover:text-[var(--gray-200)] transition-colors border-none cursor-pointer"
                >
                  {showPreview ? <Code size={12} /> : <Eye size={12} />}
                  {showPreview ? "Source" : "Preview"}
                </button>
                <button
                  onClick={handleCopy}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] font-mono bg-[var(--alpha-white-5)] text-[var(--gray-400)] hover:text-[var(--gray-200)] transition-colors border-none cursor-pointer"
                >
                  {copied ? <Check size={12} className="text-[var(--accent-green)]" /> : <Copy size={12} />}
                  {copied ? "Copied!" : "Copy"}
                </button>
                <button
                  onClick={handleDownload}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] font-mono bg-[var(--alpha-white-5)] text-[var(--gray-400)] hover:text-[var(--gray-200)] transition-colors border-none cursor-pointer"
                >
                  <Download size={12} />
                  Download
                </button>
              </div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-4">
              {showPreview ? (
                <div className="prose prose-invert prose-sm max-w-none font-mono text-sm text-[var(--gray-200)] [&_h1]:text-lg [&_h1]:text-[var(--gray-100)] [&_h2]:text-sm [&_h2]:text-[var(--gray-200)] [&_h3]:text-sm [&_h3]:text-[var(--gray-300)] [&_code]:text-[var(--accent-green)] [&_code]:bg-[var(--alpha-white-5)] [&_code]:px-1 [&_code]:rounded [&_strong]:text-[var(--gray-100)] [&_li]:text-[var(--gray-300)]">
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={{
                      code({ className, children, ...props }: any) {
                        const match = /language-(\w+)/.exec(className || "");
                        if (match) {
                          return (
                            <SyntaxHighlighter
                              style={atomDark}
                              language={match[1]}
                              customStyle={{ margin: 0, borderRadius: "0.5rem", fontSize: "0.7rem", background: "var(--surface-1)" }}
                            >
                              {String(children).replace(/\n$/, "")}
                            </SyntaxHighlighter>
                          );
                        }
                        return <code className={className} {...props}>{children}</code>;
                      },
                    }}
                  >
                    {prompt}
                  </ReactMarkdown>
                </div>
              ) : (
                <div className="relative">
                  {isAnimating ? (
                    <div className="font-mono text-xs text-[var(--gray-300)] leading-relaxed whitespace-pre-wrap">
                      <TypewriterText
                        text={prompt}
                        charsPerTick={10}
                        tickInterval={8}
                        onComplete={() => setIsAnimating(false)}
                      />
                    </div>
                  ) : (
                    <pre className="font-mono text-xs text-[var(--gray-300)] leading-relaxed whitespace-pre-wrap m-0">
                      {prompt}
                    </pre>
                  )}
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="h-full flex items-center justify-center rounded-xl border border-dashed border-[var(--alpha-white-8)]">
            <div className="text-center">
              <Wand2 size={32} className="text-[var(--gray-700)] mx-auto mb-3" />
              <p className="font-mono text-sm text-[var(--gray-500)] m-0">
                Click &ldquo;Generate&rdquo; to create a system prompt
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
