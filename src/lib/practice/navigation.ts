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

// ⚠️ THE PUBLIC MARKETING SECTION SHARES THIS URL SPACE. `/practice/[area]` renders the public
// capability-area pages, and a static route in this group SHADOWS it -- silently, because a static
// segment beats a dynamic one and nothing errors. CPR-310 shipped at `/practice/team` and made the
// public "team" area page unreachable; scripts/practice-content-harness.ts caught it, which is what
// that harness is for.
//
// Taken by the public section and NOT available here: scheduling · encounter · continuity ·
// case-memory · evidence · anywhere · team · setup, plus the profession slugs (doctor, nurse,
// clinical-officer, midwife, surgeon, pharmacist, laboratory-scientist, nutritionist, physiotherapist,
// psychologist). Check `slug:` in src/lib/marketing/practice-content.ts before adding a route here.
export const PRACTICE_NAV: PracticeNavItem[] = [
  { href: "/practice/home", label: "Home", icon: "⌂", capability: "practice.home.view", group: "Practice", phase: 0, built: true },
  { href: "/practice/search", label: "Search", icon: "⌕", capability: "search.use", group: "Practice", phase: 5, built: true },
  { href: "/practice/calendar", label: "Calendar", icon: "▤", capability: "practice.calendar.view", group: "Clinical Practice", phase: 1, built: true },
  { href: "/practice/patients", label: "Patients", icon: "☺", capability: "patient.list", group: "Clinical Practice", phase: 2, built: true },
  { href: "/practice/encounters", label: "Encounters", icon: "✎", capability: "encounter.list", group: "Clinical Practice", phase: 3, built: true },
  { href: "/practice/documents", label: "Documents", icon: "▦", capability: "document.view", group: "Clinical Practice", phase: 4, built: true },
  { href: "/practice/follow-ups", label: "Follow-ups", icon: "↻", capability: "followup.view", group: "Clinical Practice", phase: 4, built: true },
  { href: "/practice/tasks", label: "Tasks", icon: "☑", capability: "task.view", group: "Practice Management", phase: 4, built: true },
  { href: "/practice/inbox", label: "Inbox", icon: "▼", capability: "inbox.record", group: "Practice Management", phase: 5, built: true },
  { href: "/practice/messages", label: "Messages", icon: "✉", capability: "message.use", group: "Practice Management", phase: 5, built: true },
  { href: "/practice/reports", label: "Reports", icon: "☷", capability: "report.view", group: "Practice Management", phase: 6, built: true },
  { href: "/practice/intelligence", label: "Practice Intelligence", icon: "☀", capability: "report.view", group: "Intelligence", phase: 5, built: false },
  { href: "/practice/privacy", label: "Privacy and access", icon: "⚿", capability: "access.review", group: "Tools and Settings", phase: 5, built: true },
  { href: "/practice/people", label: "Team", icon: "⚇", capability: "practice.members.manage", group: "Tools and Settings", phase: 5, built: true },
  // CPR-360: NO CAPABILITY. The page carries both halves -- personal settings, which everybody has, and
  // practice configuration, which the page itself gates. Requiring practice.settings.manage in the nav
  // would hide somebody's own text size behind an administrative permission.
  { href: "/practice/settings", label: "Settings", icon: "⚙", capability: null, group: "Tools and Settings", phase: 8, built: true },
];

export function visibleNav(capabilities: string[]): PracticeNavItem[] {
  return PRACTICE_NAV.filter(i => i.built && (i.capability === null || capabilities.includes(i.capability)));
}
