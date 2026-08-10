// THE CAPABILITY REGISTRY -- CPR-CAP-001 s4, s5 and s6, as constants and pure functions.
//
// ====================================================================================================
// ⚠ THE ONE RULE THIS WHOLE FRAMEWORK RESTS ON: ACTIVATION IS NOT PERMISSION.
//
// Competen Practice already has a thing called a "capability" and it is a DIFFERENT AXIS.
//
//   practice_role_assignment.capability_code -- 'patient.edit', 'encounter.edit', 'appointment.manage',
//   'practice.settings.manage' and about fifty more. It answers "what may THIS USER do", it is checked
//   by requirePracticeContext() and hasCapability(), and it is SECURITY.
//
//   The CP.* ids in this file -- 'CP.BOOKING', 'CP.ENCOUNTERS' and ten more. They answer "what has THIS
//   PRACTICE switched on", they are stored in practice_capability_activation, and they are COMMERCIAL.
//
// They are INDEPENDENT, and the effective gate on a surface is BOTH of them:
//
//     the practice has ACTIVATED the capability   AND   the user HOLDS the permission
//
// Neither may ever be derived from the other:
//
//   * Deactivating CP.ENCOUNTERS must NOT revoke anybody's encounter.edit grant. Somebody who turns a
//     product off for a month and back on has not been demoted, and a permission silently dropped is a
//     permission somebody has to notice is missing before they can ask for it back.
//   * Granting encounter.edit must NOT activate CP.ENCOUNTERS. Adding a colleague to the team cannot
//     switch on a product the practice never bought.
//
// The engine in capabilities.ts touches NO permission table, and the harness asserts both directions
// against a live database, each with a control.
//
// ⚠ NOR IS THIS plat_feature_flags. That table is TENANT scoped for the hospital estate and is read by
// /api/platform/tenants. Different plane, different tenancy, different readers.
// ====================================================================================================
//
// ⚠ KEEP THIS MODULE IMPORT-FREE. It is imported by a "use client" console, and a single import of
// anything that reaches node:crypto or next/headers drags a browserified Node stack into the bundle --
// see the header of audit.ts and scripts/practice-bundle-harness.ts, which enforces it. Constants and
// pure functions only.
//
// ⚠ AND THE RULES LIVE HERE, NOT IN THE HARNESS. requiredClosure / dependentClosure / modeSelection are
// exported so that the harness can IMPORT the rule it is testing instead of re-implementing it. A test
// that restates the rule passes when both copies are wrong together.

/** The twelve capability ids of CPR-CAP-001 s4. This union is the whole vocabulary. */
export type CapabilityId =
  | "CP.BOOKING"
  | "CP.CALENDAR"
  | "CP.PATIENTS"
  | "CP.FOLLOWUPS"
  | "CP.ENCOUNTERS"
  | "CP.INVESTIGATIONS"
  | "CP.MEDICATIONS"
  | "CP.PROCEDURES"
  | "CP.DOCUMENTS"
  | "CP.CLOSE_DAY"
  | "CP.INTELLIGENCE"
  | "CP.AI_ASSIST";

/**
 * A CONFIGURATION ARTEFACT a capability needs, which is NOT itself a capability.
 *
 * ⚠ s4's dependency column mixes two kinds of thing and collapsing them would lose the distinction s6
 * draws in its own sentence: "Required dependencies are ACTIVATED or CONFIGURED in the same guided
 * flow." Calendar is activated. Locations are configured. CP.BOOKING needs both, and a practice that
 * has switched Calendar on but entered no location is not ready to take a booking -- which is a
 * different sentence from "Calendar is off", and the practitioner has to be told the right one.
 *
 * Whether a given setup artefact is actually complete is NOT answered here. That is a live read against
 * the practice's own configuration, it belongs to the setup wizard (s7, out of scope for this arc), and
 * inventing an answer would be worse than reporting the requirement.
 */
export type SetupKey =
  | "locations"
  | "practitioner_program"
  | "availability"
  | "registration"
  | "telemetry";

export const SETUP_LABELS: Record<SetupKey, string> = {
  locations: "Locations",
  practitioner_program: "Practitioner Program",
  availability: "Availability",
  registration: "Registration",
  telemetry: "Telemetry",
};

/**
 * s4's Default column, with its three values kept distinct.
 *
 *   "on"       -- CP.CALENDAR and CP.PATIENTS. A practice that has never opened this screen HAS these.
 *   "preset"   -- CP.BOOKING. s4 says "On in Booking preset", which is not the same as On.
 *   "optional" -- everything else. Off until somebody asks for it.
 *
 * ⚠ ONLY "on" MEANS ACTIVE IN THE ABSENCE OF A STORED ROW. See defaultActive() below.
 */
export type CapabilityDefault = "on" | "preset" | "optional";

export type CapabilityDefinition = {
  id: CapabilityId;
  /** s4's Display name column, verbatim. */
  displayName: string;
  /** A neutral noun phrase naming the product area. NOT a claim about what the software does today. */
  area: string;
  /** Capability dependencies: these must be ACTIVE for this one to make sense. */
  requires: CapabilityId[];
  /** Configuration dependencies: these must be CONFIGURED. Completion is not asserted here. */
  requiresSetup: SetupKey[];
  /** s4's "recommended", which is NOT required and must never be enforced as though it were. */
  recommends: CapabilityId[];
  defaultState: CapabilityDefault;
  /** s4's Core dependencies cell, verbatim, so a reader can check this row against the specification. */
  specDependencies: string;
  /** Anything s4 asks for that this registry deliberately does not assert. Empty string when none. */
  unmodelled: string;
};

/**
 * ⚠ THE DEPENDENCIES ARE THE SPECIFICATION'S, NOT A TIDIER SET I PREFERRED.
 *
 * CP.BOOKING's cell reads "Locations, Practitioner Program, Availability, Registration, Calendar".
 * Exactly one of those five is a capability, so `requires` is [CP.CALENDAR] and the other four are
 * setup keys. It is tempting to add CP.PATIENTS -- a booking with nobody to book is odd, and the
 * Booking Only preset does list Patients -- but s4 does not say it, the preset already brings Patients
 * in, and a dependency invented here would silently force a product on a practice that did not choose
 * it. Where the spec is quiet, so is this table, and `unmodelled` says where.
 */
export const CAPABILITY_REGISTRY: readonly CapabilityDefinition[] = [
  {
    id: "CP.BOOKING",
    displayName: "Online Booking",
    area: "Patients requesting appointments online",
    requires: ["CP.CALENDAR"],
    requiresSetup: ["locations", "practitioner_program", "availability", "registration"],
    recommends: [],
    defaultState: "preset",
    specDependencies: "Locations, Practitioner Program, Availability, Registration, Calendar",
    unmodelled: "",
  },
  {
    id: "CP.CALENDAR",
    displayName: "Practice Calendar",
    area: "Appointments, sessions and the working day",
    requires: [],
    requiresSetup: ["practitioner_program", "locations"],
    recommends: [],
    defaultState: "on",
    specDependencies: "Practitioner Program, Locations",
    unmodelled: "",
  },
  {
    id: "CP.PATIENTS",
    displayName: "Patient Register",
    area: "The people this practice sees",
    requires: [],
    requiresSetup: ["registration"],
    recommends: [],
    defaultState: "on",
    specDependencies: "Registration",
    unmodelled: "",
  },
  {
    id: "CP.FOLLOWUPS",
    displayName: "Follow-ups",
    area: "Returns, recalls and what is due",
    requires: ["CP.PATIENTS", "CP.CALENDAR"],
    requiresSetup: [],
    recommends: [],
    defaultState: "optional",
    specDependencies: "Patients, Calendar",
    unmodelled: "",
  },
  {
    id: "CP.ENCOUNTERS",
    displayName: "Quick Encounters",
    area: "Recording a consultation",
    requires: ["CP.PATIENTS"],
    requiresSetup: [],
    recommends: [],
    defaultState: "optional",
    specDependencies: "Patients",
    unmodelled: "",
  },
  {
    id: "CP.INVESTIGATIONS",
    displayName: "Investigations",
    area: "What was asked for and what came back",
    requires: ["CP.PATIENTS"],
    requiresSetup: [],
    // ⚠ RECOMMENDED, NOT REQUIRED, AND THE DIFFERENCE IS REAL. s4 writes "Patients; Encounters
    // recommended". Promoting it to a requirement would force Quick Encounters on a practice that only
    // wanted to keep track of a scan, which is precisely the friction this framework exists to remove.
    recommends: ["CP.ENCOUNTERS"],
    defaultState: "optional",
    specDependencies: "Patients; Encounters recommended",
    unmodelled: "",
  },
  {
    id: "CP.MEDICATIONS",
    displayName: "Treatments & Medication",
    area: "What was prescribed",
    requires: ["CP.PATIENTS"],
    requiresSetup: [],
    recommends: ["CP.ENCOUNTERS"],
    defaultState: "optional",
    specDependencies: "Patients; Encounters recommended",
    unmodelled: "",
  },
  {
    id: "CP.PROCEDURES",
    displayName: "Procedures",
    area: "What was done",
    requires: ["CP.PATIENTS"],
    requiresSetup: [],
    recommends: ["CP.ENCOUNTERS"],
    defaultState: "optional",
    specDependencies: "Patients; Encounters recommended",
    unmodelled: "",
  },
  {
    id: "CP.DOCUMENTS",
    displayName: "Documents",
    area: "Letters, results and files",
    requires: ["CP.PATIENTS"],
    requiresSetup: [],
    recommends: [],
    defaultState: "optional",
    specDependencies: "Patients",
    unmodelled: "",
  },
  {
    id: "CP.CLOSE_DAY",
    displayName: "Close My Day",
    area: "Finishing the day's outstanding work",
    requires: ["CP.CALENDAR", "CP.PATIENTS"],
    requiresSetup: [],
    recommends: [],
    defaultState: "optional",
    specDependencies: "Calendar, Patients",
    unmodelled: "",
  },
  {
    id: "CP.INTELLIGENCE",
    displayName: "Practice Intelligence",
    area: "Patterns across this practice's own records",
    requires: [],
    requiresSetup: ["telemetry"],
    recommends: [],
    defaultState: "optional",
    // ⚠ "relevant source capabilities" IS NOT AN ENUMERATION AND IS NOT TREATED AS ONE. s4 does not say
    // which, and guessing would either force products on nobody asked for or claim a dependency that
    // does not exist. Recorded as unmodelled rather than invented.
    specDependencies: "Telemetry + relevant source capabilities",
    unmodelled: "s4's \"relevant source capabilities\" are not enumerated in the specification, so none are asserted here.",
  },
  {
    id: "CP.AI_ASSIST",
    displayName: "AI Assistance",
    area: "Assistance drafted from this practice's own records",
    requires: [],
    requiresSetup: [],
    recommends: [],
    defaultState: "optional",
    // ⚠ AND HERE THE TWO AXES MEET WITHOUT MERGING. s4's dependency for AI Assistance is "Permissioned
    // data sources", which is a statement about the OTHER axis: what the caller is allowed to read.
    // That is enforced where it already is -- in the permission checks on each source -- and is not an
    // activation dependency, so it is not one here.
    specDependencies: "Permissioned data sources",
    unmodelled: "s4's \"Permissioned data sources\" is a permission condition, enforced on the permission axis, not an activation dependency.",
  },
];

export const CAPABILITY_IDS: readonly CapabilityId[] = CAPABILITY_REGISTRY.map(c => c.id);

const BY_ID = new Map<string, CapabilityDefinition>(CAPABILITY_REGISTRY.map(c => [c.id, c]));

/** Null for anything not in the registry. A caller must never invent a capability id. */
export function capabilityDef(id: string): CapabilityDefinition | null {
  return BY_ID.get(id) ?? null;
}

export function isCapabilityId(id: string): id is CapabilityId {
  return BY_ID.has(id);
}

/**
 * The registry default, and the ONLY reading of it that means "active".
 *
 * ⚠ THIS IS WHAT A MISSING STORE ROW MEANS -- and the reasoning is migration 275 section 3's, applied
 * to the opposite starting point. Every practice provisioned before migration 278 has zero rows in the
 * activation table. If absence meant "inactive", every one of them would read as having no Calendar and
 * no Patient Register on the day this shipped. So absence means THE REGISTRY DEFAULT, and the store
 * records departures from it.
 */
export function defaultActive(id: CapabilityId): boolean {
  return (BY_ID.get(id)?.defaultState ?? "optional") === "on";
}

/** The capabilities that are active for a practice which has stored nothing at all. */
export const DEFAULT_ACTIVE_IDS: readonly CapabilityId[] =
  CAPABILITY_REGISTRY.filter(c => c.defaultState === "on").map(c => c.id);

/**
 * s6 first bullet: "Selecting a capability automatically identifies required dependencies."
 *
 * Returns the seeds AND everything they transitively require, in a stable order: dependencies before
 * the things that need them, which is also the order they must be written in.
 *
 * ⚠ VISITED SET, NOT RECURSION DEPTH. The registry has no cycle today. A cycle added tomorrow must
 * terminate rather than blow the stack in an API route.
 */
export function requiredClosure(seeds: readonly CapabilityId[]): CapabilityId[] {
  const out: CapabilityId[] = [];
  const seen = new Set<CapabilityId>();
  const visit = (id: CapabilityId, guard: Set<CapabilityId>) => {
    if (seen.has(id) || guard.has(id)) return;
    guard.add(id);
    for (const dep of BY_ID.get(id)?.requires ?? []) visit(dep, guard);
    if (!seen.has(id)) { seen.add(id); out.push(id); }
  };
  for (const s of seeds) if (BY_ID.has(s)) visit(s, new Set());
  return out;
}

/** Just the dependencies -- the closure minus the seeds. What activating `seeds` would drag in. */
export function requiredDependenciesOf(seeds: readonly CapabilityId[]): CapabilityId[] {
  const seedSet = new Set(seeds);
  return requiredClosure(seeds).filter(id => !seedSet.has(id));
}

/** Capabilities that name `id` in their own `requires`. One hop. */
export function directDependents(id: CapabilityId): CapabilityId[] {
  return CAPABILITY_REGISTRY.filter(c => c.requires.includes(id)).map(c => c.id);
}

/**
 * s6 fourth bullet: "Deactivation must warn when dependent capabilities would be affected."
 *
 * Everything that would be left standing on nothing if `id` went away, transitively. NEVER includes
 * `id` itself -- the caller is deactivating that deliberately, and folding it into the warning list
 * would make the warning read as though it were about something else.
 */
export function dependentClosure(id: CapabilityId): CapabilityId[] {
  const out: CapabilityId[] = [];
  const seen = new Set<CapabilityId>([id]);
  let frontier: CapabilityId[] = [id];
  while (frontier.length > 0) {
    const next: CapabilityId[] = [];
    for (const cur of frontier) {
      for (const dep of directDependents(cur)) {
        if (seen.has(dep)) continue;
        seen.add(dep);
        out.push(dep);
        next.push(dep);
      }
    }
    frontier = next;
  }
  return out;
}

/** Every configuration artefact the closure of `seeds` needs, de-duplicated. */
export function setupClosure(seeds: readonly CapabilityId[]): SetupKey[] {
  const out: SetupKey[] = [];
  for (const id of requiredClosure(seeds)) {
    for (const k of BY_ID.get(id)?.requiresSetup ?? []) if (!out.includes(k)) out.push(k);
  }
  return out;
}

/** s4's "recommended" for the closure of `seeds`, minus anything the closure already contains. */
export function recommendedFor(seeds: readonly CapabilityId[]): CapabilityId[] {
  const closure = new Set(requiredClosure(seeds));
  const out: CapabilityId[] = [];
  for (const id of closure) {
    for (const r of BY_ID.get(id)?.recommends ?? []) if (!closure.has(r) && !out.includes(r)) out.push(r);
  }
  return out;
}

// ====================================================================================================
// PRACTICE MODES -- s5.
//
// ⚠ "Modes are presets only. A practice may activate or deactivate individual capabilities subject to
// dependency rules." That sentence is s5's last line and it is the whole design.
//
// A MODE IS NEVER STORED AS THE PRACTICE'S TIER. There is no mode column on the workspace, the resolver
// never reads a mode, and nothing anywhere asks "which mode is this practice on" in order to decide
// what is available. Applying a mode writes ORDINARY ACTIVATION ROWS, one per capability, exactly as
// though somebody had switched each one on by hand -- and each row records that a mode put it there, as
// provenance for the audit trail and for nothing else.
//
// Two consequences, both deliberate, both asserted:
//
//   1. A practice on "Booking Only" that switches Quick Encounters on KEEPS Quick Encounters. No later
//      read of the mode can take it away, because no later read of the mode happens.
//   2. Applying a mode ADDS. It never deactivates something outside its set. A preset that silently
//      switched products off would be a tier wearing a preset's clothes, and would cost a practitioner
//      work they had already done.
// ====================================================================================================

export type PracticeModeId =
  | "booking_only"
  | "organise_practice"
  | "remember_patients"
  | "intelligent_practice";

export type PracticeModeDefinition = {
  id: PracticeModeId;
  displayName: string;
  /** s5's "Practitioner promise" column, verbatim. Specification text -- see the note below. */
  specPromise: string;
  /** s5's "Capabilities activated" cell, verbatim. */
  specCapabilities: string;
  /** The registry ids s5 names for this preset. Dependencies are added by modeSelection(). */
  selects: CapabilityId[];
  /** What s5's cell names that is NOT a registry capability, said out loud rather than dropped. */
  unmodelled: string;
};

/**
 * ⚠ specPromise IS THE SPECIFICATION'S WORDING AND IS NOT RENDERED AS A CLAIM.
 *
 * "Let patients book themselves" describes what Booking Only is FOR. It is not a statement that this
 * software does it today, and the capabilities console does not print it, because a sentence on a
 * practitioner's screen has to be true on the day they read it. The field is kept so that the harness
 * can check this table against the document.
 */
export const PRACTICE_MODES: readonly PracticeModeDefinition[] = [
  {
    id: "booking_only",
    displayName: "Booking Only",
    specPromise: "Let patients book themselves",
    specCapabilities: "Booking, Calendar, Patients, basic notifications",
    selects: ["CP.BOOKING", "CP.CALENDAR", "CP.PATIENTS"],
    unmodelled: "\"basic notifications\" is not a capability in s4's registry, so this preset does not claim to switch one on.",
  },
  {
    id: "organise_practice",
    displayName: "Organise My Practice",
    specPromise: "Organise clinics and returns",
    specCapabilities: "Booking/Calendar as selected, Patients, Follow-ups, Planner, Practice Brief",
    // ⚠ BOOKING IS NOT IN THIS LIST AND THAT IS THE SPECIFICATION'S DOING: "Booking/Calendar AS
    // SELECTED". This preset does not decide booking for the practice. Calendar is not listed either --
    // it arrives because CP.FOLLOWUPS requires it, which is the dependency engine doing its job rather
    // than the preset overreaching.
    selects: ["CP.PATIENTS", "CP.FOLLOWUPS"],
    unmodelled: "\"Planner\" and \"Practice Brief\" are not capabilities in s4's registry. \"Booking/Calendar as selected\" is deliberately left to the practice.",
  },
  {
    id: "remember_patients",
    displayName: "Remember My Patients",
    specPromise: "Maintain lightweight continuity",
    specCapabilities: "Quick Encounters, Investigations, Treatments, Procedures, Documents",
    selects: ["CP.ENCOUNTERS", "CP.INVESTIGATIONS", "CP.MEDICATIONS", "CP.PROCEDURES", "CP.DOCUMENTS"],
    unmodelled: "",
  },
  {
    id: "intelligent_practice",
    displayName: "Intelligent Practice",
    specPromise: "Reduce end-of-day admin and surface insights",
    specCapabilities: "Close My Day, Intelligence, AI assistance",
    selects: ["CP.CLOSE_DAY", "CP.INTELLIGENCE", "CP.AI_ASSIST"],
    unmodelled: "",
  },
];

export const PRACTICE_MODE_IDS: readonly PracticeModeId[] = PRACTICE_MODES.map(m => m.id);

export function practiceMode(id: string): PracticeModeDefinition | null {
  return PRACTICE_MODES.find(m => m.id === id) ?? null;
}

/**
 * What applying a preset would activate: its own set plus everything that set requires.
 *
 * ⚠ THE CLOSURE IS PART OF THE PRESET, NOT A SEPARATE STEP. s6: required dependencies are activated in
 * the SAME guided flow. "Remember My Patients" selects five clinical capabilities and every one of them
 * requires CP.PATIENTS, so a practitioner who picks it gets a Patient Register without being asked a
 * second question about it -- which is s6's third bullet, "never asked to recreate data already held".
 */
export function modeSelection(id: PracticeModeId): CapabilityId[] {
  const mode = PRACTICE_MODES.find(m => m.id === id);
  if (!mode) return [];
  return requiredClosure(mode.selects);
}

// ====================================================================================================
// FROZEN SENTENCES.
//
// These are asserted verbatim by scripts/practice-capability-harness.ts and rendered verbatim by the
// console, so that the rule and the screen cannot drift apart.
// ====================================================================================================

/** The axis rule, in one sentence, for any screen that needs to explain itself. */
export const ACTIVATION_IS_NOT_PERMISSION =
  "Switching a capability off changes what this practice uses. It does not change what anybody on your "
  + "team is allowed to do, and switching one on does not give anybody a permission they did not have.";

/** s5's last line, restated for a practitioner. */
export const MODES_ARE_PRESETS =
  "A mode is a starting point, not a plan you are locked into. It switches things on for you, and you "
  + "can switch any of them on or off afterwards.";

/** s6's fifth bullet, restated for a practitioner. */
export const DEACTIVATION_KEEPS_HISTORY =
  "Switching something off hides it. Nothing you have already recorded is deleted, and it is all still "
  + "there if you switch it back on.";

/**
 * ⚠ THE HONEST LIMIT OF THIS ARC, AND IT IS RENDERED ON THE CONSOLE.
 *
 * The registry, the store, the resolver and the API exist. NOTHING READS THEM YET -- navigation and the
 * dashboards are wired in a separate change, because four other people are in those files today. A
 * screen that let somebody switch Documents off and left Documents in the sidebar, with no explanation,
 * would be a control that does nothing, and the product rule for this codebase is that there is no
 * action without a store and no sentence that is not true on the day it is read.
 */
export const NOT_YET_WIRED =
  "This records what your practice has switched on. It does not yet change your menus or your "
  + "dashboard -- that part is being connected separately, and this page will say so until it is.";
