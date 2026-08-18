// CPR-PD-014 BUILD 4 -- THE LANDLORD METRIC REGISTRY.
//
// PD-005 s1: the sub-modules "use governed metric definitions". This is that governance, ported from
// src/lib/practice/intelligence-registry.ts (CPR-PI-001 v2 s14, "no metric may ship without a registry
// definition") and given the one dimension a LANDLORD registry needs that a tenant one does not.
//
// ⚠ THIS MODULE IMPORTS NOTHING. Constants-file rule: screens and harnesses both read it.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// ⚠ THE ADDED DIMENSION IS `producer`, AND IT IS THE WHOLE POINT OF BUILDING THIS BEFORE ANY SCREEN.
//
// A gate-check of all twelve Product Director modules (Build 0, 2026-08-17) found the UNDERSTAND layer
// is mostly not buildable: Product Intelligence 5 real against 31 absent, Adoption 2 against 14,
// Commercial 2 against 71. Those are not gaps to be filled in by writing more queries -- for most of
// them the underlying fact is not recorded anywhere in this product.
//
// The failure that follows from ignoring that is documented in this repo: five frozen screens once
// shipped renders reading fields that never existed on the payload. A dashboard of confident blanks is
// worse than an empty one, because a blank invites a question and a fabricated figure ends it.
//
// So every metric the specifications name is declared here with what actually backs it:
//   real       a producer exists today. `source` names it.
//   derivable  no producer, but the rows exist. `source` names them and `missing` says what must be
//              computed. A derivable metric MAY ship once someone writes that computation -- it is
//              work, not a wall.
//   absent     nothing in this database can produce it honestly. `missing` names the fact that does
//              not exist. ⚠ AN ABSENT METRIC MUST NOT RENDER A VALUE ANYWHERE, EVER.
//
// ⚠ AND `absent` IS NOT A SYNONYM FOR "LATER". Three of the biggest absences below are structural:
// a Practice cannot be the subject of a subscription row at all (no tenant_id), the product emits no
// telemetry event of any kind, and the activation ledger is keyed per practice so it can never answer
// a per-person question. Those need a schema, not a sprint.

export type PdProducer = "real" | "derivable" | "absent";

export type PdMetric = {
  metricId: string;
  /**
   * `mission` was added by CPR-PD-002. Mission Control SUMMARISES the other three modules (PD-002 §18:
   * "does not replace Product Intelligence, Product Operations, Product Health or Commercial"), but the
   * figures it leads with are its own — an estate total is not an intelligence metric, and PD-002 §3
   * prescribes six KPIs that appear in no other specification. They are declared here rather than
   * borrowed, because a metric borrowed from another module arrives with that module's definition and
   * the two then drift.
   */
  module: "intelligence" | "adoption" | "commercial" | "mission";
  displayName: string;
  /** Exact business meaning -- what a reader may take this number to claim. */
  definition: string;
  producer: PdProducer;
  /** For real: the table/loader. For derivable: the rows it would be computed from. Null when absent. */
  source: string | null;
  /** For derivable: what must be computed. For absent: the fact that does not exist. */
  missing?: string;
  /** A rate may not render without both (CPR-PI-001 v2 s14, and s19 requires the denominator shown). */
  numerator?: string;
  denominator?: string;
  spec: string;
};

/**
 * ⚠ NOT EXHAUSTIVE OVER EVERY FIGURE IN THE COMPS, AND THAT IS DELIBERATE. This covers the HEADLINE
 * metrics of the three UNDERSTAND modules -- the ones the overview screens lead with. A metric absent
 * from this registry has no definition, and `mayRender` refuses it for that reason alone, so growing
 * the registry is how a new figure gets permission to exist rather than a formality afterwards.
 */
export const PD_METRICS: PdMetric[] = [
  // ── PRODUCT INTELLIGENCE (CPR-PD-005) ─────────────────────────────────────────────────────────
  {
    metricId: "pi.markets.practices_by_country", module: "intelligence",
    displayName: "Practices by market",
    definition: "Count of Practice workspaces whose country is each market, at read time.",
    producer: "real", source: "practice_workspace.country (migration 191:41, NOT NULL)",
    spec: "PD-005F",
  },
  {
    metricId: "pi.markets.practitioners_by_country", module: "intelligence",
    displayName: "Practitioners by market",
    definition: "Count of distinct people holding a membership in a workspace in each market.",
    producer: "real", source: "practice_membership joined to practice_workspace.country",
    spec: "PD-005F",
  },
  {
    metricId: "pi.funnel.activation_ladder", module: "intelligence",
    displayName: "Activation funnel",
    definition:
      "How many PRACTICES have reached each milestone of the activation ladder. ⚠ Per practice, never "
      + "per practitioner -- see pi.funnel.per_practitioner below for why that distinction is load-bearing.",
    producer: "real", source: "practice_activation_event (unique on workspace_id, event_key)",
    spec: "PD-005I",
  },
  {
    metricId: "pi.funnel.per_practitioner", module: "intelligence",
    displayName: "Activation funnel, per practitioner",
    definition: "How far each individual practitioner has progressed through the activation ladder.",
    producer: "absent", source: null,
    missing:
      "There is no per-person activation fact. practice_activation_event is uniquely indexed on "
      + "(workspace_id, event_key) -- migration 283:105 -- so a milestone belongs to a PRACTICE and is "
      + "stamped by whichever colleague tripped it first. On a managed practice, attributing it to a "
      + "person would credit one colleague's first booking to everybody in the room.",
    spec: "PD-005H",
  },
  {
    metricId: "pi.engagement.dau_wau", module: "intelligence",
    displayName: "Daily and weekly active practitioners",
    definition: "Distinct practitioners who used the product on a day, and in a rolling week.",
    producer: "absent", source: null,
    missing:
      "The product emits no telemetry event of any kind -- no page view, no feature invocation, no "
      + "session start. practice_domain_event is CLINICAL and practice_access_log is a clinical-access "
      + "audit; neither records product use. The one genuine signal, practice_session.last_seen_at, is "
      + "an UPDATE in place (security.ts:342), so it answers 'seen inside a window, as of now' and can "
      + "never answer 'on which days'.",
    spec: "PD-005B",
  },
  {
    metricId: "pi.retention.cohort_curve", module: "intelligence",
    displayName: "Retention by signup cohort",
    definition: "Share of each signup cohort still active at day 30, 60 and 90.",
    producer: "absent", source: null,
    missing:
      "Requires per-day activity, which does not exist (see pi.engagement.dau_wau). A curve drawn from "
      + "last_seen_at alone would be one point repeated, not a curve.",
    numerator: "cohort members active in the window", denominator: "cohort size",
    spec: "PD-005C",
  },
  {
    metricId: "pi.features.adoption_rate", module: "intelligence",
    displayName: "Feature adoption",
    definition: "Share of practitioners who have used a given feature.",
    producer: "derivable", source: "the domain tables each feature writes to (appointments, encounters, follow-ups, documents)",
    missing:
      "Feature USE must be inferred from domain rows, because no invocation event exists. That is "
      + "defensible for features that write a row and impossible for those that do not -- so the derived "
      + "set is a subset of the feature list and must say which features it cannot see.",
    numerator: "practitioners with at least one row", denominator: "practitioners in scope",
    spec: "PD-005D",
  },

  // ── ADOPTION & GROWTH (CPR-PD-006) ────────────────────────────────────────────────────────────
  {
    metricId: "ag.registrations", module: "adoption",
    displayName: "New registrations",
    definition: "Practitioner memberships created in the period.",
    producer: "real", source: "practice_membership.created_at",
    spec: "PD-006",
  },
  {
    metricId: "ag.practices_provisioned", module: "adoption",
    displayName: "Practices provisioned",
    definition: "Practice workspaces created in the period, by provisioning outcome.",
    producer: "real", source: "practice_workspace.created_at with provisioning_request.status",
    spec: "PD-006",
  },
  {
    metricId: "ag.activation_rate", module: "adoption",
    displayName: "Activation rate",
    definition: "Share of registered practices that reached the activation milestone.",
    producer: "derivable", source: "practice_activation_event over practice_workspace",
    missing:
      "Both sides exist per PRACTICE, so a practice-level rate is computable. ⚠ It must be labelled as "
      + "a practice rate: PD-006's comp shows it per practitioner, and that version is absent for the "
      + "reason given at pi.funnel.per_practitioner.",
    numerator: "practices with the milestone", denominator: "practices registered",
    spec: "PD-006",
  },
  {
    metricId: "ag.reactivation", module: "adoption",
    displayName: "Reactivated practitioners",
    definition: "Practitioners who returned after a dormant period.",
    producer: "absent", source: null,
    missing:
      "Dormancy and return both need an activity HISTORY. last_seen_at is overwritten, so the moment "
      + "somebody returns, the evidence that they had been away is destroyed by the same write.",
    spec: "PD-006",
  },
  {
    metricId: "ag.intervention_outcome", module: "adoption",
    displayName: "Intervention outcome",
    definition: "The measured effect of a campaign or nudge on the audience that received it.",
    producer: "absent", source: null,
    missing:
      "No campaign, audience or send record exists for the landlord plane, and no per-person activity "
      + "to measure an effect against. PD-006 requires every intervention to carry a measured outcome; "
      + "there is nothing to measure one with.",
    spec: "PD-006",
  },

  // ── COMMERCIAL (CPR-PD-007) ───────────────────────────────────────────────────────────────────
  {
    metricId: "cm.plan_catalogue", module: "commercial",
    displayName: "Plans in the catalogue",
    definition: "The Practice plan codes that exist, and what each permits.",
    producer: "real", source: "practice_plans (migration 191:249)",
    spec: "PD-007A",
  },
  {
    metricId: "cm.practices_by_plan", module: "commercial",
    displayName: "Practices by plan",
    definition: "How many Practice workspaces hold each plan code.",
    producer: "derivable", source: "practice_entitlement joined to practice_workspace",
    missing:
      "The join is straightforward, but practice_entitlement is NOT on the platform-plane allowlist "
      + "(plane-boundary.ts), so this is a governance decision rather than a query. It needs no migration.",
    spec: "PD-007A",
  },
  {
    metricId: "cm.mrr", module: "commercial",
    displayName: "Monthly recurring revenue",
    definition: "Recurring revenue from Practice subscriptions, by market and plan.",
    producer: "absent", source: null,
    missing:
      "⚠ STRUCTURAL, NOT A MISSING QUERY. A Practice cannot be the SUBJECT of a subscription: "
      + "plat_subscriptions keys on tenants(id) and practice_workspace has no tenant_id (migration "
      + "191:32). practice_plans carries no price and no currency column -- plane-boundary.ts:167 says "
      + "so in as many words -- and UGX appears nowhere in the schema. practice_invoice and "
      + "practice_payment are the practitioner billing HER PATIENTS, which is a different party, a "
      + "different direction and a different currency. MRR, ARR, ARPP, churn value and every forecast "
      + "built on them have no source to read.",
    spec: "PD-007E",
  },
  {
    metricId: "cm.trial_to_paid", module: "commercial",
    displayName: "Trial to paid conversion",
    definition: "Share of trials that became paying subscriptions.",
    producer: "absent", source: null,
    missing:
      "There is no paid state to convert INTO -- see cm.mrr. practice_entitlement records a plan code "
      + "and a status, not a payment, so 'paid' is not a fact this product holds.",
    numerator: "trials that became paid", denominator: "trials started",
    spec: "PD-007B, PD-007D",
  },
  {
    metricId: "cm.payment_failures", module: "commercial",
    displayName: "Payment failures",
    definition: "Failed collection attempts against Practice subscriptions.",
    producer: "absent", source: null,
    missing:
      "No payment provider is integrated for Practice subscriptions, so there are no attempts to fail. "
      + "This is the one absence a reader is most likely to mistake for 'zero failures, all is well'.",
    spec: "PD-007F",
  },

  // ── MISSION CONTROL (CPR-PD-002) ──────────────────────────────────────────────────────────────
  //
  // ⚠ TWO KINDS OF ABSENCE APPEAR BELOW AND THEY ARE NOT THE SAME KIND OF PROBLEM.
  //
  //   The fact is not recorded    -> `absent`. No amount of work on this plane produces it. Product
  //                                  health, support requests and open incidents are these.
  //   The rows exist but this     -> `derivable`, with the allowlist named in `missing`. The precedent
  //   plane may not read them        is cm.practices_by_plan above: a governance decision with an owner,
  //                                  not a query somebody forgot to write.
  //
  // Both refuse to render a value today. They are distinguished because they have different owners and
  // different costs, and a reader who is told "we cannot see this" deserves to know which one it is.
  {
    metricId: "mc.practices_total", module: "mission",
    displayName: "Practices",
    definition:
      "Practice workspaces that exist, counted by the database at read time, in every lifecycle state "
      + "from REQUESTED to CLOSED. Not 'active practices' — the lifecycle mix is shown beside it.",
    producer: "real", source: "practice_workspace (id, status, country, timezone, created_at)",
    spec: "PD-002 §3",
  },
  {
    metricId: "mc.practitioners_total", module: "mission",
    displayName: "Practitioners",
    definition:
      "Distinct PEOPLE holding at least one Practice membership of any status. One person in three "
      + "Practices is one practitioner.",
    producer: "real", source: "practice_membership folded per user_id by loadPdPractitioners",
    spec: "PD-002 §3",
  },
  {
    metricId: "mc.practitioners_new", module: "mission",
    displayName: "New practitioners in the period",
    definition:
      "People whose EARLIEST Practice membership falls inside the period. The growth delta on the "
      + "Practitioners card is this figure for the trailing window against the window before it.",
    producer: "derivable", source: "practice_membership.joined_at, falling back to created_at",
    missing:
      "The rows must be folded to people before they are counted. Counting membership rows would count "
      + "the same person twice the day they join a second Practice, and PD-002 §3 asks for practitioners.",
    spec: "PD-002 §3",
  },
  {
    metricId: "mc.active_30d", module: "mission",
    displayName: "Active in the last 30 days",
    definition:
      "Practitioners holding an unrevoked device session whose last_seen_at falls inside the trailing "
      + "30 days. ⚠ THIS IS RECENCY, NOT USE: it says somebody's Practice shell was open, not what they "
      + "did in it. PD-002 §3's 'approved active-user definition' does not exist yet; this is the "
      + "strongest claim the one available signal supports, and the card says so in those words.",
    producer: "derivable", source: "practice_session (user_id; last_seen_at and revoked_at as filters)",
    missing:
      "The fold is three-valued and the middle value is the trap. No session row at all is not 'inactive' "
      + "— it is 'never opened a Practice shell on a registered device' — and an unreadable "
      + "practice_session makes EVERY row null, which is not a roster of dormant people. The denominator "
      + "must therefore be stated with the figure.",
    numerator: "practitioners seen inside the window",
    denominator: "practitioners in scope, with the never-seen and unknown counts shown beside it",
    spec: "PD-002 §3",
  },
  {
    metricId: "mc.patient_records", module: "mission",
    displayName: "Patient records",
    definition:
      "Rows in practice_patient across the Practice workspaces in scope. ⚠ RECORDS, NOT PEOPLE: a person "
      + "registered at two Practices is two records, and PD-002 §3's word 'unique' cannot be honoured "
      + "because the identifiers that would deduplicate them are outside this plane permanently.",
    producer: "real", source: "practice_patient, counted at workspace_id with head:true — no row is read",
    spec: "PD-002 §3",
  },
  {
    metricId: "mc.bookings_window", module: "mission",
    displayName: "Bookings in the period",
    definition:
      "Appointment rows CREATED inside the period, across the workspaces in scope. The prior-period "
      + "comparison on the same card is this metric over the immediately preceding window of equal length.",
    producer: "real",
    source: "practice_appointment, counted at workspace_id; created_at is a filter and is never selected",
    missing:
      "⚠ CREATED, NOT SCHEDULED. `scheduled_at` is when a patient is due to be seen and is not "
      + "operational telemetry about the product; `created_at` is when the booking was taken. They "
      + "diverge for every appointment booked in advance, so the label says 'bookings taken'.",
    spec: "PD-002 §3, §5",
  },
  {
    metricId: "mc.encounters_window", module: "mission",
    displayName: "Encounters in the period",
    definition: "Encounter rows created inside the period, across the workspaces in scope. Counts only.",
    producer: "real",
    source: "practice_encounter, counted at workspace_id; created_at is a filter and is never selected",
    spec: "PD-002 §5",
  },
  {
    metricId: "mc.product_health", module: "mission",
    displayName: "Product health",
    definition:
      "The overall Healthy / Degraded / Incident state of Competen Practice, computed from governed "
      + "service rules (PD-002 §8: it 'must not be a decorative percentage').",
    producer: "absent", source: null,
    missing:
      "No reliability instrumentation exists for this product. Nothing records an availability check, a "
      + "request latency, an error rate or a synthetic probe for authentication, booking, notifications, "
      + "documents, offline sync, AI services or integrations — so there is no uptime, no Apdex, no P95 "
      + "and no error budget to translate into a state. A card reading 'Healthy' here would be an "
      + "assertion nobody measured, and 'Healthy' is the single most expensive word to be wrong about on "
      + "a product dashboard.",
    spec: "PD-002 §3, §8",
  },
  {
    metricId: "mc.support_requests", module: "mission",
    displayName: "Support requests",
    definition: "Support requests raised by Practice practitioners in the period.",
    producer: "absent", source: null,
    missing:
      "There is no support-case store for Competen Practice. The one ticket table on the estate belongs "
      + "to the platform plane and is keyed to tenants, and a Practice is not a tenant — so it cannot "
      + "hold a Practice practitioner's request even in principle.",
    spec: "PD-002 §5",
  },
  {
    metricId: "mc.open_incidents", module: "mission",
    displayName: "Open incidents",
    definition: "Declared, unresolved incidents affecting Competen Practice.",
    producer: "absent", source: null,
    missing:
      "No incident is declared, tracked or resolved anywhere in this product. This is the absence most "
      + "easily mistaken for good news: 'no incident store' and 'no open incidents' render identically "
      + "as a zero, and only one of them is a reassurance.",
    spec: "PD-002 §5",
  },
  {
    metricId: "mc.practice_journey", module: "mission",
    displayName: "Practice activation journey",
    definition:
      "How many PRACTICES have reached each stage of the ladder: provisioned, past onboarding, first "
      + "booking taken, first encounter recorded. ⚠ PER PRACTICE, NEVER PER PRACTITIONER — PD-002 §6 "
      + "names it a practitioner funnel and no per-person milestone exists (see pi.funnel.per_practitioner).",
    producer: "derivable",
    source: "practice_workspace.status, plus the per-workspace banded counts loadPracticeOps takes over practice_appointment and practice_encounter",
    missing:
      "Three of PD-002 §6's seven stages cannot be drawn from this plane and are named on the card "
      + "rather than omitted. Visited/invited has no producer at all. 'Configured Practice' and 'Created "
      + "availability' live in practice_configuration and the availability tables, which are not on the "
      + "platform-plane allowlist. 'Active at 30 days' needs a per-practice recency signal, and the only "
      + "recency signal on this plane belongs to a person's device session, not to a Practice.",
    numerator: "practices that reached the stage",
    denominator: "practices in the operations page the stage was measured over",
    spec: "PD-002 §6",
  },
  {
    metricId: "mc.feature_adoption", module: "mission",
    displayName: "Feature adoption",
    definition:
      "The share of Practices that have written at least one row for a capability — bookings, encounters "
      + "and invoicing. Adoption BY PRACTICE, not by practitioner.",
    producer: "derivable",
    source: "the per-workspace banded counts loadPracticeOps takes over practice_appointment, practice_encounter, practice_invoice",
    missing:
      "⚠ TWO LIMITS, BOTH NAMED ON THE CARD. Use is inferred from domain rows because no feature "
      + "invocation event exists, so four of PD-002 §7's seven capabilities — follow-ups, documents, "
      + "self-booking and the AI assistant — are invisible: three write to tables outside this plane and "
      + "self-booking is a property of how an appointment arrived, which is a column this plane may not "
      + "read. And §7 requires eligibility to respect plan availability so a disabled feature does not "
      + "depress adoption; practice_entitlement and practice_capability_activation are not on the "
      + "allowlist, so the denominator is every Practice in scope and the figure is a FLOOR.",
    numerator: "practices with at least one row for the capability",
    denominator: "practices in the operations page, whether or not the capability is enabled for them",
    spec: "PD-002 §7",
  },
];

/** One metric, or null. A screen asking for an id that is not here is asking for an undefined figure. */
export const pdMetric = (metricId: string): PdMetric | null =>
  PD_METRICS.find(m => m.metricId === metricId) ?? null;

export const pdMetricsFor = (module: PdMetric["module"]): PdMetric[] =>
  PD_METRICS.filter(m => m.module === module);

/**
 * ⚠ THE ONE FUNCTION EVERY SCREEN MUST GO THROUGH BEFORE IT DRAWS A NUMBER.
 *
 * False for an absent metric AND for an unregistered one. Those two refusals are different sentences
 * to a developer and the same answer to a reader: no value is drawn. A rate additionally needs both
 * halves declared, because CPR-PI-001 v2 s19 requires the denominator to be shown wherever the
 * percentage renders, and a denominator nobody declared cannot be shown.
 */
export function mayRender(metricId: string): boolean {
  const m = pdMetric(metricId);
  if (!m) return false;
  if (m.producer === "absent") return false;
  if ((m.numerator || m.denominator) && !(m.numerator && m.denominator)) return false;
  return true;
}

/** The sentence a screen shows INSTEAD of a value. Written once, so thirty screens cannot each invent one. */
export function absenceSentence(metricId: string): string {
  const m = pdMetric(metricId);
  if (!m) return "This figure has no registry definition, so it is not shown.";
  if (m.producer === "real") return "";
  return m.missing ?? "The fact behind this figure is not recorded.";
}
