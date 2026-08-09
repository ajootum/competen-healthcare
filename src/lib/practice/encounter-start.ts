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
 * first visit, made about somebody with a history, by a screen that simply could not see it.
 *
 * ⚠ THIS COMMENT USED TO SAY THE SAME REFUSAL ALREADY GUARDED THE TWO START ACTIONS IN THE PATIENTS
 * WORKSPACE. It guarded one of them. SummaryPanel.tsx computed `!unavailable && rows.length > 0` and
 * launched on the result, so an unreadable history opened a `new_walk_in` -- silently, on somebody who
 * may have been coming here for years. Every start action now goes through startEncounterFor() below,
 * which is the only caller of this function outside the harness.
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

export type LaunchOutcome =
  | { ok: true; encounterId: string; pathway: "new_walk_in" | "walk_in_followup"; resumed: boolean }
  | { ok: false; message: string };

/**
 * OPENING A CONSULTATION FOR A PATIENT WHO IS ALREADY KNOWN -- the whole act, once.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS A FUNCTION AND NOT FOUR COPIES OF ITSELF.
 *
 * Four screens start an encounter for a patient they can already name: the picker on the encounters
 * board, the patient's own action panel, the register's summary panel, and the longitudinal record. The
 * first three each carried their own version of the two reads below, and they had already drifted --
 * SummaryPanel computed `hasPrior = !unavailable && rows.length > 0`, which files an UNREADABLE history
 * as a first visit. That is precisely the claim pathwayFor exists to refuse, and the refusal was written
 * in two of the three places. The comment at the top of this file asserted all three were guarded; it
 * was describing an intention.
 *
 * A rule copied into a component is a rule no harness can run, and a rule in four components is three
 * chances to get `entry_pathway` wrong on a record that keeps it forever. So: one function, in the module
 * that already holds the decision, over the global fetch and nothing else.
 *
 * TWO READS, IN THIS ORDER, AND THE FIRST ONE CAN REFUSE THE SECOND. Nothing is created until the visit
 * type is established from the record, because it is written onto the encounter and never revised.
 *
 * IT DOES NOT NAVIGATE. It returns the encounter it reached and the caller decides what that means --
 * which is what makes every branch below reachable from a harness.
 */
export async function startEncounterFor(patientId: string): Promise<LaunchOutcome> {
  let prior: PriorEncounters;
  try {
    const r = await fetch(`/api/v1/practice/encounters?status=all&patientId=${encodeURIComponent(patientId)}`);
    if (!r.ok) {
      return {
        ok: false,
        message: `This patient's history could not be read (HTTP ${r.status}), so the visit type cannot be `
          + "determined and nothing was opened.",
      };
    }
    const d = await r.json();
    // ⚠ THE FIELD, NOT THE LENGTH OF THE LIST. The route reports a refused read as `unavailable: true`
    // alongside an empty `encounters` -- and an empty list is what "never been seen here" looks like too.
    prior = { unavailable: d?.unavailable === true, count: Array.isArray(d?.encounters) ? d.encounters.length : 0 };
  } catch (e) {
    return {
      ok: false,
      message: `The patient's history did not reach the server: ${e instanceof Error ? e.message : String(e)}. Nothing was opened.`,
    };
  }

  const decided = pathwayFor(prior);
  if (!decided.ok) return { ok: false, message: decided.message };

  try {
    const res = await fetch("/api/v1/practice/encounters", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ patientId, pathway: decided.pathway }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data?.encounter?.id) {
      // ⚠ THE SERVER'S OWN WORDS. "That did not work" over a refused launch sends somebody to press it
      // again; "this patient record is not active (archived or merged)" sends them to the record.
      return {
        ok: false,
        message: `The consultation did not open: ${data?.error?.message ?? data?.error ?? `HTTP ${res.status}`}. Nothing was created.`,
      };
    }
    return {
      ok: true,
      encounterId: String(data.encounter.id),
      pathway: decided.pathway,
      resumed: data.encounter.resumed === true,
    };
  } catch (e) {
    return {
      ok: false,
      message: `The consultation did not open: ${e instanceof Error ? e.message : String(e)}. Nothing was created.`,
    };
  }
}
