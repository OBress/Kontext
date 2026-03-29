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
  steps: ArchitectureTraceStep[];
}

export interface ArchitectureTraceStep {
  id: string;
  kind: "node" | "edge";
  refId: string;
  label: string;
  description: string;
}

export interface ArchitectureCodeMetadata {
  sharedGroupId?: string | null;
  moduleFileOwners: Record<string, string[]>;
  fileOwners: Record<string, string[]>;
  sharedFiles: string[];
}

export interface ArchitectureBundle {
  schemaVersion: 3;
  summary: string;
  generatedAt: string;
  sourceSha: string | null;
  views: Record<ArchitectureLayerId, ArchitectureView>;
  nodeIndex: Record<string, ArchitectureNodeIndexEntry>;
  edgeIndex: Record<string, ArchitectureEdgeIndexEntry>;
  aliases: Record<string, string[]>;
  traces: ArchitectureTrace[];
  codeMetadata?: ArchitectureCodeMetadata;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function getArchitectureSchemaVersion(value: unknown): number | null {
  if (!isRecord(value)) return null;
  return typeof value.schemaVersion === "number" ? value.schemaVersion : null;
}

export function isArchitectureBundle(value: unknown): value is ArchitectureBundle {
  return getArchitectureSchemaVersion(value) === 3 && isRecord(value) && !!value.views;
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
  value: ArchitectureAnalysis | ArchitectureBundle | null | undefined
): ArchitectureBundle | null {
  if (!value) return null;
  if (isArchitectureBundle(value)) return value;
  return null;
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
