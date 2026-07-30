import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadOutcomeCorrelation } from "@/lib/performance/outcome-correlation";

// CAPM-005 — Competency-to-Outcome Correlation (operator view). Per-department competency coverage vs real
// clinical-safety outcomes (observation compliance, escalation rate), with a Pearson correlation across
// departments. Honest about ecological/small-N. Super-admin, enterprise-wide.
export const dynamic = "force-dynamic";
/* eslint-disable @typescript-eslint/no-explicit-any */

const CORR: Record<string, string> = { emerald: "text-emerald-600", rose: "text-rose-600", gray: "text-gray-400" };
const CORRBG: Record<string, string> = { emerald: "border-emerald-200 bg-emerald-50", rose: "border-rose-200 bg-rose-50", gray: "border-gray-200 bg-gray-50" };

export default async function OutcomeCorrelationPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles, hospital_id").eq("id", user.id).single();
  const roles = (profile?.roles?.length ? profile.roles : [profile?.role]) as (string | null)[];
  if (!roles.includes("super_admin")) redirect("/dashboard");

  const q = await loadOutcomeCorrelation(admin, profile?.hospital_id ?? null, true);
  const card = "bg-white rounded-xl border border-gray-100";

  // Scatter geometry (competency x, compliance y).
  const W = 420, H = 260, pad = 34;
  const sx = (v: number) => pad + (v / 100) * (W - pad * 2);
  const sy = (v: number) => H - pad - (v / 100) * (H - pad * 2);

  return (
    <div className="max-w-5xl">
      <div className="flex items-start justify-between gap-3 mb-5">
        <div>
          <p className="text-[11px] font-semibold text-sky-500 uppercase tracking-widest mb-0.5">CAPM-005 · Competency Performance</p>
          <h1 className="text-xl font-bold text-gray-900">Competency-to-Outcome Correlation</h1>
          <p className="text-gray-400 text-sm mt-0.5">Does higher competency go with better outcomes? Each department&apos;s competency coverage set against its real safety outcomes.</p>
        </div>
        <Link href="/super-admin/performance" className="text-xs font-semibold text-gray-500 hover:text-sky-700 border border-gray-200 rounded-lg px-3 py-2 shrink-0">← Performance</Link>
      </div>

      {!q.provisioned ? (
        <div className="bg-amber-50 border border-amber-100 rounded-xl p-4"><p className="text-[13px] text-amber-900">Operational observation data isn&apos;t available — correlation reads <code className="text-[11px]">op_observations</code> (department-grain) against <code className="text-[11px]">competency_decisions</code>.</p></div>
      ) : q.empty ? (
        <div className="bg-white border border-gray-100 rounded-xl p-6"><p className="text-sm text-gray-400">No department competency + observation data to correlate yet.</p></div>
      ) : q.insufficient ? (
        <div className="bg-amber-50 border border-amber-100 rounded-xl p-5"><p className="text-[13px] text-amber-900 font-semibold mb-1">Not enough departments to correlate yet</p><p className="text-[12px] text-amber-800">A correlation needs at least 3 departments that each have enough competency decisions and observations. Currently {q.n} qualify. As more departments accrue data, the coefficient computes automatically.</p></div>
      ) : (
        <>
          {/* Headline correlations */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-5">
            {[
              { title: "Competency ↔ observation compliance", corr: q.complianceCorr, hint: "positive = higher-competency departments monitor better" },
              { title: "Competency ↔ escalation rate", corr: q.escalationCorr, hint: "negative = higher-competency departments escalate less" },
            ].map((b: any) => (
              <div key={b.title} className={`rounded-xl border p-5 ${CORRBG[b.corr.tone] ?? CORRBG.gray}`}>
                <p className="text-[12px] font-semibold text-gray-700 mb-1">{b.title}</p>
                <div className="flex items-end gap-3">
                  <p className={`text-4xl font-bold tabular-nums ${CORR[b.corr.tone] ?? CORR.gray}`}>{b.corr.r == null ? "—" : (b.corr.r > 0 ? "+" : "") + b.corr.r}</p>
                  <p className={`text-[12px] font-semibold mb-1 ${CORR[b.corr.tone] ?? CORR.gray}`}>{b.corr.label}</p>
                </div>
                <p className="text-[11px] text-gray-500 mt-1">Pearson r across {q.kpis.departments} departments · {b.hint}</p>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
            {[
              { label: "Departments", value: q.kpis.departments, sub: "with data" },
              { label: "Avg competency", value: `${q.kpis.avgCompetency}%`, sub: "coverage" },
              { label: "Avg compliance", value: `${q.kpis.avgCompliance}%`, sub: "observations" },
              { label: "Competency spread", value: `${q.kpis.spread} pts`, sub: "min→max" },
            ].map(k => (
              <div key={k.label} className={`${card} p-3.5`}><p className="text-xl font-bold tabular-nums text-gray-900">{k.value}</p><p className="text-[10px] text-gray-400 font-medium mt-0.5">{k.label}</p><p className="text-[9px] text-gray-300">{k.sub}</p></div>
            ))}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Scatter */}
            <div className={`${card} p-4`}>
              <p className="text-[11px] font-semibold text-gray-500 mb-2">Competency vs observation compliance</p>
              <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
                <line x1={pad} y1={H - pad} x2={W - pad} y2={H - pad} stroke="#e5e7eb" />
                <line x1={pad} y1={pad} x2={pad} y2={H - pad} stroke="#e5e7eb" />
                {[0, 25, 50, 75, 100].map(t => <text key={`x${t}`} x={sx(t)} y={H - pad + 14} textAnchor="middle" className="fill-gray-400" style={{ fontSize: 8 }}>{t}</text>)}
                {[0, 50, 100].map(t => <text key={`y${t}`} x={pad - 6} y={sy(t) + 3} textAnchor="end" className="fill-gray-400" style={{ fontSize: 8 }}>{t}</text>)}
                <text x={W / 2} y={H - 4} textAnchor="middle" className="fill-gray-400" style={{ fontSize: 9 }}>competency coverage %</text>
                {q.points.map((p: any, i: number) => (
                  <circle key={i} cx={sx(p.competency)} cy={sy(p.compliance)} r={5} fill="#0ea5e9" opacity={0.7}><title>{p.department}: {p.competency}% competency, {p.compliance}% compliance</title></circle>
                ))}
              </svg>
              <p className="text-[10px] text-gray-400 mt-1">y = observation compliance %. Each dot is a department.</p>
            </div>

            {/* Per-department table */}
            <div className={`${card} overflow-hidden`}>
              <div className="px-4 py-2.5 border-b border-gray-50"><p className="text-[11px] font-semibold text-gray-500">By department — competency vs outcomes</p></div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="text-left text-[10px] uppercase tracking-wide text-gray-400 border-b border-gray-50"><th className="py-2 px-4 font-medium">Department</th><th className="py-2 px-2 font-medium text-right">Comp.</th><th className="py-2 px-2 font-medium text-right">Compliance</th><th className="py-2 px-4 font-medium text-right">Escal.</th></tr></thead>
                  <tbody className="divide-y divide-gray-50">
                    {q.points.map((p: any, i: number) => (
                      <tr key={i}>
                        <td className="py-2 px-4 text-gray-800 truncate max-w-[160px]">{p.department}<span className="text-[9px] text-gray-400 ml-1">n{p.staff}</span></td>
                        <td className="py-2 px-2 tabular-nums text-right font-medium text-sky-600">{p.competency}%</td>
                        <td className="py-2 px-2 tabular-nums text-right text-gray-700">{p.compliance}%</td>
                        <td className={`py-2 px-4 tabular-nums text-right ${p.escalationRate > 20 ? "text-rose-600" : "text-gray-500"}`}>{p.escalationRate}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <p className="text-[11px] text-gray-400 mt-4 leading-relaxed">This is an <span className="font-semibold">ecological</span> correlation over department aggregates — it shows association, not per-nurse causation, and with a small number of departments it is directional/indicative, not conclusive. Competency = achieved share of the department&apos;s latest competency decisions; outcomes from department observation records. A strong positive compliance correlation (and negative escalation correlation) is evidence that validated competency is translating into safer practice.</p>
        </>
      )}
    </div>
  );
}
