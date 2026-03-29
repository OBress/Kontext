import type { ResponseSchema } from "@google/generative-ai";
import { SchemaType } from "@google/generative-ai";
import {
  buildTaskSystemInstruction,
  formatEvidencePack,
  truncatePromptText,
  type PromptExcerpt,
  type PromptFact,
} from "./prompt-contract";
import type { RuleScope, StackItem } from "./prompt-types";

export interface RepoChunkContext {
  file_path: string;
  content: string;
}

export interface RepoFileContext {
  file_path: string;
  extension: string | null;
  line_count: number;
  imports: string[] | null;
}

export interface ScopePromptContext {
  scope: RuleScope;
  globs: string[];
  promptHint: string;
}

export interface DeterministicRuleFacts {
  seedStack: StackItem[];
  rootFacts: PromptFact[];
  rootCandidatePaths: string[];
  scopeCandidatePaths: Partial<Record<RuleScope, string[]>>;
}

export interface RootRuleResponse {
  summary: string;
  detectedStack: StackItem[];
  content: string;
}

export interface ScopeRuleResponse {
  content: string;
}

const STACK_ITEM_SCHEMA: ResponseSchema = {
  type: SchemaType.OBJECT,
  properties: {
    name: { type: SchemaType.STRING },
    category: { type: SchemaType.STRING },
    confidence: { type: SchemaType.INTEGER },
  },
  required: ["name", "category", "confidence"],
};

export const ROOT_RULE_RESPONSE_SCHEMA: ResponseSchema = {
  type: SchemaType.OBJECT,
  properties: {
    summary: { type: SchemaType.STRING },
    detectedStack: {
      type: SchemaType.ARRAY,
      items: STACK_ITEM_SCHEMA,
    },
    content: { type: SchemaType.STRING },
  },
  required: ["summary", "detectedStack", "content"],
};

export const SCOPE_RULE_RESPONSE_SCHEMA: ResponseSchema = {
  type: SchemaType.OBJECT,
  properties: {
    content: { type: SchemaType.STRING },
  },
  required: ["content"],
};

interface PackageJsonLike {
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  engines?: Record<string, string>;
}

function safeJsonParse<T>(text: string): T | null {
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

function pushStackItem(
  bucket: StackItem[],
  seen: Set<string>,
  item: StackItem | null
) {
  if (!item) return;
  const key = item.name.toLowerCase();
  if (seen.has(key)) return;
  seen.add(key);
  bucket.push(item);
}

function dependencyVersion(
  packageJson: PackageJsonLike | null,
  dependencyName: string
): string | null {
  if (!packageJson) return null;
  return (
    packageJson.dependencies?.[dependencyName] ||
    packageJson.devDependencies?.[dependencyName] ||
    null
  );
}

function formatTechName(name: string, version: string | null): string {
  return version ? `${name} ${version}` : name;
}

function buildTopDirectorySummary(filePaths: string[]): string[] {
  const counts = new Map<string, number>();

  for (const filePath of filePaths) {
    const topLevel = filePath.includes("/")
      ? filePath.split("/")[0]
      : "(root)";
    counts.set(topLevel, (counts.get(topLevel) || 0) + 1);
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 8)
    .map(([dir, count]) => `${dir}: ${count} files`);
}

function parsePackageJson(
  configChunks: RepoChunkContext[]
): PackageJsonLike | null {
  const packageChunk = configChunks.find(
    (chunk) => chunk.file_path === "package.json"
  );

  if (!packageChunk) return null;
  return safeJsonParse<PackageJsonLike>(packageChunk.content);
}

function buildRootCandidatePaths(filePaths: string[]): string[] {
  const priorities = [
    /^AGENTS\.md$/i,
    /^README(?:\.[a-z]+)?$/i,
    /^docs\//i,
    /^CLAUDE\.md$/i,
    /^package\.json$/i,
    /^tsconfig\.json$/i,
    /^next\.config\./i,
    /^tailwind\.config\./i,
    /^eslint\.config\./i,
    /^app\/layout\./i,
    /^app\/page\./i,
    /^src\/app\/layout\./i,
    /^src\/app\/page\./i,
    /^middleware\./i,
  ];

  return rankPaths(filePaths, priorities, 10);
}

function buildScopeCandidatePaths(
  scope: RuleScope,
  filePaths: string[]
): string[] {
  switch (scope) {
    case "api":
      return rankPaths(
        filePaths,
        [/route\./i, /handler\./i, /controller\./i, /^app\/api\//, /^pages\/api\//],
        6
      );
    case "components":
      return rankPaths(
        filePaths,
        [/^components\//, /^app\/components\//, /\.tsx$/i, /page\.tsx$/i],
        6
      );
    case "database":
      return rankPaths(
        filePaths,
        [/schema\./i, /^supabase\//, /^prisma\//, /^drizzle\//, /migration/i],
        6
      );
    case "styling":
      return rankPaths(
        filePaths,
        [/tailwind\.config/i, /^styles\//, /\.css$/i, /\.scss$/i, /theme/i],
        5
      );
    case "testing":
      return rankPaths(
        filePaths,
        [/\.(test|spec)\./i, /^__tests__\//, /jest\.config/i, /vitest\.config/i],
        5
      );
    case "devops":
      return rankPaths(
        filePaths,
        [/^\.github\/workflows\//, /^Dockerfile$/i, /railway\.json/i, /vercel\.json/i, /^deploy\//],
        5
      );
    default:
      return [];
  }
}

function rankPaths(
  filePaths: string[],
  patterns: RegExp[],
  limit: number
): string[] {
  const scored = filePaths
    .map((filePath) => {
      const score = patterns.reduce((total, pattern, index) => {
        return total + (pattern.test(filePath) ? patterns.length - index : 0);
      }, 0);
      return { filePath, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.filePath.localeCompare(b.filePath));

  return scored.slice(0, limit).map((entry) => entry.filePath);
}

function buildSeedStack(
  configChunks: RepoChunkContext[],
  filePaths: string[]
): StackItem[] {
  const packageJson = parsePackageJson(configChunks);
  const stack: StackItem[] = [];
  const seen = new Set<string>();

  pushStackItem(
    stack,
    seen,
    packageJson?.engines?.node
      ? {
          name: formatTechName("Node.js", packageJson.engines.node),
          category: "Runtime",
          confidence: 95,
        }
      : null
  );

  const dependencyMappings = [
    ["typescript", "TypeScript", "Language"],
    ["next", "Next.js", "Framework"],
    ["react", "React", "Library"],
    ["tailwindcss", "Tailwind CSS", "Styling"],
    ["@supabase/supabase-js", "Supabase", "Database"],
    ["@google/generative-ai", "Google Gemini SDK", "Library"],
    ["zustand", "Zustand", "Library"],
    ["framer-motion", "Framer Motion", "Library"],
    ["three", "Three.js", "Library"],
    ["eslint", "ESLint", "Tooling"],
  ] as const;

  for (const [dependency, label, category] of dependencyMappings) {
    const version = dependencyVersion(packageJson, dependency);
    if (!version) continue;
    pushStackItem(stack, seen, {
      name: formatTechName(label, version),
      category,
      confidence: 95,
    });
  }

  const configFileSet = new Set(configChunks.map((chunk) => chunk.file_path));
  if (configFileSet.has("Dockerfile")) {
    pushStackItem(stack, seen, {
      name: "Docker",
      category: "DevOps",
      confidence: 90,
    });
  }
  if (configFileSet.has("railway.json")) {
    pushStackItem(stack, seen, {
      name: "Railway",
      category: "DevOps",
      confidence: 90,
    });
  }
  if (filePaths.some((filePath) => filePath.startsWith(".github/workflows/"))) {
    pushStackItem(stack, seen, {
      name: "GitHub Actions",
      category: "DevOps",
      confidence: 85,
    });
  }

  return stack;
}

export function extractDeterministicRuleFacts(
  configChunks: RepoChunkContext[],
  files: RepoFileContext[],
  activeScopes: ScopePromptContext[]
): DeterministicRuleFacts {
  const filePaths = files.map((file) => file.file_path);
  const packageJson = parsePackageJson(configChunks);
  const hasDocsDirectory = filePaths.some((filePath) => filePath.startsWith("docs/"));
  const scripts = Object.entries(packageJson?.scripts || {})
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, command]) => `${name}: ${command}`);

  const rootFacts: PromptFact[] = [
    {
      label: "Detected top-level directories",
      value: buildTopDirectorySummary(filePaths),
      confidence: "exact",
    },
    {
      label: "Detected config files",
      value: configChunks.map((chunk) => chunk.file_path),
      confidence: "exact",
    },
    {
      label: "Package scripts",
      value: scripts.length > 0 ? scripts : ["No package.json scripts found"],
      confidence: scripts.length > 0 ? "exact" : "unknown",
    },
    {
      label: "Active scoped rule files",
      value: activeScopes.map((scope) => scope.scope),
      confidence: "exact",
    },
    {
      label: "Documentation directory",
      value: hasDocsDirectory
        ? "docs/ exists and should be used for durable feature documentation"
        : "docs/ is missing; create docs/ when a durable feature needs ongoing documentation",
      confidence: "exact",
    },
  ];

  const scopeCandidatePaths: Partial<Record<RuleScope, string[]>> = {};
  for (const scope of activeScopes) {
    scopeCandidatePaths[scope.scope] = buildScopeCandidatePaths(
      scope.scope,
      filePaths
    );
  }

  return {
    seedStack: buildSeedStack(configChunks, filePaths),
    rootFacts,
    rootCandidatePaths: buildRootCandidatePaths(filePaths),
    scopeCandidatePaths,
  };
}

function mergeExcerpts(
  selectedPaths: string[],
  chunks: RepoChunkContext[],
  maxChars: number
): PromptExcerpt[] {
  const byPath = new Map(chunks.map((chunk) => [chunk.file_path, chunk.content]));
  const excerpts: PromptExcerpt[] = [];

  for (const filePath of selectedPaths) {
    const content = byPath.get(filePath);
    if (!content) continue;

    excerpts.push({
      title: filePath,
      source: filePath,
      content: truncatePromptText(content, maxChars),
    });
  }

  return excerpts;
}

function normalizeStackItem(value: unknown): StackItem | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const name = typeof record.name === "string" ? record.name.trim() : "";
  const category =
    typeof record.category === "string" ? record.category.trim() : "";
  const confidence =
    typeof record.confidence === "number"
      ? Math.max(0, Math.min(100, Math.round(record.confidence)))
      : 70;

  if (!name || !category) return null;
  return { name, category, confidence };
}

export function normalizeRootRuleResponse(value: unknown): RootRuleResponse {
  if (!value || typeof value !== "object") {
    throw new Error("Root rule response was not an object.");
  }

  const record = value as Record<string, unknown>;
  const content =
    typeof record.content === "string" ? record.content.trim() : "";
  const summary =
    typeof record.summary === "string" ? record.summary.trim() : "";

  if (!content) {
    throw new Error("Root rule response did not include markdown content.");
  }

  const detectedStack = Array.isArray(record.detectedStack)
    ? record.detectedStack
        .map(normalizeStackItem)
        .filter((item): item is StackItem => Boolean(item))
    : [];

  return {
    summary: summary || "Repository rules generated from mixed evidence.",
    detectedStack,
    content,
  };
}

export function normalizeScopeRuleResponse(value: unknown): ScopeRuleResponse {
  if (!value || typeof value !== "object") {
    throw new Error("Scope rule response was not an object.");
  }

  const record = value as Record<string, unknown>;
  const content =
    typeof record.content === "string" ? record.content.trim() : "";

  if (!content) {
    throw new Error("Scope rule response did not include markdown content.");
  }

  return { content };
}

export function mergeDetectedStack(
  deterministic: StackItem[],
  modelDetected: StackItem[]
): StackItem[] {
  const merged: StackItem[] = [];
  const seen = new Set<string>();

  for (const item of [...deterministic, ...modelDetected]) {
    pushStackItem(merged, seen, item);
  }

  return merged;
}

export function buildRuleRootSystemInstruction(targetDisplay: string): string {
  return buildTaskSystemInstruction({
    task: "repo_instruction_synthesizer",
    role: `an expert repository instruction synthesizer for ${targetDisplay}`,
    mission:
      "Turn mixed repository evidence into a concise, high-signal root instruction guide.",
    outputStyle: [
      "Return structured JSON only.",
      "Write repo-specific markdown that a coding assistant can follow immediately.",
      "Prefer concrete constraints, canonical files, and exact commands over generic advice.",
    ],
    taskRules: [
      "Use the deterministic facts when they are exact, and use excerpts for nuance and conventions.",
      "When a section is under-evidenced, write a short unknown or verify note instead of filler.",
      "Do not repeat scope-specific detail that belongs in a dedicated scoped guide.",
      "When the repository has or should have a docs directory, teach the assistant to document advanced, fast-changing features there.",
    ],
  });
}

export function buildRuleScopeSystemInstruction(
  targetDisplay: string,
  scope: RuleScope
): string {
  return buildTaskSystemInstruction({
    task: "repo_instruction_synthesizer",
    role: `an expert repository instruction synthesizer for ${targetDisplay}`,
    mission: `Write a scoped ${scope} instruction guide grounded in repository evidence.`,
    outputStyle: [
      "Return structured JSON only.",
      "Write concise markdown focused on the requested scope only.",
      "Reference concrete files, directories, and patterns when the evidence supports them.",
    ],
    taskRules: [
      "Keep the scope guide complementary to the root guide instead of repeating it.",
      "Prefer a few high-signal do, avoid, and follow-this-pattern instructions over long generic lists.",
      "If the scope evidence is thin, say what is unknown rather than filling space with defaults.",
    ],
  });
}

export function buildRuleRootPrompt(params: {
  repoFullName: string;
  targetDisplay: string;
  facts: DeterministicRuleFacts;
  configChunks: RepoChunkContext[];
  rootChunks: RepoChunkContext[];
  architectureAnalysis: string | null;
  activeScopes: ScopePromptContext[];
  customInstructions: string;
}): string {
  const configExcerpts = params.configChunks.map((chunk) => ({
    title: chunk.file_path,
    source: chunk.file_path,
    content: truncatePromptText(chunk.content, 1800),
    reason: "Deterministic config and metadata evidence.",
  }));

  const rootExcerpts = mergeExcerpts(
    params.facts.rootCandidatePaths,
    params.rootChunks,
    1200
  );

  const evidencePack = formatEvidencePack({
    summary:
      "Synthesize the root repository guide from exact extracted facts plus curated raw excerpts.",
    facts: [
      { label: "Repository", value: params.repoFullName, confidence: "exact" },
      { label: "Seed stack facts", value: params.facts.seedStack.map((item) => item.name), confidence: "exact" },
      ...params.facts.rootFacts,
    ],
    excerpts: [
      ...configExcerpts,
      ...rootExcerpts,
      ...(params.architectureAnalysis
        ? [
            {
              title: "Existing architecture analysis",
              source: params.repoFullName,
              content: truncatePromptText(params.architectureAnalysis, 2000),
              reason: "Use this to keep the project overview and directory structure aligned with the current architecture view.",
            },
          ]
        : []),
    ],
    coverageGaps: [
      rootExcerpts.length > 0
        ? ""
        : "Few canonical root files were available. Keep unknown sections short.",
    ].filter(Boolean),
  });

  return [
    `Generate the root repository instruction guide for ${params.targetDisplay}.`,
    params.customInstructions
      ? `Additional user instruction: ${params.customInstructions}`
      : "",
    "",
    evidencePack,
    "",
    "Root guide requirements:",
    "- Return JSON with summary, detectedStack, and content fields.",
    "- Write markdown only in content.",
    "- Keep the guide roughly 40 to 80 lines.",
    "- Include these sections in order: Project Overview, Tech Stack, Directory Structure, Commands, Coding Standards, Error Handling, Security Practices, Documentation Practices, Git Workflow, Definition of Done.",
    "- Mention real commands, files, or directories when the evidence supports them.",
    "- If a section is under-evidenced, add a short Unknown or verify note instead of generic filler.",
    `- Dedicated scoped guides will also exist for: ${params.activeScopes.map((scope) => scope.scope).join(", ") || "none"}. Avoid duplicating their deep detail.`,
    "- In detectedStack, keep exact deterministic stack facts and add only extra technologies supported by the excerpts.",
    "- In Documentation Practices, explicitly tell the coding assistant to use the existing docs/ directory, or create docs/ if it is missing, for advanced features that will keep evolving and need durable reference docs.",
    "- Documentation guidance should prioritize features that are complex, frequently edited, operationally sensitive, or likely to need future onboarding context.",
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildRuleScopePrompt(params: {
  repoFullName: string;
  targetDisplay: string;
  scope: ScopePromptContext;
  rootSummary: string;
  facts: DeterministicRuleFacts;
  scopeChunks: RepoChunkContext[];
  customInstructions: string;
}): string {
  const selectedPaths = params.facts.scopeCandidatePaths[params.scope.scope] || [];
  const scopeExcerpts = mergeExcerpts(selectedPaths, params.scopeChunks, 1200);
  const evidencePack = formatEvidencePack({
    summary:
      "Synthesize a scoped repository guide from exact extracted facts plus curated raw excerpts.",
    facts: [
      { label: "Repository", value: params.repoFullName, confidence: "exact" },
      { label: "Scope", value: params.scope.scope, confidence: "exact" },
      { label: "Scope globs", value: params.scope.globs, confidence: "exact" },
      { label: "Root guide summary", value: params.rootSummary, confidence: "exact" },
      { label: "Scope coverage hint", value: params.scope.promptHint, confidence: "exact" },
    ],
    excerpts: scopeExcerpts,
    coverageGaps: [
      scopeExcerpts.length > 0
        ? ""
        : `Very little ${params.scope.scope} evidence was available. Keep the guide short and explicit about unknowns.`,
    ].filter(Boolean),
  });

  return [
    `Generate the ${params.scope.scope} scoped repository instruction guide for ${params.targetDisplay}.`,
    params.customInstructions
      ? `Additional user instruction: ${params.customInstructions}`
      : "",
    "",
    evidencePack,
    "",
    "Scope guide requirements:",
    "- Return JSON with a content field.",
    "- Write markdown only in content.",
    "- Keep the guide roughly 15 to 35 lines.",
    "- Cover only this scope and avoid repeating generic repo-wide rules from the root guide.",
    "- Reference actual files or directories when supported by the evidence.",
    "- Prefer high-signal pattern guidance, negative constraints, and common mistakes over exhaustive checklists.",
    "- Include a short Unknown or verify note instead of inventing conventions that are not evidenced.",
  ]
    .filter(Boolean)
    .join("\n");
}
