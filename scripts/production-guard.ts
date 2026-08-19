/**
 * The one production-target predicate — COMP-ENG-002H Track B.
 *
 * ⚠ IT EXISTS SO THE NEGATIVE TEST CAN EXERCISE THE REAL PATH. §5: "Exercise the same guard code path
 * used by real smoke/provisioning automation." Before this, the smoke helper and the fixture
 * provisioner each carried their own copy of "is this production": two implementations, one hardcoded
 * ref, and a negative test could only ever have proved a third copy correct.
 *
 * ⚠ NOT A SECRET. A Supabase project ref ships to every browser inside NEXT_PUBLIC_SUPABASE_URL — it is
 * an address, not a credential. It is written down rather than derived from the environment because
 * deriving "which project is production" from the same environment a guard is validating would be
 * circular: a misconfigured environment would define itself as safe.
 *
 * ⚠ NOTHING HERE READS A CREDENTIAL, AND NOTHING HERE PRINTS ONE. §5: "Do not print credentials in the
 * failure message." The predicate takes a URL and returns a verdict; callers add their own context.
 */

/** The production project. Public information — see the note above. */
export const PRODUCTION_REF = "rnnqhlrcgvsauigxwszl";

/** The project ref inside a Supabase URL, or null when the URL is not one. */
export function refOf(url: string | null | undefined): string | null {
  if (!url) return null;
  return url.match(/https:\/\/([a-z0-9]+)\.supabase\.co/)?.[1] ?? null;
}

export type TargetVerdict =
  | { ok: true; ref: string }
  | { ok: false; reason: "PRODUCTION"; ref: string }
  | { ok: false; reason: "UNIDENTIFIABLE"; ref: null };

/**
 * Is this target safe for destructive or authenticated automation?
 *
 * ⚠ AN UNIDENTIFIABLE TARGET IS REFUSED, NOT WAVED THROUGH. §5: "Missing environment identity — fail
 * closed for destructive/authenticated automation." A blank or malformed URL is exactly the state a
 * broken deployment produces, and "we could not tell which project this is" is not a reason to write
 * to it. This is the opposite call from platform-membership's `unreadable` state, and deliberately so:
 * there, failing open costs 47 people their product and failing closed costs nothing; here, failing
 * open risks writing synthetic fixtures into production.
 */
export function judgeTarget(url: string | null | undefined): TargetVerdict {
  const ref = refOf(url);
  if (ref === null) return { ok: false, reason: "UNIDENTIFIABLE", ref: null };
  if (ref === PRODUCTION_REF) return { ok: false, reason: "PRODUCTION", ref };
  return { ok: true, ref };
}

/** True when this URL names the production project. Used by request-level blocks. */
export function isProductionUrl(url: string): boolean {
  const host = (() => { try { return new URL(url).host; } catch { return ""; } })();
  return host.startsWith(`${PRODUCTION_REF}.`);
}

/**
 * Throw unless the target is safe. The message names the fault and the variable, never a value.
 */
export function assertSafeTarget(url: string | null | undefined, which: string): string {
  const verdict = judgeTarget(url);
  if (verdict.ok) return verdict.ref;
  if (verdict.reason === "PRODUCTION") {
    throw new Error(
      `REFUSING: ${which} resolves to the PRODUCTION project (${verdict.ref}).\n`
      + `  Authenticated automation and synthetic fixtures never target production.`,
    );
  }
  throw new Error(
    `REFUSING: ${which} does not identify a Supabase project, so this run cannot prove it is not\n`
    + `  production. Fail closed rather than guess — the guess that matters is exactly that one.`,
  );
}
