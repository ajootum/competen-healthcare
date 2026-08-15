// CPR-PI-001 v2 s6 -- THE PATIENT SEGMENT REGISTRY. "Segment definitions must be registered."
//
// ⚠ THIS MODULE IMPORTS NOTHING (constants-file rule: the screen and the harness both read it).
//
// A segment is a REGISTERED derivation over existing records -- the same discipline s14 applies to
// metrics, applied to populations. Each entry states its business meaning in a sentence a
// practitioner can read (s6: "filters must be human-readable") and names the columns it derives
// from, so a segment can never quietly mean something new. The five below are s6's own examples.
//
// COHORTS ARE FILTERS, NOT DESTINATIONS (v2 s3). A saved cohort (practice_cohort, migration 305) is
// a NAMED COMBINATION of these registered segments -- never free-form SQL, which is how a "cohort"
// becomes a query nobody can read back.

export type SegmentDef = {
  segmentId: string;
  version: number;
  displayName: string;
  /** The human-readable sentence the screen shows. What a reader may take membership to claim. */
  definition: string;
  sourceColumns: string[];
  /** Set when the segment takes a day-count parameter (s6's "configurable interval"). */
  parameterised: boolean;
  releaseState: "required" | "conditional";
  owner: string;
  /** Set when the derivation's gate FAILED: the schema allows it but nothing writes the value.
      A gate-failed segment renders as a refusal with this reason -- never as a zero population,
      which would read as a fact about patients instead of a fact about the product. */
  gateFailed?: string;
};

export const DEFAULT_NO_VISIT_DAYS = 180;

export const SEGMENT_REGISTRY: SegmentDef[] = [
  {
    segmentId: "seg.paediatric", version: 1, displayName: "Paediatric",
    definition: "Patients under 18 as at today -- by date of birth where recorded, else by the age estimate taken at registration (CPR-V2-005 allows either, and an estimate is NOT aged forward, which is said rather than hidden). Patients with neither are named as unplaceable beside the count.",
    sourceColumns: ["practice_patient.birth_date", "practice_patient.age_estimate_years"], parameterised: false,
    releaseState: "conditional", owner: "CPR-PI-001 v2 s6",
  },
  {
    segmentId: "seg.older_adult", version: 1, displayName: "Older adult",
    definition: "Patients 65 or older as at today -- by date of birth where recorded, else by the age estimate taken at registration (an estimate is NOT aged forward, which is said rather than hidden). Patients with neither are named as unplaceable beside the count.",
    sourceColumns: ["practice_patient.birth_date", "practice_patient.age_estimate_years"], parameterised: false,
    releaseState: "conditional", owner: "CPR-PI-001 v2 s6",
  },
  {
    segmentId: "seg.no_recent_visit", version: 1, displayName: "No recent visit",
    definition: "Active patients whose last recorded encounter is more than the chosen number of days ago (default 180), or who have never been seen. Absence of a visit HERE is never a claim they were not seen elsewhere.",
    sourceColumns: ["practice_patient.status", "practice_encounter.started_at"], parameterised: true,
    releaseState: "conditional", owner: "CPR-PI-001 v2 s6",
  },
  {
    segmentId: "seg.multiple_conditions", version: 1, displayName: "Multiple conditions",
    definition: "Patients with two or more DISTINCT recorded diagnosis labels, ever. Labels are counted as typed -- two spellings of one condition read as two, so this can overcount exactly where the records are untidy, and it says so.",
    sourceColumns: ["practice_diagnosis.label", "practice_diagnosis.patient_id"], parameterised: false,
    releaseState: "conditional", owner: "CPR-PI-001 v2 s6",
  },
  {
    segmentId: "seg.long_term_treatment", version: 1, displayName: "On long-term treatment",
    definition: "Patients with at least one treatment row still at status in_progress. A treatment intention nobody closed -- which is a statement about the RECORD, and the screen says so rather than calling it adherence.",
    sourceColumns: ["practice_treatment.status", "practice_treatment.patient_id"], parameterised: false,
    releaseState: "conditional", owner: "CPR-PI-001 v2 s6",
    gateFailed: "practice_treatment.status supports in_progress but NOTHING writes it yet -- recordTreatment defaults to planned and no status transition exists. Until a writer ships, this segment would render an empty population and read as a fact about patients instead of a missing feature.",
  },
];

export const segmentById = (id: string): SegmentDef | null =>
  SEGMENT_REGISTRY.find(s => s.segmentId === id) ?? null;

export const isSegmentId = (v: unknown): v is string =>
  typeof v === "string" && SEGMENT_REGISTRY.some(s => s.segmentId === v);
