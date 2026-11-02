import { latestPerRef, type PlanEvent } from "../learning-plan/types";
import type { StudyPlanResult } from "./study-plan";

// ── ROUTINE CARRY-OVER, WITH UNDO ── PLP-01..04 (owner GO 2 Nov 2026), addendum 2 ────────────────────────────────────
//
// Pure. The plan is recomputed every day, so an activity that was planned for yesterday and is still needed today simply appears in today's
// plan: that is the routine change ("missed activities reappear within the agreed time"). When that happens ONCE Scholar says so, records
// ONE auto_adjust event (ref = the activity ref and the day it was planned, value {from, to, reason}), and offers an UNDO. Undone, the
// activity is not carried: it is left out of today's plan and shown as "Missed - not rescheduled", with a Reschedule action that uses the
// existing calendar move. Without migration 840 nothing is recorded and no notice is shown: the plan just recomputes as before.
//
// "Unfinished" here means: planned for yesterday, and the same activity is still in today's plan (the records still call for it).
// Due-card review, mixed practice and the practice evaluation come back every day by design and are never carry-overs.

const NEVER = new Set(["revise:due", "revise:mixed", "evaluate:eval"]);
export const carryKey = (ref: string, from: string) => `${ref}@${from}`;

export type CarryNote = {
  /** The auto_adjust event ref: `${activityRef}@${from}`. Also the undo token. */
  key: string; ref: string; title: string; from: string; to: string; reason: string;
  /** An applied event is already on record for this carry-over (so it is not written again). */
  recorded: boolean;
};
export type MissedItem = { key: string; ref: string; title: string; from: string; reason: string };
export type CarryResult = { carried: CarryNote[]; missed: MissedItem[]; /** Activity refs to leave out of today's plan (the learner took the carry-over back). */ excludeRefs: string[] };

/**
 * Pure. `past` is the plan as it stood for yesterday (built for yesterday from the same inputs), `current` today's plan before any
 * exclusion, `events` the learner's auto_adjust events.
 */
export function detectCarryOvers(o: { past: StudyPlanResult | null; current: StudyPlanResult; yesterday: string; events: readonly PlanEvent[] }): CarryResult {
  const latest = latestPerRef(o.events.filter(e => e.kind === "auto_adjust"));
  const day = o.past?.thisWeek.find(d => d.day === o.yesterday);
  const carried: CarryNote[] = [], missed: MissedItem[] = [], exclude: string[] = [];
  for (const a of day?.activities ?? []) {
    if (NEVER.has(a.ref)) continue;
    const to = o.current.thisWeek.find(d => d.activities.some(x => x.ref === a.ref));
    if (!to) continue;
    const key = carryKey(a.ref, o.yesterday);
    const status = latest.get(key)?.status ?? null;
    if (status === "undone") {
      missed.push({ key, ref: a.ref, title: a.title, from: o.yesterday, reason: "You took this move back, so it has not been rescheduled." });
      exclude.push(a.ref);
    } else {
      carried.push({
        key, ref: a.ref, title: a.title, from: o.yesterday, to: to.day, recorded: status === "applied",
        reason: `You did not finish "${a.title}" on ${o.yesterday}, so it is in your plan for ${to.day}.`,
      });
    }
  }
  return { carried, missed, excludeRefs: [...new Set(exclude)] };
}
