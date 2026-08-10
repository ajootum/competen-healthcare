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
  // ══ CPR-V5-002 FINAL SIDEBAR NAVIGATION -- DESIGN FREEZE ═════════════════════════════════════════
  //
  // Practice Command Centre · Current Session · Calendar · Patients · Encounters · Documents ·
  // Follow-ups · Practice Assistant · Practice Setup. Rendered in PRIMARY_ORDER and grouped by
  // SIDEBAR_SECTIONS, not in the order they happen to sit below.
  //
  // ⚠ THIS IS THE THIRD NAVIGATION IN THIS FILE AND THE LAST. V3-002 named nine, V5-001 named eight,
  // and V5-002 is the DESIGN FREEZE: "no further structural navigation changes should be made unless
  // validated by practitioner usability testing". Each supersession is recorded rather than tidied
  // away, because the shape of the churn is the argument for the freeze.
  //
  // WHAT V5-002 CHANGED: Today's Work is renamed Current Session and PROMOTED to a section of its own
  // (V5-001 had folded it into the command centre); AI Assistant becomes Practice Assistant; and
  // Tasks, Analytics and Patient Insights are REMOVED FROM PRIMARY -- "supporting information should
  // not become top-level navigation".
  //
  // REMOVED IS NOT DELETED. The spec is explicit that the three "remain available contextually", so
  // each declares the section that owns it and appears under it: Tasks under Current Session,
  // Analytics and Patient Insights under the Command Centre they are surfaced from. orphanedNav()
  // fails the harness on any built module that loses its way in.
  { href: "/practice/home", label: "Practice Command Centre", icon: "⌂", capability: "practice.home.view", group: "Practice", phase: 0, built: true, primary: true },
  // Today's Work is now a VIEW INSIDE the command centre rather than a section beside it: V5-001 puts
  // the current activity, the queue and the day's work on the command centre itself, so a second screen
  // showing the same six panels would be two answers to one question.
  { href: "/practice/today", label: "Current Session", icon: "◷", capability: "practice.home.view", group: "Practice", phase: 0, built: true, primary: true },
  { href: "/practice/patients", label: "Patients", icon: "☺", capability: "patient.list", group: "Patients", phase: 2, built: true, primary: true },
  // CPR-V3-002 "Patient Journey": longitudinal timeline, diagnoses, treatments, documents, hospital
  // history, follow-up history, AI summary. The pieces exist across several screens; the single
  // longitudinal view V3 asks for does not. NOT SHIPPED, so it renders nothing.
  { href: "/practice/follow-ups", label: "Follow-ups", icon: "↻", capability: "followup.view", group: "Patients", phase: 4, built: true, primary: true },
  { href: "/practice/documents", label: "Documents", icon: "▦", capability: "document.view", group: "Clinical", phase: 4, built: true, primary: true },
  // CPR-V3-002 "Insights". Analytics and Patient Insights both exist and both sit under Practice Home
  // until this section is built -- filing them under a section that does not exist would orphan them.
  // ⚠ NO LONGER PRIMARY (CPR-PI-001 s3, s4, and s15's first acceptance criterion: "the separate
  // Practice Assistant sidebar item is removed"). The suite's argument is that an assistant which lives
  // in its own workspace is one you have to REMEMBER TO VISIT, and the useful moment for it is always
  // inside some other screen. So it becomes an area within Practice Intelligence plus contextual
  // actions elsewhere -- and its route survives, because "removed from the sidebar" is not "deleted".
  { href: "/practice/assistant", label: "Practice Assistant", icon: "✧", capability: "encounter.list", group: "Intelligence", phase: 5, built: true, parent: "/practice/intelligence" },
  // The user-facing handbook. NO CAPABILITY: what the product will and will not do is not a permission,
  // and the one person who most needs it is a locum on their first morning holding the fewest of them.
  { href: "/practice/documentation", label: "Documentation", icon: "?", capability: null, group: "Setup", phase: 9, built: true, parent: "/practice/setup" },
  { href: "/practice/setup", label: "Practice Setup", icon: "⚙", capability: null, group: "Setup", phase: 8, built: true, primary: true },

  // ══ EVERYTHING ELSE, FILED UNDER THE SECTION THAT OWNS IT ════════════════════════════════════════
  //
  // Sixteen shipped screens. None is in V3's nine and every one of them works, so each declares its
  // parent and is reached from there. A module with no parent is an orphan and the nav harness fails.

  // -- Today's Work: the day, and what is booked into it --------------------------------------------
  // ── CPR-V5-005: CALENDAR BECOMES PRACTICE PLANNER ───────────────────────────────────────────────
  //
  // "Replace the traditional appointment calendar with a Practice Planner. ACTIVITIES -- not
  // appointments -- are the primary planning object" (s1). The rename is the smallest part of that and
  // the part a practitioner sees: a calendar is a list of when other people will arrive, and a planner
  // is where somebody decides what their week is. The route stays /practice/calendar -- the same choice
  // made when Today's Work became Current Session, and for the same reason: a URL rename is churn
  // through bookmarks and links to buy a tidiness nobody is asking for.
  //
  // ⚠ THIS AMENDS THE CPR-V5-002 FREEZE, and CPR-V5-005 is the product change control s17 requires.
  { href: "/practice/calendar", label: "Practice Planner", icon: "▦", capability: "practice.calendar.view", group: "Practice", phase: 1, built: true, primary: true },
  { href: "/practice/tasks", label: "Tasks", icon: "☑", capability: "task.view", group: "Practice", phase: 4, built: true, parent: "/practice/today" },
  // ⚠ NOT PRIMARY, AND THE FREEZE IS WHY. CPR-V5-002 is a design freeze on the nine primary sections and
  // this is not one of them -- so it is filed under the Planner, which is where somebody who reads a
  // request goes next to act on it. It is here at all because the patient's own confirmation says the
  // practice can see their request, and before this route nothing in this product could.
  { href: "/practice/booking-requests", label: "Booking requests", icon: "✉", capability: "appointment.manage", group: "Practice", phase: 4, built: true, parent: "/practice/calendar" },

  // -- Patients: the people, and the record made about them -----------------------------------------
  { href: "/practice/encounters", label: "Encounters", icon: "✎", capability: "encounter.list", group: "Clinical", phase: 3, built: true, primary: true },
  // ⚠ NOT PRIMARY, AND THE FREEZE IS WHY -- the same reason booking-requests is not. CPR-V5-002 froze the
  // nine primary sections and Close My Day is not one of them, so it is filed under Encounters, which is
  // what it closes. CPR-ADOPT-001 s3 wants it entered from Current Activity, the Command Centre and the
  // Planner as well, and those are links INTO this route rather than three more nav entries.
  { href: "/practice/close-my-day", label: "Close My Day", icon: "☾", capability: "encounter.list", group: "Clinical", phase: 4, built: true, parent: "/practice/encounters" },
  { href: "/practice/activity", label: "Procedures", icon: "◷", capability: "procedure.record", group: "Clinical", phase: 4, built: true, parent: "/practice/encounters" },
  { href: "/practice/search", label: "Search", icon: "⌕", capability: "search.use", group: "Practice", phase: 5, built: true, parent: "/practice/patients" },

  // ⚠ THE PATIENTS SUBMENU IS GONE (CPR-PAT-002 s2, verbatim: "Replace the expandable Patients submenu
  // (Search, Waiting List, New Registration) with a single Patients item. All registration, search and
  // waiting workflows live inside the Patients workspace.").
  //
  // The two worklist VIEWS added three commits ago -- ?list=waiting and ?list=new -- are withdrawn with
  // it. They were the right shape for the sidebar they were added to; this specification moves that work
  // onto the page itself, where the Today.s Care and Continuing Care cards do the same job with the
  // count visible. The URL contract still works, so any bookmark somebody made keeps resolving.
  //
  // 9f-b and its control asserted these existed. They now assert nothing exists that breaks the rule,
  // which is the honest form of the same guard.

  // -- Documents: everything that arrives, and everything sent --------------------------------------
  //
  // ── CPR-DOC-002 s3.1: MESSAGES AND RESULTS & INCOMING LEAVE THE PERMANENT NAVIGATION ────────────
  //
  // "Keep a single primary sidebar item labelled Documents. Remove Messages and Results & Incoming from
  // the permanent navigation. Sub-navigation should appear inside the workspace as tabs."
  //
  // Both routes still exist and both are still built. What changed is where you reach them from:
  // WorkspaceHeader renders "Beside this workspace -> Incoming register / Internal messages" on every
  // Documents tab, capability-filtered, and harness assertions 14b / 14b-control / 14c pin both hrefs,
  // both page.tsx files, and that both capabilities are really seeded.
  //
  // WARNING: THE ORDER OF THESE TWO CHANGES IS LOAD-BEARING. Assertion 9a fails any built module that
  // cannot be reached from the sidebar, so the tabs had to ship FIRST (commit 170dbb45) and these
  // entries come out SECOND. Reversed, the nav change strands two working modules and the harness is
  // right to refuse it. They are listed in 9i's NO_NAV_ENTRY_BY_DESIGN with that reason written down.
  //
  // The old entry for the incoming register said this, and it is still true of the tab that replaced it:
  // the comp calls it "Investigations", but it is CPR-320's incoming register and holds every arriving
  // document -- lab results among them, but also referrals and discharge summaries. Naming it after one
  // of its contents would promise an investigations module that does not exist.

  // ── CPR-KS-001 PHASE 1: PRACTICE GUIDANCE, UNDER DOCUMENTS BY DECISION ──────────────────────────
  //
  // The user placed Knowledge Studio here rather than in the primary list, so PRIMARY_ORDER stays at
  // NINE. The route keeps its `knowledge-studio` address because a URL is an address, not a claim --
  // every user-facing word is "Practice Guidance".
  //
  // ⚠ THE LABEL IS NOT "STUDIO" OR "DESIGNER", AND THAT IS A SAFETY DECISION RATHER THAN A STYLE ONE.
  // Those words name a TOOL, and a tool called a clinical algorithm designer makes its false claim
  // before a practitioner authors anything: they will reasonably believe the system is now watching what
  // they drew. It is not. So the section is named for what it PRODUCES -- written standing instructions
  // a person reads -- and every asset carries GUIDANCE_NOT_MONITORED: "this is a written instruction,
  // nothing here checks it." Also, `/super-admin/ckp/studio` already owns the other name.
  //
  // ⚠ ORDER, AGAIN. 9f forbids `built: true` before the page exists, so the page shipped first and this
  // entry comes second -- the same sequence CPR-DOC-002 s3.1 needed above, for the same reason. The
  // agent that built the page deliberately did NOT silence 9i by writing itself into
  // NO_NAV_ENTRY_BY_DESIGN, because that allowlist demands a reason that is TRUE, and "this route has no
  // nav entry by design" was not. A false reason that makes a harness green is worse than a red harness.
  { href: "/practice/knowledge-studio", label: "Practice Guidance", icon: "◈", capability: "template.manage", group: "Clinical", phase: 6, built: true, parent: "/practice/documents" },

  // -- Practice Home: the figures, until Insights ships ---------------------------------------------
  // ── CPR-V5-003: ANALYTICS AND PATIENT INSIGHTS BECOME ONE SECTION ───────────────────────────────
  //
  // They sat under the Command Centre as two separate children, which was two answers to one question:
  // "Analytics" counted activity and "Patient Insights" counted cohorts, from the same encounters, on
  // two screens neither of which was the whole picture. CPR-V5-003 makes Practice Intelligence a
  // workspace of its own with both inside it.
  //
  // ⚠ THIS AMENDS THE CPR-V5-002 FREEZE, WHICH IS ALLOWED ONLY THIS WAY. s17 of CPR-CORE-001: no card or
  // section changes "unless approved through product change control". CPR-V5-003 IS that approval, and it
  // is recorded here rather than assumed -- the freeze is worth nothing if it can be amended by whoever
  // is editing the file.
  //
  // The two routes are KEPT and re-parented, not deleted: both are built, both work, and a section that
  // absorbs two screens still has to be able to open them. They become children of Practice Intelligence.
  { href: "/practice/intelligence", label: "Practice Intelligence", icon: "◫", capability: "report.view", group: "Intelligence", phase: 5, built: true, primary: true },
  // "Patient Insights" is CPR-V5-003's "Patient Intelligence" module. Kept at its own route until the
  // workspace's tabs exist, so the cohort counts stay reachable rather than disappearing into a promise.
  { href: "/practice/reports", label: "Patient Intelligence", icon: "☷", capability: "report.view", group: "Patients", phase: 6, built: true, parent: "/practice/intelligence" },

  // -- AI Assistant: thinking about the work --------------------------------------------------------
  // CPR-220. NOT /practice/case-memory -- that slug is the public marketing page for this capability.
  // encounter.list, not patient.view: learning from a case does not require knowing whose it was.
  { href: "/practice/cases", label: "Case Memory", icon: "❧", capability: "encounter.list", group: "Intelligence", phase: 5, built: true, parent: "/practice/intelligence" },
  // CPR-230/240. NO CAPABILITY on either: reflecting on your own practice, and keeping an account of
  // your own work, are not permissions somebody grants you. Every query inside is scoped to the caller.
  { href: "/practice/reflection", label: "Reflection", icon: "◍", capability: null, group: "Intelligence", phase: 5, built: true, parent: "/practice/intelligence" },
  { href: "/practice/portfolio", label: "Portfolio", icon: "❑", capability: null, group: "Intelligence", phase: 5, built: true, parent: "/practice/intelligence" },

  // -- Practice Setup: configuring the practice, and your own preferences ---------------------------
  //
  // ── PIS-000 s3: THE BOOKING ADDRESS, REACHABLE AT LAST ──────────────────────────────────────────
  //
  // ⚠ THIS ENTRY EXISTS BECAUSE THE PRACTICE OWNER WALKED THE PRODUCT AND SAID "I DON'T SEE IDENTITY".
  // /practice/setup/identity shipped working and was reachable only by typing the URL: the setup
  // landing page links it from a header button and one part row, and neither is somewhere you look for
  // a section. A screen nobody can navigate to is a screen that does not exist, whatever the route
  // table says -- the same defect that made /practice/setup itself a dead end two specifications ago.
  //
  // ⚠ NOT PRIMARY, AND THAT IS THE WHOLE OF WHY IT IS SAFE. CPR-V5-002 froze PRIMARY_ORDER at nine and
  // the nav harness pins every one of them by name and by position. A CHILD of Practice Setup changes
  // no primary item, no order and no heading -- it is the same shape /practice/setup/lifecycle and
  // /practice/setup/clinical-parameters would have if they were listed, and identical to Team &
  // Permissions below. The identity page's own header used to say "it is not a sidebar item and must
  // not become one"; that sentence was about PRIMARY_ORDER, and it has been corrected in place rather
  // than left to contradict this line.
  //
  // ⚠ THE LABEL CARRIES BOTH WORDS ON PURPOSE. The page is titled "Your booking address" and the owner
  // went looking for "identity" -- one word finds it for the person choosing a public name, the other
  // for the person who remembers a practitioner number. A sidebar entry that only its author's
  // vocabulary can find is the failure this entry is fixing.
  //
  // ⚠ THE CAPABILITY IS THE PAGE'S OWN GUARD, practice.settings.manage -- which is also what the API
  // enforces. An entry rendered for somebody the page redirects is a sidebar item that bounces.
  { href: "/practice/setup/identity", label: "Identity & Address", icon: "@", capability: "practice.settings.manage", group: "Setup", phase: 8, built: true, parent: "/practice/setup" },
  // CP-OFF-UI-001 s7 - the Synchronisation Centre. Filed under Setup because it is about this DEVICE
  // rather than about a patient: what it is holding, what has reached the practice, and anything that
  // needs a person. It carries the same capability as the sync endpoints so the screen and the API agree
  // about who it is for.
  { href: "/practice/sync", label: "Synchronisation", icon: "⇅", capability: "encounter.list", group: "Setup", phase: 6, built: true, parent: "/practice/setup" },
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

/**
 * CPR-V5-001 s8's navigation order, DECLARED rather than inferred from where entries happen to sit in
 * the array -- the same reason NAV_GROUP_ORDER exists. Moving a route in the catalogue must not silently
 * reorder the sidebar, and the order here is a line from a specification that can be checked against it.
 *
 * "Encounters becomes the central workspace" (s8), which is why it sits fourth, immediately after the
 * three ways a practitioner gets to one.
 */
// CPR-PAT-002 s2's recommended sidebar, in its order. Ten items, flat.
//
// ⚠ DOCUMENTATION IS NOT IN THE SPECIFICATION'S LIST AND IS KEPT ANYWAY, as a child of Practice Setup
// rather than a primary item. The user asked for it explicitly ("yes" to a user-facing documentation
// section) two specifications ago; a later document that simply does not mention it is not the same as
// a decision to remove it, and silently deleting something somebody asked for is the one edit that
// should never be inferred. It stays reachable and out of the ten. If it should go entirely, that is a
// sentence somebody has to write.
export const PRIMARY_ORDER: string[] = [
  "/practice/home", "/practice/today", "/practice/calendar", "/practice/patients",
  "/practice/encounters", "/practice/documents", "/practice/follow-ups",
  "/practice/intelligence",
  "/practice/setup",
];

/**
 * CPR-V5-002's two sidebar sections, and which of the nine sit in each.
 *
 * DECLARED, not inferred from a `group` field that means something else. The comp draws NAVIGATION
 * over the eight operational workspaces and ADMINISTRATION over Practice Setup alone -- a heading is
 * part of the frozen design, so it is written down rather than derived from a property that was added
 * for a different purpose and could drift away from it.
 */
/** The sections below Workspace claim these. Declared once so Workspace can be "everything else". */
// CPR-PAT-002 collapsed the sections, so nothing is "claimed by a later section" any more. The constant
// is removed rather than left as an empty array that a future reader would try to fill.

// ⚠ CPR-PAT-002 s2 COLLAPSES THE GROUPS. The comp draws ten items in one flat list with no headings at
// all, and the specification's "simplify the global navigation" is the objective it opens with.
//
// The groups were carrying real meaning -- Insights existed to say "everything above this line can
// change a record and Practice Intelligence cannot" -- and that meaning is now unlabelled. Recorded
// rather than quietly dropped, because it is the kind of thing that gets re-derived by somebody in six
// months who cannot see why the order is what it is: the ordering below still puts the read-only
// workspace after the ones that write, it simply no longer says so in a heading.
//
// ONE SECTION, and the array is kept rather than removed. Every reader (`SIDEBAR_SECTIONS`, the nav
// harness, the shell) is written against it, and collapsing to a bare list would mean editing all three
// to express something the shape already expresses.
export const SIDEBAR_SECTIONS: { label: string; hrefs: string[] }[] = [
  { label: "", hrefs: PRIMARY_ORDER },
];

/** The sidebar: CPR-V5-001 s8's eight, in its order, filtered the same two ways everything else is. */
export function primaryNav(capabilities: string[]): PracticeNavItem[] {
  return visibleNav(capabilities)
    .filter(i => i.primary)
    .sort((a, b) => PRIMARY_ORDER.indexOf(a.href) - PRIMARY_ORDER.indexOf(b.href));
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
