import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/server";
import { resolvePracticeShell } from "@/lib/practice/shell";
import { hasCapability } from "@/lib/practice/access";
import { followUpBoard, practiceToday } from "@/lib/practice/follow-ups";
import FollowUpBoard from "./FollowUpBoard";

// /practice/follow-ups -- CPR-140's board. The screen that answers "who is waiting on me".
//
// OVERDUE IS FIRST AND IT IS NOT COLLAPSIBLE. Every other group can be scrolled past; this one is the
// reason the page exists. Sorting the whole board by date would put today's routine review above a
// biopsy result that has been sitting for three weeks.
//
// THE COUNTS ARE COMPUTED FROM THE ROWS ON THIS PAGE, never stored and never estimated. Overdue is
// derived from the due date against the PRACTICE's clock (migration 196's header explains why a stored
// OVERDUE goes quietest exactly when a practice has been least attentive).

export const dynamic = "force-dynamic";

export default async function FollowUpsPage() {
  const shell = await resolvePracticeShell();
  if (shell.state !== "READY") redirect("/practice");
  if (!hasCapability(shell.ctx, "followup.view")) redirect("/practice/home");

  const admin = createAdminClient();
  const board = await followUpBoard(admin, shell.ctx.workspaceId);

  const { data: ws } = await admin.from("practice_workspace").select("timezone").eq("id", shell.ctx.workspaceId).maybeSingle();
  const today = practiceToday(ws?.timezone);

  return (
    <div className="max-w-5xl">
      <h1 className="text-xl font-bold text-gray-900">Follow-ups</h1>
      <p className="mt-0.5 text-[13px] text-gray-500">
        What you committed to, and whether it has happened. Overdue is worked out from the due date
        against today in {ws?.timezone ?? "UTC"} &mdash; nothing has to run for something to appear here.
      </p>

      <FollowUpBoard
        board={board}
        today={today}
        canManage={hasCapability(shell.ctx, "followup.manage")}
      />
    </div>
  );
}
