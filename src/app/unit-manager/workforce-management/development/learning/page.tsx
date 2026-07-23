import DevPlaceholder from "../DevPlaceholder";

export const dynamic = "force-dynamic";

// Mandatory Learning (UMW-WFM-007 §13).
export default function MandatoryLearning() {
  return <DevPlaceholder
    title="Development & Readiness · Mandatory Learning"
    subtitle="Operational compliance with required learning."
    banner="Mandatory learning compliance needs a learning-records store (completion, due dates, reassessment, exemptions). Shown honestly rather than fabricated. Mandatory learning completion does not automatically confer clinical competency (BR-WDR-003); formal waivers route through Exceptions & Approvals (UMW-WFM-006)."
    sections={[
      { heading: "Learning categories (§13.1)", items: ["Organisation mandatory", "Unit mandatory", "Role mandatory", "Regulatory", "Accreditation", "Safety-critical", "Annual update", "Infection prevention", "Medication safety", "Emergency preparedness"] },
      { heading: "Learning statuses (§13.3)", items: ["Current", "Due soon", "In progress", "Overdue", "Failed", "Exempt", "Not assigned", "Evidence pending", "Renewal required"] },
      { heading: "Manager actions (§13.4)", items: ["Assign learning", "Set due date", "Request reassignment", "Approve extension", "Request evidence", "Refer remediation", "Restrict assignment", "Escalate non-compliance"], note: "Assigning learning integrates with the Educator Workspace (next-phase)." },
    ]}
    footer="Mandatory Learning (UMW-WFM-007 §13) — next-phase pending a learning-records store."
  />;
}
