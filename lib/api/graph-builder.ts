import type { GraphNode, GraphLink } from "@/lib/store/graph-store";

const fileColors: Record<string, string> = {
  ts: "#00E5FF", tsx: "#00E5FF",
  js: "#FFD600", jsx: "#FFD600",
  css: "#FF4081", scss: "#FF4081",
  json: "#00E676", yaml: "#00E676", yml: "#00E676",
  md: "#9E9E9E", mdx: "#9E9E9E",
  py: "#3572A5",
  go: "#00ADD8",
  rs: "#DEA584",
  java: "#B07219",
  rb: "#701516",
  php: "#4F5D95",
  config: "#FFB300",
};

function getColor(ext: string): string {
  return fileColors[ext] || "#FFFFFF";
}

function getGroup(ext: string): string {
  if (["ts", "tsx"].includes(ext)) return "ts";
  if (["js", "jsx"].includes(ext)) return "js";
  if (["css", "scss"].includes(ext)) return "css";
  if (["json", "yaml", "yml"].includes(ext)) return "json";
  if (["md", "mdx"].includes(ext)) return "md";
  if (["py"].includes(ext)) return "py";
  if (["go"].includes(ext)) return "go";
  if (["rs"].includes(ext)) return "rs";
  return "other";
}

// Import regex patterns
const IMPORT_PATTERNS = [
  // ES imports: import X from 'path' or import 'path'
  /(?:import\s+(?:[\w{}\s,*]+\s+from\s+)?['"])((?:@\/|\.\.?\/)[^'"]+)(?:['"])/g,
  // require: require('path')
  /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  // CSS imports: @import 'path'
  /@import\s+['"]([^'"]+)['"]/g,
  // Python: from path import X
  /^from\s+(\S+)\s+import/gm,
];

interface FileData {
  file_path: string;
  file_name: string;
  extension: string | null;
  line_count: number;
  imports: string[];
}

export function buildGraph(files: FileData[]): {
  nodes: GraphNode[];
  links: GraphLink[];
} {
  // Build lookup set of known file paths
  const pathSet = new Set(files.map((f) => f.file_path));

  const nodes: GraphNode[] = files.map((f) => {
    const ext = f.extension || "";
    return {
      id: f.file_path,
      name: f.file_name,
      path: f.file_path,
      extension: ext,
      lineCount: f.line_count,
      imports: f.imports || [],
      exportedBy: [],
      group: getGroup(ext),
      color: getColor(ext),
      val: Math.max(3, Math.log2(Math.max(f.line_count, 1)) * 2.5),
    };
  });

  // Build links from imports
  const links: GraphLink[] = [];
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));

  for (const node of nodes) {
    for (const imp of node.imports) {
      // Try to resolve import to a known file
      const resolved = resolveImport(imp, node.path, pathSet);
      if (resolved && resolved !== node.id) {
        links.push({ source: node.id, target: resolved, value: 1 });
        // Track reverse relationship
        const targetNode = nodeMap.get(resolved);
        if (targetNode) {
          targetNode.exportedBy.push(node.id);
        }
      }
    }
  }

  return { nodes, links };
}

/**
 * Try to resolve an import path to a known file in the repo.
 */
export function resolveImport(
  importPath: string,
  currentFile: string,
  knownPaths: Set<string>
): string | null {
  // Handle alias imports like @/lib/utils
  let candidate = importPath;
  if (candidate.startsWith("@/")) {
    candidate = candidate.slice(2);
  }

  // Try exact match
  if (knownPaths.has(candidate)) return candidate;

  // Try with common extensions
  const extensions = [".ts", ".tsx", ".js", ".jsx", ".css", ".scss"];
  for (const ext of extensions) {
    if (knownPaths.has(candidate + ext)) return candidate + ext;
  }

  // Try index files
  for (const ext of extensions) {
    if (knownPaths.has(`${candidate}/index${ext}`)) return `${candidate}/index${ext}`;
  }

  // Try relative resolution
  if (candidate.startsWith("./") || candidate.startsWith("../")) {
    const currentDir = currentFile.split("/").slice(0, -1).join("/");
    const parts = candidate.split("/");
    const resolved: string[] = currentDir.split("/").filter(Boolean);

    for (const part of parts) {
      if (part === ".") continue;
      if (part === "..") { resolved.pop(); continue; }
      resolved.push(part);
    }

    const resolvedPath = resolved.join("/");
    if (knownPaths.has(resolvedPath)) return resolvedPath;
    for (const ext of extensions) {
      if (knownPaths.has(resolvedPath + ext)) return resolvedPath + ext;
    }
  }

  return null;
}

/**
 * Extract import paths from file content.
 */
export function extractImports(content: string): string[] {
  const imports: string[] = [];
  const seen = new Set<string>();

  for (const pattern of IMPORT_PATTERNS) {
    const regex = new RegExp(pattern.source, pattern.flags);
    let match;
    while ((match = regex.exec(content)) !== null) {
      const importPath = match[1];
      if (importPath && !seen.has(importPath)) {
        // Skip external deps (no relative path or alias)
        if (
          importPath.startsWith(".") ||
          importPath.startsWith("@/") ||
          importPath.startsWith("~/")
        ) {
          seen.add(importPath);
          imports.push(importPath);
        }
      }
    }
  }

  return imports;
}
