import type { QuestionKind } from "./generation";

// ── SELF-DIRECTED STUDY IN THE PASSPORT ── COMPETEN-IND-004 s11, owner continuation GO 2026-10-23 item 3 ──
//
// The person chooses, one achievement at a time, which of their Scholar study achievements appear in their
// Competen Passport (migration 375, individual_scholar_passport_item). The row is the choice. No row, not
// shown: nothing is in the Passport by default, and taking one off deletes only that choice.
//
// ⚠ AN ACHIEVEMENT IS DERIVED, NEVER COPIED. What is shown is the label the person chose, what kind of
// practice it was, how many they answered and when they last studied, computed from their own study
// history each time the Passport or a share link is rendered. Never the material's text, a question, an
// answer, whether it was right, an explanation or anything else an AI wrote. Both kinds only grow while
// the material exists, so a chosen achievement cannot quietly become untrue. Deleting the material takes
// its achievements off the Passport with it (the 375 cascade).
//
// ⚠ SELF-DIRECTED, AND SAID SO WHEREVER IT IS SHOWN. Answering practice questions written from your own
// notes is study, not an assessment. It is labelled `self_directed` (src/lib/individual/passport.ts),
// distinct from what the person declared and from what an organisation issued or verified, and no figure
// that reads as a measure of competence (accuracy, "mastery") is ever shown with it.
//
// Pure: the store (store.ts) does the reads and writes, keyed on the caller's own user_id.

export type StudyAchievementKind = "practice_questions" | "practice_scenarios" | "revision_reviews";
export const STUDY_ACHIEVEMENT_KINDS: readonly StudyAchievementKind[] = ["practice_questions", "practice_scenarios", "revision_reviews"];

/**
 * Where each kind's one figure comes from. Two count distinct practice questions answered, by question kind.
 * revision_reviews (COMPETEN-SCHOLAR-01 S5, migration 391) counts spaced-revision reviews made on the
 * material, from individual_scholar_review -- a count, never the recall grade. All three only grow while
 * the material exists.
 */
export const STUDY_ACHIEVEMENT: Record<StudyAchievementKind, { questionKind: QuestionKind | null; name: string; one: string; many: string; verb: string }> = {
  practice_questions: { questionKind: "mcq", name: "Practice questions", one: "practice question", many: "practice questions", verb: "answered from own notes" },
  practice_scenarios: { questionKind: "case", name: "Practice scenarios", one: "practice scenario", many: "practice scenarios", verb: "answered from own notes" },
  revision_reviews: { questionKind: null, name: "Revision", one: "revision review", many: "revision reviews", verb: "of own notes" },
};

export const isStudyAchievementKind = (v: unknown): v is StudyAchievementKind =>
  typeof v === "string" && (STUDY_ACHIEVEMENT_KINDS as readonly string[]).includes(v);

export const PASSPORT_LABEL_MAX = 120;

/** The label as stored: whitespace collapsed and trimmed, 1 to 120 characters, or null. Migration 375 checks the same. */
export function parseLabel(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const label = raw.replace(/\s+/g, " ").trim();
  return label.length >= 1 && label.length <= PASSPORT_LABEL_MAX ? label : null;
}

/** One chosen achievement, as the Passport and /verify show it. */
export type StudyAchievement = {
  materialId: string;
  achievement: StudyAchievementKind;
  label: string;
  answered: number;
  lastStudied: string | null;
  includedAt: string;
};

/** One achievement the person could show, and whether they do. */
export type EligibleAchievement = {
  materialId: string;
  materialTitle: string;
  achievement: StudyAchievementKind;
  answered: number;
  lastStudied: string | null;
  /** The label in the Passport when chosen, else null. */
  chosenLabel: string | null;
};

export type ChoiceRow = { materialId: string; achievement: StudyAchievementKind; label: string; includedAt: string };
type QuestionRef = { id: string; materialId: string; kind: QuestionKind };
type AttemptRef = { questionId: string; answeredAt: string };
/** One revision review (migration 391): which material, and when. Never the grade. */
export type ReviewRef = { materialId: string; reviewedAt: string };

/**
 * Pure: per material and achievement kind, the one figure and the latest activity -- distinct questions
 * answered for the two practice kinds, reviews made for revision.
 */
function answeredBy(questions: readonly QuestionRef[], attempts: readonly AttemptRef[], reviews: readonly ReviewRef[] = []) {
  const byId = new Map(questions.map(q => [q.id, q]));
  const seen = new Map<string, { ids: Set<string>; last: string | null }>();
  for (const a of attempts) {
    const q = byId.get(a.questionId);
    if (!q) continue;
    const kind = STUDY_ACHIEVEMENT_KINDS.find(k => STUDY_ACHIEVEMENT[k].questionKind === q.kind);
    if (!kind) continue;
    const key = `${q.materialId}|${kind}`;
    const s = seen.get(key) ?? { ids: new Set<string>(), last: null };
    s.ids.add(q.id);
    if (!s.last || a.answeredAt > s.last) s.last = a.answeredAt;
    seen.set(key, s);
  }
  const revision = new Map<string, { n: number; last: string | null }>();
  for (const r of reviews) {
    const s = revision.get(r.materialId) ?? { n: 0, last: null };
    s.n++;
    if (!s.last || r.reviewedAt > s.last) s.last = r.reviewedAt;
    revision.set(r.materialId, s);
  }
  return (materialId: string, kind: StudyAchievementKind) => {
    if (kind === "revision_reviews") {
      const r = revision.get(materialId);
      return { answered: r?.n ?? 0, lastStudied: r?.last ?? null };
    }
    const s = seen.get(`${materialId}|${kind}`);
    return { answered: s?.ids.size ?? 0, lastStudied: s?.last ?? null };
  };
}

/**
 * Pure: the chosen achievements, with their figures. An item with nothing answered is dropped rather than
 * shown as an achievement of zero -- it cannot happen while the material exists, and showing less is the
 * safe failure on a page a third party reads.
 */
export function studyAchievementsFrom(input: { choices: readonly ChoiceRow[]; questions: readonly QuestionRef[]; attempts: readonly AttemptRef[]; reviews?: readonly ReviewRef[] }): StudyAchievement[] {
  const stat = answeredBy(input.questions, input.attempts, input.reviews);
  return input.choices
    .map(c => ({ ...c, ...stat(c.materialId, c.achievement) }))
    .filter(a => a.answered > 0);
}

/** Pure: every achievement the person has earned, one per material and kind with at least one answer. */
export function eligibleAchievements(input: {
  materials: readonly { id: string; title: string }[]; questions: readonly QuestionRef[]; attempts: readonly AttemptRef[]; choices: readonly ChoiceRow[];
  reviews?: readonly ReviewRef[];
}): EligibleAchievement[] {
  const stat = answeredBy(input.questions, input.attempts, input.reviews);
  const chosen = new Map(input.choices.map(c => [`${c.materialId}|${c.achievement}`, c.label]));
  const out: EligibleAchievement[] = [];
  for (const m of input.materials) {
    for (const k of STUDY_ACHIEVEMENT_KINDS) {
      const s = stat(m.id, k);
      if (s.answered > 0) out.push({ materialId: m.id, materialTitle: m.title, achievement: k, ...s, chosenLabel: chosen.get(`${m.id}|${k}`) ?? null });
    }
  }
  return out;
}

/** "12 practice questions answered from own notes", "8 revision reviews of own notes" -- the one figure shown. Never accuracy or a grade. */
export function studyDetail(a: { achievement: StudyAchievementKind; answered: number }): string {
  const k = STUDY_ACHIEVEMENT[a.achievement];
  return `${a.answered} ${a.answered === 1 ? k.one : k.many} ${k.verb}`;
}
