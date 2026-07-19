import { requireEducatorAccess } from "@/lib/educator-access";
import { loadLearningAnalytics } from "@/lib/learning-analytics";
import LearningNav from "../LearningNav";
import AskAssistant from "./AskAssistant";

// Module 6 — Custom Analytics Builder (Learning Analytics Workspace §Module 6).
// Full drag-and-drop dashboard persistence is not built; this shell exposes the
// spec's data sources & widget palette, a LIVE sample dashboard built from real
// widgets, and a working natural-language assistant (routes to the real AI
// copilot). Composer, save, schedule and export are honestly marked soon.

export const dynamic = "force-dynamic";

const SOURCES = [
  { name: "Learners", live: true }, { name: "Programs", live: false }, { name: "Courses", live: true },
  { name: "Competencies", live: true }, { name: "Assessments", live: true }, { name: "Simulations", live: true },
  { name: "CPUs", live: true }, { name: "Faculty", live: true }, { name: "Hospitals", live: true },
  { name: "Departments", live: true }, { name: "Audit results", live: true }, { name: "Accreditation", live: false },
  { name: "Portfolio", live: true }, { name: "CPD", live: false },
];
const WIDGETS = [
  { name: "KPIs", live: true }, { name: "Cards", live: true }, { name: "Charts", live: true }, { name: "Tables", live: true },
  { name: "Heatmaps", live: true }, { name: "Funnels", live: true }, { name: "Radar", live: true }, { name: "Timelines", live: true },
  { name: "Scorecards", live: true }, { name: "Gauge", live: false }, { name: "Treemaps", live: false }, { name: "Scatter", live: false },
  { name: "Sankey", live: false }, { name: "Maps", live: false },
];
const FILTERS = ["Date", "Program", "Hospital", "Department", "Country", "Learner", "Competency", "Assessment", "Faculty", "Role", "CPU", "Certification", "Risk Level"];
const SHARING = ["Save dashboard", "Schedule reports", "Export PDF", "Export Excel", "Power BI", "CSV", "Share link"];

export default async function CustomBuilder() {
  const { admin, hospitalId } = await requireEducatorAccess();
  const d = await loadLearningAnalytics(admin, hospitalId ?? "");
  const riskCounts = { High: 0, Medium: 0, Low: 0, None: 0 };
  for (const r of d.learners.table) riskCounts[r.risk]++;
  const cohortMax = Math.max(1, ...d.cohorts.table.map(c => c.competency ?? 0));

  return (
    <div className="max-w-[1200px]">
      <LearningNav active="custom" />

      <div className="grid grid-cols-1 lg:grid-cols-[220px_minmax(0,1fr)] gap-4 items-start">
        {/* Palettes */}
        <div className="flex flex-col gap-4">
          <div className="bg-white border border-gray-100 rounded-2xl p-4">
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">Data Sources</p>
            <div className="flex flex-col gap-1">
              {SOURCES.map(s => (
                <span key={s.name} className="flex items-center gap-2 text-[11px] rounded-lg border border-gray-100 px-2.5 py-1.5">
                  <span className={`w-1.5 h-1.5 rounded-full ${s.live ? "bg-green-500" : "bg-gray-200"}`} />
                  <span className={s.live ? "text-gray-700" : "text-gray-400"}>{s.name}</span>
                  {!s.live && <span className="ml-auto text-[7px] font-bold uppercase text-gray-300">soon</span>}
                </span>
              ))}
            </div>
          </div>
          <div className="bg-white border border-gray-100 rounded-2xl p-4">
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">Widgets</p>
            <div className="flex flex-wrap gap-1">
              {WIDGETS.map(w => (
                <span key={w.name} className={`text-[10px] rounded px-2 py-1 border ${w.live ? "text-gray-600 border-gray-200" : "text-gray-300 border-gray-100"}`}>{w.name}</span>
              ))}
            </div>
            <p className="text-[9px] text-gray-300 mt-2">Green = available in the platform today.</p>
          </div>
        </div>

        {/* Canvas: live sample dashboard */}
        <div className="flex flex-col gap-4">
          <div className="bg-white border border-gray-100 rounded-2xl p-5">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h2 className="text-sm font-bold text-gray-900">My Custom Dashboard <span className="font-normal text-gray-400 text-xs">(live sample)</span></h2>
                <p className="text-[10px] text-gray-400">A real dashboard composed from live widgets — this is what the builder produces.</p>
              </div>
              <span className="text-[9px] font-bold uppercase text-gray-300">composer soon</span>
            </div>

            {/* KPI row */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-4">
              {[
                { l: "Total Learners", v: String(d.learners.cards.total) },
                { l: "Completion", v: d.learners.cards.completionRate !== null ? `${d.learners.cards.completionRate}%` : "—" },
                { l: "Avg Competency", v: d.cohorts.cards.avgCompetency !== null ? `${d.cohorts.cards.avgCompetency}%` : "—" },
                { l: "At-Risk", v: String(riskCounts.High + riskCounts.Medium) },
              ].map(k => (
                <div key={k.l} className="rounded-xl bg-gray-50 p-3">
                  <p className="text-lg font-extrabold text-gray-900">{k.v}</p>
                  <p className="text-[9px] font-bold uppercase text-gray-400">{k.l}</p>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Cohort bar widget */}
              <div>
                <p className="text-[10px] font-bold text-gray-500 mb-2">Top Cohorts by Competency</p>
                {d.cohorts.table.length === 0 ? <p className="text-[11px] text-gray-400">No cohorts.</p> : (
                  <div className="flex flex-col gap-1.5">
                    {d.cohorts.table.slice(0, 5).map(c => (
                      <div key={c.id} className="flex items-center gap-2">
                        <span className="text-[10px] text-gray-500 w-24 truncate">{c.name}</span>
                        <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden"><div className="h-full bg-purple-500 rounded-full" style={{ width: `${((c.competency ?? 0) / cohortMax) * 100}%` }} /></div>
                        <span className="text-[10px] font-bold text-gray-600 w-8 text-right">{c.competency !== null ? `${c.competency}%` : "—"}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              {/* Risk distribution widget */}
              <div>
                <p className="text-[10px] font-bold text-gray-500 mb-2">Learner Risk Distribution</p>
                <div className="flex flex-col gap-1.5">
                  {([["High", "#ef4444"], ["Medium", "#f59e0b"], ["Low", "#3b82f6"], ["None", "#d1d5db"]] as const).map(([k, col]) => (
                    <div key={k} className="flex items-center gap-2 text-[11px]">
                      <span className="w-2 h-2 rounded-full" style={{ background: col }} />
                      <span className="text-gray-500 flex-1">{k}</span>
                      <span className="font-bold text-gray-800">{riskCounts[k]}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* AI Analytics Assistant */}
          <div className="bg-white border border-gray-100 rounded-2xl p-5">
            <div className="flex items-center gap-1.5 mb-2"><span>✨</span><h2 className="text-sm font-bold text-gray-900">AI Analytics Assistant</h2></div>
            <AskAssistant />
          </div>

          {/* Filters + sharing (soon) */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="bg-white border border-gray-100 rounded-2xl p-4">
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">Filters</p>
              <div className="flex flex-wrap gap-1">{FILTERS.map(f => <span key={f} className="text-[10px] text-gray-400 bg-gray-50 border border-gray-100 rounded px-2 py-1">{f}</span>)}</div>
            </div>
            <div className="bg-white border border-gray-100 rounded-2xl p-4">
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">Save &amp; Share</p>
              <div className="flex flex-wrap gap-1">{SHARING.map(s => <span key={s} className="text-[10px] text-gray-300 bg-gray-50 border border-gray-100 rounded px-2 py-1">{s} <span className="text-[7px] font-bold uppercase">soon</span></span>)}</div>
            </div>
          </div>
        </div>
      </div>

      <p className="text-[10px] text-gray-400 mt-5">
        The sample dashboard is composed from live widgets. Drag-and-drop composition, saved dashboards, scheduled reports and PDF/Excel/Power&nbsp;BI export
        need a builder store — marked soon. The AI assistant is live and grounded in your records.
      </p>
    </div>
  );
}
