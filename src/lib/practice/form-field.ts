import {
  conditionMet, resolveApplicable, clearedNotice,
  type FieldCondition, type RegistrationFieldLike,
} from "@/lib/practice/registration-condition";

// ────────────────────────────────────────────────────────────────────────────────────────────────────
// CPR-KS-001 PHASE 3 -- THE FIELD. One vocabulary, one evaluator, one validator, one renderer.
//
// ════════════════════════════════════════════════════════════════════════════════════════════════════
// ⚠ THIS FILE IS THE ANSWER TO "EXTENDS THE EXISTING RUNTIME, OR A SECOND ONE?" AND THE ANSWER IS SPLIT.
// ════════════════════════════════════════════════════════════════════════════════════════════════════
//
// The brief is right that a form runtime already exists, and it is right that the default is to extend
// it. What that runtime actually consists of, examined rather than assumed, is FOUR THINGS, and they do
// not have one answer between them:
//
//   1. THE CONDITION EVALUATOR (`conditionMet` / `resolveApplicable`, registration-condition.ts).
//      EXTENDED. Imported and re-exported below. Not one line of it is rewritten, and the harness proves
//      it by `===` on the function object rather than by grep. Phase 2 did the same and the identity
//      assertion is repeated here against BOTH modules, so a future edit cannot quietly fork one.
//
//   2. THE FIELD-TYPE VOCABULARY (`FIELD_TYPES` in registration-config.ts, and the CHECK constraint on
//      practice_registration_field.field_type in migration 223).
//      EXTENDED, AS A STRICT SUPERSET IN THE SAME ORDER. The nine registration types are the first nine
//      entries below, in migration 223's own order, and the harness asserts the equality three ways: as
//      an array against registration-config's export, against the CHECK constraint text in 223 itself,
//      and against the CHECK constraint written for this phase. Two types are ADDED -- `time`, which
//      CPR-KS-001 section 4 names and registration does not need, and `calculated`, which is section 4's
//      "Calculated fields" narrowed to what this build can honestly do. Neither is added to the
//      registration table: adding a type there is a migration to a live patient-intake constraint for a
//      question nobody asked, and the floor rules in registration-config.ts are that table's own.
//
//   3. THE RENDERER. EXTENDED, AND IT IS THE PART THAT DID NOT EXIST AS A SHARED THING AT ALL.
//      There was no renderer to reuse -- there was an INLINE TERNARY inside RegistrationForm.tsx that
//      handled three of the nine authored types. `multi_select` rendered as a single-line text box,
//      `long_text` as a single-line text box, `phone` and `email` as untyped text. A practice that
//      authored a multi-select got a field into which somebody typed prose. So this phase does not add a
//      second renderer beside it: it extracts ONE (`src/components/practice/FormFieldInput.tsx`),
//      teaches it all eleven types, and RegistrationForm.tsx now calls it. The harness asserts the
//      registration form imports the shared renderer and defines no field-type ternary of its own.
//      ⚠ THAT IS A BEHAVIOUR CHANGE ON A LIVE PATIENT-INTAKE SCREEN and it is declared as one in the
//      report: a multi-select now stores an array of chosen values rather than whatever was typed.
//
//   4. THE STORE (`practice_registration_template` + `practice_registration_field`).
//      ⚠ NOT EXTENDED, AND THIS IS THE ONE PLACE A SECOND THING IS BUILT. Three facts about that store,
//      each probed rather than remembered, and any one of them alone would settle it:
//
//        (a) IT IS THE PATIENT REGISTRATION FORM, SINGULAR. `ux_practice_reg_template_default` allows one
//            default published template per workspace and `resolveTemplate()` picks a published row for
//            EVERY registration by specificity over specialty/country/practice_type. An audit tool stored
//            there is a row that resolveTemplate can return, which means a theatre audit offered to the
//            desk as the form for admitting a patient. The only way to stop that is to add a
//            discriminator column -- which is the new store, wearing the old table's name.
//        (b) ⚠ THERE IS NOWHERE FOR AN ANSWER, AND WHAT PASSES FOR ONE IS PATIENT-SHAPED. A registration
//            answer is written to `practice_patient.custom_fields`: ONE jsonb map per PERSON, by design
//            (migration 223 line 110). A form is filled in many times -- about the same patient, about a
//            different patient, or about no patient at all -- and a single map keyed by field_key would
//            overwrite January's risk assessment with February's. This is the same argument migration 009
//            settled when it put checklist_responses in a table of its own, and the same one Phase 2 made
//            for practice_checklist_run. It is not a preference.
//        (c) `is_core` MEANS "THIS MAPS TO A COLUMN ON practice_patient", and PROTECTED_FIELDS in
//            registration-config.ts is a floor that cannot be lowered by configuration. No field on a
//            consent form maps to a column on anything, and a floor about names and dates of birth has no
//            meaning on an equipment inspection.
//
// So: ONE evaluator, ONE field vocabulary, ONE validator, ONE renderer -- and TWO stores, because the
// existing one is a patient-intake form with a patient-shaped answer column and a floor of its own. If
// the answer had been "one store", the first audit form authored would have been offered to the
// registration desk. That is not an abstraction worth having.
//
// ---- ⚠ WHAT THIS FILE DELIBERATELY DOES NOT CONTAIN --------------------------------------------------
//
// AN EXPRESSION LANGUAGE. Section 4 asks for "Calculated fields" and "Calculations", and the survey found
// that `practice_parameter_definition.formula` is a DISPLAY STRING with a hardcoded map behind it, and
// that no formula evaluator exists anywhere in this repository. A parser accepting author-written
// arithmetic is a security surface, a termination problem and a clinical-safety problem in one, and half
// of one is worse than none. What is built instead is TWO NAMED OPERATIONS over other fields on the same
// form -- add them up, or count how many were answered -- with no chaining, no nesting and no syntax. The
// gap between that and section 4 is declared in form-constants.ts with what would close it.
//
// AN AUTHOR-SUPPLIED REGULAR EXPRESSION. Section 4's "Validation" would naturally be read as allowing a
// pattern per field. A regex written by a practitioner and run on the server for every submission is a
// denial of service somebody can author by accident. `rules.pattern` is refused by name in
// `validateAnswer` rather than silently ignored, so an author finds out at once.
//
// A SECOND `conditionMet`. See point 1.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * ⚠ RE-EXPORTED, NOT REDEFINED, so anything reaching for the evaluator through this module gets THE one.
 *
 * registration-condition.ts imports nothing at all, which is what makes it safe in a client component --
 * the form-filling screen and the registration form both evaluate conditions in the browser, and the
 * server evaluates the same ones through the same function objects.
 */
export { conditionMet, resolveApplicable, clearedNotice };
export type { FieldCondition, RegistrationFieldLike };

// ── THE FIELD TYPES ─────────────────────────────────────────────────────────────────────────────────
//
// ⚠ THE FIRST NINE ARE MIGRATION 223's NINE, IN 223's ORDER. That is not decoration: `field_type` is a
// CHECK constraint on practice_registration_field, and this phase's `practice_form_field.field_type` is a
// CHECK constraint too. Three lists have to agree or an author builds a form whose submission the
// database refuses, and the practitioner has no way to tell which of the choices on their own screen was
// the impossible one. The harness asserts all three against each other, including against the SQL text.

export type FieldValueKind =
  /** A string. */              "text"
  /** A JSON number. */       | "number"
  /** "YYYY-MM-DD". */        | "date"
  /** "HH:MM". */             | "time"
  /** true or false. */       | "boolean"
  /** One option value. */    | "choice"
  /** Several option values. */ | "choices"
  /** ⚠ Never entered. Worked out from other answers at read time. */ | "derived";

export type PracticeFieldType = {
  code: string;
  label: string;
  /** What it is for, in a practitioner's words. */
  meaning: string;
  valueKind: FieldValueKind;
  /** Does it need a list of choices before it can be published? */
  needsOptions: boolean;
  /** ⚠ Is this one of migration 223's nine, so the registration form may also use it? */
  onRegistrationForm: boolean;
};

export const PRACTICE_FIELD_TYPES: PracticeFieldType[] = [
  { code: "text", label: "Text", valueKind: "text", needsOptions: false, onRegistrationForm: true,
    meaning: "One line of writing." },
  { code: "long_text", label: "Long text", valueKind: "text", needsOptions: false, onRegistrationForm: true,
    meaning: "Several lines, for something somebody has to describe rather than pick." },
  { code: "number", label: "Number", valueKind: "number", needsOptions: false, onRegistrationForm: true,
    meaning: "A figure. A lowest and a highest can be set, and the database stores it as a number rather than as writing." },
  { code: "date", label: "Date", valueKind: "date", needsOptions: false, onRegistrationForm: true,
    meaning: "A day. An earliest and a latest can be set." },
  { code: "select", label: "One from a list", valueKind: "choice", needsOptions: true, onRegistrationForm: true,
    meaning: "One choice out of several. This is section 4's dropdown and its radio buttons -- the same answer either way, so there is one type and not two." },
  { code: "multi_select", label: "Any from a list", valueKind: "choices", needsOptions: true, onRegistrationForm: true,
    meaning: "Any number of choices out of several, stored as a list rather than as one line of writing." },
  { code: "boolean", label: "Yes or no", valueKind: "boolean", needsOptions: false, onRegistrationForm: true,
    meaning: "A single tick box. Section 4's checkbox." },
  { code: "phone", label: "Phone number", valueKind: "text", needsOptions: false, onRegistrationForm: true,
    meaning: "A phone number. ⚠ Its SHAPE is checked -- digits, spaces, brackets, a plus and dashes. Nothing here rings it or checks that it belongs to anybody." },
  { code: "email", label: "Email address", valueKind: "text", needsOptions: false, onRegistrationForm: true,
    meaning: "An email address. ⚠ Its SHAPE is checked. Nothing here sends to it or checks that it exists." },
  // ── The two this phase adds, and neither is added to the registration table. ──
  { code: "time", label: "Time of day", valueKind: "time", needsOptions: false, onRegistrationForm: false,
    meaning: "A time of day, as hours and minutes. ⚠ It carries no date and no timezone, so it means the time somebody wrote down and not an instant." },
  { code: "calculated", label: "Worked out from other answers", valueKind: "derived", needsOptions: false, onRegistrationForm: false,
    meaning: "Added up, or counted, from other answers on the same form. ⚠ Nobody types into it, it is never stored, and it is worked out again every time the form is read -- so it can never disagree with the answers it came from." },
];

export const PRACTICE_FIELD_TYPE_CODES: string[] = PRACTICE_FIELD_TYPES.map(t => t.code);
export const fieldType = (code: string) => PRACTICE_FIELD_TYPES.find(t => t.code === code) ?? null;
export const fieldTypeLabel = (code: string) => fieldType(code)?.label ?? code;

/**
 * ⚠ THE NINE THE REGISTRATION FORM ALREADY HAS, derived from the flag rather than typed out a second
 * time. The harness compares this to registration-config.ts's `FIELD_TYPES` and to migration 223's own
 * CHECK constraint text.
 */
export const REGISTRATION_FIELD_TYPE_CODES: string[] =
  PRACTICE_FIELD_TYPES.filter(t => t.onRegistrationForm).map(t => t.code);

/** The two this phase adds. Named so that "what is new" is a list and not a subtraction somebody does. */
export const FORM_ONLY_FIELD_TYPE_CODES: string[] =
  PRACTICE_FIELD_TYPES.filter(t => !t.onRegistrationForm).map(t => t.code);

export const FIELD_TYPES_NEEDING_OPTIONS: string[] =
  PRACTICE_FIELD_TYPES.filter(t => t.needsOptions).map(t => t.code);

/** ⚠ The one type nobody may answer. Kept as a list so a second derived type cannot be missed later. */
export const DERIVED_FIELD_TYPE_CODES: string[] =
  PRACTICE_FIELD_TYPES.filter(t => t.valueKind === "derived").map(t => t.code);

// ── VALIDATION RULES ────────────────────────────────────────────────────────────────────────────────
//
// CPR-KS-001 section 4's "Validation: Ranges, Mandatory, Dependencies, Logic, Calculations".
//
//   Ranges       -> min/max on a number, minLength/maxLength on writing, earliest/latest on a date.
//   Mandatory    -> `required` on the field itself, which the registration model already had.
//   Dependencies -> `condition`, which is the shared evaluator. Not re-invented here.
//   Logic        -> the same thing. Section 4 names it twice.
//   Calculations -> `calculate`, and it is two named operations rather than a language. See the header.
//
// ⚠ `pattern` IS REFUSED BY NAME. An author-written regular expression run on the server for every
// submission is a denial of service a practitioner can create by accident, and a silent ignore would let
// somebody believe a rule was in force. Refusing it loudly at the point of authoring is the honest half.

export type FieldRules = {
  /** number */
  min?: number;
  max?: number;
  /** text, long_text */
  minLength?: number;
  maxLength?: number;
  /** date, as YYYY-MM-DD */
  earliest?: string;
  latest?: string;
  /** ⚠ calculated only. Two operations and no third. */
  calculate?: { of: "sum" | "count_answered"; fields: string[] };
};

export const CALCULATIONS: { code: string; label: string; meaning: string }[] = [
  { code: "sum", label: "Add them up",
    meaning: "Adds the numbers entered in the fields named. ⚠ A field with no answer is NOT counted as nought -- it is named as unanswered beside the total, because a total that quietly treats a missing answer as zero is a figure nobody can act on." },
  { code: "count_answered", label: "Count how many were answered",
    meaning: "How many of the fields named have an answer at all, whatever that answer was." },
];
export const CALCULATION_CODES: string[] = CALCULATIONS.map(c => c.code);

/** The shape every field satisfies, whichever table it came out of. */
export type FormFieldLike = {
  id?: string;
  field_key: string;
  label?: string | null;
  help?: string | null;
  field_type: string;
  required?: boolean | null;
  visible?: boolean | null;
  is_core?: boolean | null;
  position?: number | null;
  section?: string | null;
  options?: unknown;
  rules?: unknown;
  condition?: unknown;
};

export type FieldOption = { value: string; label: string };

/** Options as a usable list, whatever shape they were stored in. A malformed entry is dropped, not guessed. */
export function fieldOptions(field: FormFieldLike): FieldOption[] {
  const raw = Array.isArray(field.options) ? field.options : [];
  const out: FieldOption[] = [];
  for (const o of raw) {
    if (o && typeof o === "object" && "value" in (o as any)) {
      const value = String((o as any).value ?? "");
      if (!value) continue;
      out.push({ value, label: String((o as any).label ?? value) });
      continue;
    }
    const value = String(o ?? "");
    if (value) out.push({ value, label: value });
  }
  return out;
}

export function fieldRules(field: FormFieldLike): FieldRules {
  const r = field.rules;
  return r && typeof r === "object" && !Array.isArray(r) ? (r as FieldRules) : {};
}

/**
 * ⚠ EMPTY MEANS NO ANSWER, AND AN ANSWER OF SPACES IS EMPTY.
 *
 * This is migration 257's correction as a function. A blank string is not null: a required question
 * "answered" with the space bar has to read as unanswered on the screen, in the engine and in the
 * database, or the three disagree about whether a form is finished. The database's own constraint
 * (`practice_form_answer_not_empty`) is written with btrim for the same reason.
 */
export const isBlankAnswer = (v: unknown): boolean =>
  v === undefined || v === null ||
  (typeof v === "string" && v.trim() === "") ||
  (Array.isArray(v) && v.filter(x => !isBlankAnswer(x)).length === 0);

const DATE_SHAPE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_SHAPE = /^([01]\d|2[0-3]):[0-5]\d$/;
// Deliberately loose. An over-strict address check refuses real addresses, which is a worse failure than
// accepting one that bounces -- and nothing in this deployment can send to it either way.
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_SHAPE = /^[0-9+()\-. ]{4,32}$/;

export type AnswerCheck =
  | { ok: true; value: unknown }
  | { ok: false; code: string; message: string };

/**
 * One answer against one field. THE ONE VALIDATOR: the server calls it before writing, and the screen
 * calls it to show the problem beside the box while somebody is still looking at it.
 *
 * ⚠ IT RETURNS THE NORMALISED VALUE, and the caller must write THAT rather than what it was given. A
 * number arrives from an HTML input as the string "12"; storing it as a string makes `sum` add writing to
 * writing, and makes a later range query compare "9" against "10" alphabetically.
 *
 * ⚠ AN UNKNOWN FIELD TYPE IS REFUSED, not passed through. The opposite choice is the right one for an
 * unknown CONDITION shape -- there, "the field applies" keeps a question on screen that somebody would
 * otherwise never be asked. Here, accepting an answer nobody can interpret writes a row whose meaning is
 * unknown, and it would be read later as though it had been checked.
 */
export function validateAnswer(field: FormFieldLike, value: unknown): AnswerCheck {
  const type = fieldType(field.field_type);
  const name = field.label || field.field_key;
  if (!type)
    return { ok: false, code: "UNKNOWN_FIELD_TYPE", message: `"${name}" is a ${field.field_type}, which is not a kind of question this build knows how to store. The kinds that exist are: ${PRACTICE_FIELD_TYPE_CODES.join(", ")}.` };

  if (type.valueKind === "derived")
    return { ok: false, code: "CALCULATED_NOT_ANSWERABLE", message: `"${name}" is worked out from other answers. Nobody enters it, and it is never stored -- it is worked out again every time this form is read.` };

  const rules = fieldRules(field);
  // ⚠ REFUSED BY NAME rather than ignored. See the header.
  if ("pattern" in (rules as Record<string, unknown>))
    return { ok: false, code: "PATTERN_NOT_SUPPORTED", message: `"${name}" carries a pattern rule. This build does not run author-written patterns: a regular expression written here would be run on the server for every submission, and one that backtracks takes the request with it. Use a list of choices instead.` };

  if (isBlankAnswer(value))
    return field.required === false
      ? { ok: true, value: null }
      : { ok: false, code: "ANSWER_REQUIRED", message: `"${name}" has to be answered.` };

  switch (type.valueKind) {
    case "number": {
      const n = typeof value === "number" ? value : Number(String(value).trim());
      if (!Number.isFinite(n))
        return { ok: false, code: "NOT_A_NUMBER", message: `"${name}" takes a number, and "${String(value)}" is not one.` };
      if (rules.min !== undefined && n < rules.min)
        return { ok: false, code: "OUT_OF_RANGE", message: `"${name}" cannot be below ${rules.min}. ${n} was entered.` };
      if (rules.max !== undefined && n > rules.max)
        return { ok: false, code: "OUT_OF_RANGE", message: `"${name}" cannot be above ${rules.max}. ${n} was entered.` };
      return { ok: true, value: n };
    }
    case "date": {
      const s = String(value).trim();
      if (!DATE_SHAPE.test(s))
        return { ok: false, code: "NOT_A_DATE", message: `"${name}" takes a date written as YYYY-MM-DD.` };
      if (rules.earliest && s < rules.earliest)
        return { ok: false, code: "OUT_OF_RANGE", message: `"${name}" cannot be before ${rules.earliest}.` };
      if (rules.latest && s > rules.latest)
        return { ok: false, code: "OUT_OF_RANGE", message: `"${name}" cannot be after ${rules.latest}.` };
      return { ok: true, value: s };
    }
    case "time": {
      const s = String(value).trim();
      if (!TIME_SHAPE.test(s))
        return { ok: false, code: "NOT_A_TIME", message: `"${name}" takes a time of day written as HH:MM on a 24-hour clock.` };
      return { ok: true, value: s };
    }
    case "boolean": {
      if (typeof value === "boolean") return { ok: true, value };
      const s = String(value).trim().toLowerCase();
      if (s === "true" || s === "yes") return { ok: true, value: true };
      if (s === "false" || s === "no") return { ok: true, value: false };
      return { ok: false, code: "NOT_A_YES_OR_NO", message: `"${name}" is a yes or a no, and "${String(value)}" is neither.` };
    }
    case "choice": {
      const allowed = fieldOptions(field).map(o => o.value);
      const s = String(value).trim();
      if (!allowed.includes(s))
        return { ok: false, code: "NOT_AN_OPTION", message: `"${s}" is not one of the choices on "${name}". The choices are: ${allowed.join(", ") || "none, which is why this form cannot be published"}.` };
      return { ok: true, value: s };
    }
    case "choices": {
      const allowed = new Set(fieldOptions(field).map(o => o.value));
      const list = (Array.isArray(value) ? value : [value]).map(v => String(v).trim()).filter(Boolean);
      const unknown = list.filter(v => !allowed.has(v));
      if (unknown.length)
        return { ok: false, code: "NOT_AN_OPTION", message: `${unknown.map(u => `"${u}"`).join(", ")} ${unknown.length === 1 ? "is not one of the choices" : "are not choices"} on "${name}".` };
      // De-duplicated, and the order the options were authored in rather than the order they were clicked
      // -- so two people who chose the same three things produce the same stored answer.
      const order = fieldOptions(field).map(o => o.value);
      return { ok: true, value: order.filter(v => list.includes(v)) };
    }
    default: {
      const s = String(value);
      if (field.field_type === "email" && !EMAIL_SHAPE.test(s.trim()))
        return { ok: false, code: "NOT_AN_EMAIL", message: `"${name}" does not look like an email address. Nothing here sends to it -- this is a check on the shape only.` };
      if (field.field_type === "phone" && !PHONE_SHAPE.test(s.trim()))
        return { ok: false, code: "NOT_A_PHONE", message: `"${name}" does not look like a phone number. Nothing here rings it -- this is a check on the shape only.` };
      if (rules.minLength !== undefined && s.trim().length < rules.minLength)
        return { ok: false, code: "TOO_SHORT", message: `"${name}" needs at least ${rules.minLength} characters. ${s.trim().length} were entered.` };
      if (rules.maxLength !== undefined && s.trim().length > rules.maxLength)
        return { ok: false, code: "TOO_LONG", message: `"${name}" takes at most ${rules.maxLength} characters. ${s.trim().length} were entered.` };
      return { ok: true, value: s.trim() };
    }
  }
}

// ── CALCULATED FIELDS ───────────────────────────────────────────────────────────────────────────────
//
// ⚠ DERIVED, NEVER STORED, AND WORKED OUT AGAIN EVERY TIME THE FORM IS READ. A stored total is a total
// that can disagree with the answers under it -- which is exactly what happens the first time somebody
// changes an answer through a path that forgot to recompute. There is no such path if there is no column.
//
// ⚠ AND A MISSING ANSWER IS NOT A NOUGHT. `sum` returns what it could add AND names what it could not
// add, and the screen prints both. A risk score of 6 that is really "6 out of the 3 questions that were
// answered, of 5" is the single most dangerous number a form engine can print, and it is dangerous
// precisely because it looks finished.

export type CalculatedValue = {
  field_key: string;
  label: string;
  of: string;
  /** The figure. ⚠ Read it beside `missing`, never alone. */
  value: number;
  /** The fields that were added or counted, by key. Every figure is the length of a list you can open. */
  counted: string[];
  /** ⚠ Named, not counted. The fields it was told to use that APPLY and have no usable answer. */
  missing: string[];
  /**
   * ⚠ THE FIELDS A CONDITION WITHDREW, AND THEY ARE NOT `missing`.
   *
   * This is the four-outcomes doctrine of this phase applied to arithmetic, and it was got wrong first
   * time. A question that did not apply is not a question that was missed: the first is a designed
   * outcome, the second is a gap somebody should go and fill. Reporting a withdrawn input as "missing"
   * tells a practitioner to go and answer a question that is not on their screen -- which is precisely
   * the unactionable refusal the registration fix was about.
   */
  withheld: string[];
  /** True only when the total used every input it names -- nothing missing AND nothing withdrawn. */
  complete: boolean;
  /** Set when the calculation itself is unusable -- and then `value` must not be shown at all. */
  problem: string | null;
};

/**
 * Every calculated field on a form, worked out from the answers given.
 *
 * `answers` is keyed by field_key. A calculated field may only name fields that come BEFORE it and are
 * numbers (for `sum`) -- CALCULATIONS_RESOLVE refuses anything else at publish, and this reports the
 * problem rather than quietly producing a figure if a form somehow got past it.
 */
export function calculatedValues(
  fields: FormFieldLike[],
  answers: Record<string, unknown>,
): CalculatedValue[] {
  const ordered = [...(fields ?? [])].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));

  // ⚠ THE AUTHORED SET, NOT THE APPLICABLE ONE, AND THIS LINE IS A BUG FIX WITH A CLINICAL CONSEQUENCE.
  //
  // Both callers used to pre-filter to the questions currently drawn and hand THAT in. So the moment a
  // condition withdrew one of a total's inputs, the input was no longer in the map, the reference read as
  // dangling, and the total collapsed to `0` with the explanation "it names X, which is not a question on
  // this form" -- about a question that is plainly on the form. A risk score silently reading nought,
  // with a misleading reason, is the worst artifact this engine could produce.
  //
  // It also disagreed with CALCULATIONS_RESOLVE, which validates references against the AUTHORED list at
  // publish. A rule enforced one way at publish and another at read time is two rules.
  //
  // So: references resolve against everything the author wrote, and APPLICABILITY IS COMPUTED HERE rather
  // than trusted from the caller -- one source of truth, which callers cannot get wrong.
  const byKey = new Map(ordered.map(f => [f.field_key, f]));
  const applicableKeys = new Set(applicableFields(ordered, answers).applicable.map(f => f.field_key));

  return ordered
    .filter(f => fieldType(f.field_type)?.valueKind === "derived")
    .map(f => {
      const calc = fieldRules(f).calculate;
      const base: CalculatedValue = {
        field_key: f.field_key, label: f.label || f.field_key,
        of: calc?.of ?? "", value: 0, counted: [], missing: [], withheld: [], complete: false, problem: null,
      };
      if (!calc || !CALCULATION_CODES.includes(calc.of) || !Array.isArray(calc.fields) || calc.fields.length === 0)
        return { ...base, problem: "This field is meant to be worked out from other answers, but it does not say which ones or how. Nothing is shown for it." };

      const named = calc.fields.map(String);
      const unknownKeys = named.filter(k => !byKey.has(k));
      if (unknownKeys.length)
        return { ...base, problem: `It names ${unknownKeys.map(k => `"${k}"`).join(", ")}, which ${unknownKeys.length === 1 ? "is not a question" : "are not questions"} on this form.` };

      const counted: string[] = [];
      const missing: string[] = [];
      const withheld: string[] = [];
      let total = 0;

      for (const key of named) {
        const source = byKey.get(key)!;
        // ⚠ WITHDRAWN FIRST, AND IT IS NOT MISSING. A question a condition took away has no answer
        // BECAUSE IT WAS NEVER ASKED. Calling that "missing" sends somebody to answer a question that is
        // not on their screen.
        if (!applicableKeys.has(key)) { withheld.push(key); continue; }
        const v = answers[key];
        if (isBlankAnswer(v)) { missing.push(key); continue; }
        if (calc.of === "count_answered") { counted.push(key); total += 1; continue; }
        const n = typeof v === "number" ? v : Number(String(v).trim());
        if (!Number.isFinite(n)) {
          // ⚠ NOT SKIPPED SILENTLY. An answer that cannot be added is reported as missing from the total
          // rather than treated as nought, for the same reason a blank one is.
          missing.push(key);
          continue;
        }
        if (fieldType(source.field_type)?.valueKind !== "number") {
          return { ...base, problem: `It adds up "${source.label || key}", which is not a number question.` };
        }
        counted.push(key);
        total += n;
      }

      return {
        ...base, of: calc.of, value: total, counted, missing, withheld,
        // ⚠ count_answered's `missing` IS its answer -- an unanswered field is the thing being counted --
        // so only a WITHDRAWN input makes it incomplete. For a sum, either does.
        complete: (calc.of === "count_answered" ? true : missing.length === 0) && withheld.length === 0,
        problem: null,
      };
    });
}

/**
 * ⚠ THE ADAPTER ONTO THE SHARED RESOLVER, AND IT LIVES HERE RATHER THAN IN forms.ts FOR ONE REASON.
 *
 * The fill-in screen is a "use client" component and it has to resolve exactly the conditions the server
 * resolves. forms.ts imports `audit` from provisioning (node:crypto) and `requestApproval` from
 * delegation, so a client component reaching for this through forms.ts would drag both into the browser
 * bundle -- the failure that killed the Follow-ups board and passed tsc, eslint and every harness on the
 * way through. This file imports only registration-condition.ts, which imports nothing at all.
 *
 * `is_core: false` on every question, because a form has no equivalent of the registration form's
 * hard-drawn core controls -- every question is conditional-eligible, so every answer is clearable.
 * `visible: true` for the same reason: a question that exists on a published form is on the screen.
 *
 * ⚠ A CALCULATED QUESTION IS PASSED THROUGH THE RESOLVER LIKE ANY OTHER, so a total can be hidden behind
 * a condition. What it is NOT is answerable -- see validateAnswer.
 */
export function applicableFields<F extends FormFieldLike>(
  fields: F[],
  answers: Record<string, unknown>,
): { applicable: F[]; answers: Record<string, unknown>; cleared: F[] } {
  const list = fields ?? [];
  const out = resolveApplicable(
    list.map(f => ({
      field_key: f.field_key, label: f.label ?? f.field_key,
      visible: true, is_core: false, condition: f.condition,
    })),
    answers,
  );
  const applicableKeys = new Set(out.applicable.map(f => f.field_key));
  const clearedKeys = new Set(out.cleared.map(f => f.field_key));
  return {
    applicable: list.filter(f => applicableKeys.has(f.field_key)),
    answers: out.values,
    cleared: list.filter(f => clearedKeys.has(f.field_key)),
  };
}

/**
 * An answer as words, for a screen or a printed page.
 *
 * ⚠ ONE DEFINITION, because the screen and the paper must not disagree about what an answer said. A
 * chosen option prints its LABEL and not its stored value: "yes" on paper beside a question whose choices
 * were "Agreed" and "Declined" is a record somebody reads wrongly.
 *
 * ⚠ AND IT NEVER RETURNS AN EMPTY STRING. A blank beside a question reads as "nothing to say here",
 * which is the claim this whole module exists to avoid making. An unanswered question is the caller's to
 * render -- this returns null so the caller cannot accidentally print nothing.
 */
export function displayAnswer(field: FormFieldLike, value: unknown): string | null {
  if (isBlankAnswer(value)) return null;
  const kind = fieldType(field.field_type)?.valueKind;
  if (kind === "boolean") return value === true || String(value) === "true" ? "Yes" : "No";
  if (kind === "choice") {
    const opt = fieldOptions(field).find(o => o.value === String(value));
    return opt ? opt.label : String(value);
  }
  if (kind === "choices") {
    const opts = fieldOptions(field);
    const list = (Array.isArray(value) ? value : [value]).map(v => String(v));
    const labels = list.map(v => opts.find(o => o.value === v)?.label ?? v);
    return labels.join(", ") || null;
  }
  const s = String(value).trim();
  return s === "" ? null : s;
}

/**
 * The sentence a calculated field says beside its figure.
 *
 * Here rather than in the component so that it can be asserted, and so that the same words appear on the
 * screen and on the printed page. A total with no such sentence is a total somebody will quote.
 */
export function calculationNotice(c: CalculatedValue): string {
  if (c.problem) return c.problem;

  // ⚠ TWO DIFFERENT SENTENCES FOR TWO DIFFERENT THINGS, and never one standing in for the other.
  // A MISSING input is a gap somebody can go and fill. A WITHHELD one is a question that was never asked,
  // and telling somebody to go and answer it would send them looking for a box that is not on the screen.
  const withheldPart = c.withheld.length
    ? ` ${c.withheld.join(", ")} did not apply on this occasion, so ${c.withheld.length === 1 ? "it is" : "they are"} not part of this total.`
    : "";
  const missingPart = c.missing.length
    ? ` ⚠ This total does not include ${c.missing.join(", ")}, which ${c.missing.length === 1 ? "has" : "have"} no usable answer -- ${c.missing.length === 1 ? "it is" : "they are"} left out rather than counted as nought.`
    : "";

  if (c.of === "count_answered")
    return `${c.value} of ${c.counted.length + c.missing.length} answered.${withheldPart}`;
  if (c.missing.length === 0 && c.withheld.length === 0)
    return `Added from all ${c.counted.length} of the answers it uses.`;
  return `Added from ${c.counted.length} of ${c.counted.length + c.missing.length} answers.${missingPart}${withheldPart}`;
}
