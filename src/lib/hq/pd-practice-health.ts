/**
 * Operational health derivation — CPR-PD-014 §5.4 and §8.4.
 *
 * !! DELIBERATELY A PURE FUNCTION. §8.4 asks for a derivation that is "server-side, testable", and the
 * cheapest way to make a rule testable is to give it no way to reach a database. Every input arrives as
 * an argument, so scripts/pd-practice-health-harness.ts can drive all six states and every precedence
 * boundary without a fixture, a network call or a seeded row.
 *
 * !! NO OPAQUE SCORING. §5.4: "Implement a server-side derivation function with reason codes. Do not use
 * opaque scoring." A weighted score is untestable in the way that matters — you can assert the number it
 * produces, but not that the number means what the badge claims. Reason codes can be asserted against
 * the condition that produced them.
 *
 * !! STATE, HEALTH AND READINESS ARE THREE DIFFERENT THINGS (§2). This function answers health only. A
 * workspace may be ACTIVE and ATTENTION at once, and nothing here collapses the lifecycle state into the
 * health verdict.
 */

export type HealthState = "HEALTHY" | "NEW" | "ATTENTION" | "STALLED" | "DEGRADED" | "FAILED";

export type HealthReason =
  | "PROVISIONING_FAILED"
  | "STRANDED_AT_PROVISIONING"
  | "WITHIN_ACTIVATION_WINDOW"
  | "ONBOARDING_NO_PROGRESS"
  | "ONBOARDING_INCOMPLETE"
  | "WORKSPACE_SUSPENDED"
  | "NO_OWNER_RECORDED"
  | "NO_ONBOARDING_RECORD";

export type HealthInput = {
  /** Lifecycle state of the workspace: PROVISIONING, ONBOARDING, ACTIVE, ARCHIVED, SUSPENDED... */
  status: string;
  createdAt: string | null;
  ownerPersonId: string | null;
  /** True when a provisioning request for this workspace is at FAILED and unresolved. */
  hasFailedProvisioning: boolean;
  /** From the §8.1 projection. Null when the workspace has no onboarding record at all. */
  onboarding: {
    stalledReasonCode: string | null;
    completedAt: string | null;
    stepsCompleted: number | null;
    stepsTotal: number | null;
  } | null;
  /** §4.5/§5.4 thresholds, configuration-backed. Null falls back to the documented defaults. */
  activationWindowHours: number | null;
  /** Evaluated against this instant, passed in so a test can pin it. */
  now: number;
};

export type HealthVerdict = { state: HealthState; reasons: HealthReason[] };

/** Documented defaults, used only when pd_ops_config could not be read. */
const DEFAULT_ACTIVATION_WINDOW_HOURS = 72;

const hoursSince = (iso: string | null, now: number): number | null =>
  iso ? (now - new Date(iso).getTime()) / 3_600_000 : null;

/**
 * Precedence is explicit and ordered, not emergent.
 *
 * !! NEW IS TESTED BEFORE STALLED, AND THAT ORDER IS THE WHOLE POINT OF THE ACTIVATION WINDOW. A
 * practice provisioned an hour ago has made no progress, and calling that STALLED would put every new
 * practice on the exception list on the day it was created — which trains an operator to ignore the
 * list. §5.4 defines NEW as "recently provisioned and not beyond expected activation window" precisely
 * so that early silence is not alarming.
 *
 * !! FAILED OUTRANKS EVERYTHING, including NEW. A run that broke ten minutes ago is still broken, and
 * the activation window is about patience with a practitioner, not with the saga.
 */
export function derivePracticeHealth(input: HealthInput): HealthVerdict {
  const reasons: HealthReason[] = [];

  // ── FAILED ────────────────────────────────────────────────────────────────────────────────────
  if (input.hasFailedProvisioning) reasons.push("PROVISIONING_FAILED");
  // A workspace left at PROVISIONING is not "being created right now": step 1 puts it there and only
  // the last step moves it, so a workspace that stayed there was stranded by a run that stopped.
  if (input.status === "PROVISIONING" && (hoursSince(input.createdAt, input.now) ?? 0) > 1) {
    reasons.push("STRANDED_AT_PROVISIONING");
  }
  if (reasons.length > 0) return { state: "FAILED", reasons };

  // ── DEGRADED ──────────────────────────────────────────────────────────────────────────────────
  // Operational, but a defined control is off. Suspension is the one this plane can see today.
  if (input.status === "SUSPENDED") return { state: "DEGRADED", reasons: ["WORKSPACE_SUSPENDED"] };

  // ── NEW ───────────────────────────────────────────────────────────────────────────────────────
  const age = hoursSince(input.createdAt, input.now);
  const window = input.activationWindowHours ?? DEFAULT_ACTIVATION_WINDOW_HOURS;
  const complete = input.onboarding?.completedAt != null;
  if (!complete && age !== null && age <= window) {
    return { state: "NEW", reasons: ["WITHIN_ACTIVATION_WINDOW"] };
  }

  // ── STALLED ───────────────────────────────────────────────────────────────────────────────────
  // The projection already applies the stall threshold, so this reads its verdict rather than
  // recomputing a second, drifting copy of the same rule.
  if (input.onboarding?.stalledReasonCode) {
    return { state: "STALLED", reasons: ["ONBOARDING_NO_PROGRESS"] };
  }

  // ── ATTENTION ─────────────────────────────────────────────────────────────────────────────────
  // Non-failing conditions a person should look at. Collected rather than short-circuited, because
  // "why" is more useful than "which one first" once nothing is broken.
  if (!input.ownerPersonId) reasons.push("NO_OWNER_RECORDED");
  if (input.status === "ONBOARDING" && input.onboarding === null) reasons.push("NO_ONBOARDING_RECORD");
  if (!complete && age !== null && age > window) reasons.push("ONBOARDING_INCOMPLETE");
  if (reasons.length > 0) return { state: "ATTENTION", reasons };

  // ── HEALTHY ───────────────────────────────────────────────────────────────────────────────────
  // §5.4: "none of the above conditions applies". An empty reason list is the evidence for that, and
  // is returned rather than an invented "all good" code.
  return { state: "HEALTHY", reasons: [] };
}

/** Human sentences for the badge tooltip. §5.4: "A health badge must expose its reason". */
export const REASON_LABEL: Record<HealthReason, string> = {
  PROVISIONING_FAILED: "A provisioning run for this practice is at FAILED and has not been resumed.",
  STRANDED_AT_PROVISIONING: "The workspace is still at PROVISIONING, so the run that created it stopped before finishing.",
  WITHIN_ACTIVATION_WINDOW: "Recently provisioned and still inside the expected activation window.",
  ONBOARDING_NO_PROGRESS: "Onboarding has recorded no progress for longer than the configured threshold.",
  ONBOARDING_INCOMPLETE: "Onboarding is unfinished and the activation window has passed.",
  WORKSPACE_SUSPENDED: "The workspace is suspended, so it is operational for nobody.",
  NO_OWNER_RECORDED: "No owner is recorded against the workspace.",
  NO_ONBOARDING_RECORD: "The workspace is at ONBOARDING but has no onboarding record to progress through.",
};
