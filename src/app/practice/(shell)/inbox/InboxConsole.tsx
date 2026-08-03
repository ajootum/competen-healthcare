"use client";

import { useState } from "react";
import Link from "next/link";
import { INCOMING_DOC_TYPES } from "@/lib/practice/communication-constants";

// The register's console: record what arrived, review it, say what was done.
//
// THE REVIEW BUTTON ONLY RENDERS FOR inbox.review HOLDERS, and the API refuses everyone else anyway --
// the button is a courtesy, the route is the boundary. An assistant records and actions; the clinical
// stamp is the practitioner's.

/* eslint-disable @typescript-eslint/no-explicit-any */

const input = "w-full rounded-lg border border-gray-200 px-2.5 py-2 text-[13px] outline-none focus:border-[var(--cp-primary)] focus:ring-2 focus:ring-[var(--cp-primary)]/10";

const TYPE_LABEL = Object.fromEntries(INCOMING_DOC_TYPES) as Record<string, string>;

export default function InboxConsole({ received, reviewed, actioned, canReview }: {
  received: any[]; reviewed: any[]; actioned: any[]; canReview: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    title: "", source: "", docType: "lab_result", summary: "", whereHeld: "", priority: "routine",
  });
  const [noteFor, setNoteFor] = useState<{ id: string; action: "review" | "action" } | null>(null);
  const [note, setNote] = useState("");

  async function send(method: string, payload: unknown) {
    setBusy(true); setError(null);
    const res = await fetch("/api/v1/practice/inbox", {
      method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data?.error?.message ?? data?.error ?? "That did not work.");
      setBusy(false); return;
    }
    window.location.reload();
  }

  const row = (d: any) => {
    // Bound locally so the narrowing survives into the handlers -- `noteFor?.id === d.id` inside JSX
    // leaves TypeScript unable to prove non-null by the time a callback runs.
    const active = noteFor?.id === d.id ? noteFor : null;
    return (
    <li key={d.id} className={`border-b border-gray-100 py-2 last:border-0 ${d.priority === "urgent" && d.status === "RECEIVED" ? "border-l-2 border-l-[var(--cmp-color-critical)] pl-2" : ""}`}>
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[13px] font-semibold text-gray-900">{d.title}</span>
        <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold text-gray-500">
          {TYPE_LABEL[d.doc_type] ?? d.doc_type}
        </span>
        {d.priority === "urgent" && (
          <span className="rounded bg-[var(--cmp-surface-critical)] px-1.5 py-0.5 text-[10px] font-bold text-[var(--cmp-text-critical)]">urgent</span>
        )}
        <span className="ml-auto text-[11px] text-gray-400">received {d.received_on}</span>
      </div>
      <p className="mt-0.5 text-[11px] text-gray-500">
        from {d.source}
        {d.patient_name && (
          <> · <Link href={`/practice/patients/${d.patient_id}`} className="font-semibold text-[var(--cp-primary-deep)] hover:underline">{d.patient_name}</Link></>
        )}
        {d.where_held && <> · held: {d.where_held}</>}
      </p>
      {d.summary && <p className="mt-0.5 text-[12px] text-gray-600">{d.summary}</p>}
      {d.review_note && <p className="mt-0.5 text-[11px] text-gray-500">review: {d.review_note}</p>}
      {d.action_note && <p className="mt-0.5 text-[11px] text-gray-500">done: {d.action_note}</p>}

      <div className="mt-1 flex gap-1.5">
        {d.status === "RECEIVED" && canReview && (
          <button type="button" disabled={busy}
            onClick={() => { setNote(""); setNoteFor(noteFor?.id === d.id ? null : { id: d.id, action: "review" }); }}
            className="rounded border border-gray-200 px-2 py-0.5 text-[11px] font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-50">
            Mark reviewed
          </button>
        )}
        {d.status === "RECEIVED" && !canReview && (
          <span className="text-[10px] text-gray-400">awaiting a practitioner&apos;s review</span>
        )}
        {d.status === "REVIEWED" && (
          <button type="button" disabled={busy}
            onClick={() => { setNote(""); setNoteFor(noteFor?.id === d.id ? null : { id: d.id, action: "action" }); }}
            className="rounded border border-gray-200 px-2 py-0.5 text-[11px] font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-50">
            Record what was done
          </button>
        )}
      </div>

      {active && (
        <form className="mt-1.5 flex gap-1.5 rounded-lg bg-gray-50 p-2"
          onSubmit={e => { e.preventDefault(); send("PATCH", { id: d.id, action: active.action, note }); }}>
          <input autoFocus required={active.action === "action"}
            placeholder={active.action === "review" ? "Review note (optional — the stamp is the point)" : "What was done about it?"}
            value={note} onChange={e => setNote(e.target.value)} className={input} />
          <button type="submit" disabled={busy || (active.action === "action" && !note.trim())}
            className="shrink-0 rounded-lg bg-[var(--cp-primary)] px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-[var(--cp-primary-deep)] disabled:opacity-50">
            Confirm
          </button>
          <button type="button" onClick={() => setNoteFor(null)}
            className="shrink-0 rounded-lg border border-gray-200 px-2.5 py-1 text-[11px] font-semibold text-gray-600 hover:bg-white">
            Cancel
          </button>
        </form>
      )}
    </li>
    );
  };

  return (
    <>
      {error && <p className="mt-3 rounded-lg bg-[var(--cmp-surface-critical)] px-3 py-2 text-[12px] text-[var(--cmp-text-critical)]">{error}</p>}

      <section className="mt-4 rounded-xl border border-gray-200 bg-white p-4">
        <button type="button" onClick={() => setOpen(o => !o)}
          className="rounded-lg border border-gray-200 px-3 py-1.5 text-[12px] font-semibold text-gray-700 hover:bg-gray-50">
          {open ? "Cancel" : "Record something that arrived"}
        </button>
        {open && (
          <form className="mt-3 grid grid-cols-2 gap-2" onSubmit={e => {
            e.preventDefault();
            send("POST", { ...form, summary: form.summary || undefined, whereHeld: form.whereHeld || undefined });
          }}>
            <input required placeholder="What is it? (e.g. FBC result)" value={form.title}
              onChange={e => setForm(f => ({ ...f, title: e.target.value }))} className={`${input} col-span-2`} />
            <input required placeholder="From where? (e.g. Lancet Labs)" value={form.source}
              onChange={e => setForm(f => ({ ...f, source: e.target.value }))} className={input} />
            <select aria-label="Type" value={form.docType} onChange={e => setForm(f => ({ ...f, docType: e.target.value }))} className={input}>
              {INCOMING_DOC_TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
            <input placeholder="Where is it held? (e.g. paper file, lab portal)" value={form.whereHeld}
              onChange={e => setForm(f => ({ ...f, whereHeld: e.target.value }))} className={input} />
            <label className="flex items-center gap-2 text-[12px] text-gray-600">
              <input type="checkbox" checked={form.priority === "urgent"}
                onChange={e => setForm(f => ({ ...f, priority: e.target.checked ? "urgent" : "routine" }))} />
              Looks urgent
            </label>
            <input placeholder="Summary (optional)" value={form.summary}
              onChange={e => setForm(f => ({ ...f, summary: e.target.value }))} className={`${input} col-span-2`} />
            <button type="submit" disabled={busy || !form.title.trim() || !form.source.trim()}
              className="col-span-2 rounded-lg bg-[var(--cp-primary)] py-2 text-[12px] font-semibold text-white hover:bg-[var(--cp-primary-deep)] disabled:opacity-50">
              Record
            </button>
            <p className="col-span-2 text-[10px] text-gray-400">
              This registers that it arrived; the document itself stays wherever it is. Linking it to a
              patient happens from their record once it has been reviewed.
            </p>
          </form>
        )}
      </section>

      {[
        ["Awaiting review", received, "Nobody has looked at these yet. The whole register exists so this pile is visible."],
        ["Reviewed", reviewed, "A practitioner has looked; what was done about each is still to be recorded."],
        ["Actioned", actioned, "Looked at and dealt with, most recent first."],
      ].map(([title, list, blurb]) => (list as any[]).length > 0 && (
        <section key={title as string} className="mt-4 rounded-xl border border-gray-200 bg-white p-4">
          <div className="flex items-center gap-2">
            <h2 className={`text-[13px] font-bold ${title === "Awaiting review" ? "text-[var(--cmp-text-critical)]" : "text-gray-900"}`}>{title as string}</h2>
            <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-bold text-gray-600">{(list as any[]).length}</span>
          </div>
          <p className="mt-0.5 text-[11px] text-gray-500">{blurb as string}</p>
          <ul className="mt-2">{(list as any[]).map(row)}</ul>
        </section>
      ))}

      {received.length === 0 && reviewed.length === 0 && actioned.length === 0 && (
        <section className="mt-4 rounded-xl border border-gray-200 bg-white p-6">
          <p className="text-[13px] font-semibold text-gray-700">Nothing registered.</p>
          <p className="mt-1 text-[12px] text-gray-500">
            When a result or letter arrives, record it here so its review is somebody&apos;s visible job
            rather than a pile on a desk.
          </p>
        </section>
      )}
    </>
  );
}
