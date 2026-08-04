"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { ENCOUNTER_TRANSITIONS, NOTE_TYPES, LOCKED_STATUSES, actionFor, labelFor } from "@/lib/practice/encounter-constants";
import { DOC_TYPES } from "@/lib/practice/document-constants";
import { FOLLOW_UP_KINDS, FOLLOW_UP_PRIORITIES } from "@/lib/practice/follow-up-constants";
import {
  LATERALITIES, SIDED_LATERALITIES, CONSENT_STATUSES, PROCEDURE_STATUSES,
  OUTCOME_TYPES, OUTCOME_SEVERITIES, SEVERITY_REQUIRED_FOR,
} from "@/lib/practice/procedure-constants";
import Dictation from "@/components/practice/Dictation";
import DocumentationTools from "./DocumentationTools";
import { formatTime } from "@/lib/datetime";

// CPR-V2-006's consultation surface: the SOAP note, diagnoses, treatments, and the transition bar.
//
// THE BUTTONS ARE THE STATE TABLE. What renders is ENCOUNTER_TRANSITIONS[status] mapped through
// actionFor -- the same table the engine checks and the database CHECK constrains. There is no second
// list of "which buttons to show", so there is nothing to drift.
//
// SAVING TO THE RECORD IS EXPLICIT PER SEGMENT. An autosave that wrote to the record mid-sentence would
// put half-thoughts into a clinical note and make "what did I actually save" unanswerable; a Save on each
// SOAP box, with the saved state shown, keeps the practitioner in charge of what becomes the record. The
// engine refuses every write after signature, so a stale open tab cannot resurrect an edit.
//
// AND SINCE MIGRATION 207 THERE IS ALSO AN AUTOSAVE, which is not a reversal of that. This comment used
// to argue against autosave outright, and it was written without reading CPR-130 s3 -- which lists
// autosave first among its functional requirements, and which CPR-360's comp independently corroborates
// at two minutes. The argument above was answering a different question: it is about what reaches THE
// RECORD, and the autosave does not reach the record. It writes a DRAFT, private to its author,
// overwritten in place, deleted the moment its text is saved properly, and labelled on screen as "not in
// the record yet". Twenty autosaves write no version history at all. See documentation-tools.ts.
//
// CPR-130 ADDED THREE THINGS HERE, and one rule about all of them:
//
//   TEMPLATES   fill EMPTY segments only. The button says so, and the engine enforces it -- applying a
//               template can never take away text a practitioner has typed.
//   DICTATION   is the browser's, with its own disclosure (see components/practice/Dictation). Dictated
//               text lands in the box and is saved by the same explicit Save as anything typed: nothing
//               reaches the record without the practitioner reading it first.
//   HISTORY     every saved version of every segment, readable inline. A signed note now answers "what
//               did this say before" instead of quietly forgetting.

/* eslint-disable @typescript-eslint/no-explicit-any */

const input = "w-full rounded-lg border border-gray-200 px-2.5 py-2 text-[13px] outline-none focus:border-[var(--cp-primary)] focus:ring-2 focus:ring-[var(--cp-primary)]/10";

const NOTE_LABEL: Record<string, string> = {
  subjective: "Subjective — what the patient reports",
  objective: "Objective — examination and findings",
  assessment: "Assessment — clinical impression",
  plan: "Plan — what happens next",
  narrative: "Narrative — free text",
};

const TREATMENT_TYPES = [
  ["medication", "Medication"], ["investigation", "Investigation"], ["procedure", "Procedure"],
  ["advice", "Advice"], ["referral", "Referral"], ["monitoring", "Monitoring"],
] as const;

export default function EncounterConsole(props: {
  encounterId: string; patientId: string; status: string; reasonForVisit: string | null;
  notes: any[]; diagnoses: any[]; treatments: any[];
  templates: any[]; history: Record<string, any[]>; documents: any[];
  followUps: any[]; intervals: { code: string; label: string; days: number }[];
  procedures: any[]; procedureTypes: any[];
  canEdit: boolean; canSign: boolean; canDiagnose: boolean; canTreat: boolean;
  canDocument: boolean; canFollowUp: boolean; canProcedure: boolean;
  phrases: any[]; attachments: any[]; drafts: any[];
}) {
  const locked = LOCKED_STATUSES.includes(props.status) || props.status === "CANCELLED";
  const editable = props.canEdit && !locked;

  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [bodies, setBodies] = useState<Record<string, string>>(() => {
    const seed: Record<string, string> = {};
    for (const t of NOTE_TYPES) seed[t] = props.notes.find(n => n.note_type === t)?.body ?? "";
    return seed;
  });
  const [saved, setSaved] = useState<Record<string, boolean>>({});
  // Which segment came from dictation SINCE THE PAGE LOADED. Sent with the save so the version records
  // its provenance -- see migration 195 s3. Cleared on save because the next edit may well be typed.
  const [dictated, setDictated] = useState<Record<string, boolean>>({});
  const [showHistory, setShowHistory] = useState<Record<string, boolean>>({});
  const [templateId, setTemplateId] = useState("");
  const [dx, setDx] = useState({ label: "", certainty: "provisional", isPrimary: false, problemLabel: "" });
  const [tx, setTx] = useState({ treatmentType: "medication", label: "", dose: "", route: "", frequency: "", duration: "" });
  const [doc, setDoc] = useState({ title: "", docType: "consultation_summary", addressedTo: "", composeFrom: true });
  const [fu, setFu] = useState({ reason: "", kind: "review", intervalCode: "2w", priority: "routine" });
  const [closingFu, setClosingFu] = useState<string | null>(null);
  const [fuOutcome, setFuOutcome] = useState("");
  const [proc, setProc] = useState({
    procedureTypeId: "", label: "", site: "", laterality: "not_applicable",
    indication: "", consentStatus: "not_recorded", status: "PERFORMED",
    abandonedReason: "", immediateOutcome: "",
  });
  const [outcomeFor, setOutcomeFor] = useState<string | null>(null);
  const [outcome, setOutcome] = useState({ outcomeType: "healing", severity: "mild", detail: "" });

  // ── CPR-130 AUTOSAVE ──────────────────────────────────────────────────────────────────────────────
  //
  // Every two minutes, to a DRAFT -- never to the record. The distinction is the whole reason autosave
  // is buildable at all (see documentation-tools.ts): a version answers "what did the record say at
  // 10:55", a draft answers "what was in the box when the browser closed". Twenty autosaves write no
  // version history.
  //
  // The interval is the one CPR-360's comp specifies. It is a constant here rather than a setting,
  // because a per-user autosave interval is a preference with nothing to gain from being adjustable.
  const [draftAt, setDraftAt] = useState<Record<string, string>>({});
  // Only drafts that actually DIFFER from what is saved are worth offering back; one that matches the
  // record is not a recovery, it is a prompt to re-do work already done.
  const [recoverable, setRecoverable] = useState<any[]>(() => props.drafts.filter(d => d.differsFromSaved));
  // The refs exist so the interval below reads the CURRENT text rather than the text as it was when the
  // timer was created -- and they are written in an effect, not during render, because a ref mutated
  // during render is read by a concurrent re-render that never committed.
  const bodiesRef = useRef(bodies);
  const savedRef = useRef(saved);
  useEffect(() => { bodiesRef.current = bodies; savedRef.current = saved; }, [bodies, saved]);

  useEffect(() => {
    if (!editable) return;
    const timer = setInterval(() => {
      for (const t of NOTE_TYPES) {
        // Only what has been touched and not yet saved. Autosaving an untouched segment would write a
        // draft of the text already in the record and then offer it back as a recovery.
        if (savedRef.current[t] !== false) continue;
        const body = bodiesRef.current[t] ?? "";
        fetch(`/api/v1/practice/encounters/${props.encounterId}/drafts`, {
          method: "PUT", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ noteType: t, body }),
        }).then(r => {
          if (r.ok) setDraftAt(d => ({ ...d, [t]: formatTime(new Date()) }));
        }).catch(() => {});
      }
    }, 120_000);
    return () => clearInterval(timer);
  }, [editable, props.encounterId]);

  async function expandInto(noteType: string) {
    const res = await fetch("/api/v1/practice/smart-phrases?expand=1", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: bodies[noteType] ?? "" }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { setNotice({ kind: "err", text: "That did not work." }); return; }
    if (!data.expanded?.length) { setNotice({ kind: "ok", text: "No shortcuts found in that segment." }); return; }
    setBodies(b => ({ ...b, [noteType]: data.text }));
    setSaved(s => ({ ...s, [noteType]: false }));
    setNotice({ kind: "ok", text: `Expanded ${data.expanded.join(", ")}. Not saved yet.` });
  }

  const insertIntoSegment = (noteType: string, text: string) => {
    setBodies(b => ({ ...b, [noteType]: `${b[noteType]}${b[noteType] && !b[noteType].endsWith("\n") ? "\n" : ""}${text}` }));
    setSaved(s => ({ ...s, [noteType]: false }));
    setNotice({ kind: "ok", text: "Added to the note. Not saved yet." });
  };

  async function call(fn: () => Promise<Response>, okText: string, reload: boolean) {
    setBusy(true); setNotice(null);
    const res = await fn();
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setNotice({ kind: "err", text: data?.error?.message ?? data?.error ?? "That did not work." });
      setBusy(false); return false;
    }
    if (reload) { window.location.reload(); return true; }
    setNotice({ kind: "ok", text: okText }); setBusy(false); return true;
  }

  const saveNote = async (noteType: string) => {
    const ok = await call(() => fetch(`/api/v1/practice/encounters/${props.encounterId}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ noteType, body: bodies[noteType], source: dictated[noteType] ? "dictation" : "typed" }),
    }), "Saved.", false);
    if (ok) {
      setSaved(s => ({ ...s, [noteType]: true }));
      setDictated(d => ({ ...d, [noteType]: false }));
    }
  };

  const applyTemplate = () => {
    if (!templateId) return;
    call(() => fetch(`/api/v1/practice/encounters/${props.encounterId}/notes`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ templateId, mode: "fill_empty" }),
    }), "Template applied.", true);
  };

  const createDocument = () => call(() => fetch("/api/v1/practice/documents", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      patientId: props.patientId, encounterId: props.encounterId,
      title: doc.title, docType: doc.docType,
      addressedTo: doc.addressedTo || undefined, composeFrom: doc.composeFrom,
    }),
  }), "Document created.", true);

  const raiseFollowUp = () => call(() => fetch("/api/v1/practice/follow-ups", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      patientId: props.patientId, originEncounterId: props.encounterId,
      reason: fu.reason, kind: fu.kind, intervalCode: fu.intervalCode, priority: fu.priority,
    }),
  }), "Follow-up raised.", true);

  // CLOSING FROM HERE NAMES THIS ENCOUNTER as what settled it, which is the whole point of doing it in
  // the consultation rather than on the board: the record then says WHERE the obligation was met, not
  // just that somebody ticked it.
  const closeFollowUp = (id: string) => call(() => fetch(`/api/v1/practice/follow-ups/${id}`, {
    method: "PATCH", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "complete", closingEncounterId: props.encounterId, outcome: fuOutcome }),
  }), "Follow-up closed.", true);

  const recordProcedure = () => call(() => fetch("/api/v1/practice/procedures", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ encounterId: props.encounterId, ...proc, procedureTypeId: proc.procedureTypeId || undefined }),
  }), "Procedure recorded.", true);

  // THE OBSERVING ENCOUNTER IS THIS ONE, and it is what makes the outcome traceable: a reader can walk
  // from "this wound got infected" back to the day it was made.
  const addOutcome = (procedureId: string) => call(() => fetch(`/api/v1/practice/procedures/${procedureId}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      observedAtEncounterId: props.encounterId, outcomeType: outcome.outcomeType,
      severity: SEVERITY_REQUIRED_FOR.includes(outcome.outcomeType) ? outcome.severity : undefined,
      detail: outcome.detail,
    }),
  }), "Outcome recorded.", true);

  const transition = (action: string, label: string) => {
    if (action === "sign" && !confirm("Signing locks this encounter. Only a governed amendment can change it afterwards. Sign now?")) return;
    if (action === "entered_in_error" && !confirm("Mark this encounter as entered in error? It stays in the record, permanently flagged.")) return;
    call(() => fetch(`/api/v1/practice/encounters/${props.encounterId}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }),
    }), label, true);
  };

  const addDx = () => call(() => fetch(`/api/v1/practice/encounters/${props.encounterId}/diagnoses`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      label: dx.label, certainty: dx.certainty, isPrimary: dx.isPrimary,
      problemLabel: dx.problemLabel || undefined,
    }),
  }), "Diagnosis recorded.", true);

  const addTx = () => call(() => fetch(`/api/v1/practice/encounters/${props.encounterId}/treatments`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      treatmentType: tx.treatmentType, label: tx.label,
      dose: tx.dose || undefined, route: tx.route || undefined,
      frequency: tx.frequency || undefined, duration: tx.duration || undefined,
    }),
  }), "Treatment recorded.", true);

  const targets = ENCOUNTER_TRANSITIONS[props.status] ?? [];

  return (
    <div className="flex flex-col gap-4">
      {notice && (
        <p className={`rounded-lg px-3 py-2 text-[12px] ${notice.kind === "ok" ? "bg-[var(--cmp-surface-success)] text-[var(--cmp-text-success)]" : "bg-[var(--cmp-surface-critical)] text-[var(--cmp-text-critical)]"}`}>{notice.text}</p>
      )}

      {/* ── CPR-130 draft recovery ────────────────────────────────────────────────────────────────
          The reason autosave exists. Text this practitioner had in a box when they last left, which
          never reached the record.

          IT IS OFFERED, NOT APPLIED. Restoring puts it back in the box and leaves it unsaved, so what
          becomes the record is still a decision somebody makes. Silently restoring would resurrect a
          half-written differential from a fortnight ago into a consultation about something else. */}
      {editable && recoverable.length > 0 && (
        <section className="rounded-xl border border-[var(--cmp-color-warning)] bg-[var(--cmp-surface-warning)] p-3">
          <p className="text-[12px] font-bold text-[var(--cmp-text-warning)]">
            You have unsaved text from an earlier session.
          </p>
          <ul className="mt-1.5 flex flex-col gap-1.5">
            {recoverable.map((d: any) => (
              <li key={d.noteType} className="text-[11px] text-gray-700">
                <span className="font-semibold">{NOTE_LABEL[d.noteType]?.split(" — ")[0] ?? d.noteType}</span>
                <span className="text-gray-500"> · kept {String(d.updatedAt).slice(0, 16).replace("T", " ")}</span>
                {d.savedMovedOn && (
                  <span className="ml-1 font-semibold text-[var(--cmp-text-critical)]">
                    the note has changed since &mdash; restoring would overwrite that
                  </span>
                )}
                <p className="mt-0.5 whitespace-pre-wrap rounded bg-white/60 px-2 py-1 text-[11px] text-gray-600">{d.body}</p>
                <span className="mt-1 flex gap-2">
                  <button type="button" onClick={() => {
                    setBodies(b => ({ ...b, [d.noteType]: d.body }));
                    setSaved(s => ({ ...s, [d.noteType]: false }));
                    setRecoverable(r => r.filter((x: any) => x.noteType !== d.noteType));
                    setNotice({ kind: "ok", text: "Put back in the box. It is not saved until you save it." });
                  }} className="rounded border border-gray-300 px-2 py-0.5 text-[11px] font-semibold text-gray-700 hover:bg-white">
                    Put it back
                  </button>
                  <button type="button" onClick={() => {
                    fetch(`/api/v1/practice/encounters/${props.encounterId}/drafts?noteType=${d.noteType}`, { method: "DELETE" });
                    setRecoverable(r => r.filter((x: any) => x.noteType !== d.noteType));
                  }} className="text-[11px] text-gray-500 hover:underline">
                    Discard it
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Transition bar */}
      <section className="rounded-xl border border-gray-200 bg-white p-4">
        <h2 className="text-[13px] font-bold text-gray-900">Encounter</h2>
        {props.reasonForVisit && <p className="mt-0.5 text-[12px] text-gray-600">Reason: {props.reasonForVisit}</p>}
        {targets.length === 0 ? (
          <p className="mt-2 text-[12px] text-gray-400">This encounter is closed. No further transitions are possible.</p>
        ) : (
          <div className="mt-2 flex gap-1.5 flex-wrap">
            {targets.map(to => {
              const action = actionFor(props.status, to);
              if (!action) return null;
              const needsSign = to === "SIGNED";
              const allowed = needsSign ? props.canSign : props.canEdit;
              if (!allowed) return null;
              const danger = to === "CANCELLED" || to === "ENTERED_IN_ERROR";
              return (
                <button key={to} type="button" disabled={busy} onClick={() => transition(action, `${labelFor(props.status, to)} done.`)}
                  className={`rounded-lg px-3 py-1.5 text-[12px] font-semibold disabled:opacity-50 ${
                    needsSign ? "bg-[var(--cp-primary)] text-white hover:bg-[var(--cp-primary-deep)]"
                      : danger ? "border border-[var(--cmp-color-critical)] text-[var(--cmp-text-critical)] hover:bg-[var(--cmp-surface-critical)]"
                        : "border border-gray-200 text-gray-700 hover:bg-gray-50"}`}>
                  {labelFor(props.status, to)}
                </button>
              );
            })}
          </div>
        )}
      </section>

      {/* SOAP note */}
      <section className="rounded-xl border border-gray-200 bg-white p-4">
        <h2 className="text-[13px] font-bold text-gray-900">Clinical note</h2>
        {!editable && (
          <p className="mt-1 text-[11px] text-gray-500">
            {locked ? "Read-only: this encounter is closed." : "Read-only: you do not hold encounter.edit in this workspace."}
          </p>
        )}

        {/* Template picker (CPR-130). Fill-empty only, and the copy says so where the click happens. */}
        {editable && props.templates.length > 0 && (
          <div className="mt-2 flex items-end gap-2 flex-wrap rounded-lg bg-gray-50 p-2">
            <div className="flex-1 min-w-[180px]">
              <label htmlFor="template-pick" className="text-[10px] font-semibold text-gray-500">Structure this note from a template</label>
              <select id="template-pick" value={templateId} onChange={e => setTemplateId(e.target.value)} className={`${input} mt-0.5`}>
                <option value="">Choose a template…</option>
                {props.templates.map(t => (
                  <option key={t.id} value={t.id}>{t.title}{t.scope === "platform" ? " (supplied)" : ""}</option>
                ))}
              </select>
            </div>
            <button type="button" disabled={busy || !templateId} onClick={applyTemplate}
              className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-[12px] font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50">
              Apply
            </button>
            <p className="w-full text-[10px] text-gray-400">
              Only empty segments are filled. Anything you have already written stays exactly as it is.
            </p>
          </div>
        )}

        <div className="mt-2 flex flex-col gap-3">
          {NOTE_TYPES.map(t => {
            const versions = props.history[t] ?? [];
            return (
              <div key={t}>
                <div className="flex items-center justify-between gap-2">
                  <label htmlFor={`note-${t}`} className="text-[11px] font-semibold text-gray-500">{NOTE_LABEL[t]}</label>
                  {editable && (
                    <Dictation label="Dictate"
                      onText={text => {
                        setBodies(b => ({ ...b, [t]: `${b[t]}${b[t] && !b[t].endsWith(" ") ? " " : ""}${text}` }));
                        setSaved(s => ({ ...s, [t]: false }));
                        setDictated(d => ({ ...d, [t]: true }));
                      }} />
                  )}
                </div>
                <textarea id={`note-${t}`} rows={t === "narrative" ? 4 : 3} disabled={!editable}
                  value={bodies[t]} onChange={e => { setBodies(b => ({ ...b, [t]: e.target.value })); setSaved(s => ({ ...s, [t]: false })); }}
                  className={`${input} mt-1 resize-y disabled:bg-gray-50 disabled:text-gray-500`} />
                <div className="mt-1 flex items-center gap-2 flex-wrap">
                  {editable && (
                    <>
                      <button type="button" disabled={busy} onClick={() => saveNote(t)}
                        className="rounded border border-gray-200 px-2 py-0.5 text-[11px] font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-50">
                        Save
                      </button>
                      {/* CPR-130 smart text. Expansion is a BUTTON, never something that happens as you
                          type: text in a clinical note must not change under somebody's hands. */}
                      {props.phrases.length > 0 && (
                        <button type="button" disabled={busy} onClick={() => expandInto(t)}
                          className="rounded border border-gray-200 px-2 py-0.5 text-[11px] font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-50">
                          Expand
                        </button>
                      )}
                      {saved[t] && <span className="text-[10px] text-[var(--cmp-text-success)]">saved</span>}
                      {dictated[t] && <span className="text-[10px] text-gray-400">will be recorded as dictated</span>}
                      {/* THE AUTOSAVE INDICATOR SAYS "DRAFT", not "saved". A practitioner who read this as
                          a save would leave a consultation believing the record held something it does
                          not. */}
                      {draftAt[t] && !saved[t] && (
                        <span className="text-[10px] text-gray-400">draft kept {draftAt[t]} &mdash; not in the record yet</span>
                      )}
                    </>
                  )}
                  {versions.length > 0 && (
                    <button type="button" onClick={() => setShowHistory(h => ({ ...h, [t]: !h[t] }))}
                      className="ml-auto text-[10px] font-semibold text-[var(--cp-primary-deep)] hover:underline">
                      {showHistory[t] ? "Hide" : `${versions.length} earlier version${versions.length === 1 ? "" : "s"}`}
                    </button>
                  )}
                </div>
                {showHistory[t] && (
                  <ul className="mt-1.5 flex flex-col gap-1.5 border-l-2 border-gray-100 pl-2">
                    {versions.map((v: any) => (
                      <li key={v.id}>
                        <p className="text-[10px] text-gray-400">
                          v{v.version} · {String(v.created_at).slice(0, 16).replace("T", " ")} · {v.source}
                        </p>
                        <p className="whitespace-pre-wrap text-[11px] text-gray-600">{v.body || <span className="text-gray-300">(empty)</span>}</p>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      </section>

      <DocumentationTools
        encounterId={props.encounterId}
        editable={editable}
        segments={NOTE_TYPES}
        phrases={props.phrases}
        attachments={props.attachments}
        onInsert={insertIntoSegment}
      />

      {/* Diagnoses */}
      <section className="rounded-xl border border-gray-200 bg-white p-4">
        <h2 className="text-[13px] font-bold text-gray-900">Diagnoses</h2>
        {props.diagnoses.length === 0 ? (
          <p className="mt-2 text-[12px] text-gray-400">None recorded for this encounter.</p>
        ) : (
          <ul className="mt-2 flex flex-col gap-1">
            {props.diagnoses.map(d => (
              <li key={d.id} className="flex items-center gap-2 text-[12px]">
                {d.is_primary && <span className="rounded bg-[var(--cmp-surface-information)] px-1.5 py-0.5 text-[10px] font-bold text-[var(--cmp-text-information)]">primary</span>}
                <span className="text-gray-800">{d.label}</span>
                {d.code && <span className="font-mono text-[11px] text-gray-400">{d.code}</span>}
                <span className="ml-auto text-[11px] text-gray-500">{d.certainty}</span>
                {d.problem_id && <span className="text-[10px] text-gray-400">on problem list</span>}
              </li>
            ))}
          </ul>
        )}
        {editable && props.canDiagnose && (
          <form className="mt-3 grid grid-cols-2 gap-2" onSubmit={e => { e.preventDefault(); addDx(); }}>
            <input required placeholder="Diagnosis" value={dx.label} onChange={e => setDx(p => ({ ...p, label: e.target.value }))} className={`${input} col-span-2`} />
            <select value={dx.certainty} onChange={e => setDx(p => ({ ...p, certainty: e.target.value }))} className={input}>
              {["suspected", "provisional", "confirmed", "ruled_out"].map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <label className="flex items-center gap-2 text-[12px] text-gray-600">
              <input type="checkbox" checked={dx.isPrimary} onChange={e => setDx(p => ({ ...p, isPrimary: e.target.checked }))} />
              Primary diagnosis
            </label>
            <input placeholder="Add to problem list as (optional)" value={dx.problemLabel} onChange={e => setDx(p => ({ ...p, problemLabel: e.target.value }))} className={`${input} col-span-2`} />
            <button type="submit" disabled={busy || !dx.label.trim()}
              className="col-span-2 rounded-lg border border-gray-200 py-2 text-[12px] font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50">
              Record diagnosis
            </button>
            <p className="col-span-2 text-[10px] text-gray-400">
              Naming a problem promotes this diagnosis to the patient&apos;s ongoing problem list, where it
              carries across visits. Leave it blank for a complaint that belongs to today only.
            </p>
          </form>
        )}
      </section>

      {/* Treatments */}
      <section className="rounded-xl border border-gray-200 bg-white p-4">
        <h2 className="text-[13px] font-bold text-gray-900">Treatment and plan</h2>
        {props.treatments.length === 0 ? (
          <p className="mt-2 text-[12px] text-gray-400">Nothing recorded for this encounter.</p>
        ) : (
          <ul className="mt-2 flex flex-col gap-1">
            {props.treatments.map(t => (
              <li key={t.id} className="flex items-center gap-2 text-[12px] flex-wrap">
                <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold text-gray-500">{t.treatment_type}</span>
                <span className="text-gray-800">{t.label}</span>
                <span className="text-[11px] text-gray-500">
                  {[t.dose, t.route, t.frequency, t.duration].filter(Boolean).join(" · ")}
                </span>
                <span className="ml-auto text-[11px] text-gray-400">{t.status}</span>
              </li>
            ))}
          </ul>
        )}
        {editable && props.canTreat && (
          <form className="mt-3 grid grid-cols-2 gap-2" onSubmit={e => { e.preventDefault(); addTx(); }}>
            <select value={tx.treatmentType} onChange={e => setTx(p => ({ ...p, treatmentType: e.target.value }))} className={input}>
              {TREATMENT_TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
            <input required placeholder="What" value={tx.label} onChange={e => setTx(p => ({ ...p, label: e.target.value }))} className={input} />
            {tx.treatmentType === "medication" && (
              <>
                <input placeholder="Dose" value={tx.dose} onChange={e => setTx(p => ({ ...p, dose: e.target.value }))} className={input} />
                <input placeholder="Route" value={tx.route} onChange={e => setTx(p => ({ ...p, route: e.target.value }))} className={input} />
                <input placeholder="Frequency" value={tx.frequency} onChange={e => setTx(p => ({ ...p, frequency: e.target.value }))} className={input} />
                <input placeholder="Duration" value={tx.duration} onChange={e => setTx(p => ({ ...p, duration: e.target.value }))} className={input} />
              </>
            )}
            <button type="submit" disabled={busy || !tx.label.trim()}
              className="col-span-2 rounded-lg border border-gray-200 py-2 text-[12px] font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50">
              Record
            </button>
            <p className="col-span-2 text-[10px] text-gray-400">
              A medication here records what was prescribed, not what was administered. Competen Practice
              does not hold an inpatient administration chart.
            </p>
          </form>
        )}
      </section>

      {/* Procedures (CPR-150). What was DONE, as distinct from the plan above it: a treatment row saying
          "excision, planned" is not evidence anything happened, and a procedure row is. The patient's
          recent procedures are listed, not just today's, because an outcome is learned later. */}
      <section className="rounded-xl border border-gray-200 bg-white p-4">
        <h2 className="text-[13px] font-bold text-gray-900">Procedures performed</h2>
        {props.procedures.length === 0 ? (
          <p className="mt-2 text-[12px] text-gray-400">Nothing recorded for this patient.</p>
        ) : (
          <ul className="mt-2 flex flex-col gap-2">
            {props.procedures.map(p => (
              <li key={p.id} className="border-l-2 border-gray-100 pl-2">
                <div className="flex items-center gap-2 flex-wrap text-[12px]">
                  <span className="font-semibold text-gray-800">{p.label}</span>
                  {SIDED_LATERALITIES.includes(p.laterality) && (
                    <span className="rounded bg-[var(--cmp-surface-information)] px-1.5 py-0.5 text-[10px] font-bold text-[var(--cmp-text-information)]">
                      {p.laterality}
                    </span>
                  )}
                  {p.site && <span className="text-gray-600">{p.site}</span>}
                  {p.status === "ABANDONED" && (
                    <span className="rounded bg-[var(--cmp-surface-warning)] px-1.5 py-0.5 text-[10px] font-bold text-[var(--cmp-text-warning)]">abandoned</span>
                  )}
                  {p.hasComplication && (
                    <span className="rounded bg-[var(--cmp-surface-critical)] px-1.5 py-0.5 text-[10px] font-bold text-[var(--cmp-text-critical)]">complication</span>
                  )}
                  <span className="ml-auto text-[11px] text-gray-400">{String(p.performed_at).slice(0, 10)}</span>
                </div>
                <p className="text-[10px] text-gray-400">
                  consent {String(p.consent_status).replace(/_/g, " ")}
                  {p.encounter_id === props.encounterId ? " · this consultation" : ""}
                </p>
                {p.outcomes.length > 0 && (
                  <ul className="mt-0.5 flex flex-col gap-0.5">
                    {p.outcomes.map((o: any) => (
                      <li key={o.id} className="text-[11px] text-gray-600">
                        <span className="text-gray-400">{o.observed_on}</span>{" "}
                        <span className={o.outcome_type === "complication" ? "font-semibold text-[var(--cmp-text-critical)]" : ""}>
                          {o.outcome_type}{o.severity ? ` (${o.severity})` : ""}
                        </span>{" "}
                        {o.detail}
                      </li>
                    ))}
                  </ul>
                )}
                {editable && props.canProcedure && (
                  <button type="button" disabled={busy}
                    onClick={() => { setOutcome({ outcomeType: "healing", severity: "mild", detail: "" }); setOutcomeFor(outcomeFor === p.id ? null : p.id); }}
                    className="mt-1 rounded border border-gray-200 px-2 py-0.5 text-[11px] font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-50">
                    Record what has happened since
                  </button>
                )}
                {outcomeFor === p.id && (
                  <form className="mt-1.5 grid grid-cols-2 gap-2 rounded-lg bg-gray-50 p-2"
                    onSubmit={e => { e.preventDefault(); addOutcome(p.id); }}>
                    <select aria-label="Outcome type" value={outcome.outcomeType}
                      onChange={e => setOutcome(o => ({ ...o, outcomeType: e.target.value }))} className={input}>
                      {OUTCOME_TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                    </select>
                    {SEVERITY_REQUIRED_FOR.includes(outcome.outcomeType) ? (
                      <select aria-label="Severity" value={outcome.severity}
                        onChange={e => setOutcome(o => ({ ...o, severity: e.target.value }))} className={input}>
                        {OUTCOME_SEVERITIES.map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                    ) : <span />}
                    <input required placeholder="What was observed" value={outcome.detail}
                      onChange={e => setOutcome(o => ({ ...o, detail: e.target.value }))} className={`${input} col-span-2`} />
                    <button type="submit" disabled={busy || !outcome.detail.trim()}
                      className="col-span-2 rounded-lg border border-gray-200 bg-white py-1.5 text-[12px] font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50">
                      Record
                    </button>
                    <p className="col-span-2 text-[10px] text-gray-400">
                      This is filed against today&apos;s consultation as where it was noticed, and against
                      the procedure as what it is about. The original record is untouched.
                    </p>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}

        {editable && props.canProcedure && (
          <form className="mt-3 grid grid-cols-2 gap-2" onSubmit={e => { e.preventDefault(); recordProcedure(); }}>
            <select aria-label="Procedure" value={proc.procedureTypeId}
              onChange={e => {
                const t = props.procedureTypes.find(x => x.id === e.target.value);
                setProc(p => ({
                  ...p, procedureTypeId: e.target.value, label: t?.name ?? p.label,
                  // Reset the side when the chosen procedure has none, so a stale "left" cannot ride
                  // along from a previous selection.
                  laterality: t?.sided ? p.laterality : "not_applicable",
                }));
              }}
              className={`${input} col-span-2`}>
              <option value="">Choose from the catalogue, or type a name below…</option>
              {props.procedureTypes.map(t => (
                <option key={t.id} value={t.id}>
                  {t.name}{t.sided ? " (sided)" : ""}{t.consent_required ? " · consent required" : ""}
                </option>
              ))}
            </select>
            <input placeholder="Name (if not in the catalogue)" value={proc.label}
              onChange={e => setProc(p => ({ ...p, label: e.target.value }))} className={input} />
            <input placeholder="Site (optional)" value={proc.site}
              onChange={e => setProc(p => ({ ...p, site: e.target.value }))} className={input} />
            <select aria-label="Side" value={proc.laterality}
              onChange={e => setProc(p => ({ ...p, laterality: e.target.value }))} className={input}>
              {LATERALITIES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
            <select aria-label="Consent" value={proc.consentStatus}
              onChange={e => setProc(p => ({ ...p, consentStatus: e.target.value }))} className={input}>
              {CONSENT_STATUSES.map(([k, l]) => <option key={k} value={k}>Consent: {l}</option>)}
            </select>
            <input placeholder="Indication (optional)" value={proc.indication}
              onChange={e => setProc(p => ({ ...p, indication: e.target.value }))} className={input} />
            <select aria-label="Outcome" value={proc.status}
              onChange={e => setProc(p => ({ ...p, status: e.target.value }))} className={input}>
              {PROCEDURE_STATUSES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
            {proc.status === "ABANDONED" && (
              <input required placeholder="Why was it abandoned?" value={proc.abandonedReason}
                onChange={e => setProc(p => ({ ...p, abandonedReason: e.target.value }))} className={`${input} col-span-2`} />
            )}
            <input placeholder="Immediate outcome (optional)" value={proc.immediateOutcome}
              onChange={e => setProc(p => ({ ...p, immediateOutcome: e.target.value }))} className={`${input} col-span-2`} />
            <button type="submit" disabled={busy || !(proc.label.trim() || proc.procedureTypeId)}
              className="col-span-2 rounded-lg border border-gray-200 py-2 text-[12px] font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50">
              Record procedure
            </button>
            <p className="col-span-2 text-[10px] text-gray-400">
              A procedure marked sided will be refused without a side, and one requiring consent will be
              refused while consent reads &ldquo;not recorded&rdquo;. Neither is a warning you can click
              past &mdash; the engine says no.
            </p>
          </form>
        )}
      </section>

      {/* Follow-ups (CPR-140). The patient's LIVE obligations, not this encounter's -- one raised at the
          last visit is exactly what today is meant to settle, and showing only today's would hide it. */}
      <section className="rounded-xl border border-gray-200 bg-white p-4">
        <h2 className="text-[13px] font-bold text-gray-900">Follow-up</h2>
        {props.followUps.length === 0 ? (
          <p className="mt-2 text-[12px] text-gray-400">Nothing is owed to this patient.</p>
        ) : (
          <ul className="mt-2 flex flex-col gap-1.5">
            {props.followUps.map(f => (
              <li key={f.id} className={`text-[12px] ${f.overdue ? "border-l-2 border-[var(--cmp-color-critical)] pl-2" : ""}`}>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-gray-800">{f.reason}</span>
                  <span className={`text-[11px] ${f.overdue ? "font-bold text-[var(--cmp-text-critical)]" : "text-gray-500"}`}>
                    {f.overdue ? `${Math.abs(f.dueInDays)} days overdue` : `due ${f.due_on}`}
                  </span>
                  {props.canFollowUp && (
                    <button type="button" disabled={busy}
                      onClick={() => { setFuOutcome(""); setClosingFu(closingFu === f.id ? null : f.id); }}
                      className="ml-auto rounded border border-gray-200 px-2 py-0.5 text-[11px] font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-50">
                      Settle in this consultation
                    </button>
                  )}
                </div>
                {closingFu === f.id && (
                  <form className="mt-1.5 flex flex-col gap-1.5 rounded-lg bg-gray-50 p-2"
                    onSubmit={e => { e.preventDefault(); closeFollowUp(f.id); }}>
                    <input autoFocus placeholder="What happened? (optional — this encounter is recorded as the closer)"
                      value={fuOutcome} onChange={e => setFuOutcome(e.target.value)} className={input} />
                    <button type="submit" disabled={busy}
                      className="self-start rounded-lg bg-[var(--cp-primary)] px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-[var(--cp-primary-deep)] disabled:opacity-50">
                      Close as done
                    </button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}

        {props.canFollowUp && (
          <form className="mt-3 grid grid-cols-2 gap-2" onSubmit={e => { e.preventDefault(); raiseFollowUp(); }}>
            <input required placeholder="What needs to happen, and why" value={fu.reason}
              onChange={e => setFu(p => ({ ...p, reason: e.target.value }))} className={`${input} col-span-2`} />
            <select aria-label="Kind of follow-up" value={fu.kind} onChange={e => setFu(p => ({ ...p, kind: e.target.value }))} className={input}>
              {FOLLOW_UP_KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
            <select aria-label="When" value={fu.intervalCode} onChange={e => setFu(p => ({ ...p, intervalCode: e.target.value }))} className={input}>
              {props.intervals.map(i => <option key={i.code} value={i.code}>{i.label}</option>)}
            </select>
            <select aria-label="Priority" value={fu.priority} onChange={e => setFu(p => ({ ...p, priority: e.target.value }))} className={input}>
              {FOLLOW_UP_PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
            <button type="submit" disabled={busy || !fu.reason.trim()}
              className="rounded-lg border border-gray-200 py-2 text-[12px] font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50">
              Raise a follow-up
            </button>
            <p className="col-span-2 text-[10px] text-gray-400">
              The intervals are arithmetic on today&apos;s date, not clinical guidance. Once raised, this
              appears on the follow-up board and becomes overdue on its own if nothing is booked.
            </p>
          </form>
        )}
      </section>

      {/* Documents (CPR-130). A document is created FROM this consultation and signed separately from it:
          signing the encounter records what happened, signing a document issues something to someone. */}
      <section className="rounded-xl border border-gray-200 bg-white p-4">
        <h2 className="text-[13px] font-bold text-gray-900">Documents</h2>
        {props.documents.length === 0 ? (
          <p className="mt-2 text-[12px] text-gray-400">Nothing has been drafted from this consultation.</p>
        ) : (
          <ul className="mt-2 flex flex-col gap-1">
            {props.documents.map(d => (
              <li key={d.id} className="flex items-center gap-2 text-[12px] flex-wrap">
                <Link href={`/practice/documents/${d.id}`} className="font-semibold text-gray-800 hover:underline">{d.title}</Link>
                <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold text-gray-500">
                  {(DOC_TYPES.find(([k]) => k === d.doc_type)?.[1]) ?? d.doc_type}
                </span>
                {d.version > 1 && <span className="text-[10px] text-gray-400">v{d.version}</span>}
                <span className="ml-auto text-[11px] text-gray-400">{d.status}</span>
              </li>
            ))}
          </ul>
        )}

        {props.canDocument && (
          <form className="mt-3 grid grid-cols-2 gap-2" onSubmit={e => { e.preventDefault(); createDocument(); }}>
            <input required placeholder="Title" value={doc.title} onChange={e => setDoc(p => ({ ...p, title: e.target.value }))} className={`${input} col-span-2`} />
            <select aria-label="Document type" value={doc.docType} onChange={e => setDoc(p => ({ ...p, docType: e.target.value }))} className={input}>
              {DOC_TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
            <input placeholder="Addressed to (optional)" value={doc.addressedTo} onChange={e => setDoc(p => ({ ...p, addressedTo: e.target.value }))} className={input} />
            <label className="col-span-2 flex items-center gap-2 text-[12px] text-gray-600">
              <input type="checkbox" checked={doc.composeFrom} onChange={e => setDoc(p => ({ ...p, composeFrom: e.target.checked }))} />
              Start from what is recorded in this consultation
            </label>
            <button type="submit" disabled={busy || !doc.title.trim()}
              className="col-span-2 rounded-lg border border-gray-200 py-2 text-[12px] font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50">
              Create document
            </button>
            <p className="col-span-2 text-[10px] text-gray-400">
              Composing pulls in only what this consultation actually holds &mdash; empty sections are left
              out rather than rendered as blank headings. Everything is editable before you sign.
            </p>
          </form>
        )}
      </section>
    </div>
  );
}
