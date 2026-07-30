import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadAssessorReliability } from "@/lib/assurance/assessor-reliability";

// CAPA-005 — Assessor Reliability Engine (operator view). Per-assessor scoring behaviour vs peers — leniency/
// severity, consistency, inter-rater agreement — over real assessments + skill_scores. Super-admin, platform-wide.
export const dynamic = "force-dynamic";
/* eslint-disable @typescript-eslint/no-explicit-any */

const TONE: Record<string, string> = { emerald: "text-emerald-700 bg-emerald-50 border-emerald-100", amber: "text-amber-700 bg-amber-50 border-amber-100", rose: "text-rose-700 bg-rose-50 border-rose-100" };
const relTone = (n: number) => (n >= 80 ? "text-emerald-600" : n >= 60 ? "text-amber-600" : "text-rose-600");

export default async function AssessorReliabilityPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles, hospital_id").eq("id", user.id).single();
  const roles = (profile?.roles?.length ? profile.roles : [profile?.role]) as (string | null)[];
  if (!roles.includes("super_admin")) redirect("/dashboard");

  const q = await loadAssessorReliability(admin, profile?.hospital_id ?? null, true);
  const card = "bg-white rounded-xl border border-gray-100";

  return (
    <div className="max-w-5xl">
      <div className="flex items-start justify-between gap-3 mb-5">
        <div>
          <p className="text-[11px] font-semibold text-indigo-500 uppercase tracking-widest mb-0.5">CAPA-005 · Competency Assurance</p>
          <h1 className="text-xl font-bold text-gray-900">Assessor Reliability</h1>
          <p className="text-gray-400 text-sm mt-0.5">How each assessor scores relative to their peers — leniency vs severity, consistency, and inter-rater agreement — over the real assessment record.</p>
        </div>
        <Link href="/super-admin/assurance" className="text-xs font-semibold text-gray-500 hover:text-indigo-700 border border-gray-200 rounded-lg px-3 py-2 shrink-0">← Assurance</Link>
      </div>

      {!q.provisioned ? (
        <div className="bg-amber-50 border border-amber-100 rounded-xl p-4"><p className="text-[13px] text-amber-900">Assessment data isn&apos;t provisioned — the reliability engine reads <code className="text-[11px]">assessments</code> + <code className="text-[11px]">skill_scores</code>.</p></div>
      ) : q.empty ? (
        <div className="bg-white border border-gray-100 rounded-xl p-6"><p className="text-sm text-gray-400">No scored assessments recorded yet. Once assessors score competencies, per-assessor reliability populates here automatically.</p></div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-5">
            {[
              { label: "Assessors", value: q.kpis.assessors, tone: "text-gray-900" },
              { label: "Assessments scored", value: q.kpis.assessments, tone: "text-gray-900" },
              { label: "Peer mean score", value: `${q.kpis.globalMean}/6`, tone: "text-indigo-600" },
              { label: "Within tolerance", value: `${q.kpis.withinTolerance}/${q.kpis.judged}`, tone: "text-emerald-600" },
              { label: "Calibration watch", value: q.kpis.watchlist, tone: q.kpis.watchlist ? "text-rose-600" : "text-gray-900" },
              { label: "Inter-rater agree", value: q.kpis.interRaterAgreement != null ? `${q.kpis.interRaterAgreement}%` : "—", tone: "text-gray-900" },
            ].map(k => (
              <div key={k.label} className={`${card} p-3.5`}><p className={`text-xl font-bold tabular-nums ${k.tone}`}>{k.value}</p><p className="text-[10px] text-gray-400 font-medium mt-0.5 leading-tight">{k.label}</p></div>
            ))}
          </div>

          {/* Calibration watchlist */}
          <div className={`${card} overflow-hidden mb-5`}>
            <div className="px-4 py-2.5 border-b border-gray-50 flex items-center justify-between"><p className="text-[11px] font-semibold text-gray-500">Calibration watchlist</p><span className="text-[10px] text-gray-400">outliers past peer tolerance — candidates for a calibration session</span></div>
            {q.watchlist.length === 0 ? (
              <p className="text-xs text-gray-400 px-4 py-6 text-center">No assessors outside tolerance. Scoring is well-calibrated across the peer group. 🎯</p>
            ) : (
              <div className="divide-y divide-gray-50">
                {q.watchlist.map((a: any) => (
                  <div key={a.id} className="flex items-center gap-3 px-4 py-2.5">
                    <span className="text-sm text-gray-800 w-44 truncate">{a.name}</span>
                    <span className={`text-[9px] font-bold uppercase tracking-wide border rounded px-1.5 py-0.5 shrink-0 ${TONE[a.tendencyTone]}`}>{a.tendency}</span>
                    <span className="text-[11px] text-gray-500 flex-1 truncate">{a.reason}</span>
                    <span className="text-[11px] text-gray-400 tabular-nums shrink-0">{a.n} scored</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* Per-assessor table */}
            <div className={`${card} overflow-hidden lg:col-span-2`}>
              <div className="px-4 py-2.5 border-b border-gray-50"><p className="text-[11px] font-semibold text-gray-500">All assessors — ranked by deviation from peer mean</p></div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="text-left text-[10px] uppercase tracking-wide text-gray-400 border-b border-gray-50"><th className="py-2 px-4 font-medium">Assessor</th><th className="py-2 px-2 font-medium text-right">n</th><th className="py-2 px-2 font-medium text-right">Mean</th><th className="py-2 px-2 font-medium text-right">Δ peer</th><th className="py-2 px-2 font-medium">Tendency</th><th className="py-2 px-2 font-medium text-right">Spread</th><th className="py-2 px-4 font-medium text-right">Reliability</th></tr></thead>
                  <tbody className="divide-y divide-gray-50">
                    {q.assessors.slice(0, 50).map((a: any) => (
                      <tr key={a.id}>
                        <td className="py-2 px-4 text-gray-800 truncate max-w-[160px]">{a.name}{a.lowConfidence && <span className="ml-1 text-[9px] text-gray-400">·low n</span>}</td>
                        <td className="py-2 px-2 text-gray-500 tabular-nums text-right">{a.n}</td>
                        <td className="py-2 px-2 text-gray-700 tabular-nums text-right">{a.meanScore}</td>
                        <td className={`py-2 px-2 tabular-nums text-right font-medium ${a.deviation > 0 ? "text-amber-600" : a.deviation < 0 ? "text-rose-600" : "text-gray-400"}`}>{a.deviation > 0 ? "+" : ""}{a.deviation}</td>
                        <td className="py-2 px-2"><span className={`text-[9px] font-bold uppercase tracking-wide border rounded px-1.5 py-0.5 ${TONE[a.tendencyTone]}`}>{a.tendency}</span></td>
                        <td className="py-2 px-2 text-gray-500 tabular-nums text-right">{a.stdev}</td>
                        <td className={`py-2 px-4 tabular-nums text-right font-bold ${a.lowConfidence ? "text-gray-300" : relTone(a.reliability)}`}>{a.lowConfidence ? "—" : a.reliability}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Inter-rater agreement */}
            <div className={`${card} p-4`}>
              <p className="text-[11px] font-semibold text-gray-500 mb-3">Inter-rater agreement</p>
              {q.interRater.sampledItems === 0 ? (
                <p className="text-xs text-gray-400">No items were scored by more than one assessor yet, so inter-rater agreement can&apos;t be measured. It populates once the same skill is co-assessed.</p>
              ) : (
                <>
                  <div className="text-center py-2">
                    <p className="text-3xl font-bold text-indigo-600 tabular-nums">{q.interRater.agreement}%</p>
                    <p className="text-[11px] text-gray-400 mt-0.5">of co-scored items agree within 1 point</p>
                  </div>
                  <div className="space-y-1.5 mt-3 text-[12px]">
                    <div className="flex items-center justify-between"><span className="text-gray-500">Co-scored items</span><span className="font-semibold text-gray-800 tabular-nums">{q.interRater.sampledItems}</span></div>
                    <div className="flex items-center justify-between"><span className="text-gray-500">Avg score range</span><span className="font-semibold text-gray-800 tabular-nums">{q.interRater.avgRange} pts</span></div>
                  </div>
                </>
              )}
              <p className="text-[10px] text-gray-400 mt-4 leading-relaxed border-t border-gray-50 pt-3">Deviation is each assessor&apos;s mean score minus the peer mean (0–6 scale). Reliability is a labelled heuristic (peer-bias + consistency), decision-support for calibration — not a psychometric verdict.</p>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
