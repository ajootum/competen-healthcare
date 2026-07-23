import ExceptionCategory from "../ExceptionCategory";

export const dynamic = "force-dynamic";

// Redeployment & Replacement Approvals (UMW-WFM-006 §17).
export default function RedeploymentReplacement() {
  return <ExceptionCategory title="Exceptions & Approvals · Redeployment" subtitle="Movement of staff between units and replacement staffing decisions." exTabs={["redeployment"]} apprCats={[]} note="A redeployment approval must evaluate the safety of BOTH releasing and receiving units (BR-EXA-014) — the workflow must not resolve one unit's shortage by creating an unsafe shortage elsewhere. Replacement requests are raised in Availability & Attendance (UMW-WFM-005)." />;
}
