/**
 * CPR-001_v4 Practice Command Centre harness. Migration 229.
 *
 * WHAT IT PROVES:
 *   1. THE CLINIC WINDOW IS CONFIGURED, NOT ASSUMED. A practice that opens at 14:00 is not "running
 *      late" every day of its life, which is what a hardcoded 08:00-17:00 would have told it.
 *   2. THE ESTIMATED FINISH IS THE LAST BOOKING'S END, not a prediction. It moves when a booking moves,
 *      and it flags running past closing.
 *   3. EVERY HERO STAT IS A COUNT OF SOMETHING REAL, and a stat the caller cannot see is marked
 *      unavailable rather than reported as zero. A zero must be earned.
 *   4. THE WEEK'S LOCATIONS DISTINGUISH THREE STATES: a day at a named place, a day with bookings but
 *      no place recorded, and a day with nothing booked. Collapsing the middle one into a blank is how
 *      a practitioner ends up at the wrong hospital.
 *   5. NO AVERAGE WITHOUT ITS DENOMINATOR. Every performance figure carries the number of measurements
 *      behind it, and a figure with nothing behind it is null WITH A REASON, never a confident zero.
 *   6. THE PERFORMANCE FIGURES ARE REAL ARITHMETIC over check-in, consultation start and end -- proven
 *      against times this harness sets, not merely "a number came back".
 *   7. COHORTS ARE COUNTED AS TYPED, AND BY PATIENT. Somebody seen four times for one condition is one
 *      person, not four; and labels are never bucketed into a taxonomy nobody recorded.
 *   8. RECENT PATIENTS IS THE READER'S OWN ACCESS LOG -- and reads back only what they opened.
 *   9. NOTHING ON THIS PAGE CLAIMS TO BE AI-GENERATED.
 *  10. EVERY WIDGET THE PAGE RENDERS IS CONFIGURABLE -- a widget key with no entry in DASHBOARD_WIDGETS
 *      is one nobody can turn off.
 *  11. Cross-workspace isolation, non-vacuously.
 *
 *   npx --yes tsx scripts/practice-command-centre-harness.ts
 */
import { readFileSync } from "node:fs";
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { runProvisioning, type IndividualRequest } from "../src/lib/practice/provisioning";
import { resolveWorkspaceContext } from "../src/lib/practice/access";
import { registerPatient } from "../src/lib/practice/patients";
import { bookAppointment } from "../src/lib/practice/scheduling";
import { commandCentre } from "../src/lib/practice/command-centre";
import { practiceMetrics, metricScope, MIN_OBSERVATIONS_FOR_DELAY } from "../src/lib/practice/metrics";
import { DASHBOARD_WIDGETS } from "../src/lib/practice/preference-constants";

loadEnvConfig(process.cwd());

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("Supabase env not set"); process.exit(1); }
const admin = createClient(url, key, { auth: { persistSession: false } });

const OWNER = "00000000-0000-4000-8000-0000000dd001";
const OTHER = "00000000-0000-4000-8000-0000000dd002";
const TZ = "Africa/Kampala"; // UTC+3, no DST -- the arithmetic is checkable by hand.

let pass = 0;
const fails: string[] = [];
const ok = (label: string, cond: boolean, detail = "") => {
  if (cond) { pass++; console.log(`  PASS  ${label}`); }
  else { fails.push(label); console.log(`  FAIL  ${label}${detail ? ` -- ${detail}` : ""}`); }
};

const payload = (name: string): IndividualRequest => ({
  displayName: name, countryCode: "UG", timezone: TZ, professionCode: "medical_doctor",
  defaultPracticeType: "clinic", locale: "en-UG", termsVersion: "t1", privacyNoticeVersion: "p1", source: "pilot",
});

async function provision(user: string, name: string, suffix: string): Promise<string> {
  const { data: req, error } = await admin.from("provisioning_request").insert({
    idempotency_key: `harness-cc-${suffix}`, request_type: "pilot",
    actor_user_id: user, target_user_id: user, payload_hash: "harness", correlation_id: "harness-cc",
  }).select("id").single();
  if (error || !req) throw new Error(`provisioning request refused: ${error?.message ?? "no row"}`);
  const run = await runProvisioning(admin, { id: req.id, target_user_id: user, correlation_id: "harness-cc", workspace_id: null }, payload(name));
  if (!run.ok || !run.workspaceId) throw new Error(`provisioning failed: ${run.errorCode}`);
  return run.workspaceId;
}

async function cleanup() {
  for (const u of [OWNER, OTHER]) {
    await admin.from("practice_practitioner_identity").delete().eq("user_id", u);
    const { data: ws } = await admin.from("practice_workspace").select("id").eq("owner_person_id", u);
    for (const w of (ws ?? []) as { id: string }[]) {
      await admin.from("practice_access_log").delete().eq("workspace_id", w.id);
      await admin.from("practice_location").update({ facility_id: null }).eq("workspace_id", w.id);
      await admin.from("practice_facility").delete().eq("workspace_id", w.id);
      await admin.from("practice_workspace").delete().eq("id", w.id);
    }
    await admin.from("provisioning_request").delete().eq("target_user_id", u);
    await admin.from("practice_audit_event").delete().eq("actor_id", u);
  }
}

/** Today in Kampala, and a wall-clock Kampala time on it expressed as the UTC instant it is. */
const kampalaToday = () => new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);
const kampala = (day: string, hh: number, mm = 0) => {
  const utcMinutes = hh * 60 + mm - 180;
  const base = Date.parse(`${day}T00:00:00.000Z`);
  return new Date(base + utcMinutes * 60000).toISOString();
};

async function main() {
  console.log("\n=== PRACTICE COMMAND CENTRE (CPR-001_v4, migration 229) ===\n");
  await cleanup();

  const wsA = await provision(OWNER, "Dr Command A", "a");
  const wsB = await provision(OTHER, "Dr Command B", "b");
  const ctxA = await resolveWorkspaceContext(admin, OWNER, wsA);
  const ctxB = await resolveWorkspaceContext(admin, OTHER, wsB);
  if (!ctxA.ok || !ctxB.ok) throw new Error("context resolution failed");

  const DAY = kampalaToday();

  // ---- 10. Every widget the page renders is configurable -------------------------------------------
  const pageSource = readFileSync("src/app/practice/(shell)/home/page.tsx", "utf8");
  const usedKeys = [...pageSource.matchAll(/widget\("([a-z_]+)"\)/g)].map(m => m[1]);
  const knownKeys = DASHBOARD_WIDGETS.map(([k]) => String(k));
  const unconfigurable = usedKeys.filter(k => !knownKeys.includes(k));
  ok("10a every widget the page renders is in DASHBOARD_WIDGETS",
    unconfigurable.length === 0, JSON.stringify(unconfigurable));
  ok("10b CONTROL: the page really does use widget keys, so 10a is not vacuous", usedKeys.length >= 8,
    String(usedKeys.length));

  // ---- 1. The clinic window is configured, not assumed ---------------------------------------------
  const before = await commandCentre(admin, ctxA.ctx, );
  ok("1a a fresh practice gets the seeded default window",
    before.clinic.opensLabel === "08:00" && before.clinic.closesLabel === "17:00",
    `${before.clinic.opensLabel}-${before.clinic.closesLabel}`);

  const { error: cfgError } = await admin.from("practice_configuration")
    .update({ clinic_opens_minute: 14 * 60, clinic_closes_minute: 20 * 60 })
    .eq("workspace_id", wsA).eq("is_effective", true);
  if (cfgError) throw new Error(`clinic hours update failed: ${cfgError.message}`);

  const evening = await commandCentre(admin, ctxA.ctx);
  ok("1b an evening practice's window is its own, not 08:00-17:00",
    evening.clinic.opensLabel === "14:00" && evening.clinic.closesLabel === "20:00",
    `${evening.clinic.opensLabel}-${evening.clinic.closesLabel}`);

  const wrapped = await admin.from("practice_configuration")
    .update({ clinic_opens_minute: 900, clinic_closes_minute: 400 })
    .eq("workspace_id", wsA).eq("is_effective", true);
  ok("1c a clinic that closes before it opens is refused by the database", !!wrapped.error,
    JSON.stringify(wrapped.error?.message ?? "ACCEPTED"));

  // ---- 2. The estimated finish is the last booking's end --------------------------------------------
  await admin.from("practice_configuration")
    .update({ clinic_opens_minute: 8 * 60, clinic_closes_minute: 17 * 60 })
    .eq("workspace_id", wsA).eq("is_effective", true);

  const pat = await registerPatient(admin, {
    workspaceId: wsA, displayName: "Timeline Patient", birthDate: "1985-02-02", phone: "+256700333444",
    actorId: OWNER, correlationId: "cc-2",
  });
  if (!pat.ok) throw new Error("patient setup failed");

  const early = await bookAppointment(admin, {
    workspaceId: wsA, patientId: pat.data.id, patientName: "x", appointmentType: "new_consultation",
    scheduledAt: kampala(DAY, 9, 0), durationMinutes: 30, actorId: OWNER, correlationId: "cc-2a",
  });
  ok("2a setup: an appointment exists", early.ok, JSON.stringify(early));

  const withOne = await commandCentre(admin, ctxA.ctx);
  ok("2b the finish is the end of the last booking",
    withOne.clinic.estimatedFinishLabel === "09:30", withOne.clinic.estimatedFinishLabel ?? "null");
  ok("2c a day inside the clinic window is not flagged as running late",
    withOne.clinic.runningLate === false);

  const late = await bookAppointment(admin, {
    workspaceId: wsA, patientName: "Late One", appointmentType: "new_consultation",
    scheduledAt: kampala(DAY, 16, 45), durationMinutes: 45, actorId: OWNER, correlationId: "cc-2d",
  });
  ok("2d setup: a booking that runs past closing exists", late.ok, JSON.stringify(late));
  const overrun = await commandCentre(admin, ctxA.ctx);
  ok("2e running past closing is flagged",
    overrun.clinic.runningLate === true && overrun.clinic.estimatedFinishLabel === "17:30",
    `${overrun.clinic.estimatedFinishLabel} late=${overrun.clinic.runningLate}`);

  // ---- 3. What heroStats protected, now owned by metrics.ts ----------------------------------------
  //
  // heroStats was deleted with the greeting card CPR-V5-001 s2 replaced. Its assertions are kept, not
  // dropped: the rule they enforced -- A FIGURE THE CALLER MAY NOT SEE IS NOT A ZERO -- is exactly what
  // s8 makes explicit, and it now has a status word for it instead of a boolean.
  const cc = await commandCentre(admin, ctxA.ctx);
  const scope = metricScope({ date: DAY, timezone: TZ });
  const seen = await practiceMetrics(admin, ctxA.ctx, scope);
  ok("3a booked counts the live diary", seen.metrics.booked.value === 2,
    JSON.stringify([seen.metrics.booked.value, seen.metrics.booked.status]));
  ok("3c every metric names the formula and the columns behind it",
    Object.values(seen.metrics).every(m => m.formula.length > 0 && m.sources.length > 0),
    JSON.stringify(Object.values(seen.metrics).filter(m => !m.formula).map(m => m.key)));

  // A caller with no diary access must be told so, never handed a nought.
  const blindCtx = { ...ctxA.ctx, capabilities: ctxA.ctx.capabilities.filter(c => c !== "practice.calendar.view") };
  const blind = await practiceMetrics(admin, blindCtx, scope);
  ok("3d a metric the caller cannot see is not_permitted, NOT zero",
    blind.metrics.booked.status === "not_permitted" && blind.metrics.booked.value === null,
    JSON.stringify([blind.metrics.booked.status, blind.metrics.booked.value]));
  // ---- 4. The week's locations distinguish three states ----------------------------------------------
  const { data: loc } = await admin.from("practice_location")
    .insert({ workspace_id: wsA, name: "Mulago Hospital", type: "hospital", active: true }).select("id").single();
  await bookAppointment(admin, {
    workspaceId: wsA, patientName: "At Mulago", appointmentType: "hospital_consultation",
    scheduledAt: kampala(DAY, 11, 0), locationId: loc!.id, allowOverlap: true,
    actorId: OWNER, correlationId: "cc-4",
  });

  const week = await commandCentre(admin, ctxA.ctx);
  const todayRow = week.weekLocations.find(d => d.isToday);
  ok("4a today shows the place with the most of its work",
    todayRow?.placeRecorded === true && todayRow?.locationName === "Mulago Hospital",
    JSON.stringify(todayRow));
  ok("4b the count is the day's bookings, not the location's",
    todayRow?.appointmentCount === 3, JSON.stringify(todayRow?.appointmentCount));
  const emptyRow = week.weekLocations.find(d => !d.isToday);
  ok("4c a day with nothing booked says so rather than naming a place",
    emptyRow?.placeRecorded === false && emptyRow?.appointmentCount === 0, JSON.stringify(emptyRow));
  ok("4d only the practice's clinic days are drawn", week.weekLocations.length === 5,
    String(week.weekLocations.length));

  // ---- 5 + 6. Performance: real arithmetic, always with its denominator -------------------------------
  //
  // ⚠ THESE MOVED FROM command-centre.ts, WHICH HELD A THIRD IMPLEMENTATION OF ALL FOUR. Same fixture,
  // same hand-checkable arithmetic, asserted against metrics.ts -- and one expectation CHANGES, which
  // is the point: see 6c.
  const emptyM = (await practiceMetrics(admin, ctxA.ctx, scope)).metrics.average_consult_time;
  ok("5a with no closed consultation the average is null, not zero",
    emptyM.value === null && emptyM.status === "unknowable" && !!emptyM.reason, JSON.stringify(emptyM));
  // A real check-in at 09:00, seen 09:20, finished 09:50, for a 09:00 booking.
  const apptId = early.ok ? early.data.id : null;
  await admin.from("practice_arrival").insert({
    workspace_id: wsA, appointment_id: apptId, status: "ARRIVED", arrived_at: kampala(DAY, 9, 0),
  });
  const { error: encError } = await admin.from("practice_encounter").insert({
    workspace_id: wsA, patient_id: pat.data.id, appointment_id: apptId,
    entry_pathway: "booked", encounter_mode: "in_person", status: "COMPLETED",
    started_at: kampala(DAY, 9, 20), completed_at: kampala(DAY, 9, 50), created_by: OWNER,
  });
  if (encError) throw new Error(`encounter fixture failed: ${encError.message}`);

  const measured = await practiceMetrics(admin, ctxA.ctx, scope);
  const perf = (k: keyof typeof measured.metrics) => measured.metrics[k];
  ok("6a avg consult time is end minus start", perf("average_consult_time").value === 30,
    JSON.stringify(perf("average_consult_time")));
  ok("6b avg wait time is start minus arrival", perf("average_wait_time").value === 20,
    JSON.stringify(perf("average_wait_time")));

  // ⚠ THE EXPECTATION THAT CHANGED, AND THE WHOLE REASON THIS MOVED. command-centre.ts rendered a
  // clinic delay of 20 minutes from ONE observation. s8: "no comparison shown until enough valid
  // observations exist". One late start is one person's morning, not a statistic, and it is the figure
  // a practitioner would rearrange an afternoon over.
  ok(`6c one observation renders NO clinic delay (the gate is ${MIN_OBSERVATIONS_FOR_DELAY})`,
    perf("clinic_delay").value === null && perf("clinic_delay").status === "unknowable",
    JSON.stringify(perf("clinic_delay")));
  ok("6c-control. and it says how many observations it had, rather than going quiet",
    perf("clinic_delay").observations === 1 && !!perf("clinic_delay").reason,
    JSON.stringify([perf("clinic_delay").observations, perf("clinic_delay").reason]));

  // A SECOND completed encounter for the SAME patient. One person seen twice is one patient seen.
  // Without this the assertion below passes against "count the encounters" just as happily.
  await admin.from("practice_encounter").insert({
    workspace_id: wsA, patient_id: pat.data.id, entry_pathway: "new_walk_in", encounter_mode: "in_person",
    status: "COMPLETED", started_at: kampala(DAY, 11, 0), completed_at: kampala(DAY, 11, 30),
    created_by: OWNER,
  });
  const twice = await practiceMetrics(admin, ctxA.ctx, scope);
  ok("6d patients seen counts DISTINCT patients, not encounters",
    twice.metrics.patients_seen.value === 1 && twice.metrics.completed.value === 2,
    JSON.stringify([twice.metrics.patients_seen.value, twice.metrics.completed.value]));
  ok("6d-control. and it discloses the duplicates it collapsed",
    twice.metrics.patients_seen.observations === 2 && twice.metrics.patients_seen.excluded === 1,
    JSON.stringify([twice.metrics.patients_seen.observations, twice.metrics.patients_seen.excluded]));
  ok("5b EVERY average carries the number of measurements behind it",
    Object.values(measured.metrics).filter(m => m.unit === "minutes")
      .every(m => m.observations !== null || m.status === "not_permitted"),
    JSON.stringify(Object.values(measured.metrics).filter(m => m.unit === "minutes").map(m => [m.key, m.observations])));
  ok("5c no performance figure is a percentage",
    !JSON.stringify(measured.metrics).match(/percent|rate|%/i));
  // ---- 7. Cohorts counted as typed, and by patient -----------------------------------------------------
  const { data: enc2 } = await admin.from("practice_encounter").insert({
    workspace_id: wsA, patient_id: pat.data.id, entry_pathway: "new_walk_in", encounter_mode: "in_person",
    status: "COMPLETED", started_at: kampala(DAY, 10, 0), created_by: OWNER,
  }).select("id").single();
  // The SAME patient, the SAME label, twice. One person with epilepsy, not two.
  for (const encId of [enc2!.id, enc2!.id]) {
    await admin.from("practice_diagnosis").insert({
      workspace_id: wsA, encounter_id: encId, patient_id: pat.data.id, label: "Epilepsy",
    });
  }
  const cohorts = await commandCentre(admin, ctxA.ctx);
  const epilepsy = cohorts.patientInsights?.cohorts.find(c => c.label === "Epilepsy");
  ok("7a a cohort counts PATIENTS, not diagnosis rows", epilepsy?.count === 1, JSON.stringify(epilepsy));
  ok("7b the label is exactly what was typed",
    cohorts.patientInsights?.cohorts.some(c => c.label === "Epilepsy") === true,
    JSON.stringify(cohorts.patientInsights?.cohorts));
  ok("7c the widget states that it counts as typed", cohorts.patientInsights?.countedAsTyped === true);

  // ---- 8. Recent patients is the reader's own access log ------------------------------------------------
  const noneYet = await commandCentre(admin, ctxA.ctx);
  ok("8a a practitioner who has opened nothing has an empty list",
    Array.isArray(noneYet.recentPatients) && noneYet.recentPatients.length === 0,
    JSON.stringify(noneYet.recentPatients));

  await admin.from("practice_access_log").insert({
    workspace_id: wsA, actor_id: OWNER, subject_kind: "patient", subject_id: pat.data.id,
    patient_id: pat.data.id, action: "view", route: "/practice/patients",
  });
  const opened = await commandCentre(admin, ctxA.ctx);
  ok("8b a record they opened appears",
    opened.recentPatients?.some(p => p.id === pat.data.id) === true,
    JSON.stringify(opened.recentPatients));

  // ── TWO PATIENTS AND TWO READERS, OR THIS PROVES NOTHING ─────────────────────────────────────────
  //
  // A failability run caught the first version of this: with ONE patient in the practice, both readers
  // see a list of length one whether the query filters by actor or not, so deleting the filter changed
  // nothing and the assertion sat green. Each reader must have opened a DIFFERENT record before "this
  // is your log, not a shared feed" is a claim a test can distinguish from its opposite.
  const theirs = await registerPatient(admin, {
    workspaceId: wsA, displayName: "Colleague Patient", birthDate: "1979-06-06", phone: "+256700555666",
    actorId: OWNER, correlationId: "cc-8c",
  });
  if (!theirs.ok) throw new Error("second patient setup failed");
  await admin.from("practice_access_log").insert({
    workspace_id: wsA, actor_id: OTHER, subject_kind: "patient", subject_id: theirs.data.id,
    patient_id: theirs.data.id, action: "view", route: "/practice/patients",
  });

  const mine = await commandCentre(admin, ctxA.ctx);
  const colleague = await commandCentre(admin, { ...ctxA.ctx, userId: OTHER });
  ok("8c CONTROL: the colleague sees the record THEY opened",
    colleague.recentPatients?.some(p => p.id === theirs.data.id) === true,
    JSON.stringify(colleague.recentPatients?.map(p => p.name)));
  ok("8d and NOT the one I opened -- it is my log, not a shared feed",
    colleague.recentPatients?.some(p => p.id === pat.data.id) === false,
    JSON.stringify(colleague.recentPatients?.map(p => p.name)));
  ok("8e and I do not see theirs either",
    mine.recentPatients?.some(p => p.id === theirs.data.id) === false &&
    mine.recentPatients?.some(p => p.id === pat.data.id) === true,
    JSON.stringify(mine.recentPatients?.map(p => p.name)));

  // ---- 9. Nothing claims to be AI-generated -------------------------------------------------------------
  // EVERYTHING EXCEPT THE REFUSAL LIST, which mentions AI precisely in order to disclaim it. Checking
  // the whole payload failed on this harness's first run against the words "An AI-written briefing" --
  // an assertion that cannot tell a claim from its denial is not testing the thing it names.
  const { refused: _refused, ...claims } = cohorts;
  const serialised = JSON.stringify(claims);
  const AI_CLAIM = /\bAI[- ]?(generated|briefing|written|powered|assisted)\b/i;
  ok("9a nothing the page presents as fact claims to be AI-generated",
    !AI_CLAIM.test(serialised), (serialised.match(AI_CLAIM) ?? [""])[0]);
  ok("9a-control the check CAN fire, proven against the refusal list it excludes",
    AI_CLAIM.test(JSON.stringify(cohorts.refused)));
  ok("9b the refusal list names the AI briefing explicitly",
    cohorts.refused.some(r => r.key === "ai_briefing"));
  ok("9c and names the missing baseline for trends",
    cohorts.refused.some(r => r.key === "performance_trends"));

  // ---- 11. Cross-workspace isolation, non-vacuously -------------------------------------------------------
  const bCentre = await commandCentre(admin, ctxB.ctx);
  ok("11a practice B sees none of practice A's day",
    bCentre.timeline.length === 0 && bCentre.weekLocations.every(d => d.appointmentCount === 0),
    JSON.stringify(bCentre.timeline.map(t => t.patientName)));
  ok("11b nor its cohorts", (bCentre.patientInsights?.cohorts.length ?? 0) === 0);
  ok("11c nor its locations",
    !bCentre.weekLocations.some(d => d.locationName === "Mulago Hospital"),
    JSON.stringify(bCentre.weekLocations.map(d => d.locationName)));
  ok("11d CONTROL: practice A does see its own, so 11a is not vacuous", cohorts.timeline.length === 3,
    String(cohorts.timeline.length));

  await cleanup();

  console.log(`\n  ${pass} passed, ${fails.length} failed`);
  if (fails.length) { fails.forEach(f => console.log(`   - ${f}`)); process.exit(1); }
}

main().catch(async e => { console.error(e); await cleanup(); process.exit(1); });
