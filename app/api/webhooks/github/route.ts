import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/api/auth";
import crypto from "crypto";

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
    const adminDb = createAdminClient();

    // ── Handle ping (webhook health check) ──
    if (event === "ping") {
      console.log("[webhook] Ping received for repo:", payload.repository?.full_name);
      return NextResponse.json({ ok: true, event: "ping" });
    }

    // ── Handle push events ──
    if (event !== "push") {
      return NextResponse.json({ ok: true, event, skipped: true });
    }

    const repoFullName = payload.repository?.full_name;
    const branch = payload.ref?.replace("refs/heads/", "") || "";
    const headSHA = payload.after;

    if (!repoFullName || !headSHA) {
      return NextResponse.json({ error: "Invalid push payload" }, { status: 400 });
    }

    // ── Deduplicate by delivery ID ──
    if (deliveryId) {
      const { data: existing } = await adminDb
        .from("webhook_events")
        .select("id")
        .eq("delivery_id", deliveryId)
        .maybeSingle();

      if (existing) {
        console.log("[webhook] Duplicate delivery:", deliveryId);
        return NextResponse.json({ ok: true, duplicate: true });
      }

      // Log the event
      await adminDb.from("webhook_events").insert({
        delivery_id: deliveryId,
        repo_full_name: repoFullName,
        event_type: event,
        payload: payload,
      });
    }

    // ── Find matching repos with auto_sync_enabled ──
    const { data: repos } = await adminDb
      .from("repos")
      .select("id, user_id, full_name, watched_branch, last_synced_sha, auto_sync_enabled")
      .eq("full_name", repoFullName)
      .eq("auto_sync_enabled", true);

    if (!repos || repos.length === 0) {
      console.log("[webhook] No auto-sync repos found for:", repoFullName);
      // Mark as processed, no action needed
      if (deliveryId) {
        await adminDb
          .from("webhook_events")
          .update({ processed: true })
          .eq("delivery_id", deliveryId);
      }
      return NextResponse.json({ ok: true, repos: 0 });
    }

    let triggered = 0;
    for (const repo of repos) {
      // Only trigger if push is to the watched branch
      const watchedBranch = repo.watched_branch || "main";
      if (branch !== watchedBranch) continue;

      // Skip if we're already at this SHA
      if (repo.last_synced_sha === headSHA) continue;

      // Trigger sync by calling our own sync API internally
      // We use a fire-and-forget approach — the webhook returns 200 immediately
      // The sync is triggered as a background fetch to our own endpoint
      const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || process.env.VERCEL_URL || "http://localhost:3000";
      const syncUrl = `${baseUrl}/api/repos/sync`;

      // Fire and forget — don't await
      fetch(syncUrl, {
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

      triggered++;
    }

    // Mark webhook as processed
    if (deliveryId) {
      await adminDb
        .from("webhook_events")
        .update({ processed: true })
        .eq("delivery_id", deliveryId);
    }

    console.log(`[webhook] Push to ${repoFullName}/${branch} — triggered ${triggered} syncs`);
    return NextResponse.json({ ok: true, triggered });
  } catch (error: any) {
    console.error("[webhook] Error:", error.message);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
