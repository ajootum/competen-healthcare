"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  PANEL, SectionHeader, Badge, Tip, EmptyState,
  WS_HEAD, WS_TH, WS_ROW, WS_TD, ROW_REMOVE,
} from "@/components/practice/EncounterKit";
// ⚠ FROM THE CONSTANTS FILE, NEVER FROM THE ENGINE. diagnosis-capture.ts reaches access.ts and
// next/headers; importing one string from it here breaks `next build` with an import trace on pages
// nobody touched, and neither tsc nor eslint says a word.
import { DIAGNOSIS_CERTAINTIES, DEFAULT_CERTAINTY, MAX_PENDING_DIAGNOSES } from "@/lib/practice/diagnosis-constants";

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

  const input = "w-full rounded-lg border border-gray-200 px-2 py-1 text-[12.5px]";

  return (
    <section className={PANEL}>
      <SectionHeader
        title="Diagnoses"
        subtitle="Record findings from this encounter. Add several, then record them together."
      />

      <div className="p-4">
        {/* ── Already recorded ─────────────────────────────────────────────────────────────────── */}
        {props.recorded.length === 0 ? (
          <EmptyState title="No diagnosis recorded for this encounter"
            reason="This was read successfully. A consultation that ends without one is a real consultation -- the honest answer is often that it is not yet known." />
        ) : (
          <ul className="flex flex-col gap-1">
            {props.recorded.map(d => (
              <li key={d.id} className="rounded-lg border border-gray-100 px-2.5 py-1.5">
                {editing === d.id ? (
                  // ⚠ CORRECTING THE RECORD, NOT ADDING TO IT. This PATCHes the row the database holds.
                  <form className="flex flex-wrap items-center gap-2"
                    onSubmit={e => { e.preventDefault(); saveEdit(d.id); }}>
                    <input value={edit.label} disabled={busy} autoFocus
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
                ) : (
                  <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
                    {d.is_primary && <Badge tone="neutral">primary</Badge>}
                    <span className="font-semibold text-gray-800">{d.label}</span>
                    {d.code && <span className="font-mono text-[11px] text-gray-400">{d.code}</span>}
                    <span className="text-[11px] text-gray-500">{d.certainty}</span>
                    {d.problem_id && <Badge tone="settled">on problem list</Badge>}
                    {props.editable && props.canDiagnose && (
                      <span className="ml-auto flex items-center gap-1.5">
                        <button type="button" disabled={busy}
                          onClick={() => { setEditing(d.id); setEdit({ label: d.label, certainty: d.certainty }); }}
                          className="rounded-lg border border-gray-200 px-2 py-0.5 text-[11px] font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-50">
                          Correct
                        </button>
                        <button type="button" disabled={busy} onClick={() => removeRecorded(d.id)}
                          className="rounded-lg border border-rose-200 px-2 py-0.5 text-[11px] font-semibold text-rose-600 hover:bg-rose-50 disabled:opacity-50">
                          Remove
                        </button>
                      </span>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}

        {/* ── The working set ──────────────────────────────────────────────────────────────────── */}
        {props.editable && props.canDiagnose && (
          <div className="mt-4">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead className={WS_HEAD}>
                  <tr>
                    <th scope="col" className={WS_TH}>Diagnosis</th>
                    <th scope="col" className={`${WS_TH} w-[130px]`}>Status</th>
                    <th scope="col" className={`${WS_TH} w-[90px]`}>Primary</th>
                    <th scope="col" className={`${WS_TH} w-[150px]`}>Ongoing problem</th>
                    <th scope="col" className={`${WS_TH} w-[70px]`} />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={r.key} className={`${WS_ROW} ${r.outcome?.ok ? "bg-emerald-50/50" : r.outcome ? "bg-rose-50/50" : ""}`}>
                      <td className={WS_TD}>
                        <input value={r.label} disabled={busy || r.outcome?.ok === true}
                          placeholder="Type a diagnosis..." className={input}
                          onChange={e => set(i, { label: e.target.value, outcome: undefined })} />
                        {r.outcome && !r.outcome.ok && (
                          <p className="mt-1 text-[11px] font-semibold text-[var(--cmp-text-critical)]">{r.outcome.message}</p>
                        )}
                        {r.outcome?.ok && <p className="mt-1 text-[11px] font-semibold text-emerald-700">recorded</p>}
                      </td>
                      <td className={WS_TD}>
                        <select value={r.certainty} disabled={busy || r.outcome?.ok === true} className={input}
                          onChange={e => set(i, { certainty: e.target.value })}>
                          {DIAGNOSIS_CERTAINTIES.map(c => <option key={c} value={c}>{c.replace(/_/g, " ")}</option>)}
                        </select>
                      </td>
                      <td className={`${WS_TD} text-center`}>
                        <input type="radio" name="dx-primary" checked={r.isPrimary}
                          disabled={busy || r.outcome?.ok === true}
                          aria-label={`Primary diagnosis: ${r.label || "row " + (i + 1)}`}
                          onChange={e => setPrimary(i, e.target.checked)} />
                      </td>
                      <td className={WS_TD}>
                        <label className="flex items-center gap-1.5 text-[11.5px] text-gray-600"
                          title="Carries this condition across visits. The diagnosis for today is recorded either way.">
                          <input type="checkbox" checked={r.keepAsProblem}
                            disabled={busy || r.outcome?.ok === true}
                            onChange={e => set(i, { keepAsProblem: e.target.checked })} />
                          keep as ongoing
                        </label>
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
