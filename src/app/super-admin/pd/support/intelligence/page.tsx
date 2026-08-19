import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/server";
import { requireHqCapability } from "@/lib/hq/context";
import { loadAllIncidents, SEVERITY_LABEL, TERMINAL_STATUSES } from "@/lib/hq/mos-incident";
import {
  loadCases, loadProblems, loadActions, median, tally,
  CASE_SOURCE_LABEL, ACTION_STATE_LABEL, ACTION_ORDER,
} from "@/lib/hq/mos-support";
import { absenceSentence } from "@/lib/hq/pd-metric-registry";
import {
  SupportHeader, Panel, Distribution, AbsentList, ReadFailures,
  Caveat, Explain, Cite, AbsentValue,
} from "../_components/support-ui";

// CPR-PD-009 §11 — SUPPORT INTELLIGENCE.
//
// ⚠ THE GUARD IS ON THE PAGE, NOT ONLY ON THE LAYOUT (CPR-PD-001 s7).
//
// ⚠ THIS PAGE COMPOSES, IT DOES NOT MEASURE. Every figure here comes from a store another submodule
// owns. That is deliberate: a second surface computing "open cases" its own way is how two screens in
// one module come to disagree, and the disagreement is always discovered by the person being asked to
// explain it in a meeting.
//
// ⚠ AND EVERY TREND IS REFUSED. §11 asks for direction over time — is resolution getting faster, are
// escalations rising. A trend needs two points and the estate has one: these tables were created on
// 2026-08-18 and nothing wrote to them before that. A line drawn through a single day is not a trend
// even when the arithmetic works.

export const dynamic = "force-dynamic";

export default async function Page() {
  await requireHqCapability("hq.practice.support.view");
  const admin = await createAdminClient();
  const [incidents, cases, problems, actions] = await Promise.all([
    loadAllIncidents(admin), loadCases(admin), loadProblems(admin), loadActions(admin),
  ]);

  const readProblems: string[] = [];
  if (incidents === null) readProblems.push("mos_incident: could not be read.");
  if (cases === null) readProblems.push("mos_support_case: could not be read.");
  if (problems === null) readProblems.push("mos_problem: could not be read.");
  if (actions === null) readProblems.push("mos_corrective_action: could not be read.");

  // §11's resolution time — derivable, and computed only over incidents that actually reached a
  // terminal state. ⚠ An incident still open has no resolution time; treating "now" as its end would
  // make an unresolved outage look like a slow fix rather than an ongoing one.
  const resolved = (incidents ?? []).filter(i => TERMINAL_STATUSES.includes(i.status) && i.resolvedAt);
  const resolutionHours = resolved.map(i =>
    Math.max(0, Math.round((new Date(i.resolvedAt as string).getTime() - new Date(i.startedAt).getTime()) / 3_600_000)));
  const medianResolution = median(resolutionHours);

  const answered = (cases?.rows ?? []).filter(c => c.responseHours !== null);
  const medianResponse = median(answered.map(c => c.responseHours as number));

  const caseRows = cases?.rows ?? [];
  const actionRows = actions?.rows ?? [];
  const done = actionRows.filter(a => a.state === "done");
  const withEffectiveness = done.filter(a => a.effectiveness !== null);

  return (
    <div className="flex flex-col gap-4">
      <SupportHeader
        title="Support Intelligence"
        spec="CPR-PD-009 §11"
        purpose="What the support estate says over time — where failures cluster, how long they take, and whether the fixes worked."
        readAt={new Date().toISOString()}
      />

      <ReadFailures problems={readProblems} />

      <div className="rounded-xl border border-gray-200 bg-gray-50 p-3.5">
        <p className="text-[12.5px] font-bold text-gray-900">Every figure here is read from another submodule&apos;s store.</p>
        <p className="mt-1 max-w-4xl text-[11.5px] leading-relaxed text-gray-700">
          Nothing on this page is measured independently. A second surface computing &ldquo;open
          cases&rdquo; its own way is how two screens in one module come to disagree — and the
          disagreement always surfaces when somebody is asked to explain it.
        </p>
      </div>

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-lg border border-gray-200 bg-white px-3 py-2.5">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">Median incident resolution</p>
          {medianResolution === null ? (
            <>
              <p className="mt-0.5 text-[13px] font-semibold text-gray-500">No incident has resolved</p>
              <p className="mt-1 text-[11px] leading-relaxed text-gray-500">
                ⚠ Not &ldquo;0h&rdquo;. A median over nothing is not zero.
              </p>
            </>
          ) : (
            <>
              <p className="mt-0.5 text-[22px] font-bold leading-none tabular-nums text-gray-900">
                {medianResolution}<span className="ml-1 text-[12px] font-medium text-gray-500">h</span>
              </p>
              <p className="mt-1 text-[11px] text-gray-500">
                over {resolved.length} incident{resolved.length === 1 ? "" : "s"} that reached a terminal state
              </p>
            </>
          )}
        </div>

        <div className="rounded-lg border border-gray-200 bg-white px-3 py-2.5">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">Median first response</p>
          {medianResponse === null ? (
            <p className="mt-0.5 text-[13px] font-semibold text-gray-500">No case has been answered</p>
          ) : (
            <>
              <p className="mt-0.5 text-[22px] font-bold leading-none tabular-nums text-gray-900">
                {medianResponse}<span className="ml-1 text-[12px] font-medium text-gray-500">h</span>
              </p>
              <p className="mt-1 text-[11px] text-gray-500">over {answered.length} answered</p>
            </>
          )}
          <Caveat metric="sup.first_response" />
        </div>

        <div className="rounded-lg border border-gray-200 bg-white px-3 py-2.5">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">Action effectiveness recorded</p>
          <p className="mt-0.5 text-[22px] font-bold leading-none tabular-nums text-gray-900">
            {withEffectiveness.length}
          </p>
          <p className="mt-1 text-[11px] leading-relaxed text-gray-500">
            of {done.length} action{done.length === 1 ? "" : "s"} marked done. ⚠ &ldquo;Done&rdquo; means
            somebody did it; only this column says it worked.
          </p>
        </div>

        <div className="rounded-lg border border-gray-200 bg-white px-3 py-2.5">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">Recurrence rate</p>
          <AbsentValue why={absenceSentence("sup.postmortems_outstanding")} />
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Where cases come from (§11)" note="The reporting source, as recorded on each case.">
          {caseRows.length === 0 ? (
            <p className="text-[12px] leading-relaxed text-gray-600">
              No case has been recorded, so there is no distribution to show. A measured zero — and one
              that cannot move until an intake exists.
            </p>
          ) : (
            <Distribution
              items={tally(caseRows, c => c.source, Object.keys(CASE_SOURCE_LABEL), CASE_SOURCE_LABEL)}
              total={caseRows.length}
            />
          )}
        </Panel>

        <Panel title="Where corrective actions stand (§14)" note="Accepted risk is shown apart from done, as §14 requires.">
          {actionRows.length === 0 ? (
            <p className="text-[12px] leading-relaxed text-gray-600">
              No corrective action has been recorded.
            </p>
          ) : (
            <Distribution
              items={tally(actionRows, a => a.state, ACTION_ORDER, ACTION_STATE_LABEL)}
              total={actionRows.length}
            />
          )}
        </Panel>
      </div>

      <Panel title="Incidents by severity" note="Over every incident recorded, open and closed.">
        {incidents === null ? (
          <p className="text-[12px] leading-relaxed text-[var(--cmp-text-warning)]">
            ⚠ The incident store could not be read. That is not zero incidents.
          </p>
        ) : incidents.length === 0 ? (
          <p className="text-[12px] leading-relaxed text-gray-600">No incident has been recorded.</p>
        ) : (
          <Distribution
            items={(["sev1", "sev2", "sev3", "sev4", "informational"] as const).map(k => ({
              key: k, label: SEVERITY_LABEL[k], n: incidents.filter(i => i.severity === k).length,
            }))}
            total={incidents.length}
          />
        )}
      </Panel>

      <Panel
        title="What §11 asks for that cannot be answered yet"
        note="Each is a fact that is not recorded, not a query nobody has written."
      >
        <AbsentList items={[
          {
            label: "Any trend, of anything",
            why: "⚠ A TREND NEEDS TWO POINTS AND THIS ESTATE HAS ONE. These stores were created on 2026-08-18 and nothing wrote to them before that, so every series here is a single day. The arithmetic for a direction would run; the direction would be meaningless.",
          },
          {
            label: "Recurrence rate",
            why: "§11 asks how often a resolved problem comes back. That needs a rule saying a new incident IS a recurrence of an old problem, and the link table records only what somebody connected by hand.",
          },
          {
            label: "Response and resolution against target",
            why: absenceSentence("sup.response_target"),
          },
          {
            label: "Support load per practice",
            why: "Cases carry a practice, so the count is available — but a load figure implies a denominator (cases per practitioner, per session, per month of use) and none of those is expressible for a practice today. A bare count would rank the biggest practice first and call it the unhappiest.",
          },
        ]} />
        <Explain summary="Why a single-day trend is refused rather than drawn flat">
          A flat line is a claim: it says the measure was taken twice and did not move. Drawing one
          across a day the stores were created would be the same error as a rate over a truncated
          fetch — arithmetic that runs cleanly over data that cannot support it. The honest rendering
          of one point is one point.
          <Cite>migrations 315 and 318 — the incident and record stores, both created 2026-08-18</Cite>
        </Explain>
      </Panel>

      <Panel title="Where the failure evidence lives">
        <p className="text-[12px] leading-relaxed text-gray-700">
          This module owns response. The journey stages that fail, the attempt volumes and the
          durations behind them are read in{" "}
          <Link href="/super-admin/pd/health/workflows" className="font-semibold text-teal-700 hover:underline">
            Workflow Health
          </Link>
          , which is where detection lives and where the telemetry actually is. §0 keeps the two apart
          on purpose.
        </p>
      </Panel>
    </div>
  );
}
