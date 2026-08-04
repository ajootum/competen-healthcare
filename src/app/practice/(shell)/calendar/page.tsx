import Link from "next/link";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/server";
import { resolvePracticeShell } from "@/lib/practice/shell";
import { hasCapability } from "@/lib/practice/access";
import { loadDay } from "@/lib/practice/scheduling";
import { calendarDay, SLOT_KINDS } from "@/lib/practice/calendar";
import { bookingLocations, locationDay } from "@/lib/practice/hospital-booking";
import { timelineDay } from "@/lib/practice/timeline";
import { zonedDayRange } from "@/lib/practice/practice-time";
import CalendarConsole from "./CalendarConsole";
import OperationsHeader from "./OperationsHeader";
import AvailabilityRibbon from "./AvailabilityRibbon";
import CalendarFooter from "./CalendarFooter";
import WhereYouAre from "./WhereYouAre";
import Timeline from "./Timeline";

// /practice/calendar -- CPR-CAL-001 v4, the Practice Operations Calendar.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// A REAL DEFECT FIXED ON THE WAY IN: THE DAY WAS UTC'S, NOT THE PRACTICE'S.
//
// loadDay() has sliced the diary with `${dayIso}T00:00:00.000Z` since Phase 1. CPR-300 found exactly
// this on the operations home and fixed it there -- in Kampala a 01:00 appointment is 22:00Z the day
// before, so it vanished from its own day and turned up on the previous one. Every panel added here
// goes through calendarDay(), which uses zonedDayRange and is therefore on the practice's own clock.
//
// THE EXISTING CONSOLE IS KEPT. It already books, checks in, transitions and starts encounters, and all
// of that works; the comp's operational furniture is composed AROUND it rather than in place of it.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

export const dynamic = "force-dynamic";

export default async function CalendarPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const shell = await resolvePracticeShell();
  if (shell.state !== "READY") redirect("/practice");
  if (!hasCapability(shell.ctx, "practice.calendar.view")) redirect("/practice/home");

  const { date } = await searchParams;
  const admin = createAdminClient();

  const c = await calendarDay(admin, shell.ctx, date);
  // The console still takes its own slice, so the interactive half keeps working exactly as it did.
  const initial = await loadDay(admin, shell.ctx.workspaceId, c.day);

  // MULTI-HOSPITAL AND THE TIMELINE. All three go through the practice's own clock, like everything
  // else on this screen -- timelineDay in particular positions every block in practice-local minutes so
  // the browser never does clock arithmetic of its own.
  const dayRange = zonedDayRange(c.day, c.timezone);
  const [locations, route, timeline] = await Promise.all([
    bookingLocations(admin, shell.ctx),
    locationDay(admin, shell.ctx, dayRange.startIso, dayRange.endIso),
    timelineDay(admin, shell.ctx, c.day, c.timezone),
  ]);

  const shift = (days: number) => {
    const d = new Date(`${c.day}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  };

  return (
    <div className="-m-5 min-h-full bg-[var(--cp-canvas)] p-5">
      <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-4">
        {/* ── Date navigation (comp: ‹ Today Tuesday, 21 May) ────────────────────────────────── */}
        <div className="flex items-center gap-2 flex-wrap">
          <div>
            <h1 className="text-xl font-bold text-gray-900">Calendar</h1>
            <p className="text-[13px] text-gray-500">Practice operations</p>
          </div>
          <div className="ml-auto flex items-center gap-1.5">
            <Link href={`/practice/calendar?date=${shift(-1)}`}
              className="rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-[13px] font-semibold text-gray-700 hover:bg-gray-50"
              aria-label="Previous day">‹</Link>
            <Link href="/practice/calendar"
              className={`rounded-lg border px-3 py-1.5 text-[13px] font-semibold ${c.isToday
                ? "border-[var(--cp-primary)] bg-[var(--cp-primary)]/5 text-[var(--cp-primary-deep)]"
                : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50"}`}>
              Today
            </Link>
            <Link href={`/practice/calendar?date=${shift(1)}`}
              className="rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-[13px] font-semibold text-gray-700 hover:bg-gray-50"
              aria-label="Next day">›</Link>
            <span className="ml-2 text-[14px] font-semibold text-gray-900">{c.day}</span>
          </div>
        </div>

        <OperationsHeader c={c} />
        <AvailabilityRibbon c={{ ...c, kinds: SLOT_KINDS }} />
        <WhereYouAre route={JSON.parse(JSON.stringify(route))} timezone={c.timezone} />

        <Timeline
          timeline={JSON.parse(JSON.stringify(timeline))}
          canManage={hasCapability(shell.ctx, "appointment.manage")}
        />

        <CalendarConsole
          date={c.day}
          canManage={hasCapability(shell.ctx, "appointment.manage")}
          canQueue={hasCapability(shell.ctx, "queue.manage")}
          canStartEncounter={hasCapability(shell.ctx, "encounter.create")}
          initial={JSON.parse(JSON.stringify(initial))}
          locations={locations.map(l => ({ id: l.id, name: l.name, type: l.type, facility: l.facility }))}
        />

        <CalendarFooter c={c} />
      </div>
    </div>
  );
}
