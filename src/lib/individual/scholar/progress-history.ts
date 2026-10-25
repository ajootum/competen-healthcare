// ── LONGITUDINAL LEARNING PROGRESS ── COMPETEN-SCHOLAR-PROGRESS-01 (Progress, Stage 8 of 8) P2 ─────────────────
//
// Development over time, from the records that already exist -- revision answers (372, 416), spaced reviews (391),
// clinical-case decisions (435), Teach Me checks (414), kept evaluations (426) and the educational-context history
// (402). Nothing new is stored: a period is a window over those records, computed when Progress is opened.
//
// ⚠ IMPROVEMENT IS NOT EXPOSURE. In each period, knowledge is the FIRST-TRY accuracy on questions answered for the
//   first time in that period -- new evidence. Answers on questions already seen are repeated exposure, counted
//   apart, and never lift the knowledge figure. A trend compares only first-try accuracy on new items.
// ⚠ A FIGURE NEEDS ENOUGH EVIDENCE. Below the minimum a period shows its counts and no percentage.
// ⚠ HISTORY IS NOT REWRITTEN. A programme change starts a new programme period; earlier periods keep their own
//   context, and kept evaluations keep the catalogue snapshot they were made with (426).
// ⚠ NOT COMPETENCE. Educational development of the student's own practice.
//
// Pure: no I/O, no clock of its own (`now` is passed in).

import type { EAttempt, ECheck, EDecision, EQuestion, EReview } from "./evaluation";

export type PeriodKind = "week" | "month" | "programme";
export type ContextSpan = { programme: string; level: string | null; from: string; to: string | null };
export type KeptEvaluation = { id: string; createdAt: string; confidence: string; label: string; method: string };
export type HistoryInput = {
  questions: EQuestion[]; attempts: EAttempt[]; reviews: EReview[]; decisions: EDecision[]; checks: ECheck[];
  evaluations: KeptEvaluation[]; contexts: ContextSpan[];
};
export type Figure = { n: number; correct: number; percent: number | null };
export type PeriodRow = {
  key: string; label: string; start: string; end: string; context: string | null;
  /** First-try accuracy on questions answered for the first time in this period: new evidence. */
  knowledge: Figure;
  /** Answers on questions already seen before this period: practice, not new evidence. */
  exposure: { answers: number; correct: number };
  retention: Figure;
  /** First-time decisions in cases, marked by their key. */
  reasoning: Figure;
  activity: { answers: number; reviews: number; decisions: number; checks: number };
  evaluations: KeptEvaluation[];
};
export type Trend = "improving" | "steady" | "lower" | null;
export type History = { kind: PeriodKind; rows: PeriodRow[]; trends: { knowledge: Trend; retention: Trend; reasoning: Trend }; notes: string[] };

const DAY = 86_400_000;
const pct = (n: number, d: number) => Math.round((n / d) * 100);
const figure = (n: number, correct: number, min: number): Figure => ({ n, correct, percent: n >= min ? pct(correct, n) : null });

/** Monday 00:00 UTC of the week containing `iso`. */
export function weekStart(iso: string): string {
  const d = new Date(iso); const day = (d.getUTCDay() + 6) % 7;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day)).toISOString();
}
const monthStart = (iso: string) => { const d = new Date(iso); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString(); };

/** The periods, oldest first: the last `count` weeks or months to `now`, or one per educational context. */
export function periods(kind: PeriodKind, now: string, count: number, contexts: readonly ContextSpan[]): { key: string; label: string; start: string; end: string; context: string | null }[] {
  if (kind === "programme") {
    if (!contexts.length) return [{ key: "all", label: "All your learning", start: "1970-01-01T00:00:00.000Z", end: now, context: null }];
    return [...contexts].sort((a, b) => a.from.localeCompare(b.from)).map((c, i, all) => ({
      key: `ctx${i}`, label: `${c.programme}${c.level ? `, ${c.level}` : ""}`, start: i === 0 ? "1970-01-01T00:00:00.000Z" : c.from,
      end: c.to ?? all[i + 1]?.from ?? now, context: `${c.programme}${c.level ? `, ${c.level}` : ""}`,
    }));
  }
  const out: { key: string; label: string; start: string; end: string; context: string | null }[] = [];
  let start = kind === "week" ? weekStart(now) : monthStart(now);
  for (let i = 0; i < count; i++) {
    const d = new Date(start);
    const end = kind === "week" ? new Date(d.getTime() + 7 * DAY).toISOString() : new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)).toISOString();
    const label = kind === "week" ? `Week of ${d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })}` : d.toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
    out.unshift({ key: start.slice(0, 10), label, start, end, context: null });
    start = kind === "week" ? new Date(d.getTime() - 7 * DAY).toISOString() : new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1)).toISOString();
  }
  return out;
}

/** A trend from the last two periods that have a figure: a change of `step` points or more, else steady. */
export function trendOf(rows: readonly Figure[], step = 10): Trend {
  const measured = rows.filter(r => r.percent !== null);
  if (measured.length < 2) return null;
  const [a, b] = measured.slice(-2);
  return b.percent! - a.percent! >= step ? "improving" : a.percent! - b.percent! >= step ? "lower" : "steady";
}

/** Pure. The student's learning history in periods, with genuine improvement kept apart from repeated exposure. */
export function learningHistory(input: HistoryInput, opts: { kind: PeriodKind; now: string; count: number; minPerPeriod: number }): History {
  const ps = periods(opts.kind, opts.now, opts.count, input.contexts);
  const det = input.attempts.filter(a => a.marking === "deterministic").sort((x, y) => x.answeredAt.localeCompare(y.answeredAt));
  const firstSeen = new Map<string, string>();
  for (const a of det) if (!firstSeen.has(a.questionId)) firstSeen.set(a.questionId, a.answeredAt);
  const choice = input.decisions.filter(d => !d.written && d.marking === "deterministic" && d.correct !== null).sort((x, y) => x.createdAt.localeCompare(y.createdAt));
  const firstDecision = new Set<string>(); const decisionFirst: EDecision[] = [];
  for (const d of choice) { const k = `${d.caseId}:${d.decisionPointId}`; if (!firstDecision.has(k)) { firstDecision.add(k); decisionFirst.push(d); } }
  const within = (t: string, p: { start: string; end: string }) => t >= p.start && t < p.end;

  const rows: PeriodRow[] = ps.map(p => {
    const inP = det.filter(a => within(a.answeredAt, p));
    const fresh = inP.filter(a => firstSeen.get(a.questionId) === a.answeredAt);
    const repeat = inP.filter(a => firstSeen.get(a.questionId) !== a.answeredAt);
    const recalls = input.reviews.filter(v => v.intervalDays >= 1 && within(v.reviewedAt, p));
    const dec = decisionFirst.filter(d => within(d.createdAt, p));
    return {
      ...p,
      knowledge: figure(fresh.length, fresh.filter(a => a.correct).length, opts.minPerPeriod),
      exposure: { answers: repeat.length, correct: repeat.filter(a => a.correct).length },
      retention: figure(recalls.length, recalls.filter(v => v.quality >= 3).length, opts.minPerPeriod),
      reasoning: figure(dec.length, dec.filter(d => d.correct).length, opts.minPerPeriod),
      activity: {
        answers: input.attempts.filter(a => within(a.answeredAt, p)).length, reviews: input.reviews.filter(v => within(v.reviewedAt, p)).length,
        decisions: input.decisions.filter(d => within(d.createdAt, p)).length, checks: input.checks.filter(c => within(c.createdAt, p)).length,
      },
      evaluations: input.evaluations.filter(e => within(e.createdAt, p)),
    };
  });

  const notes: string[] = ["Knowledge over time counts only questions answered for the first time in each period. Answering a question again is practice, shown apart."];
  if (opts.kind === "programme" && input.contexts.length > 1) notes.push("Each period is one educational context. Earlier periods keep their own context when it changes.");
  if (!rows.some(r => r.knowledge.percent !== null || r.retention.percent !== null || r.reasoning.percent !== null))
    notes.push(`No period has enough evidence for a figure yet (${opts.minPerPeriod} needed in a period). The counts still show what you did.`);
  return { kind: opts.kind, rows, trends: { knowledge: trendOf(rows.map(r => r.knowledge)), retention: trendOf(rows.map(r => r.retention)), reasoning: trendOf(rows.map(r => r.reasoning)) }, notes };
}
