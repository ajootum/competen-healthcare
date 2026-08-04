import Link from "next/link";

// CPR-CAL-001 s12 -- the summary cards, the load, the follow-up overview and the briefing.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// THE DONUT IS THE ONLY THING HERE THAT GOES, AND IT IS REPLACED RATHER THAN DELETED.
//
// On the registration screen "82% utilised" was refused because capacity was recorded nowhere. Here it
// IS: an availability slot has a start and an end. So the numbers behind the donut are real -- and the
// honest rendering of them is "7h 23m of 10h 00m", which says everything 82% says AND says what it is a
// percentage of. That last part is the whole difference on a morning when only two hours were available.
//
// On a day with no availability defined, the panel says so rather than dividing by an assumption.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

/* eslint-disable @typescript-eslint/no-explicit-any */

const card = "rounded-xl border border-gray-200 bg-white p-5";

export default function OperationsHeader({ c }: { c: any }) {
  const s = c.summary;

  return (
    <div className="grid gap-4 lg:grid-cols-4">
      {/* ── Today's clinic (comp: five figures in a row) ────────────────────────────────────────── */}
      <section className={card}>
        <h2 className="text-[14px] font-bold text-gray-900">
          {c.isToday ? "Today's clinic" : "That day's clinic"}
        </h2>
        <p className="mt-0.5 text-[12px] text-gray-500">{c.day}</p>
        <div className="mt-3 grid grid-cols-5 gap-1">
          {[
            ["Booked", s.booked], ["Follow-up", s.followUps], ["New", s.newPatients],
            ["Telemed", s.telemedicine], ["Urgent", s.emergency],
          ].map(([k, v]) => (
            <div key={String(k)}>
              <p className="text-[22px] font-bold leading-tight text-gray-900">{v as number}</p>
              <p className="text-[10px] leading-tight text-gray-500">{k}</p>
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
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-gray-100" role="img"
              aria-label={`${c.load.scheduled} booked of ${c.load.available} available`}>
              <div className="h-full rounded-full bg-[var(--cp-primary)]"
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

      {/* ── Follow-up overview ─────────────────────────────────────────────────────────────────── */}
      <section className={card}>
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="text-[14px] font-bold text-gray-900">Follow-ups</h2>
          <Link href="/practice/follow-ups" className="text-[12px] font-semibold text-[var(--cp-primary-deep)] hover:underline">
            Board
          </Link>
        </div>
        <ul className="mt-2 flex flex-col">
          {[
            ["Due today", c.followUps.dueToday, "var(--cp-info)"],
            ["Overdue", c.followUps.overdue, "var(--cp-error)"],
            ["Booked in", c.followUps.booked, "var(--cp-success)"],
            ["Still to book", c.followUps.needBooking, "var(--cp-warning)"],
          ].map(([k, v, colour]) => (
            <li key={String(k)} className="flex items-baseline gap-2 border-b border-gray-100 py-1 last:border-0">
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: colour as string }} />
              <span className="text-[13px] text-gray-700">{k as string}</span>
              <span className="ml-auto text-[13px] font-bold text-gray-900">{v as number}</span>
            </li>
          ))}
        </ul>
      </section>

      {/* ── The briefing (comp: an AI panel) ───────────────────────────────────────────────────── */}
      <section className={card}>
        <h2 className="text-[14px] font-bold text-gray-900">Before you start</h2>
        {c.briefing.length === 0 ? (
          <p className="mt-2 text-[13px] text-gray-400">Nothing booked.</p>
        ) : (
          <ul className="mt-2 flex flex-col gap-1">
            {c.briefing.map((b: string, i: number) => (
              <li key={i} className="text-[13px] text-gray-700">{b}</li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-[11px] text-gray-500">
          Counted from the diary. The design calls this an AI briefing and adds &ldquo;3 MRI results
          likely require discussion&rdquo; &mdash; that is a clinical judgement, and not one this product
          will make for you.
        </p>
      </section>
    </div>
  );
}
