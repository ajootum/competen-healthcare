import { createAdminClient } from "@/lib/supabase/server";
import { requireHqCapability } from "@/lib/hq/context";
import { loadPdHealth, loadJourneyHealth, HEALTH_REFUSALS, type JourneyHealth } from "@/lib/hq/pd-health";
import { HealthHeader, Panel, AbsentList, StateChip, Explain, Cite, ReadFailures } from "../_components/health-ui";

// CPR-PD-008D — WORKFLOW HEALTH.
//
// ⚠ THE GUARD IS ON THE PAGE, NOT ONLY ON THE LAYOUT (CPR-PD-001 s7).
//
// ⚠ THIS PAGE CHANGED FROM A REFUSAL TO A MEASUREMENT FOR TWO OF ITS EIGHT ROWS, and the six that did
// not change say so in the same table rather than in a separate section. A reader must be able to see at
// a glance which journeys are observed and which are simply not wired yet — moving the measured ones to
// the top and leaving the rest implied would suggest the module was complete.
//
// ⚠ AND A JOURNEY WITH NO ATTEMPTS SHOWS "not instrumented", NEVER A ZERO. Zero attempts and no
// instrumentation render identically as a 0, and only one of them is a fact about the product.

export const dynamic = "force-dynamic";

function successRate(j: JourneyHealth): string | null {
  if (j.attempts === null || j.attempts === 0) return null;
  return `${((j.successes / j.attempts) * 100).toFixed(1)}%`;
}

export default async function Page() {
  await requireHqCapability("hq.practice.health.view");
  const admin = await createAdminClient();
  const [h, journeys] = await Promise.all([loadPdHealth(admin), loadJourneyHealth(admin)]);

  const measured = (journeys ?? []).filter(j => j.attempts !== null);
  const unmeasured = (journeys ?? []).filter(j => j.attempts === null);

  return (
    <div className="flex flex-col gap-4">
      <HealthHeader
        title="Workflow Health"
        spec="CPR-PD-008D"
        purpose="Can practitioners complete the critical end-to-end journeys the product exists to support?"
        readAt={h.readAt}
        windowDays={h.windowDays}
      />

      {journeys === null ? (
        <div className="rounded-xl border border-[var(--cmp-color-warning)] bg-[var(--cmp-surface-warning)] p-4">
          <p className="text-[13px] font-bold text-[var(--cmp-text-warning)]">
            The journey store could not be read.
          </p>
          <p className="mt-1.5 text-[12px] leading-relaxed text-gray-800">
            That is not &ldquo;no journeys are instrumented&rdquo; — it is an unanswered question, and the
            two are different facts.
          </p>
        </div>
      ) : (
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <p className="text-[13px] font-bold text-gray-900">
            {measured.length} of {journeys.length} critical journeys are instrumented.
          </p>
          <p className="mt-1.5 max-w-4xl text-[12px] leading-relaxed text-gray-700">
            Each instrumented journey emits an attempt and exactly one outcome, so its success rate has a
            real base rather than being inferred from a failure count. The remaining {unmeasured.length}{" "}
            emit nothing yet and are shown unmeasured — this module reports what is observed, and does not
            imply the rest are fine.
          </p>
          <Explain summary="Why the attempt is the denominator and nothing else is">
            A journey emits <span className="font-semibold">started</span> when it is tried and one of
            success, failure or timeout when it ends. Counting every event of a journey would put the
            outcomes of the same attempt into the base and produce a rate that looks like a measurement
            and means nothing. Rows below divide successes by attempts only.
            <Cite>mos_journey_event, joined from mos_event through the mos_event_name catalogue</Cite>
          </Explain>
        </div>
      )}

      <ReadFailures problems={h.problems} />

      <Panel
        title="The eight critical journeys"
        note="CPR-PD-008 §6, with the minimum measurable outcome each must record. Order is the specification's."
      >
        <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Scrollable table">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="border-b border-gray-200 text-left text-[10px] font-bold uppercase tracking-wider text-gray-500">
                <th className="py-1.5 pr-3">Journey</th>
                <th className="py-1.5 pr-3 text-right">Attempts</th>
                <th className="py-1.5 pr-3 text-right">Succeeded</th>
                <th className="py-1.5 pr-3 text-right">Failed</th>
                <th className="py-1.5 pr-3 text-right">Success rate</th>
                <th className="py-1.5 pr-3 text-right">P95</th>
                <th className="py-1.5">State</th>
              </tr>
            </thead>
            <tbody>
              {(journeys ?? []).map(j => {
                const rate = successRate(j);
                return (
                  <tr key={j.key} className="border-b border-gray-100 last:border-0">
                    <td className="py-2 pr-3">
                      <span className="block font-semibold text-gray-900">{j.name}</span>
                      <span className="mt-0.5 block text-[10.5px] leading-snug text-gray-500">{j.outcomeReq}</span>
                    </td>
                    {j.attempts === null ? (
                      <td className="py-2 pr-3 text-[11.5px] text-gray-500" colSpan={5}>
                        not instrumented — this journey emits no attempt, so it has no denominator
                      </td>
                    ) : (
                      <>
                        <td className="py-2 pr-3 text-right tabular-nums text-gray-800">{j.attempts}</td>
                        <td className="py-2 pr-3 text-right tabular-nums text-gray-700">{j.successes}</td>
                        <td className={`py-2 pr-3 text-right tabular-nums ${j.failures > 0 ? "font-semibold text-[var(--cmp-text-warning)]" : "text-gray-500"}`}>
                          {j.failures}
                        </td>
                        <td className="py-2 pr-3 text-right tabular-nums font-semibold text-gray-900">{rate ?? "—"}</td>
                        <td className="py-2 pr-3 text-right tabular-nums text-gray-700">
                          {j.p95 === null ? <span className="text-gray-500">no timed event</span>
                            : j.p95 >= 1000 ? `${(j.p95 / 1000).toFixed(2)}s` : `${Math.round(j.p95)}ms`}
                        </td>
                      </>
                    )}
                    <td className="py-2">
                      <StateChip state={j.attempts === null ? "absent" : "real"} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {measured.some(j => j.topFailure) && (
          <div className="mt-3 border-t border-gray-100 pt-2">
            <p className="text-[11px] font-semibold text-gray-700">Most common failure, per instrumented journey</p>
            <ul className="mt-1 flex flex-col gap-0.5">
              {measured.filter(j => j.topFailure).map(j => (
                <li key={j.key} className="text-[11.5px] text-gray-600">
                  {j.name}: <span className="font-mono text-[10.5px]">{j.topFailure!.code}</span>{" "}
                  <span className="tabular-nums">×{j.topFailure!.n}</span>
                </li>
              ))}
            </ul>
            <p className="mt-1.5 text-[11px] leading-relaxed text-gray-500">
              A failure code comes from the engine that refused, so a booking-rule refusal is
              distinguishable from a validation failure rather than both reading as &ldquo;error&rdquo;.
            </p>
          </div>
        )}
      </Panel>

      <Panel title="What §8D still asks for that this cannot answer">
        <AbsentList items={[
          HEALTH_REFUSALS.journeys(),
          HEALTH_REFUSALS.requestLatency(),
          HEALTH_REFUSALS.slo(),
          HEALTH_REFUSALS.degradations(),
        ]} />
        <Explain summary="Why the domain is still Unknown even with two journeys measured">
          §4 defines Healthy as evidence MEETING a defined objective, and no objective is configured for
          any journey — there is no target success rate to pass. Six of the eight also emit nothing, so
          even a complete objective set would leave the domain partly blind. Two measured journeys is real
          progress and is not the same as a measured domain.
        </Explain>
      </Panel>
    </div>
  );
}
