import { createAdminClient } from "@/lib/supabase/server";
import { requireHqCapability } from "@/lib/hq/context";
import {
  loadPdHealth, HEALTH_SUBMODULES, HEALTH_REFUSALS, PLANE_REFUSED,
  HEALTH_HEADLINE, HEALTH_HEADLINE_BODY,
  healthDomains, attentionSignals, freshnessOf, overallHealth, coverageTally, loadJourneyHealth,
} from "@/lib/hq/pd-health";
import { loadOpenIncidents } from "@/lib/hq/mos-incident";
import {
  HealthHeader, Panel, Stat, Duration, Share, SampleNote, AbsentList, PlaneRefusal,
  SubmoduleGrid, ReadFailures, Explain, Cite,
  OverallHealth, DomainTile, NeedsAttention, JourneyRail, RecentChanges, FooterMeta, CoverageDrawer,
} from "./_components/health-ui";

// CPR-PD-008 §3 — HEALTH OVERVIEW, as the command surface the specification defines.
//
// ⚠ THE GUARD IS ON THE PAGE, NOT ONLY ON THE LAYOUT (CPR-PD-001 s7: "a hidden navigation item does not
// constitute authorization"; Next's authentication guide: a layout check is not sufficient because
// layouts do not re-render on navigation).
//
// ⚠ THE COMP'S SHAPES, NEVER ITS NUMBERS — and the specification settles the argument rather than the
// doctrine having to. s1: "Retain the current Product Health information architecture... The present
// screen is a valid transitional observability state because it distinguishes measured, partly measured,
// not measured and unreadable evidence." So this rebuild adopts the approved LAYOUT (regions A-H) and
// leaves every verdict where the evidence puts it.
//
// ⚠ AND s12 DECIDED WHERE THE PROSE WENT: "Technical schema/allowlist explanations must not dominate the
// normal Product Director view." s11 names the destination — an instrumentation/coverage drawer. The
// first viewport now answers s12's three questions and nothing else; the explanations are one click
// away, not deleted.

export const dynamic = "force-dynamic";

export default async function Page() {
  await requireHqCapability("hq.practice.health.view");
  const admin = await createAdminClient();
  const [h, journeys, incidents] = await Promise.all([
    loadPdHealth(admin), loadJourneyHealth(admin), loadOpenIncidents(admin),
  ]);

  const domains = healthDomains(h, journeys);
  const overall = overallHealth(domains);
  const tally = coverageTally(domains);
  const signals = attentionSignals(h, incidents);
  const freshness = freshnessOf(h);

  return (
    <div className="flex flex-col gap-4">
      <HealthHeader
        title="Health Overview"
        spec="CPR-PD-008 §3"
        purpose="Is Competen Practice dependable right now, what needs attention, and are the critical practitioner journeys working?"
        readAt={h.readAt}
        windowDays={h.windowDays}
      />

      <ReadFailures problems={h.problems} />

      {/* ── s12's first viewport: the verdict, then what needs attention ───────────────────────── */}
      <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
        <OverallHealth
          overall={overall}
          tally={tally}
          gatingCount={domains.filter(d => d.gating).length}
          freshness={freshness}
          windowDays={h.windowDays}
        />
        <NeedsAttention signals={signals} />
      </div>

      {/* ── region B: the nine domains ─────────────────────────────────────────────────────────── */}
      <Panel
        title="Health domains"
        note="Each carries two independent facts: what evidence exists, and what that evidence says about the product."
      >
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          {domains.map(d => <DomainTile key={d.key} d={d} />)}
        </div>
        <Explain summary="Why a measured domain can still read Unknown">
          §4 defines Healthy as evidence MEETING a defined objective. AI Health is fully instrumented and
          still reads Unknown, because this product declares no target availability, no latency budget and
          no error budget — so there is no threshold its latency could have passed. Coverage and health
          are separate axes on purpose: collapsing them would either hide that AI is measured, or promote
          a number to Healthy against a threshold nobody agreed.
        </Explain>
      </Panel>

      {/* ── region D: the eight critical journeys ──────────────────────────────────────────────── */}
      <Panel
        title="Critical journeys"
        note="CPR-PD-008 §6. Workflow Health is the primary product-health differentiator, and it is the module's largest gap."
      >
        <JourneyRail journeys={journeys ?? []} />
        <p className="mt-3 text-[11.5px] leading-relaxed text-gray-600">
          A card showing figures emits an attempt and exactly one outcome, so its rate divides successes
          by attempts rather than being inferred from a failure count. A card reading &ldquo;not
          instrumented&rdquo; emits nothing at all and names the minimum outcome §6 asks it to record —
          that gap is instrumentation, not a query nobody wrote. ⚠ Every card still reads Unknown as a
          STATE, measured or not, because §4 judges health against an objective and none is configured.
        </p>
      </Panel>

      {/* ── regions E, F, G: the evidence that does exist ──────────────────────────────────────── */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title="Availability & Performance" note="§3 region E. Neither figure exists for Competen Practice.">
          <div className="grid gap-2">
            <Duration
              label="AI provider latency (P95)"
              f={h.ai.latencyP95}
              explain={
                <Explain summary="Why this is not the product's P95">
                  It is the round trip to an AI provider. A page that never calls the AI service
                  contributes nothing to it, so presenting it as the product&apos;s responsiveness would
                  answer a different question. §8 is explicit: do not use background machinery as
                  availability.
                  <Cite>plat_ai_requests.latency_ms — the only latency column in the schema</Cite>
                </Explain>
              }
            />
            <AbsentList items={[HEALTH_REFUSALS.availability(), HEALTH_REFUSALS.requestLatency()]} />
          </div>
        </Panel>

        <Panel title="Errors & Failures" note="§3 region F. Real counts, and no product rate — the denominator is the missing half.">
          <div className="grid gap-2 sm:grid-cols-2">
            <Stat label="AI errors" f={h.ai.failures} />
            <Stat label="Job failures" f={h.jobs.failures} />
            <Stat label="Critical events" f={h.events.critical} />
            <Stat label="Warning events" f={h.events.warning} />
          </div>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <Share label="AI error share" f={h.ai.failureShare} of="all AI requests in the window" />
            <Share label="Job failure share" f={h.jobs.failureShare} of="all job runs in the window" />
          </div>
        </Panel>

        <RecentChanges rows={h.deployments.rows} windowDays={h.windowDays} />
      </div>

      {/* ── the ten diagnostic sub-surfaces (§2), kept as the spec instructs ───────────────────── */}
      <Panel title="Diagnostic sub-surfaces" note="§2's ten surfaces. The chip is the state of the EVIDENCE, not of the page.">
        <SubmoduleGrid items={HEALTH_SUBMODULES} />
      </Panel>

      {/* ── §11's instrumentation drawer: everything that used to be in the first viewport ─────── */}
      <CoverageDrawer>
        <div className="rounded-xl border border-[var(--cmp-color-warning)] bg-[var(--cmp-surface-warning)] p-4">
          <p className="text-[13px] font-bold text-[var(--cmp-text-warning)]">{HEALTH_HEADLINE}</p>
          <p className="mt-1.5 max-w-4xl text-[12px] leading-relaxed text-gray-800">{HEALTH_HEADLINE_BODY}</p>
          <Cite>
            plat_ai_requests, plat_job_runs, plat_platform_events, plat_deployments — the only four tables
            this module reads, all on the platform plane
          </Cite>
        </div>

        <Panel title="What is measured today" note="Counted over the same window, from complete logs.">
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="AI requests" f={h.ai.requests} />
            <Stat label="AI refusals" f={h.ai.refusals} />
            <Stat label="Job runs" f={h.jobs.runs} />
            <Stat label="Jobs tracked" f={h.jobs.tracked} />
            <Stat label="Platform events" f={h.events.total} />
            <Stat label="Still running" f={h.jobs.running} />
            <Duration label="Job duration (P95)" f={h.jobs.durationP95} />
            <Stat label="Deployments" f={h.deployments.inWindow} />
          </div>
          <div className="mt-3 flex flex-col gap-1">
            <SampleNote sample={h.ai.sample} what="AI latency" />
            <SampleNote sample={h.jobs.sample} what="Job duration" />
          </div>
        </Panel>

        <Panel title="What §8 asks for and this schema cannot answer">
          <AbsentList items={[
            HEALTH_REFUSALS.availability(),
            HEALTH_REFUSALS.apdex(),
            HEALTH_REFUSALS.requestLatency(),
            HEALTH_REFUSALS.errorRate(),
            HEALTH_REFUSALS.journeys(),
            HEALTH_REFUSALS.degradations(),
            HEALTH_REFUSALS.slo(),
            HEALTH_REFUSALS.integrations(),
            HEALTH_REFUSALS.security(),
            HEALTH_REFUSALS.history(),
          ]} />
        </Panel>

        {PLANE_REFUSED.map(r => (
          <PlaneRefusal key={r.what} what={r.what} tables={r.tables} why={r.why} />
        ))}
      </CoverageDrawer>

      <FooterMeta freshness={freshness} windowDays={h.windowDays} />
    </div>
  );
}
