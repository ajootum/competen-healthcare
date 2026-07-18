import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { generateAssessorQueue } from "@/lib/engines/tasks";
import { computeRiskFlags, type NurseRisk } from "@/lib/engines/risk";
import SmartQueue from "./SmartQueue";

// Assessor Dashboard (Sidebar Redesign spec §Dashboard): live KPI strip, the
// generated assessment queue, assigned assessments, real workload breakdown
// and an activity feed from the audit log. "Today's schedule" needs a
// scheduling store that doesn't exist — omitted, not simulated.

const METHOD_ICONS: Record<string, string> = {
  knowledge: "📝", direct_observation: "👁️", simulation: "🎮",
  osce: "🏥", concurrent_audit: "📋", retrospective_audit: "🗂️", logbook: "📓",
};

const ACTION_LABELS: Record<string, string> = {
  verify_skill_entry: "verified a logbook entry",
  reject_skill_entry: "rejected a logbook entry",
  request_skill_entry_changes: "requested logbook changes",
  log_skill: "logged a skill",
  upload_evidence: "uploaded evidence",
  update_profile: "updated your profile",
  change_password: "changed your password",
};

const nowMs = () => Date.now();
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

  const [
    { data: myPending }, { data: allMine }, { data: recentDone },
    { count: logbookPending },
    { data: activity },
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
    admin.from("assessments")
      .select("id, method, score, assessed_at, framework_competencies!competency_id(name)")
      .eq("assessor_id", user.id).eq("status", "complete")
      .order("assessed_at", { ascending: false }).limit(4),
    admin.from("skill_log_entries").select("id", { count: "exact", head: true })
      .eq("status", "pending").neq("nurse_id", user.id),
    admin.from("audit_log").select("action, entity_name, created_at")
      .eq("actor_id", user.id).order("created_at", { ascending: false }).limit(6),
  ]);

  let queue: Awaited<ReturnType<typeof generateAssessorQueue>> = { tasks: [], workload: { tasks: 0, estMinutes: 0, learners: 0, urgent: 0 } };
  try {
    queue = await generateAssessorQueue(admin, profile.hospital_id ?? "", user.id);
  } catch { /* requirement matrix not installed yet */ }

  // Risk flags — derived from real decisions (critical failures, non-passing, expired)
  let risks: NurseRisk[] = [];
  try {
    risks = await computeRiskFlags(admin, profile.hospital_id ?? "");
  } catch { /* fail-soft */ }
  const riskCount = risks.reduce((s, r) => s + r.flags.length, 0);

  // Today's schedule — real sessions from the scheduling store (empty until migration 030)
  const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart); dayEnd.setDate(dayEnd.getDate() + 1);
  const nowIso = new Date().toISOString();
  const in7d = new Date(nowMs() + 7 * 86400000).toISOString();
  const [{ data: todaySessions }, { count: overdueSessions }, { count: upcomingOsce }] = await Promise.all([
    admin.from("scheduled_assessments")
      .select("id, method, scheduled_for, location, status, profiles!nurse_id(full_name)")
      .eq("assessor_id", user.id).eq("status", "scheduled")
      .gte("scheduled_for", dayStart.toISOString()).lt("scheduled_for", dayEnd.toISOString())
      .order("scheduled_for"),
    admin.from("scheduled_assessments").select("id", { count: "exact", head: true })
      .eq("assessor_id", user.id).eq("status", "scheduled").lt("scheduled_for", nowIso),
    admin.from("scheduled_assessments").select("id", { count: "exact", head: true })
      .eq("assessor_id", user.id).eq("status", "scheduled").eq("method", "osce")
      .gte("scheduled_for", nowIso).lt("scheduled_for", in7d),
  ]);

  // Competency coverage by domain — hospital-wide, latest decision per
  // nurse+competency, % passing (real decisions only).
  const { data: hospNurses } = await admin.from("profiles")
    .select("id").eq("hospital_id", profile.hospital_id ?? "").eq("role", "nurse").limit(200);
  const coverage: { domain: string; pct: number; n: number }[] = [];
  if (hospNurses?.length) {
    const { data: hospDecisions } = await admin.from("competency_decisions")
      .select("nurse_id, competency_id, outcome, created_at, framework_competencies(framework_domains(name))")
      .in("nurse_id", hospNurses.map(n => n.id)).order("created_at", { ascending: false });
    const seenDec = new Set<string>();
    const byDomain = new Map<string, { pass: number; total: number }>();
    for (const d of hospDecisions ?? []) {
      const key = `${d.nurse_id}:${d.competency_id}`;
      if (seenDec.has(key)) continue;
      seenDec.add(key);
      const domain = (d.framework_competencies as unknown as { framework_domains: { name: string } | null } | null)?.framework_domains?.name ?? "Other";
      const agg = byDomain.get(domain) ?? { pass: 0, total: 0 };
      agg.total++;
      const passing = ["competent", "provisionally_competent", "competent_with_conditions"].includes(d.outcome);
      if (passing) agg.pass++;
      byDomain.set(domain, agg);
    }
    for (const [domain, { pass, total: t }] of [...byDomain.entries()].sort((a, b) => b[1].total - a[1].total)) {
      coverage.push({ domain, pct: Math.round((pass / t) * 100), n: t });
    }
  }

  // Workload (all real): my assessments by status + average turnaround
  const mine = allMine ?? [];
  const done = mine.filter(a => a.status === "complete");
  const inProgress = mine.filter(a => a.status === "in_progress").length;
  const pending = mine.filter(a => a.status === "pending").length;
  const monthKey = new Date().toISOString().slice(0, 7);
  const doneThisMonth = done.filter(a => a.assessed_at?.slice(0, 7) === monthKey).length;
  const turnarounds = done
    .filter(a => a.assessed_at && a.created_at)
    .map(a => (new Date(a.assessed_at!).getTime() - new Date(a.created_at).getTime()) / 86400000)
    .filter(d => d >= 0);
  const avgTurnaround = turnarounds.length
    ? Math.round((turnarounds.reduce((s, d) => s + d, 0) / turnarounds.length) * 10) / 10 : null;

  const total = mine.length;
  const seg = (n: number) => total ? (n / total) * 100 : 0;
  const donut = [
    { label: "Completed",   n: done.length, pct: seg(done.length), color: "#10b981" },
    { label: "In Progress", n: inProgress,  pct: seg(inProgress),  color: "#3b82f6" },
    { label: "Pending",     n: pending,     pct: seg(pending),     color: "#f59e0b" },
  ];
  const C = 2 * Math.PI * 40; // donut circumference (r=40)
  let acc = 0;
  const arcs = donut.map(d => { const a = { ...d, offset: acc }; acc += d.pct; return a; });

  const firstName = profile.full_name?.split(" ")[0] ?? "Assessor";

  // Rule-derived recommendations (v2 §5): reassessment needs, evidence
  // backlog, overdue sessions, critical-failure alerts — each a deep link.
  const reassessNurses = risks.filter(r => r.flags.some(f => f.type === "expired" || f.type === "not_competent")).length;
  const criticalFlag = risks.flatMap(r => r.flags.filter(f => f.type === "critical_failure").map(f => ({ nurse: r.nurseName, competency: f.competency })))[0];
  const recommendations: { text: string; sub: string; href: string }[] = [];
  if (reassessNurses > 0) recommendations.push({
    text: `${reassessNurses} nurse${reassessNurses === 1 ? "" : "s"} need${reassessNurses === 1 ? "s" : ""} reassessment`,
    sub: "Non-passing or expired competencies on record", href: "/assessor/remediation",
  });
  if ((logbookPending ?? 0) > 0) recommendations.push({
    text: `${logbookPending} logbook entr${logbookPending === 1 ? "y" : "ies"} awaiting validation`,
    sub: "Review the evidence and verify or reject", href: "/assessor/logbook",
  });
  if ((overdueSessions ?? 0) > 0) recommendations.push({
    text: `${overdueSessions} scheduled session${overdueSessions === 1 ? "" : "s"} past due`,
    sub: "Complete or reschedule them from the calendar", href: "/assessor/calendar",
  });
  if (criticalFlag) recommendations.push({
    text: `Critical failure recorded: ${criticalFlag.competency}`,
    sub: `${criticalFlag.nurse} — review before any independent practice`, href: "/assessor/remediation",
  });

  // v2 §3 KPI set — every figure live (overdue/OSCE from the scheduling store)
  const KPIS = [
    { icon: "📥", value: myPending?.length ?? 0, label: "Assessments Due",        sub: "assigned to you",       href: "/assessor/queue",       tint: "bg-indigo-50" },
    { icon: "⏳", value: overdueSessions ?? 0,   label: "Overdue Sessions",       sub: "past scheduled time",   href: "/assessor/calendar",    tint: "bg-orange-50" },
    { icon: "🖊️", value: logbookPending ?? 0,    label: "Pending Validations",    sub: "logbook & evidence",    href: "/assessor/logbook",     tint: "bg-amber-50" },
    { icon: "🏥", value: upcomingOsce ?? 0,      label: "Upcoming OSCEs",         sub: "next 7 days",           href: "/assessor/calendar",    tint: "bg-blue-50" },
    { icon: "🛑", value: riskCount,              label: "Risk Flags",             sub: "from live decisions",   href: "/assessor/remediation", tint: "bg-red-50" },
  ];

  const copilotPrompt = `I am a clinical assessor. My live workload: ${myPending?.length ?? 0} assigned assessments (pending or in progress), ${logbookPending ?? 0} logbook entries awaiting verification, ${queue.workload.tasks} generated queue tasks (${queue.workload.urgent} urgent) across ${queue.workload.learners} learners, and ${done.length} completed assessments all-time. Give me practical prioritisation advice for today: what to tackle first and why, plus tips for efficient, fair assessment.`;

  return (
    <div className="max-w-6xl">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-xl font-bold text-gray-900">Welcome back, {firstName}!</h1>
        <p className="text-gray-400 text-sm mt-0.5">Here&apos;s what&apos;s happening with your assessments today.</p>
      </div>

      {/* KPI strip (v2 §3) */}
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-3 mb-6">
        {KPIS.map(k => (
          <Link key={k.label} href={k.href} className="bg-white border border-gray-100 rounded-2xl p-4 hover:border-indigo-200 transition-colors group">
            <span className={`w-9 h-9 rounded-xl ${k.tint} flex items-center justify-center text-lg`}>{k.icon}</span>
            <p className="text-2xl font-extrabold text-gray-900 mt-2 leading-none">{k.value}</p>
            <p className="text-[11px] font-semibold text-gray-700 mt-1 leading-tight">{k.label}</p>
            <p className="text-[10px] text-gray-400">{k.sub}</p>
            <p className="text-[10px] font-semibold text-indigo-600 mt-1.5 opacity-0 group-hover:opacity-100 transition-opacity">View all →</p>
          </Link>
        ))}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_300px] gap-5 items-start">
        {/* Main column */}
        <div className="min-w-0 flex flex-col gap-5">
          {/* Today's schedule — real scheduled sessions */}
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

          {/* Generated queue */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-sm font-bold text-gray-900">Assessment Queue</h2>
              <Link href="/assessor/queue" className="text-[11px] font-semibold text-indigo-600 hover:underline">View all →</Link>
            </div>
            <SmartQueue tasks={queue.tasks.slice(0, 5)} workload={queue.workload} />
          </div>

          {/* Assigned assessments */}
          <div className="bg-white border border-gray-100 rounded-2xl overflow-hidden">
            <div className="px-5 py-3.5 border-b border-gray-100 flex items-center justify-between">
              <div>
                <h2 className="text-sm font-bold text-gray-900">My Assessments</h2>
                <p className="text-[10px] text-gray-400">Assigned to you, awaiting completion</p>
              </div>
              <Link href="/assessor/assess" className="text-[11px] font-semibold bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-1.5 rounded-lg transition-colors">
                ＋ Conduct Assessment
              </Link>
            </div>
            {(myPending ?? []).length === 0 ? (
              <p className="px-5 py-8 text-center text-xs text-gray-400">Nothing assigned right now — pick a nurse under Conduct Assessment.</p>
            ) : (
              <div className="divide-y divide-gray-50">
                {(myPending ?? []).map(a => {
                  const cyc = a.competency_cycles as unknown as { cycle_type: string | null; profiles: { full_name: string } | null } | null;
                  const comp = a.framework_competencies as unknown as { name: string; framework_domains: { name: string } | null } | null;
                  return (
                    <div key={a.id} className="px-5 py-3 flex items-center gap-3">
                      <span className="w-8 h-8 rounded-lg bg-gray-50 flex items-center justify-center text-base shrink-0">
                        {METHOD_ICONS[a.method] ?? "📄"}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-gray-800 truncate">
                          <b>{cyc?.profiles?.full_name ?? "—"}</b> · {comp?.name ?? "Competency"}
                        </p>
                        <p className="text-[10px] text-gray-400 capitalize">
                          {a.method.replace(/_/g, " ")}{comp?.framework_domains?.name ? ` · ${comp.framework_domains.name}` : ""}
                        </p>
                      </div>
                      <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded shrink-0 ${
                        a.status === "in_progress" ? "bg-blue-50 text-blue-600" : "bg-amber-50 text-amber-700"
                      }`}>
                        {a.status === "in_progress" ? "In progress" : "Pending"}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Competency coverage by domain (v2 §4) — hospital-wide, real decisions */}
          {coverage.length > 0 && (
            <div className="bg-white border border-gray-100 rounded-2xl p-5">
              <div className="flex items-center justify-between mb-1">
                <h2 className="text-sm font-bold text-gray-900">Competency Coverage Overview</h2>
                <Link href="/assessor/nurses" className="text-[11px] font-semibold text-indigo-600 hover:underline">View nurses →</Link>
              </div>
              <p className="text-[10px] text-gray-400 mb-4">% of latest decisions passing, per domain, across your hospital&apos;s nurses.</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-3">
                {coverage.slice(0, 6).map(c => (
                  <div key={c.domain}>
                    <div className="flex items-center justify-between mb-1">
                      <p className="text-[11px] font-semibold text-gray-700 truncate">{c.domain}</p>
                      <p className="text-[11px] font-bold text-gray-900 shrink-0">{c.pct}%</p>
                    </div>
                    <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div className={`h-full rounded-full ${c.pct >= 80 ? "bg-green-500" : c.pct >= 50 ? "bg-amber-400" : "bg-red-400"}`}
                        style={{ width: `${c.pct}%` }} />
                    </div>
                    <p className="text-[9px] text-gray-300 mt-0.5">{c.n} decision{c.n === 1 ? "" : "s"}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Quick actions (v2 §6 — real destinations only) */}
          <div className="bg-white border border-gray-100 rounded-2xl p-4">
            <p className="text-xs font-bold text-gray-700 mb-3">Quick Actions</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
              {[
                { icon: "📝", label: "Conduct Assessment", sub: "Score a nurse",        href: "/assessor/assess" },
                { icon: "📅", label: "Schedule Session",   sub: "Incl. OSCE",           href: "/assessor/calendar" },
                { icon: "🖊️", label: "Validate Evidence",  sub: "Review submissions",   href: "/assessor/logbook" },
                { icon: "📋", label: "Concurrent Audit",   sub: "Bedside comparison",   href: "/dashboard/audit/concurrent" },
                { icon: "📊", label: "Generate Report",    sub: "CSV export",           href: "/assessor/analytics" },
                { icon: "🎯", label: "Remediation",        sub: "Plans & reassessment", href: "/assessor/remediation" },
              ].map(qa => (
                <Link key={qa.href} href={qa.href}
                  className="border border-gray-100 hover:border-indigo-300 rounded-xl p-3 text-center transition-colors group">
                  <p className="text-lg">{qa.icon}</p>
                  <p className="text-[10px] font-semibold text-gray-700 group-hover:text-indigo-700 leading-tight mt-1">{qa.label}</p>
                  <p className="text-[9px] text-gray-400 leading-tight">{qa.sub}</p>
                </Link>
              ))}
            </div>
          </div>

          <p className="text-center text-[9px] text-gray-300">
            COMPETEN Assessor Workspace · Empowering excellence in healthcare competency
          </p>
        </div>

        {/* Right rail */}
        <div className="flex flex-col gap-4">
          {/* Risk flags — from live decisions */}
          {risks.length > 0 && (
            <div className="bg-red-50 border border-red-100 rounded-2xl p-4">
              <div className="flex items-center justify-between mb-2.5">
                <h2 className="text-xs font-bold text-red-800">🛑 Risk Flags</h2>
                <Link href="/assessor/remediation" className="text-[10px] font-semibold text-red-700 hover:underline">Review →</Link>
              </div>
              <div className="flex flex-col gap-2">
                {risks.slice(0, 4).map(r => (
                  <div key={r.nurseId} className="min-w-0">
                    <p className="text-[11px] font-semibold text-red-900 truncate">{r.nurseName}</p>
                    <p className="text-[10px] text-red-800/70 leading-snug truncate">
                      {r.flags.slice(0, 2).map(f =>
                        `${f.type === "critical_failure" ? "Critical failure" : f.type === "expired" ? "Expired" : "Not yet competent"}: ${f.competency}`,
                      ).join(" · ")}{r.flags.length > 2 ? ` · +${r.flags.length - 2} more` : ""}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Workload */}
          <div className="bg-white border border-gray-100 rounded-2xl p-5">
            <h2 className="text-sm font-bold text-gray-900">My Workload</h2>
            <p className="text-[10px] text-gray-400 mb-3">{doneThisMonth} completed this month</p>
            {total === 0 ? (
              <p className="text-xs text-gray-400">No assessments recorded yet.</p>
            ) : (
              <>
                <div className="relative w-32 mx-auto">
                  <svg viewBox="0 0 100 100" className="w-full -rotate-90">
                    <circle cx="50" cy="50" r="40" fill="none" stroke="#f3f4f6" strokeWidth="12" />
                    {arcs.filter(a => a.pct > 0).map(a => (
                      <circle key={a.label} cx="50" cy="50" r="40" fill="none" stroke={a.color} strokeWidth="12"
                        strokeDasharray={`${(a.pct / 100) * C} ${C}`} strokeDashoffset={-(a.offset / 100) * C} />
                    ))}
                  </svg>
                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <p className="text-2xl font-extrabold text-gray-900 leading-none">{total}</p>
                    <p className="text-[9px] text-gray-400">Total</p>
                  </div>
                </div>
                <div className="mt-3 flex flex-col gap-1.5">
                  {donut.map(d => (
                    <div key={d.label} className="flex items-center gap-2 text-[11px]">
                      <span className="w-2 h-2 rounded-full shrink-0" style={{ background: d.color }} />
                      <span className="text-gray-500 flex-1">{d.label}</span>
                      <span className="font-semibold text-gray-700">{d.n} ({Math.round(d.pct)}%)</span>
                    </div>
                  ))}
                </div>
                <div className="flex items-center justify-between mt-3 pt-3 border-t border-gray-50 text-[11px]">
                  <span className="text-gray-400">Average turnaround</span>
                  <span className="font-bold text-green-600">{avgTurnaround !== null ? `${avgTurnaround} days` : "—"}</span>
                </div>
              </>
            )}
          </div>

          {/* Recent activity — real audit-log feed */}
          <div className="bg-white border border-gray-100 rounded-2xl p-5">
            <h2 className="text-sm font-bold text-gray-900 mb-3">Recent Activity</h2>
            {(activity ?? []).length === 0 && (recentDone ?? []).length === 0 ? (
              <p className="text-xs text-gray-400">Your actions will appear here.</p>
            ) : (
              <div className="flex flex-col gap-2.5">
                {(activity ?? []).map((a, i) => (
                  <div key={i} className="flex items-start gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 mt-1.5 shrink-0" />
                    <div className="min-w-0">
                      <p className="text-[11px] text-gray-700 leading-snug">
                        You {ACTION_LABELS[a.action] ?? a.action.replace(/_/g, " ")}
                        {a.entity_name ? <span className="text-gray-400"> — {a.entity_name}</span> : null}
                      </p>
                      <p className="text-[9px] text-gray-300" suppressHydrationWarning>{fmtAgo(a.created_at)}</p>
                    </div>
                  </div>
                ))}
                {(recentDone ?? []).map(r => (
                  <div key={r.id} className="flex items-start gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-green-400 mt-1.5 shrink-0" />
                    <div className="min-w-0">
                      <p className="text-[11px] text-gray-700 leading-snug">
                        Scored <b>{(r.framework_competencies as unknown as { name: string } | null)?.name ?? "a competency"}</b> — {r.score}/6
                      </p>
                      <p className="text-[9px] text-gray-300" suppressHydrationWarning>{r.assessed_at ? fmtAgo(r.assessed_at) : ""}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Copilot recommendations (v2 §5) — rule-derived from live records,
              with the AI handoff for narrative advice */}
          <div className="bg-violet-50 border border-violet-100 rounded-2xl p-4">
            <h2 className="text-xs font-bold text-violet-900 mb-0.5">✨ Copilot Recommendations</h2>
            <p className="text-[9px] text-violet-900/50 mb-2.5">Rule-based, from your live records</p>
            <div className="flex flex-col gap-1.5 mb-2.5">
              {recommendations.length === 0 ? (
                <p className="text-[10px] text-violet-900/60">Nothing needs attention right now.</p>
              ) : recommendations.map(rec => (
                <Link key={rec.text} href={rec.href}
                  className="bg-white border border-violet-100 hover:border-violet-300 rounded-lg px-3 py-2 transition-colors group">
                  <p className="text-[11px] font-semibold text-violet-900 leading-snug">{rec.text} <span className="opacity-0 group-hover:opacity-100 transition-opacity">→</span></p>
                  <p className="text-[9px] text-violet-900/60 leading-snug">{rec.sub}</p>
                </Link>
              ))}
            </div>
            <Link href={`/dashboard/copilot?scenario=${encodeURIComponent(copilotPrompt)}`}
              className="block text-center text-xs font-semibold text-violet-700 border border-violet-200 bg-white hover:bg-violet-100 py-2 rounded-lg transition-colors">
              Ask the AI Copilot →
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
