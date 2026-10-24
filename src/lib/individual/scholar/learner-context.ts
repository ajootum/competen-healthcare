import type { CompetencyProgressRow } from "./competency-progress";

// ── THE TUTOR'S VIEW OF THE STUDENT ── COMPETEN-SCHOLAR-01 P1, "Personal AI" ────────────────────────────────
//
// Owner direction: "persistent learning context built from EXISTING structured history ... assembled at request
// time. No separate AI memory store." So there is no memory table. On each tutor turn the route reads the
// person's own rows -- their programme, the competencies the passages are linked to by ACCEPTED mappings, and
// progress by competency (built from their answers) -- and this pure function turns them into a few plain
// sentences the tutor uses to choose what to focus on.
//
// ⚠ NOT GROUNDING, AND NOT QUOTED. The context steers emphasis only. It is never passed to checkExplanation as
// grounding, so anything the tutor says must still come from the passages; the prompt says not to mention it.
// ⚠ NO FIGURES. The grounding check withholds any number the passages lack, and a figure about the student (an
// accuracy, a count, a code) would invite one. The context is words only -- codes are left out and any digit
// is removed -- and it is qualitative ("not practised yet", "needs more practice"), never a score.
// ⚠ NOTHING ABOUT WHO THEY ARE. No name, email or profile field: only their own study state (owner review P0.4).
// ⚠ NOT STORED. It is rebuilt per request and lives only in the prompt (owner ruling D10).

/** Below this share right on the latest try (with at least one answer), a competency "needs more practice". */
export const NEEDS_PRACTICE_BELOW = 60;
const MAX_ITEMS = 5;

export type LearnerContextInput = {
  programme: string | null;
  /** The competencies the passages in this turn are linked to by the person's ACCEPTED mappings. */
  passageCompetencies: { title: string; structure: string | null }[];
  /** Progress by competency (competency-progress.ts), or null when it could not be read. */
  progress: CompetencyProgressRow[] | null;
};

/** Words only: no digits, no codes, one line. */
const words = (s: string) => s.replace(/\b[A-Z]{2,}(?:-[A-Z0-9]+)+\b/g, "").replace(/\d+/g, "").replace(/\s+/g, " ").replace(/\s+([,.;:)])/g, "$1").trim();
const list = (xs: string[]) => [...new Set(xs.map(words).filter(Boolean))].slice(0, MAX_ITEMS).join("; ");

/** Pure. The context block, or null when there is nothing worth saying. */
export function buildLearnerContext(input: LearnerContextInput): string | null {
  const lines: string[] = [];
  if (input.programme && words(input.programme)) lines.push(`I study: ${words(input.programme)}.`);
  const here = list(input.passageCompetencies.map(c => (c.structure ? `${c.title} (${c.structure})` : c.title)));
  if (here) lines.push(`I have linked these passages to these competencies: ${here}.`);
  if (input.progress) {
    const notYet = list(input.progress.filter(r => r.status === "notes_linked").map(r => r.title));
    const weak = list(input.progress.filter(r => r.latestAccuracy !== null && r.latestAccuracy < NEEDS_PRACTICE_BELOW).map(r => r.title));
    if (weak) lines.push(`My practice questions suggest I need more practice on: ${weak}.`);
    if (notYet) lines.push(`I have notes on, but have not practised yet: ${notYet}.`);
  }
  return lines.length ? lines.join("\n") : null;
}

/** How the block is framed in the prompt. The tutor may use it to choose emphasis, and must not cite or state it. */
export const CONTEXT_PREAMBLE =
  "ABOUT MY STUDY (from my own study record, not from the passages). Use it only to choose what to focus on and how to pitch it. Do not mention it, quote it or present it as part of the passages.";
