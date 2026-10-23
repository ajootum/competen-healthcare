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
  /** The hero panel's one-line idea. Its flow is the step labels. */
  signatureTitle: string;
  image: string;
  imageAlt: string;
  /**
   * CSS object-position for the hero portrait. Both source images are portrait (about 1:2) with the face
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

const SIGN_IN = "/individual/sign-in";
export const INDIVIDUAL_SIGN_IN = SIGN_IN;
/** An experience page's "Sign in": the Individual door, naming the experience the visitor came from. */
export const experienceSignIn = (k: ExperienceKey) => `${SIGN_IN}?experience=${k}`;

/** The shared Competen enquiries mailbox -- the address every public conversation CTA uses today. */
const COMPETEN_ENQUIRIES = "gabriel@semacast.com";

export const SCHOLAR: Experience = {
  key: "scholar",
  name: "Competen Scholar",
  wordmark: "scholar",
  href: "/scholar",
  legacyHref: "/students",
  // cyan-700: 5.4:1 against white as text and under white button labels.
  accent: "#0E7490",
  accentSoft: "#ECFEFF",
  tagline: "Learn · Understand · Apply",
  micro: "AI-powered healthcare education.",
  eyebrow: "Your AI-powered healthcare learning companion",
  headline: ["Study smarter.", "Think clinically.", "Grow confidently."],
  body:
    "Turn your notes into explanations, questions, clinical cases and audio learning. " +
    "Designed for healthcare students and the journey ahead of them.",
  signatureTitle: "Your notes become active learning.",
  image: "/images/home/path-students.webp",
  imageAlt: "A smiling student nurse in scrubs with a stethoscope",
  imagePosition: "72% 16%",
  stepsTitle: "How Competen Scholar works",
  stepsBody: "Five steps from the notes you already have to clinical confidence you can see.",
  steps: [
    {
      id: "upload", label: "Upload", title: "Bring your own notes",
      body: "Add lecture notes, slides and reading. Competen Scholar works from your material, organised by module.",
      points: ["PDF and Word notes", "Organised by module and topic"],
      mock: { heading: "My Learning · Cardiovascular", lines: [
        { text: "Heart failure — lecture 4.pdf", tag: "Added" },
        { text: "Cardiac drugs summary.docx", tag: "Added" },
      ] },
    },
    {
      id: "understand", label: "Understand", title: "Explanations grounded in your sources",
      body: "Ask about anything you have uploaded and get an explanation that cites the page it came from. Listen to it as audio on the move.",
      points: ["Answers cite your notes", "Audio explanations"],
      mock: { heading: "Explain", lines: [
        { text: "Why does left-sided heart failure cause breathlessness?" },
        { text: "Pressure backs up into the lungs' circulation, so fluid collects there.", tag: "Your notes · p. 7" },
      ] },
    },
    {
      id: "revise", label: "Revise", title: "Questions and revision from your material",
      body: "Practise with questions generated from your notes. Anything you miss comes back for review until it sticks.",
      points: ["Practice questions from your notes", "Spaced review of what you miss"],
      mock: { heading: "Revision · cards due today", lines: [
        { text: "A normal adult resting heart rate is…" },
        { text: "60–100 beats per minute", tag: "Correct" },
      ] },
    },
    {
      id: "apply", label: "Apply", title: "Think through clinical cases",
      body: "Work through patient scenarios and explain your reasoning, preparing for practice and practical examinations.",
      points: ["Case-based scenarios", "Reasoning, not just recall"],
      mock: { heading: "Case", lines: [
        { text: "A 68-year-old is breathless when lying flat." },
        { text: "What would you assess first, and why?", tag: "Your answer" },
      ] },
    },
    {
      id: "progress", label: "Progress", title: "See your progress build",
      body: "Track what you have mastered and what to revisit, topic by topic, across your whole course.",
      points: ["Topic-by-topic progress", "A record that stays with you"],
      mock: { heading: "Progress", lines: [
        { text: "Cardiovascular", tag: "Strong" },
        { text: "Respiratory", tag: "Revisit" },
      ] },
    },
  ],
  journeyNote: {
    title: "Part of your Competen journey",
    body: "What you learn in Scholar stays in your Competen Passport. Graduation is a natural moment to add Competen Professional to the same account, and you can keep Scholar for further study.",
  },
  closing: {
    title: "Start your learning journey.",
    body: "Talk to us about Competen Scholar for you, your cohort or your school.",
  },
  contact: { email: COMPETEN_ENQUIRIES, subject: "Competen Scholar enquiry" },
  operator: null,
};

export const PROFESSIONAL: Experience = {
  key: "professional",
  name: "Competen Professional",
  wordmark: "professional",
  href: "/professional",
  legacyHref: "/professionals",
  // indigo-600: the accent the Professionals pathway already carried; 6.3:1 against white.
  accent: "#4F46E5",
  accentSoft: "#EEF2FF",
  tagline: "Develop · Demonstrate · Advance",
  micro: "Your professional operating system.",
  eyebrow: "Your personal professional operating system",
  headline: ["Your career deserves", "more than a CPD tracker."],
  body:
    "Build your competencies, maintain your credentials, plan your development and discover " +
    "opportunities throughout your professional life.",
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
      body: "Hold your competencies with the source of every piece of evidence shown: your own record, an attached certificate or an employer sign-off.",
      points: ["Every item labelled by source", "Assessment evidence that stays with you"],
      mock: { heading: "Competencies", lines: [
        { text: "Central venous catheter care", tag: "Employer sign-off" },
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
      id: "career", label: "Career", title: "Plan your next step",
      body: "Plan your next role, speciality or leadership pathway, and see the evidence you already hold for it.",
      points: ["Career pathways", "Opportunities that fit your evidence"],
      mock: { heading: "Career", lines: [
        { text: "Next role: critical care nurse" },
        { text: "Evidence for this role", tag: "Review gaps" },
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

export const EXPERIENCES: Record<ExperienceKey, Experience> = { scholar: SCHOLAR, professional: PROFESSIONAL };
export const EXPERIENCE_LIST: Experience[] = [SCHOLAR, PROFESSIONAL];
export const siblingOf = (k: ExperienceKey): Experience => (k === "scholar" ? PROFESSIONAL : SCHOLAR);

export const enquiryHref = (c: { email: string; subject: string }) =>
  `mailto:${c.email}?subject=` + encodeURIComponent(c.subject);

// ── THE GATEWAY ── /individual ──────────────────────────────────────────────────────────────────────
export const INDIVIDUAL = {
  name: "Competen Individual",
  wordmark: "individual",
  href: "/individual",
  // teal-700, the Individual accent since 2026-08-02. 5.5:1 against white.
  accent: "#0F766E",
  accentSoft: "#F0FDFA",
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
    { title: "Activate when ready", body: "A guided activation adds Professional whenever you choose. Graduation is a good moment, not a condition." },
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
    { title: "Your personal AI", body: "A learning companion that knows your history." },
    { title: "Your learning history", body: "Everything you studied and achieved, kept together." },
    { title: "Your Competen Passport", body: "Verified evidence of what you know and can do." },
  ],
};
