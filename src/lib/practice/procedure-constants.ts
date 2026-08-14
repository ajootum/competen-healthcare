// CPR-150's vocabularies, in a module with NO server imports so the procedure form derives its options
// from the same source the engine enforces.
//
// ⚠ THIS FILE USED TO SAY "THERE IS NO PLANNED HERE", and that position is now superseded. Migration
// 197 argued that a procedure record means something happened to a person, so a plan never carried out
// was the treatment row and nothing else. CPR-TRT-PROC-003 s9 disagrees deliberately: "Plan for suturing
// later" is a procedure with a lifecycle, not a treatment plan, because the object being tracked has a
// status somebody has to move. The owner ruled the newer specification the source of truth, and
// migration 294 widened the constraint to match.
//
// The distinction 197 was protecting still holds and is now carried by the WORDS rather than by absence:
// ORDERED and SCHEDULED are states of a procedure, whereas "wound dressing daily for five days" remains
// a treatment plan. s9 draws that line by what the practitioner is recording, not by the name of the act.
//
// ⚠ ABANDONED IS NOT OFFERED HERE ANY MORE, and migration 294 still ACCEPTS it. It and ATTEMPTED are the
// same clinical fact under two names. The database keeps the old value so that applying 294 before this
// code shipped could not break procedure recording mid-consultation; this list is the narrowing half.
// Nothing writes ABANDONED once this is deployed, and a later migration can drop it.

export const PROCEDURE_STATUSES = [
  ["ORDERED", "Ordered"],
  ["SCHEDULED", "Scheduled"],
  ["PERFORMED", "Performed"],
  ["ATTEMPTED", "Attempted, not completed"],
  ["CANCELLED", "Cancelled"],
  ["DECLINED", "Declined by the patient"],
] as const;

/** The statuses that mean the procedure has NOT happened, so nothing may claim a performance time. */
export const PROCEDURE_STATUSES_NOT_DONE = ["ORDERED", "SCHEDULED", "CANCELLED", "DECLINED"] as const;

/**
 * The left-edge band on a recorded procedure row: DID THIS HAPPEN, at a glance.
 *
 * ⚠ THE SAME GRAMMAR AS diagnosisBand, ON A DIFFERENT QUESTION. There, weight is how settled a finding
 * is. Here it is how far along the act got. One hue at three weights either way, so a reader learns the
 * scheme once and it means something on every tab -- and the alert palette stays free for real alerts.
 *
 * ⚠ CANCELLED AND DECLINED LEAVE THE RAMP ENTIRELY, like ruled_out on a diagnosis. They are not faint
 * versions of "performed" -- they are the statement that it did NOT happen and is not going to. In a
 * list of things done to a patient that is the one row that must not be skim-read as done.
 *
 * ⚠ AN UNRECOGNISED STATUS FALLS TO THE WEAKEST BAND, NEVER PERFORMED. The engine had exactly this bug
 * until migration 294's follow-up: an unknown status silently became PERFORMED, so the record asserted
 * a procedure was carried out on a patient because a string failed to match. The same rule holds for
 * the colour -- the failure lands on the side that claims LESS.
 */
export function procedureBand(status: string): { edge: string; dashed: boolean; struck: boolean } {
  switch (status) {
    case "PERFORMED":
      return { edge: "var(--cp-primary)", dashed: false, struck: false };
    case "ATTEMPTED":
    case "ABANDONED":
      return { edge: "color-mix(in srgb, var(--cp-primary) 55%, transparent)", dashed: false, struck: false };
    case "SCHEDULED":
      return { edge: "color-mix(in srgb, var(--cp-primary) 40%, transparent)", dashed: false, struck: false };
    case "CANCELLED":
    case "DECLINED":
      return { edge: "var(--cmp-text-neutral)", dashed: true, struck: true };
    case "ORDERED":
    default:
      return { edge: "color-mix(in srgb, var(--cp-primary) 26%, transparent)", dashed: false, struck: false };
  }
}

/**
 * The statuses that require the practitioner to say why in their own words.
 *
 * ⚠ ATTEMPTED INHERITS THIS FROM ABANDONED. "Started and did not finish" is the one outcome a reader
 * cannot interpret without a reason, and it was already required before the rename. CANCELLED and
 * DECLINED are added because "this did not happen" is a clinical fact whose value is entirely in why.
 */
export const PROCEDURE_STATUSES_NEEDING_REASON = ["ATTEMPTED", "CANCELLED", "DECLINED"] as const;

export const PROCEDURE_CATEGORIES = [
  ["minor_surgery", "Minor surgery"],
  ["injection", "Injection"],
  ["wound_care", "Wound care"],
  ["diagnostic", "Diagnostic"],
  ["obstetric", "Obstetric"],
  ["dental", "Dental"],
  ["dressing", "Dressing"],
  ["physical", "Physical therapy"],
  ["other", "Other"],
] as const;

/**
 * The sides. `not_applicable` is offered because most procedures have none -- and it is REFUSED on a
 * catalogue entry marked sided, because it is exactly the value somebody picks to get past a required
 * field. See follow-ups in 197's header: wrong-site is the canonical never-event.
 */
export const LATERALITIES = [
  ["not_applicable", "Not sided"],
  ["left", "Left"],
  ["right", "Right"],
  ["bilateral", "Bilateral"],
] as const;

export const SIDED_LATERALITIES = ["left", "right", "bilateral"];

/**
 * CONSENT NEVER DEFAULTS TO OBTAINED. `not_recorded` is first because it is the honest state of a form
 * nobody has filled in, and the engine refuses it where the catalogue says consent is required.
 */
export const CONSENT_STATUSES = [
  ["not_recorded", "Not recorded"],
  ["obtained", "Obtained"],
  ["not_required", "Not required"],
  ["refused", "Refused"],
] as const;

export const OUTCOME_TYPES = [
  ["healing", "Healing as expected"],
  ["complication", "Complication"],
  ["failure", "Did not achieve its purpose"],
  ["resolution", "Resolved"],
  ["note", "Note"],
] as const;

export const OUTCOME_SEVERITIES = ["mild", "moderate", "severe"] as const;

/** Severity belongs to a complication and to nothing else -- the engine enforces both directions. */
export const SEVERITY_REQUIRED_FOR = ["complication"];

// ════════════════════════════════════════════════════════════════════════════════════════════════════
// CPR-PROC-HFE-005 s3/s9/s10: FIELD APPLICABILITY, DRIVEN BY THE PROCEDURE DEFINITION.
//
// ⚠ THE CATALOGUE WAS ALREADY THERE AND THE SCREEN NEVER ASKED IT. page.tsx loaded the procedure types,
// passed them to EncounterConsole, and EncounterConsole declared the prop and used it nowhere. So the
// Procedures tab was a free-text box that never sent `procedure_type_id` -- which meant the two safety
// checks in procedures.ts (a SIDED type cannot be recorded without a side, a CONSENT_REQUIRED type
// cannot be recorded as "not recorded") could NEVER FIRE from the encounter screen, because `type` was
// always null. A practice could mark Joint injection sided and consent-required and this screen would
// still record it with neither. That is what this section closes.
//
// ⚠ AND THE CATALOGUE ONLY KNOWS TWO THINGS. s20 asks for tri-state applicability on site, laterality
// and consent, an allowed-laterality list, per-procedure status lists and a detail-field schema.
// `practice_procedure_type` has `sided boolean` and `consent_required boolean` and nothing else, so
// everything below is derived from those two plus one honest third state: NOTHING WAS CHOSEN FROM THE
// CATALOGUE. Free text tells us nothing about the procedure, so a free-text item cannot claim a field is
// inapplicable -- it offers the field quietly instead of hiding it. Widening this properly is the
// migration half of the specification.
// ════════════════════════════════════════════════════════════════════════════════════════════════════

/**
 * What the catalogue can say about a procedure, after migration 297.
 *
 * ⚠ THE TWO BOOLEANS SURVIVE ALONGSIDE THE TRI-STATES, DELIBERATELY. `sided` is the wrong-site control
 * and the oldest rule in the procedure engine. 297 added `laterality_rule` because s20 needs a third
 * state a boolean cannot express, and backfilled the two consistently -- but an editor, an import or a
 * hand-run UPDATE can put them out of step, and only one direction of that is survivable. Every check
 * below reads them as an OR, so a stale boolean can only ever ADD a refusal.
 */
export type ProcedureTypeShape = {
  id: string;
  name: string;
  sided?: boolean;
  consent_required?: boolean;
  site_rule?: string | null;
  laterality_rule?: string | null;
  consent_rule?: string | null;
  allowed_lateralities?: string[] | null;
  allowed_statuses?: string[] | null;
  default_status?: string | null;
  outcome_required?: boolean;
  detail_fields?: unknown;
} | null;

/**
 * s8/s20's procedure-specific detail field.
 *
 * ⚠ A SMALL CLOSED VOCABULARY, NOT A FORM BUILDER. Three kinds, and `choice` must carry its options. A
 * clinical field with no declared kind cannot be validated, and an unvalidatable clinical field is a
 * free-text column with extra steps -- migration 297's header says the same thing about the column.
 */
export type ProcedureDetailField = {
  key: string; label: string; kind: "text" | "number" | "choice"; required: boolean; options: string[];
};

const DETAIL_KINDS = ["text", "number", "choice"];

/**
 * Read `detail_fields` off a catalogue row.
 *
 * ⚠ TOLERANT ON PURPOSE, AND SILENT ONLY ABOUT MALFORMED DEFINITIONS. jsonb is not a schema: the column
 * check guarantees an array and nothing about what is in it. An entry with no key, no label or an
 * unknown kind is DROPPED rather than rendered, because a field the screen cannot validate is a field
 * the server cannot either -- and half-drawing it would collect an answer nothing would check. A
 * `choice` with no options is dropped for the same reason: it is a select with nothing to select.
 */
export function parseDetailFields(raw: unknown): ProcedureDetailField[] {
  if (!Array.isArray(raw)) return [];
  const out: ProcedureDetailField[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    const key = String(e.key ?? "").trim();
    const label = String(e.label ?? "").trim();
    const kind = String(e.kind ?? "text").trim();
    if (!key || !label || !DETAIL_KINDS.includes(kind)) continue;
    // A duplicate key would write two rows against one unique index, so the second is dropped here
    // rather than refused at insert time.
    if (seen.has(key)) continue;
    const options = Array.isArray(e.options)
      ? e.options.map(o => String(o ?? "").trim()).filter(Boolean) : [];
    if (kind === "choice" && options.length === 0) continue;
    seen.add(key);
    out.push({ key, label, kind: kind as ProcedureDetailField["kind"], required: e.required === true, options });
  }
  return out;
}

/**
 * What is wrong with the answers given for a set of detail fields, in the practitioner's words.
 *
 * ⚠ RETURNS THE MISSING LABELS, NOT A BOOLEAN, because s12 requires the working item to NAME what it
 * still needs. A count alone over a collapsed item is a puzzle.
 */
export function detailFieldIssues(
  fields: ProcedureDetailField[], values: Record<string, string> | undefined,
): string[] {
  const issues: string[] = [];
  for (const f of fields) {
    const v = (values?.[f.key] ?? "").trim();
    if (f.required && !v) { issues.push(f.label.toLowerCase()); continue; }
    if (!v) continue;
    if (f.kind === "choice" && !f.options.includes(v)) issues.push(`a valid ${f.label.toLowerCase()}`);
    // Number is checked as a number rather than by pattern -- "12kg" and "" are both not numbers, and
    // the practitioner needs to be told which field, not which regex.
    if (f.kind === "number" && !Number.isFinite(Number(v))) issues.push(`a number for ${f.label.toLowerCase()}`);
  }
  return issues;
}

/** required: must be answered before Ready. optional: offered, never demanded. hidden: not rendered. */
export type FieldApplicability = "required" | "optional" | "hidden";

export type ProcedureFieldPlan = {
  side: FieldApplicability;
  consent: FieldApplicability;
  site: FieldApplicability;
  /** True when the item came from the catalogue, so its answers are governed rather than guessed. */
  governed: boolean;
  /** s9's configured choices. EMPTY MEANS UNRESTRICTED, never "no choices" -- migration 297. */
  lateralities: string[];
  /** s11's per-procedure lifecycle. Empty means unrestricted. */
  statuses: string[];
  /** s11's quiet default, applied only where the practitioner has chosen nothing. */
  defaultStatus: string | null;
  /** s14: this procedure must record what happened, where it happened. */
  outcomeRequired: boolean;
  /** s8's extra fields, already parsed and validated as definitions. */
  detailFields: ProcedureDetailField[];
};

/**
 * Which fields this procedure should show, and which it must have.
 *
 * ⚠ s9: "For non-sided procedures, HIDE SIDE ENTIRELY", and s22 names EEG and endotracheal intubation
 * as the cases. A catalogue entry with `sided: false` is a statement by the practice that the procedure
 * has no sides, so the control is not drawn -- s21: "do not allow non-sided procedures to generate
 * laterality errors", and s3: "do not display Site, Side, Consent, Status, Outcome or Complication
 * merely because those fields exist".
 *
 * ⚠ BUT FREE TEXT IS NOT A STATEMENT THAT A PROCEDURE HAS NO SIDES. It is the absence of one. Hiding
 * Side on an unrecognised procedure name would silently drop laterality from anything not yet in the
 * catalogue -- a capture loss dressed as a simplification, and on a sided procedure a wrong-site record.
 * So `governed: false` keeps every field visible and demands none.
 *
 * ⚠ SITE IS ALWAYS OPTIONAL, and that is the schema speaking rather than a decision. s20 wants site
 * applicability per procedure and `practice_procedure_type` has no site column at all, so nothing here
 * can honestly require it. s22's "Joint injection can require site/side before becoming Ready" is
 * therefore only half satisfied today -- the side half. That gap is real and belongs to the migration.
 */
/** Map one 297 rule column onto the screen's vocabulary. `not_applicable` is the only thing that hides. */
const ruleToField = (rule: string | null | undefined, fallback: FieldApplicability): FieldApplicability =>
  rule === "required" ? "required" : rule === "not_applicable" ? "hidden"
    : rule === "optional" ? "optional" : fallback;

export function procedureFieldPlan(type: ProcedureTypeShape): ProcedureFieldPlan {
  if (!type)
    return {
      side: "optional", consent: "optional", site: "optional", governed: false,
      lateralities: [], statuses: [], defaultStatus: null, outcomeRequired: false, detailFields: [],
    };
  return {
    // ⚠ THE OR IS THE POINT. A stale `sided` boolean can only ever make the field MORE required. See
    // ProcedureTypeShape for why the two columns both survive.
    side: type.sided === true ? "required" : ruleToField(type.laterality_rule, "hidden"),
    // s10: "do not display 'Consent: Not recorded' on every procedure when separate consent
    // documentation is not required." Where the catalogue does not require it, it moves behind the
    // item's own disclosure rather than off the screen -- a practitioner may still want to record that
    // consent was obtained for something the catalogue does not mandate. So the fallback is `optional`,
    // not `hidden`: only an explicit not_applicable takes it away.
    consent: type.consent_required === true ? "required" : ruleToField(type.consent_rule, "optional"),
    site: ruleToField(type.site_rule, "optional"),
    governed: true,
    // ⚠ EMPTY MEANS NO RESTRICTION, NOT NO CHOICES -- migration 297's header, and the reason these are
    // returned raw rather than defaulted to the full list here. A caller that cannot tell the two apart
    // would offer nothing at all to every procedure that has no restriction, which is all of them.
    lateralities: Array.isArray(type.allowed_lateralities) ? type.allowed_lateralities : [],
    statuses: Array.isArray(type.allowed_statuses) ? type.allowed_statuses : [],
    defaultStatus: type.default_status ?? null,
    outcomeRequired: type.outcome_required === true,
    detailFields: parseDetailFields(type.detail_fields),
  };
}

export type ProcedureDraft = {
  label: string; site: string; laterality: string; consentStatus: string;
  status: string; abandonedReason: string; scheduledAt: string;
  /** s8's answers, keyed by field key. Absent on a free-text item, which has no configured fields. */
  immediateOutcome?: string;
  details?: Record<string, string>;
};

/**
 * s12's readiness state: Ready, or the list of what is still missing.
 *
 * ⚠ THIS IS AN ADVISORY MIRROR OF THE SERVER, AND IT MUST NEVER BE MORE PERMISSIVE THAN ONE. procedures.ts
 * remains the only authority -- it refuses a sided procedure with no side, a consent-required procedure
 * recorded as "not recorded", a stopped procedure with no reason and a SCHEDULED one with no time. The
 * screen used to pre-empt none of that and let every refusal arrive after the click, which s21 now
 * forbids: "make the wrong action difficult or impossible; do not depend on clinicians repeatedly
 * reading warnings."
 *
 * ⚠ THE FAILURE MODE OF A SECOND RULEBOOK IS A SCREEN THAT SAYS READY AND A SERVER THAT SAYS NO. That is
 * survivable and self-correcting -- the refusal still arrives, by name, per item. The UNSURVIVABLE
 * direction is the opposite: a client rule stricter or differently-shaped than the server's would block
 * a legitimate record with no way through, and the practitioner has a patient in front of them. So every
 * check below is a copy of a check that exists in procedures.ts, and nothing here invents a new one.
 */
export function procedureReadiness(draft: ProcedureDraft, type: ProcedureTypeShape): {
  ready: boolean; missing: string[];
} {
  const missing: string[] = [];
  if (!draft.label.trim()) missing.push("a procedure");

  const plan = procedureFieldPlan(type);
  // procedures.ts -- `(type.sided || laterality_rule === "required") && !SIDED_LATERALITIES.includes(...)`.
  if (plan.side === "required" && !SIDED_LATERALITIES.includes(draft.laterality)) missing.push("a side");
  // procedures.ts -- the configured choices. Only a SIDED value is judged: `not_applicable` is caught by
  // the required check above, and judging it here would report two faults for one missing answer.
  if (plan.lateralities.length > 0 && SIDED_LATERALITIES.includes(draft.laterality)
    && !plan.lateralities.includes(draft.laterality)) missing.push(`a side of ${plan.lateralities.join(" or ")}`);
  // procedures.ts -- `site_rule === "required"`, checked with trim because a blank string is not null.
  if (plan.site === "required" && !draft.site.trim()) missing.push("a site");
  // procedures.ts -- `(consent_required || consent_rule === "required") && consentStatus === "not_recorded"`.
  // `refused` passes deliberately: a patient declining is a real recordable event.
  if (plan.consent === "required" && draft.consentStatus === "not_recorded") missing.push("consent");
  // procedures.ts -- a restricted lifecycle refuses a status outside its list.
  if (plan.statuses.length > 0 && !plan.statuses.includes(draft.status)) missing.push("an allowed status");
  // ⚠ procedures.ts DEMANDS AN OUTCOME ONLY WHERE SOMETHING HAPPENED, and so does this. Asking what the
  // outcome was of a procedure merely ORDERED invites an answer that contradicts the status beside it.
  if (plan.outcomeRequired && !(PROCEDURE_STATUSES_NOT_DONE as readonly string[]).includes(draft.status)
    && !(draft.immediateOutcome ?? "").trim()) missing.push("an immediate outcome");
  // s8's configured fields, by their own labels.
  missing.push(...detailFieldIssues(plan.detailFields, draft.details));
  // procedures.ts -- a stopped procedure must say why, for every status in the engine's own list.
  if ((PROCEDURE_STATUSES_NEEDING_REASON as readonly string[]).includes(draft.status)
    && !draft.abandonedReason.trim()) missing.push("a reason");
  // procedures.ts -- a SCHEDULED procedure needs the time it is scheduled for, never defaulted to now().
  if (draft.status === "SCHEDULED" && !draft.scheduledAt.trim()) missing.push("a date and time");

  return { ready: missing.length === 0, missing };
}
