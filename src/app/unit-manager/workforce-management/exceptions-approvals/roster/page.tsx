import ExceptionCategory from "../ExceptionCategory";

export const dynamic = "force-dynamic";

// Roster & Shift Change Approvals (UMW-WFM-006 §14).
export default function RosterShiftChanges() {
  return <ExceptionCategory title="Exceptions & Approvals · Roster & Shift" subtitle="Post-publication roster changes, swaps and shift-change approvals." exTabs={["roster"]} apprCats={[]} note="An approved roster exception creates a new roster version rather than overwriting the approved roster (BR-EXA-006). Shift-swap validation (availability, competency, rest, coverage, fairness) runs through Roster Governance (UMW-WFM-004)." />;
}
