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
        <>
          {/* The desktop face, untouched at md and up. */}
          <ul className="mt-3 flex flex-wrap gap-2 max-md:hidden">
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

          {/* CPR-MOB-001 s8 -- "Availability: compact availability blocks; expand for details."
              Each block is one thumb-height line: kind (in words, never colour alone -- s4) and
              times. Opening it shows the derived taken/available state and the place. Native
              details/summary, because this file is a server component and a disclosure needs no
              client state. */}
          <ul className="mt-3 flex flex-col gap-1.5 md:hidden">
            {c.ribbon.map((r: any) => (
              <li key={r.id}>
                <details className="rounded-lg border"
                  style={{ borderColor: `color-mix(in srgb, ${r.colour} 35%, white)`, background: `color-mix(in srgb, ${r.colour} 7%, white)` }}>
                  <summary className="flex min-h-[var(--cp-touch)] cursor-pointer list-none items-center gap-1.5 px-3 text-[12px]">
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: r.colour }} aria-hidden />
                    <span className="font-bold" style={{ color: r.colour }}>{r.label}</span>
                    <span className="tabular-nums text-gray-700">{hhmm(r.from)}–{hhmm(r.to)}</span>
                    <span className="ml-auto shrink-0 text-[11px] font-semibold text-gray-500">Details ⌄</span>
                  </summary>
                  <div className="px-3 pb-2 text-[12px] text-gray-700">
                    {/* DERIVED. See the header. */}
                    <p>{r.full ? "Full — every time in this block is taken." : "Available — this block still has bookable time."}</p>
                    {r.location && <p className="text-[11px] text-gray-500">{r.location}</p>}
                  </div>
                </details>
              </li>
            ))}
          </ul>
        </>
      )}

      {/* ── The legend, which is also the colour mapping s46 asks to be configurable. Desktop only:
          below md every compact block already names its kind in words, so a second list of the same
          words is height without information. ────────────────────────────────────────────────── */}
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-gray-100 pt-2 max-md:hidden">
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
