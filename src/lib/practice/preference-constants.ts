// CPR-360's preference vocabulary, in a module with NO server imports so the personalisation UI and the
// engine that validates it read the same list -- the split document-constants.ts exists for, applied to
// the module whose whole subject is choices.

/** Appearance. The palette is CPR-040's, not a colour picker: see the note in globals.css. */
export const THEMES = [
  ["light", "Light"],
  ["dark", "Dark"],
  ["system", "Match my device"],
] as const;

export const ACCENTS = [
  ["indigo", "Indigo", "#4F46E5"],
  ["blue", "Blue", "#2563EB"],
  ["cyan", "Cyan", "#0891B2"],
  ["emerald", "Emerald", "#059669"],
  ["amber", "Amber", "#B45309"],
  ["rose", "Rose", "#BE123C"],
  ["slate", "Slate", "#475569"],
] as const;

export const FONT_SCALES = [
  ["small", "Smaller"],
  ["normal", "Normal"],
  ["large", "Larger"],
] as const;

export const DENSITIES = [
  ["comfortable", "Comfortable"],
  ["compact", "Compact"],
] as const;

/**
 * The operations home's widgets, in their default order.
 *
 * THE KEYS ARE THE CONTRACT. A widget removed from the page must be removed here too, or somebody's
 * saved layout keeps a row for something that no longer renders; a widget added and not listed here
 * cannot be turned off. The harness asserts the page and this list agree.
 */
// CPR-001_v4 asks for the command centre's widgets to be configurable, so every widget the page
// renders is listed here -- a key the page uses and this list does not carry is a widget nobody can
// turn off, which is exactly the "a preference that changes nothing" failure in reverse.
//
// The third element is "required": a widget that cannot be hidden. Only the alerts panel is, because
// hiding the list of what is owed is the one setting that could cause harm.
export const DASHBOARD_WIDGETS = [
  ["schedule", "Today's timeline", false],
  ["locations", "My locations this week", false],
  ["queue", "Waiting queue", false],
  ["alerts", "Operational alerts", true],
  ["tasks", "Tasks for today", false],
  ["messages", "Messages", false],
  ["quick_actions", "Quick access", false],
  // ⚠ AND FIVE MORE WENT THE SAME WAY, FOR THE SAME REASON, TWO ARCS LATER: "Follow-up intelligence",
  // "Recent patients", "Patient insights", "Recent documents" and "Practice performance".
  //
  // CPR-HFE-001 moved every one of those panels off /practice/home, and home/page.tsx records where
  // each went in its own header: "patient insights, practice performance -> PRACTICE INTELLIGENCE -
  // recent documents -> DOCUMENTS - follow-up detail -> FOLLOW-UPS - recent patients -> PATIENTS".
  // This register was not updated with it, so five more switches sat in Settings changing nothing
  // whichever way a practitioner left them.
  //
  // ⚠ MEASURED WITH COMMENTS STRIPPED BEFORE ANY WERE REMOVED, and that step is the reason this is
  // right. All six untagged keys still APPEAR in home/page.tsx -- in the header prose that says where
  // they went, and in a label map naming the destinations. A plain search finds every one and would
  // have kept every one. With comments removed, only "Live clinic" survived as real markup, so that
  // one was TAGGED rather than removed: its panel exists and its SWITCH was the broken thing.
  //
  // ⚠ "This practice" AND "Recent activity" ARE REMOVED, and removing them is the fix rather than
  // tagging them on the page.
  //
  // Neither panel exists on /practice/home any more -- they went when CPR-V5-001 replaced the greeting
  // dashboard with Current Activity, and this register was not updated. So they were two switches in
  // Settings that a practitioner could turn on and off, and which changed nothing at all whichever way
  // they were left. CPR-360 already settled this class: "a setting that changes nothing is worse than a
  // missing one", which is why that module lists inert configuration rather than rendering it as inputs.
  //
  // The alternative -- adding `widget("practice")` and `widget("activity")` to the page -- would mean
  // inventing two panels to justify two switches. A saved preference naming a key that no longer exists
  // is simply ignored by widget(), which returns undefined for an unknown key, so nothing breaks for
  // somebody who had toggled one.
] as const;

/**
 * Notification categories.
 *
 * THE FOURTH ELEMENT IS THE EVENT TYPES THE CATEGORY COVERS, AND THREE OF THEM ARE EMPTY. The comp draws
 * five equal switches; CPR-340 raises exactly four event types, all of them about tasks and documents.
 * A switch for appointments, messages or system updates would control nothing at all -- which is the
 * failure this whole module has a header about. They render in their designed position, disabled, saying
 * nothing raises them yet.
 *
 * THE THIRD ELEMENT IS WHETHER TURNING IT OFF IS PERMITTED. A clinical alert may not be switched off: a
 * preference that lets somebody silence the thing that says a patient is deteriorating is not a
 * preference, it is a hazard with a toggle. It is listed with no events because nothing raises one
 * today, and the rule is written now so it is already true on the day something does.
 */
export const NOTIFICATION_CATEGORIES = [
  ["tasks", "Tasks and reminders", true, ["task_assigned", "task_reassigned", "task_blocked"]],
  ["documents", "Document changes", true, ["document_amended"]],
  ["appointments", "Appointments", true, []],
  ["clinical", "Clinical alerts", false, []],
  ["messages", "Messages", true, []],
  ["system", "System updates", true, []],
] as const;

/** The event types a person's choices leave switched on. Empty categories contribute nothing either way. */
export function enabledEventTypes(choices: Record<string, boolean>): string[] {
  return NOTIFICATION_CATEGORIES
    .filter(([key, , optional]) => optional === false || choices[key] !== false)
    .flatMap(([, , , events]) => events as readonly string[]);
}

/** Which preference keys a practice may lock. Appearance is not lockable -- see preferences.ts. */
export const LOCKABLE_PREFERENCES = [
  ["defaultEncounterMode", "Default consultation mode"],
  ["defaultAppointmentMinutes", "Default consultation length"],
  ["dashboardWidgets", "Dashboard layout"],
  ["notificationCategories", "Notification categories"],
] as const;

/**
 * Keyboard shortcuts. REAL ONES, bound to routes that exist.
 *
 * NOT REMAPPABLE, and that is a decision rather than an omission. A remapped shortcut is stored per
 * person and invisible to everyone else, so "press Ctrl+Shift+P" stops being true across a practice --
 * and the browser owns most of the useful combinations anyway. The comp draws a Customise link; this
 * offers on or off, and says why.
 *
 * Alt-based, because Ctrl+N and Ctrl+T are the browser's and cannot be taken.
 */
export const SHORTCUTS = [
  ["g h", "Go to the practice home", "/practice/home"],
  ["g p", "Go to patients", "/practice/patients"],
  ["g c", "Go to the calendar", "/practice/calendar"],
  ["g e", "Go to consultations", "/practice/encounters"],
  ["g t", "Go to tasks", "/practice/tasks"],
  ["g d", "Go to documents", "/practice/documents"],
  ["g i", "Go to the inbox", "/practice/inbox"],
  ["g r", "Go to reports", "/practice/reports"],
  ["/", "Jump to search", "/practice/search"],
  ["?", "Show this list", null],
] as const;

export type PreferenceShape = {
  theme: string; accent: string; fontScale: string; density: string; reduceVisualNoise: boolean;
  dashboardWidgets: { key: string; visible: boolean }[];
  notificationCategories: Record<string, boolean>;
  specialty: string | null; subspecialties: string[];
  shortcutsEnabled: boolean;
  defaultEncounterMode: string | null; defaultAppointmentMinutes: number | null;
};

export const DEFAULT_PREFERENCES: PreferenceShape = {
  theme: "light", accent: "indigo", fontScale: "normal", density: "comfortable", reduceVisualNoise: false,
  dashboardWidgets: DASHBOARD_WIDGETS.map(([key]) => ({ key, visible: true })),
  notificationCategories: Object.fromEntries(NOTIFICATION_CATEGORIES.map(([key]) => [key, true])),
  specialty: null, subspecialties: [], shortcutsEnabled: true,
  defaultEncounterMode: null, defaultAppointmentMinutes: null,
};
