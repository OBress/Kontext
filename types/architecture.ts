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
