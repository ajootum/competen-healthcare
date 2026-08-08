/**
 * Practice document-generation harness -- CPR-330, exercised against the live database through the same
 * engine the page uses. Migration 204.
 *
 * WHAT IT PROVES:
 *   1. AN UNRESOLVED MERGE FIELD RENDERS AS A VISIBLE MARKER, NEVER AS BLANK. This is the rule the whole
 *      module turns on. Asserted both ways: generation REFUSES by default and names the fields, and when
 *      asked for the draft anyway the body carries [[patient.date_of_birth not recorded]] where the
 *      value would be. Paired with the CONTROL that a field which IS present renders its actual value --
 *      a resolver that marked everything would pass half of this on its own.
 *   2. AN UNKNOWN FIELD AND AN EMPTY ONE ARE DIFFERENT MISTAKES and are reported differently: one is an
 *      authoring error, the other a data gap.
 *   3. NO FOURTH DOCUMENT MODEL. A generated letter is an ordinary practice_clinical_document -- CPR-130
 *      signs it, freezes it and versions it exactly as if it had been typed.
 *   4. THE LETTERHEAD IS NOT WRITTEN INTO THE BODY. Composed at print time from one definition, so a
 *      practice that corrects its address does not leave signed documents disagreeing with it.
 *   5. AN UNSUPPLIED LETTERHEAD FIELD PRINTS NOTHING, NEVER A PLACEHOLDER, and an unconfigured practice
 *      gets no letterhead at all rather than a header made of empty lines.
 *   6. A BATCH REPORTS WHAT ACTUALLY HAPPENED. One patient in the run is archived, so the batch is 1 of
 *      2 -- and the stored row says so. "40 certificates were generated" is the kind of claim somebody
 *      relies on without checking.
 *   7. THE REFUSALS HOLD AND ARE NON-VACUOUS: an unpublished template, an encounter-note template, a
 *      body-less template and another workspace's template are each refused, each paired with the
 *      control that the legitimate case succeeds.
 *   8. A SCHEDULE SAYS IT DOES NOT FIRE. Every row carries fires:false, because a schedule that looks
 *      automatic and is not is worse than no schedule.
 *   9. THE DASHBOARD COMPUTES NO RATES, carries its two unavailable tiles IN PLACE with reasons, and
 *      de-identifies for a caller holding report.view without patient.view.
 *  10. Cross-workspace isolation, non-vacuously.
 *
 *   npx --yes tsx scripts/practice-generation-harness.ts
 */
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { runProvisioning, type IndividualRequest } from "../src/lib/practice/provisioning";
import { registerPatient } from "../src/lib/practice/patients";
import { createTemplate, setTemplateStatus, transitionDocument, getDocument } from "../src/lib/practice/documentation";
import { resolveWorkspaceContext, type WorkspaceContext } from "../src/lib/practice/access";
import { updateConfiguration } from "../src/lib/practice/configuration";
import { purgeWorkspacesOwnedBy } from "./_cleanup";
import {
  mergeTemplate, generateFromTemplate, generateBatch, letterhead,
  createSchedule, listSchedules, reportsDashboard, listBatches,
} from "../src/lib/practice/document-generation";

loadEnvConfig(process.cwd());

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("Supabase env not set"); process.exit(1); }
const admin = createClient(url, key, { auth: { persistSession: false } });

const OWNER = "00000000-0000-4000-8000-0000000e19d1";
const OTHER = "00000000-0000-4000-8000-0000000e19d2";

let pass = 0;
const fails: string[] = [];
const ok = (label: string, cond: boolean, detail = "") => {
  if (cond) { pass++; console.log(`  PASS  ${label}`); }
  else { fails.push(label); console.log(`  FAIL  ${label}${detail ? ` -- ${detail}` : ""}`); }
};

const payload = (name: string): IndividualRequest => ({
  displayName: name, countryCode: "UG", timezone: "Africa/Kampala", professionCode: "medical_doctor",
  defaultPracticeType: "clinic", locale: "en-UG", termsVersion: "t1", privacyNoticeVersion: "p1", source: "pilot",
});

async function provision(user: string, name: string, suffix: string): Promise<string> {
  const { data: req } = await admin.from("provisioning_request").insert({
    idempotency_key: `harness-gen-${suffix}`, request_type: "pilot",
    actor_user_id: user, target_user_id: user, payload_hash: "harness", correlation_id: "harness-gen",
  }).select("id").single();
  const run = await runProvisioning(admin, { id: req!.id, target_user_id: user, correlation_id: "harness-gen", workspace_id: null }, payload(name));
  if (!run.ok || !run.workspaceId) throw new Error(`provisioning failed: ${run.errorCode}`);
  return run.workspaceId;
}

async function cleanup() {
  await purgeWorkspacesOwnedBy(admin, [OWNER, OTHER]);
}

const base = { actorId: OWNER, correlationId: "harness-gen" };

/* eslint-disable @typescript-eslint/no-explicit-any */

async function withoutCapability(workspaceId: string, userId: string, capability: string): Promise<WorkspaceContext> {
  const { data: mine } = await admin.from("practice_membership")
    .select("id").eq("workspace_id", workspaceId).eq("user_id", userId);
  await admin.from("practice_role_assignment").update({ effective_to: new Date().toISOString() })
    .in("membership_id", ((mine ?? []) as any[]).map(m => m.id))
    .eq("capability_code", capability).is("effective_to", null);
  const res = await resolveWorkspaceContext(admin, userId, workspaceId);
  if (!res.ok) throw new Error("context failed");
  return res.ctx;
}

// A referral letter that names one field the patient HAS and one the patient does NOT. Both halves are
// load-bearing: the marker assertion and its control read the same generated body.
const LETTER_BODY = [
  "Dear {{referral.addressee}},",
  "",
  "I am referring {{patient.name}}, born {{patient.date_of_birth}}, for your opinion.",
  "Practice identifier: {{patient.identifier}}.",
  "",
  "Yours sincerely,",
  "{{practitioner.name}}",
].join("\n");

async function makeTemplate(workspaceId: string, code: string, opts: {
  kind?: string; body?: string; sections?: any[]; publish?: boolean;
} = {}): Promise<string | null> {
  const created = await createTemplate(admin, {
    workspaceId, code, title: `Harness ${code}`, kind: opts.kind ?? "referral_letter",
    bodyTemplate: opts.body, sections: opts.sections ?? [], ...base,
  });
  if (!created.ok) return null;
  if (opts.publish !== false) {
    await setTemplateStatus(admin, { workspaceId, templateId: created.data.id, status: "published", ...base });
  }
  return created.data.id;
}

async function main() {
  console.log("\nPractice document-generation harness (CPR-330, migration 204)\n");
  await cleanup();

  const wsA = await provision(OWNER, "HARNESS Generation A (synthetic)", "a");
  const wsB = await provision(OTHER, "HARNESS Generation B (synthetic)", "b");
  const a = await resolveWorkspaceContext(admin, OWNER, wsA);
  const b = await resolveWorkspaceContext(admin, OTHER, wsB);
  if (!a.ok || !b.ok) { ok("workspace contexts resolve", false); return report(); }

  // ── 1. The resolver, before any database is involved ─────────────────────
  const pure = mergeTemplate("Dear {{referral.addressee}}, re {{patient.name}} ({{patient.age}}).", {
    "patient.name": "Nabirye Sarah", "patient.age": null,
  });
  ok("an UNKNOWN field renders as a visible marker naming it",
    pure.text.includes("[[unknown field: referral.addressee]]"), pure.text);
  ok("an EMPTY field renders as a visible marker, not as a blank",
    pure.text.includes("[[patient.age not recorded]]"), pure.text);
  ok("CONTROL: a field that IS present renders its actual value",
    pure.text.includes("Nabirye Sarah") && !pure.text.includes("[[patient.name"), pure.text);
  ok("the two kinds of failure are reported differently",
    pure.unresolved.some(u => u.field === "referral.addressee" && u.reason === "unknown") &&
    pure.unresolved.some(u => u.field === "patient.age" && u.reason === "empty"),
    JSON.stringify(pure.unresolved));
  ok("nothing renders as an empty string where a field was",
    !/Dear ,/.test(pure.text) && !/\(\)/.test(pure.text), pure.text);

  // ── The fixture ──────────────────────────────────────────────────────────
  // Deliberately NO birth date: the letter asks for one, so the gap is real rather than simulated.
  const p1 = await registerPatient(admin, {
    workspaceId: wsA, displayName: "Nakiwala Prossy", sex: "female", ageEstimateYears: 39,
    phone: "0772 555 200", ...base,
  });
  const p2 = await registerPatient(admin, {
    workspaceId: wsA, displayName: "Okello Denis", sex: "male", birthDate: "1979-04-02",
    phone: "0772 555 201", confirmNew: true, ...base,
  });
  if (!p1.ok || !p2.ok) { ok("patients register", false, [p1, p2].map(r => r.ok ? "ok" : r.message).join("; ")); return report(); }

  const letterId = await makeTemplate(wsA, "harness_referral", { body: LETTER_BODY });
  const noBodyId = await makeTemplate(wsA, "harness_nobody", { body: "" });
  const draftId = await makeTemplate(wsA, "harness_draft", { body: LETTER_BODY, publish: false });
  const noteId = await makeTemplate(wsA, "harness_note", {
    kind: "encounter_note", sections: [{ noteType: "subjective", heading: "History", prompt: "", defaultBody: "", required: false }],
  });
  const bTemplateId = await makeTemplate(wsB, "harness_b_referral", { body: LETTER_BODY });
  ok("a document template with a merge body is accepted", letterId !== null);
  ok("a document template with NO body is refused (it would apply nothing)", noBodyId === null);
  ok("CONTROL: an encounter-note template with sections and no body is still accepted", noteId !== null);
  if (!letterId || !noteId || !draftId || !bTemplateId) return report();

  // ── 2. Generation refuses by default when a field cannot be filled ───────
  const refused = await generateFromTemplate(admin, a.ctx, {
    templateId: letterId, patientId: p1.data.id, correlationId: "harness-gen",
  });
  ok("generation REFUSES when a merge field cannot be filled",
    !refused.ok && refused.code === "UNRESOLVED_FIELDS", refused.ok ? "generated" : refused.code);
  ok("the refusal NAMES the fields, so the fix is obvious",
    !refused.ok && refused.message.includes("patient.date_of_birth") && refused.message.includes("referral.addressee"),
    refused.ok ? "" : refused.message);

  // ── 3. Generate anyway: the markers survive into the stored document ─────
  const forced = await generateFromTemplate(admin, a.ctx, {
    templateId: letterId, patientId: p1.data.id, allowUnresolved: true, correlationId: "harness-gen",
  });
  ok("'generate anyway' produces the draft", forced.ok, forced.ok ? "" : forced.message);
  if (!forced.ok) return report();

  const stored = await getDocument(admin, wsA, forced.data.id);
  const body = String(stored?.document?.body ?? "");
  ok("THE STORED BODY carries a visible marker where the date of birth was not recorded",
    body.includes("[[patient.date_of_birth not recorded]]"), body.slice(0, 200));
  ok("THE STORED BODY carries a visible marker for the unknown field too",
    body.includes("[[unknown field: referral.addressee]]"), body.slice(0, 120));
  ok("CONTROL: the fields that COULD be filled carry their real values",
    body.includes("Nakiwala Prossy") && /Practice identifier: P-/.test(body), body.slice(0, 300));
  ok("the body contains no 'Dear ,' -- nothing was silently blanked", !/Dear\s*,/.test(body));

  // ── 4. No fourth document model: CPR-130 owns it from here ───────────────
  ok("a generated letter IS an ordinary practice_clinical_document, in DRAFT",
    stored?.document?.status === "DRAFT" && stored?.document?.doc_type === "referral_letter",
    JSON.stringify({ status: stored?.document?.status, type: stored?.document?.doc_type }));
  ok("it is linked to the template it came from", stored?.document?.template_id === letterId);
  const toFinal = await transitionDocument(admin, { workspaceId: wsA, documentId: forced.data.id, to: "FINAL", ...base });
  const toSigned = await transitionDocument(admin, { workspaceId: wsA, documentId: forced.data.id, to: "SIGNED", ...base });
  ok("CPR-130's lifecycle still applies to it -- it finalises and signs",
    toFinal.ok && toSigned.ok, [toFinal, toSigned].map(r => r.ok ? "ok" : r.message).join("; "));

  // ── 5. The letterhead ────────────────────────────────────────────────────
  const bare = await letterhead(admin, wsA);
  ok("an unconfigured practice gets NO letterhead rather than empty lines", bare === null, String(bare));

  const cfg = await updateConfiguration(admin, {
    workspaceId: wsA, letterheadName: "Harness Family Clinic",
    letterheadAddress: "Plot 4, Kampala Road", ...base,
  });
  ok("the practice can supply its own letterhead details", cfg.ok, cfg.ok ? "" : cfg.message);
  const head = await letterhead(admin, wsA);
  ok("the letterhead is composed from what was supplied",
    !!head && head.includes("Harness Family Clinic") && head.includes("Plot 4, Kampala Road"), String(head));
  ok("AN UNSUPPLIED FIELD PRINTS NOTHING, never a placeholder",
    !!head && !/\[|registration|contact/i.test(head), String(head));

  const p3 = await registerPatient(admin, {
    workspaceId: wsA, displayName: "Ainembabazi Grace", birthDate: "1990-11-05", sex: "female",
    phone: "0772 555 202", confirmNew: true, ...base,
  });
  if (!p3.ok) { ok("third patient registers", false, p3.message); return report(); }
  const afterHead = await generateFromTemplate(admin, a.ctx, {
    templateId: letterId, patientId: p3.data.id, allowUnresolved: true, correlationId: "harness-gen",
  });
  const afterBody = afterHead.ok ? String((await getDocument(admin, wsA, afterHead.data.id))?.document?.body ?? "") : "";
  ok("THE LETTERHEAD IS NOT WRITTEN INTO THE BODY -- it is stationery, composed at print time",
    afterHead.ok && !afterBody.includes("Harness Family Clinic") && !afterBody.includes("Plot 4"),
    afterBody.slice(0, 160));
  ok("CONTROL: that same document's merged content IS in the body",
    afterBody.includes("Ainembabazi Grace") && afterBody.includes("1990-11-05"), afterBody.slice(0, 200));

  // ── 6. Refusals, each with its control ───────────────────────────────────
  const unpublished = await generateFromTemplate(admin, a.ctx, {
    templateId: draftId, patientId: p2.data.id, allowUnresolved: true, correlationId: "harness-gen",
  });
  ok("an UNPUBLISHED template is refused", !unpublished.ok && unpublished.code === "TEMPLATE_NOT_PUBLISHED",
    unpublished.ok ? "generated" : unpublished.code);

  const wrongKind = await generateFromTemplate(admin, a.ctx, {
    templateId: noteId, patientId: p2.data.id, allowUnresolved: true, correlationId: "harness-gen",
  });
  ok("an ENCOUNTER-NOTE template is refused -- it fills SOAP boxes, it does not make a letter",
    !wrongKind.ok && wrongKind.code === "WRONG_TEMPLATE_KIND", wrongKind.ok ? "generated" : wrongKind.code);

  const crossTemplate = await generateFromTemplate(admin, a.ctx, {
    templateId: bTemplateId, patientId: p2.data.id, allowUnresolved: true, correlationId: "harness-gen",
  });
  ok("ANOTHER WORKSPACE'S template is not found", !crossTemplate.ok && crossTemplate.code === "NOT_FOUND",
    crossTemplate.ok ? "generated" : crossTemplate.code);

  const crossPatient = await generateFromTemplate(admin, b.ctx, {
    templateId: bTemplateId, patientId: p2.data.id, allowUnresolved: true, correlationId: "harness-gen",
  });
  ok("ANOTHER WORKSPACE'S patient is not found", !crossPatient.ok && crossPatient.code === "NOT_FOUND",
    crossPatient.ok ? "generated" : crossPatient.code);

  const control = await generateFromTemplate(admin, a.ctx, {
    templateId: letterId, patientId: p2.data.id, allowUnresolved: true, correlationId: "harness-gen",
  });
  ok("CONTROL: the legitimate combination generates (the refusals are not blanket)",
    control.ok, control.ok ? "" : control.message);

  // ── 7. A batch reports what actually happened ────────────────────────────
  // p1 is archived first, so exactly one of the two must fail. A batch that reported 2 of 2 here would
  // be the failure this assertion exists to catch.
  await admin.from("practice_patient").update({ status: "archived" }).eq("id", p1.data.id);
  const batch = await generateBatch(admin, a.ctx, {
    templateId: letterId, patientIds: [p2.data.id, p1.data.id],
    selectionNote: "harness: one active, one archived", allowUnresolved: true, correlationId: "harness-gen",
  });
  ok("the batch runs", batch.ok, batch.ok ? "" : batch.message);
  ok("THE BATCH REPORTS 1 OF 2, not 2 of 2",
    batch.ok && batch.data.generated === 1 && batch.data.failed === 1,
    batch.ok ? JSON.stringify(batch.data) : "");
  ok("and it says WHICH patient failed and why",
    batch.ok && batch.data.failures[0]?.patientId === p1.data.id && batch.data.failures[0]?.reason === "PATIENT_NOT_ACTIVE",
    batch.ok ? JSON.stringify(batch.data.failures) : "");
  const batches = await listBatches(admin, wsA);
  ok("THE STORED BATCH ROW carries the same failure count -- it is not lost on the way to the record",
    batches[0]?.requested === 2 && batches[0]?.generated === 1 && batches[0]?.failed === 1,
    JSON.stringify(batches[0]));
  const { data: members } = await admin.from("practice_clinical_document")
    .select("id").eq("batch_id", batch.ok ? batch.data.batchId : "");
  ok("the documents point back at the run that produced them", (members ?? []).length === 1,
    String((members ?? []).length));

  const tooBig = await generateBatch(admin, a.ctx, {
    templateId: letterId, patientIds: new Array(201).fill(p2.data.id), correlationId: "harness-gen",
  });
  ok("a batch of 201 is refused", !tooBig.ok && tooBig.code === "BATCH_TOO_LARGE");
  const empty = await generateBatch(admin, a.ctx, { templateId: letterId, patientIds: [], correlationId: "harness-gen" });
  ok("a batch of nobody is refused", !empty.ok && empty.code === "VALIDATION_ERROR");

  // ── 8. Schedules say they do not fire ────────────────────────────────────
  const sched = await createSchedule(admin, a.ctx, {
    name: "Monthly activity summary", reportKind: "activity", cadence: "monthly", correlationId: "harness-gen",
  });
  ok("a schedule can be defined", sched.ok, sched.ok ? "" : sched.message);
  const schedules = await listSchedules(admin, wsA);
  ok("EVERY SCHEDULE ROW SAYS IT DOES NOT FIRE, as a field and not a footnote",
    schedules.length === 1 && schedules[0].fires === false && /not automated/i.test(schedules[0].note),
    JSON.stringify(schedules[0]));
  ok("a schedule has never run", schedules[0]?.last_run_at === null);
  const badCadence = await createSchedule(admin, a.ctx, {
    name: "Hourly", reportKind: "activity", cadence: "hourly", correlationId: "harness-gen",
  });
  ok("an unknown cadence is refused", !badCadence.ok);

  // ── 9. The dashboard ─────────────────────────────────────────────────────
  const board = await reportsDashboard(admin, a.ctx, { days: 30 });
  const serialised = JSON.stringify(board);
  ok("the dashboard computes NO RATES anywhere in it",
    !/\d+(\.\d+)?%/.test(serialised) && !/"(rate|percent|percentage|ratio)"/i.test(serialised));
  ok("the two unavailable tiles are PRESENT IN PLACE, with reasons",
    board.kpis.length === 6 &&
    board.kpis.find(k => k.key === "ai_time")?.available === false &&
    /CPR-210/.test(board.kpis.find(k => k.key === "ai_time")?.reason ?? ""),
    JSON.stringify(board.kpis.map(k => [k.key, k.available])));
  ok("the scheduled-reports tile does not claim anything is due",
    !/due/i.test(board.kpis.find(k => k.key === "scheduled")?.sub ?? ""),
    board.kpis.find(k => k.key === "scheduled")?.sub ?? "");
  ok("the generated count is real and discriminates",
    (board.kpis.find(k => k.key === "generated")?.value ?? 0) >= 4,
    String(board.kpis.find(k => k.key === "generated")?.value));
  ok("the comparison is a COUNT of the period before, not a percentage change",
    /\bin the period before\b/.test(board.kpis.find(k => k.key === "generated")?.sub ?? ""),
    board.kpis.find(k => k.key === "generated")?.sub ?? "");
  ok("the categories count the templates that can actually be generated from",
    board.categories.some(c => c.kind === "referral_letter" && c.mergeable >= 1),
    JSON.stringify(board.categories));
  ok("most-used templates counts real usage", board.mostUsed[0]?.total >= 4, JSON.stringify(board.mostUsed[0]));
  ok("recently generated names the patient for a caller who may see names",
    board.identified && board.recent.some(r => r.patient === "Okello Denis"),
    JSON.stringify(board.recent.map(r => r.patient)));

  // ── 10. De-identification, and isolation ─────────────────────────────────
  const blind = await withoutCapability(wsA, OWNER, "patient.view");
  const blindBoard = await reportsDashboard(admin, blind, { days: 30 });
  ok("a caller with report.view and NO patient.view gets counts and no names",
    !blindBoard.identified && blindBoard.recent.every(r => r.patient === null) &&
    !JSON.stringify(blindBoard.recent).includes("Okello"),
    JSON.stringify(blindBoard.recent.map(r => r.patient)));
  ok("CONTROL: that same blind dashboard still carries its counts (it is not simply empty)",
    (blindBoard.kpis.find(k => k.key === "generated")?.value ?? 0) >= 4);

  const bBoard = await reportsDashboard(admin, b.ctx, { days: 365 });
  ok("B's dashboard counts none of A's documents",
    bBoard.kpis.every(k => k.value === 0 || k.value === null) && bBoard.recent.length === 0,
    JSON.stringify(bBoard.kpis.map(k => [k.key, k.value])));
  ok("A's dashboard is non-empty (the isolation test is not vacuous)",
    board.recent.length > 0 && (board.kpis[0].value ?? 0) > 0);

  return report();
}

function report() {
  console.log(`\n${fails.length === 0 ? "PASSED" : "FAILED"}  ${pass} passed, ${fails.length} failed`);
  if (fails.length) { for (const f of fails) console.log(`  - ${f}`); process.exitCode = 1; }
}

main()
  .then(cleanup)
  .catch(async e => { console.error(e); await cleanup(); process.exitCode = 1; });
