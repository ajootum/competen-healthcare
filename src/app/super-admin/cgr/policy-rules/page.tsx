import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadPolicyRules } from "@/lib/cgr/policy-rules";
import { Kpi } from "../_kit";

// CGR-008 — Competency Governance Policy & Rules Engine. Makes the enforced governance rules explicit with live
// population compliance, the risk-tiered governance posture, and the real configured thresholds (review
// intervals / approval / evidence). Rule authoring cross-links to policy-manager + studio rules. Super-admin.
export const dynamic = "force-dynamic";
/* eslint-disable @typescript-eslint/no-explicit-any */

const RISK_META: Record<string, { label: string; cls: string; bar: string }> = {
  critical: { label: "Critical", cls: "text-[var(--cmp-text-error)] bg-[var(--cmp-surface-error)] border-[var(--cmp-color-error)]", bar: "bg-[var(--cmp-color-error)]" },
  high: { label: "High", cls: "text-orange-700 bg-[var(--cmp-surface-warning)] border-[var(--cmp-color-warning)]", bar: "bg-[var(--cmp-color-warning)]" },
  standard: { label: "Standard", cls: "text-gray-600 bg-gray-50 border-gray-200", bar: "bg-gray-400" },
  low: { label: "Low", cls: "text-slate-500 bg-slate-50 border-slate-200", bar: "bg-slate-400" },
};
const CAT_TONE: Record<string, string> = { Ownership: "bg-[var(--cmp-surface-information)] text-blue-700 border-[var(--cmp-color-information)]", Compliance: "bg-indigo-50 text-indigo-700 border-indigo-100", Lifecycle: "bg-[var(--cmp-surface-warning)] text-[var(--cmp-text-warning)] border-[var(--cmp-color-warning)]", Evidence: "bg-cyan-50 text-cyan-700 border-cyan-100", Approval: "bg-[var(--cmp-surface-success)] text-emerald-700 border-[var(--cmp-color-success)]" };
const complTone = (v: number) => (v >= 80 ? "bg-[var(--cmp-color-success)]" : v >= 50 ? "bg-[var(--cmp-color-warning)]" : "bg-[var(--cmp-color-error)]");

export default async function PolicyRulesPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient();
  const { data: profile } = await admin.from("profiles").select("role, roles").eq("id", user.id).single();
  const roles = (profile?.roles?.length ? profile.roles : [profile?.role]) as (string | null)[];
  if (!roles.includes("super_admin")) redirect("/dashboard");

  const d = await loadPolicyRules(admin) as any;

  return (
    <div className="max-w-[1400px]">
      <div className="flex items-start justify-between gap-3 mb-5">
        <div>
          <p className="text-[11px] font-semibold text-[var(--cmp-text-success)] uppercase tracking-widest mb-0.5">CGR-008 · Competency Governance</p>
          <h1 className="text-xl font-bold text-gray-900">Policy &amp; Rules Engine</h1>
          <p className="text-gray-400 text-sm mt-0.5">What governance rules apply, and how well the competency portfolio complies — the enforced ruleset made explicit, with risk-tiered policy and the real configured thresholds.</p>
        </div>
        <div className="flex gap-2 shrink-0">
          <Link href="/super-admin/policy-manager" className="text-xs font-semibold text-emerald-700 hover:text-emerald-800 border border-[var(--cmp-color-success)] bg-[var(--cmp-surface-success)] rounded-lg px-3 py-2">Author rules →</Link>
          <Link href="/super-admin/cgr" className="text-xs font-semibold text-gray-500 hover:text-emerald-700 border border-gray-200 rounded-lg px-3 py-2">← CGR</Link>
        </div>
      </div>

      {!d.provisioned ? (
        <div className="bg-white border border-gray-200 rounded-xl p-8 text-center"><p className="text-sm text-gray-400">No governance rules or configuration to evaluate yet — once competencies, blueprints and evidence matrices exist, the ruleset and compliance compute here.</p></div>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
            <Kpi label="Rule compliance" value={d.avgCompliance == null ? "—" : `${d.avgCompliance}%`} sub="avg across rules" tone={d.avgCompliance == null ? "text-gray-900" : d.avgCompliance >= 80 ? "text-[var(--cmp-text-success)]" : d.avgCompliance >= 50 ? "text-[var(--cmp-text-warning)]" : "text-[var(--cmp-text-error)]"} />
            <Kpi label="Active rules" value={d.rules.length} sub="enforced" />
            <Kpi label="Risk tiers" value={d.tiers.length} sub="governance posture" />
            <Kpi label="CPUs governed" value={d.cpuCount} sub="review intervals set" />
            <Kpi label="Approval blueprints" value={d.approvalRules.count} sub="approval rules" />
            <Kpi label="Evidence rules" value={d.evidenceRules.count} sub={`${d.evidenceRules.critical} critical`} />
          </div>

          {/* Governance ruleset scorecard */}
          <div className="bg-white rounded-xl border border-gray-100 p-4">
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs font-bold text-gray-500 uppercase tracking-widest">Governance ruleset — live compliance</p>
              <span className="text-[10px] text-gray-400">evaluated over {d.n} competencies</span>
            </div>
            {d.rules.length === 0 ? (
              <p className="text-[12px] text-gray-400">The governance registry is empty — rule compliance needs competency definitions. Configured thresholds still show below.</p>
            ) : (
              <div className="space-y-2.5">
                {d.rules.map((r: any) => (
                  <div key={r.name} className="flex items-center gap-3">
                    <span className={`text-[9px] font-bold uppercase tracking-wide border rounded px-1.5 py-0.5 w-20 text-center shrink-0 ${CAT_TONE[r.category] ?? "bg-gray-50 text-gray-600 border-gray-100"}`}>{r.category}</span>
                    <span className="text-[12px] text-gray-700 flex-1 min-w-0 truncate">{r.name}</span>
                    <div className="w-40 h-2 rounded-full bg-gray-100 overflow-hidden shrink-0"><div className={`h-full ${complTone(r.compliance)}`} style={{ width: `${r.compliance}%` }} /></div>
                    <span className="text-[12px] font-bold text-gray-700 tabular-nums w-10 text-right shrink-0">{r.compliance}%</span>
                    <span className="text-[10px] text-gray-400 tabular-nums w-16 text-right shrink-0">{r.met}/{r.total}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Risk-tiered policy */}
          <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
              <p className="text-sm font-bold text-gray-800">Risk-tiered governance policy</p>
              <p className="text-[10px] text-gray-400">stricter governance for higher risk</p>
            </div>
            {d.tiers.length === 0 ? (
              <div className="p-6 text-center"><p className="text-[12px] text-gray-400">No competencies to tier.</p></div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[620px]">
                  <thead><tr className="text-[9px] font-bold text-gray-400 uppercase tracking-wide">
                    <th className="text-left py-2 pl-4 pr-2">Risk tier</th>
                    <th className="text-center py-2 px-2">Competencies</th>
                    <th className="text-center py-2 px-2">Owned</th>
                    <th className="text-center py-2 px-2">Regulatory-mapped</th>
                    <th className="text-center py-2 px-2">Review current</th>
                    <th className="text-left py-2 pr-4 pl-2 w-40">Governance score</th>
                  </tr></thead>
                  <tbody>
                    {d.tiers.map((t: any) => (
                      <tr key={t.risk} className="border-t border-gray-50">
                        <td className="py-2 pl-4 pr-2"><span className={`text-[10px] font-bold border rounded px-1.5 py-0.5 ${RISK_META[t.risk].cls}`}>{RISK_META[t.risk].label}</span></td>
                        <td className="py-2 px-2 text-center text-[12px] text-gray-700 tabular-nums">{t.count}</td>
                        <td className="py-2 px-2 text-center text-[12px] tabular-nums"><span className={t.ownerPct >= 80 ? "text-[var(--cmp-text-success)]" : t.ownerPct >= 50 ? "text-gray-700" : "text-[var(--cmp-text-error)]"}>{t.ownerPct}%</span></td>
                        <td className="py-2 px-2 text-center text-[12px] tabular-nums"><span className={t.mappedPct >= 80 ? "text-[var(--cmp-text-success)]" : "text-gray-600"}>{t.mappedPct}%</span></td>
                        <td className="py-2 px-2 text-center text-[12px] tabular-nums"><span className={t.reviewPct >= 80 ? "text-[var(--cmp-text-success)]" : t.reviewPct >= 50 ? "text-[var(--cmp-text-warning)]" : "text-[var(--cmp-text-error)]"}>{t.reviewPct}%</span></td>
                        <td className="py-2 pr-4 pl-2">
                          <div className="flex items-center gap-2">
                            <div className="flex-1 h-1.5 rounded-full bg-gray-100 overflow-hidden"><div className={`h-full ${complTone(t.avgScore)}`} style={{ width: `${t.avgScore}%` }} /></div>
                            <span className="text-[11px] font-bold text-gray-600 tabular-nums w-6">{t.avgScore}</span>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Configured thresholds */}
          <div>
            <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">Configured governance thresholds — the real stored rules</p>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              {/* Review intervals */}
              <div className="bg-white rounded-xl border border-gray-100 p-4">
                <p className="text-[11px] font-semibold text-gray-500 mb-3">⏱️ Review intervals by risk</p>
                {d.reviewByRisk.length === 0 ? (
                  <p className="text-[12px] text-gray-400">No CPU review intervals configured.</p>
                ) : (
                  <div className="space-y-2">
                    {d.reviewByRisk.map((rv: any) => (
                      <div key={rv.risk} className="flex items-center justify-between gap-2">
                        <span className={`text-[10px] font-bold border rounded px-1.5 py-0.5 ${RISK_META[rv.risk].cls}`}>{RISK_META[rv.risk].label}</span>
                        <span className="text-[12px] text-gray-700"><span className="font-bold tabular-nums">{rv.avgMonths}</span> mo <span className="text-[10px] text-gray-400">· {rv.count} CPU{rv.count === 1 ? "" : "s"}</span></span>
                      </div>
                    ))}
                    <p className="text-[10px] text-gray-400 pt-1">Reassessment cadence — shorter for higher risk.</p>
                  </div>
                )}
              </div>

              {/* Approval rules */}
              <div className="bg-white rounded-xl border border-gray-100 p-4">
                <p className="text-[11px] font-semibold text-gray-500 mb-3">✅ Approval rules (blueprints)</p>
                {d.approvalRules.count === 0 ? (
                  <p className="text-[12px] text-gray-400">No assessment blueprints configured.</p>
                ) : (
                  <>
                    <div className="grid grid-cols-2 gap-2 mb-2">
                      <div className="border border-gray-100 rounded-lg p-2"><p className="text-lg font-bold text-gray-800 tabular-nums">{d.approvalRules.avgMinScore ?? "—"}</p><p className="text-[10px] text-gray-500">avg min score /6</p></div>
                      <div className="border border-gray-100 rounded-lg p-2"><p className="text-lg font-bold text-gray-800 tabular-nums">{d.approvalRules.avgMinAssessors ?? "—"}</p><p className="text-[10px] text-gray-500">avg min assessors</p></div>
                    </div>
                    <p className="text-[10px] font-semibold text-gray-400 uppercase mb-1">Consensus rule</p>
                    <div className="flex flex-wrap gap-1">
                      {d.approvalRules.consensus.map((c: any) => <span key={c.rule} className="text-[10px] text-gray-600 bg-gray-50 border border-gray-100 rounded px-1.5 py-0.5 capitalize">{c.rule} <span className="font-semibold">{c.count}</span></span>)}
                    </div>
                  </>
                )}
              </div>

              {/* Evidence rules */}
              <div className="bg-white rounded-xl border border-gray-100 p-4">
                <p className="text-[11px] font-semibold text-gray-500 mb-3">📎 Evidence rules (matrix)</p>
                {d.evidenceRules.count === 0 ? (
                  <p className="text-[12px] text-gray-400">No evidence matrix rules configured.</p>
                ) : (
                  <div className="grid grid-cols-3 gap-2">
                    <div className="border border-gray-100 rounded-lg p-2 text-center"><p className="text-lg font-bold text-gray-800 tabular-nums">{d.evidenceRules.count}</p><p className="text-[10px] text-gray-500">rules</p></div>
                    <div className="border border-gray-100 rounded-lg p-2 text-center"><p className="text-lg font-bold text-[var(--cmp-text-error)] tabular-nums">{d.evidenceRules.critical}</p><p className="text-[10px] text-gray-500">critical</p></div>
                    <div className="border border-gray-100 rounded-lg p-2 text-center"><p className="text-lg font-bold text-gray-800 tabular-nums">{d.evidenceRules.avgValidityMonths ?? "—"}</p><p className="text-[10px] text-gray-500">avg validity mo</p></div>
                  </div>
                )}
              </div>
            </div>
          </div>

          <p className="text-[11px] text-gray-400 leading-relaxed">Every rule and threshold here is real: compliance rates are evaluated live over the governance registry, and the configured thresholds are the actual stored governance config — reassessment cadence (CPU reassessment intervals), approval rules (assessment blueprints) and evidence requirements (evidence matrix). Authoring and versioning rules/policies happens in <Link href="/super-admin/policy-manager" className="text-[var(--cmp-text-success)] hover:underline">the policy manager</Link> and <Link href="/super-admin/studio/rules" className="text-[var(--cmp-text-success)] hover:underline">the rules engine</Link>, with rule <Link href="/super-admin/studio/testing" className="text-[var(--cmp-text-success)] hover:underline">simulation &amp; testing</Link> before release. Per the CGR mandate, AI may recommend rule improvements but never creates binding rules or overrides governance authority.</p>
        </div>
      )}
    </div>
  );
}
