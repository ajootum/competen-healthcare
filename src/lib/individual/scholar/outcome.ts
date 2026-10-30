// ── SCHOLAR'S SIDE OF THE AI OUTCOME RECORD ── COMPETEN-SCHOLAR-AI-OPT-01 (Wave 1) ──────────────────────────────
//
// One plat_ai_outcomes row per student action, written by the route after the action's checks have decided what is
// kept (src/lib/ai/outcomes.ts). The attempts come from the runner's own count of the calls it made, by part
// ("main"/"retry" write, "verify"/"retry-verify" check), so they are what was actually sent, not what was planned.
// Codes and counts only: never the question, the notes or what was written.

import { recordAiOutcome, type AiOutcome, type AiOutputKind, type Sufficiency } from "@/lib/ai/outcomes";
export type RunnerTrace = { actionId: string; calls: () => Record<string, number> };

/** Pure. Write and check attempts from the runner's per-part call counts. */
export function attemptsOf(calls: Record<string, number>): { generation: number; verify: number } {
  let generation = 0, verify = 0;
  for (const [part, n] of Object.entries(calls)) {
    if (/verify$/.test(part)) verify += n; else generation += n;
  }
  return { generation, verify };
}

export async function recordScholarOutcome(admin: unknown, ai: RunnerTrace, e: {
  operation: string; outputKind: AiOutputKind; outcome: AiOutcome; accepted?: number; rejected?: number; reasons?: readonly string[];
  sufficiency?: Sufficiency; promptVersion?: string | null; configVersion?: string | null; materialKey?: string | null;
}): Promise<void> {
  const a = attemptsOf(ai.calls());
  await recordAiOutcome(admin, {
    actionId: ai.actionId, product: "scholar", activity: e.operation.replace(/^individual_scholar_/, ""), operation: e.operation,
    outputKind: e.outputKind, outcome: e.outcome, accepted: e.accepted, rejected: e.rejected, reasons: e.reasons,
    sufficiency: e.sufficiency, generationAttempts: a.generation, verifyAttempts: a.verify,
    promptVersion: e.promptVersion, configVersion: e.configVersion, materialKey: e.materialKey,
  });
}

/**
 * SCHOLAR-SQIE-02: a safe withhold is tracked apart from an answer, by reason CODE, never the request text. 600's CHECK
 * has no "withheld" or "answered" outcome, so neither is invented: a withhold is outcome "rejected" with the codes
 * "withheld" and "withheld_<reason>", an answer is "accepted" with the code "answered".
 */
export function answerOutcome(withheldReason: string | null): { outcome: AiOutcome; reasons: string[] } {
  return withheldReason
    ? { outcome: "rejected", reasons: ["withheld", `withheld_${withheldReason.replace(/[^a-z0-9_]/gi, "_").slice(0, 40)}`] }
    : { outcome: "accepted", reasons: ["answered"] };
}

/** SCHOLAR-SQIE-02: the typed result a path returns when it withholds, so the student's question and attempt are kept. */
export type Withheld = { reason: string };

/** A redirect before any call was made (sufficiency or an identical retry): an outcome with no cost and no attempts. */
export const noCalls = (actionId: string): RunnerTrace => ({ actionId, calls: () => ({}) });
