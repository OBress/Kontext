/**
 * Curated list of popular open-source repos for the constellation visualization.
 * These provide ambient nodes even when the user hasn't added repos yet.
 */

export interface FeaturedRepo {
  full_name: string;
  name: string;
  owner: string;
  description: string;
  language: string;
  stars: number; // approximate, for display only
}

export const FEATURED_REPOS: FeaturedRepo[] = [
  // ───── JavaScript / TypeScript Ecosystem ─────
  { full_name: "facebook/react", name: "react", owner: "facebook", description: "A declarative, efficient, and flexible JavaScript library for building user interfaces", language: "JavaScript", stars: 231000 },
  { full_name: "vercel/next.js", name: "next.js", owner: "vercel", description: "The React Framework for the Web", language: "TypeScript", stars: 129000 },
  { full_name: "microsoft/TypeScript", name: "TypeScript", owner: "microsoft", description: "TypeScript is a superset of JavaScript that compiles to clean JavaScript output", language: "TypeScript", stars: 102000 },
  { full_name: "sveltejs/svelte", name: "svelte", owner: "sveltejs", description: "Cybernetically enhanced web apps", language: "TypeScript", stars: 81000 },
  { full_name: "vuejs/core", name: "core", owner: "vuejs", description: "The progressive JavaScript framework", language: "TypeScript", stars: 48000 },
  { full_name: "angular/angular", name: "angular", owner: "angular", description: "A platform for building mobile and desktop web applications", language: "TypeScript", stars: 97000 },
  { full_name: "denoland/deno", name: "deno", owner: "denoland", description: "A modern runtime for JavaScript and TypeScript", language: "Rust", stars: 98000 },
  { full_name: "nodejs/node", name: "node", owner: "nodejs", description: "Node.js JavaScript runtime", language: "JavaScript", stars: 109000 },
  { full_name: "expressjs/express", name: "express", owner: "expressjs", description: "Fast, unopinionated, minimalist web framework for Node.js", language: "JavaScript", stars: 66000 },
  { full_name: "remix-run/remix", name: "remix", owner: "remix-run", description: "Build better websites with Remix", language: "TypeScript", stars: 30000 },

  // ───── CSS / Design ─────
  { full_name: "tailwindlabs/tailwindcss", name: "tailwindcss", owner: "tailwindlabs", description: "A utility-first CSS framework for rapid UI development", language: "TypeScript", stars: 85000 },
  { full_name: "shadcn-ui/ui", name: "ui", owner: "shadcn-ui", description: "Beautifully designed components built with Radix UI and Tailwind CSS", language: "TypeScript", stars: 78000 },
  { full_name: "mrdoob/three.js", name: "three.js", owner: "mrdoob", description: "JavaScript 3D library", language: "JavaScript", stars: 104000 },
  { full_name: "framer/motion", name: "motion", owner: "framer", description: "Open source, production-ready animation and gesture library for React", language: "TypeScript", stars: 25000 },

  // ───── AI / ML ─────
  { full_name: "openai/openai-python", name: "openai-python", owner: "openai", description: "The official Python library for the OpenAI API", language: "Python", stars: 24000 },
  { full_name: "huggingface/transformers", name: "transformers", owner: "huggingface", description: "State-of-the-art ML for PyTorch, TensorFlow, and JAX", language: "Python", stars: 137000 },
  { full_name: "langchain-ai/langchain", name: "langchain", owner: "langchain-ai", description: "Build context-aware reasoning applications", language: "Python", stars: 98000 },
  { full_name: "pytorch/pytorch", name: "pytorch", owner: "pytorch", description: "Tensors and dynamic neural networks in Python with strong GPU acceleration", language: "Python", stars: 85000 },
  { full_name: "tensorflow/tensorflow", name: "tensorflow", owner: "tensorflow", description: "An end-to-end open source machine learning framework", language: "C++", stars: 187000 },
  { full_name: "AUTOMATIC1111/stable-diffusion-webui", name: "stable-diffusion-webui", owner: "AUTOMATIC1111", description: "Stable Diffusion web UI", language: "Python", stars: 145000 },
  { full_name: "ollama/ollama", name: "ollama", owner: "ollama", description: "Get up and running with Llama 3 and other large language models", language: "Go", stars: 105000 },

  // ───── Systems / Infrastructure ─────
  { full_name: "torvalds/linux", name: "linux", owner: "torvalds", description: "Linux kernel source tree", language: "C", stars: 185000 },
  { full_name: "rust-lang/rust", name: "rust", owner: "rust-lang", description: "Empowering everyone to build reliable and efficient software", language: "Rust", stars: 100000 },
  { full_name: "golang/go", name: "go", owner: "golang", description: "The Go programming language", language: "Go", stars: 125000 },
  { full_name: "docker/compose", name: "compose", owner: "docker", description: "Define and run multi-container applications with Docker", language: "Go", stars: 34000 },
  { full_name: "kubernetes/kubernetes", name: "kubernetes", owner: "kubernetes", description: "Production-grade container orchestration", language: "Go", stars: 112000 },
  { full_name: "grafana/grafana", name: "grafana", owner: "grafana", description: "The open and composable observability and data visualization platform", language: "TypeScript", stars: 66000 },
  { full_name: "prometheus/prometheus", name: "prometheus", owner: "prometheus", description: "The Prometheus monitoring system and time series database", language: "Go", stars: 56000 },

  // ───── Databases ─────
  { full_name: "supabase/supabase", name: "supabase", owner: "supabase", description: "The open source Firebase alternative", language: "TypeScript", stars: 75000 },
  { full_name: "prisma/prisma", name: "prisma", owner: "prisma", description: "Next-generation ORM for Node.js & TypeScript", language: "TypeScript", stars: 41000 },
  { full_name: "drizzle-team/drizzle-orm", name: "drizzle-orm", owner: "drizzle-team", description: "Headless TypeScript ORM", language: "TypeScript", stars: 26000 },
  { full_name: "redis/redis", name: "redis", owner: "redis", description: "Redis is an in-memory data structure store used as a database, cache, and message broker", language: "C", stars: 67000 },

  // ───── DevTools / Build ─────
  { full_name: "vitejs/vite", name: "vite", owner: "vitejs", description: "Next-generation frontend tooling", language: "TypeScript", stars: 70000 },
  { full_name: "vercel/turborepo", name: "turborepo", owner: "vercel", description: "Incremental bundler and build system optimized for JS and TS monorepos", language: "Rust", stars: 26000 },
  { full_name: "biomejs/biome", name: "biome", owner: "biomejs", description: "A toolchain for web projects, aimed to provide functionalities to maintain them", language: "Rust", stars: 16000 },
  { full_name: "eslint/eslint", name: "eslint", owner: "eslint", description: "Find and fix problems in your JavaScript code", language: "JavaScript", stars: 25000 },
  { full_name: "prettier/prettier", name: "prettier", owner: "prettier", description: "Opinionated code formatter", language: "JavaScript", stars: 50000 },

  // ───── Rust Ecosystem ─────
  { full_name: "tauri-apps/tauri", name: "tauri", owner: "tauri-apps", description: "Build smaller, faster, and more secure desktop and mobile applications", language: "Rust", stars: 88000 },
  { full_name: "astral-sh/ruff", name: "ruff", owner: "astral-sh", description: "An extremely fast Python linter and code formatter, written in Rust", language: "Rust", stars: 35000 },
  { full_name: "astral-sh/uv", name: "uv", owner: "astral-sh", description: "An extremely fast Python package and project manager, written in Rust", language: "Rust", stars: 30000 },

  // ───── Mobile / Cross-platform ─────
  { full_name: "flutter/flutter", name: "flutter", owner: "flutter", description: "Flutter makes it easy to build beautiful apps for mobile, web, and desktop", language: "Dart", stars: 167000 },
  { full_name: "facebook/react-native", name: "react-native", owner: "facebook", description: "A framework for building native applications using React", language: "C++", stars: 120000 },
  { full_name: "expo/expo", name: "expo", owner: "expo", description: "An open-source framework for making universal native apps", language: "TypeScript", stars: 36000 },

  // ───── Backend / API ─────
  { full_name: "trpc/trpc", name: "trpc", owner: "trpc", description: "Move fast and break nothing. End-to-end typesafe APIs made easy", language: "TypeScript", stars: 35000 },
  { full_name: "fastify/fastify", name: "fastify", owner: "fastify", description: "Fast and low overhead web framework for Node.js", language: "JavaScript", stars: 33000 },
  { full_name: "hono/hono", name: "hono", owner: "honojs", description: "Web framework built on Web Standards", language: "TypeScript", stars: 22000 },
  { full_name: "elysiajs/elysia", name: "elysia", owner: "elysiajs", description: "Ergonomic web framework for building backend servers with Bun", language: "TypeScript", stars: 11000 },

  // ───── Productivity / Apps ─────
  { full_name: "calcom/cal.com", name: "cal.com", owner: "calcom", description: "Scheduling infrastructure for absolutely everyone", language: "TypeScript", stars: 33000 },
  { full_name: "makeplane/plane", name: "plane", owner: "makeplane", description: "Open source project management tool alternative to JIRA", language: "TypeScript", stars: 31000 },
  { full_name: "nocodb/nocodb", name: "nocodb", owner: "nocodb", description: "Open source Airtable alternative", language: "TypeScript", stars: 50000 },
  { full_name: "appwrite/appwrite", name: "appwrite", owner: "appwrite", description: "Your backend, minus the hassle", language: "TypeScript", stars: 46000 },

  // ───── Misc Popular ─────
  { full_name: "github/copilot-docs", name: "copilot-docs", owner: "github", description: "Documentation for GitHub Copilot", language: "Markdown", stars: 23000 },
  { full_name: "excalidraw/excalidraw", name: "excalidraw", owner: "excalidraw", description: "Virtual whiteboard for sketching hand-drawn like diagrams", language: "TypeScript", stars: 88000 },
  { full_name: "vercel/ai", name: "ai", owner: "vercel", description: "Build AI-powered applications with React, Svelte, Vue, and Solid", language: "TypeScript", stars: 12000 },
  { full_name: "oven-sh/bun", name: "bun", owner: "oven-sh", description: "Incredibly fast JavaScript runtime, bundler, transpiler, and package manager", language: "Zig", stars: 75000 },
  { full_name: "ziglang/zig", name: "zig", owner: "ziglang", description: "A general-purpose programming language and toolchain", language: "Zig", stars: 36000 },
  { full_name: "neovim/neovim", name: "neovim", owner: "neovim", description: "Vim-fork focused on extensibility and usability", language: "Vim Script", stars: 85000 },
  { full_name: "godotengine/godot", name: "godot", owner: "godotengine", description: "Multi-platform 2D and 3D game engine", language: "C++", stars: 92000 },
  { full_name: "juspay/hyperswitch", name: "hyperswitch", owner: "juspay", description: "An open source payments switch to make payments fast, reliable and affordable", language: "Rust", stars: 13000 },
  { full_name: "anthropics/anthropic-sdk-python", name: "anthropic-sdk-python", owner: "anthropics", description: "Python SDK for the Anthropic API", language: "Python", stars: 8000 },
  { full_name: "pnpm/pnpm", name: "pnpm", owner: "pnpm", description: "Fast, disk space efficient package manager", language: "TypeScript", stars: 30000 },
];

/**
 * Language → color mapping for constellation nodes.
 * Returns a hex color string for each language.
 */
export function getLanguageColor(lang: string): string {
  const map: Record<string, string> = {
    TypeScript: "#3178C6",
    JavaScript: "#F7DF1E",
    Python: "#3776AB",
    Rust: "#DEA584",
    Go: "#00ADD8",
    C: "#555555",
    "C++": "#F34B7D",
    Dart: "#00B4AB",
    Zig: "#F7A41D",
    "Vim Script": "#199F4B",
    Markdown: "#083FA1",
  };
  return map[lang] || "#888888";
}
