import { createAdminClient } from "@/lib/supabase/server";
import { requireHqCapability } from "@/lib/hq/context";
import { loadPdHealth } from "@/lib/hq/pd-health";
import {
  HealthHeader, Panel, Stat, Duration, Share, SampleNote, ReadFailures, Explain, Cite, TechnicalOpsLink,
} from "../_components/health-ui";

// CPR-PD-008H — AI HEALTH. The one sub-surface of this module with a complete, real producer.
//
// ⚠ THE GUARD IS ON THE PAGE, NOT ONLY ON THE LAYOUT (CPR-PD-001 s7).

export const dynamic = "force-dynamic";

export default async function Page() {
  await requireHqCapability("hq.practice.health.view");
  const admin = await createAdminClient();
  const h = await loadPdHealth(admin);

  return (
    <div className="flex flex-col gap-4">
      <HealthHeader
        title="AI Health"
        spec="CPR-PD-008H"
        purpose="AI service availability, latency, failure, guardrail and fallback health where AI is enabled."
        readAt={h.readAt}
        windowDays={h.windowDays}
      />

      <ReadFailures problems={h.problems} />

      <Panel
        title="The AI request log"
        note="Every figure here is counted over the whole window from one complete log — not sampled."
      >
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Requests" f={h.ai.requests} />
          <Stat label="Errors" f={h.ai.failures} />
          <Stat label="Refused by guardrail" f={h.ai.refusals} />
          <Stat label="Providers in use" f={h.ai.providers} />
        </div>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <Duration
            label="Latency (P95)"
            f={h.ai.latencyP95}
            explain={
              <Explain summary="What this percentile is, and what it is not">
                The 95th percentile of the round trip to the AI provider, nearest-rank, over the requests
                that recorded a latency. ⚠ It is not the time a practitioner waits for a Practice page —
                that is a different population and nothing measures it.
                <Cite>plat_ai_requests.latency_ms</Cite>
              </Explain>
            }
          />
          <Share label="Error share" f={h.ai.failureShare} of="all AI requests in the window" />
        </div>
        <div className="mt-3"><SampleNote sample={h.ai.sample} what="Latency and the breakdown below" /></div>
      </Panel>

      <Panel
        title="A refusal is the guardrail working, and is counted apart from errors"
        note="CPR-PD-008H asks for guardrail health beside failure health, because conflating them reports correct behaviour as a fault."
      >
        <p className="text-[12px] leading-relaxed text-gray-700">
          The log records four outcomes. <span className="font-semibold text-gray-900">Errors</span> are the
          call itself failing. <span className="font-semibold text-gray-900">Refusals</span> are the
          guardrail declining a request it should decline — a rising refusal count is a signal about what
          is being asked, not about whether the service is up. The other two outcomes are a normal
          completion and a provider that is not configured.
        </p>
        <Explain summary="The exact vocabulary, and a mistake it already caused here">
          status is constrained to four values and defaults to the success one. An earlier version of this
          loader tested for a status word that this column cannot hold, and rendered every request in the
          window as a failure — a screen that would have read as a total outage. The vocabulary is now
          taken from the schema and pinned by a harness.
          <Cite>plat_ai_requests.status check (status in (ok, refusal, error, not_configured))</Cite>
        </Explain>
      </Panel>

      <Panel title="By operation" note="Ordered by errors first: what needs attention reads first, not what is busiest.">
        {h.ai.byOperation.length === 0 ? (
          <p className="text-[12px] text-gray-500">
            No AI requests were readable in this window. That is not the same as no AI requests.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="border-b border-gray-200 text-left text-[10px] font-bold uppercase tracking-wider text-gray-400">
                  <th className="py-1.5 pr-3">Operation</th>
                  <th className="py-1.5 pr-3 text-right">Requests</th>
                  <th className="py-1.5 text-right">Not completed</th>
                </tr>
              </thead>
              <tbody>
                {h.ai.byOperation.map(o => (
                  <tr key={o.operation} className="border-b border-gray-100 last:border-0">
                    <td className="py-1.5 pr-3 font-medium text-gray-800">{o.operation}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums text-gray-700">{o.n.toLocaleString("en-GB")}</td>
                    <td className={`py-1.5 text-right tabular-nums ${o.failed > 0 ? "font-semibold text-[var(--cmp-text-warning)]" : "text-gray-400"}`}>
                      {o.failed.toLocaleString("en-GB")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-2 text-[11px] leading-relaxed text-gray-500">
          &ldquo;Not completed&rdquo; counts anything that did not finish normally, so it includes
          guardrail refusals as well as errors. The headline tiles above separate the two.
        </p>
      </Panel>

      <Panel title="Changing any of this">
        <TechnicalOpsLink what="AI provider configuration, model routing and fallback" />
      </Panel>
    </div>
  );
}
