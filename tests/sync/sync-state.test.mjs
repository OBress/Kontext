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

const syncPipeline = jiti("../../lib/api/sync-pipeline.ts");
const repoChecks = jiti("../../lib/api/repo-checks.ts");
const syncQueue = jiti("../../lib/api/sync-queue.ts");
const architectureRefresh = jiti("../../lib/api/architecture-refresh.ts");

function run(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

async function runAsync(name, fn) {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

run("pending sync replay prefers the stored pending head when no explicit head is provided", () => {
  const target = syncPipeline.resolveSyncHeadTarget({
    explicitHeadSHA: null,
    syncBlockedReason: "pending_user_key_sync",
    pendingHeadSHA: "fd8058bdacc0d805e8bcd0bcb16f51c36a94c842",
  });

  assert.deepEqual(target, {
    targetHeadSHA: "fd8058bdacc0d805e8bcd0bcb16f51c36a94c842",
    usedPendingHead: true,
  });
});

run("explicit sync head wins over any pending blocked head", () => {
  const target = syncPipeline.resolveSyncHeadTarget({
    explicitHeadSHA: "72c1a409a0e9c78d55e61027b71c58b4e7df7cb8",
    syncBlockedReason: "pending_user_key_sync",
    pendingHeadSHA: "fd8058bdacc0d805e8bcd0bcb16f51c36a94c842",
  });

  assert.deepEqual(target, {
    targetHeadSHA: "72c1a409a0e9c78d55e61027b71c58b4e7df7cb8",
    usedPendingHead: false,
  });
});

run("repo health freshness is stale when the latest completed run is behind the synced head", () => {
  const freshness = repoChecks.deriveRepoHealthFreshness({
    currentHeadSha: "fd8058bdacc0d805e8bcd0bcb16f51c36a94c842",
    latestCompletedHeadSha: "a9054621b8a1a565f97694c1428849ed8189d8b2",
  });

  assert.equal(freshness.isCurrent, false);
  assert.equal(
    freshness.currentHeadSha,
    "fd8058bdacc0d805e8bcd0bcb16f51c36a94c842"
  );
  assert.equal(
    freshness.latestCompletedHeadSha,
    "a9054621b8a1a565f97694c1428849ed8189d8b2"
  );
});

run("repo health freshness is current when the completed run matches the synced head", () => {
  const freshness = repoChecks.deriveRepoHealthFreshness({
    currentHeadSha: "fd8058bdacc0d805e8bcd0bcb16f51c36a94c842",
    latestCompletedHeadSha: "fd8058bdacc0d805e8bcd0bcb16f51c36a94c842",
  });

  assert.equal(freshness.isCurrent, true);
});

run("architecture refresh task ids stay unique per repository and sha", () => {
  const first = architectureRefresh.buildArchitectureRefreshTaskId(
    "owen/kontext",
    "sha-123"
  );
  const second = architectureRefresh.buildArchitectureRefreshTaskId(
    "owen/other-repo",
    "sha-123"
  );

  assert.notEqual(first, second);
  assert.match(first, /owen\/kontext/);
});

await runAsync("queued architecture refreshes deduplicate before they start running", async () => {
  syncQueue.resetSyncQueueForTests();
  try {
    const releases = [];
    const blockers = Array.from(
      { length: syncQueue.MAX_CONCURRENT_PER_USER },
      (_, index) => {
        const hold = new Promise((resolve) => {
          releases.push(resolve);
        });

        const result = syncQueue.enqueueAiTask({
          userId: "user-1",
          repoFullName: `owen/blocker-${index}`,
          taskId: `blocker:${index}`,
          execute: () => hold,
        });

        assert.equal(result.status, "started");
        return hold;
      }
    );

    let executions = 0;
    let queuedRunResolve;
    const queuedRun = new Promise((resolve) => {
      queuedRunResolve = resolve;
    });
    const taskId = architectureRefresh.buildArchitectureRefreshTaskId(
      "owen/kontext",
      "sha-queued"
    );

    const first = syncQueue.enqueueAiTask({
      userId: "user-1",
      repoFullName: "owen/kontext",
      taskId,
      execute: async () => {
        executions += 1;
        queuedRunResolve();
      },
    });
    const second = syncQueue.enqueueAiTask({
      userId: "user-1",
      repoFullName: "owen/kontext",
      taskId,
      execute: async () => {
        executions += 1;
        queuedRunResolve();
      },
    });

    assert.equal(first.status, "queued");
    assert.equal(second.status, "deduplicated");

    releases.forEach((release) => release());
    await Promise.all(blockers);
    await queuedRun;

    assert.equal(executions, 1);
  } finally {
    syncQueue.resetSyncQueueForTests();
  }
});

console.log("All sync state regression checks passed.");
