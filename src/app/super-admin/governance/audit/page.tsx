import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadAuditAssurance } from "@/lib/super-admin/gov-audit";
import AssuranceCenter from "./AssuranceCenter";

export const dynamic = "force-dynamic";

// Audit & Assurance (GOV-001.5) — the audit programme, findings, CAPA workflow
// and assurance coverage, built entirely on the real quality-engine tables
// (audits / audit_findings / capa_actions). Audit planning is live via the new
// plan mode; completed audits arrive through the assessor cockpit's governed
// checklist flow.
/* eslint-disable @typescript-eslint/no-explicit-any */

const card = "bg-white rounded-xl border border-gray-200";
const dash = (n: number | null | undefined) => (n == null ? "—" : n.toLocaleString());
const relTime = (iso?: string | null) => { if (!iso) return ""; const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000); if (s < 60) return "just now"; if (s < 3600) return `${Math.floor(s / 60)}m ago`; if (s < 86400) return `${Math.floor(s / 3600)}h ago`; return `${Math.floor(s / 86400)}d ago`; };
const scoreTone = (n: number | null) => (n == null ? "text-gray-300" : n >= 90 ? "text-green-600" : n >= 70 ? "text-amber-600" : "text-rose-600");
const AUDIT_STATUS_BADGE: Record<string, string> = { planned: "bg-blue-50 text-blue-700", in_progress: "bg-amber-50 text-amber-700", completed: "bg-green-50 text-green-700" };
const CAPA_BADGE: Record<string, string> = { open: "bg-rose-50 text-rose-700", in_progress: "bg-amber-50 text-amber-700", completed: "bg-teal-50 text-teal-700", verified: "bg-green-50 text-green-700", closed: "bg-gray-100 text-gray-500" };

export default async function AuditAssurance() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.includes("super_admin")) redirect("/dashboard");

  const d = await loadAuditAssurance(admin);
  const k = d.kpis;

  const kpiCards = [
    { label: "Total Audits", value: dash(k.total), icon: "📋", iconBg: "bg-blue-50" },
    { label: "Completed", value: dash(k.completed), icon: "✅", iconBg: "bg-green-50", tone: "text-green-600" },
    { label: "Planned", value: dash(k.planned), icon: "📅", iconBg: "bg-sky-50" },
    { label: "In Progress", value: dash(k.inProgress), icon: "⏳", iconBg: "bg-amber-50" },
    { label: "Avg Compliance", value: k.avgCompliance == null ? "—" : `${k.avgCompliance}%`, icon: "🎯", iconBg: "bg-violet-50", tone: scoreTone(k.avgCompliance == null ? null : Math.round(k.avgCompliance)) },
    { label: "Critical Findings", value: dash(k.criticalFindings), icon: "🚨", iconBg: "bg-rose-50", tone: (k.criticalFindings ?? 0) > 0 ? "text-rose-600" : undefined },
  ];

  return (
    <div data-wide className="space-y-4">
      <div>
        <div className="flex items-center gap-2 text-xs text-gray-400">
          <Link href="/super-admin/governance" className="hover:text-teal-700">Governance &amp; Compliance</Link><span>/</span><span className="text-gray-600">Audit &amp; Assurance</span>
        </div>
        <h1 className="text-2xl font-bold text-gray-900 mt-0.5">Audit &amp; Assurance</h1>
        <p className="text-sm text-gray-500">Plan, execute and track audits, findings and corrective actions.</p>
      </div>

      {/* KPI ribbon */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        {kpiCards.map(c => (
          <div key={c.label} className={`${card} p-4`}>
            <div className="flex items-start justify-between">
              <span className="text-[11px] font-semibold text-gray-500 leading-tight">{c.label}</span>
              <span className={`w-7 h-7 rounded-lg ${c.iconBg} flex items-center justify-center text-sm shrink-0`}>{c.icon}</span>
            </div>
            <p className={`text-2xl font-bold mt-1.5 tabular-nums ${(c as any).tone ?? "text-gray-900"}`}>{c.value}</p>
          </div>
        ))}
      </div>

      {/* Real in-place assurance actions */}
      <AssuranceCenter openCapas={d.pickers.openCapas} />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Audit programme */}
        <div className={`${card} p-5 lg:col-span-2`}>
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-gray-900 text-[15px]">Audit Programme</h2>
            <span className="text-[10px] text-gray-400">{Object.entries(d.byType).map(([t, n]) => `${t} ${n}`).join(" · ") || "—"}</span>
          </div>
          {d.auditList.length === 0 ? <p className="text-sm text-gray-400 py-6 text-center">No audits yet — plan the first one above.</p> : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="text-left text-[11px] uppercase tracking-wide text-gray-400 border-b border-gray-100">
                  <th className="px-3 py-2 font-semibold">Audit</th><th className="px-3 py-2 font-semibold">Type</th><th className="px-3 py-2 font-semibold">Area</th><th className="px-3 py-2 font-semibold">Org</th><th className="px-3 py-2 font-semibold text-right">Compliance</th><th className="px-3 py-2 font-semibold text-right">Status</th>
                </tr></thead>
                <tbody>
                  {d.auditList.map((a: any) => (
                    <tr key={a.id} className="border-b border-gray-50">
                      <td className="px-3 py-2 text-gray-800">{a.title}{a.plannedFor && <span className="text-[10px] text-sky-600 ml-1.5">{a.plannedFor}</span>}</td>
                      <td className="px-3 py-2 text-gray-500 capitalize text-[12px]">{a.type}</td>
                      <td className="px-3 py-2 text-gray-500 text-[12px]">{a.area ?? "—"}</td>
                      <td className="px-3 py-2 text-gray-500 text-[12px]">{a.org}</td>
                      <td className={`px-3 py-2 text-right tabular-nums font-medium ${scoreTone(a.pct)}`}>{a.pct == null ? "—" : `${a.pct}%`}</td>
                      <td className="px-3 py-2 text-right"><span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${AUDIT_STATUS_BADGE[a.status] ?? "bg-gray-100 text-gray-600"}`}>{String(a.status).replace(/_/g, " ")}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Findings summary */}
        <div className={`${card} p-5`}>
          <h2 className="font-semibold text-gray-900 text-[15px] mb-3">Findings Summary <span className="text-[10px] text-gray-400">{d.findings.total} total</span></h2>
          <div className="grid grid-cols-3 gap-2 mb-3">
            {[["Met", d.findings.met, "text-green-600"], ["Not met", d.findings.notMet, "text-rose-600"], ["N/A", d.findings.na, "text-gray-400"]].map(([l, n, tone]: any) => (
              <div key={l} className="rounded-lg border border-gray-100 p-2.5 text-center"><p className={`text-xl font-bold tabular-nums ${n > 0 ? tone : "text-gray-900"}`}>{n}</p><p className="text-[9px] text-gray-500">{l}</p></div>
            ))}
          </div>
          {d.recentFindings.length > 0 && (
            <div className="space-y-1.5 pt-2 border-t border-gray-50">
              <p className="text-[10px] font-semibold text-gray-400 uppercase">Recent not-met</p>
              {d.recentFindings.map((f: any, i: number) => (
                <div key={i} className="flex items-start gap-2">
                  <span className={`w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${f.is_critical ? "bg-rose-500" : "bg-amber-400"}`} />
                  <div className="min-w-0 flex-1"><p className="text-xs text-gray-700 leading-tight">{f.item_text}</p><p className="text-[9px] text-gray-400">{f.is_critical ? "critical · " : ""}{relTime(f.created_at)}</p></div>
                </div>
              ))}
            </div>
          )}
          <p className="text-[10px] text-gray-400 mt-3">N/A findings are excluded from compliance percentages (canonical definition).</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* CAPA workflow */}
        <div className={`${card} p-5 lg:col-span-2`}>
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-gray-900 text-[15px]">CAPA Workflow <span className="text-[10px] text-gray-400">{d.capa.open} open · {dash(d.capa.closure)}% closure</span></h2>
            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded ${d.capa.overdue > 0 ? "bg-rose-50 text-rose-700" : "bg-green-50 text-green-700"}`}>{d.capa.overdue} overdue</span>
          </div>
          {d.capa.list.length === 0 ? <p className="text-sm text-gray-400 py-6 text-center">No open corrective actions.</p> : (
            <div className="divide-y divide-gray-50">
              {d.capa.list.map((c: any) => (
                <div key={c.id} className="flex items-center gap-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-gray-800 leading-tight truncate">{c.title}{c.overdue && <span className="text-[9px] font-semibold text-rose-600 ml-1.5">OVERDUE</span>}</p>
                    <p className="text-[10px] text-gray-400">{c.priority} priority{c.owner ? ` · ${c.owner}` : ""}{c.due ? ` · due ${c.due}` : ""}</p>
                  </div>
                  <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded shrink-0 ${CAPA_BADGE[c.status] ?? "bg-gray-100 text-gray-600"}`}>{String(c.status).replace(/_/g, " ")}</span>
                </div>
              ))}
            </div>
          )}
          <div className="grid grid-cols-3 gap-2 mt-3 pt-3 border-t border-gray-50">
            {[["< 7 days", d.capa.ageing.fresh], ["7–30 days", d.capa.ageing.week], ["> 30 days", d.capa.ageing.month]].map(([l, n]: any) => (
              <div key={l} className="rounded-lg border border-gray-100 p-2 text-center"><p className={`text-lg font-bold tabular-nums ${l === "> 30 days" && n > 0 ? "text-rose-600" : "text-gray-900"}`}>{n}</p><p className="text-[9px] text-gray-500">open {l}</p></div>
            ))}
          </div>
        </div>

        {/* Assurance coverage */}
        <div className={`${card} p-5`}>
          <h2 className="font-semibold text-gray-900 text-[15px] mb-3">Assurance Coverage</h2>
          <div className="space-y-2">
            {d.assurance.map((a: any) => {
              const inner = (
                <div className="flex items-center justify-between rounded-lg border border-gray-100 px-3 py-2.5 hover:border-teal-300 transition-colors">
                  <div className="min-w-0"><p className="text-sm font-medium text-gray-800 leading-tight">{a.line}</p><p className="text-[10px] text-gray-400">{a.source}</p></div>
                  <span className="text-lg font-bold text-gray-900 tabular-nums shrink-0 ml-2">{dash(a.count)}</span>
                </div>
              );
              return a.href ? <Link key={a.line} href={a.href} className="block">{inner}</Link> : <div key={a.line}>{inner}</div>;
            })}
          </div>
          <p className="text-[10px] text-gray-400 mt-3">The three lines of defence, tied to the live registers. External assurance providers land with survey management (module 6).</p>
        </div>
      </div>

      <p className="text-[11px] text-gray-400 pb-4">Audit &amp; Assurance runs on the real quality-engine tables: the programme (planned via this module, conducted through the assessor cockpit’s checklist flow with immutable finding snapshots and auto-CAPA on critical fails), findings with the canonical N/A-excluded compliance definition, and the forward-only CAPA workflow with ageing and closure tracking. Working papers, interview records and audit-committee packs deepen in a later phase.</p>
    </div>
  );
}
