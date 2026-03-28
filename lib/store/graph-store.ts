"use client";

import { create } from "zustand";

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
}));
