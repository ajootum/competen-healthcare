/* eslint-disable @typescript-eslint/no-explicit-any */

// ── REMINDER PREFERENCES ── migration 374, owner continuation GO (Option A) ── COMPETEN-IND-007 ───────────
//
// Two independent switches on the person's own professional record: in-app (default ON) and email
// (default OFF, opt-in). They are the person's, set only by the person, and read only by Competen
// Professional. They are never stored in, and never read from, the estate notification_preferences,
// which is one row per person shared by every product (owner ruling D1).
//
// ⚠ READ ON THEIR OWN. The preference columns arrive with 374, which an environment may not have yet even
// when it has 373. So they are never added to the profile's main select (record.ts): a missing column there
// would make the whole record look unavailable. Here, a missing column means "not configurable yet", and
// the defaults stand -- in-app on, email off, the safe direction for both.

export type ReminderPrefs = { inApp: boolean; email: boolean; configurable: boolean };

export const REMINDER_DEFAULTS = { inApp: true, email: false } as const;

export async function loadReminderPrefs(admin: any, userId: string): Promise<ReminderPrefs> {
  try {
    const { data, error } = await admin.from("individual_professional_profile")
      .select("reminder_in_app, reminder_email").eq("user_id", userId).maybeSingle();
    // Missing column (374 not applied) or any read failure: the defaults stand, and the switches are not offered.
    if (error) return { ...REMINDER_DEFAULTS, configurable: false };
    return {
      inApp: data ? data.reminder_in_app !== false : REMINDER_DEFAULTS.inApp,
      email: data ? data.reminder_email === true : REMINDER_DEFAULTS.email,
      configurable: true,
    };
  } catch {
    return { ...REMINDER_DEFAULTS, configurable: false };
  }
}

/** Pure: the request body, or null when it is not two booleans. Both switches are always set together. */
export function parsePrefs(b: Record<string, unknown>): { reminder_in_app: boolean; reminder_email: boolean } | null {
  if (typeof b.inApp !== "boolean" || typeof b.email !== "boolean") return null;
  return { reminder_in_app: b.inApp, reminder_email: b.email };
}
