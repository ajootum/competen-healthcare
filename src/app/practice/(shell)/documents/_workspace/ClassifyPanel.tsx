"use client";

import { useState } from "react";
import { INCOMING_DOC_TYPES } from "@/lib/practice/communication-constants";

// CPR-DOC-002 s6.2 steps 3 and 4 -- LINK AN ARRIVING DOCUMENT TO A PATIENT, AND SAY WHAT IT IS.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// THIS IS THE ONE THING PHASE 1 GENUINELY DID NOT HAVE. recordIncoming() takes a patientId at creation
// and nothing anywhere could set one afterwards -- InboxConsole.tsx even tells the user that "linking it
// to a patient happens from their record once it has been reviewed", which was never true of any code
// in this product. A result that arrived before anybody knew whose it was stayed attached to nobody.
//
// ⚠ THE SOURCE IS SHOWN AND IS NOT A FIELD. s17: "Patient-uploaded documents retain source attribution
// even after classification." The API has no `source` parameter, so there is nothing here to send; it is
// printed beside the form as the thing that will still be true afterwards.
//
// ⚠ UNLINKING NEEDS A REASON, AND THE REASON IS ENFORCED BY THE ENGINE, NOT BY THIS DIALOG. s17:
// "Deleting a patient link requires confirmation and an audit reason." A confirmation the client draws
// is a confirmation the API does not have. The textarea below is a courtesy; the 400 is the boundary.
//
// ⚠ A PATIENT SEARCH THAT FAILED IS NOT "NO PATIENT FOUND". /api/v1/practice/patients returns
// `complete: false` when one of its probes was refused, and this component says so rather than showing
// an empty result list -- the same reason that field exists at all: an empty answer read as truth is how
// somebody links a document to a brand-new duplicate record.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

/* eslint-disable @typescript-eslint/no-explicit-any */

const input =
  "w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-[12.5px] outline-none focus:border-[var(--cp-primary)] focus:ring-2 focus:ring-[var(--cp-primary)]/10";

export default function ClassifyPanel({ row, canClassify }: {
  row: {
    id: string; title: string; source: string; docType: string;
    patientId: string | null; patientName: string | null; at: string;
  };
  canClassify: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [q, setQ] = useState("");
  const [results, setResults] = useState<{ id: string; displayName: string }[] | null>(null);
  const [searchIncomplete, setSearchIncomplete] = useState<string | null>(null);
  const [chosen, setChosen] = useState<{ id: string; name: string } | null>(null);

  const [docType, setDocType] = useState(row.docType);
  const [receivedOn, setReceivedOn] = useState(row.at);
  const [unlinking, setUnlinking] = useState(false);
  const [reason, setReason] = useState("");

  if (!canClassify) return null;

  async function search() {
    setBusy(true); setError(null); setSearchIncomplete(null);
    try {
      const res = await fetch(`/api/v1/practice/patients?q=${encodeURIComponent(q)}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data?.error?.message ?? data?.error ?? "The search did not run."); return; }
      // ⚠ NOT AN ANSWER when a probe was refused. Shown as such, never as an empty register.
      if (data.complete === false)
        setSearchIncomplete(data.incompleteDetail ?? "part of the search was refused, so this list is not complete");
      setResults(((data.results ?? []) as any[]).map(r => ({
        id: r.id as string, displayName: (r.displayName ?? r.display_name ?? "Unnamed") as string,
      })));
    } catch (e) {
      setError(String(e));
    } finally { setBusy(false); }
  }

  async function send(payload: Record<string, unknown>) {
    setBusy(true); setError(null);
    const res = await fetch("/api/v1/practice/documents/classify", {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data?.error?.message ?? data?.error ?? "That did not work.");
      setBusy(false); return;
    }
    window.location.reload();
  }

  return (
    <div className="mt-1">
      <button type="button" onClick={() => setOpen(o => !o)}
        className="rounded border border-gray-200 px-2 py-0.5 text-[11px] font-semibold text-gray-600 transition hover:bg-gray-50">
        {open ? "Close" : row.patientId ? "Reclassify" : "Link to a patient"}
      </button>

      {open && (
        <div className="mt-1.5 rounded-lg border border-gray-200 bg-gray-50 p-2.5">
          {error && (
            <p className="mb-2 rounded bg-[var(--cmp-surface-critical)] px-2 py-1 text-[11.5px] text-[var(--cmp-text-critical)]">
              {error}
            </p>
          )}

          <p className="text-[11px] leading-relaxed text-gray-500">
            Received from <span className="font-semibold text-gray-700">{row.source}</span>.{" "}
            Filing it does not change where it came from &mdash; the source stays on the record whatever
            you classify it as.
          </p>

          {/* ── LINK ─────────────────────────────────────────────────────────────────────────────── */}
          <div className="mt-2 flex flex-wrap items-end gap-1.5">
            <label className="flex min-w-[12rem] flex-1 flex-col gap-0.5">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">Patient</span>
              <input value={q} onChange={e => setQ(e.target.value)} placeholder="Name, phone or practice ID"
                onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); void search(); } }}
                className={input} />
            </label>
            <button type="button" onClick={() => void search()} disabled={busy || !q.trim()}
              className="rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-[11.5px] font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50">
              Search
            </button>
          </div>

          {searchIncomplete && (
            <p className="mt-1 rounded bg-[var(--cmp-surface-warning)] px-2 py-1 text-[11px] text-[var(--cmp-text-warning)]">
              <span className="font-semibold">This search is not complete.</span> Do not read a short list
              as &ldquo;not registered&rdquo;.
              <span className="mt-0.5 block font-mono text-[10px] opacity-80">{searchIncomplete}</span>
            </p>
          )}

          {results !== null && results.length === 0 && !searchIncomplete && (
            <p className="mt-1 text-[11px] text-gray-500">Nobody in this practice matches that.</p>
          )}
          {results !== null && results.length > 0 && (
            <ul className="mt-1 flex flex-wrap gap-1">
              {results.map(r => (
                <li key={r.id}>
                  <button type="button" onClick={() => setChosen({ id: r.id, name: r.displayName })}
                    className={`rounded-lg border px-2 py-1 text-[11.5px] font-semibold transition ${
                      chosen?.id === r.id
                        ? "border-[var(--cp-primary)] bg-[var(--cp-primary)]/10 text-[var(--cp-primary-deep)]"
                        : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50"}`}>
                    {r.displayName}
                  </button>
                </li>
              ))}
            </ul>
          )}

          {/* ── CLASSIFY ─────────────────────────────────────────────────────────────────────────── */}
          <div className="mt-2 flex flex-wrap items-end gap-1.5">
            <label className="flex flex-col gap-0.5">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">What is it?</span>
              <select value={docType} onChange={e => setDocType(e.target.value)} className={input}>
                {INCOMING_DOC_TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-0.5">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">Document date</span>
              <input type="date" value={receivedOn} onChange={e => setReceivedOn(e.target.value)} className={input} />
            </label>
            <button type="button" disabled={busy}
              onClick={() => void send({
                id: row.id,
                ...(chosen ? { patientId: chosen.id } : {}),
                docType, receivedOn,
              })}
              className="rounded-lg bg-[var(--cp-primary)] px-3 py-1.5 text-[11.5px] font-semibold text-white hover:bg-[var(--cp-primary-deep)] disabled:opacity-50">
              {chosen ? `File under ${chosen.name}` : "Save classification"}
            </button>
          </div>

          {/* ── UNLINK, WITH A REASON (s17) ──────────────────────────────────────────────────────── */}
          {row.patientId && (
            <div className="mt-2 border-t border-gray-200 pt-2">
              {!unlinking ? (
                <button type="button" onClick={() => setUnlinking(true)}
                  className="text-[11px] font-semibold text-rose-600 hover:underline">
                  This is not about {row.patientName ?? "this patient"} &mdash; remove the link
                </button>
              ) : (
                <div className="flex flex-wrap items-end gap-1.5">
                  <label className="flex min-w-[14rem] flex-1 flex-col gap-0.5">
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">
                      Why? This goes on the record.
                    </span>
                    <input value={reason} onChange={e => setReason(e.target.value)}
                      placeholder="e.g. filed against the wrong Namulawa" className={input} />
                  </label>
                  <button type="button" disabled={busy || !reason.trim()}
                    onClick={() => void send({ id: row.id, action: "unlink", reason })}
                    className="rounded-lg border border-rose-300 bg-white px-2.5 py-1.5 text-[11.5px] font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-50">
                    Remove the link
                  </button>
                  <button type="button" onClick={() => { setUnlinking(false); setReason(""); }}
                    className="rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-[11.5px] font-semibold text-gray-600 hover:bg-gray-50">
                    Cancel
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
