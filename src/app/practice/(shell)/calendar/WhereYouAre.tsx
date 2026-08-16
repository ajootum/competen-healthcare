// Multi-hospital day -- where the practitioner has to be, in order.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// THE PANEL EXISTS FOR ONE LINE ON IT: the hop that cannot be made.
//
// A day with two hospitals in it is not a list of appointments, it is a route. The diary shows both
// blocks looking perfectly fine -- neither overlaps the other -- and the practitioner finds out on the
// road that thirty minutes was never enough. Booking refuses to CREATE that now, but a booking made
// before the sites were linked, or one deliberately forced through, still sits there.
//
// APPEARS ONLY WHEN THERE IS MORE THAN ONE PLACE IN THE DAY. A practitioner who works in one room does
// not need a travel panel, and a panel that renders "Kololo, all day" every day teaches people to stop
// reading it -- so it would be showing nothing on the day it matters.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

/* eslint-disable @typescript-eslint/no-explicit-any */

const hhmm = (iso: string, timezone: string) =>
  new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: timezone });

const TYPE_TINT: Record<string, string> = {
  hospital: "bg-[var(--cp-primary)]/10 text-[var(--cp-primary-deep)]",
  clinic: "bg-[var(--cp-accent)]/10 text-cyan-800",
  outreach: "bg-amber-100 text-amber-800",
  teleconsultation: "bg-violet-100 text-violet-800",
  independent: "bg-gray-100 text-gray-700",
};

export default function WhereYouAre({ route, timezone }: {
  route: { blocks: any[]; impossible: any[]; unassignedCount: number };
  timezone: string;
}) {
  // One place, or none, is not a route.
  if (route.blocks.length < 2 && route.impossible.length === 0) return null;

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="flex items-baseline gap-2">
        <h2 className="text-[13px] font-bold text-gray-900">Where you are today</h2>
        <span className="text-[11px] text-gray-500">
          {route.blocks.length} {route.blocks.length === 1 ? "place" : "places"}
        </span>
        {route.unassignedCount > 0 && (
          <span className="ml-auto text-[11px] text-gray-500">
            {route.unassignedCount} {route.unassignedCount === 1 ? "appointment says" : "appointments say"} nothing about where
          </span>
        )}
      </div>

      {/* ── The route ─────────────────────────────────────────────────────────────────────────── */}
      <ol className="mt-3 flex flex-wrap items-stretch gap-2">
        {route.blocks.map((b, i) => (
          <li key={`${b.locationId}-${b.firstAt}`} className="flex items-stretch gap-2">
            <div className={`rounded-lg px-3 py-2 ${TYPE_TINT[b.type] ?? TYPE_TINT.independent}`}>
              <p className="text-[13px] font-semibold leading-tight">{b.name}</p>
              <p className="text-[11px] opacity-80">
                {hhmm(b.firstAt, timezone)}–{hhmm(b.lastEndsAt, timezone)} · {b.appointmentCount}{" "}
                {b.appointmentCount === 1 ? "appointment" : "appointments"}
              </p>
              {/* The facility is what makes a patient's number at this place resolvable. */}
              {b.type === "hospital" && !b.facilityName && (
                <p className="text-[10px] opacity-70">no facility linked -- set it in Practice Settings</p>
              )}
            </div>
            {i < route.blocks.length - 1 && (
              <span className="self-center text-[13px] text-gray-300" aria-hidden>→</span>
            )}
          </li>
        ))}
      </ol>

      {/* ── The hop that cannot be made ────────────────────────────────────────────────────────── */}
      {route.impossible.length > 0 && (
        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
          <p className="text-[12px] font-semibold text-amber-900">
            {route.impossible.length === 1
              ? "One move in this day cannot be made"
              : `${route.impossible.length} moves in this day cannot be made`}
          </p>
          <ul className="mt-1 space-y-0.5">
            {route.impossible.map((m: any, i: number) => (
              <li key={i} className="text-[11px] leading-relaxed text-amber-900/90">
                <span className="font-semibold">{hhmm(m.atIso, timezone)}</span> — {m.fromName} to {m.toName}{" "}
                leaves {m.gapMinutes < 0
                  ? `${Math.abs(m.gapMinutes)} minutes of overlap`
                  : `${m.gapMinutes} minutes`}, and {m.toName} needs {m.neededMinutes}.
              </li>
            ))}
          </ul>
          <p className="mt-1.5 text-[10px] text-amber-800/80">
            The travel time is a number set against each place, not a distance anything measured.
          </p>
        </div>
      )}
    </section>
  );
}
