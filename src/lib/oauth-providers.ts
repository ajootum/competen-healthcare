// ── SSO PROVIDER VOCABULARY AND THE TWO GUARDS ── COMP-AUTH-001 / COMP-IDENTITY-001 item 15 ─────────
//
// ⚠ THIS MODULE IMPORTS NOTHING. Both sign-in surfaces, the start route, the callback and the
// harness read it -- the constants-file rule.
//
// TWO GATES, TWO OWNERS, AND THE CODE RESPECTS BOTH:
//   NEXT_PUBLIC_OAUTH_PROVIDERS  what this DEPLOYMENT renders. Empty (the default) keeps the social
//                                row disabled-and-explained, exactly as the login page has shipped
//                                since the day it was built.
//   GoTrue's own settings        what the auth server will actually do. The start route re-checks
//                                them LIVE before redirecting anybody, because the dashboard is a
//                                second config surface invisible from this repository, and the two
//                                CAN drift -- the class of failure this arc has met before (the
//                                signup switch). Drift lands on a sentence, never on a stack trace.

/** The providers this product knows how to offer. Adding one here is a code change on purpose. */
export const SUPPORTED_OAUTH_PROVIDERS = ["google", "azure", "apple"] as const;
export type OAuthProvider = (typeof SUPPORTED_OAUTH_PROVIDERS)[number];

export const OAUTH_PROVIDER_LABELS: Record<OAuthProvider, string> = {
  google: "Google", azure: "Microsoft", apple: "Apple",
};

/** The deployment's render gate, parsed. Unknown names are dropped rather than guessed at. */
export function enabledOAuthProviders(env: string | undefined | null): OAuthProvider[] {
  return (env ?? "")
    .split(",").map(s => s.trim().toLowerCase()).filter(Boolean)
    .filter((s): s is OAuthProvider => (SUPPORTED_OAUTH_PROVIDERS as readonly string[]).includes(s));
}

/**
 * ⚠ THE OPEN-REDIRECT GUARD, and the one place its rule is spelled. A `next` that survives this is a
 * same-origin path: single leading slash (so "//evil.example" -- protocol-relative -- is refused),
 * and no scheme anywhere (so "/\x2F..." games and "https://..." both fall to the fallback). The same
 * rule the login page has always applied to its own `next`, extracted so the callback cannot drift
 * from it.
 */
export function safeNextPath(raw: string | null | undefined, fallback = "/dashboard"): string {
  if (!raw) return fallback;
  if (!raw.startsWith("/") || raw.startsWith("//")) return fallback;
  if (raw.includes("://") || raw.includes("\\")) return fallback;
  return raw;
}

/**
 * ⚠ WHAT A NEW FACE IS TOLD, BECAUSE SIGNUP IS CLOSED BY THE OWNER'S DECISION. A first-time OAuth
 * sign-in is account CREATION, and this deployment does not create accounts at a door -- they are
 * made by invitation or by an administrator. GoTrue refuses with its own words ("Signups not allowed
 * for this instance"); these are ours, shown on the sign-in page instead of a stack trace.
 */
export const OAUTH_NO_ACCOUNT_MESSAGE =
  "That sign-in worked, but no Competen account exists for it. Accounts here are created by "
  + "invitation or by an administrator, not at this door -- if you were expecting one, ask the person "
  + "who invited you.";

/** The generic verdict for every other provider-side failure -- specific enough to act on, never a code dump. */
export const OAUTH_FAILED_MESSAGE =
  "That sign-in could not be completed. Nothing is wrong with your Competen account; try again, or "
  + "use your email and password.";

/**
 * Which door the words go back to. A practice person mid-flow must land on the Practice sign-in,
 * not the estate one -- same identity, different room. Pure, so the harness can hold it.
 */
export function signInPageFor(next: string): string {
  return next.startsWith("/practice") ? "/practice/sign-in" : "/login";
}
