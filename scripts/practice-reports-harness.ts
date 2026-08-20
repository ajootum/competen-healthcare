/**
 * Practice ACTIVITY harness -- an early slice of CPR-270 Analytics & Reporting, exercised against the
 * live database through the same engine the page uses. NO MIGRATION: every number is derived from
 * tables that already exist, which is the point.
 *
 * RE-LABELLED AFTER CPR-AUDIT-001. This was written under the CPR-330 heading, but counting what a
 * practice did is CPR-270's subject; CPR-330 is document generation and now lives in
 * practice-generation-harness.ts. The engine and these assertions were kept unchanged -- they are real
 * and CPR-270 will want them. The page moved to /practice/reports/analytics.
 *
 * WHAT IT PROVES:
 *   1. THIS PRODUCT COMPUTES NO RATES. Asserted structurally over the whole serialised report: no field
 *      whose name suggests a rate, and no value that is a percentage-shaped number where a count is
 *      expected. Every paired figure carries its DENOMINATOR instead, so "4 of 37" is what a reader
 *      gets and the division is theirs.
 *   2. THE COUNTS ARE REAL AND DISCRIMINATE. Built from a known fixture -- 4 booked, 1 attended, 1
 *      no-show, 1 cancelled -- so a count that simply returned everything, or nothing, fails.
 *   3. THE PERIOD IS THE PRACTICE'S CALENDAR AND IT EXCLUDES. Something dated outside the window does
 *      not appear, paired with the same thing inside it that does.
 *   4. DIAGNOSIS LABELS ARE COUNTED AS TYPED. Two spellings are two rows, and the report says how many
 *      carry a code -- presenting a tidy total would be inventing a coding nobody performed.
 *   5. THE BACKLOG IS AGED, not merely counted: an encounter unsigned for an hour and one unsigned for
 *      three weeks land in different buckets.
 *   6. DE-IDENTIFICATION CARRIES OVER FROM CPR-370. A caller with report.view and no patient.view --
 *      exactly what migration 191 gives the owner -- gets counts and no names anywhere in the response.
 *   7. Running a report is a READ OF THE WHOLE PRACTICE and is logged (CPR-370 composes).
 *   8. The CSV states it is not anonymised; isolation is non-vacuous.
 *
 *   npx --yes tsx scripts/practice-reports-harness.ts
 */
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { runProvisioning, type IndividualRequest } from "../src/lib/practice/provisioning";
import { registerPatient } from "../src/lib/practice/patients";
import { bookAppointment, transitionAppointment } from "../src/lib/practice/scheduling";
import { launchEncounter, transitionEncounter, recordDiagnosis } from "../src/lib/practice/encounters";
import { resolveWorkspaceContext, type WorkspaceContext } from "../src/lib/practice/access";
import { practiceToday, dueDateFrom } from "../src/lib/practice/practice-time";
import { practiceReport, resolvePeriod, activityReport, diagnosisReport, backlogReport, activityCsv } from "../src/lib/practice/reports";
import { purgeWorkspacesOwnedBy } from "./_cleanup";

loadEnvConfig(process.cwd());

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("Supabase env not set"); process.exit(1); }
const admin = createClient(url, key, { auth: { persistSession: false } });

const OWNER = "00000000-0000-4000-8000-0000000e18d1";
const OTHER = "00000000-0000-4000-8000-0000000e18d2";

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
    idempotency_key: `harness-rep-${suffix}`, request_type: "pilot",
    actor_user_id: user, target_user_id: user, payload_hash: "harness", correlation_id: "harness-rep",
  }).select("id").single();
  const run = await runProvisioning(admin, { id: req!.id, target_user_id: user, correlation_id: "harness-rep", workspace_id: null }, payload(name));
  if (!run.ok || !run.workspaceId) throw new Error(`provisioning failed: ${run.errorCode}${run.detail ? " -- " + run.detail : ""}`);
  return run.workspaceId;
}

async function cleanup() {
  await purgeWorkspacesOwnedBy(admin, [OWNER, OTHER]);
}

const base = { actorId: OWNER, correlationId: "harness-rep" };

/* eslint-disable @typescript-eslint/no-explicit-any */

const PATIENT_NAME = "Nakiwala Prossy";

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

async function main() {
  console.log("\nPractice reports harness (CPR-330, no migration)\n");
  await cleanup();

  const wsA = await provision(OWNER, "HARNESS Reports A (synthetic)", "a");
  const wsB = await provision(OTHER, "HARNESS Reports B (synthetic)", "b");
  const a = await resolveWorkspaceContext(admin, OWNER, wsA);
  const b = await resolveWorkspaceContext(admin, OTHER, wsB);
  if (!a.ok || !b.ok) { ok("workspace contexts resolve", false); return report(); }

  const today = practiceToday("Africa/Kampala");

  // ── An empty practice reports zero, not nothing ──────────────────────────
  const empty = await practiceReport(admin, a.ctx, { days: 30 });
  ok("an empty practice reports zeroes rather than failing",
    empty.activity.lines.every(l => l.value === 0) && empty.diagnoses.total === 0,
    JSON.stringify(empty.activity.lines.map(l => l.value)));

  // ── The fixture: known numbers, so a count that returns everything fails ──
  const pa = await registerPatient(admin, {
    workspaceId: wsA, displayName: PATIENT_NAME, birthDate: "1986-01-22", sex: "female",
    phone: "0772 555 100", ...base,
  });
  if (!pa.ok) { ok("patient registration succeeded", false, pa.message); return report(); }

  // 4 appointments inside the window: 1 attended, 1 no-show, 1 cancelled, 1 left booked.
  const mk = async (dayOffset: number, hour: string) => bookAppointment(admin, {
    workspaceId: wsA, patientId: pa.data.id, patientName: PATIENT_NAME,
    appointmentType: "scheduled_followup", scheduledAt: `${dueDateFrom(today, dayOffset)}T${hour}:00:00.000Z`,
    allowOverlap: true, ...base,
  });
  const [a1, a2, a3, a4] = await Promise.all([mk(-3, "08"), mk(-3, "09"), mk(-2, "10"), mk(-1, "11")]);
  ok("four appointments book inside the window", [a1, a2, a3, a4].every(r => r.ok),
    [a1, a2, a3, a4].map(r => r.ok ? "ok" : r.message).join("; "));
  if (!a1.ok || !a2.ok || !a3.ok || !a4.ok) return report();

  // No confirm step: bookAppointment enters CONFIRMED for staff bookings (2ee597ae, the owner's
  // 2026-08-12 click-reduction decision), so a transition here is refused as CONFIRMED -> CONFIRMED.
  // The REQUESTED rung is still exercised, deliberately, in practice-scheduling-harness.
  // ARRIVED, NO_SHOW and CANCELLED are all legal from CONFIRMED, so each of these is one step now.
  await transitionAppointment(admin, { workspaceId: wsA, appointmentId: a1.data.id, to: "ARRIVED", ...base });
  await transitionAppointment(admin, { workspaceId: wsA, appointmentId: a2.data.id, to: "NO_SHOW", ...base });
  await transitionAppointment(admin, { workspaceId: wsA, appointmentId: a3.data.id, to: "CANCELLED", ...base });

  // One OUTSIDE the window, to prove the period excludes.
  const outside = await bookAppointment(admin, {
    workspaceId: wsA, patientId: pa.data.id, patientName: PATIENT_NAME,
    appointmentType: "scheduled_followup", scheduledAt: `${dueDateFrom(today, -200)}T09:00:00.000Z`,
    allowOverlap: true, ...base,
  });
  ok("a fifth appointment exists OUTSIDE the window", outside.ok, outside.ok ? "" : outside.message);

  const enc = await launchEncounter(admin, {
    workspaceId: wsA, patientId: pa.data.id, pathway: "new_walk_in", reasonForVisit: "fever", ...base,
  });
  if (!enc.ok) { ok("encounter launch succeeded", false, enc.message); return report(); }
  await transitionEncounter(admin, { workspaceId: wsA, encounterId: enc.data.id, to: "ACTIVE", ...base });
  // TWO SPELLINGS OF ONE CONDITION, deliberately -- the report must not tidy them together.
  await recordDiagnosis(admin, { workspaceId: wsA, encounterId: enc.data.id, label: "Malaria", certainty: "confirmed", ...base });
  await recordDiagnosis(admin, { workspaceId: wsA, encounterId: enc.data.id, label: "malaria", certainty: "provisional", ...base });
  await recordDiagnosis(admin, { workspaceId: wsA, encounterId: enc.data.id, label: "Anaemia", code: "D64.9", certainty: "confirmed", ...base });
  await transitionEncounter(admin, { workspaceId: wsA, encounterId: enc.data.id, to: "COMPLETED", ...base });

  // ── 2 + 3. Counts are real, and the period excludes ──────────────────────
  const period = await resolvePeriod(admin, wsA, { days: 30 });
  const activity = await activityReport(admin, a.ctx, period);
  const line = (label: string) => activity.lines.find(l => l.label === label);

  ok("APPOINTMENTS ARE COUNTED FROM THE WINDOW, and the one outside it is excluded",
    line("Appointments booked")?.value === 4, `${line("Appointments booked")?.value} (expected 4)`);
  ok("attended, did-not-attend and cancelled are counted separately and correctly",
    line("Attended")?.value === 1 && line("Did not attend")?.value === 1 && line("Cancelled")?.value === 1,
    JSON.stringify({ a: line("Attended")?.value, d: line("Did not attend")?.value, c: line("Cancelled")?.value }));
  ok("EVERY PAIRED FIGURE CARRIES ITS DENOMINATOR",
    line("Attended")?.of === 4 && line("Did not attend")?.of === 4 && line("Cancelled")?.of === 4,
    JSON.stringify({ a: line("Attended")?.of, d: line("Did not attend")?.of }));
  ok("a plain count has no denominator rather than a made-up one",
    line("Patients registered")?.of === null && line("Patients registered")?.value === 1,
    JSON.stringify({ v: line("Patients registered")?.value, of: line("Patients registered")?.of }));
  ok("every line links somewhere the reader can open",
    activity.lines.every(l => l.href.startsWith("/practice/")));

  // The window that EXCLUDES everything, as the control for the window that includes.
  const narrow = await resolvePeriod(admin, wsA, { fromDay: dueDateFrom(today, -400), toDay: dueDateFrom(today, -300) });
  const narrowActivity = await activityReport(admin, a.ctx, narrow);
  ok("a window containing nothing reports nothing (the period genuinely filters)",
    narrowActivity.lines.every(l => l.value === 0), JSON.stringify(narrowActivity.lines.map(l => l.value)));
  const wide = await resolvePeriod(admin, wsA, { days: 365 });
  const wideActivity = await activityReport(admin, a.ctx, wide);
  ok("...and a wider window picks up the excluded appointment (both directions)",
    wideActivity.lines.find(l => l.label === "Appointments booked")?.value === 5,
    `${wideActivity.lines.find(l => l.label === "Appointments booked")?.value} (expected 5)`);

  // ── 1. NO RATES ANYWHERE ─────────────────────────────────────────────────
  const full = await practiceReport(admin, a.ctx, { days: 30, correlationId: "harness-rep" });
  const serialised = JSON.stringify(full);
  ok("NO FIELD IN THE REPORT IS NAMED LIKE A RATE",
    !/"[a-zA-Z]*(rate|percent|percentage|pct|ratio|average|mean)[a-zA-Z]*"\s*:/i.test(serialised),
    (serialised.match(/"[a-zA-Z]*(rate|percent|pct|ratio|average|mean)[a-zA-Z]*"\s*:/i) ?? []).join(","));
  ok("...and no value is a percentage string",
    !/\d+(\.\d+)?%/.test(serialised),
    (serialised.match(/\d+(\.\d+)?%/) ?? []).join(","));
  ok("the caveats are ON the report, not only in a comment",
    full.caveats.length >= 4 && full.caveats.some(c => /no rates|computes no rates/i.test(c)),
    `${full.caveats.length} caveats`);

  // ── 4. Labels as typed ───────────────────────────────────────────────────
  const dx = await diagnosisReport(admin, a.ctx, period);
  ok("TWO SPELLINGS OF ONE CONDITION ARE TWO ROWS (no invented coding)",
    dx.rows.some(r => r.label === "Malaria") && dx.rows.some(r => r.label === "malaria"),
    dx.rows.map(r => r.label).join(","));
  ok("the report says how many carry a code", dx.coded === 1 && dx.total === 3,
    JSON.stringify({ coded: dx.coded, total: dx.total }));
  ok("confirmed is counted separately from the total",
    dx.rows.find(r => r.label === "Malaria")?.confirmed === 1 &&
    dx.rows.find(r => r.label === "malaria")?.confirmed === 0,
    JSON.stringify(dx.rows.map(r => ({ l: r.label, c: r.confirmed }))));
  ok("a diagnosis row counts distinct patients as well as occurrences",
    dx.rows.every(r => r.patients === 1), JSON.stringify(dx.rows.map(r => r.patients)));

  // ── 5. The backlog is aged ───────────────────────────────────────────────
  const backlogNow = await backlogReport(admin, a.ctx);
  ok("the completed-but-unsigned encounter is in the backlog", backlogNow.unsignedEncounters.total === 1,
    `${backlogNow.unsignedEncounters.total}`);
  ok("...and it is aged as today rather than merely counted",
    backlogNow.unsignedEncounters.byAge["today"] === 1 && backlogNow.unsignedEncounters.byAge["30+ days"] === 0,
    JSON.stringify(backlogNow.unsignedEncounters.byAge));

  // Back-date it: the same row must move buckets, which is what makes ageing real rather than decorative.
  await admin.from("practice_encounter")
    .update({ completed_at: new Date(Date.now() - 40 * 86400000).toISOString() }).eq("id", enc.data.id);
  const backlogAged = await backlogReport(admin, a.ctx);
  ok("AN OLDER BACKLOG ITEM MOVES BUCKET (an hour and three weeks are different problems)",
    backlogAged.unsignedEncounters.byAge["30+ days"] === 1 && backlogAged.unsignedEncounters.byAge["today"] === 0,
    JSON.stringify(backlogAged.unsignedEncounters.byAge));

  // ── 6. De-identification carries over from CPR-370 ───────────────────────
  ok("a caller WITH clinical access is marked identified (control)", full.identified === true);
  const blinded = await withoutCapability(wsA, OWNER, "patient.view");
  ok("the blinded caller still holds report.view (the test has a real subject)",
    blinded.capabilities.includes("report.view") && !blinded.capabilities.includes("patient.view"));
  const blindReport = await practiceReport(admin, blinded, { days: 30, correlationId: "harness-rep" });
  ok("A REPORT-ONLY CALLER SEES NO PATIENT NAME ANYWHERE IN THE RESPONSE",
    blindReport.identified === false && !JSON.stringify(blindReport).includes(PATIENT_NAME),
    `identified=${blindReport.identified}`);
  ok("...but the counts still work for them (the control still functions)",
    blindReport.activity.lines.find(l => l.label === "Appointments booked")?.value === 4,
    JSON.stringify(blindReport.activity.lines.find(l => l.label === "Appointments booked")));

  // ── 7. Running a report is a logged read ─────────────────────────────────
  const { data: logged } = await admin.from("practice_access_log")
    .select("route, detail, action").eq("workspace_id", wsA).eq("route", "/practice/reports");
  ok("RUNNING A REPORT IS LOGGED AS A READ OF THE WHOLE PRACTICE (CPR-370 composes)",
    ((logged ?? []) as any[]).length >= 2 && (logged as any[])[0].detail.startsWith("report "),
    `${((logged ?? []) as any[]).length} entries`);

  // ── 8. The CSV, and isolation ────────────────────────────────────────────
  const csv = activityCsv(full);
  ok("the CSV states it is NOT anonymised (aggregate is not the same as safe)",
    /NOT anonymised/i.test(csv) && /no rates and no benchmarks/i.test(csv), csv.split("\n")[3]?.slice(0, 80));
  // Labels are CSV-quoted, so the row reads `"Appointments booked",4,` -- an earlier version of this
  // assertion looked for the unquoted form and failed against a correct file.
  ok("the CSV carries the period, and each count WITH its denominator",
    csv.includes(period.fromDay) && csv.includes('"Appointments booked",4,') && csv.includes('"Did not attend",1,4'),
    csv.split("\n").filter(l => l.includes("attend") || l.includes("Appointments")).join(" | "));
  ok("the CSV has no percentage in it either", !/\d+(\.\d+)?%/.test(csv));

  const bReport = await practiceReport(admin, b.ctx, { days: 365 });
  ok("B's report counts none of A's activity",
    bReport.activity.lines.every(l => l.value === 0) && bReport.diagnoses.total === 0,
    JSON.stringify(bReport.activity.lines.map(l => l.value)));
  ok("A's report is non-empty (the isolation test is not vacuous)",
    wideActivity.lines.some(l => l.value > 0));

  // ══ USE TEMPLATE (2026-08-15): the Templates tab's door into generation ═══════════════════════════
  //
  // The tab could author templates but not do the thing it is named for -- "selecting a template
  // creates a document" lived on a different screen with no route between them. These pin the door:
  // the LINK is gated by the same three conditions the server enforces, the reports page FORWARDS the
  // parameter (the middle-layer dropped-field class), and the console validates it against the SAME
  // list its own dropdown renders from.
  const { readFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const appDir = join(process.cwd(), "src", "app", "practice", "(shell)");
  const tplPage = readFileSync(join(appDir, "documents", "templates", "page.tsx"), "utf8");
  const repPage = readFileSync(join(appDir, "reports", "page.tsx"), "utf8");
  const consoleSrc = readFileSync(join(appDir, "reports", "GenerateConsole.tsx"), "utf8");

  const { listTemplates } = await import("../src/lib/practice/documentation");
  const lib = await listTemplates(admin, wsA, { includeUnpublished: true }) as any[];
  ok("UT-1. listTemplates says WHETHER each template is generable and never ships the body to a list",
    lib.length > 0 && lib.every(t => typeof t.mergeable === "boolean" && !("body_template" in t)),
    JSON.stringify(lib.slice(0, 2).map(t => ({ id: t.id, mergeable: t.mergeable, hasBody: "body_template" in t }))));

  ok("UT-2. the Use link exists and is gated by ALL THREE server conditions -- published, a document kind, a body",
    tplPage.includes("/practice/reports?template=")
      && /status === "published" && t\.kind !== "encounter_note" && t\.mergeable/.test(tplPage),
    "the link must not be offerable where following it gets a refusal");
  ok("UT-2b. and by document.author -- an action the person cannot complete is not offered",
    /hasCapability\(shell\.ctx, "document\.author"\)/.test(tplPage) && tplPage.includes("canGenerate && generable(t)"));

  ok("UT-3. the reports page FORWARDS ?template= into the console (the dropped-field class, pinned)",
    /one\("template"\)/.test(repPage) && /initialTemplateId=\{initialTemplateId\}/.test(repPage));

  ok("UT-4. the console validates the preselection against `usable` -- the SAME list its dropdown renders",
    /usable\.find\(t => t\.id === initialTemplateId\)/.test(consoleSrc),
    "a second copy of the usability rule here would be the client-mirror drift class");
  ok("UT-4b. a link naming an unusable template gets a SENTENCE, rendered while the panel is closed",
    consoleSrc.includes("cannot be generated from right now") && /\{!mode && notice &&/.test(consoleSrc),
    "the notice inside the panel is invisible exactly when this case leaves the panel shut");
  // CONTROL: the needle can fail. The gate expression UT-4b matched must live OUTSIDE the `mode &&`
  // block -- if the standalone render were deleted, this derived source would no longer contain it.
  ok("UT-4c. CONTROL: removing the standalone render would redden UT-4b, not pass vacuously",
    consoleSrc.split("{!mode && notice &&").length === 2, "expected exactly one standalone notice render");

  return report();
}

function report() {
  console.log(`\n${fails.length === 0 ? "PASSED" : "FAILED"}  ${pass} passed, ${fails.length} failed`);
  if (fails.length) { for (const f of fails) console.log(`  - ${f}`); process.exitCode = 1; }
}

main()
  .then(cleanup)
  .catch(async e => { console.error(e); await cleanup(); process.exitCode = 1; });
