// CPR-PD-014 build 3 — the read model behind Product Operations (the OPERATE layer's four pages).
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// ⚠ THIS MODULE MAKES NO DATABASE READ OF ITS OWN. Every figure it returns is DERIVED from
// loadPracticeOps() and evaluateGate() in src/lib/practice/operations.ts, and three separate reasons say
// it must stay that way:
//
//   ONE COPY OF THE DECISIONS. That loader is where D1 (no owner email on a standing view) and D2 (the
//   activity counts are BANDS, computed on the server so the exact number never enters the payload) are
//   implemented. A second reader of practice_patient "just for the Product Director" would be a second
//   place those decisions have to be remembered, and the one that forgets is the one that ships.
//
//   THE ALLOWLIST DESCRIBES THOSE READS, NOT THESE PAGES. scripts/plane-boundary-harness.ts walks from
//   src/app/super-admin and judges every practice_* read it can reach against
//   src/lib/access/plane-boundary.ts. Reaching the same tables through the same function means these
//   four pages add no new site for it to judge — the recorded lesson being that a new guard or a new
//   reader that the scanner has not been taught about is a blind spot, four times over.
//
//   THE TWO SURFACES CANNOT DISAGREE. Technical Operations (super-admin/platform-ops/practice) is
//   RETAINED by PD-001 §3, not replaced. If it and these pages counted the estate separately they would
//   eventually print two different totals, and an operator would have no way to know which was wrong.
//
// ⚠ NO CLINICAL CONTENT REACHES ANY OF IT (PD-014 build 3 states this for Product Operations
// explicitly). Counts about practices are operational telemetry; a patient's name, diagnosis or record
// detail is not, and there is no path to one from here because the loader never selects one.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

import { loadPracticeOps, evaluateGate, type GateItem } from "@/lib/practice/operations";

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * ⚠ THE VOCABULARY IS UPPER CASE, AND THAT IS NOT A STYLE CHOICE.
 *
 * `provisioning_request.status` is constrained by migration 191 to exactly these eight strings.
 * PostgREST compares them as strings, so a lower-case filter or comparison matches NOTHING and fails
 * SILENTLY — which is precisely the bug that drew every COMPLETED request as "waiting" on the Practice
 * Mission Control queue widget (its exclusion list read `(succeeded,completed)`, and `succeeded` is not
 * even a value of this column; it belongs to `provisioning_step.status`, a different table).
 *
 * Declared here as one list so every comparison in this module is against a name that exists.
 */
export const REQUEST_STATUSES = [
  "REQUESTED", "IDENTITY_PENDING", "PROVISIONING", "ONBOARDING",
  "ACTIVE", "EXPIRED", "FAILED", "COMPLETED",
] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

/** Terminal in the sense that no further run is expected: nothing is waiting on them. */
const SETTLED: string[] = ["COMPLETED", "EXPIRED"];

/**
 * What a failure at each step LEAVES BEHIND, read out of the saga in src/lib/practice/provisioning.ts.
 *
 * This is knowledge about the code, not a measurement — it says what the orchestrator does, not what
 * happened to any particular practice. It is here because "CAPABILITY_GRANT_FAILED" names the step and
 * says nothing about what the owner will experience, and the step is the one thing already obvious from
 * the code name.
 */
export const STEP_FAILURE_CONSEQUENCE: Record<string, string> = {
  create_workspace:
    "Nothing was created (provisioning.ts:248-254). A resumed run starts clean.",
  create_owner_membership:
    "The workspace row exists and nobody is a member of it (provisioning.ts:270-274).",
  assign_capabilities:
    "The owner is a member holding no or partial capabilities (provisioning.ts:301-312) — an empty sidebar, and a 403 on every Practice API call.",
  create_configuration:
    "No effective configuration, and no booking taxonomy, so the practice cannot take a booking (provisioning.ts:316-341).",
  create_entitlement:
    "No entitlement: no trial and no plan (provisioning.ts:344-353).",
  create_onboarding:
    "No onboarding instance, so the owner cannot start setup (provisioning.ts:359-363).",
  publish_completed:
    "The two updates in this step are not error-checked (provisioning.ts:369-371), so a fault here is not expected to be recorded as a failure at all.",
};

/**
 * ⚠ HOW A FAILED RUN IS ACTUALLY RESUMED TODAY — stated because a button that lies is worse than no
 * button.
 *
 * The header of provisioning.ts says "the retry endpoint re-runs only what did not complete". That
 * endpoint does not exist: `/api/v1/practice/provisioning/[requestId]/route.ts` exports GET only, and no
 * surface anywhere in this repository POSTs a retry. So Product Operations offers no resume control,
 * because a control that did nothing would be worse than this sentence.
 */
export const RESUME_PATH =
  "Re-POST the ORIGINAL payload to /api/v1/practice/provisioning/individual with the SAME Idempotency-Key. " +
  "A FAILED request is not in the await-processing set and does not match the COMPLETED short-circuit, so " +
  "the route falls through to runProvisioning with the original row and its workspace id, and each step " +
  "re-checks its own resource before creating it — the run continues from where it broke instead of " +
  "duplicating the start.";

/** What this plane cannot tell you about a failure, and why. */
export const DETAIL_ABSENCE =
  "The database's own sentence about the failure is written to the practice's audit trail as " +
  "practice.provisioning_failed → payload.detail. This plane may not read practice_audit_event: it is the " +
  "practice's own trail and its payloads carry clinical detail (PLAT-OVERSIGHT-SURVEY-001 §4.4, enforced " +
  "by scripts/plane-boundary-harness.ts). Only one of the saga's eight failure sites passes a detail today " +
  "in any case. The step and the error code below are what is visible from here.";

/**
 * ⚠ THE GATE NO PAGE IN THIS REPOSITORY CAN READ.
 *
 * A visitor creating an account passes three gates in order: the launch flag here, the route's own
 * guard, and Supabase Auth's project-level "allow new users to sign up" switch — which lives in the
 * Supabase dashboard and which no code in this repository can read. The owner keeps it OFF. So a flag
 * reading ON in this database does NOT mean signup is open, and FLAG_CONSEQUENCE's sentence for
 * practice_public_signup ("anyone authenticated can create a Practice workspace…") is stated
 * unconditionally and is not the whole truth on its own.
 *
 * The Practice Mission Control flags widget already carries this caption
 * (src/lib/hq/mission-widgets.ts:124). Its proper home is beside FLAG_CONSEQUENCE in
 * src/lib/practice/operations.ts so the console, the widget and this page cannot say different things —
 * that file is not this module's to edit, so the sentence is declared here and the move is left named
 * rather than done quietly.
 */
export const SUPABASE_GATE_NOTE =
  "Supabase Auth's project-level \"allow new users to sign up\" switch is a further gate above these " +
  "flags, it lives in the Supabase dashboard, and no code in this repository can read it. A flag showing " +
  "ON here does not by itself mean anybody can create an account.";

/** Why the retry count an operator would reach for is not shown. */
export const ATTEMPTS_ABSENCE =
  "provisioning_step.attempts exists and is never written — markStep updates status, timestamps and " +
  "error code only, so the column is 0 on every row ever created. It is not shown, because a column that " +
  "is always zero rendered as a retry count would read as \"nobody has retried\" rather than \"nothing counts\".";

export type OpsStep = {
  request_id: string; step_code: string; status: string;
  error_code: string | null; started_at: string | null; completed_at: string | null;
};

export type OpsWorkspace = {
  id: string; name: string; type: string; status: string;
  owner_person_id: string | null; ownerName: string | null;
  country: string | null; timezone: string | null;
  created_at: string; updated_at: string | null;
  counts: Record<string, string>;
};

export type OpsRequest = {
  id: string; idempotency_key: string; request_type: string; status: string;
  error_code: string | null; target_user_id: string | null; targetName: string | null;
  workspace_id: string | null; created_at: string; updated_at: string | null;
  steps: OpsStep[];
};

export type FailedRun = {
  requestId: string;
  who: string;
  createdAt: string;
  requestErrorCode: string | null;
  /** From the step ledger. Null means the request is FAILED but no step recorded a failure. */
  failedStep: string | null;
  failedStepErrorCode: string | null;
  stepsSucceeded: number;
  stepsRecorded: number;
  workspaceId: string | null;
  /** Null when the workspace is not in the page of practices this load read. */
  workspaceStatus: string | null;
  /** The workspace is sitting at PROVISIONING because only step 7 moves it and step 7 never ran. */
  stranded: boolean;
  consequence: string | null;
  steps: OpsStep[];
};

export type OpenRun = {
  requestId: string;
  who: string;
  status: string;
  createdAt: string;
  stepsRecorded: number;
  stepsSucceeded: number;
  runningStep: string | null;
  /** No step rows at all: the run died before or during the ledger seed at the top of runProvisioning. */
  noLedger: boolean;
  steps: OpsStep[];
};

export type StrandedWorkspace = {
  id: string; name: string; ownerName: string | null; createdAt: string;
  /** "failed" — a FAILED request points here. "in_flight" — an unsettled request points here.
   *  "unsettled" — no request among those read points here, so this page cannot tell which it is. */
  verdict: "failed" | "in_flight" | "unsettled";
  failedStep: string | null;
};

export type PdOperations = {
  launch: { state: string; detail: string };
  flags: Record<string, boolean>;
  flagRows: { flag: string; enabled: boolean; note: string | null }[];
  gate: GateItem[];
  gateSummary: {
    total: number; pass: number; fail: number; pending: number;
    autoTotal: number; autoPass: number; manualTotal: number; manualOutstanding: number;
  };
  estate: {
    /** The database's own count. NULL MEANS IT COULD NOT BE READ — which is not zero. */
    total: number | null;
    /** How many practices the register below actually holds. A page, not an answer. */
    pageLength: number;
    /** The register is showing fewer practices than exist. */
    pagePartial: boolean;
    /** Which activity counts could not be completed, and why. Empty means every band below is exact. */
    countsTruncated: string[];
  };
  workspaces: OpsWorkspace[];
  /** Status → how many of the practices IN THE PAGE hold it. Never presented as an estate figure. */
  statusMix: { status: string; count: number }[];
  requests: OpsRequest[];
  requestsRead: number;
  /** Keyed by the upper-case values of migration 191's CHECK. Only statuses actually present appear. */
  requestMix: { status: string; count: number }[];
  failures: FailedRun[];
  open: OpenRun[];
  stranded: StrandedWorkspace[];
  generatedAt: string;
};

const whoOf = (r: OpsRequest) => r.targetName ?? r.target_user_id ?? "unnamed account";

/**
 * ⚠ A SUCCEEDED STEP CAN CARRY AN ERROR CODE, so failure is read from `status`, never from
 * `error_code IS NOT NULL`. create_configuration records TAXONOMY_SEED_FAILED on a step that succeeded
 * on purpose (a practice with no taxonomy is fixable in one click; halting there would strand a
 * half-built practice for a fault the owner can fix). And a COMPLETED request can carry
 * PRACTICE_ALREADY_EXISTS, which is a refusal, not a fault.
 */
const failedStepOf = (steps: OpsStep[]) => steps.find(s => s.status === "failed") ?? null;
const succeededCount = (steps: OpsStep[]) => steps.filter(s => s.status === "succeeded").length;

/**
 * Steps in the order they RAN, with the ones that never started last.
 *
 * ⚠ NOT sorted against an imported copy of PROVISIONING_STEPS. Importing that constant would pull
 * src/lib/practice/provisioning.ts — and through it taxonomy.ts, which reads a dozen booking tables —
 * into the module graph that scripts/plane-boundary-harness.ts walks from src/app/super-admin. The
 * ledger already records its own order in `started_at`; a step with none has not run, and the loader's
 * own sort puts those FIRST, which reads as though the run began at the end.
 */
const inRunOrder = (steps: OpsStep[]) => steps.slice().sort((a, b) => {
  if (!a.started_at && !b.started_at) return a.step_code.localeCompare(b.step_code);
  if (!a.started_at) return 1;
  if (!b.started_at) return -1;
  return a.started_at.localeCompare(b.started_at);
});

export async function loadPdOperations(admin: any): Promise<PdOperations> {
  const ops = await loadPracticeOps(admin);
  const gate = await evaluateGate(admin, ops);

  const workspaces = ops.workspaces as unknown as OpsWorkspace[];
  const requests = ops.requests as unknown as OpsRequest[];

  // ── The estate ────────────────────────────────────────────────────────────────────────────────────
  // ⚠ THE HEADLINE IS workspaceTotal, NOT workspaces.length. The loader reads the true count from the
  // database separately for exactly this reason, and its own comment says a total derived by measuring
  // the page "says 200 for ever once there are more than 200 practices, on the one figure an operator
  // would quote". The count was fixed; the surface that quotes it was not, so the page length has been
  // the headline until now. Null is carried through as null: a failed count is not a zero.
  const total = ops.workspaceTotal as number | null;
  const pageLength = workspaces.length;

  const statusCounts = new Map<string, number>();
  for (const w of workspaces) statusCounts.set(w.status, (statusCounts.get(w.status) ?? 0) + 1);
  const statusMix = [...statusCounts.entries()]
    .map(([status, count]) => ({ status, count }))
    .sort((a, b) => b.count - a.count || a.status.localeCompare(b.status));

  // ── The provisioning ledger ───────────────────────────────────────────────────────────────────────
  const mixCounts = new Map<string, number>();
  for (const r of requests) mixCounts.set(r.status, (mixCounts.get(r.status) ?? 0) + 1);
  const requestMix = REQUEST_STATUSES
    .filter(s => mixCounts.has(s))
    .map(status => ({ status: status as string, count: mixCounts.get(status)! }))
    // A status outside the CHECK would be a schema change nobody told this file about; show it rather
    // than drop it, because a request this page cannot classify is the one worth looking at.
    .concat([...mixCounts.keys()]
      .filter(s => !(REQUEST_STATUSES as readonly string[]).includes(s))
      .map(status => ({ status, count: mixCounts.get(status)! })));

  const wsById = new Map(workspaces.map(w => [w.id, w]));

  const failures: FailedRun[] = requests
    .filter(r => r.status === "FAILED")
    .map(r => {
      const bad = failedStepOf(r.steps);
      const ws = r.workspace_id ? wsById.get(r.workspace_id) ?? null : null;
      return {
        requestId: r.id,
        who: whoOf(r),
        createdAt: r.created_at,
        requestErrorCode: r.error_code,
        failedStep: bad?.step_code ?? null,
        failedStepErrorCode: bad?.error_code ?? null,
        stepsSucceeded: succeededCount(r.steps),
        stepsRecorded: r.steps.length,
        workspaceId: r.workspace_id,
        workspaceStatus: ws?.status ?? null,
        // ⚠ THE TWO `FAILED`s ARE NOT THE SAME FACT. fail() sets provisioning_request.status='FAILED' and
        // never touches the workspace, which step 1 left at PROVISIONING and only step 7 moves. So a
        // workspace showing PROVISIONING beside a FAILED request is NOT being created right now — it may
        // be a week-old failure, and rendering it as in-flight is the falsehood this pairing exists to
        // prevent.
        stranded: ws?.status === "PROVISIONING",
        consequence: bad ? STEP_FAILURE_CONSEQUENCE[bad.step_code] ?? null : null,
        steps: inRunOrder(r.steps),
      };
    });

  const open: OpenRun[] = requests
    .filter(r => !SETTLED.includes(r.status) && r.status !== "FAILED")
    .map(r => ({
      requestId: r.id,
      who: whoOf(r),
      status: r.status,
      createdAt: r.created_at,
      stepsRecorded: r.steps.length,
      stepsSucceeded: succeededCount(r.steps),
      runningStep: r.steps.find(s => s.status === "running")?.step_code ?? null,
      noLedger: r.steps.length === 0,
      steps: inRunOrder(r.steps),
    }));

  // Every practice sitting at PROVISIONING, paired against the requests actually read.
  const failedByWorkspace = new Map(failures.filter(f => f.workspaceId).map(f => [f.workspaceId!, f]));
  const openByWorkspace = new Map(
    requests.filter(r => r.workspace_id && !SETTLED.includes(r.status) && r.status !== "FAILED")
      .map(r => [r.workspace_id!, r]),
  );
  const stranded: StrandedWorkspace[] = workspaces
    .filter(w => w.status === "PROVISIONING")
    .map(w => {
      const bad = failedByWorkspace.get(w.id);
      if (bad) return { id: w.id, name: w.name, ownerName: w.ownerName, createdAt: w.created_at, verdict: "failed" as const, failedStep: bad.failedStep };
      if (openByWorkspace.has(w.id)) return { id: w.id, name: w.name, ownerName: w.ownerName, createdAt: w.created_at, verdict: "in_flight" as const, failedStep: null };
      // ⚠ NOT "being created". No request among those read points at this workspace, so this page cannot
      // settle which it is, and says so rather than choosing the reassuring reading.
      return { id: w.id, name: w.name, ownerName: w.ownerName, createdAt: w.created_at, verdict: "unsettled" as const, failedStep: null };
    });

  const manual = gate.filter(g => g.kind === "manual");
  return {
    launch: ops.launch,
    flags: ops.flags,
    flagRows: ops.flagRows as { flag: string; enabled: boolean; note: string | null }[],
    gate,
    gateSummary: {
      total: gate.length,
      pass: gate.filter(g => g.state === "pass").length,
      fail: gate.filter(g => g.state === "fail").length,
      pending: gate.filter(g => g.state === "pending").length,
      autoTotal: gate.length - manual.length,
      autoPass: gate.filter(g => g.kind === "auto" && g.state === "pass").length,
      manualTotal: manual.length,
      manualOutstanding: manual.filter(g => g.state !== "pass").length,
    },
    estate: {
      total,
      pageLength,
      pagePartial: total !== null && total > pageLength,
      countsTruncated: ops.countsTruncated,
    },
    workspaces,
    statusMix,
    requests,
    requestsRead: requests.length,
    requestMix,
    failures,
    open,
    stranded,
    generatedAt: ops.generatedAt,
  };
}
