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

// ── CPR-001 v4 REGROUPING ────────────────────────────────────────────────────────────────────────────
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
export type PracticeNavGroup =
  | "Practice" | "Patients" | "Clinical" | "Communication" | "Intelligence" | "Administration";

export type PracticeNavItem = {
  href: string;
  label: string;
  icon: string;
  capability: string | null;
  group: PracticeNavGroup;
  /** Ships in this build phase; `built` flips when the route actually exists. */
  phase: number;
  built: boolean;
};

/** Sidebar order. Declared, not inferred from item order, so a reordered item cannot move a heading. */
export const NAV_GROUP_ORDER: PracticeNavGroup[] = [
  "Practice", "Patients", "Clinical", "Communication", "Intelligence", "Administration",
];

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
  // ── PRACTICE: running today ────────────────────────────────────────────────────────────────────
  // "Practice Command Centre", not "Home". The comp renames it and the name is the better one: this is
  // where a clinic morning is started, and "Home" says nothing about that.
  { href: "/practice/home", label: "Practice Command Centre", icon: "⌂", capability: "practice.home.view", group: "Practice", phase: 0, built: true },
  { href: "/practice/calendar", label: "Calendar", icon: "▤", capability: "practice.calendar.view", group: "Practice", phase: 1, built: true },
  // The comp lists Calendar and Appointments separately. They are one route -- CPR-CAL-001 built a day
  // view WITH the booking console on it -- and two entries pointing at the same page teaches people that
  // one of them is a mistake. Appointments is where the diary is: it is called Calendar.
  { href: "/practice/tasks", label: "Tasks", icon: "☑", capability: "task.view", group: "Practice", phase: 4, built: true },
  { href: "/practice/search", label: "Search", icon: "⌕", capability: "search.use", group: "Practice", phase: 5, built: true },

  // ── PATIENTS: people ───────────────────────────────────────────────────────────────────────────
  { href: "/practice/patients", label: "Patients", icon: "☺", capability: "patient.list", group: "Patients", phase: 2, built: true },
  { href: "/practice/follow-ups", label: "Follow-ups", icon: "↻", capability: "followup.view", group: "Patients", phase: 4, built: true },
  // The comp's "Patient Insights" — cohort counts by recorded diagnosis. It is a report, and it is the
  // reports page; a second route rendering the same figures under a nicer name is two answers to one
  // question. The command centre's Patient Insights widget links here.
  { href: "/practice/reports", label: "Patient Insights", icon: "☷", capability: "report.view", group: "Patients", phase: 6, built: true },

  // ── CLINICAL: the record ───────────────────────────────────────────────────────────────────────
  { href: "/practice/encounters", label: "Encounters", icon: "✎", capability: "encounter.list", group: "Clinical", phase: 3, built: true },
  { href: "/practice/activity", label: "Procedures", icon: "◷", capability: "procedure.record", group: "Clinical", phase: 4, built: true },
  { href: "/practice/documents", label: "Documents", icon: "▦", capability: "document.view", group: "Clinical", phase: 4, built: true },

  // ── COMMUNICATION: in and out ──────────────────────────────────────────────────────────────────
  { href: "/practice/messages", label: "Messages", icon: "✉", capability: "message.use", group: "Communication", phase: 5, built: true },
  // The comp calls this "Investigations". It is CPR-320's incoming register and it holds every arriving
  // document -- lab results among them, but also referrals and discharge summaries. Naming it after one
  // of its contents would promise an investigations module that does not exist.
  { href: "/practice/inbox", label: "Results & incoming", icon: "▼", capability: "inbox.record", group: "Communication", phase: 5, built: true },

  // ── INTELLIGENCE ───────────────────────────────────────────────────────────────────────────────
  { href: "/practice/intelligence", label: "Analytics", icon: "☀", capability: "report.view", group: "Intelligence", phase: 5, built: true },
  // CPR-220. NOT /practice/case-memory -- that slug is the public marketing page for this capability, and
  // a static route there would shadow it silently. encounter.list, not patient.view: learning from a case
  // does not require knowing whose it was, and the engine de-identifies for callers without it.
  { href: "/practice/cases", label: "Case Memory", icon: "❧", capability: "encounter.list", group: "Intelligence", phase: 5, built: true },
  // CPR-210. encounter.list, because it reads consultations and writes nothing clinical. Switching it
  // ON is a different act and takes practice.settings.manage, gated inside the page -- putting the nav
  // entry behind that permission would hide the disclosure from the people it is about.
  { href: "/practice/assistant", label: "AI Assistant", icon: "✧", capability: "encounter.list", group: "Intelligence", phase: 5, built: true },
  // CPR-230. NO CAPABILITY: reflecting on your own practice is not a permission somebody grants you.
  // What a reflection touches is gated where it is touched -- promoting a learning point goes through
  // CPR-220 and needs encounter.edit.
  { href: "/practice/reflection", label: "Reflection", icon: "◍", capability: null, group: "Intelligence", phase: 5, built: true },
  // CPR-240. NO CAPABILITY: a portfolio is an account of your own work, and nobody grants you permission
  // to keep one. Every query inside is scoped to the caller, so there is nothing to gate.
  { href: "/practice/portfolio", label: "Portfolio", icon: "❑", capability: null, group: "Intelligence", phase: 5, built: true },
  { href: "/practice/privacy", label: "Privacy and access", icon: "⚿", capability: "access.review", group: "Administration", phase: 5, built: true },
  // CPR-370: NO CAPABILITY. Everybody may see the devices signed in as THEM and lock one out; the
  // practice-wide view and the policy are gated inside the page. Hiding somebody's own device list
  // behind an audit permission would put it out of reach of the person who lost the laptop.
  { href: "/practice/privacy/security", label: "Security", icon: "⛨", capability: null, group: "Administration", phase: 5, built: true },
  // CPR-310: NO CAPABILITY. The page carries the approval queue, which belongs to practitioners rather
  // than administrators; the management half is gated inside it.
  { href: "/practice/people", label: "Team", icon: "⚇", capability: null, group: "Administration", phase: 5, built: true },
  // CPR-360: NO CAPABILITY. The page carries both halves -- personal settings, which everybody has, and
  // practice configuration, which the page itself gates. Requiring practice.settings.manage in the nav
  // would hide somebody's own text size behind an administrative permission.
  { href: "/practice/settings", label: "Settings", icon: "⚙", capability: null, group: "Administration", phase: 8, built: true },
];

export function visibleNav(capabilities: string[]): PracticeNavItem[] {
  return PRACTICE_NAV.filter(i => i.built && (i.capability === null || capabilities.includes(i.capability)));
}
