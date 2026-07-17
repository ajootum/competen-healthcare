"use client";

import Link from "next/link";
import { MatchAudit, CONCURRENT_SECTIONS } from "../shared";

// Concurrent audit — the assessor independently assesses the same patient and
// compares findings against the nurse's documentation, item by item.

export default function ConcurrentAuditPage() {
  return (
    <div className="max-w-4xl">
      <div className="mb-6">
        <Link href="/dashboard/audit" className="text-[11px] font-semibold text-teal-600 hover:underline">
          ← Clinical Competency Assessment
        </Link>
        <h1 className="text-xl font-bold text-gray-900 mt-1">Concurrent Audit</h1>
        <p className="text-gray-400 text-sm mt-0.5">Compare the nurse&apos;s documented findings against your own independent assessment · 51 items.</p>
      </div>

      <MatchAudit
        sections={CONCURRENT_SECTIONS}
        title="Concurrent Nursing Audit"
        description="51 assessment items · Mark each finding as Match / No Match / Partial"
        howToUse="The nurse has assessed the patient and documented their findings. You (the assessor) now independently assess the same patient. For each item, compare the nurse's documented finding against your own finding and mark whether they match."
        yesLabel="Match"
        noLabel="No Match"
        partialLabel="Partial"
        assesseeLabel="Nurse"
        infoFields={[
          { key: "nurse",    label: "Nurse Being Audited",     placeholder: "Full name" },
          { key: "assessor", label: "Assessor",                placeholder: "Full name" },
          { key: "unit",     label: "Unit / Ward",             placeholder: "e.g. Medical Ward" },
          { key: "date",     label: "Date",                    placeholder: "DD/MM/YYYY" },
          { key: "coworker", label: "Co-worker Number",        placeholder: "Staff ID" },
          { key: "patient",  label: "Patient (de-identified)", placeholder: "e.g. Bed 3, Rm 7" },
        ]}
      />
    </div>
  );
}
