"use client";

import { ReactNode, useEffect } from "react";
import { useParams, usePathname } from "next/navigation";
import { AppShell } from "@/app/components/shell/AppShell";
import { TabBar } from "@/app/components/repo/TabBar";
import { useAppStore } from "@/lib/store/app-store";
import { GitBranch } from "lucide-react";

export default function RepoLayout({ children }: { children: ReactNode }) {
  const params = useParams<{ owner: string; name: string }>();
  const pathname = usePathname();
  const basePath = `/repo/${params.owner}/${params.name}`;
  const setRepos = useAppStore((s) => s.setRepos);
  const isChatRoute = pathname.endsWith("/chat");

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
      <div className={isChatRoute ? "relative z-10 px-4" : "relative z-10 max-w-6xl mx-auto"}>
        {/* Repo header + Tab navigation — single row */}
        <div className="flex items-center gap-4 border-b border-[var(--alpha-white-5)]">
          <div className="flex items-center gap-2 shrink-0 pr-2">
            <GitBranch size={16} className="text-[var(--gray-500)]" />
            <h1 className="font-mono text-lg font-semibold text-[var(--gray-100)] m-0 whitespace-nowrap">
              <span className="text-[var(--gray-500)]">{params.owner}/</span>
              {params.name}
            </h1>
          </div>

          <div className="w-px h-5 bg-[var(--alpha-white-10)] shrink-0" />
          <TabBar basePath={basePath} />
        </div>

        {/* Content */}
        <div className={isChatRoute ? "pt-4 overflow-hidden" : "pt-4"}>
          {children}
        </div>
      </div>
    </AppShell>
  );
}
