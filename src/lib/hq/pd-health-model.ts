import type { Figure } from "@/lib/hq/pd-health";

// ════════════════════════════════════════════════════════════════════════════════════════════════════
// CPR-PD-008 §4, §5, §6, §9, §11 — THE OPERATIONAL HEALTH MODEL.
//
// The specification's vocabulary, kept apart from the reads in pd-health.ts. What this file holds is
// what a health state MEANS and how an overall state is derived; what that file holds is what the
// database actually said.
//
// ⚠ TWO AXES, NOT ONE, AND CONFLATING THEM IS THE TRAP THIS MODULE EXISTS TO AVOID.
//
//   COVERAGE (§11) is about the EVIDENCE: measured, partly measured, not measured, refused, stale.
//   HEALTH   (§4)  is about the PRODUCT: healthy, degraded, major, critical, maintenance, unknown.
//
// They are independent. AI Health is fully MEASURED and its health state is still UNKNOWN, because §4
// defines Healthy as "evidence meets the defined objective" and no objective is configured anywhere in
// this product. Collapsing the two axes would either hide that AI is instrumented, or promote a measured
// number to Healthy against a threshold nobody agreed — and §5 forbids exactly that: "No implicit zero,
// success or Healthy substitution."
// ════════════════════════════════════════════════════════════════════════════════════════════════════

/** CPR-PD-008 §4's canonical health states. */
export type HealthState = "healthy" | "degraded" | "major" | "critical" | "maintenance" | "unknown";

/** CPR-PD-008 §11's coverage states — what evidence exists, independent of what it says. */
export type Coverage = "measured" | "partial" | "absent" | "refused" | "stale";

export const HEALTH_STATE_LABEL: Record<HealthState, string> = {
  healthy: "Healthy",
  degraded: "Degraded",
  major: "Major degradation",
  critical: "Critical",
  maintenance: "Maintenance",
  unknown: "Unknown",
};

export const COVERAGE_LABEL: Record<Coverage, string> = {
  measured: "Measured",
  partial: "Partly measured",
  absent: "Not measured",
  refused: "Refused read",
  stale: "Stale",
};

/** An objective a measurement can be judged against. §5: configured, never invented by a screen. */
export type Objective = { threshold: number; unit: string; judge: (value: number, threshold: number) => HealthState };

/**
 * ⚠ THE §4 HARD RULE, ENFORCED IN CODE RATHER THAN REMEMBERED: "missing, stale, conflicting or
 * unreadable evidence MUST NOT resolve to Healthy."
 *
 * There is no path through this function returning anything but `unknown` without BOTH a real
 * measurement AND a configured objective. The objective is a parameter rather than a literal so that a
 * screen cannot supply one: today every caller passes null, because this product declares no target
 * availability, no latency budget and no error budget, and that is exactly why nothing reads Healthy.
 */
export function healthStateFor(evidence: Figure | null, objective: Objective | null): { state: HealthState; why: string } {
  if (evidence === null) return { state: "unknown", why: "No evidence was produced for this domain." };
  if (evidence.state !== "value") return { state: "unknown", why: evidence.why };
  if (!objective) {
    return {
      state: "unknown",
      why:
        "Measured, but no objective is configured to judge it against. §4 defines Healthy as evidence "
        + "MEETING a defined objective, and this product declares no target availability, latency budget "
        + "or error budget. Calling this healthy would mean inventing the threshold it passed.",
    };
  }
  return { state: objective.judge(evidence.value, objective.threshold), why: "Judged against its configured objective." };
}

export type Domain = {
  key: string;
  label: string;
  /** The question this domain answers, from §2's information architecture. */
  question: string;
  href: string;
  coverage: Coverage;
  state: HealthState;
  /** The headline evidence, where any exists. */
  evidence: Figure | null;
  /** How to read that evidence — its unit and the population it covers. */
  evidenceLabel: string | null;
  why: string;
  /** §5: gating domains prevent an overall Healthy when Critical or Unknown. */
  gating: boolean;
};

/**
 * §5's overall computation.
 *
 * ⚠ IT IS NOT AN AVERAGE, AND THE SPEC SAYS WHY. "Overall Practice Health must be computed from
 * configured health objectives and criticality, not from a simple average of arbitrary telemetry.
 * Critical journeys and availability are gating domains." Averaging nine domains would let a healthy AI
 * service and a healthy job runner outvote an unmeasured sign-in journey — precisely backwards, because
 * the domains that decide whether a practitioner can work are the ones that must gate.
 */
export function overallHealth(domains: Domain[]): { state: HealthState; headline: string; why: string } {
  const gates = domains.filter(d => d.gating);
  const critical = gates.find(d => d.state === "critical");
  if (critical) {
    return {
      state: "critical",
      headline: "Critical",
      why: `${critical.label} is critical and is a gating domain: core product use cannot be depended on while it is.`,
    };
  }
  const unknownGates = gates.filter(d => d.state === "unknown");
  if (unknownGates.length > 0) {
    return {
      state: "unknown",
      headline: "Insufficient evidence",
      why:
        "Whether Competen Practice is dependable cannot be answered from what is recorded. "
        + `${unknownGates.length} of ${gates.length} gating domains have no usable evidence — `
        + `${unknownGates.map(d => d.label).join(", ")}. §4's hard rule is that missing or unreadable `
        + "evidence must not resolve to Healthy, so this reads Unknown rather than green.",
    };
  }
  const degraded = domains.filter(d => d.state === "degraded" || d.state === "major");
  if (degraded.length > 0) {
    const major = degraded.some(d => d.state === "major");
    return {
      state: major ? "major" : "degraded",
      headline: major ? "Major degradation" : "Degraded",
      why: `${degraded.map(d => d.label).join(", ")} ${degraded.length === 1 ? "is" : "are"} below objective.`,
    };
  }
  return { state: "healthy", headline: "Healthy", why: "Every gating domain meets its configured objective." };
}

/** The §11 coverage tally the overall card leads with — how much of the module has evidence at all. */
export function coverageTally(domains: Domain[]) {
  const t = { measured: 0, partial: 0, absent: 0, refused: 0, stale: 0 };
  for (const d of domains) t[d.coverage]++;
  return t;
}

/**
 * CPR-PD-008 §6's critical journeys, with the minimum measurable outcome the spec requires of each.
 *
 * ⚠ THE CANONICAL NAMES COME FROM THE SPECIFICATION, NOT FROM THIS PRODUCT'S VOCABULARY, because §7's
 * event contract keys on `journey_name`, and two surfaces naming the same journey differently cannot be
 * aggregated afterwards. A first draft of Workflow Health listed nine journeys of its own invention —
 * splitting encounter save from sign, and adding a "Practice open" the spec does not have. The spec's
 * eight are authoritative and this is the only list.
 */
export const CRITICAL_JOURNEYS = [
  { key: "sign_in", name: "Sign in to Practice", outcome: "Attempts, successful completion, failure reason, duration" },
  { key: "open_planner", name: "Open Planner", outcome: "Attempts, successful render or usable state, failure reason, duration" },
  { key: "patient_booking", name: "Patient Booking", outcome: "Started, completed, failed, validation or availability failure" },
  { key: "start_encounter", name: "Start Encounter", outcome: "Attempts, successful start, failure reason, duration" },
  { key: "save_encounter", name: "Save Encounter", outcome: "Save attempts, successes, failures, latency, affected sessions" },
  { key: "create_follow_up", name: "Create Follow-up", outcome: "Attempts, successful creation, failure reason" },
  { key: "issue_document", name: "Issue Document", outcome: "Attempts, successful issue, failure reason" },
  { key: "generate_invoice", name: "Generate Invoice", outcome: "Attempts, successful generation, failure reason" },
] as const;

/**
 * CPR-PD-008 §9's Needs Attention model.
 *
 * ⚠ EVERY FIELD THE SPEC REQUIRES IS DECLARED, AND THE ONES WITH NO PRODUCER SAY SO RATHER THAN BEING
 * DROPPED. §9 asks for status, owner, scope and quantified impact. A signal here is DERIVED at request
 * time from a log: it has no lifecycle, so no status; nobody has ever been assigned one, so no owner;
 * and nothing records which practices an AI error touched, so no quantified impact. Dropping those
 * columns would make the panel look finished — carrying them empty says what a real degradation record
 * would have to add.
 */
export type AttentionSignal = {
  /**
   * ⚠ THE ONE FIELD A READER MUST NEVER HAVE TO INFER. An INCIDENT is a stateful record somebody opened
   * and will close: it has a status, an owner, a first observation and something to acknowledge. A
   * DERIVED signal is a count over a log at request time: it has none of those and never will, however
   * alarming the number is. Both belong on this panel, and a panel that let one be mistaken for the
   * other would have a Director chasing an owner who does not exist.
   */
  kind: "incident" | "derived";
  signalId: string;
  title: string;
  severity: HealthState;
  /** §9 wants first-observed. A derived signal has no first observation, only the window it was counted in. */
  startedAt: string | null;
  scope: string;
  impact: string;
  evidence: string;
  actionRoute: { label: string; href: string };
  /** §9's lifecycle status. Null on a derived signal, which has no lifecycle to have one. */
  status: string | null;
  /** §9 fields with no producer for THIS signal, named on the signal itself. Empty for an incident. */
  missingFields: string[];
  /** Where the evidence for this signal can be counted, when there is a thread to follow. */
  correlationId?: string | null;
};

/** §5's freshness envelope, carried with the payload rather than implied by the render time. */
export type Freshness = {
  observedAt: string;
  windowStart: string;
  windowEnd: string;
  /** §11: a value older than this is labelled stale and its health state becomes Unknown. */
  thresholdMinutes: number;
  stale: boolean;
};
