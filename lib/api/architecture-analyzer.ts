import type { ResponseSchema } from "@google/generative-ai";
import { SchemaType } from "@google/generative-ai";
import type {
  ArchConnectionType,
  ArchComponentType,
  ArchitectureAnalysis,
} from "@/types/architecture";
import { ApiError } from "./errors";
import { generateStructuredJson } from "./embeddings";
import {
  buildTaskSystemInstruction,
  formatEvidencePack,
  PROMPT_GENERATION_CONFIGS,
} from "./prompt-contract";

interface FileMetadata {
  file_path: string;
  file_name: string;
  extension: string | null;
  line_count: number;
  imports: string[];
}

interface ChunkSample {
  file_path: string;
  content: string;
}

function isArchComponentType(value: unknown): value is ArchComponentType {
  return (
    typeof value === "string" &&
    [
      "page",
      "api",
      "service",
      "worker",
      "database",
      "config",
      "shared",
      "external",
    ].includes(value)
  );
}

function isArchConnectionType(value: unknown): value is ArchConnectionType {
  return (
    typeof value === "string" &&
    [
      "api_call",
      "import",
      "webhook",
      "database_query",
      "auth",
      "event",
    ].includes(value)
  );
}

const ARCH_COMPONENT_TYPE_SCHEMA: ResponseSchema = {
  type: SchemaType.STRING,
  format: "enum",
  enum: [
    "page",
    "api",
    "service",
    "worker",
    "database",
    "config",
    "shared",
    "external",
  ],
};

const ARCH_CONNECTION_TYPE_SCHEMA: ResponseSchema = {
  type: SchemaType.STRING,
  format: "enum",
  enum: [
    "api_call",
    "import",
    "webhook",
    "database_query",
    "auth",
    "event",
  ],
};

const ARCH_CHILD_SCHEMA: ResponseSchema = {
  type: SchemaType.OBJECT,
  properties: {
    id: { type: SchemaType.STRING },
    label: { type: SchemaType.STRING },
    description: { type: SchemaType.STRING },
    type: ARCH_COMPONENT_TYPE_SCHEMA,
    files: {
      type: SchemaType.ARRAY,
      items: { type: SchemaType.STRING },
    },
  },
  required: ["id", "label", "description", "type", "files"],
};

const ARCH_COMPONENT_SCHEMA: ResponseSchema = {
  type: SchemaType.OBJECT,
  properties: {
    id: { type: SchemaType.STRING },
    label: { type: SchemaType.STRING },
    description: { type: SchemaType.STRING },
    type: ARCH_COMPONENT_TYPE_SCHEMA,
    files: {
      type: SchemaType.ARRAY,
      items: { type: SchemaType.STRING },
    },
    children: {
      type: SchemaType.ARRAY,
      items: ARCH_CHILD_SCHEMA,
    },
  },
  required: ["id", "label", "description", "type", "files"],
};

const ARCH_CONNECTION_SCHEMA: ResponseSchema = {
  type: SchemaType.OBJECT,
  properties: {
    id: { type: SchemaType.STRING },
    source: { type: SchemaType.STRING },
    target: { type: SchemaType.STRING },
    label: { type: SchemaType.STRING },
    description: { type: SchemaType.STRING },
    type: ARCH_CONNECTION_TYPE_SCHEMA,
  },
  required: ["id", "source", "target", "label", "description", "type"],
};

const ARCHITECTURE_RESPONSE_SCHEMA: ResponseSchema = {
  type: SchemaType.OBJECT,
  properties: {
    summary: { type: SchemaType.STRING },
    components: {
      type: SchemaType.ARRAY,
      minItems: 3,
      maxItems: 10,
      items: ARCH_COMPONENT_SCHEMA,
    },
    connections: {
      type: SchemaType.ARRAY,
      items: ARCH_CONNECTION_SCHEMA,
    },
    unassignedFiles: {
      type: SchemaType.ARRAY,
      items: { type: SchemaType.STRING },
    },
  },
  required: ["summary", "components", "connections"],
};

export function buildArchitectureAnalysisSystemInstruction(): string {
  return buildTaskSystemInstruction({
    task: "system_mapper",
    role: "a senior software architect",
    mission:
      "Produce a high-level architecture model from representative repository evidence.",
    outputStyle: [
      "Return structured JSON only.",
      "Favor a human-usable architecture model over exhaustive classification.",
      "Use representative files for components and mention leftovers in unassignedFiles when needed.",
    ],
    taskRules: [
      "Group files by user-visible responsibility, not by folder name alone.",
      "Do not force every file into a component if the evidence is incomplete.",
      "Only create child components when they improve comprehension.",
    ],
  });
}

export function buildAnalysisPrompt(
  repoFullName: string,
  files: FileMetadata[],
  chunkSamples: ChunkSample[]
): string {
  const fileTree = files
    .map(
      (file) =>
        `  ${file.file_path} (${file.line_count} lines, imports: ${file.imports.length})`
    )
    .join("\n");

  const importSummary = files
    .filter((file) => file.imports.length > 0)
    .slice(0, 60)
    .map(
      (file) =>
        `  ${file.file_path} -> [${file.imports.slice(0, 5).join(", ")}${file.imports.length > 5 ? ` +${file.imports.length - 5} more` : ""}]`
    )
    .join("\n");

  const codeSamples = chunkSamples
    .slice(0, 40)
    .map((sample) => `--- ${sample.file_path} ---\n${sample.content.slice(0, 600)}`)
    .join("\n\n");

  const evidencePack = formatEvidencePack({
    summary:
      "Use representative repository evidence to produce a readable architecture model.",
    facts: [
      { label: "Repository", value: repoFullName, confidence: "exact" },
      {
        label: "Total indexed files",
        value: String(files.length),
        confidence: "exact",
      },
    ],
    excerpts: [
      {
        title: "File tree",
        source: repoFullName,
        reason: "Use this to identify major responsibilities and boundaries.",
        content: fileTree,
      },
      {
        title: "Import graph summary",
        source: repoFullName,
        reason: "Use this to infer major relationships between components.",
        content: importSummary || "No import data was available.",
      },
      {
        title: "Representative code samples",
        source: repoFullName,
        reason: "Use these to name components by role and understand what they do.",
        content: codeSamples || "No representative code samples were available.",
      },
    ],
  });

  return [
    "Analyze the codebase and produce a high-level architecture model.",
    "",
    evidencePack,
    "",
    "Architecture requirements:",
    "- Identify 4 to 10 top-level components a human would recognize.",
    "- Name components by role, not folder name alone.",
    "- Add children only when they improve clarity.",
    "- List representative files for each component. Do not force every file into a component.",
    "- Use unassignedFiles for meaningful leftovers that are not confidently grouped.",
    "- Keep connections between top-level components only.",
    "- Make descriptions concise and concrete.",
  ].join("\n");
}

function normalizeAnalysisResponse(value: unknown): ArchitectureAnalysis {
  if (!value || typeof value !== "object") {
    throw new ApiError(
      502,
      "AI_PARSE_ERROR",
      "Architecture analysis response was not an object."
    );
  }

  const record = value as Record<string, unknown>;
  const components = Array.isArray(record.components)
    ? record.components
        .filter(
          (component): component is Record<string, unknown> =>
            !!component && typeof component === "object"
        )
        .map((component) => ({
          id: typeof component.id === "string" ? component.id.trim() : "",
          label:
            typeof component.label === "string" ? component.label.trim() : "",
          description:
            typeof component.description === "string"
              ? component.description.trim()
              : "",
          type: isArchComponentType(component.type)
            ? component.type
            : "shared",
          files: Array.isArray(component.files)
            ? component.files.filter(
                (file): file is string =>
                  typeof file === "string" && file.trim().length > 0
              )
            : [],
          children: Array.isArray(component.children)
            ? component.children
                .filter(
                  (child): child is Record<string, unknown> =>
                    !!child && typeof child === "object"
                )
                .map((child) => ({
                  id: typeof child.id === "string" ? child.id.trim() : "",
                  label:
                    typeof child.label === "string" ? child.label.trim() : "",
                  description:
                    typeof child.description === "string"
                      ? child.description.trim()
                      : "",
                  type: isArchComponentType(child.type)
                    ? child.type
                    : "shared",
                  files: Array.isArray(child.files)
                    ? child.files.filter(
                        (file): file is string =>
                          typeof file === "string" && file.trim().length > 0
                      )
                    : [],
                }))
                .filter((child) => child.id && child.label)
            : undefined,
        }))
        .filter((component) => component.id && component.label)
    : [];

  if (components.length === 0) {
    throw new ApiError(
      502,
      "AI_PARSE_ERROR",
      "Architecture analysis did not include any valid components."
    );
  }

  const componentIds = new Set(components.map((component) => component.id));
  const connections = Array.isArray(record.connections)
    ? record.connections
        .filter(
          (connection): connection is Record<string, unknown> =>
            !!connection && typeof connection === "object"
        )
        .map((connection) => ({
          id:
            typeof connection.id === "string" ? connection.id.trim() : "",
          source:
            typeof connection.source === "string"
              ? connection.source.trim()
              : "",
          target:
            typeof connection.target === "string"
              ? connection.target.trim()
              : "",
          label:
            typeof connection.label === "string"
              ? connection.label.trim()
              : "",
          description:
            typeof connection.description === "string"
              ? connection.description.trim()
              : "",
          type: isArchConnectionType(connection.type)
            ? connection.type
            : "import",
        }))
        .filter(
          (connection) =>
            connection.id &&
            connection.source &&
            connection.target &&
            componentIds.has(connection.source) &&
            componentIds.has(connection.target)
        )
    : [];

  return {
    summary:
      typeof record.summary === "string" && record.summary.trim()
        ? record.summary.trim()
        : "Architecture summary unavailable.",
    components,
    connections,
    unassignedFiles: Array.isArray(record.unassignedFiles)
      ? record.unassignedFiles.filter(
          (file): file is string =>
            typeof file === "string" && file.trim().length > 0
        )
      : [],
  };
}

export async function analyzeArchitecture(
  apiKey: string,
  repoFullName: string,
  files: FileMetadata[],
  chunkSamples: ChunkSample[]
): Promise<ArchitectureAnalysis> {
  return generateStructuredJson(apiKey, buildAnalysisPrompt(repoFullName, files, chunkSamples), {
    systemInstruction: buildArchitectureAnalysisSystemInstruction(),
    generationConfig: PROMPT_GENERATION_CONFIGS.structuredJson,
    responseSchema: ARCHITECTURE_RESPONSE_SCHEMA,
    transform: normalizeAnalysisResponse,
  });
}
