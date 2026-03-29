"use client";

import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import {
  Globe,
  Server,
  Cog,
  Zap,
  Database,
  Settings,
  Package,
  Cloud,
  ChevronDown,
  ChevronRight,
  FileCode,
} from "lucide-react";
import { ARCH_TYPE_COLORS, type ArchComponentType } from "@/types/architecture";
import { useGraphStore } from "@/lib/store/graph-store";

const TYPE_ICON_MAP: Record<ArchComponentType, typeof Globe> = {
  page: Globe,
  api: Server,
  service: Cog,
  worker: Zap,
  database: Database,
  config: Settings,
  shared: Package,
  external: Cloud,
};

export interface ArchNodeData {
  label: string;
  description: string;
  componentType: ArchComponentType;
  files: string[];
  hasChildren: boolean;
  isExpanded: boolean;
  fileCount: number;
  [key: string]: unknown;
}

function ArchitectureNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as unknown as ArchNodeData;
  const {
    collapsedNodes,
    toggleCollapsed,
    setSelectedElement,
    toggleGroup,
    highlightedNodeIds,
    dimUnfocused,
    activeSimulation,
  } = useGraphStore();
  const isCollapsed = collapsedNodes.has(id);
  const color = ARCH_TYPE_COLORS[nodeData.componentType] || "#8B949E";
  const Icon = TYPE_ICON_MAP[nodeData.componentType] || Package;
  const isHighlighted = highlightedNodeIds.includes(id);
  const isSimulationActive =
    activeSimulation?.steps[activeSimulation.activeStepIndex]?.kind === "node" &&
    activeSimulation.steps[activeSimulation.activeStepIndex]?.refId === id;
  const isDimmed = dimUnfocused && highlightedNodeIds.length > 0 && !isHighlighted;

  const handleHeaderClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (nodeData.hasChildren) {
      toggleGroup(id);
    }
    setSelectedElement({ type: "node", id });
  };

  const handleCollapseToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    toggleCollapsed(id);
  };

  return (
    <div
      className={`arch-node ${selected ? "arch-node--selected" : ""} ${
        isHighlighted || isSimulationActive ? "arch-node--highlighted" : ""
      }`}
      style={{
        borderColor:
          selected || isHighlighted || isSimulationActive ? color : "var(--alpha-white-10)",
        boxShadow:
          selected || isHighlighted || isSimulationActive ? `0 0 20px ${color}30` : undefined,
        opacity: isDimmed ? 0.28 : 1,
      }}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="arch-handle"
        style={{ background: color }}
      />

      <div
        className="arch-node__header"
        style={{ background: `${color}20`, borderBottomColor: `${color}30` }}
        onClick={handleHeaderClick}
      >
        <Icon size={14} style={{ color, flexShrink: 0 }} />
        <span className="arch-node__label">{nodeData.label}</span>
        <div className="arch-node__header-actions">
          {nodeData.hasChildren && (
            <span className="arch-node__expand-hint" style={{ color }}>
              {nodeData.isExpanded ? "▼" : "▶"}
            </span>
          )}
          <button
            className="arch-node__collapse-btn"
            onClick={handleCollapseToggle}
            title={isCollapsed ? "Expand" : "Collapse"}
          >
            {isCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
          </button>
        </div>
      </div>

      {!isCollapsed && (
        <div className="arch-node__body">
          <p className="arch-node__description">{nodeData.description}</p>

          {nodeData.files.length > 0 && (
            <div className="arch-node__files">
              {nodeData.files.slice(0, 3).map((file) => (
                <div key={file} className="arch-node__file">
                  <FileCode size={10} className="arch-node__file-icon" />
                  <span>{file.split("/").pop()}</span>
                </div>
              ))}
              {nodeData.files.length > 3 && (
                <span className="arch-node__file-more">
                  + {nodeData.files.length - 3} more files
                </span>
              )}
            </div>
          )}

          <div className="arch-node__stats">
            <span
              className="arch-node__stat-badge"
              style={{ color, borderColor: `${color}40` }}
            >
              {nodeData.componentType}
            </span>
            <span className="arch-node__stat-count">{nodeData.fileCount} files</span>
          </div>
        </div>
      )}

      <Handle
        type="source"
        position={Position.Right}
        className="arch-handle"
        style={{ background: color }}
      />
    </div>
  );
}

export const ArchitectureNode = memo(ArchitectureNodeComponent);
