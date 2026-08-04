import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/server";
import { resolvePracticeShell } from "@/lib/practice/shell";
import { hasCapability } from "@/lib/practice/access";
import { registrationWorkspace } from "@/lib/practice/registration-workspace";
import RegistryConsole from "./RegistryConsole";
import ContextPanel from "./ContextPanel";

// /practice/patients -- CPR-REG-002 v4, the Patient Registration workspace.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// ALMOST ALL OF THIS IS COMPOSED FROM WHAT ALREADY EXISTS. Search and duplicate detection (mig 193),
// multiple hospital identifiers (222), guardians and next of kin (221), configurable fields (223), name
// parts and register-and-book (225), the diary and the waiting queue (192). Migration 226 added only
// the two things the screen leads with that had nowhere to go: a queue entry that can name its patient,
// and a draft.
//
// STILL SEARCH-FIRST, AND STILL NO BROWSABLE LIST. That is s5's own principle -- "search before
// registration to minimise duplicate patients" -- and a list of everybody is a data export, which is a
// governed problem rather than a workspace surface.
//
// THE OPERATIONAL PANEL LOADS ON THE SERVER, so the queue and today's clinic are in the first paint
// rather than arriving after a spinner at a desk with somebody standing in front of it.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

export const dynamic = "force-dynamic";

export default async function PatientsPage() {
  const shell = await resolvePracticeShell();
  if (shell.state !== "READY") redirect("/practice");
  if (!hasCapability(shell.ctx, "patient.list")) redirect("/practice/home");

  const workspace = await registrationWorkspace(createAdminClient(), shell.ctx);

  return (
    <div className="grid xl:grid-cols-[minmax(0,1fr)_320px] gap-4 items-start">
      <RegistryConsole
        canCreate={hasCapability(shell.ctx, "patient.create")}
        workspace={workspace}
      />
      <ContextPanel w={workspace} />
    </div>
  );
}
