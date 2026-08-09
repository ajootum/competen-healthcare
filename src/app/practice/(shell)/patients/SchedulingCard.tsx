"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";

// CP-SCHED-001 s6 -- THE REGISTRATION SCHEDULING CARD. Location, then date, then time.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// WHAT THIS REPLACED, AND WHY IT HAD TO GO.
//
// The registration form had a raw `datetime-local` box labelled "Appointment". It knew nothing about
// where the practitioner works, which days they work, what an appointment lasts or what is already
// booked -- and it passed locationId: null, so checkPlacement was asked to judge a time somebody had
// guessed. Meanwhile the PATIENT-facing wizard has done location -> free times properly since Phase 4.
// One product, two standards, and the worse one was the one the practice uses every day.
//
// ⚠ THE ORDER IS LOCATION FIRST, AND s6 SAYS WHY: choosing a location narrows the practitioner's valid
// program, so nobody is asked to search arbitrary dates on which there is no session at all.
//
// ⚠ THREE STATES EVERYWHERE, NEVER TWO. "no answer yet" is loading, a string in `problem` is "we could
// not tell", and an empty array is "there genuinely is nothing". A card that drew the same empty row for
// an outage and for a free diary would send a receptionist to ring a patient back for no reason -- or,
// worse, tell them the practitioner is fully booked when the read simply failed.
//
// ⚠ IT IMPORTS NO ENGINE. Everything comes from /api/v1/practice/scheduling-offer. A "use client" file
// importing patient-booking.ts would drag node:crypto into the browser bundle -- type-checks, lints,
// passes every harness, and kills the page. practice-bundle-harness.ts exists because that happened.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

const OFFER = "/api/v1/practice/scheduling-offer";

type Loc = { id: string; name: string; type: string };
type LocationsPayload = { locations: Loc[]; defaultLocationId: string | null; defaultReason: string | null };
type DateChip = { date: string; label: string; freeCount: number; firstFreeAt: string };
type DatesPayload = {
  timezone: string; minutes: number; dates: DateChip[];
  scannedToIso: string; windowExhausted: boolean;
};
type Slot = { startsAt: string; endsAt: string; minutes: number; locationId: string | null; locationName: string | null };
type SlotsPayload = { timezone: string; minutes: number; slots: Slot[]; date: string };

/**
 * ⚠ EVERY READ CARRIES THE QUESTION IT ANSWERS, AND THAT IS NOT BOOKKEEPING.
 *
 * React 19 treats a setState in an effect BODY as an error, so the obvious "clear the list, then fetch"
 * cannot be written here. It should not be written anyway: clearing on the way in and setting on the way
 * out is exactly how a slow answer for the location somebody has already changed lands on top of the
 * current one. A payload whose key is not the current question is not an answer, it is a leftover -- and
 * "loading" is simply the absence of an answer to the question being asked now.
 */
type Loaded<T> = { key: string; data: T | null; problem: string | null };

async function read<T>(url: string, what: string): Promise<{ data: T | null; problem: string | null }> {
  try {
    const res = await fetch(url);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return {
        data: null,
        problem: body?.error?.message
          ? String(body.error.message)
          : `${what} could not be read (HTTP ${res.status})`,
      };
    }
    return { data: (await res.json()) as T, problem: null };
  } catch (e) {
    return { data: null, problem: `${what} could not be read: ${e instanceof Error ? e.message : String(e)}` };
  }
}

export type SchedulingChoice = {
  locationId: string | null;
  locationName: string | null;
  date: string;
  startsAt: string;
  minutes: number;
  /** "10:20", already in the practice's timezone. What the button is allowed to say. */
  timeLabel: string;
};

/** A time as the practice reads it. The timezone comes from the server; nothing here guesses one. */
export function timeLabel(iso: string, timezone: string): string {
  try {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone, hour: "2-digit", minute: "2-digit", hour12: false,
    }).format(new Date(iso));
  } catch {
    return new Date(iso).toISOString().slice(11, 16);
  }
}

const chip = "rounded-lg border px-2.5 py-1.5 text-[12px] font-semibold transition-colors disabled:opacity-40";
const chipIdle = "border-gray-200 bg-white text-gray-700 hover:border-[var(--cp-primary)] hover:bg-[var(--cp-primary)]/5";
const chipOn = "border-[var(--cp-primary)] bg-[var(--cp-primary)] text-white";
const label = "block text-[12px] font-semibold text-gray-600";
const input = "w-full rounded-lg border border-gray-200 px-2.5 py-2 text-[14px] outline-none focus:border-[var(--cp-primary)] focus:ring-2 focus:ring-[var(--cp-primary)]/10";

/** The three-state row a section draws while it does not yet have an answer of its own. */
function State({ loading, problem, empty, emptyText }: {
  loading: boolean; problem: string | null; empty: boolean; emptyText: string;
}) {
  if (problem)
    return (
      <p className="rounded-lg bg-[var(--cmp-surface-critical)] px-2.5 py-1.5 text-[12px] text-[var(--cmp-text-critical)]">
        {problem}
      </p>
    );
  if (loading) return <p className="text-[12px] text-gray-400">Reading the practice schedule&hellip;</p>;
  if (empty) return <p className="text-[12px] text-gray-500">{emptyText}</p>;
  return null;
}

export default function SchedulingCard({
  appointmentType = "new_consultation", value, onChange, refreshNonce = 0, alternatives = null,
}: {
  appointmentType?: string;
  value: SchedulingChoice | null;
  onChange: (choice: SchedulingChoice | null) => void;
  /**
   * ⚠ BUMPED BY THE FORM WHEN A BOOKING LOST A RACE. s10: "immediately refresh nearby free times". It is
   * part of every read key below, so a bump re-asks all three questions rather than leaving a list on
   * screen whose minutes have gone.
   */
  refreshNonce?: number;
  /** The times the server returned WITH the refusal, shown before any new read comes back. */
  alternatives?: Slot[] | null;
}) {
  const [locationId, setLocationId] = useState<string | null>(null);
  // A ref, not state: it guards the server's default from overwriting a human choice, and nothing
  // renders differently because of it.
  const locationTouched = useRef(false);
  const [dateLimit, setDateLimit] = useState(4);
  const [date, setDate] = useState<string | null>(null);

  const [locLoad, setLocLoad] = useState<Loaded<LocationsPayload> | null>(null);
  const [dateLoad, setDateLoad] = useState<Loaded<DatesPayload> | null>(null);
  const [slotLoad, setSlotLoad] = useState<Loaded<SlotsPayload> | null>(null);

  const locKey = `locations|${refreshNonce}`;
  const dateKey = `dates|${locationId ?? ""}|${appointmentType}|${dateLimit}|${refreshNonce}`;
  const slotKey = date ? `slots|${date}|${locationId ?? ""}|${appointmentType}|${refreshNonce}` : "";

  // ── 1. WHERE ────────────────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    let live = true;
    (async () => {
      const got = await read<LocationsPayload>(`${OFFER}?view=locations`, "the practice's locations");
      if (!live) return;
      setLocLoad({ key: locKey, ...got });
      // s6 step 1's default, and only when the SERVER said it was unambiguous. A card that picked the
      // first location in the list would silently book patients into the wrong building.
      if (!locationTouched.current && got.data?.defaultLocationId) setLocationId(got.data.defaultLocationId);
    })();
    return () => { live = false; };
  }, [locKey]);

  // ── 2. WHEN ─────────────────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    let live = true;
    (async () => {
      const q = new URLSearchParams({ view: "dates", appointmentType, limit: String(dateLimit) });
      if (locationId) q.set("locationId", locationId);
      const got = await read<DatesPayload>(`${OFFER}?${q}`, "the next available dates");
      if (live) setDateLoad({ key: dateKey, ...got });
    })();
    return () => { live = false; };
  }, [dateKey, appointmentType, dateLimit, locationId]);

  // ── 3. WHAT TIME ────────────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!slotKey || !date) return;
    let live = true;
    (async () => {
      const q = new URLSearchParams({ view: "slots", appointmentType, date });
      if (locationId) q.set("locationId", locationId);
      const got = await read<SlotsPayload>(`${OFFER}?${q}`, "the free times");
      if (live) setSlotLoad({ key: slotKey, ...got });
    })();
    return () => { live = false; };
  }, [slotKey, appointmentType, date, locationId]);

  const locs = locLoad?.key === locKey ? locLoad.data : null;
  const locsProblem = locLoad?.key === locKey ? locLoad.problem : null;
  const dates = dateLoad?.key === dateKey ? dateLoad.data : null;
  const datesProblem = dateLoad?.key === dateKey ? dateLoad.problem : null;
  const slots = slotKey && slotLoad?.key === slotKey ? slotLoad.data : null;
  const slotsProblem = slotKey && slotLoad?.key === slotKey ? slotLoad.problem : null;

  const locName = useMemo(
    () => locs?.locations.find(l => l.id === locationId)?.name ?? null,
    [locs, locationId],
  );

  const pick = useCallback((slot: Slot, tz: string, forDate: string) => {
    onChange({
      locationId: slot.locationId ?? locationId,
      locationName: slot.locationName ?? locName,
      date: forDate,
      startsAt: slot.startsAt,
      minutes: slot.minutes,
      timeLabel: timeLabel(slot.startsAt, tz),
    });
  }, [onChange, locationId, locName]);

  const tz = slots?.timezone ?? dates?.timezone ?? "UTC";

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-3">
      <div className="flex items-baseline justify-between gap-2 flex-wrap">
        <h3 className="text-[13px] font-bold text-gray-900">Appointment</h3>
        {value && (
          <button type="button" onClick={() => { setDate(null); onChange(null); }}
            className="text-[12px] font-semibold text-gray-400 hover:text-gray-700">
            Clear
          </button>
        )}
      </div>
      <p className="mt-0.5 text-[11px] text-gray-500">
        Optional. Leaving this alone registers the patient without booking anything.
      </p>

      {/* ── 1. Location ───────────────────────────────────────────────────────────────────── */}
      <div className="mt-3">
        <label className={label} htmlFor="sched-location">1. Location</label>
        <State loading={!locs && !locsProblem} problem={locsProblem} empty={!!locs && locs.locations.length === 0}
          emptyText="This practice has no active location, so there is nowhere to book. Add one in Setup." />
        {locs && locs.locations.length > 0 && (
          <>
            <select id="sched-location" className={`mt-1 ${input}`} value={locationId ?? ""}
              onChange={e => {
                locationTouched.current = true;
                setLocationId(e.target.value || null);
                setDate(null); onChange(null);
              }}>
              <option value="">Any location</option>
              {locs.locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
            {locs.defaultReason && locationId === locs.defaultLocationId && (
              <p className="mt-1 text-[11px] text-gray-400">{locs.defaultReason}</p>
            )}
          </>
        )}
      </div>

      {/* ── 2. Date ───────────────────────────────────────────────────────────────────────── */}
      <div className="mt-3">
        <p className={label}>2. Next available</p>
        <State loading={!dates && !datesProblem} problem={datesProblem} empty={!!dates && dates.dates.length === 0}
          emptyText={locationId
            ? "Nothing is free at this location inside the booking window. Try another location, or open the calendar."
            : "Nothing is free inside the booking window. Open the calendar to look further out."} />
        {dates && dates.dates.length > 0 && (
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            {dates.dates.map(d => (
              <button key={d.date} type="button"
                onClick={() => { setDate(d.date); onChange(null); }}
                className={`${chip} ${date === d.date ? chipOn : chipIdle}`}>
                {d.label}
                <span className={`ml-1.5 font-normal ${date === d.date ? "text-white/80" : "text-gray-400"}`}>
                  {d.freeCount} available
                </span>
              </button>
            ))}
            {/* MORE, AND THEN THE CALENDAR. s6 asks for both. The button widens this read; the link goes
                to the surface that can look anywhere. It is hidden once the scan has run out of dates
                rather than out of window -- offering "more" that cannot exist is a dead press. */}
            {!dates.windowExhausted && (
              <button type="button" onClick={() => setDateLimit(n => n + 8)}
                className={`${chip} ${chipIdle}`}>
                More dates
              </button>
            )}
            <Link href="/practice/calendar" className="text-[12px] font-semibold text-[var(--cp-primary-deep)] hover:underline">
              View calendar
            </Link>
          </div>
        )}
      </div>

      {/* ── 3. Time ───────────────────────────────────────────────────────────────────────── */}
      {(date || (alternatives && alternatives.length > 0)) && (
        <div className="mt-3">
          <p className={label}>3. Available times</p>

          {/* ⚠ WHAT THE SERVER RETURNED WITH THE REFUSAL, SHOWN FIRST. When a booking loses a race the
              response carries the times that are still free; drawing them straight away is the
              difference between "that time has gone" and "that time has gone, here is 10:40". */}
          {alternatives && alternatives.length > 0 && !date && (
            <div className="mt-1 flex flex-wrap gap-1.5">
              {alternatives.map(s => (
                <button key={s.startsAt} type="button"
                  onClick={() => pick(s, tz, s.startsAt.slice(0, 10))}
                  className={`${chip} ${value?.startsAt === s.startsAt ? chipOn : chipIdle}`}>
                  {timeLabel(s.startsAt, tz)}
                </button>
              ))}
            </div>
          )}

          {date && (
            <>
              <State loading={!slots && !slotsProblem} problem={slotsProblem}
                empty={!!slots && slots.slots.length === 0}
                emptyText="Every time on this day has gone since the list above was drawn. Choose another day." />
              {slots && slots.slots.length > 0 && (
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {slots.slots.map(s => (
                    <button key={s.startsAt} type="button" onClick={() => pick(s, slots.timezone, date)}
                      className={`${chip} ${value?.startsAt === s.startsAt ? chipOn : chipIdle}`}>
                      {timeLabel(s.startsAt, slots.timezone)}
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {value && (
        <p className="mt-3 rounded-lg bg-[var(--cp-primary)]/5 px-2.5 py-1.5 text-[12px] text-[var(--cp-primary-deep)]">
          Booking <span className="font-bold">{value.timeLabel}</span>
          {value.locationName ? <> at <span className="font-semibold">{value.locationName}</span></> : null}
          {" "}for {value.minutes} minutes.
        </p>
      )}

      {/* ⚠ THE SENTENCE THE DESIGN ASKS FOR, AND IT IS TRUE OF THIS BUILD. Every time above comes from
          the practitioner's own sessions minus the appointments already in the diary. */}
      <p className="mt-2 text-[11px] text-gray-400">
        Times shown are based on your practice schedule and existing bookings.
      </p>
    </section>
  );
}
