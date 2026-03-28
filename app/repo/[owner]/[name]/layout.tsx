"use client";

import { ReactNode, useEffect } from "react";
import { useParams } from "next/navigation";
import { AppShell } from "@/app/components/shell/AppShell";
import { TabBar } from "@/app/components/repo/TabBar";
import { useAppStore } from "@/lib/store/app-store";
import { GitBranch } from "lucide-react";

export default function RepoLayout({ children }: { children: ReactNode }) {
  const params = useParams<{ owner: string; name: string }>();
  const basePath = `/repo/${params.owner}/${params.name}`;
  const setRepos = useAppStore((s) => s.setRepos);

  // Fetch fresh repo data from DB so overview always reflects latest state
  useEffect(() => {
    fetch("/api/repos")
      .then((r) => r.json())
      .then((data) => {
        if (data.repos) setRepos(data.repos);
      })
      .catch(() => {});
  }, [setRepos]);

  return (
    <AppShell>
      <div className="relative z-10 max-w-6xl mx-auto">
        {/* Repo header */}
        <div className="mb-1">
          <div className="flex items-center gap-2 mb-1">
            <GitBranch size={16} className="text-[var(--gray-500)]" />
            <h1 className="font-mono text-lg font-semibold text-[var(--gray-100)] m-0">
              <span className="text-[var(--gray-500)]">{params.owner}/</span>
              {params.name}
            </h1>
          </div>
        </div>

        {/* Tab navigation */}
        <TabBar basePath={basePath} />

        {/* Content */}
        <div className="pt-6">
          {children}
        </div>
      </div>
    </AppShell>
  );
}
