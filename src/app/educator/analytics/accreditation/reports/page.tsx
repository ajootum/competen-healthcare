import { requireEducatorAccess } from "@/lib/educator-access";
import SoonModule from "../SoonModule";

// Module 2 — Accreditation Reports. No accreditation-report store yet.
export const dynamic = "force-dynamic";

export default async function Reports() {
  await requireEducatorAccess();
  return (
    <SoonModule active="reports"
      note="No accreditation-report store exists yet. The report builder (draft → awaiting approval → submitted → accepted workflow), executive summaries, evidence linking and submission tracking are on the roadmap."
      kpis={["In Preparation", "Awaiting Approval", "Submitted", "Accepted", "Revision Req.", "Report Progress"]}
      needs={[
        "An accreditation-report table with lifecycle status and submission dates.",
        "Evidence-to-report linking so sections cite standards evidence.",
        "AI completeness/quality checks against the accrediting body's template.",
      ]}
      links={[["Validation analytics (CSV)", "/educator/validation-analytics"], ["Evidence review", "/educator/evidence"]]} />
  );
}
