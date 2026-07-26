// HEX-004 Workforce Intelligence (executive lens) — composes the real HR dashboard loader
// (loadHrDashboard → headcount / employment lifecycle / establishment & vacancy / competency /
// mandatory-learning compliance) and layers executive analytics that loader doesn't expose: a
// 6-month competency-readiness trend (competency_readiness_snapshots), live safe-staffing FTEs
// (op_ops_snapshots, latest daily), a by-department vacancy breakdown (positions + active
// workforce_assignments + departments) and turnover derived from employment_records separations
// over the last 12 months. Recruitment pipeline, succession and forecasting need dedicated stores —
// reported honestly, never faked. Tenant-scoped and fail-soft (nulls where a store is absent).
/* eslint-disable @typescript-eslint/no-explicit-any */
import { loadHrDashboard } from "@/lib/hr-data";

const NONE = "00000000-0000-0000-0000-000000000000";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const num = (v: any) => (v == null ? null : Number(v));
const pct = (n: number, d: number) => (d ? Math.round((n / d) * 100) : 0);

export async function loadExecWorkforce(admin: any, hid: string | null, isSuper: boolean) {
  const scope = (q: any) => (isSuper ? q : q.eq("hospital_id", hid ?? NONE));
  const hr = await loadHrDashboard(admin, hid, isSuper);
  const { headcount, employment, positions, competency, learning } = hr;

  // Pre-migration / no-data: loadHrDashboard returns all-zero (never throws).
  const empty = headcount.total === 0 && positions.establishment === 0;

  // ── Workforce composition (mutually-exclusive categories from loadHrDashboard headcount).
  const composition = [
    { label: "Nurses", value: headcount.nurse, tone: "teal" },
    { label: "Assessors", value: headcount.assessor, tone: "blue" },
    { label: "Educators", value: headcount.educator, tone: "violet" },
    { label: "Admin / leadership", value: headcount.admin, tone: "amber" },
    { label: "Other", value: headcount.other, tone: "slate" },
  ].filter(s => s.value > 0);

  // ── Establishment vs filled (Workforce Assignment Engine, via loadHrDashboard positions).
  const filledPct = pct(positions.filled, positions.establishment);
  const vacancyPct = pct(positions.vacant, positions.establishment);

  // ── Competency readiness — latest snapshot readiness_score + a 6-month month-latest trend.
  let readinessScore: number | null = null;
  let readinessDelta: number | null = null;
  let readinessTrend: { label: string; value: number }[] = [];
  try {
    const { data } = await scope(admin.from("competency_readiness_snapshots").select("snapshot_date, readiness_score").order("snapshot_date", { ascending: false }).limit(200));
    const rows = (data ?? []) as any[];
    if (rows.length && rows[0].readiness_score != null) readinessScore = Math.round(Number(rows[0].readiness_score));
    const m = new Map<string, number>();
    rows.forEach(s => { const k = String(s.snapshot_date).slice(0, 7); if (!m.has(k) && s.readiness_score != null) m.set(k, Math.round(Number(s.readiness_score))); });
    readinessTrend = [...m.entries()].sort((a, b) => a[0].localeCompare(b[0])).slice(-6).map(([k, v]) => ({ label: MONTHS[Number(k.slice(5, 7)) - 1], value: v }));
    if (readinessTrend.length >= 2) readinessDelta = readinessTrend[readinessTrend.length - 1].value - readinessTrend[readinessTrend.length - 2].value;
  } catch { /* optional store */ }

  // ── Live safe-staffing FTEs (latest daily operational snapshot).
  let staffing: { required: number | null; available: number | null; vacant: number | null; agency: number | null; safeStaffing: number | null } | null = null;
  try {
    const { data } = await scope(admin.from("op_ops_snapshots").select("required_fte, available_fte, vacant_fte, agency_fte, safe_staffing_score, period").eq("period_type", "day").order("period", { ascending: false }).limit(1));
    const s = (data ?? [])[0];
    if (s && (s.required_fte != null || s.safe_staffing_score != null || s.available_fte != null)) {
      staffing = { required: num(s.required_fte), available: num(s.available_fte), vacant: num(s.vacant_fte), agency: num(s.agency_fte), safeStaffing: num(s.safe_staffing_score) };
    }
  } catch { /* optional store */ }

  // ── Vacancy intelligence by department (active positions vs active assignments + department names).
  let vacancyByDept: { label: string; establishment: number; vacant: number; pct: number }[] = [];
  try {
    const { data: pos } = await scope(admin.from("positions").select("id, department_id").eq("status", "active").limit(3000));
    const posRows = (pos ?? []) as any[];
    if (posRows.length) {
      const posIds = posRows.map(p => p.id);
      const { data: asg } = await admin.from("workforce_assignments").select("position_id").eq("status", "active").in("position_id", posIds).limit(5000);
      const filledSet = new Set((asg ?? []).map((a: any) => a.position_id));
      const deptIds = [...new Set(posRows.map(p => p.department_id).filter(Boolean))];
      const nameById = new Map<string, string>();
      if (deptIds.length) { const { data: depts } = await admin.from("departments").select("id, name").in("id", deptIds); (depts ?? []).forEach((d: any) => nameById.set(d.id, d.name)); }
      const byDept = new Map<string, { est: number; filled: number }>();
      posRows.forEach(p => { const key = p.department_id ?? "__none"; const e = byDept.get(key) ?? { est: 0, filled: 0 }; e.est++; if (filledSet.has(p.id)) e.filled++; byDept.set(key, e); });
      vacancyByDept = [...byDept.entries()]
        .map(([id, v]) => ({ label: id === "__none" ? "Unassigned to a department" : (nameById.get(id) ?? "Department"), establishment: v.est, vacant: Math.max(0, v.est - v.filled), pct: pct(v.est - v.filled, v.est) }))
        .filter(d => d.vacant > 0)
        .sort((a, b) => b.vacant - a.vacant)
        .slice(0, 8);
    }
  } catch { /* optional store */ }

  // ── Turnover — distinct separations (employment_records end-dates) over the last 12 months as a
  //    share of current active headcount, plus a 6-month monthly-separations trend. Honest null if
  //    no active headcount to divide by.
  let turnover: number | null = null;
  let turnoverTrend: { label: string; value: number }[] = [];
  try {
    const { data } = await scope(admin.from("employment_records").select("nurse_id, end_date").limit(20000));
    const rows = ((data ?? []) as any[]).filter(r => r.end_date);
    const now = new Date();
    const yearAgo = new Date(); yearAgo.setFullYear(yearAgo.getFullYear() - 1);
    const yearAgoIso = yearAgo.toISOString().slice(0, 10);
    const leavers12 = new Set(rows.filter(r => r.end_date >= yearAgoIso).map(r => r.nurse_id)).size;
    if (employment.active > 0) turnover = Math.round((leavers12 / employment.active) * 100);
    const buckets = new Map<string, number>();
    for (let i = 5; i >= 0; i--) { const dt = new Date(now.getFullYear(), now.getMonth() - i, 1); buckets.set(`${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}`, 0); }
    rows.forEach(r => { const k = String(r.end_date).slice(0, 7); if (buckets.has(k)) buckets.set(k, (buckets.get(k) ?? 0) + 1); });
    turnoverTrend = [...buckets.entries()].map(([k, v]) => ({ label: MONTHS[Number(k.slice(5, 7)) - 1], value: v }));
  } catch { /* pre-migration */ }
  const hasTurnoverTrend = turnoverTrend.some(t => t.value > 0);

  return {
    provisioned: true as const,
    empty,
    kpis: {
      total: headcount.total,
      establishment: positions.establishment, filled: positions.filled, filledPct,
      vacant: positions.vacant, vacancyPct,
      readiness: readinessScore ?? (competency.total ? competency.coverage : null),
      coverage: competency.coverage,
      learningCompliance: learning.compliance, learningTotal: learning.total, learningCompleted: learning.completed,
      turnover,
    },
    composition,
    employment,
    competency,
    readinessScore, readinessDelta, readinessTrend,
    staffing,
    vacancyByDept,
    turnover, turnoverTrend, hasTurnoverTrend,
  };
}
