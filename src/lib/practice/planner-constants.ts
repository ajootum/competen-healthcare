// CPR-V5-005 PRACTICE PLANNER -- the constants a screen needs, and nothing that touches the database.
//
// ⚠ THIS FILE EXISTS BECAUSE A SERVER-ONLY IMPORT REACHING A CLIENT COMPONENT IS INVISIBLE TO tsc,
// eslint AND EVERY HARNESS. planner.ts imports activity.ts, which imports metrics.ts, which imports
// access.ts, which imports `next/headers`. A "use client" week grid importing so much as a weekday name
// from planner.ts drags that whole chain into the browser bundle and the BUILD FAILS -- reported as a
// 500 on pages nobody touched, and only `next build` names the real import trace.
//
// activity-constants.ts and encounter-constants.ts exist for exactly this reason and this is the third.
// The rule, stated once more where somebody will read it: A CONSTANT A SCREEN NEEDS DOES NOT BELONG IN A
// FILE THAT TOUCHES THE DATABASE. planner.ts re-exports everything here so server callers are unaffected
// and nothing ends up with two definitions.

import { ACTIVITY_LABEL, type ActivityType } from "@/lib/practice/activity-constants";

/** ISO weekday numbers, which is the convention migration 230 already uses for the weekly template. */
export const PLANNER_WEEKDAYS = [
  [1, "Monday", "Mon"], [2, "Tuesday", "Tue"], [3, "Wednesday", "Wed"], [4, "Thursday", "Thu"],
  [5, "Friday", "Fri"], [6, "Saturday", "Sat"], [7, "Sunday", "Sun"],
] as const;

export const WEEKDAY_NAME: Record<number, string> =
  Object.fromEntries(PLANNER_WEEKDAYS.map(([n, long]) => [n, long]));
export const WEEKDAY_SHORT: Record<number, string> =
  Object.fromEntries(PLANNER_WEEKDAYS.map(([n, , short]) => [n, short]));

/**
 * s5's actions, in the words a button uses, with the ones this build does not offer marked.
 *
 * NAMED HERE RATHER THAN TYPED INTO A MENU, so that a screen offering an action and an engine
 * implementing it cannot drift apart silently -- the harness asserts every `implemented` key below has
 * an exported function behind it.
 */
export const PLANNER_ACTIONS = [
  { key: "move", label: "Move", implemented: true },
  { key: "duplicate", label: "Duplicate", implemented: true },
  { key: "split", label: "Split", implemented: true },
  { key: "extend", label: "Extend", implemented: true },
  { key: "shorten", label: "Shorten", implemented: true },
  { key: "cancel", label: "Cancel", implemented: true },
  { key: "change_location", label: "Change Location", implemented: true },
  { key: "add_notes", label: "Add Notes", implemented: true },
] as const;

export type PlannerActionKey = (typeof PLANNER_ACTIONS)[number]["key"];

/**
 * s9's Quick Actions, all eight, in s9's own order.
 *
 * ⚠ THIS LIST SHIPPED TWO SHORT AND WAS WRONG FOR A DAY. "Add Travel" and "Add Custom Activity" were
 * withheld here, and the withholding was correct at the time: migration 232's CHECK constraint listed
 * eight types and neither `travel` nor `custom` was among them, so either button would have produced a
 * write the database refused at the moment a practitioner pressed it. MIGRATION 237 then added five
 * types -- meeting, research, leave, travel, custom -- and the refusal became a lie that no test could
 * see, because a list that is too SHORT still satisfies "every key is a real type".
 *
 * The lesson is worth the paragraph: a constant that mirrors a database constraint has to be re-read
 * when the constraint moves, and "every entry is valid" is only half the assertion. The other half is
 * that the specification's list is complete, which is what the harness now checks.
 *
 * The label is s9's and the key is the schema's, so a screen shows the specification's vocabulary over
 * the database's names. teaching, telephone_review, emergency_consult, research and leave have no quick
 * action because s9 gives them none -- they are reached through Add Activity, which offers every type.
 */
export const PLANNER_QUICK_ACTIONS: { key: ActivityType; label: string }[] = [
  { key: "outpatient_clinic", label: "Add Clinic" },
  { key: "ward_round", label: "Add Ward Round" },
  { key: "theatre", label: "Add Theatre" },
  { key: "virtual_clinic", label: "Add Telemedicine" },
  { key: "meeting", label: "Add Meeting" },
  { key: "administration", label: "Add Administration" },
  { key: "travel", label: "Add Travel" },
  { key: "custom", label: "Add Custom Activity" },
];

/**
 * s9's eight labels, so a harness can prove the quick-action list is COMPLETE and not merely valid.
 * Kept beside the list rather than re-typed in a test: a re-typed expectation can shrink along with the
 * thing it is checking and agree with it forever.
 */
export const QUICK_ACTION_LABELS_S9 = [
  "Add Clinic", "Add Ward Round", "Add Theatre", "Add Telemedicine",
  "Add Meeting", "Add Administration", "Add Travel", "Add Custom Activity",
] as const;

/** The four states a planner block can be drawn in. "cancelled" is the one migration 236 adds. */
export const PLANNER_STATE_LABEL: Record<string, string> = {
  planned: "Planned",
  running: "In Progress",
  done: "Finished",
  cancelled: "Cancelled",
};

/**
 * ⚠ HOW THE TRAVEL FIGURE MUST BE LABELLED WHEREVER IT IS DRAWN.
 *
 * The design comp shows "2h 45m Travel Time" on the week header and "20m travel" against a day, in the
 * typography of something measured. It is not measured. It is the sum of
 * practice_location.travel_buffer_minutes (migration 228) -- numbers a practitioner typed once, in a
 * settings screen, about how long it takes them to get to each place. This product holds no map, no
 * route and no feed from anything that does.
 *
 * The distinction is not pedantry: a practitioner who believes the figure was calculated will trust it
 * against their own judgement on a day it is wrong. src/lib/practice/hospital-booking.ts already refuses
 * measured travel by name in HOSPITAL_BOOKING_REFUSES, and every payload out of planner.ts carries
 * `basis: "typed_buffer"` and `measured: false` so a screen cannot render it as anything else by
 * accident.
 */
export const TRAVEL_BASIS_NOTE =
  "Summed from the travel time you entered for each location. Nothing measured a distance.";

/** The heading a Day Summary should use over the travel figure, so it is never labelled as measured. */
export const TRAVEL_BASIS_LABEL = "Travel allowance you set";

export const CONFLICT_LABEL: Record<string, string> = {
  ACTIVITY_OVERLAP: "Two activities at the same time",
  ACTIVITY_TRAVEL_CONFLICT: "Not enough time to get between locations",
};

/** s9's vocabulary over 232's types, for a legend. */
export const activityLabel = (t: string) => ACTIVITY_LABEL[t as ActivityType] ?? t;
