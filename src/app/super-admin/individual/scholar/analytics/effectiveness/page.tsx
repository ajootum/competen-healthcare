import Link from "next/link";
import { requireHqCapability } from "@/lib/hq/context";
import { loadCkriPolicy } from "@/lib/knowledge/governance";
import { loadActivityCost, costText, type ActivityCost } from "@/lib/ai/activity-cost";
import { EFFECTIVENESS_DAYS, ENGAGEMENT_IS_NOT_LEARNING, NO_TARGETS, figureText, loadEffectiveness, parseDays, type EffectivenessCell, type EffectivenessReadout } from "@/lib/hq/effectiveness/measures";
import { LIMITATIONS } from "@/lib/hq/effectiveness/report";

// Request-time only: it reads the session, and must never be prerendered at build.
export const dynamic = "force-dynamic";

/**
 * Competen HQ -- Pilot Evaluation (SALE-2026-11 R5: SALE-15 learning effectiveness, SALE-16 cost and latency, SALE-18 readout).
 *
 * ⚠ GATED BY requireHqCapability("hq.scholar.analytics.view") (migration 910), the same right as Learner Engagement, by
 * route prefix too (spaces.ts /super-admin/individual/scholar/analytics). Aggregates only: nothing here is identifiable, so
 * hq.scholar.analytics.identifiable.read is not involved.
 * ⚠ NO LEARNER DATA IS READ HERE. Learning figures come from migration 985 alone (consented, floored, rounded, no id, no
 * content). Cost and latency come from the AI ledger, the Learn audit codes and the gateway log (no user id selected).
 * ⚠ NOT MEASURED, NO DATA, SUPPRESSED and METERING OFF are each shown as what they are, never as a zero.
 */
export default async function PilotEvaluationPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireHqCapability("hq.scholar.analytics.view");
  const sp = await searchParams;
  const days = parseDays(Array.isArray(sp.days) ? sp.days[0] : sp.days);
  const policy = await loadCkriPolicy(ctx.admin);
  const [readout, cost] = await Promise.all([loadEffectiveness(ctx.admin, policy, days), loadActivityCost(ctx.admin, Math.min(days, 90))]);
  return (
    <div className="min-w-0 space-y-5 [contain:inline-size]">
      <div>
        <div className="flex items-center gap-2 text-xs text-gray-500">
          <Link href="/super-admin/individual" className="hover:text-teal-700">Competen Individual</Link><span>/</span>
          <Link href="/super-admin/individual/scholar/analytics" className="hover:text-teal-700">Learner Engagement</Link><span>/</span>
          <span className="text-gray-600">Pilot Evaluation</span>
        </div>
        <h1 className="mt-0.5 text-2xl font-bold text-gray-900">Pilot Evaluation</h1>
        <p className="text-sm text-gray-600">Learning outcomes, the standard and adaptive comparison, learner-experience signals, and AI cost and latency per useful activity. Aggregates of consenting learners only.</p>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-sm" role="group" aria-label="Window">
        <span className="text-gray-600">Window:</span>
        {EFFECTIVENESS_DAYS.map(d => (
          <Link key={d} href={`?days=${d}`} aria-current={d === days ? "page" : undefined}
            className={`rounded-full border px-3 py-1 ${d === days ? "border-teal-700 bg-teal-700 text-white" : "border-gray-300 text-gray-700 hover:border-teal-700"}`}>{d} days</Link>
        ))}
        <span className="grow" />
        <a href={`/api/hq/individual/scholar-analytics/effectiveness?days=${days}&format=md`} className="rounded-md border border-gray-300 px-3 py-1 text-gray-800 hover:border-teal-700" download>Export report (Markdown)</a>
        <a href={`/api/hq/individual/scholar-analytics/effectiveness?days=${days}&format=csv`} className="rounded-md border border-gray-300 px-3 py-1 text-gray-800 hover:border-teal-700" download>Export figures (CSV)</a>
      </div>

      <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950" role="note">
        <p className="font-medium">{ENGAGEMENT_IS_NOT_LEARNING}</p>
        <p className="mt-1">{NO_TARGETS}</p>
      </div>

      <Outcomes readout={readout} />
      <CostAndLatency cost={cost} />

      <section aria-labelledby="limits" className="rounded-lg border border-gray-200 bg-white p-4">
        <h2 id="limits" className="text-base font-semibold text-gray-900">Limitations</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-gray-700">{LIMITATIONS.map(l => <li key={l}>{l}</li>)}</ul>
      </section>
    </div>
  );
}

function Outcomes({ readout }: { readout: EffectivenessReadout }) {
  if (!readout.measured) {
    return (
      <section aria-labelledby="outcomes" className="rounded-lg border border-gray-200 bg-white p-4">
        <h2 id="outcomes" className="text-base font-semibold text-gray-900">Learning outcomes</h2>
        <p className="mt-2 text-sm text-gray-700" data-testid="effectiveness-not-measured">{readout.reason}</p>
      </section>
    );
  }
  const { cells, floor, comparison } = readout;
  const by = (g: EffectivenessCell["group"]) => cells.filter(c => c.group === g);
  return (
    <>
      <p className="text-xs text-gray-600">Minimum cohort {floor} learners (CKRI policy). Counts rounded to {readout.roundTo}. Last {readout.days} days.</p>
      <CellTable id="outcomes" title="Learning outcomes" cells={by("outcome")} floor={floor} />
      <section aria-labelledby="comparison" className="rounded-lg border border-gray-200 bg-white p-4">
        <h2 id="comparison" className="text-base font-semibold text-gray-900">Standard against adaptive flow</h2>
        <p className="mt-1 text-sm text-gray-700">{comparison.basis}</p>
        <CellRows cells={by("comparison")} floor={floor} />
        <p className="mt-3 text-sm font-medium text-gray-900" data-testid="comparison-result">
          {comparison.differencePoints === null ? comparison.reason : `Difference (adaptive minus standard): ${comparison.differencePoints > 0 ? "+" : ""}${comparison.differencePoints} percentage points.`}
        </p>
        <p className="mt-1 text-xs text-gray-600">{comparison.caution}</p>
      </section>
      <CellTable id="friction" title="Learner experience (friction signals)" cells={by("friction")} floor={floor} note="Experience signals, not learning outcomes." />
    </>
  );
}

function CellTable({ id, title, cells, floor, note }: { id: string; title: string; cells: EffectivenessCell[]; floor: number; note?: string }) {
  return (
    <section aria-labelledby={id} className="rounded-lg border border-gray-200 bg-white p-4">
      <h2 id={id} className="text-base font-semibold text-gray-900">{title}</h2>
      {note ? <p className="mt-1 text-xs text-gray-600">{note}</p> : null}
      <CellRows cells={cells} floor={floor} />
    </section>
  );
}

function CellRows({ cells, floor }: { cells: EffectivenessCell[]; floor: number }) {
  return (
    <div className="mt-2 overflow-x-auto">
      <table className="w-full min-w-[640px] text-left text-sm">
        <thead className="text-xs uppercase tracking-wide text-gray-600">
          <tr><th scope="col" className="py-2 pr-3">Measure</th><th scope="col" className="py-2 pr-3">Figure</th><th scope="col" className="py-2 pr-3">Learners</th><th scope="col" className="py-2 pr-3">Count</th><th scope="col" className="py-2">Sample and caution</th></tr>
        </thead>
        <tbody>
          {cells.map(c => (
            <tr key={`${c.measure}:${c.arm}`} className="border-t border-gray-100 align-top" data-cell={`${c.measure}:${c.arm}`} data-state={c.state}>
              <th scope="row" className="py-2 pr-3 font-medium text-gray-900">{c.label}<div className="text-xs font-normal text-gray-600">{c.counts}</div></th>
              <td className={`py-2 pr-3 whitespace-nowrap ${c.state === "reported" ? "font-semibold text-gray-900" : "italic text-gray-600"}`}>{figureText(c, floor)}</td>
              <td className="py-2 pr-3 text-gray-800">{c.learners ?? "-"}</td>
              <td className="py-2 pr-3 whitespace-nowrap text-gray-800">{c.state === "reported" ? `${c.numerator ?? "-"} / ${c.denominator ?? "-"}` : "-"}</td>
              <td className="py-2 text-xs text-gray-700"><p>{c.sample}</p><p className="mt-0.5 text-gray-600">{c.caution}</p></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CostAndLatency({ cost }: { cost: ActivityCost }) {
  const rows: [string, ActivityCost["perLessonTaught"]][] = [
    ["Per evaluated answer", cost.perEvaluatedAnswer], ["Per completed session", cost.perCompletedSession], ["Per lesson taught", cost.perLessonTaught],
  ];
  return (
    <section aria-labelledby="cost" className="rounded-lg border border-gray-200 bg-white p-4">
      <h2 id="cost" className="text-base font-semibold text-gray-900">AI cost and latency per useful activity</h2>
      <p className="mt-1 text-xs text-gray-600">Last {cost.days} days. Cost from the settled AI usage ledger, never estimated.</p>
      {!cost.meteringOn ? <p className="mt-2 rounded-md border border-gray-300 bg-gray-50 p-2 text-sm text-gray-800" data-testid="metering-off">Metering off, no data. Cost figures appear once AI metering is on (this is not zero).</p> : null}
      <dl className="mt-3 grid gap-2 sm:grid-cols-3">
        {rows.map(([label, f]) => (
          <div key={label} className="rounded-md border border-gray-200 p-2" data-cost={label}>
            <dt className="text-xs text-gray-600">{label}</dt>
            <dd className={`mt-0.5 text-sm ${f.measured ? "font-semibold text-gray-900" : "italic text-gray-600"}`}>{f.measured ? `$${f.per.toFixed(4)}` : cost.meteringOn ? costText(f) : "Metering off, no data"}</dd>
            {f.measured ? <dd className="text-xs text-gray-600">n={f.n}{"basis" in f && f.basis ? `. ${f.basis}` : ""}</dd> : null}
          </div>
        ))}
      </dl>
      <p className="mt-3 text-sm text-gray-800" data-testid="reuse-share">
        <span className="font-medium">Reuse against new generation: </span>
        {cost.reuse.measured ? `${cost.reuse.percent}% of ${cost.reuse.served + cost.reuse.generated} lessons delivered were served from a saved lesson with no AI (${cost.reuse.served} served, ${cost.reuse.generated} generated).` : cost.reuse.reason}
      </p>
      <h3 className="mt-4 text-sm font-semibold text-gray-900">Latency per activity (AI gateway, successful calls)</h3>
      {cost.latency.measured ? (
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[420px] text-left text-sm">
            <thead className="text-xs uppercase tracking-wide text-gray-600"><tr><th scope="col" className="py-1 pr-3">Activity</th><th scope="col" className="py-1 pr-3">Calls</th><th scope="col" className="py-1 pr-3">p50</th><th scope="col" className="py-1 pr-3">p90</th><th scope="col" className="py-1">Note</th></tr></thead>
            <tbody>{cost.latency.rows.map(l => (
              <tr key={l.activity} className="border-t border-gray-100"><th scope="row" className="py-1 pr-3 font-medium text-gray-900">{l.activity}</th><td className="py-1 pr-3">{l.n}</td><td className="py-1 pr-3">{(l.p50 / 1000).toFixed(1)} s</td><td className="py-1 pr-3">{(l.p90 / 1000).toFixed(1)} s</td><td className="py-1 text-xs text-gray-600">{l.small ? "Small sample" : ""}</td></tr>
            ))}</tbody>
          </table>
        </div>
      ) : <p className="mt-1 text-sm italic text-gray-600">{cost.latency.reason}</p>}
      {cost.truncated ? <p className="mt-2 text-xs text-gray-600">A source hit its read limit, so a figure may cover part of the window.</p> : null}
    </section>
  );
}
