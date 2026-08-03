import { audit } from "@/lib/practice/provisioning";
import type { EngineResult } from "@/lib/practice/encounters";

import { getConfiguration, ENCOUNTER_MODES } from "@/lib/practice/configuration";
import {
  THEMES, ACCENTS, FONT_SCALES, DENSITIES, DASHBOARD_WIDGETS, NOTIFICATION_CATEGORIES,
  LOCKABLE_PREFERENCES, DEFAULT_PREFERENCES, type PreferenceShape,
} from "@/lib/practice/preference-constants";

// CPR-360 CONFIGURATION AND PERSONALISATION -- the personalisation half, built after CPR-AUDIT-001.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// A PREFERENCE THAT CHANGES NOTHING IS WORSE THAN A MISSING ONE.
//
// This is the rule the module turns on, and it is the same rule the settings page already followed when
// it LISTED the inert columns rather than rendering them as inputs. Every switch built here has a
// consumer: the theme and density reach the shell as data attributes, the widget list reaches the
// operations home, the notification categories filter what CPR-340 surfaces, the specialty filters the
// template library, the shortcuts drive a real key handler. Anything in the comp without a consumer is
// rendered in its designed position saying so -- not wired to a column nobody reads.
// ────────────────────────────────────────────────────────────────────────────────────────────────────
//
// PERSONAL OVERRIDES PRACTICE, EXCEPT WHERE THE PRACTICE HAS LOCKED IT (CPR-360 s5). NULL in a personal
// override column means "follow the practice", so not-choosing is representable and a personal row can
// never silently freeze a copy of a practice default.
//
// APPEARANCE IS NOT LOCKABLE. A practice may reasonably standardise its clinical defaults; it may not
// decide that somebody who needs larger text does not get it. Font size, density and reduce-visual-noise
// are accessibility settings before they are preferences, and LOCKABLE_PREFERENCES deliberately omits
// them -- enforced here rather than left to whoever writes the admin UI.

/* eslint-disable @typescript-eslint/no-explicit-any */

const nowIso = () => new Date().toISOString();

/** Read a person's preferences in a workspace, creating the row on first read. */
export async function getPreferences(admin: any, workspaceId: string, userId: string): Promise<PreferenceShape & { id: string }> {
  const { data } = await admin.from("practice_user_preference")
    .select("*").eq("workspace_id", workspaceId).eq("user_id", userId).maybeSingle();

  let row = data;
  if (!row) {
    const { data: created } = await admin.from("practice_user_preference")
      .insert({ workspace_id: workspaceId, user_id: userId }).select("*").single();
    row = created;
  }
  // A create that raced with another tab loses on the unique index; re-read rather than fail, because a
  // second browser tab is not an error condition.
  if (!row) {
    const { data: again } = await admin.from("practice_user_preference")
      .select("*").eq("workspace_id", workspaceId).eq("user_id", userId).maybeSingle();
    row = again;
  }
  if (!row) return { ...DEFAULT_PREFERENCES, id: "" };

  return {
    id: row.id,
    theme: row.theme, accent: row.accent, fontScale: row.font_scale, density: row.density,
    reduceVisualNoise: row.reduce_visual_noise === true,
    dashboardWidgets: normaliseWidgets(row.dashboard_widgets),
    notificationCategories: normaliseCategories(row.notification_categories),
    specialty: row.specialty ?? null,
    subspecialties: Array.isArray(row.subspecialties) ? row.subspecialties.map(String) : [],
    shortcutsEnabled: row.shortcuts_enabled !== false,
    defaultEncounterMode: row.default_encounter_mode ?? null,
    defaultAppointmentMinutes: row.default_appointment_minutes ?? null,
  };
}

/**
 * A saved layout is reconciled against the widgets that EXIST, every time it is read.
 *
 * A stored list is a snapshot of the page as it was on the day somebody saved it. A widget added since
 * must appear (visible, at the end) rather than be invisible to everyone with a saved layout -- which is
 * how a new feature ships to nobody. A widget removed since must drop out rather than leave a row for
 * something that no longer renders.
 */
function normaliseWidgets(stored: unknown): { key: string; visible: boolean }[] {
  const known = DASHBOARD_WIDGETS.map(([key]) => String(key));
  const saved = Array.isArray(stored) ? stored as any[] : [];
  const byKey = new Map(saved.filter(w => w && typeof w.key === "string").map(w => [String(w.key), w.visible !== false]));

  const kept = saved
    .map(w => String(w?.key ?? ""))
    .filter(k => known.includes(k))
    .filter((k, i, all) => all.indexOf(k) === i)
    .map(k => ({ key: k, visible: byKey.get(k) !== false }));

  const missing = known.filter(k => !kept.some(w => w.key === k)).map(k => ({ key: k, visible: true }));
  return [...kept, ...missing];
}

function normaliseCategories(stored: unknown): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  const saved = (stored && typeof stored === "object") ? stored as Record<string, unknown> : {};
  for (const [key, , optional] of NOTIFICATION_CATEGORIES) {
    // A category that may not be switched off is TRUE regardless of what is stored. If a stale row ever
    // held clinical:false, this is the line that stops it silencing a deterioration alert.
    out[key] = optional === false ? true : saved[key] !== false;
  }
  return out;
}

/** What the practice has locked, as a set the caller can test. */
export async function lockedPreferences(admin: any, workspaceId: string): Promise<string[]> {
  const config = await getConfiguration(admin, workspaceId);
  const raw = (config?.config as any)?.locked_preferences;
  const lockable = LOCKABLE_PREFERENCES.map(([k]) => String(k));
  return (Array.isArray(raw) ? raw.map(String) : []).filter(k => lockable.includes(k));
}

/**
 * The effective settings: personal over practice, except where the practice has locked it.
 *
 * THE PRACTICE VALUE IS RETURNED ALONGSIDE, not merged away, so the UI can say "your practice sets this"
 * rather than showing a field that silently ignores what is typed into it.
 */
export async function resolvePreferences(admin: any, workspaceId: string, userId: string) {
  const [prefs, config, locked] = await Promise.all([
    getPreferences(admin, workspaceId, userId),
    getConfiguration(admin, workspaceId),
    lockedPreferences(admin, workspaceId),
  ]);

  const practiceMode = (config?.config as any)?.default_encounter_mode ?? "in_person";
  const practiceMinutes = (config?.config as any)?.default_appointment_minutes ?? 20;

  const overridden = (key: string, personal: unknown) => !locked.includes(key) && personal !== null && personal !== undefined;

  return {
    preferences: prefs,
    locked,
    effective: {
      // Appearance has no practice-level counterpart and no lock: it is always the person's.
      theme: prefs.theme, accent: prefs.accent, fontScale: prefs.fontScale,
      density: prefs.density, reduceVisualNoise: prefs.reduceVisualNoise,
      shortcutsEnabled: prefs.shortcutsEnabled,
      dashboardWidgets: locked.includes("dashboardWidgets")
        ? normaliseWidgets(null) : prefs.dashboardWidgets,
      notificationCategories: locked.includes("notificationCategories")
        ? normaliseCategories(null) : prefs.notificationCategories,
      defaultEncounterMode: overridden("defaultEncounterMode", prefs.defaultEncounterMode)
        ? prefs.defaultEncounterMode : practiceMode,
      defaultAppointmentMinutes: overridden("defaultAppointmentMinutes", prefs.defaultAppointmentMinutes)
        ? prefs.defaultAppointmentMinutes : practiceMinutes,
    },
    practice: { defaultEncounterMode: practiceMode, defaultAppointmentMinutes: practiceMinutes },
  };
}

type UpdateInput = Partial<{
  theme: string; accent: string; fontScale: string; density: string; reduceVisualNoise: boolean;
  dashboardWidgets: { key: string; visible: boolean }[];
  notificationCategories: Record<string, boolean>;
  specialty: string | null; subspecialties: string[]; shortcutsEnabled: boolean;
  defaultEncounterMode: string | null; defaultAppointmentMinutes: number | null;
}>;

export async function updatePreferences(admin: any, args: {
  workspaceId: string; userId: string; patch: UpdateInput; correlationId: string;
}): Promise<EngineResult<{ changed: string[]; refused: string[] }>> {
  const current = await getPreferences(admin, args.workspaceId, args.userId);
  const locked = await lockedPreferences(admin, args.workspaceId);

  const patch: Record<string, unknown> = {};
  const changed: string[] = [];
  const refused: string[] = [];
  const p = args.patch;

  const enumField = (
    key: string, column: string, value: string | undefined,
    allowed: readonly (readonly [string, ...unknown[]])[], currentValue: string,
  ): string | null => {
    if (value === undefined) return null;
    if (!allowed.some(([k]) => k === value)) return `${key} must be one of: ${allowed.map(([k]) => k).join(", ")}`;
    if (value !== currentValue) { patch[column] = value; changed.push(key); }
    return null;
  };

  for (const err of [
    enumField("theme", "theme", p.theme, THEMES, current.theme),
    enumField("accent", "accent", p.accent, ACCENTS, current.accent),
    enumField("fontScale", "font_scale", p.fontScale, FONT_SCALES, current.fontScale),
    enumField("density", "density", p.density, DENSITIES, current.density),
  ]) {
    if (err) return { ok: false, status: 400, code: "VALIDATION_ERROR", message: err };
  }

  if (p.reduceVisualNoise !== undefined && p.reduceVisualNoise !== current.reduceVisualNoise) {
    patch.reduce_visual_noise = p.reduceVisualNoise === true; changed.push("reduceVisualNoise");
  }
  if (p.shortcutsEnabled !== undefined && p.shortcutsEnabled !== current.shortcutsEnabled) {
    patch.shortcuts_enabled = p.shortcutsEnabled === true; changed.push("shortcutsEnabled");
  }

  if (p.dashboardWidgets !== undefined) {
    if (locked.includes("dashboardWidgets")) refused.push("dashboardWidgets");
    else {
      const known = DASHBOARD_WIDGETS.map(([k]) => String(k));
      const unknownKey = p.dashboardWidgets.find(w => !known.includes(String(w?.key)));
      if (unknownKey)
        return { ok: false, status: 400, code: "VALIDATION_ERROR", message: `"${unknownKey.key}" is not a widget on this dashboard` };
      // NOT EVERY WIDGET MAY BE HIDDEN. A dashboard with nothing on it is a page somebody has to undo
      // from a settings screen they may not find again.
      if (p.dashboardWidgets.length > 0 && p.dashboardWidgets.every(w => w.visible === false))
        return {
          ok: false, status: 422, code: "EMPTY_DASHBOARD",
          message: "at least one widget has to stay visible; an empty dashboard cannot be undone from the dashboard",
        };
      patch.dashboard_widgets = normaliseWidgets(p.dashboardWidgets);
      changed.push("dashboardWidgets");
    }
  }

  if (p.notificationCategories !== undefined) {
    if (locked.includes("notificationCategories")) refused.push("notificationCategories");
    else {
      // A category that may not be switched off is refused loudly rather than silently coerced -- the
      // caller asked for something this product will not do, and should be told.
      const fixed = NOTIFICATION_CATEGORIES.filter(([, , optional]) => optional === false).map(([k]) => String(k));
      const silenced = fixed.find(k => p.notificationCategories![k] === false);
      if (silenced)
        return {
          ok: false, status: 422, code: "CATEGORY_NOT_OPTIONAL",
          message: `"${silenced}" notifications cannot be switched off; a preference that silences a clinical alert is a hazard with a toggle`,
        };
      patch.notification_categories = normaliseCategories(p.notificationCategories);
      changed.push("notificationCategories");
    }
  }

  if (p.specialty !== undefined) {
    const next = (p.specialty ?? "").trim() || null;
    if (next !== current.specialty) { patch.specialty = next; changed.push("specialty"); }
  }
  if (p.subspecialties !== undefined) {
    const next = (p.subspecialties ?? []).map(s => String(s).trim()).filter(Boolean).slice(0, 12);
    if (JSON.stringify(next) !== JSON.stringify(current.subspecialties)) {
      patch.subspecialties = next; changed.push("subspecialties");
    }
  }

  if (p.defaultEncounterMode !== undefined) {
    if (locked.includes("defaultEncounterMode")) refused.push("defaultEncounterMode");
    else {
      const next = p.defaultEncounterMode || null;
      if (next !== null && !ENCOUNTER_MODES.some(([m]) => m === next))
        return { ok: false, status: 400, code: "VALIDATION_ERROR", message: `mode must be one of: ${ENCOUNTER_MODES.map(([m]) => m).join(", ")}` };
      if (next !== current.defaultEncounterMode) { patch.default_encounter_mode = next; changed.push("defaultEncounterMode"); }
    }
  }
  if (p.defaultAppointmentMinutes !== undefined) {
    if (locked.includes("defaultAppointmentMinutes")) refused.push("defaultAppointmentMinutes");
    else {
      const next = p.defaultAppointmentMinutes;
      if (next !== null && (!Number.isInteger(next) || next < 5 || next > 240))
        return { ok: false, status: 400, code: "VALIDATION_ERROR", message: "a consultation length must be a whole number of minutes between 5 and 240" };
      if (next !== current.defaultAppointmentMinutes) { patch.default_appointment_minutes = next; changed.push("defaultAppointmentMinutes"); }
    }
  }

  // A REFUSED KEY IS NOT A FAILED SAVE. Somebody who changed their theme and their (locked) consultation
  // length in one form should get the theme, and be told plainly which part the practice controls.
  if (changed.length === 0) {
    if (refused.length > 0)
      return {
        ok: false, status: 422, code: "PREFERENCE_LOCKED",
        message: `your practice sets ${refused.join(", ")}; nothing else in that change was different`,
      };
    return { ok: false, status: 422, code: "NO_CHANGE", message: "nothing was different" };
  }

  const { error } = await admin.from("practice_user_preference")
    .update({ ...patch, updated_at: nowIso() })
    .eq("workspace_id", args.workspaceId).eq("user_id", args.userId);
  if (error) return { ok: false, status: 422, code: "REFUSED_BY_DATABASE", message: error.message };

  // CPR-360 s5: configuration changes are auditable. Personal ones too -- "why does their dashboard look
  // like that" is a support question, and an unlogged preference makes it unanswerable.
  await audit(admin, {
    workspaceId: args.workspaceId, actorId: args.userId, eventType: "practice.preferences_changed",
    payload: { changed, refused }, correlationId: args.correlationId,
  });

  return { ok: true, data: { changed, refused } };
}

/** Back to defaults. Deletes the row rather than rewriting it, so "default" has exactly one meaning. */
export async function resetPreferences(admin: any, args: {
  workspaceId: string; userId: string; correlationId: string;
}): Promise<EngineResult<{ reset: true }>> {
  const { error } = await admin.from("practice_user_preference")
    .delete().eq("workspace_id", args.workspaceId).eq("user_id", args.userId);
  if (error) return { ok: false, status: 422, code: "REFUSED_BY_DATABASE", message: error.message };

  await audit(admin, {
    workspaceId: args.workspaceId, actorId: args.userId, eventType: "practice.preferences_reset",
    payload: {}, correlationId: args.correlationId,
  });
  return { ok: true, data: { reset: true } };
}

/**
 * Export, for the spec's "preference backups" and "import/export settings".
 *
 * NO IDENTIFIERS IN IT. A preference file names no patient, no workspace and no user -- it is a set of
 * choices, and a backup that carried a workspace id would be a file somebody could import into the wrong
 * practice and not notice.
 */
export async function exportPreferences(admin: any, workspaceId: string, userId: string) {
  const prefs = await getPreferences(admin, workspaceId, userId);
  const { id: _id, ...rest } = prefs;
  void _id;
  return { kind: "competen-practice-preferences", version: 1, preferences: rest };
}

export async function importPreferences(admin: any, args: {
  workspaceId: string; userId: string; file: unknown; correlationId: string;
}): Promise<EngineResult<{ changed: string[]; refused: string[] }>> {
  const f = args.file as any;
  if (!f || typeof f !== "object" || f.kind !== "competen-practice-preferences")
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: "that is not a Competen Practice preferences file" };
  if (f.version !== 1)
    return { ok: false, status: 422, code: "UNSUPPORTED_VERSION", message: `this build reads version 1 files; that one is version ${f.version}` };
  if (!f.preferences || typeof f.preferences !== "object")
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: "the file carries no preferences" };

  // Straight through updatePreferences, so an imported file is validated by exactly the same rules as a
  // typed one. An import path with its own validation is a second door into the same room.
  return updatePreferences(admin, {
    workspaceId: args.workspaceId, userId: args.userId,
    patch: f.preferences as UpdateInput, correlationId: args.correlationId,
  });
}

/**
 * The comp's "Configuration Health" ring, as a COUNT AND ITS DENOMINATOR.
 *
 * The comp draws 92% Configured. There is no formula behind that number and there could not be one:
 * "configured" is not a quantity. The checklist beside the ring in the comp IS the useful part, and it
 * survives -- as "4 of 6 set", which a reader can act on line by line. Same doctrine as CPR-270's.
 */
export async function configurationChecklist(admin: any, workspaceId: string, userId: string) {
  const [prefs, config, templates] = await Promise.all([
    getPreferences(admin, workspaceId, userId),
    getConfiguration(admin, workspaceId),
    admin.from("practice_note_template").select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId).eq("status", "published"),
  ]);
  const c = (config?.config ?? {}) as any;

  const items = [
    { key: "practice", label: "Practice name and timezone", done: !!config?.workspace?.name && !!config?.workspace?.timezone,
      href: "/practice/settings", hint: "Set the clock the whole practice is read against." },
    { key: "letterhead", label: "Letterhead", done: !!(c.letterhead_address || c.letterhead_registration),
      href: "/practice/settings", hint: "Printed on generated letters. Blank fields print nothing." },
    { key: "templates", label: "Templates published", done: (templates as any).count > 0,
      href: "/practice/documents/templates", hint: "Nothing can be generated without one." },
    { key: "specialty", label: "Specialty profile", done: !!prefs.specialty,
      href: "/practice/settings", hint: "Puts your specialty's templates first." },
    { key: "dashboard", label: "Dashboard arranged", done: prefs.dashboardWidgets.some(w => !w.visible),
      href: "/practice/settings", hint: "Optional. Hide what you do not use." },
    { key: "shortcuts", label: "Keyboard shortcuts on", done: prefs.shortcutsEnabled,
      href: "/practice/settings", hint: "Press ? anywhere to see them." },
  ];
  return { items, done: items.filter(i => i.done).length, total: items.length };
}
