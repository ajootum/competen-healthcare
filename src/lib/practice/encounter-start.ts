// CPR-FLOW-001 -- the two decisions the in-place patient picker makes before an encounter exists.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// WHY THEY ARE HERE AND NOT IN THE COMPONENT.
//
// Both of these are rules, not rendering, and a rule inside a "use client" component is a rule no
// harness can run. This module imports NOTHING -- the same reason registration-condition.ts and
// encounter-constants.ts import nothing -- so a client file can hold it without dragging next/headers
// into the browser graph.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * The floor under a patient search, and the number the picker prints when it refuses.
 *
 * ⚠ THE SAME REASONING AS operations/users/route.ts: "a lookup that answers the empty string is a
 * directory dump wearing a search box". One character over a patient register is worse than useless --
 * it matches a large part of the practice, on a clinical product, in a real access log. So a query
 * shorter than this is NOT SENT, and the box says so rather than sitting silent while somebody waits
 * for results that were never asked for.
 */
export const MIN_PICKER_QUERY = 2;

/** What the caller could establish about this patient's history here. `count` is meaningless when
 *  `unavailable` -- a failed read counted nought encounters, which is not the same as none. */
export type PriorEncounters = { unavailable: boolean; count: number };

export type PathwayDecision =
  | { ok: true; pathway: "new_walk_in" | "walk_in_followup"; because: string }
  | { ok: false; message: string };

/**
 * FLOW-001 pathways 2 and 4, chosen from the record rather than asked for.
 *
 * ⚠ AND REFUSED WHEN THE RECORD COULD NOT BE READ. entry_pathway is WRITTEN onto the encounter and
 * stays there: filing a returning patient as `new_walk_in` is a clinical claim that this is their
 * first visit, made about somebody with a history, by a screen that simply could not see it. The same
 * refusal already guards the two start actions in the patients workspace (PatientActions.tsx,
 * SummaryPanel.tsx); this is that rule, in one place, where it can be tested.
 */
export function pathwayFor(prior: PriorEncounters): PathwayDecision {
  if (prior.unavailable) {
    return {
      ok: false,
      message: "This patient's history could not be read, so whether this is a first visit or a "
        + "follow-up cannot be determined — and that is recorded on the encounter permanently. "
        + "Nothing was opened. Reload and try again.",
    };
  }
  return prior.count > 0
    ? { ok: true, pathway: "walk_in_followup", because: "this patient has been seen here before" }
    : { ok: true, pathway: "new_walk_in", because: "no earlier encounter is recorded for this patient here" };
}
