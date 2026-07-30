// One-off harness for the Acuity & Workload engine (migration 153). Exercises
// the SHIPPED lib (@/lib/hww/assessments):
//   1. computeAcuity — sums, bands, guard rails (pure)
//   2. computeWorkload — NAS weighting sums, exclusivity, and the external
//      validity check: selecting every maximal item must equal the PUBLISHED
//      NAS maximum of 176.8 (Miranda 2003)
//   3. isSignificantChange rules
//   4. Post-migration: recordAcuity/recordWorkload on a real patient — row
//      written, op_patients.acuity_level synced, significant-change detection,
//      nurse aggregate; originals restored + harness rows deleted.
//   npx --yes tsx scripts/hww-assessments-harness.ts
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
  const {
    computeAcuity, computeWorkload, isSignificantChange, acuityLevelFor,
    NAS_ITEMS, recordAcuity, recordWorkload, nurseWorkloadAggregate,
  } = await import("../src/lib/hww/assessments");

  // ── 1. Acuity engine (pure) ──
  console.log("── computeAcuity ──");
  const wardAll1 = { airway_breathing: 1, circulation: 1, neuro: 1, mobility: 1, nutrition_elimination: 1, psychosocial: 1 };
  let r = computeAcuity("ward", wardAll1);
  check(r.score === 6 && r.level === "moderate" && r.errors.length === 0, "ward all-1s → 6 moderate", `${r.score} ${r.level}`);
  r = computeAcuity("icu", { respiratory: 3, cardiovascular: 3, neuro: 3, renal: 3, infection: 3, devices: 3 });
  check(r.score === 18 && r.level === "critical", "icu all-3s → 18 critical");
  r = computeAcuity("ward", { ...wardAll1, airway_breathing: 7 });
  check(r.errors.length === 1, "domain value 7 rejected");
  r = computeAcuity("ward", { ...wardAll1, invented: 2 });
  check(r.errors.some(e => /unknown domains/.test(e)), "unknown domain rejected");
  r = computeAcuity("picu", wardAll1);
  check(r.errors.length === 1, "unknown framework rejected");
  check(acuityLevelFor(4) === "stable" && acuityLevelFor(5) === "moderate" && acuityLevelFor(13) === "high" && acuityLevelFor(14) === "critical", "band edges 4/5/13/14");

  // ── 2. Workload engine (pure) ──
  console.log("\n── computeWorkload ──");
  let w = computeWorkload("nas", ["1b", "4a", "6a", "7a", "8a"]);
  check(Math.abs(w.score - 29.9) < 0.01, "NAS 1b+4a+6a+7a+8a = 29.9", `${w.score}`);
  w = computeWorkload("nas", ["1a", "1b"]);
  check(w.errors.some(e => /mutually exclusive/.test(e)), "1a+1b exclusivity enforced");
  w = computeWorkload("nas", ["99"]);
  check(w.errors.some(e => /unknown item/.test(e)), "unknown item rejected");
  w = computeWorkload("nas", []);
  check(w.errors.length === 1, "empty selection rejected");
  // External validity: max of each exclusive group + every single = published 176.8.
  const maxSel = ["1c", "4c", "6c", "7b", "8c", ...NAS_ITEMS.filter((i: any) => !i.group).map((i: any) => i.key)];
  w = computeWorkload("nas", maxSel);
  check(Math.abs(w.score - 176.8) < 0.01, "NAS maximum equals published 176.8", `${w.score}`);
  w = computeWorkload("ward", ["adl_full", "obs_2h", "one_to_one"]);
  check(Math.abs(w.score - 60) < 0.01, "ward components sum (20+15+25=60)", `${w.score}`);

  // ── 3. Significant-change rules ──
  console.log("\n── isSignificantChange ──");
  check(isSignificantChange(10, "high", null, null) === false, "no prior → not significant");
  check(isSignificantChange(12, "high", 8, "moderate") === true, "Δ4 → significant");
  check(isSignificantChange(8, "moderate", 6, "moderate") === false, "Δ2 same level → not significant");
  check(isSignificantChange(10, "high", 9, "moderate") === true, "Δ1 with level change → significant");

  // ── 4. Store-backed lifecycle ──
  const probe = await admin.from("op_acuity_assessments").select("id").limit(1);
  if (probe.error) {
    console.log("\n── Pre-migration (153 not applied): compute engines verified; lifecycle deferred ──");
    console.log("(Apply migration 153, then re-run for the full lifecycle pass.)");
  } else {
    console.log("\n── Post-migration: lifecycle on a real patient ──");
    // A real assigned nurse+patient pair exercises the aggregate honestly.
    const { data: asg } = await admin.from("op_patient_assignments")
      .select("staff_id, patient_id, op_patients!patient_id(id, label, acuity_level, hospital_id)")
      .eq("status", "active").limit(1).maybeSingle();
    const patient = (asg as any)?.op_patients;
    const nurseId = (asg as any)?.staff_id;
    if (!patient) { console.log("No active assignments — cannot exercise lifecycle."); process.exit(fail ? 1 : 0); }
    const originalLevel = patient.acuity_level;

    // First assessment: low score.
    const a1 = await recordAcuity(admin, { patientId: patient.id, framework: "ward", domains: { airway_breathing: 0, circulation: 1, neuro: 0, mobility: 1, nutrition_elimination: 0, psychosocial: 0 }, assessedBy: nurseId, assessedByName: "harness (test run)", notes: "harness test — safe to delete" });
    check(a1.ok, "first acuity recorded", a1.ok ? `score ${a1.assessment.score}` : (a1 as any).error);
    if (a1.ok) {
      check(a1.assessment.score === 2 && a1.assessment.level === "stable", "score/level computed server-side (2 stable)");
      check(a1.significant === false, "first assessment never significant");
      const { data: pNow } = await admin.from("op_patients").select("acuity_level").eq("id", patient.id).single();
      check(pNow?.acuity_level === "stable", "op_patients.acuity_level synced", `${pNow?.acuity_level}`);
    }
    // Second: big jump → significant + previous_score wired.
    const a2 = await recordAcuity(admin, { patientId: patient.id, framework: "ward", domains: { airway_breathing: 2, circulation: 2, neuro: 2, mobility: 2, nutrition_elimination: 2, psychosocial: 2 }, assessedBy: nurseId, assessedByName: "harness (test run)", notes: "harness test — safe to delete" });
    check(a2.ok && a2.assessment.score === 12 && a2.assessment.level === "high", "reassessment 12 high");
    check(a2.ok && a2.assessment.previous_score === 2, "previous_score carried", a2.ok ? `${a2.assessment.previous_score}` : "");
    check(a2.ok && a2.significant === true, "Δ10 + level change → significant");

    // Workload: record NAS, aggregate reflects it for the assigned nurse.
    const w1 = await recordWorkload(admin, { patientId: patient.id, framework: "nas", items: ["1b", "4a", "6a", "7a", "8a"], assessedBy: nurseId, assessedByName: "harness (test run)", notes: "harness test — safe to delete" });
    check(w1.ok && Math.abs(Number(w1.assessment.percentage) - 29.9) < 0.01, "workload recorded at 29.9%");
    const agg = await nurseWorkloadAggregate(admin, nurseId);
    check(agg.perPatient.some(p => p.patient_id === patient.id && Math.abs(p.percentage - 29.9) < 0.01), "nurse aggregate includes latest per-patient value", `total ${agg.total}%`);

    // Guard: recording against an invented patient fails 404.
    const bad = await recordAcuity(admin, { patientId: "00000000-0000-0000-0000-00000000dead", framework: "ward", domains: wardAll1 });
    check(!bad.ok && (bad as any).status === 404, "invented patient rejected 404");

    // Cleanup: delete harness rows, restore the patient's original level.
    await admin.from("op_acuity_assessments").delete().eq("patient_id", patient.id).ilike("notes", "%harness test%");
    await admin.from("op_workload_assessments").delete().eq("patient_id", patient.id).ilike("notes", "%harness test%");
    await admin.from("op_patients").update({ acuity_level: originalLevel }).eq("id", patient.id);
    console.log(`(harness rows deleted; ${patient.label} acuity restored to ${originalLevel})`);
  }

  console.log(`\n${fail === 0 ? "ALL PASS" : "FAILURES"} — ${pass} pass / ${fail} fail`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
