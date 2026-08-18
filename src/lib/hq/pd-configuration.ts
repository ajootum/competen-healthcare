// CPR-PD-011 — the read model behind Product Configuration's eleven pages.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// ⚠ THE ONE THING TO UNDERSTAND BEFORE READING ANY FIGURE THIS MODULE RETURNS.
//
// PD-011 asks for a governed configuration control plane over Competen Practice. Three configuration
// estates already exist in this repo, they are real, they are audited, and NONE OF THEM HAS COMPETEN
// PRACTICE AS ITS SUBJECT:
//
//   configuration_registry_objects (migration 092)  the catalogue. Its columns are close to a direct
//                                                   implementation of PD-011 §4 — allowed_config_levels,
//                                                   safety_classification, override_policy,
//                                                   configurability_class, dependencies, owner, version.
//   workspace_config_overrides / _versions / _audit the override store with draft → published, version
//   (migration 076)                                 snapshots and a change trail.
//   configuration_releases / _events (mig 099)      change sets, whose status enum lines up almost
//                                                   exactly with PD-011 §16's lifecycle.
//
// And resolveRuntime (src/lib/config/runtime.ts:27-40) already returns an effective value together with
// a `trace` array naming every contributing layer — which is PD-011 §5's "expose effective value plus
// source scope" answered rather than pending.
//
// ⚠ BUT THE HIERARCHY IS NOT THE PRODUCT'S, AND THAT IS THE MOST IMPORTANT FACT ON THESE PAGES.
// SCOPE_ORDER is platform → tenant → hospital → unit → role → user (workspace-config.ts:13). §3 asks
// for platform-enforced → product default → MARKET → PLAN/SEGMENT → Practice → practitioner. Two of
// those six rungs have no scope value at all, and the tenancy rungs point at `hospitals`, not at
// `practice_workspace`. So a market override cannot be written, cannot be evaluated, and cannot be
// counted — and a screen that implies one exists is worse than an empty screen, because a blank invites
// a question and a fabricated affordance ends it. LADDER below renders that, rung by rung.
//
// ⚠ AND THE §7–§15 DOMAIN SETTINGS ARE A REFUSED READ, NOT A MISSING ONE. practice_configuration,
// practice_booking_rule, practice_note_template and about twenty siblings hold the live values and are
// written by the product every day. Not one of them is on the platform-plane allowlist
// (src/lib/access/plane-boundary.ts), so a page under src/app/super-admin/** may not read them and
// scripts/plane-boundary-harness.ts is what makes that sentence true rather than aspirational. Widening
// the allowlist is an owner decision — taken once, deliberately, for one table — and not one a screen
// takes for itself. Every domain page says so in those words.
//
// ⚠ WHAT THIS MODULE READS, AND WHY NONE OF IT NEEDS THE ALLOWLIST WIDENED. Everything below is either
// a PLATFORM table (configuration_registry_objects, workspace_config_*, configuration_release*), which
// the plane boundary does not govern, or it is composed from an existing loader that already reads an
// allowlisted practice_* table at columns already declared — loadPracticeEstate for the market list,
// getFormat/formatHistory for the practitioner-number shape. Two new practice_* reads exist here and
// both are head-only counts on tables whose policy permits counting.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

/* eslint-disable @typescript-eslint/no-explicit-any */

import { loadRegistry, SAFETY_LABEL, CLASS_LABEL } from "@/lib/config/registry";
import { loadConfigOverrides, SCOPE_ORDER } from "@/lib/config/workspace-config";
import { getFormat, formatHistory, type IdentifierFormat } from "@/lib/practice/identifier-format";
import { loadPracticeEstate } from "@/lib/hq/pd-practices";
import { mayRender, absenceSentence } from "@/lib/hq/pd-metric-registry";

type Admin = any;

export { SAFETY_LABEL, CLASS_LABEL };

// ── THE LADDER (PD-011 §3) ───────────────────────────────────────────────────────────────────────────
//
// ⚠ AUTHORED, NOT MEASURED, AND DELIBERATELY SO. Each verdict is a statement about the SCHEMA — a check
// constraint, a foreign key, a switch statement — read by hand at the line given. A runtime probe could
// not produce these sentences: "no market override exists" and "no market override is expressible" are
// the same empty result and opposite facts, and only the second one is true here.

export type RungState =
  /** The engine has this layer and can evaluate it. */
  | "resolves"
  /** The layer evaluates, but only for a narrower kind of value than §4 requires. */
  | "partial"
  /** There is no scope value for this rung. Nothing can write one; nothing could evaluate one. */
  | "no-scope"
  /** The layer exists and points at the wrong entity, so a Practice cannot be its subject. */
  | "wrong-subject";

export type LadderRung = {
  /** PD-011 §3's LEVEL column, in its own words. */
  level: string;
  /** PD-011 §3's INTENT column, in its own words. */
  intent: string;
  state: RungState;
  /**
   * ⚠ THE ONE VISIBLE LINE, AND IT IS IN THE PRODUCT'S LANGUAGE ON PURPOSE.
   *
   * The compact ladder shows this and nothing else. PD-001 §3 and the PD screen doctrine both forbid
   * implementation detail from dominating a Product Director surface, so no migration number, file or
   * line may appear here — they go in `citation`, which only a disclosure body renders.
   */
  reason: string;
  /** What in the engine implements it, in plain words, or null when nothing does. */
  engine: string | null;
  /** The full verdict, still in the product's language. Behind the per-rung disclosure. */
  verdict: string;
  /**
   * ⚠ THE FORENSIC CITATION — migration, file and line. DISCLOSURE BODIES ONLY, never a visible
   * sentence. These are not decoration and must not be deleted: they are why a reader can check a
   * verdict rather than trust it. They are simply not what a director reads first.
   */
  citation: string | null;
};

export const RUNG_STATE_LABEL: Record<RungState, string> = {
  resolves: "Resolves today",
  partial: "Resolves partially",
  "no-scope": "Cannot be resolved — no such scope",
  "wrong-subject": "Cannot be resolved — wrong subject",
};

export const LADDER: LadderRung[] = [
  {
    level: "Platform-enforced rule",
    intent: "Non-overridable Competen-wide constraint, security/safety/platform invariant.",
    state: "resolves",
    reason:
      "The level works. What it enforces is the ESTATE's invariants — no Competen Practice setting is "
      + "registered here yet, so no Practice invariant is expressed by it.",
    engine: "The definition registry's override policy, plus the engine's platform scope.",
    verdict:
      "The engine has this level. Every configuration definition declares an override policy; where "
      + "that policy is \"none\", no lower level may set a value, and the resolver starts from a base "
      + "the levels beneath it cannot remove. ⚠ What it enforces is the ESTATE's invariants: no "
      + "Competen Practice object is registered, so no Practice invariant is expressed here yet.",
    citation:
      "configuration_registry_objects.override_policy = 'none' with scope_type 'platform' "
      + "(migrations 092:22-26 and 076:20-21); the resolver's base layer at src/lib/config/runtime.ts:19-21.",
  },
  {
    level: "Product default",
    intent: "Default behavior for Competen Practice.",
    state: "partial",
    reason:
      "A product default can say on or off and nothing else. There is no typed default, so it cannot "
      + "say \"30 minutes\", \"UGX\" or \"three attempts\".",
    engine: "The definition registry's default-enabled flag, seeded as the platform-default layer of the resolver's trace.",
    verdict:
      "Resolves as a BOOLEAN and nothing more. The base value the resolver starts from is an enabled "
      + "flag, so a product default can say on or off and cannot say \"30 minutes\", \"UGX\" or \"three "
      + "attempts\". PD-011 §4 requires a data type and a typed default on every definition; the "
      + "registry has neither, and carries no validation rule either. A typed default has nowhere to live.",
    citation:
      "configuration_registry_objects.default_enabled; the base layer is built at "
      + "src/lib/config/runtime.ts:19-21. Neither a data-type nor a validation column exists on that table.",
  },
  {
    level: "Market override",
    intent: "Approved country/market-specific behavior.",
    state: "no-scope",
    reason:
      "There is no market layer to configure. The engine's scope list has six levels and market is not "
      + "one of them, so no market override can be written, evaluated or counted.",
    engine: null,
    verdict:
      "⚠ CANNOT BE RESOLVED. The engine recognises exactly six scopes — platform, tenant, hospital, "
      + "unit, role and user — and market is not among them, neither in the constraint the database "
      + "enforces nor in the code that decides which overrides apply. So no market override has ever "
      + "been written, none can be written, and none could be evaluated if it somehow were. Market & "
      + "Localization shows the markets that EXIST, which is a property of the practices, and says "
      + "plainly that it is not a configured layer.",
    citation:
      "workspace_config_overrides.scope_type is constrained to those six by migration 076:20-21, and "
      + "applies() at src/lib/config/workspace-config.ts:16-24 has no branch that could match a market.",
  },
  {
    level: "Plan / segment override",
    intent: "Approved plan or governed segment behavior.",
    state: "no-scope",
    reason:
      "Neither plan nor segment is one of the six scopes — and plan membership sits on the Practice "
      + "plane, so even the audience of a plan override could not be resolved here.",
    engine: null,
    verdict:
      "⚠ CANNOT BE RESOLVED, for the same reason and one more. Plan and segment are not among the "
      + "engine's six scopes. And plan membership is held on the Practice plane, in a table this plane "
      + "may not read, so even the audience of a plan override could not be resolved here.",
    citation:
      "practice_entitlement holds plan membership and is deliberately absent from the platform-plane "
      + "allowlist in src/lib/access/plane-boundary.ts.",
  },
  {
    level: "Practice configuration",
    intent: "Tenant-level setting where explicitly delegated.",
    state: "wrong-subject",
    reason:
      "The engine's two tenancy levels address hospitals. A Practice is not a hospital and carries no "
      + "tenant id, so it cannot be the subject of an override at all.",
    engine: "The override store's tenant and hospital scopes, which key on a hospital record.",
    verdict:
      "⚠ CANNOT BE RESOLVED. The engine's two tenancy levels are tenant and hospital, and the override "
      + "store keys on a hospital. A Competen Practice workspace is not a hospital and carries no "
      + "tenant id — the two-gate split makes Practice a separate product — so a Practice cannot be "
      + "the subject of an override row at all. Its settings genuinely exist, in the Practice "
      + "product's own configuration table and about twenty domain tables, and are governed by that "
      + "product rather than by this engine. Reconciling the two is schema work, not a rendering "
      + "exercise.",
    citation:
      "workspace_config_overrides.hospital_id references hospitals(id) at migration 076:18. The "
      + "Practice's own settings are in practice_configuration, migration 191:101. The two-gate split "
      + "is COMP-ARCH-PSA-001.",
  },
  {
    level: "Practitioner preference",
    intent: "Individual preference only where explicitly safe and allowed.",
    state: "wrong-subject",
    reason:
      "The level itself resolves, but there is nothing for a Practice practitioner to hold a "
      + "preference ABOUT, because no Practice setting is a configuration definition.",
    engine: "The override store's user scope, matched on the signed-in user.",
    verdict:
      "The LEVEL resolves — user is a legal scope and the engine matches it — but there is nothing for "
      + "a Practice practitioner to hold a preference ABOUT, because no Practice setting is a "
      + "configuration definition. The practitioner preferences that are actually stored today live on "
      + "the Practice plane, outside what this plane may read.",
    citation:
      "workspace_config_overrides.scope_type 'user', matched on ctx.userId at "
      + "src/lib/config/workspace-config.ts:22. The stored preferences are in practice_user_preference, "
      + "migration 205:41.",
  },
];

// ── THE DOMAINS (PD-011 §7–§15, §22) ─────────────────────────────────────────────────────────────────
//
// ⚠ `stores` NAMES REAL TABLES AT REAL MIGRATIONS. That is the point of these pages: a Product Director
// asking "where does the booking horizon actually live" gets an answer, even where the answer is
// followed by "and this plane may not read it". A page that said only "not available" would be
// indistinguishable from one nobody had built.

export type DomainStore = {
  table: string;
  /**
   * ⚠ THE CITATION, AND THE `Stores` TABLE RENDERS IT BEHIND A DISCLOSURE RATHER THAN UNDER THE NAME.
   *
   * A reader who wants to go and check the claim gets an exact line. A Product Director reading "where
   * do the booking rules live" gets the table's name and whether this plane may read it, which is the
   * whole of the answer at their altitude. PD-001 §3: implementation detail must not dominate.
   */
  migration: string;
  /** A second source reference, where the store's row is written somewhere worth naming. */
  cite?: string;
  holds: string;
  /** True only for tables the platform-plane allowlist admits. */
  readable: boolean;
};

export type ConfigDomain = {
  key: string;
  title: string;
  href: string;
  spec: string;
  purpose: string;
  /** The settings the specification prescribes for this domain, in its own vocabulary. */
  settings: string[];
  /** The domain's hard rules — the ones a build must not break. Spec wording, condensed. */
  constraints: string[];
  stores: DomainStore[];
};

export const DOMAINS: ConfigDomain[] = [
  {
    key: "defaults", title: "Practice Defaults", href: "/super-admin/pd/configuration/defaults",
    spec: "CPR-PD-011 §7",
    purpose: "Defaults used when a new Practice workspace is provisioned or onboarded.",
    settings: [
      "Default Practice type options", "Onboarding steps", "Initial location behaviour",
      "Availability setup prompts", "Appointment defaults", "Document defaults", "Notification defaults",
    ],
    constraints: [
      "Differentiate values COPIED at provisioning from defaults inherited dynamically — the two behave differently when the default changes.",
      "Changing a product default must state whether it affects existing Practices, future Practices only, or requires a migration.",
      "Never silently overwrite a Practice's authorized explicit configuration.",
    ],
    stores: [
      { table: "practice_configuration", migration: "191:101", holds: "the one effective row per workspace: locale, date format, identifier policy, default encounter mode, feature flags, config version.", readable: false },
      { table: "practice_onboarding_step_catalog", migration: "191:242", holds: "the onboarding steps a new Practice is taken through.", readable: true },
      { table: "practice_identifier_format", migration: "220:39", holds: "the shape of a practitioner number: prefix, digits, check digit, separator, version, locked.", readable: true },
      { table: "practice_plans", migration: "191:249", holds: "the plan codes a new Practice can be given.", readable: true },
    ],
  },
  {
    key: "clinical", title: "Clinical Configuration", href: "/super-admin/pd/configuration/clinical",
    spec: "CPR-PD-011 §8",
    purpose: "Governed clinical lists, parameters, safety-sensitive defaults and clinical behaviour.",
    settings: [
      "Investigation categories", "Diagnosis and procedure list behaviour", "Treatment and frequency options",
      "Anthropometric and vital parameter sets", "Specialty parameters",
      "Medication and dose safety thresholds", "Clinical decision-support parameters",
    ],
    constraints: [
      "Clinical-safety-sensitive configuration requires an explicit safety classification and approval rules.",
      "Medication/dose safety thresholds and decision-support parameters must be versioned and traceable.",
      "No Practice or practitioner override of a safety invariant unless explicitly designed and approved.",
      "A change affecting signed historical encounters must not rewrite the historical clinical record.",
      "Where a terminology source is external, its source and version must be preserved.",
    ],
    stores: [
      { table: "practice_investigation_catalogue", migration: "275:67", holds: "the investigations a practice may order, and their categories.", readable: false },
      { table: "practice_investigation_preference", migration: "275:143", holds: "per-practice investigation preferences.", readable: false },
      { table: "practice_medication_catalogue", migration: "275:272", holds: "the medication list.", readable: false },
      { table: "practice_treatment_template", migration: "275:365", holds: "treatment templates and their items.", readable: false },
      { table: "practice_procedure_template", migration: "209:114", holds: "procedure templates.", readable: false },
      { table: "practice_pathway_template", migration: "239:95", holds: "clinical pathway templates.", readable: false },
    ],
  },
  {
    key: "scheduling", title: "Scheduling & Booking", href: "/super-admin/pd/configuration/scheduling",
    spec: "CPR-PD-011 §9",
    purpose: "Appointment, availability, self-booking and booking-rule defaults.",
    settings: [
      "Default appointment types", "Slot durations", "Booking horizon", "Lead time",
      "Cancellation and rescheduling windows", "Walk-in behaviour", "Self-booking defaults", "Availability rules",
    ],
    constraints: [
      "Product defaults are separate from a practitioner's or Practice's own availability schedule.",
      "Conflicting rules must be prevented — a booking horizon shorter than the required lead time is the named example.",
      "A configuration change must not silently invalidate existing appointments.",
      "Market and timezone behaviour must use canonical timezone-aware rules.",
      "Self-booking behaviour must respect Releases & Capabilities state, not this module's.",
    ],
    stores: [
      { table: "practice_booking_rule", migration: "230:158", holds: "the live booking rules: horizon, lead time, cancellation window, walk-in behaviour.", readable: false },
      { table: "practice_booking_rule_version", migration: "244:161", holds: "prior versions of those rules — the rollback material §21 asks for, already built on the Practice plane.", readable: false },
      { table: "practice_availability_template", migration: "230:63", holds: "availability templates.", readable: false },
    ],
  },
  {
    key: "encounters", title: "Encounter Configuration", href: "/super-admin/pd/configuration/encounters",
    spec: "CPR-PD-011 §10",
    purpose: "Encounter workflow, fields, lists, defaults and completion behaviour.",
    settings: [
      "Permitted and required encounter sections", "Section defaults", "Searchable lists",
      "Workflow ordering where delegated", "Completion and signing requirements", "Quick-entry behaviour",
    ],
    constraints: [
      "Keep the HFE target of rapid clinical entry — do not configure unnecessary mandatory fields.",
      "Safety or legally required fields may be locked at a higher scope.",
      "Changes apply prospectively unless a governed migration explicitly says otherwise.",
      "Encounter configuration must be compatible with the offline/sync contracts.",
    ],
    stores: [
      { table: "practice_note_template", migration: "195:58", holds: "encounter note templates.", readable: false },
      { table: "practice_note_template_section", migration: "195:95", holds: "the sections of each template, which is where required-versus-optional lives.", readable: false },
      { table: "practice_capture_setting", migration: "275:468", holds: "capture behaviour for clinical entry.", readable: false },
      { table: "practice_registration_template", migration: "223:28", holds: "patient registration templates.", readable: false },
    ],
  },
  {
    key: "documents", title: "Documents & Templates", href: "/super-admin/pd/configuration/documents",
    spec: "CPR-PD-011 §11",
    purpose: "Document categories and types, default templates, required metadata and issuance defaults.",
    settings: [
      "Document categories and types", "Default templates", "Required metadata", "Naming behaviour",
      "Generation and issuance defaults", "Letterhead constraints",
    ],
    constraints: [
      "Letterhead customization stays Practice-controlled, only within allowed product constraints.",
      "Template content and versioning must preserve the integrity of already-issued documents.",
      "Shared / issued / review / task / library behaviour must use the frozen Documents architecture.",
      "Do not store executable or untrusted template logic without sandboxing and validation.",
    ],
    stores: [
      { table: "practice_note_template", migration: "195:58", holds: "the template store documents are generated from.", readable: false },
      { table: "practice_task_template", migration: "211:54", holds: "task templates attached to document workflows.", readable: false },
    ],
  },
  {
    key: "communications", title: "Communications", href: "/super-admin/pd/configuration/communications",
    spec: "CPR-PD-011 §12",
    purpose: "Channel, notification, reminder and message-behaviour configuration.",
    settings: [
      "Appointment confirmation defaults", "Reminder defaults", "Follow-up reminders",
      "Channel preference hierarchy", "Retry and suppression rules", "Consent requirements",
    ],
    constraints: [
      "Product Configuration must not activate an undeployed channel — Releases & Capabilities is authoritative for capability availability.",
      "Consent, preferences and market/legal rules must be respected.",
      "Message template content may be separately governed but must be versioned and auditable.",
      "⚠ Provider credentials and secrets are NEVER editable through a Product Director configuration screen (§12, and §31's non-goal: not a secrets-management console).",
    ],
    stores: [
      { table: "practice_message_channel", migration: "224:40", holds: "per-workspace channel enablement: kind (sms, email), enabled, consent requirement, sender identity.", readable: false },
      { table: "practice_escalation_rule", migration: "211:95", holds: "task escalation rules — a different concept from an incident escalation.", readable: false },
      { table: "practice_follow_up_template", migration: "206:34", holds: "follow-up templates and their steps, which carry reminder timing.", readable: false },
    ],
  },
  {
    key: "commercial", title: "Commercial Configuration", href: "/super-admin/pd/configuration/commercial",
    spec: "CPR-PD-011 §13",
    purpose: "Configurable commercial behaviour that is not authoritative plan, price, subscription or payment state.",
    settings: [
      "Grace periods", "Retry and dunning policy parameters", "Renewal-notice windows",
      "Trial reminder timing", "Commercial display defaults",
    ],
    constraints: [
      "Plans & Pricing remains Commercial's — this module references plan records, never duplicates them.",
      "High-impact payment or entitlement behaviour requires approval and safe simulation.",
      "Configuration must not reinterpret accounting rules.",
    ],
    stores: [
      { table: "practice_plans", migration: "191:249", holds: "the plan codes. ⚠ No price and no currency column — the money is not in this table.", readable: true },
      { table: "practice_entitlement", migration: "191", holds: "which plan a workspace holds, and its status.", readable: false },
    ],
  },
  {
    key: "markets", title: "Market & Localization", href: "/super-admin/pd/configuration/markets",
    spec: "CPR-PD-011 §14",
    purpose: "Country and market, locale, currency display, timezone, formats and market-specific defaults.",
    settings: [
      "Market / country", "Locale", "Language where enabled", "Currency display", "Timezone",
      "Date and time format", "Number format", "Market-specific product defaults",
    ],
    constraints: [
      "Use canonical identifiers — IANA timezone, ISO country and currency.",
      "Do not infer legal or regulatory applicability from locale; Compliance & Obligations remains authoritative.",
      "A market override requires an explicit scope and effective date.",
      "Fallback behaviour must be deterministic when a market-specific value is missing.",
    ],
    stores: [
      { table: "practice_workspace", migration: "191:41", holds: "each practice's country and timezone — the market a practice IS in, which is not the same as a market that has been configured.", readable: true },
      { table: "practice_configuration", migration: "191:101", holds: "locale and date format per workspace.", readable: false },
      { table: "practice_location", migration: "191:130", holds: "the location country.", readable: false },
    ],
  },
  {
    key: "ai", title: "AI Configuration", href: "/super-admin/pd/configuration/ai",
    spec: "CPR-PD-011 §15",
    purpose: "AI feature behaviour, model routing, fallback and governed AI settings where enabled.",
    settings: [
      "Feature-level AI availability", "Routing", "Approved model and provider references",
      "Timeout and fallback", "Confidence and guardrail thresholds", "User-facing AI preference defaults",
    ],
    constraints: [
      "Render only for enabled AI capabilities.",
      "Do not expose provider secrets or unrestricted prompt internals.",
      "Safety-critical AI behaviour may require specialist or governance approval.",
      "AI configuration changes must be observable through AI Health and auditable.",
      "AI must degrade gracefully without destabilizing core non-AI Practice workflows.",
    ],
    stores: [
      { table: "plat_ai_requests", migration: "055:11", holds: "⚠ the AI request LEDGER — latency, status, model, provider, operation, cost. It records what AI DID, never what AI is configured to do, and it is Product Health 008H's subject rather than this module's.", readable: true },
    ],
  },
  {
    key: "history", title: "Configuration History", href: "/super-admin/pd/configuration/history",
    spec: "CPR-PD-011 §22",
    purpose: "Version history, effective changes, rollback, comparison and audit.",
    settings: [
      "Timeline by key, domain, scope, market, actor and date",
      "Version comparison: previous value, new value, effective source, related change set",
      "Approval, activation, rollback and failure events",
      "Historical effective-value reconstruction for material settings",
      "Links to related incident, risk, release or governance decision",
    ],
    constraints: [
      "Rollback is a new auditable change, not a deletion of history (§21).",
      "Never silently mutate a historical configuration record (§26).",
      "Sensitive values may be redacted in general audit views while the evidence is preserved.",
    ],
    stores: [
      { table: "workspace_config_audit", migration: "076:51", holds: "set / reset / publish / rollback, with old_value AND new_value, scope and actor.", readable: true },
      { table: "workspace_config_versions", migration: "076:35", holds: "published snapshots — the material §22's historical reconstruction needs.", readable: true },
      { table: "configuration_registry_audit", migration: "092:47", holds: "definition changes: created / updated / synced / published / deprecated / retired.", readable: true },
      { table: "configuration_release_events", migration: "099:31", holds: "change-set transitions with actor.", readable: true },
      { table: "practice_identifier_format_history", migration: "220:63", holds: "every version of the practitioner-number shape, with the reason it changed.", readable: true },
      { table: "practice_audit_event", migration: "191:219", cite: "written from src/lib/practice/configuration.ts:241", holds: "⚠ where a Practice's OWN configuration changes are audited. Deliberately absent from the platform-plane allowlist: its payloads carry clinical detail.", readable: false },
    ],
  },
];

export const domain = (key: string): ConfigDomain | null => DOMAINS.find(d => d.key === key) ?? null;

/** The §16 lifecycle, and what in this schema can represent each state. Authored — see the LADDER note. */
export const LIFECYCLE: { state: string; meaning: string; represented: string | null }[] = [
  { state: "DRAFT", meaning: "Proposed value or change, not active.", represented: "configuration_releases.status 'draft'; workspace_config_overrides.draft with published null" },
  { state: "VALIDATING", meaning: "Automated or required validation underway.", represented: "configuration_releases.validation jsonb holds the LAST result; there is no in-flight state, so validation is a completed fact, never an observable phase" },
  { state: "PENDING APPROVAL", meaning: "Required approvers have not completed a decision.", represented: null },
  { state: "SCHEDULED", meaning: "Approved for a future effective time.", represented: "configuration_releases.status 'scheduled' with scheduled_for" },
  { state: "ACTIVE", meaning: "Current authoritative value for its scope.", represented: "configuration_releases.status 'activated'; an override row with a published value" },
  { state: "FAILED", meaning: "Activation failed; the previous safe state remains where possible.", represented: "configuration_releases.status 'failed'" },
  { state: "SUPERSEDED", meaning: "Replaced by a newer active version.", represented: "implied by workspace_config_versions ordering; no status records it" },
  { state: "ROLLED BACK", meaning: "Explicitly reverted to a prior approved state.", represented: "configuration_releases.status 'rolled_back'; workspace_config_versions.status 'rolled_back'" },
  { state: "EXPIRED", meaning: "A temporary override ended and inheritance resumed.", represented: null },
];

const CRITICAL_SAFETY = [
  "clinical_safety_critical", "security_critical", "regulatory_critical", "financial_control_critical",
];

/** ⚠ A HEURISTIC, DECLARED WHEREVER ITS RESULT IS SHOWN. See cfg.definitions_practice in the registry. */
const namesPractice = (o: any) => /practice/i.test(String(o?.object_key ?? "")) || /practice/i.test(String(o?.route ?? ""));

// ── OVERVIEW PAYLOAD ─────────────────────────────────────────────────────────────────────────────────

export type Attention = {
  label: string;
  detail: string;
  tone: "critical" | "warning" | "neutral";
  /** ⚠ Where the claim can be checked. Disclosure body only — never the visible detail line. */
  cite?: string;
};

/**
 * ⚠ THREE STATES, AND CONFLATING THE LAST TWO IS THE FAILURE THIS TYPE EXISTS TO PREVENT.
 *
 *   value    a measurement.
 *   unknown  the read did not complete. NOT zero, and the sentence says which read.
 *   absent   the metric registry refuses this figure. The sentence names the fact that is missing.
 *
 * Ported from pd-mission.ts:170-215, deliberately unchanged, so two Product Director surfaces cannot
 * express the same three states in two different shapes.
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
 * would mean every new view is a fresh chance to forget.
 */
function figure(metricId: string, compute: () => number | null, unreadable: string): Figure {
  if (!mayRender(metricId)) return { state: "absent", why: absenceSentence(metricId) };
  const v = compute();
  return v === null ? { state: "unknown", why: unreadable } : { state: "value", value: v };
}

export type PdConfiguration = {
  registry: {
    /** The table exists and answered. False means the figures below are unknown, NOT zero. */
    read: boolean;
    /** Counted by the database, independently of the composed read — the control on "empty vs unreadable". */
    rowCount: number | null;
    definitions: Figure;
    practiceDefinitions: Figure;
    highRisk: Figure;
    platformEnforced: Figure;
    active: number | null;
    draft: number | null;
    /** Null when the registry refuses cfg.governance_quality or the read failed; `why` says which. */
    governance: { missingOwners: number; unresolvedDeps: number; orphaned: number } | null;
    governanceWhy: string;
    byType: { type: string; n: number }[];
    bySafety: { key: string; n: number }[];
  };
  overrides: {
    read: boolean;
    total: number | null;
    published: Figure;
    draftsUnpublished: number | null;
    byScope: { scope: string; n: number }[];
  };
  changeSets: {
    read: boolean;
    total: number | null;
    byStatus: { status: string; n: number }[];
    pending: Figure;
    scheduled: Figure;
    failed: Figure;
    rolledBack: number | null;
    rows: { key: string; name: string; channel: string; rollout: string; status: string; objects: number; scheduledFor: string | null; at: string }[];
  };
  ladder: LadderRung[];
  attention: Attention[];
  /** Figures PD-011 asks for that this build refuses to draw, each with the registry's own sentence. */
  refusals: { label: string; why: string }[];
  /** Every read that did not complete, in the reader's words. Never swallowed, never rendered as zero. */
  problems: string[];
  generatedAt: string;
};

/**
 * ⚠ WHY A SEPARATE ROW COUNT SITS BESIDE loadRegistry's TOTALS.
 *
 * loadRegistry returns `provisioned: false` only when the error text matches "does not exist"; on ANY
 * OTHER error it returns `objects: []` with `provisioned: true`, so a failed read is indistinguishable
 * from an empty registry — and "0 configuration definitions" is the single most misleading thing this
 * page could say. The independent count is the control: it is read with its error surfaced, and when
 * the two disagree the screen reports a read failure rather than a number.
 */
async function countRows(admin: Admin, table: string, problems: string[]): Promise<number | null> {
  // ⚠ NOT `head: true`. A head-only count returns no error for a table that does not exist and reports
  // it present — a wrong "absent" verdict this codebase has already paid for once (operations.ts:133).
  const { count, error } = await admin.from(table).select("id", { count: "exact" }).limit(1);
  if (error) { problems.push(`${table}: ${error.message}`); return null; }
  return count ?? null;
}

export async function loadPdConfiguration(admin: Admin): Promise<PdConfiguration> {
  const problems: string[] = [];

  const [reg, regCount, ovr, ovrCount, relRes] = await Promise.all([
    loadRegistry(admin),
    countRows(admin, "configuration_registry_objects", problems),
    loadConfigOverrides(admin),
    countRows(admin, "workspace_config_overrides", problems),
    admin.from("configuration_releases")
      .select("release_key, name, channel, rollout, status, scheduled_for, activated_at, objects, created_at")
      .order("created_at", { ascending: false }).limit(200),
  ]);

  // ── Registry ────────────────────────────────────────────────────────────────────────────────────
  const regObjects: any[] = reg.provisioned ? (reg.objects as any[]) : [];
  // The composed read returned nothing while the database says there are rows: that is a failed read.
  const registryLied = reg.provisioned && regObjects.length === 0 && (regCount ?? 0) > 0;
  if (registryLied) {
    problems.push(
      "configuration_registry_objects: the catalogue read returned no rows while the database counts "
      + `${regCount}. The figures on this page are suppressed rather than shown as zero.`,
    );
  }
  const regRead = reg.provisioned && regCount !== null && !registryLied;
  if (!reg.provisioned) problems.push("configuration_registry_objects: the table is not present (migration 092 has not been applied here).");

  const bySafetyMap = new Map<string, number>();
  for (const o of regObjects) bySafetyMap.set(o.safety_classification, (bySafetyMap.get(o.safety_classification) ?? 0) + 1);

  const REG_UNREADABLE =
    "The configuration registry could not be read. That is not an empty registry and it is not zero "
    + "definitions — see the read failures at the foot of this page.";

  const practiceObjects = regRead ? regObjects.filter(namesPractice).length : null;
  const registry = {
    read: regRead,
    rowCount: regCount,
    definitions: figure("cfg.definitions", () => (regRead && reg.provisioned ? reg.stats.total : null), REG_UNREADABLE),
    practiceDefinitions: figure("cfg.definitions_practice", () => practiceObjects, REG_UNREADABLE),
    highRisk: figure(
      "cfg.high_risk",
      () => (regRead ? regObjects.filter(o => CRITICAL_SAFETY.includes(o.safety_classification)).length : null),
      REG_UNREADABLE,
    ),
    platformEnforced: figure(
      "cfg.platform_enforced",
      () => (regRead ? regObjects.filter(o => o.override_policy === "none" || o.configurability_class === "mandatory_locked").length : null),
      REG_UNREADABLE,
    ),
    active: regRead && reg.provisioned ? reg.stats.active : null,
    draft: regRead && reg.provisioned ? reg.stats.draft : null,
    governance: mayRender("cfg.governance_quality") && regRead && reg.provisioned
      ? { missingOwners: reg.stats.missingOwners, unresolvedDeps: reg.stats.unresolvedDeps, orphaned: reg.stats.orphaned }
      : null,
    governanceWhy: mayRender("cfg.governance_quality") ? REG_UNREADABLE : absenceSentence("cfg.governance_quality"),
    byType: regRead && reg.provisioned ? reg.stats.byType.slice(0, 10) : [],
    bySafety: regRead ? [...bySafetyMap.entries()].map(([key, n]) => ({ key, n })).sort((a, b) => b.n - a.n) : [],
  };

  // ── Overrides ───────────────────────────────────────────────────────────────────────────────────
  if (!ovr.provisioned) problems.push("workspace_config_overrides: the override store could not be read (the table may not be present here).");
  const ovrRead = ovr.provisioned && ovrCount !== null;
  const scopeMap = new Map<string, number>();
  for (const r of ovr.rows) scopeMap.set(r.scope_type, (scopeMap.get(r.scope_type) ?? 0) + 1);
  const OVR_UNREADABLE =
    "The override store could not be read. That is not \"no setting has been overridden\".";
  const overrides = {
    read: ovrRead,
    total: ovrRead ? ovr.rows.length : null,
    published: figure("cfg.overrides_published", () => (ovrRead ? ovr.rows.filter(r => r.published != null).length : null), OVR_UNREADABLE),
    draftsUnpublished: ovrRead ? ovr.rows.filter(r => r.published == null).length : null,
    byScope: ovrRead
      ? Object.keys(SCOPE_ORDER).map(scope => ({ scope, n: scopeMap.get(scope) ?? 0 }))
      : [],
  };

  // ── Change sets ─────────────────────────────────────────────────────────────────────────────────
  if (relRes.error) problems.push(`configuration_releases: ${relRes.error.message}`);
  const rels = (relRes.error ? [] : (relRes.data ?? [])) as any[];
  const relRead = !relRes.error;
  const statusMap = new Map<string, number>();
  for (const r of rels) statusMap.set(r.status, (statusMap.get(r.status) ?? 0) + 1);
  const n = (s: string) => statusMap.get(s) ?? 0;
  const REL_UNREADABLE =
    "The change-set store could not be read. That is not \"nothing is pending\".";
  const changeSets = {
    read: relRead,
    total: relRead ? rels.length : null,
    byStatus: relRead ? [...statusMap.entries()].map(([status, count]) => ({ status, n: count })).sort((a, b) => b.n - a.n) : [],
    // ⚠ Unpublished override drafts count as pending too — the metric definition says so — but they are
    // added only when BOTH stores answered, because a sum with one unreadable half is not a total.
    pending: figure(
      "cfg.pending_changes",
      () => (relRead && ovrRead
        ? n("draft") + n("validated") + n("approved") + n("scheduled") + ovr.rows.filter(r => r.published == null).length
        : null),
      "One of the two stores that hold a pending change could not be read, so this cannot be totalled.",
    ),
    scheduled: figure("cfg.scheduled_changes", () => (relRead ? n("scheduled") : null), REL_UNREADABLE),
    failed: figure("cfg.failed_activation", () => (relRead ? n("failed") : null), REL_UNREADABLE),
    rolledBack: relRead ? n("rolled_back") : null,
    rows: rels.slice(0, 12).map(r => ({
      key: r.release_key, name: r.name, channel: r.channel, rollout: r.rollout, status: r.status,
      objects: Array.isArray(r.objects) ? r.objects.length : 0,
      scheduledFor: r.scheduled_for ?? null, at: r.created_at,
    })),
  };

  // ── Needs attention (§6) ────────────────────────────────────────────────────────────────────────
  //
  // ⚠ EVERY ITEM IS A MEASURED EXCEPTION OR IT IS NOT HERE. §6's list also names unauthorized drift and
  // expired temporary overrides; both are `absent` in the registry, so neither can appear — and their
  // absence is stated under `refusals` instead of quietly leaving the panel looking clean.
  const attention: Attention[] = [];
  const at = (f: Figure) => (f.state === "value" ? f.value : null);

  if (at(registry.practiceDefinitions) === 0) {
    const total = at(registry.definitions);
    attention.push({
      tone: "critical",
      label: "No Competen Practice setting is a configuration definition",
      detail:
        `${total === null ? "The" : total.toLocaleString()} definitions are registered and none of them `
        + "names Competen Practice. The registry is seeded from the in-code workspace catalogue, which "
        + "describes the estate's workspaces — Unit Manager, Shift Supervisor, the Personal Workspace. "
        + "Until a Practice setting is registered there is nothing here to classify, nothing to approve "
        + "and nothing to resolve, whatever else this page can count.",
      cite: "The catalogue the registry is seeded from is WORKSPACE_CATALOG, at src/lib/config/registry.ts:77.",
    });
  }
  if ((at(changeSets.failed) ?? 0) > 0) {
    attention.push({
      tone: "critical", label: `${at(changeSets.failed)} change set(s) failed to activate`,
      detail: "PD-011 §28: a failed activation must leave a legible safe state. Open the change set to see which objects it carried.",
    });
  }
  if (registry.governance) {
    if (registry.governance.unresolvedDeps > 0) attention.push({
      tone: "warning", label: `${registry.governance.unresolvedDeps} definition(s) depend on a key that does not exist`,
      detail: "§19: configuration references must point to valid canonical entities. A dependency naming a missing object cannot be validated at activation.",
    });
    if (registry.governance.orphaned > 0) attention.push({
      tone: "warning", label: `${registry.governance.orphaned} definition(s) are parented to a key that does not exist`,
      detail: "The object's place in the hierarchy cannot be resolved, so neither can the scopes it would inherit from.",
    });
    if (registry.governance.missingOwners > 0) attention.push({
      tone: "warning", label: `${registry.governance.missingOwners} definition(s) have no owner`,
      detail: "§4 requires a product or domain owner on every configuration definition. Without one, no approval route can be resolved for a change to it.",
    });
  }
  if ((at(changeSets.scheduled) ?? 0) > 0) {
    attention.push({
      tone: "neutral", label: `${at(changeSets.scheduled)} change set(s) are scheduled`,
      detail: "Approved for a future effective time (§16 SCHEDULED). Nothing on this page activates them; the release engine does.",
    });
  }

  // ── The refusals, taken straight from the registry so no screen invents its own wording ─────────
  const refusals = [
    "cfg.drift", "cfg.expired_overrides", "cfg.approvals_outstanding",
    "cfg.markets_configured", "cfg.affected_practices",
  ]
    .filter(id => !mayRender(id))
    .map(id => ({ label: LABELS[id] ?? id, why: absenceSentence(id) }));

  return {
    registry, overrides, changeSets,
    ladder: LADDER, attention, refusals, problems,
    generatedAt: new Date().toISOString(),
  };
}

/** Display names for the refused metrics. The registry holds the definitions; this holds the headings. */
const LABELS: Record<string, string> = {
  "cfg.drift": "Configuration drift",
  "cfg.expired_overrides": "Expired temporary overrides",
  "cfg.approvals_outstanding": "Changes awaiting approval",
  "cfg.markets_configured": "Markets configured",
  "cfg.affected_practices": "Practices a change would affect",
  "cfg.practice_domain_settings": "Practice domain configuration",
};

export const refusalFor = (metricId: string) => ({
  label: LABELS[metricId] ?? metricId,
  why: absenceSentence(metricId),
});

// ── PRACTICE DEFAULTS (§7) ───────────────────────────────────────────────────────────────────────────

export type PracticeDefaults = {
  /** The practitioner-number shape. The one Practice product default this plane may read in full. */
  format: IdentifierFormat;
  /**
   * ⚠ getFormat FALLS BACK TO THE BUILT-IN DEFAULT ON A FAILED READ (identifier-format.ts:115-120). So
   * `format` alone cannot say whether it was measured. This count is the control: null means the read
   * failed, 0 means the table is empty and the shape shown is code, not configuration.
   */
  formatRows: number | null;
  history: { version: number; prefix: string; digits: number; checkDigit: boolean; separator: string; reason: string | null; at: string | null }[];
  historyRead: boolean;
  onboardingSteps: number | null;
  plans: number | null;
  problems: string[];
  generatedAt: string;
};

export async function loadPracticeDefaults(admin: Admin): Promise<PracticeDefaults> {
  const problems: string[] = [];
  const [format, fmtCountRes, hist, stepsRes, plansRes] = await Promise.all([
    getFormat(admin),
    admin.from("practice_identifier_format").select("key", { count: "exact", head: true }),
    formatHistory(admin),
    admin.from("practice_onboarding_step_catalog").select("id", { count: "exact", head: true }),
    admin.from("practice_plans").select("id", { count: "exact", head: true }),
  ]);
  if (fmtCountRes.error) problems.push(`practice_identifier_format: ${fmtCountRes.error.message}`);
  if (stepsRes.error) problems.push(`practice_onboarding_step_catalog: ${stepsRes.error.message}`);
  if (plansRes.error) problems.push(`practice_plans: ${plansRes.error.message}`);

  const rows = (hist ?? []) as any[];
  return {
    format,
    formatRows: fmtCountRes.error ? null : (fmtCountRes.count ?? null),
    history: rows.map(r => ({
      version: r.version, prefix: r.prefix, digits: r.digits, checkDigit: r.check_digit,
      separator: r.separator, reason: r.change_reason ?? null, at: r.created_at ?? null,
    })),
    // formatHistory swallows its error (identifier-format.ts:217), so an empty array is two facts. The
    // format row count above is what tells them apart at the level this page can reach.
    historyRead: Array.isArray(hist),
    onboardingSteps: stepsRes.error ? null : (stepsRes.count ?? null),
    plans: plansRes.error ? null : (plansRes.count ?? null),
    problems,
    generatedAt: new Date().toISOString(),
  };
}

// ── MARKET & LOCALIZATION (§14) ──────────────────────────────────────────────────────────────────────

export type ConfigMarkets = {
  /** Distinct countries across the estate. A property of the practices, NOT a configured layer. */
  markets: string[];
  truncated: boolean;
  estateTotal: number | null;
  /** Timezones seen on the most recent page of practices — a sample, and labelled as one. */
  timezonesOnPage: string[];
  pageSize: number;
  problems: string[];
  generatedAt: string;
};

/**
 * ⚠ COMPOSED FROM loadPracticeEstate, NOT READ AGAIN. The Practices register already derives the market
 * filter options from the same column; a second reader would eventually print a different market list
 * from the same database, and there would be no way to tell which was wrong.
 */
export async function loadConfigMarkets(admin: Admin): Promise<ConfigMarkets> {
  const estate = await loadPracticeEstate(admin, {});
  return {
    markets: estate.markets,
    truncated: estate.marketsTruncated,
    estateTotal: estate.estateTotal,
    timezonesOnPage: [...new Set(estate.rows.map(r => r.timezone).filter(Boolean))].sort(),
    pageSize: estate.rows.length,
    problems: estate.problems,
    generatedAt: estate.generatedAt,
  };
}

// ── CONFIGURATION HISTORY (§22) ──────────────────────────────────────────────────────────────────────

export type HistoryEvent = {
  at: string;
  /** Which trail this came from — the three do not cover the same subject. */
  trail: "value" | "definition" | "change set" | "identifier format";
  action: string;
  subject: string;
  scope: string | null;
  actor: string | null;
  detail: string | null;
};

export type ConfigHistory = {
  events: HistoryEvent[];
  versions: { label: string | null; note: string | null; status: string; scope: string; by: string | null; at: string; entries: number }[];
  /** Per trail: whether it answered, so an empty timeline is never mistaken for a quiet estate. */
  trails: { name: string; table: string; read: boolean; rows: number | null }[];
  problems: string[];
  generatedAt: string;
};

const scopeLabel = (t: string | null, r: string | null) =>
  !t ? null : r ? `${t} · ${r}` : t;

const jsonBrief = (v: any): string | null => {
  if (v === null || v === undefined) return null;
  try {
    const s = typeof v === "string" ? v : JSON.stringify(v);
    return s.length > 120 ? `${s.slice(0, 117)}…` : s;
  } catch { return null; }
};

export async function loadConfigHistory(admin: Admin): Promise<ConfigHistory> {
  const problems: string[] = [];
  const [valRes, defRes, relRes, verRes, fmtHist] = await Promise.all([
    admin.from("workspace_config_audit")
      .select("action, scope_type, scope_ref, config_path, actor_name, old_value, new_value, created_at")
      .order("created_at", { ascending: false }).limit(40),
    admin.from("configuration_registry_audit")
      .select("object_key, action, actor_name, change_reason, created_at")
      .order("created_at", { ascending: false }).limit(40),
    admin.from("configuration_release_events")
      .select("release_key, event, actor_name, created_at")
      .order("created_at", { ascending: false }).limit(40),
    admin.from("workspace_config_versions")
      .select("label, note, status, scope_type, scope_ref, published_by_name, snapshot, created_at")
      .order("created_at", { ascending: false }).limit(15),
    formatHistory(admin),
  ]);

  for (const [name, res] of [
    ["workspace_config_audit", valRes], ["configuration_registry_audit", defRes],
    ["configuration_release_events", relRes], ["workspace_config_versions", verRes],
  ] as const) if (res.error) problems.push(`${name}: ${res.error.message}`);

  const val = (valRes.error ? [] : valRes.data ?? []) as any[];
  const def = (defRes.error ? [] : defRes.data ?? []) as any[];
  const rel = (relRes.error ? [] : relRes.data ?? []) as any[];
  const ver = (verRes.error ? [] : verRes.data ?? []) as any[];
  const fmt = (fmtHist ?? []) as any[];

  const events: HistoryEvent[] = [
    ...val.map(r => ({
      at: r.created_at, trail: "value" as const, action: r.action, subject: r.config_path ?? "(no path)",
      scope: scopeLabel(r.scope_type, r.scope_ref), actor: r.actor_name ?? null,
      detail: [jsonBrief(r.old_value) && `was ${jsonBrief(r.old_value)}`, jsonBrief(r.new_value) && `now ${jsonBrief(r.new_value)}`]
        .filter(Boolean).join(" · ") || null,
    })),
    ...def.map(r => ({
      at: r.created_at, trail: "definition" as const, action: r.action, subject: r.object_key ?? "(whole registry)",
      scope: null, actor: r.actor_name ?? null, detail: r.change_reason ?? null,
    })),
    ...rel.map(r => ({
      at: r.created_at, trail: "change set" as const, action: r.event, subject: r.release_key,
      scope: null, actor: r.actor_name ?? null, detail: null,
    })),
    ...fmt.map(r => ({
      at: r.created_at, trail: "identifier format" as const, action: `version ${r.version}`,
      subject: "practitioner number", scope: null, actor: null, detail: r.change_reason ?? null,
    })),
  ]
    .filter(e => !!e.at)
    .sort((a, b) => String(b.at).localeCompare(String(a.at)))
    .slice(0, 40);

  return {
    events,
    versions: ver.map(v => ({
      label: v.label ?? null, note: v.note ?? null, status: v.status,
      scope: scopeLabel(v.scope_type, v.scope_ref) ?? "platform",
      by: v.published_by_name ?? null, at: v.created_at,
      entries: Array.isArray(v.snapshot) ? v.snapshot.length : 0,
    })),
    trails: [
      { name: "Value changes", table: "workspace_config_audit", read: !valRes.error, rows: valRes.error ? null : val.length },
      { name: "Definition changes", table: "configuration_registry_audit", read: !defRes.error, rows: defRes.error ? null : def.length },
      { name: "Change-set transitions", table: "configuration_release_events", read: !relRes.error, rows: relRes.error ? null : rel.length },
      { name: "Published snapshots", table: "workspace_config_versions", read: !verRes.error, rows: verRes.error ? null : ver.length },
      { name: "Practitioner-number shape", table: "practice_identifier_format_history", read: Array.isArray(fmtHist), rows: Array.isArray(fmtHist) ? fmt.length : null },
    ],
    problems,
    generatedAt: new Date().toISOString(),
  };
}
