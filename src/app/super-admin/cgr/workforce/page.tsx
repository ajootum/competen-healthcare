import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadGovernanceWorkforce } from "@/lib/cgr/workforce";

// CGR-025 — Governance Workforce Capability Intelligence. The capability of the workforce that GOVERNS
// competency: governance load distribution + concentration (key-person risk), succession exposure (single-point
// governance), and assessor capacity. Clinical workforce capability cross-links to CMO/CAPM. Super-admin.
export const dynamic = "force-dynamic";
/* eslint-disable @typescript-eslint/no-explicit-any */

const INDEP_META: Record<string, { label: string; cls: string }> = {
  independent: { label: "Independent", cls: "text-emerald-700 bg-emerald-50 border-emerald-100" },
  supervised: { label: "Supervised", cls: "text-amber-700 bg-amber-50 border-amber-100" },
  countersigned: { label: "Countersigned", cls: "text-blue-700 bg-blue-50 border-blue-100" },
};

function Kpi({ label, value, sub, tone }: { label: string; value: string | number; sub?: string; tone?: string }) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 p-3.5">
      <p className="text-[10px] text-gray-400 font-medium uppercase tracking-wide leading-tight">{label}</p>
      <p className={`text-2xl font-bold mt-1 ${tone ?? "text-gray-900"}`}>{value}</p>
      {sub && <p className="text-[10px] text-gray-400 mt-0.5">{sub}</p>}
    </div>
  );
}

export default async function GovernanceWorkforcePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient();
  const { data: profile } = await admin.from("profiles").select("role, roles").eq("id", user.id).single();
  const roles = (profile?.roles?.length ? profile.roles : [profile?.role]) as (string | null)[];
  if (!roles.includes("super_admin")) redirect("/dashboard");

  const d = await loadGovernanceWorkforce(admin) as any;
  const k = d.kpis;
  const loadMax = Math.max(1, ...d.holders.map((h: any) => h.responsibilities));
  const concentrated = k.topShare >= 40 || k.top3Share >= 75;

  return (
    <div className="max-w-[1400px]">
      <div className="flex items-start justify-between gap-3 mb-5">
        <div>
          <p className="text-[11px] font-semibold text-emerald-600 uppercase tracking-widest mb-0.5">CGR-025 · Competency Governance</p>
          <h1 className="text-xl font-bold text-gray-900">Governance Workforce Capability</h1>
          <p className="text-gray-400 text-sm mt-0.5">Do we have the capability to govern competency today, and is it sustainable? Governance load, key-person risk, succession exposure and assessor capacity.</p>
        </div>
        <div className="flex gap-2 shrink-0">
          <Link href="/competency-office/workforce-mapping" className="text-xs font-semibold text-emerald-700 hover:text-emerald-800 border border-emerald-200 bg-emerald-50 rounded-lg px-3 py-2">Clinical capability →</Link>
          <Link href="/super-admin/cgr" className="text-xs font-semibold text-gray-500 hover:text-emerald-700 border border-gray-200 rounded-lg px-3 py-2">← CGR</Link>
        </div>
      </div>

      {!d.provisioned ? (
        <div className="bg-white border border-gray-200 rounded-xl p-8 text-center"><p className="text-sm text-gray-400">No governance responsibilities or assessor authorisations recorded yet. Once ownership is assigned in <Link href="/super-admin/studio/responsibilities" className="text-emerald-600 hover:underline">Ownership</Link>, governance workload and succession exposure compute here.</p></div>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
            <Kpi label="Governance holders" value={k.holders} sub="people governing" />
            <Kpi label="Responsibilities" value={k.responsibilities} sub={`over ${k.governedObjects} objects`} />
            <Kpi label="Top-holder share" value={`${k.topShare}%`} sub="of all governance load" tone={k.topShare >= 40 ? "text-rose-600" : "text-gray-900"} />
            <Kpi label="Single-point objects" value={k.singlePoint} sub="one person governs" tone={k.singlePoint ? "text-amber-600" : "text-emerald-600"} />
            <Kpi label="Active assessors" value={k.assessors} sub={`${k.independent} independent`} />
            <Kpi label="Authorisations expiring" value={k.expiring} sub="≤ 30 days" tone={k.expiring ? "text-rose-600" : "text-gray-900"} />
          </div>

          {/* Concentration banner */}
          <div className={`rounded-xl border p-4 ${concentrated ? "bg-amber-50 border-amber-100" : "bg-emerald-50 border-emerald-100"}`}>
            <div className="flex items-center gap-3">
              <span className="text-2xl">{concentrated ? "⚠️" : "✅"}</span>
              <div>
                <p className="text-sm font-bold text-gray-800">{concentrated ? "Governance load is concentrated — key-person risk" : "Governance load is reasonably distributed"}</p>
                <p className="text-[11px] text-gray-600 mt-0.5">The top holder carries <span className="font-semibold">{k.topShare}%</span> of all governance responsibilities; the top three carry <span className="font-semibold">{k.top3Share}%</span>. {k.singlePoint > 0 && <>Identified <span className="font-semibold">{k.singlePoint}</span> object{k.singlePoint === 1 ? "" : "s"} where a single person holds all governance — a succession exposure (§8).</>}</p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* Load distribution */}
            <div className="lg:col-span-2 bg-white rounded-xl border border-gray-100 overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
                <p className="text-sm font-bold text-gray-800">Governance load by holder</p>
                <p className="text-[10px] text-gray-400">heaviest first</p>
              </div>
              {d.holders.length === 0 ? (
                <div className="p-6 text-center"><p className="text-[12px] text-gray-400">No governance responsibilities assigned.</p></div>
              ) : (
                <div className="p-3 space-y-1.5">
                  {d.holders.map((h: any) => (
                    <div key={h.name} className="flex items-center gap-2">
                      <span className="text-[12px] text-gray-700 w-40 shrink-0 truncate">{h.name}</span>
                      <div className="flex-1 h-2.5 rounded bg-gray-50 overflow-hidden"><div className="h-full bg-emerald-500 rounded" style={{ width: `${(h.responsibilities / loadMax) * 100}%` }} /></div>
                      <span className="text-[11px] font-bold text-gray-600 tabular-nums w-6 text-right">{h.responsibilities}</span>
                      <span className="text-[10px] text-gray-400 w-16 shrink-0 text-right">{h.objects} obj</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Assessor capacity */}
            <div className="bg-white rounded-xl border border-gray-100 p-4">
              <p className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-3">Assessor capacity (§5.1)</p>
              {d.assessorCapacity.active === 0 ? (
                <p className="text-[12px] text-gray-400">No active assessor authorisations — assessment delivery capacity cannot be evidenced.</p>
              ) : (
                <>
                  <div className="space-y-2 mb-3">
                    {(["independent", "supervised", "countersigned"] as const).map((lv) => (
                      <div key={lv} className="flex items-center justify-between gap-2">
                        <span className={`text-[10px] font-bold border rounded px-1.5 py-0.5 ${INDEP_META[lv].cls}`}>{INDEP_META[lv].label}</span>
                        <span className="text-[13px] font-bold text-gray-700 tabular-nums">{d.assessorCapacity.byIndep[lv]}</span>
                      </div>
                    ))}
                  </div>
                  <div className="pt-2 border-t border-gray-100 space-y-1">
                    <div className="flex items-center justify-between"><span className="text-[11px] text-gray-500">Expiring ≤30d</span><span className={`text-[12px] font-bold tabular-nums ${d.assessorCapacity.expiring ? "text-rose-600" : "text-gray-700"}`}>{d.assessorCapacity.expiring}</span></div>
                    <div className="flex items-center justify-between"><span className="text-[11px] text-gray-500">Lapsed (past validity)</span><span className={`text-[12px] font-bold tabular-nums ${d.assessorCapacity.lapsed ? "text-rose-600" : "text-gray-700"}`}>{d.assessorCapacity.lapsed}</span></div>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Succession exposure */}
          {d.singlePointList.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
                <p className="text-sm font-bold text-gray-800">Succession exposure <span className="text-[10px] font-normal text-gray-400">— governed by a single person (§8)</span></p>
                <p className="text-[10px] text-gray-400">{k.singlePoint} total</p>
              </div>
              <div className="p-3 flex flex-wrap gap-1.5">
                {d.singlePointList.map((o: any, i: number) => (
                  <span key={i} className="text-[11px] text-amber-800 bg-amber-50 border border-amber-100 rounded px-2 py-0.5">{o.name} <span className="text-amber-400">· {o.type}</span></span>
                ))}
                {k.singlePoint > d.singlePointList.length && <span className="text-[11px] text-gray-400 px-2 py-0.5">+{k.singlePoint - d.singlePointList.length} more</span>}
              </div>
            </div>
          )}

          <p className="text-[11px] text-gray-400 leading-relaxed">Every figure is real — governance load is the active content-responsibility assignments grouped by holder, key-person risk is the top-holder share of that load, succession exposure is objects where exactly one person holds all governance, and assessor capacity is the live authorisation register (independence, validity). This is the capability of the workforce that <span className="font-medium">governs</span> competency; <span className="font-medium">clinical</span> workforce capability — role→competency coverage, learning effectiveness and forecasting — is owned by <Link href="/competency-office/workforce-mapping" className="text-emerald-600 hover:underline">Workforce Mapping</Link> and <Link href="/super-admin/performance" className="text-emerald-600 hover:underline">Competency Performance</Link>. Per the CGR mandate, AI may forecast capability gaps but never makes employment decisions or determines competence without evidence.</p>
        </div>
      )}
    </div>
  );
}
