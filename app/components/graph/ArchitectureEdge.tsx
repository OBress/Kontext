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
  const {
    setSelectedElement,
    selectedElement,
    highlightedEdgeIds,
    dimUnfocused,
    activeTrace,
    activeSimulation,
  } = useGraphStore();

  const color =
    CONNECTION_TYPE_COLORS[edgeData?.connectionType || "import"] || "#8B949E";
  const isHighlighted = highlightedEdgeIds.includes(id);
  const isTracing = activeTrace?.edgeIds.includes(id) || false;
  const isSimulationEdge =
    activeSimulation?.steps[activeSimulation.activeStepIndex]?.kind === "edge" &&
    activeSimulation.steps[activeSimulation.activeStepIndex]?.refId === id;
  const isActive = selected || selectedElement?.id === id || isHighlighted;
  const isDimmed = dimUnfocused && highlightedEdgeIds.length > 0 && !isHighlighted;

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
      <path id={`trace-path-${id}`} d={edgePath} fill="none" stroke="transparent" />
      <BaseEdge
        id={id}
        path={edgePath}
        style={{
          stroke: isActive ? color : `${color}60`,
          strokeWidth: isActive ? 2.8 : 1.5,
          strokeDasharray: isTracing ? "10 6" : isActive ? undefined : "6 3",
          opacity: isDimmed ? 0.18 : 1,
          transition: "stroke 0.2s, stroke-width 0.2s, opacity 0.2s",
          cursor: "pointer",
        }}
        interactionWidth={20}
      />

      {(isTracing || isSimulationEdge) && (
        <>
          <circle r="3.5" fill={color} className="arch-trace-dot">
            <animateMotion
              dur={isSimulationEdge ? "1.2s" : "2.4s"}
              repeatCount="indefinite"
              path={edgePath}
            />
          </circle>
          {!isSimulationEdge && (
            <circle r="2.5" fill={color} opacity="0.65" className="arch-trace-dot">
              <animateMotion dur="2.4s" repeatCount="indefinite" begin="1.1s" path={edgePath} />
            </circle>
          )}
        </>
      )}

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
              opacity: isDimmed ? 0.2 : 1,
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
