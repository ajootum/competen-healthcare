import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { computeRiskFlags, type NurseRisk } from "@/lib/engines/risk";
import GlobalSearch from "@/components/educator/GlobalSearch";
import QuickCreate from "@/components/educator/QuickCreate";
import CalendarWidget, { type CalEvent } from "@/components/educator/CalendarWidget";

// Educator Workspace dashboard — education operations centre (Final Dashboard
// & Sidebar Enhancement Specification + approved mockup). Every figure comes
// from live records; dimensions with no backing store (inter-rater agreement,
// in-progress/revision validation states) are labelled as not tracked, never
// simulated. Mockup marketing strips are replaced with the live AI copilot.

const SCORE_LABELS = ["Training Required","Novice","Advanced Beginner","Competent","Competent+","Proficient","Expert"];

const NOTIF_ICON: Record<string, string> = {
  logbook_pending: "📖", logbook_verified: "✅", logbook_rejected: "❌",
  logbook_changes_requested: "✏️", logbook_escalated: "⬆️", decisions_issued: "🧠",
  credential_added: "🏅", credential_submitted: "🏅",
  assessment_scheduled: "📅", assessment_cancelled: "🚫",
  senior_assessor_granted: "⭐", senior_assessor_revoked: "⭐",
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

export default async function EducatorDashboard() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();
  const { data: profile } = await admin.from("profiles").select("role, hospital_id, full_name").eq("id", user.id).single();
  if (!profile || !["educator","hospital_admin","super_admin"].includes(profile.role)) redirect("/dashboard");

  const nowIso = new Date().toISOString();
  const monthStart = `${nowIso.slice(0, 7)}-01`;
  const d28 = new Date(nowMs() - 28 * 86400000).toISOString();
  const d7 = new Date(nowMs() - 7 * 86400000).toISOString();
  const in60 = new Date(nowMs() + 60 * 86400000).toISOString();
  const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);

  const { data: hospitalNurses } = await admin
    .from("profiles").select("id, full_name")
    .eq("hospital_id", profile.hospital_id ?? "").eq("role", "nurse").limit(500);
  const nurseIds = (hospitalNurses ?? []).map(n => n.id);
  const nurseName = new Map((hospitalNurses ?? []).map(n => [n.id, n.full_name as string]));

  const noRows = Promise.resolve({ data: [] as never[] });
  const noCount = Promise.resolve({ count: 0 });

  const [
    { data: pendingScores }, { count: validatedMonth }, { count: validatedAll },
    { data: recentScores }, { data: assessedCompRows },
    { data: frameworkComps }, { data: courses }, { data: scheduled },
    { data: myNotifications }, { count: unreadCount },
    { data: appeals }, { data: audits },
  ] = await Promise.all([
    nurseIds.length ? admin.from("competency_scores").select("id, nurse_id, assessed_at")
      .eq("educator_validated", false).in("nurse_id", nurseIds) : noRows,
    nurseIds.length ? admin.from("competency_scores").select("id", { count: "exact", head: true })
      .eq("educator_validated", true).in("nurse_id", nurseIds).gte("assessed_at", monthStart) : noCount,
    nurseIds.length ? admin.from("competency_scores").select("id", { count: "exact", head: true })
      .eq("educator_validated", true).in("nurse_id", nurseIds) : noCount,
    nurseIds.length ? admin.from("competency_scores")
      .select("id, nurse_id, score, is_passing, assessed_at, educator_validated")
      .in("nurse_id", nurseIds).gte("assessed_at", d28).order("assessed_at", { ascending: false }).limit(1000) : noRows,
    nurseIds.length ? admin.from("competency_scores").select("competency_id")
      .in("nurse_id", nurseIds).limit(2000) : noRows,
    admin.from("framework_competencies")
      .select("id, framework_domains(frameworks(name))").limit(2000),
    admin.from("courses").select("id, is_published"),
    nurseIds.length ? admin.from("scheduled_assessments")
      .select("id, method, scheduled_for, profiles!nurse_id(full_name)")
      .in("nurse_id", nurseIds).eq("status", "scheduled")
      .gte("scheduled_for", dayStart.toISOString()).lte("scheduled_for", in60)
      .order("scheduled_for").limit(200) : noRows,
    admin.from("notifications").select("id, type, title, read, created_at, href")
      .eq("user_id", user.id).order("created_at", { ascending: false }).limit(5),
    admin.from("notifications").select("id", { count: "exact", head: true })
      .eq("user_id", user.id).eq("read", false),
    profile.hospital_id ? admin.from("appeals").select("id, status")
      .eq("hospital_id", profile.hospital_id).limit(500) : noRows,
    profile.hospital_id ? admin.from("audits").select("compliance_pct, conducted_at")
      .eq("hospital_id", profile.hospital_id).order("conducted_at", { ascending: false }).limit(200) : noRows,
  ]);

  let risks: NurseRisk[] = [];
  try { risks = await computeRiskFlags(admin, profile.hospital_id ?? ""); } catch { /* fail-soft */ }

  // ---- Stat cards ----
  const pendingCount = (pendingScores ?? []).length;
  const publishedCourses = (courses ?? []).filter(c => c.is_published).length;
  const monthScores = (recentScores ?? []).filter(s => s.assessed_at >= monthStart);
  const avgScore = monthScores.length
    ? monthScores.reduce((s, x) => s + x.score, 0) / monthScores.length : null;

  // ---- Validation overview donut (backed states only) ----
  const donutTotal = pendingCount + (validatedAll ?? 0);
  const donut = [
    { label: "Awaiting Review", n: pendingCount,       color: "#f59e0b" },
    { label: "Validated",       n: validatedAll ?? 0,  color: "#10b981" },
  ];
  const C = 2 * Math.PI * 40;
  let acc = 0;
  const arcs = donut.map(d => {
    const pct = donutTotal ? (d.n / donutTotal) * 100 : 0;
    const a = { ...d, pct, offset: acc }; acc += pct; return a;
  });

  // ---- Assessment performance (last 4 weeks) ----
  const weeks = [3, 2, 1, 0].map(w => {
    const from = nowMs() - (w + 1) * 7 * 86400000;
    const to = nowMs() - w * 7 * 86400000;
    const rows = (recentScores ?? []).filter(s => {
      const t = new Date(s.assessed_at).getTime();
      return t >= from && t < to;
    });
    const passRate = rows.length ? Math.round((rows.filter(r => r.is_passing).length / rows.length) * 100) : null;
    return { label: `Wk ${4 - w}`, passRate, n: rows.length };
  });
  const monthPassRate = monthScores.length
    ? Math.round((monthScores.filter(s => s.is_passing).length / monthScores.length) * 100) : null;
  const highScore = monthScores.length ? Math.max(...monthScores.map(s => s.score)) : null;
  const lowScore = monthScores.length ? Math.min(...monthScores.map(s => s.score)) : null;

  // ---- Learner progress snapshot (most recently active) ----
  const byNurse = new Map<string, { last: string; total: number; passing: number }>();
  for (const s of recentScores ?? []) {
    const agg = byNurse.get(s.nurse_id) ?? { last: s.assessed_at, total: 0, passing: 0 };
    agg.total++; if (s.is_passing) agg.passing++;
    if (s.assessed_at > agg.last) agg.last = s.assessed_at;
    byNurse.set(s.nurse_id, agg);
  }
  const snapshot = [...byNurse.entries()]
    .map(([id, a]) => ({
      id, name: nurseName.get(id) ?? "—",
      pct: Math.round((a.passing / a.total) * 100), n: a.total, last: a.last,
    }))
    .sort((a, b) => b.last.localeCompare(a.last)).slice(0, 4);

  // ---- Competency framework coverage ----
  const assessedIds = new Set((assessedCompRows ?? []).map(r => r.competency_id));
  const byFramework = new Map<string, { total: number; assessed: number }>();
  for (const fc of frameworkComps ?? []) {
    const fw = (fc.framework_domains as unknown as { frameworks: { name: string } | null } | null)?.frameworks?.name ?? "Other";
    const agg = byFramework.get(fw) ?? { total: 0, assessed: 0 };
    agg.total++; if (assessedIds.has(fc.id)) agg.assessed++;
    byFramework.set(fw, agg);
  }
  const coverage = [...byFramework.entries()]
    .map(([name, { total, assessed }]) => ({ name, total, assessed, pct: total ? Math.round((assessed / total) * 100) : 0 }))
    .sort((a, b) => b.total - a.total).slice(0, 4);
  const coverageTotal = (frameworkComps ?? []).length;
  const coveragePct = coverageTotal ? Math.round((assessedIds.size / coverageTotal) * 100) : 0;

  // ---- Assessment quality ----
  const overdue = (pendingScores ?? []).filter(p => p.assessed_at < d7).length;
  const appealStatusCounts = new Map<string, number>();
  for (const a of appeals ?? []) appealStatusCounts.set(a.status, (appealStatusCounts.get(a.status) ?? 0) + 1);
  const avgCompliance = (audits ?? []).length
    ? Math.round((audits ?? []).reduce((s, a) => s + (a.compliance_pct ?? 0), 0) / (audits ?? []).length) : null;

  // ---- Calendar events ----
  const calEvents: CalEvent[] = (scheduled ?? []).map(s => ({
    id: s.id, iso: s.scheduled_for,
    nurse: (s.profiles as unknown as { full_name: string } | null)?.full_name ?? "—",
    method: s.method,
  }));

  const greeting = hourNow() < 12 ? "Good morning" : hourNow() < 17 ? "Good afternoon" : "Good evening";
  const firstName = profile.full_name?.split(" ")[0] ?? "Educator";
  const attention = risks.slice(0, 4);

  const copilotPrompt = `I am a nurse educator. Live picture: ${pendingCount} scores awaiting my validation (${overdue} overdue past 7 days), ${validatedMonth ?? 0} validated this month, ${nurseIds.length} active learners, ${publishedCourses} published courses, month pass rate ${monthPassRate ?? "n/a"}%, framework coverage ${coveragePct}%, ${risks.length} learners flagged at risk${attention.length ? ` (${attention.map(r => r.nurseName).join(", ")})` : ""}, ${(appeals ?? []).length} appeals on record. Recommend my teaching and validation priorities this week and how to support the flagged learners.`;

  const STAT_CARDS = [
    { icon: "🕐", tint: "bg-purple-50 text-purple-600", label: "Pending Validations", value: String(pendingCount), sub: "View queue →", href: "/educator/validations" },
    { icon: "✅", tint: "bg-green-50 text-green-600",   label: "Completed Validations", value: String(validatedMonth ?? 0), sub: "This month", href: "/educator/validations" },
    { icon: "👥", tint: "bg-blue-50 text-blue-600",     label: "Active Learners", value: String(nurseIds.length), sub: "In your hospital", href: "/educator/students" },
    { icon: "📚", tint: "bg-amber-50 text-amber-600",   label: "Courses Managed", value: String((courses ?? []).length), sub: `${publishedCourses} published`, href: "/educator/courses" },
    { icon: "🎯", tint: "bg-rose-50 text-rose-600",     label: "Avg. Learner Score", value: avgScore !== null ? `${avgScore.toFixed(1)}/6` : "—", sub: avgScore !== null ? "This month" : "No scores this month", href: "/educator/students" },
  ];

  const QUICK_LAUNCH = [
    { icon: "✅", label: "Review Validations", href: "/educator/validations" },
    { icon: "👩‍⚕️", label: "Learners", href: "/educator/students" },
    { icon: "📚", label: "Courses", href: "/educator/courses" },
    { icon: "❓", label: "Question Bank", href: "/educator/questions" },
    { icon: "📥", label: "Bulk Import", href: "/educator/import" },
    { icon: "🗂️", label: "Resources", href: "/educator/library" },
  ];

  return (
    <div className="max-w-[1400px]">
      {/* Header: welcome + search + quick create + date + bell */}
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <div className="min-w-0 mr-auto">
          <h1 className="text-xl font-bold text-gray-900">{greeting}, {firstName}! 👋</h1>
          <p className="text-gray-400 text-sm mt-0.5">Here&apos;s what&apos;s happening in your educator workspace today.</p>
        </div>
        <GlobalSearch />
        <QuickCreate />
        <span className="hidden sm:flex items-center gap-1.5 bg-white border border-gray-200 rounded-xl px-3 py-2.5 text-xs text-gray-600" suppressHydrationWarning>
          📅 {new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
        </span>
        <Link href="/educator/notifications" aria-label="Notifications"
          className="relative bg-white border border-gray-200 rounded-xl w-10 h-10 flex items-center justify-center hover:border-purple-300 transition-colors">
          🔔
          {(unreadCount ?? 0) > 0 && (
            <span className="absolute -top-1.5 -right-1.5 bg-red-500 text-white text-[9px] font-bold rounded-full min-w-[16px] h-4 px-1 flex items-center justify-center">
              {(unreadCount ?? 0) > 99 ? "99+" : unreadCount}
            </span>
          )}
        </Link>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-3 mb-5">
        {STAT_CARDS.map(c => (
          <Link key={c.label} href={c.href} className="bg-white border border-gray-100 rounded-2xl p-4 hover:border-purple-200 transition-colors">
            <span className={`w-9 h-9 rounded-full flex items-center justify-center text-base ${c.tint}`}>{c.icon}</span>
            <p className="text-[11px] font-semibold text-gray-500 mt-2.5">{c.label}</p>
            <p className="text-2xl font-extrabold text-gray-900 leading-tight">{c.value}</p>
            <p className="text-[10px] text-gray-400 mt-0.5">{c.sub}</p>
          </Link>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-5 items-start mb-5">
        {/* Validation overview donut */}
        <div className="bg-white border border-gray-100 rounded-2xl p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-bold text-gray-900">Validation Overview</h2>
            <Link href="/educator/validations" className="text-[11px] font-semibold text-purple-600 hover:underline">View queue →</Link>
          </div>
          {donutTotal === 0 ? (
            <p className="text-xs text-gray-400">No assessment scores recorded yet.</p>
          ) : (
            <div className="flex items-center gap-5">
              <div className="relative w-28 shrink-0">
                <svg viewBox="0 0 100 100" className="w-full -rotate-90">
                  <circle cx="50" cy="50" r="40" fill="none" stroke="#f3f4f6" strokeWidth="12" />
                  {arcs.filter(a => a.pct > 0).map(a => (
                    <circle key={a.label} cx="50" cy="50" r="40" fill="none" stroke={a.color} strokeWidth="12"
                      strokeDasharray={`${(a.pct / 100) * C} ${C}`} strokeDashoffset={-(a.offset / 100) * C} />
                  ))}
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <p className="text-xl font-extrabold text-gray-900 leading-none">{pendingCount}</p>
                  <p className="text-[9px] text-gray-400">awaiting</p>
                </div>
              </div>
              <div className="flex flex-col gap-1.5 flex-1">
                {donut.map(d => (
                  <div key={d.label} className="flex items-center gap-2 text-[11px]">
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ background: d.color }} />
                    <span className="text-gray-500 flex-1">{d.label}</span>
                    <span className="font-bold text-gray-800">{d.n}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          <p className="text-[9px] text-gray-300 mt-3">In-progress and revision states aren&apos;t tracked yet.</p>
        </div>

        {/* Assessment calendar */}
        <div className="bg-white border border-gray-100 rounded-2xl p-5">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-bold text-gray-900">Assessment Calendar</h2>
            <span className="text-[10px] text-gray-400">{calEvents.length} scheduled</span>
          </div>
          <CalendarWidget events={calEvents} />
        </div>

        {/* Recent activity (live notifications) */}
        <div className="bg-white border border-gray-100 rounded-2xl p-5 lg:col-span-2 xl:col-span-1">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-bold text-gray-900">Recent Activity</h2>
            <Link href="/educator/notifications" className="text-[11px] font-semibold text-purple-600 hover:underline">View all →</Link>
          </div>
          {(myNotifications ?? []).length === 0 ? (
            <p className="text-xs text-gray-400">Nothing yet — events land here as they happen.</p>
          ) : (
            <div className="flex flex-col gap-2.5">
              {(myNotifications ?? []).map(n => (
                <Link key={n.id} href={n.href ?? "/educator/notifications"} className="flex items-start gap-2.5 group">
                  <span className="text-sm shrink-0 mt-0.5">{NOTIF_ICON[n.type] ?? "🔔"}</span>
                  <span className="min-w-0">
                    <span className={`block text-[11px] leading-snug group-hover:text-purple-700 ${n.read ? "text-gray-500" : "font-semibold text-gray-800"}`}>{n.title}</span>
                    <span className="block text-[9px] text-gray-300" suppressHydrationWarning>{fmtAgo(n.created_at)}</span>
                  </span>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-start mb-5">
        {/* Learners requiring attention */}
        <div className="bg-white border border-gray-100 rounded-2xl p-5">
          <h2 className="text-sm font-bold text-gray-900 mb-0.5">Learners Requiring Attention</h2>
          <p className="text-[10px] text-gray-400 mb-3">Risk flags from live decisions — critical failures, expiries, not-yet-competent</p>
          {attention.length === 0 ? (
            <p className="text-xs text-gray-400">No learners flagged at risk. 🎉</p>
          ) : (
            <div className="flex flex-col gap-2.5">
              {attention.map(r => (
                <div key={r.nurseId} className="flex items-start gap-2.5">
                  <span className="w-7 h-7 rounded-full bg-red-50 text-red-600 flex items-center justify-center text-[10px] font-bold shrink-0">
                    {r.nurseName.split(" ").map(w => w[0]).slice(0, 2).join("")}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[12px] font-semibold text-gray-800 truncate">{r.nurseName}</p>
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
          <Link href="/educator/students" className="block mt-3 text-[11px] font-semibold text-purple-600 hover:underline">View all learners →</Link>
        </div>

        {/* Learner progress snapshot */}
        <div className="bg-white border border-gray-100 rounded-2xl p-5">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h2 className="text-sm font-bold text-gray-900">Learner Progress Snapshot</h2>
              <p className="text-[10px] text-gray-400">Most recently assessed · % of scores passing, last 28 days</p>
            </div>
            <Link href="/educator/students" className="text-[11px] font-semibold text-purple-600 hover:underline shrink-0">View all →</Link>
          </div>
          {snapshot.length === 0 ? (
            <p className="text-xs text-gray-400">No assessments in the last 28 days.</p>
          ) : (
            <div className="flex flex-col gap-2.5">
              {snapshot.map(s => (
                <div key={s.id} className="flex items-center gap-3">
                  <span className="w-7 h-7 rounded-full bg-purple-50 text-purple-700 flex items-center justify-center text-[10px] font-bold shrink-0">
                    {s.name.split(" ").map(w => w[0]).slice(0, 2).join("")}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[12px] font-semibold text-gray-800 truncate">{s.name}</p>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                        <div className={`h-full rounded-full ${s.pct >= 80 ? "bg-green-500" : s.pct >= 50 ? "bg-amber-400" : "bg-red-400"}`}
                          style={{ width: `${s.pct}%` }} />
                      </div>
                      <span className="text-[10px] font-bold text-gray-700 w-8 text-right shrink-0">{s.pct}%</span>
                    </div>
                  </div>
                  <span className="text-[9px] text-gray-400 shrink-0" suppressHydrationWarning>{fmtAgo(s.last)}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Assessment performance */}
        <div className="bg-white border border-gray-100 rounded-2xl p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-bold text-gray-900">Assessment Performance <span className="font-normal text-gray-400 text-xs">(This Month)</span></h2>
          </div>
          {monthScores.length === 0 ? (
            <p className="text-xs text-gray-400">No scores recorded this month.</p>
          ) : (
            <div className="grid grid-cols-[auto_1fr] gap-5 items-center">
              <div className="flex flex-col gap-1.5">
                {[
                  { label: "Average Score", v: avgScore !== null ? `${avgScore.toFixed(1)}/6` : "—", cls: "bg-green-50 text-green-700" },
                  { label: "Highest Score", v: highScore !== null ? `${highScore} · ${SCORE_LABELS[highScore]}` : "—", cls: "bg-green-50 text-green-700" },
                  { label: "Lowest Score", v: lowScore !== null ? `${lowScore} · ${SCORE_LABELS[lowScore]}` : "—", cls: "bg-red-50 text-red-600" },
                  { label: "Pass Rate", v: monthPassRate !== null ? `${monthPassRate}%` : "—", cls: "bg-gray-50 text-gray-800" },
                ].map(row => (
                  <div key={row.label} className="flex items-center gap-3">
                    <span className="text-[11px] text-gray-500 w-24">{row.label}</span>
                    <span className={`text-[11px] font-bold px-2 py-0.5 rounded ${row.cls}`}>{row.v}</span>
                  </div>
                ))}
              </div>
              {/* Weekly pass-rate line */}
              <div>
                <svg viewBox="0 0 200 90" className="w-full">
                  {[0, 25, 50, 75, 100].map(y => (
                    <line key={y} x1="24" x2="196" y1={78 - (y * 0.68)} y2={78 - (y * 0.68)} stroke="#f3f4f6" strokeWidth="1" />
                  ))}
                  {[0, 50, 100].map(y => (
                    <text key={y} x="20" y={81 - (y * 0.68)} fontSize="7" fill="#c4c4cc" textAnchor="end">{y}%</text>
                  ))}
                  {(() => {
                    const pts = weeks.map((w, i) => ({ x: 40 + i * 48, y: w.passRate !== null ? 78 - w.passRate * 0.68 : null, w }));
                    const line = pts.filter(p => p.y !== null);
                    return (
                      <>
                        {line.length > 1 && (
                          <polyline fill="none" stroke="#9333ea" strokeWidth="1.5"
                            points={line.map(p => `${p.x},${p.y}`).join(" ")} />
                        )}
                        {pts.map(p => p.y !== null ? (
                          <circle key={p.x} cx={p.x} cy={p.y} r="2.5" fill="#9333ea" />
                        ) : null)}
                        {pts.map(p => (
                          <text key={`l-${p.x}`} x={p.x} y="88" fontSize="7" fill="#9ca3af" textAnchor="middle">{p.w.label}</text>
                        ))}
                      </>
                    );
                  })()}
                </svg>
                <p className="text-[9px] text-gray-300 text-center">Pass rate by week · gaps mean no assessments that week</p>
              </div>
            </div>
          )}
        </div>

        {/* Coverage + quality stacked */}
        <div className="flex flex-col gap-5">
          {/* Competency framework coverage */}
          <div className="bg-white border border-gray-100 rounded-2xl p-5">
            <div className="flex items-center justify-between mb-0.5">
              <h2 className="text-sm font-bold text-gray-900">Competency Framework Coverage</h2>
              <span className="text-xs font-extrabold text-purple-700">{coveragePct}%</span>
            </div>
            <p className="text-[10px] text-gray-400 mb-3">{assessedIds.size} of {coverageTotal} competencies have recorded assessments</p>
            {coverage.length === 0 ? (
              <p className="text-xs text-gray-400">No frameworks installed yet.</p>
            ) : (
              <div className="flex flex-col gap-1.5">
                {coverage.map(f => (
                  <div key={f.name} className="flex items-center gap-2">
                    <span className="text-[10px] text-gray-500 w-36 truncate shrink-0">{f.name}</span>
                    <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div className={`h-full rounded-full ${f.pct >= 80 ? "bg-green-500" : f.pct >= 40 ? "bg-amber-400" : "bg-purple-400"}`}
                        style={{ width: `${f.pct}%` }} />
                    </div>
                    <span className="text-[10px] font-bold text-gray-700 w-9 text-right shrink-0">{f.pct}%</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Assessment quality */}
          <div className="bg-white border border-gray-100 rounded-2xl p-5">
            <h2 className="text-sm font-bold text-gray-900 mb-3">Assessment Quality</h2>
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <p className="text-[11px] text-gray-600">⏰ Overdue validations <span className="text-gray-300">(&gt;7 days)</span></p>
                <p className={`text-[11px] font-bold ${overdue > 0 ? "text-red-600" : "text-gray-900"}`}>{overdue}</p>
              </div>
              <div className="flex items-center justify-between">
                <p className="text-[11px] text-gray-600">⚖️ Appeals on record</p>
                <p className="text-[11px] font-bold text-gray-900">
                  {(appeals ?? []).length}
                  {appealStatusCounts.size > 0 && (
                    <span className="font-normal text-gray-400"> ({[...appealStatusCounts.entries()].map(([s, n]) => `${n} ${s}`).join(", ")})</span>
                  )}
                </p>
              </div>
              <div className="flex items-center justify-between">
                <p className="text-[11px] text-gray-600">🛡️ Audit compliance <span className="text-gray-300">(avg)</span></p>
                <p className="text-[11px] font-bold text-gray-900">{avgCompliance !== null ? `${avgCompliance}%` : "—"}</p>
              </div>
            </div>
            <p className="text-[9px] text-gray-300 mt-2.5">Inter-rater agreement needs double-scored encounters — not tracked yet.</p>
          </div>
        </div>
      </div>

      {/* Quick launch */}
      <div className="bg-white border border-gray-100 rounded-2xl p-4 mb-5">
        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2.5">Quick Launch</p>
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
          {QUICK_LAUNCH.map(q => (
            <Link key={q.label} href={q.href}
              className="flex flex-col items-center gap-1 rounded-xl border border-gray-100 hover:border-purple-200 hover:bg-purple-50/40 py-3 transition-colors">
              <span className="text-lg">{q.icon}</span>
              <span className="text-[10px] font-semibold text-gray-600 text-center leading-tight px-1">{q.label}</span>
            </Link>
          ))}
        </div>
      </div>

      {/* AI insights strip (live copilot, replaces the mockup tip banner) */}
      <div className="bg-violet-50 border border-violet-100 rounded-2xl px-5 py-4 flex flex-wrap items-center gap-3">
        <span className="text-lg">✨</span>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-bold text-violet-900">AI Educator Copilot</p>
          <p className="text-[11px] text-violet-900/70 leading-snug">
            {pendingCount > 0 || risks.length > 0
              ? `${pendingCount} validation${pendingCount === 1 ? "" : "s"} waiting and ${risks.length} learner${risks.length === 1 ? "" : "s"} flagged — ask for a prioritised plan built from your live data.`
              : "Queue clear and no learners flagged — ask the Copilot to help plan next month's teaching."}
          </p>
        </div>
        <Link href={`/dashboard/copilot?scenario=${encodeURIComponent(copilotPrompt)}`}
          className="shrink-0 text-xs font-semibold text-violet-700 border border-violet-200 bg-white hover:bg-violet-100 px-4 py-2 rounded-lg transition-colors">
          Open Copilot →
        </Link>
      </div>

      {/* Floating AI copilot (spec) — same live-context link, always in reach */}
      <Link href={`/dashboard/copilot?scenario=${encodeURIComponent(copilotPrompt)}`}
        aria-label="AI Educator Copilot"
        className="fixed bottom-6 right-6 z-30 w-12 h-12 rounded-full bg-purple-600 hover:bg-purple-700 text-white text-xl flex items-center justify-center shadow-lg shadow-purple-600/30 transition-colors">
        ✨
      </Link>
    </div>
  );
}
