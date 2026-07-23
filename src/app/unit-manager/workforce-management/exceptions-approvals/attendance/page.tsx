import ExceptionCategory from "../ExceptionCategory";

export const dynamic = "force-dynamic";

// Attendance & Leave Exceptions (UMW-WFM-006 §16) — exceptions generated from UMW-WFM-005.
export default function AttendanceLeaveExceptions() {
  return <ExceptionCategory title="Exceptions & Approvals · Attendance & Leave" subtitle="Attendance corrections, no-shows, late/early and leave conflicts." exTabs={["attendance"]} apprCats={[]} note="An attendance correction preserves the original transaction (BR-EXA-013); operational managers may report conflicts and request corrections but not change formal leave entitlement or medical detail (§16.3). Detection + correction live in Availability & Attendance (UMW-WFM-005)." />;
}
