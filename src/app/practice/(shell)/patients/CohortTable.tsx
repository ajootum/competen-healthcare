"use client";

import { PLACE_BOUNDARY } from "@/lib/practice/patient-workspace-constants";
import { Absence, CARD, day } from "./Honesty";
import type { CohortRowView, CohortView, WorklistView } from "./types";

// CPR-V5-006 s3 -- My Patients: the largest section and the primary working area.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// THE SEVEN COLUMNS ARE THE SPECIFICATION'S, AND FOUR OF THEM ARE DERIVED AT READ TIME.
//
// Name, Practice ID, Hospital Numbers, Last Seen, Next Follow-up, Current Status, Location. Last seen
// comes from the encounter table, the follow-up from the obligation table, the status from four sources
// at once and the location from the encounter's place. None of them is stored on the patient row, which
// is why each one can be UNKNOWN separately from being EMPTY -- and why this table has three renderings
// for every cell rather than two.
//
// "LAST SEEN" IS NOT A SORT OPTION, AND THE CONTROL SAYS SO RATHER THAN VANISHING. It is computed after
// the page is fetched, so ordering on it would order twenty-five rows correctly and hand you a page two
// that overlapped page one. The engine reports it as an unavailable option with its reason attached; a
// disabled option with the reason beside it is more useful than a control that silently is not there.
//
// SELECTING A ROW OPENS THE SUMMARY PANEL, IT DOES NOT LEAVE THE WORKSPACE. The row is a button that
// puts ?patient=<id> in the URL; the panel beside the table answers it. The full record is still one
// click further on, for the things a panel cannot do.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

const th = "px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-gray-500";
const td = "px-3 py-2 align-top text-[13px] text-gray-800";

const STATUS_TINT: Record<string, string> = {
  in_consultation: "bg-[var(--cmp-surface-warning)] text-[var(--cmp-text-warning)]",
  waiting: "bg-amber-50 text-amber-800",
  encounter_open: "bg-cyan-50 text-cyan-800",
  seen: "bg-gray-100 text-gray-600",
  registered_not_seen: "bg-violet-50 text-violet-800",
  archived: "bg-gray-100 text-gray-500",
  merged: "bg-rose-50 text-rose-800",
};

function LastSeen({ row }: { row: CohortRowView }) {
  // THREE STATES, AND THE MIDDLE ONE IS THE POINT. The enrichment read is capped; if it hit the cap and
  // this patient had no row in it, nobody knows whether they have been seen.
  if (!row.lastSeenKnown) return <span className="text-[var(--cmp-text-warning)]">not known</span>;
  if (!row.lastSeen) return <span className="text-gray-400">never seen here</span>;
  return <span>{day(row.lastSeen)}</span>;
}

function NextFollowUp({ row }: { row: CohortRowView }) {
  if (!row.nextFollowUpKnown) return <span className="text-[var(--cmp-text-warning)]">not known</span>;
  if (!row.nextFollowUp) return <span className="text-gray-400">none open</span>;
  return (
    <span>
      {row.nextFollowUp.dueOn}
      {row.nextFollowUp.overdue && (
        <span className="ml-1 rounded bg-[var(--cmp-surface-critical)] px-1 py-0.5 text-[10px] font-semibold text-[var(--cmp-text-critical)]">
          overdue
        </span>
      )}
      <span className="block text-[11px] text-gray-500">{row.nextFollowUp.reason}</span>
    </span>
  );
}

function Where({ row }: { row: CohortRowView }) {
  const p = row.location;
  if (p.source === null) return <span className="text-gray-400">no encounter recorded here</span>;
  const parts = [p.locationName, p.facilityName].filter(Boolean) as string[];
  return (
    <span>
      {parts.length > 0 ? parts.join(" · ") : <span className="text-gray-400">place not named on the encounter</span>}
      {p.activityTitle && <span className="block text-[11px] text-gray-500">{p.activityTitle}</span>}
    </span>
  );
}

export default function CohortTable({
  cohort, worklist, selectedPatientId, onSelect, onScope, onSort, onPage, pending,
}: {
  cohort: CohortView | null;
  /** Set when a worklist tile is filtering this table -- it carries WHY each row is on the list. */
  worklist: WorklistView | null;
  selectedPatientId: string | null;
  onSelect: (patientId: string) => void;
  onScope: (scope: "practice" | "mine") => void;
  onSort: (sort: "registered" | "name") => void;
  onPage: (page: number) => void;
  pending: boolean;
}) {
  const heading = worklist ? worklist.title : "My patients";
  const reasonOnList = new Map<string, { note: string; when: string | null }>();
  for (const r of worklist?.rows ?? []) {
    if (r.patientId && !reasonOnList.has(r.patientId)) reasonOnList.set(r.patientId, { note: r.note, when: r.when });
  }
  const namelessRows = (worklist?.rows ?? []).filter(r => !r.patientId).length;
  // A FILTERED TABLE SHORTER THAN THE TILE THAT OPENED IT HAS TO SAY WHY. The gap is records that could
  // not be returned -- merged into another record, most often -- and an unexplained gap between a count
  // and a list is exactly the thing that makes people stop trusting both.
  const unreachable = worklist && cohort && cohort.total !== null
    ? worklist.patientIds.length - cohort.total
    : 0;

  return (
    <section className={`${CARD} overflow-hidden ${pending ? "opacity-60" : ""}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-gray-100 p-4">
        <div>
          <h2 className="text-[14px] font-bold text-gray-900">{heading}</h2>
          <p className="mt-0.5 text-[12px] text-gray-500">
            {worklist
              ? worklist.note
              : cohort?.scope === "mine"
                ? "Patients you have consulted, most recently registered first."
                : "Everybody on this practice's register."}
          </p>
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
          <table className="w-full min-w-[900px] border-collapse">
            <thead className="bg-gray-50/80">
              <tr>
                <th className={th}>Name</th>
                <th className={th}>Practice ID</th>
                <th className={th}>Hospital numbers</th>
                <th className={th}>Last seen</th>
                <th className={th}>Next follow-up</th>
                <th className={th}>Current status</th>
                <th className={th}>Location</th>
                {worklist && <th className={th}>On this list because</th>}
              </tr>
            </thead>
            <tbody>
              {cohort.rows.map(r => {
                const why = reasonOnList.get(r.patientId);
                const active = selectedPatientId === r.patientId;
                return (
                  <tr
                    key={r.patientId}
                    className={`border-t border-gray-100 ${active ? "bg-[var(--cp-primary)]/5" : "hover:bg-gray-50/70"}`}
                  >
                    <td className={td}>
                      <button
                        type="button"
                        onClick={() => onSelect(r.patientId)}
                        aria-current={active}
                        className="text-left text-[13px] font-semibold text-gray-900 hover:text-[var(--cp-primary-deep)] hover:underline"
                      >
                        {r.name ?? <span className="font-normal italic text-gray-400">name withheld</span>}
                      </button>
                      {r.deIdentified && (
                        <span className="block text-[11px] text-gray-400">
                          You may see that this record exists, not who it is.
                        </span>
                      )}
                      {r.recordStatus !== "active" && (
                        <span className="mt-0.5 inline-block rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold text-gray-600">
                          {r.recordStatus}
                        </span>
                      )}
                    </td>
                    <td className={`${td} font-mono text-[12px]`}>
                      {r.practiceId ?? <span className="font-sans text-gray-400">none issued</span>}
                    </td>
                    <td className={td}>
                      {/* TOGETHER WITH THE PRACTICE ID, NOT HIDDEN IN DEMOGRAPHICS -- the acceptance
                          criterion, rendered as a column of its own. */}
                      {r.hospitalNumbers.length === 0
                        ? <span className="text-gray-400">none recorded</span>
                        : (
                          <ul className="flex flex-col gap-0.5">
                            {r.hospitalNumbers.map(h => (
                              <li key={h.id} className="font-mono text-[12px]">
                                {h.value}
                                {h.facilityName && <span className="font-sans text-[11px] text-gray-500"> · {h.facilityName}</span>}
                              </li>
                            ))}
                          </ul>
                        )}
                    </td>
                    <td className={td}><LastSeen row={r} /></td>
                    <td className={td}><NextFollowUp row={r} /></td>
                    <td className={td}>
                      <span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${STATUS_TINT[r.currentStatus.code] ?? "bg-gray-100 text-gray-600"}`}>
                        {r.currentStatus.label}
                      </span>
                    </td>
                    <td className={td}><Where row={r} /></td>
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

      <p className="border-t border-gray-100 bg-gray-50/60 px-4 py-2 text-[11px] leading-relaxed text-gray-500">
        <span className="font-semibold text-gray-600">Location is a place, not a care setting.</span> {PLACE_BOUNDARY}
      </p>
    </section>
  );
}
