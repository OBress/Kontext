import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/api/auth";
import { rateLimit } from "@/lib/api/rate-limit";
import { handleApiError } from "@/lib/api/errors";
import { validateRepoFullName, validateApiKey, validateTarget } from "@/lib/api/validate";
import { generateText } from "@/lib/api/embeddings";
import { formatForTarget } from "@/lib/api/prompt-formatter";
import type { RuleScope, ScopeContent, StackItem } from "@/lib/api/prompt-types";

/* ------------------------------------------------------------------ */
/*  Config files that indicate tech stack                              */
/* ------------------------------------------------------------------ */

const CONFIG_FILES = [
  "package.json", "tsconfig.json", "next.config.js", "next.config.ts", "next.config.mjs",
  "vite.config.ts", "vite.config.js", "webpack.config.js",
  "tailwind.config.js", "tailwind.config.ts", "tailwind.config.mjs",
  "Cargo.toml", "go.mod", "requirements.txt", "Pipfile", "pyproject.toml",
  "Gemfile", "build.gradle", "pom.xml", "Dockerfile", "docker-compose.yml",
  ".eslintrc", ".eslintrc.js", ".eslintrc.json", "eslint.config.js", "eslint.config.mjs",
  "jest.config.ts", "jest.config.js", "vitest.config.ts", ".prettierrc",
  "drizzle.config.ts", "prisma/schema.prisma",
];

/* ------------------------------------------------------------------ */
/*  Scope detection heuristics                                        */
/* ------------------------------------------------------------------ */

interface ScopeDefinition {
  scope: RuleScope;
  /** At least one of these patterns must match a file path to activate this scope */
  patterns: RegExp[];
  /** Default globs if the scope is activated */
  defaultGlobs: string[];
  /** Prompt hint telling the LLM what to cover in this scope */
  promptHint: string;
}

const SCOPE_DEFINITIONS: ScopeDefinition[] = [
  // Root is always included — no patterns needed
  {
    scope: "api",
    patterns: [/^app\/api\//, /^pages\/api\//, /^src\/api\//, /^routes\//, /^server\//],
    defaultGlobs: ["app/api/**/*.ts", "pages/api/**/*.ts", "src/api/**/*.ts", "routes/**/*.ts"],
    promptHint: `Cover: authentication patterns, request validation, error response shapes, rate limiting, middleware usage, Supabase/Prisma/DB client usage in routes, response status code conventions, route file naming.`,
  },
  {
    scope: "components",
    patterns: [/^app\/components\//, /^components\//, /^src\/components\//, /\.tsx$/],
    defaultGlobs: ["app/components/**/*.tsx", "components/**/*.tsx", "src/components/**/*.tsx"],
    promptHint: `Cover: Server vs Client component rules, component file structure, prop typing conventions, composition patterns, state management approach, accessibility standards, naming conventions (PascalCase components, camelCase hooks).`,
  },
  {
    scope: "database",
    patterns: [/^supabase\//, /^prisma\//, /^drizzle\//, /^migrations\//, /^db\//, /schema\.(sql|prisma|ts)/],
    defaultGlobs: ["supabase/**", "prisma/**", "drizzle/**", "migrations/**", "db/**"],
    promptHint: `Cover: migration file format, RLS policies, RPC function conventions, query patterns, index strategy, schema naming (snake_case), seed data conventions, connection pooling.`,
  },
  {
    scope: "styling",
    patterns: [/tailwind\.config/, /^styles\//, /\.css$/, /postcss\.config/, /\.scss$/],
    defaultGlobs: ["styles/**", "**/*.css", "**/*.scss", "tailwind.config.*"],
    promptHint: `Cover: CSS methodology (Tailwind utility classes vs custom CSS), design token usage, responsive breakpoints, dark mode conventions, animation patterns, component styling co-location.`,
  },
  {
    scope: "testing",
    patterns: [/\.(test|spec)\.(ts|tsx|js|jsx)$/, /^__tests__\//, /jest\.config/, /vitest\.config/, /cypress\//],
    defaultGlobs: ["**/*.test.*", "**/*.spec.*", "__tests__/**", "cypress/**"],
    promptHint: `Cover: test framework and assertion library, mocking strategy, test file naming and co-location, integration vs unit test boundaries, fixture/factory patterns, coverage expectations.`,
  },
  {
    scope: "devops",
    patterns: [/^\.github\/workflows\//, /Dockerfile/, /docker-compose/, /^\.ci\//, /^deploy\//, /railway\.json/, /vercel\.json/],
    defaultGlobs: [".github/workflows/**", "Dockerfile", "docker-compose.*", "deploy/**"],
    promptHint: `Cover: CI/CD pipeline conventions, Docker image structure, environment variable management, deployment targets, branch protection rules, infrastructure-as-code patterns.`,
  },
];

/**
 * Analyse the file tree to determine which scopes are relevant.
 */
function detectScopes(filePaths: string[]): ScopeDefinition[] {
  const active: ScopeDefinition[] = [];

  for (const def of SCOPE_DEFINITIONS) {
    const matched = filePaths.some((fp) => def.patterns.some((p) => p.test(fp)));
    if (matched) active.push(def);
  }

  return active;
}

/* ------------------------------------------------------------------ */
/*  Target names (for prompt text)                                     */
/* ------------------------------------------------------------------ */

const TARGET_DISPLAY: Record<string, string> = {
  claude: "Claude Code",
  cursor: "Cursor",
  copilot: "GitHub Copilot",
  antigravity: "Antigravity (Gemini)",
  windsurf: "Windsurf",
  other: "a generic AI coding assistant",
};

/* ------------------------------------------------------------------ */
/*  Build the meta-prompt                                              */
/* ------------------------------------------------------------------ */

function buildMetaPrompt(
  repoFullName: string,
  configContext: string,
  fileTree: string,
  importGraph: string,
  codeSamples: string,
  architectureAnalysis: string | null,
  activeScopes: ScopeDefinition[],
  targetDisplay: string,
  customInstructions: string
): string {
  // Build scope instructions
  const scopedHints = activeScopes.map(
    (s) =>
      `- **${s.scope}** (globs: ${JSON.stringify(s.defaultGlobs)}): ${s.promptHint}`
  ).join("\n\n");

  return `Analyze this repository and generate comprehensive, detailed, scoped AI coding rules for ${targetDisplay}.

## Repository: ${repoFullName}

## Configuration Files
${configContext || "No config files found."}

## File Structure
${fileTree || "No files available."}

## Import Graph (key dependencies)
${importGraph || "Not available."}

## Code Samples (representative files)
${codeSamples || "Not available."}

${architectureAnalysis ? `## Architecture Analysis\n${architectureAnalysis}` : ""}

${customInstructions ? `## Additional Instructions from User\n${customInstructions}` : ""}

## Your Task

### Step 1 — Detect the tech stack
Output a JSON array of ALL detected technologies with specific versions:
\`[{"name": "Tech Name", "category": "Framework|Language|Database|Styling|Testing|DevOps|Tooling|Library", "confidence": 90}]\`
Include EVERY dependency you can identify from the config files — frameworks, libraries, tools, runtimes, everything.

### Step 2 — Generate scoped rule files

You MUST generate **comprehensive, detailed** rule files. Each file must be **80–200 lines** of dense, actionable markdown. Short 10-line bullet lists are NOT acceptable — that level of detail is useless to an AI coding assistant.

#### ROOT scope (globs: ["**/*"])
This is the most important file. It MUST contain ALL of the following sections with substantial detail:

1. **# Project Overview** — What this project does (3-5 sentences). What problem it solves. Who uses it.

2. **# Tech Stack** — A COMPREHENSIVE listing of EVERY technology in use with specific versions:
   - Runtime & language (e.g., Node.js 20, TypeScript 5.x strict mode)
   - Framework (e.g., Next.js 16 App Router)
   - UI libraries (e.g., React 19, Radix UI, Lucide Icons)
   - State management (e.g., Zustand)
   - Styling (e.g., Tailwind CSS v4)
   - Database (e.g., Supabase / PostgreSQL with pgvector)
   - AI / ML (e.g., Google Gemini API, text-embedding-004)
   - Key libraries (e.g., react-markdown, react-syntax-highlighter, jszip, etc.)
   - DevOps tooling (e.g., ESLint, Prettier, etc.)

3. **# Directory Structure** — A tree overview of the project layout with brief descriptions of what each top-level directory contains.

4. **# Commands** — Exact shell commands for: dev server, production build, linting, type checking, database operations.

5. **# Coding Standards** — Universal rules: TypeScript strictness, naming conventions (files, variables, functions, components), import ordering, module patterns.

6. **# Error Handling** — The project's error handling philosophy with references to real files that demonstrate the pattern.

7. **# Security Practices** — Input validation rules, authentication patterns, secrets management (env vars, never hardcode), RLS/authorization enforcement, and any project-specific security conventions.

8. **# Git Workflow** — Branch naming convention, commit message format, PR process.

9. **# Definition of Done** — The checklist for a complete code change.

#### Scoped rule files
${scopedHints}

For each scoped rule file, include:
- A heading describing the scope
- The specific patterns, libraries, and conventions used in that part of the codebase
- At least 1-2 code examples showing the preferred pattern
- Do/Don't pairs for common mistakes
- **Reference existing files as "gold standards"** — e.g., "See \`lib/api/errors.ts\` for the canonical error handling pattern. Match this style."
- References to actual files in the project that demonstrate the patterns

### Writing Quality Requirements
1. **SPECIFICITY**: NEVER write vague rules like "write clean code" or "follow best practices." Write "use early returns to avoid nesting beyond 2 levels. Extract functions longer than 30 lines."
2. **NEGATIVE CONSTRAINTS**: Explicitly state what NOT to do. "NEVER use default exports." "NEVER use \`any\` type — use \`unknown\` with type guards."
3. **CODE EXAMPLES**: Include 2+ code snippets per scope showing the PREFERRED pattern. Always use fenced code blocks with language tags.
4. **REAL PATHS**: Reference actual file paths from this repository. "Follow the error handling pattern in \`lib/api/errors.ts\`."
5. **VERSION SPECIFICITY**: "Next.js 16 App Router" not "Next.js". "TypeScript 5 strict mode" not "TypeScript".
6. **DENSITY**: Each scope content MUST be at least 40 lines of markdown. The root scope MUST be at least 80 lines. If a scope has less than 40 lines, you have not provided enough detail.
7. **IMPERATIVE TONE**: Write rules as direct commands. "Use X. Avoid Y. Always Z."

### Output Format
Respond EXACTLY in this format (no other text before or after):

===STACK_START===
[JSON array of detected technologies]
===STACK_END===
===SCOPES_START===
[
  {"scope": "root", "globs": ["**/*"], "content": "# Project: ...\\n\\nKontext is...\\n\\n## Tech Stack\\n\\n- **Runtime**: Node.js 20...\\n..."},
  {"scope": "api", "globs": ["app/api/**/*.ts"], "content": "# API Conventions\\n\\n## Authentication\\n\\nAll API routes...\\n..."},
  ...
]
===SCOPES_END===`;
}

/* ------------------------------------------------------------------ */
/*  POST handler                                                       */
/* ------------------------------------------------------------------ */

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
    const customInstructions = body.custom_instructions || "";

    // -----------------------------------------------------------------
    // 1. Gather rich context from DB
    // -----------------------------------------------------------------

    // 1a. Config file chunks
    const { data: configChunks } = await supabase
      .from("repo_chunks")
      .select("file_path, content")
      .eq("user_id", user.id)
      .eq("repo_full_name", repoFullName)
      .in("file_path", CONFIG_FILES);

    // 1b. Full file tree with imports
    const { data: files } = await supabase
      .from("repo_files")
      .select("file_path, extension, line_count, imports")
      .eq("user_id", user.id)
      .eq("repo_full_name", repoFullName)
      .limit(500);

    // 1c. Key code samples (entry points, route handlers, DB-related)
    const { data: codeSampleChunks } = await supabase
      .from("repo_chunks")
      .select("file_path, content")
      .eq("user_id", user.id)
      .eq("repo_full_name", repoFullName)
      .eq("chunk_index", 0) // first chunk of each file
      .limit(40);

    // 1d. Architecture analysis (if already computed)
    const { data: repoRow } = await supabase
      .from("repos")
      .select("architecture_analysis")
      .eq("user_id", user.id)
      .eq("full_name", repoFullName)
      .single();

    // -----------------------------------------------------------------
    // 2. Build text representations
    // -----------------------------------------------------------------

    const configContext = (configChunks || [])
      .map((c) => `--- ${c.file_path} ---\n${c.content}`)
      .join("\n\n");

    const filePaths = (files || []).map((f) => f.file_path);
    const fileTree = filePaths.join("\n");

    // Import graph summary
    const importGraph = (files || [])
      .filter((f) => f.imports && f.imports.length > 0)
      .slice(0, 60)
      .map(
        (f) =>
          `  ${f.file_path} → [${(f.imports || []).slice(0, 5).join(", ")}${(f.imports || []).length > 5 ? ` +${(f.imports || []).length - 5} more` : ""}]`
      )
      .join("\n");

    const codeSamples = (codeSampleChunks || [])
      .slice(0, 30)
      .map((c) => `--- ${c.file_path} ---\n${c.content.slice(0, 500)}`)
      .join("\n\n");

    const archJson = repoRow?.architecture_analysis
      ? JSON.stringify(repoRow.architecture_analysis, null, 2).slice(0, 3000)
      : null;

    // -----------------------------------------------------------------
    // 3. Detect relevant scopes
    // -----------------------------------------------------------------

    const activeScopes = detectScopes(filePaths);

    // -----------------------------------------------------------------
    // 4. Call Gemini with the multi-scope meta-prompt
    // -----------------------------------------------------------------

    const systemInstruction = `You are an expert software architect and AI prompt engineer. You analyze codebases and generate precise, scoped, actionable rules that AI coding assistants follow when working on a project. You output ONLY the requested format — no preamble, no explanation outside the delimiters.`;

    const metaPrompt = buildMetaPrompt(
      repoFullName,
      configContext,
      fileTree,
      importGraph,
      codeSamples,
      archJson,
      activeScopes,
      TARGET_DISPLAY[target] || target,
      customInstructions
    );

    const result = await generateText(apiKey, metaPrompt, systemInstruction);

    // -----------------------------------------------------------------
    // 5. Parse the LLM response
    // -----------------------------------------------------------------

    let detectedStack: StackItem[] = [];
    let scopeContents: ScopeContent[] = [];

    const stackMatch = result.match(/===STACK_START===\s*([\s\S]*?)\s*===STACK_END===/);
    const scopesMatch = result.match(/===SCOPES_START===\s*([\s\S]*?)\s*===SCOPES_END===/);

    if (stackMatch) {
      try {
        detectedStack = JSON.parse(stackMatch[1]);
      } catch {
        // parse failed, leave empty
      }
    }

    if (scopesMatch) {
      try {
        scopeContents = JSON.parse(scopesMatch[1]);
      } catch {
        // If JSON parsing fails, treat the whole result as a single root scope
        scopeContents = [{ scope: "root", globs: ["**/*"], content: result }];
      }
    } else {
      // Fallback: if the LLM didn't follow format, use entire output as root
      const promptMatch = result.match(/===PROMPT_START===\s*([\s\S]*?)\s*===PROMPT_END===/);
      const fallbackContent = promptMatch ? promptMatch[1].trim() : result;
      scopeContents = [{ scope: "root", globs: ["**/*"], content: fallbackContent }];
    }

    // Ensure root scope exists
    if (!scopeContents.some((s) => s.scope === "root")) {
      scopeContents.unshift({ scope: "root", globs: ["**/*"], content: "# Project Rules\n\nNo root rules generated." });
    }

    // -----------------------------------------------------------------
    // 6. Format for the target IDE
    // -----------------------------------------------------------------

    const ruleFiles = formatForTarget(target, scopeContents);

    // Build combined preview text
    const combinedPrompt = scopeContents.map((s) => s.content).join("\n\n---\n\n");

    // -----------------------------------------------------------------
    // 7. Cache in database
    // -----------------------------------------------------------------

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
