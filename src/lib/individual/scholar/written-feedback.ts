import { findPatientIdentifiers } from "./extract";
import { feedbackPartsFrom, feedbackText, type FeedbackParts } from "./question-intel";
import type { PartResult } from "./revision";

// ── FORMATIVE AI FEEDBACK ON A WRITTEN ANSWER, KEPT WITH THE ANSWER ── SCHOLAR-WRITTEN-FEEDBACK-01 ─────────────────
//
// Pure. Where a short or structured answer is marked by AI evaluation (416 marking = 'ai_evaluation'), the feedback the
// learner was shown is kept on that attempt's own `response` (416 jsonb: an object of at most 8000 bytes, owner-read
// only, erased with the question, the material or the person). No new table or column: the attempt already says HOW it
// was marked and by which model and prompt version; this is what that evaluator said, under `response.formative`.
//
// ⚠ FORMATIVE ONLY (D5). kind is always "ai_formative". It is kept, and read back, only on an ai_evaluation attempt:
//   a self-graded or code-marked answer never carries it (formativeOf answers null), so self-assessment and AI feedback
//   stay apart. Nothing that makes an evaluation, a verification or a Passport entry reads `response`.
// ⚠ BOUNDED. Each item is the five feedback parts (question-intel.ts feedbackPartsFrom bounds) or, where the evaluator
//   wrote free text, that text cut to SUMMARY_MAX. The whole response is held under RESPONSE_BUDGET bytes: items are
//   dropped from the end until it fits, and the answer is always kept even when no feedback fits.
// ⚠ SCREENED. The evaluator's output was already screened (generation.ts parseEvaluation); an item carrying a
//   patient-identifier shape is dropped again here, as every stored AI text is.

export const FORMATIVE_KIND = "ai_formative" as const;
/** Free-text feedback (no five parts) is kept to this many characters. */
export const SUMMARY_MAX = 800;
/** The stored response, feedback included, is kept under this many bytes of JSON (416 allows 8000; jsonb adds spaces). */
export const RESPONSE_BUDGET = 7000;
/** A structured question has at most this many parts (generation.ts REVISION_SYSTEM.structured: two to four). */
const MAX_ITEMS = 6;

/** One evaluated answer (part null) or one evaluated part (1-based). Either the five parts or a summary. */
export type FormativeItem = { part: number | null; parts: FeedbackParts | null; summary: string | null };
export type FormativeFeedback = { kind: typeof FORMATIVE_KIND; model: string; promptVersion: string; items: FormativeItem[] };

const bytes = (v: unknown) => new TextEncoder().encode(JSON.stringify(v)).length;
const screened = (p: FeedbackParts | null, s: string | null) => !findPatientIdentifiers([p ? feedbackText(p) : "", s ?? ""].join("\n")).length;

function item(raw: unknown): FormativeItem | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const part = r.part === null || r.part === undefined ? null : Number.isInteger(r.part) && (r.part as number) >= 1 && (r.part as number) <= MAX_ITEMS ? (r.part as number) : undefined;
  if (part === undefined) return null;
  const parts = feedbackPartsFrom(r.parts);
  const summary = parts ? null : typeof r.summary === "string" && r.summary.trim() ? r.summary.trim().slice(0, SUMMARY_MAX) : null;
  if (!parts && !summary) return null;
  return screened(parts, summary) ? { part, parts, summary } : null;
}

/**
 * Pure. The formative record of what an evaluator said, or null when nothing worth keeping is left. `items` are the
 * evaluator's outputs as the answer route holds them: { part, feedback, parts }.
 */
export function formativeFeedback(items: readonly { part: number | null; feedback: string | null; parts?: FeedbackParts | null }[], evaluator: { model: string; promptVersion: string } | null): FormativeFeedback | null {
  if (!evaluator?.model || !evaluator.promptVersion) return null;
  const kept = items.slice(0, MAX_ITEMS).map(i => item({ part: i.part, parts: i.parts ?? null, summary: i.feedback })).filter((x): x is FormativeItem => !!x);
  return kept.length ? { kind: FORMATIVE_KIND, model: evaluator.model.slice(0, 200), promptVersion: evaluator.promptVersion.slice(0, 200), items: kept } : null;
}

/** Pure. The response to store: the answer, plus the feedback where it fits the budget (items dropped from the end). */
export function withFormative(response: Record<string, unknown> | null, fb: FormativeFeedback | null): Record<string, unknown> | null {
  if (!response || !fb) return response;
  for (let n = fb.items.length; n > 0; n--) {
    const next = { ...response, formative: { ...fb, items: fb.items.slice(0, n) } };
    if (bytes(next) <= RESPONSE_BUDGET) return next;
  }
  return response;
}

/**
 * Pure. The formative feedback kept on an attempt, read back and re-checked, or null. Only an ai_evaluation attempt
 * has any: on a self-graded or code-marked one whatever is stored is ignored.
 */
export function formativeOf(response: unknown, marking: string | null | undefined): FormativeFeedback | null {
  if (marking !== "ai_evaluation" || !response || typeof response !== "object") return null;
  const f = (response as Record<string, unknown>).formative as Record<string, unknown> | undefined;
  if (!f || typeof f !== "object" || f.kind !== FORMATIVE_KIND || typeof f.model !== "string" || typeof f.promptVersion !== "string" || !Array.isArray(f.items)) return null;
  const items = f.items.slice(0, MAX_ITEMS).map(item).filter((x): x is FormativeItem => !!x);
  return items.length ? { kind: FORMATIVE_KIND, model: f.model.slice(0, 200), promptVersion: f.promptVersion.slice(0, 200), items } : null;
}

/** Pure. The readable text of one item (the five parts as text, or the summary). */
export const formativeText = (i: FormativeItem): string => (i.parts ? feedbackText(i.parts) : i.summary ?? "");

/**
 * Pure. A structured answer's part results, rebuilt from what its ai_evaluation attempt kept: the marks awarded and,
 * for each part the evaluator judged, its feedback. null where the attempt was not AI-evaluated or kept no marks.
 */
export function storedPartResults(response: unknown, marking: string | null | undefined, partCount: number): PartResult[] | null {
  if (marking !== "ai_evaluation" || !response || typeof response !== "object" || partCount < 1) return null;
  const r = response as Record<string, unknown>;
  const awarded = Array.isArray(r.awarded) ? r.awarded : null;
  const by = Array.isArray(r.by) ? r.by : null;
  if (!awarded || awarded.length !== partCount || !awarded.every(a => Number.isInteger(a) && (a as number) >= 0)) return null;
  // How each part was marked is kept with the marks (answer route). Without it (an older attempt) nothing is guessed.
  if (!by || by.length !== partCount || !by.every(b => b === "blank" || b === "code" || b === "ai")) return null;
  const f = formativeOf(response, marking);
  const byPart = new Map((f?.items ?? []).filter(i => i.part !== null).map(i => [i.part as number, i]));
  return awarded.map((a, i) => {
    const how = by[i] as "blank" | "code" | "ai";
    if (how !== "ai") return { awarded: a as number, by: how };
    const fi = byPart.get(i + 1);
    return { awarded: a as number, by: "ai" as const, feedback: fi ? formativeText(fi) : null, parts: fi?.parts ?? null };
  });
}
