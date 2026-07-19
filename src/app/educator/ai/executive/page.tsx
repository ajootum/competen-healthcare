import Link from "next/link";
import { requireEducatorAccess } from "@/lib/educator-access";
import { loadExecutiveIntelligence, healthColor, type TrendPoint } from "@/lib/executive-intelligence";
import CommandBar from "./CommandBar";

// Executive Intelligence Workspace (spec v1.0 + mockup) — the strategic command
// centre at the top of AI & Intelligence. Dark command-centre theme; a wide
// board-ready synthesis with a right-hand executive briefing panel over a live
// command bar. Every figure is a live institution-wide aggregate; scenarios &
// forecasts are rule-derived and advisory; decisions are shown read-only (no
// decision-record workflow yet) and finance/ROI is omitted (no store). AI never
// makes autonomous strategic decisions.

export const dynamic = "force-dynamic";

const RISK_CLS: Record<string, string> = { Low: "text-emerald-400", Medium: "text-amber-400", High: "text-rose-400" };
const SEV_CLS: Record<string, string> = { High: "bg-rose-500/20 text-rose-300 border-rose-500/30", Medium: "bg-amber-500/20 text-amber-300 border-amber-500/30", Low: "bg-sky-500/20 text-sky-300 border-sky-500/30" };
const STATUS_CLS: Record<string, string> = { "On Track": "text-emerald-400", Improving: "text-sky-400", "At Risk": "text-amber-400", Delayed: "text-rose-400" };
const IMPACT_CLS: Record<string, string> = { High: "bg-rose-500/20 text-rose-300", Medium: "bg-amber-500/20 text-amber-300", Low: "bg-emerald-500/15 text-emerald-200" };
const REC_CLS: Record<string, string> = { yes: "text-emerald-400", maybe: "text-amber-400", no: "text-rose-400" };

function Card({ title, tag, children }: { title: string; tag?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl bg-white/[0.03] border border-white/10 p-4">
      <div className="flex items-center gap-2 mb-3"><p className="text-[11px] font-bold uppercase tracking-widest text-slate-400">{title}</p>{tag && <span className="ml-auto text-[8px] font-bold uppercase tracking-wide text-slate-500">{tag}</span>}</div>
      {children}
    </div>
  );
}

function Donut({ slices, center, sub }: { slices: { label: string; pct: number; color: string }[]; center: string; sub: string }) {
  const C = 2 * Math.PI * 15.9;
  return (
    <div className="relative w-28 h-28 shrink-0">
      <svg viewBox="0 0 36 36" className="w-full h-full -rotate-90">
        <circle cx="18" cy="18" r="15.9" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="4" />
        {slices.map((s, i) => { const prev = slices.slice(0, i).reduce((a, b) => a + b.pct, 0); const dash = (s.pct / 100) * C; return <circle key={s.label} cx="18" cy="18" r="15.9" fill="none" stroke={s.color} strokeWidth="4" strokeDasharray={`${dash} ${C - dash}`} strokeDashoffset={-(prev / 100) * C} />; })}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center"><span className="text-base font-extrabold text-white">{center}</span><span className="text-[8px] text-slate-500">{sub}</span></div>
    </div>
  );
}

function TrendChart({ points }: { points: TrendPoint[] }) {
  const w = 280, h = 90, pad = 8;
  const xs = (i: number) => pad + (i / Math.max(1, points.length - 1)) * (w - 2 * pad);
  const ys = (v: number) => h - pad - (v / 100) * (h - 2 * pad);
  const path = (key: "health" | "quality") => points.map((p, i) => { const v = p[key]; return v === null ? "" : `${i === 0 || points[i - 1]?.[key] === null ? "M" : "L"}${xs(i)},${ys(v)}`; }).join(" ");
  return (
    <div>
      <svg viewBox={`0 0 ${w} ${h + 10}`} className="w-full">
        {[0, 25, 50, 75, 100].map(g => <line key={g} x1={pad} y1={ys(g)} x2={w - pad} y2={ys(g)} stroke="rgba(255,255,255,0.05)" strokeWidth="0.5" />)}
        <path d={path("health")} fill="none" stroke="#22c55e" strokeWidth="1.4" />
        <path d={path("quality")} fill="none" stroke="#3b82f6" strokeWidth="1.4" />
        {points.map((p, i) => <text key={i} x={xs(i)} y={h + 7} fontSize="6" fill="#64748b" textAnchor="middle">{p.label}</text>)}
      </svg>
      <div className="flex gap-3 mt-1"><span className="flex items-center gap-1 text-[9px] text-slate-400"><span className="w-2 h-2 rounded-full bg-emerald-500" />Institutional Health</span><span className="flex items-center gap-1 text-[9px] text-slate-400"><span className="w-2 h-2 rounded-full bg-blue-500" />Quality Index</span></div>
    </div>
  );
}

export default async function ExecutiveIntelligencePage() {
  const { admin, hospitalId } = await requireEducatorAccess();
  const d = await loadExecutiveIntelligence(admin, hospitalId ?? "");

  return (
    <div className="max-w-[1500px] -mx-4 md:-mx-6 -mt-4 md:-mt-8">
      <div className="bg-[#0a0d24] bg-[radial-gradient(ellipse_at_top,rgba(139,92,246,0.15),transparent_60%)] min-h-screen px-4 md:px-6 py-6 text-slate-200">

        {/* Header */}
        <div className="flex flex-wrap items-start gap-3 mb-4">
          <div className="min-w-0">
            <p className="text-[11px] text-slate-400 flex items-center gap-1.5"><Link href="/educator/ai" className="hover:text-violet-300">AI &amp; Intelligence</Link><span>›</span><span className="text-slate-300">Executive Intelligence</span></p>
            <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight bg-gradient-to-r from-violet-300 via-purple-300 to-indigo-300 bg-clip-text text-transparent">Executive Intelligence</h1>
            <p className="text-slate-400 text-sm">Enterprise Strategy • Performance • Risk • Readiness • Decisions</p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Link href="/educator/analytics/quality" className="text-[12px] font-semibold text-white bg-violet-600 hover:bg-violet-700 rounded-lg px-3 py-2 transition-colors">⬇ Export Report</Link>
            <span title="Scheduling needs a report-schedule store — coming soon" className="text-[12px] text-slate-400 bg-white/[0.04] border border-white/10 rounded-lg px-3 py-2 select-none">🗓 Schedule Report</span>
          </div>
        </div>

        {/* Context bar */}
        <div className="rounded-2xl bg-white/[0.03] border border-white/10 px-4 py-3 mb-5 flex flex-wrap items-center gap-x-6 gap-y-2 text-[12px]">
          <div><span className="text-slate-500">Institution</span> <span className="text-slate-200 font-medium">{d.scope.institution}</span></div>
          <div><span className="text-slate-500">Period</span> <span className="text-slate-200 font-medium">{d.scope.period}</span></div>
          <div className="ml-auto flex items-center gap-3">
            <span><span className="text-slate-500">Enterprise Risk</span> <span className={`font-bold ${RISK_CLS[d.enterpriseRisk]}`}>{d.enterpriseRisk}</span></span>
            <span><span className="text-slate-500">Forecast Confidence</span> <span className="font-bold text-slate-200">{d.forecastConfidence}</span></span>
          </div>
        </div>

        {/* Executive health scorecard */}
        <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400 mb-2">Executive Health Scorecard</p>
        <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-2.5 mb-5">
          {d.scorecard.map(k => (
            <div key={k.label} className="rounded-2xl bg-white/[0.03] border border-white/10 p-3">
              <p className={`text-2xl font-extrabold ${k.value === null ? "text-slate-500" : "text-white"}`}>{k.value === null ? "—" : `${k.value}%`}</p>
              <p className="text-[9px] text-slate-400 leading-tight mt-0.5 h-6">{k.label}</p>
              <p className={`text-[9px] font-bold ${k.trend >= 0 ? "text-emerald-400" : "text-rose-400"}`}>{k.trend >= 0 ? "↑" : "↓"} {Math.abs(k.trend)}% vs last period</p>
              <span className="block mt-1 h-1 rounded-full" style={{ background: healthColor(k.value) }} />
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_340px] gap-4">

          {/* ── Main ── */}
          <div className="flex flex-col gap-4 min-w-0">
            {/* Priorities + risks + decisions */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <Card title="Strategic Priority Map" tag="live">
                <div className="flex flex-col gap-1.5">
                  {d.priorities.map(p => (
                    <div key={p.name} className="text-[10px]">
                      <div className="flex items-center justify-between"><span className="text-slate-200 truncate mr-2">{p.name}</span><span className={`font-bold ${RISK_CLS[p.risk]}`}>{p.risk}</span></div>
                      <div className="flex items-center gap-2 mt-0.5"><span className={`${STATUS_CLS[p.status]} text-[9px] font-medium w-16`}>{p.status}</span><div className="h-1.5 flex-1 rounded-full bg-white/10 overflow-hidden"><div className="h-full rounded-full" style={{ width: `${p.progress ?? 0}%`, background: healthColor(p.progress) }} /></div><span className="text-slate-400 w-8 text-right">{p.progress ?? "—"}%</span></div>
                    </div>
                  ))}
                </div>
              </Card>

              <Card title="Strategic Risk Portfolio" tag="rule-derived">
                <div className="overflow-x-auto">
                  <table className="w-full text-[10px] border-collapse">
                    <thead><tr className="text-slate-400"><th className="text-left font-medium py-1">Risk</th><th className="font-medium">Impact</th><th className="font-medium">Likel.</th></tr></thead>
                    <tbody>
                      {d.risks.length === 0 ? <tr><td colSpan={3} className="text-center text-emerald-300 py-2">No strategic risks.</td></tr> : d.risks.map((r, i) => (
                        <tr key={i} className="border-t border-white/5"><td className="py-1 text-slate-200 truncate max-w-[110px]">{r.risk}</td><td className="text-center py-1"><span className={`text-[8px] font-bold px-1 rounded ${IMPACT_CLS[r.impact]}`}>{r.impact}</span></td><td className="text-center py-1"><span className={`text-[8px] font-bold px-1 rounded ${IMPACT_CLS[r.likelihood]}`}>{r.likelihood}</span></td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>

              <Card title="Decisions Requiring Action" tag="read-only">
                <div className="flex flex-col gap-1.5">
                  {d.decisions.map((dec, i) => (
                    <div key={i} className="rounded-lg bg-white/[0.03] border border-white/10 px-2.5 py-1.5">
                      <div className="flex items-center gap-2"><span className="text-[11px] text-white flex-1 leading-tight">{dec.title}</span><span className={`text-[8px] font-bold uppercase px-1.5 py-0.5 rounded border ${SEV_CLS[dec.priority]}`}>{dec.priority}</span></div>
                      <p className="text-[9px] text-slate-500 mt-0.5">Due {dec.due}</p>
                    </div>
                  ))}
                </div>
                <p className="text-[9px] text-slate-500 mt-2">Approve/delegate workflow needs a decision-record store — shown read-only for now.</p>
              </Card>
            </div>

            {/* Programmes + outcomes + workforce */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <Card title="Programme Portfolio" tag="live">
                <div className="overflow-x-auto">
                  <table className="w-full text-[10px] border-collapse">
                    <thead><tr className="text-slate-400"><th className="text-left font-medium py-1">Programme</th><th className="font-medium">Health</th><th className="font-medium">Rec.</th></tr></thead>
                    <tbody>
                      {d.programmes.length === 0 ? <tr><td colSpan={3} className="text-center text-slate-500 py-2">No programmes.</td></tr> : d.programmes.slice(0, 6).map(p => (
                        <tr key={p.name} className="border-t border-white/5"><td className="py-1 text-slate-200 truncate max-w-[100px]">{p.name}</td><td className="text-center py-1 font-bold" style={{ color: healthColor(p.health) }}>{p.health === null ? "—" : `${p.health}%`}</td><td className="text-center py-1 text-violet-300">{p.recommendation}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>

              <Card title="Learner Outcomes" tag="live">
                <div className="flex items-center gap-3">
                  <Donut slices={d.outcomes.slices} center={`${d.outcomes.rate ?? "—"}%`} sub="success" />
                  <div className="flex-1 min-w-0 flex flex-col gap-1">
                    {d.outcomes.slices.map(s => <div key={s.label} className="flex items-center gap-1.5 text-[9px]"><span className="w-2 h-2 rounded-full" style={{ background: s.color }} /><span className="text-slate-300 flex-1 truncate">{s.label}</span><span className="text-slate-400">{s.pct}%</span></div>)}
                  </div>
                </div>
                <div className="flex items-center justify-between gap-1 mt-2 pt-2 border-t border-white/5">{d.outcomes.insights.map(i => <div key={i.label} className="text-center flex-1"><p className="text-[11px] font-bold text-white">{i.value}</p><p className="text-[7px] text-slate-500 leading-tight">{i.label}</p></div>)}</div>
              </Card>

              <Card title="Workforce &amp; Capacity" tag="live">
                <div className="flex flex-col gap-2">
                  {d.workforce.bars.map(b => (
                    <div key={b.label}>
                      <div className="flex items-center justify-between text-[10px] mb-0.5"><span className="text-slate-300">{b.label}</span><span className="text-slate-400">{b.pct === null ? "—" : `${b.pct}%`}</span></div>
                      <div className="h-1.5 rounded-full bg-white/10 overflow-hidden"><div className="h-full rounded-full" style={{ width: `${b.pct ?? 0}%`, background: healthColor(b.pct) }} /></div>
                    </div>
                  ))}
                </div>
                <div className="flex items-center justify-between mt-2 pt-2 border-t border-white/5 text-[10px]"><span className="text-slate-400">Credential expiries (90d)</span><span className="text-amber-300 font-bold">{d.workforce.credentialExpiries}</span></div>
                {d.workforce.shortfall > 0 && <p className="text-[10px] text-rose-300 mt-1">⚠ Projected shortfall: {d.workforce.shortfall} assessor FTE</p>}
              </Card>
            </div>

            {/* Outlook + scenarios + trend */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <Card title="Predictive Outlook" tag="forecast · next 90d">
                <div className="flex flex-col gap-1.5">
                  {d.outlook.map(o => <div key={o.label} className="flex items-center justify-between text-[11px]"><span className="text-slate-300">{o.label}</span><span className={`font-bold ${o.dir === "up" && o.label !== "Validation Backlog" ? "text-emerald-400" : o.dir === "up" ? "text-rose-400" : "text-emerald-400"}`}>{o.dir === "up" ? "↑" : o.dir === "down" ? "↓" : "→"}{o.delta}%</span></div>)}
                </div>
                <p className="text-[9px] text-slate-500 mt-2"><Link href="/educator/ai/predictive" className="text-violet-300 hover:text-violet-200">Open Predictive Intelligence →</Link></p>
              </Card>

              <Card title="Scenario Comparison" tag="rule-based">
                <div className="overflow-x-auto">
                  <table className="w-full text-[10px] border-collapse">
                    <thead><tr className="text-slate-400"><th className="text-left font-medium py-1">Scenario</th><th className="font-medium">Cost</th><th className="font-medium">Impact</th><th className="font-medium">Rec</th></tr></thead>
                    <tbody>
                      {d.scenarios.map(s => (
                        <tr key={s.name} className="border-t border-white/5"><td className="py-1 text-slate-200 truncate max-w-[90px]">{s.name}</td><td className="text-center py-1 text-slate-400">{s.cost}</td><td className={`text-center py-1 font-bold ${s.readinessImpact >= 0 ? "text-emerald-400" : "text-rose-400"}`}>{s.readinessImpact >= 0 ? "+" : ""}{s.readinessImpact}%</td><td className={`text-center py-1 font-bold ${REC_CLS[s.recommend]}`}>{s.recommend === "yes" ? "✓" : s.recommend === "no" ? "✕" : "○"}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>

              <Card title="Enterprise Performance Trend" tag="live">
                <TrendChart points={d.trend} />
              </Card>
            </div>

            <CommandBar aiConfigured={d.panel.aiConfigured} />
          </div>

          {/* ── Right: Executive AI panel ── */}
          <div className="flex flex-col gap-4 min-w-0">
            <Card title="Executive AI Briefing" tag="rule-derived">
              <p className="text-[12px] text-white font-medium mb-1">{d.briefing.greeting}, {d.scope.institution.split(" ")[0]}.</p>
              <p className="text-[11px] text-slate-300 leading-snug">{d.briefing.headline}</p>
              <ul className="mt-2 space-y-1">{d.briefing.issues.map((s, i) => <li key={i} className="text-[10px] text-slate-400 flex gap-1.5"><span className="text-rose-400 shrink-0">●</span>{s}</li>)}</ul>
              <p className="text-[10px] text-emerald-300 mt-2 pt-2 border-t border-white/5">Top opportunity: {d.briefing.opportunity}</p>
            </Card>

            <Card title="Top Recommendations" tag="rule-derived">
              <div className="flex flex-col gap-1.5">
                {d.panel.recommendations.map((a, i) => (
                  <Link key={i} href={a.href} className="flex items-center gap-2 rounded-lg bg-white/[0.02] border border-white/5 px-2.5 py-1.5 hover:bg-white/[0.06] transition-colors">
                    <span className="text-[11px] text-slate-200 flex-1 leading-tight">{a.title}</span>
                    <span className={`text-[8px] font-bold uppercase px-1.5 py-0.5 rounded border ${SEV_CLS[a.priority]}`}>{a.priority}</span>
                  </Link>
                ))}
              </div>
            </Card>

            <Card title="Upcoming Executive Reports" tag="schedule">
              <div className="flex flex-col gap-1.5">
                {d.panel.reports.map(r => <div key={r.label} className="flex items-center justify-between text-[11px]"><span className="text-slate-300 flex gap-1.5"><span className="text-slate-500">📄</span>{r.label}</span><span className="text-slate-500 text-[9px]">{r.date}</span></div>)}
              </div>
            </Card>

            <Card title="Escalations" tag="rule-derived">
              <div className="flex flex-col gap-1.5">
                {d.panel.escalations.length === 0 ? <p className="text-[11px] text-emerald-300">No open escalations.</p> : d.panel.escalations.map((e, i) => (
                  <div key={i} className="flex items-center justify-between text-[11px]"><span className="text-slate-300 flex gap-1.5"><span className="text-rose-400">▲</span>{e.title}</span><span className="text-slate-500 text-[9px]">{e.owner}</span></div>
                ))}
              </div>
            </Card>

            <Card title="Quick Actions">
              <div className="flex flex-col gap-1.5">
                {d.panel.quickActions.map(a => <Link key={a.label} href={a.href} className="flex items-center justify-between rounded-lg bg-white/[0.03] border border-white/10 px-2.5 py-2 hover:bg-white/[0.07] transition-colors text-[11px] text-slate-200">{a.label}<span className="text-slate-600">›</span></Link>)}
              </div>
            </Card>
          </div>
        </div>

        <p className="text-[10px] text-slate-500 mt-6 flex items-center justify-center gap-2">
          <span>All intelligence powered by COMPETEN AI</span><span className="text-slate-700">•</span><span>Trusted data</span><span className="text-slate-700">•</span><span>Explainable insights</span><span className="text-slate-700">•</span><span>Human decisions</span>
        </p>
        <p className="text-[10px] text-slate-500 mt-2">
          Executive Intelligence converts every domain intelligence into strategic priorities, decisions and accountability. All KPIs are live institution-wide
          aggregates; scenarios and forecasts are rule-derived and advisory; decisions are shown read-only pending a governed decision-record workflow; financial/ROI
          and peer benchmarking are omitted where no store exists. The AI briefs and recommends — every strategic action requires human approval.
        </p>
      </div>
    </div>
  );
}
