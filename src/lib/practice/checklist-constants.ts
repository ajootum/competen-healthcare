import {
  conditionMet, resolveApplicable, type FieldCondition, type RegistrationFieldLike,
} from "@/lib/practice/registration-condition";

// ────────────────────────────────────────────────────────────────────────────────────────────────────
// CPR-KS-001 PHASE 2 -- PRACTICE CHECKLISTS. The constants half.
//
// CPR-KS-001's Engine 5 is the "Checklist Engine": nine named checklist kinds and six capabilities --
// tick boxes, conditional items, mandatory items, electronic completion, printing, mobile mode. This
// file is that vocabulary, plus the four things the spec does NOT say and this build must: what a tick
// actually is, what a run is about, which of Engine 5's capabilities have nothing behind them, and the
// one sentence that has to be on every checklist and every printed copy of one.
//
// ---- THE ONE IMPORT, AND WHY IT IS THE ONLY ONE ----------------------------------------------------
//
// `conditionMet` and `resolveApplicable` come from registration-condition.ts and are NOT reimplemented
// here. That module imports nothing at all, so importing it keeps this file safe in a client component
// -- which matters, because the run screen is a client component and it must evaluate exactly the same
// conditions the server does. There is ONE evaluator in this product and the checklist path uses that
// one. A rule written twice is a rule that will one day be written differently, and the copy that
// matters is always the one nobody is testing.
//
// ---- ⚠ THE NAME, WHICH IS A SAFETY DECISION AND NOT A STYLE ONE ------------------------------------
//
// This module is called PRACTICE CHECKLISTS. Not a "studio", not a "designer", not "assurance", not
// "compliance", and a completed one is never called a verification or a sign-off.
//
//   1. "Studio" and "designer" name a TOOL, and a tool named for what it appears to do makes its claim
//      before anybody authors anything. Phase 1 settled that (knowledge-constants.ts) and the ruling
//      binds here: NAME THE ASSET FOR WHAT IT PRODUCES. What this produces is a CHECKLIST and, when
//      somebody fills one in, a COMPLETION RECORD.
//   2. ⚠ AND THE SHARPER ONE FOR THIS PHASE. A checklist that records completion is not a checklist
//      that enforces anything. A tick is somebody's claim that they did a thing. Nothing in this
//      product observed the thing, nothing measured it, nothing will notice if the tick is false, and
//      nothing chases a checklist that is never started. Words like "verified", "assured", "compliant"
//      or "signed off" would each assert something no row in this schema can support.
//
// CHECKLIST_NOT_VERIFIED below is that sentence. It is on the library, on every definition, on the run
// screen while somebody is ticking, on the completion record afterwards, and on the printed page --
// in the `not_checked` idiom publish-constants.ts established. Never a green tick, never silence.
//
// The ROUTE is /practice/knowledge-studio/checklists because CPR-KS-001 is one programme and that is
// where the programme is filed. A URL is an address rather than a claim.
//
// ---- CAPABILITIES: NOTHING MINTED, AND ONE OF THE THREE IS AN APPROXIMATION -------------------------
//
// Probed live 2026-08-08 against practice_role_capabilities: 50 distinct codes, no `checklist.*` and no
// `knowledge.*` among them. Six invented capability codes have already shipped in this product -- an
// invented code compiles, 403s for everybody including the practice owner, and errors nowhere.
//
//   view      document.view   -- migration 210's rule. A checklist is something everybody who reads
//                                documents should be able to find.
//   manage    template.manage -- authoring. Migration 210's "the same people who write the note
//                                templates keep the protocols". Held by practitioner and practice_owner.
//   complete  task.manage     -- ⚠ AN APPROXIMATION, AND IT IS DECLARED RATHER THAN HIDDEN. Filling a
//                                checklist in is not authoring it, and the two must not be the same
//                                permission -- an assistant who does the ward round has to be able to
//                                tick. task.manage is the closest SEEDED code (recording that practice
//                                work was done) and it is held by practitioner, practice_assistant and
//                                practice_owner, which is exactly the audience. THE HONEST CONSEQUENCE:
//                                anybody who can close a task can complete a checklist. A dedicated
//                                `checklist.complete` is a migration, and it is not this phase.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * ⚠ EVERY CAPABILITY CODE THIS MODULE NAMES, AS AN EXPORTED ARRAY.
 *
 * Same reason knowledge-constants.ts and publish-constants.ts export theirs: a code reached only through
 * an object literal is invisible to the audit harness's literal scanner. All three were confirmed
 * present in the live catalogue when this was written.
 */
export const CHECKLIST_CAPABILITY_CODES: string[] = ["document.view", "template.manage", "task.manage"];

export const CHECKLIST_CAPABILITIES = {
  /** Find and read a checklist and its completion records. */
  view: "document.view",
  /** Write one, send it for approval, publish it, withdraw it. */
  manage: "template.manage",
  /** ⚠ Fill one in. An approximation -- see the header. */
  complete: "task.manage",
} as const;

/** The module's name in every sentence a practitioner reads. See the header for why it is not "Studio". */
export const CHECKLIST_MODULE_NAME = "Practice Checklists";
export const CHECKLIST_LIBRARY_NAME = "Checklist Library";
/** What a filled-in checklist is called. NEVER a verification, an assurance or a sign-off. */
export const CHECKLIST_RUN_NAME = "completion record";
export const CHECKLIST_ROUTE = "/practice/knowledge-studio/checklists";

/**
 * ⚠ THE SENTENCE THAT MUST APPEAR ON EVERY CHECKLIST AND EVERY COMPLETION RECORD, ON SCREEN AND ON PAPER.
 *
 * Not a disclaimer at the bottom of a settings page. Somebody who ticks "sponge count correct" in a
 * clinical system will otherwise reasonably believe the system now knows the sponge count was correct.
 * It does not. It stored a tick and the name of whoever pressed it.
 */
export const CHECKLIST_NOT_VERIFIED = {
  headline: "A tick records what somebody said. Nothing here checks it was done.",
  detail:
    "Competen Practice stores what was ticked, by whom and when. It does not observe the step, measure anything, compare the tick against any other record, or raise anything when an item is left undone. It does not chase a checklist nobody started. A completed checklist is a statement by the person who completed it, and it is kept as one.",
  /** The one line that fits on printed paper, where there is no room for the paragraph. */
  onPaper:
    "A record of what was ticked, by whom. This system does not check, observe or enforce anything on this list.",
} as const;

/**
 * ⚠ WORDS THIS MODULE MAY NEVER PUT IN FRONT OF A PRACTITIONER, and the harness asserts every exported
 * sentence against them.
 *
 * Each one asserts something no row in this schema can support. "Verified" and "confirmed" claim an
 * observation nothing made. "Assured", "compliant" and "certified" claim a judgement against a standard
 * this product does not hold. "Signed off" claims an identity check the tick never performed. This is
 * the same list-and-assert shape as the refused percentile bands: the safeguard is a test, not a
 * convention somebody remembers.
 */
export const CHECKLIST_FORBIDDEN_CLAIMS: string[] = [
  "verified", "verifies", "assured", "assurance", "compliant", "compliance",
  "certified", "signed off", "sign-off", "guarantees", "guaranteed", "proves",
];

// ── THE NINE CHECKLIST KINDS (CPR-KS-001 Engine 5, "Examples") ──────────────────────────────────────
//
// ⚠ THE SAME NINE ARE A CHECK CONSTRAINT ON practice_checklist.checklist_type. Phase 1 drew that line
// for the eight guidance types and the survey's section 8 drew it before that: a studio that lets
// somebody invent a tenth kind produces rows the DATABASE rejects, and no amount of front-end work
// fixes it. A tenth kind is a migration BEFORE the UI offers it, never after.
//
// The labels are the specification's own words. "WHO checklist" is vague and is left vague on purpose --
// naming it "WHO surgical safety checklist" would be this build asserting which WHO checklist the
// specification meant, and the specification does not say.

export type ChecklistKindDefinition = {
  code: string;
  label: string;
  /** What distinguishes it from the eight beside it, in a practitioner's words. */
  meaning: string;
  /** Whether a completion of this kind is normally about one patient. Advisory -- the author chooses. */
  usuallyAboutAPatient: boolean;
};

export const CHECKLIST_KINDS: ChecklistKindDefinition[] = [
  { code: "who", label: "WHO checklist", usuallyAboutAPatient: true,
    meaning: "A checklist adopted from WHO guidance and used at fixed points in an episode of care." },
  { code: "ward_round", label: "Ward round checklist", usuallyAboutAPatient: true,
    meaning: "What is asked and looked at for each patient on a round, so the round is the same whoever leads it." },
  { code: "discharge", label: "Discharge checklist", usuallyAboutAPatient: true,
    meaning: "What has to be in place before somebody goes home, including what they leave with." },
  { code: "procedure", label: "Procedure checklist", usuallyAboutAPatient: true,
    meaning: "The steps of one procedure, before, during and after, in the order they are done." },
  { code: "audit", label: "Audit checklist", usuallyAboutAPatient: false,
    meaning: "What is being looked for when a sample of records or of practice is reviewed." },
  { code: "clinic", label: "Clinic checklist", usuallyAboutAPatient: false,
    meaning: "What has to be ready before a clinic opens, or settled before it closes." },
  { code: "inspection", label: "Inspection checklist", usuallyAboutAPatient: false,
    meaning: "What an inspector or a visit will ask for, gone through before they arrive." },
  { code: "equipment", label: "Equipment checklist", usuallyAboutAPatient: false,
    meaning: "The condition of a machine or a kit, checked on a rhythm rather than when something goes wrong." },
  { code: "cpd", label: "CPD checklist", usuallyAboutAPatient: false,
    meaning: "What a person has to have done or evidenced in a period of continuing development." },
];

export const CHECKLIST_KIND_CODES: string[] = CHECKLIST_KINDS.map(k => k.code);
export const checklistKind = (code: string) => CHECKLIST_KINDS.find(k => k.code === code) ?? null;
export const checklistKindLabel = (code: string) => checklistKind(code)?.label ?? code;

// ── WHAT ONE COMPLETION IS ABOUT ────────────────────────────────────────────────────────────────────
//
// A discharge checklist with no patient on it is a record nobody can use. An equipment checklist with a
// patient on it has put a machine in somebody's file. So the DEFINITION declares which it is, and the
// engine refuses a run that does not match.
//
// ⚠ THE ENGINE'S RULE, NOT A CONSTRAINT. `run_subject` lives on the checklist and the patient lives on
// the run, and a CHECK constraint cannot see a sibling table. That split is declared rather than assumed
// -- the same shape as APPROVAL_LINKED (the database can see the link) against APPROVAL_DECIDED (only
// the engine can see the decision).
//
// TWO VALUES, NOT THREE. An optional-patient kind was drafted and cut: "you may name a patient" means
// half the discharge checklists in a practice have one and half do not, and nothing can then tell a
// deliberate omission from a forgotten one.

export type ChecklistSubjectDefinition = { code: string; label: string; meaning: string };

export const CHECKLIST_SUBJECTS: ChecklistSubjectDefinition[] = [
  { code: "patient", label: "About one patient",
    meaning: "Every completion names the patient it was done for, and the engine refuses one that does not." },
  { code: "none", label: "Not about a patient",
    meaning: "A clinic, a room, a machine or a person's own development. No patient is recorded on it, and none may be." },
];

export const CHECKLIST_SUBJECT_CODES: string[] = CHECKLIST_SUBJECTS.map(s => s.code);
export const checklistSubject = (code: string) => CHECKLIST_SUBJECTS.find(s => s.code === code) ?? null;

// ── WHAT A TICK IS (CPR-KS-001 Engine 5, "tick boxes" and "electronic completion") ──────────────────
//
// Three answers and no fourth, copied from checklist_responses' yes/no/na (migration 009) -- the most
// complete define-then-capture loop this codebase already had -- and renamed to what a checklist means
// rather than what an assessment meant.
//
// ⚠ NO TEXT AND NO NUMBER ANSWERS, AND THAT IS DELIBERATE. Engine 5 asks for tick boxes. A checklist
// item that collects a blood pressure or a free-text finding is a FORM, which is CPR-KS-001's Engine 4
// section 4 and this programme's Phase 3. Building half a form here would produce the second forms
// runtime this codebase has been bitten by twice already.
//
// ⚠ AND THERE IS NO FOURTH STATE FOR "NOT ANSWERED". An item nobody answered has NO ROW. Three states
// everywhere: answered, not answered, or the item did not apply -- and the run screen shows all three
// separately, because an unanswered item rendered as an empty box beside an answered one is the same
// blank-under-a-heading failure Phase 1 refused on printed guidance.

export type ChecklistResponseDefinition = {
  code: string;
  label: string;
  meaning: string;
  /** Does this answer require words? `not_applicable` does, enforced by the database. */
  needsNote: boolean;
};

export const CHECKLIST_RESPONSES: ChecklistResponseDefinition[] = [
  { code: "done", label: "Done", needsNote: false,
    meaning: "The person completing the checklist says this was done. ⚠ Nothing here checked it." },
  { code: "not_done", label: "Not done", needsNote: false,
    meaning: "It was not done. Recorded as a fact rather than refused -- a checklist that cannot be closed with a step undone is a checklist people close by lying." },
  { code: "not_applicable", label: "Not applicable", needsNote: true,
    meaning: "It did not apply on this occasion, and why. The reason is required by the database, because \"n/a\" with no words is the entry that hides a skipped step." },
];

export const CHECKLIST_RESPONSE_CODES: string[] = CHECKLIST_RESPONSES.map(r => r.code);
export const checklistResponse = (code: string) => CHECKLIST_RESPONSES.find(r => r.code === code) ?? null;
export const CHECKLIST_RESPONSES_NEEDING_NOTE: string[] =
  CHECKLIST_RESPONSES.filter(r => r.needsNote).map(r => r.code);

// ── THE FIVE STATES OF A DEFINITION (CPR-KS-001 section 3, "Version Engine") ────────────────────────
//
// Draft . Review . Approved . Published . Archived -- section 3 says all engines share them, and Phase 1
// already built this exact ladder for guidance. It is copied rather than shared for one reason: the two
// live in different tables with different CHECK constraints, and a shared TypeScript vocabulary over two
// independent database enums is a shared thing that only looks shared. The ladder is the same, the
// reasoning is Phase 1's, and where the wording differs it is because a checklist is filled in and a
// guidance document is read.
//
// ⚠ `in_review`, NOT `review`. There is a `review_on` COLUMN on the same row meaning something entirely
// different -- the date this checklist next has to be looked at.

export type ChecklistStateDefinition = {
  code: string;
  label: string;
  meaning: string;
  /** Can its items be edited in this state? */
  editable: boolean;
  /** May somebody start a completion record against it? */
  usable: boolean;
};

export const CHECKLIST_STATES: ChecklistStateDefinition[] = [
  { code: "draft", label: "Draft", editable: true, usable: false,
    meaning: "Being written. Nobody may fill it in, because a completion record against a list that changed afterwards records nothing anybody can rely on." },
  { code: "in_review", label: "In review", editable: false, usable: false,
    meaning: "With a colleague for a decision. Frozen while they read it -- a list that changes under a reviewer is not the one they approved." },
  { code: "approved", label: "Approved", editable: false, usable: false,
    meaning: "A colleague has approved it and it is not yet in use. Publishing is a separate, deliberate act with a date on it." },
  { code: "published", label: "In use", editable: false, usable: true,
    meaning: "In force from its effective date. This is the version people fill in, and the only one they can." },
  { code: "archived", label: "Archived", editable: false, usable: false,
    meaning: "Withdrawn or superseded. Kept and readable, and every completion record made against it is kept exactly as it was." },
];

export const CHECKLIST_STATE_CODES: string[] = CHECKLIST_STATES.map(s => s.code);
export const checklistState = (code: string) => CHECKLIST_STATES.find(s => s.code === code) ?? null;
export const CHECKLIST_STATES_EDITABLE: string[] = CHECKLIST_STATES.filter(s => s.editable).map(s => s.code);
export const CHECKLIST_STATES_USABLE: string[] = CHECKLIST_STATES.filter(s => s.usable).map(s => s.code);

/**
 * ⚠ THE ONLY MOVES THAT EXIST. Anything not listed here is refused by name, not by falling through.
 *
 * There is no `published -> draft` and no way out of `archived`. Phase 1's rule, and it binds harder
 * here: a published checklist has COMPLETION RECORDS against it, and editing it would retrospectively
 * change what somebody ticked.
 */
export const CHECKLIST_TRANSITIONS: { from: string; to: string; label: string; why: string }[] = [
  { from: "draft", to: "in_review", label: "Send for approval",
    why: "Creates a practice_approval_request and freezes the items while a colleague reads them." },
  { from: "in_review", to: "draft", label: "Withdraw from review",
    why: "The author takes it back. The approval request is withdrawn with it, so no decision is left pending on a checklist nobody is waiting on." },
  { from: "in_review", to: "approved", label: "Record the approval",
    why: "Follows the decision on the approval request. ⚠ This engine does not decide -- delegation.ts does, and it refuses anybody approving their own work." },
  { from: "approved", to: "published", label: "Put it into use",
    why: "Makes it the version people fill in, from its effective date, and archives whatever it supersedes." },
  { from: "approved", to: "draft", label: "Re-open for editing",
    why: "Any further change invalidates the approval, so the approval link is cleared with it rather than being carried forward onto a list nobody approved." },
  { from: "draft", to: "archived", label: "Abandon",
    why: "A draft that is not going anywhere. Kept, because a half-written checklist is evidence of what was being considered." },
  { from: "published", to: "archived", label: "Withdraw",
    why: "Takes it out of use. Completion records already made against it are untouched -- what the practice used to check is often the question being asked." },
];

export const checklistCanMove = (from: string, to: string) =>
  CHECKLIST_TRANSITIONS.some(t => t.from === from && t.to === to);
export const checklistMovesFrom = (from: string) => CHECKLIST_TRANSITIONS.filter(t => t.from === from);

// ── THE THREE STATES OF A COMPLETION RECORD ─────────────────────────────────────────────────────────
//
// ⚠ `abandoned` IS NOT `completed`, AND IT IS NOT A DELETION EITHER. A run somebody started and walked
// away from is a fact about that day. Deleting it would leave no trace that the ward round was begun and
// not finished, which is precisely the thing worth knowing.

export const CHECKLIST_RUN_STATES: { code: string; label: string; meaning: string }[] = [
  { code: "in_progress", label: "Being filled in",
    meaning: "Open. Answers can still be changed, and the checklist is not a record of anything yet." },
  { code: "completed", label: "Completed",
    meaning: "Closed by a named person at a recorded time. ⚠ Completed means every required item that applied has an answer -- it does not mean every answer was Done, and it does not mean anything was checked." },
  { code: "abandoned", label: "Abandoned",
    meaning: "Started and not finished, with a reason. Kept, because a ward round begun and left is the fact somebody needs." },
];

export const CHECKLIST_RUN_STATE_CODES: string[] = CHECKLIST_RUN_STATES.map(s => s.code);
export const checklistRunState = (code: string) => CHECKLIST_RUN_STATES.find(s => s.code === code) ?? null;

// ── CONDITIONAL ITEMS (CPR-KS-001 Engine 5, "conditional items") ────────────────────────────────────
//
// ════════════════════════════════════════════════════════════════════════════════════════════════════
// ⚠ ONE EVALUATOR, IMPORTED. THE DECISION ABOUT WHAT HAPPENS TO A WITHDRAWN ANSWER IS HERE.
// ════════════════════════════════════════════════════════════════════════════════════════════════════
//
// A condition is `registration_field.condition`'s three shapes and nothing else -- `equals`, `in`,
// `isPresent` -- evaluated by `conditionMet` from registration-condition.ts. That function is IMPORTED,
// not copied. `resolveApplicable` is imported too, including its fixpoint: clearing one answer can
// withdraw the next item along, and a single pass would leave the second one drawn.
//
// WHAT A CONDITION NAMES, WHICH THE SPEC DOES NOT SAY. `when` is another item's `item_key` on the same
// checklist, and the value it is compared against is that item's RESPONSE CODE -- `done`, `not_done` or
// `not_applicable`. So "if the patient has a known allergy, confirm the allergy plan" is authored as
//     { "when": "known_allergy", "equals": "done" }
// and `{ "when": "known_allergy", "isPresent": true }` means "once that item has been answered at all".
// Written down here because a condition comparing against a response code is not obvious, and a rule
// nobody can read is a rule somebody will author wrongly.
//
// ⚠ A HIDDEN ITEM DOES NOT KEEP ITS ANSWER, AND THAT IS A CORRECTNESS DECISION.
//
// This is the lesson the registration fix paid for, and it applies here unchanged. If an item merely
// STOPS BEING DRAWN while its response row survives:
//
//   - the completion record contains an answer to a question the screen withdrew, and a printed copy
//     shows a tick beside an item the person filling it in never saw;
//   - and the completeness rule evaluates conditions against the answers it HAS. It would see the old
//     answer, decide the dependent item applies, find it unanswered, and REFUSE to complete the run
//     over an item that is not on the screen. The person gets a refusal they cannot act on. That was
//     the exact live defect on the registration form.
//
// So the response is DELETED. On the server, in one write path (`recordResponses` in checklist.ts),
// against the responses actually stored rather than against what a client claimed. On the screen, in
// one handler rather than in an effect -- React 19's set-state-in-effect is an error in this project and
// the restructure is the fix, not a suppression. And what was thrown away is SAID, in
// `checklistClearedNotice` below, because a screen that silently deletes something somebody recorded is
// the failure this whole pattern exists to prevent.
//
// ⚠ THE COST IS REAL AND IT IS THE SMALLER ONE: an item withdrawn and brought back comes back blank
// rather than quietly pre-ticked. A quietly pre-ticked box on a safety checklist is worse than a blank
// one by a wide margin.

export type ChecklistCondition = FieldCondition;

/** The shape a checklist item satisfies for the shared resolver. `item_key` is its `field_key`. */
export type ChecklistItemLike = {
  item_key: string;
  label?: string | null;
  condition?: unknown;
};

/**
 * ⚠ THE ADAPTER, AND IT IS THE WHOLE OF THE INTEGRATION. It maps an item onto the shape
 * `resolveApplicable` already takes and hands over. Nothing here re-decides anything.
 *
 * `is_core: false` on every item, because a checklist has no equivalent of the registration form's
 * hard-drawn core controls -- every item is conditional-eligible, so every item's answer is clearable.
 * `visible: true` for the same reason: an item that exists on a published checklist is on the screen.
 */
const asField = (item: ChecklistItemLike): RegistrationFieldLike => ({
  field_key: item.item_key,
  label: item.label ?? item.item_key,
  visible: true,
  is_core: false,
  condition: item.condition,
});

/**
 * Which items apply right now, and what happens to the answers of the ones that do not.
 *
 * `answers` is keyed by item_key and its values are RESPONSE CODES. Returns the items to draw, the
 * answers that survive, and the items whose answers were thrown away.
 *
 * ⚠ THE SAME FUNCTION OBJECT AS THE REGISTRATION FORM'S. `resolveApplicable` is imported, and the
 * harness asserts that by identity rather than by reading this file -- `checklistResolver === the one in
 * registration-condition` -- because grepping for a function name proves nothing about which one runs.
 */
export function applicableItems<I extends ChecklistItemLike>(
  items: I[],
  answers: Record<string, unknown>,
): { applicable: I[]; answers: Record<string, unknown>; cleared: I[] } {
  const list = items ?? [];
  const fields = list.map(asField);
  const out = resolveApplicable(fields, answers);
  const applicableKeys = new Set(out.applicable.map(f => f.field_key));
  const clearedKeys = new Set(out.cleared.map(f => f.field_key));
  return {
    applicable: list.filter(i => applicableKeys.has(i.item_key)),
    answers: out.values,
    cleared: list.filter(i => clearedKeys.has(i.item_key)),
  };
}

/** ⚠ RE-EXPORTED, NOT REDEFINED, so a caller reaching for the evaluator through this module gets THE one. */
export { conditionMet, resolveApplicable };

/**
 * The sentence a checklist says when it throws an answer away.
 *
 * ⚠ THIS IS A SENTENCE, NOT A SECOND COPY OF A RULE, and the distinction is why it exists at all.
 * `clearedNotice()` in registration-condition.ts says "what was TYPED there has been cleared", which is
 * true of a registration form and false here -- a tick is not typed. Every user-facing sentence has to
 * be true today, so this one says what actually happened to a checklist answer. The RULE that decides
 * WHICH answers go is `resolveApplicable`, and that is imported rather than rewritten.
 */
export function checklistClearedNotice(labels: string[]): string | null {
  const named = labels.filter(l => l && l.trim()).map(l => l.trim());
  if (named.length === 0) return null;
  const subject = named.length === 1
    ? `${named[0]} no longer applies`
    : `${named.slice(0, -1).join(", ")} and ${named[named.length - 1]} no longer apply`;
  return `${subject}, so what was recorded against ${named.length === 1 ? "it" : "them"} has been removed. Nothing was ticked on your behalf.`;
}

// ── PUBLICATION READINESS ───────────────────────────────────────────────────────────────────────────
//
// The same three-state shape as publish-constants.ts and knowledge-constants.ts, and the same reason:
// A CHECK NOBODY CAN PERFORM MUST SAY "NOT CHECKED". Never a green tick, never silence.
//
//   engine    A fact about this checklist's own rows that only code reading several of them can see.
//   database  ⚠ A fact enforced by a CONSTRAINT, reported here so somebody sees the gap before they try.
//             THE ENGINE DOES NOT RE-IMPLEMENT THESE.
//   build     A fact about this code. No configuration changes it.
//   absent    ⚠ NOT CHECKABLE. No column and no store can answer, so nothing here pretends to.

export type ChecklistCheckSeverity = "blocker" | "warning" | "advisory";
export type ChecklistCheckAuthority = "engine" | "database" | "build" | "absent";

export type ChecklistCheckDefinition = {
  code: string;
  requirement: string;
  severity: ChecklistCheckSeverity;
  authority: ChecklistCheckAuthority;
  detail: string;
  /** ⚠ Only for `absent`: exactly what would make this checkable, so the gap is actionable. */
  wouldNeed: string | null;
};

export const CHECKLIST_CHECKS: ChecklistCheckDefinition[] = [
  {
    code: "HAS_ITEMS",
    requirement: "There is at least one item to tick",
    severity: "blocker", authority: "engine",
    detail: "A checklist with no items is a title. Nothing in the database can see that a parent row has no children, so this is the engine's.",
    wouldNeed: null,
  },
  {
    code: "CONDITIONS_RESOLVE",
    requirement: "Every conditional item names an item that exists and comes before it",
    severity: "blocker", authority: "engine",
    detail: "A condition naming an item that is not on this checklist hides its item forever, and nobody would ever see the question. A condition naming a LATER item can never be true when its own item is reached, which is the same outcome by a slower route -- and forbidding backwards references is also what makes a cycle of conditions impossible to author.",
    wouldNeed: null,
  },
  {
    code: "CRITICAL_ITEMS_UNCONDITIONAL",
    requirement: "No item marked critical can be withdrawn by an answer",
    severity: "warning", authority: "engine",
    detail: "A critical item behind a condition is legitimate -- \"if there is a known allergy, confirm the plan\" is both -- so this is a warning and not a refusal. It is raised because a critical item that another answer can withdraw is a critical item that can be skipped without anything recording that it was skipped.",
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
    detail: "A checklist with no review date does not expire, it just quietly stops matching what the practice actually does -- and people keep ticking it. A warning rather than a blocker, because an equipment checklist for a machine the practice will own for twenty years genuinely may not need one.",
    wouldNeed: null,
  },
  {
    code: "APPROVAL_LINKED",
    requirement: "An approval record is attached",
    severity: "blocker", authority: "database",
    detail: "`practice_checklist_in_force` refuses a published row with no approval_request_id. Nothing in this engine repeats that rule -- it reports it, and when somebody tries anyway the database refuses and the refusal is returned with the constraint named.",
    wouldNeed: null,
  },
  {
    code: "EFFECTIVE_FROM_SET",
    requirement: "An effective date is set",
    severity: "blocker", authority: "database",
    detail: "The same constraint. In use means in use, and from when is not a question somebody about to tick a safety checklist should have to guess at.",
    wouldNeed: null,
  },
  {
    code: "CODE_NOT_IN_USE",
    requirement: "No other published checklist holds this reference",
    severity: "blocker", authority: "database",
    detail: "`ux_practice_checklist_published_code` is a partial unique index over published rows only, so a practice may hold ten drafts of WHO-01 and exactly one in use. Publishing a new version therefore requires withdrawing the old one, in that order -- because two checklists in use under one reference is how half the theatre ticks a different list.",
    wouldNeed: null,
  },
  {
    code: "NOT_VERIFIED",
    requirement: "The checklist says plainly that a tick is a claim and nothing checks it",
    severity: "advisory", authority: "build",
    detail: "⚠ ALWAYS TRUE IN THIS BUILD, and printed rather than assumed. This product records what was ticked, by whom and when. It does not observe the step, compare the tick against anything, or raise anything when an item is left undone. This row does not depend on configuration and cannot be cleared.",
    wouldNeed: null,
  },
  {
    code: "COMPLETION_VERIFIED",
    requirement: "The items ticked were actually done",
    severity: "warning", authority: "absent",
    detail: "⚠ NOT CHECKED, AND IT NEVER WILL BE BY THIS BUILD. There is nothing in this product that observes a clinical step, and nothing that could corroborate a tick against another record. This row is not a pass, and it is a warning rather than an advisory because for a safety checklist it is the entire question.",
    wouldNeed: "An independent record of the step itself -- a device reading, a second person's countersignature against a named identity, or a linked clinical event -- plus a rule for what a disagreement between the two means. None of the three exists here.",
  },
  {
    code: "COMPLETION_REQUIRED",
    requirement: "Somebody is required to fill this in, and is chased if they do not",
    severity: "warning", authority: "absent",
    detail: "⚠ NOT CHECKED. Publishing a checklist puts it in the library. It does not attach it to a procedure, a clinic or a shift, and nothing notices that today's ward round checklist was never started. A checklist that nobody is required to complete is a checklist that gets completed when there is time.",
    wouldNeed: "A rule binding a checklist to an event or a schedule, and something that reads that rule when the event happens. Migration 196's doctrine applies -- nothing runs in a neglected practice -- so it would have to be derived at read time rather than fired overnight.",
  },
];

export const checklistCheck = (code: string) => CHECKLIST_CHECKS.find(c => c.code === code) ?? null;
export const CHECKLIST_CHECKS_NOT_CHECKABLE: string[] =
  CHECKLIST_CHECKS.filter(c => c.authority === "absent").map(c => c.code);
export const CHECKLIST_CHECKS_DATABASE_OWNED: string[] =
  CHECKLIST_CHECKS.filter(c => c.authority === "database").map(c => c.code);
export const CHECKLIST_CHECKS_BLOCKING: string[] =
  CHECKLIST_CHECKS.filter(c => c.severity === "blocker").map(c => c.code);

/** The constraints that own the `database` rows, named so a refusal can be recognised rather than guessed at. */
export const CHECKLIST_CONSTRAINTS = {
  inForce: "practice_checklist_in_force",
  publishedCode: "ux_practice_checklist_published_code",
  reviewAfterEffect: "practice_checklist_review_after_effect",
  archivedReason: "practice_checklist_archived_reason",
  runCompleted: "practice_checklist_run_completed",
  runAbandonedReason: "practice_checklist_run_abandoned_reason",
  responseNaReason: "practice_checklist_response_na_reason",
  responseOnce: "ux_practice_checklist_response_once",
  itemPosition: "ux_practice_checklist_item_position",
  itemKey: "ux_practice_checklist_item_key",
} as const;

/**
 * Tinted marks. Copied from knowledge-constants.ts rather than re-chosen, so that "not checked" looks
 * the same in all three places it now appears.
 *
 * ⚠ SLATE AND A HOLLOW MARK for not_checked. Never green, never a tick.
 */
export const CHECKLIST_CHECK_SWATCH: Record<string, { badge: string; text: string; box: string; icon: string }> = {
  pass: { badge: "bg-emerald-100 text-emerald-700", text: "text-emerald-700", box: "border-emerald-200/80 bg-emerald-50/60", icon: "✓" },
  fail: { badge: "bg-rose-100 text-rose-700", text: "text-rose-700", box: "border-rose-200/80 bg-rose-50/60", icon: "✕" },
  not_checked: { badge: "bg-slate-200 text-slate-700", text: "text-slate-600", box: "border-dashed border-slate-300 bg-slate-50/70", icon: "◌" },
};

export const CHECKLIST_STATE_SWATCH: Record<string, { chip: string; dot: string }> = {
  draft: { chip: "bg-slate-100 text-slate-700", dot: "bg-slate-400" },
  in_review: { chip: "bg-amber-100 text-amber-800", dot: "bg-amber-500" },
  approved: { chip: "bg-sky-100 text-sky-800", dot: "bg-sky-500" },
  published: { chip: "bg-emerald-100 text-emerald-800", dot: "bg-emerald-500" },
  archived: { chip: "bg-gray-100 text-gray-500", dot: "bg-gray-400" },
};

/**
 * The marks for an ANSWER. ⚠ `not_answered` and `did_not_apply` are visually distinct from each other
 * and neither is green -- an unanswered item and a withdrawn one mean opposite things and rendering both
 * as an empty box is how a printed record loses the difference.
 */
export const CHECKLIST_RESPONSE_SWATCH: Record<string, { chip: string; icon: string }> = {
  done: { chip: "bg-emerald-100 text-emerald-800", icon: "✓" },
  not_done: { chip: "bg-rose-100 text-rose-800", icon: "✕" },
  not_applicable: { chip: "bg-slate-200 text-slate-700", icon: "–" },
  not_answered: { chip: "border border-dashed border-amber-300 bg-amber-50 text-amber-800", icon: "◌" },
  did_not_apply: { chip: "border border-dashed border-slate-300 bg-slate-50 text-slate-500", icon: "◌" },
};

// ── ENGINE 5's SIX CAPABILITIES, ONE BY ONE ─────────────────────────────────────────────────────────
//
// ⚠ EVERY ONE OF THE SIX IS DECLARED, INCLUDING THE ONE THAT IS PARTLY TRUE. Engine 5 asks for tick
// boxes, conditional items, mandatory items, electronic completion, printing and mobile mode. Five are
// built. "Printing" in section 3's Publishing Engine also lists PNG, JPEG, Word and "interactive", and
// none of those exists anywhere in this product -- so printing is declared as what it actually is.

export const CHECKLIST_ENGINE_CAPABILITIES: { name: string; state: "built" | "partial" | "absent"; how: string }[] = [
  { name: "Tick boxes", state: "built",
    how: "Three answers -- Done, Not done, Not applicable. Not applicable needs words, and the database refuses it without them." },
  { name: "Conditional items", state: "built",
    how: "The same three condition shapes as the registration form, evaluated by the same imported function on the server and on the screen. A withdrawn item's answer is removed and the removal is said out loud." },
  { name: "Mandatory items", state: "built",
    how: "An item can be required, critical, or both. Required means a completion record cannot be closed without an answer. Critical means the answer is carried onto the record and the printed page whatever it was." },
  { name: "Electronic completion", state: "built",
    how: "A completion record with a start, a finish, the person who closed it and one row per answer. ⚠ It records what was ticked. It does not check anything." },
  { name: "Printing", state: "partial",
    how: "Print-to-PDF through the browser, for a blank checklist and for a completed record. Section 3 also lists PNG, JPEG, Word and an interactive export -- none of those exists in this product and none is implied here." },
  { name: "Mobile mode", state: "built",
    how: "CSS. The run screen is a single column with full-width answer controls below the small breakpoint, and nothing on it is hidden on a small screen -- a checklist that hides items on a phone is a checklist somebody completes without seeing them." },
];

// ── THE LIBRARY'S FACETS (CPR-KS-001 section 8, "Asset Library") ────────────────────────────────────
//
// The same eight section 8 asks for, and the same two that have nothing behind them. Declared rather
// than quietly omitted: a filter control that returns whatever it likes is worse than a missing one,
// because somebody narrows a search with it and believes the result.

export const CHECKLIST_FACETS: { key: string; label: string; state: "live" | "absent"; detail: string; wouldNeed: string | null }[] = [
  { key: "type", label: "Kind", state: "live", wouldNeed: null,
    detail: "The nine checklist kinds, from the column's own CHECK constraint." },
  { key: "status", label: "Status", state: "live", wouldNeed: null,
    detail: "The five states, from the column's own CHECK constraint." },
  { key: "specialty", label: "Specialty", state: "live", wouldNeed: null,
    detail: "Free text on the checklist, the same column practice_note_template uses." },
  { key: "tags", label: "Tags", state: "live", wouldNeed: null,
    detail: "Free tags. This is also where a condition or a disease goes today." },
  { key: "author", label: "Author", state: "live", wouldNeed: null,
    detail: "Who created it, resolved to a name." },
  { key: "version", label: "Version", state: "live", wouldNeed: null,
    detail: "Every version is a row of its own, linked by supersedes_id, so an earlier version is a checklist you can open rather than a diff to reconstruct." },
  { key: "disease", label: "Disease", state: "absent",
    detail: "⚠ NOT OFFERED. Nothing joins a checklist to a coded condition. A disease is a tag here, which is a word somebody typed -- searching it finds checklists that happen to use the same spelling and misses the ones that do not.",
    wouldNeed: "A coded condition vocabulary linked to checklist rows, and a decision about which coding system." },
  { key: "age", label: "Age", state: "absent",
    detail: "⚠ NOT OFFERED. There is no age band on a checklist and no age-band vocabulary anywhere in this schema. A paediatric checklist is paediatric because its items say so, in words, and nothing here reads that.",
    wouldNeed: "An age-applicability column with an agreed set of bands, and a rule for what an unset one means." },
];

export const CHECKLIST_FACETS_LIVE: string[] = CHECKLIST_FACETS.filter(f => f.state === "live").map(f => f.key);
export const CHECKLIST_FACETS_ABSENT: string[] = CHECKLIST_FACETS.filter(f => f.state === "absent").map(f => f.key);

/**
 * ⚠ WHAT THIS PHASE KNOWINGLY DOES NOT DO, WRITTEN DOWN SO IT IS A DECISION RATHER THAN AN OVERSIGHT.
 *
 * Each of these was considered and left, and each is on the screen. A gap recorded only in a commit
 * message is a gap the next person rediscovers as a bug.
 */
export const CHECKLIST_KNOWN_GAPS: { gap: string; why: string; wouldNeed: string }[] = [
  {
    gap: "A merged patient's completion records still point at the record that was merged away.",
    why: "mergePatients() repoints a fixed list of child tables and this one is not on it. The patient row is never deleted -- it is marked `merged` with `merged_into_patient_id` -- so nothing is lost, but a completion record found through the surviving patient will not include it.",
    wouldNeed: "practice_checklist_run added to the repointing list in patients.ts, with a migration-free backfill for records already made.",
  },
  {
    gap: "Nothing binds a checklist to the event it is meant to accompany.",
    why: "Publishing puts it in the library. It does not attach it to a procedure, a clinic or a shift, so nothing offers it at the moment it is wanted and nothing notices it was never started. This is COMPLETION_REQUIRED, and it is permanently not_checked.",
    wouldNeed: "A binding table between a checklist and an event kind, read at the point the event happens -- derived rather than fired, following migration 196.",
  },
  {
    gap: "There is no evidence capture on an item.",
    why: "checklist_items (migration 020) carries `evidence_required` and the competency tier has an evidence store behind it. The practice tier has no equivalent for this, and an evidence field with nowhere to put a file is a prompt that loses somebody's photograph.",
    wouldNeed: "A per-item attachment into practice_library_document's storage, plus a rule about who may read an attachment on a completion record.",
  },
  {
    gap: "A completion record carries one person, not two.",
    why: "The person who closed it is recorded. A second person confirming, which is what a surgical safety pause actually is, would need a countersignature -- and a countersignature that is not tied to a re-authenticated identity is a second name typed by the first person.",
    wouldNeed: "A countersignature row tied to a fresh authentication, which is a security piece rather than a checklist piece.",
  },
];

/**
 * ⚠ WHAT THE FIVE PERMISSION ROLES OF SECTION 3 ACTUALLY ARE HERE, SAID PLAINLY.
 *
 * Section 3 names Owner . Reviewer . Approver . Editor . Viewer, and this build has three capabilities
 * and one assignable approver. Pretending otherwise on screen would be a permission model somebody
 * relies on.
 */
export const CHECKLIST_ROLE_REALITY: { role: string; provided: boolean; how: string }[] = [
  { role: "Owner", provided: true, how: "A named person on the checklist. Accountability, not permission -- it grants and restricts nothing." },
  { role: "Reviewer", provided: true, how: "The assignee on the approval request. The same person as the Approver: migration 208 supports one assignee and one decision." },
  { role: "Approver", provided: true, how: "As above. ⚠ A multi-step chain of different approvers is NOT built and would need a migration." },
  { role: "Editor", provided: true, how: "Anybody with template.manage. It is not per-checklist." },
  { role: "Viewer", provided: true, how: "Anybody with document.view. ⚠ Filling one in takes task.manage, which is a wider group -- see the header for why that code and not a new one." },
];
