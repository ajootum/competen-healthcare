import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { safeNextPath, signInPageFor, OAUTH_NO_ACCOUNT_MESSAGE, OAUTH_FAILED_MESSAGE } from "@/lib/oauth-providers";

// GET /auth/callback -- where the provider sends people back (item 15).
//
// ⚠ EVERY EXIT FROM THIS ROUTE IS A REDIRECT TO A PAGE WITH WORDS ON IT. Nobody reads JSON standing
// at a sign-in door, and the error querystring a provider returns is not a sentence. Three cases:
//
//   THE SIGNUP-CLOSED CASE, named first because it is an OWNER DECISION meeting a protocol fact.
//   A first-time OAuth sign-in IS account creation, and account creation at the door is off
//   (Supabase signups disabled, decision of record). GoTrue refuses it with "signup_disabled";
//   the person reads OUR sentence about invitations instead. An EXISTING account signing in with
//   a matching, verified email is linked and admitted -- that is sign-in, not signup.
//
//   Provider/exchange failures land on the generic verdict -- specific enough to act on, no codes.
//
//   Success honours `next` through the same open-redirect guard the login page has always used,
//   and defaults to the universal landing (PW-014: every authenticated user lands on My Competen).
//
// ⚠ SAML IS NOT HERE AND IS NOT PRETENDED AT. OIDC/OAuth2 is what this deployment's auth server
// offers; SAML on Supabase is a separate per-IdP configuration on a plan this project does not run.
// The conformance map (COMP-SEC-001-CONFORMANCE-001) records SSO accordingly.

export async function GET(req: NextRequest) {
  const url = req.nextUrl;
  const next = safeNextPath(url.searchParams.get("next"));
  const back = (msg: string) =>
    NextResponse.redirect(new URL(`${signInPageFor(next)}?error=${encodeURIComponent(msg)}`, url.origin));

  const providerError = url.searchParams.get("error");
  if (providerError) {
    const detail = `${url.searchParams.get("error_code") ?? ""} ${url.searchParams.get("error_description") ?? ""} ${providerError}`;
    if (/signup.?_?disabled|not allowed for this instance/i.test(detail))
      return back(OAUTH_NO_ACCOUNT_MESSAGE);
    return back(OAUTH_FAILED_MESSAGE);
  }

  const code = url.searchParams.get("code");
  if (!code) return back(OAUTH_FAILED_MESSAGE);

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    if (/signup.?_?disabled|not allowed for this instance/i.test(`${error.code ?? ""} ${error.message}`))
      return back(OAUTH_NO_ACCOUNT_MESSAGE);
    return back(OAUTH_FAILED_MESSAGE);
  }

  return NextResponse.redirect(new URL(next, url.origin));
}
