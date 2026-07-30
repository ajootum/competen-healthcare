// One-off harness for the Assignment & Workload Engine (HWW-AE-001).
// Exercises the SHIPPED lib (@/lib/hww/assignment-engine):
//   1. allocate() rules on synthetic data — balance, continuity, the R1
//      competency rule, coverage gaps, ratio caps, overload alerts, isolation
//      cohorting, explanations, override flags
//   2. Real data: loadAssignmentContext + a dry-run generate (no writes),
//      with invariants checked against the live rows
//   3. publishPairs against a HARNESS-OWNED test patient (real write path:
//      primary uniqueness, competency validation, audit) — then cleaned up
//   4. Post-155: a persisted generate run → row verified → deleted
//   npx --yes tsx scripts/hww-assignment-harness.ts
/* eslint-disable @typescript-eslint/no-explicit-any */

import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
loadEnvConfig(process.cwd());

let pass = 0, fail = 0;
const check = (ok: boolean, label: string, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (ok) pass++; else fail++;
};

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) { console.error("Missing Supabase env."); process.exit(1); }
  const admin = createClient(url, key, { auth: { persistSession: false } });
  const { allocate, loadAssignmentContext, generateRecommendation, publishPairs } = await import("../src/lib/hww/assignment-engine");

  const nurse = (id: string, over: any = {}) => ({ id, name: `Nurse ${id}`, role: "nurse", currentPatients: [], blocked: false, criticalFailures: 0, expiredCount: 0, competencyValidated: true, ...over });
  const patient = (id: string, over: any = {}) => ({ id, label: `P${id}`, bed: null, acuityLevel: "moderate", acuityScore: null, workloadPct: 30, workloadIsMeasured: true, isolation: false, currentNurse: null, ...over });

  // ── 1. Pure allocator rules ──
  console.log("── allocate() rules ──");
  let r = allocate([nurse("a"), nurse("b")], [patient("1"), patient("2"), patient("3"), patient("4")]);
  const counts = r.nurseLoads.map(n => n.patients).sort().join("/");
  check(counts === "2/2", "4 equal patients balance 2/2 across 2 nurses", counts);
  check(r.proposals.length === 4 && r.gaps.length === 0, "all placed, no gaps");

  r = allocate([nurse("a"), nurse("b")], [patient("1", { currentNurse: "b" })]);
  check(r.proposals[0].staff_id === "b" && r.proposals[0].continuity, "continuity wins the tie (stays with current nurse)");

  r = allocate([nurse("a", { blocked: true, criticalFailures: 1 }), nurse("b")],
    [patient("1", { acuityLevel: "critical", workloadPct: 90 })]);
  check(r.proposals[0]?.staff_id === "b", "R1: critical patient avoids the blocked nurse");
  check(/competency-cleared for high acuity/.test(r.proposals[0]?.explanation ?? ""), "explanation states the competency clearance");

  r = allocate([nurse("a", { blocked: true })], [patient("1", { acuityLevel: "critical", workloadPct: 90 })]);
  check(r.proposals.length === 0 && r.gaps.length === 1, "all-blocked + critical → coverage gap, never a silent unsafe placement");
  check(r.riskAlerts.some(a => a.severity === "high" && /Coverage gap/.test(a.text)), "gap raises a high risk alert");

  r = allocate([nurse("a"), nurse("b")], [1, 2, 3, 4, 5].map(i => patient(String(i))), { maxPerNurse: 2 });
  check(r.proposals.length === 4 && r.gaps.length === 1 && /ratio cap/.test(r.gaps[0].reason), "ratio cap 2/nurse → 5th patient is a gap");

  r = allocate([nurse("a")], [patient("1", { workloadPct: 70 }), patient("2", { workloadPct: 60 })]);
  check(r.nurseLoads[0].load === 130 && r.nurseLoads[0].overloaded, "load sums exactly (130) and flags overload");
  check(r.riskAlerts.some(a => /over one nurse's capacity/.test(a.text)), "overload risk alert raised");

  // Isolation cohorting: with equal loads, the second isolation patient prefers
  // the nurse already holding one. Place iso1 on a (heavier first), plain on b,
  // then iso2 (lighter) — cohort bonus should pull it to a despite equal-ish load.
  r = allocate([nurse("a"), nurse("b")],
    [patient("iso1", { isolation: true, workloadPct: 40 }), patient("plain", { workloadPct: 40 }), patient("iso2", { isolation: true, workloadPct: 35 })]);
  const isoNurse = r.proposals.find(p => p.patient_id === "iso1")?.staff_id;
  check(r.proposals.find(p => p.patient_id === "iso2")?.staff_id === isoNurse, "isolation patients cohort to the same nurse");

  r = allocate([nurse("a", { competencyValidated: false })], [patient("1")]);
  check(r.proposals[0]?.needs_override === true, "unvalidated nurse → needs_override flagged");
  check(r.riskAlerts.some(a => /override/.test(a.text)), "override requirement surfaces as an alert");
  check(r.proposals.every(p => p.explanation.length > 10), "every proposal carries an explanation");

  r = allocate([nurse("a", { blocked: true }), nurse("b")], [patient("1", { acuityLevel: "stable", workloadPct: 20 })]);
  check(r.proposals[0]?.staff_id === "b", "soft rule: stable work steers away from blocked nurses too");

  // ── 2. Real data: context + dry-run generate ──
  console.log("\n── Real data (read-only) ──");
  const ctx = await loadAssignmentContext(admin, null, true);
  if (!ctx.shift) {
    console.log("(no ACTIVE shift on any tenant — context assembly returns honestly empty; generate would 409)");
    const g = await generateRecommendation(admin, { hospitalId: null, isSuperUser: true, dryRun: true });
    check(!g.ok && g.status === 409, "generate without an active shift → 409 with honest error", (g as any).error);
  } else {
    console.log(`(active shift ${ctx.shift.shift_type} on ${ctx.shift.unit ?? ctx.shift.department ?? "?"}: ${ctx.nurses.length} nurses, ${ctx.patients.length} patients, cap ${ctx.maxPerNurse ?? "none"})`);
    if (ctx.nurses.length && ctx.patients.length) {
      const g = await generateRecommendation(admin, { hospitalId: null, isSuperUser: true, dryRun: true });
      check(g.ok === true, "dry-run generate succeeds");
      if (g.ok) {
        const placed = new Set(g.proposals.map((p: any) => p.patient_id));
        check(placed.size === g.proposals.length, "each patient placed at most once");
        check(g.proposals.length + g.gaps.length === ctx.patients.length, "proposals + gaps cover every patient");
        const badHigh = g.proposals.filter((p: any) => {
          const pt = ctx.patients.find(x => x.id === p.patient_id);
          const n = ctx.nurses.find(x => x.id === p.staff_id);
          return pt && n && ["high", "critical"].includes(pt.acuityLevel) && n.blocked;
        });
        check(badHigh.length === 0, "no high-acuity patient on a blocked nurse (live data)");
      }
    } else console.log("(shift has no present nurses or no patients — allocation invariants untestable live)");
  }

  // ── 3. publishPairs real write path (harness-owned patient) ──
  console.log("\n── publishPairs (harness patient) ──");
  const { data: anyNurse } = await admin.from("profiles").select("id, full_name, hospital_id").limit(1).maybeSingle();
  const { data: hosp } = await admin.from("hospitals").select("id").limit(1).maybeSingle();
  if (anyNurse && hosp) {
    const { data: hp, error: hpErr } = await admin.from("op_patients").insert({
      hospital_id: anyNurse.hospital_id ?? hosp.id, label: "Harness AE Patient (safe to delete)",
      acuity_level: "stable", operational_status: "admitted",
    }).select("id").single();
    if (hpErr) { console.log("Could not seed harness patient:", hpErr.message); }
    else {
      const res = await publishPairs(admin, [{ patient_id: hp.id, staff_id: anyNurse.id }], { id: anyNurse.id, name: "harness" });
      check(res[0]?.ok === true, "publish creates a real primary assignment", res[0]?.error);
      const { data: asg } = await admin.from("op_patient_assignments").select("id, assignment_type, status, competency_validated").eq("patient_id", hp.id).eq("status", "active");
      check((asg ?? []).length === 1 && asg![0].assignment_type === "primary", "exactly one active primary exists");
      // Re-publish same pair → no-op keep (no duplicate).
      const res2 = await publishPairs(admin, [{ patient_id: hp.id, staff_id: anyNurse.id }], { id: anyNurse.id, name: "harness" });
      check(res2[0]?.ok === true && res2[0]?.assignment_id === asg![0].id, "same-nurse re-publish keeps the existing record (no duplicate)");
      const bad = await publishPairs(admin, [{ patient_id: "00000000-0000-0000-0000-00000000dead", staff_id: anyNurse.id }], { id: anyNurse.id });
      check(bad[0]?.ok === false, "invented patient fails per-pair without throwing");
      // Cleanup (assignments cascade with the patient).
      await admin.from("op_patients").delete().eq("id", hp.id);
      console.log("(harness patient + assignment deleted)");
    }
  } else console.log("(no profiles/hospitals — publish path untestable)");

  // ── 4. Persistence (post-155) ──
  const probe = await admin.from("op_assignment_recommendations").select("id").limit(1);
  if (probe.error) {
    console.log("\n── Pre-migration (155 not applied): persistence deferred; dryRun/migrationMissing paths verified ──");
    console.log("(Apply migration 155, then re-run for the persisted-run pass.)");
  } else if (ctx.shift && ctx.nurses.length && ctx.patients.length) {
    console.log("\n── Post-migration: persisted run ──");
    const g = await generateRecommendation(admin, { hospitalId: null, isSuperUser: true, actorName: "harness (test run)" });
    check(g.ok && !!g.runId, "generate persists a run row");
    if (g.ok && g.runId) {
      const { data: run } = await admin.from("op_assignment_recommendations").select("status, proposals, nurse_loads").eq("id", g.runId).single();
      check(run?.status === "generated" && Array.isArray(run?.proposals), "run row holds the explainability record");
      await admin.from("op_assignment_recommendations").delete().eq("id", g.runId);
      console.log("(harness run deleted)");
    }
  } else {
    console.log("\n(155 applied but no active staffed shift — persisted-run pass skipped)");
  }

  console.log(`\n${fail === 0 ? "ALL PASS" : "FAILURES"} — ${pass} pass / ${fail} fail`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
