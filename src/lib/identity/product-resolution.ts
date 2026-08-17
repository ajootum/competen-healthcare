/* eslint-disable @typescript-eslint/no-explicit-any */

// COMP-ID-ROUTE-001 -- NEUTRAL SIGN-IN PRODUCT RESOLUTION (2026-08-17).
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// What this resolves: the set of product destinations a JUST-AUTHENTICATED account may actually
// enter, from trusted server-side membership tables only -- never from query parameters, browser
// storage or a client-supplied list (s8). The neutral sign-in flow renders from this set alone:
// exactly one destination orients-and-redirects, several render the authorised chooser, none
// renders the controlled no-product state (s3).
//
// ⚠ THE PW-014 RECONCILIATION, RECORDED. PW-014 §1 made /dashboard the universal landing: "every
// authenticated user lands in the Personal Workspace". COMP-ID-ROUTE asks neutral sign-in to
// resolve PRODUCTS. Both hold, because the platform estate IS a destination in the resolved set:
// an account whose only home is the estate resolves to exactly one destination (/dashboard --
// byte-identical behaviour to before this file existed), and an account that ALSO holds a product
// sees the chooser the spec demands instead of being silently defaulted. Explicit product intent
// (?next= from a gateway) still bypasses all of this, exactly as s2 requires.
//
// ⚠ PRODUCTS APPEAR HERE ONLY WHEN A REAL ENTITLEMENT TABLE SAYS SO. Practice reads
// practice_membership. Enterprise, Individual and Recruitment have no live customer entitlement
// gate yet (their access doors are being_built/wrapper -- see access-doors.ts); they join this
// list the day their gate exists, by adding a read -- the routing shape does not change (s8
// "support future products without rewriting the routing algorithm"). Listing them earlier would
// put marketing cards in an authorisation chooser, which s5 forbids by name.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

export type ProductDestination = {
  /** Stable internal identifier (s8): never shown raw to the person. */
  code: "platform" | "practice";
  /** Approved display name (s4). */
  name: string;
  /** One-line orientation, for chooser cards (s5). */
  blurb: string;
  /** The internal route the choice enters. Product-specific resolution re-runs on arrival (s6). */
  href: string;
};

export type ProductResolution =
  | { state: "one"; destination: ProductDestination }
  | { state: "many"; destinations: ProductDestination[] }
  | { state: "none" }
  /** The resolver could not READ. Fail closed: no destination is inferred (s3 "resolver unavailable"). */
  | { state: "unavailable" };

export async function resolveProductDestinations(admin: any, userId: string): Promise<ProductResolution> {
  const [profileRead, practiceRead] = await Promise.all([
    admin.from("profiles").select("id").eq("id", userId).maybeSingle(),
    admin.from("practice_membership").select("id, workspace_id, status")
      .eq("user_id", userId).limit(5),
  ]);

  // A failed read is not "no access" -- inferring either way is the one forbidden move (s3, s11).
  if (profileRead.error || practiceRead.error) return { state: "unavailable" };

  const destinations: ProductDestination[] = [];

  if (profileRead.data) {
    destinations.push({
      code: "platform", name: "Competen Platform",
      blurb: "Your personal workspace -- everything your account holds across the estate.",
      href: "/dashboard",
    });
  }

  const practiceMemberships = ((practiceRead.data ?? []) as any[])
    .filter(m => m.status !== "REVOKED" && m.status !== "SUSPENDED");
  if (practiceMemberships.length > 0) {
    destinations.push({
      code: "practice", name: "Competen Practice",
      blurb: "Run your clinical day -- planner, sessions, patients and payments.",
      // /practice is the auth-aware index: it resolves the workspace context itself (s6 -- the
      // neutral resolver chooses the product ONLY, never bypasses product context resolution).
      href: "/practice",
    });
  }

  if (destinations.length === 0) return { state: "none" };
  if (destinations.length === 1) return { state: "one", destination: destinations[0] };
  return { state: "many", destinations };
}
