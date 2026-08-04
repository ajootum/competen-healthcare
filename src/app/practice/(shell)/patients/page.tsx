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
    // THE CANVAS IS WHAT MAKES A WHITE CARD READ AS A CARD. Against a white page the borders were doing
    // all the work alone, which is why the comp's layered look did not survive the build. --cp-canvas is
    // the off-white the design system already defines for exactly this; the negative margin cancels the
    // shell's own padding so the tint reaches the edges, and the p-5 puts it back inside.
    <div className="-m-5 min-h-full bg-[var(--cp-canvas)] p-5">
      {/* CONTAINED, NOT FULL-BLEED. On a wide monitor an unconstrained grid stretched every field to
          about 1,500px -- a first-name box the width of a desk -- and pushed the context panel off the
          edge of the screen. The comp is plainly a contained layout; these are its measurements.

          The rail STICKS, because it is the operational picture: who is waiting is worth seeing while
          you are half-way down a registration form, which is the only reason to put it beside the form
          rather than above it. */}
      <div className="mx-auto grid w-full max-w-[1400px] xl:grid-cols-[minmax(0,1fr)_340px] gap-4 items-start">
      <RegistryConsole
        canCreate={hasCapability(shell.ctx, "patient.create")}
        workspace={workspace}
      />
      <div className="xl:sticky xl:top-4">
        <ContextPanel w={workspace} />
      </div>
    </div>
    </div>
  );
}
