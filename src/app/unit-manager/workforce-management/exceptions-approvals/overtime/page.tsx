import ExceptionCategory from "../ExceptionCategory";

export const dynamic = "force-dynamic";

// Overtime & Additional Hours (UMW-WFM-006 §15).
export default function OvertimeAdditionalHours() {
  return <ExceptionCategory title="Exceptions & Approvals · Overtime & Hours" subtitle="Overtime, additional shifts and work beyond rostered hours." exTabs={[]} apprCats={["finance", "staffing"]} note="Overtime safeguards (§15.3) prevent approval where maximum hours would be exceeded, competency isn't met, or rest can't be maintained. Hours/cost/rest-compliance detail + payroll codes need a workforce-cost store → next-phase; cost above threshold requires financial approval (BR-EXA-012)." />;
}
