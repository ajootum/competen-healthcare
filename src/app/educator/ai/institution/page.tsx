import Link from "next/link";
import { requireEducatorAccess } from "@/lib/educator-access";
import { loadInstitutionIntelligence, type Tint, type MapNode } from "@/lib/institution-intelligence";
import CommandBar from "./CommandBar";

// Institution Intelligence Workspace (spec v1.0 + mockup) — the enterprise AI
// operating-centre inside AI & Intelligence. Dark command-centre theme; three
// columns over a live command bar. Every figure is a live institution-wide
// aggregate of the domain intelligences; enterprise layers and utilisation
// telemetry with no store are shown muted — never fabricated.

export const dynamic = "force-dynamic";

const TINT_DOT: Record<Tint, string> = { green: "bg-emerald-400", amber: "bg-amber-400", red: "bg-rose-400", muted: "bg-slate-600" };
const RISK_CLS: Record<string, string> = { Low: "text-emerald-400", Medium: "text-amber-400", High: "text-rose-400" };
const SEV_CLS: Record<string, string> = { High: "bg-rose-500/20 text-rose-300 border-rose-500/30", Medium: "bg-amber-500/20 text-amber-300 border-amber-500/30", Low: "bg-sky-500/20 text-sky-300 border-sky-500/30" };
const LVL_CLS: Record<string, string> = { High: "text-rose-300", Medium: "text-amber-300", Low: "text-emerald-300" };
const healthColor = (v: number | null): string => (v === null ? "#64748b" : v >= 90 ? "#22c55e" : v >= 70 ? "#84cc16" : v >= 50 ? "#f59e0b" : "#ef4444");

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
    <div className="relative w-28 h-28 shrink-0">
      <svg viewBox="0 0 36 36" className="w-full h-full -rotate-90">
        <circle cx="18" cy="18" r="15.9" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="4" />
        {slices.map((s, i) => { const prev = slices.slice(0, i).reduce((a, b) => a + b.n, 0); const dash = (s.n / totalN) * C; return <circle key={s.label} cx="18" cy="18" r="15.9" fill="none" stroke={s.color} strokeWidth="4" strokeDasharray={`${dash} ${C - dash}`} strokeDashoffset={-(prev / totalN) * C} />; })}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center"><span className="text-lg font-extrabold text-white">{center}</span><span className="text-[8px] text-slate-500">{sub}</span></div>
    </div>
  );
}

function EnterpriseMap({ node }: { node: MapNode }) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-2 rounded-lg bg-white/[0.04] border border-white/10 px-3 py-2">
        <span className="w-2.5 h-2.5 rounded-full" style={{ background: healthColor(node.health) }} />
        <span className="text-[12px] font-bold text-white truncate flex-1">{node.name}</span>
        <span className="text-[13px] font-extrabold" style={{ color: healthColor(node.health) }}>{node.health === null ? "—" : `${node.health}%`}</span>
      </div>
      <div className="flex flex-col gap-1 max-h-[180px] overflow-y-auto">
        {node.children.length === 0 ? <p className="text-[11px] text-slate-500 px-1">No departments recorded.</p> : node.children.map(c => (
          <div key={c.id} className="flex items-center gap-2 pl-4 pr-1 py-1">
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: healthColor(c.health) }} />
            <span className="text-[11px] text-slate-300 truncate flex-1">{c.name}</span>
            <div className="w-16 h-1.5 rounded-full bg-white/10 overflow-hidden"><div className="h-full rounded-full" style={{ width: `${c.health ?? 0}%`, background: healthColor(c.health) }} /></div>
            <span className="text-[10px] text-slate-400 w-8 text-right">{c.health === null ? "—" : `${c.health}%`}</span>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2 text-[8px] text-slate-500">
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-500" />Excellent 90–100</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full" style={{ background: "#84cc16" }} />Good 70–89</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-500" />Needs attention 50–69</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-rose-500" />Critical &lt;50</span>
      </div>
    </div>
  );
}

function Bars({ bars }: { bars: { label: string; pct: number | null; muted?: boolean }[] }) {
  return (
    <div className="flex flex-col gap-2">
      {bars.map(b => (
        <div key={b.label}>
          <div className="flex items-center justify-between text-[10px] mb-0.5"><span className={b.muted ? "text-slate-500" : "text-slate-300"}>{b.label}</span><span className="text-slate-400">{b.pct === null ? "—" : `${b.pct}%`}</span></div>
          <div className="h-1.5 rounded-full bg-white/10 overflow-hidden"><div className="h-full rounded-full" style={{ width: `${b.pct ?? 0}%`, background: b.muted ? "#334155" : healthColor(b.pct) }} /></div>
        </div>
      ))}
    </div>
  );
}

export default async function InstitutionIntelligencePage() {
  const { admin, hospitalId } = await requireEducatorAccess();
  const d = await loadInstitutionIntelligence(admin, hospitalId ?? "");

  return (
    <div className="max-w-[1500px] -mx-4 md:-mx-6 -mt-4 md:-mt-8">
      <div className="bg-[#0a0d24] bg-[radial-gradient(ellipse_at_top,rgba(99,102,241,0.15),transparent_60%)] min-h-screen px-4 md:px-6 py-6 text-slate-200">

        {/* Header */}
        <div className="flex flex-wrap items-start gap-3 mb-4">
          <div className="min-w-0">
            <p className="text-[11px] text-slate-400 flex items-center gap-1.5"><Link href="/educator/ai" className="hover:text-indigo-300">AI &amp; Intelligence</Link><span>›</span><span className="text-slate-300">Institution Intelligence</span></p>
            <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight bg-gradient-to-r from-indigo-300 via-violet-300 to-purple-300 bg-clip-text text-transparent">Institution Intelligence</h1>
            <p className="text-slate-400 text-sm">AI-powered Institutional Health • Operations • Quality • Workforce • Strategy</p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Link href="/educator/analytics/quality" className="text-[12px] font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg px-3 py-2 transition-colors">⬇ Export Report</Link>
            <span title="Sharing needs a share-link store — coming soon" className="text-[12px] text-slate-400 bg-white/[0.04] border border-white/10 rounded-lg px-3 py-2 select-none">↗ Share</span>
          </div>
        </div>

        {/* Context bar */}
        <div className="rounded-2xl bg-white/[0.03] border border-white/10 px-4 py-3 mb-5 flex flex-wrap items-center gap-x-6 gap-y-2 text-[12px]">
          <div><span className="text-slate-500">Institution</span> <span className="text-slate-200 font-medium">{d.scope.institution}</span></div>
          <div><span className="text-slate-500">Programmes</span> <span className="text-slate-200 font-medium">{d.scope.programmes}</span></div>
          <div><span className="text-slate-500">Learners</span> <span className="text-slate-200 font-medium">{d.scope.learners}</span></div>
          <div><span className="text-slate-500">Educators</span> <span className="text-slate-200 font-medium">{d.scope.educators}</span></div>
          <div className="ml-auto flex items-center gap-3">
            <span><span className="text-slate-500">Institution Health</span> <span className="font-bold" style={{ color: healthColor(d.panel.summary.health) }}>{d.panel.summary.health === null ? "—" : `${d.panel.summary.health}%`}</span></span>
            <span><span className="text-slate-500">AI Confidence</span> <span className="font-bold text-slate-200">{d.risk.confidence}</span></span>
          </div>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-[280px_minmax(0,1fr)_320px] gap-4">

          {/* ── Left ── */}
          <div className="flex flex-col gap-4 min-w-0">
            <Card title="Enterprise Map" tag="live">
              <EnterpriseMap node={d.map} />
            </Card>

            <Card title="Workforce Intelligence" tag="live">
              <div className="flex items-center gap-3">
                <Donut slices={d.workforce.slices.length ? d.workforce.slices : [{ label: "None", n: 1, color: "#334155" }]} center={`${d.workforce.total}`} sub="staff" />
                <div className="flex-1 min-w-0 flex flex-col gap-1">
                  {d.workforce.slices.length === 0 ? <p className="text-[11px] text-slate-500">No educators on roster.</p> : d.workforce.slices.map(s => <div key={s.label} className="flex items-center gap-1.5 text-[10px]"><span className="w-2 h-2 rounded-full" style={{ background: s.color }} /><span className="text-slate-300 flex-1 truncate">{s.label}</span><span className="text-slate-400">{s.n}</span></div>)}
                </div>
              </div>
              <div className="flex items-center gap-2 mt-2 pt-2 border-t border-white/5"><span className="text-[10px] text-slate-400">Overall capacity</span><div className="h-1.5 flex-1 rounded-full bg-white/10 overflow-hidden"><div className="h-full rounded-full" style={{ width: `${d.workforce.capacity ?? 0}%`, background: healthColor(d.workforce.capacity) }} /></div><span className="text-[10px] text-slate-300">{d.workforce.capacity ?? "—"}%</span></div>
              <p className="text-[9px] text-slate-500 mt-2">Simulation/workplace faculty are inferred from who conducts those assessment types. Contracted-hours capacity needs a scheduling store.</p>
            </Card>
          </div>

          {/* ── Center ── */}
          <div className="flex flex-col gap-4 min-w-0">
            <Card title="Institutional Health Dashboard" tag="live">
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

            {/* Operational + Quality */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <Card title="Operational Intelligence" tag="live">
                <div className="flex flex-col gap-1.5">
                  {d.operations.length === 0 ? <p className="text-[11px] text-emerald-300">No operational backlogs.</p> : d.operations.map(o => (
                    <div key={o.label} className="flex items-center justify-between rounded-lg bg-white/[0.03] border border-white/10 px-2.5 py-1.5"><span className="text-[11px] text-slate-300">{o.label}</span><span className="flex items-center gap-2"><span className="text-[12px] text-white font-bold">{o.n}</span><span className={`text-[8px] font-bold uppercase ${LVL_CLS[o.level]}`}>{o.level}</span></span></div>
                  ))}
                </div>
              </Card>

              <Card title="Quality Intelligence" tag="live">
                <div className="flex items-center gap-3 mb-2">
                  <div className="text-center"><p className="text-2xl font-extrabold" style={{ color: healthColor(d.quality.score) }}>{d.quality.score ?? "—"}<span className="text-[11px]">%</span></p><p className="text-[9px] text-slate-500">Quality Score</p></div>
                  <div className="flex-1 min-w-0"><Bars bars={d.quality.bars} /></div>
                </div>
              </Card>
            </div>

            {/* Programme intelligence */}
            <Card title="Programme Intelligence" tag="live">
              <div className="overflow-x-auto">
                <table className="w-full text-[11px] border-collapse">
                  <thead><tr className="text-slate-400"><th className="text-left font-medium py-1">Programme</th><th className="font-medium text-center">Health</th><th className="font-medium text-center">Learners</th><th className="font-medium text-center">Progression</th><th className="font-medium text-center">Risk</th></tr></thead>
                  <tbody>
                    {d.programmes.length === 0 ? <tr><td colSpan={5} className="text-center text-slate-500 py-2">No programmes recorded.</td></tr> : d.programmes.slice(0, 8).map(p => (
                      <tr key={p.name} className="border-t border-white/5">
                        <td className="py-1 text-slate-200 truncate max-w-[180px]">{p.name}</td>
                        <td className="text-center py-1 font-bold" style={{ color: healthColor(p.health) }}>{p.health === null ? "—" : `${p.health}%`}</td>
                        <td className="text-center py-1 text-slate-300">{p.learners}</td>
                        <td className="text-center py-1 text-slate-300">{p.progression === null ? "—" : `${p.progression}%`}</td>
                        <td className={`text-center py-1 font-bold ${RISK_CLS[p.risk]}`}>{p.risk}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>

            {/* Capacity + Resources */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <Card title="Capacity Intelligence" tag="live · directional">
                <Bars bars={d.capacity.bars} />
                <p className="text-[9px] text-slate-500 mt-2">{d.capacity.note}</p>
              </Card>
              <Card title="Resource Intelligence" tag="counts live">
                <Bars bars={d.resources.bars} />
                <p className="text-[9px] text-slate-500 mt-2">{d.resources.note}</p>
              </Card>
            </div>

            {/* Risk centre */}
            <Card title="Institutional Risk Centre" tag="rule-derived">
              <div className="overflow-x-auto">
                <table className="w-full text-[11px] border-collapse">
                  <thead><tr className="text-slate-400"><th className="text-left font-medium py-1">Risk</th><th className="font-medium text-center">Category</th><th className="font-medium text-center">Severity</th><th className="font-medium text-left pl-2">Owner</th></tr></thead>
                  <tbody>
                    {d.risks.length === 0 ? <tr><td colSpan={4} className="text-center text-emerald-300 py-2">No institutional risks detected.</td></tr> : d.risks.map((r, i) => (
                      <tr key={i} className="border-t border-white/5">
                        <td className="py-1 text-slate-200">{r.title}</td>
                        <td className="text-center py-1 text-slate-400">{r.category}</td>
                        <td className="text-center py-1"><span className={`text-[8px] font-bold uppercase px-1.5 py-0.5 rounded border ${SEV_CLS[r.severity]}`}>{r.severity}</span></td>
                        <td className="py-1 pl-2 text-slate-400">{r.owner}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>

            {/* Predictions */}
            <Card title="Predictive Intelligence" tag="forecast · rule-derived">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {d.predictions.map((p, i) => (
                  <div key={i} className="flex items-start gap-2 rounded-lg bg-white/[0.03] border border-white/10 px-2.5 py-2">
                    <span className={`text-[8px] font-bold uppercase px-1.5 py-0.5 rounded border shrink-0 ${p.level === "High Risk" ? "bg-rose-500/20 text-rose-300 border-rose-500/30" : "bg-amber-500/20 text-amber-300 border-amber-500/30"}`}>{p.level}</span>
                    <span className="min-w-0"><span className="block text-[12px] text-white leading-tight">{p.title}</span><span className="block text-[9px] text-slate-500">{p.reason} · {p.confidence}%</span></span>
                  </div>
                ))}
              </div>
              <p className="text-[9px] text-slate-500 mt-2">Advisory forecasts from live operational signals — evidence-based, not a trained model. AI never makes structural changes.</p>
            </Card>

            <CommandBar aiConfigured={d.panel.aiConfigured} />
          </div>

          {/* ── Right ── */}
          <div className="flex flex-col gap-4 min-w-0">
            <Card title="AI Summary" tag="live">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[12px] text-slate-400">Institution Health</span>
                <span className="text-sm font-bold" style={{ color: healthColor(d.panel.summary.health) }}>{d.panel.summary.health === null ? "—" : `${d.panel.summary.health}%`}</span>
              </div>
              {[["Strategic Risks", d.panel.summary.strategicRisks], ["Operational Risks", d.panel.summary.operationalRisks], ["Improvement Actions", d.panel.summary.improvementActions], ["Accreditation Readiness", d.panel.summary.accreditation === null ? "—" : `${d.panel.summary.accreditation}%`]].map(([label, val]) => (
                <div key={label as string} className="flex items-center justify-between py-1 border-t border-white/5 text-[12px]"><span className="text-slate-400">{label}</span><span className="text-white font-bold">{val}</span></div>
              ))}
            </Card>

            <Card title="Top Strategic Risks" tag="rule-derived">
              <div className="flex flex-col gap-1.5">
                {d.risks.length === 0 ? <p className="text-[11px] text-emerald-300">No strategic risks.</p> : d.risks.map((r, i) => (
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
              <ul className="space-y-1.5">{d.panel.reasoning.map((r, i) => <li key={i} className="text-[11px] text-slate-300 flex gap-2"><span className="text-indigo-400 shrink-0">•</span>{r}</li>)}</ul>
            </Card>

            <Card title="AI Generated Outputs" tag="live reports">
              <div className="flex flex-col gap-1">{d.panel.outputs.map(o => <Link key={o.label} href={o.href} className="flex items-center gap-2 text-[11px] text-slate-300 hover:text-white py-1"><span className="text-slate-500">📄</span>{o.label}<span className="ml-auto text-slate-600 text-[9px]">open →</span></Link>)}</div>
            </Card>
          </div>
        </div>

        <p className="text-[10px] text-slate-500 mt-6">
          Institution Intelligence synthesises curriculum, assessment, learning, competency, educator and quality signals into one institutional picture. Every KPI is a
          live aggregate of real records; enterprise hierarchy beyond department, physical capacity and resource-utilisation telemetry are shown only where a store exists.
          Recommendations are explainable and advisory — AI supports leadership decisions, it never makes structural changes on its own.
        </p>
      </div>
    </div>
  );
}
