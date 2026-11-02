// ── THE USER DETAIL WORKSPACE: PURE HELPERS ── HQ users directory, owner GO 2 Nov 2026 ──────────────────────────
//
// Labels, states and validation for the seven-section profile at /super-admin/users?user=<id>. No I/O, so the tests
// can pin every sentence a reader depends on.
//
// ⚠ THREE KINDS OF "NOT SHOWN", AND THEY MUST NOT LOOK ALIKE.
//   Missing         the person has no value here and could have: a gap to fill or chase.
//   Not applicable  the field does not apply to this person (no Scholar, no registration).
//   Restricted      the value exists and is private to the person. HQ is not permitted to read it, by design.
// A blank would read as a defect and a zero as a measurement. Each state says what it is.
//
// ⚠ PRIVACY. HQ never sees Scholar notes, learning history, Personal AI, formative assessments, plans or personal
// development records. Section 7 states that as Restricted and this file offers no key for any of them.

export type FieldState = "value" | "missing" | "not_applicable" | "restricted" | "not_set_up";

export const FIELD_STATE_LABEL: Record<Exclude<FieldState, "value">, string> = {
  missing: "Missing",
  not_applicable: "Not applicable",
  restricted: "Restricted",
  not_set_up: "Not set up here",
};

export const FIELD_STATE_WHY: Record<Exclude<FieldState, "value">, string> = {
  missing: "Nothing has been recorded for this yet.",
  not_applicable: "This does not apply to this person.",
  restricted: "Private to the person. HQ is not permitted to read it.",
  not_set_up: "This part of Competen HQ has not been set up in this environment yet.",
};

/** A value, or the state that explains its absence. Blank text counts as absent. */
export function fieldState(value: string | null | undefined, whenAbsent: Exclude<FieldState, "value" | "restricted"> = "missing"): FieldState {
  return value != null && String(value).trim() !== "" ? "value" : whenAbsent;
}

// ── PRODUCTS AND ENTITLEMENTS ───────────────────────────────────────────────────────────────────────────────

export const EXPERIENCE_NAME: Record<string, string> = { scholar: "Scholar", professional: "Professional" };
export const PRODUCT_NAME: Record<string, string> = { platform: "Platform", enterprise: "Enterprise", practice: "Practice", individual: "Individual" };

/** How an entitlement came to be, in the words HQ uses. */
export function basisLabel(source: string | null | undefined, planCode?: string | null): string {
  switch (source) {
    case "pilot": return "Pilot access";
    case "hq_grant": return "Complimentary, granted by Competen";
    case "payment": return planCode ? `Paid · plan ${planCode}` : "Paid";
    case "signup": return "Self sign-up";
    case "graduation": return "Moved up from Scholar";
    case "unknown": case null: case undefined: case "": return "Source not recorded";
    default: return String(source).replace(/_/g, " ");
  }
}

/** "Scholar · until 31 Jan 2027", "Scholar · no end date". The date is formatted in UTC so server and browser agree. */
export function entitlementLine(experience: string, endsAt: string | null): string {
  const name = EXPERIENCE_NAME[experience] ?? experience;
  return endsAt ? `${name} · until ${formatDay(endsAt)}` : `${name} · no end date`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function formatDay(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

export type ProductReadable = { platform: boolean; enterprise: boolean; practice: boolean; individual: boolean };
export type ProductSummaryInput = {
  platform: string | null;
  enterprise: { status: string }[];
  practice: { status: string }[];
  individual: { membership: string | null; liveDetail: { experience: string; endsAt: string | null }[] };
};

/**
 * What the Products column says: the person's ACTUAL live entitlements and active seats, never access inferred from a
 * role. `lines` is empty with `none: true` when every source answered and there is nothing, and `unreadable` names
 * a source that did not answer, which is not the same as nothing.
 */
export function productSummary(a: ProductSummaryInput, readable: ProductReadable): { lines: string[]; none: boolean; unreadable: string[] } {
  const lines: string[] = [];
  const unreadable: string[] = [];
  if (readable.individual) {
    for (const d of a.individual.liveDetail) {
      const suspended = a.individual.membership !== null && a.individual.membership !== "active";
      lines.push(entitlementLine(d.experience, d.endsAt) + (suspended ? ` (membership ${a.individual.membership})` : ""));
    }
  } else unreadable.push("Individual");
  if (readable.platform) { if (a.platform === "active") lines.push("Platform"); } else unreadable.push("Platform");
  if (readable.enterprise) { if (a.enterprise.some(e => e.status === "active")) lines.push("Enterprise"); } else unreadable.push("Enterprise");
  if (readable.practice) { if (a.practice.some(p => p.status === "active")) lines.push("Practice"); } else unreadable.push("Practice");
  return { lines, none: lines.length === 0 && unreadable.length === 0, unreadable };
}

// ── PROFILE FIELDS: THE SAME RULES AS THE PERSON'S OWN PROFILE ── src/lib/account/own-profile.ts ───────────────

export const EDITABLE_FIELDS = ["given_name", "middle_names", "family_name", "full_name", "phone", "country"] as const;
export type EditableField = (typeof EDITABLE_FIELDS)[number];

export const FIELD_LABEL: Record<EditableField | "preferred_name", string> = {
  given_name: "Given name", middle_names: "Middle name(s)", family_name: "Family name", full_name: "Full name",
  phone: "Phone", country: "Country", preferred_name: "Preferred name",
};

/** Mirrors LIMITS in own-profile.ts. If that file changes, this changes with it (the test pins both). */
export const FIELD_LIMIT: Record<EditableField | "preferred_name", number> = {
  full_name: 120, phone: 40, country: 80, given_name: 100, middle_names: 100, family_name: 100, preferred_name: 80,
};

export const PHONE_PATTERN = /^[+()\d\s.-]{4,}$/;

/** One field as typed: whitespace collapsed, blank is null. Returns the reason it is refused, or the cleaned value. */
export function validateField(key: EditableField, raw: string): { ok: true; value: string | null } | { ok: false; error: string } {
  const v = raw.replace(/\s+/g, " ").trim();
  if (v.length > FIELD_LIMIT[key]) return { ok: false, error: `${FIELD_LABEL[key]} must be ${FIELD_LIMIT[key]} characters or fewer.` };
  if (key === "full_name" && !v) return { ok: false, error: "Full name cannot be empty." };
  if (key === "phone" && v && !PHONE_PATTERN.test(v)) return { ok: false, error: "Phone: use digits, spaces and + ( ) - only." };
  return { ok: true, value: v || null };
}

export type FieldValues = Record<EditableField, string | null>;
export type PatchValues = FieldValues & { preferred_name: string | null };

/**
 * The PATCH body for a set of edits: only the fields that changed, with `expected` carrying the value each one had when
 * the screen loaded, so the server can refuse a write over somebody else's change. Null when nothing changed, or
 * `errors` per field when any value is refused.
 */
export function buildProfilePatch(
  userId: string, loaded: FieldValues, draft: Record<EditableField, string>,
  /** The display preference, offered only while the person has no identity profile of their own. */
  preferred?: { loaded: string | null; draft: string },
):
  | { ok: true; body: { userId: string; fields: Partial<PatchValues>; expected: Partial<PatchValues> } | null }
  | { ok: false; errors: Partial<Record<EditableField | "preferred_name", string>> } {
  const fields: Partial<PatchValues> = {};
  const expected: Partial<PatchValues> = {};
  const errors: Partial<Record<EditableField | "preferred_name", string>> = {};
  for (const key of EDITABLE_FIELDS) {
    const v = validateField(key, draft[key] ?? "");
    if (!v.ok) { errors[key] = v.error; continue; }
    if (v.value !== (loaded[key] ?? null)) { fields[key] = v.value; expected[key] = loaded[key] ?? null; }
  }
  if (preferred) {
    const v = preferred.draft.replace(/\s+/g, " ").trim();
    if (v.length > FIELD_LIMIT.preferred_name) errors.preferred_name = `${FIELD_LABEL.preferred_name} must be ${FIELD_LIMIT.preferred_name} characters or fewer.`;
    else if ((v || null) !== (preferred.loaded ?? null)) { fields.preferred_name = v || null; expected.preferred_name = preferred.loaded ?? null; }
  }
  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, body: Object.keys(fields).length ? { userId, fields, expected } : null };
}

/** What the PATCH route's refusals mean on screen. */
export function patchErrorMessage(status: number, code: string | undefined, fallback?: string): string {
  if (status === 409 && code === "CHANGED") return "These details changed since you opened them. Reload to see the latest, then edit again.";
  if (status === 409 && code === "LEARNER_OWNED") return "The preferred name is chosen by the person. HQ cannot change it.";
  if (code === "NOT_SET_UP") return "Editing details is not set up in this environment yet.";
  if (status === 403) return "Only a platform owner can edit these details.";
  if (status === 401) return "You are signed out. Sign in again.";
  return fallback || "The details could not be saved.";
}

// ── INVITATION PREFILL: HQ-supplied, not yet confirmed by the person ───────────────────────────────────────────

export const PREFILL_LABEL: Record<string, string> = {
  profession: "Profession", qualification: "Qualification", institution: "Educational institution", programme: "Programme",
  trainingLevel: "Training level", organisation: "Organisation", facility: "Facility", position: "Position",
};

/** The prefill as label/value rows. Strings only, trimmed, capped. Anything else in the object is ignored. */
export function prefillRows(prefill: unknown): { key: string; label: string; value: string }[] {
  if (!prefill || typeof prefill !== "object" || Array.isArray(prefill)) return [];
  const out: { key: string; label: string; value: string }[] = [];
  for (const [key, v] of Object.entries(prefill as Record<string, unknown>)) {
    if (typeof v !== "string" || !v.trim()) continue;
    out.push({ key, label: PREFILL_LABEL[key] ?? key.replace(/([A-Z])/g, " $1").replace(/_/g, " ").replace(/^./, c => c.toUpperCase()), value: v.trim().slice(0, 200) });
  }
  return out;
}

// ── INVITATIONS ────────────────────────────────────────────────────────────────────────────────────────────

export const INVITATION_STATUS_LABEL: Record<string, string> = { PENDING: "Waiting to be accepted", ACCEPTED: "Accepted", REVOKED: "Revoked" };

/** An invitation's status, using the database-clock liveness the loader passes in: a PENDING one that is not live has expired. */
export function invitationStatus(status: string, live: boolean): string {
  if (status === "PENDING" && !live) return "Expired";
  return INVITATION_STATUS_LABEL[status] ?? status;
}

// ── AUDIT ──────────────────────────────────────────────────────────────────────────────────────────────────

export const AUDIT_PAGE_SIZE = 20;

export const actionLabel = (action: string | null | undefined): string =>
  (action ?? "unknown").replace(/_/g, " ").replace(/^./, c => c.toUpperCase());

/** The page number from a request, 0-based, never negative or absurd. */
export function parseAuditPage(raw: string | null | undefined): number {
  const n = Number.parseInt(raw ?? "", 10);
  return Number.isFinite(n) && n > 0 && n < 5000 ? n : 0;
}

// ── SECTIONS ───────────────────────────────────────────────────────────────────────────────────────────────

export const DETAIL_SECTIONS = [
  { id: "personal", label: "Personal & Contact", short: "Personal" },
  { id: "education", label: "Education & Professional Context", short: "Education" },
  { id: "products", label: "Products & Entitlements", short: "Products" },
  { id: "roles", label: "Roles & Organisations", short: "Roles" },
  { id: "account", label: "Account & Security", short: "Account" },
  { id: "audit", label: "Audit & History", short: "Audit" },
  { id: "competency", label: "Competency & Passport", short: "Competency" },
] as const;
export type DetailSectionId = (typeof DETAIL_SECTIONS)[number]["id"];

/** Records HQ is never permitted to read. Section 7 lists them as Restricted. */
export const RESTRICTED_RECORDS = [
  "Passport items and evidence",
  "Notes",
  "Learning history",
  "Personal AI conversations",
  "Study and development plans",
  "Formative assessments",
] as const;
