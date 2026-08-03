import { audit } from "@/lib/practice/provisioning";
import type { EngineResult } from "@/lib/practice/encounters";
import { practiceToday } from "@/lib/practice/practice-time";

// CPR-360 CONFIGURATION.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// CHANGING THE TIMEZONE RETROACTIVELY CHANGES WHAT "TODAY" MEANT.
//
// This is the reason this module needed care rather than a form. The whole product derives from the
// practice clock: CPR-140 computes overdue from due_on against today, CPR-300 builds the day window,
// CPR-330 resolves reporting periods. All of them read practice_workspace.timezone AT READ TIME. So
// correcting a timezone does not just change the future -- it changes what every one of those
// calculations would have said, for every date already recorded.
//
// That is still the right thing to allow. A practice provisioned into the wrong zone has had a wrong
// clock since day one and no way to fix it, which is worse. But it must be LOUD: the change is
// recorded with both values, the caller is told what it affects, and the engine refuses a value it
// cannot verify.
//
// AND IT MUST BE VALIDATED HERE, because the read path cannot. practiceToday() falls back to UTC on an
// unknown zone rather than throwing -- deliberately, so a bad value never takes a page down. That
// fallback is silent by design, which makes validation at the point of WRITE the only place a typo can
// be caught at all. "Africa/Kampla" would otherwise move a whole practice to UTC and say nothing.
// ────────────────────────────────────────────────────────────────────────────────────────────────────
//
// NO NEW TRAIL TABLE: configuration changes go to practice_audit_event, which is the workspace-wide
// operational log and already carries actor, payload and correlation id. See migration 203's header.

/* eslint-disable @typescript-eslint/no-explicit-any */

const nowIso = () => new Date().toISOString();

export const ENCOUNTER_MODES = [
  ["in_person", "In person"],
  ["teleconsultation", "Teleconsultation"],
  ["outreach", "Outreach"],
  ["mixed", "Mixed"],
] as const;

export const LOCATION_TYPES = [
  ["clinic", "Clinic"],
  ["hospital", "Hospital"],
  ["outreach", "Outreach site"],
  ["teleconsultation", "Teleconsultation"],
  ["independent", "Independent practice"],
] as const;

export const APPOINTMENT_MINUTES_BOUNDS = { min: 5, max: 240 } as const;

/**
 * Is this a timezone the platform actually knows?
 *
 * Intl throws on an unknown zone, which is the only reliable check available without shipping a copy of
 * the tz database. A zone the platform cannot resolve is one practiceToday() would silently treat as
 * UTC, so it is refused here rather than accepted and quietly ignored.
 */
export function isKnownTimezone(tz: string): boolean {
  if (!tz || !tz.includes("/")) return false;
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

/**
 * The effective configuration, with the workspace facts that belong beside it.
 *
 * CREATES THE ROW IF PROVISIONING NEVER DID. Every workspace should have one -- provisioning writes it
 * -- but a workspace provisioned before that step existed, or one where the step failed and was marked
 * succeeded, would otherwise have no configuration at all and every default would come from nowhere.
 */
export async function getConfiguration(admin: any, workspaceId: string) {
  const [{ data: workspace }, { data: config }] = await Promise.all([
    admin.from("practice_workspace")
      .select("id, name, type, status, timezone, default_practice_type, country").eq("id", workspaceId).maybeSingle(),
    admin.from("practice_configuration")
      .select("*").eq("workspace_id", workspaceId).eq("is_effective", true).maybeSingle(),
  ]);
  if (!workspace) return null;

  let effective = config;
  if (!effective) {
    const { data: created } = await admin.from("practice_configuration")
      .insert({ workspace_id: workspaceId }).select("*").single();
    effective = created;
  }

  return {
    workspace,
    config: effective,
    today: practiceToday(workspace.timezone),
    // Named on the page: the columns migration 191 created and nothing has ever honoured. Listing them
    // is more honest than rendering inputs that write to a value no code reads.
    inertColumns: ["identifier_policy", "feature_flags", "date_format"],
  };
}

/** What the diary should default to, read rather than hardcoded. Falls back to the old constant. */
export async function defaultAppointmentMinutes(admin: any, workspaceId: string): Promise<number> {
  const { data } = await admin.from("practice_configuration")
    .select("default_appointment_minutes").eq("workspace_id", workspaceId).eq("is_effective", true).maybeSingle();
  return data?.default_appointment_minutes ?? 20;
}

export async function updateConfiguration(admin: any, args: {
  workspaceId: string; practiceName?: string; timezone?: string;
  locale?: string; defaultEncounterMode?: string; defaultAppointmentMinutes?: number;
  letterheadName?: string; letterheadRegistration?: string; letterheadAddress?: string;
  letterheadContact?: string; letterheadFooter?: string;
  actorId: string; correlationId: string;
}): Promise<EngineResult<{ changed: string[]; timezoneChangedFrom: string | null }>> {
  const current = await getConfiguration(admin, args.workspaceId);
  if (!current) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };

  const changed: string[] = [];
  const workspacePatch: Record<string, unknown> = {};
  const configPatch: Record<string, unknown> = {};
  let timezoneChangedFrom: string | null = null;

  if (args.practiceName !== undefined) {
    const name = args.practiceName.trim();
    if (!name) return { ok: false, status: 400, code: "VALIDATION_ERROR", message: "a practice needs a name" };
    if (name !== current.workspace.name) { workspacePatch.name = name; changed.push("name"); }
  }

  if (args.timezone !== undefined && args.timezone !== current.workspace.timezone) {
    // SEE THE HEADER. The read path falls back to UTC silently, so this is the only place a typo is
    // catchable at all.
    if (!isKnownTimezone(args.timezone))
      return {
        ok: false, status: 400, code: "UNKNOWN_TIMEZONE",
        message: `"${args.timezone}" is not a timezone this platform knows; the clock would silently fall back to UTC`,
      };
    workspacePatch.timezone = args.timezone;
    timezoneChangedFrom = current.workspace.timezone;
    changed.push("timezone");
  }

  if (args.locale !== undefined && args.locale !== current.config.locale) {
    configPatch.locale = args.locale.trim();
    changed.push("locale");
  }

  if (args.defaultEncounterMode !== undefined && args.defaultEncounterMode !== current.config.default_encounter_mode) {
    if (!ENCOUNTER_MODES.some(([m]) => m === args.defaultEncounterMode))
      return { ok: false, status: 400, code: "VALIDATION_ERROR", message: `mode must be one of: ${ENCOUNTER_MODES.map(([m]) => m).join(", ")}` };
    configPatch.default_encounter_mode = args.defaultEncounterMode;
    changed.push("default encounter mode");
  }

  if (args.defaultAppointmentMinutes !== undefined && args.defaultAppointmentMinutes !== current.config.default_appointment_minutes) {
    const n = args.defaultAppointmentMinutes;
    if (!Number.isInteger(n) || n < APPOINTMENT_MINUTES_BOUNDS.min || n > APPOINTMENT_MINUTES_BOUNDS.max)
      return {
        ok: false, status: 400, code: "VALIDATION_ERROR",
        message: `appointment length must be a whole number between ${APPOINTMENT_MINUTES_BOUNDS.min} and ${APPOINTMENT_MINUTES_BOUNDS.max} minutes`,
      };
    configPatch.default_appointment_minutes = n;
    changed.push("default appointment length");
  }

  // LETTERHEAD (CPR-330 practice branding, migration 204). Every field optional and every field
  // blankable: a practice that clears its registration number gets a letterhead without one, not a
  // letterhead with the old one. An empty string therefore means null, deliberately.
  for (const [arg, column, label] of [
    ["letterheadName", "letterhead_name", "letterhead name"],
    ["letterheadRegistration", "letterhead_registration", "letterhead registration"],
    ["letterheadAddress", "letterhead_address", "letterhead address"],
    ["letterheadContact", "letterhead_contact", "letterhead contact"],
    ["letterheadFooter", "letterhead_footer", "letterhead footer"],
  ] as const) {
    const raw = (args as Record<string, unknown>)[arg];
    if (raw === undefined) continue;
    const next = String(raw).trim() || null;
    if (next !== ((current.config as Record<string, unknown>)[column] ?? null)) {
      configPatch[column] = next;
      changed.push(label);
    }
  }

  if (changed.length === 0)
    return { ok: false, status: 422, code: "NO_CHANGE", message: "nothing was different" };

  if (Object.keys(workspacePatch).length > 0) {
    const { error } = await admin.from("practice_workspace")
      .update({ ...workspacePatch, updated_at: nowIso() }).eq("id", args.workspaceId);
    if (error) return { ok: false, status: 422, code: "REFUSED_BY_DATABASE", message: error.message };
  }
  if (Object.keys(configPatch).length > 0) {
    const { error } = await admin.from("practice_configuration")
      .update({ ...configPatch, config_version: (current.config.config_version ?? 1) + 1, updated_at: nowIso() })
      .eq("id", current.config.id);
    if (error) return { ok: false, status: 422, code: "REFUSED_BY_DATABASE", message: error.message };
  }

  // BOTH VALUES IN THE PAYLOAD, not just the new one. "The timezone is Africa/Kampala" does not answer
  // "why did last month's report change"; "it was Africa/Nairobi until the 3rd" does.
  await audit(admin, {
    workspaceId: args.workspaceId, actorId: args.actorId, eventType: "practice.configuration_changed",
    payload: {
      changed,
      ...(timezoneChangedFrom ? { timezoneFrom: timezoneChangedFrom, timezoneTo: args.timezone } : {}),
      ...(configPatch.default_appointment_minutes !== undefined
        ? { appointmentMinutesFrom: current.config.default_appointment_minutes, appointmentMinutesTo: configPatch.default_appointment_minutes }
        : {}),
    },
    correlationId: args.correlationId,
  });

  return { ok: true, data: { changed, timezoneChangedFrom } };
}

/** The trail behind the settings, read from the workspace audit log rather than a table of its own. */
export async function configurationHistory(admin: any, workspaceId: string, limit = 20) {
  const { data } = await admin.from("practice_audit_event")
    .select("event_type, payload, actor_id, occurred_at")
    .eq("workspace_id", workspaceId).eq("event_type", "practice.configuration_changed")
    .order("occurred_at", { ascending: false }).limit(limit);
  const rows = (data ?? []) as any[];
  if (rows.length === 0) return [];

  const actorIds = [...new Set(rows.map(r => r.actor_id).filter(Boolean))];
  const { data: profiles } = actorIds.length
    ? await admin.from("profiles").select("id, full_name").in("id", actorIds)
    : { data: [] };
  const nameOf = new Map(((profiles ?? []) as any[]).map(p => [p.id, p.full_name]));
  return rows.map(r => ({ ...r, actor_name: nameOf.get(r.actor_id) ?? null }));
}

// ── LOCATIONS ────────────────────────────────────────────────────────────────────────────────────────
//
// practice_location and practice.locations.manage have both existed since migration 191 with no way in
// the product to create one. The operations home has been counting a number nobody could change.

export async function listLocations(admin: any, workspaceId: string) {
  const { data } = await admin.from("practice_location")
    .select("id, name, type, country, active, created_at").eq("workspace_id", workspaceId).order("created_at");
  return (data ?? []) as any[];
}

export async function createLocation(admin: any, args: {
  workspaceId: string; name: string; type?: string; country?: string;
  actorId: string; correlationId: string;
}): Promise<EngineResult<{ id: string }>> {
  const name = args.name.trim();
  if (!name) return { ok: false, status: 400, code: "VALIDATION_ERROR", message: "a location needs a name" };

  const type = LOCATION_TYPES.some(([t]) => t === args.type) ? args.type! : "clinic";
  const { data: location, error } = await admin.from("practice_location").insert({
    workspace_id: args.workspaceId, name, type, country: args.country?.trim() || null, active: true,
  }).select("id").single();
  if (error) return { ok: false, status: 400, code: "VALIDATION_ERROR", message: error.message };

  await audit(admin, {
    workspaceId: args.workspaceId, actorId: args.actorId, eventType: "practice.location_created",
    payload: { locationId: location.id, name, type }, correlationId: args.correlationId,
  });
  return { ok: true, data: { id: location.id as string } };
}

/**
 * Rename a location, or take it out of use.
 *
 * DEACTIVATED RATHER THAN DELETED. Appointments and encounters reference a location, and deleting one
 * would either orphan those rows or take history with it. A closed site should stop being offered and
 * keep explaining where past consultations happened.
 *
 * THE LAST ACTIVE LOCATION CAN STILL BE DEACTIVATED, deliberately -- unlike the last owner. A practice
 * with no location is odd but workable (nothing requires one to book), whereas a practice with no owner
 * cannot be administered at all. Different stakes, different rule.
 */
export async function updateLocation(admin: any, args: {
  workspaceId: string; locationId: string; name?: string; type?: string; active?: boolean;
  actorId: string; correlationId: string;
}): Promise<EngineResult<{ changed: string[] }>> {
  const { data: location } = await admin.from("practice_location")
    .select("id, name, type, active").eq("id", args.locationId).eq("workspace_id", args.workspaceId).maybeSingle();
  if (!location) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };

  const patch: Record<string, unknown> = {};
  const changed: string[] = [];
  if (args.name !== undefined) {
    const name = args.name.trim();
    if (!name) return { ok: false, status: 400, code: "VALIDATION_ERROR", message: "a location needs a name" };
    if (name !== location.name) { patch.name = name; changed.push("name"); }
  }
  if (args.type !== undefined && args.type !== location.type) {
    if (!LOCATION_TYPES.some(([t]) => t === args.type))
      return { ok: false, status: 400, code: "VALIDATION_ERROR", message: `type must be one of: ${LOCATION_TYPES.map(([t]) => t).join(", ")}` };
    patch.type = args.type; changed.push("type");
  }
  if (args.active !== undefined && args.active !== location.active) {
    patch.active = args.active; changed.push(args.active ? "reopened" : "closed");
  }
  if (changed.length === 0)
    return { ok: false, status: 422, code: "NO_CHANGE", message: "nothing was different" };

  const { error } = await admin.from("practice_location")
    .update({ ...patch, updated_at: nowIso() }).eq("id", location.id);
  if (error) return { ok: false, status: 422, code: "REFUSED_BY_DATABASE", message: error.message };

  await audit(admin, {
    workspaceId: args.workspaceId, actorId: args.actorId, eventType: "practice.location_updated",
    payload: { locationId: location.id, changed }, correlationId: args.correlationId,
  });
  return { ok: true, data: { changed } };
}
