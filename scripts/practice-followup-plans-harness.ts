/**
 * Practice follow-up PLANS harness -- CPR-140's structural half, exercised against the live database
 * through the same engine the pages use. Migration 206.
 *
 * WHAT IT PROVES:
 *   1. A PLAN IS A GROUPING, NOT A NEW KIND OF OBLIGATION. Every step is an ordinary follow-up: it
 *      appears on the board, it can be booked, its booking dies the same way, and closing it still
 *      requires saying what happened. Asserted through the ORIGINAL engine, not the plan one.
 *   2. OFFSETS RUN FROM THE PLAN'S START, NEVER FROM THE PREVIOUS STEP -- so rescheduling one step does
 *      not drag every later date with it.
 *   3. THE PLAN DOES NOT CASCADE ITS STEPS AWAY. Deleting the plan leaves four clinical commitments
 *      standing rather than silently discharging them.
 *   4. DISCONTINUING A PLAN CANCELS ITS OPEN STEPS WITH THE REASON ON EACH, and leaves closed ones
 *      exactly as they were -- what already happened is not rewritten by a later decision.
 *   5. A PLAN COMPLETES ITSELF WHEN ITS LAST STEP CLOSES, at the moment it becomes true rather than in a
 *      nightly sweep nothing would run.
 *   6. THE OUTCOME TAXONOMY IS FIXED, THE WORDS ARE STILL REQUIRED, and a code on a non-completed
 *      follow-up is refused.
 *   7. ADHERENCE IS A COUNT AND ITS DENOMINATOR. No percentage anywhere in the patient view, and the
 *      denominator excludes follow-ups that have not happened yet.
 *   8. THE RECALL QUEUE IS DERIVED AND GROUPED BY PATIENT, ordered by what it costs to leave, excluding
 *      archived patients -- and it says plainly that nothing was sent.
 *   9. A RETIRED TEMPLATE CANNOT START A NEW PLAN, and retiring one does not touch the plans already
 *      made from it.
 *  10. Two steps on the same day are refused; cross-workspace isolation holds, non-vacuously.
 *
 *   npx --yes tsx scripts/practice-followup-plans-harness.ts
 */
import { readFileSync } from "node:fs";
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { runProvisioning, type IndividualRequest } from "../src/lib/practice/provisioning";
import { registerPatient } from "../src/lib/practice/patients";
import { bookAppointment } from "../src/lib/practice/scheduling";
import { createFollowUp, closeFollowUp, scheduleFollowUp, followUpBoard, listFollowUps } from "../src/lib/practice/follow-ups";
import { practiceToday, dueDateFrom } from "../src/lib/practice/practice-time";
import { purgeWorkspacesOwnedBy } from "./_cleanup";
import {
  createPlan, discontinuePlan, createPlanTemplate, listPlanTemplates, setTemplateActive,
  patientFollowUps, recallQueue, outcomeSummary,
} from "../src/lib/practice/follow-up-plans";

loadEnvConfig(process.cwd());

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("Supabase env not set"); process.exit(1); }
const admin = createClient(url, key, { auth: { persistSession: false } });

const OWNER = "00000000-0000-4000-8000-0000000e21d1";
const OTHER = "00000000-0000-4000-8000-0000000e21d2";

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
    idempotency_key: `harness-fup-${suffix}`, request_type: "pilot",
    actor_user_id: user, target_user_id: user, payload_hash: "harness", correlation_id: "harness-fup",
  }).select("id").single();
  const run = await runProvisioning(admin, { id: req!.id, target_user_id: user, correlation_id: "harness-fup", workspace_id: null }, payload(name));
  if (!run.ok || !run.workspaceId) throw new Error(`provisioning failed: ${run.errorCode}${run.detail ? " -- " + run.detail : ""}`);
  return run.workspaceId;
}

async function cleanup() {
  await purgeWorkspacesOwnedBy(admin, [OWNER, OTHER]);
}

const base = { actorId: OWNER, correlationId: "harness-fup" };

/* eslint-disable @typescript-eslint/no-explicit-any */

async function main() {
  console.log("\nPractice follow-up plans harness (CPR-140, migration 206)\n");
  await cleanup();

  const wsA = await provision(OWNER, "HARNESS Plans A (synthetic)", "a");
  const wsB = await provision(OTHER, "HARNESS Plans B (synthetic)", "b");
  const today = practiceToday("Africa/Kampala");

  const p1 = await registerPatient(admin, {
    workspaceId: wsA, displayName: "Nabirye Sarah", sex: "female", birthDate: "1986-03-14",
    phone: "0772 555 300", ...base,
  });
  const p2 = await registerPatient(admin, {
    workspaceId: wsA, displayName: "Wasswa Ronald", sex: "male", birthDate: "1974-08-02",
    phone: "0772 555 301", confirmNew: true, ...base,
  });
  if (!p1.ok || !p2.ok) { ok("patients register", false, [p1, p2].map(r => r.ok ? "ok" : r.message).join("; ")); return report(); }

  // ── 9 and 10. Templates ──────────────────────────────────────────────────
  const clash = await createPlanTemplate(admin, {
    workspaceId: wsA, code: "post_op", title: "Post-operative review",
    steps: [{ offsetDays: 14, reason: "Wound check" }, { offsetDays: 14, reason: "Also wound check" }], ...base,
  });
  ok("TWO STEPS ON THE SAME DAY are refused -- far more often a mistyped offset than an intention",
    !clash.ok && /same day/.test(clash.ok ? "" : clash.message), clash.ok ? "created" : clash.message);

  const empty = await createPlanTemplate(admin, { workspaceId: wsA, code: "empty", title: "Nothing", steps: [], ...base });
  ok("a template with no steps is refused (it would create nothing)", !empty.ok);

  const tpl = await createPlanTemplate(admin, {
    workspaceId: wsA, code: "post_op", title: "Post-operative review",
    description: "Wound, function, discharge",
    steps: [
      { offsetDays: 90, reason: "Three-month review", kind: "review" },
      { offsetDays: 14, reason: "Wound check", priority: "soon" },
      { offsetDays: 42, reason: "Function and progress" },
    ],
    ...base,
  });
  ok("CONTROL: a real template is created", tpl.ok, tpl.ok ? "" : tpl.message);
  if (!tpl.ok) return report();

  const templates = await listPlanTemplates(admin, wsA);
  ok("its steps are stored in DATE ORDER whatever order they arrived in",
    templates[0]?.steps.map((s: any) => s.offset_days).join(",") === "14,42,90",
    templates[0]?.steps.map((s: any) => s.offset_days).join(","));

  // ── 1 and 2. A plan is a grouping of ordinary follow-ups ─────────────────
  const start = dueDateFrom(today, -20);
  const plan = await createPlan(admin, {
    workspaceId: wsA, patientId: p1.data.id, templateId: tpl.data.id, startsOn: start, ...base,
  });
  ok("a plan is created from the template", plan.ok, plan.ok ? "" : plan.message);
  if (!plan.ok) return report();
  ok("with one follow-up per step", plan.data.steps.length === 3, String(plan.data.steps.length));

  ok("OFFSETS RUN FROM THE PLAN'S START, not from the previous step",
    plan.data.steps[0].dueOn === dueDateFrom(start, 14) &&
    plan.data.steps[1].dueOn === dueDateFrom(start, 42) &&
    plan.data.steps[2].dueOn === dueDateFrom(start, 90),
    plan.data.steps.map(s => s.dueOn).join(" "));

  // The load-bearing assertion: read them back through the ORIGINAL engine, which knows nothing about
  // plans. If a plan were a separate kind of object, none of this would find them.
  const board = await followUpBoard(admin, wsA, 365);
  const onBoard = [...board.overdue, ...board.dueSoon, ...board.scheduled, ...board.later]
    .filter((r: any) => r.plan_id === plan.data.id);
  ok("EVERY STEP IS AN ORDINARY FOLLOW-UP ON THE ORDINARY BOARD",
    onBoard.length === 3, String(onBoard.length));
  ok("and the first step is derived OVERDUE by the same rule as any other follow-up",
    onBoard.find((r: any) => r.step_number === 1)?.overdue === true,
    JSON.stringify(onBoard.map((r: any) => [r.step_number, r.overdue])));

  // A step books like anything else, and the booking is what the board reads.
  const appt = await bookAppointment(admin, {
    workspaceId: wsA, patientId: p1.data.id, patientName: "Nabirye Sarah",
    appointmentType: "scheduled_followup", scheduledAt: `${dueDateFrom(today, 3)}T09:00:00.000Z`,
    allowOverlap: true, ...base,
  });
  const step1 = plan.data.steps[0].id;
  const booked = appt.ok ? await scheduleFollowUp(admin, { workspaceId: wsA, followUpId: step1, appointmentId: appt.data.id, ...base }) : null;
  ok("a step takes a booking through the ordinary scheduling path", booked?.ok === true,
    booked && !booked.ok ? booked.message : "");

  // ── 6. The outcome taxonomy ──────────────────────────────────────────────
  const badCode = await closeFollowUp(admin, {
    workspaceId: wsA, followUpId: step1, to: "COMPLETED", outcome: "Seen, healing well",
    outcomeCode: "much_better", ...base,
  });
  ok("an outcome code outside the taxonomy is refused",
    !badCode.ok && badCode.code === "VALIDATION_ERROR", badCode.ok ? "closed" : badCode.code);

  const noWords = await closeFollowUp(admin, {
    workspaceId: wsA, followUpId: step1, to: "COMPLETED", outcomeCode: "improved", ...base,
  });
  ok("A CODE IS NOT A SUBSTITUTE FOR THE WORDS -- completing with a code and no sentence is still refused",
    !noWords.ok && noWords.code === "OUTCOME_REQUIRED", noWords.ok ? "closed" : noWords.code);

  const closed1 = await closeFollowUp(admin, {
    workspaceId: wsA, followUpId: step1, to: "COMPLETED",
    outcome: "Wound clean and dry, sutures out", outcomeCode: "improved", ...base,
  });
  ok("CONTROL: a code AND a sentence closes it", closed1.ok, closed1.ok ? "" : closed1.message);

  const step2 = plan.data.steps[1].id;
  const codeOnMissed = await closeFollowUp(admin, {
    workspaceId: wsA, followUpId: step2, to: "MISSED", outcome: "Did not attend, phone unreachable",
    outcomeCode: "worsened", ...base,
  });
  ok("AN OUTCOME CODE ON A NON-COMPLETED FOLLOW-UP IS REFUSED -- a missed review has no clinical outcome",
    !codeOnMissed.ok && codeOnMissed.code === "OUTCOME_CODE_NOT_APPLICABLE",
    codeOnMissed.ok ? "closed" : codeOnMissed.code);

  const missed = await closeFollowUp(admin, {
    workspaceId: wsA, followUpId: step2, to: "MISSED", outcome: "Did not attend, phone unreachable", ...base,
  });
  ok("CONTROL: marking it missed with words alone works", missed.ok, missed.ok ? "" : missed.message);

  // ── 7. Adherence, as a count and its denominator ─────────────────────────
  const view = await patientFollowUps(admin, wsA, p1.data.id);
  const serialised = JSON.stringify(view);
  ok("THE PATIENT VIEW CONTAINS NO PERCENTAGE ANYWHERE",
    !/\d+(\.\d+)?%/.test(serialised) && !/"(rate|percent|percentage|adherenceRate)"/i.test(serialised));
  ok("ADHERENCE IS A COUNT AND ITS DENOMINATOR",
    view.adherence.completed === 1 && view.adherence.concluded === 2,
    JSON.stringify(view.adherence));
  ok("THE DENOMINATOR EXCLUDES WHAT HAS NOT HAPPENED YET -- the third step is still open and not counted",
    view.adherence.stillOpen === 1, JSON.stringify(view.adherence));

  ok("the tabs are groupings of one read, and they agree",
    view.past.length === 1 && view.missed.length === 1 && view.upcoming.length === 1 &&
    view.all.length === 3, JSON.stringify({ past: view.past.length, missed: view.missed.length, upcoming: view.upcoming.length }));
  ok("the outcome tab counts the taxonomy and names how many carry no code",
    view.outcomes.rows.find(r => r.code === "improved")?.total === 1 && view.outcomes.uncoded === 0,
    JSON.stringify(view.outcomes));
  ok("the plan is shown with its steps in order",
    view.plans[0]?.steps.map((s: any) => s.step_number).join(",") === "1,2,3",
    view.plans[0]?.steps.map((s: any) => s.step_number).join(","));

  // ── 8. The recall queue ──────────────────────────────────────────────────
  const overdue = await createPlan(admin, {
    workspaceId: wsA, patientId: p2.data.id, title: "Blood pressure monitoring",
    startsOn: dueDateFrom(today, -60),
    steps: [
      { offsetDays: 0, reason: "Initial reading", kind: "monitoring" },
      { offsetDays: 30, reason: "One-month reading", kind: "monitoring", priority: "urgent" },
    ],
    ...base,
  });
  ok("an ad-hoc plan (no template) is created", overdue.ok, overdue.ok ? "" : overdue.message);

  // A STANDALONE OVERDUE FOLLOW-UP, not part of any plan. Two things at once: it gives the queue a
  // genuine second patient (all three of Sarah's plan steps are now closed or future-dated), and it
  // proves the queue is about OBLIGATIONS rather than plans -- a practice that never used a plan still
  // gets a recall list.
  const loose = await createFollowUp(admin, {
    workspaceId: wsA, patientId: p1.data.id, reason: "Repeat FBC, never returned",
    dueOn: dueDateFrom(today, -9), ...base,
  });
  ok("a standalone follow-up (no plan) is created", loose.ok, loose.ok ? "" : loose.message);

  const queue = await recallQueue(admin, wsA);
  ok("THE RECALL QUEUE IS GROUPED BY PATIENT -- the unit of work is a person to contact",
    queue.patients.length === 2, JSON.stringify(queue.patients.map(p => [p.name, p.followUps.length])));
  ok("URGENT COMES FIRST, then longest overdue -- ordered by what it costs to leave",
    queue.patients[0].name === "Wasswa Ronald" && queue.patients[0].urgent === true,
    queue.patients.map(p => `${p.name}:${p.urgent}:${p.worstOverdueDays}`).join(" "));
  ok("a patient with several overdue follow-ups is ONE entry, not three",
    queue.patients[0].followUps.length === 2, String(queue.patients[0].followUps.length));

  // An archived patient is not somebody to recall.
  await admin.from("practice_patient").update({ status: "archived" }).eq("id", p2.data.id);
  const afterArchive = await recallQueue(admin, wsA);
  ok("an archived patient drops out of the recall queue",
    !afterArchive.patients.some(p => p.name === "Wasswa Ronald"),
    afterArchive.patients.map(p => p.name).join(","));
  ok("CONTROL: the active patient is still queued (the filter is not a blanket)",
    afterArchive.patients.some(p => p.name === "Nabirye Sarah"),
    afterArchive.patients.map(p => p.name).join(","));
  await admin.from("practice_patient").update({ status: "active" }).eq("id", p2.data.id);

  // ── 5. A plan completes itself when its last step closes ─────────────────
  const step3 = plan.data.steps[2].id;
  await closeFollowUp(admin, {
    workspaceId: wsA, followUpId: step3, to: "COMPLETED", outcome: "Discharged", outcomeCode: "improved", ...base,
  });
  const { data: reconciled } = await admin.from("practice_follow_up_plan")
    .select("status").eq("id", plan.data.id).maybeSingle();
  ok("A PLAN COMPLETES ITSELF WHEN ITS LAST STEP CLOSES, at the moment it becomes true",
    reconciled?.status === "COMPLETED", String(reconciled?.status));

  // ── 4. Discontinuing ─────────────────────────────────────────────────────
  if (!overdue.ok) return report();
  const noReason = await discontinuePlan(admin, { workspaceId: wsA, planId: overdue.data.id, reason: "  ", ...base });
  ok("stopping a plan without saying why is refused", !noReason.ok && noReason.code === "REASON_REQUIRED");

  // Close one step first, so the assertion below can tell "cancelled the open ones" from "cancelled
  // everything".
  await closeFollowUp(admin, {
    workspaceId: wsA, followUpId: overdue.data.steps[0].id, to: "COMPLETED",
    outcome: "Reading taken, 148/92", outcomeCode: "no_change", ...base,
  });
  const stopped = await discontinuePlan(admin, {
    workspaceId: wsA, planId: overdue.data.id, reason: "Patient moved to another practice", ...base,
  });
  ok("stopping a plan cancels its OPEN steps", stopped.ok && stopped.data.cancelled === 1,
    stopped.ok ? JSON.stringify(stopped.data) : stopped.message);

  const stoppedRows = (await listFollowUps(admin, wsA, { patientId: p2.data.id })).items;
  const cancelled = stoppedRows.find((r: any) => r.status === "CANCELLED");
  ok("THE REASON IS WRITTEN ONTO EACH CANCELLED STEP, not left on the plan alone",
    /moved to another practice/.test(String(cancelled?.outcome)), String(cancelled?.outcome));
  ok("AND THE ALREADY-CLOSED STEP IS UNTOUCHED -- what happened is not rewritten by a later decision",
    stoppedRows.find((r: any) => r.status === "COMPLETED")?.outcome_code === "no_change",
    JSON.stringify(stoppedRows.map((r: any) => [r.status, r.outcome_code])));

  const twice = await discontinuePlan(admin, { workspaceId: wsA, planId: overdue.data.id, reason: "Again", ...base });
  ok("a plan cannot be discontinued twice", !twice.ok && twice.code === "NOT_ACTIVE");

  // ── 3. The plan does not cascade its steps away ──────────────────────────
  const survivor = await createPlan(admin, {
    workspaceId: wsA, patientId: p1.data.id, title: "Deletion probe",
    steps: [{ offsetDays: 7, reason: "A commitment that must survive" }], ...base,
  });
  if (!survivor.ok) { ok("probe plan created", false, survivor.message); return report(); }
  await admin.from("practice_follow_up_plan").delete().eq("id", survivor.data.id);
  const { data: orphan } = await admin.from("practice_follow_up")
    .select("id, plan_id, status").eq("id", survivor.data.steps[0].id).maybeSingle();
  ok("DELETING A PLAN LEAVES ITS FOLLOW-UPS STANDING -- tidying up must not silently discharge a commitment",
    !!orphan && orphan.plan_id === null && orphan.status === "OPEN",
    JSON.stringify(orphan));

  // ── 9. A retired template cannot start a new plan ────────────────────────
  const retired = await setTemplateActive(admin, { workspaceId: wsA, templateId: tpl.data.id, active: false, ...base });
  ok("a template can be retired", retired.ok);
  const fromRetired = await createPlan(admin, {
    workspaceId: wsA, patientId: p1.data.id, templateId: tpl.data.id, ...base,
  });
  ok("A RETIRED TEMPLATE CANNOT START A NEW PLAN",
    !fromRetired.ok && fromRetired.code === "TEMPLATE_RETIRED", fromRetired.ok ? "created" : fromRetired.code);
  const { data: stillThere } = await admin.from("practice_follow_up_plan")
    .select("id").eq("template_id", tpl.data.id);
  ok("but retiring it does NOT touch the plans already made from it",
    (stillThere ?? []).length === 1, String((stillThere ?? []).length));
  ok("and it disappears from the active list while staying visible when asked for",
    (await listPlanTemplates(admin, wsA)).length === 0 &&
    (await listPlanTemplates(admin, wsA, { includeInactive: true })).length === 1);

  // ── Outcomes across the practice ─────────────────────────────────────────
  const summary = await outcomeSummary(admin, wsA);
  ok("the practice outcome summary counts the taxonomy, with no percentage",
    summary.completed === 3 && summary.missed === 1 &&
    summary.rows.find(r => r.code === "improved")?.total === 2 &&
    !/\d+(\.\d+)?%/.test(JSON.stringify(summary)),
    JSON.stringify({ completed: summary.completed, missed: summary.missed }));

  // ── 10. Isolation ────────────────────────────────────────────────────────
  const crossPatient = await createPlan(admin, {
    workspaceId: wsB, patientId: p1.data.id, title: "Cross-tenant probe",
    steps: [{ offsetDays: 7, reason: "Should not happen" }], ...base,
  });
  ok("another workspace's patient cannot be given a plan",
    !crossPatient.ok && crossPatient.code === "NOT_FOUND", crossPatient.ok ? "created" : crossPatient.code);
  const crossTemplate = await createPlan(admin, {
    workspaceId: wsB, patientId: p1.data.id, templateId: tpl.data.id, ...base,
  });
  ok("nor with another workspace's template", !crossTemplate.ok);
  const bQueue = await recallQueue(admin, wsB);
  ok("B's recall queue holds none of A's patients", bQueue.patients.length === 0, String(bQueue.patients.length));
  ok("A's queue is non-empty (the isolation test is not vacuous)",
    (await recallQueue(admin, wsA)).patients.length > 0);

  // ══ THE AUTHORING SCREEN -- THE PIECE THAT WAS MISSING FOR THE WHOLE FEATURE ════════════════════
  //
  // ⚠ SOURCE CHECKS, because the defect was reachability, not behaviour. Everything above proves the
  // ENGINE works, and it has passed since migration 206 while no practice could ever author a template
  // -- zero UI callers, zero seeds, so the encounter's "Or apply a plan" control was invisible
  // everywhere. An engine harness is structurally blind to that; these are not.
  const studioSrc = readFileSync(
    "src/app/practice/(shell)/follow-ups/templates/TemplateStudio.tsx", "utf8");
  const boardSrc = readFileSync("src/app/practice/(shell)/follow-ups/page.tsx", "utf8");
  ok("ui-1. the authoring screen reaches createPlanTemplate through the route's template body",
    studioSrc.includes("template: {") && studioSrc.includes("follow-up-plans")
      && studioSrc.includes("templateId, active"),
    "author and retire both need a door, or the screen is half a screen");
  ok("ui-2. the BOARD links to it -- a screen nobody is told about is the built-but-unreachable class",
    boardSrc.includes("follow-ups/templates"));
  // ⚠ THE ONE SENTENCE THE WHOLE FIELD TURNS ON. Offsets count from the plan's start; read
  // cumulatively, a wound plan's six-week check lands at eight weeks.
  ok("ui-3. the offsets-from-start rule is stated where the offsets are typed",
    /from the day the plan is applied, not from the previous step/.test(studioSrc));
  ok("ui-4. the client mirrors validateSteps -- duplicates and empty steps are worn by the fields",
    /Two steps fall on the same day/.test(studioSrc) && /border-amber-300/.test(studioSrc)
      && /say what this step is for/.test(studioSrc));
  ok("ui-5. retiring says plans already running are untouched (retire must not read as clinical)",
    /Plans already running from it are untouched/.test(studioSrc));
  ok("ui-6. the screen never claims Competen supplies or recommends a plan",
    studioSrc.includes("Competen supplies no plan templates")
      && studioSrc.includes("not clinical"));

  return report();
}

function report() {
  console.log(`\n${fails.length === 0 ? "PASSED" : "FAILED"}  ${pass} passed, ${fails.length} failed`);
  if (fails.length) { for (const f of fails) console.log(`  - ${f}`); process.exitCode = 1; }
}

main()
  .then(cleanup)
  .catch(async e => { console.error(e); await cleanup(); process.exitCode = 1; });
