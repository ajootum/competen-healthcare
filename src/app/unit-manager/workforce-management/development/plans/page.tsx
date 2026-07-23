import DevPlaceholder from "../DevPlaceholder";

export const dynamic = "force-dynamic";

// Development Plans (UMW-WFM-007 §17).
export default function DevelopmentPlans() {
  return <DevPlaceholder
    title="Development & Readiness · Development Plans"
    subtitle="Individual and group workforce-development plans."
    banner="Development plans need a development-plan store. Every development action must link to a defined readiness gap, goal or future workforce requirement (BR-WDR-007); development records preserve historical status + evidence (BR-WDR-018)."
    sections={[
      { heading: "Plan types (§17.1)", items: ["Performance development", "Competency-gap closure", "Remediation", "Role readiness", "Promotion prep", "Leadership development", "Specialist pathway", "Return-to-practice", "Cross-training", "Succession prep", "New-service prep"] },
      { heading: "Development actions (§17.3)", items: ["Course assignment", "Supervised shift", "Simulation", "OSCE", "Workplace assessment", "Coaching", "Mentoring", "Case review", "Audit participation", "Leadership assignment", "Reflective practice", "External certification"] },
      { heading: "Plan fields (§17.2)", items: ["Target role / capability", "Development need + evidence", "Goals", "Required competencies", "Assigned learning", "Assessment requirements", "Supervisor / mentor", "Target dates", "Success measures", "Readiness outcome"] },
    ]}
    footer="Development Plans (UMW-WFM-007 §17) — next-phase pending a development-plan store."
  />;
}
