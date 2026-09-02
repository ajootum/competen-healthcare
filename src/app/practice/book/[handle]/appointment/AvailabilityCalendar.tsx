"use client";

// ════════════════════════════════════════════════════════════════════════════════════════════════════
// CPR-BOOK-AVAIL-001 §4/§5 -- THE MONTH GRID.
//
// §2's frozen principle: "The booking interface displays computed patient-bookable availability across
// the booking horizon; it must not expose or constrain the patient to the practitioner's raw recurring
// schedule." This component is given a set of dates that the SERVER computed and marks them. It contains
// no schedule, no recurrence and no arithmetic about when a clinic sits -- §22: "Do not duplicate
// scheduling logic in React/client components", and AC-11: "Client does not generate slots from a weekly
// recurrence template."
//
// ⚠ EVERY DATE IN THE MONTH IS RENDERED (§4, AC-02, AC-08). A calendar that draws only the bookable days
// makes the others look like they do not exist -- "unavailable dates must not masquerade as missing
// dates". They are present, muted, and say what they are.
//
// ⚠ AND NO STATE RESTS ON COLOUR (§5, §16). Available carries a count, selected carries a ring and a
// check, today carries a ring and an accessible name, out-of-horizon is genuinely `disabled` so it is
// programmatically identifiable rather than merely grey.
// ════════════════════════════════════════════════════════════════════════════════════════════════════

export type DayCell = {
  /** YYYY-MM-DD in the PRACTICE's calendar, which is the key the slot buckets already use. */
  date: string;
  dayOfMonth: number;
  inMonth: boolean;
  isToday: boolean;
  isPast: boolean;
  /** Beyond the booking horizon: not bookable YET, which is not the same as full (§13). */
  beyondHorizon: boolean;
  freeCount: number;
};

/** Monday-first, because the comp and the practice's own week start there. */
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

const iso = (y: number, m: number, d: number) =>
  `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

/**
 * The cells of one month, Monday-first, padded with the neighbouring months' days so the grid is
 * rectangular and the weekday columns line up.
 *
 * ⚠ BUILT IN UTC ON PURPOSE. These are CALENDAR DATES, not instants -- the practice's own dates, which
 * is what the slot buckets are keyed by. Constructing them with a local Date would shift the month
 * boundary for anybody whose browser sits west of UTC, and the 1st would quietly become the 31st.
 */
export function monthCells(
  year: number, month: number,
  opts: { today: string; freeByDate: Map<string, number>; bookableUntil: string | null },
): DayCell[] {
  const first = new Date(Date.UTC(year, month - 1, 1));
  // getUTCDay: 0=Sun. Monday-first offset.
  const lead = (first.getUTCDay() + 6) % 7;
  const start = new Date(first.getTime() - lead * 86400000);

  const cells: DayCell[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(start.getTime() + i * 86400000);
    const y = d.getUTCFullYear(), m = d.getUTCMonth() + 1, day = d.getUTCDate();
    const date = iso(y, m, day);
    cells.push({
      date,
      dayOfMonth: day,
      inMonth: m === month && y === year,
      isToday: date === opts.today,
      isPast: date < opts.today,
      beyondHorizon: !!opts.bookableUntil && date > opts.bookableUntil,
      freeCount: opts.freeByDate.get(date) ?? 0,
    });
    // Stop after the week that completes the month -- a 6th row only when the month needs one.
    if (i >= 27 && d.getUTCDay() === 0 && (m > month || y > year)) break;
  }
  return cells;
}

export default function AvailabilityCalendar({
  cells, selected, monthLabel, onPick, onPrev, onNext, canPrev, canNext, busy,
}: {
  cells: DayCell[];
  selected: string | null;
  monthLabel: string;
  onPick: (date: string, freeCount: number) => void;
  onPrev: () => void;
  onNext: () => void;
  canPrev: boolean;
  canNext: boolean;
  busy: boolean;
}) {
  const nav = "rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-[13px] font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-40";

  return (
    <div>
      {/* §4: month navigation, bounded by the horizon. Not "Earlier / Later" over an opaque window. */}
      <div className="flex items-center justify-between gap-2">
        <button type="button" className={nav} onClick={onPrev} disabled={!canPrev || busy}
          aria-label="Previous month">&lsaquo;</button>
        <span className="text-[13px] font-bold text-gray-900" aria-live="polite">{monthLabel}</span>
        <button type="button" className={nav} onClick={onNext} disabled={!canNext || busy}
          aria-label="Next month">&rsaquo;</button>
      </div>

      <div className="mt-2 grid grid-cols-7 gap-1" role="grid" aria-label="Choose a date">
        {WEEKDAYS.map(w => (
          <div key={w} role="columnheader"
            className="pb-1 text-center text-[10.5px] font-semibold uppercase tracking-wide text-gray-500">
            {w}
          </div>
        ))}

        {cells.map(c => {
          const available = c.freeCount > 0 && !c.isPast && !c.beyondHorizon;
          const isSelected = c.date === selected;
          // ⚠ DISABLED ONLY FOR WHAT CANNOT BE BOOKED AT ALL. A date with no availability stays
          // ACTIVATABLE (§5: "If selectable for explanation, show no-availability message") so a
          // patient who taps it is told why and where the next one is, rather than meeting a dead cell.
          const disabled = c.isPast || c.beyondHorizon || !c.inMonth;

          const state = !c.inMonth ? "outside"
            : c.isPast ? "past"
              : c.beyondHorizon ? "beyond"
                : available ? "available" : "none";

          const label = `${c.dayOfMonth}`
            + (c.isToday ? ", today" : "")
            + (state === "available" ? `, ${c.freeCount} appointment${c.freeCount === 1 ? "" : "s"} available`
              : state === "none" ? ", no appointments available"
                : state === "beyond" ? ", not yet open for booking"
                  : state === "past" ? ", in the past" : "");

          return (
            <button
              key={c.date} type="button" role="gridcell"
              aria-label={label}
              aria-selected={isSelected}
              aria-disabled={disabled}
              disabled={disabled || busy}
              onClick={() => onPick(c.date, c.freeCount)}
              className={[
                "relative rounded-lg border px-1 py-1.5 text-center transition",
                !c.inMonth ? "cursor-default border-transparent bg-transparent text-gray-300"
                  : isSelected ? "border-[var(--cp-primary)] bg-[var(--cp-primary)] text-white"
                    : available ? "border-emerald-200 bg-emerald-50 text-emerald-900 hover:border-emerald-400"
                      : c.isPast || c.beyondHorizon ? "border-gray-100 bg-gray-50 text-gray-300"
                        : "border-gray-100 bg-white text-gray-400 hover:bg-gray-50",
                // Today keeps its ring in every state, so it is findable without colour.
                c.isToday && !isSelected ? "ring-1 ring-inset ring-gray-400" : "",
              ].join(" ")}
            >
              <span className={`block text-[12.5px] ${available || isSelected ? "font-bold" : "font-medium"}`}>
                {c.dayOfMonth}
              </span>
              {/* ⚠ THE SECOND LINE IS THE NON-COLOUR CARRIER OF STATE. "2 times" and the dash say
                  available and not-available in words, so the grid survives greyscale and colour
                  vision differences -- §5 and §16 both require it. */}
              <span className={`block text-[9.5px] leading-tight ${
                isSelected ? "text-white/85" : available ? "text-emerald-700" : "text-gray-300"}`}>
                {!c.inMonth ? "" : available ? `${c.freeCount} time${c.freeCount === 1 ? "" : "s"}` : "–"}
              </span>
              {isSelected && <span aria-hidden className="absolute right-0.5 top-0.5 text-[9px]">✓</span>}
            </button>
          );
        })}
      </div>

      {/* §5's states, named. A legend is not decoration when three of the four states are greys. */}
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[10.5px] text-gray-600">
        <li className="flex items-center gap-1.5">
          <span aria-hidden className="inline-block h-2.5 w-2.5 rounded-sm border border-emerald-300 bg-emerald-100" />
          Available (number of free times shown)
        </li>
        <li className="flex items-center gap-1.5">
          <span aria-hidden className="inline-block h-2.5 w-2.5 rounded-sm border border-gray-200 bg-white" />
          No appointments available
        </li>
        <li className="flex items-center gap-1.5">
          <span aria-hidden className="inline-block h-2.5 w-2.5 rounded-sm border border-gray-100 bg-gray-50" />
          Not yet open for booking
        </li>
      </ul>
    </div>
  );
}
