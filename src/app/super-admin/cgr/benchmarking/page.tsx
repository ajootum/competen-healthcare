import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadGovernanceBenchmarking } from "@/lib/cgr/benchmarking";
import { Kpi } from "../_kit";

// CGR-022 — Competency Governance Global Benchmarking & Comparative Intelligence. Benchmarks governance maturity
// per domain + framework against the enterprise mean (gap, leading/lagging bands, peer-learning exemplars).
// Distinct from CAPM-006 (capability benchmarking), cross-linked. Super-admin.
export const dynamic = "force-dynamic";
/* eslint-disable @typescript-eslint/no-explicit-any */

const BAND_META: Record<string, { label: string; cls: string }> = {
  leading: { label: "Leading", cls: "text-emerald-700 bg-emerald-50 border-emerald-100" },
  on_par: { label: "On par", cls: "text-gray-500 bg-gray-50 border-gray-200" },
  lagging: { label: "Lagging", cls: "text-rose-700 bg-rose-50 border-rose-100" },
};
const barTone = (v: number) => (v >= 75 ? "bg-emerald-500" : v >= 45 ? "bg-amber-500" : "bg-rose-500");
const gapFmt = (g: number) => (g > 0 ? `+${g}` : `${g}`);

function BenchTable({ rows, mean }: { rows: any[]; mean: number }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[680px]">
        <thead><tr className="text-[9px] font-bold text-gray-400 uppercase tracking-wide">
          <th className="text-left py-2 pl-4 pr-2">Unit</th>
          <th className="text-center py-2 px-2">n</th>
          <th className="text-left py-2 px-2 w-40">Governance maturity</th>
          <th className="text-center py-2 px-2">vs mean</th>
          <th className="text-center py-2 px-2">Own</th>
          <th className="text-center py-2 px-2">Reg</th>
          <th className="text-center py-2 px-2">Rev</th>
          <th className="text-center py-2 px-2">Evid</th>
          <th className="text-left py-2 pr-4 pl-2">Band</th>
        </tr></thead>
        <tbody>
          {rows.map((r: any) => (
            <tr key={r.name} className="border-t border-gray-50">
              <td className="py-2 pl-4 pr-2 text-[12px] font-medium text-gray-800">{r.name}</td>
              <td className="py-2 px-2 text-center text-[11px] text-gray-500 tabular-nums">{r.count}</td>
              <td className="py-2 px-2">
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-1.5 rounded-full bg-gray-100 overflow-hidden relative">
                    <div className={`h-full ${barTone(r.maturity)}`} style={{ width: `${r.maturity}%` }} />
                    <div className="absolute top-0 bottom-0 w-px bg-gray-400" style={{ left: `${mean}%` }} title={`enterprise mean ${mean}`} />
                  </div>
                  <span className="text-[11px] font-bold text-gray-600 tabular-nums w-6">{r.maturity}</span>
                </div>
              </td>
              <td className="py-2 px-2 text-center"><span className={`text-[11px] font-bold tabular-nums ${r.gap > 0 ? "text-emerald-600" : r.gap < 0 ? "text-rose-600" : "text-gray-400"}`}>{gapFmt(r.gap)}</span></td>
              <td className="py-2 px-2 text-center text-[11px] text-gray-500 tabular-nums">{r.ownership}%</td>
              <td className="py-2 px-2 text-center text-[11px] text-gray-500 tabular-nums">{r.regulatory}%</td>
              <td className="py-2 px-2 text-center text-[11px] text-gray-500 tabular-nums">{r.review}%</td>
              <td className="py-2 px-2 text-center text-[11px] text-gray-500 tabular-nums">{r.evidence}%</td>
              <td className="py-2 pr-4 pl-2"><span className={`text-[10px] font-bold border rounded px-1.5 py-0.5 ${BAND_META[r.band].cls}`}>{BAND_META[r.band].label}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function GovernanceBenchmarkingPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient();
  const { data: profile } = await admin.from("profiles").select("role, roles").eq("id", user.id).single();
  const roles = (profile?.roles?.length ? profile.roles : [profile?.role]) as (string | null)[];
  if (!roles.includes("super_admin")) redirect("/dashboard");

  const d = await loadGovernanceBenchmarking(admin) as any;
  const e = d.enterprise;

  return (
    <div className="max-w-[1400px]">
      <div className="flex items-start justify-between gap-3 mb-5">
        <div>
          <p className="text-[11px] font-semibold text-emerald-600 uppercase tracking-widest mb-0.5">CGR-022 · Competency Governance</p>
          <h1 className="text-xl font-bold text-gray-900">Benchmarking &amp; Comparative Intelligence</h1>
          <p className="text-gray-400 text-sm mt-0.5">How does governance compare across units, and what can we learn to improve? Comparative maturity, gap-to-benchmark and peer-learning exemplars — to learn, not to rank.</p>
        </div>
        <div className="flex gap-2 shrink-0">
          <Link href="/super-admin/performance/benchmarking" className="text-xs font-semibold text-emerald-700 hover:text-emerald-800 border border-emerald-200 bg-emerald-50 rounded-lg px-3 py-2">Capability benchmarks →</Link>
          <Link href="/super-admin/cgr" className="text-xs font-semibold text-gray-500 hover:text-emerald-700 border border-gray-200 rounded-lg px-3 py-2">← CGR</Link>
        </div>
      </div>

      {!d.provisioned ? (
        <div className="bg-white border border-gray-200 rounded-xl p-8 text-center"><p className="text-sm text-gray-400">No governance data to benchmark yet — once competencies exist across domains and frameworks, comparative intelligence computes here.</p></div>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
            <Kpi label="Enterprise maturity" value={e.maturity} sub="mean /100" tone={e.maturity >= 75 ? "text-emerald-600" : e.maturity >= 45 ? "text-amber-600" : "text-rose-600"} />
            <Kpi label="Domains benchmarked" value={d.domains.length} sub="clinical domains" />
            <Kpi label="Best performer" value={d.best ? d.best.maturity : "—"} sub={d.best ? d.best.name : "—"} tone="text-emerald-600" />
            <Kpi label="Spread" value={d.spread} sub="best − worst" tone={d.spread >= 30 ? "text-amber-600" : "text-gray-900"} />
            <Kpi label="Leading units" value={d.leadingCount} sub="peer exemplars" tone="text-emerald-600" />
            <Kpi label="Lagging units" value={d.laggingCount} sub="need intervention" tone={d.laggingCount ? "text-rose-600" : "text-gray-900"} />
          </div>

          {/* Enterprise benchmark indicators */}
          <div className="bg-white rounded-xl border border-gray-100 p-4">
            <p className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-3">Enterprise benchmark indicators (§7)</p>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              {[
                { label: "Governance maturity", v: e.maturity },
                { label: "Ownership", v: e.ownership },
                { label: "Regulatory readiness", v: e.regulatory },
                { label: "Review currency", v: e.review },
                { label: "Evidence completeness", v: e.evidence },
              ].map((x) => (
                <div key={x.label} className="border border-gray-100 rounded-lg p-3 text-center">
                  <p className={`text-xl font-bold tabular-nums ${x.v >= 75 ? "text-emerald-600" : x.v >= 45 ? "text-amber-600" : "text-rose-600"}`}>{x.v}{x.label === "Governance maturity" ? "" : "%"}</p>
                  <p className="text-[10px] text-gray-500 leading-tight mt-0.5">{x.label}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Domain benchmarking */}
          <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
              <p className="text-sm font-bold text-gray-800">Domain benchmarking</p>
              <p className="text-[10px] text-gray-400">best first · marker = enterprise mean ({e.maturity})</p>
            </div>
            {d.domains.length === 0 ? <div className="p-6 text-center"><p className="text-[12px] text-gray-400">No domains to benchmark.</p></div> : <BenchTable rows={d.domains} mean={e.maturity} />}
          </div>

          {/* Comparative intelligence */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="bg-white rounded-xl border border-gray-100 p-4">
              <p className="text-xs font-bold text-emerald-600 uppercase tracking-widest mb-2">Peer-learning exemplars (§9)</p>
              {d.exemplars.length === 0 ? (
                <p className="text-[12px] text-gray-400">No units are clearly leading the enterprise mean yet.</p>
              ) : (
                <div className="space-y-1.5">
                  {d.exemplars.map((x: any) => (
                    <div key={x.name} className="flex items-center justify-between gap-2 border border-emerald-50 bg-emerald-50/40 rounded-lg px-2.5 py-1.5">
                      <span className="text-[12px] font-medium text-gray-800 truncate">{x.name}</span>
                      <span className="text-[11px] text-emerald-700 font-semibold shrink-0">{x.maturity} <span className="text-emerald-400">({gapFmt(x.gap)})</span></span>
                    </div>
                  ))}
                  <p className="text-[10px] text-gray-400 pt-1">High-performing governance — patterns to share across units.</p>
                </div>
              )}
            </div>
            <div className="bg-white rounded-xl border border-gray-100 p-4">
              <p className="text-xs font-bold text-rose-600 uppercase tracking-widest mb-2">Intervention targets</p>
              {d.interventions.length === 0 ? (
                <p className="text-[12px] text-emerald-600 font-medium">No units are lagging the enterprise mean — governance is consistent.</p>
              ) : (
                <div className="space-y-1.5">
                  {d.interventions.map((x: any) => (
                    <div key={x.name} className="flex items-center justify-between gap-2 border border-rose-50 bg-rose-50/40 rounded-lg px-2.5 py-1.5">
                      <span className="text-[12px] font-medium text-gray-800 truncate">{x.name}</span>
                      <span className="text-[11px] text-rose-700 font-semibold shrink-0">{x.maturity} <span className="text-rose-400">({gapFmt(x.gap)})</span></span>
                    </div>
                  ))}
                  <p className="text-[10px] text-gray-400 pt-1">Below the enterprise mean — prioritise for governance improvement.</p>
                </div>
              )}
            </div>
          </div>

          {/* Framework benchmarking */}
          {d.frameworks.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-100"><p className="text-sm font-bold text-gray-800">Framework benchmarking</p></div>
              <BenchTable rows={d.frameworks} mean={e.maturity} />
            </div>
          )}

          <p className="text-[11px] text-gray-400 leading-relaxed">Every figure is real — governance maturity and its indicators are computed live from the registry, grouped by clinical domain and framework, and compared to the enterprise mean. This benchmarks <span className="font-medium">governance</span> (maturity, ownership, regulatory readiness); <span className="font-medium">capability</span> benchmarking (competency coverage + Benner maturity) lives in <Link href="/super-admin/performance/benchmarking" className="text-emerald-600 hover:underline">Competency Performance</Link>. This is internal cross-unit comparison — external, inter-organisation benchmarking (§4.1/§10) requires consent, anonymisation and governance approval. Per the CGR mandate, benchmarking exists to identify learning opportunities, not to rank, and AI never publishes rankings without governance approval.</p>
        </div>
      )}
    </div>
  );
}
