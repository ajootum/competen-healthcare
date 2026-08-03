"use client";

import { useState } from "react";
import {
  DOCUMENT_TRANSITIONS, LOCKED_DOCUMENT_STATUSES, AMEND_ONLY_STATUSES, DOC_TYPES, RELEASE_CHANNELS,
  documentActionFor, documentLabelFor,
} from "@/lib/practice/document-constants";
import Dictation from "@/components/practice/Dictation";

// CPR-130's document editor and lifecycle bar.
//
// THE BUTTONS ARE THE STATE TABLE, as in EncounterConsole: what renders is DOCUMENT_TRANSITIONS[status]
// mapped through documentActionFor, so an illegal action cannot be rendered. AMEND is drawn separately
// because it is not a transition -- it creates the successor version and moves this one, and the engine
// refuses a bare transition into AMENDED for exactly that reason.
//
// SAVING IS EXPLICIT. Same reasoning as the consultation note: a timer that fires mid-sentence writes
// half-thoughts into something that will be signed and handed to a patient.

const input = "w-full rounded-lg border border-gray-200 px-2.5 py-2 text-[13px] outline-none focus:border-[var(--cp-primary)] focus:ring-2 focus:ring-[var(--cp-primary)]/10";

export default function DocumentConsole(props: {
  documentId: string; status: string; title: string; body: string;
  addressedTo: string | null; docType: string; recordVersion: number;
  hasSuccessor: boolean; canAuthor: boolean; canSign: boolean;
}) {
  const locked = LOCKED_DOCUMENT_STATUSES.includes(props.status);
  const editable = props.canAuthor && !locked;

  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [draft, setDraft] = useState({
    title: props.title, body: props.body,
    addressedTo: props.addressedTo ?? "", docType: props.docType,
  });
  const [dirty, setDirty] = useState(false);
  const [amendReason, setAmendReason] = useState("");
  const [release, setRelease] = useState({ channel: "printed", recipient: "", note: "" });

  const set = (patch: Partial<typeof draft>) => { setDraft(d => ({ ...d, ...patch })); setDirty(true); };

  async function call(payload: unknown, okText: string, reload: boolean) {
    setBusy(true); setNotice(null);
    const res = await fetch(`/api/v1/practice/documents/${props.documentId}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setNotice({ kind: "err", text: data?.error?.message ?? data?.error ?? "That did not work." });
      setBusy(false); return null;
    }
    if (reload) { window.location.reload(); return data; }
    setNotice({ kind: "ok", text: okText }); setBusy(false); return data;
  }

  const save = async () => {
    const done = await call({
      title: draft.title, body: draft.body, docType: draft.docType,
      addressedTo: draft.addressedTo || null, recordVersion: props.recordVersion,
    }, "Saved.", false);
    if (done) setDirty(false);
  };

  const transition = (action: string, label: string) => {
    if (action === "sign" && !confirm(
      "Signing issues this document. It cannot be edited afterwards -- only amended into a new version. Sign now?",
    )) return;
    if (action === "entered_in_error" && !confirm(
      "Mark this document as entered in error? It stays in the record, permanently flagged.",
    )) return;
    if (dirty && !confirm("You have unsaved changes. Continue and lose them?")) return;
    call({ action }, label, true);
  };

  const targets = (DOCUMENT_TRANSITIONS[props.status] ?? []).filter(t => !AMEND_ONLY_STATUSES.includes(t));
  const canAmend = props.status === "SIGNED" && props.canAuthor && !props.hasSuccessor;
  const canRelease = props.status === "SIGNED" && props.canAuthor;

  return (
    <div className="flex flex-col gap-4">
      {notice && (
        <p className={`rounded-lg px-3 py-2 text-[12px] ${notice.kind === "ok" ? "bg-[var(--cmp-surface-success)] text-[var(--cmp-text-success)]" : "bg-[var(--cmp-surface-critical)] text-[var(--cmp-text-critical)]"}`}>{notice.text}</p>
      )}

      {/* Lifecycle bar */}
      <section className="rounded-xl border border-gray-200 bg-white p-4">
        <h2 className="text-[13px] font-bold text-gray-900">Document</h2>
        {targets.length === 0 && !canAmend ? (
          <p className="mt-2 text-[12px] text-gray-400">This document is closed. No further changes are possible.</p>
        ) : (
          <div className="mt-2 flex gap-1.5 flex-wrap">
            {targets.map(to => {
              const action = documentActionFor(props.status, to);
              if (!action) return null;
              const needsSign = to === "SIGNED";
              if (needsSign ? !props.canSign : !props.canAuthor) return null;
              const danger = to === "ENTERED_IN_ERROR";
              return (
                <button key={to} type="button" disabled={busy} onClick={() => transition(action, `${documentLabelFor(props.status, to)} done.`)}
                  className={`rounded-lg px-3 py-1.5 text-[12px] font-semibold disabled:opacity-50 ${
                    needsSign ? "bg-[var(--cp-primary)] text-white hover:bg-[var(--cp-primary-deep)]"
                      : danger ? "border border-[var(--cmp-color-critical)] text-[var(--cmp-text-critical)] hover:bg-[var(--cmp-surface-critical)]"
                        : "border border-gray-200 text-gray-700 hover:bg-gray-50"}`}>
                  {documentLabelFor(props.status, to)}
                </button>
              );
            })}
          </div>
        )}
      </section>

      {/* Content */}
      <section className="rounded-xl border border-gray-200 bg-white p-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-[13px] font-bold text-gray-900">Content</h2>
          {editable && <Dictation onText={t => set({ body: `${draft.body}${draft.body && !draft.body.endsWith(" ") ? " " : ""}${t}` })} />}
        </div>
        {!editable && (
          <p className="mt-1 text-[11px] text-gray-500">
            {locked ? "Read-only: this document is issued." : "Read-only: you do not hold document.author in this workspace."}
          </p>
        )}

        <div className="mt-2 grid grid-cols-2 gap-2">
          <label className="col-span-2 text-[11px] font-semibold text-gray-500" htmlFor="doc-title">Title</label>
          <input id="doc-title" disabled={!editable} value={draft.title} onChange={e => set({ title: e.target.value })}
            className={`${input} col-span-2 disabled:bg-gray-50 disabled:text-gray-500`} />

          <select aria-label="Document type" disabled={!editable} value={draft.docType} onChange={e => set({ docType: e.target.value })}
            className={`${input} disabled:bg-gray-50 disabled:text-gray-500`}>
            {DOC_TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
          <input aria-label="Addressed to" placeholder="Addressed to (optional)" disabled={!editable}
            value={draft.addressedTo} onChange={e => set({ addressedTo: e.target.value })}
            className={`${input} disabled:bg-gray-50 disabled:text-gray-500`} />

          <label className="col-span-2 mt-1 text-[11px] font-semibold text-gray-500" htmlFor="doc-body">Body</label>
          <textarea id="doc-body" rows={18} disabled={!editable} value={draft.body} onChange={e => set({ body: e.target.value })}
            className={`${input} col-span-2 resize-y font-mono text-[12px] leading-relaxed disabled:bg-gray-50 disabled:text-gray-500`} />
        </div>

        {editable && (
          <div className="mt-2 flex items-center gap-2">
            <button type="button" disabled={busy || !draft.title.trim()} onClick={save}
              className="rounded-lg border border-gray-200 px-3 py-1.5 text-[12px] font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50">
              Save
            </button>
            {dirty && <span className="text-[10px] text-[var(--cmp-text-warning)]">unsaved changes</span>}
          </div>
        )}
      </section>

      {/* Amendment */}
      {canAmend && (
        <section className="rounded-xl border border-gray-200 bg-white p-4">
          <h2 className="text-[13px] font-bold text-gray-900">Amend</h2>
          <p className="mt-1 text-[12px] text-gray-500">
            This creates version {"n+1"} as a fresh draft with the same content, and marks this one amended.
            This version stays in the record because copies of it may already be held elsewhere.
          </p>
          <form className="mt-2 flex flex-col gap-2" onSubmit={e => {
            e.preventDefault();
            call({ amend: { reason: amendReason } }, "Amended.", true);
          }}>
            <input required placeholder="Why is this being amended?" value={amendReason}
              onChange={e => setAmendReason(e.target.value)} className={input} />
            <button type="submit" disabled={busy || !amendReason.trim()}
              className="rounded-lg border border-gray-200 py-2 text-[12px] font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50">
              Create the next version
            </button>
          </form>
        </section>
      )}

      {/* Release */}
      {canRelease && (
        <section className="rounded-xl border border-gray-200 bg-white p-4">
          <h2 className="text-[13px] font-bold text-gray-900">Record that a copy was issued</h2>
          <form className="mt-2 grid grid-cols-2 gap-2" onSubmit={e => {
            e.preventDefault();
            call({ release }, "Recorded.", true);
          }}>
            <select aria-label="How it was issued" value={release.channel} onChange={e => setRelease(r => ({ ...r, channel: e.target.value }))} className={input}>
              {RELEASE_CHANNELS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
            <input placeholder="To whom (optional)" value={release.recipient} onChange={e => setRelease(r => ({ ...r, recipient: e.target.value }))} className={input} />
            <input placeholder="Note (optional)" value={release.note} onChange={e => setRelease(r => ({ ...r, note: e.target.value }))} className={`${input} col-span-2`} />
            <button type="submit" disabled={busy}
              className="col-span-2 rounded-lg border border-gray-200 py-2 text-[12px] font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50">
              Record
            </button>
          </form>
        </section>
      )}
    </div>
  );
}
