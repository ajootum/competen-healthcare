// COMP-HQ-ACCESS-001 (updated consolidated) s5 -- THE STAFF HOST.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// The spec names `staff.competenhealthcare.com` as the primary landlord entry with `/staff` as the
// temporary fallback. Both are the SAME door: this module only decides that a request arriving on
// the staff host at the bare root should be answered by that door instead of by the marketing home.
//
// ⚠ THE DECISION LIVES HERE, NOT IN THE MIDDLEWARE, so it can be tested without a request object --
// middleware is the one file in this application that runs in front of everything, and a rule nobody
// can exercise in isolation is a rule nobody can prove. scripts/staff-host-harness.ts drives these
// functions directly.
//
// ⚠ WHAT THIS DELIBERATELY DOES NOT DO: it does not fence customer paths off the staff host, and it
// does not fence /staff off the customer host. Both are real questions the spec raises (s4's realm
// separation), and both turn on a decision nobody has taken yet -- session cookies are host-scoped,
// so bouncing a signed-in person between hosts mid-flow would sign them out in a way that looks like
// a fault. The fallback path staying open on the main host is ALSO the lockout doctrine: the owner's
// existing way in must not close on the day a subdomain appears. Fencing is a later, separate change
// with its own decision; this one adds an entrance and takes nothing away.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

import { GATEWAYS, normaliseHost } from "./domains";

/**
 * ⚠ THE HOSTNAMES AND `normaliseHost` NOW COME FROM THE REGISTRY (COMP-ACCESS-URL-001 s13 step 2,
 * src/lib/identity/domains.ts). The values are unchanged -- `staff.competenhealthcare.com` and
 * `staff.localhost`, in that order -- but they are no longer typed out twice. Before the registry
 * existed this file was one of three places holding an executable Competen hostname, and the spec's
 * whole step 2 is that there should be one.
 */
export { normaliseHost };

/**
 * The staff door's path. The subdomain is an alias for it, never a second implementation.
 *
 * ⚠ DERIVED FROM THE REGISTRY SO THE `/hq` QUESTION CANNOT BE ANSWERED BY ACCIDENT. COMP-ACCESS-URL-001
 * s2 names `/hq` as the staff route equivalent and this application serves `/staff`. ADR-014 ruled it:
 * HQ mounts on the existing `/super-admin` estate and `/hq/*` is an alias at most, never a second route
 * tree. Deriving the door from the same field means an edit made to satisfy a spec that names `/hq`
 * moves the privileged entrance too, instead of leaving a registry that claims one thing and a door
 * that is another -- and domain-registry-harness.ts asserts both that this equals "/staff" and that the
 * route directory exists, so the change goes red rather than quiet.
 */
export const STAFF_DOOR_PATH = GATEWAYS.staff.route;

/**
 * Hosts that mean "landlord entry". Exact matches only -- a suffix test (`endsWith("staff...")`)
 * would also accept `notstaff.competenhealthcare.com` and any attacker-controlled host that happens
 * to end the same way.
 *
 * `staff.localhost` is here so the behaviour can be exercised in development; it cannot exist in
 * production, where the host header is whatever the platform terminated TLS for.
 */
export const STAFF_HOSTS: readonly string[] = [
  GATEWAYS.staff.host,
  ...GATEWAYS.staff.devHosts,
];

export function isStaffHost(rawHost: string | null | undefined): boolean {
  const host = normaliseHost(rawHost);
  return host !== null && STAFF_HOSTS.includes(host);
}

/**
 * The whole rule: on the staff host, the bare root is the staff door.
 *
 * Returns the path to rewrite to, or null to leave the request completely alone. Null is the answer
 * for every host that is not the staff host, which is every request this application serves today --
 * so adding this module changes nothing until the subdomain exists.
 */
export function staffEntryRewrite(rawHost: string | null | undefined, pathname: string): string | null {
  if (!isStaffHost(rawHost)) return null;
  // ⚠ ONLY THE ROOT. Every other path on the staff host resolves normally: /staff/workspaces and the
  // HQ routes must keep working, and a blanket rewrite would send them all to the door instead.
  if (pathname !== "/") return null;
  return STAFF_DOOR_PATH;
}
