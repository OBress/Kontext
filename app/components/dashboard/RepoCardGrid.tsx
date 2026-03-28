"use client";

import { Repo } from "@/lib/store/app-store";
import { RepoCard3D } from "./RepoCard3D";

interface RepoCardGridProps {
  repos: Repo[];
}

/**
 * Simple grid for use outside the dashboard (e.g. home page constellation fallback).
 * The dashboard uses SortableRepoSection instead.
 */
export function RepoCardGrid({ repos }: RepoCardGridProps) {
  if (repos.length === 0) return null;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
      {repos.map((repo, i) => (
        <div
          key={repo.id}
          className="animate-fade-in-up"
          style={{ animationDelay: `${i * 60}ms`, animationFillMode: "backwards" }}
        >
          <RepoCard3D repo={repo} index={i} />
        </div>
      ))}
    </div>
  );
}
