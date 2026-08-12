"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  PANEL, SectionHeader, Badge, Tip, EmptyState,
  WS_HEAD, WS_TH, WS_ROW, WS_TD, ROW_REMOVE,
} from "@/components/practice/EncounterKit";
// ⚠ FROM THE CONSTANTS FILE, NEVER FROM procedures.ts. That module reaches access.ts and next/headers,
// and one string imported from it into a "use client" component drags the whole server module into the
// browser bundle -- which tsc and eslint both wave through and only `next build` catches. It has
// happened three times in this codebase; procedure-constants.ts exists precisely so it cannot here.
import { LATERALITIES, CONSENT_STATUSES, PROCEDURE_STATUSES } from "@/lib/practice/procedure-constants";

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
  outcome?: { ok: boolean; message?: string };
};

type Recorded = {
  id: string; label: string; site?: string | null; laterality?: string | null;
  status?: string | null; immediate_outcome?: string | null;
};

let seq = 0;
const newRow = (): Row => ({
  key: `p${++seq}`, label: "", site: "", laterality: "not_applicable",
  consentStatus: "not_recorded", status: "PERFORMED",
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
      setRows(prev => {
        const next = [...prev];
        for (const out of results) {
          const target = items[out.index];
          if (target) next[target.i] = { ...next[target.i], outcome: { ok: out.ok, message: out.message } };
        }
        return next;
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
        {props.recorded.length === 0 ? (
          <EmptyState title="No procedure recorded for this encounter"
            reason="This was read successfully -- add one below if something was done." />
        ) : (
          <ul className="flex flex-col gap-1">
            {props.recorded.map(p => (
              <li key={p.id} className="flex flex-wrap items-center gap-2 text-[12.5px]">
                <span className="font-semibold text-gray-800">{p.label}</span>
                {p.site && <span className="text-[11.5px] text-gray-600">{p.site}</span>}
                {p.laterality && p.laterality !== "not_applicable" && (
                  <Badge tone="neutral">{p.laterality}</Badge>
                )}
                {p.status === "ABANDONED" && <Badge tone="needs">abandoned</Badge>}
                {p.immediate_outcome && (
                  <span className="ml-auto text-[11px] text-gray-500">{p.immediate_outcome}</span>
                )}
              </li>
            ))}
          </ul>
        )}

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
                    <tr key={r.key} className={`${WS_ROW} ${r.outcome?.ok ? "bg-emerald-50/50" : r.outcome ? "bg-rose-50/50" : ""}`}>
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
