import { redirect } from "next/navigation";
import { resolvePracticeShell } from "@/lib/practice/shell";
import { hasCapability } from "@/lib/practice/access";
import ImportClient from "./ImportClient";

// /practice/patients/import -- CPR-IMP-001, bulk patient import.
//
// The QuickActions row on the Patients workspace carried "Import patients" DISABLED from the day the
// screen shipped, with the reason on it: there was no bulk endpoint, and improvising one that skipped
// duplicate detection would fill a register with duplicates. This page is that endpoint existing.
// The refusal came off the row in the same commit that added this route.
//
// Everything on this page is words and a file box; every judgement lives in patient-import.ts, which
// itself defers to the registration engines. See the spec for the two settled decisions (skip
// duplicates + report, register-even-when-the-appointment-fails + report).

export const dynamic = "force-dynamic";

export default async function PatientImportPage() {
  const shell = await resolvePracticeShell();
  if (shell.state !== "READY") redirect("/practice");
  if (!hasCapability(shell.ctx, "patient.create")) redirect("/practice/patients");

  return <ImportClient />;
}
