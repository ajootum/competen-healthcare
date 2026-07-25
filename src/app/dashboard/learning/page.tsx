import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadLearningCentre } from "@/lib/learning-centre";

// PW-006 My Learning Centre — the person's course-centric learning hub over real learning_enrolments / cpd_logs /
// learning_pathways. KPI ribbon, Continue Learning, Learning Plan, Recommended, domain Pathways, CPD summary
// donut, rule-based Achievements, learning calendar + AI assistant handoff. The deep competency-first pathway
// view lives at /dashboard/learning/pathway. Server-rendered; renders REAL, honestly lighter than the persona.
export const dynamic = "force-dynamic";

const fmtDate = (d: string) => new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

function Kpi({ icon, label, value, sub, tint }: { icon: string; label: string; value: string | number; sub: string; tint: string }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <div className={`w-9 h-9 rounded-lg flex items-center justify-center text-lg ${tint}`}>{icon}</div>
      <p className="text-2xl font-bold text-gray-900 mt-2">{value}</p>
      <p className="text-[12px] font-medium text-gray-700">{label}</p>
      <p className="text-[11px] text-gray-400">{sub}</p>
    </div>
  );
}

export default async function LearningCentrePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any; // eslint-disable-line @typescript-eslint/no-explicit-any
  const { data: profile } = await admin.from("profiles").select("full_name, hospital_id").eq("id", user.id).single();

  const d = await loadLearningCentre(admin, user.id, profile);

  // CPD donut geometry.
  const cpdTotal = d.cpdSummary.reduce((s: number, c: any) => s + c.pts, 0) || 1; // eslint-disable-line @typescript-eslint/no-explicit-any
  const R = 46, C = 2 * Math.PI * R;
  const cpdSegs = d.cpdSummary.map((c: any, i: number) => ({ ...c, len: (c.pts / cpdTotal) * C, offset: d.cpdSummary.slice(0, i).reduce((s: number, x: any) => s + (x.pts / cpdTotal) * C, 0) })); // eslint-disable-line @typescript-eslint/no-explicit-any

  const TABS = [{ label: "My Learning", href: "/dashboard/learning", active: true }, { label: "Competency Pathway", href: "/dashboard/learning/pathway" }, { label: "Certifications", href: "/dashboard/certificates" }, { label: "CPD & Credits", href: "/dashboard/cpd" }, { label: "Achievements", href: "#achievements" }];
  const coachPrompt = `I'm a nurse planning my learning. Live picture: ${d.kpis.inProgress} courses in progress, ${d.kpis.completed} completed, ${d.cpdPointsYear} CPD points this year${d.cpdTarget ? ` (${d.cpdHoursYear}h of ${d.cpdTarget}h target)` : ""}, ${d.overdueMandatory} overdue mandatory. Recommend what to prioritise and why.`;

  return (
    <div className="max-w-[1500px] mx-auto space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold text-blue-600 uppercase tracking-wide">Personal Workspace</p>
          <h1 className="text-2xl font-bold text-gray-900">My Learning Centre</h1>
          <p className="text-sm text-gray-500 mt-0.5">Your personalised learning hub — track progress, continue learning and achieve your goals.</p>
        </div>
        <Link href="/dashboard/cpd" className="text-sm font-medium text-white bg-blue-600 rounded-lg px-3 py-2 hover:bg-blue-500">Log CPD</Link>
      </div>

      {/* KPI ribbon */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <Kpi icon="⏱️" label="Learning Hours" value={d.kpis.hoursThisMonth} sub="This month" tint="bg-blue-50" />
        <Kpi icon="📘" label="In Progress" value={d.kpis.inProgress} sub="Continue learning" tint="bg-indigo-50" />
        <Kpi icon="✅" label="Completed" value={d.kpis.completed} sub="All time" tint="bg-emerald-50" />
        <Kpi icon="🎖️" label="Certificates" value={d.kpis.certificates} sub="Earned" tint="bg-amber-50" />
        <Kpi icon="⭐" label="CPD Points" value={d.kpis.cpdPointsYear} sub="This year" tint="bg-cyan-50" />
        <Kpi icon="🔥" label="Learning Streak" value={d.kpis.streak} sub={d.kpis.streak === 1 ? "day" : "days"} tint="bg-rose-50" />
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap items-center gap-1 border-b border-gray-200">
        {TABS.map(t => (
          <Link key={t.label} href={t.href} className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${t.active ? "border-blue-600 text-blue-700" : "border-transparent text-gray-500 hover:text-gray-800"}`}>{t.label}</Link>
        ))}
      </div>

      <div className="grid lg:grid-cols-3 gap-5 items-start">
        {/* Main column */}
        <div className="lg:col-span-2 space-y-5">
          {/* Continue Learning */}
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <div className="flex items-center justify-between mb-3"><h2 className="text-sm font-semibold text-gray-900">Continue Learning</h2><Link href="/dashboard/courses" className="text-[12px] font-medium text-blue-600 hover:underline">View all →</Link></div>
            {d.continueLearning.length > 0 ? (
              <div className="space-y-3">
                {d.continueLearning.map((e: any) => ( // eslint-disable-line @typescript-eslint/no-explicit-any
                  <div key={e.id} className="flex items-center gap-3">
                    <div className="w-11 h-11 rounded-lg bg-gradient-to-br from-blue-500 to-indigo-500 flex items-center justify-center text-white text-lg shrink-0">📖</div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-800 truncate">{e.course.title}</p>
                      <div className="flex items-center gap-2 text-[11px] text-gray-400 mt-0.5"><span>{d.courseTypeLabel[e.course.course_type] ?? "Course"}</span>{e.mandatory && <span className="text-amber-600 font-medium">Mandatory</span>}{e.due_date && <span>· Due {fmtDate(e.due_date)}</span>}</div>
                      <div className="mt-1.5 h-1.5 rounded-full bg-gray-100 overflow-hidden"><div className="h-full rounded-full bg-blue-500" style={{ width: `${e.progress_pct ?? 0}%` }} /></div>
                    </div>
                    <div className="text-right shrink-0"><p className="text-sm font-bold text-blue-600">{e.progress_pct ?? 0}%</p><Link href="/dashboard/courses" className="text-[11px] font-medium text-gray-500 hover:text-blue-600">Continue</Link></div>
                  </div>
                ))}
              </div>
            ) : <p className="text-sm text-gray-400 py-8 text-center">No courses in progress. Browse the <Link href="/dashboard/courses" className="text-blue-600 hover:underline">catalogue</Link> to enrol.</p>}
          </div>

          {/* Recommended */}
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <h2 className="text-sm font-semibold text-gray-900 mb-3">Recommended for You</h2>
            {d.recommended.length > 0 ? (
              <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
                {d.recommended.map((c: any) => ( // eslint-disable-line @typescript-eslint/no-explicit-any
                  <Link key={c.id} href="/dashboard/courses" className="border border-gray-100 rounded-lg p-3 hover:border-blue-200 hover:bg-blue-50/40 transition-colors">
                    <div className="w-full h-16 rounded-md bg-gradient-to-br from-slate-100 to-blue-100 flex items-center justify-center text-2xl mb-2">🎓</div>
                    <p className="text-[13px] font-semibold text-gray-800 leading-snug line-clamp-2">{c.title}</p>
                    <div className="flex items-center gap-2 mt-1 text-[11px] text-gray-400"><span>{d.courseTypeLabel[c.course_type] ?? "Course"}</span>{c.mandatory && <span className="text-amber-600 font-medium">Mandatory</span>}</div>
                  </Link>
                ))}
              </div>
            ) : <p className="text-sm text-gray-400 py-6 text-center">You&apos;re enrolled in all available courses.</p>}
          </div>

          {/* Learning Pathways */}
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <div className="flex items-center justify-between mb-3"><h2 className="text-sm font-semibold text-gray-900">Learning Pathways</h2><Link href="/dashboard/courses" className="text-[12px] font-medium text-blue-600 hover:underline">Explore all →</Link></div>
            {d.pathways.length > 0 ? (
              <div className="grid sm:grid-cols-2 gap-3">
                {d.pathways.map((p: any) => ( // eslint-disable-line @typescript-eslint/no-explicit-any
                  <div key={p.name} className="flex items-center gap-3 border border-gray-100 rounded-lg p-3">
                    <div className="w-9 h-9 rounded-lg bg-blue-50 flex items-center justify-center text-blue-600">🧭</div>
                    <div className="min-w-0"><p className="text-[13px] font-semibold text-gray-800 truncate">{p.name}</p><p className="text-[11px] text-gray-400">{p.n} course{p.n === 1 ? "" : "s"}</p></div>
                  </div>
                ))}
              </div>
            ) : <p className="text-sm text-gray-400 py-6 text-center">No competency-linked pathways in the catalogue yet.</p>}
          </div>
        </div>

        {/* Right rail */}
        <div className="space-y-5">
          {/* Learning Plan */}
          <div id="plan" className="bg-white rounded-xl border border-gray-200 p-4">
            <div className="flex items-center justify-between mb-2"><h3 className="text-sm font-semibold text-gray-900">My Learning Plan</h3><Link href="/dashboard/learning/pathway" className="text-[11px] font-medium text-blue-600 hover:underline">Details →</Link></div>
            {d.plan ? (
              <div>
                <p className="text-[13px] font-semibold text-gray-800">{d.plan.title}</p>
                <div className="flex items-center justify-between text-[11px] text-gray-500 mt-2 mb-1"><span>Progress</span><span className="font-semibold text-gray-700">{d.plan.progress}%</span></div>
                <div className="h-2 rounded-full bg-gray-100 overflow-hidden"><div className="h-full rounded-full bg-emerald-500" style={{ width: `${d.plan.progress}%` }} /></div>
                <p className="text-[11px] text-gray-400 mt-1">{d.plan.done} of {d.plan.total} items complete</p>
                {d.plan.nextMilestone && <div className="mt-3 bg-blue-50/60 rounded-lg p-2.5"><p className="text-[10px] font-semibold text-blue-700 uppercase tracking-wide">Next Milestone</p><p className="text-[12px] font-medium text-gray-800 mt-0.5">{d.plan.nextMilestone.resource_title ?? d.plan.nextMilestone.competency_name}</p>{d.plan.nextMilestone.reason && <p className="text-[10px] text-gray-500">{d.plan.nextMilestone.reason}</p>}</div>}
              </div>
            ) : <p className="text-xs text-gray-400 py-4 text-center">No active development plan. Your assessor generates one from competency decisions.</p>}
          </div>

          {/* Learning calendar */}
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <h3 className="text-sm font-semibold text-gray-900 mb-3">Learning Calendar</h3>
            {d.calendar.length > 0 ? (
              <div className="space-y-2.5">
                {d.calendar.map((c: any, i: number) => ( // eslint-disable-line @typescript-eslint/no-explicit-any
                  <div key={i} className="flex items-center gap-2.5">
                    <div className="w-9 h-9 rounded-lg bg-indigo-50 flex flex-col items-center justify-center shrink-0"><span className="text-[9px] font-bold text-indigo-600 uppercase leading-none">{new Date(c.date).toLocaleDateString("en-GB", { month: "short" })}</span><span className="text-sm font-bold text-indigo-700 leading-none">{new Date(c.date).getDate()}</span></div>
                    <div className="min-w-0"><p className="text-[12px] font-medium text-gray-800 truncate">{c.title}</p><p className="text-[10px] text-gray-400">{c.type} · due {fmtDate(c.date)}</p></div>
                  </div>
                ))}
              </div>
            ) : <p className="text-xs text-gray-400 py-4 text-center">No scheduled learning.</p>}
          </div>

          {/* CPD summary donut */}
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <div className="flex items-center justify-between mb-3"><h3 className="text-sm font-semibold text-gray-900">CPD Summary</h3><Link href="/dashboard/cpd" className="text-[11px] font-medium text-blue-600 hover:underline">Dashboard →</Link></div>
            {d.cpdSummary.length > 0 ? (
              <div className="flex items-center gap-4">
                <svg width="120" height="120" viewBox="0 0 120 120" className="shrink-0">
                  <circle cx="60" cy="60" r={R} fill="none" stroke="#f1f5f9" strokeWidth="14" />
                  {cpdSegs.map((c: any, i: number) => <circle key={i} cx="60" cy="60" r={R} fill="none" stroke={c.color} strokeWidth="14" strokeDasharray={`${c.len} ${C - c.len}`} strokeDashoffset={-c.offset} transform="rotate(-90 60 60)" />) /* eslint-disable-line @typescript-eslint/no-explicit-any */}
                  <text x="60" y="56" textAnchor="middle" className="fill-gray-900 font-bold" fontSize="18">{d.cpdPointsYear}</text>
                  <text x="60" y="72" textAnchor="middle" className="fill-gray-400" fontSize="8">Points</text>
                </svg>
                <div className="space-y-1.5 text-[12px] flex-1">
                  {d.cpdSummary.map((c: any) => ( // eslint-disable-line @typescript-eslint/no-explicit-any
                    <div key={c.label} className="flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: c.color }} /><span className="text-gray-600 truncate">{c.label}</span><span className="ml-auto font-semibold text-gray-900">{c.pts}</span></div>
                  ))}
                </div>
              </div>
            ) : <p className="text-xs text-gray-400 py-4 text-center">No CPD logged this year.</p>}
          </div>

          {/* Achievements */}
          <div id="achievements" className="bg-white rounded-xl border border-gray-200 p-4">
            <h3 className="text-sm font-semibold text-gray-900 mb-3">Achievements</h3>
            <div className="grid grid-cols-4 gap-2">
              {d.achievements.map((a: any) => ( // eslint-disable-line @typescript-eslint/no-explicit-any
                <div key={a.label} className={`flex flex-col items-center text-center ${a.earned ? "" : "opacity-30 grayscale"}`}>
                  <div className="w-11 h-11 rounded-full flex items-center justify-center text-xl" style={{ background: `${a.color}18` }}>{a.icon}</div>
                  <p className="text-[9px] font-medium text-gray-600 mt-1 leading-tight">{a.label}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Learning Assistant */}
          <div className="bg-gradient-to-br from-blue-50 to-indigo-50 rounded-xl border border-blue-100 p-4">
            <h3 className="text-sm font-semibold text-gray-900 mb-1">✨ Learning Assistant</h3>
            <p className="text-[12px] text-gray-600 mb-3">Need help choosing what to learn next?</p>
            <Link href={`/dashboard/copilot?scenario=${encodeURIComponent(coachPrompt)}`} className="block text-center text-sm font-medium text-white bg-blue-600 rounded-lg py-2 hover:bg-blue-500">Get Recommendations</Link>
          </div>
        </div>
      </div>
    </div>
  );
}
