import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadComplianceReporting } from "@/lib/cgr/compliance";
import { Kpi } from "../_kit";
import { requireHqCapability } from "@/lib/hq/context";

// CGR-011 — Competency Governance Compliance Reporting & Regulatory Assurance. A compliance report composing the
// registry compliance dimensions (score + risk rating + evidence-pack summary) with the real accreditation
// requirement register (cmo_accreditations → Requirement/Evidence/Status/Action). Report building cross-links to
// QAW accreditation. Super-admin.
export const dynamic = "force-dynamic";
/* eslint-disable @typescript-eslint/no-explicit-any */

const STATUS_META: Record<string, { label: string; cls: string }> = {
  compliant: { label: "Compliant", cls: "text-emerald-700 bg-[var(--cmp-surface-success)] border-[var(--cmp-color-success)]" },
  partial: { label: "Partial", cls: "text-[var(--cmp-text-warning)] bg-[var(--cmp-surface-warning)] border-[var(--cmp-color-warning)]" },
  gap: { label: "Gap", cls: "text-[var(--cmp-text-error)] bg-[var(--cmp-surface-error)] border-[var(--cmp-color-error)]" },
  not_mapped: { label: "Not mapped", cls: "text-gray-500 bg-gray-50 border-gray-200" },
};
const RATING_TONE: Record<string, string> = { Low: "text-[var(--cmp-text-success)]", Moderate: "text-[var(--cmp-text-warning)]", High: "text-[var(--cmp-text-warning)]", Critical: "text-[var(--cmp-text-error)]", "—": "text-gray-900" };
const barTone = (v: number) => (v >= 80 ? "bg-[var(--cmp-color-success)]" : v >= 50 ? "bg-[var(--cmp-color-warning)]" : "bg-[var(--cmp-color-error)]");

export default async function ComplianceReportingPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient();
  const { data: profile } = await admin.from("profiles").select("role, roles").eq("id", user.id).single();
  await requireHqCapability("hq.quality.regulation.view");

  const d = await loadComplianceReporting(admin) as any;
  const s = d.summary;
  const openReqs = d.standards.reduce((t: number, x: any) => t + x.partial + x.gap, 0);

  return (
    <div className="max-w-[1400px]">
      <div className="flex items-start justify-between gap-3 mb-5">
        <div>
          <p className="text-[11px] font-semibold text-[var(--cmp-text-success)] uppercase tracking-widest mb-0.5">CGR-011 · Competency Governance</p>
          <h1 className="text-xl font-bold text-gray-900">Compliance Reporting &amp; Regulatory Assurance</h1>
          <p className="text-gray-500 text-sm mt-0.5">Can we demonstrate, through reliable evidence, that our competency system meets regulatory, organisational and professional requirements? Evidence-based, real-time, audit-ready.</p>
        </div>
        <div className="flex gap-2 shrink-0">
          <Link href="/quality-accreditation/accreditation" className="text-xs font-semibold text-emerald-700 hover:text-emerald-800 border border-[var(--cmp-color-success)] bg-[var(--cmp-surface-success)] rounded-lg px-3 py-2">Report builder →</Link>
          <Link href="/super-admin/cgr" className="text-xs font-semibold text-gray-500 hover:text-emerald-700 border border-gray-200 rounded-lg px-3 py-2">← CGR</Link>
        </div>
      </div>

      {!d.provisioned ? (
        <div className="bg-white border border-gray-200 rounded-xl p-8 text-center"><p className="text-sm text-gray-500">No competency or accreditation data to report on yet — the compliance score and regulatory assurance compute once competencies and accreditation requirements exist.</p></div>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
            <Kpi label="Compliance score" value={d.complianceScore == null ? "—" : `${d.complianceScore}`} sub="/100 composite" tone={d.complianceScore == null ? "text-gray-900" : barTone(d.complianceScore).replace("bg-", "text-")} />
            <Kpi label="Risk rating" value={d.riskRating} sub="overall exposure" tone={RATING_TONE[d.riskRating]} />
            <Kpi label="Accreditation readiness" value={d.accreditation.readiness == null ? "—" : `${d.accreditation.readiness}%`} sub={`${d.accreditation.total} requirements`} tone={d.accreditation.readiness == null ? "text-gray-900" : d.accreditation.readiness >= 80 ? "text-[var(--cmp-text-success)]" : "text-[var(--cmp-text-warning)]"} />
            <Kpi label="Evidence completeness" value={s ? `${s.evidence}%` : "—"} sub="evidence-backed" />
            <Kpi label="Overdue reviews" value={s ? s.overdue : "—"} sub="currency gaps" tone={s && s.overdue ? "text-[var(--cmp-text-error)]" : "text-gray-900"} />
            <Kpi label="Open requirements" value={openReqs} sub="partial or gap" tone={openReqs ? "text-[var(--cmp-text-warning)]" : "text-gray-900"} />
          </div>

          {/* Compliance scorecard */}
          {d.dimensions.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-100 p-4">
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs font-bold text-gray-500 uppercase tracking-widest">Compliance scoring model (§8)</p>
                <span className={`text-[11px] font-bold ${RATING_TONE[d.riskRating]}`}>{d.riskRating} risk · {d.complianceScore}/100</span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
                {d.dimensions.map((dim: any) => (
                  <div key={dim.label}>
                    <div className="flex items-center justify-between mb-0.5"><span className="text-[11px] text-gray-500">{dim.label}</span><span className="text-[11px] font-bold text-gray-700 tabular-nums">{dim.pct}%</span></div>
                    <div className="h-1.5 rounded-full bg-gray-100 overflow-hidden"><div className={`h-full ${barTone(dim.pct)}`} style={{ width: `${dim.pct}%` }} /></div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Regulatory assurance by standard */}
            <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
                <p className="text-sm font-bold text-gray-800">Accreditation readiness by standard</p>
                <p className="text-[10px] text-gray-500">weakest first</p>
              </div>
              {d.standards.length === 0 ? (
                <div className="p-6 text-center"><p className="text-sm text-gray-500">No accreditation requirements recorded. <Link href="/competency-office/accreditation" className="text-[var(--cmp-text-success)] hover:underline">Map requirements →</Link></p></div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[520px]">
                    <thead><tr className="text-[9px] font-bold text-gray-500 uppercase tracking-wide">
                      <th className="text-left py-2 pl-4 pr-2">Standard</th>
                      <th className="text-center py-2 px-2">Reqs</th>
                      <th className="text-center py-2 px-2">✓/~/✕</th>
                      <th className="text-left py-2 pr-4 pl-2 w-32">Readiness</th>
                    </tr></thead>
                    <tbody>
                      {d.standards.map((st: any) => (
                        <tr key={st.standard} className="border-t border-gray-50">
                          <td className="py-2 pl-4 pr-2 text-[12px] font-semibold text-gray-800">{st.standard}</td>
                          <td className="py-2 px-2 text-center text-[12px] text-gray-600 tabular-nums">{st.requirements}</td>
                          <td className="py-2 px-2 text-center text-[11px] tabular-nums"><span className="text-[var(--cmp-text-success)] font-semibold">{st.compliant}</span><span className="text-gray-500">/</span><span className="text-[var(--cmp-text-warning)]">{st.partial}</span><span className="text-gray-500">/</span><span className="text-[var(--cmp-text-error)]">{st.gap}</span></td>
                          <td className="py-2 pr-4 pl-2">
                            <div className="flex items-center gap-2">
                              <div className="flex-1 h-1.5 rounded-full bg-gray-100 overflow-hidden"><div className={`h-full ${barTone(st.readiness)}`} style={{ width: `${st.readiness}%` }} /></div>
                              <span className="text-[11px] font-bold text-gray-600 tabular-nums w-8 text-right">{st.readiness}%</span>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Evidence pack summary */}
            <div className="bg-white rounded-xl border border-gray-100 p-4">
              <p className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-3">Evidence pack summary (§9)</p>
              {!s ? (
                <p className="text-[12px] text-gray-500">Registry not provisioned — the evidence-pack numbers need competency definitions.</p>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="border border-gray-100 rounded-lg p-3"><p className="text-xl font-bold text-gray-900 tabular-nums">{s.governed}</p><p className="text-[10px] text-gray-500">governed competencies</p></div>
                    <div className="border border-gray-100 rounded-lg p-3"><p className={`text-xl font-bold tabular-nums ${s.assurance >= 75 ? "text-[var(--cmp-text-success)]" : "text-gray-900"}`}>{s.assurance}</p><p className="text-[10px] text-gray-500">assurance score</p></div>
                    <div className="border border-gray-100 rounded-lg p-3"><p className="text-xl font-bold text-gray-900 tabular-nums">{s.regulatory}%</p><p className="text-[10px] text-gray-500">regulatory alignment</p></div>
                    <div className="border border-gray-100 rounded-lg p-3"><p className={`text-xl font-bold tabular-nums ${s.atRisk ? "text-[var(--cmp-text-error)]" : "text-gray-900"}`}>{s.atRisk}</p><p className="text-[10px] text-gray-500">at-risk / ungoverned</p></div>
                  </div>
                  <p className="text-[10px] text-gray-500 mt-3">An evidence package for accreditation includes competency records, approval history (<Link href="/super-admin/cgr/approvals" className="text-[var(--cmp-text-success)] hover:underline">CGR-003</Link>), audit results (<Link href="/super-admin/cgr/audit" className="text-[var(--cmp-text-success)] hover:underline">CGR-005</Link>) and improvement actions.</p>
                </>
              )}
            </div>
          </div>

          {/* Requirement register — §7 Requirement → Status → Action */}
          <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
              <p className="text-sm font-bold text-gray-800">Regulatory requirement register</p>
              <p className="text-[10px] text-gray-500">requirement → evidence → status → action · non-compliant first</p>
            </div>
            {d.requirements.length === 0 ? (
              <div className="p-6 text-center"><p className="text-sm text-[var(--cmp-text-success)] font-medium">{d.accreditation.total > 0 ? "Every recorded requirement is compliant." : "No accreditation requirements recorded yet."}</p></div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[680px]">
                  <thead><tr className="text-[9px] font-bold text-gray-500 uppercase tracking-wide">
                    <th className="text-left py-2 pl-4 pr-2">Standard</th>
                    <th className="text-left py-2 px-2">Requirement</th>
                    <th className="text-left py-2 px-2">Mapped competency</th>
                    <th className="text-center py-2 px-2">Evidence</th>
                    <th className="text-left py-2 pr-4 pl-2">Status</th>
                  </tr></thead>
                  <tbody>
                    {d.requirements.map((rq: any, i: number) => (
                      <tr key={i} className="border-t border-gray-50">
                        <td className="py-2 pl-4 pr-2 text-[12px] font-semibold text-gray-700">{rq.standard}</td>
                        <td className="py-2 px-2 text-[12px] text-gray-700">{rq.requirement}</td>
                        <td className="py-2 px-2 text-[11px] text-gray-500">{rq.mapped ?? <span className="text-rose-500">unmapped</span>}</td>
                        <td className="py-2 px-2 text-center text-[11px] tabular-nums"><span className={rq.evidence ? "text-gray-600" : "text-rose-500 font-semibold"}>{rq.evidence}</span></td>
                        <td className="py-2 pr-4 pl-2"><span className={`text-[10px] font-bold border rounded px-1.5 py-0.5 ${(STATUS_META[rq.status] ?? STATUS_META.gap).cls}`}>{(STATUS_META[rq.status] ?? STATUS_META.gap).label}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <p className="text-[11px] text-gray-500 leading-relaxed">Every compliance statement is traceable to source: the compliance score and dimensions are computed live from the governance registry, and the regulatory requirement register is the real accreditation store (requirement → mapped competency → evidence count → compliance status). Report building, accreditation surveys and regulatory submissions are owned by <Link href="/quality-accreditation/accreditation" className="text-[var(--cmp-text-success)] hover:underline">Quality &amp; Accreditation</Link>; competency accreditation mapping by the <Link href="/competency-office/accreditation" className="text-[var(--cmp-text-success)] hover:underline">Competency Office</Link>. Per the CGR mandate, AI may generate compliance summaries and prepare evidence packages but never declares compliance or approves submissions.</p>
        </div>
      )}
    </div>
  );
}
