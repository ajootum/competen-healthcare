import { createAdminClient } from "@/lib/supabase/server";
import { requireHqCapability } from "@/lib/hq/context";
import {
  loadPdHealth, HEALTH_SUBMODULES, HEALTH_REFUSALS, PLANE_REFUSED,
  HEALTH_HEADLINE, HEALTH_HEADLINE_BODY,
} from "@/lib/hq/pd-health";
import {
  HealthHeader, Panel, Stat, Duration, Share, SampleNote, AbsentList, PlaneRefusal,
  SubmoduleGrid, ReadFailures, Explain, Cite,
} from "./_components/health-ui";

// CPR-PD-008 §1–4 — PRODUCT HEALTH, the overview.
//
// ⚠ THE GUARD IS ON THE PAGE, NOT ONLY ON THE LAYOUT (CPR-PD-001 s7: "a hidden navigation item does not
// constitute authorization"; Next's authentication guide: a layout check is not sufficient because
// layouts do not re-render on navigation). The await resolves before any JSX is returned, so an
// unauthorized direct URL is redirected without rendering anything.
//
// ⚠ THE HEADLINE BANNER LEADS, AND THE TILES FOLLOW IT AS EVIDENCE. Product Configuration's rework
// established this order: a reader given eight figures and then told what they mean has to assemble the
// point; a reader told the point first reads the figures as support for it.

export const dynamic = "force-dynamic";

export default async function Page() {
  await requireHqCapability("hq.practice.health.view");
  const admin = await createAdminClient();
  const h = await loadPdHealth(admin);

  return (
    <div className="flex flex-col gap-4">
      <HealthHeader
        title="Health Overview"
        spec="CPR-PD-008 §1–4"
        purpose="Whether Competen Practice and its critical practitioner journeys are working well enough to depend on right now."
        readAt={h.readAt}
        windowDays={h.windowDays}
      />

      <div className="rounded-xl border border-[var(--cmp-color-warning)] bg-[var(--cmp-surface-warning)] p-4">
        <p className="text-[13px] font-bold text-[var(--cmp-text-warning)]">{HEALTH_HEADLINE}</p>
        <p className="mt-1.5 max-w-4xl text-[12px] leading-relaxed text-gray-800">{HEALTH_HEADLINE_BODY}</p>
        <Explain summary="Why that distinction is the whole module, and not a caveat">
          The figures below are true, and every one of them is about the platform&apos;s own machinery:
          calls to an AI provider, background jobs, and a platform event log. None of them observes a
          practitioner opening the Planner or saving an encounter. Reading &ldquo;jobs all succeeded&rdquo;
          as &ldquo;Practice is healthy&rdquo; is the single most available mistake on this screen, which
          is why each tile is labelled with what it actually measures.
          <Cite>
            plat_ai_requests, plat_job_runs, plat_platform_events, plat_deployments — the only four tables
            this module reads, all on the platform plane
          </Cite>
        </Explain>
      </div>

      <ReadFailures problems={h.problems} />

      <Panel
        title="What is measured today"
        note="Counted over the same window, from complete logs. Each figure names the machinery it measures."
      >
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="AI requests" f={h.ai.requests} />
          <Stat label="AI errors" f={h.ai.failures} />
          <Stat label="Job runs" f={h.jobs.runs} />
          <Stat label="Job failures" f={h.jobs.failures} />
          <Stat label="Platform events" f={h.events.total} />
          <Stat label="Critical events" f={h.events.critical} />
          <Stat label="Warning events" f={h.events.warning} />
          <Stat label="Jobs tracked" f={h.jobs.tracked} />
        </div>
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          <Duration label="AI latency (P95)" f={h.ai.latencyP95} />
          <Duration label="Job duration (P95)" f={h.jobs.durationP95} />
          <Share label="AI error share" f={h.ai.failureShare} of="all AI requests in the window" />
        </div>
        <div className="mt-3 flex flex-col gap-1">
          <SampleNote sample={h.ai.sample} what="AI latency" />
          <SampleNote sample={h.jobs.sample} what="Job duration" />
        </div>
      </Panel>

      <Panel title="The ten sub-surfaces, and what each can show" note="CPR-PD-008A–J. The chip is the state of the DATA, not of the page.">
        <SubmoduleGrid items={HEALTH_SUBMODULES} />
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel
          title="What PD-008 asks for and this schema cannot answer"
          note="Named rather than left as an empty chart. Each is a fact that does not exist, not a query nobody wrote."
        >
          <AbsentList items={[
            HEALTH_REFUSALS.availability(),
            HEALTH_REFUSALS.requestLatency(),
            HEALTH_REFUSALS.errorRate(),
            HEALTH_REFUSALS.journeys(),
            HEALTH_REFUSALS.degradations(),
            HEALTH_REFUSALS.slo(),
          ]} />
        </Panel>

        <div className="flex flex-col gap-3">
          {PLANE_REFUSED.map(r => (
            <PlaneRefusal key={r.what} what={r.what} tables={r.tables} why={r.why} />
          ))}
        </div>
      </div>
    </div>
  );
}
