"use client";

import { create } from "zustand";
import type {
  ArchitectureBundle,
  ArchitectureLayerId,
  ArchitectureStatus,
  ArchitectureView,
} from "@/types/architecture";

export interface GraphNode {
  id: string;
  name: string;
  path: string;
  extension: string;
  lineCount: number;
  imports: string[];
  exportedBy: string[];
  group: string;
  color: string;
  val: number;
}

export interface GraphLink {
  source: string;
  target: string;
  value: number;
}

export type GraphLayout = "force" | "radial" | "tree" | "dag";

export interface GraphFilters {
  fileTypes: Record<string, boolean>;
  minConnections: number;
  searchQuery: string;
}

interface SelectedElement {
  type: "node" | "edge";
  id: string;
}

interface ActiveTrace {
  traceId: string | null;
  nodeIds: string[];
  edgeIds: string[];
  layerId: ArchitectureLayerId;
}

interface GraphState {
  graphData: { nodes: GraphNode[]; links: GraphLink[] };
  setGraphData: (data: { nodes: GraphNode[]; links: GraphLink[] }) => void;

  selectedNode: string | null;
  setSelectedNode: (nodeId: string | null) => void;

  hoveredNode: string | null;
  setHoveredNode: (nodeId: string | null) => void;

  layout: GraphLayout;
  setLayout: (layout: GraphLayout) => void;

  filters: GraphFilters;
  setFilters: (filters: Partial<GraphFilters>) => void;

  isFullscreen: boolean;
  setIsFullscreen: (fullscreen: boolean) => void;

  architectureData: ArchitectureView | null;
  setArchitectureData: (data: ArchitectureView | null) => void;

  architectureBundle: ArchitectureBundle | null;
  setArchitectureBundle: (bundle: ArchitectureBundle | null) => void;

  activeLayer: ArchitectureLayerId;
  setActiveLayer: (layer: ArchitectureLayerId) => void;

  architectureStatus: ArchitectureStatus;
  setArchitectureStatus: (status: ArchitectureStatus) => void;

  architectureForSha: string | null;
  setArchitectureForSha: (value: string | null) => void;

  architectureError: string | null;
  setArchitectureError: (value: string | null) => void;

  isArchitectureStale: boolean;
  setIsArchitectureStale: (value: boolean) => void;

  expandedGroups: Set<string>;
  toggleGroup: (id: string) => void;
  setExpandedGroups: (ids: string[]) => void;

  selectedElement: SelectedElement | null;
  setSelectedElement: (el: SelectedElement | null) => void;

  isAnalyzing: boolean;
  setIsAnalyzing: (v: boolean) => void;

  analyzedAt: string | null;
  setAnalyzedAt: (v: string | null) => void;

  collapsedNodes: Set<string>;
  toggleCollapsed: (id: string) => void;
  setCollapsedNodes: (ids: string[]) => void;

  highlightedNodeIds: string[];
  highlightedEdgeIds: string[];
  dimUnfocused: boolean;
  setHighlights: (nodeIds: string[], edgeIds: string[], dimUnfocused?: boolean) => void;
  clearHighlights: () => void;

  activeTrace: ActiveTrace | null;
  setActiveTrace: (trace: ActiveTrace | null) => void;
}

const defaultFilters: GraphFilters = {
  fileTypes: {
    ts: true,
    js: true,
    css: true,
    json: true,
    md: true,
    config: true,
    other: true,
  },
  minConnections: 0,
  searchQuery: "",
};

export const useGraphStore = create<GraphState>((set) => ({
  graphData: { nodes: [], links: [] },
  setGraphData: (data) => set({ graphData: data }),

  selectedNode: null,
  setSelectedNode: (nodeId) => set({ selectedNode: nodeId }),

  hoveredNode: null,
  setHoveredNode: (nodeId) => set({ hoveredNode: nodeId }),

  layout: "force",
  setLayout: (layout) => set({ layout }),

  filters: defaultFilters,
  setFilters: (partial) =>
    set((state) => ({ filters: { ...state.filters, ...partial } })),

  isFullscreen: false,
  setIsFullscreen: (fullscreen) => set({ isFullscreen: fullscreen }),

  architectureData: null,
  setArchitectureData: (data) => set({ architectureData: data }),

  architectureBundle: null,
  setArchitectureBundle: (bundle) => set({ architectureBundle: bundle }),

  activeLayer: "system",
  setActiveLayer: (layer) => set({ activeLayer: layer }),

  architectureStatus: "missing",
  setArchitectureStatus: (status) => set({ architectureStatus: status }),

  architectureForSha: null,
  setArchitectureForSha: (value) => set({ architectureForSha: value }),

  architectureError: null,
  setArchitectureError: (value) => set({ architectureError: value }),

  isArchitectureStale: false,
  setIsArchitectureStale: (value) => set({ isArchitectureStale: value }),

  expandedGroups: new Set<string>(),
  toggleGroup: (id) =>
    set((state) => {
      const next = new Set(state.expandedGroups);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return { expandedGroups: next };
    }),
  setExpandedGroups: (ids) => set({ expandedGroups: new Set(ids) }),

  selectedElement: null,
  setSelectedElement: (el) => set({ selectedElement: el }),

  isAnalyzing: false,
  setIsAnalyzing: (v) => set({ isAnalyzing: v }),

  analyzedAt: null,
  setAnalyzedAt: (v) => set({ analyzedAt: v }),

  collapsedNodes: new Set<string>(),
  toggleCollapsed: (id) =>
    set((state) => {
      const next = new Set(state.collapsedNodes);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return { collapsedNodes: next };
    }),
  setCollapsedNodes: (ids) => set({ collapsedNodes: new Set(ids) }),

  highlightedNodeIds: [],
  highlightedEdgeIds: [],
  dimUnfocused: false,
  setHighlights: (nodeIds, edgeIds, dimUnfocused = true) =>
    set({
      highlightedNodeIds: nodeIds,
      highlightedEdgeIds: edgeIds,
      dimUnfocused,
    }),
  clearHighlights: () =>
    set({
      highlightedNodeIds: [],
      highlightedEdgeIds: [],
      dimUnfocused: false,
      activeTrace: null,
    }),

  activeTrace: null,
  setActiveTrace: (trace) => set({ activeTrace: trace }),
}));
