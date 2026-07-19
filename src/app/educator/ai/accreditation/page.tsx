import Link from "next/link";
import { requireEducatorAccess } from "@/lib/educator-access";
import { loadAccreditationIntelligence, type Tint } from "@/lib/accreditation-intelligence";
import CommandBar from "./CommandBar";

// Accreditation Intelligence Workspace (spec v1.0 + mockup) — the continuous
// accreditation & evidence-readiness centre inside AI & Intelligence. Dark
// command-centre theme; three columns over a live command bar. Every figure is
// computed from real audits, CAPA, decisions, policies and evidence; survey/mock
// scheduling and standards catalogues with no store are shown muted. The AI
// never declares compliance — decisions stay human.

export const dynamic = "force-dynamic";

const TINT_DOT: Record<Tint, string> = { green: "bg-emerald-400", amber: "bg-amber-400", red: "bg-rose-400", muted: "bg-slate-600" };
const RISK_CLS: Record<string, string> = { Low: "text-emerald-400", Medium: "text-amber-400", High: "text-rose-400" };
const SEV_CLS: Record<string, string> = { High: "bg-rose-500/20 text-rose-300 border-rose-500/30", Medium: "bg-amber-500/20 text-amber-300 border-amber-500/30", Low: "bg-sky-500/20 text-sky-300 border-sky-500/30" };
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
      <div className="absolute inset-0 flex flex-col items-center justify-center"><span className="text-base font-extrabold text-white">{center}</span><span className="text-[8px] text-slate-500">{sub}</span></div>
    </div>
  );
}

function Forecast({ points, target }: { points: { label: string; value: number | null }[]; target: number }) {
  const w = 220, h = 70, pad = 6;
  const xs = (i: number) => pad + (i / Math.max(1, points.length - 1)) * (w - 2 * pad);
  const ys = (v: number) => h - pad - (v / 100) * (h - 2 * pad);
  const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${xs(i)},${ys(p.value ?? 0)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h + 10}`} className="w-full">
      <line x1={pad} y1={ys(target)} x2={w - pad} y2={ys(target)} stroke="#64748b" strokeWidth="0.5" strokeDasharray="2 2" />
      <text x={w - pad} y={ys(target) - 2} fontSize="6" fill="#94a3b8" textAnchor="end">Target {target}%</text>
      <path d={path} fill="none" stroke="#10b981" strokeWidth="1.5" />
      {points.map((p, i) => <g key={i}><circle cx={xs(i)} cy={ys(p.value ?? 0)} r="1.6" fill="#10b981" /><text x={xs(i)} y={ys(p.value ?? 0) - 3} fontSize="5.5" fill="#cbd5e1" textAnchor="middle">{p.value}%</text><text x={xs(i)} y={h + 6} fontSize="5.5" fill="#64748b" textAnchor="middle">{p.label}</text></g>)}
    </svg>
  );
}

export default async function AccreditationIntelligencePage() {
  const { admin, hospitalId } = await requireEducatorAccess();
  const d = await loadAccreditationIntelligence(admin, hospitalId ?? "");

  return (
    <div className="max-w-[1500px] -mx-4 md:-mx-6 -mt-4 md:-mt-8">
      <div className="bg-[#0a0d24] bg-[radial-gradient(ellipse_at_top,rgba(236,72,153,0.13),transparent_60%)] min-h-screen px-4 md:px-6 py-6 text-slate-200">

        {/* Header */}
        <div className="flex flex-wrap items-start gap-3 mb-4">
          <div className="min-w-0">
            <p className="text-[11px] text-slate-400 flex items-center gap-1.5"><Link href="/educator/ai" className="hover:text-pink-300">AI &amp; Intelligence</Link><span>›</span><span className="text-slate-300">Accreditation Intelligence</span></p>
            <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight bg-gradient-to-r from-pink-300 via-rose-300 to-fuchsia-300 bg-clip-text text-transparent">Accreditation Intelligence</h1>
            <p className="text-slate-400 text-sm">AI-powered Standards • Evidence • Compliance • Readiness • Prediction</p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Link href="/educator/analytics/accreditation" className="text-[12px] font-semibold text-white bg-pink-600 hover:bg-pink-700 rounded-lg px-3 py-2 transition-colors">⬇ Export Report</Link>
            <span title="Sharing needs a share-link store — coming soon" className="text-[12px] text-slate-400 bg-white/[0.04] border border-white/10 rounded-lg px-3 py-2 select-none">↗ Share</span>
          </div>
        </div>

        {/* Context bar */}
        <div className="rounded-2xl bg-white/[0.03] border border-white/10 px-4 py-3 mb-5 flex flex-wrap items-center gap-x-6 gap-y-2 text-[12px]">
          <div><span className="text-slate-500">Institution</span> <span className="text-slate-200 font-medium">{d.scope.institution}</span></div>
          <div><span className="text-slate-500">Frameworks</span> <span className="text-slate-200 font-medium">{d.scope.frameworks}</span></div>
          <div><span className="text-slate-500">Measurable elements</span> <span className="text-slate-200 font-medium">{d.scope.standards}</span></div>
          <div><span className="text-slate-500">Cycle</span> <span className="text-slate-200 font-medium">{d.scope.cycle}</span></div>
          <div className="ml-auto flex items-center gap-3">
            <span><span className="text-slate-500">Readiness</span> <span className="font-bold" style={{ color: healthColor(d.panel.summary.readiness) }}>{d.panel.summary.readiness === null ? "—" : `${d.panel.summary.readiness}%`}</span></span>
            <span><span className="text-slate-500">AI Confidence</span> <span className="font-bold text-slate-200">{d.confidence}</span></span>
          </div>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-[280px_minmax(0,1fr)_320px] gap-4">

          {/* ── Left ── */}
          <div className="flex flex-col gap-4 min-w-0">
            <Card title="Standards Map" tag="live counts">
              <p className="text-[10px] text-slate-500 mb-2">{d.standardsMap.source} → Institution → Evidence</p>
              <div className="flex flex-col gap-1.5">
                {d.standardsMap.rows.map(r => <div key={r.label} className="flex items-center justify-between rounded-lg bg-white/[0.03] border border-white/10 px-2.5 py-1.5"><span className="text-[11px] text-slate-300">{r.label}</span><span className="text-[12px] text-white font-bold">{r.n.toLocaleString()}</span></div>)}
              </div>
              <p className="text-[9px] text-slate-500 mt-2 pt-2 border-t border-white/5">Cross-framework equivalence mapping needs a standards-catalogue store — counts are live from your structure.</p>
            </Card>

            <Card title="Survey Preparation" tag="readiness live">
              <div className="flex items-center gap-3">
                <div className="text-center"><p className="text-2xl font-extrabold" style={{ color: healthColor(d.survey.readiness) }}>{d.survey.readiness ?? "—"}<span className="text-[11px]">%</span></p><p className="text-[9px] text-slate-500">Preparedness</p></div>
                <div className="flex-1 text-[10px] text-slate-400">
                  <div className="flex justify-between"><span>Critical actions</span><span className="text-slate-200">{d.actions.overdue + d.actions.atRisk}</span></div>
                  <div className="flex justify-between"><span>Evidence validated</span><span className="text-slate-200">{d.health[3].value === null ? "—" : `${d.health[3].value}%`}</span></div>
                </div>
              </div>
              <p className="text-[9px] text-slate-500 mt-2">{d.survey.note}</p>
            </Card>
          </div>

          {/* ── Center ── */}
          <div className="flex flex-col gap-4 min-w-0">
            <Card title="Accreditation Health Dashboard" tag="live">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                {d.health.map(k => (
                  <div key={k.label} className="rounded-xl bg-white/[0.03] border border-white/10 p-3">
                    <p className={`text-2xl font-extrabold ${k.value === null ? "text-slate-500" : "text-white"}`}>{k.value === null ? "—" : `${k.value}%`}</p>
                    <p className="text-[10px] text-slate-400 leading-tight mt-0.5">{k.label}</p>
                    <span className={`inline-block mt-1.5 w-6 h-1 rounded-full ${TINT_DOT[k.tint]}`} />
                  </div>
                ))}
                <div className="rounded-xl bg-rose-500/10 border border-rose-500/25 p-3"><p className="text-2xl font-extrabold text-rose-300">{d.criticalGaps}</p><p className="text-[10px] text-slate-400 leading-tight mt-0.5">Critical Gaps</p></div>
              </div>
            </Card>

            {/* Evidence + gaps */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <Card title="Evidence Readiness" tag="live">
                <div className="flex items-center gap-3">
                  <Donut slices={d.evidence.slices} center={`${d.evidence.slices.reduce((s, x) => s + x.n, 0)}`} sub="items" />
                  <div className="flex-1 min-w-0 flex flex-col gap-1">
                    {d.evidence.slices.map(s => <div key={s.label} className="flex items-center gap-1.5 text-[10px]"><span className="w-2 h-2 rounded-full" style={{ background: s.color }} /><span className="text-slate-300 flex-1 truncate">{s.label}</span><span className="text-slate-400">{s.n} ({s.pct}%)</span></div>)}
                  </div>
                </div>
                <p className="text-[9px] text-slate-500 mt-2">Evidence is competency-based: validated decisions vs unvalidated vs missing. File-level lifecycle needs an evidence-repository store.</p>
              </Card>

              <Card title="Compliance Gap Analysis" tag="from audits">
                <div className="flex flex-col gap-2 mt-1">
                  {d.gaps.bars.map(b => (
                    <div key={b.label}>
                      <div className="flex items-center justify-between text-[10px] mb-0.5"><span className="text-slate-300">{b.label}</span><span className="text-slate-400">{b.n} ({b.pct ?? 0}%)</span></div>
                      <div className="h-2 rounded-full bg-white/10 overflow-hidden"><div className="h-full rounded-full" style={{ width: `${b.pct ?? 0}%`, background: b.color }} /></div>
                    </div>
                  ))}
                </div>
                <p className="text-[9px] text-slate-500 mt-2">{d.gaps.note}</p>
              </Card>
            </div>

            {/* Programme + action + policy */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <Card title="Programme Compliance" tag="live">
                <div className="overflow-x-auto">
                  <table className="w-full text-[10px] border-collapse">
                    <thead><tr className="text-slate-400"><th className="text-left font-medium py-1">Programme</th><th className="font-medium text-center">Ready</th><th className="font-medium text-center">Risk</th></tr></thead>
                    <tbody>
                      {d.programmes.length === 0 ? <tr><td colSpan={3} className="text-center text-slate-500 py-2">No programme data.</td></tr> : d.programmes.slice(0, 6).map(p => (
                        <tr key={p.name} className="border-t border-white/5"><td className="py-1 text-slate-200 truncate max-w-[110px]">{p.name}</td><td className="text-center py-1 font-bold" style={{ color: healthColor(p.readiness) }}>{p.readiness === null ? "—" : `${p.readiness}%`}</td><td className={`text-center py-1 font-bold ${RISK_CLS[p.risk]}`}>{p.risk}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>

              <Card title="Action Tracking" tag="CAPA live">
                <div className="flex items-center gap-3">
                  <Donut slices={[{ label: "On Track", n: d.actions.onTrack, color: "#22c55e" }, { label: "At Risk", n: d.actions.atRisk, color: "#f59e0b" }, { label: "Overdue", n: d.actions.overdue, color: "#ef4444" }]} center={d.actions.total ? `${Math.round((d.actions.onTrack / Math.max(1, d.actions.onTrack + d.actions.atRisk + d.actions.overdue)) * 100)}%` : "—"} sub="on track" />
                  <div className="flex-1 min-w-0 flex flex-col gap-1 text-[10px]">
                    <div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-emerald-400" /><span className="text-slate-300 flex-1">On Track</span><span className="text-slate-400">{d.actions.onTrack}</span></div>
                    <div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-amber-400" /><span className="text-slate-300 flex-1">At Risk</span><span className="text-slate-400">{d.actions.atRisk}</span></div>
                    <div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-rose-400" /><span className="text-slate-300 flex-1">Overdue</span><span className="text-slate-400">{d.actions.overdue}</span></div>
                  </div>
                </div>
              </Card>

              <Card title="Quality &amp; Policy" tag="live">
                <div className="flex items-center gap-3">
                  <Donut slices={[{ label: "Current", n: d.policy.current, color: "#22c55e" }, { label: "Due", n: d.policy.due, color: "#f59e0b" }, { label: "Overdue", n: d.policy.overdue, color: "#ef4444" }]} center={`${d.policy.currency ?? "—"}%`} sub="current" />
                  <div className="flex-1 min-w-0 flex flex-col gap-1 text-[10px]">
                    <div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-emerald-400" /><span className="text-slate-300 flex-1">Current</span><span className="text-slate-400">{d.policy.current}</span></div>
                    <div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-amber-400" /><span className="text-slate-300 flex-1">Due for review</span><span className="text-slate-400">{d.policy.due}</span></div>
                    <div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-rose-400" /><span className="text-slate-300 flex-1">Overdue</span><span className="text-slate-400">{d.policy.overdue}</span></div>
                  </div>
                </div>
              </Card>
            </div>

            {/* Risk centre + forecast */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <Card title="Accreditation Risk Centre" tag="rule-derived">
                <div className="flex flex-col gap-1.5">
                  {d.risks.length === 0 ? <p className="text-[11px] text-emerald-300">No accreditation risks detected.</p> : d.risks.map((r, i) => (
                    <div key={i} className="flex items-center gap-2 rounded-lg bg-white/[0.03] border border-white/10 px-2.5 py-1.5">
                      <span className="min-w-0 flex-1"><span className="block text-[11px] text-white leading-tight">{r.title}</span><span className="block text-[9px] text-slate-500">Owner: {r.owner}</span></span>
                      <span className={`text-[8px] font-bold uppercase px-1.5 py-0.5 rounded border ${SEV_CLS[r.severity]}`}>{r.severity}</span>
                    </div>
                  ))}
                </div>
              </Card>

              <Card title="Predictive Readiness" tag="forecast · rule-derived">
                <Forecast points={d.forecast.points} target={d.forecast.target} />
                <p className="text-[9px] text-slate-500 mt-1">{d.forecast.note}</p>
              </Card>
            </div>

            <CommandBar aiConfigured={d.panel.aiConfigured} />
          </div>

          {/* ── Right ── */}
          <div className="flex flex-col gap-4 min-w-0">
            <Card title="AI Summary" tag="live">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[12px] text-slate-400">Accreditation Readiness</span>
                <span className="text-sm font-bold" style={{ color: healthColor(d.panel.summary.readiness) }}>{d.panel.summary.readiness === null ? "—" : `${d.panel.summary.readiness}%`}</span>
              </div>
              {[["Critical Gaps", d.panel.summary.criticalGaps], ["Evidence Gaps", d.panel.summary.evidenceGaps], ["Policies Due for Review", d.panel.summary.policiesDue], ["Actions Overdue", d.panel.summary.actionsOverdue], ["Standards at Risk", d.panel.summary.standardsAtRisk], ["AI Recommendations", d.panel.summary.recommendations]].map(([label, val]) => (
                <div key={label as string} className="flex items-center justify-between py-1 border-t border-white/5 text-[12px]"><span className="text-slate-400">{label}</span><span className="text-white font-bold">{val}</span></div>
              ))}
            </Card>

            <Card title="Top Accreditation Risks" tag="rule-derived">
              <div className="flex flex-col gap-1.5">
                {d.risks.length === 0 ? <p className="text-[11px] text-emerald-300">No active risks.</p> : d.risks.map((r, i) => (
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
              <ul className="space-y-1.5">{d.panel.reasoning.map((r, i) => <li key={i} className="text-[11px] text-slate-300 flex gap-2"><span className="text-pink-400 shrink-0">•</span>{r}</li>)}</ul>
            </Card>

            <Card title="AI Generated Outputs" tag="live reports">
              <div className="flex flex-col gap-1">{d.panel.outputs.map(o => <Link key={o.label} href={o.href} className="flex items-center gap-2 text-[11px] text-slate-300 hover:text-white py-1"><span className="text-slate-500">📄</span>{o.label}<span className="ml-auto text-slate-600 text-[9px]">open →</span></Link>)}</div>
            </Card>
          </div>
        </div>

        <p className="text-[10px] text-slate-500 mt-6">
          Accreditation Intelligence turns accreditation into a continuous readiness process — measuring standards compliance, evidence sufficiency &amp; validation,
          policy currency and corrective-action completion from live audits, decisions, policies and CAPA records. Survey scheduling, mock surveys, tracers and formal
          standards catalogues are shown only where a store exists. The AI maps gaps and recommends actions but never declares compliance — that decision stays human.
        </p>
      </div>
    </div>
  );
}
