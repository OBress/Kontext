import { githubError } from "./errors";

const GITHUB_API = "https://api.github.com";

const SKIP_DIRS = new Set([
  "node_modules", ".git", "dist", "build", ".next", "__pycache__",
  "vendor", ".venv", "venv", "env", ".env", "coverage", ".cache",
  ".turbo", ".vercel", ".output", "target", "out",
]);

const BINARY_EXTENSIONS = new Set([
  "png", "jpg", "jpeg", "gif", "ico", "svg", "bmp", "webp",
  "woff", "woff2", "ttf", "eot", "otf",
  "mp3", "mp4", "avi", "mov", "webm",
  "zip", "tar", "gz", "rar", "7z",
  "pdf", "doc", "docx", "xls", "xlsx",
  "exe", "dll", "so", "dylib", "bin",
  "lock", "lockb",
]);

const MAX_FILE_SIZE = 100_000; // 100KB

function headers(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github.v3+json",
    "User-Agent": "Kontext-App",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

export interface GitHubRepo {
  id: number;
  full_name: string;
  name: string;
  owner: { login: string };
  description: string | null;
  language: string | null;
  stargazers_count: number;
  forks_count: number;
  default_branch: string;
  updated_at: string;
  private: boolean;
}

export interface GitHubTreeItem {
  path: string;
  type: "blob" | "tree";
  size?: number;
  sha: string;
}

export async function fetchUserRepos(
  token: string,
  page = 1,
  perPage = 100
): Promise<GitHubRepo[]> {
  const res = await fetch(
    `${GITHUB_API}/user/repos?sort=updated&per_page=${perPage}&page=${page}&type=all`,
    { headers: headers(token) }
  );

  if (!res.ok) {
    if (res.status === 401) throw githubError("GitHub token expired. Please re-authenticate.");
    throw githubError(`GitHub API error: ${res.status} ${res.statusText}`);
  }

  return res.json();
}

export async function fetchRepoTree(
  token: string,
  owner: string,
  name: string,
  branch = "main"
): Promise<GitHubTreeItem[]> {
  // Try the specified branch, fall back to 'master'
  let res = await fetch(
    `${GITHUB_API}/repos/${owner}/${name}/git/trees/${branch}?recursive=1`,
    { headers: headers(token) }
  );

  if (res.status === 404 && branch === "main") {
    res = await fetch(
      `${GITHUB_API}/repos/${owner}/${name}/git/trees/master?recursive=1`,
      { headers: headers(token) }
    );
  }

  if (!res.ok) {
    throw githubError(`Failed to fetch repo tree: ${res.status}`);
  }

  const data = await res.json();
  const items: GitHubTreeItem[] = data.tree || [];

  // Filter out directories, binary files, large files, and skip dirs
  return items.filter((item) => {
    if (item.type !== "blob") return false;
    if (item.size && item.size > MAX_FILE_SIZE) return false;

    const parts = item.path.split("/");
    if (parts.some((p) => SKIP_DIRS.has(p))) return false;

    const ext = item.path.split(".").pop()?.toLowerCase() || "";
    if (BINARY_EXTENSIONS.has(ext)) return false;

    return true;
  });
}

export async function fetchFileContent(
  token: string,
  owner: string,
  name: string,
  path: string
): Promise<string | null> {
  const res = await fetch(
    `${GITHUB_API}/repos/${owner}/${name}/contents/${encodeURIComponent(path)}`,
    { headers: headers(token) }
  );

  if (!res.ok) return null;

  const data = await res.json();
  if (data.encoding === "base64" && data.content) {
    return Buffer.from(data.content, "base64").toString("utf-8");
  }
  return null;
}

export async function fetchRepoByFullName(
  token: string,
  owner: string,
  name: string
): Promise<GitHubRepo> {
  const res = await fetch(
    `${GITHUB_API}/repos/${owner}/${name}`,
    { headers: headers(token) }
  );

  if (!res.ok) {
    if (res.status === 404) throw githubError("Repository not found or not accessible.");
    if (res.status === 401) throw githubError("GitHub token expired. Please re-authenticate.");
    throw githubError(`GitHub API error: ${res.status} ${res.statusText}`);
  }

  return res.json();
}

export function shouldIndexFile(path: string): boolean {
  const ext = path.split(".").pop()?.toLowerCase() || "";
  if (BINARY_EXTENSIONS.has(ext)) return false;
  const parts = path.split("/");
  return !parts.some((p) => SKIP_DIRS.has(p));
}
