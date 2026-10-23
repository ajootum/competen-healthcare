// ── ONE PROGRESS SHAPE FOR COMPETEN INDIVIDUAL ── Holdings-level, COMPETEN-SCHOLAR-01 S5 ──────────────────────
//
// The measure model Scholar's Learning Intelligence introduced (src/lib/individual/scholar/intelligence.ts),
// lifted to Holdings level so Competen Professional (IND-007) reports competency coverage in the same shape,
// with the same three states and the same honesty rules. One shape, so a Passport, a page or a later report
// can read either experience's progress without translating.
//
// ⚠ A MEASURE THE DATA DOES NOT SUPPORT IS NOT SHOWN AS ONE. Every measure is exactly one of:
//   measured      the figures, from enough data to mean something
//   insufficient  some data, too little to say: how much there is (have) and how much is needed (need)
//   not_measured  nothing to measure, or a source that is not connected -- with the reason
// A blank reads as a defect and a zero reads as a measurement. Neither is ever used for "unknown".
//
// ⚠ COVERAGE IS "TOUCHED", NEVER "ACHIEVED". A competency is covered when the experience has evidence of the
// person engaging with it (Scholar: an answered practice question mapped to it by an ACCEPTED map; Professional:
// whatever record IND-007 counts). `positive` is the experience's own "it went well" (Scholar: right on the latest
// try). Neither is a competence decision, and nothing here may be labelled as one.
//
// Pure: no I/O, no clock.

export type Insufficient = { state: "insufficient"; have: number; need: number; reason: string };
export type NotMeasured = { state: "not_measured"; reason: string };
/** A measure: its figures when measured, or why not. */
export type Measure<T extends object> = ({ state: "measured" } & T) | Insufficient | NotMeasured;

export const notMeasured = (reason: string): NotMeasured => ({ state: "not_measured", reason });
export const insufficient = (have: number, need: number, reason: string): Insufficient => ({ state: "insufficient", have, need, reason });

/** Words a page may use for the two non-measured states. The experience supplies its own noun ("practice", "evidence"). */
export const absentLabel = (m: Insufficient | NotMeasured, noun = "practice"): string =>
  m.state === "insufficient" ? `Too little ${noun} to say` : "Not measured";

/** A competency coverage reads: the S1 catalogue row, in the form both experiences share. */
export type CoverageCompetency = {
  id: string;
  name: string;
  frameworkName: string;
  /** The level the framework expects (S1 expectedLevel), or null when it sets none. Orders the gaps. */
  expectedLevel?: { score: number; label: string } | null;
};

/** Per competency: how much evidence of engagement, and how much of it went well. */
export type CompetencyEvidence = { evidence: number; positive: number };

export type CoverageFigures = {
  /** The catalogue name(s) the coverage is against. */
  framework: string;
  total: number;
  /** Competencies with at least one piece of evidence. */
  covered: number;
  /** Competencies with at least one positive piece of evidence. */
  coveredPositive: number;
  /** Not yet covered, highest expected level first, then by name. */
  gaps: { id: string; name: string; expected: string | null }[];
  rows: { id: string; name: string; evidence: number; positive: number; expected: string | null }[];
};
export type CompetencyCoverage = Measure<CoverageFigures>;

/** Why coverage could not be measured, in the order they are checked. */
export const COVERAGE_REASON = {
  unreadable: "Competency information could not be read just now.",
  noCatalogue: "No competency framework is connected yet.",
  noEvidenceSource: "Your records are not yet linked to competencies.",
  emptyCatalogue: "Your competency framework lists no competencies.",
} as const;

/**
 * Pure: coverage of a catalogue from per-competency evidence. `catalogue` null = no framework connected;
 * `evidence` null = the experience's links to competencies are not available yet; `unreadable` = a source read
 * did not complete. Each is Not measured with its reason -- never computed from a partial read.
 */
export function buildCompetencyCoverage(input: {
  catalogue: readonly CoverageCompetency[] | null;
  evidence: ReadonlyMap<string, CompetencyEvidence> | null;
  unreadable?: boolean;
  reasons?: Partial<Record<keyof typeof COVERAGE_REASON, string>>;
}): CompetencyCoverage {
  const why: Record<keyof typeof COVERAGE_REASON, string> = { ...COVERAGE_REASON, ...input.reasons };
  if (input.unreadable) return notMeasured(why.unreadable);
  if (input.catalogue === null) return notMeasured(why.noCatalogue);
  if (input.evidence === null) return notMeasured(why.noEvidenceSource);
  if (input.catalogue.length === 0) return notMeasured(why.emptyCatalogue);
  const ev = input.evidence;
  const rows = input.catalogue.map(c => {
    const e = ev.get(c.id) ?? { evidence: 0, positive: 0 };
    return { id: c.id, name: c.name, evidence: e.evidence, positive: e.positive, expected: c.expectedLevel?.label ?? null, score: c.expectedLevel?.score ?? -1 };
  });
  return {
    state: "measured",
    framework: [...new Set(input.catalogue.map(c => c.frameworkName))].join(", "),
    total: rows.length,
    covered: rows.filter(r => r.evidence > 0).length,
    coveredPositive: rows.filter(r => r.positive > 0).length,
    gaps: rows.filter(r => r.evidence === 0).sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
      .map(r => ({ id: r.id, name: r.name, expected: r.expected })),
    rows: rows.map(r => ({ id: r.id, name: r.name, evidence: r.evidence, positive: r.positive, expected: r.expected })),
  };
}
