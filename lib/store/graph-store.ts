"use client";

import { create } from "zustand";
import type { ArchitectureAnalysis } from "@/types/architecture";

export interface GraphNode {
  id: string;
  name: string;
  path: string;
  extension: string;
  lineCount: number;
  imports: string[];
  exportedBy: string[];
  group: string; // file type group
  color: string;
  val: number; // node size
}

export interface GraphLink {
  source: string;
  target: string;
  value: number; // import count
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

  // Architecture-specific state
  architectureData: ArchitectureAnalysis | null;
  setArchitectureData: (data: ArchitectureAnalysis | null) => void;

  expandedGroups: Set<string>;
  toggleGroup: (id: string) => void;

  selectedElement: SelectedElement | null;
  setSelectedElement: (el: SelectedElement | null) => void;

  isAnalyzing: boolean;
  setIsAnalyzing: (v: boolean) => void;

  analyzedAt: string | null;
  setAnalyzedAt: (v: string | null) => void;

  collapsedNodes: Set<string>;
  toggleCollapsed: (id: string) => void;
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

  // Architecture state
  architectureData: null,
  setArchitectureData: (data) => set({ architectureData: data }),

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
}));
