"use client";

import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Layers, ChevronDown, ChevronRight } from "lucide-react";
import { ARCH_TYPE_COLORS, type ArchComponentType } from "@/types/architecture";
import { useGraphStore } from "@/lib/store/graph-store";

export interface GroupNodeData {
  label: string;
  description: string;
  componentType: ArchComponentType;
  childCount: number;
  isExpanded: boolean;
  [key: string]: unknown;
}

function GroupNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as unknown as GroupNodeData;
  const { toggleGroup, setSelectedElement, collapsedNodes, toggleCollapsed } = useGraphStore();
  const color = ARCH_TYPE_COLORS[nodeData.componentType] || "#8B949E";
  const isCollapsed = collapsedNodes.has(id);

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    toggleGroup(id);
    setSelectedElement({ type: "node", id });
  };

  const handleCollapseToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    toggleCollapsed(id);
  };

  return (
    <div
      className={`group-node ${selected ? "group-node--selected" : ""} ${nodeData.isExpanded ? "group-node--expanded" : ""}`}
      style={{
        borderColor: selected ? color : `${color}30`,
        boxShadow: selected ? `0 0 20px ${color}25` : undefined,
        minWidth: nodeData.isExpanded ? 400 : 220,
        minHeight: nodeData.isExpanded ? 200 : undefined,
      }}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="arch-handle"
        style={{ background: color }}
      />

      {/* Header */}
      <div
        className="group-node__header"
        style={{ background: `${color}15`, borderBottomColor: `${color}25` }}
        onClick={handleClick}
      >
        <Layers size={14} style={{ color, flexShrink: 0 }} />
        <span className="group-node__label">{nodeData.label}</span>
        <div className="group-node__header-actions">
          <span className="group-node__child-count" style={{ color }}>
            {nodeData.childCount} items
          </span>
          <button
            className="arch-node__collapse-btn"
            onClick={handleCollapseToggle}
          >
            {isCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
          </button>
        </div>
      </div>

      {/* Body — shown when not collapsed AND not expanded (collapsed = header only, expanded = children rendered inside) */}
      {!isCollapsed && !nodeData.isExpanded && (
        <div className="group-node__body">
          <p className="arch-node__description">{nodeData.description}</p>
          <button className="group-node__expand-btn" onClick={handleClick} style={{ color }}>
            Click to expand · {nodeData.childCount} sub-components
          </button>
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

export const GroupNode = memo(GroupNodeComponent);
