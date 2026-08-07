// Competen Practice public site -- LP-PRA-001, LP-DOC-001, LP-PAT-001, LP-BOOK-001, LP-NEW-001.
//
// LP-PRA-001 makes /practice a PRODUCT SITE rather than a section of the corporate site: its own header,
// its own navigation, and four distinct journeys (start a practice, practice sign-in, book an appointment,
// patient sign-in) instead of one "Book a Demo" button. That is the substantive change, and it is also the
// fix for a mismatch flagged earlier -- every CTA used to land on /signup, which creates a generic Competen
// account with the nurse role and no practice anywhere in sight.
//
// ─────────────────────────────────────────────────────────────────────────────────────────────────────
// THE JOURNEYS ARE NOT OPEN, AND THE PAGES SAY SO.
//
// LP-DOC-001 routes a doctor to a Practice Dashboard, a receptionist to a Reception Workspace, a practice
// administrator to Practice Administration and an enterprise administrator to an Enterprise Overview.
// NONE OF THOSE FOUR EXIST. The application's roles are nurse, hospital_admin and super_admin; there is no
// doctor, receptionist, practice administrator, enterprise administrator or patient, no practice tenant,
// no My Care workspace and no clinician directory.
//
// A sign-in form that authenticates nobody into nothing is worse than no form: the visitor concludes the
// product is broken rather than unreleased, and that is a worse first impression than honesty. So each
// journey page presents the specified flow, states AVAILABILITY plainly, and offers the one action that
// genuinely works today -- getting in touch. The forms render disabled with the reason on them, which is
// the pattern already used for the absent OAuth providers on /login.
//
// NOTHING IS FABRICATED. The design comps show a clinician directory populated with named doctors,
// qualifications, star ratings and review counts; a "Trusted by clinicians and clinics worldwide" band; a
// HIPAA compliance badge; "join hundreds of practices"; a free 14-day trial; and a support telephone
// number. Every one of those is a claim about the world that is either unverified or, in the case of the
// practice count, currently false -- and HIPAA is United States law, which is a strange thing to assert
// for a product built for East Africa. None of them appear below. What replaces them is the trust material
// that IS true: the tenant isolation and audit guarantees from CPR-V2-000A.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────

import { PRACTICE_ACCENT } from "./practice-content";

export const PRACTICE_SITE_ACCENT = PRACTICE_ACCENT;

/** One enquiry address for the whole section, with the subject pre-filled per journey. It is the only
 *  action on these pages that actually does something, so it is the only one rendered as a live control. */
export const contactFor = (subject = "Competen Practice enquiry") =>
  `mailto:gabriel@semacast.com?subject=${encodeURIComponent(subject)}`;

/**
 * Rendered on every journey page. Held here rather than typed into four pages so it cannot say four
 * slightly different things, and so that opening the journeys is a one-line edit rather than a hunt.
 */
export const AVAILABILITY = {
  label: "Not open yet",
  headline: "Competen Practice is not open for sign-in yet.",
  body:
    "The product is in development. Practices are being set up with us directly rather than through this " +
    "page, so nothing here will sign you in or book you an appointment today.",
  action: { label: "Talk to us about your practice", href: contactFor() },
};

/**
 * WHAT REPLACES THE NOTICE WHEN A JOURNEY ACTUALLY OPENS (CPR-IAM-001 s14, last line: "replace the
 * 'Not open yet' panel with live sign-in and signup actions"; s14.1's launch ladder is the control).
 *
 * The journey page stays -- it is the explainer, and a visitor still needs to know where each role lands.
 * What changes is the panel above the fold: the honest notice becomes the honest action, decided by a
 * platform flag read at request time. Wiring it here rather than editing these pages at cutover is the
 * whole point of having a ladder: flipping the flag has to be sufficient, or the flag is decoration and
 * three buttons keep pointing at dead ends after launch.
 *
 * ONLY TWO JOURNEYS HAVE A GATE. `book` and `patient-login` are deliberately absent: there is no patient
 * portal, no V2 workspace specification for one, and the patient phase is gated until the practitioner
 * core is real. A flag for them would be a switch wired to nothing -- which is worse than no switch,
 * because someone would eventually flip it.
 */
export type JourneyGate = {
  /** practice_platform_flags row that opens this journey. */
  flag: string;
  label: string;
  headline: string;
  body: string;
  action: { label: string; href: string };
};

export const JOURNEY_GATES: Record<string, JourneyGate> = {
  "practice-login": {
    flag: "practice_sign_in",
    label: "Open",
    headline: "Sign in to your practice.",
    body:
      "Sign in with your Competen account -- the same one you use anywhere else on Competen. Where you " +
      "land depends on the role you hold in the practice, not on which link you clicked.",
    action: { label: "Sign in", href: "/practice/sign-in" },
  },
  start: {
    flag: "practice_public_signup",
    label: "Open",
    headline: "Set up your practice.",
    body:
      "Create your Competen Practice workspace now. You will be asked how and where you practise, and " +
      "then your diary is open.",
    action: { label: "Create your practice", href: "/practice/sign-up" },
  },
};

// ── Navigation ────────────────────────────────────────────────────────────────────────────────────────
// Taken from LP-PRA-001's own navigation list, NOT from the comp. The comp adds Pricing and Resources;
// there is no published pricing and there are no resources, so both would be links to nothing.

export type PracticeJourney = {
  key: string;
  label: string;
  href: string;
  kind: "primary" | "secondary";
  /** Who this journey is for -- used on the landing page's journey cards. */
  who: string;
  blurb: string;
  icon: string;
};

export const JOURNEYS: PracticeJourney[] = [
  { key: "start", label: "Start Your Practice", href: "/practice/start", kind: "primary",
    who: "Clinicians and clinic owners", icon: "\u{1F3E5}",
    blurb: "Set up your practice, invite your team and open your diary to online booking." },
  { key: "practice-login", label: "Practice Login", href: "/practice/login", kind: "secondary",
    who: "Doctors, reception and practice administrators", icon: "\u{1F510}",
    blurb: "Sign in to your practice workspace -- your day, your patients, your diary." },
  { key: "book", label: "Book an Appointment", href: "/practice/book", kind: "primary",
    who: "Patients, new and returning", icon: "\u{1F4C5}",
    blurb: "Find a clinician, choose a time that suits you, and book without ringing the clinic." },
  { key: "patient-login", label: "Patient Login", href: "/practice/patient-login", kind: "secondary",
    who: "Existing patients", icon: "\u{1F464}",
    blurb: "Your appointments, forms, documents and messages, in one place." },
];

export const journeyByKey = (k: string) => JOURNEYS.find(j => j.key === k)!;

/** Section links in the Practice header. Separate from JOURNEYS, which are the CTAs. */
/**
 * CPR-LP-001 asks for: Logo, Features, How it Works, Pricing, Support, Sign In.
 *
 * PRICING IS ABSENT DELIBERATELY. The specification names the item but sets no prices, and the only
 * numbers in existence are a comp's four tiers that the product cannot honour -- two plans are seeded and
 * the trial is thirty days, not fourteen. A menu item pointing at a section that is not there is worse
 * than neither, so both went together and both come back together when there is a price to publish.
 *
 * SUPPORT IS A REAL ADDRESS, not a help centre that does not exist. It is the one support channel that
 * actually answers today.
 */
export const PRACTICE_NAV = [
  { label: "Features", href: "/practice#capabilities" },
  { label: "How it works", href: "/practice#how-it-works" },
  { label: "For patients", href: "/practice/book" },
  { label: "Questions", href: "/practice#faqs" },
  { label: "Support", href: contactFor("Competen Practice support") },
];

// ── LP-PRA-001 page sections ──────────────────────────────────────────────────────────────────────────

// CPR-ARCH-001 v2's canonical practice journey, compressed to three moves. Version 1's version of this
// section described setting up a clinic; v2 is about the working day of one clinician, which is both what
// the architecture now describes and what the person reading this page actually has.
export const HOW_IT_WORKS = {
  title: "How it works",
  body: "Three moves. The first takes an afternoon; the other two happen every day, mostly without you.",
  steps: [
    { title: "Say where and when you work", body: "Your locations, sessions, appointment types and booking rules -- across every facility you practise in. Patients book the slots you have genuinely opened." },
    { title: "See the patient, capture in seconds", body: "Booked, walk-in or unscheduled, the encounter opens the same way. Record the minimum safely, link the diagnosis and treatment, and finish the detail later." },
    { title: "Let it close the loop", body: "Each encounter sets what happens next, updates the timeline, files the follow-up, and adds itself to the case memory you will search a year from now." },
  ],
};

/**
 * LP-PRA-001's trust section. Every line here is either an architectural fact from CPR-V2-000A or a business
 * rule from the module specifications -- things that are true because of how the product is built, rather
 * than because of who is claimed to use it. See the header of this file for what was deliberately left out.
 */
export const TRUST = {
  title: "Why a practice can trust this",
  body: "Not testimonials. The guarantees that come from how it is built.",
  // Tenant isolation is deliberately NOT repeated here -- TENANT_MODEL states it on the same page, in more
  // detail, and saying it twice reads as protesting.
  points: [
    { title: "Everything is audited", body: "Administrative actions, configuration changes, document activity and every login are recorded." },
    { title: "Consent is explicit", body: "Document sharing follows patient consent and your organisation's policy. Patients see what you share, not everything." },
    { title: "Reception cannot touch clinical records", body: "Role separation is enforced in the product, not left to good manners at the front desk." },
    { title: "Encrypted, in transit and at rest", body: "Documents are stored encrypted; exchanges with outside systems run over TLS and are logged." },
    { title: "Your data stays yours", body: "Export tools and open APIs. Nothing about the design is built to make leaving difficult." },
  ],
};

/**
 * LP-PRA-001 asks for FAQs. These answer what a clinician actually hesitates over, and every answer is
 * traceable to a specification -- including the last one, which is the question a visitor will have by the
 * time they reach the bottom of the page and the one it would be most tempting to leave out.
 */
export const FAQS: { q: string; a: string }[] = [
  {
    q: "Is this an electronic medical record?",
    a: "No, and the distinction matters. It is your professional record of your own authorised work with a patient -- not the authoritative institutional record. Inpatient charts, medication administration records, laboratory, radiology and billing systems are out of scope, and importing a hospital's data does not make that data yours. Where a hospital runs an EMR, Practice is built to connect to it rather than replace it.",
  },
  {
    q: "I work at more than one hospital. Does that work?",
    a: "That is the design. One personal record spans every facility, clinic, outreach site and teleconsultation you work in, and each encounter carries where it happened and under which local identifier. What it does not do is join those worlds up behind the scenes: organisation data stays governed by that organisation, patients are not matched across them automatically, and a report for one hospital cannot expose another's.",
  },
  {
    q: "Do I need a receptionist to use it?",
    a: "No. Working without one is a design principle rather than an afterthought -- a walk-in can be registered in under a minute and seen immediately, with the detail completed afterwards. If you do have an assistant, they can be added later with delegated permissions that stop short of your clinical records.",
  },
  {
    q: "Do my patients need an account to book?",
    a: "No. A new patient can find a clinician, choose a time and book without an account. The account is created as part of confirming that first appointment, so registration is something that happens along the way rather than a wall in front of it.",
  },
  {
    q: "Who can see my patients' information?",
    a: "Only your practice. Every practice is an isolated tenant -- users, patients, appointments, documents and analytics do not cross between them. Within your practice, access follows the role a person holds: reception can move a patient through the clinic and cannot alter a diagnosis or a treatment.",
  },
  {
    q: "Can it work alongside the systems we already have?",
    a: "That is the intention. The data layer is FHIR-ready and there are REST APIs and webhooks for exchange. In Version 1 the working connections are identity, notification delivery and document storage; EMR, laboratory, pharmacy, payment and calendar connections are on the roadmap and are labelled as such wherever they appear.",
  },
  {
    q: "What happens when a patient cancels?",
    a: "The slot is released immediately, and patients who opted into the waiting list are offered it automatically. Each is given a configurable window to respond before it passes to the next person, so a late cancellation does not become an empty afternoon.",
  },
  {
    q: "What do we need in order to start?",
    a: "Your practice details, your locations and working hours, and the people you want to invite. Your practice is created with a first administrator account, that administrator configures the local settings, and the practice goes live. Security policy, backups and licensing are handled by the platform and are not yours to maintain.",
  },
  {
    q: "Can I try it today?",
    a: "Not yet. Competen Practice is in development, and practices are being set up with us directly rather than through this website. If you would like to be among the first, tell us about your practice and we will get in touch.",
  },
];

// ── Journey pages ─────────────────────────────────────────────────────────────────────────────────────

export type JourneyStep = { title: string; body: string };

/** LP-DOC-001. The four post-login destinations are named because the specification names them, and they
 *  are described as what a role WILL reach -- not as somewhere the button goes today. */
export const PRACTICE_LOGIN = {
  eyebrow: "For your team",
  title: "Practice sign-in",
  body: "One door for everyone who works in the practice, with each person landing where their job starts.",
  audiences: [
    { role: "Doctor or specialist", lands: "Your practice dashboard -- today's schedule, follow-ups due and the patients waiting." },
    { role: "Reception or front desk", lands: "The reception workspace -- check-in, the live queue, walk-ins and the day's tasks." },
    { role: "Practice administrator", lands: "Practice administration -- locations, hours, users, templates and booking rules." },
    { role: "Enterprise administrator", lands: "An overview across every practice you are responsible for." },
  ],
  /**
   * ⚠ THIS LIST IS RENDERED WITH A GREEN TICK BESIDE EVERY LINE, UNDER THE HEADING "HOW ACCESS IS
   * PROTECTED". It is therefore a set of present-tense claims about controls that exist, and three of
   * the five were false (COMP-SECURITY-SURVEY-001 s0.5).
   *
   *  - "Every sign-in recorded" -- nothing recorded a sign-in. `practice_audit_event` held 2,480 rows
   *    across 38 event types and not one was an authentication event. TRUE NOW, and narrowed to what the
   *    code actually does: the trail is written by the Practice shell, so it covers every sign-in that
   *    opens a practice and does not claim to cover one that never did.
   *  - "Account lockout and brute-force protection" -- nothing. No lockout, no failed-attempt counter, no
   *    backoff, no CAPTCHA on any authentication endpoint, and no way to build one from here: passwords
   *    are checked by the platform's authentication server, which this product does not sit in front of,
   *    so a failed attempt never reaches any code in this repository. MOVED TO `planned`, where the
   *    absent OAuth providers already sit.
   *  - "Session timeout" -- written into the database, enforced in code, and dead: the device cookie was
   *    re-minted on every request, so no browser was ever recognised twice and no idle interval could be
   *    measured. The cookie is now planted by `src/proxy.ts`, so the control is real -- but it is OFF
   *    unless a practice sets a limit, and the line now says that rather than implying every practice
   *    has one.
   *
   * The file header rejects a HIPAA badge and a false practice count on exactly this principle. These
   * three had slipped through it.
   */
  security: [
    "Access limited to authorised users of your practice",
    "Role-based routing enforced after authentication",
    "Every sign-in that opens your practice is recorded, with the device it came from",
    "Devices are listed and can be locked out of your practice one at a time",
    "An idle sign-out limit your practice can set, or leave off",
  ],
  /**
   * Named in LP-DOC-001 as configurable or future, or -- for the lockout -- claimed as present and found
   * to be absent. Listed as such rather than shown as buttons or ticks.
   */
  planned: [
    "Multi-factor authentication",
    "Single sign-on",
    "Account lockout and brute-force protection",
  ],
};

/** LP-PAT-001. */
export const PATIENT_LOGIN = {
  eyebrow: "For patients",
  title: "Your care, in one place",
  body: "Sign in to see your appointments, complete what your clinician has asked for, and keep your own records to hand.",
  has: [
    { title: "Your appointments", body: "What is coming up, where it is, and what to bring." },
    { title: "Your next steps", body: "Forms to complete before a visit, and reviews that are due." },
    { title: "Your documents", body: "Referral letters, results and reports -- yours and the ones your clinician has shared." },
    { title: "Your messages", body: "Secure messages with your care team." },
  ],
  /**
   * ⚠ THE SAME GREEN TICKS, ON A JOURNEY THAT DOES NOT EXIST YET. The page's own header says this
   * privacy statement "is true today regardless of when the product opens" -- which is right about the
   * three lines describing how sharing works, because those are properties of the clinician-side engines
   * that are built. It was not right about "Every sign-in is recorded": there is no patient sign-in, no
   * patient role and no patient authentication of any kind, so nothing records one. Moved to `planned`
   * with the rest of the patient authentication story rather than ticked as an existing control.
   */
  privacy: [
    "You see only your own information",
    "Clinical details appear only where your clinician has shared them",
    "Patient access is separate from clinician access",
  ],
  planned: [
    "One-time codes by SMS",
    "Multi-factor authentication",
    "Access for a parent, guardian or carer",
    "A record of every patient sign-in",
  ],
};

/** LP-BOOK-001 followed by LP-NEW-001. They are one continuous journey -- LP-NEW-001's first step is
 *  LP-BOOK-001's last -- so they are presented as one, in order. */
export const BOOKING_JOURNEY = {
  eyebrow: "For patients",
  title: "Book an appointment",
  body: "Find the right clinician, pick a time that suits you, and confirm it -- without an account and without ringing the clinic.",
  find: [
    { title: "Search", body: "By specialty, service, location or clinician name." },
    { title: "Compare", body: "Qualifications, specialty, languages spoken, clinic locations and consultation types." },
    { title: "Choose a time", body: "Real availability, in person or remote, with any consultation fee shown before you commit." },
  ],
  register: [
    { title: "Your details", body: "Name, date of birth, contact details and address. Only what is needed to see you safely." },
    { title: "Emergency contact", body: "Who to reach, and how they are related to you." },
    { title: "Consent", body: "What your information is used for, stated before you agree rather than after." },
    { title: "Confirmation", body: "A booking reference, the date, time, clinician and location, directions, and how to prepare." },
  ],
  after: [
    "Your pre-visit questionnaire is assigned automatically",
    "Reminders are scheduled before the appointment",
    "The appointment can be added to your calendar",
    "The practice is notified",
  ],
};

/** The "Start Your Practice" journey. Its steps are CPR-V2-000A's tenant lifecycle, written for the person
 *  living through it rather than for the administrator performing it. */
export const START_PRACTICE = {
  eyebrow: "For clinicians and clinic owners",
  title: "Start your practice on Competen",
  body: "Six steps from a conversation to a diary patients can book into.",
  steps: [
    { title: "Tell us about your practice", body: "Its name, where you work from, and roughly how many clinicians and staff you have." },
    { title: "We create your practice", body: "Your own tenant, with your domain and the region your data sits in." },
    { title: "Your plan is set", body: "Subscription and the features included in it -- visible to you from the day you start." },
    { title: "You get the first account", body: "A practice administrator account, which is yours rather than ours." },
    { title: "You configure and invite", body: "Locations, hours, appointment types and booking rules, then your clinicians and front desk." },
    { title: "You go live", body: "Your booking page opens, reminders start going out, and follow-ups start being chased." },
  ],
  bring: [
    "Your practice name and contact details",
    "Your clinic locations and working hours",
    "The appointment types you offer and how long each takes",
    "The people you want to invite, and what each of them does",
  ],
};
