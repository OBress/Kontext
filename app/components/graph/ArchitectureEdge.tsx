"use client";

import { memo } from "react";
import {
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  type EdgeProps,
} from "@xyflow/react";
import { useGraphStore } from "@/lib/store/graph-store";

const CONNECTION_TYPE_COLORS: Record<string, string> = {
  api_call: "#58A6FF",
  import: "#8B949E",
  webhook: "#F0883E",
  database_query: "#FF7B72",
  auth: "#BC8CFF",
  event: "#3FB950",
};

export interface ArchEdgeData {
  label: string;
  description: string;
  connectionType: string;
  [key: string]: unknown;
}

function ArchitectureEdgeComponent({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  selected,
}: EdgeProps) {
  const edgeData = data as unknown as ArchEdgeData;
  const { setSelectedElement, selectedElement } = useGraphStore();
  const isActive = selected || selectedElement?.id === id;
  const color = CONNECTION_TYPE_COLORS[edgeData?.connectionType || "import"] || "#8B949E";

  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    borderRadius: 16,
  });

  const handleClick = () => {
    setSelectedElement({ type: "edge", id });
  };

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        style={{
          stroke: isActive ? color : `${color}60`,
          strokeWidth: isActive ? 2.5 : 1.5,
          strokeDasharray: isActive ? undefined : "6 3",
          transition: "stroke 0.2s, stroke-width 0.2s",
          cursor: "pointer",
        }}
        interactionWidth={20}
      />
      {edgeData?.label && (
        <EdgeLabelRenderer>
          <div
            className="arch-edge-label"
            style={{
              position: "absolute",
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
              pointerEvents: "all",
              background: isActive ? color : "var(--surface-1)",
              color: isActive ? "#000" : "var(--gray-400)",
              borderColor: isActive ? color : `${color}40`,
            }}
            onClick={handleClick}
          >
            {edgeData.label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

export const ArchitectureEdge = memo(ArchitectureEdgeComponent);
