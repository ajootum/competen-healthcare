import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadGovernanceDashboard } from "@/lib/cgr/dashboard";
import type { GovRecord, GovState } from "@/lib/cgr/registry";

// CGR-006 — Competency Governance Dashboard & Intelligence Workspace. Role-based governance intelligence over
// the live registry: the competency assurance score + organisational maturity, regulatory readiness by body,
// competency risk, governance performance (change control + validation), and a per-domain portfolio. Every
// metric is derived from real facts and shows its contributing factors. Super-admin, enterprise-wide.
export const dynamic = "force-dynamic";
/* eslint-disable @typescript-eslint/no-explicit-any */

const STATE_META: Record<GovState, { label: string; dot: string; text: string }> = {
  governed: { label: "Governed", dot: "bg-[var(--cmp-color-success)]", text: "text-emerald-700" },
  monitor: { label: "Monitor", dot: "bg-[var(--cmp-color-warning)]", text: "text-[var(--cmp-text-warning)]" },
  at_risk: { label: "At risk", dot: "bg-[var(--cmp-color-error)]", text: "text-[var(--cmp-text-error)]" },
  ungoverned: { label: "Ungoverned", dot: "bg-gray-400", text: "text-gray-500" },
};
const BODY_LABEL: Record<string, string> = { jci: "JCI", who: "WHO", safecare: "SafeCare", moh: "MOH", council: "Council", nmc: "NMC", other: "Other" };
const scoreTone = (v: number) => (v >= 75 ? "text-[var(--cmp-text-success)]" : v >= 45 ? "text-[var(--cmp-text-warning)]" : "text-[var(--cmp-text-error)]");
const barTone = (v: number) => (v >= 75 ? "bg-[var(--cmp-color-success)]" : v >= 45 ? "bg-[var(--cmp-color-warning)]" : "bg-[var(--cmp-color-error)]");

function gapsOf(r: GovRecord): string {
  const g: string[] = [];
  if (!r.owner) g.push("no owner");
  if (r.standards === 0) g.push("no mapping");
  if (r.reviewOverdue) g.push("review overdue");
  else if (!r.reviewDue) g.push("no review date");
  if (r.decisions === 0) g.push("no evidence");
  return g.join(" · ") || "multiple gaps";
}

function Card({ title, tag, children }: { title: string; tag?: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 p-4">
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs font-bold text-gray-500 uppercase tracking-widest">{title}</p>
        {tag && <span className="text-[9px] font-semibold text-gray-400 bg-gray-50 border border-gray-100 rounded px-1.5 py-0.5">{tag}</span>}
      </div>
      {children}
    </div>
  );
}

function DimBar({ label, pct }: { label: string; pct: number }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-0.5"><span className="text-[11px] text-gray-500">{label}</span><span className="text-[11px] font-bold text-gray-700 tabular-nums">{pct}%</span></div>
      <div className="h-1.5 rounded-full bg-gray-100 overflow-hidden"><div className={`h-full ${barTone(pct)}`} style={{ width: `${pct}%` }} /></div>
    </div>
  );
}

export default async function GovernanceDashboardPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient();
  const { data: profile } = await admin.from("profiles").select("role, roles").eq("id", user.id).single();
  const roles = (profile?.roles?.length ? profile.roles : [profile?.role]) as (string | null)[];
  if (!roles.includes("super_admin")) redirect("/dashboard");

  const d = await loadGovernanceDashboard(admin) as any;

  return (
    <div className="max-w-[1400px]">
      <div className="flex items-start justify-between gap-3 mb-5">
        <div>
          <p className="text-[11px] font-semibold text-[var(--cmp-text-success)] uppercase tracking-widest mb-0.5">CGR-006 · Competency Governance</p>
          <h1 className="text-xl font-bold text-gray-900">Governance Dashboard &amp; Intelligence</h1>
          <p className="text-gray-400 text-sm mt-0.5">Is our organisation assured that the workforce is competent, the competency systems are governed, and the risks are visible? Every metric derives from the live registry and shows its contributing factors.</p>
        </div>
        <div className="flex gap-2 shrink-0">
          <Link href="/super-admin/cgr/registry" className="text-xs font-semibold text-gray-500 hover:text-emerald-700 border border-gray-200 rounded-lg px-3 py-2">Registry →</Link>
          <Link href="/super-admin/cgr" className="text-xs font-semibold text-gray-500 hover:text-emerald-700 border border-gray-200 rounded-lg px-3 py-2">← CGR</Link>
        </div>
      </div>

      {!d.provisioned ? (
        <div className="bg-white border border-gray-200 rounded-xl p-8 text-center"><p className="text-sm text-gray-400">No competency definitions yet — once the registry has competencies, the governance dashboard computes here.</p></div>
      ) : (
        <div className="space-y-4">
          {/* Assurance score + maturity + dimensions */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <Card title="Competency Assurance Score" tag="§6.1">
              <div className="flex items-center gap-4">
                <div className="shrink-0">
                  <p className={`text-4xl font-bold tabular-nums ${scoreTone(d.assurance)}`}>{d.assurance}</p>
                  <p className="text-[10px] text-gray-400">/100 composite</p>
                </div>
                <div className="flex-1 space-y-1.5">{d.dimensions.map((dim: any) => <DimBar key={dim.label} label={dim.label} pct={dim.pct} />)}</div>
              </div>
            </Card>

            <Card title="Organisational Maturity" tag="§7">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-2xl font-bold text-emerald-700">L{d.maturity.num}</span>
                <div><p className="text-sm font-bold text-gray-900">{d.maturity.label}</p><p className="text-[10px] text-gray-400">{d.maturity.desc}</p></div>
              </div>
              <div className="flex gap-1">
                {d.maturityModel.slice().reverse().map((m: any) => (
                  <div key={m.num} className={`flex-1 h-1.5 rounded-full ${m.num <= d.maturity.num ? "bg-[var(--cmp-color-success)]" : "bg-gray-100"}`} title={`L${m.num} ${m.label}`} />
                ))}
              </div>
              <p className="text-[10px] text-gray-400 mt-1.5">Reactive → Predictive · derived from the assurance score</p>
            </Card>

            <Card title="Risk Exposure" tag="§6.3">
              <div className="grid grid-cols-2 gap-2">
                <div className="border border-gray-100 rounded-lg p-2"><p className={`text-xl font-bold tabular-nums ${d.kpis.highRisk ? "text-[var(--cmp-text-warning)]" : "text-gray-900"}`}>{d.kpis.highRisk}</p><p className="text-[10px] text-gray-500">high/critical risk</p></div>
                <div className="border border-gray-100 rounded-lg p-2"><p className={`text-xl font-bold tabular-nums ${d.kpis.overdue ? "text-[var(--cmp-text-error)]" : "text-gray-900"}`}>{d.kpis.overdue}</p><p className="text-[10px] text-gray-500">overdue reviews</p></div>
                <div className="border border-gray-100 rounded-lg p-2"><p className={`text-xl font-bold tabular-nums ${d.states.at_risk ? "text-[var(--cmp-text-error)]" : "text-gray-900"}`}>{d.states.at_risk}</p><p className="text-[10px] text-gray-500">at-risk</p></div>
                <div className="border border-gray-100 rounded-lg p-2"><p className={`text-xl font-bold tabular-nums ${d.states.ungoverned ? "text-gray-600" : "text-gray-900"}`}>{d.states.ungoverned}</p><p className="text-[10px] text-gray-500">ungoverned</p></div>
              </div>
            </Card>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Regulatory readiness by body */}
            <Card title="Regulatory Readiness" tag="§6.2">
              <div className="flex items-baseline gap-2 mb-3">
                <span className={`text-2xl font-bold tabular-nums ${scoreTone(d.regulatoryReadiness)}`}>{d.regulatoryReadiness}%</span>
                <span className="text-[11px] text-gray-400">of competencies mapped to a standard</span>
              </div>
              {d.bodies.length === 0 ? (
                <p className="text-[12px] text-gray-400">No standard mappings yet. <Link href="/super-admin/studio/standards" className="text-[var(--cmp-text-success)] hover:underline">Map standards →</Link></p>
              ) : (
                <div className="space-y-1.5">
                  {d.bodies.map((b: any) => (
                    <div key={b.body} className="flex items-center gap-2">
                      <span className="text-[11px] font-semibold text-gray-700 w-16 shrink-0">{BODY_LABEL[b.body] ?? b.body}</span>
                      <div className="flex-1 flex h-3 rounded overflow-hidden bg-gray-100" title={`${b.full} full · ${b.partial} partial · ${b.reference} reference`}>
                        {b.full > 0 && <div className="bg-[var(--cmp-color-success)]" style={{ width: `${(b.full / b.mappings) * 100}%` }} />}
                        {b.partial > 0 && <div className="bg-[var(--cmp-color-warning)]" style={{ width: `${(b.partial / b.mappings) * 100}%` }} />}
                        {b.reference > 0 && <div className="bg-gray-300" style={{ width: `${(b.reference / b.mappings) * 100}%` }} />}
                      </div>
                      <span className="text-[11px] text-gray-500 tabular-nums w-20 shrink-0 text-right">{b.competencies} comp · {b.mappings}</span>
                    </div>
                  ))}
                  <div className="flex gap-3 pt-1 text-[9px] text-gray-400">
                    <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-[var(--cmp-color-success)]" />full</span>
                    <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-[var(--cmp-color-warning)]" />partial</span>
                    <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-gray-300" />reference</span>
                  </div>
                </div>
              )}
            </Card>

            {/* Governance performance */}
            <Card title="Governance Performance" tag="§6.4">
              <div className="grid grid-cols-3 gap-2 mb-3">
                <div className="border border-gray-100 rounded-lg p-2 text-center"><p className={`text-xl font-bold tabular-nums ${d.change.open ? "text-[var(--cmp-text-warning)]" : "text-gray-900"}`}>{d.change.open}</p><p className="text-[10px] text-gray-500">open changes</p></div>
                <div className="border border-gray-100 rounded-lg p-2 text-center"><p className="text-xl font-bold tabular-nums text-gray-900">{d.changeClosed}</p><p className="text-[10px] text-gray-500">changes closed</p></div>
                <div className="border border-gray-100 rounded-lg p-2 text-center"><p className="text-xl font-bold tabular-nums text-[var(--cmp-text-success)]">{d.committees}</p><p className="text-[10px] text-gray-500">active councils</p></div>
              </div>
              <DimBar label={`Decision validation rate (${d.decValidated}/${d.decTotal})`} pct={d.validationRate} />
              {d.change.total > 0 && (
                <p className="text-[10px] text-gray-400 mt-2">Change requests by kind — major {d.change.major} · minor {d.change.minor} · revision {d.change.revision}. <Link href="/competency-office/lifecycle-state" className="text-[var(--cmp-text-success)] hover:underline">Change control →</Link></p>
              )}
            </Card>
          </div>

          {/* Domain portfolio */}
          <Card title="Domain Governance Portfolio" tag="Nursing Director lens · worst-governed first">
            {d.domains.length === 0 ? (
              <p className="text-[12px] text-gray-400">No domains to profile.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[600px]">
                  <thead><tr className="text-[9px] font-bold text-gray-400 uppercase tracking-wide">
                    <th className="text-left py-1.5 pr-3">Clinical domain</th>
                    <th className="text-center py-1.5 px-2">Competencies</th>
                    <th className="text-center py-1.5 px-2">Owned</th>
                    <th className="text-center py-1.5 px-2">At risk</th>
                    <th className="text-left py-1.5 pl-2 w-48">Governance score</th>
                  </tr></thead>
                  <tbody>
                    {d.domains.map((dm: any) => (
                      <tr key={dm.domain} className="border-t border-gray-50">
                        <td className="py-2 pr-3 text-[12px] font-medium text-gray-800">{dm.domain}</td>
                        <td className="py-2 px-2 text-center text-[12px] text-gray-600 tabular-nums">{dm.total}</td>
                        <td className="py-2 px-2 text-center text-[12px] tabular-nums text-gray-600">{dm.ownerPct}%</td>
                        <td className="py-2 px-2 text-center text-[12px] tabular-nums"><span className={dm.atRisk ? "text-[var(--cmp-text-error)] font-semibold" : "text-gray-400"}>{dm.atRisk}</span></td>
                        <td className="py-2 pl-2">
                          <div className="flex items-center gap-2">
                            <div className="flex-1 h-1.5 rounded-full bg-gray-100 overflow-hidden"><div className={`h-full ${barTone(dm.score)}`} style={{ width: `${dm.score}%` }} /></div>
                            <span className={`text-[11px] font-bold tabular-nums w-6 ${scoreTone(dm.score)}`}>{dm.score}</span>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          {/* Priority actions */}
          {d.priorities.length > 0 && (
            <Card title="Priority Actions" tag="action-oriented · §4.2">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {d.priorities.map((r: GovRecord) => (
                  <div key={r.id} className="flex items-center justify-between gap-2 border border-gray-50 rounded-lg px-3 py-2">
                    <div className="min-w-0">
                      <p className="text-[12px] font-medium text-gray-800 truncate">{r.name}</p>
                      <p className="text-[10px] text-gray-400">{r.domain ?? "—"}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <span className={`text-[10px] font-bold ${STATE_META[r.state].text}`}>{STATE_META[r.state].label}</span>
                      <p className="text-[10px] text-gray-400">{gapsOf(r)}</p>
                    </div>
                  </div>
                ))}
              </div>
              <p className="text-[10px] text-gray-400 mt-2.5"><Link href="/super-admin/cgr/ai" className="text-[var(--cmp-text-success)] hover:underline">Ask the governance copilot to prioritise these →</Link></p>
            </Card>
          )}

          <p className="text-[11px] text-gray-400 leading-relaxed">Every figure is live: the assurance score and its dimensions come from the CGR-001 registry, regulatory readiness from the Standards Mapping Centre, governance performance from change control + competency decisions + governance councils, and the domain portfolio from the registry grouped by clinical domain. Nothing is fabricated — absent facts (unmapped, unowned, no evidence) render as real gaps.</p>
        </div>
      )}
    </div>
  );
}
