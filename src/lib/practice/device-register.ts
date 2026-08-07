// The Practice device register's one shared fact: the name of the cookie that identifies a browser, and
// how it is written.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// WHY THIS IS ITS OWN FILE, WITH NO IMPORTS.
//
// Two places need it and they run in different worlds. `src/proxy.ts` is the only place in this
// application that can SET the cookie -- it holds a response, and Next 16's proxy runs on the Node.js
// runtime before routing. `src/lib/practice/shell.ts` is the only place that READS it, inside a Server
// Component render. Neither may import the other: the shell pulls in the Supabase server client and
// `next/headers`, which have no business in the proxy bundle, and the proxy pulls in `next/server`.
//
// So the shared truth lives here, and it is deliberately three constants and two pure functions with
// nothing behind them.
// ────────────────────────────────────────────────────────────────────────────────────────────────────
//
// ⚠ THE BUG THIS FILE EXISTS TO CLOSE (COMP-SECURITY-SURVEY-001 s0.2).
//
// `shell.ts` used to try `cookies().set(...)` inside a Server Component and fall back to
// `crypto.randomUUID()` when it threw. In a Server Component that call ALWAYS throws, so the fallback was
// the only path: every single request minted a brand-new device. Its comment said "the cookie is planted
// by the API the client calls" -- and there was no such API anywhere in the repo.
//
// The consequences were not cosmetic. `practice_session` reached 13,114 rows for 8 memberships; "sign out
// this device" marked a row whose device id would never be presented again; and the idle timeout could
// never fire, because `touchSession` only applies it to a device it has seen before and it never had.
//
// The cookie is a value THIS PRODUCT SET, not a fingerprint. A fingerprint would identify a person across
// contexts they never agreed to; this identifies a browser that chose to sign in here, and clearing it
// honestly produces a new device.

/** The cookie. Read by the shell on every Practice request; written only by the proxy. */
export const DEVICE_COOKIE = "practice_device";

/**
 * How it is written. `httpOnly` because it is a credential the device list deliberately never renders --
 * `listSessions` strips it, on the grounds that a list showing it would be a list of credentials.
 */
export const DEVICE_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: 60 * 60 * 24 * 365,
};

/** A new device identifier. Random, and meaningless outside this register. */
export const mintDeviceId = (): string => crypto.randomUUID();

/**
 * Does this request need a device cookie planted?
 *
 * PURE, so the harness can prove it without a browser. Three inputs and one answer, and every one of the
 * three matters:
 *
 *  - `signedIn`: an anonymous visitor to the public /practice marketing pages is not a device of any
 *    practice, and handing them an identifier before any relationship exists is the fingerprinting this
 *    register refuses on principle.
 *  - `pathname`: the register is Practice-only. A hospital user who never opens Practice does not need
 *    one, and giving them one would put a row in a table their workspace never reads.
 *  - `existing`: the whole point. An identifier that is re-minted is not an identifier.
 */
export function needsDeviceCookie(input: {
  signedIn: boolean;
  pathname: string;
  existing: string | undefined;
}): boolean {
  if (!input.signedIn) return false;
  if (input.existing) return false;
  return isPracticePath(input.pathname);
}

/** Practice pages and the Practice API. Kept beside `needsDeviceCookie` so the two cannot drift. */
export function isPracticePath(pathname: string): boolean {
  return pathname === "/practice"
    || pathname.startsWith("/practice/")
    || pathname.startsWith("/api/v1/practice/");
}
