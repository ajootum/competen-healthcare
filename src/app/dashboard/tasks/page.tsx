import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadTaskCentre } from "@/lib/task-centre";

// PW-002 Universal Task & Action Centre — one intelligent work queue aggregating every actionable item
// across the platform (Patient Care, Learning, Competency, Quality…) for the signed-in user. Server-rendered;
// tabs + module/priority filters run through URL params (no client JS). Renders the person's REAL aggregated
// inbox — honest-lighter than the aspirational mockup for a real clinician.
export const dynamic = "force-dynamic";

const modHref: Record<string, string> = { PCE: "/dashboard/shift", OPS: "/dashboard/shift", LMS: "/dashboard/learning", CMO: "/dashboard/passport", QMS: "/dashboard/shift", HCM: "/dashboard/billing" };
const prioPill: Record<string, string> = { high: "bg-rose-50 text-rose-700 ring-rose-200", medium: "bg-amber-50 text-amber-700 ring-amber-200", low: "bg-slate-50 text-slate-600 ring-slate-200" };
const prioDot: Record<string, string> = { high: "#f43f5e", medium: "#f59e0b", low: "#94a3b8" };
function statusPill(s: string) {
  if (s === "Overdue" || s === "Action Required") return "bg-rose-50 text-rose-700 ring-rose-200";
  if (s === "Due Today") return "bg-amber-50 text-amber-700 ring-amber-200";
  if (s === "Due Tomorrow") return "bg-orange-50 text-orange-700 ring-orange-200";
  return "bg-blue-50 text-blue-700 ring-blue-200";
}

function Kpi({ label, value, tone, sub }: { label: string; value: number; tone: string; sub?: string }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <p className="text-[11px] font-medium text-gray-500 uppercase tracking-wide">{label}</p>
      <p className={`text-3xl font-bold mt-1 ${tone}`}>{value}</p>
      {sub && <p className="text-[11px] text-gray-400 mt-0.5">{sub}</p>}
    </div>
  );
}

// Priority donut (SVG stroke-dasharray ring).
function Donut({ high, medium, low }: { high: number; medium: number; low: number }) {
  const total = high + medium + low || 1;
  const R = 52, C = 2 * Math.PI * R;
  const segs = [{ n: high, c: prioDot.high }, { n: medium, c: prioDot.medium }, { n: low, c: prioDot.low }];
  let offset = 0;
  return (
    <div className="flex items-center gap-4">
      <svg width="130" height="130" viewBox="0 0 130 130" className="shrink-0">
        <circle cx="65" cy="65" r={R} fill="none" stroke="#f1f5f9" strokeWidth="16" />
        {segs.map((s, i) => {
          const len = (s.n / total) * C;
          const el = <circle key={i} cx="65" cy="65" r={R} fill="none" stroke={s.c} strokeWidth="16" strokeDasharray={`${len} ${C - len}`} strokeDashoffset={-offset} transform="rotate(-90 65 65)" />;
          offset += len; return el;
        })}
        <text x="65" y="60" textAnchor="middle" className="fill-gray-900 font-bold" fontSize="22">{high + medium + low}</text>
        <text x="65" y="78" textAnchor="middle" className="fill-gray-400" fontSize="10">Total</text>
      </svg>
      <div className="space-y-1.5 text-sm">
        <div className="flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-full" style={{ background: prioDot.high }} /><span className="text-gray-600">High</span><span className="ml-auto font-semibold text-gray-900">{high}</span></div>
        <div className="flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-full" style={{ background: prioDot.medium }} /><span className="text-gray-600">Medium</span><span className="ml-auto font-semibold text-gray-900">{medium}</span></div>
        <div className="flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-full" style={{ background: prioDot.low }} /><span className="text-gray-600">Low</span><span className="ml-auto font-semibold text-gray-900">{low}</span></div>
      </div>
    </div>
  );
}

export default async function TaskCentrePage({ searchParams }: { searchParams: Promise<{ tab?: string; module?: string; priority?: string }> }) {
  const { tab = "all", module, priority } = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any; // eslint-disable-line @typescript-eslint/no-explicit-any
  const { data: profile } = await admin.from("profiles").select("full_name, hospital_id").eq("id", user.id).single();

  const d = await loadTaskCentre(admin, user.id, profile);

  // Apply tab + filters (server-side).
  let rows = d.tasks as any[]; // eslint-disable-line @typescript-eslint/no-explicit-any
  if (tab === "mine") rows = rows.filter(t => t.origin === "assigned");
  else if (tab === "delegated") rows = rows.filter(t => t.origin === "delegated");
  else if (tab === "created") rows = rows.filter(t => t.origin === "created");
  else if (tab === "favorites") rows = [];
  if (module) rows = rows.filter(t => t.module === module);
  if (priority) rows = rows.filter(t => t.priority === priority);
  const shown = rows.slice(0, 40);

  const qp = (o: Record<string, string | undefined>) => { const p = new URLSearchParams(); if (o.tab && o.tab !== "all") p.set("tab", o.tab); if (o.module) p.set("module", o.module); if (o.priority) p.set("priority", o.priority); const s = p.toString(); return s ? `?${s}` : "/dashboard/tasks"; };
  const TABS = [{ k: "all", label: "All Tasks", n: d.tabs.all }, { k: "mine", label: "My Tasks", n: d.tabs.mine }, { k: "delegated", label: "Delegated to Me", n: d.tabs.delegated }, { k: "created", label: "Created by Me", n: d.tabs.created }, { k: "favorites", label: "Favorites", n: d.tabs.favorites }];

  return (
    <div className="max-w-[1400px] mx-auto space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold text-blue-600 uppercase tracking-wide">Personal Workspace</p>
          <h1 className="text-2xl font-bold text-gray-900">Task &amp; Action Centre</h1>
          <p className="text-sm text-gray-500 mt-0.5">Every actionable item across your workspaces, in one intelligent queue.</p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/dashboard/preferences" className="text-sm font-medium text-gray-600 border border-gray-200 rounded-lg px-3 py-2 hover:bg-gray-50">⚙ Configure</Link>
          <Link href="/dashboard/shift" className="text-sm font-medium text-white bg-blue-600 rounded-lg px-3 py-2 hover:bg-blue-500">+ New Task</Link>
        </div>
      </div>

      {/* KPI ribbon */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Kpi label="Total Tasks" value={d.kpis.total} tone="text-gray-900" />
        <Kpi label="Overdue" value={d.kpis.overdue} tone="text-rose-600" sub="Needs attention" />
        <Kpi label="Due Today" value={d.kpis.dueToday} tone="text-amber-600" />
        <Kpi label="Completed (7d)" value={d.kpis.completed7d} tone="text-emerald-600" />
        <Kpi label="High Priority" value={d.kpis.highPriority} tone="text-blue-600" />
      </div>

      {/* AI Prioritisation Assistant */}
      {d.ranked.length > 0 && (
        <div className="rounded-xl border border-blue-200 bg-gradient-to-br from-blue-50 to-indigo-50 p-4">
          <div className="flex items-center gap-2 mb-2.5">
            <span className="text-lg">✨</span>
            <h2 className="text-sm font-semibold text-gray-900">AI Prioritisation</h2>
            <span className="text-[10px] font-medium text-blue-700 bg-blue-100 rounded-full px-2 py-0.5">Rule-based priority engine</span>
          </div>
          <div className="grid md:grid-cols-3 gap-2.5">
            {d.ranked.map((r: any, i: number) => ( // eslint-disable-line @typescript-eslint/no-explicit-any
              <div key={i} className="bg-white/70 rounded-lg border border-blue-100 p-3">
                <div className="flex items-center gap-2 mb-1"><span className="w-5 h-5 rounded-full bg-blue-600 text-white text-[11px] font-bold flex items-center justify-center">{i + 1}</span><span className="text-[10px] font-semibold text-rose-600 uppercase tracking-wide">{r.reason}</span></div>
                <p className="text-sm font-medium text-gray-800 line-clamp-2">{r.title}</p>
                <p className="text-[11px] text-gray-500 mt-1">{r.impact}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex flex-wrap items-center gap-1 border-b border-gray-200">
        {TABS.map(t => (
          <Link key={t.k} href={qp({ tab: t.k, module, priority })} className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${tab === t.k ? "border-blue-600 text-blue-700" : "border-transparent text-gray-500 hover:text-gray-800"}`}>
            {t.label} <span className={`ml-1 text-[11px] rounded-full px-1.5 py-0.5 ${tab === t.k ? "bg-blue-100 text-blue-700" : "bg-gray-100 text-gray-500"}`}>{t.n}</span>
          </Link>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-gray-400">Filter:</span>
        <Link href={qp({ tab, module: undefined, priority })} className={`text-xs rounded-full px-3 py-1.5 ring-1 ${!module ? "bg-blue-600 text-white ring-blue-600" : "bg-white text-gray-600 ring-gray-200 hover:bg-gray-50"}`}>All Modules</Link>
        {d.byModule.map((m: any) => ( // eslint-disable-line @typescript-eslint/no-explicit-any
          <Link key={m.code} href={qp({ tab, module: m.code, priority })} className={`text-xs rounded-full px-3 py-1.5 ring-1 ${module === m.code ? "bg-blue-600 text-white ring-blue-600" : "bg-white text-gray-600 ring-gray-200 hover:bg-gray-50"}`}>{m.icon} {m.label} ({m.n})</Link>
        ))}
        <span className="mx-1 text-gray-200">|</span>
        {["high", "medium", "low"].map(p => (
          <Link key={p} href={qp({ tab, module, priority: priority === p ? undefined : p })} className={`text-xs rounded-full px-3 py-1.5 ring-1 capitalize ${priority === p ? "bg-blue-600 text-white ring-blue-600" : "bg-white text-gray-600 ring-gray-200 hover:bg-gray-50"}`}>{p} priority</Link>
        ))}
      </div>

      <div className="grid lg:grid-cols-3 gap-5">
        {/* Task table */}
        <div className="lg:col-span-2 bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wide border-b border-gray-100 bg-gray-50/60">
                  <th className="px-4 py-2.5">Task</th>
                  <th className="px-3 py-2.5">Module</th>
                  <th className="px-3 py-2.5">Priority</th>
                  <th className="px-3 py-2.5">Due</th>
                  <th className="px-3 py-2.5">Status</th>
                  <th className="px-3 py-2.5">SLA</th>
                  <th className="px-3 py-2.5"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {shown.map((t: any) => ( // eslint-disable-line @typescript-eslint/no-explicit-any
                  <tr key={t.id} className="hover:bg-gray-50/60">
                    <td className="px-4 py-3">
                      <p className="font-medium text-gray-800 leading-snug">{t.title}</p>
                      {t.related && <p className="text-[11px] text-gray-400 mt-0.5">Patient · {t.related}</p>}
                    </td>
                    <td className="px-3 py-3"><span className="inline-flex items-center gap-1 text-[11px] font-medium rounded-md px-1.5 py-0.5" style={{ background: `${t.mod.color}15`, color: t.mod.color }}>{t.mod.icon} {t.mod.code}</span></td>
                    <td className="px-3 py-3"><span className={`inline-flex items-center gap-1 text-[11px] font-medium rounded-full px-2 py-0.5 ring-1 capitalize ${prioPill[t.priority]}`}><span className="w-1.5 h-1.5 rounded-full" style={{ background: prioDot[t.priority] }} />{t.priority}</span></td>
                    <td className="px-3 py-3 text-gray-600 whitespace-nowrap">{t.due ? new Date(t.due).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : "—"}</td>
                    <td className="px-3 py-3"><span className={`text-[11px] font-medium rounded-full px-2 py-0.5 ring-1 whitespace-nowrap ${statusPill(t.status)}`}>{t.status}</span></td>
                    <td className={`px-3 py-3 text-[12px] font-medium whitespace-nowrap ${t.overdue ? "text-rose-600" : "text-gray-500"}`}>{t.sla}</td>
                    <td className="px-3 py-3 text-right"><Link href={modHref[t.module] ?? "/dashboard"} className="text-[12px] font-medium text-blue-600 hover:underline whitespace-nowrap">Open →</Link></td>
                  </tr>
                ))}
                {shown.length === 0 && (
                  <tr><td colSpan={7} className="px-4 py-16 text-center text-sm text-gray-400">
                    {d.tabs.all === 0 ? "No open tasks — you're all caught up. 🎉" : "No tasks match this filter."}
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
          {rows.length > 0 && <div className="px-4 py-2.5 border-t border-gray-100 text-[11px] text-gray-400">Showing {shown.length} of {rows.length} task{rows.length === 1 ? "" : "s"}</div>}
        </div>

        {/* Right rail */}
        <div className="space-y-5">
          {/* Priority donut */}
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <h3 className="text-sm font-semibold text-gray-900 mb-3">Tasks by Priority</h3>
            {d.kpis.total > 0 ? <Donut high={d.byPriority.high} medium={d.byPriority.medium} low={d.byPriority.low} /> : <p className="text-xs text-gray-400 py-6 text-center">No open tasks.</p>}
          </div>

          {/* Tasks by module */}
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <h3 className="text-sm font-semibold text-gray-900 mb-3">Tasks by Module</h3>
            {d.byModule.length > 0 ? (
              <div className="space-y-2.5">
                {d.byModule.map((m: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
                  const pct = Math.round((m.n / d.kpis.total) * 100);
                  return (
                    <div key={m.code}>
                      <div className="flex items-center justify-between text-[12px] mb-1"><span className="text-gray-600">{m.icon} {m.label}</span><span className="font-semibold text-gray-800">{m.n}</span></div>
                      <div className="h-1.5 rounded-full bg-gray-100 overflow-hidden"><div className="h-full rounded-full" style={{ width: `${pct}%`, background: m.color }} /></div>
                    </div>
                  );
                })}
              </div>
            ) : <p className="text-xs text-gray-400 py-4 text-center">No open tasks.</p>}
          </div>

          {/* Pending approvals */}
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <h3 className="text-sm font-semibold text-gray-900 mb-3">Pending Approvals</h3>
            {d.approvals.length > 0 ? (
              <div className="space-y-2">
                {d.approvals.map((a: any) => ( // eslint-disable-line @typescript-eslint/no-explicit-any
                  <div key={a.category} className="flex items-center justify-between text-sm"><span className="capitalize text-gray-600">{a.category}</span><span className="font-semibold text-gray-900 bg-amber-50 text-amber-700 rounded-full px-2 text-[12px]">{a.n}</span></div>
                ))}
                <Link href="/supervisor/approvals" className="block text-center text-[12px] font-medium text-blue-600 hover:underline pt-1">Review queue →</Link>
              </div>
            ) : <p className="text-xs text-gray-400 py-4 text-center">No approvals awaiting you.</p>}
          </div>

          {/* Calendar today */}
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <h3 className="text-sm font-semibold text-gray-900 mb-3">My Calendar — Today</h3>
            {d.calendar.length > 0 ? (
              <div className="space-y-2.5">
                {d.calendar.map((c: any, i: number) => ( // eslint-disable-line @typescript-eslint/no-explicit-any
                  <div key={i} className="flex gap-3 text-sm"><span className="text-[11px] font-medium text-gray-400 w-24 shrink-0">{c.time}</span><span className="text-gray-700">{c.title}</span></div>
                ))}
                <Link href="/dashboard/shift" className="block text-center text-[12px] font-medium text-blue-600 hover:underline pt-1">Open schedule →</Link>
              </div>
            ) : <p className="text-xs text-gray-400 py-4 text-center">No shift scheduled today.</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
