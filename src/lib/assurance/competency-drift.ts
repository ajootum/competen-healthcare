/* eslint-disable @typescript-eslint/no-explicit-any */
// CAPA-006 — Competency Drift Analytics. Detects how workforce competency changes OVER TIME, over the real
// decision history (competency_decisions: nurse_id, competency_id, outcome, maturity, expiry_date,
// critical_failure, version_num, created_at). The genuinely-new signal is LONGITUDINAL: for a person+competency
// reassessed more than once, compare the latest maturity/outcome against the prior one → real decay vs
// improvement (a lapse to 'expired' or a drop in Benner maturity = decay). Plus expiry pressure, a composite
// drift index, per-competency drift hotspots, and critical-competency risk. Enterprise-wide (super-admin
// assurance platform); if scoped, competency_decisions carries no hospital_id → resolve nurse ids via profiles.

type Admin = any;
const NONE = "00000000-0000-0000-0000-000000000000";
const ACHIEVED = ["competent", "competent_with_conditions", "provisionally_competent"];
const FAILING = ["not_yet_competent", "requires_remediation"];
// Benner-style maturity order (higher = more mature). Unknown values → skipped from movement calc.
const MATURITY: Record<string, number> = { novice: 1, advanced_beginner: 2, competent: 3, proficient: 4, expert: 5, mentor: 5, authority: 6 };
const isMissing = (e: any) => /does not exist|schema cache/i.test(String(e?.message ?? ""));
const monthKey = (iso: string) => iso.slice(0, 7);

export async function loadCompetencyDrift(admin: Admin, hid: string | null, isSuper: boolean) {
  const probe = await admin.from("competency_decisions").select("id").limit(1);
  if (probe.error && isMissing(probe.error)) return { provisioned: false as const };

  let dq = admin.from("competency_decisions").select("nurse_id, competency_id, outcome, maturity, expiry_date, critical_failure, version_num, created_at").order("created_at", { ascending: true }).limit(60000);
  if (!isSuper) {
    const { data: profs } = await admin.from("profiles").select("id").eq("hospital_id", hid ?? NONE).limit(20000);
    const ids = (profs ?? []).map((p: any) => p.id);
    dq = dq.in("nurse_id", ids.length ? ids.slice(0, 3000) : [NONE]);
  }
  const { data } = await dq;
  const decs = (data ?? []) as any[];
  if (!decs.length) return emptyResult();

  const today = new Date().toISOString().slice(0, 10);
  const in30 = new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10);

  // Group chronologically per (nurse, competency).
  const byKey = new Map<string, any[]>();
  for (const d of decs) { const k = `${d.nurse_id}:${d.competency_id}`; if (!byKey.has(k)) byKey.set(k, []); byKey.get(k)!.push(d); }

  const latest: any[] = [];
  type Move = { dir: "up" | "down"; nurse_id: string; competency_id: string; from: string | null; to: string | null };
  const movements: Move[] = [];
  for (const arr of byKey.values()) {
    const last = arr[arr.length - 1];
    latest.push(last);
    if (arr.length >= 2) {
      const prev = arr[arr.length - 2];
      const lm = MATURITY[last.maturity], pm = MATURITY[prev.maturity];
      if (lm && pm && lm !== pm) movements.push({ dir: lm > pm ? "up" : "down", nurse_id: last.nurse_id, competency_id: last.competency_id, from: prev.maturity, to: last.maturity });
      else if (last.outcome === "expired" && prev.outcome !== "expired") movements.push({ dir: "down", nurse_id: last.nurse_id, competency_id: last.competency_id, from: prev.outcome, to: "expired" });
      else if (FAILING.includes(last.outcome) && ACHIEVED.includes(prev.outcome)) movements.push({ dir: "down", nurse_id: last.nurse_id, competency_id: last.competency_id, from: prev.outcome, to: last.outcome });
    }
  }

  const total = latest.length;
  const expired = latest.filter(d => d.outcome === "expired" || (d.expiry_date && d.expiry_date < today));
  const expiring = latest.filter(d => d.expiry_date && d.expiry_date >= today && d.expiry_date <= in30 && d.outcome !== "expired");
  const achieved = latest.filter(d => ACHIEVED.includes(d.outcome));
  const failing = latest.filter(d => FAILING.includes(d.outcome));
  const decayed = movements.filter(m => m.dir === "down");
  const improved = movements.filter(m => m.dir === "up");

  // Composite drift index (0-100, higher = more drift/risk).
  const driftIndex = total ? Math.round((100 * (expired.length + expiring.length * 0.5 + failing.length)) / total) : 0;
  const highRiskStaff = new Set(latest.filter(d => d.critical_failure && (d.outcome === "expired" || FAILING.includes(d.outcome) || (d.expiry_date && d.expiry_date < today))).map(d => d.nurse_id)).size;

  // Per-competency drift leaderboard (highest drift rate among those with enough decisions).
  const perComp = new Map<string, { total: number; drifting: number }>();
  for (const d of latest) {
    const g = perComp.get(d.competency_id) ?? { total: 0, drifting: 0 };
    g.total++;
    if (d.outcome === "expired" || FAILING.includes(d.outcome) || (d.expiry_date && d.expiry_date < today)) g.drifting++;
    perComp.set(d.competency_id, g);
  }
  const compIds = [...perComp.keys()].filter(Boolean);
  const compName = new Map<string, string>();
  if (compIds.length) { const { data: cs } = await admin.from("framework_competencies").select("id, name").in("id", compIds.slice(0, 3000)); (cs ?? []).forEach((c: any) => compName.set(c.id, c.name)); }
  const hotspots = [...perComp.entries()]
    .filter(([, g]) => g.total >= 3 && g.drifting > 0)
    .map(([id, g]) => ({ competency: compName.get(id) ?? "Competency", total: g.total, drifting: g.drifting, rate: Math.round((g.drifting / g.total) * 100) }))
    .sort((a, b) => b.rate - a.rate || b.drifting - a.drifting).slice(0, 10);

  // Monthly outcome trend — of decisions MADE that month, % achieved. Last 8 months present.
  const byMonth = new Map<string, { total: number; achieved: number }>();
  for (const d of decs) { if (!d.created_at) continue; const m = monthKey(d.created_at); const g = byMonth.get(m) ?? { total: 0, achieved: 0 }; g.total++; if (ACHIEVED.includes(d.outcome)) g.achieved++; byMonth.set(m, g); }
  const trend = [...byMonth.entries()].sort((a, b) => a[0].localeCompare(b[0])).slice(-8)
    .map(([month, g]) => ({ month, pct: g.total ? Math.round((g.achieved / g.total) * 100) : 0, n: g.total }));

  // Recent decays with names, for the risk panel.
  const nurseIds = [...new Set(decayed.map(m => m.nurse_id))].slice(0, 200);
  const nurseName = new Map<string, string>();
  if (nurseIds.length) { const { data: ns } = await admin.from("profiles").select("id, full_name").in("id", nurseIds.slice(0, 3000)); (ns ?? []).forEach((p: any) => nurseName.set(p.id, p.full_name ?? "—")); }
  const recentDecays = decayed.slice(-15).reverse().map(m => ({ name: nurseName.get(m.nurse_id) ?? "—", competency: compName.get(m.competency_id) ?? "Competency", from: m.from, to: m.to }));

  return {
    provisioned: true as const, empty: false,
    kpis: {
      assessed: total,
      achievedPct: total ? Math.round((achieved.length / total) * 100) : 0,
      expired: expired.length,
      expiring: expiring.length,
      driftIndex,
      decayed: decayed.length,
      improved: improved.length,
      highRiskStaff,
    },
    reassessed: movements.length,
    hotspots, trend, recentDecays,
  };
}

function emptyResult() {
  return {
    provisioned: true as const, empty: true,
    kpis: { assessed: 0, achievedPct: 0, expired: 0, expiring: 0, driftIndex: 0, decayed: 0, improved: 0, highRiskStaff: 0 },
    reassessed: 0, hotspots: [] as any[], trend: [] as any[], recentDecays: [] as any[],
  };
}
