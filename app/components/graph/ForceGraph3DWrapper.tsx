"use client";

import dynamic from "next/dynamic";

const GraphScene = dynamic(
  () => import("./GraphScene").then((m) => m.GraphScene),
  {
    ssr: false,
    loading: () => (
      <div className="w-full h-full flex items-center justify-center">
        <div className="text-center">
          <div
            className="w-16 h-16 border border-[var(--alpha-white-10)] rounded-lg animate-spin-slow mx-auto mb-4"
            style={{ borderTopColor: "var(--accent-cyan)" }}
          />
          <p className="font-mono text-sm text-[var(--gray-500)]">
            Initializing graph engine...
          </p>
        </div>
      </div>
    ),
  }
);

export function ForceGraph3DWrapper() {
  return (
    <div className="w-full h-full">
      <GraphScene />
    </div>
  );
}
