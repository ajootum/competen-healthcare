// ── SALE-2026-11 R2 / SALE-10: TRANSFER OF LEARNING -- A QUESTION OUTSIDE THE LESSON WHERE THE CONCEPT WAS TAUGHT ── pure, NO AI ──
//
// A transfer check asks whether the learner can use a concept away from the lesson that taught it. It is a short revision session
// (417) of one to five questions, chosen REUSE FIRST, and recorded (970 individual_scholar_transfer_check) with the original lesson
// context and, per question, how it is outside that context. The answers are ordinary attempts (416) marked by the ordinary route;
// the learning state reads them back as transfer evidence in its "Applying it" dimension (learning-state.ts rule A2).
//
// THE ORIGINAL LESSON CONTEXT (lessonContext): the sections where the topic was taught (teaching actions, 414) and the sections of
// its lesson checks (950). THE QUESTION ASKED must not be one already answered, and must not be a lesson check.
//
// WHERE THE QUESTION COMES FROM, in order (pickTransfer, then the route):
//   library        an approved, published library question (442/800) on a competency the topic's sections are ACCEPTED-linked to:
//                  written independently of the learner's notes, so the strongest transfer;
//   other_material one of the learner's saved questions from ANOTHER material on the same topic or competency;
//   other_section  a saved question from another section of the same material;
//   new_question   a saved question on the lesson's own sections never answered and not a lesson check -- or, with none, a new
//                  question written by the EXISTING revision sessions route (harder difficulty, same gate, allowance, routing).
// Within a source, application and reasoning questions first: transfer is about using the idea.
//
// ⚠ FORMATIVE. A transfer answer is learning evidence, never competence and never a stage.

import { isCognitiveLevel } from "./question-intel";
import type { StateEvidence, ExposureRow } from "./learning-state";

export const TRANSFER_OUTSIDE = ["library", "other_material", "other_section", "new_question"] as const;
export type TransferOutside = (typeof TRANSFER_OUTSIDE)[number];
export const isTransferOutside = (v: unknown): v is TransferOutside => typeof v === "string" && (TRANSFER_OUTSIDE as readonly string[]).includes(v);
export const TRANSFER_OUTSIDE_LABEL: Record<TransferOutside, string> = {
  library: "an approved library question", other_material: "a question from other notes", other_section: "a question from another section",
  new_question: "a new question not asked in the lesson",
};
export const TRANSFER_SOURCES = ["saved", "library", "generated"] as const;
export type TransferSource = (typeof TRANSFER_SOURCES)[number];
export type TransferItem = { questionId: string; outside: TransferOutside };
export const TRANSFER_NOTE = "A question away from the lesson where you learned this, to see whether you can use it in a new setting. Formative practice: never a judgement of competence.";

const TEACHING = new Set(["teach", "explain", "simplify", "deeper", "examples", "summary", "read", "revisit", "resume", "clarify"]);

export type TransferContext = { contextChunkIds: string[]; materialIds: string[]; answeredIds: string[] };

/** Pure. The original lesson context of a topic: where it was taught, where its lesson checks were, what was answered. */
export function lessonContext(rows: readonly StateEvidence[], exposure: readonly ExposureRow[]): TransferContext {
  const chunks = new Set<string>();
  for (const e of exposure) if (TEACHING.has(e.action)) chunks.add(e.chunkId);
  for (const r of rows) if (r.source === "check" && r.chunkId) chunks.add(r.chunkId);
  const materials = new Set<string>(rows.filter(r => r.source === "check").map(r => r.materialId));
  return { contextChunkIds: [...chunks], materialIds: [...materials], answeredIds: [...new Set(rows.map(r => r.itemId))] };
}

/** A candidate question, as the route has it from the revision pool (own questions) or the library copy it made. */
export type TransferCandidate = {
  id: string; chunkId: string; materialId: string; level: string | null; difficulty: number | null;
  /** A lesson check (950 answer.check.source = lesson). */
  check: boolean;
  /** A copy of an approved library question. */
  library: boolean;
  /** Answered at least once before. */
  answered: boolean;
};

/** Pure. How a candidate is outside the lesson context, or null when it is inside it (answered before, or a lesson check). */
export function outsideOf(q: TransferCandidate, ctx: Pick<TransferContext, "contextChunkIds" | "materialIds" | "answeredIds">): TransferOutside | null {
  if (q.answered || q.check || ctx.answeredIds.includes(q.id)) return null;
  if (q.library) return "library";
  if (!ctx.contextChunkIds.includes(q.chunkId)) return ctx.materialIds.length && !ctx.materialIds.includes(q.materialId) ? "other_material" : "other_section";
  return "new_question";
}

const RANK: Record<TransferOutside, number> = { library: 0, other_material: 1, other_section: 2, new_question: 3 };
const applies = (q: TransferCandidate) => (isCognitiveLevel(q.level) ? q.level === "application" || q.level === "reasoning" : q.difficulty === 3);

/** Pure. Up to `n` questions for a transfer check, the most outside first, application and reasoning first within each. */
export function pickTransfer(pool: readonly TransferCandidate[], ctx: TransferContext, n: number): TransferItem[] {
  return pool.map((q, i) => ({ q, i, out: outsideOf(q, ctx) }))
    .filter((x): x is { q: TransferCandidate; i: number; out: TransferOutside } => x.out !== null)
    .sort((a, b) => RANK[a.out] - RANK[b.out] || Number(applies(b.q)) - Number(applies(a.q)) || a.i - b.i)
    .slice(0, Math.max(1, n)).map(x => ({ questionId: x.q.id, outside: x.out }));
}

/**
 * Pure. Rule X1: a transfer check is offered on a topic once its answers show SOME understanding (at least `distinctQuestions`
 * different questions answered well) and there is no transfer answer on it yet answered well. Never before: transfer of something
 * not yet understood tells nothing.
 */
export function transferOffered(rows: readonly StateEvidence[], distinctQuestions: number): { offered: boolean; reason: string } {
  const latest = new Map<string, StateEvidence>();
  for (const r of rows) if (r.outcome !== null && r.marking !== "unmarked" && r.source !== "review") { const l = latest.get(r.itemId); if (!l || r.at > l.at) latest.set(r.itemId, r); }
  const good = [...latest.values()].filter(r => (r.outcome ?? 0) >= 0.75);
  if (good.some(r => r.transfer)) return { offered: false, reason: "You have already answered a transfer question on this topic well." };
  if (good.length < distinctQuestions) return { offered: false, reason: `About ${distinctQuestions} different questions answered well come first.` };
  return { offered: true, reason: `You answered ${good.length} different questions on it well. A question away from the lesson where you learned it shows whether you can use it in a new setting.` };
}

/** Pure. A topic label as stored (970 topic): trimmed, one space, 2 to 120 characters, or null. */
export function cleanTopic(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.replace(/\s+/g, " ").trim();
  return t.length >= 2 && t.length <= 120 ? t : null;
}
