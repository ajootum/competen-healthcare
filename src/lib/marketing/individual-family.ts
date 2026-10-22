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
// ⚠ NEITHER EXPERIENCE CAN BE SIGNED INTO YET. Both doors lead to /individual/sign-in, the product-branded
// coming-soon screen (access-doors.ts: "being_built"), and the primary action is a conversation. That is
// the same honesty rule the rest of the public site keeps -- see products.ts `live: false`.
//
// ⚠ DISCLOSURE. scripts/public-disclosure-harness.ts sweeps these pages' rendered text against its
// FORBIDDEN list. "AI-powered" is fine; the phrases "AI platform" and "Learning platform" are not, and
// neither is any Enterprise sub-product name. Copy edits here are copy edits to a guarded surface.

export type ExperienceKey = "scholar" | "professional";

export type ExperienceSection = {
  id: string;
  title: string;
  body: string;
  points: string[];
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
  signature: { title: string; flow: string[] };
  image: string;
  imageAlt: string;
  sectionsTitle: string;
  sectionsBody: string;
  sections: ExperienceSection[];
  /** What this experience adds to the lifelong record. Rendered in the Passport band. */
  passportLine: string;
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
  signature: { title: "Your notes become active learning.", flow: ["Upload", "Understand", "Practise", "Apply"] },
  image: "/images/home/path-students.webp",
  imageAlt: "A student nurse with a tablet",
  sectionsTitle: "Built around how you learn",
  sectionsBody: "One connected academic learning experience, from first lecture to final examination.",
  sections: [
    {
      id: "my-learning", title: "My Learning",
      body: "Upload your notes and explore explanations grounded in your own sources.",
      points: ["Explanations tied to your material", "Ask follow-up questions as you read"],
    },
    {
      id: "revision", title: "Revision & Exams",
      body: "Questions, adaptive revision and examination preparation.",
      points: ["Practice questions from your notes", "Revision that adapts to what you miss"],
    },
    {
      id: "clinical-reasoning", title: "Clinical Reasoning",
      body: "Work through interactive patient scenarios and explain your thinking.",
      points: ["Case-based scenarios", "Reasoning, not just recall"],
    },
    {
      id: "audio-progress", title: "Audio & Progress",
      body: "Listen on the move, reflect on what you learned and track your development.",
      points: ["Audio learning from your notes", "Progress you can see over time"],
    },
  ],
  passportLine: "Your Scholar achievements become part of your lifelong Competen Passport.",
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
  signature: { title: "A professional home that grows with you.", flow: ["Competence", "Evidence", "Growth", "Opportunity"] },
  image: "/images/home/path-professionals.webp",
  imageAlt: "A doctor outside a hospital",
  sectionsTitle: "Everything supporting your professional growth",
  sectionsBody: "One connected professional development experience, for every stage of your career.",
  sections: [
    {
      id: "development", title: "Development & CPD",
      body: "Plan your learning and keep your continuing education evidence in one place.",
      points: ["A development plan you own", "CPD evidence ready when you need it"],
    },
    {
      id: "competencies", title: "Competencies",
      body: "Document your development alongside verified assessment evidence.",
      points: ["Your competencies, recorded", "Assessment evidence that stays with you"],
    },
    {
      id: "credentials", title: "Credentials & Passport",
      body: "Maintain your qualifications, registrations and professional achievements.",
      points: ["Credentials in one record", "Your Competen Passport, always current"],
    },
    {
      id: "career", title: "Career & Opportunities",
      body: "Plan your next role, speciality or leadership pathway.",
      points: ["Career planning", "Opportunities that fit your evidence"],
    },
  ],
  passportLine: "Your academic history and professional evidence stay connected in one Competen Passport.",
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
    "Begin with Scholar. Grow through Professional. Keep your achievements, your personal AI and your " +
    "Competen Passport connected throughout your working life.",
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
export const LIFECYCLE = {
  title: "From student to professional, without starting again",
  body: "Graduation opens Competen Professional for you with a guided activation. There is no new account to create and nothing to move across.",
  stages: [
    { label: "Study", experience: "scholar" as ExperienceKey },
    { label: "Graduate", experience: "scholar" as ExperienceKey },
    { label: "Practise", experience: "professional" as ExperienceKey },
    { label: "Specialise", experience: "professional" as ExperienceKey },
    { label: "Lead", experience: "professional" as ExperienceKey },
  ],
  promises: [
    { title: "No account migration", body: "The account you studied with is the account you practise with." },
    { title: "Guided activation", body: "Professional is switched on for you when you graduate, step by step." },
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
