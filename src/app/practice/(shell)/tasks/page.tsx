/* eslint-disable @typescript-eslint/no-explicit-any */
import Link from "next/link";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/server";
import { resolvePracticeShell } from "@/lib/practice/shell";
import { hasCapability } from "@/lib/practice/access";
import { taskBoard, listMembers, listNotifications } from "@/lib/practice/tasks";
import { workspaceClock } from "@/lib/practice/practice-time";
import { dailyAgenda, escalations } from "@/lib/practice/task-orchestration";
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
  const [board, members, notifications, { today, timezone }, agenda, escalated] = await Promise.all([
    taskBoard(admin, shell.ctx.workspaceId, shell.ctx.userId),
    listMembers(admin, shell.ctx.workspaceId),
    listNotifications(admin, shell.ctx.workspaceId, shell.ctx.userId),
    workspaceClock(admin, shell.ctx.workspaceId),
    dailyAgenda(admin, shell.ctx.workspaceId, shell.ctx.userId),
    escalations(admin, shell.ctx.workspaceId),
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

      {/* ── CPR-340 TODAY'S AGENDA (migration 211) ────────────────────────────────────────────────
          Composed, never stored: appointments, tasks due, reminders and follow-ups read for one day.
          An agenda table would be a fifth copy that goes stale the moment an appointment moves. */}
      <section className="mt-4 rounded-xl border border-gray-200 bg-white p-4">
        <div className="flex items-baseline gap-2 flex-wrap">
          <h2 className="text-[13px] font-bold text-gray-900">Today</h2>
          <span className="text-[11px] text-gray-500">
            {agenda.counts.appointments} booked · {agenda.counts.dueToday} due · {agenda.counts.reminders} reminders ·{" "}
            {agenda.counts.followUps} follow-ups
          </span>
          <Link href="/practice/calendar" className="ml-auto text-[11px] font-semibold text-[var(--cp-primary-deep)] hover:underline">
            The calendar →
          </Link>
        </div>
        {agenda.counts.appointments + agenda.counts.dueToday + agenda.counts.reminders + agenda.counts.followUps === 0 ? (
          <p className="mt-2 text-[12px] text-gray-400">Nothing booked and nothing due.</p>
        ) : (
          <ul className="mt-2 flex flex-col">
            {agenda.appointments.map((a: any) => (
              <li key={`a-`} className="flex items-baseline gap-2 border-b border-gray-100 py-1.5 last:border-0">
                <span className="w-12 shrink-0 font-mono text-[11px] text-gray-500">
                  {new Date(a.scheduled_at).toISOString().slice(11, 16)}
                </span>
                <span className="text-[12px] text-gray-800">{a.patient_name}</span>
                <span className="ml-auto text-[10px] text-gray-500">{String(a.appointment_type).replace(/_/g, " ")}</span>
              </li>
            ))}
            {agenda.dueToday.map((t: any) => (
              <li key={`t-`} className="flex items-baseline gap-2 border-b border-gray-100 py-1.5 last:border-0">
                <span className="w-12 shrink-0 text-[10px] font-semibold text-gray-400">due</span>
                <span className="text-[12px] text-gray-800">{t.title}</span>
                <span className="ml-auto text-[10px] text-gray-500">{t.priority}</span>
              </li>
            ))}
            {agenda.remindersToday.map((t: any) => (
              <li key={`r-`} className="flex items-baseline gap-2 border-b border-gray-100 py-1.5 last:border-0">
                <span className="w-12 shrink-0 text-[10px] font-semibold text-gray-400">nudge</span>
                <span className="text-[12px] text-gray-700">{t.title}</span>
                <span className="ml-auto text-[10px] text-gray-500">due {t.due_on}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── Escalations, derived at read time ───────────────────────────────────────────────────── */}
      {escalated.tasks.length > 0 && (
        <section className="mt-4 rounded-xl border border-[var(--cmp-color-critical)] bg-white p-4">
          <div className="flex items-baseline gap-2 flex-wrap">
            <h2 className="text-[13px] font-bold text-gray-900">Escalated</h2>
            <span className="text-[11px] text-gray-500">{escalated.tasks.length} past the threshold your practice set</span>
          </div>
          {/* The sentence this panel must not lose. */}
          <p className="mt-0.5 text-[11px] text-gray-500">
            Worked out from the clock when you opened this page. Nothing was sent and nothing fired
            overnight &mdash; which is why it is right the moment you look.
          </p>
          <ul className="mt-2 flex flex-col">
            {escalated.tasks.slice(0, 10).map((t: any) => (
              <li key={t.id} className="flex items-baseline gap-2 border-b border-gray-100 py-1.5 last:border-0">
                <span className="min-w-0">
                  <span className="block truncate text-[12px] font-semibold text-gray-800">{t.title}</span>
                  <span className="block text-[10px] text-gray-500">
                    {t.assignedToName ?? "unassigned"}
                    {t.notifyName ? ` · escalates to ` : ""}
                  </span>
                </span>
                <span className="ml-auto shrink-0 text-right text-[11px] font-bold text-[var(--cmp-text-critical)]">
                  {t.daysOverdue} days
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

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
