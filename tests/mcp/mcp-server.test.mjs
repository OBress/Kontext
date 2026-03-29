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

const mcpServer = jiti("../../lib/mcp/server.ts");

function run(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

run("account-wide keys can target a specific repository", () => {
  const resolved = mcpServer.resolveRepoScope(null, "owen/kontext");
  assert.equal(resolved, "owen/kontext");
});

run("repo-scoped keys default to their scoped repository", () => {
  const resolved = mcpServer.resolveRepoScope("owen/kontext", null);
  assert.equal(resolved, "owen/kontext");
});

run("repo-scoped keys cannot escape their repository scope", () => {
  assert.throws(
    () => mcpServer.resolveRepoScope("owen/kontext", "owen/other-repo"),
    /scoped to a different repository/i
  );
});

run("resource URIs parse dashboard and repo views correctly", () => {
  assert.deepEqual(
    mcpServer.parseKontextResourceUri("kontext://dashboard/repos"),
    { kind: "dashboard-repos" }
  );

  assert.deepEqual(
    mcpServer.parseKontextResourceUri(
      "kontext://repo/owen%2Fkontext/checks-findings"
    ),
    {
      kind: "repo-check-findings",
      repoFullName: "owen/kontext",
    }
  );
});

run("server capabilities advertise tools, resources, and prompts", () => {
  assert.deepEqual(mcpServer.MCP_SERVER_CAPABILITIES, {
    tools: { listChanged: false },
    resources: { listChanged: false },
    prompts: { listChanged: false },
  });
});

console.log("All MCP server regression checks passed.");
process.exit(0);
