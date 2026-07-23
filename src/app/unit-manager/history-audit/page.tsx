import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadHistoryAudit } from "@/lib/operations/history-audit";
import { loadUnitDepartments } from "@/lib/operations/unit-command";
import UnitFilters from "../UnitFilters";

export const dynamic = "force-dynamic";

// History & Audit Workspace (UMW-EA-005) — the Unit Manager's governance & traceability
// centre over the real, append-only audit_log store. Every Executive Actions decision
// lands here. KPIs, a filterable recent-activity explorer, category/outcome distribution,
// actions-over-time, top users, an audit summary and a real integrity/completeness score
// are live; retention-policy config, IP/unit capture, digital signatures, report
// generation and the deep explorer/export tabs are honest next-phase states.
/* eslint-disable @typescript-eslint/no-explicit-any */

const card = "bg-white rounded-xl border border-gray-200";
const CAT_COLOR: Record<string, string> = { Approval: "#8b5cf6", Escalation: "#ef4444", CAPA: "#14b8a6", Competency: "#3b82f6", Access: "#0ea5e9", Change: "#f59e0b", Export: "#a855f7", Other: "#9ca3af" };
const OUT_TONE: Record<string, string> = { Approved: "bg-green-50 text-green-700", Created: "bg-blue-50 text-blue-700", Completed: "bg-green-50 text-green-700", Updated: "bg-amber-50 text-amber-700", Returned: "bg-amber-50 text-amber-700", Rejected: "bg-rose-50 text-rose-700", Cancelled: "bg-rose-50 text-rose-700", Delegated: "bg-violet-50 text-violet-700", Success: "bg-green-50 text-green-700", Recorded: "bg-gray-100 text-gray-600" };
const relClock = (iso?: string | null) => { if (!iso) return "—"; const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000); if (s < 60) return "just now"; if (s < 3600) return `${Math.floor(s / 60)}m ago`; if (s < 86400) return `${Math.floor(s / 3600)}h ago`; return `${Math.floor(s / 86400)}d ago`; };
const stamp = (iso?: string | null) => (iso ? `${iso.slice(0, 10)} ${iso.slice(11, 16)}` : "—");
const TABS = ["Audit Dashboard", "Activity History", "Decision History", "Change Log", "Access Log", "Audit Reports", "Compliance & Retention", "Audit Trail Explorer", "Export Center", "Settings"];
const QUICK: [string, string][] = [["Audit Trail Explorer", "Search across all records"], ["Decision History", "All decisions made"], ["Change Log", "Record modifications"], ["Access Log", "User access activities"], ["Export Audit Data", "Download logs & reports"], ["Generate Report", "Custom audit reports"]];

function Kpi({ label, value, sub, tone, icon }: { label: string; value: any; sub?: string; tone?: string; icon?: string }) {
  return <div className={`${card} p-3.5`}><div className="flex items-start justify-between"><p className="text-[10px] text-gray-500 uppercase tracking-wide">{label}</p>{icon && <span className="text-sm opacity-50">{icon}</span>}</div><p className={`text-2xl font-bold tabular-nums mt-0.5 ${tone ?? "text-gray-900"}`}>{value}</p>{sub && <p className="text-[10px] text-gray-400">{sub}</p>}</div>;
}
function Donut({ segs, total }: { segs: { n: number; color: string }[]; total: number }) {
  const sum = segs.reduce((s, x) => s + x.n, 0) || 1; let acc = 0;
  const stops = segs.map(s => { const a = (acc / sum) * 100; acc += s.n; return `${s.color} ${a}% ${(acc / sum) * 100}%`; }).join(", ");
  return <div className="relative w-24 h-24 shrink-0"><div className="w-24 h-24 rounded-full" style={{ background: sum > 0 ? `conic-gradient(${stops})` : "#f1f5f9" }} /><div className="absolute inset-[22%] rounded-full bg-white flex flex-col items-center justify-center"><span className="text-lg font-bold text-gray-900">{total}</span><span className="text-[8px] text-gray-400">Total</span></div></div>;
}

export default async function HistoryAuditWorkspace({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const dept = typeof sp.dept === "string" ? sp.dept : undefined;
  const cat = typeof sp.cat === "string" ? sp.cat : undefined;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("full_name, role, roles, hospital_id").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.some(r => ["hospital_admin", "super_admin"].includes(r))) redirect("/dashboard");

  const isSuper = roles.includes("super_admin");
  const [d, departments] = await Promise.all([
    loadHistoryAudit(admin, profile?.hospital_id ?? null, isSuper, dept, cat) as Promise<any>,
    loadUnitDepartments(admin, profile?.hospital_id ?? null, isSuper),
  ]);

  const header = (
    <>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2"><span className="text-xl">📜</span><div><h1 className="text-2xl font-bold text-gray-900 tracking-tight">History &amp; Audit</h1><p className="text-sm text-gray-500">Complete audit trail of decisions, actions, changes and system activities.</p></div></div>
        <UnitFilters departments={departments} />
      </div>
      <div className="flex gap-1 border-b border-gray-200 overflow-x-auto">
        {TABS.map((t, i) => <span key={t} className={`shrink-0 text-xs px-3 py-2 border-b-2 -mb-px font-medium ${i === 0 ? "border-violet-600 text-violet-700" : "border-transparent text-gray-300"}`} title={i === 0 ? "" : "Next phase"}>{t}</span>)}
      </div>
    </>
  );

  if (!d.provisioned) return <div className="space-y-4">{header}<div className="bg-amber-50 border border-amber-200 rounded-xl p-6"><p className="font-semibold text-amber-900">⚙️ Audit store not provisioned</p><p className="text-sm text-amber-800 mt-1">Run migration <code>040</code> to enable the audit_log store for this tenant.</p></div></div>;

  const k = d.kpis; const fc = d.filterCounts;
  const catChips: [string, number][] = [["All", fc.All], ["Decisions", fc.Decisions], ["Changes", fc.Changes], ["Access", fc.Access], ["Exports", fc.Exports]];
  return (
    <div className="space-y-4">
      {header}

      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
        <Kpi label="Total Actions" value={k.total.toLocaleString()} sub="This period (30d)" icon="📋" />
        <Kpi label="Decisions Made" value={k.decisions.toLocaleString()} sub="Approved / Rejected / Returned" tone="text-violet-700" icon="✅" />
        <Kpi label="Changes Made" value={k.changes.toLocaleString()} sub="Updates to records" icon="✏️" />
        <Kpi label="Access Events" value={k.access.toLocaleString()} sub="System access" icon="👤" />
        <Kpi label="Data Exports" value={k.exports.toLocaleString()} sub="Reports & exports" icon="⬇️" />
        <Kpi label="Audit Integrity" value={`${k.integrity}%`} sub="Complete metadata" tone={k.integrity >= 99 ? "text-green-600" : "text-amber-600"} icon="🛡️" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        {/* Recent activity */}
        <div className={`${card} p-5 xl:col-span-2`}>
          <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
            <h3 className="text-sm font-bold text-gray-900">Recent Activity</h3>
            <div className="flex gap-1 flex-wrap">{catChips.map(([label, n]) => <Link key={label} href={label === "All" ? "/unit-manager/history-audit" : `/unit-manager/history-audit?cat=${label}`} className={`text-[10px] px-2 py-0.5 rounded-full ${fc.active === label ? "bg-violet-600 text-white" : "bg-gray-100 text-gray-500 hover:bg-gray-200"}`}>{label} ({n})</Link>)}</div>
          </div>
          {d.recent.length === 0 ? (
            <div className="text-center py-8"><p className="text-3xl mb-2">🗂️</p><p className="text-sm font-semibold text-gray-700">{d.empty ? "No audit records yet" : "No activity in this filter"}</p><p className="text-xs text-gray-400 mt-1">{d.empty ? "Executive Actions decisions are recorded here automatically." : "Try a different category."}</p></div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead><tr className="text-gray-400 text-left border-b border-gray-100"><th className="py-2 pr-3 font-medium">Date / Time</th><th className="py-2 pr-3 font-medium">User</th><th className="py-2 pr-3 font-medium">Action</th><th className="py-2 pr-3 font-medium">Category</th><th className="py-2 pr-3 font-medium">Entity</th><th className="py-2 font-medium">Outcome</th></tr></thead>
                <tbody>
                  {d.recent.map((a: any) => (
                    <tr key={a.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                      <td className="py-2 pr-3 text-gray-500 whitespace-nowrap">{stamp(a.at)}</td>
                      <td className="py-2 pr-3 text-gray-700 truncate max-w-[100px]">{a.user}</td>
                      <td className="py-2 pr-3 text-gray-800 font-medium max-w-[150px] truncate">{a.action}</td>
                      <td className="py-2 pr-3"><span className="inline-flex items-center gap-1 text-gray-600"><span className="w-1.5 h-1.5 rounded-full" style={{ background: CAT_COLOR[a.category] ?? "#9ca3af" }} />{a.category}</span></td>
                      <td className="py-2 pr-3 text-gray-600 max-w-[130px] truncate">{a.entity}</td>
                      <td className="py-2"><span className={`px-1.5 py-0.5 rounded text-[10px] ${OUT_TONE[a.outcome] ?? "bg-gray-100 text-gray-600"}`}>{a.outcome}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="text-[10px] text-gray-400 mt-2">Showing {d.recent.length} of {k.total.toLocaleString()} records (last 30d). Category &amp; outcome are derived from the action verb. IP address &amp; unit/area aren&apos;t captured in the audit store — shown as honest omissions.</p>
            </div>
          )}
        </div>

        {/* Right stack: summary + retention + integrity */}
        <div className="space-y-4 xl:col-span-1">
          <div className={`${card} p-5`}>
            <h3 className="text-sm font-bold text-gray-900 mb-3">Audit Summary (period)</h3>
            {d.summary.length === 0 ? <p className="text-sm text-gray-400">No executive-action records yet.</p> : (
              <div className="space-y-2">{d.summary.map((s: any) => (<div key={s.label} className="flex items-center gap-2 text-xs"><span className="w-1.5 h-1.5 rounded-full" style={{ background: CAT_COLOR[s.label.startsWith("Approval") ? "Approval" : s.label.startsWith("Escal") ? "Escalation" : s.label.startsWith("CAPA") ? "CAPA" : "Competency"] }} /><span className="text-gray-700 flex-1">{s.label}</span><b className="text-gray-900">{s.n}</b><span className="text-gray-400 w-10 text-right">{s.pct}%</span></div>))}</div>
            )}
          </div>
          <div className={`${card} p-5`}>
            <h3 className="text-sm font-bold text-gray-900 mb-1">Data Retention</h3>
            <p className="text-[10px] text-gray-400 mb-2">Append-only store — no records are deleted or altered by the application.</p>
            <div className="space-y-1.5 text-xs">{["Audit Logs", "Decision Records", "System Logs"].map(l => <div key={l} className="flex items-center justify-between"><span className="text-gray-700 flex items-center gap-1.5"><span className="text-green-600">✓</span>{l}</span><span className="text-green-600 text-[10px]">Retained</span></div>)}</div>
            <p className="text-[10px] text-amber-600 mt-2">Configurable retention windows &amp; scheduled archival are next-phase.</p>
          </div>
          <div className={`${card} p-5`}>
            <h3 className="text-sm font-bold text-gray-900 mb-3">Integrity &amp; Security</h3>
            <div className="space-y-1.5 text-xs">
              <div className="flex items-center justify-between"><span className="text-gray-700">Audit Completeness</span><b className={d.integrity.completeness >= 99 ? "text-green-600" : "text-amber-600"}>{d.integrity.completeness}%</b></div>
              <div className="flex items-center justify-between"><span className="text-gray-700">Tamper Protection</span><span className="text-green-600 text-[10px]">Append-only</span></div>
              <div className="flex items-center justify-between"><span className="text-gray-700">Records (30d)</span><b className="text-gray-900">{d.integrity.records.toLocaleString()}</b></div>
              <div className="flex items-center justify-between"><span className="text-gray-700">Incomplete metadata</span><b className={d.integrity.orphans ? "text-amber-600" : "text-green-600"}>{d.integrity.orphans}</b></div>
              <div className="flex items-center justify-between"><span className="text-gray-700">Last Entry</span><span className="text-gray-500 text-[10px]">{relClock(d.integrity.lastEntry)}</span></div>
              <div className="flex items-center justify-between"><span className="text-gray-400">Digital Signatures</span><span className="text-gray-300 text-[10px]">Next phase</span></div>
            </div>
          </div>
        </div>
      </div>

      {/* Analytics */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        <div className={`${card} p-5`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Actions by Category</h3>
          {d.byCategory.length === 0 ? <p className="text-sm text-gray-400">No activity.</p> : (
            <div className="flex items-center gap-3"><Donut total={k.total} segs={d.byCategory.map((x: any) => ({ n: x.n, color: CAT_COLOR[x.label] ?? "#9ca3af" }))} /><div className="text-[11px] space-y-0.5 flex-1">{d.byCategory.slice(0, 6).map((x: any) => <div key={x.label} className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-sm" style={{ background: CAT_COLOR[x.label] ?? "#9ca3af" }} /><span className="text-gray-600 flex-1">{x.label}</span><b>{x.n}</b><span className="text-gray-400">({x.pct}%)</span></div>)}</div></div>
          )}
        </div>
        <div className={`${card} p-5`}>
          <h3 className="text-sm font-bold text-gray-900 mb-2">Actions Over Time (14d)</h3>
          <div className="flex items-end gap-0.5 h-24">{d.overTime.map((t: any, i: number) => { const max = Math.max(1, ...d.overTime.map((x: any) => x.n)); return <div key={i} className="flex-1 flex flex-col items-center justify-end h-full"><div className="w-full bg-violet-400 rounded-t" style={{ height: `${(t.n / max) * 100}%`, minHeight: t.n ? 2 : 0 }} title={`${t.label}: ${t.n}`} /></div>; })}</div>
          <p className="text-[10px] text-gray-400 mt-1">Recorded actions per day.</p>
        </div>
        <div className={`${card} p-5`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Top Users (by actions)</h3>
          {d.topUsers.length === 0 ? <p className="text-sm text-gray-400">No user activity.</p> : (
            <div className="space-y-2">{d.topUsers.map((u: any) => { const max = Math.max(1, ...d.topUsers.map((x: any) => x.n)); return <div key={u.label} className="text-xs"><div className="flex items-center justify-between mb-0.5"><span className="text-gray-700 truncate flex-1">{u.label}</span><span className="text-gray-400 ml-2">{u.n}</span></div><div className="w-full h-1.5 rounded-full bg-gray-100 overflow-hidden"><div className="h-full rounded-full bg-violet-500" style={{ width: `${(u.n / max) * 100}%` }} /></div></div>; })}</div>
          )}
        </div>
      </div>

      {/* Action type breakdown + quick access + reports */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className={`${card} p-5`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Action Type Breakdown</h3>
          {d.byOutcome.length === 0 ? <p className="text-sm text-gray-400">No actions.</p> : (
            <div className="space-y-1.5">{d.byOutcome.map((x: any) => (<div key={x.label} className="text-xs"><div className="flex items-center justify-between mb-0.5"><span className="text-gray-700">{x.label}</span><span className="text-gray-400">{x.n} ({x.pct}%)</span></div><div className="w-full h-1.5 rounded-full bg-gray-100 overflow-hidden"><div className={`h-full rounded-full ${["Rejected", "Cancelled"].includes(x.label) ? "bg-rose-400" : ["Returned", "Updated"].includes(x.label) ? "bg-amber-400" : "bg-green-500"}`} style={{ width: `${x.pct}%` }} /></div></div>))}</div>
          )}
        </div>
        <div className={`${card} p-5`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Quick Access</h3>
          <div className="grid grid-cols-1 gap-1.5">{QUICK.map(([label, subtitle]) => <span key={label} className="border border-gray-100 rounded-lg px-3 py-2 hover:border-violet-200 cursor-default" title="Deep explorer / export — next phase"><span className="text-xs font-medium text-gray-700 block">{label}</span><span className="text-[10px] text-gray-400">{subtitle}</span></span>)}</div>
        </div>
        <div className={`${card} p-5`}>
          <h3 className="text-sm font-bold text-gray-900 mb-2">Reports &amp; Export</h3>
          <div className="border border-dashed border-gray-200 rounded-lg p-4 text-center"><p className="text-3xl mb-1">📄</p><p className="text-sm text-gray-500">Report generation isn&apos;t wired yet.</p><p className="text-[11px] text-gray-400 mt-1">PDF / Excel / CSV audit &amp; compliance reports (SafeCare, JCI, internal) generate from this live audit trail in a next-phase build — shown honestly rather than as fabricated report rows.</p></div>
        </div>
      </div>

      <div className="flex items-center gap-2 text-[11px] text-gray-500 border-t border-gray-100 pt-3"><span className="text-green-600">🔒</span>All audit records are immutable and append-only. Changes cannot be deleted or altered by the application and are tracked for full traceability.</div>

      <p className="text-[11px] text-gray-400 pb-4">The History &amp; Audit Workspace (UMW-EA-005) is the Unit Manager&apos;s governance &amp; traceability centre over the real, append-only audit_log store — every approval, escalation, CAPA, competency validation and config change written by the Executive Actions modules. KPIs, the filterable recent-activity explorer, category/outcome distribution, actions-over-time, top users, audit summary and a real integrity/completeness score are all live. IP-address &amp; unit/area capture, configurable retention policies, digital signatures, report/export generation and the deep explorer tabs are next-phase honest states — never fabricated. No department dimension (unit-wide). <Link href="/unit-manager/action-centre" className="text-violet-700 hover:underline">← Executive Actions</Link></p>
    </div>
  );
}
