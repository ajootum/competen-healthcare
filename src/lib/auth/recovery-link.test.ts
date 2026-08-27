import { describe, it, expect } from "vitest";
import { recoveryCredentialFromUrl } from "@/lib/auth/recovery-link";

// ⚠ WHY THIS EXISTS: NOTHING EXECUTED THE RESET PAGE'S LINK HANDLING, and a defect lived there
// undetected because no email could send at all until 2026-08-27.
//
// Supabase issues TWO link shapes and which one arrives depends on WHO ASKED, not on the user:
//   PKCE      `?code=`      -- a reset requested from the browser (/forgot-password)
//   IMPLICIT  `#access_token=&refresh_token=` -- a reset requested SERVER-SIDE: the super-admin reset
//             action, and EVERY inviteUserByEmail
//
// The page read only the first, then fell back to getSession() with a comment claiming the client
// picks the hash up automatically. A PKCE-configured client does not. Administrator resets and every
// invitation therefore landed on "Link invalid or expired".
//
// These are the real URL shapes, taken from live links.

describe("PKCE links — the flow that already worked", () => {
  it("reads the code from the query string", () => {
    expect(recoveryCredentialFromUrl("?code=abc123", "")).toEqual({ kind: "code", code: "abc123" });
  });

  it("tolerates the leading ? being absent", () => {
    expect(recoveryCredentialFromUrl("code=abc123", "")).toEqual({ kind: "code", code: "abc123" });
  });
});

describe("implicit links — the flow that was dropped", () => {
  // ⚠ THE REGRESSION. This exact shape landed on "Link invalid or expired" while the token was 88
  // seconds old and the auth server was returning HTTP 200 for it.
  const HASH = "#access_token=eyJhbGciOiJFUzI1NiJ9.payload.sig&expires_at=1787837097"
    + "&expires_in=3600&refresh_token=ljnuxyubsp6o&sb=&token_type=bearer&type=recovery";

  it("reads both tokens out of the fragment", () => {
    expect(recoveryCredentialFromUrl("", HASH)).toEqual({
      kind: "tokens", accessToken: "eyJhbGciOiJFUzI1NiJ9.payload.sig", refreshToken: "ljnuxyubsp6o",
    });
  });

  it("tolerates the leading # being absent", () => {
    expect(recoveryCredentialFromUrl("", HASH.slice(1)).kind).toBe("tokens");
  });

  // ⚠ BOTH OR NEITHER. setSession requires a refresh token; an access token alone produces a session
  // that cannot outlive the hour and then fails confusingly.
  it("refuses an access token with no refresh token", () => {
    expect(recoveryCredentialFromUrl("", "#access_token=abc&type=recovery").kind).toBe("none");
  });

  it("refuses a refresh token with no access token", () => {
    expect(recoveryCredentialFromUrl("", "#refresh_token=abc&type=recovery").kind).toBe("none");
  });
});

describe("provider errors — shown rather than guessed at", () => {
  // ⚠ A GENUINELY EXPIRED LINK CARRIES NO TOKEN AT ALL, only an explanation. Checking for a token
  // first would report "we found nothing" for a link that arrived with its reason attached.
  it("reads an error out of the fragment, un-plussing the description", () => {
    const r = recoveryCredentialFromUrl("",
      "#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired");
    expect(r).toEqual({
      kind: "provider_error", code: "access_denied",
      description: "Email link is invalid or has expired",
    });
  });

  it("reads an error out of the query string too — PKCE puts it there", () => {
    expect(recoveryCredentialFromUrl("?error=server_error&error_description=Something+broke", "").kind)
      .toBe("provider_error");
  });

  // ⚠ AN ERROR OUTRANKS A TOKEN. If both are present something is wrong, and silently proceeding on
  // the token would hide it.
  it("prefers the error when a URL somehow carries both", () => {
    expect(recoveryCredentialFromUrl("?code=abc", "#error=access_denied").kind).toBe("provider_error");
  });

  it("survives an error with no description rather than inventing one", () => {
    const r = recoveryCredentialFromUrl("", "#error=access_denied");
    expect(r).toEqual({ kind: "provider_error", code: "access_denied", description: null });
  });
});

describe("nothing in the URL", () => {
  // Not an error: somebody already signed in can change their password with no link at all, and the
  // page falls through to an existing-session check.
  it("reports none for an empty URL", () => {
    expect(recoveryCredentialFromUrl("", "").kind).toBe("none");
  });

  it("reports none for unrelated parameters", () => {
    expect(recoveryCredentialFromUrl("?utm_source=email", "#section=top").kind).toBe("none");
  });
});
