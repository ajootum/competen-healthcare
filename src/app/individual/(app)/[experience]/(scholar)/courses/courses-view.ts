import { noProgrammeText } from "@/lib/individual/scholar/classify-view";

// ── COURSES & TRAINING: WHAT EACH DESTINATION SAYS ── SCHOLAR-MODULES-01 ───────────────────────────────────
//
// Pure: the empty, unreadable and listed states of the four Courses & Training pages, decided from rows the
// existing readers already returned (Competen Learning's myRecords and loadLearningRecords, the Scholar
// programme store). Nothing here reads, writes or invents a course.
//
// ⚠ UNREADABLE IS NOT EMPTY. A read that failed (null) is its own state; "none" is said only when a read
// succeeded and found none.
// ⚠ NOTHING IS OFFERED THAT COMPETEN HAS NOT PUBLISHED. Courses live in Competen Learning (ADR-017) and are
// shown here by reference, never copied. While Learning is off, Explore says so and nothing else.

export const EXPLORE_OFF = "Courses are not offered in Competen Scholar yet. When Competen publishes courses, they will appear here. Nothing is needed from you.";
export const MY_COURSES_NONE = "You are not taking any courses.";
export const PROGRESS_NONE = "No completed courses on your record.";
export const LEARNING_HOME = "/individual/learning";

export type ListView<T> = { kind: "unreadable" } | { kind: "empty"; text: string } | { kind: "items"; items: T[] };

export type ExploreView = { kind: "handoff"; href: string } | { kind: "off"; text: string };

/** Learning on: ONE handoff to the Competen Learning catalogue (nothing copied). Off: the honest empty state. */
export function exploreView(learningOn: boolean): ExploreView {
  return learningOn ? { kind: "handoff", href: LEARNING_HOME } : { kind: "off", text: EXPLORE_OFF };
}

// ── MY COURSES: records not yet completed ──

export type RecordLike = { id: string; title: string; code: string; status: string; delivery: string; enrolledAt: string };
export type CourseRow = { id: string; title: string; code: string; statusLabel: string; deliveryLabel: string; enrolledAt: string };

const OPEN = new Set(["enrolled", "in_progress"]);
const STATUS_LABEL: Record<string, string> = { enrolled: "Enrolled", in_progress: "In progress" };

/** Records still being taken. Completed ones are in Learning Progress, and a withdrawn record is closed. */
export function myCoursesView(learningOn: boolean, records: readonly RecordLike[] | null): ListView<CourseRow> {
  if (!learningOn) return { kind: "empty", text: MY_COURSES_NONE };
  if (records === null) return { kind: "unreadable" };
  const items = records.filter(r => OPEN.has(r.status)).map(r => ({
    id: r.id, title: r.title, code: r.code, statusLabel: STATUS_LABEL[r.status] ?? r.status,
    deliveryLabel: r.delivery === "external" ? "With another provider" : "On Competen", enrolledAt: r.enrolledAt,
  }));
  return items.length ? { kind: "items", items } : { kind: "empty", text: MY_COURSES_NONE };
}

// ── LEARNING PROGRESS: completed records, certificates by reference ──

export type CompletedLike = {
  recordId: string; title: string; completedOn: string; outcomeLabel: string; evidenceLabel: string;
  certificates: readonly { no: string; revoked: boolean }[];
};
export type CompletedRow = { recordId: string; title: string; completedOn: string; outcomeLabel: string; evidenceLabel: string; certificates: { no: string; revoked: boolean }[] };

export function completedView(learningOn: boolean, refs: readonly CompletedLike[] | null): ListView<CompletedRow> {
  if (!learningOn) return { kind: "empty", text: PROGRESS_NONE };
  if (refs === null) return { kind: "unreadable" };
  return refs.length
    ? { kind: "items", items: refs.map(r => ({ recordId: r.recordId, title: r.title, completedOn: r.completedOn, outcomeLabel: r.outcomeLabel, evidenceLabel: r.evidenceLabel, certificates: r.certificates.map(c => ({ no: c.no, revoked: c.revoked })) })) }
    : { kind: "empty", text: PROGRESS_NONE };
}

// ── MY PROGRAMMES ──

export type Read<T> = { ok: true; data: T } | { ok: false; notProvisioned: boolean };
export type ProgrammeSummaryLike = { code: string; label: string; profession: string; country: string | null; level: string | null };
export type ChosenProgrammeLike = ProgrammeSummaryLike & { frameworks: readonly unknown[] };

export type ProgrammesView =
  | { kind: "unreadable" }
  /** 387 is not on this environment, or no programme is offered or chosen: said with the programme words. */
  | { kind: "none"; text: string; offered: ProgrammeSummaryLike[] }
  | { kind: "chosen"; programme: { code: string; label: string; profession: string; level: string | null; country: string | null; frameworkCount: number }; others: ProgrammeSummaryLike[] };

export function programmesView(chosen: Read<ChosenProgrammeLike | null>, offered: Read<ProgrammeSummaryLike[]>): ProgrammesView {
  if (!chosen.ok) return chosen.notProvisioned ? { kind: "none", text: noProgrammeText(0), offered: [] } : { kind: "unreadable" };
  if (!offered.ok) return offered.notProvisioned ? { kind: "none", text: noProgrammeText(0), offered: [] } : { kind: "unreadable" };
  if (!chosen.data) return { kind: "none", text: noProgrammeText(offered.data.length), offered: offered.data };
  const p = chosen.data;
  return {
    kind: "chosen",
    programme: { code: p.code, label: p.label, profession: p.profession, level: p.level, country: p.country, frameworkCount: p.frameworks.length },
    others: offered.data.filter(o => o.code !== p.code),
  };
}

/** "Nursing · Level 6 · Uganda", skipping what is not recorded. */
export const programmeLine = (p: { profession: string; level: string | null; country: string | null }): string =>
  [p.profession, p.level, p.country].filter(Boolean).join(" · ");
