// ── SCHOLAR-COMPANION-01 P1: THE MISTAKE NOTEBOOK ── the learner's own wrong answers, read back, nothing new stored ──
//
// Pure: no I/O and no clock. The store reads the rows (store.ts mistakeRows, the learner's own, capped); this groups
// and words them. A mistake is an existing wrong ATTEMPT (372/416): the question, what the learner answered, the key
// and the explanation already stored with the question. Whether it is "corrected" is read from LATER attempts of the same
// question (a correct one after the last miss). Nothing is written here and nothing is invented: there is no "mark as
// understood" because no mechanism for it exists, and a new store would be a second engine.
// ⚠ FORMATIVE. A notebook of practice answers is not an assessment, a mastery claim or evidence of competence.

import { answerText, type RevisionQuestion } from "./revision";
import { MARKING_LABEL, type Marking } from "./config";
import { formativeOf, formativeText } from "./written-feedback";

/** The most wrong answers read for the notebook, newest first (store.ts mistakeRows). The page says when it was reached. */
export const MISTAKES_ROW_CAP = 200;

export type MistakeAttempt = {
  questionId: string; correct: boolean; answeredAt: string; chosenIndex: number | null; response: unknown; marking: string | null; score: number | null;
};
/** An attempt as the history needs it: which question, right or wrong, when. */
export type AttemptMark = { questionId: string; correct: boolean; answeredAt: string };
export type MistakeQuestion = RevisionQuestion & { materialId: string; chunkId: string };

export type MistakeItem = {
  questionId: string; materialId: string; chunkId: string; kind: string; stem: string;
  /** What the learner answered, in words (empty-handed answers are said so). */
  yourAnswer: string;
  /** The key in words, and the explanation stored with the question. */
  correctAnswer: string; rationale: string;
  lastMissedAt: string; missed: number; corrected: boolean; correctedAt: string | null;
  marking: Marking | null; markingLabel: string | null;
  /** Formative AI feedback kept with the answer (SCHOLAR-WRITTEN-FEEDBACK-01), only on an AI-evaluated answer. */
  formative: { model: string; texts: string[] } | null;
  topics: string[];
};
export type MistakeGroup = { materialId: string; title: string; items: MistakeItem[]; toFix: number };
export type MistakeNotebook = {
  groups: MistakeGroup[]; toFix: number; total: number;
  materials: { id: string; title: string; toFix: number }[]; topics: string[];
};

const letter = (i: number) => String.fromCharCode(65 + i);
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** Pure. The ids whose most recent attempt was wrong: what is still to fix. Ties on time go to the later row given. */
export function toFixIds(history: readonly AttemptMark[]): Set<string> {
  const latest = new Map<string, AttemptMark>();
  for (const a of history) {
    const cur = latest.get(a.questionId);
    if (!cur || a.answeredAt >= cur.answeredAt) latest.set(a.questionId, a);
  }
  return new Set([...latest].filter(([, a]) => !a.correct).map(([id]) => id));
}

/** Pure. What the learner answered, in words, for the question's kind. */
export function yourAnswerText(q: RevisionQuestion, a: Pick<MistakeAttempt, "chosenIndex" | "response">): string {
  const opt = (i: unknown) => (Number.isInteger(i) && (i as number) >= 0 && (i as number) < q.options.length ? `${letter(i as number)}. ${q.options[i as number]}` : null);
  if (a.chosenIndex !== null && a.chosenIndex !== undefined) return opt(a.chosenIndex) ?? "Not recorded";
  const r = isObj(a.response) ? a.response : null;
  if (!r) return "Not recorded";
  if (typeof r.text === "string") return r.text.trim() ? r.text.trim().slice(0, 600) : "No answer typed";
  if (Array.isArray(r.indexes)) {
    const picked = r.indexes.map(opt).filter((x): x is string => !!x);
    return picked.length ? picked.join("; ") : "Nothing chosen";
  }
  if (Array.isArray(r.matches)) { const m = r.matches as unknown[]; return q.options.map((p, i) => `${p} → ${typeof m[i] === "string" && m[i] ? m[i] : "?"}`).join("; "); }
  if (Array.isArray(r.order)) return r.order.map(i => (Number.isInteger(i) && (i as number) >= 0 && (i as number) < q.options.length ? q.options[i as number] : "?")).join(" → ");
  if (Array.isArray(r.texts)) return r.texts.map((t, i) => `(${String.fromCharCode(97 + i)}) ${typeof t === "string" && t.trim() ? t.trim().slice(0, 300) : "no answer"}`).join("; ");
  if (typeof r.quality === "number") return `You rated your recall ${r.quality} of 5: not remembered`;
  return "Not recorded";
}

/**
 * Pure. The notebook: every question with a wrong answer in `wrong` (the learner's latest wrong attempts), newest miss
 * first, grouped by material. `history` is every attempt of those questions (right and wrong), for how many times each was
 * missed and whether a later attempt corrected it. `show` "fix" keeps only what is still to fix; "all" keeps corrected ones too.
 * A material or topic narrows the list. The counts (toFix, per material) are those of the unfiltered notebook.
 */
export function buildMistakeNotebook(input: {
  wrong: readonly MistakeAttempt[]; history: readonly AttemptMark[]; questions: ReadonlyMap<string, MistakeQuestion>;
  titles: ReadonlyMap<string, string>; topics: ReadonlyMap<string, readonly string[]>;
  show?: "fix" | "all"; materialId?: string | null; topic?: string | null;
}): MistakeNotebook {
  const lastWrong = new Map<string, MistakeAttempt>();
  for (const a of input.wrong) {
    if (a.correct || !input.questions.has(a.questionId)) continue;
    const cur = lastWrong.get(a.questionId);
    if (!cur || a.answeredAt > cur.answeredAt) lastWrong.set(a.questionId, a);
  }
  const missed = new Map<string, number>();
  const correctedAt = new Map<string, string>();
  for (const h of input.history) {
    const lw = lastWrong.get(h.questionId);
    if (!lw) continue;
    if (!h.correct) missed.set(h.questionId, (missed.get(h.questionId) ?? 0) + 1);
    else if (h.answeredAt > lw.answeredAt && (correctedAt.get(h.questionId) ?? "") < h.answeredAt) correctedAt.set(h.questionId, h.answeredAt);
  }
  const all: MistakeItem[] = [...lastWrong].map(([id, a]) => {
    const q = input.questions.get(id)!;
    const marking = a.marking && a.marking in MARKING_LABEL ? (a.marking as Marking) : null;
    const f = formativeOf(a.response, a.marking);
    return {
      questionId: id, materialId: q.materialId, chunkId: q.chunkId, kind: q.kind, stem: q.stem,
      yourAnswer: yourAnswerText(q, a), correctAnswer: answerText(q), rationale: q.rationale,
      lastMissedAt: a.answeredAt, missed: Math.max(1, missed.get(id) ?? 1), corrected: correctedAt.has(id), correctedAt: correctedAt.get(id) ?? null,
      marking, markingLabel: marking ? MARKING_LABEL[marking] : null,
      formative: f ? { model: f.model, texts: f.items.map(formativeText).filter(Boolean) } : null,
      topics: [...(input.topics.get(q.chunkId) ?? [])],
    };
  }).sort((a, b) => b.lastMissedAt.localeCompare(a.lastMissedAt) || a.questionId.localeCompare(b.questionId));

  const materials = new Map<string, { id: string; title: string; toFix: number }>();
  for (const i of all) {
    const m = materials.get(i.materialId) ?? { id: i.materialId, title: input.titles.get(i.materialId) ?? "Your material", toFix: 0 };
    if (!i.corrected) m.toFix++;
    materials.set(i.materialId, m);
  }
  const topics = [...new Set(all.flatMap(i => i.topics))].sort((a, b) => a.localeCompare(b));
  const kept = all.filter(i => (input.show === "all" || !i.corrected) && (!input.materialId || i.materialId === input.materialId) && (!input.topic || i.topics.includes(input.topic)));
  const groups = new Map<string, MistakeGroup>();
  for (const i of kept) {
    const g = groups.get(i.materialId) ?? { materialId: i.materialId, title: input.titles.get(i.materialId) ?? "Your material", items: [], toFix: 0 };
    g.items.push(i);
    if (!i.corrected) g.toFix++;
    groups.set(i.materialId, g);
  }
  return {
    groups: [...groups.values()], toFix: all.filter(i => !i.corrected).length, total: all.length,
    materials: [...materials.values()].sort((a, b) => a.title.localeCompare(b.title)), topics,
  };
}
