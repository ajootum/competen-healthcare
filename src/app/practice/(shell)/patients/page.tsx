import { redirect } from "next/navigation";
import { resolvePracticeShell } from "@/lib/practice/shell";
import { hasCapability } from "@/lib/practice/access";
import RegistryConsole from "./RegistryConsole";

// /practice/patients (CPR-V2-004 V3) -- search-first registry. The page renders EMPTY of patients by
// design: CPR-V2-004's own workflow is "enter search criteria -> ranked matches -> if no match, offer
// rapid registration". A browsable list of every patient is not a workspace surface; it is a data
// export, and those are Phase 6's governed problem.

export const dynamic = "force-dynamic";

export default async function PatientsPage() {
  const shell = await resolvePracticeShell();
  if (shell.state !== "READY") redirect("/practice");
  if (!hasCapability(shell.ctx, "patient.list")) redirect("/practice/home");

  return (
    <RegistryConsole
      canCreate={hasCapability(shell.ctx, "patient.create")}
    />
  );
}
