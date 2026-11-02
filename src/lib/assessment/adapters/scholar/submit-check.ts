import { itemProgress, orderedItems, type InstrumentDef, type Responses, type Treatment } from "../../core";

// ── BEFORE SUBMIT ── Checklist Studio S3 ─────────────────────────────────────────────────────────────────────────────
//
// Pure. The items a learner has not answered, so Submit can list the mandatory ones and ask for confirmation. The server asks the
// same question (the browser's list is never trusted): a submit that leaves a mandatory item unanswered needs `confirmUnanswered`.
// An unanswered mandatory item is recorded as incomplete by the engine and the database backstop, never filled in or scored as zero.

/** `unable_to_judge`: the learner deliberately said so. The scoring rules still treat a required criterion like that as not answered, so it is listed, in its own words. */
export type UnansweredItem = { itemKey: string; code: string; prompt: string; mandatory: boolean; critical: boolean; why: "not_answered" | "unable_to_judge" };

export function unansweredItems(def: InstrumentDef, responses: Responses, defaults?: Treatment): UnansweredItem[] {
  const out: UnansweredItem[] = [];
  for (const item of orderedItems(def)) {
    const p = itemProgress(item, responses, undefined, defaults);
    if (!p.primary.answered) out.push({ itemKey: item.stable_key, code: item.code, prompt: item.prompt, mandatory: item.mandatory || item.critical, critical: item.critical, why: p.unassessed ? "not_answered" : "unable_to_judge" });
  }
  return out;
}

export const unansweredMandatory = (list: readonly UnansweredItem[]): UnansweredItem[] => list.filter(i => i.mandatory);

/**
 * What happens to the evidence-supported stage after a Scholar submit: nothing, always. A self-reported instance is not evidence for
 * a stage (the database refuses it as evidence, and the progression filter admits assessor_evaluated only), so no progression decision
 * is recorded for it. Written as a function so the report can say it and a test can pin it.
 */
export function progressionAfterSubmit(attestation: string): { recorded: false; reason: string } | { recorded: "eligible" } {
  return attestation === "assessor_evaluated"
    ? { recorded: "eligible" }
    : { recorded: false, reason: "A self-reported assessment never advances the evidence-supported stage." };
}
