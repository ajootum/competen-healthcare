import { redirect } from "next/navigation";
import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/server";
import { resolvePracticeShell } from "@/lib/practice/shell";
import { hasCapability } from "@/lib/practice/access";
import { todaysWork } from "@/lib/practice/todays-work";
import { formatMinuteOfDay, formatDate } from "@/lib/datetime";
import CurrentActivityPanel from "./CurrentActivityPanel";

// /practice/today -- CPR-V3-002 "Today's Work".
//
// THE SCREEN V3 PUTS AT THE CENTRE, and the acceptance criterion it is measured by: "Open Today's Work in
// under two clicks." It is one click from anywhere in the product, because it is in the sidebar.
//
// WHAT IS REAL HERE AND WHAT IS NOT, said plainly rather than drawn convincingly:
//   Current Activity   real -- migration 232, and the only new store V3 needed
//   Today's Timeline   real -- the same table, the rest of the day's plan
//   Walk-in Queue      real -- practice_queue_entry, since CPR-110
//   Next Patient       real -- the head of that same queue, not a second opinion about who is next
//   Overdue Follow-ups real -- practice_follow_up, overdue derived against the practice's clock
//   Pending Results    real -- practice_incoming_document awaiting review
//   Tasks              real -- practice_task assigned to the person reading
//
// The comp also shows a per-activity progress ring ("16 of 30 patients seen"). It is NOT drawn: nothing
// yet links an encounter to the activity it happened in for historical rows, so the denominator would be
// invented. Migration 232 adds practice_encounter.activity_id, so the ring becomes truthful as soon as
// encounters start being recorded against an activity -- which is the honest order to do it in.

export const dynamic = "force-dynamic";

export default async function TodaysWorkPage() {
  const shell = await resolvePracticeShell();
  if (shell.state !== "READY") redirect("/practice");
  if (!hasCapability(shell.ctx, "practice.home.view")) redirect("/practice/home");

  const admin = createAdminClient();
  const work = await todaysWork(admin, shell.ctx);
  const { plan } = work;
  const canPlan = hasCapability(shell.ctx, "appointment.manage");

  return (
    <div className="max-w-6xl">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Today&rsquo;s Work</h1>
          <p className="mt-0.5 text-[13px] text-gray-500">
            {formatDate(plan.date)} · everything below is your own day, in your practice&rsquo;s time zone.
          </p>
        </div>
        <Link href="/practice/calendar" className="text-[12.5px] font-semibold text-[var(--cp-primary)] hover:underline">
          Full schedule →
        </Link>
      </div>

      {plan.unavailable && (
        <p className="mt-4 rounded-xl border border-[var(--cmp-border-warning)] bg-[var(--cmp-surface-warning)] px-4 py-3 text-[13px] text-[var(--cmp-text-warning)]">
          Today&rsquo;s plan could not be read just now. Nothing below is a claim that your day is empty —
          it is a claim that this page could not find out.
        </p>
      )}

      {/* ── CURRENT ACTIVITY + THE DAY'S TIMELINE ──────────────────────────────────────────────── */}
      <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <CurrentActivityPanel plan={plan} canPlan={canPlan} />

        <section className="rounded-2xl border border-gray-200 bg-white p-4" aria-labelledby="timeline-h">
          <h2 id="timeline-h" className="text-[13px] font-bold text-gray-900">Today&rsquo;s Timeline</h2>
          {plan.activities.length === 0 ? (
            <p className="mt-3 text-[13px] text-gray-500">
              {plan.unavailable
                ? "Could not be read."
                : "Nothing is planned for today yet. A day with no plan is not a day with no work — add what you are doing so encounters can inherit it."}
            </p>
          ) : (
            <ol className="mt-3 space-y-1.5">
              {plan.activities.map(a => (
                <li key={a.id} className="flex items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-black/[0.02]">
                  <span className="w-11 shrink-0 text-[12px] font-semibold tabular-nums text-gray-500">
                    {formatMinuteOfDay(a.plannedStartMinute)}
                  </span>
                  <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${
                    a.state === "running" ? "bg-[var(--cmp-text-success)]"
                      : a.state === "done" ? "bg-gray-300" : "bg-[var(--cp-primary)]/40"}`} />
                  <span className="min-w-0 flex-1">
                    <span className={`block truncate text-[13px] ${a.state === "running" ? "font-bold text-[var(--cp-primary-deep)]" : "font-medium text-gray-800"}`}>
                      {a.title}
                    </span>
                    <span className="block truncate text-[11px] text-gray-500">
                      {[a.label, a.facilityName, a.room].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-bold ${
                    a.state === "running" ? "bg-[var(--cmp-surface-success)] text-[var(--cmp-text-success)]"
                      : a.state === "done" ? "bg-gray-100 text-gray-500"
                        : "bg-[var(--cp-primary-soft)] text-[var(--cp-primary-deep)]"}`}>
                    {a.state === "running" ? "In progress" : a.state === "done" ? "Done" : "Upcoming"}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>

      {/* ── NEXT PATIENT ───────────────────────────────────────────────────────────────────────── */}
      <section className="mt-4 rounded-2xl border border-gray-200 bg-white p-4" aria-labelledby="next-h">
        <h2 id="next-h" className="text-[13px] font-bold text-gray-900">Next Patient</h2>
        {work.nextPatientUnavailable ? (
          <p className="mt-2 text-[13px] text-gray-500">The queue could not be read just now.</p>
        ) : work.nextPatient ? (
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <span className="text-[15px] font-bold text-gray-900">{work.nextPatient.name}</span>
            <span className="rounded-full bg-[var(--cp-primary-soft)] px-2 py-0.5 text-[11px] font-bold text-[var(--cp-primary-deep)]">
              {work.nextPatient.status === "READY" ? "Ready" : "Waiting"}
            </span>
            <Link href="/practice/calendar"
              className="ml-auto rounded-lg bg-[var(--cp-primary)] px-3.5 py-2 text-[12.5px] font-semibold text-white hover:opacity-90">
              Open the queue →
            </Link>
          </div>
        ) : (
          <p className="mt-2 text-[13px] text-gray-500">Nobody is waiting.</p>
        )}
      </section>

      {/* ── THE FOUR WORK PANELS ───────────────────────────────────────────────────────────────── */}
      <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {work.panels.map(p => (
          <section key={p.key} className="rounded-2xl border border-gray-200 bg-white p-4" aria-labelledby={`p-${p.key}`}>
            <div className="flex items-baseline justify-between gap-2">
              <h2 id={`p-${p.key}`} className="text-[12.5px] font-bold text-gray-900">{p.label}</h2>
              {/* The count is the length of the list you can open -- so it IS the link. */}
              <Link href={p.href} className="text-[11.5px] font-semibold text-[var(--cp-primary)] hover:underline">
                {p.count === null ? "—" : p.count} →
              </Link>
            </div>
            {p.items.length > 0 ? (
              <ul className="mt-2.5 space-y-1.5">
                {p.items.map(i => (
                  <li key={i.id} className="flex items-start gap-2">
                    <span aria-hidden className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${i.urgent ? "bg-[var(--cmp-text-danger)]" : "bg-gray-300"}`} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12.5px] font-medium text-gray-800">{i.title}</span>
                      {(i.detail || i.marker) && (
                        <span className="block truncate text-[11px] text-gray-500">
                          {[i.detail, i.marker].filter(Boolean).join(" · ")}
                        </span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2.5 text-[12px] text-gray-500">{p.note}</p>
            )}
            {p.count !== null && p.count > p.items.length && (
              <p className="mt-2 text-[11px] text-gray-400">Showing {p.items.length} of {p.count}.</p>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}
