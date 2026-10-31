import { productTheme } from "@/lib/design/tokens";
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
  /** One line for the experience home card (IND-007). */
  summary?: string;
  /** false: a real module page reached from another page, not from the navigation (IND-007 share). */
  nav?: false;
};

// ── THE FOUNDATION NAVIGATION ── the same five modules in both experiences ───────────────────────────
//
// Order is the sidebar order. The first four are the bottom bar on mobile; Settings sits in the account
// area there (CPR-MOB-001: the bottom bar is for destinations, not configuration).
export const FOUNDATION_NAV: readonly NavItem[] = [
  { module: "home", segment: "", label: "Home", short: "Home", icon: "⌂" },
  { module: "assistant", segment: "assistant", label: "Personal AI", short: "AI", icon: "✦" },
  { module: "passport", segment: "passport", label: "Competen Passport", short: "Passport", icon: "▣" },
  { module: "profile", segment: "profile", label: "Profile & history", short: "Profile", icon: "◉" },
  { module: "settings", segment: "settings", label: "Settings", short: "Settings", icon: "⚙" },
];

export const SCHOLAR: ExperienceConfig = {
  key: "scholar",
  name: "Competen Scholar",
  wordmark: "scholar",
  // Scholar HFE redesign (2026-10-26): the agreed prototype's teal (4.7:1 on white) and its pale tint.
  accent: productTheme.scholar.accent,
  accentSoft: productTheme.scholar.soft,
  tagline: "Learn · Understand · Apply",
  micro: "Healthcare education, revision and clinical reasoning.",
  operatingEntity: "scholar_operator",
  // COMPETEN-IND-004: the whole learning journey (Upload, Understand, Assess, Revise, Apply, Improve) sits
  // under ONE module with its own sub-navigation, so the sidebar and the bottom bar each gain one entry.
  modules: [
    { key: "study", segment: "study", label: "My Learning", short: "Study", icon: "▤", bottom: true },
  ],
  homeIntro: "Your study space. Open My Learning to upload your notes, have them explained with page citations, practise questions from them and revise what you miss. Your Passport, profile and personal AI are here too.",
  planned: [
    {
      key: "reviewed-clinical-content", label: "Reviewed clinical cases and question banks",
      summary: "Shared case scenarios and question banks written and checked by clinicians.",
      reason: "Shared clinical content needs a clinical-review record (reviewer, date and scope) before it is served to students, and that record does not exist yet. Case practice from your own notes is in My Learning.",
    },
    {
      key: "audio", label: "Audio learning",
      summary: "Listen to explanations of your notes on the move.",
      reason: "Text-to-speech of explanations is not built, so nothing can be read aloud yet.",
    },
  ],
};

export const PROFESSIONAL: ExperienceConfig = {
  key: "professional",
  name: "Competen Professional",
  wordmark: "professional",
  accent: productTheme.professional.accent,
  accentSoft: productTheme.professional.soft,
  tagline: "Develop · Demonstrate · Advance",
  micro: "Your lifelong professional development, evidence and career.",
  operatingEntity: "competen_holdings",
  // COMPETEN-IND-007. Pages under (app)/[experience]/(professional)/<segment>, each via experienceModulePage.
  modules: [
    // COMPETEN-PROFESSIONAL-PROFILE-01: the MVP's "Profession & registration", grown into the six-section profile.
    { key: "registration", segment: "registration", label: "My practice", short: "Practice", icon: "◈",
      summary: "Your professional identity: qualifications, registrations, roles, specialties and aspirations, with every earlier version kept." },
    { key: "development", segment: "development", label: "Needs & plan", short: "Plan", icon: "◎", bottom: true,
      summary: "Your development needs and the learning goals you set against them." },
    { key: "cpd", segment: "cpd", label: "Learning & CPD", short: "CPD", icon: "✎", bottom: true,
      summary: "Your learning from anywhere, your CPD log and reflections, and the CPD requirement you follow." },
    { key: "evidence", segment: "evidence", label: "Credentials & evidence", short: "Evidence", icon: "❖",
      summary: "Credentials, renewal dates and the evidence you keep of your competence." },
    // COMPETEN-PROFESSIONAL-COMPETENCY-01 (Stage 5): the competency workspace and evidence portfolio.
    { key: "competencies", segment: "competencies", label: "My competencies", short: "Competencies", icon: "◇",
      summary: "The competencies you choose to develop: expected levels, your self-assessments, your evidence and any independent verification, kept apart." },
    { key: "progress", segment: "progress", label: "Progress", short: "Progress", icon: "↗",
      summary: "Plan progress, CPD hours by year, and how much of your plan has evidence behind it." },
    // Reached from the Passport, not the navigation: experienceModulePage needs it listed, and
    // nav: false keeps navFor and bottomNavFor from showing it.
    { key: "share", segment: "share", label: "Share your Passport", short: "Share", icon: "⇪",
      summary: "A revocable, time-limited link to your Passport.", nav: false },
  ],
  homeIntro: "Your professional home: your registration, development plan, CPD and evidence. They are kept by you, and nobody else sees them unless you share them.",
  planned: [
    {
      key: "career", label: "Career & Opportunities",
      summary: "Plan your next role, speciality or leadership pathway.",
      reason: "You can record career aspirations in My practice. Pathway planning and opportunities are not built yet.",
    },
    {
      key: "verification", label: "Automatic register checks",
      summary: "Have a registration confirmed directly against a regulator's register, without waiting for a person.",
      reason: "No regulator lookup is connected. You can already ask a Competen verifier to check a record in My practice.",
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
  const own = EXPERIENCES[experience].modules.filter(m => m.nav !== false).map(m => ({ key: m.key, segment: m.segment, label: m.label, short: m.short, icon: m.icon }));
  return [...home, ...own, ...rest];
}

/** CPR-MOB-001: at most five bottom tabs -- Home, modules flagged `bottom`, then foundation to fill. Settings
 *  never sits on the bar (it lives behind the account link). */
export const BOTTOM_BAR_MAX = 5;
export function bottomNavFor(experience: ExperienceKey): ShellNavItem[] {
  const home = FOUNDATION_NAV.filter(n => n.module === "home").map(asItem);
  const own = EXPERIENCES[experience].modules.filter(m => m.bottom && m.nav !== false).map(m => ({ key: m.key, segment: m.segment, label: m.label, short: m.short, icon: m.icon }));
  const fill = FOUNDATION_NAV.filter(n => n.module !== "home" && n.module !== "settings").map(asItem);
  return [...home, ...own, ...fill].slice(0, BOTTOM_BAR_MAX);
}

/** HFE-01 D1 (owner Option A): every sidebar destination that is NOT on the phone's bottom bar, in sidebar order.
 *  The account menu lists these below md, so no destination is unreachable on a phone while the bar stays at five. */
export function overflowNavFor(experience: ExperienceKey): ShellNavItem[] {
  const onBar = new Set(bottomNavFor(experience).map(i => i.key));
  return navFor(experience).filter(i => !onBar.has(i.key));
}

/** The href of a foundation module inside an experience. */
export function experienceHref(experience: ExperienceKey, segment = ""): string {
  return segment ? `/individual/${experience}/${segment}` : `/individual/${experience}`;
}
