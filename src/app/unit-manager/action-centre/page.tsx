import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadExecutiveActionCentre, loadExecActionModules, loadUnitDepartments } from "@/lib/operations/unit-command";
import UnitCommandTabs from "../UnitCommandTabs";
import UnitFilters from "../UnitFilters";

export const dynamic = "force-dynamic";

// Executive Actions Centre (UMW-005) — the Unit Manager's unified decision & approval
// queue. Escalations, incidents, CAPA/improvement actions and competency validations
// from the real operational/quality/competency stores, AI-prioritised (critical
// clinical first, overdue pinned), with distribution/status analytics, recommended
// actions, upcoming deadlines and a completed-this-period count. Approvals/staffing/
// policy/budget/exec-message channels have no store yet (honest); inline one-click
// approve + audit is a next-phase wiring — each item drills down to its source today.
/* eslint-disable @typescript-eslint/no-explicit-any */

const card = "bg-white rounded-xl border border-gray-200";
const PRI: Record<string, string> = { High: "bg-rose-50 text-rose-700", Medium: "bg-amber-50 text-amber-700", Low: "bg-gray-100 text-gray-500" };
const STATE: Record<string, string> = { Open: "bg-rose-50 text-rose-700", Pending: "bg-amber-50 text-amber-700", "In Progress": "bg-blue-50 text-blue-700" };
const TYPE_COLOR: Record<string, string> = { Escalation: "#ef4444", Approval: "#8b5cf6", Improvement: "#14b8a6", Incident: "#f59e0b", Competency: "#3b82f6" };
const TYPE_ICON: Record<string, string> = { Escalation: "⚠", Approval: "✅", Improvement: "📈", Incident: "🚩", Competency: "🎓" };
const HREF: Record<string, string> = { Escalation: "/supervisor/quality-safety", Incident: "/supervisor/quality-safety", Improvement: "/supervisor/quality-safety", Competency: "/unit-manager/competency", Approval: "/supervisor/task-center" };
const relTime = (iso?: string | null) => { if (!iso) return "—"; const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000); if (s < 3600) return `${Math.max(1, Math.floor(s / 60))}m ago`; if (s < 86400) return `${Math.floor(s / 3600)}h ago`; return `${Math.floor(s / 86400)}d ago`; };
const TABS = ["Action Centre", "Approvals", "Escalations", "CAPA & Improvement", "Competency Validations", "History & Audit"];
const QUICK = [["Create Action", null], ["Log Escalation", "/supervisor/quality-safety"], ["Request Approval", "/supervisor/task-center"], ["Broadcast Message", "/supervisor/communication"], ["Assign Task", "/supervisor/task-center"], ["View Reports", "/unit-manager/shift-intelligence"], ["Add Note", null], ["Export Actions", null], ["Settings", "/unit-manager/settings"]];

function Tile({ n, label, sub, tone, icon }: { n: any; label: string; sub?: string; tone?: string; icon?: string }) {
  return <div className={`${card} p-3.5`}><div className="flex items-start justify-between"><p className="text-[10px] text-gray-500 uppercase tracking-wide">{label}</p>{icon && <span className="text-sm opacity-60">{icon}</span>}</div><p className={`text-2xl font-bold tabular-nums mt-0.5 ${tone ?? "text-gray-900"}`}>{n}</p>{sub && <p className="text-[10px] text-gray-400">{sub}</p>}</div>;
}

function Donut({ segments, total }: { segments: { n: number; color: string }[]; total: number }) {
  const sum = segments.reduce((s, x) => s + x.n, 0) || 1; let acc = 0;
  const stops = segments.map(s => { const a = (acc / sum) * 100; acc += s.n; return `${s.color} ${a}% ${(acc / sum) * 100}%`; }).join(", ");
  return <div className="relative w-28 h-28 shrink-0"><div className="w-28 h-28 rounded-full" style={{ background: sum > 0 ? `conic-gradient(${stops})` : "#f1f5f9" }} /><div className="absolute inset-[24%] rounded-full bg-white flex flex-col items-center justify-center"><span className="text-xl font-bold text-gray-900">{total}</span><span className="text-[9px] text-gray-400">Total</span></div></div>;
}

function ModulePanel({ icon, title, color, stats, breakdown, href, linkLabel, provisioned, note }: { icon: string; title: string; color: string; stats: [string, any, string?][]; breakdown: any[]; href: string; linkLabel: string; provisioned: boolean; note?: string }) {
  return (
    <div className={`${card} p-4 flex flex-col`}>
      <div className="flex items-center gap-1.5 mb-2"><span className="text-sm">{icon}</span><h3 className="text-[10px] font-bold uppercase tracking-wide" style={{ color }}>{title}</h3></div>
      <div className="flex gap-3 mb-2">
        {stats.map(([l, v, tone]) => <div key={l}><p className={`text-lg font-bold tabular-nums ${tone ?? "text-gray-900"}`}>{provisioned ? v : "—"}</p><p className="text-[9px] text-gray-400 leading-tight">{l}</p></div>)}
      </div>
      <div className="space-y-0.5 mb-2 flex-1">
        {breakdown.slice(0, 5).map((b: any, i: number) => <div key={i} className="flex items-center justify-between text-[11px]"><span className="text-gray-500 truncate">{b.label}</span><b className={b.n == null ? "text-gray-300" : "text-gray-700"}>{b.n == null ? "—" : b.n}</b></div>)}
      </div>
      {note && <p className="text-[9px] text-gray-400 mb-1">{note}</p>}
      <Link href={href} className="text-[10px] font-semibold mt-auto" style={{ color }}>{linkLabel} →</Link>
    </div>
  );
}

export default async function ExecutiveActionsCentre({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const dept = typeof sp.dept === "string" ? sp.dept : undefined;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("full_name, role, roles, hospital_id").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.some(r => ["hospital_admin", "super_admin"].includes(r))) redirect("/dashboard");

  const isSuper = roles.includes("super_admin");
  const [d, mods, departments] = await Promise.all([
    loadExecutiveActionCentre(admin, profile?.hospital_id ?? null, isSuper, dept) as Promise<any>,
    loadExecActionModules(admin, profile?.hospital_id ?? null, isSuper) as Promise<any>,
    loadUnitDepartments(admin, profile?.hospital_id ?? null, isSuper),
  ]);
  const c = d.counts;
  const statusRows: [string, number, string][] = [["Open", d.byStatus.Open, "#ef4444"], ["Pending", d.byStatus.Pending, "#f59e0b"], ["In Progress", d.byStatus["In Progress"], "#3b82f6"], ["On Hold", d.byStatus["On Hold"], "#9ca3af"], ["Completed", d.byStatus.Completed, "#22c55e"]];
  const maxStatus = Math.max(1, ...statusRows.map(r => r[1]));

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div><h1 className="text-2xl font-bold text-gray-900 tracking-tight">Executive Actions</h1><p className="text-sm text-gray-500">Manage approvals, escalations and actions that require your decision.</p></div>
        <UnitFilters departments={departments} />
      </div>
      <UnitCommandTabs />

      {/* Sub-tabs */}
      <div className="flex gap-1 border-b border-gray-200 overflow-x-auto">
        {TABS.map((t, i) => <span key={t} className={`shrink-0 text-xs px-3 py-2 border-b-2 -mb-px font-medium ${i === 0 ? "border-teal-600 text-teal-700" : "border-transparent text-gray-300"}`} title={i === 0 ? "" : "Next phase"}>{t}</span>)}
      </div>

      {/* KPI header */}
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
        <Tile n={c.total} label="Total Action Items" sub="All open items" icon="📋" />
        <Tile n={c.high} label="High Priority" sub="Require attention" tone={c.high ? "text-rose-600" : "text-gray-900"} icon="⚠" />
        <Tile n={c.dueToday} label="Due Today" sub="Needs action" tone={c.dueToday ? "text-amber-600" : "text-gray-900"} icon="📅" />
        <Tile n={c.overdue} label="Overdue" sub="Past due" tone={c.overdue ? "text-rose-600" : "text-gray-900"} icon="⏰" />
        <Tile n={c.inProgress} label="In Progress" sub="Being worked on" tone="text-blue-600" icon="🔄" />
        <Tile n={c.completed} label="Completed" sub="This period (30d)" tone="text-green-600" icon="✅" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        {/* Work queue */}
        <div className={`${card} p-5 xl:col-span-2`}>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-bold text-gray-900">Management Work Queue</h3>
            <div className="flex gap-1">{["All", "High Priority", "Due Today", "Overdue"].map((f, i) => <span key={f} className={`text-[10px] px-2 py-0.5 rounded-full ${i === 0 ? "bg-teal-600 text-white" : "bg-gray-100 text-gray-500"}`}>{f}</span>)}</div>
          </div>
          {d.items.length === 0 ? <p className="text-sm text-gray-400">Nothing in the queue — no open escalations, incidents, improvement actions or pending validations.</p> : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead><tr className="text-gray-400 text-left border-b border-gray-100"><th className="py-2 pr-3 font-medium">Priority</th><th className="py-2 pr-3 font-medium">Type</th><th className="py-2 pr-3 font-medium">Item</th><th className="py-2 pr-3 font-medium">Details</th><th className="py-2 pr-3 font-medium">Requested By</th><th className="py-2 pr-3 font-medium">When</th><th className="py-2 pr-3 font-medium">Status</th><th className="py-2 font-medium">Action</th></tr></thead>
                <tbody>
                  {d.items.slice(0, 8).map((it: any) => (
                    <tr key={it.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                      <td className="py-2 pr-3"><span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${PRI[it.priority]}`}>{it.priority}</span></td>
                      <td className="py-2 pr-3 text-gray-600 whitespace-nowrap"><span className="mr-1">{TYPE_ICON[it.type]}</span>{it.type}</td>
                      <td className="py-2 pr-3 text-gray-800 font-medium max-w-[150px] truncate">{it.item}</td>
                      <td className="py-2 pr-3 text-gray-500 max-w-[160px] truncate">{it.details}</td>
                      <td className="py-2 pr-3 text-gray-600 whitespace-nowrap">{it.by}</td>
                      <td className={`py-2 pr-3 whitespace-nowrap ${it.due && it.due < new Date().toISOString().slice(0, 10) ? "text-rose-600" : "text-gray-400"}`}>{relTime(it.at)}</td>
                      <td className="py-2 pr-3"><span className={`px-1.5 py-0.5 rounded text-[10px] ${STATE[it.state] ?? "bg-gray-100 text-gray-500"}`}>{it.state}</span></td>
                      <td className="py-2"><Link href={HREF[it.type] ?? "#"} className="text-teal-700 hover:underline">Review →</Link></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="text-[10px] text-gray-400 mt-2">Showing {Math.min(8, d.items.length)} of {d.items.length}. Ranked by AI priority (critical clinical first, overdue pinned). Inline one-click approve + audit is a next-phase wiring — each row drills down to its source.</p>
            </div>
          )}
        </div>

        {/* Distribution + status */}
        <div className="space-y-4">
          <div className={`${card} p-5`}>
            <h3 className="text-sm font-bold text-gray-900 mb-3">Action Distribution</h3>
            {d.items.length === 0 ? <p className="text-sm text-gray-400">No items.</p> : (
              <div className="flex items-center gap-3">
                <Donut total={c.total} segments={d.distribution.map((x: any) => ({ n: x.n, color: TYPE_COLOR[x.type] ?? "#9ca3af" }))} />
                <div className="text-[11px] space-y-1 flex-1">{d.distribution.map((x: any) => <div key={x.type} className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-sm" style={{ background: TYPE_COLOR[x.type] ?? "#9ca3af" }} /><span className="text-gray-600 flex-1">{x.type}</span><b className="text-gray-800">{x.n}</b><span className="text-gray-400">({x.pct}%)</span></div>)}</div>
              </div>
            )}
          </div>
          <div className={`${card} p-5`}>
            <h3 className="text-sm font-bold text-gray-900 mb-3">Actions by Status</h3>
            <div className="space-y-1.5">{statusRows.map(([l, n, col]) => (<div key={l} className="flex items-center gap-2 text-xs"><span className="w-20 text-gray-500 shrink-0">{l}</span><div className="flex-1 h-2 rounded-full bg-gray-100 overflow-hidden"><div className="h-full rounded-full" style={{ width: `${(n / maxStatus) * 100}%`, background: col }} /></div><b className="text-gray-700 tabular-nums w-6 text-right">{n}</b></div>))}</div>
          </div>
        </div>
      </div>

      {/* UMW-005A — five module summary panels */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-4">
        <ModulePanel icon="✅" title="Approvals" color="#8b5cf6" provisioned={mods.approvals.provisioned}
          stats={[["Pending", mods.approvals.pending], ["Due Today", mods.approvals.dueToday], ["Overdue", mods.approvals.overdue]]}
          breakdown={mods.approvals.breakdown} href="/unit-manager/approvals" linkLabel="View approvals" />
        <ModulePanel icon="⚠" title="Escalations" color="#ef4444" provisioned={mods.escalations.provisioned}
          stats={[["Open", mods.escalations.open], ["Critical", mods.escalations.critical, "text-rose-600"], ["Awaiting", mods.escalations.awaiting]]}
          breakdown={mods.escalations.breakdown} href="/unit-manager/escalations" linkLabel="View escalations" />
        <ModulePanel icon="📈" title="CAPA & Improvement" color="#14b8a6" provisioned={mods.capa.provisioned}
          stats={[["Open CAPAs", mods.capa.open], ["Overdue", mods.capa.overdue, "text-rose-600"], ["On Track", mods.capa.onTrack, "text-green-600"]]}
          breakdown={mods.capa.breakdown} href="/supervisor/quality-safety" linkLabel="View CAPA register" />
        <ModulePanel icon="🎓" title="Competency Validations" color="#3b82f6" provisioned={mods.competency.provisioned}
          stats={[["Pending", mods.competency.pending], ["Expired", mods.competency.expired, "text-rose-600"], ["Due ≤7d", mods.competency.dueThisWeek, "text-amber-600"]]}
          breakdown={mods.competency.breakdown} href="/unit-manager/competency-validations" linkLabel="View validations" note="Sub-categories via Competency Engine (next phase)." />
        <ModulePanel icon="🕐" title="History & Audit" color="#6b7280" provisioned={mods.history.provisioned}
          stats={[["Events", mods.history.total], ["This Week", mods.history.thisWeek], ["Period", mods.history.thisPeriod]]}
          breakdown={mods.history.breakdown} href="#" linkLabel="View audit trail" />
      </div>

      {/* AI recs + upcoming + quick actions */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className={`${card} p-5 xl:col-span-1 bg-gradient-to-br from-violet-50/50 to-white`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3 flex items-center gap-1.5"><span>✨</span>Recommended Priority Actions</h3>
          {d.aiRecommendations.length === 0 ? <p className="text-sm text-gray-400">No priority actions recommended.</p> : (
            <div className="space-y-2">
              {d.aiRecommendations.map((r: any, i: number) => (
                <div key={i} className="rounded-lg border border-gray-100 p-2.5"><p className="text-xs font-semibold text-gray-800 truncate">{r.title}</p><p className="text-[10px] text-gray-500 leading-tight">{r.reason}</p><Link href={HREF[r.type] ?? "#"} className="text-[10px] font-semibold text-violet-700 mt-1 inline-block">{r.action} →</Link></div>
              ))}
            </div>
          )}
          <p className="text-[10px] text-gray-400 mt-2">Ranked by clinical risk + urgency over the live queue.</p>
        </div>

        <div className={`${card} p-5`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Upcoming Due Dates</h3>
          {d.upcomingDue.length === 0 ? <p className="text-sm text-gray-400">No dated actions upcoming.</p> : (
            <div className="space-y-2">{d.upcomingDue.map((u: any, i: number) => (<div key={i} className="flex items-center gap-2 text-xs"><span className="text-gray-700 flex-1 truncate">{u.item}</span><span className={`px-1.5 py-0.5 rounded text-[10px] ${u.overdue ? "bg-rose-50 text-rose-700" : u.dueToday ? "bg-amber-50 text-amber-700" : "bg-gray-100 text-gray-500"}`}>{u.overdue ? "Overdue" : u.dueToday ? "Today" : u.due?.slice(5)}</span></div>))}</div>
          )}
        </div>

        <div className={`${card} p-5`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Quick Actions</h3>
          <div className="grid grid-cols-3 gap-1.5">
            {QUICK.map(([label, href]: any) => href ? (
              <Link key={label} href={href} className="text-[10px] text-gray-700 border border-gray-100 rounded-lg px-1.5 py-2 hover:border-teal-300 hover:bg-teal-50/40 text-center">{label}</Link>
            ) : (
              <span key={label} className="text-[10px] text-gray-300 border border-gray-100 rounded-lg px-1.5 py-2 text-center" title="Not wired yet">{label}</span>
            ))}
          </div>
        </div>
      </div>

      {/* Honest channels */}
      <div className={`${card} p-5`}>
        <h3 className="text-sm font-bold text-gray-900 mb-2">Additional Request Channels</h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
          {d.honestChannels.map((ch: string) => <div key={ch} className="rounded-lg border border-dashed border-gray-200 bg-gray-50/60 p-3"><p className="text-xs font-medium text-gray-600">{ch}</p><p className="text-[10px] text-gray-400">No backing store</p></div>)}
        </div>
      </div>

      <p className="text-[11px] text-gray-400 pb-4">Executive Actions (UMW-005) brings together escalations, incidents, improvement/CAPA actions and competency validations from the live operational, quality and competency stores into one AI-prioritised decision queue — with distribution &amp; status analytics, recommended priority actions, upcoming deadlines and a completed-this-period count. Leave/staffing/policy/budget/executive-message channels need their own stores, and inline one-click approve + audit is a next-phase wiring — both shown as honest states rather than fabricated.</p>
    </div>
  );
}
