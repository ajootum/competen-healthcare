import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadAssuranceDashboard } from "@/lib/assurance/assurance-dashboard";
import { requireHqCapability } from "@/lib/hq/context";

// CAPA-009 — Organizational Assurance Dashboard. One enterprise assurance score consolidating the live CAPA
// engines + cross-linked signals, with a per-domain breakdown and a ranked risk list. Real over the assurance
// engines; nothing fabricated. Super-admin, enterprise-wide.
export const dynamic = "force-dynamic";
/* eslint-disable @typescript-eslint/no-explicit-any */

const BAND: Record<string, string> = { emerald: "text-[var(--cmp-text-success)]", amber: "text-[var(--cmp-text-warning)]", rose: "text-[var(--cmp-text-error)]" };
const RISK: Record<string, string> = { red: "border-[var(--cmp-color-error)] bg-[var(--cmp-surface-error)]", amber: "border-[var(--cmp-color-warning)] bg-[var(--cmp-surface-warning)]", gray: "border-gray-200 bg-gray-50" };
const DOT: Record<string, string> = { red: "bg-[var(--cmp-color-error)]", amber: "bg-[var(--cmp-color-warning)]", gray: "bg-gray-300" };
const barTone = (n: number) => (n >= 85 ? "bg-[var(--cmp-color-success)]" : n >= 70 ? "bg-[var(--cmp-color-warning)]" : "bg-[var(--cmp-color-error)]");
const scoreTone = (n: number) => (n >= 85 ? "text-[var(--cmp-text-success)]" : n >= 70 ? "text-[var(--cmp-text-warning)]" : "text-[var(--cmp-text-error)]");

export default async function AssuranceDashboardPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles, hospital_id").eq("id", user.id).single();
  await requireHqCapability("hq.quality.assurance.view");

  const q = await loadAssuranceDashboard(admin, profile?.hospital_id ?? null, true);
  const card = "bg-white rounded-xl border border-gray-100";
  const maxTrend = q.trend.length ? Math.max(100, ...q.trend.map((t: any) => t.pct)) : 100;

  return (
    <div className="max-w-5xl">
      <div className="flex items-start justify-between gap-3 mb-5">
        <div>
          <p className="text-[11px] font-semibold text-indigo-500 uppercase tracking-widest mb-0.5">CAPA-009 · Competency Assurance</p>
          <h1 className="text-xl font-bold text-gray-900">Organizational Assurance</h1>
          <p className="text-gray-400 text-sm mt-0.5">One enterprise assurance score — how much the competency system as a whole can be trusted right now — consolidated from every live assurance signal.</p>
        </div>
        <Link href="/super-admin/assurance" className="text-xs font-semibold text-gray-500 hover:text-indigo-700 border border-gray-200 rounded-lg px-3 py-2 shrink-0">← Assurance</Link>
      </div>

      {!q.provisioned ? (
        <div className="bg-white border border-gray-100 rounded-xl p-6"><p className="text-sm text-gray-400">No assurance signals yet. Once competency decisions, assessments and corrective actions exist, the assurance score consolidates them here automatically.</p></div>
      ) : (
        <>
          {/* Assurance score + headline */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
            <div className={`${card} p-5 flex flex-col items-center justify-center text-center`}>
              <p className="text-[11px] text-gray-400 uppercase tracking-wide mb-1">Assurance score</p>
              <p className={`text-5xl font-bold tabular-nums ${BAND[q.band!.tone]}`}>{q.overall}</p>
              <p className={`text-sm font-semibold mt-1 ${BAND[q.band!.tone]}`}>{q.band!.label}</p>
              <p className="text-[10px] text-gray-400 mt-1">mean of {q.scoredCount} assured domains</p>
            </div>
            <div className="md:col-span-2 grid grid-cols-2 gap-3">
              {[
                { label: "Competencies assessed", value: q.headline.assessed },
                { label: "Assessors profiled", value: q.headline.assessors },
                { label: "Corrective actions", value: q.headline.actions },
                { label: "High-risk staff", value: q.headline.highRisk, tone: q.headline.highRisk ? "text-[var(--cmp-text-error)]" : "text-gray-900" },
              ].map(k => (
                <div key={k.label} className={`${card} p-4`}><p className={`text-2xl font-bold tabular-nums ${k.tone ?? "text-gray-900"}`}>{k.value}</p><p className="text-[11px] text-gray-400 font-medium mt-0.5">{k.label}</p></div>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Domain breakdown */}
            <div className={`${card} p-4`}>
              <p className="text-[11px] font-semibold text-gray-500 mb-3">Assurance domains</p>
              <div className="space-y-3">
                {q.domains.map((d: any) => (
                  <Link key={d.key} href={d.href} className="block group">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[13px] text-gray-700 group-hover:text-indigo-700">{d.key}</span>
                      <span className={`text-xs font-bold tabular-nums ${d.score == null ? "text-gray-300" : scoreTone(d.score)}`}>{d.score == null ? "—" : d.score}</span>
                    </div>
                    <div className="h-2 bg-gray-100 rounded-full overflow-hidden">{d.score != null && <div className={`h-full ${barTone(d.score)}`} style={{ width: `${d.score}%` }} />}</div>
                    <p className="text-[10px] text-gray-400 mt-0.5">{d.note}</p>
                  </Link>
                ))}
              </div>
            </div>

            {/* Consolidated risks */}
            <div className={`${card} p-4`}>
              <div className="flex items-center justify-between mb-3"><p className="text-[11px] font-semibold text-gray-500">Top assurance risks</p><span className="text-[10px] text-gray-400">{q.risks.length} open</span></div>
              {q.risks.length === 0 ? (
                <p className="text-sm text-gray-400 py-8 text-center">No open assurance risks — every signal is within tolerance. 🎯</p>
              ) : (
                <div className="space-y-2">
                  {q.risks.map((r: any, i: number) => (
                    <Link key={i} href={r.href} className={`flex items-start gap-2.5 rounded-lg border p-2.5 transition-all hover:shadow-sm ${RISK[r.tone] ?? RISK.gray}`}>
                      <span className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${DOT[r.tone] ?? DOT.gray}`} />
                      <div className="min-w-0 flex-1"><p className="text-[13px] font-semibold text-gray-800 leading-tight">{r.title}</p><p className="text-[11px] text-gray-500 mt-0.5">{r.detail}</p></div>
                    </Link>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Outcome trend */}
          {q.trend.length > 0 && (
            <div className={`${card} p-4 mt-4`}>
              <div className="flex items-center justify-between mb-3"><p className="text-[11px] font-semibold text-gray-500">Assessment outcome trend</p><span className="text-[10px] text-gray-400">% achieved, by month</span></div>
              <div className="flex items-end gap-2 h-24">
                {q.trend.map((t: any) => (
                  <div key={t.month} className="flex-1 flex flex-col items-center gap-1 min-w-0">
                    <span className="text-[9px] text-gray-500 tabular-nums">{t.pct}%</span>
                    <div className="w-full bg-gray-50 rounded-t flex items-end h-full"><div className="w-full rounded-t bg-indigo-400" style={{ height: `${Math.max(3, (t.pct / maxTrend) * 100)}%` }} title={`${t.n} decisions`} /></div>
                    <span className="text-[8px] text-gray-400 truncate w-full text-center">{t.month.slice(2)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <p className="text-[11px] text-gray-400 mt-4 leading-relaxed">The assurance score is the mean of the domain scores that have data (currency, stability, assessor reliability, corrective-action closure, evidence completeness). It is a point-in-time consolidation of real signals — a score history/snapshot store would let it trend over time (next phase). Each domain and risk deep-links to its owning surface.</p>
        </>
      )}
    </div>
  );
}
