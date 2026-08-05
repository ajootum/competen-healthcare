import Link from "next/link";
import type { TodaysPlan } from "@/lib/practice/activity";
import { formatMinuteOfDay } from "@/lib/datetime";

// CPR-V5-002 CONTEXT HEADER -- "a non-navigation contextual panel above the menu showing the active
// operational context": current activity, hospital/location, session time, session status.
//
// ⚠ IT IS NOT NAVIGATION AND MUST NOT BEHAVE LIKE IT. The spec says so twice, and the reason is that the
// sidebar's job is "where can I go" while this panel's job is "where am I". The one link it carries goes
// to the schedule and is labelled as such -- there is no click here that changes what you are doing,
// because the control that does that lives on the command centre and having two would mean a
// practitioner could switch activity from a panel that does not show them what they are switching away
// from.
//
// ⚠ IT NEVER INVENTS A CONTEXT. Nothing running renders "No activity running", not a plausible-looking
// clinic -- this panel is what every encounter inherits from (CPR-V3-001 s6), so a decorative one would
// be the most expensive lie on the screen. The same applies to a failed read: "could not be read" is a
// third state, and it is not the same as being between clinics.
//
// Acceptance criterion (V5-002): "context header updates automatically when the practitioner changes
// activity or location". It does, because it is server-rendered from the same `todaysPlan` the command
// centre uses and the layout re-renders on navigation -- there is no second copy of this state to fall
// out of step.

export default function CurrentActivityHeader({ plan }: { plan: TodaysPlan }) {
  const a = plan.current;

  return (
    <div className="border-b border-white/10 px-4 py-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[9.5px] font-bold uppercase tracking-[0.14em] text-blue-200/40">Current activity</p>
        {a ? (
          <span className="flex items-center gap-1.5 text-[10px] font-semibold text-emerald-300">
            <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
            Active
          </span>
        ) : (
          <span className="text-[10px] text-blue-200/40">{plan.unavailable ? "Unknown" : "None"}</span>
        )}
      </div>

      {a ? (
        <div className="mt-2 rounded-xl bg-white/[0.06] p-3">
          <p className="text-[14px] font-bold leading-tight text-white">{a.title}</p>
          {(a.facilityName || a.locationName || a.room) && (
            <p className="mt-1 flex items-center gap-1.5 text-[11.5px] text-blue-100/70">
              <span aria-hidden className="text-blue-200/50">◎</span>
              <span className="truncate">
                {[a.facilityName ?? a.locationName, a.room].filter(Boolean).join(" · ")}
              </span>
            </p>
          )}
          <p className="mt-0.5 flex items-center gap-1.5 text-[11.5px] tabular-nums text-blue-100/70">
            <span aria-hidden className="text-blue-200/50">◔</span>
            {formatMinuteOfDay(a.plannedStartMinute)} – {formatMinuteOfDay(a.plannedEndMinute)}
          </p>
          {/* Overrunning is REPORTED, never corrected -- a clinic that runs long is a clinic, not an
              error, and the plan is what was intended rather than what happened. */}
          {a.overrunMinutes !== null && (
            <p className="mt-1 text-[10.5px] text-amber-300">Running {a.overrunMinutes} min past its planned end.</p>
          )}
          {/* CPR-V5-005's comp changes this from "View full schedule" to the session itself, and the
              change is right: from a panel telling you WHAT you are in, the useful destination is the
              cockpit for it, not the diary of everything else. The planner is one click further on. */}
          <Link href="/practice/today"
            className="mt-2.5 block border-t border-white/10 pt-2 text-[11.5px] font-semibold text-blue-300 hover:text-blue-200">
            Go to Current Session →
          </Link>
        </div>
      ) : (
        <p className="mt-2 text-[11.5px] leading-snug text-blue-100/50">
          {plan.unavailable
            ? "Your plan could not be read just now."
            : "Nothing is running. Start an activity on the command centre so encounters inherit it."}
        </p>
      )}
    </div>
  );
}
