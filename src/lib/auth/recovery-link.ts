// WHAT A PASSWORD-RESET LINK IS CARRYING — the two shapes Supabase actually sends.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// ⚠ THERE ARE TWO FLOWS, AND WHICH ONE ARRIVES DEPENDS ON WHO ASKED FOR THE LINK, NOT ON THE USER.
//
//   PKCE      `?code=...` in the QUERY STRING. Produced when the request came from the browser client
//             (`createBrowserClient` from @supabase/ssr defaults to PKCE). This is what /forgot-password
//             generates, and it always worked.
//
//   IMPLICIT  `#access_token=...&refresh_token=...&type=recovery` in the FRAGMENT. Produced when the
//             request came from a client with no PKCE challenge -- which is every SERVER-SIDE call:
//             the super-admin "send password reset" action, and inviteUserByEmail.
//
// The reset page handled only the first. It then fell back to `getSession()` with a comment saying
// "older-style links land with a recovery token in the URL hash and the client picks the session up
// automatically" -- which a PKCE-configured client does NOT do. So administrator-initiated resets and
// every INVITATION landed on "Link invalid or expired" while self-service resets worked. Nobody had
// hit it because no email could send at all until 2026-08-27.
//
// ⚠ AND THE FRAGMENT NEVER REACHES A SERVER. Everything after `#` is client-only by definition, which
// is why this is a browser-side parse and why no server route can be taught to do it instead.
//
// ⚠ SUPABASE ALSO PUTS FAILURES IN THE FRAGMENT. A genuinely expired link arrives as
// `#error=access_denied&error_description=Email+link+is+invalid+or+has+expired`, with no token at all.
// Reporting that as "we could not read the link" would be a lie in the other direction, so it is a
// distinct outcome here.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

export type RecoveryCredential =
  /** PKCE. Exchange with `exchangeCodeForSession`. */
  | { kind: "code"; code: string }
  /** Implicit. Establish with `setSession`. */
  | { kind: "tokens"; accessToken: string; refreshToken: string }
  /** The provider said no, and said why. Show ITS reason, not a guess. */
  | { kind: "provider_error"; code: string; description: string | null }
  /** Nothing usable in the URL. An existing session may still make the page valid. */
  | { kind: "none" };

/**
 * Read a reset link. `search` is `window.location.search`, `hash` is `window.location.hash`.
 *
 * Pure so it can be tested by being run — the whole reason this defect survived is that nothing
 * executed the page's link handling, and a browser page is awkward to exercise.
 */
export function recoveryCredentialFromUrl(search: string, hash: string): RecoveryCredential {
  const query = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);

  // ⚠ THE ERROR CHECK COMES FIRST, and in BOTH places. Supabase puts failures in the fragment for the
  // implicit flow and in the query for PKCE. Checking for a token first would report "none" for a link
  // that came with a perfectly clear explanation attached.
  const frag = new URLSearchParams(hash.startsWith("#") ? hash.slice(1) : hash);
  for (const params of [frag, query]) {
    const err = params.get("error") ?? params.get("error_code");
    if (err) {
      return {
        kind: "provider_error",
        code: err,
        description: params.get("error_description")?.replace(/\+/g, " ") ?? null,
      };
    }
  }

  const code = query.get("code");
  if (code) return { kind: "code", code };

  const accessToken = frag.get("access_token");
  const refreshToken = frag.get("refresh_token");
  // ⚠ BOTH OR NEITHER. setSession requires a refresh token; handing it an access token alone produces
  // a session that cannot outlive the hour and fails confusingly when it does.
  if (accessToken && refreshToken) return { kind: "tokens", accessToken, refreshToken };

  return { kind: "none" };
}
