import { createAdminClient } from "./auth";
import { analyzeArchitecture } from "./architecture-analyzer";
import type {
  ArchComponent,
  ArchConnection,
  ArchitectureAnalysis,
  ArchitectureBundle,
  ArchitectureEdgeIndexEntry,
  ArchitectureLayerId,
  ArchitectureNodeIndexEntry,
  ArchitectureStatus,
  ArchitectureTrace,
  ArchitectureView,
} from "@/types/architecture";

interface FileMetadata {
  file_path: string;
  file_name: string;
  extension: string | null;
  line_count: number | null;
  imports: string[] | null;
}

interface ChunkSample {
  file_path: string;
  content: string;
}

function getFileImportance(filePath: string, lineCount: number | null): number {
  let score = 0;
  const lower = filePath.toLowerCase();

  if (lower.includes("/route.")) score += 100;
  if (lower.includes("/page.")) score += 90;
  if (lower.includes("/layout.")) score += 80;
  if (lower.includes("config") || lower.includes("middleware")) score += 70;
  if (lower.includes("/api/")) score += 60;
  if (lower.includes("/lib/")) score += 50;

  score += Math.min((lineCount || 0) / 10, 30);

  if (lower.includes("test") || lower.includes("spec")) score -= 50;
  if (lower.includes(".d.ts")) score -= 40;
  if (lower.includes("node_modules")) score -= 200;

  return score;
}

function dedupeStrings(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function collectAliases(component: ArchComponent): string[] {
  const aliases = new Set<string>();
  aliases.add(component.label.toLowerCase());
  aliases.add(component.id.toLowerCase());

  for (const token of component.label.toLowerCase().split(/[^a-z0-9]+/)) {
    if (token.length > 2) {
      aliases.add(token);
    }
  }

  for (const file of component.files) {
    aliases.add(file.toLowerCase());
    aliases.add(file.split("/").pop()?.toLowerCase() || "");
  }

  return [...aliases].filter(Boolean);
}

function overviewBucketFor(component: ArchComponent): {
  id: string;
  label: string;
  description: string;
  type: ArchComponent["type"];
} {
  const text = `${component.label} ${component.description} ${component.files.join(" ")}`.toLowerCase();

  if (component.type === "page") {
    return {
      id: "experience-layer",
      label: "Experience Layer",
      description: "User-facing pages and interactive surfaces.",
      type: "page",
    };
  }

  if (
    component.type === "worker" ||
    /(ingest|sync|timeline|webhook|pipeline|embedding|chunk)/.test(text)
  ) {
    return {
      id: "automation-pipelines",
      label: "Automation Pipelines",
      description: "Background indexing, sync, webhook, and timeline processing flows.",
      type: "worker",
    };
  }

  if (
    component.type === "database" ||
    /(supabase|database|schema|cache|storage|repo_chunks|repo_files)/.test(text)
  ) {
    return {
      id: "knowledge-store",
      label: "Knowledge Store",
      description: "Structured storage, cached analysis, and retrieval-oriented data layers.",
      type: "database",
    };
  }

  if (component.type === "config" || component.type === "external") {
    return {
      id: "platform-services",
      label: "Platform Services",
      description: "Configuration, external services, and platform integration points.",
      type: component.type,
    };
  }

  return {
    id: "application-services",
    label: "Application Services",
    description: "API routes, orchestration logic, and shared service modules.",
    type: component.type === "shared" ? "service" : component.type,
  };
}

function buildOverviewView(base: ArchitectureAnalysis): ArchitectureView {
  const bucketMap = new Map<
    string,
    {
      component: ArchComponent;
      sourceIds: Set<string>;
    }
  >();

  for (const component of base.components) {
    const bucket = overviewBucketFor(component);
    const existing = bucketMap.get(bucket.id);

    if (!existing) {
      bucketMap.set(bucket.id, {
        component: {
          id: bucket.id,
          label: bucket.label,
          description: bucket.description,
          type: bucket.type,
          files: dedupeStrings([
            ...component.files,
            ...(component.children?.flatMap((child) => child.files) || []),
          ]),
        },
        sourceIds: new Set([component.id]),
      });
      continue;
    }

    existing.sourceIds.add(component.id);
    existing.component.files = dedupeStrings([
      ...existing.component.files,
      ...component.files,
      ...(component.children?.flatMap((child) => child.files) || []),
    ]);
  }

  const bucketEntries = [...bucketMap.values()];
  const sourceToBucket = new Map<string, string>();
  for (const entry of bucketEntries) {
    for (const sourceId of entry.sourceIds) {
      sourceToBucket.set(sourceId, entry.component.id);
    }
  }

  const edgeMap = new Map<string, ArchConnection>();
  for (const connection of base.connections) {
    const sourceBucket = sourceToBucket.get(connection.source);
    const targetBucket = sourceToBucket.get(connection.target);

    if (!sourceBucket || !targetBucket || sourceBucket === targetBucket) continue;

    const id = `${sourceBucket}-to-${targetBucket}`;
    const existing = edgeMap.get(id);
    if (existing) continue;

    edgeMap.set(id, {
      id,
      source: sourceBucket,
      target: targetBucket,
      label: connection.label,
      description: connection.description,
      type: connection.type,
    });
  }

  return {
    id: "overview",
    label: "Overview",
    summary: base.summary,
    components: bucketEntries.map((entry) => entry.component),
    connections: [...edgeMap.values()],
    defaultExpanded: [],
  };
}

function buildCodeView(base: ArchitectureAnalysis): ArchitectureView {
  return {
    id: "code",
    label: "Code",
    summary: base.summary,
    components: base.components,
    connections: base.connections,
    defaultExpanded: base.components
      .filter((component) => component.children && component.children.length > 0)
      .map((component) => component.id),
  };
}

function buildSystemView(base: ArchitectureAnalysis): ArchitectureView {
  return {
    id: "system",
    label: "System",
    summary: base.summary,
    components: base.components,
    connections: base.connections,
    defaultExpanded: [],
  };
}

function addNodeIndexEntry(
  nodeIndex: Record<string, ArchitectureNodeIndexEntry>,
  component: ArchComponent,
  layerId: ArchitectureLayerId,
  parentId?: string | null
) {
  const existing = nodeIndex[component.id];
  if (existing) {
    existing.layers = dedupeStrings([...existing.layers, layerId]) as ArchitectureLayerId[];
    existing.files = dedupeStrings([...existing.files, ...component.files]);
    existing.aliases = dedupeStrings([...existing.aliases, ...collectAliases(component)]);
    return;
  }

  nodeIndex[component.id] = {
    id: component.id,
    label: component.label,
    description: component.description,
    type: component.type,
    files: component.files,
    aliases: collectAliases(component),
    layers: [layerId],
    parentId: parentId || null,
  };
}

function addEdgeIndexEntry(
  edgeIndex: Record<string, ArchitectureEdgeIndexEntry>,
  connection: ArchConnection,
  layerId: ArchitectureLayerId
) {
  const existing = edgeIndex[connection.id];
  if (existing) {
    existing.layers = dedupeStrings([...existing.layers, layerId]) as ArchitectureLayerId[];
    return;
  }

  edgeIndex[connection.id] = {
    id: connection.id,
    source: connection.source,
    target: connection.target,
    label: connection.label,
    description: connection.description,
    type: connection.type,
    layers: [layerId],
  };
}

function buildTraces(views: Record<ArchitectureLayerId, ArchitectureView>): ArchitectureTrace[] {
  const traces = new Map<string, ArchitectureTrace>();

  for (const [layerId, view] of Object.entries(views) as Array<
    [ArchitectureLayerId, ArchitectureView]
  >) {
    for (const connection of view.connections) {
      const sourceLabel =
        view.components.find((component) => component.id === connection.source)?.label ||
        connection.source;
      const targetLabel =
        view.components.find((component) => component.id === connection.target)?.label ||
        connection.target;

      const traceId = `${layerId}:${connection.id}`;
      traces.set(traceId, {
        id: traceId,
        label: `${sourceLabel} to ${targetLabel}`,
        description: connection.description,
        layerId,
        nodeIds: [connection.source, connection.target],
        edgeIds: [connection.id],
        aliases: dedupeStrings([
          connection.label.toLowerCase(),
          connection.description.toLowerCase(),
          sourceLabel.toLowerCase(),
          targetLabel.toLowerCase(),
          `${sourceLabel.toLowerCase()} ${targetLabel.toLowerCase()}`,
        ]),
      });
    }
  }

  return [...traces.values()];
}

export function buildArchitectureBundle(
  analysis: ArchitectureAnalysis,
  sourceSha: string | null
): ArchitectureBundle {
  const system = buildSystemView(analysis);
  const overview = buildOverviewView(analysis);
  const code = buildCodeView(analysis);
  const views = { overview, system, code };

  const nodeIndex: Record<string, ArchitectureNodeIndexEntry> = {};
  const edgeIndex: Record<string, ArchitectureEdgeIndexEntry> = {};

  for (const [layerId, view] of Object.entries(views) as Array<
    [ArchitectureLayerId, ArchitectureView]
  >) {
    for (const component of view.components) {
      addNodeIndexEntry(nodeIndex, component, layerId);
      for (const child of component.children || []) {
        addNodeIndexEntry(nodeIndex, child, layerId, component.id);
      }
    }

    for (const connection of view.connections) {
      addEdgeIndexEntry(edgeIndex, connection, layerId);
    }
  }

  const aliases: Record<string, string[]> = {};
  for (const [id, entry] of Object.entries(nodeIndex)) {
    aliases[id] = entry.aliases;
  }

  return {
    schemaVersion: 2,
    summary: analysis.summary,
    generatedAt: new Date().toISOString(),
    sourceSha,
    views,
    nodeIndex,
    edgeIndex,
    aliases,
    traces: buildTraces(views),
  };
}

export async function loadArchitectureInputs(params: {
  userId: string;
  repoFullName: string;
}) {
  const { userId, repoFullName } = params;
  const adminDb = await createAdminClient();

  const { data: repo } = await adminDb
    .from("repos")
    .select("last_synced_sha")
    .eq("user_id", userId)
    .eq("full_name", repoFullName)
    .single();

  const { data: files, error: filesError } = await adminDb
    .from("repo_files")
    .select("file_path, file_name, extension, line_count, imports")
    .eq("user_id", userId)
    .eq("repo_full_name", repoFullName);

  if (filesError) throw filesError;

  const sortedFiles = (files || []).sort(
    (a, b) => getFileImportance(b.file_path, b.line_count) - getFileImportance(a.file_path, a.line_count)
  );

  const priorityFiles = sortedFiles.slice(0, 40).map((file) => file.file_path);

  const { data: chunks } = await adminDb
    .from("repo_chunks")
    .select("file_path, content")
    .eq("user_id", userId)
    .eq("repo_full_name", repoFullName)
    .eq("chunk_index", 0)
    .in("file_path", priorityFiles);

  return {
    sourceSha: repo?.last_synced_sha || null,
    files: (files || []) as FileMetadata[],
    chunkSamples: ((chunks || []) as ChunkSample[]).map((chunk) => ({
      file_path: chunk.file_path,
      content: chunk.content,
    })),
  };
}

export async function refreshArchitectureBundle(params: {
  userId: string;
  repoFullName: string;
  apiKey: string;
  sourceSha?: string | null;
}): Promise<ArchitectureBundle> {
  const { userId, repoFullName, apiKey } = params;
  const adminDb = await createAdminClient();

  await adminDb
    .from("repos")
    .update({
      architecture_status: "analyzing" satisfies ArchitectureStatus,
      architecture_error: null,
    })
    .eq("user_id", userId)
    .eq("full_name", repoFullName);

  const { files, chunkSamples, sourceSha } = await loadArchitectureInputs({
    userId,
    repoFullName,
  });

  if (files.length === 0) {
    await adminDb
      .from("repos")
      .update({
        architecture_status: "missing" satisfies ArchitectureStatus,
        architecture_error: "No indexed files available for architecture generation.",
      })
      .eq("user_id", userId)
      .eq("full_name", repoFullName);

    throw new Error("No indexed files available for architecture generation.");
  }

  const analysis = await analyzeArchitecture(
    apiKey,
    repoFullName,
    files.map((file) => ({
      file_path: file.file_path,
      file_name: file.file_name,
      extension: file.extension,
      line_count: file.line_count || 0,
      imports: file.imports || [],
    })),
    chunkSamples
  );

  const bundle = buildArchitectureBundle(
    analysis,
    params.sourceSha !== undefined ? params.sourceSha : sourceSha
  );

  await adminDb
    .from("repos")
    .update({
      architecture_analysis: bundle,
      architecture_analyzed_at: bundle.generatedAt,
      architecture_status: "ready" satisfies ArchitectureStatus,
      architecture_for_sha: bundle.sourceSha,
      architecture_error: null,
    })
    .eq("user_id", userId)
    .eq("full_name", repoFullName);

  return bundle;
}

export async function markArchitectureStale(params: {
  userId: string;
  repoFullName: string;
  reason?: string | null;
}) {
  const adminDb = await createAdminClient();
  await adminDb
    .from("repos")
    .update({
      architecture_status: "stale" satisfies ArchitectureStatus,
      architecture_error: params.reason || null,
    })
    .eq("user_id", params.userId)
    .eq("full_name", params.repoFullName);
}

export async function queueArchitectureRefresh(params: {
  userId: string;
  repoFullName: string;
  apiKey: string | null;
  sourceSha?: string | null;
}) {
  const adminDb = await createAdminClient();

  if (!params.apiKey) {
    await adminDb
      .from("repos")
      .update({
        architecture_status: "stale" satisfies ArchitectureStatus,
        architecture_error: "Architecture refresh is waiting for a stored Google AI key.",
      })
      .eq("user_id", params.userId)
      .eq("full_name", params.repoFullName);
    return;
  }

  await adminDb
    .from("repos")
    .update({
      architecture_status: "queued" satisfies ArchitectureStatus,
      architecture_error: null,
    })
    .eq("user_id", params.userId)
    .eq("full_name", params.repoFullName);

  void refreshArchitectureBundle({
    userId: params.userId,
    repoFullName: params.repoFullName,
    apiKey: params.apiKey,
    sourceSha: params.sourceSha,
  }).catch(async (error) => {
    console.error("[architecture] Background refresh failed:", error);
    await adminDb
      .from("repos")
      .update({
        architecture_status: "error" satisfies ArchitectureStatus,
        architecture_error:
          error instanceof Error ? error.message : "Architecture refresh failed.",
      })
      .eq("user_id", params.userId)
      .eq("full_name", params.repoFullName);
  });
}
