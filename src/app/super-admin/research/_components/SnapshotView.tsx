import type { readSnapshot } from "@/lib/knowledge/intelligence";

// A CKRI snapshot, as cells. ⚠ SUPPRESSED IS SHOWN AS SUPPRESSED, with the minimum that hid it -- never as 0 or blank.
// Every figure carries the measure's unit, its stated limits and the snapshot's provenance (s8).

type S = NonNullable<Awaited<ReturnType<typeof readSnapshot>>>;
const pct = (v: number | null) => (v === null ? "—" : `${Math.round(v * 100)}%`);

export function SnapshotView({ s }: { s: S }) {
  const { snapshot: sn, cells, measure, meaning } = s;
  return (
    <section className="rounded-xl border border-gray-200 bg-white p-4" aria-labelledby="snap-h">
      <h2 id="snap-h" className="text-[15px] font-bold text-gray-900">{measure.label} · {sn.period_from} to {sn.period_to} · by {sn.cohort_dimension}</h2>
      <p className="mt-1 text-[12.5px] text-gray-700">Unit: {measure.unit}. <span className="font-semibold">Limits:</span> {measure.limits}</p>
      <p className="mt-1 text-[12px] text-gray-600">Population (rounded): {sn.population_rounded ?? `fewer than ${sn.min_cohort}`} · cells shown {sn.cells_reported}, suppressed {sn.cells_suppressed} · minimum cohort {sn.min_cohort} · counts rounded to {sn.round_to}{sn.complementary ? " · complementary suppression" : ""} · {sn.contract_version} · {sn.policy_version} · {sn.builder_version} · built {String(sn.built_at).slice(0, 10)} · kept until {sn.retain_until}</p>
      <p className="mt-1 text-[12px] text-gray-600">Formative evidence from people who chose collective analytics. Not a validated assessment, and not evidence about patient outcomes. Suppression and rounding reduce re-identification risk. They do not remove it.</p>
      {cells.length === 0 ? <p className="mt-2 text-[13px] text-gray-700">No events in this period.</p> : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-[13px]">
            <thead><tr className="border-b border-gray-200 text-gray-600">
              <th className="py-1.5 pr-2">Subject</th><th className="pr-2">Cohort</th><th className="pr-2">Period</th><th className="pr-2">People</th><th className="pr-2">{meaning.events}</th>
              {meaning.rate && <th className="pr-2">{meaning.rate}</th>}{meaning.rate_b && <th className="pr-2">{meaning.rate_b}</th>}{meaning.rate_c && <th className="pr-2">{meaning.rate_c}</th>}
            </tr></thead>
            <tbody>
              {cells.map(c => (
                <tr key={`${c.subjectRef}-${c.cohort}-${c.period}`} className="border-b border-gray-100">
                  <td className="py-1.5 pr-2">{c.subject}</td><td className="pr-2">{c.cohort}</td><td className="pr-2">{c.period}</td>
                  {c.suppressed ? <td colSpan={2 + (meaning.rate ? 1 : 0) + (meaning.rate_b ? 1 : 0) + (meaning.rate_c ? 1 : 0)} className="italic text-gray-600">Suppressed (fewer than {sn.min_cohort} people, or hidden so another cell cannot be worked out)</td> : <>
                    <td className="pr-2">{c.participants}</td><td className="pr-2">{c.events}</td>
                    {meaning.rate && <td className="pr-2">{pct(c.rate)}</td>}{meaning.rate_b && <td className="pr-2">{pct(c.rate_b)}</td>}{meaning.rate_c && <td className="pr-2">{pct(c.rate_c)}</td>}
                  </>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
