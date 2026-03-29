"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Edge,
  type EdgeTypes,
  type Node,
  type NodeTypes,
  type OnSelectionChangeParams,
} from "@xyflow/react";
import dagre from "dagre";
import "@xyflow/react/dist/style.css";
import {
  Brain,
  ChevronDown,
  ChevronUp,
  Clock,
  Layers3,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { ArchitectureAssistant, ArchitectureAssistantFab } from "./ArchitectureAssistant";
import { DetailPanel } from "./DetailPanel";
import { ArchitectureEdge } from "./ArchitectureEdge";
import { ArchitectureNode } from "./ArchitectureNode";
import { GroupNode } from "./GroupNode";
import type { ArchitectureAssistantAction } from "@/lib/api/architecture-actions";
import { useAppStore } from "@/lib/store/app-store";
import type { ChatCitation } from "@/lib/store/chat-store";
import { useGraphStore } from "@/lib/store/graph-store";
import {
  getArchitectureView,
  type ArchComponent,
  type ArchitectureBundle,
  type ArchitectureLayerId,
  type ArchitectureView,
} from "@/types/architecture";

const nodeTypes: NodeTypes = {
  architecture: ArchitectureNode,
  group: GroupNode,
};

const edgeTypes: EdgeTypes = {
  architecture: ArchitectureEdge,
};

function getLayoutedElements(
  nodes: Node[],
  edges: Edge[],
  direction: "TB" | "LR" = "LR"
): { nodes: Node[]; edges: Edge[] } {
  const graph = new dagre.graphlib.Graph();
  graph.setDefaultEdgeLabel(() => ({}));
  graph.setGraph({
    rankdir: direction,
    nodesep: 80,
    ranksep: 160,
    edgesep: 40,
    marginx: 40,
    marginy: 40,
  });

  for (const node of nodes) {
    if (!node.parentId) {
      graph.setNode(node.id, {
        width: node.measured?.width || 280,
        height: node.measured?.height || 190,
      });
    }
  }

  for (const edge of edges) {
    if (graph.hasNode(edge.source) && graph.hasNode(edge.target)) {
      graph.setEdge(edge.source, edge.target);
    }
  }

  dagre.layout(graph);

  return {
    nodes: nodes.map((node) => {
      if (node.parentId) return node;
      const layoutNode = graph.node(node.id);
      if (!layoutNode) return node;

      return {
        ...node,
        position: {
          x: layoutNode.x - (node.measured?.width || 280) / 2,
          y: layoutNode.y - (node.measured?.height || 190) / 2,
        },
      };
    }),
    edges,
  };
}

function viewToFlowElements(
  view: ArchitectureView,
  expandedGroups: Set<string>
): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = [];
  const edges: Edge[] = [];

  for (const component of view.components) {
    const hasChildren = !!component.children && component.children.length > 0;
    const isExpanded = expandedGroups.has(component.id);

    if (hasChildren && isExpanded) {
      nodes.push({
        id: component.id,
        type: "group",
        position: { x: 0, y: 0 },
        data: {
          label: component.label,
          description: component.description,
          componentType: component.type,
          childCount: component.children!.length,
          isExpanded: true,
        },
        style: {
          width: 520,
          height: Math.max(280, 120 + component.children!.length * 104),
        },
      });

      component.children!.forEach((child: ArchComponent, index: number) => {
        nodes.push({
          id: child.id,
          type: "architecture",
          position: { x: 18, y: 56 + index * 98 },
          parentId: component.id,
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
      nodes.push({
        id: component.id,
        type: hasChildren ? "group" : "architecture",
        position: { x: 0, y: 0 },
        data: hasChildren
          ? {
              label: component.label,
              description: component.description,
              componentType: component.type,
              childCount: component.children!.length,
              isExpanded: false,
            }
          : {
              label: component.label,
              description: component.description,
              componentType: component.type,
              files: component.files,
              hasChildren: false,
              isExpanded: false,
              fileCount: component.files.length,
            },
      });
    }
  }

  const visibleNodeIds = new Set(nodes.map((node) => node.id));

  for (const connection of view.connections) {
    if (!visibleNodeIds.has(connection.source) || !visibleNodeIds.has(connection.target)) {
      continue;
    }

    edges.push({
      id: connection.id,
      source: connection.source,
      target: connection.target,
      type: "architecture",
      data: {
        label: connection.label,
        description: connection.description,
        connectionType: connection.type,
      },
    });
  }

  return getLayoutedElements(nodes, edges, "LR");
}

function countSummary(view: ArchitectureView | null) {
  if (!view) return "Architecture bundle not ready yet";
  const nodeCount =
    view.components.length +
    view.components.reduce((total, component) => total + (component.children?.length || 0), 0);
  return `${nodeCount} components - ${view.connections.length} connections`;
}

interface ArchitectureCanvasProps {
  repoFullName: string;
}

function ArchitectureCanvasInner({ repoFullName }: ArchitectureCanvasProps) {
  const {
    architectureData,
    setArchitectureData,
    architectureBundle,
    setArchitectureBundle,
    activeLayer,
    setActiveLayer,
    expandedGroups,
    setExpandedGroups,
    setCollapsedNodes,
    setSelectedElement,
    isAnalyzing,
    setIsAnalyzing,
    analyzedAt,
    setAnalyzedAt,
    setArchitectureStatus,
    architectureStatus,
    setArchitectureForSha,
    setArchitectureError,
    architectureError,
    isArchitectureStale,
    setIsArchitectureStale,
    setHighlights,
    clearHighlights,
    activeTrace,
    setActiveTrace,
    activeSimulation,
    setActiveSimulation,
  } = useGraphStore();

  const apiKey = useAppStore((state) => state.apiKey);
  const reactFlow = useReactFlow();
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const autoAnalyzeRef = useRef(false);

  const loadGraph = useCallback(async () => {
    const response = await fetch(`/api/graph?repo=${encodeURIComponent(repoFullName)}`);
    const data = await response.json();

    if (data.architectureBundle) {
      setArchitectureBundle(data.architectureBundle as ArchitectureBundle);
    } else {
      setArchitectureBundle(null);
      setArchitectureData(null);
    }

    setAnalyzedAt(data.analyzedAt || null);
    setArchitectureStatus(data.architectureStatus || "missing");
    setArchitectureForSha(data.architectureForSha || null);
    setArchitectureError(data.architectureError || null);
    setIsArchitectureStale(Boolean(data.isStale));
  }, [
    repoFullName,
    setAnalyzedAt,
    setArchitectureBundle,
    setArchitectureData,
    setArchitectureError,
    setArchitectureForSha,
    setArchitectureStatus,
    setIsArchitectureStale,
  ]);

  useEffect(() => {
    void loadGraph();
  }, [loadGraph]);

  useEffect(() => {
    if (!architectureBundle) return;
    const nextView = getArchitectureView(architectureBundle, activeLayer);
    setArchitectureData(nextView);
    setExpandedGroups(nextView?.defaultExpanded || []);
    setCollapsedNodes([]);
    clearHighlights();
  }, [
    activeLayer,
    architectureBundle,
    clearHighlights,
    setArchitectureData,
    setCollapsedNodes,
    setExpandedGroups,
  ]);

  useEffect(() => {
    if (!architectureData) return;
    const { nodes: layoutedNodes, edges: layoutedEdges } = viewToFlowElements(
      architectureData,
      expandedGroups
    );
    setNodes(layoutedNodes);
    setEdges(layoutedEdges);
  }, [architectureData, expandedGroups, setEdges, setNodes]);

  useEffect(() => {
    if (!(architectureStatus === "queued" || architectureStatus === "analyzing")) {
      return;
    }

    const interval = window.setInterval(() => {
      void loadGraph();
    }, 4000);

    return () => window.clearInterval(interval);
  }, [architectureStatus, loadGraph]);

  useEffect(() => {
    if (!activeSimulation) return;
    if (activeSimulation.activeStepIndex >= activeSimulation.steps.length - 1) return;

    const currentStep = activeSimulation.steps[activeSimulation.activeStepIndex];
    const delay = currentStep?.kind === "edge" ? 950 : 700;

    const timeout = window.setTimeout(() => {
      setActiveSimulation({
        ...activeSimulation,
        activeStepIndex: activeSimulation.activeStepIndex + 1,
      });
    }, delay);

    return () => window.clearTimeout(timeout);
  }, [activeSimulation, setActiveSimulation]);

  const handleAnalyze = useCallback(async () => {
    if (!apiKey || isAnalyzing) return;
    setIsAnalyzing(true);

    try {
      const response = await fetch("/api/graph/analyze", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-google-api-key": apiKey,
        },
        body: JSON.stringify({ repo_full_name: repoFullName }),
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => null);
        console.error("Analysis failed:", errData);
        return;
      }

      const data = await response.json();
      if (data.architectureBundle) {
        setArchitectureBundle(data.architectureBundle);
      }
      setAnalyzedAt(data.analyzedAt || null);
      setArchitectureStatus(data.architectureStatus || "ready");
      setArchitectureForSha(data.architectureForSha || null);
      setArchitectureError(null);
      setIsArchitectureStale(false);
    } catch (error) {
      console.error("Analysis error:", error);
    } finally {
      setIsAnalyzing(false);
    }
  }, [
    apiKey,
    isAnalyzing,
    repoFullName,
    setAnalyzedAt,
    setArchitectureBundle,
    setArchitectureError,
    setArchitectureForSha,
    setArchitectureStatus,
    setIsAnalyzing,
    setIsArchitectureStale,
  ]);

  useEffect(() => {
    if (autoAnalyzeRef.current) return;
    if (architectureBundle || !apiKey) return;
    if (!["missing", "stale", "error"].includes(architectureStatus)) return;
    autoAnalyzeRef.current = true;
    void handleAnalyze();
  }, [apiKey, architectureBundle, architectureStatus, handleAnalyze]);

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

  const focusNodes = useCallback(
    (nodeIds: string[]) => {
      window.setTimeout(() => {
        const matchedNodes = nodeIds
          .map((nodeId) => reactFlow.getNode(nodeId))
          .filter((node): node is Node => Boolean(node));
        if (matchedNodes.length > 0) {
          reactFlow.fitView({
            nodes: matchedNodes,
            duration: 520,
            padding: 0.24,
          });
        }
      }, 220);
    },
    [reactFlow]
  );

  const ensureExpandedGroups = useCallback(
    (layerId: ArchitectureLayerId, groupIds: string[]) => {
      if (groupIds.length === 0) return;
      setActiveLayer(layerId);
      setExpandedGroups([...new Set([...expandedGroups, ...groupIds])]);
    },
    [expandedGroups, setActiveLayer, setExpandedGroups]
  );

  const findBestNodeForFile = useCallback(
    (filePath: string) => {
      if (!architectureBundle) return null;

      const exactCodeFileNode =
        Object.values(architectureBundle.nodeIndex).find(
          (entry) =>
            entry.layers.includes("code") &&
            entry.files.length === 1 &&
            entry.files[0] === filePath
        ) || null;

      if (exactCodeFileNode) return exactCodeFileNode;

      const codeModuleNode =
        Object.values(architectureBundle.nodeIndex).find(
          (entry) =>
            entry.layers.includes("code") &&
            !entry.parentId &&
            entry.files.includes(filePath)
        ) || null;

      if (codeModuleNode) return codeModuleNode;

      return (
        Object.values(architectureBundle.nodeIndex).find((entry) =>
          entry.files.includes(filePath)
        ) || null
      );
    },
    [architectureBundle]
  );

  const focusFilePath = useCallback(
    (filePath: string) => {
      const target = findBestNodeForFile(filePath);
      if (!target) return;

      const targetLayer = target.layers.includes("code")
        ? "code"
        : target.layers[0] || activeLayer;

      if (target.parentId) {
        ensureExpandedGroups(targetLayer, [target.parentId]);
      } else {
        setActiveLayer(targetLayer);
      }

      setActiveTrace(null);
      setActiveSimulation(null);
      setHighlights([target.id], [], false);
      setSelectedElement({ type: "node", id: target.id });
      focusNodes([target.id]);
    },
    [
      activeLayer,
      ensureExpandedGroups,
      findBestNodeForFile,
      focusNodes,
      setActiveLayer,
      setActiveSimulation,
      setActiveTrace,
      setHighlights,
      setSelectedElement,
    ]
  );

  const handleOpenCitation = useCallback(
    (citation: ChatCitation) => {
      focusFilePath(citation.file_path);
    },
    [focusFilePath]
  );

  const applyAssistantAction = useCallback(
    (action: ArchitectureAssistantAction) => {
      if (action.type === "switch_layer") {
        setActiveLayer(action.layerId);
        return;
      }

      if (action.type === "expand_groups") {
        ensureExpandedGroups(action.layerId, action.groupIds);
        return;
      }

      if (action.type === "focus_nodes") {
        setActiveLayer(action.layerId);
        setActiveTrace(null);
        setActiveSimulation(null);
        setHighlights(action.nodeIds, action.edgeIds, action.dimOthers);
        setSelectedElement(
          action.primaryNodeId ? { type: "node", id: action.primaryNodeId } : null
        );
        focusNodes(action.nodeIds);
        return;
      }

      if (action.type === "trace_path") {
        setActiveLayer(action.layerId);
        setActiveSimulation(null);
        setHighlights(action.nodeIds, action.edgeIds, true);
        setActiveTrace({
          traceId: action.traceId,
          nodeIds: action.nodeIds,
          edgeIds: action.edgeIds,
          layerId: action.layerId,
        });
        focusNodes(action.nodeIds);
        return;
      }

      setActiveLayer(action.layerId);
      setHighlights(action.nodeIds, action.edgeIds, true);
      setActiveTrace(null);
      setActiveSimulation({
        layerId: action.layerId,
        nodeIds: action.nodeIds,
        edgeIds: action.edgeIds,
        steps: action.steps,
        activeStepIndex: 0,
        summary: action.summary,
      });
      setSelectedElement(
        action.nodeIds[0] ? { type: "node", id: action.nodeIds[0] } : null
      );
      focusNodes(action.nodeIds);
    },
    [
      ensureExpandedGroups,
      focusNodes,
      setActiveLayer,
      setActiveSimulation,
      setActiveTrace,
      setHighlights,
      setSelectedElement,
    ]
  );

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

  const expandableGroupIds = useMemo(
    () =>
      (architectureData?.components || [])
        .filter((component) => (component.children?.length || 0) > 0)
        .map((component) => component.id),
    [architectureData]
  );

  const expandAll = useCallback(() => {
    setExpandedGroups(expandableGroupIds);
  }, [expandableGroupIds, setExpandedGroups]);

  const collapseAll = useCallback(() => {
    setExpandedGroups([]);
  }, [setExpandedGroups]);

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
        <Controls showInteractive={false} className="architecture-controls" />
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

        <Panel position="top-left" className="architecture-panel architecture-panel--stacked">
          <div className="architecture-layer-switcher">
            <div className="architecture-layer-switcher__label">
              <Layers3 size={13} />
              Layers
            </div>
            {(["overview", "system", "code"] as ArchitectureLayerId[]).map((layerId) => (
              <button
                key={layerId}
                onClick={() => setActiveLayer(layerId)}
                className={`architecture-layer-switcher__chip ${
                  activeLayer === layerId ? "architecture-layer-switcher__chip--active" : ""
                }`}
              >
                {layerId}
              </button>
            ))}
          </div>

          {activeLayer === "code" && expandableGroupIds.length > 0 && (
            <div className="architecture-panel__actions">
              <button onClick={expandAll}>
                <ChevronDown size={12} />
                Expand all
              </button>
              <button onClick={collapseAll}>
                <ChevronUp size={12} />
                Collapse all
              </button>
            </div>
          )}

          {isAnalyzing && (
            <div className="analyze-status">
              <Loader2 size={16} className="animate-spin" />
              <span>Analyzing codebase...</span>
            </div>
          )}

          {!isAnalyzing && (
            <div className="analyze-info">
              <div className="analyze-info__summary">
                <span className="analyze-info__count">{countSummary(architectureData)}</span>
                <div className="architecture-status-row">
                  <span className={`architecture-status-pill architecture-status-pill--${architectureStatus}`}>
                    {architectureStatus}
                  </span>
                  {isArchitectureStale && (
                    <span className="architecture-status-pill architecture-status-pill--stale">
                      stale
                    </span>
                  )}
                  {analyzedTimeAgo && (
                    <span className="analyze-info__time">
                      <Clock size={11} />
                      {analyzedTimeAgo}
                    </span>
                  )}
                </div>
                {architectureError && <span className="analyze-hint">{architectureError}</span>}
                {activeSimulation && (
                  <span className="analyze-hint">{activeSimulation.summary}</span>
                )}
                {!activeSimulation && activeTrace && (
                  <span className="analyze-hint">Tracing highlighted path on the graph.</span>
                )}
              </div>
              <button
                onClick={handleAnalyze}
                disabled={!apiKey || isAnalyzing}
                className="analyze-refresh-btn"
                title="Refresh architecture"
              >
                {architectureData ? <RefreshCw size={13} /> : <Brain size={13} />}
              </button>
            </div>
          )}

          {!apiKey && <p className="analyze-hint">Set your AI API key to analyze or chat</p>}
        </Panel>
      </ReactFlow>

      <DetailPanel />

      <ArchitectureAssistantFab
        open={assistantOpen}
        onClick={() => setAssistantOpen((value) => !value)}
      />

      <ArchitectureAssistant
        repoFullName={repoFullName}
        apiKey={apiKey}
        layer={activeLayer}
        open={assistantOpen}
        onClose={() => setAssistantOpen(false)}
        onAction={applyAssistantAction}
        onOpenCitation={handleOpenCitation}
        onOpenFilePath={focusFilePath}
      />
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
