// ── SCHOLAR-INLINE-CHECKS-01 (owner GO, 1 Nov 2026): CHECKS INSIDE THE SCROLLING LESSON ────────────────────────────────
//
// Client-safe and pure: no server imports, no I/O. Three small things the Learn workspace needs and nothing more.
//
//   1. inlineCheckPlacement -- which lessons show a recall card, from the lessons as the page holds them and the four policy
//      values (scholar_learn_inline_recall / _recall_placement / _recall_min_words, plus the application switch). A lesson
//      with nothing to ask (no saved check question and no key points) never gets a card: nothing is generated for it.
//   2. recallContent -- the card's question and answer, taken from the SAVED lesson only (its check question or key points),
//      so reopening a lesson needs no AI.
//   3. The marks: recall ("r" remembered / "a" again / "s" skipped) and the quick check ("c" correct / "w" wrong), per lesson
//      step, kept in the existing learning-position object (790 `unfinished`, small, never AI output, never notes content).
//
// ⚠ A recall rating is the learner's OWN judgement. A quick check is marked by code against the stored answer. Neither is an
// assessment, verified competence or a Passport record.

export type InlinePolicy = {
  recall: "on" | "off";
  placement: "substantial" | "every_lesson" | "lesson_end";
  minWords: number;
  checks: "on" | "off";
  application: "on" | "off";
  skippable: "on" | "off";
  /** ADDENDUM 2: the end-of-lesson recall block gates "Next lesson" and the lessons' completion. */
  required: "required" | "optional";
  /** ADDENDUM 3: the required block comes after every N lessons, or once after the last. */
  every: CheckEvery;
  /** ADDENDUM 2: "Save as a flashcard to revise" starts ticked after "Didn't remember". */
  saveMissed: "on" | "off";
};
export type CheckEvery = "1" | "2" | "3" | "journey_end";

/** The values used when the page passes nothing (the code fallbacks of the six policy keys). */
export const INLINE_DEFAULTS: InlinePolicy = { recall: "on", placement: "substantial", minWords: 180, checks: "on", application: "on", skippable: "on", required: "required", every: "2", saveMissed: "on" };

export type InlineLesson = {
  /** Words in the lesson's teaching text (0 when nothing is taught or saved yet). */
  words: number;
  /** The saved lesson holds something to ask (a check question or key points). */
  hasRecall: boolean;
  /** The lesson's teaching is on the page. */
  taught: boolean;
};

/** Pure. Words in a text, citation tags ([S1]) not counted. */
export function wordCount(text: string | null | undefined): number {
  if (!text) return 0;
  return text.replace(/\[[SRE]\d+\]/g, " ").split(/\s+/).filter(Boolean).length;
}

/**
 * Pure. Per lesson, whether a recall card is shown after it. At most one per lesson, and only where the saved lesson holds a
 * question and its teaching is on the page.
 *   substantial   the teaching text has at least `minWords` words
 *   every_lesson  every lesson that has something to ask
 *   lesson_end    only the final lesson of the journey (once)
 */
export function inlineCheckPlacement(lessons: readonly InlineLesson[], policy: Pick<InlinePolicy, "recall" | "placement" | "minWords">): boolean[] {
  const last = lessons.length - 1;
  return lessons.map((l, i) => {
    if (policy.recall !== "on" || !l.taught || !l.hasRecall) return false;
    if (policy.placement === "every_lesson") return true;
    if (policy.placement === "lesson_end") return i === last;
    return l.words >= Math.max(0, policy.minWords);
  });
}

/**
 * Pure. THE APPLY RULE (owner GO "Teaching Style & Practice HFE Redesign"): a case is offered only where the content is clinically
 * relevant. The reliable signal that exists is a competency: the lesson's session studies a competency, or at least one of its
 * sections has an ACCEPTED competency mapping. Otherwise Apply is hidden. The Practise panel and the end-of-lesson card use this one rule.
 */
export const applyEligible = (scopeKind: string | null | undefined, chunkIds: readonly string[], mapped: ReadonlySet<string>): boolean =>
  scopeKind === "competency" || chunkIds.some(c => mapped.has(c));

// ── THE REQUIRED RECALL BLOCK (owner, 1 Nov: addenda 2 and 3) ──

/** One block of recall cards: it closes after lesson `closesAt` (an index) and covers these lesson indexes, one card each. */
export type CheckBlock = { closesAt: number; covers: number[]; steps: number[] };

/**
 * Pure. Which lessons close a recall block and which lessons each block covers. A block closes after every Nth lesson (2, 4, 6 ...)
 * and ALWAYS after the final lesson, even when that only closes an incomplete block (lesson 5 of 5 closes lessons 5). "journey_end":
 * one block after the last lesson, covering all of them. Positions are the journey's own (a resumed journey has the same blocks).
 */
export function checkBlocks(lessonSteps: readonly number[], every: CheckEvery): CheckBlock[] {
  const n = lessonSteps.length;
  if (n === 0) return [];
  const size = every === "journey_end" ? n : Math.max(1, Number(every) || 2);
  const out: CheckBlock[] = [];
  let from = 0;
  for (let i = 0; i < n; i++) {
    if ((i + 1) % size !== 0 && i !== n - 1) continue;
    const covers = Array.from({ length: i - from + 1 }, (_, k) => from + k);
    out.push({ closesAt: i, covers, steps: covers.map(k => lessonSteps[k]) });
    from = i + 1;
  }
  return out;
}

/** The recall rating counts as done for the required check: either rating, never a skip, never a score. */
export const isRated = (m: RecallMark | null | undefined): boolean => m === "remembered" || m === "again";

/** Pure. A block is waiting while any of its cards is not yet revealed AND self-rated. No cards: nothing waits. */
export const blockPending = (marks: readonly (RecallMark | null | undefined)[]): boolean => marks.some(m => !isRated(m));

export const RECALL_WAIT_REASON = "Finish the recall check to continue";

/**
 * Pure. THE GATE: may the learner use the continue control on the lesson that closes a block. Optional: always. Required: once
 * every card in the block (the cards the saved lessons hold; none = nothing waits) has been rated. Only the continue control and
 * completion wait: earlier lessons, navigation, saving and leaving are never gated here.
 */
export const lessonCanContinue = (required: InlinePolicy["required"], blockMarks: readonly (RecallMark | null | undefined)[]): boolean =>
  required !== "required" || !blockPending(blockMarks);

/** Pure. The application check is offered once, after the final lesson, when the policy has it on and the lesson can open a case. */
export const applicationAfter = (index: number, count: number, policy: Pick<InlinePolicy, "application">, hasCase: boolean): boolean =>
  policy.application === "on" && hasCase && count > 0 && index === count - 1;

/** Pure. The recall card's words from the saved lesson: a check question (else the key-points question) and the concise answer. */
export function recallContent(x: {
  title: string; question: string | null; points: readonly string[]; overview: string | null; objective: string | null;
}): { front: string; back: string; why: string } | null {
  const clean = (s: string, max: number) => s.replace(/\s*\[[SRE]\d+\]/g, "").replace(/\s+/g, " ").trim().slice(0, max);
  const points = x.points.map(p => clean(p, 300)).filter(Boolean);
  const question = x.question ? clean(x.question, 300) : "";
  if (!question && !points.length) return null;
  const front = question || `What are the key points of ${clean(x.title, 120) || "this lesson"}?`;
  const back = points.length ? points.map(p => `- ${p}`).join("\n").slice(0, 600) : clean(x.objective ?? "", 600);
  if (!back) return null;
  return { front, back, why: clean(x.overview ?? "", 800) };
}

// ── THE MARKS (small, per lesson step) ──

export type RecallMark = "remembered" | "again" | "skipped";
export type QuickMark = "correct" | "wrong";
export const RECALL_CODE: Record<RecallMark, "r" | "a" | "s"> = { remembered: "r", again: "a", skipped: "s" };
export const QUICK_CODE: Record<QuickMark, "c" | "w"> = { correct: "c", wrong: "w" };
const RECALL_FROM: Record<string, RecallMark> = { r: "remembered", a: "again", s: "skipped" };
const QUICK_FROM: Record<string, QuickMark> = { c: "correct", w: "wrong" };
/** The most lessons whose marks are kept in one position (the 790 object holds at most 4000 bytes). */
export const MARKS_MAX = 120;

export type InlineMarks = { recall?: Record<string, "r" | "a" | "s">; quick?: Record<string, "c" | "w"> };

export const recallFromCode = (c: unknown): RecallMark | null => (typeof c === "string" ? RECALL_FROM[c] ?? null : null);
export const quickFromCode = (c: unknown): QuickMark | null => (typeof c === "string" ? QUICK_FROM[c] ?? null : null);

/** Pure. Marks read back from a stored object: only known codes under whole-number step keys, at most MARKS_MAX of each. */
export function cleanMarks(v: unknown): InlineMarks {
  const out: InlineMarks = {};
  if (!v || typeof v !== "object" || Array.isArray(v)) return out;
  const pick = <T extends string>(src: unknown, ok: (c: unknown) => boolean): Record<string, T> | undefined => {
    if (!src || typeof src !== "object" || Array.isArray(src)) return undefined;
    const m: Record<string, T> = {};
    let n = 0;
    for (const [k, c] of Object.entries(src as Record<string, unknown>)) {
      if (!/^\d{1,5}$/.test(k) || !ok(c)) continue;
      if (++n > MARKS_MAX) break;
      m[k] = c as T;
    }
    return n ? m : undefined;
  };
  const recall = pick<"r" | "a" | "s">((v as InlineMarks).recall, c => recallFromCode(c) !== null);
  const quick = pick<"c" | "w">((v as InlineMarks).quick, c => quickFromCode(c) !== null);
  if (recall) out.recall = recall;
  if (quick) out.quick = quick;
  return out;
}

/** Pure. Marks from the page's activities (indexed by lesson position) as stored marks (keyed by step number). */
export function marksFromActivities(steps: readonly number[], acts: readonly { recalled?: RecallMark; quickChecked?: QuickMark }[]): InlineMarks {
  const recall: Record<string, "r" | "a" | "s"> = {}, quick: Record<string, "c" | "w"> = {};
  steps.forEach((step, i) => {
    const a = acts[i];
    if (a?.recalled) recall[String(step)] = RECALL_CODE[a.recalled];
    if (a?.quickChecked) quick[String(step)] = QUICK_CODE[a.quickChecked];
  });
  return cleanMarks({ recall, quick });
}

/**
 * Pure. This device's marks and the server's, merged per lesson. A rating is the learner's latest word, but a lesson that has one
 * is never emptied by a copy that has none; where both rate, the local copy (this device, this visit) wins, except that a
 * remembered/again rating is never overwritten by "skipped".
 */
export function mergeMarks(local: InlineMarks, server: InlineMarks): InlineMarks {
  const merge = <T extends string>(a: Record<string, T> | undefined, b: Record<string, T> | undefined, keep?: (x: T, y: T) => T) => {
    const m: Record<string, T> = { ...(b ?? {}) };
    for (const [k, v] of Object.entries(a ?? {})) m[k] = keep && m[k] ? keep(v, m[k]) : v;
    return Object.keys(m).length ? m : undefined;
  };
  const out: InlineMarks = {};
  const recall = merge(local.recall, server.recall, (mine, theirs) => (mine === "s" && theirs !== "s" ? theirs : mine));
  const quick = merge(local.quick, server.quick);
  if (recall) out.recall = recall;
  if (quick) out.quick = quick;
  return out;
}
