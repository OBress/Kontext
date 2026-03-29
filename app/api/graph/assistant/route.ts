import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/api/auth";
import { rateLimit } from "@/lib/api/rate-limit";
import { handleApiError } from "@/lib/api/errors";
import {
  validateApiKey,
  validateMessage,
  validateRepoFullName,
} from "@/lib/api/validate";
import {
  answerRepoQuestion,
  retrieveRepoContext,
} from "@/lib/api/repo-intelligence";
import {
  getArchitectureView,
  type ArchitectureBundle,
  type ArchitectureLayerId,
  type ArchitectureTrace,
  toArchitectureBundle,
} from "@/types/architecture";

type AssistantAction =
  | {
      type: "switch_layer";
      layerId: ArchitectureLayerId;
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
    };

function tokenize(input: string): string[] {
  return input
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 2);
}

function mapFilesToNodeIds(bundle: ArchitectureBundle, filePaths: string[]): Map<string, number> {
  const scores = new Map<string, number>();

  for (const filePath of filePaths) {
    for (const entry of Object.values(bundle.nodeIndex)) {
      if (entry.files.some((file) => filePath === file || filePath.endsWith(file))) {
        scores.set(entry.id, (scores.get(entry.id) || 0) + 3);
      }
    }
  }

  return scores;
}

function addAliasScores(bundle: ArchitectureBundle, query: string, scores: Map<string, number>) {
  const tokens = tokenize(query);
  for (const entry of Object.values(bundle.nodeIndex)) {
    let score = scores.get(entry.id) || 0;
    for (const alias of entry.aliases) {
      const lowerAlias = alias.toLowerCase();
      if (query.toLowerCase().includes(lowerAlias)) {
        score += Math.max(2, lowerAlias.split(" ").length);
      }

      for (const token of tokens) {
        if (lowerAlias.includes(token)) {
          score += 1;
        }
      }
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
    const current = queue.shift()!;
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
  if (/(code|file|route|function|source)/.test(lower)) return "code";
  return null;
}

function chooseTrace(
  bundle: ArchitectureBundle,
  query: string
): ArchitectureTrace | null {
  const lower = query.toLowerCase();
  let best: ArchitectureTrace | null = null;
  let bestScore = 0;

  for (const trace of bundle.traces) {
    let score = 0;
    for (const alias of trace.aliases || []) {
      if (lower.includes(alias.toLowerCase())) {
        score += alias.length > 10 ? 4 : 2;
      }
    }
    if (lower.includes(trace.label.toLowerCase())) {
      score += 5;
    }
    if (score > bestScore) {
      best = trace;
      bestScore = score;
    }
  }

  return bestScore > 0 ? best : null;
}

function deriveActions(params: {
  bundle: ArchitectureBundle | null;
  defaultLayer: ArchitectureLayerId;
  query: string;
  citationFiles: string[];
}): AssistantAction[] {
  const { bundle, defaultLayer, query, citationFiles } = params;
  if (!bundle) return [];

  const actions: AssistantAction[] = [];
  const inferredLayer = inferLayerFromQuery(query);
  const activeLayer = inferredLayer || defaultLayer;

  if (inferredLayer && inferredLayer !== defaultLayer) {
    actions.push({
      type: "switch_layer",
      layerId: inferredLayer,
    });
  }

  const trace = chooseTrace(bundle, query);
  if (trace) {
    if (trace.layerId !== activeLayer) {
      actions.push({ type: "switch_layer", layerId: trace.layerId });
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
    return actions;
  }

  const scores = mapFilesToNodeIds(bundle, citationFiles);
  addAliasScores(bundle, query, scores);

  const rankedNodeIds = [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([nodeId]) => nodeId);

  const topNodeIds = rankedNodeIds.slice(0, 3);
  if (topNodeIds.length === 0) return actions;

  const path =
    topNodeIds.length >= 2
      ? findShortestPath(bundle, activeLayer, topNodeIds[0], topNodeIds[1])
      : null;

  actions.push({
    type: "focus_nodes",
    layerId: activeLayer,
    nodeIds: path?.nodeIds || topNodeIds,
    edgeIds: path?.edgeIds || [],
    primaryNodeId: topNodeIds[0] || null,
    dimOthers: true,
  });

  if (
    path &&
    /(trace|flow|path|send|where|how does|simulate|show)/.test(query.toLowerCase())
  ) {
    actions.push({
      type: "trace_path",
      layerId: activeLayer,
      nodeIds: path.nodeIds,
      edgeIds: path.edgeIds,
      traceId: null,
    });
  }

  return actions;
}

/**
 * POST /api/graph/assistant - Architecture-aware assistant for the graph page.
 */
export async function POST(request: Request) {
  try {
    const { user, supabase } = await getAuthenticatedUser();

    const rl = rateLimit(user.id, "chat");
    if (!rl.ok) {
      return NextResponse.json(
        { error: { code: "RATE_LIMITED", message: "Too many assistant requests" } },
        { status: 429 }
      );
    }

    const body = await request.json();
    const message = validateMessage(body.message);
    const repoFullName = validateRepoFullName(body.repo_full_name);
    const defaultLayer = (body.layer || "system") as ArchitectureLayerId;
    const apiKey = validateApiKey(request);

    const context = await retrieveRepoContext({
      supabase,
      userId: user.id,
      repoFullName,
      query: message,
      apiKey,
      includeTimeline: true,
      matchCount: 16,
    });

    const { data: repoData } = await supabase
      .from("repos")
      .select("architecture_analysis, architecture_for_sha, architecture_analyzed_at, last_synced_sha")
      .eq("user_id", user.id)
      .eq("full_name", repoFullName)
      .single();

    const bundle = toArchitectureBundle(
      repoData?.architecture_analysis || null,
      repoData?.architecture_for_sha || repoData?.last_synced_sha || null,
      repoData?.architecture_analyzed_at || null
    );

    const answer = await answerRepoQuestion({
      apiKey,
      repoFullName: context.repoLabel,
      question: message,
      fileManifest: context.fileManifest,
      contextBlocks: context.contextBlocks,
      timelineBlocks: context.timelineBlocks,
      extraInstructions:
        "When possible, mention the architectural component names that best explain the flow.",
    });

    const actions = deriveActions({
      bundle,
      defaultLayer,
      query: message,
      citationFiles: context.dedupedCitations.map((citation) => citation.file_path),
    });

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({
              type: "context",
              citations: context.dedupedCitations,
              timelineCitations: context.timelineCitations,
              answerMode: context.answerMode,
            })}\n\n`
          )
        );

        for (const action of actions) {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ type: "action", action })}\n\n`)
          );
        }

        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ type: "text", content: answer })}\n\n`
          )
        );
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ type: "done" })}\n\n`)
        );
        controller.close();
      },
    });

    return new NextResponse(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
