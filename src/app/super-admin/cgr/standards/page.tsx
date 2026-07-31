import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadRegulatoryIntelligence, type StdEntry, type DomainGap } from "@/lib/cgr/standards";
import type { GovRecord } from "@/lib/cgr/registry";
import { Kpi } from "../_kit";

// CGR-002 — Regulatory Intelligence & Standards Mapping. The intelligence lens over the competency↔standard
// mappings: a Standards Library (distinct clauses in use), Compliance Gap detection (unmapped / weakly-mapped
// competencies by risk + coverage by domain), and coverage KPIs. Authoring cross-links to Studio. Super-admin.
export const dynamic = "force-dynamic";
/* eslint-disable @typescript-eslint/no-explicit-any */

const BODY_LABEL: Record<string, string> = { jci: "JCI", who: "WHO", safecare: "SafeCare", moh: "MOH", council: "Council", nmc: "NMC", other: "Other" };
const RISK_META: Record<string, string> = {
  critical: "text-[var(--cmp-text-error)] bg-[var(--cmp-surface-error)] border-[var(--cmp-color-error)]",
  high: "text-orange-700 bg-[var(--cmp-surface-warning)] border-[var(--cmp-color-warning)]",
  standard: "text-gray-600 bg-gray-50 border-gray-200",
  low: "text-slate-500 bg-slate-50 border-slate-200",
};
const bodyLabel = (b: string) => BODY_LABEL[b] ?? b.charAt(0).toUpperCase() + b.slice(1);

function CoverageBar({ s }: { s: StdEntry }) {
  const tot = s.mappings || 1;
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 flex h-2.5 rounded overflow-hidden bg-gray-100" title={`${s.full} full · ${s.partial} partial · ${s.reference} reference`}>
        {s.full > 0 && <div className="bg-[var(--cmp-color-success)]" style={{ width: `${(s.full / tot) * 100}%` }} />}
        {s.partial > 0 && <div className="bg-[var(--cmp-color-warning)]" style={{ width: `${(s.partial / tot) * 100}%` }} />}
        {s.reference > 0 && <div className="bg-gray-300" style={{ width: `${(s.reference / tot) * 100}%` }} />}
      </div>
      <span className="text-[11px] text-gray-500 tabular-nums w-8 text-right">{s.competencies}</span>
    </div>
  );
}

export default async function RegulatoryIntelligencePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient();
  const { data: profile } = await admin.from("profiles").select("role, roles").eq("id", user.id).single();
  const roles = (profile?.roles?.length ? profile.roles : [profile?.role]) as (string | null)[];
  if (!roles.includes("super_admin")) redirect("/dashboard");

  const d = await loadRegulatoryIntelligence(admin) as any;
  const k = d.kpis;

  return (
    <div className="max-w-[1400px]">
      <div className="flex items-start justify-between gap-3 mb-5">
        <div>
          <p className="text-[11px] font-semibold text-[var(--cmp-text-success)] uppercase tracking-widest mb-0.5">CGR-002 · Competency Governance</p>
          <h1 className="text-xl font-bold text-gray-900">Regulatory Intelligence &amp; Standards Mapping</h1>
          <p className="text-gray-400 text-sm mt-0.5">Which regulations require each competency, which competencies support accreditation, and where the compliance gaps are — the intelligence lens over the standards library.</p>
        </div>
        <div className="flex gap-2 shrink-0">
          <Link href="/super-admin/studio/standards" className="text-xs font-semibold text-emerald-700 hover:text-emerald-800 border border-[var(--cmp-color-success)] bg-[var(--cmp-surface-success)] rounded-lg px-3 py-2">Author mappings →</Link>
          <Link href="/super-admin/cgr" className="text-xs font-semibold text-gray-500 hover:text-emerald-700 border border-gray-200 rounded-lg px-3 py-2">← CGR</Link>
        </div>
      </div>

      {!d.provisioned ? (
        <div className="bg-white border border-gray-200 rounded-xl p-8 text-center"><p className="text-sm text-gray-400">No competency definitions yet — regulatory intelligence computes once the registry has competencies and standard mappings.</p></div>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
            <Kpi label="Mapped coverage" value={`${k.mappedPct}%`} sub={`of ${d.analysed} competencies`} tone={k.mappedPct >= 80 ? "text-[var(--cmp-text-success)]" : k.mappedPct >= 45 ? "text-[var(--cmp-text-warning)]" : "text-[var(--cmp-text-error)]"} />
            <Kpi label="Full coverage" value={`${k.fullCoveredPct}%`} sub="have a 'full' mapping" />
            <Kpi label="Standards in use" value={k.standards} sub={`${k.mappings} mappings`} />
            <Kpi label="Regulatory bodies" value={k.bodies} sub="sources" />
            <Kpi label="Unmapped" value={k.unmapped} sub="no standard" tone={k.unmapped ? "text-[var(--cmp-text-error)]" : "text-gray-900"} />
            <Kpi label="Accreditation risk" value={k.unmappedHighRisk} sub="unmapped high-risk" tone={k.unmappedHighRisk ? "text-[var(--cmp-text-warning)]" : "text-gray-900"} />
          </div>

          {/* Bodies strip */}
          {d.bodies.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-100 p-4">
              <p className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-3">Regulatory sources</p>
              <div className="flex flex-wrap gap-2">
                {d.bodies.map((b: any) => (
                  <div key={b.body} className="flex items-center gap-2 border border-gray-100 rounded-lg px-3 py-1.5">
                    <span className="text-[12px] font-bold text-emerald-700">{bodyLabel(b.body)}</span>
                    <span className="text-[10px] text-gray-400">{b.standards} standard{b.standards === 1 ? "" : "s"} · {b.competencies} comp</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Standards Library */}
            <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
                <p className="text-sm font-bold text-gray-800">Standards Library</p>
                <p className="text-[10px] text-gray-400">{d.standards.length} clauses · coverage → competencies</p>
              </div>
              {d.standards.length === 0 ? (
                <div className="p-6 text-center"><p className="text-sm text-gray-400">No standard mappings yet. <Link href="/super-admin/studio/standards" className="text-[var(--cmp-text-success)] hover:underline">Map the first standard →</Link></p></div>
              ) : (
                <div className="max-h-[420px] overflow-y-auto">
                  <table className="w-full">
                    <tbody>
                      {d.standards.map((s: StdEntry) => (
                        <tr key={`${s.body}|${s.ref}`} className="border-t border-gray-50 first:border-t-0">
                          <td className="py-2 pl-4 pr-2">
                            <div className="flex items-center gap-1.5">
                              <span className="text-[9px] font-bold text-emerald-700 bg-[var(--cmp-surface-success)] border border-[var(--cmp-color-success)] rounded px-1 py-0.5 shrink-0">{bodyLabel(s.body)}</span>
                              <span className="text-[12px] font-semibold text-gray-800">{s.ref}</span>
                            </div>
                            {s.title && <p className="text-[10px] text-gray-400 mt-0.5 leading-snug line-clamp-1">{s.title}</p>}
                          </td>
                          <td className="py-2 pr-4 pl-2 w-40"><CoverageBar s={s} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <div className="px-4 py-2 border-t border-gray-50 flex gap-3 text-[9px] text-gray-400">
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-[var(--cmp-color-success)]" />full</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-[var(--cmp-color-warning)]" />partial</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-gray-300" />reference</span>
              </div>
            </div>

            {/* Coverage by domain */}
            <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
                <p className="text-sm font-bold text-gray-800">Coverage by clinical domain</p>
                <p className="text-[10px] text-gray-400">weakest first</p>
              </div>
              {d.domainGaps.length === 0 ? (
                <div className="p-6 text-center"><p className="text-sm text-gray-400">No domains to profile.</p></div>
              ) : (
                <div className="max-h-[420px] overflow-y-auto">
                  <table className="w-full">
                    <tbody>
                      {d.domainGaps.map((g: DomainGap) => (
                        <tr key={g.domain} className="border-t border-gray-50 first:border-t-0">
                          <td className="py-2 pl-4 pr-2 text-[12px] font-medium text-gray-800">{g.domain}</td>
                          <td className="py-2 px-2 w-40">
                            <div className="flex items-center gap-2">
                              <div className="flex-1 h-1.5 rounded-full bg-gray-100 overflow-hidden"><div className={`h-full ${g.pct >= 75 ? "bg-[var(--cmp-color-success)]" : g.pct >= 45 ? "bg-[var(--cmp-color-warning)]" : "bg-[var(--cmp-color-error)]"}`} style={{ width: `${g.pct}%` }} /></div>
                              <span className="text-[11px] font-semibold text-gray-600 tabular-nums w-8 text-right">{g.pct}%</span>
                            </div>
                          </td>
                          <td className="py-2 pr-4 pl-2 text-right text-[11px] text-gray-400 tabular-nums w-20">{g.unmapped > 0 ? <span className="text-[var(--cmp-text-error)] font-semibold">{g.unmapped} gap</span> : "covered"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>

          {/* Gap Analysis — unmapped competencies prioritised by risk */}
          <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
              <p className="text-sm font-bold text-gray-800">Compliance Gap Analysis</p>
              <p className="text-[10px] text-gray-400">unmapped competencies · highest-risk first</p>
            </div>
            {d.unmapped.length === 0 ? (
              <div className="p-6 text-center"><p className="text-sm text-[var(--cmp-text-success)] font-medium">Every analysed competency is mapped to at least one standard.</p></div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px]">
                  <thead><tr className="text-[9px] font-bold text-gray-400 uppercase tracking-wide">
                    <th className="text-left py-2 pl-4 pr-2">Competency</th>
                    <th className="text-left py-2 px-2">Risk</th>
                    <th className="text-left py-2 px-2">Domain</th>
                    <th className="text-left py-2 px-2">Owner</th>
                    <th className="text-left py-2 pr-4 pl-2">Regulatory status</th>
                  </tr></thead>
                  <tbody>
                    {d.unmapped.map((r: GovRecord) => (
                      <tr key={r.id} className="border-t border-gray-50">
                        <td className="py-2 pl-4 pr-2 text-[12px] font-medium text-gray-800">{r.name}{r.code && <span className="text-[10px] text-gray-400 ml-1">{r.code}</span>}</td>
                        <td className="py-2 px-2"><span className={`text-[10px] font-bold border rounded px-1.5 py-0.5 capitalize ${RISK_META[r.risk] ?? RISK_META.standard}`}>{r.risk}</span></td>
                        <td className="py-2 px-2 text-[11px] text-gray-500">{r.domain ?? "—"}</td>
                        <td className="py-2 px-2 text-[11px] text-gray-500">{r.owner ?? <span className="text-[var(--cmp-text-error)]">unowned</span>}</td>
                        <td className="py-2 pr-4 pl-2 text-[11px] font-semibold text-[var(--cmp-text-error)]">No standard mapped</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {d.weak.length > 0 && (
              <div className="px-4 py-3 border-t border-gray-100 bg-[var(--cmp-surface-warning)]/40">
                <p className="text-[11px] font-semibold text-[var(--cmp-text-warning)] mb-1.5">Weak coverage — mapped only by partial/reference ({k.weak})</p>
                <div className="flex flex-wrap gap-1.5">
                  {d.weak.map((r: GovRecord) => <span key={r.id} className="text-[10px] text-amber-800 bg-white border border-[var(--cmp-color-warning)] rounded px-1.5 py-0.5">{r.name} <span className="text-amber-400">· {r.risk}</span></span>)}
                </div>
              </div>
            )}
          </div>

          <p className="text-[11px] text-gray-400 leading-relaxed">Every figure is live from the standard-mapping store. The Standards Library is the distinct clauses actually mapped; gap analysis lists competencies with no mapping (regulatory gaps) and those mapped only weakly, prioritised by clinical risk. Authoring mappings, importing standards and approving them happens in <Link href="/super-admin/studio/standards" className="text-[var(--cmp-text-success)] hover:underline">the Standards Mapping Centre</Link>; per the CGR mandate only authorised governance users approve mappings, and every change is audited.</p>
        </div>
      )}
    </div>
  );
}
