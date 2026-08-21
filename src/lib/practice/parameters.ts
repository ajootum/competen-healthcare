import { practiceDayOf, practiceToday } from "@/lib/practice/practice-time";
import { audit } from "@/lib/practice/audit";
import { hasCapability, type WorkspaceContext } from "@/lib/practice/access";
import { type EngineResult } from "@/lib/practice/encounters";
import { calculatorByKey } from "@/lib/practice/clinical-calculators";
import {
  CAP_VIEW, CAP_RECORD, CAP_CONFIGURE, CAP_PACK_INSTALL,
  ACTIVATION_SCOPES_BY_PRECEDENCE, SCOPE_SENTINEL, SCHEDULE_INTERVAL_DAYS,
  STATES_OUT_OF_ROUTINE_VIEW, PLAN_STATE_CODES, PLAN_SCHEDULE_CODES, COLLECTION_RULE_CODES,
  PARAMETER_CATEGORY_CODES, PARAMETER_DATA_TYPE_CODES, RISK_CLASS_CODES, MEASUREMENT_SOURCE_CODES,
  TRIGGER_SOURCE_CODES, PLAN_STATE_MEANING, PLAN_SCHEDULE_LABEL, ALERT_SEVERITY_LABEL,
  UNCLASSIFIED_SEVERITY_LABEL,
  thresholdLine, plausibilityLine, dueLine, valueLine, trendLine,
  type ThresholdVerdict, type DueVerdict, type ValueVerdict, type TrendVerdict, type PlausibilityVerdict,
  type ActivationScope,
} from "@/lib/practice/parameters-constants";

// CPR-LCP-001: the configurable longitudinal clinical-parameter and patient-monitoring engine, on
// migration 246.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// WHAT THIS FILE IS. LCP s10 names exactly three surfaces and this engine feeds those three:
//
//   s10.1 Practice Setup       parameterLibrary()      -- browse, activate, install, clone, defaults
//   s10.2 Patient Workspace    monitoringPlan()        -- per-patient add/remove, frequency, thresholds
//   s10.3 Encounter Workspace  encounterParameters()   -- collection during a visit, one-off additions
//
// It is not a navigation section. LCP-001 contains no navigation section; s10.1's page lives under
// Practice Setup and the other two are panels inside workspaces that already exist.
//
// ---- FIVE THINGS THAT ARE STRUCTURAL HERE AND ARE NOT NEGOTIABLE ------------------------------------
//
//  1. A FAILED READ IS NEVER A ZERO. Every list below is a Panel with three states: not permitted,
//     could not be read, nothing there. A parameter list that fails to load must not render as "no
//     parameters configured", because the practitioner's next action differs.
//
//  2. AN UNCHECKED THING SAYS SO. thresholdLine is the only place a threshold verdict is decided, it
//     has a `not_checked` state, and exactly one of its five states sets `reassuring: true`. A screen
//     may draw a green tick only from that flag. This is migration 238's allergy lesson in a second
//     domain: an unwarned screen reads as a cleared screen.
//
//  3. NOTHING IS EVER UPDATED IN practice_parameter_measurement OR practice_parameter_derived. Neither
//     table has an updated_at. A correction is a NEW ROW naming the one it corrects, so LCP s9's "a
//     later weight update must not recalculate or rewrite a historical prescription" holds by shape
//     rather than by every future caller remembering. The harness source-scans for an UPDATE on either
//     table and runs a control that proves the scan can see one.
//
//  4. HIDING AND SAFETY ARE TWO SEPARATE FIELDS. LCP s9: "Patient-level hiding of weight must not
//     suppress a medication-triggered safety requirement." monitoringPlan returns `routine` and
//     `safetyRequired` as two lists computed from two columns, and a hidden row with safety_required
//     true is in the second and not the first.
//
//  5. NO PERCENTILES. See NO_PERCENTILE_BANDS in parameters-constants.ts. The raw series is returned
//     and nothing in this file computes, interpolates or hard-codes a centile.
//
// ---- WHAT IS REUSED RATHER THAN REBUILT -------------------------------------------------------------
//
//   clinical-calculators.ts    BMI and BSA already compute correctly there with published formulas and
//                              plausibility bounds. deriveFor() calls them; it does not do arithmetic.
//   provisioning.audit         every configuration write goes through the practice's own audit trail.
//   practice_follow_up         NOT touched. Due-parameter reminders would EMIT into that rail; this
//                              build computes due-ness and does not schedule anything, and says so.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

/* eslint-disable @typescript-eslint/no-explicit-any */

// ── THE THREE-STATE PANEL, the shape longitudinal.ts established ─────────────────────────────────────

export type Panel<T> = { items: T[]; permitted: boolean; unavailable: boolean; detail: string | null };

const denied = <T>(): Panel<T> => ({ items: [], permitted: false, unavailable: false, detail: null });
const failed = <T>(detail: string): Panel<T> => ({ items: [], permitted: true, unavailable: true, detail });
const loaded = <T>(items: T[]): Panel<T> => ({ items, permitted: true, unavailable: false, detail: null });

const fail = (status: number, code: string, message: string): EngineResult<never> =>
  ({ ok: false, status, code, message });

const trim = (v: unknown): string => String(v ?? "").trim();

// ────────────────────────────────────────────────────────────────────────────────────────────────────
// LCP s5 -- THE CORE PARAMETER GROUPS, AS PLATFORM DEFINITIONS
//
// s3: "Minimal by default: only core anthropometrics and vital signs are initially available for
// AVAILABLE FOR ACTIVATION, which is not the same as activated. These ship as PLATFORM rows
// (workspace_id IS NULL, migration 246 s1) so that a correction to the definition of blood pressure
// reaches every practice rather than only the ones provisioned after it. Nothing here is switched on
// for anybody: a practice activates what it wants on the Clinical Parameters page.
//
// ⚠ THIS IS LCP s5's LIST, NOT CPL-001's CATALOGUE. s5.1's seven anthropometrics, s5.2's two computable
// derived values, and s5.3's six vital signs. CPL-001's ~450 candidate parameters across 34 specialty
// groupings are a separate pass -- see PARAMETER_REFUSALS.specialty_pack_catalogue.
//
// ⚠ AND s5.3's OWN EXCLUSION IS HONOURED: "Additional observations such as AVPU, Glasgow Coma Scale,
// capillary refill or glucose are not enabled as universal defaults." None of the four is here.
//
// ⚠ BLOOD PRESSURE IS TWO DEFINITIONS AND THAT IS NOT A LIBERTY. s5.3 names "Blood pressure" once; the
// measurement table has ONE value_numeric column. A text "112/70" could not be ordered, charted, or
// compared against a threshold, and a chart over text that happens to look like numbers is how a
// transposed digit becomes a trend (migration 246 s8). So systolic and diastolic are two series and the
// screens render them side by side, which is what the design overview draws.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

type CoreDefinition = {
  code: string; display_name: string; short_name?: string; synonyms?: string[];
  category: string; data_type: string;
  canonical_unit?: string; permitted_units?: string[]; unit_conversions?: Record<string, number>;
  value_precision?: number; min_plausible?: number; max_plausible?: number;
  default_collection_rule?: string; formula?: string; applicability?: Record<string, unknown>;
  options?: { value: string; label: string; score?: number }[];
};

export const CORE_LIBRARY: CoreDefinition[] = [
  // ── s5.1 Anthropometrics ──────────────────────────────────────────────────────────────────────────
  {
    code: "weight", display_name: "Weight", short_name: "Wt", synonyms: ["body weight", "mass"],
    category: "anthropometric", data_type: "decimal",
    canonical_unit: "kg", permitted_units: ["kg", "g", "lb"],
    // Multiply by this to reach the canonical unit. Data, not code: migration 246 s1's reason is that a
    // conversion table in TypeScript and one in SQL would eventually disagree and the disagreement
    // would be a wrong dose.
    unit_conversions: { kg: 1, g: 0.001, lb: 0.45359237 },
    value_precision: 2, min_plausible: 0.3, max_plausible: 400,
    default_collection_rule: "every_visit",
  },
  {
    code: "standing_height", display_name: "Standing height", short_name: "Ht",
    synonyms: ["height", "stature"], category: "anthropometric", data_type: "decimal",
    canonical_unit: "cm", permitted_units: ["cm", "m", "in"],
    unit_conversions: { cm: 1, m: 100, in: 2.54 },
    value_precision: 1, min_plausible: 20, max_plausible: 260,
    default_collection_rule: "every_visit",
  },
  {
    code: "recumbent_length", display_name: "Recumbent length", short_name: "Length",
    synonyms: ["length", "supine length"], category: "anthropometric", data_type: "decimal",
    canonical_unit: "cm", permitted_units: ["cm", "m", "in"],
    unit_conversions: { cm: 1, m: 100, in: 2.54 },
    value_precision: 1, min_plausible: 20, max_plausible: 140,
    // s6 Applicability: "Age, sex, pregnancy, diagnosis, medication, clinic or other conditions."
    // Recumbent length is measured instead of standing height in children who cannot stand.
    applicability: { age_max_months: 24 },
    default_collection_rule: "on_request",
  },
  {
    code: "head_circumference", display_name: "Head circumference", short_name: "OFC",
    synonyms: ["OFC", "occipitofrontal circumference"], category: "anthropometric", data_type: "decimal",
    canonical_unit: "cm", permitted_units: ["cm", "in"], unit_conversions: { cm: 1, in: 2.54 },
    value_precision: 1, min_plausible: 20, max_plausible: 70,
    applicability: { age_max_months: 60 },
    default_collection_rule: "scheduled",
  },
  {
    code: "muac", display_name: "Mid-upper arm circumference", short_name: "MUAC",
    synonyms: ["MUAC", "mid upper arm circumference"], category: "anthropometric", data_type: "decimal",
    canonical_unit: "cm", permitted_units: ["cm", "mm"], unit_conversions: { cm: 1, mm: 0.1 },
    value_precision: 1, min_plausible: 5, max_plausible: 60,
    default_collection_rule: "on_request",
  },
  {
    code: "waist_circumference", display_name: "Waist circumference", short_name: "Waist",
    category: "anthropometric", data_type: "decimal",
    canonical_unit: "cm", permitted_units: ["cm", "in"], unit_conversions: { cm: 1, in: 2.54 },
    value_precision: 1, min_plausible: 20, max_plausible: 250,
    default_collection_rule: "on_request",
  },
  {
    code: "hip_circumference", display_name: "Hip circumference", short_name: "Hip",
    category: "anthropometric", data_type: "decimal",
    canonical_unit: "cm", permitted_units: ["cm", "in"], unit_conversions: { cm: 1, in: 2.54 },
    value_precision: 1, min_plausible: 20, max_plausible: 250,
    default_collection_rule: "on_request",
  },

  // ── s5.2 Derived anthropometric values ────────────────────────────────────────────────────────────
  //
  // ⚠ ONLY THE TWO THAT ARE COMPUTABLE. s5.2 also lists "Growth percentiles and z-scores" and
  // "Weight-for-age, height-for-age, weight-for-height and BMI-for-age"; every one of those needs a
  // named LMS reference population and neither specification supplies one. They are NOT here, and
  // NO_PERCENTILE_BANDS says so on the screen rather than the screen simply lacking a chart.
  //
  // "Weight change and percentage change" is not a definition either -- it is an arithmetic over the
  // weight series, and it is returned by parameterSeries as a change, computed at read time.
  {
    code: "bmi", display_name: "Body mass index", short_name: "BMI",
    category: "calculated", data_type: "calculated",
    canonical_unit: "kg/m2", permitted_units: ["kg/m2"], unit_conversions: { "kg/m2": 1 },
    value_precision: 1, min_plausible: 5, max_plausible: 100,
    // The formula named in clinical-calculators.ts, which is what actually computes it.
    formula: "weight (kg) / height (m)^2",
    default_collection_rule: "on_request",
  },
  {
    code: "bsa", display_name: "Body surface area", short_name: "BSA",
    category: "calculated", data_type: "calculated",
    canonical_unit: "m2", permitted_units: ["m2"], unit_conversions: { m2: 1 },
    value_precision: 2, min_plausible: 0.05, max_plausible: 4,
    formula: "sqrt(height (cm) * weight (kg) / 3600)",
    default_collection_rule: "on_request",
  },

  // ── s5.3 Vital signs ──────────────────────────────────────────────────────────────────────────────
  {
    code: "temperature", display_name: "Temperature", short_name: "Temp",
    category: "vital_sign", data_type: "decimal",
    canonical_unit: "C", permitted_units: ["C", "F"],
    // Fahrenheit is an OFFSET conversion, not a multiplier, and unit_conversions holds multipliers
    // only. Rather than encode a wrong number, F is offered and converted by the named special case in
    // toCanonical() -- which is the one place in this file that knows about it.
    unit_conversions: { C: 1 },
    value_precision: 1, min_plausible: 25, max_plausible: 45,
    default_collection_rule: "every_visit",
  },
  {
    code: "heart_rate", display_name: "Heart rate", short_name: "HR", synonyms: ["pulse"],
    category: "vital_sign", data_type: "integer",
    canonical_unit: "bpm", permitted_units: ["bpm"], unit_conversions: { bpm: 1 },
    value_precision: 0, min_plausible: 20, max_plausible: 300,
    default_collection_rule: "every_visit",
  },
  {
    code: "respiratory_rate", display_name: "Respiratory rate", short_name: "RR",
    category: "vital_sign", data_type: "integer",
    canonical_unit: "/min", permitted_units: ["/min"], unit_conversions: { "/min": 1 },
    value_precision: 0, min_plausible: 4, max_plausible: 120,
    default_collection_rule: "every_visit",
  },
  {
    code: "blood_pressure_systolic", display_name: "Blood pressure (systolic)", short_name: "SBP",
    synonyms: ["blood pressure", "BP systolic"], category: "vital_sign", data_type: "integer",
    canonical_unit: "mmHg", permitted_units: ["mmHg"], unit_conversions: { mmHg: 1 },
    value_precision: 0, min_plausible: 40, max_plausible: 300,
    default_collection_rule: "every_visit",
  },
  {
    code: "blood_pressure_diastolic", display_name: "Blood pressure (diastolic)", short_name: "DBP",
    synonyms: ["blood pressure", "BP diastolic"], category: "vital_sign", data_type: "integer",
    canonical_unit: "mmHg", permitted_units: ["mmHg"], unit_conversions: { mmHg: 1 },
    value_precision: 0, min_plausible: 10, max_plausible: 200,
    default_collection_rule: "every_visit",
  },
  {
    code: "oxygen_saturation", display_name: "Oxygen saturation", short_name: "SpO2",
    synonyms: ["SpO2", "sats"], category: "vital_sign", data_type: "integer",
    canonical_unit: "%", permitted_units: ["%"], unit_conversions: { "%": 1 },
    value_precision: 0, min_plausible: 40, max_plausible: 100,
    default_collection_rule: "every_visit",
  },
  {
    code: "pain_score", display_name: "Pain score", short_name: "Pain",
    category: "vital_sign", data_type: "integer",
    canonical_unit: "0-10", permitted_units: ["0-10"], unit_conversions: { "0-10": 1 },
    value_precision: 0, min_plausible: 0, max_plausible: 10,
    default_collection_rule: "on_request",
  },
];

/** The two derived values this build can compute, and the measurements each one needs. */
const DERIVATIONS: { code: string; calculator: string; inputs: Record<string, string> }[] = [
  // calculator key -> clinical-calculators.ts; inputs map its field key to a parameter code.
  { code: "bmi", calculator: "bmi", inputs: { weight: "weight", height: "standing_height" } },
  { code: "bsa", calculator: "bsa", inputs: { weight: "weight", height: "standing_height" } },
];

/**
 * ⚠ THE PARTIAL-INDEX UPSERT TRAP, AVOIDED BY NOT UPSERTING.
 *
 * `ux_practice_param_def_platform_code` is a PARTIAL unique index (`where workspace_id is null`).
 * A partial index CANNOT be an `on conflict` target: an upsert naming it does not fire, it INSERTs a
 * duplicate, and the error a fail-soft caller discards is the only sign anything went wrong. Two silent
 * write failures in this codebase came from exactly that shape.
 *
 * So this reads what is there and inserts only what is missing -- and it NEVER DISCARDS THE INSERT
 * ERROR. A seed that half-worked and reported success is a library with holes in it.
 *
 * Idempotent, and safe to call on every page load: the read is one query and the insert is skipped
 * entirely once the library is present.
 */
export async function ensureCoreLibrary(admin: any): Promise<EngineResult<{ created: number; existing: number }>> {
  const { data, error } = await admin.from("practice_parameter_definition")
    .select("code").is("workspace_id", null);
  if (error) return fail(503, "LIBRARY_UNREADABLE", `the platform parameter library could not be read: ${error.message}`);

  const present = new Set(((data ?? []) as { code: string }[]).map(r => r.code));
  const missing = CORE_LIBRARY.filter(d => !present.has(d.code));
  if (missing.length === 0) return { ok: true, data: { created: 0, existing: present.size } };

  const rows = missing.map(d => ({
    workspace_id: null,
    code: d.code, display_name: d.display_name, short_name: d.short_name ?? null,
    synonyms: d.synonyms ?? [], category: d.category, data_type: d.data_type,
    canonical_unit: d.canonical_unit ?? null, permitted_units: d.permitted_units ?? [],
    unit_conversions: d.unit_conversions ?? {}, options: d.options ?? [],
    value_precision: d.value_precision ?? null,
    min_plausible: d.min_plausible ?? null, max_plausible: d.max_plausible ?? null,
    applicability: d.applicability ?? {},
    default_collection_rule: d.default_collection_rule ?? "on_request",
    presentation: { form: true, graph: true, table: true },
    formula: d.formula ?? null,
    risk_class: "low", licence_required: false,
    // s6 Governance: "Source, owner, version, effective date, review date and retirement status."
    source: "CPR-LCP-001 s5", owner: "Competen Practice platform", version: 1,
    effective_from: new Date().toISOString(), status: "active",
  }));

  const { data: inserted, error: insErr } = await admin.from("practice_parameter_definition")
    .insert(rows).select("id, code, version");
  // ⚠ NEVER DISCARDED. See the header.
  if (insErr) return fail(500, "LIBRARY_SEED_FAILED", `the core library could not be written: ${insErr.message}`);

  // s3 "No silent rewriting: ... parameter definitions remain versioned." Version 1 gets its snapshot
  // in the same act, so a measurement taken tomorrow can cite the definition that was in force today.
  const versionRows = ((inserted ?? []) as { id: string; code: string }[]).map(r => ({
    definition_id: r.id, version: 1,
    snapshot: rows.find(x => x.code === r.code) ?? {},
    change_note: "Seeded from CPR-LCP-001 s5 core parameter groups.",
  }));
  if (versionRows.length > 0) {
    const { error: vErr } = await admin.from("practice_parameter_definition_version").insert(versionRows);
    if (vErr) return fail(500, "LIBRARY_VERSION_FAILED", `the core library was written without versions: ${vErr.message}`);
  }

  return { ok: true, data: { created: rows.length, existing: present.size } };
}

// ────────────────────────────────────────────────────────────────────────────────────────────────────
// CPR-CPL-001 -- THE PLATFORM CATALOGUE WRITER
//
// ⚠ WHY THIS EXISTS, AND WHY ensureCoreLibrary COULD NOT BE MADE TO DO IT.
//
// Migration 246 s1 and s3 build a PLATFORM tier -- `workspace_id IS NULL`, the library every practice
// reads and none owns -- and until this function there was nothing that could write it except
// ensureCoreLibrary, which takes no argument and inserts LCP s5's sixteen core parameters. For PACKS
// there was no platform writer at all, which is why the Clinical Parameters page showed zero packs and
// said so in words.
//
// The alternative was a seeding script built out of createDefinition and createPack. It does not work:
// both write `workspace_id: ctx.workspaceId` unconditionally, so the whole CPL-001 catalogue would have
// been authored INSIDE ONE TENANT -- invisible to every other practice, un-installable by anyone else,
// and CPL s24's "platform master" would be a row belonging to whichever practice happened to run the
// script.
//
// ⚠ ensureCoreLibrary IS NOT TOUCHED AND MUST NOT BE. Its sixteen definitions are seeded and live, and
// practice-parameters-harness asserts its idempotency directly. This is a SECOND entry point beside it,
// deliberately duplicating its four safety properties rather than refactoring both into a shared
// helper -- a refactor would edit a function that is already correct and already in production, to no
// benefit, on the file another engine reads for the weight.
//
// ⚠ THE FOUR PROPERTIES IT COPIES FROM ensureCoreLibrary, EACH FOR ITS OWN REASON:
//
//   1. READ-THEN-INSERT-MISSING, AND NEVER .upsert(). `ux_practice_param_def_platform_code` and
//      `ux_practice_param_pack_platform_code` are both PARTIAL (`where workspace_id is null`). A partial
//      index CANNOT be an `on conflict` target: an upsert naming it does not fire, it INSERTs a
//      duplicate, and the error a fail-soft caller discards is the only sign anything went wrong. Two
//      silent write failures in this codebase came from exactly that shape.
//
//   2. THE ERROR IS NEVER DISCARDED. A failed READ is not "already present" -- treating it as one would
//      make this insert the whole catalogue a second time. A failed INSERT is not a no-op. Every branch
//      below returns a fail() naming what could not be done, because a seed that half-worked and
//      reported success is a library with holes in it that nobody will look for.
//
//   3. THE VERSION SNAPSHOT IS WRITTEN IN THE SAME ACT. LCP s3: "parameter definitions remain
//      versioned"; CPL s22: "Version changes so that historical values retain their original
//      definition." A definition that exists without the version describing it cannot answer what it
//      looked like when a measurement was taken against it.
//
//   4. IDEMPOTENT. Running it twice creates nothing the second time, and the returned counts say so
//      rather than reporting the same figure twice.
//
// ⚠ AND ONE PROPERTY IT DOES NOT HAVE: THERE IS NO PRACTICE AUDIT ENTRY. THIS IS DELIBERATE.
//
// provisioning.audit writes to practice_audit_event, which is keyed on a workspace. Authoring the
// platform library is NOT a practice act -- it belongs to no tenant, and picking some arbitrary
// workspace to satisfy the column would put a false record in the one place that must not carry one: a
// practice's own trail would then show it creating parameters it never created. So nothing is audited
// here, and this comment is the statement of what is not recorded rather than an omission somebody has
// to discover.
//
// WHAT STANDS IN FOR IT TODAY: the seeding script's output. scripts/cpl-catalogue-seed.ts names every
// code it inserted and every code it found already present, and the returned `createdDefinitions` /
// `createdPacks` arrays below exist so that it can. A platform-level audit trail -- its own table, with
// no workspace column -- is its own piece of work and is not smuggled in here.
//
// ⚠ NOTHING HERE ACTIVATES ANYTHING. CPL s2: "Each pack is inactive until selected by a practitioner."
// s24 puts activation in the Patient Workspace. This function does not touch
// practice_parameter_activation and installing a pack remains a separate, practice-scoped act.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

/** A platform definition to seed. Mirrors the columns migration 246 s1 actually has. */
export type PlatformDefinitionSeed = {
  code: string; display_name: string; short_name?: string | null; synonyms?: string[];
  category: string; data_type: string;
  canonical_unit?: string | null; permitted_units?: string[]; unit_conversions?: Record<string, number>;
  options?: { value: string; label: string; score?: number }[];
  value_precision?: number | null; min_plausible?: number | null; max_plausible?: number | null;
  applicability?: Record<string, unknown>;
  default_collection_rule?: string;
  /** LCP s6 Presentation. `graph` is whether the value trends -- false for free text (246 s8). */
  presentation?: { form: boolean; graph: boolean; table: boolean };
  formula?: string | null;
  risk_class?: string; licence_required?: boolean; licence_reference?: string | null;
  /** LCP s6 Governance. Cited to the section that specified it, not to the practice that ran the seed. */
  source?: string; owner?: string; status?: string;
  /** The version-1 change note. A version with no note is a change nobody can review (246 s2). */
  version_note?: string;
};

/** A platform pack and its items. `items` name DEFINITION CODES, which may be core ones. */
export type PlatformPackSeed = {
  code: string; name: string; specialty?: string | null; description?: string | null;
  status?: string;
  items: { code: string; local_label?: string | null; collection_rule?: string | null; position?: number; enabled?: boolean }[];
};

export type PlatformCatalogueResult = {
  definitionsCreated: number; definitionsExisting: number;
  packsCreated: number; packsExisting: number;
  itemsCreated: number; itemsExisting: number;
  /** ⚠ THE RECORD, in place of an audit entry. See the header. */
  createdDefinitions: string[]; createdPacks: string[];
};

/**
 * Seed a catalogue of PLATFORM parameter definitions and packs. Idempotent; installs nothing.
 *
 * ⚠ A DEFINITION IS NEVER UPDATED HERE, ONLY CREATED. A code that already exists at the platform tier
 * is left exactly as it is, even if the seed describes it differently. Rewriting a live definition in
 * place is the "silent rewriting" LCP s3 forbids: it would change, retrospectively, the unit and the
 * plausibility window that every historical measurement was recorded against. Changing a shipped
 * definition is a versioned edit, not a re-seed.
 */
export async function ensurePlatformCatalogue(
  admin: any,
  definitions: PlatformDefinitionSeed[],
  packs: PlatformPackSeed[] = [],
): Promise<EngineResult<PlatformCatalogueResult>> {
  // ── definitions ────────────────────────────────────────────────────────────────────────────────
  const { data: existingDefs, error: defReadErr } = await admin.from("practice_parameter_definition")
    .select("id, code").is("workspace_id", null);
  // ⚠ PROPERTY 2. A failed read is not an empty library; proceeding would insert everything twice.
  if (defReadErr) return fail(503, "LIBRARY_UNREADABLE", `the platform parameter library could not be read: ${defReadErr.message}`);

  const defByCode = new Map<string, string>(((existingDefs ?? []) as { id: string; code: string }[]).map(r => [r.code, r.id]));
  const missingDefs = definitions.filter(d => !defByCode.has(d.code));

  const defRows = missingDefs.map(d => ({
    workspace_id: null,
    code: d.code, display_name: d.display_name, short_name: d.short_name ?? null,
    synonyms: d.synonyms ?? [], category: d.category, data_type: d.data_type,
    canonical_unit: d.canonical_unit ?? null, permitted_units: d.permitted_units ?? [],
    unit_conversions: d.unit_conversions ?? {}, options: d.options ?? [],
    value_precision: d.value_precision ?? null,
    min_plausible: d.min_plausible ?? null, max_plausible: d.max_plausible ?? null,
    applicability: d.applicability ?? {},
    default_collection_rule: d.default_collection_rule ?? "on_request",
    // ⚠ CARRIED FROM THE SEED, not forced. createDefinition writes { form, graph, table } all true for
    // everything, which marks free text chartable -- and a chart over text that happens to look like
    // numbers is how a transposed digit becomes a trend (246 s8).
    presentation: d.presentation ?? { form: true, graph: true, table: true },
    formula: d.formula ?? null,
    risk_class: d.risk_class ?? "low",
    // CPL s23: a definition classified `licensed` cannot claim it needs no licence. The DB says so too;
    // deriving it here turns a constraint violation into a row that is simply correct.
    licence_required: d.risk_class === "licensed" ? true : d.licence_required === true,
    licence_reference: d.licence_reference ?? null,
    source: d.source ?? "CPR-CPL-001", owner: d.owner ?? "Competen Practice platform",
    version: 1,
    effective_from: new Date().toISOString(),
    status: d.status ?? "draft",
  }));

  let definitionsCreated = 0;
  if (defRows.length > 0) {
    // ⚠ PROPERTY 1. insert(), never upsert() -- the platform index is partial.
    const { data: inserted, error: insErr } = await admin.from("practice_parameter_definition")
      .insert(defRows).select("id, code");
    if (insErr) return fail(500, "CATALOGUE_SEED_FAILED", `the platform catalogue could not be written: ${insErr.message}`);

    const insertedRows = (inserted ?? []) as { id: string; code: string }[];
    for (const r of insertedRows) defByCode.set(r.code, r.id);
    definitionsCreated = insertedRows.length;

    // ⚠ PROPERTY 3. The snapshot in the same act, carrying the seed's own note.
    const versionRows = insertedRows.map(r => ({
      definition_id: r.id, version: 1,
      snapshot: defRows.find(x => x.code === r.code) ?? {},
      change_note: definitions.find(d => d.code === r.code)?.version_note
        ?? "Seeded from the CPR-CPL-001 platform catalogue.",
    }));
    const { error: vErr } = await admin.from("practice_parameter_definition_version").insert(versionRows);
    if (vErr) return fail(500, "CATALOGUE_VERSION_FAILED", `the catalogue was written without versions: ${vErr.message}`);
  }

  // ── packs ──────────────────────────────────────────────────────────────────────────────────────
  const { data: existingPacks, error: packReadErr } = await admin.from("practice_parameter_pack")
    .select("id, code").is("workspace_id", null);
  if (packReadErr) return fail(503, "PACKS_UNREADABLE", `the platform pack catalogue could not be read: ${packReadErr.message}`);

  const packByCode = new Map<string, string>(((existingPacks ?? []) as { id: string; code: string }[]).map(r => [r.code, r.id]));
  const missingPacks = packs.filter(p => !packByCode.has(p.code));

  let packsCreated = 0;
  if (missingPacks.length > 0) {
    const packRows = missingPacks.map(p => ({
      workspace_id: null,
      code: p.code, name: p.name,
      specialty: p.specialty ?? null, description: p.description ?? null,
      status: p.status ?? "published", version: 1,
    }));
    const { data: inserted, error: pErr } = await admin.from("practice_parameter_pack")
      .insert(packRows).select("id, code");
    if (pErr) return fail(500, "PACK_SEED_FAILED", `the platform packs could not be written: ${pErr.message}`);
    const insertedPacks = (inserted ?? []) as { id: string; code: string }[];
    for (const r of insertedPacks) packByCode.set(r.code, r.id);
    packsCreated = insertedPacks.length;
  }

  // ── pack items ─────────────────────────────────────────────────────────────────────────────────
  //
  // ⚠ AN ITEM NAMING A DEFINITION THAT DOES NOT EXIST IS AN ERROR, NOT A SKIP. A pack quietly missing
  // half its parameters installs cleanly and gives a practitioner a form with holes in it.
  const packIds = packs.map(p => packByCode.get(p.code)).filter((v): v is string => !!v);
  let existingItems: { pack_id: string; definition_id: string }[] = [];
  if (packIds.length > 0) {
    const { data, error: iErr } = await admin.from("practice_parameter_pack_item")
      .select("pack_id, definition_id").in("pack_id", packIds);
    if (iErr) return fail(503, "PACK_ITEMS_UNREADABLE", `the platform pack items could not be read: ${iErr.message}`);
    existingItems = (data ?? []) as { pack_id: string; definition_id: string }[];
  }
  const haveItem = new Set(existingItems.map(i => `${i.pack_id}:${i.definition_id}`));

  const itemRows: Record<string, unknown>[] = [];
  for (const p of packs) {
    const packId = packByCode.get(p.code);
    if (!packId) return fail(500, "PACK_MISSING", `the pack ${p.code} was neither found nor created`);
    for (let i = 0; i < p.items.length; i++) {
      const item = p.items[i];
      const definitionId = defByCode.get(item.code);
      if (!definitionId)
        return fail(422, "UNKNOWN_PARAMETER", `pack ${p.code} names the parameter ${item.code}, which is not in the platform library`);
      if (haveItem.has(`${packId}:${definitionId}`)) continue;
      itemRows.push({
        pack_id: packId, definition_id: definitionId,
        local_label: item.local_label ?? null, collection_rule: item.collection_rule ?? null,
        position: item.position ?? i, enabled: item.enabled !== false,
      });
    }
  }

  let itemsCreated = 0;
  if (itemRows.length > 0) {
    // (ux_practice_param_pack_item IS a plain unique index and would be a valid on-conflict target, but
    // read-then-insert-missing is used here too so that every branch of this function has the same
    // shape and the same idempotency argument.)
    const { error: iErr } = await admin.from("practice_parameter_pack_item").insert(itemRows);
    if (iErr) return fail(500, "PACK_ITEM_SEED_FAILED", `the platform pack items could not be written: ${iErr.message}`);
    itemsCreated = itemRows.length;
  }

  return {
    ok: true,
    data: {
      definitionsCreated, definitionsExisting: definitions.length - definitionsCreated,
      packsCreated, packsExisting: packs.length - packsCreated,
      itemsCreated, itemsExisting: haveItem.size,
      createdDefinitions: missingDefs.map(d => d.code),
      createdPacks: missingPacks.map(p => p.code),
    },
  };
}

// ────────────────────────────────────────────────────────────────────────────────────────────────────
// UNITS -- LCP s12 "Canonical units and deterministic unit conversion"
// ────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Convert to the canonical unit, or say it cannot be done.
 *
 * ⚠ NEVER GUESSES. clinical-calculators.ts's own rule: "Creatinine in mg/dL and in umol/L differ by a
 * factor of 88.4, and a calculator that inferred the unit from the magnitude would be wrong exactly at
 * the boundary where it matters." A unit that is not in the definition's conversion table is refused,
 * not assumed to be canonical -- a number silently treated as kilograms when it was pounds is out by a
 * factor of two, and a dose calculated from it is out by the same factor.
 */
export function toCanonical(input: {
  value: number; unit: string; canonicalUnit: string | null; conversions: Record<string, number>;
}): { ok: true; value: number; unit: string } | { ok: false; message: string } {
  const canonical = input.canonicalUnit;
  if (!canonical) return { ok: false, message: "this parameter has no canonical unit, so a value cannot be converted" };
  if (input.unit === canonical) return { ok: true, value: input.value, unit: canonical };

  // The one offset conversion in the core library, named rather than encoded as a wrong multiplier.
  if (canonical === "C" && input.unit === "F")
    return { ok: true, value: Math.round(((input.value - 32) * 5 / 9) * 100) / 100, unit: "C" };

  const factor = input.conversions[input.unit];
  if (typeof factor !== "number" || !Number.isFinite(factor))
    return { ok: false, message: `there is no conversion from ${input.unit} to ${canonical} for this parameter` };
  return { ok: true, value: Math.round(input.value * factor * 1e6) / 1e6, unit: canonical };
}

// ────────────────────────────────────────────────────────────────────────────────────────────────────
// LCP s4 -- INHERITANCE RESOLUTION
// ────────────────────────────────────────────────────────────────────────────────────────────────────

export type ActivationRow = {
  id: string; definitionId: string; packId: string | null; packVersion: number | null;
  scope: ActivationScope; scopeId: string; state: "active" | "inactive";
  collectionRule: string | null; localLabel: string | null;
  visibility: "team" | "practitioner_only";
  thresholdOverride: Record<string, unknown>;
};

/**
 * s4's precedence, applied: "Encounter override -> Patient Monitoring Plan -> Clinic/session
 * configuration -> Practitioner defaults -> Platform library."
 *
 * The Patient Monitoring Plan sits between encounter and clinic and lives in its own table, so it is
 * applied by the callers that have a patient. This function resolves the four ACTIVATION levels, and it
 * walks ACTIVATION_SCOPES_BY_PRECEDENCE rather than sorting -- the order is the specification, and a
 * comparator would let a reordering of the array change which configuration wins without anybody
 * noticing.
 */
export function resolveActivation(
  rows: ActivationRow[],
  definitionId: string,
  context: { encounterId?: string | null; sessionId?: string | null; clinicId?: string | null; practitionerId?: string | null },
): ActivationRow | null {
  const mine = rows.filter(r => r.definitionId === definitionId);
  for (const scope of ACTIVATION_SCOPES_BY_PRECEDENCE) {
    const wanted = scope === "encounter" ? context.encounterId
      : scope === "session" ? context.sessionId
        : scope === "clinic" ? context.clinicId
          : scope === "practitioner" ? context.practitionerId
            : SCOPE_SENTINEL;
    if (!wanted) continue;
    const hit = mine.find(r => r.scope === scope && r.scopeId === wanted);
    if (hit) return hit;
  }
  return null;
}

const readActivations = (rows: any[]): ActivationRow[] => rows.map(r => ({
  id: r.id, definitionId: r.definition_id, packId: r.pack_id ?? null, packVersion: r.pack_version ?? null,
  scope: r.scope, scopeId: r.scope_id, state: r.state,
  collectionRule: r.collection_rule ?? null, localLabel: r.local_label ?? null,
  visibility: r.visibility, thresholdOverride: (r.threshold_override ?? {}) as Record<string, unknown>,
}));

/** A threshold_override jsonb read as bounds, or null when it states none. */
const boundsOf = (raw: unknown): { low: number | null; high: number | null } | null => {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const low = typeof o.low === "number" ? o.low : null;
  const high = typeof o.high === "number" ? o.high : null;
  return low === null && high === null ? null : { low, high };
};

// ────────────────────────────────────────────────────────────────────────────────────────────────────
// s10.1 -- PRACTICE SETUP: THE CLINICAL PARAMETERS PAGE
// ────────────────────────────────────────────────────────────────────────────────────────────────────

export type LibraryParameter = {
  id: string; code: string; displayName: string; shortName: string | null; synonyms: string[];
  category: string; dataType: string;
  canonicalUnit: string | null; permittedUnits: string[];
  precision: number | null; minPlausible: number | null; maxPlausible: number | null;
  defaultCollectionRule: string; formula: string | null;
  riskClass: string; licenceRequired: boolean; licenceReference: string | null;
  status: string; version: number; source: string | null; owner: string | null;
  /** NULL workspace = a platform row this practice may activate but never edit. */
  platform: boolean;
  clonedFromId: string | null;
  /** The practice-level activation, when there is one. */
  activation: {
    id: string; state: "active" | "inactive"; scope: ActivationScope; scopeId: string;
    collectionRule: string | null; localLabel: string | null; visibility: string;
    threshold: { low: number | null; high: number | null } | null;
    packId: string | null; packVersion: number | null;
  } | null;
  /** Doctrine 2, at library level: is anything checking this parameter's values at all? */
  threshold: ThresholdVerdict;
  /** Doctrine 7: how many measurements exist behind this parameter, so the figure opens a list. */
  measurementCount: number | null;
};

export type LibraryPack = {
  id: string; code: string; name: string; specialty: string | null; description: string | null;
  status: string; version: number; platform: boolean; clonedFromId: string | null;
  itemCount: number | null;
  /** How many of this pack's parameters this practice has an activation for. */
  installedCount: number | null;
};

export type ParameterLibrary = {
  permitted: boolean;
  canConfigure: boolean;
  canInstallPacks: boolean;
  parameters: Panel<LibraryParameter>;
  packs: Panel<LibraryPack>;
  /** Doctrine 7 again: each figure is the length of a list on this page. */
  counts: {
    inLibrary: number | null; active: number | null; inactive: number | null;
    notActivated: number | null; custom: number | null; withThreshold: number | null;
  };
  /** The seed's own outcome, so a page never silently renders a half-written library. */
  librarySeed: { created: number; existing: number } | null;
  librarySeedError: string | null;
};

export async function parameterLibrary(admin: any, ctx: WorkspaceContext): Promise<ParameterLibrary> {
  const blank = (permitted: boolean): ParameterLibrary => ({
    permitted,
    canConfigure: permitted && hasCapability(ctx, CAP_CONFIGURE),
    canInstallPacks: permitted && hasCapability(ctx, CAP_PACK_INSTALL),
    parameters: permitted ? failed("not read") : denied(),
    packs: permitted ? failed("not read") : denied(),
    counts: { inLibrary: null, active: null, inactive: null, notActivated: null, custom: null, withThreshold: null },
    librarySeed: null, librarySeedError: null,
  });
  if (!hasCapability(ctx, CAP_VIEW)) return blank(false);

  // The platform library is seeded on demand. A failure here is REPORTED, never swallowed -- a page
  // that renders a library with holes in it is worse than one that says the library is unavailable.
  const seed = hasCapability(ctx, CAP_CONFIGURE) ? await ensureCoreLibrary(admin) : null;

  const [defRes, actRes, packRes, itemRes, mCountRes] = await Promise.all([
    admin.from("practice_parameter_definition")
      .select("id, workspace_id, code, display_name, short_name, synonyms, category, data_type, canonical_unit, permitted_units, value_precision, min_plausible, max_plausible, default_collection_rule, formula, risk_class, licence_required, licence_reference, status, version, source, owner, cloned_from_id")
      .or(`workspace_id.is.null,workspace_id.eq.${ctx.workspaceId}`)
      .neq("status", "retired")
      .order("category").order("display_name"),
    admin.from("practice_parameter_activation")
      .select("id, definition_id, pack_id, pack_version, scope, scope_id, state, collection_rule, local_label, visibility, threshold_override")
      .eq("workspace_id", ctx.workspaceId),
    admin.from("practice_parameter_pack")
      .select("id, workspace_id, code, name, specialty, description, status, version, cloned_from_id")
      .or(`workspace_id.is.null,workspace_id.eq.${ctx.workspaceId}`)
      .neq("status", "retired").order("name"),
    admin.from("practice_parameter_pack_item").select("pack_id, definition_id, enabled"),
    admin.from("practice_parameter_measurement")
      .select("definition_id").eq("workspace_id", ctx.workspaceId).eq("status", "active"),
  ]);

  if (defRes.error) {
    const b = blank(true);
    return {
      ...b,
      parameters: failed(`the parameter library could not be read: ${defRes.error.message}`),
      packs: packRes.error ? failed(packRes.error.message) : loaded([]),
      librarySeed: seed?.ok ? seed.data : null,
      librarySeedError: seed && !seed.ok ? seed.message : null,
    };
  }

  const activations = actRes.error ? null : readActivations((actRes.data ?? []) as any[]);
  // ⚠ A FAILED ACTIVATION READ IS NOT "NOTHING IS ACTIVATED". Every parameter's activation is then
  // unknown, and its threshold verdict is `unreadable` rather than `not_checked` -- because "nobody set
  // a rule" and "we could not tell whether anybody set a rule" are different answers.
  const activationsUnavailable = !!actRes.error;

  const measurementCounts = mCountRes.error ? null : (() => {
    const m = new Map<string, number>();
    for (const r of (mCountRes.data ?? []) as { definition_id: string }[])
      m.set(r.definition_id, (m.get(r.definition_id) ?? 0) + 1);
    return m;
  })();

  const parameters: LibraryParameter[] = ((defRes.data ?? []) as any[]).map(d => {
    const act = activations?.find(a =>
      a.definitionId === d.id && a.scope === "practice" && a.scopeId === SCOPE_SENTINEL) ?? null;
    const bounds = act ? boundsOf(act.thresholdOverride) : null;
    return {
      id: d.id, code: d.code, displayName: d.display_name, shortName: d.short_name ?? null,
      synonyms: (d.synonyms ?? []) as string[],
      category: d.category, dataType: d.data_type,
      canonicalUnit: d.canonical_unit ?? null, permittedUnits: (d.permitted_units ?? []) as string[],
      precision: d.value_precision ?? null,
      minPlausible: d.min_plausible ?? null, maxPlausible: d.max_plausible ?? null,
      defaultCollectionRule: d.default_collection_rule, formula: d.formula ?? null,
      riskClass: d.risk_class, licenceRequired: d.licence_required === true,
      licenceReference: d.licence_reference ?? null,
      status: d.status, version: d.version, source: d.source ?? null, owner: d.owner ?? null,
      platform: d.workspace_id === null,
      clonedFromId: d.cloned_from_id ?? null,
      activation: act ? {
        id: act.id, state: act.state, scope: act.scope, scopeId: act.scopeId,
        collectionRule: act.collectionRule, localLabel: act.localLabel, visibility: act.visibility,
        threshold: bounds, packId: act.packId, packVersion: act.packVersion,
      } : null,
      threshold: thresholdLine({
        value: null, unit: d.canonical_unit ?? null,
        target: null, practiceThreshold: bounds, unavailable: activationsUnavailable,
      }),
      measurementCount: measurementCounts ? (measurementCounts.get(d.id) ?? 0) : null,
    };
  });

  const items = itemRes.error ? null : ((itemRes.data ?? []) as { pack_id: string; definition_id: string; enabled: boolean }[]);
  const packs: LibraryPack[] = ((packRes.data ?? []) as any[]).map(p => {
    const mine = items?.filter(i => i.pack_id === p.id) ?? null;
    return {
      id: p.id, code: p.code, name: p.name, specialty: p.specialty ?? null,
      description: p.description ?? null, status: p.status, version: p.version,
      platform: p.workspace_id === null, clonedFromId: p.cloned_from_id ?? null,
      itemCount: mine ? mine.length : null,
      installedCount: mine && activations
        ? mine.filter(i => activations.some(a => a.definitionId === i.definition_id && a.state === "active")).length
        : null,
    };
  });

  const active = activationsUnavailable ? null : parameters.filter(p => p.activation?.state === "active").length;
  const inactive = activationsUnavailable ? null : parameters.filter(p => p.activation?.state === "inactive").length;
  const notActivated = activationsUnavailable ? null : parameters.filter(p => p.activation === null).length;

  return {
    permitted: true,
    canConfigure: hasCapability(ctx, CAP_CONFIGURE),
    canInstallPacks: hasCapability(ctx, CAP_PACK_INSTALL),
    parameters: loaded(parameters),
    packs: packRes.error ? failed(`the pack catalogue could not be read: ${packRes.error.message}`) : loaded(packs),
    counts: {
      inLibrary: parameters.length,
      active, inactive, notActivated,
      custom: parameters.filter(p => !p.platform).length,
      withThreshold: activationsUnavailable ? null : parameters.filter(p => p.threshold.ruleSource !== null).length,
    },
    librarySeed: seed?.ok ? seed.data : null,
    librarySeedError: seed && !seed.ok ? seed.message : null,
  };
}

// ── s10.1 WRITES ─────────────────────────────────────────────────────────────────────────────────────

export type ActivationInput = {
  definitionId: string;
  scope?: ActivationScope;
  scopeId?: string;
  state: "active" | "inactive";
  collectionRule?: string | null;
  localLabel?: string | null;
  visibility?: "team" | "practitioner_only";
  threshold?: { low: number | null; high: number | null } | null;
  packId?: string | null;
  packVersion?: number | null;
  actorId: string;
  correlationId: string;
};

/**
 * Activate or deactivate a parameter at a level of s4's hierarchy.
 *
 * ⚠ DEACTIVATION IS A STATE, NOT A DELETE. CPL s2: "Each pack is inactive until selected by a
 * practitioner", and an inactive row is a deliberate switch-off that must survive a pack reinstall.
 * Deleting the row would make the next install silently turn the parameter back on.
 *
 * ⚠ THE ON-CONFLICT TARGET IS A REAL UNIQUE INDEX. ux_practice_param_activation_scope is over four NOT
 * NULL columns, which is exactly why migration 246 gave scope_id a zero-UUID sentinel instead of a
 * nullable column. The error is not discarded.
 */
export async function setActivation(
  admin: any, ctx: WorkspaceContext, input: ActivationInput,
): Promise<EngineResult<{ id: string; state: string }>> {
  if (!hasCapability(ctx, CAP_CONFIGURE))
    return fail(403, "FORBIDDEN", "changing which parameters this practice collects needs parameter.configure");

  const scope: ActivationScope = input.scope ?? "practice";
  if (!ACTIVATION_SCOPES_BY_PRECEDENCE.includes(scope))
    return fail(422, "VALIDATION_ERROR", `${scope} is not one of LCP s4's configuration levels`);
  const scopeId = scope === "practice" ? SCOPE_SENTINEL : trim(input.scopeId);
  if (scope !== "practice" && (!scopeId || scopeId === SCOPE_SENTINEL))
    return fail(422, "VALIDATION_ERROR", `a ${scope}-scoped activation needs the id of the ${scope} it applies to`);
  if (input.state !== "active" && input.state !== "inactive")
    return fail(422, "VALIDATION_ERROR", "an activation is active or inactive");
  if (input.collectionRule && !COLLECTION_RULE_CODES.includes(input.collectionRule))
    return fail(422, "VALIDATION_ERROR", `${input.collectionRule} is not one of LCP s6's collection rules`);

  // The definition has to be one this practice may see: a platform row, or its own.
  const { data: def, error: defErr } = await admin.from("practice_parameter_definition")
    .select("id, workspace_id, code, status, risk_class, licence_required, licence_reference")
    .eq("id", input.definitionId).maybeSingle();
  if (defErr) return fail(503, "UNAVAILABLE", `the parameter could not be read: ${defErr.message}`);
  if (!def || (def.workspace_id !== null && def.workspace_id !== ctx.workspaceId))
    return fail(404, "NOT_FOUND", "no such parameter");
  if (def.status === "retired" && input.state === "active")
    return fail(422, "RETIRED", "a retired parameter keeps its history and cannot be activated again");

  // CPL s2: "Validated proprietary scores require licensing and version governance before production
  // activation." The database refuses an ACTIVE definition with no licence reference; this refuses
  // switching one on in a practice, with a sentence rather than a constraint violation.
  if (input.state === "active" && def.licence_required === true && !trim(def.licence_reference))
    return fail(422, "LICENCE_REQUIRED", "this parameter is licensed and has no licence reference recorded, so it cannot be activated");

  const row = {
    workspace_id: ctx.workspaceId, definition_id: def.id,
    pack_id: input.packId ?? null, pack_version: input.packVersion ?? null,
    scope, scope_id: scopeId, state: input.state,
    collection_rule: input.collectionRule ?? null,
    local_label: input.localLabel ? trim(input.localLabel) : null,
    visibility: input.visibility ?? "team",
    threshold_override: input.threshold ?? {},
    updated_at: new Date().toISOString(), updated_by: input.actorId, created_by: input.actorId,
  };
  const { data, error } = await admin.from("practice_parameter_activation")
    .upsert(row, { onConflict: "workspace_id,definition_id,scope,scope_id" })
    .select("id, state").single();
  // ⚠ NEVER DISCARDED. An upsert whose conflict target does not fire returns an error and silently
  // writes nothing useful; discarding it is how two write failures shipped here.
  if (error) return fail(500, "WRITE_FAILED", `the activation could not be saved: ${error.message}`);

  await audit(admin, {
    workspaceId: ctx.workspaceId, actorId: input.actorId,
    eventType: input.state === "active" ? "practice.parameter.activated" : "practice.parameter.deactivated",
    payload: { definitionId: def.id, code: def.code, scope, scopeId, collectionRule: input.collectionRule ?? null },
    correlationId: input.correlationId,
  });
  return { ok: true, data: { id: data.id, state: data.state } };
}

export type DefinitionInput = {
  code: string; displayName: string; shortName?: string | null; synonyms?: string[];
  category: string; dataType: string;
  canonicalUnit?: string | null; permittedUnits?: string[]; unitConversions?: Record<string, number>;
  options?: { value: string; label: string; score?: number }[];
  precision?: number | null; minPlausible?: number | null; maxPlausible?: number | null;
  applicability?: Record<string, unknown>;
  defaultCollectionRule?: string;
  formula?: string | null;
  riskClass?: string; licenceRequired?: boolean; licenceReference?: string | null;
  /** CPL s22: "Clone an existing governed parameter while preserving source attribution." */
  cloneOf?: string | null;
  actorId: string; correlationId: string;
};

/**
 * CPL s22's custom parameter builder, and its clone.
 *
 * ⚠ A CLONE REMEMBERS WHERE IT CAME FROM. CPL s24: "The system can identify which practice, pack and
 * version caused a parameter to appear." A clone that forgot its origin makes that unanswerable, so
 * cloned_from_id is written and the source attribution is copied rather than blanked.
 *
 * ⚠ A PRACTICE NEVER WRITES A PLATFORM ROW. workspace_id is this workspace, always. Migration 246 s1's
 * read filter is `workspace_id is null or workspace_id = $me` and the engine must refuse a workspace
 * write to a platform row -- which it does by never offering one.
 */
export async function createDefinition(
  admin: any, ctx: WorkspaceContext, input: DefinitionInput,
): Promise<EngineResult<{ id: string; code: string }>> {
  if (!hasCapability(ctx, CAP_CONFIGURE))
    return fail(403, "FORBIDDEN", "defining a parameter needs parameter.configure");

  const code = trim(input.code).toLowerCase();
  if (!/^[a-z][a-z0-9_]{1,60}$/.test(code))
    return fail(422, "VALIDATION_ERROR", "a parameter code is lower case, starts with a letter, and holds letters, digits and underscores");
  const displayName = trim(input.displayName);
  if (!displayName) return fail(422, "VALIDATION_ERROR", "a parameter needs a display name");
  if (!PARAMETER_CATEGORY_CODES.includes(input.category))
    return fail(422, "VALIDATION_ERROR", `${input.category} is not one of LCP s6's categories`);
  if (!PARAMETER_DATA_TYPE_CODES.includes(input.dataType))
    return fail(422, "VALIDATION_ERROR", `${input.dataType} is not one of LCP s6's data types`);
  const riskClass = input.riskClass ?? "low";
  if (!RISK_CLASS_CODES.includes(riskClass))
    return fail(422, "VALIDATION_ERROR", `${riskClass} is not one of CPL s23's risk classes`);
  if (input.defaultCollectionRule && !COLLECTION_RULE_CODES.includes(input.defaultCollectionRule))
    return fail(422, "VALIDATION_ERROR", `${input.defaultCollectionRule} is not one of LCP s6's collection rules`);
  if (input.minPlausible != null && input.maxPlausible != null && input.minPlausible > input.maxPlausible)
    return fail(422, "VALIDATION_ERROR", "the plausibility window is the wrong way round");
  // CPL s23: a definition classified as licensed cannot claim it needs no licence. The database says so
  // too; saying it here turns a constraint violation into a sentence.
  const licenceRequired = riskClass === "licensed" ? true : input.licenceRequired === true;

  let origin: any = null;
  if (input.cloneOf) {
    const { data, error } = await admin.from("practice_parameter_definition")
      .select("*").eq("id", input.cloneOf).maybeSingle();
    if (error) return fail(503, "UNAVAILABLE", `the parameter to clone could not be read: ${error.message}`);
    if (!data || (data.workspace_id !== null && data.workspace_id !== ctx.workspaceId))
      return fail(404, "NOT_FOUND", "no such parameter to clone");
    origin = data;
  }

  const row: Record<string, unknown> = {
    workspace_id: ctx.workspaceId,
    code, display_name: displayName,
    short_name: input.shortName ? trim(input.shortName) : (origin?.short_name ?? null),
    synonyms: input.synonyms ?? (origin?.synonyms ?? []),
    category: input.category, data_type: input.dataType,
    canonical_unit: input.canonicalUnit ?? origin?.canonical_unit ?? null,
    permitted_units: input.permittedUnits ?? origin?.permitted_units ?? [],
    unit_conversions: input.unitConversions ?? origin?.unit_conversions ?? {},
    options: input.options ?? origin?.options ?? [],
    value_precision: input.precision ?? origin?.value_precision ?? null,
    min_plausible: input.minPlausible ?? origin?.min_plausible ?? null,
    max_plausible: input.maxPlausible ?? origin?.max_plausible ?? null,
    applicability: input.applicability ?? origin?.applicability ?? {},
    default_collection_rule: input.defaultCollectionRule ?? origin?.default_collection_rule ?? "on_request",
    presentation: origin?.presentation ?? { form: true, graph: true, table: true },
    formula: input.formula ?? origin?.formula ?? null,
    risk_class: riskClass, licence_required: licenceRequired,
    licence_reference: input.licenceReference ? trim(input.licenceReference) : (origin?.licence_reference ?? null),
    // CPL s22: "preserving source attribution". The clone cites where it came from, and its own owner
    // is this practice, so both questions have an answer.
    source: origin ? `Cloned from ${origin.code}${origin.source ? ` (${origin.source})` : ""}` : `Custom parameter, ${ctx.workspaceName}`,
    owner: ctx.workspaceName, version: 1,
    effective_from: new Date().toISOString(),
    // A NEW DEFINITION STARTS AS A DRAFT. CPL s22 governs the change and the licence gate in migration
    // 246 refuses an ACTIVE licensed definition with no reference -- a draft is where that gets filled in.
    status: "draft",
    cloned_from_id: origin?.id ?? null,
    created_by: input.actorId, updated_by: input.actorId,
  };

  const { data, error } = await admin.from("practice_parameter_definition").insert(row).select("id, code").single();
  if (error) {
    if (/duplicate key|unique/i.test(error.message))
      return fail(409, "DUPLICATE_CODE", `this practice already has a parameter with the code ${code}`);
    return fail(500, "WRITE_FAILED", `the parameter could not be saved: ${error.message}`);
  }

  const { error: vErr } = await admin.from("practice_parameter_definition_version").insert({
    definition_id: data.id, version: 1, snapshot: row,
    change_note: origin ? `Cloned from ${origin.code}.` : "Created.",
    created_by: input.actorId,
  });
  if (vErr) return fail(500, "VERSION_FAILED", `the parameter was created without a version snapshot: ${vErr.message}`);

  await audit(admin, {
    workspaceId: ctx.workspaceId, actorId: input.actorId,
    eventType: origin ? "practice.parameter.cloned" : "practice.parameter.created",
    payload: { definitionId: data.id, code, clonedFrom: origin?.code ?? null, riskClass },
    correlationId: input.correlationId,
  });
  return { ok: true, data: { id: data.id, code: data.code } };
}

/**
 * Move a workspace definition between draft, active and retired.
 *
 * ⚠ RETIREMENT IS A STATUS, NOT A DELETE. CPL s2: "Historical measurements remain available after a
 * pack or parameter is retired." LCP s13: "Deactivating a parameter never removes historical
 * measurements." Nothing here touches a measurement.
 *
 * ⚠ AND A STATUS CHANGE BUMPS THE VERSION AND WRITES A SNAPSHOT. LCP s11: "All calculations and alerts
 * store the parameter-definition and rule versions used", which is only answerable if the versions
 * exist.
 */
export async function setDefinitionStatus(
  admin: any, ctx: WorkspaceContext,
  input: { definitionId: string; status: "draft" | "active" | "retired"; changeNote: string; actorId: string; correlationId: string },
): Promise<EngineResult<{ id: string; status: string; version: number }>> {
  if (!hasCapability(ctx, CAP_CONFIGURE))
    return fail(403, "FORBIDDEN", "governing a parameter definition needs parameter.configure");
  if (!["draft", "active", "retired"].includes(input.status))
    return fail(422, "VALIDATION_ERROR", "a definition is draft, active or retired");
  const note = trim(input.changeNote);
  if (!note) return fail(422, "VALIDATION_ERROR", "a version with no change note is a change nobody can review");

  const { data: def, error } = await admin.from("practice_parameter_definition")
    .select("*").eq("id", input.definitionId).eq("workspace_id", ctx.workspaceId).maybeSingle();
  if (error) return fail(503, "UNAVAILABLE", `the parameter could not be read: ${error.message}`);
  // ⚠ A PLATFORM ROW IS NOT FOUND HERE, DELIBERATELY. The workspace filter above is the refusal
  // migration 246 s1 asks for: "the engine must refuse a workspace write to a platform row."
  if (!def) return fail(404, "NOT_FOUND", "no such parameter in this practice (platform parameters are governed centrally)");

  if (input.status === "active" && def.licence_required === true && !trim(def.licence_reference))
    return fail(422, "LICENCE_REQUIRED", "a licensed parameter cannot go active without a recorded licence reference");

  const version = (def.version ?? 1) + 1;
  const { error: upErr } = await admin.from("practice_parameter_definition")
    .update({ status: input.status, version, updated_at: new Date().toISOString(), updated_by: input.actorId })
    .eq("id", def.id).eq("workspace_id", ctx.workspaceId);
  if (upErr) return fail(500, "WRITE_FAILED", `the status could not be saved: ${upErr.message}`);

  const { error: vErr } = await admin.from("practice_parameter_definition_version").insert({
    definition_id: def.id, version, snapshot: { ...def, status: input.status, version },
    change_note: note, created_by: input.actorId,
  });
  if (vErr) return fail(500, "VERSION_FAILED", `the status changed without a version snapshot: ${vErr.message}`);

  await audit(admin, {
    workspaceId: ctx.workspaceId, actorId: input.actorId,
    eventType: "practice.parameter.status_changed",
    payload: { definitionId: def.id, code: def.code, from: def.status, to: input.status, version, reason: note },
    correlationId: input.correlationId,
  });
  return { ok: true, data: { id: def.id, status: input.status, version } };
}

// ── PACKS -- the machinery, not the catalogue ────────────────────────────────────────────────────────

export async function createPack(
  admin: any, ctx: WorkspaceContext,
  input: { code: string; name: string; specialty?: string | null; description?: string | null; cloneOf?: string | null; actorId: string; correlationId: string },
): Promise<EngineResult<{ id: string; code: string; itemsCopied: number }>> {
  if (!hasCapability(ctx, CAP_PACK_INSTALL))
    return fail(403, "FORBIDDEN", "creating or cloning a pack needs pack.install");

  const code = trim(input.code).toLowerCase();
  if (!/^[a-z][a-z0-9_]{1,60}$/.test(code))
    return fail(422, "VALIDATION_ERROR", "a pack code is lower case, starts with a letter, and holds letters, digits and underscores");
  const name = trim(input.name);
  if (!name) return fail(422, "VALIDATION_ERROR", "a pack needs a name");

  let origin: any = null;
  if (input.cloneOf) {
    const { data, error } = await admin.from("practice_parameter_pack")
      .select("*").eq("id", input.cloneOf).maybeSingle();
    if (error) return fail(503, "UNAVAILABLE", `the pack to clone could not be read: ${error.message}`);
    if (!data || (data.workspace_id !== null && data.workspace_id !== ctx.workspaceId))
      return fail(404, "NOT_FOUND", "no such pack to clone");
    origin = data;
  }

  const { data, error } = await admin.from("practice_parameter_pack").insert({
    workspace_id: ctx.workspaceId, code, name,
    specialty: input.specialty ? trim(input.specialty) : (origin?.specialty ?? null),
    description: input.description ? trim(input.description) : (origin?.description ?? null),
    status: "draft", version: 1, cloned_from_id: origin?.id ?? null,
    created_by: input.actorId, updated_by: input.actorId,
  }).select("id, code").single();
  if (error) {
    if (/duplicate key|unique/i.test(error.message))
      return fail(409, "DUPLICATE_CODE", `this practice already has a pack with the code ${code}`);
    return fail(500, "WRITE_FAILED", `the pack could not be saved: ${error.message}`);
  }

  // CPL s2: "Patient-specific additions and overrides do not change the practitioner template." Cloning
  // copies the ITEMS too, or the clone is an empty pack wearing a governed pack's name.
  let itemsCopied = 0;
  if (origin) {
    const { data: items, error: iErr } = await admin.from("practice_parameter_pack_item")
      .select("definition_id, local_label, collection_rule, position, enabled").eq("pack_id", origin.id);
    if (iErr) return fail(500, "WRITE_FAILED", `the pack was created but its items could not be read: ${iErr.message}`);
    const rows = ((items ?? []) as any[]).map(i => ({ ...i, pack_id: data.id }));
    if (rows.length > 0) {
      const { error: cErr } = await admin.from("practice_parameter_pack_item").insert(rows);
      if (cErr) return fail(500, "WRITE_FAILED", `the pack was created without its items: ${cErr.message}`);
      itemsCopied = rows.length;
    }
  }

  await audit(admin, {
    workspaceId: ctx.workspaceId, actorId: input.actorId,
    eventType: origin ? "practice.parameter_pack.cloned" : "practice.parameter_pack.created",
    payload: { packId: data.id, code, clonedFrom: origin?.code ?? null, itemsCopied },
    correlationId: input.correlationId,
  });
  return { ok: true, data: { id: data.id, code: data.code, itemsCopied } };
}

export async function setPackItem(
  admin: any, ctx: WorkspaceContext,
  input: { packId: string; definitionId: string; localLabel?: string | null; collectionRule?: string | null; position?: number; enabled?: boolean; actorId: string; correlationId: string },
): Promise<EngineResult<{ packId: string; definitionId: string }>> {
  if (!hasCapability(ctx, CAP_PACK_INSTALL))
    return fail(403, "FORBIDDEN", "editing a pack needs pack.install");
  if (input.collectionRule && !COLLECTION_RULE_CODES.includes(input.collectionRule))
    return fail(422, "VALIDATION_ERROR", `${input.collectionRule} is not one of LCP s6's collection rules`);

  const { data: pack, error } = await admin.from("practice_parameter_pack")
    .select("id, workspace_id").eq("id", input.packId).maybeSingle();
  if (error) return fail(503, "UNAVAILABLE", `the pack could not be read: ${error.message}`);
  // A PLATFORM PACK IS NEVER EDITED. CPL s24: "Every installed parameter can be independently
  // configured without changing the platform master." A practice clones and edits the clone.
  if (!pack || pack.workspace_id !== ctx.workspaceId)
    return fail(404, "NOT_FOUND", "no such pack in this practice (a platform pack is cloned, not edited)");

  const { data: def, error: dErr } = await admin.from("practice_parameter_definition")
    .select("id, workspace_id").eq("id", input.definitionId).maybeSingle();
  if (dErr) return fail(503, "UNAVAILABLE", `the parameter could not be read: ${dErr.message}`);
  if (!def || (def.workspace_id !== null && def.workspace_id !== ctx.workspaceId))
    return fail(404, "NOT_FOUND", "no such parameter");

  // ⚠ A PLAIN UNIQUE INDEX OVER TWO NOT NULL COLUMNS, so it IS a valid on-conflict target. Migration
  // 246 s4 says so in as many words, and the error is not discarded.
  const { error: upErr } = await admin.from("practice_parameter_pack_item").upsert({
    pack_id: pack.id, definition_id: def.id,
    local_label: input.localLabel ? trim(input.localLabel) : null,
    collection_rule: input.collectionRule ?? null,
    position: input.position ?? 0, enabled: input.enabled !== false,
  }, { onConflict: "pack_id,definition_id" });
  if (upErr) return fail(500, "WRITE_FAILED", `the pack item could not be saved: ${upErr.message}`);

  await audit(admin, {
    workspaceId: ctx.workspaceId, actorId: input.actorId, eventType: "practice.parameter_pack.item_set",
    payload: { packId: pack.id, definitionId: def.id, enabled: input.enabled !== false },
    correlationId: input.correlationId,
  });
  return { ok: true, data: { packId: pack.id, definitionId: def.id } };
}

/**
 * CPL s2: "Each pack is inactive until selected by a practitioner."
 *
 * Installing writes one activation per enabled item, at the requested scope, NAMING THE PACK AND ITS
 * VERSION -- CPL s24: "The system can identify which practice, pack and version caused a parameter to
 * appear." A silent activation would make that unanswerable.
 *
 * ⚠ AN ITEM A PRACTICE HAS DELIBERATELY SWITCHED OFF STAYS OFF. Reinstalling a pack must not undo a
 * decision somebody made -- that is why deactivation is a state rather than a delete, and this respects
 * it rather than overwriting every row it touches.
 */
export async function installPack(
  admin: any, ctx: WorkspaceContext,
  input: { packId: string; scope?: ActivationScope; scopeId?: string; actorId: string; correlationId: string },
): Promise<EngineResult<{ activated: number; skippedInactive: number; skippedRetired: number }>> {
  if (!hasCapability(ctx, CAP_PACK_INSTALL))
    return fail(403, "FORBIDDEN", "installing a pack needs pack.install");

  const scope: ActivationScope = input.scope ?? "practice";
  const scopeId = scope === "practice" ? SCOPE_SENTINEL : trim(input.scopeId);
  if (scope !== "practice" && (!scopeId || scopeId === SCOPE_SENTINEL))
    return fail(422, "VALIDATION_ERROR", `a ${scope}-scoped install needs the id of the ${scope} it applies to`);

  const { data: pack, error } = await admin.from("practice_parameter_pack")
    .select("id, workspace_id, code, name, version, status").eq("id", input.packId).maybeSingle();
  if (error) return fail(503, "UNAVAILABLE", `the pack could not be read: ${error.message}`);
  if (!pack || (pack.workspace_id !== null && pack.workspace_id !== ctx.workspaceId))
    return fail(404, "NOT_FOUND", "no such pack");
  if (pack.status === "retired")
    return fail(422, "RETIRED", "a retired pack keeps its history and is not installed again");

  const { data: items, error: iErr } = await admin.from("practice_parameter_pack_item")
    .select("definition_id, collection_rule, local_label, enabled").eq("pack_id", pack.id);
  if (iErr) return fail(503, "UNAVAILABLE", `the pack's parameters could not be read: ${iErr.message}`);
  const enabled = ((items ?? []) as any[]).filter(i => i.enabled !== false);
  if (enabled.length === 0)
    return fail(422, "EMPTY_PACK", "this pack has no enabled parameters, so installing it would change nothing");

  const ids = enabled.map(i => i.definition_id as string);
  const [{ data: defs, error: dErr }, { data: existing, error: eErr }] = await Promise.all([
    admin.from("practice_parameter_definition").select("id, workspace_id, status").in("id", ids),
    admin.from("practice_parameter_activation")
      .select("definition_id, state").eq("workspace_id", ctx.workspaceId)
      .eq("scope", scope).eq("scope_id", scopeId).in("definition_id", ids),
  ]);
  if (dErr) return fail(503, "UNAVAILABLE", `the pack's parameters could not be read: ${dErr.message}`);
  if (eErr) return fail(503, "UNAVAILABLE", `this practice's existing activations could not be read: ${eErr.message}`);

  const usable = new Set(((defs ?? []) as any[])
    .filter(d => d.status !== "retired" && (d.workspace_id === null || d.workspace_id === ctx.workspaceId))
    .map(d => d.id as string));
  const switchedOff = new Set(((existing ?? []) as any[]).filter(a => a.state === "inactive").map(a => a.definition_id as string));

  const rows = enabled
    .filter(i => usable.has(i.definition_id) && !switchedOff.has(i.definition_id))
    .map(i => ({
      workspace_id: ctx.workspaceId, definition_id: i.definition_id,
      pack_id: pack.id, pack_version: pack.version,
      scope, scope_id: scopeId, state: "active",
      collection_rule: i.collection_rule ?? null, local_label: i.local_label ?? null,
      visibility: "team", threshold_override: {},
      updated_at: new Date().toISOString(), updated_by: input.actorId, created_by: input.actorId,
    }));

  if (rows.length > 0) {
    const { error: wErr } = await admin.from("practice_parameter_activation")
      .upsert(rows, { onConflict: "workspace_id,definition_id,scope,scope_id" });
    if (wErr) return fail(500, "WRITE_FAILED", `the pack could not be installed: ${wErr.message}`);
  }

  const result = {
    activated: rows.length,
    skippedInactive: enabled.filter(i => switchedOff.has(i.definition_id)).length,
    skippedRetired: enabled.filter(i => !usable.has(i.definition_id)).length,
  };
  await audit(admin, {
    workspaceId: ctx.workspaceId, actorId: input.actorId, eventType: "practice.parameter_pack.installed",
    payload: { packId: pack.id, code: pack.code, version: pack.version, scope, scopeId, ...result },
    correlationId: input.correlationId,
  });
  return { ok: true, data: result };
}

// ────────────────────────────────────────────────────────────────────────────────────────────────────
// s10.2 -- PATIENT WORKSPACE: THE MONITORING PLAN PANEL
// ────────────────────────────────────────────────────────────────────────────────────────────────────

export type PlanEntry = {
  definitionId: string;
  code: string;
  label: string;
  category: string;
  dataType: string;
  canonicalUnit: string | null;
  permittedUnits: string[];
  /** Present when this patient has a plan row; null when the parameter is purely inherited. */
  planId: string | null;
  /** LCP s7's eight states. `inherited` when there is no plan row at all. */
  state: string;
  stateMeaning: string;
  /** Where this parameter came from, in s4's own words. */
  inheritedFrom: string;
  schedule: string | null;
  scheduleLabel: string | null;
  collectionRule: string | null;
  target: { low: number | null; high: number | null } | null;
  practiceThreshold: { low: number | null; high: number | null } | null;
  baselineValue: number | null;
  baselineMeasuredAt: string | null;
  /** The direction a practitioner agreed was better, from change_rule.improving_direction. */
  improvingDirection: "up" | "down" | null;
  triggerSource: string;
  reason: string | null;
  /** ⚠ SEPARATE FROM `state`, and that is LCP s9. */
  safetyRequired: boolean;
  safetyRequiredReason: string | null;
  safetyOverrideReason: string | null;
  /**
   * ⚠ TRUE WHEN A PARAMETER IS OUT OF ROUTINE VIEW AND A SAFETY REQUIREMENT PUTS IT BACK.
   * LCP s9: "Patient-level hiding of weight must not suppress a medication-triggered safety
   * requirement." This is that sentence as a boolean, and the harness asserts both directions.
   */
  resurfacedForSafety: boolean;
  /** Current value and where it came from. s10.3's four-way distinction. */
  latest: {
    id: string; value: string; canonicalValue: number | null; unit: string | null;
    source: string; effectiveAt: string; recordedAt: string; note: string | null;
    /** A later row naming this one. Read, never stored -- see the header, rule 3. */
    amendedByLaterRow: boolean;
  } | null;
  value: ValueVerdict;
  threshold: ThresholdVerdict;
  plausibility: PlausibilityVerdict;
  due: DueVerdict;
  lastMeasuredAt: string | null;
  /** Doctrine 7: the figure is the length of a list. */
  measurementCount: number;
  /** LCP s13: "Derived values display their source measurements and calculation timestamp." */
  derived: { id: string; value: number; unit: string | null; formula: string; sourceMeasurementIds: string[]; calculatedAt: string } | null;
  openAlerts: number;
};

export type MonitoringPlan = {
  permitted: boolean;
  canRecord: boolean;
  canConfigure: boolean;
  /** Every parameter this patient has, whatever its state. */
  all: Panel<PlanEntry>;
  /** ⚠ WHAT A ROUTINE VIEW OFFERS. Hidden, paused and resolved are NOT here. */
  routine: PlanEntry[];
  /** ⚠ WHAT THE SAFETY PATH DEMANDS, whatever the routine view is doing. LCP s9. */
  safetyRequired: PlanEntry[];
  /** Derived at read time, never stored. Doctrine 8. */
  overdue: PlanEntry[];
  dueToday: PlanEntry[];
  /** Parameters whose threshold verdict is `breached`. */
  breached: PlanEntry[];
  /** ⚠ Doctrine 2 made countable: how many of this patient's parameters nothing is checking. */
  notChecked: PlanEntry[];
  alerts: Panel<{
    id: string; definitionId: string; code: string; label: string;
    alertType: string; severity: string | null; severityLabel: string;
    rationale: string; recommendedAction: string | null; status: string;
    raisedAt: string; measurementId: string | null;
  }>;
  /** LCP s10.2's "Parameter history and configuration audit trail". */
  history: Panel<{ id: string; field: string; previous: unknown; next: unknown; reason: string; actorId: string | null; occurredAt: string }>;
  today: string;
  counts: {
    inPlan: number | null; routine: number | null; safetyRequired: number | null;
    overdue: number | null; dueToday: number | null; breached: number | null; notChecked: number | null;
    openAlerts: number | null;
  };
};

const emptyPlanCounts = () => ({
  inPlan: null, routine: null, safetyRequired: null, overdue: null, dueToday: null,
  breached: null, notChecked: null, openAlerts: null,
});

/** The practice's own today, taken from the caller so the harness can pin it. */
// ⚠ todayIso() USED TO LIVE HERE TOO, and failed the same way: `options?.today ?? todayIso()` on the
// two read functions, with every page and API caller omitting `options`. See medication.ts for the
// full account. Deleted rather than corrected, for the same reason.

export async function monitoringPlan(
  admin: any, ctx: WorkspaceContext, patientId: string,
  options?: {
    today?: string;
    /**
     * Definitions to include even though this patient has no plan row and the practice has no
     * practice-scope activation for them.
     *
     * ⚠ THIS EXISTS FOR LCP s4's ENCOUNTER OVERRIDE AND IT IS NOT A CONVENIENCE. s4: "Encounter
     * override | Adds a one-off parameter for a specific review. | Postural BP today only." A postural
     * BP the practice does NOT routinely collect is precisely the case, and without this the plan set is
     * (plan rows + practice activations) -- so the one-off would be written, audited, and then not
     * appear on the form it was added to. Found by a deliberate break whose fixture used a parameter
     * that happened to be practice-active, which made the assertion pass for the wrong reason.
     */
    includeDefinitionIds?: string[];
  },
): Promise<MonitoringPlan> {
  const today = options?.today ?? practiceToday(ctx.workspaceTimezone);
  const blank = (permitted: boolean, detail: string | null): MonitoringPlan => ({
    permitted,
    canRecord: permitted && hasCapability(ctx, CAP_RECORD),
    canConfigure: permitted && hasCapability(ctx, CAP_CONFIGURE),
    all: permitted ? (detail ? failed(detail) : loaded([])) : denied(),
    routine: [], safetyRequired: [], overdue: [], dueToday: [], breached: [], notChecked: [],
    alerts: permitted ? (detail ? failed(detail) : loaded([])) : denied(),
    history: permitted ? (detail ? failed(detail) : loaded([])) : denied(),
    today, counts: emptyPlanCounts(),
  });
  if (!hasCapability(ctx, CAP_VIEW)) return blank(false, null);

  const [defRes, actRes, planRes, measRes, derRes, alertRes, histRes] = await Promise.all([
    admin.from("practice_parameter_definition")
      .select("id, workspace_id, code, display_name, short_name, category, data_type, canonical_unit, permitted_units, min_plausible, max_plausible, default_collection_rule, status")
      .or(`workspace_id.is.null,workspace_id.eq.${ctx.workspaceId}`),
    admin.from("practice_parameter_activation")
      .select("id, definition_id, pack_id, pack_version, scope, scope_id, state, collection_rule, local_label, visibility, threshold_override")
      .eq("workspace_id", ctx.workspaceId),
    admin.from("practice_patient_monitoring_plan")
      .select("*").eq("workspace_id", ctx.workspaceId).eq("patient_id", patientId),
    admin.from("practice_parameter_measurement")
      .select("id, definition_id, value_numeric, value_text, value_boolean, value_date, value_choice, unit, canonical_value, canonical_unit, source, effective_at, recorded_at, note, status, amends_measurement_id")
      .eq("workspace_id", ctx.workspaceId).eq("patient_id", patientId)
      .order("effective_at", { ascending: false }).limit(500),
    admin.from("practice_parameter_derived")
      .select("id, definition_id, value, unit, formula, source_measurement_ids, calculated_at")
      .eq("workspace_id", ctx.workspaceId).eq("patient_id", patientId)
      .order("calculated_at", { ascending: false }).limit(200),
    admin.from("practice_parameter_alert")
      .select("id, definition_id, measurement_id, alert_type, severity, rationale, recommended_action, status, raised_at")
      .eq("workspace_id", ctx.workspaceId).eq("patient_id", patientId)
      .eq("status", "open").order("raised_at", { ascending: false }).limit(100),
    admin.from("practice_patient_monitoring_plan_event")
      .select("id, field, previous_value, new_value, reason, actor_id, occurred_at")
      .eq("workspace_id", ctx.workspaceId).eq("patient_id", patientId)
      .order("occurred_at", { ascending: false }).limit(50),
  ]);

  // ⚠ THE DEFINITIONS OR THE PLAN FAILING IS THE WHOLE PANEL FAILING. Rendering the rest would be a
  // monitoring plan that looks complete and is not, which is worse than one that says it cannot be read.
  if (defRes.error) return blank(true, `the parameter library could not be read: ${defRes.error.message}`);
  if (planRes.error) return blank(true, `this patient's monitoring plan could not be read: ${planRes.error.message}`);

  const defs = (defRes.data ?? []) as any[];
  const byId = new Map<string, any>(defs.map(d => [d.id, d]));
  const activations = actRes.error ? null : readActivations((actRes.data ?? []) as any[]);
  const activationsUnavailable = !!actRes.error;
  const plans = (planRes.data ?? []) as any[];

  const measurements = measRes.error ? null : ((measRes.data ?? []) as any[]);
  const measurementsUnavailable = !!measRes.error;
  const amended = new Set<string>(
    (measurements ?? []).map(m => m.amends_measurement_id).filter(Boolean) as string[]);
  const derived = derRes.error ? null : ((derRes.data ?? []) as any[]);

  // Which parameters are in this patient's world at all: everything with a plan row, plus everything
  // the practice has activated.
  const activeAtPractice = (activations ?? []).filter(a => a.state === "active");
  const definitionIds = new Set<string>([
    ...plans.map(p => p.definition_id as string),
    ...activeAtPractice.map(a => a.definitionId),
    ...(options?.includeDefinitionIds ?? []),
  ]);

  const entryFor = (definitionId: string): PlanEntry | null => {
    const d = byId.get(definitionId);
    if (!d) return null;
    const plan = plans.find(p => p.definition_id === definitionId) ?? null;
    const act = resolveActivation(activations ?? [], definitionId, {});
    const practiceThreshold = act ? boundsOf(act.thresholdOverride) : null;
    const target = plan && (plan.target_low !== null || plan.target_high !== null)
      ? { low: plan.target_low, high: plan.target_high } : null;

    const mine = (measurements ?? [])
      .filter(m => m.definition_id === definitionId && m.status === "active");
    const latestRow = mine[0] ?? null;
    const derivedRow = (derived ?? []).find(x => x.definition_id === definitionId) ?? null;

    const numeric = latestRow?.canonical_value ?? latestRow?.value_numeric ?? null;
    const displayValue = latestRow ? formatValue(latestRow) : (derivedRow ? `${derivedRow.value}` : null);
    const isCalculated = !latestRow && !!derivedRow;

    const state: string = plan?.state ?? "inherited";
    const safetyRequired = plan?.safety_required === true;
    const outOfRoutine = (STATES_OUT_OF_ROUTINE_VIEW as readonly string[]).includes(state);

    const changeRule = (plan?.change_rule ?? {}) as Record<string, unknown>;
    const improving = changeRule.improving_direction;

    return {
      definitionId, code: d.code,
      label: plan?.local_label ?? act?.localLabel ?? d.display_name,
      category: d.category, dataType: d.data_type,
      canonicalUnit: d.canonical_unit ?? null, permittedUnits: (d.permitted_units ?? []) as string[],
      planId: plan?.id ?? null,
      state, stateMeaning: PLAN_STATE_MEANING[state] ?? "",
      inheritedFrom: plan
        ? "Patient Monitoring Plan"
        : act ? (act.packId ? "Clinic pack" : "Practitioner default") : "Platform library",
      schedule: plan?.schedule ?? null,
      scheduleLabel: plan?.schedule ? (PLAN_SCHEDULE_LABEL[plan.schedule] ?? plan.schedule) : null,
      collectionRule: plan ? null : (act?.collectionRule ?? d.default_collection_rule),
      target, practiceThreshold,
      baselineValue: plan?.baseline_value ?? null,
      baselineMeasuredAt: plan?.baseline_measured_at ?? null,
      improvingDirection: improving === "up" || improving === "down" ? improving : null,
      triggerSource: plan?.trigger_source ?? "practitioner",
      reason: plan?.reason ?? null,
      safetyRequired,
      safetyRequiredReason: plan?.safety_required_reason ?? null,
      safetyOverrideReason: plan?.safety_override_reason ?? null,
      resurfacedForSafety: outOfRoutine && safetyRequired,
      latest: latestRow ? {
        id: latestRow.id, value: displayValue ?? "", canonicalValue: latestRow.canonical_value ?? null,
        unit: latestRow.canonical_unit ?? latestRow.unit ?? null,
        source: latestRow.source, effectiveAt: latestRow.effective_at, recordedAt: latestRow.recorded_at,
        note: latestRow.note ?? null,
        amendedByLaterRow: amended.has(latestRow.id),
      } : null,
      value: valueLine({
        text: displayValue, source: latestRow?.source ?? null, calculated: isCalculated,
        permitted: true, unavailable: measurementsUnavailable,
      }),
      threshold: thresholdLine({
        value: numeric, unit: d.canonical_unit ?? null,
        target, practiceThreshold,
        unavailable: activationsUnavailable || measurementsUnavailable,
      }),
      plausibility: plausibilityLine({
        value: numeric, unit: d.canonical_unit ?? null,
        min: d.min_plausible ?? null, max: d.max_plausible ?? null,
      }),
      due: dueLine({
        schedule: plan?.schedule ?? null, nextDueOn: plan?.next_due_on ?? null,
        today, unavailable: false,
      }),
      lastMeasuredAt: latestRow?.effective_at ?? plan?.last_measured_at ?? null,
      measurementCount: mine.length,
      derived: derivedRow ? {
        id: derivedRow.id, value: derivedRow.value, unit: derivedRow.unit ?? null,
        formula: derivedRow.formula,
        sourceMeasurementIds: (derivedRow.source_measurement_ids ?? []) as string[],
        calculatedAt: derivedRow.calculated_at,
      } : null,
      openAlerts: alertRes.error ? 0 : ((alertRes.data ?? []) as any[]).filter(a => a.definition_id === definitionId).length,
    };
  };

  const entries = [...definitionIds].map(entryFor).filter((e): e is PlanEntry => e !== null)
    .sort((a, b) => a.category.localeCompare(b.category) || a.label.localeCompare(b.label));

  // ⚠ THE TWO LISTS LCP s9 KEEPS APART.
  //
  // `routine` drops paused, resolved and hidden -- s7's own words for those three are "Temporarily
  // excluded", "No longer routinely collected" and "Removed from routine views".
  //
  // `safetyRequired` reads the OTHER COLUMN, and does not consult state at all. A hidden weight with
  // safety_required true is absent from the first list and present in the second, which is the entire
  // content of "Patient-level hiding of weight must not suppress a medication-triggered safety
  // requirement." Collapsing them into one flag would make that sentence unenforceable.
  const routine = entries.filter(e =>
    !(STATES_OUT_OF_ROUTINE_VIEW as readonly string[]).includes(e.state));
  const safetyRequired = entries.filter(e => e.safetyRequired);

  const overdue = entries.filter(e => e.due.state === "overdue");
  const dueToday = entries.filter(e => e.due.state === "due_today");
  const breached = entries.filter(e => e.threshold.state === "breached");
  const notChecked = entries.filter(e => e.threshold.state === "not_checked");

  type PlanAlert = MonitoringPlan["alerts"]["items"][number];
  type PlanHistory = MonitoringPlan["history"]["items"][number];
  const alerts: Panel<PlanAlert> = alertRes.error
    ? failed<PlanAlert>(`this patient's alerts could not be read: ${alertRes.error.message}`)
    : loaded(((alertRes.data ?? []) as any[]).map(a => {
      const d = byId.get(a.definition_id);
      return {
        id: a.id, definitionId: a.definition_id, code: d?.code ?? "unknown",
        label: d?.display_name ?? "Unknown parameter",
        alertType: a.alert_type, severity: a.severity ?? null,
        // ⚠ A NULL SEVERITY RENDERS AS "NOT CLASSIFIED" AND NEVER AS THE LOWEST LEVEL.
        severityLabel: a.severity
          ? (ALERT_SEVERITY_LABEL[a.severity] ?? a.severity)
          : UNCLASSIFIED_SEVERITY_LABEL,
        rationale: a.rationale, recommendedAction: a.recommended_action ?? null,
        status: a.status, raisedAt: a.raised_at, measurementId: a.measurement_id ?? null,
      };
    }));

  const history: Panel<PlanHistory> = histRes.error
    ? failed<PlanHistory>(`the configuration history could not be read: ${histRes.error.message}`)
    : loaded(((histRes.data ?? []) as any[]).map(h => ({
      id: h.id, field: h.field, previous: h.previous_value, next: h.new_value,
      reason: h.reason, actorId: h.actor_id ?? null, occurredAt: h.occurred_at,
    })));

  return {
    permitted: true,
    canRecord: hasCapability(ctx, CAP_RECORD),
    canConfigure: hasCapability(ctx, CAP_CONFIGURE),
    all: loaded(entries),
    routine, safetyRequired, overdue, dueToday, breached, notChecked,
    alerts, history, today,
    counts: {
      inPlan: entries.length, routine: routine.length, safetyRequired: safetyRequired.length,
      overdue: overdue.length, dueToday: dueToday.length, breached: breached.length,
      notChecked: notChecked.length,
      openAlerts: alertRes.error ? null : alerts.items.length,
    },
  };
}

/** One measurement rendered as text, whichever of the five value columns holds it. */
function formatValue(m: any): string {
  if (m.value_numeric !== null && m.value_numeric !== undefined)
    return `${m.canonical_value ?? m.value_numeric} ${m.canonical_unit ?? m.unit ?? ""}`.trim();
  if (m.value_boolean !== null && m.value_boolean !== undefined) return m.value_boolean ? "Yes" : "No";
  if (m.value_date) return String(m.value_date);
  if (Array.isArray(m.value_choice) && m.value_choice.length > 0) return m.value_choice.join(", ");
  if (m.value_text) return String(m.value_text);
  return "";
}

// ── s10.2 WRITES ─────────────────────────────────────────────────────────────────────────────────────

export type PlanInput = {
  patientId: string;
  definitionId: string;
  state?: string;
  schedule?: string | null;
  untilDate?: string | null;
  encountersRemaining?: number | null;
  pausedUntil?: string | null;
  targetLow?: number | null;
  targetHigh?: number | null;
  /** The direction a practitioner agrees is better, IN ADVANCE. See trendLine. */
  improvingDirection?: "up" | "down" | null;
  triggerSource?: string;
  triggerRef?: string | null;
  /** LCP s11: "Patient-specific configuration changes record user, date, previous value, new value and reason." */
  reason: string;
  actorId: string;
  correlationId: string;
};

/**
 * LCP s13: "A parameter can be added to one patient without affecting any other patient." This function
 * is that sentence: it writes one row keyed on (patient_id, definition_id) and touches nothing else.
 *
 * ⚠ EVERY CHANGE WRITES AN EVENT WITH ITS PREVIOUS VALUE, ITS NEW VALUE AND A REASON. s11 asks for all
 * five and the event table's `reason` is NOT NULL, so an unexplained change is refused by the database
 * rather than by this function remembering.
 *
 * ⚠ A SAFETY-REQUIRED PARAMETER CANNOT BE QUIETLY PAUSED, RESOLVED OR HIDDEN. s11: "Safety-related
 * parameters require an authorised override and reason when deactivated or bypassed." Migration 246's
 * constraint refuses the row; this refuses the request with a sentence, and takes the override reason
 * and the person as separate, named inputs -- see overrideSafetyRequirement.
 */
export async function upsertPlanEntry(
  admin: any, ctx: WorkspaceContext, input: PlanInput,
): Promise<EngineResult<{ id: string; state: string; nextDueOn: string | null }>> {
  if (!hasCapability(ctx, CAP_CONFIGURE))
    return fail(403, "FORBIDDEN", "changing what is monitored for a patient needs parameter.configure");

  const reason = trim(input.reason);
  if (!reason) return fail(422, "VALIDATION_ERROR", "a configuration change with no reason is a change nobody can review");

  const state = input.state ?? "active";
  if (!PLAN_STATE_CODES.includes(state))
    return fail(422, "VALIDATION_ERROR", `${state} is not one of LCP s7's eight patient-level states`);
  if (input.schedule && !PLAN_SCHEDULE_CODES.includes(input.schedule))
    return fail(422, "VALIDATION_ERROR", `${input.schedule} is not one of LCP s7.1's fourteen schedules`);
  if (input.triggerSource && !TRIGGER_SOURCE_CODES.includes(input.triggerSource))
    return fail(422, "VALIDATION_ERROR", `${input.triggerSource} is not a trigger source LCP s7 names`);
  if (input.schedule === "until_date" && !input.untilDate)
    return fail(422, "VALIDATION_ERROR", "an \"until a specified date\" schedule needs the date, or it is never due and never late");
  if (input.schedule === "for_n_encounters" && !(typeof input.encountersRemaining === "number" && input.encountersRemaining > 0))
    return fail(422, "VALIDATION_ERROR", "a \"for N encounters\" schedule needs N, or it is never due and never late");
  if (input.targetLow != null && input.targetHigh != null && input.targetLow > input.targetHigh)
    return fail(422, "VALIDATION_ERROR", "the target window is the wrong way round");
  if (input.improvingDirection && input.improvingDirection !== "up" && input.improvingDirection !== "down")
    return fail(422, "VALIDATION_ERROR", "the improving direction is up or down");

  const { data: patient, error: pErr } = await admin.from("practice_patient")
    .select("id").eq("id", input.patientId).eq("workspace_id", ctx.workspaceId).maybeSingle();
  if (pErr) return fail(503, "UNAVAILABLE", `the patient could not be read: ${pErr.message}`);
  if (!patient) return fail(404, "NOT_FOUND", "no such patient");

  const { data: def, error: dErr } = await admin.from("practice_parameter_definition")
    .select("id, workspace_id, code, status").eq("id", input.definitionId).maybeSingle();
  if (dErr) return fail(503, "UNAVAILABLE", `the parameter could not be read: ${dErr.message}`);
  if (!def || (def.workspace_id !== null && def.workspace_id !== ctx.workspaceId))
    return fail(404, "NOT_FOUND", "no such parameter");

  const { data: existing, error: eErr } = await admin.from("practice_patient_monitoring_plan")
    .select("*").eq("workspace_id", ctx.workspaceId).eq("patient_id", input.patientId).eq("definition_id", def.id).maybeSingle();
  if (eErr) return fail(503, "UNAVAILABLE", `the existing plan row could not be read: ${eErr.message}`);

  // ⚠ s11's override rule, refused HERE with a sentence rather than left to the constraint.
  if (existing?.safety_required === true
    && (STATES_OUT_OF_ROUTINE_VIEW as readonly string[]).includes(state)
    && !trim(existing.safety_override_reason)) {
    return fail(422, "SAFETY_OVERRIDE_REQUIRED",
      `this parameter is required for safety (${existing.safety_required_reason ?? "no reason recorded"}). Pausing, resolving or hiding it needs an authorised override with a written reason.`);
  }

  // ⚠ THIS DATE DECIDES WHEN SOMEBODY IS CHASED FOR A BLOOD TEST, and BOTH branches were the
  // server's day: one sliced a UTC timestamp, the other called todayIso(). In a practice three hours
  // ahead of UTC an evening entry set next_due_on a day early, so the plan asked for a repeat before
  // the interval it states had actually elapsed.
  const planTz = ctx.workspaceTimezone;
  const planToday = practiceToday(planTz);
  const nextDueOn = computeNextDue({
    schedule: input.schedule ?? null,
    from: practiceDayOf(planTz, existing?.last_measured_at) ?? planToday,
    untilDate: input.untilDate ?? null,
  });

  const row: Record<string, unknown> = {
    workspace_id: ctx.workspaceId, patient_id: input.patientId, definition_id: def.id,
    state,
    schedule: input.schedule ?? null,
    until_date: input.untilDate ?? null,
    encounters_remaining: input.encountersRemaining ?? null,
    paused_until: input.pausedUntil ?? null,
    target_low: input.targetLow ?? null, target_high: input.targetHigh ?? null,
    change_rule: input.improvingDirection ? { improving_direction: input.improvingDirection } : {},
    next_due_on: nextDueOn,
    trigger_source: input.triggerSource ?? "practitioner",
    trigger_ref: input.triggerRef ?? null,
    reason,
    updated_at: new Date().toISOString(), updated_by: input.actorId,
  };
  if (!existing) row.created_by = input.actorId;
  // ⚠ THE SAFETY FIELDS ARE NEVER TOUCHED HERE. They are set and lifted by their own functions, which
  // take a named person and a written reason. A routine plan edit that could clear safety_required
  // would be exactly the bypass s11 forbids.

  const { data, error } = await admin.from("practice_patient_monitoring_plan")
    .upsert(row, { onConflict: "patient_id,definition_id" })
    .select("id, state, next_due_on").single();
  if (error) return fail(500, "WRITE_FAILED", `the monitoring plan could not be saved: ${error.message}`);

  const changes: { field: string; previous: unknown; next: unknown }[] = [];
  const compare = (field: string, before: unknown, after: unknown) => {
    if (JSON.stringify(before ?? null) !== JSON.stringify(after ?? null))
      changes.push({ field, previous: before ?? null, next: after ?? null });
  };
  compare("state", existing?.state ?? null, state);
  compare("schedule", existing?.schedule ?? null, input.schedule ?? null);
  compare("target_low", existing?.target_low ?? null, input.targetLow ?? null);
  compare("target_high", existing?.target_high ?? null, input.targetHigh ?? null);
  compare("next_due_on", existing?.next_due_on ?? null, nextDueOn);
  compare("improving_direction",
    (existing?.change_rule as Record<string, unknown> | undefined)?.improving_direction ?? null,
    input.improvingDirection ?? null);
  if (changes.length === 0) changes.push({ field: "reviewed", previous: null, next: state });

  const { error: evErr } = await admin.from("practice_patient_monitoring_plan_event").insert(
    changes.map(c => ({
      workspace_id: ctx.workspaceId, plan_id: data.id, patient_id: input.patientId,
      field: c.field, previous_value: c.previous, new_value: c.next,
      reason, actor_id: input.actorId,
    })));
  if (evErr) return fail(500, "AUDIT_FAILED", `the change was saved without its audit entry: ${evErr.message}`);

  await audit(admin, {
    workspaceId: ctx.workspaceId, actorId: input.actorId, eventType: "practice.monitoring_plan.changed",
    payload: { patientId: input.patientId, definitionId: def.id, code: def.code, state, changes: changes.map(c => c.field), reason },
    correlationId: input.correlationId,
  });
  return { ok: true, data: { id: data.id, state: data.state, nextDueOn: data.next_due_on ?? null } };
}

/**
 * ⚠ THE OTHER HALF OF LCP s9, AND IT IS A SEPARATE FUNCTION ON PURPOSE.
 *
 * A safety requirement is set by whatever NEEDS the parameter -- a medication, a diagnosis, a protocol --
 * and it is not something a routine plan edit may set or clear. The row it writes may sit on a plan that
 * is hidden: migration 246 s6 calls that "a legal and meaningful arrangement", because routine views
 * stop offering the parameter and the dose path still demands it.
 */
export async function requireForSafety(
  admin: any, ctx: WorkspaceContext,
  input: {
    patientId: string; definitionId: string; reason: string;
    triggerSource?: "medication" | "diagnosis" | "protocol"; triggerRef?: string | null;
    actorId: string; correlationId: string;
  },
): Promise<EngineResult<{ id: string; state: string; safetyRequired: boolean; resurfaced: boolean }>> {
  if (!hasCapability(ctx, CAP_CONFIGURE))
    return fail(403, "FORBIDDEN", "requiring a parameter for safety needs parameter.configure");
  const reason = trim(input.reason);
  if (!reason) return fail(422, "VALIDATION_ERROR", "a safety requirement that says nothing is one nobody can review or lift");

  const { data: def, error: dErr } = await admin.from("practice_parameter_definition")
    .select("id, workspace_id, code").eq("id", input.definitionId).maybeSingle();
  if (dErr) return fail(503, "UNAVAILABLE", `the parameter could not be read: ${dErr.message}`);
  if (!def || (def.workspace_id !== null && def.workspace_id !== ctx.workspaceId))
    return fail(404, "NOT_FOUND", "no such parameter");

  const { data: patient, error: pErr } = await admin.from("practice_patient")
    .select("id").eq("id", input.patientId).eq("workspace_id", ctx.workspaceId).maybeSingle();
  if (pErr) return fail(503, "UNAVAILABLE", `the patient could not be read: ${pErr.message}`);
  if (!patient) return fail(404, "NOT_FOUND", "no such patient");

  const { data: existing } = await admin.from("practice_patient_monitoring_plan")
    .select("*").eq("workspace_id", ctx.workspaceId).eq("patient_id", input.patientId).eq("definition_id", def.id).maybeSingle();

  // ⚠ THE STATE IS NOT CHANGED. A hidden parameter stays hidden -- s7's "Removed from routine views" is
  // a decision somebody made -- and safety_required is set beside it. Forcing the state back to
  // `required` would overwrite a clinical decision, and it would also make s9's sentence untestable:
  // there would be no hidden row left to prove the safety flag re-surfaces.
  const state = existing?.state ?? "conditionally_required";
  const row: Record<string, unknown> = {
    workspace_id: ctx.workspaceId, patient_id: input.patientId, definition_id: def.id,
    state,
    trigger_source: input.triggerSource ?? "medication",
    trigger_ref: input.triggerRef ?? null,
    safety_required: true, safety_required_reason: reason,
    reason: existing?.reason ?? reason,
    updated_at: new Date().toISOString(), updated_by: input.actorId,
  };
  if (!existing) row.created_by = input.actorId;
  // The database refuses a safety-required row in paused/resolved/hidden without an override reason AND
  // an overriding person. Where the plan is already in one of those states, the requirement is recorded
  // WITH the existing override carried forward -- otherwise the write fails and the safety requirement
  // is silently lost, which is the failure this whole function exists to prevent.
  if ((STATES_OUT_OF_ROUTINE_VIEW as readonly string[]).includes(state)) {
    row.safety_override_reason = trim(existing?.safety_override_reason)
      || `Parameter was ${state} before this safety requirement was raised; the requirement stands and the routine view remains ${state}.`;
    row.safety_overridden_by = existing?.safety_overridden_by ?? input.actorId;
    row.safety_overridden_at = existing?.safety_overridden_at ?? new Date().toISOString();
  }

  const { data, error } = await admin.from("practice_patient_monitoring_plan")
    .upsert(row, { onConflict: "patient_id,definition_id" })
    .select("id, state, safety_required").single();
  if (error) return fail(500, "WRITE_FAILED", `the safety requirement could not be saved: ${error.message}`);

  const { error: evErr } = await admin.from("practice_patient_monitoring_plan_event").insert({
    workspace_id: ctx.workspaceId, plan_id: data.id, patient_id: input.patientId,
    field: "safety_required", previous_value: existing?.safety_required ?? false, new_value: true,
    reason, actor_id: input.actorId,
  });
  if (evErr) return fail(500, "AUDIT_FAILED", `the safety requirement was saved without its audit entry: ${evErr.message}`);

  await audit(admin, {
    workspaceId: ctx.workspaceId, actorId: input.actorId, eventType: "practice.monitoring_plan.safety_required",
    payload: { patientId: input.patientId, definitionId: def.id, code: def.code, state, reason, triggerSource: input.triggerSource ?? "medication" },
    correlationId: input.correlationId,
  });
  return {
    ok: true,
    data: {
      id: data.id, state: data.state, safetyRequired: data.safety_required === true,
      resurfaced: (STATES_OUT_OF_ROUTINE_VIEW as readonly string[]).includes(data.state) && data.safety_required === true,
    },
  };
}

/**
 * LCP s10.2's "Restore inherited defaults action".
 *
 * ⚠ THE PLAN ROW GOES BACK TO `inherited`; IT IS NOT DELETED. Deleting it would lose s11's audit trail
 * for this patient, and the trail is the thing that makes a patient-specific override reviewable.
 *
 * ⚠ AND A SAFETY REQUIREMENT IS NOT LIFTED BY RESTORING DEFAULTS. It was raised by something outside
 * this panel and is lifted by whatever raised it.
 */
export async function restoreInherited(
  admin: any, ctx: WorkspaceContext,
  input: { patientId: string; definitionId: string; reason: string; actorId: string; correlationId: string },
): Promise<EngineResult<{ id: string; state: string; safetyRequirementKept: boolean }>> {
  if (!hasCapability(ctx, CAP_CONFIGURE))
    return fail(403, "FORBIDDEN", "restoring inherited defaults needs parameter.configure");
  const reason = trim(input.reason);
  if (!reason) return fail(422, "VALIDATION_ERROR", "a configuration change with no reason is a change nobody can review");

  const { data: existing, error } = await admin.from("practice_patient_monitoring_plan")
    .select("*").eq("workspace_id", ctx.workspaceId)
    .eq("patient_id", input.patientId).eq("definition_id", input.definitionId).maybeSingle();
  if (error) return fail(503, "UNAVAILABLE", `the plan row could not be read: ${error.message}`);
  if (!existing) return fail(404, "NOT_FOUND", "this patient has no override for that parameter, so there is nothing to restore");

  const { data, error: upErr } = await admin.from("practice_patient_monitoring_plan")
    .update({
      state: "inherited", schedule: null, until_date: null, encounters_remaining: null,
      paused_until: null, target_low: null, target_high: null, change_rule: {},
      next_due_on: null, reason,
      updated_at: new Date().toISOString(), updated_by: input.actorId,
    })
    .eq("id", existing.id).eq("workspace_id", ctx.workspaceId)
    .select("id, state, safety_required").single();
  if (upErr) return fail(500, "WRITE_FAILED", `the defaults could not be restored: ${upErr.message}`);

  const { error: evErr } = await admin.from("practice_patient_monitoring_plan_event").insert({
    workspace_id: ctx.workspaceId, plan_id: existing.id, patient_id: input.patientId,
    field: "restored_to_inherited",
    previous_value: { state: existing.state, schedule: existing.schedule, target_low: existing.target_low, target_high: existing.target_high },
    new_value: { state: "inherited" }, reason, actor_id: input.actorId,
  });
  if (evErr) return fail(500, "AUDIT_FAILED", `the restore was saved without its audit entry: ${evErr.message}`);

  await audit(admin, {
    workspaceId: ctx.workspaceId, actorId: input.actorId, eventType: "practice.monitoring_plan.restored",
    payload: { patientId: input.patientId, definitionId: input.definitionId, reason },
    correlationId: input.correlationId,
  });
  return { ok: true, data: { id: data.id, state: data.state, safetyRequirementKept: data.safety_required === true } };
}

/**
 * s7.1's calendar schedules turned into a date.
 *
 * ⚠ AN EVENT-DRIVEN SCHEDULE GETS NULL AND NOT A GUESS. `every_encounter`, `next_visit`,
 * `for_n_encounters`, `until_resolved`, `every_follow_up`, `first_visit_only` and `on_request` are
 * triggered by something happening, not by a date arriving. Inventing a date for them would put a
 * parameter on the overdue list on a day nobody promised anything.
 */
export function computeNextDue(input: { schedule: string | null; from: string; untilDate?: string | null }): string | null {
  if (!input.schedule) return null;
  const days = SCHEDULE_INTERVAL_DAYS[input.schedule];
  if (typeof days !== "number") return null;
  const next = new Date(`${input.from}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + days);
  const iso = next.toISOString().slice(0, 10);
  // "Until a specified date" stops being due once the date passes.
  if (input.untilDate && iso > input.untilDate) return null;
  return iso;
}

// ────────────────────────────────────────────────────────────────────────────────────────────────────
// s8 -- THE COLLECTION WORKFLOW
// ────────────────────────────────────────────────────────────────────────────────────────────────────

export type MeasurementInput = {
  patientId: string;
  definitionId: string;
  encounterId?: string | null;
  value: number | string | boolean | string[] | null;
  unit?: string | null;
  method?: string | null;
  source?: string;
  effectiveAt?: string | null;
  note?: string | null;
  /** LCP s12: a correction is a NEW ROW naming the one it corrects. */
  amendsMeasurementId?: string | null;
  amendmentReason?: string | null;
  /** A retraction: the same act with no replacement value. */
  enteredInError?: boolean;
  actorId: string;
  correlationId: string;
};

export type MeasurementResult = {
  id: string;
  canonicalValue: number | null;
  canonicalUnit: string | null;
  definitionVersionId: string | null;
  plausibility: PlausibilityVerdict;
  threshold: ThresholdVerdict;
  /** LCP s13: what was calculated FROM this, with its formula and its sources. */
  derived: { id: string; code: string; value: number; unit: string | null; formula: string; sourceMeasurementIds: string[] }[];
  alertsRaised: { id: string; alertType: string; severity: string | null; rationale: string }[];
};

/**
 * LCP s8's eight steps, in order, for one value.
 *
 * ⚠ INSERT ONLY. Migration 246 s8: "THIS TABLE IS INSERT ONLY. NO updated_at, AND NOTHING MAY UPDATE
 * IT." A correction is a new row naming the old one in amends_measurement_id; the old row is never
 * touched, so a dose calculated from it in March still cites a value that still exists and still reads
 * the same. LCP s9: "A later weight update must not recalculate or rewrite a historical prescription."
 *
 * ⚠ AND NOTHING HERE READS A PRIOR MEASUREMENT'S VALUE INTO A NEW ROW. LCP s10.3: "One-click
 * carry-forward is prohibited for measured values." The value comes from the caller, always. The
 * derivation below reads OTHER parameters' latest measurements to compute BMI -- which is a calculation
 * over cited rows, recorded as calculated, not a measurement copied forward.
 *
 * ⚠ PLAUSIBILITY WARNS, IT DOES NOT REFUSE. Migration 246 s1: "a refused measurement is a measurement
 * nobody records, and a 3 kg adult is a typing error worth a warning, not a locked form."
 */
export async function recordMeasurement(
  admin: any, ctx: WorkspaceContext, input: MeasurementInput,
): Promise<EngineResult<MeasurementResult>> {
  if (!hasCapability(ctx, CAP_RECORD))
    return fail(403, "FORBIDDEN", "recording a measurement needs parameter.record");

  const source = input.source ?? "practitioner";
  if (!MEASUREMENT_SOURCE_CODES.includes(source))
    return fail(422, "VALIDATION_ERROR", `${source} is not one of LCP s12's five sources`);

  const { data: patient, error: pErr } = await admin.from("practice_patient")
    .select("id").eq("id", input.patientId).eq("workspace_id", ctx.workspaceId).maybeSingle();
  if (pErr) return fail(503, "UNAVAILABLE", `the patient could not be read: ${pErr.message}`);
  if (!patient) return fail(404, "NOT_FOUND", "no such patient");

  const { data: def, error: dErr } = await admin.from("practice_parameter_definition")
    .select("id, workspace_id, code, display_name, data_type, canonical_unit, permitted_units, unit_conversions, min_plausible, max_plausible, status, version")
    .eq("id", input.definitionId).maybeSingle();
  if (dErr) return fail(503, "UNAVAILABLE", `the parameter could not be read: ${dErr.message}`);
  if (!def || (def.workspace_id !== null && def.workspace_id !== ctx.workspaceId))
    return fail(404, "NOT_FOUND", "no such parameter");
  // A retired parameter keeps its history and stops being collected. LCP s2.2, s13.
  if (def.status === "retired" && !input.enteredInError)
    return fail(422, "RETIRED", "this parameter has been retired; its history remains and new values are not collected");
  // A CALCULATED PARAMETER IS NOT MEASURED. It is derived from other rows, with its formula and its
  // sources on the row. Accepting a typed BMI would put a number in the series that nothing can check.
  if (def.data_type === "calculated" && !input.enteredInError)
    return fail(422, "CALCULATED_PARAMETER", `${def.display_name} is calculated from other measurements and is not recorded directly`);

  if (input.amendsMeasurementId) {
    const reason = trim(input.amendmentReason);
    if (!reason) return fail(422, "VALIDATION_ERROR", "a correction names what it corrects and says why");
    const { data: prior, error: aErr } = await admin.from("practice_parameter_measurement")
      .select("id, patient_id, definition_id").eq("id", input.amendsMeasurementId)
      .eq("workspace_id", ctx.workspaceId).maybeSingle();
    if (aErr) return fail(503, "UNAVAILABLE", `the measurement being corrected could not be read: ${aErr.message}`);
    if (!prior) return fail(404, "NOT_FOUND", "no such measurement to correct");
    if (prior.patient_id !== input.patientId || prior.definition_id !== def.id)
      return fail(422, "VALIDATION_ERROR", "a correction has to be of the same parameter for the same patient");
  }
  if (input.enteredInError && !input.amendsMeasurementId)
    return fail(422, "VALIDATION_ERROR", "a retraction names the measurement it retracts");

  // ── The five value columns ────────────────────────────────────────────────────────────────────────
  const row: Record<string, unknown> = {
    workspace_id: ctx.workspaceId, patient_id: input.patientId, definition_id: def.id,
    encounter_id: input.encounterId ?? null,
    source, method: input.method ? trim(input.method) : null,
    effective_at: input.effectiveAt ?? new Date().toISOString(),
    recorded_at: new Date().toISOString(),
    note: input.note ? trim(input.note).slice(0, 1000) : null,
    status: input.enteredInError ? "entered_in_error" : "active",
    amends_measurement_id: input.amendsMeasurementId ?? null,
    amendment_reason: input.amendmentReason ? trim(input.amendmentReason) : null,
    created_by: input.actorId,
  };

  let canonicalValue: number | null = null;
  let canonicalUnit: string | null = null;

  if (!input.enteredInError) {
    if (input.value === null || input.value === undefined || input.value === "")
      return fail(422, "VALIDATION_ERROR", "a measurement needs a value");

    if (def.data_type === "decimal" || def.data_type === "integer") {
      const n = typeof input.value === "number" ? input.value : Number(String(input.value).trim());
      if (!Number.isFinite(n)) return fail(422, "VALIDATION_ERROR", `${input.value} is not a number`);
      if (def.data_type === "integer" && !Number.isInteger(n))
        return fail(422, "VALIDATION_ERROR", `${def.display_name} is recorded as a whole number`);
      // ⚠ A NUMBER WITH NO UNIT IS THE ONE THAT KILLS SOMEBODY. 70 is a reasonable weight in kilograms
      // and a reasonable weight in pounds, and a dose from the wrong one is out by a factor of two. The
      // database demands the unit on any numeric row; this demands a unit it can actually convert.
      const unit = trim(input.unit) || def.canonical_unit;
      if (!unit) return fail(422, "UNIT_REQUIRED", "a numeric measurement needs its unit");
      const permitted = (def.permitted_units ?? []) as string[];
      if (permitted.length > 0 && !permitted.includes(unit))
        return fail(422, "UNIT_NOT_PERMITTED", `${def.display_name} is recorded in ${permitted.join(", ")}, not ${unit}`);
      const conv = toCanonical({
        value: n, unit, canonicalUnit: def.canonical_unit,
        conversions: (def.unit_conversions ?? {}) as Record<string, number>,
      });
      if (!conv.ok) return fail(422, "UNIT_NOT_CONVERTIBLE", conv.message);
      row.value_numeric = n; row.unit = unit;
      row.canonical_value = conv.value; row.canonical_unit = conv.unit;
      canonicalValue = conv.value; canonicalUnit = conv.unit;
    } else if (def.data_type === "boolean") {
      row.value_boolean = input.value === true || input.value === "true";
    } else if (def.data_type === "date") {
      const d = String(input.value).trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return fail(422, "VALIDATION_ERROR", "a date is recorded as YYYY-MM-DD");
      row.value_date = d;
    } else if (def.data_type === "single_choice" || def.data_type === "multi_choice") {
      const choices = Array.isArray(input.value) ? input.value.map(String) : [String(input.value)];
      if (choices.length === 0) return fail(422, "VALIDATION_ERROR", "a choice measurement needs a choice");
      if (def.data_type === "single_choice" && choices.length > 1)
        return fail(422, "VALIDATION_ERROR", `${def.display_name} takes one choice`);
      row.value_choice = choices;
    } else {
      row.value_text = String(input.value).trim().slice(0, 4000);
    }
  }

  // LCP s11: "All calculations and alerts store the parameter-definition and rule versions used."
  // Nullable in the schema on purpose -- a refused weight is worse than an unversioned one -- so a
  // missing version row does not stop the write, and the harness asserts it is filled in practice.
  const { data: ver } = await admin.from("practice_parameter_definition_version")
    .select("id").eq("definition_id", def.id).order("version", { ascending: false }).limit(1).maybeSingle();
  row.definition_version_id = ver?.id ?? null;

  const { data: written, error: wErr } = await admin.from("practice_parameter_measurement")
    .insert(row).select("id").single();
  if (wErr) return fail(500, "WRITE_FAILED", `the measurement could not be saved: ${wErr.message}`);

  // ── Steps 4 to 7 ──────────────────────────────────────────────────────────────────────────────────
  const plausibility = plausibilityLine({
    value: canonicalValue, unit: canonicalUnit,
    min: def.min_plausible ?? null, max: def.max_plausible ?? null,
  });

  const [plan, activation] = await Promise.all([
    admin.from("practice_patient_monitoring_plan").select("*")
      .eq("patient_id", input.patientId).eq("definition_id", def.id).maybeSingle(),
    admin.from("practice_parameter_activation")
      .select("threshold_override").eq("workspace_id", ctx.workspaceId).eq("definition_id", def.id)
      .eq("scope", "practice").eq("scope_id", SCOPE_SENTINEL).maybeSingle(),
  ]);
  const planRow = plan.data ?? null;
  const target = planRow && (planRow.target_low !== null || planRow.target_high !== null)
    ? { low: planRow.target_low, high: planRow.target_high } : null;
  const practiceThreshold = boundsOf(activation.data?.threshold_override);
  const threshold = thresholdLine({
    value: canonicalValue, unit: canonicalUnit ?? def.canonical_unit,
    target, practiceThreshold, unavailable: !!plan.error || !!activation.error,
  });

  const alertsRaised: MeasurementResult["alertsRaised"] = [];
  if (!input.enteredInError) {
    const toRaise: { alert_type: string; severity: string; rationale: string; recommended_action: string | null }[] = [];
    if (threshold.state === "breached") {
      toRaise.push({
        alert_type: threshold.ruleSource === "patient_target" ? "patient_target" : "reference_range",
        // ⚠ NOT "critical". A value outside a range needs somebody to look; how dangerous it is depends
        // on the patient and this engine has not met them. `action_required` says what to do rather
        // than how bad it is, which is why that scale was chosen.
        severity: "action_required",
        rationale: threshold.text,
        recommended_action: "Review the value against this patient's clinical picture and decide whether the threshold or the value needs changing.",
      });
    }
    if (plausibility.state === "implausible") {
      toRaise.push({
        alert_type: "reference_range", severity: "advisory",
        rationale: plausibility.text,
        recommended_action: "Check the entry before it is used for anything. This is a typing check, not a clinical range.",
      });
    }
    if (toRaise.length > 0) {
      const { data: raised, error: aErr } = await admin.from("practice_parameter_alert").insert(
        toRaise.map(a => ({
          workspace_id: ctx.workspaceId, patient_id: input.patientId, definition_id: def.id,
          measurement_id: written.id, ...a,
          definition_version_id: ver?.id ?? null, rule_version: `definition v${def.version}`,
          status: "open", created_by: input.actorId,
        }))).select("id, alert_type, severity, rationale");
      // An alert that failed to save is reported, not swallowed: a screen with no warning on it reads as
      // a screen that found no problem.
      if (aErr) return fail(500, "ALERT_WRITE_FAILED", `the measurement was saved but its alert was not: ${aErr.message}`);
      for (const r of ((raised ?? []) as any[]))
        alertsRaised.push({ id: r.id, alertType: r.alert_type, severity: r.severity ?? null, rationale: r.rationale });
    }
  }

  // ── Step 4: derived values ────────────────────────────────────────────────────────────────────────
  const derived = input.enteredInError ? [] : await deriveFor(admin, ctx, {
    patientId: input.patientId, changedCode: def.code, actorId: input.actorId,
  });

  // The plan's own bookkeeping. next_due_on advances from the measurement, so a due date is a fact
  // about when it was last done rather than about when the row was written.
  if (planRow) {
    // The day the practice measured it. effective_at is timestamptz; the comment above says the due
    // date is a fact about when it was last done, and that is the practice's calendar, not the server's.
    const measureTz = ctx.workspaceTimezone;
  const measureToday = practiceToday(measureTz);
    const nextDue = computeNextDue({
      schedule: planRow.schedule,
      from: practiceDayOf(measureTz, row.effective_at as string) ?? measureToday,
      untilDate: planRow.until_date,
    });
    await admin.from("practice_patient_monitoring_plan").update({
      last_measured_at: row.effective_at, next_due_on: nextDue,
      encounters_remaining: planRow.schedule === "for_n_encounters" && planRow.encounters_remaining > 1
        ? planRow.encounters_remaining - 1 : planRow.encounters_remaining,
      updated_at: new Date().toISOString(), updated_by: input.actorId,
    }).eq("id", planRow.id).eq("workspace_id", ctx.workspaceId);
  }

  await audit(admin, {
    workspaceId: ctx.workspaceId, actorId: input.actorId,
    eventType: input.enteredInError ? "practice.parameter.measurement_retracted"
      : input.amendsMeasurementId ? "practice.parameter.measurement_corrected"
        : "practice.parameter.measurement_recorded",
    payload: {
      patientId: input.patientId, definitionId: def.id, code: def.code,
      measurementId: written.id, canonicalValue, canonicalUnit, source,
      encounterId: input.encounterId ?? null, amends: input.amendsMeasurementId ?? null,
      alerts: alertsRaised.length, derived: derived.length,
    },
    correlationId: input.correlationId,
  });

  return {
    ok: true,
    data: {
      id: written.id, canonicalValue, canonicalUnit,
      definitionVersionId: ver?.id ?? null,
      plausibility, threshold, derived, alertsRaised,
    },
  };
}

/**
 * LCP s5.2's derived values, computed by clinical-calculators.ts and PERSISTED.
 *
 * ⚠ PERSISTED, NOT COMPUTED ON READ, and migration 246 s9 gives the reason: "A body surface area
 * recomputed every time the page loads would silently change the moment a height was corrected --
 * including on the prescription that was written from the old one."
 *
 * ⚠ APPEND ONLY. A new weight produces a NEW derived row. The old one stands, with the measurement ids
 * it was calculated from still attached to it. Nothing here updates.
 *
 * ⚠ AND THE ARITHMETIC IS NOT REWRITTEN HERE. clinical-calculators.ts already computes BMI and BSA
 * correctly, with published formulas and plausibility bounds; this reads the measurements, calls it, and
 * stores what it returns along with the formula it named and the rows it used.
 */
async function deriveFor(
  admin: any, ctx: WorkspaceContext,
  input: { patientId: string; changedCode: string; actorId: string },
): Promise<MeasurementResult["derived"]> {
  const wanted = DERIVATIONS.filter(d => Object.values(d.inputs).includes(input.changedCode));
  if (wanted.length === 0) return [];

  const codes = [...new Set(wanted.flatMap(d => Object.values(d.inputs)).concat(wanted.map(d => d.code)))];
  const { data: defs, error } = await admin.from("practice_parameter_definition")
    .select("id, code, canonical_unit, version")
    .in("code", codes).or(`workspace_id.is.null,workspace_id.eq.${ctx.workspaceId}`);
  if (error) return [];
  const byCode = new Map<string, any>(((defs ?? []) as any[]).map(d => [d.code, d]));

  const inputIds = [...new Set(wanted.flatMap(d => Object.values(d.inputs)))]
    .map(c => byCode.get(c)?.id).filter(Boolean) as string[];
  if (inputIds.length === 0) return [];

  const { data: rows, error: mErr } = await admin.from("practice_parameter_measurement")
    .select("id, definition_id, canonical_value, canonical_unit, effective_at")
    .eq("workspace_id", ctx.workspaceId).eq("patient_id", input.patientId)
    .eq("status", "active").in("definition_id", inputIds)
    .order("effective_at", { ascending: false }).limit(200);
  if (mErr) return [];

  const latestByDefinition = new Map<string, any>();
  for (const r of ((rows ?? []) as any[]))
    if (!latestByDefinition.has(r.definition_id)) latestByDefinition.set(r.definition_id, r);

  const out: MeasurementResult["derived"] = [];
  for (const d of wanted) {
    const target = byCode.get(d.code);
    const calculator = calculatorByKey(d.calculator);
    if (!target || !calculator) continue;

    const values: Record<string, string> = {};
    const sources: string[] = [];
    let complete = true;
    for (const [field, code] of Object.entries(d.inputs)) {
      const defRow = byCode.get(code);
      const m = defRow ? latestByDefinition.get(defRow.id) : null;
      if (!m || m.canonical_value === null) { complete = false; break; }
      values[field] = String(m.canonical_value);
      sources.push(m.id);
    }
    // A DERIVED VALUE IS NOT COMPUTED FROM A GUESS. LCP s13: "A weight-based medication entry requests a
    // usable weight when none is available." Half the inputs means no derived row, not an estimate.
    if (!complete) continue;

    const result = calculator.compute(values);
    if (!result.ok) continue;

    const { data: ver } = await admin.from("practice_parameter_definition_version")
      .select("id").eq("definition_id", target.id).order("version", { ascending: false }).limit(1).maybeSingle();

    const { data: written, error: wErr } = await admin.from("practice_parameter_derived").insert({
      workspace_id: ctx.workspaceId, patient_id: input.patientId, definition_id: target.id,
      definition_version_id: ver?.id ?? null,
      value: result.value, unit: result.unit,
      // The published formula, named. Not "BMI" -- the arithmetic, so a reader can check it.
      formula: calculator.formula,
      source_measurement_ids: sources,
      calculated_by: input.actorId,
    }).select("id, value, unit, formula, source_measurement_ids").single();
    if (wErr) continue;

    out.push({
      id: written.id, code: d.code, value: written.value, unit: written.unit ?? null,
      formula: written.formula, sourceMeasurementIds: (written.source_measurement_ids ?? []) as string[],
    });
  }
  return out;
}

/** LCP s8 step 8: "The responsible practitioner acknowledges, acts on or documents an override." */
export async function resolveAlert(
  admin: any, ctx: WorkspaceContext,
  input: { alertId: string; status: "acknowledged" | "actioned" | "overridden"; overrideReason?: string | null; actorId: string; correlationId: string },
): Promise<EngineResult<{ id: string; status: string }>> {
  if (!hasCapability(ctx, CAP_RECORD))
    return fail(403, "FORBIDDEN", "acting on an alert needs parameter.record");
  if (!["acknowledged", "actioned", "overridden"].includes(input.status))
    return fail(422, "VALIDATION_ERROR", "an alert is acknowledged, actioned or overridden");
  // LCP s11: "Safety-related parameters require an authorised override and reason when deactivated or
  // bypassed." The database refuses an override with no reason; this refuses it with a sentence.
  if (input.status === "overridden" && !trim(input.overrideReason))
    return fail(422, "OVERRIDE_REASON_REQUIRED", "an override with no justification is the get-past-the-alert answer; the reason is the entire content of the act");

  const { data, error } = await admin.from("practice_parameter_alert")
    .update({
      status: input.status, acknowledged_at: new Date().toISOString(), acknowledged_by: input.actorId,
      override_reason: input.status === "overridden" ? trim(input.overrideReason) : null,
    })
    .eq("id", input.alertId).eq("workspace_id", ctx.workspaceId)
    .select("id, status, definition_id, patient_id").single();
  if (error) return fail(500, "WRITE_FAILED", `the alert could not be updated: ${error.message}`);

  await audit(admin, {
    workspaceId: ctx.workspaceId, actorId: input.actorId, eventType: "practice.parameter.alert_resolved",
    payload: { alertId: data.id, status: data.status, reason: input.overrideReason ?? null },
    correlationId: input.correlationId,
  });
  return { ok: true, data: { id: data.id, status: data.status } };
}

// ────────────────────────────────────────────────────────────────────────────────────────────────────
// s10.3 -- ENCOUNTER WORKSPACE: COLLECTION DURING A VISIT
// ────────────────────────────────────────────────────────────────────────────────────────────────────

export type EncounterParameter = PlanEntry & {
  /** Why this parameter is on the encounter form: due, required, contextual, or a one-off addition. */
  reasonShown: "overdue" | "due_today" | "required" | "safety_required" | "every_visit" | "encounter_addition" | "optional";
  /** ⚠ Whether it was recorded IN THIS ENCOUNTER. Never pre-filled from a prior value. */
  recordedThisEncounter: { id: string; value: string; source: string; recordedAt: string } | null;
};

export type EncounterCollection = {
  permitted: boolean;
  canRecord: boolean;
  canConfigure: boolean;
  encounterId: string;
  patientId: string | null;
  /** s10.3: "Only due, required and contextually relevant parameters shown first". */
  priority: EncounterParameter[];
  /** s10.3: "Optional parameters accessible without clutter". */
  optional: EncounterParameter[];
  /** s4's encounter override level: parameters added for this review only. */
  additions: EncounterParameter[];
  unavailable: boolean;
  detail: string | null;
  counts: { priority: number | null; optional: number | null; additions: number | null; recorded: number | null };
  /** s10.3's prohibition, carried in the payload so the screen cannot lose it. */
  carryForwardProhibited: true;
  today: string;
};

export async function encounterParameters(
  admin: any, ctx: WorkspaceContext, encounterId: string, options?: { today?: string },
): Promise<EncounterCollection> {
  const today = options?.today ?? practiceToday(ctx.workspaceTimezone);
  const blank = (permitted: boolean, patientId: string | null, detail: string | null): EncounterCollection => ({
    permitted, canRecord: permitted && hasCapability(ctx, CAP_RECORD),
    canConfigure: permitted && hasCapability(ctx, CAP_CONFIGURE),
    encounterId, patientId,
    priority: [], optional: [], additions: [],
    unavailable: detail !== null, detail,
    counts: { priority: null, optional: null, additions: null, recorded: null },
    carryForwardProhibited: true, today,
  });
  if (!hasCapability(ctx, CAP_VIEW)) return blank(false, null, null);

  const { data: enc, error: eErr } = await admin.from("practice_encounter")
    .select("id, patient_id, status").eq("id", encounterId).eq("workspace_id", ctx.workspaceId).maybeSingle();
  if (eErr) return blank(true, null, `the encounter could not be read: ${eErr.message}`);
  if (!enc) return blank(true, null, null);

  // ⚠ THE ENCOUNTER OVERRIDES ARE READ BEFORE THE PLAN, NOT AFTER, AND THE ORDER IS LOAD BEARING.
  //
  // s4's encounter level "adds a one-off parameter for a specific review", and its own example is
  // "Postural BP today only" -- a parameter the practice does NOT routinely collect. The plan set is
  // (this patient's plan rows + the practice's activations), so an addition outside both would be
  // written, audited, and then simply not appear on the form it was added to. Passing the ids into
  // monitoringPlan is what makes the override a real level of the hierarchy rather than a row nobody
  // reads.
  const [encMeasRes, encActRes] = await Promise.all([
    admin.from("practice_parameter_measurement")
      .select("id, definition_id, value_numeric, value_text, value_boolean, value_date, value_choice, unit, canonical_value, canonical_unit, source, recorded_at")
      .eq("workspace_id", ctx.workspaceId).eq("encounter_id", encounterId).eq("status", "active"),
    // s4's encounter override level. migration 246 s5's scope list holds all five granularities.
    admin.from("practice_parameter_activation")
      .select("definition_id, state").eq("workspace_id", ctx.workspaceId)
      .eq("scope", "encounter").eq("scope_id", encounterId).eq("state", "active"),
  ]);

  const recorded = encMeasRes.error ? null : ((encMeasRes.data ?? []) as any[]);
  const additionIds = new Set<string>(encActRes.error ? [] :
    ((encActRes.data ?? []) as { definition_id: string }[]).map(r => r.definition_id));

  const plan = await monitoringPlan(admin, ctx, enc.patient_id, {
    today, includeDefinitionIds: [...additionIds],
  });
  if (!plan.permitted) return blank(false, enc.patient_id, null);
  if (plan.all.unavailable) return blank(true, enc.patient_id, plan.all.detail);

  const decorate = (e: PlanEntry): EncounterParameter => {
    const mine = recorded?.find(m => m.definition_id === e.definitionId) ?? null;
    const reasonShown: EncounterParameter["reasonShown"] =
      additionIds.has(e.definitionId) ? "encounter_addition"
        : e.safetyRequired ? "safety_required"
          : e.due.state === "overdue" ? "overdue"
            : e.due.state === "due_today" ? "due_today"
              : e.state === "required" || e.state === "conditionally_required" ? "required"
                : (e.collectionRule === "every_visit" || e.schedule === "every_encounter") ? "every_visit"
                  : "optional";
    return {
      ...e, reasonShown,
      // ⚠ THIS IS THE ONLY VALUE THE FORM MAY SHOW AS FILLED IN. LCP s10.3: "One-click carry-forward is
      // prohibited for measured values." The patient's last weight is shown as HISTORY, in `latest`,
      // labelled with its date; it is never placed in the input.
      recordedThisEncounter: mine
        ? { id: mine.id, value: formatValue(mine), source: mine.source, recordedAt: mine.recorded_at }
        : null,
    };
  };

  // ⚠ THE SAFETY LIST IS UNIONED IN, NOT INTERSECTED. `plan.routine` has already dropped hidden, paused
  // and resolved; a hidden parameter that a medication requires must still appear on the encounter form,
  // which is LCP s9's sentence at the point of collection.
  const routineIds = new Set(plan.routine.map(e => e.definitionId));
  const visible = [
    ...plan.routine,
    ...plan.safetyRequired.filter(e => !routineIds.has(e.definitionId)),
    ...plan.all.items.filter(e => additionIds.has(e.definitionId) && !routineIds.has(e.definitionId) && !e.safetyRequired),
  ].map(decorate);

  const PRIORITY: EncounterParameter["reasonShown"][] =
    ["safety_required", "overdue", "due_today", "required", "every_visit", "encounter_addition"];
  const priority = visible.filter(e => PRIORITY.includes(e.reasonShown));
  const optional = visible.filter(e => !PRIORITY.includes(e.reasonShown));
  const additions = visible.filter(e => e.reasonShown === "encounter_addition");

  return {
    permitted: true,
    canRecord: hasCapability(ctx, CAP_RECORD),
    canConfigure: hasCapability(ctx, CAP_CONFIGURE),
    encounterId, patientId: enc.patient_id,
    priority, optional, additions,
    unavailable: false, detail: null,
    counts: {
      priority: priority.length, optional: optional.length, additions: additions.length,
      recorded: recorded ? recorded.length : null,
    },
    carryForwardProhibited: true, today,
  };
}

/**
 * LCP s4's encounter override: "Adds a one-off parameter for a specific review." ("Postural BP today
 * only.")
 *
 * ⚠ SCOPED TO THE ENCOUNTER AND NOTHING ELSE. It writes an activation at scope `encounter` with the
 * encounter's id, so it applies to this review and expires with it -- it does not become a practice
 * default and it does not change the patient's monitoring plan. That distinction is the whole reason
 * migration 246 s5 carries all five of s4's granularities rather than the three that were obviously
 * needed on day one.
 */
export async function addEncounterParameter(
  admin: any, ctx: WorkspaceContext,
  input: { encounterId: string; definitionId: string; reason?: string | null; actorId: string; correlationId: string },
): Promise<EngineResult<{ id: string; encounterId: string; definitionId: string }>> {
  // ⚠ parameter.record, NOT parameter.configure. LCP s11: "Authorised team members may collect values
  // but cannot necessarily change definitions or thresholds." A one-off addition for today's review is
  // collection, not configuration -- it changes nothing beyond this encounter.
  if (!hasCapability(ctx, CAP_RECORD))
    return fail(403, "FORBIDDEN", "adding a parameter to this review needs parameter.record");

  const { data: enc, error: eErr } = await admin.from("practice_encounter")
    .select("id, status").eq("id", input.encounterId).eq("workspace_id", ctx.workspaceId).maybeSingle();
  if (eErr) return fail(503, "UNAVAILABLE", `the encounter could not be read: ${eErr.message}`);
  if (!enc) return fail(404, "NOT_FOUND", "no such encounter");
  if (["SIGNED", "ENTERED_IN_ERROR", "CANCELLED"].includes(enc.status))
    return fail(422, "LOCKED", "this encounter is closed; nothing can be added to it");

  const { data: def, error: dErr } = await admin.from("practice_parameter_definition")
    .select("id, workspace_id, code, status").eq("id", input.definitionId).maybeSingle();
  if (dErr) return fail(503, "UNAVAILABLE", `the parameter could not be read: ${dErr.message}`);
  if (!def || (def.workspace_id !== null && def.workspace_id !== ctx.workspaceId))
    return fail(404, "NOT_FOUND", "no such parameter");
  if (def.status === "retired")
    return fail(422, "RETIRED", "a retired parameter keeps its history and is not collected again");

  const { data, error } = await admin.from("practice_parameter_activation").upsert({
    workspace_id: ctx.workspaceId, definition_id: def.id,
    scope: "encounter", scope_id: input.encounterId, state: "active",
    collection_rule: "on_request",
    local_label: null, visibility: "team", threshold_override: {},
    updated_at: new Date().toISOString(), updated_by: input.actorId, created_by: input.actorId,
  }, { onConflict: "workspace_id,definition_id,scope,scope_id" }).select("id").single();
  if (error) return fail(500, "WRITE_FAILED", `the parameter could not be added to this review: ${error.message}`);

  await audit(admin, {
    workspaceId: ctx.workspaceId, actorId: input.actorId, eventType: "practice.parameter.encounter_addition",
    payload: { encounterId: input.encounterId, definitionId: def.id, code: def.code, reason: input.reason ?? null },
    correlationId: input.correlationId,
  });
  return { ok: true, data: { id: data.id, encounterId: input.encounterId, definitionId: def.id } };
}

// ────────────────────────────────────────────────────────────────────────────────────────────────────
// THE SERIES -- s10.2's "Trend summaries", and the chart the design overview draws
// ────────────────────────────────────────────────────────────────────────────────────────────────────

export type ParameterSeries = {
  permitted: boolean;
  unavailable: boolean;
  detail: string | null;
  definitionId: string;
  code: string | null;
  label: string | null;
  canonicalUnit: string | null;
  /** Oldest first, active rows only. The raw series and nothing else. */
  points: { id: string; value: number; unit: string | null; at: string; source: string; amended: boolean }[];
  /** LCP s13: derived values with their sources and their calculation timestamp. */
  derived: { id: string; value: number; unit: string | null; formula: string; sourceMeasurementIds: string[]; calculatedAt: string }[];
  /** Retracted and superseded rows, kept visible. LCP s3: no silent rewriting. */
  amendments: { id: string; amends: string; reason: string | null; status: string; at: string }[];
  trend: TrendVerdict;
  /** s5.2's "Weight change and percentage change", about ONE patient over time. */
  change: { absolute: number; percent: number | null; fromAt: string; toAt: string } | null;
  /**
   * ⚠ ALWAYS FALSE, ALWAYS PRESENT. The design overview draws 97th/75th/50th/25th/3rd centile bands
   * behind this line. There is no reference population in this product, neither specification supplies
   * one, and a percentile against an unnamed population is a fabricated clinical figure. The field is in
   * the payload rather than absent so a screen has to render the reason instead of quietly omitting a
   * chart element nobody notices is missing.
   */
  percentileBands: null;
  percentileBandsRefusal: string;
};

export async function parameterSeries(
  admin: any, ctx: WorkspaceContext, patientId: string, definitionId: string,
): Promise<ParameterSeries> {
  const base = {
    definitionId, code: null as string | null, label: null as string | null,
    canonicalUnit: null as string | null,
    points: [] as ParameterSeries["points"], derived: [] as ParameterSeries["derived"],
    amendments: [] as ParameterSeries["amendments"],
    change: null, percentileBands: null,
    percentileBandsRefusal: PERCENTILE_REFUSAL_TEXT,
  };
  if (!hasCapability(ctx, CAP_VIEW))
    return { ...base, permitted: false, unavailable: false, detail: null, trend: trendLine({ series: [], agreedDirection: null, unavailable: false }) };

  const [defRes, mRes, dRes, planRes] = await Promise.all([
    admin.from("practice_parameter_definition").select("id, code, display_name, canonical_unit, workspace_id")
      .eq("id", definitionId).maybeSingle(),
    admin.from("practice_parameter_measurement")
      .select("id, canonical_value, value_numeric, canonical_unit, unit, effective_at, source, status, amends_measurement_id, amendment_reason")
      .eq("workspace_id", ctx.workspaceId).eq("patient_id", patientId).eq("definition_id", definitionId)
      .order("effective_at", { ascending: true }).limit(500),
    admin.from("practice_parameter_derived")
      .select("id, value, unit, formula, source_measurement_ids, calculated_at")
      .eq("workspace_id", ctx.workspaceId).eq("patient_id", patientId).eq("definition_id", definitionId)
      .order("calculated_at", { ascending: true }).limit(200),
    admin.from("practice_patient_monitoring_plan").select("change_rule").eq("workspace_id", ctx.workspaceId)
      .eq("patient_id", patientId).eq("definition_id", definitionId).maybeSingle(),
  ]);

  if (mRes.error) {
    return {
      ...base, permitted: true, unavailable: true,
      detail: `the measurement series could not be read: ${mRes.error.message}`,
      trend: trendLine({ series: [], agreedDirection: null, unavailable: true }),
    };
  }

  const def = defRes.data ?? null;
  const rows = (mRes.data ?? []) as any[];
  const amendedIds = new Set(rows.map(r => r.amends_measurement_id).filter(Boolean) as string[]);
  const active = rows.filter(r => r.status === "active");

  const points = active
    .filter(r => (r.canonical_value ?? r.value_numeric) !== null)
    .map(r => ({
      id: r.id, value: (r.canonical_value ?? r.value_numeric) as number,
      unit: r.canonical_unit ?? r.unit ?? null, at: r.effective_at, source: r.source,
      amended: amendedIds.has(r.id),
    }));

  const changeRule = (planRes.data?.change_rule ?? {}) as Record<string, unknown>;
  const agreed = changeRule.improving_direction;
  const trend = trendLine({
    series: points.map(p => ({ value: p.value, at: p.at })),
    agreedDirection: agreed === "up" || agreed === "down" ? agreed : null,
    unavailable: false,
  });

  const change = points.length >= 2 ? (() => {
    const first = points[0], last = points[points.length - 1];
    const absolute = Math.round((last.value - first.value) * 1000) / 1000;
    // ⚠ A CLINICAL PERCENTAGE ABOUT ONE PATIENT, WHICH IS NOT THE STATISTIC THE NO-RATES DOCTRINE
    // FORBIDS. That doctrine's own stated reason is a small cohort denominator ("a practice with nine
    // follow-ups"); "weight down 8% since January" is s5.2's "Weight change and percentage change" about
    // one person and has no cohort in it. It is deliberately kept in THIS payload and never merged into
    // the intelligence payload, where findRates() walks field names.
    const percent = first.value === 0 ? null : Math.round((absolute / first.value) * 1000) / 10;
    return { absolute, percent, fromAt: first.at, toAt: last.at };
  })() : null;

  return {
    ...base,
    permitted: true, unavailable: false, detail: null,
    code: def?.code ?? null, label: def?.display_name ?? null,
    canonicalUnit: def?.canonical_unit ?? null,
    points,
    derived: dRes.error ? [] : ((dRes.data ?? []) as any[]).map(d => ({
      id: d.id, value: d.value, unit: d.unit ?? null, formula: d.formula,
      sourceMeasurementIds: (d.source_measurement_ids ?? []) as string[],
      calculatedAt: d.calculated_at,
    })),
    amendments: rows.filter(r => r.amends_measurement_id).map(r => ({
      id: r.id, amends: r.amends_measurement_id, reason: r.amendment_reason ?? null,
      status: r.status, at: r.effective_at,
    })),
    trend, change,
  };
}

const PERCENTILE_REFUSAL_TEXT =
  "No centile bands are drawn. Percentiles and z-scores need a NAMED reference population (WHO 2006, CDC 2000 or another) fitted as L/M/S coefficients per age and sex; no such table exists in this product and neither CPR-LCP-001 nor CPR-CPL-001 supplies one. A percentile against an unnamed population is a fabricated clinical figure that looks exactly like a real one. The raw series is drawn instead.";
