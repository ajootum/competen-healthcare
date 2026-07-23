import ExceptionCategory from "../ExceptionCategory";

export const dynamic = "force-dynamic";

// Escalations (UMW-WFM-006 §20).
export default function Escalations() {
  return <ExceptionCategory title="Exceptions & Approvals · Escalations" subtitle="Cases escalated for missed deadline, unresolved risk or authority limits." exTabs={["escalations"]} apprCats={[]} note="Escalation levels (§20.1): Unit Manager → Dept/Nursing Manager → Nursing Admin/Hospital Ops → HR/Finance/Quality/Clinical Governance → Executive. Overdue critical exceptions escalate automatically (BR-EXA-016). The configurable escalation hierarchy + escalated-approval routing are next-phase." />;
}
