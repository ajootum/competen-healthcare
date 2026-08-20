import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadGovernanceAudit } from "@/lib/cgr/audit";
import { Kpi } from "../_kit";
import { requireHqCapability } from "@/lib/hq/context";

// CGR-005 — Competency Audit & Evidence Assurance. The governance audit trail (continuous action-history across
// the CGR engines) + an evidence-assurance headline. The deep statistical assurance (evidence integrity,
// assessor reliability, drift) is owned by the CAPA Assurance platform and cross-linked. Super-admin.
export const dynamic = "force-dynamic";
/* eslint-disable @typescript-eslint/no-explicit-any */

const fmt = (iso: string) => {
  if (!iso) return "—";
  const d = iso.replace("T", " ");
  return d.slice(0, 16);
};
const FAMILY_TONE: Record<string, string> = {
  Approvals: "bg-[var(--cmp-color-success)]", Rejections: "bg-[var(--cmp-color-error)]", "Change control": "bg-[var(--cmp-color-information)]", "Competency decisions": "bg-teal-500",
  Standards: "bg-indigo-500", Publication: "bg-[var(--cmp-color-success)]", Lifecycle: "bg-[var(--cmp-color-warning)]", "AI governance": "bg-violet-500",
  Assessment: "bg-[var(--cmp-color-information)]", Evidence: "bg-cyan-500", "Other governance": "bg-gray-400",
};
const dotTone = (action: string) => {
  const a = (action || "").toLowerCase();
  if (a.includes("reject")) return "bg-[var(--cmp-color-error)]";
  if (a.includes("approv") || a.includes("publish")) return "bg-[var(--cmp-color-success)]";
  return "bg-gray-300";
};

export default async function GovernanceAuditPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient();
  const { data: profile } = await admin.from("profiles").select("role, roles").eq("id", user.id).single();
  await requireHqCapability("hq.quality.regulation.view");

  const d = await loadGovernanceAudit(admin) as any;
  const a = d.assurance;
  const famMax = Math.max(1, ...d.families.map((f: any) => f.count));

  return (
    <div className="max-w-[1400px]">
      <div className="flex items-start justify-between gap-3 mb-5">
        <div>
          <p className="text-[11px] font-semibold text-[var(--cmp-text-success)] uppercase tracking-widest mb-0.5">CGR-005 · Competency Governance</p>
          <h1 className="text-xl font-bold text-gray-900">Audit &amp; Evidence Assurance</h1>
          <p className="text-gray-500 text-sm mt-0.5">Can we prove the competency system is effective, current, evidence-based and audit-ready? The continuous governance audit trail plus the evidence-assurance headline.</p>
        </div>
        <div className="flex gap-2 shrink-0">
          <Link href="/super-admin/assurance" className="text-xs font-semibold text-emerald-700 hover:text-emerald-800 border border-[var(--cmp-color-success)] bg-[var(--cmp-surface-success)] rounded-lg px-3 py-2">Assurance engines →</Link>
          <Link href="/super-admin/cgr" className="text-xs font-semibold text-gray-500 hover:text-emerald-700 border border-gray-200 rounded-lg px-3 py-2">← CGR</Link>
        </div>
      </div>

      {!d.provisioned ? (
        <div className="bg-white border border-gray-200 rounded-xl p-8 text-center"><p className="text-sm text-gray-500">No governance audit events yet — as competencies are approved, changed, decided and mapped, the continuous audit trail builds here.</p></div>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
            <Kpi label="Governance events" value={d.totalEvents} sub="audited actions" />
            <Kpi label="Last 7 days" value={d.last7} sub="recent activity" />
            <Kpi label="Last 30 days" value={d.last30} sub="continuous monitoring" />
            <Kpi label="Distinct actors" value={d.actors} sub="accountable users" />
            <Kpi label="Evidence-backed" value={a ? `${a.evidencePct}%` : "—"} sub="have decisions" tone={a && a.evidencePct >= 70 ? "text-[var(--cmp-text-success)]" : "text-gray-900"} />
            <Kpi label="Overdue reviews" value={a ? a.overdue : "—"} sub="review compliance" tone={a && a.overdue ? "text-[var(--cmp-text-error)]" : "text-gray-900"} />
          </div>

          {/* Evidence assurance headline — deep engines owned by CAPA, cross-linked */}
          {a && (
            <div className="bg-white rounded-xl border border-gray-100 p-4">
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs font-bold text-gray-500 uppercase tracking-widest">Evidence assurance</p>
                <p className="text-[10px] text-gray-500">headline from the registry · deep engines in <Link href="/super-admin/assurance" className="text-[var(--cmp-text-success)] hover:underline">CAPA Assurance</Link></p>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                <div className="border border-gray-100 rounded-lg p-3"><p className={`text-xl font-bold tabular-nums ${a.avgScore >= 75 ? "text-[var(--cmp-text-success)]" : a.avgScore >= 45 ? "text-[var(--cmp-text-warning)]" : "text-[var(--cmp-text-error)]"}`}>{a.avgScore}</p><p className="text-[10px] text-gray-500">assurance score /100</p></div>
                <div className="border border-gray-100 rounded-lg p-3"><p className="text-xl font-bold text-gray-900 tabular-nums">{a.evidencePct}%</p><p className="text-[10px] text-gray-500">evidence-backed</p></div>
                <div className="border border-gray-100 rounded-lg p-3"><p className="text-xl font-bold text-gray-900 tabular-nums">{a.ownerPct}%</p><p className="text-[10px] text-gray-500">owned</p></div>
                <div className="border border-gray-100 rounded-lg p-3"><p className="text-xl font-bold text-gray-900 tabular-nums">{a.standardsPct}%</p><p className="text-[10px] text-gray-500">regulatory-mapped</p></div>
                <div className="border border-gray-100 rounded-lg p-3"><p className={`text-xl font-bold tabular-nums ${a.atRisk ? "text-[var(--cmp-text-error)]" : "text-gray-900"}`}>{a.atRisk}</p><p className="text-[10px] text-gray-500">at-risk / ungoverned</p></div>
              </div>
              <div className="flex flex-wrap gap-2 mt-3 text-[10px]">
                <Link href="/super-admin/assurance/evidence" className="text-emerald-700 bg-[var(--cmp-surface-success)] border border-[var(--cmp-color-success)] rounded-full px-2 py-0.5 hover:bg-[var(--cmp-surface-success)]">Evidence integrity →</Link>
                <Link href="/super-admin/assurance/assessor-reliability" className="text-emerald-700 bg-[var(--cmp-surface-success)] border border-[var(--cmp-color-success)] rounded-full px-2 py-0.5 hover:bg-[var(--cmp-surface-success)]">Assessor reliability →</Link>
                <Link href="/super-admin/assurance/drift" className="text-emerald-700 bg-[var(--cmp-surface-success)] border border-[var(--cmp-color-success)] rounded-full px-2 py-0.5 hover:bg-[var(--cmp-surface-success)]">Competency drift →</Link>
                <Link href="/unit-manager/capa" className="text-gray-500 bg-gray-50 border border-gray-100 rounded-full px-2 py-0.5 hover:bg-gray-100">Findings & corrective actions →</Link>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* Governance audit trail */}
            <div className="lg:col-span-2 bg-white rounded-xl border border-gray-100 overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
                <p className="text-sm font-bold text-gray-800">Governance Audit Trail</p>
                <p className="text-[10px] text-gray-500">newest first · <Link href="/super-admin/audit" className="text-[var(--cmp-text-success)] hover:underline">full log →</Link></p>
              </div>
              {d.feed.length === 0 ? (
                <div className="p-6 text-center"><p className="text-sm text-gray-500">No governance events recorded yet.</p></div>
              ) : (
                <div className="max-h-[460px] overflow-y-auto divide-y divide-gray-50">
                  {d.feed.map((f: any, i: number) => (
                    <div key={i} className="flex items-start gap-2.5 px-4 py-2">
                      <span className={`mt-1 w-1.5 h-1.5 rounded-full shrink-0 ${dotTone(f.action)}`} />
                      <div className="min-w-0 flex-1">
                        <p className="text-[12px] text-gray-700 leading-tight"><span className="font-semibold text-gray-800">{f.action}</span> <span className="text-gray-500">· {f.entityType}</span></p>
                        <p className="text-[10px] text-gray-500 truncate">{f.entityName}</p>
                      </div>
                      <div className="text-right shrink-0"><p className="text-[10px] text-gray-500">{f.actor}</p><p className="text-[9px] text-gray-500 tabular-nums">{fmt(f.ts)}</p></div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Activity by family + top actors */}
            <div className="space-y-4">
              <div className="bg-white rounded-xl border border-gray-100 p-4">
                <p className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-3">By activity type</p>
                <div className="space-y-1.5">
                  {d.families.map((f: any) => (
                    <div key={f.label} className="flex items-center gap-2">
                      <span className="text-[11px] text-gray-500 w-32 shrink-0 truncate">{f.label}</span>
                      <div className="flex-1 h-2.5 rounded bg-gray-50 overflow-hidden"><div className={`h-full ${FAMILY_TONE[f.label] ?? "bg-gray-400"} rounded`} style={{ width: `${(f.count / famMax) * 100}%` }} /></div>
                      <span className="text-[11px] font-bold text-gray-600 tabular-nums w-7 text-right">{f.count}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="bg-white rounded-xl border border-gray-100 p-4">
                <p className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-3">Most active (accountability)</p>
                {d.topActors.length === 0 ? (
                  <p className="text-[12px] text-gray-500">No attributed actions yet.</p>
                ) : (
                  <div className="space-y-1">
                    {d.topActors.map((ac: any) => (
                      <div key={ac.name} className="flex items-center justify-between gap-2 border border-gray-50 rounded-lg px-2.5 py-1.5">
                        <span className="text-[12px] text-gray-700 truncate">{ac.name}</span>
                        <span className="text-[11px] font-bold text-gray-500 tabular-nums shrink-0">{ac.count}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          <p className="text-[11px] text-gray-500 leading-relaxed">Every entry is a real recorded action — the governance audit trail joins the audit log and the domain-event stream, scoped to competency governance, so every approval, change, decision, mapping and lifecycle transition is traceable to an actor and time (§4.4 transparency). The evidence-assurance headline derives from the registry; the deep statistical assurance — evidence integrity, assessor reliability and competency drift — is owned by the <Link href="/super-admin/assurance" className="text-[var(--cmp-text-success)] hover:underline">CAPA Assurance platform</Link>, and findings &amp; corrective actions by the CAPA centre. Per the CGR mandate, AI may summarise findings and flag audit risk but never closes findings or determines compliance.</p>
        </div>
      )}
    </div>
  );
}
