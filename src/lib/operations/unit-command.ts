import { loadOpsConsoleData } from "@/lib/operations/ops-console-data";

// Unit Command loaders (UMW-001 / UMW-003) — the Unit Manager is the MULTI-SHIFT
// owner of unit performance (vs the supervisor's single active shift). These
// loaders aggregate the same op_* / shift_metrics / quality data at the unit
// level across many shifts. Tenant-scoped; fail-soft pre-migration. Data with no
// real backing (budget, equipment, improvement targets) is left to the pages to
// render as honest states — never fabricated here.
/* eslint-disable @typescript-eslint/no-explicit-any */

const NONE = "00000000-0000-0000-0000-000000000000";
const scoped = (isSuper: boolean, hid: string | null) => (q: any) => (isSuper ? q : q.eq("hospital_id", hid ?? NONE));
const missing = (e: any) => e && /does not exist|schema cache/i.test(e.message ?? "");

// Universal filters (UMW-001 §Implementation). Department scopes the operational
// entities; period windows time-series data. "shift"/"today" collapse to the most
// recent day; only the historical trend genuinely varies by period.
export const PERIOD_DAYS: Record<string, number> = { shift: 1, today: 1, "7d": 7, "30d": 30, "90d": 90 };
export function periodCutoff(period?: string): string {
  const days = PERIOD_DAYS[period ?? "7d"] ?? 7;
  const d = new Date(); d.setDate(d.getDate() - (days - 1));
  return d.toISOString().slice(0, 10);
}

// Department list for the filter dropdown.
export async function loadUnitDepartments(admin: any, hid: string | null, isSuper: boolean) {
  try {
    const { data } = await scoped(isSuper, hid)(admin.from("departments").select("id, name")).order("name");
    return (data ?? []) as { id: string; name: string }[];
  } catch { return []; }
}

// Post-hoc department scoping of the shared ops backbone (op_shift_staff has no
// department_id → scoped by its shift; escalations/alerts/tasks by their patient).
export function filterOpsByDept(data: any, dept?: string) {
  if (!dept) return data;
  const beds = data.beds.filter((b: any) => b.department_id === dept);
  const patients = data.patients.filter((p: any) => p.department_id === dept);
  const shifts = data.shifts.filter((s: any) => s.department_id === dept);
  const shiftIds = new Set(shifts.map((s: any) => s.id));
  const patientIds = new Set(patients.map((p: any) => p.id));
  const shiftStaff = data.shiftStaff.filter((s: any) => shiftIds.has(s.shift_id));
  const escalations = data.escalations.filter((e: any) => e.patient_id && patientIds.has(e.patient_id));
  const alerts = data.alerts.filter((a: any) => a.patient_id && patientIds.has(a.patient_id));
  const tasks = data.tasks.filter((t: any) => t.patient_id && patientIds.has(t.patient_id));
  return { ...data, beds, patients, shifts, shiftStaff, escalations, alerts, tasks };
}

// ── Unit Operations Centre (UMW-003 §1) ──────────────────────────────────────
// Real-time operational picture derived from the live op_* backbone.
export async function loadUnitOperationsCentre(admin: any, hid: string | null, isSuper: boolean, dept?: string) {
  const { ready, data: raw, support } = await loadOpsConsoleData(admin, hid, isSuper);
  if (!ready) return { ready: false as const, departments: support.departments };
  const data = filterOpsByDept(raw, dept);
  const scope = scoped(isSuper, hid);
  const today = new Date().toISOString().slice(0, 10);

  // ── Beds / occupancy ────────────────────────────────────────────────────────
  const beds = data.beds;
  const bedStatus = { total: beds.length, occupied: 0, available: 0, blocked: 0, other: 0 };
  for (const b of beds) {
    if (b.status === "occupied") bedStatus.occupied++;
    else if (b.status === "available") bedStatus.available++;
    else if (b.status === "blocked" || b.status === "closed") bedStatus.blocked++;
    else bedStatus.other++;
  }
  const occupancyPct = bedStatus.total ? Math.round((bedStatus.occupied / bedStatus.total) * 100) : 0;

  // ── Patients / acuity ───────────────────────────────────────────────────────
  const patients = data.patients;
  const acuity = { high: 0, medium: 0, low: 0 };
  for (const p of patients) {
    if (p.acuity_level === "critical" || p.acuity_level === "high") acuity.high++;
    else if (p.acuity_level === "moderate") acuity.medium++;
    else acuity.low++;
  }
  const acuityScore: Record<string, number> = { critical: 4, high: 3, moderate: 2, stable: 1 };
  const avgAcuityScore = patients.length ? (patients.reduce((s: number, p: any) => s + (acuityScore[p.acuity_level] ?? 1), 0) / patients.length) : 0;
  const admissionsToday = patients.filter((p: any) => (p.created_at ?? "").slice(0, 10) === today).length;
  const dischargePending = patients.filter((p: any) => p.operational_status === "discharge_pending").length;
  const transferPending = patients.filter((p: any) => p.operational_status === "transfer_pending").length;
  const expectedPatients = patients.filter((p: any) => p.operational_status === "expected").length;

  // ── Staffing (present / break / off / rostered) ─────────────────────────────
  const activeIds = new Set(data.shifts.filter((s: any) => s.status === "active").map((s: any) => s.id));
  const rosterStaff = data.shiftStaff.filter((s: any) => activeIds.has(s.shift_id) && s.status !== "absent");
  const onDuty = rosterStaff.filter((s: any) => ["on_duty", "confirmed", "assigned"].includes(s.status));
  const roleMix: Record<string, number> = onDuty.reduce((m: Record<string, number>, s: any) => ({ ...m, [s.role]: (m[s.role] ?? 0) + 1 }), {} as Record<string, number>);
  const nurses = (roleMix["nurse"] ?? 0) + (roleMix["charge"] ?? 0);
  const nurseRatio = nurses ? (patients.length / nurses) : null;

  // ── Extra live sources (all fail-soft) ──────────────────────────────────────
  const [breaksRes, decRes, incRes, qaRes, auditRes] = await Promise.all([
    scope(admin.from("op_staff_breaks").select("status")).limit(500),
    scope(admin.from("competency_decisions").select("nurse_id, competency_id, outcome, expiry_date, created_at").order("created_at", { ascending: false }).limit(20000)),
    scope(admin.from("op_incidents").select("id, severity, created_at").gte("created_at", today)),
    scope(admin.from("op_quality_actions").select("title, status, action_type, owner_name").in("action_type", ["improvement_project", "audit_action", "capa"]).neq("status", "completed").limit(8)),
    scope(admin.from("audit_log").select("action, entity_type, entity_name, actor_name, created_at").order("created_at", { ascending: false }).limit(8)),
  ]);
  const onBreak = (breaksRes.data ?? []).filter((b: any) => b.status === "on_break").length;
  const rostered = rosterStaff.length;
  const present = onDuty.length;
  const offDuty = Math.max(0, rostered - present - onBreak);

  // Observation compliance from the already-loaded op_observations (dept-scoped).
  const obsTotal = data.observations.length;
  const obsOverdue = data.observations.filter((o: any) => o.status === "overdue").length;
  const obsCompliance = obsTotal ? Math.round(((obsTotal - obsOverdue) / obsTotal) * 100) : null;

  // Competency coverage (latest decision per nurse+competency).
  const PASSING = ["competent", "competent_with_conditions", "provisionally_competent"];
  const seen = new Set<string>(); const latest: any[] = [];
  for (const d of decRes.data ?? []) { const k = `${d.nurse_id}:${d.competency_id}`; if (!seen.has(k)) { seen.add(k); latest.push(d); } }
  const competent = latest.filter((d: any) => PASSING.includes(d.outcome) && !(d.expiry_date && d.expiry_date < today)).length;
  const competencyCoverage = latest.length ? Math.round((competent / latest.length) * 100) : null;

  const incidentsToday = (incRes.data ?? []).length;
  const safetyCritical = data.escalations.filter((e: any) => e.level >= 4).length + data.alerts.filter((a: any) => a.severity === "high").length;
  const safetyEvents = data.escalations.length + data.alerts.length + incidentsToday;

  // ── Unit Health Score (0–100) — mean of the available operational sub-scores ─
  const subs: number[] = [];
  subs.push(occupancyPct >= 92 ? 55 : occupancyPct >= 85 ? 78 : 95);
  if (rostered) subs.push(Math.min(100, Math.round((present / rostered) * 100)));
  subs.push(Math.max(0, 100 - (safetyCritical * 15 + data.escalations.length * 5)));
  if (obsCompliance != null) subs.push(obsCompliance);
  const healthScore = subs.length ? Math.round(subs.reduce((a, b) => a + b, 0) / subs.length) : null;
  const healthStatus = healthScore == null ? { label: "—", tone: "gray" } : healthScore >= 80 ? { label: "Operationally Stable", tone: "green" } : healthScore >= 60 ? { label: "Under Pressure", tone: "amber" } : { label: "Strained", tone: "red" };

  // ── Priority alerts (real: escalations + safety + occupancy + obs) ───────────
  const relClock = (iso?: string) => iso ? new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";
  const alerts: { tone: string; sev: string; title: string; sub: string; at: string }[] = [];
  for (const e of data.escalations.slice(0, 6)) alerts.push({ tone: e.level >= 4 ? "red" : "amber", sev: e.level >= 4 ? "Critical" : e.level >= 3 ? "High" : "Medium", title: `Level ${e.level} Escalation${e.op_patients?.label ? ` · ${e.op_patients.label}` : ""}`, sub: e.summary ?? e.escalation_type ?? "Open escalation", at: relClock(e.created_at) });
  for (const a of data.alerts.slice(0, 4)) alerts.push({ tone: a.severity === "high" ? "amber" : "blue", sev: a.severity === "high" ? "High" : "Medium", title: `Safety — ${(a.category ?? "alert").replace(/_/g, " ")}`, sub: a.op_patients?.label ?? a.note ?? "Active safety alert", at: relClock(a.created_at) });
  if (occupancyPct >= 90) alerts.push({ tone: "amber", sev: "High", title: `High occupancy (${occupancyPct}%)`, sub: "Bed availability under pressure", at: "" });
  if (obsCompliance != null && obsCompliance < 80) alerts.push({ tone: "blue", sev: "Medium", title: "Observation compliance below target", sub: `${obsCompliance}% — ${obsOverdue} overdue`, at: "" });

  // ── Live activity timeline (audit_log) ──────────────────────────────────────
  const timeline = (auditRes.data ?? []).map((a: any) => ({ at: relClock(a.created_at), label: `${(a.action ?? "event").replace(/_/g, " ")}${a.entity_name ? ` · ${a.entity_name}` : ""}`, by: a.actor_name ?? "" }));

  // ── Improvement tracker (real CAPA / projects; % progress has no store) ──────
  const improvements = (qaRes.data ?? []).map((q: any) => ({ title: q.title, status: q.status, type: q.action_type, owner: q.owner_name ?? "—" }));

  // ── Predictive (heuristic over live flow; labelled honestly on the page) ─────
  const predictedOccupancy = bedStatus.total ? Math.max(0, Math.min(100, Math.round(((bedStatus.occupied + expectedPatients - dischargePending) / bedStatus.total) * 100))) : null;
  const staffingPressure = !rostered ? "—" : present < rostered * 0.85 ? "High" : present < rostered ? "Medium" : "Low";
  const predictive = { expectedAdmissions: expectedPatients, expectedDischarges: dischargePending, predictedOccupancy, staffingPressure };

  // ── AI operational summary (rule-based over the live snapshot) ───────────────
  const aiSummary = [
    `Unit at ${occupancyPct}% occupancy (${bedStatus.occupied}/${bedStatus.total} beds), ${patients.length} patient${patients.length === 1 ? "" : "s"}, ${acuity.high} high-acuity.`,
    data.escalations.length ? `${data.escalations.length} open escalation${data.escalations.length === 1 ? "" : "s"}${safetyCritical ? ` (${safetyCritical} critical)` : ""} — review required.` : "No open escalations.",
    rostered ? `Staffing ${present}/${rostered} present${staffingPressure !== "Low" ? `; ${staffingPressure.toLowerCase()} staffing pressure` : ""}.` : "",
    obsCompliance != null ? `Observation compliance ${obsCompliance}%.` : "",
  ].filter(Boolean).join(" ");

  // ── AI Operational Copilot (derived risk + rule-based recommendations) ───────
  const shiftRisk = healthScore != null ? Math.max(0, Math.min(100, 100 - healthScore + safetyCritical * 5)) : null;
  const recommendations: string[] = [];
  if (staffingPressure !== "Low" && rostered) recommendations.push(`Review RN coverage — ${present}/${rostered} present with ${staffingPressure.toLowerCase()} pressure.`);
  if (acuity.high >= 3) recommendations.push(`Allocate an experienced nurse to the ${acuity.high} high-acuity patients.`);
  if (safetyCritical) recommendations.push(`Escalate/monitor ${safetyCritical} critical safety item(s).`);
  if (obsCompliance != null && obsCompliance < 90) recommendations.push(`Chase ${obsOverdue} overdue observation(s) to lift compliance above 90%.`);
  if (occupancyPct >= 90) recommendations.push("Confirm discharge plans to relieve occupancy pressure.");

  return {
    ready: true as const,
    departments: support.departments,
    healthScore, healthStatus,
    kpis: {
      occupancy: `${bedStatus.occupied} / ${bedStatus.total}`, occupancyPct,
      patients: patients.length, admissionsToday, dischargePending, transferPending,
      escalations: data.escalations.length, bedsAvailable: bedStatus.available,
      avgAcuity: avgAcuityScore ? avgAcuityScore.toFixed(1) : "—",
      onDuty: present, nurseRatio: nurseRatio ? `1:${nurseRatio.toFixed(1)}` : "—",
      safetyEvents, safetyCritical, predictedOccupancy,
    },
    bedStatus, acuity, roleMix,
    flow: { admissions: admissionsToday, discharges: dischargePending, transfers: transferPending, expected: expectedPatients },
    staffing: { present, onBreak, offDuty, rostered },
    ratio: { value: nurseRatio ? `1:${nurseRatio.toFixed(1)}` : "—", target: "1:4", withinTarget: nurseRatio != null && nurseRatio <= 4 },
    competencyCoverage,
    performance: { obsCompliance, incidentsToday, escalations: data.escalations.length },
    alerts, timeline, improvements, predictive, aiSummary,
    copilot: { shiftRisk, recommendations, expectedHealth: healthScore },
  };
}

// ── Shift Intelligence (UMW-004) ─────────────────────────────────────────────
// Enterprise cross-shift intelligence over persisted shift_metrics (the per-shift
// performance snapshot). Derives performance/pressure/safety/workforce scores, a
// shift-type comparison matrix, multi-metric trend, risk heat map, best/worst
// shift and rule-based AI summary + management recommendations, with period-over-
// period deltas. Handover quality (op_handovers unwritten) and precise escalation
// medians beyond resolved rows are honest states.
const avg = (arr: any[], f: (x: any) => number | null | undefined) => { const v = arr.map(f).filter((x): x is number => x != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
const median = (v: number[]) => { if (!v.length) return null; const s = [...v].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const bucketOf = (st: string) => (st === "evening" ? "evening" : st === "night" || st === "on_call" ? "night" : "day");
const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

// Per-shift derived scores (0–100) from a shift_metrics row.
function enrich(r: any) {
  const cov = r.staffing_rostered ? Math.round(((r.staffing_present ?? 0) / r.staffing_rostered) * 100) : null;
  const gap = (r.staffing_rostered ?? 0) - (r.staffing_present ?? 0);
  const esc = r.open_escalations ?? 0, inc = r.incident_count ?? 0, occ = r.bed_occupancy_pct ?? 0, hi = r.high_acuity_count ?? 0;
  const pressure = Math.round(0.35 * occ + 0.25 * Math.min(100, hi * 15) + 0.25 * Math.min(100, esc * 20) + 0.15 * Math.min(100, Math.max(0, gap) * 25));
  const safetyParts = [r.observation_compliance_pct, Math.max(0, 100 - inc * 20), Math.max(0, 100 - esc * 10)].filter((x: any) => x != null) as number[];
  const safety = safetyParts.length ? Math.round(safetyParts.reduce((a, b) => a + b, 0) / safetyParts.length) : null;
  const wfParts = [cov, r.skill_mix_compliance_pct, r.task_completion_pct].filter((x: any) => x != null) as number[];
  const workforce = wfParts.length ? Math.round(wfParts.reduce((a, b) => a + b, 0) / wfParts.length) : null;
  return {
    date: r.op_shifts.shift_date, shift_type: r.op_shifts.shift_type, bucket: bucketOf(r.op_shifts.shift_type),
    supervisor: r.op_shifts.profiles?.full_name ?? "—",
    performance: r.overall_score, pressure, safety, workforce, coverage: cov, staffingGap: gap,
    occupancy: occ, acuity: hi, escalations: esc, incidents: inc,
    taskCompletion: r.task_completion_pct, obsCompliance: r.observation_compliance_pct, skillMix: r.skill_mix_compliance_pct,
  };
}

export async function loadShiftIntelligence(admin: any, hid: string | null, isSuper: boolean, opts: { dept?: string; period?: string } = {}) {
  const scope = scoped(isSuper, hid);
  const res = await scope(admin.from("shift_metrics")
    .select("overall_score, staffing_present, staffing_rostered, skill_mix_compliance_pct, observation_compliance_pct, open_escalations, incident_count, high_acuity_count, bed_occupancy_pct, task_completion_pct, computed_at, op_shifts!shift_id(shift_date, shift_type, department_id, profiles!supervisor_id(full_name))")
    .order("computed_at", { ascending: false }).limit(600));
  if (missing(res.error)) return { provisioned: false as const, count: 0 };

  const days = PERIOD_DAYS[opts.period ?? "7d"] ?? 7;
  const curCut = periodCutoff(opts.period);
  const prevD = new Date(); prevD.setDate(prevD.getDate() - (days * 2 - 1)); const prevCut = prevD.toISOString().slice(0, 10);
  const all = (res.data ?? []).filter((r: any) => r.op_shifts && (!opts.dept || r.op_shifts.department_id === opts.dept)).map(enrich);
  const cur = all.filter((s: any) => s.date >= curCut);
  const prev = all.filter((s: any) => s.date >= prevCut && s.date < curCut);

  // Escalation burden (resolved response times + critical count) over the current period.
  let critical = 0, medianResolution: number | null = null;
  try {
    const escRes = await scope(admin.from("op_escalations").select("level, created_at, resolved_at").gte("created_at", curCut).limit(1000));
    const escs = escRes.data ?? [];
    critical = escs.filter((e: any) => e.level >= 4).length;
    const durs = escs.filter((e: any) => e.resolved_at).map((e: any) => (new Date(e.resolved_at).getTime() - new Date(e.created_at).getTime()) / 60000).filter((m: number) => m >= 0);
    medianResolution = median(durs);
  } catch { /* fail-soft */ }

  const roundOrNull = (x: number | null) => (x == null ? null : Math.round(x));
  const delta = (c: number | null, p: number | null) => (c == null || p == null ? null : Math.round(c - p));
  const kpi = (f: (x: any) => number | null) => ({ value: roundOrNull(avg(cur, f)), delta: delta(avg(cur, f), avg(prev, f)) });
  const kpis = {
    performance: kpi(s => s.performance), pressure: kpi(s => s.pressure), safety: kpi(s => s.safety),
    workforce: kpi(s => s.workforce), taskCompletion: kpi(s => s.taskCompletion),
    escalationBurden: { value: cur.reduce((a: number, s: any) => a + s.escalations, 0), critical, medianResolution: medianResolution != null ? Math.round(medianResolution) : null },
  };

  // Comparison matrix by shift-type bucket.
  const buckets = ["day", "evening", "night"] as const;
  const byBucket = (b: string) => cur.filter((s: any) => s.bucket === b);
  const prevByBucket = (b: string) => prev.filter((s: any) => s.bucket === b);
  const trendArrow = (metric: (x: any) => number | null, invert = false) => (b: string) => {
    const c = avg(byBucket(b), metric), p = avg(prevByBucket(b), metric);
    if (c == null || p == null || Math.abs(c - p) < 0.5) return "→";
    return (c > p) === !invert ? "↑" : "↓";
  };
  const matrixRow = (metric: string, f: (x: any) => number | null, fmt: (n: number | null) => string, target: string, invert = false) => ({
    metric, target, day: fmt(roundOrNull(avg(byBucket("day"), f))), evening: fmt(roundOrNull(avg(byBucket("evening"), f))), night: fmt(roundOrNull(avg(byBucket("night"), f))),
    trend: trendArrow(f, invert)("day"),
  });
  const pct = (n: number | null) => (n == null ? "—" : `${n}%`);
  const num = (n: number | null) => (n == null ? "—" : `${n}`);
  const matrix = [
    matrixRow("Average Occupancy", s => s.occupancy, pct, "< 85%", true),
    matrixRow("High-Acuity Patients", s => s.acuity, num, "—"),
    matrixRow("Staffing Coverage", s => s.coverage, pct, "≥ 95%"),
    matrixRow("Task Completion", s => s.taskCompletion, pct, "≥ 90%"),
    matrixRow("Observation Compliance", s => s.obsCompliance, pct, "≥ 95%"),
    matrixRow("Open Escalations", s => s.escalations, num, "0", true),
    matrixRow("Incidents", s => s.incidents, num, "0", true),
  ];

  // Multi-metric trend by date.
  const dates = [...new Set(cur.map((s: any) => s.date))].sort();
  const trend = dates.slice(-14).map(dt => { const day = cur.filter((s: any) => s.date === dt); return { date: dt as string, performance: roundOrNull(avg(day, s => s.performance)), pressure: roundOrNull(avg(day, s => s.pressure)), staffing: roundOrNull(avg(day, s => s.coverage)), obs: roundOrNull(avg(day, s => s.obsCompliance)) }; });

  // Risk heat map — day-of-week × shift-type bucket (lower score = higher risk).
  const risk = (score: number | null) => score == null ? "none" : score >= 85 ? "low" : score >= 70 ? "medium" : score >= 50 ? "high" : "critical";
  const heat = buckets.map(b => ({ bucket: b, cells: DOW.map((_, i) => { const cells = cur.filter((s: any) => s.bucket === b && ((new Date(s.date).getDay() + 6) % 7) === i); const sc = roundOrNull(avg(cells, s => s.performance)); return { score: sc, risk: risk(sc), n: cells.length }; }) }));

  // Best / worst shift.
  const scored = cur.filter((s: any) => s.performance != null).sort((a: any, b: any) => b.performance - a.performance);
  const bestShift = scored[0] ?? null;
  const worstShift = scored.length ? scored[scored.length - 1] : null;

  // Recent reviews (latest shifts).
  const recentReviews = [...cur].sort((a: any, b: any) => (b.date > a.date ? 1 : -1)).slice(0, 6);

  // AI summary + recommendations + insights (rule-based over the window).
  const bAvg = (b: string) => roundOrNull(avg(byBucket(b), s => s.performance));
  const worstBucket = buckets.map(b => ({ b, s: bAvg(b) })).filter(x => x.s != null).sort((a, b) => (a.s! - b.s!))[0];
  const aiSummary = cur.length === 0 ? "No completed shifts captured in this period." : [
    worstBucket ? `${worstBucket.b[0].toUpperCase()}${worstBucket.b.slice(1)} shifts performed ${worstBucket.b === "day" ? "" : "below day shifts "}at ${worstBucket.s}% average performance.` : "",
    kpis.escalationBurden.value ? `${kpis.escalationBurden.value} escalation(s)${critical ? `, ${critical} critical` : ""} across ${cur.length} shifts.` : "",
    kpis.safety.value != null ? `Average safety ${kpis.safety.value}%; workforce effectiveness ${kpis.workforce.value ?? "—"}%.` : "",
  ].filter(Boolean).join(" ");

  const recommendations: { sev: string; title: string; due: string }[] = [];
  if (worstBucket && worstBucket.s != null && worstBucket.s < 75) recommendations.push({ sev: "High", title: `Increase senior coverage on ${worstBucket.b} shifts`, due: "2 days" });
  if (avg(cur, s => s.obsCompliance) != null && (avg(cur, s => s.obsCompliance) as number) < 90) recommendations.push({ sev: "High", title: "Investigate observation delays", due: "3 days" });
  if (critical) recommendations.push({ sev: "Critical", title: `Review ${critical} critical escalation(s)`, due: "today" });
  if (avg(cur, s => s.staffingGap) != null && (avg(cur, s => s.staffingGap) as number) > 0) recommendations.push({ sev: "Medium", title: "Close recurring staffing gaps", due: "5 days" });
  if (avg(cur, s => s.taskCompletion) != null && (avg(cur, s => s.taskCompletion) as number) < 90) recommendations.push({ sev: "Medium", title: "Standardise task handover acceptance", due: "7 days" });

  const insights: string[] = [];
  const nightAvg = bAvg("night"), dayAvg = bAvg("day");
  if (nightAvg != null && dayAvg != null && nightAvg < dayAvg) insights.push(`Night shifts run ${dayAvg - nightAvg} points below day shifts.`);
  if (critical) insights.push(`${critical} critical escalation(s) in the period — concentrate senior review there.`);
  if (kpis.escalationBurden.medianResolution != null) insights.push(`Median escalation resolution ${kpis.escalationBurden.medianResolution} min.`);
  const lowObs = cur.filter((s: any) => s.obsCompliance != null && s.obsCompliance < 90).length;
  if (lowObs) insights.push(`${lowObs} of ${cur.length} shifts under 90% observation compliance.`);

  return { provisioned: true as const, count: cur.length, kpis, matrix, trend, heat, dow: DOW, bestShift, worstShift, recentReviews, aiSummary, recommendations, insights };
}

// ── Executive Action Centre (UMW-003 §3) ─────────────────────────────────────
// Single management work queue aggregated from the real operational + quality +
// competency stores. Categories with no backing store (leave, staffing requests,
// budget, policy approvals) are reported to the page as honest empty channels.
export async function loadExecutiveActionCentre(admin: any, hid: string | null, isSuper: boolean, dept?: string) {
  const scope = scoped(isSuper, hid);
  const today = new Date().toISOString().slice(0, 10);
  const items: any[] = [];

  // Escalations (Critical Alerts channel) — department via the linked patient.
  try {
    const { data } = await scope(admin.from("op_escalations").select("id, level, summary, escalation_type, status, created_at, profiles!raised_by(full_name), op_patients!patient_id(label, department_id)").neq("status", "resolved").neq("status", "cancelled").order("level", { ascending: false }).limit(50));
    for (const e of data ?? []) { if (dept && e.op_patients?.department_id !== dept) continue; items.push({ id: e.id, channel: "Escalation", priority: e.level >= 4 ? "High" : e.level >= 3 ? "Medium" : "Low", item: `Escalation L${e.level}${e.op_patients?.label ? ` · ${e.op_patients.label}` : ""}`, details: e.summary ?? e.escalation_type ?? "—", by: e.profiles?.full_name ?? "—", at: e.created_at, status: e.status }); }
  } catch { /* pre-migration */ }

  // Incident reviews (op_incidents, migration 073) — department via the linked shift.
  try {
    const { data } = await scope(admin.from("op_incidents").select("id, incident_type, severity, status, created_at, description, reported_by_name, near_miss, profiles!reported_by(full_name), op_shifts!shift_id(department_id)").in("status", ["reported", "investigating", "awaiting_action"]).order("created_at", { ascending: false }).limit(50));
    for (const i of data ?? []) { if (dept && i.op_shifts?.department_id !== dept) continue; items.push({ id: i.id, channel: "Incident Review", priority: i.severity === "high" || i.severity === "critical" ? "High" : "Medium", item: `${i.incident_type} incident${i.near_miss ? " (near miss)" : ""}`, details: i.description ?? `${i.incident_type} · ${i.status}`, by: i.profiles?.full_name ?? i.reported_by_name ?? "—", at: i.created_at, status: i.status }); }
  } catch { /* pre-migration */ }

  // Improvement / CAPA actions (op_quality_actions, migration 073) — dept via shift.
  try {
    const { data } = await scope(admin.from("op_quality_actions").select("id, title, action_type, status, priority, due_at, owner_name, created_at, op_shifts!shift_id(department_id)").in("status", ["open", "in_progress", "overdue"]).order("created_at", { ascending: false }).limit(50));
    for (const a of data ?? []) { if (dept && a.op_shifts?.department_id !== dept) continue; items.push({ id: a.id, channel: "Improvement Action", priority: a.priority === "high" ? "High" : a.status === "overdue" ? "High" : "Medium", item: a.title ?? a.action_type, details: `${a.action_type.replace(/_/g, " ")} · ${a.status}`, by: a.owner_name ?? "Quality", at: a.created_at, due: a.due_at ? a.due_at.slice(0, 10) : null, status: a.status }); }
  } catch { /* pre-migration */ }

  // Competency approvals — passing scores awaiting educator validation. No
  // department dimension in the competency store, so only shown unit-wide.
  if (!dept) try {
    const { data: cyc } = await scope(admin.from("competency_cycles").select("id").eq("status", "active").limit(3000));
    const ids = (cyc ?? []).map((c: any) => c.id);
    if (ids.length) {
      const { data: scores } = await admin.from("competency_scores").select("id, created_at, is_passing, educator_validated").in("cycle_id", ids).eq("is_passing", true).eq("educator_validated", false).limit(200);
      for (const s of scores ?? []) items.push({ id: s.id, channel: "Competency Approval", priority: "Medium", item: "Validation pending", details: "Passing score awaiting educator validation", by: "Assessment", at: s.created_at, status: "pending" });
    }
  } catch { /* pre-migration */ }

  // Derived queue metrics.
  const overdue = items.filter(i => i.due && i.due < today).length;
  const dueToday = items.filter(i => i.due === today).length;
  const counts = {
    total: items.length,
    high: items.filter(i => i.priority === "High").length,
    dueToday, overdue,
    pending: items.filter(i => ["pending", "reported", "open", "acknowledged"].includes(i.status)).length,
  };
  // Channels with no backing store yet — reported honestly, not faked.
  const honestChannels = ["Leave Requests", "Staffing Requests", "Budget Requests", "Policy Approvals", "Executive Messages"];

  return { items: items.sort((a, b) => ({ High: 0, Medium: 1, Low: 2 } as any)[a.priority] - ({ High: 0, Medium: 1, Low: 2 } as any)[b.priority]), counts, honestChannels };
}
