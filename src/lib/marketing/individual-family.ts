import { productTheme } from "@/lib/design/tokens";
// ── THE COMPETEN INDIVIDUAL FAMILY, AS PUBLIC CONTENT ── COMPETEN-WEB-IND-001 ──────────────────────────
//
// Competen Individual is ONE product (products.ts, one of the four) presented through TWO independently
// branded experiences: Competen Scholar and Competen Professional. COMPETEN-IND-001 Option B, adopted by
// the owner. Everything the gateway, the two experience pages, the header, the footer and the homepage say
// about that family is read from HERE, so the brand names, accents and routes cannot disagree between
// surfaces -- the same single-source rule solutions.ts and practice-content.ts follow.
//
// ⚠ THE BRAND ROUTES ARE CANONICAL -- owner decision at the review GO. Scholar answers on /scholar and
// Professional on /professional; the old indexed audience routes /students and /professionals are
// permanent redirects (src/app/students, src/app/professionals), absent from the sitemap. The audience
// LABELS stay "Students" and "Professionals" in solutions.ts -- only the route is the brand's. The
// audience-to-product mapping is still the owner's 2026-08-11 one: both gate into Individual.
//
// ⚠ BOTH DOORS LEAD TO /individual/sign-in, CARRYING THE EXPERIENCE (COMPETEN-IND-ACCESS-001 s3). While the
// Individual release gate is off that door is the product-branded coming-soon screen (access-doors.ts:
// "being_built") and the primary action here stays a conversation -- the honesty rule the rest of the
// public site keeps (products.ts `live: false`). With the gate on, the same door funnels into the one
// Competen sign-in with the experience preserved, so a Scholar visitor signs in once and lands in Scholar.
//
// ⚠ DISCLOSURE. scripts/public-disclosure-harness.ts sweeps these pages' rendered text against its
// FORBIDDEN list. "AI-powered" is fine; the phrases "AI platform" and "Learning platform" are not, and
// neither is any Enterprise sub-product name. Copy edits here are copy edits to a guarded surface.

export type ExperienceKey = "scholar" | "professional";

/**
 * One step of an experience's product demonstration (WEB-IND-001 refinement, items 5-6). The step labels
 * ARE the hero flow ("Upload → Understand → ..."), so the two can never disagree.
 */
export type ExperienceStep = {
  /** In-page anchor. */
  id: string;
  /** The one-word flow label. */
  label: string;
  title: string;
  body: string;
  points: string[];
  /**
   * ⚠ A DRAWN ILLUSTRATION, NOT A SCREENSHOT AND NOT DATA. The same rule as the homepage hero cards: a
   * picture of what the step looks like, labelled as illustrative on the page. No figures that could read
   * as measurements -- tags are words ("Revisit"), never invented percentages.
   */
  mock: { heading: string; lines: { text: string; tag?: string }[] };
};

export type Experience = {
  key: ExperienceKey;
  /** The full brand, e.g. "Competen Scholar". */
  name: string;
  /** The sub-brand under the competen wordmark, the way /practice renders "practice". */
  wordmark: string;
  /** The canonical public route -- the brand's own, see the note above. */
  href: string;
  /** The old indexed audience route that permanently redirects to `href`. */
  legacyHref: string;
  accent: string;
  accentSoft: string;
  /** Three verbs, the brand line under the wordmark. */
  tagline: string;
  /** One line for menus and cards. */
  micro: string;
  eyebrow: string;
  headline: string[];
  body: string;
  image: string;
  imageAlt: string;
  /** The product bar's in-page anchors. Absent = the family default in ExperienceNav. */
  nav?: { href: string; label: string }[];
  /**
   * ⚠ WHERE THIS EXPERIENCE'S CONVERSATIONS GO -- configurable per experience (owner decision at the
   * review GO). Scholar runs through its own subsidiary, so its enquiries may need their own mailbox; until
   * that exists both use the shared Competen address, and changing it is this one field.
   */
  contact: { email: string; subject: string };
  /**
   * ⚠ THE OPERATING ENTITY, rendered as a one-line notice above the footer -- or NOT AT ALL while null.
   * COMPETEN-WEB-IND-001 s6: Scholar operates through a separately incorporated, majority-owned Competen
   * Holdings subsidiary; Professional through Holdings. The registered names are the owner's to supply,
   * and a guessed legal name on a public page is worse than none, so this stays null until they are.
   */
  operator: string | null;
};

/**
 * An experience presented through the step-by-step template (ExperiencePage): Competen Professional.
 * Competen Scholar left that template with SCHOLAR-WEB-REDESIGN-01 and carries `landing` instead.
 */
export type DemoExperience = Experience & {
  /** The hero panel's one-line idea. Its flow is the step labels. */
  signatureTitle: string;
  /**
   * CSS object-position for the hero portrait. The source image is portrait (about 1:2) with the face
   * in the upper third, so the crop is aimed at the face rather than left to the centre default.
   */
  imagePosition: string;
  stepsTitle: string;
  stepsBody: string;
  steps: ExperienceStep[];
  /**
   * The concise lifecycle reference for this page (refinement item 4). The full journey lives on
   * /individual only; experience pages say one contextual thing and link to it.
   */
  journeyNote: { title: string; body: string };
  closing: { title: string; body: string };
};

const SIGN_IN = "/individual/sign-in";
export const INDIVIDUAL_SIGN_IN = SIGN_IN;
/** An experience page's "Sign in": the Individual door, naming the experience the visitor came from. */
export const experienceSignIn = (k: ExperienceKey) => `${SIGN_IN}?experience=${k}`;

/** The shared Competen enquiries mailbox -- the address every public conversation CTA uses today. */
const COMPETEN_ENQUIRIES = "gabriel@semacast.com";

// ── COMPETEN SCHOLAR: THE PUBLIC LANDING PAGE ── SCHOLAR-WEB-REDESIGN-01 (owner, 29 Oct 2026) ──────────────
//
// "Public websites sell the value. Authenticated experiences deliver the capabilities. Internal governance
// protects the intelligence." Every word and image reference /scholar shows is in this block; the page
// (src/components/marketing/ScholarLanding.tsx) only lays it out.
//
// ⚠ CONTENT CLASSES -- the rule this block is written under. Competen Holdings has no content-governance
// store to record them in, so they are recorded here and in the build record. They govern PUBLICATION, not
// access, and no engine enforces them; the disclosure harness (7q) guards the known leaks.
//   PUBLIC        may appear here: benefits, approved descriptions, pricing, brand, approved photography.
//   CONTROLLED    never here, only in an authorised setting (the signed-in product, a pilot briefing):
//                 detailed demos, selected workflows, institutional onboarding, authorised previews.
//   CONFIDENTIAL  never on any public surface: AI orchestration, the learning architecture, competency
//                 mapping, knowledge contribution, case intelligence, governance engines, allowances, and
//                 how any of it is implemented.
// So: no file names, sample AI answers, citations, revision screens, case prompts or progress dashboards
// (the five-step demonstration this replaced was CONTROLLED material), and no engine or stage names.
//
// ⚠ NO UNVERIFIED CLAIMS. No user counts, partners, approvals or outcomes -- the approved mockup's "Join
// thousands of healthcare students" is unverified and stays out. The availability copy says what is true.

export type ScholarIcon = "book" | "cap" | "stethoscope" | "people" | "heart" | "building";

export type ScholarLanding = {
  hero: { primary: string; secondary: string };
  benefits: {
    eyebrow: string; title: string; body: string;
    items: { title: string; body: string; icon: ScholarIcon; tone: "scholar" | "indigo" }[];
  };
  journey: {
    eyebrow: string; title: string; body: string; professionalLine: string;
    cta: { label: string; href: string };
    /** The section's photograph (the owner-supplied master; variants by scripts/build-scholar-images.mjs), or null for the drawn panel. */
    image: { src: string; alt: string } | null;
  };
  /**
   * ⚠ AUDIENCES ARE A LIST, NOT A LAYOUT. Adding a profession is adding an entry; nothing on the page is
   * written for nursing, and the grid takes any count.
   */
  audiences: { eyebrow: string; title: string; items: { key: string; title: string; body: string; icon: ScholarIcon }[] };
  start: {
    eyebrow: string; title: string; body: string; primary: string; school: string;
    /** Shown only while public sign-up is closed (scholarGetStarted below). */
    closedNote: string; invited: string; signIn: string;
  };
  /** The enquiry subjects, so an invitation request and a school conversation arrive distinguishable. */
  subjects: { invitation: string; school: string };
};

export const SCHOLAR: Experience & { landing: ScholarLanding } = {
  key: "scholar",
  name: "Competen Scholar",
  wordmark: "scholar",
  href: "/scholar",
  legacyHref: "/students",
  // COMPETEN-DESIGN-SYSTEM-01 + HFE-COLOR-02: the approved Scholar theme (teal #0B7089, 5.69:1 on white), from tokens.ts.
  accent: productTheme.scholar.accent,
  accentSoft: productTheme.scholar.soft,
  tagline: "Learn · Understand · Apply",
  micro: "AI-powered healthcare education.",
  eyebrow: "Your AI-powered healthcare learning companion",
  headline: ["Your notes.", "Your knowledge.", "Your clinical confidence."],
  body:
    "Competen Scholar is your AI-powered learning companion, helping you understand difficult concepts, " +
    "prepare confidently for assessments, and connect classroom learning with clinical practice.",
  // The owner-approved photograph (29 Oct). Variants: scripts/build-scholar-images.mjs. Social card: build-og-images.mjs.
  image: "/images/scholar/hero-students.webp",
  imageAlt: "Healthcare students in scrubs and nursing uniforms gathered around a simulation manikin, discussing a case together",
  nav: [
    { href: "#overview", label: "Overview" },
    { href: "#benefits", label: "Benefits" },
    { href: "#journey", label: "Your Journey" },
    { href: "#start", label: "Get Started" },
  ],
  landing: {
    hero: { primary: "Get Started", secondary: "Talk to Us" },
    benefits: {
      eyebrow: "What Competen Scholar helps you do",
      title: "From your notes to real understanding",
      body: "Learn more effectively, prepare with confidence, and develop the knowledge and reasoning skills needed for clinical practice.",
      items: [
        { title: "Understand difficult concepts", icon: "book", tone: "scholar",
          body: "Make challenging healthcare topics easier to understand through personalised learning support." },
        { title: "Prepare with confidence", icon: "cap", tone: "indigo",
          body: "Strengthen your knowledge and prepare for examinations through meaningful practice and revision." },
        { title: "Apply your learning clinically", icon: "stethoscope", tone: "scholar",
          body: "Develop clinical thinking and decision-making through practical learning experiences." },
      ],
    },
    journey: {
      eyebrow: "Learning that grows with you",
      title: "Build your skills for the future",
      body: "Your learning journey does not end at graduation. Competen helps you continue developing your knowledge, skills, and professional confidence throughout your career.",
      professionalLine: "When you begin to practise, Competen Professional is there for the next stage of your career.",
      cta: { label: "Explore Your Journey", href: "/individual#journey" },
      image: { src: "/images/scholar/journey-student-laptop.webp", alt: "A nursing student in scrubs smiling as she studies on a laptop, with books beside her" },
    },
    audiences: {
      eyebrow: "Who is Competen Scholar for?",
      title: "For healthcare students at every stage",
      items: [
        { key: "nursing", title: "Nursing students", body: "Build knowledge and clinical confidence.", icon: "people" },
        { key: "medical", title: "Medical students", body: "Support your studies and clinical training.", icon: "stethoscope" },
        { key: "allied", title: "Allied health students", body: "Apply your learning to real practice.", icon: "heart" },
        { key: "schools", title: "Schools and training institutions", body: "Support your learners with a modern learning companion.", icon: "building" },
      ],
    },
    start: {
      eyebrow: "Get started",
      title: "Start your learning journey",
      body: "Discover a smarter way to learn, build confidence, and prepare for your future in healthcare.",
      primary: "Get Started",
      school: "Talk to Us About Your School",
      closedNote: "Competen Scholar is currently available by invitation while we run our pilot. Get Started asks us for an invitation for you or your school.",
      invited: "Already invited?",
      signIn: "Sign in",
    },
    subjects: { invitation: "Competen Scholar invitation request", school: "Competen Scholar for our school" },
  },
  contact: { email: COMPETEN_ENQUIRIES, subject: "Competen Scholar enquiry" },
  operator: null,
};

/**
 * ⚠ GET STARTED FOLLOWS THE GATES, NEVER AHEAD OF THEM. /individual/join is the Scholar registration journey
 * and is a 404 unless individual_app AND individual_self_registration are both on (src/lib/individual/join.ts,
 * selfRegistrationEnabled). `open` is that answer, read by the page at request time. While it is false the
 * button never offers a sign-up the gates would refuse: in the hero it goes to the Get Started section, which
 * says the pilot is by invitation; there it asks for an invitation through the enquiry route.
 */
export const SCHOLAR_JOIN = "/individual/join";
export function scholarGetStarted(open: boolean, place: "hero" | "start"): string {
  if (open) return SCHOLAR_JOIN;
  return place === "hero" ? "#start" : enquiryHref({ email: SCHOLAR.contact.email, subject: SCHOLAR.landing.subjects.invitation });
}

export const PROFESSIONAL: DemoExperience = {
  key: "professional",
  name: "Competen Professional",
  wordmark: "professional",
  href: "/professional",
  legacyHref: "/professionals",
  // COMPETEN-DESIGN-SYSTEM-01: the approved Professional theme (indigo #4338CA, 7.90:1 on white), from tokens.ts.
  accent: productTheme.professional.accent,
  accentSoft: productTheme.professional.soft,
  tagline: "Develop · Demonstrate · Advance",
  micro: "Your professional operating system.",
  eyebrow: "Your personal professional operating system",
  headline: ["Your career deserves", "more than a CPD tracker."],
  body:
    "Build your competencies, maintain your credentials, plan your development and " +
    "keep your record with you throughout your professional life.",
  signatureTitle: "A professional home that grows with you.",
  image: "/images/home/path-professionals.webp",
  imageAlt: "A smiling doctor in a white coat with a stethoscope",
  imagePosition: "50% 12%",
  stepsTitle: "How Competen Professional works",
  stepsBody: "One connected record, from the plan you set to the role you want next.",
  steps: [
    {
      id: "development", label: "Development", title: "Plan your development",
      body: "Set goals for your role, registration and speciality, and keep one development plan that you own.",
      points: ["Goals you set", "Registration renewal reminders"],
      mock: { heading: "Development plan", lines: [
        { text: "Goal: critical care competence", tag: "In progress" },
        { text: "Registration renewal", tag: "Reminder set" },
      ] },
    },
    {
      id: "learning", label: "Learning", title: "Log learning and CPD",
      body: "Record courses, conferences and reflective learning as CPD, ready whenever your regulator or employer asks.",
      points: ["CPD with reflections", "Hours by year"],
      mock: { heading: "CPD log", lines: [
        { text: "Sepsis recognition update", tag: "Self-declared" },
        { text: "Advanced life support course", tag: "Certificate attached" },
      ] },
    },
    {
      id: "evidence", label: "Competency Evidence", title: "Keep your competency evidence",
      body: "Hold your competencies with the source of every piece of evidence shown: your own record, an attached document, or an independent assessor’s outcome where one exists.",
      points: ["Every item labelled by source", "Assessment evidence that stays with you"],
      mock: { heading: "Competencies", lines: [
        { text: "Central venous catheter care", tag: "Self-assessed" },
        { text: "Medication safety", tag: "Certificate attached" },
      ] },
    },
    {
      id: "passport", label: "Passport", title: "Share your Competen Passport",
      body: "Bring your record together in one Passport and share it with a link you can revoke at any time.",
      points: ["One shareable record", "You control who sees it"],
      mock: { heading: "Competen Passport", lines: [
        { text: "Share link for a job application", tag: "Active" },
        { text: "Revoke access at any time" },
      ] },
    },
    {
      id: "career", label: "Career", title: "Build your CV from your record",
      body: "Make a CV, resume or portfolio from the records you choose, each one keeping what its source says about it.",
      points: ["CV, resume and portfolio templates", "You choose every record"],
      mock: { heading: "Career", lines: [
        { text: "Professional CV", tag: "Draft" },
        { text: "Preview before you export" },
      ] },
    },
  ],
  journeyNote: {
    title: "Part of your Competen journey",
    body: "Start Competen Professional at any stage of your career; you do not need Scholar first. If you studied with Scholar, your learning history is already here, and Scholar is there whenever you return to study.",
  },
  closing: {
    title: "Invest in your professional future.",
    body: "Talk to us about Competen Professional for you or your team.",
  },
  contact: { email: COMPETEN_ENQUIRIES, subject: "Competen Professional enquiry" },
  operator: null,
};

/** Either shape: the step template (Professional) or the landing page (Scholar). */
export type AnyExperience = DemoExperience | typeof SCHOLAR;
export const EXPERIENCES: Record<ExperienceKey, AnyExperience> = { scholar: SCHOLAR, professional: PROFESSIONAL };
export const EXPERIENCE_LIST: AnyExperience[] = [SCHOLAR, PROFESSIONAL];
export const siblingOf = (k: ExperienceKey): Experience => (k === "scholar" ? PROFESSIONAL : SCHOLAR);

export const enquiryHref = (c: { email: string; subject: string }) =>
  `mailto:${c.email}?subject=` + encodeURIComponent(c.subject);

// ── THE GATEWAY ── /individual ──────────────────────────────────────────────────────────────────────
export const INDIVIDUAL = {
  name: "Competen Individual",
  wordmark: "individual",
  href: "/individual",
  // COMPETEN-DESIGN-SYSTEM-01: the approved Individual theme (indigo #4338CA, 7.90:1 on white), from tokens.ts.
  accent: productTheme.individual.accent,
  accentSoft: productTheme.individual.soft,
  tagline: "Your lifelong professional home",
  eyebrow: "One journey · A lifetime of growth",
  headline: ["Your learning.", "Your competence.", "Your career."],
  body:
    "Start with Scholar or Professional, wherever you are today. Keep your achievements, your personal AI " +
    "and your Competen Passport connected throughout your working life.",
  signature: { title: "Scholar + Professional. One continuous journey.", flow: ["Study", "Graduate", "Practise", "Specialise", "Lead"] },
  experiencesTitle: "Two distinct experiences",
  experiencesBody: "Choose where you are today. Move between them as your career evolves.",
  closing: { title: "Interested in Competen Individual?", body: "Talk to us and we will walk you through it." },
  contact: { email: COMPETEN_ENQUIRIES, subject: "Competen Individual enquiry" },
};

// ── THE LIFECYCLE ── COMPETEN-WEB-IND-001 s4 ────────────────────────────────────────────────────────
//
// ⚠ GRADUATION IS ACTIVATION, NOT MIGRATION. The copy must never suggest a second account, a transfer or
// an export: Professional is switched on for the same person, and Scholar may stay on alongside it.
// ⚠ AND GRADUATION IS A SUGGESTED MILESTONE, NOT AN ELIGIBILITY RULE (refinement item 2). Professional
// is open at any career stage without Scholar; no line here may read as "Professional comes after".
export const LIFECYCLE = {
  title: "From student to professional, without starting again",
  body: "Graduation is a natural moment to activate Competen Professional, but not a requirement: practising professionals start with Professional directly, and Scholar is there whenever you return to study. There is never a new account to create or anything to move across.",
  stages: [
    { label: "Study", experience: "scholar" as ExperienceKey },
    { label: "Graduate", experience: "scholar" as ExperienceKey },
    { label: "Practise", experience: "professional" as ExperienceKey },
    { label: "Specialise", experience: "professional" as ExperienceKey },
    { label: "Lead", experience: "professional" as ExperienceKey },
  ],
  promises: [
    { title: "No account migration", body: "The account you studied with is the account you practise with." },
    { title: "Activate when ready", body: "Professional is added to the same account when you are ready. Graduation is a good moment, not a condition." },
    { title: "Use both", body: "Keep Scholar for further study while Professional supports your practice." },
  ],
};

// ── WHAT STAYS WITH YOU ── COMPETEN-WEB-IND-001 s5 ──────────────────────────────────────────────────
//
// ⚠ Visitor language only. No IAM, entitlement, gate or registry vocabulary: WEB-HOME-001 s2/s11 forbid
// teaching visitors the internal architecture, and the disclosure harness checks the homepage for it.
export const PASSPORT = {
  title: "One identity. One lifelong Competen Passport.",
  points: [
    { title: "One identity", body: "One Competen account from your first lecture onwards." },
    { title: "Your personal AI", body: "Uses what is on your Competen record when you ask. Your questions are not kept." },
    { title: "Your learning history", body: "Everything you studied and achieved, kept together." },
    { title: "Your Competen Passport", body: "What you know and can do, each record labelled self-declared, document-supported or verified." },
  ],
};
