
import { createAdminClient } from "./auth";
import { generateEmbeddings, generateText } from "./embeddings";
import {
  buildTaskSystemInstruction,
  PROMPT_GENERATION_CONFIGS,
} from "./prompt-contract";

interface CommitFile {
  path: string;
  status: string;
  additions?: number;
  deletions?: number;
}

interface CommitForSummary {
  sha: string;
  message: string;
  files_changed: CommitFile[];
}

export const SUMMARY_SYSTEM_PROMPT = buildTaskSystemInstruction({
  task: "high_signal_compressor",
  role: "a development historian",
  mission:
    "Write concise, searchable summaries of code changes from commit evidence.",
  outputStyle: [
    "Return 1-2 sentences in natural developer language.",
    "Keep the summary searchable: prefer stable nouns, systems, and concrete actions.",
    "Do not include raw file paths or quote the commit message verbatim unless needed.",
  ],
  taskRules: [
    "If the commit message is vague, infer the affected area from the changed files but keep uncertainty modest.",
    "For mechanical or broad changes, summarize the most meaningful system-level effect rather than listing files.",
  ],
});

/**
 * Generate a natural language AI summary for a single commit.
 */
export async function generateCommitSummary(
  apiKey: string,
  commitMessage: string,
  filesChanged: CommitFile[]
): Promise<string> {
  const fileList = filesChanged
    .slice(0, 30) // Cap to avoid huge prompts
    .map((f) => `- ${f.path} (${f.status})`)
    .join("\n");

  const prompt = `Summarize the commit in 1-2 sentences.

Commit message:
${commitMessage}

Changed files:
${fileList || "- (no file data available)"}

Requirements:
- Focus on what changed and why it matters to the codebase.
- Prefer stable nouns and feature names a developer would search for later.
- Avoid raw file paths.
- If the evidence is too thin, keep the summary general rather than inventing detail.

Summary:`;

  const summary = await generateText(apiKey, prompt, {
    systemInstruction: SUMMARY_SYSTEM_PROMPT,
    generationConfig: PROMPT_GENERATION_CONFIGS.summary,
  });
  // Clean up: remove quotes, trim, take first 2 sentences max
  return summary
    .replace(/^["']|["']$/g, "")
    .trim()
    .split(/(?<=[.!])\s+/)
    .slice(0, 2)
    .join(" ");
}

/**
 * Generate AI summaries and embeddings for a batch of commits.
 * Returns arrays aligned with the input commits.
 */
export async function summarizeAndEmbedCommits(
  apiKey: string,
  commits: CommitForSummary[]
): Promise<{ summaries: string[]; embeddings: number[][] }> {
  // Generate individual summaries
  const summaries: string[] = [];
  for (const commit of commits) {
    try {
      const summary = await generateCommitSummary(
        apiKey,
        commit.message,
        commit.files_changed
      );
      summaries.push(summary);
    } catch (err) {
      console.warn(
        `[timeline-ai] Failed to summarize commit ${commit.sha.slice(0, 7)}:`,
        err
      );
      // Fallback: use the first line of the commit message
      summaries.push(commit.message.split("\n")[0].slice(0, 200));
    }
  }

  // Batch-embed all summaries
  const embeddings = await generateEmbeddings(
    apiKey,
    summaries,
    "RETRIEVAL_DOCUMENT"
  );

  return { summaries, embeddings };
}

/**
 * Backfill AI summaries for commits that don't have them yet.
 * Called lazily from the Timeline page or a dedicated backfill endpoint.
 */
export async function backfillMissingSummaries(
  apiKey: string,
  userId: string,
  repoFullName: string,
  limit: number = 20
): Promise<number> {
  const adminDb = await createAdminClient();

  // Find commits missing AI summaries
  const { data: unsummarized } = await adminDb
    .from("repo_commits")
    .select("id, sha, message, files_changed")
    .eq("user_id", userId)
    .eq("repo_full_name", repoFullName)
    .is("ai_summary", null)
    .order("committed_at", { ascending: false })
    .limit(limit);

  if (!unsummarized || unsummarized.length === 0) return 0;

  const commits: CommitForSummary[] = unsummarized.map((row) => {
    let files: CommitFile[] = [];
    if (Array.isArray(row.files_changed)) {
      files = row.files_changed as CommitFile[];
    } else if (typeof row.files_changed === "string") {
      try {
        files = JSON.parse(row.files_changed);
      } catch {
        files = [];
      }
    }
    return {
      sha: row.sha,
      message: row.message,
      files_changed: files,
    };
  });

  const { summaries, embeddings } = await summarizeAndEmbedCommits(
    apiKey,
    commits
  );

  // Write summaries + embeddings back to repo_commits
  for (let i = 0; i < unsummarized.length; i++) {
    await adminDb
      .from("repo_commits")
      .update({
        ai_summary: summaries[i],
        ai_summary_embedding: JSON.stringify(embeddings[i]),
      })
      .eq("id", unsummarized[i].id);
  }

  return unsummarized.length;
}
