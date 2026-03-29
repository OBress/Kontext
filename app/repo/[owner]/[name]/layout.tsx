"use client";

import { ReactNode, useEffect, useMemo } from "react";
import { useParams, usePathname } from "next/navigation";
import { GitBranch } from "lucide-react";
import { TabBar } from "@/app/components/repo/TabBar";
import { AppShell } from "@/app/components/shell/AppShell";
import { fetchRepoSnapshot } from "@/lib/client/repo-store";
import { useAppStore } from "@/lib/store/app-store";

export default function RepoLayout({ children }: { children: ReactNode }) {
  const params = useParams<{ owner: string; name: string }>();
  const pathname = usePathname();
  const basePath = `/repo/${params.owner}/${params.name}`;
  const fullName = `${params.owner}/${params.name}`;
  const repoJobs = useAppStore((s) => s.repoJobs);
  const setRepos = useAppStore((s) => s.setRepos);
  const updateRepo = useAppStore((s) => s.updateRepo);
  const isChatRoute = pathname.endsWith("/chat");
  const isGraphRoute = pathname.endsWith("/graph");
  const contentClassName = isChatRoute
    ? "w-full overflow-hidden"
    : isGraphRoute
      ? "mx-auto w-full max-w-[1600px]"
      : "mx-auto w-full max-w-6xl";

  // Fetch fresh repo data from DB so overview always reflects latest state.
  useEffect(() => {
    fetch("/api/repos")
      .then((r) => r.json())
      .then((data) => {
        if (data.repos) setRepos(data.repos);
      })
      .catch(() => {});
  }, [setRepos]);

  const latestSyncJob = useMemo(() => {
    return Object.values(repoJobs)
      .filter((job) => job.repoFullName === fullName && job.jobType === "sync")
      .sort(
        (left, right) =>
          new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime()
      )[0];
  }, [fullName, repoJobs]);

  const latestSyncJobSignature = latestSyncJob
    ? `${latestSyncJob.id}:${latestSyncJob.status}:${latestSyncJob.updatedAt}`
    : "none";
  const latestSyncJobStatus = latestSyncJob?.status || null;

  useEffect(() => {
    if (
      !latestSyncJobStatus ||
      latestSyncJobStatus === "queued" ||
      latestSyncJobStatus === "running"
    ) {
      return;
    }

    let cancelled = false;

    void fetchRepoSnapshot(fullName).then((repo) => {
      if (!cancelled && repo) {
        updateRepo(fullName, repo);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [fullName, latestSyncJobSignature, latestSyncJobStatus, updateRepo]);

  return (
    <AppShell>
      <div className="relative z-10">
        <div className="mx-auto w-full max-w-6xl">
          {/* Repo header + tab navigation stay on a stable centered track. */}
          <div className="flex items-center gap-4 border-b border-[var(--alpha-white-5)]">
            <div className="flex shrink-0 items-center gap-2 pr-2">
              <GitBranch size={16} className="text-[var(--gray-500)]" />
              <h1 className="m-0 whitespace-nowrap font-mono text-lg font-semibold text-[var(--gray-100)]">
                <span className="text-[var(--gray-500)]">{params.owner}/</span>
                {params.name}
              </h1>
            </div>

            <div className="h-5 w-px shrink-0 bg-[var(--alpha-white-10)]" />
            <TabBar basePath={basePath} />
          </div>
        </div>

        <div className={`pt-4 ${contentClassName}`}>{children}</div>
      </div>
    </AppShell>
  );
}
