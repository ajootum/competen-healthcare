import Link from "next/link";
import { requireEducatorAccess } from "@/lib/educator-access";
import { loadAssessmentIntelligence, type NavNode, type Tint } from "@/lib/assessment-intelligence";
import CommandBar from "./CommandBar";

// Assessment Intelligence Workspace (spec v1.0 + mockup) — the AI-powered
// assessment quality & governance centre inside AI & Intelligence. Dark command-
// centre theme; three columns (Navigator · Intelligence · AI Panel) over a live
// command bar. Every figure is computed from the institution's real assessment
// data; psychometrics with no store (reliability, OSCE station quality, fairness,
// assessor consistency) are shown muted and labelled — never fabricated.

export const dynamic = "force-dynamic";

const TINT_DOT: Record<Tint, string> = { green: "bg-emerald-400", amber: "bg-amber-400", red: "bg-rose-400", muted: "bg-slate-600" };
const RISK_CLS: Record<string, string> = { Low: "text-emerald-400", Medium: "text-amber-400", High: "text-rose-400" };
const SEV_CLS: Record<string, string> = { High: "bg-rose-500/20 text-rose-300 border-rose-500/30", Medium: "bg-amber-500/20 text-amber-300 border-amber-500/30", Low: "bg-sky-500/20 text-sky-300 border-sky-500/30" };
const PRIO_CLS = SEV_CLS;
const EV_CLS: Record<string, string> = { Strong: "text-emerald-400", Partial: "text-amber-400", Weak: "text-rose-400", None: "text-slate-500" };

function NavTree({ node, depth }: { node: NavNode; depth: number }) {
  const dot = <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${TINT_DOT[node.tint]}`} />;
  if (!node.children.length) {
    return (
      <div className="flex items-center gap-2 py-1 pr-2" style={{ paddingLeft: `${depth * 12 + 8}px` }}>
        {dot}<span className="text-[12px] text-slate-300 truncate">{node.name}</span>
        <span className="text-[9px] text-slate-500 ml-auto whitespace-nowrap">{node.meta}</span>
      </div>
    );
  }
  return (
    <details open={depth < 2} className="group">
      <summary className="flex items-center gap-2 py-1 pr-2 cursor-pointer list-none hover:bg-white/[0.03] rounded" style={{ paddingLeft: `${depth * 12 + 8}px` }}>
        <span className="text-[9px] text-slate-500 transition-transform group-open:rotate-90">▶</span>
        {dot}<span className="text-[12px] font-medium text-slate-200 truncate">{node.name}</span>
        <span className="text-[9px] text-slate-500 ml-auto whitespace-nowrap">{node.meta}</span>
      </summary>
      <div>{node.children.map(c => <NavTree key={c.id} node={c} depth={depth + 1} />)}</div>
    </details>
  );
}

function Radar({ axes }: { axes: { label: string; value: number }[] }) {
  const cx = 130, cy = 120, r = 82, n = Math.max(axes.length, 3);
  const pt = (i: number, rad: number) => { const a = -Math.PI / 2 + (i * 2 * Math.PI) / n; return [cx + rad * Math.cos(a), cy + rad * Math.sin(a)]; };
  if (axes.length < 3) return <p className="text-[11px] text-slate-500 py-8 text-center">Not enough assessed domains to plot alignment yet.</p>;
  const poly = axes.map((ax, i) => pt(i, (Math.max(0, Math.min(100, ax.value)) / 100) * r).join(",")).join(" ");
  return (
    <svg viewBox="0 0 260 240" className="w-full max-w-[320px] mx-auto">
      {[0.25, 0.5, 0.75, 1].map(f => <polygon key={f} points={axes.map((_, i) => pt(i, r * f).join(",")).join(" ")} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="0.6" />)}
      {axes.map((_, i) => { const [x, y] = pt(i, r); return <line key={i} x1={cx} y1={cy} x2={x} y2={y} stroke="rgba(255,255,255,0.08)" strokeWidth="0.6" />; })}
      <polygon points={poly} fill="rgba(59,130,246,0.25)" stroke="#3b82f6" strokeWidth="1.5" />
      {axes.map((ax, i) => { const [x, y] = pt(i, r + 16); return <text key={i} x={x} y={y} fontSize="7.5" fill="#94a3b8" textAnchor="middle" dominantBaseline="middle">{ax.label.length > 18 ? ax.label.slice(0, 17) + "…" : ax.label}</text>; })}
    </svg>
  );
}

function Donut({ slices, center, sub }: { slices: { label: string; n: number; color: string }[]; center: string; sub: string }) {
  const total = slices.reduce((s, x) => s + x.n, 0) || 1;
  const C = 2 * Math.PI * 15.9;
  return (
    <div className="relative w-28 h-28 shrink-0">
      <svg viewBox="0 0 36 36" className="w-full h-full -rotate-90">
        <circle cx="18" cy="18" r="15.9" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="4" />
        {slices.map((s, i) => {
          const prev = slices.slice(0, i).reduce((a, b) => a + b.n, 0);
          const dash = (s.n / total) * C;
          return <circle key={s.label} cx="18" cy="18" r="15.9" fill="none" stroke={s.color} strokeWidth="4" strokeDasharray={`${dash} ${C - dash}`} strokeDashoffset={-(prev / total) * C} />;
        })}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center"><span className="text-lg font-extrabold text-white">{center}</span><span className="text-[8px] text-slate-500">{sub}</span></div>
    </div>
  );
}

function Card({ title, tag, children, muted = false }: { title: string; tag?: string; children: React.ReactNode; muted?: boolean }) {
  return (
    <div className={`rounded-2xl border p-4 ${muted ? "bg-white/[0.015] border-white/5" : "bg-white/[0.03] border-white/10"}`}>
      <div className="flex items-center gap-2 mb-3">
        <p className={`text-[11px] font-bold uppercase tracking-widest ${muted ? "text-slate-500" : "text-slate-400"}`}>{title}</p>
        {tag && <span className="ml-auto text-[8px] font-bold uppercase tracking-wide text-slate-500">{tag}</span>}
      </div>
      {children}
    </div>
  );
}

export default async function AssessmentIntelligencePage() {
  const { admin, hospitalId } = await requireEducatorAccess();
  const d = await loadAssessmentIntelligence(admin, hospitalId ?? "");

  return (
    <div className="max-w-[1500px] -mx-4 md:-mx-6 -mt-4 md:-mt-8">
      <div className="bg-[#0a0d24] bg-[radial-gradient(ellipse_at_top,rgba(59,130,246,0.15),transparent_60%)] min-h-screen px-4 md:px-6 py-6 text-slate-200">

        {/* Header */}
        <div className="flex flex-wrap items-start gap-3 mb-4">
          <div className="min-w-0">
            <p className="text-[11px] text-slate-400 flex items-center gap-1.5"><Link href="/educator/ai" className="hover:text-sky-300">AI &amp; Intelligence</Link><span>›</span><span className="text-slate-300">Assessment Intelligence</span></p>
            <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight bg-gradient-to-r from-sky-300 via-blue-300 to-cyan-300 bg-clip-text text-transparent">Assessment Intelligence</h1>
            <p className="text-slate-400 text-sm">AI-powered Assessment Quality • Alignment • Fairness • Prediction</p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Link href="/educator/analytics/assessment" className="text-[12px] font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg px-3 py-2 transition-colors">⬇ Export Report</Link>
            <span title="Sharing needs a share-link store — coming soon" className="text-[12px] text-slate-400 bg-white/[0.04] border border-white/10 rounded-lg px-3 py-2 select-none">↗ Share</span>
          </div>
        </div>

        {/* Context bar */}
        <div className="rounded-2xl bg-white/[0.03] border border-white/10 px-4 py-3 mb-5 flex flex-wrap items-center gap-x-6 gap-y-2 text-[12px]">
          <div><span className="text-slate-500">Scope</span> <span className="text-slate-200 font-medium">{d.scope.institution}</span></div>
          <div><span className="text-slate-500">Programmes</span> <span className="text-slate-200 font-medium">{d.scope.programmes}</span></div>
          <div><span className="text-slate-500">Recorded assessments</span> <span className="text-slate-200 font-medium">{d.scope.assessments}</span></div>
          <div><span className="text-slate-500">Item bank</span> <span className="text-slate-200 font-medium">{d.scope.items}</span></div>
          <div className="flex items-center gap-1.5">
            <span className="text-slate-500">Standards</span>
            {d.scope.standards.length ? d.scope.standards.slice(0, 4).map(s => <span key={s} className="text-[10px] text-slate-300 bg-white/[0.05] rounded px-1.5 py-0.5">{s}</span>) : <span className="text-slate-500">—</span>}
          </div>
          <div className="ml-auto flex items-center gap-3">
            <span><span className="text-slate-500">Risk</span> <span className={`font-bold ${RISK_CLS[d.risk.level]}`}>{d.risk.level}</span></span>
            <span><span className="text-slate-500">AI Confidence</span> <span className="font-bold text-slate-200">{d.risk.confidence}</span></span>
          </div>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-[260px_minmax(0,1fr)_320px] gap-4">

          {/* ── Left: Navigator ── */}
          <div className="flex flex-col gap-4 min-w-0">
            <Card title="Assessment Navigator" tag="live">
              <div className="max-h-[320px] overflow-y-auto -mx-1"><NavTree node={d.navigator} depth={0} /></div>
              <p className="text-[9px] text-slate-500 mt-2 pt-2 border-t border-white/5">Institution → Programme → CPU → assessed competencies. Course/module/station layers aren&apos;t modelled yet.</p>
            </Card>

            <Card title="Assessment Types" tag="live">
              <div className="flex flex-col gap-1.5">
                {d.types.map(t => <div key={t.label} className="flex items-center justify-between text-[11px]"><span className="text-slate-400">{t.label}</span><span className="text-slate-200 font-medium">{t.n}</span></div>)}
              </div>
            </Card>

            <Card title="Status" tag="live">
              <div className="flex flex-col gap-1.5">
                {d.status.map(s => <div key={s.label} className="flex items-center justify-between text-[11px]"><span className="text-slate-400">{s.label}</span><span className="text-slate-200 font-medium">{s.n}</span></div>)}
              </div>
              <p className="text-[9px] text-slate-500 mt-2 pt-2 border-t border-white/5">{d.versions.note}</p>
            </Card>
          </div>

          {/* ── Center: Intelligence ── */}
          <div className="flex flex-col gap-4 min-w-0">
            {/* Health dashboard */}
            <Card title="Assessment Health Dashboard" tag="live">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                {d.health.map(k => (
                  <div key={k.label} className={`rounded-xl border p-3 ${k.tint === "muted" ? "bg-white/[0.015] border-white/5" : "bg-white/[0.03] border-white/10"}`} title={k.note}>
                    <p className={`text-2xl font-extrabold ${k.value === null ? "text-slate-500" : "text-white"}`}>{k.value === null ? "—" : `${k.value}%`}</p>
                    <p className="text-[10px] text-slate-400 leading-tight mt-0.5">{k.label}</p>
                    {k.tint === "muted" ? <span className="text-[8px] text-slate-600 leading-tight">no store</span> : <span className={`inline-block mt-1.5 w-6 h-1 rounded-full ${TINT_DOT[k.tint]}`} />}
                  </div>
                ))}
              </div>
              <p className="text-[9px] text-slate-500 mt-2">Reliability, fairness &amp; assessor consistency require data we don&apos;t capture yet — shown muted rather than estimated.</p>
            </Card>

            {/* Blueprint + Coverage */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <Card title="Blueprint Alignment Overview" tag="actual coverage">
                <Radar axes={d.blueprint.radar} />
                <p className="text-[10px] text-slate-300 mt-1">{d.blueprint.finding}</p>
                <p className="text-[9px] text-slate-500 mt-1">{d.blueprint.note}</p>
              </Card>

              <Card title="Competency Coverage Matrix" tag="live">
                <div className="overflow-x-auto">
                  <table className="w-full text-[11px] border-collapse">
                    <thead><tr className="text-slate-400"><th className="text-left font-medium py-1 pr-2">Competency</th>{d.coverage.columns.map(c => <th key={c} className="font-medium px-1 py-1 text-center">{c}</th>)}<th className="font-medium px-1 py-1 text-center">Evidence</th></tr></thead>
                    <tbody>
                      {d.coverage.rows.map(r => (
                        <tr key={r.name} className="border-t border-white/5">
                          <td className="py-1 pr-2 text-slate-200 truncate max-w-[150px]">{r.name}</td>
                          {r.cells.map((c, i) => <td key={i} className="text-center py-1">{c === null ? <span className="text-slate-600">–</span> : c ? <span className="text-emerald-400">✔</span> : <span className="text-rose-400">✕</span>}</td>)}
                          <td className={`text-center py-1 font-medium ${EV_CLS[r.evidence]}`}>{r.evidence}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="text-[9px] text-slate-500 mt-2">{d.coverage.note}</p>
              </Card>
            </div>

            {/* Item analysis + OSCE + Reliability */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <Card title="Item Analysis" tag="live">
                <div className="flex items-center gap-3">
                  <Donut slices={d.items.slices} center={`${d.items.total}`} sub="items" />
                  <div className="flex-1 min-w-0 flex flex-col gap-1">
                    {d.items.slices.map(s => <div key={s.label} className="flex items-center gap-1.5 text-[10px]"><span className="w-2 h-2 rounded-full" style={{ background: s.color }} /><span className="text-slate-300 flex-1">{s.label}</span><span className="text-slate-400">{s.n}</span></div>)}
                    <div className="text-[9px] text-slate-500 mt-1">Avg facility {d.items.avgFacility === null ? "—" : `${d.items.avgFacility}%`}</div>
                  </div>
                </div>
                <p className="text-[9px] text-slate-500 mt-2">{d.items.note}</p>
              </Card>

              <Card title="OSCE Station Quality" tag="no store" muted>
                <div className="flex flex-col items-center justify-center py-4 text-center">
                  <span className="text-2xl mb-1 opacity-40">🩺</span>
                  <p className="text-[11px] text-slate-400">Unavailable</p>
                </div>
                <p className="text-[9px] text-slate-500">{d.osce.note}</p>
              </Card>

              <Card title="Reliability &amp; Consistency" tag="no store" muted>
                <div className="flex flex-col gap-2">
                  {d.reliability.metrics.map(m => (
                    <div key={m.label} className="flex items-center justify-between text-[11px]"><span className="text-slate-400 truncate mr-2">{m.label}</span><span className="text-slate-500 font-bold">{m.value === null ? "—" : `${m.value}${m.unit ?? ""}`}</span></div>
                  ))}
                </div>
                <p className="text-[9px] text-slate-500 mt-2">{d.reliability.note}</p>
              </Card>
            </div>

            {/* Fairness + Evidence + Predictions */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <Card title="Fairness &amp; Bias Review" tag="no store" muted>
                <div className="flex flex-col items-center justify-center py-4 text-center">
                  <span className="text-2xl mb-1 opacity-40">⚖️</span>
                  <p className="text-[11px] text-slate-400">Unavailable</p>
                </div>
                <p className="text-[9px] text-slate-500">{d.fairness.note}</p>
              </Card>

              <Card title="Evidence Sufficiency" tag="live">
                <div className="flex items-center gap-3 mb-2">
                  <span className="text-2xl font-extrabold text-white">{d.evidence.defensible === null ? "—" : `${d.evidence.defensible}%`}</span>
                  <span className="text-[10px] text-slate-400 leading-tight">defensible decisions<br />{d.evidence.sufficientCount} of {d.evidence.totalWithEvidence} with evidence</span>
                </div>
                <p className="text-[9px] font-bold uppercase tracking-wide text-slate-500 mb-1">Top missing evidence</p>
                <div className="flex flex-col gap-1">
                  {d.evidence.missing.length === 0 ? <p className="text-[11px] text-emerald-300">All assessed competencies have evidence.</p> : d.evidence.missing.map(m => (
                    <div key={m.label} className="flex items-center justify-between text-[10px]"><span className="text-slate-300 truncate mr-2">{m.label}</span><span className="text-rose-300 font-medium">{m.n}</span></div>
                  ))}
                </div>
                <p className="text-[9px] text-slate-500 mt-2">{d.evidence.note}</p>
              </Card>

              <Card title="Predictive Insights" tag="rule-derived · not ML">
                <div className="flex flex-col gap-2">
                  {d.predictions.map((p, i) => (
                    <div key={i} className="rounded-xl bg-white/[0.03] border border-white/10 p-2.5">
                      <p className="text-[12px] font-bold text-white leading-tight">{p.title}</p>
                      <p className="text-[10px] text-slate-400 mt-0.5 leading-snug">{p.reason}</p>
                      <div className="flex items-center gap-1.5 mt-1.5"><div className="h-1 flex-1 rounded-full bg-white/10 overflow-hidden"><div className="h-full rounded-full bg-blue-500" style={{ width: `${p.confidence}%` }} /></div><span className="text-[9px] text-slate-400">{p.confidence}%</span></div>
                    </div>
                  ))}
                </div>
              </Card>
            </div>

            {/* Risk center */}
            <Card title="Assessment Risk Center" tag="rule-derived">
              <div className="flex flex-col gap-1.5">
                {d.risks.map((r, i) => (
                  <div key={i} className="flex items-center gap-2 rounded-lg bg-white/[0.03] border border-white/10 px-2.5 py-1.5">
                    <span className="min-w-0 flex-1"><span className="block text-[12px] text-white leading-tight">{r.title}</span><span className="block text-[9px] text-slate-500">{r.detail}</span></span>
                    <span className={`text-[8px] font-bold uppercase px-1.5 py-0.5 rounded border ${SEV_CLS[r.severity]}`}>{r.severity}</span>
                  </div>
                ))}
              </div>
            </Card>

            {/* Command bar */}
            <CommandBar aiConfigured={d.panel.aiConfigured} />
          </div>

          {/* ── Right: AI panel ── */}
          <div className="flex flex-col gap-4 min-w-0">
            <Card title="AI Summary" tag="live">
              <div className="flex items-center justify-between mb-3">
                <span className="text-[12px] text-slate-400">Assessment Health</span>
                <span className={`text-sm font-bold ${d.health[0].tint === "green" ? "text-emerald-400" : d.health[0].tint === "amber" ? "text-amber-400" : d.health[0].tint === "red" ? "text-rose-400" : "text-slate-400"}`}>{d.panel.summary.healthLabel}</span>
              </div>
              {[["Critical Risks", d.panel.summary.criticalRisks], ["High-Priority Reviews", d.panel.summary.highPriorityReviews], ["Blueprint Gaps", d.panel.summary.blueprintGaps], ["AI Recommendations", d.panel.summary.recommendations]].map(([label, val]) => (
                <div key={label as string} className="flex items-center justify-between py-1 border-t border-white/5 text-[12px]"><span className="text-slate-400">{label}</span><span className="text-white font-bold">{val}</span></div>
              ))}
            </Card>

            <Card title="Top Risks Detected" tag="rule-derived">
              <div className="flex flex-col gap-1.5">
                {d.risks.slice(0, 5).map((r, i) => (
                  <div key={i} className="flex items-start gap-2"><span className={`text-[8px] font-bold uppercase px-1.5 py-0.5 rounded border shrink-0 ${SEV_CLS[r.severity]}`}>{r.severity}</span><span className="text-[11px] text-slate-300 leading-tight">{r.title}</span></div>
                ))}
              </div>
            </Card>

            <Card title="AI Recommended Actions" tag="rule-derived">
              <div className="flex flex-col gap-1.5">
                {d.panel.actions.map((a, i) => (
                  <Link key={i} href={a.href} className="flex items-center gap-2 rounded-lg bg-white/[0.02] border border-white/5 px-2.5 py-1.5 hover:bg-white/[0.06] transition-colors">
                    <span className="text-[11px] text-slate-200 flex-1 leading-tight">{a.title}</span>
                    <span className={`text-[8px] font-bold uppercase px-1.5 py-0.5 rounded border ${PRIO_CLS[a.priority]}`}>{a.priority}</span>
                  </Link>
                ))}
              </div>
            </Card>

            <Card title="AI Reasoning" tag="rule-derived">
              <ul className="space-y-1.5">{d.panel.reasoning.map((r, i) => <li key={i} className="text-[11px] text-slate-300 flex gap-2"><span className="text-blue-400 shrink-0">•</span>{r}</li>)}</ul>
            </Card>

            <Card title="Sources Used" tag="grounding">
              <div className="flex flex-col gap-1">{d.panel.sources.map(s => <p key={s} className="text-[11px] text-slate-300 flex gap-2"><span className="text-slate-500">📄</span>{s}</p>)}</div>
            </Card>

            <Card title="AI Generated Outputs" tag="live reports">
              <div className="flex flex-col gap-1">
                {d.panel.outputs.map(o => <Link key={o.href} href={o.href} className="flex items-center gap-2 text-[11px] text-slate-300 hover:text-white py-1"><span className="text-slate-500">📄</span>{o.label}<span className="ml-auto text-slate-600 text-[9px]">open →</span></Link>)}
              </div>
              <p className="text-[9px] text-slate-500 mt-2 pt-2 border-t border-white/5">Each output opens the live analysis it summarises. PDF/Word export runs from those pages.</p>
            </Card>
          </div>
        </div>

        <p className="text-[10px] text-slate-500 mt-6">
          Assessment Intelligence evaluates quality, alignment, coverage, evidence sufficiency and risk from your live item bank, recorded assessments, scores and
          decisions. Reliability, OSCE-station and fairness analytics are shown only where the underlying data exists — never estimated. Recommendations are explainable,
          require human approval, and every AI-generated change stays a draft until reviewed.
        </p>
      </div>
    </div>
  );
}
