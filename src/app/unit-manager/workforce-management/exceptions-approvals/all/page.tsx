import ExceptionCategory from "../ExceptionCategory";

export const dynamic = "force-dynamic";

// All Exceptions (UMW-WFM-006) — the full aggregated register across sources.
export default function AllExceptions() {
  return <ExceptionCategory title="Exceptions & Approvals · All Exceptions" subtitle="Every open workforce exception and approval across the suite." exTabs={null} apprCats={null} />;
}
