import { loadAdmGovernance } from "@/lib/admin/admin-modules";
import { admGuard, Head, Tabs, Card, Kpi, Donut, Ring, Pill, Progress, Provision, Foot } from "../_ui";

export const dynamic = "force-dynamic";

// UMW-ADM-007 Permissions, Delegation & Governance Centre — roles, delegations, approvals, SoD and emergency access.
// Gate hospital_admin/super_admin.
/* eslint-disable @typescript-eslint/no-explicit-any */
const ROLE_COLORS = ["#3b82f6", "#22c55e", "#a855f7", "#f59e0b", "#ef4444", "#14b8a6", "#6366f1"];
const fmtD = (t: string | null) => { if (!t) return "—"; try { return new Date(t).toLocaleDateString("en-GB", { day: "2-digit", month: "short" }); } catch { return "—"; } };

export default async function GovernancePage() {
  const { admin, isSuper, hid } = await admGuard();
  const d = await loadAdmGovernance(admin, hid, isSuper) as any;
  const head = <Head code="UMW-ADM-007 · Administration & Configuration" title="Permissions, Delegation & Governance Centre" sub="Manage roles, permissions, delegations, approvals and governance for your unit — secure, auditable and metadata-driven." />;
  if (!d.provisioned) return <div className="max-w-[1500px] space-y-4">{head}<Tabs active="007" /><Provision module="Governance" part="part 2" /></div>;

  const k = d.kpis;
  return (
    <div className="max-w-[1500px] space-y-4">
      {head}<Tabs active="007" />
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3">
        <div className="bg-white border border-gray-200 rounded-xl p-3.5 flex items-center gap-2"><Ring pct={k.governanceScore} size={56} /><div><p className="text-[11px] text-gray-500 uppercase tracking-wide leading-tight">Governance</p><p className="text-[11px] text-emerald-600 font-medium">Score</p></div></div>
        <Kpi label="Active Roles" value={k.roles} sub="in unit" />
        <Kpi label="Active Delegations" value={k.activeDelegations} sub="in effect" />
        <Kpi label="Pending Approvals" value={k.pendingApprovals} sub="in queue" tone={k.pendingApprovals ? "text-amber-600" : undefined} />
        <Kpi label="SoD Compliance" value={`${k.sodCompliance}%`} sub="compliant" tone="text-emerald-600" />
        <Kpi label="Emergency Access" value={k.emergencyAccess} sub="break-glass" tone={k.emergencyAccess ? "text-amber-600" : undefined} />
        <Kpi label="Total Users" value={k.users} sub="in unit" />
        <Kpi label="Governance Score" value={`${k.governanceScore}/100`} sub="composite" tone="text-emerald-600" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-4 gap-4">
        <Card title="Role Distribution">
          <div className="flex items-center gap-3">
            <Donut segs={d.roleDist.map((r: any, i: number) => ({ n: r.n, color: ROLE_COLORS[i % ROLE_COLORS.length] }))} total={k.users} centre={k.users} sub="users" size={100} />
            <div className="flex-1 space-y-0.5 text-[11px]">{d.roleDist.slice(0, 6).map((r: any, i: number) => <div key={r.role} className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ background: ROLE_COLORS[i % ROLE_COLORS.length] }} /><span className="text-gray-600 flex-1 capitalize truncate">{r.role}</span><span className="font-semibold text-gray-900">{r.n}</span></div>)}</div>
          </div>
        </Card>

        <Card title="Delegations" className="xl:col-span-2" right={<span className="text-[11px] text-gray-400">{d.delegations.length}</span>}>
          <div className="space-y-1">
            <div className="flex items-center text-[10px] text-gray-400 uppercase tracking-wide px-1"><span className="flex-1">Position</span><span className="w-24">Delegate</span><span className="w-24">By</span><span className="w-20 text-right">Until</span><span className="w-20 text-right">Status</span></div>
            {d.delegations.map((x: any) => (
              <div key={x.id} className="flex items-center px-1 py-1 text-[12px]"><span className="flex-1 text-gray-800 truncate">{x.position}</span><span className="w-24 text-gray-600 text-[11px] truncate">{x.delegateName}</span><span className="w-24 text-gray-500 text-[11px] truncate">{x.byName}</span><span className="w-20 text-right text-gray-500 text-[11px]">{fmtD(x.valid_to)}</span><span className="w-20 text-right"><Pill text={x.status} tone={x.status === "active" ? "emerald" : x.status === "scheduled" ? "blue" : "slate"} /></span></div>
            ))}
          </div>
        </Card>

        <Card title="Approval Requests" right={<span className="text-[11px] text-gray-400">{d.approvals.length}</span>}>
          {d.approvals.length ? <div className="space-y-2">{d.approvals.map((a: any, i: number) => (
            <div key={i} className="flex items-start justify-between gap-2"><div className="min-w-0"><p className="text-[12px] text-gray-800 leading-tight truncate">{a.title}</p><p className="text-[10px] text-gray-400">{a.by} → {a.approver}</p></div><Pill text={a.priority} tone={a.priority === "High" ? "rose" : a.priority === "Medium" ? "amber" : "slate"} /></div>
          ))}</div> : <p className="text-sm text-gray-400 py-4 text-center">No pending approvals. ✅</p>}
        </Card>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <Card title="Governance Policies Compliance">
          <div className="space-y-2.5">{d.policies.map((p: any) => (
            <div key={p.name}><div className="flex items-center justify-between text-[12px] mb-0.5"><span className="text-gray-700">{p.name}</span><span className="font-semibold text-gray-900">{p.compliance}%</span></div><Progress pct={p.compliance} /></div>
          ))}</div>
        </Card>

        <Card title="Temporary & Emergency Access">
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg bg-amber-50 border border-amber-100 p-3 text-center"><p className="text-2xl font-bold text-amber-700 tabular-nums">{d.delegations.filter((x: any) => x.status === "active" || x.status === "scheduled").length}</p><p className="text-[10px] text-gray-500 mt-0.5">Temporary Access Grants</p></div>
            <div className="rounded-lg bg-rose-50 border border-rose-100 p-3 text-center"><p className="text-2xl font-bold text-rose-700 tabular-nums">{k.emergencyAccess}</p><p className="text-[10px] text-gray-500 mt-0.5">Emergency (break-glass)</p></div>
          </div>
          <p className="text-[10px] text-gray-400 mt-2">Emergency access reads the platform break_glass_grant store; permission inheritance follows Platform → … → Role → Delegation → Emergency Override.</p>
        </Card>
      </div>

      <Foot>UMW-ADM-007 — governance over adm_delegations + live profiles roles + break_glass_grant (emergency access). Role distribution, delegations, approvals (from the change queue) and emergency access are real; the SoD conflict matrix, approval-authority designer and governance-policy engine are the next phase.</Foot>
    </div>
  );
}
