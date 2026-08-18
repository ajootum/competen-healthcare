import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/server";
import { requireHqCapability } from "@/lib/hq/context";
import {
  loadCases, tally, median,
  CASE_STATUS_LABEL, CASE_STATUSES, CASE_SOURCE_LABEL,
  PRIORITY_LABEL, PRIORITY_ORDER,
} from "@/lib/hq/mos-support";
import { absenceSentence } from "@/lib/hq/pd-metric-registry";
import {
  SupportHeader, Panel, PriorityChip, StatusChip, Distribution, Field,
  NoIntakeBanner, EmptyOrUnreadable, Truncated, Caveat, Explain, Cite, AbsentValue,
} from "../_components/support-ui";

// CPR-PD-009 §4 — SUPPORT CASES.
//
// ⚠ THE GUARD IS ON THE PAGE, NOT ONLY ON THE LAYOUT (CPR-PD-001 s7: "a hidden navigation item does not
// constitute authorization"). The await resolves before any JSX is returned.
//
// ⚠ §4: "Priority and incident severity are separate concepts." This page shows priority and never
// severity, even where a case links to an incident — the incident's severity belongs to the incident,
// and printing it beside a case invites the reader to treat the two scales as one.
//
// ⚠ AND NOT A WORD ABOUT A PATIENT. §1: "Do not treat individual clinical concerns or patient records
// as product support data." A case names the practice and the practitioner who reported it. The schema
// has no patient column, and this page does not reach for one through a join either.

export const dynamic = "force-dynamic";

export default async function Page() {
  await requireHqCapability("hq.practice.support.view");
  const admin = await createAdminClient();
  const read = await loadCases(admin);
  const rows = read?.rows ?? [];
  const open = rows.filter(c => c.isOpen);

  // ⚠ MEDIAN OVER CASES THAT HAVE A RESPONSE, AND THE DENOMINATOR IS PRINTED. A median over "all
  // cases" would count an unanswered case as a fast one by omitting it silently.
  const answered = rows.filter(c => c.responseHours !== null);
  const medianResponse = median(answered.map(c => c.responseHours as number));

  return (
    <div className="flex flex-col gap-4">
      <SupportHeader
        title="Support Cases"
        spec="CPR-PD-009 §4"
        purpose="What practitioners and practices have reported, who holds each case, and how long it has been waiting."
        readAt={new Date().toISOString()}
      />

      <NoIntakeBanner what="Support cases" metric="sup.cases_open" />

      <EmptyOrUnreadable rows={read === null ? null : rows} what="support case" />

      {read !== null && (
        <>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-lg border border-gray-200 bg-white px-3 py-2.5">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Open cases</p>
              <p className="mt-0.5 text-[22px] font-bold leading-none tabular-nums text-gray-900">{open.length}</p>
              <p className="mt-1 text-[11px] text-gray-500">of {rows.length} recorded</p>
            </div>
            <div className="rounded-lg border border-gray-200 bg-white px-3 py-2.5">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Unowned and open</p>
              <p className={`mt-0.5 text-[22px] font-bold leading-none tabular-nums ${
                open.filter(c => !c.ownerName).length > 0 ? "text-[var(--cmp-text-warning)]" : "text-gray-900"}`}>
                {open.filter(c => !c.ownerName).length}
              </p>
            </div>
            <div className="rounded-lg border border-gray-200 bg-white px-3 py-2.5">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Median first response</p>
              {medianResponse === null ? (
                <>
                  <p className="mt-0.5 text-[13px] font-semibold text-gray-400">No case has been answered</p>
                  <p className="mt-1 text-[11px] leading-relaxed text-gray-500">
                    ⚠ Not &ldquo;0h&rdquo;. A median over nothing is not zero — that would render the
                    fastest support in the world for a queue nobody has replied to.
                  </p>
                </>
              ) : (
                <>
                  <p className="mt-0.5 text-[22px] font-bold leading-none tabular-nums text-gray-900">
                    {medianResponse}<span className="ml-1 text-[12px] font-medium text-gray-400">h</span>
                  </p>
                  <p className="mt-1 text-[11px] text-gray-500">
                    over {answered.length} case{answered.length === 1 ? "" : "s"} with a response recorded
                  </p>
                </>
              )}
              <Caveat metric="sup.first_response" />
            </div>
            <div className="rounded-lg border border-gray-200 bg-white px-3 py-2.5">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Past their response target</p>
              <AbsentValue why={absenceSentence("sup.response_target")} />
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Panel title="By state (§4)" note="The seven lifecycle states, in order. Both waiting states count as open.">
              <Distribution items={tally(rows, c => c.status, [...CASE_STATUSES], CASE_STATUS_LABEL)} total={rows.length} />
              <Explain summary="Why a case waiting on the reporter is still counted as open">
                Parking a case on somebody else does not move it off the queue — it is still the
                practice&apos;s problem and still ageing. Dropping the two waiting states out of
                &ldquo;open&rdquo; is the standard way a support queue is made to look shorter than it is.
                <Cite>mos_support_case.status — resolved and closed are terminal, the two waiting states are not</Cite>
              </Explain>
            </Panel>

            <Panel title="By priority (§4)" note="Priority, never severity. §4 keeps the two scales apart and so does this.">
              <Distribution items={tally(rows, c => c.priority, PRIORITY_ORDER, PRIORITY_LABEL)} total={rows.length} />
              <Explain summary="Why an incident's severity is not shown beside a linked case">
                §4 states the two are separate concepts. A P3 case can be linked to a SEV-1 incident —
                the case is one practice&apos;s report and the incident is the estate-wide failure. Printing
                both scales in one row invites a reader to treat them as one, and then to wonder why a
                &ldquo;critical&rdquo; case is only P3.
              </Explain>
            </Panel>
          </div>

          {rows.length > 0 && (
            <Panel title="The case estate" note="Newest first.">
              <ul className="flex flex-col divide-y divide-gray-100">
                {rows.map(c => (
                  <li key={c.caseId} className="py-3 first:pt-0 last:pb-0">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <p className="min-w-0 text-[12.5px] font-semibold text-gray-900">{c.title}</p>
                      <span className="flex shrink-0 items-center gap-1.5">
                        <PriorityChip label={PRIORITY_LABEL[c.priority] ?? c.priority} />
                        <StatusChip label={CASE_STATUS_LABEL[c.status] ?? c.status} />
                      </span>
                    </div>
                    <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                      <Field label="Reported by" value={c.reporterName} />
                      <Field label="Source" value={CASE_SOURCE_LABEL[c.source] ?? c.source} />
                      <Field label="Owner" value={c.ownerName} warnWhenEmpty={c.isOpen} />
                      <Field label="Area" value={c.productArea ?? c.category} />
                    </div>
                    <p className="mt-1.5 font-mono text-[10.5px] text-gray-500">
                      raised {new Date(c.createdAt).toISOString().slice(0, 16).replace("T", " ")} GMT
                      {" · "}open {c.ageHours}h
                      {c.responseHours !== null
                        ? ` · first response after ${c.responseHours}h`
                        : c.isOpen ? " · no response recorded" : ""}
                    </p>
                    {c.incidentId && (
                      <Link href={`/super-admin/pd/support/incident-360?id=${c.incidentId}`}
                        className="mt-1 inline-block text-[11.5px] font-semibold text-teal-700 hover:underline">
                        linked to an incident →
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
              <Truncated truncated={read.truncated} what="support cases" />
            </Panel>
          )}
        </>
      )}
    </div>
  );
}
