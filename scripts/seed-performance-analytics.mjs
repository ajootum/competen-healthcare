// Seed the UMW Performance Analytics stores (migration 108) for the AMU demo hospital: 6 balanced-scorecard
// perspectives, ~36 KPIs across every perspective (with 13-month trend series + 5 benchmarks each), financial cost
// centres, improvement projects, executive reports and AI predictions/recommendations. KPIs whose snapshot_field maps
// to op_ops_snapshots resolve LIVE at load time; seeded current_value is the fallback. Idempotent. Run:
//   node scripts/seed-performance-analytics.mjs
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
const env = { ...process.env };
if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) { for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)) { const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/); if (m && env[m[1]] === undefined) env[m[1]] = m[2].replace(/^["']|["']$/g, ""); } }
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const ins = async (t, rows) => { const { data, error } = await db.from(t).insert(rows).select(); if (error) { console.error(`${t}:`, error.message); process.exit(1); } return data; };

const H = (await db.from("profiles").select("hospital_id").ilike("email", "%@amu.competen.demo").limit(50)).data?.find((p) => p.hospital_id)?.hospital_id;
if (!H) { console.error("No AMU hospital."); process.exit(1); }
const profs = (await db.from("profiles").select("id").eq("hospital_id", H).limit(6)).data ?? [];
const owner = (i) => profs[i % Math.max(1, profs.length)]?.id ?? null;
const monthStart = (back) => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - back); return d.toISOString().slice(0, 10); };
const dPlus = (days) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
const round = (n, dp = 1) => Math.round(n * 10 ** dp) / 10 ** dp;

// Reset (FK order).
for (const t of ["pa_predictions", "pa_reports", "pa_cost_centres", "pa_improvement_projects", "pa_benchmarks", "pa_kpi_values", "pa_kpis", "pa_perspectives"]) await db.from(t).delete().eq("hospital_id", H).then((r) => r, () => {});
// pa_kpi_values / pa_benchmarks have no hospital_id — cleared via cascade on pa_kpis delete above.

// ── Perspectives ──
const P = await ins("pa_perspectives", [
  { hospital_id: H, name: "Clinical Quality", color: "#22c55e", icon: "🩺", weight: 1.2, target_pct: 90, sort_order: 1 },
  { hospital_id: H, name: "Patient Experience", color: "#0ea5e9", icon: "😊", weight: 1, target_pct: 85, sort_order: 2 },
  { hospital_id: H, name: "Operations", color: "#f59e0b", icon: "⚙️", weight: 1, target_pct: 85, sort_order: 3 },
  { hospital_id: H, name: "Workforce", color: "#8b5cf6", icon: "👥", weight: 1, target_pct: 85, sort_order: 4 },
  { hospital_id: H, name: "Financial", color: "#ef4444", icon: "💷", weight: 0.9, target_pct: 80, sort_order: 5 },
  { hospital_id: H, name: "Learning & Growth", color: "#14b8a6", icon: "🎓", weight: 0.8, target_pct: 90, sort_order: 6 },
]);
const pid = (name) => P.find((p) => p.name === name).id;

// ── KPI catalogue: [code, name, perspective, unit, direction, target, amber, red, current, previous, source, snapshotField] ──
const K = [
  // Clinical Quality
  ["KPI-001", "Hand Hygiene Compliance", "Clinical Quality", "%", "higher_better", 90, 85, 80, 96, 93, "Quality & Safety", null],
  ["KPI-002", "PEWS Compliance", "Clinical Quality", "%", "higher_better", 90, 85, 80, 93, 91, "Quality & Safety", null],
  ["KPI-003", "Medication Error Rate", "Clinical Quality", "per 1k doses", "lower_better", 0.5, 1, 2, 0.8, 1.1, "Quality & Safety", null],
  ["KPI-004", "Falls per 1,000 Patient Days", "Clinical Quality", "rate", "lower_better", 1.5, 2.5, 3.5, 1.2, 1.6, "Quality & Safety", null],
  ["KPI-005", "Pressure Injury Rate", "Clinical Quality", "%", "lower_better", 2, 4, 6, 2.8, 3.4, "Quality & Safety", null],
  ["KPI-006", "30-Day Readmission Rate", "Clinical Quality", "%", "lower_better", 5, 7, 9, 6.3, 6.8, "Operational Command", "readmission_rate"],
  ["KPI-007", "Hospital Acquired Infection", "Clinical Quality", "%", "lower_better", 1.5, 3, 5, 2.1, 2.5, "Quality & Safety", null],
  // Patient Experience
  ["KPI-010", "Patient Satisfaction Score", "Patient Experience", "%", "higher_better", 85, 78, 70, 88, 86, "Patient Care", null],
  ["KPI-011", "Complaint Rate", "Patient Experience", "per 1k", "lower_better", 2, 4, 6, 2.4, 2.9, "Patient Care", null],
  ["KPI-012", "Discharge Before 11am", "Patient Experience", "%", "higher_better", 60, 50, 40, 62, 58, "Operational Command", "discharge_before_noon_pct"],
  ["KPI-013", "Communication Score", "Patient Experience", "%", "higher_better", 85, 78, 70, 87, 85, "Patient Care", null],
  // Operations
  ["KPI-020", "Bed Occupancy Rate", "Operations", "%", "lower_better", 85, 90, 95, 88, 85, "Operational Command", "occupancy_pct"],
  ["KPI-021", "Average Length of Stay", "Operations", "days", "lower_better", 4.5, 5, 6, 4.2, 4.6, "Operational Command", "avg_los"],
  ["KPI-022", "Discharge Efficiency", "Operations", "%", "higher_better", 90, 82, 75, 91, 87, "Operational Command", null],
  ["KPI-023", "Bed Turnover", "Operations", "/bed", "higher_better", 4, 3, 2, 3.6, 3.4, "Operational Command", "bed_turnover"],
  ["KPI-024", "Escalation Rate", "Operations", "%", "lower_better", 3, 5, 7, 3.2, 4.3, "Operational Command", "escalation_rate"],
  ["KPI-025", "ED Boarding Hours", "Operations", "hrs", "lower_better", 4, 6, 8, 4.6, 5.2, "Operational Command", "ed_boarding_hours"],
  ["KPI-026", "Theatre Utilisation", "Operations", "%", "higher_better", 85, 78, 70, 81, 79, "Operational Command", "theatre_utilisation"],
  ["KPI-027", "Documentation Timeliness", "Operations", "%", "higher_better", 90, 82, 75, 88, 84, "Operational Command", null],
  ["KPI-028", "Task Completion Rate", "Operations", "%", "higher_better", 90, 82, 75, 93, 90, "Operational Command", null],
  // Workforce
  ["KPI-030", "Safe Staffing Score", "Workforce", "score", "higher_better", 90, 80, 70, 89, 85, "Workforce Management", "safe_staffing_score"],
  ["KPI-031", "Vacancy Rate", "Workforce", "%", "lower_better", 8, 12, 15, 6.3, 7.1, "Workforce Management", null],
  ["KPI-032", "Retention Rate (12M)", "Workforce", "%", "higher_better", 90, 82, 75, 91, 88, "Workforce Management", null],
  ["KPI-033", "Staff Engagement", "Workforce", "%", "higher_better", 80, 72, 65, 78, 80, "Workforce Management", null],
  ["KPI-034", "Competency Compliance", "Workforce", "%", "higher_better", 90, 82, 75, 91, 88, "Competency Office", null],
  ["KPI-035", "Mandatory Training Completion", "Workforce", "%", "higher_better", 95, 88, 80, 88, 84, "Learning & Development", null],
  ["KPI-036", "Nursing Hours per Patient Day", "Workforce", "NHPPD", "higher_better", 6, 5, 4, 6.2, 5.8, "Workforce Management", null],
  ["KPI-037", "Sickness Absence Rate", "Workforce", "%", "lower_better", 3.5, 5, 7, 4.1, 4.6, "Workforce Management", null],
  // Financial
  ["KPI-040", "Budget Variance", "Financial", "%", "lower_better", 0, 3, 5, 3.2, 4.1, "Financial Services", null],
  ["KPI-041", "Cost per Patient Day", "Financial", "$", "lower_better", 900, 1000, 1100, 846, 869, "Financial Services", null],
  ["KPI-042", "Cost per Case", "Financial", "$", "lower_better", 4500, 5000, 5500, 4325, 4408, "Financial Services", null],
  ["KPI-043", "Labour Cost Ratio", "Financial", "%", "lower_better", 60, 65, 70, 58.4, 59.2, "Financial Services", null],
  ["KPI-044", "Overtime Cost (MTD)", "Financial", "$", "lower_better", 25000, 30000, 35000, 28760, 27020, "Financial Services", null],
  ["KPI-045", "Agency Cost (MTD)", "Financial", "$", "lower_better", 15000, 20000, 25000, 18430, 19240, "Financial Services", null],
  // Learning & Growth
  ["KPI-050", "CPD Completion", "Learning & Growth", "%", "higher_better", 90, 80, 70, 87, 83, "Learning & Development", null],
  ["KPI-051", "Competency Achievement", "Learning & Growth", "%", "higher_better", 90, 82, 75, 91, 88, "Competency Office", null],
  ["KPI-052", "Learning Compliance", "Learning & Growth", "%", "higher_better", 95, 88, 80, 88, 85, "Learning & Development", null],
  ["KPI-053", "Preceptorship Completion", "Learning & Growth", "%", "higher_better", 90, 80, 70, 84, 79, "Learning & Development", null],
];

const kpiRows = K.map(([code, name, persp, unit, dir, target, amber, red, cur, prev, source, snap], i) => ({
  hospital_id: H, perspective_id: pid(persp), code, name, category: persp, unit, direction: dir,
  target, threshold_amber: amber, threshold_red: red, current_value: cur, previous_value: prev,
  data_source: source, snapshot_field: snap, owner_id: owner(i), status: "active",
}));
const kpis = await ins("pa_kpis", kpiRows);

// ── Trend values (13 months, interpolate previous → current with light noise) + benchmarks ──
const values = [], benches = [];
kpis.forEach((k) => {
  const cur = Number(k.current_value), prev = Number(k.previous_value ?? cur);
  const start = prev + (prev - cur) * 1.6; // extrapolate a plausible 13-month-ago baseline
  for (let m = 12; m >= 0; m--) {
    const t = (12 - m) / 12;
    const base = start + (cur - start) * t;
    const noise = base * (Math.random() - 0.5) * 0.05;
    values.push({ kpi_id: k.id, period: monthStart(m), value: round(Math.max(0, base + noise), 2) });
  }
  const tgt = Number(k.target);
  const dirUp = k.direction === "higher_better";
  const jitter = (f) => round(cur * (1 + (dirUp ? f : -f)), 2);
  benches.push(
    { kpi_id: k.id, comparator: "target", value: tgt },
    { kpi_id: k.id, comparator: "hospital_avg", value: jitter(-0.06) },
    { kpi_id: k.id, comparator: "peer", value: jitter(-0.03) },
    { kpi_id: k.id, comparator: "specialty", value: jitter(-0.01) },
    { kpi_id: k.id, comparator: "best", value: jitter(0.08) },
  );
});
// chunked insert (kpi_values can be large)
for (let i = 0; i < values.length; i += 300) await ins("pa_kpi_values", values.slice(i, i + 300));
for (let i = 0; i < benches.length; i += 300) await ins("pa_benchmarks", benches.slice(i, i + 300));

// ── Financial cost centres (by department + by spend category) ──
await ins("pa_cost_centres", [
  { hospital_id: H, name: "Neurosurgery Ward", actual: 214850, budget: 205600, category: "department" },
  { hospital_id: H, name: "ICU", actual: 168320, budget: 162900, category: "department" },
  { hospital_id: H, name: "Operating Theatres", actual: 124900, budget: 131200, category: "department" },
  { hospital_id: H, name: "Outpatient Services", actual: 56430, budget: 54100, category: "department" },
  { hospital_id: H, name: "Diagnostics", actual: 34250, budget: 33600, category: "department" },
  { hospital_id: H, name: "Other Support Services", actual: 13700, budget: 12200, category: "department" },
  { hospital_id: H, name: "Salaries & Wages", actual: 348000, budget: 352000, category: "spend" },
  { hospital_id: H, name: "Medical Supplies", actual: 98500, budget: 96000, category: "spend" },
  { hospital_id: H, name: "Pharmaceuticals", actual: 62400, budget: 61000, category: "spend" },
  { hospital_id: H, name: "Equipment & Maintenance", actual: 41800, budget: 44000, category: "spend" },
  { hospital_id: H, name: "Other Operating Costs", actual: 42900, budget: 40600, category: "spend" },
]);

// ── Improvement projects ──
await ins("pa_improvement_projects", [
  { hospital_id: H, name: "Falls Prevention Bundle", perspective_id: pid("Clinical Quality"), status: "on_track", progress_pct: 72, benefit: 48600, owner_id: owner(0), due_date: dPlus(45) },
  { hospital_id: H, name: "Discharge Before 11am Initiative", perspective_id: pid("Operations"), status: "on_track", progress_pct: 64, benefit: 62000, owner_id: owner(1), due_date: dPlus(60) },
  { hospital_id: H, name: "Overtime Reduction Programme", perspective_id: pid("Financial"), status: "at_risk", progress_pct: 38, benefit: 84000, owner_id: owner(2), due_date: dPlus(30) },
  { hospital_id: H, name: "Documentation Timeliness Drive", perspective_id: pid("Operations"), status: "on_track", progress_pct: 55, benefit: 21000, owner_id: owner(3), due_date: dPlus(90) },
  { hospital_id: H, name: "Mandatory Training Push", perspective_id: pid("Learning & Growth"), status: "at_risk", progress_pct: 41, benefit: 15000, owner_id: owner(4), due_date: dPlus(20) },
  { hospital_id: H, name: "Hand Hygiene Excellence", perspective_id: pid("Clinical Quality"), status: "completed", progress_pct: 100, benefit: 32000, owner_id: owner(0), due_date: dPlus(-10) },
  { hospital_id: H, name: "Agency Spend Optimisation", perspective_id: pid("Financial"), status: "on_track", progress_pct: 58, benefit: 96000, owner_id: owner(2), due_date: dPlus(75) },
  { hospital_id: H, name: "Staff Engagement Programme", perspective_id: pid("Workforce"), status: "overdue", progress_pct: 28, benefit: 12000, owner_id: owner(1), due_date: dPlus(-5) },
]);

// ── Executive reports ──
await ins("pa_reports", [
  { hospital_id: H, name: "Monthly Performance Report", frequency: "monthly", status: "completed", due_date: dPlus(1), format: "PDF + Excel", owner_id: owner(0), recipients: 18, distributed: true },
  { hospital_id: H, name: "Workforce Performance Report", frequency: "monthly", status: "completed", due_date: dPlus(1), format: "PDF + Excel", owner_id: owner(1), recipients: 16, distributed: true },
  { hospital_id: H, name: "Quality & Safety Report", frequency: "monthly", status: "in_progress", due_date: dPlus(4), format: "PDF", owner_id: owner(0), recipients: 14, distributed: false },
  { hospital_id: H, name: "Financial Performance Report", frequency: "monthly", status: "in_progress", due_date: dPlus(4), format: "PDF + Excel", owner_id: owner(2), recipients: 20, distributed: false },
  { hospital_id: H, name: "Executive Summary Report", frequency: "monthly", status: "pending", due_date: dPlus(6), format: "PDF + PPTX", owner_id: owner(3), recipients: 8, distributed: false },
  { hospital_id: H, name: "Board Performance Pack", frequency: "monthly", status: "pending", due_date: dPlus(9), format: "PDF + PPTX", owner_id: owner(0), recipients: 12, distributed: false },
  { hospital_id: H, name: "Regulatory Submission (MOH)", frequency: "monthly", status: "not_started", due_date: dPlus(14), format: "PDF", owner_id: owner(4), recipients: 3, distributed: false },
]);

// ── AI predictions / recommendations / risks ──
const kByCode = (c) => kpis.find((k) => k.code === c)?.id ?? null;
await ins("pa_predictions", [
  { hospital_id: H, kpi_id: kByCode("KPI-020"), kind: "prediction", title: "Bed Occupancy Rate will reach 95% in 18 days", detail: "Current trend +1.8%/week; elective cases scheduled above average.", predicted_value: 95, confidence: 87, risk: "high", horizon: "Next 30 Days" },
  { hospital_id: H, kpi_id: kByCode("KPI-021"), kind: "prediction", title: "Average Length of Stay predicted to rise to 4.9 days", detail: "High bed occupancy and delayed discharges are the primary drivers.", predicted_value: 4.9, confidence: 81, risk: "medium", horizon: "Next 30 Days" },
  { hospital_id: H, kpi_id: kByCode("KPI-044"), kind: "prediction", title: "Overtime cost predicted to exceed target", detail: "Forecast $34,100 vs $25,000 target on current staffing trend.", predicted_value: 34100, confidence: 75, risk: "high", horizon: "MTD" },
  { hospital_id: H, kpi_id: null, kind: "risk", title: "ICU bed capacity shortage", detail: "High acuity + admissions trend.", confidence: 78, risk: "high", impact: "high", horizon: "Next 30 Days" },
  { hospital_id: H, kpi_id: kByCode("KPI-030"), kind: "risk", title: "RN staffing deficit", detail: "Vacancy + sickness trend against demand.", confidence: 72, risk: "high", impact: "high", horizon: "Next 30 Days" },
  { hospital_id: H, kpi_id: kByCode("KPI-004"), kind: "risk", title: "Increased falls risk", detail: "Acuity and staffing pattern similar to prior spike.", confidence: 65, risk: "medium", impact: "medium", horizon: "Next 30 Days" },
  { hospital_id: H, kpi_id: kByCode("KPI-030"), kind: "recommendation", title: "Increase RN staffing on Night Shift", detail: "High overtime risk and acuity increase predicted.", confidence: 87, impact: "high", benefit: 12450, horizon: "Next 30 Days" },
  { hospital_id: H, kpi_id: kByCode("KPI-012"), kind: "recommendation", title: "Optimise patient discharge process", detail: "Predicted 7% reduction in delayed discharges.", confidence: 84, impact: "high", benefit: 8900, horizon: "Next 30 Days" },
  { hospital_id: H, kpi_id: kByCode("KPI-045"), kind: "recommendation", title: "Reduce agency nurse utilisation", detail: "High agency usage predicted next 30 days.", confidence: 79, impact: "medium", benefit: 6200, horizon: "Next 30 Days" },
  { hospital_id: H, kpi_id: kByCode("KPI-041"), kind: "recommendation", title: "Review high-cost consumables", detail: "Waste pattern detected in specific categories.", confidence: 74, impact: "medium", benefit: 4750, horizon: "Next 30 Days" },
]);

console.log(`✅ Seeded Performance Analytics for AMU (${H}): ${P.length} perspectives, ${kpis.length} KPIs, ${values.length} trend points, ${benches.length} benchmarks, 11 cost centres, 8 projects, 7 reports, 10 predictions.`);
