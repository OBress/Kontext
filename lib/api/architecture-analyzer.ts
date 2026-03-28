import type { ArchitectureAnalysis } from "@/types/architecture";
import { generateText } from "./embeddings";

interface FileMetadata {
  file_path: string;
  file_name: string;
  extension: string | null;
  line_count: number;
  imports: string[];
}

interface ChunkSample {
  file_path: string;
  content: string;
}

/**
 * Build the Gemini prompt for architecture analysis.
 */
function buildAnalysisPrompt(
  repoFullName: string,
  files: FileMetadata[],
  chunkSamples: ChunkSample[]
): string {
  // Build file tree summary
  const fileTree = files
    .map((f) => `  ${f.file_path} (${f.line_count} lines, imports: ${f.imports.length})`)
    .join("\n");

  // Build import graph summary (top connections)
  const importSummary = files
    .filter((f) => f.imports.length > 0)
    .slice(0, 60)
    .map(
      (f) =>
        `  ${f.file_path} → [${f.imports.slice(0, 5).join(", ")}${f.imports.length > 5 ? ` +${f.imports.length - 5} more` : ""}]`
    )
    .join("\n");

  // Build code samples
  const codeSamples = chunkSamples
    .slice(0, 40)
    .map((c) => `--- ${c.file_path} ---\n${c.content.slice(0, 600)}`)
    .join("\n\n");

  return `You are a senior software architect. Analyze this codebase and produce a high-level architecture diagram as structured JSON.

REPOSITORY: ${repoFullName}
TOTAL FILES: ${files.length}

FILE TREE:
${fileTree}

IMPORT GRAPH (file → dependencies):
${importSummary}

CODE SAMPLES (first chunk of key files):
${codeSamples}

INSTRUCTIONS:
1. Identify 5-10 top-level architectural COMPONENTS that a human would recognize (e.g., "Landing Page", "Auth System", "Chat Interface", "Ingestion Pipeline", "API Layer").
2. Name components by their ROLE, not their folder name. Use human-friendly labels.
3. Each component can optionally have 2-5 children sub-components if it's complex enough to warrant drill-down.
4. Identify CONNECTIONS between components. Label each connection with what kind of interaction it is (e.g., "REST API call", "imports shared utils", "sends webhook", "queries database").
5. For each component, list the file paths that belong to it. Every file should belong to exactly one component.
6. Write a 1-2 sentence description for each component and connection.

OUTPUT FORMAT (strict JSON, no markdown fences):
{
  "summary": "1-2 sentence overview of the entire project",
  "components": [
    {
      "id": "kebab-case-id",
      "label": "Human Friendly Name",
      "description": "2-3 sentence description of what this component does",
      "type": "page|api|service|worker|database|config|shared|external",
      "files": ["path/to/file.ts", ...],
      "children": [
        {
          "id": "child-id",
          "label": "Child Name",
          "description": "Description",
          "type": "page|api|service|worker|database|config|shared|external",
          "files": ["path/to/child.ts"]
        }
      ]
    }
  ],
  "connections": [
    {
      "id": "source-to-target",
      "source": "source-component-id",
      "target": "target-component-id",
      "label": "Short Label (e.g. REST API)",
      "description": "Description of the interaction",
      "type": "api_call|import|webhook|database_query|auth|event"
    }
  ]
}

IMPORTANT:
- Return ONLY valid JSON. No markdown code fences, no explanation text.
- Component IDs must be unique kebab-case strings.
- Connection source and target must reference valid component IDs (top-level only, not children).
- The "children" field is optional. Only use it for components complex enough to warrant drill-down.
- Keep the total to 5-10 top-level components for readability.`;
}

/**
 * Parse the AI response into a validated ArchitectureAnalysis object.
 */
function parseAnalysisResponse(raw: string): ArchitectureAnalysis {
  // Strip potential markdown fences
  let cleaned = raw.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
  }

  const parsed = JSON.parse(cleaned);

  // Validate required fields
  if (!parsed.summary || !Array.isArray(parsed.components)) {
    throw new Error("Invalid architecture analysis: missing summary or components");
  }

  // Ensure connections array exists
  if (!Array.isArray(parsed.connections)) {
    parsed.connections = [];
  }

  // Validate component structure
  for (const comp of parsed.components) {
    if (!comp.id || !comp.label || !comp.type) {
      throw new Error(`Invalid component: missing id, label, or type in ${JSON.stringify(comp)}`);
    }
    if (!Array.isArray(comp.files)) {
      comp.files = [];
    }
  }

  // Validate connection references
  const componentIds = new Set(parsed.components.map((c: { id: string }) => c.id));
  parsed.connections = parsed.connections.filter(
    (conn: { source: string; target: string }) =>
      componentIds.has(conn.source) && componentIds.has(conn.target)
  );

  return parsed as ArchitectureAnalysis;
}

/**
 * Run the full architecture analysis pipeline.
 */
export async function analyzeArchitecture(
  apiKey: string,
  repoFullName: string,
  files: FileMetadata[],
  chunkSamples: ChunkSample[]
): Promise<ArchitectureAnalysis> {
  const prompt = buildAnalysisPrompt(repoFullName, files, chunkSamples);

  const systemInstruction =
    "You are a senior software architect. Analyze codebases and produce structured JSON describing the high-level architecture. Be concise and accurate. Output only valid JSON.";

  const response = await generateText(apiKey, prompt, systemInstruction);

  return parseAnalysisResponse(response);
}
