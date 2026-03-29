"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  useReactFlow,
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
import {
  getArchitectureView,
  type ArchitectureBundle,
  type ArchitectureLayerId,
  type ArchitectureView,
  type ArchComponent,
} from "@/types/architecture";
import {
  Brain,
  Loader2,
  RefreshCw,
  Clock,
  Layers3,
  MessageCircleMore,
  Send,
  X,
  Sparkles,
} from "lucide-react";
import { useAppStore } from "@/lib/store/app-store";

const nodeTypes: NodeTypes = {
  architecture: ArchitectureNode,
  group: GroupNode,
};

const edgeTypes: EdgeTypes = {
  architecture: ArchitectureEdge,
};

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

interface AssistantMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
}

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

  return {
    nodes: nodes.map((node) => {
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
    let totalFiles = component.files.length;
    if (component.children) {
      for (const child of component.children) {
        totalFiles += child.files.length;
      }
    }

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
          width: 500,
          height: 300 + component.children!.length * 100,
        },
      });

      component.children!.forEach((child: ArchComponent, index: number) => {
        nodes.push({
          id: child.id,
          type: "architecture",
          position: { x: 20, y: 60 + index * 120 },
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
      const nodeType = hasChildren ? "group" : "architecture";
      nodes.push({
        id: component.id,
        type: nodeType,
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
              fileCount: totalFiles,
            },
      });
    }
  }

  for (const connection of view.connections) {
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

interface ArchitectureAssistantProps {
  repoFullName: string;
  apiKey: string | null;
  layer: ArchitectureLayerId;
  open: boolean;
  onClose: () => void;
  onAction: (action: AssistantAction) => void;
}

function ArchitectureAssistant({
  repoFullName,
  apiKey,
  layer,
  open,
  onClose,
  onAction,
}: ArchitectureAssistantProps) {
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isStreaming]);

  const sendPrompt = useCallback(
    async (prompt: string) => {
      if (!apiKey || !prompt.trim() || isStreaming) return;

      setMessages((prev) => [
        ...prev,
        { id: `user-${Date.now()}`, role: "user", content: prompt.trim() },
      ]);
      setInput("");
      setIsStreaming(true);

      let assistantContent = "";
      const assistantId = `assistant-${Date.now()}`;
      setMessages((prev) => [...prev, { id: assistantId, role: "assistant", content: "" }]);

      try {
        const res = await fetch("/api/graph/assistant", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-google-api-key": apiKey,
          },
          body: JSON.stringify({
            repo_full_name: repoFullName,
            message: prompt.trim(),
            layer,
          }),
        });

        if (!res.ok || !res.body) {
          throw new Error("Assistant request failed");
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            const dataLine = line.replace(/^data: /, "").trim();
            if (!dataLine) continue;

            const payload = JSON.parse(dataLine) as
              | { type: "action"; action: AssistantAction }
              | { type: "text"; content: string }
              | { type: "done" };

            if (payload.type === "action") {
              onAction(payload.action);
            }

            if (payload.type === "text") {
              assistantContent += payload.content;
              setMessages((prev) =>
                prev.map((message) =>
                  message.id === assistantId
                    ? { ...message, content: assistantContent }
                    : message
                )
              );
            }
          }
        }
      } catch (error: unknown) {
        const messageText =
          error instanceof Error ? error.message : "Assistant request failed";
        setMessages((prev) =>
          prev.map((message) =>
            message.id === assistantId
              ? { ...message, content: messageText }
              : message
          )
        );
      } finally {
        setIsStreaming(false);
      }
    },
    [apiKey, isStreaming, layer, onAction, repoFullName]
  );

  if (!open) return null;

  return (
    <div className="architecture-assistant">
      <div className="architecture-assistant__header">
        <div>
          <div className="architecture-assistant__eyebrow">Architecture Assistant</div>
          <div className="architecture-assistant__title">Graph-aware chat</div>
        </div>
        <button onClick={onClose} className="architecture-assistant__close">
          <X size={16} />
        </button>
      </div>

      <div className="architecture-assistant__messages">
        {messages.length === 0 && (
          <div className="architecture-assistant__empty">
            <Sparkles size={16} />
            <p>Ask about the flow, highlight a subsystem, or trace a request path.</p>
            <div className="architecture-assistant__suggestions">
              {[
                "Explain the project architecture",
                "Where is the user sending chat messages?",
                "Trace the sync flow",
              ].map((suggestion) => (
                <button
                  key={suggestion}
                  onClick={() => void sendPrompt(suggestion)}
                  className="architecture-assistant__suggestion"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((message) => (
          <div
            key={message.id}
            className={`architecture-assistant__message architecture-assistant__message--${message.role}`}
          >
            {message.content || (message.role === "assistant" && isStreaming ? "Thinking..." : "")}
          </div>
        ))}
        <div ref={endRef} />
      </div>

      <div className="architecture-assistant__composer">
        <textarea
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder={apiKey ? "Ask the architecture assistant..." : "Set your AI key to use the assistant"}
          disabled={!apiKey || isStreaming}
          rows={1}
        />
        <button
          onClick={() => void sendPrompt(input)}
          disabled={!apiKey || !input.trim() || isStreaming}
          className="architecture-assistant__send"
        >
          {isStreaming ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
        </button>
      </div>
    </div>
  );
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
    setActiveTrace,
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
            duration: 450,
            padding: 0.24,
          });
        }
      }, 120);
    },
    [reactFlow]
  );

  const applyAssistantAction = useCallback(
    (action: AssistantAction) => {
      if (action.type === "switch_layer") {
        setActiveLayer(action.layerId);
        return;
      }

      if (action.type === "focus_nodes") {
        setActiveLayer(action.layerId);
        setHighlights(action.nodeIds, action.edgeIds, action.dimOthers);
        setSelectedElement(
          action.primaryNodeId ? { type: "node", id: action.primaryNodeId } : null
        );
        focusNodes(action.nodeIds);
        return;
      }

      if (action.type === "trace_path") {
        setActiveLayer(action.layerId);
        setHighlights(action.nodeIds, action.edgeIds, true);
        setActiveTrace({
          traceId: action.traceId,
          nodeIds: action.nodeIds,
          edgeIds: action.edgeIds,
          layerId: action.layerId,
        });
        focusNodes(action.nodeIds);
      }
    },
    [focusNodes, setActiveLayer, setActiveTrace, setHighlights, setSelectedElement]
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

          {isAnalyzing && (
            <div className="analyze-status">
              <Loader2 size={16} className="animate-spin" />
              <span>Analyzing codebase...</span>
            </div>
          )}

          {!isAnalyzing && (
            <div className="analyze-info">
              <div className="analyze-info__summary">
                <span className="analyze-info__count">
                  {architectureData
                    ? `${architectureData.components.length} components · ${architectureData.connections.length} connections`
                    : "Architecture bundle not ready yet"}
                </span>
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
                {architectureError && (
                  <span className="analyze-hint">{architectureError}</span>
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

      <button
        className="architecture-assistant-fab"
        onClick={() => setAssistantOpen((value) => !value)}
        title="Open architecture assistant"
      >
        {assistantOpen ? <X size={18} /> : <MessageCircleMore size={18} />}
      </button>

      <ArchitectureAssistant
        repoFullName={repoFullName}
        apiKey={apiKey}
        layer={activeLayer}
        open={assistantOpen}
        onClose={() => setAssistantOpen(false)}
        onAction={applyAssistantAction}
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
