/**
 * Practice intelligence harness -- CPR-200. NO MIGRATION: this module composes engines that already
 * exist, which is the finding rather than a shortcut.
 *
 * WHAT IT PROVES:
 *   1. NO RATE ANYWHERE. Asserted structurally over the whole serialised payload: no percentage-shaped
 *      value, no field named like a rate. The comp's headline figures are all rates and none survive.
 *   2. THE TREND IS BUCKETED IN THE PRACTICE'S CALENDAR, not UTC. An encounter late in a Kampala evening
 *      lands on the day it happened locally, and the harness places one where the two disagree.
 *   3. THE COMPARISON IS A COUNT AGAINST A COUNT -- this period and the one before -- never "+12%".
 *   4. EVERY COMPLETENESS LINE CARRIES ITS DENOMINATOR AND A PLACE TO GO, and it discriminates: a
 *      procedure with no outcome is counted, one with an outcome is not.
 *   5. THE COUNTS ARE REAL AND DISCRIMINATE, built from a known fixture, so a query returning everything
 *      or nothing fails.
 *   6. NOTHING IS SILENTLY ZERO. `myGrowth` filters encounters by their author; the harness asserts a
 *      NON-ZERO count, which is what catches a filter on a column that does not exist -- the exact bug
 *      this file was written after hitting.
 *   7. WHAT CANNOT BE COMPUTED IS NAMED, with a reason, rather than omitted or rendered as zero.
 *   8. DE-IDENTIFICATION carries over from CPR-370: report.view without patient.view sees no names.
 *   9. Reading it is logged, because it is a read of the whole practice.
 *  10. Cross-workspace isolation, non-vacuously.
 *
 *   npx --yes tsx scripts/practice-intelligence-harness.ts
 */
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { runProvisioning, type IndividualRequest } from "../src/lib/practice/provisioning";
import { registerPatient } from "../src/lib/practice/patients";
import { launchEncounter, transitionEncounter, recordDiagnosis } from "../src/lib/practice/encounters";
import { recordProcedure, recordProcedureOutcome } from "../src/lib/practice/procedures";
import { createFollowUp, closeFollowUp } from "../src/lib/practice/follow-ups";
import { resolveWorkspaceContext, type WorkspaceContext } from "../src/lib/practice/access";
import { resolvePeriod } from "../src/lib/practice/reports";
import { practiceIntelligence, myGrowth, encounterTrend, NOT_AVAILABLE } from "../src/lib/practice/intelligence";
import { practiceToday, dueDateFrom } from "../src/lib/practice/practice-time";

loadEnvConfig(process.cwd());

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("Supabase env not set"); process.exit(1); }
const admin = createClient(url, key, { auth: { persistSession: false } });

const OWNER = "00000000-0000-4000-8000-0000000e29d1";
const OTHER = "00000000-0000-4000-8000-0000000e29d2";

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
    idempotency_key: `harness-int-${suffix}`, request_type: "pilot",
    actor_user_id: user, target_user_id: user, payload_hash: "harness", correlation_id: "harness-int",
  }).select("id").single();
  const run = await runProvisioning(admin, { id: req!.id, target_user_id: user, correlation_id: "harness-int", workspace_id: null }, payload(name));
  if (!run.ok || !run.workspaceId) throw new Error(`provisioning failed: ${run.errorCode}`);
  return run.workspaceId;
}

async function cleanup() {
  for (const u of [OWNER, OTHER]) {
    const { data: ws } = await admin.from("practice_workspace").select("id").eq("owner_person_id", u);
    for (const w of (ws ?? []) as { id: string }[]) await admin.from("practice_workspace").delete().eq("id", w.id);
    await admin.from("provisioning_request").delete().eq("target_user_id", u);
    await admin.from("practice_audit_event").delete().eq("actor_id", u);
  }
}

const base = { actorId: OWNER, correlationId: "harness-int" };

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

async function main() {
  console.log("\nPractice intelligence harness (CPR-200, no migration)\n");
  await cleanup();

  // ── 7. What cannot be computed is named, before any data exists ──────────
  ok("WHAT CANNOT BE COMPUTED IS NAMED, each with a reason rather than a shrug",
    NOT_AVAILABLE.length >= 5 &&
    NOT_AVAILABLE.every(n => n.reason.length > 40) &&
    NOT_AVAILABLE.some(n => n.key === "satisfaction") &&
    NOT_AVAILABLE.some(n => n.key === "benchmarks"),
    NOT_AVAILABLE.map(n => n.key).join(","));
  ok("and the benchmark refusal says WHY -- it holds one practice and cannot rank it against any other",
    /never seen|one practice/i.test(NOT_AVAILABLE.find(n => n.key === "benchmarks")!.reason));

  const wsA = await provision(OWNER, "HARNESS Intelligence A (synthetic)", "a");
  const wsB = await provision(OTHER, "HARNESS Intelligence B (synthetic)", "b");
  const a = await resolveWorkspaceContext(admin, OWNER, wsA);
  const b = await resolveWorkspaceContext(admin, OTHER, wsB);
  if (!a.ok || !b.ok) { ok("workspace contexts resolve", false); return report(); }

  const today = practiceToday("Africa/Kampala");

  // ── An empty practice reports zeroes, not nothing ────────────────────────
  const empty = await practiceIntelligence(admin, a.ctx, { days: 30 });
  ok("an empty practice reports zeroes rather than failing",
    empty.trend.total === 0 && empty.caseMix.procedureTotal === 0,
    JSON.stringify({ t: empty.trend.total }));
  ok("and its trend is zero-filled, so a quiet period reads as quiet rather than missing",
    empty.trend.buckets.length === 30 && empty.trend.buckets.every(x => x.total === 0),
    String(empty.trend.buckets.length));

  // ── The fixture: known numbers ───────────────────────────────────────────
  const p1 = await registerPatient(admin, {
    workspaceId: wsA, displayName: "Atieno Ruth", sex: "female", birthDate: "1980-02-02",
    phone: "0772 557 000", ...base,
  });
  if (!p1.ok) { ok("patient registers", false, p1.message); return report(); }

  // THE DIAGNOSIS IS RECORDED BEFORE THE ENCOUNTER IS SIGNED, and that ordering is not incidental:
  // migration 194's trigger makes a signed encounter immutable, so writing to one afterwards is refused.
  // An earlier version of this fixture signed first and got two silent refusals, which showed up as an
  // empty case mix -- the engine was right and the fixture was wrong.
  const encounters: string[] = [];
  const diagnosed: boolean[] = [];
  for (let i = 0; i < 3; i++) {
    const e = await launchEncounter(admin, {
      workspaceId: wsA, patientId: p1.data.id, pathway: "new_walk_in", reasonForVisit: `Visit ${i}`, ...base,
    });
    if (!e.ok) continue;
    encounters.push(e.data.id);

    if (i < 2) {
      const dx = await recordDiagnosis(admin, {
        workspaceId: wsA, encounterId: e.data.id, label: "Malaria", certainty: "confirmed", ...base,
      });
      diagnosed.push(dx.ok);
      // Only one encounter may be live at a time (194's partial unique index), so close each before the
      // next one launches.
      await transitionEncounter(admin, { workspaceId: wsA, encounterId: e.data.id, to: "ACTIVE", ...base });
      await transitionEncounter(admin, { workspaceId: wsA, encounterId: e.data.id, to: "COMPLETED", ...base });
      await transitionEncounter(admin, { workspaceId: wsA, encounterId: e.data.id, to: "SIGNED", ...base });
    }
  }
  ok("three consultations exist", encounters.length === 3, String(encounters.length));
  // ASSERTED, NOT ASSUMED. Every fixture write that a later assertion depends on has to be checked, or a
  // refused write becomes a failure attributed to the code under test.
  ok("and both diagnoses were actually recorded", diagnosed.length === 2 && diagnosed.every(Boolean),
    JSON.stringify(diagnosed));

  // Two procedures: one with a complication recorded, one with nothing at all.
  const proc1 = await recordProcedure(admin, {
    workspaceId: wsA, encounterId: encounters[2], label: "Wound suture",
    consentStatus: "obtained", status: "PERFORMED", ...base,
  });
  const proc2 = await recordProcedure(admin, {
    workspaceId: wsA, encounterId: encounters[2], label: "Abscess drainage",
    consentStatus: "not_recorded", status: "PERFORMED", ...base,
  });
  if (proc1.ok) {
    await recordProcedureOutcome(admin, {
      workspaceId: wsA, procedureId: proc1.data.id, outcomeType: "complication",
      severity: "mild", detail: "Minor bleeding", ...base,
    });
  }
  ok("two procedures exist, one with an outcome and one without", proc1.ok && proc2.ok);

  const fu = await createFollowUp(admin, {
    workspaceId: wsA, patientId: p1.data.id, reason: "Wound check", dueOn: today, ...base,
  });
  if (fu.ok) {
    await closeFollowUp(admin, {
      workspaceId: wsA, followUpId: fu.data.id, to: "COMPLETED",
      outcome: "Healed well", outcomeCode: "improved", ...base,
    });
  }
  ok("one follow-up is concluded", fu.ok);

  // ── 5. The counts are real and discriminate ──────────────────────────────
  const intel = await practiceIntelligence(admin, a.ctx, { days: 30 });
  ok("the trend counts the three consultations", intel.trend.total === 3, String(intel.trend.total));
  ok("case mix counts both procedures and finds the repeated diagnosis",
    intel.caseMix.procedureTotal === 2 &&
    intel.caseMix.diagnoses.rows.find((r: any) => r.label === "Malaria")?.total === 2,
    JSON.stringify(intel.caseMix.diagnoses.rows.map((r: any) => [r.label, r.total])));
  ok("outcomes count the complication AGAINST ITS DENOMINATOR, never as a rate",
    intel.outcomes.procedures.performed === 2 && intel.outcomes.procedures.withComplication === 1,
    JSON.stringify(intel.outcomes.procedures));
  ok("and the follow-up taxonomy is counted",
    intel.outcomes.followUps.completed === 1 &&
    intel.outcomes.followUps.byOutcome.find((o: any) => o.code === "improved")?.total === 1,
    JSON.stringify(intel.outcomes.followUps.byOutcome.filter((o: any) => o.total > 0)));

  // ── 1. No rate anywhere ──────────────────────────────────────────────────
  const serialised = JSON.stringify(intel);
  ok("THE WHOLE PAYLOAD CONTAINS NO PERCENTAGE AND NO FIELD NAMED LIKE A RATE",
    !/\d+(\.\d+)?%/.test(serialised) && !/"(rate|percent|percentage|ratio|score|coverage)"/i.test(serialised));
  ok("and it says so as a field, so no client can render one",
    intel.ratesComputed === false);

  // ── 3. The comparison is a count against a count ─────────────────────────
  ok("the trend carries the PREVIOUS period as a count, not a change figure",
    typeof intel.trend.priorTotal === "number" && !("change" in intel.trend) && !("delta" in intel.trend),
    JSON.stringify({ total: intel.trend.total, prior: intel.trend.priorTotal }));

  // ── 4. Completeness discriminates ────────────────────────────────────────
  const gaps = Object.fromEntries(intel.completeness.map((c: any) => [c.key, c]));
  ok("A PROCEDURE WITH NO OUTCOME IS COUNTED, and the one with an outcome is not",
    gaps.no_outcome?.missing === 1 && gaps.no_outcome?.of === 2,
    JSON.stringify(gaps.no_outcome));
  ok("consent not recorded is counted separately -- not recorded is not the same as not obtained",
    gaps.consent?.missing === 1 && gaps.consent?.of === 2, JSON.stringify(gaps.consent));
  ok("EVERY LINE CARRIES ITS DENOMINATOR AND SOMEWHERE TO GO",
    intel.completeness.every((c: any) => c.of > 0 && c.href.startsWith("/practice/") && c.note.length > 20),
    JSON.stringify(intel.completeness.map((c: any) => [c.key, c.href])));
  ok("and no line is a score", !intel.completeness.some((c: any) => "score" in c || "percent" in c));

  // ── 2. Buckets are the practice's day, not UTC ───────────────────────────
  //
  // 22:30 UTC on the 14th is 01:30 EAT on the 15th. A UTC bucketing puts it on the 14th; the practice's
  // calendar puts it on the 15th, which is the day the clinician was working.
  //
  // SHIFTED ON THE UNSIGNED ENCOUNTER, and that detail cost two vacuous passes. encounters[0] is SIGNED,
  // so migration 194's immutability trigger silently refuses an update to it -- the shift never
  // happened, all three consultations stayed on today, and the assertion held under UTC bucketing too.
  // encounters[2] is still a draft, and the update is verified before anything is asserted on it.
  const yesterday = dueDateFrom(today, -1);
  await admin.from("practice_encounter").update({ started_at: `${yesterday}T22:30:00.000Z` })
    .eq("id", encounters[2]);
  const { data: moved } = await admin.from("practice_encounter")
    .select("started_at").eq("id", encounters[2]).maybeSingle();
  ok("the fixture's consultation really did move to 22:30 UTC the day before",
    String(moved?.started_at ?? "").startsWith(yesterday), String(moved?.started_at));

  const period = await resolvePeriod(admin, wsA, { days: 30 });
  const shifted = await encounterTrend(admin, a.ctx, period);
  const onLocalDay = shifted.buckets.find(x => x.day === today)?.total ?? 0;
  const onUtcDay = shifted.buckets.find(x => x.day === yesterday)?.total ?? 0;
  // ALL THREE ON TODAY, not two. The other two consultations are already on today whichever way the
  // bucketing works, so ">= 1" would pass under UTC as well -- an earlier version asserted exactly that
  // and sat green through a deliberate break. The discriminating claim is that the shifted one JOINS
  // them: local puts today at 3 and yesterday at 0; UTC puts today at 2 and yesterday at 1.
  ok("THE TREND BUCKETS IN THE PRACTICE'S CALENDAR: a 22:30 UTC consultation lands on the LOCAL day",
    onLocalDay === 3 && onUtcDay === 0, `local(${today})=${onLocalDay} utc(${yesterday})=${onUtcDay}`);

  // ── 6. Nothing is silently zero ──────────────────────────────────────────
  //
  // THE ASSERTION THIS FILE WAS WRITTEN AFTER. myGrowth filtered encounters on `opened_by`, which does
  // not exist -- PostgREST errored, the data came back null, and the count was a silent zero. A
  // non-zero assertion is the only kind that catches it.
  const growth = await myGrowth(admin, a.ctx, period);
  ok("MY GROWTH COUNTS MY OWN CONSULTATIONS AND IS NOT SILENTLY ZERO",
    growth.encounters === 3, String(growth.encounters));
  ok("and my own procedures", growth.procedures === 2, String(growth.procedures));
  ok("the portfolio comes from CPR-150 rather than a second count of the same thing",
    growth.portfolio.procedures.performed === 2, JSON.stringify(growth.portfolio.procedures));

  // ── 8. De-identification ─────────────────────────────────────────────────
  const blind = await withoutCapability(wsA, OWNER, "patient.view");
  const blindIntel = await practiceIntelligence(admin, blind, { days: 30 });
  ok("a caller with report.view and NO patient.view is marked unidentified",
    blindIntel.identified === false);
  ok("and no patient name appears anywhere in what they get",
    !JSON.stringify(blindIntel).includes("Atieno"), "name leaked");
  ok("CONTROL: their counts are still there (it is not simply empty)",
    blindIntel.trend.total === 3, String(blindIntel.trend.total));

  // ── 9. It is logged ──────────────────────────────────────────────────────
  const { data: logs } = await admin.from("practice_access_log")
    .select("subject_kind, detail, route").eq("workspace_id", wsA).eq("route", "/practice/intelligence");
  ok("READING THE WHOLE PRACTICE IS LOGGED, like any other read",
    ((logs ?? []) as any[]).length >= 1 && /Practice intelligence/.test(((logs ?? []) as any[])[0]?.detail ?? ""),
    JSON.stringify(((logs ?? []) as any[])[0]));

  // ── 10. Isolation ────────────────────────────────────────────────────────
  const bIntel = await practiceIntelligence(admin, b.ctx, { days: 365 });
  ok("B's intelligence counts none of A's work",
    bIntel.trend.total === 0 && bIntel.caseMix.procedureTotal === 0 && bIntel.completeness.length === 0,
    JSON.stringify({ t: bIntel.trend.total, p: bIntel.caseMix.procedureTotal }));
  ok("A's is non-empty (the isolation test is not vacuous)", intel.trend.total > 0);

  // A single-location practice is not compared with itself.
  ok("a practice with fewer than two locations gets no location comparison",
    intel.locations.comparable === false, JSON.stringify(intel.locations));

  return report();
}

function report() {
  console.log(`\n${fails.length === 0 ? "PASSED" : "FAILED"}  ${pass} passed, ${fails.length} failed`);
  if (fails.length) { for (const f of fails) console.log(`  - ${f}`); process.exitCode = 1; }
}

main()
  .then(cleanup)
  .catch(async e => { console.error(e); await cleanup(); process.exitCode = 1; });
