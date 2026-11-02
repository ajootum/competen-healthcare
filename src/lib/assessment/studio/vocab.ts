// Checklist Studio: labels for closed vocabularies. Client-safe.
import type { CriticalRequirement, ResponseType, StateCode } from "../core";

export const RESPONSE_TYPE_LABEL: Record<ResponseType, string> = {
  rating_scale: "Rating scale", yes_no: "Yes / No", pass_fail: "Pass / Fail", achieved: "Achieved / Not achieved", numeric_rating: "Numeric rating",
  multiple_choice: "Multiple choice", free_text: "Free text", datetime: "Date and time", measurement: "Measurement", na: "Not applicable only", evidence: "Evidence",
};
export const CRITICAL_LABEL: Record<CriticalRequirement, string> = {
  must_be_satisfactory: "Must be satisfactory", must_be_observed: "Must be observed", auto_fail: "Automatic fail if not met", reassess: "Reassess if not met",
};
export const STATE_CODE_LABEL: Record<StateCode, string> = {
  not_assessed: "Not answered", not_observed: "Not observed", not_applicable: "Not applicable", unable_to_demonstrate: "Unable to demonstrate", unable_to_determine: "Unable to determine",
};
export const RESPONDENT_ROLES = ["self", "assessor", "auditor"] as const;
export const RESPONDENT_ROLE_LABEL: Record<(typeof RESPONDENT_ROLES)[number], string> = { self: "Self", assessor: "Assessor", auditor: "Auditor" };
/** Suggestions only. delivery_modes is free text of the pattern ^[a-z_]{3,40}$ and a product adapter owns its meaning. */
export const DELIVERY_MODE_SUGGESTIONS: { code: string; label: string }[] = [
  { code: "self_assessment", label: "Self-assessment" },
  { code: "assessor_led", label: "Assessor-led" },
  { code: "auditor_recorded", label: "Auditor-recorded" },
  { code: "ai_assisted_formative", label: "AI-assisted formative" },
];
export const MODE_PATTERN = /^[a-z_]{3,40}$/;
export const KIND_PATTERN = /^[a-z][a-z0-9_]{1,40}$/;
export const CODE_PATTERN = /^[A-Z][A-Z0-9-]{2,40}$/;

export const fmtDate = (d: string | null | undefined): string =>
  d ? new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "";
export const fmtDateTime = (d: string | null | undefined): string =>
  d ? new Date(d).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC" }) + " UTC" : "";
export const newKey = (): string => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => { const r = (Math.random() * 16) | 0; return (c === "x" ? r : (r & 0x3) | 0x8).toString(16); }));
