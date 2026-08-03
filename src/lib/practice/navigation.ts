// CPR-V2-020 navigation catalogue (CPR-V2-020 V3 "Primary Navigation", SHELL-001 s7.1/7.2).
//
// TWO FILTERS DECIDE WHAT RENDERS, and both are honest by construction:
//   capability -- navigation is generated from the effective capability set, never hard-coded by role
//                 name (SHELL-001 s7.2). A user without patient.list simply has no Patients item.
//   built      -- "unfinished routes must remain behind feature flags and must not lead to blank pages"
//                 (s7.2). An item whose phase has not shipped does not render AT ALL; it is not shown
//                 disabled, because a sidebar of grey promises is marketing inside an app. The `phase`
//                 field records when it becomes real, so turning one on is a one-word change reviewed
//                 against an actual shipped route.
//
// The full CPR-V2-020 V3 list is present so the shell never needs a layout rebuild as phases land
// (s7.2 "support future modules without rebuilding the entire layout").

export type PracticeNavItem = {
  href: string;
  label: string;
  icon: string;
  capability: string | null;
  group: "Practice" | "Clinical Practice" | "Practice Management" | "Intelligence" | "Tools and Settings";
  /** Ships in this build phase; `built` flips when the route actually exists. */
  phase: number;
  built: boolean;
};

export const PRACTICE_NAV: PracticeNavItem[] = [
  { href: "/practice/home", label: "Home", icon: "⌂", capability: "practice.home.view", group: "Practice", phase: 0, built: true },
  { href: "/practice/calendar", label: "Calendar", icon: "▤", capability: "practice.calendar.view", group: "Clinical Practice", phase: 1, built: true },
  { href: "/practice/patients", label: "Patients", icon: "☺", capability: "patient.list", group: "Clinical Practice", phase: 2, built: true },
  { href: "/practice/encounters", label: "Encounters", icon: "✎", capability: "encounter.list", group: "Clinical Practice", phase: 3, built: true },
  { href: "/practice/documents", label: "Documents", icon: "▦", capability: "document.view", group: "Clinical Practice", phase: 4, built: true },
  { href: "/practice/follow-ups", label: "Follow-ups", icon: "↻", capability: "followup.view", group: "Clinical Practice", phase: 4, built: true },
  { href: "/practice/reports", label: "Reports", icon: "☷", capability: "report.view", group: "Practice Management", phase: 6, built: false },
  { href: "/practice/intelligence", label: "Practice Intelligence", icon: "☀", capability: "report.view", group: "Intelligence", phase: 5, built: false },
  { href: "/practice/settings", label: "Practice Settings", icon: "⚙", capability: "practice.settings.manage", group: "Tools and Settings", phase: 8, built: false },
];

export function visibleNav(capabilities: string[]): PracticeNavItem[] {
  return PRACTICE_NAV.filter(i => i.built && (i.capability === null || capabilities.includes(i.capability)));
}
