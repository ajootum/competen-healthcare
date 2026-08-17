/**
 * Practice Forms harness -- CPR-KS-001 Phase 3 (section 4, the Intelligent Forms Engine).
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────────────
 * ⚠ THIS HARNESS HAS TWO BRANCHES AND IT ASKS THE DATABASE WHICH ONE TO RUN.
 *
 * The store for this phase (practice_form + _field + _submission + _answer) is a migration whose DDL is
 * in the header of src/lib/practice/forms.ts. Rather than assert "the store is absent", which would
 * become FALSE the day the migration lands, this asks the database and asserts THE ENGINE AGREES WITH IT:
 *
 *   absent   -- every read reports absent rather than empty, and every write refuses by name.
 *   present  -- the whole loop: author, condition, calculate, approve, publish, fill in, withdraw an
 *               answer, submit, revise, supersede, and be refused across a tenancy.
 *
 * Assertion 0 pins the branch to the live probe, so neither branch can pass by being skipped.
 *
 * WHAT IT PROVES IN BOTH BRANCHES:
 *   1. ⚠ THIS PHASE EXTENDS THE EXISTING FORM RUNTIME RATHER THAN BUILDING A SECOND ONE, and that is
 *      asserted four ways: the evaluator is the same FUNCTION OBJECT (===), the field-type vocabulary is
 *      a strict superset of the registration form's in the same order, the same list appears in
 *      migration 223's CHECK text and in this phase's DDL, and the registration form now imports the one
 *      shared renderer and defines no field-type ternary of its own.
 *   2. ⚠ NO SERVER MODULE CROSSES INTO THE BROWSER. The fill-in screen imports the resolver from the
 *      PURE module, not from forms.ts, which pulls node:crypto through provisioning.
 *   3. Section 4's thirteen offered kinds, eleven question types, fifteen components, five validations
 *      and four outputs, every one written out rather than counted.
 *   4. ⚠ THE NAME, AND THE CONSENT FORM. Nothing user-facing calls this a studio, a designer, a
 *      verification, a sign-off, a witnessed record or legally binding -- and the absence of a signature
 *      is a permanently `not_checked` row rather than silence.
 *   5. ⚠ A WITHDRAWN QUESTION'S ANSWER IS THROWN AWAY, the clearing cascades, and what went is NAMED.
 *   6. ⚠ FOUR OUTCOMES PER QUESTION AND NEVER A BLANK.
 *   7. ⚠ A MISSING ANSWER IS NOT A NOUGHT IN A TOTAL -- it is named beside the figure.
 *   8. ⚠ THREE CHECKS CAN NEVER BE ANSWERED AND ARE NEVER GREEN.
 *   9. A FAILED OR ABSENT READ IS NEVER A ZERO.
 *  10. NO CAPABILITY CODE WAS INVENTED -- all three asserted against the LIVE catalogue.
 *
 *   npx --yes tsx scripts/practice-forms-harness.ts
 * ────────────────────────────────────────────────────────────────────────────────────────────────────
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { runProvisioning, type IndividualRequest } from "../src/lib/practice/provisioning";
import { decideApproval } from "../src/lib/practice/delegation";
import { purgeWorkspacesOwnedBy } from "./_cleanup";
import {
  conditionMet as registrationConditionMet,
  resolveApplicable as registrationResolveApplicable,
  clearedNotice as registrationClearedNotice,
} from "../src/lib/practice/registration-condition";
import { FIELD_TYPES as REGISTRATION_FIELD_TYPES_LIVE } from "../src/lib/practice/registration-config";
import {
  formStorePresence, formLibrary, getForm, getFormSubmission,
  createForm, updateForm, submitFormForApproval, withdrawFormFromReview,
  syncFormApproval, publishForm, archiveForm, reviseForm,
  startFormSubmission, recordAnswers, submitFormSubmission, abandonFormSubmission,
  renderForm, submissionCompleteness, formReadiness, answerMap,
  FORM_TABLE, FORM_FIELD_TABLE, FORM_SUBMISSION_TABLE, FORM_ANSWER_TABLE, FORM_TABLES,
  type FormFieldRow,
} from "../src/lib/practice/forms";
import {
  conditionMet, resolveApplicable, applicableFields, calculatedValues, calculationNotice,
  validateAnswer, isBlankAnswer, displayAnswer,
  PRACTICE_FIELD_TYPES, PRACTICE_FIELD_TYPE_CODES, REGISTRATION_FIELD_TYPE_CODES,
  FORM_ONLY_FIELD_TYPE_CODES, CALCULATIONS, CALCULATION_CODES,
} from "../src/lib/practice/form-field";
import {
  formClearedNotice,
  FORM_TYPES, FORM_TYPE_CODES, FORM_TYPE_NOT_OFFERED, FORM_STATES, FORM_STATE_CODES,
  FORM_STATES_EDITABLE, FORM_STATES_USABLE, FORM_TRANSITIONS, FORM_SUBJECTS, FORM_SUBJECT_CODES,
  FORM_SUBMISSION_STATES, FORM_CHECKS, FORM_CHECKS_NOT_CHECKABLE, FORM_CHECKS_DATABASE_OWNED,
  FORM_CHECK_SWATCH, FORM_ANSWER_SWATCH, FORM_FACETS, FORM_FACETS_LIVE, FORM_FACETS_ABSENT,
  FORM_CAPABILITY_CODES, FORM_CAPABILITIES, FORM_COMPONENTS, FORM_VALIDATIONS, FORM_OUTPUTS,
  FORM_ENGINE_CAPABILITIES, FORM_FORBIDDEN_CLAIMS, FORM_KNOWN_GAPS, FORM_ROLE_REALITY,
  FORM_NOT_VERIFIED, FORM_MODULE_NAME, FORM_LIBRARY_NAME, FORM_SUBMISSION_NAME, FORM_ROUTE,
  formCanMove, formMovesFrom,
} from "../src/lib/practice/form-constants";

loadEnvConfig(process.cwd());

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("Supabase env not set"); process.exit(1); }
const admin = createClient(url, key, { auth: { persistSession: false } });

const AUTHOR = "00000000-0000-4000-8000-0000000f0301";
const COLLEAGUE = "00000000-0000-4000-8000-0000000f0302";
const OTHER = "00000000-0000-4000-8000-0000000f0303";

let pass = 0;
const fails: string[] = [];
const ok = (label: string, cond: boolean, detail = "") => {
  if (cond) { pass++; console.log(`  PASS  ${label}`); }
  else { fails.push(label); console.log(`  FAIL  ${label}${detail ? ` -- ${detail}` : ""}`); }
};

const base = { actorId: AUTHOR, correlationId: "harness-forms" };

// ── The spec, written out. Changing the product must mean changing a document, not nudging a number. ──
//
// Section 4 names FOURTEEN kinds. "Registration forms" is the one this engine does not offer, and that is
// asserted as a deliberate exclusion rather than left as a count that happens to be thirteen.
const SECTION_4_KINDS = [
  "clinical_assessment", "referral", "consent", "procedure", "audit", "research",
  "questionnaire", "patient_survey", "risk_assessment", "inspection", "incident",
  "teaching", "custom",
];
const SECTION_4_COMPONENTS = [
  "Text", "Number", "Date", "Time", "Dropdown", "Checkbox", "Radio", "Signature", "Drawing",
  "Images", "Uploads", "Repeating sections", "Calculated fields", "Conditional questions",
  "Required questions",
];
const SECTION_4_VALIDATIONS = ["Ranges", "Mandatory", "Dependencies", "Logic", "Calculations"];
const SECTION_4_OUTPUTS = ["PDF", "Patient record", "Analytics", "AI"];
const SECTION_3_STATES = ["draft", "in_review", "approved", "published", "archived"];
/** Migration 223's nine, in 223's order. */
const MIGRATION_223_TYPES = [
  "text", "long_text", "number", "date", "select", "multi_select", "boolean", "phone", "email",
];

// ── Fixtures for the pure assertions ─────────────────────────────────────────────────────────────────
const field = (over: Partial<FormFieldRow> & { field_key: string; position: number }): FormFieldRow => ({
  id: `id-${over.field_key}`, section: null, label: `Label for ${over.field_key}`,
  help: null, field_type: "text", required: true, options: [], rules: null, condition: null, ...over,
});

/** has_allergy -> allergy_name -> allergy_plan. A chain, so the fixpoint has something to do. */
const CHAIN: FormFieldRow[] = [
  field({ field_key: "has_allergy", position: 1, field_type: "select",
    options: [{ value: "yes", label: "Yes" }, { value: "no", label: "No" }] }),
  field({ field_key: "allergy_name", position: 2, condition: { when: "has_allergy", equals: "yes" } }),
  field({ field_key: "allergy_plan", position: 3, condition: { when: "allergy_name", isPresent: true } }),
  field({ field_key: "notes", position: 4, field_type: "long_text", required: false }),
];
const answerOf = (field_id: string, value: unknown) => ({ field_id, value });

/** A scoring form, for the calculation assertions. */
const SCORE: FormFieldRow[] = [
  field({ field_key: "q1", position: 1, field_type: "number" }),
  field({ field_key: "q2", position: 2, field_type: "number" }),
  field({ field_key: "q3", position: 3, field_type: "number", required: false }),
  field({ field_key: "total", position: 4, field_type: "calculated", required: false,
    rules: { calculate: { of: "sum", fields: ["q1", "q2", "q3"] } } }),
  field({ field_key: "answered_count", position: 5, field_type: "calculated", required: false,
    rules: { calculate: { of: "count_answered", fields: ["q1", "q2", "q3"] } } }),
];

const emptyDoc = { effective_from: null, review_on: null, status: "draft", approval_request_id: null };
const readyDoc = { effective_from: "2026-09-01", review_on: "2027-09-01", status: "approved", approval_request_id: "a-1" };
const approvedRequest = { status: "APPROVED" };
const pendingRequest = { status: "PENDING" };
const GOOD_FIELDS: FormFieldRow[] = [
  field({ field_key: "has_allergy", position: 1, field_type: "select",
    options: [{ value: "yes", label: "Yes" }, { value: "no", label: "No" }] }),
  field({ field_key: "allergy_name", position: 2, condition: { when: "has_allergy", equals: "yes" } }),
];

const payload = (name: string): IndividualRequest => ({
  displayName: name, countryCode: "UG", timezone: "Africa/Kampala", professionCode: "medical_doctor",
  defaultPracticeType: "clinic", locale: "en-UG", termsVersion: "t1", privacyNoticeVersion: "p1", source: "pilot",
});

async function provision(user: string, name: string, suffix: string): Promise<string> {
  const { data: req } = await admin.from("provisioning_request").insert({
    idempotency_key: `harness-forms-${suffix}`, request_type: "pilot",
    actor_user_id: user, target_user_id: user, payload_hash: "harness", correlation_id: "harness-forms",
  }).select("id").single();
  const run = await runProvisioning(admin, { id: req!.id, target_user_id: user, correlation_id: "harness-forms", workspace_id: null }, payload(name));
  if (!run.ok || !run.workspaceId) throw new Error(`provisioning failed: ${run.errorCode}${run.detail ? " -- " + run.detail : ""}`);
  return run.workspaceId;
}

async function cleanup() {
  // ⚠ THE SHARED TEARDOWN, not a hand-rolled one. It unpicks the references that restrict the workspace
  // cascade, and it REPORTS anything that survives instead of discarding the delete's error.
  // ⚠ practice_audit_event is deliberately untouched: migration 247 made it append-only, so every audit
  // assertion below is scoped to this run's correlation id rather than to a count of the table.
  await purgeWorkspacesOwnedBy(admin, [AUTHOR, OTHER]);
}

function report() {
  console.log(`\n  ${pass} passed, ${fails.length} failed`);
  if (fails.length) { fails.forEach(f => console.log(`   - ${f}`)); process.exit(1); }
  process.exit(0);
}

/**
 * Every user-facing sentence these modules export. NOT the codes and NOT the comments -- the words a
 * practitioner actually reads.
 */
function userFacingSentences(): string[] {
  return [
    FORM_MODULE_NAME, FORM_LIBRARY_NAME, FORM_SUBMISSION_NAME,
    FORM_NOT_VERIFIED.headline, FORM_NOT_VERIFIED.detail, FORM_NOT_VERIFIED.onPaper,
    FORM_TYPE_NOT_OFFERED.label, FORM_TYPE_NOT_OFFERED.why,
    ...FORM_TYPES.flatMap(t => [t.label, t.meaning]),
    ...FORM_SUBJECTS.flatMap(s => [s.label, s.meaning]),
    ...FORM_STATES.flatMap(s => [s.label, s.meaning]),
    ...FORM_SUBMISSION_STATES.flatMap(s => [s.label, s.meaning]),
    ...FORM_TRANSITIONS.flatMap(t => [t.label, t.why]),
    ...FORM_CHECKS.flatMap(c => [c.requirement, c.detail, c.wouldNeed ?? ""]),
    ...FORM_FACETS.flatMap(f => [f.label, f.detail, f.wouldNeed ?? ""]),
    ...FORM_ENGINE_CAPABILITIES.flatMap(c => [c.name, c.how]),
    ...FORM_KNOWN_GAPS.flatMap(g => [g.gap, g.why, g.wouldNeed]),
    ...FORM_ROLE_REALITY.flatMap(r => [r.role, r.how]),
    ...PRACTICE_FIELD_TYPES.flatMap(t => [t.label, t.meaning]),
    ...CALCULATIONS.flatMap(c => [c.label, c.meaning]),
  ];
}

/** Which forbidden claims a body of text makes. Its own correctness is asserted at 2b-control. */
function forbiddenClaimsIn(sentences: string[]): string[] {
  const hay = sentences.join(" \n ").toLowerCase();
  return FORM_FORBIDDEN_CLAIMS.filter(w => hay.includes(w.toLowerCase()));
}

const SHELL_DIR = join(process.cwd(), "src", "app", "practice", "(shell)", "knowledge-studio", "forms");
const SRC = (...p: string[]) => join(process.cwd(), "src", ...p);

async function main() {
  console.log(`\n${FORM_MODULE_NAME} harness (CPR-KS-001 Phase 3, section 4)\n`);

  // ══ 0. WHICH BRANCH, AND IT IS THE DATABASE THAT DECIDES ═══════════════════════════════════════
  const presence = await formStorePresence(admin);
  // Asked directly, without the engine, so assertion 0 is not the engine marking its own homework.
  const directProbe = await Promise.all(FORM_TABLES.map(async t => {
    const { error } = await admin.from(t).select("id").limit(1);
    return { t, present: !error };
  }));
  const reallyPresent = directProbe.every(p => p.present);
  ok("0. the engine's view of the store is the DATABASE's view, not an assumption",
    presence.present === reallyPresent && (presence.state === "present") === reallyPresent,
    `engine=${presence.state} database=${JSON.stringify(directProbe)}`);
  console.log(`\n  -- store is ${presence.state.toUpperCase()} --\n`);

  // ══ 1. ⚠ EXTENDS, NOT A SECOND RUNTIME. THE FOUR PROOFS. ═══════════════════════════════════════
  //
  // ⚠ `===` ON THE FUNCTION OBJECT, not a grep for the name and not a behavioural comparison. Two copies
  // of a rule can behave identically on the day they are written -- that is precisely why the drift is
  // not noticed until later. Only identity proves there is one.
  ok("1a. ⚠ THE FORM ENGINE'S conditionMet IS THE REGISTRATION FORM'S, THE SAME FUNCTION OBJECT",
    conditionMet === registrationConditionMet,
    "the form module exports a different function object -- there are two evaluators");
  ok("1a-b. ⚠ AND SO IS resolveApplicable, so the fixpoint is one implementation too",
    resolveApplicable === registrationResolveApplicable,
    "the form module exports a different resolver");
  // The cast is to `unknown` so TypeScript will compare two differently-typed function objects at all.
  ok("1a-c. ⚠ AND applicableFields IS AN ADAPTER OVER IT, not a second resolver -- it is not that function",
    (applicableFields as unknown) !== (registrationResolveApplicable as unknown) &&
    typeof applicableFields === "function");

  // ⚠ 1b. THE VOCABULARY, THREE WAYS. If these drift, an author builds a form whose submission the
  // database refuses and the practitioner cannot tell which choice on their own screen was impossible.
  ok("1b. ⚠ THE NINE REGISTRATION FIELD TYPES ARE THE FIRST NINE HERE, IN THE SAME ORDER",
    REGISTRATION_FIELD_TYPE_CODES.join() === MIGRATION_223_TYPES.join() &&
    PRACTICE_FIELD_TYPE_CODES.slice(0, 9).join() === MIGRATION_223_TYPES.join(),
    `${REGISTRATION_FIELD_TYPE_CODES.join(" ")} | ${PRACTICE_FIELD_TYPE_CODES.join(" ")}`);
  ok("1b-b. ⚠ AND THEY ARE THE LIVE registration-config EXPORT, not a remembered copy of it",
    REGISTRATION_FIELD_TYPE_CODES.join() === [...REGISTRATION_FIELD_TYPES_LIVE].join(),
    `${REGISTRATION_FIELD_TYPE_CODES.join(" ")} vs ${[...REGISTRATION_FIELD_TYPES_LIVE].join(" ")}`);
  // ⚠ AND AGAINST THE SQL ITSELF. registration-config could drift from its own CHECK constraint, and the
  // database is what actually refuses a row.
  const mig223 = readFileSync(join(process.cwd(), "supabase", "migrations", "223-practice-registration-templates.sql"), "utf8");
  const check223 = (mig223.match(/field_type[\s\S]{0,240}?check\s*\(field_type in \(([\s\S]*?)\)\)/) ?? [])[1] ?? "";
  const typesIn223 = [...check223.matchAll(/'([a-z_]+)'/g)].map(m => m[1]);
  ok("1b-c. ⚠ AND AGAINST MIGRATION 223's OWN CHECK CONSTRAINT, which is what the database enforces",
    typesIn223.join() === MIGRATION_223_TYPES.join(),
    `223 says: ${typesIn223.join(" ")}`);
  ok("1b-d. ⚠ AND THIS PHASE'S OWN DDL CARRIES ALL ELEVEN IN THE SAME ORDER",
    (() => {
      const engine = readFileSync(SRC("lib", "practice", "forms.ts"), "utf8");
      const block = (engine.match(/field_type text not null default 'text' check \(field_type in \(([\s\S]*?)\)\)/) ?? [])[1] ?? "";
      return [...block.matchAll(/'([a-z_]+)'/g)].map(m => m[1]).join() === PRACTICE_FIELD_TYPE_CODES.join();
    })(),
    "the DDL in forms.ts and PRACTICE_FIELD_TYPES disagree about the question types");
  ok("1b-e. exactly two types are added, and neither is on the registration form",
    FORM_ONLY_FIELD_TYPE_CODES.join() === "time,calculated" &&
    !FORM_ONLY_FIELD_TYPE_CODES.some(c => REGISTRATION_FIELD_TYPE_CODES.includes(c)),
    FORM_ONLY_FIELD_TYPE_CODES.join(" "));

  // ⚠ 1c. THE RENDERER. Identity cannot be asserted across a "use client" boundary from here, so the
  // source is read: the registration form must import the shared component and must NOT still carry its
  // own field-type ternary.
  const regForm = readFileSync(SRC("app", "practice", "(shell)", "patients", "RegistrationForm.tsx"), "utf8");
  ok("1c. ⚠ THE REGISTRATION FORM IMPORTS THE ONE SHARED RENDERER",
    /import\s+FormFieldInput\s+from\s+"@\/components\/practice\/FormFieldInput"/.test(regForm) &&
    /<FormFieldInput/.test(regForm),
    "the registration form does not use the shared renderer -- there would be two");
  ok("1c-b. ⚠ AND IT NO LONGER DECIDES A CONTROL BY FIELD TYPE ITSELF",
    !/f\.field_type\s*===\s*"(select|boolean|number|date)"/.test(regForm),
    "the old inline ternary is still there, so multi_select and long_text still draw a text box");
  ok("1c-c. and the shared renderer really does handle every one of the eleven types",
    (() => {
      const r = readFileSync(SRC("components", "practice", "FormFieldInput.tsx"), "utf8");
      // The five with their own branch, plus the derived branch and the typed default for the rest.
      return ["long_text", "select", "multi_select", "boolean", "number", "date", "time"]
        .every(t => r.includes(`case "${t}"`)) &&
        /valueKind === "derived"/.test(r) &&
        /"email" \? "email"/.test(r) && /"phone" \? "tel"/.test(r);
    })(),
    "the shared renderer does not draw every type");

  // ⚠ 1d. THE BUNDLE BOUNDARY. registration-condition.ts exists because a client component importing the
  // evaluator through a server module dragged node:crypto and next/headers into the browser -- which
  // compiled, passed tsc and eslint, and killed the page at runtime.
  const fillScreen = readFileSync(join(SHELL_DIR, "[formId]", "submissions", "[submissionId]", "FormFill.tsx"), "utf8");
  ok("1d. ⚠ THE FILL-IN SCREEN IMPORTS THE RESOLVER FROM THE PURE MODULE, NOT FROM THE ENGINE",
    /from "@\/lib\/practice\/form-field"/.test(fillScreen) &&
    !/from "@\/lib\/practice\/forms"/.test(fillScreen),
    "the client screen imports forms.ts, which pulls node:crypto through provisioning");
  ok("1d-b. and the pure module imports nothing but the condition evaluator and nothing server-side",
    (() => {
      const pure = readFileSync(SRC("lib", "practice", "form-field.ts"), "utf8");
      const imports = [...pure.matchAll(/from "([^"]+)"/g)].map(m => m[1]);
      return imports.length === 1 && imports[0] === "@/lib/practice/registration-condition";
    })(),
    "form-field.ts has grown an import, and the bundle boundary is gone again");
  ok("1d-c. and the renderer component imports only the pure module too",
    (() => {
      const r = readFileSync(SRC("components", "practice", "FormFieldInput.tsx"), "utf8");
      return !/from "@\/lib\/practice\/forms"/.test(r) && /from "@\/lib\/practice\/form-field"/.test(r);
    })());
  ok("1d-control. CONTROL: the SERVER engine does import the server-only pieces, so 1d is not passing on a file nobody imports anything into",
    (() => {
      const engine = readFileSync(SRC("lib", "practice", "forms.ts"), "utf8");
      return /from "@\/lib\/practice\/provisioning"/.test(engine) && /from "@\/lib\/practice\/form-field"/.test(engine);
    })());

  // ══ 2. THE SPECIFICATION'S VOCABULARY, WRITTEN OUT ═════════════════════════════════════════════
  ok("2a. section 4's kinds, thirteen of the fourteen, in the specification's order",
    FORM_TYPE_CODES.join() === SECTION_4_KINDS.join(), FORM_TYPE_CODES.join(" "));
  ok("2a-b. ⚠ AND THE FOURTEENTH IS DECLARED AS A REFUSAL, not left as a count that happens to be thirteen",
    FORM_TYPE_NOT_OFFERED.code === "registration" &&
    !FORM_TYPE_CODES.includes("registration") &&
    FORM_TYPE_NOT_OFFERED.why.length > 120 &&
    FORM_TYPE_NOT_OFFERED.whereItLives.startsWith("/practice/"),
    FORM_TYPE_NOT_OFFERED.whereItLives);
  ok("2a-c. and each kind carries a meaning distinguishing it from the twelve beside it",
    FORM_TYPES.every(t => t.meaning.trim().length > 20) &&
    new Set(FORM_TYPES.map(t => t.meaning)).size === 13,
    FORM_TYPES.filter(t => t.meaning.trim().length <= 20).map(t => t.code).join(", "));

  ok("2b. section 4's FIFTEEN components, every one declared",
    FORM_COMPONENTS.map(c => c.name).join() === SECTION_4_COMPONENTS.join(),
    FORM_COMPONENTS.map(c => c.name).join(" "));
  ok("2b-b. section 4's FIVE classes of validation, every one declared",
    FORM_VALIDATIONS.map(c => c.name).join() === SECTION_4_VALIDATIONS.join(),
    FORM_VALIDATIONS.map(c => c.name).join(" "));
  ok("2b-c. section 4's FOUR outputs, every one declared",
    FORM_OUTPUTS.map(c => c.name).join() === SECTION_4_OUTPUTS.join(),
    FORM_OUTPUTS.map(c => c.name).join(" "));
  ok("2b-d. ⚠ AND THE ONES THAT ARE NOT BUILT ARE NAMED, not quietly omitted -- signature and drawing among them",
    FORM_COMPONENTS.filter(c => c.state === "absent").map(c => c.name).join() ===
      "Signature,Drawing,Images,Uploads,Repeating sections" &&
    FORM_OUTPUTS.filter(c => c.state === "absent").map(c => c.name).join() === "Analytics,AI",
    FORM_ENGINE_CAPABILITIES.filter(c => c.state !== "built").map(c => `${c.name}=${c.state}`).join(" "));
  ok("2b-e. every declared capability says HOW, in a sentence rather than a word",
    FORM_ENGINE_CAPABILITIES.every(c => c.how.trim().length > 40),
    FORM_ENGINE_CAPABILITIES.filter(c => c.how.trim().length <= 40).map(c => c.name).join(", "));

  ok("2c. two calculations and no third, because a third would be an expression language",
    CALCULATION_CODES.join() === "sum,count_answered", CALCULATION_CODES.join(" "));

  // ══ 3. ⚠ THE NAME, AND THE CONSENT FORM ════════════════════════════════════════════════════════
  const sentences = userFacingSentences();
  ok("3a. ⚠ NOTHING USER-FACING CALLS THIS A STUDIO, A DESIGNER OR A BUILDER -- the asset is named for what it produces",
    !/studio|designer|builder/i.test(sentences.join(" ")),
    sentences.filter(s => /studio|designer|builder/i.test(s)).join(" | "));
  ok("3b. ⚠ AND NO EXPORTED SENTENCE CLAIMS VERIFICATION, ASSURANCE, COMPLIANCE, A SIGN-OFF, A WITNESS OR LEGAL FORCE",
    forbiddenClaimsIn(sentences).length === 0,
    `claimed: ${forbiddenClaimsIn(sentences).join(", ")}`);
  // ⚠ CONTROL, AND IT IS THE ONE THAT MATTERS. 3b would pass just as well against a scanner that never
  // matched anything -- which is exactly how a vacuous assertion looks from the outside.
  ok("3b-control. and the scanner really does find those words when they are there",
    forbiddenClaimsIn(["this consent was witnessed and is legally binding"]).sort().join() ===
      "legally binding,witnessed",
    forbiddenClaimsIn(["this consent was witnessed and is legally binding"]).join(", "));
  ok("3b-control-b. ⚠ AND \"validated\" IS DELIBERATELY NOT FORBIDDEN, because this engine really does validate",
    !FORM_FORBIDDEN_CLAIMS.includes("validated") && FORM_VALIDATIONS.length === 5);
  ok("3c. the not-verified notice exists in three forms, and the paper one is one line",
    FORM_NOT_VERIFIED.headline.length > 20 && FORM_NOT_VERIFIED.detail.length > 120 &&
    FORM_NOT_VERIFIED.onPaper.length > 20 && FORM_NOT_VERIFIED.onPaper.length < 160,
    `${FORM_NOT_VERIFIED.onPaper.length} characters on paper`);
  ok("3d. ⚠ AND ALL THREE SAY THAT NOTHING ON A FORM IS A SIGNATURE -- the sentence that matters on a consent form",
    /signature/i.test(FORM_NOT_VERIFIED.headline) &&
    /signature/i.test(FORM_NOT_VERIFIED.detail) &&
    /signature/i.test(FORM_NOT_VERIFIED.onPaper),
    FORM_NOT_VERIFIED.onPaper);
  ok("3e. a filled-in form is called a completed form",
    FORM_SUBMISSION_NAME === "completed form", FORM_SUBMISSION_NAME);
  ok("3f. ⚠ AND THE CONSENT KIND ITSELF CARRIES THE WARNING, so an author meets it before writing one",
    /signature/i.test(FORM_TYPES.find(t => t.code === "consent")?.meaning ?? ""),
    FORM_TYPES.find(t => t.code === "consent")?.meaning ?? "");

  // ══ 4. CONDITIONS: THE THREE SHAPES, OVER ANSWERS RATHER THAN RESPONSE CODES ════════════════════
  ok("4a. `equals` compares against the answer itself",
    conditionMet({ when: "has_allergy", equals: "yes" }, { has_allergy: "yes" }) &&
    !conditionMet({ when: "has_allergy", equals: "yes" }, { has_allergy: "no" }));
  ok("4a-b. `in` admits any of several answers",
    conditionMet({ when: "a", in: ["gp", "self"] }, { a: "self" }) &&
    !conditionMet({ when: "a", in: ["gp", "self"] }, { a: "other" }));
  ok("4a-c. `isPresent` means the question has been answered at all",
    conditionMet({ when: "a", isPresent: true }, { a: "anything" }) &&
    !conditionMet({ when: "a", isPresent: true }, {}));

  // ⚠ 4b. THE LESSON THE REGISTRATION FIX PAID FOR.
  const chained = applicableFields(CHAIN, { has_allergy: "yes", allergy_name: "penicillin", allergy_plan: "avoid" });
  ok("4b-control. CONTROL: while the condition holds, every question in the chain is drawn and keeps its answer",
    chained.applicable.length === 4 && chained.answers.allergy_plan === "avoid",
    chained.applicable.map(f => f.field_key).join(" "));

  const withdrawn = applicableFields(CHAIN, { has_allergy: "no", allergy_name: "penicillin", allergy_plan: "avoid" });
  ok("4b. ⚠ A WITHDRAWN QUESTION'S ANSWER IS THROWN AWAY, NOT MERELY HIDDEN",
    !("allergy_name" in withdrawn.answers), JSON.stringify(withdrawn.answers));
  ok("4c. ⚠ AND THE CLEARING CASCADES -- clearing one answer withdraws the next question along, which is what the fixpoint is for",
    !("allergy_plan" in withdrawn.answers) && withdrawn.applicable.length === 2,
    `${withdrawn.applicable.map(f => f.field_key).join(" ")} | ${JSON.stringify(withdrawn.answers)}`);
  ok("4d. what was thrown away is NAMED, and only what actually had an answer",
    withdrawn.cleared.map(f => f.field_key).sort().join() === "allergy_name,allergy_plan",
    withdrawn.cleared.map(f => f.field_key).join(" "));
  const neverAnswered = applicableFields(CHAIN, { has_allergy: "no" });
  ok("4d-b. a question nobody answered is not reported as cleared",
    neverAnswered.cleared.length === 0, neverAnswered.cleared.map(f => f.field_key).join(" "));

  ok("4e. the notice names each question and says the answer was removed",
    (formClearedNotice(["Allergy name", "Allergy plan"]) ?? "").includes("Allergy name") &&
    /removed/.test(formClearedNotice(["Allergy name"]) ?? ""),
    formClearedNotice(["Allergy name", "Allergy plan"]) ?? "null");
  ok("4e-b. and nothing is said when nothing was thrown away",
    formClearedNotice([]) === null && formClearedNotice(["  "]) === null);
  // ⚠ THE SENTENCE IS THIS MODULE'S AND THE RULE IS NOT. The registration form says "what was TYPED
  // there", which is not true of a tick box or a chosen option.
  ok("4e-c. ⚠ the sentence is the form's own, because not every answer is typed",
    !/typed/.test(formClearedNotice(["X"]) ?? "") &&
    /typed/.test(registrationClearedNotice(["X"]) ?? ""),
    `${formClearedNotice(["X"])} || ${registrationClearedNotice(["X"])}`);

  // ══ 5. VALIDATION: EVERY RULE, EACH WITH A CONTROL ═════════════════════════════════════════════
  const numberField = field({ field_key: "n", position: 1, field_type: "number", rules: { min: 1, max: 10 } });
  ok("5a. a number below its lowest is refused, by name",
    (() => { const r = validateAnswer(numberField, 0); return !r.ok && r.code === "OUT_OF_RANGE"; })());
  ok("5a-b. and above its highest",
    (() => { const r = validateAnswer(numberField, 11); return !r.ok && r.code === "OUT_OF_RANGE"; })());
  ok("5a-control. CONTROL: a number inside the range is accepted AND COMES BACK AS A NUMBER, not the string it arrived as",
    (() => { const r = validateAnswer(numberField, "5"); return r.ok && r.value === 5 && typeof r.value === "number"; })(),
    JSON.stringify(validateAnswer(numberField, "5")));
  ok("5a-c. and something that is not a number at all is refused separately",
    (() => { const r = validateAnswer(numberField, "abc"); return !r.ok && r.code === "NOT_A_NUMBER"; })());

  const selectField = field({ field_key: "s", position: 1, field_type: "select",
    options: [{ value: "yes", label: "Agreed" }, { value: "no", label: "Declined" }] });
  ok("5b. an answer that is not one of the choices is refused",
    (() => { const r = validateAnswer(selectField, "maybe"); return !r.ok && r.code === "NOT_AN_OPTION"; })());
  ok("5b-control. CONTROL: a choice that is on the list is accepted",
    (() => { const r = validateAnswer(selectField, "yes"); return r.ok && r.value === "yes"; })());

  const multiField = field({ field_key: "m", position: 1, field_type: "multi_select",
    options: [{ value: "a", label: "A" }, { value: "b", label: "B" }, { value: "c", label: "C" }] });
  ok("5c. ⚠ A MULTI-SELECT COMES BACK AS A LIST IN THE AUTHORED ORDER, so two people who chose the same three things store the same answer",
    (() => { const r = validateAnswer(multiField, ["c", "a"]); return r.ok && JSON.stringify(r.value) === '["a","c"]'; })(),
    JSON.stringify(validateAnswer(multiField, ["c", "a"])));
  ok("5c-b. and a value that is not on the list is refused even inside a list",
    (() => { const r = validateAnswer(multiField, ["a", "z"]); return !r.ok && r.code === "NOT_AN_OPTION"; })());

  ok("5d. a date has to be a date, and its earliest and latest are enforced",
    (() => {
      const f = field({ field_key: "d", position: 1, field_type: "date", rules: { earliest: "2026-01-01", latest: "2026-12-31" } });
      const bad = validateAnswer(f, "01/02/2026");
      const early = validateAnswer(f, "2025-12-31");
      const good = validateAnswer(f, "2026-06-01");
      return !bad.ok && bad.code === "NOT_A_DATE" && !early.ok && early.code === "OUT_OF_RANGE" && good.ok;
    })());
  ok("5e. a time has to be a time of day on a 24-hour clock",
    (() => {
      const f = field({ field_key: "t", position: 1, field_type: "time" });
      return !validateAnswer(f, "25:00").ok && validateAnswer(f, "09:30").ok;
    })());
  ok("5f. an email and a phone are checked for SHAPE only, and both say so",
    (() => {
      const e = field({ field_key: "e", position: 1, field_type: "email" });
      const p = field({ field_key: "p", position: 1, field_type: "phone" });
      const bad = validateAnswer(e, "nobody");
      return !bad.ok && /shape only/i.test(bad.message) &&
        validateAnswer(e, "a@b.co").ok && !validateAnswer(p, "??").ok && validateAnswer(p, "+256 700 000 000").ok;
    })());
  ok("5g. shortest and longest are enforced on writing",
    (() => {
      const f = field({ field_key: "w", position: 1, field_type: "text", rules: { minLength: 3, maxLength: 5 } });
      return !validateAnswer(f, "ab").ok && !validateAnswer(f, "abcdef").ok && validateAnswer(f, "abcd").ok;
    })());

  // ⚠ 5h. THE TWO REFUSALS THAT ARE THE POINT OF THE WHOLE VALIDATOR.
  ok("5h. ⚠ AN AUTHOR-WRITTEN PATTERN IS REFUSED BY NAME, not silently ignored -- an ignored rule is one somebody believes is in force",
    (() => {
      const f = field({ field_key: "x", position: 1, field_type: "text", rules: { pattern: "^(a+)+$" } as never });
      const r = validateAnswer(f, "aaa");
      return !r.ok && r.code === "PATTERN_NOT_SUPPORTED";
    })());
  ok("5h-b. ⚠ AND NOBODY MAY ANSWER A WORKED-OUT QUESTION",
    (() => {
      const r = validateAnswer(SCORE[3], 99);
      return !r.ok && r.code === "CALCULATED_NOT_ANSWERABLE";
    })());
  ok("5i. ⚠ AN UNKNOWN QUESTION TYPE IS REFUSED RATHER THAN PASSED THROUGH -- an answer nobody can interpret would be read later as though it had been checked",
    (() => {
      const r = validateAnswer(field({ field_key: "u", position: 1, field_type: "signature" }), "x");
      return !r.ok && r.code === "UNKNOWN_FIELD_TYPE";
    })());

  // ⚠ 5j. A BLANK STRING IS NOT AN ANSWER. Migration 257's lesson, as a function.
  ok("5j. ⚠ AN ANSWER OF SPACES IS NO ANSWER AT ALL, and a required question is refused for it",
    isBlankAnswer("   ") && isBlankAnswer([]) && isBlankAnswer(null) &&
    (() => { const r = validateAnswer(field({ field_key: "r", position: 1 }), "   "); return !r.ok && r.code === "ANSWER_REQUIRED"; })());
  ok("5j-control. CONTROL: an OPTIONAL question left blank is accepted, so 5j is not a rule that refuses everything empty",
    (() => { const r = validateAnswer(field({ field_key: "r", position: 1, required: false }), ""); return r.ok && r.value === null; })());
  ok("5k. a stored answer prints its option LABEL, never the value underneath it",
    displayAnswer(selectField, "yes") === "Agreed" &&
    displayAnswer(multiField, ["a", "c"]) === "A, C" &&
    displayAnswer(field({ field_key: "b", position: 1, field_type: "boolean" }), true) === "Yes",
    String(displayAnswer(selectField, "yes")));
  ok("5k-b. ⚠ AND IT NEVER RETURNS AN EMPTY STRING -- a blank beside a question reads as \"nothing to say here\"",
    displayAnswer(selectField, "") === null && displayAnswer(field({ field_key: "t", position: 1 }), "  ") === null);

  // ══ 6. CALCULATIONS: ⚠ A MISSING ANSWER IS NEVER A NOUGHT ══════════════════════════════════════
  const fullScore = calculatedValues(SCORE, { q1: 3, q2: 4, q3: 5 });
  ok("6a-control. CONTROL: with everything answered the total is the sum and nothing is missing",
    fullScore[0].value === 12 && fullScore[0].missing.length === 0 && fullScore[0].complete,
    JSON.stringify(fullScore[0]));

  const partialScore = calculatedValues(SCORE, { q1: 3, q2: 4 });
  ok("6a. ⚠ A TOTAL OVER A MISSING ANSWER IS NOT COMPLETE, AND THE MISSING ONE IS NAMED",
    partialScore[0].value === 7 && partialScore[0].missing.join() === "q3" && !partialScore[0].complete,
    JSON.stringify(partialScore[0]));
  ok("6a-b. ⚠ AND THE SENTENCE BESIDE THE FIGURE SAYS SO, IN WORDS, INCLUDING \"rather than counted as nought\"",
    /q3/.test(calculationNotice(partialScore[0])) && /nought/.test(calculationNotice(partialScore[0])),
    calculationNotice(partialScore[0]));
  ok("6a-control-b. CONTROL: a complete total says it used all of them, so 6a-b is not a sentence that always warns",
    !/nought/.test(calculationNotice(fullScore[0])) && /all 3/.test(calculationNotice(fullScore[0])),
    calculationNotice(fullScore[0]));
  ok("6b. counting how many were answered is a different operation and is complete by definition",
    partialScore[1].value === 2 && partialScore[1].complete && partialScore[1].of === "count_answered",
    JSON.stringify(partialScore[1]));
  ok("6c. an answer that cannot be added is reported as missing rather than treated as nought",
    (() => {
      const c = calculatedValues(SCORE, { q1: 3, q2: "not a number", q3: 5 });
      return c[0].value === 8 && c[0].missing.join() === "q2";
    })(),
    JSON.stringify(calculatedValues(SCORE, { q1: 3, q2: "not a number", q3: 5 })[0]));
  ok("6d. a calculation naming a question that does not exist reports a problem and shows no figure",
    (() => {
      const broken = [field({ field_key: "t", position: 1, field_type: "calculated",
        rules: { calculate: { of: "sum", fields: ["nobody"] } } })];
      const c = calculatedValues(broken, {});
      return c[0].problem !== null && /nobody/.test(c[0].problem ?? "");
    })());
  ok("6e. a calculation with nothing named at all reports a problem too",
    (() => {
      const broken = [field({ field_key: "t", position: 1, field_type: "calculated", rules: {} })];
      return calculatedValues(broken, {})[0].problem !== null;
    })());

  // ══ 7. RENDERING: FOUR OUTCOMES, NEVER A BLANK ═════════════════════════════════════════════════
  const partial = renderForm(CHAIN, [answerOf("id-has_allergy", "no")]);
  ok("7a. every question is rendered, whatever happened to it",
    partial.rendered.length === 4, String(partial.rendered.length));
  ok("7b. ⚠ 'NOBODY REACHED IT' AND 'IT DID NOT APPLY' ARE DIFFERENT STATES",
    partial.rendered.find(r => r.field_key === "notes")?.state === "not_answered" &&
    partial.rendered.find(r => r.field_key === "allergy_name")?.state === "did_not_apply",
    partial.rendered.map(r => `${r.field_key}=${r.state}`).join(" "));
  ok("7c. a withdrawn question names the question whose answer withdrew it, so the reason is readable",
    partial.rendered.find(r => r.field_key === "allergy_name")?.withheldBy === "Label for has_allergy",
    String(partial.rendered.find(r => r.field_key === "allergy_name")?.withheldBy));
  ok("7d. ⚠ AND THE TWO MARKS ARE DIFFERENT FROM EACH OTHER AND NEITHER IS GREEN OR A TICK",
    FORM_ANSWER_SWATCH.not_answered.chip !== FORM_ANSWER_SWATCH.did_not_apply.chip &&
    !/emerald|green/.test(JSON.stringify(FORM_ANSWER_SWATCH.not_answered)) &&
    !/emerald|green/.test(JSON.stringify(FORM_ANSWER_SWATCH.did_not_apply)) &&
    FORM_ANSWER_SWATCH.not_answered.icon !== "✓" && FORM_ANSWER_SWATCH.did_not_apply.icon !== "✓",
    JSON.stringify([FORM_ANSWER_SWATCH.not_answered, FORM_ANSWER_SWATCH.did_not_apply]));
  const answered = renderForm(CHAIN, [
    answerOf("id-has_allergy", "yes"), answerOf("id-allergy_name", "penicillin"),
    answerOf("id-allergy_plan", "avoid"), answerOf("id-notes", "seen before"),
  ]);
  ok("7-control. ⚠ WITH ANSWERS, EVERY ANSWERED QUESTION CARRIES ITS OWN ANSWER AND ITS OWN WORDS",
    answered.rendered.find(r => r.field_key === "has_allergy")?.display === "Yes" &&
    answered.rendered.find(r => r.field_key === "allergy_name")?.state === "answered" &&
    answered.rendered.filter(r => r.state === "did_not_apply").length === 0,
    answered.rendered.map(r => `${r.field_key}=${r.state}`).join(" "));
  ok("7e. a worked-out question renders as `calculated` and carries the figure and what went into it",
    (() => {
      const r = renderForm(SCORE, [answerOf("id-q1", 3), answerOf("id-q2", 4)]);
      const total = r.rendered.find(x => x.field_key === "total");
      return total?.state === "calculated" && total.value === 7 && total.calculated?.missing.join() === "q3";
    })());
  ok("7f. answerMap keys answers by field_key and values them by the answer itself, which is what a condition names",
    JSON.stringify(answerMap(CHAIN, [answerOf("id-has_allergy", "yes")])) === '{"has_allergy":"yes"}',
    JSON.stringify(answerMap(CHAIN, [answerOf("id-has_allergy", "yes")])));

  // ══ 8. COMPLETENESS ════════════════════════════════════════════════════════════════════════════
  const halfDone = submissionCompleteness(CHAIN, [answerOf("id-has_allergy", "yes")]);
  ok("8a. an unanswered REQUIRED question blocks submission, and it is NAMED rather than counted",
    !halfDone.submittable && halfDone.outstanding.map(f => f.field_key).join() === "allergy_name",
    halfDone.outstanding.map(f => f.field_key).join(" "));
  ok("8b. a question the conditions withdrew is not outstanding, and it is reported separately",
    submissionCompleteness(CHAIN, [answerOf("id-has_allergy", "no")]).didNotApply
      .map(f => f.field_key).sort().join() === "allergy_name,allergy_plan",
    submissionCompleteness(CHAIN, [answerOf("id-has_allergy", "no")]).didNotApply.map(f => f.field_key).join(" "));
  ok("8c. an OPTIONAL unanswered question does not block submission",
    !halfDone.outstanding.some(f => f.field_key === "notes"),
    halfDone.outstanding.map(f => f.field_key).join(" "));
  ok("8d. ⚠ A WORKED-OUT QUESTION IS NEVER OUTSTANDING -- waiting for an answer to it would be a form that can never be submitted",
    (() => {
      const c = submissionCompleteness(SCORE, [answerOf("id-q1", 1), answerOf("id-q2", 2)]);
      return c.submittable && !c.outstanding.some(f => f.field_key === "total");
    })(),
    JSON.stringify(submissionCompleteness(SCORE, [answerOf("id-q1", 1), answerOf("id-q2", 2)]).outstanding.map(f => f.field_key)));
  ok("8d-b. ⚠ BUT AN INCOMPLETE TOTAL IS STILL REPORTED, beside the figure rather than as a refusal",
    submissionCompleteness(SCORE, [answerOf("id-q1", 1), answerOf("id-q2", 2)])
      .calculated.find(c => c.field_key === "total")?.missing.join() === "q3");
  ok("8e. ⚠ AN ANSWER THAT NO LONGER SATISFIES ITS OWN QUESTION IS REPORTED AS INVALID, not silently accepted",
    (() => {
      const c = submissionCompleteness([numberField], [answerOf("id-n", "abc")]);
      return !c.submittable && c.invalid.length === 1 &&
        c.invalid[0].field.field_key === "n" && c.invalid[0].message.includes("Label for n");
    })(),
    JSON.stringify(submissionCompleteness([numberField], [answerOf("id-n", "abc")]).invalid.map(i => i.message)));
  ok("8-control. CONTROL: with everything answered the form is submittable and nothing is outstanding or invalid",
    (() => {
      const c = submissionCompleteness(CHAIN, [
        answerOf("id-has_allergy", "yes"), answerOf("id-allergy_name", "penicillin"),
        answerOf("id-allergy_plan", "avoid"),
      ]);
      return c.submittable && c.outstanding.length === 0 && c.invalid.length === 0;
    })());
  ok("8f. the figures are the lengths of the lists beside them, not a second count",
    halfDone.applicable === 3 && halfDone.answered === 1,
    `${halfDone.answered} of ${halfDone.applicable}`);

  // ══ 9. PUBLICATION READINESS ═══════════════════════════════════════════════════════════════════
  const cold = formReadiness(emptyDoc, [], null);
  const warm = formReadiness(readyDoc, GOOD_FIELDS, approvedRequest);

  ok("9a. an empty form cannot be put into use, because a form with no questions is a title",
    !cold.publishable && cold.checks.find(c => c.code === "HAS_FIELDS")?.state === "fail",
    JSON.stringify({ publishable: cold.publishable, blockers: cold.blockers }));

  const forward = formReadiness(readyDoc, [
    field({ field_key: "first", position: 1, condition: { when: "second", equals: "x" } }),
    field({ field_key: "second", position: 2 }),
  ], approvedRequest);
  ok("9b. ⚠ A CONDITION NAMING A LATER QUESTION IS REFUSED -- it can never be true when its own question is reached",
    forward.checks.find(c => c.code === "CONDITIONS_RESOLVE")?.state === "fail" &&
    (forward.checks.find(c => c.code === "CONDITIONS_RESOLVE")?.detail ?? "").includes("first"),
    forward.checks.find(c => c.code === "CONDITIONS_RESOLVE")?.detail ?? "");
  ok("9b-b. and a condition naming a question that does not exist is refused too",
    formReadiness(readyDoc, [field({ field_key: "only", position: 1, condition: { when: "nobody", equals: "x" } })], approvedRequest)
      .checks.find(c => c.code === "CONDITIONS_RESOLVE")?.state === "fail");
  ok("9b-control. CONTROL: a condition naming an EARLIER question passes, so 9b is not passing on a check that refuses everything",
    warm.checks.find(c => c.code === "CONDITIONS_RESOLVE")?.state === "pass",
    warm.checks.find(c => c.code === "CONDITIONS_RESOLVE")?.detail ?? "");

  // ⚠ 9c. THE CALCULATION RULES, EACH REFUSED SEPARATELY.
  ok("9c. ⚠ A CALCULATION USING A LATER QUESTION IS REFUSED",
    formReadiness(readyDoc, [
      field({ field_key: "t", position: 1, field_type: "calculated", required: false,
        rules: { calculate: { of: "sum", fields: ["n"] } } }),
      field({ field_key: "n", position: 2, field_type: "number" }),
    ], approvedRequest).checks.find(c => c.code === "CALCULATIONS_RESOLVE")?.state === "fail");
  ok("9c-b. ⚠ ONE CALCULATION MAY NOT FEED ANOTHER -- chaining them is an expression language by the back door",
    formReadiness(readyDoc, [
      field({ field_key: "n", position: 1, field_type: "number" }),
      field({ field_key: "t1", position: 2, field_type: "calculated", required: false,
        rules: { calculate: { of: "sum", fields: ["n"] } } }),
      field({ field_key: "t2", position: 3, field_type: "calculated", required: false,
        rules: { calculate: { of: "sum", fields: ["t1"] } } }),
    ], approvedRequest).checks.find(c => c.code === "CALCULATIONS_RESOLVE")?.state === "fail");
  ok("9c-c. and adding up something that is not a number is refused",
    formReadiness(readyDoc, [
      field({ field_key: "w", position: 1, field_type: "text" }),
      field({ field_key: "t", position: 2, field_type: "calculated", required: false,
        rules: { calculate: { of: "sum", fields: ["w"] } } }),
    ], approvedRequest).checks.find(c => c.code === "CALCULATIONS_RESOLVE")?.state === "fail");
  ok("9c-control. CONTROL: a calculation over EARLIER NUMBER questions passes",
    formReadiness(readyDoc, SCORE, approvedRequest).checks.find(c => c.code === "CALCULATIONS_RESOLVE")?.state === "pass",
    formReadiness(readyDoc, SCORE, approvedRequest).checks.find(c => c.code === "CALCULATIONS_RESOLVE")?.detail ?? "");

  // ⚠ 9d. RULES NOTHING COULD SATISFY.
  ok("9d. ⚠ A LOWEST ABOVE A HIGHEST IS REFUSED -- it is a question that refuses every answer",
    formReadiness(readyDoc, [field({ field_key: "n", position: 1, field_type: "number", rules: { min: 10, max: 1 } })], approvedRequest)
      .checks.find(c => c.code === "RULES_COHERENT")?.state === "fail");
  ok("9d-b. and a list with nothing in it is refused",
    formReadiness(readyDoc, [field({ field_key: "s", position: 1, field_type: "select", options: [] })], approvedRequest)
      .checks.find(c => c.code === "RULES_COHERENT")?.state === "fail");
  ok("9d-c. and a pattern rule is refused at publish as well as at answer time",
    formReadiness(readyDoc, [field({ field_key: "w", position: 1, rules: { pattern: "x" } as never })], approvedRequest)
      .checks.find(c => c.code === "RULES_COHERENT")?.state === "fail");
  ok("9d-control. CONTROL: coherent rules pass",
    formReadiness(readyDoc, [field({ field_key: "n", position: 1, field_type: "number", rules: { min: 1, max: 10 } })], approvedRequest)
      .checks.find(c => c.code === "RULES_COHERENT")?.state === "pass");

  ok("9e. ⚠ A LINKED APPROVAL IS NOT A DECIDED ONE, and only the engine can tell them apart",
    formReadiness(readyDoc, GOOD_FIELDS, pendingRequest).checks.find(c => c.code === "APPROVAL_DECIDED")?.state === "fail" &&
    formReadiness(readyDoc, GOOD_FIELDS, pendingRequest).checks.find(c => c.code === "APPROVAL_LINKED")?.state === "pass",
    "the database sees the link; the engine sees the decision");
  ok("9-control. ⚠ A FULLY PREPARED FORM IS PUBLISHABLE -- otherwise 9a-9e would pass against a check that refused everything",
    warm.publishable && warm.blockers === 0, JSON.stringify({ blockers: warm.blockers }));

  // ══ 10. ⚠ THE ROWS THAT ARE NEVER GREEN ════════════════════════════════════════════════════════
  ok("10a. ⚠ THREE CHECKS CAN NEVER BE ANSWERED BY ANYTHING IN THIS BUILD",
    FORM_CHECKS_NOT_CHECKABLE.join() === "ANSWERS_TRUE,SIGNATURE_CAPTURED,SUBMISSION_REQUIRED",
    FORM_CHECKS_NOT_CHECKABLE.join(" "));
  ok("10b. and they are `not_checked` on a fully prepared form too -- never quietly cleared by success",
    FORM_CHECKS_NOT_CHECKABLE.every(code =>
      cold.checks.find(c => c.code === code)?.state === "not_checked" &&
      warm.checks.find(c => c.code === code)?.state === "not_checked"),
    warm.checks.filter(c => FORM_CHECKS_NOT_CHECKABLE.includes(c.code)).map(c => `${c.code}=${c.state}`).join(" "));
  ok("10c. each says what it would take to become checkable, so the gap is actionable",
    FORM_CHECKS.filter(c => c.authority === "absent").every(c => (c.wouldNeed ?? "").trim().length > 40));
  ok("10c-b. ⚠ AND THE SIGNATURE ROW NAMES ALL THREE MISSING PIECES, not just the drawing surface",
    (() => {
      const s = FORM_CHECKS.find(c => c.code === "SIGNATURE_CAPTURED");
      return /consent/i.test(s?.detail ?? "") &&
        /re-?authentication|fresh authentication/i.test(s?.wouldNeed ?? "") &&
        /countersignature/i.test(s?.wouldNeed ?? "");
    })(),
    FORM_CHECKS.find(c => c.code === "SIGNATURE_CAPTURED")?.wouldNeed ?? "");
  ok("10d. ⚠ AND THE MARK FOR not_checked IS NOT GREEN AND IS NOT A TICK",
    !/emerald|green/.test(JSON.stringify(FORM_CHECK_SWATCH.not_checked)) &&
    FORM_CHECK_SWATCH.not_checked.icon !== FORM_CHECK_SWATCH.pass.icon &&
    FORM_CHECK_SWATCH.not_checked.icon !== "✓",
    JSON.stringify(FORM_CHECK_SWATCH.not_checked));
  ok("10e. every check declares who owns it, and no check is left without an authority",
    FORM_CHECKS.every(c => ["engine", "database", "build", "absent"].includes(c.authority)));
  ok("10f. the database-owned checks are the three the constraints actually own",
    FORM_CHECKS_DATABASE_OWNED.join() === "APPROVAL_LINKED,EFFECTIVE_FROM_SET,CODE_NOT_IN_USE",
    FORM_CHECKS_DATABASE_OWNED.join(" "));
  ok("10g. ⚠ the always-true row is a BUILD fact and is never a configuration one -- it cannot be cleared",
    FORM_CHECKS.find(c => c.code === "NOT_VERIFIED")?.authority === "build" &&
    warm.checks.find(c => c.code === "NOT_VERIFIED")?.state === "pass");

  // ══ 11. THE STATE LADDER AND ITS CLOSED GRAPH ══════════════════════════════════════════════════
  ok("11a. CPR-KS-001 section 3's five states",
    FORM_STATE_CODES.join() === SECTION_3_STATES.join(), FORM_STATE_CODES.join(" "));
  ok("11a-note. ⚠ `in_review`, not `review` -- there is a review_on COLUMN meaning something else entirely",
    FORM_STATE_CODES.includes("in_review") && !FORM_STATE_CODES.includes("review"));
  ok("11b. every transition runs between two states that exist",
    FORM_TRANSITIONS.every(t => FORM_STATE_CODES.includes(t.from) && FORM_STATE_CODES.includes(t.to)),
    FORM_TRANSITIONS.filter(t => !FORM_STATE_CODES.includes(t.to)).map(t => t.to).join(", "));
  ok("11c. ⚠ ARCHIVED IS TERMINAL -- nothing comes back out of it",
    formMovesFrom("archived").length === 0, formMovesFrom("archived").map(t => t.to).join(", "));
  ok("11d. ⚠ A FORM IN USE CANNOT BE EDITED BACK INTO A DRAFT -- the forward path is a new version, because forms were completed against it",
    !formCanMove("published", "draft") && !formCanMove("published", "approved"));
  ok("11e. only a draft is editable, and only the published one can be filled in",
    FORM_STATES_EDITABLE.join() === "draft" && FORM_STATES_USABLE.join() === "published",
    `${FORM_STATES_EDITABLE.join(" ")} | ${FORM_STATES_USABLE.join(" ")}`);
  ok("11e-control. ⚠ AND A DRAFT IS NOT USABLE -- editable and usable are disjoint",
    FORM_STATES.every(s => !(s.editable && s.usable)),
    FORM_STATES.filter(s => s.editable && s.usable).map(s => s.code).join(", "));
  ok("11f. a completed form has three states and abandoned is not submitted",
    FORM_SUBMISSION_STATES.map(s => s.code).join() === "in_progress,submitted,abandoned");
  ok("11g. two subjects and no third, the same decision Phase 2 took",
    FORM_SUBJECT_CODES.join() === "patient,none", FORM_SUBJECT_CODES.join(" "));

  // ══ 12. THE LIBRARY'S FACETS AND THE DECLARED GAPS ═════════════════════════════════════════════
  ok("12a. section 8 asks for eight facets and this offers six",
    FORM_FACETS.length === 8 && FORM_FACETS_LIVE.length === 6,
    `${FORM_FACETS_LIVE.length} live, ${FORM_FACETS_ABSENT.length} declared absent`);
  ok("12b. ⚠ DISEASE AND AGE ARE NOT OFFERED, because nothing behind them exists",
    FORM_FACETS_ABSENT.join() === "disease,age", FORM_FACETS_ABSENT.join(" "));
  ok("12c. and each absent facet says what it would take, rather than being silently missing",
    FORM_FACETS.filter(f => f.state === "absent").every(f => (f.wouldNeed ?? "").trim().length > 30));
  ok("12d. ⚠ the gaps this phase knowingly leaves are declared, each with what would close it",
    FORM_KNOWN_GAPS.length >= 5 &&
    FORM_KNOWN_GAPS.every(g => g.why.trim().length > 60 && g.wouldNeed.trim().length > 40),
    `${FORM_KNOWN_GAPS.length} gaps`);
  ok("12d-b. ⚠ AND THE SIGNATURE GAP IS THE FIRST OF THEM, because it is the one that changes what a consent form is",
    /signature/i.test(FORM_KNOWN_GAPS[0].gap) && /consent/i.test(FORM_KNOWN_GAPS[0].gap),
    FORM_KNOWN_GAPS[0].gap);

  // ══ 13. NO CAPABILITY CODE WAS INVENTED -- ASSERTED AGAINST THE LIVE CATALOGUE ══════════════════
  const { data: caps } = await admin.from("practice_role_capabilities").select("role_code, capability_code").limit(2000);
  const rows = ((caps ?? []) as { role_code: string; capability_code: string }[]);
  const live = new Set(rows.map(c => c.capability_code));
  ok("13a. ⚠ EVERY CAPABILITY THIS MODULE NAMES IS SEEDED IN THE LIVE CATALOGUE",
    FORM_CAPABILITY_CODES.every(c => live.has(c)),
    FORM_CAPABILITY_CODES.filter(c => !live.has(c)).join(", ") || "all present");
  ok("13a-control. and the catalogue read actually returned codes",
    live.size >= 40, `${live.size} codes`);
  ok("13b. ⚠ NOTHING form.* WAS MINTED -- an invented code compiles, 403s for everybody, and errors nowhere",
    ![...live].some(c => c.startsWith("form.")),
    [...live].filter(c => c.startsWith("form.")).join(", "));

  const rolesWith = (code: string) => new Set(rows.filter(r => r.capability_code === code).map(r => r.role_code));
  const authors = rolesWith(FORM_CAPABILITIES.manage);
  const fillers = rolesWith(FORM_CAPABILITIES.fill);
  ok("13c. ⚠ FILLING ONE IN IS A DIFFERENT CAPABILITY FROM AUTHORING ONE",
    String(FORM_CAPABILITIES.fill) !== String(FORM_CAPABILITIES.manage),
    `${FORM_CAPABILITIES.fill} vs ${FORM_CAPABILITIES.manage}`);
  ok("13c-b. ⚠ AND IT IS HELD BY MORE ROLES, so the assistant at the desk can fill one in",
    fillers.size > authors.size && [...authors].every(r => fillers.has(r)),
    `fill=${[...fillers].join(",")} manage=${[...authors].join(",")}`);
  ok("13c-control. and the approximation is DECLARED rather than hidden -- the role table on screen says so",
    FORM_ROLE_REALITY.some(r => r.how.includes(FORM_CAPABILITIES.fill)),
    FORM_ROLE_REALITY.map(r => r.how).join(" | ").slice(0, 200));

  // ══ 14. THE PAGES, AND THE NOTICE ON THE PAPER ═════════════════════════════════════════════════
  ok("14a. the library page exists", existsSync(join(SHELL_DIR, "page.tsx")));
  ok("14b. the form, the completed form and BOTH print views exist",
    existsSync(join(SHELL_DIR, "[formId]", "page.tsx")) &&
    existsSync(join(SHELL_DIR, "[formId]", "print", "page.tsx")) &&
    existsSync(join(SHELL_DIR, "[formId]", "submissions", "[submissionId]", "page.tsx")) &&
    existsSync(join(SHELL_DIR, "[formId]", "submissions", "[submissionId]", "print", "page.tsx")));

  // ⚠ 14c. NO NEW TOP-LEVEL ROUTE. The nav catalogue is not this phase's to edit -- assertion 9f of the
  // activity harness forbids an entry before its page exists, and 9i flags a top-level page with no entry.
  ok("14c. ⚠ NO NEW TOP-LEVEL PRACTICE ROUTE WAS CREATED, so no nav entry is claimed before it is wired",
    !existsSync(join(process.cwd(), "src", "app", "practice", "(shell)", "forms")) &&
    FORM_ROUTE === "/practice/knowledge-studio/forms",
    FORM_ROUTE);

  // ⚠ CHECKED IN THE SOURCE, because a reader of a printed form cannot see a screen banner.
  const blankPrint = readFileSync(join(SHELL_DIR, "[formId]", "print", "page.tsx"), "utf8");
  const recordPrint = readFileSync(join(SHELL_DIR, "[formId]", "submissions", "[submissionId]", "print", "page.tsx"), "utf8");
  ok("14d. ⚠ THE 'NOTHING HERE CHECKS IT' NOTICE IS ON BOTH PRINTED PAGES, not only on screen",
    blankPrint.includes("notVerified.onPaper") && recordPrint.includes("notVerified.onPaper"),
    "onPaper is not referenced by one of the print routes");
  ok("14e. a blank copy of anything not in use prints marked, so a draft cannot be pinned up as the form people use",
    /NOT IN USE/.test(blankPrint));
  ok("14f. an unfinished completed form prints marked too", /NOT FINISHED/.test(recordPrint));
  // ⚠ THREE SEPARATE SENTENCES, ASSERTED SEPARATELY. Phase 2 found one of its own assertions vacuous
  // because a regex matched a NEIGHBOURING branch, so deleting the guarded sentence left it green.
  ok("14g. ⚠ AND THE RECORD NEVER PRINTS A BLANK BESIDE A QUESTION -- three separate sentences for the three ways a question can carry no answer",
    recordPrint.includes('"Not answered."') &&
    recordPrint.includes("this record is not finished") &&
    recordPrint.includes("Did not apply"),
    `closed=${recordPrint.includes('"Not answered."')} open=${recordPrint.includes("this record is not finished")} withdrawn=${recordPrint.includes("Did not apply")}`);
  ok("14h. ⚠ a worked-out answer prints its sentence and not a bare figure",
    /calculationNotice/.test(recordPrint) && /Worked-out answers that are not complete/.test(recordPrint));
  // ⚠ WHITESPACE-COLLAPSED BEFORE MATCHING. JSX wraps prose across lines, and a regex written against
  // the unwrapped sentence passes today and turns red the next time somebody reformats the file --
  // which is the worst kind of assertion, because the rule it guards is still intact.
  const flat = (s: string) => s.replace(/\s+/g, " ");
  ok("14i. ⚠ AND THE COMPLETED-FORM FOOTER SAYS IN FULL THAT IT IS NOT A SIGNATURE AND NOBODY COUNTERSIGNED",
    /no handwritten signature/.test(recordPrint) && /countersigned/.test(recordPrint) &&
    /not that the person this form is about agreed to anything/.test(flat(recordPrint)),
    "the completed-form footer does not say all three things");
  ok("14j. ⚠ the blank copy prints each question's CONDITION and its RANGE, or a paper copy asks everybody everything",
    /Only asked when/.test(blankPrint) && /Between \$\{rules\.min\}|rules\.min !== undefined/.test(blankPrint));

  // ⚠ 14k. THE SCREEN CLEARS IN A HANDLER RATHER THAN IN AN EFFECT.
  ok("14k. the fill-in screen clears in a handler, because set-state-in-effect is an error in this project",
    /useCallback/.test(fillScreen) && !/useEffect/.test(fillScreen),
    "the fill-in screen uses an effect");
  ok("14l. ⚠ AND IT NEVER SENDS A WORKED-OUT ANSWER -- it is derived on both sides and stored on neither",
    /valueKind\) !== "derived"|valueKind !== "derived"/.test(fillScreen),
    "the fill-in screen would post a calculated answer, which the engine refuses by name");

  // ⚠ 14m/14n. THESE TWO EXIST BECAUSE A BREAK TEST FOUND NOTHING TO TURN RED.
  //
  // Reverting the fill-in screen to hand the DRAWN subset to the calculator -- the exact defect that made
  // a total collapse to nought on the server -- broke no assertion at all, because a harness cannot
  // execute a client component and nothing read the source for it. That is the vacuity this project keeps
  // finding, caught on itself. Both facts are now read out of the source, the way 1c-b and 1d are.
  ok("14m. ⚠ THE FILL-IN SCREEN HANDS THE WHOLE AUTHORED FORM TO THE CALCULATOR, NOT THE DRAWN SUBSET -- handing the subset is what makes a total read nought as soon as a condition withdraws one of its inputs",
    /calculatedValues\(fields, values\)/.test(fillScreen) &&
    !/calculatedValues\(drawn/.test(fillScreen),
    "the fill-in screen pre-filters before working out totals, so a withdrawn input reads as a dangling reference");
  // ⚠ THE NEGATIVE HALF IS TESTED AGAINST CODE WITH THE COMMENTS STRIPPED. Written naively it went red on
  // its own explanatory comment, which quotes the defect it forbids -- an assertion that cannot tell a
  // warning about a mistake from the mistake is one that punishes writing the warning down.
  const codeOnly = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
  ok("14n. ⚠ AND IT PRINTS THE ONE SENTENCE rather than assembling a second one out of `missing`, which would render an empty list whenever a total is incomplete because an input was WITHDRAWN",
    /calculationNotice\(x\)/.test(codeOnly(fillScreen)) &&
    !/does not include \$\{x\.missing/.test(codeOnly(fillScreen)),
    "the fill-in screen builds its own incomplete-total sentence");

  // ══ 15. THE BRANCH THE DATABASE CHOSE ══════════════════════════════════════════════════════════
  if (presence.state !== "present") {
    console.log("\n  -- STOPPED CLEANLY AT THE STORE. The absent branch follows. --\n");

    ok("15a. the absent state names EVERY missing table and the migration, rather than failing vaguely",
      presence.state === "absent" && FORM_TABLES.every(t => (presence.detail ?? "").includes(t)),
      presence.detail ?? "");

    const lib = await formLibrary(admin, "00000000-0000-4000-8000-00000000feed");
    ok("15b. ⚠ THE LIBRARY REPORTS `absent`, NOT AN EMPTY SHELF", lib.state === "absent", lib.state);
    ok("15c. ⚠ AND IT DOES NOT RETURN A ROW OF ZEROED COUNTS. A figure of 0 beside 'In use' would be a claim about this practice that nothing here can make",
      lib.counts.length === 0 && lib.items.length === 0, JSON.stringify(lib.counts));
    ok("15d. the facets are still declared, so what the module WILL do is visible before it can do it",
      lib.facets.length === 8 && lib.facets.filter(f => f.state === "absent").length === 2);
    ok("15e. and the not-verified notice is carried on an absent library too",
      lib.notVerified.onPaper.length > 20);

    const created = await createForm(admin, {
      workspaceId: "00000000-0000-4000-8000-00000000feed",
      code: "CONS-01", title: "Probe", kind: "consent", ...base,
    });
    ok("15f. ⚠ A WRITE REFUSES BY NAME WITH 503, rather than throwing a PostgREST error at somebody",
      !created.ok && created.code === "STORE_ABSENT" && created.status === 503,
      created.ok ? "it wrote something" : `${created.status} ${created.code}`);
    ok("15g. and the refusal names the missing migration, so the gap is actionable",
      !created.ok && /migration/i.test(created.message), created.ok ? "" : created.message);

    // ⚠ THE REFUSAL IS THE ENGINE'S OWN AND NOT AN ACCIDENT OF A BAD WORKSPACE ID.
    const badKind = await createForm(admin, {
      workspaceId: "00000000-0000-4000-8000-00000000feed",
      code: "X-01", title: "Probe", kind: "registration", ...base,
    });
    ok("15f-control. ⚠ STORE_ABSENT IS NOT WHAT THIS ENGINE SAYS TO EVERYTHING -- the fourteenth kind is refused as an unknown kind, AHEAD of the store",
      !badKind.ok && badKind.code === "UNKNOWN_KIND" && /settings/i.test(badKind.message),
      badKind.ok ? "accepted" : `${badKind.code}: ${badKind.message}`);
    const badSubject = await createForm(admin, {
      workspaceId: "00000000-0000-4000-8000-00000000feed",
      code: "X-02", title: "Probe", kind: "consent", subject: "room", ...base,
    });
    ok("15f-control-b. and a third kind of subject is refused as an unknown subject, ahead of the store",
      !badSubject.ok && badSubject.code === "UNKNOWN_SUBJECT", badSubject.ok ? "accepted" : badSubject.code);

    const detail = await getForm(admin, "00000000-0000-4000-8000-00000000feed", "00000000-0000-4000-8000-00000000beef");
    ok("15h. reading one form reports absent rather than not-found -- a missing store is not a missing form",
      detail.state === "absent", detail.state);
    const subDetail = await getFormSubmission(admin, "00000000-0000-4000-8000-00000000feed", "00000000-0000-4000-8000-00000000beef");
    ok("15i. and so does reading a completed form", subDetail.state === "absent", subDetail.state);

    console.log("\n  ⚠ NOT RUN, and they are the assertions that matter most once the store lands:");
    console.log("     the author -> approve -> publish -> fill in -> submit loop, the unique-index refusal of");
    console.log("     a second form in use under one reference, the SERVER-SIDE clearing of a withdrawn");
    console.log("     answer, the database's refusal of an answer of spaces, and tenancy.");
    console.log("     They are written below and run automatically the moment the migration is applied.\n");
    return report();
  }

  // ══ 16. THE PRESENT BRANCH: THE WHOLE LOOP ═════════════════════════════════════════════════════
  await cleanup();
  const wsA = await provision(AUTHOR, "HARNESS Forms A (synthetic)", "a");
  const wsB = await provision(OTHER, "HARNESS Forms B (synthetic)", "b");

  // A colleague, because nobody approves their own work.
  await admin.from("practice_membership").insert({
    workspace_id: wsA, user_id: COLLEAGUE, role_code: "practitioner", status: "active",
  });

  const g = await createForm(admin, {
    workspaceId: wsA, code: "RISK-01", title: "Falls risk assessment",
    kind: "risk_assessment", subject: "none", purpose: "Before a clinic list.", tags: ["falls"], ...base,
  });
  ok("16a. a form is created", g.ok, g.ok ? "" : g.message);
  if (!g.ok) return report();

  const { data: seeded } = await admin.from(FORM_FIELD_TABLE).select("id").eq("form_id", g.data.id);
  ok("16b. ⚠ AND IT STARTS WITH NO QUESTIONS. There is no correct starter set for a risk assessment, and inventing one would be this product suggesting what to ask",
    ((seeded ?? []) as unknown[]).length === 0, String(((seeded ?? []) as unknown[]).length));

  const early = await submitFormForApproval(admin, { workspaceId: wsA, formId: g.data.id, assignedTo: COLLEAGUE, ...base });
  ok("16c. an empty form cannot go for approval -- sending one spends the one scarce thing in this loop, which is a colleague's attention",
    !early.ok && early.code === "NO_FIELDS", early.ok ? "sent" : early.code);

  const badType = await updateForm(admin, {
    workspaceId: wsA, formId: g.data.id,
    fields: [{ fieldKey: "sig", label: "Sign here", fieldType: "signature" }], ...base,
  });
  ok("16c-b. ⚠ A QUESTION TYPE THIS BUILD CANNOT STORE IS REFUSED BY THE ENGINE, naming the eleven that exist",
    !badType.ok && badType.code === "UNKNOWN_FIELD_TYPE" && /text, long_text/.test(badType.message),
    badType.ok ? "written" : badType.message);

  const badCondition = await updateForm(admin, {
    workspaceId: wsA, formId: g.data.id,
    fields: [{ fieldKey: "first", label: "First", condition: { when: "second", equals: "x" } },
             { fieldKey: "second", label: "Second" }],
    ...base,
  });
  ok("16d-setup. a form with a forward-pointing condition can be SAVED as a draft", badCondition.ok, badCondition.ok ? "" : badCondition.message);
  const badSubmit = await submitFormForApproval(admin, { workspaceId: wsA, formId: g.data.id, assignedTo: COLLEAGUE, ...base });
  ok("16d. ⚠ BUT IT CANNOT GO FOR APPROVAL -- a condition naming a later question hides it silently, and no reviewer would ever see the question",
    !badSubmit.ok && badSubmit.code === "CONDITIONS_BROKEN", badSubmit.ok ? "sent" : badSubmit.code);

  const dupKeys = await updateForm(admin, {
    workspaceId: wsA, formId: g.data.id,
    fields: [{ fieldKey: "same", label: "One" }, { fieldKey: "same", label: "Two" }], ...base,
  });
  ok("16e. two questions may not share a name, because a condition naming it could not say which one it meant",
    !dupKeys.ok && dupKeys.code === "DUPLICATE_FIELD_KEY", dupKeys.ok ? "written" : dupKeys.code);

  const filled = await updateForm(admin, {
    workspaceId: wsA, formId: g.data.id, effectiveFrom: "2026-09-01", reviewOn: "2027-09-01",
    fields: [
      { fieldKey: "had_fall", label: "Has the person fallen in the last year?", section: "History",
        fieldType: "select", options: [{ value: "yes", label: "Yes" }, { value: "no", label: "No" }] },
      { fieldKey: "fall_count", label: "How many times?", section: "History", fieldType: "number",
        rules: { min: 1, max: 50 }, condition: { when: "had_fall", equals: "yes" } },
      { fieldKey: "mobility", label: "Mobility score", section: "Assessment", fieldType: "number",
        rules: { min: 0, max: 5 } },
      { fieldKey: "total", label: "Total score", section: "Assessment", fieldType: "calculated",
        required: false, rules: { calculate: { of: "sum", fields: ["fall_count", "mobility"] } } },
      { fieldKey: "notes", label: "Anything else", section: "Assessment", fieldType: "long_text", required: false },
    ],
    ...base,
  });
  ok("16f. CONTROL: a well-formed form is written, all five questions of it",
    filled.ok && filled.data.fieldsWritten === 5, filled.ok ? String(filled.data.fieldsWritten) : filled.message);

  const badDates = await updateForm(admin, {
    workspaceId: wsA, formId: g.data.id, effectiveFrom: "2026-09-01", reviewOn: "2026-08-01", ...base,
  });
  ok("16g. ⚠ THE DATABASE REFUSES A REVIEW DATE ON OR BEFORE THE EFFECTIVE DATE, and the constraint is named",
    !badDates.ok && badDates.code === "REVIEW_BEFORE_EFFECT" && /review_after_effect/.test(badDates.message),
    badDates.ok ? "accepted" : badDates.message);

  const tooEarly = await startFormSubmission(admin, { workspaceId: wsA, formId: g.data.id, ...base });
  ok("16h. ⚠ A DRAFT CANNOT BE FILLED IN -- answers given against a form that changes the next morning are answers to questions that no longer exist",
    !tooEarly.ok && tooEarly.code === "NOT_IN_USE", tooEarly.ok ? "started" : tooEarly.code);

  const sent = await submitFormForApproval(admin, { workspaceId: wsA, formId: g.data.id, assignedTo: COLLEAGUE, ...base });
  ok("16i. it goes for approval, through the EXISTING practice_approval_request", sent.ok, sent.ok ? "" : sent.message);
  if (!sent.ok) return report();
  const { data: req } = await admin.from("practice_approval_request").select("subject_kind, subject_id").eq("id", sent.data.approvalId).maybeSingle();
  ok("16i-b. ⚠ AS subject_kind 'other', WHICH MIGRATION 208 ALREADY ADMITS -- no approval migration was needed",
    req?.subject_kind === "other" && req?.subject_id === g.data.id, JSON.stringify(req));

  const frozen = await updateForm(admin, { workspaceId: wsA, formId: g.data.id, title: "Changed", ...base });
  ok("16j. ⚠ THE FORM IS FROZEN WHILE A COLLEAGUE READS IT",
    !frozen.ok && frozen.code === "NOT_EDITABLE", frozen.ok ? "edited" : frozen.code);

  const selfApprove = await decideApproval(admin, {
    workspaceId: wsA, approvalId: sent.data.approvalId, decision: "APPROVED", note: "Fine", ...base,
  });
  ok("16k. ⚠ NOBODY APPROVES THEIR OWN WORK, and the refusal is delegation.ts's rather than a second copy of it here",
    !selfApprove.ok && selfApprove.code === "SELF_APPROVAL", selfApprove.ok ? "approved" : selfApprove.code);

  const approved = await decideApproval(admin, {
    workspaceId: wsA, approvalId: sent.data.approvalId, decision: "APPROVED",
    note: "Reads well.", actorId: COLLEAGUE, correlationId: "harness-forms",
  });
  ok("16l. CONTROL: a colleague can approve it", approved.ok, approved.ok ? "" : approved.message);

  await syncFormApproval(admin, { workspaceId: wsA, formId: g.data.id, ...base });
  const published = await publishForm(admin, { workspaceId: wsA, formId: g.data.id, ...base });
  ok("16m. it goes into use", published.ok, published.ok ? "" : published.message);
  if (!published.ok) return report();

  // ── FILLING IT IN ──────────────────────────────────────────────────────────────────────────────
  const wrongSubject = await startFormSubmission(admin, {
    workspaceId: wsA, formId: g.data.id, patientId: "00000000-0000-4000-8000-00000000dead", ...base,
  });
  ok("16n. ⚠ A FORM THAT IS NOT ABOUT A PATIENT REFUSES ONE -- naming a patient would put a room in somebody's file",
    !wrongSubject.ok && wrongSubject.code === "PATIENT_NOT_ALLOWED", wrongSubject.ok ? "started" : wrongSubject.code);

  const sub = await startFormSubmission(admin, { workspaceId: wsA, formId: g.data.id, contextNote: "Clinic 2", ...base });
  ok("16o. a completed form is started, and it snapshots the version it is answering",
    sub.ok && sub.data.version === 1, sub.ok ? String(sub.data.version) : sub.message);
  if (!sub.ok) return report();

  const outOfRange = await recordAnswers(admin, {
    workspaceId: wsA, submissionId: sub.data.id,
    answers: [{ fieldKey: "mobility", value: 99 }], ...base,
  });
  ok("16p. ⚠ AN ANSWER OUTSIDE ITS RANGE IS REFUSED BY THE ENGINE, before anything is written",
    !outOfRange.ok && outOfRange.code === "OUT_OF_RANGE", outOfRange.ok ? "recorded" : outOfRange.code);

  const notAnOption = await recordAnswers(admin, {
    workspaceId: wsA, submissionId: sub.data.id,
    answers: [{ fieldKey: "had_fall", value: "maybe" }], ...base,
  });
  ok("16p-b. and an answer that is not one of the choices is refused too",
    !notAnOption.ok && notAnOption.code === "NOT_AN_OPTION", notAnOption.ok ? "recorded" : notAnOption.code);

  const calcAnswer = await recordAnswers(admin, {
    workspaceId: wsA, submissionId: sub.data.id,
    answers: [{ fieldKey: "total", value: 99 }], ...base,
  });
  ok("16p-c. ⚠ AND NOBODY MAY ANSWER THE TOTAL -- it is derived, and a stored total is one that can disagree with the answers under it",
    !calcAnswer.ok && calcAnswer.code === "CALCULATED_NOT_ANSWERABLE", calcAnswer.ok ? "recorded" : calcAnswer.code);

  // ⚠ AND THE DATABASE, WITH THE ENGINE BYPASSED ENTIRELY. This is the half that survives somebody
  // deleting the guard above, and it is asserted on the ERROR CODE and the CONSTRAINT NAME.
  const { data: notesField } = await admin.from(FORM_FIELD_TABLE)
    .select("id").eq("form_id", g.data.id).eq("field_key", "notes").maybeSingle();
  const { error: rawBlank } = await admin.from(FORM_ANSWER_TABLE).insert({
    workspace_id: wsA, submission_id: sub.data.id, field_id: notesField?.id, value: "   ",
  });
  ok("16q-db. ⚠ THE CONSTRAINT REFUSES AN ANSWER OF SPACES WITH THE ENGINE BYPASSED -- 23514, by name. This is migration 257's `btrim` correction carried onto a jsonb column",
    String(rawBlank?.code) === "23514" && /practice_form_answer_not_empty/.test(String(rawBlank?.message)),
    rawBlank ? `${rawBlank.code} ${rawBlank.message}` : "the raw insert was ACCEPTED -- a required question could be satisfied with the space bar");
  const { error: rawEmptyList } = await admin.from(FORM_ANSWER_TABLE).insert({
    workspace_id: wsA, submission_id: sub.data.id, field_id: notesField?.id, value: [],
  });
  ok("16q-db-b. and an empty list too, by the same constraint",
    String(rawEmptyList?.code) === "23514" && /practice_form_answer_not_empty/.test(String(rawEmptyList?.message)),
    rawEmptyList ? `${rawEmptyList.code}` : "the raw insert was ACCEPTED");

  const fallYes = await recordAnswers(admin, {
    workspaceId: wsA, submissionId: sub.data.id,
    answers: [{ fieldKey: "had_fall", value: "yes" }, { fieldKey: "fall_count", value: "3" }], ...base,
  });
  ok("16r-setup. with the fall answered Yes, the conditional question applies and its answer is kept",
    fallYes.ok && fallYes.data.written === 2 && fallYes.data.cleared.length === 0,
    fallYes.ok ? JSON.stringify(fallYes.data.cleared) : fallYes.message);
  // ⚠ AND IT WAS STORED AS A NUMBER, not the string "3" the client sent. Otherwise the total adds writing.
  const { data: storedCount } = await admin.from(FORM_ANSWER_TABLE)
    .select("value, field_id").eq("submission_id", sub.data.id);
  const { data: countField } = await admin.from(FORM_FIELD_TABLE)
    .select("id").eq("form_id", g.data.id).eq("field_key", "fall_count").maybeSingle();
  ok("16r-b. ⚠ AND IT IS STORED AS THE NUMBER validateAnswer NORMALISED IT TO, not the string it arrived as",
    ((storedCount ?? []) as { value: unknown; field_id: string }[])
      .find(r => r.field_id === countField?.id)?.value === 3,
    JSON.stringify(storedCount));

  // ⚠ 16s. THE SERVER-SIDE HALF OF THE REGISTRATION LESSON.
  const fallNo = await recordAnswers(admin, {
    workspaceId: wsA, submissionId: sub.data.id,
    answers: [{ fieldKey: "had_fall", value: "no" }], ...base,
  });
  ok("16s. ⚠ CHANGING THE ANSWER WITHDRAWS THE CONDITIONAL QUESTION AND ITS ANSWER IS DELETED ON THE SERVER, not merely hidden on the screen",
    fallNo.ok && fallNo.data.cleared.length === 1,
    fallNo.ok ? JSON.stringify(fallNo.data.cleared) : fallNo.message);
  const { data: leftBehind } = await admin.from(FORM_ANSWER_TABLE)
    .select("field_id").eq("submission_id", sub.data.id).eq("workspace_id", wsA);
  ok("16s-b. ⚠ AND THE ROW IS GONE FROM THE DATABASE -- a stale answer is what makes the screen and the server disagree",
    !((leftBehind ?? []) as { field_id: string }[]).some(r => r.field_id === countField?.id),
    JSON.stringify(leftBehind));

  const stillOpen = await submitFormSubmission(admin, { workspaceId: wsA, submissionId: sub.data.id, ...base });
  ok("16t. an unanswered required question stops the form being submitted, and it is named",
    !stillOpen.ok && stillOpen.code === "ANSWERS_OUTSTANDING" && /Mobility score/.test(stillOpen.message),
    stillOpen.ok ? "submitted" : stillOpen.message);

  await recordAnswers(admin, {
    workspaceId: wsA, submissionId: sub.data.id, answers: [{ fieldKey: "mobility", value: 4 }], ...base,
  });
  const closed = await submitFormSubmission(admin, { workspaceId: wsA, submissionId: sub.data.id, ...base });
  ok("16u. ⚠ IT SUBMITS, AND THE TOTAL THAT COULD NOT USE ALL OF ITS INPUTS IS NAMED RATHER THAN QUIETLY PRINTED",
    closed.ok && closed.data.incompleteTotals.join() === "total",
    closed.ok ? JSON.stringify(closed.data) : closed.message);

  const readBack = await getFormSubmission(admin, wsA, sub.data.id);
  // ⚠ THIS ASSERTION CAUGHT A REAL DEFECT AND HAS BEEN MADE STRICTER RATHER THAN RELAXED.
  //
  // It first read `missing.join() === "fall_count"`, and the engine returned value 0 with the reason
  // "it names fall_count, which is not a question on this form" -- about a question plainly on the form.
  // Two engine bugs: references were resolved against the DRAWN questions rather than the authored ones,
  // and a withdrawn input had nowhere to go but `missing`. Both are fixed, and this now pins all three
  // facts separately: the figure, the fact that the withdrawn input is WITHHELD and not MISSING, and the
  // sentence -- which must not tell somebody to go and answer a question that is not on their screen.
  const total = readBack.completeness?.calculated.find(c => c.field_key === "total");
  ok("16u-b. ⚠ THE TOTAL READS AS 4, NOT 7 AND NOT 0 -- the withdrawn input is excluded, and it is named as WITHHELD rather than as missing",
    total?.value === 4 && total?.counted.join() === "mobility" &&
    total?.withheld.join() === "fall_count" && total?.missing.length === 0 &&
    total?.problem === null && total?.complete === false,
    JSON.stringify(readBack.completeness?.calculated));
  ok("16u-c. ⚠ AND THE SENTENCE SAYS IT DID NOT APPLY, NOT THAT IT IS MISSING -- a practitioner sent to answer a question that is not on the screen is the unactionable refusal this whole pattern exists to prevent",
    total !== undefined && /did not apply/.test(calculationNotice(total)) &&
    !/no usable answer/.test(calculationNotice(total)) && !/nought/.test(calculationNotice(total)),
    total ? calculationNotice(total) : "no total");

  const afterClose = await recordAnswers(admin, {
    workspaceId: wsA, submissionId: sub.data.id, answers: [{ fieldKey: "mobility", value: 1 }], ...base,
  });
  ok("16v. ⚠ A SUBMITTED FORM CANNOT BE CHANGED -- altering it afterwards would make it a record of something else",
    !afterClose.ok && afterClose.code === "SUBMISSION_CLOSED", afterClose.ok ? "changed" : afterClose.code);

  // ⚠ THIS ASSERTION USED TO CLAIM THE REASON IS CHECKED "BEFORE THE STATE IS EVEN CONSIDERED", WHICH IS
  // AN ORDERING THE ENGINE NEVER HAD AND SHOULD NOT HAVE. A submitted form cannot be abandoned whatever
  // reason you give it, and SUBMISSION_CLOSED is the more useful thing to be told. The blank-reason
  // refusal is a real rule and is now tested where it can actually fire -- on an OPEN form, at 16w-c.
  const abandonClosed = await abandonFormSubmission(admin, { workspaceId: wsA, submissionId: sub.data.id, reason: "changed my mind", ...base });
  ok("16v-b. ⚠ AND A SUBMITTED FORM CANNOT BE ABANDONED EITHER, whatever reason is given -- the state is the refusal, not the words",
    !abandonClosed.ok && abandonClosed.code === "SUBMISSION_CLOSED",
    abandonClosed.ok ? "abandoned" : abandonClosed.code);

  // ── AN ANSWER SOMEBODY ERASES ON PURPOSE ───────────────────────────────────────────────────────
  const sub2 = await startFormSubmission(admin, { workspaceId: wsA, formId: g.data.id, ...base });
  ok("16w-setup. a second completed form is started", sub2.ok, sub2.ok ? "" : sub2.message);
  if (!sub2.ok) return report();
  await recordAnswers(admin, { workspaceId: wsA, submissionId: sub2.data.id, answers: [{ fieldKey: "mobility", value: 2 }], ...base });
  const erased = await recordAnswers(admin, {
    workspaceId: wsA, submissionId: sub2.data.id, answers: [{ fieldKey: "mobility", value: "" }], ...base,
  });
  ok("16w. ⚠ EMPTYING A BOX IS AN ERASURE, NOT A VALIDATION FAILURE -- refusing it would leave a wrong answer in the record because the person could not take it out",
    erased.ok && erased.data.completeness.outstanding.some(f => f.field_key === "mobility"),
    erased.ok ? JSON.stringify(erased.data.completeness.outstanding.map(f => f.field_key)) : erased.message);
  ok("16w-b. ⚠ AND AN ERASURE IS NOT REPORTED AS \"cleared\" -- somebody who emptied a box themselves does not need to be told their answer was removed",
    erased.ok && erased.data.cleared.length === 0,
    erased.ok ? JSON.stringify(erased.data.cleared) : "");

  // ⚠ THE BLANK-REASON REFUSAL, TESTED WHERE IT CAN ACTUALLY FIRE -- on a form that is still open.
  const abandonNoReason = await abandonFormSubmission(admin, { workspaceId: wsA, submissionId: sub2.data.id, reason: "  ", ...base });
  ok("16w-c. ⚠ AN OPEN FORM CANNOT BE ABANDONED WITHOUT A REASON -- a record that stops half way with no word about why tells the next person nothing",
    !abandonNoReason.ok && abandonNoReason.code === "REASON_REQUIRED",
    abandonNoReason.ok ? "abandoned" : abandonNoReason.code);

  // ── AN ANSWER WRITTEN DIRECTLY, BYPASSING THE VALIDATOR ────────────────────────────────────────
  //
  // ⚠ THE REQUIRED QUESTION IS ANSWERED FIRST, ON PURPOSE. Without it ANSWERS_OUTSTANDING fires and 16x
  // never reaches the rule it is about -- which is exactly what it did on the first run against a real
  // store. An assertion that cannot reach its own subject is worth no more than no assertion.
  const preFill = await recordAnswers(admin, {
    workspaceId: wsA, submissionId: sub2.data.id, answers: [{ fieldKey: "had_fall", value: "no" }], ...base,
  });
  ok("16x-setup-a. the required question is answered, so nothing is outstanding when 16x runs",
    preFill.ok && preFill.data.completeness.outstanding.every(f => f.field_key !== "had_fall"),
    preFill.ok ? JSON.stringify(preFill.data.completeness.outstanding.map(f => f.field_key)) : preFill.message);
  const { data: mobilityField } = await admin.from(FORM_FIELD_TABLE)
    .select("id").eq("form_id", g.data.id).eq("field_key", "mobility").maybeSingle();
  const { error: rawBad } = await admin.from(FORM_ANSWER_TABLE).insert({
    workspace_id: wsA, submission_id: sub2.data.id, field_id: mobilityField?.id, value: "abc",
  });
  ok("16x-setup. a direct write CAN put a non-number into a number question -- the database cannot see the question's type",
    !rawBad, rawBad ? String(rawBad.message) : "");
  const invalidSubmit = await submitFormSubmission(admin, { workspaceId: wsA, submissionId: sub2.data.id, ...base });
  ok("16x. ⚠ AND THE ENGINE REFUSES TO SUBMIT OVER IT, naming the answer rather than failing vaguely",
    !invalidSubmit.ok && invalidSubmit.code === "ANSWERS_INVALID" && /Mobility score/.test(invalidSubmit.message),
    invalidSubmit.ok ? "submitted" : invalidSubmit.message);
  await abandonFormSubmission(admin, { workspaceId: wsA, submissionId: sub2.data.id, reason: "harness", ...base });

  // ── ONE REFERENCE, ONE FORM IN USE ─────────────────────────────────────────────────────────────
  //
  // ⚠ NO `if (…ok)` WRAPPER. Each setup step is asserted in its own right and the run stops if one
  // fails: a skipped assertion reads exactly like a passing one in a total.
  const g2 = await createForm(admin, { workspaceId: wsA, code: "RISK-01", title: "A rival", kind: "risk_assessment", ...base });
  ok("16y-setup. a second draft may hold the SAME reference -- the index constrains published rows only",
    g2.ok, g2.ok ? "" : g2.message);
  if (!g2.ok) return report();
  await updateForm(admin, {
    workspaceId: wsA, formId: g2.data.id, effectiveFrom: "2026-09-01",
    fields: [{ fieldKey: "one_thing", label: "One thing" }], ...base,
  });
  const s2 = await submitFormForApproval(admin, { workspaceId: wsA, formId: g2.data.id, assignedTo: COLLEAGUE, ...base });
  ok("16y-setup-b. and it goes through the same approval as any other", s2.ok, s2.ok ? "" : s2.message);
  if (!s2.ok) return report();
  await decideApproval(admin, { workspaceId: wsA, approvalId: s2.data.approvalId, decision: "APPROVED", note: "ok", actorId: COLLEAGUE, correlationId: "harness-forms" });
  const rivalSync = await syncFormApproval(admin, { workspaceId: wsA, formId: g2.data.id, ...base });
  ok("16y-setup-c. and reaches `approved`, so 16y tests the INDEX and not an earlier refusal",
    rivalSync.ok && rivalSync.data.status === "approved", rivalSync.ok ? rivalSync.data.status : rivalSync.message);

  const clash = await publishForm(admin, { workspaceId: wsA, formId: g2.data.id, ...base });
  ok("16y. ⚠ ONE REFERENCE, ONE FORM IN USE -- refused by the INDEX, which this engine deliberately does not pre-check",
    !clash.ok && clash.code === "CODE_IN_USE" && /ux_practice_form_published_code/.test(clash.message),
    clash.ok ? "both published" : `${clash.code}: ${clash.message}`);

  // ── REVISION, AND THE RECORDS THAT SURVIVE IT ──────────────────────────────────────────────────
  const revised = await reviseForm(admin, { workspaceId: wsA, formId: g.data.id, ...base });
  ok("16z. a form in use can be revised into a new draft at version 2, carrying its questions forward",
    revised.ok && revised.data.version === 2, revised.ok ? "" : revised.message);
  if (!revised.ok) return report();
  const { data: copiedFields } = await admin.from(FORM_FIELD_TABLE)
    .select("field_key, field_type, rules").eq("form_id", revised.data.id);
  const copied = (copiedFields ?? []) as { field_key: string; field_type: string; rules: { calculate?: { of?: string } } | null }[];
  ok("16z-b. all five questions came across, with their rules and their calculation intact",
    copied.length === 5 && copied.find(f => f.field_key === "total")?.rules?.calculate?.of === "sum",
    JSON.stringify(copied.map(f => f.field_key)));
  const again = await reviseForm(admin, { workspaceId: wsA, formId: g.data.id, ...base });
  ok("16z-c. and only one revision may be open at a time",
    !again.ok && again.code === "REVISION_OPEN", again.ok ? "two opened" : again.code);

  const withdrawn2 = await archiveForm(admin, { workspaceId: wsA, formId: g.data.id, reason: "found to be wrong", ...base });
  ok("17a. withdrawing it reports how many forms were left part-finished, rather than submitting them for somebody",
    withdrawn2.ok && typeof withdrawn2.data.openSubmissions === "number",
    withdrawn2.ok ? String(withdrawn2.data.openSubmissions) : withdrawn2.message);
  const { data: survivingSub } = await admin.from(FORM_SUBMISSION_TABLE)
    .select("id, status").eq("id", sub.data.id).maybeSingle();
  ok("17a-b. ⚠ AND THE COMPLETED FORM SURVIVES THE WITHDRAWAL EXACTLY AS IT WAS",
    survivingSub?.status === "submitted", JSON.stringify(survivingSub));

  // ⚠ 17b-move. THE ASSERTION BELOW USED TO TRY TO ARCHIVE g2 STRAIGHT FROM `approved` AND WAS WRONG
  // ABOUT THE LADDER. There is deliberately no approved -> archived move: `archived` means withdrawn or
  // superseded, which describes something that was in force, and a form approved but never published
  // never was. The route is re-open (which VOIDS the approval, as it should, because nobody is standing
  // behind it any more) and then abandon the draft -- so a practice never has to put a form into use in
  // order to get rid of it. That is the product being right, so what is pinned here is the refusal AND
  // the fact that it names the route out.
  const directArchive = await archiveForm(admin, { workspaceId: wsA, formId: g2.data.id, reason: "decided against it", ...base });
  ok("17b-move. ⚠ AN APPROVED FORM CANNOT BE ARCHIVED DIRECTLY, and the refusal NAMES the way out rather than leaving somebody stuck",
    !directArchive.ok && directArchive.code === "MOVE_NOT_ALLOWED" &&
    /Re-open for editing/.test(directArchive.message),
    directArchive.ok ? "archived" : directArchive.message);
  ok("17b-move-b. ⚠ AND THE REFUSAL IS WRITTEN IN ENGLISH -- it said \"a approved form\" until a run against a real store put it on screen",
    !directArchive.ok && /an approved form/.test(directArchive.message) && !/a approved/.test(directArchive.message),
    directArchive.ok ? "" : directArchive.message);

  const reopened = await withdrawFormFromReview(admin, { workspaceId: wsA, formId: g2.data.id, ...base });
  ok("17b-setup. CONTROL: re-opening it back to a draft is allowed, which is the route the refusal named",
    reopened.ok && reopened.data.status === "draft", reopened.ok ? "" : reopened.message);
  const noReason = await archiveForm(admin, { workspaceId: wsA, formId: g2.data.id, reason: "   ", ...base });
  ok("17b. ⚠ THE ENGINE refuses a withdrawal with no reason, in a sentence rather than a constraint name",
    !noReason.ok && noReason.code === "REASON_REQUIRED" && !/practice_form_archived_reason/.test(noReason.message),
    noReason.ok ? "archived" : `${noReason.code}: ${noReason.message}`);
  const { error: rawArchive } = await admin.from(FORM_TABLE)
    .update({ status: "archived", archived_at: new Date().toISOString(), archived_reason: "   " })
    .eq("id", g2.data.id).eq("workspace_id", wsA);
  // ⚠ THE PHASE 1 CORRECTION, APPLIED THE FIRST TIME. Migration 256 wrote `is not null` and accepted a
  // blank string. This DDL is written with btrim -- and the two refusals carry DIFFERENT CODES so a
  // harness can tell which layer said no.
  ok("17b-db. ⚠ AND THE CONSTRAINT REFUSES A BLANK REASON TOO, because it is written with btrim rather than `is not null`",
    String(rawArchive?.code) === "23514" && /practice_form_archived_reason/.test(String(rawArchive?.message)),
    rawArchive ? `${rawArchive.code} ${rawArchive.message}` : "the raw update was ACCEPTED -- the DDL shipped migration 256's mistake");

  // ── TENANCY, NON-VACUOUSLY ─────────────────────────────────────────────────────────────────────
  const crossRead = await getForm(admin, wsB, g.data.id);
  ok("18a. ⚠ ANOTHER PRACTICE CANNOT READ THIS FORM", crossRead.state === "not_found", crossRead.state);
  const crossWrite = await updateForm(admin, { workspaceId: wsB, formId: g.data.id, title: "Theirs now", ...base });
  ok("18b. nor edit it", !crossWrite.ok && crossWrite.code === "NOT_FOUND", crossWrite.ok ? "edited" : crossWrite.code);
  const crossSub = await getFormSubmission(admin, wsB, sub.data.id);
  ok("18c. nor read a form completed in it", crossSub.state === "not_found", crossSub.state);
  const ownRead = await getForm(admin, wsA, g.data.id);
  ok("18a-control. CONTROL: its own practice CAN read it, so 18a is not passing on a broken id",
    ownRead.state === "ok", ownRead.state);

  const libA = await formLibrary(admin, wsA);
  const libB = await formLibrary(admin, wsB);
  ok("18d. the library is workspace-scoped, and the other practice's is genuinely empty rather than failed",
    libA.state === "ok" && libB.state === "ok" && libA.items.length > 0 && libB.items.length === 0,
    `${libA.items.length} / ${libB.items.length}`);
  // ⚠ THE LENGTH IS ASSERTED TOO. `[].every()` is TRUE, so a counts assertion without it passes
  // unconditionally while the store is absent -- the exact shape of the vacuous assertions found here.
  ok("18e. every count on the library opens a list, and there are five of them",
    libA.counts.length === 5 && libA.counts.every(c => c.href.startsWith(FORM_ROUTE)),
    `${libA.counts.length} counts`);
  const inUse = libA.counts.find(c => c.key === "published")?.total ?? -1;
  ok("18e-b. and the figure equals the number of rows the filter it carries returns",
    inUse === libA.items.filter(i => i.status === "published").length, `${inUse} claimed`);
  ok("18f. a question count on a library row is a number that was READ, and null rather than 0 when it could not be",
    libA.items.every(i => i.fieldCount === null || typeof i.fieldCount === "number"),
    JSON.stringify(libA.items.map(i => i.fieldCount)));

  const dead = await withdrawFormFromReview(admin, { workspaceId: wsA, formId: g.data.id, ...base });
  ok("18g. an archived form cannot be moved anywhere, and the refusal says so",
    !dead.ok && dead.code === "MOVE_NOT_ALLOWED", dead.ok ? "moved" : dead.code);

  // ── THE PAYLOAD THAT CROSSES TO THE CLIENT ─────────────────────────────────────────────────────
  //
  // ⚠ WALKED, NOT ASSUMED. A function on a payload passed to a client component compiles, passes tsc and
  // eslint, and kills the page at runtime. This codebase has been bitten by it once.
  const walk = (v: unknown, path: string, found: string[]) => {
    if (typeof v === "function") { found.push(path); return; }
    if (v && typeof v === "object") {
      for (const [k, x] of Object.entries(v as Record<string, unknown>)) walk(x, `${path}.${k}`, found);
    }
  };
  const funcs: string[] = [];
  walk(readBack, "submission", funcs);
  walk(ownRead, "form", funcs);
  walk(libA, "library", funcs);
  ok("18h. ⚠ NOTHING ON ANY CLIENT PAYLOAD IS A FUNCTION",
    funcs.length === 0, funcs.join(", "));

  // ── THE AUDIT TRAIL, SCOPED TO THIS RUN ────────────────────────────────────────────────────────
  //
  // ⚠ SCOPED BY correlation_id, NOT COUNTED. practice_audit_event has been append-only since migration
  // 247, so every harness's delete has been a silent no-op and rows accumulate across runs.
  const { data: events } = await admin.from("practice_audit_event")
    .select("event_type").eq("workspace_id", wsA).eq("correlation_id", "harness-forms");
  const types = new Set(((events ?? []) as { event_type: string }[]).map(e => e.event_type));
  ok("18i. the whole loop left an audit trail, and submitting a form is on it",
    types.has("practice.form_created") && types.has("practice.form_published") &&
    types.has("practice.form_submitted"),
    [...types].join(" "));

  await cleanup();
  return report();
}

main().catch(e => { console.error(e); process.exit(1); });
