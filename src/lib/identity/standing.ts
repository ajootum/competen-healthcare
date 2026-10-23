/* eslint-disable @typescript-eslint/no-explicit-any */

// ── DOES THIS IDENTITY HOLD ANY STANDING AT ALL? ── COMPETEN-IND-ACCESS-001 (invitations), owner review item 5 ──
//
// Read-only, and an IDENTITY-level question, which is why it lives here rather than inside any one product:
// it asks of every product at once whether this person holds anything, and answers only yes or no. No
// product's facts are returned, so nothing about Practice, Enterprise or the estate leaks into the caller.
//
// Its one use: a re-invitation may reuse an identity an earlier Competen Individual invitation created, and
// never signed into, ONLY if that identity still holds NOTHING -- no platform, enterprise, practice or
// Individual membership, no HQ appointment, and no estate, org or platform role. If anybody has since given
// it standing, a fresh sign-in link would hand the inbox authority the invitation never offered; it is then an
// existing account and goes through the explicit grant instead.
//
// ⚠ NOT IMPORTED BY THE LANDLORD PLANE. It reads practice_membership, which scripts/plane-boundary-harness.ts
// governs for anything reachable from src/app/super-admin/**. Keep it out of that import graph.
//
// ⚠ A FAILED OR MISSING READ IS "NOT CLEAN". Nobody is locked out by a false answer here -- the cost is one
// administrator choosing the existing-account path -- so it fails toward refusal.

export async function identityHoldsNoStanding(admin: any, userId: string): Promise<boolean> {
  const rows = (t: string, col = "user_id") => admin.from(t).select("id").eq(col, userId).limit(1);
  const [pm, em, prm, im, ap, pr] = await Promise.all([
    rows("platform_membership"), rows("enterprise_membership"), rows("practice_membership"),
    rows("individual_membership"), rows("ogs_office_appointments", "person_id"),
    admin.from("profiles").select("role, roles, org_role, org_roles, platform_role, platform_roles").eq("id", userId).maybeSingle(),
  ]);
  for (const r of [pm, em, prm, im, ap]) if (r.error || (r.data ?? []).length) return false;
  if (pr.error || !pr.data) return false;
  const p = pr.data as Record<string, unknown>;
  const empty = (v: unknown) => v === null || v === undefined || (Array.isArray(v) && v.length === 0);
  return ["role", "roles", "org_role", "org_roles", "platform_role", "platform_roles"].every(k => empty(p[k]));
}
