/* eslint-disable @typescript-eslint/no-explicit-any */
import { EXPERIENCES, isExperienceKey } from "./experiences";
import { EVIDENCE_LABEL, type IndividualPassport } from "./passport";

// ── THE DEVELOPMENT HISTORY ── one timeline per person, shown in both experiences ── COMPETEN-IND-003 s2(4)
//
// The shared "learning history" of COMPETEN-IND-001 D5, as far as it exists today: when the person joined
// Competen Individual, each experience period they have held, and the dated facts already on their
// Competen record (employment, assessed competencies, credentials). Built from the Passport view and the
// person's own entitlement rows -- it stores nothing and duplicates nothing.
//
// It belongs to the PERSON, not to an experience: graduating, adding Professional or returning to Scholar
// adds entries and removes none, because nothing is keyed on the experience a person was in at the time.
//
// ⚠ UNDATED FACTS ARE LEFT OUT, NOT GIVEN A DATE. A credential with no issue date has no place on a
// timeline, and stamping it with today would invent a fact. It still appears in the Passport.

export type HistoryEntry = {
  date: string;
  title: string;
  detail: string | null;
  /** Who stands behind the entry -- Competen Individual itself, or an evidence class. */
  source: string;
};

export type EntitlementRow = { experience_code: string; status: string; starts_at: string; ends_at: string | null; source: string };

const SOURCE_PHRASE: Record<string, string> = {
  pilot: "pilot access",
  hq_grant: "granted by Competen",
  graduation: "activated on graduation",
  payment: "subscription",
  signup: "self sign-up",
};

export function buildHistory(input: {
  joinedAt: string | null;
  entitlements: EntitlementRow[] | null;
  passport: IndividualPassport;
}): HistoryEntry[] {
  const out: HistoryEntry[] = [];
  const day = (iso: string | null | undefined) => (iso ? String(iso).slice(0, 10) : null);

  const joined = day(input.joinedAt);
  if (joined) out.push({ date: joined, title: "Joined Competen Individual", detail: null, source: "Competen Individual" });

  for (const e of input.entitlements ?? []) {
    if (!isExperienceKey(e.experience_code)) continue;
    const start = day(e.starts_at);
    if (!start) continue;
    const name = EXPERIENCES[e.experience_code].name;
    out.push({ date: start, title: `${name} started`, detail: SOURCE_PHRASE[e.source] ?? null, source: "Competen Individual" });
    const end = day(e.ends_at);
    if (end) out.push({ date: end, title: `${name} period ends`, detail: null, source: "Competen Individual" });
  }

  for (const job of input.passport.employment ?? []) {
    const start = day(job.startDate);
    if (start) out.push({
      date: start, title: `Started as ${job.roleTitle}`, detail: job.organisation, source: EVIDENCE_LABEL.institution_issued,
    });
    const end = day(job.endDate);
    if (end) out.push({
      date: end, title: `Left ${job.roleTitle}`, detail: job.organisation, source: EVIDENCE_LABEL.institution_issued,
    });
  }

  for (const c of input.passport.competencies ?? []) {
    const date = day(c.decidedAt);
    if (date) out.push({
      date, title: `${c.name}: ${c.outcome.replace(/_/g, " ")}`, detail: c.issuer, source: EVIDENCE_LABEL.institution_issued,
    });
  }

  for (const cr of input.passport.credentials ?? []) {
    const date = day(cr.issueDate);
    if (date) out.push({ date, title: cr.title, detail: cr.issuingBody, source: EVIDENCE_LABEL[cr.evidence] });
  }

  // Newest first. Same-day entries keep their insertion order, so joining precedes the experience it opened.
  return out
    .map((e, i) => ({ e, i }))
    .sort((a, b) => (a.e.date === b.e.date ? a.i - b.i : a.e.date < b.e.date ? 1 : -1))
    .map(x => x.e);
}

/** The person's own entitlement rows, all periods (not only live ones). null when the read failed. */
export async function loadEntitlementHistory(admin: any, userId: string): Promise<EntitlementRow[] | null> {
  try {
    const r = await admin.from("individual_entitlement")
      .select("experience_code, status, starts_at, ends_at, source")
      .eq("user_id", userId).order("starts_at", { ascending: true }).limit(100);
    return r?.error ? null : (r?.data ?? []);
  } catch {
    return null;
  }
}
