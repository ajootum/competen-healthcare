import DevPlaceholder from "../DevPlaceholder";

export const dynamic = "force-dynamic";

// Succession & Talent Pipeline (UMW-WFM-007 §19).
export default function Succession() {
  return <DevPlaceholder
    title="Development & Readiness · Succession & Talent Pipeline"
    subtitle="Continuity for critical roles."
    banner="Succession & talent-pipeline data needs a talent/succession store and is SENSITIVE — access must be limited to authorised management/HR and must not appear in staff-facing screens (§19.4 / BR-WDR-017). Shown honestly as reference until the store + access controls are built."
    sections={[
      { heading: "Critical roles (§19.1)", items: ["Unit Manager", "Shift Supervisor", "ICU lead", "Theatre lead", "Educator", "Assessor", "Preceptor", "Resuscitation lead", "Infection-prevention lead", "Medication-safety lead"] },
      { heading: "Succession readiness (§19.2)", items: ["Ready now", "Ready ≤3 months", "Ready ≤6 months", "Ready ≤12 months", "Development required", "Potential identified", "Not currently suitable", "Not assessed"] },
      { heading: "Pipeline fields (§19.3)", items: ["Potential future role", "Key strengths", "Competency gaps", "Leadership indicators", "Development actions", "Mentor", "Review date", "Mobility preference", "Succession priority"] },
    ]}
    footer="Succession & Talent Pipeline (UMW-WFM-007 §19) — next-phase pending a talent/succession store with access controls."
  />;
}
