import { APPOINTMENT_KINDS } from "@/lib/practice/calendar";

// CPR-CAL-001 s12, cut down to CPR-PLN-002 s7's "Day mode compact summary".
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// TWO CARDS REMAIN OF FOUR, AND THE OTHER TWO WERE ROUTED, NOT DROPPED.
//
//   Follow-ups        the Day Inspector's Follow-ups tab, and the board reachable from it. A second
//                     overview card here was the duplicated day-orientation s3 complains of.
//   Before you start  day orientation, which s2 gives to the Command Centre. The one deterministic
//                     planning warning it carried -- bookings by name only, with no record attached --
//                     lives on in the Day Inspector's Checks tab, where s7 says such warnings belong.
//
// THE DONUT STAYS REPLACED RATHER THAN RESTORED. On the registration screen "82% utilised" was refused
// because capacity was recorded nowhere. Here it IS: an availability slot has a start and an end. So
// the numbers behind the comp's donut are real -- and the honest rendering of them is "7h 23m of
// 10h 00m", which says everything 82% says AND says what it is a percentage of. That last part is the
// whole difference on a morning when only two hours were available.
//
// On a day with no availability defined, the panel says so rather than dividing by an assumption.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

/* eslint-disable @typescript-eslint/no-explicit-any */

const card = "rounded-xl border border-gray-200 bg-white p-5";

export default function OperationsHeader({ c }: { c: any }) {
  const s = c.summary;

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {/* ── Today's clinic (comp: five figures in a row) ────────────────────────────────────────── */}
      <section className={card}>
        <h2 className="text-[14px] font-bold text-gray-900">
          {c.isToday ? "Today's clinic" : "That day's clinic"}
        </h2>
        <p className="mt-0.5 text-[12px] text-gray-500">{c.day}</p>
        {/* EACH FIGURE IN ITS OWN TYPE'S COLOUR, taken from APPOINTMENT_KINDS rather than chosen here --
            so the "3 New" in this row is the same indigo as every new-patient block on the timeline
            above it, and a hue can never mean one thing in the summary and another in the grid. */}
        {/* CPR-MOB-001 s5: five figures in one row is a squeeze at 320px -- below md they wrap to a
            3+2 grid. Same five figures, same order, same colours; max-md:* no-op at md and up. */}
        <div className="mt-3 grid grid-cols-5 gap-1 max-md:grid-cols-3 max-md:gap-y-2">
          {[
            ["Booked", s.booked, "var(--cp-slate-700)"],
            ["Follow-up", s.followUps, APPOINTMENT_KINDS.scheduled_followup.colour],
            ["New", s.newPatients, APPOINTMENT_KINDS.new_consultation.colour],
            ["Telemed", s.telemedicine, APPOINTMENT_KINDS.teleconsultation.colour],
            ["Urgent", s.emergency, APPOINTMENT_KINDS.emergency.colour],
          ].map(([k, v, colour]) => (
            <div key={String(k)}>
              <p className="text-[22px] font-bold leading-tight" style={{ color: colour as string }}>
                {v as number}
              </p>
              <p className="text-[10px] leading-tight text-gray-500">{k as string}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── The load (comp: an 82% donut) ──────────────────────────────────────────────────────── */}
      <section className={card}>
        <h2 className="text-[14px] font-bold text-gray-900">Time booked</h2>
        {c.load.capacityRecorded ? (
          <>
            <p className="mt-2 text-[26px] font-bold leading-tight text-gray-900">{c.load.scheduled}</p>
            <p className="text-[12px] text-gray-500">of {c.load.available} available</p>
            <p className="mt-1.5 text-[12px] font-semibold text-gray-700">{c.load.remaining} still free</p>
            {/* A BAR IS A COUNT DRAWN TO SCALE, which is not a rate -- CPR-200's Trend made the same
                distinction. The figures above carry the fact; this only carries the shape. */}
            <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-[var(--cp-primary)]/10" role="img"
              aria-label={`${c.load.scheduled} booked of ${c.load.available} available`}>
              <div className="h-full rounded-full bg-gradient-to-r from-[var(--cp-primary)] to-[var(--cp-accent)]"
                style={{ width: `${Math.min(100, (c.load.scheduledMinutes / c.load.availableMinutes) * 100)}%` }} />
            </div>
          </>
        ) : (
          <>
            <p className="mt-2 text-[26px] font-bold leading-tight text-gray-900">{c.load.scheduled}</p>
            <p className="text-[12px] text-gray-500">booked</p>
            <p className="mt-1.5 text-[11px] text-gray-500">
              No availability is set for this day, so there is nothing to compare it against. The design
              shows a percentage here; it would be dividing by a number nobody recorded.
            </p>
          </>
        )}
      </section>
    </div>
  );
}
