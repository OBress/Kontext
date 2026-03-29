import crypto from "crypto";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/api/auth";
import { resolveAiKey } from "@/lib/api/ai-key";
import { logActivity } from "@/lib/api/activity";
import { summarizeAndEmbedCommits } from "@/lib/api/timeline-ai";

const WEBHOOK_SECRET = process.env.GITHUB_WEBHOOK_SECRET || "";

interface WebhookCommit {
  id: string;
  message: string;
  timestamp: string;
  author?: { name?: string };
  added?: string[];
  modified?: string[];
  removed?: string[];
}

type AdminDb = Awaited<ReturnType<typeof createAdminClient>>;

function formatWorkflowConclusion(conclusion?: string | null) {
  return (conclusion || "completed").replace(/_/g, " ");
}

async function markProcessed(adminDb: AdminDb, deliveryId: string) {
  if (!deliveryId) return;

  await adminDb
    .from("webhook_events")
    .update({ processed: true })
    .eq("delivery_id", deliveryId);
}

async function registerWebhookEvent(
  adminDb: AdminDb,
  deliveryId: string,
  repoFullName: string,
  event: string,
  payload: unknown
) {
  if (!deliveryId) return true;

  const { error } = await adminDb.from("webhook_events").insert({
    delivery_id: deliveryId,
    repo_full_name: repoFullName,
    event_type: event,
    payload,
    processed: false,
  });

  if (!error) return true;
  if ((error as { code?: string }).code === "23505") {
    return false;
  }

  throw error;
}

export async function POST(request: Request) {
  try {
    const body = await request.text();
    const signature = request.headers.get("x-hub-signature-256") || "";
    const deliveryId = request.headers.get("x-github-delivery") || "";
    const event = request.headers.get("x-github-event") || "";

    if (!WEBHOOK_SECRET) {
      console.error("[webhook] GITHUB_WEBHOOK_SECRET not configured");
      return NextResponse.json({ error: "Webhook not configured" }, { status: 500 });
    }

    const expected =
      "sha256=" +
      crypto.createHmac("sha256", WEBHOOK_SECRET).update(body).digest("hex");

    const sigBuffer = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expected);

    if (
      sigBuffer.length !== expectedBuffer.length ||
      !crypto.timingSafeEqual(sigBuffer, expectedBuffer)
    ) {
      console.warn("[webhook] Invalid signature for delivery:", deliveryId);
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }

    const payload = JSON.parse(body);
    const adminDb = await createAdminClient();
    const repoFullName = payload.repository?.full_name || "unknown/unknown";

    const shouldProcess = await registerWebhookEvent(
      adminDb,
      deliveryId,
      repoFullName,
      event,
      payload
    );

    if (!shouldProcess) {
      return NextResponse.json({ ok: true, duplicate: true, event });
    }

    if (event === "ping") {
      console.log("[webhook] Ping received for repo:", payload.repository?.full_name);
      await markProcessed(adminDb, deliveryId);
      return NextResponse.json({ ok: true, event: "ping" });
    }

    if (event === "push") {
      const repoFullName = payload.repository?.full_name;
      const branch = payload.ref?.replace("refs/heads/", "") || "";
      const headSHA = payload.after;
      const commits = (payload.commits || []) as WebhookCommit[];
      const pusher = payload.pusher?.name || payload.sender?.login || "Unknown";

      if (!repoFullName || !headSHA) {
        return NextResponse.json({ error: "Invalid push payload" }, { status: 400 });
      }

      const { data: repos } = await adminDb
        .from("repos")
        .select(
          "id, user_id, full_name, watched_branch, last_synced_sha, auto_sync_enabled"
        )
        .eq("full_name", repoFullName);

      if (repos) {
        for (const repo of repos) {
          const commitCount = commits.length;
          const latestMessage = commits[commits.length - 1]?.message || "";

          logActivity({
            userId: repo.user_id,
            repoFullName,
            source: "github",
            eventType: "push",
            title: `${commitCount} commit${commitCount === 1 ? "" : "s"} pushed to ${branch}`,
            description: latestMessage.split("\n")[0].slice(0, 120),
            metadata: {
              sha: headSHA,
              branch,
              commit_count: commitCount,
              author: pusher,
              avatar_url: payload.sender?.avatar_url,
            },
          });

          const pushGroupId = deliveryId || `push-${Date.now()}`;
          const commitRows = commits.map((commit) => ({
            user_id: repo.user_id,
            repo_full_name: repoFullName,
            sha: commit.id,
            message: commit.message,
            author_name: commit.author?.name || pusher,
            author_avatar_url: payload.sender?.avatar_url || null,
            committed_at: commit.timestamp || new Date().toISOString(),
            files_changed: [
              ...(commit.added || []).map((path) => ({ path, status: "added" })),
              ...(commit.modified || []).map((path) => ({
                path,
                status: "modified",
              })),
              ...(commit.removed || []).map((path) => ({
                path,
                status: "removed",
              })),
            ],
            push_group_id: pushGroupId,
            sync_triggered: Boolean(repo.auto_sync_enabled),
          }));

          if (commitRows.length > 0) {
            await adminDb.from("repo_commits").upsert(commitRows, {
              onConflict: "user_id,repo_full_name,sha",
              ignoreDuplicates: true,
            });
          }

          resolveAiKey(repo.user_id)
            .then(async (aiKey) => {
              if (!aiKey || commitRows.length === 0) return;

              try {
                const commitsForAi = commitRows.map((row) => ({
                  sha: row.sha,
                  message: row.message,
                  files_changed: row.files_changed,
                }));
                const { summaries, embeddings } = await summarizeAndEmbedCommits(
                  aiKey,
                  commitsForAi
                );

                for (let i = 0; i < commitRows.length; i += 1) {
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
              } catch (error) {
                console.warn("[webhook] AI summary generation failed:", error);
              }
            })
            .catch(() => {});

          if (repo.auto_sync_enabled) {
            const watchedBranch = repo.watched_branch || "main";
            if (branch === watchedBranch && repo.last_synced_sha !== headSHA) {
              const baseUrl =
                process.env.NEXT_PUBLIC_SITE_URL ||
                process.env.VERCEL_URL ||
                "http://localhost:3000";

              fetch(`${baseUrl}/api/repos/sync`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  repo_full_name: repoFullName,
                  user_id: repo.user_id,
                  head_sha: headSHA,
                  webhook_triggered: true,
                }),
              }).catch((error) => {
                console.error(
                  "[webhook] Failed to trigger sync for",
                  repoFullName,
                  error.message
                );
              });
            }
          }
        }
      }

      await markProcessed(adminDb, deliveryId);

      console.log(
        `[webhook] Push to ${repoFullName}/${branch} - ${commits.length} commits`
      );
      return NextResponse.json({ ok: true, event: "push" });
    }

    if (event === "pull_request") {
      const pr = payload.pull_request;
      const repoFullName = payload.repository?.full_name;
      const action = payload.action;

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

      await markProcessed(adminDb, deliveryId);
      return NextResponse.json({ ok: true, event: "pull_request" });
    }

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

      await markProcessed(adminDb, deliveryId);
      return NextResponse.json({ ok: true, event: "issues" });
    }

    if (event === "create") {
      const refType = payload.ref_type;
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
              metadata: {
                ref_type: refType,
                ref,
                sender: payload.sender?.login,
              },
            });
          }
        }
      }

      await markProcessed(adminDb, deliveryId);
      return NextResponse.json({ ok: true, event: "create" });
    }

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

      await markProcessed(adminDb, deliveryId);
      return NextResponse.json({ ok: true, event: "release" });
    }

    if (event === "workflow_run") {
      const workflowRun = payload.workflow_run;
      const repoFullName = payload.repository?.full_name;

      if (repoFullName && workflowRun && payload.action === "completed") {
        const { data: repos } = await adminDb
          .from("repos")
          .select("user_id")
          .eq("full_name", repoFullName);

        if (repos) {
          const conclusion = formatWorkflowConclusion(workflowRun.conclusion);
          const branch = workflowRun.head_branch || "unknown";

          for (const repo of repos) {
            logActivity({
              userId: repo.user_id,
              repoFullName,
              source: "github",
              eventType: "workflow_run",
              title: `${workflowRun.name || "Workflow"} ${conclusion}`,
              description:
                workflowRun.display_title?.slice(0, 120) || `Branch: ${branch}`,
              metadata: {
                run_id: workflowRun.id,
                branch,
                status: workflowRun.status,
                conclusion: workflowRun.conclusion,
                event: workflowRun.event,
                actor: payload.sender?.login,
                avatar_url: payload.sender?.avatar_url,
                html_url: workflowRun.html_url,
              },
            });
          }
        }
      }

      await markProcessed(adminDb, deliveryId);
      return NextResponse.json({ ok: true, event: "workflow_run" });
    }

    await markProcessed(adminDb, deliveryId);
    return NextResponse.json({ ok: true, event, skipped: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[webhook] Error:", message);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
