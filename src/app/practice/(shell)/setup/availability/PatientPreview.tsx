import { formatDate, formatMinuteOfDay } from "@/lib/datetime";

// CPR-SCH-002 — the persistent patient-view sidebar.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// THE COMP DRAWS A LIVE BOOKING PAGE, INCLUDING ITS URL AND A "Check availability" BUTTON.
//
// There is no patient-facing booking page. Rendering that card as drawn would put a working-looking
// address on screen that resolves to nothing -- and the practitioner most likely to believe it is the
// one who just spent five minutes setting up the week it advertises. They would stop answering the
// phone.
//
// So the panel keeps its position and its job -- showing exactly what would be offered, computed by the
// same engine that would offer it -- and replaces the address bar with what is actually true. The
// availability above it is real; only the door is missing.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

const DAY_LABEL = ["", "MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];

export type PreviewDay = {
  weekday: number;
  locationName: string | null;
  from: number | null;
  to: number | null;
  otherSessions: number;
  /** Suspended sessions are not offers. A day with only suspended work is unavailable. */
  unavailable: boolean;
};

export default function PatientPreview({ days, nextAvailable, timezone, practitionerName, offerableCount }: {
  days: PreviewDay[];
  nextAvailable: { whenIso: string; label: string; locationName: string | null } | null;
  timezone: string;
  practitionerName: string | null;
  offerableCount: number;
}) {
  return (
    <div className="flex flex-col gap-3">
      <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <div className="mb-2 flex items-center gap-2">
          <span aria-hidden className="flex h-6 w-6 items-center justify-center rounded-md bg-[var(--cp-primary)]/12 text-[12px] text-[var(--cp-primary-deep)]">◉</span>
          <h2 className="text-[13px] font-bold text-gray-900">Patient view preview</h2>
        </div>
        <p className="text-[11px] leading-relaxed text-gray-500">
          What a patient would be offered from your weekly schedule. All times {timezone}.
        </p>

        <p className="mt-3 text-[10px] font-bold uppercase tracking-wider text-gray-400">Weekly availability</p>
        <ul className="mt-1.5 space-y-1">
          {days.map(d => (
            <li key={d.weekday} className="flex items-start gap-2">
              <span aria-hidden className={`mt-0.5 w-9 shrink-0 rounded px-1 py-0.5 text-center text-[9px] font-bold ${
                d.unavailable ? "bg-slate-100 text-slate-400" : "bg-emerald-100 text-emerald-700"}`}>
                {DAY_LABEL[d.weekday]}
              </span>
              <span className="min-w-0 flex-1">
                {d.unavailable ? (
                  <span className="text-[11px] text-gray-400">Unavailable</span>
                ) : (
                  <>
                    <span className="block truncate text-[11px] font-semibold text-gray-800">
                      {d.locationName ?? "No place recorded"}
                    </span>
                    <span className="block text-[10px] text-gray-500">
                      {formatMinuteOfDay(d.from ?? 0)} – {formatMinuteOfDay(d.to ?? 0)}
                      {d.otherSessions > 0 ? ` · and ${d.otherSessions} more` : ""}
                    </span>
                  </>
                )}
              </span>
            </li>
          ))}
        </ul>
      </section>

      {/* NEXT AVAILABLE — derived from real generated slots and the booking rules, not from the weekly
          pattern. The pattern says Tuesday; whether next Tuesday is actually free depends on who is
          already booked and on the notice the rules require. */}
      <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Next available</p>
        {nextAvailable ? (
          <>
            <p className="mt-1 text-[13px] font-bold text-gray-900">{nextAvailable.label}</p>
            {nextAvailable.locationName && (
              <p className="text-[11px] text-gray-600">{nextAvailable.locationName}</p>
            )}
            <p className="text-[10px] text-gray-400">{formatDate(nextAvailable.whenIso, timezone)}</p>
          </>
        ) : (
          <p className="mt-1 text-[12px] text-gray-500">
            Nothing bookable in the next fortnight
            {offerableCount === 0 ? " — add a working day, then it appears here." : "."}
          </p>
        )}
      </section>

      {/* ── The booking page the comp draws, and the one sentence that keeps it honest ────────────── */}
      <section className="rounded-xl border border-amber-200 bg-amber-50/60 p-4">
        <p className="text-[10px] font-bold uppercase tracking-wider text-amber-800">Booking page</p>
        <div className="mt-2 flex items-center gap-2.5 rounded-lg border border-amber-200 bg-white/70 px-2.5 py-2">
          <span aria-hidden className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[13px] text-slate-400">◔</span>
          <div className="min-w-0">
            <p className="truncate text-[12px] font-semibold text-gray-800">{practitionerName ?? "Your practice"}</p>
            <p className="text-[10px] text-gray-500">No public booking page yet</p>
          </div>
        </div>
        <p className="mt-2 text-[10px] leading-relaxed text-amber-900/90">
          The design shows a link patients could open. Self-booking is not built, so there is no address
          to give out and nothing here is reachable from outside the practice. Everything above is what
          <em> would</em> be offered the day it is.
        </p>
      </section>
    </div>
  );
}
