import { loadAdmChange } from "@/lib/admin/admin-modules";
import { admGuard, Head, Tabs, Card, Kpi, Donut, Ring, Pill, HBar, Provision, Foot } from "../_ui";
import { STATUS_TONE, RISK_TONE } from "@/lib/admin/admin-suite";

export const dynamic = "force-dynamic";

// UMW-ADM-008 Audit, Versioning & Change Management Centre — change register, versions, impact, approvals and audit.
// Gate hospital_admin/super_admin.
/* eslint-disable @typescript-eslint/no-explicit-any */
const STATUS_COLORS: Record<string, string> = { draft: "#94a3b8", in_review: "#f59e0b", pending_approval: "#f59e0b", approved: "#3b82f6", published: "#22c55e", rolled_back: "#ef4444", cancelled: "#cbd5e1" };
const fmtT = (t: string | null) => { if (!t) return ""; try { return new Date(t).toLocaleDateString("en-GB", { day: "2-digit", month: "short" }); } catch { return ""; } };

export default async function ChangePage() {
  const { admin, isSuper, hid } = await admGuard();
  const d = await loadAdmChange(admin, hid, isSuper) as any;
  const head = <Head code="UMW-ADM-008 · Administration & Configuration" title="Audit, Versioning & Change Management Centre" sub="Control, track and assure every configuration change in your unit — change register, versions, impact analysis, approvals and audit trail." />;
  if (!d.provisioned) return <div className="max-w-[1500px] space-y-4">{head}<Tabs active="008" /><Provision module="Change Management" part="part 2" /></div>;

  const k = d.kpis;
  return (
    <div className="max-w-[1500px] space-y-4">
      {head}<Tabs active="008" />
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3">
        <div className="bg-white border border-gray-200 rounded-xl p-3.5 flex items-center gap-2"><Ring pct={k.auditHealth} size={56} /><div><p className="text-[11px] text-gray-500 uppercase tracking-wide leading-tight">Audit Health</p><p className="text-[11px] text-emerald-600 font-medium">Good</p></div></div>
        <Kpi label="Configuration Changes" value={k.total} sub="this period" />
        <Kpi label="Pending Reviews" value={k.pendingReviews} sub="in workflow" tone={k.pendingReviews ? "text-amber-600" : undefined} />
        <Kpi label="Deployments" value={k.deployments} sub="published" tone="text-emerald-600" />
        <Kpi label="Rollbacks" value={k.rollbacks} sub="reverted" tone={k.rollbacks ? "text-rose-600" : undefined} />
        <Kpi label="High-Risk Changes" value={k.highRisk} sub="need scrutiny" tone={k.highRisk ? "text-rose-600" : undefined} />
        <Kpi label="Approval Compliance" value={`${k.approvalCompliance}%`} sub="approved/published" tone="text-emerald-600" />
        <Kpi label="Affected Users" value={d.impact.affectedUsers.toLocaleString()} sub={`${d.impact.highImpact} high impact`} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-4 gap-4">
        <Card title="Change Status Overview">
          <div className="flex items-center gap-3">
            <Donut segs={d.byStatus.map((s: any) => ({ n: s.n, color: STATUS_COLORS[s.status] }))} total={k.total} centre={k.total} sub="changes" size={100} />
            <div className="flex-1 space-y-0.5 text-[11px]">{d.byStatus.map((s: any) => <div key={s.status} className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ background: STATUS_COLORS[s.status] }} /><span className="text-gray-600 flex-1 truncate">{s.label}</span><span className="font-semibold text-gray-900">{s.n}</span></div>)}</div>
          </div>
        </Card>

        <Card title="Recent Changes" className="xl:col-span-2">
          <div className="space-y-1">
            <div className="flex items-center text-[10px] text-gray-400 uppercase tracking-wide px-1"><span className="w-20">ID</span><span className="flex-1">Title</span><span className="w-20">Type</span><span className="w-20">Author</span><span className="w-14 text-center">Risk</span><span className="w-24 text-right">Status</span></div>
            {d.recent.map((c: any) => (
              <div key={c.id} className="flex items-center px-1 py-1 text-[12px]"><span className="w-20 text-gray-400 font-mono text-[10px] truncate">{c.change_code}</span><span className="flex-1 text-gray-800 truncate">{c.title}</span><span className="w-20 text-gray-500 text-[11px] capitalize">{c.change_type}</span><span className="w-20 text-gray-500 text-[11px] truncate">{c.authorName}</span><span className="w-14 text-center"><Pill text={c.risk} tone={RISK_TONE[c.risk]} /></span><span className="w-24 text-right"><Pill text={c.status} tone={STATUS_TONE[c.status]} /></span></div>
            ))}
          </div>
        </Card>

        <Card title="Change by Type">
          <div className="space-y-2">{d.byType.slice(0, 7).map((t: any) => <HBar key={t.type} label={t.type} value={t.n} max={Math.max(...d.byType.map((x: any) => x.n))} right={`${t.n}`} />)}</div>
        </Card>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card title="Pending Approvals" className="xl:col-span-2" right={<span className="text-[11px] text-gray-400">{d.pending.length}</span>}>
          {d.pending.length ? <div className="space-y-1">
            <div className="flex items-center text-[10px] text-gray-400 uppercase tracking-wide px-1"><span className="flex-1">Change</span><span className="w-24">Requested By</span><span className="w-20">Approver</span><span className="w-14 text-center">Risk</span><span className="w-16 text-right">Date</span></div>
            {d.pending.map((c: any) => (
              <div key={c.id} className="flex items-center px-1 py-1 text-[12px] border border-gray-100 rounded-lg"><span className="flex-1 text-gray-800 truncate">{c.title}</span><span className="w-24 text-gray-500 text-[11px] truncate">{c.authorName}</span><span className="w-20 text-gray-500 text-[11px] truncate">{c.approver}</span><span className="w-14 text-center"><Pill text={c.risk} tone={RISK_TONE[c.risk]} /></span><span className="w-16 text-right text-gray-400 text-[11px]">{fmtT(c.created_at)}</span></div>
            ))}
          </div> : <p className="text-sm text-gray-400 py-6 text-center">No pending approvals. ✅</p>}
        </Card>

        <Card title="Change Impact">
          <div className="grid grid-cols-2 gap-2 text-center">
            <div className="rounded-lg bg-gray-50 p-3"><p className="text-2xl font-bold text-gray-900 tabular-nums">{d.impact.affectedUsers.toLocaleString()}</p><p className="text-[10px] text-gray-500">Potentially affected users</p></div>
            <div className="rounded-lg bg-rose-50 p-3"><p className="text-2xl font-bold text-rose-700 tabular-nums">{k.highRisk}</p><p className="text-[10px] text-gray-500">High-risk changes</p></div>
          </div>
          <p className="text-[10px] text-gray-400 mt-2">Impact scoring, dependency graphs and release scheduling are the next phase.</p>
        </Card>
      </div>

      <Foot>UMW-ADM-008 — change &amp; audit over adm_changes (change register with author / approver / risk / version / affected-users). Status mix, recent register, pending approvals and impact totals are real; dependency-graph impact analysis, release pipeline and AI change-risk scoring are the next phase.</Foot>
    </div>
  );
}
