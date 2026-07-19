import Link from "next/link";
import { requireEducatorAccess } from "@/lib/educator-access";
import { loadAnalytics, BANDS } from "@/lib/analytics-data";
import { SECTIONS } from "./sections";
import GenerateRecs from "../studio/curriculum/GenerateRecs";

// Analytics & Quality — Analytics Overview (UI & Developer Spec §3–5, approved
// mockup). The Educator's intelligence workspace: 6 live KPIs, learning-trend,
// competency heatmap, program-quality composite, AI insights, learner
// distribution, assessment performance, at-risk table and the 8 workspace
// sections. Every figure is computed from live hospital records; dimensions
// with no backing store are shown as honest "not tracked / soon" states.

export const dynamic = "force-dynamic";

const BAND_RGB = ["239,68,68", "245,158,11", "234,179,8", "34,197,94"]; // Foundational→Advanced
const fmtDate = () => new Date().toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

function TrendChip({ trend, goodUp }: { trend: { pct: number; dir: "up" | "down" } | null; goodUp: boolean }) {
  if (!trend) return null;
  const good = (trend.dir === "up") === goodUp;
  return (
    <span className={`text-[10px] font-bold ${good ? "text-green-600" : "text-red-500"}`}>
      {trend.dir === "up" ? "▲" : "▼"} {trend.pct}%
    </span>
  );
}

export default async function AnalyticsOverview() {
  const { admin, hospitalId } = await requireEducatorAccess();
  const d = await loadAnalytics(admin, hospitalId ?? "");
  const K = d.kpis;

  const kpiCards = [
    { icon: "👥", tint: "bg-purple-50 text-purple-600", label: "Active Learners", value: String(K.activeLearners.value), sub: `${K.activeLearners.active30} active · 30d`, trend: K.activeLearners.trend, goodUp: true, href: "/educator/students" },
    { icon: "📗", tint: "bg-green-50 text-green-600", label: "Course Completion", value: K.courseCompletion.pct !== null ? `${K.courseCompletion.pct}%` : "—", sub: K.courseCompletion.total ? `${K.courseCompletion.completed}/${K.courseCompletion.total} enrolments` : "No enrolments yet", trend: K.courseCompletion.trend, goodUp: true, href: "/educator/courses" },
    { icon: "🛡️", tint: "bg-blue-50 text-blue-600", label: "Avg. Competency Score", value: K.avgCompetency.pct !== null ? `${K.avgCompetency.pct}%` : "—", sub: K.avgCompetency.raw !== null ? `${K.avgCompetency.raw.toFixed(1)}/6 · 30d` : "No scores · 30d", trend: K.avgCompetency.trend, goodUp: true, href: "/educator/analytics/competency" },
    { icon: "🎯", tint: "bg-orange-50 text-orange-600", label: "Assessment Pass Rate", value: K.passRate.pct !== null ? `${K.passRate.pct}%` : "—", sub: "last 30 days", trend: K.passRate.trend, goodUp: true, href: "/educator/assessments" },
    { icon: "⚠️", tint: "bg-red-50 text-red-600", label: "At-Risk Learners", value: String(K.atRisk.count), sub: "live risk flags", trend: null, goodUp: false, href: "/educator/at-risk" },
    { icon: "⏳", tint: "bg-teal-50 text-teal-600", label: "CPD Compliance", value: K.cpdCompliance.pct !== null ? `${K.cpdCompliance.pct}%` : "—", sub: K.cpdCompliance.note || "—", trend: null, goodUp: true, href: "/educator/courses" },
  ];

  // AI insight signals (rule-derived from the live picture)
  const weakDomain = [...d.heatmap].sort((a, b) => {
    const adv = (x: typeof a) => x.cells[2].pct + x.cells[3].pct;
    return adv(a) - adv(b);
  })[0];
  const coverageBar = d.quality.find(q => q.label === "Curriculum Coverage");
  const insights = [
    d.kpis.atRisk.count > 0 && { icon: "⚠️", text: `${d.kpis.atRisk.count} learner${d.kpis.atRisk.count === 1 ? " is" : "s are"} at risk of failing their next assessment.`, href: "/educator/at-risk", cta: "View learners" },
    weakDomain && (weakDomain.cells[2].pct + weakDomain.cells[3].pct) < 60 && { icon: "📉", text: `${weakDomain.domain} domain has low proficiency (${weakDomain.cells[2].pct + weakDomain.cells[3].pct}% at Proficient+). Recommend more simulation & practice.`, href: "/educator/analytics/competency", cta: "View domain" },
    coverageBar?.pct != null && coverageBar.pct < 80 && { icon: "🧩", text: `Blueprint coverage is ${coverageBar.pct}%. Consider adding assessments for uncovered competencies.`, href: "/educator/studio/gaps", cta: "View gaps" },
  ].filter(Boolean) as { icon: string; text: string; href: string; cta: string }[];

  const quickActions = [
    { icon: "📄", label: "Generate Quality Report", href: "/educator/validation-analytics" },
    { icon: "📋", label: "View Improvement Plans", href: "/educator/plans" },
    { icon: "🗳️", label: "Create New Survey", soon: true },
    { icon: "📤", label: "Export Analytics", soon: true },
    { icon: "🛡️", label: "Schedule Quality Review", soon: true },
  ];

  const C = 2 * Math.PI * 40;
  const arcPcts = d.distribution.map(x => d.distributionTotal ? (x.n / d.distributionTotal) * 100 : 0);
  const arcs = d.distribution.map((x, i) => ({ ...x, pct: arcPcts[i], offset: arcPcts.slice(0, i).reduce((s, p) => s + p, 0) }));

  return (
    <div className="max-w-[1400px]">
      {/* Header + filter bar */}
      <div className="flex flex-wrap items-start gap-3 mb-6">
        <div className="min-w-0 mr-auto">
          <h1 className="text-2xl font-bold text-gray-900">📊 Analytics &amp; Quality</h1>
          <p className="text-gray-400 text-sm mt-0.5">Monitor learning performance, competency achievement and program quality to drive continuous improvement.</p>
        </div>
        <span className="hidden sm:flex items-center gap-1.5 bg-white border border-gray-200 rounded-xl px-3 py-2 text-xs text-gray-500 select-none" title="Programme filtering — coming soon">🎓 All Programmes</span>
        <span className="hidden sm:flex items-center gap-1.5 bg-white border border-gray-200 rounded-xl px-3 py-2 text-xs text-gray-600" suppressHydrationWarning>📅 30 days to {fmtDate()}</span>
        <Link href="/educator/notifications" className="bg-white border border-gray-200 rounded-xl w-10 h-10 flex items-center justify-center hover:border-purple-300 transition-colors">🔔</Link>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 mb-5">
        {kpiCards.map(c => (
          <Link key={c.label} href={c.href} className="bg-white border border-gray-100 rounded-2xl p-4 hover:border-purple-200 transition-colors">
            <div className="flex items-center justify-between">
              <span className={`w-9 h-9 rounded-full flex items-center justify-center text-base ${c.tint}`}>{c.icon}</span>
              <TrendChip trend={c.trend} goodUp={c.goodUp} />
            </div>
            <p className="text-2xl font-extrabold text-gray-900 leading-tight mt-2.5">{c.value}</p>
            <p className="text-[11px] font-semibold text-gray-500">{c.label}</p>
            <p className="text-[10px] text-gray-400 mt-0.5 truncate" title={c.sub}>{c.sub}</p>
          </Link>
        ))}
      </div>

      {/* Row 1: trend · heatmap · quality · AI insights */}
      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-4 gap-4 mb-5 items-start">
        {/* Learning Progress Trend */}
        <div className="bg-white border border-gray-100 rounded-2xl p-5">
          <h2 className="text-sm font-bold text-gray-900 mb-1">Learning Progress Trend</h2>
          <div className="flex items-center gap-3 mb-2 text-[9px]">
            {[["Overall", "#9333ea"], ["Completion", "#10b981"], ["Success", "#f59e0b"]].map(([l, c]) => (
              <span key={l} className="flex items-center gap-1 text-gray-500"><span className="w-2 h-2 rounded-full" style={{ background: c }} />{l}</span>
            ))}
          </div>
          {d.progressTrend.every(w => w.overall === null && w.completion === null && w.success === null) ? (
            <p className="text-xs text-gray-400 py-8 text-center">No activity in the last 4 weeks.</p>
          ) : (
            <svg viewBox="0 0 220 110" className="w-full">
              {[0, 25, 50, 75, 100].map(y => <line key={y} x1="22" x2="214" y1={92 - y * 0.8} y2={92 - y * 0.8} stroke="#f3f4f6" strokeWidth="1" />)}
              {[0, 50, 100].map(y => <text key={y} x="18" y={95 - y * 0.8} fontSize="7" fill="#c4c4cc" textAnchor="end">{y}</text>)}
              {([["overall", "#9333ea"], ["completion", "#10b981"], ["success", "#f59e0b"]] as const).map(([key, col]) => {
                const pts = d.progressTrend.map((w, i) => ({ x: 40 + i * 55, y: w[key] !== null ? 92 - (w[key] as number) * 0.8 : null }));
                const line = pts.filter(p => p.y !== null) as { x: number; y: number }[];
                return (
                  <g key={key}>
                    {line.length > 1 && <polyline fill="none" stroke={col} strokeWidth="1.5" points={line.map(p => `${p.x},${p.y}`).join(" ")} />}
                    {line.map(p => <circle key={p.x} cx={p.x} cy={p.y} r="2.5" fill={col} />)}
                  </g>
                );
              })}
              {d.progressTrend.map((w, i) => <text key={w.label} x={40 + i * 55} y="104" fontSize="7" fill="#9ca3af" textAnchor="middle">{w.label}</text>)}
            </svg>
          )}
          <p className="text-[9px] text-gray-300 mt-1">Overall = avg competency %, weekly. Gaps mean no activity that week.</p>
        </div>

        {/* Competency Achievement Heatmap */}
        <div className="bg-white border border-gray-100 rounded-2xl p-5">
          <h2 className="text-sm font-bold text-gray-900 mb-2">Competency Achievement Heatmap</h2>
          {d.heatmap.length === 0 ? (
            <p className="text-xs text-gray-400 py-8 text-center">No competency scores recorded yet.</p>
          ) : (
            <>
              <div className="grid grid-cols-[minmax(0,1fr)_repeat(4,22px)] gap-1 items-center">
                <span />
                {BANDS.map(b => <span key={b} className="text-[7px] text-gray-400 text-center leading-tight" title={b}>{b.slice(0, 4)}</span>)}
                {d.heatmap.map(row => (
                  <div key={row.domain} className="contents">
                    <span className="text-[10px] text-gray-600 truncate pr-1" title={row.domain}>{row.domain}</span>
                    {row.cells.map((cell, i) => (
                      <span key={i} className="h-5 rounded flex items-center justify-center text-[7px] font-bold text-gray-700"
                        style={{ background: `rgba(${BAND_RGB[i]},${Math.max(0.08, cell.pct / 100)})` }}
                        title={`${row.domain} · ${cell.band}: ${cell.pct}% (${cell.n})`}>
                        {cell.pct > 0 ? cell.pct : ""}
                      </span>
                    ))}
                  </div>
                ))}
              </div>
              <p className="text-[9px] text-gray-300 mt-2">Cell = share of the domain&apos;s scores in each band; opacity scales with share.</p>
            </>
          )}
        </div>

        {/* Program Quality Summary */}
        <div className="bg-white border border-gray-100 rounded-2xl p-5">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-bold text-gray-900">Program Quality Summary</h2>
            {d.overallQuality !== null && <span className={`text-xs font-extrabold ${d.overallQuality >= 80 ? "text-green-600" : d.overallQuality >= 60 ? "text-amber-600" : "text-red-500"}`}>{d.overallQuality}%</span>}
          </div>
          <div className="flex flex-col gap-1.5">
            {d.quality.map(q => (
              <div key={q.label} className="flex items-center gap-2 text-[10px]">
                <span className="text-gray-500 w-32 truncate shrink-0" title={q.label}>{q.label}</span>
                {q.backed && q.pct !== null ? (
                  <>
                    <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                      <div className={`h-full rounded-full ${q.pct >= 80 ? "bg-green-500" : q.pct >= 60 ? "bg-blue-500" : q.pct >= 40 ? "bg-amber-400" : "bg-red-400"}`} style={{ width: `${q.pct}%` }} />
                    </div>
                    <span className="font-bold text-gray-700 w-8 text-right shrink-0">{q.pct}%</span>
                  </>
                ) : (
                  <span className="flex-1 text-right text-[8px] font-bold uppercase tracking-wider text-gray-300">soon</span>
                )}
              </div>
            ))}
          </div>
          <p className="text-[9px] text-gray-300 mt-2">Overall = average of backed indicators. Outcome, quality-index &amp; faculty metrics need stores not yet built.</p>
        </div>

        {/* AI Insights */}
        <div className="bg-white border border-gray-100 rounded-2xl p-5">
          <div className="flex items-center gap-1.5 mb-2">
            <span>✨</span><h2 className="text-sm font-bold text-gray-900">AI Insights</h2>
            <span className="ml-auto text-[8px] font-bold uppercase text-gray-300">rule-derived</span>
          </div>
          {insights.length === 0 ? (
            <p className="text-xs text-gray-400 mb-3">No issues detected in the live picture. ✅</p>
          ) : (
            <div className="flex flex-col gap-2 mb-3">
              {insights.map((x, i) => (
                <Link key={i} href={x.href} className="flex gap-2 rounded-lg bg-violet-50/60 border border-violet-100 p-2 hover:border-violet-300 transition-colors">
                  <span className="text-sm shrink-0">{x.icon}</span>
                  <span className="min-w-0">
                    <span className="block text-[11px] text-gray-700 leading-snug">{x.text}</span>
                    <span className="text-[10px] font-semibold text-violet-700">{x.cta} →</span>
                  </span>
                </Link>
              ))}
            </div>
          )}
          <GenerateRecs />
        </div>
      </div>

      {/* Row 2: distribution · assessment performance · at-risk · quick actions */}
      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-4 gap-4 mb-5 items-start">
        {/* Learner Distribution */}
        <div className="bg-white border border-gray-100 rounded-2xl p-5">
          <h2 className="text-sm font-bold text-gray-900 mb-3">Learner Distribution</h2>
          {d.distributionTotal === 0 ? (
            <p className="text-xs text-gray-400 py-8 text-center">No learner performance data yet.</p>
          ) : (
            <div className="flex items-center gap-4">
              <div className="relative w-24 shrink-0">
                <svg viewBox="0 0 100 100" className="w-full -rotate-90">
                  <circle cx="50" cy="50" r="40" fill="none" stroke="#f3f4f6" strokeWidth="12" />
                  {arcs.filter(a => a.pct > 0).map(a => (
                    <circle key={a.label} cx="50" cy="50" r="40" fill="none" stroke={a.color} strokeWidth="12"
                      strokeDasharray={`${(a.pct / 100) * C} ${C}`} strokeDashoffset={-(a.offset / 100) * C} />
                  ))}
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <p className="text-lg font-extrabold text-gray-900 leading-none">{d.distributionTotal}</p>
                  <p className="text-[8px] text-gray-400">learners</p>
                </div>
              </div>
              <div className="flex flex-col gap-1.5 flex-1">
                {d.distribution.map(x => (
                  <div key={x.label} className="flex items-center gap-2 text-[10px]">
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ background: x.color }} />
                    <span className="text-gray-500 flex-1 truncate">{x.label}</span>
                    <span className="font-bold text-gray-800">{x.n}</span>
                    <span className="text-gray-400 w-8 text-right">{d.distributionTotal ? Math.round((x.n / d.distributionTotal) * 100) : 0}%</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Assessment Performance Overview */}
        <div className="bg-white border border-gray-100 rounded-2xl p-5">
          <h2 className="text-sm font-bold text-gray-900 mb-1">Assessment Performance</h2>
          <div className="flex items-center gap-3 mb-2 text-[9px]">
            <span className="flex items-center gap-1 text-gray-500"><span className="w-2 h-2 rounded-full bg-green-500" />Pass rate</span>
            <span className="flex items-center gap-1 text-gray-500"><span className="w-2 h-2 rounded-full bg-purple-500" />Avg score</span>
          </div>
          {d.assessmentPerf.every(a => a.n === 0) ? (
            <p className="text-xs text-gray-400 py-8 text-center">No assessment activity yet.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {d.assessmentPerf.map(a => (
                <div key={a.label}>
                  <div className="flex items-center justify-between text-[10px]">
                    <span className="text-gray-600">{a.label} <span className="text-gray-300">({a.n})</span></span>
                    {a.n === 0 && <span className="text-[8px] font-bold uppercase text-gray-300">no data</span>}
                  </div>
                  {a.n > 0 && (
                    <div className="flex flex-col gap-0.5 mt-0.5">
                      <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden"><div className="h-full rounded-full bg-green-500" style={{ width: `${a.passRate ?? 0}%` }} /></div>
                      <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden"><div className="h-full rounded-full bg-purple-500" style={{ width: `${a.avg ?? 0}%` }} /></div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
          <p className="text-[9px] text-gray-300 mt-2">Quizzes from attempts; observation &amp; simulation from recorded assessments. OSCE store not populated yet.</p>
        </div>

        {/* Top At-Risk Learners */}
        <div className="bg-white border border-gray-100 rounded-2xl p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-bold text-gray-900">Top At-Risk Learners</h2>
            <Link href="/educator/at-risk" className="text-[11px] font-semibold text-purple-600 hover:underline">View all →</Link>
          </div>
          {d.topAtRisk.length === 0 ? (
            <p className="text-xs text-gray-400">No learners flagged at risk. 🎉</p>
          ) : (
            <div className="flex flex-col gap-2">
              {d.topAtRisk.map(r => (
                <div key={r.id} className="flex items-center gap-2">
                  <span className="w-7 h-7 rounded-full bg-red-50 text-red-600 flex items-center justify-center text-[10px] font-bold shrink-0">
                    {r.name.split(" ").map(w => w[0]).slice(0, 2).join("")}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[12px] font-semibold text-gray-800 truncate">{r.name}</p>
                    <p className="text-[10px] text-gray-400 truncate">{r.program}</p>
                  </div>
                  <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded shrink-0 ${r.level === "High" ? "bg-red-50 text-red-600" : r.level === "Medium" ? "bg-amber-50 text-amber-600" : "bg-gray-100 text-gray-500"}`}>
                    {r.level} · {r.score}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Quick Actions */}
        <div className="bg-white border border-gray-100 rounded-2xl p-5">
          <h2 className="text-sm font-bold text-gray-900 mb-3">Quick Actions</h2>
          <div className="flex flex-col gap-1.5">
            {quickActions.map(q => q.soon ? (
              <span key={q.label} title="Coming soon — no backing store yet" className="flex items-center gap-2.5 rounded-lg border border-gray-100 px-3 py-2 text-[12px] text-gray-300 select-none">
                <span>{q.icon}</span><span className="flex-1">{q.label}</span>
                <span className="text-[8px] font-bold uppercase">soon</span>
              </span>
            ) : (
              <Link key={q.label} href={q.href!} className="flex items-center gap-2.5 rounded-lg border border-gray-100 px-3 py-2 text-[12px] text-gray-700 hover:border-purple-200 hover:bg-purple-50/40 transition-colors">
                <span>{q.icon}</span><span className="flex-1">{q.label}</span><span className="text-gray-300">›</span>
              </Link>
            ))}
          </div>
        </div>
      </div>

      {/* Analytics & Quality Workspaces */}
      <h2 className="text-sm font-bold text-gray-900 mb-3">Analytics &amp; Quality Workspaces</h2>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        {SECTIONS.map(s => (
          <Link key={s.id} href={`/educator/analytics/${s.id}`} className="bg-white border border-gray-100 rounded-2xl p-4 hover:border-purple-200 hover:shadow-sm transition-all">
            <div className="flex items-center gap-2 mb-2">
              <span className={`w-8 h-8 rounded-lg flex items-center justify-center text-sm ${s.tint}`}>{s.icon}</span>
              <span className="text-[10px] font-bold text-gray-300">{s.n}</span>
            </div>
            <p className="text-[12px] font-bold text-gray-800 leading-tight">{s.name}</p>
            <p className="text-[10px] text-gray-400 mt-1 leading-snug line-clamp-3">{s.desc}</p>
            <p className={`text-[11px] font-semibold mt-2 ${s.accent}`}>Explore →</p>
          </Link>
        ))}
      </div>

      <p className="text-[10px] text-gray-400">
        Data refreshes on every load. All figures are computed live from your hospital&apos;s records; dimensions with no backing store
        (CPD target, learning-outcome, faculty and reliability metrics, OSCE results) are shown as honest empty or &ldquo;soon&rdquo; states rather than simulated.
        Cross-dashboard filtering, saved presets and PDF/Excel export are on the roadmap.
      </p>
    </div>
  );
}
