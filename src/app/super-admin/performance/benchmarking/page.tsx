import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadBenchmarking } from "@/lib/performance/benchmarking";

// CAPM-006 — Benchmarking & Maturity Analytics (operator view). Cross-department competency capability &
// maturity, benchmarked against the enterprise mean — rank, percentile, quartile, delta. Real over
// competency_decisions. Super-admin, enterprise-wide. Internal benchmarking only (no cross-tenant peer data).
export const dynamic = "force-dynamic";
/* eslint-disable @typescript-eslint/no-explicit-any */

const LVL: Record<string, string> = { emerald: "text-emerald-700 bg-emerald-50 border-emerald-100", teal: "text-teal-700 bg-teal-50 border-teal-100", amber: "text-amber-700 bg-amber-50 border-amber-100", rose: "text-rose-700 bg-rose-50 border-rose-100" };
const capTone = (n: number) => (n >= 80 ? "text-emerald-600" : n >= 60 ? "text-teal-600" : n >= 40 ? "text-amber-600" : "text-rose-600");

export default async function BenchmarkingPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles, hospital_id").eq("id", user.id).single();
  const roles = (profile?.roles?.length ? profile.roles : [profile?.role]) as (string | null)[];
  if (!roles.includes("super_admin")) redirect("/dashboard");

  const q = await loadBenchmarking(admin, profile?.hospital_id ?? null, true);
  const card = "bg-white rounded-xl border border-gray-100";
  const distTotal = q.provisioned && !q.empty && !q.insufficient ? q.distribution.reduce((n: number, d: any) => n + d.n, 0) || 1 : 1;
  const DIST_TONE: Record<string, string> = { Expert: "bg-emerald-500", Proficient: "bg-teal-500", Competent: "bg-amber-500", Developing: "bg-rose-500" };

  return (
    <div className="max-w-5xl">
      <div className="flex items-start justify-between gap-3 mb-5">
        <div>
          <p className="text-[11px] font-semibold text-sky-500 uppercase tracking-widest mb-0.5">CAPM-006 · Competency Performance</p>
          <h1 className="text-xl font-bold text-gray-900">Benchmarking & Maturity</h1>
          <p className="text-gray-400 text-sm mt-0.5">Which departments lead on competency capability, and how mature the organisation is — every department benchmarked against the enterprise mean.</p>
        </div>
        <Link href="/super-admin/performance" className="text-xs font-semibold text-gray-500 hover:text-sky-700 border border-gray-200 rounded-lg px-3 py-2 shrink-0">← Performance</Link>
      </div>

      {!q.provisioned ? (
        <div className="bg-amber-50 border border-amber-100 rounded-xl p-4"><p className="text-[13px] text-amber-900">Competency data isn&apos;t available — benchmarking reads <code className="text-[11px]">competency_decisions</code> via <code className="text-[11px]">profiles.department_id</code>.</p></div>
      ) : q.empty ? (
        <div className="bg-white border border-gray-100 rounded-xl p-6"><p className="text-sm text-gray-400">No department competency data to benchmark yet.</p></div>
      ) : q.insufficient ? (
        <div className="bg-amber-50 border border-amber-100 rounded-xl p-5"><p className="text-[13px] text-amber-900 font-semibold mb-1">Not enough departments to benchmark</p><p className="text-[12px] text-amber-800">Benchmarking needs at least 2 departments with enough competency decisions. Currently {q.n} qualify.</p></div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-5">
            {[
              { label: "Enterprise maturity", value: q.kpis.enterpriseLevel, tone: "text-sky-600", sub: `avg ${q.kpis.enterpriseMaturity}/6` },
              { label: "Benchmark score", value: q.kpis.benchmark, tone: "text-gray-900", sub: "enterprise mean" },
              { label: "Departments", value: q.kpis.departments, tone: "text-gray-900", sub: "benchmarked" },
              { label: "Top score", value: q.kpis.topScore, tone: "text-emerald-600", sub: q.leaders[0]?.department },
              { label: "Above benchmark", value: q.kpis.aboveBenchmark, tone: "text-gray-900", sub: `of ${q.kpis.departments}` },
              { label: "Spread", value: q.kpis.spread, tone: q.kpis.spread > 30 ? "text-amber-600" : "text-gray-900", sub: "top→bottom" },
            ].map(k => (
              <div key={k.label} className={`${card} p-3.5`}><p className={`text-xl font-bold tabular-nums ${k.tone}`}>{k.value}</p><p className="text-[10px] text-gray-400 font-medium mt-0.5 leading-tight">{k.label}</p><p className="text-[9px] text-gray-300 truncate">{k.sub}</p></div>
            ))}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
            {/* Maturity distribution */}
            <div className={`${card} p-4`}>
              <p className="text-[11px] font-semibold text-gray-500 mb-3">Maturity distribution</p>
              <div className="flex h-2.5 rounded-full overflow-hidden bg-gray-100 mb-3">
                {q.distribution.map((d: any) => <div key={d.level} className={DIST_TONE[d.level]} style={{ width: `${(d.n / distTotal) * 100}%` }} title={`${d.level}: ${d.n}`} />)}
              </div>
              <div className="space-y-1.5">
                {q.distribution.map((d: any) => (
                  <div key={d.level} className="flex items-center gap-2 text-[12px]"><span className={`w-2 h-2 rounded-full ${DIST_TONE[d.level]}`} /><span className="text-gray-600 flex-1">{d.level}</span><span className="font-semibold text-gray-800 tabular-nums">{d.n}</span></div>
                ))}
              </div>
            </div>

            {/* Leaders + laggards */}
            <div className={`${card} p-4 lg:col-span-2`}>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-[11px] font-semibold text-emerald-600 mb-2">Best practice — leaders</p>
                  <div className="space-y-1.5">{q.leaders.map((r: any) => (<div key={r.id} className="flex items-center gap-2 text-[12px]"><span className="text-gray-400 tabular-nums w-4">#{r.rank}</span><span className="text-gray-700 flex-1 truncate">{r.department}</span><span className="font-semibold text-emerald-600 tabular-nums">{r.capability}</span></div>))}</div>
                </div>
                <div>
                  <p className="text-[11px] font-semibold text-rose-600 mb-2">Improvement priority — laggards</p>
                  <div className="space-y-1.5">{q.laggards.map((r: any) => (<div key={r.id} className="flex items-center gap-2 text-[12px]"><span className="text-gray-400 tabular-nums w-4">#{r.rank}</span><span className="text-gray-700 flex-1 truncate">{r.department}</span><span className="text-[10px] text-rose-500 shrink-0">−{r.gapToLeader}</span></div>))}</div>
                </div>
              </div>
            </div>
          </div>

          {/* Full benchmark table */}
          <div className={`${card} overflow-hidden`}>
            <div className="px-4 py-2.5 border-b border-gray-50"><p className="text-[11px] font-semibold text-gray-500">Department benchmark — ranked by capability</p></div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="text-left text-[10px] uppercase tracking-wide text-gray-400 border-b border-gray-50"><th className="py-2 px-4 font-medium">#</th><th className="py-2 px-3 font-medium">Department</th><th className="py-2 px-2 font-medium text-right">Capability</th><th className="py-2 px-2 font-medium text-right">Δ bench</th><th className="py-2 px-2 font-medium text-right">Cover</th><th className="py-2 px-2 font-medium text-right">Maturity</th><th className="py-2 px-4 font-medium">Level</th></tr></thead>
                <tbody className="divide-y divide-gray-50">
                  {q.rows.slice(0, 60).map((r: any) => (
                    <tr key={r.id}>
                      <td className="py-2 px-4 text-gray-400 tabular-nums">{r.rank}</td>
                      <td className="py-2 px-3 text-gray-800 truncate max-w-[160px]">{r.department}<span className="text-[9px] text-gray-400 ml-1">n{r.staff}</span></td>
                      <td className={`py-2 px-2 tabular-nums text-right font-bold ${capTone(r.capability)}`}>{r.capability}</td>
                      <td className={`py-2 px-2 tabular-nums text-right ${r.delta > 0 ? "text-emerald-600" : r.delta < 0 ? "text-rose-600" : "text-gray-400"}`}>{r.delta > 0 ? "+" : ""}{r.delta}</td>
                      <td className="py-2 px-2 tabular-nums text-right text-gray-500">{r.coverage}%</td>
                      <td className="py-2 px-2 tabular-nums text-right text-gray-500">{r.avgMaturity}</td>
                      <td className="py-2 px-4"><span className={`text-[9px] font-bold uppercase tracking-wide border rounded px-1.5 py-0.5 ${LVL[r.levelTone]}`}>{r.level}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <p className="text-[11px] text-gray-400 mt-4 leading-relaxed">Capability = 50% competency coverage + 30% Benner maturity + 20% currency. Maturity level from the average Benner band of achieved competencies. Benchmarking is <span className="font-semibold">internal</span> (department vs the enterprise mean) — cross-tenant peer comparison would need shared external benchmark data, which isn&apos;t present. Decision-support for targeted improvement, not a ranking mandate.</p>
        </>
      )}
    </div>
  );
}
