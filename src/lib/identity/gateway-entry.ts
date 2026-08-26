// COMP-ACCESS-URL-001 s13 step 5 -- GATEWAY-AWARE ENTRY.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// THE GENERALISATION OF ONE RULE THAT ALREADY WORKED. COMP-HQ-ACCESS-001 s5 established it for a single
// host: arriving at the bare root of a product gateway should answer with that product's door, not with
// the marketing homepage sitting one path away. `staffEntryRewrite` implemented exactly that, and on
// 2026-08-26 -- the day the six subdomains finally resolved -- it was proven live for the first time.
//
// The other five hostnames went live the same day and had no such rule, so every one of them answered
// with the marketing home. That is not a defect (s5: the hostname is navigation, never authorization)
// but it is the gap s13 step 5 names, and the shape of the fix was already decided by the staff case.
//
// ⚠ THE ROUTE COMES FROM THE REGISTRY, NOT FROM A SECOND LIST. src/lib/identity/domains.ts already
// holds every canonical hostname and the main-domain route each product answers on (s2). Re-stating
// those pairs here would create precisely the drift the registry was built to end -- and it is where
// the `/hq`-versus-`/staff` disagreement is recorded, so a second copy would also silently lose that.
//
// ⚠ WHAT THIS DELIBERATELY DOES NOT DO, and the reason is s5.
//
// It does not authorize anything, and it must never be made to. Reaching `/practice` by typing
// `practice.competenhealthcare.com` gets a person exactly what typing `competenhealthcare.com/practice`
// gets them -- no more. The gateway sets context and branding; entitlement decides where an
// authenticated identity may actually go, and that lives in product-resolution.ts. This was verified
// against the live hosts before the rule was generalised: `/super-admin` and `/practice/home` are
// refused IDENTICALLY on all six gateways, and gateway-acceptance-check.mjs compares the shape of those
// refusals across hosts rather than merely checking each one, because a host that refused differently
// would pass every per-host check while proving the principle false.
//
// It also does not touch the public host. `www` and the apex ARE the marketing home at their root, so
// rewriting there would put a product door in front of the site's front page.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

import { GATEWAYS, gatewayForHost, type GatewayKey } from "./domains";

/**
 * Gateways whose root is NOT rewritten.
 *
 * `public` covers www, the bare apex and localhost: their root is the marketing home by definition.
 * Keeping this as a named set rather than an inline `key !== "public"` means a future gateway that
 * should also stay untouched is added HERE, with a reason, rather than by widening a condition.
 */
export const NO_REWRITE: ReadonlySet<GatewayKey> = new Set<GatewayKey>([
  "public",
  // ⚠ `platform` IS EXCLUDED BECAUSE /platform HAS NO PAGE, AND REWRITING TO IT SERVED A 404.
  //
  // This was shipped and live for roughly twenty minutes on 2026-08-26. `src/app/platform/` exists as
  // a DIRECTORY -- it holds the `control-plane/*` and `staff/*` families -- but there is no
  // `platform/page.tsx`, so `/platform` itself is not a route. Before the rewrite, the platform
  // hostname answered with the marketing home: wrong, but a page. After it, the hostname answered with
  // the 404, byte-identical to what a nonsense URL returns. A gateway that 404s is worse than one that
  // shows the wrong page, and it was the FIRST thing a visitor to that address would ever have seen.
  //
  // ⚠ THE CHECK THAT SHOULD HAVE CAUGHT IT DID NOT, and that is the more useful half of the lesson.
  // domain-registry-harness 2b asserted "every route the registry names is SERVED" by testing
  // `existsSync` on the directory. A folder of subdirectories satisfies that while serving nothing. The
  // assertion now requires a page file at the route, and additionally that no gateway is rewritten to a
  // route without one -- which is the invariant that actually matters.
  //
  // WHAT IT IS NOT: a decision about where the platform gateway should land. §1 calls it the
  // "landlord/platform governance and product oversight gateway", and the candidates -- a new
  // `/platform` landing page, `/platform/staff`, or `/super-admin` per ADR-014 -- are a product and
  // security question, not a tidy-up. Sending the bare root of a public hostname straight into a
  // privileged surface is exactly the sort of change that gets decided, not inferred. Until that is
  // ruled on, this host behaves as it did before step 5.
  "platform",
]);

/**
 * The whole rule: on a product gateway host, the bare root is that product's door.
 *
 * Returns the path to rewrite to, or null to leave the request completely alone. Null is the answer for
 * the public host, for the apex, for any unrecognised host, and for every path other than the root --
 * which is the overwhelming majority of requests this application serves.
 */
export function gatewayEntryRewrite(rawHost: string | null | undefined, pathname: string): string | null {
  const key = gatewayForHost(rawHost);
  if (key === null || NO_REWRITE.has(key)) return null;
  // ⚠ ONLY THE ROOT. Every other path on a gateway host resolves normally -- /login, /practice/home and
  // the HQ routes must keep working, and a blanket rewrite would send all of them to a product door.
  if (pathname !== "/") return null;
  return GATEWAYS[key].route;
}
