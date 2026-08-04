import type { WorkspaceContext } from "@/lib/practice/access";

/* eslint-disable @typescript-eslint/no-explicit-any */

// ────────────────────────────────────────────────────────────────────────────────────────────────────
// CPR-SET-000 v4.1 PRACTICE SETUP -- the fourteen configuration modules, and how much of each is real.
//
// ---- THE PROGRESS RING IS THE WHOLE PROBLEM WITH THIS SCREEN ------------------------------------------
//
// The comp shows "85% — Your practice is almost ready!" over a checklist of ten items, eight ticked and
// two amber. A setup dashboard is the one screen where a wrong completion figure does direct damage:
// somebody reads 85%, concludes they are nearly finished, and opens their doors with no booking rules
// and no way for patients to reach them.
//
// So every line of that checklist is READ FROM THE DATABASE, and the figure is a COUNT AND ITS
// DENOMINATOR -- "9 of 11 done", with the ring drawn to that scale. CPR-330's no-rates rule, and the
// same move OperationsHeader made when it replaced the comp's 82% donut with "7h 23m of 10h 00m".
//
// ---- AND FOUR OF THE FOURTEEN CARDS LEAD SOMEWHERE THAT DOES NOT EXIST -------------------------------
//
// Booking Rules, Self-Booking, Workflow Templates and Integrations have no implementation. The
// navigation catalogue has refused to render unbuilt routes since Phase 0 -- "unfinished routes must
// remain behind feature flags and must not lead to blank pages" -- and a setup hub is where that rule
// matters most, because the entire purpose of the screen is to tell somebody what is left to do.
//
// They are therefore SHOWN, in the comp's position and colour, marked as not built, NOT clickable, and
// EXCLUDED FROM THE DENOMINATOR. A checklist that counts work nobody can do is a checklist that can
// never reach the end -- and one that silently drops those rows would let a practice believe it had
// finished setting up something this product cannot yet do at all.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

export type ModuleState = "ready" | "incomplete" | "not_built" | "hidden";

export type SetupModule = {
  n: number;
  key: string;
  title: string;
  description: string;
  /** The comp's icon and hue for this card. */
  icon: string;
  hue: string;
  href: string | null;
  capability: string | null;
  state: ModuleState;
  /** What is actually configured, in the practitioner's words. Null when nothing to say. */
  detail: string | null;
  /** Why this cannot be opened. Only set when state is not_built. */
  unavailableReason: string | null;
};

/** The fourteen, in the specification's order (Parts III–XVI) and the comp's colours. */
const CATALOGUE: {
  n: number; key: string; title: string; description: string; icon: string; hue: string;
  href: string | null; capability: string | null; notBuilt?: string;
}[] = [
  {
    n: 1, key: "profile", title: "Practice Profile",
    description: "Update your practice details, contact information and consultation preferences.",
    icon: "▣", hue: "var(--cp-success)", href: "/practice/settings", capability: "practice.settings.manage",
  },
  {
    n: 2, key: "locations", title: "Locations & Clinics",
    description: "Add hospitals, clinics and consulting rooms where you see patients.",
    icon: "◎", hue: "var(--cp-primary)", href: "/practice/settings", capability: "practice.locations.manage",
  },
  {
    n: 3, key: "availability", title: "Availability",
    description: "Set your regular schedule, manage exceptions and block time.",
    icon: "▤", hue: "#7C3AED", href: "/practice/calendar", capability: "appointment.manage",
  },
  {
    n: 4, key: "appointment_types", title: "Appointment Types",
    description: "Define the types of appointments you offer and their default durations.",
    icon: "◷", hue: "var(--cp-warning)", href: "/practice/settings", capability: "practice.settings.manage",
  },
  {
    n: 5, key: "booking_rules", title: "Booking Rules",
    description: "Set booking windows, cancellations, lead times, walk-ins and other rules.",
    icon: "⚙", hue: "var(--cp-accent)", href: null, capability: null,
    notBuilt: "Lead times, cancellation windows and walk-in limits have no implementation yet. Booking today refuses a clash and a move between hospitals with no time to travel; everything else is the practitioner's judgement.",
  },
  {
    n: 6, key: "registration", title: "Registration Configuration",
    description: "Configure the patient registration form fields, requirements and logic.",
    icon: "▦", hue: "#DB2777", href: "/practice/settings/registration-form", capability: "practice.settings.manage",
  },
  {
    n: 7, key: "self_booking", title: "Self-Booking",
    description: "Manage your booking URL, visibility, instructions and confirmation experience.",
    icon: "⚭", hue: "var(--cp-success)", href: null, capability: null,
    notBuilt: "There is no patient-facing booking page. Building one is a decision about who may reach your diary without speaking to you, not a screen to fill in.",
  },
  {
    n: 8, key: "notifications", title: "Patient Notifications",
    description: "Choose how patients receive reminders, updates and other messages.",
    icon: "◐", hue: "var(--cp-primary)", href: "/practice/settings", capability: "practice.settings.manage",
  },
  {
    n: 9, key: "letterhead", title: "Letterhead & Branding",
    description: "Upload your letterhead, logo, colours and other branding assets.",
    icon: "⛨", hue: "var(--cp-warning)", href: "/practice/settings", capability: "practice.settings.manage",
  },
  {
    n: 10, key: "identifiers", title: "Hospital Identifiers",
    description: "Configure hospital numbers and identifier rules for each location.",
    icon: "▥", hue: "var(--cp-info)", href: "/practice/settings", capability: "practice.locations.manage",
  },
  {
    n: 11, key: "workflows", title: "Workflow Templates",
    description: "Create and configure workflows for different patient journey types.",
    icon: "⑃", hue: "var(--cp-primary)", href: null, capability: null,
    notBuilt: "The four entry pathways are fixed in the encounter engine (booked, walk-in, walk-in follow-up, scheduled follow-up). Making them configurable is a change to the clinical record's shape, not a setup form.",
  },
  {
    n: 12, key: "team", title: "Team & Permissions",
    description: "Invite team members and set their roles and permissions.",
    icon: "⚇", hue: "var(--cp-accent)", href: "/practice/people", capability: null,
  },
  {
    n: 13, key: "integrations", title: "Integrations",
    description: "Connect calendars, communication tools and other systems.",
    icon: "⚭", hue: "#7C3AED", href: null, capability: null,
    notBuilt: "No calendar, telemedicine or hospital integration exists. Each is somebody else's system and its own authorisation story.",
  },
  {
    n: 14, key: "import_export", title: "Import & Export",
    description: "Import patients, export data and manage backups.",
    icon: "↧", hue: "var(--cp-warning)", href: "/practice/privacy", capability: "data.export",
  },
];

export type ChecklistItem = {
  key: string;
  label: string;
  done: boolean;
  /** What was found. "3 locations" is more use than a tick. */
  detail: string | null;
  href: string | null;
};

export async function practiceSetup(admin: any, ctx: WorkspaceContext) {
  const can = (c: string | null) => c === null || ctx.capabilities.includes(c);

  const [
    { data: ws }, { data: config }, { count: locations }, { count: facilities },
    { count: slots }, { count: templates }, { count: channels }, { count: members },
    { data: activity },
  ] = await Promise.all([
    admin.from("practice_workspace").select("name, timezone, country").eq("id", ctx.workspaceId).maybeSingle(),
    admin.from("practice_configuration")
      .select("letterhead_name, letterhead_registration, default_encounter_mode, clinic_opens_minute")
      .eq("workspace_id", ctx.workspaceId).eq("is_effective", true).maybeSingle(),
    admin.from("practice_location").select("*", { count: "exact", head: true })
      .eq("workspace_id", ctx.workspaceId).eq("active", true),
    admin.from("practice_facility").select("*", { count: "exact", head: true })
      .eq("workspace_id", ctx.workspaceId).eq("active", true),
    admin.from("practice_availability_slot").select("*", { count: "exact", head: true })
      .eq("workspace_id", ctx.workspaceId),
    admin.from("practice_registration_template").select("*", { count: "exact", head: true })
      .eq("workspace_id", ctx.workspaceId).eq("status", "published"),
    admin.from("practice_message_channel").select("*", { count: "exact", head: true })
      .eq("workspace_id", ctx.workspaceId).eq("enabled", true),
    admin.from("practice_membership").select("*", { count: "exact", head: true })
      .eq("workspace_id", ctx.workspaceId).eq("status", "ACTIVE"),
    // The comp's "Recent setup activity" strip. Real audit rows, not a fabricated history.
    admin.from("practice_audit_event")
      .select("event_type, payload, occurred_at").eq("workspace_id", ctx.workspaceId)
      .like("event_type", "practice.%").order("occurred_at", { ascending: false }).limit(4),
  ]);

  // ── THE CHECKLIST, EVERY LINE READ FROM THE DATABASE ────────────────────────────────────────────
  //
  // Only things somebody can actually finish. Appointment types are absent deliberately: the seven are
  // a CHECK constraint in migration 192, so "define your appointment types" is not a task a practice
  // can complete or fail -- listing it would put a permanently unfinished row on the checklist.
  const checklist: ChecklistItem[] = [
    {
      key: "profile", label: "Practice profile completed",
      done: !!ws?.name && !!ws?.timezone && !!ws?.country,
      detail: ws?.timezone ? `${ws.name} · ${ws.timezone}` : "name, clock and country",
      href: "/practice/settings",
    },
    {
      key: "locations", label: "Locations added",
      done: (locations ?? 0) > 0,
      detail: `${locations ?? 0} open`, href: "/practice/settings",
    },
    {
      key: "availability", label: "Availability configured",
      done: (slots ?? 0) > 0,
      detail: (slots ?? 0) > 0 ? `${slots} sessions set` : "nothing set yet", href: "/practice/calendar",
    },
    {
      key: "clinic_hours", label: "Clinic hours set",
      done: config?.clinic_opens_minute != null,
      detail: null, href: "/practice/settings",
    },
    {
      key: "registration", label: "Registration form configured",
      done: (templates ?? 0) > 0,
      detail: (templates ?? 0) > 0 ? `${templates} published` : "using the built-in fields",
      href: "/practice/settings/registration-form",
    },
    {
      key: "identifiers", label: "Hospital identifiers configured",
      done: (facilities ?? 0) > 0,
      detail: `${facilities ?? 0} institutions`, href: "/practice/settings",
    },
    {
      key: "letterhead", label: "Letterhead uploaded",
      done: !!config?.letterhead_name,
      detail: config?.letterhead_name ?? "documents will carry no header", href: "/practice/settings",
    },
    {
      key: "notifications", label: "Patient notifications set",
      // A CHANNEL BEING ON IS NOT THE SAME AS REMINDERS BEING SENT, and the detail says so -- nothing
      // schedules one, so a practice that ticks this and stops ringing people would be worse off.
      done: (channels ?? 0) > 0,
      detail: (channels ?? 0) > 0 ? "a channel is on; nothing sends by itself" : "no channel is on",
      href: "/practice/settings",
    },
    {
      key: "team", label: "Team invited",
      done: (members ?? 0) > 1,
      detail: `${members ?? 0} active`, href: "/practice/people",
    },
  ];

  const doneCount = checklist.filter(i => i.done).length;

  // ── THE FOURTEEN CARDS ──────────────────────────────────────────────────────────────────────────
  const configured: Record<string, { done: boolean; detail: string | null }> = {
    profile: { done: !!ws?.name && !!ws?.timezone, detail: ws?.timezone ?? null },
    locations: { done: (locations ?? 0) > 0, detail: `${locations ?? 0} open` },
    availability: { done: (slots ?? 0) > 0, detail: (slots ?? 0) > 0 ? `${slots} sessions` : null },
    // Real, and honestly described: the types exist and their DEFAULT LENGTH is configurable, the list
    // itself is not. A card claiming otherwise would send somebody looking for a form that is not there.
    appointment_types: { done: true, detail: "7 built in · default length is yours" },
    registration: { done: (templates ?? 0) > 0, detail: (templates ?? 0) > 0 ? `${templates} published` : "built-in fields" },
    notifications: { done: (channels ?? 0) > 0, detail: (channels ?? 0) > 0 ? "channel on" : "no channel" },
    letterhead: { done: !!config?.letterhead_name, detail: config?.letterhead_name ?? null },
    identifiers: { done: (facilities ?? 0) > 0, detail: `${facilities ?? 0} institutions` },
    team: { done: (members ?? 0) > 1, detail: `${members ?? 0} active` },
    import_export: { done: true, detail: "export is available" },
  };

  const modules: SetupModule[] = CATALOGUE.map(m => {
    if (m.notBuilt) {
      return {
        ...m, state: "not_built" as ModuleState, detail: null,
        unavailableReason: m.notBuilt, href: null,
      };
    }
    if (!can(m.capability)) {
      return {
        ...m, state: "hidden" as ModuleState, detail: null, href: null,
        unavailableReason: "You do not have permission to change this.",
      };
    }
    const c = configured[m.key];
    return {
      ...m,
      state: (c?.done ? "ready" : "incomplete") as ModuleState,
      detail: c?.detail ?? null,
      unavailableReason: null,
    };
  });

  return {
    practiceName: ws?.name ?? null,
    modules,
    checklist,
    progress: {
      // COUNT AND DENOMINATOR, never a bare percentage -- see the header. The ring is drawn from these
      // two numbers rather than from a stored figure.
      done: doneCount,
      of: checklist.length,
      allDone: doneCount === checklist.length,
    },
    /** The four the checklist deliberately cannot count, named so their absence is visible. */
    notBuiltCount: CATALOGUE.filter(m => m.notBuilt).length,
    recentActivity: ((activity ?? []) as any[]).map(a => ({
      eventType: a.event_type,
      label: String(a.event_type).replace(/^practice\./, "").replace(/_/g, " "),
      at: a.occurred_at,
    })),
    quickActions: [
      { key: "availability", label: "Open availability calendar", href: "/practice/calendar", capability: "practice.calendar.view" },
      { key: "location", label: "Add a location", href: "/practice/settings", capability: "practice.locations.manage" },
      { key: "team", label: "Invite a team member", href: "/practice/people", capability: null },
      { key: "form", label: "Edit the registration form", href: "/practice/settings/registration-form", capability: "practice.settings.manage" },
    ].filter(a => can(a.capability)),
  };
}
