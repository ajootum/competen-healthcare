import ConfigPlaceholder from "../ConfigPlaceholder";

export const dynamic = "force-dynamic";

// Competency & Readiness config (UMW-WFM-009 §11).
export default function CompetencyConfig() {
  return <ConfigPlaceholder
    title="Configuration · Competency & Readiness"
    subtitle="Role/unit/shift competency requirements, expiry, equivalence and supervision."
    banner="Competency deployment-requirement mappings + readiness thresholds need a competency-mapping store. The Competency Framework/Assessment/Passport engines are authoritative for competency content, evidence and award status — UMW-WFM-009 stores deployment mappings and policy thresholds (§11). Competency currency drives Readiness (WFM-007) today."
    sections={[
      { heading: "Configuration (§11)", items: ["Requirement mapping (role/unit/shift/task)", "Requirement level (mandatory/conditional/…)", "Validity + grace period", "Equivalence", "Supervision requirement", "Cross-skilling pathway", "Deployment restriction", "Emergency override", "Readiness score weights"] },
      { heading: "Widget (CFG-CMP-01)", items: ["Competency requirement matrix", "Mandatory / conditional", "Bulk edit", "Import", "Simulate"] },
      { heading: "Safeguard", items: ["Legally-invalid credential can't be operationally overridden", "Emergency override needs named authority + post-event review"] },
    ]}
    footer="Competency & Readiness config (UMW-WFM-009 §11) — next-phase pending a competency-mapping store."
  />;
}
