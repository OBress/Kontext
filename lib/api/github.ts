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

export interface GitHubCommit {
  sha: string;
  commit: {
    message: string;
    author: {
      name: string;
      date: string;
    };
  };
  author?: {
    login: string;
    avatar_url: string;
  } | null;
}

export interface GitHubChangedFile {
  filename: string;
  status: "added" | "removed" | "modified" | "renamed" | "copied" | "changed" | "unchanged";
  additions: number;
  deletions: number;
  previous_filename?: string;
}

function encodeGitHubPath(path: string): string {
  return path
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

// ─── Existing Functions ────────────────────────────────────────────

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

export interface GitHubBranch {
  name: string;
  protected: boolean;
}

export async function fetchRepoBranches(
  token: string,
  owner: string,
  name: string,
  perPage = 100
): Promise<GitHubBranch[]> {
  const res = await fetch(
    `${GITHUB_API}/repos/${owner}/${name}/branches?per_page=${perPage}`,
    { headers: headers(token) }
  );

  if (!res.ok) {
    if (res.status === 401) throw githubError("GitHub token expired. Please re-authenticate.");
    throw githubError(`Failed to fetch branches: ${res.status}`);
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
  path: string,
  ref?: string
): Promise<string | null> {
  const query = ref ? `?ref=${encodeURIComponent(ref)}` : "";
  const res = await fetch(
    `${GITHUB_API}/repos/${owner}/${name}/contents/${encodeGitHubPath(path)}${query}`,
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

// ─── New: Sync & Webhook Functions ─────────────────────────────────

/**
 * Fetch the latest commit on a branch.
 */
export async function fetchLatestCommit(
  token: string,
  owner: string,
  name: string,
  branch: string = "main"
): Promise<GitHubCommit> {
  const res = await fetch(
    `${GITHUB_API}/repos/${owner}/${name}/commits?sha=${branch}&per_page=1`,
    { headers: headers(token) }
  );

  if (!res.ok) {
    throw githubError(`Failed to fetch latest commit: ${res.status}`);
  }

  const commits: GitHubCommit[] = await res.json();
  if (commits.length === 0) {
    throw githubError("No commits found on this branch.");
  }
  return commits[0];
}

/**
 * Fetch commits since a given SHA (paginated, returns newest first).
 * Uses the "since" date parameter derived from the base commit.
 */
export async function fetchCommitsSince(
  token: string,
  owner: string,
  name: string,
  branch: string,
  sinceSHA: string,
  maxCommits = 200
): Promise<GitHubCommit[]> {
  // First, get the date of the since commit to use as a time filter
  const sinceRes = await fetch(
    `${GITHUB_API}/repos/${owner}/${name}/commits/${sinceSHA}`,
    { headers: headers(token) }
  );

  if (!sinceRes.ok) {
    throw githubError(`Failed to fetch base commit: ${sinceRes.status}`);
  }

  const sinceCommit: GitHubCommit = await sinceRes.json();
  const sinceDate = sinceCommit.commit.author.date;

  const allCommits: GitHubCommit[] = [];
  let page = 1;

  while (allCommits.length < maxCommits) {
    const res = await fetch(
      `${GITHUB_API}/repos/${owner}/${name}/commits?sha=${branch}&since=${sinceDate}&per_page=100&page=${page}`,
      { headers: headers(token) }
    );

    if (!res.ok) break;

    const commits: GitHubCommit[] = await res.json();
    if (commits.length === 0) break;

    // Filter out the base commit itself
    const newCommits = commits.filter((c) => c.sha !== sinceSHA);
    allCommits.push(...newCommits);

    if (commits.length < 100) break;
    page++;
  }

  return allCommits.slice(0, maxCommits);
}

/**
 * Get changed files between two commits using the Compare API.
 * Handles the 300-file limit by iterating individual commits if needed.
 */
export async function fetchChangedFiles(
  token: string,
  owner: string,
  name: string,
  baseSHA: string,
  headSHA: string
): Promise<{ files: GitHubChangedFile[]; totalCommits: number }> {
  const res = await fetch(
    `${GITHUB_API}/repos/${owner}/${name}/compare/${baseSHA}...${headSHA}`,
    { headers: headers(token) }
  );

  if (!res.ok) {
    throw githubError(`Failed to compare commits: ${res.status}`);
  }

  const data = await res.json();
  const totalCommits: number = data.total_commits || 0;
  let files: GitHubChangedFile[] = data.files || [];

  // GitHub Compare API only returns first 300 files.
  // If there are more, iterate through individual commits.
  if (data.files?.length >= 300) {
    files = await fetchChangedFilesFromIndividualCommits(
      token, owner, name, baseSHA, headSHA, data.commits || []
    );
  }

  return { files, totalCommits };
}

/**
 * Fallback: iterate individual commits to collect ALL changed files
 * when the Compare API hits the 300-file limit.
 */
async function fetchChangedFilesFromIndividualCommits(
  token: string,
  owner: string,
  name: string,
  baseSHA: string,
  _headSHA: string,
  commits: Array<{ sha: string }>
): Promise<GitHubChangedFile[]> {
  const fileMap = new Map<string, GitHubChangedFile>();

  for (const commit of commits) {
    if (commit.sha === baseSHA) continue;

    const res = await fetch(
      `${GITHUB_API}/repos/${owner}/${name}/commits/${commit.sha}`,
      { headers: headers(token) }
    );

    if (!res.ok) continue;

    const commitData = await res.json();
    const commitFiles: GitHubChangedFile[] = commitData.files || [];

    for (const file of commitFiles) {
      // Last write wins — later commits override earlier status
      fileMap.set(file.filename, {
        filename: file.filename,
        status: file.status as GitHubChangedFile["status"],
        additions: file.additions,
        deletions: file.deletions,
        previous_filename: file.previous_filename,
      });
    }
  }

  return Array.from(fileMap.values());
}

/**
 * Register a push webhook on a GitHub repository.
 * Returns the webhook ID for later cleanup.
 */
export async function registerWebhook(
  token: string,
  owner: string,
  name: string,
  webhookUrl: string,
  secret: string
): Promise<number> {
  const res = await fetch(
    `${GITHUB_API}/repos/${owner}/${name}/hooks`,
    {
      method: "POST",
      headers: {
        ...headers(token),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: "web",
        active: true,
        events: ["push"],
        config: {
          url: webhookUrl,
          content_type: "json",
          secret,
          insecure_ssl: "0",
        },
      }),
    }
  );

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const msg = body.message || res.statusText;

    // Check if hook already exists
    if (res.status === 422 && msg.includes("already exists")) {
      // List hooks and find existing one
      const existing = await findExistingWebhook(token, owner, name, webhookUrl);
      if (existing) return existing;
    }

    throw githubError(`Failed to register webhook: ${msg}`);
  }

  const hook = await res.json();
  return hook.id;
}

/**
 * Find an existing webhook by URL.
 */
async function findExistingWebhook(
  token: string,
  owner: string,
  name: string,
  webhookUrl: string
): Promise<number | null> {
  const res = await fetch(
    `${GITHUB_API}/repos/${owner}/${name}/hooks`,
    { headers: headers(token) }
  );

  if (!res.ok) return null;

  const hooks: Array<{ id: number; config: { url: string } }> = await res.json();
  const match = hooks.find((h) => h.config.url === webhookUrl);
  return match?.id ?? null;
}

/**
 * Delete a webhook from a GitHub repository.
 */
export async function deleteWebhook(
  token: string,
  owner: string,
  name: string,
  hookId: number
): Promise<void> {
  const res = await fetch(
    `${GITHUB_API}/repos/${owner}/${name}/hooks/${hookId}`,
    {
      method: "DELETE",
      headers: headers(token),
    }
  );

  // 404 means already deleted — that's fine
  if (!res.ok && res.status !== 404) {
    throw githubError(`Failed to delete webhook: ${res.status}`);
  }
}
