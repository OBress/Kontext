"use client";

import { useParams } from "next/navigation";
import dynamic from "next/dynamic";

const ArchitectureCanvas = dynamic(
  () => import("@/app/components/graph/ArchitectureCanvas").then((m) => m.ArchitectureCanvas),
  {
    ssr: false,
    loading: () => (
      <div className="w-full h-full flex items-center justify-center">
        <div className="text-center">
          <div
            className="w-16 h-16 border border-[var(--alpha-white-10)] rounded-lg animate-spin-slow mx-auto mb-4"
            style={{ borderTopColor: "var(--accent-green)" }}
          />
          <p className="font-mono text-sm text-[var(--gray-500)]">
            Loading architecture viewer...
          </p>
        </div>
      </div>
    ),
  }
);

export default function GraphPage() {
  const params = useParams<{ owner: string; name: string }>();
  const repoFullName = `${params.owner}/${params.name}`;

  return (
    <div
      className="relative rounded-xl overflow-hidden border border-[var(--alpha-white-5)]"
      style={{
        height: "calc(100vh - 200px)",
        minHeight: 500,
        background: "radial-gradient(ellipse at center, #0A0A14 0%, #000000 70%)",
      }}
    >
      <ArchitectureCanvas repoFullName={repoFullName} />
    </div>
  );
}
