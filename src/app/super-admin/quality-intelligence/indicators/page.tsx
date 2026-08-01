import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadIndicators } from "@/lib/qie/indicators";
import ClassifyControl from "./ClassifyControl";
import ThresholdEditor from "./ThresholdEditor";
import { cardClass } from "@/components/ui/primitives";

// QIE-002 (Metrics & Indicators) + QIE-003 (Leading & Lagging) — one surface, because over this platform
// they are one population. A Metric Registry and an Indicator Registry across the same 38 KPIs would be
// two catalogues of the same rows.
//
// Every number is READ from Performance Analytics, never recomputed. A second implementation of "how is
// this KPI doing" would eventually disagree with the first, and a hospital would have two answers to one
// question — which is the whole reason QIE composes rather than copies.

export const dynamic = "force-dynamic";

const STATUS: Record<string, { cls: string; label: string }> = {
  breach: { cls: "bg-[var(--cmp-surface-error)] text-[var(--cmp-text-error)]", label: "Breach" },
  watch: { cls: "bg-[var(--cmp-surface-warning)] text-[var(--cmp-text-warning)]", label: "Watch" },
  on_target: { cls: "bg-[var(--cmp-surface-success)] text-[var(--cmp-text-success)]", label: "On target" },
};
const TREND: Record<string, string> = { improving: "↑ improving", worsening: "↓ worsening", flat: "→ flat" };

export default async function IndicatorsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient();
  const { data: profile } = await admin.from("profiles").select("role, roles, hospital_id").eq("id", user.id).single();
  const roles = (profile?.roles?.length ? profile.roles : [profile?.role]) as (string | null)[];
  if (!roles.includes("super_admin")) redirect("/dashboard");

  const v = await loadIndicators(admin, profile?.hospital_id ?? null, true);
  const s = v.stats;

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <p className="text-[10px] font-bold text-gray-300 tracking-widest">QIE-002 · QIE-003</p>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Metrics &amp; Indicator Registry</h1>
          <p className="text-sm text-gray-500">Every quality metric this platform calculates, and whether it warns you or reports on you.</p>
        </div>
        <Link href="/super-admin/quality-intelligence" className="text-xs text-[var(--cmp-text-information)] hover:underline shrink-0">← Quality Intelligence</Link>
      </div>

      {!v.ready ? (
        <div className={cardClass}>
          <p className="text-sm font-semibold text-gray-900">Not available</p>
          <p className="text-[11px] text-gray-500 mt-1">{v.reason}</p>
        </div>
      ) : (
        <>
          <div className={cardClass}>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
              {[
                { n: s.total, l: "Indicators", c: "text-gray-900" },
                { n: s.leading, l: "Leading", c: "text-[var(--cmp-text-information)]" },
                { n: s.lagging, l: "Lagging", c: "text-gray-700" },
                { n: s.unclassified, l: "Unclassified", c: s.unclassified ? "text-[var(--cmp-text-warning)]" : "text-gray-400" },
                { n: s.breaches, l: "In breach", c: s.breaches ? "text-[var(--cmp-text-error)]" : "text-gray-400" },
              ].map(x => (
                <div key={x.l}>
                  <p className={`text-2xl font-bold leading-none tabular-nums ${x.c}`}>{x.n}</p>
                  <p className="text-[11px] text-gray-500 mt-1">{x.l}</p>
                </div>
              ))}
            </div>
            <p className="text-[11px] text-gray-500 leading-relaxed mt-3">
              Values, targets and thresholds are <strong>read from Performance Analytics</strong>, never recalculated here —
              a second implementation would eventually disagree with the first.{" "}
              {s.unclassified === s.total ? (
                <>
                  Nothing is classified yet, and that is the true starting state rather than an omission.{" "}
                  <strong>The leading/lagging split was not inferred from indicator names</strong>: whether
                  &ldquo;PEWS Compliance&rdquo; is a predictive signal or a record of process adherence is a clinical
                  governance judgement that changes which board it appears on. Classify them below.
                </>
              ) : (
                <>{s.unclassified} of {s.total} still need a governance decision on whether they warn or report.</>
              )}
            </p>
            {!v.classifiable && <p className="text-[11px] text-[var(--cmp-text-warning)] mt-2">{v.reason}</p>}
          </div>

          <div className={cardClass}>
            <h2 className="text-sm font-bold text-gray-900 mb-2">By category</h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
              {s.byCategory.map(c => (
                <div key={c.category} className="rounded-lg border border-gray-200 bg-white p-2.5">
                  <p className="text-lg font-bold text-gray-900 leading-none tabular-nums">{c.total}</p>
                  <p className="text-[11px] text-gray-600 mt-1 truncate" title={c.category}>{c.category}</p>
                  <p className="text-[9px] text-gray-400">{c.leading} leading · {c.lagging} lagging</p>
                </div>
              ))}
            </div>
          </div>

          <div className={cardClass}>
            <div className="flex items-start justify-between gap-3 flex-wrap mb-2">
              <div>
                <h2 className="text-sm font-bold text-gray-900">The registry</h2>
                <p className="text-[11px] text-gray-500">{s.withValues} of {s.total} have recorded values · {s.watch} on watch</p>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="text-[10px] uppercase tracking-wide text-gray-400 border-b border-gray-100">
                    <th className="py-2 pr-3 font-semibold">Indicator</th>
                    <th className="py-2 pr-3 font-semibold">Category</th>
                    <th className="py-2 pr-3 font-semibold text-right">Current</th>
                    <th className="py-2 pr-3 font-semibold">Trend</th>
                    <th className="py-2 pr-3 font-semibold">Status</th>
                    <th className="py-2 pr-3 font-semibold">Thresholds</th>
                    <th className="py-2 font-semibold">Classification</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {v.indicators.map(i => (
                    <tr key={i.id}>
                      <td className="py-2 pr-3">
                        <p className="text-[12px] font-medium text-gray-800">{i.name}</p>
                        <p className="text-[9px] text-gray-400">{i.code ?? "—"} · {i.points} value{i.points === 1 ? "" : "s"} · {i.direction === "lower_better" ? "lower is better" : "higher is better"}</p>
                      </td>
                      <td className="py-2 pr-3 text-[11px] text-gray-500">{i.category ?? "—"}</td>
                      <td className="py-2 pr-3 text-[12px] text-gray-800 text-right tabular-nums">
                        {i.current_value ?? "—"}{i.unit ? <span className="text-[9px] text-gray-400"> {i.unit}</span> : null}
                      </td>
                      <td className="py-2 pr-3 text-[11px] text-gray-500 whitespace-nowrap">{i.trend ? TREND[i.trend] : "—"}</td>
                      <td className="py-2 pr-3">
                        {i.status ? (
                          <span className={`text-[10px] px-1.5 py-0.5 rounded ${STATUS[i.status].cls}`}>{STATUS[i.status].label}</span>
                        ) : <span className="text-[10px] text-gray-400">no target</span>}
                      </td>
                      <td className="py-2 pr-3 align-top">
                        <p className="text-[10px] text-gray-500 tabular-nums whitespace-nowrap">
                          T {i.target ?? "—"} · A {i.threshold_amber ?? "—"} · R {i.threshold_red ?? "—"}
                        </p>
                        <ThresholdEditor id={i.id} name={i.name} direction={i.direction}
                          target={i.target} amber={i.threshold_amber} red={i.threshold_red} />
                      </td>
                      <td className="py-2 align-top">
                        {v.classifiable
                          ? <ClassifyControl id={i.id} current={i.indicator_class} />
                          : <span className="text-[10px] text-gray-400">unavailable</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
