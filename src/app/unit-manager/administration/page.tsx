import Link from "next/link";
import { loadAdmDashboard } from "@/lib/admin/admin-modules";
import { admGuard, Head, Tabs, Card, Kpi, Ring, Pill, Progress, Provision, Foot } from "./_ui";
import { STATUS_TONE } from "@/lib/admin/admin-suite";

export const dynamic = "force-dynamic";

// UMW-ADM-001 Unit Administration Dashboard — the administrative command cockpit consolidating configuration,
// governance, policies, assets, documentation, approvals and administrative health. Gate hospital_admin/super_admin.
/* eslint-disable @typescript-eslint/no-explicit-any */

export default async function AdminDashboardPage() {
  const { admin, isSuper, hid } = await admGuard();
  const d = await loadAdmDashboard(admin, hid, isSuper) as any;
  const head = <Head code="UMW-ADM-001 · Administration & Configuration" title="Unit Administration Dashboard" sub="Manage unit configuration, governance, resources, documents and administrative activities — your consolidated administrative cockpit." />;
  if (!d.provisioned) return <div className="max-w-[1500px] space-y-4">{head}<Tabs active="001" /><Provision module="the Administration Dashboard" /></div>;

  const k = d.kpis;
  return (
    <div className="max-w-[1500px] space-y-4">
      {head}<Tabs active="001" />
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3">
        <div className="bg-white border border-gray-200 rounded-xl p-3.5 flex items-center gap-2"><Ring pct={k.adminHealth} size={58} /><div><p className="text-[11px] text-gray-500 uppercase tracking-wide leading-tight">Admin Health</p><p className="text-[11px] text-[var(--cmp-text-success)] font-medium">{k.adminHealth >= 85 ? "Good" : "Watch"}</p></div></div>
        <Kpi label="Configuration Health" value={`${k.configHealth}%`} sub="config active" tone={k.configHealth >= 85 ? "text-[var(--cmp-text-success)]" : "text-[var(--cmp-text-warning)]"} />
        <Kpi label="Policy Compliance" value={`${k.policyCompliance}%`} sub="acknowledged" />
        <Kpi label="Asset Readiness" value={`${k.assetReadiness}%`} sub="in service" />
        <Kpi label="Documentation" value={`${k.docCompleteness}%`} sub="published" />
        <Kpi label="Pending Approvals" value={k.pendingApprovals} sub="in queue" tone={k.pendingApprovals ? "text-[var(--cmp-text-warning)]" : undefined} />
        <Kpi label="Audit Readiness" value={`${k.auditReadiness}%`} sub="ready" tone="text-[var(--cmp-text-success)]" />
        <Kpi label="AI Admin Score" value={`${k.aiScore}%`} sub="avg confidence" tone="text-[var(--cmp-text-information)]" />
      </div>

      {/* Profile + activity + tasks */}
      <div className="grid grid-cols-1 xl:grid-cols-4 gap-4">
        <Card title="Unit Profile">
          {d.profile ? (
            <div className="space-y-1.5 text-[12px]">
              {[["Unit", d.profile.unit_name], ["Code", d.profile.unit_code], ["Specialty", d.profile.specialty], ["Cost Centre", d.profile.cost_centre], ["Location", d.profile.location], ["Hours", d.profile.operational_hours], ["Config Version", d.profile.config_version]].map(([l, v]: any) => (
                <div key={l} className="flex items-center justify-between"><span className="text-gray-500">{l}</span><span className="text-gray-900 font-medium text-right truncate ml-2">{v ?? "—"}</span></div>
              ))}
              <Link href="/unit-manager/administration/structure" className="block text-center text-[11px] text-[var(--cmp-text-information)] hover:underline pt-1">Unit Structure →</Link>
            </div>
          ) : <p className="text-sm text-gray-400 py-4 text-center">No profile configured.</p>}
        </Card>

        <Card title="Administrative Activity Centre" className="xl:col-span-2">
          <div className="space-y-1">
            <div className="flex items-center text-[10px] text-gray-400 uppercase tracking-wide px-1"><span className="flex-1">Activity</span><span className="w-20">Type</span><span className="w-20">By</span><span className="w-24 text-right">Status</span></div>
            {d.activity.map((a: any, i: number) => (
              <div key={i} className="flex items-center px-1 py-1 text-[12px]"><span className="flex-1 text-gray-800 truncate">{a.item}</span><span className="w-20 text-gray-500 text-[11px]">{a.type}</span><span className="w-20 text-gray-500 text-[11px] truncate">{a.by}</span><span className="w-24 text-right"><Pill text={a.status} tone={STATUS_TONE[a.status]} /></span></div>
            ))}
          </div>
        </Card>

        <Card title="Tasks & Approvals" right={<span className="text-[11px] text-gray-400">{d.tasks.length}</span>}>
          {d.tasks.length ? <div className="space-y-2">{d.tasks.map((t: any, i: number) => (
            <div key={i} className="flex items-start justify-between gap-2"><div className="min-w-0"><p className="text-[12px] text-gray-800 leading-tight truncate">{t.title}</p><p className="text-[10px] text-gray-400">{t.type}</p></div><Pill text={t.priority} tone={t.priority === "High" ? "rose" : t.priority === "Medium" ? "amber" : "slate"} /></div>
          ))}</div> : <p className="text-sm text-gray-400 py-4 text-center">No pending tasks. ✅</p>}
        </Card>
      </div>

      {/* Modules launcher + config health + snapshots */}
      <Card title="Administration Modules">
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
          {d.modules.map((m: any) => (
            <Link key={m.name} href={m.href} className="border border-gray-200 rounded-lg p-3 hover:border-[var(--cmp-color-information)] hover:bg-[var(--cmp-surface-information)]/30 transition-colors">
              <div className="flex items-center gap-2 mb-1"><span className="w-8 h-8 rounded-lg bg-[var(--cmp-surface-information)] flex items-center justify-center text-base">{m.icon}</span><p className="text-[12px] font-semibold text-gray-900 leading-tight">{m.name}</p></div>
              <p className="text-[11px] text-gray-500">{m.stat}</p>
            </Link>
          ))}
        </div>
      </Card>

      <div className="grid grid-cols-1 xl:grid-cols-4 gap-4">
        <Card title="Configuration Health" className="xl:col-span-2">
          <div className="space-y-2.5">{d.configHealthBreakdown.map((h: any) => (
            <div key={h.label}><div className="flex items-center justify-between text-[12px] mb-0.5"><span className="text-gray-600">{h.label}</span><span className="font-semibold text-gray-900">{h.pct}%</span></div><Progress pct={h.pct} /></div>
          ))}</div>
        </Card>

        <Card title="Documents & Policies Snapshot">
          <div className="grid grid-cols-2 gap-2 text-center mb-2">
            {[["Active", d.docsSnapshot.active, "text-[var(--cmp-text-success)]"], ["Draft", d.docsSnapshot.draft, "text-gray-600"], ["Under Review", d.docsSnapshot.review, "text-[var(--cmp-text-warning)]"], ["Expiring 30d", d.docsSnapshot.expiring, "text-[var(--cmp-text-error)]"]].map(([l, v, c]: any) => (
              <div key={l} className="rounded-lg bg-gray-50 p-2"><p className={`text-xl font-bold tabular-nums ${c}`}>{v}</p><p className="text-[10px] text-gray-500">{l}</p></div>
            ))}
          </div>
          <Link href="/unit-manager/administration/documents" className="block text-center text-[11px] text-[var(--cmp-text-information)] hover:underline">Policies & Documents →</Link>
        </Card>

        <Card title="AI Administration Assistant" right={<Link href="/unit-manager/administration/ai-assistant" className="text-[11px] text-[var(--cmp-text-information)] hover:underline">All →</Link>}>
          <div className="space-y-2">{d.aiRecs.map((r: any, i: number) => (
            <div key={i} className="flex items-start gap-2"><span className="text-blue-500 mt-0.5 text-xs">{r.impact === "high" ? "🔴" : r.impact === "medium" ? "🟠" : "🔵"}</span><div className="min-w-0"><p className="text-[11px] text-gray-800 leading-tight">{r.title}</p><p className="text-[10px] text-gray-400">{r.confidence}% confidence</p></div></div>
          ))}</div>
        </Card>
      </div>

      <Foot>UMW-ADM-001 — administrative cockpit over the adm_* stores (documents / assets / config / changes / forms / delegations / AI) + reused structure (op_beds / departments). Health scores are composites from your unit&apos;s real counts; the no-code dashboard/widget authoring is the next phase.</Foot>
    </div>
  );
}
