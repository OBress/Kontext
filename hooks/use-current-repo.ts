"use client";

import { useMemo } from "react";
import { usePathname } from "next/navigation";
import { useAppStore, Repo } from "@/lib/store/app-store";

/**
 * Derives the current repo from the URL pathname (/repo/owner/name/...)
 * and matches it against the repos array in the store.
 * Returns null when not on a repo page.
 */
export function useCurrentRepo(): Repo | null {
  const pathname = usePathname();
  const repos = useAppStore((s) => s.repos);

  return useMemo(() => {
    const match = pathname.match(/^\/repo\/([^/]+)\/([^/]+)/);
    if (!match) return null;
    const fullName = `${match[1]}/${match[2]}`;
    return repos.find((r) => r.full_name === fullName) || null;
  }, [pathname, repos]);
}
