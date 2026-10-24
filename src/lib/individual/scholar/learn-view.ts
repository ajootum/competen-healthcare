// ── STAGE 3: LEARN -- WHAT THE WORKSPACE IS SENT ── COMPETEN-SCHOLAR-LEARN-01 ──────────────────────────────
//
// One shape for a learning session, whether it is recorded (414, history on) or held only in the browser (history
// off, or 414 absent). Built from the store and the plan; nothing here calls a model.

import { citeChunk } from "./extract";
import type { IndividualPolicy } from "../policy";
import { LEARN_ACTIONS, type LearnAction } from "./config";
import { stepTitle } from "./learn";
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
      sections: s.sections.map(x => ({ chunkId: x.chunkId, materialId: x.materialId, materialTitle: x.materialTitle, citation: `${x.materialTitle}, ${citeChunk(x, x.unit)}` })),
    })),
  };
}

/** The actions this student is offered (the policy's, in Scholar's order) and the one a session starts with. */
export function offeredActions(policy: Pick<IndividualPolicy, "scholarLearningActions" | "scholarDefaultAction">, preferred?: string | null): { actions: LearnAction[]; start: LearnAction } {
  const actions = LEARN_ACTIONS.filter(a => policy.scholarLearningActions.includes(a));
  const wanted = (preferred && actions.includes(preferred as LearnAction) ? preferred : policy.scholarDefaultAction) as LearnAction;
  return { actions, start: actions.includes(wanted) ? wanted : actions[0] ?? "explain" };
}
