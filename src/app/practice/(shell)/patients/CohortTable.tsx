"use client";

import Link from "next/link";
import { PLACE_BOUNDARY, MEDICATION_NOT_CURRENT_REASON } from "@/lib/practice/patient-workspace-constants";
import { Absence, CARD, day } from "./Honesty";
import { UNSUPPLIED_COLUMN } from "./refusals";
import type { CohortRowView, CohortView, WorklistView } from "./types";
import { COHORT_RING, JOURNEY_ICON, PATIENT_STATUS_SWATCH } from "@/lib/practice/palette";

// CPR-PAT-002 s4 -- the Longitudinal Patient Register.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// SEVEN COLUMNS ARE ASKED FOR. FOUR ARE REAL, THREE ARE NOT, AND THE THREE SAY WHY IN THE HEADER.
//
// Patient, Last Seen, Next Review and Status come out of myPatients(), which derives all but the first
// at read time and reports separately whether each derivation could be made. Active Problems, Current
// Treatments and the Journey Snapshot figures are not in the payload at all -- the engine's enrichment
// covers identifiers, encounters, follow-ups and the queue, and nothing else. Each of those three
// columns keeps its place and prints the batched read the engine would need, because a column silently
// dropped from a register reads as "these patients have no problems recorded".
//
// ⚠ THE JOURNEY SNAPSHOT HAS NO TRAJECTORY CHIP, AND THAT IS THE MOST DELIBERATE DECISION ON THIS
// SCREEN. The comp puts a green "Stable" or an amber "Monitor" beside a named child. Nothing in this
// database records a clinical trajectory -- no status, no severity, no scored observation over time --
// so every way of producing that chip is an invention, displayed as a clinical fact, next to a person's
// name, attributed to nobody. Encounters and procedures are countable and are what the column will hold
// once the engine returns them; the chip is refused outright and the cell says so.
//
// "CURRENT TREATMENTS" IS HEADED "TREATMENTS DECIDED". practice_treatment is a MedicationPlan and its
// `duration` is free text, so a course decided in March cannot be known to have ended. The heading is
// the one place that distinction can be made where it is read.
//
// SELECTING A ROW OPENS THE SUMMARY PANEL; the name is also a link to the full longitudinal record, which
// is CPR-PAT-002 s10's "one-click patient timeline".
// ────────────────────────────────────────────────────────────────────────────────────────────────────

const th = "px-3 py-2.5 text-left text-[10.5px] font-bold uppercase tracking-[0.06em] text-gray-500";
const td = "px-3 py-3 align-top text-[13px] text-gray-800";

/** Initials, because there are no photographs and there is no photo storage to put one in. */
function initials(name: string | null): string {
  if (!name) return "··";
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "··";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function LastSeen({ row }: { row: CohortRowView }) {
  // THREE STATES, AND THE MIDDLE ONE IS THE POINT. The enrichment read is capped; if it hit the cap and
  // this patient had no row in it, nobody knows whether they have been seen.
  if (!row.lastSeenKnown) return <span className="text-[var(--cmp-text-warning)]">not known</span>;
  if (!row.lastSeen) return <span className="text-gray-400">never seen here</span>;
  const p = row.location;
  const place = [p.locationName, p.facilityName].filter(Boolean).join(" · ");
  return (
    <span>
      <span className="font-medium">{day(row.lastSeen)}</span>
      {/* THE PLACE, NEVER A CARE SETTING -- see PLACE_BOUNDARY under the table. */}
      <span className="mt-0.5 block text-[11px] text-gray-500">
        {place || (p.source === null ? "no encounter recorded here" : "place not named on the encounter")}
      </span>
    </span>
  );
}

function NextReview({ row }: { row: CohortRowView }) {
  if (!row.nextFollowUpKnown) return <span className="text-[var(--cmp-text-warning)]">not known</span>;
  if (!row.nextFollowUp) return <span className="text-gray-400">none open</span>;
  return (
    <span>
      <span className="font-medium">{row.nextFollowUp.dueOn}</span>
      {row.nextFollowUp.overdue && (
        <span className="ml-1.5 rounded-md bg-rose-100 px-1.5 py-0.5 text-[10px] font-bold text-rose-700">
          overdue
        </span>
      )}
      <span className="mt-0.5 block text-[11px] text-gray-500">{row.nextFollowUp.reason}</span>
    </span>
  );
}

/**
 * A cell for a column CPR-PAT-002 asks for and myPatients() does not return.
 *
 * NOT AN EMPTY CELL AND NOT A ZERO. Both would be read as a fact about this patient. The dash is
 * uniform down the column so it reads as a property of the column rather than of any one row, and the
 * reason is printed once in the header where it belongs.
 */
function NotReturned() {
  return <span className="text-[13px] text-slate-300" title="Not returned by the engine for a page of patients">&mdash;</span>;
}

export default function CohortTable({
  cohort, worklist, selectedPatientId, onSelect, onScope, onSort, onPage, pending,
}: {
  cohort: CohortView | null;
  /** Set when a card is filtering this register -- it carries WHY each row is on the list. */
  worklist: WorklistView | null;
  selectedPatientId: string | null;
  onSelect: (patientId: string) => void;
  onScope: (scope: "practice" | "mine") => void;
  onSort: (sort: "registered" | "name") => void;
  onPage: (page: number) => void;
  pending: boolean;
}) {
  const heading = worklist ? worklist.title : "Longitudinal patient register";
  const reasonOnList = new Map<string, { note: string; when: string | null }>();
  for (const r of worklist?.rows ?? []) {
    if (r.patientId && !reasonOnList.has(r.patientId)) reasonOnList.set(r.patientId, { note: r.note, when: r.when });
  }
  const namelessRows = (worklist?.rows ?? []).filter(r => !r.patientId).length;
  // A FILTERED TABLE SHORTER THAN THE CARD THAT OPENED IT HAS TO SAY WHY. The gap is records that could
  // not be returned -- merged into another record, most often -- and an unexplained gap between a count
  // and a list is exactly the thing that makes people stop trusting both.
  const unreachable = worklist && cohort && cohort.total !== null
    ? worklist.patientIds.length - cohort.total
    : 0;

  return (
    <section className={`${CARD} overflow-hidden ${pending ? "opacity-60" : ""}`}>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-[14px] font-bold text-gray-900">{heading}</h2>
          {cohort && !cohort.unavailable && (
            <span className="rounded-full bg-[var(--cp-primary)]/10 px-2 py-0.5 text-[11.5px] font-bold text-[var(--cp-primary-deep)]">
              {cohort.total === null ? "count unavailable" : cohort.total}
            </span>
          )}
          {worklist && (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800">
              filtered
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {!worklist && (
            <div className="flex overflow-hidden rounded-lg border border-gray-200">
              {([["practice", "Whole practice"], ["mine", "Only mine"]] as const).map(([k, l]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => onScope(k)}
                  aria-pressed={cohort?.scope === k}
                  className={`px-2.5 py-1 text-[12px] font-semibold ${cohort?.scope === k
                    ? "bg-[var(--cp-primary)] text-white"
                    : "bg-white text-gray-600 hover:bg-gray-50"}`}
                >
                  {l}
                </button>
              ))}
            </div>
          )}
          <label className="text-[12px] text-gray-500">
            Sort{" "}
            <select
              value={cohort?.sort ?? "registered"}
              onChange={e => onSort(e.target.value === "name" ? "name" : "registered")}
              className="rounded-lg border border-gray-200 px-2 py-1 text-[12px] text-gray-700"
            >
              {(cohort?.sortOptions ?? []).map(o => (
                <option key={o.key} value={o.key} disabled={!o.available}>
                  {o.label}{o.available ? "" : " (not available)"}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <p className="border-b border-gray-100 px-4 py-2 text-[12px] text-gray-500">
        {worklist
          ? worklist.note
          : cohort?.scope === "mine"
            ? "Patients you have opened an encounter for, most recently registered first."
            : "Everybody on this practice's register, with the continuity of care recorded against them."}
      </p>

      {/* "Only mine" means the patients this practitioner has CONSULTED -- the one practitioner-to-patient
          link this schema holds. Said here, because a scope whose meaning is guessed is a scope that is
          read as "my caseload", which this product does not record. */}
      {!worklist && cohort?.scope === "mine" && (
        <p className="border-b border-gray-100 bg-gray-50/60 px-4 py-2 text-[11px] text-gray-500">
          &ldquo;Mine&rdquo; is every patient you have opened an encounter for. This practice does not record
          a caseload or a named responsible clinician, so that link is the only one there is.
          {cohort.enrichment.scopeMine?.truncated && " More encounters exist than could be read, so this list may be short."}
        </p>
      )}

      {cohort === null ? (
        <div className="p-4">
          <Absence
            reason={worklist?.reason ?? "read_failed"}
            error={worklist?.error ?? null}
            nothing="This list could not be opened."
          />
        </div>
      ) : cohort.unavailable ? (
        <div className="p-4">
          <Absence reason={cohort.reason} error={cohort.error} nothing="Nothing to show." />
        </div>
      ) : cohort.rows.length === 0 ? (
        <div className="p-4">
          <p className="text-[13px] text-gray-500">
            {worklist
              ? namelessRows > 0
                ? "Nobody on this list has a patient record behind them yet."
                : "Nothing is on this list."
              : cohort.scope === "mine"
                ? "You have not consulted anybody on this register yet."
                : "No patient has been registered at this practice yet."}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1080px] border-collapse">
            <thead className="bg-gray-50/80">
              <tr>
                <th className={th}>Patient</th>
                <th className={th}>Active problems</th>
                <th className={th}>
                  Treatments decided
                  {/* ⚠ NOT "CURRENT". The distinction cannot be made anywhere else and this is where the
                      column is read. */}
                  <span className="mt-0.5 block text-[9.5px] font-medium normal-case tracking-normal text-gray-400">
                    not &ldquo;current&rdquo;
                  </span>
                </th>
                <th className={th}>Last seen</th>
                <th className={th}>Next review</th>
                <th className={th}>Journey snapshot</th>
                <th className={th}>Status</th>
                {worklist && <th className={th}>On this list because</th>}
              </tr>
            </thead>
            <tbody>
              {cohort.rows.map((r, i) => {
                const why = reasonOnList.get(r.patientId);
                const active = selectedPatientId === r.patientId;
                return (
                  <tr
                    key={r.patientId}
                    className={`border-t border-gray-100 ${active ? "bg-[var(--cp-primary)]/[0.05]" : "hover:bg-gray-50/70"}`}
                  >
                    <td className={td}>
                      <span className="flex items-start gap-2.5">
                        {/* NO PHOTOGRAPH. There is no file storage and no photo column; the comp's
                            avatars are initials here, derived from the name that is stored. */}
                        <span
                          aria-hidden
                          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[12px] font-bold ${COHORT_RING[i % COHORT_RING.length]}`}
                        >
                          {initials(r.name)}
                        </span>
                        <span className="min-w-0">
                          <button
                            type="button"
                            onClick={() => onSelect(r.patientId)}
                            aria-current={active}
                            className="text-left text-[13.5px] font-semibold text-gray-900 hover:text-[var(--cp-primary-deep)] hover:underline"
                          >
                            {r.name ?? <span className="font-normal italic text-gray-400">name withheld</span>}
                          </button>
                          {r.deIdentified && (
                            <span className="block text-[11px] text-gray-400">
                              You may see that this record exists, not who it is.
                            </span>
                          )}
                          <span className="mt-1 flex flex-wrap items-center gap-1">
                            {r.practiceId
                              ? <span className="rounded-md bg-[var(--cp-primary)]/10 px-1.5 py-0.5 font-mono text-[10.5px] font-semibold text-[var(--cp-primary-deep)]">{r.practiceId}</span>
                              : <span className="text-[10.5px] text-gray-400">no Practice ID issued</span>}
                            {/* HOSPITAL NUMBERS BESIDE THE NAME, not hidden in demographics. */}
                            {r.hospitalNumbers.map(h => (
                              <span key={h.id} className="rounded-md bg-emerald-50 px-1.5 py-0.5 font-mono text-[10.5px] text-emerald-800">
                                {h.value}{h.facilityName ? ` · ${h.facilityName}` : ""}
                              </span>
                            ))}
                            {r.recordStatus !== "active" && (
                              <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600">
                                {r.recordStatus}
                              </span>
                            )}
                          </span>
                          <Link
                            href={`/practice/patients/${r.patientId}`}
                            className="mt-1 inline-block text-[11px] font-semibold text-[var(--cp-primary-deep)] hover:underline"
                          >
                            Open timeline &rarr;
                          </Link>
                        </span>
                      </span>
                    </td>
                    <td className={td}><NotReturned /></td>
                    <td className={td}><NotReturned /></td>
                    <td className={td}><LastSeen row={r} /></td>
                    <td className={td}><NextReview row={r} /></td>
                    <td className={td}>
                      <span className="flex flex-col gap-0.5 text-[11.5px] text-slate-400">
                        <span><span aria-hidden className="mr-1">{JOURNEY_ICON.encounters}</span>encounters &mdash;</span>
                        <span><span aria-hidden className="mr-1">{JOURNEY_ICON.procedures}</span>procedures &mdash;</span>
                        {/* ⚠ WHERE THE COMP'S TRAJECTORY CHIP WOULD BE. */}
                        <span className="text-[10.5px] italic text-slate-400">no trajectory recorded</span>
                      </span>
                    </td>
                    <td className={td}>
                      <span className={`inline-block rounded-md px-2 py-0.5 text-[11px] font-semibold ${PATIENT_STATUS_SWATCH[r.currentStatus.code] ?? "bg-slate-100 text-slate-600 ring-1 ring-slate-200"}`}>
                        {r.currentStatus.label}
                      </span>
                    </td>
                    {worklist && (
                      <td className={td}>
                        {why
                          ? <>{why.note}{why.when && <span className="block text-[11px] text-gray-500">{day(why.when)}</span>}</>
                          : <span className="text-gray-400">&mdash;</span>}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-gray-100 p-3">
        <p className="text-[11px] text-gray-500">
          {cohort && !cohort.unavailable && (
            <>
              Showing {cohort.rows.length} of{" "}
              {cohort.total === null
                ? <span className="font-semibold text-[var(--cmp-text-warning)]">a total that could not be counted</span>
                : <span className="font-semibold text-gray-700">{cohort.total}</span>}
              {" "}· page {cohort.page + 1} · {cohort.pageSize} a page.
            </>
          )}
          {namelessRows > 0 && (
            <span className="block text-[var(--cmp-text-warning)]">
              {namelessRows} {namelessRows === 1 ? "entry on this list has" : "entries on this list have"} no patient
              record behind {namelessRows === 1 ? "it" : "them"} &mdash; checked in by name before a record existed, so
              {namelessRows === 1 ? " it is" : " they are"} not in the table above.
            </span>
          )}
          {unreachable > 0 && (
            <span className="block text-[var(--cmp-text-warning)]">
              {unreachable} {unreachable === 1 ? "person" : "people"} on this list {unreachable === 1 ? "has" : "have"} no
              record this table can return &mdash; most often a record merged into another one, which is a pointer
              rather than a person.
            </span>
          )}
          {cohort && Object.entries(cohort.enrichment).filter(([, e]) => !e.ok).map(([k, e]) => (
            <span key={k} className="block text-[var(--cmp-text-warning)]">
              {k} could not be read: {e.error ?? "no reason given"}. The columns it fills read &ldquo;not known&rdquo;.
            </span>
          ))}
        </p>
        {cohort && !cohort.unavailable && (
          <span className="flex items-center gap-2">
            <button
              type="button"
              disabled={cohort.page === 0 || pending}
              onClick={() => onPage(cohort.page - 1)}
              className="rounded-lg border border-gray-200 px-2.5 py-1 text-[12px] font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-40"
            >
              Previous
            </button>
            <button
              type="button"
              disabled={!cohort.hasMore || pending}
              onClick={() => onPage(cohort.page + 1)}
              className="rounded-lg border border-gray-200 px-2.5 py-1 text-[12px] font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-40"
            >
              Next
            </button>
          </span>
        )}
      </div>

      {/* ── What the three empty columns need, and why the fourth cell has no chip ─────────────────── */}
      <div className="border-t border-gray-100 bg-gray-50/60 px-4 py-2.5">
        <details className="group">
          <summary className="cursor-pointer list-none text-[11.5px] font-semibold text-gray-600 hover:text-gray-900">
            <span className="mr-1 inline-block text-gray-400 transition-transform group-open:rotate-90">&rsaquo;</span>
            Three of these columns are empty on purpose, and the Journey Snapshot has no trajectory chip
          </summary>
          <ul className="mt-1.5 flex flex-col gap-1.5 pl-3 text-[11px] leading-relaxed text-gray-500">
            <li>
              <span className="font-semibold text-gray-600">Active problems.</span> {UNSUPPLIED_COLUMN.activeProblems}
            </li>
            <li>
              <span className="font-semibold text-gray-600">Treatments decided.</span> {UNSUPPLIED_COLUMN.treatmentsDecided}{" "}
              And it will never be headed &ldquo;current&rdquo;: {MEDICATION_NOT_CURRENT_REASON}
            </li>
            <li>
              <span className="font-semibold text-gray-600">Journey snapshot.</span> {UNSUPPLIED_COLUMN.journeySnapshot}
            </li>
            <li>
              <span className="font-semibold text-gray-600">No trajectory chip.</span> The design shows
              &ldquo;Stable&rdquo;, &ldquo;Improving&rdquo; and &ldquo;Monitor&rdquo; beside each patient&rsquo;s name.
              Nothing in this record holds a clinical trajectory &mdash; no status, no severity, no scored
              observation over time &mdash; so the chip would be an assessment of that patient made by nobody
              and displayed as fact. It is refused, not approximated.
            </li>
          </ul>
        </details>
        <p className="mt-2 border-t border-gray-200/70 pt-2 text-[11px] leading-relaxed text-gray-500">
          <span className="font-semibold text-gray-600">Last seen shows a place, not a care setting.</span> {PLACE_BOUNDARY}
        </p>
      </div>
    </section>
  );
}
