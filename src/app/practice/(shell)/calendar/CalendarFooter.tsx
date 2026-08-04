// CPR-CAL-001 -- the comp's footer strip, and the one claim on it that had to change.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// "PATIENTS NOTIFIED AUTOMATICALLY" IS THE MOST CONSEQUENTIAL SENTENCE ON THE WHOLE SCREEN.
//
// A practitioner who reads it stops ringing people. There IS a delivery channel now -- but it is off
// until a practice turns it on, it will not send to a patient who has not consented, and NOTHING
// SCHEDULES A REMINDER: no job runs, so no message goes by itself. Every one of those is true at once,
// and "automatically" is false because of the last.
//
// The other three lines are kept and made accurate: rescheduling is audited and conflicts are refused,
// both of which this product genuinely does.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

/* eslint-disable @typescript-eslint/no-explicit-any */

export default function CalendarFooter({ c }: { c: any }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white px-5 py-3">
      <ul className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-[12px] text-gray-600">
        <li>
          <span className="font-semibold text-gray-800">Conflicts refused.</span>{" "}
          A second booking in a taken slot is declined unless it is a walk-in or an emergency.
        </li>
        <li>
          <span className="font-semibold text-gray-800">Every change audited.</span>{" "}
          Who moved what, and when.
        </li>
        <li>
          {/* THE COMP SAYS "Patients notified automatically". */}
          <span className="font-semibold text-gray-800">
            {c.notifications.channelOn ? "Reminders are sent by a person." : "Nothing is sent to patients."}
          </span>{" "}
          {c.notifications.note}
        </li>
        <li className="ml-auto text-gray-500">All times in {c.timezone}</li>
      </ul>

      {/* ── What this screen will not claim ────────────────────────────────────────────────────── */}
      <details className="mt-2 border-t border-gray-100 pt-2">
        <summary className="cursor-pointer list-none text-[12px] font-semibold text-gray-600 hover:text-gray-900">
          <span className="mr-1 text-gray-400">›</span>
          {c.refused.length} things the design shows that this build will not claim
        </summary>
        <ul className="mt-2 grid gap-2 sm:grid-cols-2">
          {c.refused.map((r: any) => (
            <li key={r.key}>
              <p className="text-[12px] font-semibold text-gray-700">{r.label}</p>
              <p className="text-[11px] leading-relaxed text-gray-500">{r.detail}</p>
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}
