import DevPlaceholder from "../DevPlaceholder";

export const dynamic = "force-dynamic";

// Cross-Training & Role Expansion (UMW-WFM-007 §18).
export default function CrossTraining() {
  return <DevPlaceholder
    title="Development & Readiness · Cross-Training & Role Expansion"
    subtitle="Prepare staff for additional units, roles or competency areas."
    banner="Cross-training pathways need a cross-training store. Cross-training must NOT automatically expand formal scope of practice (§18.3 / BR-WDR-008) — final deployment still considers validated competency, credentials, employment authorisation, unit approval and supervision."
    sections={[
      { heading: "Cross-training pathways (§18.1)", items: ["Ward → ICU support", "Ward → high-dependency", "Staff nurse → Shift Supervisor", "General → theatre recovery", "Ward → emergency response", "Nurse → assessor", "Nurse → preceptor", "Supervisor → Unit Manager pipeline"] },
      { heading: "Pathway fields (§18.2)", items: ["Home / target role", "Business need", "Eligibility", "Prerequisites", "Required competencies", "Required learning", "Practical exposure", "Supervised shifts", "Assessment status", "Target readiness date", "Current stage", "Final authorisation"] },
      { heading: "Deployment safeguards (§18.3)", items: ["Validated competency", "Credential requirements", "Employment authorisation", "Unit approval", "Supervision", "Role assignment", "Applicable policy"] },
    ]}
    footer="Cross-Training & Role Expansion (UMW-WFM-007 §18) — next-phase pending a cross-training store."
  />;
}
