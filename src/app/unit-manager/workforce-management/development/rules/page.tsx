import DevPlaceholder from "../DevPlaceholder";

export const dynamic = "force-dynamic";

// Rules & Settings (UMW-WFM-007 §32).
export default function RulesSettings() {
  return <DevPlaceholder
    title="Development & Readiness · Rules & Settings"
    subtitle="Configurable readiness rules and scoring."
    banner="Readiness rules + scoring configuration need a governance-config store. The readiness score must remain explainable and must not replace hard safety constraints (§32.2). Role/unit requirements draw on Workforce Planning Studio (WPS-001) today."
    sections={[
      { heading: "Configurable rules (§32.1)", items: ["Role requirements", "Unit requirements", "Critical competencies", "Proficiency levels", "Min competent staff count", "Mandatory learning", "Credential requirements", "Orientation pathways", "Supervision levels", "Reassessment frequency", "Readiness thresholds", "Expiry alerts"] },
      { heading: "Scoring weights (§32.2)", items: ["Competency", "Mandatory learning", "Credentials", "Orientation", "Supervision", "Experience", "Availability", "Role criticality"] },
      { heading: "Data sources (§32.3)", items: ["Competency Passport", "Learning platform", "Assessment service", "HR system", "Credentialing system", "External register", "Document upload", "Manual validation"] },
    ]}
    footer="Rules & Settings (UMW-WFM-007 §32) — next-phase pending a readiness-config store."
  />;
}
