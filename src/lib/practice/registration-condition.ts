// CPR-PRM-001 s9 -- THE CONDITION EVALUATOR, AND THE ONE THING THAT MAY IMPORT IT FROM A BROWSER.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// THIS FILE IMPORTS NOTHING, AND THAT IS THE WHOLE REASON IT EXISTS.
//
// `conditionMet` lived in registration-config.ts, which imports `audit` from provisioning (node:crypto)
// and WorkspaceContext from access (next/headers). A "use client" component that reached for the
// evaluator would drag both into the browser bundle -- the failure that killed the Follow-ups board and
// passed tsc, eslint and every harness on the way through.
//
// So the PURE half moved here and registration-config.ts re-exports it. There is still exactly ONE
// evaluator: the server's validateSubmission and the registration form call the same function, from the
// same file. Two implementations of one rule drift, and the one that drifts is the one nobody is
// testing.
//
// ⚠ NOTHING MAY BE IMPORTED INTO THIS FILE. Not a type from access, not a constant from palette. The
// moment it has an import, the next person adds a second one, and the bundle boundary is gone again.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

export type FieldCondition =
  | { when: string; equals: unknown }
  | { when: string; in: unknown[] }
  | { when: string; isPresent: boolean };

/** The shape both the database rows and the form's field list satisfy. */
export type RegistrationFieldLike = {
  field_key: string;
  label?: string | null;
  visible?: boolean | null;
  is_core?: boolean | null;
  condition?: unknown;
};

/**
 * Does this field apply, given what has been filled in so far?
 *
 * ONE FUNCTION, USED BY THE SERVER AND THE FORM. Two evaluators would disagree eventually, and the one
 * that mattered would be the server's -- silently, after somebody had filled the whole form in.
 *
 * AN UNKNOWN CONDITION SHAPE MEANS THE FIELD APPLIES. The alternative is a field that quietly vanishes
 * because somebody wrote a rule the evaluator does not understand, and a vanished field on a
 * registration form is a question nobody was asked.
 */
export function conditionMet(condition: unknown, values: Record<string, unknown>): boolean {
  if (!condition || typeof condition !== "object") return true;
  const c = condition as Record<string, unknown>;
  if (typeof c.when !== "string") return true;

  const actual = values[c.when];
  if ("isPresent" in c) {
    const present = actual !== undefined && actual !== null && actual !== "" &&
      !(Array.isArray(actual) && actual.length === 0);
    return c.isPresent === true ? present : !present;
  }
  if ("in" in c && Array.isArray(c.in)) return c.in.some(v => String(v) === String(actual));
  if ("equals" in c) return String(c.equals) === String(actual);
  return true;
}

const isEmpty = (v: unknown) =>
  v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);

/**
 * Which fields a form should actually draw, and what happens to the answers of the ones it should not.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────────────
 * A HIDDEN FIELD DOES NOT KEEP ITS ANSWER, and that is a correctness decision rather than a tidiness
 * one.
 *
 * Suppose "Insurer" is asked only when "Has insurance" is yes, and "Policy number" only when an insurer
 * has been named. Somebody answers all three, then sets "Has insurance" to no. If the form merely STOPS
 * DRAWING the insurer while keeping its value:
 *
 *   - the value is still in the submitted payload, so the server stores an answer to a question the
 *     form withdrew -- a record that says something nobody was asked;
 *   - worse, validateSubmission evaluates every condition against the values it was SENT. It would see
 *     an insurer name, decide "Policy number" applies, find it empty and REFUSE the registration for a
 *     field that is not on the screen. The desk gets an error it cannot act on.
 *
 * Clearing is therefore what makes the form and the server agree. The cost is real and is the smaller
 * one: an answer typed, withdrawn and re-asked has to be typed again, blank rather than quietly
 * pre-filled -- which is the honest state for a question that was taken away and put back.
 * ────────────────────────────────────────────────────────────────────────────────────────────────────
 *
 * `values` is the whole form keyed by field_key -- core answers and custom ones together, because a
 * condition may name either.
 *
 * ⚠ ONLY A NON-CORE ANSWER IS CLEARED. The core controls (name, date of birth, phone) are drawn
 * unconditionally by the form itself; deleting one of those from the values map would hide an answer
 * that is still on screen, which is the same lie in the other direction.
 */
export function resolveApplicable<F extends RegistrationFieldLike>(
  fields: F[],
  values: Record<string, unknown>,
): { applicable: F[]; values: Record<string, unknown>; cleared: F[] } {
  const shown = (fields ?? []).filter(f => f.visible !== false);

  // A FIXPOINT, BECAUSE CLEARING ONE ANSWER CAN WITHDRAW THE NEXT FIELD ALONG. Each pass only ever
  // DELETES keys, so the map shrinks monotonically and the walk cannot run longer than there are
  // fields -- the cap is belt to that braces, for the same reason validateTemplate carries one: a
  // renderer that loops takes the tab with it, and a cycle of conditions is a template somebody can
  // author.
  const current: Record<string, unknown> = { ...values };
  for (let pass = 0; pass <= shown.length; pass++) {
    let changed = false;
    for (const f of shown) {
      if (f.is_core === true) continue;
      if (conditionMet(f.condition, current)) continue;
      if (!(f.field_key in current) || isEmpty(current[f.field_key])) continue;
      delete current[f.field_key];
      changed = true;
    }
    if (!changed) break;
  }

  const applicable = shown.filter(f => conditionMet(f.condition, current));
  // WHAT WAS ACTUALLY THROWN AWAY, not merely what is no longer drawn. A conditional field nobody ever
  // answered has nothing to report, and telling somebody their answer was cleared when they never gave
  // one is a false sentence on a screen.
  const cleared = shown.filter(f =>
    !isEmpty(values[f.field_key]) && isEmpty(current[f.field_key]));

  return { applicable, values: current, cleared };
}

/**
 * The sentence a form says when it throws an answer away.
 *
 * Here rather than in the component so it can be asserted. A screen that silently deletes something
 * somebody typed is the failure this whole change is about; saying nothing at all would half-fix it.
 */
export function clearedNotice(labels: string[]): string | null {
  const named = labels.filter(l => l && l.trim()).map(l => l.trim());
  if (named.length === 0) return null;
  return named.length === 1
    ? `${named[0]} no longer applies, so what was typed there has been cleared.`
    : `${named.slice(0, -1).join(", ")} and ${named[named.length - 1]} no longer apply, so what was typed there has been cleared.`;
}
