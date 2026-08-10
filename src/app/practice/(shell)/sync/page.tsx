import { redirect } from "next/navigation";
import { resolvePracticeShell } from "@/lib/practice/shell";
import { hasCapability } from "@/lib/practice/access";
import SyncCentre from "./SyncCentre";

// CP-OFF-UI-001 s7 — the Synchronisation Centre. CP-OFFLINE-SURVEY-001 s5 precondition 5.
//
// ⚠ A SHELL, NOT A LOADER. Everything this screen shows about the DEVICE lives in IndexedDB and can only
// be read in the browser -- no server has ever seen the outbox, and one that claimed to would be
// describing something it cannot know. The practice's side is fetched by the client from
// /api/v1/practice/sync/status. So this page resolves the shell, checks the capability, and renders.

export const dynamic = "force-dynamic";

export default async function SyncPage() {
  const shell = await resolvePracticeShell();
  if (shell.state !== "READY") redirect("/practice");
  // The same capability the sync endpoints ask for, so the screen and the API agree about who this is
  // for rather than the screen being the looser of the two.
  if (!hasCapability(shell.ctx, "encounter.list")) redirect("/practice");

  return <SyncCentre />;
}
