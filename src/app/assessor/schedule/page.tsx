import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import SessionActions from "../calendar/SessionActions";
import { findConflicts, type SchedSession } from "@/lib/engines/schedule";
import { OUTCOME_CONFIG, type DecisionOutcome } from "@/lib/ckcm";

// Assessment Schedule (Assessment Schedule Redesign spec): today's execution
// centre — chronological timeline with complete/cancel actions, live KPIs,
// week outlook, conflict detection, activity feed and rule-derived scheduling
// tips. Average assessment duration, availability search, free-slot finding
// and bulk scheduling have no backing stores and are omitted, not simulated.

const METHOD_LABELS: Record<string, string> = {
  direct_observation: "Direct Observation", knowledge: "Knowledge", simulation: "Simulation",
  osce: "OSCE", concurrent_audit: "Concurrent Audit", retrospective_audit: "Chart Audit", logbook: "Logbook",
};

const ACTION_LABELS: Record<string, string> = {
  schedule_assessment: "scheduled a session",
  cancel_scheduled_assessment: "cancelled a session",
  complete_scheduled_assessment: "completed a session",
};

const nowMs = () => Date.now();
const fmtAgo = (iso: string) => {
  const mins = Math.max(1, Math.round((nowMs() - new Date(iso).getTime()) / 60000));
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} hr${hrs === 1 ? "" : "s"} ago`;
  return `${Math.round(hrs / 24)} d ago`;
};
const initials = (name: string) => name.trim().split(/\s+/).slice(0, 2).map(w => w[0]?.toUpperCase() ?? "").join("") || "?";

export default async function AssessmentSchedulePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();
  const { data: profile } = await admin.from("profiles").select("role, hospital_id").eq("id", user.id).single();
  if (!profile || !["assessor", "educator", "hospital_admin"].includes(profile.role)) redirect("/dashboard");

  const nowIso = new Date().toISOString();
  const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart); dayEnd.setDate(dayEnd.getDate() + 1);
  const weekStart = new Date(dayStart); weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7));
  const weekEnd = new Date(weekStart); weekEnd.setDate(weekEnd.getDate() + 7);
  const windowStart = new Date(nowMs() - 7 * 86400000).toISOString();
  const windowEnd = new Date(nowMs() + 30 * 86400000).toISOString();
  const in7dKey = new Date(nowMs() + 7 * 86400000).toISOString().slice(0, 10);
  const todayKey = nowIso.slice(0, 10);

  const [
    { data: mySessions }, { data: hospSessions }, { data: activity },
    { data: myAssessments }, { data: hospNurses },
  ] = await Promise.all([
    admin.from("scheduled_assessments")
      .select("id, nurse_id, method, scheduled_for, location, note, status, profiles!nurse_id(full_name, specialization)")
      .eq("assessor_id", user.id).gte("scheduled_for", windowStart).lte("scheduled_for", windowEnd)
      .order("scheduled_for"),
    admin.from("scheduled_assessments")
      .select("id, nurse_id, assessor_id, scheduled_for, status, nurse:profiles!nurse_id(full_name), assessor:profiles!assessor_id(full_name)")
      .eq("hospital_id", profile.hospital_id ?? "")
      .gte("scheduled_for", windowStart).lte("scheduled_for", windowEnd),
    admin.from("audit_log").select("action, entity_name, created_at")
      .eq("actor_id", user.id)
      .in("action", ["schedule_assessment", "cancel_scheduled_assessment", "complete_scheduled_assessment"])
      .order("created_at", { ascending: false }).limit(5),
    admin.from("assessments").select("id, status, assessed_at").eq("assessor_id", user.id),
    admin.from("profiles").select("id, full_name").eq("hospital_id", profile.hospital_id ?? "").eq("role", "nurse").limit(200),
  ]);

  type Sess = {
    id: string; nurse_id: string; method: string; scheduled_for: string;
    location: string | null; note: string | null; status: string;
    profiles: { full_name: string; specialization: string | null } | null;
  };
  const sessions = (mySessions ?? []) as unknown as Sess[];
  const todaySessions = sessions.filter(s => s.scheduled_for >= dayStart.toISOString() && s.scheduled_for < dayEnd.toISOString());
  const weekSessions = sessions.filter(s => s.scheduled_for >= weekStart.toISOString() && s.scheduled_for < weekEnd.toISOString());
  const overdue = sessions.filter(s => s.status === "scheduled" && s.scheduled_for < nowIso);

  const completedToday = todaySessions.filter(s => s.status === "completed").length;
  const remainingToday = todaySessions.filter(s => s.status === "scheduled" && s.scheduled_for >= nowIso).length;

  const KPIS = [
    { icon: "📅", value: todaySessions.length, label: "Today's Sessions", sub: "on your schedule", tint: "bg-indigo-50" },
    { icon: "✅", value: completedToday, label: "Completed", sub: "today", tint: "bg-green-50" },
    { icon: "⏭️", value: remainingToday, label: "Remaining", sub: "still to run today", tint: "bg-blue-50" },
    { icon: "🔴", value: overdue.length, label: "Overdue", sub: "past scheduled time", tint: "bg-red-50" },
    { icon: "🗓️", value: weekSessions.length, label: "This Week", sub: "Mon–Sun sessions", tint: "bg-amber-50" },
  ];

  // Conflicts across the hospital's sessions (double-booked assessor/learner)
  const conflicts = findConflicts(((hospSessions ?? []) as unknown as {
    id: string; nurse_id: string; assessor_id: string; scheduled_for: string; status: string;
    nurse: { full_name: string } | null; assessor: { full_name: string } | null;
  }[]).map(s => ({
    id: s.id, nurse_id: s.nurse_id, assessor_id: s.assessor_id,
    nurse_name: s.nurse?.full_name ?? "—", assessor_name: s.assessor?.full_name ?? "—",
    scheduled_for: s.scheduled_for, status: s.status,
  } satisfies SchedSession)));

  // Expiring competencies with no session booked → scheduling tip
  const nurseIds = (hospNurses ?? []).map(n => n.id);
  const scheduledNurseIds = new Set(sessions.filter(s => s.status === "scheduled" && s.scheduled_for >= nowIso).map(s => s.nurse_id));
  let needSession = 0;
  if (nurseIds.length) {
    const { data: decs } = await admin.from("competency_decisions")
      .select("nurse_id, competency_id, outcome, expiry_date, created_at")
      .in("nurse_id", nurseIds).order("created_at", { ascending: false });
    const seen = new Set<string>();
    const flagged = new Set<string>();
    for (const d of decs ?? []) {
      const key = `${d.nurse_id}:${d.competency_id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const passing = OUTCOME_CONFIG[d.outcome as DecisionOutcome]?.passing ?? false;
      if (passing && d.expiry_date && d.expiry_date >= todayKey && d.expiry_date <= in7dKey && !scheduledNurseIds.has(d.nurse_id)) {
        flagged.add(d.nurse_id);
      }
    }
    needSession = flagged.size;
  }

  const tips: string[] = [];
  if (overdue.length > 0) tips.push(`${overdue.length} session${overdue.length === 1 ? "" : "s"} past due — complete or reschedule.`);
  if (conflicts.length > 0) tips.push(`${conflicts.length} scheduling conflict${conflicts.length === 1 ? "" : "s"} detected.`);
  if (needSession > 0) tips.push(`${needSession} nurse${needSession === 1 ? "" : "s"} with competencies expiring this week ha${needSession === 1 ? "s" : "ve"} no session booked.`);
  if (remainingToday === 0 && todaySessions.length === 0) tips.push("Today is clear — a good day to book renewals ahead.");
  const copilotPrompt = `I'm a clinical assessor planning my day. Live schedule: ${todaySessions.length} sessions today (${completedToday} done, ${remainingToday} remaining), ${overdue.length} overdue sessions, ${conflicts.length} scheduling conflicts, ${needSession} nurses with expiring competencies but no booked session, ${weekSessions.length} sessions this week. Help me plan the day and suggest what to schedule next.`;

  // Week outlook (next 7 days)
  const outlook = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(dayStart); d.setDate(d.getDate() + i);
    const dEnd = new Date(d); dEnd.setDate(dEnd.getDate() + 1);
    const list = sessions.filter(s => s.status === "scheduled" && s.scheduled_for >= d.toISOString() && s.scheduled_for < dEnd.toISOString());
    return { label: i === 0 ? "Today" : d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" }), n: list.length };
  });
  const outlookMax = Math.max(1, ...outlook.map(o => o.n));

  // This-week bottom stats
  const weekCompleted = weekSessions.filter(s => s.status === "completed").length;
  const weekCancelled = weekSessions.filter(s => s.status === "cancelled").length;
  const weekAssessed = (myAssessments ?? []).filter(a => a.status === "complete" && a.assessed_at && a.assessed_at >= weekStart.toISOString() && a.assessed_at < weekEnd.toISOString()).length;
  const weekDepts = new Set(weekSessions.map(s => s.profiles?.specialization ?? "General")).size;

  return (
    <div className="max-w-[1400px]">
      {/* Header + view tabs */}
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Assessment Schedule</h1>
          <div className="flex items-center gap-3 mt-1.5">
            <span className="text-xs font-bold text-indigo-700 border-b-2 border-indigo-600 pb-0.5">Today</span>
            <Link href="/assessor/calendar" className="text-xs font-semibold text-gray-400 hover:text-indigo-700 pb-0.5">Calendar</Link>
            <span className="text-xs text-gray-300 pb-0.5 cursor-default" title="Planner isn't available yet">Planner <span className="text-[8px] font-bold uppercase bg-gray-100 text-gray-400 rounded px-1 py-0.5">soon</span></span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {[
            { label: "＋ New Assessment", href: "/assessor/calendar", primary: true },
            { label: "🔍 Search Nurse", href: "/assessor/nurses" },
            { label: "📥 Assessment Inbox", href: "/assessor/queue" },
            { label: "🖊️ Validate Evidence", href: "/assessor/logbook" },
          ].map(a => (
            <Link key={a.label} href={a.href}
              className={`text-xs font-semibold px-3 py-2 rounded-lg transition-colors ${
                a.primary ? "bg-indigo-600 hover:bg-indigo-700 text-white" : "text-gray-600 border border-gray-200 bg-white hover:border-indigo-300"
              }`}>
              {a.label}
            </Link>
          ))}
        </div>
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

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_290px] gap-5 items-start">
        <div className="min-w-0 flex flex-col gap-5">
          {/* Today's timeline */}
          <div className="bg-white border border-gray-100 rounded-2xl overflow-hidden">
            <div className="px-5 py-3.5 border-b border-gray-100 flex items-center justify-between">
              <h2 className="text-sm font-bold text-gray-900">🕐 Today&apos;s Timeline</h2>
              <p className="text-[10px] text-gray-400" suppressHydrationWarning>
                {new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })}
              </p>
            </div>
            {todaySessions.length === 0 ? (
              <p className="px-5 py-8 text-center text-xs text-gray-400">
                Nothing scheduled today — book a session from the <Link href="/assessor/calendar" className="text-indigo-600 hover:underline">calendar</Link>.
              </p>
            ) : (
              <div className="divide-y divide-gray-50">
                {todaySessions.map(s => {
                  const past = s.scheduled_for < nowIso;
                  return (
                    <div key={s.id} className="px-5 py-3 flex items-center gap-3">
                      <div className="w-14 text-center shrink-0">
                        <p className={`text-xs font-bold ${s.status === "completed" ? "text-green-600" : past && s.status === "scheduled" ? "text-red-600" : "text-indigo-600"}`} suppressHydrationWarning>
                          {new Date(s.scheduled_for).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                        </p>
                      </div>
                      <span className="w-8 h-8 rounded-full bg-indigo-100 text-indigo-700 text-[10px] font-bold flex items-center justify-center shrink-0">
                        {initials(s.profiles?.full_name ?? "?")}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-gray-900 truncate">{s.profiles?.full_name ?? "—"}</p>
                        <p className="text-[10px] text-gray-400 truncate">
                          {METHOD_LABELS[s.method] ?? s.method}{s.location ? ` · ${s.location}` : ""}{s.note ? ` · ${s.note}` : ""}
                        </p>
                      </div>
                      <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded shrink-0 ${
                        s.status === "completed" ? "bg-green-50 text-green-700"
                        : s.status === "cancelled" ? "bg-gray-100 text-gray-400 line-through"
                        : past ? "bg-red-50 text-red-600" : "bg-blue-50 text-blue-600"
                      }`}>
                        {s.status === "completed" ? "Completed" : s.status === "cancelled" ? "Cancelled" : past ? "Overdue" : "Upcoming"}
                      </span>
                      {s.status === "scheduled" && (
                        <>
                          <Link href={`/assessor/assess?nurse=${s.nurse_id}`}
                            className="text-[10px] font-semibold bg-indigo-600 hover:bg-indigo-700 text-white px-2.5 py-1 rounded-lg transition-colors shrink-0">
                            Start
                          </Link>
                          <SessionActions id={s.id} />
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Week outlook */}
          <div className="bg-white border border-gray-100 rounded-2xl p-5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-bold text-gray-900">Next 7 Days</h2>
              <Link href="/assessor/calendar" className="text-[11px] font-semibold text-indigo-600 hover:underline">Open calendar →</Link>
            </div>
            <div className="flex flex-col gap-1.5">
              {outlook.map(o => (
                <div key={o.label} className="flex items-center gap-3">
                  <span className="text-[10px] text-gray-500 w-24 shrink-0" suppressHydrationWarning>{o.label}</span>
                  <div className="flex-1 h-2.5 bg-gray-100 rounded-full overflow-hidden">
                    {o.n > 0 && <div className="h-full bg-indigo-500 rounded-full" style={{ width: `${(o.n / outlookMax) * 100}%` }} />}
                  </div>
                  <span className="text-[10px] font-bold text-gray-700 w-16 text-right shrink-0">{o.n} session{o.n === 1 ? "" : "s"}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Bottom stats strip */}
          <div className="bg-white border border-gray-100 rounded-2xl p-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 text-center">
            {[
              { n: weekSessions.length, label: "Sessions this week" },
              { n: weekCompleted, label: "Completed" },
              { n: weekCancelled, label: "Cancelled" },
              { n: overdue.length, label: "Overdue" },
              { n: weekAssessed, label: "Competencies assessed" },
              { n: weekDepts, label: "Departments covered" },
            ].map(s => (
              <div key={s.label}>
                <p className="text-xl font-extrabold text-gray-900 leading-none">{s.n}</p>
                <p className="text-[9px] text-gray-400 mt-1 leading-tight">{s.label}</p>
              </div>
            ))}
          </div>

          <p className="text-[10px] text-gray-300">
            Average assessment duration, availability search, free-slot finding and bulk scheduling aren&apos;t tracked yet.
          </p>
        </div>

        {/* Right rail */}
        <div className="flex flex-col gap-4">
          {/* Conflicts */}
          <div className={`rounded-2xl p-4 border ${conflicts.length ? "bg-red-50 border-red-100" : "bg-white border-gray-100"}`}>
            <h2 className={`text-xs font-bold mb-2 ${conflicts.length ? "text-red-800" : "text-gray-800"}`}>
              ⚠️ Scheduling Conflicts{conflicts.length ? ` (${conflicts.length})` : ""}
            </h2>
            {conflicts.length === 0 ? (
              <p className="text-[10px] text-gray-400">No double-bookings detected across your hospital&apos;s sessions.</p>
            ) : (
              <div className="flex flex-col gap-2">
                {conflicts.slice(0, 4).map(c => (
                  <div key={c.key}>
                    <p className="text-[11px] font-semibold text-red-900">{c.title}</p>
                    <p className="text-[9px] text-red-800/70 leading-snug" suppressHydrationWarning>{c.detail}</p>
                  </div>
                ))}
                <Link href="/assessor/calendar" className="text-[10px] font-semibold text-red-700 hover:underline">Resolve in calendar →</Link>
              </div>
            )}
            <p className="text-[8px] text-gray-300 mt-2">Checks assessor and learner double-bookings; rooms and leave aren&apos;t tracked.</p>
          </div>

          {/* Recent activity */}
          <div className="bg-white border border-gray-100 rounded-2xl p-4">
            <h2 className="text-xs font-bold text-gray-800 mb-2.5">Recent Activity</h2>
            {(activity ?? []).length === 0 ? (
              <p className="text-[10px] text-gray-400">Your scheduling actions appear here.</p>
            ) : (
              <div className="flex flex-col gap-2">
                {(activity ?? []).map((a, i) => (
                  <div key={i} className="flex items-start gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 mt-1.5 shrink-0" />
                    <div className="min-w-0">
                      <p className="text-[11px] text-gray-700 leading-snug">
                        You {ACTION_LABELS[a.action] ?? a.action}
                        {a.entity_name ? <span className="text-gray-400"> — {a.entity_name}</span> : null}
                      </p>
                      <p className="text-[9px] text-gray-300" suppressHydrationWarning>{fmtAgo(a.created_at)}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* AI scheduling assistant */}
          <div className="bg-violet-50 border border-violet-100 rounded-2xl p-4">
            <h2 className="text-xs font-bold text-violet-900 mb-0.5">✨ AI Scheduling Assistant</h2>
            <p className="text-[9px] text-violet-900/50 mb-2">Rule-derived from your live schedule</p>
            <div className="flex flex-col gap-1.5 mb-2.5">
              {tips.length === 0
                ? <p className="text-[10px] text-violet-900/60">Schedule looks healthy — nothing to flag.</p>
                : tips.map(t => <p key={t} className="text-[10px] text-violet-900/80 leading-snug">• {t}</p>)}
            </div>
            <Link href={`/dashboard/copilot?scenario=${encodeURIComponent(copilotPrompt)}`}
              className="block text-center text-xs font-semibold text-violet-700 border border-violet-200 bg-white hover:bg-violet-100 py-2 rounded-lg transition-colors">
              View recommendations →
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
