import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadTaskCenter } from "@/lib/operations/task-center";
import { loadTaskTemplates } from "@/lib/operations/task-templates";
import TaskConsole from "./TaskConsole";
import TaskBoard from "./TaskBoard";
import WorkflowPanel from "./WorkflowPanel";

export const dynamic = "force-dynamic";

// Task Centre (SSW-TSK-001 redesign) — the operational task coordination engine.
// Create/assign, a Kanban Task Board over the live op_tasks lifecycle, AI copilot
// suggestions, shift timeline, priority summary, overdue tasks, workload and
// performance — all live from op_tasks. The mockup's recurring/workflow templates
// and drag-and-drop have no store yet and are shown as honest states / click-based
// equivalents rather than fabricated.
/* eslint-disable @typescript-eslint/no-explicit-any */

const card = "bg-white rounded-xl border border-gray-200";
const dash = (n: number | null | undefined) => (n == null ? "—" : n.toLocaleString());
const relTime = (iso?: string | null) => { if (!iso) return ""; const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000); if (s < 60) return "just now"; if (s < 3600) return `${Math.floor(s / 60)}m ago`; if (s < 86400) return `${Math.floor(s / 3600)}h ago`; return `${Math.floor(s / 86400)}d ago`; };
const tc = (s: string) => (s ?? "").replace(/_/g, " ").replace(/\b\w/g, m => m.toUpperCase());
const scoreTone = (n: number | null) => (n == null ? "text-gray-300" : n >= 90 ? "text-green-600" : n >= 75 ? "text-amber-600" : "text-rose-600");
const PRIO_C: Record<string, string> = { Critical: "#ef4444", High: "#f59e0b", Medium: "#3b82f6", Low: "#22c55e" };

export default async function TaskCentre() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles, hospital_id").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.some(r => ["assessor", "hospital_admin", "super_admin"].includes(r))) redirect("/dashboard");
  const isSuper = roles.includes("super_admin");
  const hid = profile?.hospital_id ?? null;

  const [d, tpl] = await Promise.all([loadTaskCenter(admin, hid, isSuper), loadTaskTemplates(admin, hid, isSuper)]);
  const k = d.kpis, sla = d.execution.sla, wi = d.intelligence;

  const kpis = [
    ["Total Tasks", k.total, "All active tasks", ""],
    ["Overdue", k.overdue, `${k.overduePct}% of total`, k.overdue ? "text-rose-600" : ""],
    ["Due Soon (≤1hr)", k.dueSoon, `${k.dueSoonPct}% of total`, k.dueSoon ? "text-amber-600" : ""],
    ["In Progress", k.inProgress, `${k.inProgressPct}% of total`, "text-blue-600"],
    ["Completed", k.completed, `${k.completedPct ?? 0}% of total`, "text-green-600"],
    ["On Track (SLA)", sla.compliance == null ? "—" : `${sla.compliance}%`, `${sla.atRisk} at risk · ${sla.breached} breached`, scoreTone(sla.compliance)],
  ];

  const prioTotal = d.byPriority.reduce((n: number, p: any) => n + p.n, 0) || 1;
  const prioDonut = (() => { let acc = 0; const st: string[] = []; d.byPriority.forEach((p: any) => { const a = (acc / prioTotal) * 360, b = ((acc + p.n) / prioTotal) * 360; if (p.n) st.push(`${PRIO_C[p.label] ?? "#94a3b8"} ${a}deg ${b}deg`); acc += p.n; }); return st.length ? `conic-gradient(${st.join(", ")})` : "conic-gradient(#e5e7eb 0deg 360deg)"; })();

  return (
    <div data-wide className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Task Centre</h1>
          <p className="text-sm text-gray-500">Operational task coordination engine — assign, track and complete all tasks across the shift.</p>
        </div>
        <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-green-100 text-green-700 flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-green-500" />Live</span>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
        {kpis.map(([l, v, sub, tone]: any) => (
          <div key={l} className={`${card} p-4`}><p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide leading-tight">{l}</p><p className={`text-2xl font-bold mt-1 tabular-nums ${tone || "text-gray-900"}`}>{v}</p><p className="text-[10px] text-gray-400 truncate">{sub}</p></div>
        ))}
      </div>

      {/* Create/Assign · AI Copilot Suggestions · Shift Timeline */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className="space-y-4">
          <TaskConsole staff={d.pickers.staff} openTasks={d.pickers.openTasks} />
          <div className={`${card} p-5`}>
            <div className="flex items-center gap-1.5 mb-3"><span className="text-base">✨</span><h2 className="text-sm font-bold text-gray-900">AI Copilot Suggestions</h2></div>
            {d.aiSuggestions.length === 0 ? <p className="text-sm text-gray-400">No suggestions — tasks are balanced.</p> : (
              <div className="space-y-2">
                {d.aiSuggestions.map((s: any, i: number) => (
                  <div key={i} className="flex items-start gap-2 rounded-lg border border-gray-100 p-2.5">
                    <div className="min-w-0 flex-1"><p className="text-xs font-medium text-gray-800 leading-tight">{s.text}</p><p className="text-[10px] text-gray-400">{s.sub}</p></div>
                    <span className="text-[10px] font-semibold text-teal-700 border border-teal-200 rounded-full px-2 py-0.5 shrink-0">{s.action}</span>
                  </div>
                ))}
              </div>
            )}
            <p className="text-[10px] text-gray-400 mt-2">Rule-based over live task signals (unassigned high-priority, overdue urgent, due-soon).</p>
          </div>
        </div>

        <div className={`${card} p-5 xl:col-span-2`}>
          <h2 className="text-sm font-bold text-gray-900 mb-3">Shift Timeline</h2>
          <div className="grid sm:grid-cols-2 gap-x-6">
            {d.timeline.length === 0 ? <p className="text-sm text-gray-400">No task events yet.</p> : d.timeline.map((e: any, i: number) => (
              <div key={i} className="flex items-center gap-2.5 py-1.5">
                <span className="text-[11px] text-gray-400 tabular-nums w-14 shrink-0">{relTime(e.at)}</span>
                <span className={`w-2 h-2 rounded-full shrink-0 ${e.done ? "bg-green-500" : e.status === "in_progress" ? "bg-blue-500" : "bg-gray-300"}`} />
                <span className="text-xs text-gray-700 truncate flex-1">{e.label}</span>
                <span className="text-[9px] text-gray-400 shrink-0">{tc(e.status)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Task Board (Kanban) */}
      <TaskBoard columns={d.kanban} editable={true} />

      {/* Workflow & Automation */}
      <WorkflowPanel provisioned={tpl?.provisioned !== false} templates={(tpl as any)?.templates ?? []} editable={true} />

      {/* Task Summary · Overdue · My Workload · Performance */}
      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className={`${card} p-5`}>
          <h2 className="text-sm font-bold text-gray-900 mb-3">Task Summary by Priority</h2>
          <div className="flex items-center gap-4">
            <div className="relative w-20 h-20 shrink-0 rounded-full" style={{ background: prioDonut }}><div className="absolute inset-[9px] bg-white rounded-full flex flex-col items-center justify-center"><span className="text-base font-bold text-gray-900">{k.total}</span><span className="text-[8px] text-gray-400">total</span></div></div>
            <div className="text-xs space-y-1 flex-1">
              {d.byPriority.map((p: any) => (<div key={p.key} className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ background: PRIO_C[p.label] ?? "#94a3b8" }} /><span className="text-gray-600 flex-1">{p.label}</span><span className="font-semibold text-gray-800 tabular-nums">{p.n} <span className="text-gray-400 font-normal">{k.total ? Math.round((p.n / k.total) * 100) : 0}%</span></span></div>))}
            </div>
          </div>
        </div>

        <div className={`${card} p-5`}>
          <h2 className="text-sm font-bold text-gray-900 mb-3">Overdue Tasks <span className="text-rose-600 font-normal">({d.escalations.overdue})</span></h2>
          {d.escalations.escalatedTasks.length === 0 ? <p className="text-sm text-gray-400">✅ No overdue tasks.</p> : (
            <div className="space-y-1.5">
              {d.escalations.escalatedTasks.slice(0, 5).map((t: any, i: number) => (
                <div key={i} className="flex items-center gap-2 rounded-lg border border-gray-100 px-2 py-1.5"><div className="min-w-0 flex-1"><p className="text-xs text-gray-800 truncate">{t.desc}{t.bed ? ` · ${t.bed}` : ""}</p><p className="text-[9px] text-gray-400">{tc(t.type ?? "task")}</p></div><span className="text-[10px] font-semibold text-rose-600 shrink-0">+{t.overdueMin}m</span></div>
              ))}
            </div>
          )}
        </div>

        <div className={`${card} p-5`}>
          <h2 className="text-sm font-bold text-gray-900 mb-3">My Workload</h2>
          {d.assignment.teamWorkload.length === 0 ? <p className="text-sm text-gray-400">No assigned tasks.</p> : (
            <div className="space-y-2">
              {d.assignment.teamWorkload.slice(0, 6).map((w: any, i: number) => (
                <div key={i}><div className="flex items-center justify-between text-xs mb-0.5"><span className="text-gray-600 truncate">{w.name}</span><span className="tabular-nums text-gray-500">{w.n} task{w.n === 1 ? "" : "s"}</span></div><div className="h-1.5 bg-gray-100 rounded-full overflow-hidden"><div className={`h-full rounded-full ${w.n >= d.assignment.maxLoad ? "bg-rose-500" : w.n >= d.assignment.maxLoad * 0.6 ? "bg-amber-500" : "bg-green-500"}`} style={{ width: `${(w.n / d.assignment.maxLoad) * 100}%` }} /></div></div>
              ))}
            </div>
          )}
        </div>

        <div className={`${card} p-5`}>
          <h2 className="text-sm font-bold text-gray-900 mb-3">Task Performance <span className="text-gray-400 font-normal">· today</span></h2>
          <div className="flex flex-col items-center">
            <div className="relative w-24 h-24 rounded-full" style={{ background: `conic-gradient(${wi.completionRate != null && wi.completionRate >= 90 ? "#22c55e" : wi.completionRate != null && wi.completionRate >= 75 ? "#f59e0b" : "#ef4444"} ${(wi.completionRate ?? 0) * 3.6}deg, #e5e7eb ${(wi.completionRate ?? 0) * 3.6}deg 360deg)` }}><div className="absolute inset-[10px] bg-white rounded-full flex flex-col items-center justify-center"><span className={`text-lg font-bold ${scoreTone(wi.completionRate)}`}>{wi.completionRate == null ? "—" : `${wi.completionRate}%`}</span><span className="text-[8px] text-gray-400">completion</span></div></div>
            <p className="text-[11px] text-gray-400 mt-2">Target 90% · {sla.atRisk} at risk · <span className="text-rose-600">{sla.breached} breached</span></p>
          </div>
        </div>
      </div>

      {/* Integration & Automation */}
      <div className={`${card} p-4`}>
        <h2 className="text-sm font-bold text-gray-900 mb-2">Integration &amp; Automation</h2>
        <div className="flex flex-wrap gap-2">
          {[["🧭 Patient Operations", "Auto-tasks from events"], ["👥 Workforce Operations", "Competency & availability"], ["💬 Communications", "Alerts & notifications"], ["🛡️ Quality & Safety", "Incidents & CAPA tasks"], ["✨ AI Copilot Active", "Real-time recommendations"]].map(([t, s]: any) => (
            <div key={t} className="rounded-lg border border-gray-100 bg-gray-50/60 px-2.5 py-1.5"><p className="text-[11px] font-medium text-gray-700">{t}</p><p className="text-[9px] text-gray-400">{s}</p></div>
          ))}
        </div>
      </div>

      <p className="text-[11px] text-gray-400 pb-4">The Task Centre is the operational task coordination engine (SSW-TSK-001) — a live KPI band, an interactive Kanban Task Board over the real op_tasks lifecycle (New → Accepted → In Progress → Awaiting Review → Completed), AI copilot suggestions, priority summary, overdue tracking, workload and completion performance — all live from op_tasks with audited lifecycle transitions and coordinator sign-off on verify. Recurring tasks, workflow templates and drag-and-drop have no store yet and are shown as honest states / click-based equivalents rather than fabricated.</p>
    </div>
  );
}
