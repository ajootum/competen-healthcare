/* eslint-disable @typescript-eslint/no-explicit-any */

// ── WHERE COMPETENCY FACTS COME FROM ── COMPETEN-SCHOLAR-01 S5, coded against S1 and S2 ────────────────────
//
// Competency coverage needs two facts Scholar does not own:
//
//   S1  the competencies a person studies against -- the layered framework catalogue (IND-007's read API)
//   S2  which competency each practice question exercises -- the per-question/chunk mappings (IND-004)
//
// Learning Intelligence reads both through these two interfaces and nothing else, so it can be built and
// tested before either exists. Until a source is plugged in, it answers `value: null` -- "not available",
// which is NOT an empty list -- and coverage renders as Not measured, with the reason. A failed read is
// `ok: false`, never an empty answer: a measure must not be computed from a read that did not complete.

export type CompetencyRef = {
  id: string;
  /** The framework's own code for it, when it has one. */
  code: string | null;
  name: string;
  frameworkId: string;
  frameworkName: string;
};

export type QuestionCompetency = { questionId: string; competencyId: string };

export type SourceRead<T> = { ok: true; value: T | null } | { ok: false };

/** S1: the competencies this person studies against, or null while no catalogue is available to them. */
export interface CompetencyCatalogueSource {
  readonly name: string;
  competenciesFor(admin: any, userId: string): Promise<SourceRead<CompetencyRef[]>>;
}

/** S2: which competency each of these questions exercises, or null while questions are not mapped. */
export interface CompetencyMappingSource {
  readonly name: string;
  mappingsFor(admin: any, userId: string, questionIds: readonly string[]): Promise<SourceRead<QuestionCompetency[]>>;
}

/** The placeholders in force until S1 and S2 are plugged in. They say "not available", never "none". */
export const NO_CATALOGUE: CompetencyCatalogueSource = {
  name: "none (S1 not yet connected)",
  competenciesFor: async () => ({ ok: true, value: null }),
};
export const NO_MAPPINGS: CompetencyMappingSource = {
  name: "none (S2 not yet connected)",
  mappingsFor: async () => ({ ok: true, value: null }),
};

/**
 * The sources Learning Intelligence uses. Plugging in S1 or S2 is replacing one entry here, and nothing
 * else changes: the measures, insights and page already handle a real answer.
 */
export const COMPETENCY_SOURCES: { catalogue: CompetencyCatalogueSource; mappings: CompetencyMappingSource } = {
  catalogue: NO_CATALOGUE,
  mappings: NO_MAPPINGS,
};
