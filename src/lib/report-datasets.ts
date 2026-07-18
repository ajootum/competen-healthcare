// Whitelisted Report Builder datasets and their columns — the single source
// of truth shared by /api/reports/custom (query engine) and the builder UI.
// The builder can only parameterise these; there is no arbitrary-query path.

export type DatasetColumn = { key: string; label: string };

export const DATASET_LABELS: Record<string, string> = {
  assessments: "Assessments",
  learners: "Learners",
  evidence: "Evidence pipeline",
  audits: "Quality audits",
};

export const DATASET_COLUMNS: Record<string, DatasetColumn[]> = {
  assessments: [
    { key: "date", label: "Date" }, { key: "learner", label: "Learner" }, { key: "department", label: "Department" },
    { key: "assessor", label: "Assessor" }, { key: "method", label: "Method" }, { key: "competency", label: "Competency" },
    { key: "score", label: "Score" }, { key: "passing", label: "Passing" },
  ],
  learners: [
    { key: "learner", label: "Learner" }, { key: "department", label: "Department" }, { key: "decided", label: "Decided Competencies" },
    { key: "passing_pct", label: "Passing %" }, { key: "expired", label: "Expired" }, { key: "risk", label: "Risk" },
  ],
  evidence: [
    { key: "date", label: "Submitted" }, { key: "learner", label: "Learner" }, { key: "department", label: "Department" },
    { key: "status", label: "Status" }, { key: "hours_to_verify", label: "Hours to Verify" },
  ],
  audits: [
    { key: "date", label: "Date" }, { key: "type", label: "Type" }, { key: "title", label: "Title" },
    { key: "compliance", label: "Compliance %" }, { key: "met", label: "Met" }, { key: "not_met", label: "Not Met" },
    { key: "conducted_by", label: "Conducted By" },
  ],
};

/** Which filters are meaningful per dataset (UI hint; the API ignores the rest). */
export const DATASET_FILTERS: Record<string, ("dates" | "department" | "assessor")[]> = {
  assessments: ["dates", "department", "assessor"],
  learners: ["department"],
  evidence: ["dates", "department"],
  audits: ["dates", "assessor"],
};
