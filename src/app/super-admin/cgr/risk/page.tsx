import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadGovernanceRisk } from "@/lib/cgr/exceptions";

// CGR-009 — Competency Governance Exception, Escalation & Risk. The escalation queue (registry concerns →
// classified risk + escalation level), the governance risk register, and the real time-boxed exceptions
// (break-glass). Enterprise risk + break-glass admin cross-link to GOV/System. Super-admin.
export const dynamic = "force-dynamic";
/* eslint-disable @typescript-eslint/no-explicit-any */

const CLASS_META: Record<string, { label: string; cls: string; bar: string }> = {
  critical: { label: "Critical", cls: "text-rose-700 bg-rose-50 border-rose-100", bar: "bg-rose-500" },
  high: { label: "High", cls: "text-orange-700 bg-orange-50 border-orange-100", bar: "bg-orange-500" },
  moderate: { label: "Moderate", cls: "text-amber-700 bg-amber-50 border-amber-100", bar: "bg-amber-500" },
  low: { label: "Low", cls: "text-slate-600 bg-slate-50 border-slate-200", bar: "bg-slate-400" },
};
const RISK_META: Record<string, string> = { critical: "text-rose-700 bg-rose-50 border-rose-100", high: "text-orange-700 bg-orange-50 border-orange-100", standard: "text-gray-600 bg-gray-50 border-gray-200", low: "text-slate-500 bg-slate-50 border-slate-200" };
const LEVEL_META: Record<number, { label: string; cls: string }> = {
  3: { label: "L3 · Executive", cls: "text-rose-700 bg-rose-50 border-rose-100" },
  2: { label: "L2 · Department", cls: "text-amber-700 bg-amber-50 border-amber-100" },
  1: { label: "L1 · Owner", cls: "text-blue-700 bg-blue-50 border-blue-100" },
};

function Kpi({ label, value, sub, tone }: { label: string; value: string | number; sub?: string; tone?: string }) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 p-3.5">
      <p className="text-[10px] text-gray-400 font-medium uppercase tracking-wide leading-tight">{label}</p>
      <p className={`text-2xl font-bold mt-1 ${tone ?? "text-gray-900"}`}>{value}</p>
      {sub && <p className="text-[10px] text-gray-400 mt-0.5">{sub}</p>}
    </div>
  );
}

export default async function GovernanceRiskPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient();
  const { data: profile } = await admin.from("profiles").select("role, roles").eq("id", user.id).single();
  const roles = (profile?.roles?.length ? profile.roles : [profile?.role]) as (string | null)[];
  if (!roles.includes("super_admin")) redirect("/dashboard");

  const d = await loadGovernanceRisk(admin) as any;
  const ex = d.exceptions;

  return (
    <div className="max-w-[1400px]">
      <div className="flex items-start justify-between gap-3 mb-5">
        <div>
          <p className="text-[11px] font-semibold text-emerald-600 uppercase tracking-widest mb-0.5">CGR-009 · Competency Governance</p>
          <h1 className="text-xl font-bold text-gray-900">Exception, Escalation &amp; Risk</h1>
          <p className="text-gray-400 text-sm mt-0.5">When normal competency governance can&apos;t be met — how risk is identified, escalated, authorised and closed. No hidden exceptions; every deviation is visible and time-bound.</p>
        </div>
        <div className="flex gap-2 shrink-0">
          <Link href="/super-admin/governance/risk" className="text-xs font-semibold text-emerald-700 hover:text-emerald-800 border border-emerald-200 bg-emerald-50 rounded-lg px-3 py-2">Enterprise risk →</Link>
          <Link href="/super-admin/cgr" className="text-xs font-semibold text-gray-500 hover:text-emerald-700 border border-gray-200 rounded-lg px-3 py-2">← CGR</Link>
        </div>
      </div>

      {!d.provisioned ? (
        <div className="bg-white border border-gray-200 rounded-xl p-8 text-center"><p className="text-sm text-gray-400">No governance risks or exceptions to manage yet — once competencies exist, governance concerns and escalations compute here.</p></div>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
            <Kpi label="Critical risks" value={d.byClass.critical} sub="patient-safety / compliance" tone={d.byClass.critical ? "text-rose-600" : "text-gray-900"} />
            <Kpi label="High risks" value={d.byClass.high} sub="urgent action" tone={d.byClass.high ? "text-orange-600" : "text-gray-900"} />
            <Kpi label="L3 escalations" value={d.byLevel[3]} sub="executive governance" tone={d.byLevel[3] ? "text-rose-600" : "text-gray-900"} />
            <Kpi label="Total concerns" value={d.queueTotal} sub="in the register" />
            <Kpi label="Active exceptions" value={ex.ready ? ex.active : "—"} sub="time-boxed grants" tone={ex.active ? "text-amber-600" : "text-gray-900"} />
            <Kpi label="Expiring soon" value={ex.ready ? ex.expiringSoon : "—"} sub="≤ 7 days" tone={ex.expiringSoon ? "text-rose-600" : "text-gray-900"} />
          </div>

          {/* Risk register summary + escalation levels */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="lg:col-span-2 bg-white rounded-xl border border-gray-100 p-4">
              <p className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-3">Governance risk register — by class</p>
              <div className="grid grid-cols-4 gap-2">
                {(["critical", "high", "moderate", "low"] as const).map((c) => (
                  <div key={c} className={`rounded-lg border p-3 text-center ${CLASS_META[c].cls}`}>
                    <p className="text-2xl font-bold tabular-nums">{d.byClass[c]}</p>
                    <p className="text-[10px] font-semibold">{CLASS_META[c].label}</p>
                  </div>
                ))}
              </div>
            </div>
            <div className="bg-white rounded-xl border border-gray-100 p-4">
              <p className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-3">Escalation levels</p>
              <div className="space-y-2">
                {[3, 2, 1].map((lv) => (
                  <div key={lv} className="flex items-center justify-between gap-2">
                    <span className={`text-[10px] font-bold border rounded px-1.5 py-0.5 ${LEVEL_META[lv].cls}`}>{LEVEL_META[lv].label}</span>
                    <span className="text-[14px] font-bold text-gray-700 tabular-nums">{d.byLevel[lv] ?? 0}</span>
                  </div>
                ))}
                <p className="text-[10px] text-gray-400 pt-1">Auto-escalated: expired high-risk, ungoverned, regulatory gaps.</p>
              </div>
            </div>
          </div>

          {/* Escalation queue */}
          <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
              <p className="text-sm font-bold text-gray-800">Escalation &amp; Risk Queue</p>
              <p className="text-[10px] text-gray-400">most severe first · {d.queueTotal} concerns</p>
            </div>
            {d.queue.length === 0 ? (
              <div className="p-6 text-center"><p className="text-sm text-emerald-600 font-medium">No governance concerns requiring escalation — the register is clear.</p></div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px]">
                  <thead><tr className="text-[9px] font-bold text-gray-400 uppercase tracking-wide">
                    <th className="text-left py-2 pl-4 pr-2">Competency</th>
                    <th className="text-left py-2 px-2">Inherent risk</th>
                    <th className="text-left py-2 px-2">Risk class</th>
                    <th className="text-left py-2 px-2">Escalation</th>
                    <th className="text-left py-2 pr-4 pl-2">Reasons</th>
                  </tr></thead>
                  <tbody>
                    {d.queue.map((q: any) => (
                      <tr key={q.id} className="border-t border-gray-50">
                        <td className="py-2 pl-4 pr-2">
                          <p className="text-[12px] font-medium text-gray-800 leading-tight">{q.name}</p>
                          <p className="text-[10px] text-gray-400">{q.domain ?? "—"}</p>
                        </td>
                        <td className="py-2 px-2"><span className={`text-[10px] font-bold border rounded px-1.5 py-0.5 capitalize ${RISK_META[q.risk] ?? RISK_META.standard}`}>{q.risk}</span></td>
                        <td className="py-2 px-2"><span className={`text-[10px] font-bold border rounded px-1.5 py-0.5 ${CLASS_META[q.riskClass].cls}`}>{CLASS_META[q.riskClass].label}</span></td>
                        <td className="py-2 px-2"><span className={`text-[10px] font-bold border rounded px-1.5 py-0.5 ${LEVEL_META[q.level].cls}`}>{LEVEL_META[q.level].label}</span></td>
                        <td className="py-2 pr-4 pl-2">
                          <div className="flex flex-wrap gap-1">
                            {q.reasons.map((rs: string) => <span key={rs} className="text-[10px] text-gray-500 bg-gray-50 border border-gray-100 rounded px-1.5 py-0.5">{rs}</span>)}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Exceptions register — break-glass */}
          <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
              <p className="text-sm font-bold text-gray-800">Authorised Exceptions <span className="text-[10px] font-normal text-gray-400">— emergency access grants (break-glass)</span></p>
              <p className="text-[10px] text-gray-400">{ex.active} active · {ex.expired} expired · {ex.revoked} revoked · <Link href="/super-admin/system/audit" className="text-emerald-600 hover:underline">admin →</Link></p>
            </div>
            {!ex.ready ? (
              <div className="p-6 text-center"><p className="text-[12px] text-gray-400">Break-glass exception register not available.</p></div>
            ) : ex.list.length === 0 ? (
              <div className="p-6 text-center"><p className="text-sm text-emerald-600 font-medium">No active exceptions — governance is operating within normal pathways.</p></div>
            ) : (
              <div className="divide-y divide-gray-50">
                {ex.list.map((g: any, i: number) => (
                  <div key={i} className="flex items-start justify-between gap-3 px-4 py-2.5">
                    <div className="min-w-0">
                      <p className="text-[12px] text-gray-700 leading-tight"><span className="font-semibold">{g.actor}</span> <span className="text-gray-400">· {g.target}</span> <span className={`ml-1 text-[9px] font-bold uppercase rounded px-1 ${g.scope === "act" ? "text-rose-700 bg-rose-50" : "text-gray-500 bg-gray-50"}`}>{g.scope}</span></p>
                      <p className="text-[10px] text-gray-400 truncate">{g.reason}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className={`text-[10px] font-semibold ${g.expiringSoon ? "text-rose-600" : "text-gray-500"}`}>expires {g.expiresAt ? g.expiresAt.slice(0, 16).replace("T", " ") : "—"}</p>
                      {g.expiringSoon && <p className="text-[9px] text-rose-500">≤ 7 days ⚠</p>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <p className="text-[11px] text-gray-400 leading-relaxed">Every concern is real: the escalation queue is derived live from the governance registry (at-risk, ungoverned and overdue competencies), classified by risk and auto-assigned an escalation level; the exceptions register is the platform&apos;s break-glass store — every grant is justified, authorised and hard-expiry time-boxed (no hidden exceptions). Enterprise risk register and break-glass administration are owned by <Link href="/super-admin/governance/risk" className="text-emerald-600 hover:underline">Governance Risk &amp; Controls</Link> and the System platform. Per the CGR mandate, AI may prioritise concerns and recommend mitigation but never approves exceptions or accepts organisational risk.</p>
        </div>
      )}
    </div>
  );
}
