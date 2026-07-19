import Link from "next/link";
import { requireEducatorAccess } from "@/lib/educator-access";
import { loadLearningIntelligence, type NavNode, type Tint, type RiskDot } from "@/lib/learning-intelligence";
import CommandBar from "./CommandBar";

// Learning Intelligence Workspace (spec v1.0 + mockup) — the AI-powered learner
// progression / engagement / mastery / intervention centre inside AI &
// Intelligence. Dark command-centre theme; three columns (Navigator ·
// Intelligence · AI Panel) over a live command bar. Every figure is computed
// from real learner records; signals with no store are shown muted or labelled
// as forecasts — never fabricated.

export const dynamic = "force-dynamic";

const TINT_DOT: Record<Tint, string> = { green: "bg-emerald-400", amber: "bg-amber-400", red: "bg-rose-400", muted: "bg-slate-600" };
const RISK_CLS: Record<string, string> = { Low: "text-emerald-400", Medium: "text-amber-400", High: "text-rose-400" };
const SEV_CLS: Record<string, string> = { High: "bg-rose-500/20 text-rose-300 border-rose-500/30", Medium: "bg-amber-500/20 text-amber-300 border-amber-500/30", Low: "bg-sky-500/20 text-sky-300 border-sky-500/30" };
const BAND_COLOR = ["#475569", "#f59e0b", "#eab308", "#22c55e", "#14b8a6"];

function NavTree({ node, depth }: { node: NavNode; depth: number }) {
  const dot = <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${TINT_DOT[node.tint]}`} />;
  if (!node.children.length) {
    return <div className="flex items-center gap-2 py-1 pr-2" style={{ paddingLeft: `${depth * 12 + 8}px` }}>{dot}<span className="text-[12px] text-slate-300 truncate">{node.name}</span><span className="text-[9px] text-slate-500 ml-auto whitespace-nowrap">{node.meta}</span></div>;
  }
  return (
    <details open={depth < 2} className="group">
      <summary className="flex items-center gap-2 py-1 pr-2 cursor-pointer list-none hover:bg-white/[0.03] rounded" style={{ paddingLeft: `${depth * 12 + 8}px` }}>
        <span className="text-[9px] text-slate-500 transition-transform group-open:rotate-90">▶</span>{dot}<span className="text-[12px] font-medium text-slate-200 truncate">{node.name}</span><span className="text-[9px] text-slate-500 ml-auto whitespace-nowrap">{node.meta}</span>
      </summary>
      <div>{node.children.map(c => <NavTree key={c.id} node={c} depth={depth + 1} />)}</div>
    </details>
  );
}

// Learner Risk Map — scatter of learners by progression (x) × engagement (y),
// coloured by state, with the four strategic quadrants.
function RiskMap({ dots }: { dots: RiskDot[] }) {
  const STATE_COLOR: Record<string, string> = { "On Track": "#22c55e", Accelerating: "#3b82f6", "Needs Attention": "#f59e0b", "At Risk": "#f97316", Critical: "#ef4444", Inactive: "#64748b" };
  return (
    <div className="relative w-full" style={{ aspectRatio: "16 / 10" }}>
      <div className="absolute inset-0 rounded-xl bg-white/[0.02] border border-white/10" />
      <div className="absolute left-2 top-1 text-[8px] text-slate-500">High engagement · low progress — needs support</div>
      <div className="absolute right-2 top-1 text-[8px] text-slate-500 text-right">High engagement · high progress — accelerating</div>
      <div className="absolute left-2 bottom-1 text-[8px] text-slate-500">Low engagement · low progress — high risk</div>
      <div className="absolute right-2 bottom-1 text-[8px] text-slate-500 text-right">Low engagement · high progress — monitor</div>
      <svg viewBox="0 0 100 62.5" preserveAspectRatio="none" className="absolute inset-0 w-full h-full">
        <line x1="50" y1="0" x2="50" y2="62.5" stroke="rgba(255,255,255,0.08)" strokeWidth="0.3" />
        <line x1="0" y1="31.25" x2="100" y2="31.25" stroke="rgba(255,255,255,0.08)" strokeWidth="0.3" />
        {dots.map(d => (
          <circle key={d.id} cx={d.x} cy={(100 - d.y) * 0.625} r="1.1" fill={STATE_COLOR[d.state]} fillOpacity="0.85">
            <title>{`${d.label} — ${d.state}\nDriver: ${d.driver}\nProgress: ${d.x}% · Engagement: ${d.y}%`}</title>
          </circle>
        ))}
      </svg>
      <span className="absolute -left-1 top-1/2 -translate-y-1/2 -rotate-90 text-[8px] font-bold uppercase tracking-widest text-slate-500">Engagement</span>
      <span className="absolute bottom-[-2px] left-1/2 -translate-x-1/2 text-[8px] font-bold uppercase tracking-widest text-slate-500">Progression</span>
    </div>
  );
}

function Gauge({ value, label, color }: { value: number | null; label: string; color?: string }) {
  const col = color ?? (value === null ? "#64748b" : value >= 75 ? "#22c55e" : value >= 50 ? "#f59e0b" : "#ef4444");
  return (
    <div className="flex flex-col items-center">
      <div className="relative w-24 h-24">
        <svg viewBox="0 0 36 36" className="w-full h-full -rotate-90">
          <circle cx="18" cy="18" r="15.9" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="3" />
          {value !== null && <circle cx="18" cy="18" r="15.9" fill="none" stroke={col} strokeWidth="3" strokeDasharray={`${value} 100`} strokeLinecap="round" />}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center"><span className="text-lg font-extrabold text-white">{value ?? "—"}{value !== null && <span className="text-[10px]">%</span>}</span></div>
      </div>
      <p className="text-[10px] text-slate-400 mt-1 text-center">{label}</p>
    </div>
  );
}

function Card({ title, tag, children }: { title: string; tag?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl bg-white/[0.03] border border-white/10 p-4">
      <div className="flex items-center gap-2 mb-3"><p className="text-[11px] font-bold uppercase tracking-widest text-slate-400">{title}</p>{tag && <span className="ml-auto text-[8px] font-bold uppercase tracking-wide text-slate-500">{tag}</span>}</div>
      {children}
    </div>
  );
}

export default async function LearningIntelligencePage() {
  const { admin, hospitalId } = await requireEducatorAccess();
  const d = await loadLearningIntelligence(admin, hospitalId ?? "");
  const maxBarrier = Math.max(1, ...d.barriers.rows.map(b => b.learners));

  return (
    <div className="max-w-[1500px] -mx-4 md:-mx-6 -mt-4 md:-mt-8">
      <div className="bg-[#0a0d24] bg-[radial-gradient(ellipse_at_top,rgba(16,185,129,0.13),transparent_60%)] min-h-screen px-4 md:px-6 py-6 text-slate-200">

        {/* Header */}
        <div className="flex flex-wrap items-start gap-3 mb-4">
          <div className="min-w-0">
            <p className="text-[11px] text-slate-400 flex items-center gap-1.5"><Link href="/educator/ai" className="hover:text-emerald-300">AI &amp; Intelligence</Link><span>›</span><span className="text-slate-300">Learning Intelligence</span></p>
            <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight bg-gradient-to-r from-emerald-300 via-teal-300 to-green-300 bg-clip-text text-transparent">Learning Intelligence</h1>
            <p className="text-slate-400 text-sm">AI-powered Progression • Engagement • Mastery • Prediction • Intervention</p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Link href="/educator/analytics/learning" className="text-[12px] font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg px-3 py-2 transition-colors">⬇ Export Report</Link>
            <span title="Sharing needs a share-link store — coming soon" className="text-[12px] text-slate-400 bg-white/[0.04] border border-white/10 rounded-lg px-3 py-2 select-none">↗ Share</span>
          </div>
        </div>

        {/* Context bar */}
        <div className="rounded-2xl bg-white/[0.03] border border-white/10 px-4 py-3 mb-5 flex flex-wrap items-center gap-x-6 gap-y-2 text-[12px]">
          <div><span className="text-slate-500">Scope</span> <span className="text-slate-200 font-medium">{d.scope.institution}</span></div>
          <div><span className="text-slate-500">Cohorts</span> <span className="text-slate-200 font-medium">{d.scope.cohorts}</span></div>
          <div><span className="text-slate-500">Learners</span> <span className="text-slate-200 font-medium">{d.scope.learners}</span></div>
          <div><span className="text-slate-500">Period</span> <span className="text-slate-200 font-medium">{d.scope.period}</span></div>
          <div className="ml-auto flex items-center gap-3">
            <span><span className="text-slate-500">Risk</span> <span className={`font-bold ${RISK_CLS[d.risk.level]}`}>{d.risk.level}</span></span>
            <span><span className="text-slate-500">AI Confidence</span> <span className="font-bold text-slate-200">{d.risk.confidence}</span></span>
          </div>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-[260px_minmax(0,1fr)_320px] gap-4">

          {/* ── Left ── */}
          <div className="flex flex-col gap-4 min-w-0">
            <Card title="Learning Navigator" tag="live">
              <div className="max-h-[240px] overflow-y-auto -mx-1"><NavTree node={d.navigator} depth={0} /></div>
              <p className="text-[9px] text-slate-500 mt-2 pt-2 border-t border-white/5">Cohorts = departments (the populated grouping). Programme/year/group layers aren&apos;t modelled yet.</p>
            </Card>

            <Card title="Learner Status" tag="live">
              <div className="flex flex-col gap-1.5">
                {d.statusCounts.map(s => (
                  <div key={s.state} className="flex items-center gap-2 text-[11px]"><span className="w-2 h-2 rounded-full" style={{ background: s.color }} /><span className="text-slate-300 flex-1">{s.state}</span><span className="text-slate-200 font-medium">{s.n}</span></div>
                ))}
              </div>
            </Card>

            <Card title="Intervention Effectiveness" tag="live">
              <div className="flex items-center gap-3">
                <Gauge value={d.interventions.successRate} label="Success Rate" color="#10b981" />
                <div className="flex-1 min-w-0 flex flex-col gap-1 text-[11px]">
                  <div className="flex justify-between"><span className="text-slate-400">Initiated</span><span className="text-slate-200">{d.interventions.total}</span></div>
                  <div className="flex justify-between"><span className="text-emerald-400">Improved</span><span className="text-slate-200">{d.interventions.improved}</span></div>
                  <div className="flex justify-between"><span className="text-amber-400">No change</span><span className="text-slate-200">{d.interventions.noChange}</span></div>
                  <div className="flex justify-between"><span className="text-rose-400">Escalated</span><span className="text-slate-200">{d.interventions.escalated}</span></div>
                </div>
              </div>
              <p className="text-[9px] text-slate-500 mt-2">{d.interventions.note}</p>
            </Card>
          </div>

          {/* ── Center ── */}
          <div className="flex flex-col gap-4 min-w-0">
            <Card title="Learning Health Dashboard" tag="live">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                {d.health.map(k => (
                  <div key={k.label} className="rounded-xl bg-white/[0.03] border border-white/10 p-3">
                    <p className={`text-2xl font-extrabold ${k.value === null ? "text-slate-500" : "text-white"}`}>{k.value === null ? "—" : `${k.value}%`}</p>
                    <p className="text-[10px] text-slate-400 leading-tight mt-0.5">{k.label}</p>
                    <span className={`inline-block mt-1.5 w-6 h-1 rounded-full ${TINT_DOT[k.tint]}`} />
                  </div>
                ))}
              </div>
            </Card>

            <Card title="Learner Risk Map" tag="interactive · live">
              <RiskMap dots={d.riskMap} />
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2">
                {d.statusCounts.map(s => <span key={s.state} className="flex items-center gap-1 text-[9px] text-slate-400"><span className="w-2 h-2 rounded-full" style={{ background: s.color }} />{s.state}</span>)}
              </div>
              <p className="text-[9px] text-slate-500 mt-1">Hover a learner for their risk driver. Positioned by live progression × engagement; names shortened for privacy.</p>
            </Card>

            {/* Progression + Engagement */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <Card title="Progression Intelligence" tag="live">
                <div className="flex items-baseline gap-2 mb-1"><span className="text-2xl font-extrabold text-white">{d.progression.actual === null ? "—" : `${d.progression.actual}%`}</span><span className="text-[10px] text-slate-400">actual progress</span></div>
                <svg viewBox="0 0 200 60" className="w-full h-16">
                  {(() => {
                    const pts = d.progression.monthly;
                    const vals = pts.map(p => p.value);
                    const path = pts.map((p, i) => { const x = (i / Math.max(1, pts.length - 1)) * 190 + 5; const y = 55 - ((p.value ?? 0) / 100) * 50; return `${i === 0 ? "M" : "L"}${x},${y}`; }).join(" ");
                    return <>
                      <path d={path} fill="none" stroke="#10b981" strokeWidth="1.5" />
                      {pts.map((p, i) => p.value !== null ? <circle key={i} cx={(i / Math.max(1, pts.length - 1)) * 190 + 5} cy={55 - (p.value / 100) * 50} r="1.5" fill="#10b981" /> : null)}
                      {vals.every(v => v === null) && <text x="100" y="32" fontSize="8" fill="#64748b" textAnchor="middle">No monthly data</text>}
                    </>;
                  })()}
                </svg>
                <div className="flex justify-between text-[8px] text-slate-500">{d.progression.monthly.map((m, i) => <span key={i}>{m.label}</span>)}</div>
                <p className="text-[9px] text-slate-500 mt-2">{d.progression.note}</p>
              </Card>

              <Card title="Engagement Intelligence" tag="live">
                <div className="flex items-center gap-4">
                  <Gauge value={d.engagement.score} label="Engagement" />
                  <div className="flex-1 min-w-0 flex flex-col gap-1.5">
                    {d.engagement.signals.map(s => (
                      <div key={s.label}>
                        <div className="flex items-center justify-between text-[10px] mb-0.5"><span className={s.muted ? "text-slate-500" : "text-slate-300"}>{s.label}</span><span className="text-slate-400">{s.value === null ? "—" : `${s.value}%`}</span></div>
                        <div className="h-1.5 rounded-full bg-white/10 overflow-hidden"><div className="h-full rounded-full bg-emerald-500" style={{ width: `${s.value ?? 0}%` }} /></div>
                      </div>
                    ))}
                  </div>
                </div>
                <p className="text-[9px] text-slate-500 mt-2">{d.engagement.note}</p>
              </Card>
            </div>

            {/* Mastery + Barriers */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <Card title="Mastery Intelligence" tag="live">
                <div className="flex flex-col gap-2">
                  {d.mastery.rows.length === 0 ? <p className="text-[11px] text-slate-500">No competency scores to distribute yet.</p> : d.mastery.rows.map(r => {
                    const tot = r.bands.reduce((a, b) => a + b, 0) || 1;
                    return (
                      <div key={r.domain}>
                        <div className="flex items-center justify-between text-[10px] mb-0.5"><span className="text-slate-300 truncate mr-2">{r.domain}</span><span className="text-slate-400">{r.avg === null ? "—" : `${r.avg}%`}</span></div>
                        <div className="flex h-2 rounded-full overflow-hidden bg-white/5">
                          {r.bands.map((b, i) => b > 0 ? <div key={i} style={{ width: `${(b / tot) * 100}%`, background: BAND_COLOR[i] }} /> : null)}
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="flex flex-wrap gap-x-2 gap-y-0.5 mt-2">{d.mastery.bands.map((b, i) => <span key={b} className="flex items-center gap-1 text-[8px] text-slate-500"><span className="w-2 h-2 rounded-sm" style={{ background: BAND_COLOR[i] }} />{b}</span>)}</div>
                <p className="text-[9px] text-slate-500 mt-1">{d.mastery.note}</p>
              </Card>

              <Card title="Learning Barrier Analysis" tag="rule-derived">
                <div className="flex flex-col gap-2">
                  {d.barriers.rows.length === 0 ? <p className="text-[11px] text-emerald-300">No material barriers detected.</p> : d.barriers.rows.map(b => (
                    <div key={b.label}>
                      <div className="flex items-center justify-between text-[10px] mb-0.5"><span className="text-slate-300 truncate mr-2">{b.label}</span><span className="text-slate-400">{b.learners} {b.share !== null ? `(${b.share}%)` : ""}</span></div>
                      <div className="h-1.5 rounded-full bg-white/10 overflow-hidden"><div className="h-full rounded-full bg-amber-500" style={{ width: `${(b.learners / maxBarrier) * 100}%` }} /></div>
                    </div>
                  ))}
                </div>
                <p className="text-[9px] text-slate-500 mt-2">{d.barriers.note}</p>
              </Card>
            </div>

            {/* Predictions */}
            <Card title="Predictive Learning Intelligence" tag="forecast · rule-derived">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                {d.predictions.map((p, i) => (
                  <div key={i} className="rounded-xl bg-white/[0.03] border border-white/10 p-3">
                    <p className="text-[12px] font-bold text-white leading-tight">{p.title}</p>
                    <p className="text-[10px] text-slate-400 mt-1 leading-snug">{p.reason}</p>
                    <div className="flex items-center gap-1.5 mt-2"><div className="h-1 flex-1 rounded-full bg-white/10 overflow-hidden"><div className="h-full rounded-full bg-emerald-500" style={{ width: `${p.confidence}%` }} /></div><span className="text-[9px] text-slate-400">{p.confidence}%</span></div>
                  </div>
                ))}
              </div>
              <p className="text-[9px] text-slate-500 mt-2">Forecasts derived from live risk flags, engagement and evidence status — not a trained model. Labelled as forecasts, not facts.</p>
            </Card>

            <CommandBar aiConfigured={d.panel.aiConfigured} />
          </div>

          {/* ── Right ── */}
          <div className="flex flex-col gap-4 min-w-0">
            <Card title="AI Summary" tag="live">
              {[["High-Risk Learners", d.panel.summary.highRisk], ["Learners Needing Attention", d.panel.summary.needingAttention], ["Progression Delays", d.panel.summary.progressionDelays], ["Active Interventions", d.panel.summary.activeInterventions], ["AI Recommendations", d.panel.summary.recommendations]].map(([label, val]) => (
                <div key={label as string} className="flex items-center justify-between py-1 border-t border-white/5 first:border-t-0 text-[12px]"><span className="text-slate-400">{label}</span><span className="text-white font-bold">{val}</span></div>
              ))}
            </Card>

            <Card title="Top Risk Alerts" tag="rule-derived">
              <div className="flex flex-col gap-1.5">
                {d.panel.alerts.length === 0 ? <p className="text-[11px] text-emerald-300">No active risk alerts.</p> : d.panel.alerts.map((a, i) => (
                  <div key={i} className="flex items-start gap-2"><span className={`text-[8px] font-bold uppercase px-1.5 py-0.5 rounded border shrink-0 ${SEV_CLS[a.severity]}`}>{a.severity}</span><span className="text-[11px] text-slate-300 leading-tight">{a.title}</span></div>
                ))}
              </div>
            </Card>

            <Card title="AI Recommendations" tag="rule-derived">
              <div className="flex flex-col gap-1.5">
                {d.panel.actions.map((a, i) => (
                  <Link key={i} href={a.href} className="flex items-center gap-2 rounded-lg bg-white/[0.02] border border-white/5 px-2.5 py-1.5 hover:bg-white/[0.06] transition-colors">
                    <span className="text-[11px] text-slate-200 flex-1 leading-tight">{a.title}</span>
                    <span className={`text-[8px] font-bold uppercase px-1.5 py-0.5 rounded border ${SEV_CLS[a.priority]}`}>{a.priority}</span>
                  </Link>
                ))}
              </div>
            </Card>

            <Card title="Sources Used" tag="grounding">
              <div className="flex flex-col gap-1">{d.panel.sources.map(s => <p key={s} className="text-[11px] text-slate-300 flex gap-2"><span className="text-slate-500">📄</span>{s}</p>)}</div>
            </Card>

            <Card title="AI Generated Outputs" tag="live reports">
              <div className="flex flex-col gap-1">{d.panel.outputs.map(o => <Link key={o.href} href={o.href} className="flex items-center gap-2 text-[11px] text-slate-300 hover:text-white py-1"><span className="text-slate-500">📄</span>{o.label}<span className="ml-auto text-slate-600 text-[9px]">open →</span></Link>)}</div>
              <p className="text-[9px] text-slate-500 mt-2 pt-2 border-t border-white/5">Each output opens the live analysis it summarises. Interventions stay drafts until you approve them.</p>
            </Card>
          </div>
        </div>

        <p className="text-[10px] text-slate-500 mt-6">
          Learning Intelligence interprets how learners are progressing, predicts likely outcomes and recommends timely actions — all from live competency scores,
          enrolments, quizzes, decisions and the interventions register. Risk scores are explainable and never based on a single signal; every recommendation requires
          human approval and interventions remain drafts until reviewed. Predictions are forecasts, not facts.
        </p>
      </div>
    </div>
  );
}
