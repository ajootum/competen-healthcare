import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { SITE_URL } from "@/lib/marketing/site";
import { redactAddresses } from "@/lib/hq/user-reset";

// SELF-SERVICE "FORGOT PASSWORD", SENT FROM THE SERVER (28 Oct 2026).
//
// ⚠ WHY NOT THE BROWSER CLIENT. /forgot-password used to call resetPasswordForEmail from the browser. The
// browser client (@supabase/ssr) is PKCE: it keeps a code verifier in THAT browser's storage, and the email link
// carries `?code=`, which only that same browser can exchange. A learner who asked on a laptop and opened the
// email on a phone, or in the Gmail app's own browser, landed on "PKCE code verifier not found" (production,
// 28 Oct 2026: a Scholar pilot invitee). Administrator resets and invitations never had the problem, because a
// server-side request carries no PKCE challenge, so its link holds the tokens in the fragment, which
// /reset-password already reads (src/lib/auth/recovery-link.ts).
//
// So the self-service request is now made here, by an implicit-flow client with the PUBLIC key (resetting a
// password needs no privilege), and the link works on whatever device opens it.
//
// ⚠ NO ACCOUNT ENUMERATION. The answer is the same whether or not the address has an account. Supabase itself
// does not error on an unknown address. Only a malformed address, a provider rate limit (which applies to any
// address) or a failure to send is told apart.

/** The return URL is configured, never taken from the request. */
export const selfServiceResetReturnUrl = () => `${SITE_URL}/reset-password`;

const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,253}\.[^\s@]{2,63}$/;
export const isPlausibleEmail = (v: unknown): v is string => typeof v === "string" && v.length <= 320 && EMAIL.test(v.trim());

export type SelfServiceResult =
  | { status: 200; body: { ok: true } }
  | { status: 400 | 429 | 502 | 503; body: { error: string } };

type ResetClient = { auth: { resetPasswordForEmail: (email: string, opts: { redirectTo: string }) => Promise<{ error: { message: string; status?: number } | null }> } };

/** An implicit-flow client on the public key. Null when the environment cannot supply one. */
export function implicitAuthClient(): ResetClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return createSupabaseClient(url, key, { auth: { flowType: "implicit", persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }) as unknown as ResetClient;
}

export async function requestSelfServiceReset(input: unknown, client: ResetClient | null = implicitAuthClient()): Promise<SelfServiceResult> {
  if (!isPlausibleEmail(input)) return { status: 400, body: { error: "Enter a valid email address." } };
  if (!client) return { status: 503, body: { error: "Password reset is not available just now. Try again shortly." } };
  const { error } = await client.auth.resetPasswordForEmail(input.trim().toLowerCase(), { redirectTo: selfServiceResetReturnUrl() });
  if (!error) return { status: 200, body: { ok: true } };
  if (error.status === 429 || /rate limit|security purposes|only request this after/i.test(error.message))
    return { status: 429, body: { error: "Please wait a minute before asking for another link." } };
  console.warn(`[self-service-reset] Supabase recovery refused the send: ${redactAddresses(error.message)}`);
  return { status: 502, body: { error: "The reset email could not be sent just now. Try again shortly." } };
}
