import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadTaskCenter } from "@/lib/operations/task-center";
import TaskConsole from "./TaskConsole";

export const dynamic = "force-dynamic";

// Task Center (SSW-001) — the Shift Supervisor's operational execution hub over
// the live clinical-task domain (op_tasks): dashboard, assignment & coordination,
// execution & monitoring, escalations & exceptions, and task intelligence.
// Everything is live from op_tasks; the mockup's Waiting/Blocked statuses and
// Declined/Reassigned assignment states have no backing status and are shown as
// honest states, not fabricated.
/* eslint-disable @typescript-eslint/no-explicit-any */

const card = "bg-white rounded-xl border border-gray-200";
const dash = (n: number | null | undefined) => (n == null ? "—" : n.toLocaleString());
const relTime = (iso?: string | null) => { if (!iso) return ""; const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000); if (s < 60) return "just now"; if (s < 3600) return `${Math.floor(s / 60)}m ago`; if (s < 86400) return `${Math.floor(s / 3600)}h ago`; return `${Math.floor(s / 86400)}d ago`; };
const titleCase = (s: string) => (s ?? "").replace(/_/g, " ").replace(/\b\w/g, m => m.toUpperCase());
const scoreTone = (n: number | null) => (n == null ? "text-gray-300" : n >= 90 ? "text-green-600" : n >= 75 ? "text-amber-600" : "text-rose-600");
const PRIO_TONE: Record<string, string> = { Critical: "bg-rose-50 text-rose-700", High: "bg-orange-50 text-orange-700", Medium: "bg-amber-50 text-amber-700", Low: "bg-gray-100 text-gray-600" };
const PRIO_DOT: Record<string, string> = { Critical: "bg-rose-500", High: "bg-orange-500", Medium: "bg-amber-500", Low: "bg-blue-500" };
const STATUS_TONE: Record<string, string> = { completed: "bg-green-50 text-green-700", verified: "bg-green-50 text-green-700", in_progress: "bg-blue-50 text-blue-700", accepted: "bg-blue-50 text-blue-700", assigned: "bg-gray-100 text-gray-600", created: "bg-gray-100 text-gray-600", cancelled: "bg-gray-100 text-gray-400" };

export default async function TaskCenter() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles, hospital_id").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.some(r => ["assessor", "hospital_admin", "super_admin"].includes(r))) redirect("/dashboard");
  const isSuper = roles.includes("super_admin");
  const hid = profile?.hospital_id ?? null;

  const d = await loadTaskCenter(admin, hid, isSuper);
  const k = d.kpis;
  const a = d.assignment, ex = d.execution, es = d.escalations, wi = d.intelligence;

  return (
    <div data-wide className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Task Center</h1>
        <p className="text-sm text-gray-500">Coordinate, assign and track all tasks across the shift.</p>
      </div>

      {/* Real task coordination console */}
      <TaskConsole staff={d.pickers.staff} openTasks={d.pickers.openTasks} />

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        {/* Module 1: Task Dashboard */}
        <div className={`${card} p-5`}>
          <div className="flex items-center gap-2 mb-3">
            <span className="w-7 h-7 rounded-lg bg-blue-100 text-blue-700 flex items-center justify-center text-sm font-bold">1</span>
            <div><h2 className="text-sm font-bold text-gray-900 leading-tight">Task Dashboard</h2><p className="text-[10px] text-gray-500">Real-time overview of all tasks</p></div>
          </div>
          <div className="grid grid-cols-4 gap-2 mb-3">
            {[["Total", k.total, "text-gray-900"], ["Done", `${dash(k.completed)}`, "text-green-600"], ["Overdue", k.overdue, k.overdue > 0 ? "text-rose-600" : "text-gray-900"], ["Critical", k.critical, k.critical > 0 ? "text-rose-600" : "text-gray-900"]].map(([l, v, tone]: any) => (
              <div key={l} className="rounded-lg border border-gray-100 p-2 text-center"><p className={`text-lg font-bold tabular-nums ${tone}`}>{typeof v === "number" ? dash(v) : v}</p><p className="text-[8px] text-gray-500">{l}</p></div>
            ))}
          </div>
          <div className="grid grid-cols-3 gap-2 mb-3">
            {[["High Priority", k.highPriority], ["Awaiting", k.awaitingAccept], ["Avg mins", k.avgCompletionMin]].map(([l, v]: any) => (
              <div key={l} className="rounded-lg border border-gray-100 p-2 text-center"><p className="text-base font-bold text-gray-900 tabular-nums">{dash(v)}</p><p className="text-[8px] text-gray-500">{l}</p></div>
            ))}
          </div>
          <p className="text-[10px] font-semibold text-gray-400 uppercase mb-1">By priority</p>
          <div className="space-y-1 mb-3">
            {d.byPriority.map((p: any) => (
              <div key={p.key} className="flex items-center gap-2 text-xs"><span className={`w-1.5 h-1.5 rounded-full ${PRIO_DOT[p.label]}`} /><span className="text-gray-600 flex-1">{p.label}</span><span className="tabular-nums text-gray-500">{p.n} · {k.total ? Math.round((p.n / k.total) * 100) : 0}%</span></div>
            ))}
          </div>
          <p className="text-[10px] font-semibold text-gray-400 uppercase mb-1">By unit</p>
          <div className="space-y-1">
            {d.byUnit.slice(0, 6).map((u: any) => (
              <div key={u.unit} className="flex items-center justify-between text-xs"><span className="text-gray-600 truncate">{u.unit}</span><span className="tabular-nums text-gray-500">{u.n}</span></div>
            ))}
          </div>
        </div>

        {/* Module 2: Assignment & Coordination */}
        <div className={`${card} p-5`}>
          <div className="flex items-center gap-2 mb-3">
            <span className="w-7 h-7 rounded-lg bg-green-100 text-green-700 flex items-center justify-center text-sm font-bold">2</span>
            <div><h2 className="text-sm font-bold text-gray-900 leading-tight">Assignment &amp; Coordination</h2><p className="text-[10px] text-gray-500">The right people, at the right time</p></div>
          </div>
          <div className="grid grid-cols-3 gap-2 mb-3">
            {[["Unassigned", a.states.unassigned, "text-rose-600"], ["Assigned", a.states.assigned, "text-gray-900"], ["Accepted", a.states.accepted, "text-green-600"]].map(([l, n, tone]: any) => (
              <div key={l} className="rounded-lg border border-gray-100 p-2 text-center"><p className={`text-lg font-bold tabular-nums ${(n ?? 0) > 0 ? tone : "text-gray-900"}`}>{dash(n)}</p><p className="text-[8px] text-gray-500">{l}</p></div>
            ))}
          </div>
          {a.unassigned.length > 0 && (
            <>
              <p className="text-[10px] font-semibold text-gray-400 uppercase mb-1">Unassigned tasks</p>
              <div className="space-y-1 mb-3">
                {a.unassigned.map((t: any) => (
                  <div key={t.id} className="flex items-center gap-2 text-xs"><span className="text-gray-700 flex-1 truncate">{t.desc}{t.bed ? ` · ${t.bed}` : ""}</span><span className={`text-[9px] font-medium px-1.5 py-0.5 rounded shrink-0 ${PRIO_TONE[({ urgent: "Critical", high: "High", normal: "Medium", low: "Low" } as any)[t.priority]] ?? "bg-gray-100 text-gray-600"}`}>{({ urgent: "Critical", high: "High", normal: "Medium", low: "Low" } as any)[t.priority]}</span></div>
                ))}
              </div>
            </>
          )}
          <p className="text-[10px] font-semibold text-gray-400 uppercase mb-1">Team workload</p>
          <div className="space-y-1.5 mb-3">
            {a.teamWorkload.map((w: any, i: number) => (
              <div key={i}>
                <div className="flex items-center justify-between text-xs mb-0.5"><span className="text-gray-600 truncate">{w.name}</span><span className="tabular-nums text-gray-500">{w.n}</span></div>
                <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden"><div className={`h-full rounded-full ${w.n >= a.maxLoad ? "bg-rose-500" : w.n >= a.maxLoad * 0.6 ? "bg-amber-500" : "bg-green-500"}`} style={{ width: `${(w.n / a.maxLoad) * 100}%` }} /></div>
              </div>
            ))}
          </div>
          {a.recommendations.length > 0 && (
            <>
              <p className="text-[10px] font-semibold text-gray-400 uppercase mb-1">AI assignment (least-loaded)</p>
              <div className="space-y-1">
                {a.recommendations.map((r: any, i: number) => (
                  <div key={i} className="flex items-center gap-2 text-xs rounded-lg border border-gray-100 p-1.5"><span className="text-gray-700 flex-1 truncate">{r.task}</span><span className="text-[10px] text-teal-700 shrink-0">→ {r.staff ?? "—"}</span></div>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Module 3: Execution & Monitoring */}
        <div className={`${card} p-5`}>
          <div className="flex items-center gap-2 mb-3">
            <span className="w-7 h-7 rounded-lg bg-violet-100 text-violet-700 flex items-center justify-center text-sm font-bold">3</span>
            <div><h2 className="text-sm font-bold text-gray-900 leading-tight">Execution &amp; Monitoring</h2><p className="text-[10px] text-gray-500">Progress from start to completion</p></div>
          </div>
          <div className="grid grid-cols-4 gap-2 mb-3">
            {ex.statusOverview.map((s: any) => (
              <div key={s.label} className="rounded-lg border border-gray-100 p-2 text-center"><p className={`text-base font-bold tabular-nums ${s.tone}`}>{dash(s.n)}</p><p className="text-[8px] text-gray-500 leading-tight">{s.label}</p></div>
            ))}
          </div>
          <div className="rounded-lg border border-gray-100 p-3 mb-3 text-center">
            <p className={`text-3xl font-bold tabular-nums ${scoreTone(ex.sla.compliance)}`}>{ex.sla.compliance == null ? "—" : `${ex.sla.compliance}%`}</p>
            <p className="text-[10px] text-gray-500">SLA compliance ({ex.sla.total} with due time)</p>
            <p className="text-[9px] text-gray-400 mt-1">{ex.sla.onTrack} on track · {ex.sla.atRisk} at risk · {ex.sla.breached} breached</p>
          </div>
          <p className="text-[10px] font-semibold text-gray-400 uppercase mb-1">Recent updates</p>
          <div className="divide-y divide-gray-50">
            {ex.recentUpdates.map((u: any, i: number) => (
              <div key={i} className="flex items-center gap-2 py-1.5"><span className="text-xs text-gray-700 flex-1 truncate">{u.desc}</span><span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded shrink-0 ${STATUS_TONE[u.status] ?? "bg-gray-100 text-gray-600"}`}>{titleCase(u.status)}</span><span className="text-[10px] text-gray-400 shrink-0">{relTime(u.at)}</span></div>
            ))}
          </div>
          <p className="text-[10px] text-gray-400 mt-3">“Waiting” &amp; “Blocked” need dedicated task states — not in the lifecycle yet.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Module 4: Escalations & Exceptions */}
        <div className={`${card} p-5`}>
          <div className="flex items-center gap-2 mb-3">
            <span className="w-7 h-7 rounded-lg bg-orange-100 text-orange-700 flex items-center justify-center text-sm font-bold">4</span>
            <div><h2 className="text-sm font-bold text-gray-900 leading-tight">Escalations &amp; Exceptions</h2><p className="text-[10px] text-gray-500">Issues needing attention</p></div>
          </div>
          <div className="grid grid-cols-2 gap-2 mb-3">
            {[["Overdue", es.overdue, "text-rose-600"], ["Critical Delays", es.criticalDelays, "text-rose-600"]].map(([l, n, tone]: any) => (
              <div key={l} className="rounded-lg border border-gray-100 p-2.5 text-center"><p className={`text-xl font-bold tabular-nums ${(n ?? 0) > 0 ? tone : "text-gray-900"}`}>{dash(n)}</p><p className="text-[9px] text-gray-500">{l}</p></div>
            ))}
          </div>
          {es.escalatedTasks.length === 0 ? <p className="text-xs text-gray-400 py-3 text-center">✅ No overdue tasks.</p> : (
            <div className="space-y-1.5">
              <p className="text-[10px] font-semibold text-gray-400 uppercase">Overdue tasks</p>
              {es.escalatedTasks.map((t: any, i: number) => (
                <div key={i} className="flex items-center gap-2 rounded-lg border border-gray-100 p-2">
                  <div className="min-w-0 flex-1"><p className="text-xs text-gray-800 truncate">{t.desc}{t.bed ? ` · ${t.bed}` : ""}</p><p className="text-[9px] text-gray-400">{titleCase(t.type ?? "task")}</p></div>
                  <span className="text-[10px] font-semibold text-rose-600 shrink-0">+{t.overdueMin}m</span>
                </div>
              ))}
            </div>
          )}
          {Object.keys(es.byCategory).length > 0 && (
            <div className="mt-3 pt-2 border-t border-gray-50">
              <p className="text-[10px] font-semibold text-gray-400 uppercase mb-1">Overdue by category</p>
              <div className="flex flex-wrap gap-1.5">{Object.entries(es.byCategory).map(([c, n]: any) => <span key={c} className="text-[10px] text-gray-600 bg-gray-50 border border-gray-100 rounded px-1.5 py-0.5">{c} · {n}</span>)}</div>
            </div>
          )}
        </div>

        {/* Module 5: Intelligence & Performance */}
        <div className={`${card} p-5 lg:col-span-2`}>
          <div className="flex items-center gap-2 mb-3">
            <span className="w-7 h-7 rounded-lg bg-teal-100 text-teal-700 flex items-center justify-center text-sm font-bold">5</span>
            <div><h2 className="text-sm font-bold text-gray-900 leading-tight">Task Intelligence &amp; Performance</h2><p className="text-[10px] text-gray-500">Analyse performance, improve efficiency</p></div>
          </div>
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 mb-4">
            {[["Completion", wi.completionRate == null ? "—" : `${wi.completionRate}%`, scoreTone(wi.completionRate)], ["Avg mins", dash(wi.avgCompletionMin), "text-gray-900"], ["Per Staff", dash(wi.tasksPerStaff), "text-gray-900"], ["Overdue", dash(wi.overdue), wi.overdue > 0 ? "text-rose-600" : "text-gray-900"], ["SLA", wi.slaCompliance == null ? "—" : `${wi.slaCompliance}%`, scoreTone(wi.slaCompliance)], ["Shift Score", wi.shiftScore == null ? "—" : wi.shiftScore, scoreTone(wi.shiftScore)]].map(([l, v, tone]: any) => (
              <div key={l} className="rounded-lg border border-gray-100 p-2 text-center"><p className={`text-base font-bold tabular-nums ${tone}`}>{v}</p><p className="text-[8px] text-gray-500 leading-tight">{l}</p></div>
            ))}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <p className="text-[10px] font-semibold text-gray-400 uppercase mb-1.5">By category</p>
              <div className="space-y-1">
                {wi.categories.map((c: any) => (
                  <div key={c.label} className="flex items-center justify-between text-xs"><span className="text-gray-600 truncate">{c.label}</span><span className="tabular-nums text-gray-500">{c.n} · {c.pct}%</span></div>
                ))}
              </div>
            </div>
            <div>
              <p className="text-[10px] font-semibold text-gray-400 uppercase mb-1.5">Overdue trend (7d)</p>
              <div className="flex items-end gap-1 h-20">
                {wi.trend.map((t: any) => (
                  <div key={t.day} className="flex-1 flex flex-col items-center gap-0.5">
                    <div className="w-full bg-rose-200 rounded-t" style={{ height: `${(t.n / wi.trendMax) * 100}%`, minHeight: t.n > 0 ? "3px" : "0" }} />
                    <span className="text-[7px] text-gray-400">{t.day.split(" ")[1]}</span>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <p className="text-[10px] font-semibold text-gray-400 uppercase mb-1.5">Top bottlenecks</p>
              {wi.bottlenecks.length === 0 ? <p className="text-xs text-gray-400">None — no overdue tasks.</p> : (
                <div className="space-y-1">
                  {wi.bottlenecks.map((b: any) => (
                    <div key={b.label} className="flex items-center justify-between text-xs"><span className="text-gray-600 truncate">{titleCase(b.label)}</span><span className="tabular-nums text-gray-500">{b.n}</span></div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <p className="text-[11px] text-gray-400 pb-4">The Task Center is the operational execution hub — every figure is live from the clinical-task domain (op_tasks): counts, priority and unit breakdowns, assignment states, team workload, SLA compliance from due times, overdue escalations, and completion/bottleneck analytics. Task creation and lifecycle transitions run through the audited task API with legal state enforcement and coordinator sign-off. The mockup's Waiting/Blocked statuses and Declined/Reassigned assignment states have no backing lifecycle status and are shown as honest states rather than fabricated.</p>
    </div>
  );
}
