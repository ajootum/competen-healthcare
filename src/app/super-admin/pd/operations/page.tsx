import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/server";
import { requireHqCapability } from "@/lib/hq/context";
import { loadPdOperations } from "@/lib/hq/pd-operations";
import { OpsHeader, Stat, Panel, Warn, ModuleLink, TechnicalOpsLink } from "./_components/ops-ui";

// CPR-PD-014 build 3 — PRODUCT OPERATIONS, the OPERATE layer's entry point.
//
// ⚠ THE GUARD IS ON THE PAGE, NOT ONLY ON THE LAYOUT (CPR-PD-001 s7: "a hidden navigation item does
// not constitute authorization"; Next's authentication guide: a layout check is not sufficient because
// layouts do not re-render on navigation). The await resolves before any JSX is returned, so an
// unauthorized direct URL is redirected without rendering anything.
//
// ⚠ WHAT THIS PAGE IS FOR, AND WHAT IT IS NOT. PD-001 s3 keeps the existing Practice Operations console
// (super-admin/platform-ops/practice) and re-parents it here as Technical Operations. That page owns the
// ACTIONS — provisioning a workspace, flipping a launch flag — and the raw saga detail. This one states
// the same facts at product altitude and routes to whoever owns each: s3 is explicit that "raw
// implementation details (UUIDs, database row counts, migration identifiers, saga step names) must not
// dominate Product Director Mission Control".
//
// ⚠ NO CLINICAL DATA, ANYWHERE ON THESE FOUR PAGES (PD-014 build 3, stated for this module explicitly).
// Everything here is counts and statuses, read through loadPracticeOps, which selects no patient column.

export const dynamic = "force-dynamic";

export default async function Page() {
  await requireHqCapability("hq.practice.operations.view");
  const ops = await loadPdOperations(createAdminClient());

  const strandedFailed = ops.stranded.filter(s => s.verdict === "failed").length;
  const strandedUnsettled = ops.stranded.filter(s => s.verdict === "unsettled").length;

  return (
    <div data-wide className="space-y-4">
      <OpsHeader
        title="Operations Overview"
        purpose="Where Competen Practice stands operationally: the launch state, what is provisioned, what has stalled, and how far the readiness gate has run."
        spec="CPR-PD-014 build 3 · CPR-PD-001 §3"
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {/* ⚠ THE ESTATE COUNT COMES FROM THE DATABASE, NOT FROM MEASURING THE REGISTER PAGE. loadPracticeOps
            reads it separately for exactly this reason; the console that shipped before this page printed
            `workspaces.length` — a 200-row page size — as its headline "Workspaces" figure, which would
            have read 200 for ever once the platform passed 200 practices. */}
        <Stat label="Practices provisioned" tone="neutral"
          value={ops.estate.total === null ? null : ops.estate.total.toLocaleString()}
          scope="every Practice workspace on the platform, counted by the database"
          unreadable="The practice count could not be read. That is not zero — see the read failures below." />

        <Stat label="Provisioning failures" tone={ops.failures.length ? "critical" : "neutral"}
          value={String(ops.failures.length)}
          scope={`FAILED requests among the ${ops.requestsRead} most recent recorded`} />

        <Stat label="Runs still open" tone={ops.open.length ? "warning" : "neutral"}
          value={String(ops.open.length)}
          scope={`requests not COMPLETED, EXPIRED or FAILED, of the ${ops.requestsRead} read`} />

        <Stat label="Readiness gate" tone={ops.gateSummary.fail ? "critical" : "neutral"}
          value={`${ops.gateSummary.pass}/${ops.gateSummary.total}`}
          scope={`${ops.gateSummary.fail} failing, ${ops.gateSummary.manualOutstanding} awaiting a human attestation`} />
      </div>

      {/* A failed count is reported, never swallowed. Empty means every band on these pages is exact. */}
      {ops.estate.countsTruncated.length > 0 && (
        <Warn title="Some counts on these pages are incomplete">
          <p>
            The activity counts are paginated and every page&apos;s error is carried out rather than
            treated as &quot;no more rows&quot;. These did not complete, so the figures they feed are
            floors rather than answers:
          </p>
          <ul className="mt-1.5 flex flex-col gap-0.5 font-mono text-[11px]">
            {ops.estate.countsTruncated.map(t => <li key={t}>{t}</li>)}
          </ul>
        </Warn>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Launch state (IAM-001 §14.1)"
          note="Derived from the three launch flags on every read, not stored. Flipping a flag is the rollback path.">
          <p className="text-xl font-bold text-gray-900">{ops.launch.state}</p>
          <p className="text-[12px] text-gray-600">{ops.launch.detail}</p>
          <p className="mt-2 text-[12px]">
            <Link href="/super-admin/pd/operations/launch-readiness"
              className="font-semibold text-teal-700 hover:underline">Launch Readiness →</Link>
          </p>
        </Panel>

        <Panel title="What needs attention"
          note="Exceptions only, ranked by how stuck the practice is. Nothing here is a projection.">
          {ops.failures.length === 0 && strandedUnsettled === 0 && ops.open.length === 0 ? (
            <p className="text-[12px] text-gray-500">
              No FAILED request, no practice sitting at PROVISIONING and no open run among the{" "}
              {ops.requestsRead} most recent requests and {ops.estate.pageLength} most recent practices
              this page read. That is a measured empty set, not an absence of data.
            </p>
          ) : (
            <ul className="flex flex-col gap-1.5 text-[12px]">
              {ops.failures.length > 0 && (
                <li>
                  <span className="font-bold text-[var(--cmp-text-critical)]">{ops.failures.length}</span>{" "}
                  provisioning run(s) failed.{" "}
                  {strandedFailed > 0 && (
                    <>
                      <span className="font-bold">{strandedFailed}</span> left a practice sitting at{" "}
                      <span className="font-mono">PROVISIONING</span> — which is a stalled creation, not
                      one in progress.{" "}
                    </>
                  )}
                  <Link href="/super-admin/pd/operations/provisioning"
                    className="font-semibold text-teal-700 hover:underline">Provisioning &amp; Onboarding →</Link>
                </li>
              )}
              {strandedUnsettled > 0 && (
                <li>
                  <span className="font-bold text-[var(--cmp-text-warning)]">{strandedUnsettled}</span>{" "}
                  practice(s) sit at <span className="font-mono">PROVISIONING</span> with no provisioning
                  request among those read pointing at them, so this page cannot say whether they are
                  mid-creation or stalled.{" "}
                  <Link href="/super-admin/pd/operations/workspaces"
                    className="font-semibold text-teal-700 hover:underline">Practice Workspaces →</Link>
                </li>
              )}
              {ops.open.length > 0 && (
                <li>
                  <span className="font-bold text-[var(--cmp-text-warning)]">{ops.open.length}</span>{" "}
                  request(s) are still open. Nothing expires them: <span className="font-mono">EXPIRED</span>{" "}
                  is a legal value of the column that no code path ever writes, so an open request stays
                  open until a run finishes it or a person clears it.
                </li>
              )}
            </ul>
          )}
        </Panel>
      </div>

      <Panel title="Where each fact is owned"
        note="Product Operations presents; the technical console acts. PD-001 §3 retains that page rather than replacing it.">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <ModuleLink href="/super-admin/pd/operations/provisioning" label={"Provisioning & Onboarding"}
            summary="Every provisioning run as a lifecycle: what completed, what failed and at which step, and what a failure left behind." />
          <ModuleLink href="/super-admin/pd/operations/workspaces" label="Practice Workspaces"
            summary="The register of provisioned practices with their banded activity counts, and which of them are not in a state anybody chose." />
          <ModuleLink href="/super-admin/pd/operations/launch-readiness" label="Launch Readiness"
            summary="The IAM-001 §14 cutover gate, with the automatically evaluated items and the human attestations kept apart." />
        </div>
        <div className="mt-3">
          <TechnicalOpsLink for="Provisioning a workspace, flipping a launch flag and the raw saga ledger are actions, and they live on" />
        </div>
      </Panel>

      <p className="text-[11px] text-gray-400">
        Read at {ops.generatedAt.slice(0, 16).replace("T", " ")} UTC. Every figure on this page is counted
        from the live database at request time; none is cached, projected or sampled.
      </p>
    </div>
  );
}
