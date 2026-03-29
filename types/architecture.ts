/**
 * Shared types for the AI-powered architecture analysis system.
 */

export interface ArchComponent {
  id: string;
  label: string;
  description: string;
  type: ArchComponentType;
  files: string[];
  children?: ArchComponent[];
}

export type ArchComponentType =
  | "page"
  | "api"
  | "service"
  | "worker"
  | "database"
  | "config"
  | "shared"
  | "external";

export interface ArchConnection {
  id: string;
  source: string;
  target: string;
  label: string;
  description: string;
  type: ArchConnectionType;
}

export type ArchConnectionType =
  | "api_call"
  | "import"
  | "webhook"
  | "database_query"
  | "auth"
  | "event";

export interface ArchitectureAnalysis {
  summary: string;
  components: ArchComponent[];
  connections: ArchConnection[];
  unassignedFiles?: string[];
}

export type ArchitectureLayerId = "overview" | "system" | "code";

export type ArchitectureStatus =
  | "missing"
  | "queued"
  | "analyzing"
  | "ready"
  | "stale"
  | "error";

export interface ArchitectureView extends ArchitectureAnalysis {
  id: ArchitectureLayerId;
  label: string;
  defaultExpanded?: string[];
}

export interface ArchitectureNodeIndexEntry {
  id: string;
  label: string;
  description: string;
  type: ArchComponentType;
  files: string[];
  aliases: string[];
  layers: ArchitectureLayerId[];
  parentId?: string | null;
}

export interface ArchitectureEdgeIndexEntry {
  id: string;
  source: string;
  target: string;
  label: string;
  description: string;
  type: ArchConnectionType;
  layers: ArchitectureLayerId[];
}

export interface ArchitectureTrace {
  id: string;
  label: string;
  description: string;
  layerId: ArchitectureLayerId;
  nodeIds: string[];
  edgeIds: string[];
  aliases?: string[];
}

export interface ArchitectureBundle {
  schemaVersion: 2;
  summary: string;
  generatedAt: string;
  sourceSha: string | null;
  views: Record<ArchitectureLayerId, ArchitectureView>;
  nodeIndex: Record<string, ArchitectureNodeIndexEntry>;
  edgeIndex: Record<string, ArchitectureEdgeIndexEntry>;
  aliases: Record<string, string[]>;
  traces: ArchitectureTrace[];
}

export function isArchitectureBundle(value: unknown): value is ArchitectureBundle {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return record.schemaVersion === 2 && !!record.views;
}

export function getArchitectureView(
  value: ArchitectureAnalysis | ArchitectureBundle | null | undefined,
  layer: ArchitectureLayerId = "system"
): ArchitectureView | null {
  if (!value) return null;
  if (isArchitectureBundle(value)) {
    return value.views[layer] || value.views.system || null;
  }

  return {
    ...value,
    id: "system",
    label: "System",
    defaultExpanded: [],
  };
}

export function toArchitectureBundle(
  value: ArchitectureAnalysis | ArchitectureBundle | null | undefined,
  sourceSha: string | null = null,
  generatedAt?: string | null
): ArchitectureBundle | null {
  if (!value) return null;
  if (isArchitectureBundle(value)) return value;

  const baseView: ArchitectureView = {
    ...value,
    id: "system",
    label: "System",
    defaultExpanded: [],
  };

  return {
    schemaVersion: 2,
    summary: value.summary,
    generatedAt: generatedAt || new Date().toISOString(),
    sourceSha,
    views: {
      overview: {
        ...baseView,
        id: "overview",
        label: "Overview",
      },
      system: baseView,
      code: {
        ...baseView,
        id: "code",
        label: "Code",
        defaultExpanded: value.components
          .filter((component) => component.children && component.children.length > 0)
          .map((component) => component.id),
      },
    },
    nodeIndex: {},
    edgeIndex: {},
    aliases: {},
    traces: [],
  };
}

export function findArchitectureComponent(
  analysis: ArchitectureAnalysis | ArchitectureView,
  componentId: string
): ArchComponent | null {
  for (const component of analysis.components) {
    if (component.id === componentId) {
      return component;
    }
    const child = component.children?.find((entry) => entry.id === componentId);
    if (child) {
      return child;
    }
  }
  return null;
}

/** Color mapping for component types */
export const ARCH_TYPE_COLORS: Record<ArchComponentType, string> = {
  page: "#3FB950",
  api: "#58A6FF",
  service: "#BC8CFF",
  worker: "#F0883E",
  database: "#FF7B72",
  config: "#FFD600",
  shared: "#8B949E",
  external: "#3FB95060",
};

/** Icon names (Lucide) for component types */
export const ARCH_TYPE_ICONS: Record<ArchComponentType, string> = {
  page: "Globe",
  api: "Server",
  service: "Cog",
  worker: "Zap",
  database: "Database",
  config: "Settings",
  shared: "Package",
  external: "Cloud",
};

/** Human-readable labels for component types */
export const ARCH_TYPE_LABELS: Record<ArchComponentType, string> = {
  page: "Page",
  api: "API",
  service: "Service",
  worker: "Worker",
  database: "Database",
  config: "Config",
  shared: "Shared",
  external: "External",
};

/** Human-readable labels for connection types */
export const ARCH_CONNECTION_LABELS: Record<ArchConnectionType, string> = {
  api_call: "API Call",
  import: "Import",
  webhook: "Webhook",
  database_query: "DB Query",
  auth: "Auth",
  event: "Event",
};
