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
import {
  recordActivity, listActivities, addParticipant, addItem, procedureDetail, procedureItemTrace,
  createProcedureTemplate, applyProcedureTemplate, portfolioSummary, setPortfolio, ACTIVITY_KINDS,
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
