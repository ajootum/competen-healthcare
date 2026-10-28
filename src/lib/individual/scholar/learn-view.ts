// ── STAGE 3: LEARN -- WHAT THE WORKSPACE IS SENT ── COMPETEN-SCHOLAR-LEARN-01 ──────────────────────────────
//
// One shape for a learning session, whether it is recorded (414, history on) or held only in the browser (history
// off, or 414 absent). Built from the store and the plan; nothing here calls a model.

import { citeChunk } from "./extract";
import type { IndividualPolicy } from "../policy";
import { LEARN_ACTIONS, SUPPLEMENTARY_LABEL, WITHHELD_NEAREST_MAX, WITHHELD_WHY, type LearnAction } from "./config";
import type { SupplementaryCheck } from "./generation";
import { stepTitle } from "./learn";
import { displayTitle } from "./learn-search";
import type { LearningStep } from "./store";

export type SessionView = {
  id: string | null;
  recorded: boolean;
  title: string;
  scopeKind: string;
  currentStep: number;
  status: "active" | "completed";
  coverage: { sections: number; of: number } | null;
  steps: { step: number; title: string; sections: { chunkId: string; materialId: string; materialTitle: string; citation: string }[] }[];
};

export function sessionView(input: {
  id: string | null; recorded: boolean; title: string; scopeKind: string; currentStep: number; status: "active" | "completed";
  coverage: { sections: number; of: number } | null; steps: LearningStep[]; topics: ReadonlyMap<string, readonly string[]>;
}): SessionView {
  return {
    id: input.id, recorded: input.recorded, title: input.title, scopeKind: input.scopeKind, currentStep: input.currentStep, status: input.status, coverage: input.coverage,
    steps: input.steps.map(s => ({
      step: s.step, title: stepTitle(s, input.topics),
      // SCH-LEARN-UX-01: a file-like material title is shown as a title here; the act route cites the passages as stored.
      sections: s.sections.map(x => ({ chunkId: x.chunkId, materialId: x.materialId, materialTitle: displayTitle(x.materialTitle), citation: `${displayTitle(x.materialTitle)}, ${citeChunk(x, x.unit)}` })),
    })),
  };
}

export type WithheldReason = keyof typeof WITHHELD_WHY;
type SourceRef = { tag: string; chunkId: string; materialId: string; citation: string };
export type WithheldNext = { why: string; notInNotes: boolean; nearest: SourceRef[]; rephrase: boolean; background: { text: string; label: string } | null };

/**
 * Pure. Stage 3 acceptance item 4: what a student is told when an answer is withheld as unsupported. Why, plainly;
 * "this isn't in your notes" when it is not; the sections of their notes nearest the question (the passages, nearest
 * first -- Ask's are ranked by the search); a rephrase where Ask is offered; and the labelled background only where
 * policy allows it and it passed its own checks. Never the withheld text, and nothing else from the model.
 */
export function withheldNext(input: {
  reason: WithheldReason; detail: string | null; sources: readonly SourceRef[]; askOffered: boolean;
  background: SupplementaryCheck | null; backgroundAllowed: boolean;
}): WithheldNext {
  const b = input.background;
  return {
    why: WITHHELD_WHY[input.reason] + (input.detail ? ` (${input.detail})` : ""),
    notInNotes: input.reason === "not_in_notes",
    nearest: input.sources.slice(0, WITHHELD_NEAREST_MAX).map(s => ({ tag: s.tag, chunkId: s.chunkId, materialId: s.materialId, citation: s.citation })),
    rephrase: input.askOffered,
    background: input.backgroundAllowed && b?.ok ? { text: b.text, label: SUPPLEMENTARY_LABEL } : null,
  };
}

/** The actions this student is offered (the policy's, in Scholar's order) and the one a session starts with. */
export function offeredActions(policy: Pick<IndividualPolicy, "scholarLearningActions" | "scholarDefaultAction">, preferred?: string | null): { actions: LearnAction[]; start: LearnAction } {
  const actions = LEARN_ACTIONS.filter(a => policy.scholarLearningActions.includes(a));
  const wanted = (preferred && actions.includes(preferred as LearnAction) ? preferred : policy.scholarDefaultAction) as LearnAction;
  return { actions, start: actions.includes(wanted) ? wanted : actions[0] ?? "explain" };
}
