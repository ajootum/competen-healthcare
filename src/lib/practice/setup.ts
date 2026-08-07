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

// ────────────────────────────────────────────────────────────────────────────────────────────────────
// CPR-V5-008 PRACTICE SETUP WORKSPACE & CONFIGURATION FRAMEWORK -- the three-domain reorganisation.
//
// s1: "It should organise configuration into logical domains instead of a flat list of unrelated
// settings." THE SEVENTEEN MODULES ARE NOT REPLACED, THEY ARE GROUPED. CPR-SETUP-001's reading of what is
// configured is the same reading -- computed from the code and the data, never copied from a document --
// and this specification changes how it is presented and what is inferred from it, not where it comes
// from.
//
// ---- WHAT s7's PROGRESS MUST NOT BECOME ------------------------------------------------------------
//
// The comp draws a ring reading "72%" over "12 of 17 areas configured". THE LABEL IS THE TWO NUMBERS.
// A percentage is a figure with its denominator thrown away, and on a setup screen the denominator is
// the whole point: "72%" of seventeen and "72%" of five are the same badge over two different mornings.
// The ring is drawn from the fraction because an arc IS a fraction; the words beside it are counts.
//
// And the figure moves. Every part of it is computed from configuration that exists right now, so
// configuring something changes it. A percentage that does not move when you configure something is
// worse than no figure at all, because it teaches somebody that the screen is not listening.
//
// ---- s8's DEPENDENCY RULES ARE NOT DECORATION ------------------------------------------------------
//
// "Availability depends on Locations. Patient Booking depends on Availability, Appointment Types and
// Registration." A dependency that is stated and not enforced is a sentence; one that is computed
// against real state can tell somebody WHY the thing they are trying to do is not possible yet, which
// is the only version of it worth rendering.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * The comp's three chips, plus the two this build needs and the design does not have.
 *
 * ⚠ `unreadable` IS THE FIRST DOCTRINE MADE VISIBLE. A module whose configuration could not be read is
 * not a module with nothing in it. Rendering a failed query as "needs attention" sends somebody to
 * configure something that may already be configured, and rendering it as "configured" is worse.
 */
export type ModuleState = "configured" | "needs_attention" | "not_built" | "no_access" | "unreadable";

/** CPR-V5-008 s3-s5. Declared on every module so a module cannot sit in no domain or in two. */
export type SetupDomainKey = "foundation" | "operations" | "administration";

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
  /** CPR-V5-008's domain. */
  domain: SetupDomainKey;
  /**
   * CPR-V5-008 s4 makes Practice Availability & Patient Booking the domain's PRIMARY module and
   * CPR-V5-007 puts booking rules, appointment types and patient access INSIDE it. Those three keep
   * their identity in the seventeen -- CPR-SETUP-001 still counts them -- and render as parts of the
   * card that owns them rather than as four sibling cards saying overlapping things.
   */
  subsumedBy: string | null;
};

type Entry = {
  n: number; key: string; title: string; description: string; icon: string; hue: string;
  href: string | null; capability: string | null;
  domain: SetupDomainKey;
  subsumedBy?: string;
  specUnbuilt?: boolean;
  /** No implementation in THIS codebase. The only thing that makes a card unopenable. */
  notBuilt?: string;
};

/** The seventeen, in the framework's order and the comp's colours, each in its CPR-V5-008 domain. */
const CATALOGUE: Entry[] = [
  {
    n: 1, key: "profile", title: "Practice Profile",
    description: "Update your practice details, contact information and consultation preferences.",
    icon: "▣", hue: "var(--cp-success)", href: "/practice/settings?tab=practice#practice-profile", capability: "practice.settings.manage",
    domain: "foundation",
  },
  {
    n: 2, key: "locations", title: "Locations & Clinics",
    description: "Add hospitals, clinics and consulting rooms where you see patients.",
    icon: "◎", hue: "var(--cp-primary)", href: "/practice/settings?tab=practice#locations", capability: "practice.locations.manage",
    domain: "foundation",
  },
  {
    // ⚠ RENAMED AND REPOINTED BY CPR-V5-007. s3.1 names the page "Practice Availability & Patient
    // Booking" at /practice/setup/availability-booking, and s22 makes it the one coherent workspace the
    // practitioner experiences. The old route survives as the editor for the parts Phase 1 does not
    // rebuild -- exceptions and the single-row booking rule -- and is reached from inside the new one.
    n: 3, key: "availability", title: "Practice Availability & Patient Booking",
    description: "Sessions, exceptions, booking rules, access and registration.",
    icon: "▤", hue: "var(--cp-info)", href: "/practice/setup/availability-booking", capability: "appointment.manage",
    specUnbuilt: true, domain: "operations",
  },
  {
    n: 4, key: "appointment_types", title: "Appointment Types",
    description: "Define appointment types and default durations for your practice.",
    icon: "◷", hue: "var(--cp-warning)", href: "/practice/settings?tab=practice#practice-profile", capability: "practice.settings.manage",
    domain: "operations", subsumedBy: "availability",
  },
  {
    n: 5, key: "booking_rules", title: "Booking Rules",
    description: "Set booking windows, cancellation rules, lead times and other rules.",
    icon: "⚌", hue: "#DB2777", href: "/practice/setup/availability?step=4",
    capability: "practice.settings.manage", specUnbuilt: true,
    domain: "operations", subsumedBy: "availability",
  },
  {
    n: 6, key: "registration", title: "Registration Configuration",
    description: "Configure the patient registration form fields, requirements and logic.",
    icon: "▦", hue: "var(--cp-success)", href: "/practice/settings/registration-form",
    capability: "practice.settings.manage", specUnbuilt: true, domain: "operations",
  },
  {
    n: 7, key: "self_booking", title: "Self-Booking",
    description: "Manage your booking URL, visibility, instructions and confirmation experience.",
    icon: "⚭", hue: "var(--cp-accent)", href: null, capability: null, specUnbuilt: true,
    domain: "operations", subsumedBy: "availability",
    notBuilt: "There is no patient-facing booking page, and no OTP or approval flow behind one. CPR-V5-007 makes this Phase 4; Phase 1 builds the sessions it would publish, and nothing that publishes them.",
  },
  {
    n: 8, key: "notifications", title: "Patient Notifications",
    description: "Manage reminders, updates and other messages by SMS, email or WhatsApp.",
    icon: "◐", hue: "#7C3AED", href: null, capability: null, specUnbuilt: true, domain: "operations",
    notBuilt: "The delivery channel exists in the engine, and there is no screen to configure it — so nothing here can be turned on yet. Reminders are not scheduled or sent by anything either.",
  },
  {
    n: 9, key: "letterhead", title: "Letterhead & Branding",
    description: "Upload your letterhead, logo, colours and other branding assets.",
    icon: "⛨", hue: "var(--cp-warning)", href: "/practice/settings?tab=practice#letterhead", capability: "practice.settings.manage",
    specUnbuilt: true, domain: "foundation",
  },
  {
    n: 10, key: "identifiers", title: "Hospital Identifiers",
    description: "Configure hospital numbers and identifier rules for each location.",
    icon: "▥", hue: "var(--cp-primary)", href: "/practice/settings?tab=practice#institutions",
    capability: "practice.locations.manage", specUnbuilt: true, domain: "foundation",
  },
  {
    n: 11, key: "workflows", title: "Workflow Templates",
    description: "Create and configure workflows for different patient journey types.",
    icon: "⑃", hue: "var(--cp-info)", href: null, capability: null, specUnbuilt: true, domain: "operations",
    notBuilt: "The four entry pathways are fixed in the encounter engine. A visual designer over them changes the shape of the clinical record, which is not a setup form.",
  },
  {
    n: 12, key: "team", title: "Team & Permissions",
    description: "Invite team members and set their roles, permissions and access scope.",
    icon: "⚇", hue: "var(--cp-accent)", href: "/practice/people", capability: null, specUnbuilt: true,
    domain: "administration",
  },
  {
    n: 13, key: "integrations", title: "Integrations",
    description: "Connect calendars, communication tools and other systems.",
    icon: "⚯", hue: "#7C3AED", href: null, capability: null, specUnbuilt: true, domain: "administration",
    notBuilt: "No calendar, messaging, payment or FHIR integration exists. Each is somebody else's system and its own authorisation story.",
  },
  {
    n: 14, key: "import_export", title: "Import & Export",
    description: "Import patients, export data and manage your practice backups.",
    icon: "↧", hue: "var(--cp-warning)", href: "/practice/privacy", capability: "data.export",
    domain: "administration",
  },
  {
    n: 15, key: "ai", title: "AI Assistant",
    description: "Configure AI preferences, writing style, templates and privacy settings.",
    icon: "✧", hue: "var(--cp-primary)", href: "/practice/assistant", capability: "encounter.list",
    specUnbuilt: true, domain: "administration",
  },
  {
    n: 16, key: "billing", title: "Billing & Payments",
    description: "Set consultation fees, payment methods, invoices, taxes and discounts.",
    icon: "▣", hue: "#DB2777", href: null, capability: null, specUnbuilt: true, domain: "administration",
    notBuilt: "There is no billing module. Fees, invoices, taxes and a payment gateway are a financial system with its own reconciliation and audit obligations, not a settings page.",
  },
  {
    n: 17, key: "analytics", title: "Practice Analytics",
    description: "Configure dashboards, KPIs, reports and performance alerts.",
    icon: "◫", hue: "var(--cp-success)", href: "/practice/reports", capability: "report.view",
    specUnbuilt: true, domain: "administration",
  },
  {
    // ⚠ AN EIGHTEENTH MODULE, AND IT IS NOT A NAVIGATION CHANGE.
    //
    // CPR-LCP-001 s10.1 asks for "Practice Setup / Clinical Parameters page". LCP-001 contains no
    // navigation section at all -- s10 is titled "User Interface Requirements" and names a page under
    // Practice Setup plus two panels inside existing workspaces. So this is a card in an existing
    // domain at an existing route prefix, and PRIMARY_ORDER is untouched.
    //
    // THE COUNTS MOVE, AND THAT IS THE POINT. This page's own header says status is "computed from the
    // code and the data, never copied from the table" -- a module that exists and is not counted would
    // be the same lie in the other direction. CPR-SETUP-001's seventeen were the seventeen it knew
    // about; the denominator is what a practice can actually configure.
    n: 18, key: "clinical_parameters", title: "Clinical Parameters",
    description: "Choose what this practice measures, how often, and what counts as out of range.",
    icon: "⚖", hue: "var(--cp-accent)", href: "/practice/setup/clinical-parameters",
    capability: "parameter.view", domain: "operations",
  },
  {
    // ⚠ A NINETEENTH MODULE, IN administration, AND THE BREADCRUMB REFLECTS REALITY.
    //
    // CPR-LIFE-001 s8 says "Location: Practice Setup -> Security & Data -> Practice Lifecycle", and that
    // is the WHOLE of its navigation text -- there is no sidebar list and no instruction to restructure
    // anything. THERE IS NO `Security & Data` DOMAIN HERE: SETUP_DOMAINS is foundation, operations and
    // administration, and inventing a fourth would be a real restructure of a frozen surface on the
    // strength of a breadcrumb. So this is a card in `administration` beside Import & Export and Team &
    // Permissions -- exactly the precedent Clinical Parameters set above -- and the page's own
    // breadcrumb says "Practice Setup / Practice Administration / Practice Lifecycle", which is where it
    // actually is.
    //
    // The comp draws a grouped ~20-item three-section sidebar. It is a pre-decision picture: PRIMARY_ORDER
    // is nine flat items pinned by sixteen assertions in practice-current-activity-harness, and four
    // specs' comps have now drawn a different navigation. navigation.ts is untouched.
    n: 19, key: "lifecycle", title: "Practice Lifecycle",
    description: "Archive, suspend or restore this practice, see every state change, and export everything.",
    icon: "⟳", hue: "var(--cp-info)", href: "/practice/setup/lifecycle",
    capability: "practice.lifecycle.view", domain: "administration",
  },
];

/** CPR-V5-008 s3-s5, in the comp's order, with the sentence each domain answers. */
export const SETUP_DOMAINS: { key: SetupDomainKey; n: number; title: string; purpose: string; outputs: string[] }[] = [
  {
    key: "foundation", n: 1, title: "Practice Foundation",
    purpose: "Define who you are and where you work.",
    outputs: ["Practitioner identity", "Active locations", "Branding", "Facility identifiers"],
  },
  {
    key: "operations", n: 2, title: "Practice Operations",
    purpose: "Set up how your practice operates day to day.",
    outputs: ["Bookable availability", "Patient registration", "Workflows", "Notifications"],
  },
  {
    key: "administration", n: 3, title: "Practice Administration",
    purpose: "Manage your team, systems and business.",
    outputs: ["Roles and access", "Connected systems", "Reporting", "Assistance"],
  },
];

export type ChecklistItem = {
  key: string; label: string; done: boolean; detail: string | null; href: string | null;
  /** Doctrine: a failed read is never a zero. This line's subject could not be read at all. */
  unreadable: boolean;
};

/**
 * A module's own configuration, or the reason there is no answer.
 *
 * ⚠ `unreadable` IS NOT `done: false`. Every one of these was computed from a count that was destructured
 * straight out of a PostgREST response and defaulted with `?? 0` -- so a failed query produced a
 * confident "0 open · needs attention" that a practitioner would act on. The three states are now kept
 * apart from the first line.
 */
type Configured = { done: boolean; detail: string | null; unreadable?: boolean };

/** A count that says whether it is a count. `null` means the query failed; a number means it answered. */
const countOf = (q: { count: number | null; error: unknown }): number | null =>
  q.error ? null : (q.count ?? 0);

export async function practiceSetup(admin: any, ctx: WorkspaceContext) {
  const can = (c: string | null) => c === null || ctx.capabilities.includes(c);

  const [
    wsQ, configQ, locationsQ, facilitiesQ,
    slotsQ, templatesQ, channelsQ, membersQ,
    bookingRulesQ, weekSessionsQ, sessionRowsQ, sessionTypesQ,
    activityQ, parametersQ,
  ] = await Promise.all([
    // `status` joined the select for CPR-LIFE-001's module 19 -- the lifecycle card's detail IS the
    // practice's current state, so it is read from the same row the profile card already reads.
    admin.from("practice_workspace").select("name, timezone, country, status").eq("id", ctx.workspaceId).maybeSingle(),
    admin.from("practice_configuration")
      .select("letterhead_name, letterhead_registration, default_encounter_mode, clinic_opens_minute, ai_assistant_enabled, default_appointment_minutes")
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
    // CPR-V5-007 migration 240 -- the SESSION half of a session, which the counts above cannot see.
    // The rows rather than a count, because s7.4's capacity check needs the times and s4.3's
    // bookability check needs the mode.
    admin.from("practice_availability_template")
      // capacity_manual and appointment_type were dropped by migration 241 -- one capacity column, and
      // the join table owns the offered types.
      .select("id, starts_minute, ends_minute, appointment_minutes, capacity, booking_mode, activity_type, session_name")
      .eq("workspace_id", ctx.workspaceId).eq("status", "active"),
    admin.from("practice_session_appointment_type").select("template_id, appointment_type")
      .eq("workspace_id", ctx.workspaceId),
    admin.from("practice_audit_event")
      .select("event_type, payload, occurred_at").eq("workspace_id", ctx.workspaceId)
      .like("event_type", "practice.%").order("occurred_at", { ascending: false }).limit(4),
    // CPR-LCP-001 s10.1. What this practice has actually switched on -- a practice-wide activation in
    // the `active` state. An INACTIVE row is a deliberate switch-off and is not "configured", which is
    // why the state filter is here rather than a bare count of rows.
    admin.from("practice_parameter_activation").select("*", { count: "exact", head: true })
      .eq("workspace_id", ctx.workspaceId).eq("scope", "practice").eq("state", "active"),
  ]);

  const ws = wsQ.data;
  const config = configQ.data;
  const activity = activityQ.data;
  const locations = countOf(locationsQ);
  const facilities = countOf(facilitiesQ);
  const slots = countOf(slotsQ);
  const templates = countOf(templatesQ);
  const channels = countOf(channelsQ);
  const members = countOf(membersQ);
  const bookingRules = countOf(bookingRulesQ);
  const activeParameters = countOf(parametersQ);
  const weekSessions = countOf(weekSessionsQ);
  const sessionRows: any[] | null = sessionRowsQ.error ? null : ((sessionRowsQ.data ?? []) as any[]);
  const sessionTypeRows: any[] | null = sessionTypesQ.error ? null : ((sessionTypesQ.data ?? []) as any[]);

  // ── IS EACH BUILT MODULE ACTUALLY SET UP? ───────────────────────────────────────────────────────
  //
  // `done` is what makes a card green. Where a module is real but needs nothing configured to work, it
  // is done with a detail saying what it already does -- the comp has three chips and inventing a
  // fourth "nothing to do here" would be a legend entry nobody asked for.
  const unread = (what: string): Configured =>
    ({ done: false, unreadable: true, detail: `${what} could not be read` });

  const configured: Record<string, Configured> = {
    profile: wsQ.error
      ? unread("your practice profile")
      : { done: !!ws?.name && !!ws?.timezone && !!ws?.country, detail: ws?.timezone ?? null },
    locations: locations === null
      ? unread("your locations")
      : { done: locations > 0, detail: `${locations} open` },
    // A REGULAR WEEK, not merely some slots. Hand-made slots in the calendar are availability of a
    // sort, but CPR-SET-002's whole point is a template that keeps generating them -- so the card is
    // green when there is a week to repeat, and says so when there are only one-off slots.
    availability: weekSessions === null
      ? unread("your regular week")
      : {
        done: weekSessions > 0,
        detail: weekSessions > 0
          ? `${weekSessions} weekly ${weekSessions === 1 ? "session" : "sessions"}${slots === null ? "" : ` · ${slots} slots`}`
          : (slots ?? 0) > 0 ? `${slots} one-off slots, no regular week` : "nothing set aside",
      },
    booking_rules: bookingRules === null
      ? unread("your booking rules")
      : {
        done: bookingRules > 0,
        detail: bookingRules > 0 ? `${bookingRules} in force` : "no notice, no horizon, no walk-in limit",
      },
    // ⚠ THE SEVEN TYPES ARE BUILT IN AND NEED NOTHING CONFIGURED -- but CPR-V5-007 s4.3 makes LINKING
    // them to a session the thing that decides bookability, so the detail now says how many are actually
    // offered rather than only how many exist. "7 built in" was true and told nobody anything.
    appointment_types: sessionTypeRows === null
      ? unread("the types your sessions offer")
      : {
        done: true,
        detail: (() => {
          const offered = new Set(sessionTypeRows.map(r => r.appointment_type as string));
          for (const s of (sessionRows ?? [])) if (s.appointment_type) offered.add(s.appointment_type as string);
          return offered.size > 0
            ? `7 built in · ${offered.size} offered by your sessions`
            : "7 built in · none offered by a session yet";
        })(),
      },
    registration: templates === null
      ? unread("your registration forms")
      : { done: templates > 0, detail: templates > 0 ? `${templates} published` : "using the built-in fields" },
    // A CHANNEL BEING ON IS NOT REMINDERS BEING SENT -- nothing schedules one, and a practice that
    // ticked this and stopped ringing people would be worse off than before the feature existed.
    notifications: channels === null
      ? unread("your message channels")
      : { done: channels > 0, detail: channels > 0 ? "channel on · nothing sends by itself" : "no channel on" },
    letterhead: configQ.error
      ? unread("your branding")
      : { done: !!config?.letterhead_name, detail: config?.letterhead_name ?? "documents carry no header" },
    identifiers: facilities === null
      ? unread("your institutions")
      : { done: facilities > 0, detail: `${facilities} institutions` },
    team: members === null
      ? unread("your team")
      : { done: members > 1, detail: `${members} active` },
    // ⚠ ZERO IS "NEEDS ATTENTION", NOT "CONFIGURED". LCP s3 makes the engine minimal by default, so a
    // practice that has activated nothing is collecting nothing -- and a green tick over that would tell
    // somebody their vital signs are being recorded when no screen offers a box to type one into.
    clinical_parameters: activeParameters === null
      ? unread("your clinical parameters")
      : {
        done: activeParameters > 0,
        detail: activeParameters > 0
          ? `${activeParameters} collected`
          : "nothing is collected yet",
      },
    import_export: { done: true, detail: "export available · no import" },
    // ⚠ THERE IS NOTHING TO CONFIGURE HERE, SO THE CARD IS GREEN AND ITS DETAIL IS THE STATE ITSELF.
    // CPR-LIFE-001 s9 lists six configurable settings -- grace period, retention, approvals, MFA, export
    // availability and legal warning text -- and every one of them belongs to a deletion pipeline this
    // build deliberately does not have. A "needs attention" chip over a practice that is working
    // perfectly would send somebody looking for a form that does not exist and should not.
    lifecycle: wsQ.error
      ? unread("this practice's lifecycle state")
      : { done: true, detail: ws?.status ? String(ws.status).toLowerCase().replace(/_/g, " ") : null },
    ai: configQ.error
      ? unread("your assistant settings")
      : { done: config?.ai_assistant_enabled === true, detail: config?.ai_assistant_enabled === true ? "on, with the notice acknowledged" : "off" },
    analytics: { done: true, detail: "reports are built in" },
  };

  const modules: SetupModule[] = CATALOGUE.map(m => {
    const specSaysUnbuilt = m.specUnbuilt === true;
    const base = { ...m, subsumedBy: m.subsumedBy ?? null };
    if (m.notBuilt) {
      return {
        ...base, href: null, state: "not_built" as ModuleState, detail: null,
        unavailableReason: m.notBuilt, specSaysUnbuilt,
      };
    }
    // PERMISSION CHANGES WHETHER YOU CAN OPEN IT, NOT WHAT IT SAYS. The detail is still computed, so a
    // locum who cannot edit the practice can still see what state it is in -- which is what they need
    // when booking behaves unexpectedly. Withholding it would be gating the map along with the controls.
    const c = configured[m.key];
    if (!can(m.capability)) {
      return {
        ...base, href: null, state: "no_access" as ModuleState, detail: c?.detail ?? null,
        unavailableReason: "You do not have permission to change this.", specSaysUnbuilt,
      };
    }
    // ⚠ ORDERED BEFORE done/not-done ON PURPOSE. An unreadable module drawn as "needs attention" is an
    // instruction to go and configure something that may already be configured.
    if (c?.unreadable) {
      return {
        ...base, state: "unreadable" as ModuleState, detail: c.detail,
        unavailableReason: "This could not be read just now, so nothing here is a count of your practice.",
        specSaysUnbuilt,
      };
    }
    return {
      ...base,
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
      unreadable: configured[m.key]?.unreadable === true,
    }));

  // ══ CPR-V5-008 s4 -- THE PARTS OF THE PRIMARY OPERATIONS MODULE ═══════════════════════════════════
  //
  // The comp draws "3 of 6 complete" on the Practice Availability & Patient Booking card. The six are
  // computed here from the same rows everything else on this page is computed from, so the bar moves.
  //
  // ⚠ THE SIXTH IS NOT BUILT AND IS THEREFORE NOT IN THE DENOMINATOR. Patient booking access is
  // CPR-V5-007 Phase 4. Counting it would give the card a fraction it can never close, and a progress
  // bar that stops at five sixths for ever teaches somebody to stop reading it.
  const offeredTypeCount = sessionTypeRows === null ? null : (() => {
    const offered = new Set(sessionTypeRows.map(r => r.appointment_type as string));
    for (const s of (sessionRows ?? [])) if (s.appointment_type) offered.add(s.appointment_type as string);
    return offered.size;
  })();

  // s7.4: capacity is derived from time and appointment length unless a manual figure constrains it.
  // A session with neither a derivable nor a manual capacity holds an unknown number of patients.
  const defaultMinutes = configQ.error ? null : ((config?.default_appointment_minutes as number | undefined) ?? null);
  const sessionsWithoutCapacity = sessionRows === null ? null : sessionRows.filter(s => {
    const minutes = (s.appointment_minutes as number | null) ?? defaultMinutes;
    const derivable = minutes != null && minutes > 0 && (s.ends_minute - s.starts_minute) > 0;
    const manual = s.capacity ?? null;
    return !derivable && manual == null;
  }).length;

  type Part = { key: string; label: string; done: boolean | null; detail: string; href: string | null; notBuilt?: string };
  const availabilityParts: Part[] = [
    {
      key: "locations", label: "Somewhere to work",
      done: locations === null ? null : locations > 0,
      detail: locations === null ? "could not be read" : `${locations} open`,
      href: "/practice/settings?tab=practice#locations",
    },
    {
      key: "sessions", label: "Recurring sessions",
      done: weekSessions === null ? null : weekSessions > 0,
      detail: weekSessions === null ? "could not be read"
        : `${weekSessions} in your regular week`,
      href: "/practice/setup/availability-booking",
    },
    {
      key: "appointment_types", label: "Appointment types offered",
      done: offeredTypeCount === null ? null : offeredTypeCount > 0,
      detail: offeredTypeCount === null ? "could not be read"
        : offeredTypeCount > 0 ? `${offeredTypeCount} of 7 offered by a session`
          : "no session offers one, so none is patient-bookable",
      href: "/practice/setup/availability-booking",
    },
    {
      key: "capacity", label: "Session capacity",
      done: sessionsWithoutCapacity === null ? null
        : (weekSessions ?? 0) > 0 && sessionsWithoutCapacity === 0,
      detail: sessionsWithoutCapacity === null ? "could not be read"
        : (weekSessions ?? 0) === 0 ? "no sessions to hold anybody yet"
          : sessionsWithoutCapacity === 0 ? "every session has a capacity"
            : `${sessionsWithoutCapacity} session${sessionsWithoutCapacity === 1 ? "" : "s"} hold an unknown number`,
      href: "/practice/setup/availability-booking",
    },
    {
      key: "booking_rules", label: "Booking rules",
      done: bookingRules === null ? null : bookingRules > 0,
      detail: bookingRules === null ? "could not be read" : `${bookingRules} in force`,
      href: "/practice/setup/availability?step=4",
    },
    {
      key: "booking_access", label: "Patient booking access",
      done: null, detail: "not built",
      href: null,
      notBuilt: "A handle, a public URL, OTP verification and a publish state. CPR-V5-007 makes this Phase 4 and it has not been started.",
    },
  ];
  const availabilityPartsDone = availabilityParts.filter(p => p.done === true).length;
  const availabilityPartsOf = availabilityParts.filter(p => !p.notBuilt).length;

  // ══ CPR-V5-008 s8 -- DEPENDENCY RULES, COMPUTED ═══════════════════════════════════════════════════
  //
  // Stated as the specification states them, and evaluated against what is actually there. A dependency
  // that renders the same sentence whatever the practice looks like is a caption, not a rule.
  const done = (k: string) => configured[k]?.done === true;
  const readable = (k: string) => configured[k]?.unreadable !== true;

  type Dependency = {
    key: string; statement: string;
    /** Every prerequisite that is not satisfied, named. Empty means the dependency is met. */
    unmet: string[];
    /** True when a prerequisite could not be read, so "unmet" is not a claim either way. */
    indeterminate: boolean;
    /** The thing that depends on them, and whether it has been attempted anyway. */
    dependentKey: string;
    severity: "blocker" | "warning";
  };

  const dependencies: Dependency[] = [
    {
      key: "availability_needs_locations",
      statement: "Availability depends on Locations.",
      unmet: done("locations") ? [] : ["an open location"],
      indeterminate: !readable("locations"),
      dependentKey: "availability", severity: "blocker",
    },
    {
      key: "booking_needs_availability_types_registration",
      statement: "Patient Booking depends on Availability, Appointment Types and Registration.",
      unmet: [
        done("availability") ? null : "a regular week",
        (offeredTypeCount ?? 0) > 0 ? null : "an appointment type offered by a session",
        done("registration") ? null : "a published registration form",
      ].filter(Boolean) as string[],
      indeterminate: !readable("availability") || offeredTypeCount === null || !readable("registration"),
      dependentKey: "self_booking", severity: "blocker",
    },
    {
      key: "self_booking_needs_access_notifications_registration",
      statement: "Self-booking cannot be published until booking access, notifications and registration are configured.",
      // Booking access is Phase 4 and does not exist, so this one can never be met in this build and
      // says so as its first unmet item rather than looking like a form somebody forgot to fill in.
      unmet: [
        "patient booking access, which is not built",
        done("notifications") ? null : "a notification channel",
        done("registration") ? null : "a published registration form",
      ].filter(Boolean) as string[],
      indeterminate: !readable("notifications") || !readable("registration"),
      dependentKey: "self_booking", severity: "blocker",
    },
  ];

  // ══ CPR-V5-008 s7 -- PROGRESS BY DOMAIN ═══════════════════════════════════════════════════════════
  //
  // Four states, and the two this build adds because the four cannot express a failed read or a caller
  // with no permission. `needs_attention` wins over `in_progress` -- a domain with an unsatisfied
  // dependency is not merely partly done, it is stuck.
  type DomainState =
    | "not_started" | "in_progress" | "needs_attention" | "complete" | "unreadable" | "unavailable";

  const domains = SETUP_DOMAINS.map(d => {
    const mine = modules.filter(m => m.domain === d.key);
    // Cards the landing page draws: the primary of a subsumed group, not its parts.
    const cards = mine.filter(m => m.subsumedBy === null);
    const countable = mine.filter(m => m.state !== "not_built");
    const configuredHere = countable.filter(m => m.state === "configured");
    const unreadableHere = countable.filter(m => m.state === "unreadable");
    const noAccessHere = countable.filter(m => m.state === "no_access");
    const blocking = dependencies.filter(dep =>
      mine.some(m => m.key === dep.dependentKey) && dep.unmet.length > 0 && !dep.indeterminate
      // A dependency only NAGS once its dependent has been attempted or its own module is countable;
      // "self-booking cannot be published" is not a fault in a practice that never intends to publish.
      && dep.severity === "blocker" && mine.some(m => m.key === dep.dependentKey && m.state !== "not_built"),
    );

    let state: DomainState;
    if (countable.length === 0) state = "unavailable";
    else if (unreadableHere.length > 0) state = "unreadable";
    else if (noAccessHere.length === countable.length) state = "unavailable";
    else if (configuredHere.length === countable.length) state = "complete";
    else if (blocking.length > 0) state = "needs_attention";
    else if (configuredHere.length === 0) state = "not_started";
    else state = "in_progress";

    return {
      ...d,
      state,
      /** s7's progress, as the two numbers it is. Never a percentage. */
      progress: { done: configuredHere.length, of: countable.length },
      moduleKeys: mine.map(m => m.key),
      cardKeys: cards.map(m => m.key),
      notBuilt: mine.filter(m => m.state === "not_built").length,
      unreadable: unreadableHere.length,
      blockedBy: blocking.map(b => b.key),
    };
  });

  // ══ CPR-V5-008 s7 -- READINESS INDICATORS ═════════════════════════════════════════════════════════
  //
  // ⚠ "PATIENT BOOKING PUBLISHED" CAN NEVER BE MET IN THIS BUILD, and it is rendered as unmet WITH THE
  // REASON rather than left off. Removing it would make the list look complete; drawing it as an empty
  // circle beside three that can be filled would look like something the practitioner had failed to do.
  const domainState = (k: SetupDomainKey) => domains.find(d => d.key === k)!.state;
  const readiness = [
    {
      key: "foundation_complete", label: "Foundation complete",
      met: domainState("foundation") === "complete",
      indeterminate: domainState("foundation") === "unreadable",
      detail: "Your identity, your locations, your branding and your hospital numbering.",
      blockedReason: null as string | null,
    },
    {
      key: "operations_ready", label: "Operations ready",
      met: done("availability") && (offeredTypeCount ?? 0) > 0 && done("registration"),
      indeterminate: !readable("availability") || offeredTypeCount === null || !readable("registration"),
      detail: "A regular week, an appointment type a session offers, and a registration form.",
      blockedReason: null as string | null,
    },
    {
      key: "patient_booking_published", label: "Patient booking published",
      met: false,
      indeterminate: false,
      detail: "Patients cannot reach your diary.",
      blockedReason: "There is no patient-facing booking page. CPR-V5-007 makes the handle, the public URL, OTP verification and the publish state Phase 4, and it has not been started — so this cannot be met by configuring anything.",
    },
    {
      key: "practice_ready", label: "Practice ready",
      met: domains.every(d => d.state === "complete"),
      indeterminate: domains.some(d => d.state === "unreadable"),
      detail: "Every area you can configure is configured.",
      blockedReason: null as string | null,
    },
  ];

  // ── VALIDATION WARNINGS, in the practitioner's words ────────────────────────────────────────────
  const warnings: { key: string; severity: "blocker" | "warning" | "advisory"; text: string; href: string | null }[] = [];
  if (locations === 0)
    warnings.push({
      key: "no_locations", severity: "blocker",
      text: "You have no open location, so a working day has nowhere to be and nothing can be booked.",
      href: "/practice/settings?tab=practice#locations",
    });
  if (locations !== null && locations > 0 && weekSessions === 0)
    warnings.push({
      key: "no_sessions", severity: "warning",
      text: "You have somewhere to work and no regular week yet, so nothing repeats.",
      href: "/practice/setup/availability-booking",
    });
  if ((weekSessions ?? 0) > 0 && offeredTypeCount === 0)
    warnings.push({
      key: "no_types_offered", severity: "warning",
      text: "No session offers an appointment type. Zero types means not patient-bookable — even once the booking page exists.",
      href: "/practice/setup/availability-booking",
    });
  if (sessionsWithoutCapacity !== null && sessionsWithoutCapacity > 0)
    warnings.push({
      key: "capacity_unknown", severity: "advisory",
      text: `${sessionsWithoutCapacity} session${sessionsWithoutCapacity === 1 ? "" : "s"} hold an unknown number of patients — no appointment length to derive one from, and no manual limit.`,
      href: "/practice/setup/availability-booking",
    });
  if ((weekSessions ?? 0) > 0 && bookingRules === 0)
    warnings.push({
      key: "no_booking_rules", severity: "advisory",
      text: "No booking rule is in force, so there is no notice period, no horizon and no walk-in limit.",
      href: "/practice/setup/availability?step=4",
    });
  for (const m of modules.filter(x => x.state === "unreadable"))
    warnings.push({
      key: `unreadable_${m.key}`, severity: "warning",
      text: `${m.title} could not be read, so nothing on this page counts it either way.`,
      href: null,
    });

  return {
    practiceName: ws?.name ?? null,
    modules,
    checklist,
    domains,
    readiness,
    dependencies,
    warnings,
    availability: {
      parts: availabilityParts,
      progress: { done: availabilityPartsDone, of: availabilityPartsOf },
    },
    legend: [
      { key: "configured", label: "Configured", count: countBy("configured") },
      { key: "needs_attention", label: "Needs attention", count: countBy("needs_attention") },
      { key: "not_built", label: "Not built", count: countBy("not_built") },
      { key: "no_access", label: "No access", count: countBy("no_access") },
      { key: "unreadable", label: "Could not be read", count: countBy("unreadable") },
    ].filter(l => l.count > 0),
    progress: {
      done: checklist.filter(i => i.done).length,
      of: actionable,
      total: modules.length,
      allDone: checklist.every(i => i.done) && actionable > 0,
    },
    notBuiltCount: countBy("not_built"),
    /** Doctrine one, surfaced: how much of this page is a count and how much is a shrug. */
    unreadableCount: countBy("unreadable"),
    /** Where the specification says "Build" and this codebase already has an implementation. */
    specDisagreements: modules
      .filter(m => m.specSaysUnbuilt && m.state !== "not_built" && m.state !== "no_access")
      .map(m => ({ n: m.n, title: m.title })),
    recentActivity: ((activity ?? []) as any[]).map(a => ({
      eventType: a.event_type,
      label: String(a.event_type).replace(/^practice\./, "").replace(/_/g, " "),
      at: a.occurred_at,
    })),
    // ── s2's "contextual quick actions" -- CONTEXTUAL MEANING COMPUTED FROM THE GAP ─────────────────
    //
    // The comp lists five fixed buttons. Four of these are offered only when the thing they fix is
    // actually missing, so the panel is a list of what is left rather than a menu that looks the same
    // on the first morning and the hundredth.
    quickActions: [
      (weekSessions ?? 0) === 0
        ? { key: "availability", label: "Build your regular week", href: "/practice/setup/availability-booking", capability: "appointment.manage" }
        : { key: "availability", label: "Review your regular week", href: "/practice/setup/availability-booking", capability: "appointment.manage" },
      locations === 0
        ? { key: "location", label: "Add your first location", href: "/practice/settings?tab=practice#locations", capability: "practice.locations.manage" }
        : { key: "location", label: "Add a new clinic", href: "/practice/settings?tab=practice#locations", capability: "practice.locations.manage" },
      (members ?? 0) <= 1
        ? { key: "team", label: "Invite a team member", href: "/practice/people", capability: null }
        : null,
      (templates ?? 0) === 0
        ? { key: "form", label: "Publish a registration form", href: "/practice/settings/registration-form", capability: "practice.settings.manage" }
        : { key: "form", label: "Edit the registration form", href: "/practice/settings/registration-form", capability: "practice.settings.manage" },
      !done("letterhead")
        ? { key: "letterhead", label: "Add your letterhead", href: "/practice/settings?tab=practice#letterhead", capability: "practice.settings.manage" }
        : null,
    ].filter((a): a is { key: string; label: string; href: string; capability: string | null } => a !== null)
      .filter(a => can(a.capability)),
  };
}
