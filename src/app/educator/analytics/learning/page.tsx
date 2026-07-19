import Link from "next/link";
import { requireEducatorAccess } from "@/lib/educator-access";
import { loadLearningAnalytics } from "@/lib/learning-analytics";
import { StatTiles, type Tile } from "@/app/assessor/reports/ui";
import LearningNav from "./LearningNav";
import { MODULES } from "./modules";

// Learning Analytics workspace landing — overview of the six modules with a
// live snapshot, each module card carrying a real metric. Every figure is
// computed from live hospital records.

export const dynamic = "force-dynamic";

const pct = (v: number | null) => v !== null ? `${v}%` : "—";

export default async function LearningAnalyticsLanding() {
  const { admin, hospitalId } = await requireEducatorAccess();
  const d = await loadLearningAnalytics(admin, hospitalId ?? "");
  const L = d.learners.cards;

  const tiles: Tile[] = [
    { label: "Total Learners", value: String(L.total), sub: `${L.active} active · 30d` },
    { label: "New Learners", value: String(L.recent), sub: "joined · 30d" },
    { label: "Completion Rate", value: pct(L.completionRate), sub: "course enrolments" },
    { label: "Cohorts", value: String(d.cohorts.cards.count), sub: "departments" },
    { label: "Courses", value: String(d.courses.cards.courses), sub: `${d.courses.cards.activeLearners} enrolled` },
    { label: "Faculty", value: String(d.faculty.cards.faculty), sub: "educators & assessors" },
  ];

  const metric: Record<string, string> = {
    learners: `${L.total} learners · ${L.active} active`,
    cohorts: d.cohorts.cards.highest ? `Top: ${d.cohorts.cards.highest.name} (${d.cohorts.cards.highest.pct}%)` : `${d.cohorts.cards.count} cohorts`,
    courses: `${d.courses.cards.courses} courses · ${pct(d.courses.cards.completion)} complete`,
    faculty: `${d.faculty.cards.faculty} faculty · ${d.faculty.ranking[0]?.assessments ?? 0} top assessments`,
    trends: d.trends.cards.competency ? `Competency ${d.trends.cards.competency.dir === "up" ? "▲" : "▼"} ${d.trends.cards.competency.pct}%` : "6-month history",
    custom: "14 data sources · AI assistant",
  };

  return (
    <div className="max-w-[1200px]">
      <LearningNav active="overview" />

      <div className="mb-5"><StatTiles tiles={tiles} cols="grid-cols-2 md:grid-cols-3 xl:grid-cols-6" /></div>

      <h2 className="text-sm font-bold text-gray-900 mb-3">Modules</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {MODULES.map(m => (
          <Link key={m.id} href={`/educator/analytics/learning/${m.id}`}
            className="bg-white border border-gray-100 rounded-2xl p-4 hover:border-purple-200 hover:shadow-sm transition-all">
            <div className="flex items-center gap-2 mb-2">
              <span className={`w-9 h-9 rounded-lg flex items-center justify-center text-base ${m.tint}`}>{m.icon}</span>
              <span className="text-[10px] font-bold text-gray-300">Module {m.n}</span>
            </div>
            <p className="text-[13px] font-bold text-gray-800">{m.name}</p>
            <p className="text-[11px] text-gray-400 mt-1 leading-snug">{m.desc}</p>
            <p className="text-[11px] font-semibold text-gray-600 mt-2">{metric[m.id]}</p>
            <p className={`text-[11px] font-semibold mt-1 ${m.accent}`}>Open module →</p>
          </Link>
        ))}
      </div>

      <p className="text-[10px] text-gray-400 mt-5">
        Every figure is live from your hospital&apos;s records. Cohorts are your departments (the populated grouping dimension). Dimensions with no store —
        time-spent, logins, lesson-level analytics, faculty ratings, forecasting — are shown as honest empty or &ldquo;soon&rdquo; states inside each module, never simulated.
      </p>
    </div>
  );
}
