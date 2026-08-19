import { createAdminClient } from "@/lib/supabase/server";
import { requireHqCapability } from "@/lib/hq/context";
import { loadPdHealth, HEALTH_REFUSALS } from "@/lib/hq/pd-health";
import { HealthHeader, Panel, Stat, AbsentList, ReadFailures, Explain, Cite } from "../_components/health-ui";

// CPR-PD-008J — HEALTH HISTORY.
//
// ⚠ THE GUARD IS ON THE PAGE, NOT ONLY ON THE LAYOUT (CPR-PD-001 s7).
//
// ⚠ HISTORY IS A SERIES OF PAST HEALTH STATES, AND NO HEALTH STATE HAS EVER BEEN COMPUTED OR STORED.
// So there is nothing to look back over, and this page does not pretend otherwise. What it can do is
// show the change context §8J asks for — the deployments in the window — and say plainly that the three
// logs are timestamped and could be trended individually the day someone wants that.

export const dynamic = "force-dynamic";

export default async function Page() {
  await requireHqCapability("hq.practice.health.view");
  const admin = await createAdminClient();
  const h = await loadPdHealth(admin);

  return (
    <div className="flex flex-col gap-4">
      <HealthHeader
        title="Health History"
        spec="CPR-PD-008J"
        purpose="Historical health, degradations, objective trends and release correlations."
        readAt={h.readAt}
        windowDays={h.windowDays}
      />

      <div className="rounded-xl border border-[var(--cmp-color-warning)] bg-[var(--cmp-surface-warning)] p-4">
        <p className="text-[13px] font-bold text-[var(--cmp-text-warning)]">
          There is no health history, because no health state has ever been stored.
        </p>
        <p className="mt-1.5 max-w-4xl text-[12px] leading-relaxed text-gray-800">
          A history is a series of past states. This module computes its state at request time from live
          logs and stores nothing, so there is no earlier state to compare against — not an empty chart,
          but an absent one. The logs themselves are timestamped and could be trended; what cannot be
          reconstructed is what &ldquo;healthy&rdquo; was judged to be on any past day, because it was
          never judged.
        </p>
      </div>

      <ReadFailures problems={h.problems} />

      <Panel
        title="Change context in the window"
        note="§8J asks for release correlation. The deployments are real; the correlation is a reader's to make, not this page's to assert."
      >
        <div className="grid gap-2 sm:grid-cols-3">
          <Stat label="Deployments in window" f={h.deployments.inWindow} />
          <Stat label="Platform events" f={h.events.total} />
          <Stat label="Job runs" f={h.jobs.runs} />
        </div>

        {h.deployments.rows.length === 0 ? (
          <p className="mt-3 text-[12px] leading-relaxed text-gray-600">
            No deployment was recorded in the last {h.windowDays} days. ⚠ That is a statement about the
            deployment LOG, not about whether anything shipped — a release that nobody recorded leaves no
            row, and this page cannot tell the two apart.
          </p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="border-b border-gray-200 text-left text-[10px] font-bold uppercase tracking-wider text-gray-500">
                  <th className="py-1.5 pr-3">Version</th>
                  <th className="py-1.5 pr-3">Channel</th>
                  <th className="py-1.5 pr-3">Status</th>
                  <th className="py-1.5">Released</th>
                </tr>
              </thead>
              <tbody>
                {h.deployments.rows.map((d, i) => (
                  <tr key={`${d.version}-${i}`} className="border-b border-gray-100 last:border-0">
                    <td className="py-1.5 pr-3 font-medium text-gray-800">{d.version ?? "—"}</td>
                    <td className="py-1.5 pr-3 text-gray-600">{d.channel ?? "—"}</td>
                    <td className="py-1.5 pr-3 text-gray-600">{d.status ?? "—"}</td>
                    <td className="py-1.5 font-mono text-[11px] text-gray-500">
                      {d.released_at ? new Date(d.released_at).toISOString().slice(0, 10) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <Explain summary="Why no correlation is drawn between these and anything else">
          Correlating a change with a degradation needs a degradation to correlate it to, and this product
          records none. Drawing a deployment marker across a chart of job failures would suggest a
          relationship the data cannot support — and with zero failures in the window it would suggest one
          that certainly is not there.
          <Cite>plat_deployments.released_at, within the module window</Cite>
        </Explain>
      </Panel>

      <Panel title="What a real history would need">
        <AbsentList items={[
          HEALTH_REFUSALS.history(),
          HEALTH_REFUSALS.degradations(),
          HEALTH_REFUSALS.slo(),
          HEALTH_REFUSALS.availability(),
        ]} />
      </Panel>
    </div>
  );
}
