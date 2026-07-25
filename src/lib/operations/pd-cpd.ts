// Professional Development & CPD Management (LDS-003) — the Unit Manager's PD/CPD oversight over the
// unit's CPD ledger (cpd_logs, base schema; user-scoped, so scoped here via hospital staff) + expiring
// professional credentials. Real: CPD points, approved/awaiting-validation counts, by-category and
// by-delivery-method breakdown, monthly CPD trend, top contributors, recent activities and expiring
// certificates. Honest next-phase: the annual CPD target, development-plan progress, development goals,
// reflections and CPD-by-competency-domain — none has a store. Tenant-scoped; fail-soft.
/* eslint-disable @typescript-eslint/no-explicit-any */
const NONE = "00000000-0000-0000-0000-000000000000";
const TARGET = 25; // default annual CPD points target per staff (honest — configurable store is next-phase)
const yearStart = () => `${new Date().getFullYear()}-01-01`;
const METHOD_LABEL: Record<string, string> = { course: "Classroom", workshop: "Workshop", conference: "Conference", self_study: "Self-Directed", simulation: "Simulation", osce: "OSCE" };
const ml = (m: string) => METHOD_LABEL[m] ?? (m ?? "Activity").replace(/_/g, " ");

export async function loadPdCpd(admin: any, hid: string | null, isSuper: boolean) {
  const YS = yearStart();

  // Staff in scope (cpd_logs is user-scoped → resolve the unit's staff).
  let staffIds: string[] = [];
  try {
    const { data } = isSuper ? await admin.from("profiles").select("id").limit(20000)
      : await admin.from("profiles").select("id").eq("hospital_id", hid ?? NONE).limit(20000);
    staffIds = (data ?? []).map((p: any) => p.id);
  } catch { /* fail-soft */ }

  let provisioned = true;
  let cpd: any[] = [];
  try {
    const base = admin.from("cpd_logs").select("id, activity_type, title, hours, cpd_points, activity_date, verified, certificate_url, created_at, user_id, profiles!user_id(full_name, role)").gte("activity_date", YS);
    const q = isSuper ? base.limit(20000) : (staffIds.length ? base.in("user_id", staffIds).limit(20000) : base.eq("user_id", NONE));
    const { data, error } = await q;
    if (error) throw error;
    cpd = data ?? [];
  } catch { provisioned = false; cpd = []; }

  const pts = (e: any) => e.cpd_points ?? 0;
  const pointsEarned = cpd.reduce((n, e) => n + pts(e), 0);
  const approved = cpd.filter(e => e.verified).length;
  const awaiting = cpd.filter(e => !e.verified).length;
  const learners = new Map<string, { name: string; role: string; points: number }>();
  cpd.forEach(e => { const g = learners.get(e.user_id) ?? { name: e.profiles?.full_name ?? "—", role: (e.profiles?.role ?? "").replace(/_/g, " "), points: 0 }; g.points += pts(e); learners.set(e.user_id, g); });
  const learnerArr = [...learners.values()];

  const kpis = {
    pointsEarned: +pointsEarned.toFixed(1),
    approved, awaiting,
    activeLearners: learnerArr.length,
    avgPerStaff: learnerArr.length ? +(pointsEarned / learnerArr.length).toFixed(1) : 0,
    meetingTarget: learnerArr.filter(l => l.points >= TARGET).length,
    target: TARGET,
  };

  // By delivery method / category (activity_type → points).
  const byMethodMap = new Map<string, { points: number; count: number }>();
  cpd.forEach(e => { const k = ml(e.activity_type); const g = byMethodMap.get(k) ?? { points: 0, count: 0 }; g.points += pts(e); g.count++; byMethodMap.set(k, g); });
  const byMethod = [...byMethodMap.entries()].map(([name, g]) => ({ name, points: +g.points.toFixed(1), count: g.count })).sort((a, b) => b.points - a.points);
  const methodTotal = byMethod.reduce((n, m) => n + m.points, 0) || 1;
  const byMethodPct = byMethod.map(m => ({ ...m, pct: Math.round((m.points / methodTotal) * 100) }));

  // Monthly CPD points trend (this year).
  const monthly = new Array(12).fill(0);
  cpd.forEach(e => { const m = e.activity_date ? new Date(e.activity_date).getMonth() : null; if (m != null) monthly[m] += pts(e); });
  const monthlyTrend = monthly.map(v => +v.toFixed(1));

  // Top contributors + recent + awaiting-validation list.
  const topContributors = learnerArr.sort((a, b) => b.points - a.points).slice(0, 6);
  const recent = [...cpd].sort((a, b) => (b.activity_date ?? b.created_at ?? "").localeCompare(a.activity_date ?? a.created_at ?? "")).slice(0, 8)
    .map(e => ({ name: e.profiles?.full_name ?? "—", title: e.title, category: ml(e.activity_type), points: pts(e), date: e.activity_date, verified: e.verified }));
  const awaitingList = cpd.filter(e => !e.verified).slice(0, 6).map(e => ({ name: e.profiles?.full_name ?? "—", title: e.title, points: pts(e), date: e.activity_date }));

  // Expiring certificates (professional_credentials, ≤90 days) — scoped via staff.
  let expiringCerts = 0;
  try {
    const T = new Date().toISOString().slice(0, 10); const d90 = (() => { const d = new Date(); d.setDate(d.getDate() + 90); return d.toISOString().slice(0, 10); })();
    const base = admin.from("professional_credentials").select("expiry_date");
    const q = isSuper ? base.limit(20000) : (staffIds.length ? base.in("nurse_id", staffIds).limit(20000) : null);
    if (q) { const { data } = await q; expiringCerts = (data ?? []).filter((c: any) => c.expiry_date && c.expiry_date >= T && c.expiry_date <= d90).length; }
  } catch { /* fail-soft */ }

  return {
    provisioned, ready: provisioned, hasData: cpd.length > 0,
    kpis, byMethod: byMethodPct, monthlyTrend, topContributors, recent, awaitingList, expiringCerts,
  };
}
