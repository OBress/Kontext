"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import { useGraphStore } from "@/lib/store/graph-store";

// We have to do this because react-force-graph-3d doesn't support SSR
// and we need to ensure Three.js objects are available
let ForceGraph3DComponent: any = null;

export function GraphScene() {
  const containerRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<any>(null);
  const { graphData, hoveredNode, setHoveredNode, setSelectedNode, filters } =
    useGraphStore();
  const [isReady, setIsReady] = useState(false);

  // Import ForceGraph3D on mount
  useEffect(() => {
    import("react-force-graph-3d").then((mod) => {
      ForceGraph3DComponent = mod.default;
      setIsReady(true);
    });
  }, []);

  // Filter graph data
  const filteredData = (() => {
    const activeTypes = Object.entries(filters.fileTypes)
      .filter(([, v]) => v)
      .map(([k]) => k);

    const filteredNodes = graphData.nodes.filter((node) => {
      if (!activeTypes.includes(node.group)) return false;
      if (filters.searchQuery) {
        return node.path.toLowerCase().includes(filters.searchQuery.toLowerCase());
      }
      return true;
    });

    const nodeIds = new Set(filteredNodes.map((n) => n.id));
    const filteredLinks = graphData.links.filter(
      (l) => nodeIds.has(l.source as string) && nodeIds.has(l.target as string)
    );

    // Apply min connections filter
    if (filters.minConnections > 0) {
      const connectionCount = new Map<string, number>();
      filteredLinks.forEach((l) => {
        connectionCount.set(
          l.source as string,
          (connectionCount.get(l.source as string) || 0) + 1
        );
        connectionCount.set(
          l.target as string,
          (connectionCount.get(l.target as string) || 0) + 1
        );
      });

      const connectedNodes = filteredNodes.filter(
        (n) => (connectionCount.get(n.id) || 0) >= filters.minConnections
      );
      const connectedIds = new Set(connectedNodes.map((n) => n.id));

      return {
        nodes: connectedNodes,
        links: filteredLinks.filter(
          (l) =>
            connectedIds.has(l.source as string) &&
            connectedIds.has(l.target as string)
        ),
      };
    }

    return { nodes: filteredNodes, links: filteredLinks };
  })();

  const handleNodeHover = useCallback(
    (node: any) => {
      setHoveredNode(node?.id || null);
      if (containerRef.current) {
        containerRef.current.style.cursor = node ? "pointer" : "default";
      }
    },
    [setHoveredNode]
  );

  const handleNodeClick = useCallback(
    (node: any) => {
      setSelectedNode(node?.id || null);
      // Fly camera to node
      if (graphRef.current && node) {
        const distance = 60;
        const distRatio =
          1 + distance / Math.hypot(node.x || 0, node.y || 0, node.z || 0);
        graphRef.current.cameraPosition(
          {
            x: (node.x || 0) * distRatio,
            y: (node.y || 0) * distRatio,
            z: (node.z || 0) * distRatio,
          },
          { x: node.x, y: node.y, z: node.z },
          1500
        );
      }
    },
    [setSelectedNode]
  );

  if (!isReady || !ForceGraph3DComponent) {
    return (
      <div className="w-full h-full flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 border border-[var(--alpha-white-10)] rounded-lg animate-spin-slow mx-auto mb-4"
            style={{ borderTopColor: "var(--accent-cyan)" }}
          />
          <p className="font-mono text-sm text-[var(--gray-500)]">Loading 3D engine...</p>
        </div>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="w-full h-full">
      <ForceGraph3DComponent
        ref={graphRef}
        graphData={filteredData}
        nodeId="id"
        nodeLabel=""
        nodeVal="val"
        nodeColor="color"
        nodeOpacity={0.9}
        nodeResolution={12}
        linkSource="source"
        linkTarget="target"
        linkColor={() => "rgba(255,255,255,0.08)"}
        linkWidth={0.5}
        linkDirectionalParticles={2}
        linkDirectionalParticleWidth={1}
        linkDirectionalParticleSpeed={0.005}
        linkDirectionalParticleColor={() => "rgba(0,229,255,0.4)"}
        linkDirectionalArrowLength={3}
        linkDirectionalArrowRelPos={1}
        linkDirectionalArrowColor={() => "rgba(255,255,255,0.15)"}
        backgroundColor="rgba(0,0,0,0)"
        onNodeHover={handleNodeHover}
        onNodeClick={handleNodeClick}
        enableNavigationControls={true}
        showNavInfo={false}
        warmupTicks={50}
        cooldownTicks={100}
      />
    </div>
  );
}
