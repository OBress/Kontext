import assert from "node:assert/strict";
import createJiti from "jiti";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..");
const jiti = createJiti(import.meta.url, {
  alias: {
    "@": repoRoot,
  },
});

const chatOrchestrator = jiti("../../lib/api/chat-orchestrator.ts");

function run(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

function createIntent(overrides = {}) {
  return {
    kind: "all_commits",
    wantsTable: false,
    wantsBullets: true,
    wantsTimelineVisual: true,
    wantsArchitectureVisual: false,
    wantsFileList: true,
    commitReference: null,
    scopeToPriorCommit: false,
    ...overrides,
  };
}

function createCommit(index, overrides = {}) {
  return {
    sha: `abc123${index}def456${index}`,
    message: `feat: change ${index}`,
    ai_summary: `Summary ${index}`,
    author_name: "OBress",
    author_avatar_url: null,
    committed_at: `2026-03-2${index}T15:33:2${index}.000Z`,
    files_changed: [
      {
        path: `app/example-${index}.ts`,
        status: "modified",
        additions: 10 + index,
        deletions: index,
        previous_path: null,
      },
    ],
    ...overrides,
  };
}

run("latest commit requests stay singular", () => {
  const intent = chatOrchestrator.detectChatQueryIntent(
    "Could you detail the changes in the latest GitHub commit?"
  );

  assert.equal(intent.kind, "latest_commit");
  assert.equal(intent.commitReference, null);
});

run("all commit requests route to exhaustive history mode", () => {
  const intent = chatOrchestrator.detectChatQueryIntent(
    "Detail me all of the past commits in this repo."
  );

  assert.equal(intent.kind, "all_commits");
  assert.equal(intent.wantsTimelineVisual, true);
});

run("generic commit history requests route to exhaustive history mode", () => {
  const intent = chatOrchestrator.detectChatQueryIntent(
    "Show me the commit history for this repo."
  );

  assert.equal(intent.kind, "all_commits");
  assert.equal(intent.wantsTimelineVisual, true);
});

run("commit history formatter includes every tracked commit in table mode", () => {
  const commits = [createCommit(1), createCommit(2), createCommit(3)];
  const output = chatOrchestrator.formatCommitHistoryResponse(
    commits,
    createIntent({ wantsTable: true, wantsBullets: false })
  );

  assert.match(output, /I found 3 tracked commits in this repository\./);
  assert.match(output, /\| SHA \| Date \| Author \| Summary \| Files \|/);

  for (const commit of commits) {
    assert.match(output, new RegExp(commit.sha.slice(0, 7)));
    assert.match(output, new RegExp(commit.ai_summary));
    assert.match(output, new RegExp(commit.files_changed[0].path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

console.log("All chat orchestrator regression checks passed.");
