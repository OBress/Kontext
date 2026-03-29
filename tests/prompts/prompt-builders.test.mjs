import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import createJiti from "jiti";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..");
const fixturePath = path.join(__dirname, "fixtures", "repo-prompt-fixture.json");
const fixture = JSON.parse(await readFile(fixturePath, "utf8"));

const jiti = createJiti(import.meta.url, {
  alias: {
    "@": repoRoot
  }
});
const repoIntelligence = jiti("../../lib/api/repo-intelligence.ts");
const onboarding = jiti("../../lib/api/onboarding.ts");
const repoChecks = jiti("../../lib/api/repo-checks.ts");
const architecture = jiti("../../lib/api/architecture-analyzer.ts");
const ruleGenerator = jiti("../../lib/api/rule-generator.ts");

function run(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

run("repo Q&A keeps repo context in the user prompt and not the system prompt", () => {
  const systemPrompt = repoIntelligence.buildRepoAnswerSystemPrompt();
  const userPrompt = repoIntelligence.buildRepoAnswerPrompt({
    repoFullName: fixture.repoFullName,
    question: fixture.repoQuestion.question,
    fileManifest: fixture.repoQuestion.fileManifest,
    contextBlocks: fixture.repoQuestion.contextBlocks,
    timelineBlocks: fixture.repoQuestion.timelineBlocks,
    extraInstructions: "Mention architectural component names when possible.",
  });

  assert.match(systemPrompt, /grounded repository explainer/i);
  assert.doesNotMatch(systemPrompt, /acme\/kontext/);
  assert.match(userPrompt, /Repository file manifest/);
  assert.match(userPrompt, /Retrieved code context/);
  assert.match(userPrompt, /Development timeline context/);
  assert.match(userPrompt, /Additional instruction: Mention architectural component names when possible\./);
});

run("repo checks prompt includes evidence sections and a skeptical confidence rubric", () => {
  const prompt = repoChecks.buildRepoCheckPrompt({
    repoFullName: fixture.repoFullName,
    triggerMode: fixture.repoChecks.triggerMode,
    baseSha: fixture.repoChecks.baseSha,
    headSha: fixture.repoChecks.headSha,
    checkTypes: ["security", "change_impact"],
    changedFiles: fixture.repoChecks.changedFiles,
    manifest: fixture.repoChecks.manifest,
    fileBlocks: fixture.repoChecks.fileBlocks,
    recentCommitSummary: fixture.repoChecks.recentCommitSummary,
    openFindingSummary: fixture.repoChecks.openFindingSummary,
  });

  assert.match(prompt, /Review the repository update evidence/i);
  assert.match(prompt, /Confidence rubric: 0\.9 direct evidence, 0\.7 strong signal, 0\.5 partial but still actionable\./);
  assert.match(prompt, /Prefer 0 findings over weak speculation\./);
  assert.match(prompt, /Current file context/);
});

run("onboarding prompt enforces the walkthrough progression and repo grounding", () => {
  const prompt = onboarding.buildOnboardingPrompt({
    repoFullName: fixture.repoFullName,
    repoDescription: fixture.onboarding.repoDescription,
    language: fixture.onboarding.language,
    defaultBranch: fixture.onboarding.defaultBranch,
    lastSyncedSha: fixture.onboarding.lastSyncedSha,
    fileManifest: fixture.onboarding.fileManifest,
    recentCommits: fixture.onboarding.recentCommits,
    architectureSummary: fixture.onboarding.architectureSummary,
  });

  assert.match(prompt, /Sequence the walkthrough from orientation, to local workflow, to key systems, to practical exploration, then reinforcement\./);
  assert.match(prompt, /Include exactly 1 quiz step and exactly 1 acknowledgement step\./);
  assert.match(prompt, /File manifest/);
  assert.match(prompt, /Architecture summary/);
});

run("architecture prompt allows unassigned files and avoids fake exhaustive grouping", () => {
  const prompt = architecture.buildAnalysisPrompt(
    fixture.repoFullName,
    fixture.files,
    fixture.architecture.chunkSamples
  );

  assert.match(prompt, /Use unassignedFiles for meaningful leftovers/);
  assert.match(prompt, /Do not force every file into a component/);
  assert.match(prompt, /Representative code samples/);
});

run("rule generator root prompt combines deterministic facts with raw excerpts", () => {
  const facts = ruleGenerator.extractDeterministicRuleFacts(
    fixture.configChunks,
    fixture.files,
    fixture.scopeContexts
  );
  const prompt = ruleGenerator.buildRuleRootPrompt({
    repoFullName: fixture.repoFullName,
    targetDisplay: fixture.targetDisplay,
    facts,
    configChunks: fixture.configChunks,
    rootChunks: fixture.evidenceChunks,
    architectureAnalysis: fixture.onboarding.architectureSummary,
    activeScopes: fixture.scopeContexts,
    customInstructions: fixture.customInstructions,
  });

  assert.match(prompt, /Seed stack facts/);
  assert.match(prompt, /AGENTS\.md/);
  assert.match(prompt, /README\.md/);
  assert.match(prompt, /Project Overview, Tech Stack, Directory Structure, Commands, Coding Standards, Error Handling, Security Practices, Documentation Practices, Git Workflow, Definition of Done/);
  assert.match(prompt, /Highlight security-sensitive data handling and Supabase patterns\./);
  assert.match(prompt, /use the existing docs\/ directory, or create docs\/ if it is missing/i);
});

run("rule generator scope prompt keeps scope detail specialized and surfaces weak evidence", () => {
  const facts = ruleGenerator.extractDeterministicRuleFacts(
    fixture.configChunks,
    fixture.files,
    fixture.scopeContexts
  );
  const apiScope = fixture.scopeContexts.find((scope) => scope.scope === "api");
  assert.ok(apiScope);
  const prompt = ruleGenerator.buildRuleScopePrompt({
    repoFullName: fixture.repoFullName,
    targetDisplay: fixture.targetDisplay,
    scope: apiScope,
    rootSummary: "Repository rules generated from mixed evidence.",
    facts,
    scopeChunks: fixture.evidenceChunks,
    customInstructions: fixture.customInstructions,
  });

  assert.match(prompt, /Generate the api scoped repository instruction guide/i);
  assert.match(prompt, /Scope globs/);
  assert.match(prompt, /app\/api\/chat\/route\.ts/);
  assert.match(prompt, /avoid repeating generic repo-wide rules from the root guide/i);
});

run("stack merge preserves deterministic facts and deduplicates model overlap", () => {
  const merged = ruleGenerator.mergeDetectedStack(
    [
      { name: "Next.js 16.0.6", category: "Framework", confidence: 95 },
      { name: "TypeScript ^5.0.0", category: "Language", confidence: 95 }
    ],
    [
      { name: "Next.js 16.0.6", category: "Framework", confidence: 80 },
      { name: "Supabase ^2.100.1", category: "Database", confidence: 75 }
    ]
  );

  assert.equal(merged.length, 3);
  assert.deepEqual(merged.map((item) => item.name), [
    "Next.js 16.0.6",
    "TypeScript ^5.0.0",
    "Supabase ^2.100.1"
  ]);
});

console.log("All prompt regression checks passed.");
