// ── THE COMPETEN INDIVIDUAL EXPERIENCE REGISTRY ── COMPETEN-IND-003 s2-s3, ADR-016 ─────────────────────
//
// Competen Individual is ONE product (gate 3) presented as TWO experiences, Competen Scholar and Competen
// Professional (COMPETEN-IND-001 D2-D3). Everything the signed-in shell says about an experience -- its
// name, accent, navigation and the capabilities it does NOT have yet -- is read from HERE, so the
// sidebar, the bottom bar, the switcher, the welcome and the experience home cannot disagree.
//
// ⚠ THIS MODULE IMPORTS NOTHING -- the constants-file rule access-doors.ts records. Pages, the API, the
// unit tests and scripts/individual-foundation-harness.ts all read it.
//
// ⚠ BRAND VALUES MIRROR THE PUBLIC SITE. The names, wordmarks, accents and taglines are the ones
// src/lib/marketing/individual-family.ts publishes on web-ind-001/individual-redesign. That branch is
// not merged, so they are restated rather than imported. When both land, the public file becomes the
// single source and these four fields read from it.
//
// ⚠ NAVIGATION IS WHAT IS BUILT, NOTHING ELSE. COMPETEN-IND-003 s3: "Do not create simulated
// functionality ... Where a capability is not implemented, provide an appropriate governed empty state
// or omit it until ready." So a capability that does not exist has NO nav entry. It appears once, in
// `planned`, which the experience home renders as a short "not yet available" list with the reason.
// That is the governed empty state. A planned entry becomes a nav entry the day its module ships, in
// this file and nowhere else.

export type ExperienceKey = "scholar" | "professional";
export const EXPERIENCE_KEYS: readonly ExperienceKey[] = ["scholar", "professional"];

export const isExperienceKey = (v: unknown): v is ExperienceKey =>
  typeof v === "string" && (EXPERIENCE_KEYS as readonly string[]).includes(v);

/** Matches individual_entitlement.operating_entity (migration 370). COMPETEN-IND-001 D6. */
export type OperatingEntity = "competen_holdings" | "scholar_operator";

/**
 * A module of the Individual FOUNDATION. Each exists once and is mounted inside every experience at
 * /individual/<experience>/<segment>, so the navigation context lives in the URL and the data is the
 * same person-scoped data whichever experience shows it (ADR-016 decision 6).
 */
export type FoundationModule = "home" | "assistant" | "passport" | "profile" | "settings";

export type NavItem = {
  /** A FoundationModule, or the key of one of the experience's own modules. */
  module: FoundationModule | string;
  /** Path below /individual/<experience>. Empty for the experience home. */
  segment: string;
  label: string;
  /** Short label for the mobile bottom bar. */
  short: string;
  /** A glyph, aria-hidden wherever it renders -- the same convention as the Practice sidebar. */
  icon: string;
};

/**
 * A module that belongs to ONE experience (COMPETEN-IND-007): mounted at /individual/<experience>/<segment>
 * and present only in that experience's navigation. Its page lives in the experience's route group,
 * src/app/individual/(app)/[experience]/(<experience>)/<segment>/page.tsx, and refuses in any other
 * experience. A segment is never shared between experiences, so no page file is either.
 */
export type ExperienceModule = NavItem & {
  /** One line for the experience home's card. */
  summary: string;
  /** On the mobile bottom bar. Home is always first, and the bar holds five at most. */
  bottom?: boolean;
};

/** A capability the experience will have and does not have yet. Never a nav entry (see header). */
export type PlannedCapability = {
  key: string;
  label: string;
  /** What it will do, in the public site's words. */
  summary: string;
  /** Why it is not here today. Honest and specific -- never "coming soon". */
  reason: string;
};

export type ExperienceConfig = {
  key: ExperienceKey;
  name: string;
  wordmark: string;
  /** Text-safe accent (>= 4.5:1 on white) -- the public site's values. */
  accent: string;
  accentSoft: string;
  tagline: string;
  /** One line for the switcher and the welcome. */
  micro: string;
  operatingEntity: OperatingEntity;
  /** The experience home's opening sentence. */
  homeIntro: string;
  /** The experience's own modules, in sidebar order. Empty until its first module ships. */
  modules: ExperienceModule[];
  planned: PlannedCapability[];
};

// ── THE FOUNDATION NAVIGATION ── the same five modules in both experiences ───────────────────────────
//
// Order is the sidebar order. The first four are the bottom bar on mobile; Settings sits in the account
// area there (CPR-MOB-001: the bottom bar is for destinations, not configuration).
export const FOUNDATION_NAV: readonly NavItem[] = [
  { module: "home", segment: "", label: "Home", short: "Home", icon: "⌂" },
  { module: "assistant", segment: "assistant", label: "Personal AI", short: "AI", icon: "✦" },
  { module: "passport", segment: "passport", label: "Competen Passport", short: "Passport", icon: "▣" },
  { module: "profile", segment: "profile", label: "Profile & history", short: "Profile", icon: "☺" },
  { module: "settings", segment: "settings", label: "Settings", short: "Settings", icon: "⚙" },
];

export const SCHOLAR: ExperienceConfig = {
  key: "scholar",
  name: "Competen Scholar",
  wordmark: "scholar",
  accent: "#0E7490",
  accentSoft: "#ECFEFF",
  tagline: "Learn · Understand · Apply",
  micro: "Healthcare education, revision and clinical reasoning.",
  operatingEntity: "scholar_operator",
  homeIntro: "Your study space. Your Passport, profile and personal AI are already here, and the learning tools below are being built.",
  modules: [],
  planned: [
    {
      key: "my-learning", label: "My Learning",
      summary: "Upload your notes and get explanations grounded in your own sources.",
      reason: "Study-material upload and source-grounded explanation are not built yet. Nothing you upload could be read back to you today.",
    },
    {
      key: "revision", label: "Revision & Exams",
      summary: "Practice questions from your notes, and revision that adapts to what you miss.",
      reason: "Question generation from your own material is not built yet.",
    },
    {
      key: "clinical-reasoning", label: "Clinical Reasoning",
      summary: "Interactive patient scenarios where you explain your thinking.",
      reason: "Case content needs a clinical-review record before it is served to students, and that record does not exist yet.",
    },
    {
      key: "audio-progress", label: "Audio & Progress",
      summary: "Listen on the move and see your progress over time.",
      reason: "Audio learning is not built, and progress needs study activity to measure.",
    },
  ],
};

export const PROFESSIONAL: ExperienceConfig = {
  key: "professional",
  name: "Competen Professional",
  wordmark: "professional",
  accent: "#4F46E5",
  accentSoft: "#EEF2FF",
  tagline: "Develop · Demonstrate · Advance",
  micro: "Your lifelong professional development, evidence and career.",
  operatingEntity: "competen_holdings",
  homeIntro: "Your professional home: your registration, development plan, CPD and evidence. They are kept by you, and nobody else sees them unless you share them.",
  modules: [
    { module: "registration", segment: "registration", label: "Profession & registration", short: "Registration", icon: "◈",
      summary: "Your profession, registration body and number, and country." },
    { module: "development", segment: "development", label: "Needs & plan", short: "Plan", icon: "◎", bottom: true,
      summary: "Your development needs and the learning goals you set against them." },
    { module: "cpd", segment: "cpd", label: "CPD log", short: "CPD", icon: "✎", bottom: true,
      summary: "Your continuing professional development, with reflections and certificates." },
    { module: "evidence", segment: "evidence", label: "Credentials & evidence", short: "Evidence", icon: "❖",
      summary: "Credentials, renewal dates and the evidence you keep of your competence." },
    { module: "progress", segment: "progress", label: "Progress", short: "Progress", icon: "↗",
      summary: "Plan progress, CPD hours by year, and how much of your plan has evidence behind it." },
  ],
  planned: [
    {
      key: "career", label: "Career & Opportunities",
      summary: "Plan your next role, speciality or leadership pathway.",
      reason: "Career planning has no store yet.",
    },
    {
      key: "verification", label: "Independent verification",
      summary: "Have a registration or credential confirmed by someone with the authority to confirm it.",
      reason: "No regulator lookup or verification service is connected. Everything you add is shown as recorded by you.",
    },
  ],
};

export const EXPERIENCES: Readonly<Record<ExperienceKey, ExperienceConfig>> = {
  scholar: SCHOLAR,
  professional: PROFESSIONAL,
};

/**
 * An experience's sidebar: Home, then its own modules, then the rest of the foundation. Pure, and the one
 * source the sidebar, the bottom bar and scripts/individual-foundation-harness.ts 7a read.
 */
export function navFor(experience: ExperienceKey): NavItem[] {
  const [home, ...rest] = FOUNDATION_NAV;
  return [home, ...EXPERIENCES[experience].modules, ...rest];
}

/**
 * The mobile bottom bar: Home, the experience modules marked `bottom`, then foundation destinations up to
 * five. Settings is configuration, not a destination (CPR-MOB-001), and stays behind the header account link.
 */
export function bottomNavFor(experience: ExperienceKey): NavItem[] {
  const [home, ...rest] = FOUNDATION_NAV.filter(i => i.module !== "settings");
  const own = EXPERIENCES[experience].modules.filter(m => m.bottom);
  return [home, ...own, ...rest].slice(0, 5);
}

/** The href of a foundation module inside an experience. */
export function experienceHref(experience: ExperienceKey, segment = ""): string {
  return segment ? `/individual/${experience}/${segment}` : `/individual/${experience}`;
}
