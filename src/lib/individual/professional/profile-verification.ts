/* eslint-disable @typescript-eslint/no-explicit-any */
import { isNotProvisioned } from "../access";

// ── INDEPENDENT VERIFICATION OF PROFILE RECORDS ── COMPETEN-PROFESSIONAL-PROFILE-01 part B, migration 451 ──────
//
// ⚠ THE ONE FILE THAT MAY SAY "VERIFIED". scripts/individual-professional-harness.ts forbids the word in every
// other Professional file. Here, a record version is independently verified ONLY when its latest outcome event
// is a `verified` row -- and 451's trigger lets that row exist only when its actor holds
// hq.individual.professional.verify through an ACTIVE appointment and is not the person. Nothing a person
// writes, and no document they attach, can produce this state.
//
// ⚠ A VERIFICATION IS ABOUT ONE VERSION. A changed record is a new version (450) with no verification of its
// own. The earlier version keeps its history, shown as it was.
//
// ⚠ OPTIONAL, NEVER A GATE. Nothing in Competen Professional waits on verification. Nobody is a verifier until
// the owner appoints one: until then a request simply stays open, and the page says so.

export const VERIFICATION_EVENTS = ["requested", "request_withdrawn", "verified", "declined", "revoked", "disputed"] as const;
export type VerificationEvent = (typeof VERIFICATION_EVENTS)[number];
export const PERSON_EVENTS: readonly VerificationEvent[] = ["requested", "request_withdrawn", "disputed"];
export const VERIFIER_EVENTS: readonly VerificationEvent[] = ["verified", "declined", "revoked"];

export const VERIFICATION_METHODS = [
  ["register_check", "Checked against the public register"],
  ["issuer_confirmation", "Confirmed by the issuing body"],
  ["document_review", "Original document reviewed"],
  ["employer_confirmation", "Confirmed by the employer"],
] as const;
export type VerificationMethod = (typeof VERIFICATION_METHODS)[number][0];
export const METHOD_LABEL: Record<string, string> = Object.fromEntries(VERIFICATION_METHODS);
export const isVerificationMethod = (v: unknown): v is VerificationMethod => typeof v === "string" && v in METHOD_LABEL;

/** Where a record version stands. `none`: never submitted, or the request was withdrawn. */
export type VerificationState = "none" | "requested" | "verified" | "expired" | "declined" | "revoked" | "disputed";
export const VERIFICATION_LABEL: Record<VerificationState, string> = {
  none: "Not independently verified",
  requested: "Verification requested, not yet verified",
  verified: "Independently verified by Competen",
  expired: "Verification expired",
  declined: "Could not be verified",
  revoked: "Verification revoked",
  disputed: "Outcome disputed, under review",
};
export const VERIFICATION_DETAIL: Record<VerificationState, string> = {
  none: "Nobody has checked this record. You can ask Competen to verify it.",
  requested: "A Competen verifier will check it. Until then it is shown as recorded by you.",
  verified: "A Competen verifier, independent of you, checked this version of the record.",
  expired: "It was verified, and that verification has passed its validity date.",
  declined: "A Competen verifier could not confirm it. It is shown as recorded by you.",
  revoked: "A Competen verifier withdrew an earlier verification. It is shown as recorded by you.",
  disputed: "You disputed the outcome. A verifier will look again.",
};
/** True only for a standing, in-date verification. Every surface asks this instead of comparing words. */
export const isIndependentlyVerified = (s: VerificationState) => s === "verified";

export type VerificationRow = {
  id: string; item_id: string; event: VerificationEvent; method: string | null; valid_until: string | null; reason: string | null; created_at: string;
};
export type ItemVerification = {
  state: VerificationState;
  /** The standing verification, when there is one (also when it has expired). */
  verifiedAt: string | null; method: string | null; validUntil: string | null;
  /** The reason on the latest decline, revocation or dispute. */
  reason: string | null;
  /** Oldest first: the whole append-only history of this version. */
  history: VerificationRow[];
};
export const NO_VERIFICATION: ItemVerification = { state: "none", verifiedAt: null, method: null, validUntil: null, reason: null, history: [] };

/** Pure: where one version stands, from its own events only. */
export function deriveVerification(rows: readonly VerificationRow[], today: string): ItemVerification {
  const history = [...rows].sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0));
  const last = history[history.length - 1];
  if (!last) return NO_VERIFICATION;
  const verdict = [...history].reverse().find(r => r.event === "verified" || r.event === "declined" || r.event === "revoked");
  const standing = verdict?.event === "verified" ? verdict : null;
  const reasonRow = [...history].reverse().find(r => r.event === "declined" || r.event === "revoked" || r.event === "disputed");
  const base = { verifiedAt: standing?.created_at ?? null, method: standing?.method ?? null, validUntil: standing?.valid_until ?? null, reason: reasonRow?.reason ?? null, history };
  switch (last.event) {
    case "requested": return { ...base, state: "requested" };
    case "disputed": return { ...base, state: "disputed" };
    case "request_withdrawn": return { ...base, state: "none" };
    case "declined": return { ...base, state: "declined" };
    case "revoked": return { ...base, state: "revoked" };
    case "verified": return { ...base, state: last.valid_until && last.valid_until < today ? "expired" : "verified" };
  }
  return NO_VERIFICATION;
}

/** Pure: what the person may do next on this version. */
export function personActions(v: ItemVerification, current: boolean): ("request" | "withdraw" | "dispute")[] {
  if (v.state === "requested") return ["withdraw"];
  if (v.state === "disputed") return [];
  const out: ("request" | "withdraw" | "dispute")[] = [];
  if (current && (v.state === "none" || v.state === "declined" || v.state === "revoked" || v.state === "expired")) out.push("request");
  if (v.history.some(r => VERIFIER_EVENTS.includes(r.event))) out.push("dispute");
  return out;
}

const COLUMNS = "id, item_id, event, method, valid_until, reason, created_at";

/** Every version's verification for one person, keyed by item id. null: unreadable. {} before 451. */
export async function loadVerifications(admin: any, userId: string, today: string): Promise<Record<string, ItemVerification> | null> {
  try {
    const { data, error } = await admin.from("individual_professional_item_verification").select(COLUMNS).eq("user_id", userId).order("created_at").limit(5000);
    if (error) return isNotProvisioned(error) ? {} : null;
    return groupVerifications(data ?? [], today);
  } catch { return null; }
}

/** Pure: rows grouped and derived per version. */
export function groupVerifications(rows: readonly VerificationRow[], today: string): Record<string, ItemVerification> {
  const by = new Map<string, VerificationRow[]>();
  for (const r of rows) { const l = by.get(r.item_id) ?? []; l.push(r); by.set(r.item_id, l); }
  return Object.fromEntries([...by].map(([id, list]) => [id, deriveVerification(list, today)]));
}

type Write = { ok: true } | { ok: false; status: number; error: string };
/** The database's refusal, in words. 451's trigger messages are already sentences after the table name. */
const refusal = (error: any): Write => {
  if (isNotProvisioned(error)) return { ok: false, status: 409, error: "Verification is not set up on this environment yet." };
  const m = /individual_professional_item_verification[^:]*: (.+)$/.exec(String(error?.message ?? ""));
  return { ok: false, status: m ? 409 : 500, error: m ? `${m[1][0].toUpperCase()}${m[1].slice(1)}.` : "That could not be recorded just now. Try again shortly." };
};

/** The person's own event: request, withdraw a request, or dispute an outcome. 451 checks the rest. */
export async function recordPersonEvent(admin: any, userId: string, itemId: string, event: "requested" | "request_withdrawn" | "disputed", reason: string | null): Promise<Write> {
  const { error } = await admin.from("individual_professional_item_verification")
    .insert({ user_id: userId, item_id: itemId, event, actor_id: userId, reason });
  return error ? refusal(error) : { ok: true };
}

// ── THE VERIFIER'S SIDE (HQ, hq.individual.professional.verify) ─────────────────────────────────────────

export type OpenRequest = {
  itemId: string; userId: string; personName: string | null; personEmail: string | null;
  section: string; title: string; typeLabel: string | null; organisation: string | null; jurisdiction: string | null;
  identifier: string | null; startedOn: string | null; endedOn: string | null; expiresOn: string | null; detail: string | null;
  documentName: string | null; evidenceClass: string; verification: ItemVerification;
};

/**
 * The verification queue: only versions with an OPEN request or dispute, current, and never the verifier's own.
 * A verifier sees nothing a person has not asked them to look at.
 */
export async function loadOpenRequests(admin: any, verifierId: string, today: string): Promise<OpenRequest[] | null> {
  try {
    const { data: rows, error } = await admin.from("individual_professional_item_verification").select(`${COLUMNS}, user_id`).order("created_at").limit(10000);
    if (error) return isNotProvisioned(error) ? [] : null;
    const byItem = groupVerifications(rows ?? [], today);
    const owner = new Map<string, string>((rows ?? []).map((r: any) => [r.item_id, r.user_id]));
    const open = Object.entries(byItem).filter(([id, v]) => (v.state === "requested" || v.state === "disputed") && owner.get(id) !== verifierId).map(([id]) => id);
    if (!open.length) return [];
    const { data: items, error: itemErr } = await admin.from("individual_professional_profile_item")
      .select("id, user_id, section, title, type_label, organisation, jurisdiction, self_declared_identifier, started_on, ended_on, expires_on, detail, document_name, evidence_class, superseded_at, withdrawn_at")
      .in("id", open).is("superseded_at", null).is("withdrawn_at", null);
    if (itemErr) return null;
    const ids = [...new Set((items ?? []).map((i: any) => i.user_id))];
    const { data: people } = ids.length ? await admin.from("profiles").select("id, full_name, email").in("id", ids) : { data: [] };
    const who = new Map((people ?? []).map((p: any) => [p.id, p]));
    return (items ?? []).map((i: any) => ({
      itemId: i.id, userId: i.user_id, personName: (who.get(i.user_id) as any)?.full_name ?? null, personEmail: (who.get(i.user_id) as any)?.email ?? null,
      section: i.section, title: i.title, typeLabel: i.type_label, organisation: i.organisation, jurisdiction: i.jurisdiction,
      identifier: i.self_declared_identifier, startedOn: i.started_on, endedOn: i.ended_on, expiresOn: i.expires_on, detail: i.detail,
      documentName: i.document_name, evidenceClass: i.evidence_class, verification: byItem[i.id],
    }));
  } catch { return null; }
}

/** Standing verifications this verifier may revoke (any verifier may revoke; never their own record). */
export async function loadStandingVerifications(admin: any, verifierId: string, today: string): Promise<{ itemId: string; userId: string; title: string; personName: string | null; verification: ItemVerification }[] | null> {
  try {
    const { data: rows, error } = await admin.from("individual_professional_item_verification").select(`${COLUMNS}, user_id`).order("created_at").limit(10000);
    if (error) return isNotProvisioned(error) ? [] : null;
    const byItem = groupVerifications(rows ?? [], today);
    const owner = new Map<string, string>((rows ?? []).map((r: any) => [r.item_id, r.user_id]));
    const ids = Object.entries(byItem).filter(([id, v]) => (v.state === "verified" || v.state === "expired") && owner.get(id) !== verifierId).map(([id]) => id);
    if (!ids.length) return [];
    const { data: items } = await admin.from("individual_professional_profile_item").select("id, user_id, title").in("id", ids);
    const people = [...new Set((items ?? []).map((i: any) => i.user_id))];
    const { data: names } = people.length ? await admin.from("profiles").select("id, full_name").in("id", people) : { data: [] };
    const nameOf = new Map((names ?? []).map((p: any) => [p.id, p.full_name]));
    return (items ?? []).map((i: any) => ({ itemId: i.id, userId: i.user_id, title: i.title, personName: (nameOf.get(i.user_id) as string) ?? null, verification: byItem[i.id] }));
  } catch { return null; }
}

/** A verifier's outcome. The route has checked the capability; 451 checks it again, with independence and order. */
export async function recordVerdict(admin: any, verifierId: string, v: {
  itemId: string; userId: string; event: "verified" | "declined" | "revoked"; method: VerificationMethod | null; validUntil: string | null; reason: string | null;
}): Promise<Write> {
  if (v.userId === verifierId) return { ok: false, status: 403, error: "You cannot verify your own record." };
  const { error } = await admin.from("individual_professional_item_verification").insert({
    user_id: v.userId, item_id: v.itemId, event: v.event, actor_id: verifierId,
    method: v.event === "verified" ? v.method : null, valid_until: v.event === "verified" ? v.validUntil : null, reason: v.reason,
  });
  return error ? refusal(error) : { ok: true };
}

/** Whether this item has an open request or dispute right now -- the verifier's only door to its document. */
export async function hasOpenRequest(admin: any, itemId: string, today: string): Promise<{ userId: string; path: string | null } | null> {
  const { data: rows } = await admin.from("individual_professional_item_verification").select(`${COLUMNS}, user_id`).eq("item_id", itemId).order("created_at");
  if (!rows?.length) return null;
  const v = deriveVerification(rows, today);
  if (v.state !== "requested" && v.state !== "disputed") return null;
  const { data: item } = await admin.from("individual_professional_profile_item").select("document_path, user_id").eq("id", itemId).eq("user_id", rows[0].user_id).maybeSingle();
  return item ? { userId: item.user_id, path: item.document_path ?? null } : null;
}
