// Scenario Planner (WSE-001G) — what-if workforce modelling. Re-runs the real solver
// (computeRoster) with modified inputs for each scenario and compares the resulting
// coverage / competency / fairness / quality / cost against the baseline — WITHOUT
// altering any live roster (calculations are transient). Scenarios model real levers:
// staff absence, patient surge, added bank capacity and budget cuts. Hypothetical added
// capacity is clearly labelled (bank staff aren't real people — it's a planning input).
/* eslint-disable @typescript-eslint/no-explicit-any */
import { gatherRosterInputs, computeRoster, mondayOf } from "@/lib/operations/roster-solver";

type Inputs = { units: any[]; pool: any[]; validSet: Set<string>; deptIdByName: Map<string, string> };

// Remove n staff, preferring the most-numerous role (nurse) so supervisor cover survives.
function removeStaff(n: number) {
  return (i: Inputs): Inputs => {
    const order = [...i.pool].sort((a, b) => (a.role === "charge" ? 1 : 0) - (b.role === "charge" ? 1 : 0)); // charge last
    const removed = new Set(order.slice(order.length - n).map(s => s.id));
    return { ...i, pool: i.pool.filter(s => !removed.has(s.id)) };
  };
}
function scaleDemand(f: number) {
  return (i: Inputs): Inputs => ({ ...i, units: i.units.map(u => ({ ...u, roleReq: u.roleReq.map((r: any) => ({ ...r, perShift: r.role === "charge" ? r.perShift : Math.max(r.perShift, Math.ceil(r.perShift * f)) })) })) });
}
function addStaff(n: number, role: string) {
  return (i: Inputs): Inputs => {
    const extra = Array.from({ length: n }, (_, j) => ({ id: `hypo-${role}-${j}`, name: `Bank ${role} ${j + 1}`, role }));
    const validSet = new Set(i.validSet); extra.forEach(s => validSet.add(s.id));
    return { ...i, pool: [...i.pool, ...extra], validSet };
  };
}

export async function loadScenarioPlanner(admin: any, hid: string | null, isSuper: boolean) {
  const inputs = (await gatherRosterInputs(admin, hid, isSuper)) as Inputs | null;
  if (!inputs || inputs.units.length === 0) return { ready: false as const };
  const weekStart = mondayOf();
  const clinical = inputs.pool.length;
  const budgetCut = Math.max(1, Math.round(clinical * 0.1));

  const defs = [
    { key: "baseline", name: "Baseline", desc: "Current staff & demand", transform: (i: Inputs) => i },
    { key: "sick2", name: "Staff absence −2", desc: "2 clinical staff off sick", transform: removeStaff(2) },
    { key: "sick4", name: "Staff absence −4", desc: "4 clinical staff off sick", transform: removeStaff(4) },
    { key: "surge", name: "Patient surge +20%", desc: "20% occupancy surge → more posts", transform: scaleDemand(1.2) },
    { key: "bank3", name: "Add 3 bank RNs", desc: "Hypothetical +3 registered nurses", transform: addStaff(3, "nurse") },
    { key: "budget", name: `Budget cut −${budgetCut}`, desc: `~10% fewer staff (${budgetCut})`, transform: removeStaff(budgetCut) },
  ];

  const run = (t: (i: Inputs) => Inputs) => {
    const mod = t(inputs);
    return computeRoster(mod.units, mod.pool, mod.validSet, weekStart, mod.deptIdByName);
  };
  const results = defs.map(d => { const p = run(d.transform); return { ...d, ...p.scores, slotsFilled: p.slotsFilled, slotsTotal: p.slotsTotal }; });
  const base = results[0];

  const scenarios = results.map(r => ({
    key: r.key, name: r.name, desc: r.desc,
    coverage: r.coverage, competency: r.competency, fairness: r.fairness, quality: r.quality, estCost: r.estCost,
    slotsFilled: r.slotsFilled, slotsTotal: r.slotsTotal,
    dCoverage: r.coverage - base.coverage, dQuality: r.quality - base.quality, dCost: r.estCost - base.estCost,
    risk: r.coverage < 80 ? "High" : r.coverage < 90 ? "Medium" : "Low",
    isBase: r.key === "baseline",
  }));

  // AI recommendation — best non-baseline improvement + biggest risk
  const improvements = scenarios.filter(s => !s.isBase && s.dQuality > 0).sort((a, b) => b.dQuality - a.dQuality);
  const risks = scenarios.filter(s => !s.isBase && s.dCoverage < 0).sort((a, b) => a.dCoverage - b.dCoverage);
  const insights: { icon: string; text: string; tone: string }[] = [];
  if (improvements[0]) insights.push({ icon: "📈", text: `"${improvements[0].name}" improves quality by ${improvements[0].dQuality} pts (coverage ${improvements[0].coverage}%)`, tone: "green" });
  if (risks[0]) insights.push({ icon: "⚠", text: `"${risks[0].name}" drops coverage to ${risks[0].coverage}% (${risks[0].dCoverage} pts) — highest operational risk`, tone: "red" });
  const surge = scenarios.find(s => s.key === "surge");
  if (surge && surge.coverage < 90) insights.push({ icon: "🏥", text: `A patient surge leaves coverage at ${surge.coverage}% — pre-arrange bank/agency cover`, tone: "amber" });
  insights.push({ icon: "🔒", text: "Scenario calculations are transient — no live roster is altered", tone: "gray" });

  return { ready: true as const, weekStart, scenarios, baseline: base, insights, staffPool: clinical };
}
