"use client";

import { useEffect } from "react";
import { useParams } from "next/navigation";
import { useGraphStore } from "@/lib/store/graph-store";
import { ForceGraph3DWrapper } from "@/app/components/graph/ForceGraph3DWrapper";
import { GraphControls } from "@/app/components/graph/GraphControls";
import { GraphLegend } from "@/app/components/graph/GraphLegend";
import dynamic from "next/dynamic";

const ParticleField = dynamic(
  () => import("@/app/components/shared/ParticleField").then((m) => m.ParticleField),
  { ssr: false }
);

export default function GraphPage() {
  const { setGraphData, graphData, isFullscreen } = useGraphStore();
  const params = useParams<{ owner: string; name: string }>();
  const repoFullName = `${params.owner}/${params.name}`;

  useEffect(() => {
    if (graphData.nodes.length === 0) {
      fetch(`/api/graph?repo=${encodeURIComponent(repoFullName)}`)
        .then((r) => r.json())
        .then((data) => {
          if (data.nodes) setGraphData(data);
        })
        .catch(() => {});
    }
  }, [graphData.nodes.length, setGraphData, repoFullName]);

  return (
    <div
      className={`relative ${
        isFullscreen
          ? "fixed inset-0 z-50 bg-[var(--surface-0)]"
          : "rounded-xl overflow-hidden border border-[var(--alpha-white-5)]"
      }`}
      style={{
        height: isFullscreen ? "100vh" : "calc(100vh - 200px)",
        minHeight: 500,
        background: "radial-gradient(ellipse at center, #0A0A14 0%, #000000 70%)",
      }}
    >
      <ParticleField />
      <ForceGraph3DWrapper />
      <GraphControls />
      <GraphLegend />
      
      {/* Node count overlay */}
      <div className="absolute top-4 left-4 z-20">
        <div className="glass-strong rounded-lg px-3 py-2">
          <span className="font-mono text-[11px] text-[var(--gray-400)]">
            {graphData.nodes.length} files · {graphData.links.length} connections
          </span>
        </div>
      </div>
    </div>
  );
}
