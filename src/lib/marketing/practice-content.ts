// Competen Practice -- public product section (/practice and its eight capability pages).
//
// GOVERNED BY CPR-ARCH-001 VERSION 2, and built on TWO specification layers now that both are stable:
// the fifteen PEN engines (capability) and the twenty CPR-V2 workspaces (surface). The CPR space was in
// flux and is not any more -- the V2 documents arrived, so this file cites both and the harness proves
// each list is covered exactly once. Also informed by CPR-V2-000A and CPR-ARCH-002 to 005.
//
// V2 IS A BIGGER PRODUCT THAN V1, not a re-drawing of it. Teleconsultation, mobile/offline working,
// assistant delegation and multi-practice switching were sub-features or absent in version 1 and are
// first-class workspaces now, which is why an eighth area exists ("Care anywhere") and a seventh was
// rewritten ("Your team & network"). Version 1's patient portal, pre-visit questionnaire engine and
// reception workspace have no V2 equivalent -- see V2_SPEC_GAPS.
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
// 2. The specifications distinguish Version 1 from later work -- CPR-V2-000's integration strategy names
//    identity, notifications and document storage now and defers EMR interoperability, payments and
//    telemedicine; CPR-V2-002 defers Google/Outlook calendar; CPR-V2-013 defers push and WhatsApp. So each
//    integration carries `inV1`, and the ones that are not are labelled on the page. A clinic that buys
//    because "it connects to our laboratory system" has been sold something the documents do not promise.
//
// WEB-STRAT-001's disclosure rule still applies here: this page may name Competen Practice and what it does
// for a practice, but it must never name the platform's other products. See the FORBIDDEN list in
// scripts/public-disclosure-harness.ts, which asserts it against the rendered HTML of every page below.

export const PRACTICE_ACCENT = "var(--cp-primary)";
/** For accent-coloured text sitting on a tint OF that accent, where the base shade measures 4.37:1. */
export const PRACTICE_ACCENT_DARK = "var(--cp-primary-deep)";

/** Shown beside every screen gallery. See honesty rule 1 above -- do not remove without also shipping. */
export const PREVIEW_NOTE = "Interface previews from the Competen Practice product design.";

// CPR-ARCH-001 v2's own architecture statement, which is a far better headline than v1's had: the product
// is the PRACTITIONER's record, not the clinic's, and it travels with them. Version 1 sold appointment
// management -- true, but so does everyone else.
export const PRACTICE_HERO = {
  eyebrow: "Competen Practice",
  // CPR-LP-001's headline, verbatim, split at the line breaks the specification writes it with.
  headline: ["Your Professional Practice.", "One Workspace.", "Every Patient.", "Every Hospital.", "Every Year of Your Career."],
  body:
    "Capture your clinical experience. Organise your patients. Build lifelong professional intelligence -- " +
    "across every hospital, clinic, outreach site and teleconsultation. It follows you, not your employer.",
  // CPR-LP-001's design principles put "clear distinction from EMR products" first among equals, and this
  // is the sentence that does it. Kept in the hero rather than a section further down, because a visitor
  // who reads three screens before learning it is not an EMR has been misled for three screens.
  notEmr: "Not an EMR. Your practice companion.",
  pillars: [
    { title: "Works everywhere", body: "Follow your practice anywhere" },
    { title: "Built for you", body: "Yours, not your hospital's" },
    { title: "Learns from your work", body: "Intelligence from your own record" },
    { title: "Secure and private", body: "Your data, your control" },
  ],
  image: "/images/practice/command-centre.webp",
  imageAlt: "The Competen Practice command centre showing today's appointments, the walk-in queue, active encounters, follow-ups due and practice intelligence",
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

// CPR-V2-000's core design principles and out-of-scope list. This band exists because "not an EMR" is the most
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

// CPR-V2-000's eight-step patient journey, verbatim in substance. It is the clearest thing in the whole
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

// CPR-V2-000 "Primary User Roles". Organisation Administrator is marked optional in the specification and is
// described that way here rather than being quietly promoted to a headline role.
export const PRACTICE_ROLES = [
  { role: "Healthcare professionals", body: "Your day, your diary, your patients -- on one screen.", icon: "\u{1FA7A}" },
  { role: "Patients", body: "Book, prepare, upload and follow their own care.", icon: "\u{1F464}" },
  { role: "Reception and practice assistants", body: "A front desk that can see everything it needs and nothing it should not.", icon: "\u{1F5C2}️" },
  { role: "Practice administrators", body: "Locations, hours, users, templates and policy -- without a developer.", icon: "⚙️" },
];

/**
 * CPR-V2-020 integration domains, split by what CPR-V2-000's integration strategy places in Version 1. Everything
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
 * CPR-V2-000A Enterprise Integration Architecture, reduced to the part a clinic buying this actually needs.
 *
 * MOST OF CPR-V2-000A IS NOT PUBLIC AND MUST NOT BECOME PUBLIC. It draws the platform operations control
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
  // CPR-V2-000A section 7 and CPR-V2-019 Rev 2's governance rules, stated plainly. It is the honest answer to
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
  /** PEN engine ids (capability layer). NEVER RENDERED -- traceability for the coverage harness only. */
  engines: string[];
  /** CPR-V2 workspace ids (surface layer). Also never rendered. The two lists cross-cut on purpose. */
  workspaces: string[];
  outcomes: { title: string; body: string }[];
  screens: PracticeScreen[];
};

// ACCENTS ARE MEASURED, NOT PICKED. Each is used BOTH as small text on white ("Explore →", 12.5px) and as
// a chip background under white text, so it must clear 4.5:1 in both directions. The obvious 600-weight
// teal, orange and cyan came in at 3.74, 3.56 and 3.68 -- fine on a mockup, unreadable to anyone with
// reduced contrast sensitivity. They are the 700 shades for that reason.
//
// TWO TRACEABILITY LAYERS, because the specifications have two. `engines` cites the fifteen PEN
// specifications (the capability layer); `workspaces` cites the twenty CPR-V2 specifications (the surface
// layer). They CROSS-CUT deliberately: teleconsultation and mobile/offline are delivery modes that consume
// engines owned by other areas, so "Care anywhere" cites workspaces and no engine of its own. Forcing it to
// own one would have meant taking an engine off the area that actually explains it.
//
// The harness proves both lists are covered exactly once, so a spec cannot be dropped in a copy edit --
// and CPR-V2-001 and CPR-V2-020 are claimed by the OVERVIEW page rather than an area, because the command centre
// and the navigation architecture are what the landing page itself is.
//
// AREA NAMES ARE OUTCOMES, never workspace names. WEB-STRAT-001 forbids marketing the internal
// decomposition: "The encounter", not "Rapid Registration, Patient Search and Clinical Encounter
// Workspaces". The specs decide what belongs together; the visitor never sees them.
export const PRACTICE_AREAS: PracticeArea[] = [
  // ── PEN-001 | CPR-V2-002 Schedule, CPR-V2-003 Booking ─────────────────────────────────────────────────────
  {
    slug: "scheduling",
    nav: "Your diary",
    eyebrow: "Your diary",
    headline: ["Your time, opened", "on your terms."],
    body:
      "One diary across every place you work. You decide what is available where, and patients book only " +
      "what you have genuinely opened -- booked, walk-in, remote or emergency, all on the same calendar.",
    accent: "var(--cp-primary)",
    icon: "\u{1F4C5}",
    blurb: "Availability across every location, booking patients do themselves, and a waiting list that refills cancellations.",
    engines: ["PEN-001"],
    workspaces: ["CPR-V2-002", "CPR-V2-003"],
    outcomes: [
      { title: "Every kind of appointment", body: "New consultation, scheduled follow-up, walk-in, emergency, hospital consultation, teleconsultation, home or outreach visit -- one engine, one calendar." },
      { title: "Sessions, not just slots", body: "Clinic sessions with their own capacity, location and walk-in allowance, repeated across the weeks you actually work." },
      { title: "Slots that genuinely exist", body: "Availability is generated from your real working pattern, with buffers, blocked time, leave and holidays already subtracted." },
      { title: "Walk-in capacity, planned", body: "Reserve part of each session for people who simply arrive, so the unscheduled day is a plan rather than an interruption." },
      { title: "Cancellations that refill", body: "A waiting list offers released time automatically instead of leaving an afternoon empty." },
      { title: "Straight into the consultation", body: "A booking becomes a clinical encounter automatically -- no second act of starting something." },
    ],
    screens: [
      { src: "/images/practice/schedule.webp", alt: "The schedule and availability workspace showing a week of clinic sessions across three locations, with utilisation, walk-in capacity and pending appointment requests", caption: "Sessions across every location, with walk-in capacity and utilisation in view." },
      { src: "/images/practice/booking.webp", alt: "The appointment and booking workspace showing booking type, patient search, date and time selection and a confirmation summary", caption: "One booking flow for appointments, follow-ups, walk-ins, referrals and teleconsultations." },
    ],
  },

  // ── PEN-002/003/006 | CPR-V2-004 Rapid Registration, CPR-V2-005 Patient Search, CPR-V2-006 Encounter ─────────
  {
    slug: "encounter",
    nav: "The encounter",
    eyebrow: "The encounter",
    headline: ["Capture in seconds.", "Complete when you can."],
    body:
      "The consultation is the centre of the product. Find or register the patient in under a minute, " +
      "record the minimum safely while they are in front of you, and finish the detail afterwards.",
    accent: "var(--cp-area-1)",
    icon: "\u{1FA7A}",
    blurb: "Sub-minute registration, patient search that finds anyone, and one encounter lifecycle for every visit type.",
    engines: ["PEN-002", "PEN-003", "PEN-006"],
    workspaces: ["CPR-V2-004", "CPR-V2-005", "CPR-V2-006"],
    outcomes: [
      { title: "Registered in under a minute", body: "New, returning, walk-in, referral or emergency -- each has its own fast path, and the record is enriched progressively rather than up front." },
      { title: "Duplicates caught at the door", body: "Instant search before you create anything, with probabilistic matching, an ID or QR scan, and a confidence score you can tune." },
      { title: "One patient, one identity", body: "A single longitudinal identity that survives across organisations, with hospital numbers and national IDs mapped to it rather than replacing it." },
      { title: "The story before you start", body: "Active diagnoses, current medications, allergies, recent encounters and what is outstanding, summarised before the patient sits down." },
      { title: "One lifecycle, every visit type", body: "Reason, history, examination, diagnosis, treatment, follow-up, close. Booked or walk-in, clinic or ward, in person or remote -- the shape is the same." },
      { title: "Type the least you can", body: "Smart defaults from the patient's own history, specialty templates, one-click repeat plans, and voice capture for the days typing is not an option." },
      { title: "Closing does the rest", body: "Completing an encounter updates the timeline, files the follow-up and contributes to your case memory. One action, not four." },
    ],
    screens: [
      { src: "/images/practice/registration.webp", alt: "The rapid patient registration workspace showing registration modes, instant patient search, identity verification, minimal details and a confirmation summary", caption: "Six registration modes, each tuned for how the patient actually arrived." },
      { src: "/images/practice/patient-search.webp", alt: "The patient search and clinical summary workspace showing search results, a patient snapshot, clinical summary cards and recent encounters", caption: "Find anyone by name, phone, national ID or scan -- and see their story immediately." },
      { src: "/images/practice/encounter.webp", alt: "The clinical encounter workspace showing reason for visit, history, examination, diagnoses, investigations, treatment and encounter progress", caption: "The consultation itself, with progress tracked and nothing required before care starts." },
    ],
  },

  // ── PEN-004/011/012 | CPR-V2-007 Diagnosis, 008 Investigations, 009 Treatment, 010 Follow-up ───────────
  {
    slug: "continuity",
    nav: "Continuity of care",
    eyebrow: "Continuity of care",
    headline: ["Nothing falls", "through the gaps."],
    body:
      "The longitudinal problem list, what you did about it, what came back, and who is due to return -- " +
      "one chronological record of everything you have done for this patient, everywhere.",
    accent: "var(--cp-area-2)",
    icon: "\u{1FA79}",
    blurb: "Problem lists, investigations, treatment and outcomes, and risk-based recall that escalates when a review slips.",
    engines: ["PEN-004", "PEN-011", "PEN-012"],
    workspaces: ["CPR-V2-007", "CPR-V2-008", "CPR-V2-009", "CPR-V2-010"],
    outcomes: [
      { title: "A problem list that stays true", body: "Active, provisional, chronic, resolved and past history -- coded, dated, and carrying the clinician responsible for each." },
      { title: "Results that come back to you", body: "Investigations tracked from request to result, with abnormal and critical flagged, trends plotted, and critical results requiring acknowledgement." },
      { title: "What the patient is actually on", body: "Medications, procedures, therapies and monitoring plans, each linked to the diagnosis it treats and carrying its own review date." },
      { title: "Checked before it is prescribed", body: "Interaction and allergy checking at the point of prescribing, with patient instructions generated alongside." },
      { title: "Follow-up by risk, not by rota", body: "Reminder cadence follows the patient's risk. Overdue reviews are detected, prioritised and escalated on rules you set." },
      { title: "Outcomes, not just activity", body: "Improved, stable, worsened or unknown recorded against the condition -- so “did it work” is a question with an answer." },
      { title: "The whole journey, in order", body: "Appointments, encounters, diagnoses, treatments, documents and results on one filterable timeline, grouped into episodes and immutable once signed." },
    ],
    screens: [
      { src: "/images/practice/diagnosis.webp", alt: "The diagnosis and problem management workspace showing the active problem list with ICD-10 codes, differential diagnoses, a problem timeline and status summary", caption: "The longitudinal problem list, with differentials tracked separately until confirmed." },
      { src: "/images/practice/investigations.webp", alt: "The investigation and results workspace showing a results inbox with abnormal and critical flags, pending requests, result trends and an interpretation panel", caption: "Results from request to acknowledgement, with the critical ones impossible to miss." },
      { src: "/images/practice/treatment.webp", alt: "The treatment, procedures and prescription workspace showing an active treatment plan, medication summary, procedure log, prescription builder and interaction alerts", caption: "Prescribing with interaction and allergy checks, and outcomes recorded against the plan." },
      { src: "/images/practice/followups.webp", alt: "The follow-up and continuity workspace showing upcoming reviews, overdue patients, outcome tracking by condition and recall campaigns", caption: "Who is due, who is overdue, and what happened to the ones you have already seen." },
    ],
  },

  // ── PEN-005/008/013 | CPR-V2-011 Intelligence, CPR-V2-013 AI Copilot ─────────────────────────────────────
  {
    slug: "case-memory",
    nav: "Your case memory",
    eyebrow: "Your case memory",
    headline: ["Everything you have seen,", "when you need it again."],
    body:
      "Every encounter you record becomes searchable case experience. Not a dashboard about your practice " +
      "-- a memory of it, that answers questions.",
    accent: "var(--cp-area-3)",
    icon: "✨",
    blurb: "Similar-case retrieval, what your treatments actually achieved, and decision support that shows its working.",
    engines: ["PEN-005", "PEN-008", "PEN-013"],
    workspaces: ["CPR-V2-011", "CPR-V2-013"],
    // CPR-ARCH-001 section 9.2 lists the questions the intelligence layer must answer. They are written
    // almost as asked, because a clinician recognises their own question faster than a feature name -- and
    // a claim in the form of a question is one you can be held to.
    outcomes: [
      { title: "“Have I seen this before?”", body: "Similar-case retrieval across your own practice: patients with comparable characteristics, what was done, and what happened next." },
      { title: "“What actually worked?”", body: "Treatment effectiveness carrying the responses and outcomes you recorded -- results in your hands, not in a journal." },
      { title: "“What is changing?”", body: "Which diagnoses and procedures are rising in your practice, by facility, specialty, location and period." },
      { title: "“How do I compare?”", body: "Benchmarks against similar practitioners on follow-up completion, visits per patient and missed appointments -- opt-in and de-identified." },
      { title: "Ask it in plain English", body: "Natural-language search across patients, encounters, diagnoses, treatments, documents and follow-ups, with results in under two seconds." },
      { title: "Decision support that shows its working", body: "Differentials with likelihoods, guideline matches, risk and early-warning scores and medication safety checks -- each with its evidence and a confidence band." },
      { title: "Always the clinician's call", body: "Suggestions are ranked and explained, never applied. Every interaction is logged, and the copilot says plainly that it can be wrong." },
    ],
    screens: [
      { src: "/images/practice/intelligence.webp", alt: "The practice intelligence workspace showing patient population overview, diagnosis trends, treatment outcomes, follow-up performance and benchmarking against peers", caption: "Your own practice, measured -- population, diagnoses, outcomes and how you compare." },
      { src: "/images/practice/ai-copilot.webp", alt: "The AI clinical copilot workspace showing a chat assistant, clinical reasoning panel with differential likelihoods, suggested next actions and linked evidence", caption: "Differentials, evidence and suggested actions -- with its limits on the same screen." },
    ],
  },

  // ── PEN-009/014 | CPR-V2-012 Reports & Professional Portfolio ─────────────────────────────────────────
  {
    slug: "evidence",
    nav: "Evidence & reporting",
    eyebrow: "Evidence & reporting",
    headline: ["Proof of what", "you actually did."],
    body:
      "The reports a working clinician genuinely needs: what each hospital owes you for, what you have " +
      "treated and achieved, and the evidence behind an appraisal, a portfolio or a paper.",
    accent: "var(--cp-area-4)",
    icon: "\u{1F4CA}",
    blurb: "Hospital payment lists, case logs, professional portfolio evidence and governed research datasets.",
    engines: ["PEN-009", "PEN-014"],
    workspaces: ["CPR-V2-012"],
    outcomes: [
      { title: "The hospital payment list", body: "Who you saw at which facility this period, formatted for that facility and exposing no other's patients. Reconciliation stops being an evening's work." },
      { title: "Your case log", body: "Every case by specialty and condition, building the record of clinical experience you are asked for and never have to hand." },
      { title: "Your professional portfolio", body: "Career summary, certifications, CPD hours, achievements, publications and presentations -- drawn from work you had to record anyway." },
      { title: "Build a report without asking anyone", body: "Choose the data, the filters and the fields, preview it, then save it as a template and schedule it." },
      { title: "Export in the format asked for", body: "PDF, Excel and CSV, delivered on a schedule or over an API, with every export written to an audit history." },
      { title: "Research without exposure", body: "De-identified datasets with consent governance and retained provenance -- publication support, not a spreadsheet of patients." },
    ],
    screens: [
      { src: "/images/practice/reports.webp", alt: "The reports, exports and professional portfolio workspace showing a report builder, saved templates, professional portfolio sections, case log snapshot and export centre", caption: "Payment lists, case logs and portfolio evidence from one report builder." },
    ],
  },

  // ── CPR-V2-018 Teleconsultation, CPR-V2-019 Mobile & Offline ────────────────────────────────────────────
  // NEW IN V2, and the area with no engine of its own. Both workspaces consume engines that other areas
  // explain -- they are delivery MODES, not a capability layer. For a product sold where connectivity is
  // expensive and often absent, this is also the most load-bearing thing on the page.
  {
    slug: "anywhere",
    nav: "Care anywhere",
    eyebrow: "Care anywhere",
    headline: ["Practise beyond", "the clinic walls."],
    body:
      "See patients by video when they cannot travel, and keep working when the connection cannot. Both " +
      "produce the same record as a consultation in your own room.",
    accent: "var(--cp-area-5)",
    icon: "\u{1F30D}",
    blurb: "Secure video consultations, and a genuinely offline mode for outreach, home visits and bad connections.",
    engines: [],
    workspaces: ["CPR-V2-018", "CPR-V2-019"],
    outcomes: [
      { title: "A consultation, not a video call", body: "The virtual room carries the patient's timeline, shared documents and your notes, and closes into the same encounter record as an in-person visit." },
      { title: "Consent recorded before it starts", body: "Sessions are encrypted end to end, consent is captured where required, and recording is off unless you turn it on and say so." },
      { title: "Bring in whoever is needed", body: "Invite a colleague mid-consultation or run a virtual multidisciplinary meeting, without leaving the patient's record." },
      { title: "Work with no connection at all", body: "Search cached patients, register a walk-in, capture the encounter, attach photos and queue prescriptions -- entirely offline." },
      { title: "Built for the outreach round", body: "Household visit forms, community screening and immunisation capture, designed for a clinic held under a tree rather than in a building." },
      { title: "Sync you can see", body: "A sync centre showing exactly what is queued, what succeeded and what failed, with conflicts surfaced for you to resolve rather than silently overwritten." },
      { title: "Safe on the device", body: "Offline records are encrypted locally, retention follows policy, and every synchronisation is auditable." },
    ],
    screens: [
      { src: "/images/practice/teleconsultation.webp", alt: "The teleconsultation workspace showing a live encrypted video consultation, consultation lobby, patient timeline, shared documents and structured consultation notes", caption: "The patient's whole record alongside the call, and notes that close into the same encounter." },
      { src: "/images/practice/mobile-offline.webp", alt: "The mobile and offline workspace showing device status, offline patient cache, encounter queue, synchronisation centre and conflict resolution", caption: "Offline by design -- with a sync centre that shows you exactly what has and has not arrived." },
    ],
  },

  // ── PEN-007/010 | CPR-V2-016 Delegation, CPR-V2-017 Collaboration ───────────────────────────────────────
  {
    slug: "team",
    nav: "Your team & network",
    eyebrow: "Your team & network",
    headline: ["Delegate the admin.", "Keep the responsibility."],
    body:
      "It works for one clinician alone -- and when you do have help, an assistant can carry the " +
      "administration without ever touching a clinical decision. Plus secure ways to reach colleagues.",
    accent: "var(--cp-area-6)",
    icon: "\u{1F91D}",
    blurb: "Delegation with approval and audit, secure clinician messaging, referrals, handovers and multidisciplinary discussion.",
    engines: ["PEN-007", "PEN-010"],
    workspaces: ["CPR-V2-016", "CPR-V2-017"],
    outcomes: [
      { title: "Delegate what is genuinely admin", body: "Appointments, registration, follow-up scheduling, reports, documents and communication -- you choose which categories, and the boundary is enforced rather than trusted." },
      { title: "Nothing clinical without you", body: "An assistant cannot create or alter a clinical decision unless explicitly authorised, and sensitive work waits in an approval inbox for your review." },
      { title: "Attributed to both of you", body: "Every delegated action records who did it and who supervised it, so accountability survives the convenience." },
      { title: "Recallable", body: "Reassign or take back a delegated task at any point, and see your assistant's workload before you add to it." },
      { title: "Referrals you can track", body: "Draft, sent, acknowledged, accepted, completed or declined -- you know where a referral stands without telephoning the specialist's receptionist." },
      { title: "Discuss a case properly", body: "Multidisciplinary discussions with the right colleagues invited, documents attached, and the outcome landing back on the patient's timeline." },
      { title: "Handovers that are written down", body: "Shift and cover handovers recorded and shared, rather than remembered in a corridor." },
    ],
    screens: [
      { src: "/images/practice/delegation.webp", alt: "The personal assistant and delegation workspace showing an assistant overview, delegated task queue, approval inbox, delegation controls and audit trail", caption: "What you delegate, what waits for your approval, and a full record of both." },
      { src: "/images/practice/collaboration.webp", alt: "The practitioner collaboration workspace showing an inbox, recent conversations, referral centre, active multidisciplinary discussions and shared documents", caption: "Messaging, referrals, multidisciplinary discussion and handover in one place." },
    ],
  },

  // ── PEN-015 | CPR-V2-014 Settings, CPR-V2-015 Multi-Practice ────────────────────────────────────────────
  {
    slug: "setup",
    nav: "Setup & connections",
    eyebrow: "Setup & connections",
    headline: ["You run the practice.", "We run the platform."],
    body:
      "Locations, hours, appointment types, users and templates are yours to change from a settings screen " +
      "rather than a support ticket -- across every organisation you work in. Security and licensing are ours.",
    accent: "var(--cp-area-7)",
    icon: "\u{1F517}",
    blurb: "Configuration without a developer, one identity across every organisation, and standards-based links to the systems you run.",
    engines: ["PEN-015"],
    workspaces: ["CPR-V2-014", "CPR-V2-015"],
    outcomes: [
      { title: "What you control", body: "Practice profile and branding, locations, working hours, appointment types and durations, booking rules, templates, document categories and assistant preferences." },
      { title: "What you never have to", body: "Tenant identity, subscription and licence, entitlements, regional deployment, security and password policy, backup and retention. Visible to you, not yours to maintain." },
      { title: "One professional, many places", body: "Switch between the organisations you hold a role in without signing in again -- each with its own role, calendar and data boundary." },
      { title: "The active boundary is explicit", body: "The organisation you are working in is always shown, because the cost of forgetting is writing into the wrong hospital's record." },
      { title: "Every change versioned", body: "Configuration carries version history and an audit record of who changed what and when. Critical changes ask for confirmation first." },
      { title: "Standards-based exchange", body: "HL7 v2, FHIR R4, REST APIs, webhooks and DICOM for imaging -- built to connect to an EMR, laboratory, radiology or pharmacy system rather than replace it." },
      { title: "Connections you can watch", body: "Health status per connection, retry and dead-letter queues for failures, and an audit record of every exchange with an outside system." },
    ],
    screens: [
      { src: "/images/practice/settings.webp", alt: "The settings and practice administration workspace showing profile management, practice locations, appointment preferences, clinical templates, users, security centre and integration manager", caption: "Profile, locations, templates, users, security and integrations -- all editable by you." },
      { src: "/images/practice/multi-practice.webp", alt: "The multi-practice workspace switching screen showing current practice context, available organisations, a role selector and cross-site activity", caption: "Four organisations, six roles, one professional record -- and no data crossing between them." },
    ],
  },
];

export const areaBySlug = (slug: string) => PRACTICE_AREAS.find(a => a.slug === slug);

/**
 * Modules named in an architecture document that have no specification of their own and are therefore NOT
 * represented above. Recorded rather than silently dropped, so the gap stays visible.
 *
 *   CPR-V2-021  Patient Engagement Platform -- named in CPR-V2-000's Version 1 module list, never specified.
 */
export const MODULES_WITHOUT_SPECS: string[] = [];

/**
 * CPR-V2-001 Command Centre and CPR-V2-020 Home & Navigation are claimed by the OVERVIEW page, not by a
 * capability area -- because "your whole practice at a glance" and "how you move between workspaces" are
 * what /practice itself is, not one section of it. Counted with the areas for coverage.
 */
export const OVERVIEW_WORKSPACES = ["CPR-V2-001", "CPR-V2-020"];

/**
 * How many capability areas there are, spelled out for prose that has to say the number.
 *
 * DERIVED, because the hand-typed version went stale the moment V2 took the areas from six to eight: the
 * overview read "Six areas, one product" directly above a grid rendering all eight. Nobody rereads the
 * sentence above a list they just regenerated, and no typecheck can see a number inside a string.
 */
const COUNT_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
  "eleven", "twelve"];
export const AREA_COUNT_WORD = COUNT_WORDS[PRACTICE_AREAS.length] ?? String(PRACTICE_AREAS.length);
export const OVERVIEW_SCREEN = {
  src: "/images/practice/home-navigation.webp",
  alt: "The practice home showing the workspace launcher, today's schedule, recent patients, tasks and alerts, and AI copilot suggestions",
  caption: "One home, with every workspace one click away.",
};

/**
 * VERSION 2 HAS NO PATIENT-FACING WORKSPACE, and that is a change rather than an omission on this page.
 *
 * Version 1 specified a Patient Self-Service Portal (CPR-V2-006 v1) and a Patient Portal (CPR-V2-014 v1). The
 * twenty V2 workspaces are all practitioner surfaces -- the portal is in neither list. CPR-ARCH-001 v2 still
 * names the Patient as a primary user who books, maintains their details and views what is shared, so the
 * intent survives at architecture level with no workspace specification behind it.
 *
 * This matters publicly because /practice/book and /practice/patient-login describe a patient journey
 * drawn from the LP-* specifications, which are not superseded. Those pages already state plainly that the
 * journeys are not open. Recorded here so the discrepancy is visible rather than discovered later.
 */
export const V2_SPEC_GAPS = [
  "No V2 workspace specification covers the patient portal or patient self-service (v1 had two).",
];

/**
 * BOTH RECORDED CONTRADICTIONS ARE NOW RESOLVED by the CPR-V2 workspace specifications.
 *
 * 1. PEN ENGINE NUMBERING. CPR-ARCH-001 section 13.2 listed a fifteen-engine library whose ids mapped to
 *    entirely different engines from the PEN-0xx specifications -- every single id differed. Every one of
 *    the twenty V2 workspace documents cites the engines by the PEN SPECIFICATIONS' numbering
 *    (PEN-001 Appointment & Scheduling, PEN-005 Practice Intelligence, PEN-013 AI Clinical Decision
 *    Support, PEN-015 Integration & Interoperability). Section 13.2 is the outlier and is superseded.
 *
 * 2. CPR WORKSPACE NUMBERING. Section 14 and the CPR-ARCH-001 diagram diverged from CPR-V2-004 onwards. The
 *    V2 documents settle it by existing: CPR-V2-001..020 are now defined surfaces, and they match neither
 *    earlier list exactly. They are the authority.
 *
 * Kept as a record rather than deleted, because "we chose the PEN numbering" is a decision somebody will
 * otherwise re-litigate the next time they open CPR-ARCH-001 and find section 13.2 disagreeing with the
 * code. The resolution is the interesting part; the conflict is why it needed one.
 */
export const RESOLVED_SPEC_CONFLICTS = [
  "PEN numbering: CPR-ARCH-001 s13.2 vs the PEN specs -- RESOLVED, the V2 workspaces all use the PEN specs.",
  "CPR numbering: CPR-ARCH-001 s14 vs its own diagram -- RESOLVED, the V2 workspace documents supersede both.",
];

// ══════════════════════════════════════════════════════════════════════════════════════════════════════
// CPR-LP-001 v1 — homepage sections the earlier LP-PRA-001 page did not have.
//
// WHAT THE COMP ASKED FOR AND THIS DOES NOT PUBLISH, decided with the user rather than assumed:
//   - PRICING. The comp shows four tiers at $5/$10/$20/custom and "Free 14-day trial". The product seeds
//     TWO plans (practice_trial, practice_standard) and its trial is THIRTY days, not fourteen. Publishing
//     four tiers would put a plan structure on a public page that signup cannot assign, and publishing a
//     14-day trial would contradict what provisioning actually grants. Omitted until priced; the nav's
//     Pricing link goes with it, because a menu item to a section that is not there is worse than neither.
//   - "WATCH 2-MINUTE TOUR". There is no video. A play button that plays nothing reads as broken.
//   - THE COMP'S ILLUSTRATED DAY names a real hospital (CURE Uganda) and shows "147 similar patients".
//     Naming a real institution on a marketing page implies a relationship that does not exist, and a
//     specific count invents a statistic. The workflow below describes the capability instead: the shape
//     of the day is the point, and it survives being honest about it.
// ══════════════════════════════════════════════════════════════════════════════════════════════════════

/** CPR-LP-001 "Why Competen Practice" — problem first, then what the product does about it. */
export const WHY_PRACTICE = {
  title: "Why Competen Practice?",
  cards: [
    { problem: "You work in multiple hospitals.", answer: "It keeps one professional record across all of them." },
    { problem: "Your experience disappears after every shift.", answer: "It builds a lifelong record of the clinical work you have actually done." },
    { problem: "You rely on memory.", answer: "It remembers every patient you have managed, and lets you search them." },
    { problem: "You want to improve.", answer: "It shows you patterns in your own practice, not somebody else's benchmark." },
  ],
};

/**
 * CPR-LP-001 "Built Around Your Day". Four moments, in the order they happen.
 *
 * Deliberately generic: no named hospital, no invented patient, no fabricated count. What makes this
 * section work is the SHAPE of a clinical day, and that is not improved by pretending to be a screenshot.
 */
export const YOUR_DAY = {
  title: "Built around your day",
  body: "The same four moments, wherever you are working today.",
  steps: [
    { label: "Start", title: "Choose where you are working", body: "Pick today's location and session. Your diary, your queue and your defaults follow." },
    { label: "See", title: "Open the patient", body: "Booked, walk-in or follow-up, the encounter opens the same way and takes seconds to start." },
    { label: "Record", title: "Close the encounter", body: "Diagnosis, treatment, what happens next. Sign it and it is final." },
    { label: "Learn", title: "Ask your own record", body: "How many patients like this one have you managed, and what happened to them." },
  ],
};

/**
 * CPR-LP-001 "Designed for Every Healthcare Professional".
 *
 * THE LIST FOLLOWS THE PHOTOGRAPHS, not the other way round. The supplied contact sheet pictures a
 * surgeon and a laboratory scientist and pictures no dentist or occupational therapist, so those are the
 * professions named -- a caption that disagrees with the photograph above it is a small lie that a
 * visitor spots immediately, and captions on real-looking people are the wrong place to be aspirational.
 *
 * These are AUDIENCES, not implemented role types. The application knows nurse, hospital_admin and
 * super_admin; Practice memberships know practice_owner and practitioner. Naming ten professions says who
 * the product is FOR, which is a claim about fit, not a promise of ten bespoke workspaces -- so no line
 * here says otherwise.
 *
 * The portraits are STOCK, and the page says so beneath them. They are not customers, and a healthcare
 * page that lets generated faces imply a client list has crossed from illustration into testimony.
 */
export const AUDIENCE_PHOTO_NOTE = "Photography is illustrative. These are stock images, not Competen Practice users.";

export const PRACTICE_AUDIENCES = [
  { slug: "doctor", label: "Doctors", alt: "A doctor in a white coat and stethoscope on a hospital ward" },
  { slug: "nurse", label: "Nurses", alt: "A nurse in scrubs with an identity badge in a hospital corridor" },
  { slug: "clinical-officer", label: "Clinical officers", alt: "A clinical officer in scrubs with a stethoscope beside monitoring equipment" },
  { slug: "midwife", label: "Midwives", alt: "A midwife holding a newborn on a maternity ward" },
  { slug: "surgeon", label: "Surgeons", alt: "A surgeon in theatre scrubs and surgical loupes under operating lights" },
  { slug: "pharmacist", label: "Pharmacists", alt: "A pharmacist with a tablet in front of dispensary shelves" },
  { slug: "laboratory-scientist", label: "Laboratory scientists", alt: "A laboratory scientist at a microscope wearing gloves and a lab coat" },
  { slug: "nutritionist", label: "Nutritionists", alt: "A nutritionist at a desk of fresh fruit and vegetables" },
  { slug: "physiotherapist", label: "Physiotherapists", alt: "A physiotherapist treating a patient's knee in a rehabilitation gym" },
  { slug: "psychologist", label: "Psychologists and counsellors", alt: "A psychologist taking notes in a consulting room" },
];

/** CPR-LP-001 "Professional Journey" — the timeline the portability promise is really about. */
export const CAREER_JOURNEY = {
  title: "Your practice never stops",
  body: "One record that follows you through every step of a career, not one that ends when a contract does.",
  stages: ["Training", "Internship", "First hospital", "Second hospital", "Private clinic", "Outreach", "Consultancy", "Retirement"],
  closing: "One record. A lifetime of clinical work you can still account for.",
};

/**
 * CPR-LP-001 "Built for Africa".
 *
 * Every line is a design constraint this product was built under, not a market claim. "Works offline" is
 * stated as intent rather than fact and labelled by phase, because CPR-V2-019 mobile/offline is Phase 9 and
 * has not been built -- saying it works today would be the single most damaging false claim on the page
 * for a clinician in a low-connectivity setting.
 */
export const BUILT_FOR_AFRICA = {
  title: "Built for how care is actually delivered here",
  points: [
    { title: "Works in hospitals", body: "You can practise inside a facility without the facility owning your record." },
    { title: "Works in private practice", body: "A solo clinician runs the whole thing without a receptionist." },
    { title: "Works on a phone", body: "The screens are built for the device most clinicians actually carry." },
    { title: "Built for low-resource settings", body: "Speed before completeness: record the minimum safely, finish the detail later." },
    { title: "Offline working", body: "Specified in CPR-V2-019 and not yet built. It arrives with the mobile phase; it does not work today.", pending: true },
  ],
};

// ══════════════════════════════════════════════════════════════════════════════════════════════════════
// CPR-V2-001 v3 — the redesigned homepage. INDIGO identity, illustration instead of photography, and a
// SHORT page: the specification's twelve sections, minus the ones that cannot be filled truthfully.
//
// WHAT IS NOT HERE, AND WHY. Six of the twelve could not ship as the comp draws them. Four were the
// user's call; two were not, and are recorded here because a future edit working from the comp alone
// would reinstate them without knowing.
//
//   TRUSTED ORGANISATIONS -- REFUSED. The comp names six real, identifiable hospitals (Chris Hani
//     Baragwanath, Kenyatta National, University College Hospital Ibadan, Muhimbili National, Groote
//     Schuur, Aga Khan University) under "trusted by healthcare professionals across Africa". None is a
//     customer. That is a false statement about named third parties, not a design choice, and no framing
//     makes it shippable. It returns when there are real customers who have agreed to be named.
//   TESTIMONIALS -- REFUSED, same class. Three invented clinicians with photographs, countries and
//     five-star ratings. Quotes ship when a real person said them and consented.
//   MOBILE + APP STORE BADGES -- omitted (user). There is no app; CPR-V2-019 is Phase 9. Store badges
//     would be a dead link and a false availability claim at once.
//   PRICING -- omitted (user), for the second time. The comp now says $0/$7.99/$14.99; the previous comp
//     said $5/$10/$20. Two different answers is itself the evidence that neither is decided.
//
// AND WHAT IS HERE BUT LABELLED: the AI assistant section renders marked as in development (user's
// call), because no such module exists -- the built Practice modules are Home, Calendar, Patients and
// Encounters. The announcement bar does NOT say it is "now live".
//
// THE FREE TRIAL IS REAL AND IS THIRTY DAYS. Provisioning grants a practice_trial entitlement with
// ends_at set from practice_plans.trial_days = 30, and nothing anywhere collects a card. So "start a
// 30-day free trial, no card required" is a claim this product actually honours -- unlike the comp's
// fourteen days, which matches nothing in the system.
// ══════════════════════════════════════════════════════════════════════════════════════════════════════

/** CPR-V2-001 v3 s2. Indigo identity, replacing the blue Practice accent on this page. */
export const PRACTICE_INDIGO = "var(--cp-primary)";
export const PRACTICE_INDIGO_DEEP = "var(--cp-primary-deep)";
export const PRACTICE_CYAN = "var(--cp-accent)";
export const PRACTICE_CANVAS = "var(--cp-canvas)";

export const LP3_HERO = {
  eyebrow: "For healthcare professionals",
  headline: ["Build Your Clinical", "Practice Intelligence."],
  body: "One secure workspace that follows you throughout your professional career.",
  points: [
    "Keep one clinical record across every hospital you work in",
    "Open an encounter in seconds, booked or walk-in",
    "Sign it and it is final, with the history kept",
    "Search what you have managed before",
  ],
  cta: { label: "Start free trial", href: "/practice/sign-up" },
  secondary: { label: "See the screens", href: "#workspace" },
  // Thirty days, because that is what practice_plans.trial_days actually says.
  trialNote: "30-day free trial. No card required.",
  image: "/images/practice/hero-illustration.webp",
  imageAlt: "Illustration of a clinician working at a laptop in a consulting room",
};

/** CPR-V2-001 v3 s4 "Core benefits (6 cards)". Every card is something a built module already does. */
export const LP3_BENEFITS = [
  { title: "One record, every hospital", body: "Your clinical work in one place, whether you saw the patient in a ward, a clinic or on an outreach round." },
  { title: "Encounters in seconds", body: "Booked, walk-in or follow-up, the encounter opens the same way and takes seconds to start." },
  { title: "Signed means final", body: "Signing locks the record. Only a governed amendment can change it, and the database enforces that, not just the app." },
  { title: "Patients you can find again", body: "Search by name, phone or identifier, with duplicates caught before they are created." },
  { title: "A diary that is yours", body: "Your locations, sessions and booking rules, across every facility you practise in." },
  { title: "It follows you, not your employer", body: "Change jobs and the record goes with you. That is the whole point of it being personal." },
];

/** CPR-V2-001 v3 s4 "AI Assistant section" -- rendered, and marked as not built. */
export const LP3_AI = {
  eyebrow: "In development",
  title: "A practice assistant that learns from your own record",
  body:
    "Specified, not yet built. It is named here because it is where the product is going, and marked so " +
    "nobody plans around it: the modules you can use today are your home, your diary, your patients and " +
    "your encounters.",
  points: [
    { title: "Insights from your own work", body: "Patterns in what you have managed, not somebody else's benchmark." },
    { title: "Document assistance", body: "Summarise and extract from what is already in your record." },
    { title: "Clinical questions", body: "Answers grounded in approved sources, with the source shown." },
  ],
};

export const LP3_WORKSPACE = {
  eyebrow: "Your practice, visualised",
  title: "A workspace that understands your day",
  body: "Today's clinic, who is waiting, what is unsigned and what is due back. The command centre is the first screen after you sign in.",
  points: ["Today's appointments and the walk-in queue", "Encounters open and awaiting signature", "The patients you registered", "Your workspace status and plan"],
};

export const LP3_CTA = {
  title: "Ready to build your clinical practice intelligence?",
  body: "Create your practice and open your diary. Setup takes one sitting.",
};
