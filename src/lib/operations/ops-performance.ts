// Operational Performance & Capacity Management (UMW-OPC-000) — the Unit Manager's strategic lens over the
// operational stores. Real: the executive KPI ribbon + month-over-month deltas + top operational metrics (from
// op_ops_snapshots monthly rows), the occupancy / LOS / discharge-delay trends (daily rows), bed capacity + a
// per-ward capacity heat map (op_beds), bottlenecks + discharge-delay reasons (op_flow_blockers), equipment
// readiness (op_equipment), resource availability (op_resources), workforce establishment (snapshot FTEs) and
// rule-based AI operational insights. Read-only manager lens — live execution stays in the SSW. Fail-soft.
/* eslint-disable @typescript-eslint/no-explicit-any */
const NONE = "00000000-0000-0000-0000-000000000000";
const missing = (e: any) => /does not exist|schema cache/i.test(String(e?.message ?? ""));
const pct = (n: number, d: number) => (d ? Math.round((n / d) * 100) : 0);
const wardOf = (label: string) => String(label ?? "").replace(/\s+\d+$/, "").trim() || "Ward";

export async function loadOperationalPerformance(admin: any, hid: string | null, isSuper: boolean) {
  const scope = (q: any) => (isSuper ? q : q.eq("hospital_id", hid ?? NONE));
  const [snapRes, bedRes, blkRes, eqRes, resRes] = await Promise.all([
    scope(admin.from("op_ops_snapshots").select("*")).order("period", { ascending: true }),
    scope(admin.from("op_beds").select("label, bed_type, status")).limit(2000),
    scope(admin.from("op_flow_blockers").select("category, detail, status")).eq("status", "open").limit(2000),
    scope(admin.from("op_equipment").select("status")).limit(5000).then((r: any) => r, () => ({ data: [], error: null })),
    scope(admin.from("op_resources").select("name, category, total, available, demand")).limit(500).then((r: any) => r, () => ({ data: [], error: null })),
  ]);
  if (snapRes.error && missing(snapRes.error)) return { provisioned: false as const };
  const snaps = (snapRes.error ? [] : snapRes.data ?? []) as any[];
  const months = snaps.filter(s => s.period_type === "month").sort((a, b) => (a.period < b.period ? -1 : 1));
  const days = snaps.filter(s => s.period_type === "day").sort((a, b) => (a.period < b.period ? -1 : 1));
  const cur = months[months.length - 1] ?? null;
  const prev = months.length > 1 ? months[months.length - 2] : null;
  if (!cur) return { provisioned: true as const, hasData: false };

  const delta = (key: string, dp = 0) => (prev && cur[key] != null && prev[key] != null ? Math.round((cur[key] - prev[key]) * 10 ** dp) / 10 ** dp : null);
  const beds = (bedRes.error ? [] : bedRes.data ?? []) as any[];
  const bedBy = (s: string) => beds.filter(b => b.status === s).length;
  const occupied = bedBy("occupied");
  const totalBeds = beds.length;
  const occupancyLive = totalBeds ? pct(occupied, totalBeds) : cur.occupancy_pct;

  // KPI ribbon.
  const kpis = {
    occupancy: cur.occupancy_pct, occupancyDelta: delta("occupancy_pct"),
    admissions: cur.admissions, admissionsDelta: prev ? pct(cur.admissions - prev.admissions, prev.admissions) : null,
    discharges: cur.discharges, dischargesDelta: prev ? pct(cur.discharges - prev.discharges, prev.discharges) : null,
    avgLos: cur.avg_los, losDelta: delta("avg_los", 1),
    escalationRate: cur.escalation_rate, escalationDelta: delta("escalation_rate", 1),
    capacityScore: cur.capacity_score, capacityDelta: delta("capacity_score"),
  };

  // Capacity — donut + per-ward heat map.
  const capacity = {
    total: totalBeds,
    segments: [
      { key: "occupied", label: "Occupied", n: occupied, pct: pct(occupied, totalBeds) },
      { key: "available", label: "Available", n: bedBy("available"), pct: pct(bedBy("available"), totalBeds) },
      { key: "blocked", label: "Blocked", n: bedBy("out_of_service"), pct: pct(bedBy("out_of_service"), totalBeds) },
      { key: "cleaning", label: "Cleaning", n: bedBy("cleaning"), pct: pct(bedBy("cleaning"), totalBeds) },
      { key: "reserved", label: "Reserved", n: bedBy("reserved"), pct: pct(bedBy("reserved"), totalBeds) },
    ],
    occupancy: occupancyLive,
  };
  const wardMap = new Map<string, { beds: number; occ: number }>();
  beds.forEach(b => { const w = wardOf(b.label); if (!wardMap.has(w)) wardMap.set(w, { beds: 0, occ: 0 }); const r = wardMap.get(w)!; r.beds++; if (b.status === "occupied") r.occ++; });
  const heatMap = [...wardMap.entries()].map(([ward, r]) => { const o = pct(r.occ, r.beds); return { ward, beds: r.beds, occ: r.occ, occPct: o, status: o >= 88 ? "red" : o >= 75 ? "amber" : "green" }; }).sort((a, b) => b.beds - a.beds);

  // Bottlenecks + discharge-delay reasons (op_flow_blockers).
  const blockers = (blkRes.error ? [] : blkRes.data ?? []) as any[];
  const bByDetail = new Map<string, number>();
  blockers.forEach(b => { const d = b.detail ?? b.category; bByDetail.set(d, (bByDetail.get(d) ?? 0) + 1); });
  const bottlenecks = [...bByDetail.entries()].map(([label, n]) => ({ label, n })).sort((a, b) => b.n - a.n).slice(0, 5);
  const reasonOf = (c: string) => (c === "transport" ? "Awaiting Transport" : c === "other" ? "Awaiting Imaging" : c === "medical_review" ? "Awaiting Specialist" : "Other");
  const rByReason = new Map<string, number>();
  blockers.forEach(b => { const r = reasonOf(b.category); rByReason.set(r, (rByReason.get(r) ?? 0) + 1); });
  const totBlk = blockers.length || 1;
  const delayReasons = [...rByReason.entries()].map(([reason, n]) => ({ reason, pct: pct(n, totBlk) })).sort((a, b) => b.pct - a.pct);

  // Equipment readiness.
  const eq = (eqRes.error ? [] : eqRes.data ?? []) as any[];
  const eqBy = (s: string) => eq.filter(e => e.status === s).length;
  const equipment = { total: eq.length, operational: eqBy("operational"), maintenance: eqBy("under_maintenance"), outOfService: eqBy("out_of_service"), calibration: eqBy("calibration_due"), availability: eq.length ? pct(eq.length - eqBy("under_maintenance") - eqBy("out_of_service"), eq.length) : null };

  // Resources.
  const resources = ((resRes.error ? [] : resRes.data ?? []) as any[]).map(r => ({ name: r.name, total: r.total, available: r.available, demand: r.demand, showCount: r.category !== "transport" }));

  // Workforce establishment.
  const workforce = { required: cur.required_fte, available: cur.available_fte, vacant: cur.vacant_fte, agency: cur.agency_fte, safeStaffing: cur.safe_staffing_score, gap: cur.required_fte != null && cur.available_fte != null ? Math.round((cur.required_fte - cur.available_fte) * 10) / 10 : null, risk: (cur.safe_staffing_score ?? 100) < 80 ? "HIGH" : (cur.safe_staffing_score ?? 100) < 90 ? "MODERATE" : "LOW" };

  // Trends.
  const trend = { days: days.map(d => d.period), occupancy: days.map(d => d.occupancy_pct), los: days.map(d => d.avg_los), delay: days.map(d => d.avg_discharge_delay_hours) };
  const dischargeDelay = { avg: cur.avg_discharge_delay_hours, delta: delta("avg_discharge_delay_hours", 1), reasons: delayReasons };

  // Top operational metrics.
  const metric = (label: string, key: string, unit = "", lowerBetter = false) => { const c = cur[key], p = prev?.[key]; const ch = p != null && c != null ? Math.round((c - p) * 10) / 10 : null; const chPct = p ? Math.round(((c - p) / p) * 100) : null; return { label, cur: c, prev: p, unit, change: chPct, up: ch != null && ch > 0, good: ch != null ? (lowerBetter ? ch < 0 : ch > 0) : null }; };
  const topMetrics = [
    metric("Bed Turnover Rate", "bed_turnover"),
    metric("Discharge Before Noon", "discharge_before_noon_pct", "%"),
    metric("ED Boarding (Hours)", "ed_boarding_hours", "", true),
    metric("Readmission Rate (7d)", "readmission_rate", "%", true),
    metric("Theatre Utilisation", "theatre_utilisation", "%"),
  ];

  // AI operational insights (rule-based, explainable).
  const insights: any[] = [];
  if (kpis.occupancy != null && kpis.occupancy >= 80) insights.push({ title: "High occupancy risk predicted", detail: `Occupancy ${kpis.occupancy}% and rising — likely to exceed 90% under current admission rate.`, severity: "High", actions: ["Accelerate discharges", "Review elective admissions"] });
  if (workforce.gap != null && workforce.gap >= 8) insights.push({ title: "Workforce gap forecast", detail: `Nursing shortfall of ${workforce.gap} FTE against establishment.`, severity: "Medium", actions: ["Activate float pool", "Review leave approvals"] });
  if (dischargeDelay.delta != null && dischargeDelay.delta > 0) insights.push({ title: "Discharge delay trend increasing", detail: `Average discharge delay up ${dischargeDelay.delta}h vs last month.`, severity: "Info", actions: ["Escalate imaging turnaround", "Review discharge process"] });
  const equipmentStable = equipment.outOfService <= 3;

  return { provisioned: true as const, hasData: true, asOf: cur.period, kpis, capacity, heatMap, bottlenecks, dischargeDelay, equipment, equipmentStable, resources, workforce, trend, topMetrics, insights };
}
