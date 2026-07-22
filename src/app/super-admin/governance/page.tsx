import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadGovernance } from "@/lib/super-admin/governance";

export const dynamic = "force-dynamic";

// Governance & Compliance (GOV-001) — module 1: the Governance Dashboard, the
// executive command centre for governance, risk, compliance, audit and
// accreditation oversight. Every figure is live from real records (audits,
// CAPA, policies, committees, approval queues, EQOS frameworks) or an honest
// "not modelled" state — the risk register, controls library, obligations
// register and regulatory feed land with their modules.
/* eslint-disable @typescript-eslint/no-explicit-any */

const card = "bg-white rounded-xl border border-gray-200";
const fmt = (n: number) => n.toLocaleString();
const dash = (n: number | null | undefined) => (n == null ? "—" : n.toLocaleString());
const pct = (n: number | null | undefined) => (n == null ? "—" : `${n}%`);
const relTime = (iso?: string | null) => { if (!iso) return ""; const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000); if (s < 60) return "just now"; if (s < 3600) return `${Math.floor(s / 60)}m ago`; if (s < 86400) return `${Math.floor(s / 3600)}h ago`; return `${Math.floor(s / 86400)}d ago`; };
const scoreTone = (n: number | null) => (n == null ? "text-gray-300" : n >= 90 ? "text-green-600" : n >= 75 ? "text-teal-600" : n >= 50 ? "text-amber-600" : "text-rose-600");
const CAPA_TONE: Record<string, string> = { open: "text-rose-600", in_progress: "text-amber-600", completed: "text-teal-600", verified: "text-green-600", closed: "text-green-600" };

export default async function GovernanceDashboard() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.includes("super_admin")) redirect("/dashboard");

  const g = await loadGovernance(admin);
  const k = g.kpis;

  const ribbon = [
    { label: "Governance Score", value: k.governanceScore == null ? "—" : `${k.governanceScore}/100`, icon: "🛡️", tone: scoreTone(k.governanceScore) },
    { label: "Compliance Rate", value: k.complianceRate == null ? "—" : `${k.complianceRate}%`, icon: "✅", tone: scoreTone(k.complianceRate == null ? null : Math.round(k.complianceRate)) },
    { label: "Open Risk Indicators", value: dash(k.openRisks), icon: "⚠️", tone: (k.openRisks ?? 0) > 0 ? "text-amber-600" : "text-gray-900" },
    { label: "Audit Completion", value: pct(k.auditCompletion), icon: "📋", tone: "text-gray-900" },
    { label: "Policies Due / Overdue", value: dash(k.policiesDue), icon: "📄", tone: (k.policiesDue ?? 0) > 0 ? "text-amber-600" : "text-gray-900" },
    { label: "Regulatory Alerts", value: dash(k.regulatoryAlerts), icon: "🔔", tone: "text-gray-400" },
  ];

  const actions = [
    { label: "Create Policy", icon: "📄", href: "/super-admin/policy-manager" },
    { label: "New Committee", icon: "⚖️", href: "/super-admin/governance/committees" },
    { label: "Review Approvals", icon: "✅", href: "/super-admin/platform-ops/approvals" },
    { label: "Quality Objects", icon: "🧭", href: "/admin/quality" },
    { label: "Audit Trail", icon: "🗒️", href: "/super-admin/audit" },
    { label: "Report Templates", icon: "📈", href: "/super-admin/reports" },
  ];

  return (
    <div data-wide className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Governance &amp; Compliance</h1>
          <p className="text-sm text-gray-500">Enterprise governance, risk, compliance, audit and accreditation oversight across all organisations.</p>
        </div>
        <span className="text-xs text-gray-400 tabular-nums">Updated {new Date(g.generatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
      </div>

      {/* KPI ribbon */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        {ribbon.map(c => (
          <div key={c.label} className={`${card} p-4`}>
            <div className="flex items-start justify-between">
              <span className="text-[11px] font-semibold text-gray-500 leading-tight">{c.label}</span>
              <span className="text-sm shrink-0">{c.icon}</span>
            </div>
            <p className={`text-2xl font-bold mt-1.5 tabular-nums ${c.tone}`}>{c.value}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Governance scorecard dimensions */}
        <div className={`${card} p-5`}>
          <h2 className="font-semibold text-gray-900 text-[15px] mb-3">Governance Scorecard <span className="text-[10px] text-gray-400">measured dimensions</span></h2>
          <div className="space-y-2.5">
            {g.dims.map((d: any) => (
              <div key={d.label}>
                <div className="flex items-center justify-between text-xs mb-0.5"><span className="text-gray-600">{d.label}</span><span className={`tabular-nums ${d.value == null ? "text-gray-300" : "text-gray-700"}`}>{d.value == null ? "n/a" : `${d.value}%`}</span></div>
                <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">{d.value != null && <div className={`h-full rounded-full ${d.value >= 80 ? "bg-green-500" : d.value >= 50 ? "bg-amber-500" : "bg-rose-500"}`} style={{ width: `${d.value}%` }} />}</div>
              </div>
            ))}
          </div>
          <p className="text-[10px] text-gray-400 mt-3">Governance Score = mean of the measured dimensions. Sourced from audits, CAPA, policies and findings — no fabricated composites.</p>
        </div>

        {/* Compliance by organisation */}
        <div className={`${card} p-5`}>
          <h2 className="font-semibold text-gray-900 text-[15px] mb-3">Compliance by Organisation</h2>
          <div className="grid grid-cols-2 gap-2 mb-3">
            {[["Compliant (≥90%)", g.orgCompliance.compliant, "text-green-600"], ["Partial (70–89%)", g.orgCompliance.partial, "text-amber-600"], ["Non-compliant", g.orgCompliance.non, "text-rose-600"], ["Not assessed", g.orgCompliance.notAssessed, "text-gray-400"]].map(([l, n, tone]: any) => (
              <div key={l} className="rounded-lg border border-gray-100 p-2.5 text-center"><p className={`text-xl font-bold tabular-nums ${tone}`}>{fmt(n)}</p><p className="text-[9px] text-gray-500 leading-tight">{l}</p></div>
            ))}
          </div>
          {g.perOrg.length > 0 && (
            <div className="space-y-1 pt-2 border-t border-gray-50">
              {g.perOrg.map((o: any) => (
                <div key={o.id} className="flex items-center justify-between text-xs"><span className="text-gray-600 truncate">{o.name}</span><span className={`tabular-nums shrink-0 ml-2 ${scoreTone(o.avg)}`}>{o.avg}% · {o.audits} audit{o.audits === 1 ? "" : "s"}</span></div>
              ))}
            </div>
          )}
          <p className="text-[10px] text-gray-400 mt-2">Facility average of audit compliance_pct.</p>
        </div>

        {/* Risk indicators */}
        <div className={`${card} p-5`}>
          <h2 className="font-semibold text-gray-900 text-[15px] mb-3">Risk Indicators <span className="text-[10px] text-gray-400">derived · no risk register yet</span></h2>
          <div className="grid grid-cols-2 gap-2 mb-3">
            {[["High-priority CAPA", g.riskIndicators.openHighCapa, "text-rose-600"], ["Overdue CAPA", g.riskIndicators.overdueCapa, "text-amber-600"], ["Safety alerts", g.riskIndicators.safetyAlerts, "text-rose-600"], ["Open escalations", g.riskIndicators.escalations, "text-orange-600"]].map(([l, n, tone]: any) => (
              <div key={l} className="rounded-lg border border-gray-100 p-2.5 text-center"><p className={`text-xl font-bold tabular-nums ${(n ?? 0) > 0 ? tone : "text-gray-900"}`}>{dash(n)}</p><p className="text-[9px] text-gray-500 leading-tight">{l}</p></div>
            ))}
          </div>
          {g.highRiskOrgs.length > 0 && (
            <div className="space-y-1 pt-2 border-t border-gray-50">
              <p className="text-[10px] font-semibold text-gray-400 uppercase">High-risk organisations</p>
              {g.highRiskOrgs.map((o: any) => (
                <div key={o.id} className="flex items-center justify-between text-xs"><span className="text-gray-600 truncate">{o.name}</span><span className="tabular-nums text-rose-600 shrink-0 ml-2">{o.highCapa} high CAPA{o.avg != null ? ` · ${o.avg}%` : ""}</span></div>
              ))}
            </div>
          )}
          <p className="text-[10px] text-gray-400 mt-2">A full 5×5 risk register with controls lands in module 4.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Approval queue */}
        <div className={`${card} p-5`}>
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-gray-900 text-[15px]">Approval Queue <span className="text-[10px] text-gray-400">{dash(g.pendingApprovals)} pending</span></h2>
            <Link href="/super-admin/platform-ops/approvals" className="text-xs text-teal-700 hover:underline">Decide →</Link>
          </div>
          {g.queue.length === 0 ? <p className="text-sm text-gray-400 py-6 text-center">Queue is clear.</p> : (
            <div className="divide-y divide-gray-50">
              {g.queue.map((q: any, i: number) => (
                <div key={i} className="py-2">
                  <p className="text-sm text-gray-800 leading-tight truncate">{q.title}</p>
                  <p className="text-[10px] text-gray-400 capitalize">{q.sub}{q.by ? ` · ${q.by}` : ""} · {relTime(q.at)}</p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Recent audit findings */}
        <div className={`${card} p-5`}>
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-gray-900 text-[15px]">Recent Audit Findings</h2>
            <span className="text-[10px] text-gray-400">not-met items</span>
          </div>
          {g.recentFindings.length === 0 ? <p className="text-sm text-gray-400 py-6 text-center">No unmet findings recorded.</p> : (
            <div className="divide-y divide-gray-50">
              {g.recentFindings.map((f: any, i: number) => (
                <div key={i} className="flex items-start gap-2 py-2">
                  <span className={`w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${f.is_critical ? "bg-rose-500" : "bg-amber-400"}`} />
                  <div className="min-w-0 flex-1"><p className="text-xs text-gray-800 leading-tight">{f.item_text}</p><p className="text-[10px] text-gray-400">{f.is_critical ? "critical · " : ""}{relTime(f.created_at)}</p></div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* CAPA progress */}
        <div className={`${card} p-5`}>
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-gray-900 text-[15px]">CAPA Progress <span className="text-[10px] text-gray-400">{fmt(g.capaTotal)} total</span></h2>
          </div>
          {g.capaTotal === 0 ? <p className="text-sm text-gray-400 py-6 text-center">No corrective actions yet.</p> : (
            <div className="space-y-2">
              {["open", "in_progress", "completed", "verified", "closed"].map(status => [status, g.capaProgress[status] ?? 0] as const).filter(([, n]) => n > 0).map(([status, n]) => (
                <div key={status}>
                  <div className="flex items-center justify-between text-xs mb-0.5"><span className={`capitalize ${CAPA_TONE[status] ?? "text-gray-600"}`}>{status.replace(/_/g, " ")}</span><span className="tabular-nums text-gray-500">{n}</span></div>
                  <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden"><div className="h-full bg-teal-500 rounded-full" style={{ width: `${(n / g.capaTotal) * 100}%` }} /></div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Accreditation frameworks */}
        <div className={`${card} p-5`}>
          <h2 className="font-semibold text-gray-900 text-[15px] mb-3">Accreditation Frameworks</h2>
          {g.frameworks.length === 0 ? <p className="text-sm text-gray-400 py-6 text-center">No frameworks configured.</p> : (
            <div className="space-y-2">
              {g.frameworks.map((f: any) => (
                <div key={f.code} className="flex items-center gap-2.5 rounded-lg border border-gray-100 p-2.5">
                  <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded shrink-0 ${f.type === "accreditation" ? "bg-violet-50 text-violet-700" : f.type === "regulatory" ? "bg-blue-50 text-blue-700" : "bg-gray-100 text-gray-600"}`}>{f.code}</span>
                  <span className="text-sm text-gray-800 flex-1 truncate">{f.name}</span>
                  <span className="text-[10px] text-gray-400 tabular-nums shrink-0">{f.standards} mapped</span>
                </div>
              ))}
            </div>
          )}
          <p className="text-[10px] text-gray-400 mt-3">EQOS quality frameworks with mapped standards; per-standard readiness scoring lands in module 6.</p>
        </div>

        {/* Recent audits */}
        <div className={`${card} p-5`}>
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-gray-900 text-[15px]">Recent Audits</h2>
            <span className="text-[10px] text-gray-400">planning lands in module 5</span>
          </div>
          {g.recentAudits.length === 0 ? <p className="text-sm text-gray-400 py-6 text-center">No audits recorded yet.</p> : (
            <div className="divide-y divide-gray-50">
              {g.recentAudits.map((a: any, i: number) => (
                <div key={i} className="flex items-center gap-2 py-2">
                  <div className="min-w-0 flex-1"><p className="text-sm text-gray-800 leading-tight truncate">{a.title}</p><p className="text-[10px] text-gray-400 capitalize">{a.type}{a.org ? ` · ${a.org}` : ""} · {relTime(a.at)}</p></div>
                  <span className={`text-sm font-bold tabular-nums shrink-0 ${scoreTone(a.pct == null ? null : Math.round(a.pct))}`}>{a.pct == null ? "—" : `${Math.round(a.pct)}%`}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Governance activity + structure */}
        <div className={`${card} p-5`}>
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-gray-900 text-[15px]">Governance Activity</h2>
            <Link href="/super-admin/audit" className="text-xs text-teal-700 hover:underline">Full trail →</Link>
          </div>
          <p className="text-[11px] text-gray-500 mb-2">{dash(g.committees.count)} committees · {dash(g.committees.members)} members · {fmt(g.policyStats.total)} active policies{g.policyStats.overdue ? ` · ${g.policyStats.overdue} overdue review` : ""}</p>
          {g.activity.length === 0 ? <p className="text-sm text-gray-400 py-4 text-center">No governance actions recorded.</p> : (
            <div className="divide-y divide-gray-50">
              {g.activity.slice(0, 6).map((a: any, i: number) => (
                <div key={i} className="py-1.5">
                  <p className="text-xs text-gray-700 truncate">{a.entity_name || (a.action ?? "").replace(/_/g, " ")}</p>
                  <p className="text-[10px] text-gray-400">{(a.action ?? "").replace(/_/g, " ")}{a.actor_name ? ` · ${a.actor_name}` : ""} · {relTime(a.created_at)}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Governance action centre */}
      <div className={`${card} p-5`}>
        <h2 className="font-semibold text-gray-900 text-[15px] mb-3">Governance Action Centre</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
          {actions.map(a => (
            <Link key={a.label} href={a.href} className="flex flex-col items-center gap-1 rounded-lg border border-gray-100 py-3 px-2 text-center hover:border-teal-300 hover:bg-teal-50/40 transition-colors">
              <span className="text-lg">{a.icon}</span><span className="text-[11px] font-semibold text-gray-700 leading-tight">{a.label}</span>
            </Link>
          ))}
        </div>
      </div>

      <p className="text-[11px] text-gray-400 pb-4">The Governance Dashboard is module 1 of the Governance &amp; Compliance platform. Every figure is live: the scorecard from audits/CAPA/policies/findings, organisation compliance from per-facility audit averages, risk indicators derived from high-priority CAPA, safety alerts and escalations (a dedicated 5×5 risk register lands in module 4), the approval queue from the platform engine, and accreditation frameworks from EQOS. Regulatory alerts show “—” until a regulatory feed is connected. Modules 2–6 (Policy &amp; Standards, Compliance, Risk &amp; Controls, Audit &amp; Assurance, Regulatory &amp; Accreditation) build out phase by phase.</p>
    </div>
  );
}
