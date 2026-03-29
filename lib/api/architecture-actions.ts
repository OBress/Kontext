import {
  getArchitectureView,
  type ArchitectureBundle,
  type ArchitectureLayerId,
  type ArchitectureTrace,
  type ArchitectureTraceStep,
} from "@/types/architecture";

export type ArchitectureAssistantAction =
  | {
      type: "switch_layer";
      layerId: ArchitectureLayerId;
    }
  | {
      type: "expand_groups";
      layerId: ArchitectureLayerId;
      groupIds: string[];
    }
  | {
      type: "focus_nodes";
      layerId: ArchitectureLayerId;
      nodeIds: string[];
      edgeIds: string[];
      primaryNodeId: string | null;
      dimOthers: boolean;
    }
  | {
      type: "trace_path";
      layerId: ArchitectureLayerId;
      nodeIds: string[];
      edgeIds: string[];
      traceId: string | null;
    }
  | {
      type: "simulate_flow";
      layerId: ArchitectureLayerId;
      nodeIds: string[];
      edgeIds: string[];
      steps: ArchitectureTraceStep[];
      summary: string;
    };

function tokenize(input: string): string[] {
  return input
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 2);
}

function isFlowQuery(query: string): boolean {
  return /(trace|flow|path|send|where|how does|show|message|request|call chain|interaction)/.test(
    query.toLowerCase()
  );
}

function isSimulationQuery(query: string): boolean {
  return /(simulate|message being sent|show .*message|play back|step by step)/.test(
    query.toLowerCase()
  );
}

function mapFilesToNodeIds(
  bundle: ArchitectureBundle,
  filePaths: string[],
  layerId: ArchitectureLayerId
): Map<string, number> {
  const scores = new Map<string, number>();

  for (const filePath of filePaths) {
    for (const entry of Object.values(bundle.nodeIndex)) {
      if (!entry.layers.includes(layerId)) continue;
      if (!entry.files.some((file) => filePath === file || filePath.endsWith(file))) continue;

      const isExactFileNode = entry.files.length === 1 && entry.files[0] === filePath;
      const baseScore = isExactFileNode ? 12 : entry.parentId ? 5 : 3;
      scores.set(entry.id, (scores.get(entry.id) || 0) + baseScore);
    }
  }

  return scores;
}

function addAliasScores(
  bundle: ArchitectureBundle,
  query: string,
  layerId: ArchitectureLayerId,
  scores: Map<string, number>
) {
  const tokens = tokenize(query);
  const normalizedQuery = query.toLowerCase();

  for (const entry of Object.values(bundle.nodeIndex)) {
    if (!entry.layers.includes(layerId)) continue;

    let score = scores.get(entry.id) || 0;
    for (const alias of entry.aliases) {
      const lowerAlias = alias.toLowerCase();
      if (normalizedQuery.includes(lowerAlias)) {
        score += lowerAlias.includes("/") ? 6 : Math.max(2, lowerAlias.split(" ").length);
      }

      for (const token of tokens) {
        if (lowerAlias.includes(token)) {
          score += 1;
        }
      }
    }

    if (entry.parentId) {
      score += 1;
    }

    if (score > 0) {
      scores.set(entry.id, score);
    }
  }
}

function buildAdjacency(
  bundle: ArchitectureBundle,
  layerId: ArchitectureLayerId
): Map<string, Array<{ nodeId: string; edgeId: string }>> {
  const adjacency = new Map<string, Array<{ nodeId: string; edgeId: string }>>();
  const view = getArchitectureView(bundle, layerId);
  if (!view) return adjacency;

  for (const connection of view.connections) {
    const existing = adjacency.get(connection.source) || [];
    existing.push({ nodeId: connection.target, edgeId: connection.id });
    adjacency.set(connection.source, existing);
  }

  return adjacency;
}

function findShortestPath(
  bundle: ArchitectureBundle,
  layerId: ArchitectureLayerId,
  sourceId: string,
  targetId: string
): { nodeIds: string[]; edgeIds: string[] } | null {
  const adjacency = buildAdjacency(bundle, layerId);
  const queue: Array<{ nodeId: string; nodeIds: string[]; edgeIds: string[] }> = [
    { nodeId: sourceId, nodeIds: [sourceId], edgeIds: [] },
  ];
  const seen = new Set<string>([sourceId]);

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) break;

    if (current.nodeId === targetId) {
      return { nodeIds: current.nodeIds, edgeIds: current.edgeIds };
    }

    for (const next of adjacency.get(current.nodeId) || []) {
      if (seen.has(next.nodeId)) continue;
      seen.add(next.nodeId);
      queue.push({
        nodeId: next.nodeId,
        nodeIds: [...current.nodeIds, next.nodeId],
        edgeIds: [...current.edgeIds, next.edgeId],
      });
    }
  }

  return null;
}

function inferLayerFromQuery(query: string): ArchitectureLayerId | null {
  const lower = query.toLowerCase();
  if (/(overview|big picture|high level)/.test(lower)) return "overview";
  if (
    /(code|file|route|function|source|where is|where does|simulate|message|send|request path|call chain)/.test(
      lower
    )
  ) {
    return "code";
  }
  return null;
}

function chooseTrace(
  bundle: ArchitectureBundle,
  query: string,
  preferredLayer: ArchitectureLayerId
): ArchitectureTrace | null {
  const lower = query.toLowerCase();
  let best: ArchitectureTrace | null = null;
  let bestScore = 0;

  for (const trace of bundle.traces) {
    let score = trace.layerId === preferredLayer ? 3 : 0;

    for (const alias of trace.aliases || []) {
      if (lower.includes(alias.toLowerCase())) {
        score += alias.length > 12 ? 4 : 2;
      }
    }

    if (lower.includes(trace.label.toLowerCase())) {
      score += 6;
    }

    if (score > bestScore) {
      best = trace;
      bestScore = score;
    }
  }

  return bestScore > 0 ? best : null;
}

function hasCodeFileMatches(bundle: ArchitectureBundle, citationFiles: string[]): boolean {
  return citationFiles.some((filePath) =>
    Object.values(bundle.nodeIndex).some(
      (entry) =>
        entry.layers.includes("code") &&
        entry.files.length === 1 &&
        entry.files[0] === filePath
    )
  );
}

function getGroupIdsForNodes(bundle: ArchitectureBundle, nodeIds: string[]): string[] {
  return [...new Set(
    nodeIds
      .map((nodeId) => bundle.nodeIndex[nodeId]?.parentId)
      .filter((value): value is string => Boolean(value))
  )];
}

function buildPlaybackSteps(
  bundle: ArchitectureBundle,
  nodeIds: string[],
  edgeIds: string[]
): ArchitectureTraceStep[] {
  const steps: ArchitectureTraceStep[] = [];

  for (let index = 0; index < nodeIds.length; index += 1) {
    const nodeId = nodeIds[index];
    const node = bundle.nodeIndex[nodeId];
    if (node) {
      steps.push({
        id: `step-node-${index}-${node.id}`,
        kind: "node",
        refId: node.id,
        label: node.label,
        description: node.description,
      });
    }

    const edgeId = edgeIds[index];
    if (edgeId) {
      const edge = bundle.edgeIndex[edgeId];
      if (edge) {
        steps.push({
          id: `step-edge-${index}-${edge.id}`,
          kind: "edge",
          refId: edge.id,
          label: edge.label,
          description: edge.description,
        });
      }
    }
  }

  return steps;
}

function buildSimulationSummary(bundle: ArchitectureBundle, nodeIds: string[]): string {
  const labels = nodeIds
    .map((nodeId) => bundle.nodeIndex[nodeId]?.label || nodeId)
    .filter(Boolean);
  if (labels.length < 2) {
    return "Step through the highlighted architecture focus.";
  }
  return `Simulating flow from ${labels[0]} to ${labels[labels.length - 1]}.`;
}

export function deriveArchitectureActions(params: {
  bundle: ArchitectureBundle | null;
  defaultLayer: ArchitectureLayerId;
  query: string;
  citationFiles: string[];
}): ArchitectureAssistantAction[] {
  const { bundle, defaultLayer, query, citationFiles } = params;
  if (!bundle) return [];

  const actions: ArchitectureAssistantAction[] = [];
  const inferredLayer = inferLayerFromQuery(query);
  const codePreferred =
    isFlowQuery(query) && hasCodeFileMatches(bundle, citationFiles);
  const activeLayer = inferredLayer || (codePreferred ? "code" : defaultLayer);

  if (activeLayer !== defaultLayer) {
    actions.push({
      type: "switch_layer",
      layerId: activeLayer,
    });
  }

  const trace = chooseTrace(bundle, query, activeLayer);
  if (trace) {
    if (trace.layerId === "code") {
      const groupIds = getGroupIdsForNodes(bundle, trace.nodeIds);
      if (groupIds.length > 0) {
        actions.push({
          type: "expand_groups",
          layerId: "code",
          groupIds,
        });
      }
    }

    actions.push({
      type: "focus_nodes",
      layerId: trace.layerId,
      nodeIds: trace.nodeIds,
      edgeIds: trace.edgeIds,
      primaryNodeId: trace.nodeIds[0] || null,
      dimOthers: true,
    });
    actions.push({
      type: "trace_path",
      layerId: trace.layerId,
      nodeIds: trace.nodeIds,
      edgeIds: trace.edgeIds,
      traceId: trace.id,
    });

    if (isSimulationQuery(query)) {
      actions.push({
        type: "simulate_flow",
        layerId: trace.layerId,
        nodeIds: trace.nodeIds,
        edgeIds: trace.edgeIds,
        steps: trace.steps,
        summary: buildSimulationSummary(bundle, trace.nodeIds),
      });
    }

    return actions;
  }

  const scores = mapFilesToNodeIds(bundle, citationFiles, activeLayer);
  addAliasScores(bundle, query, activeLayer, scores);

  const rankedNodeIds = [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([nodeId]) => nodeId);

  const topNodeIds = rankedNodeIds.slice(0, 3);
  if (topNodeIds.length === 0) return actions;

  const path =
    topNodeIds.length >= 2
      ? findShortestPath(bundle, activeLayer, topNodeIds[0], topNodeIds[1])
      : null;

  const focusedNodeIds = path?.nodeIds || topNodeIds;
  const focusedEdgeIds = path?.edgeIds || [];

  if (activeLayer === "code") {
    const groupIds = getGroupIdsForNodes(bundle, focusedNodeIds);
    if (groupIds.length > 0) {
      actions.push({
        type: "expand_groups",
        layerId: "code",
        groupIds,
      });
    }
  }

  actions.push({
    type: "focus_nodes",
    layerId: activeLayer,
    nodeIds: focusedNodeIds,
    edgeIds: focusedEdgeIds,
    primaryNodeId: topNodeIds[0] || null,
    dimOthers: true,
  });

  if (path && isFlowQuery(query)) {
    actions.push({
      type: "trace_path",
      layerId: activeLayer,
      nodeIds: path.nodeIds,
      edgeIds: path.edgeIds,
      traceId: null,
    });
  }

  if (path && isSimulationQuery(query)) {
    actions.push({
      type: "simulate_flow",
      layerId: activeLayer,
      nodeIds: path.nodeIds,
      edgeIds: path.edgeIds,
      steps: buildPlaybackSteps(bundle, path.nodeIds, path.edgeIds),
      summary: buildSimulationSummary(bundle, path.nodeIds),
    });
  }

  return actions;
}
