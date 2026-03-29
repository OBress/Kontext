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

const chatMessages = jiti("../../lib/chat-messages.ts");

function run(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

run("persisted messages strip raw image payloads", () => {
  const persisted = chatMessages.toPersistedChatMessage({
    id: "user-1",
    role: "user",
    content: "Here is an image",
    timestamp: new Date("2026-03-29T12:00:00.000Z"),
    attachedImages: [
      {
        name: "diagram.png",
        mimeType: "image/png",
        dataUrl: "data:image/png;base64,abc123",
      },
    ],
  });

  assert.deepEqual(persisted.attachedImages, [
    { name: "diagram.png", mimeType: "image/png" },
  ]);
  assert.equal(Object.prototype.hasOwnProperty.call(persisted.attachedImages[0], "dataUrl"), false);
});

run("history block keeps resolved commit scope for follow-ups", () => {
  const block = chatMessages.buildConversationHistoryBlock([
    {
      id: "assistant-1",
      role: "assistant",
      content: "The latest commit is `abc1234`.",
      timestamp: "2026-03-29T12:00:00.000Z",
      sourceMode: "live",
      resolvedCommitSha: "abc1234def5678",
    },
    {
      id: "user-2",
      role: "user",
      content: "What files changed in that commit?",
      timestamp: "2026-03-29T12:01:00.000Z",
    },
  ]);

  assert.match(block, /Assistant \(resolved commit abc1234, source live\):/);
  assert.match(block, /User: What files changed in that commit\?/);

  const resolved = chatMessages.findLastResolvedCommit([
    {
      id: "assistant-1",
      role: "assistant",
      content: "The latest commit is `abc1234`.",
      timestamp: "2026-03-29T12:00:00.000Z",
      sourceMode: "live",
      resolvedCommitSha: "abc1234def5678",
    },
  ]);

  assert.deepEqual(resolved, {
    sha: "abc1234def5678",
    sourceMode: "live",
  });
});

run("normalized persisted messages keep freshness metadata", () => {
  const normalized = chatMessages.normalizePersistedChatMessages([
    {
      id: "assistant-1",
      role: "assistant",
      content: "Indexed history is current.",
      timestamp: "2026-03-29T12:02:00.000Z",
      answerMode: "grounded",
      sourceMode: "indexed",
      resolvedCommitSha: "def5678abc1234",
      freshness: {
        branch: "main",
        indexedSha: "def5678abc1234",
        liveHeadSha: "def5678abc1234",
        stale: false,
        note: "Indexed data is aligned with GitHub HEAD on main.",
      },
    },
    {
      role: "assistant",
      content: "invalid",
    },
  ]);

  assert.equal(normalized.length, 1);
  assert.equal(normalized[0].freshness?.branch, "main");
  assert.equal(normalized[0].resolvedCommitSha, "def5678abc1234");
});

console.log("All chat history regression checks passed.");
