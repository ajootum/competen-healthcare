import ExceptionCategory from "../ExceptionCategory";

export const dynamic = "force-dynamic";

// Competency & Credential Exceptions (UMW-WFM-006 §18).
export default function CompetencyCredentialExceptions() {
  return <ExceptionCategory title="Exceptions & Approvals · Competency & Credential" subtitle="Requests involving competency, authorisation or credential limitations." exTabs={[]} apprCats={["competency"]} note="A legally invalid licence or prohibited scope of practice must NOT be overridable through a normal operational approval (§18.2 / BR-EXA-010). Competency readiness gaps are surfaced by Team Assignments and Roster Governance." />;
}
