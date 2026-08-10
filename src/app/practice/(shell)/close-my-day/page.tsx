import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/server";
import { resolvePracticeShell } from "@/lib/practice/shell";
import { hasCapability } from "@/lib/practice/access";
import { toCompleteQueue } from "@/lib/practice/capture-later";
import { workspaceClock } from "@/lib/practice/practice-time";
import CloseMyDayConsole, { type QueueRow } from "./CloseMyDayConsole";

// /practice/close-my-day -- CPR-ADOPT-001 section 3.
//
// "Review and complete what needs your attention." The engines behind this shipped first and nothing called
// them, which is the pattern this project keeps having to fix -- so this is the screen, and it renders only
// what the engines can actually answer.
//
// ⚠ THE THREE STATES ARE NOT DECORATION HERE. An unreadable queue must never render as an empty one: a
// practitioner told there is nothing left to close will go home. `queue.ok === false` produces a stated
// failure, not a tick.
export const dynamic = "force-dynamic";

export default async function CloseMyDayPage() {
  const shell = await resolvePracticeShell();
  // ⚠ THE STATE CHECK COMES FIRST AND IS NOT OPTIONAL. ShellState is a union whose other members carry no
  // context at all -- AUTH_REQUIRED, MFA_REQUIRED, SESSION_REVOKED and the rest. Reading ctx without
  // narrowing is how a page renders for somebody the shell had already refused.
  if (shell.state !== "READY") redirect("/practice");
  if (!hasCapability(shell.ctx, "encounter.list")) redirect("/practice/home");

  const admin = createAdminClient();
  const workspaceId = (shell.ctx as { workspaceId: string }).workspaceId;
  const clock = await workspaceClock(admin, workspaceId);
  const queue = await toCompleteQueue(admin, { workspaceId });

  // ⚠ NAMES ARE RESOLVED SEPARATELY AND A MISSING ONE IS SAID, NOT GUESSED. An id rendered where a name
  // should be is unusable, and a blank is worse -- it reads as a patient with no name rather than a lookup
  // that did not complete. `display_name` is the column: this table has no `name`, and reading the wrong one
  // returns nothing while erroring nowhere.
  let names = new Map<string, string>();
  let namesFailed = false;
  if (queue.ok && queue.items.length) {
    const ids = [...new Set(queue.items.map(i => i.patientId).filter(Boolean))];
    const { data, error } = await admin
      .from("practice_patient").select("id, display_name").in("id", ids).limit(500);
    if (error) namesFailed = true;
    else names = new Map(((data ?? []) as { id: string; display_name: string | null }[])
      .map(p => [p.id, p.display_name ?? ""]));
  }

  const rows: QueueRow[] = queue.ok
    ? queue.items.map(i => ({
        encounterId: i.encounterId,
        patientName: names.get(i.patientId) || null,
        seenAt: i.seenAt,
        status: i.status,
        captureMode: i.captureMode,
        deferredReason: i.deferredReason,
      }))
    : [];

  return (
    <CloseMyDayConsole
      rows={rows}
      queueFailed={queue.ok ? null : queue.message}
      truncated={queue.ok ? queue.truncated : false}
      namesFailed={namesFailed}
      today={clock.today}
      canEdit={hasCapability(shell.ctx, "encounter.edit")}
    />
  );
}
