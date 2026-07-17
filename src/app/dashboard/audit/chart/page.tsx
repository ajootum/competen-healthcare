"use client";

import Link from "next/link";
import { MatchAudit, CHART_SECTIONS } from "../shared";

// Retrospective chart audit — review a patient file for documentation
// completeness after the fact.

export default function ChartAuditPage() {
  return (
    <div className="max-w-4xl">
      <div className="mb-6">
        <Link href="/dashboard/audit" className="text-[11px] font-semibold text-teal-600 hover:underline">
          ← Clinical Competency Assessment
        </Link>
        <h1 className="text-xl font-bold text-gray-900 mt-1">Retrospective Chart Audit</h1>
        <p className="text-gray-400 text-sm mt-0.5">Review the patient file for documentation completeness · 48 criteria.</p>
      </div>

      <MatchAudit
        sections={CHART_SECTIONS}
        title="Retrospective Chart Audit"
        description="48 documentation criteria · Mark each as Yes / No / Partial"
        howToUse="Open the patient's file/chart. For each item below, check whether the nurse has documented the required finding or action. Mark Yes if fully documented, No if absent, or Partial if incomplete."
        yesLabel="Yes"
        noLabel="No"
        partialLabel="Partial"
        assesseeLabel="Nurse"
        infoFields={[
          { key: "nurse",    label: "Nurse Being Audited",    placeholder: "Full name" },
          { key: "auditor",  label: "Auditor",                placeholder: "Full name" },
          { key: "unit",     label: "Unit / Ward",            placeholder: "e.g. Surgical Ward" },
          { key: "date",     label: "Date of Audit",          placeholder: "DD/MM/YYYY" },
          { key: "file",     label: "Patient File / MRN",     placeholder: "De-identified reference" },
          { key: "admitted", label: "Admission Date",         placeholder: "DD/MM/YYYY" },
        ]}
      />
    </div>
  );
}
