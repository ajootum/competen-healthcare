import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  SUPPORTED_OAUTH_PROVIDERS, enabledOAuthProviders, safeNextPath, signInPageFor, type OAuthProvider,
} from "@/lib/oauth-providers";

// GET /api/auth/oauth/[provider] -- the SSO start (item 15). The login page has pointed its provider
// buttons here since the day it shipped; this is the route that makes them real.
//
// ⚠ THREE CHECKS BEFORE ANYBODY LEAVES THIS ORIGIN, because the failure mode of each is different:
//   1. the provider is one this product KNOWS (path segment is attacker-writable);
//   2. the provider is one this DEPLOYMENT renders (the env gate -- a directly typed URL must not
//      widen what the page offers);
//   3. ⚠ the provider is actually ON at the auth server, read LIVE from GoTrue's public settings.
//      The dashboard is a second config surface invisible from this repository, and the one lesson
//      this arc keeps re-learning is that the two drift. An env var that promises Google while the
//      dashboard has it off would otherwise bounce the person off a provider error they cannot read.
//      Fail-closed with words on OUR page, and if the settings cannot be read at all, refuse for the
//      same reason the MFA gate does: a check that gave no answer is not a check that passed.

export async function GET(req: NextRequest, { params }: { params: Promise<{ provider: string }> }) {
  const { provider: raw } = await params;
  const provider = raw.toLowerCase();
  const next = safeNextPath(req.nextUrl.searchParams.get("next"));
  const back = (msg: string) =>
    NextResponse.redirect(new URL(`${signInPageFor(next)}?error=${encodeURIComponent(msg)}`, req.url));

  if (!(SUPPORTED_OAUTH_PROVIDERS as readonly string[]).includes(provider))
    return back("That sign-in method is not one this product offers.");
  if (!enabledOAuthProviders(process.env.NEXT_PUBLIC_OAUTH_PROVIDERS).includes(provider as OAuthProvider))
    return back("That sign-in method is not enabled for this deployment.");

  try {
    const settings = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/settings`, {
      headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY! },
      cache: "no-store",
    });
    if (!settings.ok) return back("Sign-in with a provider could not be checked just now. Use your email and password, or try again.");
    const external = ((await settings.json()) as { external?: Record<string, boolean> }).external ?? {};
    if (external[provider] !== true)
      return back("That sign-in method is switched off at the moment. Use your email and password.");
  } catch {
    return back("Sign-in with a provider could not be checked just now. Use your email and password, or try again.");
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: provider as OAuthProvider,
    options: {
      redirectTo: `${req.nextUrl.origin}/auth/callback?next=${encodeURIComponent(next)}`,
      // PKCE is the client library's default flow for server-side exchanges; nothing to configure.
    },
  });
  if (error || !data?.url) return back("That sign-in could not be started. Use your email and password, or try again.");
  return NextResponse.redirect(data.url);
}
