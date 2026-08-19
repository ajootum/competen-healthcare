import { createAdminClient } from "@/lib/supabase/server";
import { requireHqCapability } from "@/lib/hq/context";
import {
  loadPdOperations, RESUME_PATH, DETAIL_ABSENCE, ATTEMPTS_ABSENCE, REQUEST_STATUSES,
  type OpsStep,
} from "@/lib/hq/pd-operations";
import { loadProvisioningHealth, sortOnboarding } from "@/lib/hq/pd-provisioning-health";
import { OpsHeader, Panel, Absent, TechnicalOpsLink } from "../_components/ops-ui";
import {
  HealthCards, LifecycleStrip, OnboardingRegister, RecoveryModel,
} from "./_components/provisioning-health";

// CPR-PD-014 build 3 — PROVISIONING & ONBOARDING.
//
// ⚠ THE GUARD IS ON THE PAGE, NOT ONLY ON THE LAYOUT (CPR-PD-001 s7: "a hidden navigation item does
// not constitute authorization"; Next's authentication guide: a layout check is not sufficient because
// layouts do not re-render on navigation). The await resolves before any JSX is returned, so an
// unauthorized direct URL is redirected without rendering anything.
//
// ⚠ THIS PAGE READS THE SAGA; IT DOES NOT RUN IT. The provisioning form lives on Technical Operations,
// which PD-001 s3 retains as the only caller of the provisioning API. What is added here is the half a
// form cannot give an operator: which runs are stuck, at which step, what that step's failure LEFT
// BEHIND, and what a person has to do about it — stated honestly, because the retry endpoint the
// orchestrator's own header promises does not exist.

export const dynamic = "force-dynamic";

const STEP_TONE: Record<string, string> = {
  succeeded: "bg-[var(--cmp-surface-success)] text-[var(--cmp-text-success)]",
  failed: "bg-[var(--cmp-surface-critical)] text-[var(--cmp-text-critical)]",
  running: "bg-[var(--cmp-surface-warning)] text-[var(--cmp-text-warning)]",
};

function StepLedger({ steps }: { steps: OpsStep[] }) {
  if (steps.length === 0) {
    return (
      <p className="text-[11px] text-[var(--cmp-text-warning)]">
        No step rows exist for this request. The ledger is seeded for all seven steps at the top of a run,
        so a request with none never reached the orchestrator.
      </p>
    );
  }
  return (
    <div className="flex flex-wrap gap-1">
      {steps.map(s => (
        <span key={s.step_code}
          // ⚠ TITLED WITH THE STATUS, AND THE ERROR CODE ONLY WHERE ONE EXISTS. A `succeeded` step can
          // carry an error code — create_configuration records TAXONOMY_SEED_FAILED and still succeeds
          // on purpose — so the code is shown beside the status rather than instead of it.
          title={s.error_code ? `${s.status} · ${s.error_code}` : s.status}
          className={`rounded px-1.5 py-0.5 font-mono text-[10px] ${STEP_TONE[s.status] ?? "bg-gray-100 text-gray-500"}`}>
          {s.step_code}
          {s.error_code && s.status === "succeeded" && <span className="ml-1 opacity-70">⚠</span>}
        </span>
      ))}
    </div>
  );
}

export default async function Page() {
  await requireHqCapability("hq.practice.operations.view");
  const admin = createAdminClient();
  // Two loaders, one page: loadPdOperations answers what the saga did, loadProvisioningHealth answers
  // whether provisioned practices are progressing to operational use (CPR-PD-014 §4.1). They are read
  // in parallel because neither depends on the other.
  const [ops, health] = await Promise.all([loadPdOperations(admin), loadProvisioningHealth(admin)]);

  const workspaceCounts = {
    provisioning: ops.workspaces.filter(w => w.status === "PROVISIONING").length,
    onboarding: ops.workspaces.filter(w => w.status === "ONBOARDING").length,
    active: ops.workspaces.filter(w => w.status === "ACTIVE").length,
  };
  const onboardingRows = sortOnboarding(health.onboarding);
  const stalledCount = onboardingRows.filter(r => r.stalledReasonCode !== null).length;

  return (
    <div data-wide className="space-y-4">
      <OpsHeader
        title="Provisioning & Onboarding"
        purpose="Every provisioning run as a lifecycle rather than a technical saga: what completed, what failed, at which step, what the failure left behind, and what a person has to do to resume it."
        spec="CPR-PD-014 build 3 · CPR-PROV-001 §7–§8"
      />

      {/* ⚠ THE STATUS VOCABULARY IS UPPER CASE (migration 191's CHECK), AND A LOWER-CASE COMPARISON
          MATCHES NOTHING SILENTLY. The Practice Mission Control queue widget excluded
          "(succeeded,completed)" and therefore excluded nothing, drawing every finished request as
          waiting. Every comparison behind these cards goes through the same upper-case vocabulary. */}
      <HealthCards h={health} />

      <LifecycleStrip h={health} workspaceCounts={workspaceCounts} />

      {/* ── The failures ───────────────────────────────────────────────────────────────────────────── */}
      <Panel title="Failed runs"
        note="A FAILED request is a saga that stopped. Each one names the step that broke and what that step's failure leaves in the database, because an error code names the step and nothing else.">
        {ops.failures.length === 0 ? (
          <p className="text-[12px] text-gray-500">
            No request among the {ops.requestsRead} most recent is at status FAILED. That is a measured
            empty set.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {ops.failures.map(f => (
              <li key={f.requestId} className="rounded-lg border border-gray-100 px-3 py-2">
                <div className="flex flex-wrap items-center gap-2 text-[12px]">
                  <span className="rounded bg-[var(--cmp-surface-critical)] px-1.5 py-0.5 text-[10px] font-bold text-[var(--cmp-text-critical)]">
                    FAILED
                  </span>
                  <span className="text-gray-800">{f.who}</span>
                  {f.failedStep && (
                    <span className="text-gray-600">
                      at <span className="font-mono font-semibold">{f.failedStep}</span>
                    </span>
                  )}
                  <span className="font-mono text-[11px] text-[var(--cmp-text-critical)]">
                    {f.failedStepErrorCode ?? f.requestErrorCode ?? "no error code recorded"}
                  </span>
                  <span className="ml-auto font-mono text-[11px] text-gray-400">
                    {String(f.createdAt).slice(0, 16).replace("T", " ")}
                  </span>
                </div>

                {!f.failedStep && (
                  <p className="mt-1 text-[11px] text-[var(--cmp-text-warning)]">
                    The request is FAILED but no step recorded a failure, so the run stopped somewhere the
                    ledger does not cover.
                  </p>
                )}

                {f.consequence && <p className="mt-1 text-[12px] text-gray-700">{f.consequence}</p>}

                {/* ⚠ THE TWO `FAILED`s ARE NOT THE SAME FACT, AND THIS IS THE SENTENCE THAT SAYS SO.
                    fail() sets provisioning_request.status='FAILED' and never touches the workspace,
                    which step 1 left at PROVISIONING and only step 7 moves. Drawing that workspace as
                    "being created right now" would present a week-old failure as work in progress. */}
                {f.stranded && (
                  <p className="mt-1 text-[12px] font-semibold text-[var(--cmp-text-critical)]">
                    The practice this created is still at <span className="font-mono">PROVISIONING</span>.
                    That is not a creation in progress — the step that moves it to ONBOARDING never ran, so
                    it will sit there until this run is resumed or the workspace is cleared.
                  </p>
                )}
                {f.workspaceId && !f.stranded && f.workspaceStatus && (
                  <p className="mt-1 text-[12px] text-gray-600">
                    Its practice is at <span className="font-mono">{f.workspaceStatus}</span>.
                  </p>
                )}
                {f.workspaceId && f.workspaceStatus === null && (
                  <p className="mt-1 text-[12px] text-gray-600">
                    The practice this run created is not among the {ops.estate.pageLength} most recent
                    practices read, so its current status is not on this page.
                  </p>
                )}
                {!f.workspaceId && (
                  <p className="mt-1 text-[12px] text-gray-600">
                    No workspace was recorded against this request, so nothing was left behind by it.
                  </p>
                )}

                <p className="mt-1.5 text-[11px] text-gray-500">
                  {f.stepsSucceeded} of {f.stepsRecorded} ledgered steps succeeded.
                </p>
                <div className="mt-1"><StepLedger steps={f.steps} /></div>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {/* ── §4.3 Practices currently onboarding ───────────────────────────────────────────────────── */}
      <Panel title="Practices currently onboarding"
        note={
          health.onboardingUnavailable
            ? "The onboarding projection is not readable on this database."
            // ⚠ NO MIGRATION NUMBER IN VISIBLE TEXT. CPR-PD-SCREEN-DOCTRINE treats an implementation
            // identifier as a PLACEMENT rule: it belongs in a citation carrier or a comment, not in the
            // sentence an operator reads. The substrate is described in the file header instead.
            : `Setup progress from the privacy-safe onboarding projection. Sorted needs-attention `
              + `first, then oldest last-progress. ${stalledCount > 0
                ? `${stalledCount} practice${stalledCount === 1 ? " has" : "s have"} made no progress for `
                  + `more than ${health.stallHours ?? 24}h.`
                : "No practice is stalled."}`
        }>
        <OnboardingRegister
          rows={onboardingRows}
          stallHours={health.stallHours}
          unavailable={health.onboardingUnavailable}
          unavailableReason={health.onboardingUnavailableReason} />
      </Panel>

      {/* ── Open runs ─────────────────────────────────────────────────────────────────────────────── */}
      <Panel title="Open runs"
        note="Requests that are neither COMPLETED, EXPIRED nor FAILED. Nothing reaps them: EXPIRED is a legal value of the column that no code path writes, so a run that died before its first step stays here for ever.">
        {ops.open.length === 0 ? (
          <p className="text-[12px] text-gray-500">
            No request among the {ops.requestsRead} most recent is open.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {ops.open.map(o => (
              <li key={o.requestId} className="rounded-lg border border-gray-100 px-3 py-2">
                <div className="flex flex-wrap items-center gap-2 text-[12px]">
                  <span className="rounded bg-[var(--cmp-surface-warning)] px-1.5 py-0.5 font-mono text-[10px] font-bold text-[var(--cmp-text-warning)]">
                    {o.status}
                  </span>
                  <span className="text-gray-800">{o.who}</span>
                  {o.runningStep && (
                    <span className="text-gray-600">
                      running <span className="font-mono font-semibold">{o.runningStep}</span>
                    </span>
                  )}
                  <span className="ml-auto font-mono text-[11px] text-gray-400">
                    {String(o.createdAt).slice(0, 16).replace("T", " ")}
                  </span>
                </div>
                <p className="mt-1 text-[11px] text-gray-500">
                  {o.noLedger
                    ? "No step ledger was written, so this run stopped before or during the ledger seed. It cannot be resumed by re-running alone if the original payload is not repeated."
                    : `${o.stepsSucceeded} of ${o.stepsRecorded} ledgered steps succeeded.`}
                </p>
                <div className="mt-1"><StepLedger steps={o.steps} /></div>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {/* ── Request mix ───────────────────────────────────────────────────────────────────────────── */}
      <Panel title="Request states"
        note={`The eight values migration 191 allows, of which four are written by code (REQUESTED, PROVISIONING, COMPLETED, FAILED). Counted over the ${ops.requestsRead} most recent requests, which is a page and not the whole ledger.`}>
        {ops.requestMix.length === 0 ? (
          <p className="text-[12px] text-gray-500">No provisioning request has been recorded.</p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {ops.requestMix.map(m => (
              <li key={m.status} className="rounded-lg border border-gray-100 px-3 py-1.5">
                <span className="font-mono text-[11px] text-gray-500">{m.status}</span>
                <span className="ml-2 text-[13px] font-bold tabular-nums text-gray-900">{m.count}</span>
                {!(REQUEST_STATUSES as readonly string[]).includes(m.status) && (
                  <span className="ml-1.5 text-[10px] font-bold text-[var(--cmp-text-warning)]">
                    not in the column&apos;s CHECK
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {/* ── §4.4 The recovery model, as a disclosure rather than an essay ─────────────────────────── */}
      <RecoveryModel resumePath={RESUME_PATH} attemptsAbsence={ATTEMPTS_ABSENCE} />

      {/* ⚠ THE SECOND ABSENCE HERE IS GONE, AND ITS REMOVAL IS A CORRECTION. It said onboarding progress
          "is not a table this plane may read". That was true when written and is no longer: migration 339
          adds a projection that returns eight operational fields and CANNOT return step_data, so the
          progress above is read within the boundary rather than around it. The register replaced the
          apology. */}
      <Absent
        what="Why a run failed, in the database's own words"
        why={DETAIL_ABSENCE} />

      <TechnicalOpsLink for="Provisioning a pilot workspace, and the idempotency key that makes a double click safe, are on" />

      <p className="text-[11px] text-gray-400">
        Read at {ops.generatedAt.slice(0, 16).replace("T", " ")} UTC. No patient name, note or diagnosis is
        read into this page.
      </p>
    </div>
  );
}
