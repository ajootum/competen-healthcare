// Recommendation Engine (WSE-001I) — the AI decision-support orchestrator. Aggregates
// the outputs of the other scheduling engines (Scheduling/Demand recs + constraint alerts,
// Fairness rebalancing + bias, Competency high-risk replacements) into a single ranked,
// categorised recommendation feed with rationale, confidence and impact. It assists — it
// never bypasses a mandatory constraint, and the real action lives in the source engine.
// A recommendation-action store (accept/reject/defer + learning) is honest next-phase.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { loadSchedulingEngine } from "@/lib/operations/scheduling-engine";
import { loadFairnessEngine } from "@/lib/operations/fairness-engine";
import { loadCompetencyMatching } from "@/lib/operations/competency-matching";

const CAT = {
  roster: { label: "Roster improvement", icon: "🗓️", href: "/unit-manager/scheduling-engine" },
  redeploy: { label: "Redeployment", icon: "🔀", href: "/unit-manager/scheduling-engine/fairness" },
  overtime: { label: "Overtime reduction", icon: "⏰", href: "/unit-manager/scheduling-engine/cost" },
  competency: { label: "Competency gap", icon: "🎯", href: "/unit-manager/scheduling-engine/competency-matching" },
  cost: { label: "Cost saving", icon: "💷", href: "/unit-manager/scheduling-engine/cost" },
  safety: { label: "Patient safety", icon: "🛡️", href: "/unit-manager/scheduling-engine/constraints" },
  fairness: { label: "Fairness", icon: "⚖️", href: "/unit-manager/scheduling-engine/fairness" },
} as const;
type CatKey = keyof typeof CAT;
const IMPACT_W: Record<string, number> = { High: 3, Medium: 2, Low: 1 };

export async function loadRecommendations(admin: any, hid: string | null, isSuper: boolean) {
  const [sched, fair, comp] = await Promise.all([
    loadSchedulingEngine(admin, hid, isSuper).catch(() => ({ ready: false })) as Promise<any>,
    loadFairnessEngine(admin, hid, isSuper).catch(() => ({ ready: false })) as Promise<any>,
    loadCompetencyMatching(admin, hid, isSuper).catch(() => ({ ready: false })) as Promise<any>,
  ]);
  if (!sched?.ready) return { ready: false as const };

  const recs: any[] = [];
  const push = (cat: CatKey, title: string, rationale: string, impact: string, confidence: number, source: string) => recs.push({ id: recs.length, cat, ...CAT[cat], title, rationale, impact, confidence, source, priority: IMPACT_W[impact] + (cat === "safety" || cat === "competency" ? 1 : 0) });

  // From Scheduling/Demand recommendations
  for (const r of sched.recs ?? []) {
    const cat: CatKey = r.tag === "Cost" ? "cost" : r.tag === "Supervisor" || r.tag === "Risk" ? "safety" : r.tag === "High Impact" ? "roster" : "roster";
    if (r.tag === "OK") continue;
    push(cat, r.title, r.sub, r.tag === "Risk" || r.tag === "Supervisor" ? "High" : r.tag === "High Impact" ? "High" : "Medium", 82, "Scheduling Engine");
  }
  // From constraint/coverage alerts
  for (const a of sched.alerts ?? []) {
    const t = `${a.title} ${a.sub}`.toLowerCase();
    const cat: CatKey = /competenc/.test(t) ? "competency" : /supervisor|cover|under-staff/.test(t) ? "safety" : /balance|fair/.test(t) ? "fairness" : "safety";
    push(cat, a.title, a.sub, a.sev === "High" ? "High" : a.sev === "Medium" ? "Medium" : "Low", 80, "Constraint monitor");
  }
  // From cost (overtime / agency)
  if (sched.cost?.overtimeHrsWk) push("overtime", `Reduce ${sched.cost.overtimeHrsWk} projected overtime hours`, `~£${Math.round(sched.cost.overtimeHrsWk * (sched.cost.rate ?? 25) * 1.5).toLocaleString()} premium exposure`, "Medium", 78, "Cost Engine");

  // From Fairness
  if (fair?.hasRoster) {
    for (const r of fair.recs ?? []) push("redeploy", `Rebalance ${r.role} workload`, `${r.detail} — move a shift ${r.from} → ${r.to}`, "Medium", 76, "Fairness Engine");
    for (const a of (fair.alerts ?? []).slice(0, 3)) push("fairness", `Fairness: ${a.staff}`, a.reason, a.sev === "High" ? "High" : "Medium", 74, "Fairness Engine");
  }

  // From Competency Matching (high-risk assignments with replacements)
  if (comp?.match?.highRisk?.length) {
    for (const h of comp.match.highRisk.slice(0, 4)) push("competency", `Validate or replace ${h.role} assignment`, h.replacement ? `${h.unit} ${h.date.slice(5)} — swap ${h.staff} → ${h.replacement}` : `${h.unit} ${h.date.slice(5)} — ${h.staff} lacks validated competency`, "High", 84, "Competency Engine");
  }
  if (comp?.kpis?.expiringCerts) push("competency", `${comp.kpis.expiringCerts} competenc(y/ies) expiring ≤30d`, "Schedule reassessment to protect future coverage", "Medium", 80, "Competency Engine");

  // Rank
  recs.sort((a, b) => b.priority - a.priority || b.confidence - a.confidence);
  recs.forEach((r, i) => { r.rank = i + 1; });

  const byCat = Object.keys(CAT).map(c => ({ cat: c, label: (CAT as any)[c].label, icon: (CAT as any)[c].icon, n: recs.filter(r => r.cat === c).length })).filter(x => x.n > 0).sort((a, b) => b.n - a.n);
  const kpis = {
    total: recs.length,
    high: recs.filter(r => r.impact === "High").length,
    medium: recs.filter(r => r.impact === "Medium").length,
    avgConfidence: recs.length ? Math.round(recs.reduce((n, r) => n + r.confidence, 0) / recs.length) : null,
    categories: byCat.length,
    safety: recs.filter(r => r.cat === "safety").length,
  };

  return { ready: true as const, recs, byCat, kpis, coverage: sched.coverage?.score ?? null };
}
