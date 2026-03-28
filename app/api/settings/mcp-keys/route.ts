import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/api/auth";
import { rateLimit } from "@/lib/api/rate-limit";
import { handleApiError } from "@/lib/api/errors";
import { generateApiKey, hashApiKey } from "@/lib/api/crypto";

/**
 * GET /api/settings/mcp-keys — List user's MCP API keys (prefix only)
 */
export async function GET() {
  try {
    const { user, supabase } = await getAuthenticatedUser();

    const { data: keys } = await supabase
      .from("mcp_api_keys")
      .select("id, name, key_prefix, repo_full_name, last_used_at, created_at, expires_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });

    return NextResponse.json({ keys: keys || [] });
  } catch (error) {
    return handleApiError(error);
  }
}

/**
 * POST /api/settings/mcp-keys — Generate a new MCP API key
 * Returns the raw key ONCE — it cannot be retrieved again
 */
export async function POST(request: Request) {
  try {
    const { user, supabase } = await getAuthenticatedUser();

    const rl = rateLimit(user.id, "mcp-keys");
    if (!rl.ok) {
      return NextResponse.json({ error: { code: "RATE_LIMITED" } }, { status: 429 });
    }

    const body = await request.json();
    const name = (body.name || "Untitled Key").slice(0, 100);
    const repoFullName = body.repo_full_name || null;

    // Generate key
    const { raw, prefix, hash } = generateApiKey();

    // Store hash (never the raw key)
    const { data: key, error } = await supabase
      .from("mcp_api_keys")
      .insert({
        user_id: user.id,
        name,
        key_prefix: prefix,
        key_hash: hash,
        repo_full_name: repoFullName,
      })
      .select("id, name, key_prefix, repo_full_name, created_at")
      .single();

    if (error) throw error;

    // Return raw key one time only
    return NextResponse.json({
      key: { ...key, raw_key: raw },
      warning: "Save this key now. It cannot be retrieved again.",
    });
  } catch (error) {
    return handleApiError(error);
  }
}

/**
 * DELETE /api/settings/mcp-keys — Revoke a key
 */
export async function DELETE(request: Request) {
  try {
    const { user, supabase } = await getAuthenticatedUser();

    const body = await request.json();
    const keyId = body.key_id;

    if (!keyId) {
      return NextResponse.json({ error: { message: "key_id is required" } }, { status: 400 });
    }

    const { error } = await supabase
      .from("mcp_api_keys")
      .delete()
      .eq("id", keyId)
      .eq("user_id", user.id);

    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error);
  }
}
