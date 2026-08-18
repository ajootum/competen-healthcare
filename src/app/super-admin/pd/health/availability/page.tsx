import { createAdminClient } from "@/lib/supabase/server";
import { requireHqCapability } from "@/lib/hq/context";
import { loadPdHealth, HEALTH_REFUSALS } from "@/lib/hq/pd-health";
import { HealthHeader, Panel, Duration, AbsentList, Explain, Cite, ReadFailures } from "../_components/health-ui";

// CPR-PD-008B — AVAILABILITY & PERFORMANCE.
//
// ⚠ THE GUARD IS ON THE PAGE, NOT ONLY ON THE LAYOUT (CPR-PD-001 s7).
//
// ⚠ THIS IS THE PAGE THE SPEC LEADS WITH AND THE ONE WITH NOTHING BEHIND IT. Availability, Apdex, P95
// and objectives all need per-request timing for the product's own requests, and no request is timed
// anywhere. The page renders the shape the comp draws with every figure refused, so that when a producer
// arrives the shape is already here for it to land in.

export const dynamic = "force-dynamic";

export default async function Page() {
  await requireHqCapability("hq.practice.health.view");
  const admin = await createAdminClient();
  const h = await loadPdHealth(admin);

  return (
    <div className="flex flex-col gap-4">
      <HealthHeader
        title="Availability & Performance"
        spec="CPR-PD-008B"
        purpose="Availability, latency, responsiveness and performance objectives."
        readAt={h.readAt}
        windowDays={h.windowDays}
      />

      <div className="rounded-xl border border-[var(--cmp-color-warning)] bg-[var(--cmp-surface-warning)] p-4">
        <p className="text-[13px] font-bold text-[var(--cmp-text-warning)]">
          Nothing measures whether Competen Practice was up, or how long it took.
        </p>
        <p className="mt-1.5 max-w-4xl text-[12px] leading-relaxed text-gray-800">
          There is no uptime probe, no health-check record, no request log and no synthetic monitor in
          this product. Every figure on this page needs one of those, so every figure is refused rather
          than estimated. An availability number here would be chosen, not observed — and it is the one
          number on the whole workspace a reader would most reasonably trust without checking.
        </p>
        <Explain summary="What would have to exist, at minimum">
          One of two things. Either a probe that calls a known endpoint on a schedule and records the
          outcome and the round trip — which gives availability and a latency distribution immediately —
          or per-request timing on the product&apos;s own routes, which gives the same plus a true error
          rate because it also counts the attempts. The second is more work and answers more; the first
          could be running this week and would light four of the refusals below.
        </Explain>
      </div>

      <ReadFailures problems={h.problems} />

      <Panel
        title="The one latency this product does record, and why it is not on this page's subject"
        note="Shown here so the distinction is explicit rather than left for a reader to discover on the AI page."
      >
        <div className="grid gap-2 sm:grid-cols-2">
          <Duration label="AI provider latency (P95)" f={h.ai.latencyP95} />
        </div>
        <p className="mt-2 text-[12px] leading-relaxed text-gray-700">
          This is the round trip to an AI provider. It is real, and it is a different population from the
          requests a practitioner waits on: a page that never calls the AI service contributes nothing to
          it. Presenting it as the product&apos;s P95 would be the precise error §8B is asking to avoid.
        </p>
        <Cite>plat_ai_requests.latency_ms — the only latency column in the schema</Cite>
      </Panel>

      <Panel title="What this page would show, and what each one needs">
        <AbsentList items={[
          HEALTH_REFUSALS.availability(),
          HEALTH_REFUSALS.apdex(),
          HEALTH_REFUSALS.requestLatency(),
          HEALTH_REFUSALS.slo(),
          HEALTH_REFUSALS.errorRate(),
        ]} />
      </Panel>
    </div>
  );
}
