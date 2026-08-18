import { createAdminClient } from "@/lib/supabase/server";
import { requireHqCapability } from "@/lib/hq/context";
import { loadPdOperations } from "@/lib/hq/pd-operations";
import { OpsHeader, Stat, Panel, Absent, Warn, TechnicalOpsLink, PAGE_SCOPE } from "../_components/ops-ui";

// CPR-PD-014 build 3 — PRACTICE WORKSPACES, the landlord-side register.
//
// ⚠ THE GUARD IS ON THE PAGE, NOT ONLY ON THE LAYOUT (CPR-PD-001 s7: "a hidden navigation item does
// not constitute authorization"; Next's authentication guide: a layout check is not sufficient because
// layouts do not re-render on navigation). The await resolves before any JSX is returned, so an
// unauthorized direct URL is redirected without rendering anything.
//
// ⚠ THE COUNTS ARE BANDS AND THEY ARE BANDED ON THE SERVER (D2, docs/PLAT-OVERSIGHT-SURVEY-001 §9). The
// exact figure never enters the payload, so it cannot be read out of it either. "1,000 practices hold
// 41,000 patients" is platform telemetry; "Dr Nakato's Practice — 412 patients" is business intelligence
// about a named clinician's book, and the second is what banding exists to refuse.
//
// ⚠ AND THE OWNER'S EMAIL IS NOT READ AT ALL (D1), not read-and-hidden. A standing table of addresses is
// a directory of every practitioner on the platform.

export const dynamic = "force-dynamic";

/** What each workspace status MEANS, and — for two of them — what it does not mean. */
const STATUS_NOTE: Record<string, string> = {
  ACTIVE: "Normal operation.",
  ONBOARDING: "Provisioned; the owner is still completing setup.",
  PROVISIONING: "Set by step 1 of the saga and moved only by step 7. A practice sitting here is either mid-creation or a creation that stopped — the two look identical on this column alone.",
  ARCHIVED: "Hidden from daily use, bookings disabled, fully recoverable.",
  SUSPENDED: "Temporarily inaccessible for administrative or licensing reasons.",
};

const STATUS_TONE: Record<string, string> = {
  ACTIVE: "bg-[var(--cmp-surface-success)] text-[var(--cmp-text-success)]",
  ONBOARDING: "bg-[var(--cmp-surface-warning)] text-[var(--cmp-text-warning)]",
  PROVISIONING: "bg-[var(--cmp-surface-warning)] text-[var(--cmp-text-warning)]",
};

export default async function Page() {
  await requireHqCapability("hq.practice.operations.view");
  const ops = await loadPdOperations(createAdminClient());

  const n = ops.estate.pageLength;
  const total = ops.estate.total;
  const strandedFailed = ops.stranded.filter(s => s.verdict === "failed");
  const strandedUnsettled = ops.stranded.filter(s => s.verdict === "unsettled");
  const inFlight = ops.stranded.filter(s => s.verdict === "in_flight");
  const closedLoop = ops.workspaces.filter(w => (w.counts.signed ?? "0") !== "0").length;

  return (
    <div data-wide className="space-y-4">
      <OpsHeader
        title="Practice Workspaces"
        purpose="The register of Practice workspaces on the platform, with banded activity counts and the practices that are not in a state anybody chose."
        spec="CPR-PD-014 build 3 · CPR-PD-001 §3"
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {/* ⚠ THE DATABASE'S COUNT, NOT THE LENGTH OF THE TABLE BELOW. loadPracticeOps reads the exact
            total separately and returns null rather than 0 when the read fails; the register underneath
            is at most the 200 most recent rows, so measuring it would answer "200" for ever. */}
        <Stat label="Practices on the platform"
          value={total === null ? null : total.toLocaleString()}
          scope="counted by the database, not by measuring the register below"
          unreadable="The practice count could not be read. That is not zero — the read error is listed below." />
        <Stat label="Shown in the register" value={String(n)}
          scope={total !== null && total > n ? `the ${n} most recent, of ${total.toLocaleString()}` : "every practice the register holds"} />
        <Stat label="Reached ACTIVE"
          value={String(ops.workspaces.filter(w => w.status === "ACTIVE").length)}
          scope={PAGE_SCOPE(n, total)} tone="success" />
        <Stat label="Closed the clinical loop" value={String(closedLoop)}
          scope={`hold at least one SIGNED or AMENDED encounter, ${PAGE_SCOPE(n, total)}`} />
      </div>

      {ops.estate.pagePartial && (
        <Warn title="This register is a page, not the estate">
          <p>
            It holds the {n} most recent practices of {total?.toLocaleString()} on the platform. Every
            figure scoped &quot;of the {n} most recent&quot; above and below is over this page. The only
            estate-wide figure on this screen is the practice count itself.
          </p>
        </Warn>
      )}

      {ops.estate.countsTruncated.length > 0 && (
        <Warn title="Some activity counts did not complete">
          <p>
            Every count page&apos;s error is carried out rather than treated as &quot;no more rows&quot;,
            because a failed page read as an empty one would end the loop early and report a smaller
            number with nothing to show anything went wrong. Where a count below is affected, its band is
            a floor rather than a measurement:
          </p>
          <ul className="mt-1.5 flex flex-col gap-0.5 font-mono text-[11px]">
            {ops.estate.countsTruncated.map(t => <li key={t}>{t}</li>)}
          </ul>
        </Warn>
      )}

      {/* ── Practices that are not where anybody put them ──────────────────────────────────────────── */}
      {ops.stranded.length > 0 && (
        <Panel title="Practices at PROVISIONING"
          note="This status is set when the workspace row is created and moved only by the saga's last step. It therefore covers two entirely different situations, and this page refuses to render either as the other.">
          <ul className="flex flex-col gap-1.5 text-[12px]">
            {strandedFailed.map(s => (
              <li key={s.id} className="rounded-lg border border-[var(--cmp-color-warning)] bg-[var(--cmp-surface-warning)] px-3 py-2">
                <span className="font-semibold text-gray-900">{s.name}</span>
                <span className="ml-1.5 text-gray-600">{s.ownerName ?? "owner not named in this payload"}</span>
                <p className="mt-0.5 text-gray-800">
                  {/* ⚠ NOT "being created right now". A FAILED provisioning request points at this
                      workspace, and fail() never touches the workspace status — so this is a stopped
                      creation, possibly weeks old, wearing the same badge as one that started a second
                      ago. */}
                  Creation <span className="font-semibold">stopped</span>
                  {s.failedStep && <> at <span className="font-mono">{s.failedStep}</span></>}. It is not
                  in progress.
                </p>
              </li>
            ))}
            {inFlight.map(s => (
              <li key={s.id} className="rounded-lg border border-gray-100 px-3 py-2">
                <span className="font-semibold text-gray-900">{s.name}</span>
                <p className="mt-0.5 text-gray-600">
                  A provisioning request that has neither completed nor failed points at this practice, so
                  creation may still be running.
                </p>
              </li>
            ))}
            {strandedUnsettled.map(s => (
              <li key={s.id} className="rounded-lg border border-gray-100 px-3 py-2">
                <span className="font-semibold text-gray-900">{s.name}</span>
                <p className="mt-0.5 text-gray-600">
                  No provisioning request among the {ops.requestsRead} most recent points at this practice,
                  so this page cannot say whether creation is running or stopped. It says so rather than
                  choosing the reassuring reading.
                </p>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {/* ── The register ──────────────────────────────────────────────────────────────────────────── */}
      <Panel title="Register"
        note="Counts only, banded on the server. No patient name, note, diagnosis or amount is read into this page, and there is deliberately no way in from here to a practice's record.">
        {ops.workspaces.length === 0 ? (
          <p className="text-[12px] text-gray-500">
            {total === null
              ? "No practice was returned by the register read, and the estate count could not be read either, so this page cannot tell an empty platform from a failed read."
              : "No Practice workspace has been provisioned. That is a measured zero, not a missing figure."}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wide text-gray-400">
                  <th className="py-1 pr-3">Practice</th>
                  <th className="py-1 pr-3">Owner</th>
                  <th className="py-1 pr-3">Status</th>
                  <th className="py-1 pr-3">Market</th>
                  <th className="py-1 pr-3 text-right">Team</th>
                  <th className="py-1 pr-3 text-right">Appts</th>
                  <th className="py-1 pr-3 text-right">Patients</th>
                  <th className="py-1 pr-3 text-right">Encounters</th>
                  <th className="py-1 pr-3 text-right">Signed</th>
                  <th className="py-1 pr-3 text-right">Invoices</th>
                  <th className="py-1 pr-3 text-right">Payments</th>
                  <th className="py-1">Created</th>
                </tr>
              </thead>
              <tbody>
                {ops.workspaces.map(w => (
                  <tr key={w.id} className="border-t border-gray-100">
                    <td className="py-1.5 pr-3 text-gray-900">{w.name}</td>
                    {/* ⚠ D1: the owner's NAME. Their email is not in this payload to fall back to. When
                        the join found nobody the cell says so rather than showing a dash, which would
                        read as "this practice has no owner". */}
                    <td className="py-1.5 pr-3 text-gray-600">
                      {w.ownerName ?? <span className="text-gray-400">not named in profiles</span>}
                    </td>
                    <td className="py-1.5 pr-3">
                      <span title={STATUS_NOTE[w.status] ?? w.status}
                        className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${STATUS_TONE[w.status] ?? "bg-gray-100 text-gray-500"}`}>
                        {w.status}
                      </span>
                    </td>
                    <td className="py-1.5 pr-3 text-gray-500">{w.country ?? "not set"}</td>
                    {/* ⚠ BANDS. And `signed` is compared against the STRING "0" rather than tested for
                        truthiness — "0" is truthy, so a truthiness test would colour every practice as
                        having closed the clinical loop, including those that have signed nothing. */}
                    <td className="py-1.5 pr-3 text-right tabular-nums text-gray-700">{w.counts.members ?? "0"}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums text-gray-700">{w.counts.appointments ?? "0"}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums text-gray-700">{w.counts.patients ?? "0"}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums text-gray-700">{w.counts.encounters ?? "0"}</td>
                    <td className={`py-1.5 pr-3 text-right tabular-nums font-semibold ${(w.counts.signed ?? "0") !== "0" ? "text-[var(--cmp-text-success)]" : "text-gray-300"}`}>
                      {w.counts.signed ?? "0"}
                    </td>
                    <td className="py-1.5 pr-3 text-right tabular-nums text-gray-700">{w.counts.invoices ?? "0"}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums text-gray-700">{w.counts.payments ?? "0"}</td>
                    <td className="py-1.5 font-mono text-gray-400">{String(w.created_at).slice(0, 10)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2 text-[11px] text-gray-400">
              Bands are 0, 1-9, 10-99 and 100+. They are computed on the server, so the exact figure is not
              in this page&apos;s payload and cannot be recovered from it.
            </p>
          </div>
        )}
      </Panel>

      <Panel title="Status mix"
        note={`Over the ${n} practices in the register above, which is a page rather than the estate wherever the two differ.`}>
        {ops.statusMix.length === 0 ? (
          <p className="text-[12px] text-gray-500">No practice is in the register, so there is no mix to show.</p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {ops.statusMix.map(m => (
              <li key={m.status} className="rounded-lg border border-gray-100 px-3 py-1.5">
                <span className="font-mono text-[11px] text-gray-500">{m.status}</span>
                <span className="ml-2 text-[13px] font-bold tabular-nums text-gray-900">{m.count}</span>
                {STATUS_NOTE[m.status] && (
                  <span className="ml-2 text-[11px] text-gray-500">{STATUS_NOTE[m.status]}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        <Absent
          what="Exact activity counts, and the owner's email address"
          why={
            "Both are decisions rather than gaps. The counts are banded on the server (D2) so a named " +
            "clinician's patient volume is not derivable from this plane, and the owner's email is not " +
            "selected at all (D1) so a standing table of addresses cannot exist. An address stays reachable " +
            "one query at a time through the operator lookup, which refuses a search under two characters."
          } />
        <Absent
          what="Anything about the people a practice treats"
          why={
            "The register counts rows in practice_patient and practice_encounter through their tenancy " +
            "column and nothing else — no name, no date of birth, no diagnosis, no note. That boundary is " +
            "enforced by scripts/plane-boundary-harness.ts against a declared allowlist rather than by the " +
            "shape of the selects, because a comment is not a control."
          } />
      </div>

      <TechnicalOpsLink for="The same register, alongside the provisioning form and the launch toggles, is on" />

      <p className="text-[11px] text-gray-400">
        Read at {ops.generatedAt.slice(0, 16).replace("T", " ")} UTC.
      </p>
    </div>
  );
}
