/**
 * Practice Checklists harness -- CPR-KS-001 Phase 2 (Engine 5), plus section 8's library.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────────────
 * ⚠ THIS HARNESS HAS TWO BRANCHES AND IT ASKS THE DATABASE WHICH ONE TO RUN.
 *
 * The store for this phase (practice_checklist + _item + _run + _response) is a migration that has not
 * been written yet -- the DDL is in the header of src/lib/practice/checklist.ts. Rather than assert "the
 * store is absent", which would become FALSE the day the migration lands and would then have to be
 * edited to keep passing, this asks the database and asserts THE ENGINE AGREES WITH IT:
 *
 *   absent   -- every read reports absent rather than empty, and every write refuses by name.
 *   present  -- the whole loop: author, condition, approve, publish, fill in, withdraw an answer, close
 *               with a critical item not done, revise, supersede, and be refused across a tenancy.
 *
 * Assertion 0 pins the branch to the live probe, so neither branch can pass by being skipped.
 *
 * WHAT IT PROVES IN BOTH BRANCHES:
 *   1. Engine 5's NINE kinds and SIX capabilities, written out rather than counted.
 *   2. ⚠ THE NAME. Nothing user-facing calls this a studio, a designer, a verification, an assurance or
 *      a sign-off -- every exported sentence is scanned, and the scanner itself is proven to work.
 *   3. ⚠ THE CONDITION EVALUATOR IS THE REGISTRATION FORM'S, PROVEN BY IDENTITY (===) rather than by
 *      grep. A rule written twice is a rule that will one day be written differently.
 *   4. ⚠ A WITHDRAWN ITEM'S ANSWER IS THROWN AWAY, the clearing cascades, and what went is NAMED.
 *   5. ⚠ FOUR OUTCOMES PER ITEM AND NEVER A BLANK. "Nobody reached it" and "it did not apply" are
 *      different things and are rendered differently on screen and on paper.
 *   6. ⚠ A CRITICAL ITEM RECORDED AS NOT DONE DOES NOT BLOCK CLOSURE -- it is recorded, by name.
 *   7. ⚠ TWO CHECKS CAN NEVER BE ANSWERED AND ARE NEVER GREEN: whether the ticks were true, and whether
 *      anybody was required to fill it in at all.
 *   8. A FAILED OR ABSENT READ IS NEVER A ZERO.
 *   9. NO CAPABILITY CODE WAS INVENTED -- all three asserted against the LIVE catalogue -- and filling a
 *      checklist in is a DIFFERENT and WIDER permission than authoring one.
 *
 *   npx --yes tsx scripts/practice-checklist-harness.ts
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
import {
  checklistStorePresence, checklistLibrary, getChecklist, getChecklistRun,
  createChecklist, updateChecklist, submitChecklistForApproval, withdrawChecklistFromReview,
  syncChecklistApproval, publishChecklist, archiveChecklist, reviseChecklist,
  startChecklistRun, recordResponses, completeChecklistRun, abandonChecklistRun,
  renderChecklist, runCompleteness, checklistReadiness, answerMap,
  CHECKLIST_TABLE, CHECKLIST_ITEM_TABLE, CHECKLIST_RUN_TABLE, CHECKLIST_RESPONSE_TABLE, CHECKLIST_TABLES,
  type ChecklistItemRow,
} from "../src/lib/practice/checklist";
import {
  conditionMet, resolveApplicable, applicableItems, checklistClearedNotice,
  CHECKLIST_KINDS, CHECKLIST_KIND_CODES, CHECKLIST_STATES, CHECKLIST_STATE_CODES,
  CHECKLIST_STATES_EDITABLE, CHECKLIST_STATES_USABLE, CHECKLIST_TRANSITIONS,
  CHECKLIST_RESPONSES, CHECKLIST_RESPONSE_CODES, CHECKLIST_RESPONSE_SWATCH,
  CHECKLIST_SUBJECTS, CHECKLIST_RUN_STATES, CHECKLIST_CHECKS, CHECKLIST_CHECKS_NOT_CHECKABLE,
  CHECKLIST_CHECKS_DATABASE_OWNED, CHECKLIST_CHECK_SWATCH, CHECKLIST_FACETS, CHECKLIST_FACETS_LIVE,
  CHECKLIST_FACETS_ABSENT, CHECKLIST_CAPABILITY_CODES, CHECKLIST_CAPABILITIES,
  CHECKLIST_ENGINE_CAPABILITIES, CHECKLIST_FORBIDDEN_CLAIMS, CHECKLIST_KNOWN_GAPS,
  CHECKLIST_ROLE_REALITY, CHECKLIST_NOT_VERIFIED, CHECKLIST_MODULE_NAME, CHECKLIST_LIBRARY_NAME,
  CHECKLIST_RUN_NAME, CHECKLIST_ROUTE, checklistCanMove, checklistMovesFrom,
} from "../src/lib/practice/checklist-constants";

loadEnvConfig(process.cwd());

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("Supabase env not set"); process.exit(1); }
const admin = createClient(url, key, { auth: { persistSession: false } });

const AUTHOR = "00000000-0000-4000-8000-0000000e5501";
const COLLEAGUE = "00000000-0000-4000-8000-0000000e5502";
const OTHER = "00000000-0000-4000-8000-0000000e5503";

let pass = 0;
const fails: string[] = [];
const ok = (label: string, cond: boolean, detail = "") => {
  if (cond) { pass++; console.log(`  PASS  ${label}`); }
  else { fails.push(label); console.log(`  FAIL  ${label}${detail ? ` -- ${detail}` : ""}`); }
};

const base = { actorId: AUTHOR, correlationId: "harness-checklist" };

// ── The spec, written out. Changing the product must mean changing a document, not nudging a number. ──
const ENGINE_5_KINDS = [
  "who", "ward_round", "discharge", "procedure", "audit",
  "clinic", "inspection", "equipment", "cpd",
];
const ENGINE_5_CAPABILITIES = [
  "Tick boxes", "Conditional items", "Mandatory items",
  "Electronic completion", "Printing", "Mobile mode",
];
const SECTION_3_STATES = ["draft", "in_review", "approved", "published", "archived"];

// ── Fixtures for the pure assertions ─────────────────────────────────────────────────────────────────
const item = (over: Partial<ChecklistItemRow> & { item_key: string; position: number }): ChecklistItemRow => ({
  id: `id-${over.item_key}`, section: null, label: `Label for ${over.item_key}`,
  detail: null, required: true, is_critical: false, condition: null, ...over,
});

/** allergy -> allergy_plan -> allergy_drug. A chain, so the fixpoint has something to do. */
const CHAIN: ChecklistItemRow[] = [
  item({ item_key: "known_allergy", position: 1 }),
  item({ item_key: "allergy_plan", position: 2, condition: { when: "known_allergy", equals: "done" } }),
  item({ item_key: "allergy_drug", position: 3, condition: { when: "allergy_plan", isPresent: true } }),
  item({ item_key: "sponge_count", position: 4, is_critical: true }),
  item({ item_key: "extra_swab", position: 5, required: false }),
];
const answer = (item_id: string, response: string, note: string | null = null) =>
  ({ item_id, response, note });

const emptyDoc = { effective_from: null, review_on: null, status: "draft", approval_request_id: null };
const readyDoc = { effective_from: "2026-09-01", review_on: "2027-09-01", status: "approved", approval_request_id: "a-1" };
const approvedRequest = { status: "APPROVED" };
const pendingRequest = { status: "PENDING" };
const GOOD_ITEMS: ChecklistItemRow[] = [
  item({ item_key: "known_allergy", position: 1 }),
  item({ item_key: "allergy_plan", position: 2, condition: { when: "known_allergy", equals: "done" } }),
];

const payload = (name: string): IndividualRequest => ({
  displayName: name, countryCode: "UG", timezone: "Africa/Kampala", professionCode: "medical_doctor",
  defaultPracticeType: "clinic", locale: "en-UG", termsVersion: "t1", privacyNoticeVersion: "p1", source: "pilot",
});

async function provision(user: string, name: string, suffix: string): Promise<string> {
  const { data: req } = await admin.from("provisioning_request").insert({
    idempotency_key: `harness-checklist-${suffix}`, request_type: "pilot",
    actor_user_id: user, target_user_id: user, payload_hash: "harness", correlation_id: "harness-checklist",
  }).select("id").single();
  const run = await runProvisioning(admin, { id: req!.id, target_user_id: user, correlation_id: "harness-checklist", workspace_id: null }, payload(name));
  if (!run.ok || !run.workspaceId) throw new Error(`provisioning failed: ${run.errorCode}${run.detail ? " -- " + run.detail : ""}`);
  return run.workspaceId;
}

async function cleanup() {
  // ⚠ THE SHARED TEARDOWN (commit 1d1ef07e), not a hand-rolled one. It unpicks the six references that
  // restrict the workspace cascade, and it REPORTS anything that survives instead of discarding the
  // delete's error -- the defect that made eighty-one teardowns lie.
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
 * Every user-facing sentence this module exports. NOT the codes and NOT the comments -- the words a
 * practitioner actually reads.
 */
function userFacingSentences(): string[] {
  return [
    CHECKLIST_MODULE_NAME, CHECKLIST_LIBRARY_NAME, CHECKLIST_RUN_NAME,
    CHECKLIST_NOT_VERIFIED.headline, CHECKLIST_NOT_VERIFIED.detail, CHECKLIST_NOT_VERIFIED.onPaper,
    ...CHECKLIST_KINDS.flatMap(k => [k.label, k.meaning]),
    ...CHECKLIST_SUBJECTS.flatMap(s => [s.label, s.meaning]),
    ...CHECKLIST_RESPONSES.flatMap(r => [r.label, r.meaning]),
    ...CHECKLIST_STATES.flatMap(s => [s.label, s.meaning]),
    ...CHECKLIST_RUN_STATES.flatMap(s => [s.label, s.meaning]),
    ...CHECKLIST_TRANSITIONS.flatMap(t => [t.label, t.why]),
    ...CHECKLIST_CHECKS.flatMap(c => [c.requirement, c.detail, c.wouldNeed ?? ""]),
    ...CHECKLIST_FACETS.flatMap(f => [f.label, f.detail, f.wouldNeed ?? ""]),
    ...CHECKLIST_ENGINE_CAPABILITIES.flatMap(c => [c.name, c.how]),
    ...CHECKLIST_KNOWN_GAPS.flatMap(g => [g.gap, g.why, g.wouldNeed]),
    ...CHECKLIST_ROLE_REALITY.flatMap(r => [r.role, r.how]),
  ];
}

/** Which forbidden claims a body of text makes. Its own correctness is asserted at 2b-control. */
function forbiddenClaimsIn(sentences: string[]): string[] {
  const hay = sentences.join(" \n ").toLowerCase();
  return CHECKLIST_FORBIDDEN_CLAIMS.filter(w => hay.includes(w.toLowerCase()));
}

async function main() {
  console.log(`\n${CHECKLIST_MODULE_NAME} harness (CPR-KS-001 Phase 2, Engine 5)\n`);

  // ══ 0. WHICH BRANCH, AND IT IS THE DATABASE THAT DECIDES ═══════════════════════════════════════
  const presence = await checklistStorePresence(admin);
  // Asked directly, without the engine, so assertion 0 is not the engine marking its own homework.
  const directProbe = await Promise.all(CHECKLIST_TABLES.map(async t => {
    const { error } = await admin.from(t).select("id").limit(1);
    return { t, present: !error };
  }));
  const reallyPresent = directProbe.every(p => p.present);
  ok("0. the engine's view of the store is the DATABASE's view, not an assumption",
    presence.present === reallyPresent && (presence.state === "present") === reallyPresent,
    `engine=${presence.state} database=${JSON.stringify(directProbe)}`);
  console.log(`\n  -- store is ${presence.state.toUpperCase()} --\n`);

  // ══ 1. THE SPECIFICATION'S VOCABULARY, WRITTEN OUT ═════════════════════════════════════════════
  ok("1a. Engine 5's NINE checklist kinds, in the specification's order",
    CHECKLIST_KIND_CODES.join() === ENGINE_5_KINDS.join(), CHECKLIST_KIND_CODES.join(" "));
  ok("1a-control. and each carries a meaning distinguishing it from the eight beside it",
    CHECKLIST_KINDS.every(k => k.meaning.trim().length > 20) &&
    new Set(CHECKLIST_KINDS.map(k => k.meaning)).size === 9,
    CHECKLIST_KINDS.filter(k => k.meaning.trim().length <= 20).map(k => k.code).join(", "));

  ok("1b. Engine 5's SIX capabilities, every one declared",
    CHECKLIST_ENGINE_CAPABILITIES.map(c => c.name).join() === ENGINE_5_CAPABILITIES.join(),
    CHECKLIST_ENGINE_CAPABILITIES.map(c => c.name).join(" "));
  ok("1b-control. ⚠ AND EXACTLY ONE IS ONLY PARTLY BUILT -- Printing, which names the four exports that do not exist",
    CHECKLIST_ENGINE_CAPABILITIES.filter(c => c.state === "partial").map(c => c.name).join() === "Printing" &&
    /PNG|JPEG|Word/.test(CHECKLIST_ENGINE_CAPABILITIES.find(c => c.name === "Printing")?.how ?? ""),
    CHECKLIST_ENGINE_CAPABILITIES.filter(c => c.state !== "built").map(c => `${c.name}=${c.state}`).join(" "));

  ok("1c. the three answers, and there is no fourth",
    CHECKLIST_RESPONSE_CODES.join() === "done,not_done,not_applicable", CHECKLIST_RESPONSE_CODES.join(" "));
  ok("1c-b. ⚠ and 'not applicable' is the one that needs words",
    CHECKLIST_RESPONSES.filter(r => r.needsNote).map(r => r.code).join() === "not_applicable");

  // ══ 2. ⚠ THE NAME. THE USER'S RULING, ASSERTED RATHER THAN REMEMBERED ══════════════════════════
  const sentences = userFacingSentences();
  ok("2a. ⚠ NOTHING USER-FACING CALLS THIS A STUDIO, A DESIGNER OR A BUILDER -- the asset is named for what it produces",
    !/studio|designer|builder/i.test(sentences.join(" ")),
    sentences.filter(s => /studio|designer|builder/i.test(s)).join(" | "));
  ok("2b. ⚠ AND NO EXPORTED SENTENCE CLAIMS VERIFICATION, ASSURANCE, COMPLIANCE OR A SIGN-OFF",
    forbiddenClaimsIn(sentences).length === 0,
    `claimed: ${forbiddenClaimsIn(sentences).join(", ")}`);
  // ⚠ CONTROL, AND IT IS THE ONE THAT MATTERS. 2b would pass just as well against a scanner that never
  // matched anything -- which is exactly how a vacuous assertion looks from the outside. This proves the
  // scanner reads what it is given.
  ok("2b-control. and the scanner really does find those words when they are there",
    forbiddenClaimsIn(["this record is verified and the practice is compliant"]).sort().join() === "compliant,verified",
    forbiddenClaimsIn(["this record is verified and the practice is compliant"]).join(", "));
  ok("2c. the not-verified notice exists in three forms, and the paper one is one line",
    CHECKLIST_NOT_VERIFIED.headline.length > 20 && CHECKLIST_NOT_VERIFIED.detail.length > 120 &&
    CHECKLIST_NOT_VERIFIED.onPaper.length > 20 && CHECKLIST_NOT_VERIFIED.onPaper.length < 160,
    `${CHECKLIST_NOT_VERIFIED.onPaper.length} characters on paper`);
  ok("2d. a filled-in checklist is called a completion record",
    CHECKLIST_RUN_NAME === "completion record", CHECKLIST_RUN_NAME);

  // ══ 3. ⚠ ONE EVALUATOR, PROVEN BY IDENTITY ═════════════════════════════════════════════════════
  //
  // ⚠ `===` ON THE FUNCTION OBJECT, not a grep for the name and not a behavioural comparison. Two
  // copies of a rule can behave identically on the day they are written -- that is precisely why the
  // drift is not noticed until later. Only identity proves there is one.
  ok("3a. ⚠ THE CHECKLIST'S conditionMet IS THE REGISTRATION FORM'S, THE SAME FUNCTION OBJECT",
    conditionMet === registrationConditionMet,
    "the checklist module exports a different function object -- there are two evaluators");
  ok("3a-b. ⚠ AND SO IS resolveApplicable, so the fixpoint is one implementation too",
    resolveApplicable === registrationResolveApplicable,
    "the checklist module exports a different resolver");
  // The cast is to `unknown` so TypeScript will compare two differently-typed function objects at all.
  // The comparison is the point: applicableItems is an ADAPTER and must not be the resolver itself.
  ok("3a-c. ⚠ AND applicableItems IS AN ADAPTER OVER IT, not a second resolver -- it is not that function",
    (applicableItems as unknown) !== (registrationResolveApplicable as unknown) &&
    typeof applicableItems === "function");

  // The three shapes, over RESPONSE CODES -- which is the thing the spec does not say and this build had
  // to decide.
  ok("3b. `equals` compares against a response code",
    conditionMet({ when: "known_allergy", equals: "done" }, { known_allergy: "done" }) &&
    !conditionMet({ when: "known_allergy", equals: "done" }, { known_allergy: "not_done" }));
  ok("3b-b. `in` admits any of several response codes",
    conditionMet({ when: "a", in: ["done", "not_applicable"] }, { a: "not_applicable" }) &&
    !conditionMet({ when: "a", in: ["done", "not_applicable"] }, { a: "not_done" }));
  ok("3b-c. `isPresent` means the item has been answered at all",
    conditionMet({ when: "a", isPresent: true }, { a: "not_done" }) &&
    !conditionMet({ when: "a", isPresent: true }, {}));

  // ⚠ 3c. THE LESSON THE REGISTRATION FIX PAID FOR.
  const chained = applicableItems(CHAIN, { known_allergy: "done", allergy_plan: "done", allergy_drug: "done" });
  ok("3c-control. CONTROL: while the condition holds, every item in the chain is drawn and keeps its answer",
    chained.applicable.length === 5 && chained.answers.allergy_drug === "done",
    chained.applicable.map(i => i.item_key).join(" "));

  const withdrawn = applicableItems(CHAIN, { known_allergy: "not_done", allergy_plan: "done", allergy_drug: "done" });
  ok("3c. ⚠ A WITHDRAWN ITEM'S ANSWER IS THROWN AWAY, NOT MERELY HIDDEN",
    !("allergy_plan" in withdrawn.answers),
    JSON.stringify(withdrawn.answers));
  ok("3d. ⚠ AND THE CLEARING CASCADES -- clearing one answer withdraws the next item along, which is what the fixpoint is for",
    !("allergy_drug" in withdrawn.answers) && withdrawn.applicable.length === 3,
    `${withdrawn.applicable.map(i => i.item_key).join(" ")} | ${JSON.stringify(withdrawn.answers)}`);
  ok("3e. what was thrown away is NAMED, and only what actually had an answer",
    withdrawn.cleared.map(i => i.item_key).sort().join() === "allergy_drug,allergy_plan",
    withdrawn.cleared.map(i => i.item_key).join(" "));
  // ⚠ AND AN ITEM NOBODY EVER ANSWERED IS NOT REPORTED AS CLEARED. Telling somebody their answer was
  // removed when they never gave one is a false sentence on a screen.
  const neverAnswered = applicableItems(CHAIN, { known_allergy: "not_done" });
  ok("3e-b. an item nobody answered is not reported as cleared",
    neverAnswered.cleared.length === 0, neverAnswered.cleared.map(i => i.item_key).join(" "));

  ok("3f. the notice names each item and says the answer was removed",
    (checklistClearedNotice(["Allergy plan", "Allergy drug"]) ?? "").includes("Allergy plan") &&
    /removed/.test(checklistClearedNotice(["Allergy plan"]) ?? ""),
    checklistClearedNotice(["Allergy plan", "Allergy drug"]) ?? "null");
  ok("3f-b. and nothing is said when nothing was thrown away",
    checklistClearedNotice([]) === null && checklistClearedNotice(["  "]) === null);
  // ⚠ THE SENTENCE IS THIS MODULE'S AND THE RULE IS NOT. clearedNotice says "what was TYPED there",
  // which is true of a registration form and false of a tick -- every user-facing sentence has to be
  // true today. The RULE is asserted as shared at 3a and 3a-b.
  ok("3f-c. ⚠ the sentence is the checklist's own, because a tick is not typed",
    !/typed/.test(checklistClearedNotice(["X"]) ?? "") &&
    /typed/.test(registrationClearedNotice(["X"]) ?? ""),
    `${checklistClearedNotice(["X"])} || ${registrationClearedNotice(["X"])}`);

  // ══ 4. RENDERING: FOUR OUTCOMES, NEVER A BLANK ═════════════════════════════════════════════════
  const partial = renderChecklist(CHAIN, [answer("id-known_allergy", "not_done")]);
  ok("4a. every item is rendered, whatever happened to it",
    partial.rendered.length === 5, String(partial.rendered.length));
  ok("4b. ⚠ 'NOBODY REACHED IT' AND 'IT DID NOT APPLY' ARE DIFFERENT STATES",
    partial.rendered.find(r => r.item_key === "sponge_count")?.state === "not_answered" &&
    partial.rendered.find(r => r.item_key === "allergy_plan")?.state === "did_not_apply",
    partial.rendered.map(r => `${r.item_key}=${r.state}`).join(" "));
  ok("4c. a withdrawn item names the item whose answer withdrew it, so the reason is readable",
    partial.rendered.find(r => r.item_key === "allergy_plan")?.withheldBy === "Label for known_allergy",
    String(partial.rendered.find(r => r.item_key === "allergy_plan")?.withheldBy));
  ok("4d. ⚠ AND THE TWO MARKS ARE DIFFERENT FROM EACH OTHER AND NEITHER IS GREEN OR A TICK",
    CHECKLIST_RESPONSE_SWATCH.not_answered.chip !== CHECKLIST_RESPONSE_SWATCH.did_not_apply.chip &&
    !/emerald|green/.test(JSON.stringify(CHECKLIST_RESPONSE_SWATCH.not_answered)) &&
    !/emerald|green/.test(JSON.stringify(CHECKLIST_RESPONSE_SWATCH.did_not_apply)) &&
    CHECKLIST_RESPONSE_SWATCH.not_answered.icon !== "✓" && CHECKLIST_RESPONSE_SWATCH.did_not_apply.icon !== "✓",
    JSON.stringify([CHECKLIST_RESPONSE_SWATCH.not_answered, CHECKLIST_RESPONSE_SWATCH.did_not_apply]));
  // CONTROL. 4b-4d would pass just as well against a renderer that said "not answered" to everything.
  const answered = renderChecklist(CHAIN, [
    answer("id-known_allergy", "done"), answer("id-allergy_plan", "done"),
    answer("id-allergy_drug", "not_applicable", "no drug was given"),
    answer("id-sponge_count", "done"),
  ]);
  ok("4-control. ⚠ WITH ANSWERS, EVERY ANSWERED ITEM CARRIES ITS OWN ANSWER",
    answered.rendered.find(r => r.item_key === "allergy_drug")?.state === "not_applicable" &&
    answered.rendered.find(r => r.item_key === "allergy_drug")?.note === "no drug was given" &&
    answered.rendered.filter(r => r.state === "did_not_apply").length === 0,
    answered.rendered.map(r => `${r.item_key}=${r.state}`).join(" "));
  ok("4e. answerMap keys answers by item_key and values them by response code, which is what a condition names",
    JSON.stringify(answerMap(CHAIN, [answer("id-sponge_count", "not_done")])) === '{"sponge_count":"not_done"}',
    JSON.stringify(answerMap(CHAIN, [answer("id-sponge_count", "not_done")])));

  // ══ 5. COMPLETENESS: WHAT BLOCKS CLOSURE AND WHAT MERELY GETS RECORDED ═════════════════════════
  const halfDone = runCompleteness(CHAIN, [answer("id-known_allergy", "not_done")]);
  ok("5a. an unanswered REQUIRED item blocks closure, and it is NAMED rather than counted",
    !halfDone.closeable && halfDone.outstanding.map(i => i.item_key).join() === "sponge_count",
    halfDone.outstanding.map(i => i.item_key).join(" "));
  ok("5b. an item the conditions withdrew is not outstanding, and it is reported separately",
    halfDone.didNotApply.map(i => i.item_key).sort().join() === "allergy_drug,allergy_plan",
    halfDone.didNotApply.map(i => i.item_key).join(" "));
  ok("5c. an OPTIONAL unanswered item does not block closure",
    !halfDone.outstanding.some(i => i.item_key === "extra_swab"),
    halfDone.outstanding.map(i => i.item_key).join(" "));

  // ⚠ 5d. THE MOST CONSEQUENTIAL DECISION IN THE ENGINE.
  const criticalMissed = runCompleteness(CHAIN, [
    answer("id-known_allergy", "not_done"), answer("id-sponge_count", "not_done", "count was two short"),
  ]);
  ok("5d. ⚠ A CRITICAL ITEM RECORDED AS NOT DONE DOES NOT BLOCK CLOSURE -- a checklist that cannot be closed with a step undone is one people close by ticking the box",
    criticalMissed.closeable, JSON.stringify(criticalMissed.outstanding.map(i => i.item_key)));
  ok("5d-b. ⚠ BUT IT IS RECORDED, BY NAME, AND NEVER COLLAPSED INTO A NUMBER",
    criticalMissed.criticalNotDone.map(i => i.item_key).join() === "sponge_count" &&
    criticalMissed.criticalNotDone[0].note === "count was two short",
    criticalMissed.criticalNotDone.map(i => i.item_key).join(" "));
  ok("5-control. CONTROL: with everything answered the record is closeable and nothing is outstanding",
    runCompleteness(CHAIN, [
      answer("id-known_allergy", "done"), answer("id-allergy_plan", "done"),
      answer("id-allergy_drug", "done"), answer("id-sponge_count", "done"), answer("id-extra_swab", "done"),
    ]).closeable === true &&
    runCompleteness(CHAIN, [
      answer("id-known_allergy", "done"), answer("id-allergy_plan", "done"),
      answer("id-allergy_drug", "done"), answer("id-sponge_count", "done"), answer("id-extra_swab", "done"),
    ]).criticalNotDone.length === 0);
  ok("5e. the figures are the lengths of the lists beside them, not a second count",
    halfDone.applicable === 3 && halfDone.answered === 1,
    `${halfDone.answered} of ${halfDone.applicable}`);

  // ══ 6. PUBLICATION READINESS ═══════════════════════════════════════════════════════════════════
  const cold = checklistReadiness(emptyDoc, [], null);
  const warm = checklistReadiness(readyDoc, GOOD_ITEMS, approvedRequest);

  ok("6a. an empty checklist cannot be put into use, because a checklist with no items is a title",
    !cold.publishable && cold.checks.find(c => c.code === "HAS_ITEMS")?.state === "fail",
    JSON.stringify({ publishable: cold.publishable, blockers: cold.blockers }));

  const forward = checklistReadiness(readyDoc, [
    item({ item_key: "first", position: 1, condition: { when: "second", equals: "done" } }),
    item({ item_key: "second", position: 2 }),
  ], approvedRequest);
  ok("6b. ⚠ A CONDITION NAMING A LATER ITEM IS REFUSED -- it can never be true when its own item is reached",
    forward.checks.find(c => c.code === "CONDITIONS_RESOLVE")?.state === "fail" &&
    (forward.checks.find(c => c.code === "CONDITIONS_RESOLVE")?.detail ?? "").includes("first"),
    forward.checks.find(c => c.code === "CONDITIONS_RESOLVE")?.detail ?? "");
  const ghost = checklistReadiness(readyDoc, [
    item({ item_key: "only", position: 1, condition: { when: "nobody", equals: "done" } }),
  ], approvedRequest);
  ok("6b-b. and a condition naming an item that does not exist is refused too -- it would hide its item forever",
    ghost.checks.find(c => c.code === "CONDITIONS_RESOLVE")?.state === "fail",
    ghost.checks.find(c => c.code === "CONDITIONS_RESOLVE")?.detail ?? "");
  ok("6b-control. CONTROL: a condition naming an EARLIER item passes, so 6b is not passing on a check that refuses everything",
    warm.checks.find(c => c.code === "CONDITIONS_RESOLVE")?.state === "pass",
    warm.checks.find(c => c.code === "CONDITIONS_RESOLVE")?.detail ?? "");

  const criticalConditional = checklistReadiness(readyDoc, [
    item({ item_key: "allergy", position: 1 }),
    item({ item_key: "plan", position: 2, is_critical: true, condition: { when: "allergy", equals: "done" } }),
  ], approvedRequest);
  ok("6c. ⚠ A CRITICAL ITEM BEHIND A CONDITION IS A WARNING, NOT A REFUSAL -- \"if there is an allergy, confirm the plan\" is legitimately both",
    criticalConditional.checks.find(c => c.code === "CRITICAL_ITEMS_UNCONDITIONAL")?.state === "fail" &&
    criticalConditional.publishable,
    JSON.stringify({ publishable: criticalConditional.publishable }));

  ok("6d. ⚠ A LINKED APPROVAL IS NOT A DECIDED ONE, and only the engine can tell them apart",
    checklistReadiness(readyDoc, GOOD_ITEMS, pendingRequest).checks.find(c => c.code === "APPROVAL_DECIDED")?.state === "fail" &&
    checklistReadiness(readyDoc, GOOD_ITEMS, pendingRequest).checks.find(c => c.code === "APPROVAL_LINKED")?.state === "pass",
    "the database sees the link; the engine sees the decision");
  ok("6-control. ⚠ A FULLY PREPARED CHECKLIST IS PUBLISHABLE -- otherwise 6a-6d would pass against a check that refused everything",
    warm.publishable && warm.blockers === 0, JSON.stringify({ blockers: warm.blockers }));

  // ⚠ 7. THE ROWS THAT ARE NEVER GREEN.
  ok("7a. ⚠ TWO CHECKS CAN NEVER BE ANSWERED BY ANYTHING IN THIS BUILD",
    CHECKLIST_CHECKS_NOT_CHECKABLE.join() === "COMPLETION_VERIFIED,COMPLETION_REQUIRED",
    CHECKLIST_CHECKS_NOT_CHECKABLE.join(" "));
  ok("7b. and they are `not_checked` on a fully prepared checklist too -- never quietly cleared by success",
    CHECKLIST_CHECKS_NOT_CHECKABLE.every(code =>
      cold.checks.find(c => c.code === code)?.state === "not_checked" &&
      warm.checks.find(c => c.code === code)?.state === "not_checked"),
    warm.checks.filter(c => CHECKLIST_CHECKS_NOT_CHECKABLE.includes(c.code)).map(c => `${c.code}=${c.state}`).join(" "));
  ok("7c. each says what it would take to become checkable, so the gap is actionable",
    CHECKLIST_CHECKS.filter(c => c.authority === "absent").every(c => (c.wouldNeed ?? "").trim().length > 40));
  ok("7d. ⚠ AND THE MARK FOR not_checked IS NOT GREEN AND IS NOT A TICK",
    !/emerald|green/.test(JSON.stringify(CHECKLIST_CHECK_SWATCH.not_checked)) &&
    CHECKLIST_CHECK_SWATCH.not_checked.icon !== CHECKLIST_CHECK_SWATCH.pass.icon &&
    CHECKLIST_CHECK_SWATCH.not_checked.icon !== "✓",
    JSON.stringify(CHECKLIST_CHECK_SWATCH.not_checked));
  ok("7e. every check declares who owns it, and no check is left without an authority",
    CHECKLIST_CHECKS.every(c => ["engine", "database", "build", "absent"].includes(c.authority)));
  ok("7f. the database-owned checks are the three the constraints actually own",
    CHECKLIST_CHECKS_DATABASE_OWNED.join() === "APPROVAL_LINKED,EFFECTIVE_FROM_SET,CODE_NOT_IN_USE",
    CHECKLIST_CHECKS_DATABASE_OWNED.join(" "));
  ok("7g. ⚠ the always-true row is a BUILD fact and is never a configuration one -- it cannot be cleared",
    CHECKLIST_CHECKS.find(c => c.code === "NOT_VERIFIED")?.authority === "build" &&
    warm.checks.find(c => c.code === "NOT_VERIFIED")?.state === "pass");

  // ══ 8. THE STATE LADDER AND ITS CLOSED GRAPH ═══════════════════════════════════════════════════
  ok("8a. CPR-KS-001 section 3's five states",
    CHECKLIST_STATE_CODES.join() === SECTION_3_STATES.join(), CHECKLIST_STATE_CODES.join(" "));
  ok("8a-note. ⚠ `in_review`, not `review` -- there is a review_on COLUMN meaning something else entirely",
    CHECKLIST_STATE_CODES.includes("in_review") && !CHECKLIST_STATE_CODES.includes("review"));
  ok("8b. every transition runs between two states that exist",
    CHECKLIST_TRANSITIONS.every(t => CHECKLIST_STATE_CODES.includes(t.from) && CHECKLIST_STATE_CODES.includes(t.to)),
    CHECKLIST_TRANSITIONS.filter(t => !CHECKLIST_STATE_CODES.includes(t.to)).map(t => t.to).join(", "));
  ok("8c. ⚠ ARCHIVED IS TERMINAL -- nothing comes back out of it",
    checklistMovesFrom("archived").length === 0, checklistMovesFrom("archived").map(t => t.to).join(", "));
  ok("8d. ⚠ A CHECKLIST IN USE CANNOT BE EDITED BACK INTO A DRAFT -- the forward path is a new version, because completion records were made against it",
    !checklistCanMove("published", "draft") && !checklistCanMove("published", "approved"));
  ok("8e. only a draft is editable, and only the published one can be filled in",
    CHECKLIST_STATES_EDITABLE.join() === "draft" && CHECKLIST_STATES_USABLE.join() === "published",
    `${CHECKLIST_STATES_EDITABLE.join(" ")} | ${CHECKLIST_STATES_USABLE.join(" ")}`);
  ok("8e-control. ⚠ AND A DRAFT IS NOT USABLE -- editable and usable are disjoint, so nothing can be filled in while it can still change",
    CHECKLIST_STATES.every(s => !(s.editable && s.usable)),
    CHECKLIST_STATES.filter(s => s.editable && s.usable).map(s => s.code).join(", "));
  ok("8f. a completion record has three states and abandoned is not completed",
    CHECKLIST_RUN_STATES.map(s => s.code).join() === "in_progress,completed,abandoned");

  // ══ 9. THE LIBRARY'S FACETS ════════════════════════════════════════════════════════════════════
  ok("9a. section 8 asks for eight facets and this offers six",
    CHECKLIST_FACETS.length === 8 && CHECKLIST_FACETS_LIVE.length === 6,
    `${CHECKLIST_FACETS_LIVE.length} live, ${CHECKLIST_FACETS_ABSENT.length} declared absent`);
  ok("9b. ⚠ DISEASE AND AGE ARE NOT OFFERED, because nothing behind them exists",
    CHECKLIST_FACETS_ABSENT.join() === "disease,age", CHECKLIST_FACETS_ABSENT.join(" "));
  ok("9c. and each absent facet says what it would take, rather than being silently missing",
    CHECKLIST_FACETS.filter(f => f.state === "absent").every(f => (f.wouldNeed ?? "").trim().length > 30));
  ok("9d. ⚠ the gaps this phase knowingly leaves are declared, each with what would close it",
    CHECKLIST_KNOWN_GAPS.length >= 4 &&
    CHECKLIST_KNOWN_GAPS.every(g => g.why.trim().length > 60 && g.wouldNeed.trim().length > 40),
    `${CHECKLIST_KNOWN_GAPS.length} gaps`);

  // ══ 10. NO CAPABILITY CODE WAS INVENTED -- ASSERTED AGAINST THE LIVE CATALOGUE ══════════════════
  const { data: caps } = await admin.from("practice_role_capabilities").select("role_code, capability_code").limit(2000);
  const rows = ((caps ?? []) as { role_code: string; capability_code: string }[]);
  const live = new Set(rows.map(c => c.capability_code));
  ok("10a. ⚠ EVERY CAPABILITY THIS MODULE NAMES IS SEEDED IN THE LIVE CATALOGUE",
    CHECKLIST_CAPABILITY_CODES.every(c => live.has(c)),
    CHECKLIST_CAPABILITY_CODES.filter(c => !live.has(c)).join(", ") || "all present");
  ok("10a-control. and the catalogue read actually returned codes",
    live.size >= 40, `${live.size} codes`);
  ok("10b. ⚠ NOTHING checklist.* WAS MINTED -- an invented code compiles, 403s for everybody, and errors nowhere",
    ![...live].some(c => c.startsWith("checklist.")),
    [...live].filter(c => c.startsWith("checklist.")).join(", "));

  // ⚠ 10c. THE SPLIT THAT MAKES THIS USABLE, ASSERTED AGAINST THE LIVE ROLE MAP RATHER THAN ASSUMED.
  // The person who does the ward round is often not the person who wrote the list, so completing must be
  // a wider permission than authoring. If it were not, an assistant could never tick anything.
  const rolesWith = (code: string) => new Set(rows.filter(r => r.capability_code === code).map(r => r.role_code));
  const authors = rolesWith(CHECKLIST_CAPABILITIES.manage);
  const completers = rolesWith(CHECKLIST_CAPABILITIES.complete);
  ok("10c. ⚠ FILLING ONE IN IS A DIFFERENT CAPABILITY FROM AUTHORING ONE",
    String(CHECKLIST_CAPABILITIES.complete) !== String(CHECKLIST_CAPABILITIES.manage),
    `${CHECKLIST_CAPABILITIES.complete} vs ${CHECKLIST_CAPABILITIES.manage}`);
  ok("10c-b. ⚠ AND IT IS HELD BY MORE ROLES, so the assistant who does the round can tick",
    completers.size > authors.size && [...authors].every(r => completers.has(r)),
    `complete=${[...completers].join(",")} manage=${[...authors].join(",")}`);
  ok("10c-control. and the approximation is DECLARED rather than hidden -- the role table on screen says so",
    CHECKLIST_ROLE_REALITY.some(r => r.how.includes(CHECKLIST_CAPABILITIES.complete)),
    CHECKLIST_ROLE_REALITY.map(r => r.how).join(" | ").slice(0, 200));

  // ══ 11. THE PAGES, AND THE NOTICE ON THE PAPER ═════════════════════════════════════════════════
  const shellDir = join(process.cwd(), "src", "app", "practice", "(shell)", "knowledge-studio", "checklists");
  ok("11a. the library page exists",
    existsSync(join(shellDir, "page.tsx")));
  ok("11b. the checklist, the completion record and BOTH print views exist",
    existsSync(join(shellDir, "[checklistId]", "page.tsx")) &&
    existsSync(join(shellDir, "[checklistId]", "print", "page.tsx")) &&
    existsSync(join(shellDir, "[checklistId]", "runs", "[runId]", "page.tsx")) &&
    existsSync(join(shellDir, "[checklistId]", "runs", "[runId]", "print", "page.tsx")));

  // ⚠ 11c. NO NEW TOP-LEVEL ROUTE. The nav catalogue is not this phase's to edit -- assertion 9f of the
  // activity harness forbids an entry before its page exists, and 9i flags a top-level page with no
  // entry. Filing this under the programme's own address means neither is disturbed and no navigation
  // claim is made before the user decides where it belongs.
  ok("11c. ⚠ NO NEW TOP-LEVEL PRACTICE ROUTE WAS CREATED, so no nav entry is claimed before it is wired",
    !existsSync(join(process.cwd(), "src", "app", "practice", "(shell)", "checklists")) &&
    CHECKLIST_ROUTE === "/practice/knowledge-studio/checklists",
    CHECKLIST_ROUTE);

  // ⚠ CHECKED IN THE SOURCE, because a reader of a printed checklist cannot see a screen banner.
  const blankPrint = readFileSync(join(shellDir, "[checklistId]", "print", "page.tsx"), "utf8");
  const recordPrint = readFileSync(join(shellDir, "[checklistId]", "runs", "[runId]", "print", "page.tsx"), "utf8");
  ok("11d. ⚠ THE 'NOTHING HERE CHECKS IT' NOTICE IS ON BOTH PRINTED PAGES, not only on screen",
    blankPrint.includes("notVerified.onPaper") && recordPrint.includes("notVerified.onPaper"),
    "onPaper is not referenced by one of the print routes");
  ok("11e. a blank copy of anything not in use prints marked, so a draft cannot be pinned up as the list people follow",
    /NOT IN USE/.test(blankPrint));
  ok("11f. an unfinished completion record prints marked too",
    /NOT FINISHED/.test(recordPrint));
  // ⚠ THIS ASSERTION WAS WRONG ON ITS FIRST DRAFT AND A BREAK CAUGHT IT. It read
  // `/Not answered/.test(recordPrint)`, and deleting the closed-record sentence LEFT IT GREEN, because
  // the open-record sentence "Not answered -- this record is not finished" contains the same words. A
  // regex that matches a neighbouring branch is testing that branch, not this one. All THREE
  // absent-answer sentences are now asserted separately, so removing any one of them turns this red.
  ok("11g. ⚠ AND THE RECORD NEVER PRINTS A BLANK BESIDE AN ITEM -- three separate sentences for the three ways an item can carry no answer",
    recordPrint.includes('"Not answered."') &&
    recordPrint.includes("this record is not finished") &&
    recordPrint.includes("Did not apply"),
    `closed=${recordPrint.includes('"Not answered."')} open=${recordPrint.includes("this record is not finished")} withdrawn=${recordPrint.includes("Did not apply")}`);
  ok("11h. ⚠ critical items recorded as not done are printed by NAME, not counted",
    /criticalNotDone/.test(recordPrint) && /Critical items recorded as not done/.test(recordPrint));

  // ⚠ 11i. THE RUN SCREEN IMPORTS THE EVALUATOR RATHER THAN CARRYING ITS OWN. Identity cannot be
  // asserted across a "use client" boundary from here, so the source is read: it must import the shared
  // adapter and must not define a condition evaluator of its own.
  const runScreen = readFileSync(join(shellDir, "[checklistId]", "runs", "[runId]", "ChecklistRun.tsx"), "utf8");
  ok("11i. ⚠ THE RUN SCREEN IMPORTS THE SHARED RESOLVER AND DEFINES NO EVALUATOR OF ITS OWN",
    /import\s*\{[^}]*applicableItems[^}]*\}\s*from\s*"@\/lib\/practice\/checklist-constants"/.test(runScreen) &&
    !/function\s+conditionMet|const\s+conditionMet\s*=/.test(runScreen),
    "the run screen either does not import the resolver or defines its own");
  ok("11j. and it clears in a handler rather than in an effect, because set-state-in-effect is an error in this project",
    /useCallback/.test(runScreen) && !/useEffect/.test(runScreen),
    "the run screen uses an effect");

  // ══ 12. THE BRANCH THE DATABASE CHOSE ══════════════════════════════════════════════════════════
  if (presence.state !== "present") {
    console.log("\n  -- STOPPED CLEANLY AT THE STORE. The absent branch follows. --\n");

    ok("12a. the absent state names EVERY missing table and the migration, rather than failing vaguely",
      presence.state === "absent" &&
      CHECKLIST_TABLES.every(t => (presence.detail ?? "").includes(t)),
      presence.detail ?? "");

    const lib = await checklistLibrary(admin, "00000000-0000-4000-8000-00000000feed");
    ok("12b. ⚠ THE LIBRARY REPORTS `absent`, NOT AN EMPTY SHELF",
      lib.state === "absent", lib.state);
    ok("12c. ⚠ AND IT DOES NOT RETURN A ROW OF ZEROED COUNTS. A figure of 0 beside 'In use' would be a claim about this practice that nothing here can make",
      lib.counts.length === 0 && lib.items.length === 0, JSON.stringify(lib.counts));
    ok("12d. the facets are still declared, so what the module WILL do is visible before it can do it",
      lib.facets.length === 8 && lib.facets.filter(f => f.state === "absent").length === 2);
    ok("12e. and the not-verified notice is carried on an absent library too",
      lib.notVerified.onPaper.length > 20);

    const created = await createChecklist(admin, {
      workspaceId: "00000000-0000-4000-8000-00000000feed",
      code: "WHO-01", title: "Probe", kind: "who", ...base,
    });
    ok("12f. ⚠ A WRITE REFUSES BY NAME WITH 503, rather than throwing a PostgREST error at somebody",
      !created.ok && created.code === "STORE_ABSENT" && created.status === 503,
      created.ok ? "it wrote something" : `${created.status} ${created.code}`);
    ok("12g. and the refusal names the missing migration, so the gap is actionable",
      !created.ok && /migration/i.test(created.message), created.ok ? "" : created.message);

    // ⚠ THE REFUSAL IS THE ENGINE'S OWN AND NOT AN ACCIDENT OF A BAD WORKSPACE ID. If STORE_ABSENT were
    // merely what this engine returns for everything, these two would say STORE_ABSENT too.
    const badKind = await createChecklist(admin, {
      workspaceId: "00000000-0000-4000-8000-00000000feed",
      code: "WHO-02", title: "Probe", kind: "flowchart", ...base,
    });
    ok("12f-control. ⚠ STORE_ABSENT IS NOT WHAT THIS ENGINE SAYS TO EVERYTHING -- a tenth kind is still refused as an unknown kind",
      !badKind.ok && badKind.code === "UNKNOWN_KIND", badKind.ok ? "accepted" : badKind.code);
    const badSubject = await createChecklist(admin, {
      workspaceId: "00000000-0000-4000-8000-00000000feed",
      code: "WHO-03", title: "Probe", kind: "who", runSubject: "room", ...base,
    });
    ok("12f-control-b. and a third kind of subject is refused as an unknown subject, ahead of the store",
      !badSubject.ok && badSubject.code === "UNKNOWN_SUBJECT", badSubject.ok ? "accepted" : badSubject.code);

    const detail = await getChecklist(admin, "00000000-0000-4000-8000-00000000feed", "00000000-0000-4000-8000-00000000beef");
    ok("12h. reading one checklist reports absent rather than not-found -- a missing store is not a missing checklist",
      detail.state === "absent", detail.state);
    const runDetail = await getChecklistRun(admin, "00000000-0000-4000-8000-00000000feed", "00000000-0000-4000-8000-00000000beef");
    ok("12i. and so does reading a completion record",
      runDetail.state === "absent", runDetail.state);

    console.log("\n  ⚠ NOT RUN, and they are the assertions that matter most once the store lands:");
    console.log("     the author -> approve -> publish -> fill in -> close loop, the unique-index refusal of");
    console.log("     a second checklist in use under one reference, the SERVER-SIDE clearing of a withdrawn");
    console.log("     answer, the database's refusal of \"not applicable\" with no reason, and tenancy.");
    console.log("     They are written below and run automatically the moment the migration is applied.\n");
    return report();
  }

  // ══ 13. THE PRESENT BRANCH: THE WHOLE LOOP ═════════════════════════════════════════════════════
  await cleanup();
  const wsA = await provision(AUTHOR, "HARNESS Checklist A (synthetic)", "a");
  const wsB = await provision(OTHER, "HARNESS Checklist B (synthetic)", "b");

  // A colleague, because nobody approves their own work.
  await admin.from("practice_membership").insert({
    workspace_id: wsA, user_id: COLLEAGUE, role_code: "practitioner", status: "active",
  });

  const g = await createChecklist(admin, {
    workspaceId: wsA, code: "WHO-01", title: "Before the knife goes in",
    kind: "who", runSubject: "none", purpose: "The pause before an incision.", tags: ["theatre"], ...base,
  });
  ok("13a. a checklist is created", g.ok, g.ok ? "" : g.message);
  if (!g.ok) return report();

  const { data: seeded } = await admin.from(CHECKLIST_ITEM_TABLE).select("id").eq("checklist_id", g.data.id);
  ok("13b. ⚠ AND IT STARTS WITH NO ITEMS. There is no correct starter list for a checklist, and inventing one would be this product suggesting clinical steps",
    ((seeded ?? []) as unknown[]).length === 0, String(((seeded ?? []) as unknown[]).length));

  const early = await submitChecklistForApproval(admin, { workspaceId: wsA, checklistId: g.data.id, assignedTo: COLLEAGUE, ...base });
  ok("13c. an empty checklist cannot go for approval -- sending one spends the one scarce thing in this loop, which is a colleague's attention",
    !early.ok && early.code === "NO_ITEMS", early.ok ? "sent" : early.code);

  const badCondition = await updateChecklist(admin, {
    workspaceId: wsA, checklistId: g.data.id,
    items: [{ itemKey: "first", label: "First", condition: { when: "second", equals: "done" } },
            { itemKey: "second", label: "Second" }],
    ...base,
  });
  ok("13d-setup. a list with a forward-pointing condition can be SAVED as a draft", badCondition.ok, badCondition.ok ? "" : badCondition.message);
  const badSubmit = await submitChecklistForApproval(admin, { workspaceId: wsA, checklistId: g.data.id, assignedTo: COLLEAGUE, ...base });
  ok("13d. ⚠ BUT IT CANNOT GO FOR APPROVAL -- a condition naming a later item hides its item silently, and no reviewer would ever see the question",
    !badSubmit.ok && badSubmit.code === "CONDITIONS_BROKEN", badSubmit.ok ? "sent" : badSubmit.code);

  const dupKeys = await updateChecklist(admin, {
    workspaceId: wsA, checklistId: g.data.id,
    items: [{ itemKey: "same", label: "One" }, { itemKey: "same", label: "Two" }], ...base,
  });
  ok("13e. two items may not share a name, because a condition naming it could not say which one it meant",
    !dupKeys.ok && dupKeys.code === "DUPLICATE_ITEM_KEY", dupKeys.ok ? "written" : dupKeys.code);

  const filled = await updateChecklist(admin, {
    workspaceId: wsA, checklistId: g.data.id, effectiveFrom: "2026-09-01", reviewOn: "2027-09-01",
    items: [
      { itemKey: "known_allergy", label: "Does the patient have a known allergy?", section: "Before induction" },
      { itemKey: "allergy_plan", label: "Confirm the allergy plan", section: "Before induction",
        isCritical: true, condition: { when: "known_allergy", equals: "done" } },
      { itemKey: "sponge_count", label: "Sponge count correct", section: "Before closing", isCritical: true },
      { itemKey: "specimen_labelled", label: "Specimen labelled", section: "Before closing", required: false },
    ],
    ...base,
  });
  ok("13f. CONTROL: a well-formed list is written, all four items of it",
    filled.ok && filled.data.itemsWritten === 4, filled.ok ? String(filled.data.itemsWritten) : filled.message);

  const badDates = await updateChecklist(admin, {
    workspaceId: wsA, checklistId: g.data.id, effectiveFrom: "2026-09-01", reviewOn: "2026-08-01", ...base,
  });
  ok("13g. ⚠ THE DATABASE REFUSES A REVIEW DATE ON OR BEFORE THE EFFECTIVE DATE, and the constraint is named",
    !badDates.ok && badDates.code === "REVIEW_BEFORE_EFFECT" && /review_after_effect/.test(badDates.message),
    badDates.ok ? "accepted" : badDates.message);

  const tooEarly = await startChecklistRun(admin, { workspaceId: wsA, checklistId: g.data.id, ...base });
  ok("13h. ⚠ A DRAFT CANNOT BE FILLED IN -- a record made against a list that changes the next morning is a record of nothing",
    !tooEarly.ok && tooEarly.code === "NOT_IN_USE", tooEarly.ok ? "started" : tooEarly.code);

  const sent = await submitChecklistForApproval(admin, { workspaceId: wsA, checklistId: g.data.id, assignedTo: COLLEAGUE, ...base });
  ok("13i. it goes for approval, through the EXISTING practice_approval_request", sent.ok, sent.ok ? "" : sent.message);
  if (!sent.ok) return report();
  const { data: req } = await admin.from("practice_approval_request").select("subject_kind, subject_id").eq("id", sent.data.approvalId).maybeSingle();
  ok("13i-b. ⚠ AS subject_kind 'other', WHICH MIGRATION 208 ALREADY ADMITS -- no approval migration was needed",
    req?.subject_kind === "other" && req?.subject_id === g.data.id, JSON.stringify(req));

  const frozen = await updateChecklist(admin, { workspaceId: wsA, checklistId: g.data.id, title: "Changed", ...base });
  ok("13j. ⚠ THE LIST IS FROZEN WHILE A COLLEAGUE READS IT",
    !frozen.ok && frozen.code === "NOT_EDITABLE", frozen.ok ? "edited" : frozen.code);

  const selfApprove = await decideApproval(admin, {
    workspaceId: wsA, approvalId: sent.data.approvalId, decision: "APPROVED", note: "Fine", ...base,
  });
  ok("13k. ⚠ NOBODY APPROVES THEIR OWN WORK, and the refusal is delegation.ts's rather than a second copy of it here",
    !selfApprove.ok && selfApprove.code === "SELF_APPROVAL", selfApprove.ok ? "approved" : selfApprove.code);

  const approved = await decideApproval(admin, {
    workspaceId: wsA, approvalId: sent.data.approvalId, decision: "APPROVED",
    note: "Reads well.", actorId: COLLEAGUE, correlationId: "harness-checklist",
  });
  ok("13l. CONTROL: a colleague can approve it", approved.ok, approved.ok ? "" : approved.message);

  await syncChecklistApproval(admin, { workspaceId: wsA, checklistId: g.data.id, ...base });
  const published = await publishChecklist(admin, { workspaceId: wsA, checklistId: g.data.id, ...base });
  ok("13m. it goes into use", published.ok, published.ok ? "" : published.message);
  if (!published.ok) return report();

  // ── FILLING IT IN ──────────────────────────────────────────────────────────────────────────────
  const wrongSubject = await startChecklistRun(admin, {
    workspaceId: wsA, checklistId: g.data.id, patientId: "00000000-0000-4000-8000-00000000dead", ...base,
  });
  ok("13n. ⚠ A CHECKLIST THAT IS NOT ABOUT A PATIENT REFUSES ONE -- naming a patient would put a theatre in somebody's file",
    !wrongSubject.ok && wrongSubject.code === "PATIENT_NOT_ALLOWED", wrongSubject.ok ? "started" : wrongSubject.code);

  const run = await startChecklistRun(admin, { workspaceId: wsA, checklistId: g.data.id, contextNote: "Theatre 2", ...base });
  ok("13o. a completion record is started, and it snapshots the version it is answering",
    run.ok && run.data.version === 1, run.ok ? String(run.data.version) : run.message);
  if (!run.ok) return report();

  const naNoReason = await recordResponses(admin, {
    workspaceId: wsA, runId: run.data.id,
    answers: [{ itemKey: "specimen_labelled", response: "not_applicable" }], ...base,
  });
  ok("13p. ⚠ 'NOT APPLICABLE' WITH NO WORDS IS REFUSED BY THE ENGINE -- it is the entry that hides a skipped step",
    !naNoReason.ok && naNoReason.code === "REASON_REQUIRED", naNoReason.ok ? "recorded" : naNoReason.code);

  // ⚠ AND THE DATABASE, WITH THE ENGINE BYPASSED ENTIRELY. This is the half that survives somebody
  // deleting the guard above, and it is asserted on the ERROR CODE and the CONSTRAINT NAME so it cannot
  // pass on some other refusal arriving at the same moment.
  const { data: specimenItem } = await admin.from(CHECKLIST_ITEM_TABLE)
    .select("id").eq("checklist_id", g.data.id).eq("item_key", "specimen_labelled").maybeSingle();
  const { error: rawNa } = await admin.from(CHECKLIST_RESPONSE_TABLE).insert({
    workspace_id: wsA, run_id: run.data.id, item_id: specimenItem?.id,
    response: "not_applicable", note: "   ",
  });
  ok("13p-db. ⚠ AND THE CONSTRAINT REFUSES A BLANK REASON WITH THE ENGINE BYPASSED -- 23514, by name",
    String(rawNa?.code) === "23514" && /practice_checklist_response_na_reason/.test(String(rawNa?.message)),
    rawNa ? `${rawNa.code} ${rawNa.message}` : "the raw insert was ACCEPTED");

  const criticalNoWords = await recordResponses(admin, {
    workspaceId: wsA, runId: run.data.id,
    answers: [{ itemKey: "sponge_count", response: "not_done" }], ...base,
  });
  ok("13q. ⚠ A CRITICAL ITEM RECORDED AS NOT DONE NEEDS WORDS, and this is the ENGINE's rule because is_critical lives on a sibling row a CHECK cannot see",
    !criticalNoWords.ok && criticalNoWords.code === "CRITICAL_REASON_REQUIRED",
    criticalNoWords.ok ? "recorded" : criticalNoWords.code);

  const allergyYes = await recordResponses(admin, {
    workspaceId: wsA, runId: run.data.id,
    answers: [{ itemKey: "known_allergy", response: "done" }, { itemKey: "allergy_plan", response: "done" }], ...base,
  });
  ok("13r-setup. with the allergy answered Done, the conditional item applies and its answer is kept",
    allergyYes.ok && allergyYes.data.written === 2 && allergyYes.data.cleared.length === 0,
    allergyYes.ok ? JSON.stringify(allergyYes.data.cleared) : allergyYes.message);

  // ⚠ 13r. THE SERVER-SIDE HALF OF THE REGISTRATION LESSON.
  const allergyNo = await recordResponses(admin, {
    workspaceId: wsA, runId: run.data.id,
    answers: [{ itemKey: "known_allergy", response: "not_done" }], ...base,
  });
  ok("13r. ⚠ CHANGING THE ANSWER WITHDRAWS THE CONDITIONAL ITEM AND ITS ANSWER IS DELETED ON THE SERVER, not merely hidden on the screen",
    allergyNo.ok && allergyNo.data.cleared.length === 1,
    allergyNo.ok ? JSON.stringify(allergyNo.data.cleared) : allergyNo.message);
  const { data: leftBehind } = await admin.from(CHECKLIST_RESPONSE_TABLE)
    .select("item_id").eq("run_id", run.data.id).eq("workspace_id", wsA);
  const { data: planItem } = await admin.from(CHECKLIST_ITEM_TABLE)
    .select("id").eq("checklist_id", g.data.id).eq("item_key", "allergy_plan").maybeSingle();
  ok("13r-b. ⚠ AND THE ROW IS GONE FROM THE DATABASE -- a stale answer is what makes the screen and the server disagree",
    !((leftBehind ?? []) as { item_id: string }[]).some(r => r.item_id === planItem?.id),
    JSON.stringify(leftBehind));

  const stillOpen = await completeChecklistRun(admin, { workspaceId: wsA, runId: run.data.id, ...base });
  ok("13s. an unanswered required item stops the record being closed, and it is named",
    !stillOpen.ok && stillOpen.code === "ITEMS_OUTSTANDING" && /Sponge count/.test(stillOpen.message),
    stillOpen.ok ? "closed" : stillOpen.message);

  await recordResponses(admin, {
    workspaceId: wsA, runId: run.data.id,
    answers: [{ itemKey: "sponge_count", response: "not_done", note: "count was two short" }], ...base,
  });
  const closed = await completeChecklistRun(admin, { workspaceId: wsA, runId: run.data.id, ...base });
  ok("13t. ⚠ A CRITICAL ITEM RECORDED AS NOT DONE DOES NOT STOP THE RECORD BEING CLOSED -- it is recorded instead, by name",
    closed.ok && closed.data.criticalNotDone.join() === "Sponge count correct",
    closed.ok ? JSON.stringify(closed.data.criticalNotDone) : closed.message);

  const afterClose = await recordResponses(admin, {
    workspaceId: wsA, runId: run.data.id, answers: [{ itemKey: "sponge_count", response: "done" }], ...base,
  });
  ok("13u. ⚠ A CLOSED RECORD CANNOT BE CHANGED -- altering it afterwards would make it a record of something else",
    !afterClose.ok && afterClose.code === "RUN_CLOSED", afterClose.ok ? "changed" : afterClose.code);

  // ⚠ THIS ASSERTION USED TO CLAIM AN ORDERING THE ENGINE NEVER HAD, and the claim was wrong rather than
  // the engine. `run` was completed at 13t, so a closed record refuses the change whatever reason is
  // given -- and RUN_CLOSED is the more useful thing to be told than "your reason was blank", because the
  // reason is not what stopped it. Reversing this to make the test pass would have taught the engine to
  // check a blank reason before checking whether the record was still open, which is backwards.
  const abandonClosed = await abandonChecklistRun(admin, { workspaceId: wsA, runId: run.data.id, reason: "  ", ...base });
  ok("13u-b. a CLOSED record refuses abandonment on being closed, not on the reason -- that is the useful answer",
    !abandonClosed.ok && abandonClosed.code === "RUN_CLOSED", abandonClosed.ok ? "abandoned" : abandonClosed.code);

  // ...and the blank-reason rule, tested where it can actually fire: on a run that is still open.
  const openRun = await startChecklistRun(admin, { workspaceId: wsA, checklistId: g.data.id, ...base });
  const abandonNoReason = openRun.ok
    ? await abandonChecklistRun(admin, { workspaceId: wsA, runId: openRun.data.id, reason: "  ", ...base })
    : { ok: false as const, code: "SETUP_FAILED", message: openRun.message };
  ok("13u-c. and an OPEN one refuses a blank reason, which is where that rule was always meant to bite",
    !abandonNoReason.ok && abandonNoReason.code === "REASON_REQUIRED",
    abandonNoReason.ok ? "abandoned" : abandonNoReason.code);

  // ── ONE REFERENCE, ONE CHECKLIST IN USE ────────────────────────────────────────────────────────
  //
  // ⚠ NO `if (…ok)` WRAPPER. Each setup step is asserted in its own right and the run stops if one
  // fails: a skipped assertion reads exactly like a passing one in a total.
  const g2 = await createChecklist(admin, { workspaceId: wsA, code: "WHO-01", title: "A rival", kind: "who", ...base });
  ok("13v-setup. a second draft may hold the SAME reference -- the index constrains published rows only",
    g2.ok, g2.ok ? "" : g2.message);
  if (!g2.ok) return report();
  await updateChecklist(admin, {
    workspaceId: wsA, checklistId: g2.data.id, effectiveFrom: "2026-09-01",
    items: [{ itemKey: "one_thing", label: "One thing" }], ...base,
  });
  const s2 = await submitChecklistForApproval(admin, { workspaceId: wsA, checklistId: g2.data.id, assignedTo: COLLEAGUE, ...base });
  ok("13v-setup-b. and it goes through the same approval as any other", s2.ok, s2.ok ? "" : s2.message);
  if (!s2.ok) return report();
  await decideApproval(admin, { workspaceId: wsA, approvalId: s2.data.approvalId, decision: "APPROVED", note: "ok", actorId: COLLEAGUE, correlationId: "harness-checklist" });
  const rivalSync = await syncChecklistApproval(admin, { workspaceId: wsA, checklistId: g2.data.id, ...base });
  ok("13v-setup-c. and reaches `approved`, so 13v tests the INDEX and not an earlier refusal",
    rivalSync.ok && rivalSync.data.status === "approved", rivalSync.ok ? rivalSync.data.status : rivalSync.message);

  const clash = await publishChecklist(admin, { workspaceId: wsA, checklistId: g2.data.id, ...base });
  ok("13v. ⚠ ONE REFERENCE, ONE CHECKLIST IN USE -- refused by the INDEX, which this engine deliberately does not pre-check",
    !clash.ok && clash.code === "CODE_IN_USE" && /ux_practice_checklist_published_code/.test(clash.message),
    clash.ok ? "both published" : `${clash.code}: ${clash.message}`);

  // ── REVISION, AND THE RECORDS THAT SURVIVE IT ──────────────────────────────────────────────────
  const revised = await reviseChecklist(admin, { workspaceId: wsA, checklistId: g.data.id, ...base });
  ok("13w. a checklist in use can be revised into a new draft at version 2, carrying its items forward",
    revised.ok && revised.data.version === 2, revised.ok ? "" : revised.message);
  if (!revised.ok) return report();
  const { data: copiedItems } = await admin.from(CHECKLIST_ITEM_TABLE)
    .select("item_key").eq("checklist_id", revised.data.id);
  ok("13w-b. all four items came across",
    ((copiedItems ?? []) as unknown[]).length === 4, String(((copiedItems ?? []) as unknown[]).length));
  const again = await reviseChecklist(admin, { workspaceId: wsA, checklistId: g.data.id, ...base });
  ok("13x. and only one revision may be open at a time",
    !again.ok && again.code === "REVISION_OPEN", again.ok ? "two opened" : again.code);

  const withdrawn2 = await archiveChecklist(admin, { workspaceId: wsA, checklistId: g.data.id, reason: "found to be wrong", ...base });
  ok("13y. withdrawing it reports how many records were left part-finished, rather than closing them for somebody",
    withdrawn2.ok && typeof withdrawn2.data.openRuns === "number",
    withdrawn2.ok ? String(withdrawn2.data.openRuns) : withdrawn2.message);
  const { data: survivingRun } = await admin.from(CHECKLIST_RUN_TABLE)
    .select("id, status").eq("id", run.data.id).maybeSingle();
  ok("13y-b. ⚠ AND THE COMPLETION RECORD SURVIVES THE WITHDRAWAL EXACTLY AS IT WAS",
    survivingRun?.status === "completed", JSON.stringify(survivingRun));

  // ⚠ g2 IS `approved`, NOT `published` -- its publish was refused at 13v with CODE_IN_USE. And there is
  // deliberately no approved -> archived move: `archived` means withdrawn or superseded, which describes
  // something that WAS in force, and g2 never was. The route out is two steps, and it is better than one:
  // re-opening VOIDS the approval, so an abandoned form cannot sit in the archive still carrying an
  // approval link nobody honoured. This assertion used to demand the one-step move and was wrong to.
  const cannotArchiveApproved = await archiveChecklist(admin, { workspaceId: wsA, checklistId: g2.data.id, reason: "not going ahead", ...base });
  ok("13z. an APPROVED checklist cannot be archived directly -- archive is for things that were in force",
    !cannotArchiveApproved.ok && cannotArchiveApproved.code === "MOVE_NOT_ALLOWED",
    cannotArchiveApproved.ok ? "archived" : cannotArchiveApproved.code);
  ok("13z-b. ...and the refusal NAMES THE WAY OUT, so nobody is left stuck with something they rejected",
    !cannotArchiveApproved.ok && /re-?open/i.test(cannotArchiveApproved.message ?? ""),
    cannotArchiveApproved.ok ? "archived" : cannotArchiveApproved.message);

  // The route out, taken: re-open to draft, then abandon. The blank-reason rule is tested there, where
  // the move is legal and the reason is the only thing that can refuse it.
  const reopened = await withdrawChecklistFromReview(admin, { workspaceId: wsA, checklistId: g2.data.id, ...base });
  ok("13z-c. CONTROL: the two-step route actually exists -- approved re-opens to draft",
    reopened.ok, reopened.ok ? "" : `${reopened.code}: ${reopened.message}`);
  const noReason = await archiveChecklist(admin, { workspaceId: wsA, checklistId: g2.data.id, reason: "   ", ...base });
  ok("13z-d. ⚠ THE ENGINE refuses a withdrawal with no reason, in a sentence rather than a constraint name",
    !noReason.ok && noReason.code === "REASON_REQUIRED" && !/practice_checklist_archived_reason/.test(noReason.message),
    noReason.ok ? "archived" : `${noReason.code}: ${noReason.message}`);
  const { error: rawArchive } = await admin.from(CHECKLIST_TABLE)
    .update({ status: "archived", archived_at: new Date().toISOString(), archived_reason: "   " })
    .eq("id", g2.data.id).eq("workspace_id", wsA);
  // ⚠ THE PHASE 1 CORRECTION, APPLIED THE FIRST TIME. Migration 256 wrote `is not null` and accepted a
  // blank string. This DDL is written with btrim, so the database refuses the blank too -- and the two
  // refusals carry DIFFERENT CODES so a harness can tell which layer said no.
  ok("13z-db. ⚠ AND THE CONSTRAINT REFUSES A BLANK REASON TOO, because it is written with btrim rather than `is not null`",
    String(rawArchive?.code) === "23514" && /practice_checklist_archived_reason/.test(String(rawArchive?.message)),
    rawArchive ? `${rawArchive.code} ${rawArchive.message}` : "the raw update was ACCEPTED -- the DDL shipped migration 256's mistake");

  // ── TENANCY, NON-VACUOUSLY ─────────────────────────────────────────────────────────────────────
  const crossRead = await getChecklist(admin, wsB, g.data.id);
  ok("14a. ⚠ ANOTHER PRACTICE CANNOT READ THIS CHECKLIST", crossRead.state === "not_found", crossRead.state);
  const crossWrite = await updateChecklist(admin, { workspaceId: wsB, checklistId: g.data.id, title: "Theirs now", ...base });
  ok("14b. nor edit it", !crossWrite.ok && crossWrite.code === "NOT_FOUND", crossWrite.ok ? "edited" : crossWrite.code);
  const crossRun = await getChecklistRun(admin, wsB, run.data.id);
  ok("14c. nor read a completion record made in it", crossRun.state === "not_found", crossRun.state);
  const ownRead = await getChecklist(admin, wsA, g.data.id);
  ok("14a-control. CONTROL: its own practice CAN read it, so 14a is not passing on a broken id",
    ownRead.state === "ok", ownRead.state);

  const libA = await checklistLibrary(admin, wsA);
  const libB = await checklistLibrary(admin, wsB);
  ok("14d. the library is workspace-scoped, and the other practice's is genuinely empty rather than failed",
    libA.state === "ok" && libB.state === "ok" && libA.items.length > 0 && libB.items.length === 0,
    `${libA.items.length} / ${libB.items.length}`);
  // ⚠ THE LENGTH IS ASSERTED TOO. `[].every()` is TRUE, so a counts assertion without it passes
  // unconditionally while the store is absent -- the exact shape of the vacuous assertions found here.
  ok("14e. every count on the library opens a list, and there are five of them",
    libA.counts.length === 5 && libA.counts.every(c => c.href.startsWith(CHECKLIST_ROUTE)),
    `${libA.counts.length} counts`);
  const inUse = libA.counts.find(c => c.key === "published")?.total ?? -1;
  ok("14e-b. and the figure equals the number of rows the filter it carries returns",
    inUse === libA.items.filter(i => i.status === "published").length, `${inUse} claimed`);
  ok("14f. an item count on a library row is a number that was READ, and null rather than 0 when it could not be",
    libA.items.every(i => i.itemCount === null || typeof i.itemCount === "number"),
    JSON.stringify(libA.items.map(i => i.itemCount)));

  const dead = await withdrawChecklistFromReview(admin, { workspaceId: wsA, checklistId: g.data.id, ...base });
  ok("14g. an archived checklist cannot be moved anywhere, and the refusal says so",
    !dead.ok && dead.code === "MOVE_NOT_ALLOWED", dead.ok ? "moved" : dead.code);

  // ── THE AUDIT TRAIL, SCOPED TO THIS RUN ────────────────────────────────────────────────────────
  //
  // ⚠ SCOPED BY correlation_id, NOT COUNTED. practice_audit_event has been append-only since migration
  // 247, so every harness's delete has been a silent no-op and rows accumulate across runs. Two
  // harnesses have already been bitten by assuming otherwise.
  const { data: events } = await admin.from("practice_audit_event")
    .select("event_type").eq("workspace_id", wsA).eq("correlation_id", "harness-checklist");
  const types = new Set(((events ?? []) as { event_type: string }[]).map(e => e.event_type));
  ok("14h. the whole loop left an audit trail, and closing a record is on it",
    types.has("practice.checklist_created") && types.has("practice.checklist_published") &&
    types.has("practice.checklist_run_completed"),
    [...types].join(" "));

  await cleanup();
  return report();
}

main().catch(e => { console.error(e); process.exit(1); });
