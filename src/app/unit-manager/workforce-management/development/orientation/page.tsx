import DevPlaceholder from "../DevPlaceholder";

export const dynamic = "force-dynamic";

// Orientation & Onboarding (UMW-WFM-007 §15).
export default function Orientation() {
  return <DevPlaceholder
    title="Development & Readiness · Orientation & Onboarding"
    subtitle="Readiness of new, transferred, returning or newly promoted staff."
    banner="Orientation pathways, milestones and manager sign-off need an orientation-pathway store. Release from orientation requires completion of configured sign-off steps (BR-WDR-009); release updates staffing eligibility."
    sections={[
      { heading: "Orientation types (§15.1)", items: ["Organisation induction", "Hospital induction", "Department orientation", "Unit orientation", "Role orientation", "Equipment orientation", "Return-to-practice", "Transfer", "Promotion", "Agency", "Student / trainee"] },
      { heading: "Pathway steps (§15.2)", items: ["Required documents", "Policy review", "Learning modules", "Unit tour", "Safety briefing", "Supervised shifts", "Competency assessments", "Preceptor sign-off", "Manager review", "Release to practice"] },
      { heading: "Release workflow (§15.4)", items: ["Requirements assigned", "Learning + supervised activities", "Competencies assessed", "Preceptor confirms", "Manager reviews evidence", "Gaps → development actions", "Released for scope", "Readiness updates"], note: "Sign-off integrates with the Assessor Workspace (next-phase)." },
    ]}
    footer="Orientation & Onboarding (UMW-WFM-007 §15) — next-phase pending an orientation-pathway store."
  />;
}
