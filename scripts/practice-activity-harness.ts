/**
 * Practice clinical-activity harness -- CPR-150's other half. Migration 209.
 *
 * WHAT IT PROVES:
 *   1. A CLINICAL ACTIVITY IS NOT A PROCEDURE. It carries no patient, it does not appear among
 *      procedures, and a teaching session logged here does not land in anybody's clinical record.
 *   2. IT BELONGS TO WHOEVER DID IT, not whoever typed it -- so a consultant logging a registrar's ward
 *      round credits the registrar, and the portfolio built on top is right about who did the work.
 *   3. CPD MINUTES ARE SEPARATE FROM DURATION, and cannot exceed it. A portfolio claiming six hours of
 *      CPD from a two-hour meeting discredits every entry beside it.
 *   4. A PORTFOLIO IS THE PERSON'S OWN: nobody else can put something into it or take it out.
 *   5. AN IMPLANT WITHOUT AN IDENTIFIER IS REFUSED -- without it, this patient cannot be found in a
 *      recall -- and a template cannot smuggle one past that rule.
 *   6. A TEAM ENTRY THAT IDENTIFIES NOBODY IS REFUSED, but an agency nurse with no account can still be
 *      named: a team list that only held account-holders would be quietly incomplete.
 *   7. THE KIT TRACE ANSWERS "which procedures used this", which is what a fault or a recall asks.
 *   8. THE PORTFOLIO REPORTS COUNTS AND DENOMINATORS, with no percentage anywhere, and states in the
 *      payload that it is NOT linked to the platform's competency records.
 *   9. A template seeds the team and the kit and NOT the findings.
 *  10. Cross-workspace isolation, non-vacuously.
 *
 *   npx --yes tsx scripts/practice-activity-harness.ts
 */
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { runProvisioning, type IndividualRequest } from "../src/lib/practice/provisioning";
import { registerPatient } from "../src/lib/practice/patients";
import { launchEncounter } from "../src/lib/practice/encounters";
import { recordProcedure, recordProcedureOutcome, listProcedures } from "../src/lib/practice/procedures";
import { purgeWorkspacesOwnedBy } from "./_cleanup";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  recordActivity, listActivities, addParticipant, addItem, procedureDetail, procedureItemTrace,
  createProcedureTemplate, applyProcedureTemplate, portfolioSummary, setPortfolio, ACTIVITY_KINDS,
  activityRecord, recordExternalProcedure, removeExternalProcedure,
} from "../src/lib/practice/clinical-activity";

loadEnvConfig(process.cwd());

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("Supabase env not set"); process.exit(1); }
const admin = createClient(url, key, { auth: { persistSession: false } });

const OWNER = "00000000-0000-4000-8000-0000000e24d1";
const OTHER = "00000000-0000-4000-8000-0000000e24d2";
const REGISTRAR = "00000000-0000-4000-8000-0000000e24d3";

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
    idempotency_key: `harness-act-${suffix}`, request_type: "pilot",
    actor_user_id: user, target_user_id: user, payload_hash: "harness", correlation_id: "harness-act",
  }).select("id").single();
  const run = await runProvisioning(admin, { id: req!.id, target_user_id: user, correlation_id: "harness-act", workspace_id: null }, payload(name));
  if (!run.ok || !run.workspaceId) throw new Error(`provisioning failed: ${run.errorCode}`);
  return run.workspaceId;
}

async function cleanup() {
  await purgeWorkspacesOwnedBy(admin, [OWNER, OTHER]);
}

const base = { actorId: OWNER, correlationId: "harness-act" };

/* eslint-disable @typescript-eslint/no-explicit-any */

async function main() {
  console.log("\nPractice clinical-activity harness (CPR-150, migration 209)\n");
  await cleanup();

  const wsA = await provision(OWNER, "HARNESS Activity A (synthetic)", "a");
  const wsB = await provision(OTHER, "HARNESS Activity B (synthetic)", "b");

  await admin.from("practice_membership").insert({
    workspace_id: wsA, user_id: REGISTRAR, role_code: "practitioner", status: "active",
  });

  const p1 = await registerPatient(admin, {
    workspaceId: wsA, displayName: "Ssempala Moses", sex: "male", birthDate: "1970-09-30",
    phone: "0772 555 600", ...base,
  });
  if (!p1.ok) { ok("patient registers", false, p1.message); return report(); }
  const enc = await launchEncounter(admin, {
    workspaceId: wsA, patientId: p1.data.id, pathway: "new_walk_in", reasonForVisit: "Knee pain", ...base,
  });
  if (!enc.ok) { ok("encounter launches", false, enc.message); return report(); }

  // ── 1 and 2. An activity is not a procedure, and it belongs to whoever did it ─
  const teaching = await recordActivity(admin, {
    workspaceId: wsA, kind: "teaching", title: "Registrar teaching: knee examination",
    occurredAt: new Date().toISOString(), durationMinutes: 60, participation: "taught",
    cpdMinutes: 60, portfolio: true, ...base,
  });
  ok("a teaching session is logged", teaching.ok, teaching.ok ? "" : teaching.message);

  const wardRound = await recordActivity(admin, {
    workspaceId: wsA, kind: "ward_round", title: "Post-take ward round",
    occurredAt: new Date().toISOString(), durationMinutes: 90, participation: "led",
    // Typed by the owner, DONE by the registrar.
    performedBy: REGISTRAR, cpdMinutes: 30, ...base,
  });
  ok("an activity can be credited to somebody else", wardRound.ok, wardRound.ok ? "" : wardRound.message);

  const mine = await listActivities(admin, wsA, { performedBy: OWNER });
  const theirs = await listActivities(admin, wsA, { performedBy: REGISTRAR });
  ok("IT BELONGS TO WHOEVER DID IT, not whoever typed it",
    mine.length === 1 && mine[0].title.startsWith("Registrar teaching") &&
    theirs.length === 1 && theirs[0].title === "Post-take ward round",
    JSON.stringify({ mine: mine.map((a: any) => a.title), theirs: theirs.map((a: any) => a.title) }));

  const procs = await listProcedures(admin, wsA, {});
  ok("A CLINICAL ACTIVITY IS NOT A PROCEDURE -- neither appears among them",
    procs.length === 0, String(procs.length));
  const { data: activityRows } = await admin.from("practice_clinical_activity")
    .select("id, encounter_id").eq("workspace_id", wsA);
  ok("and an activity carries no patient at all",
    !Object.keys((activityRows ?? [])[0] ?? {}).includes("patient_id"),
    Object.keys((activityRows ?? [])[0] ?? {}).join(","));

  const notAMember = await recordActivity(admin, {
    workspaceId: wsA, kind: "meeting", title: "Probe", occurredAt: new Date().toISOString(),
    performedBy: "00000000-0000-4000-8000-0000000e24d9", ...base,
  });
  ok("crediting somebody who is not a member is refused", !notAMember.ok && notAMember.code === "NOT_A_MEMBER");
  const badKind = await recordActivity(admin, {
    workspaceId: wsA, kind: "surgery", title: "Probe", occurredAt: new Date().toISOString(), ...base,
  });
  ok("an unknown kind is refused", !badKind.ok);
  ok("the kinds are the ones a clinician would actually log",
    ACTIVITY_KINDS.some(([k]) => k === "ward_round") && ACTIVITY_KINDS.some(([k]) => k === "teaching"));

  // ── 3. CPD is separate from duration and cannot exceed it ────────────────
  const inflated = await recordActivity(admin, {
    workspaceId: wsA, kind: "meeting", title: "Mortality meeting",
    occurredAt: new Date().toISOString(), durationMinutes: 120, cpdMinutes: 360, ...base,
  });
  ok("CPD LONGER THAN THE ACTIVITY ITSELF IS REFUSED",
    !inflated.ok && inflated.code === "CPD_EXCEEDS_DURATION", inflated.ok ? "recorded" : inflated.code);
  const honest = await recordActivity(admin, {
    workspaceId: wsA, kind: "meeting", title: "Mortality meeting",
    occurredAt: new Date().toISOString(), durationMinutes: 120, cpdMinutes: 60, portfolio: true, ...base,
  });
  ok("CONTROL: an hour of CPD from a two-hour meeting is fine", honest.ok, honest.ok ? "" : honest.message);

  // ── The procedure, its team and its kit ──────────────────────────────────
  const proc = await recordProcedure(admin, {
    workspaceId: wsA, encounterId: enc.data.id, label: "Knee arthroscopy",
    laterality: "left", consentStatus: "obtained", status: "PERFORMED", ...base,
  });
  ok("a procedure is recorded", proc.ok, proc.ok ? "" : proc.message);
  if (!proc.ok) return report();

  // ── 6. A team entry must identify somebody ───────────────────────────────
  const anonymous = await addParticipant(admin, {
    workspaceId: wsA, procedureId: proc.data.id, role: "assistant", ...base,
  });
  ok("A TEAM ENTRY THAT IDENTIFIES NOBODY IS REFUSED", !anonymous.ok, anonymous.ok ? "added" : anonymous.message);

  const agency = await addParticipant(admin, {
    workspaceId: wsA, procedureId: proc.data.id, role: "scrub", personName: "Mary Wanjiku (agency)", ...base,
  });
  ok("but somebody with no account CAN be named -- an agency nurse is a real participant",
    agency.ok, agency.ok ? "" : agency.message);
  const member = await addParticipant(admin, {
    workspaceId: wsA, procedureId: proc.data.id, role: "assistant", userId: REGISTRAR, ...base,
  });
  ok("CONTROL: a member is added by account", member.ok, member.ok ? "" : member.message);

  // ── 5. An implant needs its identifier ───────────────────────────────────
  const namelessImplant = await addItem(admin, {
    workspaceId: wsA, procedureId: proc.data.id, label: "Meniscal anchor", kind: "implant", ...base,
  });
  ok("AN IMPLANT WITHOUT ITS BATCH NUMBER IS REFUSED -- this patient could not be found in a recall",
    !namelessImplant.ok && namelessImplant.code === "IDENTIFIER_REQUIRED",
    namelessImplant.ok ? "added" : namelessImplant.code);
  const implant = await addItem(admin, {
    workspaceId: wsA, procedureId: proc.data.id, label: "Meniscal anchor", kind: "implant",
    identifier: "LOT-4471-B", ...base,
  });
  ok("CONTROL: with the batch number it is accepted", implant.ok, implant.ok ? "" : implant.message);
  const scope = await addItem(admin, {
    workspaceId: wsA, procedureId: proc.data.id, label: "Arthroscope", kind: "instrument", ...base,
  });
  ok("an instrument needs no identifier", scope.ok, scope.ok ? "" : scope.message);

  const detail = await procedureDetail(admin, wsA, proc.data.id);
  ok("the procedure carries its team and its kit",
    detail.participants.length === 2 && detail.items.length === 2,
    JSON.stringify({ team: detail.participants.length, items: detail.items.length }));
  ok("and the agency nurse is named even without an account",
    detail.participants.some((p: any) => p.name === "Mary Wanjiku (agency)"),
    detail.participants.map((p: any) => p.name).join(", "));

  // ── 7. The kit trace ─────────────────────────────────────────────────────
  const trace = await procedureItemTrace(admin, wsA, "Arthroscope");
  ok("THE KIT TRACE ANSWERS 'which procedures used this'",
    trace.length === 1 && trace[0].procedure_id === proc.data.id, String(trace.length));
  const noTrace = await procedureItemTrace(admin, wsA, "Microscope");
  ok("CONTROL: kit that was never used traces to nothing", noTrace.length === 0, String(noTrace.length));

  // ── 9. Templates seed the team and kit, not the findings ─────────────────
  const template = await createProcedureTemplate(admin, {
    workspaceId: wsA, code: "knee_scope", title: "Knee arthroscopy",
    defaultItems: [
      { kind: "instrument", label: "Arthroscope" },
      { kind: "consumable", label: "Irrigation set" },
      // An implant in a template: it can name no batch number, so it must not be seeded.
      { kind: "implant", label: "Meniscal anchor" },
    ],
    defaultRoles: [{ role: "assistant" }, { role: "scrub" }],
    ...base,
  });
  ok("a procedure template is created", template.ok, template.ok ? "" : template.message);
  if (!template.ok) return report();

  const proc2 = await recordProcedure(admin, {
    workspaceId: wsA, encounterId: enc.data.id, label: "Knee arthroscopy (second)",
    laterality: "right", consentStatus: "obtained", status: "PERFORMED", ...base,
  });
  if (!proc2.ok) { ok("second procedure records", false, proc2.message); return report(); }

  const seeded = await applyProcedureTemplate(admin, {
    workspaceId: wsA, procedureId: proc2.data.id, templateId: template.data.id, ...base,
  });
  ok("applying it seeds the kit and the team", seeded.ok && seeded.data.roles === 2,
    seeded.ok ? JSON.stringify(seeded.data) : seeded.message);
  ok("AN IMPLANT IS NEVER SEEDED FROM A TEMPLATE -- it could not carry a batch number",
    seeded.ok && seeded.data.items === 2, seeded.ok ? String(seeded.data.items) : "");

  const seededDetail = await procedureDetail(admin, wsA, proc2.data.id);
  ok("and nothing seeded is an implant",
    !seededDetail.items.some((i: any) => i.kind === "implant"),
    seededDetail.items.map((i: any) => `${i.kind}:${i.label}`).join(", "));
  ok("a seeded role names a PLACE in the team, not a person who was there",
    seededDetail.participants.every((p: any) => p.name === "(to be named)"),
    seededDetail.participants.map((p: any) => p.name).join(", "));

  // ── 8. The portfolio ─────────────────────────────────────────────────────
  await recordProcedureOutcome(admin, {
    workspaceId: wsA, procedureId: proc.data.id, outcomeType: "complication",
    severity: "mild", detail: "Minor bleeding, settled", ...base,
  });

  const portfolio = await portfolioSummary(admin, wsA, OWNER);
  const serialised = JSON.stringify(portfolio);
  ok("THE PORTFOLIO CONTAINS NO PERCENTAGE ANYWHERE",
    !/\d+(\.\d+)?%/.test(serialised) && !/"(rate|successRate|complicationRate)"/i.test(serialised));
  ok("it reports a COUNT AND ITS DENOMINATOR -- 1 of 2, not 50%",
    portfolio.procedures.withComplication === 1 && portfolio.procedures.complicationDenominator === 2,
    JSON.stringify(portfolio.procedures));
  ok("it counts the caller's own activities by kind",
    portfolio.activities.total === 2 && portfolio.activities.byKind.some(k => k.kind === "teaching"),
    JSON.stringify(portfolio.activities.byKind.map(k => [k.kind, k.total])));
  ok("and totals the CPD time claimed", portfolio.cpdMinutes === 120, String(portfolio.cpdMinutes));
  ok("IT SAYS IN THE PAYLOAD that it is not linked to the platform's competency records",
    portfolio.competencyLinked === false && /not linked/i.test(portfolio.competencyNote),
    portfolio.competencyNote);

  const registrarPortfolio = await portfolioSummary(admin, wsA, REGISTRAR);
  ok("the registrar's portfolio holds their ward round and none of the owner's work",
    registrarPortfolio.activities.total === 1 && registrarPortfolio.procedures.total === 0,
    JSON.stringify({ acts: registrarPortfolio.activities.total, procs: registrarPortfolio.procedures.total }));

  // ── 4. A portfolio is the person's own ───────────────────────────────────
  if (!teaching.ok) return report();
  const notMine = await setPortfolio(admin, {
    workspaceId: wsA, subject: "activity", id: wardRound.ok ? wardRound.data.id : "",
    portfolio: false, actorId: OWNER, correlationId: "h",
  });
  ok("A PORTFOLIO IS THE PERSON'S OWN -- nobody else adds to it or takes from it",
    !notMine.ok && notMine.code === "NOT_YOURS", notMine.ok ? "changed" : notMine.code);
  const isMine = await setPortfolio(admin, {
    workspaceId: wsA, subject: "activity", id: teaching.data.id, portfolio: false,
    actorId: OWNER, correlationId: "h",
  });
  ok("CONTROL: they can change their own", isMine.ok, isMine.ok ? "" : isMine.message);
  const overclaim = await setPortfolio(admin, {
    workspaceId: wsA, subject: "activity", id: teaching.data.id, portfolio: true,
    cpdMinutes: 600, actorId: OWNER, correlationId: "h",
  });
  ok("and cannot claim more CPD than the activity lasted",
    !overclaim.ok && overclaim.code === "CPD_EXCEEDS_DURATION", overclaim.ok ? "changed" : overclaim.code);

  // ── THE OTHER BRANCH OF subject, which nothing here had ever exercised ────
  //
  // setPortfolio takes subject: "procedure" | "activity", and every assertion above passes "activity".
  // The procedure branch selected a duration_minutes column that practice_procedure has never had, so
  // PostgREST errored, the discarded error left the row null, and it returned "Not found" for a
  // procedure that plainly existed. CLAIMING CPD AGAINST A PROCEDURE HAD NEVER ONCE WORKED, and said
  // the procedure did not exist. Found while building CPR-240.
  //
  // GENERAL RULE: a discriminated parameter needs an assertion per branch. One branch green is not
  // coverage, it is half of it.
  const procedurePortfolio = await setPortfolio(admin, {
    workspaceId: wsA, subject: "procedure", id: proc.data.id, portfolio: true, cpdMinutes: 45,
    actorId: OWNER, correlationId: "h",
  });
  ok("CPD CAN BE CLAIMED AGAINST A PROCEDURE -- the other branch of `subject`",
    procedurePortfolio.ok, procedurePortfolio.ok ? "" : `${procedurePortfolio.code}: ${procedurePortfolio.message}`);
  const { data: claimedProc } = await admin.from("practice_procedure")
    .select("portfolio, cpd_minutes").eq("id", proc.data.id).maybeSingle();
  ok("and it actually lands on the row, rather than reporting a success it did not perform",
    claimedProc?.portfolio === true && claimedProc?.cpd_minutes === 45,
    JSON.stringify(claimedProc));
  const procNotMine = await setPortfolio(admin, {
    workspaceId: wsA, subject: "procedure", id: proc.data.id, portfolio: false,
    actorId: REGISTRAR, correlationId: "h",
  });
  ok("and a procedure's portfolio entry is still its performer's own",
    !procNotMine.ok && procNotMine.code === "NOT_YOURS", procNotMine.ok ? "changed" : procNotMine.code);

  // ══ CPR-PCA-HFE-012: THE UNIFIED ACTIVITY RECORD ══════════════════════════════════════════════
  //
  // Procedures PROJECT into the record; logged activities live in it; the two fail separately. The
  // fixtures above are exactly right: the owner holds two performed procedures (one with a recorded
  // complication) and one teaching session; the registrar holds one ward round and no procedures.
  const rec = await activityRecord(admin, wsA, { performedBy: OWNER });
  const recProcs = rec.items.filter((r: any) => r.recordKind === "procedure");
  const recActs = rec.items.filter((r: any) => r.recordKind === "activity");
  ok("012-1. ONE RECORD, TWO SOURCES: the owner's procedures and logged activities arrive together",
    recProcs.length === 2 && recActs.length === 2
      && !rec.procedures.unavailable && !rec.activities.unavailable,
    JSON.stringify({ procs: recProcs.length, acts: recActs.length }));
  const knee = recProcs.find((r: any) => r.title === "Knee arthroscopy");
  ok("012-1b. a projected procedure carries its encounter, its status and its OWN complication state",
    !!knee && knee.encounterId === enc.data.id && knee.status === "PERFORMED" && knee.hasComplication === true,
    JSON.stringify({ enc: knee?.encounterId === enc.data.id, status: knee?.status, comp: knee?.hasComplication }));

  // ⚠ s13 IS STRUCTURAL, AND THIS PROVES THE STRUCTURE: no activity row of kind "procedure" exists
  // anywhere, so the procedures on the record can only be the projection -- there is no copy to drift
  // and no duplicate to protect against.
  const { data: copyRows } = await admin.from("practice_clinical_activity")
    .select("id").eq("workspace_id", wsA).eq("kind", "procedure");
  ok("012-2. THE PROJECTION IS A READ, NEVER A COPY -- no 'procedure' row exists in the activity table",
    (copyRows ?? []).length === 0 && recProcs.length > 0,
    `${(copyRows ?? []).length} copies; the projection half is non-vacuous (${recProcs.length} projected)`);

  const onlyProcs = await activityRecord(admin, wsA, { performedBy: OWNER, kind: "procedure" });
  const onlyTeaching = await activityRecord(admin, wsA, { performedBy: OWNER, kind: "teaching" });
  ok("012-3. the kind filter narrows to ONE source: 'procedure' yields only projections, a kind only logs",
    onlyProcs.items.every((r: any) => r.recordKind === "procedure") && onlyProcs.items.length === 2
      && onlyTeaching.items.every((r: any) => r.kind === "teaching") && onlyTeaching.items.length === 1,
    JSON.stringify({ procs: onlyProcs.items.length, teaching: onlyTeaching.items.length }));

  const registrarRec = await activityRecord(admin, wsA, { performedBy: REGISTRAR });
  ok("012-4. the record belongs to WHOEVER DID THE WORK: the registrar sees their ward round, no procedures",
    registrarRec.items.length === 1 && registrarRec.items[0].kind === "ward_round",
    JSON.stringify(registrarRec.items.map((r: any) => r.kind)));

  ok("012-5. the merged record is chronological, most recent first",
    rec.items.every((r: any, i: number) =>
      i === 0 || String(rec.items[i - 1].occurredAt) >= String(r.occurredAt)),
    JSON.stringify(rec.items.map((r: any) => String(r.occurredAt).slice(11, 19))));

  // ⚠ THE TWO SOURCES FAIL SEPARATELY -- the reason activityRecord returns per-source states. The
  // procedure store is unplugged with a stub client; the logged activities MUST still arrive, and the
  // failure must be named rather than rendered as a clinician who performed nothing.
  const failingBuilder: any = new Proxy({}, {
    get: (_t, prop) => prop === "then"
      ? (resolve: any) => Promise.resolve({ data: null, error: { message: "harness: procedure store unplugged" } }).then(resolve)
      : () => failingBuilder,
  });
  const brokenProcedures: any = { from: (t: string) => t === "practice_procedure" ? failingBuilder : admin.from(t) };
  const halfBroken = await activityRecord(brokenProcedures, wsA, { performedBy: OWNER });
  ok("012-6. a broken procedure read DOES NOT BLANK the logged activities, and says which half failed",
    halfBroken.procedures.unavailable === true
      && /unplugged/.test(String(halfBroken.procedures.detail))
      && halfBroken.activities.unavailable === false
      && halfBroken.items.some((r: any) => r.recordKind === "activity")
      && halfBroken.items.every((r: any) => r.recordKind !== "procedure"),
    JSON.stringify({ pUn: halfBroken.procedures.unavailable, aUn: halfBroken.activities.unavailable, items: halfBroken.items.length }));

  // ⚠ A PORTFOLIO COUNTS WORK DONE, NEVER WORK INTENDED. A SCHEDULED procedure has no performed_at
  // and must not appear -- with the control that it genuinely exists in the procedure table.
  const scheduled = await recordProcedure(admin, {
    workspaceId: wsA, encounterId: enc.data.id, label: "Planned arthroscopy review",
    status: "SCHEDULED", scheduledAt: new Date(Date.now() + 86400000).toISOString(),
    consentStatus: "obtained", ...base,
  });
  ok("012-7a. PRECONDITION: the scheduled procedure records (7b is not vacuous)",
    scheduled.ok, scheduled.ok ? "" : (scheduled as any).message);
  if (scheduled.ok) {
    // ⚠ NO performedBy FILTER, DELIBERATELY. A scheduled procedure has performed_by null (nobody has
    // done it), so a performer-filtered query would exclude it through THAT column and this assertion
    // would stay green with the performed_at rule deleted -- which is exactly what the break-test
    // found on the first version of this block. Unfiltered, only the rule under test can exclude it.
    const afterScheduled = await activityRecord(admin, wsA, { kind: "procedure" });
    const { data: schedRow } = await admin.from("practice_procedure")
      .select("id, performed_at").eq("id", scheduled.data.id).maybeSingle();
    ok("012-7. INTENTIONS ARE NOT IN THE RECORD: the scheduled procedure exists in the table and not here",
      !!schedRow && schedRow.performed_at === null
        && !afterScheduled.items.some((r: any) => r.id === scheduled.data.id),
      JSON.stringify({ exists: !!schedRow, performedAt: schedRow?.performed_at ?? "missing" }));
  }

  // ══ MIGRATION 302: EXTERNAL PROCEDURES ════════════════════════════════════════════════════════
  //
  // s13's explicit off-platform workflow. What must hold: it projects as Type Procedure with external
  // provenance, it carries NO complication claim, its idempotency folds case and whitespace, it never
  // records future work, and it stays out of the encounter-derived counts.
  // ⚠ A DELTA, NOT A PINNED TOTAL. Earlier sections claim CPD of their own (the subject-procedure
  // branch writes cpd onto a procedure), so a fixed number here would be the pinned-count trap this
  // memory file records five instances of in one day.
  const pfBefore = await portfolioSummary(admin, wsA, OWNER);
  ok("302-0. PRECONDITION: no external procedures exist yet (302-5 measures a delta from zero)",
    pfBefore.procedures.external === 0, String(pfBefore.procedures.external));

  const ext = await recordExternalProcedure(admin, {
    workspaceId: wsA, label: "Caesarean section", source: "Mulago Hospital, obstetric theatre",
    sourceRef: "LOGBOOK-2024-117", role: "assistant", performedAt: "2024-03-12T09:30:00Z",
    cpdMinutes: 60, portfolio: true, ...base,
  });
  ok("302-1. an external procedure records with its source and reference", ext.ok,
    ext.ok ? "" : (ext as any).message);
  if (!ext.ok) return report();

  const extRec = await activityRecord(admin, wsA, { performedBy: OWNER, kind: "procedure" });
  const extRow = extRec.items.find((r: any) => r.id === ext.data.id);
  ok("302-2. it projects as Type PROCEDURE wearing EXTERNAL provenance -- s9 and s12 together",
    !!extRow && extRow.recordKind === "procedure" && extRow.external === true
      && extRow.source === "Mulago Hospital, obstetric theatre" && extRow.role === "assistant"
      && extRow.encounterId === null,
    JSON.stringify({ found: !!extRow, ext: extRow?.external, src: extRow?.source }));
  ok("302-2b. and it makes NO complication claim -- the assessment never happened here (s15, structural)",
    !!extRow && extRow.complicationsAssessed === false && extRow.hasComplication === false,
    JSON.stringify({ assessed: extRow?.complicationsAssessed, has: extRow?.hasComplication }));
  const encRow = extRec.items.find((r: any) => r.title === "Knee arthroscopy");
  ok("302-2c. CONTROL: the encounter procedure beside it IS assessed and says so",
    !!encRow && encRow.external === false && encRow.complicationsAssessed === true && encRow.hasComplication === true);

  const dupRef = await recordExternalProcedure(admin, {
    workspaceId: wsA, label: "Caesarean section again", source: "Mulago Hospital",
    sourceRef: "  logbook-2024-117 ", performedAt: "2024-03-12T09:30:00Z", ...base,
  });
  ok("302-3. s13's idempotency: the same reference, case- and space-mangled, is refused BY NAME",
    !dupRef.ok && dupRef.code === "DUPLICATE_EXTERNAL", dupRef.ok ? "recorded twice" : String(dupRef.code));
  const refless1 = await recordExternalProcedure(admin, {
    workspaceId: wsA, label: "Wound debridement", source: "Field clinic", performedAt: "2023-06-01T10:00:00Z", ...base,
  });
  const refless2 = await recordExternalProcedure(admin, {
    workspaceId: wsA, label: "Wound debridement", source: "Field clinic", performedAt: "2023-06-02T10:00:00Z", ...base,
  });
  ok("302-3b. CONTROL: rows WITHOUT a reference are never treated as duplicates of each other",
    refless1.ok && refless2.ok, JSON.stringify({ a: refless1.ok, b: refless2.ok }));

  const future = await recordExternalProcedure(admin, {
    workspaceId: wsA, label: "Planned future case", source: "Somewhere",
    performedAt: new Date(Date.now() + 7 * 86400000).toISOString(), ...base,
  });
  ok("302-4. FUTURE WORK IS REFUSED -- the record counts work done, and there is no scheduled external",
    !future.ok && future.code === "NOT_YET_DONE", future.ok ? "recorded" : String(future.code));
  const noSource = await recordExternalProcedure(admin, {
    workspaceId: wsA, label: "Sourceless claim", source: "  ", performedAt: "2024-01-01T10:00:00Z", ...base,
  });
  ok("302-4b. and a record with no source is refused -- provenance is what makes it checkable",
    !noSource.ok, noSource.ok ? "recorded" : "");

  const pf = await portfolioSummary(admin, wsA, OWNER);
  ok("302-5. the portfolio counts externals SEPARATELY -- never inside the encounter-derived figures",
    pf.procedures.external === 3 && pf.procedures.performed === pfBefore.procedures.performed,
    JSON.stringify({ external: pf.procedures.external, performed: [pfBefore.procedures.performed, pf.procedures.performed] }));
  ok("302-5b. and their CPD joins the period total (as a delta against the pre-external figure)",
    pf.cpdMinutes === pfBefore.cpdMinutes + 60,
    JSON.stringify({ before: pfBefore.cpdMinutes, after: pf.cpdMinutes }));
  ok("302-5c. a portfolio-flagged external counts as a portfolio item",
    pf.portfolioItems === pfBefore.portfolioItems + 1,
    JSON.stringify({ before: pfBefore.portfolioItems, after: pf.portfolioItems }));

  const notMineRemoval = await removeExternalProcedure(admin, {
    workspaceId: wsA, id: ext.data.id, actorId: REGISTRAR, correlationId: "harness-act",
  });
  ok("302-6. somebody else cannot remove it -- refused as NOT_YOURS, the honest reason",
    !notMineRemoval.ok && notMineRemoval.code === "NOT_YOURS",
    notMineRemoval.ok ? "removed" : String(notMineRemoval.code));
  const ownRemovalExt = refless2.ok ? await removeExternalProcedure(admin, {
    workspaceId: wsA, id: refless2.data.id, ...base,
  }) : { ok: false as const };
  ok("302-6b. CONTROL: its own author can", ownRemovalExt.ok === true,
    ownRemovalExt.ok ? "" : (ownRemovalExt as any).code ?? "fixture missing");

  const crossExt = await activityRecord(admin, wsB, { kind: "procedure" });
  ok("302-7. another workspace's record holds none of them (non-vacuous: A has some)",
    !crossExt.items.some((r: any) => r.external) && extRec.items.some((r: any) => r.external),
    JSON.stringify({ b: crossExt.items.length }));

  // ── The page and console, source-checked (s3, s17, s18) ──
  const appDir = join(process.cwd(), "src", "app", "practice", "(shell)", "activity");
  const pageSrc = readFileSync(join(appDir, "page.tsx"), "utf8");
  const consoleSrc = readFileSync(join(appDir, "ActivityConsole.tsx"), "utf8");
  ok("012-UI-1. s3: the page is titled 'Procedures & Clinical Activity' with the longitudinal subtitle",
    pageSrc.includes("Procedures &amp; Clinical Activity")
      && pageSrc.includes("Your longitudinal record of procedures performed and other professional clinical activities."));
  ok("012-UI-1b. and the old activity-only subtitle -- the wording s3 forbids -- is gone",
    !pageSrc.includes("What you did that was not a procedure"));
  ok("012-UI-2. s18: the unbuilt-AI commentary is OFF the production page",
    !consoleSrc.includes("AI assisted documentation") && !consoleSrc.includes("CPR-210"),
    "roadmap references must not render as clinician-facing UI");
  ok("012-UI-2b. CONTROL: this is still the file that renders the record (the needle searched the right haystack)",
    consoleSrc.includes("ClinicalRecordTable") && consoleSrc.includes("Activity record"));
  ok("012-UI-3. s17: 'Nothing logged yet' is gone -- it lied whenever procedures existed",
    !consoleSrc.includes("Nothing logged yet"));
  ok("012-UI-3b. and each area's empty state is local and specific",
    consoleSrc.includes("No procedures recorded for this period.")
      && consoleSrc.includes("No other professional activity recorded for this period."));
  // Needle repointed 2026-08-15 when the Encounter branch grew its external sibling -- the string is
  // now `: "Encounter")`, and deleting the assertion instead of repointing it is the recorded sin.
  ok("012-UI-4. s12: rows wear their provenance -- Encounter for projections, You/name for logged work",
    consoleSrc.includes(': "Encounter"') && consoleSrc.includes('? "You"'));
  ok("012-UI-5. s11: five direct filters plus More, not a chip for every category",
    consoleSrc.includes("DIRECT_FILTERS") && consoleSrc.includes("MORE_FILTERS")
      && (consoleSrc.match(/\["procedure", "Procedures"\]/) !== null));
  ok("012-UI-6. s5/s19: the footer explains automatic capture; Export / report is a header action",
    consoleSrc.includes("captured automatically from encounter records")
      && pageSrc.includes('href="/practice/portfolio"'));

  ok("302-UI-1. s13: the external workflow is EXPLICIT and separate -- its own button, its own form",
    consoleSrc.includes("Record external procedure")
      && consoleSrc.includes("Record an external procedure")
      && /recording\s+one of those again would double it/.test(consoleSrc),
    "an external procedure must never be a mode of Log activity");
  ok("302-UI-2. s15: an external row's outcome cell says the assessment never happened here",
    consoleSrc.includes("outcomes not assessed here"));
  ok("302-UI-3. s12: external provenance renders as External with its source, beside Encounter rows",
    consoleSrc.includes("`External · ${r.source}`"));
  const routeSrc = readFileSync(join(process.cwd(), "src", "app", "api", "v1", "practice", "activities", "route.ts"), "utf8");
  ok("302-UI-4. the DELETE verb is confined to the external subject -- clinical rows gain no delete",
    routeSrc.includes('url.searchParams.get("subject") !== "external_procedure"')
      && routeSrc.includes("removeExternalProcedure"));

  // ── 10. Isolation ────────────────────────────────────────────────────────
  const crossItem = await addItem(admin, {
    workspaceId: wsB, procedureId: proc.data.id, label: "Probe", actorId: OTHER, correlationId: "h",
  });
  ok("another workspace's procedure takes no items", !crossItem.ok && crossItem.code === "NOT_FOUND");
  ok("B has no activities", (await listActivities(admin, wsB, {})).length === 0);
  ok("A does (the isolation test is not vacuous)", (await listActivities(admin, wsA, {})).length > 0);

  return report();
}

function report() {
  console.log(`\n${fails.length === 0 ? "PASSED" : "FAILED"}  ${pass} passed, ${fails.length} failed`);
  if (fails.length) { for (const f of fails) console.log(`  - ${f}`); process.exitCode = 1; }
}

main()
  .then(cleanup)
  .catch(async e => { console.error(e); await cleanup(); process.exitCode = 1; });
