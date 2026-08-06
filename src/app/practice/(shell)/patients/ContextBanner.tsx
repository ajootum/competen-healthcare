"use client";

import { Count, CARD, day } from "./Honesty";
import type { BannerView } from "./types";

// CPR-V5-006 s6 -- the Patient Context Banner, the specification's own novel addition.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// WHAT A CLINICIAN NEEDS BEFORE THEY SAY THE FIRST WORD: who this is, how old, which numbers they carry,
// when this practice last saw them, what is outstanding, and what they were last diagnosed with. It is a
// header rather than a panel because it should be true wherever the patient is on screen.
//
// THE SPEC ASKS THIS BANNER FOR A "CURRENT CARE SETTING" AND IT CANNOT HAVE ONE. Practice records the
// PLACE -- the encounter's location, the facility of the activity it was opened inside -- and stores no
// outpatient/ward distinction anywhere. Rendering "clinic" as "Outpatient" would be an invention shown
// as a clinical fact, so the place is shown and the banner's own `basis` sentence says what it is.
//
// EVERY FIGURE IN THE OUTSTANDING ROW IS THE LENGTH OF A BLOCK IN THE PANEL BELOW IT. Nothing here is a
// number with nothing behind it, and a figure whose read failed shows an em dash rather than a zero.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

export default function ContextBanner({ banner, onClose }: {
  banner: BannerView;
  onClose: () => void;
}) {
  const ageText = banner.age
    ? banner.age.label
    : banner.ageEstimateYears != null
      ? `about ${banner.ageEstimateYears} years`
      : "age not recorded";

  return (
    <section className={`${CARD} border-l-4 p-4`} style={{ borderLeftColor: "var(--cp-primary)" }} aria-label="Selected patient">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <h2 className="text-[18px] font-bold text-gray-900">{banner.name}</h2>
            <span className="text-[13px] text-gray-600">
              {ageText}
              <span className="ml-1 text-[11px] text-gray-400">
                ({banner.ageBasis === "birth_date" ? "from date of birth"
                  : banner.ageBasis === "estimate" ? "estimated, no date of birth recorded"
                    : "no date of birth or estimate recorded"})
              </span>
            </span>
            {banner.sex && banner.sex !== "unspecified" && (
              <span className="text-[13px] text-gray-600">{banner.sex}</span>
            )}
          </div>

          {/* THE IDENTIFIERS, TOGETHER. The acceptance criterion is that multiple hospital numbers are
              shown beside the Practice ID rather than hidden in demographics -- so they are in the
              header, where a number is read off out loud. */}
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {banner.practiceId
              ? <span className="rounded bg-[var(--cp-primary)]/10 px-1.5 py-0.5 font-mono text-[12px] text-[var(--cp-primary-deep)]">{banner.practiceId}</span>
              : <span className="text-[12px] text-gray-400">No Practice ID issued</span>}
            {banner.hospitalNumbers.map(h => (
              <span key={h.id} className="rounded bg-emerald-50 px-1.5 py-0.5 font-mono text-[12px] text-emerald-800">
                {h.value}
                {h.facilityName && <span className="font-sans text-[11px]"> · {h.facilityName}</span>}
              </span>
            ))}
            {banner.hospitalNumbers.length === 0 && (
              <span className="text-[12px] text-gray-400">No hospital number recorded</span>
            )}
          </div>
        </div>

        <button
          type="button"
          onClick={onClose}
          className="shrink-0 rounded-lg border border-gray-200 px-2.5 py-1 text-[12px] font-semibold text-gray-600 hover:bg-gray-50"
        >
          Clear selection
        </button>
      </div>

      {banner.recordStatus !== "active" && (
        <p className="mt-2 rounded-lg bg-[var(--cmp-surface-warning)] px-3 py-2 text-[12px] font-semibold text-[var(--cmp-text-warning)]">
          This record is {banner.recordStatus}.
          {banner.mergedIntoPatientId && " It has been merged into another record and must not be written to."}
        </p>
      )}

      <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Last seen here</p>
          <p className="text-[13px] text-gray-800">
            {!banner.lastSeenKnown
              ? <span className="text-[var(--cmp-text-warning)]">not known — the encounter record could not be read</span>
              : banner.lastSeen ? day(banner.lastSeen) : <span className="text-gray-400">never seen at this practice</span>}
          </p>
        </div>

        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Next follow-up</p>
          <p className="text-[13px] text-gray-800">
            {!banner.activeFollowUpKnown
              ? <span className="text-[var(--cmp-text-warning)]">not known</span>
              : banner.activeFollowUp
                ? <>
                  {banner.activeFollowUp.dueOn}
                  {banner.activeFollowUp.overdue && (
                    <span className="ml-1 rounded bg-[var(--cmp-surface-critical)] px-1 py-0.5 text-[10px] font-semibold text-[var(--cmp-text-critical)]">overdue</span>
                  )}
                  <span className="block text-[11px] text-gray-500">{banner.activeFollowUp.reason}</span>
                </>
                : <span className="text-gray-400">none open</span>}
          </p>
        </div>

        <div className="sm:col-span-2">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
            Where this practice last had them
          </p>
          <p className="text-[13px] text-gray-800">
            {banner.place.known
              ? <>
                {banner.place.label}
                {(banner.place.locationName || banner.place.facilityName) && (
                  <span className="block text-[11px] text-gray-500">
                    {[banner.place.locationName, banner.place.facilityName].filter(Boolean).join(" · ")}
                    {banner.place.activityTitle ? ` · ${banner.place.activityTitle}` : ""}
                  </span>
                )}
              </>
              : <span className="text-[var(--cmp-text-warning)]">{banner.place.label}</span>}
          </p>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-2 border-t border-gray-100 pt-3">
        {banner.outstanding.map(o => (
          <span
            key={o.key}
            className="rounded-lg border border-gray-200 px-2.5 py-1.5"
            title={o.reason === "capability" ? "Not shown to you" : o.reason === "read_failed" ? (o.error ?? "Could not be read") : undefined}
          >
            <Count count={o.count} reason={o.reason} className="text-[16px] font-bold text-gray-900" />
            <span className="ml-1.5 text-[12px] text-gray-600">{o.label}</span>
          </span>
        ))}
      </div>

      <div className="mt-3 border-t border-gray-100 pt-2">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Most recent diagnoses</p>
        {!banner.recentDiagnosesKnown
          ? <p className="text-[12px] text-[var(--cmp-text-warning)]">The diagnosis record could not be read — this is not a patient with no diagnosis.</p>
          : banner.recentDiagnoses.length === 0
            ? <p className="text-[12px] text-gray-400">None recorded at this practice.</p>
            : (
              <ul className="mt-0.5 flex flex-wrap gap-1.5">
                {banner.recentDiagnoses.map(d => (
                  <li key={d.id} className="rounded bg-gray-100 px-2 py-0.5 text-[12px] text-gray-700">
                    {d.label}
                    <span className="ml-1 text-[11px] text-gray-500">{d.certainty} · {day(d.recordedAt)}</span>
                  </li>
                ))}
              </ul>
            )}
      </div>

      <p className="mt-2 text-[11px] leading-relaxed text-gray-500">{banner.place.basis}</p>
    </section>
  );
}
