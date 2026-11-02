// ── SCHOLAR-CE-2026 CE-05: STORED SCENARIOS ARE HELD TO TODAY'S RULES ── reads the section a scenario cites, then scenario.ts decides ─────────
//
// A scenario written under an earlier prompt, or one that would fail today's draft checks, must never be OFFERED for a new attempt: not in a new
// session, not in a replayed saved set, not as an unanswered item of a resumed session. It is not deleted: the question, its attempts and their
// snapshots (791) stay, so what the learner answered is still shown as they answered it. Only the offer stops.
//
// The only I/O is the learner's own section (getPassage, owner-keyed), once per section.

import { getPassage, type QuestionRow } from "./store";
import { isScenarioQuestion } from "./formats";
import { storedScenarioProblem } from "./scenario";

type Admin = Parameters<typeof getPassage>[0];

/** The scenarios among `qs` that must not be offered, with the reason (stale_scenario, not_a_scenario, answer_leaked, repeated_stage, uncited_stage). */
export async function staleScenarios(admin: Admin, userId: string, qs: readonly QuestionRow[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const text = new Map<string, Promise<string | null>>();
  for (const q of qs) {
    if (!isScenarioQuestion(q)) continue;
    if (!text.has(q.chunkId)) text.set(q.chunkId, getPassage(admin, userId, q.chunkId).then(p => p?.content ?? null, () => null));
    const problem = storedScenarioProblem(q, await text.get(q.chunkId)!);
    if (problem) out.set(q.id, problem);
  }
  return out;
}

/**
 * The questions that may be OFFERED: everything but a stale scenario. `keep` are ids the learner already answered or holds an answer for in
 * the session being shown: those stay (their attempt is history), whatever their state today.
 */
export async function offerable<T extends QuestionRow>(admin: Admin, userId: string, qs: readonly T[], keep: ReadonlySet<string> = new Set()): Promise<{ questions: T[]; stale: Map<string, string> }> {
  const stale = await staleScenarios(admin, userId, qs.filter(q => !keep.has(q.id)));
  return { questions: qs.filter(q => !stale.has(q.id)), stale };
}
