import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/api/auth";
import { rateLimit } from "@/lib/api/rate-limit";
import { handleApiError } from "@/lib/api/errors";
import { validateRepoFullName, validateApiKey, validateTarget } from "@/lib/api/validate";
import { generateText } from "@/lib/api/embeddings";
import { logActivity } from "@/lib/api/activity";

// Config files that indicate tech stack
const CONFIG_FILES = [
  "package.json", "tsconfig.json", "next.config.js", "next.config.ts", "next.config.mjs",
  "vite.config.ts", "vite.config.js", "webpack.config.js",
  "tailwind.config.js", "tailwind.config.ts",
  "Cargo.toml", "go.mod", "requirements.txt", "Pipfile", "pyproject.toml",
  "Gemfile", "build.gradle", "pom.xml", "Dockerfile", "docker-compose.yml",
  ".eslintrc", ".eslintrc.js", ".eslintrc.json", "jest.config.ts", "jest.config.js",
  "vitest.config.ts", ".prettierrc",
];

/**
 * POST /api/prompts — Detect stack + generate system prompt via Gemini
 */
export async function POST(request: Request) {
  try {
    const { user, supabase } = await getAuthenticatedUser();

    const rl = rateLimit(user.id, "prompts");
    if (!rl.ok) {
      return NextResponse.json(
        { error: { code: "RATE_LIMITED", message: "Too many requests" } },
        { status: 429 }
      );
    }

    const body = await request.json();
    const repoFullName = validateRepoFullName(body.repo_full_name);
    const apiKey = validateApiKey(request);
    const target = validateTarget(body.target);
    const customInstructions = body.custom_instructions || "";

    // 1. Fetch config file chunks from repo_chunks
    const { data: configChunks } = await supabase
      .from("repo_chunks")
      .select("file_path, content")
      .eq("user_id", user.id)
      .eq("repo_full_name", repoFullName)
      .in("file_path", CONFIG_FILES);

    // Also get file structure overview
    const { data: files } = await supabase
      .from("repo_files")
      .select("file_path, extension")
      .eq("user_id", user.id)
      .eq("repo_full_name", repoFullName)
      .limit(200);

    // 2. Build context about the repo
    const configContext = (configChunks || [])
      .map((c) => `--- ${c.file_path} ---\n${c.content}`)
      .join("\n\n");

    const fileTree = (files || []).map((f) => f.file_path).join("\n");

    // 3. Build meta-prompt for Gemini
    const targetNames: Record<string, string> = {
      cursor: "Cursor (.cursorrules)",
      copilot: "GitHub Copilot",
      claude: "Claude",
      gpt: "ChatGPT / GPT",
    };

    const metaPrompt = `Analyze this repository and generate a comprehensive system prompt for ${targetNames[target] || target}.

## Repository: ${repoFullName}

## Configuration Files
${configContext || "No config files found."}

## File Structure (sample)
${fileTree || "No files available."}

${customInstructions ? `## Additional Instructions from User\n${customInstructions}` : ""}

## Your Task

1. First, analyze the config files to detect the tech stack. Output a JSON array of detected technologies with format: [{"name": "Tech Name", "category": "Framework|Language|Database|Styling|Testing|DevOps|Tooling|Library", "confidence": 90}]

2. Then generate a complete, detailed system prompt that an AI coding assistant should follow when working on this codebase. Include:
   - Project description and tech stack
   - File organization conventions
   - Coding standards (TypeScript strictness, naming, etc.)
   - React/Component patterns
   - Styling conventions
   - Error handling patterns
   - Testing patterns
   - Git conventions

Format your response EXACTLY as:
===STACK_START===
[JSON array of detected stack]
===STACK_END===
===PROMPT_START===
[The generated system prompt in markdown]
===PROMPT_END===`;

    const systemInstruction = "You are an expert software architect who analyzes codebases and generates precise, actionable system prompts for AI coding assistants.";

    const result = await generateText(apiKey, metaPrompt, systemInstruction);

    // 4. Parse the response
    let detectedStack: Array<{ name: string; category: string; confidence: number }> = [];
    let promptText = result;

    const stackMatch = result.match(/===STACK_START===\s*([\s\S]*?)\s*===STACK_END===/);
    const promptMatch = result.match(/===PROMPT_START===\s*([\s\S]*?)\s*===PROMPT_END===/);

    if (stackMatch) {
      try {
        detectedStack = JSON.parse(stackMatch[1]);
      } catch {
        // Parsing failed — use empty
      }
    }

    if (promptMatch) {
      promptText = promptMatch[1].trim();
    }

    // 5. Cache the result
    await supabase.from("generated_prompts").insert({
      user_id: user.id,
      repo_full_name: repoFullName,
      target,
      detected_stack: detectedStack,
      prompt_text: promptText,
      custom_instructions: customInstructions || null,
    });

    // Log activity event
    logActivity({
      userId: user.id,
      repoFullName,
      source: "kontext",
      eventType: "prompt_generated",
      title: `System prompt generated for ${repoFullName}`,
      description: `Target: ${targetNames[target] || target}`,
      metadata: { target, stack_count: detectedStack.length },
    });

    return NextResponse.json({ prompt: promptText, detectedStack });
  } catch (error) {
    return handleApiError(error);
  }
}
