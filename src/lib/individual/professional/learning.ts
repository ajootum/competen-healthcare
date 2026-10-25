/* eslint-disable @typescript-eslint/no-explicit-any */
import { learningEnabled } from "@/lib/learning/policy";
import { learningCpdLines, loadLearningRecords, type LearningReference } from "@/lib/learning/products";
import type { CpdYear } from "./progress";

// ── COMPLETED LEARNING, READ BY REFERENCE ── COMPETEN-IND-007 x COMPETEN-LEARNING-01 hand-off H1/H2 ──────────────
//
// Owner, "COMPETEN LEARNING -- STAGING ACCEPTANCE CONTINUATION" s3: Professional CPD, Evidence, Progress and the Passport
// "read the authoritative Holdings Learning record by reference. Do not duplicate completion or evidence records."
//
// ⚠ NOTHING IS COPIED. The one record is learning_record, read through src/lib/learning/products.ts by the person's own
// id. No row is written to individual_professional_cpd, _evidence or any other 373 table, so there is nothing to drift.
//
// ⚠ PROVENANCE EXACTLY, NEVER "VERIFIED". A hosted completion is "Course completion, issued by Competen Holdings" or
// "Assessed knowledge, issued by Competen Holdings". An external completion stays what the person declared: self-declared,
// or self-declared with a document attached. None of them claims competence.
//
// ⚠ LEARNING IS OPTIONAL. Behind Learning's own server flag (learning_app, off unless its row is on): off, this returns
// `enabled: false` with no references and every Professional page renders exactly as it did without Learning. A person
// with no learning records loses nothing (product definition s13: every other CPD route stays).
//
// ⚠ ONE ACTIVITY, COUNTED ONCE (owner, double-counted CPD hours: "automatic removal is best"). When an entry the person
// logged themselves is the same course as a Learning record, its hours are counted ONCE, from the Learning record, and
// left out of the totals. Removal of the duplicate HOURS, on read: the 373 row is never deleted or changed, and the
// entry says so on the page. The match is deterministic and conservative -- title equal ignoring case, punctuation and
// whitespace, a course or workshop, the provider equal where both are recorded, dates within the policy window
// (professional_learning_match_days, default 7) -- because a false match would hide real hours. No fuzzy or AI match.
// The person can say "This is a different activity": that decision is an ids-only audit_log row (no migration), and
// from then on the two count separately. If those decisions cannot be read, NOTHING is de-duplicated.
//
// null refs = could not be read (say so), [] = none (render nothing).

export type ProfessionalLearning = {
  enabled: boolean; refs: LearningReference[] | null;
  /** The person's "different activity" decisions, as pairKey()s. null = could not be read, so nothing is de-duplicated. */
  unmatched: ReadonlySet<string> | null;
};

/** The audit action that records "This is a different activity". Ids only: a CPD entry id and a learning record id. */
export const LEARNING_UNMATCH_ACTION = "individual_professional_cpd_learning_unmatched";
export const pairKey = (cpdId: string, recordId: string) => `${cpdId}:${recordId}`;

/** The person's own "different activity" decisions. null when they cannot be read. Never throws. */
export async function loadUnmatchDecisions(admin: any, userId: string): Promise<Set<string> | null> {
  try {
    const { data, error } = await admin.from("audit_log").select("entity_id, new_value")
      .eq("actor_id", userId).eq("action", LEARNING_UNMATCH_ACTION).eq("entity_type", "individual_professional_cpd").limit(2000);
    if (error) return null;
    return new Set((data ?? []).filter((r: any) => r?.entity_id && typeof r?.new_value?.learning_record_id === "string")
      .map((r: any) => pairKey(r.entity_id, r.new_value.learning_record_id)));
  } catch { return null; }
}

/** The person's completed learning, or nothing at all while Learning is off. Never throws. */
export async function loadProfessionalLearning(admin: any, userId: string): Promise<ProfessionalLearning> {
  if (!(await learningEnabled(admin))) return { enabled: false, refs: [], unmatched: new Set() };
  const [refs, unmatched] = await Promise.all([loadLearningRecords(admin, userId), loadUnmatchDecisions(admin, userId)]);
  return { enabled: true, refs, unmatched };
}

/** The activity types that can be the same thing as a Learning course. A conference or study session never is. */
export const MATCHABLE_ACTIVITY = ["course", "workshop"] as const;

/** Pure: a title or provider for comparison -- case, punctuation and whitespace ignored, nothing else. */
export const normaliseForMatch = (s: string | null | undefined) => String(s ?? "").normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

const dayNo = (d: string) => { const t = Date.parse(`${String(d).slice(0, 10)}T00:00:00Z`); return Number.isFinite(t) ? Math.round(t / 86_400_000) : null; };

export type MatchableCpd = { id: string; title: string; provider: string | null; activity_type: string; activity_date: string };
export type CpdMatch = { cpdId: string; recordId: string; title: string; completedOn: string };

/**
 * Pure: which of the person's own CPD entries are the same activity as a completed Learning record. One to one: a
 * record absorbs at most one entry and an entry matches at most one record, nearest date first, then by id, so the
 * result never depends on row order. A record with no hours never absorbs an entry (that would hide the entry's hours).
 */
export function matchCpdToLearning(cpd: readonly MatchableCpd[], refs: readonly LearningReference[], windowDays: number, unmatched: ReadonlySet<string>): Map<string, CpdMatch> {
  const window = Math.max(0, Math.floor(Number(windowDays) || 0));
  const pairs: { c: MatchableCpd; r: LearningReference; gap: number }[] = [];
  for (const c of cpd) {
    if (!(MATCHABLE_ACTIVITY as readonly string[]).includes(c.activity_type)) continue;
    const title = normaliseForMatch(c.title), cDay = dayNo(c.activity_date);
    if (!title || cDay === null) continue;
    for (const r of refs) {
      if (r.hours == null || normaliseForMatch(r.title) !== title || unmatched.has(pairKey(c.id, r.recordId))) continue;
      // Owner: "provider equal where both are recorded". Either side blank is no criterion.
      const cp = normaliseForMatch(c.provider), rp = normaliseForMatch(r.provider);
      if (cp && rp && cp !== rp) continue;
      const rDay = dayNo(r.completedOn);
      if (rDay === null) continue;
      const gap = Math.abs(cDay - rDay);
      if (gap <= window) pairs.push({ c, r, gap });
    }
  }
  pairs.sort((a, b) => a.gap - b.gap || a.c.id.localeCompare(b.c.id) || a.r.recordId.localeCompare(b.r.recordId));
  const out = new Map<string, CpdMatch>(), taken = new Set<string>();
  for (const { c, r } of pairs) {
    if (out.has(c.id) || taken.has(r.recordId)) continue;
    out.set(c.id, { cpdId: c.id, recordId: r.recordId, title: r.title, completedOn: r.completedOn });
    taken.add(r.recordId);
  }
  return out;
}

/**
 * Pure: the person's own entries to count in the totals, and the ones counted once with Learning. Learning off, none,
 * or its decisions unreadable: every entry counts (checkUnavailable says the last case, so the page can say so).
 */
export function countedOnce<T extends MatchableCpd>(cpd: readonly T[], learning: ProfessionalLearning, windowDays: number): { counted: T[]; matches: Map<string, CpdMatch>; checkUnavailable: boolean } {
  if (!learning.enabled || !learning.refs?.length) return { counted: [...cpd], matches: new Map(), checkUnavailable: false };
  if (learning.unmatched === null) return { counted: [...cpd], matches: new Map(), checkUnavailable: true };
  const matches = matchCpdToLearning(cpd, learning.refs, windowDays, learning.unmatched);
  return { counted: cpd.filter(c => !matches.has(c.id)), matches, checkUnavailable: false };
}

const ISSUED = { course_completion: "Course completion, issued by Competen Holdings", assessed_knowledge: "Assessed knowledge, issued by Competen Holdings" } as const;

/** Pure: what the record is, in words. Platform-recorded hosted outcomes name their issuer; anything else keeps Learning's own label. */
export function learningProvenance(r: Pick<LearningReference, "evidenceClass" | "completionKind" | "evidenceLabel">): string {
  if (r.evidenceClass === "platform_recorded" && (r.completionKind === "course_completion" || r.completionKind === "assessed_knowledge")) return ISSUED[r.completionKind];
  return r.evidenceLabel;
}

export type CpdYearWithLearning = CpdYear & { fromLearning: number; learningEntries: number; learningWithoutHours: number };

/**
 * Pure: the person's own CPD hours by year, with completed learning counted IN, and shown as "of which from Competen
 * Learning". A learning record with no hours (an external course that gave none) counts as an entry and adds no hours --
 * it is reported as such, never as zero hours.
 */
export function cpdYearsWithLearning(own: readonly CpdYear[], refs: readonly LearningReference[]): CpdYearWithLearning[] {
  const by = new Map<number, CpdYearWithLearning>(own.map(y => [y.year, { ...y, fromLearning: 0, learningEntries: 0, learningWithoutHours: 0 }]));
  for (const line of learningCpdLines(refs)) {
    const year = Number(String(line.activityDate).slice(0, 4));
    if (!Number.isInteger(year) || year < 1900) continue;
    const y = by.get(year) ?? { year, hours: 0, entries: 0, withDocument: 0, fromLearning: 0, learningEntries: 0, learningWithoutHours: 0 };
    y.entries++;
    y.learningEntries++;
    if (line.evidenceClass === "source_linked") y.withDocument++;
    if (line.hours == null) y.learningWithoutHours++;
    else {
      y.hours = Math.round((y.hours + Number(line.hours)) * 10) / 10;
      y.fromLearning = Math.round((y.fromLearning + Number(line.hours)) * 10) / 10;
    }
    by.set(year, y);
  }
  return [...by.values()].sort((a, b) => b.year - a.year);
}

/** The person's own links to records in Learning (gated pages there: shown only while Learning is on). */
export const learningRecordHref = (recordId: string) => `/individual/learning/record/${encodeURIComponent(recordId)}`;
export const learningCertificateHref = (no: string) => `/individual/learning/certificate/${encodeURIComponent(no)}`;
export const findLearningHref = (competencyId: string) => `/individual/learning?competency=${encodeURIComponent(competencyId)}`;
