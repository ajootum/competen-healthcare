import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { generateAssessorQueue } from "@/lib/engines/tasks";
import InboxTable, { type InboxRow } from "./InboxTable";

// Assessment Inbox (Assessment Inbox Redesign spec): the queue engine's
// prioritised tasks in a productivity table with KPIs, tabs and filters, plus
// a deadlines rail and assessment-type breakdown. Due dates come from real
// scheduled sessions; estimated workload from the engine's effort model.

const nowMs = () => Date.now();

export default async function AssessmentInboxPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();
  const { data: profile } = await admin.from("profiles").select("role, hospital_id").eq("id", user.id).single();
  if (!profile || !["assessor", "educator", "hospital_admin"].includes(profile.role)) redirect("/dashboard");

  const nowIso = new Date().toISOString();
  const monthKey = nowIso.slice(0, 7);
  const in7 = new Date(nowMs() + 7 * 86400000).toISOString();
  const in14 = new Date(nowMs() + 14 * 86400000).toISOString();

  let queue: Awaited<ReturnType<typeof generateAssessorQueue>> = { tasks: [], workload: { tasks: 0, estMinutes: 0, learners: 0, urgent: 0 } };
  try {
    queue = await generateAssessorQueue(admin, profile.hospital_id ?? "", user.id);
  } catch { /* requirement matrix not installed yet */ }

  const [{ data: sessions }, { data: myAssessments }, { data: myPending }] = await Promise.all([
    admin.from("scheduled_assessments")
      .select("nurse_id, scheduled_for, status")
      .eq("assessor_id", user.id).eq("status", "scheduled")
      .order("scheduled_for"),
    admin.from("assessments").select("id, status, assessed_at").eq("assessor_id", user.id),
    admin.from("assessments")
      .select(`id, method, status,
        competency_cycles!cycle_id(id, profiles!nurse_id(id, full_name)),
        framework_competencies!competency_id(name)`)
      .eq("assessor_id", user.id).in("status", ["pending", "in_progress"])
      .order("created_at").limit(12),
  ]);

  // Per-learner scheduling: next upcoming session + any past-due session
  const nextSession = new Map<string, string>();
  const hasOverdue = new Set<string>();
  for (const s of sessions ?? []) {
    if (s.scheduled_for < nowIso) hasOverdue.add(s.nurse_id);
    else if (!nextSession.has(s.nurse_id)) nextSession.set(s.nurse_id, s.scheduled_for);
  }

  // Learners with a formal assessment already underway
  const inProgressNurses = new Set<string>();
  for (const a of myPending ?? []) {
    const cyc = a.competency_cycles as unknown as { profiles: { id: string } | null } | null;
    if (a.status === "in_progress" && cyc?.profiles?.id) inProgressNurses.add(cyc.profiles.id);
  }

  const rows: InboxRow[] = queue.tasks.map(t => ({
    nurseId: t.nurseId, nurseName: t.nurseName, department: t.department,
    cpuName: t.cpuName, type: t.type, reason: t.reason,
    priority: t.priority, readiness: t.readiness, estMinutes: t.estMinutes,
    methods: t.methods,
    dueDate: nextSession.get(t.nurseId) ?? null,
    overdue: hasOverdue.has(t.nurseId),
    inProgress: inProgressNurses.has(t.nurseId),
  }));

  const highPriority = rows.filter(r => r.priority <= 3).length;
  const dueThisWeek = (sessions ?? []).filter(s => s.scheduled_for >= nowIso && s.scheduled_for <= in7).length;
  const overdueSessions = (sessions ?? []).filter(s => s.scheduled_for < nowIso).length;
  const completedMonth = (myAssessments ?? []).filter(a => a.status === "complete" && a.assessed_at?.slice(0, 7) === monthKey).length;
  const estHours = Math.round((queue.workload.estMinutes / 60) * 10) / 10;

  const KPIS = [
    { icon: "🗂️", value: String(rows.length), label: "Total Assessments", sub: "in your inbox", tint: "bg-indigo-50" },
    { icon: "🔥", value: String(highPriority), label: "High Priority", sub: "require attention", tint: "bg-red-50" },
    { icon: "📅", value: String(dueThisWeek), label: "Due This Week", sub: "scheduled sessions", tint: "bg-blue-50" },
    { icon: "✅", value: String(completedMonth), label: "Completed", sub: "this month", tint: "bg-green-50" },
    { icon: "⏱️", value: `~${estHours}h`, label: "Est. Workload", sub: "engine effort model", tint: "bg-amber-50" },
  ];

  // Deadlines rail: sessions today / this week / next week
  const dayEnd = new Date(); dayEnd.setHours(23, 59, 59, 999);
  const todayDue = (sessions ?? []).filter(s => s.scheduled_for >= nowIso && s.scheduled_for <= dayEnd.toISOString()).length;
  const nextWeekDue = (sessions ?? []).filter(s => s.scheduled_for > in7 && s.scheduled_for <= in14).length;

  // Assessment-type breakdown (donut data)
  const typeCounts = new Map<string, number>();
  for (const r of rows) typeCounts.set(r.type, (typeCounts.get(r.type) ?? 0) + 1);
  const TYPE_META: Record<string, { label: string; color: string }> = {
    full_cpu: { label: "Full CPU", color: "#14b8a6" },
    focused: { label: "Gap Closure", color: "#f59e0b" },
    renewal: { label: "Renewal", color: "#8b5cf6" },
    remediation: { label: "Remediation", color: "#ef4444" },
    entrustment: { label: "Entrustment", color: "#3b82f6" },
  };
  const donut = [...typeCounts.entries()].map(([type, n]) => ({
    ...(TYPE_META[type] ?? { label: type, color: "#9ca3af" }), n,
    pct: rows.length ? (n / rows.length) * 100 : 0,
  })).sort((a, b) => b.n - a.n);
  const C = 2 * Math.PI * 40;
  const arcs = donut.reduce<((typeof donut)[number] & { offset: number })[]>((list, d) => {
    const prev = list[list.length - 1];
    return [...list, { ...d, offset: prev ? prev.offset + prev.pct : 0 }];
  }, []);

  return (
    <div className="max-w-[1400px]">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Assessment Inbox</h1>
          <p className="text-gray-400 text-sm mt-0.5">Prioritised assessments awaiting your review and action.</p>
        </div>
        <Link href="/assessor/assess"
          className="text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg transition-colors">
          ＋ Conduct Assessment
        </Link>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-3 mb-5">
        {KPIS.map(k => (
          <div key={k.label} className="bg-white border border-gray-100 rounded-2xl p-4">
            <span className={`w-9 h-9 rounded-xl ${k.tint} flex items-center justify-center text-lg`}>{k.icon}</span>
            <p className="text-2xl font-extrabold text-gray-900 mt-2 leading-none">{k.value}</p>
            <p className="text-[11px] font-semibold text-gray-700 mt-1 leading-tight">{k.label}</p>
            <p className="text-[10px] text-gray-400">{k.sub}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_280px] gap-5 items-start">
        <div className="min-w-0 flex flex-col gap-4">
          <InboxTable rows={rows} />

          {/* Overdue banner */}
          {overdueSessions > 0 && (
            <div className="bg-red-50 border border-red-100 rounded-xl px-4 py-3 flex items-center gap-3">
              <span className="text-lg shrink-0">🔴</span>
              <p className="text-xs font-semibold text-red-800 flex-1">
                {overdueSessions} scheduled session{overdueSessions === 1 ? "" : "s"} past due — complete or reschedule.
              </p>
              <Link href="/assessor/calendar"
                className="text-[11px] font-semibold bg-red-600 hover:bg-red-700 text-white px-3 py-1.5 rounded-lg transition-colors shrink-0">
                View Overdue →
              </Link>
            </div>
          )}

          {/* Formally assigned records */}
          {(myPending ?? []).length > 0 && (
            <div className="bg-white border border-gray-100 rounded-2xl overflow-hidden">
              <div className="px-5 py-3 border-b border-gray-100">
                <h2 className="text-sm font-bold text-gray-900">Formally Assigned to Me</h2>
                <p className="text-[10px] text-gray-400">Assessment records already created, awaiting your score</p>
              </div>
              <div className="divide-y divide-gray-50">
                {(myPending ?? []).map(a => {
                  const cyc = a.competency_cycles as unknown as { id: string; profiles: { full_name: string } | null } | null;
                  const comp = a.framework_competencies as unknown as { name: string } | null;
                  return (
                    <Link key={a.id} href={cyc?.id ? `/assessor/cycle/${cyc.id}` : "/assessor/assess"}
                      className="px-5 py-2.5 flex items-center gap-3 hover:bg-gray-50 transition-colors">
                      <p className="text-sm text-gray-800 flex-1 min-w-0 truncate">
                        <b>{cyc?.profiles?.full_name ?? "—"}</b> · {comp?.name ?? "Competency"}
                        <span className="text-gray-400 capitalize"> · {a.method.replace(/_/g, " ")}</span>
                      </p>
                      <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded shrink-0 ${
                        a.status === "in_progress" ? "bg-blue-50 text-blue-600" : "bg-amber-50 text-amber-700"
                      }`}>{a.status === "in_progress" ? "In progress" : "Pending"}</span>
                      <span className="text-gray-300 shrink-0">›</span>
                    </Link>
                  );
                })}
              </div>
            </div>
          )}

          <p className="text-[10px] text-gray-300">
            Prioritised by the queue engine (remediation → entrustment → renewals → gaps → full assessments).
            Due dates appear when a session is scheduled.
          </p>
        </div>

        {/* Right rail */}
        <div className="flex flex-col gap-4">
          <div className="bg-white border border-gray-100 rounded-2xl p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-xs font-bold text-gray-800">Upcoming Deadlines</h2>
              <Link href="/assessor/calendar" className="text-[10px] font-semibold text-indigo-600 hover:underline">View Calendar</Link>
            </div>
            <div className="flex flex-col gap-2">
              {[
                { label: "Today", n: todayDue, cls: "bg-red-500" },
                { label: "This Week", n: dueThisWeek, cls: "bg-amber-500" },
                { label: "Next Week", n: nextWeekDue, cls: "bg-blue-500" },
              ].map(d => (
                <div key={d.label} className="flex items-center gap-2.5">
                  <span className={`w-5 h-5 rounded-full ${d.cls} text-white text-[10px] font-bold flex items-center justify-center shrink-0`}>{d.n}</span>
                  <span className="text-xs font-semibold text-gray-700 flex-1">{d.label}</span>
                  <span className="text-[10px] text-gray-400">{d.n} session{d.n === 1 ? "" : "s"} due</span>
                </div>
              ))}
            </div>
            <Link href="/assessor/calendar"
              className="block mt-3 text-center text-[11px] font-semibold text-indigo-700 border border-indigo-200 hover:bg-indigo-50 py-2 rounded-lg transition-colors">
              📅 View Full Calendar
            </Link>
          </div>

          <div className="bg-white border border-gray-100 rounded-2xl p-4">
            <h2 className="text-xs font-bold text-gray-800 mb-3">Assessment Types</h2>
            {rows.length === 0 ? (
              <p className="text-[10px] text-gray-400">No queued assessments to break down.</p>
            ) : (
              <>
                <div className="relative w-28 mx-auto">
                  <svg viewBox="0 0 100 100" className="w-full -rotate-90">
                    <circle cx="50" cy="50" r="40" fill="none" stroke="#f3f4f6" strokeWidth="12" />
                    {arcs.filter(a => a.pct > 0).map(a => (
                      <circle key={a.label} cx="50" cy="50" r="40" fill="none" stroke={a.color} strokeWidth="12"
                        strokeDasharray={`${(a.pct / 100) * C} ${C}`} strokeDashoffset={-(a.offset / 100) * C} />
                    ))}
                  </svg>
                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <p className="text-lg font-extrabold text-gray-900 leading-none">{rows.length}</p>
                    <p className="text-[9px] text-gray-400">tasks</p>
                  </div>
                </div>
                <div className="mt-3 flex flex-col gap-1">
                  {donut.map(d => (
                    <div key={d.label} className="flex items-center gap-2 text-[11px]">
                      <span className="w-2 h-2 rounded-full shrink-0" style={{ background: d.color }} />
                      <span className="text-gray-500 flex-1">{d.label}</span>
                      <span className="font-semibold text-gray-700">{d.n} ({Math.round(d.pct)}%)</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
