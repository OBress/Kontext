/**
 * Per-IDE rule formatters.
 *
 * Each formatter takes canonical ScopeContent[] (IDE-agnostic markdown)
 * and wraps it in the native file structure / metadata / frontmatter
 * expected by that specific tool.
 */

import type { RuleFile, RuleScope, ScopeContent } from "./prompt-types";

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

/** Human-readable description per scope */
const SCOPE_DESCRIPTIONS: Record<RuleScope, string> = {
  root: "Global project standards, tech stack, and conventions",
  api: "API route conventions, auth patterns, and error handling",
  components: "React/UI component patterns, styling, and composition",
  database: "Database conventions, migrations, queries, and schema patterns",
  styling: "CSS/styling framework conventions and design tokens",
  testing: "Test framework, assertion style, mocking, and coverage",
  devops: "CI/CD, Docker, deployment, and infrastructure patterns",
};

/** Scope → human-readable label for file naming */
const SCOPE_LABELS: Record<RuleScope, string> = {
  root: "project",
  api: "api-routes",
  components: "components",
  database: "database",
  styling: "styling",
  testing: "testing",
  devops: "devops",
};

/* ------------------------------------------------------------------ */
/*  CURSOR — .cursor/rules/*.mdc                                     */
/* ------------------------------------------------------------------ */

export function formatForCursor(scopes: ScopeContent[]): RuleFile[] {
  return scopes.map((s) => {
    const isRoot = s.scope === "root";
    const frontmatter = isRoot
      ? `---\ndescription: Global project standards and conventions\nalwaysApply: true\n---\n\n`
      : `---\ndescription: ${SCOPE_DESCRIPTIONS[s.scope]}\nglobs:\n${s.globs.map((g) => `  - "${g}"`).join("\n")}\nalwaysApply: false\n---\n\n`;

    return {
      path: `.cursor/rules/${SCOPE_LABELS[s.scope]}.mdc`,
      content: frontmatter + s.content,
      scope: s.scope,
      description: SCOPE_DESCRIPTIONS[s.scope],
    };
  });
}

/* ------------------------------------------------------------------ */
/*  GITHUB COPILOT — .github/copilot-instructions.md                 */
/*                    .github/instructions/*.instructions.md          */
/* ------------------------------------------------------------------ */

export function formatForCopilot(scopes: ScopeContent[]): RuleFile[] {
  return scopes.map((s) => {
    const isRoot = s.scope === "root";

    if (isRoot) {
      return {
        path: ".github/copilot-instructions.md",
        content: s.content,
        scope: s.scope,
        description: SCOPE_DESCRIPTIONS[s.scope],
      };
    }

    const frontmatter = `---\napplyTo:\n${s.globs.map((g) => `  - "${g}"`).join("\n")}\n---\n\n`;
    return {
      path: `.github/instructions/${SCOPE_LABELS[s.scope]}.instructions.md`,
      content: frontmatter + s.content,
      scope: s.scope,
      description: SCOPE_DESCRIPTIONS[s.scope],
    };
  });
}

/* ------------------------------------------------------------------ */
/*  CLAUDE CODE — CLAUDE.md + subdirectory CLAUDE.md files            */
/* ------------------------------------------------------------------ */

/** Map scope → directory where a CLAUDE.md should be placed */
const CLAUDE_SCOPE_DIRS: Record<RuleScope, string> = {
  root: "",
  api: "app/api",
  components: "app/components",
  database: "supabase",
  styling: "styles",
  testing: "__tests__",
  devops: ".github",
};

export function formatForClaude(scopes: ScopeContent[]): RuleFile[] {
  return scopes.map((s) => {
    const dir = CLAUDE_SCOPE_DIRS[s.scope];
    const path = dir ? `${dir}/CLAUDE.md` : "CLAUDE.md";

    return {
      path,
      content: s.content,
      scope: s.scope,
      description: SCOPE_DESCRIPTIONS[s.scope],
    };
  });
}

/* ------------------------------------------------------------------ */
/*  ANTIGRAVITY (GEMINI) — AGENTS.md + .agents/rules/*.md             */
/* ------------------------------------------------------------------ */

export function formatForAntigravity(scopes: ScopeContent[]): RuleFile[] {
  return scopes.map((s) => {
    const isRoot = s.scope === "root";

    if (isRoot) {
      return {
        path: "AGENTS.md",
        content: s.content,
        scope: s.scope,
        description: SCOPE_DESCRIPTIONS[s.scope],
      };
    }

    return {
      path: `.agents/rules/${SCOPE_LABELS[s.scope]}.md`,
      content: s.content,
      scope: s.scope,
      description: SCOPE_DESCRIPTIONS[s.scope],
    };
  });
}

/* ------------------------------------------------------------------ */
/*  WINDSURF — .windsurf/rules/*.md                                  */
/* ------------------------------------------------------------------ */

export function formatForWindsurf(scopes: ScopeContent[]): RuleFile[] {
  return scopes.map((s) => {
    const isRoot = s.scope === "root";

    if (isRoot) {
      return {
        path: ".windsurf/rules/global.md",
        content: s.content,
        scope: s.scope,
        description: SCOPE_DESCRIPTIONS[s.scope],
      };
    }

    // Windsurf uses comma-separated globs in a single string
    const globStr = s.globs.join(", ");
    const frontmatter = `---\ntrigger: glob\nglobs: "${globStr}"\n---\n\n`;
    return {
      path: `.windsurf/rules/${SCOPE_LABELS[s.scope]}.md`,
      content: frontmatter + s.content,
      scope: s.scope,
      description: SCOPE_DESCRIPTIONS[s.scope],
    };
  });
}

/* ------------------------------------------------------------------ */
/*  OTHER (Generic) — single system-prompt.md                        */
/* ------------------------------------------------------------------ */

export function formatForOther(scopes: ScopeContent[]): RuleFile[] {
  // Combine all scopes into a single markdown document
  const combined = scopes
    .map((s) => {
      if (s.scope === "root") return s.content;
      return `---\n\n${s.content}`;
    })
    .join("\n\n");

  return [
    {
      path: "system-prompt.md",
      content: combined,
      scope: "root",
      description: "Complete system prompt — copy and paste into any AI tool",
    },
  ];
}

/* ------------------------------------------------------------------ */
/*  Router                                                            */
/* ------------------------------------------------------------------ */

import type { PromptTarget } from "./prompt-types";

const FORMATTERS: Record<PromptTarget, (scopes: ScopeContent[]) => RuleFile[]> = {
  cursor: formatForCursor,
  copilot: formatForCopilot,
  claude: formatForClaude,
  antigravity: formatForAntigravity,
  windsurf: formatForWindsurf,
  other: formatForOther,
};

/**
 * Format canonical scope contents for the specified IDE target.
 */
export function formatForTarget(
  target: PromptTarget,
  scopes: ScopeContent[]
): RuleFile[] {
  const formatter = FORMATTERS[target];
  return formatter(scopes);
}
