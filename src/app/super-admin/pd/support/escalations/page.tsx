import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/server";
import { requireHqCapability } from "@/lib/hq/context";
import {
  loadEscalations, tally,
  ESCALATION_TRIGGER_LABEL, ESCALATION_STATUS_LABEL,
} from "@/lib/hq/mos-support";
import {
  SupportHeader, Panel, StatusChip, Distribution, Field,
  NoIntakeBanner, EmptyOrUnreadable, Truncated, Explain, Cite,
} from "../_components/support-ui";

// CPR-PD-009 §9 — ESCALATIONS.
//
// ⚠ THE GUARD IS ON THE PAGE, NOT ONLY ON THE LAYOUT (CPR-PD-001 s7).
//
// ⚠ AN ESCALATION HAS NO OWNER, AND THE OMISSION IS THE FEATURE. §9: "Escalation does not transfer
// incident ownership unless explicitly reassigned." So the schema gives it a TARGET TEAM and a
// REQUESTED ACTION and deliberately no owner column — escalating asks somebody to act, it does not hand
// them the incident. A screen showing an "owner" here would quietly undo that, and the commander would
// believe they had handed the problem on.
//
// ⚠ AND ONLY AN ESCALATION WITH A DUE DATE CAN BE LATE. Nothing without one is counted as overdue,
// which is stated on the screen rather than left for a reader to assume either way.

export const dynamic = "force-dynamic";

const TRIGGER_KEYS = Object.keys(ESCALATION_TRIGGER_LABEL);
const STATUS_KEYS = Object.keys(ESCALATION_STATUS_LABEL);

export default async function Page() {
  await requireHqCapability("hq.practice.support.view");
  const admin = await createAdminClient();
  const read = await loadEscalations(admin);
  const rows = read?.rows ?? [];
  const open = rows.filter(e => e.isOpen);
  const overdue = rows.filter(e => e.overdue);
  const openNoDue = open.filter(e => e.dueAt === null);

  return (
    <div className="flex flex-col gap-4">
      <SupportHeader
        title="Escalations"
        spec="CPR-PD-009 §9"
        purpose="What has been escalated, to whom, why, and what was asked for."
        readAt={new Date().toISOString()}
      />

      <NoIntakeBanner what="Escalations" metric="sup.escalations" />

      <EmptyOrUnreadable rows={read === null ? null : rows} what="escalation" />

      {read !== null && (
        <>
          <div className="grid gap-2 sm:grid-cols-3">
            <div className="rounded-lg border border-gray-200 bg-white px-3 py-2.5">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Open escalations</p>
              <p className="mt-0.5 text-[22px] font-bold leading-none tabular-nums text-gray-900">{open.length}</p>
              <p className="mt-1 text-[11px] text-gray-500">of {rows.length} recorded</p>
            </div>
            <div className="rounded-lg border border-gray-200 bg-white px-3 py-2.5">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Past their due time</p>
              <p className={`mt-0.5 text-[22px] font-bold leading-none tabular-nums ${
                overdue.length > 0 ? "text-[var(--cmp-text-warning)]" : "text-gray-900"}`}>
                {overdue.length}
              </p>
              <p className="mt-1 text-[11px] leading-relaxed text-gray-500">
                Counted over the {open.length - openNoDue.length} open escalation
                {open.length - openNoDue.length === 1 ? "" : "s"} that carry a due time.
              </p>
            </div>
            <div className="rounded-lg border border-gray-200 bg-white px-3 py-2.5">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Open with no due time</p>
              <p className="mt-0.5 text-[22px] font-bold leading-none tabular-nums text-gray-900">{openNoDue.length}</p>
              <p className="mt-1 text-[11px] leading-relaxed text-gray-500">
                ⚠ These can never appear as overdue. Not a fault of the count — a gap in the record.
              </p>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Panel title="By trigger (§9)" note="The eight triggers §9 names, as a vocabulary rather than free text.">
              <Distribution items={tally(rows, e => e.trigger, TRIGGER_KEYS, ESCALATION_TRIGGER_LABEL)} total={rows.length} />
              <Explain summary="Why the trigger is a constrained list and not a sentence">
                §9 names eight reasons an escalation happens. Stored as free text they cannot be
                counted, so nobody could ever answer &ldquo;what are we escalating for, mostly?&rdquo; —
                which is the question that tells a Product Director whether the problem is severity,
                staffing or a broken target.
                <Cite>mos_escalation.trigger — a CHECK constraint over §9&apos;s eight values</Cite>
              </Explain>
            </Panel>
            <Panel title="By state" note="Actioned, withdrawn and closed are terminal.">
              <Distribution items={tally(rows, e => e.status, STATUS_KEYS, ESCALATION_STATUS_LABEL)} total={rows.length} />
            </Panel>
          </div>

          {rows.length > 0 && (
            <Panel title="The escalation estate" note="Newest first.">
              <ul className="flex flex-col divide-y divide-gray-100">
                {rows.map(e => (
                  <li key={e.escalationId} className="py-3 first:pt-0 last:pb-0">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <p className="min-w-0 text-[12.5px] font-semibold text-gray-900">
                        {ESCALATION_TRIGGER_LABEL[e.trigger] ?? e.trigger} → {e.targetTeam}
                      </p>
                      <span className="flex shrink-0 items-center gap-1.5">
                        {e.overdue && (
                          <span className="shrink-0 rounded border border-[var(--cmp-color-warning)] bg-[var(--cmp-surface-warning)] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[var(--cmp-text-warning)]">
                            Overdue
                          </span>
                        )}
                        <StatusChip label={ESCALATION_STATUS_LABEL[e.status] ?? e.status} />
                      </span>
                    </div>
                    <p className="mt-1 text-[12px] leading-relaxed text-gray-700">{e.reason}</p>
                    <div className="mt-2 grid gap-2 sm:grid-cols-3">
                      <Field label="Requested action" value={e.requestedAction} />
                      <Field label="Raised by" value={e.sourceName} />
                      <Field label="Due" value={
                        e.dueAt ? `${new Date(e.dueAt).toISOString().slice(0, 16).replace("T", " ")} GMT` : null
                      } />
                    </div>
                    {e.incidentId && (
                      <Link href={`/super-admin/pd/support/incident-360?id=${e.incidentId}`}
                        className="mt-1.5 inline-block text-[11.5px] font-semibold text-teal-700 hover:underline">
                        the incident it escalates →
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
              <Truncated truncated={read.truncated} what="escalations" />
            </Panel>
          )}

          <Panel title="Why no escalation on this page has an owner">
            <p className="text-[12px] leading-relaxed text-gray-700">
              §9: &ldquo;Escalation does not transfer incident ownership unless explicitly
              reassigned.&rdquo; The record therefore carries a target team and a requested action, and
              no owner column exists to render. The incident keeps its commander throughout — which is
              the point, because an escalation that quietly moved ownership would leave a major incident
              held by nobody at the moment it was escalated.
            </p>
          </Panel>
        </>
      )}
    </div>
  );
}
