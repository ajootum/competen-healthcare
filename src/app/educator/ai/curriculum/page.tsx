import Link from "next/link";
import { requireEducatorAccess } from "@/lib/educator-access";
import { loadCurriculumIntelligence, type NavNode, type Tint } from "@/lib/curriculum-intelligence";
import CommandBar from "./CommandBar";

// Curriculum Intelligence Workspace (spec v1.0 + mockup) — the AI-powered
// curriculum governance centre inside AI & Intelligence. Dark command-centre
// theme; three columns (Navigator · Intelligence · AI Panel) over a live command
// bar. Every figure is computed from the institution's real curriculum graph;
// unbacked dimensions are shown muted or labelled as proxies/rule-derived.

export const dynamic = "force-dynamic";

const TINT_DOT: Record<Tint, string> = { green: "bg-emerald-400", amber: "bg-amber-400", red: "bg-rose-400", muted: "bg-slate-600" };
const RISK_CLS: Record<string, string> = { Low: "text-emerald-400", Medium: "text-amber-400", High: "text-rose-400" };
const SEV_CLS: Record<string, string> = { Critical: "bg-rose-500/20 text-rose-300 border-rose-500/30", High: "bg-amber-500/20 text-amber-300 border-amber-500/30", Medium: "bg-yellow-500/15 text-yellow-200 border-yellow-500/25", Low: "bg-emerald-500/15 text-emerald-200 border-emerald-500/25" };
const PRIO_CLS: Record<string, string> = { High: "bg-red-500/20 text-red-300 border-red-500/30", Medium: "bg-amber-500/20 text-amber-300 border-amber-500/30", Low: "bg-sky-500/20 text-sky-300 border-sky-500/30" };
const MAP_ICON: Record<string, string> = { domains: "🗂️", courses: "📘", cpus: "💠", competencies: "🎯", assessments: "📋", evidence: "📎", resources: "📚", outcomes: "🏅" };

// Native collapsible navigator tree (no client JS). Open the top two levels.
function NavTree({ node, depth }: { node: NavNode; depth: number }) {
  const dot = <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${TINT_DOT[node.tint]}`} />;
  if (!node.children.length) {
    return (
      <div className="flex items-center gap-2 py-1 pr-2" style={{ paddingLeft: `${depth * 12 + 8}px` }}>
        {dot}
        <span className="text-[12px] text-slate-300 truncate">{node.name}</span>
        <span className="text-[9px] text-slate-500 ml-auto whitespace-nowrap">{node.meta}</span>
      </div>
    );
  }
  return (
    <details open={depth < 2} className="group">
      <summary className="flex items-center gap-2 py-1 pr-2 cursor-pointer list-none hover:bg-white/[0.03] rounded" style={{ paddingLeft: `${depth * 12 + 8}px` }}>
        <span className="text-[9px] text-slate-500 transition-transform group-open:rotate-90">▶</span>
        {dot}
        <span className="text-[12px] font-medium text-slate-200 truncate">{node.name}</span>
        <span className="text-[9px] text-slate-500 ml-auto whitespace-nowrap">{node.meta}</span>
      </summary>
      <div>{node.children.map(c => <NavTree key={c.id} node={c} depth={depth + 1} />)}</div>
    </details>
  );
}

// Inline radar chart for alignment axes (values 0–100).
function Radar({ axes }: { axes: { label: string; value: number }[] }) {
  const cx = 130, cy = 120, r = 82, n = axes.length;
  const pt = (i: number, rad: number) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
    return [cx + rad * Math.cos(a), cy + rad * Math.sin(a)];
  };
  const poly = axes.map((ax, i) => pt(i, (Math.max(0, Math.min(100, ax.value)) / 100) * r).join(",")).join(" ");
  return (
    <svg viewBox="0 0 260 240" className="w-full max-w-[320px] mx-auto">
      {[0.25, 0.5, 0.75, 1].map(f => (
        <polygon key={f} points={axes.map((_, i) => pt(i, r * f).join(",")).join(" ")} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="0.6" />
      ))}
      {axes.map((_, i) => { const [x, y] = pt(i, r); return <line key={i} x1={cx} y1={cy} x2={x} y2={y} stroke="rgba(255,255,255,0.08)" strokeWidth="0.6" />; })}
      <polygon points={poly} fill="rgba(139,92,246,0.25)" stroke="#a855f7" strokeWidth="1.5" />
      {axes.map((ax, i) => {
        const [x, y] = pt(i, r + 16);
        return <text key={i} x={x} y={y} fontSize="7.5" fill="#94a3b8" textAnchor="middle" dominantBaseline="middle">{ax.label.length > 18 ? ax.label.slice(0, 17) + "…" : ax.label}</text>;
      })}
    </svg>
  );
}

// Radial gauge for a single 0–100 metric.
function Gauge({ value, label }: { value: number | null; label: string }) {
  const col = value === null ? "#64748b" : value >= 75 ? "#22c55e" : value >= 50 ? "#f59e0b" : "#ef4444";
  return (
    <div className="flex flex-col items-center">
      <div className="relative w-24 h-24">
        <svg viewBox="0 0 36 36" className="w-full h-full -rotate-90">
          <circle cx="18" cy="18" r="15.9" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="3" />
          {value !== null && <circle cx="18" cy="18" r="15.9" fill="none" stroke={col} strokeWidth="3" strokeDasharray={`${value} 100`} strokeLinecap="round" />}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-lg font-extrabold text-white">{value ?? "—"}{value !== null && <span className="text-[10px]">%</span>}</span>
        </div>
      </div>
      <p className="text-[10px] text-slate-400 mt-1">{label}</p>
    </div>
  );
}

function Card({ title, tag, children, className = "" }: { title: string; tag?: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-2xl bg-white/[0.03] border border-white/10 p-4 ${className}`}>
      <div className="flex items-center gap-2 mb-3">
        <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400">{title}</p>
        {tag && <span className="ml-auto text-[8px] font-bold uppercase tracking-wide text-slate-500">{tag}</span>}
      </div>
      {children}
    </div>
  );
}

export default async function CurriculumIntelligencePage() {
  const { admin, hospitalId } = await requireEducatorAccess();
  const d = await loadCurriculumIntelligence(admin, hospitalId ?? "");
  const maxMap = Math.max(1, ...d.map.map(m => m.count ?? 0));

  return (
    <div className="max-w-[1500px] -mx-4 md:-mx-6 -mt-4 md:-mt-8">
      <div className="bg-[#0a0d24] bg-[radial-gradient(ellipse_at_top,rgba(139,92,246,0.15),transparent_60%)] min-h-screen px-4 md:px-6 py-6 text-slate-200">

        {/* Header */}
        <div className="flex flex-wrap items-start gap-3 mb-4">
          <div className="min-w-0">
            <p className="text-[11px] text-slate-400 flex items-center gap-1.5"><Link href="/educator/ai" className="hover:text-violet-300">AI &amp; Intelligence</Link><span>›</span><span className="text-slate-300">Curriculum Intelligence</span></p>
            <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight bg-gradient-to-r from-violet-300 via-purple-300 to-fuchsia-300 bg-clip-text text-transparent">Curriculum Intelligence</h1>
            <p className="text-slate-400 text-sm">AI-powered Curriculum Analysis • Alignment • Prediction • Continuous Improvement</p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Link href="/educator/analytics/curriculum" className="text-[12px] font-semibold text-white bg-violet-600 hover:bg-violet-700 rounded-lg px-3 py-2 transition-colors">⬇ Export Report</Link>
            <span title="Sharing needs a share-link store — coming soon" className="text-[12px] text-slate-400 bg-white/[0.04] border border-white/10 rounded-lg px-3 py-2 select-none">↗ Share</span>
          </div>
        </div>

        {/* Context bar */}
        <div className="rounded-2xl bg-white/[0.03] border border-white/10 px-4 py-3 mb-5 flex flex-wrap items-center gap-x-6 gap-y-2 text-[12px]">
          <div><span className="text-slate-500">Scope</span> <span className="text-slate-200 font-medium">{d.scope.institution}</span></div>
          <div><span className="text-slate-500">Curricula</span> <span className="text-slate-200 font-medium">{d.scope.programmes}</span></div>
          <div><span className="text-slate-500">Competencies</span> <span className="text-slate-200 font-medium">{d.scope.competencies}</span></div>
          <div><span className="text-slate-500">CPUs</span> <span className="text-slate-200 font-medium">{d.scope.cpus}</span></div>
          <div className="flex items-center gap-1.5">
            <span className="text-slate-500">Standards</span>
            {d.scope.standards.length ? d.scope.standards.slice(0, 4).map(s => <span key={s} className="text-[10px] text-slate-300 bg-white/[0.05] rounded px-1.5 py-0.5">{s}</span>) : <span className="text-slate-500">—</span>}
          </div>
          <div className="ml-auto flex items-center gap-3">
            <span><span className="text-slate-500">Risk</span> <span className={`font-bold ${RISK_CLS[d.risk.level]}`}>{d.risk.level}</span></span>
            <span><span className="text-slate-500">AI Confidence</span> <span className="font-bold text-slate-200">{d.risk.confidence}</span></span>
          </div>
        </div>

        {/* Three-column workspace */}
        <div className="grid grid-cols-1 xl:grid-cols-[260px_minmax(0,1fr)_320px] gap-4">

          {/* ── Left: Navigator ── */}
          <div className="flex flex-col gap-4 min-w-0">
            <Card title="Curriculum Navigator" tag="live">
              <div className="max-h-[360px] overflow-y-auto -mx-1">
                <NavTree node={d.navigator} depth={0} />
              </div>
              <p className="text-[9px] text-slate-500 mt-2 pt-2 border-t border-white/5">Institution → Curriculum → Domain → CPU. Academic year/semester/module layers aren&apos;t modelled yet.</p>
            </Card>

            <Card title="Version History" tag="lifecycle">
              <div className="flex flex-col gap-1.5">
                {d.versions.lifecycle.map(l => (
                  <div key={l.label} className="flex items-center justify-between text-[11px]"><span className="text-slate-400">{l.label}</span><span className="text-slate-200 font-medium">{l.n}</span></div>
                ))}
              </div>
              <p className="text-[9px] text-slate-500 mt-2 pt-2 border-t border-white/5">{d.versions.note}</p>
            </Card>

            <Card title="Standards &amp; Frameworks" tag="live">
              <div className="flex flex-col gap-2">
                {d.panel.standards.map(s => (
                  <div key={s.name}>
                    <div className="flex items-center justify-between text-[11px] mb-0.5"><span className="text-slate-300 truncate mr-2">{s.name}</span><span className="text-slate-400">{s.coverage === null ? "—" : `${s.coverage}%`}</span></div>
                    <div className="h-1.5 rounded-full bg-white/10 overflow-hidden"><div className="h-full rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500" style={{ width: `${s.coverage ?? 0}%` }} /></div>
                  </div>
                ))}
              </div>
            </Card>
          </div>

          {/* ── Center: Intelligence ── */}
          <div className="flex flex-col gap-4 min-w-0">
            {/* Health dashboard */}
            <Card title="Curriculum Health Dashboard" tag="live">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                {d.health.map(k => (
                  <div key={k.label} className="rounded-xl bg-white/[0.03] border border-white/10 p-3">
                    <p className={`text-2xl font-extrabold ${k.value === null ? "text-slate-500" : "text-white"}`}>{k.value === null ? "—" : `${k.value}%`}</p>
                    <p className="text-[10px] text-slate-400 leading-tight mt-0.5">{k.label}</p>
                    <span className={`inline-block mt-1.5 w-6 h-1 rounded-full ${TINT_DOT[k.tint]}`} />
                  </div>
                ))}
                <div className="rounded-xl bg-white/[0.03] border border-white/10 p-3">
                  <p className={`text-2xl font-extrabold ${RISK_CLS[d.risk.level]}`}>{d.risk.level}</p>
                  <p className="text-[10px] text-slate-400 leading-tight mt-0.5">Curriculum Risk</p>
                </div>
                <div className="rounded-xl bg-white/[0.03] border border-white/10 p-3">
                  <p className="text-2xl font-extrabold text-white">{d.risk.confidence}</p>
                  <p className="text-[10px] text-slate-400 leading-tight mt-0.5">AI Confidence</p>
                </div>
              </div>
            </Card>

            {/* Curriculum map */}
            <Card title="Curriculum Map" tag="digital twin · live counts">
              <div className="flex items-stretch gap-1 overflow-x-auto pb-1">
                {d.map.map((m, i) => (
                  <div key={m.id} className="flex items-center shrink-0">
                    <div className="flex flex-col items-center w-[86px] text-center">
                      <span className="w-11 h-11 rounded-full bg-white/[0.04] border border-white/15 flex items-center justify-center text-base">{MAP_ICON[m.id] ?? "•"}</span>
                      <span className="text-sm font-bold text-white mt-1">{m.count ?? "—"}</span>
                      <span className="text-[9px] text-slate-400 leading-tight">{m.label}{m.proxy && <span className="text-slate-600"> *</span>}</span>
                      <span className="mt-1 h-1 rounded-full bg-violet-500/60" style={{ width: `${Math.max(6, ((m.count ?? 0) / maxMap) * 46)}px` }} />
                    </div>
                    {i < d.map.length - 1 && <span className="text-slate-600 text-xs px-0.5">→</span>}
                  </div>
                ))}
              </div>
              <p className="text-[9px] text-slate-500 mt-2">* Outcomes proxied by achieved competencies (no dedicated learning-outcomes store).</p>
            </Card>

            {/* Gap + Alignment */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <Card title="Gap Analysis" tag="rule-derived · live">
                <div className="flex items-center gap-2 mb-2.5 text-[10px]">
                  {d.gaps.severity.map(s => <span key={s.label} className="flex items-center gap-1"><span className="w-2 h-2 rounded-full" style={{ background: s.color }} />{s.label} {s.n}</span>)}
                </div>
                <div className="flex flex-col gap-1.5 max-h-[220px] overflow-y-auto">
                  {d.gaps.register.length === 0 ? <p className="text-[11px] text-slate-500">No gaps detected in the current curriculum.</p> : d.gaps.register.map(g => (
                    <div key={g.id} className="flex items-center gap-2 rounded-lg bg-white/[0.03] border border-white/10 px-2.5 py-1.5">
                      <span className="min-w-0 flex-1"><span className="block text-[12px] text-white truncate">{g.name}</span><span className="block text-[9px] text-slate-500">{g.category} · {g.rootCause}</span></span>
                      <span className={`text-[8px] font-bold uppercase px-1.5 py-0.5 rounded border ${SEV_CLS[g.severity]}`}>{g.severity}</span>
                    </div>
                  ))}
                </div>
                <Link href="/educator/analytics/curriculum/gaps" className="inline-block text-[11px] text-violet-300 hover:text-violet-200 mt-2">View all {d.gaps.total} gaps →</Link>
              </Card>

              <Card title="Alignment Analysis" tag="chain integrity">
                <Radar axes={d.alignment} />
                <p className="text-[9px] text-slate-500 mt-1">Each axis is the share of links intact along the curriculum chain. Programme/course-outcome layers are proxied by domain coverage.</p>
              </Card>
            </div>

            {/* Coverage matrix */}
            <Card title="Competency Coverage Matrix" tag="live">
              <div className="overflow-x-auto">
                <table className="w-full text-[11px] border-collapse">
                  <thead>
                    <tr className="text-slate-400">
                      <th className="text-left font-medium py-1 pr-2">Competency</th>
                      {d.coverage.columns.map(c => <th key={c} className="font-medium px-1 py-1 text-center whitespace-nowrap">{c}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {d.coverage.rows.map(r => (
                      <tr key={r.name} className="border-t border-white/5">
                        <td className="py-1 pr-2 text-slate-200 truncate max-w-[180px]">{r.name}</td>
                        {r.cells.map((c, i) => (
                          <td key={i} className="text-center py-1">
                            {c === null ? <span className="text-slate-600">–</span> : c ? <span className="text-emerald-400">✔</span> : <span className="text-rose-400">✕</span>}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-[9px] text-slate-500 mt-2">{d.coverage.note}</p>
            </Card>

            {/* Assessment + Timeline */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <Card title="Assessment Intelligence" tag="live">
                <div className="flex items-center gap-4">
                  <Gauge value={d.assessment.overall} label="Assessment Coverage" />
                  <div className="flex-1 min-w-0 flex flex-col gap-1.5">
                    {d.assessment.slices.length === 0 ? <p className="text-[11px] text-slate-500">No assessment data yet.</p> : d.assessment.slices.map(s => (
                      <div key={s.label}>
                        <div className="flex items-center justify-between text-[10px] mb-0.5"><span className="text-slate-300 truncate mr-2">{s.label}</span><span className="text-slate-400">{s.value}%</span></div>
                        <div className="h-1.5 rounded-full bg-white/10 overflow-hidden"><div className="h-full rounded-full" style={{ width: `${s.value}%`, background: s.color }} /></div>
                      </div>
                    ))}
                  </div>
                </div>
                <p className="text-[9px] text-slate-500 mt-2">{d.assessment.note}</p>
              </Card>

              <Card title="Curriculum Timeline" tag="lifecycle">
                <div className="flex items-center justify-between gap-1 mt-1">
                  {d.timeline.map((t, i) => (
                    <div key={t.label} className="flex items-center flex-1">
                      <div className="flex flex-col items-center flex-1">
                        <span className={`w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-bold border-2 ${t.state === "current" ? "border-violet-400 text-violet-200 bg-violet-500/20" : t.state === "done" ? "border-emerald-400/60 text-emerald-300 bg-emerald-500/10" : "border-white/15 text-slate-400"}`}>{t.n}</span>
                        <span className="text-[9px] text-slate-400 mt-1 text-center">{t.label}</span>
                      </div>
                      {i < d.timeline.length - 1 && <span className="h-px flex-1 bg-white/10 -mt-4" />}
                    </div>
                  ))}
                </div>
                <p className="text-[9px] text-slate-500 mt-3">Counts by publication state across curricula and CPUs. Approval dates &amp; review cycles need a versioning store.</p>
              </Card>
            </div>

            {/* Impact + Improvements */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <Card title="Impact Analysis" tag="digital twin">
                {d.impact ? (<>
                  <p className="text-[11px] text-slate-400 mb-2">If you change <span className="text-white font-semibold">{d.impact.subject}</span>, the AI traces live dependents:</p>
                  <div className="grid grid-cols-3 gap-2">
                    {d.impact.items.map(it => (
                      <div key={it.label} className="rounded-xl bg-white/[0.03] border border-white/10 p-2.5 text-center">
                        <p className="text-xl font-extrabold text-white">{it.count}</p>
                        <p className="text-[9px] text-slate-400 leading-tight">{it.label}</p>
                      </div>
                    ))}
                  </div>
                  <p className="text-[9px] text-slate-500 mt-2">{d.impact.note}</p>
                </>) : <p className="text-[11px] text-slate-500">No competencies to analyse yet.</p>}
              </Card>

              <Card title="Improvement Opportunities" tag="rule-derived">
                <div className="flex flex-col gap-1.5">
                  {d.improvements.map((im, i) => (
                    <Link key={i} href={im.href} className="flex items-start gap-2 rounded-lg bg-white/[0.03] border border-white/10 px-2.5 py-2 hover:bg-white/[0.07] transition-colors">
                      <span className="text-emerald-400 text-xs mt-0.5">✦</span>
                      <span className="min-w-0"><span className="block text-[12px] text-white leading-tight">{im.title}</span><span className="block text-[10px] text-slate-400">{im.detail}</span></span>
                    </Link>
                  ))}
                </div>
              </Card>
            </div>

            {/* Predictions */}
            <Card title="Curriculum Predictions" tag="rule-derived · not ML">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                {d.predictions.map((p, i) => (
                  <div key={i} className="rounded-xl bg-white/[0.03] border border-white/10 p-3">
                    <p className="text-[12px] font-bold text-white leading-tight">{p.title}</p>
                    <p className="text-[10px] text-slate-400 mt-1 leading-snug">{p.reason}</p>
                    <div className="flex items-center gap-1.5 mt-2"><div className="h-1 flex-1 rounded-full bg-white/10 overflow-hidden"><div className="h-full rounded-full bg-violet-500" style={{ width: `${p.confidence}%` }} /></div><span className="text-[9px] text-slate-400">{p.confidence}%</span></div>
                  </div>
                ))}
              </div>
              <p className="text-[9px] text-slate-500 mt-2">Signals derived from live structural gaps — not a trained predictive model. Confidence reflects gap density, not statistical likelihood.</p>
            </Card>

            {/* Command bar */}
            <CommandBar aiConfigured={d.panel.aiConfigured} />
          </div>

          {/* ── Right: Intelligence panel ── */}
          <div className="flex flex-col gap-4 min-w-0">
            <Card title="AI Summary" tag="live">
              <div className="flex items-center justify-between mb-3">
                <span className="text-[12px] text-slate-400">Curriculum Health</span>
                <span className={`text-sm font-bold ${d.health[0].tint === "green" ? "text-emerald-400" : d.health[0].tint === "amber" ? "text-amber-400" : d.health[0].tint === "red" ? "text-rose-400" : "text-slate-400"}`}>{d.panel.summary.healthLabel}</span>
              </div>
              {[["Current Risks", d.panel.summary.currentRisks], ["Immediate Attention", d.panel.summary.immediateAttention], ["Recommended Improvements", d.panel.summary.recommendedImprovements], ["Pending Reviews", d.panel.summary.pendingReviews]].map(([label, val]) => (
                <div key={label as string} className="flex items-center justify-between py-1 border-t border-white/5 text-[12px]"><span className="text-slate-400">{label}</span><span className="text-white font-bold">{val}</span></div>
              ))}
            </Card>

            <Card title="AI Reasoning" tag="rule-derived">
              <ul className="space-y-1.5">{d.panel.reasoning.map((r, i) => <li key={i} className="text-[11px] text-slate-300 flex gap-2"><span className="text-violet-400 shrink-0">•</span>{r}</li>)}</ul>
            </Card>

            <Card title="Standards Status" tag="live">
              <div className="flex flex-col gap-2">
                {d.panel.standards.map(s => (
                  <div key={s.name}>
                    <div className="flex items-center justify-between text-[11px] mb-0.5"><span className="text-slate-300 truncate mr-2">{s.name}</span><span className="text-slate-400">{s.coverage === null ? "—" : `${s.coverage}%`}</span></div>
                    <div className="h-1.5 rounded-full bg-white/10 overflow-hidden"><div className={`h-full rounded-full ${(s.coverage ?? 0) >= 75 ? "bg-emerald-500" : (s.coverage ?? 0) >= 50 ? "bg-amber-500" : "bg-rose-500"}`} style={{ width: `${s.coverage ?? 0}%` }} /></div>
                  </div>
                ))}
              </div>
            </Card>

            <Card title="Suggested Actions" tag="rule-derived">
              <div className="flex flex-col gap-1.5">
                {d.panel.actions.map((a, i) => (
                  <Link key={i} href={a.href} className="flex items-center gap-2 rounded-lg bg-white/[0.02] border border-white/5 px-2.5 py-1.5 hover:bg-white/[0.06] transition-colors">
                    <span className="text-[11px] text-slate-200 flex-1 leading-tight">{a.title}</span>
                    <span className={`text-[8px] font-bold uppercase px-1.5 py-0.5 rounded border ${PRIO_CLS[a.priority]}`}>{a.priority}</span>
                  </Link>
                ))}
              </div>
            </Card>

            <Card title="AI Generated Outputs" tag="live reports">
              <div className="flex flex-col gap-1">
                {d.panel.outputs.map(o => (
                  <Link key={o.href} href={o.href} className="flex items-center gap-2 text-[11px] text-slate-300 hover:text-white py-1"><span className="text-slate-500">📄</span>{o.label}<span className="ml-auto text-slate-600 text-[9px]">open →</span></Link>
                ))}
              </div>
              <p className="text-[9px] text-slate-500 mt-2 pt-2 border-t border-white/5">Each output opens the live analysis it summarises. One-click PDF/Word export runs from those pages.</p>
            </Card>
          </div>
        </div>

        <p className="text-[10px] text-slate-500 mt-6">
          Curriculum Intelligence synthesises live signals across your frameworks, CPUs, competencies, assessments, evidence and standards. Every KPI, gap, alignment
          axis and prediction is computed from real institutional records; recommendations are explainable and require human approval. AI never edits the curriculum on its own.
        </p>
      </div>
    </div>
  );
}
