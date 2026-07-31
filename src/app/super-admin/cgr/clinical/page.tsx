import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadClinicalIntelligence } from "@/lib/cgr/clinical";

// CGR-026 — Clinical Practice Intelligence & Outcome Correlation. Two lenses on "is competency improving
// outcomes": the statistical correlation (CAPM-005, embedded with credit) and the case lens — competencies
// implicated by real safety events through governance-confirmed learning links (mig 150), joined to the
// registry so "implicated + weakly governed" surfaces as practice risk. Aggregated by competency and unit,
// never by person (§4.4 improvement-not-blame). Super-admin.
export const dynamic = "force-dynamic";
/* eslint-disable @typescript-eslint/no-explicit-any */

const CORR: Record<string, string> = { emerald: "text-[var(--cmp-text-success)]", rose: "text-[var(--cmp-text-error)]", gray: "text-gray-400" };
const RISK_META: Record<string, string> = {
  critical: "text-[var(--cmp-text-error)] bg-[var(--cmp-surface-error)] border-[var(--cmp-color-error)]", high: "text-orange-700 bg-[var(--cmp-surface-warning)] border-[var(--cmp-color-warning)]",
  standard: "text-gray-600 bg-gray-50 border-gray-200", low: "text-slate-500 bg-slate-50 border-slate-200",
};
const tone = (v: number) => (v >= 75 ? "text-[var(--cmp-text-success)]" : v >= 55 ? "text-[var(--cmp-text-warning)]" : "text-[var(--cmp-text-error)]");

function Kpi({ label, value, sub, t }: { label: string; value: string | number; sub?: string; t?: string }) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 p-3.5">
      <p className="text-[10px] text-gray-400 font-medium uppercase tracking-wide leading-tight">{label}</p>
      <p className={`text-2xl font-bold mt-1 ${t ?? "text-gray-900"}`}>{value}</p>
      {sub && <p className="text-[10px] text-gray-400 mt-0.5">{sub}</p>}
    </div>
  );
}

export default async function ClinicalIntelligencePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient();
  const { data: profile } = await admin.from("profiles").select("role, roles, hospital_id").eq("id", user.id).single();
  const roles = (profile?.roles?.length ? profile.roles : [profile?.role]) as (string | null)[];
  if (!roles.includes("super_admin")) redirect("/dashboard");

  const d = await loadClinicalIntelligence(admin, profile?.hospital_id ?? null, true) as any;
  const k = d.kpis;
  const loopMax = Math.max(1, ...d.loop.map((l: any) => l.n));

  return (
    <div className="max-w-[1400px]">
      <div className="flex items-start justify-between gap-3 mb-5">
        <div>
          <p className="text-[11px] font-semibold text-[var(--cmp-text-success)] uppercase tracking-widest mb-0.5">CGR-026 · Competency Governance</p>
          <h1 className="text-xl font-bold text-gray-900">Clinical Practice Intelligence &amp; Outcome Correlation</h1>
          <p className="text-gray-400 text-sm mt-0.5">Are competency systems improving clinical practice? Two lenses: the statistical correlation, and the case-confirmed link between real safety events and specific competencies.</p>
        </div>
        <div className="flex gap-2 shrink-0">
          <Link href="/super-admin/performance/correlation" className="text-xs font-semibold text-emerald-700 hover:text-emerald-800 border border-[var(--cmp-color-success)] bg-[var(--cmp-surface-success)] rounded-lg px-3 py-2">Full correlation →</Link>
          <Link href="/super-admin/cgr" className="text-xs font-semibold text-gray-500 hover:text-emerald-700 border border-gray-200 rounded-lg px-3 py-2">← CGR</Link>
        </div>
      </div>

      {!d.provisioned ? (
        <div className="bg-white border border-gray-200 rounded-xl p-8 text-center"><p className="text-sm text-gray-400">No safety events, learning links or governed competencies yet — clinical practice intelligence computes once those exist.</p></div>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
            <Kpi label="Events linked" value={`${k.linkedEvents}/${k.totalIncidents}`} sub="safety events → competency" />
            <Kpi label="Evidenced links" value={k.evidencedLinks} sub="confirmed / implemented" t={k.evidencedLinks ? "text-[var(--cmp-text-success)]" : "text-gray-900"} />
            <Kpi label="Candidate links" value={k.proposedLinks} sub="awaiting governance review" t={k.proposedLinks ? "text-[var(--cmp-text-warning)]" : "text-gray-900"} />
            <Kpi label="Implicated competencies" value={k.implicated} sub="by real events" />
            <Kpi label="Practice risk" value={k.practiceRisk} sub="implicated + weakly governed" t={k.practiceRisk ? "text-[var(--cmp-text-error)]" : "text-gray-900"} />
            <Kpi label="Units with events" value={k.variationDepts} sub={`${k.unattributed} unattributed`} />
          </div>

          {/* Two lenses */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="bg-white rounded-xl border border-gray-100 p-4">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-bold text-gray-500 uppercase tracking-widest">Statistical lens (§5.1)</p>
                <span className="text-[9px] font-bold text-[var(--cmp-text-information)] bg-[var(--cmp-surface-information)] border border-[var(--cmp-color-information)] rounded px-1.5 py-0.5">CAPM-005</span>
              </div>
              {!d.corr ? (
                <p className="text-[12px] text-gray-400">Not enough department data to correlate competency with outcomes — the correlation engine will say so rather than overclaim.</p>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-2">
                    {[{ t: "↔ observation compliance", c: d.corr.compliance }, { t: "↔ escalation rate", c: d.corr.escalation }].map((b: any) => (
                      <div key={b.t} className="border border-gray-100 rounded-lg p-2.5">
                        <p className={`text-xl font-bold tabular-nums ${CORR[b.c?.tone] ?? CORR.gray}`}>{b.c?.r == null ? "—" : (b.c.r > 0 ? "+" : "") + b.c.r}</p>
                        <p className="text-[10px] text-gray-500">{b.t}</p>
                      </div>
                    ))}
                  </div>
                  <p className="text-[10px] text-gray-400 mt-2">Ecological, across {d.corr.departments} departments — directional, never causal. Owned by <Link href="/super-admin/performance/correlation" className="text-[var(--cmp-text-success)] hover:underline">Competency Performance</Link>.</p>
                </>
              )}
            </div>

            <div className="lg:col-span-2 bg-white rounded-xl border border-gray-100 p-4">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-bold text-gray-500 uppercase tracking-widest">Case lens (§5.2) — the learning loop, live</p>
                <span className="text-[9px] font-bold text-emerald-700 bg-[var(--cmp-surface-success)] border border-[var(--cmp-color-success)] rounded px-1.5 py-0.5">CONFIRMED LINKS</span>
              </div>
              <div className="space-y-1.5">
                {d.loop.map((l: any, i: number) => (
                  <div key={l.step} className="flex items-center gap-3">
                    <span className="text-[10px] font-bold text-gray-300 tabular-nums w-4">{i + 1}</span>
                    <span className="text-[11px] text-gray-600 w-44 shrink-0">{l.step}</span>
                    <div className="flex-1 h-2.5 rounded bg-gray-50 overflow-hidden"><div className="h-full bg-[var(--cmp-color-success)] rounded" style={{ width: `${(l.n / loopMax) * 100}%` }} /></div>
                    <span className="text-[12px] font-bold text-gray-700 tabular-nums w-8 text-right">{l.n}</span>
                    <span className="text-[10px] text-gray-400 w-44 shrink-0">{l.note}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Implicated competencies — flagship */}
          <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
              <p className="text-sm font-bold text-gray-800">Competencies implicated by safety events <span className="text-[10px] font-normal text-gray-400">— aggregated by competency, never by person (§4.4)</span></p>
              <p className="text-[10px] text-gray-400">evidence first · <Link href="/super-admin/cgr/learning" className="text-[var(--cmp-text-success)] hover:underline">manage links →</Link></p>
            </div>
            {d.implicated.length === 0 ? (
              <div className="p-6 text-center"><p className="text-sm text-gray-400">No safety events have been linked to competencies yet. Propose links in <Link href="/super-admin/cgr/learning" className="text-[var(--cmp-text-success)] hover:underline">Organisational Learning</Link> — once governance confirms them, this becomes the case-level evidence that specific competencies need attention.</p></div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[820px]">
                  <thead><tr className="text-[9px] font-bold text-gray-400 uppercase tracking-wide">
                    <th className="text-left py-2 pl-4 pr-2">Competency</th>
                    <th className="text-left py-2 px-2">Risk</th>
                    <th className="text-center py-2 px-2">Events</th>
                    <th className="text-center py-2 px-2">High/crit</th>
                    <th className="text-center py-2 px-2">Near-miss</th>
                    <th className="text-center py-2 px-2">Evidenced</th>
                    <th className="text-center py-2 px-2">Candidates</th>
                    <th className="text-center py-2 px-2">Governance</th>
                    <th className="text-left py-2 pr-4 pl-2">Signal</th>
                  </tr></thead>
                  <tbody>
                    {d.implicated.map((x: any) => (
                      <tr key={x.id} className="border-t border-gray-50">
                        <td className="py-2 pl-4 pr-2 text-[12px] font-medium text-gray-800">{x.name}</td>
                        <td className="py-2 px-2">{x.risk ? <span className={`text-[10px] font-bold border rounded px-1.5 py-0.5 capitalize ${RISK_META[x.risk] ?? RISK_META.standard}`}>{x.risk}</span> : <span className="text-[10px] text-gray-300">—</span>}</td>
                        <td className="py-2 px-2 text-center text-[12px] text-gray-700 tabular-nums">{x.events}</td>
                        <td className="py-2 px-2 text-center text-[11px] tabular-nums"><span className={x.highCritical ? "text-[var(--cmp-text-error)] font-semibold" : "text-gray-400"}>{x.highCritical}</span></td>
                        <td className="py-2 px-2 text-center text-[11px] text-gray-500 tabular-nums">{x.nearMiss}</td>
                        <td className="py-2 px-2 text-center text-[11px] tabular-nums"><span className={x.confirmed + x.implemented ? "text-[var(--cmp-text-success)] font-semibold" : "text-gray-300"}>{x.confirmed + x.implemented}</span></td>
                        <td className="py-2 px-2 text-center text-[11px] tabular-nums"><span className={x.proposed ? "text-[var(--cmp-text-warning)]" : "text-gray-300"}>{x.proposed}{x.byAi > 0 && <span className="text-[8px] font-bold text-violet-600 ml-0.5">AI</span>}</span></td>
                        <td className="py-2 px-2 text-center">{x.govScore != null ? <span className={`text-[11px] font-bold tabular-nums ${tone(x.govScore)}`}>{x.govScore}</span> : <span className="text-[10px] text-gray-300">—</span>}</td>
                        <td className="py-2 pr-4 pl-2">{x.practiceRisk ? <span className="text-[10px] font-bold text-[var(--cmp-text-error)] bg-[var(--cmp-surface-error)] border border-[var(--cmp-color-error)] rounded px-1.5 py-0.5">practice risk</span> : <span className="text-[10px] text-gray-300">—</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Variation + M&M */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="lg:col-span-2 bg-white rounded-xl border border-gray-100 overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
                <p className="text-sm font-bold text-gray-800">Practice variation by unit (§5.3)</p>
                <p className="text-[10px] text-gray-400">{d.variationSpread != null ? `event spread ${d.variationSpread}` : "needs ≥2 units with events"}</p>
              </div>
              {d.variation.length === 0 ? (
                <div className="p-6 text-center"><p className="text-[12px] text-gray-400">No unit-attributable events or team states yet.</p></div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[560px]">
                    <thead><tr className="text-[9px] font-bold text-gray-400 uppercase tracking-wide">
                      <th className="text-left py-2 pl-4 pr-2">Unit</th>
                      <th className="text-center py-2 px-2">Events</th>
                      <th className="text-center py-2 px-2">High/crit</th>
                      <th className="text-center py-2 px-2">Near-miss</th>
                      <th className="text-center py-2 pr-4 pl-2">Team twin state</th>
                    </tr></thead>
                    <tbody>
                      {d.variation.map((v: any) => (
                        <tr key={v.name} className="border-t border-gray-50">
                          <td className="py-2 pl-4 pr-2 text-[12px] font-medium text-gray-800">{v.name}</td>
                          <td className="py-2 px-2 text-center text-[12px] text-gray-700 tabular-nums">{v.events}</td>
                          <td className="py-2 px-2 text-center text-[11px] tabular-nums"><span className={v.highCritical ? "text-[var(--cmp-text-error)] font-semibold" : "text-gray-400"}>{v.highCritical}</span></td>
                          <td className="py-2 px-2 text-center text-[11px] text-gray-500 tabular-nums">{v.nearMiss}</td>
                          <td className="py-2 pr-4 pl-2 text-center">{v.twinState != null ? <span className={`text-[12px] font-bold tabular-nums ${tone(v.twinState)}`}>{v.twinState}</span> : <span className="text-[10px] text-gray-300">no twin</span>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="bg-white rounded-xl border border-gray-100 p-4">
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs font-bold text-gray-500 uppercase tracking-widest">M&amp;M learning (§5.4)</p>
                <Link href="/unit-manager/quality/mortality" className="text-[10px] text-[var(--cmp-text-success)] hover:underline">M&amp;M centre →</Link>
              </div>
              {!d.mm.ready ? (
                <p className="text-[12px] text-gray-400">M&amp;M register not available.</p>
              ) : d.mm.total === 0 ? (
                <p className="text-[12px] text-gray-400">No M&amp;M cases recorded yet.</p>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  <div className="border border-gray-100 rounded-lg p-2.5"><p className="text-xl font-bold text-gray-900 tabular-nums">{d.mm.total}</p><p className="text-[10px] text-gray-500">cases ({d.mm.mortality} M · {d.mm.morbidity} B)</p></div>
                  <div className="border border-gray-100 rounded-lg p-2.5"><p className="text-xl font-bold text-[var(--cmp-text-success)] tabular-nums">{d.mm.closed}</p><p className="text-[10px] text-gray-500">closed through review</p></div>
                </div>
              )}
              <p className="text-[10px] text-gray-400 mt-3 leading-snug">Case reviews live in the M&amp;M centre; when a review drives a competency change, record it as a learning link so it counts toward proven closure.</p>
            </div>
          </div>

          <p className="text-[11px] text-gray-400 leading-relaxed">Every figure is real. The statistical lens is CAPM-005&apos;s ecological correlation, embedded with credit — directional, never causal. The case lens is built from governance-confirmed learning links (migration 150): only confirmed/implemented links count as evidence, candidates are labelled as such, and everything aggregates by competency and unit — never by person (§4.4). Unit attribution runs incident → patient → department, so the unit is where the <span className="font-medium">patient</span> was, while the team twin state reflects staff assigned there; {k.unattributed > 0 ? `${k.unattributed} event${k.unattributed === 1 ? "" : "s"} without a patient link ${k.unattributed === 1 ? "is" : "are"} excluded from variation rather than guessed.` : "events without a patient link are excluded from variation rather than guessed."} Per the CGR mandate, AI may surface patterns but never determines causation without validation, assigns individual blame, or replaces clinical review.</p>
        </div>
      )}
    </div>
  );
}
