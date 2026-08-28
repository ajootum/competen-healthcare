"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  PANEL, SectionHeader, Badge, Tip, EmptyState,
  WS_HEAD, WS_TH, WS_ROW, WS_TD, ROW_REMOVE,
} from "@/components/practice/EncounterKit";
import {
  ClinicalRecordTable, type RecordColumn, type RowState,
} from "@/components/practice/ClinicalRecordTable";
// ⚠ FROM THE CONSTANTS FILE, NEVER FROM THE ENGINE. diagnosis-capture.ts reaches access.ts and
// next/headers; importing one string from it here breaks `next build` with an import trace on pages
// nobody touched, and neither tsc nor eslint says a word.
import {
  DIAGNOSIS_CERTAINTIES, DEFAULT_CERTAINTY, MAX_PENDING_DIAGNOSES, diagnosisBand,
} from "@/lib/practice/diagnosis-constants";

// CP-ENC-DIAG-001 s3: "hold one or more selected diagnoses before committing", and s1's replacement of
// the single-diagnosis form.
//
// ⚠ THE WORKING SET IS NOT THE RECORD. Nothing here is written until Record is pressed, and the spec is
// explicit that the set "should remain visible until saved or explicitly cleared". Rows that fail on
// commit STAY in the set carrying their reason, so a refused diagnosis is corrected rather than retyped.
//
// ⚠ AND s2's DISTINCTION IS DRAWN ON THE ROW ITSELF. "Keep as ongoing problem" does not change what the
// encounter diagnosis means -- the diagnosis is recorded either way -- it only decides whether a
// longitudinal problem is created or linked beside it. The engine holds that rule; this screen must not
// imply a different one, which is why the checkbox says "keep" and not "save to".
//
// ⚠ WHAT IS DELIBERATELY ABSENT: s4's terminology search and s5's Recent/Common. Both need a configured
// terminology source, and CP has none yet -- s4 requires it be configurable rather than hard-coupled to
// one coding system, so inventing a hardcoded list here would be the opposite of the requirement. Free
// text is the honest fallback the spec permits, and the tip below says so rather than leaving somebody
// hunting for a search box that was never built.

type Row = {
  key: string;
  label: string;
  certainty: string;
  isPrimary: boolean;
  keepAsProblem: boolean;
  outcome?: { ok: boolean; message?: string };
};

type Recorded = {
  id: string; label: string; code: string | null; certainty: string;
  is_primary: boolean; problem_id: string | null;
};

// CP-UI-TABLE-001 s5's diagnosis columns: Diagnosis | Status | Ongoing problem | Actions.
const DIAGNOSIS_COLUMNS: RecordColumn<Recorded>[] = [
  { key: "label", label: "Diagnosis", priority: "primary",
    render: d => (
      <>
        {d.is_primary && <><Badge tone="neutral">primary</Badge>{" "}</>}
        <span className={diagnosisBand(d.certainty).struck
          ? "font-semibold text-gray-400 line-through" : "font-semibold text-gray-800"}>{d.label}</span>
        {d.code && <span className="ml-1.5 font-mono text-[11px] text-gray-400">{d.code}</span>}
      </>
    ) },
  { key: "certainty", label: "Status", priority: "status",
    render: d => (
      <span className={diagnosisBand(d.certainty).struck ? "text-[11.5px] text-gray-400" : "text-[11.5px] text-gray-600"}>
        {d.certainty.replace(/_/g, " ")}
      </span>
    ) },
  { key: "problem", label: "Ongoing problem", priority: "secondary",
    render: d => d.problem_id
      ? <Badge tone="settled">on problem list</Badge>
      : <span className="text-gray-400">&mdash;</span> },
];

let seq = 0;
const newRow = (): Row => ({
  key: `r${++seq}`, label: "", certainty: DEFAULT_CERTAINTY, isPrimary: false, keepAsProblem: false,
});

export default function DiagnosisWorkspace(props: {
  encounterId: string;
  recorded: Recorded[];
  editable: boolean;
  canDiagnose: boolean;
}) {
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>([newRow()]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  // ── CORRECTING WHAT IS ALREADY RECORDED ─────────────────────────────────────────────────────────
  // There was no update path in the product at all until today, which is why the old rows were locked:
  // re-submitting would have inserted a second copy rather than correcting the first.
  const [editing, setEditing] = useState<string | null>(null);
  const [edit, setEdit] = useState({ label: "", certainty: DEFAULT_CERTAINTY as string });

  const saveEdit = async (id: string) => {
    setBusy(true); setNotice(null);
    try {
      const res = await fetch(`/api/v1/practice/encounters/${props.encounterId}/diagnoses/${id}`, {
        method: "PATCH", headers: { "content-type": "application/json" },
        body: JSON.stringify({ label: edit.label.trim(), certainty: edit.certainty }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setNotice({ kind: "err", text: json?.error?.message ?? "That correction was not saved." });
        return;
      }
      setNotice({ kind: "ok", text: "Diagnosis corrected." });
      setEditing(null);
      router.refresh();
    } catch {
      setNotice({ kind: "err", text: "That did not reach the server, so nothing was changed." });
    } finally { setBusy(false); }
  };

  const removeRecorded = async (id: string) => {
    setBusy(true); setNotice(null);
    try {
      const res = await fetch(`/api/v1/practice/encounters/${props.encounterId}/diagnoses/${id}`, { method: "DELETE" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setNotice({ kind: "err", text: json?.error?.message ?? "That diagnosis was not removed." });
        return;
      }
      // ⚠ THE PROBLEM IT PROMOTED SURVIVES, and the message says so rather than leaving somebody to
      // discover it. It may already have been assessed at another visit or be why a medication exists.
      setNotice({
        kind: "ok",
        text: json?.removed?.problemLeftInPlace
          ? "Diagnosis removed from this encounter. The ongoing problem it created is still on the patient's problem list."
          : "Diagnosis removed from this encounter.",
      });
      router.refresh();
    } catch {
      setNotice({ kind: "err", text: "That did not reach the server, so nothing was removed." });
    } finally { setBusy(false); }
  };

  const filled = rows.filter(r => r.label.trim() && !r.outcome?.ok);
  const set = (i: number, patch: Partial<Row>) =>
    setRows(p => p.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  // ⚠ ONE PRIMARY, ENFORCED AS IT IS TICKED. The engine also resolves this (last wins), but a screen
  // that let two stay ticked would be showing a state the record cannot hold.
  const setPrimary = (i: number, on: boolean) =>
    setRows(p => p.map((r, j) => ({ ...r, isPrimary: on ? j === i : (j === i ? false : r.isPrimary) })));

  const commit = async () => {
    const items = rows
      .map((r, i) => ({ r, i }))
      .filter(({ r }) => r.label.trim() && !r.outcome?.ok);
    if (!items.length) return;
    setBusy(true); setNotice(null);
    try {
      const res = await fetch(`/api/v1/practice/encounters/${props.encounterId}/diagnoses/batch`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          items: items.map(({ r }) => ({
            label: r.label.trim(), certainty: r.certainty,
            isPrimary: r.isPrimary, keepAsProblem: r.keepAsProblem,
          })),
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok && !Array.isArray(json?.results)) {
        setNotice({ kind: "err", text: json?.error?.message ?? "Nothing was recorded." });
        return;
      }
      // ⚠ OUTCOMES ARE MAPPED BACK BY POSITION IN THE SUBMITTED LIST, not by row index -- the two differ
      // the moment a blank or already-recorded row is skipped, and mismatching them would attach one
      // diagnosis's refusal to another's row.
      const results = (json.results ?? []) as { index: number; ok: boolean; message?: string }[];
      // ⚠ A RECORDED ROW LEAVES THE WORKING SET (the owner, 2026-08-13: "the diagnoses are
      // uneditable"). It used to stay, locked, while the same diagnosis also appeared in the recorded
      // list above -- the entry showed twice, one copy dead, and the dead one looked like the record.
      // The working set is now only what is still PENDING; corrections happen on the recorded list,
      // which is the row the database actually holds.
      setRows(prev => {
        const next = [...prev];
        for (const out of results) {
          const target = items[out.index];
          if (target) next[target.i] = { ...next[target.i], outcome: { ok: out.ok, message: out.message } };
        }
        const remaining = next.filter(r => !r.outcome?.ok);
        // Never leave an empty table with no way to type into it.
        return remaining.length ? remaining : [newRow()];
      });
      const okCount = results.filter(r => r.ok).length;
      const bad = results.length - okCount;
      setNotice({
        kind: bad ? "err" : "ok",
        text: bad
          ? `${okCount} recorded, ${bad} not. Each row below says why -- nothing was dropped silently.`
          : `${okCount} ${okCount === 1 ? "diagnosis" : "diagnoses"} recorded.`,
      });
      router.refresh();
    } catch {
      setNotice({ kind: "err", text: "That did not reach the server, so nothing was recorded." });
    } finally { setBusy(false); }
  };

  const input = "w-full rounded-lg border border-gray-200 bg-white text-gray-900 placeholder:text-gray-400 px-2 py-1 text-[12.5px]";

  return (
    <section className={PANEL}>
      <SectionHeader
        title="Diagnoses"
        subtitle="Record findings from this encounter. Add several, then record them together."
      />

      <div className="p-4">
        {/* ── Already recorded, on the shared standard (CP-UI-TABLE-001 s13 step 2) ───────────────
            ⚠ "NORMALIZE DIAGNOSES TO THE SHARED COMPONENT WITHOUT MATERIALLY CHANGING ITS CURRENT
            COMPACT APPEARANCE" -- s13, verbatim. This tab was the reference the standard was written
            from, so the visible result is nearly identical; what changed is that the row shape now
            comes from one place instead of being hand-rolled here.
            ⚠ AND THE LEFT ACCENT NO LONGER ENCODES CERTAINTY. s4 gives the accent to primary and
            warning only, with status carried by badges. The certainty ramp this file used until now
            was approved earlier the same day and is superseded by the newer standard. */}
        <ClinicalRecordTable
          label="Diagnoses recorded in this encounter"
          columns={DIAGNOSIS_COLUMNS}
          empty={<EmptyState title="No diagnosis recorded for this encounter"
            reason="This was read successfully. A consultation that ends without one is a real consultation -- the honest answer is often that it is not yet known." />}
          records={props.recorded.map(d => ({
            id: d.id,
            data: d,
            state: (d.is_primary ? "primary" : "normal") as RowState,
            stateLabel: d.is_primary ? "Primary diagnosis" : undefined,
            actions: props.editable && props.canDiagnose ? (
              <span className="inline-flex items-center gap-1.5">
                <button type="button" disabled={busy}
                  onClick={() => { setEditing(d.id); setEdit({ label: d.label, certainty: d.certainty }); }}
                  aria-label={`Correct ${d.label}`}
                  className="rounded-lg border border-gray-200 px-2 py-0.5 text-[11px] font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-50">
                  Correct
                </button>
                <button type="button" disabled={busy} onClick={() => removeRecorded(d.id)}
                  aria-label={`Remove ${d.label}`}
                  className="rounded-lg border border-rose-200 px-2 py-0.5 text-[11px] font-semibold text-rose-600 hover:bg-rose-50 disabled:opacity-50">
                  Remove
                </button>
              </span>
            ) : undefined,
            // s3.1's expandable detail: the correction form stays attached to the row it corrects.
            expandedContent: editing === d.id ? (
              <form className="flex flex-wrap items-center gap-2"
                onSubmit={e => { e.preventDefault(); saveEdit(d.id); }}>
                <input value={edit.label} disabled={busy} autoFocus
                  aria-label={`New name for ${d.label}`}
                  onChange={e => setEdit(v => ({ ...v, label: e.target.value }))}
                  className="min-w-[200px] flex-1 rounded-lg border border-gray-200 px-2 py-1 text-[12.5px]" />
                <select value={edit.certainty} disabled={busy} aria-label="Certainty"
                  onChange={e => setEdit(v => ({ ...v, certainty: e.target.value }))}
                  className="rounded-lg border border-gray-200 px-2 py-1 text-[12.5px]">
                  {DIAGNOSIS_CERTAINTIES.map(c => <option key={c} value={c}>{c.replace(/_/g, " ")}</option>)}
                </select>
                <button type="submit" disabled={busy || !edit.label.trim()}
                  className="rounded-lg bg-[var(--cp-primary)] px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-[var(--cp-primary-deep)] disabled:opacity-50">
                  Save
                </button>
                <button type="button" disabled={busy} onClick={() => setEditing(null)}
                  className="rounded-lg border border-gray-200 px-2.5 py-1.5 text-[12px] font-semibold text-gray-600 hover:bg-gray-50">
                  Cancel
                </button>
              </form>
            ) : undefined,
          }))}
        />

        {/* ── The working set ──────────────────────────────────────────────────────────────────── */}
        {props.editable && props.canDiagnose && (
          <div className="mt-4">
            {/* ══ CPR-MOB-001 s10: "AVOID SIDE-BY-SIDE DENSE FORM FIELDS ON NARROW SCREENS" ═════════
                THE ONE PLACE ON THIS SURFACE THAT ACTUALLY SCROLLED SIDEWAYS. Five columns — a free
                text field, a 130px select, a 90px radio, a 150px checkbox and a remove button — inside
                `overflow-x-auto` is a horizontal scroll at 360px, which s4 forbids for core workflows,
                and recording a diagnosis is as core as this product gets.

                ⚠ LINEARISED, NOT DUPLICATED. The obvious fix is a second `md:hidden` card list beside
                the table; it is the wrong fix HERE because `name="dx-primary"` is a single radio group
                — two DOM copies of it would be one group spanning both faces, and the browser would
                clear a selection React still believed in. So the SAME cells linearise: the table, its
                body and its rows become blocks below md, each row becomes a bordered card, and every
                cell gains the visible label the (now hidden) column heading was carrying for it. One
                DOM, one radio group, one source of every value.

                s16: "all form controls require visible labels; placeholders are not substitutes" — which
                is exactly what a column heading stops being the moment the column does. Each label is
                `md:hidden` and tied to its control by htmlFor, so nothing about the desktop table moves.

                The row cards, the radio and the tickbox all take s4's 44px floor; the radio and checkbox
                grow to 20px because a 13px OS default is not a touch target however large its label. */}
            {/* The anchor the Add diagnosis quick action scrolls to. Every other capture surface already
                had one; this was the only tab a jump could reach and then not point at anything. */}
            <div id="diagnosis-capture" className="overflow-x-auto max-md:overflow-visible">
              <table className="w-full border-collapse max-md:block">
                <thead className={`${WS_HEAD} max-md:hidden`}>
                  <tr>
                    <th scope="col" className={WS_TH}>Diagnosis</th>
                    <th scope="col" className={`${WS_TH} w-[130px]`}>Status</th>
                    <th scope="col" className={`${WS_TH} w-[90px]`}>Primary</th>
                    <th scope="col" className={`${WS_TH} w-[150px]`}>Ongoing problem</th>
                    <th scope="col" className={`${WS_TH} w-[70px]`} />
                  </tr>
                </thead>
                <tbody className="max-md:block">
                  {rows.map((r, i) => (
                    <tr key={r.key} className={`${WS_ROW} max-md:mb-2.5 max-md:block max-md:rounded-xl max-md:border max-md:border-gray-200 max-md:p-3 ${r.outcome?.ok ? "bg-emerald-50/50" : r.outcome ? "bg-rose-50/50" : ""}`}>
                      <td className={`${WS_TD} max-md:block`}>
                        <label htmlFor={`dx-label-${r.key}`} className="mb-1 block text-[11px] font-semibold text-gray-600 md:hidden">
                          Diagnosis
                        </label>
                        <input id={`dx-label-${r.key}`} value={r.label} disabled={busy || r.outcome?.ok === true}
                          placeholder="Type a diagnosis..." className={input}
                          onChange={e => set(i, { label: e.target.value, outcome: undefined })} />
                        {r.outcome && !r.outcome.ok && (
                          <p className="mt-1 text-[11px] font-semibold text-[var(--cmp-text-critical)]">{r.outcome.message}</p>
                        )}
                        {r.outcome?.ok && <p className="mt-1 text-[11px] font-semibold text-emerald-700">recorded</p>}
                      </td>
                      <td className={`${WS_TD} max-md:mt-2 max-md:block`}>
                        <label htmlFor={`dx-certainty-${r.key}`} className="mb-1 block text-[11px] font-semibold text-gray-600 md:hidden">
                          Status
                        </label>
                        <select id={`dx-certainty-${r.key}`} value={r.certainty} disabled={busy || r.outcome?.ok === true} className={input}
                          onChange={e => set(i, { certainty: e.target.value })}>
                          {DIAGNOSIS_CERTAINTIES.map(c => <option key={c} value={c}>{c.replace(/_/g, " ")}</option>)}
                        </select>
                      </td>
                      <td className={`${WS_TD} text-center max-md:mt-1 max-md:block max-md:text-left`}>
                        {/* ⚠ ONE RADIO, WRAPPED — NOT TWO WITH ONE HIDDEN. `name="dx-primary"` is a
                            single group across the whole working set, so a second DOM copy per row
                            would put two members of that group in the document for every row and let
                            the browser clear a selection React still held in state. Only the WORDS are
                            `md:hidden`; the control is the same node in both frames, and it keeps its
                            aria-label in both so the accessible name never depends on the viewport. */}
                        <label className="flex items-center gap-2 text-[12.5px] text-gray-700 max-md:min-h-[var(--cp-touch)] md:justify-center md:gap-0">
                          <input type="radio" name="dx-primary" checked={r.isPrimary}
                            disabled={busy || r.outcome?.ok === true}
                            aria-label={`Primary diagnosis: ${r.label || "row " + (i + 1)}`}
                            onChange={e => setPrimary(i, e.target.checked)}
                            className="max-md:h-5 max-md:w-5" />
                          <span className="md:hidden">Primary diagnosis</span>
                        </label>
                      </td>
                      <td className={`${WS_TD} max-md:block`}>
                        <label className="flex items-center gap-1.5 text-[11.5px] text-gray-600 max-md:min-h-[var(--cp-touch)] max-md:gap-2 max-md:text-[12.5px]"
                          title="Carries this condition across visits. The diagnosis for today is recorded either way.">
                          <input type="checkbox" checked={r.keepAsProblem}
                            disabled={busy || r.outcome?.ok === true}
                            onChange={e => set(i, { keepAsProblem: e.target.checked })}
                            className="max-md:h-5 max-md:w-5" />
                          keep as ongoing
                        </label>
                      </td>
                      <td className={`${WS_TD} text-right max-md:mt-2 max-md:block max-md:text-left`}>
                        {rows.length > 1 && !r.outcome?.ok && (
                          <button type="button" disabled={busy}
                            className={`${ROW_REMOVE} max-md:inline-flex max-md:min-h-[var(--cp-touch)] max-md:items-center max-md:justify-center max-md:px-3.5 max-md:text-[12.5px]`}
                            onClick={() => setRows(p => p.filter((_, j) => j !== i))}>
                            Remove
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button type="button" disabled={busy || rows.length >= MAX_PENDING_DIAGNOSES}
                onClick={() => setRows(p => [...p, newRow()])}
                className="rounded-lg border border-gray-200 px-2.5 py-1.5 text-[12px] font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50">
                + Add another diagnosis
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
                  {busy ? "Recording..." : `Record ${filled.length} ${filled.length === 1 ? "diagnosis" : "diagnoses"}`}
                </button>
              </span>
            </div>

            <div className="mt-3">
              <Tip>
                <strong>Keep as ongoing</strong> adds this condition to the patient&rsquo;s problem list so
                it carries across visits &mdash; the diagnosis for today is recorded either way. A
                condition they already carry is linked rather than added twice.
                {" "}Terminology search is not built yet, so diagnoses are typed.
              </Tip>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
