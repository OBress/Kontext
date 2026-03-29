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

const chatVisualTypes = jiti("../../types/chat-visuals.ts");

function run(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

run("timeline payload parser accepts valid kontext timeline blocks", () => {
  const raw = JSON.stringify({
    kind: "kontext-timeline",
    title: "Relevant development timeline",
    summary: "Recent matched history.",
    events: [
      {
        sha: "abc1234",
        date: "2026-03-28",
        committedAt: "2026-03-28T12:00:00.000Z",
        summary: "Added auth timeline support",
        message: "feat: add auth timeline support",
        author: "owen",
        similarity: 0.92,
        matched: true,
      },
      {
        sha: "def5678",
        date: "2026-03-26",
        committedAt: "2026-03-26T12:00:00.000Z",
        summary: "Refined chat retrieval",
        message: "refactor: tighten chat retrieval",
        author: "owen",
        similarity: null,
        matched: false,
      },
    ],
  });

  const parsed = chatVisualTypes.parseChatVisualPayload(raw, "kontext-timeline");
  assert.ok(parsed);
  assert.equal(parsed.kind, "kontext-timeline");
  assert.equal(parsed.events.length, 2);
});

run("architecture payload parser rejects malformed edge payloads", () => {
  const raw = JSON.stringify({
    kind: "kontext-architecture",
    title: "Relevant architecture flow",
    summary: "A compact graph.",
    layerId: "system",
    traceLabel: null,
    pathNodeIds: ["chat-page", "chat-route"],
    nodes: [
      {
        id: "chat-page",
        label: "Chat Page",
        description: "UI surface",
        type: "page",
        highlighted: true,
      },
    ],
    edges: [
      {
        id: "missing-type",
        source: "chat-page",
        target: "chat-route",
        label: "calls",
        description: "Calls the route",
        highlighted: true,
      },
    ],
  });

  const parsed = chatVisualTypes.parseChatVisualPayload(
    raw,
    "kontext-architecture"
  );
  assert.equal(parsed, null);
});

run("visual language guard only accepts supported fenced visual languages", () => {
  assert.equal(chatVisualTypes.isChatVisualLanguage("kontext-timeline"), true);
  assert.equal(chatVisualTypes.isChatVisualLanguage("kontext-architecture"), true);
  assert.equal(chatVisualTypes.isChatVisualLanguage("mermaid"), true);
  assert.equal(chatVisualTypes.isChatVisualLanguage("typescript"), false);
});

console.log("All chat visual regression checks passed.");
