// One-off harness for the v2 assessment instruments (migration 157).
// Exercises the SHIPPED libs (@/lib/hww/instruments + assessments):
//   1. PEWS classification matrix incl. the category-3 special trigger
//   2. Ward 12-domain workload sums, W-band edges, modifiers, guards
//   3. CIAF composite weights, inversion, component caps, A-band edges
//   4. NAS I-levels, override validation, tool resolution
//   5. Post-157 live: record PEWS + ward12 on a real ward patient (spine sync,
//      classification/reassess_by persisted, override stored, wrong-tool 409)
//      — originals restored, rows deleted.
//   npx --yes tsx scripts/hww-instruments-harness.ts
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
    classifyPews, computePews, computeWard12, computeCiaf, levelFromBands, validateOverride,
    resolveUnitType, TOOLSET, I_LEVELS, W_LEVELS, AACN_CHARACTERISTICS,
  } = await import("../src/lib/hww/instruments");
  const { recordAcuity, recordWorkload, validateToolForPatient } = await import("../src/lib/hww/assessments");

  // ── 1. PEWS ──
  console.log("── PEWS classification ──");
  const bandKeys = [0, 1, 2, 3, 4, 5, 10, 15].map(n => classifyPews(n, false).key).join(",");
  check(bandKeys === "white,white,light_green,yellow,orange,red,red,red", "matrix bands 0-15", bandKeys);
  check(classifyPews(1, true).key === "red", "category-3 trigger forces red at total 1");
  check(classifyPews(0, false).reassessMinutes === 240 && classifyPews(4, false).reassessMinutes === 60 && classifyPews(7, false).reassessMinutes === 30, "reassessment intervals by band");
  check(classifyPews(3, false).spine === "moderate" && classifyPews(4, false).spine === "high" && classifyPews(6, false).spine === "critical", "spine mapping");
  check(computePews({ total: 16 }).errors.length === 1 && computePews({ total: -1 }).errors.length === 1 && computePews({ total: "x" }).errors.length === 1, "totals outside 0-15 rejected");

  // ── 2. Ward 12-domain workload ──
  console.log("\n── Ward 12-domain workload ──");
  const zeros = Object.fromEntries(["clinical_stability", "observation_frequency", "respiratory", "neurological", "circulation", "mobility_adl", "nutrition", "medication_complexity", "devices_wounds", "ipc_isolation", "communication_family", "coordination"].map(k => [k, 0]));
  const threes = Object.fromEntries(Object.keys(zeros).map(k => [k, 3]));
  let w = computeWard12({ domains: zeros });
  check(w.score === 0 && w.level === "W1" && w.ratio === "1:6", "all-zeros -> 0, W1 1:6");
  w = computeWard12({ domains: threes });
  check(w.score === 36 && w.level === "W5" && w.ratio === "1:2", "all-3s -> 36, W5 1:2");
  w = computeWard12({ domains: { ...zeros, respiratory: 3, clinical_stability: 2, observation_frequency: 2 }, modifiers: ["new_admission", "isolation"] });
  check(w.base === 7 && w.modifierPoints === 3 && w.score === 10 && w.level === "W2", "domains 7 + modifiers 3 -> 10 W2", `${w.base}+${w.modifierPoints}`);
  const wEdges = [7, 8, 14, 15, 22, 23, 30, 31].map(s => levelFromBands(s, W_LEVELS).level).join(",");
  check(wEdges === "W1,W2,W2,W3,W3,W4,W4,W5", "W band edges 7/8 14/15 22/23 30/31", wEdges);
  check(computeWard12({ domains: { ...zeros, invented: 1 } }).errors.length === 1, "unknown domain rejected");
  check(computeWard12({ domains: zeros, modifiers: ["warp"] }).errors.length === 1, "unknown modifier rejected");
  check(computeWard12({ domains: { ...zeros, respiratory: 4 } }).errors.length === 1, "domain value 4 rejected");

  // ── 3. CIAF composite ──
  console.log("\n── CIAF composite ──");
  const aacnBest = Object.fromEntries(AACN_CHARACTERISTICS.map((c: any) => [c.key, 5]));
  const aacnWorst = Object.fromEntries(AACN_CHARACTERISTICS.map((c: any) => [c.key, 1]));
  let ci = computeCiaf({ aacn: aacnBest, rass: 0, cam: "negative" });
  check(ci.score === 0 && ci.level === "A1" && ci.ratio === "1:3", "most-stable patient -> 0, A1 1:3", `${ci.score}`);
  ci = computeCiaf({ aacn: aacnWorst, rass: 0, cam: "negative" });
  check(ci.components.aacn === 50, "AACN inversion: all-1s (most compromised) -> 50/50", `${ci.components.aacn}`);
  ci = computeCiaf({ aacn: aacnWorst, rass: -5, cam: "positive", organ_supports: ["invasive_ventilation", "vasoactive_multiple", "crrt", "ecmo"], risk_modifiers: ["post_arrest", "massive_transfusion", "severe_sepsis", "recent_deterioration"] });
  check(ci.score === 100 && ci.level === "A5", "everything-maxed -> exactly 100, A5 (caps hold)", `${ci.score} neuro=${ci.components.neuro} organ=${ci.components.organ} risk=${ci.components.risk}`);
  check(ci.components.neuro === 20 && ci.components.organ === 20 && ci.components.risk === 10, "component caps: neuro 20, organ 20, risk 10");
  const { A_LEVELS } = await import("../src/lib/hww/instruments");
  const aB = [10, 11, 20, 21, 30, 31, 40, 41].map(s => levelFromBands(s, A_LEVELS).level).join(",");
  check(aB === "A1,A2,A2,A3,A3,A4,A4,A5", "A band edges 10/11 20/21 30/31 40/41", aB);
  check(ci.spineLevel === "critical", "A5 maps to critical on the spine");
  check(computeCiaf({ aacn: aacnBest, rass: 9, cam: "negative" }).errors.length === 1, "invalid RASS rejected");
  check(computeCiaf({ aacn: aacnBest, rass: 0, cam: "maybe" }).errors.length === 1, "invalid CAM rejected");
  check(computeCiaf({ aacn: aacnBest, rass: 0, cam: "negative", organ_supports: ["warp_drive"] }).errors.length === 1, "unknown organ support rejected");

  // ── 4. NAS I-levels + overrides + resolution ──
  console.log("\n── NAS levels, overrides, resolution ──");
  const iB = [0, 20, 21, 40, 41, 60, 61, 80, 81, 176].map(s => levelFromBands(s, I_LEVELS).level).join(",");
  check(iB === "I1,I1,I2,I2,I3,I3,I4,I4,I5,I5", "I band edges", iB);
  check(validateOverride(W_LEVELS, "W9", "x").length === 1, "invalid override level rejected");
  check(validateOverride(W_LEVELS, "W3", "").length === 1, "override without reason rejected");
  check(validateOverride(W_LEVELS, "W3", "clinical judgement").length === 0 && validateOverride(W_LEVELS, "", "").length === 0, "valid override / no override pass");
  check(resolveUnitType("critical_care") === "icu" && resolveUnitType("standard") === "ward" && resolveUnitType(null) === "ward", "unit resolution by bed type");
  check(TOOLSET.ward.acuity === "pews" && TOOLSET.ward.workload === "ward12" && TOOLSET.icu.acuity === "ciaf" && TOOLSET.icu.workload === "nas", "resolved toolsets per unit type");

  // ── 5. Live (157 applied): record + validate on a real ward patient ──
  const probe = await admin.from("op_acuity_assessments").select("id, classification").limit(1);
  if (probe.error) {
    console.log("\n(157 not applied — live phase skipped.)");
  } else {
    console.log("\n── Live: real ward patient ──");
    const { data: asg } = await admin.from("op_patient_assignments")
      .select("staff_id, op_patients!patient_id(id, label, acuity_level, hospital_id, op_beds!bed_id(bed_type))")
      .eq("status", "active").limit(20);
    const wardAsg = ((asg ?? []) as any[]).find(a => a.op_patients && a.op_patients.op_beds?.bed_type !== "critical_care");
    if (!wardAsg) { console.log("(no active ward assignment — live phase skipped)"); }
    else {
      const patient = wardAsg.op_patients;
      const originalLevel = patient.acuity_level;

      const v = await validateToolForPatient(admin, patient.id, "acuity", "ciaf");
      check(!v.ok && (v as any).status === 409 && /Ward PEWS/.test((v as any).error), "CIAF on a ward patient -> 409 naming Ward PEWS", (v as any).error);
      const v2 = await validateToolForPatient(admin, patient.id, "workload", "ward");
      check(!v2.ok && (v2 as any).status === 409, "legacy 'ward' checkbox tool -> 409 (ward12 resolved)");

      let r: any = await recordAcuity(admin, { patientId: patient.id, framework: "pews", payload: { total: 4, category3: false }, assessedBy: wardAsg.staff_id, assessedByName: "harness (test run)", notes: "harness test — safe to delete" });
      check(r.ok === true && r.assessment.classification === "orange" && r.assessment.level === "high", "PEWS 4 -> orange, spine high", r.ok ? r.assessment.classification : r.error);
      check(r.ok && !!r.assessment.reassess_by, "reassess_by stamped from the band interval");
      const { data: pNow } = await admin.from("op_patients").select("acuity_level").eq("id", patient.id).single();
      check(pNow?.acuity_level === "high", "op_patients spine synced to high");
      r = await recordAcuity(admin, { patientId: patient.id, framework: "pews", payload: { total: 2, category3: true }, assessedBy: wardAsg.staff_id, assessedByName: "harness (test run)", notes: "harness test — safe to delete" });
      check(r.ok && r.assessment.classification === "red" && r.assessment.category3 === true && r.assessment.level === "critical", "category-3 persisted and forces red/critical");
      check(r.ok && r.significant === true, "orange -> red flagged significant");

      const zerosD = Object.fromEntries(Object.keys(zeros).map(k => [k, 0]));
      let wr: any = await recordWorkload(admin, { patientId: patient.id, framework: "ward12", payload: { domains: { ...zerosD, respiratory: 3, clinical_stability: 3, observation_frequency: 3, medication_complexity: 3, devices_wounds: 3 }, modifiers: ["continuous_observation"] }, overrideLevel: "W5", overrideReason: "", assessedBy: wardAsg.staff_id });
      check(!wr.ok && wr.status === 400, "override without reason rejected on record");
      wr = await recordWorkload(admin, { patientId: patient.id, framework: "ward12", payload: { domains: { ...zerosD, respiratory: 3, clinical_stability: 3, observation_frequency: 3, medication_complexity: 3, devices_wounds: 3 }, modifiers: ["continuous_observation"] }, overrideLevel: "W5", overrideReason: "1:1 special required (harness)", assessedBy: wardAsg.staff_id, assessedByName: "harness (test run)", notes: "harness test — safe to delete" });
      check(wr.ok === true && wr.assessment.level === "W3" && wr.assessment.override_level === "W5", "ward12 17 pts -> W3 computed, W5 override stored", wr.ok ? `${wr.assessment.score}pts` : wr.error);
      check(wr.ok && wr.assessment.ratio === "1:4", "computed ratio stored (1:4 for W3)");

      // Cleanup + restore.
      await admin.from("op_acuity_assessments").delete().eq("patient_id", patient.id).ilike("notes", "%harness test%");
      await admin.from("op_workload_assessments").delete().eq("patient_id", patient.id).ilike("notes", "%harness test%");
      await admin.from("op_patients").update({ acuity_level: originalLevel }).eq("id", patient.id);
      console.log(`(harness rows deleted; ${patient.label} acuity restored to ${originalLevel})`);
    }
  }

  console.log(`\n${fail === 0 ? "ALL PASS" : "FAILURES"} — ${pass} pass / ${fail} fail`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
