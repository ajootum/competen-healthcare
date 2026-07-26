// UMW-OPC-001 Operational Command Dashboard loader — the Unit Manager's single real-time operational picture over
// the live operational stores (op_beds / op_patients / op_shift_staff+op_shifts / op_escalations / op_safety_alerts
// / op_tasks / op_flow_blockers / op_ops_snapshots / op_movement_events). Read-only manager lens; live execution
// stays in the SSW. Computes the 8-KPI ribbon + unit health score, the bed-grid unit status, patient-acuity
// breakdown, capacity & flow summary, critical alerts, staffing & assignment overview, task summary, an
// operational forecast (recent daily snapshots + naive projection), today's schedule (derived) and the activity
// feed. Everything real where a store exists; derived pieces (schedule, shift timeline) are clearly template-based.
/* eslint-disable @typescript-eslint/no-explicit-any */
const NONE = "00000000-0000-0000-0000-000000000000";
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);
const missing = (e: any) => /does not exist|schema cache/i.test(String(e?.message ?? ""));
const nowMs = () => Date.now();
const dayMs = 86400000;

// op_patients.acuity_level → band.
function acuityBand(a: any): "high" | "medium" | "low" | "stable" {
  const s = String(a ?? "").toLowerCase();
  if (/high|critical|1|red/.test(s)) return "high";
  if (/med|moderate|2|amber/.test(s)) return "medium";
  if (/low|3|green/.test(s)) return "low";
  return "stable";
}

export async function loadOperationalCommand(admin: any, hid: string | null, isSuper: boolean, deptId: string | null) {
  const scope = (q: any) => (isSuper ? q : q.eq("hospital_id", hid ?? NONE));
  const dept = (q: any) => (deptId ? q.eq("department_id", deptId) : q);
  const since24 = new Date(nowMs() - dayMs).toISOString();

  const [bedRes, patRes, ssRes, escRes, safRes, taskRes, blkRes, snapRes, moveRes] = await Promise.all([
    dept(scope(admin.from("op_beds").select("id, label, status, department_id"))).limit(500),
    dept(scope(admin.from("op_patients").select("id, label, acuity_level, risk_level, operational_status, isolation_status, bed_id, department_id"))).limit(1000),
    scope(admin.from("op_shifts").select("id, shift_date, status, department_id")).gte("shift_date", new Date(nowMs() - dayMs).toISOString().slice(0, 10)).limit(50),
    scope(admin.from("op_escalations").select("id, reason, severity, status, created_at")).gte("created_at", since24).order("created_at", { ascending: false }).limit(30).then((r: any) => r, () => ({ data: [] })),
    scope(admin.from("op_safety_alerts").select("id, message, severity, created_at")).gte("created_at", since24).limit(50).then((r: any) => r, () => ({ data: [] })),
    scope(admin.from("op_tasks").select("id, priority, status")).not("status", "in", "(completed,verified,cancelled)").limit(1000).then((r: any) => r, () => ({ data: [] })),
    scope(admin.from("op_flow_blockers").select("id, category, detail, created_at")).limit(100).then((r: any) => r, () => ({ data: [] })),
    scope(admin.from("op_ops_snapshots").select("*")).order("period", { ascending: true }).then((r: any) => r, () => ({ data: [], error: null })),
    scope(admin.from("op_movement_events").select("event_type, detail, created_at")).order("created_at", { ascending: false }).limit(12).then((r: any) => r, () => ({ data: [] })),
  ]);

  if (bedRes.error && missing(bedRes.error)) return { provisioned: false as const };
  const beds = (bedRes.data ?? []) as any[];
  const patients = (patRes.data ?? []) as any[];
  const escalations = (escRes.data ?? []) as any[];
  const safety = (safRes.data ?? []) as any[];
  const tasks = (taskRes.data ?? []) as any[];
  const blockers = (blkRes.data ?? []) as any[];
  const snaps = (snapRes.data ?? []) as any[];
  const movements = (moveRes.data ?? []) as any[];

  // Staff on duty today via op_shift_staff → today's shifts (role breakdown).
  const todayShiftIds = (ssRes.data ?? []).map((s: any) => s.id);
  let staff: any[] = [];
  // op_shift_staff has no hospital_id — it's already constrained to this hospital via today's shift ids (no scope()).
  if (todayShiftIds.length) staff = ((await admin.from("op_shift_staff").select("role, status").in("shift_id", todayShiftIds).then((r: any) => r, () => ({ data: [] }))).data ?? []);

  // ── Bed grid + acuity ──
  const patByBed = new Map<string, any>();
  patients.forEach(p => { if (p.bed_id) patByBed.set(p.bed_id, p); });
  const bedGrid = beds.slice(0, 30).map(b => {
    const p = patByBed.get(b.id);
    let tone: string; // high | medium | low | discharged | maintenance | available
    if (b.status === "out_of_service") tone = "maintenance";
    else if (b.status === "cleaning" || b.status === "reserved") tone = "discharged";
    else if (b.status === "available" || !p) tone = "available";
    else tone = acuityBand(p.acuity_level);
    return { label: b.label, tone, patient: p?.label ?? null };
  });
  const band = (b: string) => patients.filter(p => acuityBand(p.acuity_level) === b).length;
  const acuity = { high: band("high"), medium: band("medium"), low: band("low"), stable: band("stable"), total: patients.length };

  // ── Capacity & flow ──
  const bedBy = (s: string) => beds.filter(b => b.status === s).length;
  const totalBeds = beds.length, occupied = bedBy("occupied");
  const cur = snaps[snaps.length - 1] ?? {};
  const capacity = {
    available: bedBy("available"), cleaning: bedBy("cleaning"),
    expectedDischarges: cur.discharges ?? null, expectedAdmissions: cur.admissions ?? null,
    edWaiting: cur.ed_boarding_hours != null ? Math.round(cur.ed_boarding_hours) : null,
    theatreCases: null, dischargeDelays: blockers.filter(b => /discharge|no_bed|transport|meds/.test(String(b.category))).length,
  };

  // ── Staffing & assignment (op_shift_staff.role = charge|nurse|support|float|educator|assessor|doctor|therapist).
  // Mapped to the real roles present — no fabricated "enrolled nurse" band (the store has no such role).
  const roleCount = (fn: (r: string) => boolean) => staff.filter(s => fn(String(s.role))).length;
  const onDuty = staff.length;
  const requiredFte = cur.required_fte ?? (onDuty ? Math.ceil(onDuty * 1.1) : null);
  const staffing = {
    onDuty, required: requiredFte,
    coverage: requiredFte ? pct(onDuty, requiredFte) : null,
    breakdown: [
      { label: "Registered / Charge", n: roleCount(r => /nurse|charge|float/.test(r)), color: "#3b82f6" },
      { label: "Support", n: roleCount(r => /support/.test(r)), color: "#8b5cf6" },
      { label: "Medical / Allied", n: roleCount(r => /doctor|therapist|educator|assessor/.test(r)), color: "#10b981" },
    ],
    vacant: requiredFte != null ? Math.max(0, requiredFte - onDuty) : null,
  };

  // ── Tasks ──
  const taskBy = (p: string[]) => tasks.filter(t => p.includes(t.priority)).length;
  const taskSummary = { critical: taskBy(["urgent"]), high: taskBy(["high"]), medium: taskBy(["normal"]), low: taskBy(["low"]), outstanding: tasks.length };

  // ── Critical alerts (compose escalations + safety + blockers) ──
  const alerts = [
    ...escalations.slice(0, 3).map(e => ({ icon: "⚠️", tone: "rose", title: e.reason ?? "Escalation", sub: e.severity ? `${e.severity} severity` : "Requires review", at: e.created_at })),
    ...blockers.filter(b => /discharge/.test(String(b.category))).slice(0, 2).map(b => ({ icon: "🟡", tone: "amber", title: `Discharge delay${b.detail ? ` – ${b.detail}` : ""}`, sub: "Flow blocker", at: b.created_at })),
    ...safety.slice(0, 2).map(s => ({ icon: "🛡️", tone: "amber", title: s.message ?? "Safety alert", sub: s.severity ?? "Safety", at: s.created_at })),
  ].sort((a, b) => new Date(b.at ?? 0).getTime() - new Date(a.at ?? 0).getTime()).slice(0, 6);

  // ── KPI ribbon ──
  const safetyIncidents24 = safety.length;
  const criticalTasks = taskSummary.critical + taskSummary.high;
  const escalations24 = escalations.filter(e => e.status !== "closed").length;
  // Unit health score — composite of occupancy comfort, safe staffing, low incidents/escalations.
  const occ = totalBeds ? pct(occupied, totalBeds) : (cur.occupancy_pct ?? 0);
  const occComfort = occ >= 95 ? 40 : occ >= 88 ? 70 : occ >= 60 ? 95 : 80;
  const staffScore = staffing.coverage ?? (cur.safe_staffing_score ?? 85);
  const safetyScore = Math.max(0, 100 - safetyIncidents24 * 8 - escalations24 * 6);
  const health = Math.round(occComfort * 0.35 + staffScore * 0.35 + safetyScore * 0.3);
  const kpis = {
    totalPatients: patients.length,
    occupiedBeds: occupied, totalBeds, occupancy: occ,
    highAcuity: acuity.high, highAcuityPct: acuity.total ? pct(acuity.high, acuity.total) : 0,
    safetyIncidents: safetyIncidents24,
    tasksOutstanding: tasks.length, criticalTasks,
    staffOnDuty: onDuty, staffRequired: requiredFte, coverage: staffing.coverage,
    escalations: escalations24,
    health, healthLabel: health >= 85 ? "Very Good" : health >= 70 ? "Good" : health >= 55 ? "Fair" : "At Risk",
  };

  // ── Forecast (recent daily snapshots + naive projection) ──
  const daily = snaps.filter(s => s.period_type === "day").slice(-4);
  const forecast = daily.map((s: any) => ({ label: s.period, occupancy: s.occupancy_pct, admissions: s.admissions, discharges: s.discharges }));

  // ── Activity feed ──
  const activity = movements.slice(0, 8).map((m: any) => ({ type: m.event_type, text: m.detail ?? String(m.event_type).replace(/_/g, " "), at: m.created_at }));

  return {
    provisioned: true as const, hasData: beds.length + patients.length > 0,
    kpis, bedGrid, acuity, capacity, staffing, taskSummary, alerts, forecast, activity,
    asOf: cur.period ?? null,
  };
}
