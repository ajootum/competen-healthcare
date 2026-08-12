"use client";

import { useState } from "react";
import Link from "next/link";
import {
  PatientCell, StatusBadge, ROW, THEAD, TH, TABLE_SCROLL,
  dayGroupCaption, type DayGroup,
} from "@/components/practice/PatientTable";

// CP-BOOKED-SEEN-001 s8: date-grouped results with per-day counts and collapsible groups.
//
// ⚠ THE ONLY CLIENT COMPONENT ON THIS PAGE, and it holds one thing: which days are closed. Everything it
// renders arrived pre-formatted from the server -- there is not a single function on the props. That is
// deliberate: a function on a payload passed to a client component type-checks, lints, passes every
// harness and then kills the page at runtime, and this codebase has shipped that bug before.
//
// ⚠ COLLAPSED ROWS ARE STILL RENDERED, AND HIDDEN IN CSS. The obvious version -- `isOpen && rows.map()`
// -- takes them out of the DOM entirely, and then no print rule can bring them back: a reader collapses
// August to look at September, prints, and files a register with a day silently missing from it. Nothing
// on the paper would say so. So collapsing is a SCREEN affordance only, `.cp-day-closed` restores
// `display: table-row` inside @media print, and the harness asserts that pairing.
//
// ⚠ THE GROUP HEADER IS A <button>, not a div with onClick (s17: expand/collapse must be keyboard
// accessible). aria-expanded and aria-controls point at the tbody, so the state is announced rather than
// left to a rotated chevron that a screen reader cannot see.

export default function GroupedTable({ groups, view, showLocation, countNoun }: {
  groups: DayGroup[];
  view: "booked" | "seen";
  /** s8: false when exactly one location is selected, because the value repeats on every row. */
  showLocation: boolean;
  countNoun: string;
}) {
  // s8: "the current/first relevant date should be expanded by default". Tracking what is CLOSED rather
  // than what is open means a fresh set is an all-expanded table, so a day that arrives later -- a wider
  // date range, say -- opens rather than inheriting somebody else's collapse.
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const toggle = (day: string) => setClosed(prev => {
    const next = new Set(prev);
    if (next.has(day)) next.delete(day); else next.add(day);
    return next;
  });

  const timeHeading = view === "booked" ? "Time" : "Seen at";
  const kindHeading = view === "booked" ? "Appointment" : "Encounter";
  const colCount = 5 + (showLocation ? 1 : 0);

  return (
    <div className={TABLE_SCROLL}>
      <table className="w-full border-collapse">
        <thead className={THEAD}>
          <tr>
            <th scope="col" className={`${TH} w-[86px]`}>{timeHeading}</th>
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
                {/* s8: the date header spans the table and carries THIS DAY's count, not the total. */}
                <th scope="colgroup" colSpan={colCount}
                  className="border-t border-gray-200 bg-gray-50/60 p-0 text-left">
                  <button type="button" onClick={() => toggle(g.day)}
                    aria-expanded={isOpen} aria-controls={bodyId}
                    className="no-print flex w-full items-center gap-2 px-3 py-1.5 text-[12px] font-bold text-gray-700 hover:bg-gray-100">
                    <span aria-hidden="true" className={`text-[9px] text-gray-400 transition-transform ${isOpen ? "rotate-90" : ""}`}>
                      &#9654;
                    </span>
                    {dayGroupCaption(g, countNoun)}
                    {/* The state as a word, so it is not carried by the chevron's angle alone. */}
                    <span className="sr-only">{isOpen ? "expanded" : "collapsed"}</span>
                  </button>
                  {/* The same caption without the control, for paper. */}
                  <span className="print-only px-3 py-1.5 text-[12px] font-bold text-gray-700">
                    {dayGroupCaption(g, countNoun)}
                  </span>
                </th>
              </tr>

              {g.rows.map(r => (
                <tr key={r.id} className={`${ROW} ${isOpen ? "" : "cp-day-closed"}`}>
                  <td className="whitespace-nowrap px-3 py-2 text-[13px] font-semibold tabular-nums text-gray-900">
                    {r.time}
                  </td>
                  <PatientCell patientId={r.patientId} name={r.patientName} patientNumber={r.patientNumber}
                    unlinkedTitle="Named at booking, before a patient record existed" />
                  <td className="px-3 py-2 text-[12.5px] text-gray-600">{r.kind}</td>
                  <td className="px-3 py-2">
                    <StatusBadge status={r.status} kind={view === "booked" ? "appointment" : "encounter"} />
                  </td>
                  {showLocation && (
                    <td className="px-3 py-2 text-[12.5px] text-gray-600">{r.locationName ?? "not named"}</td>
                  )}
                  <td className="px-3 py-2 text-right">
                    {/* ⚠ s14: "do not expose unavailable actions as active controls". A seen row's id IS
                        the encounter, so View opens it (s7). A booked row has no appointment page, so it
                        offers the patient -- and where there is no patient record either it offers
                        nothing, rather than a control that would go nowhere. */}
                    {view === "seen"
                      ? <Link href={`/practice/encounters/${r.id}`}
                        className="text-[12px] font-semibold text-[var(--cp-primary-deep)] hover:underline">
                        View encounter
                      </Link>
                      : r.patientId
                        ? <Link href={`/practice/patients/${r.patientId}`}
                          className="text-[12px] font-semibold text-[var(--cp-primary-deep)] hover:underline">
                          View patient
                        </Link>
                        : <span className="text-[11.5px] text-gray-400">no record</span>}
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
