import Link from "next/link";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/server";
import { resolvePracticeShell } from "@/lib/practice/shell";
import { hasCapability } from "@/lib/practice/access";
import { taskBoard, listMembers, listNotifications } from "@/lib/practice/tasks";
import { workspaceClock } from "@/lib/practice/practice-time";
import TaskBoard from "./TaskBoard";

// /practice/tasks -- CPR-340's board and in-app feed.
//
// YOURS FIRST. A shared list sorted by date buries your own three items under a colleague's thirty, and
// the person opening this page is trying to answer "what do I have to do", not "what does the practice
// have to do". The practice-wide view is below, not above.
//
// NOTHING ON THIS PAGE WAS SENT TO ANYBODY. Notifications are in-app and in-practice: there is no email,
// no SMS and no patient messaging behind any of it, and the page says so rather than leaving a reader to
// assume the reassuring version.

export const dynamic = "force-dynamic";

export default async function TasksPage() {
  const shell = await resolvePracticeShell();
  if (shell.state !== "READY") redirect("/practice");
  if (!hasCapability(shell.ctx, "task.view")) redirect("/practice/home");

  const admin = createAdminClient();
  const [board, members, notifications, { today, timezone }] = await Promise.all([
    taskBoard(admin, shell.ctx.workspaceId, shell.ctx.userId),
    listMembers(admin, shell.ctx.workspaceId),
    listNotifications(admin, shell.ctx.workspaceId, shell.ctx.userId),
    workspaceClock(admin, shell.ctx.workspaceId),
  ]);

  return (
    <div className="max-w-5xl">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <h1 className="text-xl font-bold text-gray-900">Tasks</h1>
        <p className="text-[12px] text-gray-400">{today} · {timezone}</p>
      </div>
      <p className="mt-0.5 text-[13px] text-gray-500">
        Operational work: chasing, ordering, filing. A commitment to see a patient again is a{" "}
        <Link href="/practice/follow-ups" className="font-semibold text-[var(--cp-primary-deep)] hover:underline">follow-up</Link>,
        not a task &mdash; it belongs in their record.
      </p>

      <TaskBoard
        board={board}
        members={members}
        notifications={notifications}
        me={shell.ctx.userId}
        canManage={hasCapability(shell.ctx, "task.manage")}
      />
    </div>
  );
}
