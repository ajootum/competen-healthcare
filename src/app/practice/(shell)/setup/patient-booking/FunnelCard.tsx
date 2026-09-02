import type { FunnelReading } from "@/lib/practice/booking-funnel";

// ────────────────────────────────────────────────────────────────────────────────────────────────────
// CPR-BOOK-FLOW-002 s19 -- WHERE PATIENTS STOP, shown to the practice whose page they stopped on.
//
// ⚠ THE CAVEAT IS PART OF THE READING, NOT A FOOTNOTE. These are page counts, not people: there is no
// journey identifier (migration 366 explains why not), so a refresh counts twice and a link opened by
// something other than a patient counts once. A funnel that hid that would read as a headcount, and a
// practitioner would make decisions about their diary on it.
//
// ⚠ AND A MISSING NUMBER IS NEVER A ZERO. `fromPrevious` is null wherever the step above recorded
// nothing -- "nobody got that far to convert" is a different fact from "nobody converted", and only one
// of them means anything is wrong.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

const card = "rounded-xl border border-gray-200 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]";

function since(iso: string): string {
  const days = Math.max(1, Math.round((Date.now() - Date.parse(iso)) / 86_400_000));
  return days === 1 ? "the last day" : `the last ${days} days`;
}

export default function FunnelCard({ funnel }: { funnel: FunnelReading }) {
  if (funnel.state === "unreadable") {
    return (
      <section className={card}>
        <h2 className="text-[13px] font-bold text-gray-900">Where patients stop</h2>
        {/* ⚠ AN OUTAGE, SAID AS ONE. Drawing this as an empty funnel would tell a practice nobody came. */}
        <p className="mt-1 text-[12px] leading-relaxed text-gray-600">
          {funnel.reason ?? "These counts could not be read just now."} That is not the same as nobody
          having visited &mdash; nothing was counted, so nothing is known either way.
        </p>
      </section>
    );
  }

  if (funnel.state === "empty") {
    return (
      <section className={card}>
        <h2 className="text-[13px] font-bold text-gray-900">Where patients stop</h2>
        <p className="mt-1 text-[12px] leading-relaxed text-gray-600">
          Nothing has been recorded in {since(funnel.sinceIso)}. This fills in on its own once patients
          start opening your booking page.
        </p>
      </section>
    );
  }

  const top = funnel.rungs[0]?.count ?? 0;

  return (
    <section className={card}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[13px] font-bold text-gray-900">Where patients stop</h2>
        <span className="text-[10.5px] text-gray-500">{since(funnel.sinceIso)}</span>
      </div>

      <ol className="mt-3 space-y-1.5">
        {funnel.rungs.map(rung => {
          // The bar is drawn against the TOP of the funnel, so the shape is comparable down the list.
          // Guarded, because dividing by a top of nought is how a chart renders NaN as a full bar.
          const width = top > 0 ? Math.round((rung.count / top) * 100) : 0;
          return (
            <li key={rung.step}>
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-[11.5px] font-semibold text-gray-800">{rung.label}</span>
                <span className="shrink-0 text-[11.5px] tabular-nums text-gray-700">
                  {rung.count}
                  {/* Null means the step above recorded nothing. Saying "0%" there would be a lie. */}
                  {rung.fromPrevious !== null && (
                    <span className="ml-1.5 text-[10.5px] text-gray-500">{rung.fromPrevious}% of the step before</span>
                  )}
                </span>
              </div>
              <div aria-hidden className="mt-0.5 h-1.5 overflow-hidden rounded-full bg-gray-100">
                <div className="h-full rounded-full bg-[var(--cp-primary)]" style={{ width: `${width}%` }} />
              </div>
            </li>
          );
        })}
      </ol>

      {funnel.asides.length > 0 && (
        <ul className="mt-3 space-y-1 border-t border-gray-100 pt-2">
          {funnel.asides.map(a => (
            <li key={a.step} className="flex items-baseline justify-between gap-2 text-[11.5px]">
              <span className="text-gray-600">{a.label}</span>
              <span className="tabular-nums font-semibold text-gray-800">{a.count}</span>
            </li>
          ))}
        </ul>
      )}

      {(funnel.medianSecondsToBook !== null || funnel.byDevice.length > 0) && (
        <p className="mt-3 text-[11px] leading-relaxed text-gray-600">
          {funnel.medianSecondsToBook !== null && (
            <>A booking takes about {Math.max(1, Math.round(funnel.medianSecondsToBook / 60))} minute
              {Math.round(funnel.medianSecondsToBook / 60) === 1 ? "" : "s"} to complete
              {/* ⚠ MEASURED ONLY ON JOURNEYS THAT FINISHED, and it says so -- an average that silently
                  excluded everybody who gave up would flatter the number it reports. */}
              , counting only the ones that finished.{" "}
            </>
          )}
          {funnel.byDevice.length > 0 && (
            <>Booked on {funnel.byDevice.map(d => `${d.device} (${d.confirmed})`).join(", ")}.</>
          )}
        </p>
      )}

      <p className="mt-2 text-[10.5px] leading-relaxed text-gray-500">{funnel.note}</p>
    </section>
  );
}
