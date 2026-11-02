import { cleanProfileValue } from "@/lib/account/own-profile";
import { composeFullName, PHONE_PATTERN, PREFERRED_NAME_MAX } from "./person-details";

// ── HQ EDITS A PERSON DETAILS ── owner GO "HQ User Management, Invitations and Individual Profile Completion"
//    (2 Nov 2026). Pure planning for PATCH /api/super-admin/users/profile. ───────────────────────────────────────
//
// WHAT HQ MAY CHANGE: given, middle and family name, full name, phone and country. NEVER email (it changes only
// through Supabase verified flow), never a role or a tenancy column. preferred_name belongs to the person: HQ may
// set it only while the person has no individual_identity_profile row at all (the route checks that).
//
// COMPARE-AND-SET. Every changed field arrives with the value the editor saw (`expected`). The route writes with a
// WHERE on each, so a person who changed their own details since the editor opened them is not overwritten.
//
// A FULL NAME FOLLOWS ITS PARTS only when a part changes and the editor did not supply a full name. It is composed
// from the typed parts, never the other way round: nothing here splits a full name (migration 380).

export const EDITABLE_FIELDS = ["given_name", "middle_names", "family_name", "full_name", "phone", "country"] as const;
export type EditableField = (typeof EDITABLE_FIELDS)[number];
const PARTS = ["given_name", "middle_names", "family_name"] as const;

export type ProfileEditPlan = {
  userId: string;
  /** The new values, cleaned. A blank optional field is null. */
  changes: Partial<Record<EditableField, string | null>>;
  /** What the editor saw for each changed field. */
  expected: Partial<Record<EditableField, string | null>>;
  /** undefined: not supplied. A string: HQ asks to set it. null: asks to clear it (refused by the route). */
  preferredName: string | null | undefined;
};
export type EditRefusal = { ok: false; status: number; code: string; error: string };

const bad = (error: string, code = "VALIDATION_ERROR", status = 400): EditRefusal => ({ ok: false, status, code, error });

export function planProfileEdit(body: unknown): { ok: true; plan: ProfileEditPlan } | EditRefusal {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const userId = typeof b.userId === "string" ? b.userId.trim() : "";
  if (!/^[0-9a-f-]{36}$/i.test(userId)) return bad("userId is required.");
  const fields = b.fields && typeof b.fields === "object" && !Array.isArray(b.fields) ? (b.fields as Record<string, unknown>) : null;
  if (!fields) return bad("fields is required.");
  const expectedIn = b.expected && typeof b.expected === "object" && !Array.isArray(b.expected) ? (b.expected as Record<string, unknown>) : {};

  const changes: ProfileEditPlan["changes"] = {};
  const expected: ProfileEditPlan["expected"] = {};
  let preferredName: ProfileEditPlan["preferredName"];

  for (const key of Object.keys(fields)) {
    if (key === "preferred_name") {
      const raw = fields[key];
      if (raw !== null && typeof raw !== "string") return bad("Preferred name must be text.");
      const v = typeof raw === "string" ? raw.replace(/\s+/g, " ").trim() : "";
      if (v.length > PREFERRED_NAME_MAX) return bad(`Preferred name must be ${PREFERRED_NAME_MAX} characters or fewer.`);
      preferredName = v || null;
      continue;
    }
    if (!(EDITABLE_FIELDS as readonly string[]).includes(key)) return bad(`${key} cannot be changed here.`, "FIELD_NOT_ALLOWED");
    const k = key as EditableField;
    const cleaned = cleanProfileValue(k, fields[key]);
    if (!cleaned.ok) return bad(cleaned.error);
    if (k === "full_name" && cleaned.value === null) return bad("Full name cannot be empty.");
    if (k === "phone" && cleaned.value && !PHONE_PATTERN.test(cleaned.value)) return bad("Phone: use digits, spaces and + ( ) - only.");
    const exp = expectedIn[key];
    if (exp !== null && typeof exp !== "string") return bad(`Send the ${key} value you saw, so a change made meanwhile is not overwritten.`, "EXPECTED_REQUIRED");
    // A field that is not different from what the editor saw is not a change.
    if ((exp ?? null) === cleaned.value) continue;
    changes[k] = cleaned.value;
    expected[k] = exp;
  }
  if (!Object.keys(changes).length && preferredName === undefined) return bad("Nothing to update.");
  return { ok: true, plan: { userId, changes, expected, preferredName } };
}

export type CurrentNames = { full_name: string | null; given_name: string | null; middle_names: string | null; family_name: string | null };

/**
 * The full name to write when a name part changed and the editor did not supply one: composed from the parts as
 * they will stand after the change. Null when no full name should be written (nothing changed it, or the parts
 * are all blank, which must never blank a person display name).
 */
export function recomposedFullName(current: CurrentNames, changes: ProfileEditPlan["changes"]): string | null {
  if ("full_name" in changes) return null;
  if (!PARTS.some(p => p in changes)) return null;
  const pick = (k: (typeof PARTS)[number]) => (k in changes ? changes[k] ?? null : current[k]);
  // Only when the person will have BOTH a given and a family name. With one missing, composing would drop part of a
  // name HQ was not told to drop (a legacy full name with no recorded parts).
  if (!pick("given_name") || !pick("family_name")) return null;
  const full = composeFullName({ givenName: pick("given_name"), middleNames: pick("middle_names"), familyName: pick("family_name") });
  if (!full || full.length > 120 || full === current.full_name) return null;
  return full;
}
