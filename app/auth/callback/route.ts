import { createClient } from "@/lib/supabase/server";
import { storeGitHubToken } from "@/lib/api/auth";
import { resolveAuthOrigin } from "@/lib/supabase/auth-origin";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const origin = resolveAuthOrigin(request.headers, request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/dashboard";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      // Capture the GitHub provider tokens immediately after login
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const session = sessionData?.session;

        if (session?.provider_token && session.user?.id) {
          await storeGitHubToken(
            supabase,
            session.user.id,
            session.provider_token,
            session.provider_refresh_token || null
          );
        }
      } catch (tokenError) {
        // Non-blocking — token storage failure shouldn't prevent login
        console.warn("[auth/callback] Failed to store GitHub tokens:", tokenError);
      }

      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  // Auth failed — redirect to login with error
  return NextResponse.redirect(`${origin}/login?error=auth`);
}
