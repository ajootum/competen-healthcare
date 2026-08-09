import Link from "next/link";

// CPR-CAL-001 s13/s14 -- the availability ribbon and the weekly location panel.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// "AVAILABLE" AND "FULL" ARE DERIVED, NOT STORED. The comp's ribbon mixes two questions into one row:
// what kind of session this is (clinic, telemedicine, emergency, leave) which is recorded, and whether
// it is taken, which is a fact about bookings. A stored "full" is wrong the moment somebody cancels.
//
// THE WEEK PANEL IS BUILT FROM THE SLOTS THEMSELVES, not from a separate rota. Two sources for "where
// am I on Wednesday" is one too many, and the one nobody maintains is the one that lies.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

/* eslint-disable @typescript-eslint/no-explicit-any */

const hhmm = (iso: string) => new Date(iso).toISOString().slice(11, 16);
const dayName = (d: string) =>
  ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][new Date(`${d}T12:00:00Z`).getUTCDay()];

// ── A COLOUR PER PLACE, NOT PER ROW ──────────────────────────────────────────────────────────────────
//
// The comp gives each day of the week its own coloured edge. Assigning those by ROW POSITION would make
// the colour meaningless -- Monday green because it is first. Assigned by LOCATION NAME, the panel says
// something true: the two days you are at the same hospital carry the same edge, and a week split
// across three sites reads as three colours before a word of it is read.
//
// Stable across renders because it is keyed on the name, and a practice that renames a site gets a new
// colour rather than a wrong one.
const PLACE_HUES = [
  "var(--cp-primary)", "var(--cp-success)", "var(--cp-accent)",
  "var(--cp-warning)", "var(--cp-info)", "var(--cp-area-8)",
];
function placeHue(names: string[], allPlaces: string[]): string | null {
  if (names.length === 0) return null;
  const i = allPlaces.indexOf(names[0]);
  return i === -1 ? null : PLACE_HUES[i % PLACE_HUES.length];
}

export default function AvailabilityRibbon({ c }: { c: any }) {
  // Every place named anywhere in the week, in a stable order, so a hue belongs to a site for the
  // whole panel rather than being recomputed per row.
  const allPlaces: string[] = [...new Set(
    (c.week ?? []).flatMap((d: any) => d.locations as string[]),
  )] as string[];

  return (
    <div className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)] items-start">
      {/* ── The week (comp: My Schedule This Week) ─────────────────────────────────────────────── */}
      <section className="rounded-xl border border-gray-200 bg-white p-5">
        <h2 className="text-[14px] font-bold text-gray-900">This week</h2>
        <ul className="mt-2 flex flex-col gap-1.5">
          {c.week.map((d: any) => {
            const hue = placeHue(d.locations, allPlaces);
            return (
            <li key={d.day}>
              <Link href={`/practice/calendar?date=${d.day}`}
                className={`block rounded-lg border border-l-4 border-gray-100 px-3 py-2 transition hover:shadow-sm ${
                  d.isChosen ? "ring-1 ring-[var(--cp-primary)]/30" : ""}`}
                style={{
                  borderLeftColor: hue ?? "var(--cp-slate-300)",
                  background: d.isChosen && hue ? `color-mix(in srgb, ${hue} 7%, white)` : undefined,
                }}>
                <span className="flex items-baseline gap-2">
                  <span className="text-[12px] font-bold text-gray-900">{dayName(d.day)}</span>
                  <span className="text-[11px] text-gray-500">{d.day.slice(8)} {d.day.slice(5, 7)}</span>
                  {d.isChosen && (
                    <span className="ml-auto h-2 w-2 rounded-full"
                      style={{ background: hue ?? "var(--cp-primary)" }} />
                  )}
                </span>
                <span className="mt-0.5 block text-[12px] font-semibold"
                  style={{ color: hue ?? "var(--cp-slate-500)" }}>
                  {d.locations.length > 0 ? d.locations.join(" · ") : "No location set"}
                </span>
                <span className="block text-[11px] text-gray-500">
                  {d.from && d.to
                    ? `${hhmm(d.from)} – ${hhmm(d.to)}`
                    : "Nothing scheduled"}
                </span>
              </Link>
            </li>
            );
          })}
        </ul>
        <p className="mt-2 text-[11px] text-gray-400">
          Taken from the availability you set. Where nothing is set, nothing is claimed.
        </p>
      </section>

      {/* ── The ribbon ─────────────────────────────────────────────────────────────────────────── */}
      <section className="rounded-xl border border-gray-200 bg-white p-5">
        <div className="flex items-baseline justify-between gap-2 flex-wrap">
          <h2 className="text-[14px] font-bold text-gray-900">Availability</h2>
          <span className="text-[12px] text-gray-500">
            All times in this practice&rsquo;s own timezone ({c.timezone})
          </span>
        </div>

        {c.ribbon.length === 0 ? (
          <p className="mt-2 text-[13px] text-gray-400">
            No availability is set for this day. Bookings are still possible; there is simply nothing to
            compare them against.
          </p>
        ) : (
          <ul className="mt-3 flex flex-wrap gap-2">
            {c.ribbon.map((r: any) => (
              <li key={r.id}
                className="rounded-lg border px-3 py-2"
                style={{ borderColor: `color-mix(in srgb, ${r.colour} 35%, white)`, background: `color-mix(in srgb, ${r.colour} 7%, white)` }}>
                <span className="flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 rounded-full" style={{ background: r.colour }} />
                  <span className="text-[12px] font-bold" style={{ color: r.colour }}>{r.label}</span>
                  {/* DERIVED. See the header. */}
                  <span className="text-[11px] text-gray-500">{r.full ? "full" : "available"}</span>
                </span>
                <span className="mt-0.5 block text-[12px] text-gray-700">
                  {hhmm(r.from)} – {hhmm(r.to)}
                </span>
                {r.location && <span className="block text-[11px] text-gray-500">{r.location}</span>}
              </li>
            ))}
          </ul>
        )}

        {/* ── The legend, which is also the colour mapping s46 asks to be configurable ────────── */}
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-gray-100 pt-2">
          {Object.entries(c.kinds ?? {}).map(([k, v]: [string, any]) => (
            <span key={k} className="flex items-center gap-1 text-[11px] text-gray-600">
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: v.colour }} />
              {v.label}
            </span>
          ))}
        </div>
      </section>
    </div>
  );
}
