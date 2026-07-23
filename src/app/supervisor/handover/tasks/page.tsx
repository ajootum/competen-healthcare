import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadHandoverContext } from "@/lib/operations/handover";
import HandoverNav from "../HandoverNav";

export const dynamic = "force-dynamic";

// Handover Tasks (SSW-HC-010) — outstanding actions across the shift for continuity of
// care, over the live op_tasks store (joined to patients). Read view: KPIs, task table
// with priority/due/status/source, overview donut, overdue + follow-up lists. Mutations
// live in the Task Centre; this is the handover-scoped lens.
/* eslint-disable @typescript-eslint/no-explicit-any */

const card = "bg-white rounded-xl border border-gray-200";
const PRI: Record<string, string> = { urgent: "bg-rose-50 text-rose-700", high: "bg-amber-50 text-amber-700", normal: "bg-gray-100 text-gray-600", low: "bg-gray-50 text-gray-500" };
const nowIso = () => new Date().toISOString();
const relDue = (iso?: string | null) => { if (!iso) return "—"; const s = Math.floor((new Date(iso).getTime() - Date.now()) / 1000); const a = Math.abs(s); const t = a < 3600 ? `${Math.max(1, Math.floor(a / 60))}m` : a < 86400 ? `${Math.floor(a / 3600)}h` : `${Math.floor(a / 86400)}d`; return s < 0 ? `${t} overdue` : `in ${t}`; };

function Kpi({ label, value, sub, tone }: { label: string; value: any; sub?: string; tone?: string }) {
  return <div className={`${card} p-3.5`}><p className="text-[10px] text-gray-500 uppercase tracking-wide">{label}</p><p className={`text-2xl font-bold tabular-nums mt-0.5 ${tone ?? "text-gray-900"}`}>{value}</p>{sub && <p className="text-[10px] text-gray-400">{sub}</p>}</div>;
}

export default async function HandoverTasks() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles, hospital_id").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.some((r: string) => ["assessor", "hospital_admin", "super_admin"].includes(r))) redirect("/dashboard");
  const isSuper = roles.includes("super_admin");

  const d = await loadHandoverContext(admin, profile?.hospital_id ?? null, isSuper);
  // Completed-today count (open-task loader excludes completed) — honest real metric.
  let completedToday = 0;
  try { const since = new Date(Date.now() - 12 * 3600e3).toISOString(); const q = admin.from("op_tasks").select("id", { count: "exact", head: true }).eq("status", "completed").gte("completed_at", since); const { count } = await (isSuper ? q : q.eq("hospital_id", profile?.hospital_id ?? "00000000-0000-0000-0000-000000000000")); completedToday = count ?? 0; } catch { /* honest 0 */ }

  const header = (<><div className="flex items-center gap-2"><span className="text-xl">🗒️</span><div><h1 className="text-2xl font-bold text-gray-900 tracking-tight">Handover Tasks</h1><p className="text-sm text-gray-500">Track, assign and follow up tasks across shifts to ensure continuity of care.</p></div></div><HandoverNav /></>);
  if (!d.ready) return <div className="space-y-4">{header}<div className="bg-amber-50 border border-amber-200 rounded-xl p-6"><p className="font-semibold text-amber-900">⚙️ Operational data not provisioned</p></div></div>;

  const tasks = d.tasks;
  const overdue = tasks.filter((t: any) => t.due_at && t.due_at < nowIso());
  const due2h = tasks.filter((t: any) => t.due_at && t.due_at >= nowIso() && new Date(t.due_at).getTime() - Date.now() < 2 * 3600e3);
  const mine = tasks.filter((t: any) => t.assigned_to === user.id);
  const byStatus = ["created", "assigned", "accepted", "in_progress"].map(s => ({ label: s.replace(/_/g, " "), n: tasks.filter((t: any) => t.status === s).length })).filter(x => x.n);
  const sorted = [...tasks].sort((a: any, b: any) => ((a.due_at ?? "9") < (b.due_at ?? "9") ? -1 : 1));

  return (
    <div className="space-y-4">
      {header}
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
        <Kpi label="Total Active" value={tasks.length} sub="Across all patients" />
        <Kpi label="Overdue" value={overdue.length} sub="Require attention" tone={overdue.length ? "text-rose-600" : undefined} />
        <Kpi label="Due Within 2h" value={due2h.length} sub="High priority" tone={due2h.length ? "text-amber-600" : undefined} />
        <Kpi label="Completed" value={completedToday} sub="Last 12h" tone="text-emerald-600" />
        <Kpi label="Assigned to Me" value={mine.length} sub="My responsibility" />
        <Kpi label="Urgent" value={tasks.filter((t: any) => t.priority === "urgent").length} sub="Priority" tone={tasks.some((t: any) => t.priority === "urgent") ? "text-rose-600" : undefined} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className={`${card} p-5 xl:col-span-2`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">All Tasks</h3>
          {sorted.length === 0 ? <div className="text-center py-8"><p className="text-3xl mb-2">✅</p><p className="text-sm text-gray-500">No outstanding tasks.</p></div> : (
            <div className="overflow-x-auto"><table className="w-full text-xs"><thead><tr className="text-gray-400 text-left border-b border-gray-100"><th className="py-2 pr-3 font-medium">Task</th><th className="py-2 pr-3 font-medium">Patient</th><th className="py-2 pr-3 font-medium">Priority</th><th className="py-2 pr-3 font-medium">Assigned</th><th className="py-2 pr-3 font-medium">Due</th><th className="py-2 font-medium">Status</th></tr></thead>
              <tbody>{sorted.slice(0, 12).map((t: any) => (<tr key={t.id} className="border-b border-gray-50 hover:bg-gray-50/50"><td className="py-2 pr-3 text-gray-800 font-medium max-w-[180px] truncate">{t.description}</td><td className="py-2 pr-3 text-gray-600">{t.op_patients?.label ?? "—"}</td><td className="py-2 pr-3"><span className={`px-1.5 py-0.5 rounded text-[10px] capitalize ${PRI[t.priority] ?? PRI.normal}`}>{t.priority}</span></td><td className="py-2 pr-3 text-gray-600 truncate max-w-[90px]">{t.profiles?.full_name ?? "Unassigned"}</td><td className={`py-2 pr-3 whitespace-nowrap ${t.due_at && t.due_at < nowIso() ? "text-rose-600 font-semibold" : "text-gray-500"}`}>{relDue(t.due_at)}</td><td className="py-2 text-gray-600 capitalize">{t.status.replace(/_/g, " ")}</td></tr>))}</tbody></table>
              <p className="text-[10px] text-gray-400 mt-2">Showing {Math.min(12, sorted.length)} of {sorted.length}. From the live Task Centre, handover-scoped.</p>
            </div>)}
        </div>
        <div className="space-y-4">
          <div className={`${card} p-5`}><h3 className="text-sm font-bold text-gray-900 mb-3">Task Overview</h3><div className="space-y-2">{byStatus.map(x => (<div key={x.label} className="text-xs"><div className="flex items-center justify-between mb-0.5"><span className="text-gray-700 capitalize">{x.label}</span><span className="text-gray-400">{x.n}</span></div><div className="w-full h-1.5 rounded-full bg-gray-100 overflow-hidden"><div className="h-full rounded-full bg-emerald-500" style={{ width: `${tasks.length ? (x.n / tasks.length) * 100 : 0}%` }} /></div></div>))}{overdue.length > 0 && <div className="text-xs"><div className="flex items-center justify-between mb-0.5"><span className="text-rose-600">overdue</span><span className="text-gray-400">{overdue.length}</span></div><div className="w-full h-1.5 rounded-full bg-gray-100 overflow-hidden"><div className="h-full rounded-full bg-rose-500" style={{ width: `${tasks.length ? (overdue.length / tasks.length) * 100 : 0}%` }} /></div></div>}</div></div>
          <div className={`${card} p-5`}><h3 className="text-sm font-bold text-gray-900 mb-3">Overdue Tasks</h3>{overdue.length === 0 ? <p className="text-sm text-gray-400">None overdue. 🎉</p> : <div className="space-y-1.5">{overdue.slice(0, 5).map((t: any) => (<div key={t.id} className="flex items-center gap-2 text-xs"><span className="text-rose-500">⏰</span><span className="text-gray-700 flex-1 truncate">{t.description}</span><span className="text-rose-600 whitespace-nowrap">{relDue(t.due_at)}</span></div>))}</div>}</div>
        </div>
      </div>
      <p className="text-[11px] text-gray-400 pb-4">Handover Tasks (SSW-HC-010) is the handover-scoped lens over the live op_tasks store — outstanding medications, investigations, reviews and nursing actions with priority, due time and assignment. Task creation/assignment lives in the <Link href="/supervisor/task-center" className="text-emerald-700 hover:underline">Task Centre</Link>. <Link href="/supervisor/handover" className="text-emerald-700 hover:underline">← Handover Centre</Link></p>
    </div>
  );
}
