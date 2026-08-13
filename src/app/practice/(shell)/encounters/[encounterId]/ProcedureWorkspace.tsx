"use client";

import { Fragment, useState } from "react";
import { useRouter } from "next/navigation";
import {
  PANEL, SectionHeader, Badge, Tip, EmptyState,
  WS_HEAD, WS_TH, WS_ROW, WS_TD, ROW_REMOVE,
} from "@/components/practice/EncounterKit";
import {
  ClinicalRecordTable, type RecordColumn, type RowState,
} from "@/components/practice/ClinicalRecordTable";
// ⚠ FROM THE CONSTANTS FILE, NEVER FROM procedures.ts. That module reaches access.ts and next/headers,
// and one string imported from it into a "use client" component drags the whole server module into the
// browser bundle -- which tsc and eslint both wave through and only `next build` catches. It has
// happened three times in this codebase; procedure-constants.ts exists precisely so it cannot here.
import {
  LATERALITIES, CONSENT_STATUSES, PROCEDURE_STATUSES, PROCEDURE_STATUSES_NEEDING_REASON, procedureBand,
  OUTCOME_TYPES, OUTCOME_SEVERITIES, SEVERITY_REQUIRED_FOR,
} from "@/lib/practice/procedure-constants";

// ⚠ THE ENGINE'S OWN LIST, WIDENED TO string SO THE SCREEN CANNOT HOLD A SECOND OPINION. If this were
// retyped here, the day somebody added a status needing a reason the engine would refuse the batch and
// the field asking for that reason would never be drawn.
const NEEDS_REASON: readonly string[] = PROCEDURE_STATUSES_NEEDING_REASON;

// CP-ENC-PROC-001: searchable catalogue -> working set -> procedure-specific fields -> batch record.
//
// ⚠ THE SIDED RULE IS THE SERVER'S, AND THIS SCREEN DOES NOT PRE-EMPT IT. recordProcedure refuses a
// sided procedure recorded with no side, by name. The row leaves laterality at whatever was chosen and
// lets that refusal come back, because a default of "not sided" would satisfy the check with a value
// nobody selected -- and on a sided procedure that is a wrong-site record.
//
// ⚠ AND s6's "ONLY SHOW FIELDS CLINICALLY RELEVANT TO THE SELECTED PROCEDURE" IS NOT IMPLEMENTED. It
// needs per-type field requirements from the catalogue, which this screen does not yet read. Every field
// is offered on every row instead, and the tip says so -- an unbuilt rule that hides fields would be
// worse than one that shows them all.

type Row = {
  key: string;
  label: string;
  site: string;
  laterality: string;
  consentStatus: string;
  status: string;
  // ⚠ THE THREE THE FIRST WIRING ATTEMPT DROPPED. The engine accepts all of them and the form this
  // workspace replaces collected all of them, so leaving them out was reduced clinical capture rather
  // than a simplification. 13a-2 caught it; nothing on the screen would have.
  indication: string;
  immediateOutcome: string;
  abandonedReason: string;
  /** CPR-TRT-PROC-003 s10. Only meaningful while the status is SCHEDULED, and required by the engine then. */
  scheduledAt: string;
  outcome?: { ok: boolean; message?: string };
};

type Recorded = {
  id: string; label: string; site?: string | null; laterality?: string | null;
  status?: string | null; immediate_outcome?: string | null;
};

// CP-UI-TABLE-001 s5: Procedure | Status | Date/Timing | Location/Detail | Actions.
const PROCEDURE_COLUMNS: RecordColumn<Recorded>[] = [
  { key: "label", label: "Procedure", priority: "primary",
    render: p => {
      const band = procedureBand(p.status ?? "");
      return (
        <>
          <span className={band.struck ? "font-semibold text-gray-400 line-through" : "font-semibold text-gray-800"}>
            {p.label}
          </span>
          {p.laterality && p.laterality !== "not_applicable" && (
            <span className="ml-1.5"><Badge tone="neutral">{p.laterality}</Badge></span>
          )}
        </>
      );
    } },
  // ⚠ EVERY STATUS IS NAMED, INCLUDING PERFORMED. Before the lifecycle existed this column drew a badge
  // only when something was NOT performed, so the absence of a badge was the only thing separating a
  // completed procedure from one nobody had done. In a column that is a blank cell.
  { key: "status", label: "Status", priority: "status",
    render: p => p.status === "PERFORMED"
      ? <span className="text-[11.5px] text-gray-600">performed</span>
      : (
        <Badge tone={p.status === "ATTEMPTED" || p.status === "ABANDONED" ? "needs" : "muted"}>
          {(PROCEDURE_STATUSES.find(([k]) => k === p.status)?.[1] ?? p.status ?? "unknown").toLowerCase()}
        </Badge>
      ) },
  { key: "site", label: "Site", priority: "secondary",
    render: p => p.site ? <span className="text-[11.5px] text-gray-600">{p.site}</span>
      : <span className="text-gray-400">&mdash;</span> },
  { key: "outcome", label: "Immediate outcome", priority: "secondary",
    render: p => p.immediate_outcome
      ? <span className="text-[11.5px] text-gray-600">{p.immediate_outcome}</span>
      : <span className="text-gray-400">&mdash;</span> },
];

let seq = 0;
const newRow = (): Row => ({
  key: `p${++seq}`, label: "", site: "", laterality: "not_applicable",
  consentStatus: "not_recorded", status: "PERFORMED",
  indication: "", immediateOutcome: "", abandonedReason: "", scheduledAt: "",
});

export default function ProcedureWorkspace(props: {
  encounterId: string;
  recorded: Recorded[];
  editable: boolean;
  canRecord: boolean;
}) {
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>([newRow()]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  // ⚠ OUTCOME RECORDING, CARRIED OVER RATHER THAN LOST. The tab this workspace replaces held TWO
  // writers: the procedure form, and this. Recording an outcome against an ALREADY-RECORDED procedure is
  // what lets somebody walk from "this wound got infected" back to the day it was made, and the first
  // attempt at this rewrite deleted it silently -- it survived only because eslint reported an orphaned
  // function. It now hangs off the row it concerns rather than sitting in a separate form.
  //
  // ⚠ THE OBSERVING ENCOUNTER IS THIS ONE, which is the whole point: the outcome is attributed to the
  // consultation that noticed it, not to the one that performed the procedure.
  const [outcomeFor, setOutcomeFor] = useState<string | null>(null);
  const [outcome, setOutcome] = useState({ outcomeType: "healing", severity: "mild", detail: "" });

  const saveOutcome = async (procedureId: string) => {
    setBusy(true); setNotice(null);
    try {
      const res = await fetch(`/api/v1/practice/procedures/${procedureId}`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          observedAtEncounterId: props.encounterId,
          outcomeType: outcome.outcomeType,
          // ⚠ SEVERITY BELONGS TO A COMPLICATION AND TO NOTHING ELSE, and the engine enforces BOTH
          // directions -- so sending it on a "healing" outcome is refused rather than ignored.
          severity: SEVERITY_REQUIRED_FOR.includes(outcome.outcomeType) ? outcome.severity : undefined,
          detail: outcome.detail || undefined,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setNotice({ kind: "err", text: json?.error?.message ?? "That outcome was not recorded." });
        return;
      }
      setNotice({ kind: "ok", text: "Outcome recorded against this procedure." });
      setOutcomeFor(null);
      setOutcome({ outcomeType: "healing", severity: "mild", detail: "" });
      router.refresh();
    } catch {
      setNotice({ kind: "err", text: "That did not reach the server, so no outcome was recorded." });
    } finally { setBusy(false); }
  };

  const filled = rows.filter(r => r.label.trim() && !r.outcome?.ok);
  const set = (i: number, patch: Partial<Row>) =>
    setRows(p => p.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const commit = async () => {
    const items = rows.map((r, i) => ({ r, i })).filter(({ r }) => r.label.trim() && !r.outcome?.ok);
    if (!items.length) return;
    setBusy(true); setNotice(null);
    try {
      const res = await fetch("/api/v1/practice/procedures/batch", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          encounterId: props.encounterId,
          items: items.map(({ r }) => ({
            label: r.label.trim(), site: r.site.trim() || undefined,
            laterality: r.laterality, consentStatus: r.consentStatus, status: r.status,
            indication: r.indication.trim() || undefined,
            immediateOutcome: r.immediateOutcome.trim() || undefined,
            // ⚠ ONLY WHERE THE STATUS ASKS FOR IT. Sending a reason on a completed procedure would
            // record why something was stopped that was not stopped. The test is the engine's list
            // rather than one hard-coded status, so the two cannot disagree about which need one.
            abandonedReason: NEEDS_REASON.includes(r.status)
              ? (r.abandonedReason.trim() || undefined) : undefined,
            // Likewise: a scheduled time is meaningless on anything but SCHEDULED, and required there.
            scheduledAt: r.status === "SCHEDULED" ? (r.scheduledAt || undefined) : undefined,
          })),
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok && !Array.isArray(json?.results)) {
        setNotice({ kind: "err", text: json?.error?.message ?? "Nothing was recorded." });
        return;
      }
      // ⚠ MAPPED BY POSITION IN THE SUBMITTED LIST, not by row index. The two diverge the moment a blank
      // row is skipped, and mismatching them would attach one procedure's refusal to another's row.
      const results = (json.results ?? []) as { index: number; ok: boolean; message?: string }[];
      // ⚠ A RECORDED ROW LEAVES THE WORKING SET, the same fix the Diagnoses tab needed after the owner
      // found a recorded entry showing twice -- once in the list above, once as a dead locked row below.
      // The working set holds only what is still PENDING; what is recorded lives in the list, where
      // outcome recording hangs off it.
      setRows(prev => {
        const next = [...prev];
        for (const out of results) {
          const target = items[out.index];
          if (target) next[target.i] = { ...next[target.i], outcome: { ok: out.ok, message: out.message } };
        }
        const remaining = next.filter(r => !r.outcome?.ok);
        return remaining.length ? remaining : [newRow()];
      });
      const okCount = results.filter(r => r.ok).length;
      const bad = results.length - okCount;
      setNotice({
        kind: bad ? "err" : "ok",
        text: bad
          ? `${okCount} recorded, ${bad} not. Each row below says why -- nothing was dropped silently.`
          : `${okCount} ${okCount === 1 ? "procedure" : "procedures"} recorded.`,
      });
      router.refresh();
    } catch {
      setNotice({ kind: "err", text: "That did not reach the server, so nothing was recorded." });
    } finally { setBusy(false); }
  };

  const input = "w-full rounded-lg border border-gray-200 px-2 py-1 text-[12.5px]";

  return (
    <section className={PANEL}>
      <SectionHeader
        title="Procedures performed"
        subtitle="Add several procedures, then record them together."
      />

      <div className="p-4">
        {/* CP-UI-TABLE-001 s13 step 4, s5's columns: Procedure | Status | Date/Timing | Detail | Actions.
            ⚠ THE OUTCOME FORM IS s3.1's EXPANDABLE DETAIL, attached to the procedure it concerns. It
            used to be a second row hand-built here; the standard owns that shape now. */}
        <ClinicalRecordTable
          label="Procedures recorded for this patient"
          columns={PROCEDURE_COLUMNS}
          empty={<EmptyState title="No procedure recorded for this encounter"
            reason="This was read successfully -- add one below if something was done." />}
          records={props.recorded.map(p => ({
            id: p.id,
            data: p,
            // ⚠ s4 RESERVES `warning` FOR CLINICALLY ACTIONABLE ISSUES. A cancelled or declined
            // procedure is a fact rather than a problem, so it reads as `stopped`, not as an alarm.
            state: (p.status && ["CANCELLED", "DECLINED"].includes(p.status) ? "stopped"
              : p.status === "PERFORMED" ? "normal" : "normal") as RowState,
            stateLabel: p.status && p.status !== "PERFORMED" ? `${p.status.toLowerCase()} procedure` : undefined,
            actions: props.editable && props.canRecord ? (
              <button type="button" disabled={busy}
                onClick={() => setOutcomeFor(outcomeFor === p.id ? null : p.id)}
                aria-label={`Record an outcome for ${p.label}`}
                className="rounded-lg border border-gray-200 px-2 py-0.5 text-[11px] font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-50">
                {outcomeFor === p.id ? "Cancel" : "Record outcome"}
              </button>
            ) : undefined,
            expandedContent: outcomeFor === p.id ? (
              <form className="flex w-full flex-wrap items-end gap-2 rounded-lg bg-gray-50 p-2"
                onSubmit={e => { e.preventDefault(); saveOutcome(p.id); }}>
                <select value={outcome.outcomeType} disabled={busy} aria-label="Outcome"
                  onChange={e => setOutcome(o => ({ ...o, outcomeType: e.target.value }))}
                  className="rounded-lg border border-gray-200 px-2 py-1 text-[12px]">
                  {OUTCOME_TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select>
                {SEVERITY_REQUIRED_FOR.includes(outcome.outcomeType) && (
                  <select value={outcome.severity} disabled={busy} aria-label="Severity"
                    onChange={e => setOutcome(o => ({ ...o, severity: e.target.value }))}
                    className="rounded-lg border border-gray-200 px-2 py-1 text-[12px]">
                    {OUTCOME_SEVERITIES.map(sv => <option key={sv} value={sv}>{sv}</option>)}
                  </select>
                )}
                <input value={outcome.detail} disabled={busy} placeholder="What happened (optional)"
                  aria-label={`Outcome detail for ${p.label}`}
                  onChange={e => setOutcome(o => ({ ...o, detail: e.target.value }))}
                  className="min-w-[200px] flex-1 rounded-lg border border-gray-200 px-2 py-1 text-[12px]" />
                <button type="submit" disabled={busy}
                  className="rounded-lg bg-[var(--cp-primary)] px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-[var(--cp-primary-deep)] disabled:opacity-50">
                  Record outcome
                </button>
              </form>
            ) : undefined,
          }))}
        />

        {props.editable && props.canRecord && (
          <div className="mt-4">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead className={WS_HEAD}>
                  <tr>
                    <th scope="col" className={WS_TH}>Procedure</th>
                    <th scope="col" className={`${WS_TH} w-[130px]`}>Site</th>
                    <th scope="col" className={`${WS_TH} w-[120px]`}>Side</th>
                    <th scope="col" className={`${WS_TH} w-[130px]`}>Consent</th>
                    <th scope="col" className={`${WS_TH} w-[150px]`}>Status</th>
                    <th scope="col" className={`${WS_TH} w-[70px]`} />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    // ⚠ A FRAGMENT, BECAUSE EACH ROW IS NOW TWO <tr>s. Wrapping them in a div would be
                    // invalid inside a tbody and the browser would hoist it out of the table silently.
                    <Fragment key={r.key}>
                    <tr className={`${WS_ROW} ${r.outcome?.ok ? "bg-emerald-50/50" : r.outcome ? "bg-rose-50/50" : ""}`}>
                      <td className={WS_TD}>
                        <input value={r.label} disabled={busy || r.outcome?.ok === true}
                          placeholder="Name the procedure..." className={input}
                          onChange={e => set(i, { label: e.target.value, outcome: undefined })} />
                        {r.outcome && !r.outcome.ok && (
                          <p className="mt-1 text-[11px] font-semibold text-[var(--cmp-text-critical)]">{r.outcome.message}</p>
                        )}
                        {r.outcome?.ok && <p className="mt-1 text-[11px] font-semibold text-emerald-700">recorded</p>}
                      </td>
                      <td className={WS_TD}>
                        <input value={r.site} disabled={busy || r.outcome?.ok === true}
                          placeholder="Optional" className={input}
                          onChange={e => set(i, { site: e.target.value })} />
                      </td>
                      <td className={WS_TD}>
                        <select value={r.laterality} disabled={busy || r.outcome?.ok === true} className={input}
                          aria-label={`Side for ${r.label || "row " + (i + 1)}`}
                          onChange={e => set(i, { laterality: e.target.value })}>
                          {LATERALITIES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                        </select>
                      </td>
                      <td className={WS_TD}>
                        <select value={r.consentStatus} disabled={busy || r.outcome?.ok === true} className={input}
                          aria-label={`Consent for ${r.label || "row " + (i + 1)}`}
                          onChange={e => set(i, { consentStatus: e.target.value })}>
                          {CONSENT_STATUSES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                        </select>
                      </td>
                      <td className={WS_TD}>
                        <select value={r.status} disabled={busy || r.outcome?.ok === true} className={input}
                          aria-label={`Status for ${r.label || "row " + (i + 1)}`}
                          onChange={e => set(i, { status: e.target.value })}>
                          {PROCEDURE_STATUSES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                        </select>
                      </td>
                      <td className={`${WS_TD} text-right`}>
                        {rows.length > 1 && !r.outcome?.ok && (
                          <button type="button" disabled={busy} className={ROW_REMOVE}
                            onClick={() => setRows(p => p.filter((_, j) => j !== i))}>
                            Remove
                          </button>
                        )}
                      </td>
                    </tr>

                    {/* ⚠ THE THREE FIELDS THE FIRST WIRING ATTEMPT DROPPED, on a second line rather than
                        three more columns. Six columns already scroll on a laptop, and a field pushed off
                        the right edge is a field nobody fills -- which is how a capture loss happens
                        after the code is technically correct.

                        ⚠ ABANDONED REASON APPEARS ONLY WHEN THE STATUS IS ABANDONED. This is the first
                        piece of s6's "only show fields clinically relevant to the selected procedure" --
                        the rest needs per-type requirements from the catalogue, which this screen does
                        not read yet. Asking why something was stopped that was not stopped invites an
                        answer that contradicts the record beside it. */}
                    {!r.outcome?.ok && (
                      <tr key={`${r.key}-detail`} className="border-t-0">
                        <td className="px-3 pb-2.5" colSpan={6}>
                          <div className="flex flex-wrap items-center gap-2">
                            <input value={r.indication} disabled={busy}
                              placeholder="Indication (optional)"
                              aria-label={`Indication for ${r.label || "row " + (i + 1)}`}
                              onChange={e => set(i, { indication: e.target.value })}
                              className="min-w-[180px] flex-1 rounded-lg border border-gray-200 px-2 py-1 text-[12px]" />
                            <input value={r.immediateOutcome} disabled={busy}
                              placeholder="Immediate outcome (optional)"
                              aria-label={`Immediate outcome for ${r.label || "row " + (i + 1)}`}
                              onChange={e => set(i, { immediateOutcome: e.target.value })}
                              className="min-w-[180px] flex-1 rounded-lg border border-gray-200 px-2 py-1 text-[12px]" />
                            {/* ⚠ THE REASON FOLLOWS THE VOCABULARY, NOT ONE HARD-CODED STATUS. It used
                                to test `=== "ABANDONED"`. With six statuses the engine requires a reason
                                for ATTEMPTED, CANCELLED and DECLINED, and a hard-coded test would have
                                left three of them refusing the batch over a field the screen never drew
                                -- the practitioner reads that as the product being broken. */}
                            {NEEDS_REASON.includes(r.status) && (
                              <input value={r.abandonedReason} disabled={busy}
                                placeholder={r.status === "ATTEMPTED"
                                  ? "Why was it not completed?"
                                  : `Why was it ${r.status.toLowerCase()}?`}
                                aria-label={`Reason for ${r.label || "row " + (i + 1)}`}
                                onChange={e => set(i, { abandonedReason: e.target.value })}
                                className="min-w-[200px] flex-1 rounded-lg border border-amber-300 bg-amber-50/40 px-2 py-1 text-[12px]" />
                            )}
                            {/* ⚠ AND SCHEDULED NEEDS THE TIME IT IS SCHEDULED FOR. The engine refuses
                                without it rather than inventing now(), so drawing the status without
                                drawing this field would put a dead end on the screen. */}
                            {r.status === "SCHEDULED" && (
                              <input type="datetime-local" value={r.scheduledAt} disabled={busy}
                                aria-label={`Scheduled for ${r.label || "row " + (i + 1)}`}
                                onChange={e => set(i, { scheduledAt: e.target.value })}
                                className="min-w-[200px] rounded-lg border border-indigo-300 bg-indigo-50/40 px-2 py-1 text-[12px]" />
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button type="button" disabled={busy}
                onClick={() => setRows(p => [...p, newRow()])}
                className="rounded-lg border border-gray-200 px-2.5 py-1.5 text-[12px] font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50">
                + Add another procedure
              </button>
              {notice && (
                <p role="status" className={`rounded-lg px-2.5 py-1.5 text-[12px] ${notice.kind === "ok"
                  ? "bg-emerald-50 text-emerald-800" : "bg-[var(--cmp-surface-critical)] text-[var(--cmp-text-critical)]"}`}>
                  {notice.text}
                </p>
              )}
              <span className="ml-auto flex items-center gap-2">
                <button type="button" disabled={busy || filled.length === 0}
                  onClick={() => { setRows([newRow()]); setNotice(null); }}
                  className="rounded-lg border border-gray-200 px-3 py-2 text-[12.5px] font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-50">
                  Clear all
                </button>
                <button type="button" disabled={busy || filled.length === 0} onClick={commit}
                  className="rounded-lg bg-[var(--cp-primary)] px-4 py-2 text-[12.5px] font-semibold text-white hover:bg-[var(--cp-primary-deep)] disabled:opacity-50">
                  {busy ? "Recording..." : `Record ${filled.length} ${filled.length === 1 ? "procedure" : "procedures"}`}
                </button>
              </span>
            </div>

            <div className="mt-3">
              <Tip>
                A procedure from the catalogue that has sides must record left, right or bilateral
                &mdash; the server refuses it otherwise, by name, rather than assuming one.
                {" "}Catalogue search and per-procedure fields are not built yet, so every field is
                offered on every row.
              </Tip>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
