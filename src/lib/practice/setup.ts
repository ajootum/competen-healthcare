import type { WorkspaceContext } from "@/lib/practice/access";

/* eslint-disable @typescript-eslint/no-explicit-any */

// ────────────────────────────────────────────────────────────────────────────────────────────────────
// CPR-SETUP-001 v1 PRACTICE SETUP & CONFIGURATION FRAMEWORK -- seventeen modules.
//
// ---- 1. THE COMP'S PROGRESS PANEL CONTRADICTS ITSELF, THE DANGEROUS WAY ROUND -----------------------
//
// It draws a ring reading "13 of 17" over "76% complete", and directly beneath it a legend reading
// "Configured 4 · Needs attention 0 · Not configured 13". Both cannot be true: 13 is the count of areas
// that are NOT set up, and the ring presents it as the count that ARE. A practice reading that panel is
// told it is three-quarters ready at the exact moment thirteen of its seventeen areas are untouched.
//
// The figure here is the number CONFIGURED over the number that CAN be configured, and the counts in
// the legend sum to the total. The harness asserts both, so the contradiction cannot come back.
//
// ---- 2. THE SPECIFICATION'S OWN STATUS COLUMN DISAGREES WITH THIS CODEBASE --------------------------
//
// CPR-SETUP-001's table marks thirteen modules "Build" or "New" -- not yet implemented. Several already
// are, here:
//
//   6  Registration Configuration  the no-code form editor (/practice/settings/registration-form)
//   10 Hospital Identifier Engine  practice_facility + per-facility identifiers (migrations 222, 228)
//   12 Team & Permissions          practice RBAC, invitations, delegation (CPR-310)
//   3  ...travel-time blocking     travel_buffer_minutes, and booking refuses an impossible hop (228)
//   8  ...notification templates   a closed template list and a delivery channel (224)
//
// STATUS IS THEREFORE COMPUTED FROM THE CODE AND THE DATA, NEVER COPIED FROM THE TABLE. Rendering the
// specification's column verbatim would tell a practitioner that their registration form builder, their
// hospital numbering and their team management do not exist -- and they would stop using three things
// that work. The disagreement is surfaced on the page rather than silently resolved, because a
// specification and a codebase disagreeing is information.
//
// ---- 3. "NOT CONFIGURED" AND "NOT BUILT" ARE DIFFERENT SENTENCES ------------------------------------
//
// The comp gives thirteen cards the chip NOT CONFIGURED, which tells somebody to go and configure them.
// For the ones with no implementation that is an instruction they cannot follow, and following it is
// how an evening disappears. Those carry NOT BUILT, are not clickable, and are excluded from the
// denominator -- a count that includes work nobody can do never reaches its total.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

/** The comp's three chips, plus the one this build needs and the design does not have. */
export type ModuleState = "configured" | "needs_attention" | "not_built" | "no_access";

export type SetupModule = {
  n: number;
  key: string;
  title: string;
  description: string;
  icon: string;
  hue: string;
  href: string | null;
  capability: string | null;
  state: ModuleState;
  /** What is actually there, in the practitioner's words. */
  detail: string | null;
  /** Why it cannot be opened. Set for not_built and no_access. */
  unavailableReason: string | null;
  /** CPR-SETUP-001's table lists this as Build or New. Kept so the disagreement stays visible. */
  specSaysUnbuilt: boolean;
};

type Entry = {
  n: number; key: string; title: string; description: string; icon: string; hue: string;
  href: string | null; capability: string | null;
  specUnbuilt?: boolean;
  /** No implementation in THIS codebase. The only thing that makes a card unopenable. */
  notBuilt?: string;
};

/** The seventeen, in the framework's order and the comp's colours. */
const CATALOGUE: Entry[] = [
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
    n: 3, key: "availability", title: "Availability & Scheduling",
    description: "Set your regular schedule, exceptions and block time for commitments.",
    icon: "▤", hue: "var(--cp-info)", href: "/practice/setup/availability", capability: "appointment.manage",
    specUnbuilt: true,
  },
  {
    n: 4, key: "appointment_types", title: "Appointment Types",
    description: "Define appointment types and default durations for your practice.",
    icon: "◷", hue: "var(--cp-warning)", href: "/practice/settings", capability: "practice.settings.manage",
  },
  {
    n: 5, key: "booking_rules", title: "Booking Rules",
    description: "Set booking windows, cancellation rules, lead times and other rules.",
    icon: "⚌", hue: "#DB2777", href: "/practice/setup/availability",
    capability: "practice.settings.manage", specUnbuilt: true,
  },
  {
    n: 6, key: "registration", title: "Registration Configuration",
    description: "Configure the patient registration form fields, requirements and logic.",
    icon: "▦", hue: "var(--cp-success)", href: "/practice/settings/registration-form",
    capability: "practice.settings.manage", specUnbuilt: true,
  },
  {
    n: 7, key: "self_booking", title: "Self-Booking",
    description: "Manage your booking URL, visibility, instructions and confirmation experience.",
    icon: "⚭", hue: "var(--cp-accent)", href: null, capability: null, specUnbuilt: true,
    notBuilt: "There is no patient-facing booking page, and no OTP or approval flow behind one. Who may reach your diary without speaking to you is a decision, not a screen to fill in.",
  },
  {
    n: 8, key: "notifications", title: "Patient Notifications",
    description: "Manage reminders, updates and other messages by SMS, email or WhatsApp.",
    icon: "◐", hue: "#7C3AED", href: "/practice/settings", capability: "practice.settings.manage",
    specUnbuilt: true,
  },
  {
    n: 9, key: "letterhead", title: "Letterhead & Branding",
    description: "Upload your letterhead, logo, colours and other branding assets.",
    icon: "⛨", hue: "var(--cp-warning)", href: "/practice/settings", capability: "practice.settings.manage",
    specUnbuilt: true,
  },
  {
    n: 10, key: "identifiers", title: "Hospital Identifiers",
    description: "Configure hospital numbers and identifier rules for each location.",
    icon: "▥", hue: "var(--cp-primary)", href: "/practice/settings",
    capability: "practice.locations.manage", specUnbuilt: true,
  },
  {
    n: 11, key: "workflows", title: "Workflow Templates",
    description: "Create and configure workflows for different patient journey types.",
    icon: "⑃", hue: "var(--cp-info)", href: null, capability: null, specUnbuilt: true,
    notBuilt: "The four entry pathways are fixed in the encounter engine. A visual designer over them changes the shape of the clinical record, which is not a setup form.",
  },
  {
    n: 12, key: "team", title: "Team & Permissions",
    description: "Invite team members and set their roles, permissions and access scope.",
    icon: "⚇", hue: "var(--cp-accent)", href: "/practice/people", capability: null, specUnbuilt: true,
  },
  {
    n: 13, key: "integrations", title: "Integrations",
    description: "Connect calendars, communication tools and other systems.",
    icon: "⚯", hue: "#7C3AED", href: null, capability: null, specUnbuilt: true,
    notBuilt: "No calendar, messaging, payment or FHIR integration exists. Each is somebody else's system and its own authorisation story.",
  },
  {
    n: 14, key: "import_export", title: "Import & Export",
    description: "Import patients, export data and manage your practice backups.",
    icon: "↧", hue: "var(--cp-warning)", href: "/practice/privacy", capability: "data.export",
  },
  {
    n: 15, key: "ai", title: "AI Assistant",
    description: "Configure AI preferences, writing style, templates and privacy settings.",
    icon: "✧", hue: "var(--cp-primary)", href: "/practice/assistant", capability: "encounter.list",
    specUnbuilt: true,
  },
  {
    n: 16, key: "billing", title: "Billing & Payments",
    description: "Set consultation fees, payment methods, invoices, taxes and discounts.",
    icon: "▣", hue: "#DB2777", href: null, capability: null, specUnbuilt: true,
    notBuilt: "There is no billing module. Fees, invoices, taxes and a payment gateway are a financial system with its own reconciliation and audit obligations, not a settings page.",
  },
  {
    n: 17, key: "analytics", title: "Practice Analytics",
    description: "Configure dashboards, KPIs, reports and performance alerts.",
    icon: "◫", hue: "var(--cp-success)", href: "/practice/reports", capability: "report.view",
    specUnbuilt: true,
  },
];

export type ChecklistItem = {
  key: string; label: string; done: boolean; detail: string | null; href: string | null;
};

export async function practiceSetup(admin: any, ctx: WorkspaceContext) {
  const can = (c: string | null) => c === null || ctx.capabilities.includes(c);

  const [
    { data: ws }, { data: config }, { count: locations }, { count: facilities },
    { count: slots }, { count: templates }, { count: channels }, { count: members },
    { count: bookingRules }, { count: weekSessions },
    { data: activity },
  ] = await Promise.all([
    admin.from("practice_workspace").select("name, timezone, country").eq("id", ctx.workspaceId).maybeSingle(),
    admin.from("practice_configuration")
      .select("letterhead_name, letterhead_registration, default_encounter_mode, clinic_opens_minute, ai_assistant_enabled")
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
    // CPR-SET-002 migration 230. Module 5 stopped being "not built" when checkPlacement started
    // refusing on these, so it needs a real configured-check like every other built module.
    admin.from("practice_booking_rule").select("*", { count: "exact", head: true })
      .eq("workspace_id", ctx.workspaceId).eq("active", true),
    admin.from("practice_availability_template").select("*", { count: "exact", head: true })
      .eq("workspace_id", ctx.workspaceId).eq("active", true),
    admin.from("practice_audit_event")
      .select("event_type, payload, occurred_at").eq("workspace_id", ctx.workspaceId)
      .like("event_type", "practice.%").order("occurred_at", { ascending: false }).limit(4),
  ]);

  // ── IS EACH BUILT MODULE ACTUALLY SET UP? ───────────────────────────────────────────────────────
  //
  // `done` is what makes a card green. Where a module is real but needs nothing configured to work, it
  // is done with a detail saying what it already does -- the comp has three chips and inventing a
  // fourth "nothing to do here" would be a legend entry nobody asked for.
  const configured: Record<string, { done: boolean; detail: string | null }> = {
    profile: { done: !!ws?.name && !!ws?.timezone && !!ws?.country, detail: ws?.timezone ?? null },
    locations: { done: (locations ?? 0) > 0, detail: `${locations ?? 0} open` },
    // A REGULAR WEEK, not merely some slots. Hand-made slots in the calendar are availability of a
    // sort, but CPR-SET-002's whole point is a template that keeps generating them -- so the card is
    // green when there is a week to repeat, and says so when there are only one-off slots.
    availability: {
      done: (weekSessions ?? 0) > 0,
      detail: (weekSessions ?? 0) > 0
        ? `${weekSessions} weekly ${weekSessions === 1 ? "session" : "sessions"} · ${slots ?? 0} slots`
        : (slots ?? 0) > 0 ? `${slots} one-off slots, no regular week` : "nothing set aside",
    },
    booking_rules: {
      done: (bookingRules ?? 0) > 0,
      detail: (bookingRules ?? 0) > 0
        ? `${bookingRules} in force` : "no notice, no horizon, no walk-in limit",
    },
    appointment_types: { done: true, detail: "7 built in · default length is yours" },
    registration: { done: (templates ?? 0) > 0, detail: (templates ?? 0) > 0 ? `${templates} published` : "using the built-in fields" },
    // A CHANNEL BEING ON IS NOT REMINDERS BEING SENT -- nothing schedules one, and a practice that
    // ticked this and stopped ringing people would be worse off than before the feature existed.
    notifications: { done: (channels ?? 0) > 0, detail: (channels ?? 0) > 0 ? "channel on · nothing sends by itself" : "no channel on" },
    letterhead: { done: !!config?.letterhead_name, detail: config?.letterhead_name ?? "documents carry no header" },
    identifiers: { done: (facilities ?? 0) > 0, detail: `${facilities ?? 0} institutions` },
    team: { done: (members ?? 0) > 1, detail: `${members ?? 0} active` },
    import_export: { done: true, detail: "export available · no import" },
    ai: { done: config?.ai_assistant_enabled === true, detail: config?.ai_assistant_enabled === true ? "on, with the notice acknowledged" : "off" },
    analytics: { done: true, detail: "reports are built in" },
  };

  const modules: SetupModule[] = CATALOGUE.map(m => {
    const specSaysUnbuilt = m.specUnbuilt === true;
    if (m.notBuilt) {
      return {
        ...m, href: null, state: "not_built" as ModuleState, detail: null,
        unavailableReason: m.notBuilt, specSaysUnbuilt,
      };
    }
    // PERMISSION CHANGES WHETHER YOU CAN OPEN IT, NOT WHAT IT SAYS. The detail is still computed, so a
    // locum who cannot edit the practice can still see what state it is in -- which is what they need
    // when booking behaves unexpectedly. Withholding it would be gating the map along with the controls.
    const c = configured[m.key];
    if (!can(m.capability)) {
      return {
        ...m, href: null, state: "no_access" as ModuleState, detail: c?.detail ?? null,
        unavailableReason: "You do not have permission to change this.", specSaysUnbuilt,
      };
    }
    return {
      ...m,
      state: (c?.done ? "configured" : "needs_attention") as ModuleState,
      detail: c?.detail ?? null, unavailableReason: null, specSaysUnbuilt,
    };
  });

  // ── THE COUNTS BEHIND THE RING ──────────────────────────────────────────────────────────────────
  //
  // The comp's legend, and unlike the comp's own panel THESE SUM TO THE TOTAL. `of` counts only what a
  // practitioner can act on, so the fraction can actually reach its denominator.
  const countBy = (s: ModuleState) => modules.filter(m => m.state === s).length;
  // Everything with an implementation, whether or not THIS caller may edit it -- so the denominator is
  // a fact about the practice rather than about who is looking at it.
  const actionable = modules.filter(m => m.state !== "not_built").length;

  // THE CHECKLIST COVERS EVERY BUILT MODULE, INCLUDING THE ONES THIS CALLER CANNOT EDIT. It reports the
  // state of the practice, which is information rather than a control; only `href` is withheld, because
  // that is the control. A harness assertion caught the first version of this shrinking from eight rows
  // to four for a read-only caller.
  const checklist: ChecklistItem[] = modules
    .filter(m => m.state !== "not_built")
    .map(m => ({
      key: m.key, label: m.title,
      done: configured[m.key]?.done === true,
      detail: m.detail, href: m.href,
    }));

  return {
    practiceName: ws?.name ?? null,
    modules,
    checklist,
    legend: [
      { key: "configured", label: "Configured", count: countBy("configured") },
      { key: "needs_attention", label: "Needs attention", count: countBy("needs_attention") },
      { key: "not_built", label: "Not built", count: countBy("not_built") },
      { key: "no_access", label: "No access", count: countBy("no_access") },
    ].filter(l => l.count > 0),
    progress: {
      done: checklist.filter(i => i.done).length,
      of: actionable,
      total: modules.length,
      allDone: checklist.every(i => i.done) && actionable > 0,
    },
    notBuiltCount: countBy("not_built"),
    /** Where the specification says "Build" and this codebase already has an implementation. */
    specDisagreements: modules
      .filter(m => m.specSaysUnbuilt && m.state !== "not_built" && m.state !== "no_access")
      .map(m => ({ n: m.n, title: m.title })),
    recentActivity: ((activity ?? []) as any[]).map(a => ({
      eventType: a.event_type,
      label: String(a.event_type).replace(/^practice\./, "").replace(/_/g, " "),
      at: a.occurred_at,
    })),
    quickActions: [
      { key: "availability", label: "Configure availability", href: "/practice/calendar", capability: "practice.calendar.view" },
      { key: "location", label: "Add a new clinic", href: "/practice/settings", capability: "practice.locations.manage" },
      { key: "team", label: "Invite team member", href: "/practice/people", capability: null },
      { key: "form", label: "Edit the registration form", href: "/practice/settings/registration-form", capability: "practice.settings.manage" },
    ].filter(a => can(a.capability)),
  };
}
