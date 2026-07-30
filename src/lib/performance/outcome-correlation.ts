/* eslint-disable @typescript-eslint/no-explicit-any */
// CAPM-005 — Competency-to-Outcome Correlation Engine. The analytical core of CAPM: does higher competency go with
// better outcomes? It pairs, PER DEPARTMENT, the department's competency coverage (achieved share of its staff's
// latest competency_decisions, resolved via profiles.department_id) against a real clinical-safety outcome from
// op_observations (department_id native): observation compliance and escalation-triggered rate. Across departments
// it computes a Pearson correlation. This is an ECOLOGICAL correlation over aggregates (not per-nurse causal) and
// N is small, so it is presented as directional/indicative — the engine is honest about that. No migration.

type Admin = any;
const NONE = "00000000-0000-0000-0000-000000000000";
const ACHIEVED = ["competent", "competent_with_conditions", "provisionally_competent"];
const isMissing = (e: any) => /does not exist|schema cache/i.test(String(e?.message ?? ""));
const MIN_STAFF = 3;   // a department needs at least this many staff-with-decisions to score competency
const MIN_OBS = 5;     // …and this many observations to score an outcome
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const r1 = (n: number) => Math.round(n * 10) / 10;

function pearson(xs: number[], ys: number[]): number | null {
  const n = xs.length;
  if (n < 3) return null;
  const mx = mean(xs), my = mean(ys);
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) { const a = xs[i] - mx, b = ys[i] - my; num += a * b; dx += a * a; dy += b * b; }
  const den = Math.sqrt(dx * dy);
  return den > 0 ? Math.round((num / den) * 100) / 100 : null;
}
function interpret(r: number | null, positiveIsGood: boolean): { label: string; tone: string } {
  if (r == null) return { label: "Insufficient data", tone: "gray" };
  const good = positiveIsGood ? r : -r; // for "good" direction
  const mag = Math.abs(r);
  const strength = mag >= 0.5 ? "strong" : mag >= 0.3 ? "moderate" : mag >= 0.15 ? "weak" : "no";
  if (strength === "no") return { label: "No clear relationship", tone: "gray" };
  const dir = good > 0 ? "supports" : "counter to";
  return { label: `${strength} ${good > 0 ? "positive" : "negative"} — ${dir} the competency case`, tone: good > 0 ? "emerald" : "rose" };
}

export async function loadOutcomeCorrelation(admin: Admin, hid: string | null, isSuper: boolean) {
  const scope = (q: any) => (isSuper ? q : q.eq("hospital_id", hid ?? NONE));
  const probe = await admin.from("op_observations").select("id").limit(1);
  if (probe.error && isMissing(probe.error)) return { provisioned: false as const };

  // Departments in scope.
  const { data: depts, error: dErr } = await scope(admin.from("departments").select("id, name, hospital_id").limit(5000));
  if (dErr) return isMissing(dErr) ? { provisioned: false as const } : emptyResult();
  const deptList = (depts ?? []) as any[];
  if (!deptList.length) return emptyResult();
  const deptName = new Map(deptList.map(d => [d.id, d.name]));
  const deptIds = deptList.map(d => d.id);

  // Staff → department.
  const { data: profs } = await scope(admin.from("profiles").select("id, department_id").not("department_id", "is", null).limit(30000));
  const staffByDept = new Map<string, string[]>();
  const deptOfNurse = new Map<string, string>();
  for (const p of (profs ?? []) as any[]) { if (!staffByDept.has(p.department_id)) staffByDept.set(p.department_id, []); staffByDept.get(p.department_id)!.push(p.id); deptOfNurse.set(p.id, p.department_id); }
  const allNurseIds = [...deptOfNurse.keys()];
  if (!allNurseIds.length) return emptyResult();

  // Competency decisions for those staff → latest per (nurse, competency) → per-dept achieved share.
  const decByDept = new Map<string, { total: number; achieved: number }>();
  const seen = new Set<string>();
  for (let i = 0; i < allNurseIds.length; i += 2000) {
    const chunk = allNurseIds.slice(i, i + 2000);
    const { data } = await admin.from("competency_decisions").select("nurse_id, competency_id, outcome, created_at").in("nurse_id", chunk).order("created_at", { ascending: false }).limit(60000);
    for (const d of (data ?? []) as any[]) {
      const k = `${d.nurse_id}:${d.competency_id}`; if (seen.has(k)) continue; seen.add(k);
      const dept = deptOfNurse.get(d.nurse_id); if (!dept) continue;
      const g = decByDept.get(dept) ?? { total: 0, achieved: 0 }; g.total++; if (ACHIEVED.includes(d.outcome)) g.achieved++; decByDept.set(dept, g);
    }
  }

  // Observations per department → compliance + escalation rate.
  const obsByDept = new Map<string, { total: number; lapsed: number; escalated: number }>();
  const { data: obs } = await scope(admin.from("op_observations").select("department_id, status, escalation_triggered").in("department_id", deptIds.slice(0, 5000)).limit(80000));
  for (const o of (obs ?? []) as any[]) {
    if (!o.department_id) continue;
    const g = obsByDept.get(o.department_id) ?? { total: 0, lapsed: 0, escalated: 0 };
    g.total++; if (o.status === "missed" || o.status === "overdue") g.lapsed++; if (o.escalation_triggered) g.escalated++;
    obsByDept.set(o.department_id, g);
  }

  // Qualifying department pairs.
  const points = deptList.map(d => {
    const dec = decByDept.get(d.id); const ob = obsByDept.get(d.id);
    if (!dec || dec.total < MIN_STAFF || !ob || ob.total < MIN_OBS) return null;
    return {
      department: deptName.get(d.id) ?? "Department",
      competency: Math.round((dec.achieved / dec.total) * 100),
      compliance: Math.round(((ob.total - ob.lapsed) / ob.total) * 100),
      escalationRate: Math.round((ob.escalated / ob.total) * 100),
      staff: (staffByDept.get(d.id) ?? []).length, obs: ob.total,
    };
  }).filter(Boolean) as any[];
  points.sort((a, b) => b.competency - a.competency);

  if (points.length < 3) return { provisioned: true as const, empty: false, insufficient: true, n: points.length, points, kpis: emptyKpis(), complianceCorr: null, escalationCorr: null };

  const comp = points.map(p => p.competency);
  const complianceR = pearson(comp, points.map(p => p.compliance));
  const escalationR = pearson(comp, points.map(p => p.escalationRate));

  return {
    provisioned: true as const, empty: false, insufficient: false, n: points.length, points,
    kpis: {
      departments: points.length,
      avgCompetency: Math.round(mean(comp)),
      avgCompliance: Math.round(mean(points.map(p => p.compliance))),
      complianceR: complianceR ?? 0,
      escalationR: escalationR ?? 0,
      spread: r1(Math.max(...comp) - Math.min(...comp)),
    },
    complianceCorr: { r: complianceR, ...interpret(complianceR, true) },   // higher competency → higher compliance is good
    escalationCorr: { r: escalationR, ...interpret(escalationR, false) },  // higher competency → lower escalation is good
  };
}

function emptyKpis() { return { departments: 0, avgCompetency: 0, avgCompliance: 0, complianceR: 0, escalationR: 0, spread: 0 }; }
function emptyResult() { return { provisioned: true as const, empty: true, insufficient: false, n: 0, points: [] as any[], kpis: emptyKpis(), complianceCorr: null as any, escalationCorr: null as any }; }
