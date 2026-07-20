import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadShiftCommand, fmtTime, titleCase } from "@/lib/operations/shift-command";

export const dynamic = "force-dynamic";

// Today's Priorities (Shift Command SS §2) — the operational task manager for the
// shift. Priorities are derived live from real signals across the spec's five
// categories (Patient Safety, Workforce, Operations, Documentation, Compliance)
// plus the shift's op_tasks. Completion is measured against real tasks. The AI
// prioritiser is rule-based, not a black box.
/* eslint-disable @typescript-eslint/no-explicit-any */

const NONE = "00000000-0000-0000-0000-000000000000";
const card = "bg-white rounded-xl border border-gray-200 p-5";
const CATS = ["Patient Safety", "Workforce", "Operations", "Documentation", "Compliance"];
const SEV_TONE: Record<string, string> = { critical: "bg-red-100 text-red-700", high: "bg-orange-100 text-orange-700", medium: "bg-amber-100 text-amber-700" };
const SEV_DOT: Record<string, string> = { critical: "bg-red-500", high: "bg-orange-500", medium: "bg-amber-500" };

export default async function TodaysPriorities() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles, hospital_id").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.some((r: string) => ["assessor", "hospital_admin", "super_admin"].includes(r))) redirect("/dashboard");
  const isSuper = roles.includes("super_admin");
  const hid = profile?.hospital_id ?? null;

  const sc = await loadShiftCommand(admin, hid, isSuper);
  if (!sc.ready) return (
    <div className="space-y-4"><h1 className="text-2xl font-bold text-gray-900">Today&apos;s Priorities</h1>
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-6"><p className="font-semibold text-amber-900">⚙️ Coming online</p><p className="text-sm text-amber-800 mt-2">The Clinical Operations Engine tables aren&apos;t provisioned yet.</p></div></div>
  );

  // Real task completion (scoped to the active shift where available).
  const tScope = (q: any) => (sc.shiftId ? q.eq("shift_id", sc.shiftId) : (isSuper ? q : q.eq("hospital_id", hid ?? NONE)));
  const [{ count: taskTotal }, { count: taskDone }] = await Promise.all([
    tScope(admin.from("op_tasks").select("id", { count: "exact", head: true })).neq("status", "cancelled"),
    tScope(admin.from("op_tasks").select("id", { count: "exact", head: true })).in("status", ["completed", "verified"]),
  ]);
  const completion = taskTotal ? Math.round(((taskDone ?? 0) / taskTotal) * 100) : null;

  const { priorities, counts, copilot, tasks } = sc;
  const byCat = (c: string) => priorities.filter((p: any) => p.category === c).length;
  const summary = [
    { label: "Critical", n: counts.critical, tone: "text-red-600" },
    { label: "High", n: counts.high, tone: "text-orange-600" },
    { label: "Medium", n: counts.medium, tone: "text-amber-600" },
    { label: "Overdue", n: counts.overdue, tone: counts.overdue ? "text-red-600" : "text-gray-400" },
    { label: "Completed", n: taskDone ?? 0, tone: "text-green-600" },
  ];

  // Kanban columns.
  const critical = priorities.filter((p: any) => p.severity === "critical");
  const high = priorities.filter((p: any) => p.severity === "high");
  const scheduled = priorities.filter((p: any) => p.severity === "medium");

  const PrioCard = ({ p }: { p: any }) => (
    <Link href={p.href} className="block rounded-lg border border-gray-100 hover:border-teal-300 hover:bg-teal-50/30 px-3 py-2 transition-colors">
      <div className="flex items-center gap-2">
        <span className={`text-[9px] px-1.5 py-0.5 rounded ${SEV_TONE[p.severity]}`}>{titleCase(p.severity)}</span>
        <span className="text-[10px] text-gray-400">{p.category}</span>
      </div>
      <p className="text-sm text-gray-800 leading-tight mt-1">{p.title}</p>
      <p className="text-[11px] text-gray-400 truncate">{[p.owner, p.due ? `due ${fmtTime(p.due)}` : null, p.sub].filter(Boolean).join(" · ")}</p>
    </Link>
  );

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Today&apos;s Priorities</h1>
        <p className="text-sm text-gray-500 mt-1">Dynamic task &amp; risk management for the shift</p>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {summary.map(s => (
          <div key={s.label} className={card + " py-4"}><p className={`text-3xl font-bold tabular-nums ${s.tone}`}>{s.n}</p><p className="text-xs text-gray-500 mt-1">{s.label}</p></div>
        ))}
        <div className={card + " py-4"}>
          <p className="text-3xl font-bold tabular-nums text-teal-600">{completion == null ? "—" : `${completion}%`}</p>
          <p className="text-xs text-gray-500 mt-1">Shift progress</p>
          {completion != null && <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden mt-1.5"><div className="h-full bg-teal-500 rounded-full" style={{ width: `${completion}%` }} /></div>}
        </div>
      </div>

      {/* Category chips */}
      <div className="flex flex-wrap gap-2">
        <span className="text-xs bg-gray-900 text-white rounded-full px-3 py-1">All {priorities.length}</span>
        {CATS.map(c => <span key={c} className="text-xs bg-white border border-gray-200 text-gray-600 rounded-full px-3 py-1">{c} {byCat(c)}</span>)}
      </div>

      {/* Kanban */}
      <div className="grid md:grid-cols-2 xl:grid-cols-4 gap-4">
        {[["Critical", critical], ["High", high], ["Scheduled", scheduled]].map(([title, list]) => (
          <div key={title as string} className={card}>
            <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2"><span className={`w-2 h-2 rounded-full ${SEV_DOT[(title as string).toLowerCase()] ?? "bg-gray-300"}`} />{title as string} <span className="text-gray-400 font-normal">({(list as any[]).length})</span></h3>
            <div className="space-y-2 max-h-[28rem] overflow-y-auto">
              {(list as any[]).length === 0 && <p className="text-sm text-gray-400">Nothing here.</p>}
              {(list as any[]).map((p, i) => <PrioCard key={i} p={p} />)}
            </div>
          </div>
        ))}
        {/* Completed column — real completed/open task ledger */}
        <div className={card}>
          <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-green-500" />Completed <span className="text-gray-400 font-normal">({taskDone ?? 0})</span></h3>
          <div className="space-y-2 max-h-[28rem] overflow-y-auto">
            <p className="text-sm text-gray-500">{taskDone ?? 0} of {taskTotal ?? 0} shift tasks complete.</p>
            <div className="pt-2 border-t border-gray-100">
              <p className="text-[11px] font-semibold text-gray-400 uppercase mb-1.5">Open tasks</p>
              {tasks.length === 0 && <p className="text-sm text-gray-400">No open tasks.</p>}
              {tasks.slice(0, 8).map((t: any) => (
                <div key={t.id} className="flex items-center gap-2 py-1 text-sm">
                  <span className="text-xs text-gray-400 tabular-nums w-11 shrink-0">{t.due_at ? fmtTime(t.due_at) : "--:--"}</span>
                  <span className="text-gray-700 truncate flex-1">{t.description}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* AI Prioritiser */}
      <div className={card}>
        <h3 className="font-semibold text-gray-900 flex items-center gap-2 mb-3">✨ AI Prioritiser <span className="text-[10px] font-normal text-gray-400">rule-based, from live data</span></h3>
        <div className="grid sm:grid-cols-2 gap-2">
          {critical.slice(0, 2).map((p: any, i: number) => (
            <div key={"c" + i} className="flex items-center gap-2 text-sm rounded-lg bg-red-50/50 border border-red-100 px-3 py-2"><span className="text-red-500">▲</span><span className="text-gray-700 flex-1 truncate">Escalate now: {p.title}</span></div>
          ))}
          {copilot.slice(0, 4).map((c: any, i: number) => (
            <div key={i} className="flex items-center gap-2 text-sm rounded-lg border border-gray-100 px-3 py-2">
              <span className="text-gray-700 flex-1 truncate">{c.text}</span>
              <Link href={c.href} className="text-[11px] font-medium text-teal-700 shrink-0 hover:underline">{c.action} →</Link>
            </div>
          ))}
          {critical.length === 0 && copilot.length === 0 && <p className="text-sm text-gray-400">No reprioritisation needed — work is on track.</p>}
        </div>
      </div>
    </div>
  );
}
