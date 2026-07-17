import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import Link from "next/link";
import { ROLE_CONFIG, highestRole, type AppRole } from "@/lib/roles";
import { OUTCOME_CONFIG } from "@/lib/ckcm";
import { latestPerCompetency, computeReadiness } from "@/lib/engines/career";

// Healthcare Worker dashboard — the Professional Clinical Command Center
// (Nurse Dashboard Redesign Specification). Every widget is driven by the
// nurse's real governed record; widgets with no data show honest empty states
// rather than sample numbers. Sections the schema cannot back (shift roster,
// messaging) are omitted rather than faked.

const SCORE_COLORS = ["#ef4444", "#f97316", "#eab308", "#14b8a6", "#0d9488", "#3b82f6", "#8b5cf6"];
const CYCLE_COLORS: Record<string, string> = {
  orientation: "bg-blue-100 text-blue-700",
  probation:   "bg-amber-100 text-amber-700",
  annual:      "bg-teal-100 text-teal-700",
  remediation: "bg-red-100 text-red-600",
  specialty:   "bg-violet-100 text-violet-700",
};

const dayMs = 86400000;
// Server component renders once per request, so "now" is stable for a render.
const nowMs = () => Date.now();
const daysAgo = (n: number) => new Date(nowMs() - n * dayMs).toISOString();
const fmtDate = (iso: string | null) => iso ? new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "—";

function Ring({ pct, size = 72 }: { pct: number; size?: number }) {
  const r = (size - 10) / 2, c = 2 * Math.PI * r;
  const color = pct >= 80 ? "#22c55e" : pct >= 50 ? "#14b8a6" : "#f59e0b";
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`${pct}% complete`}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#f3f4f6" strokeWidth="7" />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth="7"
        strokeDasharray={`${Math.max((pct / 100) * c, 1)} ${c}`} strokeLinecap="round"
        transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      <text x={size / 2} y={size / 2 + 1} textAnchor="middle" dominantBaseline="middle" fontSize={size / 4.5} fontWeight="700" fill="#111827">{pct}%</text>
    </svg>
  );
}

export default async function DashboardPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();
  const { data: profile } = await admin.from("profiles").select("*").eq("id", user.id).single();
  if (!profile) redirect("/login");

  const userRoles: AppRole[] = (profile.roles?.length ? profile.roles : [profile.role]).filter(Boolean) as AppRole[];
  const cookieStore = await cookies();
  const activeRole = (cookieStore.get("active_role")?.value ?? highestRole(userRoles)) as AppRole;
  if (activeRole !== "nurse") redirect(ROLE_CONFIG[activeRole].portal);

  const firstName = profile.full_name?.split(" ")[0] ?? "Nurse";
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  const [
    { data: hospital }, { data: department },
    { data: cycles }, { data: decisions }, { data: pathway },
    { data: credentials }, { data: recognitions }, { data: authz },
    { data: benner },
  ] = await Promise.all([
    profile.hospital_id
      ? admin.from("hospitals").select("name").eq("id", profile.hospital_id).single()
      : Promise.resolve({ data: null }),
    profile.department_id
      ? admin.from("departments").select("name").eq("id", profile.department_id).single()
      : Promise.resolve({ data: null }),
    admin.from("competency_cycles")
      .select("id, cycle_type, status, start_date, end_date, cycle_frameworks(id, status, framework_score, frameworks(id, name, library))")
      .eq("nurse_id", user.id).order("start_date", { ascending: false }).limit(5),
    admin.from("competency_decisions")
      .select("competency_id, outcome, maturity, expiry_date, validation_outcome, created_at, framework_competencies(name)")
      .eq("nurse_id", user.id).order("created_at", { ascending: false }),
    admin.from("learning_pathways")
      .select("id, title, status").eq("nurse_id", user.id)
      .order("generated_at", { ascending: false }).limit(1).maybeSingle(),
    admin.from("professional_credentials")
      .select("id, title, status, verified, expiry_date, issue_date").eq("nurse_id", user.id),
    admin.from("professional_recognitions")
      .select("id, recognition_type, title, awarded_by_name, awarded_at")
      .eq("nurse_id", user.id).order("awarded_at", { ascending: false }),
    admin.from("clinical_authorizations").select("id, status").eq("nurse_id", user.id).eq("status", "active"),
    admin.from("benner_scale").select("score, label"),
  ]);

  const activeCycle = (cycles ?? []).find(c => c.status === "active") ?? (cycles ?? [])[0] ?? null;
  const cycleIds = (cycles ?? []).map(c => c.id);
  const cycleFrameworkIds = ((activeCycle?.cycle_frameworks ?? []) as unknown as { frameworks: { id: string } | null }[])
    .map(cf => cf.frameworks?.id).filter(Boolean) as string[];

  const [
    { data: pendingAssessments }, { data: domainScores }, { data: compScores },
    { data: skillScores }, pathwayItemsRes, cycleCompCount,
    newKnowledge, newCases,
  ] = await Promise.all([
    cycleIds.length
      ? admin.from("assessments").select("id, status").in("cycle_id", cycleIds).in("status", ["pending", "in_progress"])
      : Promise.resolve({ data: [] }),
    activeCycle
      ? admin.from("domain_scores").select("domain_id, score, framework_domains(name)").eq("cycle_id", activeCycle.id).order("score", { ascending: false })
      : Promise.resolve({ data: null }),
    activeCycle
      ? admin.from("competency_scores").select("competency_id, score, is_passing").eq("cycle_id", activeCycle.id)
      : Promise.resolve({ data: null }),
    cycleIds.length
      ? admin.from("skill_scores").select("id, score, assessed_at, competency_skills(name)").in("cycle_id", cycleIds).order("assessed_at", { ascending: false }).limit(60)
      : Promise.resolve({ data: [] }),
    pathway
      ? admin.from("pathway_items").select("id, competency_name, resource_title, resource_type, reason, status, sort_order").eq("pathway_id", pathway.id).order("sort_order")
      : Promise.resolve({ data: [] }),
    cycleFrameworkIds.length
      ? admin.from("framework_competencies").select("id, framework_domains!inner(framework_id)", { count: "exact", head: true }).in("framework_domains.framework_id", cycleFrameworkIds)
      : Promise.resolve({ count: 0 }),
    admin.from("knowledge_objects").select("id", { count: "exact", head: true }).gte("created_at", daysAgo(14)),
    admin.from("clinical_cases").select("id", { count: "exact", head: true }).gte("created_at", daysAgo(14)),
  ]);

  // ── Derived record ──
  const latest = latestPerCompetency(decisions ?? []);
  const competentNow = latest.filter(l => OUTCOME_CONFIG[l.outcome]?.passing && !l.expired).length;
  const gaps = latest.length - competentNow;
  const dueSoon = (decisions ?? []).reduce((s, d, i, arr) => {
    if (arr.findIndex(x => x.competency_id === d.competency_id) !== i) return s;
    const passing = OUTCOME_CONFIG[d.outcome as keyof typeof OUTCOME_CONFIG]?.passing;
    const days = d.expiry_date ? (new Date(d.expiry_date).getTime() - nowMs()) / dayMs : null;
    return s + (passing && days !== null && days > 0 && days <= 60 ? 1 : 0);
  }, 0);
  const awaitingValidation = latest.filter(l => !l.validated).length;

  const pathwayItems = (pathwayItemsRes.data ?? []) as { id: string; competency_name: string | null; resource_title: string | null; resource_type: string | null; reason: string | null; status: string }[];
  const pathwayDone = pathwayItems.filter(i => i.status === "completed").length;
  const learningPct = pathwayItems.length ? Math.round((pathwayDone / pathwayItems.length) * 100) : null;

  const bennerLabel = new Map((benner ?? []).map(b => [b.score, b.label]));
  const scores = (compScores ?? []) as { score: number; is_passing: boolean }[];
  const avgScore = scores.length ? scores.reduce((s, c) => s + c.score, 0) / scores.length : null;
  const level = avgScore !== null ? bennerLabel.get(Math.round(avgScore)) ?? "—" : null;

  // Cycle counts
  const totalInCycle = cycleCompCount.count ?? 0;
  const completedInCycle = scores.filter(s => s.is_passing).length;
  const inProgressInCycle = scores.length - completedInCycle;
  const outstanding = Math.max(totalInCycle - scores.length, 0);
  const cyclePct = totalInCycle ? Math.round((completedInCycle / totalInCycle) * 100)
    : scores.length ? Math.round((completedInCycle / scores.length) * 100) : 0;
  const cyclePos = activeCycle?.start_date && activeCycle?.end_date
    ? Math.min(Math.max((nowMs() - new Date(activeCycle.start_date).getTime())
        / (new Date(activeCycle.end_date).getTime() - new Date(activeCycle.start_date).getTime() || 1), 0), 1)
    : null;

  // Logbook
  const skills = (skillScores ?? []) as unknown as { id: string; score: number; assessed_at: string; competency_skills: { name: string } | null }[];
  const skillsThisWeek = skills.filter(s => new Date(s.assessed_at).getTime() > nowMs() - 7 * dayMs).length;

  // Priorities — real, actionable, in urgency order
  const nextPathwayItem = pathwayItems.find(i => i.status !== "completed");
  const newLibrary = (newKnowledge.count ?? 0) + (newCases.count ?? 0);
  const priorities = [
    nextPathwayItem && { icon: "📚", title: `Continue: ${nextPathwayItem.resource_title ?? nextPathwayItem.competency_name ?? "your pathway"}`, sub: "Learning pathway", href: "/dashboard/learning" },
    (pendingAssessments ?? []).length > 0 && { icon: "📝", title: `${(pendingAssessments ?? []).length} assessment${(pendingAssessments ?? []).length === 1 ? "" : "s"} in progress`, sub: "Awaiting your assessor", href: "/dashboard/assessments" },
    dueSoon > 0 && { icon: "⏳", title: `${dueSoon} competenc${dueSoon === 1 ? "y" : "ies"} due for renewal`, sub: "Within 60 days", href: "/dashboard/passport" },
    gaps > 0 && { icon: "🎯", title: `Close ${gaps} open gap${gaps === 1 ? "" : "s"}`, sub: "Not yet competent", href: "/dashboard/learning" },
    newLibrary > 0 && { icon: "🫀", title: `${newLibrary} new item${newLibrary === 1 ? "" : "s"} in the library`, sub: "Added this fortnight", href: "/dashboard/library" },
  ].filter(Boolean) as { icon: string; title: string; sub: string; href: string }[];

  // Recent activity — merged, newest first
  const activity: { icon: string; text: string; at: string }[] = [
    ...(decisions ?? []).slice(0, 6).map(d => ({
      icon: OUTCOME_CONFIG[d.outcome as keyof typeof OUTCOME_CONFIG]?.passing ? "✅" : "🔁",
      text: `${(d.framework_competencies as unknown as { name: string } | null)?.name ?? "Competency"} — ${d.outcome.replace(/_/g, " ")}`,
      at: d.created_at,
    })),
    ...skills.slice(0, 5).map(s => ({ icon: "🖊️", text: `${s.competency_skills?.name ?? "Skill"} scored ${s.score}/6`, at: s.assessed_at })),
    ...(recognitions ?? []).map(r => ({ icon: "🏅", text: r.title, at: r.awarded_at })),
  ].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime()).slice(0, 6);

  // Career
  const { readiness, nextRole } = computeReadiness(latest, credentials ?? [], recognitions ?? []);

  // Notification feed — derived from the record, no invented alerts
  const notifications = [
    dueSoon > 0 && { icon: "⏳", text: `${dueSoon} competenc${dueSoon === 1 ? "y" : "ies"} expiring within 60 days`, href: "/dashboard/passport" },
    (pendingAssessments ?? []).length > 0 && { icon: "📝", text: `${(pendingAssessments ?? []).length} assessment${(pendingAssessments ?? []).length === 1 ? "" : "s"} open with your assessor`, href: "/dashboard/assessments" },
    awaitingValidation > 0 && { icon: "🕐", text: `${awaitingValidation} decision${awaitingValidation === 1 ? "" : "s"} awaiting educator validation`, href: "/dashboard/passport" },
    newLibrary > 0 && { icon: "📖", text: `${newLibrary} new clinical library item${newLibrary === 1 ? "" : "s"} this fortnight`, href: "/dashboard/library" },
  ].filter(Boolean) as { icon: string; text: string; href: string }[];

  const KPI = [
    { label: "Current Competencies", value: competentNow, sub: latest.length ? `of ${latest.length} assessed` : "none assessed yet", color: "text-green-600", href: "/dashboard/passport" },
    { label: "Due for Renewal", value: dueSoon, sub: "within 60 days", color: dueSoon ? "text-red-500" : "text-gray-400", href: "/dashboard/passport" },
    { label: "Pending Validation", value: awaitingValidation, sub: "awaiting educator", color: awaitingValidation ? "text-amber-600" : "text-gray-400", href: "/dashboard/passport" },
    { label: "Learning Progress", value: learningPct !== null ? `${learningPct}%` : "—", sub: pathwayItems.length ? `${pathwayDone}/${pathwayItems.length} pathway items` : "no active pathway", color: "text-violet-600", href: "/dashboard/learning" },
    { label: "Competency Level", value: level ?? "—", sub: avgScore !== null ? `Benner avg ${avgScore.toFixed(1)}/6` : "no cycle scores yet", color: "text-teal-700", href: "/dashboard/logbook", small: true },
  ];

  const QUICK = [
    { icon: "🖊️", label: "Log Procedure", href: "/dashboard/logbook", tint: "bg-green-50 text-green-800" },
    { icon: "▶️", label: "Continue Learning", href: "/dashboard/learning", tint: "bg-blue-50 text-blue-800" },
    { icon: "📝", label: "Start Assessment", href: "/dashboard/assessments", tint: "bg-violet-50 text-violet-800" },
    { icon: "🏥", label: "My CPUs", href: "/dashboard/cpu", tint: "bg-amber-50 text-amber-800" },
    { icon: "📖", label: "Clinical Library", href: "/dashboard/library", tint: "bg-teal-50 text-teal-800" },
    { icon: "🏆", label: "Certificates", href: "/dashboard/certificates", tint: "bg-yellow-50 text-yellow-800" },
  ];

  const card = "bg-white rounded-xl border border-gray-100";
  const cardHead = "flex items-center justify-between mb-3";
  const headLink = "text-xs text-teal-600 hover:underline shrink-0";
  const label9 = "text-[9px] font-bold text-gray-400 uppercase tracking-widest";

  return (
    <>
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3 mb-5">
        <div>
          <p className="text-[10px] font-bold text-teal-600 uppercase tracking-widest mb-0.5">Dashboard</p>
          <h1 className="text-xl font-bold text-gray-900">{greeting}, {firstName} 👋</h1>
          <p className="text-gray-400 text-xs mt-1" suppressHydrationWarning>
            {new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}
            {hospital?.name ? <> · 📍 {hospital.name}</> : null}
            {department?.name ? <> · {department.name}</> : null}
            {profile.specialization ? <> · {profile.specialization}</> : null}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <a href="#notifications" className="relative text-lg" title="Notifications">
            🔔
            {notifications.length > 0 && (
              <span className="absolute -top-1 -right-1.5 bg-red-500 text-white text-[8px] font-bold rounded-full w-3.5 h-3.5 flex items-center justify-center">
                {notifications.length}
              </span>
            )}
          </a>
          <Link href="/dashboard/copilot" className="text-xs font-semibold text-gray-600 border border-gray-200 hover:bg-gray-50 px-3 py-1.5 rounded-lg">
            🤖 Ask Copilot
          </Link>
        </div>
      </div>

      {/* Today's Priorities */}
      <div className={`${card} p-4 mb-5`}>
        <div className="flex items-center gap-3 overflow-x-auto">
          <div className="flex items-center gap-2 shrink-0 pr-2 border-r border-gray-100">
            <span className="w-8 h-8 rounded-lg bg-green-50 flex items-center justify-center">📋</span>
            <p className="text-sm font-bold text-gray-800 whitespace-nowrap">Today&apos;s Priorities</p>
          </div>
          {priorities.length === 0 ? (
            <p className="text-xs text-gray-400">All clear — no open priorities. ✅</p>
          ) : priorities.map(p => (
            <Link key={p.title} href={p.href}
              className="flex items-center gap-2.5 shrink-0 border border-gray-100 hover:border-teal-200 hover:bg-teal-50/40 rounded-lg px-3 py-2 transition-colors">
              <span className="text-sm">{p.icon}</span>
              <span className="min-w-0">
                <span className="block text-xs font-semibold text-gray-800 truncate max-w-[200px]">{p.title}</span>
                <span className="block text-[9px] text-gray-400">{p.sub}</span>
              </span>
              <span className="text-gray-300 text-xs">›</span>
            </Link>
          ))}
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3 mb-5">
        {KPI.map(k => (
          <Link key={k.label} href={k.href} className={`${card} p-4 hover:border-teal-200 transition-colors`}>
            <p className="text-[10px] text-gray-400 font-medium mb-1">{k.label}</p>
            <p className={`font-bold ${k.small ? "text-lg" : "text-2xl"} ${k.color}`}>{k.value}</p>
            <p className="text-[9px] text-gray-400 mt-0.5">{k.sub}</p>
          </Link>
        ))}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_310px] gap-5">
        {/* ── Main column ── */}
        <div className="min-w-0 flex flex-col gap-5">
          <div className="grid md:grid-cols-2 gap-5">
            {/* Cycle */}
            <div className={`${card} p-5`}>
              <div className={cardHead}>
                <h2 className="font-semibold text-gray-900 text-sm">Current Competency Cycle</h2>
                <Link href="/dashboard/passport" className={headLink}>View cycle →</Link>
              </div>
              {activeCycle ? (
                <>
                  <div className="flex items-center gap-4 mb-4">
                    <Ring pct={cyclePct} />
                    <div className="flex-1">
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded capitalize ${CYCLE_COLORS[activeCycle.cycle_type] ?? "bg-gray-100 text-gray-500"}`}>
                        {activeCycle.cycle_type} · {activeCycle.status}
                      </span>
                      {cyclePos !== null && (
                        <div className="mt-3">
                          <div className="relative h-1.5 bg-gray-100 rounded-full">
                            <div className="absolute h-full bg-teal-500 rounded-full" style={{ width: `${Math.round(cyclePos * 100)}%` }} />
                            <div className="absolute w-3 h-3 bg-teal-600 border-2 border-white rounded-full -top-[3px]" style={{ left: `calc(${Math.round(cyclePos * 100)}% - 6px)` }} />
                          </div>
                          <div className="flex justify-between text-[9px] text-gray-400 mt-1">
                            <span>{fmtDate(activeCycle.start_date)} start</span>
                            <span>{fmtDate(activeCycle.end_date)} finish</span>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="grid grid-cols-4 divide-x divide-gray-50 text-center">
                    {[
                      [totalInCycle || scores.length, "In cycle", "text-gray-900"],
                      [completedInCycle, "Competent", "text-green-600"],
                      [inProgressInCycle, "In progress", "text-blue-600"],
                      [outstanding, "Outstanding", outstanding ? "text-orange-500" : "text-gray-400"],
                    ].map(([v, l, c]) => (
                      <div key={l as string}>
                        <p className={`text-lg font-bold ${c}`}>{v}</p>
                        <p className="text-[9px] text-gray-400">{l}</p>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <p className="text-center py-8 text-sm text-gray-400">No competency cycle yet — your admin will assign one. 🔄</p>
              )}
            </div>

            {/* Domain scores */}
            <div className={`${card} p-5`}>
              <div className={cardHead}>
                <h2 className="font-semibold text-gray-900 text-sm">Domain Scores</h2>
                <Link href="/dashboard/passport" className={headLink}>View all →</Link>
              </div>
              {(domainScores ?? []).length ? (
                <div className="flex flex-col gap-2.5">
                  {(domainScores ?? []).slice(0, 6).map(ds => {
                    const name = (ds.framework_domains as unknown as { name: string } | null)?.name ?? "Domain";
                    const pct = Math.round((ds.score / 6) * 100);
                    return (
                      <Link key={ds.domain_id} href="/dashboard/passport" className="flex items-center gap-3 group">
                        <span className="text-xs text-gray-700 w-36 truncate group-hover:text-teal-700">{name}</span>
                        <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                          <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: SCORE_COLORS[Math.round(ds.score)] ?? "#9ca3af" }} />
                        </div>
                        <span className="text-[11px] font-bold text-gray-600 w-9 text-right">{ds.score.toFixed(1)}</span>
                      </Link>
                    );
                  })}
                </div>
              ) : (
                <p className="text-center py-8 text-sm text-gray-400">Scores appear after assessor evaluations. 📊</p>
              )}
            </div>
          </div>

          <div className="grid md:grid-cols-3 gap-5">
            {/* Recommended */}
            <div className={`${card} p-5`}>
              <div className={cardHead}>
                <h2 className="font-semibold text-gray-900 text-sm">Recommended for You</h2>
                <Link href="/dashboard/learning" className={headLink}>Pathway →</Link>
              </div>
              {pathwayItems.filter(i => i.status !== "completed").slice(0, 4).map(i => (
                <Link key={i.id} href="/dashboard/learning" className="flex items-start gap-2.5 py-2 border-b border-gray-50 last:border-0 group">
                  <span className="text-sm mt-0.5">📄</span>
                  <span className="min-w-0">
                    <span className="block text-xs text-gray-800 group-hover:text-teal-700 leading-snug">{i.resource_title ?? i.competency_name}</span>
                    <span className="block text-[9px] text-gray-400 mt-0.5">{i.reason ?? i.resource_type ?? "Pathway item"}</span>
                  </span>
                </Link>
              ))}
              {pathwayItems.filter(i => i.status !== "completed").length === 0 && (
                <p className="text-xs text-gray-400 py-4 text-center">No open pathway items — browse the <Link href="/dashboard/library" className="text-teal-600 hover:underline">library</Link>.</p>
              )}
            </div>

            {/* Career growth */}
            <div className={`${card} p-5`}>
              <div className={cardHead}>
                <h2 className="font-semibold text-gray-900 text-sm">Career Growth</h2>
                <Link href="/dashboard/career" className={headLink}>Pathway →</Link>
              </div>
              <div className="bg-violet-50/60 rounded-lg p-3 mb-3">
                <p className="text-[9px] text-violet-500 font-bold uppercase tracking-wide">Current role</p>
                <p className="text-sm font-bold text-gray-900">{ROLE_CONFIG[activeRole]?.label ?? "Healthcare Worker"}</p>
                <p className="text-[9px] text-violet-500 font-bold uppercase tracking-wide mt-2">Next goal</p>
                <p className="text-sm font-semibold text-gray-800">{nextRole}</p>
              </div>
              <div className="flex justify-between text-[10px] text-gray-500 mb-1">
                <span>{gaps > 0 ? `${gaps} gap${gaps === 1 ? "" : "s"} to close` : "No open gaps"}</span>
                <span className="font-bold text-gray-700">{readiness}% ready</span>
              </div>
              <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                <div className="h-full bg-violet-500 rounded-full" style={{ width: `${Math.max(readiness, 2)}%` }} />
              </div>
            </div>

            {/* Recent activity */}
            <div className={`${card} p-5`}>
              <div className={cardHead}>
                <h2 className="font-semibold text-gray-900 text-sm">Recent Activity</h2>
                <Link href="/dashboard/passport" className={headLink}>View all →</Link>
              </div>
              {activity.length ? activity.map((a, i) => (
                <div key={i} className="flex items-start gap-2 py-1.5 border-b border-gray-50 last:border-0">
                  <span className="text-xs mt-0.5">{a.icon}</span>
                  <span className="min-w-0">
                    <span className="block text-[11px] text-gray-700 leading-snug capitalize-first">{a.text}</span>
                    <span className="block text-[9px] text-gray-400" suppressHydrationWarning>{fmtDate(a.at)}</span>
                  </span>
                </div>
              )) : <p className="text-xs text-gray-400 py-4 text-center">Activity appears as you are assessed.</p>}
            </div>
          </div>

          {/* Quick actions */}
          <div className={`${card} p-4`}>
            <p className={`${label9} mb-2.5`}>Quick actions</p>
            <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
              {QUICK.map(q => (
                <Link key={q.label} href={q.href}
                  className={`${q.tint} rounded-lg p-3 text-center hover:opacity-80 transition-opacity`}>
                  <p className="text-lg">{q.icon}</p>
                  <p className="text-[10px] font-semibold mt-1 leading-tight">{q.label}</p>
                </Link>
              ))}
            </div>
          </div>
        </div>

        {/* ── Right rail ── */}
        <div className="flex flex-col gap-5">
          {/* Passport */}
          <div className={`${card} p-5`}>
            <div className={cardHead}>
              <h2 className="font-semibold text-gray-900 text-sm">Professional Passport</h2>
              <Link href="/dashboard/passport" className={headLink}>View →</Link>
            </div>
            <div className="bg-green-50 rounded-lg p-3 mb-3 flex items-center gap-2.5">
              <span className="text-xl">🛡️</span>
              <div>
                <p className="text-sm font-bold text-gray-900">{level ?? "Not yet levelled"}</p>
                <p className="text-[9px] text-gray-500">{level ? "Benner level from cycle scores" : "Awaiting first assessed cycle"}</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 text-center">
              {[
                [competentNow, "Competencies"],
                [dueSoon, "Renewals due"],
                [(credentials ?? []).length + (recognitions ?? []).length, "Certificates"],
                [(authz ?? []).length, "Authorizations"],
              ].map(([v, l]) => (
                <div key={l as string} className="bg-gray-50/70 rounded-lg py-2">
                  <p className="text-base font-bold text-gray-900">{v}</p>
                  <p className="text-[9px] text-gray-400">{l}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Skills logbook */}
          <div className={`${card} p-5`}>
            <div className={cardHead}>
              <h2 className="font-semibold text-gray-900 text-sm">Skills Logbook</h2>
              <Link href="/dashboard/logbook" className={headLink}>View →</Link>
            </div>
            <div className="flex flex-col gap-1.5 text-xs mb-3">
              <div className="flex justify-between"><span className="text-gray-500">🗓️ This week</span><b>{skillsThisWeek}</b></div>
              <div className="flex justify-between"><span className="text-gray-500">✅ Assessed total</span><b>{skills.length}</b></div>
            </div>
            {skills.length > 0 && (
              <>
                <p className={`${label9} mb-1.5`}>Most recent</p>
                {skills.slice(0, 3).map(s => (
                  <div key={s.id} className="flex items-center justify-between py-1 border-b border-gray-50 last:border-0">
                    <span className="text-[11px] text-gray-700 truncate">{s.competency_skills?.name ?? "Skill"}</span>
                    <span className="text-[10px] font-bold shrink-0 ml-2" style={{ color: SCORE_COLORS[s.score] ?? "#6b7280" }}>{s.score}/6</span>
                  </div>
                ))}
              </>
            )}
          </div>

          {/* Achievements */}
          <div className={`${card} p-5`}>
            <div className={cardHead}>
              <h2 className="font-semibold text-gray-900 text-sm">Achievements</h2>
              <Link href="/dashboard/certificates" className={headLink}>View all →</Link>
            </div>
            {(recognitions ?? []).length ? (
              <div className="flex flex-col gap-2">
                {(recognitions ?? []).slice(0, 4).map(r => (
                  <div key={r.id} className="flex items-center gap-2.5">
                    <span className="w-9 h-9 rounded-full bg-amber-50 flex items-center justify-center text-base shrink-0">🏅</span>
                    <div className="min-w-0">
                      <p className="text-[11px] font-semibold text-gray-800 leading-snug">{r.title}</p>
                      <p className="text-[9px] text-gray-400" suppressHydrationWarning>{r.awarded_by_name ? `${r.awarded_by_name} · ` : ""}{fmtDate(r.awarded_at)}</p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-gray-400 py-3 text-center">Recognitions your organisation awards will appear here. 🏅</p>
            )}
          </div>

          {/* Notifications */}
          <div id="notifications" className={`${card} p-5`}>
            <div className={cardHead}>
              <h2 className="font-semibold text-gray-900 text-sm">Notifications</h2>
            </div>
            {notifications.length ? (
              <div className="flex flex-col gap-2">
                {notifications.map(n => (
                  <Link key={n.text} href={n.href} className="flex items-start gap-2 group">
                    <span className="text-xs mt-0.5">{n.icon}</span>
                    <span className="text-[11px] text-gray-600 group-hover:text-teal-700 leading-snug">{n.text}</span>
                  </Link>
                ))}
              </div>
            ) : (
              <p className="text-xs text-gray-400 text-center py-2">Nothing needs your attention. ✅</p>
            )}
            <p className="text-[9px] text-gray-300 mt-3">Derived live from your record — renewals, assessments, validations and new guidance.</p>
          </div>
        </div>
      </div>
    </>
  );
}
