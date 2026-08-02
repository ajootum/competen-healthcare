"use client";

import { useState } from "react";
import { ENCOUNTER_TRANSITIONS, NOTE_TYPES, LOCKED_STATUSES, actionFor, labelFor } from "@/lib/practice/encounter-constants";

// CPR-006's consultation surface: the SOAP note, diagnoses, treatments, and the transition bar.
//
// THE BUTTONS ARE THE STATE TABLE. What renders is ENCOUNTER_TRANSITIONS[status] mapped through
// actionFor -- the same table the engine checks and the database CHECK constrains. There is no second
// list of "which buttons to show", so there is nothing to drift.
//
// SAVING IS EXPLICIT PER SEGMENT, not a timer. An autosave that fires mid-sentence on a clinical note
// writes half-thoughts into the record and makes "what did I actually save" unanswerable; a Save on each
// SOAP box, with the saved state shown, keeps the practitioner in charge of what becomes the record.
// The engine refuses every write after signature, so a stale open tab cannot resurrect an edit.

/* eslint-disable @typescript-eslint/no-explicit-any */

const input = "w-full rounded-lg border border-gray-200 px-2.5 py-2 text-[13px] outline-none focus:border-[#2563EB] focus:ring-2 focus:ring-[#2563EB]/10";

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
  encounterId: string; status: string; reasonForVisit: string | null;
  notes: any[]; diagnoses: any[]; treatments: any[];
  canEdit: boolean; canSign: boolean; canDiagnose: boolean; canTreat: boolean;
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
  const [dx, setDx] = useState({ label: "", certainty: "provisional", isPrimary: false, problemLabel: "" });
  const [tx, setTx] = useState({ treatmentType: "medication", label: "", dose: "", route: "", frequency: "", duration: "" });

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
      body: JSON.stringify({ noteType, body: bodies[noteType] }),
    }), "Saved.", false);
    if (ok) setSaved(s => ({ ...s, [noteType]: true }));
  };

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
                    needsSign ? "bg-[#2563EB] text-white hover:bg-[#1D4ED8]"
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
        <div className="mt-2 flex flex-col gap-3">
          {NOTE_TYPES.map(t => (
            <div key={t}>
              <label htmlFor={`note-${t}`} className="text-[11px] font-semibold text-gray-500">{NOTE_LABEL[t]}</label>
              <textarea id={`note-${t}`} rows={t === "narrative" ? 4 : 3} disabled={!editable}
                value={bodies[t]} onChange={e => { setBodies(b => ({ ...b, [t]: e.target.value })); setSaved(s => ({ ...s, [t]: false })); }}
                className={`${input} mt-1 resize-y disabled:bg-gray-50 disabled:text-gray-500`} />
              {editable && (
                <div className="mt-1 flex items-center gap-2">
                  <button type="button" disabled={busy} onClick={() => saveNote(t)}
                    className="rounded border border-gray-200 px-2 py-0.5 text-[11px] font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-50">
                    Save
                  </button>
                  {saved[t] && <span className="text-[10px] text-[var(--cmp-text-success)]">saved</span>}
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

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
    </div>
  );
}
