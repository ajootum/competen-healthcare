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
  /**
   * `configuration` was added by CPR-PD-011. Its metrics are about the CONFIGURATION ESTATE — how many
   * settings are declared, how many carry an override, what is pending — and not about practices or
   * money, so none of them is borrowable from the modules above.
   */
  module: "intelligence" | "adoption" | "commercial" | "mission" | "configuration";
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

  // ── PRODUCT CONFIGURATION (CPR-PD-011) ────────────────────────────────────────────────────────
  //
  // ⚠ THIS MODULE IS THE OPPOSITE SHAPE TO THE THREE ABOVE, AND THE DIFFERENCE DECIDES WHAT MAY RENDER.
  //
  // Product Intelligence is absent because the FACT is not recorded. Product Configuration has the
  // opposite problem: three configuration estates are built, populated and audited — a registry with
  // safety classifications and override policies (migration 092), an override store with draft/publish
  // and version snapshots (076), and a change-set lifecycle (099) — and a resolver that already returns
  // an effective value WITH a provenance trace (src/lib/config/runtime.ts:26-40).
  //
  // What is missing is the SUBJECT. Not one Competen Practice setting is a registry object: the registry
  // is seeded from WORKSPACE_CATALOG, which catalogues Unit Manager, Shift Supervisor and the Personal
  // Workspace and contains the word "practice" nowhere. So every figure below is real — and every one of
  // them is about a DIFFERENT PRODUCT'S configuration unless the metric says otherwise. Rendering the
  // registry total under the heading "Practice configuration" would be the most plausible lie available
  // on this screen, which is why cfg.definitions_practice exists beside cfg.definitions and carries a
  // denominator.
  {
    metricId: "cfg.definitions", module: "configuration",
    displayName: "Configuration definitions",
    definition:
      "Rows in the platform configuration registry, by lifecycle status. ⚠ THE ESTATE'S CATALOGUE, NOT "
      + "PRACTICE'S — see cfg.definitions_practice for how much of it is about Competen Practice.",
    producer: "real",
    source: "configuration_registry_objects (migration 092:9), read by loadRegistry (src/lib/config/registry.ts:23)",
    spec: "PD-011 §4, §6",
  },
  {
    metricId: "cfg.definitions_practice", module: "configuration",
    displayName: "Definitions describing Competen Practice",
    definition:
      "Registry objects whose key or route names Competen Practice, over every registry object. This is "
      + "the figure that says whether Product Configuration has a subject yet.",
    producer: "real",
    source: "configuration_registry_objects.object_key / .route matched against /practice/i",
    missing:
      "⚠ THE MATCH IS A HEURISTIC AND THE SCREEN SAYS SO. The registry carries no product column, so "
      + "membership of Competen Practice is inferred from the key and the route. That is exact today "
      + "because the seeder writes `workspace.<catalogue key>` and the catalogue has no Practice entry; "
      + "it would need replacing by a real product column the moment one is added.",
    numerator: "registry objects naming Competen Practice",
    denominator: "registry objects of any kind",
    spec: "PD-011 §4",
  },
  {
    metricId: "cfg.high_risk", module: "configuration",
    displayName: "High-risk settings",
    definition:
      "Registry objects classified clinical-safety-critical, security-critical, regulatory-critical or "
      + "financial-control-critical — PD-011 §4's Sensitivity attribute, already modelled.",
    producer: "real",
    source: "configuration_registry_objects.safety_classification (migration 092:24, nine-value check constraint)",
    spec: "PD-011 §4, §6",
  },
  {
    metricId: "cfg.platform_enforced", module: "configuration",
    displayName: "Platform-enforced rules",
    definition:
      "Registry objects no lower scope may override: override_policy 'none', or configurability_class "
      + "'mandatory_locked'. PD-011 §3's top rung, counted.",
    producer: "real",
    source: "configuration_registry_objects.override_policy / .configurability_class (migration 092:22-26)",
    spec: "PD-011 §3",
  },
  {
    metricId: "cfg.overrides_published", module: "configuration",
    displayName: "Overridden values",
    definition:
      "Override rows whose `published` value is set — a value some scope has actually moved away from "
      + "its default, as opposed to an unpublished draft.",
    producer: "real",
    source: "workspace_config_overrides.published (migration 076:16-32), read by loadConfigOverrides",
    spec: "PD-011 §6",
  },
  {
    metricId: "cfg.effective_value_trace", module: "configuration",
    displayName: "Effective value and its source scope",
    definition:
      "For one configuration key in one context: the value that wins, and the layer it came from — "
      + "PD-011 §5's \"30 minutes — Market override (Uganda)\".",
    producer: "real",
    source:
      "resolveRuntime (src/lib/config/runtime.ts:27-40) returns `effective`, `raw`, `layers` and a "
      + "`trace` array carrying every contributing layer and its scope ref",
    missing:
      "⚠ THE MACHINERY RESOLVES; THE LADDER IS NOT PD-011's. SCOPE_ORDER is platform → tenant → hospital "
      + "→ unit → role → user (src/lib/config/workspace-config.ts:13). §3 asks for platform-enforced → "
      + "product default → market → plan/segment → Practice → practitioner. Two rungs have no scope at "
      + "all and the tenancy rungs point at `hospitals`, not at `practice_workspace`.",
    spec: "PD-011 §5",
  },
  {
    metricId: "cfg.pending_changes", module: "configuration",
    displayName: "Pending changes",
    definition:
      "Unpublished override drafts, plus change sets in DRAFT, VALIDATED, APPROVED or SCHEDULED — the "
      + "changes that exist and are not yet live.",
    producer: "real",
    source:
      "workspace_config_overrides.draft where published is null (076:16-32) and "
      + "configuration_releases.status (migration 099:18-19)",
    spec: "PD-011 §6, §16",
  },
  {
    metricId: "cfg.scheduled_changes", module: "configuration",
    displayName: "Scheduled changes",
    definition: "Change sets carrying a future effective time — PD-011 §16's SCHEDULED state.",
    producer: "real",
    source: "configuration_releases.scheduled_for with rollout = 'scheduled' (migration 099:14-16)",
    spec: "PD-011 §16",
  },
  {
    metricId: "cfg.failed_activation", module: "configuration",
    displayName: "Failed activations",
    definition: "Change sets whose activation failed — PD-011 §16's FAILED state.",
    producer: "real", source: "configuration_releases.status = 'failed' (migration 099:18)",
    spec: "PD-011 §16, §28",
  },
  {
    metricId: "cfg.governance_quality", module: "configuration",
    displayName: "Definitions with a governance gap",
    definition:
      "Registry objects missing an owner, missing a data source, pointing at a dependency that does not "
      + "exist, or parented to a key that does not exist. PD-011 §4 requires ownership and dependencies "
      + "on every definition; these are the ones that do not have them.",
    producer: "real",
    source: "computed by loadRegistry (src/lib/config/registry.ts:36-41) over configuration_registry_objects",
    spec: "PD-011 §4, §19",
  },
  {
    metricId: "cfg.recent_changes", module: "configuration",
    displayName: "Recent configuration changes",
    definition:
      "Who changed which setting at which scope, with the previous value, most recent first.",
    producer: "real",
    source:
      "workspace_config_audit (migration 076:51+ — action set/reset/publish/rollback, old_value, actor), "
      + "configuration_registry_audit (092:47) and configuration_release_events (099:31)",
    missing:
      "⚠ THREE TRAILS, AND THEY DO NOT COVER THE SAME SUBJECT. workspace_config_audit records a VALUE "
      + "change at a scope (set/reset/publish/rollback, carrying both old_value and new_value). "
      + "configuration_registry_audit records a DEFINITION change. configuration_release_events records "
      + "a CHANGE-SET transition. Answering \"what happened to this setting\" means reading all three — "
      + "and none of them covers the Practice-plane domain tables of §7–§15, whose changes are audited "
      + "into practice_audit_event, which this plane may not read (plane-boundary.ts declares its "
      + "absence deliberate).",
    spec: "PD-011 §6, §22, §26",
  },
  {
    metricId: "cfg.practice_domain_settings", module: "configuration",
    displayName: "Practice domain configuration",
    definition:
      "The real, live values behind PD-011 §7–§15: booking rules, note templates, follow-up templates, "
      + "task templates, security policy, capture settings and the rest.",
    producer: "derivable",
    source:
      "roughly twenty practice_* configuration tables — practice_configuration (191:101), "
      + "practice_booking_rule (+_version) (230:158, 244:161), practice_note_template (195:58), "
      + "practice_follow_up_template (206:34), practice_task_template (211:54), "
      + "practice_security_policy (213:66), practice_capture_setting (275:468) and others",
    missing:
      "⚠ NOT A MISSING QUERY AND NOT A MISSING TABLE — A REFUSED READ. None of these tables is on the "
      + "platform-plane allowlist (src/lib/access/plane-boundary.ts), so a page under "
      + "src/app/super-admin/** that read one would be refused by scripts/plane-boundary-harness.ts. "
      + "The rows exist and are written by the product every day; this plane may not see them. Widening "
      + "the allowlist is an owner decision — it has been taken once, deliberately, for one table — and "
      + "it is not a decision a screen may take for itself.",
    spec: "PD-011 §7–§15",
  },
  {
    metricId: "cfg.markets_configured", module: "configuration",
    displayName: "Markets configured",
    definition: "Markets for which an approved market-specific configuration override exists.",
    producer: "absent", source: null,
    missing:
      "⚠ THERE IS NO MARKET LAYER TO CONFIGURE. workspace_config_overrides.scope_type is constrained by "
      + "migration 076:20-21 to exactly platform, tenant, hospital, unit, role and user. `market` is not "
      + "a legal value, so no market override has ever been written and none could be. Counting the "
      + "distinct countries of the practices that exist is a real figure and is shown on Market & "
      + "Localization — but it counts PRACTICES, not configured markets, and calling it the second "
      + "would imply a governed layer that nothing can evaluate.",
    spec: "PD-011 §6, §14",
  },
  {
    metricId: "cfg.drift", module: "configuration",
    displayName: "Configuration drift",
    definition:
      "Divergence between the authoritative configuration and the state actually applied at runtime.",
    producer: "absent", source: null,
    missing:
      "Nothing observes the runtime. There is no agent, no heartbeat and no applied-configuration "
      + "report, so no runtime state has ever been verified and §20's required \"last verified runtime "
      + "state and timestamp\" has no value to show. §20 names `unknown` as a drift class for exactly "
      + "this case; a drift tile reading zero would claim a comparison nobody performed.",
    spec: "PD-011 §20",
  },
  {
    metricId: "cfg.expired_overrides", module: "configuration",
    displayName: "Expired temporary overrides",
    definition: "Overrides whose temporary validity has ended and whose inheritance has resumed.",
    producer: "absent", source: null,
    missing:
      "No override carries an expiry. workspace_config_overrides (076:16-32) has no valid-until column "
      + "and no scheduled-removal record, so a temporary override cannot be expressed, cannot lapse and "
      + "cannot be counted. §16's EXPIRED state has no representation in this schema.",
    spec: "PD-011 §16, §28",
  },
  {
    metricId: "cfg.approvals_outstanding", module: "configuration",
    displayName: "Changes awaiting approval",
    definition: "Proposed configuration changes whose required approver has not yet decided.",
    producer: "absent", source: null,
    missing:
      "⚠ APPROVAL IS A STATUS HERE, NOT A RECORD. configuration_releases.status can read 'approved' "
      + "(099:18) and configuration_release_events can carry an 'approved' event, but no definition "
      + "declares an APPROVAL CLASS (§4), no row names a required approver, and there is no "
      + "configuration_approval object at all. So 'awaiting approval' is not a state this database can "
      + "distinguish from 'nobody has looked at it', and maker-checker (§17) is not modelled — which is "
      + "why nothing on these pages offers an approve button.",
    spec: "PD-011 §4, §17",
  },
  {
    metricId: "cfg.affected_practices", module: "configuration",
    displayName: "Practices a proposed change would affect",
    definition:
      "The descendants a change at a given scope would reach — PD-011 §17's preview before activation.",
    producer: "absent", source: null,
    missing:
      "A Practice cannot be the SCOPE of an override, so no change can be addressed to one and no set "
      + "of affected practices can be computed. workspace_config_overrides.hospital_id references "
      + "hospitals(id) (076:18) and the scope enum's tenancy rungs are `tenant` and `hospital`; "
      + "practice_workspace is not reachable from this store. Under the two-gate split "
      + "(COMP-ARCH-PSA-001) that is a product boundary, not an oversight.",
    spec: "PD-011 §17",
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
