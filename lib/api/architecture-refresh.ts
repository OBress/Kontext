import { createAdminClient } from "./auth";
import { analyzeArchitecture } from "./architecture-analyzer";
import { resolveImport } from "./graph-builder";
import { enqueueAiTask } from "./sync-queue";
import type {
  ArchComponent,
  ArchConnection,
  ArchitectureAnalysis,
  ArchitectureBundle,
  ArchitectureCodeMetadata,
  ArchitectureEdgeIndexEntry,
  ArchitectureLayerId,
  ArchitectureNodeIndexEntry,
  ArchitectureStatus,
  ArchitectureTrace,
  ArchitectureTraceStep,
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

interface ResolvedFileGraph {
  filesByPath: Map<string, FileMetadata>;
  importsBySource: Map<string, string[]>;
  importersByTarget: Map<string, string[]>;
  directoryFiles: Map<string, string[]>;
}

interface ModuleCandidateSet {
  module: ArchComponent;
  scores: Map<string, number>;
}

const MAX_VISIBLE_CODE_FILES = 10;
const MAX_SHARED_VISIBLE_FILES = 10;
const SHARED_GROUP_ID = "code-cross-cutting-shared";

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
    if (edgeMap.has(id)) continue;

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

function pathDirectory(filePath: string): string {
  return filePath.split("/").slice(0, -1).join("/");
}

function classifyFileType(filePath: string, fallbackType: ArchComponent["type"]): ArchComponent["type"] {
  const lower = filePath.toLowerCase();

  if (/\/page\.[a-z0-9]+$/.test(lower)) return "page";
  if (lower.includes("/api/") || /\/route\.[a-z0-9]+$/.test(lower)) return "api";
  if (/(schema|migration|supabase|database|repo_chunks|repo_files|sql)/.test(lower)) {
    return "database";
  }
  if (/(worker|queue|pipeline|ingest|sync|timeline|webhook|embedding|chunk)/.test(lower)) {
    return "worker";
  }
  if (
    /(middleware|config|next\.config|tsconfig|eslint|postcss|package\.json|toml|\.env)/.test(lower)
  ) {
    return "config";
  }

  return fallbackType === "external" ? "shared" : fallbackType;
}

function formatFileLabel(filePath: string): string {
  const parts = filePath.split("/");
  const fileName = parts[parts.length - 1] || filePath;
  const parent = parts.length > 1 ? parts[parts.length - 2] : "";
  if (
    parent &&
    ["page.tsx", "page.ts", "route.ts", "route.js", "layout.tsx", "layout.ts", "index.ts", "index.tsx", "index.js"].includes(fileName)
  ) {
    return `${parent}/${fileName}`;
  }
  return parent ? `${parent}/${fileName}` : fileName;
}

function buildResolvedFileGraph(files: FileMetadata[]): ResolvedFileGraph {
  const filesByPath = new Map(files.map((file) => [file.file_path, file]));
  const pathSet = new Set(files.map((file) => file.file_path));
  const importsBySource = new Map<string, string[]>();
  const importersByTarget = new Map<string, string[]>();
  const directoryFiles = new Map<string, string[]>();

  for (const file of files) {
    const directory = pathDirectory(file.file_path);
    directoryFiles.set(directory, [...(directoryFiles.get(directory) || []), file.file_path]);
  }

  for (const file of files) {
    const resolvedImports = dedupeStrings(
      (file.imports || [])
        .map((entry) => resolveImport(entry, file.file_path, pathSet))
        .filter((entry): entry is string => Boolean(entry))
    );

    importsBySource.set(file.file_path, resolvedImports);

    for (const targetPath of resolvedImports) {
      importersByTarget.set(targetPath, [
        ...(importersByTarget.get(targetPath) || []),
        file.file_path,
      ]);
    }
  }

  return {
    filesByPath,
    importsBySource,
    importersByTarget,
    directoryFiles,
  };
}

function addScore(scoreMap: Map<string, number>, filePath: string, delta: number) {
  scoreMap.set(filePath, (scoreMap.get(filePath) || 0) + delta);
}

function buildModuleCandidateSets(
  systemView: ArchitectureView,
  fileGraph: ResolvedFileGraph
): ModuleCandidateSet[] {
  return systemView.components.map((component) => {
    const seedFiles = dedupeStrings([
      ...component.files,
      ...(component.children?.flatMap((child) => child.files) || []),
    ]).filter((filePath) => fileGraph.filesByPath.has(filePath));

    const scores = new Map<string, number>();

    for (const seedFile of seedFiles) {
      addScore(scores, seedFile, 120);

      for (const targetPath of fileGraph.importsBySource.get(seedFile) || []) {
        addScore(scores, targetPath, 70);
      }

      for (const sourcePath of fileGraph.importersByTarget.get(seedFile) || []) {
        addScore(scores, sourcePath, 60);
      }

      for (const siblingPath of fileGraph.directoryFiles.get(pathDirectory(seedFile)) || []) {
        if (siblingPath !== seedFile) {
          addScore(scores, siblingPath, 26);
        }
      }
    }

    for (const [filePath, score] of scores) {
      const file = fileGraph.filesByPath.get(filePath);
      scores.set(filePath, score + Math.max(0, getFileImportance(filePath, file?.line_count || 0) / 4));
    }

    return { module: component, scores };
  });
}

function sortScoredFiles(
  scores: Map<string, number>,
  fileGraph: ResolvedFileGraph
): string[] {
  return [...scores.entries()]
    .sort((a, b) => {
      if (b[1] !== a[1]) return b[1] - a[1];
      const aImportance = getFileImportance(a[0], fileGraph.filesByPath.get(a[0])?.line_count || 0);
      const bImportance = getFileImportance(b[0], fileGraph.filesByPath.get(b[0])?.line_count || 0);
      if (bImportance !== aImportance) return bImportance - aImportance;
      return a[0].localeCompare(b[0]);
    })
    .map(([filePath]) => filePath);
}

function buildFileChild(
  filePath: string,
  parentType: ArchComponent["type"],
  parentLabel: string
): ArchComponent {
  return {
    id: `file:${filePath}`,
    label: formatFileLabel(filePath),
    description: `${filePath} participates in ${parentLabel.toLowerCase()}.`,
    type: classifyFileType(filePath, parentType),
    files: [filePath],
  };
}

function buildCodeView(
  systemView: ArchitectureView,
  files: FileMetadata[]
): { view: ArchitectureView; metadata: ArchitectureCodeMetadata } {
  const fileGraph = buildResolvedFileGraph(files);
  const moduleCandidates = buildModuleCandidateSets(systemView, fileGraph);
  const fileOwners = new Map<string, string[]>();

  for (const entry of moduleCandidates) {
    const sortedPaths = sortScoredFiles(entry.scores, fileGraph);
    for (const filePath of sortedPaths) {
      fileOwners.set(filePath, [...(fileOwners.get(filePath) || []), entry.module.id]);
    }
  }

  const sharedFiles = [...fileOwners.entries()]
    .filter(([, owners]) => owners.length >= 2)
    .map(([filePath]) => filePath);
  const sharedFileSet = new Set(sharedFiles);

  const parentByFile = new Map<string, string>();
  const moduleFileOwners: Record<string, string[]> = {};
  const connectivity = new Map<string, number>();

  const components: ArchComponent[] = moduleCandidates.map((entry) => {
    const sortedPaths = sortScoredFiles(entry.scores, fileGraph);
    const ownedPaths = sortedPaths.filter((filePath) => !sharedFileSet.has(filePath));
    const visibleChildren = ownedPaths
      .slice(0, MAX_VISIBLE_CODE_FILES)
      .map((filePath) => buildFileChild(filePath, entry.module.type, entry.module.label));

    for (const filePath of ownedPaths) {
      parentByFile.set(filePath, entry.module.id);
    }

    moduleFileOwners[entry.module.id] = ownedPaths;

    return {
      id: entry.module.id,
      label: entry.module.label,
      description: entry.module.description,
      type: entry.module.type,
      files: ownedPaths,
      children: visibleChildren.length > 0 ? visibleChildren : undefined,
    };
  });

  const visibleFileNodeIds = new Map<string, string>();
  for (const component of components) {
    for (const child of component.children || []) {
      const filePath = child.files[0];
      if (filePath) {
        visibleFileNodeIds.set(filePath, child.id);
      }
    }
  }

  let sharedGroupId: string | null = null;
  if (sharedFiles.length > 0) {
    sharedGroupId = SHARED_GROUP_ID;
    for (const filePath of sharedFiles) {
      parentByFile.set(filePath, SHARED_GROUP_ID);
    }

    const visibleSharedChildren = sharedFiles
      .sort((a, b) => {
        const ownerDelta = (fileOwners.get(b)?.length || 0) - (fileOwners.get(a)?.length || 0);
        if (ownerDelta !== 0) return ownerDelta;
        return a.localeCompare(b);
      })
      .slice(0, MAX_SHARED_VISIBLE_FILES)
      .map((filePath) => buildFileChild(filePath, "shared", "Cross-cutting shared files"));

    for (const child of visibleSharedChildren) {
      const filePath = child.files[0];
      if (filePath) {
        visibleFileNodeIds.set(filePath, child.id);
      }
    }

    components.push({
      id: SHARED_GROUP_ID,
      label: "Cross-Cutting Shared Files",
      description:
        "Highly shared internal files that participate in multiple code modules and would otherwise be duplicated.",
      type: "shared",
      files: sharedFiles,
      children: visibleSharedChildren.length > 0 ? visibleSharedChildren : undefined,
    });
  }

  const connections: ArchConnection[] = [];
  const moduleEdgeCounts = new Map<string, number>();

  for (const [sourcePath, targetPaths] of fileGraph.importsBySource.entries()) {
    const sourceParent = parentByFile.get(sourcePath);

    for (const targetPath of targetPaths) {
      const targetParent = parentByFile.get(targetPath);
      if (!sourceParent || !targetParent) continue;

      connectivity.set(sourceParent, (connectivity.get(sourceParent) || 0) + 1);
      if (targetParent !== sourceParent) {
        connectivity.set(targetParent, (connectivity.get(targetParent) || 0) + 1);
      }

      if (sourceParent === targetParent) {
        // Keep internal traffic visible in the connectivity score above without adding a module edge.
      } else {
        const moduleEdgeKey = `${sourceParent}::${targetParent}`;
        moduleEdgeCounts.set(moduleEdgeKey, (moduleEdgeCounts.get(moduleEdgeKey) || 0) + 1);
      }

      const sourceNodeId = visibleFileNodeIds.get(sourcePath);
      const targetNodeId = visibleFileNodeIds.get(targetPath);

      if (!sourceNodeId || !targetNodeId) continue;

      connections.push({
        id: `code:${sourceNodeId}->${targetNodeId}`,
        source: sourceNodeId,
        target: targetNodeId,
        label: "imports",
        description: `${sourcePath} imports ${targetPath}.`,
        type: "import",
      });
    }
  }

  for (const [key, count] of moduleEdgeCounts.entries()) {
    const [source, target] = key.split("::");
    connections.push({
      id: `code-module:${source}->${target}`,
      source,
      target,
      label: count === 1 ? "cross-module import" : `${count} cross-module imports`,
      description:
        count === 1
          ? "One visible file import crosses this module boundary."
          : `${count} internal file imports cross this module boundary.`,
      type: "import",
    });
  }

  const defaultExpanded = components
    .filter((component) => component.id !== SHARED_GROUP_ID && (component.children?.length || 0) > 0)
    .sort((a, b) => (connectivity.get(b.id) || 0) - (connectivity.get(a.id) || 0))
    .slice(0, 4)
    .map((component) => component.id);

  return {
    view: {
      id: "code",
      label: "Code",
      summary: `${systemView.summary} The code layer adds file-level ownership and resolved internal import edges.`,
      components,
      connections,
      defaultExpanded,
    },
    metadata: {
      sharedGroupId,
      moduleFileOwners,
      fileOwners: Object.fromEntries(fileOwners.entries()),
      sharedFiles,
    },
  };
}

function buildComponentLookup(view: ArchitectureView): Map<string, ArchComponent> {
  const lookup = new Map<string, ArchComponent>();

  for (const component of view.components) {
    lookup.set(component.id, component);
    for (const child of component.children || []) {
      lookup.set(child.id, child);
    }
  }

  return lookup;
}

function buildTraceSteps(
  sourceLabel: string,
  targetLabel: string,
  connection: ArchConnection
): ArchitectureTraceStep[] {
  return [
    {
      id: `${connection.id}:source`,
      kind: "node",
      refId: connection.source,
      label: sourceLabel,
      description: `Start at ${sourceLabel}.`,
    },
    {
      id: `${connection.id}:edge`,
      kind: "edge",
      refId: connection.id,
      label: connection.label,
      description: connection.description,
    },
    {
      id: `${connection.id}:target`,
      kind: "node",
      refId: connection.target,
      label: targetLabel,
      description: `Arrive at ${targetLabel}.`,
    },
  ];
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
    const componentLookup = buildComponentLookup(view);

    for (const connection of view.connections) {
      const sourceLabel = componentLookup.get(connection.source)?.label || connection.source;
      const targetLabel = componentLookup.get(connection.target)?.label || connection.target;
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
        steps: buildTraceSteps(sourceLabel, targetLabel, connection),
      });
    }
  }

  return [...traces.values()];
}

export function buildArchitectureBundle(
  analysis: ArchitectureAnalysis,
  sourceSha: string | null,
  files: FileMetadata[]
): ArchitectureBundle {
  const system = buildSystemView(analysis);
  const overview = buildOverviewView(analysis);
  const { view: code, metadata: codeMetadata } = buildCodeView(system, files);
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
    schemaVersion: 3,
    summary: analysis.summary,
    generatedAt: new Date().toISOString(),
    sourceSha,
    views,
    nodeIndex,
    edgeIndex,
    aliases,
    traces: buildTraces(views),
    codeMetadata,
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
    (a, b) =>
      getFileImportance(b.file_path, b.line_count) - getFileImportance(a.file_path, a.line_count)
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

export function buildArchitectureRefreshTaskId(
  repoFullName: string,
  sourceSha?: string | null
) {
  return `arch-refresh:${repoFullName}:${sourceSha || "latest"}`;
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
    params.sourceSha !== undefined ? params.sourceSha : sourceSha,
    files
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

  const apiKey = params.apiKey;

  await adminDb
    .from("repos")
    .update({
      architecture_status: "queued" satisfies ArchitectureStatus,
      architecture_error: null,
    })
    .eq("user_id", params.userId)
    .eq("full_name", params.repoFullName);

  return enqueueAiTask({
    userId: params.userId,
    repoFullName: params.repoFullName,
    taskId: buildArchitectureRefreshTaskId(params.repoFullName, params.sourceSha),
    execute: async () => {
      try {
        await refreshArchitectureBundle({
          userId: params.userId,
          repoFullName: params.repoFullName,
          apiKey,
          sourceSha: params.sourceSha,
        });
      } catch (error) {
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

        throw error;
      }
    },
  });
}
