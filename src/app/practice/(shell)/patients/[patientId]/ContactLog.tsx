"use client";

import { useState } from "react";
import { CONTACT_CHANNELS, CONTACT_DIRECTIONS, CONTACT_OUTCOMES } from "@/lib/practice/communication-constants";

// CPR-320's contact register, on the patient it belongs to. Records what happened in the world -- a
// call made, a message left with a relative -- and optionally names the follow-up it was chasing, so
// "three calls, no answer" sits beside the commitment it evidences. Nothing here sends anything.

/* eslint-disable @typescript-eslint/no-explicit-any */

// max-md:min-h is CPR-MOB-001 s4's 44px floor for touch, a no-op at md and up.
const input = "w-full rounded-lg border border-gray-200 px-2.5 py-2 text-[13px] outline-none focus:border-[var(--cp-primary)] focus:ring-2 focus:ring-[var(--cp-primary)]/10 max-md:min-h-[var(--cp-touch)]";

export default function ContactLog({ patientId, contacts, followUps, canRecord }: {
  patientId: string; contacts: any[]; followUps: any[]; canRecord: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    channel: "phone", direction: "outgoing", outcome: "reached", summary: "", followUpId: "",
  });

  async function record() {
    setBusy(true); setError(null);
    const res = await fetch("/api/v1/practice/contacts", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ patientId, ...form, followUpId: form.followUpId || undefined }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data?.error?.message ?? data?.error ?? "That did not work.");
      setBusy(false); return;
    }
    window.location.reload();
  }

  return (
    <section id="record-contactlog" className="scroll-mt-4 mt-4 rounded-xl border border-gray-200 bg-white p-4">
      <h2 className="text-[13px] font-bold text-gray-900">Contact log</h2>
      <p className="mt-0.5 text-[11px] text-gray-500">
        Calls and conversations that happened in the world, recorded here. This product sends nothing.
      </p>

      {contacts.length === 0 ? (
        <p className="mt-2 text-[12px] text-gray-400">No contact recorded.</p>
      ) : (
        <ul className="mt-2 flex flex-col gap-1">
          {contacts.map(c => (
            <li key={c.id} className="text-[12px]">
              <span className="font-mono text-[10px] text-gray-400">{String(c.occurred_at).slice(0, 16).replace("T", " ")}</span>{" "}
              <span className="font-semibold text-gray-700">{String(c.channel).replace(/_/g, " ")}</span>{" "}
              <span className="text-gray-500">({String(c.outcome).replace(/_/g, " ")})</span>{" "}
              <span className="text-gray-700">{c.summary}</span>
              {c.follow_up_id && <span className="ml-1 text-[10px] text-gray-400">· chasing a follow-up</span>}
            </li>
          ))}
        </ul>
      )}

      {canRecord && (
        <>
          <button type="button" onClick={() => setOpen(o => !o)}
            className="mt-2 rounded border border-gray-200 px-2.5 py-1 text-[11px] font-semibold text-gray-600 hover:bg-gray-50 max-md:inline-flex max-md:min-h-[var(--cp-touch)] max-md:items-center max-md:px-3.5">
            {open ? "Cancel" : "Record a contact"}
          </button>
          {open && (
            /* max-md:col-span-3 on the three selects stacks them below md -- three dropdowns do not
               share 320px legibly (CPR-MOB-001 s10/s16) -- while md and up keeps the shipped row. */
            <form className="mt-2 grid grid-cols-3 gap-2" onSubmit={e => { e.preventDefault(); record(); }}>
              {error && <p className="col-span-3 rounded-lg bg-[var(--cmp-surface-critical)] px-3 py-2 text-[12px] text-[var(--cmp-text-critical)]">{error}</p>}
              <select aria-label="Channel" value={form.channel} onChange={e => setForm(f => ({ ...f, channel: e.target.value }))} className={`${input} max-md:col-span-3`}>
                {CONTACT_CHANNELS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
              <select aria-label="Direction" value={form.direction} onChange={e => setForm(f => ({ ...f, direction: e.target.value }))} className={`${input} max-md:col-span-3`}>
                {CONTACT_DIRECTIONS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
              <select aria-label="Outcome" value={form.outcome} onChange={e => setForm(f => ({ ...f, outcome: e.target.value }))} className={`${input} max-md:col-span-3`}>
                {CONTACT_OUTCOMES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
              <input required placeholder="What happened, in a sentence" value={form.summary}
                onChange={e => setForm(f => ({ ...f, summary: e.target.value }))} className={`${input} col-span-3`} />
              {followUps.length > 0 && (
                <select aria-label="Chasing which follow-up" value={form.followUpId}
                  onChange={e => setForm(f => ({ ...f, followUpId: e.target.value }))} className={`${input} col-span-3`}>
                  <option value="">Not chasing a particular follow-up</option>
                  {followUps.map((f: any) => <option key={f.id} value={f.id}>Chasing: {f.reason}</option>)}
                </select>
              )}
              <button type="submit" disabled={busy || !form.summary.trim()}
                className="col-span-3 rounded-lg border border-gray-200 py-2 text-[12px] font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50 max-md:min-h-[var(--cp-touch)]">
                Record
              </button>
            </form>
          )}
        </>
      )}
    </section>
  );
}
