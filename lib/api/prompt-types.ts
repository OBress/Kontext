/**
 * Shared types for the hierarchical system prompt generator.
 *
 * The system generates multiple scoped rule files per IDE target,
 * exported as a ZIP archive with the correct directory structure.
 */

/* ------------------------------------------------------------------ */
/*  Target + Scope enums                                              */
/* ------------------------------------------------------------------ */

/** The 6 supported export targets (order matches UI) */
export type PromptTarget =
  | "claude"
  | "cursor"
  | "copilot"
  | "antigravity"
  | "windsurf"
  | "other";

/** Recognised rule scopes – each maps to a directory/concern area */
export type RuleScope =
  | "root"
  | "api"
  | "components"
  | "database"
  | "styling"
  | "testing"
  | "devops";

/* ------------------------------------------------------------------ */
/*  Data shapes                                                       */
/* ------------------------------------------------------------------ */

/** One technology detected by the LLM */
export interface StackItem {
  name: string;
  category: string;
  confidence: number;
}

/**
 * A single scope's content as returned by the LLM.
 * Canonical / IDE-agnostic — the formatter wraps it for the target tool.
 */
export interface ScopeContent {
  scope: RuleScope;
  /** Glob patterns the LLM considers relevant for this scope */
  globs: string[];
  /** Markdown rule content (no IDE-specific metadata yet) */
  content: string;
}

/** One final rule file ready for ZIP packaging */
export interface RuleFile {
  /** Relative path inside the ZIP (e.g. ".cursor/rules/api-routes.mdc") */
  path: string;
  /** Full file content, already formatted for the target IDE */
  content: string;
  /** Which scope this file covers */
  scope: RuleScope;
  /** Human-readable description */
  description: string;
}

/** Complete API response for the prompt generator */
export interface GeneratedRulePackage {
  target: PromptTarget;
  repoFullName: string;
  detectedStack: StackItem[];
  /** Combined text for preview (all scopes concatenated) */
  prompt: string;
  /** Individual rule files for ZIP export (empty for "other") */
  files: RuleFile[];
}

/* ------------------------------------------------------------------ */
/*  Target metadata (used by both backend + frontend)                 */
/* ------------------------------------------------------------------ */

export interface TargetMeta {
  value: PromptTarget;
  label: string;
  sublabel: string;
  hasScoping: boolean;
}

export const TARGET_OPTIONS: TargetMeta[] = [
  { value: "claude",       label: "Claude Code",      sublabel: "CLAUDE.md",          hasScoping: true },
  { value: "cursor",       label: "Cursor",           sublabel: ".cursor/rules/",     hasScoping: true },
  { value: "copilot",      label: "GitHub Copilot",   sublabel: ".github/",           hasScoping: true },
  { value: "antigravity",  label: "Antigravity",      sublabel: "AGENTS.md",          hasScoping: true },
  { value: "windsurf",     label: "Windsurf",         sublabel: ".windsurf/rules/",   hasScoping: true },
  { value: "other",        label: "Other / Generic",  sublabel: "Copy & paste",       hasScoping: false },
];

export const VALID_TARGETS = TARGET_OPTIONS.map((t) => t.value);
