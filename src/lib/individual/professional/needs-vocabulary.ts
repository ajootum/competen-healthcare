// ── DEVELOPMENT NEEDS VOCABULARY ── COMPETEN-PROFESSIONAL-NEEDS-01, Professional Stage 2, migration 470 ──────────
//
// ⚠ THIS MODULE IMPORTS NOTHING (the constants-file rule). policy.ts, pages, routes, tests and harnesses read it.
//
// ⚠ A NEED IS NOT A DEFICIENCY. Every word here describes something a person WANTS to develop. Nothing names a
// gap, a failure or a lack of competence, and no default names a country or a profession (owner GO s12).

/** 470's stages. Not a sequence: any stage may follow any other. addressed is 373 "met", deferred and retired
 *  are 373 "closed", every other stage is "open" -- the 470 trigger keeps the two in step. */
export const NEED_STAGES = ["identified", "exploring", "prioritised", "in_development", "addressed", "deferred", "retired"] as const;
export type NeedStage = (typeof NEED_STAGES)[number];
export const NEED_STAGE_LABEL: Record<NeedStage, string> = {
  identified: "Identified",
  exploring: "Exploring",
  prioritised: "Prioritised",
  in_development: "In development",
  addressed: "Addressed",
  deferred: "Deferred",
  retired: "Retired",
};
/** The workspace groups (owner GO N1). */
export const STAGE_GROUP: Record<NeedStage, "active" | "exploring" | "prioritised" | "in_development" | "closed"> = {
  identified: "active", exploring: "exploring", prioritised: "prioritised", in_development: "in_development",
  addressed: "closed", deferred: "closed", retired: "closed",
};
export const isNeedStage = (v: unknown): v is NeedStage => typeof v === "string" && (NEED_STAGES as readonly string[]).includes(v);

/** 470's origins: where a need came from. One record, whatever the source (owner GO N3). */
export const NEED_SOURCES = [
  ["self_identified", "My own idea"],
  ["reflection", "A reflection"],
  ["aspiration", "A career aspiration"],
  ["competency_exploration", "Exploring competencies"],
  ["feedback", "Feedback from a colleague, mentor or manager"],
  ["evaluation", "An evaluation or assessment"],
  ["learning_discovery", "Something I came across in learning"],
  ["scholar_learning", "My earlier study"],
  ["passport_gap", "A competency on my Passport"],
] as const;
export type NeedSource = (typeof NEED_SOURCES)[number][0];
export const NEED_SOURCE_LABEL: Record<string, string> = Object.fromEntries(NEED_SOURCES);
/** Sources a person picks on the form. reflection, aspiration and passport_gap are set by the flow that creates them. */
export const PICKABLE_SOURCES: readonly NeedSource[] = ["self_identified", "competency_exploration", "feedback", "evaluation", "learning_discovery", "scholar_learning"];

/** How a need was created (470 created_via). Shown so a person can always tell their own words from a suggestion's. */
export const CREATED_VIA_LABEL: Record<string, string> = {
  person: "Recorded by you",
  ai_suggestion: "From an AI suggestion you accepted",
  rule_suggestion: "From a suggestion you accepted",
};

/** Optional form fields. The title ("What would you like to develop?") is the only required one. */
export const NEED_FIELDS = ["why", "source", "motivation", "priority", "category", "context", "interests", "competencies", "reflection"] as const;
export type NeedField = (typeof NEED_FIELDS)[number];
export const NEED_FIELD_LABEL: Record<NeedField, string> = {
  why: "Why it matters to you",
  source: "Where it came from",
  motivation: "What motivates you",
  priority: "Priority",
  category: "Category",
  context: "Professional context",
  interests: "Development interests",
  competencies: "Relevant competencies",
  reflection: "Personal reflection",
};

export type Option = { code: string; label: string };

/** Defaults while HQ has published none. Neutral across professions. */
export const DEFAULT_NEED_PRIORITIES: readonly Option[] = [
  { code: "high", label: "High" },
  { code: "medium", label: "Medium" },
  { code: "low", label: "Low" },
];
export const DEFAULT_NEED_CATEGORIES: readonly Option[] = [
  { code: "clinical-practice", label: "Clinical or professional practice" },
  { code: "communication", label: "Communication and relationships" },
  { code: "leadership", label: "Leadership and management" },
  { code: "education", label: "Education and teaching" },
  { code: "research", label: "Research and evidence" },
  { code: "digital", label: "Digital and technology" },
  { code: "wellbeing", label: "Wellbeing and resilience" },
  { code: "other", label: "Other" },
];
export const DEFAULT_NEED_MOTIVATIONS: readonly Option[] = [
  { code: "patient-care", label: "Better care for the people I serve" },
  { code: "career", label: "Career progression" },
  { code: "interest", label: "Personal interest" },
  { code: "feedback", label: "Feedback I received" },
  { code: "role-change", label: "A new or changing role" },
  { code: "renewal", label: "Registration or licence renewal" },
];
export const DEFAULT_REFLECTION_TEMPLATES: readonly Option[] = [
  { code: "experience", label: "What happened, what I learned, and what I want to develop" },
  { code: "feedback", label: "Feedback I received and what I make of it" },
  { code: "challenge", label: "A situation I found challenging" },
  { code: "aspiration", label: "Where I want my practice to go" },
];

/** Ways to develop that need no course (owner GO N6). Shown as ideas, never required. */
export const DEVELOPMENT_ACTIVITIES = [
  "Mentorship or coaching",
  "Learning at work, such as shadowing or supervised practice",
  "Independent study and reading",
  "Research or audit",
  "Teaching others",
  "A workshop, conference or programme",
] as const;

/** Suggestion decisions (470). */
export const SUGGESTION_DECISIONS = ["accepted", "dismissed", "deferred"] as const;
export type SuggestionDecision = (typeof SUGGESTION_DECISIONS)[number];

/** Every table 470 creates. */
export const NEEDS_TABLES = ["individual_professional_reflection", "individual_professional_need_history", "individual_professional_need_competency",
  "individual_professional_goal_need", "individual_professional_need_suggestion"] as const;
