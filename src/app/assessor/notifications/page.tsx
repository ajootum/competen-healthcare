import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import NotificationsWorkspace, { type Notif } from "@/components/notifications/NotificationsWorkspace";
import { OUTCOME_CONFIG, type DecisionOutcome } from "@/lib/ckcm";

// Assessor Notifications Workspace (Assessment Operations Notification Centre
// spec): the operational inbox with category chips plus a live rail — today's
// summary, upcoming deadlines (scheduled sessions), today's sessions and
// hospital-wide expiring competencies. The empty state shows a productivity
// summary instead of a bare "no notifications".

// Server component renders once per request; helper keeps impure date reads
// out of the render body for the purity lint.
const nowMs = () => Date.now();

const METHOD_LABELS: Record<string, string> = {
  direct_observation: "Direct Observation", knowledge: "Knowledge", simulation: "Simulation",
  osce: "OSCE", concurrent_audit: "Concurrent Audit", retrospective_audit: "Chart Audit", logbook: "Logbook",
};

export default async function AssessorNotificationsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();
  const { data: me } = await admin.from("profiles").select("hospital_id").eq("id", user.id).single();

  const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart); dayEnd.setDate(dayEnd.getDate() + 1);
  const nowIso = new Date().toISOString();
  const in7 = new Date(nowMs() + 7 * 86400000);
  const today = nowIso.slice(0, 10);
  const monthKey = nowIso.slice(0, 7);

  const [
    { data: rows }, { data: todaySessions }, { data: weekSessions },
    { count: logbookPending }, { data: myAssessments }, { data: hospNurses },
  ] = await Promise.all([
    admin.from("notifications").select("id, type, title, body, href, read, created_at")
      .eq("user_id", user.id).order("created_at", { ascending: false }).limit(100),
    admin.from("scheduled_assessments")
      .select("id, method, scheduled_for, status, profiles!nurse_id(full_name)")
      .eq("assessor_id", user.id)
      .gte("scheduled_for", dayStart.toISOString()).lt("scheduled_for", dayEnd.toISOString())
      .order("scheduled_for"),
    admin.from("scheduled_assessments")
      .select("id, method, scheduled_for, profiles!nurse_id(full_name)")
      .eq("assessor_id", user.id).eq("status", "scheduled")
      .gte("scheduled_for", nowIso).lte("scheduled_for", in7.toISOString())
      .order("scheduled_for").limit(5),
    admin.from("skill_log_entries").select("id", { count: "exact", head: true })
      .eq("status", "pending").neq("nurse_id", user.id),
    admin.from("assessments").select("id, status, assessed_at").eq("assessor_id", user.id),
    admin.from("profiles").select("id, full_name").eq("hospital_id", me?.hospital_id ?? "").eq("role", "nurse").limit(200),
  ]);

  const notifications = (rows ?? []) as Notif[];
  const unread = notifications.filter(n => !n.read).length;

  // Hospital-wide expiring competencies (latest passing decisions, ≤60 days)
  const nurseIds = (hospNurses ?? []).map(n => n.id);
  const nameById = new Map((hospNurses ?? []).map(n => [n.id, n.full_name as string]));
  const { data: hospDecisions } = nurseIds.length
    ? await admin.from("competency_decisions")
        .select("nurse_id, competency_id, outcome, expiry_date, created_at, framework_competencies(name)")
        .in("nurse_id", nurseIds).order("created_at", { ascending: false })
    : { data: [] };
  const seen = new Set<string>();
  const in60Key = new Date(nowMs() + 60 * 86400000).toISOString().slice(0, 10);
  const expiring: { key: string; nurse: string; competency: string; date: string }[] = [];
  for (const d of hospDecisions ?? []) {
    const key = `${d.nurse_id}:${d.competency_id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const passing = OUTCOME_CONFIG[d.outcome as DecisionOutcome]?.passing ?? false;
    if (passing && d.expiry_date && d.expiry_date >= today && d.expiry_date <= in60Key) {
      expiring.push({
        key, nurse: nameById.get(d.nurse_id) ?? "—",
        competency: (d.framework_competencies as unknown as { name: string } | null)?.name ?? "Competency",
        date: d.expiry_date,
      });
    }
  }
  expiring.sort((a, b) => a.date.localeCompare(b.date));

  const doneThisMonth = (myAssessments ?? []).filter(a => a.status === "complete" && a.assessed_at?.slice(0, 7) === monthKey).length;
  const pendingMine = (myAssessments ?? []).filter(a => a.status !== "complete").length;

  const SUMMARY = [
    { n: notifications.length, label: "Notifications", cls: "text-gray-900" },
    { n: unread, label: "Unread", cls: "text-amber-600" },
    { n: logbookPending ?? 0, label: "Evidence pending", cls: "text-indigo-600" },
    { n: (weekSessions ?? []).length, label: "Sessions in 7 days", cls: "text-blue-600" },
  ];

  const daysTo = (date: string) => Math.max(0, Math.ceil((new Date(date).getTime() - nowMs()) / 86400000));

  const copilotPrompt = `I'm a clinical assessor reviewing my notification inbox. Live picture: ${unread} unread notifications, ${logbookPending ?? 0} evidence items pending validation, ${pendingMine} assessments assigned to me, ${(weekSessions ?? []).length} scheduled sessions in the next 7 days, ${expiring.length} competencies expiring within 60 days across my hospital. Help me prioritise and suggest an order of work for today.`;

  const emptySummary = (
    <div className="bg-white border border-gray-100 rounded-2xl p-8 text-center">
      <p className="text-3xl mb-2">🧭</p>
      <p className="text-sm font-semibold text-gray-800">Inbox clear — here&apos;s where things stand</p>
      <div className="grid grid-cols-3 gap-3 max-w-sm mx-auto mt-4">
        <div><p className="text-xl font-extrabold text-green-600">{doneThisMonth}</p><p className="text-[10px] text-gray-400">completed this month</p></div>
        <div><p className="text-xl font-extrabold text-amber-600">{logbookPending ?? 0}</p><p className="text-[10px] text-gray-400">evidence pending</p></div>
        <div><p className="text-xl font-extrabold text-blue-600">{(todaySessions ?? []).length}</p><p className="text-[10px] text-gray-400">sessions today</p></div>
      </div>
      <Link href="/assessor/queue" className="inline-block mt-4 text-xs font-semibold text-indigo-700 border border-indigo-200 hover:bg-indigo-50 px-4 py-2 rounded-lg transition-colors">
        Open Assessment Inbox →
      </Link>
    </div>
  );

  return (
    <div className="max-w-6xl">
      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_290px] gap-6 items-start">
        <NotificationsWorkspace items={notifications} variant="assessor" emptySummary={emptySummary} />

        {/* Right rail */}
        <div className="flex flex-col gap-4 xl:pt-1">
          <div className="bg-white border border-gray-100 rounded-2xl p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-xs font-bold text-gray-800">Today&apos;s Summary</h2>
              <Link href="/assessor/analytics" className="text-[10px] font-semibold text-indigo-600 hover:underline">View analytics</Link>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {SUMMARY.map(s => (
                <div key={s.label} className="bg-gray-50 rounded-xl p-3">
                  <p className={`text-lg font-extrabold leading-none ${s.cls}`}>{s.n}</p>
                  <p className="text-[10px] font-semibold text-gray-500 mt-1 leading-tight">{s.label}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-white border border-gray-100 rounded-2xl p-4">
            <div className="flex items-center justify-between mb-2.5">
              <h2 className="text-xs font-bold text-gray-800">⏳ Upcoming Deadlines</h2>
              <Link href="/assessor/calendar" className="text-[10px] font-semibold text-indigo-600 hover:underline">View all</Link>
            </div>
            {(weekSessions ?? []).length === 0 ? (
              <p className="text-[10px] text-gray-400">No scheduled sessions in the next 7 days.</p>
            ) : (
              <div className="flex flex-col gap-1.5">
                {(weekSessions ?? []).map(s => (
                  <Link key={s.id} href="/assessor/calendar" className="flex items-center gap-2 group">
                    <span className="text-[11px] text-gray-700 group-hover:text-indigo-700 truncate flex-1">
                      {(s.profiles as unknown as { full_name: string } | null)?.full_name ?? "—"} · {METHOD_LABELS[s.method] ?? s.method}
                    </span>
                    <span className="text-[9px] text-gray-400 shrink-0" suppressHydrationWarning>
                      {new Date(s.scheduled_for).toLocaleDateString(undefined, { day: "numeric", month: "short" })}
                    </span>
                  </Link>
                ))}
              </div>
            )}
          </div>

          <div className="bg-white border border-gray-100 rounded-2xl p-4">
            <div className="flex items-center justify-between mb-2.5">
              <h2 className="text-xs font-bold text-gray-800">📅 Today&apos;s Sessions</h2>
              <Link href="/assessor/calendar" className="text-[10px] font-semibold text-indigo-600 hover:underline">View schedule</Link>
            </div>
            {(todaySessions ?? []).length === 0 ? (
              <p className="text-[10px] text-gray-400">Nothing scheduled for today.</p>
            ) : (
              <div className="flex flex-col gap-1.5">
                {(todaySessions ?? []).map(s => (
                  <div key={s.id} className="flex items-center gap-2">
                    <span className="text-[10px] font-bold text-indigo-600 w-12 shrink-0" suppressHydrationWarning>
                      {new Date(s.scheduled_for).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </span>
                    <span className="text-[11px] text-gray-700 truncate flex-1">
                      {(s.profiles as unknown as { full_name: string } | null)?.full_name ?? "—"} · {METHOD_LABELS[s.method] ?? s.method}
                    </span>
                    <span className={`text-[8px] font-bold px-1.5 py-0.5 rounded shrink-0 ${
                      s.status === "completed" ? "bg-green-50 text-green-700"
                      : s.status === "cancelled" ? "bg-gray-100 text-gray-400"
                      : "bg-blue-50 text-blue-600"
                    }`}>{s.status === "scheduled" ? "Upcoming" : s.status}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="bg-white border border-gray-100 rounded-2xl p-4">
            <div className="flex items-center justify-between mb-2.5">
              <h2 className="text-xs font-bold text-gray-800">🛑 Expiring Competencies</h2>
              <Link href="/assessor/remediation" className="text-[10px] font-semibold text-indigo-600 hover:underline">View all</Link>
            </div>
            {expiring.length === 0 ? (
              <p className="text-[10px] text-gray-400">Nothing expiring within 60 days across your hospital.</p>
            ) : (
              <div className="flex flex-col gap-1.5">
                {expiring.slice(0, 5).map(e => (
                  <div key={e.key} className="flex items-center gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-[11px] font-semibold text-gray-800 truncate">{e.nurse}</p>
                      <p className="text-[9px] text-gray-400 truncate">{e.competency}</p>
                    </div>
                    <span className="text-[9px] font-bold text-red-500 shrink-0">{daysTo(e.date)} days</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="bg-violet-50 border border-violet-100 rounded-2xl p-4">
            <h2 className="text-xs font-bold text-violet-900 mb-1.5">✨ AI Notification Assistant</h2>
            <p className="text-[10px] text-violet-900/70 leading-snug mb-2">
              {unread > 0 || (logbookPending ?? 0) > 0
                ? `You have ${unread} unread notification${unread === 1 ? "" : "s"} and ${logbookPending ?? 0} evidence item${(logbookPending ?? 0) === 1 ? "" : "s"} awaiting review. Want help prioritising?`
                : "Inbox is clear — ask the Copilot to plan your assessment day."}
            </p>
            <Link href={`/dashboard/copilot?scenario=${encodeURIComponent(copilotPrompt)}`}
              className="block text-center text-xs font-semibold text-violet-700 border border-violet-200 bg-white hover:bg-violet-100 py-2 rounded-lg transition-colors">
              Show recommendations →
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
