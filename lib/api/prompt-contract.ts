import type { GenerationConfig } from "@google/generative-ai";

export type PromptTaskKind =
  | "repo_instruction_synthesizer"
  | "grounded_explainer"
  | "skeptical_reviewer"
  | "technical_teacher"
  | "system_mapper"
  | "high_signal_compressor";

export interface PromptFact {
  label: string;
  value: string | string[];
  confidence?: "exact" | "inferred" | "unknown";
}

export interface PromptExcerpt {
  title: string;
  source?: string;
  content: string;
  reason?: string;
}

export interface EvidencePack {
  summary?: string;
  facts?: PromptFact[];
  excerpts?: PromptExcerpt[];
  coverageGaps?: string[];
}

export interface TaskSystemInstructionOptions {
  task: PromptTaskKind;
  role: string;
  mission: string;
  outputStyle?: string[];
  taskRules?: string[];
}

export const PROMPT_GENERATION_CONFIGS = {
  structuredJson: {
    temperature: 0.1,
    topP: 0.8,
    maxOutputTokens: 8192,
  },
  groundedAnswer: {
    temperature: 0.2,
    topP: 0.85,
    maxOutputTokens: 3072,
  },
  ruleSynthesis: {
    temperature: 0.35,
    topP: 0.9,
    maxOutputTokens: 4096,
  },
  architecture: {
    temperature: 0.15,
    topP: 0.85,
    maxOutputTokens: 4096,
  },
  summary: {
    temperature: 0.2,
    topP: 0.8,
    maxOutputTokens: 768,
  },
} satisfies Record<string, GenerationConfig>;

const TASK_DESCRIPTIONS: Record<PromptTaskKind, string> = {
  repo_instruction_synthesizer:
    "Synthesize concise, repo-specific coding instructions from mixed evidence without padding or boilerplate.",
  grounded_explainer:
    "Answer repository questions using only the supplied evidence pack and clearly mark uncertainty.",
  skeptical_reviewer:
    "Review code and repo health skeptically, prefer no finding over weak speculation, and keep findings actionable.",
  technical_teacher:
    "Teach a new engineer how to navigate the repo with concrete, repo-specific steps and examples.",
  system_mapper:
    "Map a codebase into a useful architecture model based on representative evidence, not exhaustive guesses.",
  high_signal_compressor:
    "Compress evidence into short, searchable summaries that keep the important nouns, actions, and caveats.",
};

const SHARED_PROMPT_RULES = [
  "Evidence hierarchy: prefer exact evidence from facts or excerpts, then carefully labeled inference, then explicit unknown.",
  "Never invent repo facts, versions, paths, ownership, or behavior that are not supported by the supplied evidence.",
  "If context is partial, say so briefly and continue with the strongest supported answer instead of guessing.",
  "Use only the supplied evidence pack and task instructions. Do not rely on hidden assumptions or generic boilerplate.",
  "Keep the output tight, specific, and directly useful for the task. Avoid filler, hype, and motivational language.",
];

function formatTaskStyle(outputStyle: string[]): string {
  if (outputStyle.length === 0) return "";
  return `Output style:\n${outputStyle.map((rule) => `- ${rule}`).join("\n")}`;
}

function formatTaskRules(taskRules: string[]): string {
  if (taskRules.length === 0) return "";
  return `Task rules:\n${taskRules.map((rule) => `- ${rule}`).join("\n")}`;
}

export function buildTaskSystemInstruction(
  options: TaskSystemInstructionOptions
): string {
  const outputStyle = options.outputStyle || [];
  const taskRules = options.taskRules || [];

  return [
    `You are ${options.role}.`,
    options.mission,
    TASK_DESCRIPTIONS[options.task],
    "",
    "Shared rules:",
    ...SHARED_PROMPT_RULES.map((rule) => `- ${rule}`),
    formatTaskStyle(outputStyle),
    formatTaskRules(taskRules),
  ]
    .filter(Boolean)
    .join("\n");
}

function formatFactValue(value: string | string[]): string {
  if (Array.isArray(value)) {
    return value.length === 0 ? "(none)" : value.join(", ");
  }
  return value || "(empty)";
}

export function formatEvidencePack(pack: EvidencePack): string {
  const sections: string[] = [];

  if (pack.summary) {
    sections.push(`Evidence summary:\n${pack.summary}`);
  }

  if (pack.facts && pack.facts.length > 0) {
    sections.push(
      [
        "Structured facts:",
        ...pack.facts.map((fact) => {
          const confidence =
            fact.confidence && fact.confidence !== "exact"
              ? ` [${fact.confidence}]`
              : "";
          return `- ${fact.label}${confidence}: ${formatFactValue(fact.value)}`;
        }),
      ].join("\n")
    );
  }

  if (pack.excerpts && pack.excerpts.length > 0) {
    sections.push(
      [
        "Curated raw excerpts:",
        ...pack.excerpts.map((excerpt) =>
          [
            `--- ${excerpt.title}${excerpt.source ? ` (${excerpt.source})` : ""} ---`,
            excerpt.reason ? `Why it matters: ${excerpt.reason}` : "",
            excerpt.content.trim(),
          ]
            .filter(Boolean)
            .join("\n")
        ),
      ].join("\n\n")
    );
  }

  if (pack.coverageGaps && pack.coverageGaps.length > 0) {
    sections.push(
      [
        "Coverage gaps:",
        ...pack.coverageGaps.map((gap) => `- ${gap}`),
      ].join("\n")
    );
  }

  return sections.join("\n\n");
}

export function truncatePromptText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}\n... [truncated]`;
}
