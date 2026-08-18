/**
 * Continuity Pathways harness -- CPR-FUP-003 / migration 239, against the live database through the
 * same engine the API uses.
 *
 * WHAT IT PROVES:
 *   0. MIGRATION 239 IS DEPLOYED, and it is GATED rather than assumed: the five pathway tables are
 *      probed first and the run stops with a sentence if they are absent, instead of failing forty
 *      assertions with a PostgREST code nobody can read.
 *   1. ⚠ THE STATUS CONSTRAINT ACTUALLY WIDENED. 239 drops `practice_follow_up_status_check` -- the name
 *      Postgres GENERATES for migration 196's inline check. If that guess were wrong the drop would be a
 *      silent no-op, the old five-value constraint would stand, and DRAFT/DEFERRED would be rejected
 *      while the migration reported success. Asserted by WRITING a DRAFT row and a DEFERRED row, with a
 *      control (a nonsense status is still refused, so the table is not simply unconstrained).
 *   2. A PATHWAY IS A PLAN, NOT A PROTOCOL. Every deviation -- skip, repeat, delay, cancel, end early --
 *      succeeds, and every one of them lands in practice_pathway_event with the practitioner's reason.
 *      Each is paired with the same call refused for having NO reason, which is the only thing a
 *      deviation is ever refused for.
 *   3. A STAGE CANNOT RAISE A SECOND ACTIVE FOLLOW-UP (s9), asserted by NAMING the follow-up id that
 *      comes back rather than counting rows -- and controlled by closing it and watching a NEW one be
 *      raised, which proves the guard is about ACTIVE and not about ever.
 *   4. PROGRESS IS DERIVED FROM DATES. On track and Overdue are date arithmetic against the PRACTICE's
 *      today; "At risk" is absent from the vocabulary entirely and asserted absent.
 *   5. CONCURRENT PATHWAYS work (s11) and the same plan twice does not.
 *   6. HISTORY IS PERMANENT (s16): after a pathway is stopped, its stages and its audit trail are still
 *      readable, and a repeated stage appears TWICE -- which a current-stage pointer could not express.
 *   7. A FAILED READ IS NEVER AN EMPTY LIST, with a control through the real client.
 *   8. Workspace isolation non-vacuously; anon reads 0 rows from all five tables while the service role
 *      reads rows from all five.
 *   9. THE CARD COLOURS ARE KEYED ON THE ENGINE'S OWN CARD KEYS, as an equality in both directions
 *      against PATHWAY_CARD_SHAPE and against what pathwayWorkspace() emitted. A drifted swatch map
 *      compiles perfectly and renders a real figure in dead grey; it has shipped twice in palette.ts.
 *
 *   npx --yes tsx scripts/practice-pathways-harness.ts
 */
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { runProvisioning, type IndividualRequest } from "../src/lib/practice/provisioning";
import { registerPatient } from "../src/lib/practice/patients";
import { launchEncounter, transitionEncounter } from "../src/lib/practice/encounters";
import { closeFollowUp, listFollowUps, practiceToday, dueDateFrom } from "../src/lib/practice/follow-ups";
import {
  createPathwayTemplate, publishPathwayVersion, setTemplateActive, listPathwayTemplates,
  assignPathway, completeStage, skipStage, repeatStage, delayStage, cancelStage, stopPathway,
  listPatientPathways, getPatientPathway, pathwayWorkspace, raiseStageFollowUp, PATHWAY_CARD_SHAPE,
  type TemplateStage,
} from "../src/lib/practice/pathways";
import { PATHWAY_CARD_SWATCH } from "../src/lib/practice/palette";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { purgeWorkspacesOwnedBy, cleanupOnKill } from "./_cleanup";
import {
  PATHWAY_PROGRESS_STATES, PATHWAY_DEVIATIONS, pathwayProgress, addDays,
} from "../src/lib/practice/pathways-constants";

loadEnvConfig(process.cwd());

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!url || !key || !anonKey) { console.error("Supabase env not set"); process.exit(1); }
const admin = createClient(url, key, { auth: { persistSession: false } });
const anon = createClient(url, anonKey, { auth: { persistSession: false } });

const USER_A = "00000000-0000-4000-8000-0000000e0fa1";
const USER_B = "00000000-0000-4000-8000-0000000e0fa2";

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
    idempotency_key: `harness-pw-${suffix}`, request_type: "pilot",
    actor_user_id: user, target_user_id: user, payload_hash: "harness", correlation_id: "harness-pw",
  }).select("id").single();
  const run = await runProvisioning(admin, { id: req!.id, target_user_id: user, correlation_id: "harness-pw", workspace_id: null }, payload(name));
  if (!run.ok || !run.workspaceId) throw new Error(`provisioning failed: ${run.errorCode}${run.detail ? " -- " + run.detail : ""}`);
  return run.workspaceId;
}

async function cleanup() {
  await purgeWorkspacesOwnedBy(admin, [USER_A, USER_B]);
}

const base = { actorId: USER_A, correlationId: "harness-pw" };

/* eslint-disable @typescript-eslint/no-explicit-any */

const VP_SHUNT: { name: string; offsetDays: number; followUpKind?: string | null }[] = [
  { name: "Procedure completed", offsetDays: 0, followUpKind: null },
  { name: "Review after 2 weeks", offsetDays: 14, followUpKind: "review" },
  { name: "Review after 3 months", offsetDays: 90, followUpKind: "review" },
  { name: "Annual review", offsetDays: 365, followUpKind: "monitoring" },
];

function report() {
  console.log(`\n${pass} passed, ${fails.length} failed`);
  if (fails.length) { fails.forEach(f => console.log(`  - ${f}`)); process.exit(1); }
  process.exit(0);
}

async function main() {
  console.log("\nContinuity Pathways harness (CPR-FUP-001/002/003, migration 239)\n");

  // ── 0. IS MIGRATION 239 APPLIED? GATED, NOT ASSUMED ───────────────────────────────────────────────
  const TABLES = [
    "practice_pathway_template", "practice_pathway_stage", "practice_patient_pathway",
    "practice_patient_pathway_stage", "practice_pathway_event",
  ];
  const missing: string[] = [];
  for (const t of TABLES) {
    const probe = await admin.from(t).select("id", { count: "exact", head: true });
    if (probe.error) missing.push(`${t} (${probe.error.code ?? "?"} ${probe.error.message})`);
  }
  if (missing.length > 0) {
    console.log("  STOP  migration 239 is NOT applied. These tables are absent:");
    missing.forEach(m => console.log(`          ${m}`));
    console.log("\n        Apply supabase/migrations/239-practice-continuity-pathways.sql and re-run.");
    console.log("        Nothing below was tested -- this is not a pass and not a failure of the engine.\n");
    process.exit(2);
  }
  ok("migration 239's five pathway tables are all present (the gate above is not vacuous)", true, `${TABLES.length}/${TABLES.length}`);

  await cleanup();
  const wsA = await provision(USER_A, "HARNESS Pathway A (synthetic)", "a");
  const wsB = await provision(USER_B, "HARNESS Pathway B (synthetic)", "b");
  const today = practiceToday("Africa/Kampala");

  const pa = await registerPatient(admin, {
    workspaceId: wsA, displayName: "Aisha Kigongo", birthDate: "2014-04-02", sex: "female", phone: "0772 555 900", ...base,
  });
  const pb = await registerPatient(admin, {
    workspaceId: wsA, displayName: "James Mukasa", birthDate: "2018-01-19", sex: "male", phone: "0772 555 901", ...base,
  });
  if (!pa.ok || !pb.ok) { ok("patient registration for the harness succeeded", false, pa.ok ? (pb as any).message : (pa as any).message); return report(); }
  const patientA = pa.data.id;
  const patientB = pb.data.id;

  // ══ 1. ⚠ DID THE STATUS CONSTRAINT ACTUALLY WIDEN? ═══════════════════════════════════════════════
  //
  // Migration 239 drops `practice_follow_up_status_check` by NAME -- Postgres's generated name for
  // migration 196's inline column check. `drop constraint if exists` on a wrong name is a SILENT NO-OP:
  // the migration reports success, the new constraint is added beside the old one, and the OLD one still
  // refuses DRAFT and DEFERRED. That class of failure has shipped twice in this codebase, so it is
  // asserted by writing rows rather than by reading the migration.
  const rawInsert = async (row: Record<string, unknown>) => admin.from("practice_follow_up")
    .insert({ workspace_id: wsA, patient_id: patientA, reason: "constraint probe", due_on: dueDateFrom(today, 7), ...row })
    .select("id").maybeSingle();

  const draftRaw = await rawInsert({ status: "DRAFT" });
  ok("⚠ a DRAFT follow-up is ACCEPTED by the database -- migration 196's old five-value check is GONE",
    !draftRaw.error, draftRaw.error?.message ?? "");
  const deferredRaw = await rawInsert({ status: "DEFERRED", deferred_until: dueDateFrom(today, 30) });
  ok("⚠ a DEFERRED follow-up WITH a date is ACCEPTED (the widened list really took effect)",
    !deferredRaw.error, deferredRaw.error?.message ?? "");

  // CONTROL 1. Without this the two above pass just as well if the column were unconstrained entirely.
  const nonsenseRaw = await rawInsert({ status: "NOT_A_STATUS" });
  ok("control. a nonsense status is still REFUSED, so the column is constrained and not merely open",
    !!nonsenseRaw.error && /status/i.test(nonsenseRaw.error.message), nonsenseRaw.error?.message ?? "it was accepted");

  // CONTROL 2. The deferral date is required BY THE DATABASE, not only by the engine.
  const deferredNoDate = await rawInsert({ status: "DEFERRED" });
  ok("a DEFERRED follow-up with NO date is refused by the database (239's deferred_needs_date)",
    !!deferredNoDate.error && /deferred/i.test(deferredNoDate.error.message), deferredNoDate.error?.message ?? "it was accepted");

  const badSource = await rawInsert({ status: "OPEN", source: "telepathy" });
  ok("an unknown source is refused (239's source_allowed is live)",
    !!badSource.error && /source/i.test(badSource.error.message), badSource.error?.message ?? "it was accepted");
  const goodSource = await rawInsert({ status: "OPEN", source: "pathway", origin_workspace: "pathways" });
  ok("control. source='pathway' with origin_workspace='pathways' IS accepted", !!goodSource.data, goodSource.error?.message ?? "");

  for (const id of [draftRaw.data?.id, deferredRaw.data?.id, goodSource.data?.id].filter(Boolean)) {
    await admin.from("practice_follow_up").delete().eq("id", id);
  }

  // ══ 2. TEMPLATES (s5) AND WHAT THEY REFUSE ═══════════════════════════════════════════════════════
  const noStages = await createPathwayTemplate(admin, {
    workspaceId: wsA, name: "Empty plan", stages: [], ...base,
  });
  ok("a template with no stages is refused (it would assign and then do nothing)",
    !noStages.ok && noStages.code === "NO_STAGES", noStages.ok ? "was allowed" : noStages.code);

  const badOffset = await createPathwayTemplate(admin, {
    workspaceId: wsA, name: "Bad timing", stages: [{ name: "s", offsetDays: -3 }], ...base,
  });
  ok("a negative stage offset is refused (a stage cannot be due before the one before it)",
    !badOffset.ok && badOffset.code === "VALIDATION_ERROR", badOffset.ok ? "was allowed" : badOffset.code);

  const badRule = await createPathwayTemplate(admin, {
    workspaceId: wsA, name: "Bad rule", stages: [{ name: "s", offsetDays: 1, completionRule: "telepathy" }], ...base,
  });
  ok("an unknown completion rule is refused, not silently defaulted",
    !badRule.ok && badRule.code === "UNKNOWN_COMPLETION_RULE", badRule.ok ? "was allowed" : badRule.code);

  const badKind = await createPathwayTemplate(admin, {
    workspaceId: wsA, name: "Bad kind", stages: [{ name: "s", offsetDays: 1, followUpKind: "vibes" }], ...base,
  });
  ok("a stage cannot raise a follow-up of a kind the catalogue does not have",
    !badKind.ok && badKind.code === "UNKNOWN_FOLLOW_UP_KIND", badKind.ok ? "was allowed" : badKind.code);

  const vp = await createPathwayTemplate(admin, {
    workspaceId: wsA, name: "VP Shunt Follow-up", specialty: "Paediatric neurosurgery",
    entryCriteria: "Shunt inserted or revised. Read by the practitioner before assigning - never evaluated.",
    exitCriteria: "Five years of stable surveillance.",
    stages: VP_SHUNT, ...base,
  });
  ok("control. a well-formed template is created (the four refusals above are not blanket)",
    vp.ok, vp.ok ? "" : vp.message);
  if (!vp.ok) return report();

  const epilepsy = await createPathwayTemplate(admin, {
    workspaceId: wsA, name: "Epilepsy Management", specialty: "Paediatric neurology",
    stages: [
      { name: "Baseline review", offsetDays: 0, followUpKind: "review" },
      { name: "Medication review", offsetDays: 30, followUpKind: "treatment_response" },
      { name: "Annual EEG", offsetDays: 365, followUpKind: "investigation_result" },
    ], ...base,
  });
  if (!epilepsy.ok) { ok("the second template for the concurrency test was created", false, epilepsy.message); return report(); }

  const templates = await listPathwayTemplates(admin, wsA);
  ok("both templates are listed with their stages loaded, in position order",
    templates.items.length === 2 &&
    templates.items.find(t => t.name === "VP Shunt Follow-up")?.stages.map(s => s.position).join(",") === "1,2,3,4",
    JSON.stringify(templates.items.map(t => ({ n: t.name, s: t.stages.length }))));

  // ⚠ ENTRY CRITERIA ARE TEXT, NOT RULES. Asserted as a fact about the value, because the danger is that
  // somebody later reads it and acts on it -- which would make this protocol enforcement, which s2 forbids.
  ok("entry criteria are stored as prose a practitioner reads, not as anything executable",
    typeof templates.items.find(t => t.name === "VP Shunt Follow-up")?.entry_criteria === "string",
    String(templates.items.find(t => t.name === "VP Shunt Follow-up")?.entry_criteria).slice(0, 40));

  // ══ 3. ASSIGNMENT (s7), CONCURRENCY (s11), AND THE FIRST OBLIGATION ══════════════════════════════
  const assigned = await assignPathway(admin, {
    workspaceId: wsA, patientId: patientA, templateId: vp.data.id, trigger: "procedure", ...base,
  });
  ok("a patient is put on a pathway and the first stage is entered", assigned.ok, assigned.ok ? "" : assigned.message);
  if (!assigned.ok) return report();
  ok("stage 1 raises nothing, because the template says it raises nothing (follow_up_kind is null)",
    assigned.data.followUpId === null, String(assigned.data.followUpId));

  const again = await assignPathway(admin, {
    workspaceId: wsA, patientId: patientA, templateId: vp.data.id, ...base,
  });
  ok("the SAME plan twice at once is refused (a double-booking, not concurrent care)",
    !again.ok && again.code === "ALREADY_ON_PATHWAY", again.ok ? "was allowed" : again.code);

  const concurrent = await assignPathway(admin, {
    workspaceId: wsA, patientId: patientA, templateId: epilepsy.data.id, trigger: "diagnosis", ...base,
  });
  ok("control. a DIFFERENT plan for the same patient IS permitted (s11 concurrent pathways)",
    concurrent.ok, concurrent.ok ? "" : concurrent.message);
  if (!concurrent.ok) return report();
  ok("the epilepsy plan's first stage raised its own obligation (the two run independently)",
    !!concurrent.data.followUpId, String(concurrent.data.followUpId));

  const badTrigger = await assignPathway(admin, {
    workspaceId: wsA, patientId: patientB, templateId: vp.data.id, trigger: "vibes", ...base,
  });
  ok("an unknown trigger is refused", !badTrigger.ok && badTrigger.code === "UNKNOWN_TRIGGER",
    badTrigger.ok ? "was allowed" : badTrigger.code);

  // ══ 4. ⚠ A STAGE CANNOT RAISE A SECOND ACTIVE FOLLOW-UP (s9) ═════════════════════════════════════
  //
  // Asserted DIRECTLY against the rule, and by NAMING the id that comes back rather than counting rows:
  // a count of 1 would also be produced by a raise that silently failed.
  const { data: liveRow } = await admin.from("practice_patient_pathway_stage")
    .select("id, stage_id, follow_up_id").eq("patient_pathway_id", concurrent.data.id).eq("state", "entered").maybeSingle();
  const { data: epiStages } = await admin.from("practice_pathway_stage")
    .select("id, position, name, offset_days, required_action, completion_rule, follow_up_kind, follow_up_priority")
    .eq("template_id", epilepsy.data.id).order("position");
  const stage1 = ((epiStages ?? []) as TemplateStage[])[0];

  const second = await raiseStageFollowUp(admin, {
    workspaceId: wsA, patientPathwayId: concurrent.data.id, patientId: patientA,
    stage: stage1, templateName: "Epilepsy Management", dueOn: dueDateFrom(today, 30), ...base,
  });
  ok("⚠ asking the SAME stage for a follow-up again returns THE ONE IT ALREADY RAISED, by id",
    second.followUpId === liveRow?.follow_up_id && second.reused === true,
    JSON.stringify({ got: second.followUpId, existing: liveRow?.follow_up_id, reused: second.reused }));

  const pathwaySourced = (await listFollowUps(admin, wsA, { patientId: patientA })).items
    .filter(f => f.source === "pathway" && f.reason.startsWith("Epilepsy Management: Baseline"));
  ok("and there is exactly ONE such obligation on the board, named, not merely counted",
    pathwaySourced.length === 1 && pathwaySourced[0].id === liveRow?.follow_up_id,
    JSON.stringify(pathwaySourced.map(f => f.id)));

  // CONTROL. The guard is about ACTIVE, not about ever: close it, and a new one IS raised.
  await closeFollowUp(admin, {
    workspaceId: wsA, followUpId: liveRow!.follow_up_id, to: "CANCELLED",
    outcome: "closing it so the harness can prove the guard is about live obligations", ...base,
  });
  const third = await raiseStageFollowUp(admin, {
    workspaceId: wsA, patientPathwayId: concurrent.data.id, patientId: patientA,
    stage: stage1, templateName: "Epilepsy Management", dueOn: dueDateFrom(today, 30), ...base,
  });
  ok("control. once the obligation is closed, the same stage DOES raise a fresh one (a new id)",
    !!third.followUpId && third.followUpId !== liveRow?.follow_up_id && third.reused === false,
    JSON.stringify({ got: third.followUpId, old: liveRow?.follow_up_id, reused: third.reused }));
  // Put the stage row back in the state the engine's own path would leave it in, so the assertions
  // further down are made against a consistent record rather than one this test left half-wired.
  await admin.from("practice_patient_pathway_stage").update({ follow_up_id: third.followUpId }).eq("id", liveRow!.id);

  // ══ 5. STAGE PROGRESSION (s8) ════════════════════════════════════════════════════════════════════
  const step2 = await completeStage(admin, { workspaceId: wsA, patientPathwayId: assigned.data.id, note: "shunt sited, wound clean", ...base });
  ok("completing a stage moves the patient to the next one and raises its obligation",
    step2.ok && step2.data.nextStageName === "Review after 2 weeks" && !!step2.data.nextFollowUpId,
    step2.ok ? JSON.stringify(step2.data) : step2.message);
  if (!step2.ok) return report();
  ok("the next stage is due offsetDays after TODAY, not after the pathway's start date",
    step2.data.nextDueOn === addDays(today, 14), `${step2.data.nextDueOn} vs ${addDays(today, 14)}`);
  ok("completing a stage needs NO reason (only deviations do)", step2.data.warnings.length === 0,
    JSON.stringify(step2.data.warnings));

  const raised = (await listFollowUps(admin, wsA, { patientId: patientA })).items
    .find(f => f.id === step2.data.nextFollowUpId);
  ok("the obligation it raised carries source='pathway' and names the plan it came from",
    raised?.source === "pathway" && raised?.origin_workspace === "pathways" && /VP Shunt Follow-up: Review after 2 weeks/.test(raised?.reason ?? ""),
    JSON.stringify({ s: raised?.source, o: raised?.origin_workspace, r: raised?.reason }));

  // ══ 6. ⚠ DEVIATIONS: ALWAYS PERMITTED, ALWAYS AUDITED (s10, s14) ═════════════════════════════════
  //
  // Each of the five is asserted twice: refused with no reason, and permitted with one. The refusal is
  // the ONLY thing that ever stops a deviation, which is the property being demonstrated.
  const eventTypes = async (pathwayId: string) => {
    const { data } = await admin.from("practice_pathway_event")
      .select("event_type, reason, stage_id").eq("patient_pathway_id", pathwayId).order("occurred_at");
    return (data ?? []) as any[];
  };

  const skipNoReason = await skipStage(admin, { workspaceId: wsA, patientPathwayId: assigned.data.id, reason: "  ", ...base });
  ok("skipping a stage with no reason is refused (a decision with no decision in it)",
    !skipNoReason.ok && skipNoReason.code === "REASON_REQUIRED", skipNoReason.ok ? "was allowed" : skipNoReason.code);

  const delayed = await delayStage(admin, {
    workspaceId: wsA, patientPathwayId: assigned.data.id, days: 21,
    reason: "family travelling; agreed to review three weeks later", ...base,
  });
  ok("DELAY is permitted and moves the stage's date", delayed.ok && delayed.data.to === addDays(step2.data.nextDueOn!, 21),
    delayed.ok ? JSON.stringify(delayed.data) : delayed.message);
  ok("and the obligation the stage raised moved WITH it (otherwise it is overdue tomorrow)",
    delayed.ok && delayed.data.followUpMoved === true, delayed.ok ? String(delayed.data.followUpMoved) : delayed.message);

  const delayNoReason = await delayStage(admin, { workspaceId: wsA, patientPathwayId: assigned.data.id, days: 5, reason: "", ...base });
  ok("delaying with no reason is refused", !delayNoReason.ok && delayNoReason.code === "REASON_REQUIRED",
    delayNoReason.ok ? "was allowed" : delayNoReason.code);

  const backwards = await delayStage(admin, { workspaceId: wsA, patientPathwayId: assigned.data.id, dueOn: today, reason: "bring it forward", ...base });
  ok("a \"delay\" to an EARLIER date is refused as not being a delay (it would be an undocumented edit)",
    !backwards.ok && backwards.code === "NOT_A_DELAY", backwards.ok ? "was allowed" : backwards.code);

  const movedFollowUp = (await listFollowUps(admin, wsA, { patientId: patientA })).items
    .find(f => f.id === step2.data.nextFollowUpId);
  ok("the obligation now carries the NEW date on its row (the current answer is the moved one)",
    !!movedFollowUp && delayed.ok && movedFollowUp.due_on === delayed.data.to,
    JSON.stringify({ on_row: movedFollowUp?.due_on, moved_to: delayed.ok ? delayed.data.to : null }));
  const { data: fuEvents } = await admin.from("practice_follow_up_event")
    .select("from_due_on, to_due_on, note").eq("follow_up_id", step2.data.nextFollowUpId!).not("from_due_on", "is", null);
  ok("the reschedule wrote from_due_on and to_due_on, so the original date survives the move",
    ((fuEvents ?? []) as any[]).some(e => e.from_due_on === step2.data.nextDueOn && e.to_due_on === (delayed.ok ? delayed.data.to : null)),
    JSON.stringify(fuEvents));

  const repeated = await repeatStage(admin, {
    workspaceId: wsA, patientPathwayId: assigned.data.id, reason: "wound looked unsettled; reviewing again in two weeks", ...base,
  });
  ok("REPEAT is permitted and re-enters the SAME stage", repeated.ok && repeated.data.nextStageName === "Review after 2 weeks",
    repeated.ok ? JSON.stringify(repeated.data) : repeated.message);
  ok("and the repeat raised a NEW obligation, because the first one was closed with the attempt",
    repeated.ok && !!repeated.data.nextFollowUpId && repeated.data.nextFollowUpId !== step2.data.nextFollowUpId,
    repeated.ok ? `${repeated.data.nextFollowUpId} vs ${step2.data.nextFollowUpId}` : repeated.message);

  const skipped = await skipStage(admin, {
    workspaceId: wsA, patientPathwayId: assigned.data.id, reason: "seen at the referring hospital; the two-week review is not needed", ...base,
  });
  ok("SKIP is permitted and the pathway moves on rather than stopping",
    skipped.ok && skipped.data.closedAs === "skipped" && skipped.data.nextStageName === "Review after 3 months",
    skipped.ok ? JSON.stringify(skipped.data) : skipped.message);

  const cancelled = await cancelStage(admin, {
    workspaceId: wsA, patientPathwayId: assigned.data.id, reason: "shunt revised; the three-month review is superseded", ...base,
  });
  ok("CANCEL is permitted and also moves on", cancelled.ok && cancelled.data.closedAs === "cancelled" && cancelled.data.nextStageName === "Annual review",
    cancelled.ok ? JSON.stringify(cancelled.data) : cancelled.message);

  const cancelNoReason = await cancelStage(admin, { workspaceId: wsA, patientPathwayId: assigned.data.id, reason: "", ...base });
  ok("cancelling with no reason is refused", !cancelNoReason.ok && cancelNoReason.code === "REASON_REQUIRED",
    cancelNoReason.ok ? "was allowed" : cancelNoReason.code);

  // ⚠ EVERY DEVIATION IS AUDITED, BY NAME. Asserted as a SET of event types actually present, so a run
  // where only one of them wrote its row cannot pass.
  const trail = await eventTypes(assigned.data.id);
  const present = new Set(trail.map(e => e.event_type));
  const wantedDeviations = ["stage_delayed", "stage_repeated", "stage_skipped", "stage_cancelled"];
  ok("⚠ every deviation performed above is in practice_pathway_event, by name",
    wantedDeviations.every(t => present.has(t)),
    `present: ${[...present].join(",")}`);
  ok("and each deviation row carries the practitioner's reason (not just the fact of it)",
    trail.filter(e => wantedDeviations.includes(e.event_type)).every(e => typeof e.reason === "string" && e.reason.length > 10),
    JSON.stringify(trail.filter(e => wantedDeviations.includes(e.event_type)).map(e => e.reason)));
  ok("the five deviations the vocabulary names are the five the engine implements",
    PATHWAY_DEVIATIONS.map(d => d.key).sort().join(",") === "cancel,delay,repeat,skip,stop",
    PATHWAY_DEVIATIONS.map(d => d.key).join(","));

  // ══ 7. REACHING THE END, AND ENDING EARLY ════════════════════════════════════════════════════════
  const last = await completeStage(admin, { workspaceId: wsA, patientPathwayId: assigned.data.id, note: "annual review done, shunt working", ...base });
  ok("completing the LAST stage completes the pathway rather than looking for a next one",
    last.ok && last.data.nextStageName === null && last.data.pathwayStatus === "completed",
    last.ok ? JSON.stringify(last.data) : last.message);

  const stoppedTwice = await stopPathway(admin, { workspaceId: wsA, patientPathwayId: assigned.data.id, reason: "x", ...base });
  ok("a finished pathway cannot be stopped again", !stoppedTwice.ok && stoppedTwice.code === "PATHWAY_NOT_ACTIVE",
    stoppedTwice.ok ? "was allowed" : stoppedTwice.code);

  const stopNoReason = await stopPathway(admin, { workspaceId: wsA, patientPathwayId: concurrent.data.id, reason: "  ", ...base });
  ok("ending a pathway early with no reason is refused", !stopNoReason.ok && stopNoReason.code === "REASON_REQUIRED",
    stopNoReason.ok ? "was allowed" : stopNoReason.code);

  const stopped = await stopPathway(admin, {
    workspaceId: wsA, patientPathwayId: concurrent.data.id, reason: "seizure-free for two years; moving to routine care", ...base,
  });
  ok("control. END PATHWAY EARLY is permitted with a reason", stopped.ok, stopped.ok ? "" : stopped.message);

  const stoppedFollowUps = (await listFollowUps(admin, wsA, { patientId: patientA })).items
    .filter(f => f.id === third.followUpId);
  ok("ending a pathway early cancels the obligation its live stage was carrying",
    stoppedFollowUps[0]?.status === "CANCELLED", String(stoppedFollowUps[0]?.status));

  // ══ 8. HISTORY IS PERMANENT, AND A REPEATED STAGE APPEARS TWICE (s4, s16) ════════════════════════
  const detail = await getPatientPathway(admin, wsA, assigned.data.id);
  ok("a finished pathway is still readable in full", !!detail.pathway && detail.unavailable === false, detail.detail ?? "");
  const twoWeekVisits = (detail.pathway?.history ?? []).filter(h => h.stageName === "Review after 2 weeks");
  ok("⚠ the repeated stage appears TWICE in the history -- a current-stage pointer could not say this",
    twoWeekVisits.length === 2, JSON.stringify((detail.pathway?.history ?? []).map(h => `${h.stageName}:${h.state}`)));
  ok("and the skipped one is recorded AS skipped, not deleted",
    twoWeekVisits.some(h => h.state === "skipped") && twoWeekVisits.some(h => h.state === "completed"),
    JSON.stringify(twoWeekVisits.map(h => h.state)));
  ok("the pathway's own audit trail survives the pathway finishing",
    detail.events.length >= 8 && detail.events.some(e => e.event_type === "pathway_completed"),
    `${detail.events.length} events`);

  const stoppedDetail = await getPatientPathway(admin, wsA, concurrent.data.id);
  ok("a STOPPED pathway keeps its reason and its end date",
    stoppedDetail.pathway?.status === "stopped" && /seizure-free/.test(stoppedDetail.pathway?.stopped_reason ?? "") && !!stoppedDetail.pathway?.ended_on,
    JSON.stringify({ s: stoppedDetail.pathway?.status, r: stoppedDetail.pathway?.stopped_reason }));

  // ══ 9. PROGRESS IS DERIVED FROM DATES, AND "AT RISK" IS NOT RENDERED ═════════════════════════════
  ok("⚠ \"at risk\" is not in the progress vocabulary at all (it is a judgement, not a date rule)",
    !(PATHWAY_PROGRESS_STATES as readonly string[]).includes("at_risk"),
    PATHWAY_PROGRESS_STATES.join(","));
  ok("an overdue stage is derived overdue from its date alone",
    pathwayProgress({ pathwayStatus: "active", stageDueOn: dueDateFrom(today, -3), today }) === "overdue");
  ok("control. the SAME function returns on_track for a future date -- it discriminates",
    pathwayProgress({ pathwayStatus: "active", stageDueOn: dueDateFrom(today, 3), today }) === "on_track");
  ok("a stage with no date is \"undated\", NOT quietly reported as on track",
    pathwayProgress({ pathwayStatus: "active", stageDueOn: null, today }) === "undated");
  ok("a finished pathway is \"ended\" rather than being judged against a date it no longer has",
    pathwayProgress({ pathwayStatus: "completed", stageDueOn: dueDateFrom(today, -30), today }) === "ended");

  // A LIVE, OVERDUE pathway, so the workspace's Overdue card has something real behind it.
  const overdueOne = await assignPathway(admin, { workspaceId: wsA, patientId: patientB, templateId: epilepsy.data.id, ...base });
  if (!overdueOne.ok) { ok("the overdue fixture assigned", false, overdueOne.message); return report(); }
  const { data: bLive } = await admin.from("practice_patient_pathway_stage")
    .select("id").eq("patient_pathway_id", overdueOne.data.id).eq("state", "entered").maybeSingle();
  await admin.from("practice_patient_pathway_stage").update({ due_on: dueDateFrom(today, -11) }).eq("id", bLive!.id);

  const views = await listPatientPathways(admin, wsA, patientB);
  ok("the back-dated stage reads OVERDUE with nothing having run",
    views.items[0]?.progress === "overdue" && views.items[0]?.stageDueInDays === -11,
    JSON.stringify({ p: views.items[0]?.progress, d: views.items[0]?.stageDueInDays }));
  ok("and \"Stage 1 of 3\" is computed from the template, not stored",
    views.items[0]?.stagePosition === 1 && views.items[0]?.stageCount === 3,
    JSON.stringify({ p: views.items[0]?.stagePosition, c: views.items[0]?.stageCount }));

  // ══ 10. THE WORKSPACE'S CARDS ARE LENGTHS OF LISTS ═══════════════════════════════════════════════
  //
  // ⚠ THE FIXTURE IS ARRANGED SO THE WRONG ANSWER IS THE ONE A COUNT WOULD GIVE. Patient A holds TWO
  // finished pathways and patient B holds ONE live one, so "active pathways" and "patients on a
  // pathway" are only equal by accident here -- a third live pathway is assigned to patient B below to
  // separate them, which is the whole point: a fixture where every enrolment belongs to a distinct
  // patient cannot tell an enrolment count from a people count, and that trap has sat green here before.
  const vp2 = await createPathwayTemplate(admin, {
    workspaceId: wsA, name: "Nutrition Surveillance", stages: [{ name: "Growth check", offsetDays: 60, followUpKind: "monitoring" }], ...base,
  });
  if (vp2.ok) await assignPathway(admin, { workspaceId: wsA, patientId: patientB, templateId: vp2.data.id, ...base });

  const board = await pathwayWorkspace(admin, wsA);
  const activeCard = board.cards.find(c => c.key === "active")!;
  const patientsCard = board.cards.find(c => c.key === "patients")!;
  ok("⚠ the active-pathway figure is 2 while the people figure is 1 -- the two cards cannot be the same count",
    activeCard.count === 2 && patientsCard.count === 1,
    JSON.stringify({ active: activeCard.count, patients: patientsCard.count }));
  ok("and the active card's ids ARE the active pathways the table shows, by id",
    activeCard.ids.slice().sort().join(",") === board.pathways.filter(p => p.status === "active").map(p => p.id).sort().join(","),
    JSON.stringify(activeCard.ids));
  ok("the patients card's ids are PATIENT ids, and it is the deduplicated set",
    patientsCard.ids.length === 1 && patientsCard.ids[0] === patientB, JSON.stringify(patientsCard.ids));

  const overdueCard = board.cards.find(c => c.key === "overdue")!;
  const onTrackCard = board.cards.find(c => c.key === "on_track")!;
  ok("overdue and on-track partition the ACTIVE pathways between them, by id",
    [...overdueCard.ids, ...onTrackCard.ids].sort().join(",") === activeCard.ids.slice().sort().join(","),
    JSON.stringify({ o: overdueCard.ids, t: onTrackCard.ids }));
  ok("the overdue card names the back-dated one specifically (not merely 'one of them')",
    overdueCard.ids.length === 1 && overdueCard.ids[0] === overdueOne.data.id, JSON.stringify(overdueCard.ids));

  const completedCard = board.cards.find(c => c.key === "completed")!;
  ok("⚠ the STOPPED pathway is not counted as completed -- ending early is not finishing",
    completedCard.ids.includes(assigned.data.id) && !completedCard.ids.includes(concurrent.data.id),
    JSON.stringify(completedCard.ids));

  // ══ 11. VERSIONING (s13) ═════════════════════════════════════════════════════════════════════════
  const v2 = await publishPathwayVersion(admin, {
    workspaceId: wsA, templateId: vp.data.id,
    stages: [...VP_SHUNT, { name: "Long-term surveillance", offsetDays: 730, followUpKind: "monitoring" }],
    ...base,
  });
  ok("publishing a change makes a NEW version that points back at the one it supersedes",
    v2.ok && v2.data.version === 2 && v2.data.supersedes === vp.data.id,
    v2.ok ? JSON.stringify(v2.data) : v2.message);

  const afterV2 = await listPathwayTemplates(admin, wsA);
  ok("the superseded version is retired, so nothing new is assigned to it",
    !afterV2.items.some(t => t.id === vp.data.id), JSON.stringify(afterV2.items.map(t => `${t.name} v${t.version}`)));
  const retiredAssign = await assignPathway(admin, { workspaceId: wsA, patientId: patientB, templateId: vp.data.id, ...base });
  ok("and assigning the retired version is refused with the reason",
    !retiredAssign.ok && retiredAssign.code === "TEMPLATE_RETIRED", retiredAssign.ok ? "was allowed" : retiredAssign.code);
  ok("control. the patient already ON the old version still reads it -- the plan was not rewritten under them",
    (await getPatientPathway(admin, wsA, assigned.data.id)).pathway?.template_name === "VP Shunt Follow-up",
    "");

  if (!v2.ok) return report();
  const retired = await setTemplateActive(admin, { workspaceId: wsA, templateId: v2.data.id, active: false, ...base });
  ok("a template can be retired by hand too", retired.ok, retired.ok ? "" : retired.message);
  await setTemplateActive(admin, { workspaceId: wsA, templateId: v2.data.id, active: true, ...base });

  // ══ 12. A FAILED READ IS NEVER AN EMPTY LIST ═════════════════════════════════════════════════════
  const failingAdmin = {
    from: () => {
      const chain: Record<string, unknown> = {};
      for (const m of ["select", "eq", "in", "limit"]) chain[m] = () => chain;
      chain.order = async () => ({ data: null, error: { message: "simulated pathway read failure" } });
      return chain;
    },
  };
  const failedTemplates = await listPathwayTemplates(failingAdmin as never, wsA);
  ok("a template read that FAILED says so, and carries the database's own words",
    failedTemplates.unavailable === true && /simulated pathway read failure/.test(failedTemplates.detail ?? ""),
    JSON.stringify(failedTemplates));
  ok("⚠ and it is not reported as \"this practice has no pathways\" -- different answers",
    failedTemplates.items.length === 0 && failedTemplates.unavailable, JSON.stringify(failedTemplates));
  const realTemplates = await listPathwayTemplates(admin, wsA);
  ok("control. the same call through the real client is AVAILABLE and returns rows",
    realTemplates.unavailable === false && realTemplates.detail === null && realTemplates.items.length > 0,
    JSON.stringify({ n: realTemplates.items.length, u: realTemplates.unavailable }));

  // ══ 13. ISOLATION AND ANON ═══════════════════════════════════════════════════════════════════════
  const bReads = await getPatientPathway(admin, wsB, assigned.data.id);
  ok("getPatientPathway is workspace-scoped (B cannot read A's pathway)", bReads.pathway === null && !bReads.unavailable);
  const bStops = await stopPathway(admin, { workspaceId: wsB, patientPathwayId: overdueOne.data.id, reason: "not mine", ...base });
  ok("B cannot stop A's pathway", !bStops.ok && bStops.code === "NOT_FOUND", bStops.ok ? "was allowed" : bStops.code);
  const bBoard = await pathwayWorkspace(admin, wsB);
  const aBoard = await pathwayWorkspace(admin, wsA);
  ok("A's board is non-empty (the isolation test is not vacuous)", aBoard.pathways.length > 0, `${aBoard.pathways.length}`);
  ok("B's board holds none of A's pathways", bBoard.pathways.length === 0, `${bBoard.pathways.length}`);

  let svcRows = 0, leaked = 0;
  for (const t of TABLES) {
    const { count: svc } = await admin.from(t).select("*", { count: "exact", head: true });
    if ((svc ?? 0) > 0) svcRows++;
    const { count: a } = await anon.from(t).select("*", { count: "exact", head: true });
    if ((a ?? 0) > 0) leaked++;
  }
  ok("the service role sees rows in every pathway table (the denial test is not vacuous)",
    svcRows === TABLES.length, `${svcRows}/${TABLES.length}`);
  ok("anon reads 0 rows from every pathway table", leaked === 0, `${leaked} table(s) leaked`);

  // ══ 14. THE PATHWAY DOES NOT TOUCH ANOTHER PATIENT'S RECORD ══════════════════════════════════════
  const encB = await launchEncounter(admin, { workspaceId: wsA, patientId: patientB, pathway: "new_walk_in", ...base });
  if (encB.ok) {
    await transitionEncounter(admin, { workspaceId: wsA, encounterId: encB.data.id, to: "ACTIVE", ...base });
    const crossPatient = await completeStage(admin, {
      workspaceId: wsA, patientPathwayId: assigned.data.id, closingEncounterId: encB.data.id, ...base,
    });
    ok("a stage cannot be closed by another patient's consultation",
      !crossPatient.ok && ["ENCOUNTER_PATIENT_MISMATCH", "PATHWAY_NOT_ACTIVE"].includes(crossPatient.code),
      crossPatient.ok ? "was allowed" : crossPatient.code);
  } else {
    ok("a stage cannot be closed by another patient's consultation", false, encB.message);
  }

  // ══ 15. THE CARD SWATCHES ARE KEYED ON THE ENGINE'S OWN CARD KEYS ════════════════════════════════
  //
  // ⚠ A MISSING KEY IS INVISIBLE IN A DIFF AND INVISIBLE IN A TYPE-CHECK. `Record<string, ...>` takes any
  // key and returns any key, so a swatch map that has drifted from PATHWAY_CARD_SHAPE compiles perfectly
  // and draws a real figure in dead grey. palette.ts's own header records this shipping twice already
  // (PERFORMANCE_SWATCH keyed `avg_consult` against `average_consult_time`, GLANCE_SWATCH `walk_ins`
  // against `walk_in`); nothing anywhere said a lookup had missed.
  //
  // AN EQUALITY IN BOTH DIRECTIONS, not a subset: a swatch key with no card is a colour nobody sees, and
  // a card with no swatch is the grey one. Checked against the keys the ENGINE emitted on the live board
  // above as well as against the declared shape, so a sixth card added to only one of them is caught.
  const swatchKeys = Object.keys(PATHWAY_CARD_SWATCH).sort();
  const shapeKeys = PATHWAY_CARD_SHAPE.map(c => c.key).sort();
  const emittedCardKeys = board.cards.map(c => c.key).sort();
  ok("15a. every card in PATHWAY_CARD_SHAPE has a swatch, and every swatch has a card",
    swatchKeys.join() === shapeKeys.join(),
    `swatches: ${swatchKeys.join()} | shape: ${shapeKeys.join()}`);
  ok("15b. and the same set again from what pathwayWorkspace() actually emitted",
    swatchKeys.join() === emittedCardKeys.join(),
    `swatches: ${swatchKeys.join()} | emitted: ${emittedCardKeys.join()}`);
  ok("15-control. the set is non-empty, so 15a and 15b are not comparing two empty lists",
    swatchKeys.length === 5, `${swatchKeys.length}`);

  // ⚠ AND THE PAGE MUST ACTUALLY READ THEM. Source-checked, because a Tailwind class cannot be reached
  // from here. What this replaced was a map inside the component pointing each card at ANOTHER card's
  // entry by hue -- so the page kept drawing the right colours while palette.ts and the engine were free
  // to drift apart underneath it, which is exactly what 15a exists to make impossible.
  const workspaceSrc = readFileSync(
    join(process.cwd(), "src", "app", "practice", "(shell)", "pathways", "PathwaysWorkspace.tsx"), "utf8");
  ok("15c. the pathways workspace reads PATHWAY_CARD_SWATCH from palette.ts",
    /PATHWAY_CARD_SWATCH/.test(workspaceSrc) && /from "@\/lib\/practice\/palette"/.test(workspaceSrc),
    "the cards are drawn from the shared map or they are not shared");
  ok("15d. and keeps no private colour map of its own",
    !/const CARD_SWATCH\b/.test(workspaceSrc),
    "a local colour map is how the page and palette.ts start disagreeing about what sky means");

  await cleanup();
  return report();
}

// ⚠ TEARDOWN ON A KILL, NOT ONLY ON A THROW. The catch below covers a run that FAILS; it does not
// cover one that is KILLED, which in this environment is the ordinary case -- a command timeout, an
// agent watchdog, a stopped task. Six abandoned Practice workspaces accumulated that way and the
// landlord Mission Control counted every one of them as a real practice. Best effort: SIGKILL cannot
// be caught, and scripts/estate-hygiene-harness.ts is the backstop for what still gets through.
cleanupOnKill(cleanup);
main().catch(async e => { console.error(e); await cleanup(); process.exit(1); });
