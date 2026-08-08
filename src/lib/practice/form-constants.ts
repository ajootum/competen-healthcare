import {
  PRACTICE_FIELD_TYPES, PRACTICE_FIELD_TYPE_CODES, REGISTRATION_FIELD_TYPE_CODES,
  FORM_ONLY_FIELD_TYPE_CODES, CALCULATIONS, fieldType, fieldTypeLabel,
} from "@/lib/practice/form-field";

// ────────────────────────────────────────────────────────────────────────────────────────────────────
// CPR-KS-001 PHASE 3 -- PRACTICE FORMS. The constants half.
//
// CPR-KS-001 section 4 is the "Intelligent Forms Engine": fourteen kinds of form, fifteen components,
// five classes of validation and four outputs. This file is that vocabulary, plus the four things the
// specification does NOT say and this build must: which of the fourteen kinds this engine may offer, what
// a completed form actually is, which of the fifteen components have nothing behind them, and the one
// sentence that has to be on every form and every printed copy of one.
//
// ---- ⚠ THE NAME, AND IT IS PHASE 1 AND PHASE 2's RULING APPLIED AGAIN ------------------------------
//
// This module is called PRACTICE FORMS and a filled-in one is a COMPLETED FORM. Not a "forms engine" in
// front of a practitioner, not a "designer", not a "builder", not a "studio". NAME THE ASSET FOR WHAT IT
// PRODUCES. A tool named for what it appears to do makes its claim before anybody authors anything.
//
// ---- ⚠ AND THE SHARPER ONE FOR THIS PHASE: THE CONSENT FORM -----------------------------------------
//
// Section 4 lists "Consent forms" among the fourteen and lists "Signature" and "Drawing" among the
// fifteen components. THIS BUILD HAS NEITHER, and the two facts together are the most dangerous thing
// this phase could ship quietly. A completed consent form in a clinical system, with a patient's name at
// the top and answers underneath, reads to everybody who opens it as evidence that the patient consented.
// It is not. It is a record that somebody with a practice login typed answers into a screen. Nothing
// captured a mark, nothing re-checked who was at the keyboard, and nobody countersigned.
//
// So `consent` IS offered -- a practice that wants to record a consent conversation should be able to,
// and refusing the whole kind would just push it into a Word document nobody can search -- and
// FORM_NOT_VERIFIED says exactly what it is, on the form, on the screen while it is being filled in, on
// the completed record and on the paper. SIGNATURE_CAPTURED is a readiness row that is permanently
// `not_checked`, in the idiom publish-constants.ts established. Never a green tick, never silence.
//
// ---- CAPABILITIES: NOTHING MINTED, AND THE SAME THREE AS PHASE 2 ------------------------------------
//
// Probed live 2026-08-08 against practice_role_capabilities: 50 distinct codes, no `form.*`, no
// `knowledge.*` and no `checklist.*` among them.
//
//   view      document.view   -- migration 210's rule. Held by practitioner and practice_assistant.
//   manage    template.manage -- authoring. Held by practice_owner and practitioner.
//   fill      task.manage     -- ⚠ AN APPROXIMATION, DECLARED RATHER THAN HIDDEN, and it is Phase 2's
//                                approximation taken again for the same reason: filling a form in is not
//                                authoring it, and the assistant at the desk has to be able to do the
//                                first without the second. task.manage is held by all three practice
//                                roles. THE HONEST CONSEQUENCE: anybody who can close a task can fill in
//                                a form, including a consent form. A dedicated `form.fill` is a
//                                migration, and minting one that is not seeded would 403 for every user
//                                including the practice owner while erroring nowhere -- six invented
//                                codes have shipped in this product exactly that way.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * ⚠ EVERY CAPABILITY CODE THIS MODULE NAMES, AS AN EXPORTED ARRAY.
 *
 * Same reason checklist-constants.ts, knowledge-constants.ts and publish-constants.ts export theirs: a
 * code reached only through an object literal is invisible to the audit harness's literal scanner.
 */
export const FORM_CAPABILITY_CODES: string[] = ["document.view", "template.manage", "task.manage"];

export const FORM_CAPABILITIES = {
  /** Find and read a form and the forms completed against it. */
  view: "document.view",
  /** Write one, send it for approval, publish it, withdraw it. */
  manage: "template.manage",
  /** ⚠ Fill one in. An approximation -- see the header. */
  fill: "task.manage",
} as const;

export const FORM_MODULE_NAME = "Practice Forms";
export const FORM_LIBRARY_NAME = "Form Library";
/** What a filled-in form is called. Never a verification, an assurance, a sign-off or a consent. */
export const FORM_SUBMISSION_NAME = "completed form";
export const FORM_ROUTE = "/practice/knowledge-studio/forms";

/**
 * ⚠ THE SENTENCE THAT MUST APPEAR ON EVERY FORM AND EVERY COMPLETED FORM, ON SCREEN AND ON PAPER.
 *
 * Two claims are being refused at once, and the second is the one this phase adds to Phase 2's.
 *
 *   1. Nothing here checks an answer. The same refusal a checklist makes about a tick.
 *   2. ⚠ NOTHING ON THE PAGE IS A SIGNATURE. There is no handwritten mark, no drawing, no fresh identity
 *      check at the moment of completion, and no second person. A completed consent form is therefore a
 *      record that somebody typed answers, and saying so on the paper is the whole difference between an
 *      honest record and a document that will be produced one day as though it were more.
 */
export const FORM_NOT_VERIFIED = {
  headline: "A form records what somebody entered. Nothing here checks it, and nothing on it is a signature.",
  detail:
    "Competen Practice stores the answers entered on this form, who entered them and when. It does not check an answer against any other record, does not observe anything the answer describes, and does not chase a form nobody filled in. No answer on it is a signature: nothing here captures a handwritten mark, and nothing re-checks who is at the keyboard at the moment a form is completed. A completed form is a statement by the person who completed it, and it is kept as one.",
  /** The one line that fits on printed paper, where there is no room for the paragraph. */
  onPaper:
    "A record of what was entered, by whom. Nothing on this page is a signature and nothing here was checked.",
} as const;

/**
 * ⚠ WORDS THIS MODULE MAY NEVER PUT IN FRONT OF A PRACTITIONER, and the harness asserts every exported
 * sentence against them.
 *
 * Phase 2's twelve, plus two this phase has to add because a form invites them. "Legally binding" is what
 * somebody would eventually write about a consent form. "Witnessed" claims a second person that no row
 * here holds.
 *
 * ⚠ NOTE WHAT IS NOT ON THE LIST AND WHY. "Validated" is absent deliberately: this engine really does run
 * validation rules, and a rule about ranges and lengths genuinely is enforced, so forbidding the word
 * would push honest sentences off the screen. The list is claims this build cannot support, not words
 * that sound strong.
 */
export const FORM_FORBIDDEN_CLAIMS: string[] = [
  "verified", "verifies", "assured", "assurance", "compliant", "compliance",
  "certified", "signed off", "sign-off", "guarantees", "guaranteed", "proves",
  "legally binding", "witnessed",
];

// ── THE KINDS OF FORM (CPR-KS-001 section 4, "Types") ───────────────────────────────────────────────
//
// ⚠ SECTION 4 NAMES FOURTEEN AND THIS OFFERS THIRTEEN. The one left out is REGISTRATION FORMS, and it is
// left out on purpose rather than forgotten -- see FORM_TYPE_NOT_OFFERED below. Offering it here would
// give this product two things called the registration form, one of which the registration desk would
// never see.
//
// ⚠ THE THIRTEEN ARE A CHECK CONSTRAINT ON practice_form.form_type. A fourteenth kind is a migration
// BEFORE the UI offers it, never after: a studio that lets somebody invent a kind produces rows the
// DATABASE rejects, and no amount of front-end work fixes it.

export type FormTypeDefinition = {
  code: string;
  label: string;
  /** What distinguishes it from the twelve beside it, in a practitioner's words. */
  meaning: string;
  /** Whether a completed one is normally about one patient. Advisory -- the author chooses. */
  usuallyAboutAPatient: boolean;
};

export const FORM_TYPES: FormTypeDefinition[] = [
  { code: "clinical_assessment", label: "Clinical assessment form", usuallyAboutAPatient: true,
    meaning: "What is asked and looked at in a structured assessment, so the same things are covered whoever does it." },
  { code: "referral", label: "Referral form", usuallyAboutAPatient: true,
    meaning: "What another service needs to know before it can accept somebody." },
  { code: "consent", label: "Consent form", usuallyAboutAPatient: true,
    meaning: "A record of what was explained and what the person said. ⚠ It carries no signature and nothing here checks who typed it, so it is a record of a conversation rather than evidence that anybody agreed to anything." },
  { code: "procedure", label: "Procedure form", usuallyAboutAPatient: true,
    meaning: "What is recorded about one procedure -- findings, what was used, what happened." },
  { code: "audit", label: "Audit form", usuallyAboutAPatient: false,
    meaning: "What is being looked for when a sample of records or of practice is reviewed." },
  { code: "research", label: "Research form", usuallyAboutAPatient: true,
    meaning: "Structured data collection for a study. ⚠ Nothing here anonymises anything, and a completed one sits inside the practice like any other record." },
  { code: "questionnaire", label: "Questionnaire", usuallyAboutAPatient: true,
    meaning: "A set of questions put to somebody, where the answers are the point rather than a summary of them." },
  { code: "patient_survey", label: "Patient survey", usuallyAboutAPatient: false,
    meaning: "What patients are asked about the service. Usually not attached to a person, so that answers can be given freely." },
  { code: "risk_assessment", label: "Risk assessment", usuallyAboutAPatient: false,
    meaning: "What is checked when a risk is being weighed up, and what was decided about it." },
  { code: "inspection", label: "Inspection form", usuallyAboutAPatient: false,
    meaning: "What an inspection records about a room, a machine or a process." },
  { code: "incident", label: "Incident report", usuallyAboutAPatient: false,
    meaning: "What happened, when, and what was done about it. ⚠ Nothing here notifies anybody that one was filed." },
  { code: "teaching", label: "Teaching form", usuallyAboutAPatient: false,
    meaning: "What is recorded about teaching -- a session, an observation, a piece of feedback." },
  { code: "custom", label: "Custom form", usuallyAboutAPatient: false,
    meaning: "Something the practice needs that none of the twelve above describes." },
];

export const FORM_TYPE_CODES: string[] = FORM_TYPES.map(t => t.code);
export const formType = (code: string) => FORM_TYPES.find(t => t.code === code) ?? null;
export const formTypeLabel = (code: string) => formType(code)?.label ?? code;

/**
 * ⚠ THE FOURTEENTH KIND, AND WHY IT IS NOT HERE.
 *
 * Declared rather than quietly dropped. A gap recorded only in a commit message is one the next person
 * rediscovers as a bug -- or, worse, closes by adding the kind and producing exactly the collision this
 * refusal exists to prevent.
 */
export const FORM_TYPE_NOT_OFFERED = {
  code: "registration",
  label: "Registration forms",
  why: "This product already has a patient registration form, and it is a different object with different rules. It is one form per practice, it is resolved automatically for every registration by specialty and country, its answers are written onto the patient record rather than kept as a separate completed form, and it enforces a floor -- a name, an age and a way of making contact -- that no configuration may lower. A second thing called the registration form, which the registration desk would never see, is a support call waiting to happen.",
  whereItLives: "/practice/settings/registration-form",
} as const;

// ── WHAT ONE COMPLETED FORM IS ABOUT ────────────────────────────────────────────────────────────────
//
// ⚠ TWO VALUES AND NOT THREE, and this is Phase 2's decision taken again rather than re-argued. An
// optional-patient kind means half a practice's consent forms name somebody and half do not, and nothing
// can then tell a deliberate omission from a forgotten one.
//
// ⚠ THE MATCH IS THE ENGINE'S RULE, NOT A CONSTRAINT. `subject` is on the form and the patient is on the
// completed one, and a CHECK cannot see a sibling table. Copied from Phase 2 rather than imported from
// it, for the reason Phase 2 gave about its own copy from Phase 1: the two live in different tables with
// different CHECK constraints, and a shared TypeScript vocabulary over two independent database enums is
// a shared thing that only looks shared.

export const FORM_SUBJECTS: { code: string; label: string; meaning: string }[] = [
  { code: "patient", label: "About one patient",
    meaning: "Every completed form names the patient it was filled in for, and the engine refuses one that does not." },
  { code: "none", label: "Not about a patient",
    meaning: "A room, a machine, a service or a process. No patient is recorded on it, and none may be." },
];
export const FORM_SUBJECT_CODES: string[] = FORM_SUBJECTS.map(s => s.code);
export const formSubject = (code: string) => FORM_SUBJECTS.find(s => s.code === code) ?? null;

// ── THE FIVE STATES OF A FORM (CPR-KS-001 section 3, "Version Engine") ──────────────────────────────
//
// ⚠ `in_review`, NOT `review`. There is a `review_on` COLUMN on the same row meaning something else --
// the date this form next has to be looked at.

export type FormStateDefinition = {
  code: string; label: string; meaning: string;
  /** Can its questions be edited in this state? */
  editable: boolean;
  /** May somebody fill it in? */
  usable: boolean;
};

export const FORM_STATES: FormStateDefinition[] = [
  { code: "draft", label: "Draft", editable: true, usable: false,
    meaning: "Being written. Nobody may fill it in, because answers given against a form that changed afterwards record nothing anybody can rely on." },
  { code: "in_review", label: "In review", editable: false, usable: false,
    meaning: "With a colleague for a decision. Frozen while they read it -- a form that changes under a reviewer is not the one they approved." },
  { code: "approved", label: "Approved", editable: false, usable: false,
    meaning: "A colleague has approved it and it is not yet in use. Publishing is a separate, deliberate act with a date on it." },
  { code: "published", label: "In use", editable: false, usable: true,
    meaning: "In force from its effective date. This is the version people fill in, and the only one they can." },
  { code: "archived", label: "Archived", editable: false, usable: false,
    meaning: "Withdrawn or superseded. Kept and readable, and every form completed against it is kept exactly as it was." },
];

export const FORM_STATE_CODES: string[] = FORM_STATES.map(s => s.code);
export const formState = (code: string) => FORM_STATES.find(s => s.code === code) ?? null;
export const FORM_STATES_EDITABLE: string[] = FORM_STATES.filter(s => s.editable).map(s => s.code);
export const FORM_STATES_USABLE: string[] = FORM_STATES.filter(s => s.usable).map(s => s.code);

/**
 * ⚠ THE ONLY MOVES THAT EXIST. Anything not listed is refused by name, not by falling through.
 *
 * There is no `published -> draft` and no way out of `archived`. A published form has COMPLETED FORMS
 * against it, and editing it would retrospectively change what somebody was asked.
 */
export const FORM_TRANSITIONS: { from: string; to: string; label: string; why: string }[] = [
  { from: "draft", to: "in_review", label: "Send for approval",
    why: "Creates a practice_approval_request and freezes the questions while a colleague reads them." },
  { from: "in_review", to: "draft", label: "Withdraw from review",
    why: "The author takes it back. The approval request is withdrawn with it, so no decision is left pending on a form nobody is waiting on." },
  { from: "in_review", to: "approved", label: "Record the approval",
    why: "Follows the decision on the approval request. ⚠ This engine does not decide -- delegation.ts does, and it refuses anybody approving their own work." },
  { from: "approved", to: "published", label: "Put it into use",
    why: "Makes it the version people fill in, from its effective date, and archives whatever it supersedes." },
  { from: "approved", to: "draft", label: "Re-open for editing",
    why: "Any further change invalidates the approval, so the approval link is cleared with it rather than being carried forward onto a form nobody approved. ⚠ THIS IS ALSO HOW AN APPROVED FORM IS ABANDONED. There is deliberately no direct route from approved to archived: `archived` means withdrawn or superseded, which describes something that was in force, and a form approved but never published never was. Re-open it -- which voids the approval, as it should, because nobody is standing behind it any more -- and then abandon the draft. A practice never has to put a form into use in order to get rid of it." },
  { from: "draft", to: "archived", label: "Abandon",
    why: "A draft that is not going anywhere. Kept, because a half-written form is evidence of what was being considered." },
  { from: "published", to: "archived", label: "Withdraw",
    why: "Takes it out of use. Forms already completed against it are untouched -- what the practice used to ask is often the question being asked." },
];

export const formCanMove = (from: string, to: string) =>
  FORM_TRANSITIONS.some(t => t.from === from && t.to === to);
export const formMovesFrom = (from: string) => FORM_TRANSITIONS.filter(t => t.from === from);

// ── THE THREE STATES OF A COMPLETED FORM ────────────────────────────────────────────────────────────
//
// ⚠ `abandoned` IS NOT `submitted`, AND IT IS NOT A DELETION EITHER. A form somebody started and walked
// away from is a fact about that day.

export const FORM_SUBMISSION_STATES: { code: string; label: string; meaning: string }[] = [
  { code: "in_progress", label: "Being filled in",
    meaning: "Open. Answers can still be changed, and it is not a record of anything yet." },
  { code: "submitted", label: "Submitted",
    meaning: "Closed by a named person at a recorded time. ⚠ Submitted means every required question that applied has an answer -- it does not mean any answer was checked, and nothing on it is a signature." },
  { code: "abandoned", label: "Abandoned",
    meaning: "Started and not finished, with a reason. Kept, because a form begun and left is the fact somebody needs." },
];
export const FORM_SUBMISSION_STATE_CODES: string[] = FORM_SUBMISSION_STATES.map(s => s.code);
export const formSubmissionState = (code: string) =>
  FORM_SUBMISSION_STATES.find(s => s.code === code) ?? null;

// ── CONDITIONAL QUESTIONS (CPR-KS-001 section 4, "Conditional questions" and "Dependencies") ────────
//
// ⚠ ONE EVALUATOR, IMPORTED. See the header of form-field.ts for the whole extends-vs-second-runtime
// reasoning. What is decided HERE is the same thing Phase 2 decided: what happens to a withdrawn answer.
//
// A HIDDEN QUESTION DOES NOT KEEP ITS ANSWER. If a question merely stops being drawn while its answer
// survives, the completed form contains an answer to a question the screen withdrew, a printed copy shows
// it beside a question nobody was asked, and the completeness rule -- which evaluates conditions against
// the answers it HAS -- sees the stale answer, decides the dependent question applies, finds it
// unanswered, and refuses to submit over a question that is not on the screen. That was the exact live
// defect on the registration form before it was fixed.
//
// ⚠ WHAT A CONDITION COMPARES AGAINST IS DIFFERENT HERE FROM PHASE 2, AND IT MATTERS. On a checklist the
// value is one of three response codes. On a form it is THE ANSWER ITSELF -- the text typed, the option
// chosen, the number entered. So `{ "when": "has_allergy", "equals": "yes" }` compares against the option
// value `yes`, and `{ "when": "weight_kg", "isPresent": true }` means "once a weight has been entered".
// Written down because a rule nobody can read is a rule somebody will author wrongly.

export function formClearedNotice(labels: string[]): string | null {
  const named = labels.filter(l => l && l.trim()).map(l => l.trim());
  if (named.length === 0) return null;
  const subject = named.length === 1
    ? `${named[0]} no longer applies`
    : `${named.slice(0, -1).join(", ")} and ${named[named.length - 1]} no longer apply`;
  return `${subject}, so what was entered against ${named.length === 1 ? "it" : "them"} has been removed. Nothing was answered on your behalf.`;
}

// ── PUBLICATION READINESS ───────────────────────────────────────────────────────────────────────────
//
//   engine    A fact about this form's own rows that only code reading several of them can see.
//   database  ⚠ A fact enforced by a CONSTRAINT, reported here so somebody sees the gap before they try.
//             THE ENGINE DOES NOT RE-IMPLEMENT THESE.
//   build     A fact about this code. No configuration changes it.
//   absent    ⚠ NOT CHECKABLE. No column and no store can answer, so nothing here pretends to.

export type FormCheckSeverity = "blocker" | "warning" | "advisory";
export type FormCheckAuthority = "engine" | "database" | "build" | "absent";

export type FormCheckDefinition = {
  code: string;
  requirement: string;
  severity: FormCheckSeverity;
  authority: FormCheckAuthority;
  detail: string;
  /** ⚠ Only for `absent`: exactly what would make this checkable, so the gap is actionable. */
  wouldNeed: string | null;
};

export const FORM_CHECKS: FormCheckDefinition[] = [
  {
    code: "HAS_FIELDS",
    requirement: "There is at least one question to answer",
    severity: "blocker", authority: "engine",
    detail: "A form with no questions is a title. Nothing in the database can see that a parent row has no children, so this is the engine's.",
    wouldNeed: null,
  },
  {
    code: "CONDITIONS_RESOLVE",
    requirement: "Every conditional question names a question that exists and comes before it",
    severity: "blocker", authority: "engine",
    detail: "A condition naming a question that is not on this form hides its own question forever, and nobody would ever be asked it. A condition naming a LATER question can never be true when its own question is reached, which is the same outcome by a slower route -- and forbidding backwards references is also what makes a loop of conditions impossible to author.",
    wouldNeed: null,
  },
  {
    code: "CALCULATIONS_RESOLVE",
    requirement: "Every worked-out answer adds up number questions that come before it",
    severity: "blocker", authority: "engine",
    detail: "A worked-out answer may only use questions on this form that come earlier and, when it is adding them up, that are numbers. It may not use another worked-out answer and it may not use itself: chaining one onto another is an expression language by the back door, and this build deliberately has none. A figure printed from a calculation nobody can follow is worse than no figure.",
    wouldNeed: null,
  },
  {
    code: "RULES_COHERENT",
    requirement: "No question carries a rule that nothing could ever satisfy",
    severity: "blocker", authority: "engine",
    detail: "A lowest above a highest, an earliest after a latest, a shortest longer than a longest, or a list of choices with nothing in it. Each of them is a question that refuses every answer, and the person filling the form in has no way to tell that the question itself is the problem.",
    wouldNeed: null,
  },
  {
    code: "APPROVAL_DECIDED",
    requirement: "The approval request has actually been approved",
    severity: "blocker", authority: "engine",
    detail: "The database can see that an approval is LINKED. Only this can see that somebody DECIDED it -- a request still sitting at PENDING satisfies the constraint and satisfies nobody else. The decision itself is delegation.ts's, including its refusal to let anybody approve their own work.",
    wouldNeed: null,
  },
  {
    code: "REVIEW_DATE_SET",
    requirement: "A date is set for looking at this again",
    severity: "warning", authority: "engine",
    detail: "A form with no review date does not expire, it just quietly stops matching what the practice actually does -- and people keep filling it in. A warning rather than a blocker, because some forms genuinely do not need one.",
    wouldNeed: null,
  },
  {
    code: "APPROVAL_LINKED",
    requirement: "An approval record is attached",
    severity: "blocker", authority: "database",
    detail: "`practice_form_in_force` refuses a published row with no approval_request_id. Nothing in this engine repeats that rule -- it reports it, and when somebody tries anyway the database refuses and the refusal is returned with the constraint named.",
    wouldNeed: null,
  },
  {
    code: "EFFECTIVE_FROM_SET",
    requirement: "An effective date is set",
    severity: "blocker", authority: "database",
    detail: "The same constraint. In use means in use, and from when is not a question somebody about to fill in a consent form should have to guess at.",
    wouldNeed: null,
  },
  {
    code: "CODE_NOT_IN_USE",
    requirement: "No other published form holds this reference",
    severity: "blocker", authority: "database",
    detail: "`ux_practice_form_published_code` is a partial unique index over published rows only, so a practice may hold ten drafts of CONS-01 and exactly one in use. Publishing a new version therefore requires withdrawing the old one, in that order -- because two forms in use under one reference is how half a practice fills in a different set of questions.",
    wouldNeed: null,
  },
  {
    code: "NOT_VERIFIED",
    requirement: "The form says plainly that an answer is a claim, that nothing checks it, and that nothing on it is a signature",
    severity: "advisory", authority: "build",
    detail: "⚠ ALWAYS TRUE IN THIS BUILD, and printed rather than assumed. This product records what was entered, by whom and when. It does not check an answer against anything, capture a handwritten mark, or re-check who is at the keyboard. This row does not depend on configuration and cannot be cleared.",
    wouldNeed: null,
  },
  {
    code: "ANSWERS_TRUE",
    requirement: "The answers entered are true",
    severity: "warning", authority: "absent",
    detail: "⚠ NOT CHECKED, AND IT NEVER WILL BE BY THIS BUILD. Nothing here compares an answer against a measurement, a device, another record or a second person. A range rule refuses a number outside the range it was given -- it says nothing at all about whether the number is right.",
    wouldNeed: "An independent record of the same fact -- a device reading, a linked clinical observation, or a second person recording it separately -- plus a rule for what a disagreement between the two means. None of the three exists here.",
  },
  {
    code: "SIGNATURE_CAPTURED",
    requirement: "The person the form is about has signed it",
    severity: "warning", authority: "absent",
    detail: "⚠ NOT CHECKED, AND IT IS THE ROW THAT MATTERS MOST ON A CONSENT FORM. Section 4 asks for a signature component and a drawing component. This build has neither, has no per-answer file or image store, and does no fresh identity check when a form is completed. A completed consent form here records that somebody with a practice login typed answers. It is not evidence that a named person consented, and it must never be produced as though it were. The notice at the top of every form and every printed page says the same thing in the practitioner's own words.",
    wouldNeed: "A signature capture written to storage, tied to a fresh authentication of the person signing, plus a countersignature row for the second person a consent conversation actually involves. All three are security work rather than forms work.",
  },
  {
    code: "SUBMISSION_REQUIRED",
    requirement: "Somebody is required to fill this in, and is chased if they do not",
    severity: "warning", authority: "absent",
    detail: "⚠ NOT CHECKED. Publishing a form puts it in the library. It does not attach it to a procedure, an appointment or a clinic, and nothing notices that today's form was never started. A form nobody is required to complete is a form that gets completed when there is time.",
    wouldNeed: "A rule binding a form to an event kind, and something that reads that rule when the event happens. Migration 196's doctrine applies -- nothing runs in a neglected practice -- so it would have to be derived at read time rather than fired overnight.",
  },
];

export const formCheck = (code: string) => FORM_CHECKS.find(c => c.code === code) ?? null;
export const FORM_CHECKS_NOT_CHECKABLE: string[] =
  FORM_CHECKS.filter(c => c.authority === "absent").map(c => c.code);
export const FORM_CHECKS_DATABASE_OWNED: string[] =
  FORM_CHECKS.filter(c => c.authority === "database").map(c => c.code);
export const FORM_CHECKS_BLOCKING: string[] =
  FORM_CHECKS.filter(c => c.severity === "blocker").map(c => c.code);

/** The constraints that own the `database` rows, named so a refusal can be recognised rather than guessed at. */
export const FORM_CONSTRAINTS = {
  inForce: "practice_form_in_force",
  publishedCode: "ux_practice_form_published_code",
  reviewAfterEffect: "practice_form_review_after_effect",
  archivedReason: "practice_form_archived_reason",
  submissionSubmitted: "practice_form_submission_submitted",
  submissionAbandonedReason: "practice_form_submission_abandoned_reason",
  answerNotEmpty: "practice_form_answer_not_empty",
  answerOnce: "ux_practice_form_answer_once",
  fieldPosition: "ux_practice_form_field_position",
  fieldKey: "ux_practice_form_field_key",
} as const;

/**
 * Tinted marks. Copied from checklist-constants.ts rather than re-chosen, so that "not checked" looks the
 * same in all four places it now appears.
 *
 * ⚠ SLATE AND A HOLLOW MARK for not_checked. Never green, never a tick.
 */
export const FORM_CHECK_SWATCH: Record<string, { badge: string; text: string; box: string; icon: string }> = {
  pass: { badge: "bg-emerald-100 text-emerald-700", text: "text-emerald-700", box: "border-emerald-200/80 bg-emerald-50/60", icon: "✓" },
  fail: { badge: "bg-rose-100 text-rose-700", text: "text-rose-700", box: "border-rose-200/80 bg-rose-50/60", icon: "✕" },
  not_checked: { badge: "bg-slate-200 text-slate-700", text: "text-slate-600", box: "border-dashed border-slate-300 bg-slate-50/70", icon: "◌" },
};

export const FORM_STATE_SWATCH: Record<string, { chip: string; dot: string }> = {
  draft: { chip: "bg-slate-100 text-slate-700", dot: "bg-slate-400" },
  in_review: { chip: "bg-amber-100 text-amber-800", dot: "bg-amber-500" },
  approved: { chip: "bg-sky-100 text-sky-800", dot: "bg-sky-500" },
  published: { chip: "bg-emerald-100 text-emerald-800", dot: "bg-emerald-500" },
  archived: { chip: "bg-gray-100 text-gray-500", dot: "bg-gray-400" },
};

/**
 * The marks for the three ways a question can carry no answer on a completed form.
 *
 * ⚠ `not_answered` AND `did_not_apply` ARE VISUALLY DISTINCT AND NEITHER IS GREEN. An unanswered question
 * and a withdrawn one mean opposite things, and rendering both as an empty box is how a printed record
 * loses the difference. `answered` is the fourth state and it carries the answer itself.
 */
export const FORM_ANSWER_SWATCH: Record<string, { chip: string; icon: string }> = {
  answered: { chip: "bg-emerald-100 text-emerald-800", icon: "✓" },
  not_answered: { chip: "border border-dashed border-amber-300 bg-amber-50 text-amber-800", icon: "◌" },
  did_not_apply: { chip: "border border-dashed border-slate-300 bg-slate-50 text-slate-500", icon: "◌" },
  calculated: { chip: "bg-sky-100 text-sky-800", icon: "Σ" },
};

// ── SECTION 4's COMPONENTS, VALIDATION AND OUTPUTS, ONE BY ONE ──────────────────────────────────────
//
// ⚠ EVERY ONE IS DECLARED, INCLUDING THE SEVEN THAT ARE NOT BUILT. Section 4 names fifteen components,
// five classes of validation and four outputs. Declaring an absent one is not pessimism: a form designer
// that silently omits "Signature" leaves an author to discover it after writing a consent form, and a
// designer that offers it without a store loses somebody's signature.

export type EngineCapabilityState = "built" | "partial" | "absent";

export const FORM_COMPONENTS: { name: string; state: EngineCapabilityState; how: string }[] = [
  { name: "Text", state: "built", how: "One line or several, with a shortest and a longest if the author sets them." },
  { name: "Number", state: "built", how: "Stored as a number rather than as writing, with a lowest and a highest if the author sets them." },
  { name: "Date", state: "built", how: "A day, with an earliest and a latest if the author sets them." },
  { name: "Time", state: "built", how: "A time of day on a 24-hour clock. ⚠ No date and no timezone -- it is the time somebody wrote down." },
  { name: "Dropdown", state: "built", how: "One choice from a list the author writes. The database refuses an answer that is not on the list." },
  { name: "Checkbox", state: "built", how: "A single yes-or-no, or any number of choices from a list." },
  { name: "Radio", state: "built", how: "The same data as a dropdown, and therefore the same question type -- how it is drawn is presentation, and a second type for it would be two vocabularies to keep in step for no gain." },
  { name: "Signature", state: "absent", how: "⚠ NOT BUILT. There is no handwritten mark, no drawing surface and no fresh identity check anywhere in this build. This is the one that matters on a consent form, and the notice at the top of every form and every printed page says so." },
  { name: "Drawing", state: "absent", how: "⚠ NOT BUILT. No canvas exists anywhere in this product and none is implied here." },
  { name: "Images", state: "absent", how: "⚠ NOT BUILT. There is no per-answer image store, and an image box with nowhere to put a file is a prompt that loses somebody's photograph." },
  { name: "Uploads", state: "absent", how: "⚠ NOT BUILT, for the same reason. A file uploaded against a form would also need a rule about who may read it, which is an access decision rather than a forms one." },
  { name: "Repeating sections", state: "absent", how: "⚠ NOT BUILT. A form that asks the same questions about three children needs three completed forms today. Building it half way -- a repeat that conditions cannot see into -- would be worse than not building it." },
  { name: "Calculated fields", state: "partial", how: "Two operations and no third: add up the answers to named number questions, or count how many of them were answered. ⚠ There is no expression language, no chaining and no syntax, and a total names the answers it could not use rather than counting them as nought." },
  { name: "Conditional questions", state: "built", how: "The same three condition shapes as the registration form, evaluated by the same imported function on the server and on the screen. A withdrawn question's answer is removed and the removal is said out loud." },
  { name: "Required questions", state: "built", how: "A question can be required. Required means a form cannot be submitted without an answer to it -- and an answer of spaces is not an answer, in the engine and in the database alike." },
];

export const FORM_VALIDATIONS: { name: string; state: EngineCapabilityState; how: string }[] = [
  { name: "Ranges", state: "built", how: "Lowest and highest on a number, earliest and latest on a date, shortest and longest on writing. Refused at the point of entry and again on the server." },
  { name: "Mandatory", state: "built", how: "Required questions, with a blank string treated as no answer rather than as an answer." },
  { name: "Dependencies", state: "built", how: "Conditions, evaluated by the one shared function object." },
  { name: "Logic", state: "built", how: "The same three condition shapes. Section 4 names this and Dependencies separately -- they are one mechanism here." },
  { name: "Calculations", state: "partial", how: "As above: add up, or count how many were answered. ⚠ An author-written formula is not supported and an author-written pattern is refused by name rather than ignored." },
];

export const FORM_OUTPUTS: { name: string; state: EngineCapabilityState; how: string }[] = [
  { name: "PDF", state: "partial", how: "Print-to-PDF through the browser, for a blank form and for a completed one. ⚠ There is no PDF library in this product, so nothing generates a file on the server." },
  { name: "Patient record", state: "partial", how: "A completed form names the patient it was filled in for, and it can be found from the form. ⚠ Nothing writes an answer into the clinical record and nothing shows it on the patient's own timeline." },
  { name: "Analytics", state: "absent", how: "⚠ NOT BUILT. Every answer is a row of its own rather than a blob, so counting across completed forms is possible -- but nothing counts anything yet, and a chart drawn over one practice's four submissions would be a shape rather than a finding." },
  { name: "AI", state: "absent", how: "⚠ NOT BUILT. The practice AI has six tasks fixed by a CHECK constraint on practice_ai_session.task, and none of them is about a form. A seventh is a migration before it is a line of prompt." },
];

/** The three lists as one, for the screen that shows what section 4 asked for against what exists. */
export const FORM_ENGINE_CAPABILITIES = [
  ...FORM_COMPONENTS.map(c => ({ ...c, group: "Components" })),
  ...FORM_VALIDATIONS.map(c => ({ ...c, group: "Validation" })),
  ...FORM_OUTPUTS.map(c => ({ ...c, group: "Output" })),
];

export const FORM_CAPABILITIES_ABSENT: string[] =
  FORM_ENGINE_CAPABILITIES.filter(c => c.state === "absent").map(c => c.name);

// ── THE LIBRARY'S FACETS (CPR-KS-001 section 8, "Asset Library") ────────────────────────────────────
//
// The same eight section 8 asks for, and the same two that have nothing behind them. Declared rather than
// quietly omitted: a filter control that returns whatever it likes is worse than a missing one, because
// somebody narrows a search with it and believes the result.

export const FORM_FACETS: { key: string; label: string; state: "live" | "absent"; detail: string; wouldNeed: string | null }[] = [
  { key: "type", label: "Kind", state: "live", wouldNeed: null,
    detail: "The thirteen kinds of form, from the column's own CHECK constraint." },
  { key: "status", label: "Status", state: "live", wouldNeed: null,
    detail: "The five states, from the column's own CHECK constraint." },
  { key: "specialty", label: "Specialty", state: "live", wouldNeed: null,
    detail: "Free text on the form, the same column practice_note_template uses." },
  { key: "tags", label: "Tags", state: "live", wouldNeed: null,
    detail: "Free tags. This is also where a condition or a disease goes today." },
  { key: "author", label: "Author", state: "live", wouldNeed: null,
    detail: "Who created it, resolved to a name." },
  { key: "version", label: "Version", state: "live", wouldNeed: null,
    detail: "Every version is a row of its own, linked by supersedes_id, so an earlier version is a form you can open rather than a difference to reconstruct." },
  { key: "disease", label: "Disease", state: "absent",
    detail: "⚠ NOT OFFERED. Nothing joins a form to a coded condition. A disease is a tag here, which is a word somebody typed -- searching it finds the forms that happen to use the same spelling and misses the ones that do not.",
    wouldNeed: "A coded condition vocabulary linked to form rows, and a decision about which coding system." },
  { key: "age", label: "Age", state: "absent",
    detail: "⚠ NOT OFFERED. There is no age band on a form and no age-band vocabulary anywhere in this schema. A paediatric form is paediatric because its questions say so, in words, and nothing here reads that.",
    wouldNeed: "An age-applicability column with an agreed set of bands, and a rule for what an unset one means." },
];

export const FORM_FACETS_LIVE: string[] = FORM_FACETS.filter(f => f.state === "live").map(f => f.key);
export const FORM_FACETS_ABSENT: string[] = FORM_FACETS.filter(f => f.state === "absent").map(f => f.key);

/**
 * ⚠ WHAT THIS PHASE KNOWINGLY DOES NOT DO, WRITTEN DOWN SO IT IS A DECISION RATHER THAN AN OVERSIGHT.
 *
 * Each of these was considered and left, and each is on the screen. A gap recorded only in a commit
 * message is a gap the next person rediscovers as a bug.
 */
export const FORM_KNOWN_GAPS: { gap: string; why: string; wouldNeed: string }[] = [
  {
    gap: "There is no signature, no drawing, no image and no upload on a form -- so a completed consent form is a typed record and nothing more.",
    why: "Section 4 asks for four components that all need a per-answer file store and, in the signature's case, a fresh identity check at the moment of completion. This build has neither. Offering a signature box with nowhere to put the mark would be worse than the honest absence, because the box itself is the claim.",
    wouldNeed: "A per-answer attachment into practice_library_document's storage, a rule about who may read an attachment on a completed form, and -- for the signature specifically -- a re-authentication at the moment of signing plus a countersignature row for the second person a consent conversation involves.",
  },
  {
    gap: "Nothing binds a form to the event it is meant to accompany.",
    why: "Publishing puts it in the library. It does not attach it to a procedure, an appointment or a clinic, so nothing offers it at the moment it is wanted and nothing notices it was never started. This is SUBMISSION_REQUIRED, and it is permanently not_checked. It is the same gap Phase 2 declared for checklists, unchanged, because the binding table neither phase built is the same table.",
    wouldNeed: "A binding table between an asset and an event kind, read at the point the event happens -- derived rather than fired, following migration 196 -- and it should be built once for checklists and forms together rather than twice.",
  },
  {
    gap: "A merged patient's completed forms still point at the record that was merged away.",
    why: "mergePatients() repoints a fixed list of child tables and this one is not on it, exactly as it is not on it for completion records. The patient row is never deleted -- it is marked `merged` with `merged_into_patient_id` -- so nothing is lost, but a completed form found through the surviving patient will not include it.",
    wouldNeed: "practice_form_submission and practice_checklist_run added to the repointing list in patients.ts together, with a migration-free backfill for records already made.",
  },
  {
    gap: "There are no repeating sections.",
    why: "A form that asks the same five questions about each of three children needs three completed forms today. A half-built repeat -- one that the condition evaluator cannot see inside, or one whose answers do not have their own keys -- would produce completed forms nobody can read back, which is worse than the plain absence.",
    wouldNeed: "A repeat group on the field row, keys scoped per iteration so an answer belongs to a known instance, and the condition evaluator taught to resolve within an iteration before falling back to the form. The evaluator change is the part that reaches every screen this product has.",
  },
  {
    gap: "A worked-out answer does arithmetic over other answers and nothing else.",
    why: "Section 4's \"Calculated fields\" would ordinarily mean an expression language. This build has none anywhere -- practice_parameter_definition.formula is a display string with a hardcoded map behind it, and the four clinical calculators are TypeScript. An author-written expression evaluated on the server is a security surface and a termination problem, and a clinical score computed by a formula nobody reviewed is a safety one.",
    wouldNeed: "A reviewed expression grammar with a bounded evaluator, a decision about who may author one, and a rule about which authored calculations are clinical scores requiring approval rather than arithmetic requiring none.",
  },
  {
    gap: "Nothing reads across completed forms.",
    why: "Every answer is a row of its own rather than a blob, so counting across them is possible -- but nothing counts anything, and there is no export. Section 4 lists Analytics and AI as outputs and neither exists.",
    wouldNeed: "A read model over practice_form_answer scoped per form and per version, plus a decision about what a figure means when the form was revised half way through the period being counted.",
  },
];

/**
 * ⚠ WHAT THE FIVE PERMISSION ROLES OF SECTION 3 ACTUALLY ARE HERE, SAID PLAINLY.
 *
 * Section 3 names Owner . Reviewer . Approver . Editor . Viewer, and this build has three capabilities
 * and one assignable approver. Pretending otherwise on screen would be a permission model somebody
 * relies on.
 */
export const FORM_ROLE_REALITY: { role: string; provided: boolean; how: string }[] = [
  { role: "Owner", provided: true, how: "A named person on the form. Accountability, not permission -- it grants and restricts nothing." },
  { role: "Reviewer", provided: true, how: "The assignee on the approval request. The same person as the Approver: migration 208 supports one assignee and one decision." },
  { role: "Approver", provided: true, how: "As above. ⚠ A multi-step chain of different approvers is NOT built and would need a migration." },
  { role: "Editor", provided: true, how: "Anybody with template.manage. It is not per-form." },
  { role: "Viewer", provided: true, how: "Anybody with document.view. ⚠ Filling one in takes task.manage, which is a wider group -- see the header for why that code and not a new one." },
];

/** Re-exported so a screen needs one import for the vocabulary and the field types together. */
export {
  PRACTICE_FIELD_TYPES, PRACTICE_FIELD_TYPE_CODES, REGISTRATION_FIELD_TYPE_CODES,
  FORM_ONLY_FIELD_TYPE_CODES, CALCULATIONS, fieldType, fieldTypeLabel,
};
