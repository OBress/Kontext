import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/api/auth";
import crypto from "crypto";
import { logActivity } from "@/lib/api/activity";
import { resolveAiKey } from "@/lib/api/ai-key";
import { summarizeAndEmbedCommits } from "@/lib/api/timeline-ai";


const WEBHOOK_SECRET = process.env.GITHUB_WEBHOOK_SECRET || "";

/**
 * POST /api/webhooks/github — Receives GitHub push events
 *
 * Validates signature, deduplicates by delivery ID, and triggers
 * incremental sync for repos with auto_sync_enabled.
 */
export async function POST(request: Request) {
  try {
    const body = await request.text();
    const signature = request.headers.get("x-hub-signature-256") || "";
    const deliveryId = request.headers.get("x-github-delivery") || "";
    const event = request.headers.get("x-github-event") || "";

    // ── Validate webhook secret ──
    if (!WEBHOOK_SECRET) {
      console.error("[webhook] GITHUB_WEBHOOK_SECRET not configured");
      return NextResponse.json({ error: "Webhook not configured" }, { status: 500 });
    }

    // Verify HMAC-SHA256 signature
    const expected = "sha256=" + crypto
      .createHmac("sha256", WEBHOOK_SECRET)
      .update(body)
      .digest("hex");

    const sigBuffer = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expected);

    if (sigBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(sigBuffer, expectedBuffer)) {
      console.warn("[webhook] Invalid signature for delivery:", deliveryId);
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }

    const payload = JSON.parse(body);
    const adminDb = await createAdminClient();

    // ── Handle ping (webhook health check) ──
    if (event === "ping") {
      console.log("[webhook] Ping received for repo:", payload.repository?.full_name);
      return NextResponse.json({ ok: true, event: "ping" });
    }

    // ── Handle push events ──
    if (event === "push") {
      const repoFullName = payload.repository?.full_name;
      const branch = payload.ref?.replace("refs/heads/", "") || "";
      const headSHA = payload.after;
      const commits = payload.commits || [];
      const pusher = payload.pusher?.name || payload.sender?.login || "Unknown";

      if (!repoFullName || !headSHA) {
        return NextResponse.json({ error: "Invalid push payload" }, { status: 400 });
      }

      // Log activity for all users who have this repo
      const { data: repos } = await adminDb
        .from("repos")
        .select("id, user_id, full_name, watched_branch, last_synced_sha, auto_sync_enabled")
        .eq("full_name", repoFullName);

      if (repos) {
        for (const repo of repos) {
          // Log the push activity event
          const commitCount = commits.length;
          const latestMessage = commits[commits.length - 1]?.message || "";
          logActivity({
            userId: repo.user_id,
            repoFullName: repoFullName,
            source: "github",
            eventType: "push",
            title: `${commitCount} commit${commitCount !== 1 ? "s" : ""} pushed to ${branch}`,
            description: latestMessage.split("\n")[0].slice(0, 120),
            metadata: {
              sha: headSHA,
              branch,
              commit_count: commitCount,
              author: pusher,
              avatar_url: payload.sender?.avatar_url,
            },
          });

          // ── Store commits in repo_commits with push grouping ──
          interface WebhookCommit {
            id: string;
            message: string;
            timestamp: string;
            author?: { name?: string };
            added?: string[];
            modified?: string[];
            removed?: string[];
          }
          const commitRows = commits.map((c: WebhookCommit) => ({
            user_id: repo.user_id,
            repo_full_name: repoFullName,
            sha: c.id,
            message: c.message,
            author_name: c.author?.name || pusher,
            author_avatar_url: payload.sender?.avatar_url || null,
            committed_at: c.timestamp || new Date().toISOString(),
            files_changed: [
              ...(c.added || []).map((f: string) => ({ path: f, status: "added" })),
              ...(c.modified || []).map((f: string) => ({ path: f, status: "modified" })),
              ...(c.removed || []).map((f: string) => ({ path: f, status: "removed" })),
            ],
            push_group_id: deliveryId || `push-${Date.now()}`,
            sync_triggered: !!repo.auto_sync_enabled,
          }));

          if (commitRows.length > 0) {
            await adminDb.from("repo_commits").upsert(commitRows, {
              onConflict: "user_id,repo_full_name,sha",
              ignoreDuplicates: true,
            });
          }

          // ── AI Summarize commits (fire-and-forget) ──
          resolveAiKey(repo.user_id)
            .then(async (aiKey) => {
              if (!aiKey || commitRows.length === 0) return;
              try {
                const commitsForAi = commitRows.map((r: { sha: string; message: string; files_changed: { path: string; status: string }[] }) => ({
                  sha: r.sha,
                  message: r.message,
                  files_changed: r.files_changed,
                }));
                const { summaries, embeddings } = await summarizeAndEmbedCommits(
                  aiKey,
                  commitsForAi
                );
                for (let i = 0; i < commitRows.length; i++) {
                  await adminDb
                    .from("repo_commits")
                    .update({
                      ai_summary: summaries[i],
                      ai_summary_embedding: JSON.stringify(embeddings[i]),
                    })
                    .eq("user_id", repo.user_id)
                    .eq("repo_full_name", repoFullName)
                    .eq("sha", commitRows[i].sha);
                }
                console.log(
                  `[webhook] AI summaries generated for ${summaries.length} commits on ${repoFullName}`
                );
              } catch (err) {
                console.warn("[webhook] AI summary generation failed:", err);
              }
            })
            .catch(() => {});

          // Trigger auto-sync if enabled
          if (repo.auto_sync_enabled) {
            const watchedBranch = repo.watched_branch || "main";
            if (branch === watchedBranch && repo.last_synced_sha !== headSHA) {
              const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || process.env.VERCEL_URL || "http://localhost:3000";
              fetch(`${baseUrl}/api/repos/sync`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  repo_full_name: repoFullName,
                  user_id: repo.user_id,
                  head_sha: headSHA,
                  webhook_triggered: true,
                }),
              }).catch((err) => {
                console.error("[webhook] Failed to trigger sync for", repoFullName, err.message);
              });
            }
          }
        }
      }

      // Mark webhook as processed
      if (deliveryId) {
        await adminDb
          .from("webhook_events")
          .update({ processed: true })
          .eq("delivery_id", deliveryId);
      }

      console.log(`[webhook] Push to ${repoFullName}/${branch} — ${commits.length} commits`);
      return NextResponse.json({ ok: true, event: "push" });
    }

    // ── Handle pull_request events ──
    if (event === "pull_request") {
      const pr = payload.pull_request;
      const repoFullName = payload.repository?.full_name;
      const action = payload.action; // opened, closed, merged, etc.

      if (repoFullName && pr) {
        const { data: repos } = await adminDb
          .from("repos")
          .select("user_id")
          .eq("full_name", repoFullName);

        if (repos) {
          const isMerged = action === "closed" && pr.merged;
          const verb = isMerged ? "merged" : action;
          for (const repo of repos) {
            logActivity({
              userId: repo.user_id,
              repoFullName,
              source: "github",
              eventType: "pull_request",
              title: `PR #${pr.number} ${verb}`,
              description: pr.title?.slice(0, 120),
              metadata: {
                pr_number: pr.number,
                action,
                merged: isMerged,
                author: pr.user?.login,
                avatar_url: pr.user?.avatar_url,
              },
            });
          }
        }
      }

      if (deliveryId) {
        await adminDb.from("webhook_events").update({ processed: true }).eq("delivery_id", deliveryId);
      }
      return NextResponse.json({ ok: true, event: "pull_request" });
    }

    // ── Handle issues events ──
    if (event === "issues") {
      const issue = payload.issue;
      const repoFullName = payload.repository?.full_name;
      const action = payload.action;

      if (repoFullName && issue && ["opened", "closed", "reopened"].includes(action)) {
        const { data: repos } = await adminDb
          .from("repos")
          .select("user_id")
          .eq("full_name", repoFullName);

        if (repos) {
          for (const repo of repos) {
            logActivity({
              userId: repo.user_id,
              repoFullName,
              source: "github",
              eventType: "issue",
              title: `Issue #${issue.number} ${action}`,
              description: issue.title?.slice(0, 120),
              metadata: {
                issue_number: issue.number,
                action,
                author: issue.user?.login,
                avatar_url: issue.user?.avatar_url,
              },
            });
          }
        }
      }

      if (deliveryId) {
        await adminDb.from("webhook_events").update({ processed: true }).eq("delivery_id", deliveryId);
      }
      return NextResponse.json({ ok: true, event: "issues" });
    }

    // ── Handle create events (branch/tag) ──
    if (event === "create") {
      const refType = payload.ref_type; // branch or tag
      const ref = payload.ref;
      const repoFullName = payload.repository?.full_name;

      if (repoFullName && ref) {
        const { data: repos } = await adminDb
          .from("repos")
          .select("user_id")
          .eq("full_name", repoFullName);

        if (repos) {
          for (const repo of repos) {
            logActivity({
              userId: repo.user_id,
              repoFullName,
              source: "github",
              eventType: "create",
              title: `${refType} "${ref}" created`,
              metadata: { ref_type: refType, ref, sender: payload.sender?.login },
            });
          }
        }
      }

      if (deliveryId) {
        await adminDb.from("webhook_events").update({ processed: true }).eq("delivery_id", deliveryId);
      }
      return NextResponse.json({ ok: true, event: "create" });
    }

    // ── Handle release events ──
    if (event === "release" && payload.action === "published") {
      const release = payload.release;
      const repoFullName = payload.repository?.full_name;

      if (repoFullName && release) {
        const { data: repos } = await adminDb
          .from("repos")
          .select("user_id")
          .eq("full_name", repoFullName);

        if (repos) {
          for (const repo of repos) {
            logActivity({
              userId: repo.user_id,
              repoFullName,
              source: "github",
              eventType: "release",
              title: `Release ${release.tag_name} published`,
              description: release.name?.slice(0, 120),
              metadata: {
                tag: release.tag_name,
                prerelease: release.prerelease,
                author: release.author?.login,
              },
            });
          }
        }
      }

      if (deliveryId) {
        await adminDb.from("webhook_events").update({ processed: true }).eq("delivery_id", deliveryId);
      }
      return NextResponse.json({ ok: true, event: "release" });
    }

    // ── Unhandled event type — skip ──
    if (deliveryId) {
      await adminDb.from("webhook_events").update({ processed: true }).eq("delivery_id", deliveryId);
    }
    return NextResponse.json({ ok: true, event, skipped: true });

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[webhook] Error:", message);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
