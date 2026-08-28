"use client";

import { useMemo, useRef, useState } from "react";
import {
  DOCUMENT_TRANSITIONS, LOCKED_DOCUMENT_STATUSES, AMEND_ONLY_STATUSES, DOC_TYPES, RELEASE_CHANNELS,
  documentActionFor, documentLabelFor,
} from "@/lib/practice/document-constants";
import {
  RECIPIENT_REQUIRED_CHANNELS, unresolvedMarkers, signBlockers,
} from "@/lib/practice/documents-workspace-constants";
import Dictation from "@/components/practice/Dictation";

// CPR-130's document editor and lifecycle bar, carried forward to CPR-DOC-002 s8 (PHASE 2).
//
// THE BUTTONS ARE THE STATE TABLE, as in EncounterConsole: what renders is DOCUMENT_TRANSITIONS[status]
// mapped through documentActionFor, so an illegal action cannot be rendered. AMEND is drawn separately
// because it is not a transition -- it creates the successor version and moves this one, and the engine
// refuses a bare transition into AMENDED for exactly that reason.
//
// SAVING IS EXPLICIT. Same reasoning as the consultation note: a timer that fires mid-sentence writes
// half-thoughts into something that will be signed and handed to a patient. s8 asks for autosave; this
// product declines it and says why, which is a decision rather than a gap.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// ⚠ SIGNING LEAVES THE LIFECYCLE BAR (s7.1). It used to be one more button in the row, labelled "Sign
// and issue", firing the same `{ action }` request as "Mark ready". Three things were wrong with that:
//
//   IT MERGED TWO STATES. s7 lists Signed and Issued separately, and Phase 1 already derives `issued`
//   from the release register rather than from a column. A button called "sign and issue" that issues
//   nothing to nobody is a label that lies about what the record will say afterwards.
//
//   IT ASKED FOR NO ATTESTATION. s7.1: signing a document IS the attestation, and it is a different
//   claim from signing the consultation. A confirm() reading "Sign now?" is not a statement anybody
//   made. The panel below shows the statement in full and posts back the version of it that was on the
//   screen.
//
//   IT COULD SIGN AROUND A HOLE. A generated document renders an unfillable merge field as a visible
//   [[marker]] precisely so it cannot be signed by accident -- and then nothing stopped it. The markers
//   are counted live, from the text in the box rather than from the text on the server, and they are the
//   loudest thing on this component while any remain.
//
// ⚠ THE BLOCKER LIST IS signBlockers() -- THE ENGINE'S OWN FUNCTION, imported from the constants module
// that has no server imports. Not a re-implementation of it. If this file computed its own version, the
// button would eventually say ready over an engine that says no.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

// The max-md tail is s4's 44px floor and nothing else. 16px text below md is also what stops iOS Safari
// zooming the viewport the moment a field takes focus -- a zoom the practitioner then has to undo by
// hand, mid-sentence, on a form they are trying to finish.
const input = "w-full rounded-lg border border-gray-200 bg-white text-gray-900 placeholder:text-gray-400 px-2.5 py-2 text-[13px] outline-none focus:border-[var(--cp-primary)] focus:ring-2 focus:ring-[var(--cp-primary)]/10 max-md:min-h-[var(--cp-touch)] max-md:text-[16px]";

type MergeValue = { field: string; description: string; value: string | null; state: "resolved" | "empty" };
type MergeReading =
  | { state: "ok"; value: MergeValue[] }
  | { state: "unreadable"; detail: string }
  | { state: "forbidden"; detail: string };

export default function DocumentConsole(props: {
  documentId: string; status: string; title: string; body: string;
  addressedTo: string | null; docType: string; recordVersion: number;
  hasSuccessor: boolean; canAuthor: boolean; canSign: boolean;
  /* ── s8's structure, resolved on the server and handed over as plain values ────────────────────────
   * ⚠ EVERY PROP BELOW IS A STRING, A BOOLEAN OR AN ARRAY OF THOSE. A function reaching a client
   * component through a payload is the failure that killed the Follow-ups board this week: it compiles,
   * it lints, the API is fine, and the page is dead in a production build. */
  merge: MergeReading;
  letterheadLines: string[] | null;
  templateSections: { heading: string; prompt: string | null }[];
  attestation: { version: string; statement: string; distinction: string };
  printHref: string;
}) {
  const locked = LOCKED_DOCUMENT_STATUSES.includes(props.status);
  const editable = props.canAuthor && !locked;

  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: "ok" | "err" | "warn"; text: string } | null>(null);
  const [draft, setDraft] = useState({
    title: props.title, body: props.body,
    addressedTo: props.addressedTo ?? "", docType: props.docType,
  });
  const [dirty, setDirty] = useState(false);
  const [amendReason, setAmendReason] = useState("");
  const [release, setRelease] = useState({ channel: "printed", recipient: "", note: "" });
  const [attested, setAttested] = useState(false);
  const [showMerge, setShowMerge] = useState(false);
  const bodyRef = useRef<HTMLTextAreaElement | null>(null);

  const set = (patch: Partial<typeof draft>) => { setDraft(d => ({ ...d, ...patch })); setDirty(true); };

  // ⚠ COUNTED FROM WHAT IS IN THE BOX, NOT FROM WHAT WAS ON THE SERVER WHEN THE PAGE LOADED. Deleting a
  // marker and watching the warning go away is what makes it obvious what has to happen; a count that
  // only updated on save would tell somebody who had just fixed it that they had not.
  const markers = useMemo(() => unresolvedMarkers(draft.body), [draft.body]);
  // Against the SAVED status and the LIVE text: the status cannot change without a reload, the text can.
  const blockers = useMemo(
    () => signBlockers({ status: props.status, body: draft.body, markers }),
    [props.status, draft.body, markers],
  );

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
    if (action === "entered_in_error" && !confirm(
      "Mark this document as entered in error? It stays in the record, permanently flagged.",
    )) return;
    if (dirty && !confirm("You have unsaved changes. Continue and lose them?")) return;
    call({ action }, label, true);
  };

  /** s8: insert at the cursor, not at the end. A merge field appended to the bottom is not a document. */
  const insertAtCursor = (text: string) => {
    const el = bodyRef.current;
    if (!el) { set({ body: `${draft.body}${text}` }); return; }
    const start = el.selectionStart ?? draft.body.length;
    const end = el.selectionEnd ?? start;
    const next = `${draft.body.slice(0, start)}${text}${draft.body.slice(end)}`;
    set({ body: next });
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + text.length, start + text.length);
    });
  };

  // ⚠ SIGNED IS REMOVED FROM THE GENERIC ROW. It is not one more transition; see the header.
  const targets = (DOCUMENT_TRANSITIONS[props.status] ?? [])
    .filter(t => !AMEND_ONLY_STATUSES.includes(t) && t !== "SIGNED");
  const canAmend = props.status === "SIGNED" && props.canAuthor && !props.hasSuccessor;
  const canIssue = props.status === "SIGNED" && props.canAuthor;
  const signable = props.canSign && !locked;
  const recipientRequired = (RECIPIENT_REQUIRED_CHANNELS as readonly string[]).includes(release.channel);

  return (
    <div className="flex flex-col gap-4">
      {notice && (
        <p className={`rounded-lg px-3 py-2 text-[12px] ${
          notice.kind === "ok" ? "bg-[var(--cmp-surface-success)] text-[var(--cmp-text-success)]"
            : notice.kind === "warn" ? "bg-[var(--cmp-surface-warning)] text-[var(--cmp-text-warning)]"
              : "bg-[var(--cmp-surface-critical)] text-[var(--cmp-text-critical)]"}`}>{notice.text}</p>
      )}

      {/* ── s8 / s12: THE HOLE IN THE TEXT, WHILE THERE IS ONE ──────────────────────────────────────── */}
      {markers.length > 0 && (
        <section className="rounded-xl border border-[var(--cmp-color-warning)] bg-[var(--cmp-surface-warning)] p-3">
          <h2 className="text-[12.5px] font-bold text-[var(--cmp-text-warning)]">
            {markers.length} field{markers.length === 1 ? "" : "s"} still unresolved
          </h2>
          <p className="mt-0.5 text-[11.5px] leading-relaxed text-gray-700">
            These are printed as they appear, deliberately &mdash; a blank would be invisible on the page
            and a signed document with a silent gap in it is worse than an obvious one. This document
            cannot be signed until every one of them is replaced or removed.
          </p>
          <ul className="mt-1.5 flex flex-wrap gap-1">
            {markers.map((m, i) => (
              <li key={`${m.marker}-${i}`}
                className="rounded bg-white/70 px-1.5 py-0.5 font-mono text-[11px] text-[var(--cmp-text-warning)]"
                title={m.kind === "generated"
                  ? "The merge ran and the record had no value for this field."
                  : "A template field that was never merged. It would print exactly like this."}>
                {m.marker}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Lifecycle bar */}
      <section className="rounded-xl border border-gray-200 bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-[13px] font-bold text-gray-900">Document</h2>
          {/* s8's page and PDF preview. The print view IS the PDF export -- one definition of what the
              paper looks like, produced by the browser's own print-to-PDF.

              ⚠ CPR-MOB-001 s12 row 3, "Preview → Full-screen document preview where supported". IT
              ALREADY IS, and that is the whole answer: printHref is its own ROUTE
              (/practice/documents/[documentId]/print), not a modal over this page, so on a phone it
              opens as a full screen showing the letterhead and the body exactly as they will print.
              There was nothing to build; the link only had to stop being 12px of text between two other
              things. Below md it becomes a full-width touch control, because on a phone "see what this
              actually looks like" is the most common reason to open a document at all. */}
          <a href={props.printHref}
            className="text-[12px] font-semibold text-[var(--cp-primary-deep)] hover:underline max-md:flex max-md:w-full max-md:min-h-[var(--cp-touch)] max-md:items-center max-md:justify-center max-md:rounded-lg max-md:border max-md:border-gray-200 max-md:text-[13.5px] max-md:no-underline">
            Preview and print &rarr;
          </a>
        </div>
        {targets.length === 0 && !canAmend && !signable ? (
          <p className="mt-2 text-[12px] text-gray-400">This document is closed. No further changes are possible.</p>
        ) : (
          /* ══ CPR-MOB-001 s12 row 5 — "Large Approve/Return/Issue-type controls as appropriate" ══════
             THIS ROW IS THAT ROW. The transitions this bar draws are Mark ready, Reopen for editing,
             Amend and Mark entered in error -- the approve/return/withdraw family s12 is naming -- and
             each was a 30px-tall button in a wrapped row. Below md they stack full width at s4's 44px
             floor, which also stops "Mark entered in error" from ever sharing a line with "Mark ready"
             where a thumb could take the wrong one.

             ⚠ WHAT DID NOT CHANGE: which buttons exist, what they say, who may see them, or what they
             do. `documentActionFor`, the `props.canAuthor` gate and the ENTERED_IN_ERROR danger styling
             are untouched -- s12 opens by saying the document architecture remains frozen. The danger
             control keeps its own border and text colour AND is the only one that says a destructive
             thing in words, so it is not distinguished by colour alone (s4). */
          <div className="mt-2 flex gap-1.5 flex-wrap max-md:flex-col">
            {targets.map(to => {
              const action = documentActionFor(props.status, to);
              if (!action) return null;
              if (!props.canAuthor) return null;
              const danger = to === "ENTERED_IN_ERROR";
              return (
                <button key={to} type="button" disabled={busy} onClick={() => transition(action, `${documentLabelFor(props.status, to)} done.`)}
                  className={`rounded-lg px-3 py-1.5 text-[12px] font-semibold disabled:opacity-50 max-md:flex max-md:min-h-[var(--cp-touch)] max-md:w-full max-md:items-center max-md:justify-center max-md:text-[14px] ${
                    danger ? "border border-[var(--cmp-color-critical)] text-[var(--cmp-text-critical)] hover:bg-[var(--cmp-surface-critical)]"
                      : "border border-gray-200 text-gray-700 hover:bg-gray-50"}`}>
                  {documentLabelFor(props.status, to)}
                </button>
              );
            })}
          </div>
        )}
      </section>

      {/* ── s7.1: THE SIGNATURE, AS ITS OWN ACT ────────────────────────────────────────────────────── */}
      {signable && (
        <section className="rounded-xl border border-[var(--cp-primary)]/30 bg-[var(--cp-primary)]/[0.04] p-4">
          <h2 className="text-[13px] font-bold text-gray-900">Sign this document</h2>
          <p className="mt-1 text-[11.5px] font-semibold text-[var(--cp-primary-deep)]">
            {props.attestation.distinction}
          </p>

          {blockers.length > 0 ? (
            /* ⚠ NOT A DISABLED BUTTON WITH AN APOLOGY. The reasons are the content, each one a thing the
               person in front of it can go and do. The control appears when they have done them. */
            <ul className="mt-2 flex flex-col gap-1">
              {blockers.map(b => (
                <li key={b.code} className="rounded-lg bg-white px-2.5 py-2 text-[12px] leading-relaxed text-gray-700 ring-1 ring-gray-200">
                  {b.message}
                </li>
              ))}
            </ul>
          ) : (
            <>
              <p className="mt-2 rounded-lg bg-white px-3 py-2 text-[12px] leading-relaxed text-gray-800 ring-1 ring-gray-200">
                {props.attestation.statement}
              </p>
              {dirty && (
                <p className="mt-1.5 text-[11.5px] font-semibold text-[var(--cmp-text-warning)]">
                  There are unsaved changes in the box below. Save them first &mdash; the signature covers
                  the text the record holds, not the text on this screen.
                </p>
              )}
              {/* ⚠ THE ATTESTATION TICK GROWS BELOW md AND NOTHING ELSE ABOUT IT MOVES. A 3.5-unit
                  checkbox is 14px; s4's floor exists so that the deliberate act of attesting cannot be
                  performed by a thumb that missed. The label still wraps the input, so the sentence
                  itself is the target -- it was already the honest way round and stays that way. */}
              <label className="mt-2 flex items-start gap-2 text-[12px] text-gray-800 max-md:gap-3 max-md:text-[13.5px] max-md:leading-relaxed">
                <input type="checkbox" checked={attested} onChange={e => setAttested(e.target.checked)}
                  className="mt-0.5 h-3.5 w-3.5 accent-[var(--cp-primary)] max-md:h-5 max-md:w-5" />
                <span>I have read the statement above and I am signing this document.</span>
              </label>
              <button
                type="button" disabled={busy || !attested || dirty}
                onClick={async () => {
                  const done = await call(
                    { action: "sign", attestationVersion: props.attestation.version }, "Signed.", false,
                  );
                  if (!done) return;
                  // ⚠ THE ATTESTATION WRITE IS REPORTED, NOT ASSUMED. audit() returns false rather than
                  // throwing, so a silently lost attestation would otherwise show as a clean success.
                  if (done?.document?.attestationRecorded === false) {
                    setNotice({
                      kind: "warn",
                      text: "This document is signed, but the attestation could not be written to the audit trail. "
                        + "Tell somebody: the signature is on the record and what was attested to is not.",
                    });
                    setBusy(false);
                    return;
                  }
                  window.location.reload();
                }}
                /* s4: 48px is preferred for a primary action, and this is the most consequential
                   control in the workspace -- a signature is an attestation that cannot be withdrawn,
                   only superseded. It stays exactly as disabled as it was: `busy || !attested ||
                   dirty`, the same three conditions, so a bigger button is not an easier one to press
                   by accident. */
                className="mt-2 rounded-lg bg-[var(--cp-primary)] px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-[var(--cp-primary-deep)] disabled:opacity-50 max-md:flex max-md:min-h-[var(--cp-touch-primary)] max-md:w-full max-md:items-center max-md:justify-center max-md:text-[15px]">
                Sign
              </button>
            </>
          )}
        </section>
      )}

      {/* Content */}
      <section className="rounded-xl border border-gray-200 bg-white p-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-[13px] font-bold text-gray-900">Content</h2>
          {editable && <Dictation onText={t => set({ body: `${draft.body}${draft.body && !draft.body.endsWith(" ") ? " " : ""}${t}` })} />}
        </div>
        {!editable && (
          <p className="mt-1 text-[11px] text-gray-500">
            {locked ? "Read-only: this document is signed." : "Read-only: you do not hold document.author in this workspace."}
          </p>
        )}

        {/* ── s8's PROTECTED REGION ────────────────────────────────────────────────────────────────────
            The letterhead is not in the box because it is not in the body. It is composed at print time
            from one definition, so correcting the practice's address corrects every future print rather
            than leaving a hundred signed documents disagreeing with it. Shown here so the writer knows
            what is above their first line, and shown as uneditable because it is. */}
        {props.letterheadLines && (
          <div className="mt-2 rounded-lg border border-dashed border-gray-300 bg-gray-50 px-3 py-2">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">
              Letterhead &mdash; printed above this document, not part of its text
            </p>
            <p className="mt-0.5 whitespace-pre-line text-[11.5px] text-gray-600">
              {props.letterheadLines.join("\n")}
            </p>
          </div>
        )}

        {/* One column below md, the same two above it — and every col-span-2 carries max-md:col-span-1
            so the stacked grid cannot grow an implicit second track. Document type and Addressed to are
            the pair that stops sharing a line: neither is a short field, and s10 only permits two
            side-by-side where they clearly fit. */}
        <div className="mt-2 grid grid-cols-2 gap-2 max-md:grid-cols-1">
          <label className="col-span-2 text-[11px] font-semibold text-gray-500 max-md:col-span-1" htmlFor="doc-title">Title</label>
          <input id="doc-title" disabled={!editable} value={draft.title} onChange={e => set({ title: e.target.value })}
            className={`${input} col-span-2 max-md:col-span-1 disabled:bg-gray-50 disabled:text-gray-500`} />

          <select aria-label="Document type" disabled={!editable} value={draft.docType} onChange={e => set({ docType: e.target.value })}
            className={`${input} disabled:bg-gray-50 disabled:text-gray-500`}>
            {DOC_TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
          <input aria-label="Addressed to" placeholder="Addressed to (optional)" disabled={!editable}
            value={draft.addressedTo} onChange={e => set({ addressedTo: e.target.value })}
            className={`${input} disabled:bg-gray-50 disabled:text-gray-500`} />

          <label className="col-span-2 mt-1 text-[11px] font-semibold text-gray-500 max-md:col-span-1" htmlFor="doc-body">Body</label>
          {/* ⚠ THE BODY'S SIZE BELOW md IS STATED, NOT INHERITED BY ACCIDENT. `input` now carries
              max-md:text-[16px] and this textarea carries text-[12px]; which of the two wins below md
              is a question about Tailwind's output ordering, and the answer to a question like that
              should not be load-bearing on a clinical editor. 16px is the deliberate choice — it is
              what stops iOS Safari zooming the page when the field takes focus mid-document. */}
          <textarea id="doc-body" ref={bodyRef} rows={18} disabled={!editable} value={draft.body} onChange={e => set({ body: e.target.value })}
            className={`${input} col-span-2 max-md:col-span-1 resize-y font-mono text-[12px] max-md:text-[16px] leading-relaxed disabled:bg-gray-50 disabled:text-gray-500`} />
        </div>

        {editable && (
          <div className="mt-2 flex items-center gap-2">
            <button type="button" disabled={busy || !draft.title.trim()} onClick={save}
              className="rounded-lg border border-gray-200 px-3 py-1.5 text-[12px] font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50">
              Save
            </button>
            {dirty && <span className="text-[10px] text-[var(--cmp-text-warning)]">unsaved changes</span>}
            <span className="ml-auto text-[10px] text-gray-400">
              Saved when you press Save. Nothing here writes on a timer.
            </span>
          </div>
        )}

        {/* ── s8's STRUCTURE, beside the text ──────────────────────────────────────────────────────── */}
        {props.templateSections.length > 0 && (
          <div className="mt-3 border-t border-gray-100 pt-2">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">
              The sections this template asks for
            </p>
            <ul className="mt-1 flex flex-col gap-0.5">
              {props.templateSections.map((s, i) => (
                <li key={`${s.heading}-${i}`} className="text-[11.5px] text-gray-600">
                  <span className="font-semibold text-gray-700">{s.heading}</span>
                  {s.prompt && <span className="text-gray-500"> &mdash; {s.prompt}</span>}
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {/* ── s8: SYSTEM-POPULATED vs MANUALLY ENTERED, named and resolved ─────────────────────────────
          "Clear distinction between system-populated and manually entered content." Everything in the box
          above is typed by a person unless it came from one of these, and each one shows WHAT IT WOULD
          RESOLVE TO for this document's patient -- so inserting {{patient.date_of_birth}} into a
          certificate is a decision made while looking at the date, not at the field name. */}
      {editable && (
        <section className="rounded-xl border border-gray-200 bg-white p-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-[13px] font-bold text-gray-900">Fields this practice can fill</h2>
            <button type="button" onClick={() => setShowMerge(v => !v)}
              className="text-[12px] font-semibold text-[var(--cp-primary-deep)] hover:underline">
              {showMerge ? "Hide" : "Show"}
            </button>
          </div>
          {showMerge && (
            props.merge.state !== "ok" ? (
              /* THREE STATES. A merge context that could not be built is NOT thirteen empty fields --
                 that reads as "this patient has no name" rather than "this could not be read". */
              <p className="mt-2 rounded-lg bg-[var(--cmp-surface-warning)] px-3 py-2 text-[12px] text-[var(--cmp-text-warning)]">
                These could not be resolved: {props.merge.detail}
              </p>
            ) : (
              <>
                <p className="mt-1 text-[11.5px] leading-relaxed text-gray-500">
                  Insert one and it is written into the text as <code>{"{{field}}"}</code>. It resolves when
                  the document is generated from a template; typed in by hand here it stays literal, and it
                  will block the signature until it is dealt with.
                </p>
                <ul className="mt-2 grid gap-1 sm:grid-cols-2">
                  {props.merge.value.map(f => (
                    <li key={f.field} className="flex items-start justify-between gap-2 rounded-lg border border-gray-100 px-2 py-1.5">
                      <span className="min-w-0">
                        <span className="block font-mono text-[11px] text-gray-700">{`{{${f.field}}}`}</span>
                        <span className={`block truncate text-[11.5px] ${f.state === "resolved" ? "text-gray-800" : "text-gray-400 italic"}`}
                          title={f.state === "resolved" ? (f.value ?? "") : f.description}>
                          {f.state === "resolved" ? f.value : "not recorded for this patient"}
                        </span>
                      </span>
                      <button type="button" onClick={() => insertAtCursor(`{{${f.field}}}`)}
                        className="shrink-0 rounded border border-gray-200 px-1.5 py-0.5 text-[11px] font-semibold text-gray-600 hover:bg-gray-50">
                        Insert
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )
          )}
        </section>
      )}

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

      {/* ── s6.4: ISSUE A COPY ──────────────────────────────────────────────────────────────────────
          A SEPARATE ACT FROM SIGNING, which is the whole of s7's distinction between Signed and Issued.
          Signing puts a name on the text; issuing records that a copy of it is now outside this practice
          and cannot be recalled. */}
      {canIssue && (
        <section className="rounded-xl border border-gray-200 bg-white p-4">
          <h2 className="text-[13px] font-bold text-gray-900">Issue a copy</h2>
          <p className="mt-1 text-[11.5px] leading-relaxed text-gray-500">
            Records that a copy left this practice &mdash; to whom, how and when. Nothing is sent from
            here, so there is no delivery receipt and none is implied.
          </p>
          {/* ══ CPR-MOB-001 s12 row 5, the "Issue-type" control, and s16 ═══════════════════════════════
              ⚠ THE TWO FIELDS STOP SHARING A LINE BELOW md. s10: "Avoid side-by-side dense form fields
              on narrow screens unless two short fields clearly fit." A channel select beside an email
              address does not fit on a 390px phone -- the address, which is the field that must be
              right, gets about 150px of it. One column below md, the two-column grid above md
              unchanged.

              ⚠ WHAT IS STILL WRONG HERE, AND IS NOT FIXED BY THIS PHASE: these three controls carry
              `aria-label` and a placeholder, and s16 is explicit that "placeholders are not
              substitutes" for a visible label. That is true at EVERY width, not just below md, so the
              honest fix changes the desktop form -- which this phase may not do. Reported rather than
              half-fixed: a label visible only on a phone would leave the defect in place and hide the
              evidence of it. */}
          <form className="mt-2 grid grid-cols-2 gap-2 max-md:grid-cols-1" onSubmit={async e => {
            e.preventDefault();
            const done = await call({ release }, "Recorded.", false);
            if (!done) return;
            const warnings: string[] = done?.release?.warnings ?? [];
            if (warnings.length > 0) { setNotice({ kind: "warn", text: warnings.join(" ") }); setBusy(false); return; }
            window.location.reload();
          }}>
            <select aria-label="How it was issued" value={release.channel} onChange={e => setRelease(r => ({ ...r, channel: e.target.value }))} className={input}>
              {RELEASE_CHANNELS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
            <input aria-label="To whom" placeholder={recipientRequired ? "Email address it went to" : "To whom (optional)"}
              value={release.recipient} onChange={e => setRelease(r => ({ ...r, recipient: e.target.value }))} className={input} />
            {/* ⚠ EVERY col-span-2 IN THIS FORM NEEDS max-md:col-span-1 BESIDE IT. CSS Grid does not clamp
                a span to the track count: `grid-column: span 2` inside a one-column grid CREATES an
                implicit second column, so stacking the form without this would have silently widened it
                past the viewport and reintroduced the horizontal scroll s4 forbids. */}
            <input aria-label="Note" placeholder="Note (optional)" value={release.note} onChange={e => setRelease(r => ({ ...r, note: e.target.value }))} className={`${input} col-span-2 max-md:col-span-1`} />
            {recipientRequired && (
              <p className="col-span-2 -mt-1 text-[11px] text-gray-500 max-md:col-span-1">
                An emailed copy needs the address it went to. There is no sent-items folder here to
                reconstruct it from later.
              </p>
            )}
            <button type="submit" disabled={busy || (recipientRequired && !release.recipient.trim())}
              className="col-span-2 rounded-lg border border-gray-200 py-2 text-[12px] font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50 max-md:col-span-1 max-md:flex max-md:min-h-[var(--cp-touch-primary)] max-md:items-center max-md:justify-center max-md:text-[14px]">
              Record
            </button>
          </form>
        </section>
      )}
    </div>
  );
}
