import { TaskType } from "@google/generative-ai";
import { createAdminClient } from "./auth";
import { generateEmbeddings, generateText } from "./embeddings";

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

const SUMMARY_SYSTEM_PROMPT = `You are a development historian. Given a git commit and its changed files, write a concise 1-2 sentence summary of what was developed or changed, in natural language a developer would use to search for this later.

Focus on WHAT was built/fixed/changed (e.g. "Added authentication", "Fixed dashboard layout bug"). Do NOT include raw file paths in the summary. Use descriptive terms like "implemented", "added", "fixed", "refactored", "removed", "updated".

If the commit message already clearly describes the change, distill it into clean natural language. If the message is vague (e.g. "fix stuff"), use the file paths to infer what area of the codebase was affected.`;

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

  const prompt = `Commit message: ${commitMessage}

Files changed:
${fileList || "- (no file data available)"}

Summary:`;

  const summary = await generateText(apiKey, prompt, SUMMARY_SYSTEM_PROMPT);
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
    TaskType.RETRIEVAL_DOCUMENT
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
