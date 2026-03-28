const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  ts: "typescript",
  tsx: "tsx",
  js: "javascript",
  jsx: "jsx",
  mjs: "javascript",
  cjs: "javascript",
  json: "json",
  css: "css",
  scss: "scss",
  html: "markup",
  md: "markdown",
  mdx: "mdx",
  py: "python",
  go: "go",
  rs: "rust",
  sh: "bash",
  bash: "bash",
  yml: "yaml",
  yaml: "yaml",
  sql: "sql",
  toml: "toml",
  java: "java",
  rb: "ruby",
  php: "php",
  swift: "swift",
  kt: "kotlin",
  cs: "csharp",
};

export function detectCodeLanguage(filePath: string): string {
  const extension = filePath.split(".").pop()?.toLowerCase() || "";
  return LANGUAGE_BY_EXTENSION[extension] || "text";
}

export function stripChunkFileHeader(content: string): string {
  return content.replace(/^\/\/ File: [^\n]*\n/, "");
}

export function buildGitHubBlobUrl(
  repoFullName: string,
  commitSha: string | null | undefined,
  filePath: string,
  lineStart?: number,
  lineEnd?: number
): string | null {
  if (!commitSha) return null;

  const encodedPath = filePath
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");

  const lines =
    typeof lineStart === "number"
      ? `#L${lineStart}${lineEnd && lineEnd !== lineStart ? `-L${lineEnd}` : ""}`
      : "";

  return `https://github.com/${repoFullName}/blob/${encodeURIComponent(commitSha)}/${encodedPath}${lines}`;
}

export function formatLineRange(lineStart?: number, lineEnd?: number): string {
  if (typeof lineStart !== "number") return "Lines unavailable";
  if (!lineEnd || lineEnd === lineStart) return `Line ${lineStart}`;
  return `Lines ${lineStart}-${lineEnd}`;
}
