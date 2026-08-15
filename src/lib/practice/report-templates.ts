// CPR-PI-001 v2 s12 -- THE REPORT TEMPLATE CATALOGUE.
//
// ⚠ THIS MODULE IMPORTS NOTHING (constants-file rule: the client area and the harness both read it).
//
// The ten core templates are s12's list VERBATIM, plus the financial entry s12 makes conditional on
// "a governed financial module" -- which exists (CPR-PAY-001), so it is present and gated by its own
// capability rather than hidden. Every template names the capability that opens it and the registry
// entries its headline figures come from; a template whose figures predate the registry carries an
// empty list and its sections speak their own formulas instead (v2's older-modules rule).
//
// SCHEDULED REPORTS ARE DELIBERATELY ABSENT. s12 marks them Future/Conditional "only after
// notification/delivery permissions and destination controls are implemented" -- and this product's
// standing no-sending doctrine means that precondition does not exist yet. The screen says so.

export type ReportCategoryKey = "clinical" | "patients" | "followups" | "operations" | "financial";

export type ReportTemplateDef = {
  id: string;
  /** s12's name, verbatim. */
  name: string;
  category: ReportCategoryKey;
  blurb: string;
  /** Beyond report.view, which gates the whole surface. */
  capability: string | null;
  /** Metric registry ids the headline figures carry. Empty = pre-registry figures, formulas in-section. */
  registryIds: string[];
  state: "required" | "conditional";
};

/** s12 "Template catalogue": Clinical, Patients, Follow-up & Outcomes, Operations/Patterns; Financial conditional. */
export const REPORT_CATEGORIES: { key: ReportCategoryKey; label: string }[] = [
  { key: "clinical", label: "Clinical" },
  { key: "patients", label: "Patients" },
  { key: "followups", label: "Follow-up & Outcomes" },
  { key: "operations", label: "Operations & Patterns" },
  { key: "financial", label: "Financial" },
];

export const REPORT_TEMPLATES: ReportTemplateDef[] = [
  {
    id: "practice_summary", name: "Practice Summary", category: "operations", state: "required",
    blurb: "The period in one page: consultations, patients, follow-ups raised and closed, backlog.",
    capability: null, registryIds: ["pi.consultations_trend", "pi.avg_visits_per_patient"],
  },
  {
    id: "patient_demographics", name: "Patient Demographics", category: "patients", state: "required",
    blurb: "Who was seen: sex and age distributions, new-to-practice, registrations. Counts, no names.",
    capability: null, registryIds: [],
  },
  {
    id: "conditions", name: "Conditions", category: "clinical", state: "required",
    blurb: "Diagnoses recorded in the period, by patients and by records -- as typed, never tidied.",
    capability: null, registryIds: ["pi.top_conditions_by_patients", "pi.top_conditions_by_encounters"],
  },
  {
    id: "treatments_medications", name: "Treatments/Medications", category: "clinical", state: "required",
    blurb: "What was decided: treatment rows by type and label. Intentions, never administrations.",
    capability: null, registryIds: ["pi.treatments_recorded"],
  },
  {
    id: "investigations", name: "Investigations", category: "clinical", state: "required",
    blurb: "Requests recorded by label, with how many have been reviewed. Requested is not resulted.",
    capability: null, registryIds: ["ask.investigations_ordered"],
  },
  {
    id: "followup_completion", name: "Follow-up Completion", category: "followups", state: "required",
    blurb: "The period's cohort and its fate, the overdue backlog, and the median days to completion.",
    capability: null, registryIds: ["pi.followup_completion", "pi.median_days_followup", "pi.overdue_now"],
  },
  {
    id: "outcomes_monitoring", name: "Outcomes & Monitoring", category: "followups", state: "conditional",
    blurb: "How concluded follow-ups and performed procedures turned out -- with the uncoded share named.",
    capability: null, registryIds: [],
  },
  {
    id: "referrals", name: "Referrals", category: "clinical", state: "conditional",
    blurb: "Referrals recorded by status and destination. Recorded, not sent -- and the report says so.",
    capability: null, registryIds: ["pi.referrals_recorded"],
  },
  {
    id: "consultation_types", name: "Consultation Types", category: "operations", state: "required",
    blurb: "Consultations by mode, entry pathway and weekday, from the one shared trend.",
    capability: null, registryIds: ["pi.consultations_trend", "pi.day_of_week"],
  },
  {
    id: "location_activity", name: "Location Activity", category: "operations", state: "required",
    blurb: "Consultations by configured location, with the unplaceable disclosed, never redistributed.",
    capability: null, registryIds: ["pi.encounters_by_location"],
  },
  {
    id: "financial_summary", name: "Financial Summary", category: "financial", state: "conditional",
    blurb: "Charged, collected and received per currency -- collected is not received, and it says so.",
    capability: "billing.view", registryIds: ["fin.charged", "fin.collected", "fin.received"],
  },
];

export const reportTemplateById = (id: string): ReportTemplateDef | null =>
  REPORT_TEMPLATES.find(t => t.id === id) ?? null;

/** s12 "Quick access": practice summary; patient population; clinical activity; follow-up & outcomes;
    export data; financial only if the governed module exists. Export data is the raw CSV door, not a
    template, so it is a link on the screen rather than an entry here. */
export const QUICK_ACCESS_TEMPLATES = [
  "practice_summary", "patient_demographics", "consultation_types", "followup_completion", "financial_summary",
] as const;
