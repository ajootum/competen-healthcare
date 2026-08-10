import { audit } from "@/lib/practice/audit";
import {
  CAPABILITY_REGISTRY, capabilityDef, isCapabilityId, defaultActive, requiredClosure,
  dependentClosure, setupClosure, recommendedFor, modeSelection, practiceMode,
  type CapabilityId, type CapabilityDefault, type SetupKey, type PracticeModeId,
} from "@/lib/practice/capability-registry";
import type { WorkspaceContext } from "@/lib/practice/access";

// THE CAPABILITY ACTIVATION ENGINE -- CPR-CAP-001 s6, over migration 278.
//
// ====================================================================================================
// ⚠ ACTIVATION IS NOT PERMISSION, AND THIS MODULE IS WHERE THAT COULD MOST EASILY BE BROKEN.
//
//   practice_role_assignment.capability_code   what a USER may do       SECURITY     not touched here
//   practice_capability_activation             what a PRACTICE has on   COMMERCIAL   this module
//
// The effective gate on any surface is BOTH: the practice has activated the capability AND the user
// holds the permission. Neither is derived from the other, in either direction:
//
//   * deactivateCapability("CP.ENCOUNTERS") writes ONE table and it is not the permission table. Nobody
//     loses encounter.edit. A practice that switches a product off for a month and back on has not
//     demoted its own staff.
//   * Granting encounter.edit activates nothing. Adding a colleague cannot switch on a product the
//     practice never bought.
//
// ⚠ THIS MODULE MUST NEVER READ OR WRITE practice_role_assignment, practice_role_capabilities OR
// practice_membership. scripts/practice-capability-harness.ts scans this file (comments stripped first,
// or the scan would match this very paragraph) and asserts those three names do not appear, and then
// proves both directions against a live database with a control on each.
//
// The one permission this module DOES read is the caller's own right to change configuration --
// practice.settings.manage, an existing code seeded on practice_owner by migration 191. It is read from
// the context that was already resolved, never from the permission tables, and it gates the VERB, not
// the capability being changed.
// ====================================================================================================
//
// ⚠ SERVER ONLY. It imports audit, which writes to the database. A "use client" component must import
// TYPES from here and VALUES from capability-registry.ts, which is import-free on purpose.

/* eslint-disable @typescript-eslint/no-explicit-any */

/** The existing permission that governs changing practice configuration. NOT a CP.* code. */
export const SETTINGS_CAPABILITY = "practice.settings.manage";

export const ACTIVATION_TABLE = "practice_capability_activation";
export const ACTIVATION_EVENT_TABLE = "practice_capability_activation_event";

/**
 * THREE STATES, ALWAYS, AND THE THIRD ONE IS THE POINT.
 *
 *   "active"    the practice has this, and we read that from somewhere
 *   "inactive"  the practice genuinely does not have this
 *   "unknown"   THE STORE COULD NOT BE READ. Not "off". Not "on". Unknown.
 */
export type CapabilityState = "active" | "inactive" | "unknown";

/** Where the state came from, so a screen can distinguish a decision from a default. */
export type CapabilityOrigin = "stored" | "registry_default" | "unreadable";

export type CapabilityStatus = {
  id: CapabilityId;
  displayName: string;
  area: string;
  state: CapabilityState;
  origin: CapabilityOrigin;
  /** How the stored row came to be: explicit, dependency, mode_preset. Null when there is no row. */
  source: string | null;
  /** ⚠ PROVENANCE ONLY. Which preset last wrote this row. Nothing decides availability from it. */
  modeCode: string | null;
  activatedAt: string | null;
  activatedBy: string | null;
  deactivatedAt: string | null;
  deactivatedBy: string | null;
  requires: CapabilityId[];
  requiresSetup: SetupKey[];
  recommends: CapabilityId[];
  defaultState: CapabilityDefault;
  /**
   * What deactivating this would affect (s6 bullet four), limited to what is ACTIVE right now.
   * ⚠ NULL, NOT [], WHEN THE STORE IS UNREADABLE. An empty list reads as "nothing would be affected",
   * which is a promise this engine cannot make when it could not see the store.
   */
  activeDependents: CapabilityId[] | null;
};

export type CapabilityResolution = {
  workspaceId: string;
  /** False when the activation store could not be read. Every consumer must branch on this. */
  readable: boolean;
  /** The database's own words when readable is false. Null otherwise. */
  error: string | null;
  statuses: CapabilityStatus[];
  /**
   * ⚠ NULL WHEN UNREADABLE, NEVER [].
   *
   * An empty array is a legitimate answer -- a practice that has switched everything off -- so the two
   * cases have to be different values or a caller will eventually treat a failed read as a practice
   * with no product. This is the doctrine "a failed read is never a zero", made unrepresentable rather
   * than written down and hoped for.
   */
  active: CapabilityId[] | null;
  /** Provenance for the console. Not consulted by anything that decides availability. */
  lastAppliedMode: { modeId: PracticeModeId; appliedAt: string } | null;
};

type StoredRow = {
  capability_code: string;
  state: string;
  source: string | null;
  mode_code: string | null;
  activated_at: string | null;
  activated_by: string | null;
  deactivated_at: string | null;
  deactivated_by: string | null;
};

export type EngineFailure = {
  ok: false;
  status: number;
  code: string;
  message: string;
  /** Named on DEPENDENTS_ACTIVE, so the caller can say WHICH rather than "some". */
  dependents?: CapabilityId[];
};
export type EngineResult<T> = { ok: true; data: T } | EngineFailure;

const fail = (status: number, code: string, message: string, dependents?: CapabilityId[]): EngineFailure =>
  dependents ? { ok: false, status, code, message, dependents } : { ok: false, status, code, message };

// ====================================================================================================
// READING
// ====================================================================================================

/**
 * What this practice has switched on.
 *
 * ⚠ THE FAILURE POSTURE, AND WHY IT IS THIS ONE.
 *
 * If the read fails, this returns readable:false, active:null and every state "unknown". It does NOT
 * return an empty set, and it does NOT quietly fall back to the registry defaults either -- falling back
 * to defaults would report CP.ENCOUNTERS as inactive for a practice that has been recording
 * consultations for a year, which is a confident wrong answer dressed as a safe one.
 *
 * What a CONSUMER should do with "unknown" is a separate decision and it is not the same in both
 * directions, so it is two functions rather than one flag:
 *
 *   capabilityAvailable()     unknown resolves to AVAILABLE. Rendering. See its own comment.
 *   requireWritableStore()    unknown resolves to REFUSE. Changing activation.
 *
 * ⚠ ABSENCE OF A ROW IS THE REGISTRY DEFAULT, NOT "OFF" -- see defaultActive() in the registry and
 * section 1 of migration 278. Every practice provisioned before 278 has no rows at all.
 */
export async function resolveCapabilities(admin: any, workspaceId: string): Promise<CapabilityResolution> {
  const { data, error } = await admin
    .from(ACTIVATION_TABLE)
    .select("capability_code, state, source, mode_code, activated_at, activated_by, deactivated_at, deactivated_by")
    .eq("workspace_id", workspaceId);

  if (error) return unreadable(workspaceId, error.message ?? "the activation store could not be read");

  const rows = (data ?? []) as StoredRow[];
  const byCode = new Map<string, StoredRow>();
  for (const r of rows) byCode.set(r.capability_code, r);

  const stateOf = (id: CapabilityId): boolean => {
    const row = byCode.get(id);
    return row ? row.state === "active" : defaultActive(id);
  };
  const active = CAPABILITY_REGISTRY.map(c => c.id).filter(stateOf);
  const activeSet = new Set(active);

  const statuses: CapabilityStatus[] = CAPABILITY_REGISTRY.map(def => {
    const row = byCode.get(def.id);
    return {
      id: def.id,
      displayName: def.displayName,
      area: def.area,
      state: (stateOf(def.id) ? "active" : "inactive") as CapabilityState,
      origin: (row ? "stored" : "registry_default") as CapabilityOrigin,
      source: row?.source ?? null,
      modeCode: row?.mode_code ?? null,
      activatedAt: row?.activated_at ?? null,
      activatedBy: row?.activated_by ?? null,
      deactivatedAt: row?.deactivated_at ?? null,
      deactivatedBy: row?.deactivated_by ?? null,
      requires: [...def.requires],
      requiresSetup: [...def.requiresSetup],
      recommends: [...def.recommends],
      defaultState: def.defaultState,
      activeDependents: dependentClosure(def.id).filter(d => activeSet.has(d)),
    };
  });

  // ⚠ PROVENANCE, DERIVED, NEVER AUTHORITATIVE. The most recently applied preset, read off the rows it
  // wrote. There is no mode column on the workspace and nothing above consults this to decide a state --
  // s5's "modes are presets only" is enforced by the resolver simply not having a mode to consult.
  let lastAppliedMode: CapabilityResolution["lastAppliedMode"] = null;
  for (const r of rows) {
    if (!r.mode_code || !r.activated_at) continue;
    if (!lastAppliedMode || r.activated_at > lastAppliedMode.appliedAt) {
      lastAppliedMode = { modeId: r.mode_code as PracticeModeId, appliedAt: r.activated_at };
    }
  }

  return { workspaceId, readable: true, error: null, statuses, active, lastAppliedMode };
}

function unreadable(workspaceId: string, message: string): CapabilityResolution {
  return {
    workspaceId,
    readable: false,
    error: message,
    active: null,
    lastAppliedMode: null,
    statuses: CAPABILITY_REGISTRY.map(def => ({
      id: def.id,
      displayName: def.displayName,
      area: def.area,
      state: "unknown" as CapabilityState,
      origin: "unreadable" as CapabilityOrigin,
      source: null,
      modeCode: null,
      activatedAt: null,
      activatedBy: null,
      deactivatedAt: null,
      deactivatedBy: null,
      requires: [...def.requires],
      requiresSetup: [...def.requiresSetup],
      recommends: [...def.recommends],
      defaultState: def.defaultState,
      activeDependents: null,
    })),
  };
}

/** The raw three-state answer. Callers that must distinguish "off" from "we do not know" use this. */
export function capabilityStateOf(res: CapabilityResolution, id: string): CapabilityState {
  return res.statuses.find(s => s.id === id)?.state ?? "inactive";
}

/**
 * The RENDERING question: may this surface be shown?
 *
 * ⚠ AN UNREADABLE STORE RESOLVES TO TRUE, DELIBERATELY, AND HERE IS THE DEFENCE.
 *
 * Activation is COMMERCIAL, not security. The two failure modes are not symmetrical:
 *
 *   fail closed  a transient PostgREST error blanks a working practice's entire product. Calendar gone,
 *                patients gone, mid-clinic. The practitioner has no way to tell this from data loss.
 *   fail open    for the length of the outage, a practice can see a surface it did not switch on.
 *
 * The second is a commercial leak measured in minutes. The first is a practitioner standing in front of
 * a patient with an empty screen. And crucially, FAILING OPEN HERE OPENS NOTHING SECURITY-RELEVANT: the
 * permission gate lives in a different table, is read by a different function, and still refuses --
 * which is exactly why the two axes were kept independent.
 *
 * ⚠ THE OBLIGATION THAT COMES WITH IT: a caller that renders on an unknown MUST say so. res.readable and
 * res.error exist for that, and the console prints a plain sentence rather than pretending.
 *
 * ⚠ AND THIS IS NOT THE POSTURE FOR CHANGING ANYTHING -- see requireWritableStore.
 */
export function capabilityAvailable(res: CapabilityResolution, id: string): boolean {
  const state = capabilityStateOf(res, id);
  return state === "active" || state === "unknown";
}

/**
 * The WRITING question, and the opposite answer.
 *
 * Every change here is computed FROM the current state: which dependencies are missing, which dependents
 * would be stranded, whether this is already on. A write built on a baseline that could not be read is a
 * guess, and it would be written as though it were a decision. So an unreadable store refuses.
 */
export function requireWritableStore(res: CapabilityResolution): EngineFailure | null {
  if (res.readable) return null;
  return fail(503, "CAPABILITY_STORE_UNREADABLE",
    `what your practice has switched on could not be read, so nothing was changed: ${res.error ?? "unknown reason"}`);
}

/**
 * s6 bullet four, as a question you can ask BEFORE pressing anything: what would this deactivation
 * affect? Pure over a resolution -- no second read, so the warning a practitioner sees and the check the
 * write performs cannot disagree.
 */
export function planDeactivation(res: CapabilityResolution, id: CapabilityId): {
  readable: boolean;
  /** Null when the store could not be read. Never [] in that case. */
  dependents: CapabilityId[] | null;
} {
  if (!res.readable) return { readable: false, dependents: null };
  const activeSet = new Set(res.active ?? []);
  return { readable: true, dependents: dependentClosure(id).filter(d => activeSet.has(d)) };
}

// ====================================================================================================
// WRITING
// ====================================================================================================

type Actor = { actorId: string; correlationId?: string; reason?: string | null };

type ChangeSpec = {
  capability: CapabilityId;
  next: "active" | "inactive";
  source: "explicit" | "dependency" | "mode_preset" | "provisioning_default";
  modeCode: PracticeModeId | null;
};

export type ActivationOutcome = {
  /** Capabilities whose state this call CHANGED. */
  changed: CapabilityId[];
  /** Already in the requested state. Named separately so a screen does not claim work it did not do. */
  unchanged: CapabilityId[];
  /** s6 bullet two: required dependencies activated in the same flow as the thing that needed them. */
  dependenciesActivated: CapabilityId[];
  /**
   * s6 bullet two's other half: the configuration artefacts this now needs.
   * ⚠ THIS IS THE REQUIREMENT, NOT A COMPLETION CHECK. Whether the practice has actually entered a
   * location is a live read against configuration this module does not own, and answering it from here
   * would mean inventing it.
   */
  setupRequired: SetupKey[];
  /** s4's "recommended", offered and never enforced. */
  recommended: CapabilityId[];
  /** Only on deactivation: dependents switched off alongside, because they would otherwise be stranded. */
  dependentsDeactivated: CapabilityId[];
};

const emptyOutcome = (): ActivationOutcome => ({
  changed: [], unchanged: [], dependenciesActivated: [], setupRequired: [], recommended: [],
  dependentsDeactivated: [],
});

function guardCaller(ctx: WorkspaceContext): EngineFailure | null {
  // ⚠ THE VERB IS GATED, NOT THE CAPABILITY. The right to change what this practice has switched on is
  // practice.settings.manage -- the same existing permission that governs the timezone, the booking
  // rules and the registration form. No CP.* code was invented for it, and nothing here consults the
  // permission TABLES: the context was resolved once, at the edge, by access.ts.
  if (!ctx.capabilities.includes(SETTINGS_CAPABILITY)) {
    return fail(403, "FORBIDDEN", "changing what this practice has switched on needs practice settings permission");
  }
  return null;
}

/**
 * s6 bullets one and two: selecting a capability identifies its required dependencies, and they are
 * activated in the same flow.
 *
 * ⚠ RECOMMENDED DEPENDENCIES ARE REPORTED, NOT ACTIVATED. s4 writes "Encounters recommended" for three
 * capabilities and the word is load bearing: a practice that wants to keep track of a scan should not
 * be handed a consultation record it did not ask for.
 */
export async function activateCapability(
  admin: any, ctx: WorkspaceContext,
  input: { capability: string } & Actor,
): Promise<EngineResult<ActivationOutcome>> {
  const denied = guardCaller(ctx);
  if (denied) return denied;
  if (!isCapabilityId(input.capability)) {
    return fail(400, "UNKNOWN_CAPABILITY", `${input.capability} is not a capability in the registry`);
  }
  const target = input.capability;

  const res = await resolveCapabilities(admin, ctx.workspaceId);
  const blocked = requireWritableStore(res);
  if (blocked) return blocked;

  const activeSet = new Set(res.active ?? []);
  const closure = requiredClosure([target]);
  const specs: ChangeSpec[] = closure
    .filter(id => !activeSet.has(id))
    .map(id => ({
      capability: id,
      next: "active" as const,
      source: id === target ? ("explicit" as const) : ("dependency" as const),
      modeCode: null,
    }));

  const write = await applyChanges(admin, ctx.workspaceId, specs, input);
  if (!write.ok) return write;

  const outcome = emptyOutcome();
  outcome.changed = write.data;
  outcome.unchanged = closure.filter(id => activeSet.has(id));
  outcome.dependenciesActivated = write.data.filter(id => id !== target);
  outcome.setupRequired = setupClosure([target]);
  outcome.recommended = recommendedFor([target]).filter(id => !activeSet.has(id) && !write.data.includes(id));
  return { ok: true, data: outcome };
}

/**
 * s6 bullets four and five.
 *
 *   "Deactivation must warn when dependent capabilities would be affected."
 *   "Deactivation hides workflow surfaces but must not delete historical patient or audit data."
 *
 * ⚠ IT WARNS FIRST AND REFUSES. Without acknowledgeDependents, a deactivation that would strand an
 * active dependent returns DEPENDENTS_ACTIVE and NAMES them. It does not cascade quietly, because
 * "switch off Documents" and "switch off Documents, Investigations, Treatments, Procedures, Quick
 * Encounters and Follow-ups" are different acts and only one of them was asked for.
 *
 * ⚠ AND WHEN ACKNOWLEDGED IT DOES SWITCH THEM OFF, rather than leaving CP.FOLLOWUPS standing on a
 * CP.CALENDAR that is gone. A store that contradicts its own dependency rules is worse than either
 * answer, and the practitioner has now been told exactly which ones and agreed.
 *
 * ⚠ NOTHING IS DELETED. Not a patient, not an encounter, not an audit row, not even this table's own
 * row -- the row is UPDATED to inactive and keeps its activation stamps, so "on in March, off in July"
 * survives as one fact. There is no foreign key from this schema to any clinical table, which is the
 * strongest available form of that guarantee: there is no path along which a switch could reach a record.
 */
export async function deactivateCapability(
  admin: any, ctx: WorkspaceContext,
  input: { capability: string; acknowledgeDependents?: boolean } & Actor,
): Promise<EngineResult<ActivationOutcome>> {
  const denied = guardCaller(ctx);
  if (denied) return denied;
  if (!isCapabilityId(input.capability)) {
    return fail(400, "UNKNOWN_CAPABILITY", `${input.capability} is not a capability in the registry`);
  }
  const target = input.capability;

  const res = await resolveCapabilities(admin, ctx.workspaceId);
  const blocked = requireWritableStore(res);
  if (blocked) return blocked;

  const plan = planDeactivation(res, target);
  const dependents = plan.dependents ?? [];
  if (dependents.length > 0 && input.acknowledgeDependents !== true) {
    const names = dependents.map(d => capabilityDef(d)?.displayName ?? d).join(", ");
    return fail(409, "DEPENDENTS_ACTIVE",
      `switching this off would also switch off ${names}, because ${dependents.length === 1 ? "it depends" : "they depend"} on it`,
      dependents);
  }

  const activeSet = new Set(res.active ?? []);
  // ⚠ ALREADY OFF IS NOT A CHANGE, AND MUST NOT BE REPORTED AS ONE. A screen that says "Documents
  // switched off" over a Documents that was already off has told somebody something false about their
  // own practice, and the audit trail would carry a deactivation that deactivated nothing.
  const toWrite = [...dependents, target].filter(id => activeSet.has(id));
  if (toWrite.length === 0) {
    const outcome = emptyOutcome();
    outcome.unchanged = [target];
    return { ok: true, data: outcome };
  }

  // A capability sitting on its registry default with no stored row still gets a row written here, so
  // that "off" is RECORDED rather than inferred from a silence which means the opposite.
  const specs: ChangeSpec[] = toWrite.map(id => ({
    capability: id, next: "inactive" as const, source: id === target ? "explicit" : "dependency", modeCode: null,
  }));

  const write = await applyChanges(admin, ctx.workspaceId, specs, input);
  if (!write.ok) return write;

  const outcome = emptyOutcome();
  outcome.changed = write.data;
  outcome.unchanged = [target, ...dependents].filter(id => !write.data.includes(id));
  outcome.dependentsDeactivated = write.data.filter(id => id !== target);
  return { ok: true, data: outcome };
}

/**
 * s5. A preset, applied.
 *
 * ⚠ IT ADDS AND IT NEVER SUBTRACTS, AND THAT IS WHAT MAKES IT A PRESET RATHER THAN A TIER.
 *
 * Applying "Booking Only" to a practice that has switched Quick Encounters on LEAVES QUICK ENCOUNTERS
 * ON. A preset that reset everything outside its own list would be a product tier wearing a preset's
 * clothes: it would take away work a practitioner had already done, and s5's last line forbids exactly
 * that -- "Modes are presets only. A practice may activate or deactivate individual capabilities."
 *
 * ⚠ AND NOTHING RECORDS THE MODE AS THE PRACTICE'S TIER. Each row it writes carries mode_code as
 * PROVENANCE, so the console can say which preset switched a thing on. No reader consults a mode to
 * decide what is active, so an individual choice made afterwards cannot be overridden by one.
 */
export async function applyPracticeMode(
  admin: any, ctx: WorkspaceContext,
  input: { mode: string } & Actor,
): Promise<EngineResult<ActivationOutcome & { mode: PracticeModeId }>> {
  const denied = guardCaller(ctx);
  if (denied) return denied;
  const mode = practiceMode(input.mode);
  if (!mode) return fail(400, "UNKNOWN_MODE", `${input.mode} is not a practice mode`);

  const res = await resolveCapabilities(admin, ctx.workspaceId);
  const blocked = requireWritableStore(res);
  if (blocked) return blocked;

  const activeSet = new Set(res.active ?? []);
  const selection = modeSelection(mode.id);
  const specs: ChangeSpec[] = selection
    .filter(id => !activeSet.has(id))
    .map(id => ({ capability: id, next: "active" as const, source: "mode_preset" as const, modeCode: mode.id }));

  const write = await applyChanges(admin, ctx.workspaceId, specs, input);
  if (!write.ok) return write;

  const outcome = emptyOutcome();
  outcome.changed = write.data;
  outcome.unchanged = selection.filter(id => activeSet.has(id));
  outcome.dependenciesActivated = write.data.filter(id => !mode.selects.includes(id));
  outcome.setupRequired = setupClosure(mode.selects);
  outcome.recommended = recommendedFor(mode.selects).filter(id => !activeSet.has(id) && !write.data.includes(id));
  return { ok: true, data: { ...outcome, mode: mode.id } };
}

/**
 * The one place a row is written.
 *
 * ⚠ THE UPSERT'S ERROR IS NEVER DISCARDED. ux_practice_capability_activation is a FULL unique index on
 * two NOT NULL columns precisely so that PostgREST can name it in on_conflict -- a partial index cannot
 * be named, and an upsert against one writes nothing while reporting success. That trap has cost this
 * codebase two silent write failures already, which is why the index was built for the upsert rather
 * than the upsert fitted to an index.
 *
 * ⚠ THE ROW IS REBUILT FROM ITS PREVIOUS SELF. An upsert REPLACES, so deactivating without carrying the
 * activation stamps forward would erase when the capability was first switched on -- and the CHECK in
 * migration 278 would then be satisfied by a row that had quietly lost half its history.
 */
async function applyChanges(
  admin: any, workspaceId: string, specs: ChangeSpec[], actor: Actor,
): Promise<EngineResult<CapabilityId[]>> {
  if (specs.length === 0) return { ok: true, data: [] };

  const { data: existing, error: readErr } = await admin
    .from(ACTIVATION_TABLE)
    .select("capability_code, state, activated_at, activated_by, deactivated_at, deactivated_by")
    .eq("workspace_id", workspaceId)
    .in("capability_code", specs.map(s => s.capability));
  // ⚠ A FAILED READ IS NOT AN EMPTY SET. Treating it as one would rebuild every row from nothing and
  // erase the stamps this function exists to preserve.
  if (readErr) {
    return fail(503, "CAPABILITY_STORE_UNREADABLE",
      `the current activation rows could not be read, so nothing was changed: ${readErr.message}`);
  }
  const before = new Map<string, any>();
  for (const r of (existing ?? []) as any[]) before.set(r.capability_code, r);

  const now = new Date().toISOString();
  const rows = specs.map(spec => {
    const prev = before.get(spec.capability);
    const base = {
      workspace_id: workspaceId,
      capability_code: spec.capability,
      state: spec.next,
      source: spec.source,
      mode_code: spec.modeCode,
      updated_at: now,
    };
    return spec.next === "active"
      ? {
          ...base,
          activated_at: now,
          activated_by: actor.actorId,
          deactivated_at: prev?.deactivated_at ?? null,
          deactivated_by: prev?.deactivated_by ?? null,
        }
      : {
          ...base,
          // Null when it was never stored: this capability was on because the registry said so, and
          // inventing a date for that would be a fact nobody recorded.
          activated_at: prev?.activated_at ?? null,
          activated_by: prev?.activated_by ?? null,
          deactivated_at: now,
          deactivated_by: actor.actorId,
        };
  });

  const { error: writeErr } = await admin
    .from(ACTIVATION_TABLE)
    .upsert(rows, { onConflict: "workspace_id,capability_code" });
  if (writeErr) {
    return fail(500, "ACTIVATION_WRITE_FAILED", `the change could not be saved: ${writeErr.message}`);
  }

  // s8: "Every activation/deactivation is auditable." Two writes, on purpose. practice_audit_event is
  // append-only since migration 247 and is the trail somebody investigates. The event table is the
  // queryable projection, so "when was Documents switched off and by whom" is one indexed read.
  const events = specs.map(spec => ({
    workspace_id: workspaceId,
    capability_code: spec.capability,
    action: spec.next === "active" ? "activate" : "deactivate",
    state_before: (before.get(spec.capability)?.state as string | undefined) ?? null,
    state_after: spec.next,
    source: spec.source,
    mode_code: spec.modeCode,
    actor_id: actor.actorId,
    correlation_id: actor.correlationId ?? null,
    reason: actor.reason && actor.reason.trim() !== "" ? actor.reason.trim() : null,
    occurred_at: now,
  }));
  const { error: eventErr } = await admin.from(ACTIVATION_EVENT_TABLE).insert(events);
  // ⚠ REPORTED, NOT DISCARDED, AND NOT THROWN. A history write that failed must not unwind a change that
  // succeeded, but a trail with a hole in it is indistinguishable from a quiet afternoon -- so it goes
  // where somebody is watching. Same reasoning as audit() itself.
  if (eventErr) {
    console.error(`[practice] capability activation history was NOT recorded for ${workspaceId}: ${eventErr.message}`);
  }

  for (const spec of specs) {
    await audit(admin, {
      workspaceId,
      actorId: actor.actorId,
      eventType: spec.next === "active" ? "practice.capability_activated" : "practice.capability_deactivated",
      payload: {
        capability: spec.capability,
        source: spec.source,
        modeCode: spec.modeCode,
        stateBefore: (before.get(spec.capability)?.state as string | undefined) ?? null,
        // ⚠ SAID IN THE TRAIL ITSELF, because this is the sentence somebody reading it a year from now
        // will need: the switch changed a product, not a permission.
        note: "commercial activation only. No user permission was granted or revoked by this change.",
      },
      correlationId: actor.correlationId,
    });
  }

  return { ok: true, data: specs.map(s => s.capability) };
}
