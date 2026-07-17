import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import CoursesClient from "./CoursesClient";

// CPD Academy — competency-driven learning hub (Volume 5 CPD Academy spec).
// KPIs, continue-learning, recommendations and category tiles are computed
// from the real course catalogue, enrolments and CPD log. Spec items with no
// backing (streaks, goals, events, ratings, manager workspace) are omitted.

const CATEGORY_ICON: Record<string, string> = {
  Emergency: "🚨", Safety: "🛡️", Pediatrics: "👶", Pharmacology: "💊",
  "Critical Care": "❤️", Clinical: "🩺", "Medical-Surgical": "🏥", Neurology: "🧠",
};

export default async function CpdAcademyPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();
  const [{ data: profile }, { data: courses }, { data: enrollments }, { data: cpdLogs }] = await Promise.all([
    admin.from("profiles").select("full_name, specialization").eq("id", user.id).single(),
    admin.from("courses").select("*").eq("is_published", true).order("category"),
    admin.from("course_enrollments").select("course_id, progress, completed_at").eq("user_id", user.id),
    admin.from("cpd_logs").select("hours").eq("user_id", user.id),
  ]);

  const firstName = profile?.full_name?.split(" ")[0] ?? "there";
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  const byId = new Map((courses ?? []).map(c => [c.id, c]));
  const enrolled = enrollments ?? [];
  const completed = enrolled.filter(e => e.completed_at);
  const inProgress = enrolled.filter(e => !e.completed_at);
  const courseCpd = completed.reduce((s, e) => s + (byId.get(e.course_id)?.cpd_points ?? 0), 0);
  const loggedCpd = (cpdLogs ?? []).reduce((s, l) => s + Number(l.hours), 0);
  const categories = [...new Set((courses ?? []).map(c => c.category))];

  // Continue learning: highest-progress unfinished enrolment
  const resume = [...inProgress].sort((a, b) => b.progress - a.progress)[0] ?? null;
  const resumeCourse = resume ? byId.get(resume.course_id) : null;

  // Recommended: unenrolled course with the most CPD credit — honest reason shown
  const enrolledIds = new Set(enrolled.map(e => e.course_id));
  const recommended = (courses ?? []).filter(c => !enrolledIds.has(c.id))
    .sort((a, b) => (b.cpd_points ?? 0) - (a.cpd_points ?? 0))[0] ?? null;

  const card = "bg-white rounded-xl border border-gray-100";

  const KPI = [
    { label: "Available Courses", value: (courses ?? []).length, sub: `across ${categories.length} categor${categories.length === 1 ? "y" : "ies"}`, color: "text-gray-900" },
    { label: "Currently Learning", value: inProgress.length, sub: "in progress", color: "text-blue-600" },
    { label: "Completed", value: completed.length, sub: "courses completed", color: "text-green-600" },
    { label: "CPD Credits", value: courseCpd + loggedCpd, sub: `${courseCpd} from courses · ${loggedCpd} logged`, color: "text-amber-600" },
    { label: "Specialty", value: profile?.specialization ?? "—", sub: profile?.specialization ? "your focus area" : "not set", color: "text-violet-700", small: true },
  ];

  return (
    <div className="max-w-6xl">
      <div className="mb-5">
        <p className="text-[10px] font-bold text-teal-600 uppercase tracking-widest mb-0.5">CPD Academy</p>
        <h1 className="text-xl font-bold text-gray-900">{greeting}, {firstName} 👋</h1>
        <p className="text-gray-400 text-sm mt-0.5">Continue building your clinical expertise and grow your career.</p>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3 mb-5">
        {KPI.map(k => (
          <div key={k.label} className={`${card} p-4`}>
            <p className="text-[10px] text-gray-400 font-medium mb-1">{k.label}</p>
            <p className={`font-bold ${"small" in k && k.small ? "text-sm" : "text-2xl"} ${k.color}`}>{k.value}</p>
            <p className="text-[9px] text-gray-400 mt-0.5">{k.sub}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_290px] gap-5">
        {/* Main column */}
        <div className="min-w-0 flex flex-col gap-5">
          {/* Continue / recommended hero */}
          {(resumeCourse || recommended) && (
            <div className={`${card} p-5`}>
              <p className="text-[9px] font-bold text-gray-400 uppercase tracking-widest mb-3">
                {resumeCourse ? "▶ Continue learning" : "✨ Recommended for you"}
              </p>
              {(() => {
                const c = resumeCourse ?? recommended!;
                const e = resumeCourse ? resume : null;
                return (
                  <div className="flex flex-wrap items-center gap-4">
                    <span className="w-14 h-14 rounded-xl bg-teal-50 flex items-center justify-center text-2xl shrink-0">
                      {CATEGORY_ICON[c.category] ?? "📚"}
                    </span>
                    <div className="flex-1 min-w-[200px]">
                      <p className="text-base font-bold text-gray-900">
                        {c.title}
                        <span className="ml-2 text-[9px] font-bold bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded capitalize">{c.level}</span>
                      </p>
                      <p className="text-[11px] text-gray-400 mt-0.5">
                        {c.category} · {c.duration_hours}h · {c.cpd_points} CPD credits
                      </p>
                      {e ? (
                        <div className="flex items-center gap-2 mt-2 max-w-xs">
                          <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                            <div className="h-full bg-teal-500 rounded-full" style={{ width: `${Math.max(e.progress, 2)}%` }} />
                          </div>
                          <span className="text-[10px] font-bold text-gray-500">{e.progress}%</span>
                        </div>
                      ) : (
                        <p className="text-[10px] text-gray-400 mt-1.5">
                          Why: highest-credit course you haven&apos;t started — {c.cpd_points} CPD credits on completion.
                        </p>
                      )}
                    </div>
                    <Link href={`/dashboard/courses/${c.id}`}
                      className="text-sm font-semibold bg-teal-600 hover:bg-teal-700 text-white px-4 py-2 rounded-lg shrink-0">
                      {e ? "Continue Learning" : "Start Course"}
                    </Link>
                  </div>
                );
              })()}
            </div>
          )}

          {/* Browse by specialty */}
          <div className={`${card} p-5`}>
            <h2 className="font-semibold text-gray-900 text-sm mb-3">Browse by Specialty</h2>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {categories.map(cat => {
                const n = (courses ?? []).filter(c => c.category === cat).length;
                return (
                  <div key={cat} className="border border-gray-100 rounded-xl p-3 text-center">
                    <p className="text-xl">{CATEGORY_ICON[cat] ?? "📚"}</p>
                    <p className="text-[11px] font-semibold text-gray-700 mt-1">{cat}</p>
                    <p className="text-[9px] text-gray-400">{n} course{n === 1 ? "" : "s"}</p>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Full catalogue (existing enrol/resume interactions) */}
          <div>
            <h2 className="font-semibold text-gray-900 text-sm mb-3">All Courses</h2>
            <CoursesClient courses={courses ?? []} enrollments={enrolled} />
          </div>
        </div>

        {/* Right rail */}
        <div className="flex flex-col gap-5">
          {/* CPD summary */}
          <div className={`${card} p-5`}>
            <h2 className="font-semibold text-gray-900 text-sm mb-3">Your CPD Record</h2>
            <div className="flex items-center gap-4">
              <div className="w-20 h-20 rounded-full border-8 border-teal-500 flex flex-col items-center justify-center">
                <p className="text-xl font-extrabold text-gray-900">{courseCpd + loggedCpd}</p>
                <p className="text-[8px] text-gray-400 -mt-0.5">credits</p>
              </div>
              <div className="text-[11px] text-gray-500 flex-1">
                <p><b className="text-gray-800">{courseCpd}</b> from completed courses</p>
                <p className="mt-1"><b className="text-gray-800">{loggedCpd}</b> hours logged manually</p>
              </div>
            </div>
            <Link href="/dashboard/cpd"
              className="block text-center mt-3 text-xs font-semibold text-teal-700 border border-teal-200 hover:bg-teal-50 py-2 rounded-lg">
              View CPD Log →
            </Link>
          </div>

          {/* My learning */}
          <div className={`${card} p-5`}>
            <h2 className="font-semibold text-gray-900 text-sm mb-3">My Learning</h2>
            {enrolled.length === 0 ? (
              <p className="text-xs text-gray-400 text-center py-3">Enrol in a course to start your record. 🎓</p>
            ) : (
              <div className="flex flex-col gap-2">
                {enrolled.slice(0, 5).map(e => {
                  const c = byId.get(e.course_id);
                  if (!c) return null;
                  return (
                    <Link key={e.course_id} href={`/dashboard/courses/${c.id}`} className="group">
                      <p className="text-[11px] text-gray-700 group-hover:text-teal-700 truncate">
                        {e.completed_at ? "✅" : "▶"} {c.title}
                      </p>
                      {!e.completed_at && (
                        <div className="h-1 bg-gray-100 rounded-full overflow-hidden mt-1">
                          <div className="h-full bg-teal-500 rounded-full" style={{ width: `${Math.max(e.progress, 2)}%` }} />
                        </div>
                      )}
                    </Link>
                  );
                })}
              </div>
            )}
          </div>

          {/* AI tutor */}
          <div className="bg-[#0a2e38] rounded-xl p-5 text-white">
            <h2 className="font-semibold text-sm mb-1">🤖 AI Tutor</h2>
            <p className="text-[10px] text-teal-200/70 mb-3">Ask me anything about your learning — grounded in your organisation&apos;s governed content.</p>
            <ul className="text-[11px] text-teal-100/80 flex flex-col gap-1 mb-4">
              <li>💡 Explain a topic</li>
              <li>❓ Quiz me on a CPU</li>
              <li>🧑‍⚕️ Walk through a case scenario</li>
            </ul>
            <Link href="/dashboard/copilot"
              className="block text-center text-xs font-semibold bg-teal-500 hover:bg-teal-400 text-white py-2 rounded-lg">
              Ask anything →
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
