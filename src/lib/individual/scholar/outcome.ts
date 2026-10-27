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

/** A redirect before any call was made (sufficiency or an identical retry): an outcome with no cost and no attempts. */
export const noCalls = (actionId: string): RunnerTrace => ({ actionId, calls: () => ({}) });
