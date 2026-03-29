import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/api/auth";
import { rateLimit } from "@/lib/api/rate-limit";
import { handleApiError } from "@/lib/api/errors";
import {
  validateApiKey,
  validateRepoFullName,
  validateTarget,
} from "@/lib/api/validate";
import { generateStructuredJson } from "@/lib/api/embeddings";
import { formatForTarget } from "@/lib/api/prompt-formatter";
import {
  buildRuleRootPrompt,
  buildRuleRootSystemInstruction,
  buildRuleScopePrompt,
  buildRuleScopeSystemInstruction,
  extractDeterministicRuleFacts,
  mergeDetectedStack,
  normalizeRootRuleResponse,
  normalizeScopeRuleResponse,
  ROOT_RULE_RESPONSE_SCHEMA,
  SCOPE_RULE_RESPONSE_SCHEMA,
  type RepoChunkContext,
  type RepoFileContext,
  type ScopePromptContext,
} from "@/lib/api/rule-generator";
import { PROMPT_GENERATION_CONFIGS } from "@/lib/api/prompt-contract";
import type { RuleScope, ScopeContent } from "@/lib/api/prompt-types";

const CONFIG_FILES = [
  "package.json",
  "tsconfig.json",
  "next.config.js",
  "next.config.ts",
  "next.config.mjs",
  "vite.config.ts",
  "vite.config.js",
  "webpack.config.js",
  "tailwind.config.js",
  "tailwind.config.ts",
  "tailwind.config.mjs",
  "Cargo.toml",
  "go.mod",
  "requirements.txt",
  "Pipfile",
  "pyproject.toml",
  "Gemfile",
  "build.gradle",
  "pom.xml",
  "Dockerfile",
  "docker-compose.yml",
  ".eslintrc",
  ".eslintrc.js",
  ".eslintrc.json",
  "eslint.config.js",
  "eslint.config.mjs",
  "jest.config.ts",
  "jest.config.js",
  "vitest.config.ts",
  ".prettierrc",
  "drizzle.config.ts",
  "prisma/schema.prisma",
];

interface ScopeDefinition {
  scope: RuleScope;
  patterns: RegExp[];
  defaultGlobs: string[];
  promptHint: string;
}

const SCOPE_DEFINITIONS: ScopeDefinition[] = [
  {
    scope: "api",
    patterns: [/^app\/api\//, /^pages\/api\//, /^src\/api\//, /^routes\//, /^server\//],
    defaultGlobs: [
      "app/api/**/*.ts",
      "pages/api/**/*.ts",
      "src/api/**/*.ts",
      "routes/**/*.ts",
    ],
    promptHint:
      "Cover authentication patterns, request validation, error responses, rate limiting, middleware usage, data access in routes, and status code conventions.",
  },
  {
    scope: "components",
    patterns: [/^app\/components\//, /^components\//, /^src\/components\//, /\.tsx$/],
    defaultGlobs: [
      "app/components/**/*.tsx",
      "components/**/*.tsx",
      "src/components/**/*.tsx",
    ],
    promptHint:
      "Cover Server vs Client component boundaries, prop typing, composition patterns, state management, accessibility, and naming conventions.",
  },
  {
    scope: "database",
    patterns: [/^supabase\//, /^prisma\//, /^drizzle\//, /^migrations\//, /^db\//, /schema\.(sql|prisma|ts)/],
    defaultGlobs: ["supabase/**", "prisma/**", "drizzle/**", "migrations/**", "db/**"],
    promptHint:
      "Cover schema conventions, migrations, RLS and authorization, RPC usage, query patterns, and indexing strategy.",
  },
  {
    scope: "styling",
    patterns: [/tailwind\.config/, /^styles\//, /\.css$/, /postcss\.config/, /\.scss$/],
    defaultGlobs: ["styles/**", "**/*.css", "**/*.scss", "tailwind.config.*"],
    promptHint:
      "Cover styling methodology, design tokens, responsive breakpoints, animation patterns, and style co-location.",
  },
  {
    scope: "testing",
    patterns: [/\.(test|spec)\.(ts|tsx|js|jsx)$/, /^__tests__\//, /jest\.config/, /vitest\.config/, /cypress\//],
    defaultGlobs: ["**/*.test.*", "**/*.spec.*", "__tests__/**", "cypress/**"],
    promptHint:
      "Cover test framework usage, mocking strategy, naming and co-location, fixture patterns, and unit vs integration boundaries.",
  },
  {
    scope: "devops",
    patterns: [/^\.github\/workflows\//, /Dockerfile/, /docker-compose/, /^\.ci\//, /^deploy\//, /railway\.json/, /vercel\.json/],
    defaultGlobs: [".github/workflows/**", "Dockerfile", "docker-compose.*", "deploy/**"],
    promptHint:
      "Cover CI or CD workflows, environment variable handling, deployment targets, container setup, and release conventions.",
  },
];

const TARGET_DISPLAY: Record<string, string> = {
  claude: "Claude Code",
  cursor: "Cursor",
  copilot: "GitHub Copilot",
  antigravity: "Antigravity (Gemini)",
  windsurf: "Windsurf",
  other: "a generic AI coding assistant",
};

function detectScopes(filePaths: string[]): ScopeDefinition[] {
  const active: ScopeDefinition[] = [];

  for (const definition of SCOPE_DEFINITIONS) {
    const matched = filePaths.some((filePath) =>
      definition.patterns.some((pattern) => pattern.test(filePath))
    );

    if (matched) {
      active.push(definition);
    }
  }

  return active;
}

function toScopePromptContexts(
  definitions: ScopeDefinition[]
): ScopePromptContext[] {
  return definitions.map((definition) => ({
    scope: definition.scope,
    globs: definition.defaultGlobs,
    promptHint: definition.promptHint,
  }));
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

export async function POST(request: Request) {
  try {
    const { user, supabase } = await getAuthenticatedUser();

    const rl = rateLimit(user.id, "prompts");
    if (!rl.ok) {
      return NextResponse.json(
        { error: { code: "RATE_LIMITED", message: "Too many requests" } },
        { status: 429 }
      );
    }

    const body = await request.json();
    const repoFullName = validateRepoFullName(body.repo_full_name);
    const apiKey = validateApiKey(request);
    const target = validateTarget(body.target);
    const customInstructions =
      typeof body.custom_instructions === "string"
        ? body.custom_instructions.trim()
        : "";

    const { data: configRows } = await supabase
      .from("repo_chunks")
      .select("file_path, content")
      .eq("user_id", user.id)
      .eq("repo_full_name", repoFullName)
      .in("file_path", CONFIG_FILES);

    const { data: fileRows } = await supabase
      .from("repo_files")
      .select("file_path, extension, line_count, imports")
      .eq("user_id", user.id)
      .eq("repo_full_name", repoFullName)
      .order("file_path", { ascending: true })
      .limit(500);

    const { data: repoRow } = await supabase
      .from("repos")
      .select("architecture_analysis")
      .eq("user_id", user.id)
      .eq("full_name", repoFullName)
      .single();

    const files = ((fileRows || []) as RepoFileContext[]).map((file) => ({
      ...file,
      imports: Array.isArray(file.imports) ? file.imports : [],
    }));
    const filePaths = files.map((file) => file.file_path);
    const activeScopeDefinitions = detectScopes(filePaths);
    const activeScopes = toScopePromptContexts(activeScopeDefinitions);
    const configChunks = (configRows || []) as RepoChunkContext[];

    const deterministicFacts = extractDeterministicRuleFacts(
      configChunks,
      files,
      activeScopes
    );

    const evidencePaths = unique(
      [
        ...deterministicFacts.rootCandidatePaths,
        ...activeScopes.flatMap(
          (scope) => deterministicFacts.scopeCandidatePaths[scope.scope] || []
        ),
      ].filter(Boolean)
    );

    const { data: evidenceRows } =
      evidencePaths.length > 0
        ? await supabase
            .from("repo_chunks")
            .select("file_path, content")
            .eq("user_id", user.id)
            .eq("repo_full_name", repoFullName)
            .eq("chunk_index", 0)
            .in("file_path", evidencePaths)
        : { data: [] as RepoChunkContext[] };

    const evidenceChunks = (evidenceRows || []) as RepoChunkContext[];
    const architectureAnalysis = repoRow?.architecture_analysis
      ? JSON.stringify(repoRow.architecture_analysis, null, 2).slice(0, 4000)
      : null;

    const targetDisplay = TARGET_DISPLAY[target] || target;
    const rootResponse = await generateStructuredJson(apiKey, buildRuleRootPrompt({
      repoFullName,
      targetDisplay,
      facts: deterministicFacts,
      configChunks,
      rootChunks: evidenceChunks,
      architectureAnalysis,
      activeScopes,
      customInstructions,
    }), {
      systemInstruction: buildRuleRootSystemInstruction(targetDisplay),
      generationConfig: PROMPT_GENERATION_CONFIGS.ruleSynthesis,
      responseSchema: ROOT_RULE_RESPONSE_SCHEMA,
      transform: normalizeRootRuleResponse,
    });

    const scopeContents: ScopeContent[] = [
      { scope: "root", globs: ["**/*"], content: rootResponse.content },
    ];

    for (const scope of activeScopes) {
      try {
        const scopeResponse = await generateStructuredJson(
          apiKey,
          buildRuleScopePrompt({
            repoFullName,
            targetDisplay,
            scope,
            rootSummary: rootResponse.summary,
            facts: deterministicFacts,
            scopeChunks: evidenceChunks,
            customInstructions,
          }),
          {
            systemInstruction: buildRuleScopeSystemInstruction(
              targetDisplay,
              scope.scope
            ),
            generationConfig: PROMPT_GENERATION_CONFIGS.ruleSynthesis,
            responseSchema: SCOPE_RULE_RESPONSE_SCHEMA,
            transform: normalizeScopeRuleResponse,
          }
        );

        scopeContents.push({
          scope: scope.scope,
          globs: scope.globs,
          content: scopeResponse.content,
        });
      } catch (error: unknown) {
        console.warn(
          `[prompts] Failed to generate ${scope.scope} scope for ${repoFullName}:`,
          error
        );
      }
    }

    const detectedStack = mergeDetectedStack(
      deterministicFacts.seedStack,
      rootResponse.detectedStack
    );
    const ruleFiles = formatForTarget(target, scopeContents);
    const combinedPrompt = scopeContents
      .map((scope) => scope.content)
      .join("\n\n---\n\n");

    await supabase.from("generated_prompts").insert({
      user_id: user.id,
      repo_full_name: repoFullName,
      target,
      detected_stack: detectedStack,
      prompt_text: combinedPrompt,
      custom_instructions: customInstructions || null,
      rule_files: ruleFiles,
    });

    return NextResponse.json({
      prompt: combinedPrompt,
      detectedStack,
      files: ruleFiles,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
