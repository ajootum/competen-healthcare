"use client";

import { useState } from "react";

// The patient's action panel: demographic edit (optimistic-concurrency guarded), book-for-patient
// (writes the registry link, so the diary carries the registry's name), and the privileged merge --
// which asks for the OTHER record's Practice ID rather than offering a browse, because merging is a
// deliberate act performed on a known duplicate, not something to stumble into from a list.

/* eslint-disable @typescript-eslint/no-explicit-any */

const input = "w-full rounded-lg border border-gray-200 px-2.5 py-2 text-[13px] outline-none focus:border-[#2563EB] focus:ring-2 focus:ring-[#2563EB]/10";

export default function PatientActions(props: {
  patientId: string; displayName: string; sex: string; birthDate: string | null;
  ageEstimateYears: number | null; recordVersion: number;
  canEdit: boolean; canMerge: boolean; canBook: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [edit, setEdit] = useState({ displayName: props.displayName, sex: props.sex, birthDate: props.birthDate ?? "" });
  const [book, setBook] = useState({ date: new Date().toISOString().slice(0, 10), time: "09:00", type: "scheduled_followup" });
  const [mergeTarget, setMergeTarget] = useState("");

  async function call(fn: () => Promise<Response>, okText: string, reloadOnOk = true) {
    setBusy(true); setNotice(null);
    const res = await fn();
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { setNotice({ kind: "err", text: data?.error?.message ?? data?.error ?? "That did not work." }); setBusy(false); return; }
    if (reloadOnOk) { window.location.reload(); return; }
    setNotice({ kind: "ok", text: okText }); setBusy(false);
  }

  const saveEdit = () => call(() => fetch(`/api/v1/practice/patients/${props.patientId}`, {
    method: "PATCH", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      recordVersion: props.recordVersion,
      displayName: edit.displayName, sex: edit.sex, birthDate: edit.birthDate || null,
    }),
  }), "Saved.");

  const bookAppt = () => call(() => fetch("/api/v1/practice/appointments", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      patientId: props.patientId,
      appointmentType: book.type,
      scheduledAt: `${book.date}T${book.time}:00.000Z`,
    }),
  }), "Booked.");

  async function doMerge() {
    // Resolve the duplicate by its Practice ID first -- merging by uuid paste is error-prone.
    setBusy(true); setNotice(null);
    const search = await fetch(`/api/v1/practice/patients?q=${encodeURIComponent(mergeTarget.trim())}`);
    const found = search.ok ? (await search.json()).results : [];
    const target = (found as any[]).find(r => r.practiceId?.toLowerCase() === mergeTarget.trim().toLowerCase());
    if (!target) { setNotice({ kind: "err", text: "No patient with that Practice ID." }); setBusy(false); return; }
    if (target.id === props.patientId) { setNotice({ kind: "err", text: "That is this patient." }); setBusy(false); return; }
    await call(() => fetch(`/api/v1/practice/patients/${props.patientId}/merge`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ duplicatePatientId: target.id, reason: "confirmed duplicate" }),
    }), "Merged.");
  }

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-4">
      {notice && (
        <p className={`mb-3 rounded-lg px-3 py-2 text-[12px] ${notice.kind === "ok" ? "bg-[var(--cmp-surface-success)] text-[var(--cmp-text-success)]" : "bg-[var(--cmp-surface-critical)] text-[var(--cmp-text-critical)]"}`}>{notice.text}</p>
      )}

      {props.canBook && (
        <>
          <h2 className="text-[13px] font-bold text-gray-900">Book for this patient</h2>
          <form className="mt-2 grid grid-cols-2 gap-2" onSubmit={e => { e.preventDefault(); bookAppt(); }}>
            <input type="date" value={book.date} onChange={e => setBook(p => ({ ...p, date: e.target.value }))} className={input} />
            <input type="time" value={book.time} onChange={e => setBook(p => ({ ...p, time: e.target.value }))} className={input} />
            <select value={book.type} onChange={e => setBook(p => ({ ...p, type: e.target.value }))} className={`${input} col-span-2`}>
              {[["scheduled_followup", "Scheduled follow-up"], ["new_consultation", "New consultation"], ["teleconsultation", "Teleconsultation"], ["home_visit", "Home visit"]].map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
            <button type="submit" disabled={busy}
              className="col-span-2 rounded-lg bg-[#2563EB] py-2 text-[12px] font-semibold text-white hover:bg-[#1D4ED8] disabled:opacity-50">
              Book appointment
            </button>
          </form>
        </>
      )}

      {props.canEdit && (
        <>
          <h2 className="mt-4 text-[13px] font-bold text-gray-900">Edit demographics</h2>
          <form className="mt-2 flex flex-col gap-2" onSubmit={e => { e.preventDefault(); saveEdit(); }}>
            <input value={edit.displayName} onChange={e => setEdit(p => ({ ...p, displayName: e.target.value }))} className={input} />
            <div className="grid grid-cols-2 gap-2">
              <select value={edit.sex} onChange={e => setEdit(p => ({ ...p, sex: e.target.value }))} className={input}>
                {["unspecified", "female", "male", "other", "unknown"].map(s => <option key={s} value={s}>{s}</option>)}
              </select>
              <input type="date" value={edit.birthDate} onChange={e => setEdit(p => ({ ...p, birthDate: e.target.value }))} className={input} />
            </div>
            <button type="submit" disabled={busy || !edit.displayName.trim()}
              className="rounded-lg border border-gray-200 py-2 text-[12px] font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50">
              Save changes
            </button>
          </form>
        </>
      )}

      {props.canMerge && (
        <>
          <h2 className="mt-4 text-[13px] font-bold text-gray-900">Merge a duplicate into this record</h2>
          <p className="mt-1 text-[10px] text-gray-400">
            Enter the duplicate&apos;s Practice ID. Its identifiers, contacts and appointments move here; the
            duplicate is kept as a merged pointer, fully audited. This is a clinical decision.
          </p>
          <div className="mt-2 flex gap-2">
            <input placeholder="P-XXXXXX" value={mergeTarget} onChange={e => setMergeTarget(e.target.value)} className={input} />
            <button type="button" disabled={busy || !mergeTarget.trim()} onClick={doMerge}
              className="shrink-0 rounded-lg border border-[var(--cmp-color-warning)] px-3 py-2 text-[12px] font-semibold text-[var(--cmp-text-warning)] hover:bg-[var(--cmp-surface-warning)] disabled:opacity-50">
              Merge
            </button>
          </div>
        </>
      )}
    </section>
  );
}
