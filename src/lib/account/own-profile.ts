/* eslint-disable @typescript-eslint/no-explicit-any */
import { resolveProductDestinations } from "@/lib/identity/product-resolution";
import { readIndividualAccess, isNotProvisioned } from "@/lib/individual/access";
import { individualAppEnabled } from "@/lib/individual/gate";
import { EXPERIENCES } from "@/lib/individual/experiences";
import { appointmentGrantsAccess } from "@/lib/ogs/lifecycle";
import { isHqOfficeType } from "@/lib/hq/spaces";
import { estateRolesOf, ROLE_CONFIG, type AppRole } from "@/lib/roles";

// ── MY PROFILE -- ONE PERSONAL-PROFILE EXPERIENCE ACROSS COMPETEN PRODUCTS ── owner GO 2026-10-23, PR D ──
//
// The person's own identity, as Competen holds it in `profiles` and in Supabase Auth, and a read-only view
// of the access they hold. One API (/api/account/profile) and one component (OwnProfileCard), mounted
// inside each product shell behind that shell's own guard.
//
// ⚠ EDITING A PROFILE CAN NEVER CHANGE ACCESS. Three layers, each sufficient on its own:
//   1. this module's allowlist (PROFILE_FIELDS): the route writes those columns and nothing else;
//   2. the database grants: `authenticated` holds column-level UPDATE on the personal columns only, and
//      on no authority column and not on email;
//   3. RLS: "Users update own profile" WITH CHECK profile_authority_unchanged(...) refuses any self-update
//      that changes role, roles, org/platform roles, tenancy, managed_country, is_senior_assessor or
//      account_status.
//   The route writes through the PERSON'S OWN SESSION (not the service role), so 2 and 3 apply to it.
//
// ⚠ EMAIL IS NEVER WRITTEN HERE. It changes only through supabase.auth.updateUser({ email }), Supabase's
// verified email-change flow, from the browser. Until the person confirms, Auth reports `new_email` and the
// card says the change is pending. profiles.email is not touched by this code.
//
// ⚠ GIVEN AND FAMILY NAMES ARE OPTIONAL AND NEVER INFERRED (migration 380). full_name stays authoritative.
// Where 380 is not applied the two fields are reported as unsupported and cannot be written -- the card
// says so, rather than failing or pretending.
//
// ⚠ PROFILE IS NOT A CREDENTIAL. Nothing here reads or writes professional registrations or credentials
// (estate professional_credentials, Individual's individual_professional_* records). Those are separate
// stores with their own verification states, and the card says so.

export const PROFILE_FIELDS = ["full_name", "phone", "country", "specialization"] as const;
export const NAME_FIELDS = ["given_name", "family_name"] as const;
type ProfileField = (typeof PROFILE_FIELDS)[number];
type NameField = (typeof NAME_FIELDS)[number];
export type ProfilePatch = Partial<Record<ProfileField | NameField, string | null>>;

const LIMITS: Record<ProfileField | NameField, number> = {
  full_name: 120, phone: 40, country: 80, specialization: 120, given_name: 100, family_name: 100,
};

/**
 * Pure. The fields a self-update may carry, cleaned, or the reason it is refused. Unknown keys are
 * ignored, never written: `role`, `email` or anything else in the body simply does not reach the update.
 */
export function parseProfilePatch(body: unknown): { ok: true; patch: ProfilePatch } | { ok: false; error: string } {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const patch: ProfilePatch = {};
  for (const key of [...PROFILE_FIELDS, ...NAME_FIELDS]) {
    if (!(key in b)) continue;
    const raw = b[key];
    if (raw !== null && raw !== undefined && typeof raw !== "string") return { ok: false, error: `${label(key)} must be text.` };
    const v = typeof raw === "string" ? raw.replace(/\s+/g, " ").trim() : "";
    if (v.length > LIMITS[key]) return { ok: false, error: `${label(key)} must be ${LIMITS[key]} characters or fewer.` };
    patch[key] = v || null;
  }
  if ("full_name" in patch && patch.full_name === null) return { ok: false, error: "Your full name cannot be empty." };
  if (!Object.keys(patch).length) return { ok: false, error: "Nothing to update." };
  return { ok: true, patch };
}

const label = (k: string) => ({
  full_name: "Full name", phone: "Phone", country: "Country", specialization: "Speciality",
  given_name: "Given name", family_name: "Family name",
} as Record<string, string>)[k] ?? k;

// ── What the card shows ───────────────────────────────────────────────────────────────────────────

export type Read<T> = { ok: true; value: T } | { ok: false; error: string };

export type OwnProfile = {
  fullName: string;
  phone: string | null;
  country: string | null;
  specialization: string | null;
  /** Migration 380. `supported: false` where it is not applied: the fields cannot be shown or set. */
  names: { supported: true; given: string | null; family: string | null } | { supported: false };
  /** From Supabase Auth, the sign-in identity. `pending` is an unconfirmed change in progress. */
  email: { current: string | null; pending: string | null };
};

export type OwnAccess = {
  /** Estate roles, as labels. Read-only. */
  roles: Read<string[]>;
  /** Product memberships the person can enter, from the neutral sign-in resolver. */
  products: Read<string[]>;
  /** HQ positions held now (access-granting appointments only). */
  hqPositions: Read<string[]>;
  /** Competen Individual: live experiences, or why there are none. Null when Individual is not released. */
  individual: Read<{ status: string; live: string[] }> | null;
};

export type OwnProfileView = { profile: Read<OwnProfile>; access: OwnAccess };

/** The person's own profile row. Reads the 380 name columns separately, so their absence degrades only them. */
export async function readOwnProfile(db: any, user: { id: string; email?: string | null; new_email?: string | null }): Promise<Read<OwnProfile>> {
  const { data: row, error } = await db.from("profiles").select("full_name, phone, country, specialization").eq("id", user.id).maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!row) return { ok: false, error: "No profile row exists for this account." };
  const names = await db.from("profiles").select("given_name, family_name").eq("id", user.id).maybeSingle();
  return {
    ok: true,
    value: {
      fullName: row.full_name,
      phone: row.phone ?? null,
      country: row.country ?? null,
      specialization: row.specialization ?? null,
      names: names.error
        ? { supported: false }
        : { supported: true, given: names.data?.given_name ?? null, family: names.data?.family_name ?? null },
      email: { current: user.email ?? null, pending: user.new_email ?? null },
    },
  };
}

/** True when an error is "migration 380 is not applied here" -- the one failure that means unsupported. */
export const namesUnsupported = (error: any) => isNotProvisioned(error);

/** Read-only access facts, each separately fallible. Service-role reads, keyed on the caller's own id only. */
export async function readOwnAccess(admin: any, userId: string): Promise<OwnAccess> {
  const [profileRead, products, hq, individualOn] = await Promise.all([
    admin.from("profiles").select("role, roles").eq("id", userId).maybeSingle(),
    resolveProductDestinations(admin, userId).catch(() => ({ state: "unavailable" as const })),
    readOwnHqPositions(admin, userId),
    individualAppEnabled(admin),
  ]);

  const roles: Read<string[]> = profileRead.error
    ? { ok: false, error: profileRead.error.message }
    : { ok: true, value: (estateRolesOf(profileRead.data ?? null) as AppRole[]).map(r => ROLE_CONFIG[r]?.label ?? r) };

  const productsRead: Read<string[]> = products.state === "unavailable"
    ? { ok: false, error: "Your product access could not be read just now." }
    : { ok: true, value: products.state === "none" ? [] : products.state === "one" ? [products.destination.name] : products.destinations.map(d => d.name) };

  let individual: OwnAccess["individual"] = null;
  if (individualOn) {
    const ind = await readIndividualAccess(admin, userId);
    individual = ind.state === "unavailable"
      ? { ok: false, error: "Your Competen Individual access could not be read just now." }
      : ind.state === "member"
        ? { ok: true, value: { status: ind.membership.status, live: ind.live.map(k => EXPERIENCES[k]?.name ?? k) } }
        : ind.reason === "not_provisioned" ? null : { ok: true, value: { status: ind.reason, live: [] } };
  }

  return { roles, products: productsRead, hqPositions: hq, individual };
}

/**
 * HQ positions the person holds NOW: appointments in an HQ office whose status grants access (the guard's
 * own allowlist), named from hq_position. A failed read is unreadable, never "none" -- which is why this
 * does not reuse resolveHqPositions, whose failure answer is an empty list.
 */
export async function readOwnHqPositions(admin: any, userId: string): Promise<Read<string[]>> {
  const { data: offices, error: oErr } = await admin.from("ogs_offices").select("id, office_type, is_active, status").limit(500);
  if (oErr) return { ok: false, error: oErr.message };
  const hqOfficeIds = ((offices ?? []) as any[])
    .filter(o => isHqOfficeType(o.office_type) && o.is_active !== false && o.status !== "dissolved" && o.status !== "archived")
    .map(o => o.id);
  if (!hqOfficeIds.length) return { ok: true, value: [] };
  const { data: appts, error: aErr } = await admin.from("ogs_office_appointments")
    .select("role, status").in("office_id", hqOfficeIds).eq("person_id", userId).limit(200);
  if (aErr) return { ok: false, error: aErr.message };
  const codes = [...new Set(((appts ?? []) as any[]).filter(a => appointmentGrantsAccess(a.status) && a.role).map(a => a.role as string))];
  if (!codes.length) return { ok: true, value: [] };
  const { data: pos } = await admin.from("hq_position").select("code, name").in("code", codes);
  const names = new Map(((pos ?? []) as any[]).map(p => [p.code, p.name]));
  return { ok: true, value: codes.map(c => names.get(c) ?? c) };
}
