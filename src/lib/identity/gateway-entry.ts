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
const NO_REWRITE: ReadonlySet<GatewayKey> = new Set<GatewayKey>(["public"]);

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
