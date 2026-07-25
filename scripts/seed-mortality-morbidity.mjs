// ============================================================================
// MORTALITY & MORBIDITY SEED (UMG-QS-009) — a realistic M&M case register for the
// AMU ward so the M&M Centre renders authentic data. This month is shaped to the
// mockup (18 deaths across cause categories + preventability spread, ~55 morbidity
// of which 42 serious, contributory-factor mix, RCA/CAPA completion ratios); five
// prior months carry lighter counts so the rate trend has six points. Discharge
// denominators live in mm_period_stats so mortality/morbidity RATES are real.
// No PHI — opaque patient labels + age/sex only. Idempotent (clears AMU rows first).
// Run:  node scripts/seed-mortality-morbidity.mjs --confirm
// ============================================================================
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

if (!process.argv.includes("--confirm")) { console.error("WRITES to the DB in .env.local. Re-run with --confirm."); process.exit(1); }
const env = { ...process.env };
if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
  for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)) { const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/); if (m && env[m[1]] === undefined) env[m[1]] = m[2].replace(/^["']|["']$/g, ""); }
}
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const { data: cohort } = await db.from("profiles").select("hospital_id").ilike("email", "%@amu.competen.demo");
const H = cohort?.find((p) => p.hospital_id)?.hospital_id;
if (!H) { console.error("No AMU cohort — run scripts/seed-cohort.mjs --confirm first."); process.exit(1); }
console.log(`AMU hospital: ${H}\n`);

// Deterministic PRNG so re-runs are stable.
let _s = 20260520; const rnd = () => { _s = (_s * 1103515245 + 12345) & 0x7fffffff; return _s / 0x7fffffff; };
const pick = (a) => a[Math.floor(rnd() * a.length)];
const rep = (n, v) => Array.from({ length: n }, () => v);

const UNITS = ["ICU", "Neuro Ward", "Theatres", "AMU", "HDU"];
const SEX = ["M", "F"];
const PERIODS = ["2025-12-01", "2026-01-01", "2026-02-01", "2026-03-01", "2026-04-01", "2026-05-01"];
const day = (period, d) => `${period.slice(0, 8)}${String(d).padStart(2, "0")}`;

let mSeq = 171, bSeq = 194;               // ref counters (ascend to the mockup's latest refs)
const cases = []; const factors = [];      // factors reference case index; resolved to ids after insert

// ---- Current month (May 2026) mortality: 18, matched to the mockup ----
const CAUSES = [...rep(6, ["sepsis", "Sepsis / Septic Shock"]), ...rep(4, ["neurological", "Neurological Injury"]), ...rep(3, ["cardiorespiratory", "Cardiorespiratory Failure"]), ...rep(2, ["postoperative", "Post-operative Complications"]), ...rep(3, ["other", "Multi-organ Failure"])];
const PREV = [...rep(2, "definitely"), ...rep(3, "probably"), ...rep(4, "possibly"), ...rep(5, "probably_not"), ...rep(3, "not"), ...rep(1, "insufficient")];
const DIAG = { sepsis: "Sepsis", neurological: ["TBI Severe", "Meningitis", "Hydrocephalus", "Encephalitis"], cardiorespiratory: ["Cardiorespiratory Failure", "ARDS", "Acute MI"], postoperative: "Post-op Complication", other: ["Multi-organ Failure", "Hepatic Failure", "Renal Failure"] };
const named = [["Sepsis", "ICU", 7, "M"], ["TBI Severe", "Neuro Ward", 12, "F"], ["Meningitis", "ICU", 5, "M"], ["Post-op Comp.", "Theatres", 9, "F"], ["Hydrocephalus", "Neuro Ward", 14, "M"]];
for (let i = 0; i < 18; i++) {
  const [cc, causeLabel] = CAUSES[i];
  const rcaDone = i >= 3;                   // ~15/18 RCA complete ≈ 83%
  const capaReq = i % 4 !== 0;              // ~13/18 need CAPA
  const capaDone = capaReq && i >= 5;       // ~11/13 complete ≈ 78%
  // First 7 spread across review states (6 open + 1 closed at the named 5th case) → ~6 mortality pending; rest closed.
  const MST = ["rca_in_progress", "initial_review", "peer_review", "pending_capa", "closed", "initial_review", "rca_in_progress"];
  const status = i < MST.length ? MST[i] : "closed";
  const diagPool = DIAG[cc]; const diagnosis = named[i] ? named[i][0] : Array.isArray(diagPool) ? diagPool[i % diagPool.length] : diagPool;
  const idx = cases.length;
  cases.push({
    hospital_id: H, case_ref: `M-2026-0${mSeq + (17 - i)}`, case_type: "mortality",
    patient_ref: `P-0001${50 + (17 - i)}`, patient_age: named[i]?.[2] ?? 20 + Math.floor(rnd() * 60), patient_sex: named[i]?.[3] ?? pick(SEX),
    unit: named[i]?.[1] ?? pick(UNITS), event_date: day("2026-05-01", 20 - i), primary_diagnosis: diagnosis,
    cause_of_death: causeLabel, cause_category: cc, status, preventability: PREV[i],
    rca_required: true, rca_status: rcaDone ? "complete" : "in_progress",
    capa_required: capaReq, capa_status: capaDone ? "complete" : capaReq ? "in_progress" : "not_started",
    review_meeting_date: "2026-05-19",
  });
  // contributory factors — front-load to hit the top-6 mix (infection 9 / delay 7 / clinical 6 / comm 4 / resource 2 / doc 2)
  const fset = [...(i < 9 ? ["infection_sepsis"] : []), ...(i < 7 ? ["delay_diagnosis"] : []), ...(i < 6 ? ["clinical_decision"] : []), ...(i < 4 ? ["communication"] : []), ...(i < 2 ? ["resource_equipment"] : []), ...(i < 2 ? ["documentation"] : [])];
  for (const f of fset) factors.push([idx, f]);
}

// ---- Current month morbidity: ~55 (42 serious + 13 moderate), matched to the mockup ----
const EVENTS = ["Unplanned ICU Admission", "Medication Harm (Severe)", "Surgical Complication", "Severe Pressure Injury", "Severe Infection (CAUTI)", "Diagnostic Delay", "Hospital-Acquired Infection", "Adverse Drug Reaction", "Unplanned Return to Theatre", "Clinical Deterioration"];
const namedB = [["Unplanned ICU Admission", "ICU"], ["Medication Harm (Severe)", "Neuro Ward"], ["Surgical Complication", "Theatres"], ["Severe Pressure Injury", "Neuro Ward"], ["Severe Infection (CAUTI)", "ICU"]];
for (let i = 0; i < 55; i++) {
  const serious = i < 42;
  // First 7 spread across review states (6 open + 1 closed at the named 5th) → ~6 morbidity pending; rest closed.
  const BST = ["rca_in_progress", "initial_review", "peer_review", "pending_capa", "closed", "initial_review", "peer_review"];
  const status = i < BST.length ? BST[i] : "closed";
  cases.push({
    hospital_id: H, case_ref: `B-2026-0${bSeq + (18 - Math.min(i, 18))}`, case_type: "morbidity",
    patient_ref: `P-0002${String(10 + i).padStart(2, "0")}`, patient_age: 18 + Math.floor(rnd() * 60), patient_sex: pick(SEX),
    unit: namedB[i]?.[1] ?? pick(UNITS), event_date: day("2026-05-01", 20 - Math.min(i, 18)),
    event_type: namedB[i]?.[0] ?? pick(EVENTS), severity: serious ? "serious" : "moderate",
    status, rca_required: serious, rca_status: serious ? (i >= 8 ? "complete" : "in_progress") : "not_started",
    capa_required: serious && i % 3 === 0, capa_status: serious && i % 3 === 0 && i >= 6 ? "complete" : "not_started",
  });
}
// unique morbidity refs (the loop reused refs when capped) — renumber sequentially
cases.filter(c => c.case_type === "morbidity").forEach((c, j) => { c.case_ref = `B-2026-0${158 + j}`; });

// ---- Prior 5 months: lighter counts for the trend ----
for (const period of PERIODS.slice(0, 5)) {
  const deaths = 15 + Math.floor(rnd() * 5);          // 15–19
  const morb = 44 + Math.floor(rnd() * 12);           // 44–55
  const ym = period.slice(0, 4) + period.slice(5, 7); // e.g. 202601 — distinct ref namespace from current month
  for (let i = 0; i < deaths; i++) { const [cc, cl] = pick(CAUSES); cases.push({ hospital_id: H, case_ref: `M-${ym}-${String(i).padStart(3, "0")}`, case_type: "mortality", patient_ref: `P-P${period.slice(5, 7)}${i}`, patient_age: 20 + Math.floor(rnd() * 60), patient_sex: pick(SEX), unit: pick(UNITS), event_date: day(period, 1 + Math.floor(rnd() * 26)), primary_diagnosis: cl, cause_of_death: cl, cause_category: cc, status: "closed", preventability: pick(PREV), rca_required: true, rca_status: "complete", capa_required: rnd() > 0.4, capa_status: "complete" }); }
  for (let i = 0; i < morb; i++) { cases.push({ hospital_id: H, case_ref: `B-${ym}-${String(i).padStart(3, "0")}`, case_type: "morbidity", patient_ref: `P-Q${period.slice(5, 7)}${i}`, patient_age: 18 + Math.floor(rnd() * 60), patient_sex: pick(SEX), unit: pick(UNITS), event_date: day(period, 1 + Math.floor(rnd() * 26)), event_type: pick(EVENTS), severity: i < morb * 0.75 ? "serious" : "moderate", status: "closed", rca_required: false, rca_status: "not_started", capa_required: false, capa_status: "not_started" }); }
}

// ---- Write ----
await db.from("mm_cases").delete().eq("hospital_id", H);
await db.from("mm_period_stats").delete().eq("hospital_id", H);
await db.from("mm_period_stats").insert(PERIODS.map((period, s) => ({ hospital_id: H, period, discharges: 8300 + s * 60 + Math.floor(rnd() * 200), admissions: 8600 + s * 55 })));

// insert cases in chunks, capturing ids for factor linkage (only current-month indices matter)
const currentCount = cases.filter((_, i) => i < 18 + 55).length;
const idByIndex = [];
for (let i = 0; i < cases.length; i += 200) {
  const chunk = cases.slice(i, i + 200);
  const { data, error } = await db.from("mm_cases").insert(chunk).select("id");
  if (error) { console.error("cases:", error.message); process.exit(1); }
  data.forEach((r, j) => { idByIndex[i + j] = r.id; });
}
const factorRows = factors.filter(([idx]) => idx < currentCount).map(([idx, factor]) => ({ case_id: idByIndex[idx], factor }));
if (factorRows.length) { const { error } = await db.from("mm_contributory_factors").insert(factorRows); if (error) console.error("factors:", error.message); }

console.log(`Seeded ${cases.length} cases (${cases.filter(c => c.case_type === "mortality").length} mortality / ${cases.filter(c => c.case_type === "morbidity").length} morbidity), ${factorRows.length} contributory factors, ${PERIODS.length} period-stats for AMU.`);
console.log("Mortality & Morbidity Centre: /unit-manager/quality/mortality (sign in as the AMU manager).");
