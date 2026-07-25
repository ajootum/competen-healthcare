// ============================================================================
// OPERATIONAL PERFORMANCE SEED (UMW-OPC-000) — a realistic multi-ward operational
// picture for the AMU hospital so the Operational Performance & Capacity dashboard
// renders authentic data: 75 beds across 6 wards (statuses matched to the mockup),
// flow blockers (bottlenecks + discharge-delay reasons), equipment (100 items),
// resources (theatres/rooms/transport/wheelchairs), and monthly + daily ops
// snapshots (occupancy/LOS/admissions/discharges/escalation/capacity/FTE/top
// metrics) so KPIs, month-over-month deltas and trends are real.
// Idempotent (clears AMU rows first). Run:  node scripts/seed-ops-performance.mjs --confirm
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
let _s = 20260720; const rnd = () => { _s = (_s * 1103515245 + 12345) & 0x7fffffff; return _s / 0x7fffffff; };

// ── Beds: 75 across 6 wards, 62 occupied / 8 available / 3 blocked / 2 cleaning ──
const WARDS = [["Neuro Ward", 18, 16, "standard"], ["T-Ward", 20, 16, "standard"], ["ICU", 12, 11, "critical_care"], ["HDU", 6, 5, "critical_care"], ["Isolation", 4, 3, "isolation"], ["Day Care", 15, 11, "standard"]];
const NONOCC = [...Array(8).fill("available"), ...Array(3).fill("out_of_service"), ...Array(2).fill("cleaning")]; // 13
let np = 0; const beds = [];
for (const [ward, total, occ, bt] of WARDS) {
  for (let i = 0; i < total; i++) { const status = i < occ ? "occupied" : NONOCC[np++] ?? "available"; beds.push({ hospital_id: H, label: `${ward} ${String(i + 1).padStart(2, "0")}`, bed_type: bt, status }); }
}
await db.from("op_beds").delete().eq("hospital_id", H);
{ const { error } = await db.from("op_beds").insert(beds); if (error) { console.error("beds:", error.message); process.exit(1); } }

// ── Flow blockers: bottlenecks + discharge-delay reasons (33 open) ──
const BLK = [["discharge_meds", "Discharge delayed >24h", 12], ["transport", "Awaiting transport", 7], ["medical_review", "Awaiting specialist review", 6], ["other", "Awaiting imaging", 5], ["no_bed", "Awaiting ICU bed", 3]];
const blockers = [];
for (const [category, detail, n] of BLK) for (let i = 0; i < n; i++) blockers.push({ hospital_id: H, category, detail, status: "open" });
await db.from("op_flow_blockers").delete().eq("hospital_id", H);
{ const { error } = await db.from("op_flow_blockers").insert(blockers); if (error) console.error("blockers:", error.message); }

// ── Equipment: 100 items (84 operational / 8 calibration due / 5 maintenance / 3 out) → 92% availability ──
const EQ_CATS = ["Monitoring", "Infusion", "Ventilation", "Imaging", "Diagnostics", "Mobility"];
const EQ = [...Array(84).fill("operational"), ...Array(8).fill("calibration_due"), ...Array(5).fill("under_maintenance"), ...Array(3).fill("out_of_service")];
const equipment = EQ.map((status, i) => ({ hospital_id: H, name: `${EQ_CATS[i % EQ_CATS.length]} Unit ${String(i + 1).padStart(3, "0")}`, category: EQ_CATS[i % EQ_CATS.length], status }));
await db.from("op_equipment").delete().eq("hospital_id", H);
{ const { error } = await db.from("op_equipment").insert(equipment); if (error) { console.error("equipment:", error.message, "(did you apply migration 101?)"); process.exit(1); } }

// ── Resources ──
const resources = [
  { hospital_id: H, name: "Operating Theatres", category: "theatre", total: 2, available: 2, demand: "available" },
  { hospital_id: H, name: "Procedure Rooms", category: "procedure_room", total: 3, available: 1, demand: "busy" },
  { hospital_id: H, name: "Treatment Rooms", category: "treatment_room", total: 6, available: 4, demand: "available" },
  { hospital_id: H, name: "Transport Requests", category: "transport", total: 6, available: 0, demand: "high" },
  { hospital_id: H, name: "Wheelchairs", category: "wheelchair", total: 12, available: 2, demand: "low" },
];
await db.from("op_resources").delete().eq("hospital_id", H);
{ const { error } = await db.from("op_resources").insert(resources); if (error) console.error("resources:", error.message); }

// ── Ops snapshots: monthly (KPIs + deltas + top metrics + FTE) + daily July (trend) ──
await db.from("op_ops_snapshots").delete().eq("hospital_id", H);
const monthly = [
  { period: "2026-06-01", occupancy_pct: 76, avg_los: 4.9, admissions: 127, discharges: 118, escalation_rate: 4.3, capacity_score: 73, avg_discharge_delay_hours: 13.4, bed_turnover: 1.62, discharge_before_noon_pct: 47, ed_boarding_hours: 29, readmission_rate: 3.8, theatre_utilisation: 71, required_fte: 46.5, available_fte: 35.4, vacant_fte: 7.6, agency_fte: 3.8, safe_staffing_score: 74 },
  { period: "2026-07-01", occupancy_pct: 82, avg_los: 4.3, admissions: 142, discharges: 128, escalation_rate: 3.2, capacity_score: 78, avg_discharge_delay_hours: 18.6, bed_turnover: 1.85, discharge_before_noon_pct: 52, ed_boarding_hours: 36, readmission_rate: 4.2, theatre_utilisation: 78, required_fte: 46.5, available_fte: 36.2, vacant_fte: 6.8, agency_fte: 3.5, safe_staffing_score: 78 },
].map(m => ({ hospital_id: H, period_type: "month", ...m }));
const daily = [];
for (let d = 1; d <= 25; d++) {
  const occ = Math.round((78 + Math.sin(d / 2) * 5 + rnd() * 3) * 10) / 10;
  const los = Math.round((4 + Math.sin(d / 3 + 1) * 0.7 + rnd() * 0.4) * 10) / 10;
  daily.push({ hospital_id: H, period: `2026-07-${String(d).padStart(2, "0")}`, period_type: "day", occupancy_pct: occ, avg_los: los, admissions: 4 + Math.floor(rnd() * 4), discharges: 3 + Math.floor(rnd() * 4), avg_discharge_delay_hours: Math.round((14 + d * 0.2 + rnd() * 4) * 10) / 10 });
}
{ const { error } = await db.from("op_ops_snapshots").insert([...monthly, ...daily]); if (error) { console.error("snapshots:", error.message); process.exit(1); } }

console.log(`Seeded: 75 beds (6 wards) · ${blockers.length} flow blockers · ${equipment.length} equipment · ${resources.length} resources · ${monthly.length} monthly + ${daily.length} daily snapshots for AMU.`);
console.log("Operational Performance dashboard: /unit-manager/operations (sign in as the AMU manager).");
