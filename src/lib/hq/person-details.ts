import { cleanProfileValue } from "@/lib/account/own-profile";
import { composeFullName } from "@/lib/account/compose-name";

// ── WHO A PERSON IS, AS HQ RECORDS IT AT INVITATION OR EDITS IT LATER ── owner GO "HQ User Management,
//    Invitations and Individual Profile Completion" (2 Nov 2026), migration 850 ────────────────────────────────
//
// Pure. The name parts, the contact details, the prefill allowlist and the participation label, validated by the
// SAME rules the person's own profile uses (src/lib/account/own-profile.ts cleanProfileValue), so HQ cannot store
// a value the person could not.
//
// ⚠ A COMPOSED FULL NAME IS NOT A SPLIT. composeFullName joins parts somebody TYPED, in the order given, middle,
// family. Nothing here ever splits full_name into parts (migration 380: a split by rule invents a fact).
//
// ⚠ COUNTRY. The estate stores country as the country's NAME, free text up to 80 characters (own-profile.ts, the
// Users and Add User screens' COUNTRIES list). There is no ISO-3166 validator in the codebase, so none is invented
// here: the same 80-character text rule applies.

export type PersonDetails = {
  givenName: string | null; middleNames: string | null; familyName: string | null;
  preferredName: string | null; phone: string | null; country: string | null;
};
export const NO_DETAILS: PersonDetails = { givenName: null, middleNames: null, familyName: null, preferredName: null, phone: null, country: null };

/** individual_identity_profile.preferred_name is at most 80 characters (migration 590). */
export const PREFERRED_NAME_MAX = 80;
/** profiles.full_name as the person's own profile limits it. */
export const FULL_NAME_MAX = 120;

export const PHONE_PATTERN = /^[+()\d\s.-]{4,}$/;

const refuse = (error: string) => ({ ok: false as const, error });

// The composer lives in src/lib/account/compose-name.ts, shared with the person's own profile.
export { composeFullName };

/** The six details from a request body (camelCase keys), cleaned, or the reason one is refused. All optional here. */
export function cleanPersonDetails(body: unknown): { ok: true; value: PersonDetails } | { ok: false; error: string } {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const one = (key: "given_name" | "middle_names" | "family_name" | "phone" | "country", raw: unknown) => cleanProfileValue(key, raw);
  const given = one("given_name", b.givenName); if (!given.ok) return given;
  const middle = one("middle_names", b.middleNames); if (!middle.ok) return middle;
  const family = one("family_name", b.familyName); if (!family.ok) return family;
  const phone = one("phone", b.phone); if (!phone.ok) return phone;
  const country = one("country", b.country); if (!country.ok) return country;
  if (phone.value && !PHONE_PATTERN.test(phone.value)) return refuse("Phone: use digits, spaces and + ( ) - only.");
  let preferred: string | null = null;
  if (b.preferredName !== undefined && b.preferredName !== null) {
    if (typeof b.preferredName !== "string") return refuse("Preferred name must be text.");
    preferred = b.preferredName.replace(/\s+/g, " ").trim() || null;
    if (preferred && preferred.length > PREFERRED_NAME_MAX) return refuse(`Preferred name must be ${PREFERRED_NAME_MAX} characters or fewer.`);
  }
  const value: PersonDetails = { givenName: given.value, middleNames: middle.value, familyName: family.value, preferredName: preferred, phone: phone.value, country: country.value };
  const full = composeFullName(value);
  if (full && full.length > FULL_NAME_MAX) return refuse(`The full name made from these parts must be ${FULL_NAME_MAX} characters or fewer.`);
  return { ok: true, value };
}

// ── PREFILL: an allowlist, strings only ──────────────────────────────────────────────────────────────────────

export const PREFILL_KEYS = ["profession", "qualification", "institution", "programme", "trainingLevel", "organisation", "facility", "position"] as const;
export type PrefillKey = (typeof PREFILL_KEYS)[number];
export type Prefill = Partial<Record<PrefillKey, string>>;
export const PREFILL_MAX = 200;

export const PREFILL_LABEL: Record<PrefillKey, string> = {
  profession: "Profession", qualification: "Qualification", institution: "Educational institution", programme: "Programme",
  trainingLevel: "Training level", organisation: "Organisation", facility: "Facility", position: "Position",
};

/** Only the allowlisted keys survive, each a trimmed string of at most 200 characters. Blank is dropped. Nothing left is null. */
export function cleanPrefill(raw: unknown): { ok: true; value: Prefill | null } | { ok: false; error: string } {
  if (raw === undefined || raw === null) return { ok: true, value: null };
  if (typeof raw !== "object" || Array.isArray(raw)) return refuse("The extra details must be a set of named values.");
  const out: Prefill = {};
  for (const key of PREFILL_KEYS) {
    const v = (raw as Record<string, unknown>)[key];
    if (v === undefined || v === null) continue;
    if (typeof v !== "string") return refuse(`${PREFILL_LABEL[key]} must be text.`);
    const t = v.replace(/\s+/g, " ").trim();
    if (!t) continue;
    if (t.length > PREFILL_MAX) return refuse(`${PREFILL_LABEL[key]} must be ${PREFILL_MAX} characters or fewer.`);
    out[key] = t;
  }
  return { ok: true, value: Object.keys(out).length ? out : null };
}

// ── PARTICIPATION: a label that decides no access ───────────────────────────────────────────────────────────────

export const PARTICIPATION = ["regular", "pilot", "staff_tester"] as const;
export type Participation = (typeof PARTICIPATION)[number];
export const PARTICIPATION_LABEL: Record<Participation, string> = {
  regular: "Regular invited user", pilot: "Pilot participant", staff_tester: "Staff tester",
};
export const isParticipation = (x: unknown): x is Participation => typeof x === "string" && (PARTICIPATION as readonly string[]).includes(x);
