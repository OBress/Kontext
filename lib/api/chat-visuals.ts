import type { SupabaseClient } from "@supabase/supabase-js";
import {
  deriveArchitectureActions,
  type ArchitectureAssistantAction,
} from "@/lib/api/architecture-actions";
import type { RepoTimelineCitation } from "@/lib/api/repo-intelligence";
import {
  toArchitectureBundle,
  type ArchitectureBundle,
  type ArchitectureLayerId,
} from "@/types/architecture";
import type {
  ChatArchitectureVisualPayload,
  ChatMermaidVisualPayload,
  ChatTimelineVisualPayload,
  ChatVisualKind,
  ChatVisualPayload,
} from "@/types/chat-visuals";

interface RepoCommitVisualRow {
  sha: string;
  message: string;
  ai_summary: string | null;
  author_name: string;
  committed_at: string;
}

function shouldShowTimelineVisual(query: string): boolean {
  return /(timeline|history|evolution|changed|change over time|when did|how has|progression|recent commits|develop)/.test(
    query
  );
}

function shouldShowArchitectureVisual(query: string): boolean {
  return /(flow|path|graph|node|interaction|interact|request|trace|send|how does|show .*flow|call chain|dependency)/.test(
    query
  );
}

function shouldShowMermaidVisual(query: string): boolean {
  return /(diagram|mermaid|chart|visualize|map out)/.test(query);
}

function renderChatVisualFence(
  kind: ChatVisualKind,
  payload: ChatVisualPayload
): string {
  return `\`\`\`${kind}\n${JSON.stringify(payload, null, 2)}\n\`\`\`\n\n`;
}

function getVisualLayer(
  actions: ArchitectureAssistantAction[],
  fallbackLayer: ArchitectureLayerId = "system"
): ArchitectureLayerId {
  for (const action of actions) {
    return action.layerId;
  }

  return fallbackLayer;
}

function getFocusAction(
  actions: ArchitectureAssistantAction[]
): Extract<ArchitectureAssistantAction, { type: "focus_nodes" }> | null {
  return (
    actions.find(
      (action): action is Extract<ArchitectureAssistantAction, { type: "focus_nodes" }> =>
        action.type === "focus_nodes"
    ) || null
  );
}

function getTraceAction(
  actions: ArchitectureAssistantAction[]
): Extract<ArchitectureAssistantAction, { type: "trace_path" }> | null {
  return (
    actions.find(
      (action): action is Extract<ArchitectureAssistantAction, { type: "trace_path" }> =>
        action.type === "trace_path"
    ) || null
  );
}

async function buildTimelineVisual(params: {
  supabase: SupabaseClient;
  userId: string;
  repoFullName: string;
  timelineCitations: RepoTimelineCitation[];
}): Promise<ChatTimelineVisualPayload | null> {
  const { supabase, userId, repoFullName, timelineCitations } = params;
  const matchedShas = new Set(timelineCitations.map((entry) => entry.sha));

  const { data } = await supabase
    .from("repo_commits")
    .select("sha, message, ai_summary, author_name, committed_at")
    .eq("user_id", userId)
    .eq("repo_full_name", repoFullName)
    .neq("author_name", "system")
    .order("committed_at", { ascending: false })
    .limit(12);

  const recentRows = (data || []) as RepoCommitVisualRow[];
  const ordered = [
    ...timelineCitations.map((entry) => ({
      sha: entry.sha,
      message: entry.message,
      ai_summary: entry.ai_summary,
      author_name: entry.author,
      committed_at: entry.committed_at,
    })),
    ...recentRows,
  ];

  const uniqueEvents = ordered
    .filter((entry, index, collection) => {
      return collection.findIndex((candidate) => candidate.sha === entry.sha) === index;
    })
    .slice(0, 8)
    .map((entry) => ({
      sha: entry.sha,
      date: new Date(entry.committed_at).toISOString().split("T")[0],
      committedAt: entry.committed_at,
      summary: (entry.ai_summary || entry.message.split("\n")[0] || "Repository change").trim(),
      message: entry.message.split("\n")[0]?.trim() || "Repository change",
      author: entry.author_name,
      similarity:
        timelineCitations.find((citation) => citation.sha === entry.sha)?.similarity || null,
      matched: matchedShas.has(entry.sha),
    }));

  if (uniqueEvents.length < 2) {
    return null;
  }

  return {
    kind: "kontext-timeline",
    title: "Relevant development timeline",
    summary:
      "A compact view of the repo history most relevant to this question, with the strongest semantic matches pinned first.",
    events: uniqueEvents,
  };
}

async function fetchArchitectureBundle(params: {
  supabase: SupabaseClient;
  userId: string;
  repoFullName: string;
}): Promise<ArchitectureBundle | null> {
  const { supabase, userId, repoFullName } = params;
  const { data } = await supabase
    .from("repos")
    .select(
      "architecture_analysis, architecture_for_sha, architecture_analyzed_at, last_synced_sha"
    )
    .eq("user_id", userId)
    .eq("full_name", repoFullName)
    .single();

  return toArchitectureBundle(
    data?.architecture_analysis || null,
    data?.architecture_for_sha || data?.last_synced_sha || null,
    data?.architecture_analyzed_at || null
  );
}

async function buildArchitectureVisual(params: {
  supabase: SupabaseClient;
  userId: string;
  repoFullName: string;
  query: string;
  citationFiles: string[];
}): Promise<ChatArchitectureVisualPayload | null> {
  const { supabase, userId, repoFullName, query, citationFiles } = params;
  const bundle = await fetchArchitectureBundle({ supabase, userId, repoFullName });
  if (!bundle) return null;

  const actions = deriveArchitectureActions({
    bundle,
    defaultLayer: "system",
    query,
    citationFiles,
  });
  const focus = getFocusAction(actions);
  if (!focus || focus.nodeIds.length === 0) return null;

  const trace = getTraceAction(actions);
  const layerId = getVisualLayer(actions);
  const pathNodeIds = trace?.nodeIds || focus.nodeIds;
  const traceLabel = trace?.traceId
    ? bundle.traces.find((item) => item.id === trace.traceId)?.label || null
    : null;

  const nodes = focus.nodeIds
    .map((nodeId) => bundle.nodeIndex[nodeId])
    .filter((entry): entry is NonNullable<typeof entry> => !!entry)
    .map((entry) => ({
      id: entry.id,
      label: entry.label,
      description: entry.description,
      type: entry.type,
      highlighted: true,
    }));

  const edges = focus.edgeIds
    .map((edgeId) => bundle.edgeIndex[edgeId])
    .filter((entry): entry is NonNullable<typeof entry> => !!entry)
    .map((entry) => ({
      id: entry.id,
      source: entry.source,
      target: entry.target,
      label: entry.label,
      description: entry.description,
      type: entry.type,
      highlighted: true,
    }));

  if (nodes.length === 0) {
    return null;
  }

  return {
    kind: "kontext-architecture",
    title: traceLabel || "Relevant architecture flow",
    summary:
      traceLabel
        ? "A read-only view of the most relevant traced path for this question."
        : "A compact view of the repo components most relevant to this flow-oriented question.",
    layerId,
    traceLabel,
    pathNodeIds,
    nodes,
    edges,
  };
}

function buildMermaidVisual(
  architecture: ChatArchitectureVisualPayload
): ChatMermaidVisualPayload | null {
  if (architecture.nodes.length < 2 || architecture.edges.length === 0) {
    return null;
  }

  const idMap = new Map(
    architecture.nodes.map((node, index) => [node.id, `node_${index + 1}`])
  );

  const nodeLines = architecture.nodes.map((node) => {
    const mermaidId = idMap.get(node.id);
    const label = node.label.replace(/"/g, "'");
    return `  ${mermaidId}["${label}"]`;
  });
  const edgeLines = architecture.edges
    .map((edge) => {
      const sourceId = idMap.get(edge.source);
      const targetId = idMap.get(edge.target);
      if (!sourceId || !targetId) return null;

      const label = edge.label.replace(/"/g, "'");
      return `  ${sourceId} -->|${label}| ${targetId}`;
    })
    .filter((line): line is string => !!line);

  if (edgeLines.length === 0) {
    return null;
  }

  return {
    kind: "mermaid",
    title: architecture.traceLabel || architecture.title,
    description:
      "An explanatory Mermaid flowchart derived from the same architecture focus used for the inline graph view.",
    diagram: ["flowchart LR", ...nodeLines, ...edgeLines].join("\n"),
  };
}

export async function planChatVisual(params: {
  supabase: SupabaseClient;
  userId: string;
  repoFullName: string;
  query: string;
  citationFiles: string[];
  timelineCitations: RepoTimelineCitation[];
}): Promise<string | null> {
  const { query } = params;
  const normalizedQuery = query.toLowerCase();

  if (shouldShowTimelineVisual(normalizedQuery)) {
    const timelineVisual = await buildTimelineVisual(params);
    if (timelineVisual) {
      return renderChatVisualFence("kontext-timeline", timelineVisual);
    }
  }

  const architectureRequested =
    shouldShowArchitectureVisual(normalizedQuery) ||
    shouldShowMermaidVisual(normalizedQuery);

  const architectureVisual = architectureRequested
    ? await buildArchitectureVisual(params)
    : null;

  if (shouldShowArchitectureVisual(normalizedQuery) && architectureVisual) {
    return renderChatVisualFence("kontext-architecture", architectureVisual);
  }

  if (shouldShowMermaidVisual(normalizedQuery) && architectureVisual) {
    const mermaidVisual = buildMermaidVisual(architectureVisual);
    if (mermaidVisual) {
      return renderChatVisualFence("mermaid", mermaidVisual);
    }
  }

  return null;
}
