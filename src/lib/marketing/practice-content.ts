// Competen Practice -- public product section (/practice and its six capability pages).
//
// DERIVED FROM CPR-000, CPR-000A and CPR-001 through CPR-020 (CPR-019 at Revision 2). Those are DEVELOPER
// specifications: they are written in states,
// business rules, permissions and acceptance criteria. None of that belongs on a marketing page, so what
// travels across is the OUTCOME each module produces for the person paying for it. The `modules` field on
// each area records which specs it came from -- it is never rendered, it exists so
// scripts/practice-content-harness.ts can prove that all twenty specified modules are represented and that
// none is claimed twice.
//
// TWO HONESTY RULES ARE ENCODED HERE, not left to whoever edits the copy next:
//
// 1. The screens are DESIGN MOCKUPS, not photographs of a running system. Every gallery renders the
//    PREVIEW_NOTE beside them. Competen Practice is specified, not shipped; a visitor who reads these as
//    screenshots of a live product has been misled by us, not by themselves.
//
// 2. The specifications distinguish Version 1 from later work -- CPR-000's integration strategy names
//    identity, notifications and document storage now and defers EMR interoperability, payments and
//    telemedicine; CPR-002 defers Google/Outlook calendar; CPR-013 defers push and WhatsApp. So each
//    integration carries `inV1`, and the ones that are not are labelled on the page. A clinic that buys
//    because "it connects to our laboratory system" has been sold something the documents do not promise.
//
// WEB-STRAT-001's disclosure rule still applies here: this page may name Competen Practice and what it does
// for a practice, but it must never name the platform's other products. See the FORBIDDEN list in
// scripts/public-disclosure-harness.ts, which asserts it against the rendered HTML of every page below.

export const PRACTICE_ACCENT = "#2563EB";
/** For accent-coloured text sitting on a tint OF that accent, where the base shade measures 4.37:1. */
export const PRACTICE_ACCENT_DARK = "#1D4ED8";

/** Shown beside every screen gallery. See honesty rule 1 above -- do not remove without also shipping. */
export const PREVIEW_NOTE = "Interface previews from the Competen Practice product design.";

export const PRACTICE_HERO = {
  eyebrow: "Competen Practice",
  headline: ["Run your practice.", "Delight your patients."],
  body:
    "An intelligent practice assistant for clinicians: patients book themselves in, arrive prepared, " +
    "and never fall out of follow-up. Built for the way clinics in Africa actually work.",
  primary: { label: "Book a Demo", href: "/signup" },
  secondary: { label: "See how it works", href: "#journey" },
  image: "/images/practice/dashboard.webp",
  imageAlt: "The Competen Practice home dashboard, showing today's schedule, follow-ups due and booking activity",
};

// CPR-000 "Product Vision", turned from statements of intent into what the practice gets.
export const PRACTICE_PROMISES = [
  { title: "Fewer phone calls", body: "Patients see real availability and book themselves in, day or night." },
  { title: "Fewer empty slots", body: "Reminders, waiting lists and recalls put cancelled time back to work." },
  { title: "Fewer lost patients", body: "Every diagnosis and treatment carries its own follow-up date." },
  { title: "Less admin", body: "Pre-visit questionnaires arrive completed, so the consultation starts sooner." },
];

// CPR-000's core design principles and out-of-scope list. This band exists because "not an EMR" is the most
// useful thing the architecture says about the product, and burying it would sell to the wrong clinics --
// which then churn. Stating the boundary is cheaper than discovering it in month three.
export const NOT_AN_EMR = {
  title: "It is not an EMR. That is deliberate.",
  body:
    "Competen Practice manages appointments, continuity and patient engagement. Where you already run an " +
    "electronic medical record, it connects to it rather than competing with it.",
  is: [
    "Appointments, availability and online booking",
    "A lightweight longitudinal patient record",
    "Diagnoses, current treatments and follow-up",
    "Documents, referrals and correspondence",
  ],
  isNot: [
    "Detailed consultation notes",
    "Inpatient nursing documentation",
    "Medication administration records",
    "Laboratory and radiology ordering",
    "Hospital billing and inventory",
    "A replacement for your existing EMR",
  ],
};

// CPR-000's eight-step patient journey, verbatim in substance. It is the clearest thing in the whole
// specification set and it is what a clinician actually wants to see before booking a demo.
export const PATIENT_JOURNEY = [
  { step: "Discover", body: "A patient finds your practice and your booking page." },
  { step: "Book", body: "They choose from the slots you have genuinely made available." },
  { step: "Confirm", body: "Confirmation and reminders go out automatically." },
  { step: "Prepare", body: "A pre-visit questionnaire arrives, matched to the appointment type." },
  { step: "Review", body: "You read the answers before the patient sits down." },
  { step: "Record", body: "You log the diagnosis summary and the current treatment." },
  { step: "Schedule", body: "The follow-up is booked before they leave." },
  { step: "Return", body: "Recalls bring them back when they are due, not when they remember." },
];

// CPR-000 "Primary User Roles". Organisation Administrator is marked optional in the specification and is
// described that way here rather than being quietly promoted to a headline role.
export const PRACTICE_ROLES = [
  { role: "Healthcare professionals", body: "Your day, your diary, your patients -- on one screen.", icon: "\u{1FA7A}" },
  { role: "Patients", body: "Book, prepare, upload and follow their own care.", icon: "\u{1F464}" },
  { role: "Reception and practice assistants", body: "A front desk that can see everything it needs and nothing it should not.", icon: "\u{1F5C2}️" },
  { role: "Practice administrators", body: "Locations, hours, users, templates and policy -- without a developer.", icon: "⚙️" },
];

/**
 * CPR-020 integration domains, split by what CPR-000's integration strategy places in Version 1. Everything
 * else is labelled on the page. See honesty rule 2 at the top of this file.
 */
export const INTEGRATIONS: { name: string; body: string; inV1: boolean }[] = [
  { name: "Identity & single sign-on", body: "One account across Competen, with SAML or OAuth2.", inV1: true },
  { name: "SMS & email delivery", body: "Reminders and confirmations through your own provider.", inV1: true },
  { name: "Document storage", body: "Encrypted storage for reports, referrals and consent forms.", inV1: true },
  { name: "EMR & EHR systems", body: "Standards-based exchange over HL7 and FHIR.", inV1: false },
  { name: "Laboratory & radiology", body: "Results and reports back into the patient record.", inV1: false },
  { name: "Pharmacy systems", body: "Prescriptions and medication information.", inV1: false },
  { name: "Payment gateways", body: "Consultation payments and receipts.", inV1: false },
  { name: "Google & Outlook Calendar", body: "Two-way sync with the diary you already keep.", inV1: false },
];

export const INTEGRATION_NOTE =
  "Version 1 covers identity, notifications and document storage. The rest is on the roadmap, and the " +
  "architecture is built for it -- REST APIs, webhooks and an FHIR-ready data layer.";

/**
 * CPR-000A Enterprise Integration Architecture, reduced to the part a clinic buying this actually needs.
 *
 * MOST OF CPR-000A IS NOT PUBLIC AND MUST NOT BECOME PUBLIC. It draws the platform operations control
 * plane, enumerates the super-administrator's powers including audited support impersonation, and names
 * the internal architectures it bridges. WEB-STRAT-001 forbids disclosing that layer, and separately, a
 * marketing page that volunteers "we can impersonate your users" answers a question nobody asked in the
 * worst possible venue. Its accompanying diagram is deliberately NOT published either -- an image is a
 * disclosure even though no text harness can read one.
 *
 * What IS public here is what the architecture BUYS the practice: isolation from every other tenant, one
 * identity across the workspaces a clinician belongs to, and enterprise services underneath that a
 * four-clinician practice could never stand up alone. Those are sections 8, 10 and 9 respectively.
 */
export const TENANT_MODEL = {
  title: "Your practice is your own.",
  body:
    "Competen Practice runs on the Competen platform, but your practice is a tenant of its own. That is " +
    "an architectural boundary, not a setting somebody could switch off by mistake.",
  pillars: [
    {
      title: "Nothing crosses to another practice",
      body: "Your users, patients, appointments, documents and analytics are isolated. No other practice can see them, and no data is shared between tenants.",
      points: ["Isolated users and patients", "Isolated appointments and documents", "Isolated analytics", "No cross-tenant visibility"],
    },
    {
      title: "One sign-in, wherever you work",
      body: "A clinician who works shifts at a hospital and runs a private clinic has one identity, not three. Switch between the workspaces you belong to without signing in again.",
      points: ["Single identity and sign-on", "Switch without re-authenticating", "Each workspace enforces its own permissions", "Access follows your memberships"],
    },
    {
      title: "Enterprise plumbing you do not run",
      body: "Authentication, audit and compliance, notifications, AI services, the API gateway and monitoring sit underneath your practice and are maintained for you.",
      points: ["Authentication and access control", "Audit and compliance records", "Notification delivery", "Monitoring and API access"],
    },
  ],
  // CPR-000A section 7 and CPR-019 Rev 2's governance rules, stated plainly. It is the honest answer to
  // "so who can actually change things", and it cuts both ways on purpose.
  boundary:
    "Your practice administrator manages your clinicians, calendars, rules and branding, and cannot reach " +
    "another practice or change platform-wide policy. Every administrative action is audited.",
};

export const PRACTICE_CTA = {
  title: "See it with your own clinic in mind.",
  body: "We will walk through your appointment book, your follow-up problem and your front desk, and show you what changes.",
  action: { label: "Book a Demo", href: "/signup" },
};

export type PracticeScreen = { src: string; alt: string; caption: string };

export type PracticeArea = {
  slug: string;
  nav: string;
  eyebrow: string;
  headline: string[];
  body: string;
  accent: string;
  icon: string;
  /** Card blurb on /practice. */
  blurb: string;
  /** CPR module ids this area covers. NEVER RENDERED -- traceability for the coverage harness only. */
  modules: string[];
  outcomes: { title: string; body: string }[];
  screens: PracticeScreen[];
};

// ACCENTS ARE MEASURED, NOT PICKED. Each one is used BOTH as small text on white ("Explore →", 12.5px)
// and as a chip background under white text, so it has to clear 4.5:1 in both directions. The obvious
// 600-weight teal, orange and cyan came in at 3.74, 3.56 and 3.68 -- fine on a mockup, unreadable to
// anyone with reduced contrast sensitivity, which in a product sold to clinicians is the wrong audience to
// lose. They are the 700 shades here for that reason; blue, violet and pink already cleared it at 600.
export const PRACTICE_AREAS: PracticeArea[] = [
  // ── CPR-002 Calendar & Availability, CPR-003 Online Booking, CPR-004 Appointments & Waiting List ──────
  {
    slug: "scheduling",
    nav: "Scheduling & booking",
    eyebrow: "Scheduling & booking",
    headline: ["Your diary fills itself.", "On your terms."],
    body:
      "You decide when you are available, at which location, and for how long. Patients see only what you " +
      "have opened, and book it without anyone answering the phone.",
    accent: "#2563EB",
    icon: "\u{1F4C5}",
    blurb: "Availability you control, booking patients do themselves, and a waiting list that refills cancellations.",
    modules: ["CPR-002", "CPR-003", "CPR-004"],
    outcomes: [
      { title: "Availability you set once", body: "Working days and hours per location, appointment types with their own durations, breaks, buffers, leave and public holidays -- all excluded automatically." },
      { title: "Booking around the clock", body: "Patients search, pick a location and appointment type, and confirm. Every slot offered is a slot that genuinely exists." },
      { title: "No double booking, ever", body: "Slots are validated in real time and conflicts are caught before a save, not after two patients arrive at nine." },
      { title: "Cancellations that refill", body: "Patients opt into a waiting list; when a slot is released it is offered automatically, with a response window before it passes to the next patient." },
      { title: "Rules, not exceptions", body: "Booking windows, cancellation policy, protected emergency slots and reschedule limits are settings -- so the front desk stops making judgement calls." },
      { title: "Recurring clinics and teleconsultation", body: "Repeating sessions, multiple locations and remote appointments sit on the same calendar, with timezones handled for you." },
    ],
    screens: [
      { src: "/images/practice/calendar.webp", alt: "Calendar and availability management showing day, week and month views across two branches and teleconsultation", caption: "Availability across every location, with breaks, leave and emergency slots in one view." },
      { src: "/images/practice/booking.webp", alt: "The patient-facing online booking page: select service and clinician, choose date and time, review and confirm", caption: "What your patients see. Five steps, no account required until it matters." },
      { src: "/images/practice/appointments.webp", alt: "Appointment management showing today's list by status, appointment detail and the waiting list", caption: "The full appointment lifecycle -- confirmed, checked in, completed, cancelled, no-show." },
    ],
  },

  // ── CPR-005 Check-in & Queue, CPR-018 Reception Workspace ────────────────────────────────────────────
  {
    slug: "front-desk",
    nav: "Front desk & clinic flow",
    eyebrow: "Front desk & clinic flow",
    headline: ["A calmer waiting room."],
    body:
      "Reception checks patients in, the queue orders itself, and you can see who is waiting and for how " +
      "long without walking out to look.",
    accent: "#0F766E",
    icon: "\u{1F6CE}️",
    blurb: "Check-in, a live queue with real waiting times, and a front desk that can run the day on one screen.",
    modules: ["CPR-005", "CPR-018"],
    outcomes: [
      { title: "Check in at the desk or on a phone", body: "Reception checks patients in; self check-in by kiosk or mobile is built into the same flow for when you want it." },
      { title: "A queue you can trust", body: "Expected, arrived, waiting, called, in consultation, completed. Position is assigned automatically and everyone sees the same list." },
      { title: "Waiting time as a number", body: "Average and longest wait, live. The thing patients complain about becomes something you can actually manage." },
      { title: "Emergencies jump the queue", body: "Priority override is a control, not a conversation. Missed patients are recalled or marked no-show." },
      { title: "One screen for the front desk", body: "Registration, walk-ins, telephone bookings, check-in, documents, referral coordination and the day's tasks together." },
      { title: "Boundaries that hold", body: "Reception can move a patient through the clinic and cannot touch a diagnosis or a treatment. Every administrative action is logged." },
    ],
    screens: [
      { src: "/images/practice/queue.webp", alt: "The live clinic queue showing patients by status, time in queue, next action and the current patient in consultation", caption: "The live queue, with time-in-queue and the next action for every patient." },
      { src: "/images/practice/reception.webp", alt: "The receptionist workspace showing today's schedule, waiting queue, quick actions, announcements and tasks", caption: "The front desk workspace: schedule, queue, quick actions and today's tasks." },
    ],
  },

  // ── CPR-006 Patient Portal, CPR-007 Questionnaires, CPR-013 Notifications ────────────────────────────
  {
    slug: "patient-experience",
    nav: "Patients & self-service",
    eyebrow: "Patients & self-service",
    headline: ["Patients who arrive", "already prepared."],
    body:
      "Your patients keep their own details up to date, complete their forms before they travel, and get " +
      "reminded in the channel they actually read.",
    accent: "#7C3AED",
    icon: "\u{1F4F1}",
    blurb: "A patient portal, pre-visit questionnaires that assign themselves, and reminders by SMS, email or in-app.",
    modules: ["CPR-006", "CPR-007", "CPR-013"],
    outcomes: [
      { title: "Patients maintain their own record", body: "Contact details, emergency contact, allergies, chronic conditions and current medication. You verify rather than retype." },
      { title: "Forms completed before the visit", body: "Questionnaires assign themselves from the appointment type, specialty or your own template, and can be made mandatory before the appointment." },
      { title: "Build a form without a developer", body: "Short text, choices, dates, numbers, pain scales, file upload and consent -- assembled by drag and drop, versioned, and reusable across the practice." },
      { title: "Answers waiting for you", body: "You read a summary before the consultation starts. The responses join the patient's timeline rather than living in a drawer." },
      { title: "Reminders in the right channel", body: "In-app, SMS and email, on intervals you configure, in the languages your patients speak -- with delivery status and automatic retry." },
      { title: "Patients see what you share", body: "Diagnoses, current treatments, documents and their own healthcare timeline -- released under your sharing policy, never by default." },
    ],
    screens: [
      { src: "/images/practice/portal.webp", alt: "The patient self-service portal showing profile, upcoming appointment, health summary, timeline and care team", caption: "The patient's own portal -- appointments, documents, health summary and care team." },
      { src: "/images/practice/questionnaires.webp", alt: "The pre-visit questionnaire engine showing assignments by patient, completion status and reusable templates", caption: "Questionnaires assigned automatically, with completion visible before the clinic starts." },
      { src: "/images/practice/notifications.webp", alt: "The notification and reminder engine showing sent, delivered, pending and failed messages across SMS, email and in-app channels", caption: "Every reminder, its channel, and whether it actually arrived." },
    ],
  },

  // ── CPR-008 Timeline, 009 Diagnosis, 010 Treatment, 011 Documents, 012 Follow-up, 014 Referrals ──────
  {
    slug: "continuity",
    nav: "Continuity of care",
    eyebrow: "Continuity of care",
    headline: ["Nothing falls", "through the gaps."],
    body:
      "One chronological view of the patient in front of you: what they have, what they are on, what you " +
      "sent out, and when they are due back.",
    accent: "#DB2777",
    icon: "\u{1FAB6}",
    blurb: "Timeline, diagnoses, current treatments, documents, referrals and the recalls that bring patients back.",
    modules: ["CPR-008", "CPR-009", "CPR-010", "CPR-011", "CPR-012", "CPR-014"],
    outcomes: [
      { title: "The whole journey, in order", body: "Appointments, questionnaires, diagnoses, treatment changes, referrals, documents and missed visits on a single filterable timeline." },
      { title: "A problem list that stays true", body: "Active, provisional, chronic, resolved and past history -- with optional ICD coding, severity, and the clinician responsible for each." },
      { title: "What the patient is actually on", body: "Medications, procedures, therapies, monitoring plans and home care, each linked to the diagnosis it treats and carrying its own review date." },
      { title: "Documents where you need them", body: "Referral letters, laboratory and radiology reports, discharge summaries and consent forms -- uploaded by you or the patient, versioned, and immutable once stored." },
      { title: "Referrals you can track", body: "Draft, sent, acknowledged, accepted, completed or declined. You know where a referral stands without telephoning the specialist's receptionist." },
      { title: "Recalls that chase for you", body: "Routine reviews, post-procedure checks, chronic disease reviews, screening and vaccination recalls -- scheduled, escalated when overdue, and surfaced on your dashboard." },
    ],
    screens: [
      { src: "/images/practice/timeline.webp", alt: "The patient timeline showing appointments, consultations, diagnoses, treatments, documents and referrals in chronological order", caption: "One chronological view of everything that has happened to this patient." },
      { src: "/images/practice/diagnosis.webp", alt: "The diagnosis tracker showing active, provisional, resolved, past history and allergy entries with ICD-10 codes", caption: "The problem list, separated into active, provisional, resolved and history." },
      { src: "/images/practice/treatments.webp", alt: "The current treatment tracker showing active medications, therapies, laboratory tests and referrals with next review dates", caption: "Current treatments, each linked to a diagnosis and a review date." },
      { src: "/images/practice/followups.webp", alt: "Follow-up and recall management showing upcoming and overdue reviews, recurring plans and assigned clinicians", caption: "Follow-ups and recalls, with the overdue ones impossible to miss." },
      { src: "/images/practice/referrals.webp", alt: "The referral and correspondence manager showing outgoing referrals, their status and recent replies", caption: "Referrals and correspondence, tracked from draft to completed." },
      { src: "/images/practice/documents.webp", alt: "The patient document repository showing categorised documents, who uploaded each, sharing status and storage usage", caption: "Documents, categorised and clearly marked as yours or the patient's." },
    ],
  },

  // ── CPR-001 Dashboard, CPR-015 Analytics, CPR-016 AI Assistant, CPR-017 Search ───────────────────────
  {
    slug: "intelligence",
    nav: "Insight & assistance",
    eyebrow: "Insight & assistance",
    headline: ["Know your practice.", "Get your time back."],
    body:
      "A command centre for the day, the numbers behind the month, search that finds anything, and an " +
      "assistant that does the writing you keep putting off.",
    accent: "#C2410C",
    icon: "✨",
    blurb: "A daily command centre, practice analytics, global search, and an AI assistant that drafts and summarises.",
    modules: ["CPR-001", "CPR-015", "CPR-016", "CPR-017"],
    outcomes: [
      { title: "Today, at a glance", body: "Appointments, new online bookings, follow-ups due, tasks and alerts -- with a drill-down behind every number and widgets you can reorder or hide." },
      { title: "The numbers that move the practice", body: "Completion and no-show rates, follow-up compliance, patient growth, referral, diagnosis and treatment trends, filtered by clinician, location or period." },
      { title: "Find anything, from anywhere", body: "One search bar across patients, appointments, diagnoses, treatments, documents, referrals and follow-ups, with saved searches and sub-second results." },
      { title: "The patients who need you", body: "Overdue follow-ups, recent diagnoses, active treatments and unrecorded observations surfaced next to the patient rather than waiting to be asked for." },
      { title: "An assistant for the admin", body: "Summarise a patient timeline, draft a referral letter, prepare a consultation summary, suggest an appointment slot -- in plain language." },
      { title: "Advisory, and clearly so", body: "No autonomous diagnosis, no autonomous prescribing, clinician approval on every clinical action, and a log of every interaction." },
    ],
    screens: [
      { src: "/images/practice/dashboard.webp", alt: "The practice home dashboard showing today's appointments, new bookings, follow-ups due, the calendar, today's schedule and tasks", caption: "The daily command centre -- today's work, first." },
      { src: "/images/practice/analytics.webp", alt: "The practice analytics dashboard showing appointment volume, patient demographics, diagnosis and treatment trends and no-show rate", caption: "Operational and clinical trends, filterable by clinician, location and period." },
      { src: "/images/practice/search.webp", alt: "Search and patient intelligence showing results across every domain with a patient quick view and saved searches", caption: "One search across every record, with the patient's context alongside." },
      { src: "/images/practice/assistant.webp", alt: "The AI practice assistant showing suggested tasks, smart alerts and a natural language chat with the practice's own data", caption: "The assistant, with its limits stated on the same screen as its suggestions." },
    ],
  },

  // ── CPR-019 Rev 2 Practice Configuration, CPR-020 Integrations ───────────────────────────────────────
  // Revision 2 splits configuration in two: what the practice administrator edits, and what the platform
  // holds read-only (tenant identity, licence, entitlements, security and backup policy, regional
  // deployment). That split is the whole point of the revision, so it is the shape of this page rather
  // than a line inside it -- and the read-only half is written as relief, because for a four-clinician
  // practice with no IT department "you cannot change the security policy" is the feature.
  {
    slug: "setup",
    nav: "Setup & connections",
    eyebrow: "Setup & connections",
    headline: ["You run the practice.", "We run the platform."],
    body:
      "Locations, hours, appointment types, users and templates are yours to change, from a settings " +
      "screen rather than a support ticket. Security policy, backups and licensing are ours -- and where " +
      "you already have systems, Practice talks to them.",
    accent: "#0E7490",
    icon: "\u{1F517}",
    blurb: "Everything the practice controls, everything it never has to, and standards-based links to the systems you already run.",
    modules: ["CPR-019", "CPR-020"],
    outcomes: [
      { title: "What you control", body: "Practice profile and branding, clinic locations, working days and hours, appointment types and durations, booking rules, notification preferences, questionnaire templates, document categories and assistant preferences." },
      { title: "What you never have to", body: "Tenant identity, subscription and licence, feature entitlements, regional deployment, security and password policy, backup and retention. Held by the platform, visible to you, and not your job to maintain." },
      { title: "Add your own team", body: "Create clinician and receptionist accounts, assign workspace membership, adjust local permissions and deactivate someone the day they leave -- without raising a ticket." },
      { title: "Your licence in plain sight", body: "Plan, status, renewal date and exactly which features are included, on the same screen as the settings they govern. No guessing what you are paying for." },
      { title: "Every change versioned", body: "Configuration carries version history and an audit record of who changed what and when. Critical changes ask for confirmation before they take effect." },
      { title: "Multiple sites, one practice", body: "Each location keeps its own hours, rooms and calendar while the practice keeps one patient list." },
      { title: "Standards-based exchange", body: "REST APIs, webhooks, import and export tools, and an FHIR-ready data layer for connecting to an EMR rather than replacing it." },
      { title: "Connections you can watch", body: "Health status per connection, retry queues for failures, and an audit record of every exchange with an outside system." },
    ],
    screens: [
      { src: "/images/practice/settings.webp", alt: "Practice configuration showing platform-managed read-only settings beside practice-managed editable settings, with subscription, feature entitlements and workspace membership", caption: "Read-only on the left, yours to edit on the right -- and the licence beside both." },
      { src: "/images/practice/integrations.webp", alt: "The integrations workspace showing connected systems, their sync status, data flow volumes and recent integration activity", caption: "Connected systems, their health, and what has actually moved in the last day." },
    ],
  },
];

export const areaBySlug = (slug: string) => PRACTICE_AREAS.find(a => a.slug === slug);

/**
 * Modules named in CPR-000's Version 1 list that have no specification document and are therefore NOT
 * represented anywhere above. Recorded rather than silently dropped, so the gap is visible the next time
 * this section is worked on. CPR-021 Patient Engagement Platform is listed in the architecture but no
 * developer specification was supplied for it.
 */
export const MODULES_WITHOUT_SPECS = ["CPR-021"];
