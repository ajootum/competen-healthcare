import { createAdminClient } from "@/lib/supabase/server";
import { requireHqCapability } from "@/lib/hq/context";
import { loadPdHealth, HEALTH_REFUSALS } from "@/lib/hq/pd-health";
import { HealthHeader, Panel, Stat, Duration, AbsentList, ReadFailures, Explain, Cite } from "../_components/health-ui";

// CPR-PD-008F — INTEGRATIONS.
//
// ⚠ THE GUARD IS ON THE PAGE, NOT ONLY ON THE LAYOUT (CPR-PD-001 s7).
//
// ⚠ ONE DEPENDENCY HAS A SIGNAL AND THE REST HAVE NO REGISTER TO BE LISTED IN. Integration health needs
// two things: a list of what this product depends on, and a probe or a call log per entry. The AI
// provider has a call log. Nothing else has either, and there is no dependency register at all — so this
// page cannot even say how many integrations are unmeasured, which is stated rather than glossed.

export const dynamic = "force-dynamic";

export default async function Page() {
  await requireHqCapability("hq.practice.health.view");
  const admin = await createAdminClient();
  const h = await loadPdHealth(admin);

  return (
    <div className="flex flex-col gap-4">
      <HealthHeader
        title="Integrations"
        spec="CPR-PD-008F"
        purpose="External and internal dependency health and integration degradation."
        readAt={h.readAt}
        windowDays={h.windowDays}
      />

      <div className="rounded-xl border border-[var(--cmp-color-warning)] bg-[var(--cmp-surface-warning)] p-4">
        <p className="text-[13px] font-bold text-[var(--cmp-text-warning)]">
          There is no dependency register, so this page cannot say what it is not measuring.
        </p>
        <p className="mt-1.5 max-w-4xl text-[12px] leading-relaxed text-gray-800">
          One external dependency records its calls — the AI provider — and its standing is below. Every
          other dependency this product has is undeclared: no table lists what Competen Practice relies
          on, so there is no denominator for &ldquo;how many integrations are healthy&rdquo; and no list to
          show as unmeasured. A register is the first thing this page needs, before any probe.
        </p>
      </div>

      <ReadFailures problems={h.problems} />

      <Panel title="The one dependency with a call log" note="The AI provider, from the same log AI Health reads.">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Calls" f={h.ai.requests} />
          <Stat label="Errors" f={h.ai.failures} />
          <Stat label="Providers in use" f={h.ai.providers} />
          <Duration label="Latency (P95)" f={h.ai.latencyP95} />
        </div>
        <Explain summary="Why one provider in use is not the same as no fallback configured">
          This counts the providers that actually appear in the log over the window. A fallback that is
          configured and never needed contributes nothing to it, so a value of one is consistent both with
          a single-provider setup and with a healthy primary that never failed over. The configuration is
          the authority on what is available; this is the record of what was used.
          <Cite>plat_ai_requests.provider, distinct over the window</Cite>
        </Explain>
      </Panel>

      <Panel title="What §8F asks for">
        <AbsentList items={[
          HEALTH_REFUSALS.integrations(),
          HEALTH_REFUSALS.degradations(),
          HEALTH_REFUSALS.slo(),
        ]} />
      </Panel>
    </div>
  );
}
