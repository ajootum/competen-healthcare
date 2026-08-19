import { createAdminClient } from "@/lib/supabase/server";
import { requireHqCapability } from "@/lib/hq/context";
import {
  loadProblems, loadProblemIncidents, tally,
  PROBLEM_STATUS_LABEL, PROBLEM_ORDER, PRIORITY_LABEL, PRIORITY_ORDER,
} from "@/lib/hq/mos-support";
import {
  SupportHeader, Panel, PriorityChip, StatusChip, Distribution, Field,
  NoIntakeBanner, EmptyOrUnreadable, Truncated, Explain, Cite,
} from "../_components/support-ui";

// CPR-PD-009 §12 — PROBLEM MANAGEMENT.
//
// ⚠ THE GUARD IS ON THE PAGE, NOT ONLY ON THE LAYOUT (CPR-PD-001 s7).
//
// ⚠ A PROBLEM IS NOT DERIVED FROM ITS INCIDENTS, AND THAT IS THE WHOLE POINT OF THE MODULE. §1 defines
// a problem as the underlying cause that GENERATES incidents. The relationship runs cause → symptom, so
// no query over the symptoms can produce the cause: three incidents in a fortnight is a pattern a person
// notices, and calling it a problem is a judgement somebody makes and then owns.
//
// ⚠ AND SUSPECTED IS NOT CONFIRMED. §12 and §13 both insist on the distinction and the schema enforces
// it — a confirmed cause is refused while the status still says investigating. This page prints them in
// separate rows with different weight, because a hypothesis that gets retold often enough becomes a
// finding, and the retelling usually happens on a screen that showed them in one box.

export const dynamic = "force-dynamic";

export default async function Page() {
  await requireHqCapability("hq.practice.support.view");
  const admin = await createAdminClient();
  const [read, links] = await Promise.all([loadProblems(admin), loadProblemIncidents(admin)]);
  const rows = read?.rows ?? [];
  const open = rows.filter(p => p.isOpen);

  return (
    <div className="flex flex-col gap-4">
      <SupportHeader
        title="Problem Management"
        spec="CPR-PD-009 §12"
        purpose="The recurring causes behind incidents — what is suspected, what is confirmed, and who owns closing it."
        readAt={new Date().toISOString()}
      />

      <NoIntakeBanner what="Problems" metric="sup.problems" />

      <EmptyOrUnreadable rows={read === null ? null : rows} what="problem" />

      {read !== null && (
        <>
          <div className="grid gap-2 sm:grid-cols-3">
            <div className="rounded-lg border border-gray-200 bg-white px-3 py-2.5">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">Open problems</p>
              <p className="mt-0.5 text-[22px] font-bold leading-none tabular-nums text-gray-900">{open.length}</p>
              <p className="mt-1 text-[11px] text-gray-500">of {rows.length} recorded</p>
            </div>
            <div className="rounded-lg border border-gray-200 bg-white px-3 py-2.5">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">Cause confirmed</p>
              <p className="mt-0.5 text-[22px] font-bold leading-none tabular-nums text-gray-900">
                {rows.filter(p => p.confirmedCause !== null).length}
              </p>
              <p className="mt-1 text-[11px] leading-relaxed text-gray-500">
                The rest hold a suspicion, which is a different claim.
              </p>
            </div>
            <div className="rounded-lg border border-gray-200 bg-white px-3 py-2.5">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">Open and unowned</p>
              <p className={`mt-0.5 text-[22px] font-bold leading-none tabular-nums ${
                open.filter(p => !p.ownerName).length > 0 ? "text-[var(--cmp-text-warning)]" : "text-gray-900"}`}>
                {open.filter(p => !p.ownerName).length}
              </p>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Panel title="By state (§12)" note="The eight states, in order.">
              <Distribution items={tally(rows, p => p.status, PROBLEM_ORDER, PROBLEM_STATUS_LABEL)} total={rows.length} />
            </Panel>
            <Panel title="By priority" note="§12 uses the same four-point priority as a case, and not incident severity.">
              <Distribution items={tally(rows, p => p.priority, PRIORITY_ORDER, PRIORITY_LABEL)} total={rows.length} />
            </Panel>
          </div>

          {rows.length > 0 && (
            <Panel title="The problem estate" note="Newest first. Suspected and confirmed causes are shown separately, never merged.">
              <ul className="flex flex-col divide-y divide-gray-100">
                {rows.map(p => {
                  const incidents = links?.get(p.problemId) ?? [];
                  return (
                    <li key={p.problemId} className="py-3 first:pt-0 last:pb-0">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <p className="min-w-0 text-[12.5px] font-semibold text-gray-900">{p.title}</p>
                        <span className="flex shrink-0 items-center gap-1.5">
                          <PriorityChip label={PRIORITY_LABEL[p.priority] ?? p.priority} />
                          <StatusChip label={PROBLEM_STATUS_LABEL[p.status] ?? p.status} />
                        </span>
                      </div>

                      <div className="mt-2 grid gap-2 sm:grid-cols-3">
                        <Field label="Owner" value={p.ownerName} warnWhenEmpty={p.isOpen} />
                        <Field label="Journey" value={p.journeyKey} />
                        <Field label="Incidents linked" value={
                          links === null ? null : `${incidents.length}`
                        } />
                      </div>

                      <div className="mt-2 flex flex-col gap-1.5">
                        <div>
                          <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">Suspected cause</p>
                          <p className="text-[12px] italic leading-relaxed text-gray-600">
                            {p.suspectedCause ?? "none recorded"}
                          </p>
                        </div>
                        <div>
                          <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">Confirmed cause</p>
                          <p className={`text-[12px] leading-relaxed ${
                            p.confirmedCause ? "font-semibold text-gray-900" : "text-gray-500"}`}>
                            {p.confirmedCause ?? "not confirmed"}
                          </p>
                        </div>
                      </div>

                      {p.workaround && (
                        <p className="mt-1.5 text-[11.5px] leading-relaxed text-gray-600">
                          <span className="font-semibold text-gray-700">Workaround:</span> {p.workaround}
                        </p>
                      )}
                      {p.patternEvidence && (
                        <p className="mt-1 text-[11.5px] leading-relaxed text-gray-600">
                          <span className="font-semibold text-gray-700">Pattern:</span> {p.patternEvidence}
                        </p>
                      )}
                    </li>
                  );
                })}
              </ul>
              <Truncated truncated={read.truncated} what="problems" />
              {links === null && (
                <p className="mt-2 text-[11.5px] leading-relaxed text-[var(--cmp-text-warning)]">
                  ⚠ The problem-to-incident links could not be read, so &ldquo;incidents linked&rdquo; is
                  unavailable above rather than zero.
                </p>
              )}
            </Panel>
          )}

          <Panel title="Why this is not computed from incidents">
            <p className="text-[12px] leading-relaxed text-gray-700">
              Every other count in this module reads a store. This one reads a store of judgements. §1
              defines a problem as the cause that generates incidents, so clustering incidents by
              journey or component would produce a list of <em>symptom groups</em> and label them causes —
              which is the inference the specification rules out, and the one a dashboard makes easiest.
            </p>
            <Explain summary="What that means for the empty state above">
              An empty problem list does not mean no recurring cause exists in the estate. It means
              nobody has recorded one — and today nobody can, because there is no intake. Those are
              three different statements and only the middle one is a measurement.
              <Cite>mos_problem with mos_problem_incident — the link is recorded, never inferred</Cite>
            </Explain>
          </Panel>
        </>
      )}
    </div>
  );
}
