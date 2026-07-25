// ============================================================================
// CLINICAL INDICATORS SEED (UMG-QS-008) — a realistic clinical-quality indicator
// set for the AMU ward so the Clinical Indicators Centre renders authentic data.
// Categories are modelled as quality_objects (the schema's grouping); each holds
// named clinical indicators (CLABSI, hand hygiene, pressure injury, falls, med
// errors, handover, EWS, readmission, …) with targets/escalation/direction and
// six months of monthly measurements (Dec 2025 → May 2026) trending to a current
// value. Idempotent (upsert on code; measurements delete-then-insert).
// Run:  node scripts/seed-clinical-indicators.mjs --confirm
// ============================================================================
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

if (!process.argv.includes("--confirm")) { console.error("WRITES to the DB in .env.local. Re-run with --confirm."); process.exit(1); }
const env = { ...process.env };
if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
  const envUrl = new URL("../.env.local", import.meta.url);
  let raw; try { raw = readFileSync(envUrl, "utf8"); } catch (e) { console.error(`Could not read .env.local (${e.message})`); process.exit(1); }
  for (const line of raw.split(/\r?\n/)) { const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/); if (m && env[m[1]] === undefined) env[m[1]] = m[2].replace(/^["']|["']$/g, ""); }
}
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const { data: cohort } = await db.from("profiles").select("hospital_id").ilike("email", "%@amu.competen.demo");
const H = cohort?.find((p) => p.hospital_id)?.hospital_id;
if (!H) { console.error("No AMU cohort — run scripts/seed-cohort.mjs --confirm first."); process.exit(1); }
console.log(`AMU hospital: ${H}\n`);

// [category, [ indicators: code, name, unit, direction, target, escalation, latest, from ] ]
const L = "lower_is_better", G = "higher_is_better";
// [cat, [code, name, unit, direction, target, escalation, latest, from]] — a realistic mostly-healthy ward:
// ~19 on target, a minority (infection control, pressure injury, handover, training, documentation) below.
const CATS = [
  ["outcome", "Outcome Indicators", [
    ["OUT-READM", "30-Day Readmission Rate", "percent", L, 8, 12, 7.2, 9.0],
    ["OUT-MORT", "In-Hospital Mortality Rate", "percent", L, 2, 4, 1.8, 2.5],
    ["OUT-LOS", "Average Length of Stay", "days", L, 5, 7, 4.7, 5.6],
    ["OUT-ICU", "Unplanned ICU Transfer Rate", "rate_per_1000", L, 5, 10, 4.5, 6.2],
  ]],
  ["infection", "Infection Indicators", [
    ["INF-CLABSI", "CLABSI Rate", "rate_per_1000", L, 0.5, 1.0, 0.8, 1.1],
    ["INF-CAUTI", "CAUTI Rate", "rate_per_1000", L, 0.8, 1.2, 1.1, 1.3],
    ["INF-HH", "Hand Hygiene Compliance", "percent", G, 90, 80, 72, 68],
    ["INF-SSI", "Surgical Site Infection Rate", "rate_per_1000", L, 1.0, 2.0, 0.9, 1.4],
    ["INF-VAP", "Ventilator-Associated Pneumonia Rate", "rate_per_1000", L, 1.0, 2.0, 0.8, 1.1],
  ]],
  ["nursing", "Nursing Sensitive Indicators", [
    ["NRS-PI", "Pressure Injury Rate", "rate_per_1000", L, 0.5, 1.0, 1.4, 1.2],
    ["NRS-FALL", "Falls with Injury Rate", "rate_per_1000", L, 0.6, 1.0, 0.9, 1.0],
    ["NRS-MAA", "Medication Administration Accuracy", "percent", G, 98, 95, 98.4, 96],
    ["NRS-REST", "Restraint Use Rate", "rate_per_1000", L, 1.0, 2.0, 0.6, 0.9],
  ]],
  ["process", "Process Indicators", [
    ["PRC-HAND", "Handover Compliance", "percent", G, 90, 80, 74, 70],
    ["PRC-EWS", "Early Warning Score Compliance", "percent", G, 90, 80, 91, 84],
    ["PRC-PAIN", "Pain Assessment Compliance", "percent", G, 90, 80, 92, 86],
    ["PRC-DBN", "Discharge Before Noon", "percent", G, 60, 40, 41, 38],
    ["PRC-VTE", "VTE Prophylaxis Compliance", "percent", G, 95, 85, 96, 89],
    ["PRC-SEP", "Sepsis Bundle Compliance", "percent", G, 90, 80, 91, 83],
  ]],
  ["medication", "Medication Indicators", [
    ["MED-ERR", "Medication Errors (Total)", "rate_per_1000", L, 1.0, 2.0, 1.9, 1.6],
    ["MED-DBL", "High-Alert Med Double-Check", "percent", G, 100, 95, 100, 97],
    ["MED-ABX", "Antibiotic Stewardship Compliance", "percent", G, 90, 80, 91, 84],
  ]],
  ["experience", "Patient Experience Indicators", [
    ["EXP-SAT", "Patient Satisfaction Score", "percent", G, 90, 80, 91, 85],
    ["EXP-COMP", "Complaint Rate", "rate_per_1000", L, 2, 4, 1.8, 2.6],
    ["EXP-COMM", "Communication Score", "percent", G, 85, 75, 87, 82],
  ]],
  ["operational", "Operational Indicators", [
    ["OPS-OCC", "Bed Occupancy Rate", "percent", L, 85, 92, 88, 86],
    ["OPS-DSUM", "Discharge Summary Timeliness", "percent", G, 90, 80, 91, 84],
    ["OPS-THEA", "Theatre Utilisation", "percent", G, 85, 75, 87, 82],
  ]],
  ["compliance", "Compliance Indicators", [
    ["CMP-TRAIN", "Mandatory Training Compliance", "percent", G, 95, 85, 69, 65],
    ["CMP-DOC", "Documentation Audit Compliance", "percent", G, 90, 80, 68, 64],
  ]],
];
const PERIODS = ["2025-12-01", "2026-01-01", "2026-02-01", "2026-03-01", "2026-04-01", "2026-05-01"];

// Upsert category objects.
const objRows = CATS.map(([code, title]) => ({ code: `QO-AMU-${code.toUpperCase()}`, title, hospital_id: H, status: "active" }));
await db.from("quality_objects").upsert(objRows, { onConflict: "code" });
const { data: objs } = await db.from("quality_objects").select("id, code").in("code", objRows.map((o) => o.code));
const objId = new Map(objs.map((o) => [o.code, o.id]));

// Upsert indicators.
const indRows = [];
for (const [ccode, , inds] of CATS) for (const [code, name, unit, direction, target, esc] of inds)
  indRows.push({ code, name, unit, direction, target_value: target, escalation_value: esc, frequency: "monthly", is_active: true, quality_object_id: objId.get(`QO-AMU-${ccode.toUpperCase()}`) });
await db.from("quality_indicators").upsert(indRows, { onConflict: "code" });
const { data: indDb } = await db.from("quality_indicators").select("id, code").in("code", indRows.map((i) => i.code));
const indId = new Map(indDb.map((i) => [i.code, i.id]));

// Measurements: 6 monthly points interpolated from `from` → `latest` with a mild wobble; delete-then-insert.
const dp = (u) => (u === "percent" ? 0 : 1);
const meas = [];
for (const [, , inds] of CATS) for (const [code, , unit, , , , latest, from] of inds) {
  const id = indId.get(code);
  PERIODS.forEach((period, s) => {
    const base = from + (latest - from) * (s / (PERIODS.length - 1));
    const wob = ((s % 2 ? 1 : -1) * Math.abs(latest - from || 1) * 0.04);
    const value = Math.max(0, Number((base + (s === PERIODS.length - 1 ? 0 : wob)).toFixed(dp(unit) + (unit === "percent" ? 1 : 1))));
    const denominator = unit === "percent" ? 250 : 1000;
    meas.push({ indicator_id: id, hospital_id: H, period, value, denominator, numerator: Number(((value / (unit === "percent" ? 100 : 1000)) * denominator).toFixed(1)) });
  });
}
await db.from("indicator_measurements").delete().in("indicator_id", [...indId.values()]);
const { error: mErr } = await db.from("indicator_measurements").insert(meas);
if (mErr) console.error("measurements:", mErr.message);

console.log(`Seeded ${objRows.length} categories · ${indRows.length} indicators · ${meas.length} measurements for AMU.`);
console.log("Clinical Indicators Centre: /unit-manager/quality/indicators (sign in as the AMU manager).");
