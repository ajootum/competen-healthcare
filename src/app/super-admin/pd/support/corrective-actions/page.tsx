import { createAdminClient } from "@/lib/supabase/server";
import { requireHqCapability } from "@/lib/hq/context";
import {
  loadActions, tally,
  ACTION_STATE_LABEL, ACTION_ORDER, ACTION_SOURCE_LABEL,
  PRIORITY_LABEL, PRIORITY_ORDER,
} from "@/lib/hq/mos-support";
import {
  SupportHeader, Panel, PriorityChip, StatusChip, Distribution, Field,
  NoIntakeBanner, EmptyOrUnreadable, Truncated, Caveat, Explain, Cite,
} from "../_components/support-ui";

// CPR-PD-009 §14 — CORRECTIVE ACTIONS.
//
// ⚠ THE GUARD IS ON THE PAGE, NOT ONLY ON THE LAYOUT (CPR-PD-001 s7).
//
// ⚠ ACCEPTED RISK IS SHOWN AS ITS OWN OUTCOME AND NEVER FOLDED INTO "DONE". §14 requires a named
// authority and a written rationale before an action may be closed that way, precisely so it cannot be
// used as a quiet close. The database refuses one without both. Counting it as done on the screen would
// undo the constraint at the last step — the number a Director reads is the number that matters, and
// "12 done" reading as twelve fixes when three were accepted risks is exactly the misreport §14 exists
// to prevent.
//
// ⚠ AND OVERDUE IS A DATE COMPARISON, NOT A CLOCK ONE. due_on is a date, so an action due today is not
// late; comparing it to a timestamp would mark everything overdue from one minute past midnight.

export const dynamic = "force-dynamic";

const SOURCE_KEYS = Object.keys(ACTION_SOURCE_LABEL);

export default async function Page() {
  await requireHqCapability("hq.practice.support.view");
  const admin = await createAdminClient();
  const read = await loadActions(admin);
  const rows = read?.rows ?? [];
  const open = rows.filter(a => a.isOpen);
  const overdue = rows.filter(a => a.overdue);
  const acceptedRisk = rows.filter(a => a.state === "accepted_risk");
  const openNoDue = open.filter(a => a.dueOn === null);

  return (
    <div className="flex flex-col gap-4">
      <SupportHeader
        title="Corrective Actions"
        spec="CPR-PD-009 §14"
        purpose="What was promised after an incident or a problem, who owns it, when it is due, and whether it happened."
        readAt={new Date().toISOString()}
      />

      <NoIntakeBanner what="Corrective actions" metric="sup.corrective_actions" />

      <EmptyOrUnreadable rows={read === null ? null : rows} what="corrective action" />

      {read !== null && (
        <>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-lg border border-gray-200 bg-white px-3 py-2.5">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">Open actions</p>
              <p className="mt-0.5 text-[22px] font-bold leading-none tabular-nums text-gray-900">{open.length}</p>
              <p className="mt-1 text-[11px] text-gray-500">of {rows.length} recorded</p>
            </div>
            <div className="rounded-lg border border-gray-200 bg-white px-3 py-2.5">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">Overdue</p>
              <p className={`mt-0.5 text-[22px] font-bold leading-none tabular-nums ${
                overdue.length > 0 ? "text-[var(--cmp-text-warning)]" : "text-gray-900"}`}>
                {overdue.length}
              </p>
              <Caveat metric="sup.corrective_actions" />
            </div>
            <div className="rounded-lg border border-gray-200 bg-white px-3 py-2.5">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">Closed as accepted risk</p>
              <p className="mt-0.5 text-[22px] font-bold leading-none tabular-nums text-gray-900">{acceptedRisk.length}</p>
              <p className="mt-1 text-[11px] leading-relaxed text-gray-500">
                Shown apart from &ldquo;done&rdquo;. Each names an authority and a rationale, or the
                database refused it.
              </p>
            </div>
            <div className="rounded-lg border border-gray-200 bg-white px-3 py-2.5">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">Open with no due date</p>
              <p className="mt-0.5 text-[22px] font-bold leading-none tabular-nums text-gray-900">{openNoDue.length}</p>
              <p className="mt-1 text-[11px] leading-relaxed text-gray-500">
                ⚠ Invisible to the overdue count for ever. §14 forces a due date on P1 and P2, so none
                of these is high priority.
              </p>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Panel title="By state (§14)" note="Accepted risk sits beside done, never inside it.">
              <Distribution items={tally(rows, a => a.state, ACTION_ORDER, ACTION_STATE_LABEL)} total={rows.length} />
              <Explain summary="Why accepted risk is not counted as done">
                §14 makes accepted risk require a named authority and a written rationale so it cannot
                be a quiet way to close something. Merging it into &ldquo;done&rdquo; on the screen
                would spend that constraint at the last possible moment: a Director reading
                &ldquo;12 done&rdquo; would take it for twelve fixes.
                <Cite>mos_corrective_action.state with mos_action_accepted_risk_is_authorized</Cite>
              </Explain>
            </Panel>
            <Panel title="By where it came from (§14)" note="An action arises from an incident, a problem, a postmortem or a governance review.">
              <Distribution items={tally(rows, a => a.source, SOURCE_KEYS, ACTION_SOURCE_LABEL)} total={rows.length} />
            </Panel>
          </div>

          {rows.length > 0 && (
            <Panel title="The action estate" note="Overdue first, then newest.">
              <ul className="flex flex-col divide-y divide-gray-100">
                {[...rows].sort((a, b) => Number(b.overdue) - Number(a.overdue)).map(a => (
                  <li key={a.actionId} className="py-3 first:pt-0 last:pb-0">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <p className="min-w-0 text-[12.5px] font-semibold text-gray-900">{a.action}</p>
                      <span className="flex shrink-0 items-center gap-1.5">
                        <PriorityChip label={PRIORITY_LABEL[a.priority] ?? a.priority} />
                        <StatusChip label={ACTION_STATE_LABEL[a.state] ?? a.state} />
                      </span>
                    </div>
                    <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                      <Field label="Owner" value={a.ownerName} />
                      <Field label="From" value={ACTION_SOURCE_LABEL[a.source] ?? a.source} />
                      <Field label="Due" value={a.dueOn} warnWhenEmpty={a.isOpen} />
                      <Field label="Change" value={a.changeRef} />
                    </div>
                    {a.overdue && (
                      <p className="mt-1.5 text-[11.5px] font-semibold text-[var(--cmp-text-warning)]">
                        {a.daysLate} day{a.daysLate === 1 ? "" : "s"} past its due date.
                      </p>
                    )}
                    {a.blocker && (
                      <p className="mt-1 text-[11.5px] leading-relaxed text-gray-600">
                        <span className="font-semibold text-gray-700">Blocked by:</span> {a.blocker}
                      </p>
                    )}
                    {a.state === "accepted_risk" && (
                      <p className="mt-1 rounded border border-amber-300 bg-amber-50 px-2 py-1.5 text-[11.5px] leading-relaxed text-amber-900">
                        <span className="font-semibold">Accepted by {a.acceptedBy}:</span> {a.acceptedRationale}
                      </p>
                    )}
                    {a.effectiveness && (
                      <p className="mt-1 text-[11.5px] leading-relaxed text-gray-600">
                        <span className="font-semibold text-gray-700">Effectiveness:</span> {a.effectiveness}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
              <Truncated truncated={read.truncated} what="corrective actions" />
            </Panel>
          )}
        </>
      )}
    </div>
  );
}
