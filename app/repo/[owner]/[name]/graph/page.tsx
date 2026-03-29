"use client";

import { useParams } from "next/navigation";
import dynamic from "next/dynamic";

const ArchitectureCanvas = dynamic(
  () => import("@/app/components/graph/ArchitectureCanvas").then((m) => m.ArchitectureCanvas),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full w-full items-center justify-center">
        <div className="text-center">
          <div
            className="mx-auto mb-4 h-16 w-16 animate-spin-slow rounded-lg border border-[var(--alpha-white-10)]"
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
      className="relative w-full overflow-hidden rounded-xl border border-[var(--alpha-white-5)] shadow-[0_24px_80px_rgba(0,0,0,0.24)]"
      style={{
        height: "calc(100vh - 168px)",
        minHeight: 620,
        background: "radial-gradient(ellipse at center, #0A0A14 0%, #000000 70%)",
      }}
    >
      <ArchitectureCanvas repoFullName={repoFullName} />
    </div>
  );
}
