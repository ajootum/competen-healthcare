import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/server";
import { resolvePracticeShell } from "@/lib/practice/shell";
import { hasCapability } from "@/lib/practice/access";
import Link from "next/link";
import { followUpBoard, practiceToday } from "@/lib/practice/follow-ups";
import { recallQueue } from "@/lib/practice/follow-up-plans";
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
  const [board, recall] = await Promise.all([
    followUpBoard(admin, shell.ctx.workspaceId),
    recallQueue(admin, shell.ctx.workspaceId),
  ]);

  const { data: ws } = await admin.from("practice_workspace").select("timezone").eq("id", shell.ctx.workspaceId).maybeSingle();
  const today = practiceToday(ws?.timezone);

  return (
    <div className="max-w-5xl">
      <h1 className="text-xl font-bold text-gray-900">Follow-ups</h1>
      <p className="mt-0.5 text-[13px] text-gray-500">
        What you committed to, and whether it has happened. Overdue is worked out from the due date
        against today in {ws?.timezone ?? "UTC"} &mdash; nothing has to run for something to appear here.
      </p>

      {/* ── CPR-140's recall queue, and what replaces the reminder engine ────────────────────────
          The specification asks for reminders over SMS, email, app, voice and WhatsApp. This product
          has no delivery channel, so nothing is sent and nothing pretends to be. What remains is this:
          a queue DERIVED at read time, grouped by the person to contact rather than the row to tick.
          It needs nothing to run, so a practice that has not opened the app for a fortnight sees the
          whole backlog the moment it does. */}
      {recall.patients.length > 0 && (
        <section className="mt-4 rounded-xl border border-[var(--cmp-color-critical)] bg-white p-4">
          <div className="flex items-baseline gap-2 flex-wrap">
            <h2 className="text-[13px] font-bold text-gray-900">Recall queue</h2>
            <span className="text-[11px] text-gray-500">
              {recall.patients.length} {recall.patients.length === 1 ? "patient" : "patients"},
              {" "}{recall.total} overdue {recall.total === 1 ? "follow-up" : "follow-ups"}
            </span>
          </div>
          <p className="mt-0.5 text-[11px] text-gray-500">
            Overdue with nothing booked, worst first. Nothing has been sent &mdash; there is no email,
            SMS or messaging channel in this product, so a recall is a call somebody makes.
          </p>
          <ul className="mt-2 flex flex-col">
            {recall.patients.slice(0, 12).map(p => (
              <li key={p.patientId} className="flex items-baseline gap-2 border-b border-gray-100 py-1.5 last:border-0">
                <Link href={`/practice/patients/${p.patientId}?followUp=recall`}
                  className="text-[12px] font-semibold text-gray-800 hover:underline">
                  {p.name}
                </Link>
                {p.urgent && (
                  <span className="rounded bg-[var(--cmp-surface-critical)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--cmp-text-critical)]">
                    urgent
                  </span>
                )}
                <span className="ml-auto text-[11px] text-gray-600">
                  {p.followUps.length} overdue
                </span>
                <span className="w-28 text-right text-[11px] font-bold text-[var(--cmp-text-critical)]">
                  {p.worstOverdueDays} days
                </span>
              </li>
            ))}
          </ul>
          {recall.patients.length > 12 && (
            <p className="mt-1 text-[10px] text-gray-500">
              Showing the twelve longest waiting of {recall.patients.length}.
            </p>
          )}
        </section>
      )}

      <FollowUpBoard
        board={board}
        today={today}
        canManage={hasCapability(shell.ctx, "followup.manage")}
      />
    </div>
  );
}
