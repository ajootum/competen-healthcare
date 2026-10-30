import { RISK_TIER_LABEL, type RiskTier } from "@/lib/ai/clinical-risk";
import type { ProductReadiness } from "@/lib/ai/readiness";

// "AI readiness" on /super-admin/ai/fair-use (SCHOLAR-EDU-AI-01, sections 6 and 7): for each activity, the model a
// request gets at each clinical risk tier, exactly as the gate would pick it, and where students meet the activity.
// Server-rendered and read-only: it changes when routing or an eligibility decision changes.

const TIERS: RiskTier[] = ["standard_educational", "clinical_educational", "high_risk_clinical"];
const th = "text-[11.5px] uppercase tracking-[0.08em] text-gray-500";

export function ReadinessSection({ readiness }: { readiness: ProductReadiness[] }) {
  return (
    <section aria-labelledby="rd-h" className="rounded-xl border border-gray-200 bg-white p-5">
      <h2 id="rd-h" className="text-[16px] font-bold text-gray-900">AI readiness</h2>
      <p className="mt-1 text-[13px] text-gray-600">
        Which model each AI activity runs on, at each clinical risk tier, from the published routing and the recorded eligibility decisions.
        Study notes are almost always clinical, so an activity with no model at clinical educational refuses on them: it is listed as a gap.
        A gap is closed only by an eligibility decision resting on evaluation evidence, recorded in Provider prices and eligibility above.
      </p>
      {readiness.map(p => {
        const gaps = (p.rows ?? []).filter(r => r.gap);
        return (
          <div key={p.product} className="mt-4">
            <h3 className="text-[14px] font-bold capitalize text-gray-900">{p.product}</h3>
            {p.rows === null ? (
              <p role="status" className="mt-1 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[13px] text-amber-950">Readiness could not be read just now (policy, routing or eligibility unreadable). Treat every clinical activity as not ready.</p>
            ) : (
              <>
                <p className={`mt-1 rounded-lg border px-3 py-2 text-[13px] ${gaps.length ? "border-amber-300 bg-amber-50 text-amber-950" : "border-[var(--cmp-color-success)] bg-[var(--cmp-surface-success)] text-[var(--cmp-text-success)]"}`}>
                  {gaps.length ? `${gaps.length} of ${p.rows.length} activities have no model for clinical educational content: ${gaps.map(g => g.code).join(", ")}.` : `All ${p.rows.length} activities have a model for clinical educational content.`}
                </p>
                <div className="overflow-x-auto">
                  <table className="mt-2 w-full min-w-[760px] text-left text-[13px]">
                    <thead><tr className="border-b border-gray-200"><th scope="col" className={`${th} py-1.5`}>Activity</th><th scope="col" className={th}>Used in</th><th scope="col" className={th}>Floor</th>{TIERS.map(t => <th key={t} scope="col" className={th}>{RISK_TIER_LABEL[t]}</th>)}</tr></thead>
                    <tbody>{p.rows.map(r => (
                      <tr key={r.code} className={`border-b border-gray-100 align-top ${r.gap ? "bg-amber-50/60" : ""}`}>
                        <th scope="row" className="py-1.5 pr-2 font-normal"><span className="font-semibold text-gray-900">{r.code}</span><br /><span className="text-gray-600">{r.label}</span>{r.gap && <><br /><span className="font-semibold text-amber-900">Gap</span></>}</th>
                        <td className="pr-2 text-gray-700">{r.experiences ?? <span className="text-gray-500">Not mapped</span>}</td>
                        <td className="pr-2 text-gray-700">{RISK_TIER_LABEL[r.floor]}</td>
                        {TIERS.map(t => (
                          <td key={t} className="pr-2">{!(t in r.routes) ? <span className="text-gray-400">Below floor</span>
                            : r.routes[t] ? <span className="text-gray-900">{r.routes[t]!.model}</span>
                            : <span className={t === "high_risk_clinical" ? "text-gray-500" : "font-semibold text-amber-900"}>Not covered</span>}</td>
                        ))}
                      </tr>))}</tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        );
      })}
    </section>
  );
}
