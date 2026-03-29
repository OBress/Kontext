import type {
  ArchComponentType,
  ArchConnectionType,
  ArchitectureLayerId,
} from "@/types/architecture";

export type ChatVisualKind =
  | "kontext-timeline"
  | "kontext-architecture"
  | "mermaid";

export interface ChatTimelineVisualEvent {
  sha: string;
  date: string;
  committedAt: string;
  summary: string;
  message: string;
  author: string;
  similarity: number | null;
  matched: boolean;
}

export interface ChatTimelineVisualPayload {
  kind: "kontext-timeline";
  title: string;
  summary: string;
  events: ChatTimelineVisualEvent[];
}

export interface ChatArchitectureVisualNode {
  id: string;
  label: string;
  description: string;
  type: ArchComponentType;
  highlighted: boolean;
}

export interface ChatArchitectureVisualEdge {
  id: string;
  source: string;
  target: string;
  label: string;
  description: string;
  type: ArchConnectionType;
  highlighted: boolean;
}

export interface ChatArchitectureVisualPayload {
  kind: "kontext-architecture";
  title: string;
  summary: string;
  layerId: ArchitectureLayerId;
  traceLabel: string | null;
  pathNodeIds: string[];
  nodes: ChatArchitectureVisualNode[];
  edges: ChatArchitectureVisualEdge[];
}

export interface ChatMermaidVisualPayload {
  kind: "mermaid";
  title: string;
  description: string;
  diagram: string;
}

export type ChatVisualPayload =
  | ChatTimelineVisualPayload
  | ChatArchitectureVisualPayload
  | ChatMermaidVisualPayload;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isNumberOrNull(value: unknown): value is number | null {
  return value === null || typeof value === "number";
}

export function isChatVisualLanguage(value: string): value is ChatVisualKind {
  return (
    value === "kontext-timeline" ||
    value === "kontext-architecture" ||
    value === "mermaid"
  );
}

export function isChatTimelineVisualPayload(
  value: unknown
): value is ChatTimelineVisualPayload {
  if (!isRecord(value)) return false;
  if (value.kind !== "kontext-timeline") return false;
  if (!isString(value.title) || !isString(value.summary)) return false;
  if (!Array.isArray(value.events) || value.events.length === 0) return false;

  return value.events.every((event) => {
    if (!isRecord(event)) return false;
    return (
      isString(event.sha) &&
      isString(event.date) &&
      isString(event.committedAt) &&
      isString(event.summary) &&
      isString(event.message) &&
      isString(event.author) &&
      isNumberOrNull(event.similarity) &&
      typeof event.matched === "boolean"
    );
  });
}

export function isChatArchitectureVisualPayload(
  value: unknown
): value is ChatArchitectureVisualPayload {
  if (!isRecord(value)) return false;
  if (value.kind !== "kontext-architecture") return false;
  if (
    !isString(value.title) ||
    !isString(value.summary) ||
    !isString(value.layerId)
  ) {
    return false;
  }
  if (value.traceLabel !== null && !isString(value.traceLabel)) return false;
  if (!Array.isArray(value.pathNodeIds) || !value.pathNodeIds.every(isString)) {
    return false;
  }
  if (!Array.isArray(value.nodes) || !Array.isArray(value.edges)) return false;

  const validNodeTypes = new Set<ArchComponentType>([
    "page",
    "api",
    "service",
    "worker",
    "database",
    "config",
    "shared",
    "external",
  ]);
  const validEdgeTypes = new Set<ArchConnectionType>([
    "api_call",
    "import",
    "webhook",
    "database_query",
    "auth",
    "event",
  ]);

  return (
    value.nodes.every((node) => {
      if (!isRecord(node)) return false;
      return (
        isString(node.id) &&
        isString(node.label) &&
        isString(node.description) &&
        typeof node.highlighted === "boolean" &&
        typeof node.type === "string" &&
        validNodeTypes.has(node.type as ArchComponentType)
      );
    }) &&
    value.edges.every((edge) => {
      if (!isRecord(edge)) return false;
      return (
        isString(edge.id) &&
        isString(edge.source) &&
        isString(edge.target) &&
        isString(edge.label) &&
        isString(edge.description) &&
        typeof edge.highlighted === "boolean" &&
        typeof edge.type === "string" &&
        validEdgeTypes.has(edge.type as ArchConnectionType)
      );
    })
  );
}

export function isChatMermaidVisualPayload(
  value: unknown
): value is ChatMermaidVisualPayload {
  if (!isRecord(value)) return false;
  return (
    value.kind === "mermaid" &&
    isString(value.title) &&
    isString(value.description) &&
    isString(value.diagram)
  );
}

export function parseChatVisualPayload(
  raw: string,
  language: ChatVisualKind
): ChatVisualPayload | null {
  try {
    const parsed = JSON.parse(raw) as unknown;

    if (
      language === "kontext-timeline" &&
      isChatTimelineVisualPayload(parsed)
    ) {
      return parsed;
    }

    if (
      language === "kontext-architecture" &&
      isChatArchitectureVisualPayload(parsed)
    ) {
      return parsed;
    }

    if (language === "mermaid" && isChatMermaidVisualPayload(parsed)) {
      return parsed;
    }

    return null;
  } catch {
    return null;
  }
}
