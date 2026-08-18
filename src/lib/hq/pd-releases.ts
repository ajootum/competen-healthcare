// CPR-PD-012 — the read model behind Releases & Capabilities' twelve pages.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// ⚠ THE ONE SENTENCE THAT DECIDES WHAT THIS MODULE MAY DRAW.
//
// PD-012 §4: "Lifecycle state is distinct from a runtime feature flag. A capability cannot be made
// generally available merely by toggling a flag."
//
// This repository has excellent ACTIVATION machinery and NO LIFECYCLE machinery. The capability
// catalogue is real, its dependency graph is real, the three launch flags are real and are the only
// genuine exposure control the landlord holds over Competen Practice. Everything the specification
// calls a release object — rollout, stage, cohort, assignment, readiness gate, attestation, approval,
// market availability, plan availability, kill switch, pilot acceptance — has no table, no column and
// no mechanism. Those are declared `absent` in the metric registry and never reach a component.
//
// ⚠ THE FIGURE THE DESIGNS LEAN HARDEST ON IS ROLLOUT PERCENTAGE, AND IT IS THE ONE WITH NO PATH.
// It needs two things at once: a store (no percentage column exists anywhere) and a deterministic
// sticky bucketing function (none exists in this codebase). configuration_releases.rollout reads
// 'phased' and 'canary' — mode names on a configuration change set, one word each, carrying no
// proportion and no assignment. So §9's pipeline is rendered as its SEVEN STAGES with each stage's
// honest verdict, and the dial is refused outright. The shape is there for a figure to land in the day
// a producer exists; the number is not invented in the meantime.
//
// ⚠ WHAT THIS MODULE READS, AND WHY NO NEW PRACTICE-PLANE SITE IS ADDED.
//
//   PLATFORM TABLES, which the plane boundary does not govern: plat_deployments, plat_feature_flags,
//   plat_feature_flag_assignments, plat_plans, configuration_releases, configuration_release_events.
//
//   THE PRACTICE PLANE, ONLY THROUGH LOADERS THAT ALREADY EXIST: loadPdOperations composes
//   loadPracticeOps + evaluateGate for the launch flags and the cutover gate; loadConfigMarkets and
//   loadPracticeDefaults come from Product Configuration. Reaching those tables through the same
//   functions means these twelve pages add no new site for scripts/plane-boundary-harness.ts to judge,
//   and two Product Director surfaces cannot print different totals for the same fact.
//
// ⚠ AND THE MODULE'S RICHEST DATA IS A REFUSED READ, NOT A MISSING ONE. practice_capability_activation
// (migration 278:85) holds, per workspace, which of the twelve capabilities is switched on, by whom,
// when, and through which of four sources; its event log holds every change. Neither table is on the
// platform-plane allowlist (src/lib/access/plane-boundary.ts), so no page under src/app/super-admin/**
// may read them. The rows exist and the product writes them every day. Widening the allowlist is an
// owner decision — taken once, deliberately, for one table — and not one a screen takes for itself.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

/* eslint-disable @typescript-eslint/no-explicit-any */

import {
  CAPABILITY_REGISTRY, CAPABILITY_IDS, SETUP_LABELS, DEFAULT_ACTIVE_IDS,
  requiredClosure, dependentClosure, directDependents,
  type CapabilityId, type CapabilityDefinition,
} from "@/lib/practice/capability-registry";
import { loadPdOperations, SUPABASE_GATE_NOTE, type PdOperations } from "@/lib/hq/pd-operations";
import { FLAG_ORDER, FLAG_CONSEQUENCE } from "@/lib/practice/operations";
import { mayRender, absenceSentence } from "@/lib/hq/pd-metric-registry";

type Admin = any;

export { SUPABASE_GATE_NOTE, FLAG_ORDER, FLAG_CONSEQUENCE };
export {
  CAPABILITY_REGISTRY, CAPABILITY_IDS, SETUP_LABELS, DEFAULT_ACTIVE_IDS,
  requiredClosure, dependentClosure, directDependents,
};
export type { CapabilityId, CapabilityDefinition, PdOperations };

/**
 * ⚠ THREE STATES, AND CONFLATING THE LAST TWO IS THE FAILURE THIS TYPE EXISTS TO PREVENT.
 *
 *   value    a measurement.
 *   unknown  the read did not complete. NOT zero, and the sentence says which read.
 *   absent   the metric registry refuses this figure. The sentence names the fact that is missing.
 *
 * Ported unchanged from pd-configuration.ts:443-453, which ported it from pd-mission.ts, so that three
 * Product Director surfaces cannot express the same three states in three different shapes.
 */
export type Figure =
  | { state: "value"; value: number }
  | { state: "unknown"; why: string }
  | { state: "absent"; why: string };

/**
 * ⚠ THE ONE GATE, AND IT IS IN THE LOADER RATHER THAN THE COMPONENT.
 *
 * `compute` is not even called for a metric the registry refuses, so an absent figure cannot leak
 * through a careless edit in a view — there is nothing in the payload to leak. Gating in the component
 * would make every new view a fresh chance to forget.
 */
function figure(metricId: string, compute: () => number | null, unreadable: string): Figure {
  if (!mayRender(metricId)) return { state: "absent", why: absenceSentence(metricId) };
  const v = compute();
  return v === null ? { state: "unknown", why: unreadable } : { state: "value", value: v };
}

/** Display names for refused figures. The registry holds the definitions; this holds the headings. */
const LABELS: Record<string, string> = {
  "rel.rollout_percentage": "Rollout percentage",
  "rel.rollout_stage": "Rollout stage",
  "rel.active_rollouts": "Active rollouts",
  "rel.capability_lifecycle": "Capability lifecycle state",
  "rel.capability_owner": "Capability owner",
  "rel.capability_governance_class": "Capability governance class",
  "rel.release_content": "What is in a release",
  "rel.release_approvals": "Release approvals and risk class",
  "rel.readiness_gates": "Release readiness gates",
  "rel.flag_governance": "Flag owner, type and expiry",
  "rel.market_availability": "Capability availability by market",
  "rel.kill_switch": "Capability kill switch",
  "rel.post_deploy_verification": "Post-deployment verification",
  "rel.pilot_acceptance": "Pilot cohorts and acceptance",
  "rel.availability_decision": "Effective availability decision",
  "rel.capability_activation_estate": "Practices with each capability active",
  "rel.capability_activation_history": "Capability activations over time",
  "rel.entitlement_plan_mix": "Capability entitlement by plan",
};

export const refusalFor = (metricId: string) => ({
  label: LABELS[metricId] ?? metricId,
  why: absenceSentence(metricId),
});

export const refusalsFor = (ids: string[]) => ids.map(refusalFor);

// ── THE TWELVE SUB-SPECIFICATIONS (CPR-PD-012A … 012L) ───────────────────────────────────────────────
//
// ⚠ EACH CHILD SPECIFICATION PRESCRIBES ITS OWN STATE MODEL AND ITS OWN REQUIRED UI STRUCTURE, and both
// are the sharpest test this module can apply to itself. A state model is a list of states an object
// must be able to HOLD; a required structure is a list of things a screen must be able to SHOW. Scoring
// them one row at a time is how a reader learns which parts of the prescribed product exist, instead of
// inferring it from which panels happen to be populated.
//
// ⚠ AUTHORED, NOT MEASURED. Every verdict below is a statement about the schema or about code that
// ships with the product, checked by hand at the file and line in its citation. A runtime probe could
// not produce them: "no capability is in Pilot" and "Pilot is not a state anything can hold" are the
// same empty result and opposite facts.

/** Can this product hold this state / show this element today? */
export type Held = "yes" | "partial" | "no";

export const HELD_LABEL: Record<Held, string> = {
  yes: "Yes",
  partial: "Partly",
  no: "No",
};

export type StateRow = {
  /** The child specification's §5 STATE column, verbatim. */
  state: string;
  /** Its MEANING column, verbatim. */
  meaning: string;
  held: Held;
  /** One short line in the product's language. The forensic detail goes in `citation`. */
  reason: string;
  citation?: string;
};

export type StructureRow = {
  /** The child specification's §3 element, verbatim. */
  element: string;
  held: Held;
  /** One short line: what is on the page, or what is missing. */
  reason: string;
};

export type SubSpec = {
  key: string;
  /** The child specification id, e.g. "CPR-PD-012B". */
  id: string;
  /** Its §2 primary user questions, verbatim. The first viewport must answer the first one. */
  questions: string[];
  /** Its §5 state model. */
  states: StateRow[];
  /** Its §3 required UI structure. */
  structure: StructureRow[];
};

const SUBSPECS: SubSpec[] = [
  // ── 012A OVERVIEW ────────────────────────────────────────────────────────────────────────────────
  {
    key: "overview", id: "CPR-PD-012A",
    questions: [
      "What is shipping or rolling out now?",
      "What is blocked, unhealthy or awaiting my decision?",
      "Which capabilities are in Pilot, Early Access or GA?",
      "What changed recently and what can be safely expanded?",
    ],
    states: [
      { state: "Normal", meaning: "No material attention condition.", held: "yes", reason: "Derived from the launch flags, the live readiness checks and the release log — a measured absence of exceptions, not an assumption." },
      { state: "Attention", meaning: "A decision, blocker or risk requires review.", held: "partial", reason: "Raised for an open public pathway, an outstanding human check or an unfinished release row. It cannot be raised by a rollout, a gate result or a pending approval, because none of those exists." },
      { state: "Critical", meaning: "A material release or rollout condition needs immediate action.", held: "partial", reason: "Raised by a failing readiness check or a broken capability catalogue. A failed deployment cannot raise it, because a failed deployment cannot be recorded.", citation: "plat_deployments.status check omits `failed` (migration 044:36)" },
    ],
    structure: [
      { element: "Executive summary cards", held: "yes", reason: "Launch state, current release, the capability catalogue and the live readiness count." },
      { element: "Active rollout pipeline", held: "partial", reason: "The seven stages are drawn with a verdict each. No stage carries a population, because no rollout object exists." },
      { element: "Needs Attention", held: "yes", reason: "Measured exceptions only, each naming what raised it." },
      { element: "Upcoming releases", held: "partial", reason: "Release rows recorded as planned or releasing. Nothing schedules a release, so this is what somebody wrote down." },
      { element: "Blocked readiness gates", held: "no", reason: "No gate result object exists; the live cutover checklist is shown instead and is a product-wide launch gate." },
      { element: "Recent releases and rollbacks", held: "yes", reason: "The release log, newest first, with its status." },
      { element: "Capability lifecycle distribution", held: "no", reason: "No capability carries a lifecycle state, so there is no distribution to chart. The eight states are listed with what each would need." },
      { element: "Decision queue", held: "no", reason: "No approval, exception or exit-decision record exists anywhere in this module." },
    ],
  },

  // ── 012B CAPABILITY REGISTRY ─────────────────────────────────────────────────────────────────────
  {
    key: "capabilities", id: "CPR-PD-012B",
    questions: [
      "What capabilities does Practice officially contain?",
      "Who owns each capability and what lifecycle state is it in?",
      "What dependencies, governance class and rollback characteristics apply?",
      "Where is the authoritative 360 view for a capability?",
    ],
    states: [
      { state: "PROPOSED", meaning: "Recognized, not yet approved for production lifecycle.", held: "no", reason: "A capability exists in the catalogue or it does not; there is no state before that." },
      { state: "DEVELOPMENT", meaning: "Under implementation.", held: "no", reason: "Nothing distinguishes a capability being built from one in production use." },
      { state: "INTERNAL", meaning: "Internal or test exposure.", held: "no", reason: "Exposure is controlled at the product's front door by the launch flags, never per capability." },
      { state: "PILOT", meaning: "Named controlled cohort.", held: "no", reason: "There is no cohort a capability could be limited to." },
      { state: "EARLY ACCESS", meaning: "Controlled broader cohort.", held: "no", reason: "The same absence: no opt-in record and no approved cohort." },
      { state: "GA", meaning: "General availability within an approved scope.", held: "no", reason: "There is no approved scope to be generally available within — no market, plan or segment mapping exists for any capability." },
      { state: "DEPRECATED", meaning: "Still available; retirement planned.", held: "no", reason: "Nothing can mark a capability as on its way out, so a practice cannot be warned." },
      { state: "RETIRED", meaning: "No longer available; history retained.", held: "no", reason: "Removing a capability means shipping code that removes it. Nothing blocks that while practices are still using it, which §10 requires." },
    ],
    structure: [
      { element: "Capability searchable table", held: "partial", reason: "All twelve are on one screen with their domains and dependencies. No search box: twelve rows do not need one, and a filter that hid rows would be the only way to lose one." },
      { element: "Lifecycle / domain filters", held: "no", reason: "There is no lifecycle to filter by. Domains are shown per row rather than as a filter, for the same reason." },
      { element: "Capability 360", held: "partial", reason: "Each row carries its dependencies, its dependents, its configuration needs and where the specification stays silent. It has no health, availability or governance section to open into." },
      { element: "Dependencies", held: "yes", reason: "The full graph, in both directions, computed by the exported closure rules rather than restated." },
      { element: "Availability matrix", held: "no", reason: "Nothing maps a capability to a market, a plan or a cohort, so there is no matrix to draw." },
      { element: "Health summary", held: "no", reason: "There is no health telemetry for any capability to summarise." },
      { element: "Governance class", held: "no", reason: "Not modelled for these capabilities." },
      { element: "Release / configuration / history links", held: "no", reason: "No capability points at a release, and its activation history is on the Practice plane." },
    ],
  },

  // ── 012C RELEASE MANAGEMENT ──────────────────────────────────────────────────────────────────────
  {
    key: "management", id: "CPR-PD-012C",
    questions: [
      "What release is planned or deployed, and what does it contain?",
      "Has deployment actually completed and been verified?",
      "Which migrations and configuration changes accompany it?",
      "What is the release risk, approval and rollback state?",
    ],
    states: [
      { state: "PLANNED", meaning: "Release defined.", held: "yes", reason: "A recorded status on the release row." },
      { state: "READY", meaning: "Required gates passed.", held: "no", reason: "No gate result exists, so no release can be marked ready by anything but an opinion." },
      { state: "DEPLOYING", meaning: "Deployment in progress.", held: "yes", reason: "A recorded status — set by a person, so it means somebody said so rather than that anything is running." },
      { state: "DEPLOYED", meaning: "Artifact deployed; verification pending or complete.", held: "partial", reason: "The status exists. The distinction between deployed and verified does not, because nothing verifies." },
      { state: "FAILED", meaning: "Deployment or verification failed.", held: "no", reason: "⚠ Not an allowed value. A failed deployment cannot be recorded as one — it stays as in-progress or is never written down.", citation: "plat_deployments.status check: planned, releasing, released, rolled_back (migration 044:36)" },
      { state: "ROLLED BACK", meaning: "Release exposure or deployment reversed.", held: "yes", reason: "A recorded status. It says a rollback happened and carries no reason, no scope and no verification." },
      { state: "SUPERSEDED", meaning: "Replaced by a later release.", held: "no", reason: "Releases have no relationship to each other, so nothing supersedes anything." },
    ],
    structure: [
      { element: "Release list / calendar", held: "partial", reason: "The list is real. There is no calendar because nothing schedules a release." },
      { element: "Release 360", held: "partial", reason: "Every column the release row has is on the list already; there is nothing further to open into." },
      { element: "Release content", held: "no", reason: "Content is one free-text note. No release names the capabilities, fixes or migrations it carried." },
      { element: "Readiness gate panel", held: "no", reason: "No gate result object. The live product-wide checklist is on Dependencies & Readiness." },
      { element: "Deployment / migration state", held: "no", reason: "Nothing records which migrations have been applied, so migration state cannot be shown at all." },
      { element: "Approval / evidence panel", held: "no", reason: "No approval record and no evidence store." },
      { element: "Post-deploy verification", held: "no", reason: "Nothing verifies a deployment, so a release cannot be completed in the sense §6 means." },
      { element: "Rollback panel", held: "partial", reason: "Rolled-back releases are listed. Rollback strategy and result are on Rollback & Recovery." },
    ],
  },

  // ── 012D FEATURE FLAGS ───────────────────────────────────────────────────────────────────────────
  {
    key: "flags", id: "CPR-PD-012D",
    questions: [
      "Which flags are active in production and why?",
      "Who or what is targeted?",
      "Which flags are temporary or overdue for review?",
      "Can this flag safely stop exposure without bypassing authorization?",
    ],
    states: [
      { state: "DRAFT", meaning: "Not active.", held: "no", reason: "A launch flag exists and is on or off. There is no state before that." },
      { state: "ON", meaning: "Evaluates active for defined targeting.", held: "yes", reason: "Real for all three launch flags, and each one's consequence for the public site is written beside it." },
      { state: "OFF", meaning: "Disabled.", held: "yes", reason: "Real, and it is the safe default: every one of the three starts closed." },
      { state: "SCHEDULED", meaning: "A future change is approved.", held: "no", reason: "A flag changes when somebody changes it. Nothing can be scheduled and nothing can be approved in advance." },
      { state: "EXPIRED", meaning: "A temporary flag has reached its review date.", held: "no", reason: "⚠ No flag carries an expiry or a review date, so a temporary flag is indistinguishable from a permanent one — which is the hidden product state §8 exists to prevent." },
      { state: "RETIRED", meaning: "No longer evaluated.", held: "no", reason: "A flag row is deleted or it is not; there is no retirement that preserves the history of what it used to do." },
    ],
    structure: [
      { element: "Flag inventory", held: "yes", reason: "Both systems, on one screen, each labelled with the product it governs." },
      { element: "Production-risk filter", held: "partial", reason: "What is publicly live is called out at the top of the page rather than filtered for — with three flags, a filter would hide more than it found." },
      { element: "Flag 360", held: "partial", reason: "Each flag shows its state, its consequence and its targeting. It has no owner, type or expiry to show." },
      { element: "Targeting / evaluation rules", held: "partial", reason: "Real for estate flags, which target by tenant, country, plan or cohort. A Practice launch flag is global and has no targeting." },
      { element: "Owner / review / expiry", held: "no", reason: "Neither flag table has any of the three columns." },
      { element: "Change preview", held: "no", reason: "No change is made here, so there is nothing to preview. The consequence of each state is stated permanently instead." },
      { element: "Kill-switch action", held: "no", reason: "The toggle lives on Technical Operations with its own audit trail; a second control here would be a second place to keep the consequences correct." },
      { element: "Audit / history", held: "partial", reason: "A launch-flag flip is audited into the practice trail, which this plane may not read. Estate assignments record who and when." },
    ],
  },

  // ── 012E ROLLOUT MANAGEMENT ──────────────────────────────────────────────────────────────────────
  {
    key: "rollout", id: "CPR-PD-012E",
    questions: [
      "What rollout stage is each capability in?",
      "Who is currently exposed?",
      "Are success and failure thresholds met?",
      "Should we expand, pause, contract, resume or roll back?",
    ],
    states: [
      { state: "PLANNED", meaning: "Rollout not started.", held: "no", reason: "There is no rollout object, so a rollout cannot be planned." },
      { state: "ACTIVE", meaning: "The current stage is exposing a cohort.", held: "no", reason: "No cohort can be defined and no exposure can be recorded." },
      { state: "PAUSED", meaning: "Expansion or exposure paused.", held: "no", reason: "Nothing to pause. Turning a launch flag off closes an entry pathway for everybody instead." },
      { state: "CONTRACTING", meaning: "Exposure being reduced.", held: "no", reason: "No exposure set exists to reduce." },
      { state: "ROLLED BACK", meaning: "Exposure reversed.", held: "no", reason: "A release can be marked rolled back after the fact; no rollout can, because none can be started." },
      { state: "COMPLETE", meaning: "Target scope reached; rollout closed.", held: "no", reason: "No target scope can be expressed, so nothing can reach one." },
    ],
    structure: [
      { element: "Rollout pipeline", held: "partial", reason: "The seven stages are drawn in order with a verdict each. No stage carries a population." },
      { element: "Rollout list", held: "no", reason: "There is no rollout to list." },
      { element: "Cohort / exposure summary", held: "no", reason: "No cohort and no assignment. What IS exposed is the product itself, through the launch ladder shown below the pipeline." },
      { element: "Stage criteria", held: "partial", reason: "Each stage's intent is the specification's own; entry, monitoring and exit criteria have nowhere to be recorded." },
      { element: "Monitoring metrics", held: "no", reason: "No health telemetry exists, so no threshold can be watched or breached." },
      { element: "Decision controls", held: "no", reason: "No decision record. A control that wrote nothing would be worse than saying so." },
      { element: "Pause / expand / contract / rollback actions", held: "no", reason: "Each is listed with the object it would act on, and none of those objects exists." },
      { element: "Rollout history", held: "no", reason: "Nothing to have a history of." },
    ],
  },

  // ── 012F ENTITLEMENTS & AVAILABILITY ─────────────────────────────────────────────────────────────
  {
    key: "entitlements", id: "CPR-PD-012F",
    questions: [
      "Is this Practice, practitioner or cohort entitled to the capability?",
      "Why is the capability available or unavailable?",
      "Which evaluated condition blocked access?",
      "Are there conflicting or stale entitlement rules?",
    ],
    states: [
      { state: "AVAILABLE", meaning: "All required conditions pass.", held: "no", reason: "Six of the eleven conditions cannot be evaluated from this plane, so nothing here may declare a capability available." },
      { state: "UNAVAILABLE", meaning: "At least one blocking condition fails.", held: "partial", reason: "One condition can genuinely block from here: a launch flag that closes the product's front door." },
      { state: "CONDITIONAL", meaning: "Allowed only under an explicit condition or transition.", held: "no", reason: "There is no rule object to carry a condition, and no transition rule anywhere." },
      { state: "UNKNOWN", meaning: "Evidence or rule resolution incomplete; never treat as Available.", held: "yes", reason: "This is the honest state of every capability from this plane, and it is why no resolver is offered — an Unknown that returned Available would be the exact failure §6 forbids." },
    ],
    structure: [
      { element: "Availability resolver", held: "no", reason: "Deliberately not built: it would return a machine-readable verdict from a partial evaluation, which is more convincing and no more correct." },
      { element: "Eligibility matrix", held: "no", reason: "Nothing maps a capability to a plan, a market or a segment, so the matrix has no axes." },
      { element: "Subject lookup", held: "no", reason: "The per-practice answer lives on the Practice plane and this plane may not read it." },
      { element: "Reason-code trace", held: "partial", reason: "The eleven conditions are scored with the reason for each — the same information as a trace, without a decision it cannot support." },
      { element: "Entitlement rule list", held: "no", reason: "There is no entitlement rule object; entitlement is a stored fact about one practice, never a policy." },
      { element: "Conflict / reconciliation queue", held: "no", reason: "A conflict needs two rules to disagree, and there are no rules." },
      { element: "Effective dates", held: "no", reason: "An activation records when it happened, never when it should begin or lapse." },
      { element: "Audit / history", held: "no", reason: "Every activation change is audited — on the Practice plane, outside this one." },
    ],
  },

  // ── 012G MARKET AVAILABILITY ─────────────────────────────────────────────────────────────────────
  {
    key: "markets", id: "CPR-PD-012G",
    questions: [
      "In which markets is the capability available?",
      "What market readiness remains incomplete?",
      "When does availability become effective?",
      "Can a market be suspended or withdrawn safely?",
    ],
    states: [
      { state: "NOT PLANNED", meaning: "No approved market availability.", held: "no", reason: "Nothing records an approval for a market, so nothing records its absence either." },
      { state: "READINESS", meaning: "Market preparation underway.", held: "no", reason: "There is no market readiness checklist to be partway through." },
      { state: "PILOT", meaning: "Limited market pilot.", held: "no", reason: "No pilot object and no market scope for one to run in." },
      { state: "AVAILABLE", meaning: "Approved market availability.", held: "no", reason: "⚠ There is no per-market availability store, so a capability cannot be switched on for one market and not another." },
      { state: "SUSPENDED", meaning: "Temporarily unavailable.", held: "no", reason: "Nothing can be suspended in a market that was never separately enabled." },
      { state: "WITHDRAWN", meaning: "Availability ended.", held: "no", reason: "The same absence, and it takes the historical record with it: §6 requires past market access to stay reconstructable and nothing ever recorded it." },
    ],
    structure: [
      { element: "Market matrix / map / table", held: "partial", reason: "The markets the estate is actually in are listed and are real. They are a property of the practices, not an availability decision." },
      { element: "Market 360", held: "no", reason: "A market is not an object here — it is a country code on a practice." },
      { element: "Readiness checklist", held: "no", reason: "No market readiness evidence of any kind: no localisation, communications, commercial, support or regulatory record per market." },
      { element: "Effective dates", held: "no", reason: "Nothing is effective-dated because nothing is decided." },
      { element: "Market rollout stage", held: "no", reason: "No rollout object and no market scope." },
      { element: "Suspend / withdraw action", held: "no", reason: "Nothing to act on. Closing the product's front door is estate-wide, not per market." },
      { element: "Dependencies", held: "partial", reason: "Each capability's dependencies are real and are the same in every market, because nothing varies by market." },
      { element: "History", held: "no", reason: "No market availability event has ever been recorded." },
    ],
  },

  // ── 012H PLAN AVAILABILITY ───────────────────────────────────────────────────────────────────────
  {
    key: "plans", id: "CPR-PD-012H",
    questions: [
      "Which plans include the capability?",
      "What Commercial plan record is authoritative?",
      "How are grandfathered and transition users handled?",
      "Will a plan mapping change silently interrupt an active workflow?",
    ],
    states: [
      { state: "NOT INCLUDED", meaning: "The plan does not include the capability.", held: "no", reason: "⚠ Nothing joins a capability to a plan in either direction, so neither inclusion nor exclusion can be expressed." },
      { state: "INCLUDED", meaning: "The plan is eligible.", held: "no", reason: "The same absence. A practice's plan and its switched-on capabilities are recorded separately and never meet." },
      { state: "TRANSITION", meaning: "An effective-dated change is underway.", held: "no", reason: "No mapping to change, and no effective date on anything." },
      { state: "GRANDFATHERED", meaning: "Existing eligible users retain governed access.", held: "no", reason: "Grandfathering needs a rule that says who keeps what; there is no rule object at all." },
      { state: "RETIRED", meaning: "The mapping is no longer active.", held: "no", reason: "Nothing to retire." },
    ],
    structure: [
      { element: "Plan-capability matrix", held: "no", reason: "The matrix has one real axis. Plans exist, capabilities exist, and nothing connects a cell." },
      { element: "Plan reference details", held: "partial", reason: "The platform plan catalogue is readable and is shown. The Practice-side catalogue is admitted to this plane as a row count only, so its plan names cannot be listed here." },
      { element: "Effective dates", held: "no", reason: "No mapping to date." },
      { element: "Grandfathering / transition rules", held: "no", reason: "No rule object." },
      { element: "Conflict warnings", held: "no", reason: "Two mappings would be needed to conflict." },
      { element: "Preview affected eligible population", held: "no", reason: "The population entitled to a plan is on the Practice plane, and this plane may not read it." },
      { element: "History", held: "no", reason: "No plan availability event has ever been recorded." },
      { element: "Commercial deep link", held: "yes", reason: "Plans and pricing are Commercial's truth and are linked rather than restated." },
    ],
  },

  // ── 012I PILOT & EARLY ACCESS ────────────────────────────────────────────────────────────────────
  {
    key: "pilot", id: "CPR-PD-012I",
    questions: [
      "Who is in the pilot or early-access cohort?",
      "What are the acceptance criteria and the monitoring window?",
      "What feedback and outcomes have been observed?",
      "Is the exit decision Expand, Extend, Pause, Roll Back or Stop?",
    ],
    states: [
      { state: "DRAFT", meaning: "Pilot being defined.", held: "no", reason: "There is no pilot object to draft." },
      { state: "RECRUITING", meaning: "Participants being assembled.", held: "partial", reason: "Admitting a named person is real and audited — that is what pilot provisioning does. Nothing records that they were admitted INTO a pilot." },
      { state: "ACTIVE", meaning: "Pilot or early access running.", held: "partial", reason: "The product is in exactly this posture today, expressed as a launch-ladder rung rather than as a pilot with a name and an end." },
      { state: "MONITORING", meaning: "Exposure closed or stable while outcomes are assessed.", held: "no", reason: "No outcome is recorded, so there is nothing to assess against." },
      { state: "EXPANDED", meaning: "Approved for the next rollout stage.", held: "no", reason: "There is no next stage to be approved for." },
      { state: "EXTENDED", meaning: "Duration or scope extended.", held: "no", reason: "Nothing has a duration to extend." },
      { state: "PAUSED", meaning: "Temporarily stopped.", held: "partial", reason: "Turning pilot provisioning off stops new admissions immediately. It does not pause anything for the people already in." },
      { state: "STOPPED", meaning: "Ended without expansion.", held: "no", reason: "An ending needs a decision record, and there is none." },
    ],
    structure: [
      { element: "Pilot program list", held: "no", reason: "A pilot is not an object here; it is one boolean saying whether operators may provision at all." },
      { element: "Pilot 360", held: "no", reason: "Nothing to open." },
      { element: "Participant / cohort management", held: "partial", reason: "Participants are admitted through the provisioning workflow, which is real, audited and owned by Product Operations." },
      { element: "Acceptance scorecard", held: "no", reason: "No acceptance criteria are recorded before exposure, which §6 requires, and none are scored afterwards." },
      { element: "Feedback / outcome summary", held: "no", reason: "No feedback or outcome store. ⚠ §6: absence of complaints is not acceptance — today, absence of complaints is all there is." },
      { element: "Monitoring window", held: "no", reason: "No window is defined and nothing is watched." },
      { element: "Exit-decision panel", held: "no", reason: "The five exit decisions are listed with what each would need. None can be recorded." },
      { element: "History", held: "partial", reason: "Who was provisioned and when is real and is shown by Product Operations." },
    ],
  },

  // ── 012J DEPENDENCIES & READINESS ────────────────────────────────────────────────────────────────
  {
    key: "dependencies", id: "CPR-PD-012J",
    questions: [
      "What does this capability or release depend on?",
      "Which readiness gates are Ready, Conditional, Blocked or Unknown?",
      "Is the evidence fresh?",
      "What exactly prevents progression?",
    ],
    states: [
      { state: "READY", meaning: "Required evidence passes.", held: "partial", reason: "Real for the live product-wide checks, which are re-evaluated on every load and so cannot go stale. No per-release or per-capability gate can be ready, because none exists." },
      { state: "CONDITIONAL", meaning: "Proceed only under recorded conditions.", held: "no", reason: "There is no exception record to carry a condition, a scope or an expiry." },
      { state: "BLOCKED", meaning: "A required gate or dependency fails.", held: "partial", reason: "A failing live check is a genuine block on launching the product. Nothing can block a release, because nothing gates one." },
      { state: "UNKNOWN", meaning: "Required evidence is absent or stale.", held: "yes", reason: "The honest state of eight of the twelve gates, and it is never promoted to Ready anywhere in this module." },
      { state: "NOT APPLICABLE", meaning: "The gate is legitimately not required.", held: "no", reason: "Gates are not per-release here, so none can be excused for a particular release." },
    ],
    structure: [
      { element: "Dependency graph / list", held: "yes", reason: "The full capability graph, in both directions, plus the configuration artefacts each capability needs." },
      { element: "Readiness scorecard", held: "partial", reason: "The twelve prescribed gates are scored for what this plane can evidence, and the live checklist is shown separately as the one gate that runs." },
      { element: "Gate evidence", held: "partial", reason: "Real for the live checks, each of which says how it was checked. Absent for every prescribed gate that needs an attestation." },
      { element: "Freshness / status", held: "partial", reason: "The live checks are evaluated at request time, so freshness is the read stamp. Nothing else has evidence to be fresh." },
      { element: "Blockers", held: "yes", reason: "Failing checks are listed with what each one means." },
      { element: "Exception links", held: "no", reason: "No exception or risk-acceptance record exists to link to." },
      { element: "Re-evaluate action", held: "partial", reason: "Reloading the page re-evaluates every live check against the database. There is no stored result to invalidate." },
      { element: "History", held: "no", reason: "Gate results are computed and never stored, so there is no record of what was ready last week." },
    ],
  },

  // ── 012K ROLLBACK & RECOVERY ─────────────────────────────────────────────────────────────────────
  {
    key: "rollback", id: "CPR-PD-012K",
    questions: [
      "How can exposure or change be reversed?",
      "Is rollback actually available and tested?",
      "What irreversible migration constraints exist?",
      "Has recovery been verified after rollback?",
    ],
    states: [
      { state: "READY", meaning: "The rollback and recovery path is validated.", held: "no", reason: "No rollback has ever been rehearsed or validated, so nothing may claim this state." },
      { state: "LIMITED", meaning: "Rollback is possible with constraints.", held: "partial", reason: "This is the true state of the two reversals that do work — closing an entry pathway, and restoring an estate configuration change set from its checkpoint. Both are real and neither restores a capability." },
      { state: "UNAVAILABLE", meaning: "No safe direct rollback; alternate recovery required.", held: "yes", reason: "The honest state for a released version and for any capability change. Nothing here can revert either." },
      { state: "EXECUTING", meaning: "Rollback or recovery in progress.", held: "no", reason: "No rollback runs from here, so nothing can be in progress." },
      { state: "RECOVERED", meaning: "Recovery verified.", held: "no", reason: "⚠ Verification needs health evidence and critical-journey checks, and there are none. A rollback can be recorded and can never be confirmed to have worked." },
      { state: "FAILED", meaning: "Rollback or recovery failed; incident escalation required.", held: "no", reason: "A rollback that failed cannot be distinguished from one that was never attempted." },
    ],
    structure: [
      { element: "Rollback readiness summary", held: "partial", reason: "Each of the five prescribed options is scored for whether it exists here." },
      { element: "Rollback strategy", held: "no", reason: "§6 requires a strategy declared BEFORE material expansion. There is no plan object, so no strategy has ever been declared." },
      { element: "Recovery options", held: "yes", reason: "Two are real and are named with exactly what each reverses." },
      { element: "Migration reversibility", held: "no", reason: "⚠ Nothing records which migrations have been applied, let alone whether any could be undone — so an irreversible data migration cannot be labelled before approval." },
      { element: "Emergency controls", held: "partial", reason: "The launch flags are genuine emergency controls for entry, they fail toward closed, and their console is linked rather than duplicated." },
      { element: "Execution ledger", held: "no", reason: "No rollback executes from here, so there is nothing to ledger." },
      { element: "Post-recovery verification", held: "no", reason: "No health or journey evidence to verify with." },
      { element: "History", held: "partial", reason: "Releases marked rolled back are listed. They carry no reason, no scope and no outcome." },
    ],
  },

  // ── 012L RELEASE HISTORY ─────────────────────────────────────────────────────────────────────────
  {
    key: "history", id: "CPR-PD-012L",
    questions: [
      "What was released, exposed, changed or rolled back, and when?",
      "Who approved or changed it?",
      "Who had access at a material point in time?",
      "What incidents or health changes correlated with the release history?",
    ],
    states: [
      { state: "RECORDED", meaning: "An immutable or versioned history event was accepted.", held: "partial", reason: "Three streams are timestamped and attributed. Two of them are append-only event logs; the third records assignments that are created and never versioned, so it says what was set and not what it changed from." },
      { state: "RESTRICTED", meaning: "The event exists but its detail needs an elevated capability.", held: "partial", reason: "Nothing here is capability-restricted within the module. The genuinely restricted stream is the practice's own audit trail, which is refused to this plane entirely rather than shown with its detail hidden." },
    ],
    structure: [
      { element: "Unified timeline", held: "yes", reason: "Three streams merged in time order, each event labelled with the stream it came from." },
      { element: "Filters by capability, release, market, plan, environment", held: "no", reason: "None of those five is recorded on any event, so there is nothing to filter on." },
      { element: "Change comparison", held: "no", reason: "No event records a before and an after, so no two states can be compared." },
      { element: "Approval / evidence links", held: "no", reason: "No approval or evidence record exists." },
      { element: "Incident / health overlays", held: "no", reason: "No incident or health store to overlay." },
      { element: "Historical availability reconstruction", held: "no", reason: "⚠ §6's core requirement. Who had which capability at a past moment is recorded — in the practice's own event log, on the plane this one may not read." },
      { element: "Export", held: "no", reason: "Export is a separate governed capability and there is no evidence pack to export." },
      { element: "Audit drill-through", held: "partial", reason: "Each event names its stream and its actor where one was recorded. There is no deeper record to open." },
    ],
  },
];

export const subSpec = (key: string): SubSpec => {
  const s = SUBSPECS.find(x => x.key === key);
  if (!s) throw new Error(`no sub-specification for ${key}`);
  return s;
};

/** How many of a sub-specification's prescribed elements this build can actually show. */
export const structureScore = (s: SubSpec) => ({
  yes: s.structure.filter(x => x.held === "yes").length,
  partial: s.structure.filter(x => x.held === "partial").length,
  no: s.structure.filter(x => x.held === "no").length,
  total: s.structure.length,
});

/** How many of a sub-specification's prescribed states anything in this product can hold. */
export const stateScore = (s: SubSpec) => ({
  yes: s.states.filter(x => x.held === "yes").length,
  partial: s.states.filter(x => x.held === "partial").length,
  no: s.states.filter(x => x.held === "no").length,
  total: s.states.length,
});

// ── THE SUBMODULES (§2) ──────────────────────────────────────────────────────────────────────────────

export type Submodule = {
  key: string; title: string; href: string; spec: string;
  /** §2's PURPOSE column, in its own words. */
  purpose: string;
  /** What this build can actually put on the page. One sentence, never a promise. */
  standing: string;
};

export const SUBMODULES: Submodule[] = [
  {
    key: "capabilities", title: "Capability Registry", href: "/super-admin/pd/releases/capabilities",
    spec: "§3, §4",
    purpose: "Canonical catalogue of meaningful Practice capabilities and lifecycle metadata.",
    standing: "The twelve capabilities, their areas and their full dependency graph are real and shipped. Lifecycle, owner and governance class have no column.",
  },
  {
    key: "management", title: "Release Management", href: "/super-admin/pd/releases/management",
    spec: "§6",
    purpose: "Release records, scope, versions, change content, approvals and deployment state.",
    standing: "The release log is real and hand-written: no pipeline feeds it. Content, risk class and approvals have no column.",
  },
  {
    key: "flags", title: "Feature Flags", href: "/super-admin/pd/releases/flags",
    spec: "§8",
    purpose: "Governed flags controlling capability exposure and behaviour boundaries.",
    standing: "Three real Practice launch flags with their consequences, and the estate flag catalogue on its own plane. Owner, type and expiry exist on neither.",
  },
  {
    key: "rollout", title: "Rollout Management", href: "/super-admin/pd/releases/rollout",
    spec: "§9",
    purpose: "Progressive rollout cohorts, percentages, stages, pauses and expansion.",
    standing: "The seven stages with a verdict each. No rollout object exists, and percentage rollout has neither a store nor a bucketing mechanism.",
  },
  {
    key: "entitlements", title: "Entitlements & Availability", href: "/super-admin/pd/releases/entitlements",
    spec: "§10, §11",
    purpose: "Who, which Practice, plan or segment is permitted to access a capability.",
    standing: "The three different things this codebase calls a capability, kept apart, and §11's resolver scored condition by condition.",
  },
  {
    key: "markets", title: "Market Availability", href: "/super-admin/pd/releases/markets",
    spec: "§12",
    purpose: "Country and market availability and market-specific readiness.",
    standing: "The markets the estate is actually in. No capability-to-market permission mapping exists.",
  },
  {
    key: "plans", title: "Plan Availability", href: "/super-admin/pd/releases/plans",
    spec: "§13",
    purpose: "Plan and tier mapping, without duplicating Commercial plan truth.",
    standing: "Both plan catalogues, named and counted. Nothing joins a capability to a plan in either direction.",
  },
  {
    key: "pilot", title: "Pilot & Early Access", href: "/super-admin/pd/releases/pilot",
    spec: "§14",
    purpose: "Named pilots, cohorts, acceptance criteria and exit or expansion decisions.",
    standing: "Pilot provisioning is a real boolean and the provisioning queue is real. A pilot with participants, criteria and an exit decision is not an object here.",
  },
  {
    key: "dependencies", title: "Dependencies & Readiness", href: "/super-admin/pd/releases/dependencies",
    spec: "§7, §15",
    purpose: "Technical, configuration, governance, operational and journey-readiness gates.",
    standing: "The capability dependency graph is real. Of §7's twelve gates none has an evidence record; the live cutover checklist is what does exist.",
  },
  {
    key: "rollback", title: "Rollback & Recovery", href: "/super-admin/pd/releases/rollback",
    spec: "§16",
    purpose: "Safe reversal, kill switches, rollback readiness and post-rollback verification.",
    standing: "Rollback is a recorded status, not a declared plan. The launch flags are the one real kill switch, and they withdraw the door rather than a feature.",
  },
  {
    key: "history", title: "Release History", href: "/super-admin/pd/releases/history",
    spec: "§18",
    purpose: "Longitudinal release, flag, rollout, availability and rollback audit history.",
    standing: "Three timestamped, actor-attributed streams merged. The fourth and richest is on the Practice plane and refused here.",
  },
];

export const submodule = (key: string) => SUBMODULES.find(s => s.key === key) ?? null;

// ── CAPABILITY LIFECYCLE (§4) ────────────────────────────────────────────────────────────────────────
//
// ⚠ AUTHORED, NOT MEASURED, AND DELIBERATELY SO. Each verdict is a statement about the SCHEMA — a check
// constraint, a type declaration, a missing column — read by hand at the line named. A runtime probe
// could not produce these sentences: "no capability is in Pilot" and "Pilot is not a state anything can
// hold" are the same empty result and opposite facts, and only the second is true here.

export type LifecycleState = {
  /** §4's STATE column, in its own words. */
  state: string;
  /** §4's MEANING column, in its own words. */
  meaning: string;
  /** What in this schema could hold it, or null when nothing can. */
  represented: string | null;
};

export const LIFECYCLE: LifecycleState[] = [
  { state: "PROPOSED", meaning: "Recognized capability not yet approved for build or release.", represented: null },
  { state: "DEVELOPMENT", meaning: "Under implementation; unavailable to production users.", represented: null },
  { state: "INTERNAL", meaning: "Available only to authorized internal or test users.", represented: null },
  { state: "PILOT", meaning: "Available to a named controlled pilot cohort.", represented: null },
  { state: "EARLY ACCESS", meaning: "Limited opt-in or controlled broader cohort.", represented: null },
  {
    state: "GENERAL AVAILABILITY",
    meaning: "Approved production availability within a defined market and plan scope.",
    represented: null,
  },
  { state: "DEPRECATED", meaning: "Still available, but replacement or retirement is planned.", represented: null },
  { state: "RETIRED", meaning: "No longer available; the historical record is retained.", represented: null },
];

/**
 * ⚠ WHY EVERY ROW ABOVE READS `null` AND THAT IS NOT LAZINESS.
 *
 * There is exactly one state-like column near a Practice capability —
 * practice_capability_activation.state, constrained to ('active','inactive') at migration 278:123 —
 * and mapping GENERAL AVAILABILITY onto `active` would be the precise error §4 forbids. `active` is one
 * customer's switch position; GA is a declaration this company makes about a product. A practice that
 * has switched Documents off has not moved Documents out of general availability.
 */
export const LIFECYCLE_ABSENCE =
  "None of the eight states can be held by anything in this schema. The only state-like column near a "
  + "capability is practice_capability_activation.state, constrained to active or inactive "
  + "(migration 278:123) — one PRACTICE'S switch position, not a product stage. Reading `active` as "
  + "General Availability is the exact collapse §4 forbids: a practice that switched Documents off has "
  + "not moved Documents out of GA.";

// ── THE ROLLOUT PIPELINE (§9) ────────────────────────────────────────────────────────────────────────
//
// ⚠ THE COMP DRAWS THIS AS A PIPELINE WITH STAGE COUNTS AND A PERCENTAGE DIAL. The shape is kept and
// every count is refused, because a stage that cannot be entered cannot hold a population — and a
// pipeline drawn with plausible numbers would tell a Product Director that this product does
// progressive delivery, which is the single most expensive false impression this module could give.

export type StageState =
  /** A real control exists that produces this stage's effect. */
  | "controlled"
  /** Something related exists but does not implement the stage. */
  | "partial"
  /** Nothing in this product can enter, hold, count or leave this stage. */
  | "absent";

export type RolloutStage = {
  /** §9's STAGE column, verbatim. */
  stage: string;
  /** §9's INTENT column, verbatim. */
  intent: string;
  state: StageState;
  /** What implements it, in the product's language, or null when nothing does. */
  engine: string | null;
  /** The verdict, still in the product's language. */
  verdict: string;
  /**
   * ⚠ THE FORENSIC CITATION — migration, file and line. DISCLOSURE BODIES ONLY, never a visible
   * sentence: PD-001 §3 keeps implementation detail off a director surface, and this module's method
   * needs a reader to be able to CHECK a verdict rather than trust it. Both hold, one click apart.
   */
  citation: string | null;
};

export const STAGE_STATE_LABEL: Record<StageState, string> = {
  controlled: "A real control does this",
  partial: "Related control, not this stage",
  absent: "Cannot be entered or counted",
};

export const ROLLOUT_STAGES: RolloutStage[] = [
  {
    stage: "Internal",
    intent: "Competen-authorized internal and test use.",
    state: "controlled",
    engine: "The pilot-provisioning launch flag, and the provisioning saga behind it.",
    verdict:
      "This one genuinely works, and it is the launch ladder's first rung. With pilot provisioning on "
      + "and sign-in off, the only way into Competen Practice is a platform operator creating a "
      + "workspace for a named person. That is internal-only exposure, enforced at the door.",
    citation: "practice_platform_flags.practice_pilot_provisioning (migration 191:256); src/lib/practice/provisioning.ts",
  },
  {
    stage: "Synthetic / Test",
    intent: "Controlled automated and test-workspace verification.",
    state: "partial",
    engine: "The workspace type, which can label a test practice.",
    verdict:
      "A workspace carries a type, so a test practice can be labelled — but nothing marks one as "
      + "synthetic for the purpose of excluding it from a rollout, because there is no rollout to "
      + "exclude it from. The requirement that pilot users be clearly distinguishable from synthetic "
      + "workspaces has no field to make the distinction in.",
    citation: "practice_workspace.type (migration 191); PD-012 §14",
  },
  {
    stage: "Named Pilot",
    intent: "Specific named pilot users and Practices.",
    state: "partial",
    engine: "The provisioning request and its step ledger, which admit a named person and record what happened.",
    verdict:
      "The MECHANICS of admitting a named person are real and auditable. The PILOT is not: there is no "
      + "pilot program record, no participant list, no capability under test, no acceptance criteria "
      + "and no exit decision. So this product can let a named person in, and cannot say which pilot "
      + "they are in or what would end it.",
    citation: "provisioning_request / provisioning_step (migration 191) — target_user_id, status, error_code",
  },
  {
    stage: "Early Access",
    intent: "Controlled opt-in or approved cohort.",
    state: "absent",
    engine: null,
    verdict:
      "No opt-in record and no approved-cohort object. The one cohort table that exists is a "
      + "Product-Intelligence analytics cohort built to segment practices for measurement, not to gate "
      + "exposure — and it sits on the Practice plane, which this one may not read.",
    citation: "practice_cohort (migration 305) — analytics, Practice plane, outside PRACTICE_ALLOWLIST",
  },
  {
    stage: "Percentage Rollout",
    intent: "Progressive exposure to an eligible population.",
    state: "absent",
    engine: null,
    verdict:
      "⚠ THE ABSENCE THIS PAGE EXISTS TO STATE. No table has a percentage column, and no deterministic "
      + "bucketing function exists to make an assignment sticky per subject, which §9 requires in the "
      + "same breath. The estate's flag targeting selects by scope — everybody, a tenant, a country, a "
      + "plan or a cohort — and never by proportion. A percentage cannot be stored, and could not be "
      + "applied if it were.",
    citation: "plat_feature_flag_assignments.scope_type in (global, tenant, country, plan, cohort) — migration 042:101. No percentage column exists in any migration",
  },
  {
    stage: "Market / Plan Rollout",
    intent: "Availability expanded to selected markets and plans.",
    state: "absent",
    engine: null,
    verdict:
      "Nothing maps a capability to a market or to a plan. The country of a practice and the plan on "
      + "its entitlement both exist, and both describe WHERE A PRACTICE IS rather than WHERE A "
      + "CAPABILITY IS PERMITTED — a distinction §12 makes explicitly and §13 depends on.",
    citation: "practice_workspace.country and practice_entitlement.plan_code (migration 191) carry no capability reference",
  },
  {
    stage: "General Availability",
    intent: "Approved full eligible scope.",
    state: "absent",
    engine: null,
    verdict:
      "GA is a lifecycle declaration, and no capability can hold a lifecycle state at all. The nearest "
      + "real thing is the launch ladder's top rung — public signup open — which is general "
      + "availability of the PRODUCT'S FRONT DOOR, not of any capability within it.",
    citation: "no lifecycle column on CapabilityDefinition (src/lib/practice/capability-registry.ts:99-112) or on any table",
  },
];
// ── THE READINESS GATES (§7) ─────────────────────────────────────────────────────────────────────────

export type GateState =
  /** A live check answers this question today. */
  | "live"
  /** Part of the question is answerable; the rest has no evidence. */
  | "partial"
  /** Nothing records the evidence this gate would read. */
  | "no-evidence";

export type ReadinessGate = {
  /** §7's GATE column, verbatim. */
  gate: string;
  /** §7's MINIMUM QUESTION column, verbatim. */
  question: string;
  state: GateState;
  verdict: string;
  /** Migration, file and line. Disclosure bodies only — see the note on RolloutStage.citation. */
  citation: string | null;
};

export const GATE_STATE_LABEL: Record<GateState, string> = {
  live: "A live check answers this",
  partial: "Partly answerable",
  "no-evidence": "No evidence store",
};

export const READINESS_GATES: ReadinessGate[] = [
  {
    gate: "Build / deployment",
    question: "Is the approved code or artifact deployed to the intended environment?",
    state: "partial",
    verdict:
      "A release row states a version and a channel, and the live cutover checklist proves the Practice "
      + "routes exist in this build. Neither is evidence that a particular artifact reached a particular "
      + "environment: nothing writes the release log except a person.",
    citation: "plat_deployments.version / channel / status (migration 044:32-41)",
  },
  {
    gate: "Migrations",
    question: "Are required migrations complete and compatible?",
    state: "no-evidence",
    verdict:
      "⚠ THERE IS NO MIGRATION LEDGER. Applied-migration state is not recorded in this database in any "
      + "queryable form, and migrations may be applied out of order here. The cutover checklist infers "
      + "one migration family from a row count — a proxy for four migrations out of three hundred, "
      + "presented as one.",
    citation: "operations.ts:262-264 counts practice_role_capabilities to conclude migrations 191-194 are live",
  },
  {
    gate: "Configuration",
    question: "Are required configurations valid and effective?",
    state: "partial",
    verdict:
      "The configuration publishing service validates schema and dependencies before a change set goes "
      + "live, and stores the result. It governs the ESTATE's configuration objects; no Competen "
      + "Practice setting is one of them, so no Practice configuration is validated by it.",
    citation: "configuration_releases.validation (migration 099:20)",
  },
  {
    gate: "Dependencies",
    question: "Are critical internal and external dependencies healthy or ready?",
    state: "partial",
    verdict:
      "The dependency GRAPH is real and complete — which capability needs which, and which "
      + "configuration artefacts each one needs before it can work. Whether a dependency is HEALTHY is "
      + "a Product Health question, and there is no health store to ask.",
    citation: "CapabilityDefinition.requires / requiresSetup (src/lib/practice/capability-registry.ts:99-112)",
  },
  {
    gate: "Security",
    question: "Are required security checks and approvals complete?",
    state: "no-evidence",
    verdict:
      "No attestation record exists. §7 requires a manual gate to carry a named attestation and a "
      + "timestamp; there is nowhere to write either, so a security sign-off cannot be recorded, "
      + "produced as evidence, or found to be stale.",
    citation: null,
  },
  {
    gate: "Privacy",
    question: "Are required privacy and data-governance checks complete?",
    state: "no-evidence",
    verdict: "The same absence as Security: no gate definition, no result row, no attestation.",
    citation: null,
  },
  {
    gate: "Clinical safety",
    question: "Are required safety reviews and verification complete?",
    state: "no-evidence",
    verdict:
      "The same absence, and the one that matters most: this is a clinical product, and a release "
      + "cannot record that a clinical-safety review happened. ⚠ The CONFIGURATION registry does carry "
      + "a safety classification with the right vocabulary — on an object set that contains no Practice "
      + "capability.",
    citation: "configuration_registry_objects.safety_classification (migration 092), nine values, no Practice object",
  },
  {
    gate: "Product Health",
    question: "Are the relevant services and components healthy?",
    state: "no-evidence",
    verdict:
      "There is no health telemetry of any kind: no health-issue store, no service check, no error "
      + "rate. Product Health renders its service rows as Unknown for this reason, and a gate reading "
      + "from them would inherit that Unknown rather than resolve it.",
    citation: null,
  },
  {
    gate: "Critical journeys",
    question: "Do required end-to-end practitioner journeys pass?",
    state: "partial",
    verdict:
      "One journey is genuinely proven: the clinical loop closed at least once, measured from real "
      + "encounter rows rather than asserted. It is a historical fact about the estate and not a check "
      + "that runs per release — once true it stays true, so it cannot fail a release the way §7 "
      + "intends.",
    citation: "the `clinical` item of evaluateGate (src/lib/practice/operations.ts:275)",
  },
  {
    gate: "Support readiness",
    question: "Are support, runbooks and incident ownership ready?",
    state: "no-evidence",
    verdict:
      "No runbook register and no incident-ownership record exist. The pilot walkthrough is a document "
      + "in the repository, which is a real artefact and is not a queryable gate result.",
    citation: "docs/CPR-GATE-001-pilot-walkthrough.md — a document, not a store",
  },
  {
    gate: "Pilot acceptance",
    question: "Where applicable, have pilot acceptance criteria passed?",
    state: "no-evidence",
    verdict:
      "There is no pilot object to carry criteria and no acceptance record to hold a verdict. §14 is "
      + "explicit that absence of complaints is not acceptance; today, absence of complaints is all "
      + "there is.",
    citation: null,
  },
  {
    gate: "Commercial / market",
    question: "Are plan, market and communication prerequisites ready?",
    state: "no-evidence",
    verdict:
      "Both plan catalogues exist and neither connects to a capability, so a commercial prerequisite "
      + "cannot be expressed against the thing being released.",
    citation: "plat_plans (migration 042) and practice_plans (migration 191:249) carry no capability column",
  },
];
// ── THE AVAILABILITY RESOLVER (§11) ──────────────────────────────────────────────────────────────────

export type ConditionState =
  /** This condition can be evaluated from this plane today. */
  | "resolves"
  /** The fact exists on the Practice plane and this plane may not read it. */
  | "refused"
  /** Nothing anywhere records the fact this condition tests. */
  | "no-store";

export type ResolverCondition = {
  /** §11's CONDITION column, verbatim. */
  condition: string;
  /** §11's EXAMPLE column, verbatim. */
  example: string;
  state: ConditionState;
  verdict: string;
  /** Migration, file and line. Disclosure bodies only — see the note on RolloutStage.citation. */
  citation: string | null;
};

export const CONDITION_STATE_LABEL: Record<ConditionState, string> = {
  resolves: "Evaluable here",
  refused: "Exists, refused to this plane",
  "no-store": "No store at all",
};

export const RESOLVER_CONDITIONS: ResolverCondition[] = [
  {
    condition: "Capability lifecycle", example: "Pilot / Early Access / GA permits the target scope.",
    state: "no-store",
    verdict: "No capability carries a lifecycle state, so this condition has nothing to test.",
    citation: "no lifecycle field on CapabilityDefinition (src/lib/practice/capability-registry.ts:99-112)",
  },
  {
    condition: "Deployment", example: "The required release or version is deployed.",
    state: "no-store",
    verdict:
      "A release cannot say which capabilities it contains, so no capability can name the release it "
      + "requires. The link §6 asks for does not exist in either direction.",
    citation: "plat_deployments has no release_item and no capability reference (migration 044:32-41)",
  },
  {
    condition: "Environment", example: "The correct production environment.",
    state: "resolves",
    verdict:
      "There is one production environment and every read on this page is against it. A "
      + "single-environment answer is a real answer, and stating it is different from pretending to a "
      + "matrix.",
    citation: null,
  },
  {
    condition: "Market", example: "Uganda, Kenya or another approved market is included.",
    state: "no-store",
    verdict:
      "No capability-to-market mapping exists. The markets practices are IN are readable and are shown "
      + "on Market Availability, labelled as a property of the estate rather than a permission.",
    citation: "practice_workspace.country (migration 191:41) describes the practice, not the capability",
  },
  {
    condition: "Plan / segment", example: "An eligible plan or segment.",
    state: "no-store",
    verdict:
      "Nothing joins a capability to a plan. Both plan catalogues exist; neither has a capability "
      + "column, and no activation row carries a plan.",
    citation: "plat_plans (042), practice_plans (191:249), practice_capability_activation (278:85) — no shared key",
  },
  {
    condition: "Subject entitlement", example: "The Practice, practitioner or cohort is entitled.",
    state: "refused",
    verdict:
      "This one is REAL, and this plane may not read it. The per-workspace answer and the per-person "
      + "permission are both recorded by the Practice product, in tables outside the platform-plane "
      + "allowlist.",
    citation: "practice_capability_activation (278:85), practice_role_assignment (191:84) — not in PRACTICE_ALLOWLIST",
  },
  {
    condition: "Feature flag", example: "The exposure flag evaluates ON for the subject.",
    state: "resolves",
    verdict:
      "Only for the three launch flags, which are global rather than per subject: they decide whether "
      + "anybody may provision, sign in or sign up at all. No per-subject Practice flag exists.",
    citation: "practice_platform_flags (migration 191:256) — flag, enabled, note. No scope column",
  },
  {
    condition: "Configuration", example: "The required configuration is valid.",
    state: "refused",
    verdict:
      "Each capability declares the configuration artefacts it needs — locations, availability, "
      + "registration and the rest — and whether a given practice has completed them lives in that "
      + "practice's own configuration, off this plane.",
    citation: "practice_configuration (migration 191:101) and about twenty domain tables, none allowlisted",
  },
  {
    condition: "Dependencies", example: "A required dependency is available or acceptable.",
    state: "resolves",
    verdict:
      "The declared dependency graph resolves fully from code, in both directions, and its closure "
      + "functions are exported rather than restated. What cannot be resolved is a dependency's HEALTH.",
    citation: "requiredClosure / dependentClosure (src/lib/practice/capability-registry.ts)",
  },
  {
    condition: "Governance constraints", example: "No blocking safety, privacy, security or risk decision.",
    state: "no-store",
    verdict:
      "There is no product-risk decision record that a capability could be blocked by, so this "
      + "condition would always evaluate positively — which is not the same as there being no blocker.",
    citation: null,
  },
  {
    condition: "Operational block", example: "No emergency kill switch or incident block.",
    state: "no-store",
    verdict:
      "No capability kill switch exists. The launch flags can close the door to the product; nothing "
      + "can withdraw one capability across the estate.",
    citation: null,
  },
];
// ── THE LAUNCH LADDER MIGRATION (§19) ────────────────────────────────────────────────────────────────

export type MigrationRow = {
  /** §19's CURRENT CONCEPT column, verbatim. */
  current: string;
  /** §19's TARGET MODEL column, verbatim. */
  target: string;
  /** Does the current control genuinely exist here? */
  currentReal: boolean;
  /** Does the destination it is supposed to migrate INTO exist? */
  targetReal: boolean;
  note: string;
};

export const MIGRATION_MAP: MigrationRow[] = [
  {
    current: "practice_pilot_provisioning flag",
    target: "Pilot & Early Access plus a governed provisioning capability.",
    currentReal: true, targetReal: false,
    note:
      "The flag is real, ordered first on the ladder, and carries a written consequence. The pilot "
      + "object it should become has no table.",
  },
  {
    current: "practice_sign_in flag",
    target: "A capability or operational exposure flag linked to the identity and sign-in capability.",
    currentReal: true, targetReal: false,
    note:
      "Real, and the most consequential of the three: on, the public page renders a live password "
      + "field. There is no capability object for sign-in to link it to.",
  },
  {
    current: "practice_public_signup flag",
    target: "A public signup capability with lifecycle, rollout, market/plan scope and readiness.",
    currentReal: true, targetReal: false,
    note:
      "Real, and it is the launch ladder's top rung. Every one of the four things §19 wants it to "
      + "acquire — lifecycle, rollout, market/plan scope, readiness — is absent.",
  },
  {
    current: "IAM-001 cutover gate",
    target: "A reusable Release Readiness Gate framework.",
    currentReal: true, targetReal: false,
    note:
      "The checklist is real, runs live against the database, and keeps its human-attested items "
      + "separate. It is a hard-coded list in one function, not a gate definition anything else can "
      + "reuse — and generalising it is the single highest-value piece of work in this module.",
  },
  {
    current: "Provisioning queue",
    target: "Product Operations retains the authoritative technical workflow; linked from release and pilot readiness.",
    currentReal: true, targetReal: true,
    note:
      "The one row where both halves exist. The saga, its step ledger and its failure consequences are "
      + "real and already surfaced by Product Operations, which is where they stay.",
  },
  {
    current: "Private pilot state",
    target: "A capability lifecycle or rollout stage rather than a hard-coded page state.",
    currentReal: true, targetReal: false,
    note:
      "launchState() derives the named state from the three flags rather than storing it separately, "
      + "which is the right shape already. Its destination — a lifecycle or a stage — does not exist.",
  },
];

// ── §25's TECHNICAL OBJECTS ──────────────────────────────────────────────────────────────────────────

export type TechnicalObject = { name: string; exists: boolean; where: string };

export const TECHNICAL_OBJECTS: TechnicalObject[] = [
  { name: "capability", exists: true, where: "shipped as code constants rather than as a governed table" },
  { name: "capability_version", exists: false, where: "no version is carried on a capability" },
  { name: "capability_dependency", exists: true, where: "`requires` / `requiresSetup` / `recommends`, with exported closure functions" },
  { name: "release", exists: true, where: "the platform release log — version, channel, status, notes" },
  { name: "release_item", exists: false, where: "release content is one free-text notes column" },
  { name: "deployment_record", exists: false, where: "no environment-level deployment record; the release row IS the only artefact" },
  { name: "readiness_gate_definition", exists: false, where: "the cutover checklist is a hard-coded list in one function" },
  { name: "readiness_gate_result", exists: false, where: "evaluated on every page load, never stored, never attested" },
  { name: "feature_flag", exists: true, where: "two flag tables, on two different planes: the Practice launch flags and the estate catalogue" },
  { name: "feature_flag_version", exists: false, where: "a flag row is updated in place; there is no version history" },
  { name: "flag_target", exists: true, where: "estate flag assignments — targeting on the hospital estate plane only" },
  { name: "rollout", exists: false, where: "no rollout object of any kind" },
  { name: "rollout_stage", exists: false, where: "no stage model" },
  { name: "rollout_cohort", exists: false, where: "no release cohort" },
  { name: "rollout_assignment", exists: false, where: "no assignment, and no bucketing function that could produce one" },
  { name: "entitlement_rule", exists: false, where: "no rule object" },
  { name: "entitlement_grant", exists: true, where: "the per-practice activation row, on the Practice plane" },
  { name: "market_availability", exists: false, where: "no capability-to-market mapping" },
  { name: "plan_availability", exists: false, where: "no capability-to-plan mapping" },
  { name: "pilot_program", exists: false, where: "one boolean flag, no program" },
  { name: "pilot_participant", exists: false, where: "provisioning_request names a target user, not a pilot participant" },
  { name: "pilot_acceptance", exists: false, where: "no acceptance criteria and no exit decision" },
  { name: "rollback_plan", exists: false, where: "no plan is declared before expansion, as §16 requires" },
  { name: "rollback_event", exists: true, where: "a release status, not an event carrying a reason or a scope" },
  { name: "capability_availability_decision", exists: false, where: "no resolver and no decision record" },
  { name: "release_history_event", exists: true, where: "the configuration change-set event log" },
  { name: "release_audit_event", exists: true, where: "the platform audit trail, plus the practice trail for a launch-flag flip — the latter off this plane" },
];

// ── ROLLBACK OPTIONS (§16) ───────────────────────────────────────────────────────────────────────────

export type RollbackOption = {
  option: string;
  available: boolean;
  detail: string;
};

export const ROLLBACK_OPTIONS: RollbackOption[] = [
  {
    option: "Feature flag off",
    available: true,
    detail:
      "Real, immediate and audited for the three launch flags: PATCH /api/v1/practice/flags writes the "
      + "row and an audit event, gated on hq.practice.flags.manage. It closes an entry pathway — "
      + "provisioning, sign-in or signup — and cannot withdraw a capability from practices already "
      + "inside.",
  },
  {
    option: "Cohort contraction",
    available: false,
    detail: "There is no cohort to contract: no rollout, no assignment, no exposure set.",
  },
  {
    option: "Prior artifact or version",
    available: false,
    detail:
      "plat_deployments records that a version was released and can be marked rolled_back. Nothing in "
      + "this database performs or verifies the revert — the status is a note somebody wrote.",
  },
  {
    option: "Configuration rollback",
    available: true,
    detail:
      "Real for ESTATE configuration: a change set holds pre-activation "
      + "snapshots of every object in the change set, which is a genuine restore point. It contains no "
      + "Competen Practice setting.",
  },
  {
    option: "Operational kill switch",
    available: false,
    detail:
      "No kill switch exists for any CP.* capability. Deactivation is per workspace and belongs to the "
      + "practice, not to the landlord.",
  },
];

// ── CAPABILITY ATTRIBUTES (§3) ───────────────────────────────────────────────────────────────────────

export type AttributeRow = {
  /** §3's ATTRIBUTE column, verbatim. */
  attribute: string;
  /** §3's REQUIREMENT column, verbatim. */
  requirement: string;
  present: boolean;
  where: string;
};

export const CAPABILITY_ATTRIBUTES: AttributeRow[] = [
  { attribute: "Capability ID / key", requirement: "Stable namespaced identifier.", present: true, where: "the twelve-id union, and the database rejects a thirteenth" },
  { attribute: "Name / description", requirement: "Human-readable product capability and value.", present: true, where: "displayName and area on each definition" },
  { attribute: "Domain", requirement: "Booking, encounter, documents, AI, commercial, communications, offline and so on.", present: true, where: "`area`, a neutral noun phrase per capability" },
  { attribute: "Owner", requirement: "Named product or domain owner.", present: false, where: "no owner field anywhere" },
  { attribute: "Lifecycle", requirement: "Proposed, Development, Internal, Pilot, Early Access, GA, Deprecated, Retired.", present: false, where: "no lifecycle field; see §4 above" },
  { attribute: "Release / version", requirement: "Current applicable release or version.", present: false, where: "no capability-to-release link in either direction" },
  { attribute: "Dependencies", requirement: "Technical, product, configuration and provider dependencies.", present: true, where: "`requires`, `requiresSetup`, `recommends` plus exported closures" },
  { attribute: "Configuration schema", requirement: "Reference to Product Configuration definitions.", present: false, where: "`requiresSetup` names five artefacts by key; none is a registry object" },
  { attribute: "Availability", requirement: "Markets, plans, segments or cohorts and exclusions.", present: false, where: "no market, plan, segment or cohort mapping" },
  { attribute: "Health", requirement: "Reference to Product Health state and journeys.", present: false, where: "no health store to reference" },
  { attribute: "Governance class", requirement: "Security, privacy, clinical or commercial review requirements.", present: false, where: "not modelled for CP.* capabilities" },
  { attribute: "Rollback", requirement: "Rollback or kill-switch support and constraints.", present: false, where: "no kill switch and no declared constraint" },
  { attribute: "Documentation", requirement: "Product, technical and support references.", present: true, where: "`specDependencies` and `unmodelled` quote the specification cell and say where this registry stays silent" },
];

// ── DEPENDENCY GRAPH (§15) ───────────────────────────────────────────────────────────────────────────

export type CapabilityNode = {
  def: CapabilityDefinition;
  /** Transitive requirements, dependencies first. Never includes the capability itself. */
  closure: CapabilityId[];
  /** Everything that would be left standing on nothing if this went away. */
  dependents: CapabilityId[];
  /** Direct dependents only — one hop. */
  directDependents: CapabilityId[];
};

/**
 * ⚠ THE CLOSURES ARE IMPORTED, NEVER RE-IMPLEMENTED. capability-registry.ts exports requiredClosure and
 * dependentClosure precisely so that a second reader uses the rule rather than a copy of it — a copy
 * agrees with the original right up until one of them is fixed.
 */
export function capabilityGraph(): CapabilityNode[] {
  return CAPABILITY_REGISTRY.map(def => ({
    def,
    closure: requiredClosure([def.id]).filter(id => id !== def.id),
    dependents: dependentClosure(def.id),
    directDependents: directDependents(def.id),
  }));
}

/**
 * ⚠ A REAL, MEASURED INTEGRITY CHECK OVER THE CATALOGUE — not a decoration.
 *
 * Every id named in a `requires`, `recommends` or dependency closure must exist in the registry. A typo
 * would be invisible at runtime: the resolver would simply never find the dependency, and a capability
 * would silently declare a requirement nothing enforces. This is computed, and an empty result here is
 * a measured empty set rather than an unread one, because the input is code that always loads.
 */
export function catalogueAnomalies(): string[] {
  const known = new Set<string>(CAPABILITY_IDS as readonly string[]);
  const out: string[] = [];
  for (const c of CAPABILITY_REGISTRY) {
    for (const r of c.requires) if (!known.has(r)) out.push(`${c.id} requires ${r}, which is not a registry capability.`);
    for (const r of c.recommends) if (!known.has(r)) out.push(`${c.id} recommends ${r}, which is not a registry capability.`);
    for (const s of c.requiresSetup) if (!(s in SETUP_LABELS)) out.push(`${c.id} needs setup key ${s}, which has no label.`);
  }
  return out;
}

// ── READS ────────────────────────────────────────────────────────────────────────────────────────────

/**
 * ⚠ THIS TAKES A RESULT, NOT A TABLE NAME, AND THAT IS THE WHOLE POINT.
 *
 * It began as `countRows(admin, table, col)` — three lines shorter and one line of harness output
 * worse: scripts/plane-boundary-harness.ts resolves a read by reading the LITERALS at the call site,
 * so `.from(table).select(col)` is UNRESOLVED_SELECT, and its rule is that an unresolvable read FAILS
 * rather than being assumed inert. That is the scanner working correctly. A generic read helper is
 * exactly how a widened select slips past a plane boundary unnoticed, so every `.from()` and every
 * `.select()` in this module is written out at its call site, and only the arithmetic is shared.
 *
 * ⚠ AND THE COUNTS THEMSELVES ARE NOT `head: true` WHERE THE TABLE IS ON THIS PLANE. A head-only count
 * returns no error for a table that does not exist and reports it present — a wrong "absent" verdict
 * this codebase has already paid for once. The one exception is practice_plans, where the allowlist
 * permits a head count and nothing else.
 */
function countOf(label: string, res: { count?: number | null; error?: { message: string } | null }, problems: string[]): number | null {
  if (res.error) { problems.push(`${label}: ${res.error.message}`); return null; }
  return res.count ?? null;
}

export type ReleaseRow = {
  version: string;
  channel: string;
  status: string;
  notes: string | null;
  releasedAt: string | null;
  createdAt: string;
  gitCommit: string | null;
  buildNumber: string | null;
};

export type EstateFlagRow = {
  key: string;
  description: string | null;
  defaultOn: boolean;
  productCode: string | null;
  assignments: { scopeType: string; scopeRef: string | null; enabled: boolean; createdAt: string }[];
};

export type ChangeSetRow = {
  key: string; name: string; channel: string; rollout: string; status: string;
  objects: number; scheduledFor: string | null; activatedAt: string | null; createdAt: string;
};

export type Attention = { label: string; detail: string; tone: "critical" | "warning" | "neutral" };

export type PdReleases = {
  /** Everything derived from the Practice plane, through the loader that already reads it. */
  ops: PdOperations;
  releases: {
    /** The table answered. False means the figures below are unknown, NOT zero. */
    read: boolean;
    total: Figure;
    rolledBack: Figure;
    /** The most recent row whose status is `released`, by released_at. Null when none or unread. */
    current: ReleaseRow | null;
    rows: ReleaseRow[];
    byStatus: { status: string; n: number }[];
    byChannel: { channel: string; n: number }[];
  };
  flags: {
    read: boolean;
    catalogue: Figure;
    assignments: Figure;
    rows: EstateFlagRow[];
  };
  changeSets: {
    read: boolean;
    total: Figure;
    rows: ChangeSetRow[];
    byStatus: { status: string; n: number }[];
  };
  /**
   * ⚠ GATED HERE AND NOT IN THE VIEW. The overview built this Figure inline —
   * `figure={{ state: "value", value: … }}` — which is a number reaching a component without passing
   * the registry, and the exact bypass the loader-side gate exists to make impossible. A view that can
   * construct a Figure can construct one for an absent metric.
   */
  gateAutoPass: Figure;
  capabilities: {
    catalogue: Figure;
    dependencyEdges: Figure;
    /** Capabilities that are active for a practice which has stored nothing at all. */
    defaultActive: number;
    anomalies: string[];
  };
  attention: Attention[];
  /** Figures PD-012 asks for that this build refuses to draw, each with the registry's own sentence. */
  refusals: { label: string; why: string }[];
  problems: string[];
  generatedAt: string;
};

const REL_UNREADABLE =
  "The platform release log could not be read. That is not an empty log and it is not zero releases — "
  + "see the read failures at the foot of this page.";
const FLAG_UNREADABLE =
  "The estate feature-flag catalogue could not be read. That is not zero flags.";
const CS_UNREADABLE =
  "The configuration change-set store could not be read. That is not zero change sets.";

const releaseRow = (r: any): ReleaseRow => ({
  version: String(r.version ?? ""),
  channel: String(r.channel ?? ""),
  status: String(r.status ?? ""),
  notes: r.notes ?? null,
  releasedAt: r.released_at ?? null,
  createdAt: r.created_at,
  gitCommit: r.git_commit ?? null,
  buildNumber: r.build_number ?? null,
});

const tally = (rows: any[], key: string) => {
  const m = new Map<string, number>();
  for (const r of rows) { const k = String(r[key] ?? "unknown"); m.set(k, (m.get(k) ?? 0) + 1); }
  return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
};

export async function loadPdReleases(admin: Admin): Promise<PdReleases> {
  const problems: string[] = [];

  const [ops, relRes, relCountRes, flagRes, assignRes, csRes, csCountRes] = await Promise.all([
    // ⚠ COMPOSED, NOT RE-READ. Every Practice-plane fact on these pages arrives through this one call,
    // which is where the banded-counts and no-owner-email decisions are implemented.
    loadPdOperations(admin),
    admin.from("plat_deployments")
      .select("version, channel, status, notes, released_at, created_at, git_commit, build_number")
      .order("created_at", { ascending: false }).limit(200),
    admin.from("plat_deployments").select("id", { count: "exact" }).limit(1),
    admin.from("plat_feature_flags").select("key, description, default_on, product_code").limit(500),
    admin.from("plat_feature_flag_assignments")
      .select("flag_key, scope_type, scope_ref, enabled, created_at")
      .order("created_at", { ascending: false }).limit(1000),
    admin.from("configuration_releases")
      .select("release_key, name, channel, rollout, status, scheduled_for, activated_at, objects, created_at")
      .order("created_at", { ascending: false }).limit(200),
    admin.from("configuration_releases").select("id", { count: "exact" }).limit(1),
  ]);

  const relCount = countOf("plat_deployments", relCountRes, problems);
  const csCount = countOf("configuration_releases", csCountRes, problems);

  // ── The release log ─────────────────────────────────────────────────────────────────────────────
  if (relRes.error) problems.push(`plat_deployments: ${relRes.error.message}`);
  const relRows: any[] = relRes.error ? [] : (relRes.data ?? []);
  // ⚠ THE CONTROL ON "EMPTY VERSUS UNREADABLE": the page read and the independent count must agree.
  // A composed read that returns nothing while the database counts rows is a failed read, and "0
  // releases" is the single most misleading thing this module could say.
  const relLied = !relRes.error && relRows.length === 0 && (relCount ?? 0) > 0;
  if (relLied) {
    problems.push(
      `plat_deployments: the release read returned no rows while the database counts ${relCount}. `
      + "The figures are suppressed rather than shown as zero.",
    );
  }
  const relRead = !relRes.error && relCount !== null && !relLied;
  const releases = relRows.map(releaseRow);
  const released = releases.filter(r => r.status === "released" && r.releasedAt);
  released.sort((a, b) => String(b.releasedAt).localeCompare(String(a.releasedAt)));

  // ── Estate flags ────────────────────────────────────────────────────────────────────────────────
  if (flagRes.error) problems.push(`plat_feature_flags: ${flagRes.error.message}`);
  if (assignRes.error) problems.push(`plat_feature_flag_assignments: ${assignRes.error.message}`);
  const flagRows: any[] = flagRes.error ? [] : (flagRes.data ?? []);
  const assignRows: any[] = assignRes.error ? [] : (assignRes.data ?? []);
  const assignByKey = new Map<string, any[]>();
  for (const a of assignRows) {
    const list = assignByKey.get(a.flag_key);
    if (list) list.push(a); else assignByKey.set(a.flag_key, [a]);
  }
  const estateFlags: EstateFlagRow[] = flagRows.map(f => ({
    key: String(f.key),
    description: f.description ?? null,
    defaultOn: !!f.default_on,
    productCode: f.product_code ?? null,
    assignments: (assignByKey.get(f.key) ?? []).map(a => ({
      scopeType: String(a.scope_type), scopeRef: a.scope_ref ?? null,
      enabled: !!a.enabled, createdAt: a.created_at,
    })),
  })).sort((a, b) => a.key.localeCompare(b.key));

  // ── Configuration change sets ───────────────────────────────────────────────────────────────────
  if (csRes.error) problems.push(`configuration_releases: ${csRes.error.message}`);
  const csRows: any[] = csRes.error ? [] : (csRes.data ?? []);
  const csLied = !csRes.error && csRows.length === 0 && (csCount ?? 0) > 0;
  if (csLied) problems.push(`configuration_releases: the read returned no rows while the database counts ${csCount}.`);
  const csRead = !csRes.error && csCount !== null && !csLied;
  const changeSets: ChangeSetRow[] = csRows.map(r => ({
    key: String(r.release_key), name: String(r.name), channel: String(r.channel),
    rollout: String(r.rollout), status: String(r.status),
    objects: Array.isArray(r.objects) ? r.objects.length : 0,
    scheduledFor: r.scheduled_for ?? null, activatedAt: r.activated_at ?? null, createdAt: r.created_at,
  }));

  // ── The capability catalogue — code, so it always answers ───────────────────────────────────────
  const edges = CAPABILITY_REGISTRY.reduce(
    (n, c) => n + c.requires.length + c.requiresSetup.length + c.recommends.length, 0);

  // ── Needs attention (§5) — measured exceptions only ─────────────────────────────────────────────
  const attention: Attention[] = [];
  const publiclyLive = FLAG_ORDER.filter(f => ops.flags[f] && f !== "practice_pilot_provisioning");
  for (const f of publiclyLive) {
    attention.push({
      label: `${f} is ON`,
      detail: `${FLAG_CONSEQUENCE[f]} ${SUPABASE_GATE_NOTE}`,
      tone: "warning",
    });
  }
  if (ops.gateSummary.fail > 0) {
    attention.push({
      label: `${ops.gateSummary.fail} launch-readiness check${ops.gateSummary.fail === 1 ? "" : "s"} failing`,
      detail:
        "The IAM-001 cutover checklist, evaluated live against the database. It is the only readiness "
        + "gate this product has, and it gates the launch of Practice as a whole rather than any one "
        + "release.",
      tone: "critical",
    });
  }
  if (ops.gateSummary.manualOutstanding > 0) {
    attention.push({
      label: `${ops.gateSummary.manualOutstanding} of ${ops.gateSummary.manualTotal} readiness items still need a person`,
      detail:
        "Human-attested steps are never auto-greened. §7 requires a named attestation and a timestamp "
        + "for a manual gate; there is nowhere to record either, so these stay outstanding on every "
        + "load rather than being ticked off.",
      tone: "warning",
    });
  }
  const inFlight = releases.filter(r => r.status === "planned" || r.status === "releasing");
  if (relRead && inFlight.length > 0) {
    attention.push({
      label: `${inFlight.length} release row${inFlight.length === 1 ? "" : "s"} recorded as not yet released`,
      detail:
        `Status ${[...new Set(inFlight.map(r => r.status))].join(" and ")}. ⚠ A release row is written `
        + "by a person, not by a pipeline, so this means somebody recorded a release and has not "
        + "recorded it finishing — not that a deployment is running now.",
      tone: "neutral",
    });
  }
  const anomalies = catalogueAnomalies();
  for (const a of anomalies) {
    attention.push({ label: "Capability catalogue integrity", detail: a, tone: "critical" });
  }
  if (relRead && releases.length === 0) {
    attention.push({
      label: "No release has ever been recorded",
      detail:
        "The release log answered and holds no rows — a measured empty table, not an unreadable one. "
        + "So this module cannot name a current production version, and no release row exists for a "
        + "capability to point at.",
      tone: "neutral",
    });
  }

  const refusals = refusalsFor([
    "rel.active_rollouts", "rel.rollout_percentage", "rel.capability_lifecycle",
    "rel.readiness_gates", "rel.release_approvals", "rel.post_deploy_verification",
  ]);

  return {
    ops,
    gateAutoPass: figure("rel.gate_auto_pass", () => ops.gateSummary.autoPass,
      "The launch checklist could not be evaluated."),
    releases: {
      read: relRead,
      total: figure("rel.releases_recorded", () => (relRead ? relCount : null), REL_UNREADABLE),
      rolledBack: figure("rel.rollbacks_recorded",
        () => (relRead ? releases.filter(r => r.status === "rolled_back").length : null), REL_UNREADABLE),
      current: released[0] ?? null,
      rows: releases,
      byStatus: tally(relRows, "status").map(([status, n]) => ({ status, n })),
      byChannel: tally(relRows, "channel").map(([channel, n]) => ({ channel, n })),
    },
    flags: {
      read: !flagRes.error,
      catalogue: figure("rel.estate_flags", () => (flagRes.error ? null : flagRows.length), FLAG_UNREADABLE),
      assignments: figure("rel.estate_flags", () => (assignRes.error ? null : assignRows.length), FLAG_UNREADABLE),
      rows: estateFlags,
    },
    changeSets: {
      read: csRead,
      total: figure("rel.config_change_sets", () => (csRead ? csCount : null), CS_UNREADABLE),
      rows: changeSets,
      byStatus: tally(csRows, "status").map(([status, n]) => ({ status, n })),
    },
    capabilities: {
      catalogue: figure("rel.capability_catalogue", () => CAPABILITY_REGISTRY.length, "unreachable: the catalogue is code"),
      dependencyEdges: figure("rel.capability_dependency_edges", () => edges, "unreachable: the catalogue is code"),
      defaultActive: DEFAULT_ACTIVE_IDS.length,
      anomalies,
    },
    attention,
    refusals,
    problems,
    generatedAt: new Date().toISOString(),
  };
}

// ── PLAN AVAILABILITY (§13) ──────────────────────────────────────────────────────────────────────────

export type PlanRow = { code: string; name: string; active: boolean; sort: number | null };

export type PlanAvailability = {
  /** plat_plans — Commercial's own catalogue, on the platform plane, readable here. */
  platformPlans: PlanRow[];
  platformRead: boolean;
  /** practice_plans — the Practice-side catalogue. Allowlisted for a ROW COUNT and nothing else. */
  practicePlanCount: number | null;
  problems: string[];
  generatedAt: string;
};

export async function loadPlanAvailability(admin: Admin): Promise<PlanAvailability> {
  const problems: string[] = [];
  const [platRes, practiceCountRes] = await Promise.all([
    admin.from("plat_plans").select("code, name, is_active, sort").order("sort"),
    // ⚠ A HEAD-ONLY COUNT, AND THAT IS THE ALLOWLIST'S OWN LIMIT RATHER THAN A STYLE CHOICE.
    // practice_plans is admitted to the platform plane with NO COLUMNS and `count: true`, so a head
    // count is the only read of it this plane may make: plan codes and names are not reachable from
    // here. The literals are written out because the boundary scanner resolves reads by reading them.
    admin.from("practice_plans").select("*", { count: "exact", head: true }),
  ]);
  if (platRes.error) problems.push(`plat_plans: ${platRes.error.message}`);
  const practiceCount = countOf("practice_plans", practiceCountRes, problems);
  return {
    platformPlans: ((platRes.error ? [] : platRes.data ?? []) as any[]).map(p => ({
      code: String(p.code), name: String(p.name), active: !!p.is_active, sort: p.sort ?? null,
    })),
    platformRead: !platRes.error,
    practicePlanCount: practiceCount,
    problems,
    generatedAt: new Date().toISOString(),
  };
}

// ── RELEASE HISTORY (§18) ────────────────────────────────────────────────────────────────────────────

export type HistoryEvent = {
  at: string;
  /** Which stream it came from — never inferred by a reader from the wording. */
  stream: "release" | "config-release" | "flag-assignment";
  title: string;
  detail: string;
};

export type ReleaseHistory = {
  events: HistoryEvent[];
  /** Which streams answered. A stream that failed must not read as a quiet period. */
  streams: { name: string; read: boolean; rows: number; note: string }[];
  problems: string[];
  generatedAt: string;
};

export async function loadReleaseHistory(admin: Admin): Promise<ReleaseHistory> {
  const problems: string[] = [];
  const [relRes, evRes, assignRes] = await Promise.all([
    admin.from("plat_deployments")
      .select("version, channel, status, notes, released_at, created_at")
      .order("created_at", { ascending: false }).limit(100),
    admin.from("configuration_release_events")
      .select("release_key, event, actor_name, created_at")
      .order("created_at", { ascending: false }).limit(100),
    admin.from("plat_feature_flag_assignments")
      .select("flag_key, scope_type, scope_ref, enabled, created_at")
      .order("created_at", { ascending: false }).limit(100),
  ]);
  if (relRes.error) problems.push(`plat_deployments: ${relRes.error.message}`);
  if (evRes.error) problems.push(`configuration_release_events: ${evRes.error.message}`);
  if (assignRes.error) problems.push(`plat_feature_flag_assignments: ${assignRes.error.message}`);

  const relRows: any[] = relRes.error ? [] : (relRes.data ?? []);
  const evRows: any[] = evRes.error ? [] : (evRes.data ?? []);
  const asRows: any[] = assignRes.error ? [] : (assignRes.data ?? []);

  const events: HistoryEvent[] = [
    ...relRows.map((r): HistoryEvent => ({
      at: r.released_at ?? r.created_at,
      stream: "release",
      title: `Release ${r.version} — ${r.status}`,
      detail: [r.channel ? `${r.channel} channel` : null, r.notes || null].filter(Boolean).join(" · ")
        || "No note was recorded with this release.",
    })),
    ...evRows.map((r): HistoryEvent => ({
      at: r.created_at,
      stream: "config-release",
      title: `Configuration change set ${r.release_key} — ${r.event}`,
      detail: r.actor_name ? `by ${r.actor_name}` : "no actor recorded on this event",
    })),
    ...asRows.map((r): HistoryEvent => ({
      at: r.created_at,
      stream: "flag-assignment",
      title: `Estate flag ${r.flag_key} ${r.enabled ? "enabled" : "disabled"} for ${r.scope_type}`,
      detail: r.scope_ref
        ? `scope ${r.scope_ref}. ⚠ Estate plane — this is not a Competen Practice flag.`
        : "global scope. ⚠ Estate plane — this is not a Competen Practice flag.",
    })),
  ].filter(e => !!e.at).sort((a, b) => String(b.at).localeCompare(String(a.at)));

  return {
    events,
    streams: [
      {
        name: "plat_deployments", read: !relRes.error, rows: relRows.length,
        note: "Platform releases and rollbacks. Written by a person, never by a pipeline.",
      },
      {
        name: "configuration_release_events", read: !evRes.error, rows: evRows.length,
        note: "Created, validated, approved, published, activated and rolled_back, for ESTATE configuration change sets.",
      },
      {
        name: "plat_feature_flag_assignments", read: !assignRes.error, rows: asRows.length,
        note:
          "Estate feature-flag targeting. ⚠ Rows are CREATED, never versioned, so an assignment records "
          + "what was set and never what it changed from.",
      },
    ],
    problems,
    generatedAt: new Date().toISOString(),
  };
}
