/* eslint-disable @typescript-eslint/no-explicit-any */
import { loadCatalogueFor, type CatalogueCompetency } from "../catalogue";

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
  /** The level the framework expects (S1 CatalogueCompetency.expectedLevel), or null when it sets none. Orders the gaps. */
  expectedLevel?: { score: number; label: string } | null;
};

export type QuestionCompetency = { questionId: string; competencyId: string };

export type SourceRead<T> = { ok: true; value: T | null } | { ok: false };

/** S1: the competencies this person studies against, or null while no catalogue is available to them. */
export interface CompetencyCatalogueSource {
  readonly name: string;
  competenciesFor(admin: any, userId: string): Promise<SourceRead<CompetencyRef[]>>;
}

/**
 * S2: which competency each of these questions exercises, or null while questions are not mapped.
 * ⚠ ACCEPTED MAPS ONLY. An adapter returns only mappings a decision has accepted (IND-004 388), never a
 * proposal alone: coverage must not count a competency on the strength of a map nobody has accepted.
 */
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

/** Pure: S1's catalogue rows as the references coverage reads. [] (nothing allowlisted) is "not available". */
export function fromCatalogue(rows: readonly CatalogueCompetency[] | null): SourceRead<CompetencyRef[]> {
  if (rows === null) return { ok: false };
  if (rows.length === 0) return { ok: true, value: null };
  return {
    ok: true,
    value: rows.map(c => ({
      id: c.competencyId, code: c.code, name: c.title, frameworkId: c.catalogue.id, frameworkName: c.catalogue.name,
      expectedLevel: c.expectedLevel ? { score: c.expectedLevel.score, label: c.expectedLevel.label } : null,
    })),
  };
}

/**
 * S1 (COMPETEN-SCHOLAR-01, #39): the Scholar catalogue allowlist (Individual policy `scholar_catalogues`)
 * applied to the shared competency library. It is per experience, not per person: every Scholar learner
 * studies against the catalogues HQ chose. null (unreadable) refuses to measure, and an empty allowlist is
 * "no framework connected" -- coverage says which.
 */
export const S1_CATALOGUE: CompetencyCatalogueSource = {
  name: "S1 Scholar catalogue (loadCatalogueFor)",
  competenciesFor: async (admin: any) => fromCatalogue(await loadCatalogueFor(admin, "scholar")),
};

/**
 * The sources Learning Intelligence uses. Plugging in S1 or S2 is replacing one entry here, and nothing
 * else changes: the measures, insights and page already handle a real answer. S2 (IND-004 388, accepted
 * maps only) follows once it is on main.
 */
export const COMPETENCY_SOURCES: { catalogue: CompetencyCatalogueSource; mappings: CompetencyMappingSource } = {
  catalogue: S1_CATALOGUE,
  mappings: NO_MAPPINGS,
};
