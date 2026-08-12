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
import {
  ENCOUNTER_TABS, QUICK_ACTIONS, QUICK_ACTION_ICON, ENCOUNTER_OUTCOMES, OUTCOME_SWATCH,
  REFERRAL_CHIP, REFERRAL_STATUSES, CLINICAL_FLOW_BLOCKS, DECISION_CARDS,
  type EncounterWarning, type WeightPromptState,
} from "@/lib/practice/encounter-workspace-constants";
import Dictation from "@/components/practice/Dictation";
import DocumentationTools from "./DocumentationTools";
import { formatTime, formatDate } from "@/lib/datetime";
// The shared encounter visual language. Follow-up is the first tab on it; the other seven follow.
import { PANEL, SectionHeader, EmptyState, Tip } from "@/components/practice/EncounterKit";

// CPR-ENC-002's consultation surface: the comp's eight-tab main workspace and the right-hand actions
// panel, over the SOAP note, diagnoses, treatments, procedures, investigations, referrals, follow-up,
// documents and the transition bar.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// THE BUTTONS ARE THE STATE TABLE. What renders is ENCOUNTER_TRANSITIONS[status] mapped through
// actionFor -- the same table the engine checks and the database CHECK constrains. There is no second
// list of "which buttons to show", so there is nothing to drift.
//
// WHY TABS. CPR-ENC-002 s9 asks for minimal scrolling and a maximum of three clicks for common actions.
// The previous build stacked nine sections vertically: recording a procedure at the end of a
// consultation meant scrolling past the whole note. The eight tabs are the comp's own, in its order, and
// s6's eight quick actions each JUMP to one -- which is what makes them one click rather than a scroll.
//
// SAVING TO THE RECORD IS EXPLICIT PER SEGMENT. An autosave that wrote to the record mid-sentence would
// put half-thoughts into a clinical note and make "what did I actually save" unanswerable; a Save on each
// SOAP box, with the saved state shown, keeps the practitioner in charge of what becomes the record. The
// engine refuses every write after signature, so a stale open tab cannot resurrect an edit.
//
// AND SINCE MIGRATION 207 THERE IS ALSO AN AUTOSAVE, which is not a reversal of that. It writes a DRAFT,
// private to its author, overwritten in place, deleted the moment its text is saved properly, and
// labelled on screen as "not in the record yet". Twenty autosaves write no version history at all.
//
// CPR-130 ADDED THREE THINGS HERE: TEMPLATES fill EMPTY segments only; DICTATION is the browser's, with
// its own disclosure, and lands in the box to be saved like anything typed; HISTORY keeps every saved
// version of every segment readable inline.
//
// ⚠ THE SPEC'S FIELDS MAP ONTO STORES THAT ALREADY EXIST, and CPR-ENC-002 s9 forbids duplicate entry:
//   Clinical summary / Impression  -> the `assessment` note segment
//   Key findings (optional)        -> the `objective` segment
//   Next steps / Plan              -> the `plan` segment
//   Optional concise note          -> the `narrative` segment
// The Overview tab EDITS THOSE SEGMENTS under the comp's headings. It is one text, in one row, reachable
// from two labels -- not two fields holding two versions of the same sentence.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

/* eslint-disable @typescript-eslint/no-explicit-any */

const input = "w-full rounded-lg border border-gray-200 px-2.5 py-2 text-[13px] outline-none focus:border-[var(--cp-primary)] focus:ring-2 focus:ring-[var(--cp-primary)]/10";
const CARD = "rounded-xl border border-gray-200 bg-white p-4";
const QUIET_BTN = "rounded-lg border border-gray-200 px-2.5 py-1.5 text-[11px] font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50";

const NOTE_LABEL: Record<string, string> = {
  subjective: "Subjective — what the patient reports",
  objective: "Objective — examination and findings",
  assessment: "Assessment — clinical impression",
  plan: "Plan — what happens next",
  narrative: "Narrative — free text",
};

/**
 * The comp's Overview headings, and the segment each one IS. Not a copy of it -- the same row.
 *
 * ⚠ CPR-ENC-003 SPLIT THESE ACROSS TWO OF THE FOUR BLOCKS rather than adding a field. `assessment` and
 * `objective` are step 2 (Clinical impression); `plan` is step 4 (Next plan). The rows are unchanged --
 * s7's "no duplicate documentation" means the flow may re-LABEL a segment, never re-ask for it.
 */
const IMPRESSION_SEGMENTS: [string, string, string][] = [
  ["assessment", "Clinical impression", "What you think is going on."],
  ["objective", "Key findings (optional)", "Examination findings worth carrying forward."],
];
const PLAN_SEGMENT: [string, string, string] = ["plan", "Next steps / Plan", "What happens after today."];

export default function EncounterConsole(props: {
  encounterId: string; patientId: string; status: string; reasonForVisit: string | null;
  notes: any[]; diagnoses: any[]; treatments: any[];
  templates: any[]; history: Record<string, any[]>; documents: any[];
  followUps: any[]; intervals: { code: string; label: string; days: number }[];
  procedures: any[]; procedureTypes: any[];
  canEdit: boolean; canSign: boolean; canDiagnose: boolean; canTreat: boolean;
  canDocument: boolean; canFollowUp: boolean; canProcedure: boolean; canTask: boolean;
  phrases: any[]; attachments: any[]; drafts: any[];
  // migration 238
  decisions: { items: { id: string; decision: string; position: number }[]; permitted: boolean; unavailable: boolean };
  investigations: { items: { id: string; label: string; status: string; summary: string | null; requestedAt: string; reviewedAt: string | null }[]; permitted: boolean; unavailable: boolean };
  referrals: { items: { id: string; referredTo: string; reason: string; status: string; referredOn: string }[]; permitted: boolean; unavailable: boolean };
  outcome: string | null; outcomeNote: string | null;
  warnings: EncounterWarning[];
  statusHistory: any[];
  // ── CPR-ENC-003 s2/s3 SLOTS ────────────────────────────────────────────────────────────────────
  //
  // ⚠ RENDERED ELEMENTS PASSED FROM THE SERVER PAGE, NOT COMPONENTS IMPORTED HERE. Both panels were
  // full-width blocks stacked ABOVE this workspace, which is why the screen had no evident order: a
  // prescriber met a ten-field medication form and a dose calculator before the screen had asked why the
  // patient was there. s3 says specialist workflows do not expand the encounter, and s2 puts them inside
  // the flow. Taking them as slots moves them into the flow WITHOUT touching either file -- and
  // MedicationConsole in particular is pinned expression-by-expression by two harnesses, so not touching
  // it is not laziness, it is the safe way to move it.
  measurements: React.ReactNode;
  medication: React.ReactNode;
  /**
   * ── CPR-TREAT-001 and CPR-INV-001 SLOTS ──────────────────────────────────────────────────────
   *
   * ⚠ TWO MORE SERVER-RENDERED SLOTS, FOR THE REASON THE TWO ABOVE ARE SLOTS. The Treatment and
   * Investigation tabs were a type dropdown with four text boxes, and one text box with a Record
   * button. Both specs replace them with selection-first capture over configured catalogues, and both
   * need a server read (the catalogue, the configured option lists, the practitioner's favourites and
   * templates) that this client component cannot make. Passing the rendered element keeps the read on
   * the server and leaves the tab machinery here untouched.
   */
  treatmentCapture: React.ReactNode;
  investigationCapture: React.ReactNode;
  /**
   * s3's right column: patient summary and previous visits, authored in page.tsx because the
   * "first recorded encounter" claim is source-checked THERE and must not move.
   *
   * ⚠ IT IS PASSED IN SO THE SCREEN HAS TWO COLUMNS AND NOT THREE. Before this the page put a 280px
   * context column beside this component, and this component then split ITSELF into a workspace and a
   * 290px action column -- so a consultation was read across three vertical strips, one of which was
   * dedicated to the session the encounter was opened from. s3 names two columns.
   */
  sidebar: React.ReactNode;
  /** The weight prompt, decided by weightPrompt() on the server. ⚠ Never a gate -- see that function. */
  weightPrompt: { state: WeightPromptState; text: string; blocking: false };
}) {
  const locked = LOCKED_STATUSES.includes(props.status) || props.status === "CANCELLED";
  const editable = props.canEdit && !locked;

  const [tab, setTab] = useState("overview");
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
  // migration 238
  const [decision, setDecision] = useState("");
  const [ref, setRef] = useState({ referredTo: "", reason: "" });
  const [encOutcomeNote, setEncOutcomeNote] = useState(props.outcomeNote ?? "");
  // CPR-ENC-003 s5's "progressive disclosure for complex tasks". The prescribing console is the one
  // genuinely complex workflow on this screen and it is CLOSED until asked for -- most consultations
  // prescribe nothing, and every one of them used to pay for the calculator in vertical space.
  const [openMed, setOpenMed] = useState(false);

  // ── CPR-130 AUTOSAVE ──────────────────────────────────────────────────────────────────────────────
  //
  // Every two minutes, to a DRAFT -- never to the record. The distinction is the whole reason autosave
  // is buildable at all: a version answers "what did the record say at 10:55", a draft answers "what was
  // in the box when the browser closed". Twenty autosaves write no version history.
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

  // ── migration 238 writes ──────────────────────────────────────────────────────────────────────────
  const addDecision = () => call(() => fetch(`/api/v1/practice/encounters/${props.encounterId}/decisions`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ decision }),
  }), "Decision recorded.", true);

  const dropDecision = (id: string) => call(() =>
    fetch(`/api/v1/practice/encounters/${props.encounterId}/decisions?decisionId=${id}`, { method: "DELETE" }),
  "Decision removed.", true);

  const addReferral = () => call(() => fetch(`/api/v1/practice/encounters/${props.encounterId}/referrals`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ referredTo: ref.referredTo, reason: ref.reason }),
  }), "Referral recorded.", true);

  const setReferralStatus = (id: string, status: string) => call(() =>
    fetch(`/api/v1/practice/encounters/${props.encounterId}/referrals`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ referralId: id, status }),
    }), "Referral updated.", true);

  const setEncounterOutcome = (value: string) => call(() =>
    fetch(`/api/v1/practice/encounters/${props.encounterId}/outcome`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ outcome: value, outcomeNote: value === "other" ? encOutcomeNote : undefined }),
    }), "Outcome recorded.", true);

  const targets = ENCOUNTER_TRANSITIONS[props.status] ?? [];

  const quickAction = (a: typeof QUICK_ACTIONS[number]) => {
    if (a.tab) { setTab(a.tab); setNotice(null); }
  };
  const held: Record<string, boolean> = {
    "procedure.record": props.canProcedure, "diagnosis.record": props.canDiagnose,
    "treatment.record": props.canTreat, "encounter.edit": props.canEdit,
    "document.author": props.canDocument, "followup.manage": props.canFollowUp,
    "task.manage": props.canTask,
  };

  /**
   * CPR-ENC-003 s2's numbered block. The step number is drawn because the complaint that produced this
   * work was that the screen had no evident order -- a numbered heading tells somebody arriving
   * mid-consultation where they are, and an unnumbered one does not.
   */
  const block = (key: string, children: React.ReactNode) => {
    const b = CLINICAL_FLOW_BLOCKS.find(x => x.key === key)!;
    return (
      // ⚠ SIXTH TAB ON THE KIT, AND THE ONE THAT NEARLY LOST ITS PADDING.
      //
      // THREE definitions of this card existed: Board.tsx's CARD, this file's own CARD at the top, and
      // the kit's PANEL. The first and third are byte-identical; THIS FILE'S CARRIES `p-4` AND THE
      // OTHERS DO NOT. Swapping to PANEL alone therefore looked like a pure consolidation and silently
      // stripped the padding from every block on this tab -- content flush against a border, on the one
      // tab a consultation is actually read from. tsc passed it. eslint passed it. The build would have
      // passed it. Three same-looking strings and one of them different by four characters.
      //
      // The padding is stated here rather than folded into PANEL, because the other five tabs pad their
      // own body and a padded PANEL would double it everywhere.
      //
      // ⚠ THE NUMBERED STEP BADGE STAYS, and is deliberately NOT pushed into the kit. It carries the
      // CLINICAL FLOW ORDER -- why the patient is here, then the impression, then the plan -- which is
      // this tab's own argument about the order a consultation is thought through. No other tab has an
      // order to assert, and a kit component nobody else can use will be used wrongly by whoever finds it.
      <section id={`block-${b.key}`} className={`${PANEL} p-4 scroll-mt-4`}>
        <div className="flex items-baseline gap-2.5">
          <span aria-hidden
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--cp-primary)] text-[11px] font-bold text-white">
            {b.step}
          </span>
          <div className="min-w-0">
            <h2 className="text-[14px] font-bold text-gray-900">{b.title}</h2>
            <p className="text-[10.5px] text-gray-400">{b.hint}</p>
          </div>
        </div>
        <div className="mt-3">{children}</div>
      </section>
    );
  };

  /** One SOAP segment drawn as an editable field under a flow heading. The row is the same row. */
  const segment = ([seg, heading, hint]: [string, string, string]) => (
    <section key={seg}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[12.5px] font-bold text-gray-900">{heading}</h3>
        {editable && (
          <Dictation label="Dictate" onText={text => {
            setBodies(b => ({ ...b, [seg]: `${b[seg]}${b[seg] && !b[seg].endsWith(" ") ? " " : ""}${text}` }));
            setSaved(s => ({ ...s, [seg]: false }));
            setDictated(d => ({ ...d, [seg]: true }));
          }} />
        )}
      </div>
      <p className="text-[10px] text-gray-400">{hint} Saved into the <code>{seg}</code> segment of the note.</p>
      <textarea aria-label={heading} rows={3} disabled={!editable}
        value={bodies[seg]}
        onChange={ev => { setBodies(b => ({ ...b, [seg]: ev.target.value })); setSaved(s => ({ ...s, [seg]: false })); }}
        className={`${input} mt-1 resize-y disabled:bg-gray-50 disabled:text-gray-500`} />
      {editable && (
        <div className="mt-1 flex items-center gap-2">
          <button type="button" disabled={busy} onClick={() => saveNote(seg)} className={QUIET_BTN}>Save</button>
          {saved[seg] && <span className="text-[10px] text-[var(--cmp-text-success)]">saved</span>}
          {draftAt[seg] && !saved[seg] && (
            <span className="text-[10px] text-gray-400">draft kept {draftAt[seg]} &mdash; not in the record yet</span>
          )}
        </div>
      )}
    </section>
  );

  /**
   * CPR-ENC-003 s3's Clinical Decisions card, resolved against what this encounter actually holds.
   *
   * ⚠ EVERY `detail` BELOW COMES FROM A READ THAT HAPPENED. Two of the six -- investigations and
   * referrals -- arrive as Panels that know whether their query FAILED, and those two say so instead of
   * printing nought. The other four are plain arrays from getEncounter, where an empty array really is
   * an empty list. The distinction is drawn here rather than smoothed over, because "None added" and
   * "could not be read" send a practitioner to two different places.
   */
  const cardOf = (c: typeof DECISION_CARDS[number]) => {
    const NONE = "text-gray-400";
    const SOME = "text-gray-700";
    const FAILED = "text-[var(--cmp-text-critical)] font-semibold";
    const count = (n: number, word: string) =>
      n === 0 ? { detail: "None added", tone: NONE } : { detail: `${n} ${word}${n === 1 ? "" : "s"}`, tone: SOME };
    const panel = (p: { permitted: boolean; unavailable: boolean; items: unknown[] }, word: string) =>
      !p.permitted ? { detail: "Not permitted", tone: NONE }
        : p.unavailable ? { detail: "Could not be read", tone: FAILED }
          : count(p.items.length, word);

    const body =
      c.key === "diagnosis" ? count(props.diagnoses.length, "recorded")
        : c.key === "procedure" ? count(props.procedures.filter(p => p.encounter_id === props.encounterId).length, "done today")
          : c.key === "investigation" ? panel(props.investigations, "requested")
            : c.key === "referral" ? panel(props.referrals, "made")
              : c.key === "treatment" ? count(props.treatments.length, "recorded")
                // ⚠ THE MEDICATION CARD COUNTS NOTHING, ON PURPOSE. The prescribing console writes to
                // the PATIENT's medication record (practice_medication), not to this encounter's
                // treatment rows, so any figure here would be counting a different table from the one
                // the card opens. It says what the click does instead.
                : { detail: openMed ? "Open below" : "Open the prescribing console", tone: SOME };

    return {
      key: c.key, label: c.label, icon: QUICK_ACTION_ICON[`add_${c.key}`] ?? "▸",
      ...body,
      onOpen: () => {
        setNotice(null);
        if (c.key === "medication") { setOpenMed(true); return; }
        if (c.key === "referral") { document.getElementById("referrals")?.scrollIntoView({ block: "center" }); return; }
        setTab(c.tab);
      },
    };
  };

  // A small helper so every list gets the same three states without each one inventing its own words.
  const panelState = (p: { permitted: boolean; unavailable: boolean }, what: string, empty: string) =>
    !p.permitted ? <p className="mt-2 rounded-lg bg-gray-50 px-2.5 py-2 text-[11px] text-gray-500">You cannot see {what} here. Nothing was read.</p>
      : p.unavailable ? <p className="mt-2 rounded-lg border border-rose-300 bg-rose-50 px-2.5 py-2 text-[11px] text-rose-800"><strong>{what} could not be read.</strong> This is not an empty list.</p>
        : <p className="mt-2 text-[12px] text-gray-400">{empty}</p>;

  return (
    <div className="mt-4 grid gap-4 xl:grid-cols-[1fr_320px]">
      {/* ══ CENTRE: CPR-ENC-003 s3's FOUR COGNITIVE BLOCKS ═══════════════════════════════════════ */}
      <div className="flex flex-col gap-4">
        {notice && (
          <p className={`rounded-lg px-3 py-2 text-[12px] ${notice.kind === "ok" ? "bg-[var(--cmp-surface-success)] text-[var(--cmp-text-success)]" : "bg-[var(--cmp-surface-critical)] text-[var(--cmp-text-critical)]"}`}>{notice.text}</p>
        )}

        {/* ══ THE ACTION BAR, AT THE TOP ═══════════════════════════════════════════════════════════
            CPR-ENC-003 s3: "Header: patient banner, encounter status, autosave, Finish Encounter."

            ⚠ IT MOVED FROM THE FOOT OF THE PAGE TO THE HEAD OF IT, and that is a human-factors change
            rather than a cosmetic one. Finishing is the most frequent action on this screen and it sat
            below every form on it, so the commonest task ended in a scroll past nine sections of things
            the practitioner had already decided not to do. s7's acceptance criterion is a routine
            follow-up completable in under 45 seconds; a scroll to the exit is most of that budget.

            ⚠ AND IT IS STILL THE STATE TABLE. What renders is ENCOUNTER_TRANSITIONS[status] mapped
            through actionFor -- the same table the engine checks and the database CHECK constrains.
            Moving it did not give it a second list of buttons to drift from. */}
        <section className={`${CARD} flex flex-wrap items-center gap-2`}>
          <h2 className="text-[13px] font-bold text-gray-900">This encounter</h2>
          {targets.length === 0 ? (
            <p className="text-[12px] text-gray-400">Closed. No further transitions are possible.</p>
          ) : (
            <div className="ml-auto flex gap-1.5 flex-wrap">
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

        {/* ── CPR-ENC-002 s7: WARNINGS, NEVER REFUSALS ──────────────────────────────────────────
            ⚠ NOTHING HERE BLOCKS ANYTHING, and that is the specification's own word. A consultation
            that ends without a diagnosis is a real consultation -- the honest answer to "what is wrong
            with this patient" is often "I do not know yet" -- and a system that refused to close it
            would teach practitioners to type a diagnosis they do not hold in order to get out of the
            screen. A false diagnosis is worse than an empty field. */}
        {editable && props.warnings.length > 0 && (
          <section className="rounded-xl border border-amber-200 bg-amber-50 p-3">
            <p className="text-[12px] font-bold text-amber-800">Before you close this encounter</p>
            <ul className="mt-1 flex flex-col gap-0.5">
              {props.warnings.map(w => (
                <li key={w.key} className="text-[11px] text-gray-700">· {w.text}</li>
              ))}
            </ul>
            <p className="mt-1.5 text-[10px] text-gray-500">
              These are notes, not gates. You can close this encounter without acting on any of them.
            </p>
          </section>
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

        {/* ── The comp's tab row ─────────────────────────────────────────────────────────────────── */}
        <div className="rounded-xl border border-gray-200 bg-white">
          <nav aria-label="Encounter sections" className="flex gap-0.5 overflow-x-auto border-b border-gray-100 px-2">
            {ENCOUNTER_TABS.map(([key, label]) => (
              <button key={key} type="button" onClick={() => setTab(key)}
                aria-current={tab === key ? "page" : undefined}
                className={`shrink-0 border-b-2 px-3 py-2.5 text-[12px] font-semibold transition-colors ${
                  tab === key
                    ? "border-[var(--cp-primary)] text-[var(--cp-primary-deep)]"
                    : "border-transparent text-gray-500 hover:text-gray-800"}`}>
                {label}
              </button>
            ))}
          </nav>

          <div className="p-4">
            {/* ══ THE CONSULTATION: CPR-ENC-003 s2's FOUR COGNITIVE BLOCKS ═══════════════════════
                s3: "Centre column contains only the four cognitive decision blocks." The other seven
                tabs ARE s3's "dedicated workspaces" -- the specialist forms that must not expand the
                encounter -- and each decision card below opens the one that already holds its form.

                ⚠ WHAT CHANGED, AND WHY, BECAUSE THIS IS THE WHOLE POINT OF THE REORGANISATION.
                This tab was a two-column grid holding, in this order: reason, three note segments,
                outcome | decisions, treatments, investigations, referrals. Nothing said which came
                first, the left column ended with the OUTCOME of the consultation while the right column
                was still recording what was done in it, and the eye had to cross the gutter twice to
                follow one thought. It is now one column in the order the clinical reasoning actually
                happens: why they are here, what you measured, what you make of it, what you are doing,
                what happens next. No field was added and none was removed -- s7's "no duplicate
                documentation" -- the same rows are asked for in the order they are thought about. */}
            {tab === "overview" && (
              <div className="flex flex-col gap-4">

                {/* ── ① WHY IS THE PATIENT HERE? ──────────────────────────────────────────────────
                    ⚠ READ-ONLY, AND THE SENTENCE SAYS SO RATHER THAN LEAVING IT TO BE DISCOVERED.
                    practice_encounter.reason_for_visit is written by launchEncounter and by nothing
                    else: there is no verb on the API that edits it. The design comp draws this as a
                    textarea with a microphone and a row of "Common reasons" chips -- an editable field
                    here would be a box that accepts typing and saves nothing, which is worse than a
                    read-only one. Reported as the one element of s2 that needs a write path built. */}
                {block("reason", (
                  <>
                    <p className={`rounded-lg bg-gray-50 px-3 py-2 text-[13px] ${props.reasonForVisit ? "text-gray-800" : "text-gray-400"}`}>
                      {props.reasonForVisit ?? "No reason was recorded when this encounter was opened."}
                    </p>
                    <p className="mt-1 text-[10px] text-gray-400">
                      Recorded when this encounter was opened. It cannot be edited from this screen.
                    </p>
                  </>
                ))}

                {/* ── THE MEASUREMENTS, BETWEEN ① AND ② ───────────────────────────────────────────
                    Not one of s2's four blocks, and placed here on the ordinary clinical ground that a
                    measurement is taken BEFORE an impression is formed and not after it. This is the
                    ParameterCollection panel unchanged -- it used to sit above this workspace entirely,
                    which put it before the screen had asked why the patient was there. */}
                {props.measurements}

                {/* ── ② CLINICAL IMPRESSION ──────────────────────────────────────────────────────── */}
                {block("impression", (
                  <div className="flex flex-col gap-4">
                    {IMPRESSION_SEGMENTS.map(segment)}
                  </div>
                ))}

                {/* ── ③ CLINICAL DECISIONS ───────────────────────────────────────────────────────── */}
                {block("decisions", (
                  <div className="flex flex-col gap-4">

                    {/* THE COMP'S DECISION ROW. Every card carries a REAL count from a store that
                        answered, and opens the tab that already holds that store's form.

                        ⚠ THE COUNTS ARE NOT ALL THE SAME KIND OF NUMBER AND THE CARDS SAY SO. A
                        diagnosis, a procedure and a treatment come back as plain arrays from
                        getEncounter, so an empty one genuinely means none. Investigations and referrals
                        come back as Panels that know whether their read FAILED -- and those two print
                        "could not be read" rather than nought, because nought is a claim. */}
                    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                      {DECISION_CARDS.map(cardOf).map(c => (
                        <button key={c.key} type="button" onClick={c.onOpen}
                          className="flex items-start gap-2 rounded-lg border border-gray-200 px-2.5 py-2 text-left hover:border-[var(--cp-primary)] hover:bg-gray-50">
                          <span aria-hidden className="mt-0.5 text-[12px] text-gray-400">{c.icon}</span>
                          <span className="min-w-0 flex-1">
                            <span className="block text-[12px] font-bold text-gray-900">{c.label}</span>
                            <span className={`block text-[11px] ${c.tone}`}>{c.detail}</span>
                          </span>
                        </button>
                      ))}
                    </div>

                    {/* ── THE PRESCRIBING CONSOLE, s5's PROGRESSIVE DISCLOSURE ────────────────────
                        s4: "Medication is launched from the Clinical Decisions section." It is, and it
                        is CLOSED until it is. It used to be a permanently-expanded ten-field form and a
                        dose calculator above the clinical note, which every consultation paid for in
                        vertical space and only some of them used.

                        ⚠ AND THE WEIGHT PROMPT IS HERE, BESIDE THE THING IT UNBLOCKS. The console
                        already refuses to produce a dose figure without a weight; this says so BEFORE
                        the practitioner types a rate rather than after the server declines. It is a
                        prompt and not a gate -- there is no disabled control anywhere in it, the link
                        goes to the field, and closing this section is the whole of declining it. */}
                    <div className="rounded-lg border border-gray-200">
                      <button type="button" onClick={() => setOpenMed(v => !v)}
                        aria-expanded={openMed}
                        className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-gray-50">
                        <span aria-hidden className="text-[12px] text-gray-400">℞</span>
                        <span className="text-[12.5px] font-bold text-gray-900">Prescribe a medication</span>
                        <span className="text-[11px] text-gray-500">
                          dose calculator, allergies, weight
                        </span>
                        <span aria-hidden className="ml-auto text-[11px] text-gray-400">{openMed ? "▲" : "▼"}</span>
                      </button>

                      {props.weightPrompt.state === "prompt" && (
                        <p className="mx-3 mb-2 rounded-lg bg-[var(--cmp-surface-warning)] px-2.5 py-1.5 text-[11px] leading-snug text-[var(--cmp-text-warning)]">
                          <a href="#weight-capture" className="font-bold underline">Record a weight first</a>
                          {" — "}{props.weightPrompt.text}
                        </p>
                      )}

                      {openMed && <div className="border-t border-gray-100 px-3 pb-3">{props.medication}</div>}
                    </div>

                    {/* ── DECISIONS MADE (migration 238) ────────────────────────────────────────── */}
                    <section>
                      <h3 className="text-[12.5px] font-bold text-gray-900">Decisions made</h3>
                      <p className="text-[10px] text-gray-400">
                        What you decided, one line each. The unit this product is organised around.
                      </p>
                      {props.decisions.items.length === 0
                        ? panelState(props.decisions, "decisions", "Nothing recorded yet.")
                        : (
                          <ul className="mt-2 flex flex-col gap-1">
                            {props.decisions.items.map(d => (
                              <li key={d.id} className="flex items-start gap-2 rounded-lg border border-gray-100 px-2.5 py-1.5">
                                <span className="mt-0.5 text-[12px] text-emerald-600">✓</span>
                                <span className="flex-1 text-[12px] text-gray-800">{d.decision}</span>
                                {editable && (
                                  <button type="button" disabled={busy} onClick={() => dropDecision(d.id)}
                                    className="text-[10px] text-gray-400 hover:text-rose-700 hover:underline">
                                    remove
                                  </button>
                                )}
                              </li>
                            ))}
                          </ul>
                        )}
                      {editable && (
                        <form className="mt-2 flex gap-2" onSubmit={ev => { ev.preventDefault(); addDecision(); }}>
                          <input required value={decision} onChange={ev => setDecision(ev.target.value)}
                            placeholder="e.g. Continue levetiracetam 750mg BD" className={input} />
                          <button type="submit" disabled={busy || !decision.trim()} className={QUIET_BTN}>Add</button>
                        </form>
                      )}
                    </section>

                    {/* ── REFERRALS ─────────────────────────────────────────────────────────────── */}
                    <section id="referrals">
                      <h3 className="text-[12.5px] font-bold text-gray-900">Referrals</h3>
                      <p className="text-[10px] text-gray-400">
                        Recorded, not sent. CompetenPractice transmits nothing &mdash; the letter that goes
                        anywhere is a document with its own release register.
                      </p>
                      {props.referrals.items.length === 0
                        ? panelState(props.referrals, "referrals", "No referrals added.")
                        : (
                          <ul className="mt-2 flex flex-col gap-1.5">
                            {props.referrals.items.map(r => (
                              <li key={r.id} className="rounded-lg border border-gray-100 px-2.5 py-1.5">
                                <div className="flex items-center gap-2">
                                  <span className="text-[12px] font-semibold text-gray-800">{r.referredTo}</span>
                                  <span className={`ml-auto rounded px-1.5 py-0.5 text-[10px] font-bold ${REFERRAL_CHIP[r.status]}`}>
                                    {r.status}
                                  </span>
                                </div>
                                <p className="text-[11px] text-gray-600">{r.reason}</p>
                                <p className="text-[10px] text-gray-400">recorded {formatDate(`${r.referredOn}T00:00:00Z`, "UTC")}</p>
                                {editable && (
                                  <div className="mt-1 flex flex-wrap gap-1">
                                    {REFERRAL_STATUSES.filter(([s]) => s !== r.status).map(([s, label]) => (
                                      <button key={s} type="button" disabled={busy} onClick={() => setReferralStatus(r.id, s)}
                                        className="rounded border border-gray-200 px-1.5 py-0.5 text-[10px] font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-50">
                                        {label}
                                      </button>
                                    ))}
                                  </div>
                                )}
                              </li>
                            ))}
                          </ul>
                        )}
                      {editable && (
                        <form className="mt-2 grid gap-2" onSubmit={ev => { ev.preventDefault(); addReferral(); }}>
                          <input required value={ref.referredTo} onChange={ev => setRef(p => ({ ...p, referredTo: ev.target.value }))}
                            placeholder="Referred to (person or service)" className={input} />
                          <input required value={ref.reason} onChange={ev => setRef(p => ({ ...p, reason: ev.target.value }))}
                            placeholder="Reason" className={input} />
                          <button type="submit" disabled={busy || !ref.referredTo.trim() || !ref.reason.trim()} className={QUIET_BTN}>
                            Record referral
                          </button>
                        </form>
                      )}
                    </section>
                  </div>
                ))}

                {/* ── ④ NEXT PLAN ────────────────────────────────────────────────────────────────── */}
                {block("plan", (
                  <div className="flex flex-col gap-4">
                    {segment(PLAN_SEGMENT)}

                    {/* THE FOLLOW-UP SUMMARY. The form itself is the Follow-up tab -- one of s3's
                        dedicated workspaces -- and this says what is owed without opening it. CPR-140:
                        these are the PATIENT's live obligations, not this encounter's, because one
                        raised at the last visit is exactly what today is meant to settle. */}
                    <section>
                      <div className="flex items-center justify-between gap-2">
                        <h3 className="text-[12.5px] font-bold text-gray-900">Follow-up</h3>
                        <button type="button" onClick={() => setTab("follow-up")}
                          className="text-[11px] font-semibold text-[var(--cp-primary-deep)] hover:underline">
                          Plan a follow-up →
                        </button>
                      </div>
                      {props.followUps.length === 0 ? (
                        <p className="mt-1 text-[12px] text-gray-400">Nothing is owed to this patient.</p>
                      ) : (
                        <ul className="mt-1 flex flex-col gap-0.5">
                          {props.followUps.map(f => (
                            <li key={f.id} className="text-[12px] text-gray-800">
                              {f.reason}
                              <span className={`ml-1.5 text-[11px] ${f.overdue ? "font-bold text-[var(--cmp-text-critical)]" : "text-gray-500"}`}>
                                {f.overdue ? `${Math.abs(f.dueInDays)} days overdue` : `due ${f.due_on}`}
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </section>

                    {/* ── OUTCOME (migration 238) ──────────────────────────────────────────────── */}
                    <section>
                      <h3 className="text-[12.5px] font-bold text-gray-900">Outcome</h3>
                      <p className="text-[10px] text-gray-400">
                        How this contact ended. Optional &mdash; an encounter closed without one is a real
                        thing, and nothing here will refuse it.
                      </p>
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {ENCOUNTER_OUTCOMES.map(([code, label]) => {
                          const on = props.outcome === code;
                          const sw = OUTCOME_SWATCH[code];
                          return (
                            <button key={code} type="button" disabled={!editable || busy}
                              onClick={() => setEncounterOutcome(code)}
                              aria-pressed={on}
                              className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[12px] font-semibold disabled:opacity-60 ${
                                on ? sw.chip : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50"}`}>
                              {/* The unselected dot is gray-200, which the dark theme maps. The next step
                                  down does not have a dark mapping and the personalisation harness
                                  (which greps the source, comments included) would fail on it. */}
                              <span className={`h-2 w-2 rounded-full ${on ? sw.dot : "bg-gray-200"}`} />
                              {label}
                            </button>
                          );
                        })}
                      </div>
                      {props.outcome === "other" && (
                        <p className="mt-1.5 rounded-lg bg-gray-50 px-2.5 py-1.5 text-[12px] text-gray-700">
                          {props.outcomeNote ?? "No note recorded."}
                        </p>
                      )}
                      {editable && (
                        <div className="mt-1.5">
                          <label htmlFor="outcome-note" className="text-[10px] font-semibold text-gray-500">
                            If none of the five fit, say what happened, then choose Other
                          </label>
                          <input id="outcome-note" value={encOutcomeNote} onChange={ev => setEncOutcomeNote(ev.target.value)}
                            className={`${input} mt-0.5`} placeholder="Required for an outcome of Other" />
                          <p className="mt-1 text-[10px] text-gray-400">
                            An outcome of &ldquo;Other&rdquo; with nothing said is refused by the engine and by
                            the database. The reason IS the field.
                          </p>
                        </div>
                      )}
                      {!props.outcome && (
                        <p className="mt-1.5 text-[11px] text-gray-500">
                          No outcome recorded. This is not the same as &ldquo;stable&rdquo;.
                        </p>
                      )}
                    </section>
                  </div>
                ))}
              </div>
            )}

            {/* ══ DIAGNOSES ═════════════════════════════════════════════════════════════════════ */}
            {tab === "diagnoses" && (
              <section>
                <h3 className="text-[13px] font-bold text-gray-900">Diagnoses</h3>
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
                    <select aria-label="Certainty" value={dx.certainty} onChange={e => setDx(p => ({ ...p, certainty: e.target.value }))} className={input}>
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
            )}

            {/* ══ TREATMENT -- CPR-TREAT-001 ════════════════════════════════════════════════════
                ⚠ THE OLD FORM IS GONE AND ITS CAPTURE PATH IS NOT. TreatmentCapture records the same
                practice_treatment row through the same columns, plus the ones migration 275 added, and
                it does it for a LIST rather than one at a time. The type dropdown, the What box and the
                four medication fields all still exist -- as taps over configured lists, with an
                Other/custom fallback on each, which is exactly what s5 asks for. */}
            {tab === "treatment" && props.treatmentCapture}
            {/* ══ PROCEDURES ════════════════════════════════════════════════════════════════════
                CPR-150. What was DONE, as distinct from the plan: a treatment row saying "excision,
                planned" is not evidence anything happened, and a procedure row is. The patient's recent
                procedures are listed, not just today's, because an outcome is learned later. */}
            {tab === "procedures" && (
              <section>
                <h3 className="text-[13px] font-bold text-gray-900">Procedures performed</h3>
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
                          // Reset the side when the chosen procedure has none, so a stale "left" cannot
                          // ride along from a previous selection.
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
            )}

            {/* ══ INVESTIGATIONS -- CPR-INV-001 ════════════════════════════
                ⚠ THE ONE-AT-A-TIME TEXT BOX IS GONE AND EVERY CAPTURE PATH IT HAD REMAINS.
                InvestigationCapture writes the same practice_encounter_investigation row, still records
                the same optional sentence, and still refuses to hold a result. What changed is that a
                practitioner selects several and confirms once, which is s2's whole point.

                ⚠ THE BOUNDARY PARAGRAPH MOVED WITH IT AND IS NOW RENDERED FROM THE ENGINE'S OWN
                CONSTANT. It used to be authored here in JSX, where it could drift from what the API and
                the migration say. It is INVESTIGATION_BOUNDARY now, one string, asserted by the
                harness. */}
            {tab === "investigations" && props.investigationCapture}

            {/* ══ FOLLOW-UP ═════════════════════════════════════════════════════════════════════
                CPR-140. The patient's LIVE obligations, not this encounter's -- one raised at the last
                visit is exactly what today is meant to settle, and showing only today's would hide it. */}
            {tab === "follow-up" && (
              // ⚠ FIRST TAB ON THE ENCOUNTER KIT (CP-ENC-DIAG/PROC's shared visual language). Only the
              // CHROME changes here -- the panel, the heading, the empty state and the tip band. Every
              // behaviour below is untouched: what is listed is still the patient's LIVE obligations
              // rather than this encounter's, settling still records this consultation as the closer,
              // and the intervals sentence still says it is arithmetic and not clinical guidance.
              <section className={PANEL}>
                <SectionHeader
                  title="Follow-up"
                  subtitle="What this patient is owed, and what should happen after this encounter."
                />
                <div className="p-4">
                {props.followUps.length === 0 ? (
                  // Three states, not two: this is the READ-SUCCEEDED one, and it says so.
                  <EmptyState title="Nothing is owed to this patient"
                    reason="No follow-up is open. This was read successfully -- raise one below if something should happen after today." />
                ) : (
                  <ul className="flex flex-col gap-1.5">
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
                    <div className="col-span-2">
                      <Tip>
                        The intervals are arithmetic on today&apos;s date, not clinical guidance. Once
                        raised, this appears on the follow-up board and becomes overdue on its own if
                        nothing is booked.
                      </Tip>
                    </div>
                  </form>
                )}
                </div>
              </section>
            )}

            {/* ══ ATTACHMENTS + DOCUMENTS ═══════════════════════════════════════════════════════
                CPR-130. A document is created FROM this consultation and signed separately from it:
                signing the encounter records what happened, signing a document issues something. */}
            {tab === "attachments" && (
              <div className="flex flex-col gap-4">
                {/* ⚠ THIRD TAB ON THE ENCOUNTER KIT. Chrome only -- every behaviour below is untouched,
                    including the rule this tab exists to keep visible: a document is created FROM this
                    consultation and signed SEPARATELY from it. Signing the encounter records what
                    happened; signing a document issues something.

                    ⚠ AND THE BRACES MATTER HERE. This comment sits inside the wrapping div's CHILDREN,
                    so a bare // would render as visible text on the page -- unlike the Follow-up tab,
                    where the same comment sits in an expression position and is a real comment. eslint
                    caught it; nothing else would have until it appeared on screen. */}
                <section className={PANEL}>
                  <SectionHeader
                    title="Documents"
                    subtitle="Letters and summaries drafted from this consultation."
                  />
                  <div className="p-4">
                  {props.documents.length === 0 ? (
                    // The read-succeeded empty state, said as such rather than left as a grey line that
                    // could equally mean the documents could not be read.
                    <EmptyState title="Nothing has been drafted from this consultation"
                      reason="No document has been created here yet. This was read successfully -- draft one below if something needs to be issued." />
                  ) : (
                    <ul className="flex flex-col gap-1">
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
                      <div className="col-span-2">
                        <Tip>
                          Composing pulls in only what this consultation actually holds &mdash; empty
                          sections are left out rather than rendered as blank headings. Everything is
                          editable before you sign.
                        </Tip>
                      </div>
                    </form>
                  )}
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
              </div>
            )}

            {/* ══ NOTES ═════════════════════════════════════════════════════════════════════════ */}
            {tab === "notes" && (
              // ⚠ FOURTH TAB ON THE ENCOUNTER KIT. Expression position, so // is a real comment here --
              // unlike the Attachments tab, where the same line sits in JSX children and would render.
              //
              // Chrome only. The two sentences this tab must never lose are both intact below: WHY it is
              // read-only when it is (a closed encounter and a missing capability are different reasons
              // and are still told apart), and that applying a template fills ONLY EMPTY segments.
              <section className={PANEL}>
                <SectionHeader
                  title="Clinical note"
                  subtitle="Create and structure your consultation note."
                />
                <div className="p-4">
                {!editable && (
                  // ⚠ THE REASON, NOT JUST THE STATE. "Read-only" alone leaves somebody hunting for a
                  // permission they already hold, or waiting for an encounter that is already closed.
                  <p className="mb-2 rounded-lg bg-gray-50 px-3 py-2 text-[11.5px] text-gray-600">
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
                    <div className="w-full">
                      <Tip>
                        Only empty segments are filled. Anything you have already written stays exactly
                        as it is.
                      </Tip>
                    </div>
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
                              {/* CPR-130 smart text. Expansion is a BUTTON, never something that happens
                                  as you type: text in a clinical note must not change under somebody's hands. */}
                              {props.phrases.length > 0 && (
                                <button type="button" disabled={busy} onClick={() => expandInto(t)}
                                  className="rounded border border-gray-200 px-2 py-0.5 text-[11px] font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-50">
                                  Expand
                                </button>
                              )}
                              {saved[t] && <span className="text-[10px] text-[var(--cmp-text-success)]">saved</span>}
                              {dictated[t] && <span className="text-[10px] text-gray-400">will be recorded as dictated</span>}
                              {/* THE AUTOSAVE INDICATOR SAYS "DRAFT", not "saved". A practitioner who read
                                  this as a save would leave a consultation believing the record held
                                  something it does not. */}
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
                </div>
              </section>
            )}
          </div>
        </div>

      </div>

      {/* ══ RIGHT COLUMN (CPR-ENC-003 s3) ════════════════════════════════════════════════════════
          "Patient Summary, AI Assistant, Encounter Timeline and contextual utilities."
          The patient summary and previous visits arrive as the `sidebar` slot from page.tsx; the
          timeline and the quick actions are below. ⚠ There is no AI Assistant panel -- see page.tsx. */}
      <aside className="flex flex-col gap-4">
        {props.sidebar}

        <section className={CARD}>
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-[13px] font-bold text-gray-900">Procedures in this encounter</h2>
            <button type="button" onClick={() => setTab("procedures")}
              className="text-[11px] font-semibold text-[var(--cp-primary-deep)] hover:underline">+ Add</button>
          </div>
          {props.procedures.filter(p => p.encounter_id === props.encounterId).length === 0 ? (
            <p className="mt-2 text-[12px] text-gray-400">None recorded in this consultation.</p>
          ) : (
            <ul className="mt-2 flex flex-col gap-2">
              {props.procedures.filter(p => p.encounter_id === props.encounterId).map(p => (
                <li key={p.id} className="rounded-lg border border-gray-100 px-2.5 py-2">
                  <p className="text-[12px] font-semibold text-gray-800">{p.label}</p>
                  <p className="text-[10px] text-gray-400">
                    {formatTime(p.performed_at)}
                    {p.site ? ` · ${p.site}` : ""}
                    {SIDED_LATERALITIES.includes(p.laterality) ? ` · ${p.laterality}` : ""}
                  </p>
                  {p.indication && <p className="text-[11px] text-gray-600">Indication: {p.indication}</p>}
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* THE ENCOUNTER TIMELINE, from the status history the engine writes on every transition. It is
            a record of what happened to this record, not a narrative anybody composed. */}
        <section className={CARD}>
          <h2 className="text-[13px] font-bold text-gray-900">Encounter timeline</h2>
          {props.statusHistory.length === 0 ? (
            <p className="mt-2 text-[12px] text-gray-400">No transitions recorded.</p>
          ) : (
            <ul className="mt-2 flex flex-col gap-1.5">
              {props.statusHistory.map((h: any, i: number) => (
                <li key={i} className="flex items-baseline gap-2 text-[11px]">
                  <span className="font-mono text-gray-400">{formatTime(h.occurred_at)}</span>
                  <span className="text-gray-700">{h.from_status ? `${h.from_status} → ${h.to_status}` : h.to_status}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-[10px] text-gray-400">
            Every transition is recorded here and in the workspace audit log. Neither can be edited from the app.
          </p>
        </section>

        {/* CPR-ENC-002 s6's EIGHT QUICK ACTIONS. Each one JUMPS to the tab that already holds the form
            -- which is what makes it one click rather than a scroll. An action whose capability the
            caller does not hold is drawn as unavailable rather than hidden, so the screen does not
            silently differ between two people looking at the same consultation. */}
        <section className={CARD}>
          <h2 className="text-[13px] font-bold text-gray-900">Quick actions</h2>
          <div className="mt-2 grid grid-cols-2 gap-1.5">
            {QUICK_ACTIONS.map(a => {
              const allowed = held[a.capability] !== false && (a.capability !== "encounter.edit" || editable);
              if (a.href) {
                // The one action that leaves this screen. It is still capability-gated: a link that
                // 403s on arrival is worse than a button that says it cannot be pressed.
                return allowed ? (
                  <Link key={a.key} href={a.href}
                    className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-2 py-2 text-[11px] font-semibold text-gray-700 hover:bg-gray-50">
                    <span>{QUICK_ACTION_ICON[a.key]}</span>{a.label}
                  </Link>
                ) : (
                  <span key={a.key} title="You do not hold the permission for this"
                    className="flex items-center gap-1.5 rounded-lg border border-gray-100 px-2 py-2 text-[11px] font-semibold text-gray-300">
                    <span>{QUICK_ACTION_ICON[a.key]}</span>{a.label}
                  </span>
                );
              }
              return (
                <button key={a.key} type="button" disabled={!allowed} onClick={() => quickAction(a)}
                  title={allowed ? undefined : "You do not hold the permission for this"}
                  className={`flex items-center gap-1.5 rounded-lg border px-2 py-2 text-[11px] font-semibold ${
                    allowed ? "border-gray-200 text-gray-700 hover:bg-gray-50" : "border-gray-100 text-gray-300"}`}>
                  <span>{QUICK_ACTION_ICON[a.key]}</span>{a.label}
                </button>
              );
            })}
          </div>
          {/* ⚠ "PRINT SUMMARY" IS A BUTTON AND IT DOES NOT PRINT. It opens Attachments, because what this
              product can print is a DOCUMENT -- a consultation summary with a version, a signature and a
              release register behind it. A one-click window.print() would produce an unversioned sheet
              that looks like a clinical document, is not one, and leaves nothing recording that it left
              the building. The button was previously omitted altogether and the reason lived only in the
              grey text below; the affordance now exists where the comp draws it, and the sentence still
              says what the click actually does. */}
          <p className="mt-2 text-[10px] text-gray-400">
            <strong className="font-semibold text-gray-500">Print summary</strong> opens{" "}
            <button type="button" onClick={() => setTab("attachments")}
              className="font-semibold text-[var(--cp-primary-deep)] hover:underline">Attachments</button>,
            where a consultation summary is created and printed from the document itself. What gets
            printed is versioned and has a release register &mdash; not a screenshot of this page.
          </p>
        </section>
      </aside>
    </div>
  );
}
