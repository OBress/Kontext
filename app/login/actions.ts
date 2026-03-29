"use server";

import { createClient } from "@/lib/supabase/server";
import { resolveAuthOrigin } from "@/lib/supabase/auth-origin";
import { redirect } from "next/navigation";
import { headers } from "next/headers";

export async function signInWithGitHub() {
  const supabase = await createClient();
  const headersList = await headers();
  const origin = resolveAuthOrigin(headersList);

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "github",
    options: {
      redirectTo: `${origin}/auth/callback`,
      scopes: "repo read:user user:email",
    },
  });

  if (error) {
    redirect("/login?error=oauth");
  }

  if (data.url) {
    redirect(data.url);
  }
}
