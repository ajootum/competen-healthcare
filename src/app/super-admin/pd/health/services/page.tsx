import { createAdminClient } from "@/lib/supabase/server";
import { requireHqCapability } from "@/lib/hq/context";
import { loadPdHealth, HEALTH_REFUSALS } from "@/lib/hq/pd-health";
import {
  HealthHeader, Panel, Stat, Duration, Share, SampleNote, AbsentList, ReadFailures, Explain, Cite,
} from "../_components/health-ui";

// CPR-PD-008A — SERVICES & COMPONENTS.
//
// ⚠ THE GUARD IS ON THE PAGE, NOT ONLY ON THE LAYOUT (CPR-PD-001 s7).
//
// ⚠ AND THE COMPONENT INVENTORY IS THE JOBS, NOT THE SERVICES. PD-008A asks for the health of
// application services and their dependencies. What is instrumented is the background job runner. Those
// jobs ARE components and their standing is real; they are not the request path, and the page says so
// rather than letting a green table imply the product is up.

export const dynamic = "force-dynamic";

export default async function Page() {
  await requireHqCapability("hq.practice.health.view");
  const admin = await createAdminClient();
  const h = await loadPdHealth(admin);

  return (
    <div className="flex flex-col gap-4">
      <HealthHeader
        title="Services & Components"
        spec="CPR-PD-008A"
        purpose="Health of application services, dependencies and critical components."
        readAt={h.readAt}
        windowDays={h.windowDays}
      />

      <div className="rounded-xl border border-[var(--cmp-color-warning)] bg-[var(--cmp-surface-warning)] p-4">
        <p className="text-[13px] font-bold text-[var(--cmp-text-warning)]">
          The components this page can see are background jobs. The request path is not instrumented.
        </p>
        <p className="mt-1.5 max-w-4xl text-[12px] leading-relaxed text-gray-800">
          Every named job below reports its runs, its failures and how long it takes, and that is a real
          measure of real components. None of them is the path a practitioner waits on. A table of healthy
          jobs is evidence that scheduled work is running — never evidence that Competen Practice is
          serving requests.
        </p>
      </div>

      <ReadFailures problems={h.problems} />

      <Panel title="The job runner" note="Counted over the whole window from one complete log.">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Runs" f={h.jobs.runs} />
          <Stat label="Failures" f={h.jobs.failures} />
          <Stat label="Still running" f={h.jobs.running} />
          <Stat label="Jobs tracked" f={h.jobs.tracked} />
        </div>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <Duration
            label="Duration (P95)"
            f={h.jobs.durationP95}
            explain={
              <Explain summary="What this percentile was computed over">
                Nearest-rank across {h.jobs.durationsCounted.toLocaleString("en-GB")} finished runs. ⚠ A
                run still in flight has no duration and is excluded rather than counted as zero, which
                would drag the percentile down exactly when the system is slowest.
                <Cite>plat_job_runs.duration_ms, over rows whose status is not running</Cite>
              </Explain>
            }
          />
          <Share label="Failure share" f={h.jobs.failureShare} of="all job runs in the window" />
        </div>
        <div className="mt-3"><SampleNote sample={h.jobs.sample} what="Duration and the per-job table" /></div>
      </Panel>

      <Panel title="By component" note="Ordered by failures first, then by volume: what needs attention reads first.">
        {h.jobs.perJob.length === 0 ? (
          <p className="text-[12px] text-gray-500">
            No job runs were readable in this window. That is not the same as no job runs.
          </p>
        ) : (
          <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Scrollable table">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="border-b border-gray-200 text-left text-[10px] font-bold uppercase tracking-wider text-gray-400">
                  <th className="py-1.5 pr-3">Component</th>
                  <th className="py-1.5 pr-3 text-right">Runs</th>
                  <th className="py-1.5 pr-3 text-right">Failed</th>
                  <th className="py-1.5 text-right">Duration P95</th>
                </tr>
              </thead>
              <tbody>
                {h.jobs.perJob.map(j => (
                  <tr key={j.key} className="border-b border-gray-100 last:border-0">
                    <td className="py-1.5 pr-3 font-medium text-gray-800">{j.key}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums text-gray-700">{j.runs.toLocaleString("en-GB")}</td>
                    <td className={`py-1.5 pr-3 text-right tabular-nums ${j.failed > 0 ? "font-semibold text-[var(--cmp-text-warning)]" : "text-gray-400"}`}>
                      {j.failed.toLocaleString("en-GB")}
                    </td>
                    <td className="py-1.5 text-right tabular-nums text-gray-700">
                      {j.p95 === null ? <span className="text-gray-400">no finished run</span>
                        : j.p95 >= 1000 ? `${(j.p95 / 1000).toFixed(2)}s` : `${Math.round(j.p95)}ms`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-2 text-[11px] leading-relaxed text-gray-500">
          Runs and failures in this table come from the sampled rows, so a job that ran only outside the
          sample will not appear. The headline counts above are over the whole window.
        </p>
      </Panel>

      <Panel title="What a service inventory would need that this does not have">
        <AbsentList items={[
          HEALTH_REFUSALS.availability(),
          HEALTH_REFUSALS.requestLatency(),
          HEALTH_REFUSALS.integrations(),
          HEALTH_REFUSALS.slo(),
        ]} />
      </Panel>
    </div>
  );
}
