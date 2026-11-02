import type { Occurrence } from "../learning-plan/types";

// ── ONE DEFINITION OF EACH LEARNING FACT ── PLP-01..04 (owner GO 2 Nov 2026), My Plan calendar enhancement ───────────
//
// Pure: no I/O, no AI. Progress, Learning Intelligence, the monthly review and My Plan Insights each counted "study days" their
// own way (different sources, UTC days, rolling windows). They now share these definitions so one learner never sees two
// numbers for the same thing.
//
//   STUDY-ACTIVITY DAY   a learner-LOCAL day with at least one RECORDED learning event: a lesson event, an answer to a practice
//                        question, a spaced-review rating, a case decision, or a Teach Me check. NOT an upload, and NOT a plan
//                        entry. The local day comes from the learner's time zone (x-vercel-ip-timezone, UTC when absent or invalid).
//   SELF-REPORTED        a personal study session in the learner's own calendar, marked completed by the learner. It is PLANNED time
//                        that they say they did. It is counted apart (selfReportedDays / selfReportedSessions) and NEVER merged into
//                        a study-activity day. Busy times, placements, exams, deadlines, other entries and creating an entry never count.
//   COMPLETED SESSION    a session the learner finished, or answered in full.
//   LESSON COMPLETION    a lesson the records mark completed (taught, read and checked as the Learn journey defines it), not one merely opened.
//   PRACTICE ATTEMPT     one recorded answer to a practice question.
//   REVISION ACTIVITY    a spaced-review rating, or an answer given inside a revision session.
//   ASSESSMENT PERFORMANCE accuracy over answers marked by CODE (the app against a key). AI-evaluated and self-marked answers are not in it.
//                        With none it is null: not measured, never zero.
//
// ⚠ NONE OF THIS IS AN ASSESSMENT OF COMPETENCE.

export type StudyActivityKind = "lesson" | "answer" | "review" | "decision" | "check";
export type StudyStamp = { kind: StudyActivityKind; at: string };
/** The kinds that make a study-activity day. Uploads are deliberately absent. */
export const STUDY_ACTIVITY_KINDS: readonly StudyActivityKind[] = ["lesson", "answer", "review", "decision", "check"];

// ── the learner's local day ──
const DAY = 86_400_000;
const formatters = new Map<string, Intl.DateTimeFormat>();

/** The time zone name if it is a real IANA zone this runtime knows, else null. */
export function validTimeZone(tz: unknown): string | null {
  if (typeof tz !== "string" || tz.length === 0 || tz.length > 64 || !/^[A-Za-z0-9_+\-/]+$/.test(tz)) return null;
  try { new Intl.DateTimeFormat("en-CA", { timeZone: tz }); return tz; } catch { return null; }
}

function formatterFor(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz);
  if (!f) { f = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }); formatters.set(tz, f); }
  return f;
}

/** Pure. The calendar day (YYYY-MM-DD) an instant falls on in `tz` (UTC by default or when the zone is unknown). "" for an unreadable instant. */
export function localDay(at: string | number | Date, tz: string = "UTC"): string {
  const t = at instanceof Date ? at.getTime() : typeof at === "number" ? at : Date.parse(at);
  if (!Number.isFinite(t)) return "";
  const zone = validTimeZone(tz) ?? "UTC";
  const parts = formatterFor(zone).formatToParts(new Date(t));
  const get = (type: string) => parts.find(p => p.type === type)?.value ?? "";
  return `${get("year").padStart(4, "0")}-${get("month")}-${get("day")}`;
}

type HeaderBag = { get(name: string): string | null };
/** The learner's time zone from the request (Vercel sets x-vercel-ip-timezone), UTC when absent or invalid. */
export function learnerTimeZone(headers: HeaderBag | null | undefined): string {
  return validTimeZone(headers?.get("x-vercel-ip-timezone") ?? null) ?? "UTC";
}
/** Today's date for the learner: the local day of `now` in their time zone. */
export function learnerToday(headers: HeaderBag | null | undefined, now: Date = new Date()): string {
  return localDay(now, learnerTimeZone(headers));
}

const dayNum = (iso: string) => Math.floor(Date.parse(`${iso}T00:00:00Z`) / DAY);
export const shiftDay = (iso: string, n: number) => new Date((dayNum(iso) + n) * DAY).toISOString().slice(0, 10);

// ── study-activity days ──
/** Pure. The distinct local days with a recorded learning event, oldest first. */
export function studyActivityDays(stamps: readonly StudyStamp[], tz: string = "UTC"): string[] {
  const days = new Set<string>();
  for (const s of stamps) {
    if (!STUDY_ACTIVITY_KINDS.includes(s.kind)) continue;
    const d = localDay(s.at, tz);
    if (d) days.add(d);
  }
  return [...days].sort();
}
/** Pure. How many of the `windowDays` local days ending `today` (inclusive) are study-activity days. */
export function studyDaysInWindow(days: readonly string[], today: string, windowDays: number): number {
  const from = shiftDay(today, -(Math.max(1, windowDays) - 1));
  return new Set(days.filter(d => d >= from && d <= today)).size;
}
/** Pure. How many of the last `weeks` weeks (week 0 ends today) hold a study-activity day. */
export function activeWeeksIn(days: readonly string[], today: string, weeks: number): number {
  const w = new Set<number>();
  for (const d of days) { const k = Math.floor((dayNum(today) - dayNum(d)) / 7); if (k >= 0 && k < weeks) w.add(k); }
  return w.size;
}
/** Pure. The most recent study-activity day on or before `today`, or null. */
export function lastStudyDay(days: readonly string[], today: string): string | null {
  let best: string | null = null;
  for (const d of days) if (d <= today && (best === null || d > best)) best = d;
  return best;
}

// ── self-reported personal study sessions ──
export type SelfReported = { days: string[]; sessions: number; minutes: number | null };
/**
 * Pure. The learner's own completed personal study sessions, counted APART from recorded learning. `minutes` is the sum of the
 * sessions that state a length (null with none that do). The day is the calendar date the learner placed it on.
 */
export function selfReportedStudy(occurrences: readonly Occurrence[]): SelfReported {
  const done = occurrences.filter(o => o.entryType === "study_session" && o.selfReported && o.status === "completed");
  const withMinutes = done.filter(o => o.durationMinutes !== null);
  return { days: [...new Set(done.map(o => o.date))].sort(), sessions: done.length, minutes: withMinutes.length ? withMinutes.reduce((n, o) => n + (o.durationMinutes ?? 0), 0) : null };
}

// ── the other definitions ──
/** A session counts as completed when the learner finished it, or answered everything it planned. */
export const isCompletedSession = (s: { finishedAt?: string | null; answered: number; planned?: number | null }): boolean =>
  !!s.finishedAt || (s.planned != null && s.planned > 0 && s.answered >= s.planned);
/** A lesson counts as completed only when the records mark it completed. Read or opened is not enough. */
export const isLessonCompleted = (f: { read: boolean; completed: boolean }): boolean => f.completed === true;
/** A practice attempt is one recorded answer to a practice question. */
export const isPracticeAttempt = (a: { questionId?: string | null }): boolean => !!a.questionId;
/** Revision activity is a spaced-review rating, or an answer given inside a revision session. */
export const isRevisionActivity = (a: { kind: "review" | "answer"; revisionSessionId?: string | null }): boolean => a.kind === "review" || (a.kind === "answer" && !!a.revisionSessionId);

/** Pure. Assessment performance: the percentage of CODE-marked answers that were right, or null with none (not measured, never zero). */
export function assessmentPerformance(attempts: readonly { marking: string; correct: boolean | null }[]): { percent: number; answered: number } | null {
  const coded = attempts.filter(a => a.marking === "deterministic" && a.correct !== null);
  if (!coded.length) return null;
  return { percent: Math.round((coded.filter(a => a.correct).length * 100) / coded.length), answered: coded.length };
}
