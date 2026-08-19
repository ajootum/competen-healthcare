import { createAdminClient } from "@/lib/supabase/server";
import { requireHqCapability } from "@/lib/hq/context";
import { loadPdHealth, HEALTH_REFUSALS } from "@/lib/hq/pd-health";
import {
  HealthHeader, Panel, Stat, Share, AbsentList, ReadFailures, Explain, Cite, SampleNote,
} from "../_components/health-ui";

// CPR-PD-008C — ERRORS & FAILURES.
//
// ⚠ THE GUARD IS ON THE PAGE, NOT ONLY ON THE LAYOUT (CPR-PD-001 s7).
//
// ⚠ THIS PAGE HAS NUMERATORS AND NO PRODUCT DENOMINATOR, WHICH IS THE WHOLE STORY. Errors surface in
// three logs and are counted honestly. The count of operations ATTEMPTED across Competen Practice is
// recorded nowhere, so §8C's error RATE and its trend cannot be formed. A tally presented where a rate
// was asked for would answer a different question quietly.

export const dynamic = "force-dynamic";

export default async function Page() {
  await requireHqCapability("hq.practice.health.view");
  const admin = await createAdminClient();
  const h = await loadPdHealth(admin);

  return (
    <div className="flex flex-col gap-4">
      <HealthHeader
        title="Errors & Failures"
        spec="CPR-PD-008C"
        purpose="Application errors, failed operations, error-rate trends and failure clusters."
        readAt={h.readAt}
        windowDays={h.windowDays}
      />

      <div className="rounded-xl border border-[var(--cmp-color-warning)] bg-[var(--cmp-surface-warning)] p-4">
        <p className="text-[13px] font-bold text-[var(--cmp-text-warning)]">
          Three real error counts. No product error rate, because the denominator does not exist.
        </p>
        <p className="mt-1.5 max-w-4xl text-[12px] leading-relaxed text-gray-800">
          AI errors, job failures and platform events are each counted from a complete log, and each has a
          rate within its own log because both halves are there. What has no rate is Competen Practice
          itself: nothing records how many product operations were attempted, so there is no base to
          divide by and no trend to draw.
        </p>
      </div>

      <ReadFailures problems={h.problems} />

      <Panel title="Errors, by the log that recorded them" note="Each count is over the whole window. The rates are within their own log, and each names its base.">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="AI errors" f={h.ai.failures} />
          <Stat label="Job failures" f={h.jobs.failures} />
          <Stat label="Critical events" f={h.events.critical} />
          <Stat label="Warning events" f={h.events.warning} />
        </div>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <Share label="AI error share" f={h.ai.failureShare} of="all AI requests in the window" />
          <Share label="Job failure share" f={h.jobs.failureShare} of="all job runs in the window" />
        </div>
        <Explain summary="Why the event log has no rate beside it">
          A platform event is not an attempt at anything, so there is nothing to divide it by. Counting
          warnings against total events would produce a number that falls when the system gets noisier,
          which is the opposite of what a reader would take it for.
          <Cite>plat_platform_events.severity check (severity in (info, warning, critical))</Cite>
        </Explain>
      </Panel>

      <Panel title="Event clusters" note="What the platform event log is actually recording, most frequent first.">
        {h.events.byType.length === 0 ? (
          <p className="text-[12px] text-gray-500">
            No platform events were readable in this window. That is not the same as no events.
          </p>
        ) : (
          <>
            <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Scrollable table">
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="border-b border-gray-200 text-left text-[10px] font-bold uppercase tracking-wider text-gray-500">
                    <th className="py-1.5 pr-3">Event type</th>
                    <th className="py-1.5 text-right">Recorded</th>
                  </tr>
                </thead>
                <tbody>
                  {h.events.byType.map(e => (
                    <tr key={e.type} className="border-b border-gray-100 last:border-0">
                      <td className="py-1.5 pr-3 font-medium text-gray-800">{e.type}</td>
                      <td className="py-1.5 text-right tabular-nums text-gray-700">{e.n.toLocaleString("en-GB")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-2"><SampleNote sample={h.events.sample} what="This breakdown" /></div>
          </>
        )}
        <p className="mt-2 text-[11px] leading-relaxed text-gray-500">
          ⚠ A cluster here is a repeated event TYPE, not a diagnosed failure cluster. §8C&apos;s clustering
          groups related failures by cause, and nothing in this log carries a cause to group by.
        </p>
      </Panel>

      <Panel title="What §8C asks for that this schema cannot answer">
        <AbsentList items={[
          HEALTH_REFUSALS.errorRate(),
          HEALTH_REFUSALS.requestLatency(),
          HEALTH_REFUSALS.degradations(),
          HEALTH_REFUSALS.history(),
        ]} />
      </Panel>
    </div>
  );
}
