// ── STANDARD STAGE CATEGORIES ── SCHOLAR-INTELLIGENCE-COMPLETE-01 (owner GO 31 Oct 2026) ─────────────────────────────
//
// Profession-neutral names for the shape of a clinical reasoning case, in the order a clinician usually meets them.
// OPTIONAL everywhere: a stage may carry one `category`, a case may use some, all or none of them, and no category is
// ever forced (a case whose stages carry none is exactly as valid as it was). This file has no server-only imports so
// the browser (the Studio editor) and the server (blueprint.ts) read the same list.

export const STAGE_CATEGORIES = [
  "presenting_complaint", "history", "assessment", "investigations", "interpretation", "differentials", "management", "reflection",
] as const;
export type StageCategory = (typeof STAGE_CATEGORIES)[number];

export const STAGE_CATEGORY_LABEL: Record<StageCategory, string> = {
  presenting_complaint: "Presenting complaint",
  history: "History",
  assessment: "Assessment",
  investigations: "Investigations",
  interpretation: "Interpretation",
  differentials: "Differentials",
  management: "Management",
  reflection: "Reflection",
};

export const isStageCategory = (v: unknown): v is StageCategory => typeof v === "string" && (STAGE_CATEGORIES as readonly string[]).includes(v);

/** The kinds of finding a case holds. `investigation` is new (a test or study requested); the rest are unchanged. */
export const CASE_FACT_KINDS = ["history", "observation", "examination", "investigation", "result", "context"] as const;

/** Caps for the optional reasoning sections (validated in blueprint.ts, shown in the Studio editor). */
export const REASONING_CAPS = { differentials: 12, differentialLabel: 120, differentialReasoning: 1000, managementPrinciples: 12, managementPrinciple: 500, expectedReasoning: 4000, reason: 1000 } as const;
