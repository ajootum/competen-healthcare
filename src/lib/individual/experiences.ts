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
  module: FoundationModule;
  /** Path below /individual/<experience>. Empty for the experience home. */
  segment: string;
  label: string;
  /** Short label for the mobile bottom bar. */
  short: string;
  /** A glyph, aria-hidden wherever it renders -- the same convention as the Practice sidebar. */
  icon: string;
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
  planned: PlannedCapability[];
  /**
   * Experience-OWNED modules: destinations only this experience has, mounted at
   * /individual/<experience>/<segment> with their pages under (app)/[experience]/(<experience>)/<segment>.
   * Empty until the module ships -- a planned capability is listed in `planned`, never here.
   */
  modules: ExperienceModule[];
};

/** A destination one experience owns (IND-004 Scholar, IND-007 Professional). */
export type ExperienceModule = {
  key: string;
  /** Path below /individual/<experience>. Must not reuse a foundation segment. */
  segment: string;
  label: string;
  short: string;
  icon: string;
  /** Wants a place on the mobile bottom bar. bottomNavFor() caps the bar at five. */
  bottom?: boolean;
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
  modules: [],
  homeIntro: "Your study space. Your Passport, profile and personal AI are already here, and the learning tools below are being built.",
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
  modules: [],
  homeIntro: "Your professional home. Your Passport, profile and personal AI are already here, and the development tools below are being built.",
  planned: [
    {
      key: "development-cpd", label: "Development & CPD",
      summary: "Plan your learning and keep your continuing-education evidence in one place.",
      reason: "A private Individual CPD record is not built yet. Your employer's CPD log is not used here, because it is visible to them.",
    },
    {
      key: "competencies", label: "Competencies",
      summary: "Document your development alongside verified assessment evidence.",
      reason: "Recording your own competency evidence is not built yet. Assessed competencies an organisation issued to you already appear in your Passport.",
    },
    {
      key: "credentials", label: "Credentials & registration",
      summary: "Maintain your qualifications, registrations and renewal dates.",
      reason: "Adding credentials from Competen Individual is not built yet. Credentials already on your Competen record appear in your Passport.",
    },
    {
      key: "career", label: "Career & Opportunities",
      summary: "Plan your next role, speciality or leadership pathway.",
      reason: "Career planning has no store yet.",
    },
  ],
};

export const EXPERIENCES: Readonly<Record<ExperienceKey, ExperienceConfig>> = {
  scholar: SCHOLAR,
  professional: PROFESSIONAL,
};

// ── THE GENERATED NAVIGATION ── one sidebar list and one bottom-bar list per experience ──────────────
//
// The ONLY place the shell's navigation is composed (ShellNav renders these, nothing else), so the two
// experiences cannot drift and an experience module appears the day it is added to `modules`.

export type ShellNavItem = { key: string; segment: string; label: string; short: string; icon: string };

const asItem = (n: NavItem): ShellNavItem => ({ key: n.module, segment: n.segment, label: n.label, short: n.short, icon: n.icon });

/** Sidebar order: Home, the experience's own modules, then the rest of the foundation. */
export function navFor(experience: ExperienceKey): ShellNavItem[] {
  const home = FOUNDATION_NAV.filter(n => n.module === "home").map(asItem);
  const rest = FOUNDATION_NAV.filter(n => n.module !== "home").map(asItem);
  const own = EXPERIENCES[experience].modules.map(m => ({ key: m.key, segment: m.segment, label: m.label, short: m.short, icon: m.icon }));
  return [...home, ...own, ...rest];
}

/** CPR-MOB-001: at most five bottom tabs -- Home, modules flagged `bottom`, then foundation to fill. Settings
 *  never sits on the bar (it lives behind the account link). */
export const BOTTOM_BAR_MAX = 5;
export function bottomNavFor(experience: ExperienceKey): ShellNavItem[] {
  const home = FOUNDATION_NAV.filter(n => n.module === "home").map(asItem);
  const own = EXPERIENCES[experience].modules.filter(m => m.bottom).map(m => ({ key: m.key, segment: m.segment, label: m.label, short: m.short, icon: m.icon }));
  const fill = FOUNDATION_NAV.filter(n => n.module !== "home" && n.module !== "settings").map(asItem);
  return [...home, ...own, ...fill].slice(0, BOTTOM_BAR_MAX);
}

/** The href of a foundation module inside an experience. */
export function experienceHref(experience: ExperienceKey, segment = ""): string {
  return segment ? `/individual/${experience}/${segment}` : `/individual/${experience}`;
}
