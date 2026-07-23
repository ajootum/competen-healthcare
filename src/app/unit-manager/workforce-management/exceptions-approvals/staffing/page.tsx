import ExceptionCategory from "../ExceptionCategory";

export const dynamic = "force-dynamic";

// Staffing Exceptions (UMW-WFM-006 §13).
export default function StaffingExceptions() {
  return <ExceptionCategory title="Exceptions & Approvals · Staffing" subtitle="Staffing-level deviations and staffing approval requests." exTabs={[]} apprCats={["staffing"]} note="Staffing exceptions (below-minimum, critical-role vacancy, skill-mix deficit, unavailable supervisor) also surface as replacement and roster exceptions in their own tabs. Required assessment (headcount, competency coverage, census, acuity) draws on the Staffing Engine." />;
}
