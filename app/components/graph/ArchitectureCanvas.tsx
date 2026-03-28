"use client";

import { useCallback, useMemo, useEffect } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  Panel,
  BackgroundVariant,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
  type NodeTypes,
  type EdgeTypes,
  type OnSelectionChangeParams,
} from "@xyflow/react";
import dagre from "dagre";
import "@xyflow/react/dist/style.css";

import { useGraphStore } from "@/lib/store/graph-store";
import { ArchitectureNode } from "./ArchitectureNode";
import { GroupNode } from "./GroupNode";
import { ArchitectureEdge } from "./ArchitectureEdge";
import { DetailPanel } from "./DetailPanel";
import type { ArchitectureAnalysis, ArchComponent } from "@/types/architecture";
import {
  Brain,
  Loader2,
  RefreshCw,
  Clock,
} from "lucide-react";
import { useAppStore } from "@/lib/store/app-store";

// Register custom node types
const nodeTypes: NodeTypes = {
  architecture: ArchitectureNode,
  group: GroupNode,
};

const edgeTypes: EdgeTypes = {
  architecture: ArchitectureEdge,
};

// Dagre layout helper
function getLayoutedElements(
  nodes: Node[],
  edges: Edge[],
  direction: "TB" | "LR" = "LR"
): { nodes: Node[]; edges: Edge[] } {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({
    rankdir: direction,
    nodesep: 80,
    ranksep: 160,
    edgesep: 40,
    marginx: 40,
    marginy: 40,
  });

  for (const node of nodes) {
    // Only layout top-level nodes (no parentId)
    if (!node.parentId) {
      g.setNode(node.id, {
        width: node.measured?.width || 260,
        height: node.measured?.height || 180,
      });
    }
  }

  for (const edge of edges) {
    if (g.hasNode(edge.source) && g.hasNode(edge.target)) {
      g.setEdge(edge.source, edge.target);
    }
  }

  dagre.layout(g);

  const layoutedNodes = nodes.map((node) => {
    if (node.parentId) return node;
    const dagreNode = g.node(node.id);
    if (!dagreNode) return node;
    return {
      ...node,
      position: {
        x: dagreNode.x - (node.measured?.width || 260) / 2,
        y: dagreNode.y - (node.measured?.height || 180) / 2,
      },
    };
  });

  return { nodes: layoutedNodes, edges };
}

/**
 * Convert ArchitectureAnalysis into React Flow nodes + edges.
 */
function analysisToFlowElements(
  analysis: ArchitectureAnalysis,
  expandedGroups: Set<string>,
  collapsedNodes: Set<string>
): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = [];
  const edges: Edge[] = [];

  for (const comp of analysis.components) {
    const hasChildren = !!comp.children && comp.children.length > 0;
    const isExpanded = expandedGroups.has(comp.id);

    // Count total files including children
    let totalFiles = comp.files.length;
    if (comp.children) {
      for (const child of comp.children) {
        totalFiles += child.files.length;
      }
    }

    if (hasChildren && isExpanded) {
      // Render as group node with children inside
      nodes.push({
        id: comp.id,
        type: "group",
        position: { x: 0, y: 0 },
        data: {
          label: comp.label,
          description: comp.description,
          componentType: comp.type,
          childCount: comp.children!.length,
          isExpanded: true,
        },
        style: {
          width: 500,
          height: 300 + (comp.children!.length * 100),
        },
      });

      // Add child nodes
      comp.children!.forEach((child: ArchComponent, index: number) => {
        nodes.push({
          id: child.id,
          type: "architecture",
          position: { x: 20, y: 60 + index * 120 },
          parentId: comp.id,
          extent: "parent" as const,
          data: {
            label: child.label,
            description: child.description,
            componentType: child.type,
            files: child.files,
            hasChildren: false,
            isExpanded: false,
            fileCount: child.files.length,
          },
        });
      });
    } else {
      // Render as regular or collapsed group node
      const nodeType = hasChildren ? "group" : "architecture";
      nodes.push({
        id: comp.id,
        type: nodeType,
        position: { x: 0, y: 0 },
        data: hasChildren
          ? {
              label: comp.label,
              description: comp.description,
              componentType: comp.type,
              childCount: comp.children!.length,
              isExpanded: false,
            }
          : {
              label: comp.label,
              description: comp.description,
              componentType: comp.type,
              files: comp.files,
              hasChildren: false,
              isExpanded: false,
              fileCount: totalFiles,
            },
      });
    }
  }

  // Add edges
  for (const conn of analysis.connections) {
    edges.push({
      id: conn.id,
      source: conn.source,
      target: conn.target,
      type: "architecture",
      data: {
        label: conn.label,
        description: conn.description,
        connectionType: conn.type,
      },
    });
  }

  return getLayoutedElements(nodes, edges, "LR");
}

interface ArchitectureCanvasProps {
  repoFullName: string;
}

function ArchitectureCanvasInner({ repoFullName }: ArchitectureCanvasProps) {
  const {
    architectureData,
    setArchitectureData,
    expandedGroups,
    collapsedNodes,
    setSelectedElement,
    isAnalyzing,
    setIsAnalyzing,
    analyzedAt,
    setAnalyzedAt,
  } = useGraphStore();

  const apiKey = useAppStore((s) => s.apiKey);

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  // Convert architecture data to flow elements whenever it changes
  useEffect(() => {
    if (architectureData) {
      const { nodes: layoutedNodes, edges: layoutedEdges } = analysisToFlowElements(
        architectureData,
        expandedGroups,
        collapsedNodes
      );
      setNodes(layoutedNodes);
      setEdges(layoutedEdges);
    }
  }, [architectureData, expandedGroups, collapsedNodes, setNodes, setEdges]);

  // Load cached data on mount
  useEffect(() => {
    fetch(`/api/graph?repo=${encodeURIComponent(repoFullName)}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.architecture) {
          setArchitectureData(data.architecture);
          setAnalyzedAt(data.analyzedAt);
        }
      })
      .catch(() => {});
  }, [repoFullName, setArchitectureData, setAnalyzedAt]);

  const handleAnalyze = useCallback(async () => {
    if (!apiKey || isAnalyzing) return;
    setIsAnalyzing(true);

    try {
      const res = await fetch("/api/graph/analyze", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-google-api-key": apiKey,
        },
        body: JSON.stringify({ repo_full_name: repoFullName }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => null);
        console.error("Analysis failed:", errData);
        return;
      }

      const data = await res.json();
      setArchitectureData(data.analysis);
      setAnalyzedAt(data.analyzedAt);
    } catch (err) {
      console.error("Analysis error:", err);
    } finally {
      setIsAnalyzing(false);
    }
  }, [apiKey, repoFullName, isAnalyzing, setIsAnalyzing, setArchitectureData, setAnalyzedAt]);

  const onSelectionChange = useCallback(
    (params: OnSelectionChangeParams) => {
      if (params.nodes.length > 0) {
        setSelectedElement({ type: "node", id: params.nodes[0].id });
      } else if (params.edges.length > 0) {
        setSelectedElement({ type: "edge", id: params.edges[0].id });
      }
    },
    [setSelectedElement]
  );

  const onPaneClick = useCallback(() => {
    setSelectedElement(null);
  }, [setSelectedElement]);

  // Format analyzed time
  const analyzedTimeAgo = useMemo(() => {
    if (!analyzedAt) return null;
    const diff = Date.now() - new Date(analyzedAt).getTime();
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return "just now";
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
  }, [analyzedAt]);

  return (
    <div className="architecture-canvas">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onSelectionChange={onSelectionChange}
        onPaneClick={onPaneClick}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        minZoom={0.1}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
        defaultEdgeOptions={{
          type: "architecture",
          animated: false,
        }}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={20}
          size={1}
          color="rgba(255,255,255,0.04)"
        />
        <Controls
          showInteractive={false}
          className="architecture-controls"
        />
        <MiniMap
          className="architecture-minimap"
          nodeColor={(node) => {
            const data = node.data as Record<string, unknown>;
            const type = (data?.componentType as string) || "shared";
            const colorMap: Record<string, string> = {
              page: "#3FB950",
              api: "#58A6FF",
              service: "#BC8CFF",
              worker: "#F0883E",
              database: "#FF7B72",
              config: "#FFD600",
              shared: "#8B949E",
              external: "#3FB95060",
            };
            return colorMap[type] || "#8B949E";
          }}
          maskColor="rgba(0,0,0,0.7)"
        />

        {/* Top-left analyze panel */}
        <Panel position="top-left" className="architecture-panel">
          {!architectureData && !isAnalyzing && (
            <button
              onClick={handleAnalyze}
              disabled={!apiKey}
              className="analyze-btn"
            >
              <Brain size={16} />
              <span>Analyze Architecture</span>
            </button>
          )}

          {isAnalyzing && (
            <div className="analyze-status">
              <Loader2 size={16} className="animate-spin" />
              <span>Analyzing codebase...</span>
            </div>
          )}

          {architectureData && !isAnalyzing && (
            <div className="analyze-info">
              <div className="analyze-info__summary">
                <span className="analyze-info__count">
                  {architectureData.components.length} components · {architectureData.connections.length} connections
                </span>
                {analyzedTimeAgo && (
                  <span className="analyze-info__time">
                    <Clock size={11} />
                    {analyzedTimeAgo}
                  </span>
                )}
              </div>
              <button
                onClick={handleAnalyze}
                disabled={!apiKey}
                className="analyze-refresh-btn"
                title="Re-analyze"
              >
                <RefreshCw size={13} />
              </button>
            </div>
          )}

          {!apiKey && (
            <p className="analyze-hint">Set your AI API key to analyze</p>
          )}
        </Panel>
      </ReactFlow>

      {/* Detail panel overlay */}
      <DetailPanel />
    </div>
  );
}

export function ArchitectureCanvas({ repoFullName }: ArchitectureCanvasProps) {
  return (
    <ReactFlowProvider>
      <ArchitectureCanvasInner repoFullName={repoFullName} />
    </ReactFlowProvider>
  );
}
