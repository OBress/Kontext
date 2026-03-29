"use client";

import { useState, useCallback, useEffect, useRef } from "react";
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
  FileText,
  FolderTree,
  Archive,
  ChevronDown,
  ChevronRight,
  Info,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { atomDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import { TARGET_OPTIONS } from "@/lib/api/prompt-types";
import type { RuleFile, StackItem, PromptTarget } from "@/lib/api/prompt-types";

/* ------------------------------------------------------------------ */
/*  Progress steps — animated while waiting for LLM                   */
/* ------------------------------------------------------------------ */

const PROGRESS_STEPS = [
  { label: "Analysing codebase structure", duration: 2500 },
  { label: "Scanning config files & imports", duration: 3000 },
  { label: "Detecting relevant scopes", duration: 2000 },
  { label: "Generating scoped rules via AI", duration: 12000 },
  { label: "Formatting for target IDE", duration: 1500 },
];

const TOTAL_DURATION = PROGRESS_STEPS.reduce((s, p) => s + p.duration, 0);

/* ------------------------------------------------------------------ */
/*  Install instructions per IDE                                      */
/* ------------------------------------------------------------------ */

const INSTALL_INSTRUCTIONS: Record<PromptTarget, { title: string; steps: string[] }> = {
  claude: {
    title: "Claude Code",
    steps: [
      "Download & extract the ZIP into your project root.",
      "The root file CLAUDE.md will be placed at the project root.",
      "Scoped CLAUDE.md files go into subdirectories (e.g., app/api/CLAUDE.md).",
      "Claude Code automatically reads these files based on your working directory.",
      "Run /memory in Claude Code to verify your rules are loaded.",
    ],
  },
  cursor: {
    title: "Cursor",
    steps: [
      "Download & extract the ZIP into your project root.",
      "All rule files will be placed inside .cursor/rules/ as .mdc files.",
      "The project.mdc rule has alwaysApply: true and loads in every conversation.",
      "Scoped rules (api-routes.mdc, etc.) auto-attach when matching files are in context.",
      "Commit .cursor/rules/ to Git so your team shares the same rules.",
    ],
  },
  copilot: {
    title: "GitHub Copilot",
    steps: [
      "Download & extract the ZIP into your project root.",
      "Global rules go to .github/copilot-instructions.md (auto-loaded).",
      "Scoped rules go to .github/instructions/*.instructions.md with applyTo: globs.",
      "Copilot Chat, code review, and the coding agent all respect these files.",
      "Commit the .github/ directory to share with your team.",
    ],
  },
  antigravity: {
    title: "Antigravity (Gemini)",
    steps: [
      "Download & extract the ZIP into your project root.",
      "AGENTS.md goes at the root — loaded in every conversation automatically.",
      "Scoped rules go to .agents/rules/*.md — loaded contextually.",
      "Antigravity walks the folder tree, so deeper AGENTS.md files override parent ones.",
      "Commit AGENTS.md and .agents/ to Git for team-wide consistency.",
    ],
  },
  windsurf: {
    title: "Windsurf",
    steps: [
      "Download & extract the ZIP into your project root.",
      "Rules are placed in .windsurf/rules/ as .md files.",
      "global.md loads in every conversation (no frontmatter trigger).",
      "Scoped files use trigger: glob frontmatter to auto-attach on matching files.",
      "Keep rule files under 12,000 characters for optimal context usage.",
    ],
  },
  other: {
    title: "Generic / Other",
    steps: [
      "Download the system-prompt.md file.",
      "Copy the entire content of the file.",
      "Paste it into your AI tool's system prompt or custom instructions field.",
      "In ChatGPT: Settings → Customization → Custom Instructions.",
      "In any other tool: paste into the system prompt / persona configuration.",
    ],
  },
};

/* ------------------------------------------------------------------ */
/*  Component                                                         */
/* ------------------------------------------------------------------ */

export default function PromptsPage() {
  const params = useParams<{ owner: string; name: string }>();
  const { apiKey } = useAppStore();
  const repoFullName = `${params.owner}/${params.name}`;

  /* State */
  const [prompt, setPrompt] = useState("");
  const [files, setFiles] = useState<RuleFile[]>([]);
  const [detectedStack, setDetectedStack] = useState<StackItem[]>([]);
  const [enabledTech, setEnabledTech] = useState<Record<string, boolean>>({});
  const [target, setTarget] = useState<PromptTarget>("claude");
  const [customInstructions, setCustomInstructions] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [copied, setCopied] = useState(false);
  const [isAnimating, setIsAnimating] = useState(false);
  const [selectedFileIdx, setSelectedFileIdx] = useState(0);
  const [showInstall, setShowInstall] = useState(false);
  const [expandStack, setExpandStack] = useState(false);

  /* Progress bar state */
  const [progressStep, setProgressStep] = useState(0);
  const [progressPct, setProgressPct] = useState(0);
  const progressTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  /* Derived */
  const hasFiles = files.length > 1;
  const selectedFile = files[selectedFileIdx] || null;
  const currentContent = hasFiles ? (selectedFile?.content || "") : prompt;
  const currentFileName = hasFiles
    ? (selectedFile?.path || "")
    : target === "other"
      ? "system-prompt.md"
      : "rules";

  /* ---------------------------------------------------------------- */
  /*  Progress bar animation                                          */
  /* ---------------------------------------------------------------- */

  const startProgress = useCallback(() => {
    setProgressStep(0);
    setProgressPct(0);
    let elapsed = 0;
    const tick = 100; // ms

    if (progressTimer.current) clearInterval(progressTimer.current);
    progressTimer.current = setInterval(() => {
      elapsed += tick;
      // Compute which step we're on
      let cumulative = 0;
      let currentStep = 0;
      for (let i = 0; i < PROGRESS_STEPS.length; i++) {
        cumulative += PROGRESS_STEPS[i].duration;
        if (elapsed < cumulative) {
          currentStep = i;
          break;
        }
        if (i === PROGRESS_STEPS.length - 1) currentStep = i;
      }
      setProgressStep(currentStep);

      // Smooth percentage (cap at 95% — we jump to 100 on completion)
      const pct = Math.min(95, (elapsed / TOTAL_DURATION) * 100);
      setProgressPct(pct);
    }, tick);
  }, []);

  const stopProgress = useCallback(() => {
    if (progressTimer.current) {
      clearInterval(progressTimer.current);
      progressTimer.current = null;
    }
    setProgressPct(100);
    setTimeout(() => setProgressPct(0), 600);
  }, []);

  useEffect(() => {
    return () => {
      if (progressTimer.current) clearInterval(progressTimer.current);
    };
  }, []);

  /* ---------------------------------------------------------------- */
  /*  Handlers                                                        */
  /* ---------------------------------------------------------------- */

  const handleGenerate = useCallback(async () => {
    setIsGenerating(true);
    setIsAnimating(true);
    setSelectedFileIdx(0);
    setShowInstall(false);
    startProgress();
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
      setPrompt(data.prompt || "");
      setFiles(data.files || []);
      setDetectedStack(data.detectedStack || []);
      const defaults: Record<string, boolean> = {};
      (data.detectedStack || []).forEach((s: StackItem) => (defaults[s.name] = true));
      setEnabledTech(defaults);
    } catch {
      setPrompt("Error generating rules. Please try again.");
      setFiles([]);
    }
    stopProgress();
    setIsGenerating(false);
  }, [apiKey, repoFullName, target, customInstructions, startProgress, stopProgress]);

  const handleCopy = () => {
    navigator.clipboard.writeText(currentContent);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownloadZip = async () => {
    if (files.length === 0) return;
    const JSZip = (await import("jszip")).default;
    const zip = new JSZip();
    for (const file of files) {
      zip.file(file.path, file.content);
    }
    const blob = await zip.generateAsync({ type: "blob" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${params.name}-${target}-rules.zip`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleDownloadSingle = () => {
    const blob = new Blob([currentContent], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "system-prompt.md";
    a.click();
    URL.revokeObjectURL(url);
  };

  /* ---------------------------------------------------------------- */
  /*  Render helpers                                                  */
  /* ---------------------------------------------------------------- */

  const hasGenerated = prompt.length > 0 || files.length > 0;
  const installInfo = INSTALL_INSTRUCTIONS[target as PromptTarget];

  return (
    <div className="flex flex-col lg:flex-row gap-6 min-h-[calc(100vh-200px)]">
      {/* ============================================================ */}
      {/* Left: Config Panel                                           */}
      {/* ============================================================ */}
      <div className="lg:w-[340px] shrink-0 space-y-5">
        {/* Target selector */}
        <GlowCard glowColor="none" className="p-4">
          <h3 className="font-mono text-xs uppercase tracking-wider text-[var(--gray-500)] mb-3 m-0">
            Target AI
          </h3>
          <div className="grid grid-cols-2 gap-2">
            {TARGET_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setTarget(opt.value)}
                className={`py-2.5 px-3 rounded-lg text-xs font-mono transition-colors border cursor-pointer text-left ${
                  target === opt.value
                    ? "bg-[var(--accent-green)]/10 text-[var(--accent-green)] border-[var(--accent-green)]/30"
                    : "bg-[var(--alpha-white-5)] text-[var(--gray-400)] border-[var(--alpha-white-8)] hover:text-[var(--gray-200)]"
                }`}
              >
                <span className="block text-xs font-medium">{opt.label}</span>
                <span className="block text-[10px] text-[var(--gray-600)] mt-0.5 font-normal">
                  {opt.sublabel}
                </span>
              </button>
            ))}
          </div>
        </GlowCard>

        {/* Detected stack — compact inline */}
        {detectedStack.length > 0 && (
          <GlowCard glowColor="none" className="p-4">
            <button
              onClick={() => setExpandStack(!expandStack)}
              className="flex items-center justify-between w-full border-none bg-transparent cursor-pointer p-0 m-0"
            >
              <h3 className="font-mono text-xs uppercase tracking-wider text-[var(--gray-500)] m-0">
                Detected Stack
              </h3>
              <div className="flex items-center gap-1.5">
                <span className="font-mono text-[10px] text-[var(--gray-600)]">
                  {detectedStack.length} technologies
                </span>
                {expandStack ? (
                  <ChevronDown size={12} className="text-[var(--gray-600)]" />
                ) : (
                  <ChevronRight size={12} className="text-[var(--gray-600)]" />
                )}
              </div>
            </button>
            {/* Always show compact inline preview */}
            <div className="flex flex-wrap gap-1 mt-2">
              {(expandStack ? detectedStack : detectedStack.slice(0, 8)).map((item) => (
                <button
                  key={item.name}
                  onClick={() =>
                    setEnabledTech((prev) => ({
                      ...prev,
                      [item.name]: !prev[item.name],
                    }))
                  }
                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono transition-colors border cursor-pointer ${
                    enabledTech[item.name]
                      ? "bg-[var(--accent-green)]/8 text-[var(--gray-300)] border-[var(--accent-green)]/20"
                      : "bg-transparent text-[var(--gray-600)] border-[var(--alpha-white-8)] line-through"
                  }`}
                >
                  {item.name}
                  <span className="text-[8px] text-[var(--gray-600)]">{item.confidence}%</span>
                </button>
              ))}
              {!expandStack && detectedStack.length > 8 && (
                <span className="text-[10px] text-[var(--gray-600)] font-mono px-1 py-0.5">
                  +{detectedStack.length - 8} more
                </span>
              )}
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
            rows={3}
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
            <>
              <svg className="animate-spin" width="16" height="16" viewBox="0 0 16 16" fill="none">
                <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" strokeDasharray="28" strokeDashoffset="8" strokeLinecap="round" />
              </svg>
              Generating...
            </>
          ) : (
            <>
              <Wand2 size={16} />
              Generate Rules
            </>
          )}
        </button>

        {/* ============================================================ */}
        {/* Progress bar (shown during generation)                       */}
        {/* ============================================================ */}
        {isGenerating && (
          <GlowCard glowColor="none" className="p-4">
            <div className="space-y-3">
              {/* Bar */}
              <div className="w-full h-1.5 rounded-full bg-[var(--alpha-white-5)] overflow-hidden">
                <div
                  className="h-full rounded-full bg-[var(--accent-green)] transition-all duration-300 ease-out"
                  style={{ width: `${progressPct}%` }}
                />
              </div>

              {/* Step labels */}
              <div className="space-y-1.5">
                {PROGRESS_STEPS.map((step, idx) => (
                  <div
                    key={step.label}
                    className={`flex items-center gap-2 font-mono text-[11px] transition-colors duration-300 ${
                      idx < progressStep
                        ? "text-[var(--accent-green)]"
                        : idx === progressStep
                          ? "text-[var(--gray-200)]"
                          : "text-[var(--gray-700)]"
                    }`}
                  >
                    {idx < progressStep ? (
                      <Check size={10} className="shrink-0" />
                    ) : idx === progressStep ? (
                      <svg className="animate-spin shrink-0" width="10" height="10" viewBox="0 0 10 10" fill="none">
                        <circle cx="5" cy="5" r="4" stroke="currentColor" strokeWidth="1.5" strokeDasharray="18" strokeDashoffset="5" strokeLinecap="round" />
                      </svg>
                    ) : (
                      <div className="w-[10px] h-[10px] rounded-full border border-[var(--gray-700)] shrink-0" />
                    )}
                    {step.label}
                  </div>
                ))}
              </div>
            </div>
          </GlowCard>
        )}

        {/* ============================================================ */}
        {/* Install instructions (shown after generation)                */}
        {/* ============================================================ */}
        {hasGenerated && !isGenerating && (
          <GlowCard glowColor="none" className="p-4">
            <button
              onClick={() => setShowInstall(!showInstall)}
              className="flex items-center justify-between w-full border-none bg-transparent cursor-pointer p-0 m-0"
            >
              <div className="flex items-center gap-2">
                <Info size={12} className="text-[var(--accent-green)]" />
                <h3 className="font-mono text-xs uppercase tracking-wider text-[var(--gray-500)] m-0">
                  How to Install
                </h3>
              </div>
              {showInstall ? (
                <ChevronDown size={12} className="text-[var(--gray-600)]" />
              ) : (
                <ChevronRight size={12} className="text-[var(--gray-600)]" />
              )}
            </button>
            {showInstall && (
              <div className="mt-3 space-y-2">
                <span className="font-mono text-[11px] text-[var(--accent-green)] font-medium">
                  {installInfo.title}
                </span>
                <ol className="list-none p-0 m-0 space-y-1.5">
                  {installInfo.steps.map((step, i) => (
                    <li
                      key={i}
                      className="flex gap-2 font-mono text-[11px] text-[var(--gray-400)] leading-relaxed"
                    >
                      <span className="text-[var(--gray-600)] shrink-0">{i + 1}.</span>
                      {step}
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </GlowCard>
        )}
      </div>

      {/* ============================================================ */}
      {/* Right: Editor / File Browser                                 */}
      {/* ============================================================ */}
      <div className="flex-1 min-w-0">
        {hasGenerated ? (
          <div className="h-full flex flex-col rounded-xl border border-[var(--alpha-white-5)] bg-[var(--surface-0)] overflow-hidden">
            {/* Toolbar */}
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-[var(--alpha-white-5)]">
              <div className="flex items-center gap-2">
                {hasFiles ? (
                  <>
                    <FolderTree size={12} className="text-[var(--accent-green)]" />
                    <span className="font-mono text-xs text-[var(--gray-400)]">
                      {files.length} files
                    </span>
                    <span className="text-[var(--gray-700)]">·</span>
                    <span className="font-mono text-xs text-[var(--gray-500)]">
                      {currentFileName}
                    </span>
                  </>
                ) : (
                  <span className="font-mono text-xs text-[var(--gray-500)]">
                    {currentFileName}
                  </span>
                )}
              </div>
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
                {hasFiles ? (
                  <button
                    onClick={handleDownloadZip}
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] font-mono bg-[var(--accent-green)]/10 text-[var(--accent-green)] hover:bg-[var(--accent-green)]/20 transition-colors border-none cursor-pointer"
                  >
                    <Archive size={12} />
                    Download ZIP
                  </button>
                ) : (
                  <button
                    onClick={handleDownloadSingle}
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] font-mono bg-[var(--alpha-white-5)] text-[var(--gray-400)] hover:text-[var(--gray-200)] transition-colors border-none cursor-pointer"
                  >
                    <Download size={12} />
                    Download
                  </button>
                )}
              </div>
            </div>

            {/* Main content area */}
            <div className="flex-1 flex overflow-hidden">
              {/* File sidebar (only for multi-file targets) */}
              {hasFiles && (
                <div className="w-[220px] shrink-0 border-r border-[var(--alpha-white-5)] overflow-y-auto bg-[var(--surface-0)]">
                  <div className="p-2 space-y-0.5">
                    {files.map((file, idx) => (
                      <button
                        key={file.path}
                        onClick={() => {
                          setSelectedFileIdx(idx);
                          setIsAnimating(false);
                        }}
                        className={`w-full text-left px-2.5 py-2 rounded-lg text-[11px] font-mono transition-colors border-none cursor-pointer flex items-start gap-2 ${
                          idx === selectedFileIdx
                            ? "bg-[var(--accent-green)]/10 text-[var(--accent-green)]"
                            : "bg-transparent text-[var(--gray-400)] hover:bg-[var(--alpha-white-5)] hover:text-[var(--gray-200)]"
                        }`}
                      >
                        <FileText size={12} className="shrink-0 mt-0.5" />
                        <div className="min-w-0">
                          <div className="truncate">{file.path.split("/").pop()}</div>
                          <div className="text-[9px] text-[var(--gray-600)] truncate mt-0.5">
                            {file.path}
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Code viewer */}
              <div className="flex-1 overflow-y-auto p-4">
                {showPreview ? (
                  <div className="prose prose-invert prose-sm max-w-none font-mono text-sm text-[var(--gray-200)] [&_h1]:text-lg [&_h1]:text-[var(--gray-100)] [&_h2]:text-sm [&_h2]:text-[var(--gray-200)] [&_h3]:text-sm [&_h3]:text-[var(--gray-300)] [&_code]:text-[var(--accent-green)] [&_code]:bg-[var(--alpha-white-5)] [&_code]:px-1 [&_code]:rounded [&_strong]:text-[var(--gray-100)] [&_li]:text-[var(--gray-300)]">
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      components={{
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
                      {currentContent}
                    </ReactMarkdown>
                  </div>
                ) : (
                  <div className="relative">
                    {isAnimating && selectedFileIdx === 0 ? (
                      <div className="font-mono text-xs text-[var(--gray-300)] leading-relaxed whitespace-pre-wrap">
                        <TypewriterText
                          text={currentContent}
                          charsPerTick={10}
                          tickInterval={8}
                          onComplete={() => setIsAnimating(false)}
                        />
                      </div>
                    ) : (
                      <pre className="font-mono text-xs text-[var(--gray-300)] leading-relaxed whitespace-pre-wrap m-0">
                        {currentContent}
                      </pre>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : (
          /* Empty state */
          <div className="h-full flex items-center justify-center rounded-xl border border-dashed border-[var(--alpha-white-8)]">
            <div className="text-center">
              <Wand2 size={32} className="text-[var(--gray-700)] mx-auto mb-3" />
              <p className="font-mono text-sm text-[var(--gray-500)] m-0">
                Select a target and click &ldquo;Generate&rdquo; to create scoped AI rules
              </p>
              <p className="font-mono text-[11px] text-[var(--gray-600)] mt-1 m-0">
                Generates multiple rule files tailored to your IDE&apos;s format
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
