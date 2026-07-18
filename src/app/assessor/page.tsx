import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { generateAssessorQueue } from "@/lib/engines/tasks";
import { computeRiskFlags, type NurseRisk } from "@/lib/engines/risk";
import SmartQueue from "./SmartQueue";

// Assessment Operations Centre (Enterprise Assessor Workspace V2 spec):
// priorities strip, assessment inbox pipeline, live-assessment resume card,
// queue, schedule, evidence validation centre, workforce risk engine,
// competency heatmap, team performance and notifications — every figure from
// live records. WebSocket live updates, inter-rater agreement and evidence
// anomaly detection have no backing yet and are omitted, not simulated.

const NOTIF_ICON: Record<string, string> = {
  logbook_pending: "📖", logbook_verified: "✅", logbook_rejected: "❌",
  logbook_changes_requested: "✏️", decisions_issued: "🧠",
  credential_added: "🏅", credential_submitted: "🏅",
  assessment_scheduled: "📅", assessment_cancelled: "🚫",
};

const nowMs = () => Date.now();
const hourNow = () => new Date().getHours();
const fmtAgo = (iso: string) => {
  const mins = Math.max(1, Math.round((nowMs() - new Date(iso).getTime()) / 60000));
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} hr${hrs === 1 ? "" : "s"} ago`;
  return `${Math.round(hrs / 24)} d ago`;
};

export default async function AssessorDashboard() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();
  const { data: profile } = await admin.from("profiles").select("role, hospital_id, full_name").eq("id", user.id).single();
  if (!profile || !["assessor", "educator", "hospital_admin"].includes(profile.role)) redirect("/dashboard");

  const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart); dayEnd.setDate(dayEnd.getDate() + 1);
  const nowIso = new Date().toISOString();
  const in7d = new Date(nowMs() + 7 * 86400000).toISOString().slice(0, 10);
  const today = nowIso.slice(0, 10);
  const monthKey = nowIso.slice(0, 7);

  const [
    { data: myPending }, { data: allMine },
    { count: logbookPending },
    { data: todaySessions }, { data: nextOsceRows },
    { data: myNotifications },
    { data: hospNurses },
  ] = await Promise.all([
    admin.from("assessments")
      .select(`id, method, status, score,
        competency_cycles!cycle_id(id, cycle_type, profiles!nurse_id(full_name)),
        framework_competencies!competency_id(name, framework_domains!domain_id(name))`)
      .eq("assessor_id", user.id).in("status", ["pending", "in_progress"])
      .order("created_at").limit(12),
    admin.from("assessments")
      .select("id, status, score, method, assessed_at, created_at")
      .eq("assessor_id", user.id),
    admin.from("skill_log_entries").select("id", { count: "exact", head: true })
      .eq("status", "pending").neq("nurse_id", user.id),
    admin.from("scheduled_assessments")
      .select("id, method, scheduled_for, location, status, profiles!nurse_id(full_name)")
      .eq("assessor_id", user.id).eq("status", "scheduled")
      .gte("scheduled_for", dayStart.toISOString()).lt("scheduled_for", dayEnd.toISOString())
      .order("scheduled_for"),
    admin.from("scheduled_assessments")
      .select("id, scheduled_for")
      .eq("assessor_id", user.id).eq("status", "scheduled").eq("method", "osce")
      .gte("scheduled_for", nowIso).order("scheduled_for").limit(1),
    admin.from("notifications")
      .select("id, type, title, read, created_at, href")
      .eq("user_id", user.id).order("created_at", { ascending: false }).limit(5),
    admin.from("profiles").select("id, full_name")
      .eq("hospital_id", profile.hospital_id ?? "").eq("role", "nurse").limit(200),
  ]);

  let queue: Awaited<ReturnType<typeof generateAssessorQueue>> = { tasks: [], workload: { tasks: 0, estMinutes: 0, learners: 0, urgent: 0 } };
  try {
    queue = await generateAssessorQueue(admin, profile.hospital_id ?? "", user.id);
  } catch { /* requirement matrix not installed yet */ }

  let risks: NurseRisk[] = [];
  try {
    risks = await computeRiskFlags(admin, profile.hospital_id ?? "");
  } catch { /* fail-soft */ }

  // Hospital decisions → expiring soon, heatmap, weakest competencies
  const nurseIds = (hospNurses ?? []).map(n => n.id);
  const { data: hospDecisions } = nurseIds.length
    ? await admin.from("competency_decisions")
        .select("nurse_id, competency_id, outcome, expiry_date, created_at, framework_competencies(name, framework_domains(name))")
        .in("nurse_id", nurseIds).order("created_at", { ascending: false })
    : { data: [] };
  const seenDec = new Set<string>();
  const byDomain = new Map<string, { pass: number; total: number }>();
  const byCompetency = new Map<string, { pass: number; total: number }>();
  let expiringSoon = 0;
  for (const d of hospDecisions ?? []) {
    const key = `${d.nurse_id}:${d.competency_id}`;
    if (seenDec.has(key)) continue;
    seenDec.add(key);
    const comp = d.framework_competencies as unknown as { name: string; framework_domains: { name: string } | null } | null;
    const passing = ["competent", "provisionally_competent", "competent_with_conditions"].includes(d.outcome);
    if (passing && d.expiry_date && d.expiry_date >= today && d.expiry_date <= in7d) expiringSoon++;
    const domain = comp?.framework_domains?.name ?? "Other";
    const dAgg = byDomain.get(domain) ?? { pass: 0, total: 0 };
    dAgg.total++; if (passing) dAgg.pass++;
    byDomain.set(domain, dAgg);
    const cName = comp?.name ?? "Competency";
    const cAgg = byCompetency.get(cName) ?? { pass: 0, total: 0 };
    cAgg.total++; if (passing) cAgg.pass++;
    byCompetency.set(cName, cAgg);
  }
  const heatmap = [...byDomain.entries()]
    .map(([domain, { pass, total }]) => ({ label: domain, pct: Math.round((pass / total) * 100), n: total }))
    .sort((a, b) => b.n - a.n).slice(0, 8);
  const weakest = [...byCompetency.entries()]
    .map(([name, { pass, total }]) => ({ name, pct: Math.round((pass / total) * 100), n: total }))
    .sort((a, b) => a.pct - b.pct).slice(0, 5);

  // Evidence validation centre — pending entries + attached files by type
  const { data: pendingEntries } = await admin.from("skill_log_entries")
    .select("id").eq("status", "pending").neq("nurse_id", user.id).limit(200);
  const pendingIds = (pendingEntries ?? []).map(e => e.id);
  const { data: pendingEvidence } = pendingIds.length
    ? await admin.from("evidence").select("mime_type").in("skill_log_entry_id", pendingIds)
    : { data: [] };
  const photoCount = (pendingEvidence ?? []).filter(e => e.mime_type.startsWith("image/")).length;
  const docCount = (pendingEvidence ?? []).filter(e => e.mime_type === "application/pdf").length;

  // Team performance — every assessor in this hospital, from real assessments
  const { data: teamRows } = await admin.from("assessments")
    .select("assessor_id, status, score, assessed_at, created_at, competency_cycles!cycle_id!inner(hospital_id)")
    .eq("competency_cycles.hospital_id", profile.hospital_id ?? "");
  const teamAgg = new Map<string, { done: number; scores: number[]; turnarounds: number[] }>();
  for (const a of (teamRows ?? []) as unknown as { assessor_id: string | null; status: string; score: number | null; assessed_at: string | null; created_at: string }[]) {
    if (!a.assessor_id || a.status !== "complete") continue;
    const agg = teamAgg.get(a.assessor_id) ?? { done: 0, scores: [], turnarounds: [] };
    agg.done++;
    if (a.score !== null) agg.scores.push(a.score);
    if (a.assessed_at) {
      const d = (new Date(a.assessed_at).getTime() - new Date(a.created_at).getTime()) / 86400000;
      if (d >= 0) agg.turnarounds.push(d);
    }
    teamAgg.set(a.assessor_id, agg);
  }
  const { data: teamProfiles } = teamAgg.size
    ? await admin.from("profiles").select("id, full_name").in("id", [...teamAgg.keys()])
    : { data: [] };
  const teamNames = new Map((teamProfiles ?? []).map(p => [p.id, p.full_name as string]));
  const team = [...teamAgg.entries()]
    .map(([id, t]) => ({
      id, name: teamNames.get(id) ?? "—", done: t.done,
      avgScore: t.scores.length ? t.scores.reduce((s, x) => s + x, 0) / t.scores.length : null,
      turnaround: t.turnarounds.length ? t.turnarounds.reduce((s, x) => s + x, 0) / t.turnarounds.length : null,
      isMe: id === user.id,
    }))
    .sort((a, b) => b.done - a.done).slice(0, 5);

  // Inbox + workload
  const mine = allMine ?? [];
  const newCount = mine.filter(a => a.status === "pending").length;
  const inProgress = mine.filter(a => a.status === "in_progress");
  const done = mine.filter(a => a.status === "complete");
  const doneThisMonth = done.filter(a => a.assessed_at?.slice(0, 7) === monthKey).length;
  const total = mine.length;
  const seg = (n: number) => total ? (n / total) * 100 : 0;
  const donut = [
    { label: "Completed",   n: done.length,       pct: seg(done.length),      color: "#10b981" },
    { label: "In Progress", n: inProgress.length, pct: seg(inProgress.length), color: "#3b82f6" },
    { label: "New",         n: newCount,          pct: seg(newCount),          color: "#f59e0b" },
  ];
  const C = 2 * Math.PI * 40;
  let acc = 0;
  const arcs = donut.map(d => { const a = { ...d, offset: acc }; acc += d.pct; return a; });

  // Live assessment resume card — first in-progress assessment
  const resume = (myPending ?? []).find(a => a.status === "in_progress") ?? null;
  const resumeCyc = resume?.competency_cycles as unknown as { id: string; profiles: { full_name: string } | null } | null;
  const resumeComp = resume?.framework_competencies as unknown as { name: string } | null;

  const nextOsce = nextOsceRows?.[0] ?? null;
  const nextOsceLabel = nextOsce
    ? (() => {
        const mins = Math.round((new Date(nextOsce.scheduled_for).getTime() - nowMs()) / 60000);
        if (mins < 60) return `in ${mins} min`;
        if (mins < 1440) return `in ${Math.round(mins / 60)} hr`;
        return new Date(nextOsce.scheduled_for).toLocaleDateString(undefined, { day: "numeric", month: "short" });
      })()
    : null;

  const greeting = hourNow() < 12 ? "Good morning" : hourNow() < 17 ? "Good afternoon" : "Good evening";
  const firstName = profile.full_name?.split(" ")[0] ?? "Assessor";
  const unread = (myNotifications ?? []).filter(n => !n.read).length;

  const PRIORITIES = [
    { icon: "🔥", value: String((todaySessions ?? []).length), label: "Assessments", sub: "due today",            href: "/assessor/calendar",    tint: "bg-red-50" },
    { icon: "⏳", value: String(expiringSoon),                 label: "Competencies", sub: "expiring within 7 days", href: "/assessor/remediation", tint: "bg-amber-50" },
    { icon: "🏥", value: nextOsceLabel ?? "—",                 label: "Next OSCE",    sub: nextOsceLabel ? "scheduled session" : "none scheduled", href: "/assessor/calendar", tint: "bg-blue-50" },
    { icon: "🖊️", value: String(logbookPending ?? 0),          label: "Evidence",     sub: "awaiting review",      href: "/assessor/logbook",     tint: "bg-indigo-50" },
    { icon: "🛑", value: String(risks.length),                 label: "High Risk",    sub: "learners flagged",     href: "/assessor/remediation", tint: "bg-rose-50" },
  ];

  const INBOX = [
    { icon: "🟢", label: "New",                value: newCount,          sub: "awaiting your start",  href: "/assessor/queue" },
    { icon: "🟠", label: "In Progress",        value: inProgress.length, sub: "continue assessing",   href: "/assessor/queue" },
    { icon: "🟣", label: "Awaiting Validation", value: logbookPending ?? 0, sub: "logbook & evidence", href: "/assessor/logbook" },
    { icon: "✅", label: "Completed",          value: doneThisMonth,     sub: "this month",           href: "/assessor/history" },
  ];

  const copilotPrompt = `I am a clinical assessor. Live workload: ${newCount} new + ${inProgress.length} in-progress assessments, ${logbookPending ?? 0} evidence items awaiting validation, ${(todaySessions ?? []).length} sessions today, ${expiringSoon} competencies expiring within 7 days, ${risks.length} high-risk learners. Weakest competencies hospital-wide: ${weakest.map(w => `${w.name} (${w.pct}% passing)`).join("; ") || "none recorded"}. Advise me on today's priorities and how to address the weakest areas.`;

  return (
    <div className="max-w-[1400px]">
      {/* Header */}
      <div className="mb-5">
        <h1 className="text-xl font-bold text-gray-900">{greeting}, {firstName}! 👋</h1>
        <p className="text-gray-400 text-sm mt-0.5">Assessment Operations Centre</p>
      </div>

      {/* Today's priorities */}
      <div className="mb-5">
        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">Today&apos;s Priorities</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-3">
          {PRIORITIES.map(p => (
            <Link key={p.label} href={p.href} className={`${p.tint} border border-gray-100 rounded-2xl p-4 hover:border-indigo-200 transition-colors flex items-center gap-3`}>
              <span className="text-xl shrink-0">{p.icon}</span>
              <span className="min-w-0">
                <span className="block text-lg font-extrabold text-gray-900 leading-none truncate">{p.value}</span>
                <span className="block text-[11px] font-semibold text-gray-700 mt-0.5">{p.label}</span>
                <span className="block text-[9px] text-gray-400">{p.sub}</span>
              </span>
            </Link>
          ))}
        </div>
      </div>

      {/* Assessment inbox pipeline */}
      <div className="bg-white border border-gray-100 rounded-2xl p-4 mb-5">
        <div className="flex items-center justify-between mb-3">
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Assessment Inbox</p>
          <Link href="/assessor/queue" className="text-[11px] font-semibold text-indigo-600 hover:underline">View inbox →</Link>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 divide-x divide-gray-50">
          {INBOX.map(b => (
            <Link key={b.label} href={b.href} className="px-4 py-1 group">
              <p className="text-[11px] font-semibold text-gray-600 group-hover:text-indigo-700">{b.icon} {b.label}</p>
              <p className="text-2xl font-extrabold text-gray-900 leading-tight">{b.value}</p>
              <p className="text-[9px] text-gray-400">{b.sub}</p>
            </Link>
          ))}
        </div>
        <p className="text-[9px] text-gray-300 mt-2">Escalation and dispute states aren&apos;t tracked yet.</p>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_300px] gap-5 items-start">
        {/* Main column */}
        <div className="min-w-0 flex flex-col gap-5">
          {/* Queue */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-sm font-bold text-gray-900">Assessment Queue</h2>
              <Link href="/assessor/queue" className="text-[11px] font-semibold text-indigo-600 hover:underline">View all →</Link>
            </div>
            <SmartQueue tasks={queue.tasks.slice(0, 5)} workload={queue.workload} />
          </div>

          {/* Today's schedule */}
          <div className="bg-white border border-gray-100 rounded-2xl overflow-hidden">
            <div className="px-5 py-3.5 border-b border-gray-100 flex items-center justify-between">
              <h2 className="text-sm font-bold text-gray-900">📅 Today&apos;s Schedule</h2>
              <Link href="/assessor/calendar" className="text-[11px] font-semibold text-indigo-600 hover:underline">View calendar →</Link>
            </div>
            {(todaySessions ?? []).length === 0 ? (
              <p className="px-5 py-5 text-center text-xs text-gray-400">
                Nothing scheduled for today — plan sessions from the <Link href="/assessor/calendar" className="text-indigo-600 hover:underline">calendar</Link>.
              </p>
            ) : (
              <div className="divide-y divide-gray-50">
                {(todaySessions ?? []).map(s => (
                  <div key={s.id} className="px-5 py-2.5 flex items-center gap-3">
                    <span className="text-[11px] font-bold text-indigo-600 w-14 shrink-0" suppressHydrationWarning>
                      {new Date(s.scheduled_for).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-gray-800 truncate">
                        <b>{(s.profiles as unknown as { full_name: string } | null)?.full_name ?? "—"}</b>
                        <span className="text-gray-400 capitalize"> · {s.method.replace(/_/g, " ")}</span>
                      </p>
                      {s.location && <p className="text-[10px] text-gray-400 truncate">{s.location}</p>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Bottom widget row */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {/* Workforce risk engine */}
            <div className="bg-white border border-gray-100 rounded-2xl p-5">
              <h2 className="text-sm font-bold text-gray-900 mb-0.5">Workforce Risk Engine</h2>
              <p className="text-[10px] text-gray-400 mb-3">High-risk areas from live decisions</p>
              {risks.length === 0 ? (
                <p className="text-xs text-gray-400">No risk flags on record.</p>
              ) : (
                <div className="flex flex-col gap-2">
                  {risks.slice(0, 4).map(r => (
                    <div key={r.nurseId} className="flex items-start gap-2">
                      <span className="text-sm shrink-0">🛑</span>
                      <div className="min-w-0 flex-1">
                        <p className="text-[11px] font-semibold text-gray-800 truncate">{r.nurseName}</p>
                        <p className="text-[10px] text-gray-400 leading-snug truncate">
                          {r.flags.slice(0, 2).map(f =>
                            `${f.type === "critical_failure" ? "Critical failure" : f.type === "expired" ? "Expired" : "Not yet competent"}: ${f.competency}`,
                          ).join(" · ")}{r.flags.length > 2 ? ` · +${r.flags.length - 2}` : ""}
                        </p>
                      </div>
                      <span className="text-[9px] font-bold bg-red-50 text-red-600 px-1.5 py-0.5 rounded shrink-0">
                        {r.flags.length} flag{r.flags.length === 1 ? "" : "s"}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              <Link href="/assessor/remediation" className="block mt-3 text-[11px] font-semibold text-indigo-600 hover:underline">View risk dashboard →</Link>
            </div>

            {/* Evidence validation centre */}
            <div className="bg-white border border-gray-100 rounded-2xl p-5">
              <h2 className="text-sm font-bold text-gray-900 mb-0.5">Evidence Validation Centre</h2>
              <p className="text-[10px] text-gray-400 mb-3">{logbookPending ?? 0} item{(logbookPending ?? 0) === 1 ? "" : "s"} awaiting your review</p>
              <div className="flex flex-col gap-2">
                {[
                  { icon: "📖", label: "Logbook Entries", n: logbookPending ?? 0 },
                  { icon: "📷", label: "Photos attached", n: photoCount },
                  { icon: "📄", label: "Documents attached", n: docCount },
                ].map(row => (
                  <div key={row.label} className="flex items-center justify-between">
                    <p className="text-[11px] text-gray-600">{row.icon} {row.label}</p>
                    <p className="text-[11px] font-bold text-gray-900">{row.n}</p>
                  </div>
                ))}
              </div>
              <p className="text-[9px] text-gray-300 mt-2">Video and reflection submissions aren&apos;t supported yet.</p>
              <Link href="/assessor/logbook" className="block mt-2 text-[11px] font-semibold text-indigo-600 hover:underline">Review evidence →</Link>
            </div>

            {/* Competency heatmap */}
            <div className="bg-white border border-gray-100 rounded-2xl p-5">
              <h2 className="text-sm font-bold text-gray-900 mb-0.5">Hospital Competency Heatmap</h2>
              <p className="text-[10px] text-gray-400 mb-3">% of latest decisions passing</p>
              {heatmap.length === 0 ? (
                <p className="text-xs text-gray-400">No decisions recorded yet.</p>
              ) : (
                <div className="flex flex-col gap-1.5">
                  {heatmap.map(h => (
                    <div key={h.label} className="flex items-center gap-2">
                      <span className="text-[10px] text-gray-500 w-32 truncate shrink-0">{h.label}</span>
                      <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                        <div className={`h-full rounded-full ${h.pct >= 80 ? "bg-green-500" : h.pct >= 50 ? "bg-amber-400" : "bg-red-400"}`}
                          style={{ width: `${h.pct}%` }} />
                      </div>
                      <span className="text-[10px] font-bold text-gray-700 w-9 text-right shrink-0">{h.pct}%</span>
                    </div>
                  ))}
                </div>
              )}
              {weakest.length > 0 && (
                <p className="text-[9px] text-gray-400 mt-2.5 leading-snug">
                  Weakest: {weakest.slice(0, 3).map(w => `${w.name} (${w.pct}%)`).join(" · ")}
                </p>
              )}
              <Link href="/assessor/analytics" className="block mt-2 text-[11px] font-semibold text-indigo-600 hover:underline">View full analytics →</Link>
            </div>

            {/* Team performance */}
            <div className="bg-white border border-gray-100 rounded-2xl p-5">
              <h2 className="text-sm font-bold text-gray-900 mb-0.5">Team Performance</h2>
              <p className="text-[10px] text-gray-400 mb-3">Assessors in your hospital, all time</p>
              {team.length === 0 ? (
                <p className="text-xs text-gray-400">No completed assessments recorded yet.</p>
              ) : (
                <div className="flex flex-col gap-2">
                  {team.map(t => (
                    <div key={t.id} className="flex items-center gap-2">
                      <p className={`text-[11px] flex-1 truncate ${t.isMe ? "font-bold text-indigo-700" : "text-gray-600"}`}>
                        {t.name}{t.isMe ? " (you)" : ""}
                      </p>
                      <p className="text-[10px] text-gray-500 shrink-0">{t.done} completed</p>
                      <p className="text-[10px] font-bold text-gray-800 w-14 text-right shrink-0">
                        {t.avgScore !== null ? `${t.avgScore.toFixed(1)}/6 avg` : "—"}
                      </p>
                    </div>
                  ))}
                </div>
              )}
              <p className="text-[9px] text-gray-300 mt-2.5">Inter-rater agreement needs double-scored encounters — not tracked yet.</p>
            </div>
          </div>

          <p className="text-center text-[9px] text-gray-300">
            COMPETEN Assessor Workspace · Empowering excellence in healthcare competency
          </p>
        </div>

        {/* Right rail */}
        <div className="flex flex-col gap-4">
          {/* Notifications */}
          <div className="bg-white border border-gray-100 rounded-2xl p-4">
            <div className="flex items-center justify-between mb-2.5">
              <h2 className="text-xs font-bold text-gray-800">🔔 Notifications{unread > 0 ? ` (${unread} unread)` : ""}</h2>
              <Link href="/assessor/notifications" className="text-[10px] font-semibold text-indigo-600 hover:underline">View all</Link>
            </div>
            {(myNotifications ?? []).length === 0 ? (
              <p className="text-[10px] text-gray-400">Nothing yet — events land here as they happen.</p>
            ) : (
              <div className="flex flex-col gap-2">
                {(myNotifications ?? []).map(n => (
                  <Link key={n.id} href={n.href ?? "/assessor/notifications"} className="flex items-start gap-2 group">
                    <span className="text-sm shrink-0">{NOTIF_ICON[n.type] ?? "🔔"}</span>
                    <div className="min-w-0">
                      <p className={`text-[11px] leading-snug group-hover:text-indigo-700 ${n.read ? "text-gray-500" : "font-semibold text-gray-800"}`}>{n.title}</p>
                      <p className="text-[9px] text-gray-300" suppressHydrationWarning>{fmtAgo(n.created_at)}</p>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>

          {/* Current assessment — resume */}
          <div className="bg-indigo-600 rounded-2xl p-4">
            <h2 className="text-[10px] font-bold text-indigo-200 uppercase tracking-widest mb-2">Current Assessment</h2>
            {resume ? (
              <>
                <p className="text-white text-sm font-bold">{resumeCyc?.profiles?.full_name ?? "—"}</p>
                <p className="text-indigo-200 text-[11px] capitalize">
                  {resumeComp?.name ?? "Competency"} · {resume.method.replace(/_/g, " ")}
                </p>
                <Link href={resumeCyc?.id ? `/assessor/cycle/${resumeCyc.id}` : "/assessor/queue"}
                  className="block mt-3 text-center text-xs font-semibold bg-white text-indigo-700 hover:bg-indigo-50 py-2 rounded-lg transition-colors">
                  Continue Assessment →
                </Link>
              </>
            ) : (
              <>
                <p className="text-indigo-100 text-[11px] leading-snug">No assessment in progress. Pick one up from the queue.</p>
                <Link href="/assessor/queue"
                  className="block mt-3 text-center text-xs font-semibold bg-white text-indigo-700 hover:bg-indigo-50 py-2 rounded-lg transition-colors">
                  Open Queue →
                </Link>
              </>
            )}
          </div>

          {/* Workload donut */}
          <div className="bg-white border border-gray-100 rounded-2xl p-5">
            <h2 className="text-sm font-bold text-gray-900">My Workload</h2>
            <p className="text-[10px] text-gray-400 mb-3">{doneThisMonth} completed this month</p>
            {total === 0 ? (
              <p className="text-xs text-gray-400">No assessments recorded yet.</p>
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
                    <p className="text-xl font-extrabold text-gray-900 leading-none">{total}</p>
                    <p className="text-[9px] text-gray-400">Total</p>
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
            <Link href="/assessor/analytics" className="block mt-3 text-[11px] font-semibold text-indigo-600 hover:underline">View workload analytics →</Link>
          </div>

          {/* AI copilot */}
          <div className="bg-violet-50 border border-violet-100 rounded-2xl p-4">
            <h2 className="text-xs font-bold text-violet-900 mb-1.5">✨ AI Assessment Copilot</h2>
            <p className="text-[10px] text-violet-900/70 leading-snug mb-2">
              Sends your live operations picture — workload, expiries, risks and weakest competencies — for prioritisation advice.
            </p>
            <Link href={`/dashboard/copilot?scenario=${encodeURIComponent(copilotPrompt)}`}
              className="block text-center text-xs font-semibold text-violet-700 border border-violet-200 bg-white hover:bg-violet-100 py-2 rounded-lg transition-colors">
              Open Copilot →
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
