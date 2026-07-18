import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import ScheduleForm, { type NurseOpt } from "./ScheduleForm";
import SessionActions from "./SessionActions";
import { findConflicts, type SchedSession } from "@/lib/engines/schedule";

// Assessment Calendar (Assessment Calendar spec): the planning workspace —
// month grid or agenda view with method/status filters, KPI summary, assessor
// workload, conflict detection and scheduling. Drag-and-drop, recurring
// sessions, rooms, holidays and bulk scheduling have no backing stores yet.

const METHOD_LABELS: Record<string, string> = {
  direct_observation: "Direct Observation", knowledge: "Knowledge", simulation: "Simulation",
  osce: "OSCE", concurrent_audit: "Concurrent Audit", retrospective_audit: "Chart Audit", logbook: "Logbook",
};

export default async function AssessmentCalendarPage({ searchParams }: {
  searchParams: Promise<{ month?: string; view?: string; m?: string; s?: string }>;
}) {
  const { month, view, m: methodFilter, s: statusFilter } = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();
  const { data: profile } = await admin.from("profiles").select("role, hospital_id").eq("id", user.id).single();
  if (!profile || !["assessor", "educator", "hospital_admin"].includes(profile.role)) redirect("/dashboard");

  // Month window (?month=YYYY-MM, defaults to current)
  const base = /^\d{4}-\d{2}$/.test(month ?? "") ? new Date(`${month}-01T00:00:00`) : new Date();
  base.setDate(1); base.setHours(0, 0, 0, 0);
  const monthKey = `${base.getFullYear()}-${String(base.getMonth() + 1).padStart(2, "0")}`;
  const monthLabel = base.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  const prev = new Date(base); prev.setMonth(prev.getMonth() - 1);
  const next = new Date(base); next.setMonth(next.getMonth() + 1);
  const fmtKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  const monthEnd = new Date(base); monthEnd.setMonth(monthEnd.getMonth() + 1);
  const nowIso = new Date().toISOString();
  const agenda = view === "agenda";
  const qs = (over: Record<string, string | undefined>) => {
    const params = { month: monthKey, view: agenda ? "agenda" : undefined, m: methodFilter, s: statusFilter, ...over };
    const str = Object.entries(params).filter(([, v]) => v).map(([k, v]) => `${k}=${v}`).join("&");
    return str ? `?${str}` : "";
  };

  const weekStart = new Date(); weekStart.setHours(0, 0, 0, 0);
  weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7));
  const weekEnd = new Date(weekStart); weekEnd.setDate(weekEnd.getDate() + 7);

  const [{ data: rawSessions }, { data: nurses }, { data: hospWeek }] = await Promise.all([
    admin.from("scheduled_assessments")
      .select("id, nurse_id, method, scheduled_for, location, note, status, profiles!nurse_id(full_name)")
      .eq("assessor_id", user.id)
      .gte("scheduled_for", base.toISOString()).lt("scheduled_for", monthEnd.toISOString())
      .order("scheduled_for"),
    admin.from("profiles").select("id, full_name")
      .eq("hospital_id", profile.hospital_id ?? "").eq("role", "nurse").order("full_name").limit(200),
    admin.from("scheduled_assessments")
      .select("id, nurse_id, assessor_id, scheduled_for, status, nurse:profiles!nurse_id(full_name), assessor:profiles!assessor_id(full_name)")
      .eq("hospital_id", profile.hospital_id ?? "")
      .gte("scheduled_for", weekStart.toISOString()).lt("scheduled_for", weekEnd.toISOString()),
  ]);

  type Session = { id: string; nurse_id: string; method: string; scheduled_for: string; location: string | null; note: string | null; status: string; profiles: { full_name: string } | null };
  const allRows = ((rawSessions ?? []) as unknown as Session[]);
  const rows = allRows.filter(s =>
    (!methodFilter || s.method === methodFilter) &&
    (!statusFilter || s.status === statusFilter));

  // KPI summary (unfiltered month)
  const KPIS = [
    { label: "Scheduled This Month", n: allRows.length, cls: "text-gray-900" },
    { label: "Upcoming", n: allRows.filter(s => s.status === "scheduled" && s.scheduled_for >= nowIso).length, cls: "text-blue-600" },
    { label: "Completed", n: allRows.filter(s => s.status === "completed").length, cls: "text-green-600" },
    { label: "Cancelled", n: allRows.filter(s => s.status === "cancelled").length, cls: "text-gray-400" },
    { label: "Overdue", n: allRows.filter(s => s.status === "scheduled" && s.scheduled_for < nowIso).length, cls: "text-red-600" },
  ];

  // Month grid (weeks start Monday)
  const firstDow = (base.getDay() + 6) % 7;
  const daysInMonth = new Date(base.getFullYear(), base.getMonth() + 1, 0).getDate();
  const cells: (number | null)[] = [
    ...Array.from({ length: firstDow }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);
  const byDay = new Map<number, Session[]>();
  for (const s of rows) {
    const day = new Date(s.scheduled_for).getDate();
    const list = byDay.get(day) ?? [];
    list.push(s);
    byDay.set(day, list);
  }
  const todayKey = nowIso.slice(0, 10);
  const upcoming = rows.filter(s => s.status === "scheduled" && s.scheduled_for >= nowIso);

  // Assessor workload (this week, hospital-wide) + conflicts
  type HospSession = { id: string; nurse_id: string; assessor_id: string; scheduled_for: string; status: string; nurse: { full_name: string } | null; assessor: { full_name: string } | null };
  const hosp = (hospWeek ?? []) as unknown as HospSession[];
  const workloadMap = new Map<string, { name: string; n: number }>();
  for (const s of hosp) {
    if (s.status === "cancelled") continue;
    const w = workloadMap.get(s.assessor_id) ?? { name: s.assessor?.full_name ?? "—", n: 0 };
    w.n++;
    workloadMap.set(s.assessor_id, w);
  }
  const workload = [...workloadMap.entries()]
    .map(([id, w]) => ({ id, ...w, isMe: id === user.id }))
    .sort((a, b) => b.n - a.n).slice(0, 5);
  const workloadMax = Math.max(1, ...workload.map(w => w.n));

  const conflicts = findConflicts(hosp.map(s => ({
    id: s.id, nurse_id: s.nurse_id, assessor_id: s.assessor_id,
    nurse_name: s.nurse?.full_name ?? "—", assessor_name: s.assessor?.full_name ?? "—",
    scheduled_for: s.scheduled_for, status: s.status,
  } satisfies SchedSession)));

  const copilotPrompt = `I'm a clinical assessor planning ${monthLabel}. Live calendar: ${allRows.length} sessions this month (${KPIS[1].n} upcoming, ${KPIS[2].n} completed, ${KPIS[4].n} overdue), ${conflicts.length} scheduling conflicts this week, assessor workload this week: ${workload.map(w => `${w.name}: ${w.n}`).join(", ") || "none"}. Suggest how to balance the workload and what to schedule next.`;

  return (
    <div className="max-w-[1400px]">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Assessment Calendar</h1>
          <p className="text-gray-400 text-sm mt-0.5">Plan, schedule and manage competency assessments across your organisation.</p>
        </div>
        <Link href="/assessor/schedule" className="text-xs font-semibold text-gray-500 border border-gray-200 bg-white hover:border-indigo-300 hover:text-indigo-700 px-3 py-2 rounded-lg transition-colors">
          🕐 Today&apos;s view →
        </Link>
      </div>

      {/* KPI summary */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-4">
        {KPIS.map(k => (
          <div key={k.label} className="bg-white border border-gray-100 rounded-2xl p-3.5">
            <p className={`text-2xl font-extrabold leading-none ${k.cls}`}>{k.n}</p>
            <p className="text-[10px] font-semibold text-gray-500 mt-1 leading-tight">{k.label}</p>
          </div>
        ))}
      </div>

      {/* View + filters bar */}
      <div className="bg-white border border-gray-100 rounded-2xl px-4 py-3 mb-4 flex flex-wrap items-center gap-2">
        <div className="flex gap-1">
          <Link href={`/assessor/calendar${qs({ view: undefined })}`}
            className={`text-xs font-semibold px-3 py-1.5 rounded-lg ${!agenda ? "bg-indigo-600 text-white" : "text-gray-500 hover:bg-gray-50"}`}>Month</Link>
          <Link href={`/assessor/calendar${qs({ view: "agenda" })}`}
            className={`text-xs font-semibold px-3 py-1.5 rounded-lg ${agenda ? "bg-indigo-600 text-white" : "text-gray-500 hover:bg-gray-50"}`}>Agenda</Link>
          <span className="text-xs text-gray-300 px-2 py-1.5 cursor-default" title="Week and Day views aren't available yet">Week · Day <span className="text-[8px] font-bold uppercase bg-gray-100 text-gray-400 rounded px-1 py-0.5">soon</span></span>
        </div>
        <span className="flex-1" />
        <Link href={`/assessor/calendar${qs({ month: fmtKey(new Date()) })}`}
          className="text-xs font-semibold text-gray-600 border border-gray-200 px-3 py-1.5 rounded-lg hover:border-indigo-300 transition-colors">Today</Link>
        {/* Filters (server-applied) */}
        <form method="GET" action="/assessor/calendar" className="flex gap-2">
          <input type="hidden" name="month" value={monthKey} />
          {agenda && <input type="hidden" name="view" value="agenda" />}
          <select name="m" defaultValue={methodFilter ?? ""} className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs text-gray-600 bg-white">
            <option value="">All types</option>
            {Object.entries(METHOD_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <select name="s" defaultValue={statusFilter ?? ""} className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs text-gray-600 bg-white">
            <option value="">All statuses</option>
            <option value="scheduled">Scheduled</option>
            <option value="completed">Completed</option>
            <option value="cancelled">Cancelled</option>
          </select>
          <button type="submit" className="text-xs font-semibold text-indigo-700 border border-indigo-200 px-3 py-1.5 rounded-lg hover:bg-indigo-50 transition-colors">Apply</button>
        </form>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_280px] gap-5 items-start">
        <div className="min-w-0 flex flex-col gap-4">
          <ScheduleForm nurses={(nurses ?? []) as NurseOpt[]} />

          {agenda ? (
            /* Agenda view */
            <div className="bg-white border border-gray-100 rounded-2xl overflow-hidden">
              <div className="px-5 py-3.5 border-b border-gray-100 flex items-center justify-between">
                <Link href={`/assessor/calendar${qs({ month: fmtKey(prev) })}`} className="text-xs font-semibold text-gray-500 hover:text-indigo-700">‹ {prev.toLocaleDateString(undefined, { month: "short" })}</Link>
                <h2 className="text-sm font-bold text-gray-900">{monthLabel} — Agenda</h2>
                <Link href={`/assessor/calendar${qs({ month: fmtKey(next) })}`} className="text-xs font-semibold text-gray-500 hover:text-indigo-700">{next.toLocaleDateString(undefined, { month: "short" })} ›</Link>
              </div>
              {rows.length === 0 ? (
                <p className="px-5 py-10 text-center text-xs text-gray-400">No sessions match in {monthLabel}.</p>
              ) : (
                <div className="divide-y divide-gray-50">
                  {rows.map(s => (
                    <div key={s.id} className="px-5 py-2.5 flex items-center gap-3">
                      <div className="w-16 text-center shrink-0">
                        <p className="text-[10px] font-bold text-indigo-600" suppressHydrationWarning>{new Date(s.scheduled_for).toLocaleDateString(undefined, { day: "numeric", month: "short" })}</p>
                        <p className="text-[9px] text-gray-400" suppressHydrationWarning>{new Date(s.scheduled_for).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</p>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-gray-800 truncate"><b>{s.profiles?.full_name ?? "—"}</b> · {METHOD_LABELS[s.method] ?? s.method}</p>
                        <p className="text-[10px] text-gray-400 truncate">{[s.location, s.note].filter(Boolean).join(" · ") || "No details"}</p>
                      </div>
                      <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded shrink-0 ${
                        s.status === "completed" ? "bg-green-50 text-green-700"
                        : s.status === "cancelled" ? "bg-gray-100 text-gray-400 line-through"
                        : s.scheduled_for < nowIso ? "bg-red-50 text-red-600" : "bg-blue-50 text-blue-600"
                      }`}>{s.status === "scheduled" ? (s.scheduled_for < nowIso ? "Overdue" : "Scheduled") : s.status}</span>
                      {s.status === "scheduled" && <SessionActions id={s.id} />}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            /* Month grid */
            <div className="bg-white border border-gray-100 rounded-2xl p-5">
              <div className="flex items-center justify-between mb-4">
                <Link href={`/assessor/calendar${qs({ month: fmtKey(prev) })}`} className="text-xs font-semibold text-gray-500 hover:text-indigo-700 border border-gray-200 px-3 py-1.5 rounded-lg transition-colors">‹ {prev.toLocaleDateString(undefined, { month: "short" })}</Link>
                <h2 className="text-sm font-bold text-gray-900">{monthLabel}</h2>
                <Link href={`/assessor/calendar${qs({ month: fmtKey(next) })}`} className="text-xs font-semibold text-gray-500 hover:text-indigo-700 border border-gray-200 px-3 py-1.5 rounded-lg transition-colors">{next.toLocaleDateString(undefined, { month: "short" })} ›</Link>
              </div>
              <div className="grid grid-cols-7 gap-1 text-center mb-1">
                {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map(d => (
                  <p key={d} className="text-[9px] font-bold text-gray-400 uppercase tracking-widest">{d}</p>
                ))}
              </div>
              <div className="grid grid-cols-7 gap-1">
                {cells.map((day, i) => {
                  const dayKey = day ? `${monthKey}-${String(day).padStart(2, "0")}` : null;
                  const isToday = dayKey === todayKey;
                  const daySessions = day ? (byDay.get(day) ?? []) : [];
                  return (
                    <div key={i} className={`min-h-[64px] rounded-lg border p-1 ${
                      day ? (isToday ? "border-indigo-300 bg-indigo-50/50" : "border-gray-100") : "border-transparent"
                    }`}>
                      {day && (
                        <>
                          <p className={`text-[10px] font-bold ${isToday ? "text-indigo-700" : "text-gray-400"}`}>{day}</p>
                          <div className="flex flex-col gap-0.5 mt-0.5">
                            {daySessions.slice(0, 2).map(s => (
                              <p key={s.id} title={`${s.profiles?.full_name} · ${METHOD_LABELS[s.method] ?? s.method}`}
                                className={`text-[8px] leading-tight truncate rounded px-1 py-0.5 ${
                                  s.status === "cancelled" ? "bg-gray-100 text-gray-400 line-through"
                                  : s.status === "completed" ? "bg-green-50 text-green-700"
                                  : "bg-indigo-100 text-indigo-700"
                                }`}>
                                {new Date(s.scheduled_for).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} {s.profiles?.full_name?.split(" ")[0]}
                              </p>
                            ))}
                            {daySessions.length > 2 && <p className="text-[8px] text-gray-400">+{daySessions.length - 2} more</p>}
                          </div>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
              <div className="flex flex-wrap gap-3 mt-3 pt-3 border-t border-gray-50">
                {[["bg-indigo-100", "Scheduled"], ["bg-green-50", "Completed"], ["bg-gray-100", "Cancelled"]].map(([cls, label]) => (
                  <span key={label} className="flex items-center gap-1.5 text-[9px] text-gray-400">
                    <span className={`w-2.5 h-2.5 rounded ${cls}`} /> {label}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Upcoming list (month view only — agenda already lists everything) */}
          {!agenda && (
            <div className="bg-white border border-gray-100 rounded-2xl overflow-hidden">
              <div className="px-5 py-3.5 border-b border-gray-100">
                <h2 className="text-sm font-bold text-gray-900">Upcoming This Month</h2>
              </div>
              {upcoming.length === 0 ? (
                <p className="px-5 py-8 text-center text-xs text-gray-400">
                  Nothing scheduled ahead in {monthLabel}. Use the form above to plan a session.
                </p>
              ) : (
                <div className="divide-y divide-gray-50">
                  {upcoming.map(s => (
                    <div key={s.id} className="px-5 py-3 flex items-center gap-3">
                      <div className="text-center shrink-0 w-12">
                        <p className="text-[10px] font-bold text-indigo-600" suppressHydrationWarning>
                          {new Date(s.scheduled_for).toLocaleDateString(undefined, { day: "numeric", month: "short" })}
                        </p>
                        <p className="text-[9px] text-gray-400" suppressHydrationWarning>
                          {new Date(s.scheduled_for).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                        </p>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-gray-800 truncate"><b>{s.profiles?.full_name ?? "—"}</b> · {METHOD_LABELS[s.method] ?? s.method}</p>
                        <p className="text-[10px] text-gray-400 truncate">{[s.location, s.note].filter(Boolean).join(" · ") || "No details"}</p>
                      </div>
                      <SessionActions id={s.id} />
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <p className="text-[10px] text-gray-300">
            Drag-and-drop rescheduling, recurring sessions, rooms, public holidays and bulk scheduling aren&apos;t available yet.
          </p>
        </div>

        {/* Right rail */}
        <div className="flex flex-col gap-4">
          {/* Assessor workload this week */}
          <div className="bg-white border border-gray-100 rounded-2xl p-4">
            <h2 className="text-xs font-bold text-gray-800 mb-2.5">Assessor Workload <span className="text-gray-300 font-normal">(this week)</span></h2>
            {workload.length === 0 ? (
              <p className="text-[10px] text-gray-400">No sessions booked in your hospital this week.</p>
            ) : (
              <div className="flex flex-col gap-2">
                {workload.map(w => (
                  <div key={w.id} className="flex items-center gap-2">
                    <span className={`text-[11px] w-20 truncate shrink-0 ${w.isMe ? "font-bold text-indigo-700" : "text-gray-600"}`}>
                      {w.name.split(" ")[0]}{w.isMe ? " (you)" : ""}
                    </span>
                    <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div className="h-full bg-indigo-500 rounded-full" style={{ width: `${(w.n / workloadMax) * 100}%` }} />
                    </div>
                    <span className="text-[10px] font-bold text-gray-700 w-5 text-right shrink-0">{w.n}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Conflicts */}
          <div className={`rounded-2xl p-4 border ${conflicts.length ? "bg-red-50 border-red-100" : "bg-white border-gray-100"}`}>
            <h2 className={`text-xs font-bold mb-2 ${conflicts.length ? "text-red-800" : "text-gray-800"}`}>
              ⚠️ Upcoming Conflicts{conflicts.length ? ` (${conflicts.length})` : ""}
            </h2>
            {conflicts.length === 0 ? (
              <p className="text-[10px] text-gray-400">No double-bookings detected this week.</p>
            ) : (
              <div className="flex flex-col gap-2">
                {conflicts.slice(0, 4).map(c => (
                  <div key={c.key}>
                    <p className="text-[11px] font-semibold text-red-900">{c.title}</p>
                    <p className="text-[9px] text-red-800/70 leading-snug" suppressHydrationWarning>{c.detail}</p>
                  </div>
                ))}
              </div>
            )}
            <p className="text-[8px] text-gray-300 mt-2">Assessor and learner double-bookings; rooms and leave aren&apos;t tracked.</p>
          </div>

          {/* AI planner */}
          <div className="bg-violet-50 border border-violet-100 rounded-2xl p-4">
            <h2 className="text-xs font-bold text-violet-900 mb-1.5">✨ AI Scheduling Assistant</h2>
            <p className="text-[10px] text-violet-900/70 leading-snug mb-2">
              Sends this month&apos;s live calendar, workload balance and conflicts for planning advice.
            </p>
            <Link href={`/dashboard/copilot?scenario=${encodeURIComponent(copilotPrompt)}`}
              className="block text-center text-xs font-semibold text-violet-700 border border-violet-200 bg-white hover:bg-violet-100 py-2 rounded-lg transition-colors">
              Get planning advice →
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
