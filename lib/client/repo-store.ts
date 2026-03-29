import type { Repo } from "@/lib/store/app-store";

export async function fetchRepoSnapshot(
  repoFullName: string
): Promise<Repo | null> {
  try {
    const res = await fetch(`/api/repos?repo=${encodeURIComponent(repoFullName)}`, {
      cache: "no-store",
    });

    if (!res.ok) {
      return null;
    }

    const data = (await res.json()) as { repo?: Repo };
    return data.repo || null;
  } catch {
    return null;
  }
}
