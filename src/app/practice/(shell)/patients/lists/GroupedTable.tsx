"use client";

import { useState } from "react";
import Link from "next/link";
import {
  PatientCell, StatusBadge, LocationCell, DayCountPill, titleCase,
  ROW, THEAD, TH, TABLE_SCROLL, dayGroupCaption, type DayGroup,
} from "@/components/practice/PatientTable";

// CP-BOOKED-SEEN-001 s8, built against the spec's REFERENCE DESIGN -- which lives in the .docx as an
// image, and which the first build of this table never saw: mammoth extracts text and drops embedded
// pictures silently, so the written rules were implemented and the picture they describe was not. The
// owner had to send the screenshot twice. ⚠ WHEN A SPEC SAYS "reference design", EXTRACT word/media/.
//
// ⚠ THE ONLY CLIENT COMPONENT ON THIS PAGE, and it holds one thing: which days are closed. Everything it
// renders arrived pre-formatted from the server -- there is not a single function on the props. That is
// deliberate: a function on a payload passed to a client component type-checks, lints, passes every
// harness and then kills the page at runtime, and this codebase has shipped that bug before.
//
// ⚠ COLLAPSED ROWS ARE STILL RENDERED, AND HIDDEN IN CSS. The obvious version -- `isOpen && rows.map()`
// -- takes them out of the DOM entirely, and then no print rule can bring them back: a reader collapses
// August to look at September, prints, and files a register with a day silently missing from it.
// `.cp-day-closed` restores display inside @media print.

export default function GroupedTable({ groups, view, showLocation, countNoun }: {
  groups: DayGroup[];
  view: "booked" | "seen";
  /** s8: false when exactly one location is selected, because the value repeats on every row. */
  showLocation: boolean;
  countNoun: string;
}) {
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const toggle = (day: string) => setClosed(prev => {
    const next = new Set(prev);
    if (next.has(day)) next.delete(day); else next.add(day);
    return next;
  });

  const timeHeading = view === "booked" ? "Date & time" : "Seen time";
  const kindHeading = view === "booked" ? "Appointment" : "Encounter";
  const colCount = 5 + (showLocation ? 1 : 0);

  return (
    <div className={TABLE_SCROLL}>
      <table className="w-full border-collapse">
        <thead className={THEAD}>
          <tr>
            <th scope="col" className={`${TH} w-[110px]`}>{timeHeading}</th>
            <th scope="col" className={TH}>Patient</th>
            <th scope="col" className={TH}>{kindHeading}</th>
            <th scope="col" className={TH}>Status</th>
            {showLocation && <th scope="col" className={TH}>Location</th>}
            <th scope="col" className={`${TH} text-right`}>Actions</th>
          </tr>
        </thead>

        {groups.map(g => {
          const isOpen = !closed.has(g.day);
          const bodyId = `cp-day-${g.day}`;
          return (
            <tbody key={g.day} id={bodyId}>
              <tr>
                <th scope="colgroup" colSpan={colCount}
                  className="border-y border-gray-100 bg-gray-50/70 p-0 text-left">
                  <button type="button" onClick={() => toggle(g.day)}
                    aria-expanded={isOpen} aria-controls={bodyId}
                    className="no-print flex w-full items-center gap-2.5 px-3 py-2 text-left hover:bg-gray-100/70">
                    {/* Calendar glyph, as the reference design marks each date band. */}
                    <span aria-hidden="true" className="text-[13px] text-[var(--cp-primary)]">&#128197;</span>
                    <span className="text-[12.5px] font-bold text-gray-800">{g.label}</span>
                    <DayCountPill>
                      {g.rows.length} {g.rows.length === 1 ? countNoun : `${countNoun}s`}
                    </DayCountPill>
                    <span aria-hidden="true"
                      className={`ml-auto text-[10px] text-gray-400 transition-transform ${isOpen ? "" : "-rotate-90"}`}>
                      &#9660;
                    </span>
                    <span className="sr-only">{isOpen ? "expanded" : "collapsed"}</span>
                  </button>
                  <span className="print-only px-3 py-2 text-[12.5px] font-bold text-gray-800">
                    {dayGroupCaption(g, countNoun)}
                  </span>
                </th>
              </tr>

              {g.rows.map(r => (
                <tr key={r.id} className={`${ROW} ${isOpen ? "" : "cp-day-closed"}`}>
                  <td className="whitespace-nowrap px-3 py-2.5 text-[13px] font-semibold tabular-nums text-gray-900">
                    {r.time}
                  </td>
                  <PatientCell patientId={r.patientId} name={r.patientName} patientNumber={r.patientNumber}
                    sex={r.sex} unlinkedTitle="Named at booking, before a patient record existed" />
                  <td className="px-3 py-2.5 text-[12.5px] text-gray-700">{titleCase(r.kind)}</td>
                  <td className="px-3 py-2.5">
                    <StatusBadge status={r.status} kind={view === "booked" ? "appointment" : "encounter"} />
                  </td>
                  {showLocation && (
                    <LocationCell locationId={r.locationId} locationName={r.locationName}
                      locationSlot={r.locationSlot} />
                  )}
                  <td className="px-3 py-2.5 text-right">
                    <RowActions view={view} rowId={r.id} patientId={r.patientId} />
                  </td>
                </tr>
              ))}

              {!isOpen && (
                <tr className="no-print">
                  <td colSpan={colCount} className="px-3 py-1.5 text-[11.5px] italic text-gray-400">
                    {g.rows.length} {g.rows.length === 1 ? countNoun : `${countNoun}s`} hidden on screen.
                    This day still prints in full.
                  </td>
                </tr>
              )}
            </tbody>
          );
        })}
      </table>
    </div>
  );
}

/**
 * The reference design's View button and overflow control.
 *
 * ⚠ s14: "DO NOT EXPOSE UNAVAILABLE ACTIONS AS ACTIVE CONTROLS." The comp draws a three-dot menu on every
 * row, and the honest version of that menu is currently empty -- Reschedule and Cancel are real engines
 * but they are not wired to this table, and a button that opens nothing is worse than no button. So the
 * overflow renders ONLY where it has somewhere to go, and View is a link rather than a button that looks
 * like one. When reschedule and cancel are wired in, this is the single place they attach.
 */
function RowActions({ view, rowId, patientId }: {
  view: "booked" | "seen"; rowId: string; patientId: string | null;
}) {
  // A seen row's id IS its encounter (s7: "View should open the relevant encounter").
  const href = view === "seen" ? `/practice/encounters/${rowId}`
    : patientId ? `/practice/patients/${patientId}` : null;
  if (!href)
    return <span className="text-[11.5px] italic text-gray-400" title="This booking names somebody who has no patient record yet">no record</span>;
  return (
    <Link href={href}
      className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-2.5 py-1 text-[12px] font-semibold text-gray-700 hover:border-[var(--cp-primary)] hover:text-[var(--cp-primary-deep)]">
      <span aria-hidden="true">&#128065;</span>
      {view === "seen" ? "View encounter" : "View"}
    </Link>
  );
}
