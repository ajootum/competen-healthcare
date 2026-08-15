/**
 * CPR-HFE-001 v1.1 harness -- the harmonised shell (s14 orders 5-11), and its REFREEZE.
 *
 * WHAT IT PROVES:
 *   1. s7.2: the live queue LEFT the Planner -- no queue transition controls in the calendar console,
 *      a pointer that routes to Current Session instead, and the planning architecture untouched.
 *   2. s4: the Command Centre is pointers, not consoles -- the detailed queue, session timeline,
 *      encounter launcher, patient insights, recent documents, weekly locations and the performance
 *      grid are GONE from the page source; empty Tasks/Messages cards render only as exceptions.
 *   3. s5: Current Session's no-active-session state exists, session-scoped zones render only when a
 *      session does, and "How this session ran" left the live state.
 *   4. s6/s12: ending a session ROUTES to Session Complete; the page renders sessionSummary (the
 *      engine unrendered since CPR-V5-004) and both primary actions.
 *   5. s8: the two report types exist on the governed engine -- a Session Report about a REAL ended
 *      session carries its window's clinical counts; without a session it refuses BY NAME; the Daily
 *      Practice Report aggregates the caller's own day.
 *   6. REFREEZE: these source pins ARE the freeze -- the next change to this shell arrives holding a
 *      document, or this file goes red.
 *
 *   npx --yes tsx scripts/practice-hfe-harness.ts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { runProvisioning, type IndividualRequest } from "../src/lib/practice/provisioning";
import { registerPatient } from "../src/lib/practice/patients";
import { launchEncounter, transitionEncounter } from "../src/lib/practice/encounters";
import { createFollowUp } from "../src/lib/practice/follow-ups";
import { resolveWorkspaceContext } from "../src/lib/practice/access";
import { planActivity, startActivity, endActivity, sessionSummary, sessionClinicalActivity } from "../src/lib/practice/activity";
import { generateReport } from "../src/lib/practice/report-engine";
import { reportTemplateById } from "../src/lib/practice/report-templates";
import { purgeWorkspacesOwnedBy } from "./_cleanup";

loadEnvConfig(process.cwd());

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("Supabase env not set"); process.exit(1); }
const admin = createClient(url, key, { auth: { persistSession: false } });

const OWNER = "00000000-0000-4000-8000-0000000a8f14";

let pass = 0;
const fails: string[] = [];
const ok = (label: string, cond: boolean, detail = "") => {
  if (cond) { pass++; console.log(`  PASS  ${label}`); }
  else { fails.push(label); console.log(`  FAIL  ${label}${detail ? ` -- ${detail}` : ""}`); }
};

async function cleanup() { await purgeWorkspacesOwnedBy(admin, [OWNER]); }

/* eslint-disable @typescript-eslint/no-explicit-any */

const src = (rel: string) => readFileSync(join(process.cwd(), ...rel.split("/")), "utf8");

async function main() {
  console.log("\nCPR-HFE-001 v1.1 shell harness\n");
  await cleanup();

  // ── 1. s7.2: the Planner boundary ──────────────────────────────────────────
  const cal = src("src/app/practice/(shell)/calendar/CalendarConsole.tsx");
  ok("1-1. ⚠ no live queue controls in the Planner: queueMove and its buttons are gone",
    !cal.includes("queueMove(") && !cal.includes('"Left"') && !cal.includes("Consultation started."));
  ok("1-2. the Planner keeps a COUNT that routes to Current Session, never a queue console",
    cal.includes("Manage in Current Session") && cal.includes('href="/practice/today"'));
  ok("1-3. check-in stays: marking an arrival is appointment-book work",
    cal.includes('"arrive"') && cal.includes("Check in"));
  ok("1-4. the stale UTC label is gone -- times say what they are",
    !cal.includes("times shown in UTC") && cal.includes("practice&apos;s timezone"));

  // ── 2. s4: the Command Centre is pointers ──────────────────────────────────
  const home = src("src/app/practice/(shell)/home/page.tsx");
  ok("2-1. ⚠ the detailed queue, session timeline and session status LEFT the page",
    !home.includes("Run your clinic") && !home.includes("Session timeline")
      && !home.includes("Session status") && home.includes("Live clinic"));
  ok("2-2. the waiting pointer routes to Current Session (s12), not to a second queue",
    home.includes('href="/practice/today"') && !home.includes("QUEUE_SWATCH"));
  ok("2-3. patient insights, recent documents, recent patients, weekly locations and the performance"
    + " grid are gone -- each has a canonical home",
    !home.includes("Patient insights") && !home.includes("Recent documents")
      && !home.includes("Recent patients") && !home.includes("My locations this week")
      && !home.includes('title="Practice performance'));
  ok("2-4. s4.2: Tasks and Messages render only as ACTIONABLE EXCEPTIONS",
    home.includes('home.attention.find((a: any) => a.kind === "task_due") && (')
      && !home.includes("Nothing due from you today.") && !home.includes("Nothing new.</p>"));
  ok("2-5. the planner handoff exists and says the pointer rule out loud",
    home.includes("Open Planner") && home.includes("one canonical home per information"));

  // ── 3. s5: Current Session's two states ────────────────────────────────────
  const today = src("src/app/practice/(shell)/today/page.tsx");
  ok("3-1. ⚠ the no-active-session state exists and session zones render ONLY with a session",
    today.includes("No active session") && today.includes("{session && (<>"));
  ok("3-2. s5.2: the next planned activity shows with the two routes onward",
    today.includes("Next planned") && today.includes("Start from the Command Centre"));
  ok("3-3. s5.3: the live performance summary is gone from Current Session",
    !today.includes("<SessionPerformance") && today.includes("belong to Session Complete"));

  // ── 4. s6: Session Complete ────────────────────────────────────────────────
  const complete = src("src/app/practice/(shell)/today/complete/page.tsx");
  const controls = src("src/app/practice/(shell)/today/SessionControls.tsx");
  const startDay = src("src/app/practice/(shell)/home/StartYourDay.tsx");
  ok("4-1. ⚠ ending a session ROUTES to Session Complete from BOTH end controls",
    controls.includes("/practice/today/complete?activity=") && startDay.includes("/practice/today/complete?activity="));
  ok("4-2. the page renders sessionSummary and both s6 primary actions",
    complete.includes("sessionSummary(") && complete.includes("Return to Today")
      && complete.includes("View Session Report"));
  ok("4-3. s6 metric safety language is on the page",
    complete.includes("never as a number") || complete.includes("arrives as a reason"));

  // ── 5. s8: the two report types, live ──────────────────────────────────────
  ok("5-1. both templates registered as report types within Reports (s3: never sidebar items)",
    !!reportTemplateById("session_report") && !!reportTemplateById("daily_practice_report"));

  const { data: req } = await admin.from("provisioning_request").insert({
    idempotency_key: `harness-hfe-${Date.now()}`, request_type: "pilot",
    actor_user_id: OWNER, target_user_id: OWNER, payload_hash: "harness", correlation_id: "harness-hfe",
  }).select("id").single();
  const payload: IndividualRequest = {
    displayName: "HARNESS HFE (synthetic)", countryCode: "UG", timezone: "Africa/Kampala",
    professionCode: "medical_doctor", defaultPracticeType: "clinic", locale: "en-UG",
    termsVersion: "t1", privacyNoticeVersion: "p1", source: "pilot",
  };
  const run = await runProvisioning(admin, { id: req!.id, target_user_id: OWNER, correlation_id: "harness-hfe", workspace_id: null }, payload);
  if (!run.ok || !run.workspaceId) { ok("fixture provisions", false, String(run.errorCode)); return report(); }
  const ws = run.workspaceId;
  const ctxRes = await resolveWorkspaceContext(admin, OWNER, ws);
  if (!ctxRes.ok) { ok("context resolves", false); return report(); }
  const ctx = ctxRes.ctx;
  const base = { actorId: OWNER, correlationId: "harness-hfe" };
  const todayDate = new Date().toISOString().slice(0, 10);

  // A real session: planned, started, one encounter + follow-up inside it, ended.
  const planned = await planActivity(admin, ctx, {
    activityType: "outpatient_clinic", title: "HFE harness clinic", planDate: todayDate,
    plannedStartMinute: 8 * 60, plannedEndMinute: 12 * 60,
  });
  if (!planned.ok) { ok("activity plans", false, (planned as any).message); return report(); }
  const started = await startActivity(admin, ctx, planned.value.id);
  if (!started.ok) { ok("activity starts", false, (started as any).message); return report(); }

  const p1 = await registerPatient(admin, { workspaceId: ws, displayName: "Session Patient", sex: "female", birthDate: "1985-01-01", phone: "0772 000 041", ...base });
  if (!p1.ok) { ok("patient registers", false); return report(); }
  const e1 = await launchEncounter(admin, { workspaceId: ws, patientId: p1.data.id, pathway: "new_walk_in", ...base });
  if (!e1.ok) { ok("encounter launches", false); return report(); }
  const fu = await createFollowUp(admin, { workspaceId: ws, patientId: p1.data.id, reason: "post-session review", dueOn: todayDate, ...base });
  if (!fu.ok) { ok("follow-up creates", false); return report(); }
  for (const to of ["ACTIVE", "COMPLETED"]) {
    const t = await transitionEncounter(admin, { workspaceId: ws, encounterId: e1.data.id, to, ...base });
    if (!t.ok) { ok(`encounter reaches ${to}`, false, (t as any).message); return report(); }
  }
  const ended = await endActivity(admin, ctx, planned.value.id);
  if (!ended.ok) { ok("activity ends", false, (ended as any).message); return report(); }

  const sum = await sessionSummary(admin, ctx, planned.value.id);
  const clin = await sessionClinicalActivity(admin, ctx, planned.value.id);
  ok("5-2. the once-unrendered sessionSummary computes for the ended session",
    sum.ok && sum.value.endedAtIso !== null && sum.value.state === "done",
    JSON.stringify(sum.ok ? { state: sum.value.state } : sum));
  ok("5-3. the window counts see the session's own work: 1 encounter, 1 follow-up, 1 unsigned",
    clin.available && clin.data!.encountersStarted === 1 && clin.data!.followUpsCreated === 1
      && clin.data!.encountersUnsigned === 1 && clin.data!.followUpsNeedingBooking === 1,
    JSON.stringify(clin.available ? clin.data : clin));

  const sr = await generateReport(admin, ctx, { templateId: "session_report", activityId: planned.value.id, fromDay: todayDate, toDay: todayDate, ...base });
  ok("5-4. ⚠ the Session Report is the same governed figures: window counts row for row, patient appendix under patient.view",
    sr.ok && JSON.stringify(sr.data.sections[2].rows).includes('["Follow-ups created",1]')
      && sr.data.sections.some(s => s.title === "Patient appendix" && s.rows.some(r => r[0] === "Session Patient")),
    JSON.stringify(sr.ok ? sr.data.sections.map(s => s.title) : sr));
  const srNoActivity = await generateReport(admin, ctx, { templateId: "session_report", fromDay: todayDate, toDay: todayDate, ...base });
  ok("5-5. without a session the Session Report refuses BY NAME, never generates empty",
    !srNoActivity.ok && srNoActivity.code === "SESSION_REQUIRED");
  const dr = await generateReport(admin, ctx, { templateId: "daily_practice_report", fromDay: todayDate, toDay: todayDate, ...base });
  ok("5-6. the Daily Practice Report lists the day's sessions and the caller's own numbers",
    dr.ok && JSON.stringify(dr.data.sections[0].rows).includes("HFE harness clinic")
      && JSON.stringify(dr.data.sections[0].rows).includes("completed")
      && JSON.stringify(dr.data.sections[1].rows).includes('["Consultations you created",1]'),
    JSON.stringify(dr.ok ? dr.data.sections[0] : dr));

  return report();
}

function report() {
  console.log(`\n${fails.length === 0 ? "PASSED" : "FAILED"}  ${pass} passed, ${fails.length} failed`);
  if (fails.length) { for (const f of fails) console.log(`  - ${f}`); process.exitCode = 1; }
}

main()
  .then(cleanup)
  .catch(async e => { console.error(e); await cleanup(); process.exitCode = 1; });
