import Link from "next/link";
import { requireEducatorAccess } from "@/lib/educator-access";
import { loadPredictiveIntelligence, type Forecast, type TimelineSeries, type HeatCell } from "@/lib/predictive-intelligence";
import CommandBar from "./CommandBar";
import WhatIf from "./WhatIf";

// Predictive Intelligence Workspace (spec v1.0 + mockup) — the cross-platform
// forecasting engine inside AI & Intelligence. Dark command-centre theme; three
// columns over a live command bar. Every forecast is a rule-derived projection
// from live trends — explicitly not a trained model; historical accuracy, model
// performance and the prediction library are shown muted, never fabricated.

export const dynamic = "force-dynamic";

const SEV_CLS: Record<string, string> = { High: "bg-rose-500/20 text-rose-300 border-rose-500/30", Medium: "bg-amber-500/20 text-amber-300 border-amber-500/30", Low: "bg-sky-500/20 text-sky-300 border-sky-500/30" };
const DIR = { up: "↑", down: "↓", flat: "→" };
const DOMAIN_CLS: Record<string, string> = { Assessment: "text-blue-300", Competency: "text-emerald-300", Validation: "text-amber-300", Workforce: "text-rose-300", Resources: "text-cyan-300", Accreditation: "text-pink-300", Learning: "text-violet-300" };
const HEAT = (n: number, tone: string) => (n === 0 ? "bg-white/[0.02] text-slate-600" : tone === "critical" ? "bg-rose-500/30 text-rose-200" : tone === "high" ? "bg-orange-500/25 text-orange-200" : tone === "medium" ? "bg-amber-500/20 text-amber-200" : "bg-emerald-500/15 text-emerald-200");

function Card({ title, tag, children }: { title: string; tag?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl bg-white/[0.03] border border-white/10 p-4">
      <div className="flex items-center gap-2 mb-3"><p className="text-[11px] font-bold uppercase tracking-widest text-slate-400">{title}</p>{tag && <span className="ml-auto text-[8px] font-bold uppercase tracking-wide text-slate-500">{tag}</span>}</div>
      {children}
    </div>
  );
}

function Donut({ slices, center, sub }: { slices: { label: string; n: number; color: string }[]; center: string; sub: string }) {
  const totalN = slices.reduce((s, x) => s + x.n, 0) || 1;
  const C = 2 * Math.PI * 15.9;
  return (
    <div className="relative w-24 h-24 shrink-0">
      <svg viewBox="0 0 36 36" className="w-full h-full -rotate-90">
        <circle cx="18" cy="18" r="15.9" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="4" />
        {slices.map((s, i) => { const prev = slices.slice(0, i).reduce((a, b) => a + b.n, 0); const dash = (s.n / totalN) * C; return <circle key={s.label} cx="18" cy="18" r="15.9" fill="none" stroke={s.color} strokeWidth="4" strokeDasharray={`${dash} ${C - dash}`} strokeDashoffset={-(prev / totalN) * C} />; })}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center"><span className="text-base font-extrabold text-white">{center}</span><span className="text-[8px] text-slate-500">{sub}</span></div>
    </div>
  );
}

function TimelineChart({ horizons, series }: { horizons: string[]; series: TimelineSeries[] }) {
  const w = 300, h = 120, pad = 8;
  const xs = (i: number) => pad + (i / Math.max(1, horizons.length - 1)) * (w - 2 * pad);
  const ys = (v: number) => h - pad - (v / 100) * (h - 2 * pad);
  return (
    <div>
      <svg viewBox={`0 0 ${w} ${h + 12}`} className="w-full">
        {[0, 25, 50, 75, 100].map(g => <line key={g} x1={pad} y1={ys(g)} x2={w - pad} y2={ys(g)} stroke="rgba(255,255,255,0.05)" strokeWidth="0.5" />)}
        {series.map(s => <path key={s.label} d={s.points.map((p, i) => `${i === 0 ? "M" : "L"}${xs(i)},${ys(p)}`).join(" ")} fill="none" stroke={s.color} strokeWidth="1.4" />)}
        {horizons.map((hz, i) => <text key={hz} x={xs(i)} y={h + 8} fontSize="6" fill="#64748b" textAnchor="middle">{hz}</text>)}
      </svg>
      <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1">{series.map(s => <span key={s.label} className="flex items-center gap-1 text-[9px] text-slate-400"><span className="w-2 h-2 rounded-full" style={{ background: s.color }} />{s.label}</span>)}</div>
    </div>
  );
}

function ForecastCard({ f }: { f: Forecast }) {
  return (
    <div className="rounded-xl bg-white/[0.03] border border-white/10 p-3">
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1"><span className="block text-[12px] font-bold text-white leading-tight">{f.title}</span><span className={`block text-[9px] font-medium ${DOMAIN_CLS[f.domain] ?? "text-slate-400"}`}>{f.domain}</span></span>
        <span className={`text-[13px] font-extrabold ${f.dir === "down" && f.domain === "Validation" ? "text-emerald-400" : f.dir === "up" ? "text-amber-300" : "text-slate-300"}`}>{DIR[f.dir]}{f.delta}%</span>
      </div>
      <div className="flex items-center justify-between mt-1.5 text-[9px]">
        <span className="text-slate-500">{f.horizon}</span>
        <span className="flex items-center gap-1.5"><span className="text-slate-400">{f.value === null ? "—" : `${f.value}${f.domain === "Workforce" ? "" : f.domain === "Assessment" ? "" : "%"}`}</span><span className={`font-bold px-1 rounded ${f.severity === "High" ? "text-rose-300" : "text-amber-300"}`}>{f.confidence}%</span></span>
      </div>
    </div>
  );
}

export default async function PredictiveIntelligencePage() {
  const { admin, hospitalId } = await requireEducatorAccess();
  const d = await loadPredictiveIntelligence(admin, hospitalId ?? "");
  const K = d.kpis;

  const overview = [
    { label: "High-Confidence Predictions", value: `${K.highConfidence}`, tint: "text-emerald-400" },
    { label: "Emerging Risks", value: `${K.emergingRisks}`, tint: "text-amber-400" },
    { label: "Critical Forecasts", value: `${K.criticalForecasts}`, tint: "text-rose-400" },
    { label: "Scenario Simulations", value: `${K.scenarios}`, tint: "text-sky-400" },
    { label: "Recommendations Accepted", value: K.recommendationsAccepted === null ? "—" : `${K.recommendationsAccepted}%`, tint: "text-slate-500", muted: K.recommendationsAccepted === null },
    { label: "Forecast Accuracy (Historical)", value: K.forecastAccuracy === null ? "—" : `${K.forecastAccuracy}%`, tint: "text-slate-500", muted: K.forecastAccuracy === null },
    { label: "Model Confidence", value: K.modelConfidence, tint: "text-violet-300" },
  ];

  return (
    <div className="max-w-[1500px] -mx-4 md:-mx-6 -mt-4 md:-mt-8">
      <div className="bg-[#0a0d24] bg-[radial-gradient(ellipse_at_top,rgba(6,182,212,0.13),transparent_60%)] min-h-screen px-4 md:px-6 py-6 text-slate-200">

        {/* Header */}
        <div className="flex flex-wrap items-start gap-3 mb-4">
          <div className="min-w-0">
            <p className="text-[11px] text-slate-400 flex items-center gap-1.5"><Link href="/educator/ai" className="hover:text-cyan-300">AI &amp; Intelligence</Link><span>›</span><span className="text-slate-300">Predictive Intelligence</span></p>
            <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight bg-gradient-to-r from-cyan-300 via-sky-300 to-blue-300 bg-clip-text text-transparent">Predictive Intelligence</h1>
            <p className="text-slate-400 text-sm">AI-powered Forecasting • Scenarios • Risks • Capacity • Readiness</p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Link href="/educator/ai/institution" className="text-[12px] font-semibold text-white bg-cyan-600 hover:bg-cyan-700 rounded-lg px-3 py-2 transition-colors">⬇ Export Report</Link>
            <span title="Sharing needs a share-link store — coming soon" className="text-[12px] text-slate-400 bg-white/[0.04] border border-white/10 rounded-lg px-3 py-2 select-none">↗ Share</span>
          </div>
        </div>

        {/* Context bar */}
        <div className="rounded-2xl bg-white/[0.03] border border-white/10 px-4 py-3 mb-5 flex flex-wrap items-center gap-x-6 gap-y-2 text-[12px]">
          <div><span className="text-slate-500">Institution</span> <span className="text-slate-200 font-medium">{d.scope.institution}</span></div>
          <div><span className="text-slate-500">Time Horizon</span> <span className="text-slate-200 font-medium">{d.scope.horizon}</span></div>
          <div><span className="text-slate-500">Domain</span> <span className="text-slate-200 font-medium">{d.scope.domain}</span></div>
          <div className="ml-auto flex items-center gap-3">
            <span><span className="text-slate-500">Model Confidence</span> <span className="font-bold text-violet-300">{K.modelConfidence}</span></span>
          </div>
        </div>

        {/* Predictive overview */}
        <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-2.5 mb-5">
          {overview.map(o => (
            <div key={o.label} className={`rounded-2xl border p-3 ${o.muted ? "bg-white/[0.015] border-white/5" : "bg-white/[0.03] border-white/10"}`}>
              <p className={`text-2xl font-extrabold ${o.tint}`}>{o.value}</p>
              <p className="text-[9px] text-slate-400 leading-tight mt-0.5">{o.label}</p>
              {o.muted && <span className="text-[8px] text-slate-600">no model store</span>}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-[280px_minmax(0,1fr)_320px] gap-4">

          {/* ── Left ── */}
          <div className="flex flex-col gap-4 min-w-0">
            <Card title="Forecast Explorer" tag="rule-derived">
              <div className="flex flex-col gap-2">{d.forecasts.map(f => <ForecastCard key={f.title} f={f} />)}</div>
            </Card>

            <Card title="What-If Simulator" tag="in-browser">
              <WhatIf currentAssessors={d.whatIf.currentAssessors} currentBacklog={d.whatIf.currentBacklog} />
            </Card>
          </div>

          {/* ── Center ── */}
          <div className="flex flex-col gap-4 min-w-0">
            <Card title="Prediction Timeline" tag="impact over time · forecast">
              <TimelineChart horizons={d.timeline.horizons} series={d.timeline.series} />
              <p className="text-[9px] text-slate-500 mt-1">How current trends may cascade across domains if unaddressed. Projected impact scores (0–100), not certainties.</p>
            </Card>

            {/* Scenario + confidence */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <Card title="Scenario Planner" tag="rule-based estimates">
                <div className="flex flex-col gap-2">
                  {d.scenarios.map(s => (
                    <div key={s.title} className="rounded-xl bg-white/[0.03] border border-white/10 p-2.5">
                      <div className="flex items-center gap-2"><span className="text-[12px] font-bold text-white flex-1 leading-tight">{s.title}</span><span className={`text-[8px] font-bold uppercase px-1.5 py-0.5 rounded border ${s.tag === "Best Outcome" ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/30" : s.tag === "High Impact" ? "bg-sky-500/20 text-sky-300 border-sky-500/30" : "bg-rose-500/20 text-rose-300 border-rose-500/30"}`}>{s.tag}</span></div>
                      <p className="text-[9px] text-slate-400 mt-0.5">{s.detail}</p>
                      <div className="flex items-center gap-3 mt-1.5 text-[9px]"><span className={s.readinessImpact >= 0 ? "text-emerald-400" : "text-rose-400"}>Readiness {s.readinessImpact >= 0 ? "+" : ""}{s.readinessImpact}%</span><span className="text-slate-500">Cost: {s.cost}</span><span className="text-slate-400">Conf {s.confidence}%</span></div>
                    </div>
                  ))}
                </div>
              </Card>

              <Card title="Confidence Analysis" tag="rule-derived">
                <div className="flex items-center gap-3">
                  <Donut slices={d.confidence.buckets} center={`${d.confidence.overall ?? "—"}%`} sub="overall" />
                  <div className="flex-1 min-w-0 flex flex-col gap-1">
                    {d.confidence.buckets.map(b => <div key={b.label} className="flex items-center gap-1.5 text-[10px]"><span className="w-2 h-2 rounded-full" style={{ background: b.color }} /><span className="text-slate-300 flex-1 truncate">{b.label}</span><span className="text-slate-400">{b.n}</span></div>)}
                  </div>
                </div>
                <p className="text-[9px] text-slate-500 mt-2">Confidence reflects data volume &amp; trend stability, not model calibration.</p>
              </Card>
            </div>

            {/* Cross-domain impact + heatmap */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <Card title="Cross-Domain Impact Explorer" tag="cascade">
                <div className="flex flex-col gap-1.5">
                  {d.impact.map((n, i) => (
                    <div key={n.id} className="flex flex-col items-center">
                      <div className={`w-full text-center rounded-lg border px-2 py-1.5 text-[11px] font-medium ${n.tone === "red" ? "bg-rose-500/15 border-rose-500/30 text-rose-200" : n.tone === "orange" ? "bg-orange-500/15 border-orange-500/30 text-orange-200" : "bg-amber-500/15 border-amber-500/30 text-amber-200"}`}>{n.label}</div>
                      {i < d.impact.length - 1 && <span className="text-slate-600 text-xs leading-none py-0.5">↓</span>}
                    </div>
                  ))}
                </div>
                <p className="text-[9px] text-slate-500 mt-2">How one predicted event may cascade across domains — a real dependency chain, illustrative magnitudes.</p>
              </Card>

              <Card title="Risk Forecast Heat-map" tag="likelihood × impact">
                <div className="overflow-x-auto">
                  <table className="w-full text-[10px] border-collapse">
                    <thead><tr className="text-slate-500"><th className="text-left font-medium py-1">Impact ↓ / Likelihood →</th><th className="font-medium">Low</th><th className="font-medium">Med</th><th className="font-medium">High</th><th className="font-medium">Crit</th></tr></thead>
                    <tbody>
                      {d.heatmap.map((row: HeatCell) => (
                        <tr key={row.impact}>
                          <td className="py-1 text-slate-300">{row.impact}</td>
                          <td className={`text-center py-1.5 font-bold rounded ${HEAT(row.low, "low")}`}>{row.low}</td>
                          <td className={`text-center py-1.5 font-bold rounded ${HEAT(row.medium, "medium")}`}>{row.medium}</td>
                          <td className={`text-center py-1.5 font-bold rounded ${HEAT(row.high, "high")}`}>{row.high}</td>
                          <td className={`text-center py-1.5 font-bold rounded ${HEAT(row.critical, "critical")}`}>{row.critical}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="text-[9px] text-slate-500 mt-2">Forecast risks placed by likelihood &amp; impact from live backlog, capacity &amp; expiry signals.</p>
              </Card>
            </div>

            {/* Workforce + resources */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <Card title="Workforce Forecast" tag="ratio-based">
                <div className="flex flex-col gap-1.5">
                  {d.workforce.map(w => (
                    <div key={w.role} className="flex items-center justify-between text-[11px]"><span className="text-slate-300">{w.role}</span><span className={`font-bold ${w.shortfall > 0 ? "text-rose-300" : "text-emerald-300"}`}>{w.shortfall > 0 ? `+${w.shortfall} FTE` : "Met"}</span></div>
                  ))}
                </div>
                <p className="text-[9px] text-slate-500 mt-2">Shortfall = target roster (learner-to-role ratios) minus current. Contracted-hours planning needs a scheduling store.</p>
              </Card>

              <Card title="Resource Forecast" tag="coverage live">
                <div className="flex flex-col gap-2">
                  {d.resources.rows.map(r => (
                    <div key={r.label}>
                      <div className="flex items-center justify-between text-[10px] mb-0.5"><span className={r.muted ? "text-slate-500" : "text-slate-300"}>{r.label}</span><span className="text-slate-400">{r.value === null ? "—" : `${r.value}%`}</span></div>
                      <div className="h-1.5 rounded-full bg-white/10 overflow-hidden"><div className="h-full rounded-full" style={{ width: `${r.value ?? 0}%`, background: r.muted ? "#334155" : "#06b6d4" }} /></div>
                    </div>
                  ))}
                </div>
                <p className="text-[9px] text-slate-500 mt-2">{d.resources.note}</p>
              </Card>
            </div>

            {/* Model performance honesty note */}
            <Card title="Model Performance" tag="no model store">
              <p className="text-[11px] text-slate-400">{d.modelPerformance.note}</p>
            </Card>

            <CommandBar aiConfigured={d.panel.aiConfigured} />
          </div>

          {/* ── Right ── */}
          <div className="flex flex-col gap-4 min-w-0">
            <Card title="AI Summary" tag="live">
              {[["Predictions Generated", d.panel.summary.predictionsGenerated], ["Critical Forecasts", d.panel.summary.criticalForecasts], ["High-Risk Trends", d.panel.summary.highRiskTrends], ["Scenario Simulations", d.panel.summary.scenarios], ["Forecast Accuracy", d.panel.summary.forecastAccuracy === null ? "—" : `${d.panel.summary.forecastAccuracy}%`]].map(([label, val]) => (
                <div key={label as string} className="flex items-center justify-between py-1 border-t border-white/5 first:border-t-0 text-[12px]"><span className="text-slate-400">{label}</span><span className="text-white font-bold">{val}</span></div>
              ))}
            </Card>

            <Card title="Top Risks Forecasted" tag="rule-derived">
              <div className="flex flex-col gap-1.5">
                {d.risks.length === 0 ? <p className="text-[11px] text-emerald-300">No elevated risk forecasts.</p> : d.risks.map((r, i) => (
                  <div key={i} className="flex items-start gap-2"><span className={`text-[8px] font-bold uppercase px-1.5 py-0.5 rounded border shrink-0 ${SEV_CLS[r.severity]}`}>{r.severity}</span><span className="text-[11px] text-slate-300 leading-tight">{r.title}</span></div>
                ))}
              </div>
            </Card>

            <Card title="AI Recommended Actions" tag="rule-derived">
              <div className="flex flex-col gap-1.5">
                {d.panel.actions.map((a, i) => (
                  <Link key={i} href={a.href} className="flex items-center gap-2 rounded-lg bg-white/[0.02] border border-white/5 px-2.5 py-1.5 hover:bg-white/[0.06] transition-colors">
                    <span className="text-[11px] text-slate-200 flex-1 leading-tight">{a.title}</span>
                    <span className={`text-[8px] font-bold uppercase px-1.5 py-0.5 rounded border ${SEV_CLS[a.priority]}`}>{a.priority}</span>
                  </Link>
                ))}
              </div>
            </Card>

            <Card title="AI Reasoning" tag="rule-derived">
              <ul className="space-y-1.5">{d.panel.reasoning.map((r, i) => <li key={i} className="text-[11px] text-slate-300 flex gap-2"><span className="text-cyan-400 shrink-0">•</span>{r}</li>)}</ul>
            </Card>

            <Card title="AI Generated Outputs" tag="live reports">
              <div className="flex flex-col gap-1">{d.panel.outputs.map(o => <Link key={o.label} href={o.href} className="flex items-center gap-2 text-[11px] text-slate-300 hover:text-white py-1"><span className="text-slate-500">📄</span>{o.label}<span className="ml-auto text-slate-600 text-[9px]">open →</span></Link>)}</div>
            </Card>
          </div>
        </div>

        <p className="text-[10px] text-slate-500 mt-6">
          Predictive Intelligence forecasts educational, operational, workforce and accreditation outcomes by projecting live trends forward — with explicit confidence
          and contributing factors. These are rule-derived, advisory projections, not a trained model or a certainty; there is no historical-accuracy or model-drift
          tracking yet. Scenarios and what-if simulations never change production data, and every strategic action requires human review.
        </p>
      </div>
    </div>
  );
}
