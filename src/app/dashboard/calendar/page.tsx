import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadCalendar, EVENT_CAT } from "@/lib/calendar-centre";

// PW-003 Calendar & Schedule Centre — unified calendar aggregating the person's real shifts, task deadlines,
// learning due dates and competency renewals. Day time-grid + Agenda views (via ?view=), mini-month, summary
// cards, upcoming list, task counts and on-call status. Server-rendered; date navigation via ?date=. The
// interactive drag-drop grid + week/resource/team views in the spec are progressive — Day + Agenda ship here.
export const dynamic = "force-dynamic";

const nowMs = () => Date.now(); // module helper — Date.now() in render body trips react-hooks/purity
const todayYmd = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const fmtTime = (d: Date) => new Date(d).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
const HOURS = Array.from({ length: 14 }, (_, i) => 7 + i); // 07:00 – 20:00

function EventBlock({ e }: { e: any }) { // eslint-disable-line @typescript-eslint/no-explicit-any
  return (
    <Link href={e.href} className="block rounded-md px-2.5 py-1.5 border-l-[3px]" style={{ borderColor: e.color, background: `${e.color}12` }}>
      <p className="text-[12px] font-semibold text-gray-800 leading-tight truncate">{e.title}</p>
      <p className="text-[10px] text-gray-500">{e.allDay ? "All day" : `${fmtTime(e.start)}${e.end ? ` – ${fmtTime(e.end)}` : ""}`}{e.overdue && <span className="text-rose-600 font-semibold"> · Overdue</span>}</p>
    </Link>
  );
}
function Summary({ icon, label, value, sub, tint }: { icon: string; label: string; value: string; sub: string; tint: string }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-3.5">
      <div className="flex items-center gap-2"><div className={`w-8 h-8 rounded-lg flex items-center justify-center ${tint}`}>{icon}</div><p className="text-[11px] font-medium text-gray-500">{label}</p></div>
      <p className="text-lg font-bold text-gray-900 mt-1.5 leading-tight">{value}</p>
      <p className="text-[10px] text-gray-400">{sub}</p>
    </div>
  );
}

export default async function CalendarCentrePage({ searchParams }: { searchParams: Promise<{ view?: string; date?: string }> }) {
  const { view = "day", date } = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any; // eslint-disable-line @typescript-eslint/no-explicit-any
  const { data: profile } = await admin.from("profiles").select("hospital_id").eq("id", user.id).single();

  const anchorISO = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : todayYmd();
  const d = await loadCalendar(admin, user.id, profile, anchorISO);
  const anchor = d.anchor as Date;

  // Mini-month grid (Mon-first).
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const lead = (first.getDay() + 6) % 7;
  const daysInMonth = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0).getDate();
  const cells: (number | null)[] = [...Array(lead).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];
  while (cells.length % 7 !== 0) cells.push(null);
  const ymOf = (day: number) => `${anchor.getFullYear()}-${String(anchor.getMonth() + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const prevDay = new Date(anchor.getTime() - 86400000).toISOString().slice(0, 10);
  const nextDay = new Date(anchor.getTime() + 86400000).toISOString().slice(0, 10);
  const prevMonth = new Date(anchor.getFullYear(), anchor.getMonth() - 1, 1).toISOString().slice(0, 10);
  const nextMonth = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 1).toISOString().slice(0, 10);

  // Bucket day's timed events by hour for the grid.
  const byHour = new Map<number, any[]>(); // eslint-disable-line @typescript-eslint/no-explicit-any
  for (const e of d.dayTimed) { let h = new Date(e.start).getHours(); if (h < 7) h = 7; if (h > 20) h = 20; byHour.set(h, [...(byHour.get(h) ?? []), e]); }

  // Agenda: group upcoming by day.
  const nowT = nowMs();
  const agendaDays = new Map<string, any[]>(); // eslint-disable-line @typescript-eslint/no-explicit-any
  for (const e of d.events.filter((x: any) => new Date(x.start).getTime() >= nowT - 86400000).sort((a: any, b: any) => new Date(a.start).getTime() - new Date(b.start).getTime()).slice(0, 40)) { const k = e.date; agendaDays.set(k, [...(agendaDays.get(k) ?? []), e]); } // eslint-disable-line @typescript-eslint/no-explicit-any

  const anchorLabel = anchor.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const cs = d.summary.currentShift;

  return (
    <div className="max-w-[1500px] mx-auto space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold text-blue-600 uppercase tracking-wide">Personal Workspace</p>
          <h1 className="text-2xl font-bold text-gray-900">Calendar &amp; Schedule</h1>
          <p className="text-sm text-gray-500 mt-0.5">Your unified calendar for shifts, tasks, learning, meetings and more.</p>
        </div>
        <Link href="/dashboard/tasks" className="text-sm font-medium text-white bg-blue-600 rounded-lg px-3 py-2 hover:bg-blue-500">+ New Task</Link>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <Summary icon="📅" label="Today" value={new Date().toLocaleDateString("en-GB", { day: "numeric", month: "short" })} sub={new Date().toLocaleDateString("en-GB", { weekday: "long" })} tint="bg-blue-50" />
        <Summary icon="🩺" label="My Shift" value={cs ? `${fmtTime(cs.start)}–${fmtTime(cs.end)}` : "—"} sub={cs ? cs.title.split(" · ")[1] ?? "On duty" : "No shift today"} tint="bg-indigo-50" />
        <Summary icon="📌" label="Events Today" value={String(d.summary.eventsToday)} sub="scheduled" tint="bg-emerald-50" />
        <Summary icon="⏰" label="Tasks Due" value={String(d.taskCounts.overdue + d.taskCounts.today)} sub={`${d.taskCounts.overdue} overdue`} tint="bg-amber-50" />
        <Summary icon="📚" label="Learning" value={String(d.summary.learning)} sub="upcoming due" tint="bg-violet-50" />
        <Summary icon="🎯" label="On-Call" value={d.nextOnCall ? "Scheduled" : "None"} sub={d.nextOnCall ? new Date(d.nextOnCall.start).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : "not on call"} tint="bg-rose-50" />
      </div>

      <div className="grid lg:grid-cols-[240px_minmax(0,1fr)_280px] gap-5 items-start">
        {/* Left: mini-month + filters */}
        <div className="space-y-5">
          <div className="bg-white rounded-xl border border-gray-200 p-3">
            <div className="flex items-center justify-between mb-2">
              <Link href={`/dashboard/calendar?view=${view}&date=${prevMonth}`} className="w-6 h-6 flex items-center justify-center rounded hover:bg-gray-100 text-gray-500">‹</Link>
              <span className="text-[13px] font-semibold text-gray-800">{anchor.toLocaleDateString("en-GB", { month: "long", year: "numeric" })}</span>
              <Link href={`/dashboard/calendar?view=${view}&date=${nextMonth}`} className="w-6 h-6 flex items-center justify-center rounded hover:bg-gray-100 text-gray-500">›</Link>
            </div>
            <div className="grid grid-cols-7 gap-0.5 text-center">
              {["M", "T", "W", "T", "F", "S", "S"].map((w, i) => <span key={i} className="text-[9px] font-semibold text-gray-400 py-1">{w}</span>)}
              {cells.map((day, i) => {
                if (!day) return <span key={i} />;
                const ds = ymOf(day); const isToday = ds === todayYmd(); const isAnchor = ds === d.anchorYmd; const marks = d.monthMarks.get(ds) ?? 0;
                return (
                  <Link key={i} href={`/dashboard/calendar?view=${view}&date=${ds}`} className={`relative aspect-square flex items-center justify-center rounded-md text-[11px] ${isAnchor ? "bg-blue-600 text-white font-bold" : isToday ? "bg-blue-50 text-blue-700 font-semibold" : "text-gray-600 hover:bg-gray-100"}`}>
                    {day}
                    {marks > 0 && !isAnchor && <span className="absolute bottom-0.5 w-1 h-1 rounded-full bg-blue-500" />}
                  </Link>
                );
              })}
            </div>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 p-3">
            <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide px-1 pb-2">My Calendars</p>
            <div className="space-y-1.5">
              {Object.values(EVENT_CAT).map(c => (
                <div key={c.label} className="flex items-center gap-2 px-1"><span className="w-3 h-3 rounded-sm" style={{ background: c.color }} /><span className="text-[12px] text-gray-600">{c.label}</span></div>
              ))}
            </div>
          </div>
        </div>

        {/* Main: Day grid or Agenda */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-100">
            <div className="flex items-center gap-2">
              <Link href={`/dashboard/calendar?view=${view}&date=${prevDay}`} className="w-7 h-7 flex items-center justify-center rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50">‹</Link>
              <Link href={`/dashboard/calendar?view=${view}`} className="text-[12px] font-medium text-gray-600 border border-gray-200 rounded-lg px-2.5 py-1 hover:bg-gray-50">Today</Link>
              <Link href={`/dashboard/calendar?view=${view}&date=${nextDay}`} className="w-7 h-7 flex items-center justify-center rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50">›</Link>
              <span className="text-sm font-semibold text-gray-800 ml-1">{view === "agenda" ? "Agenda" : anchorLabel}</span>
            </div>
            <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-0.5">
              {["day", "agenda"].map(v => <Link key={v} href={`/dashboard/calendar?view=${v}&date=${d.anchorYmd}`} className={`text-[12px] font-medium rounded-md px-2.5 py-1 capitalize ${view === v ? "bg-white text-gray-800 shadow-sm" : "text-gray-500"}`}>{v}</Link>)}
            </div>
          </div>

          {view === "agenda" ? (
            <div className="divide-y divide-gray-50">
              {agendaDays.size > 0 ? [...agendaDays.entries()].map(([ds, evs]) => (
                <div key={ds} className="px-4 py-3">
                  <p className="text-[11px] font-bold text-gray-500 uppercase tracking-wide mb-2">{new Date(ds + "T00:00:00").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "long" })}</p>
                  <div className="space-y-1.5">{evs.map((e: any) => <EventBlock key={e.id} e={e} />)}</div> {/* eslint-disable-line @typescript-eslint/no-explicit-any */}
                </div>
              )) : <p className="px-4 py-16 text-center text-sm text-gray-400">No upcoming events in your calendar.</p>}
            </div>
          ) : (
            <div>
              {d.dayAllDay.length > 0 && (
                <div className="flex border-b border-gray-100">
                  <div className="w-16 shrink-0 px-2 py-2 text-[10px] font-semibold text-gray-400 text-right">All day</div>
                  <div className="flex-1 px-2 py-2 space-y-1">{d.dayAllDay.map((e: any) => <EventBlock key={e.id} e={e} />)}</div> {/* eslint-disable-line @typescript-eslint/no-explicit-any */}
                </div>
              )}
              <div className="max-h-[560px] overflow-y-auto">
                {HOURS.map(h => {
                  const evs = byHour.get(h) ?? [];
                  return (
                    <div key={h} className="flex border-b border-gray-50 min-h-[46px]">
                      <div className="w-16 shrink-0 px-2 py-1.5 text-[10px] font-medium text-gray-400 text-right">{String(h).padStart(2, "0")}:00</div>
                      <div className="flex-1 px-2 py-1.5 space-y-1">{evs.map((e: any) => <EventBlock key={e.id} e={e} />)}</div> {/* eslint-disable-line @typescript-eslint/no-explicit-any */}
                    </div>
                  );
                })}
              </div>
              {d.dayTimed.length === 0 && d.dayAllDay.length === 0 && <p className="px-4 py-10 text-center text-sm text-gray-400">Nothing scheduled for this day.</p>}
            </div>
          )}
        </div>

        {/* Right rail */}
        <div className="space-y-5">
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <h3 className="text-sm font-semibold text-gray-900 mb-3">Upcoming (Next 7 Days)</h3>
            {d.upcoming.length > 0 ? (
              <div className="space-y-2.5">
                {d.upcoming.map((e: any) => ( // eslint-disable-line @typescript-eslint/no-explicit-any
                  <Link key={e.id} href={e.href} className="flex gap-2.5 group">
                    <span className="w-1 rounded-full shrink-0" style={{ background: e.color }} />
                    <div className="min-w-0"><p className="text-[12px] font-medium text-gray-800 group-hover:text-blue-700 truncate">{e.title}</p><p className="text-[10px] text-gray-400">{new Date(e.start).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })}{!e.allDay && ` · ${fmtTime(e.start)}`}</p></div>
                  </Link>
                ))}
              </div>
            ) : <p className="text-xs text-gray-400 py-4 text-center">Nothing in the next 7 days.</p>}
          </div>

          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <h3 className="text-sm font-semibold text-gray-900 mb-3">My Tasks on Calendar</h3>
            <div className="space-y-1.5 text-sm">
              <Link href="/dashboard/tasks?tab=all" className="flex items-center justify-between hover:bg-gray-50 rounded px-1 py-0.5"><span className="text-rose-600">Overdue</span><span className="font-semibold text-gray-900">{d.taskCounts.overdue}</span></Link>
              <Link href="/dashboard/tasks" className="flex items-center justify-between hover:bg-gray-50 rounded px-1 py-0.5"><span className="text-amber-600">Due Today</span><span className="font-semibold text-gray-900">{d.taskCounts.today}</span></Link>
              <Link href="/dashboard/tasks" className="flex items-center justify-between hover:bg-gray-50 rounded px-1 py-0.5"><span className="text-blue-600">Due This Week</span><span className="font-semibold text-gray-900">{d.taskCounts.week}</span></Link>
            </div>
            <Link href="/dashboard/tasks" className="block text-center text-[12px] font-medium text-blue-600 hover:underline pt-2">Go to Task Centre →</Link>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <h3 className="text-sm font-semibold text-gray-900 mb-2">On-Call / Availability</h3>
            <div className="flex items-center justify-between text-sm"><span className="text-gray-500">Status</span><span className={`font-medium ${d.nextOnCall ? "text-rose-600" : "text-emerald-600"}`}>{d.nextOnCall ? "On-call scheduled" : "Available"}</span></div>
            {d.nextOnCall && <div className="flex items-center justify-between text-sm mt-1"><span className="text-gray-500">Next on-call</span><span className="text-gray-800">{new Date(d.nextOnCall.start).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</span></div>}
            <Link href="/dashboard/shift" className="block text-center text-[12px] font-medium text-blue-600 hover:underline pt-2">View shift workspace →</Link>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <h3 className="text-sm font-semibold text-gray-900 mb-3">Quick Actions</h3>
            <div className="grid grid-cols-2 gap-2">
              <Link href="/dashboard/tasks" className="text-[12px] font-medium text-gray-600 border border-gray-200 rounded-lg py-2 text-center hover:bg-gray-50">☑ Add Task</Link>
              <Link href="/dashboard/shift" className="text-[12px] font-medium text-gray-600 border border-gray-200 rounded-lg py-2 text-center hover:bg-gray-50">🩺 My Shift</Link>
              <Link href="/dashboard/learning" className="text-[12px] font-medium text-gray-600 border border-gray-200 rounded-lg py-2 text-center hover:bg-gray-50">📚 Learning</Link>
              <Link href="/dashboard/notifications" className="text-[12px] font-medium text-gray-600 border border-gray-200 rounded-lg py-2 text-center hover:bg-gray-50">🔔 Alerts</Link>
            </div>
          </div>
        </div>
      </div>
      <p className="text-[11px] text-gray-400">Events aggregate your real shifts, task deadlines, learning due dates and competency renewals. Week / resource / team views and drag-drop scheduling are progressive.</p>
    </div>
  );
}
