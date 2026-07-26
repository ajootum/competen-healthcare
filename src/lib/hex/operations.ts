// HEX-006 Operations Intelligence (executive lens) — the enterprise operational picture over the live
// operational stores: the daily op_ops_snapshots aggregate (occupancy / LOS / throughput / theatre / safe
// staffing / capacity score + a 6-month occupancy trend), op_beds by status, op_patients by operational
// status (flow), open op_escalations + active op_safety_alerts (alerts) and op_equipment / op_resources
// readiness. All real, tenant-scoped; snapshot figures still render when live bed/patient detail is empty.
/* eslint-disable @typescript-eslint/no-explicit-any */

const NONE = "00000000-0000-0000-0000-000000000000";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const num = (v: any) => (v == null ? null : Number(v));
const soft = (p: any) => p.then((r: any) => r, () => ({ data: [], error: null }));

const SEV_TONE: Record<string, string> = { critical: "red", emergency: "rose", high: "amber", urgent: "amber", routine: "slate" };
const STATUS_TONE: Record<string, string> = { open: "rose", acknowledged: "amber", resolved: "emerald", cancelled: "slate" };

export async function loadExecOperations(admin: any, hid: string | null, isSuper: boolean) {
  const scope = (q: any) => (isSuper ? q : q.eq("hospital_id", hid ?? NONE));

  // op_ops_snapshots is the aggregate spine + provisioning probe.
  const snapRes = await scope(admin.from("op_ops_snapshots").select("*").order("period", { ascending: true }).limit(400)).then((r: any) => r, (e: any) => ({ error: e }));
  if (snapRes.error) return { provisioned: false as const };
  const snaps = (snapRes.data ?? []) as any[];
  const daily = snaps.filter(s => s.period_type === "day");
  const cur = daily[daily.length - 1] ?? {};

  // Live operational detail — fail-soft per table so snapshot figures still stand if a store is empty.
  const [bedRes, patRes, escRes, safRes, eqRes, resRes] = await Promise.all([
    soft(scope(admin.from("op_beds").select("status").limit(1000))),
    soft(scope(admin.from("op_patients").select("operational_status").limit(2000))),
    soft(scope(admin.from("op_escalations").select("summary, severity, level, status, created_at").order("created_at", { ascending: false }).limit(200))),
    soft(scope(admin.from("op_safety_alerts").select("active").limit(500))),
    soft(scope(admin.from("op_equipment").select("status").limit(500))),
    soft(scope(admin.from("op_resources").select("category, total, available").limit(200))),
  ]);
  const beds = (bedRes.data ?? []) as any[];
  const patients = (patRes.data ?? []) as any[];
  const escalations = (escRes.data ?? []) as any[];
  const safety = (safRes.data ?? []) as any[];
  const equipment = (eqRes.data ?? []) as any[];
  const resources = (resRes.data ?? []) as any[];

  // ── Headline KPIs from the latest daily snapshot (numeric columns arrive as strings → Number()).
  const capacityScore = num(cur.capacity_score);
  const occupancy = num(cur.occupancy_pct);
  const admissions = num(cur.admissions);
  const discharges = num(cur.discharges);
  const throughput = (admissions != null || discharges != null) ? (admissions ?? 0) + (discharges ?? 0) : null;
  const avgLos = num(cur.avg_los);
  const theatre = num(cur.theatre_utilisation);
  const dischargeNoon = num(cur.discharge_before_noon_pct);
  const safeStaffing = num(cur.safe_staffing_score);

  // Open operational alerts = open escalations (not resolved/cancelled) + active safety alerts.
  const openEsc = escalations.filter(e => !["resolved", "cancelled"].includes(String(e.status))).length;
  const activeSafety = safety.filter(s => s.active === true).length;
  const openAlerts = openEsc + activeSafety;

  // ── Bed capacity by status.
  const bedBy = (s: string) => beds.filter(b => b.status === s).length;
  const totalBeds = beds.length;
  const bedStatus = [
    { label: "Occupied", value: bedBy("occupied"), tone: "blue" },
    { label: "Available", value: bedBy("available"), tone: "emerald" },
    { label: "Cleaning", value: bedBy("cleaning"), tone: "amber" },
    { label: "Reserved", value: bedBy("reserved"), tone: "violet" },
    { label: "Out of service", value: bedBy("out_of_service"), tone: "rose" },
  ];

  // ── Patient flow by operational_status (+ snapshot admissions/discharges).
  const flowBy = (s: string) => patients.filter(p => p.operational_status === s).length;
  const flow = {
    total: patients.length,
    expected: flowBy("expected"),
    admitted: flowBy("admitted"),
    transferPending: flowBy("transfer_pending"),
    dischargePending: flowBy("discharge_pending"),
    discharged: flowBy("discharged"),
    admissions, discharges,
  };

  // ── Operational alerts — recent escalations (already newest-first) with semantic pills.
  const alerts = escalations.slice(0, 7).map(e => ({
    summary: e.summary ?? "Escalation",
    level: e.level != null ? Number(e.level) : null,
    severity: String(e.severity ?? "routine"),
    sevTone: SEV_TONE[String(e.severity)] ?? "slate",
    status: String(e.status ?? "open"),
    statusTone: STATUS_TONE[String(e.status)] ?? "slate",
    at: e.created_at ? String(e.created_at).slice(0, 10) : "—",
  }));

  // ── Performance by domain — snapshot metrics that are naturally 0-100 (honest; counts excluded).
  const domains: { label: string; pct: number }[] = [];
  const pushDom = (label: string, v: number | null) => { if (v != null) domains.push({ label, pct: Math.max(0, Math.min(100, Math.round(v))) }); };
  pushDom("Capacity score", capacityScore);
  pushDom("Bed occupancy", occupancy);
  pushDom("Discharge before noon", dischargeNoon);
  pushDom("Theatre utilisation", theatre);
  pushDom("Safe staffing", safeStaffing);

  // ── Occupancy trend (6 months) — latest daily snapshot per month, falling back to monthly rows.
  let trend: { label: string; value: number }[] = [];
  const bucket = new Map<string, number>();
  daily.forEach(s => { if (s.occupancy_pct != null) bucket.set(String(s.period).slice(0, 7), Math.round(Number(s.occupancy_pct))); });
  trend = [...bucket.entries()].sort((a, b) => a[0].localeCompare(b[0])).slice(-6).map(([mk, v]) => ({ label: MONTHS[Number(mk.slice(5, 7)) - 1], value: v }));
  if (trend.length < 2) {
    const months = snaps.filter(s => s.period_type === "month" && s.occupancy_pct != null);
    trend = months.slice(-6).map(s => ({ label: MONTHS[Number(String(s.period).slice(5, 7)) - 1], value: Math.round(Number(s.occupancy_pct)) }));
  }

  // ── Facilities & equipment readiness.
  const eqBy = (s: string) => equipment.filter(e => e.status === s).length;
  const eqTotal = equipment.length;
  const equip = {
    total: eqTotal,
    readiness: eqTotal ? Math.round((eqBy("operational") / eqTotal) * 100) : null,
    donut: [
      { label: "Operational", value: eqBy("operational"), tone: "emerald" },
      { label: "Calibration due", value: eqBy("calibration_due"), tone: "amber" },
      { label: "Under maintenance", value: eqBy("under_maintenance"), tone: "violet" },
      { label: "Out of service", value: eqBy("out_of_service"), tone: "rose" },
    ],
  };

  // ── Resource availability (available vs total by category).
  const resCats = [...new Set(resources.map(r => String(r.category)))];
  const resource = resCats.map(cat => {
    const rows = resources.filter(r => String(r.category) === cat);
    const total = rows.reduce((a, r) => a + Number(r.total ?? 0), 0);
    const avail = rows.reduce((a, r) => a + Number(r.available ?? 0), 0);
    return { label: cat.replace(/_/g, " "), pct: total ? Math.round((avail / total) * 100) : 0, value: `${avail}/${total}` };
  });

  return {
    provisioned: true as const,
    asOf: cur.period ?? null,
    hasBeds: totalBeds > 0,
    hasPatients: patients.length > 0,
    kpis: { capacityScore, occupancy, throughput, admissions, discharges, avgLos, theatre, dischargeNoon, safeStaffing, openAlerts, openEsc, activeSafety },
    bedStatus, totalBeds,
    flow,
    alerts,
    domains,
    trend,
    equip,
    resource,
  };
}
