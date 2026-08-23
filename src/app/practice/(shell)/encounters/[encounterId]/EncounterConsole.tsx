"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import { ENCOUNTER_TRANSITIONS, NOTE_TYPES, LOCKED_STATUSES, actionFor, labelFor } from "@/lib/practice/encounter-constants";
import { DOC_TYPES } from "@/lib/practice/document-constants";
import DocumentComposer, { type ComposerPurpose } from "./DocumentComposer";
import {
  FOLLOW_UP_KINDS, FOLLOW_UP_PRIORITIES, FOLLOW_UP_STATUS_LABELS, FOLLOW_UP_TAB_FILTERS,
  FOLLOW_UP_PRIORITY_CHIP, FOLLOW_UP_PRIORITY_GLYPH, followUpSummary,
  FOLLOW_UP_CATEGORIES, FOLLOW_UP_ACTION_TYPES, FOLLOW_UP_TYPE_LABELS, FOLLOW_UP_ACTION_CATEGORY,
} from "@/lib/practice/follow-up-constants";
// ⚠ THE PROCEDURE VOCABULARIES MOVED TO ProcedureWorkspace WITH THE FORM. Only what this file still
// renders stays imported -- a vocabulary imported here and used nowhere is the next person's evidence
// that procedure capture still lives in this file, which it does not.
import { SIDED_LATERALITIES } from "@/lib/practice/procedure-constants";
// ⚠ CPR-HFE-TRT-004 s11's rail tiers. Safe to import here BECAUSE THAT MODULE IMPORTS NOTHING -- this
// file is "use client", and a constants module that reached for a server helper would drag the chain
// into the browser bundle, which tsc and eslint both pass and only `next build` catches.
import {
  RAIL, RAIL_MEDIUM, RAIL_MEDIUM_H, RAIL_LOW, RAIL_LOW_H, RAIL_UTILITY, RAIL_UTILITY_H, RAIL_META,
} from "@/lib/practice/encounter-rail-constants";
// CPR-FUP-HFE-008 s3: "reuse the lavender active-work band and semantic colours used in other encounter
// tabs". The Follow-up composer was the last capture form in the product without one.
import { BAND_RECORD, BAND_WORK } from "@/lib/practice/encounter-band-constants";
import {
  ENCOUNTER_TABS, QUICK_ACTIONS, QUICK_ACTION_ICON, ENCOUNTER_OUTCOMES, OUTCOME_SWATCH,
  REFERRAL_CHIP, REFERRAL_STATUSES, CLINICAL_FLOW_BLOCKS, DECISION_CARDS,
  type EncounterWarning, type WeightPromptState,
} from "@/lib/practice/encounter-workspace-constants";
import {
  ClinicalRecordTable, type RecordColumn, type RowState,
} from "@/components/practice/ClinicalRecordTable";
import Dictation from "@/components/practice/Dictation";
import DocumentationTools from "./DocumentationTools";
import EncounterAttachments from "./EncounterAttachments";

/* eslint-disable @typescript-eslint/no-explicit-any */

// CP-UI-TABLE-001 s5: Follow-up item | Due | Status | Actions.
//
// ⚠ THE DUE COLUMN SAYS "OVERDUE" IN WORDS, not only in colour (s10). A row that relies on its tint
// to say it is late is a row that says nothing in greyscale, at high zoom, or to a screen reader.
// CPR-FUP-HFE-008 s12: What | Category | Target | Priority | Status | Actions.
//
// ⚠ NO "ASSIGNED TO" COLUMN, AND ITS ABSENCE IS THE HONEST ANSWER. s12 lists one and s21 wants
// `assigned_to`; `practice_follow_up` has no such column, so a column here could only ever print an
// em-dash on every row -- a heading promising accountability the record cannot carry. It belongs to the
// migration half. Same for Location and Instructions.
const FOLLOW_UP_COLUMNS: RecordColumn<any>[] = [
  { key: "reason", label: "What", priority: "primary",
    render: f => <span className="font-semibold text-gray-800">{f.reason}</span> },
  // s12's Category. `kind` IS the category model -- s7's list and FOLLOW_UP_KINDS are the same seven
  // things under two names, so this is a relabel and not a new field.
  { key: "kind", label: "Category", priority: "secondary",
    render: f => (
      <span className="text-[11.5px] text-gray-600">
        {FOLLOW_UP_KINDS.find(([k]) => k === f.kind)?.[1] ?? f.kind ?? "—"}
      </span>
    ) },
  // ⚠ s9: "DISPLAY THE RESOLVED CALENDAR DATE WHERE THIS REDUCES AMBIGUITY." An overdue row used to say
  // only "9 days overdue" -- a relative figure with no anchor, on the one row somebody has to act on.
  // Both are shown now, and the date is the EFFECTIVE one, so a deferred obligation is measured against
  // the day it comes back rather than the day it was first owed.
  { key: "target", label: "Target", priority: "status",
    render: f => (
      <span className={f.overdue ? "text-[11.5px] font-bold text-[var(--cmp-text-critical)]" : "text-[11.5px] text-gray-600"}>
        {f.overdue
          ? `${Math.abs(f.dueInDays)} days overdue`
          : f.dueInDays === 0 ? "due today" : `in ${f.dueInDays} days`}
        <span className="ml-1 font-normal text-gray-500">{f.effectiveDueOn ?? f.due_on}</span>
      </span>
    ) },
  // ⚠ s8: PRIORITY AND STATUS ARE SEPARATE COLUMNS BECAUSE THEY ARE SEPARATE CONCEPTS. "An Urgent
  // follow-up may still be Open, while a Routine follow-up may become Overdue." One column carrying
  // both would make those two sentences unsayable.
  { key: "priority", label: "Priority", priority: "secondary",
    render: f => {
      const p = String(f.priority ?? "routine").toLowerCase();
      return (
        <span className={`rounded-full border px-1.5 py-0.5 text-[10.5px] font-semibold ${FOLLOW_UP_PRIORITY_CHIP[p] ?? FOLLOW_UP_PRIORITY_CHIP.routine}`}>
          {FOLLOW_UP_PRIORITY_GLYPH[p]}{FOLLOW_UP_PRIORITY_GLYPH[p] ? " " : ""}{p}
        </span>
      );
    } },
  // s13's lifecycle. ⚠ SCHEDULED SAYS "booked", NOT "done": s13 and s22 both insist booking is never
  // clinical completion, and a chip reading "scheduled" beside a settled-looking row is how that
  // conflation starts.
  { key: "status", label: "Status", priority: "status",
    render: f => (
      <span className="text-[11.5px] text-gray-700">
        {f.status === "SCHEDULED" ? "booked, not yet done"
          : (FOLLOW_UP_STATUS_LABELS[f.status] ?? f.status ?? "").toLowerCase()}
      </span>
    ) },
  // s12's Assigned to, real from migration 299 onwards.
  //
  // ⚠ "UNASSIGNED" IS PRINTED, NOT LEFT BLANK. s11: "every trackable follow-up should have an
  // accountable owner where workflow requires one." An empty cell reads as a rendering gap; the word
  // reads as a fact, and it is the fact somebody needs to see before closing a consultation.
  // ⚠ THE COLUMN TAKES THE VIEWER'S OWN ID, because "a practitioner" is not accountability. There is no
  // member directory in the practice plane to resolve a uuid to a name, so the honest vocabulary is
  // three words: You, a queue by its own name, or somebody else. Printing the uuid would be worse than
  // either, and the first draft of this column said "a practitioner" for every assignment including
  // the reader's own -- which answers the question "is this mine?" with "no comment".
  { key: "assigned", label: "Assigned to", priority: "secondary",
    render: f => f.assigned_queue
      ? <span className="text-[11.5px] text-gray-700">{f.assigned_queue} <span className="text-gray-500">(queue)</span></span>
      : f.assigned_to
        ? (
          <span className="text-[11.5px] text-gray-700">
            {f.assigned_to === f.__viewer ? "You" : "Another practitioner"}
          </span>
        )
        : <span className="text-[11.5px] text-gray-500">Unassigned</span> },
];

// CP-UI-TABLE-001 s5: Document | Type | Date | Source | Actions.
//
// ⚠ s5: "Use file-type icon only when helpful; avoid large document cards." The type stays as a WORD in
// its own column rather than becoming a coloured tile -- a table already answers "which row" by
// position, and an icon per row would be the document-card weight this standard is removing.
//
// ⚠ THE VERSION IS KEPT. It was a quiet "v2" beside the title and could have been dropped as noise on
// the way to a tidier row -- s12 forbids exactly that: "do not remove clinical data merely to make a
// row shorter". A letter that has been reissued is a different document from one that has not.
const DOCUMENT_COLUMNS: RecordColumn<any>[] = [
  { key: "title", label: "Document", priority: "primary",
    render: d => (
      <>
        <span className="font-semibold text-gray-800">{d.title}</span>
        {d.version > 1 && <span className="ml-1.5 text-[10px] text-gray-400">v{d.version}</span>}
      </>
    ) },
  { key: "type", label: "Type", priority: "secondary",
    render: d => (
      <span className="text-[11.5px] text-gray-600">
        {(DOC_TYPES.find(([k]) => k === d.doc_type)?.[1]) ?? d.doc_type}
      </span>
    ) },
  { key: "status", label: "Status", priority: "status",
    render: d => <span className="text-[11.5px] text-gray-600">{d.status}</span> },
];
import { formatTime, formatDate, formatDayTime } from "@/lib/datetime";
import { HHMM_RE } from "@/lib/practice/practice-time";
import { TimeInput } from "@/components/ui/wall-clock";
// The shared encounter visual language. Follow-up is the first tab on it; the other seven follow.
import { PANEL, SectionHeader, EmptyState, Tip, Advisory } from "@/components/practice/EncounterKit";
import DiagnosisWorkspace from "./DiagnosisWorkspace";
import ProcedureWorkspace from "./ProcedureWorkspace";

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

// ════════════════════════════════════════════════════════════════════════════════════════════════════
// CPR-MOB-001 s10/s4/s16 — THE MOBILE FACE OF THIS SCREEN IS MOSTLY THESE FOUR STRINGS.
//
// s10's frame is "the recent Encounter HFE workflow remains functionally frozen; only layout adapts",
// and the cheapest honest reading of that is: change the SHARED control classes, not the controls. Every
// field, every quiet button and every quick action on this screen wears one of the constants below, so
// a `max-md:` suffix here dresses 43 control sites in this file (167 across the ten files this phase
// touched, counted rather than estimated) and reaches NOTHING at md and up — the tail of each string is
// inert above 768px, so the desktop rendering is byte-for-byte what it was.
//
// TWO no-ops, and the second is not cosmetic:
//   · max-md:min-h-[var(--cp-touch)] — s4's 44px floor. py-2 at 13px is about 34px, which is a miss on
//     every clinical field on the most clinically loaded surface in the product.
//   · max-md:text-[16px] on the INPUTS — below 16px iOS zooms the whole page on focus and does not zoom
//     back out, so a practitioner who taps a dose field is left on a horizontally-scrolled page, which
//     is the one thing s4 forbids outright. AttachRecordInline records the same trap on the cockpit.
//
// ⚠ NOT ADDED TO `input`: any change to `type`. s16 wants numeric keyboards for numeric fields and
// date/time pickers for dates, and `inputMode` is set per-field where the field is genuinely numeric —
// but the 24-hour TEXT time input stays text with inputMode="numeric" (walkthrough #19: the native time
// picker follows the OS locale and drew "11:00 AM" on this very panel). No native time input, anywhere.
// ════════════════════════════════════════════════════════════════════════════════════════════════════
const input = "w-full rounded-lg border border-gray-200 px-2.5 py-2 text-[13px] outline-none focus:border-[var(--cp-primary)] focus:ring-2 focus:ring-[var(--cp-primary)]/10 max-md:min-h-[var(--cp-touch)] max-md:text-[16px]";
const CARD = "rounded-xl border border-gray-200 bg-white p-4";
const FU_LABEL = "text-[10.5px] font-semibold uppercase tracking-wide text-gray-600";

/**
 * Walkthrough 2026-08-17 #19 -- "make all the required fields obvious beyond the asterisk".
 * The asterisk STAYS and the colour REINFORCES it (the product's never-colour-alone rule): a red
 * mark beside the label, plus the amber empty-field wash that already answers "which one is
 * blocking me". aria-hidden because screen readers get `required` from the controls themselves --
 * hearing "star" after every label is noise, not access.
 */
const REQ = <span aria-hidden className="font-bold text-[var(--cmp-text-critical)]"> *</span>;
// s4's 44px floor again, and `inline-flex items-center` with it: a min-height on a button whose content
// is not a flex item grows the box and leaves the label sitting at the top of it.
const QUIET_BTN = "rounded-lg border border-gray-200 px-2.5 py-1.5 text-[11px] font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50 max-md:inline-flex max-md:min-h-[var(--cp-touch)] max-md:items-center max-md:justify-center max-md:px-3.5 max-md:text-[12.5px]";

/**
 * CPR-HFE-TRT-004 s11's quick-action tray. "Compact grid/tray; neutral buttons except
 * destructive/critical actions" -- and none of these eight is destructive, so all eight are neutral.
 *
 * ⚠ THE FOCUS RING IS NOT DECORATION. s9: "keyboard focus must be obvious and INDEPENDENT OF COLOUR
 * ALONE", s13: "support keyboard navigation with visible focus". These were bare bordered buttons whose
 * only focus state was the browser default, which a `border`/`hover:bg` treatment renders nearly
 * invisible. A 2px offset ring changes the button's OUTLINE, so it reads as focus in greyscale too.
 *
 * ⚠ AND THE UNAVAILABLE STATE MOVED OFF gray-300. It measured about 1.9:1 on white -- below the 3:1
 * floor for meaningful non-text content, so an action a caller could not use was not merely quiet, it
 * was close to unreadable. It stays visibly weaker than an allowed action, which is the point (nothing
 * is hidden -- the screen must not silently differ between two people looking at one consultation), but
 * a practitioner can now read what it says.
 */
/**
 * CPR-MOB-001 s4's 44px floor, for the row-level controls that do not wear QUIET_BTN.
 *
 * A dozen actions on this screen are hand-classed rather than sharing a constant — the referral status
 * moves, the follow-up row's Link-a-visit and Settle, the plan-template chips, the note tab's Save to
 * record and Expand, the draft Retry. Most sit at `px-2 py-0.5 text-[11px]`, which is roughly a 20px
 * target: fine for a pointer, a coin-toss for a thumb. Several of them WRITE TO THE RECORD, and the one
 * next to them usually writes something different.
 *
 * Appended, never substituted, and every utility inside is `max-md:` — so each of those buttons keeps
 * its exact desktop appearance and grows only where a finger is doing the pressing.
 */
const TOUCH =
  "max-md:inline-flex max-md:min-h-[var(--cp-touch)] max-md:items-center max-md:justify-center max-md:px-3.5 max-md:text-[12.5px]";

const QA_BASE =
  "flex items-center gap-1.5 rounded-lg border px-2 py-2 text-[11px] font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cp-primary)] focus-visible:ring-offset-1 max-md:min-h-[var(--cp-touch)] max-md:px-3 max-md:text-[12.5px]";
const QA_ALLOWED = `${QA_BASE} border-gray-200 bg-white text-gray-700 hover:bg-[var(--cp-primary)]/[0.07] hover:border-[var(--cp-primary)]/40`;
const QA_DENIED = `${QA_BASE} border-gray-200 bg-gray-50 text-gray-500`;

// CPR-NOTE-HFE-010 s7's anchors: marker, heading, descriptor -- three parts, because the marker and
// the strong heading are the perceptual anchor and the descriptor is deliberately quieter. NOTE_LABEL
// below survives as the one-string form the draft-recovery panel still uses.
const NOTE_SECTIONS: [string, string, string, string][] = [
  ["subjective", "S", "Subjective", "what the patient reports"],
  ["objective", "O", "Objective", "examination and findings"],
  ["assessment", "A", "Assessment", "clinical impression"],
  ["plan", "P", "Plan", "what happens next"],
  ["narrative", "N", "Narrative", "free text"],
];

/**
 * CPR-NOTE-HFE-010 s9: a compact writing area that grows with the text.
 *
 * ⚠ THE FIXED rows={3} BOXES WERE THE TAB'S BIGGEST NOISE. Five empty three-line boxes is fifteen lines
 * of nothing, and a clinician writing a long objective section then scrolled INSIDE a three-line
 * viewport -- s9 forbids both directions: "replace large fixed empty boxes with compact starting areas"
 * and "do not constrain clinically necessary narrative length with a small fixed viewport".
 */
function AutoGrowTextarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const resize = () => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  };
  // On value as well as on input: dictation and calculator inserts change the text without a keystroke.
  useEffect(resize, [props.value]);
  return <textarea ref={ref} rows={2} {...props} onInput={resize} />;
}

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
  /** The PRACTICE's timezone. A consultation's own clock is the practice's, never the reader's device. */
  timezone: string;
  notes: any[]; diagnoses: any[]; treatments: any[];
  templates: any[]; history: Record<string, any[]>; documents: any[];
  followUps: any[];
  /** ⚠ Whether the follow-up READ failed. Never conflate with an empty list -- see page.tsx. */
  followUpsUnavailable: boolean;
  intervals: { code: string; label: string; days: number }[];
  /** CPR-FUP-HFE-008 s15. Built since migration 206 and never reachable from an encounter until now. */
  planTemplates: any[];
  /** s6's Location. */
  facilities: any[];
  /** #15: WHERE the booked visit happens (practice_location -- the appointment register's places,
   *  distinct from the follow-up's facility). Empty choice = the regular week decides. */
  bookingLocations: { id: string; name: string }[];
  /** s10: LIVE and FUTURE only, filtered on the server -- see page.tsx. */
  patientAppointments: any[];
  /** So the Assigned-to column can say "You" rather than printing a uuid or a vague noun. */
  currentUserId: string;
  /** s10's booking link is gated on appointment.manage, which the API enforces and this must match. */
  canBook: boolean;
  procedures: any[];
  /** CPR-PROC-HFE-005 s7. Loaded since the tab was built, delivered to it only from today. */
  procedureTypes: any[];
  /** s6's shortcuts, derived from recorded procedures. Carries its own three states. */
  frequentProcedures: { items: any[]; permitted: boolean; unavailable: boolean; detail: string | null };
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
  /** CPR-HFE-TRT-004 s11's HIGHEST rail tier: the Patient safety card, authored in page.tsx. */
  railSafety: React.ReactNode;
  /** s11's LOWER rail tier: encounter context and previous visits, authored in page.tsx. */
  railLower: React.ReactNode;
  /** The weight prompt, decided by weightPrompt() on the server. ⚠ Never a gate -- see that function. */
  weightPrompt: { state: WeightPromptState; text: string; blocking: false };
}) {
  const locked = LOCKED_STATUSES.includes(props.status) || props.status === "CANCELLED";
  const editable = props.canEdit && !locked;

  const [tab, setTab] = useState("overview");
  // ── CPR-MOB-001 s10: THE TAB THE CODE JUST SWITCHED TO HAS TO BE THE TAB YOU CAN SEE ──────────────
  //
  // Nine controls on this screen call setTab() without anybody touching the strip: the six decision
  // cards and the quick-action tray. On desktop all eight tabs fit and the highlight simply moves. On a
  // phone the strip is scrolled, so pressing "Diagnosis" in the decisions row swapped the CONTENT while
  // the visible part of the strip still showed Overview underlined — the screen answers a tap by
  // appearing not to have moved, which is the walkthrough's REACHABLE-≠-DISCOVERABLE defect exactly.
  //
  // ⚠ scrollLeft ON THE STRIP, NEVER scrollIntoView. scrollIntoView walks up the ancestor chain and is
  // entitled to scroll the PAGE — on this page that would jerk a practitioner away from the block they
  // were reading, mid-consultation, as a side effect of a tab change. Writing the strip's own
  // scrollLeft cannot move anything but the strip.
  //
  // No breakpoint test and no matchMedia: the guard is `scrollWidth > clientWidth`, which is the actual
  // condition ("this strip is scrolled"), true on a narrow phone and false on a desktop where the eight
  // fit. A width test would be a proxy for it, and would be wrong at the first tablet that disagreed.
  const tabStrip = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const strip = tabStrip.current;
    if (!strip || strip.scrollWidth <= strip.clientWidth) return;
    const active = strip.querySelector<HTMLElement>('[aria-current="page"]');
    if (!active) return;
    strip.scrollTo({
      left: Math.max(0, active.offsetLeft - (strip.clientWidth - active.offsetWidth) / 2),
      behavior: "smooth",
    });
  }, [tab]);
  const [busy, setBusy] = useState(false);
  // `offer` is how a REFUSAL becomes an ACTION. Only one exists today (an interruption), and it is a
  // named literal rather than a callback stored on the notice, so a notice stays serialisable data and
  // the button lives with the rest of the markup.
  const [notice, setNotice] = useState<{ kind: "ok" | "err"; text: string; offer?: "interrupt" } | null>(null);
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
  // CPR-DOC-AUTO-001 s7. null when the composer is closed. `reason` seeds the form from a referral that
  // is already recorded, so the practitioner does not retype what the record already says.
  const [letterFor, setLetterFor] = useState<{ purpose: ComposerPurpose; referralId: string | null; reason: string } | null>(null);
  const [makingSummary, setMakingSummary] = useState(false);
  const [doc, setDoc] = useState({ title: "", docType: "consultation_summary", addressedTo: "", composeFrom: true });
  const [fu, setFu] = useState({
    // CPR-FUP-002 HFE s3's frozen sequence. `reason` carries the SUBJECT ("Follow-up for") -- the
    // short thing this obligation is about, never a composed sentence; it is already the line the
    // board leads with, which is exactly what s10 wants subject to be. kind is the CATEGORY,
    // inferred from the action (s7) until categoryTouched says a human chose. followUpType is the
    // ACTION and starts EMPTY on purpose -- s10 makes it required and s9 forbids auto-selecting
    // Other, and a silent default would file every uninspected follow-up under one action code.
    reason: "", kind: "clinical_condition", categoryTouched: false,
    intervalCode: "2w", priority: "routine",
    // CPR-FUP-HFE-008 s6/s11 (migration 299). `owner` is the screen's word for a choice the database
    // stores in two columns -- one owner, never both. HFE s4 makes assignment REQUIRED and defaults
    // it to Me for an individual practice, so Unassigned is no longer offered here.
    followUpType: "", locationId: "", instructions: "", owner: "me", queue: "",
    // s9: the target is an interval OR an exact date. "custom" in the select reveals the calendar.
    dueDate: "",
    // CPR-FUP-002 s11: booking is an EXPLICIT choice beside the obligation, never implied by the
    // action type. bookVisit reveals the visit fields and nothing else sets them.
    bookVisit: false, bookDate: "", bookTime: "09:00", bookLocationId: "",
    // #6: true once the practitioner has chosen a place BY HAND -- the regular-week suggestion may
    // prefill an untouched select and must never overwrite a human choice.
    locationTouched: false,
  });
  // #6: what the regular week says about the currently-resolved target day. The sentence renders
  // whether or not a facility could be prefilled from it.
  const [fuPlace, setFuPlace] = useState<{ sentence: string; facilityId: string | null } | null>(null);
  // HFE s7: Category lives under More details -- inferred, auditable, out of the primary sequence.
  const [fuMore, setFuMore] = useState(false);

  // The resolved target day drives the place suggestion. Recomputed exactly the way the booking
  // prefill computes it: the interval's arithmetic date, or the calendar-chosen one.
  const fuTargetDate = (() => {
    if (fu.intervalCode === "custom") return fu.dueDate || null;
    const days = props.intervals.find(i => i.code === fu.intervalCode)?.days;
    if (days === undefined) return null;
    const d = new Date();
    d.setDate(d.getDate() + days);
    return d.toISOString().slice(0, 10);
  })();

  useEffect(() => {
    let live = true;
    // Every state change happens INSIDE the timer callback, never in the effect body -- the same
    // rule (and reason) as the patient-search debounce in AddFollowUp.
    const timer = setTimeout(() => {
      if (!live) return;
      if (!fuTargetDate) { setFuPlace(null); return; }
      fetch(`/api/v1/practice/follow-ups/place-for-day?date=${fuTargetDate}`)
        .then(r => r.ok ? r.json() : null)
        .then(d => {
          if (!live || !d) return;
          setFuPlace({ sentence: String(d.sentence ?? ""), facilityId: d.facilityId ?? null });
          // Prefill ONLY an untouched, empty select -- a suggestion, never an override.
          if (d.facilityId) {
            setFu(p => (p.locationTouched || p.locationId) ? p : { ...p, locationId: String(d.facilityId) });
          }
        })
        .catch(() => { if (live) setFuPlace(null); });
    }, 300);
    return () => { live = false; clearTimeout(timer); };
  }, [fuTargetDate]);
  const [closingFu, setClosingFu] = useState<string | null>(null);
  const [fuOutcome, setFuOutcome] = useState("");
  /** CPR-FUP-HFE-008 s12's filter, by key from FOLLOW_UP_TAB_FILTERS. "all" is the resting state. */
  const [fuFilter, setFuFilter] = useState("all");
  /** s10: which follow-up is having a booked visit linked to it. */
  const [bookingFu, setBookingFu] = useState<string | null>(null);
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

  // ⚠ s10's THIRD STATE EXISTS NOW. The old autosave swallowed failure with catch(() => {}), so a
  // practitioner whose drafts had stopped landing saw the same screen as one whose drafts were safe --
  // the exact silence s10's "Not saved -- Retry" exists to end. One flag across the segments, because
  // the failure mode (network, session) is never per-segment.
  const [draftFailed, setDraftFailed] = useState(false);
  /** CPR-NOTE-HFE-010 s8: which section the writer is in. Focus-driven, and only presentation. */
  const [activeSeg, setActiveSeg] = useState<string | null>(null);
  /** s12: the template picker is closed until asked for. */
  const [templateOpen, setTemplateOpen] = useState(false);

  // Callable, not only scheduled: the Retry control and the interval share one flush, so "retry" cannot
  // drift into meaning something different from what the timer does.
  const flushDrafts = useCallback(async () => {
    let failed = false;
    for (const t of NOTE_TYPES) {
      // Only what has been touched and not yet saved. Autosaving an untouched segment would write a
      // draft of the text already in the record and then offer it back as a recovery.
      if (savedRef.current[t] !== false) continue;
      const body = bodiesRef.current[t] ?? "";
      try {
        const r = await fetch(`/api/v1/practice/encounters/${props.encounterId}/drafts`, {
          method: "PUT", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ noteType: t, body }),
        });
        if (r.ok) setDraftAt(d => ({ ...d, [t]: formatTime(new Date()) }));
        else failed = true;
      } catch { failed = true; }
    }
    setDraftFailed(failed);
  }, [props.encounterId]);

  useEffect(() => {
    if (!editable) return;
    // ⚠ TWENTY SECONDS, DOWN FROM TWO MINUTES. The draft overwrites in place and writes no version
    // history, so the only cost of saving often is requests -- and the cost of saving rarely was a
    // two-minute window of typing that a closed laptop erased. s10 asks for a short debounce; this is
    // the shortest that does not chatter on every keystroke.
    const timer = setInterval(() => { void flushDrafts(); }, 20_000);
    return () => clearInterval(timer);
  }, [editable, flushDrafts]);

  // ── CPR-MOB-001 s10/s18: "PRESERVE IN-PROGRESS ENCOUNTER STATE IF THE APP BACKGROUNDS" ────────────
  //
  // ⚠ THIS IS NOT A SECOND PERSISTENCE, AND THAT IS THE WHOLE DESIGN. s18 says to preserve unsaved
  // encounter data "according to existing CP offline/sync rules", and the existing rule is the CPR-130
  // draft above: one endpoint, one flush, one recovery panel. What was missing was not a store — it was
  // a TRIGGER. The interval is the only thing that ever fires it, so up to twenty seconds of typing
  // lived nowhere but in a browser tab, and on a phone a browser tab is the one thing the operating
  // system is entitled to discard without asking. Answering a call mid-consultation could lose the
  // paragraph; nothing on the desktop path has that failure because a desktop tab is not evicted.
  //
  // So the same `flushDrafts` gets a second caller. Not a copy of it — the SAME callback the timer and
  // the Retry control share, which is why "retry", "every twenty seconds" and "you just backgrounded
  // the app" cannot drift into meaning three different things.
  //
  // ⚠ visibilitychange → "hidden", NOT beforeunload/pagehide. Mobile browsers are documented not to fire
  // unload reliably when the OS evicts a backgrounded tab; `hidden` is the last event guaranteed to
  // arrive, and it also covers the ordinary cases — switching apps, locking the device, changing tabs.
  //
  // ⚠ AND IT FIRES ON ROTATION TOO — for nothing. A rotate does not unmount this component, so the
  // draft state survives it on its own; the flush is simply harmless there, because flushDrafts skips
  // every segment that is not dirty. s10's rotation half needs no code, and inventing some would have
  // meant a second copy of the note bodies to go stale.
  useEffect(() => {
    if (!editable) return;
    const onHide = () => { if (document.visibilityState === "hidden") void flushDrafts(); };
    document.addEventListener("visibilitychange", onHide);
    return () => document.removeEventListener("visibilitychange", onHide);
  }, [editable, flushDrafts]);

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

  /**
   * `onError` is OPTIONAL AND ADDITIVE, which is the whole reason it is shaped this way. Twenty-odd
   * callers pass three arguments and must keep behaving exactly as they did; only the one path that can
   * meet a refusal it can DO something about passes a fourth. Returning true means "handled, do not
   * write the default notice"; returning false, or passing nothing, leaves the old behaviour intact.
   */
  async function call(
    fn: () => Promise<Response>, okText: string, reload: boolean,
    onError?: (code: string | null, message: string) => boolean,
  ) {
    setBusy(true); setNotice(null);
    const res = await fn();
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const code: string | null = data?.error?.code ?? null;
      const message: string = data?.error?.message ?? data?.error ?? "That did not work.";
      if (!onError?.(code, message)) setNotice({ kind: "err", text: message });
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

  /**
   * CPR-DOC-AUTO-001 s3, mode A -- the visit summary is one click.
   *
   * NO factKeys IN THE BODY, AND THAT IS THE WHOLE POINT. An omitted selection means the s9 default
   * (this consultation's facts), decided server-side, so the button does not first have to ask what
   * the default is and post it straight back. An empty array would mean "include nothing" and produce
   * a summary of nothing.
   */
  const createVisitSummary = async () => {
    setMakingSummary(true); setNotice(null);
    try {
      const res = await fetch("/api/v1/practice/documents/visit-summary", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ patientId: props.patientId, encounterId: props.encounterId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setNotice({ kind: "err", text: data?.error?.message ?? "That did not work." });
        setMakingSummary(false); return;
      }
      window.location.href = `/practice/documents/${data.documentId}`;
    } catch {
      setNotice({ kind: "err", text: "That did not work." });
      setMakingSummary(false);
    }
  };

  const createDocument = () => call(() => fetch("/api/v1/practice/documents", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      patientId: props.patientId, encounterId: props.encounterId,
      title: doc.title, docType: doc.docType,
      addressedTo: doc.addressedTo || undefined, composeFrom: doc.composeFrom,
    }),
  }), "Document created.", true);

  // ══ RAISE, AND -- WHEN THE TYPE IS AN APPOINTMENT -- BOOK AND LINK IN THE SAME PRESS ═══════════
  //
  // ⚠ THE OWNER ASKED FOR THIS IN AS MANY WORDS ("would prefer limited clicks"), and it is the
  // two-write shape the Link-a-visit action deliberately avoided -- so the risk is handled instead of
  // avoided: each step's failure is reported AS THAT STEP, and nothing pretends the earlier steps did
  // not happen. A follow-up raised whose booking failed IS raised -- the obligation is real either way
  // -- and the row's Link a visit action is the retry path. Booking is never completion: the result of
  // full success is a SCHEDULED follow-up, still owed.
  const raiseFollowUp = async () => {
    setBusy(true); setNotice(null);
    try {
      const res = await fetch("/api/v1/practice/follow-ups", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          patientId: props.patientId, originEncounterId: props.encounterId,
          reason: fu.reason, kind: fu.kind,
          // ⚠ "custom" IS A SCREEN WORD, NEVER AN API WORD. The engine refuses unknown intervals by
          // name (UNKNOWN_INTERVAL), so the calendar path sends dueOn and NO intervalCode -- which is
          // also what keeps 299-4b true: a chosen date records no interval it never had.
          intervalCode: fu.intervalCode === "custom" ? undefined : fu.intervalCode,
          dueOn: fu.intervalCode === "custom" ? fu.dueDate : undefined,
          priority: fu.priority,
          followUpType: fu.followUpType,
          locationId: fu.locationId || undefined,
          instructions: fu.instructions.trim() || undefined,
          assignedTo: fu.owner === "me" ? props.currentUserId : undefined,
          assignedQueue: fu.owner === "queue" ? (fu.queue.trim() || undefined) : undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setNotice({ kind: "err", text: data?.error?.message ?? data?.error ?? "That follow-up was not raised." });
        return;
      }

      const wantsBooking = fu.bookVisit && fu.bookDate;
      if (!wantsBooking) { window.location.reload(); return; }

      const booked = await fetch("/api/v1/practice/appointments", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          patientId: props.patientId, appointmentType: "scheduled_followup",
          date: fu.bookDate, time: fu.bookTime || "09:00",
          reason: fu.reason,
          // #15: empty means the regular week decides, exactly as before this select existed.
          locationId: fu.bookLocationId || undefined,
        }),
      });
      const bookedData = await booked.json().catch(() => ({}));
      if (!booked.ok || !bookedData?.appointment?.id) {
        // ⚠ STEP TWO FAILED AND STEP ONE IS NOT UNDONE. The obligation exists whether or not a visit
        // is arranged -- that is the whole meaning of a follow-up -- so the message says exactly what
        // stands and what does not, and where the retry lives.
        setNotice({
          kind: "err",
          text: `The follow-up was raised, but the visit was not booked: ${bookedData?.error?.message ?? bookedData?.error ?? "the booking failed"}. Use "Link a visit" on its row once one is booked.`,
        });
        return;
      }

      const linked = await fetch(`/api/v1/practice/follow-ups/${data.followUp.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ appointmentId: bookedData.appointment.id }),
      });
      if (!linked.ok) {
        const linkData = await linked.json().catch(() => ({}));
        setNotice({
          kind: "err",
          text: `Follow-up raised and the visit booked, but linking them failed: ${linkData?.error?.message ?? "unknown"}. Use "Link a visit" on the row -- the booking is there.`,
        });
        return;
      }
      window.location.reload();
    } finally { setBusy(false); }
  };

  // ══ s10's BOOKING LINK -- scheduleFollowUp's FIRST UI CALLER ═══════════════════════════════════
  //
  // ⚠ ONE WRITE, NOT TWO. See the button for why this links an existing appointment rather than
  // creating one: book-then-link is two writes with no transaction, and a failed second leaves an
  // appointment nobody asked for. `{ appointmentId }` is also the ONLY body shape that reaches
  // scheduleFollowUp -- the route checks dueOn and deferUntil first, so either would win instead.
  const linkVisit = (id: string, appointmentId: string) =>
    call(() => fetch(`/api/v1/practice/follow-ups/${id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ appointmentId }),
    }), "A visit is now linked to this follow-up. It is booked, not settled.", true);

  // ══ s15's TEMPLATES -- createPlan's FIRST UI CALLER ════════════════════════════════════════════
  //
  // ⚠ THE ENGINE HAS BEEN COMPLETE SINCE MIGRATION 206 AND NOTHING COULD REACH IT. createPlan,
  // createPlanTemplate, setTemplateActive and discontinuePlan had zero UI callers between them -- the
  // whole write half of follow-up plans was API-only.
  //
  // ⚠ AND s15's OWN RULE RIDES ON THE CONTROL: "templates are workflow shortcuts, NOT patient-specific
  // clinical advice." Applying one raises every step as an ordinary follow-up, each removable.
  const applyPlan = (templateId: string) => call(() => fetch("/api/v1/practice/follow-up-plans", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      patientId: props.patientId, originEncounterId: props.encounterId, templateId,
    }),
  }), "The plan's follow-ups have been raised.", true);

  // CLOSING FROM HERE NAMES THIS ENCOUNTER as what settled it, which is the whole point of doing it in
  // the consultation rather than on the board: the record then says WHERE the obligation was met, not
  // just that somebody ticked it.
  const closeFollowUp = (id: string) => call(() => fetch(`/api/v1/practice/follow-ups/${id}`, {
    method: "PATCH", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "complete", closingEncounterId: props.encounterId, outcome: fuOutcome }),
  }), "Follow-up closed.", true);

  // (recordProcedure and addOutcome moved into ProcedureWorkspace with the form. BOTH have
  // replacements there -- addOutcome as a per-row action on an already-recorded procedure -- which is
  // the check the first attempt at this rewrite skipped, deleting a writer that had none.)

  const transition = (action: string, label: string) => {
    if (action === "sign" && !confirm("Signing locks this encounter. Only a governed amendment can change it afterwards. Sign now?")) return;
    if (action === "entered_in_error" && !confirm("Mark this encounter as entered in error? It stays in the record, permanently flagged.")) return;
    call(() => fetch(`/api/v1/practice/encounters/${props.encounterId}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }),
    }), label, true,
    // THE ENGINE HAS BEEN TELLING PEOPLE TO DO THIS SINCE MIGRATION 234 AND THERE WAS NO BUTTON.
    // Its refusal reads "another consultation is already open. Pause it, or start this one as an
    // interruption." The first half a practitioner could do -- navigate away, pause, navigate back.
    // The second half named an engine (interruptWith) that had no route and no caller outside two
    // harnesses, so the sentence sent somebody looking for a control that did not exist, in the one
    // situation it names.
    //
    // THE ENGINE'S OWN SENTENCE IS STILL WHAT GETS PRINTED. The button is the answer to it, never a
    // replacement for it: a summary written here drifts from the refusal it is summarising.
    (code, message) => {
      if (code !== "ANOTHER_ACTIVE" || !props.canEdit) return false;
      setNotice({ kind: "err", text: message, offer: "interrupt" });
      return true;
    });
  };

  /**
   * Pause whatever is running and open this one, in the engine's order and with its rollback.
   *
   * NOT TWO CALLS FROM HERE. Doing it client-side -- PATCH pause, then PATCH start -- would put the
   * rollback in the browser, so a start that failed after a successful pause would leave a practitioner
   * with NOTHING active and a patient in front of them; a closed laptop between the two would leave it
   * that way. interruptWith holds both writes and puts the clinic back if the second is refused.
   */
  const startAsInterruption = () => call(() => fetch(`/api/v1/practice/encounters/${props.encounterId}`, {
    method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "interrupt" }),
  }), "Started as an interruption.", true);

  /**
   * RENDERED IN BOTH FRAMES FROM ONE DEFINITION, because the notice is. The desktop paragraph is
   * max-md:hidden and the dock draws its own below md; an offer attached to only one of them would be
   * invisible on exactly the device somebody is holding when an emergency walks in.
   *
   * A SIBLING OF THE PARAGRAPH, NEVER A CHILD: the notice is a <p>, and a <button> inside one is
   * invalid markup that React renders happily and the browser then re-parents.
   */
  const interruptOffer = notice?.offer === "interrupt" ? (
    <button type="button" disabled={busy} onClick={startAsInterruption}
      className="rounded-lg bg-[var(--cp-primary)] px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-[var(--cp-primary-deep)] disabled:opacity-50">
      Pause the other one and start this
    </button>
  ) : null;

  // (addDx and its `dx` state went with the single-diagnosis form. The working set posts to the batch
  // route through DiagnosisWorkspace, and leaving a second writer here -- unreachable but callable --
  // is exactly the shape this file already warns about elsewhere.)

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

  /** Is this transition one of the two that destroy the encounter rather than advance it? */
  const isDanger = (to: string) => to === "CANCELLED" || to === "ENTERED_IN_ERROR";

  /**
   * Would this transition actually draw a button? The engine's table says what is POSSIBLE for the
   * status; this adds the two capability gates that decide whether THIS caller sees it.
   *
   * ⚠ IT EXISTS SO THE MOBILE DOCK CAN ASK BEFORE IT DRAWS A CONTAINER. Filtering targets by status
   * alone would let the dock render its bar, its row and its disclosure for a caller who holds neither
   * capability — a pinned white strip above the bottom navigation with nothing in it, permanently, on
   * a phone. A read-only viewer looking at somebody else's encounter is exactly that caller.
   */
  const mayTransition = (to: string) =>
    !!actionFor(props.status, to) && (to === "SIGNED" ? props.canSign : props.canEdit);

  // ── WHAT THE MOBILE DOCK HOLDS, DECIDED ONCE ─────────────────────────────────────────────────────
  //
  // Computed up here rather than inside the dock because TWO places downstream need the answer: the
  // dock itself, and the spacer that reserves its height at the very END of the page. Those two are
  // far apart in the tree (the dock sits with the action bar it belongs to; the spacer has to be the
  // last thing in the document or it reserves height in the middle of the consultation instead of
  // under the bar) — and a spacer that disagreed with the bar about whether the bar exists is either
  // a gap in the middle of the page or a last section nobody can read.
  const dockForward = targets.filter(to => !isDanger(to) && mayTransition(to));
  const dockUndo = targets.filter(to => isDanger(to) && mayTransition(to));
  const dockVisible = !!notice || dockForward.length > 0 || dockUndo.length > 0;

  /**
   * ONE TRANSITION BUTTON, RENDERED IN TWO PLACES — AND IT IS ONE FUNCTION SO THERE IS STILL ONE LIST.
   *
   * CPR-MOB-001 s10 asks for a sticky primary action; the encounter's actions are not the console's to
   * invent, they are ENCOUNTER_TRANSITIONS[status] mapped through actionFor — the same table the engine
   * checks and the database CHECK constrains. Giving the mobile bar its own `<button>` markup would have
   * been the second list of buttons the action bar's own header warns against, so instead the markup was
   * extracted and BOTH frames call this. The gate (`allowed`), the danger treatment and the sign
   * treatment are computed here exactly once.
   *
   * `extra` is appended, never substituted: desktop passes "" and gets the string it always had.
   */
  const transitionButton = (to: string, extra = "") => {
    const action = actionFor(props.status, to);
    if (!action || !mayTransition(to)) return null;
    const needsSign = to === "SIGNED";
    const danger = isDanger(to);
    return (
      <button key={to} type="button" disabled={busy} onClick={() => transition(action, `${labelFor(props.status, to)} done.`)}
        className={`rounded-lg px-3 py-1.5 text-[12px] font-semibold disabled:opacity-50 ${
          needsSign ? "bg-[var(--cp-primary)] text-white hover:bg-[var(--cp-primary-deep)]"
            : danger ? "border border-[var(--cmp-color-critical)] text-[var(--cmp-text-critical)] hover:bg-[var(--cmp-surface-critical)]"
              : "border border-gray-200 text-gray-700 hover:bg-gray-50"} ${extra}`}>
        {labelFor(props.status, to)}
      </button>
    );
  };

  /**
   * ⚠ SETTING THE TAB WAS NOT ENOUGH, AND FOR ONE ACTION IT WAS NOTHING AT ALL.
   *
   * This read `if (a.tab) { setTab(a.tab); }`. From another tab that moves you; from the tab you are
   * already on it is a no-op, React re-renders nothing, and the click has no effect a person can see.
   * "Create referral" targets `overview` -- the tab this console opens on -- so the panel's most
   * obvious action did nothing for anybody who had not navigated away first. Reported as "clicking
   * Create referral does not do anything", which is exactly what it did.
   *
   * The scroll is therefore not a nicety, it is the part that makes the button observable. It also
   * makes the panel's own claim true: the comment beside it says the jump saves you a scroll, and
   * until now it moved the tab and left you to find the form down a long page yourself.
   *
   * FOCUS, NOT JUST SCROLL, WHERE THE TARGET TAKES IT. A keyboard user given a scrolled viewport and
   * no caret has been shown the form, not handed it. scrollIntoView is the fallback for anchors that
   * are containers rather than controls.
   */
  const quickAction = (a: typeof QUICK_ACTIONS[number]) => {
    if (!a.tab) return;
    setTab(a.tab);
    setNotice(null);
    if (!a.anchor) return;
    // After the tab's own render, or the node does not exist yet to be scrolled to. Two frames because
    // one is not enough when the tab actually changes and a whole panel mounts.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const el = document.getElementById(a.anchor!);
      if (!el) return;
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      const focusable = el.matches("input, select, textarea, button")
        ? el
        : el.querySelector<HTMLElement>("input, select, textarea, button");
      focusable?.focus({ preventScroll: true });
    }));
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
      {/* ⚠ min-w-0 IS LOAD-BEARING AND ITS ABSENCE MADE THE WHOLE PAGE SCROLL SIDEWAYS.

          A grid item defaults to min-width:auto, so it refuses to shrink below its content. The tab
          strip below has overflow-x-auto and min-width:0 and is correct -- but it never got the chance
          to scroll, because THIS element grew to 821px inside a 340px cell and took the page with it.
          Measured on a 400px viewport: document scrollWidth 843.

          A horizontally scrolling page is the one layout failure CPR-MOB-001 does not tolerate, and it
          is invisible at desktop width -- which is why it survived. */}
      <div className="flex min-w-0 flex-col gap-4">
        {/* ⚠ max-md:hidden BECAUSE THE ANSWER MUST NOT ARRIVE OFFSCREEN. This paragraph is the ONLY
            thing that reports a refusal — every transition, every referral, every note save lands
            here, and `call()` reloads the page on success, so what a practitioner reads here is
            almost always a failure. It sits at the top of a page that is several screens long on a
            phone: pressing Complete from deep in the Notes tab would have answered somewhere the
            practitioner could not see, which is the cockpit's End-from-deep-scroll defect exactly.
            Below md the same notice renders inside the pinned dock instead — one per viewport. */}
        {notice && (
          <div className="max-md:hidden">
            <p className={`rounded-lg px-3 py-2 text-[12px] ${notice.kind === "ok" ? "bg-[var(--cmp-surface-success)] text-[var(--cmp-text-success)]" : "bg-[var(--cmp-surface-critical)] text-[var(--cmp-text-critical)]"}`}>{notice.text}</p>
            {interruptOffer && <div className="mt-1.5">{interruptOffer}</div>}
          </div>
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
          {/* CPR-PAY-001 s13: the handoff to money, AFTER the clinical work and never blocking it.
              A quiet link, not a panel -- HFE-001 v1.1 routes ALL financial activity to Payments,
              so this door leads there with the encounter's context rather than growing a second
              billing surface inside the consultation. */}
          {(props.status === "COMPLETED" || props.status === "SIGNED") && (
            <a href={`/practice/payments?encounter=${props.encounterId}`}
              className="rounded-lg border border-gray-200 px-2.5 py-1 text-[11px] font-semibold text-gray-600 hover:bg-gray-50 max-md:inline-flex max-md:min-h-[var(--cp-touch)] max-md:items-center max-md:px-3.5 max-md:text-[12.5px]">
              Charges &amp; payment &rarr;
            </a>
          )}
          {targets.length === 0 ? (
            <p className="text-[12px] text-gray-400">Closed. No further transitions are possible.</p>
          ) : (
            /* CPR-MOB-001 s10: below md these same buttons are the pinned dock at the foot of the
               screen instead — `max-md:hidden` here so no viewport ever carries the act twice. */
            <div className="ml-auto flex gap-1.5 flex-wrap max-md:hidden">
              {targets.map(to => transitionButton(to))}
            </div>
          )}
          {/* A card whose only content is a heading reads as a broken panel. Below md this card keeps
              its heading and says, in words, where its buttons went — the walkthrough's rule that a
              control a person cannot find is a control that does not exist. */}
          {targets.some(mayTransition) && (
            <p className="ml-auto text-[11.5px] text-gray-500 md:hidden">
              Actions are pinned at the bottom of the screen.
            </p>
          )}
        </section>

        {/* ══ CPR-MOB-001 s10: "USE A STICKY SAVE/CONTINUE OR EQUIVALENT PRIMARY ACTION" ═════════════
            ────────────────────────────────────────────────────────────────────────────────────────
            WHY THIS EXISTS AT ALL. The action bar above is at the TOP by an HFE ruling: finishing is
            the commonest act on this screen and it used to sit below every form on it. That ruling
            solved a desktop scroll of one or two screens. On a phone the same page is six or seven
            screens, and a bar at the top of it is a bar nobody can reach without scrolling back past
            everything they just decided not to do — the SAME defect the ruling fixed, reappearing at a
            different width. s4 says primary actions belong "near the lower half of the screen"; this is
            the top bar's mobile position, not a second copy of it.

            ⚠ StickyPrimaryAction (the s5 primitive) WAS JUDGED AND REJECTED, on two grounds.
            First, it admits exactly ONE label and ONE destination, and the encounter's state table is
            not one action: ACTIVE offers Pause, Complete and Cancel, and COMPLETED offers Sign and
            Reopen. Naming one of them "the" primary would mean this component deciding which
            transition is the forward one — a second opinion about ENCOUNTER_TRANSITIONS, which is the
            one thing 13c-3 exists to prevent. (There IS no producer for that fact; see the report.)
            Second, the primitive renders as an in-flow button from md up, so adopting it would draw a
            NINTH button on the desktop action bar or need `md:hidden` wrapped round it, which hollows
            out half the component. What IS taken from it is its arithmetic: this dock sits on exactly
            the two tokens the bottom navigation occupies, so the two cannot drift into covering each
            other, and it carries the spacer that keeps the last content off its back (s17).

            ⚠ THE DESTRUCTIVE TRANSITIONS ARE BEHIND A DISCLOSURE, AND NOTHING IS REMOVED. "Cancel
            encounter" and "Mark entered in error" are irreversible; a permanent thumb-sized target for
            either, riding under a page somebody is scrolling one-handed at clinic pace, is an accident
            waiting for a bump. They are one tap away in a <details> that says what it holds — s4's
            progressive disclosure, with a visible control rather than a gesture (s17), and every
            transition the engine allows is still reachable on a phone.

            ⚠ AND THE NOTICE RIDES HERE. `call()` reloads on success, so this paragraph is almost always
            a refusal; a refusal that renders six screens above the button that caused it has not been
            reported. Rendered inside the dock, the answer arrives where the question was asked. It is
            drawn even when the encounter is closed and has no transitions, because saving a note on a
            signed encounter can still fail. */}
        {dockVisible && (
          <div className="fixed inset-x-0 bottom-[calc(var(--cp-bottomnav-h)_+_var(--cp-safe-bottom))] z-30 border-t border-gray-200 bg-white/95 px-3 py-2.5 backdrop-blur md:hidden">
            {notice && (
              <div className="mb-2">
                <p role="status" className={`rounded-lg px-3 py-2 text-[12.5px] ${notice.kind === "ok"
                  ? "bg-[var(--cmp-surface-success)] text-[var(--cmp-text-success)]"
                  : "bg-[var(--cmp-surface-critical)] text-[var(--cmp-text-critical)]"}`}>
                  {notice.text}
                </p>
                {/* min-h so the offer is a touch target rather than a 24px strip on the device this
                    situation is most likely to be met on. */}
                {interruptOffer && (
                  <div className="mt-1.5 flex min-h-[var(--cp-touch-primary)] items-stretch [&>button]:flex-1">{interruptOffer}</div>
                )}
              </div>
            )}
            {dockForward.length > 0 && (
              <div className="flex gap-2">
                {dockForward.map(to =>
                  transitionButton(to, "flex min-h-[var(--cp-touch-primary)] flex-1 items-center justify-center text-[13.5px]"))}
              </div>
            )}
            {dockUndo.length > 0 && (
              <details className="mt-1.5">
                <summary className="flex min-h-[var(--cp-touch)] cursor-pointer items-center text-[12px] font-semibold text-gray-500">
                  Other actions for this encounter
                </summary>
                <div className="flex flex-wrap gap-2 pb-1">
                  {dockUndo.map(to =>
                    transitionButton(to, "flex min-h-[var(--cp-touch)] flex-1 items-center justify-center text-[12.5px]"))}
                </div>
              </details>
            )}
          </div>
        )}

        {/* ── CPR-ENC-002 s7: WARNINGS, NEVER REFUSALS ──────────────────────────────────────────
            ⚠ NOTHING HERE BLOCKS ANYTHING, and that is the specification's own word. A consultation
            that ends without a diagnosis is a real consultation -- the honest answer to "what is wrong
            with this patient" is often "I do not know yet" -- and a system that refused to close it
            would teach practitioners to type a diagnosis they do not hold in order to get out of the
            screen. A false diagnosis is worse than an empty field. */}
        {editable && props.warnings.length > 0 && (
          // ⚠ ONE LINE UNTIL ASKED FOR (the owner, 2026-08-12: "this important space is being eaten
          // up"). The block sat open above the consultation on every encounter, spending the same
          // vertical room whether or not anybody read it -- and on this screen that room is the record.
          //
          // ⚠ THE COUNT STAYS ON THE CLOSED LINE. Collapsing to "Before you close this encounter" alone
          // would hide how many notes there are, and that is exactly what somebody decides on before
          // opening it. Four outstanding and one are different situations.
          //
          // ⚠ AND "NOTES, NOT GATES" STAYS INSIDE RATHER THAN BEING DROPPED. It is the sentence that
          // stops a practitioner typing a diagnosis they do not hold in order to get out of the screen,
          // which is the whole argument of the comment above this block.
          <Advisory tone="warn" summary="Before you close this encounter" count={props.warnings.length}>
            <ul className="flex flex-col gap-0.5">
              {props.warnings.map(w => (
                <li key={w.key} className="text-[11px] text-gray-700">· {w.text}</li>
              ))}
            </ul>
            <p className="mt-1.5 text-[10px] text-gray-500">
              These are notes, not gates. You can close this encounter without acting on any of them.
            </p>
          </Advisory>
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
          {/* ══ CPR-MOB-001 s5's TAB ROW ══════════════════════════════════════════════════════════
              s5 offers two mobile renderings for a tab bar: "scrollable short tabs OR section
              selector/dropdown for large tab sets". EIGHT tabs is a large set by SectionTabs' own
              threshold of five — and the strip is kept anyway, because these eight labels are one word
              each (Overview, Diagnoses, Treatment, Procedures, Investigations, Follow-up, Attachments,
              Notes) and s5's first branch is written for exactly that. A <select> would hide seven
              destinations behind a tap and cost the practitioner the one thing this strip gives them
              for free: seeing that the other seven exist. The strip scrolls inside its own box, which
              is not the workflow-level horizontal scroll s4 forbids.

              ⚠ SectionTabs THE PRIMITIVE WAS NOT ADOPTED, for the reason 4b rejected it twice: it owns
              BOTH faces, so adopting it here replaces the desktop nav — losing `aria-current="page"`
              for `aria-pressed`, and putting the frozen desktop tab row inside a component that this
              screen does not control. s10 permits layout to adapt, not the desktop rendering to change.

              The buttons take s4's 44px floor below md; py-2.5 at 12px was about 38px. */}
          <nav ref={tabStrip} aria-label="Encounter sections" className="flex gap-0.5 overflow-x-auto border-b border-gray-100 px-2">
            {ENCOUNTER_TABS.map(([key, label]) => (
              <button key={key} type="button" onClick={() => setTab(key)}
                aria-current={tab === key ? "page" : undefined}
                className={`shrink-0 border-b-2 px-3 py-2.5 text-[12px] font-semibold transition-colors max-md:min-h-[var(--cp-touch)] max-md:text-[13px] ${
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
                      <div className="flex items-center justify-between gap-2">
                        <h3 className="text-[12.5px] font-bold text-gray-900">Referrals</h3>
                        {/* CPR-DOC-AUTO-001 s7's purpose-driven entry point. The blank-body document
                            form on the Documents tab is untouched and still the way to write anything
                            this does not anticipate (s19). */}
                        {editable && (
                          <button type="button" onClick={() => setLetterFor({ purpose: "referral_letter", referralId: null, reason: "" })}
                            className="text-[11px] font-semibold text-[var(--cp-primary-deep)] hover:underline">
                            Write referral letter
                          </button>
                        )}
                      </div>
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
                                {/* Writes the letter FOR this referral rather than recording a second
                                    one. Not gated on `editable`: the referral is already made, and a
                                    letter about it is a document with its own lifecycle. */}
                                <button type="button" onClick={() => setLetterFor({ purpose: "referral_letter", referralId: r.id, reason: r.reason })}
                                  className="mt-0.5 text-[11px] font-semibold text-[var(--cp-primary-deep)] hover:underline">
                                  Write letter
                                </button>
                                {editable && (
                                  <div className="mt-1 flex flex-wrap gap-1">
                                    {REFERRAL_STATUSES.filter(([s]) => s !== r.status).map(([s, label]) => (
                                      <button key={s} type="button" disabled={busy} onClick={() => setReferralStatus(r.id, s)}
                                        className={`rounded border border-gray-200 px-1.5 py-0.5 text-[10px] font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-50 ${TOUCH}`}>
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
                              {/* HFE s11's compact summary: subject leads, then action - due -
                                  priority as supporting metadata, never a replay of the form. */}
                              <span className={`ml-1.5 text-[11px] ${f.overdue ? "font-bold text-[var(--cmp-text-critical)]" : "text-gray-500"}`}>
                                {[
                                  FOLLOW_UP_TYPE_LABELS[f.follow_up_type] ?? null,
                                  f.overdue ? `${Math.abs(f.dueInDays)} days overdue` : `due ${f.due_on}`,
                                  f.priority !== "routine" ? f.priority : null,
                                ].filter(Boolean).join(" · ")}
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
            {/* ⚠ CP-ENC-DIAG-001 s1: THE SINGLE-DIAGNOSIS FORM IS REPLACED BY A WORKING SET. The old
                markup below is deleted rather than left behind a flag -- two capture paths for one
                clinical record is how a field comes to be written by whichever one somebody happened to
                reach, and this file already carries a warning about a form removed while its capture
                path was kept. The write goes through recordDiagnosisBatch, whose s2 problem-list rules
                are guarded by live break-tested fixtures (13a-8, 13a-9). */}
            {tab === "diagnoses" && (
              <DiagnosisWorkspace
                encounterId={props.encounterId}
                recorded={props.diagnoses}
                editable={editable}
                canDiagnose={props.canDiagnose}
              />
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
            {/* ⚠ CP-ENC-PROC-001 s1: the one-at-a-time form becomes a working set. BOTH writers moved
                across -- the procedure form AND outcome recording, the latter now a per-row action on
                an already-recorded procedure. Two earlier attempts at this swap each lost something
                (outcome recording, then three capture fields) and were reverted; 13a-1 and 13a-2 are
                what caught both. The batch is a loop over the SINGLE engine, so the sided-laterality
                rule stays in one place -- a second opinion there is a wrong-site record. */}
            {tab === "procedures" && (
              // ⚠ `procedureTypes` WAS DECLARED ON THIS COMPONENT AND USED NOWHERE. page.tsx loaded
              // the catalogue, passed it here, and it stopped -- so the Procedures tab was a free-text
              // box that never sent `procedure_type_id`, and the server's sided/consent rules read a
              // null type and passed everything. Nothing errored: an unused prop is not a compile
              // failure, and the tab worked. It simply enforced nothing.
              <ProcedureWorkspace
                encounterId={props.encounterId}
                recorded={props.procedures}
                editable={editable}
                canRecord={props.canProcedure}
                catalogue={props.procedureTypes ?? []}
                frequent={props.frequentProcedures}
              />
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
                {/* ══ BAND 1 (s4, s5): IS ANYTHING OWED? ════════════════════════════════════════════
                    s3's first HFE goal, answered before the table rather than by counting its rows.
                    ⚠ THE TONE IS DERIVED, NOT CHOSEN HERE. s5: "do not use a success colour if an
                    overdue or urgent item exists", and green on this card means "you owe this patient
                    nothing" -- the most consequential sentence on the tab. followUpSummary decides it
                    so the rule is testable, and so a fourth caller cannot reach a different verdict. */}
                {(() => {
                  const sum = followUpSummary(props.followUps as any[],
                    { unavailable: props.followUpsUnavailable });
                  const tone = {
                    clear: "border-emerald-200 bg-[var(--cmp-surface-success)] text-[var(--cmp-text-success)]",
                    open: "border-slate-200 bg-slate-50 text-gray-700",
                    attention: "border-amber-300 bg-[var(--cmp-surface-warning)] text-[var(--cmp-text-warning)]",
                    overdue: "border-rose-300 bg-[var(--cmp-surface-critical)] text-[var(--cmp-text-critical)]",
                  }[sum.tone];
                  return (
                    <div className={`rounded-xl border p-3 ${tone}`}>
                      <p className="text-[13px] font-bold">
                        {/* s16: colour is never the sole carrier -- the glyph and the words both say it. */}
                        <span aria-hidden="true" className="mr-1.5">
                          {sum.tone === "clear" ? "✓" : sum.tone === "overdue" ? "⚠" : sum.tone === "attention" ? "⚠" : "•"}
                        </span>
                        {sum.headline}
                      </p>
                      <p className="mt-0.5 text-[11.5px] opacity-90">{sum.detail}</p>
                    </div>
                  );
                })()}

                {/* ══ BAND 3 (s4, s12): THE OPEN LIST ═══════════════════════════════════════════════
                    ⚠ OVERDUE IS THE FIRST REAL `warning` IN THIS SYSTEM, and s5 permits exactly that:
                    "overdue/due-soon states may override ordinary banding with appropriate emphasis".
                    An overdue follow-up is something a person must act on, which is s4's test for the
                    state. DUE-SOON IS NOT PAINTED -- it is a date approaching, not a failure, and
                    spending the alert colour on it would leave nothing louder for the one that is
                    actually late. The count of warnings on this screen should equal the count of
                    things going wrong. */}
                {props.followUps.length > 0 && (
                  // ⚠ s12's FILTERS, GROUPED BY AXIS. s8: "priority and status are separate concepts",
                  // and s12's own list mixes them -- Soon and Urgent are what somebody SET, Overdue and
                  // Booked are what the date and the lifecycle DECIDED. One undifferentiated row would
                  // read as a single scale, which is the confusion s8 exists to prevent.
                  //
                  // ⚠ AND EVERY CHIP CARRIES THE COUNT FROM THE SAME PREDICATE THAT FILTERS THE LIST.
                  // FOLLOW_UP_VIEWS' header records what happened when those were two functions: the
                  // tile said 14 and the list showed 9, and nothing in the code looked wrong.
                  <div className="mt-3 flex flex-wrap items-center gap-1.5">
                    {(["state", "priority"] as const).map(axis => (
                      <span key={axis} className="flex flex-wrap items-center gap-1.5">
                        <span className="text-[10.5px] font-semibold uppercase tracking-wide text-gray-500">
                          {axis === "state" ? "Show" : "Priority"}
                        </span>
                        {FOLLOW_UP_TAB_FILTERS.filter(x => x.axis === axis).map(x => {
                          const n = (props.followUps as any[]).filter(f => x.match(f)).length;
                          const on = fuFilter === x.key;
                          return (
                            <button key={x.key} type="button"
                              onClick={() => setFuFilter(on && x.key !== "all" ? "all" : x.key)}
                              aria-pressed={on}
                              // s11's status filters stay CHIPS rather than becoming a FilterSheet —
                              // there are only a handful, they apply on press with no Apply step, and
                              // the count each one carries is the thing worth seeing without opening
                              // anything. TOUCH is all they needed.
                              className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${TOUCH} ${on
                                ? "border-[var(--cp-primary)] bg-[var(--cp-primary)]/10 text-[var(--cp-primary-deep)]"
                                : "border-gray-200 bg-white text-gray-700 hover:border-[var(--cp-primary)]/50"}`}>
                              {x.label} <span className="font-normal text-gray-500">{n}</span>
                            </button>
                          );
                        })}
                      </span>
                    ))}
                  </div>
                )}

                <div className={`${BAND_RECORD} mt-2 overflow-hidden p-3`}>
                <ClinicalRecordTable
                  label="Follow-ups owed by this patient"
                  columns={FOLLOW_UP_COLUMNS}
                  empty={
                    // Three states, not two: this is the READ-SUCCEEDED one, and it says so.
                    // ⚠ AND IT DISTINGUISHES "NOTHING OWED" FROM "NOTHING MATCHES THIS FILTER". A filter
                    // that empties the table must not print the sentence that means the patient is clear.
                    fuFilter === "all"
                      ? <EmptyState title="Nothing is owed to this patient"
                        reason="No follow-up is open. This was read successfully -- raise one below if something should happen after today." />
                      : <EmptyState title="Nothing matches this filter"
                        reason="Other follow-ups are still owed. Choose All to see them." />
                  }
                  records={(props.followUps as any[])
                    .filter(f => (FOLLOW_UP_TAB_FILTERS.find(x => x.key === fuFilter) ?? FOLLOW_UP_TAB_FILTERS[0]).match(f))
                    .map((f: any) => ({ ...f, __viewer: props.currentUserId }))
                    .map((f: any) => ({
                    id: f.id,
                    data: f,
                    state: (f.overdue ? "warning" : "normal") as RowState,
                    // s10: never colour alone. The row says "overdue" in words as well.
                    stateLabel: f.overdue ? "Overdue" : undefined,
                    actions: props.canFollowUp ? (
                      <span className="inline-flex items-center gap-1.5">
                        {/* ══ s10's BOOKING LINK -- THE FIRST UI CALLER scheduleFollowUp HAS EVER HAD ══
                            The engine has existed since migration 196: it refuses a dead appointment, one
                            belonging to another patient, and a second follow-up against the same booking.
                            Nothing in the product could reach it -- booking a visit for an obligation was
                            an API-only operation.

                            ⚠ IT LINKS AN EXISTING APPOINTMENT AND DOES NOT CREATE ONE, DELIBERATELY. The
                            obvious build is book-then-link: POST an appointment, take its id, PATCH the
                            follow-up. That is two writes with no transaction between them, and if the
                            second fails you have an appointment nobody asked for attached to nothing,
                            with no compensating path anywhere in either engine. Linking is ONE write that
                            either happens or does not.

                            ⚠ AND IT SAYS "booked, not settled" BECAUSE s13 AND s22 INSIST ON IT. Booking
                            is never clinical completion; the row stays owed and moves to SCHEDULED. */}
                        {props.canBook && f.status === "OPEN" && !f.appointment_id
                          && props.patientAppointments.length > 0 && (
                          <button type="button" disabled={busy}
                            onClick={() => setBookingFu(bookingFu === f.id ? null : f.id)}
                            aria-label={`Link a booked visit to ${f.reason}`}
                            className={`rounded border border-gray-200 px-2 py-0.5 text-[11px] font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-50 ${TOUCH}`}>
                            {bookingFu === f.id ? "Cancel" : "Link a visit"}
                          </button>
                        )}
                        <button type="button" disabled={busy}
                          onClick={() => { setFuOutcome(""); setClosingFu(closingFu === f.id ? null : f.id); }}
                          aria-label={`Settle ${f.reason} in this consultation`}
                          className={`rounded border border-gray-200 px-2 py-0.5 text-[11px] font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-50 ${TOUCH}`}>
                          Settle in this consultation
                        </button>
                      </span>
                    ) : undefined,
                    expandedContent: closingFu === f.id ? (
                      <form className="flex flex-col gap-1.5 rounded-lg bg-gray-50 p-2"
                        onSubmit={e => { e.preventDefault(); closeFollowUp(f.id); }}>
                        <input autoFocus placeholder="What happened? (optional — this encounter is recorded as the closer)"
                          aria-label={`Outcome for ${f.reason}`}
                          value={fuOutcome} onChange={e => setFuOutcome(e.target.value)} className={input} />
                        <button type="submit" disabled={busy}
                          className="self-start rounded-lg bg-[var(--cp-primary)] px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-[var(--cp-primary-deep)] disabled:opacity-50">
                          Close as done
                        </button>
                      </form>
                    ) : bookingFu === f.id ? (
                      <div className="flex flex-col gap-1.5 rounded-lg bg-gray-50 p-2">
                        <p className="text-[11px] font-semibold text-gray-700">
                          Which booked visit is this follow-up for?
                        </p>
                        <div className="flex flex-wrap gap-1.5">
                          {props.patientAppointments.map((a: any) => (
                            <button key={a.id} type="button" disabled={busy}
                              onClick={() => linkVisit(f.id, a.id)}
                              className={`rounded-lg border border-gray-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-gray-700 hover:border-[var(--cp-primary)] hover:bg-[var(--cp-primary)]/[0.07] disabled:opacity-50 ${TOUCH}`}>
                              {formatDayTime(a.scheduled_at, props.timezone) ?? String(a.scheduled_at).slice(0, 16)}
                              <span className="ml-1 font-normal text-gray-500">
                                {String(a.appointment_type ?? "").replace(/_/g, " ")}
                              </span>
                            </button>
                          ))}
                        </div>
                        {/* ⚠ s13, ON THE CONTROL ITSELF. The whole point of this link is that it is NOT a
                            completion, and the moment somebody presses it the row will read SCHEDULED. */}
                        <p className="text-[11px] text-gray-600">
                          This records that a visit exists for this obligation. It does not settle it
                          &mdash; the follow-up stays owed until somebody says what happened. If the
                          appointment is later cancelled, the database puts this back on the board.
                        </p>
                      </div>
                    ) : undefined,
                  }))}
                />

                </div>

                {props.canFollowUp && (
                  /* ══ BAND 4 (s3, s4, s16): THE ACTIVE WORK ═════════════════════════════════════════
                     s3's consistency goal names it: "reuse the lavender active-work band and semantic
                     colours used in other encounter tabs". This composer was a bare two-column grid
                     sitting on the same surface as the table above it -- the only capture form in the
                     product with no band, on the fourth tab to be given one. */
                  <form className={`${BAND_WORK} mt-3 p-4`} onSubmit={e => { e.preventDefault(); raiseFollowUp(); }}>
                    <h4 className="text-[13px] font-bold text-gray-900">Add follow-up</h4>
                    {/* ══ CPR-MOB-001 s10, AND THE HALF OF THE ROW THAT SAYS "UNLESS" ═══════════════
                        "Avoid side-by-side dense form fields on narrow screens UNLESS TWO SHORT FIELDS
                        CLEARLY FIT." Two pairs are left paired on purpose, and it is a judgement about
                        these particular controls rather than a shortcut:

                          Due + Priority     — the intervals are "1 week", "2 weeks", "On a date…";
                                               the priorities are Routine, Soon, Urgent. At 360px each
                                               column is about 160px, which fits every one of them.
                          Visit date + Visit time — "2026-08-31" and "14:30". The time is the 24-hour
                                               TEXT input (walkthrough #19: the native picker follows
                                               the OS locale and drew "11:00 AM" here), and five
                                               characters do not need a row of their own.

                        Everything with an arbitrary-length option list, a nested field or a sentence
                        underneath spans both columns below md — marked field by field.

                        ⚠ THE FROZEN SEQUENCE IS UNTOUCHED. FUP-002's order — subject, due, priority,
                        action, location, owner, book-visit, category, instructions — is the DOM order
                        and stays the DOM order at every width. No CSS `order` utility appears anywhere
                        in this work: reordering a clinical form by breakpoint would make the tab
                        sequence and the reading sequence disagree (s17), and the sequence is frozen. */}
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      {/* ⚠ s6 MARKS THE REQUIRED FIELDS AND s3 ASKS FOR VISIBLE LABELS. These three
                          selects carried an aria-label and nothing a sighted user could read, so the
                          only cue for what a dropdown meant was the value it happened to be showing. */}
                      <div className="col-span-2">
                        {/* HFE s5: the SUBJECT, not an instruction sentence -- "identifies the
                            subject/object of the obligation". The old "What needs to happen, and
                            why?" label invited composing prose that duplicated every structured
                            field below it (HFE s2), and its removal is acceptance criterion one. */}
                        <label className={FU_LABEL} htmlFor="fu-reason">Follow-up for{REQ}</label>
                        {/* ⚠ AMBER WHILE EMPTY, exactly as every other required field on this
                            encounter. The owner pressed Raise twice with this blank and read the
                            silence as the product being broken -- the sentence by the button was not
                            enough, because the eye is ON THE FORM, not on the footer. The blocker has
                            to be worn by the field that is the blocker. */}
                        <input id="fu-reason" required
                          placeholder="e.g. Treatment response, Histology result, Post-operative wound"
                          value={fu.reason}
                          onChange={e => setFu(p => ({ ...p, reason: e.target.value }))}
                          className={`${input} mt-1 ${fu.reason.trim() ? "" : "border-amber-300 bg-[var(--cmp-surface-warning)]"}`} />
                      </div>
                      <div>
                        <label className={FU_LABEL} htmlFor="fu-when">Due{REQ}</label>
                        {/* ⚠ THE OWNER ASKED FOR A CALENDAR IN AS MANY WORDS. s9 always allowed both --
                            "support relative intervals and configured exact dates" -- and the composer
                            only ever offered the intervals. "On a date..." reveals the calendar; the
                            intervals stay, because "in two weeks" is how follow-up is actually spoken
                            in a consultation and a date-only control would make the common case type. */}
                        {/* ⚠ "On a date..." is FIRST, not last. It lived below eight intervals and the
                            owner reported the calendar as LOST -- the bottom of a long native select
                            is below the fold, and an option nobody can see is an option that does not
                            exist (walkthrough 2026-08-16 #6). */}
                        <select id="fu-when" aria-label="When" value={fu.intervalCode}
                          onChange={e => setFu(p => ({ ...p, intervalCode: e.target.value }))} className={`${input} mt-1`}>
                          <option value="custom">On a date…</option>
                          {props.intervals.map(i => <option key={i.code} value={i.code}>{i.label}</option>)}
                        </select>
                        {fu.intervalCode === "custom" ? (
                          <input type="date" aria-label="Follow-up date" value={fu.dueDate}
                            onChange={e => setFu(p => ({ ...p, dueDate: e.target.value }))}
                            className={`${input} mt-1 ${fu.dueDate ? "" : "border-amber-300 bg-[var(--cmp-surface-warning)]"}`} />
                        ) : (() => {
                          const days = props.intervals.find(i => i.code === fu.intervalCode)?.days;
                          if (days === undefined) return null;
                          const d = new Date();
                          d.setDate(d.getDate() + days);
                          return (
                            <p className="mt-1 text-[11px] text-gray-600">
                              {d.toISOString().slice(0, 10)}
                            </p>
                          );
                        })()}
                      </div>
                      <div>
                        <label className={FU_LABEL} htmlFor="fu-priority">Priority{REQ}</label>
                        {/* ⚠ THE OPTIONS USED TO RENDER RAW CODES -- "routine", "soon", "urgent" in
                            lower case, straight out of the constant, unlike every other select on this
                            screen. s8 gives priority a visual treatment and a meaning; the least it can
                            have is a capital letter. */}
                        <select id="fu-priority" aria-label="Priority" value={fu.priority}
                          onChange={e => setFu(p => ({ ...p, priority: e.target.value }))} className={`${input} mt-1`}>
                          {FOLLOW_UP_PRIORITIES.map(p => (
                            <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>
                          ))}
                        </select>
                      </div>
                      {/* ── THE ACTION, from the nine-value controlled list (taxonomy s3, HFE s4) ────
                          ⚠ STARTS EMPTY AND IS REQUIRED. s10 gates Raise on it, and s9 forbids
                          auto-selecting Other -- a silent default would file every uninspected
                          follow-up under one action code. Booking is no longer a "type": s11 makes
                          the visit an explicit separate choice, below. Choosing an action also FILES
                          THE CATEGORY (HFE s7's deterministic inference) unless a human already
                          chose one under More details. */}
                      {/* ⚠ CPR-MOB-001 s10 — FULL WIDTH BELOW md, AND `max-md:col-span-2` RATHER THAN
                          A ONE-COLUMN GRID. The container stays `grid-cols-2` at every width and the
                          fields that do not fit span BOTH columns; switching the container to
                          `grid-cols-1` would leave the four existing `col-span-2` children spanning a
                          column that no longer exists, and CSS answers that by inventing an implicit
                          one — a silently broken form on the narrowest screen, which is the one nobody
                          would be looking at. Spanning both of two is the same result with no implicit
                          track. The action's nine labels ("Review clinical progress", "Check
                          investigation result") are unreadable in half of a 360px card, and it is a
                          REQUIRED field wearing an amber wash: the one that must not be guessed at. */}
                      <div className="max-md:col-span-2">
                        <label className={FU_LABEL} htmlFor="fu-type">Action{REQ}</label>
                        <select id="fu-type" value={fu.followUpType}
                          onChange={e => {
                            const followUpType = e.target.value;
                            setFu(p => ({
                              ...p, followUpType,
                              kind: p.categoryTouched ? p.kind
                                : (FOLLOW_UP_ACTION_CATEGORY[followUpType] ?? p.kind),
                            }));
                          }}
                          className={`${input} mt-1 ${fu.followUpType ? "" : "border-amber-300 bg-[var(--cmp-surface-warning)]"}`}>
                          <option value="">Choose the action…</option>
                          {FOLLOW_UP_ACTION_TYPES.map(([t, l]) => (
                            <option key={t} value={t}>{l}</option>
                          ))}
                        </select>
                      </div>
                      {/* WHERE the obligation is expected to be discharged. This used to hide for a
                          one-site practice ("nothing to choose between") and the owner asked for it
                          by name (walkthrough 2026-08-16): even with one site, site-vs-not-specified
                          is a real choice, so it draws whenever any facility exists. */}
                      {props.facilities.length >= 1 && (
                        // s10: full width below md — facility names are arbitrary length, and the
                        // place-for-day sentence underneath is a whole clause.
                        <div className="max-md:col-span-2">
                          <label className={FU_LABEL} htmlFor="fu-location">Location</label>
                          <select id="fu-location" value={fu.locationId}
                            onChange={e => setFu(p => ({ ...p, locationId: e.target.value, locationTouched: true }))}
                            className={`${input} mt-1`}>
                            <option value="">Not specified</option>
                            {props.facilities.map((x: any) => (
                              <option key={x.id} value={x.id}>{x.name}</option>
                            ))}
                          </select>
                          {/* #6: what the calendar says about the target day -- printed even when no
                              facility row matches the location's name, because knowing WHERE you are
                              that day is the useful part. */}
                          {fuPlace?.sentence && (
                            <p className="mt-1 text-[11px] text-gray-500">{fuPlace.sentence}</p>
                          )}
                        </div>
                      )}
                      {/* ⚠ s11's OWNER, AND THE VOCABULARY IS HONEST ABOUT WHAT THIS PRODUCT KNOWS.
                          There is no member directory in the practice plane, so "assign to a named
                          colleague" is not offerable -- a dropdown of uuids would be worse than none.
                          What IS offerable is the viewer themselves, or a named queue, and the database
                          refuses both at once because "whose is this" needs one answer. */}
                      {/* s10: full width below md — choosing "A team or queue" reveals a NESTED text
                          field directly under this select, and a text field in half a column is the
                          side-by-side density the row is written against. */}
                      <div className="max-md:col-span-2">
                        <label className={FU_LABEL} htmlFor="fu-owner">Assigned to{REQ}</label>
                        {/* HFE s4/s9: assignment is REQUIRED and defaults to Me -- an obligation
                            nobody owns is the board's oldest failure mode. Unassigned left this
                            select; the queue path still needs a name before Raise enables. */}
                        <select id="fu-owner" value={fu.owner}
                          onChange={e => setFu(p => ({ ...p, owner: e.target.value }))}
                          className={`${input} mt-1`}>
                          <option value="me">Me</option>
                          <option value="queue">A team or queue</option>
                        </select>
                        {fu.owner === "queue" && (
                          <input value={fu.queue} aria-label="Queue name"
                            onChange={e => setFu(p => ({ ...p, queue: e.target.value }))}
                            placeholder="Which team or queue"
                            className={`${input} mt-1 ${fu.queue.trim() ? "" : "border-amber-300 bg-[var(--cmp-surface-warning)]"}`} />
                        )}
                      </div>
                      {/* ── CPR-FUP-002 s11: BOOKING IS ITS OWN EXPLICIT CHOICE ────────────────────
                          Raising never books; this checkbox is the one-press Raise-and-book the owner
                          asked for, kept as an EXPLICIT act beside the obligation instead of a value
                          smuggled into the action taxonomy. The date prefills from the timeframe
                          already chosen -- on screen before the press, editable, never invented. */}
                      <div className="col-span-2">
                        <label className="flex items-center gap-2">
                          <input type="checkbox" checked={fu.bookVisit}
                            onChange={e => {
                              const bookVisit = e.target.checked;
                              setFu(p => {
                                const days = props.intervals.find(i => i.code === p.intervalCode)?.days;
                                const d = new Date();
                                if (days !== undefined) d.setDate(d.getDate() + days);
                                const fromDue = p.intervalCode === "custom" && p.dueDate
                                  ? p.dueDate : d.toISOString().slice(0, 10);
                                return { ...p, bookVisit, bookDate: bookVisit && !p.bookDate ? fromDue : p.bookDate };
                              });
                            }} />
                          <span className="text-[12px] text-gray-700">
                            Also book the visit in the same press. Booking never settles the obligation.
                          </span>
                        </label>
                      </div>
                      {fu.bookVisit && (
                        <>
                          <div>
                            <label className={FU_LABEL} htmlFor="fu-book-date">Visit date{REQ}</label>
                            <input id="fu-book-date" type="date" value={fu.bookDate}
                              onChange={e => setFu(p => ({ ...p, bookDate: e.target.value }))}
                              className={`${input} mt-1 ${fu.bookDate ? "" : "border-amber-300 bg-[var(--cmp-surface-warning)]"}`} />
                          </div>
                          <div>
                            <label className={FU_LABEL} htmlFor="fu-book-time">Visit time{REQ}</label>
                            {/* ⚠ TEXT, NOT type="time" -- the native picker follows the OS locale and
                                drew "11:00 AM" on this very panel (walkthrough #19's screenshot). The
                                owner's 24-hour decision is product-wide; the planner sweep (#1) missed
                                this input because the freeze pin only scans the calendar folder.
                                It is the SHARED TimeInput now (2026-08-17): the pattern, keypad,
                                tooltip and touch sizing come from one definition, and the amber
                                not-yet-valid tint tests HHMM_RE -- compiled from that same string --
                                instead of a seventh hand-typed copy of it. The date beside it stays
                                type="date" and the SERVER still composes the instant. */}
                            <TimeInput id="fu-book-time" value={fu.bookTime} required placeholder="14:30"
                              onChange={v => setFu(p => ({ ...p, bookTime: v }))}
                              className={`${input} mt-1 ${HHMM_RE.test(fu.bookTime) ? "" : "border-amber-300 bg-[var(--cmp-surface-warning)]"}`} />
                          </div>
                          {/* #15: WHERE the visit happens, on every booking surface. The empty choice
                              keeps the regular-week derivation; choosing covers the outside-hours
                              booking no location can be assumed for. */}
                          {props.bookingLocations.length > 0 && (
                            // s10: full width below md. "Decided by the regular week" is the resting
                            // option and it is the longest string in the control.
                            <div className="max-md:col-span-2">
                              <label className={FU_LABEL} htmlFor="fu-book-location">Visit location</label>
                              <select id="fu-book-location" value={fu.bookLocationId}
                                onChange={e => setFu(p => ({ ...p, bookLocationId: e.target.value }))}
                                className={`${input} mt-1`}>
                                <option value="">Decided by the regular week</option>
                                {props.bookingLocations.map(l => (
                                  <option key={l.id} value={l.id}>{l.name}</option>
                                ))}
                              </select>
                            </div>
                          )}
                        </>
                      )}
                      {/* ── HFE s7: CATEGORY, DEMOTED AND INFERRED ─────────────────────────────────
                          Filed automatically from the action, shown as a sentence, editable behind
                          one click. It is metadata for filtering and reports -- making it a second
                          prominent question was the duplication HFE s2 names. Stored independently
                          of the action either way (taxonomy s7). */}
                      <div className="col-span-2 text-[11px] text-gray-500">
                        {!fuMore ? (
                          <>
                            Category: <span className="font-semibold text-gray-600">
                              {(FOLLOW_UP_CATEGORIES.find(([k]) => k === fu.kind)?.[1]) ?? fu.kind}
                            </span>{fu.categoryTouched ? "" : " (from the action)"}{" "}
                            <button type="button" onClick={() => setFuMore(true)}
                              className="font-semibold text-[var(--cp-primary-deep)] hover:underline">
                              More details
                            </button>
                          </>
                        ) : (
                          <div className="max-w-xs">
                            <label className={FU_LABEL} htmlFor="fu-kind">Category</label>
                            <select id="fu-kind" aria-label="Category of follow-up" value={fu.kind}
                              onChange={e => setFu(p => ({ ...p, kind: e.target.value, categoryTouched: true }))}
                              className={`${input} mt-1`}>
                              {FOLLOW_UP_CATEGORIES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                            </select>
                            <p className="mt-0.5 text-[10px] text-gray-500">
                              Used for filtering and reports. Never decides urgency.
                            </p>
                          </div>
                        )}
                      </div>
                      <div className="col-span-2">
                        <label className={FU_LABEL} htmlFor="fu-instructions">Instructions (optional)</label>
                        {/* Separate from the reason, which migration 196 caps at 400 characters -- one
                            field for both is how a cap starts truncating clinical detail. HFE s4:
                            only information needed to COMPLETE the follow-up belongs here. */}
                        <input id="fu-instructions" value={fu.instructions}
                          onChange={e => setFu(p => ({ ...p, instructions: e.target.value }))}
                          placeholder="e.g. Check BP and ankle swelling."
                          className={`${input} mt-1`} />
                      </div>
                      {/* ── CPR-FUP-002 s10: DUPLICATE AWARENESS -- WARN, NEVER BLOCK ──────────────
                          A materially similar open obligation is one with the same action type. The
                          sentence names it and the button stays enabled: two real obligations of one
                          type is a legitimate state, and the practitioner is the one who knows. */}
                      {(() => {
                        const dup = fu.followUpType
                          ? (props.followUps as any[]).find(f =>
                            (f.status === "OPEN" || f.status === "SCHEDULED")
                              && f.follow_up_type === fu.followUpType)
                          : null;
                        return dup ? (
                          <p className="col-span-2 rounded-lg bg-[var(--cmp-surface-warning)] px-2.5 py-1.5 text-[11.5px] text-[var(--cmp-text-warning)]">
                            An open {FOLLOW_UP_TYPE_LABELS[fu.followUpType]?.toLowerCase() ?? fu.followUpType}{" "}
                            already exists for this patient (&ldquo;{dup.reason}&rdquo;, due {dup.due_on}).
                            Raise this one only if it is a separate obligation.
                          </p>
                        ) : null;
                      })()}
                      <div className="col-span-2 flex flex-wrap items-center justify-end gap-2">
                        {/* ⚠ A DISABLED BUTTON THAT CANNOT SAY WHY READS AS A BROKEN PRODUCT -- the
                            owner pressed exactly this one with the reason empty, got silence, and
                            reported the feature as not responding. The walkthrough recorded this class
                            on the Treatment tab; this is the same lesson, missed on a form built the
                            same day the rule was being applied two tabs away. The sentence names the
                            first missing thing, in order, because two amber warnings at once read as
                            noise. */}
                        {(!fu.reason.trim() || !fu.followUpType || (fu.owner === "queue" && !fu.queue.trim())
                          || (fu.intervalCode === "custom" && !fu.dueDate)
                          || (fu.bookVisit && (!fu.bookDate || !/^([01]?\d|2[0-3]):[0-5]\d$/.test(fu.bookTime)))) && (
                          <span className="text-[11.5px] text-[var(--cmp-text-warning)]">
                            {!fu.reason.trim() ? "Say what this follow-up is for."
                              : !fu.followUpType ? "Choose the action."
                                : fu.intervalCode === "custom" && !fu.dueDate ? "Pick the follow-up date."
                                  : fu.owner === "queue" && !fu.queue.trim() ? "Name the queue, or assign it differently."
                                    : fu.bookVisit && !fu.bookDate ? "Pick the visit date, or untick the booking."
                                      : "Give the visit time as 24-hour HH:MM -- for example 14:30."}
                          </span>
                        )}
                        <button type="submit"
                          disabled={busy || !fu.reason.trim() || !fu.followUpType
                            || (fu.owner === "queue" && !fu.queue.trim())
                            || (fu.intervalCode === "custom" && !fu.dueDate)
                            || (fu.bookVisit && (!fu.bookDate || !/^([01]?\d|2[0-3]):[0-5]\d$/.test(fu.bookTime)))}
                          className="rounded-lg bg-[var(--cp-primary)] px-4 py-2 text-[12.5px] font-semibold text-white hover:bg-[var(--cp-primary-deep)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cp-primary)] focus-visible:ring-offset-2 disabled:opacity-50">
                          {busy ? "Raising..."
                            : fu.bookVisit ? "Raise & book visit" : "Raise follow-up"}
                        </button>
                      </div>
                    </div>
                    {/* ══ s15's TEMPLATES, REACHABLE FOR THE FIRST TIME ═══════════════════════════
                        ⚠ DRAWN ONLY WHEN THIS PRACTICE HAS AUTHORED ONE. Migration 206 seeds nothing
                        and there is no authoring screen anywhere in the product, so for most practices
                        this list is empty -- and an always-empty menu is an affordance for nothing,
                        which is the trap this session already refused once on the Investigations tab.
                        The wiring is here so the moment a template exists it is one click away; what is
                        missing is the screen that creates one, and that is a separate build. */}
                    {props.planTemplates.length > 0 && (
                      <div className="mt-3 border-t border-[var(--cp-primary)]/20 pt-2.5">
                        <p className={FU_LABEL}>Or apply a plan</p>
                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                          {props.planTemplates.map((t: any) => (
                            <button key={t.id} type="button" disabled={busy}
                              onClick={() => applyPlan(t.id)}
                              className={`rounded-full border border-gray-300 bg-white px-2.5 py-1 text-[11.5px] font-semibold text-gray-700 hover:border-[var(--cp-primary)] hover:bg-[var(--cp-primary)]/[0.07] disabled:opacity-50 ${TOUCH}`}>
                              {t.title}
                              <span className="ml-1 font-normal text-gray-500">
                                {(t.steps ?? []).length} step{(t.steps ?? []).length === 1 ? "" : "s"}
                              </span>
                            </button>
                          ))}
                        </div>
                        {/* s15, in the same words the shortcut bands on the other tabs use. */}
                        <p className="mt-1.5 text-[11px] text-gray-600">
                          A plan raises several follow-ups at once, each its own obligation you can
                          remove. It is a workflow shortcut somebody in this practice wrote, not advice
                          about this patient.
                        </p>
                      </div>
                    )}

                    <div className="mt-2">
                      <Tip>
                        The intervals are arithmetic on today&apos;s date, not clinical guidance. Once
                        raised, this appears on the follow-up board and becomes overdue on its own if
                        nothing is booked.
                        {" "}⚠ {fu.followUpType === "appointment"
                          ? "Raise & book creates the visit and links it. Booking does not settle the obligation — it stays owed until somebody says what happened."
                          : "Raising a follow-up does not book an appointment, and booking one does not settle the obligation."}
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
                  {/* CP-UI-TABLE-001 s13 step 7, s5's columns: Document | Type | Date | Source. */}
                  <ClinicalRecordTable
                    label="Documents drafted from this consultation"
                    columns={DOCUMENT_COLUMNS}
                    empty={
                      // The read-succeeded empty state, said as such rather than left as a grey line
                      // that could equally mean the documents could not be read.
                      <EmptyState title="Nothing has been drafted from this consultation"
                        reason="No document has been created here yet. This was read successfully -- draft one below if something needs to be issued." />
                    }
                    records={props.documents.map((d: any) => ({
                      id: d.id,
                      data: d,
                      actions: (
                        <Link href={`/practice/documents/${d.id}`}
                          aria-label={`Open ${d.title}`}
                          className="text-[11.5px] font-semibold text-[var(--cp-primary)] hover:underline">
                          Open &rsaquo;
                        </Link>
                      ),
                    }))}
                  />

                  {/* ── CPR-DOC-AUTO-001 s7: PURPOSE-DRIVEN ENTRY POINTS, ABOVE THE BLANK FORM ──────
                      s7's complaint is that writing a document here means "Title + type dropdown +
                      blank body" -- naming a document the product could name, and authoring prose the
                      product could compose. These three ask for the decision and compose the rest.

                      The blank form is still directly below, because s19 requires manual authoring to
                      stay available. What changed is which one a practitioner meets first. */}
                  {props.canDocument && (
                    <div className="mt-3 rounded-lg border border-gray-100 bg-gray-50/60 p-2.5">
                      <p className="text-[11px] font-bold uppercase tracking-wide text-gray-400">Create from the record</p>
                      <p className="mt-0.5 text-[11px] leading-relaxed text-gray-500">
                        Composed from what is recorded at this consultation. Each creates a draft you review
                        before anything is signed.
                      </p>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {/* s3 mode A, "one-click / review": CP already holds the facts, so this asks
                            nothing and lands on the draft. */}
                        <button type="button" disabled={busy || makingSummary} onClick={createVisitSummary}
                          className={`min-h-[var(--cp-touch)] ${QUIET_BTN}`}>
                          {makingSummary ? "Creating…" : "Visit summary"}
                        </button>
                        <button type="button" disabled={busy}
                          onClick={() => setLetterFor({ purpose: "patient_instructions", referralId: null, reason: "" })}
                          className={`min-h-[var(--cp-touch)] ${QUIET_BTN}`}>
                          Patient instructions
                        </button>
                        <button type="button" disabled={busy}
                          onClick={() => setLetterFor({ purpose: "referral_letter", referralId: null, reason: "" })}
                          className={`min-h-[var(--cp-touch)] ${QUIET_BTN}`}>
                          Referral letter
                        </button>
                      </div>
                    </div>
                  )}

                  {props.canDocument && (
                    <p className="mt-3 text-[11px] font-bold uppercase tracking-wide text-gray-400">
                      Or write one from scratch
                    </p>
                  )}
                  {props.canDocument && (
                    <form className="mt-1 grid grid-cols-2 gap-2" onSubmit={e => { e.preventDefault(); createDocument(); }}>
                      {/* ⚠ CPR-MOB-001 s16: "ALL FORM CONTROLS REQUIRE VISIBLE LABELS; PLACEHOLDERS ARE
                          NOT SUBSTITUTES." Two of these three controls were labelled by placeholder
                          alone, which is a label that disappears the moment somebody types into it —
                          on a phone, where the field and the keyboard are the whole screen, that leaves
                          a half-filled form of unnamed boxes. The labels are `md:hidden` and tied by
                          htmlFor, so the desktop form is exactly as it was; the placeholders stay, both
                          because they are useful examples and because they are what the field inventory
                          pins. The select already carries an aria-label and gains the visible twin. */}
                      <label htmlFor="doc-title" className="col-span-2 -mb-1 block text-[11px] font-semibold text-gray-600 md:hidden">
                        Title
                      </label>
                      <input id="doc-title" required placeholder="Title" value={doc.title} onChange={e => setDoc(p => ({ ...p, title: e.target.value }))} className={`${input} col-span-2`} />
                      {/* s10: both span the full width below md — the document types are phrases
                          ("Consultation summary", "Referral letter", "Fit note") and the addressee is
                          a person's or a service's name. Neither is one of s10's "two short fields". */}
                      <label htmlFor="doc-type" className="col-span-2 -mb-1 block text-[11px] font-semibold text-gray-600 md:hidden">
                        Document type
                      </label>
                      <select id="doc-type" aria-label="Document type" value={doc.docType} onChange={e => setDoc(p => ({ ...p, docType: e.target.value }))} className={`${input} max-md:col-span-2`}>
                        {DOC_TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                      </select>
                      <label htmlFor="doc-addressed" className="col-span-2 -mb-1 block text-[11px] font-semibold text-gray-600 md:hidden">
                        Addressed to (optional)
                      </label>
                      <input id="doc-addressed" placeholder="Addressed to (optional)" value={doc.addressedTo} onChange={e => setDoc(p => ({ ...p, addressedTo: e.target.value }))} className={`${input} max-md:col-span-2`} />
                      <label className="col-span-2 flex items-center gap-2 text-[12px] text-gray-600 max-md:min-h-[var(--cp-touch)] max-md:text-[13px]">
                        <input type="checkbox" checked={doc.composeFrom} onChange={e => setDoc(p => ({ ...p, composeFrom: e.target.checked }))}
                          className="max-md:h-5 max-md:w-5" />
                        Start from what is recorded in this consultation
                      </label>
                      <button type="submit" disabled={busy || !doc.title.trim()}
                        className="col-span-2 rounded-lg border border-gray-200 py-2 text-[12px] font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50 max-md:min-h-[var(--cp-touch-primary)] max-md:text-[14px]">
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

                {/* ⚠ CPR-ATT-HFE-009 s4: THE FILES ARE THE TAB, so they are drawn here rather than
                    left inside a collapsed chip in Documentation tools. "Immediately answer: what files
                    belong to this encounter?" was answered by a closed accordion beside clinical
                    calculators, on the tab named after them. */}
                <EncounterAttachments
                  timezone={props.timezone}
                  encounterId={props.encounterId}
                  patientId={props.patientId}
                  attachments={props.attachments}
                  editable={editable}
                  // ATT-009 s12: only THIS encounter's procedures are offered, the same filter the
                  // Procedures tab itself applies to this patient-scoped list.
                  procedures={props.procedures
                    .filter((p: any) => p.encounter_id === props.encounterId)
                    .map((p: any) => ({ id: p.id, label: p.label }))}
                />

                <DocumentationTools
                  editable={editable}
                  segments={NOTE_TYPES}
                  phrases={props.phrases}
                  onInsert={insertIntoSegment}
                />
              </div>
            )}

            {/* ══ NOTES ═════════════════════════════════════════════════════════════════════════ */}
            {tab === "notes" && (
              // ══ CPR-NOTE-HFE-010: THE CALMEST TAB ON THE ENCOUNTER ═══════════════════════════════
              //
              // s3: Notes is a WRITING workspace, not a structured-recording one -- orient, choose
              // structure if needed, write or dictate, autosave, review. The grammar below follows
              // that: a quiet header with the save state, the S/O/A/P/N navigator, then the sections.
              //
              // ⚠ s10 ASKED FOR THE PER-SECTION SAVE BUTTONS TO GO, AND THEY STAY. This is the one
              // deliberate departure, and the reason is already written into this file's header: an
              // autosave that wrote to the RECORD mid-sentence would put half-thoughts into a clinical
              // note and make "what did I actually save" unanswerable. What s10 actually wants is met
              // the two-layer way migration 207 built: the DRAFT autosaves continuously (nothing is
              // lost, and the status line now says so trustworthily, with s10's failure state), and
              // writing to the RECORD stays a deliberate act -- per section, or all changed sections in
              // one press, so nobody has to remember five buttons. What is refused is only the claim
              // that unsaved thought and the clinical record are the same thing.
              <section className={PANEL}>
                <SectionHeader
                  title="Clinical note"
                  subtitle="Optional structured documentation for this encounter."
                />
                <div className="p-4">
                {!editable && (
                  // ⚠ THE REASON, NOT JUST THE STATE. "Read-only" alone leaves somebody hunting for a
                  // permission they already hold, or waiting for an encounter that is already closed.
                  <p className="mb-2 rounded-lg bg-gray-50 px-3 py-2 text-[11.5px] text-gray-600">
                    {locked ? "Read-only: this encounter is closed." : "Read-only: you do not hold encounter.edit in this workspace."}
                  </p>
                )}

                {editable && (
                  <div className="flex flex-wrap items-center gap-2">
                    {/* ── s10's SAVE STATE, WORN HONESTLY ─────────────────────────────────────────
                        Three states, none of them a lie: the draft failing says so with a Retry, a
                        kept draft says it is NOT the record, and "saved" appears only per section
                        after a real write. There is no note-level "Saved" chip at all, because five
                        segments do not have one save state between them. */}
                    {draftFailed ? (
                      <span className="flex items-center gap-1.5 text-[11.5px] font-semibold text-[var(--cmp-text-critical)]" role="status">
                        Draft not saved
                        <button type="button" onClick={() => void flushDrafts()}
                          className={`rounded border border-[var(--cmp-color-critical)] px-1.5 py-0.5 text-[10.5px] hover:bg-[var(--cmp-surface-critical)] ${TOUCH}`}>
                          Retry
                        </button>
                      </span>
                    ) : (
                      <span className="text-[11.5px] text-gray-500" role="status">
                        {Object.values(draftAt).length > 0
                          ? `Draft kept ${Object.values(draftAt).sort().slice(-1)[0]} — not in the record until saved.`
                          : "Drafts are kept automatically as you write."}
                      </span>
                    )}
                    <span className="ml-auto flex items-center gap-2">
                      {/* s12: the template control is COMPACT until wanted. It stood permanently open. */}
                      {props.templates.length > 0 && (
                        <button type="button" onClick={() => setTemplateOpen(o => !o)}
                          aria-expanded={templateOpen}
                          className="rounded-lg border border-gray-200 px-2.5 py-1.5 text-[11.5px] font-semibold text-gray-700 hover:bg-gray-50">
                          Template {templateOpen ? "▴" : "▾"}
                        </button>
                      )}
                      {/* ⚠ s10's REAL COMPLAINT ANSWERED: nobody has to REMEMBER five saves. One press
                          writes every touched section to the record, in order, through the same
                          saveNote the per-section buttons use -- one rulebook, two doors. */}
                      <button type="button"
                        disabled={busy || !NOTE_TYPES.some(t => saved[t] === false)}
                        onClick={async () => { for (const t of NOTE_TYPES) if (saved[t] === false) await saveNote(t); }}
                        className="rounded-lg bg-[var(--cp-primary)] px-3 py-1.5 text-[11.5px] font-semibold text-white hover:bg-[var(--cp-primary-deep)] disabled:opacity-50">
                        Save all changed
                      </button>
                    </span>
                  </div>
                )}

                {editable && templateOpen && props.templates.length > 0 && (
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

                {/* ── s6's S/O/A/P/N NAVIGATOR ─────────────────────────────────────────────────────
                    ⚠ ✓ MEANS "CONTAINS TEXT" AND NOTHING MORE. s6 is emphatic that the indicator must
                    never be read as clinical completeness -- an empty Assessment on a dressing change
                    is not an incomplete note -- so the accessible name says "contains text" in words
                    and the strip carries no colour that could read as pass or fail. */}
                <nav aria-label="Note sections"
                  className="sticky top-0 z-10 mt-2 flex flex-wrap gap-1 rounded-lg bg-white/95 py-1 backdrop-blur">
                  {NOTE_SECTIONS.map(([t, letter, heading]) => (
                    <button key={t} type="button"
                      onClick={() => {
                        document.getElementById(`note-sec-${t}`)?.scrollIntoView({ block: "start", behavior: "smooth" });
                        document.getElementById(`note-${t}`)?.focus({ preventScroll: true });
                      }}
                      aria-label={`${heading}: ${(bodies[t] ?? "").trim() ? "contains text" : "empty"}. Jump to section.`}
                      className={`flex items-center gap-1.5 rounded-lg border px-2 py-1 text-[11.5px] font-semibold ${activeSeg === t
                        ? "border-[var(--cp-primary)] bg-[var(--cp-primary)]/10 text-[var(--cp-primary-deep)]"
                        : "border-gray-200 text-gray-700 hover:bg-gray-50"}`}>
                      <span aria-hidden className="font-bold">{letter}</span>
                      <span className="hidden sm:inline">{heading}</span>
                      <span aria-hidden className="text-gray-500">{(bodies[t] ?? "").trim() ? "✓" : "○"}</span>
                    </button>
                  ))}
                </nav>

                <div className="mt-2 flex flex-col">
                  {NOTE_SECTIONS.map(([t, letter, heading, descriptor], i) => {
                    const versions = props.history[t] ?? [];
                    const isNarrative = t === "narrative";
                    return (
                      <div key={t} id={`note-sec-${t}`} className="scroll-mt-12">
                        {/* s13: NARRATIVE IS NOT A FIFTH SOAP ELEMENT. The divider says what it is for,
                            and nothing about it implies it is owed. */}
                        {isNarrative && (
                          <div className="mt-3 flex items-center gap-2" role="separator" aria-label="Additional narrative">
                            <span className="h-px flex-1 bg-gray-200" />
                            <span className="text-[10.5px] font-semibold uppercase tracking-wide text-gray-500">
                              Additional narrative — free text that does not fit the structured sections
                            </span>
                            <span className="h-px flex-1 bg-gray-200" />
                          </div>
                        )}
                        {/* s8's banding: the ACTIVE section wears the lavender the other tabs give
                            their active work; inactive sections alternate white and pale blue-grey so
                            the eye does not migrate between them. Colour is never the only cue -- the
                            active border is also the only 2px one in the stack, and the focus ring
                            sits on the textarea itself. */}
                        <section
                          className={`${isNarrative || i > 0 ? "mt-2" : ""} rounded-xl border p-3 transition-colors ${activeSeg === t
                            ? "border-2 border-[var(--cp-primary)]/30 bg-[var(--cp-primary)]/[0.04]"
                            : `border-gray-200 ${i % 2 === 1 ? "bg-slate-50/60" : "bg-white"}`}`}>
                          <div className="flex items-center justify-between gap-2">
                            <label htmlFor={`note-${t}`} className="flex min-w-0 items-baseline gap-2">
                              <span aria-hidden
                                className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-gray-100 text-[10.5px] font-bold text-gray-600">
                                {letter}
                              </span>
                              <span className="text-[12.5px] font-bold text-gray-900">{heading}</span>
                              <span className="text-[10.5px] text-gray-500">— {descriptor}</span>
                            </label>
                            {/* s7/s11: Dictate lives on the heading line so its target is unmistakable,
                                and the component itself shows a listening state with a Stop. */}
                            {editable && (
                              <Dictation label="Dictate"
                                onText={text => {
                                  setBodies(b => ({ ...b, [t]: `${b[t]}${b[t] && !b[t].endsWith(" ") ? " " : ""}${text}` }));
                                  setSaved(sv => ({ ...sv, [t]: false }));
                                  setDictated(d => ({ ...d, [t]: true }));
                                }} />
                            )}
                          </div>
                          <AutoGrowTextarea id={`note-${t}`} disabled={!editable}
                            placeholder="Start typing or dictate…"
                            value={bodies[t]}
                            onFocus={() => setActiveSeg(t)}
                            onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => { setBodies(b => ({ ...b, [t]: e.target.value })); setSaved(sv => ({ ...sv, [t]: false })); }}
                            className={`${input} mt-1.5 resize-none overflow-hidden disabled:bg-gray-50 disabled:text-gray-500`} />
                          <div className="mt-1 flex flex-wrap items-center gap-2">
                            {editable && (
                              <>
                                <button type="button" disabled={busy} onClick={() => saveNote(t)}
                                  className={`rounded border border-gray-200 px-2 py-0.5 text-[11px] font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-50 ${TOUCH}`}>
                                  Save to record
                                </button>
                                {/* CPR-130 smart text. Expansion is a BUTTON, never something that happens
                                    as you type: text in a clinical note must not change under somebody's hands. */}
                                {props.phrases.length > 0 && (
                                  <button type="button" disabled={busy} onClick={() => expandInto(t)}
                                    className={`rounded border border-gray-200 px-2 py-0.5 text-[11px] font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-50 ${TOUCH}`}>
                                    Expand
                                  </button>
                                )}
                                {saved[t] && <span className="text-[10px] text-[var(--cmp-text-success)]">saved</span>}
                                {dictated[t] && <span className="text-[10px] text-gray-500">will be recorded as dictated</span>}
                                {/* THE AUTOSAVE INDICATOR SAYS "DRAFT", not "saved". A practitioner who read
                                    this as a save would leave a consultation believing the record held
                                    something it does not. */}
                                {draftAt[t] && !saved[t] && (
                                  <span className="text-[10px] text-gray-500">draft kept {draftAt[t]} — not in the record yet</span>
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
                                  <p className="text-[10px] text-gray-500">
                                    v{v.version} · {String(v.created_at).slice(0, 16).replace("T", " ")} · {v.source}
                                  </p>
                                  <p className="whitespace-pre-wrap text-[11px] text-gray-600">{v.body || <span className="text-gray-400">(empty)</span>}</p>
                                </li>
                              ))}
                            </ul>
                          )}
                        </section>
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

      {/* ══ RIGHT COLUMN (CPR-ENC-003 s3, RANKED BY CPR-HFE-TRT-004 s11) ══════════════════════════
          "Patient Summary, AI Assistant, Encounter Timeline and contextual utilities."
          ⚠ There is no AI Assistant panel -- see page.tsx.

          ⚠ THE ORDER OF THIS COLUMN IS THE SPECIFICATION, NOT A PREFERENCE. s11 ranks it
          safety > procedures > context/visits/timeline > quick actions, and it used to run
          context > safety > visits > procedures > timeline > actions with every card at the same
          weight. Patient safety -- the allergy line -- was the SECOND thing in the rail, under the
          encounter's start time. Anything inserted here must take a tier, and the tier decides where
          it goes. */}
      <aside className={`flex flex-col gap-3 ${RAIL}`}>
        {/* HIGHEST (s11). */}
        {props.railSafety}

        {/* MEDIUM (s11): "compact encounter-context card; procedure rows easy to scan". */}
        <section className={RAIL_MEDIUM}>
          <div className="flex items-center justify-between gap-2">
            <h2 className={RAIL_MEDIUM_H}>Procedures in this encounter</h2>
            <button type="button" onClick={() => setTab("procedures")}
              className={`rounded-lg px-1.5 py-1 text-[11px] font-semibold text-[var(--cp-primary-deep)] hover:bg-[var(--cp-primary)]/[0.07] hover:underline ${TOUCH}`}>+ Add</button>
          </div>
          {props.procedures.filter(p => p.encounter_id === props.encounterId).length === 0 ? (
            <p className="mt-2 text-[12px] text-gray-500">None recorded in this consultation.</p>
          ) : (
            <ul className="mt-2 flex flex-col gap-1.5">
              {props.procedures.filter(p => p.encounter_id === props.encounterId).map(p => (
                // ⚠ s11's "EASY TO SCAN" IS A COLUMN, NOT A PARAGRAPH. The time was on a second line
                // under the label, so reading three procedures in order meant reading six lines in a
                // zig-zag. It now sits in a fixed-width monospaced column on the SAME line as the
                // label, which is what lets the eye run straight down the times.
                <li key={p.id} className="rounded-lg border border-gray-200 px-2.5 py-1.5">
                  <div className="flex items-baseline gap-2">
                    <span className={`w-11 shrink-0 font-mono ${RAIL_META}`}>{formatTime(p.performed_at)}</span>
                    <span className="min-w-0 text-[12px] font-semibold text-gray-800">{p.label}</span>
                  </div>
                  {(p.site || SIDED_LATERALITIES.includes(p.laterality)) && (
                    <p className={`pl-[52px] ${RAIL_META}`}>
                      {[p.site, SIDED_LATERALITIES.includes(p.laterality) ? p.laterality : null]
                        .filter(Boolean).join(" · ")}
                    </p>
                  )}
                  {p.indication && <p className="pl-[52px] text-[11px] text-gray-600">Indication: {p.indication}</p>}
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* LOWER (s11): encounter context and previous visits, from page.tsx. */}
        {props.railLower}

        {/* LOWER (s11). THE ENCOUNTER TIMELINE, from the status history the engine writes on every
            transition. It is a record of what happened to this record, not a narrative anybody
            composed -- which is exactly why it belongs near the bottom of a rail read during a
            consultation. */}
        <section className={RAIL_LOW}>
          <h2 className={RAIL_LOW_H}>Encounter timeline</h2>
          {props.statusHistory.length === 0 ? (
            <p className="mt-2 text-[12px] text-gray-500">No transitions recorded.</p>
          ) : (
            <ul className="mt-2 flex flex-col gap-1.5">
              {props.statusHistory.map((h: any, i: number) => (
                <li key={i} className="flex items-baseline gap-2 text-[11px]">
                  <span className={`w-11 shrink-0 font-mono ${RAIL_META}`}>{formatTime(h.occurred_at)}</span>
                  <span className="text-gray-700">{h.from_status ? `${h.from_status} → ${h.to_status}` : h.to_status}</span>
                </li>
              ))}
            </ul>
          )}
          <p className={`mt-2 ${RAIL_META}`}>
            Every transition is recorded here and in the workspace audit log. Neither can be edited from the app.
          </p>
        </section>

        {/* CPR-ENC-002 s6's EIGHT QUICK ACTIONS. Each one JUMPS to the tab that already holds the form
            -- which is what makes it one click rather than a scroll. An action whose capability the
            caller does not hold is drawn as unavailable rather than hidden, so the screen does not
            silently differ between two people looking at the same consultation. */}
        <section className={RAIL_UTILITY}>
          <h2 className={RAIL_UTILITY_H}>Quick actions</h2>
          <div className="mt-2 grid grid-cols-2 gap-1.5">
            {QUICK_ACTIONS.map(a => {
              const allowed = held[a.capability] !== false && (a.capability !== "encounter.edit" || editable);
              if (a.href) {
                // The one action that leaves this screen. It is still capability-gated: a link that
                // 403s on arrival is worse than a button that says it cannot be pressed.
                return allowed ? (
                  <Link key={a.key} href={a.href} className={QA_ALLOWED}>
                    <span aria-hidden="true">{QUICK_ACTION_ICON[a.key]}</span>{a.label}
                  </Link>
                ) : (
                  <span key={a.key} title="You do not hold the permission for this" className={QA_DENIED}>
                    <span aria-hidden="true">{QUICK_ACTION_ICON[a.key]}</span>{a.label}
                  </span>
                );
              }
              return (
                <button key={a.key} type="button" disabled={!allowed} onClick={() => quickAction(a)}
                  title={allowed ? undefined : "You do not hold the permission for this"}
                  className={allowed ? QA_ALLOWED : QA_DENIED}>
                  <span aria-hidden="true">{QUICK_ACTION_ICON[a.key]}</span>{a.label}
                </button>
              );
            })}
          </div>
          {/* ⚠ CPR-MOB-001 s4: "DO NOT USE HOVER-ONLY INFORMATION OR CONTROLS." The greyed actions
              above carry their reason in a `title` attribute, and a phone has no hover — so the one
              thing a practitioner needs to know about a control that will not respond ("it is a
              permission, not a fault") was unreachable on the device this row is written for. The
              titles stay for the pointer; below md the same sentence is drawn. Rendered only when
              something IS denied, because a permanent line about a state nobody is in is the noise
              that teaches people to stop reading these. The cockpit's stale-arrival title became a
              visible sentence for this reason; this is the same fix on the same rule. */}
          {QUICK_ACTIONS.some(a => !(held[a.capability] !== false && (a.capability !== "encounter.edit" || editable))) && (
            <p className={`mt-2 md:hidden ${RAIL_META}`}>
              The greyed actions need a permission you do not hold. Nothing is hidden from you here.
            </p>
          )}
          {/* ⚠ "PRINT SUMMARY" IS A BUTTON AND IT DOES NOT PRINT. It opens Attachments, because what this
              product can print is a DOCUMENT -- a consultation summary with a version, a signature and a
              release register behind it. A one-click window.print() would produce an unversioned sheet
              that looks like a clinical document, is not one, and leaves nothing recording that it left
              the building. The button was previously omitted altogether and the reason lived only in the
              grey text below; the affordance now exists where the comp draws it, and the sentence still
              says what the click actually does. */}
          <p className={`mt-2 ${RAIL_META}`}>
            <strong className="font-semibold text-gray-700">Print summary</strong> opens{" "}
            <button type="button" onClick={() => setTab("attachments")}
              className="font-semibold text-[var(--cp-primary-deep)] hover:underline">Attachments</button>,
            where a consultation summary is created and printed from the document itself. What gets
            printed is versioned and has a release register &mdash; not a screenshot of this page.
          </p>
        </section>
      </aside>

      {/* ⚠ CPR-MOB-001 s17: "BOTTOM NAVIGATION AND STICKY ACTION BARS MUST NOT OBSCURE CONTENT."
          THE IN-FLOW TWIN OF THE PINNED DOCK, and it is half of that component even though it draws
          nothing. `fixed` takes the dock out of flow, so the document ends where it always did and the
          dock sits on top of the last ~76px of it — which on this screen is the Quick actions tray and
          the sentence explaining what Print summary does. The shell's <main> already pads past the
          bottom NAVIGATION; nothing has ever padded past a bar that did not exist until now.

          ⚠ IT IS THE LAST CHILD OF THE WHOLE COMPONENT, NOT A SIBLING OF THE DOCK. The dock is rendered
          beside the action bar it belongs to, near the TOP of the centre column; a spacer there would
          reserve 96px in the middle of the consultation and still leave the last section underneath the
          bar — the defect intact, plus a hole in the page. Below xl this grid is one column, so being
          last in the DOM is being last on the screen. `md:hidden` and `dockVisible` keep it exactly as
          conditional as the thing it is reserving room for. */}
      {dockVisible && <div aria-hidden className="h-24 md:hidden" />}

      {/* CPR-DOC-AUTO-001 s7. Last child, so the dialog overlays the whole console rather than being
          clipped by the column it was opened from. */}
      {letterFor && (
        <DocumentComposer
          purpose={letterFor.purpose}
          patientId={props.patientId} encounterId={props.encounterId}
          referralId={letterFor.referralId} initialReason={letterFor.reason}
          onClose={() => setLetterFor(null)}
          // Straight to the draft, which is where s18's next actions live -- read it, edit it, sign it.
          // A notice back on the console would announce a document the practitioner then has to find.
          onGenerated={id => { window.location.href = `/practice/documents/${id}`; }}
        />
      )}
    </div>
  );
}
