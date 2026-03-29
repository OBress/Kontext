import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import createJiti from "jiti";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..");
const jiti = createJiti(import.meta.url, {
  alias: {
    "@": repoRoot,
  },
});

const architectureRefresh = jiti("../../lib/api/architecture-refresh.ts");
const architectureActions = jiti("../../lib/api/architecture-actions.ts");

function run(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

function totalNodes(view) {
  return (
    view.components.length +
    view.components.reduce(
      (count, component) => count + (component.children?.length || 0),
      0
    )
  );
}

const analysis = {
  summary: "Chat messages flow from the UI through the API layer into the storage stack.",
  components: [
    {
      id: "chat-ui",
      label: "Chat Experience",
      description: "User-facing chat pages and interactive chat components.",
      type: "page",
      files: ["app/repo/[owner]/[name]/chat/page.tsx"],
      children: [
        {
          id: "chat-input-ui",
          label: "Chat Input",
          description: "Composer UI and input handling.",
          type: "page",
          files: ["components/chat/ChatInput.tsx"],
        },
      ],
    },
    {
      id: "chat-api",
      label: "Chat API",
      description: "API routes and request validation for chat messages.",
      type: "api",
      files: ["app/api/chat/route.ts"],
    },
    {
      id: "message-engine",
      label: "Message Engine",
      description: "Core services that shape, send, and persist chat data.",
      type: "service",
      files: ["lib/chat/chat-service.ts", "lib/chat/send-message.ts"],
    },
    {
      id: "chat-storage",
      label: "Chat Storage",
      description: "Persistence helpers and Supabase data access.",
      type: "database",
      files: ["lib/data/message-store.ts", "supabase/queries/messages.ts"],
    },
  ],
  connections: [
    {
      id: "chat-ui-to-api",
      source: "chat-ui",
      target: "chat-api",
      label: "POST /api/chat",
      description: "The chat page sends user messages to the chat API route.",
      type: "api_call",
    },
    {
      id: "chat-api-to-service",
      source: "chat-api",
      target: "message-engine",
      label: "Invoke service",
      description: "The API route delegates message handling to the message engine.",
      type: "import",
    },
    {
      id: "service-to-storage",
      source: "message-engine",
      target: "chat-storage",
      label: "Persist message",
      description: "The service stores message records through the data layer.",
      type: "database_query",
    },
  ],
};

const files = [
  {
    file_path: "app/repo/[owner]/[name]/chat/page.tsx",
    file_name: "page.tsx",
    extension: "tsx",
    line_count: 220,
    imports: ["@/components/chat/ChatInput", "@/lib/chat/send-message"],
  },
  {
    file_path: "components/chat/ChatInput.tsx",
    file_name: "ChatInput.tsx",
    extension: "tsx",
    line_count: 110,
    imports: ["@/lib/chat/send-message", "@/components/chat/ComposerToolbar"],
  },
  {
    file_path: "components/chat/ComposerToolbar.tsx",
    file_name: "ComposerToolbar.tsx",
    extension: "tsx",
    line_count: 48,
    imports: [],
  },
  {
    file_path: "components/chat/MessageList.tsx",
    file_name: "MessageList.tsx",
    extension: "tsx",
    line_count: 60,
    imports: [],
  },
  {
    file_path: "app/api/chat/route.ts",
    file_name: "route.ts",
    extension: "ts",
    line_count: 180,
    imports: ["@/lib/chat/chat-service", "@/lib/shared/chat-schema"],
  },
  {
    file_path: "lib/chat/send-message.ts",
    file_name: "send-message.ts",
    extension: "ts",
    line_count: 96,
    imports: ["@/app/api/chat/route", "@/lib/shared/chat-schema"],
  },
  {
    file_path: "lib/chat/chat-service.ts",
    file_name: "chat-service.ts",
    extension: "ts",
    line_count: 150,
    imports: ["@/lib/data/message-store", "@/lib/shared/chat-schema"],
  },
  {
    file_path: "lib/shared/chat-schema.ts",
    file_name: "chat-schema.ts",
    extension: "ts",
    line_count: 72,
    imports: [],
  },
  {
    file_path: "lib/data/message-store.ts",
    file_name: "message-store.ts",
    extension: "ts",
    line_count: 100,
    imports: ["@/supabase/queries/messages"],
  },
  {
    file_path: "supabase/queries/messages.ts",
    file_name: "messages.ts",
    extension: "ts",
    line_count: 88,
    imports: [],
  },
];

const bundle = architectureRefresh.buildArchitectureBundle(analysis, "sha-test-123", files);

run("code layer is denser than the system layer and upgrades schema version", () => {
  assert.equal(bundle.schemaVersion, 3);
  assert.ok(totalNodes(bundle.views.code) > totalNodes(bundle.views.system));
  assert.ok(bundle.views.code.connections.length > bundle.views.system.connections.length);
});

run("shared files are lifted into a cross-cutting code group", () => {
  assert.equal(bundle.codeMetadata.sharedGroupId, "code-cross-cutting-shared");
  const sharedGroup = bundle.views.code.components.find(
    (component) => component.id === bundle.codeMetadata.sharedGroupId
  );
  assert.ok(sharedGroup);
  assert.ok(
    sharedGroup.children?.some(
      (child) => child.files[0] === "lib/shared/chat-schema.ts"
    )
  );

  const messageEngine = bundle.views.code.components.find(
    (component) => component.id === "message-engine"
  );
  assert.ok(messageEngine);
  assert.ok(
    !(messageEngine.children || []).some(
      (child) => child.files[0] === "lib/shared/chat-schema.ts"
    )
  );
});

run("code layer default expansion favors the most connected modules", () => {
  assert.ok(bundle.views.code.defaultExpanded.length > 0);
  assert.ok(bundle.views.code.defaultExpanded.length <= 4);
  assert.ok(
    bundle.views.code.defaultExpanded.every((id) =>
      bundle.views.code.components.some(
        (component) => component.id === id && (component.children?.length || 0) > 0
      )
    )
  );
});

run("routing questions prefer code-level focus and emit trace actions", () => {
  const actions = architectureActions.deriveArchitectureActions({
    bundle,
    defaultLayer: "system",
    query: "Where is the user sending chat messages?",
    citationFiles: [
      "app/repo/[owner]/[name]/chat/page.tsx",
      "app/api/chat/route.ts",
    ],
  });

  assert.ok(actions.some((action) => action.type === "switch_layer" && action.layerId === "code"));
  assert.ok(actions.some((action) => action.type === "expand_groups"));
  const focus = actions.find((action) => action.type === "focus_nodes");
  assert.ok(focus);
  assert.equal(focus.layerId, "code");
  assert.ok(focus.nodeIds.some((nodeId) => nodeId.startsWith("file:")));
  assert.ok(actions.some((action) => action.type === "trace_path"));
});

run("simulation queries emit playback steps for the highlighted code path", () => {
  const actions = architectureActions.deriveArchitectureActions({
    bundle,
    defaultLayer: "system",
    query: "Simulate a message being sent from the UI to storage",
    citationFiles: [
      "app/repo/[owner]/[name]/chat/page.tsx",
      "lib/data/message-store.ts",
    ],
  });

  const simulation = actions.find((action) => action.type === "simulate_flow");
  assert.ok(simulation);
  assert.ok(simulation.steps.length >= 3);
  assert.match(simulation.summary, /Simulating flow from/i);
  assert.equal(simulation.layerId, "code");
});

console.log("All architecture bundle regression checks passed.");
