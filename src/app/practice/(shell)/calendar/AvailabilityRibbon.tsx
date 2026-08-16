// CPR-CAL-001 s13 -- the availability ribbon, Day mode only since CPR-PLN-002.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// "AVAILABLE" AND "FULL" ARE DERIVED, NOT STORED. The comp's ribbon mixes two questions into one row:
// what kind of session this is (clinic, telemedicine, emergency, leave) which is recorded, and whether
// it is taken, which is a fact about bookings. A stored "full" is wrong the moment somebody cancels.
//
// THE WEEKLY PANEL THAT USED TO SIT BESIDE THIS RIBBON IS GONE, NOT MOVED HERE. CPR-PLN-002 s6 forbids
// Day mode from repeating a week dashboard below the day, and s7 routes the weekly location and
// availability strip to Week mode's day cards -- which already carry each day's places, times and
// travel. One weekly view, in the mode whose job the week is.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

/* eslint-disable @typescript-eslint/no-explicit-any */

const hhmm = (iso: string) => new Date(iso).toISOString().slice(11, 16);

export default function AvailabilityRibbon({ c }: { c: any }) {
  return (
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
  );
}
