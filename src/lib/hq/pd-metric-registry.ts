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
  /**
   * `releases` was added by CPR-PD-012. Its metrics are about the CAPABILITY AND RELEASE CONTROL
   * PLANE - what capabilities exist, what is deployed, what is rolling out and who may use it. The
   * module divides cleanly: the capability CATALOGUE is real code that ships with the product, and
   * every RELEASE, ROLLOUT and READINESS object PD-012 names is absent from this schema.
   */
  module: "intelligence" | "adoption" | "commercial" | "mission" | "configuration" | "releases" | "health" | "support";
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

  // ── RELEASES & CAPABILITIES (CPR-PD-012) ──────────────────────────────────────────────────────
  //
  // ⚠ PD-012 §4 STATES THE RULE THIS WHOLE MODULE TURNS ON: "Lifecycle state is distinct from a
  // runtime feature flag. A capability cannot be made generally available merely by toggling a flag."
  // This repository has excellent ACTIVATION machinery and no LIFECYCLE machinery, so the entries
  // below split almost exactly along that line: the catalogue and its dependencies are real, and every
  // release, rollout and readiness object the specification names is absent.
  //
  // ⚠ AND THREE OF THE `derivable` ENTRIES ARE REFUSED READS, NOT MISSING QUERIES. The rows exist and
  // the Practice product writes them daily; practice_capability_activation and its event log are not
  // on the platform-plane allowlist, so no page under src/app/super-admin/** may read them. That is a
  // different sentence from "the fact does not exist" and the screens say which.
  {
    metricId: "rel.capability_catalogue", module: "releases",
    displayName: "Governed Practice capabilities",
    definition:
      "The canonical catalogue of independently governed Competen Practice capabilities — PD-012 §3's "
      + "capability object. Twelve, and the union is the whole vocabulary.",
    producer: "real",
    source:
      "CAPABILITY_REGISTRY, src/lib/practice/capability-registry.ts:44-56 and :127-263 — code "
      + "constants, so this count needs no database round trip and can never be unreadable",
    spec: "PD-012 §3",
  },
  {
    metricId: "rel.capability_dependency_edges", module: "releases",
    displayName: "Declared capability dependencies",
    definition:
      "Edges of PD-012 §15's dependency graph: capability-to-capability requirements plus the "
      + "configuration artefacts a capability needs before it can work.",
    producer: "real",
    source:
      "`requires` / `requiresSetup` / `recommends` on each CapabilityDefinition "
      + "(capability-registry.ts:99-112), with requiredClosure and dependentClosure exported so a "
      + "screen and a harness use the same rule rather than two copies of it",
    spec: "PD-012 §3, §15",
  },
  {
    metricId: "rel.launch_flags", module: "releases",
    displayName: "Practice launch flags",
    definition:
      "The three ordered launch flags that are the ONE genuine exposure control this product has over "
      + "Competen Practice: pilot provisioning, sign-in and public signup.",
    producer: "real",
    source:
      "practice_platform_flags (migration 191:256-260), read through loadPracticeOps() and ordered by "
      + "FLAG_ORDER (src/lib/practice/operations.ts:36). Allowlisted on the platform plane for "
      + "flag / enabled / note",
    spec: "PD-012 §8, §19",
  },
  {
    metricId: "rel.releases_recorded", module: "releases",
    displayName: "Releases recorded",
    definition:
      "Rows in the platform release log. ⚠ A RELEASE ROW IS A HUMAN'S ENTRY, NOT A DEPLOYMENT FACT: no "
      + "CI/CD pipeline writes this table, so it records what somebody chose to record.",
    producer: "real",
    source:
      "plat_deployments (migration 044:32-41, enriched 054:29-31) — version, channel, status, notes, "
      + "released_at, git_commit, build_number, created_by",
    spec: "PD-012 §6",
  },
  {
    metricId: "rel.rollbacks_recorded", module: "releases",
    displayName: "Rollbacks recorded",
    definition: "Release rows whose status is rolled_back.",
    producer: "real",
    source: "plat_deployments.status = 'rolled_back' (044:36, one of four legal values)",
    spec: "PD-012 §16, §18",
  },
  {
    metricId: "rel.estate_flags", module: "releases",
    displayName: "Estate feature flags",
    definition:
      "⚠ FLAGS ON A DIFFERENT PLANE, AND THE LABEL MATTERS MORE THAN THE COUNT. plat_feature_flags is "
      + "the HOSPITAL ESTATE's flag catalogue, scoped per tenant. It is not a Competen Practice control "
      + "and no CP.* capability is reachable from it.",
    producer: "real",
    source:
      "plat_feature_flags (042:91-97) and plat_feature_flag_assignments (042:98-106), the latter "
      + "carrying scope_type in (global, tenant, country, plan, cohort)",
    spec: "PD-012 §8",
  },
  {
    metricId: "rel.config_change_sets", module: "releases",
    displayName: "Configuration change sets",
    definition:
      "Change sets in the configuration publishing service — the nearest thing to PD-012 §6's release "
      + "record that this repository actually has, and it releases CONFIGURATION, not code.",
    producer: "real",
    source:
      "configuration_releases (migration 099:7-27): channel, rollout mode, objects, validation, "
      + "checkpoint and a status enum of eight values",
    spec: "PD-012 §6",
  },
  {
    metricId: "rel.gate_auto_pass", module: "releases",
    displayName: "Automatic readiness checks passing",
    definition:
      "The IAM-001 §14 cutover checklist evaluated against the live database — the only readiness gate "
      + "that exists in this product, and it is a LAUNCH gate for the product as a whole rather than a "
      + "per-release or per-capability gate.",
    producer: "real",
    source: "evaluateGate() (src/lib/practice/operations.ts:232-296), composed through loadPdOperations",
    numerator: "auto checks in state pass", denominator: "auto checks evaluated",
    spec: "PD-012 §7, §19",
  },
  {
    metricId: "rel.capability_activation_estate", module: "releases",
    displayName: "Practices with each capability active",
    definition:
      "How many Practice workspaces have each CP.* capability switched on — PD-012 §10's entitlement "
      + "answer at the practice level.",
    producer: "derivable",
    source:
      "practice_capability_activation (migration 278:85-148), unique on "
      + "(workspace_id, capability_code), plus defaultActive() for the two capabilities whose registry "
      + "default is `on` and which are therefore active WITH NO STORED ROW (capability-registry.ts:92)",
    missing:
      "⚠ NOT A MISSING QUERY AND NOT AN EMPTY TABLE — A REFUSED READ. practice_capability_activation is "
      + "not on the platform-plane allowlist (src/lib/access/plane-boundary.ts), so a page under "
      + "src/app/super-admin/** that read it would be turned red by scripts/plane-boundary-harness.ts. "
      + "The rows exist and the Practice product writes them. Widening the allowlist is an owner "
      + "decision — taken once, deliberately, for one table — and not one a screen may take for "
      + "itself. ⚠ And the count would need defaultActive(), not a row count: absence of a row means "
      + "the registry default, so counting rows would report no Calendar for every practice "
      + "provisioned before migration 278.",
    spec: "PD-012 §10, §17",
  },
  {
    metricId: "rel.capability_activation_history", module: "releases",
    displayName: "Capability activations over time",
    definition:
      "When each capability was switched on or off across the estate, and by which of the four "
      + "sources — explicit, dependency, mode preset or provisioning default.",
    producer: "derivable",
    source:
      "practice_capability_activation_event (278:165-207): action, state_before, state_after, source, "
      + "mode_code, actor_id, correlation_id, reason, occurred_at",
    missing:
      "The same refused read as rel.capability_activation_estate. This is the richest release-history "
      + "stream in the product — it answers WHY a capability changed, not merely that it did — and it "
      + "sits on the Practice plane, so Release History cannot show it.",
    spec: "PD-012 §18",
  },
  {
    metricId: "rel.entitlement_plan_mix", module: "releases",
    displayName: "Capability entitlement by plan",
    definition:
      "Which plan entitles a Practice to which capability — PD-012 §13's plan availability map.",
    producer: "derivable",
    source:
      "practice_entitlement (191:138-150) holds plan_code and status per workspace; practice_plans "
      + "(191:249-254) is the plan catalogue",
    missing:
      "⚠ TWO WALLS, AND THE SECOND IS THE REAL ONE. practice_entitlement is not on the platform-plane "
      + "allowlist, so this plane may not read it. And even with the read, NOTHING MAPS A CP.* "
      + "CAPABILITY TO A PLAN anywhere in this schema: there is no capability column on a plan, no plan "
      + "column on an activation, and no join table between them. §13's mapping object does not exist, "
      + "so plan availability is not a query away — it is a schema away.",
    spec: "PD-012 §13",
  },
  {
    metricId: "rel.rollout_percentage", module: "releases",
    displayName: "Rollout percentage",
    definition:
      "The share of the eligible population a capability is currently exposed to — PD-012 §9's "
      + "Percentage Rollout stage.",
    producer: "absent", source: null,
    missing:
      "⚠ NOTHING ANYWHERE STORES A ROLLOUT PERCENTAGE, AND NOTHING COULD ASSIGN ONE. It needs two "
      + "things and this product has neither. A store: there is no percentage column on any table, and "
      + "plat_feature_flag_assignments targets by scope_type in (global, tenant, country, plan, cohort) "
      + "— never by proportion (042:101). And a deterministic bucketing function to make assignment "
      + "sticky per subject, which §9 requires and which does not exist in this codebase. "
      + "configuration_releases.rollout does read 'phased' and 'canary' (099:12-13) — those are "
      + "CONFIGURATION-release mode names, one word each, on a different object, carrying no "
      + "proportion, no cohort and no assignment.",
    numerator: "subjects exposed", denominator: "eligible subjects",
    spec: "PD-012 §9",
  },
  {
    metricId: "rel.rollout_stage", module: "releases",
    displayName: "Rollout stage",
    definition:
      "Which of §9's seven stages a capability's rollout currently sits at — Internal, Synthetic/Test, "
      + "Named Pilot, Early Access, Percentage, Market/Plan or General Availability.",
    producer: "absent", source: null,
    missing:
      "There is no rollout object at all: no rollout, no rollout_stage, no rollout_cohort and no "
      + "rollout_assignment table, and §25 names all four. A capability has an ACTIVATION state per "
      + "practice — active or inactive, 278:92 — which is a switch, not a stage, and it is set by the "
      + "practice rather than by a rollout plan.",
    spec: "PD-012 §9, §25",
  },
  {
    metricId: "rel.active_rollouts", module: "releases",
    displayName: "Active rollouts",
    definition: "Rollouts currently in progress, by stage — the headline of §5's overview.",
    producer: "absent", source: null,
    missing:
      "Follows from rel.rollout_stage: with no rollout object, a rollout cannot be started, paused, "
      + "expanded, contracted or counted. A tile reading zero would say \"nothing is rolling out\" when "
      + "the truth is that this product cannot express a rollout at all.",
    spec: "PD-012 §5, §9",
  },
  {
    metricId: "rel.capability_lifecycle", module: "releases",
    displayName: "Capability lifecycle state",
    definition:
      "PD-012 §4's eight-state lifecycle — Proposed, Development, Internal, Pilot, Early Access, "
      + "General Availability, Deprecated, Retired.",
    producer: "absent", source: null,
    missing:
      "⚠ THE DISTINCTION §4 FORBIDS COLLAPSING IS CURRENTLY COLLAPSED BY OMISSION. Nothing carries a "
      + "lifecycle state: CapabilityDefinition (capability-registry.ts:99-112) has no lifecycle field, "
      + "and practice_capability_activation.state is active or inactive PER PRACTICE (278:92) — a "
      + "switch one customer flips, not a product stage this company declares. So \"capabilities by "
      + "lifecycle state\" (§5) has no producer, and no capability can be shown as GA or Deprecated.",
    spec: "PD-012 §4, §5",
  },
  {
    metricId: "rel.capability_owner", module: "releases",
    displayName: "Capability owner",
    definition: "The named product or domain owner accountable for a capability (§3) or a flag (§8).",
    producer: "absent", source: null,
    missing:
      "No owner field exists on any capability definition or on either flag table. §3 requires a named "
      + "owner on every capability and §8 requires one on every production flag; neither has a column "
      + "to hold it, so an ownerless-capability count would be twelve out of twelve and would read as a "
      + "governance finding rather than as a missing schema.",
    spec: "PD-012 §3, §8",
  },
  {
    metricId: "rel.capability_governance_class", module: "releases",
    displayName: "Capability governance class",
    definition:
      "The security, privacy, clinical-safety or commercial review class a capability's changes require.",
    producer: "absent", source: null,
    missing:
      "Not modelled for CP.* capabilities. ⚠ The CONFIGURATION registry does carry a "
      + "safety_classification with a nine-value vocabulary (migration 092), which is the right shape — "
      + "on a different object set, one that contains no Practice capability. Borrowing it would "
      + "attribute a classification nobody assigned.",
    spec: "PD-012 §3, §7",
  },
  {
    metricId: "rel.release_content", module: "releases",
    displayName: "What is in a release",
    definition:
      "The capabilities, fixes, migrations and configuration changes a release contains — §6's Content "
      + "field, and the join that would let a capability point at the release that shipped it.",
    producer: "absent", source: null,
    missing:
      "plat_deployments.notes is free text (044:37). There is no release_item table, no "
      + "release-to-capability link and no migration manifest, so a release cannot say what it shipped "
      + "and a capability cannot say which release it arrived in. ⚠ Migration state is doubly absent: "
      + "nothing in this database records which migrations have been applied, so §7's migrations gate "
      + "has no evidence to read.",
    spec: "PD-012 §6, §7, §25",
  },
  {
    metricId: "rel.release_approvals", module: "releases",
    displayName: "Release approvals and risk class",
    definition:
      "§6's Risk class and Approvals fields, and §5's high-risk pending approvals — who must sign a "
      + "release off, and whether they have.",
    producer: "absent", source: null,
    missing:
      "Neither exists. plat_deployments has no risk column, no approver and no approval record, and "
      + "there is no release_approval object of any kind. So \"awaiting approval\" cannot be "
      + "distinguished from \"nobody has looked at it\", and maker-checker (§21) has nowhere to record "
      + "a decision — which is why nothing in this module offers an approve button.",
    spec: "PD-012 §5, §6, §21",
  },
  {
    metricId: "rel.readiness_gates", module: "releases",
    displayName: "Release readiness gates",
    definition:
      "§7's twelve gates — build, migrations, configuration, dependencies, security, privacy, clinical "
      + "safety, product health, critical journeys, support readiness, pilot acceptance and "
      + "commercial/market — each with a pass, fail, conditional or unknown result and its evidence.",
    producer: "absent", source: null,
    missing:
      "⚠ ALL TWELVE. There is no readiness_gate_definition, no readiness_gate_result and no attestation "
      + "record, so no gate can pass, fail or block an expansion. Four of the twelve depend on Product "
      + "Health, which has no health store and no journey checks, so those four could not be automated "
      + "even once a gate object existed. What DOES exist is the IAM-001 cutover checklist "
      + "(operations.ts:232-296) — a launch gate for the product as a whole, evaluated live, with its "
      + "human-attested items kept separate and never auto-greened.",
    spec: "PD-012 §7",
  },
  {
    metricId: "rel.flag_governance", module: "releases",
    displayName: "Flag owner, type and expiry",
    definition:
      "§8's canonical flag record: owner, flag type (release, experiment, operational kill switch or "
      + "temporary compatibility) and an expiry or review date.",
    producer: "absent", source: null,
    missing:
      "plat_feature_flags has key, description, default_on and product_code (042:91-97) and none of the "
      + "four governance fields. practice_platform_flags has flag, enabled and note (191:256-260) — no "
      + "owner, no type, no expiry either. So §8's requirement that temporary flags carry expiry or "
      + "review dates \"to prevent permanent hidden product states\" cannot be enforced: a temporary "
      + "flag is indistinguishable from a permanent one in both stores.",
    spec: "PD-012 §8",
  },
  {
    metricId: "rel.market_availability", module: "releases",
    displayName: "Capability availability by market",
    definition:
      "Which capabilities are permitted in which country or market, with effective dates and state (§12).",
    producer: "absent", source: null,
    missing:
      "⚠ NO CAPABILITY-TO-MARKET MAPPING EXISTS. practice_workspace.country and practice_location.country "
      + "record where practices ARE, which §12 is explicit must not be confused with where a capability "
      + "is PERMITTED (\"do not infer market availability from locale or currency\"). "
      + "plat_feature_flag_assignments has a `country` scope (042:101) — on the hospital estate plane, "
      + "for estate flags, reaching no CP.* capability.",
    spec: "PD-012 §12",
  },
  {
    metricId: "rel.kill_switch", module: "releases",
    displayName: "Capability kill switch",
    definition:
      "An operational control that withdraws a capability across the estate to a known safe posture "
      + "(§8, §16), with recovery and re-enable criteria.",
    producer: "absent", source: null,
    missing:
      "There is no product-level kill switch for any CP.* capability. Deactivating a capability writes "
      + "practice_capability_activation PER WORKSPACE (278:85) — it is the practice's own switch, not "
      + "the landlord's, and there is no path that sets it across the estate. ⚠ The three launch flags "
      + "ARE real kill switches for ENTRY (provisioning, sign-in, signup) and are the honest thing to "
      + "point at; they withdraw the door, not a feature.",
    spec: "PD-012 §8, §16",
  },
  {
    metricId: "rel.post_deploy_verification", module: "releases",
    displayName: "Post-deployment verification",
    definition:
      "§6's requirement that release completion needs post-deployment verification and not only CI/CD "
      + "success — the health and critical-journey evidence recorded after a deploy, and again after a "
      + "rollback (§16).",
    producer: "absent", source: null,
    missing:
      "There is no post-deploy evidence because there is no health telemetry to record: Product Health "
      + "has no health-issue store and no critical-journey check, so a release cannot be verified, a "
      + "rollback cannot be confirmed recovered, and a deploy that succeeded while the product broke "
      + "would look identical to one that worked.",
    spec: "PD-012 §6, §16",
  },
  {
    metricId: "rel.pilot_acceptance", module: "releases",
    displayName: "Pilot cohorts and acceptance",
    definition:
      "§14's pilot record: named participants, start and end, capability and version under test, "
      + "structured acceptance criteria and an explicit exit decision.",
    producer: "absent", source: null,
    missing:
      "No pilot object exists. practice_pilot_provisioning is a BOOLEAN — one flag saying whether a "
      + "platform operator may provision workspaces at all — and provisioning_request records the "
      + "mechanics of creating one, with no pilot name, no cohort, no acceptance criterion and no exit "
      + "decision. practice_cohort (migration 305) is a Product-Intelligence analytics cohort on the "
      + "Practice plane, not a release cohort, and this plane may not read it. §14's \"do not treat "
      + "absence of complaints as acceptance\" has nowhere to record acceptance instead.",
    spec: "PD-012 §14",
  },
  {
    metricId: "rel.availability_decision", module: "releases",
    displayName: "Effective availability decision",
    definition:
      "§11's resolver: a machine-readable decision plus safe human-readable reason codes for why a "
      + "capability is or is not available to a given subject, across all eleven conditions.",
    producer: "absent", source: null,
    missing:
      "Five of §11's eleven conditions have no store at all — lifecycle, the release-version linkage, "
      + "market, plan or segment, and a governance block — and one more, subject entitlement, is on the "
      + "Practice plane and refused here. A resolver that evaluated only the conditions this plane can "
      + "see would return \"available\" from a partial evaluation, and §11's own decision object makes "
      + "that worse rather than better: a machine-readable verdict carries more authority than a "
      + "sentence, and this one would be wrong for precisely the reasons it could not see. The real "
      + "gate exists inside the Practice product, where the activation rows and the permission grants "
      + "both live.",
    spec: "PD-012 §10, §11",
  },
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  // CPR-PD-008 — PRODUCT HEALTH.
  //
  // ⚠ THE MODULE SPLITS ON ONE LINE, AND IT IS NOT THE ONE THE SPEC DRAWS. PD-008 asks for
  // availability, Apdex, P95 latency and error rate across Competen Practice. None of those is
  // recorded anywhere. What IS recorded is the health of the platform's own machinery — AI calls, job
  // runs and platform events — which is genuinely observed, genuinely useful, and genuinely NOT the
  // same claim. Every real metric below is therefore scoped in its own definition to the machinery it
  // measures, so no reader can take "AI availability" for "Practice availability".
  //
  // ⚠ AND TWO OF THE ABSENCES ARE REFUSALS, NOT GAPS. practice_sync_transaction and the practice
  // message tables EXIST and are written every day; this plane may not read them. Saying "no data"
  // about a table full of rows would be the more comfortable sentence and the false one.
  {
    metricId: "hlt.ai_requests", module: "health",
    displayName: "AI requests recorded",
    definition:
      "Rows in the platform's AI request log. This is the AI service's traffic across the platform, "
      + "not Competen Practice's — the log carries tenant_id, and a Practice has none.",
    producer: "real", source: "plat_ai_requests",
    spec: "PD-008H",
  },
  {
    metricId: "hlt.ai_failures", module: "health",
    displayName: "AI requests that failed",
    definition:
      "AI requests recorded with status 'error'. ⚠ A REFUSAL IS NOT COUNTED HERE — the column's "
      + "vocabulary is ('ok','refusal','error','not_configured'), and 'refusal' is the guardrail "
      + "declining a request, which is the safety machinery working rather than failing. A failure here "
      + "is the AI call itself erroring, and it is not a practitioner-visible outage either.",
    producer: "real", source: "plat_ai_requests.status = 'error'",
    spec: "PD-008H",
  },
  {
    metricId: "hlt.ai_latency_p95", module: "health",
    displayName: "AI latency, 95th percentile",
    definition:
      "The 95th percentile of recorded AI round-trip latency in milliseconds. ⚠ This is the LATENCY OF "
      + "AN AI CALL and never the latency of a Practice page — PD-008B's P95 is about the product's own "
      + "responsiveness and has no producer.",
    producer: "real", source: "plat_ai_requests.latency_ms",
    spec: "PD-008H",
  },
  {
    metricId: "hlt.ai_providers", module: "health",
    displayName: "AI providers in use",
    definition: "Distinct providers appearing in the AI request log, which is what a fallback would move between.",
    producer: "real", source: "plat_ai_requests.provider",
    spec: "PD-008H",
  },
  {
    metricId: "hlt.job_runs", module: "health",
    displayName: "Job runs recorded",
    definition:
      "Rows in the platform job-run log. These are the scheduled and triggered background jobs the "
      + "platform runs; several serve Practice, and the log does not say which.",
    producer: "real", source: "plat_job_runs",
    spec: "PD-008A",
  },
  {
    metricId: "hlt.job_failures", module: "health",
    displayName: "Job runs that failed",
    definition:
      "Job runs whose recorded status is a failure. This is the closest thing in the schema to an "
      + "observed component failure, and it covers background work only — never a request path.",
    producer: "real", source: "plat_job_runs.status and .error",
    spec: "PD-008A",
  },
  {
    metricId: "hlt.job_duration_p95", module: "health",
    displayName: "Job duration, 95th percentile",
    definition:
      "The 95th percentile of recorded job run duration in milliseconds, over runs that finished. A "
      + "run still in flight has no duration and is excluded rather than counted as zero.",
    producer: "real", source: "plat_job_runs.duration_ms",
    spec: "PD-008A",
  },
  {
    metricId: "hlt.jobs_tracked", module: "health",
    displayName: "Distinct jobs tracked",
    definition: "How many named jobs have ever reported a run — the component inventory this module can actually see.",
    producer: "real", source: "plat_job_runs.job_key",
    spec: "PD-008A",
  },
  {
    metricId: "hlt.platform_events", module: "health",
    displayName: "Platform events recorded",
    definition: "Rows in the platform event log, which carries a severity and a type on every row.",
    producer: "real", source: "plat_platform_events",
    spec: "PD-008C",
  },
  {
    metricId: "hlt.events_critical", module: "health",
    displayName: "Critical platform events",
    definition:
      "Platform events recorded at critical severity. ⚠ These are PLATFORM events; an event here is not "
      + "an incident, has no owner and no lifecycle, and PD-009's incident estate is a different object.",
    producer: "real", source: "plat_platform_events.severity = 'critical'",
    spec: "PD-008C",
  },
  {
    metricId: "hlt.events_warning", module: "health",
    displayName: "Warning platform events",
    definition:
      "Platform events recorded at warning severity. ⚠ SHOWN BESIDE CRITICAL RATHER THAN FOLDED INTO IT. "
      + "The column's vocabulary is ('info','warning','critical') and holds no 'high'; an earlier version "
      + "of this module counted \"high and critical\", which can only ever total the criticals, and "
      + "rendered a reassuring zero while warnings sat unmentioned next to it.",
    producer: "real", source: "plat_platform_events.severity = 'warning'",
    spec: "PD-008C",
  },
  {
    metricId: "hlt.ai_refusals", module: "health",
    displayName: "AI requests refused by the guardrail",
    definition:
      "AI requests recorded with status 'refusal'. This is the guardrail declining, and it is a measure "
      + "of the safety machinery working — never a fault count.",
    producer: "real", source: "plat_ai_requests.status = 'refusal'",
    spec: "PD-008H",
  },
  {
    metricId: "hlt.job_running", module: "health",
    displayName: "Job runs still in flight",
    definition:
      "Runs recorded as 'running'. Shown because a run in flight is neither a success nor a failure, and "
      + "a screen that counts only the other two silently loses them.",
    producer: "real", source: "plat_job_runs.status = 'running'",
    spec: "PD-008A",
  },
  {
    metricId: "hlt.deployments_window", module: "health",
    displayName: "Deployments in the window",
    definition:
      "Deployments recorded in the period being read, offered as the change context a degradation "
      + "would be correlated against. It is a count of releases, never a cause.",
    producer: "real", source: "plat_deployments.released_at",
    spec: "PD-008J",
  },
  {
    metricId: "hlt.ai_failure_share", module: "health",
    displayName: "Share of AI requests that failed",
    definition:
      "Failed AI requests over all recorded AI requests, in the same window. Rendered only because "
      + "both halves are counted from the same complete log, and labelled with its denominator.",
    producer: "derivable", source: "plat_ai_requests",
    numerator: "AI requests with a failure status",
    denominator: "all AI requests recorded in the window",
    spec: "PD-008H",
  },
  {
    metricId: "hlt.job_failure_share", module: "health",
    displayName: "Share of job runs that failed",
    definition:
      "Failed job runs over all recorded job runs, in the same window, from one complete log.",
    producer: "derivable", source: "plat_job_runs",
    numerator: "job runs with a failure status",
    denominator: "all job runs recorded in the window",
    spec: "PD-008A",
  },

  // ── the absences ──────────────────────────────────────────────────────────────────────────────
  {
    metricId: "hlt.availability", module: "health",
    displayName: "Practice availability",
    definition: "The share of time Competen Practice was serving requests successfully — PD-008B's headline objective.",
    producer: "absent", source: null,
    missing:
      "⚠ NOTHING MEASURES WHETHER COMPETEN PRACTICE WAS UP. There is no uptime probe, no health-check "
      + "record, no request log and no synthetic monitor anywhere in this schema, so there is no "
      + "numerator and no denominator to divide. An availability figure here would be a number chosen "
      + "rather than a number observed. plat_job_runs proves BACKGROUND WORK ran; it says nothing about "
      + "whether a practitioner could open the Planner.",
    numerator: "time serving successfully", denominator: "time in the period",
    spec: "PD-008B",
  },
  {
    metricId: "hlt.apdex", module: "health",
    displayName: "Apdex",
    definition: "The satisfied/tolerating/frustrated ratio against a stated latency threshold.",
    producer: "absent", source: null,
    missing:
      "Apdex requires per-request latency for the product's own requests and a declared threshold. "
      + "Neither exists. plat_ai_requests.latency_ms is the latency of a call to an AI provider, which "
      + "is a different population from the requests a practitioner waits on.",
    spec: "PD-008B",
  },
  {
    metricId: "hlt.request_latency_p95", module: "health",
    displayName: "Practice request latency, 95th percentile",
    definition: "The 95th percentile of the time a practitioner waits for Competen Practice to respond.",
    producer: "absent", source: null,
    missing:
      "No request timing is recorded for Competen Practice. The only latency column in the schema "
      + "belongs to the AI request log and measures a provider call, not a page or an API route.",
    spec: "PD-008B",
  },
  {
    metricId: "hlt.error_rate", module: "health",
    displayName: "Practice error rate",
    definition: "Failed product operations over all product operations, in a period.",
    producer: "absent", source: null,
    missing:
      "⚠ THE DENOMINATOR IS THE MISSING HALF, NOT THE NUMERATOR. Errors surface in several logs; the "
      + "count of operations ATTEMPTED is recorded nowhere, so no rate can be formed. A count of errors "
      + "without it is a tally, and PD-008C asks for a rate and a trend.",
    numerator: "failed operations", denominator: "all operations attempted",
    spec: "PD-008C",
  },
  {
    metricId: "hlt.journey_health", module: "health",
    displayName: "Critical journey health",
    definition:
      "The standing of each critical practitioner journey — sign-in, Practice open, Planner, booking, "
      + "encounter save and sign, follow-up, document generation, invoice issue.",
    producer: "absent", source: null,
    missing:
      "⚠ THIS IS THE ONE THE SPEC LEADS WITH AND THE ONE FURTHEST FROM EXISTING. It needs either a "
      + "synthetic monitor walking each journey on a schedule, or per-step instrumentation on the real "
      + "journeys. There is no synthetic runner in this codebase and no step-level timing on any "
      + "Practice route. The journeys are named here because naming them is what a build would start "
      + "from, not because any of them is measured.",
    spec: "PD-008D",
  },
  {
    metricId: "hlt.degradations", module: "health",
    displayName: "Current degradations",
    definition: "Open degradations with their scope, severity and owner.",
    producer: "absent", source: null,
    missing:
      "A degradation is a stateful object with an owner, a scope and a lifecycle, and no such record "
      + "exists for Competen Practice. plat_platform_events carries a severity but no owner, no scope "
      + "and no open/closed state — it is a log line, not a degradation.",
    spec: "PD-008 §2",
  },
  {
    metricId: "hlt.slo", module: "health",
    displayName: "Performance objectives",
    definition: "The declared objectives health is judged against, and standing versus each.",
    producer: "absent", source: null,
    missing:
      "No objective is declared anywhere in the product — no target availability, no latency budget, no "
      + "error budget. ⚠ Standing against an objective cannot be shown by inventing the objective; a "
      + "target a reader has not agreed is not a target.",
    spec: "PD-008B",
  },
  {
    metricId: "hlt.integrations", module: "health",
    displayName: "Integration and dependency health",
    definition: "The health of external and internal dependencies Competen Practice relies on.",
    producer: "absent", source: null,
    missing:
      "No dependency register exists and no dependency is probed. The AI provider is the single "
      + "external dependency with any recorded signal at all, and that signal lives under AI Health.",
    spec: "PD-008F",
  },
  {
    metricId: "hlt.security_signals", module: "health",
    displayName: "Product-health security signals",
    definition: "Security signals relevant to product health — authentication failure spikes, lockouts, anomalous access.",
    producer: "absent", source: null,
    missing:
      "⚠ AND THIS ABSENCE IS PARTLY DELIBERATE. PD-008I is explicit that this must not replace the "
      + "security operations function. There is no Practice-scoped security signal series to read here, "
      + "and the estate's security surfaces are a different plane with a different audience.",
    spec: "PD-008I",
  },
  {
    metricId: "hlt.health_history", module: "health",
    displayName: "Health over time",
    definition: "Historical health state, past degradations and objective trends.",
    producer: "absent", source: null,
    missing:
      "History is a series of past health STATES, and no health state has ever been computed or "
      + "stored, so there is nothing to look back over. The event, job and AI logs are timestamped and "
      + "can be trended individually — that is what History shows instead, and it says so.",
    spec: "PD-008J",
  },
  {
    metricId: "hlt.sync_health", module: "health",
    displayName: "Sync and offline transaction health",
    definition: "Outstanding sync transactions, their age, and failures in the offline outbox.",
    producer: "absent", source: null,
    missing:
      "⚠ A REFUSED READ, NOT A MISSING ONE — and the difference matters. practice_sync_transaction "
      + "EXISTS and Competen Practice writes it every time a device syncs. It is not on the practice "
      + "plane's allowlist, so this plane may not read it. Widening that allowlist is an owner "
      + "decision, and the honest sentence is that the rows are there and this screen is not permitted "
      + "to count them.",
    spec: "PD-008E",
  },
  {
    metricId: "hlt.communications_delivery", module: "health",
    displayName: "Message delivery health",
    definition: "Email, SMS, WhatsApp and push delivery success, failure and latency.",
    producer: "absent", source: null,
    missing:
      "⚠ ALSO A REFUSED READ. practice_message, practice_message_channel and practice_notification "
      + "exist and carry delivery state; none is on the practice plane's allowlist. The delivery facts "
      + "are recorded — this plane is not permitted to read them.",
    spec: "PD-008G",
  },
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  // CPR-PD-009 — SUPPORT & INCIDENTS.
  //
  // ⚠ THIS MODULE IS HALF-GROUNDED, AND THE HALVES ARE CLEANLY SEPARATED. Incidents are real: phase 4
  // built a Practice-native model, scoped by foreign key to the canonical subjects and the eight
  // journeys. Everything ELSE s1 names — support cases, problems, postmortems, corrective actions,
  // escalations — has no store of any kind. They are not unwritten queries over empty tables; there is
  // no table to be empty.
  //
  // ⚠ AND s1's LAST LINE IS A CONSTRAINT ON THIS REGISTRY, not just on the screens: "Do not treat
  // individual clinical concerns or patient records as product support data." No metric here counts a
  // patient, and none ever may.
  {
    metricId: "sup.incidents_open", module: "support",
    displayName: "Open incidents",
    definition:
      "Incidents not yet resolved, closed or in post-incident. §5's lifecycle continues past RESOLVED, "
      + "so the three terminal states are excluded rather than only 'resolved'.",
    producer: "real", source: "mos_incident via mos_incident_open",
    spec: "PD-009 §3",
  },
  {
    metricId: "sup.incidents_sev1", module: "support",
    displayName: "SEV-1 and SEV-2 open",
    definition:
      "Open incidents graded SEV-1 Critical or SEV-2 High — §3's headline posture figure. ⚠ A grade is "
      + "a RESPONSE INTENT, not an error count: §6 says severity considers impact, scope, criticality, "
      + "duration, workaround and data risk, and a person sets it.",
    producer: "real", source: "mos_incident.severity in (sev1, sev2)",
    spec: "PD-009 §3",
  },
  {
    metricId: "sup.incidents_unowned", module: "support",
    displayName: "Open incidents with no owner",
    definition:
      "Open incidents carrying no owner name. §3 asks for unowned items by name, because an incident "
      + "nobody holds is the one that stays open.",
    producer: "real", source: "mos_incident.owner_name is null",
    spec: "PD-009 §3",
  },
  {
    metricId: "sup.incidents_no_commander", module: "support",
    displayName: "Major incidents without a commander",
    definition:
      "SEV-1 or SEV-2 incidents past DETECTED with no owner. §3 lists this first among Needs Attention "
      + "triggers, and §7 makes the commander a required field of the command header.",
    producer: "real", source: "mos_incident, severity and owner_name together",
    spec: "PD-009 §3",
  },
  {
    metricId: "sup.incident_age", module: "support",
    displayName: "Age of the oldest open incident",
    definition:
      "Hours since the oldest unresolved incident started. Shown because an incident's age is the one "
      + "figure that worsens by itself while nobody acts.",
    producer: "real", source: "mos_incident.started_at",
    spec: "PD-009 §3",
  },
  {
    metricId: "sup.cases_open", module: "support",
    displayName: "Open support cases",
    definition: "Practitioner or Practice-reported cases in a non-terminal state — §4's case estate.",
    producer: "absent", source: null,
    missing:
      "⚠ NO SUPPORT CASE RECORD EXISTS ANYWHERE IN THIS SCHEMA. §4 defines a case with a stable id, a "
      + "reporter, a category, a priority, an SLA state and a linked incident — none of those columns "
      + "exists because the table does not. plat_support_tickets is the closest shape and keys on "
      + "tenant_id, which a Practice cannot be. This is a model to build, not a query to write.",
    spec: "PD-009 §4",
  },
  {
    metricId: "sup.first_response", module: "support",
    displayName: "Median first response",
    definition: "The median time from a case being raised to its first human response — §3's support pulse.",
    producer: "absent", source: null,
    missing:
      "It needs a case record and a response event, and neither exists. ⚠ AND A RESPONSE TARGET TOO: §3 "
      + "asks for breached response targets, and no target is configured anywhere, so even with the "
      + "times there would be nothing to breach.",
    numerator: "time to first response", denominator: "cases with a response",
    spec: "PD-009 §3",
  },
  {
    metricId: "sup.escalations", module: "support",
    displayName: "Open escalations",
    definition: "Overdue, high-impact, blocked or cross-team escalations — §2's escalation estate.",
    producer: "absent", source: null,
    missing:
      "No escalation record exists. An escalation is a stateful object with a reason, a target and a "
      + "deadline; nothing in this schema carries any of the three.",
    spec: "PD-009 §2",
  },
  {
    metricId: "sup.problems", module: "support",
    displayName: "Open problems",
    definition: "Recurring or systemic causes under investigation, each linking one or more incidents.",
    producer: "absent", source: null,
    missing:
      "No problem record exists. §1 defines a problem as the underlying cause that GENERATES incidents, "
      + "so it cannot be derived from the incidents it explains — the direction of the relationship is "
      + "the wrong way round for inference.",
    spec: "PD-009 §2",
  },
  {
    metricId: "sup.postmortems", module: "support",
    displayName: "Postmortems outstanding",
    definition: "Qualifying incidents whose postmortem is not complete — §5's POST-INCIDENT obligation.",
    producer: "absent", source: null,
    missing:
      "No postmortem record exists, and no rule says which incidents qualify. §5 says closure cannot "
      + "silently bypass a required postmortem; with neither the record nor the rule, this cannot yet "
      + "be counted or enforced.",
    spec: "PD-009 §2",
  },
  {
    metricId: "sup.corrective_actions", module: "support",
    displayName: "Overdue corrective actions",
    definition: "Actions arising from incidents, problems or postmortems that are past their due date.",
    producer: "absent", source: null,
    missing:
      "No corrective action record exists. §2 requires an owner and a due date on each, which is exactly "
      + "what makes them countable as overdue — and exactly what has nowhere to live.",
    spec: "PD-009 §2",
  },
  {
    metricId: "sup.resolution_time", module: "support",
    displayName: "Median incident resolution time",
    definition:
      "Median hours from an incident starting to reaching a terminal state, over incidents that reached "
      + "one in the window.",
    producer: "derivable", source: "mos_incident.started_at and .resolved_at",
    numerator: "hours from start to resolution",
    denominator: "incidents that reached a terminal state in the window",
    spec: "PD-009 §11",
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
