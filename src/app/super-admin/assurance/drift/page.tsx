import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadCompetencyDrift } from "@/lib/assurance/competency-drift";
import { requireHqCapability } from "@/lib/hq/context";

// CAPA-006 — Competency Drift Analytics (operator view). Workforce competency change over time: decay vs
// improvement across reassessments, expiry pressure, a drift index and per-competency hotspots. Real over
// competency_decisions. Super-admin, enterprise-wide.
export const dynamic = "force-dynamic";
/* eslint-disable @typescript-eslint/no-explicit-any */

const driftTone = (n: number) => (n >= 40 ? "text-[var(--cmp-text-error)]" : n >= 20 ? "text-[var(--cmp-text-warning)]" : "text-[var(--cmp-text-success)]");
const rateTone = (n: number) => (n >= 50 ? "bg-[var(--cmp-color-error)]" : n >= 25 ? "bg-[var(--cmp-color-warning)]" : "bg-[var(--cmp-color-success)]");
const fmt = (s: string | null) => (s ? String(s).replace(/_/g, " ") : "—");

export default async function CompetencyDriftPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles, hospital_id").eq("id", user.id).single();
  await requireHqCapability("hq.quality.assurance.view");

  const q = await loadCompetencyDrift(admin, profile?.hospital_id ?? null, true);
  const card = "bg-white rounded-xl border border-gray-100";
  const maxTrend = q.provisioned && !q.empty ? Math.max(100, ...q.trend.map((t: any) => t.pct)) : 100;

  return (
    <div className="max-w-5xl">
      <div className="flex items-start justify-between gap-3 mb-5">
        <div>
          <p className="text-[11px] font-semibold text-indigo-500 uppercase tracking-widest mb-0.5">CAPA-006 · Competency Assurance</p>
          <h1 className="text-xl font-bold text-gray-900">Competency Drift</h1>
          <p className="text-gray-400 text-sm mt-0.5">How workforce competency is changing over time — decay vs improvement across reassessments, expiry pressure, and where drift concentrates.</p>
        </div>
        <Link href="/super-admin/assurance" className="text-xs font-semibold text-gray-500 hover:text-indigo-700 border border-gray-200 rounded-lg px-3 py-2 shrink-0">← Assurance</Link>
      </div>

      {!q.provisioned ? (
        <div className="bg-[var(--cmp-surface-warning)] border border-[var(--cmp-color-warning)] rounded-xl p-4"><p className="text-[13px] text-amber-900">Competency decision data isn&apos;t provisioned — drift reads <code className="text-[11px]">competency_decisions</code>.</p></div>
      ) : q.empty ? (
        <div className="bg-white border border-gray-100 rounded-xl p-6"><p className="text-sm text-gray-400">No competency decisions recorded yet. Once assessments produce decisions over time, drift analytics populate here automatically.</p></div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3 mb-5">
            {[
              { label: "Drift index", value: q.kpis.driftIndex, tone: driftTone(q.kpis.driftIndex), sub: "0 = stable" },
              { label: "Competencies held", value: q.kpis.assessed, tone: "text-gray-900", sub: `${q.kpis.achievedPct}% current` },
              { label: "Expired", value: q.kpis.expired, tone: "text-[var(--cmp-text-error)]", sub: "lapsed" },
              { label: "Expiring ≤30d", value: q.kpis.expiring, tone: "text-[var(--cmp-text-warning)]", sub: "at risk" },
              { label: "Decayed", value: q.kpis.decayed, tone: q.kpis.decayed ? "text-[var(--cmp-text-error)]" : "text-gray-900", sub: `${q.kpis.improved} improved` },
              { label: "High-risk staff", value: q.kpis.highRiskStaff, tone: q.kpis.highRiskStaff ? "text-[var(--cmp-text-error)]" : "text-gray-900", sub: "critical gaps" },
            ].map(k => (
              <div key={k.label} className={`${card} p-3.5`}><p className={`text-xl font-bold tabular-nums ${k.tone}`}>{k.value}</p><p className="text-[10px] text-gray-400 font-medium mt-0.5 leading-tight">{k.label}</p><p className="text-[9px] text-gray-300 leading-tight">{k.sub}</p></div>
            ))}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
            {/* Outcome trend */}
            <div className={`${card} p-4`}>
              <div className="flex items-center justify-between mb-3"><p className="text-[11px] font-semibold text-gray-500">Assessment outcome trend</p><span className="text-[10px] text-gray-400">% achieved, by month decided</span></div>
              {q.trend.length === 0 ? <p className="text-xs text-gray-400 py-6 text-center">Not enough dated decisions to trend.</p> : (
                <div className="flex items-end gap-2 h-32">
                  {q.trend.map((t: any) => (
                    <div key={t.month} className="flex-1 flex flex-col items-center gap-1 min-w-0">
                      <span className="text-[9px] text-gray-500 tabular-nums">{t.pct}%</span>
                      <div className="w-full bg-gray-50 rounded-t flex items-end" style={{ height: "100%" }}>
                        <div className={`w-full rounded-t ${rateTone(100 - t.pct)}`} style={{ height: `${Math.max(3, (t.pct / maxTrend) * 100)}%` }} title={`${t.n} decisions`} />
                      </div>
                      <span className="text-[8px] text-gray-400 truncate w-full text-center">{t.month.slice(2)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Reassessment movement */}
            <div className={`${card} p-4`}>
              <p className="text-[11px] font-semibold text-gray-500 mb-3">Reassessment movement</p>
              {q.reassessed === 0 ? (
                <p className="text-xs text-gray-400 py-6 text-center">No competencies have been reassessed more than once yet, so decay vs improvement can&apos;t be measured. It populates as people are re-assessed over time.</p>
              ) : (
                <>
                  <div className="flex items-center gap-3 mb-3">
                    <div className="flex-1 text-center"><p className="text-2xl font-bold text-[var(--cmp-text-success)] tabular-nums">{q.kpis.improved}</p><p className="text-[10px] text-gray-400">improved ↑</p></div>
                    <div className="flex-1 text-center"><p className="text-2xl font-bold text-[var(--cmp-text-error)] tabular-nums">{q.kpis.decayed}</p><p className="text-[10px] text-gray-400">decayed ↓</p></div>
                    <div className="flex-1 text-center"><p className="text-2xl font-bold text-gray-700 tabular-nums">{q.reassessed}</p><p className="text-[10px] text-gray-400">reassessed</p></div>
                  </div>
                  <div className="divide-y divide-gray-50 border-t border-gray-50">
                    {q.recentDecays.slice(0, 6).map((d: any, i: number) => (
                      <div key={i} className="flex items-center gap-2 py-1.5">
                        <span className="text-[11px] text-gray-700 truncate flex-1">{d.name}</span>
                        <span className="text-[10px] text-gray-400 truncate max-w-[120px]">{d.competency}</span>
                        <span className="text-[9px] font-semibold text-[var(--cmp-text-error)] shrink-0">{fmt(d.from)} → {fmt(d.to)}</span>
                      </div>
                    ))}
                    {q.recentDecays.length === 0 && <p className="text-[11px] text-gray-400 py-2 text-center">No decays — movement is upward. 🎉</p>}
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Drift hotspots */}
          <div className={`${card} overflow-hidden`}>
            <div className="px-4 py-2.5 border-b border-gray-50 flex items-center justify-between"><p className="text-[11px] font-semibold text-gray-500">Drift hotspots</p><span className="text-[10px] text-gray-400">competencies with the highest share expired / failing</span></div>
            {q.hotspots.length === 0 ? (
              <p className="text-xs text-gray-400 px-4 py-6 text-center">No competency is drifting — currency and outcomes are holding across the board. 🎯</p>
            ) : (
              <div className="divide-y divide-gray-50">
                {q.hotspots.map((h: any, i: number) => (
                  <div key={i} className="flex items-center gap-3 px-4 py-2.5">
                    <span className="text-sm text-gray-800 flex-1 truncate">{h.competency}</span>
                    <div className="w-28 h-2 bg-gray-100 rounded-full overflow-hidden shrink-0"><div className={`h-full ${rateTone(h.rate)}`} style={{ width: `${h.rate}%` }} /></div>
                    <span className={`text-xs font-semibold tabular-nums w-10 text-right shrink-0 ${driftTone(h.rate)}`}>{h.rate}%</span>
                    <span className="text-[11px] text-gray-400 tabular-nums w-16 text-right shrink-0">{h.drifting}/{h.total}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <p className="text-[11px] text-gray-400 mt-4 leading-relaxed">Drift index = share of currently-held competencies that are expired, expiring or failing (0 = stable). Decay/improvement compares each person&apos;s latest reassessment against their prior one (Benner maturity or a lapse to expired). Real over <code className="text-[10px]">competency_decisions</code> — decision-support for targeted reassessment, not an automated action.</p>
        </>
      )}
    </div>
  );
}
