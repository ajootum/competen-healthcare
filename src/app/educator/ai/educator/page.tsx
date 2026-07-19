import Link from "next/link";
import { requireEducatorAccess } from "@/lib/educator-access";
import { loadEducatorIntelligence, type NavNode, type Tint, type EducatorDot } from "@/lib/educator-intelligence";
import CommandBar from "./CommandBar";

// Educator Intelligence Workspace (spec v1.0 + mockup) — the AI-powered educator
// capacity / workload / development centre inside AI & Intelligence. Dark
// command-centre theme; three columns over a live command bar. Governed and
// non-punitive: backed figures come only from real assessment activity; teaching
// effectiveness, feedback timing, development and succession are shown muted with
// a note on what each needs — never fabricated into a hidden educator score.

export const dynamic = "force-dynamic";

const TINT_DOT: Record<Tint, string> = { green: "bg-emerald-400", amber: "bg-amber-400", red: "bg-rose-400", muted: "bg-slate-600" };
const RISK_CLS: Record<string, string> = { Low: "text-emerald-400", Medium: "text-amber-400", High: "text-rose-400" };
const SEV_CLS: Record<string, string> = { High: "bg-rose-500/20 text-rose-300 border-rose-500/30", Medium: "bg-amber-500/20 text-amber-300 border-amber-500/30", Low: "bg-sky-500/20 text-sky-300 border-sky-500/30" };
const BAND_COLOR: Record<string, string> = { Balanced: "#22c55e", High: "#f59e0b", Overloaded: "#f97316", Critical: "#ef4444", Underutilised: "#3b82f6" };

function NavTree({ node, depth }: { node: NavNode; depth: number }) {
  const dot = <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${TINT_DOT[node.tint]}`} />;
  if (!node.children.length) return <div className="flex items-center gap-2 py-1 pr-2" style={{ paddingLeft: `${depth * 12 + 8}px` }}>{dot}<span className="text-[12px] text-slate-300 truncate">{node.name}</span><span className="text-[9px] text-slate-500 ml-auto whitespace-nowrap">{node.meta}</span></div>;
  return (
    <details open={depth < 1} className="group">
      <summary className="flex items-center gap-2 py-1 pr-2 cursor-pointer list-none hover:bg-white/[0.03] rounded" style={{ paddingLeft: `${depth * 12 + 8}px` }}>
        <span className="text-[9px] text-slate-500 transition-transform group-open:rotate-90">▶</span>{dot}<span className="text-[12px] font-medium text-slate-200 truncate">{node.name}</span><span className="text-[9px] text-slate-500 ml-auto whitespace-nowrap">{node.meta}</span>
      </summary>
      <div>{node.children.map(c => <NavTree key={c.id} node={c} depth={depth + 1} />)}</div>
    </details>
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

function WorkloadMap({ dots }: { dots: EducatorDot[] }) {
  return (
    <div className="relative w-full" style={{ aspectRatio: "16 / 9" }}>
      <div className="absolute inset-0 rounded-xl bg-white/[0.02] border border-white/10" />
      <div className="absolute left-2 top-1 text-[8px] text-slate-500">Recent · light load</div>
      <div className="absolute right-2 top-1 text-[8px] text-slate-500 text-right">Recent · heavy load — protect</div>
      <div className="absolute left-2 bottom-1 text-[8px] text-slate-500">Inactive · light load</div>
      <div className="absolute right-2 bottom-1 text-[8px] text-slate-500 text-right">Inactive · heavy backlog</div>
      <svg viewBox="0 0 100 56" preserveAspectRatio="none" className="absolute inset-0 w-full h-full">
        <line x1="50" y1="0" x2="50" y2="56" stroke="rgba(255,255,255,0.08)" strokeWidth="0.3" />
        <line x1="0" y1="28" x2="100" y2="28" stroke="rgba(255,255,255,0.08)" strokeWidth="0.3" />
        {dots.map(d => (
          <circle key={d.id} cx={d.x} cy={(100 - d.y) * 0.56} r="1.3" fill={BAND_COLOR[d.band]} fillOpacity="0.85">
            <title>{`${d.label} — ${d.role}\nBand: ${d.band}\nAssessments: ${d.load}`}</title>
          </circle>
        ))}
      </svg>
      <span className="absolute bottom-[-2px] left-1/2 -translate-x-1/2 text-[8px] font-bold uppercase tracking-widest text-slate-500">Assessment load →</span>
    </div>
  );
}

function Card({ title, tag, children, muted = false }: { title: string; tag?: string; children: React.ReactNode; muted?: boolean }) {
  return (
    <div className={`rounded-2xl border p-4 ${muted ? "bg-white/[0.015] border-white/5" : "bg-white/[0.03] border-white/10"}`}>
      <div className="flex items-center gap-2 mb-3"><p className={`text-[11px] font-bold uppercase tracking-widest ${muted ? "text-slate-500" : "text-slate-400"}`}>{title}</p>{tag && <span className="ml-auto text-[8px] font-bold uppercase tracking-wide text-slate-500">{tag}</span>}</div>
      {children}
    </div>
  );
}

function MutedCard({ title, icon, notes }: { title: string; icon: string; notes: string[] }) {
  return (
    <Card title={title} tag="no store" muted>
      <div className="flex flex-col items-center justify-center py-3 text-center"><span className="text-2xl mb-1 opacity-40">{icon}</span><p className="text-[11px] text-slate-400">Unavailable</p></div>
      {notes.map((n, i) => <p key={i} className="text-[9px] text-slate-500 leading-snug mt-1">{n}</p>)}
    </Card>
  );
}

export default async function EducatorIntelligencePage() {
  const { admin, hospitalId } = await requireEducatorAccess();
  const d = await loadEducatorIntelligence(admin, hospitalId ?? "");
  const maxUtil = Math.max(1, ...d.capacity.rows.map(r => r.utilisation ?? 0));

  return (
    <div className="max-w-[1500px] -mx-4 md:-mx-6 -mt-4 md:-mt-8">
      <div className="bg-[#0a0d24] bg-[radial-gradient(ellipse_at_top,rgba(168,85,247,0.14),transparent_60%)] min-h-screen px-4 md:px-6 py-6 text-slate-200">

        {/* Header */}
        <div className="flex flex-wrap items-start gap-3 mb-4">
          <div className="min-w-0">
            <p className="text-[11px] text-slate-400 flex items-center gap-1.5"><Link href="/educator/ai" className="hover:text-fuchsia-300">AI &amp; Intelligence</Link><span>›</span><span className="text-slate-300">Educator Intelligence</span></p>
            <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight bg-gradient-to-r from-fuchsia-300 via-purple-300 to-violet-300 bg-clip-text text-transparent">Educator Intelligence</h1>
            <p className="text-slate-400 text-sm">AI-powered Capacity • Effectiveness • Workload • Development • Prediction</p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Link href="/educator/analytics/learning/faculty" className="text-[12px] font-semibold text-white bg-fuchsia-600 hover:bg-fuchsia-700 rounded-lg px-3 py-2 transition-colors">⬇ Export Report</Link>
            <span title="Sharing needs a share-link store — coming soon" className="text-[12px] text-slate-400 bg-white/[0.04] border border-white/10 rounded-lg px-3 py-2 select-none">↗ Share</span>
          </div>
        </div>

        {/* Context bar */}
        <div className="rounded-2xl bg-white/[0.03] border border-white/10 px-4 py-3 mb-5 flex flex-wrap items-center gap-x-6 gap-y-2 text-[12px]">
          <div><span className="text-slate-500">Scope</span> <span className="text-slate-200 font-medium">{d.scope.institution}</span></div>
          <div><span className="text-slate-500">Educators</span> <span className="text-slate-200 font-medium">{d.scope.educators}</span></div>
          <div><span className="text-slate-500">Assessors</span> <span className="text-slate-200 font-medium">{d.scope.assessors}</span></div>
          <div><span className="text-slate-500">Assessments</span> <span className="text-slate-200 font-medium">{d.scope.assessments}</span></div>
          <div className="ml-auto flex items-center gap-3">
            <span><span className="text-slate-500">Risk</span> <span className={`font-bold ${RISK_CLS[d.risk.level]}`}>{d.risk.level}</span></span>
            <span><span className="text-slate-500">AI Confidence</span> <span className="font-bold text-slate-200">{d.risk.confidence}</span></span>
          </div>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-[260px_minmax(0,1fr)_320px] gap-4">

          {/* ── Left ── */}
          <div className="flex flex-col gap-4 min-w-0">
            <Card title="Educator Navigator" tag="live">
              <div className="max-h-[300px] overflow-y-auto -mx-1"><NavTree node={d.navigator} depth={0} /></div>
              <p className="text-[9px] text-slate-500 mt-2 pt-2 border-t border-white/5">Institution → Department → Educator, tinted by assessment workload. Names shown to managers only.</p>
            </Card>

            <Card title="Contribution Mix" tag="from activity">
              <div className="flex items-center gap-3">
                <Donut slices={d.contribution.slices.length ? d.contribution.slices : [{ label: "None", n: 1, color: "#334155" }]} center={`${d.scope.assessments}`} sub="records" />
                <div className="flex-1 min-w-0 flex flex-col gap-1">
                  {d.contribution.slices.length === 0 ? <p className="text-[11px] text-slate-500">No assessment activity yet.</p> : d.contribution.slices.map(s => <div key={s.label} className="flex items-center gap-1.5 text-[10px]"><span className="w-2 h-2 rounded-full" style={{ background: s.color }} /><span className="text-slate-300 flex-1 truncate">{s.label}</span><span className="text-slate-400">{s.pct}%</span></div>)}
                </div>
              </div>
              <p className="text-[9px] text-slate-500 mt-2">{d.contribution.note}</p>
            </Card>
          </div>

          {/* ── Center ── */}
          <div className="flex flex-col gap-4 min-w-0">
            <Card title="Educator Health Dashboard" tag="capacity live · rest muted">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                {d.health.map(k => (
                  <div key={k.label} className={`rounded-xl border p-3 ${k.tint === "muted" ? "bg-white/[0.015] border-white/5" : "bg-white/[0.03] border-white/10"}`} title={k.note}>
                    <p className={`text-2xl font-extrabold ${k.value === null ? "text-slate-500" : "text-white"}`}>{k.value === null ? "—" : `${k.value}%`}</p>
                    <p className="text-[10px] text-slate-400 leading-tight mt-0.5">{k.label}</p>
                    {k.tint === "muted" ? <span className="text-[8px] text-slate-600">no store</span> : <span className={`inline-block mt-1.5 w-6 h-1 rounded-full ${TINT_DOT[k.tint]}`} />}
                  </div>
                ))}
              </div>
              <p className="text-[9px] text-slate-500 mt-2">Capacity, workload balance &amp; deployment are live from assessment activity. Teaching effectiveness, turnaround, feedback quality &amp; development need stores we don&apos;t have — shown muted, never scored.</p>
            </Card>

            {/* Workload + capacity */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <Card title="Workload Intelligence" tag="live">
                <div className="flex items-center gap-4">
                  <Donut slices={d.workload.slices.map(s => ({ label: s.band, n: s.n, color: s.color }))} center={`${d.workload.total}`} sub="educators" />
                  <div className="flex-1 min-w-0 flex flex-col gap-1">
                    {d.workload.slices.map(s => <div key={s.band} className="flex items-center gap-1.5 text-[10px]"><span className="w-2 h-2 rounded-full" style={{ background: s.color }} /><span className="text-slate-300 flex-1">{s.band}</span><span className="text-slate-400">{s.n}</span></div>)}
                  </div>
                </div>
                <p className="text-[9px] text-slate-500 mt-2">Bands are assessment load relative to the team median (we hold no contracted-hours data).</p>
              </Card>

              <Card title="Capacity &amp; Deployment" tag="live · directional">
                <div className="flex flex-col gap-2">
                  {d.capacity.rows.length === 0 ? <p className="text-[11px] text-slate-500">No departmental activity yet.</p> : d.capacity.rows.slice(0, 6).map(r => (
                    <div key={r.dept}>
                      <div className="flex items-center justify-between text-[10px] mb-0.5"><span className="text-slate-300 truncate mr-2">{r.dept} <span className="text-slate-500">({r.educators})</span></span><span className="text-slate-400">{r.utilisation === null ? "—" : `${r.utilisation}%`}</span></div>
                      <div className="h-1.5 rounded-full bg-white/10 overflow-hidden"><div className="h-full rounded-full" style={{ width: `${((r.utilisation ?? 0) / maxUtil) * 100}%`, background: BAND_COLOR[r.band] }} /></div>
                    </div>
                  ))}
                </div>
                <p className="text-[9px] text-slate-500 mt-2">{d.capacity.note}</p>
              </Card>
            </div>

            {/* Workload map */}
            <Card title="Educator Workload Map" tag="interactive · live">
              <WorkloadMap dots={d.map} />
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2">
                {d.workload.slices.map(s => <span key={s.band} className="flex items-center gap-1 text-[9px] text-slate-400"><span className="w-2 h-2 rounded-full" style={{ background: s.color }} />{s.band}</span>)}
              </div>
              <p className="text-[9px] text-slate-500 mt-1">Positioned by assessment volume × recency of activity, coloured by workload band. Effectiveness axis isn&apos;t plotted — it has no backing store.</p>
            </Card>

            {/* Honest muted intelligence sections */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <MutedCard title="Teaching Effectiveness" icon="📈" notes={[d.unbacked.teachingEffectiveness.note]} />
              <Card title="Assessment &amp; Feedback" tag="partial" muted>
                <div className="flex flex-col gap-1.5">
                  {d.unbacked.feedback.map(f => <div key={f.label} className="flex items-center justify-between text-[11px]"><span className="text-slate-400">{f.label}</span><span className="text-slate-600 font-bold">—</span></div>)}
                </div>
                <p className="text-[9px] text-slate-500 mt-2">Turnaround, feedback quality &amp; moderation need timing/rating stores. Assessment volume &amp; type are live in the Contribution Mix.</p>
              </Card>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <MutedCard title="Development &amp; Readiness" icon="🎓" notes={[d.unbacked.development.note]} />
              <MutedCard title="Succession &amp; Leadership" icon="👑" notes={[d.unbacked.succession.note]} />
            </div>

            {/* Risk centre */}
            <Card title="Educator Risk Centre" tag="rule-derived">
              <div className="flex flex-col gap-1.5">
                {d.risks.length === 0 ? <p className="text-[11px] text-emerald-300">No capacity or workload risks detected.</p> : d.risks.map((r, i) => (
                  <div key={i} className="flex items-center gap-2 rounded-lg bg-white/[0.03] border border-white/10 px-2.5 py-1.5">
                    <span className="min-w-0 flex-1"><span className="block text-[12px] text-white leading-tight">{r.title}</span><span className="block text-[9px] text-slate-500">{r.detail}</span></span>
                    <span className={`text-[8px] font-bold uppercase px-1.5 py-0.5 rounded border ${SEV_CLS[r.severity]}`}>{r.severity}</span>
                  </div>
                ))}
              </div>
            </Card>

            {/* Predictions */}
            <Card title="Predictive Intelligence" tag="forecast · rule-derived">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                {d.predictions.map((p, i) => (
                  <div key={i} className="rounded-xl bg-white/[0.03] border border-white/10 p-3">
                    <p className="text-[12px] font-bold text-white leading-tight">{p.title}</p>
                    <p className="text-[10px] text-slate-400 mt-1 leading-snug">{p.reason}</p>
                    <div className="flex items-center gap-1.5 mt-2"><div className="h-1 flex-1 rounded-full bg-white/10 overflow-hidden"><div className="h-full rounded-full bg-fuchsia-500" style={{ width: `${p.confidence}%` }} /></div><span className="text-[9px] text-slate-400">{p.confidence}%</span></div>
                  </div>
                ))}
              </div>
              <p className="text-[9px] text-slate-500 mt-2">Forecasts from live capacity signals — not a trained model. This workspace never triggers disciplinary or HR action.</p>
            </Card>

            <CommandBar aiConfigured={d.panel.aiConfigured} />
          </div>

          {/* ── Right ── */}
          <div className="flex flex-col gap-4 min-w-0">
            <Card title="AI Summary" tag="live">
              {[["Overloaded Educators", d.panel.summary.overloaded], ["Development Needs", d.panel.summary.developmentNeeds === null ? "—" : d.panel.summary.developmentNeeds], ["Capacity Gaps", d.panel.summary.capacityGaps], ["High Risks", d.panel.summary.highRisks], ["AI Recommendations", d.panel.summary.recommendations]].map(([label, val]) => (
                <div key={label as string} className="flex items-center justify-between py-1 border-t border-white/5 first:border-t-0 text-[12px]"><span className="text-slate-400">{label}</span><span className="text-white font-bold">{val}</span></div>
              ))}
            </Card>

            <Card title="Top Risks" tag="rule-derived">
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
              <ul className="space-y-1.5">{d.panel.reasoning.map((r, i) => <li key={i} className="text-[11px] text-slate-300 flex gap-2"><span className="text-fuchsia-400 shrink-0">•</span>{r}</li>)}</ul>
            </Card>

            <Card title="Sources Used" tag="grounding">
              <div className="flex flex-col gap-1">{d.panel.sources.map(s => <p key={s} className="text-[11px] text-slate-300 flex gap-2"><span className="text-slate-500">📄</span>{s}</p>)}</div>
            </Card>

            <Card title="AI Generated Outputs" tag="live reports">
              <div className="flex flex-col gap-1">{d.panel.outputs.map(o => <Link key={o.href} href={o.href} className="flex items-center gap-2 text-[11px] text-slate-300 hover:text-white py-1"><span className="text-slate-500">📄</span>{o.label}<span className="ml-auto text-slate-600 text-[9px]">open →</span></Link>)}</div>
            </Card>
          </div>
        </div>

        <p className="text-[10px] text-slate-500 mt-6">
          Educator Intelligence helps institutions support educators, balance workload and plan capacity — it never ranks or disciplines. Capacity, workload and
          deployment are computed live from assessment activity; teaching effectiveness, feedback timing, development and succession are shown only where a backing
          store exists. Every recommendation is explainable, requires human review, and development plans stay drafts until approved.
        </p>
      </div>
    </div>
  );
}
