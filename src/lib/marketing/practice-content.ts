// Competen Practice -- public product section (/practice and its seven capability pages).
//
// GOVERNED BY CPR-ARCH-001 VERSION 2, which supersedes CPR-000 v1. THE SECTION IS BUILT ON THE FIFTEEN PEN
// ENGINE SPECIFICATIONS: the CPR workspace space is being revised and its numbering already disagrees with
// itself twice over (see SPEC_CONFLICTS), so anchoring here to CPR ids meant re-deriving this file every
// time a workspace spec moved. The PEN library is stable, each engine is one document, and the fifteen
// together decompose the product -- so they are what `modules` cites and what the harness proves coverage
// of. Also informed by CPR-000A and CPR-ARCH-002 to 005.
//
// VERSION 2 REPOSITIONED THE PRODUCT, and the copy here follows it. Version 1 sold appointment management
// to a clinic. Version 2's own architecture statement is that Practice is "the healthcare professional's
// portable, longitudinal and intelligent record of their own practice across every authorised place and
// mode of work" -- practitioner-owned rather than clinic-owned, working without a receptionist, travelling
// with the clinician between employers, and turning routine encounters into case memory. That is both a
// truer and a far more distinctive claim, so the hero, the promises, the EMR boundary and the intelligence
// area were all rewritten rather than patched.
//
// Those are DEVELOPER specifications: they are written in states,
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

// CPR-ARCH-001 v2's own architecture statement, which is a far better headline than v1's had: the product
// is the PRACTITIONER's record, not the clinic's, and it travels with them. Version 1 sold appointment
// management -- true, but so does everyone else.
export const PRACTICE_HERO = {
  eyebrow: "Competen Practice",
  headline: ["Your practice.", "Wherever you practise."],
  body:
    "A portable, longitudinal record of your own clinical work -- across every hospital, clinic, outreach " +
    "site and teleconsultation. It follows you, not your employer.",
  image: "/images/practice/dashboard.webp",
  imageAlt: "The Competen Practice home dashboard, showing today's schedule, follow-ups due and booking activity",
};

// CPR-ARCH-001 v2's strategic principles, turned from architecture consequences into what a clinician
// gets. "No receptionist required" and "speed before completeness" are principles in the document, and
// they are the two that a solo practitioner will care about first.
export const PRACTICE_PROMISES = [
  { title: "It follows you", body: "Hospital A, Hospital B, your own clinic, an outreach round -- one personal record instead of five fragments." },
  { title: "No receptionist needed", body: "Designed to work for one clinician alone. Register a walk-in in under a minute and start seeing them." },
  { title: "Seconds, not forms", body: "Capture the minimum safely now and complete the detail later. Care does not wait for a long form." },
  { title: "It remembers for you", body: "Every encounter becomes searchable case experience: what you saw, what you did, what happened next." },
];

/**
 * CPR-ARCH-001 section 10. The multi-site story needs its caveat attached, because "one record across
 * every hospital you work at" invites exactly the wrong inference -- that data flows between them. The
 * architecture is explicit that it does not: organisation-supplied data stays governed by that
 * organisation, and cross-organisation patient matching does not happen automatically.
 */
export const PORTABILITY = {
  title: "One practice. Many places. Boundaries intact.",
  body:
    "You work across facilities; your record of that work should not be scattered across them. Competen " +
    "Practice gives you one personal operational view without collapsing anybody's data boundaries.",
  points: [
    { title: "Every encounter knows where it happened", body: "Facility, department, service, setting and the local patient identifier travel with the record." },
    { title: "Reports per facility, without leakage", body: "Filter and format for one hospital without exposing another's patients -- including the monthly list of who you saw and should be paid for." },
    { title: "The active boundary is always visible", body: "Switching context makes the organisation and its data boundary explicit, rather than leaving you to remember." },
    { title: "No silent cross-matching", body: "Patients are not linked across organisations automatically. That needs approved identity rules and consent." },
  ],
};

// CPR-000's core design principles and out-of-scope list. This band exists because "not an EMR" is the most
// useful thing the architecture says about the product, and burying it would sell to the wrong clinics --
// which then churn. Stating the boundary is cheaper than discovering it in month three.
export const NOT_AN_EMR = {
  title: "It is not the hospital's record. That is the point.",
  // CPR-ARCH-001 v2 sharpens v1's flat "it is not an EMR" into something more precise and more honest,
  // and adds two boundaries v1 never stated: importing an organisation's data does not transfer ownership
  // of it, and having worked at several facilities does not license disclosure between them. Both are
  // exactly the assumptions a practitioner would otherwise make, so both are said out loud.
  body:
    "Competen Practice is your professional record of your own authorised work with a patient. It is not " +
    "the authoritative institutional record, and it does not try to be -- where a hospital runs an EMR, " +
    "Practice connects to it rather than competing with it.",
  is: [
    "Your encounters, wherever they happened",
    "Diagnoses, treatments, procedures and outcomes",
    "Follow-up, recall and who is overdue",
    "Documents, referrals and correspondence",
    "Your own case memory and activity evidence",
  ],
  isNot: [
    "The authoritative hospital medical record",
    "Inpatient charts and medication administration records",
    "Laboratory, radiology, billing or stock systems",
    "Ownership of records imported from an organisation",
    "A licence to disclose between the facilities you work at",
    "Autonomous clinical decisions -- AI here is assistive and reviewable",
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

/**
 * CPR-ARCH-001 section 9.3, "Intelligence safeguards".
 *
 * Version 2 puts AI at the centre of the product, which makes these the terms on which a clinician is
 * being asked to trust it -- and they are unusually specific for a marketing page precisely because the
 * architecture is unusually specific. The third one is the load-bearing commitment: a system that renders
 * a recorded fact, a clinician's interpretation, a calculated metric and a model's inference in the same
 * typeface has quietly made all four equally believable.
 */
export const AI_SAFEGUARDS = {
  title: "What the AI may and may not do",
  body:
    "Practice Intelligence is built on your own cases, so the rules about how it behaves matter more than " +
    "the fact that it exists.",
  points: [
    { title: "It cites its sources", body: "Any summary links back to the encounters it was drawn from, so you can check it rather than take it on faith." },
    { title: "It never decides", body: "Suggestions require your review and cannot silently change a record. No autonomous diagnosis, no autonomous prescribing." },
    { title: "Fact and inference look different", body: "A recorded fact, your interpretation, a calculated metric and an AI inference are labelled distinctly rather than blurred together." },
    { title: "Your patients are not training data", body: "No model training on identifiable patient data without an approved policy and a lawful basis." },
    { title: "Small groups stay private", body: "Population-level insight applies minimum cohort thresholds, so a pattern can never identify one person." },
    { title: "You can correct it", body: "Misclassified cases can be fixed, and records you judge inappropriate can be excluded from analysis entirely." },
  ],
};

export const PRACTICE_CTA = {
  title: "See it with your own clinic in mind.",
  body: "We will walk through your appointment book, your follow-up problem and your front desk, and show you what changes.",
  // Was /signup, which creates a generic Competen account with the nurse role and no practice anywhere in
  // it. LP-PRA-001 gives the clinic owner a journey of their own, so the CTA now goes to that journey.
  action: { label: "Start Your Practice", href: "/practice/start" },
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
//
// THE AREAS FOLLOW THE PEN ENGINES, not the CPR workspaces. The CPR space is being revised and its
// numbering already disagrees with itself in two places (see SPEC_CONFLICTS), so anchoring the public
// section to it would mean re-deriving this file every time a workspace spec moves. The fifteen PEN
// specifications are stable, each is one document, and together they decompose the whole product -- so
// they are what `modules` cites and what the coverage assertion proves.
//
// The AREA NAMES are still outcomes, not engine names. WEB-STRAT-001 forbids marketing the software's
// internal decomposition, so "The encounter" rather than "Clinical Encounter, Rapid Capture and Workflow
// Engines". The engines decide what belongs together; the visitor never sees them.
export const PRACTICE_AREAS: PracticeArea[] = [
  // ── PEN-001 Appointment & Scheduling ────────────────────────────────────────────────────────────────
  {
    slug: "scheduling",
    nav: "Your diary",
    eyebrow: "Your diary",
    headline: ["Your time, opened", "on your terms."],
    body:
      "One diary across every place you work. You decide what is available where, and patients book only " +
      "what you have genuinely opened -- booked, walk-in, remote or emergency, all on the same calendar.",
    accent: "#2563EB",
    icon: "\u{1F4C5}",
    blurb: "Availability across every location, booking patients do themselves, and a walk-in queue that keeps the day moving.",
    modules: ["PEN-001"],
    outcomes: [
      { title: "Every kind of appointment", body: "New consultation, scheduled follow-up, walk-in, emergency, hospital consultation, teleconsultation, home or outreach visit -- one engine, one calendar." },
      { title: "Schedules you own", body: "Practitioner-owned by default and delegable when you want help. Each location keeps its own hours, durations and rules." },
      { title: "Slots that genuinely exist", body: "Availability is generated from your real working pattern, with buffers, holidays and blocked time already subtracted." },
      { title: "The walk-in queue", body: "Unscheduled arrivals join the same day without breaking it, and are managed as a queue rather than as interruptions." },
      { title: "Cancellations that refill", body: "Waiting-list management offers released time automatically instead of leaving an afternoon empty." },
      { title: "Straight into the consultation", body: "An appointment transitions to a clinical encounter automatically -- no second act of starting something." },
    ],
    screens: [
      { src: "/images/practice/calendar.webp", alt: "Calendar and availability management showing day, week and month views across two branches and teleconsultation", caption: "Availability across every location, with breaks, leave and emergency slots in one view." },
      { src: "/images/practice/booking.webp", alt: "The patient-facing online booking page: select service and clinician, choose date and time, review and confirm", caption: "What your patients see. Five steps, no account required until it matters." },
      { src: "/images/practice/appointments.webp", alt: "Appointment management showing today's list by status, appointment detail and the waiting list", caption: "The full appointment lifecycle -- confirmed, checked in, completed, cancelled, no-show." },
    ],
  },

  // ── PEN-003 Clinical Encounter, PEN-006 Rapid Data Capture, PEN-007 Workflow ────────────────────────
  // Version 2 makes the encounter the clinical centre of the product. This area replaces v1's "front desk
  // & clinic flow", whose name had come to contradict the architecture -- "no receptionist required" is a
  // v2 design principle, and a capability page named after the front desk sells the opposite.
  {
    slug: "encounter",
    nav: "The encounter",
    eyebrow: "The encounter",
    headline: ["Capture in seconds.", "Complete when you can."],
    body:
      "The consultation is the centre of the product. Record the minimum safely while the patient is in " +
      "front of you, link what matters, and finish the detail afterwards -- without a receptionist.",
    accent: "#0F766E",
    icon: "\u{1FA7A}",
    blurb: "One encounter lifecycle for every visit type, rapid capture by keyboard, touch or voice, and workflows that route the work.",
    modules: ["PEN-003", "PEN-006", "PEN-007"],
    outcomes: [
      { title: "One lifecycle, every visit type", body: "Initiate, verify identity, assess, diagnose, treat, plan follow-up, close. Booked or walk-in, clinic or ward, in person or remote -- the shape is the same." },
      { title: "Type the least you can", body: "Smart shortcuts, macros, specialty templates and smart defaults populated from the patient's own history rather than from a blank form." },
      { title: "Or say it", body: "Voice-to-structured capture transcribes and structures as you speak, for the days when typing is not an option." },
      { title: "Validated as you go", body: "Required fields, range and logic checks, code validation and duplicate prevention catch the problem while you can still fix it." },
      { title: "Nothing lost offline", body: "Capture continues without a connection and syncs securely when there is one -- outreach and home visits are not an exception." },
      { title: "Work that routes itself", body: "States, rules and task assignment move each piece of work to the right person with the right deadline, and escalate when one slips." },
      { title: "Closing does the rest", body: "Completing an encounter updates the timeline, files the follow-up, and contributes to your case memory. One action, not four." },
    ],
    screens: [
      { src: "/images/practice/queue.webp", alt: "The live clinic queue showing patients by status, time in queue, next action and the current patient in consultation", caption: "The live queue, with time-in-queue and the next action for every patient." },
      { src: "/images/practice/questionnaires.webp", alt: "The pre-visit questionnaire engine showing assignments by patient, completion status and reusable templates", caption: "Pre-visit answers waiting for you before the patient sits down." },
      { src: "/images/practice/diagnosis.webp", alt: "The diagnosis tracker showing active, provisional, resolved, past history and allergy entries with ICD-10 codes", caption: "The problem list, separated into active, provisional, resolved and history." },
      { src: "/images/practice/treatments.webp", alt: "The current treatment tracker showing active medications, therapies, laboratory tests and referrals with next review dates", caption: "Current treatments, each linked to a diagnosis and a review date." },
    ],
  },

  // ── PEN-002 Patient Identity, PEN-010 Notification & Communication ─────────────────────────────────
  {
    slug: "patients",
    nav: "Patients & contact",
    eyebrow: "Patients & contact",
    headline: ["The right patient.", "Reached the right way."],
    body:
      "One identity per patient, however many places you have met them -- and communication that reaches " +
      "them on the channel they actually read.",
    accent: "#7C3AED",
    icon: "\u{1F464}",
    blurb: "One longitudinal identity with duplicate detection, a patient portal, and reminders by SMS, email or in-app.",
    modules: ["PEN-002", "PEN-010"],
    outcomes: [
      { title: "One patient, one identity", body: "A single master identity that survives across organisations and locations, with hospital numbers, national IDs and insurance identifiers mapped to it rather than replacing it." },
      { title: "Duplicates caught, not created", body: "Probabilistic matching flags a likely duplicate at the moment of registration, with a confidence score you can tune and a merge that is fully auditable." },
      { title: "Found in seconds", body: "Search by name, phone, national ID, hospital number, QR or barcode -- the walk-in at the door is retrievable before they have finished explaining." },
      { title: "Patients maintain themselves", body: "Contact details, emergency contact, allergies and current medication kept current by the person who knows them. You verify rather than retype." },
      { title: "Reminders that arrive", body: "In-app, SMS and email on the intervals you set, with delivery status, retry on failure and a reason when something does not land." },
      // NOT "critical alerts override preferences". PEN-010 says they "bypass non-essential batching where
      // configured" -- which is a delivery-timing exception, not permission to message someone who opted
      // out. The two are one word apart on a page and a long way apart in a consent conversation.
      { title: "Preferences respected", body: "Channel choice, quiet hours, opt-outs and frequency limits are honoured. Genuinely urgent alerts skip the batching queue rather than the patient's consent." },
    ],
    screens: [
      { src: "/images/practice/portal.webp", alt: "The patient self-service portal showing profile, upcoming appointment, health summary, timeline and care team", caption: "The patient's own portal -- appointments, documents, health summary and care team." },
      { src: "/images/practice/notifications.webp", alt: "The notification and reminder engine showing sent, delivered, pending and failed messages across SMS, email and in-app channels", caption: "Every reminder, its channel, and whether it actually arrived." },
      { src: "/images/practice/reception.webp", alt: "The front desk workspace showing today's schedule, waiting queue, quick actions, announcements and tasks", caption: "If you do have an assistant, a workspace scoped to what they should touch." },
    ],
  },

  // ── PEN-004 Follow-up Intelligence, PEN-011 Document & Media, PEN-012 Patient Timeline ─────────────
  {
    slug: "continuity",
    nav: "Continuity of care",
    eyebrow: "Continuity of care",
    headline: ["Nothing falls", "through the gaps."],
    body:
      "One chronological view of everything you have done for this patient, everywhere -- and a follow-up " +
      "engine that chases the ones drifting away before they are lost.",
    accent: "#DB2777",
    icon: "\u{1FA79}",
    blurb: "A cross-site timeline, documents and images with provenance, and risk-based recall that escalates when a review slips.",
    modules: ["PEN-004", "PEN-011", "PEN-012"],
    outcomes: [
      { title: "The whole journey, in order", body: "Appointments, encounters, diagnoses, treatments, procedures, investigations, documents, referrals and outcomes on one filterable timeline." },
      { title: "Grouped into episodes", body: "Related events collapse into an episode of care with its own summary, so a two-year history is readable rather than merely complete." },
      { title: "Continuity across sites", body: "Encounters from every facility you work in appear in one view, each carrying where it happened and under whose identifier." },
      { title: "Follow-up by risk, not by rota", body: "Reminder cadence follows the patient's risk. Overdue reviews are detected, prioritised and escalated on rules you set." },
      { title: "Every kind of review", body: "Scheduled, walk-in, post-procedure, tele-follow-up, chronic monitoring, post-discharge and preventive recall -- each linked to the encounter that created it." },
      // "Indexed and searchable" rather than "searchable by their contents". PEN-011 promises AI-assisted
      // indexing and searchable metadata; full-text extraction from inside a scanned letter appears on the
      // diagram but not in the specification, and it is a materially bigger promise than tagging is.
      { title: "Documents where the care is", body: "Letters, reports, scans, clinical photographs and voice notes attached to the encounter, version-controlled, tagged and indexed so they are findable later." },
      { title: "Immutable once signed", body: "Signed timeline events cannot be quietly altered. Corrections are versioned and visible, which is what makes the record worth anything later." },
    ],
    screens: [
      { src: "/images/practice/timeline.webp", alt: "The patient timeline showing appointments, consultations, diagnoses, treatments, documents and referrals in chronological order", caption: "One chronological view of everything that has happened to this patient." },
      { src: "/images/practice/followups.webp", alt: "Follow-up and recall management showing upcoming and overdue reviews, recurring plans and assigned clinicians", caption: "Follow-ups and recalls, with the overdue ones impossible to miss." },
      { src: "/images/practice/documents.webp", alt: "The patient document repository showing categorised documents, who uploaded each, sharing status and storage usage", caption: "Documents, categorised and clearly marked as yours or the patient's." },
      { src: "/images/practice/referrals.webp", alt: "The referral and correspondence manager showing outgoing referrals, their status and recent replies", caption: "Referrals and correspondence, tracked from draft to completed." },
    ],
  },

  // ── PEN-005 Practice Intelligence, PEN-008 Clinical Search, PEN-013 AI Clinical Decision Support ───
  {
    slug: "intelligence",
    nav: "Your case memory",
    eyebrow: "Your case memory",
    headline: ["Everything you have seen,", "when you need it again."],
    body:
      "Version 2's flagship: every encounter you record becomes searchable case experience. Not a " +
      "dashboard about your practice -- a memory of it, that answers questions.",
    accent: "#C2410C",
    icon: "✨",
    blurb: "Similar-case retrieval, what your treatments actually achieved, and decision support that shows its working.",
    modules: ["PEN-005", "PEN-008", "PEN-013"],
    // CPR-ARCH-001 section 9.2 lists the questions the intelligence layer must answer. They are written
    // here almost as asked, because a clinician recognises their own question faster than they recognise
    // a feature name -- and because a claim in the form of a question is one you can be held to.
    outcomes: [
      { title: "“Have I seen this before?”", body: "Similar-case retrieval across your own practice: patients with comparable characteristics, what was done, and what happened next." },
      { title: "“What actually worked?”", body: "Treatment and procedure registries carrying the responses and outcomes you recorded -- effectiveness in your hands, not in a journal." },
      { title: "“What is changing?”", body: "Which diagnoses and procedures are rising in your practice, by facility, specialty, location and period." },
      { title: "Ask it in plain English", body: "Natural-language search across patients, encounters, diagnoses, treatments, documents and follow-ups, with results in under two seconds." },
      { title: "Decision support that shows its working", body: "Differential suggestions, guideline matches, risk and early-warning scores and medication safety checks -- each with its evidence and a confidence band attached." },
      { title: "A knowledge base that is yours", body: "The longitudinal graph is built from your validated encounters and grows with them, rather than being rented from someone else's dataset." },
    ],
    screens: [
      { src: "/images/practice/search.webp", alt: "Search and patient intelligence showing results across every domain with a patient quick view and saved searches", caption: "One search across every record, with the patient's context alongside." },
      { src: "/images/practice/assistant.webp", alt: "The AI practice assistant showing suggested tasks, smart alerts and a natural language chat with the practice's own data", caption: "The assistant, with its limits stated on the same screen as its suggestions." },
      { src: "/images/practice/dashboard.webp", alt: "The practice home dashboard showing today's appointments, new bookings, follow-ups due, the calendar, today's schedule and tasks", caption: "The daily command centre -- today's work, first." },
    ],
  },

  // ── PEN-009 Reporting & Export, PEN-014 Research & Knowledge Generation ────────────────────────────
  // A separate area rather than a paragraph inside intelligence: the hospital payment list and the
  // portfolio are the two outputs a practitioner can put a number on, and burying them under "analytics"
  // is how a product loses the argument it was winning.
  {
    slug: "evidence",
    nav: "Evidence & reporting",
    eyebrow: "Evidence & reporting",
    headline: ["Proof of what", "you actually did."],
    body:
      "The reports a working clinician genuinely needs: what each hospital owes you for, what you have " +
      "treated and achieved, and the evidence behind an appraisal, a portfolio or a paper.",
    accent: "#0E7490",
    icon: "\u{1F4CA}",
    blurb: "Hospital payment lists, activity and outcome reporting, professional portfolio evidence and governed research datasets.",
    modules: ["PEN-009", "PEN-014"],
    outcomes: [
      { title: "The hospital payment list", body: "Who you saw at which facility this month, formatted for that facility and exposing no other's patients. Reconciliation stops being an evening's work." },
      { title: "Activity and outcomes", body: "Clinic activity, diagnosis and treatment analytics, follow-up compliance and clinical outcomes -- built once and scheduled thereafter." },
      { title: "Your professional portfolio", body: "A case log and experience map you can take to an appraisal, a revalidation or a training application, drawn from work you had to record anyway." },
      { title: "Export in the format asked for", body: "PDF, Excel and CSV, delivered on a schedule or over an API, with templates version-controlled and every export audited." },
      { title: "Registries and cohorts", body: "Build a disease registry or an outcome cohort from your own longitudinal data, with inclusion criteria you define and provenance retained." },
      { title: "Research without exposure", body: "Automated de-identification, re-identification risk checks and consent governance before a dataset leaves -- publication support, not a spreadsheet of patients." },
    ],
    screens: [
      { src: "/images/practice/analytics.webp", alt: "The practice analytics dashboard showing appointment volume, patient demographics, diagnosis and treatment trends and no-show rate", caption: "Operational and clinical trends, filterable by clinician, location and period." },
    ],
  },

  // ── PEN-015 Integration & Interoperability ────────────────────────────────────────────────────────
  {
    slug: "setup",
    nav: "Setup & connections",
    eyebrow: "Setup & connections",
    headline: ["You run the practice.", "We run the platform."],
    body:
      "Locations, hours, appointment types, users and templates are yours to change, from a settings " +
      "screen rather than a support ticket. Security policy, backups and licensing are ours -- and where " +
      "you already have systems, Practice talks to them.",
    accent: "#155E75",
    icon: "\u{1F517}",
    blurb: "Everything the practice controls, everything it never has to, and standards-based links to the systems you already run.",
    modules: ["PEN-015"],
    outcomes: [
      { title: "What you control", body: "Practice profile and branding, clinic locations, working days and hours, appointment types and durations, booking rules, notification preferences, questionnaire templates, document categories and assistant preferences." },
      { title: "What you never have to", body: "Tenant identity, subscription and licence, feature entitlements, regional deployment, security and password policy, backup and retention. Held by the platform, visible to you, and not your job to maintain." },
      { title: "Add your own team", body: "Create clinician and assistant accounts, assign workspace membership, adjust local permissions and deactivate someone the day they leave -- without raising a ticket." },
      { title: "Your licence in plain sight", body: "Plan, status, renewal date and exactly which features are included, on the same screen as the settings they govern." },
      { title: "Every change versioned", body: "Configuration carries version history and an audit record of who changed what and when. Critical changes ask for confirmation before they take effect." },
      { title: "Standards-based exchange", body: "HL7 v2, FHIR R4, REST APIs, webhooks and DICOM for imaging -- built to connect to an EMR, laboratory, radiology or pharmacy system rather than replace it." },
      { title: "Connections you can watch", body: "Health status per connection, retry and dead-letter queues for failures, and an audit record of every exchange with an outside system." },
    ],
    screens: [
      { src: "/images/practice/settings.webp", alt: "Practice configuration showing platform-managed read-only settings beside practice-managed editable settings, with subscription, feature entitlements and workspace membership", caption: "Read-only on the left, yours to edit on the right -- and the licence beside both." },
      { src: "/images/practice/integrations.webp", alt: "The integrations workspace showing connected systems, their sync status, data flow volumes and recent integration activity", caption: "Connected systems, their health, and what has actually moved in the last day." },
    ],
  },
];

export const areaBySlug = (slug: string) => PRACTICE_AREAS.find(a => a.slug === slug);

/**
 * Modules named in an architecture document that have no specification of their own and are therefore NOT
 * represented above. Recorded rather than silently dropped, so the gap stays visible.
 *
 *   CPR-021  Patient Engagement Platform -- named in CPR-000's Version 1 module list, never specified.
 */
export const MODULES_WITHOUT_SPECS = ["CPR-021"];

/**
 * TWO UNRESOLVED CONTRADICTIONS IN THE VERSION 2 MATERIAL. Recorded here rather than quietly resolved,
 * because both are the kind that produce a wrong build rather than a wrong page, and neither is mine to
 * settle. Nothing on the public site depends on either -- the pages are written from the v2 NARRATIVE,
 * which is consistent -- but the `modules` fields above cite IDs, so the ambiguity has to be stated.
 *
 * 1. THE PEN ENGINE NUMBERING DISAGREES WITH ITSELF. CPR-ARCH-001 section 13.2 lists a fifteen-engine
 *    library whose IDs map to entirely different engines from the fifteen PEN-0xx specifications supplied
 *    alongside it. Not a partial overlap -- EVERY id differs:
 *
 *      PEN-001  arch: Practice Workflow & Encounter Routing   spec: Appointment & Scheduling
 *      PEN-005  arch: Clinical Encounter Lifecycle            spec: Practice Intelligence
 *      PEN-013  arch: Referral, Correspondence & Shared-Care  spec: AI Clinical Decision Support
 *      PEN-015  arch: Consent, Data Sharing & Provenance      spec: Integration & Interoperability
 *
 *    The architecture's list also contains a Consent, Data Sharing and Provenance Rules Engine that has no
 *    specification at all, while the specifications contain an Integration & Interoperability Engine the
 *    architecture treats as a platform service. IDs below follow the PEN SPECIFICATIONS, since those are
 *    the documents that actually exist.
 *
 * 2. THE CPR WORKSPACE LIST DISAGREES WITH ITS OWN DIAGRAM. CPR-ARCH-001 section 14 gives CPR-008 as
 *    Patient Timeline and CPR-009 as Diagnosis Tracker; the accompanying architecture diagram gives
 *    CPR-008 as Diagnosis Intelligence and CPR-007 as Patient Workspace & Timeline. The two lists diverge
 *    from CPR-004 onwards. IDs below follow the v1 titles the areas were originally derived from, which
 *    section 14 says will be revised rather than renumbered.
 */
export const SPEC_CONFLICTS = [
  "PEN engine numbering: CPR-ARCH-001 s13.2 vs the PEN-0xx specifications (all fifteen ids differ)",
  "CPR workspace numbering: CPR-ARCH-001 s14 vs the CPR-ARCH-001 diagram (diverge from CPR-004)",
];
