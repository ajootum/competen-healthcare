import Link from "next/link";
import { requireEducatorAccess } from "@/lib/educator-access";
import { loadCompetencyIntelligence, type NavNode, type Tint } from "@/lib/competency-intelligence";
import CommandBar from "./CommandBar";

// Competency Intelligence Workspace (spec v1.0 + mockup) — the flagship AI
// competency-reasoning centre inside AI & Intelligence. Dark command-centre
// theme; three columns (Navigator · Intelligence · AI Panel) over a live command
// bar. Every figure is computed from real competency records; evidence types
// with no store are shown muted and confidence/decay are labelled rule-derived.

export const dynamic = "force-dynamic";

const TINT_DOT: Record<Tint, string> = { green: "bg-emerald-400", amber: "bg-amber-400", red: "bg-rose-400", muted: "bg-slate-600" };
const RISK_CLS: Record<string, string> = { Low: "text-emerald-400", Medium: "text-amber-400", High: "text-rose-400" };
const SEV_CLS: Record<string, string> = { High: "bg-rose-500/20 text-rose-300 border-rose-500/30", Medium: "bg-amber-500/20 text-amber-300 border-amber-500/30", Low: "bg-sky-500/20 text-sky-300 border-sky-500/30" };
const EV_STATUS: Record<string, string> = { Complete: "text-emerald-400", Partial: "text-amber-400", Missing: "text-rose-400", "N/A": "text-slate-600" };

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

// Digital-twin radial: focus competency at centre, evidence modalities around it.
function DigitalTwin({ name, twin }: { name: string; twin: { label: string; present: boolean | null }[] }) {
  const cx = 130, cy = 105, r = 78, n = twin.length;
  return (
    <svg viewBox="0 0 260 210" className="w-full max-w-[340px] mx-auto">
      {twin.map((t, i) => { const a = -Math.PI / 2 + (i * 2 * Math.PI) / n; const x = cx + r * Math.cos(a), y = cy + r * Math.sin(a); return <line key={i} x1={cx} y1={cy} x2={x} y2={y} stroke="rgba(255,255,255,0.1)" strokeWidth="0.6" />; })}
      <circle cx={cx} cy={cy} r="26" fill="rgba(139,92,246,0.18)" stroke="#a855f7" strokeWidth="1.2" />
      <text x={cx} y={cy - 2} fontSize="7.5" fill="#e9d5ff" textAnchor="middle" fontWeight="bold">{name.length > 16 ? name.slice(0, 15) + "…" : name}</text>
      <text x={cx} y={cy + 7} fontSize="5.5" fill="#c4b5fd" textAnchor="middle">Digital Twin</text>
      {twin.map((t, i) => {
        const a = -Math.PI / 2 + (i * 2 * Math.PI) / n; const x = cx + r * Math.cos(a), y = cy + r * Math.sin(a);
        const fill = t.present === null ? "#1e293b" : t.present ? "#065f46" : "#3f1d1d";
        const stroke = t.present === null ? "#475569" : t.present ? "#22c55e" : "#ef4444";
        return <g key={i}>
          <circle cx={x} cy={y} r="12" fill={fill} stroke={stroke} strokeWidth="1" strokeDasharray={t.present === null ? "2 2" : undefined} />
          <text x={x} y={y - 1} fontSize="5" fill="#e2e8f0" textAnchor="middle">{t.present === null ? "–" : t.present ? "✓" : "✕"}</text>
          <text x={x} y={y + 18} fontSize="5.5" fill="#94a3b8" textAnchor="middle">{t.label}</text>
        </g>;
      })}
    </svg>
  );
}

function Gauge({ value, label, color }: { value: number | null; label: string; color?: string }) {
  const col = color ?? (value === null ? "#64748b" : value >= 75 ? "#22c55e" : value >= 50 ? "#f59e0b" : "#ef4444");
  return (
    <div className="flex flex-col items-center">
      <div className="relative w-24 h-24">
        <svg viewBox="0 0 36 36" className="w-full h-full -rotate-90"><circle cx="18" cy="18" r="15.9" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="3" />{value !== null && <circle cx="18" cy="18" r="15.9" fill="none" stroke={col} strokeWidth="3" strokeDasharray={`${value} 100`} strokeLinecap="round" />}</svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center"><span className="text-lg font-extrabold text-white">{value ?? "—"}{value !== null && <span className="text-[10px]">%</span>}</span></div>
      </div>
      <p className="text-[10px] text-slate-400 mt-1 text-center">{label}</p>
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

function Card({ title, tag, children }: { title: string; tag?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl bg-white/[0.03] border border-white/10 p-4">
      <div className="flex items-center gap-2 mb-3"><p className="text-[11px] font-bold uppercase tracking-widest text-slate-400">{title}</p>{tag && <span className="ml-auto text-[8px] font-bold uppercase tracking-wide text-slate-500">{tag}</span>}</div>
      {children}
    </div>
  );
}

export default async function CompetencyIntelligencePage() {
  const { admin, hospitalId } = await requireEducatorAccess();
  const d = await loadCompetencyIntelligence(admin, hospitalId ?? "");

  return (
    <div className="max-w-[1500px] -mx-4 md:-mx-6 -mt-4 md:-mt-8">
      <div className="bg-[#0a0d24] bg-[radial-gradient(ellipse_at_top,rgba(139,92,246,0.15),transparent_60%)] min-h-screen px-4 md:px-6 py-6 text-slate-200">

        {/* Header */}
        <div className="flex flex-wrap items-start gap-3 mb-4">
          <div className="min-w-0">
            <p className="text-[11px] text-slate-400 flex items-center gap-1.5"><Link href="/educator/ai" className="hover:text-violet-300">AI &amp; Intelligence</Link><span>›</span><span className="text-slate-300">Competency Intelligence</span></p>
            <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight bg-gradient-to-r from-violet-300 via-purple-300 to-indigo-300 bg-clip-text text-transparent">Competency Intelligence</h1>
            <p className="text-slate-400 text-sm">AI-powered Competency Analysis • Evidence • Readiness • Prediction</p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Link href="/educator/analytics/competency" className="text-[12px] font-semibold text-white bg-violet-600 hover:bg-violet-700 rounded-lg px-3 py-2 transition-colors">⬇ Export Report</Link>
            <span title="Sharing needs a share-link store — coming soon" className="text-[12px] text-slate-400 bg-white/[0.04] border border-white/10 rounded-lg px-3 py-2 select-none">↗ Share</span>
          </div>
        </div>

        {/* Context bar */}
        <div className="rounded-2xl bg-white/[0.03] border border-white/10 px-4 py-3 mb-5 flex flex-wrap items-center gap-x-6 gap-y-2 text-[12px]">
          <div><span className="text-slate-500">Scope</span> <span className="text-slate-200 font-medium">{d.scope.institution}</span></div>
          <div><span className="text-slate-500">Frameworks</span> <span className="text-slate-200 font-medium">{d.scope.frameworks}</span></div>
          <div><span className="text-slate-500">Competencies</span> <span className="text-slate-200 font-medium">{d.scope.competencies}</span></div>
          <div><span className="text-slate-500">CPUs</span> <span className="text-slate-200 font-medium">{d.scope.cpus}</span></div>
          <div><span className="text-slate-500">Learners</span> <span className="text-slate-200 font-medium">{d.scope.learners}</span></div>
          <div className="ml-auto flex items-center gap-3">
            <span><span className="text-slate-500">Risk</span> <span className={`font-bold ${RISK_CLS[d.risk.level]}`}>{d.risk.level}</span></span>
            <span><span className="text-slate-500">AI Confidence</span> <span className="font-bold text-slate-200">{d.risk.confidence}</span></span>
          </div>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-[260px_minmax(0,1fr)_320px] gap-4">

          {/* ── Left ── */}
          <div className="flex flex-col gap-4 min-w-0">
            <Card title="Competency Navigator" tag="live">
              <div className="max-h-[320px] overflow-y-auto -mx-1"><NavTree node={d.navigator} depth={0} /></div>
              <p className="text-[9px] text-slate-500 mt-2 pt-2 border-t border-white/5">Framework → Domain → CPU → Competency, health-tinted by evidence &amp; validation.</p>
            </Card>

            <Card title="Framework Intelligence" tag="rule-derived">
              {d.framework.rows.length === 0 ? <p className="text-[11px] text-emerald-300">No framework integrity issues detected.</p> : (
                <div className="flex flex-col gap-1.5">{d.framework.rows.map(r => <div key={r.label} className="flex items-center justify-between text-[11px]"><span className="text-slate-400 truncate mr-2">{r.label}</span><span className="text-slate-200 font-medium">{r.n}</span></div>)}</div>
              )}
              <p className="text-[9px] text-slate-500 mt-2 pt-2 border-t border-white/5">{d.framework.note}</p>
            </Card>
          </div>

          {/* ── Center ── */}
          <div className="flex flex-col gap-4 min-w-0">
            <Card title="Competency Health Dashboard" tag="live">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                {d.health.map(k => (
                  <div key={k.label} className="rounded-xl bg-white/[0.03] border border-white/10 p-3">
                    <p className={`text-2xl font-extrabold ${k.value === null ? "text-slate-500" : "text-white"}`}>{k.value === null ? "—" : `${k.value}%`}</p>
                    <p className="text-[10px] text-slate-400 leading-tight mt-0.5">{k.label}</p>
                    <span className={`inline-block mt-1.5 w-6 h-1 rounded-full ${TINT_DOT[k.tint]}`} />
                  </div>
                ))}
                <div className="rounded-xl bg-white/[0.03] border border-white/10 p-3"><p className={`text-2xl font-extrabold ${RISK_CLS[d.risk.level]}`}>{d.risk.level}</p><p className="text-[10px] text-slate-400 leading-tight mt-0.5">Competency Risk</p></div>
                <div className="rounded-xl bg-white/[0.03] border border-white/10 p-3"><p className="text-2xl font-extrabold text-white">{d.risk.confidence}</p><p className="text-[10px] text-slate-400 leading-tight mt-0.5">AI Confidence</p></div>
              </div>
            </Card>

            {d.focus && (
              <>
                {/* Digital twin + evidence + readiness */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                  <Card title="Competency Digital Twin" tag="live model">
                    <DigitalTwin name={d.focus.name} twin={d.focus.twin} />
                    <p className="text-[9px] text-slate-500 mt-1 text-center">Focus: <span className="text-slate-300">{d.focus.name}</span> · {d.focus.domain}</p>
                  </Card>

                  <Card title="Evidence Intelligence" tag="live">
                    <table className="w-full text-[10px] border-collapse">
                      <thead><tr className="text-slate-400"><th className="text-left font-medium py-1">Evidence</th><th className="font-medium">Status</th><th className="font-medium">Quality</th><th className="font-medium">Recency</th></tr></thead>
                      <tbody>
                        {d.focus.evidence.map(e => (
                          <tr key={e.type} className="border-t border-white/5">
                            <td className="py-1 text-slate-200">{e.type}</td>
                            <td className={`text-center py-1 font-medium ${EV_STATUS[e.status]}`}>{e.status === "Complete" ? "✔" : e.status === "N/A" ? "–" : e.status === "Partial" ? "◐" : "✕"}</td>
                            <td className="text-center py-1 text-slate-400">{e.quality}</td>
                            <td className="text-center py-1 text-slate-400">{e.recency}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <div className="flex items-center gap-2 mt-2"><span className="text-[10px] text-slate-400">Evidence sufficiency</span><div className="h-1.5 flex-1 rounded-full bg-white/10 overflow-hidden"><div className="h-full rounded-full bg-emerald-500" style={{ width: `${d.focus.evidenceScore ?? 0}%` }} /></div><span className="text-[10px] text-slate-300">{d.focus.evidenceScore ?? "—"}%</span></div>
                    <p className="text-[9px] text-slate-500 mt-1">{d.focus.evidenceRec}</p>
                  </Card>

                  <Card title="Readiness Intelligence" tag="rule-derived">
                    <div className="flex flex-col items-center">
                      <Gauge value={d.focus.readiness} label={`Confidence: ${d.focus.readinessConfidence}`} color="#10b981" />
                      <span className={`mt-1 text-[10px] font-bold uppercase px-2 py-0.5 rounded ${d.focus.independentPractice ? "bg-emerald-500/20 text-emerald-300" : "bg-amber-500/20 text-amber-300"}`}>{d.focus.independentPractice ? "Independent practice" : "Supervised practice"}</span>
                    </div>
                    <p className="text-[10px] text-slate-300 mt-2">{d.focus.readinessRec}</p>
                    <p className="text-[9px] text-slate-500 mt-1">Readiness = mean competency score vs the required standard. Confidence reflects evidence breadth, not a trained model.</p>
                  </Card>
                </div>

                {/* Network + gaps + timeline */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                  <Card title="Competency Network" tag="live counts">
                    <div className="flex flex-col gap-1.5">
                      {d.focus.network.map(nd => <div key={nd.id} className="flex items-center justify-between text-[11px]"><span className="text-slate-400">{nd.label}</span><span className="text-slate-200 font-medium">{nd.count}</span></div>)}
                    </div>
                    <p className="text-[9px] text-slate-500 mt-2">Live relationships for the focus competency across assessments, evidence, learners and standards.</p>
                  </Card>

                  <Card title="Competency Gap Analysis" tag="live">
                    <div className="flex items-center gap-3">
                      <Donut slices={d.gaps.slices.length ? d.gaps.slices : [{ label: "None", n: 1, color: "#22c55e" }]} center={`${d.gaps.total}`} sub="gaps" />
                      <div className="flex-1 min-w-0 flex flex-col gap-1">
                        {d.gaps.slices.length === 0 ? <p className="text-[11px] text-emerald-300">No gaps detected.</p> : d.gaps.slices.map(s => <div key={s.label} className="flex items-center gap-1.5 text-[10px]"><span className="w-2 h-2 rounded-full" style={{ background: s.color }} /><span className="text-slate-300 flex-1">{s.label}</span><span className="text-slate-400">{s.n}</span></div>)}
                      </div>
                    </div>
                    <Link href="/educator/analytics/competency/gaps" className="inline-block text-[11px] text-violet-300 hover:text-violet-200 mt-2">View gap details →</Link>
                  </Card>

                  <Card title="Competency Timeline" tag="focus competency">
                    <div className="flex items-center justify-between gap-1">
                      {d.focus.timeline.map((t, i) => (
                        <div key={t.label} className="flex items-center flex-1">
                          <div className="flex flex-col items-center flex-1">
                            <span className={`w-6 h-6 rounded-full flex items-center justify-center text-[9px] border-2 ${t.done ? "border-emerald-400/60 text-emerald-300 bg-emerald-500/10" : "border-white/15 text-slate-500"}`}>{t.done ? "✓" : "○"}</span>
                            <span className="text-[7px] text-slate-400 mt-1 text-center leading-tight">{t.label}</span>
                            <span className="text-[6px] text-slate-600">{t.date ?? ""}</span>
                          </div>
                          {i < d.focus!.timeline.length - 1 && <span className="h-px flex-1 bg-white/10 -mt-5" />}
                        </div>
                      ))}
                    </div>
                    <p className="text-[9px] text-slate-500 mt-3">Reconstructed from score &amp; validation dates. Stage dates without an event source show blank.</p>
                  </Card>
                </div>
              </>
            )}

            {/* Decay + readiness distribution + passport */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <Card title="Competency Decay Monitor" tag="rule-derived">
                {d.decay.length === 0 ? <p className="text-[11px] text-emerald-300">No competencies past their reassessment window.</p> : (
                  <div className="flex flex-col gap-1.5">
                    {d.decay.map(r => (
                      <div key={r.name} className="flex items-center gap-2 text-[10px]">
                        <span className="min-w-0 flex-1"><span className="block text-slate-200 truncate">{r.name}</span><span className="text-slate-500">last {r.last ?? "—"}</span></span>
                        <span className={`font-bold ${r.risk === "High" ? "text-rose-400" : r.risk === "Medium" ? "text-amber-400" : "text-emerald-400"}`}>{r.decay}%</span>
                        <span className={`text-[8px] font-bold uppercase px-1.5 py-0.5 rounded border ${SEV_CLS[r.risk]}`}>{r.risk}</span>
                      </div>
                    ))}
                  </div>
                )}
                <p className="text-[9px] text-slate-500 mt-2">Decay % = time since last demonstration ÷ CPU reassessment window.</p>
              </Card>

              <Card title="Cohort Readiness" tag="live">
                <div className="flex items-center gap-3">
                  <Donut slices={d.readinessDist} center={`${d.readinessDist.reduce((s, x) => s + x.n, 0)}`} sub="learners" />
                  <div className="flex-1 min-w-0 flex flex-col gap-1">
                    {d.readinessDist.map(s => <div key={s.label} className="flex items-center gap-1.5 text-[10px]"><span className="w-2 h-2 rounded-full" style={{ background: s.color }} /><span className="text-slate-300 flex-1">{s.label}</span><span className="text-slate-400">{s.n}</span></div>)}
                  </div>
                </div>
                <p className="text-[9px] text-slate-500 mt-2">Readiness bands from each learner&apos;s achieved-vs-assigned competencies.</p>
              </Card>

              <Card title="Passport Intelligence" tag="live">
                <div className="flex flex-col gap-1.5 text-[11px]">
                  <div className="flex justify-between"><span className="text-slate-400">Active passports</span><span className="text-slate-200 font-medium">{d.passport.active}</span></div>
                  <div className="flex justify-between"><span className="text-slate-400">Fully validated</span><span className="text-emerald-300 font-medium">{d.passport.fullyValidated}</span></div>
                  <div className="flex justify-between"><span className="text-slate-400">Expiring soon (60d)</span><span className="text-amber-300 font-medium">{d.passport.expiringSoon}</span></div>
                  <div className="flex justify-between"><span className="text-slate-400">Evidence updates needed</span><span className="text-rose-300 font-medium">{d.passport.updatesNeeded}</span></div>
                </div>
                <div className="flex items-center gap-2 mt-2 pt-2 border-t border-white/5"><span className="text-[10px] text-slate-400">Passport integrity</span><div className="h-1.5 flex-1 rounded-full bg-white/10 overflow-hidden"><div className="h-full rounded-full bg-violet-500" style={{ width: `${d.passport.integrity ?? 0}%` }} /></div><span className="text-[10px] text-slate-300">{d.passport.integrity ?? "—"}%</span></div>
              </Card>
            </div>

            {/* Predictions */}
            <Card title="Competency Prediction" tag="forecast · rule-derived">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                {d.predictions.map((p, i) => (
                  <div key={i} className="rounded-xl bg-white/[0.03] border border-white/10 p-3">
                    <p className="text-[12px] font-bold text-white leading-tight">{p.title}</p>
                    <p className="text-[10px] text-slate-400 mt-1 leading-snug">{p.reason}</p>
                    <div className="flex items-center gap-1.5 mt-2"><div className="h-1 flex-1 rounded-full bg-white/10 overflow-hidden"><div className="h-full rounded-full bg-violet-500" style={{ width: `${p.confidence}%` }} /></div><span className="text-[9px] text-slate-400">{Math.round(p.confidence)}%</span></div>
                  </div>
                ))}
              </div>
            </Card>

            <CommandBar aiConfigured={d.panel.aiConfigured} />
          </div>

          {/* ── Right ── */}
          <div className="flex flex-col gap-4 min-w-0">
            <Card title="AI Summary" tag="live">
              {[["High Risks", d.panel.summary.highRisks], ["Evidence Gaps", d.panel.summary.evidenceGaps], ["Ready for Practice", d.panel.summary.readyForPractice === null ? "—" : `${d.panel.summary.readyForPractice}%`], ["Pending Validation", d.panel.summary.pendingValidation], ["AI Recommendations", d.panel.summary.recommendations]].map(([label, val]) => (
                <div key={label as string} className="flex items-center justify-between py-1 border-t border-white/5 first:border-t-0 text-[12px]"><span className="text-slate-400">{label}</span><span className="text-white font-bold">{val}</span></div>
              ))}
            </Card>

            <Card title="Top Risks" tag="rule-derived">
              <div className="flex flex-col gap-1.5">
                {d.risks.length === 0 ? <p className="text-[11px] text-emerald-300">No active competency risks.</p> : d.risks.map((r, i) => (
                  <div key={i} className="flex items-start gap-2"><span className={`text-[8px] font-bold uppercase px-1.5 py-0.5 rounded border shrink-0 ${SEV_CLS[r.severity]}`}>{r.severity}</span><span className="text-[11px] text-slate-300 leading-tight">{r.title}</span></div>
                ))}
              </div>
            </Card>

            <Card title="Standards" tag="live">
              <div className="flex flex-col gap-2">
                {d.panel.standards.map(s => (
                  <div key={s.name}>
                    <div className="flex items-center justify-between text-[11px] mb-0.5"><span className="text-slate-300 truncate mr-2">{s.name}</span><span className="text-slate-400">{s.coverage === null ? "—" : `${s.coverage}%`}</span></div>
                    <div className="h-1.5 rounded-full bg-white/10 overflow-hidden"><div className={`h-full rounded-full ${(s.coverage ?? 0) >= 75 ? "bg-emerald-500" : (s.coverage ?? 0) >= 50 ? "bg-amber-500" : "bg-rose-500"}`} style={{ width: `${s.coverage ?? 0}%` }} /></div>
                  </div>
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
              <ul className="space-y-1.5">{d.panel.reasoning.map((r, i) => <li key={i} className="text-[11px] text-slate-300 flex gap-2"><span className="text-violet-400 shrink-0">•</span>{r}</li>)}</ul>
            </Card>

            <Card title="AI Generated Outputs" tag="live reports">
              <div className="flex flex-col gap-1">{d.panel.outputs.map(o => <Link key={o.href} href={o.href} className="flex items-center gap-2 text-[11px] text-slate-300 hover:text-white py-1"><span className="text-slate-500">📄</span>{o.label}<span className="ml-auto text-slate-600 text-[9px]">open →</span></Link>)}</div>
            </Card>
          </div>
        </div>

        <p className="text-[10px] text-slate-500 mt-6">
          Competency Intelligence answers whether each learner has sufficient, current, validated evidence of competence — reasoning across frameworks, CPUs,
          assessments, evidence, decisions and passports. Readiness, decay and predictions are explainable and rule-derived, never based on a single signal; every
          recommendation requires human approval and passport updates stay drafts until validated.
        </p>
      </div>
    </div>
  );
}
