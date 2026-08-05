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

// ── CPR-001_v4 REGROUPING ────────────────────────────────────────────────────────────────────────────
//
// The comp's sidebar is organised by WHAT A PERSON IS DOING, not by which subsystem owns the route:
// PRACTICE (running today) · PATIENTS (people) · CLINICAL (the record) · COMMUNICATION (in and out) ·
// INTELLIGENCE (thinking about the work) · ADMINISTRATION (running the business).
//
// The old grouping put Patients, Encounters, Documents and Follow-ups together as "Clinical Practice"
// and Tasks, Inbox, Messages and Reports together as "Practice Management" -- which is how the codebase
// is arranged, not how a clinic morning is. Patients and Follow-ups are about PEOPLE and now sit with
// Register Patient; Documents belongs with the record it comes from.
//
// TWO COMP ITEMS ARE DELIBERATELY NOT HERE. `Billing` has no module (CPR-440 unbuilt) and `Investigations`
// has no table -- results arrive through CPR-320's inbox and there is nothing else to open. A sidebar
// entry leading to a blank page is the exact thing s7.2 forbids, and a comp drawing it does not change
// that. The inbox carries the same work under a name that is true.
// ── CPR-SET-000 v4.1 PART I: THREE LAYERS ────────────────────────────────────────────────────────────
//
// "Three-layer architecture: Operational Workspaces, Practice Setup, Personal Settings." The
// distinction is real and worth the restructure: running the practice, configuring the practice, and
// your own preferences are three different jobs, and CPR-360 already found that mixing the last two
// puts somebody's text size behind an administrative permission.
//
// The v4 command-centre groups become SUBSECTIONS of the operational layer rather than being replaced,
// because a flat list of twenty-one items under one heading is what the comp's grouping fixed.
export type PracticeNavLayer = "Operational workspaces" | "Practice setup" | "Personal settings";

export type PracticeNavGroup =
  | "Practice" | "Patients" | "Clinical" | "Communication" | "Intelligence" | "Administration"
  | "Setup" | "Personal";

/** Which layer each group belongs to. Declared, so a group cannot drift between layers unnoticed. */
export const GROUP_LAYER: Record<PracticeNavGroup, PracticeNavLayer> = {
  Practice: "Operational workspaces",
  Patients: "Operational workspaces",
  Clinical: "Operational workspaces",
  Communication: "Operational workspaces",
  Intelligence: "Operational workspaces",
  Administration: "Operational workspaces",
  Setup: "Practice setup",
  Personal: "Personal settings",
};

export const NAV_LAYER_ORDER: PracticeNavLayer[] = [
  "Operational workspaces", "Practice setup", "Personal settings",
];

export type PracticeNavItem = {
  href: string;
  label: string;
  icon: string;
  capability: string | null;
  group: PracticeNavGroup;
  /** Ships in this build phase; `built` flips when the route actually exists. */
  phase: number;
  built: boolean;
  /**
   * CPR-V3-002's nine. These are the sidebar; everything else is reached through the one that owns it.
   */
  primary?: boolean;
  /**
   * The href of the primary section this module belongs to. Required for everything that is not primary.
   *
   * ⚠ THIS IS WHAT STOPS THE SIDEBAR ORPHANING WORKING MODULES. V3 names nine sections; this build has
   * twenty-five routes, and simply rendering the nine would leave sixteen shipped screens with no way in
   * -- the exact failure that made /practice/setup and the settings cards unreachable earlier. A parent
   * must itself be primary AND built, so a module cannot be filed under a section that does not exist
   * yet. `primaryNav`/`childrenOf` are the only two readers, and the nav harness asserts the invariant.
   */
  parent?: string;
};

/** Sidebar order. Declared, not inferred from item order, so a reordered item cannot move a heading. */
export const NAV_GROUP_ORDER: PracticeNavGroup[] = [
  "Practice", "Patients", "Clinical", "Communication", "Intelligence", "Administration",
  "Setup", "Personal",
];

// ⚠️ THE PUBLIC MARKETING SECTION SHARES THIS URL SPACE, AND IT SHADOWS THIS ONE IN PRODUCTION ONLY.
// `/practice/[area]` renders the public capability-area pages with `generateStaticParams`, so every slug
// is PRERENDERED TO A STATIC FILE AT BUILD TIME. Dev matches the static `(shell)` segment first and looks
// perfect; production serves the prerendered marketing page instead, 200, no error, no warning. CPR-310
// hit this at `/practice/team`, and CPR-SETUP-001 hit it again at `/practice/setup` -- where the sidebar
// promised Practice Setup and the deployed site answered with a marketing page. The public slug is now
// `connections`, and scripts/practice-content-harness.ts assertion 7a fails the build on any new overlap.
//
// Taken by the public section and NOT available here: scheduling · encounter · continuity ·
// case-memory · evidence · anywhere · team · connections, plus the profession slugs (doctor, nurse,
// clinical-officer, midwife, surgeon, pharmacist, laboratory-scientist, nutritionist, physiotherapist,
// psychologist). Check `slug:` in src/lib/marketing/practice-content.ts before adding a route here.
export const PRACTICE_NAV: PracticeNavItem[] = [
  // ══ CPR-V3-002 WORKSPACE ARCHITECTURE: THE NINE ══════════════════════════════════════════════════
  //
  // The volume names nine sections and all six comps draw exactly those nine, flat, with no group
  // headings. That is the sidebar.
  //
  // TWO OF THE NINE ARE NOT BUILT, and are declared here `built: false` so they render NOTHING rather
  // than a grey promise (s7.2, and the rule this file has always applied). Declaring them keeps the
  // architecture visible and makes shipping one a one-word change; it does not put a dead link in a
  // sidebar, which is what the previous session was spent undoing.
  { href: "/practice/home", label: "Practice Home", icon: "⌂", capability: "practice.home.view", group: "Practice", phase: 0, built: true, primary: true },
  // The acceptance criterion CPR-V3-002 is measured by -- "open Today's Work in under two clicks" -- is
  // one click because this is second in the sidebar. It does NOT replace the Calendar: the calendar is
  // what is booked, this is the day you are actually in, and V3 separates them on purpose.
  { href: "/practice/today", label: "Today's Work", icon: "◔", capability: "practice.home.view", group: "Practice", phase: 0, built: true, primary: true },
  { href: "/practice/patients", label: "Patients", icon: "☺", capability: "patient.list", group: "Patients", phase: 2, built: true, primary: true },
  // CPR-V3-002 "Patient Journey": longitudinal timeline, diagnoses, treatments, documents, hospital
  // history, follow-up history, AI summary. The pieces exist across several screens; the single
  // longitudinal view V3 asks for does not. NOT SHIPPED, so it renders nothing.
  { href: "/practice/journey", label: "Patient Journey", icon: "⤳", capability: "patient.view", group: "Patients", phase: 9, built: false, primary: true },
  { href: "/practice/follow-ups", label: "Follow-ups", icon: "↻", capability: "followup.view", group: "Patients", phase: 4, built: true, primary: true },
  { href: "/practice/documents", label: "Documents", icon: "▦", capability: "document.view", group: "Clinical", phase: 4, built: true, primary: true },
  // CPR-V3-002 "Insights". Analytics and Patient Insights both exist and both sit under Practice Home
  // until this section is built -- filing them under a section that does not exist would orphan them.
  { href: "/practice/insights", label: "Insights", icon: "☀", capability: "report.view", group: "Intelligence", phase: 9, built: false, primary: true },
  { href: "/practice/assistant", label: "AI Assistant", icon: "✧", capability: "encounter.list", group: "Intelligence", phase: 5, built: true, primary: true },
  { href: "/practice/setup", label: "Practice Setup", icon: "⚙", capability: null, group: "Setup", phase: 8, built: true, primary: true },

  // ══ EVERYTHING ELSE, FILED UNDER THE SECTION THAT OWNS IT ════════════════════════════════════════
  //
  // Sixteen shipped screens. None is in V3's nine and every one of them works, so each declares its
  // parent and is reached from there. A module with no parent is an orphan and the nav harness fails.

  // -- Today's Work: the day, and what is booked into it --------------------------------------------
  { href: "/practice/calendar", label: "Calendar", icon: "▤", capability: "practice.calendar.view", group: "Practice", phase: 1, built: true, parent: "/practice/today" },
  { href: "/practice/tasks", label: "Tasks", icon: "☑", capability: "task.view", group: "Practice", phase: 4, built: true, parent: "/practice/today" },

  // -- Patients: the people, and the record made about them -----------------------------------------
  { href: "/practice/encounters", label: "Encounters", icon: "✎", capability: "encounter.list", group: "Clinical", phase: 3, built: true, parent: "/practice/patients" },
  { href: "/practice/activity", label: "Procedures", icon: "◷", capability: "procedure.record", group: "Clinical", phase: 4, built: true, parent: "/practice/patients" },
  { href: "/practice/search", label: "Search", icon: "⌕", capability: "search.use", group: "Practice", phase: 5, built: true, parent: "/practice/patients" },

  // -- Documents: everything that arrives, and everything sent --------------------------------------
  { href: "/practice/messages", label: "Messages", icon: "✉", capability: "message.use", group: "Communication", phase: 5, built: true, parent: "/practice/documents" },
  // The comp calls this "Investigations". It is CPR-320's incoming register and holds every arriving
  // document -- lab results among them, but also referrals and discharge summaries. Naming it after one
  // of its contents would promise an investigations module that does not exist.
  { href: "/practice/inbox", label: "Results & incoming", icon: "▼", capability: "inbox.record", group: "Communication", phase: 5, built: true, parent: "/practice/documents" },

  // -- Practice Home: the figures, until Insights ships ---------------------------------------------
  { href: "/practice/intelligence", label: "Analytics", icon: "☀", capability: "report.view", group: "Intelligence", phase: 5, built: true, parent: "/practice/home" },
  { href: "/practice/reports", label: "Patient Insights", icon: "☷", capability: "report.view", group: "Patients", phase: 6, built: true, parent: "/practice/home" },

  // -- AI Assistant: thinking about the work --------------------------------------------------------
  // CPR-220. NOT /practice/case-memory -- that slug is the public marketing page for this capability.
  // encounter.list, not patient.view: learning from a case does not require knowing whose it was.
  { href: "/practice/cases", label: "Case Memory", icon: "❧", capability: "encounter.list", group: "Intelligence", phase: 5, built: true, parent: "/practice/assistant" },
  // CPR-230/240. NO CAPABILITY on either: reflecting on your own practice, and keeping an account of
  // your own work, are not permissions somebody grants you. Every query inside is scoped to the caller.
  { href: "/practice/reflection", label: "Reflection", icon: "◍", capability: null, group: "Intelligence", phase: 5, built: true, parent: "/practice/assistant" },
  { href: "/practice/portfolio", label: "Portfolio", icon: "❑", capability: null, group: "Intelligence", phase: 5, built: true, parent: "/practice/assistant" },

  // -- Practice Setup: configuring the practice, and your own preferences ---------------------------
  { href: "/practice/people", label: "Team & Permissions", icon: "⚇", capability: null, group: "Setup", phase: 5, built: true, parent: "/practice/setup" },
  { href: "/practice/settings", label: "Personal Settings", icon: "☰", capability: null, group: "Personal", phase: 8, built: true, parent: "/practice/setup" },
  { href: "/practice/privacy", label: "Activity Log", icon: "⚿", capability: "access.review", group: "Personal", phase: 5, built: true, parent: "/practice/setup" },
  // CPR-370: NO CAPABILITY. Everybody may see the devices signed in as THEM and lock one out; the
  // practice-wide view and the policy are gated inside the page. Hiding somebody's own device list
  // behind an audit permission would put it out of reach of the person who lost the laptop.
  { href: "/practice/privacy/security", label: "Security", icon: "⛨", capability: null, group: "Personal", phase: 5, built: true, parent: "/practice/setup" },
];

export function visibleNav(capabilities: string[]): PracticeNavItem[] {
  return PRACTICE_NAV.filter(i => i.built && (i.capability === null || capabilities.includes(i.capability)));
}

/** CPR-V3-002's nine, filtered the same two ways everything else is. This is the sidebar. */
export function primaryNav(capabilities: string[]): PracticeNavItem[] {
  return visibleNav(capabilities).filter(i => i.primary);
}

/**
 * The modules filed under a primary section, in declaration order.
 *
 * Rendered beneath their section in the sidebar rather than only inside the page, because "reachable from
 * the screen that owns it" is only true if you already found that screen -- and a module you cannot see
 * from the navigation is a module you have to remember exists.
 */
export function childrenOf(parentHref: string, capabilities: string[]): PracticeNavItem[] {
  return visibleNav(capabilities).filter(i => i.parent === parentHref);
}

/**
 * Every built module that nothing can reach: not primary, and with no parent that is itself a built
 * primary. Exported so the harness asserts on the SAME function the sidebar uses -- a check that
 * reimplements the rule can agree with itself while disagreeing with the product.
 */
export function orphanedNav(): PracticeNavItem[] {
  const builtPrimary = new Set(PRACTICE_NAV.filter(i => i.primary && i.built).map(i => i.href));
  return PRACTICE_NAV.filter(i => i.built && !i.primary && !(i.parent && builtPrimary.has(i.parent)));
}
