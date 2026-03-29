#!/usr/bin/env node

/**
 * Kontext DevPost Screenshot Script
 * -----------------------------------
 * Opens a visible browser, lets you log in manually via GitHub,
 * then captures full-page screenshots of every page.
 *
 * Usage:
 *   node scripts/take-screenshots.mjs
 *
 * Output:
 *   Screenshots are saved to ./screenshots/
 */

import puppeteer from "puppeteer";
import { mkdir } from "fs/promises";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { createInterface } from "readline";

// ─── Configuration ──────────────────────────────────────────────────────────

const CONFIG = {
  BASE_URL: "http://localhost:3000",

  // Replace with an actual repo you have synced in Kontext
  REPO_OWNER: "OBress",
  REPO_NAME: "Kontext",

  // Viewport settings (16:10 widescreen for crisp DevPost images)
  VIEWPORT: { width: 1920, height: 1080 },

  // How long to wait after navigation for animations/data to load (ms)
  SETTLE_DELAY: 4000,

  // Output directory (relative to project root)
  OUTPUT_DIR: "screenshots",
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function prompt(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

async function takeScreenshot(page, url, filepath, description, extraDelay = 0) {
  process.stdout.write(`  📸 ${description}... `);
  try {
    await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 });

    // Wait for content to settle (animations, lazy data)
    await page.evaluate(
      (ms) => new Promise((r) => setTimeout(r, ms)),
      CONFIG.SETTLE_DELAY + extraDelay
    );

    // Dismiss any modals/toasts that might be in the way
    await page.evaluate(() => {
      document
        .querySelectorAll('[role="status"], .toast, [data-sonner-toast]')
        .forEach((el) => el.remove());
    });
    await page.evaluate(() => new Promise((r) => setTimeout(r, 300)));

    await page.screenshot({ path: filepath, fullPage: true, type: "png" });
    console.log("✅");
    return true;
  } catch (err) {
    console.log(`❌ ${err.message}`);
    return false;
  }
}

// ─── Main Script ─────────────────────────────────────────────────────────────

async function main() {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const projectRoot = join(__dirname, "..");
  const outputDir = join(projectRoot, CONFIG.OUTPUT_DIR);
  const { REPO_OWNER: owner, REPO_NAME: name } = CONFIG;

  await mkdir(outputDir, { recursive: true });

  console.log("");
  console.log("╔══════════════════════════════════════════════════════════╗");
  console.log("║          🚀 Kontext DevPost Screenshot Script           ║");
  console.log("╚══════════════════════════════════════════════════════════╝");
  console.log(`  Output:   ${outputDir}`);
  console.log(`  Base URL: ${CONFIG.BASE_URL}`);
  console.log(`  Repo:     ${owner}/${name}`);
  console.log("");

  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: CONFIG.VIEWPORT,
    args: [
      "--start-maximized",
      "--disable-infobars",
      "--force-device-scale-factor=1",
    ],
  });

  const page = await browser.newPage();
  const results = [];

  // ─── Phase 1: Public pages (before login) ─────────────────────────────
  console.log("━━━ Phase 1: Public Pages ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  results.push({
    name: "01-landing",
    ok: await takeScreenshot(
      page,
      CONFIG.BASE_URL,
      join(outputDir, "01-landing.png"),
      "Landing Page"
    ),
  });

  results.push({
    name: "02-login",
    ok: await takeScreenshot(
      page,
      `${CONFIG.BASE_URL}/login`,
      join(outputDir, "02-login.png"),
      "Login Page"
    ),
  });

  // ─── Phase 2: Manual login ─────────────────────────────────────────────
  console.log("");
  console.log("━━━ Phase 2: Manual Login ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("");
  console.log("  👉 The browser is open on the login page.");
  console.log("  👉 Click 'Sign in with GitHub' and complete the login flow.");
  console.log("  👉 Wait until you see the Dashboard, then come back here.");
  console.log("");

  await prompt("  ⏳ Press ENTER here once you are logged in... ");

  // Give the app a moment to fully hydrate after login
  console.log("  🔄 Waiting for session to stabilize...");
  await page.goto(`${CONFIG.BASE_URL}/dashboard`, {
    waitUntil: "networkidle2",
    timeout: 30000,
  });
  await page.evaluate(() => new Promise((r) => setTimeout(r, 3000)));

  console.log("  ✅ Authenticated! Continuing with screenshots.\n");

  // ─── Phase 3: Authenticated pages ──────────────────────────────────────
  console.log("━━━ Phase 3: Authenticated Pages ━━━━━━━━━━━━━━━━━━━━━━━━");

  results.push({
    name: "03-dashboard",
    ok: await takeScreenshot(
      page,
      `${CONFIG.BASE_URL}/dashboard`,
      join(outputDir, "03-dashboard.png"),
      "Dashboard"
    ),
  });

  // ─── Phase 4: Repository pages ─────────────────────────────────────────
  console.log("");
  console.log("━━━ Phase 4: Repository Pages ━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  const repoBase = `${CONFIG.BASE_URL}/repo/${owner}/${name}`;

  const repoPages = [
    { name: "04-repo-overview", path: "", desc: "Repository Overview" },
    { name: "05-repo-chat", path: "/chat", desc: "AI Chat", extraDelay: 2000 },
    { name: "06-repo-graph", path: "/graph", desc: "Dependency Graph", extraDelay: 3000 },
    { name: "07-repo-checks", path: "/checks", desc: "Health Checks" },
    { name: "08-repo-prompts", path: "/prompts", desc: "Prompt Templates" },
    { name: "09-repo-team", path: "/team", desc: "Team Management" },
    { name: "10-repo-settings", path: "/settings", desc: "Repository Settings" },
    { name: "11-repo-onboarding", path: "/onboarding", desc: "Onboarding" },
  ];

  for (const rp of repoPages) {
    results.push({
      name: rp.name,
      ok: await takeScreenshot(
        page,
        `${repoBase}${rp.path}`,
        join(outputDir, `${rp.name}.png`),
        rp.desc,
        rp.extraDelay || 0
      ),
    });
  }

  // ─── Phase 5: Global settings pages ────────────────────────────────────
  console.log("");
  console.log("━━━ Phase 5: Global Pages ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  results.push({
    name: "12-mcp",
    ok: await takeScreenshot(
      page,
      `${CONFIG.BASE_URL}/mcp`,
      join(outputDir, "12-mcp.png"),
      "MCP Server Configuration"
    ),
  });

  results.push({
    name: "13-user-settings",
    ok: await takeScreenshot(
      page,
      `${CONFIG.BASE_URL}/settings`,
      join(outputDir, "13-user-settings.png"),
      "User Settings"
    ),
  });

  // ─── Summary ───────────────────────────────────────────────────────────
  console.log("");
  console.log("╔══════════════════════════════════════════════════════════╗");
  console.log("║                 📋 Screenshot Summary                   ║");
  console.log("╚══════════════════════════════════════════════════════════╝");

  const succeeded = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok).length;

  for (const r of results) {
    console.log(`  ${r.ok ? "✅" : "❌"} ${r.name}`);
  }

  console.log("");
  console.log(`  Total: ${results.length} | ✅ ${succeeded} | ❌ ${failed}`);
  console.log(`  📁 ${outputDir}`);
  console.log("");

  await browser.close();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
