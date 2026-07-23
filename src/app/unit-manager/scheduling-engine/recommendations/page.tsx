import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadRecommendations } from "@/lib/operations/recommendation-engine";
import { loadUnitDepartments } from "@/lib/operations/unit-command";
import UnitFilters from "../../UnitFilters";
import SchedulingTabs from "../SchedulingTabs";

export const dynamic = "force-dynamic";

// Recommendation Engine (WSE-001I) — the AI decision-support orchestrator. Aggregates
// recommendations from the Scheduling, Constraint, Cost, Fairness and Competency engines
// into one ranked, categorised feed with rationale, confidence and impact. Assists
// managers; never bypasses a mandatory constraint. Accept/reject/defer + a learning loop
// need a recommendation-action store → honest next-phase (the real action is in the
// source engine, linked per recommendation).
/* eslint-disable @typescript-eslint/no-explicit-any */

const card = "bg-white rounded-xl border border-gray-200";
const IMPACT: Record<string, string> = { High: "bg-rose-50 text-rose-700", Medium: "bg-amber-50 text-amber-700", Low: "bg-gray-100 text-gray-600" };

function Kpi({ label, value, sub, tone, icon }: { label: string; value: any; sub?: string; tone?: string; icon?: string }) {
  return <div className={`${card} p-4`}><div className="flex items-start justify-between"><p className="text-xs text-gray-500">{label}</p>{icon && <span className="text-base opacity-40">{icon}</span>}</div><p className={`text-2xl font-bold tabular-nums mt-1 ${tone ?? "text-gray-900"}`}>{value}</p>{sub && <p className="text-[11px] text-gray-400 mt-0.5">{sub}</p>}</div>;
}

export default async function RecommendationEngine() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles, hospital_id").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.some((r: string) => ["hospital_admin", "super_admin"].includes(r))) redirect("/dashboard");
  const isSuper = roles.includes("super_admin");

  const [d, departments] = await Promise.all([
    loadRecommendations(admin, profile?.hospital_id ?? null, isSuper) as Promise<any>,
    loadUnitDepartments(admin, profile?.hospital_id ?? null, isSuper),
  ]);

  const header = (
    <>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2"><span className="text-xl">🧠</span><div><h1 className="text-2xl font-bold text-gray-900 tracking-tight">AI Recommendations</h1><p className="text-sm text-gray-500">Ranked, explainable workforce recommendations across every scheduling engine.</p></div></div>
        <UnitFilters departments={departments} />
      </div>
      <SchedulingTabs />
    </>
  );

  if (!d.ready) return <div className="space-y-4">{header}<div className="bg-amber-50 border border-amber-200 rounded-xl p-6"><p className="font-semibold text-amber-900">⚙️ No scheduling data</p><p className="text-sm text-amber-800 mt-1">Recommendations aggregate from the scheduling engines — establishment demand + a roster are needed.</p></div></div>;

  const k = d.kpis;
  return (
    <div className="space-y-4">
      {header}

      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
        <Kpi label="Recommendations" value={k.total} sub="Across engines" icon="🧠" />
        <Kpi label="High impact" value={k.high} sub="Prioritise" icon="🔺" tone={k.high ? "text-rose-600" : "text-emerald-600"} />
        <Kpi label="Patient safety" value={k.safety} sub="Safety category" icon="🛡️" tone={k.safety ? "text-rose-600" : undefined} />
        <Kpi label="Categories" value={k.categories} sub="Distinct" icon="🗂️" />
        <Kpi label="Avg confidence" value={k.avgConfidence != null ? `${k.avgConfidence}%` : "—"} sub="Rule-based" icon="📊" />
        <Kpi label="Coverage now" value={k.coverage != null ? `${k.coverage}%` : "—"} sub="Current roster" icon="✅" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        {/* Priority queue */}
        <div className={`${card} p-5 xl:col-span-2`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Priority recommendation queue</h3>
          {d.recs.length === 0 ? <div className="text-center py-8"><p className="text-3xl mb-2">✅</p><p className="text-sm font-semibold text-gray-700">No recommendations</p><p className="text-xs text-gray-400 mt-1">The current roster is safe, competency-covered and balanced.</p></div> : (
            <div className="space-y-2">{d.recs.slice(0, 12).map((r: any) => (
              <div key={r.id} className="rounded-lg border border-gray-100 p-3">
                <div className="flex items-start gap-2.5">
                  <span className="w-6 h-6 rounded-full bg-gray-50 border border-gray-200 flex items-center justify-center text-[11px] font-bold text-gray-500 shrink-0">{r.rank}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <span className="text-xs font-semibold text-gray-800 flex items-center gap-1.5"><span>{r.icon}</span>{r.title}</span>
                      <span className="flex items-center gap-1.5 shrink-0"><span className={`text-[9px] px-1.5 py-0.5 rounded ${IMPACT[r.impact]}`}>{r.impact}</span><span className="text-[10px] text-gray-400">{r.confidence}%</span></span>
                    </div>
                    <p className="text-[11px] text-gray-500 mt-0.5">{r.rationale}</p>
                    <div className="flex items-center gap-2 mt-1.5">
                      <span className="text-[10px] text-gray-400">{r.label} · {r.source}</span>
                      <Link href={r.href} className="text-[10px] font-semibold text-emerald-700 hover:underline ml-auto">Review in engine →</Link>
                    </div>
                  </div>
                </div>
              </div>
            ))}{d.recs.length > 12 && <p className="text-[10px] text-gray-400">Showing 12 of {d.recs.length}.</p>}</div>
          )}
          <p className="text-[10px] text-gray-400 mt-2">Ranked by impact then confidence. Every recommendation includes rationale + confidence and links to its source engine. No recommendation bypasses a mandatory constraint. Accept / reject / defer with a learning loop is next-phase — decisions are actioned in the source engine (audited).</p>
        </div>

        {/* Category distribution */}
        <div className={`${card} p-5 xl:col-span-1`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">By category</h3>
          {d.byCat.length === 0 ? <p className="text-sm text-gray-400">No recommendations.</p> : <div className="space-y-2">{d.byCat.map((c: any) => (<div key={c.cat} className="text-xs"><div className="flex items-center justify-between mb-0.5"><span className="text-gray-700 flex items-center gap-1.5"><span>{c.icon}</span>{c.label}</span><b>{c.n}</b></div><div className="w-full h-1.5 rounded-full bg-gray-100 overflow-hidden"><div className="h-full rounded-full bg-emerald-500" style={{ width: `${k.total ? (c.n / k.total) * 100 : 0}%` }} /></div></div>))}</div>}
          <div className="mt-4 pt-3 border-t border-gray-100"><p className="text-[10px] text-gray-500 uppercase mb-1">Explainability</p><p className="text-[11px] text-gray-600">Each recommendation is generated by a named engine from real roster/establishment/competency data, with a rule-based confidence — no black-box scoring.</p></div>
        </div>
      </div>

      <p className="text-[11px] text-gray-400 pb-4">The Recommendation Engine (WSE-001I) is the decision-support orchestrator — it consumes the outputs of the <Link href="/unit-manager/scheduling-engine" className="text-emerald-700 hover:underline">Scheduling</Link>, <Link href="/unit-manager/scheduling-engine/constraints" className="text-emerald-700 hover:underline">Constraint</Link>, <Link href="/unit-manager/scheduling-engine/cost" className="text-emerald-700 hover:underline">Cost</Link>, <Link href="/unit-manager/scheduling-engine/fairness" className="text-emerald-700 hover:underline">Fairness</Link> and <Link href="/unit-manager/scheduling-engine/competency-matching" className="text-emerald-700 hover:underline">Competency</Link> engines and ranks them into one prioritised feed by impact and confidence. It assists managers without replacing their decision — every item is explainable, and the real action (regenerate, override, reassess) is taken in the source engine and audited. A recommendation-action store (accept/reject/defer) and a learning loop over accepted outcomes are honest next-phase. <Link href="/unit-manager/scheduling-engine" className="text-emerald-700 hover:underline">← Scheduling Engine</Link></p>
    </div>
  );
}
