import { NextResponse } from "next/server";

// File type → color mapping
const fileColors: Record<string, string> = {
  ts: "#00E5FF",
  tsx: "#00E5FF",
  js: "#FFD600",
  jsx: "#FFD600",
  css: "#FF4081",
  scss: "#FF4081",
  json: "#00E676",
  yaml: "#00E676",
  md: "#9E9E9E",
  mdx: "#9E9E9E",
  config: "#FFB300",
};

function getColor(ext: string): string {
  return fileColors[ext] || "#FFFFFF";
}

function getGroup(ext: string): string {
  if (["ts", "tsx"].includes(ext)) return "ts";
  if (["js", "jsx"].includes(ext)) return "js";
  if (["css", "scss"].includes(ext)) return "css";
  if (["json", "yaml"].includes(ext)) return "json";
  if (["md", "mdx"].includes(ext)) return "md";
  return "other";
}

// Mock graph data
const nodes = [
  // Core app files
  { id: "app/layout.tsx", name: "layout.tsx", path: "app/layout.tsx", extension: "tsx", lineCount: 40, imports: ["globals.css"], exportedBy: [] },
  { id: "app/page.tsx", name: "page.tsx", path: "app/page.tsx", extension: "tsx", lineCount: 120, imports: ["@/components/Header", "@/components/Hero", "@/lib/utils"], exportedBy: [] },
  { id: "app/globals.css", name: "globals.css", path: "app/globals.css", extension: "css", lineCount: 200, imports: [], exportedBy: ["app/layout.tsx"] },

  // Components
  { id: "@/components/Header", name: "Header.tsx", path: "components/Header.tsx", extension: "tsx", lineCount: 85, imports: ["@/components/ui/Button", "@/lib/auth", "@/components/NavMenu"], exportedBy: ["app/page.tsx", "app/dashboard/page.tsx"] },
  { id: "@/components/Hero", name: "Hero.tsx", path: "components/Hero.tsx", extension: "tsx", lineCount: 65, imports: ["@/components/ui/Button", "@/components/AnimatedText"], exportedBy: ["app/page.tsx"] },
  { id: "@/components/NavMenu", name: "NavMenu.tsx", path: "components/NavMenu.tsx", extension: "tsx", lineCount: 95, imports: ["@/lib/auth", "@/components/ui/Dropdown"], exportedBy: ["@/components/Header"] },
  { id: "@/components/AnimatedText", name: "AnimatedText.tsx", path: "components/AnimatedText.tsx", extension: "tsx", lineCount: 40, imports: ["framer-motion"], exportedBy: ["@/components/Hero"] },
  { id: "@/components/Dashboard", name: "Dashboard.tsx", path: "components/Dashboard.tsx", extension: "tsx", lineCount: 180, imports: ["@/components/ui/Card", "@/components/Chart", "@/lib/api", "@/hooks/useData"], exportedBy: ["app/dashboard/page.tsx"] },
  { id: "@/components/Chart", name: "Chart.tsx", path: "components/Chart.tsx", extension: "tsx", lineCount: 130, imports: ["recharts", "@/lib/utils"], exportedBy: ["@/components/Dashboard"] },
  { id: "@/components/Sidebar", name: "Sidebar.tsx", path: "components/Sidebar.tsx", extension: "tsx", lineCount: 110, imports: ["@/components/ui/Button", "@/lib/auth", "@/components/NavMenu"], exportedBy: ["app/dashboard/layout.tsx"] },

  // UI Kit
  { id: "@/components/ui/Button", name: "Button.tsx", path: "components/ui/Button.tsx", extension: "tsx", lineCount: 55, imports: ["@/lib/utils"], exportedBy: ["@/components/Header", "@/components/Hero", "@/components/Sidebar"] },
  { id: "@/components/ui/Card", name: "Card.tsx", path: "components/ui/Card.tsx", extension: "tsx", lineCount: 35, imports: ["@/lib/utils"], exportedBy: ["@/components/Dashboard"] },
  { id: "@/components/ui/Dropdown", name: "Dropdown.tsx", path: "components/ui/Dropdown.tsx", extension: "tsx", lineCount: 90, imports: ["@/lib/utils", "framer-motion"], exportedBy: ["@/components/NavMenu"] },
  { id: "@/components/ui/Input", name: "Input.tsx", path: "components/ui/Input.tsx", extension: "tsx", lineCount: 30, imports: ["@/lib/utils"], exportedBy: [] },
  { id: "@/components/ui/Modal", name: "Modal.tsx", path: "components/ui/Modal.tsx", extension: "tsx", lineCount: 70, imports: ["@/lib/utils", "framer-motion"], exportedBy: ["@/components/Settings"] },

  // Library files
  { id: "@/lib/utils", name: "utils.ts", path: "lib/utils.ts", extension: "ts", lineCount: 45, imports: [], exportedBy: ["app/page.tsx", "@/components/ui/Button", "@/components/ui/Card", "@/components/Chart"] },
  { id: "@/lib/auth", name: "auth.ts", path: "lib/auth.ts", extension: "ts", lineCount: 80, imports: ["@/lib/db"], exportedBy: ["@/components/Header", "@/components/NavMenu", "@/components/Sidebar"] },
  { id: "@/lib/api", name: "api.ts", path: "lib/api.ts", extension: "ts", lineCount: 120, imports: ["@/lib/auth", "@/lib/db"], exportedBy: ["@/components/Dashboard", "@/hooks/useData"] },
  { id: "@/lib/db", name: "db.ts", path: "lib/db.ts", extension: "ts", lineCount: 60, imports: [], exportedBy: ["@/lib/auth", "@/lib/api"] },

  // Hooks
  { id: "@/hooks/useData", name: "useData.ts", path: "hooks/useData.ts", extension: "ts", lineCount: 55, imports: ["@/lib/api"], exportedBy: ["@/components/Dashboard"] },
  { id: "@/hooks/useAuth", name: "useAuth.ts", path: "hooks/useAuth.ts", extension: "ts", lineCount: 35, imports: ["@/lib/auth"], exportedBy: [] },

  // Pages
  { id: "app/dashboard/page.tsx", name: "page.tsx", path: "app/dashboard/page.tsx", extension: "tsx", lineCount: 90, imports: ["@/components/Dashboard", "@/components/Header"], exportedBy: [] },
  { id: "app/dashboard/layout.tsx", name: "layout.tsx", path: "app/dashboard/layout.tsx", extension: "tsx", lineCount: 30, imports: ["@/components/Sidebar"], exportedBy: [] },
  { id: "app/settings/page.tsx", name: "page.tsx", path: "app/settings/page.tsx", extension: "tsx", lineCount: 150, imports: ["@/components/Settings", "@/lib/auth"], exportedBy: [] },
  { id: "@/components/Settings", name: "Settings.tsx", path: "components/Settings.tsx", extension: "tsx", lineCount: 200, imports: ["@/components/ui/Input", "@/components/ui/Button", "@/components/ui/Modal", "@/lib/api"], exportedBy: ["app/settings/page.tsx"] },

  // Config files
  { id: "package.json", name: "package.json", path: "package.json", extension: "json", lineCount: 45, imports: [], exportedBy: [] },
  { id: "tsconfig.json", name: "tsconfig.json", path: "tsconfig.json", extension: "json", lineCount: 25, imports: [], exportedBy: [] },
  { id: "next.config.ts", name: "next.config.ts", path: "next.config.ts", extension: "ts", lineCount: 15, imports: [], exportedBy: [] },
  { id: "tailwind.config.ts", name: "tailwind.config.ts", path: "tailwind.config.ts", extension: "ts", lineCount: 40, imports: [], exportedBy: [] },

  // Docs
  { id: "README.md", name: "README.md", path: "README.md", extension: "md", lineCount: 80, imports: [], exportedBy: [] },

  // External deps (represented as small nodes)
  { id: "framer-motion", name: "framer-motion", path: "node_modules/framer-motion", extension: "js", lineCount: 10, imports: [], exportedBy: ["@/components/AnimatedText", "@/components/ui/Dropdown", "@/components/ui/Modal"] },
  { id: "recharts", name: "recharts", path: "node_modules/recharts", extension: "js", lineCount: 10, imports: [], exportedBy: ["@/components/Chart"] },
].map((n) => ({
  ...n,
  group: getGroup(n.extension),
  color: getColor(n.extension),
  val: Math.max(3, Math.log2(n.lineCount) * 2.5),
}));

// Build links from imports
const links: Array<{ source: string; target: string; value: number }> = [];
const nodeIds = new Set(nodes.map((n) => n.id));

nodes.forEach((node) => {
  node.imports.forEach((imp) => {
    if (nodeIds.has(imp)) {
      links.push({ source: node.id, target: imp, value: 1 });
    }
  });
});

export async function GET() {
  return NextResponse.json({ nodes, links });
}
