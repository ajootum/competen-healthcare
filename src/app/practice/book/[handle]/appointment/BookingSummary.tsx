"use client";

// ────────────────────────────────────────────────────────────────────────────────────────────────────
// CPR-BOOK-FLOW-002 s3/s7 -- THE IDENTITY STRIP AND THE PERSISTENT APPOINTMENT SUMMARY.
//
// Two things a patient must never lose track of mid-booking: who they are booking with, and what they
// have chosen so far. Both were absent from the old flow -- the header showed "@elisham1" over the
// practice's internal name ("Trial"), and the choices vanished the moment the step advanced.
//
// ⚠ THE SUMMARY IS NOT A SECOND SOURCE OF TRUTH. Every value is passed in from the wizard's own state;
// nothing here re-derives a time, a label or an eligibility. `onChange` returns the patient to the step
// that owns the value rather than editing it in place, so there is one editor per fact.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

export type SummaryIdentity = {
  displayName: string;
  credentials: string | null;
  specialty: string | null;
  initials: string;
  photoUrl: string | null;
};

/** The practitioner strip. Present on every step, compact enough not to compete with the form (s3). */
export function IdentityStrip({ identity, locationName }: {
  identity: SummaryIdentity; locationName: string | null;
}) {
  return (
    <div className="flex items-center gap-3">
      {identity.photoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={identity.photoUrl} alt={identity.displayName} width={44} height={44}
          className="h-11 w-11 shrink-0 rounded-full object-cover ring-1 ring-gray-200" />
      ) : (
        <span aria-hidden
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[var(--cp-primary)] text-[15px] font-bold text-white">
          {identity.initials}
        </span>
      )}
      <div className="min-w-0">
        <p className="truncate text-[13.5px] font-bold text-gray-900">
          {identity.displayName}{identity.credentials ? `, ${identity.credentials}` : ""}
        </p>
        <p className="truncate text-[11.5px] text-gray-500">
          {[identity.specialty, locationName].filter(Boolean).join(" · ")}
        </p>
      </div>
    </div>
  );
}

export type SummaryFacts = {
  locationName: string | null;
  mode: string | null;
  appointmentTypeLabel: string | null;
  when: string | null;
  minutes: number | null;
};

/**
 * The appointment as it stands (s7). Rendered from Step 2 onward, once there is something to show.
 *
 * ⚠ EVERY ROW IS OMITTED WHEN IT HAS NO VALUE. A summary with "Date: —" in it teaches a patient to
 * distrust the rows that do have values.
 */
export function AppointmentSummary({ facts, onChange, compact }: {
  facts: SummaryFacts;
  /** Which step owns each fact, so "Change" lands on the control rather than on a guess. */
  onChange?: (step: 1 | 2) => void;
  compact?: boolean;
}) {
  const rows: { label: string; value: string; step: 1 | 2 }[] = [];
  if (facts.locationName)
    rows.push({ label: "Location", value: facts.mode ? `${facts.locationName} · ${facts.mode}` : facts.locationName, step: 1 });
  if (facts.appointmentTypeLabel)
    rows.push({ label: "Appointment type", value: facts.appointmentTypeLabel, step: 1 });
  if (facts.when)
    rows.push({ label: "Date & time", value: facts.when, step: 2 });
  if (facts.minutes)
    rows.push({ label: "Duration", value: `${facts.minutes} minutes`, step: 2 });

  if (rows.length === 0) return null;

  return (
    <section aria-labelledby="summary-heading"
      className={`rounded-xl border border-gray-200 bg-white p-3.5 ${compact ? "" : "shadow-[0_1px_2px_rgba(15,23,42,0.04)]"}`}>
      <h2 id="summary-heading" className="text-[12px] font-bold text-gray-900">Your appointment</h2>
      <dl className="mt-2 space-y-2">
        {rows.map(r => (
          <div key={r.label}>
            <dt className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">{r.label}</dt>
            <dd className="flex items-baseline justify-between gap-2">
              <span className="text-[12px] font-semibold text-gray-800">{r.value}</span>
              {onChange && (
                <button type="button" onClick={() => onChange(r.step)}
                  className="shrink-0 text-[10.5px] font-semibold text-[var(--cp-primary)] hover:underline">
                  Change
                </button>
              )}
            </dd>
          </div>
        ))}
      </dl>
      {/* s6: a chosen time is not a held time, said without the implementation talk the old copy used. */}
      <p className="mt-2 text-[10.5px] leading-relaxed text-gray-500">
        Your appointment time is confirmed when booking is completed.
      </p>
    </section>
  );
}
