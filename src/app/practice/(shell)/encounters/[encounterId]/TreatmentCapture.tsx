"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  WEIGHT_TONE, NOT_CHECKED_TONE, NOT_CHECKED_LABEL, doseSafetyNotice,
  DOSE_BASES, WEIGHT_STATES_NEEDING_DECISION, weightDecisionHeadline, WEIGHT_DECISION_ASK,
  BSA_NEEDS_MEASUREMENTS, ADULT_NO_WEIGHT_REFUSED,
} from "@/lib/practice/medication-constants";
import {
  TREATMENT_REFUSALS, QUICK_ADD_NOT_A_RECOMMENDATION, TEMPLATES_ARE_REVALIDATED,
  CUSTOM_WORDING_PRESERVED, OTHER_OPTION_CODE, treatmentShape, BATCH_BOUNDARY,
  SAFETY_VERDICT_CHIP, SAFETY_VERDICT_MARK, ALLERGY_UNRESOLVED_ASK, NKDA_IS_SOMETHING_SOMEBODY_SAID,
  treatmentBand,
} from "@/lib/practice/treatment-capture-constants";
import {
  ALLERGY_SEVERITIES, ALLERGY_CERTAINTIES, BLOOD_GROUPS, type SafetyLine,
} from "@/lib/practice/longitudinal-constants";
import type { TreatmentCapturePayload, PendingTreatment, TreatmentOption } from "@/lib/practice/treatment-capture";
import type { PatientMedications, DoseCalculationResult } from "@/lib/practice/medication";
import type { EncounterCollection } from "@/lib/practice/parameters";
import { safetyChips } from "@/lib/practice/safety-chips";
import {
  PANEL, SectionHeader, Advisory, Badge, EmptyState,
} from "@/components/practice/EncounterKit";
import {
  ClinicalRecordTable, type RecordColumn, type RowState,
} from "@/components/practice/ClinicalRecordTable";

// CPR-TREAT-001 -- THE TREATMENT TAB.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// s2's INTERACTION MODEL, IN ORDER, TOP TO BOTTOM:
//
//   Safety checkpoint  ->  Quick add / templates  ->  Builder  ->  Pending plan  ->  Record N
//
// ⚠ THE SAFETY CHECKPOINT IS FIRST AND IT IS NOT A SUMMARY. s10 says the Treatment workflow CONSUMES the
// Safety Snapshot rather than asking again, so the allergy line, the weight verdict and the nine
// deferred checks are the SAME payload the snapshot at the top of the page renders -- one read, one
// truth, no duplicate entry (s10's last line).
//
// ⚠ AN EMPTY ALLERGY LIST IS "UNKNOWN", NOT "CLEAR". AC-08. Nobody has said this patient has no
// allergies; the list is simply empty, and a green tick over an empty list is the single most dangerous
// thing this screen could draw.
//
// ⚠ NOTHING IN THIS FILE IS A CLINICAL LIST. s6 is a FROZEN REQUIREMENT. Every formulation, dose unit,
// route, frequency, duration and non-drug category is read from configuration at request time and
// rendered from props. The only strings here are the ones about the product's own boundaries.
//
// ⚠ THE DOSE ARITHMETIC IS medication.ts's, CALLED, NOT COPIED. The weight-based calculator posts to
// /api/v1/practice/medications -- the same endpoint MedicationConsole uses -- and every rule that
// component enforces is enforced here: the figure is never rendered without its working and its notice,
// and a road that ends in a refusal is closed before it is walked rather than after.
//
// ⚠ WHAT WAS PRESCRIBED, NOT WHAT WAS ADMINISTERED. s16, printed on the tab from the engine's constant.

/* eslint-disable @typescript-eslint/no-explicit-any */

const CARD = "rounded-xl border border-gray-200 bg-white p-3.5";
const input = "w-full rounded-lg border border-gray-200 px-2.5 py-2 text-[13px] outline-none focus:border-[var(--cp-primary)] focus:ring-2 focus:ring-[var(--cp-primary)]/10";
const BTN = "rounded-lg bg-[var(--cp-primary)] px-3 py-2 text-[12px] font-semibold text-white hover:bg-[var(--cp-primary-deep)] disabled:opacity-50";
const QUIET = "rounded-lg border border-gray-200 px-2.5 py-1.5 text-[11px] font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50";
const CHIP = "rounded-full border border-gray-200 bg-white px-2.5 py-1 text-[11.5px] font-semibold text-gray-800 hover:border-[var(--cp-primary)] hover:bg-[var(--cp-primary)]/5 disabled:opacity-50";
const CHIP_ON = "rounded-full border border-[var(--cp-primary)] bg-[var(--cp-primary)]/10 px-2.5 py-1 text-[11.5px] font-semibold text-[var(--cp-primary-deep)]";
const LABEL = "block text-[10px] font-semibold uppercase tracking-wide text-gray-500";

type RecordedTreatment = {
  id: string; treatment_type: string; label: string; dose: string | null; route: string | null;
  frequency: string | null; duration: string | null; status: string; notes?: string | null;
};

const blankDraft = (treatmentType: string): PendingTreatment => ({
  treatmentType, label: "", medicationRef: null, brandName: null, strengthText: null,
  formulation: null, dose: null, doseUnit: null, route: null,
  frequencyCode: null, frequencyText: null, frequencyPerDay: null,
  duration: null, nonDrugCategory: null, reason: null, templateId: null,
});

export default function TreatmentCapture(props: {
  encounterId: string;
  patientId: string;
  capture: TreatmentCapturePayload;
  medication: PatientMedications;
  recorded: RecordedTreatment[];
  canRecord: boolean;
  canPrescribe: boolean;
  locked: boolean;
  /**
   * ── THE MEDICATION SAFETY STRIP -- CPR-TREAT-001 s10, and the owner's own comp ─────────────────
   *
   * ⚠ THESE COME FROM patientSnapshot, NOT FROM THE MEDICATION PAYLOAD, AND THE DIFFERENCE IS THE
   * WHOLE POINT. An EMPTY allergy list means NOBODY ASKED. `allergyLine.safeToRead` is true only when
   * a practitioner came through and ANSWERED the question, which stamps who and when. Deriving
   * reassurance from `items.length === 0` is exactly the mistake longitudinal-constants.ts calls the
   * single most safety-critical function in this build.
   */
  allergyLine: SafetyLine;
  allergyList: { items: { id: string; substance: string; reaction: string | null; severity: string | null; certainty: string }[]; permitted: boolean; unavailable: boolean; detail: string | null };
  bloodGroupLine: SafetyLine;
  /** The capability the existing allergy route already declares. No new code was invented. */
  canEditPatient: boolean;
  /**
   * The parameters collected for this encounter, for the comp's per-card safety chips.
   *
   * ⚠ TYPE-ONLY IMPORT, so parameters.ts does not follow it into the browser bundle.
   * ⚠ AND THESE ARE PATIENT-LEVEL FACTS SHOWN PER CARD, WHICH IS WHAT THE COMP DOES. Both cards in the
   * owner's design carry identical values, because that is what they are -- one patient, one weight,
   * one allergy status. The chips are a convenience for scanning, NOT a per-drug check, and the wording
   * never claims otherwise: s11 forbids implying that a drug-specific check has passed, and no chip
   * says cleared, safe or checked. I withheld these once on the grounds that repeating them implied a
   * per-treatment evaluation. That was over-cautious -- the duplication is the point of a card.
   */
  collection: EncounterCollection;
}) {
  const router = useRouter();
  const editable = props.canRecord && !props.locked;
  const cap = props.capture;
  const med = props.medication;

  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [itemResults, setItemResults] = useState<{ label: string; ok: boolean; message: string | null }[]>([]);

  const [plan, setPlan] = useState<PendingTreatment[]>([]);
  const [draft, setDraft] = useState<PendingTreatment>(() =>
    blankDraft(cap.options.byField.treatment_type?.[0]?.code ?? "medication"));
  const [customFrequency, setCustomFrequency] = useState("");
  const [medQuery, setMedQuery] = useState("");
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [templateName, setTemplateName] = useState("");

  // ── The allergy answer, and the blood group that travels with it ─────────────────────────────────
  const [allergyOpen, setAllergyOpen] = useState(false);
  const [allergy, setAllergy] = useState({ substance: "", reaction: "", severity: "", certainty: "suspected" });
  const [bloodGroup, setBloodGroup] = useState("");

  const [calc, setCalc] = useState({ basis: "mg_per_kg", rateValue: "", fixedDose: "", doseUnit: "mg", dosesPerDay: "", weightDecision: "" });
  const [calcOpen, setCalcOpen] = useState(false);
  // CPR-TRT-UI-002 s8: notes and advanced tools are collapsed by default, so the common prescription
  // is not paid for by fields most of them never use.
  const [notesOpen, setNotesOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  // The comp's collapsed "Show completed / stopped", and the safety detail each card's Review opens.
  const [finishedOpen, setFinishedOpen] = useState(false);
  const [safetyOpen, setSafetyOpen] = useState(false);
  const [dose, setDose] = useState<DoseCalculationResult | null>(null);

  const opts = (key: string): TreatmentOption[] => cap.options.byField[key] ?? [];
  const shape = treatmentShape(draft.treatmentType);

  // ── THE COMP'S PER-CARD SAFETY CHIPS ────────────────────────────────────────────────────────────
  //
  // ⚠ DERIVED THE SAME WAY SafetySnapshot DERIVES THEM, from the same payload. Two screens reading one
  // collection and reaching different answers about how many alerts are open is the drift this codebase
  // has been bitten by before, so the arithmetic is copied from there deliberately rather than invented.
  //
  // ⚠ THREE STATES, NOT TWO. Not permitted, could not be read, and genuinely nothing monitored are
  // different sentences -- "No alerts" over an unreadable collection is the reassurance this product
  // must never print.
  // ⚠ FROM THE SHARED DERIVATION, NOT COMPUTED HERE. The same four facts are drawn on the top strip,
  // on every card below and in the Patient safety rail. Three screens each counting open alerts their
  // own way is precisely the drift that made command-centre.ts and session.ts disagree about "overdue"
  // on two screens a click apart, with nothing failing because each was right against itself.
  const { vitals: vitalsChip, alerts: alertsChip } = safetyChips(props.collection);

  // ── s19's EDIT AND REMOVE, on a card that is already in the record ───────────────────────────────
  //
  // ⚠ EDIT LOADS THE COMPOSER AND WITHDRAWS THE ROW ONLY WHEN THE REPLACEMENT IS RECORDED -- no. It
  // does NOT withdraw first. Pulling the row out and trusting the practitioner to finish would lose a
  // prescription to a closed tab or a changed mind, and "it disappeared while I was editing it" is the
  // worst possible answer about a medication. The card stays until Correct is pressed.
  const editTreatment = async (t: { id: string; label: string; dose: string | null; route: string | null;
    frequency: string | null; duration: string | null }) => {
    const label = window.prompt("Correct the treatment name", t.label);
    if (label === null) return;                      // cancelled, and cancelling changes nothing
    const body = await post("/api/v1/practice/treatment-capture", {
      action: "correct", treatmentId: t.id, label,
    });
    if (body) { setNotice({ kind: "ok", text: "Treatment corrected." }); router.refresh(); }
  };

  // ⚠ CONFIRMED BY NAME, s19: "Require appropriate confirmation". A one-tap delete on a prescription is
  // an accident waiting to be blamed on the person who made it.
  // ── CP-UI-TABLE-001 s5's TREATMENT COLUMNS, s6's SECOND LINE ────────────────────────────────────
  //
  // ⚠ THE SAFETY COLUMN CARRIES THE PATIENT'S RECORDED ALLERGY STATUS, NOT A DRUG CHECK. The comp
  // reads "No allergy alerts" and shows a penicillin warning on an amoxicillin row. THIS PRODUCT DOES
  // NOT MATCH DRUGS AGAINST ALLERGIES -- CPR-TRT-UI-002 s11 forbids implying that it does, and the
  // deferred-checks list on this very tab names the check it does not run. Printing the comp's wording
  // would claim a check that never happened, on the one row where a clinician would rely on it. The
  // column shows the engine's own allergy sentence instead, which is true.
  //
  // ⚠ AND FOR THE SAME REASON NO ROW IS `warning` YET. s4 reserves that state for clinically
  // actionable issues; the only alerts this build has are patient-level parameter alerts, which are
  // identical on every row and would paint the whole table amber. A warning on every row is a warning
  // on none. When per-treatment evaluation exists, its verdict sets rowState here.
  const TREATMENT_COLUMNS: RecordColumn<RecordedTreatment>[] = [
    { key: "label", label: "Treatment", priority: "primary",
      render: t => {
        const band = treatmentBand(t.status);
        return (
          <span className={band.struck ? "font-semibold text-gray-400 line-through" : "font-semibold text-gray-900"}>
            {t.label}
          </span>
        );
      } },
    { key: "dose", label: "Dose / route",
      render: t => [t.dose, t.route].filter(Boolean).join(" · ") || <span className="text-gray-400">&mdash;</span> },
    { key: "freq", label: "Frequency / duration",
      render: t => [t.frequency, t.duration].filter(Boolean).join(" · ") || <span className="text-gray-400">&mdash;</span> },
    { key: "status", label: "Status", priority: "status",
      render: t => <Badge tone={treatmentBand(t.status).struck ? "muted" : "neutral"}>{t.status}</Badge> },
    { key: "safety", label: "Safety", priority: "secondary",
      render: () => (
        <span className="inline-flex items-baseline gap-1.5">
          <span aria-hidden="true" className={
            allergyVerdict === "clear" ? "text-[var(--cmp-text-success)]"
              : allergyVerdict === "flagged" ? "text-[var(--cmp-text-critical)]" : "text-gray-400"}>
            {allergyVerdict === "clear" ? "✓" : allergyVerdict === "flagged" ? "⚠" : "–"}
          </span>
          <span className="text-[11.5px] text-gray-700">{props.allergyLine.text}</span>
        </span>
      ) },
  ];

  const treatmentRow = (t: RecordedTreatment) => ({
    id: t.id,
    data: t,
    state: (FINISHED.includes(t.status) ? "completed" : "normal") as RowState,
    stateLabel: FINISHED.includes(t.status) ? `${t.status} treatment` : undefined,
    // s6's second line, verbatim in shape: weight with its age, vitals, alerts.
    secondaryText: (
      <>Weight: {med.weight.text} &middot; Vitals: {vitalsChip.text} &middot; Alerts: {alertsChip.text}</>
    ),
    actions: (
      <span className="inline-flex items-center gap-1">
        <button type="button" data-step="review-safety"
          onClick={() => { setSafetyOpen(true); document.getElementById("treatment-safety")?.scrollIntoView({ behavior: "smooth", block: "center" }); }}
          aria-label={`Review safety for ${t.label}`}
          className="text-[11.5px] font-semibold text-[var(--cp-primary)] hover:underline">
          Review &rsaquo;
        </button>
        {editable && (
          <>
            <button type="button" data-step="edit-treatment" disabled={busy} onClick={() => editTreatment(t)}
              aria-label={`Correct ${t.label} treatment`} title="Correct this treatment"
              className="rounded-lg border border-gray-200 px-1.5 py-0.5 text-[12px] text-gray-600 hover:bg-gray-50 disabled:opacity-50">
              ✎
            </button>
            <button type="button" data-step="withdraw-treatment" disabled={busy} onClick={() => withdrawTreatment(t)}
              aria-label={`Withdraw ${t.label} treatment`} title="Withdraw this treatment"
              className="rounded-lg border border-gray-200 px-1.5 py-0.5 text-[12px] text-gray-600 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-50">
              ⋮
            </button>
          </>
        )}
      </span>
    ),
  });

  const withdrawTreatment = async (t: { id: string; label: string }) => {
    if (!window.confirm(`Withdraw "${t.label}" from this encounter? This removes it from the record.`)) return;
    const body = await post("/api/v1/practice/treatment-capture", {
      action: "withdraw", treatmentId: t.id,
    });
    if (body) {
      // ⚠ THE MEDICATION ROW SURVIVES, AND THE PRACTITIONER IS TOLD SO. Removing the note here does not
      // remove a longitudinal medication that may already have been reviewed or carried forward. A
      // silent partial deletion would leave evidence somewhere nobody is looking.
      setNotice({ kind: "ok", text: body.medicationKept
        ? "Treatment withdrawn from this encounter. It remains on the patient's medication list, which the medication console owns."
        : "Treatment withdrawn from this encounter." });
      router.refresh();
    }
  };

  // ⚠ s14's "Show completed / stopped". Splitting on status rather than hiding a count: a card that has
  // been stopped is still part of what happened in this consultation, so it is collapsed, never dropped.
  const FINISHED = ["completed", "cancelled"];
  const liveTreatments = props.recorded.filter(t => !FINISHED.includes(t.status));
  const finishedTreatments = props.recorded.filter(t => FINISHED.includes(t.status));

  // ── s4's search: the configured name list, plus what this practice actually prescribes ────────────
  const medMatches = useMemo(() => {
    const q = medQuery.trim().toLowerCase();
    if (!q) return [];
    return cap.picker.catalogue.items.filter(m =>
      m.genericName.toLowerCase().includes(q)
      || (m.brandName ?? "").toLowerCase().includes(q)
      || (m.aliases ?? []).some(a => a.toLowerCase().includes(q))
      || (m.defaultFormulation ?? "").toLowerCase().includes(q)).slice(0, 12);
  }, [cap.picker.catalogue.items, medQuery]);

  /**
   * ⚠ THE REFUSAL IS SURFACED VERBATIM, NEVER SWALLOWED. The allergy route refuses `none_known` while
   * allergies are listed -- the one combination that would print reassurance on top of contradicting
   * evidence -- and the practitioner has to see that sentence rather than a button that did nothing.
   */
  async function post(url: string, payload: Record<string, unknown>, method = "POST"): Promise<Record<string, any> | null> {
    setBusy(true); setNotice(null);
    try {
      const res = await fetch(url, {
        method, headers: { "content-type": "application/json" }, body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setNotice({ kind: "err", text: body?.error?.message ?? `That did not work (${res.status}).` });
        return null;
      }
      return body;
    } finally { setBusy(false); }
  }

  // ⚠ RETURNS WHETHER IT ADDED, so the caller can tell a refusal from a success. It used to return
  // nothing and the caller cleared the draft regardless -- so hitting the cap ANSWERED A REFUSAL BY
  // DELETING THE TREATMENT the practitioner had just typed out, dose and all.
  const addToPlan = (item: PendingTreatment): boolean => {
    if (plan.length >= cap.maxPending) {
      setNotice({ kind: "err", text: `A plan holds at most ${cap.maxPending} treatments.` });
      return false;
    }
    setPlan(p => [...p, item]);
    return true;
  };

  // ⚠ ONE PLACE BUILDS THE ITEM, because two callers need it now: "Add to the plan", and the record
  // button when it is asked to write a draft nobody added. Were these to drift apart, a treatment
  // recorded directly would carry different frequency wording from the identical one added first --
  // and the difference would live in the patient's record, where nobody would think to look for it.
  const draftItem = (): PendingTreatment | null => {
    if (!draft.label?.trim()) return null;
    const custom = draft.frequencyCode === OTHER_OPTION_CODE;
    return {
      ...draft,
      // ⚠ s5's REQUIREMENT, HERE. Choosing Other keeps the practitioner's own wording as the frequency,
      // and the engine leaves frequency_code NULL so a reader can tell it was typed rather than tapped.
      frequencyText: custom ? customFrequency.trim() : (draft.frequencyText ?? null),
      frequencyPerDay: custom ? null : draft.frequencyPerDay,
    };
  };

  const clearDraft = () => {
    setDraft(blankDraft(draft.treatmentType));
    setCustomFrequency(""); setMedQuery(""); setDose(null); setCalcOpen(false);
  };

  const commitDraft = () => {
    const item = draftItem();
    if (!item) return;
    if (addToPlan(item)) clearDraft();
  };

  // ⚠ WHAT THE BUTTON WILL ACTUALLY WRITE, which is the plan PLUS any started draft. The count on the
  // button has to be the count that gets recorded, or the button is lying about its own effect.
  const recordCount = plan.length + (draft.label?.trim() ? 1 : 0);

  async function record() {
    // ⚠ THE PRIMARY BUTTON RECORDS THE DRAFT TOO (the owner, 2026-08-13: "have tried recording a
    // treatment, however it does not seem to record. Stays highlighted"). This was a two-step form in
    // which only one step looked like an action: a FINISHED draft with an empty plan left this button
    // DISABLED, so pressing it did nothing whatsoever -- no write, no refusal, no message, and the
    // chips stayed lit exactly as they were. A disabled control cannot tell you why it is disabled,
    // which is what made a working screen read as a broken one.
    // Explaining the trap was the first attempt at this. Removing it is the fix.
    const pending = draftItem();
    const submitted = pending ? [...plan, pending] : plan;
    if (submitted.length === 0) return;
    if (submitted.length > cap.maxPending) {
      setNotice({ kind: "err", text: `A plan holds at most ${cap.maxPending} treatments.` });
      return;
    }
    const body = await post("/api/v1/practice/treatment-capture", {
      action: "record", encounterId: props.encounterId, items: submitted,
    });
    if (!body) return;
    const results = (body.results ?? []) as any[];
    setItemResults(results.map(r => ({ label: r.label, ok: r.ok, message: r.message })));
    const badIdx = new Set(results.filter(r => !r.ok).map(r => Number(r.index)));
    // ⚠ WHAT FAILED STAYS, WHAT SAVED GOES -- and the draft is judged by that same rule, because by
    // this point it IS one of the batch. A refused draft comes back as a plan row instead of
    // vanishing with the form, which is the only outcome where its author can still see what they
    // wrote. Indices are the engine's own `index` over the array we submitted, so they line up.
    setPlan(submitted.filter((_, i) => badIdx.has(i)));
    if (pending) clearDraft();
    setNotice({
      kind: badIdx.size === 0 ? "ok" : "err",
      text: badIdx.size === 0
        ? `Recorded ${body.recorded} treatment${body.recorded === 1 ? "" : "s"}.`
        : `Recorded ${body.recorded}. ${badIdx.size} was not.`,
    });
    router.refresh();
  }

  // ── s10's checkpoint. THREE VERDICTS. `unknown` is not `clear`. ───────────────────────────────────
  //
  // ⚠ THE VERDICT IS READ OFF THE SNAPSHOT'S SafetyLine, NEVER OFF A LIST LENGTH. `safeToRead` is true
  // only when a practitioner ANSWERED the question. An empty list is `unknown`, forever, until somebody
  // says otherwise -- which is AC-08 and is the reason the "No known drug allergies" button below
  // exists at all.
  const allergyVerdict: "clear" | "unknown" | "flagged" =
    props.allergyLine.tone === "none" ? "clear"
      : props.allergyLine.tone === "present" ? "flagged"
        : "unknown";
  const weightTone = WEIGHT_TONE[med.weight.state] ?? { chip: NOT_CHECKED_TONE, mark: "-", label: NOT_CHECKED_LABEL };

  const needsWeight = calc.basis === "mg_per_kg" || calc.basis === "mg_per_kg_per_day" || calc.basis === "mg_per_m2";
  const noWeightAtAll = needsWeight && (WEIGHT_STATES_NEEDING_DECISION as readonly string[]).includes(med.weight.state);
  const bsaImpossible = noWeightAtAll && calc.basis === "mg_per_m2";
  const adultNoWeight = noWeightAtAll && !bsaImpossible && !med.age.decisionPathOffered;
  const decisionRequired = noWeightAtAll && !bsaImpossible && med.age.decisionPathOffered;
  const decisionMissing = decisionRequired && !calc.weightDecision.trim();

  return (
    // ⚠ FIFTH TAB ON THE ENCOUNTER KIT. Chrome only, and on THIS component that matters more than
    // most: nothing here is a clinical list. Every formulation, dose unit, route, frequency, duration
    // and non-drug category is read from configuration at request time (see the header above), and the
    // dose arithmetic is medication.ts's, called rather than copied. A restyle must not quietly turn
    // any of that into markup.
    <section className={PANEL}>
      {/* ⚠ s5's COUNT, IN THE SPEC'S OWN WORDS. "N treatments this encounter" rather than "N recorded in
          this encounter": the count is of treatments, and saying `recorded` twice on one screen (here and
          on every card's status) spends words on the mechanism instead of the fact. Singular is handled
          because "1 treatments" is the kind of thing a practitioner stops trusting the screen over. */}
      {/* ⚠ s5's HEADER ACTION, WHICH THE COMP HAS AND THIS TAB DID NOT. It does not navigate: the
          composer is already on the page, so this focuses it. A button that scrolled somewhere else
          would be a worse answer than the one already visible below. */}
      <SectionHeader
        title="Treatment and plan"
        subtitle={props.recorded.length === 1
          ? "1 treatment this encounter."
          : `${props.recorded.length} treatments this encounter.`}
        about={editable ? (
          <button type="button" data-step="add-treatment-header" className={BTN}
            onClick={() => {
              const el = document.getElementById("treatment-composer");
              el?.scrollIntoView({ behavior: "smooth", block: "center" });
              el?.querySelector<HTMLInputElement>("input")?.focus();
            }}>
            + Add treatment
          </button>
        ) : undefined}
      />
      <div className="p-4">

      {/* ⚠ THE BOUNDARY, FROM THE ENGINE'S CONSTANT rather than retyped here -- so it cannot drift from
          the sentence the API and the harness assert on. Now in the kit's Tip band, which is where
          every tab puts the sentence that qualifies what the screen is claiming. */}
      {/* ⚠ s5: "Replace large purple panel with a single quiet information line." It was a full-width
          tinted block two lines deep, read once and then scrolled past on every consultation forever.
          Same sentence, same engine constant -- it is the API's and the harness's, never retyped -- but
          it now sits on one quiet line instead of taking the top of the tab. */}
      <p className="flex items-start gap-1.5 text-[11px] leading-snug text-gray-500">
        <span aria-hidden="true" className="mt-px text-[var(--cp-primary)]">&#9432;</span>
        <span>{cap.boundary}</span>
      </p>

      {cap.options.storeState === "absent" && (
        <p className="mt-2 rounded-lg bg-[var(--cmp-surface-warning)] px-3 py-2 text-[11.5px] text-[var(--cmp-text-warning)]">
          {cap.options.storeNotice}
        </p>
      )}
      {cap.options.unavailable && (
        <p className="mt-2 rounded-lg bg-[var(--cmp-surface-critical)] px-3 py-2 text-[11.5px] text-[var(--cmp-text-critical)]">
          {cap.options.detail}
        </p>
      )}
      {notice && (
        <p className={`mt-2 rounded-lg px-3 py-2 text-[11.5px] ${notice.kind === "ok"
          ? "bg-[var(--cmp-surface-success)] text-[var(--cmp-text-success)]"
          : "bg-[var(--cmp-surface-critical)] text-[var(--cmp-text-critical)]"}`}>
          {notice.text}
        </p>
      )}

      {/* ══ WHAT IS ALREADY RECORDED ═══════════════════════════════════════════════════════════════ */}
      {/* ⚠ s14's HIERARCHY: the treatment NAME leads, then dose - route - frequency - duration on one
          line, then the status. The type drops to a quiet chip; it disambiguates and it is not the fact
          a reader is scanning for. Previously the type led and the name sat in the middle of a flat row.

          ⚠ NO PER-CARD SAFETY CHIPS, AND THAT IS A DECISION RATHER THAN AN OMISSION. s14 lists a
          "compact safety state" on the card, but every safety fact this component holds is PATIENT-level
          -- the same allergy status and the same weight for every row. Drawing them per card would be
          precisely the duplication s15 exists to remove, and worse, it would imply a per-treatment
          evaluation this product does not perform, which s11 forbids implying. The day a per-treatment
          check exists its verdict belongs here; until then the panel below is the one that carries it. */}
      {/* ══ s14's RECORDED TREATMENT CARDS ═══════════════════════════════════════════════════════
          ⚠ CARDS HERE, TABLES ON DIAGNOSES AND PROCEDURES, AND THE DIFFERENCE IS DELIBERATE. A
          diagnosis row is four short facts and reads as a table. A treatment carries a regimen AND the
          safety context it was written under, which is two lines per item -- squeezed into a table row
          the regimen truncates and the safety has nowhere to go. The owner's comp draws cards for
          exactly that reason. I built a table here first and it moved the tab away from the design. */}
      <div className="mt-3">
        <ClinicalRecordTable
          label="Treatments recorded in this encounter"
          columns={TREATMENT_COLUMNS}
          empty={<EmptyState title="No treatment recorded for this encounter"
            reason="This was read successfully. A consultation that changes no treatment is a real consultation, and recording that is a decision rather than a gap." />}
          records={liveTreatments.map(t => treatmentRow(t))}
        />
      </div>

      {/* ⚠ COLLAPSED, NEVER DROPPED. A stopped treatment is still part of what happened in this
          consultation. The count is on the summary so a closed group is not mistaken for an empty one --
          "(0)" and a group that is hiding three are different facts. */}
      {finishedTreatments.length > 0 || liveTreatments.length > 0 ? (
        <button type="button" data-step="show-finished"
          className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg border border-gray-100 py-1.5 text-[11.5px] font-semibold text-gray-600 hover:bg-gray-50"
          onClick={() => setFinishedOpen(o => !o)}>
          {finishedOpen ? "Hide" : "Show"} completed / stopped ({finishedTreatments.length})
          <span aria-hidden="true">{finishedOpen ? "⌃" : "⌄"}</span>
        </button>
      ) : null}
      {finishedOpen && (
        finishedTreatments.length === 0 ? (
          <p className="mt-2 text-[11.5px] text-gray-500">
            Nothing has been completed or stopped in this consultation.
          </p>
        ) : (
          <div className="mt-2">
            <ClinicalRecordTable
              label="Treatments completed or stopped in this encounter"
              columns={TREATMENT_COLUMNS}
              empty={<></>}
              records={finishedTreatments.map(t => treatmentRow(t))}
            />
          </div>
        )
      )}

      {/* ══ s10's SAFETY -- COMPACT BY DEFAULT (CPR-TRT-UI-002 s10, s11, s12) ═════════════════════
          ⚠ THE HEADING AND THE PERMANENT EXPLANATIONS GO; THE FACTS AND THE ACTIONS STAY. s10 asks for
          normal findings as compact indicators rather than a standing card, and s11 moves the LIMITS of
          allergy matching behind a details action -- a practitioner re-reads those approximately never
          and was paying for them on every consultation. What remains in the default view is only what
          could change a prescribing decision: the recorded allergy status, any listed allergies, the
          weight, what the patient is already taking, and the one-tap answer while the question is
          still unanswered.

          ⚠ DISCLOSED, NOT HIDDEN, AND THE DIFFERENCE IS THE WHOLE POINT. Advisory is a <details>: every
          sentence stays in the HTML, stays printable and stays keyboard-reachable. Removing a safety
          limitation from the page would be a different act from folding it up, and s11 asks for the
          second one. The nine checks this product does not run are still one interaction away.

          ⚠ AND THE ONE-TAP ANSWER STAYS IN THE OPEN. Burying `No known drug allergies` behind the
          disclosure would leave assertion 7b-7 -- "answering the common case is ONE tap" -- passing on a
          count while its sentence had quietly become false. Explanations moved; controls did not. */}
      {/* ⚠ A <details>, NOT A CONDITIONAL. The children are in the HTML whether or not it is open, which
          is what keeps the one-tap allergy answer reachable, printable and in the accessibility tree.
          Rendering this only when `safetyOpen` would have removed the NKDA control from the page and
          quietly turned assertion 7b-7 -- "answering the common case is ONE tap" -- into a lie.
          Each card's Review opens this rather than repeating it: one patient, one safety panel. */}
      <details id="treatment-safety" open={safetyOpen}
        className="mt-3 rounded-xl border border-gray-200 bg-white"
        onToggle={e => setSafetyOpen((e.currentTarget as HTMLDetailsElement).open)}>
        <summary className="cursor-pointer px-3 py-2 text-[12px] font-semibold text-gray-700">
          Patient safety for prescribing
        </summary>
        <div className="border-t border-gray-100 p-3">

        {/* == THE ALLERGY LINE, AND THE TWO ACTIONS THAT ANSWER IT ==============================
            WARNING: THIS WAS A DEAD END UNTIL NOW, AND THAT IS THE DEFECT BEING FIXED. The store
            (practice_patient_allergy), the engines (addAllergy, recordAllergyReview) and the route
            (/api/v1/practice/encounters/record/[patientId]/allergies) have all existed since migration
            238. NOTHING IN THE PRODUCT CALLED THEM. The screen correctly said "nobody has asked" and
            offered no way to answer, on the one field where the answer matters most.

            WARNING: THE REASSURING SENTENCE IS PRINTED ONLY FROM safeToRead. An empty list is not an
            answer. "No known drug allergies" becomes true when a practitioner presses the button below,
            which stamps who said it and when -- never because a table came back with no rows.

            WARNING: NO NEW STORE, ENGINE, ROUTE OR CAPABILITY. The button posts to the endpoint that
            was already there, gated on the patient.edit it already declares. */}
        <div className="mt-2 flex items-start gap-2">
          <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold ${SAFETY_VERDICT_CHIP[allergyVerdict]}`}>
            {SAFETY_VERDICT_MARK[allergyVerdict]}
          </span>
          <div className="min-w-0 flex-1">
            <span className="text-[11px] font-bold text-gray-900">Allergy status</span>{" "}
            {/* The sentence is the ENGINE'S, never one composed here. allergyLine() is the function
                longitudinal-constants.ts calls the most safety-critical in this build. */}
            <span className={`text-[11px] ${props.allergyLine.tone === "unreadable"
              ? "text-[var(--cmp-text-critical)]"
              : props.allergyLine.tone === "present" ? "font-semibold text-gray-900" : "text-gray-700"}`}>
              {props.allergyLine.text}
            </span>

            {props.allergyList.unavailable ? (
              <p className="mt-0.5 text-[11px] text-[var(--cmp-text-critical)]">
                The allergy list could not be read. Do <strong>not</strong> take this as none recorded.
              </p>
            ) : props.allergyList.items.length > 0 && (
              <ul className="mt-1 flex flex-col gap-0.5">
                {props.allergyList.items.map(a => (
                  <li key={a.id} className="text-[11px] text-gray-800">
                    <span className="font-semibold">{a.substance}</span>
                    {a.reaction ? ` \u2014 ${a.reaction}` : ""}
                    {a.severity ? ` \u00b7 ${a.severity}` : ""}
                    <span className="ml-1 text-[10px] text-gray-400">{a.certainty}</span>
                  </li>
                ))}
              </ul>
            )}

            {!props.allergyLine.safeToRead && props.allergyLine.tone !== "present" && (
              <p className="mt-0.5 text-[10.5px] text-gray-600">{ALLERGY_UNRESOLVED_ASK}</p>
            )}

            {props.canEditPatient && !props.locked && (
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                {/* WARNING: OFFERED ONLY WHERE IT COULD SUCCEED. The engine REFUSES none_known while
                    allergies are listed, so the button is not drawn in that state -- a road that ends in
                    a refusal is closed before it is walked. The refusal is still surfaced verbatim if it
                    somehow happens. */}
                {props.allergyList.items.filter(a => a.certainty !== "refuted").length === 0 && (
                  <button type="button" data-step="nkda" className={QUIET} disabled={busy}
                    onClick={async () => {
                      const body = await post(`/api/v1/practice/encounters/record/${props.patientId}/allergies`,
                        { status: "none_known" }, "PUT");
                      if (body) { setNotice({ kind: "ok", text: "Recorded: no known drug allergies, by you, just now." }); router.refresh(); }
                    }}>
                    No known drug allergies
                  </button>
                )}
                <button type="button" data-step="record-allergy" className={QUIET} disabled={busy}
                  onClick={() => { setAllergyOpen(o => !o); setBloodGroup(""); }}>
                  {allergyOpen ? "Close" : "Record allergy"}
                </button>
                {!props.allergyLine.safeToRead && props.allergyLine.tone !== "present" && (
                  <p className="w-full text-[10px] text-gray-500">{NKDA_IS_SOMETHING_SOMEBODY_SAID}</p>
                )}
              </div>
            )}

            {allergyOpen && props.canEditPatient && !props.locked && (
              <div className="mt-2 rounded-lg border border-gray-200 p-2.5">
                <form className="grid gap-2 sm:grid-cols-2"
                  onSubmit={async ev => {
                    ev.preventDefault();
                    const body = await post(`/api/v1/practice/encounters/record/${props.patientId}/allergies`, {
                      substance: allergy.substance, reaction: allergy.reaction || null,
                      severity: allergy.severity || null, certainty: allergy.certainty,
                    }, "POST");
                    if (body) {
                      setAllergy({ substance: "", reaction: "", severity: "", certainty: "suspected" });
                      setAllergyOpen(false);
                      setNotice({ kind: "ok", text: "Allergy recorded." });
                      router.refresh();
                    }
                  }}>
                  <label className="sm:col-span-2">
                    <span className={LABEL}>Substance</span>
                    <input autoFocus required className={input} value={allergy.substance}
                      onChange={e => setAllergy(a => ({ ...a, substance: e.target.value }))}
                      placeholder="What are they allergic to?" />
                  </label>
                  <label className="sm:col-span-2">
                    <span className={LABEL}>What happened (optional)</span>
                    <input className={input} value={allergy.reaction}
                      onChange={e => setAllergy(a => ({ ...a, reaction: e.target.value }))}
                      placeholder="Rash, swelling, breathing difficulty" />
                  </label>
                  <div>
                    <span className={LABEL}>Severity</span>
                    <ul className="mt-1 flex flex-wrap gap-1">
                      {ALLERGY_SEVERITIES.map(sv => (
                        <li key={sv}>
                          <button type="button" className={allergy.severity === sv ? CHIP_ON : CHIP}
                            onClick={() => setAllergy(a => ({ ...a, severity: a.severity === sv ? "" : sv }))}>
                            {sv}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    {/* WARNING: THE DEFAULT IS "suspected" AND IT STAYS THAT WAY. Something a patient
                        reported is suspected until somebody establishes otherwise, and defaulting to
                        confirmed would put a certainty on the record that nobody claimed. */}
                    <span className={LABEL}>How certain</span>
                    <ul className="mt-1 flex flex-wrap gap-1">
                      {ALLERGY_CERTAINTIES.map(c => (
                        <li key={c}>
                          <button type="button" className={allergy.certainty === c ? CHIP_ON : CHIP}
                            onClick={() => setAllergy(a => ({ ...a, certainty: c }))}>
                            {c}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                  <button type="submit" className={`${BTN} sm:col-span-2`}
                    disabled={busy || !allergy.substance.trim()}>
                    Record this allergy
                  </button>
                </form>

                {/* == BLOOD GROUP, IN THE SAME PANEL AND ON THE SAME ENDPOINT =======================
                    WARNING: IT IS HERE RATHER THAN IN THE STRIP BECAUSE 45 SECONDS OUTRANKS A FIELD. A
                    second permanent control on the prescribing strip would be paid for by every
                    consultation, including the overwhelming majority that never touch it. The LINE is
                    shown below the allergy line so nobody has to open anything to READ it; the CONTROL
                    lives in the panel somebody already opened.

                    WARNING: OPTIONAL, AND SEPARATE FROM THE ALLERGY ANSWER. The route takes bloodGroup
                    with no status and returns early, so this is not a field anybody must clear to get
                    past, and pressing it does not answer the allergy question. */}
                <div className="mt-3 border-t border-gray-100 pt-2.5">
                  <span className={LABEL}>Blood group (optional)</span>
                  <p className="mt-0.5 text-[11px] text-gray-600">{props.bloodGroupLine.text}</p>
                  <ul className="mt-1 flex flex-wrap gap-1">
                    {BLOOD_GROUPS.map(g => (
                      <li key={g}>
                        <button type="button" data-step="blood-group" disabled={busy}
                          className={bloodGroup === g ? CHIP_ON : CHIP}
                          onClick={async () => {
                            setBloodGroup(g);
                            const body = await post(`/api/v1/practice/encounters/record/${props.patientId}/allergies`,
                              { bloodGroup: g }, "PUT");
                            if (body) { setNotice({ kind: "ok", text: `Blood group recorded as ${g}.` }); router.refresh(); }
                          }}>
                          {g}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}

            {!props.canEditPatient && !props.allergyLine.safeToRead && (
              <p className="mt-1 text-[10.5px] text-gray-500">
                Answering the allergy question needs the patient-edit permission. It is granted in Team
                and Permissions.
              </p>
            )}

          </div>
        </div>

        {/* ⚠ THE BLOOD GROUP LINE IS GONE FROM HERE (s12), NOT GONE. It is not routinely relevant to
            prescribing, so it was being read past on every consultation to reach the fields that are.
            It now sits in the details below, beside the other things worth having and not worth
            standing. The CONTROL was always in the allergy panel and has not moved. */}
        <div className="mt-2 flex items-start gap-2">
          <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold ${weightTone.chip}`}>
            {weightTone.mark} {weightTone.label}
          </span>
          <span className="text-[11px] text-gray-600">{med.weight.text}</span>
        </div>

        {med.active.length > 0 && (
          <p className="mt-2 text-[11px] text-gray-700">
            <span className="font-bold text-gray-900">Already taking:</span>{" "}
            {med.active.map(m => `${m.genericName} ${m.doseText}`).join(" · ")}
          </p>
        )}

        {/* ⚠ ONE DISCLOSURE FOR EVERY EXPLANATION ON THIS PANEL (s11). Three separate standing blocks --
            the allergy-matching notice, the nine deferred checks, the blood group -- became one line
            that opens. They were never read together and each was paid for separately.

            ⚠ THE SUMMARY NAMES THE NUMBER, so the line itself carries the fact that checks are NOT run.
            "Safety details" alone would let a closed disclosure read as a clean bill of health, which is
            exactly the inference s11 forbids: an unwarned screen must not read as a cleared screen. */}
        <Advisory
          summary={`What this screen does not check — ${med.notChecked.length} checks this product does not run`}
          count={med.notChecked.length}>
          {/* CPR-TRT-UI-002 s11: a green status is the RECORDED STATUS, never a drug-specific clearance.
              This is the engine's own sentence, not one composed here. */}
          <p className="text-[10.5px] text-gray-600">{med.allergyNotice}</p>
          <ul className="mt-1.5 flex flex-col gap-1">
            {med.notChecked.map(c => (
              <li key={c.key} className="text-[10.5px] text-gray-600">
                <span className="font-semibold text-gray-800">{c.label}</span> — {c.detail}
              </li>
            ))}
          </ul>
          <p className="mt-1 text-[10px] font-semibold text-gray-700">
            The absence of a warning on this screen carries no information about safety.
          </p>
          <p className="mt-2 border-t border-gray-100 pt-2 text-[10.5px] text-gray-600">
            <span className="font-bold text-gray-900">Blood group</span> {props.bloodGroupLine.text}
          </p>
        </Advisory>
        </div>
      </details>

      {!editable && (
        <p className="mt-3 text-[11px] text-gray-500">
          {props.locked
            ? "This consultation is signed, so nothing can be added to it."
            : "You do not have the permission that records a treatment."}
        </p>
      )}

      {editable && (
        <>
          {/* ══ TEMPLATES -- s12. ONE TAP LOADS THE WHOLE THING. ════════════════════════════════ */}
          {cap.templates.unavailable ? (
            <p className="mt-3 text-[11px] text-[var(--cmp-text-critical)]">{cap.templates.detail}</p>
          ) : cap.templates.items.length > 0 && (
            <div className={`${CARD} mt-3`}>
              <h4 className="text-[12px] font-bold text-gray-900">My templates</h4>
              <ul className="mt-2 flex flex-wrap gap-1.5">
                {cap.templates.items.map(t => (
                  <li key={t.id}>
                    <button type="button" data-step="apply-template" className={CHIP} disabled={busy}
                      onClick={() => {
                        for (const i of t.items) {
                          addToPlan({
                            treatmentType: i.treatmentType, label: i.label,
                            medicationRef: i.medicationRef, formulation: i.formulation,
                            dose: i.doseText, doseUnit: i.doseUnit, route: i.route,
                            frequencyCode: i.frequencyCode, frequencyText: i.frequencyText,
                            frequencyPerDay: null, duration: i.durationText,
                            nonDrugCategory: null, reason: i.reason, templateId: t.id,
                            brandName: null, strengthText: null,
                          });
                        }
                      }}>
                      {t.name}
                      <span className="ml-1 text-[9px] font-medium text-gray-400">
                        {t.items.length} item{t.items.length === 1 ? "" : "s"}
                        {t.ownerType === "practice" ? " · shared" : ""}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              <p className="mt-1.5 text-[10px] text-gray-500">{TEMPLATES_ARE_REVALIDATED}</p>
            </div>
          )}

          {/* ══ QUICK ADD -- s12's favourites and frequency, DERIVED ══════════════════════════════ */}
          {(cap.picker.frequentlyUsed.items.length > 0 || cap.picker.recent.items.length > 0) && (
            <div className={`${CARD} mt-3`}>
              <h4 className="text-[12px] font-bold text-gray-900">What you prescribe most</h4>
              <ul className="mt-2 flex flex-wrap gap-1.5">
                {cap.picker.frequentlyUsed.items.map(f => (
                  <li key={`freq-${f.genericName}`}>
                    <button type="button" data-step="quick-medication" className={CHIP} disabled={busy}
                      onClick={() => {
                        setDraft(d => ({ ...blankDraft("medication"), label: f.genericName, reason: d.reason ?? null }));
                        setMedQuery("");
                      }}>
                      {f.genericName}
                      <span className="ml-1 text-[9px] font-medium text-gray-400">{f.timesRecorded}x</span>
                    </button>
                  </li>
                ))}
                {cap.picker.recent.items
                  .filter(r => !cap.picker.frequentlyUsed.items.some(f => f.genericName === r.genericName))
                  .map(r => (
                    <li key={`recent-${r.genericName}`}>
                      <button type="button" data-step="quick-medication" className={CHIP} disabled={busy}
                        onClick={() => { setDraft(blankDraft("medication")); setDraft(d => ({ ...d, label: r.genericName })); setMedQuery(""); }}>
                        {r.genericName}
                        <span className="ml-1 text-[9px] font-medium text-gray-400">recent</span>
                      </button>
                    </li>
                  ))}
              </ul>
              <p className="mt-1.5 text-[10px] text-gray-500">{QUICK_ADD_NOT_A_RECOMMENDATION}</p>
            </div>
          )}

          {/* ══ THE BUILDER -- s3 and s5 ═════════════════════════════════════════════════════════
              The id is the header action's target. A "+ Add treatment" button that scrolled to nothing
              would be the same class of defect as a disabled button that cannot say why. */}
          <div id="treatment-composer" className={`${CARD} mt-3`}>
            <h4 className="text-[12px] font-bold text-gray-900">Add a treatment</h4>
            <p className="mt-0.5 text-[11.5px] text-gray-500">Choose what you want to add</p>

            {/* s3's types, CONFIGURED. Nothing in this component knows what a treatment type is. */}
            {opts("treatment_type").length === 0 ? (
              <p className="mt-1.5 text-[11px] text-gray-500">
                This practice has no treatment types enabled, so there is nothing to choose. They are set
                in Practice Setup.
              </p>
            ) : (
              <ul className="mt-2 flex flex-wrap gap-1.5">
                {opts("treatment_type").map(o => (
                  <li key={o.id}>
                    <button type="button" data-step="type" className={draft.treatmentType === o.code ? CHIP_ON : CHIP}
                      onClick={() => setDraft(d => ({ ...blankDraft(o.code), label: d.label, reason: d.reason }))}>
                      {o.label}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {shape.hint && <p className="mt-1.5 text-[10.5px] text-gray-500">{shape.hint}</p>}

            {/* s4's medication picker. Search over the configured name list, brand names and aliases. */}
            {shape.prescribing && (
              <div className="mt-2">
                <label className={LABEL}>Medication</label>
                <input className={input} value={draft.label ?? ""}
                  onChange={e => { setDraft(d => ({ ...d, label: e.target.value })); setMedQuery(e.target.value); }}
                  placeholder="Search by generic name, brand or abbreviation" />
                {cap.picker.catalogue.unavailable && (
                  <p className="mt-1 text-[10.5px] text-[var(--cmp-text-warning)]">
                    {cap.picker.catalogue.detail} You can still type the name.
                  </p>
                )}
                {medMatches.length > 0 && (
                  <ul className="mt-1 flex flex-wrap gap-1">
                    {medMatches.map(m => (
                      <li key={m.id}>
                        <button type="button" data-step="pick-medication" className={CHIP}
                          onClick={() => {
                            setDraft(d => ({
                              ...d, label: m.genericName, medicationRef: m.id,
                              brandName: m.brandName, strengthText: m.defaultStrength,
                              formulation: d.formulation ?? m.defaultFormulation,
                            }));
                            setMedQuery("");
                          }}>
                          {m.genericName}
                          {m.brandName && <span className="ml-1 text-[9px] text-gray-400">{m.brandName}</span>}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {!shape.prescribing && (
              <div className="mt-2">
                <label className={LABEL}>What</label>
                <input className={input} value={draft.label ?? ""}
                  onChange={e => setDraft(d => ({ ...d, label: e.target.value }))}
                  placeholder={shape.nonDrug ? "What is being done" : "In your words"} />
                {/* ⚠ THE ESCAPE HATCH KEEPS THE WORDS. s3's Other and s5's Other/custom. */}
                {draft.treatmentType === OTHER_OPTION_CODE && (
                  <p className="mt-1 text-[10px] text-gray-500">{CUSTOM_WORDING_PRESERVED}</p>
                )}
              </div>
            )}

            {/* s13's non-drug categories, CONFIGURED. */}
            {shape.nonDrug && (
              <PickSelect label="Category" options={opts("non_drug_category")}
                value={draft.nonDrugCategory} step="non-drug-category"
                onPick={(o) => setDraft(d => ({ ...d, nonDrugCategory: o?.code ?? null }))} />
            )}

            {/* s5's five tap-fields. EVERY ONE READ FROM CONFIGURATION. */}
            {/* ══ THE COMP'S FIELD ROW ═══════════════════════════════════════════════════════════
                Dose, unit, frequency, duration and route on ONE line, as labelled dropdowns.

                ⚠ THIS REPLACES THE CHIP ROWS I BUILT EARLIER TODAY, AND THE SPEC AND THE COMP DISAGREE
                HERE. s8's table asks for visible quick-choice CHIPS with the rest behind "Other". The
                owner's comp draws DROPDOWNS, and the owner has twice said to build the comp. A select
                satisfies what the chips were for -- s21 wants every configured value reachable within
                one additional interaction, and one click on a closed select is exactly that, with the
                practice's own sort_order deciding what sits at the top. It also costs one line instead
                of five, which is the whole complaint that started this.

                ⚠ NOTHING IS PRE-SELECTED. Each select opens on "Choose", not on the first configured
                option. s9 permits a default and REQUIRES its source be recorded for audit; there is
                nowhere to record that yet, and a default nobody can trace is indistinguishable from a
                clinical choice the practitioner made. */}
            {shape.prescribing && (
              <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
                {/* Formulation keeps s8's gate: it appears once a medication is named, because a
                    formulation chosen before the drug cannot be checked against anything. */}
                {(draft.label ?? "").trim() !== "" && (
                  <PickSelect label="Formulation" options={opts("formulation")} value={draft.formulation}
                    step="formulation"
                    onPick={o => setDraft(d => ({ ...d, formulation: o?.label ?? null }))} />
                )}
                <label className="block">
                  <span className={LABEL}>Dose</span>
                  <input className={input} value={draft.dose ?? ""}
                    onChange={e => setDraft(d => ({ ...d, dose: e.target.value }))} placeholder="500" />
                </label>
                <PickSelect label="Unit" options={opts("dose_unit")} value={draft.doseUnit}
                  step="dose-unit" onPick={o => setDraft(d => ({ ...d, doseUnit: o?.label ?? null }))} />
                <PickSelect label="Frequency" options={opts("frequency")} value={draft.frequencyCode} byCode
                  step="frequency"
                  onPick={o => setDraft(d => ({
                    ...d, frequencyCode: o?.code ?? null,
                    frequencyText: o && o.code !== OTHER_OPTION_CODE ? o.label : null,
                    frequencyPerDay: o?.numericValue ?? null,
                  }))} />
                <PickSelect label="Duration" options={opts("duration")} value={draft.duration}
                  step="duration" onPick={o => setDraft(d => ({ ...d, duration: o?.label ?? null }))} />
                <PickSelect label="Route" options={opts("route")} value={draft.route}
                  step="route" onPick={o => setDraft(d => ({ ...d, route: o?.label ?? null }))} />
              </div>
            )}
            {/* ⚠ s5, VERBATIM: "Selecting Other for Frequency opens a compact custom-frequency field.
                The exact entered wording must be preserved in the encounter record." Full width, under
                the row, because it is a sentence rather than a field. */}
            {shape.prescribing && draft.frequencyCode === OTHER_OPTION_CODE && (
              <div className="mt-2">
                <input autoFocus className={input} value={customFrequency}
                  onChange={e => setCustomFrequency(e.target.value)}
                  placeholder="In your own words — for example: every other day, in the morning" />
                <p className="mt-0.5 text-[10px] text-gray-500">{CUSTOM_WORDING_PRESERVED}</p>
              </div>
            )}

            {/* ⚠ s8's COLLAPSED NOTES -- BUT NEVER WHEN THIS PRACTICE REQUIRES THEM. A required field
                behind a disclosure makes the form refuse for a reason the practitioner cannot see, which
                is the same failure as a disabled button that cannot say why it is disabled. It also stays
                open once anything has been typed, so a collapse can never swallow entered text. */}
            {cap.reasonRequired || notesOpen || (draft.reason ?? "").trim() !== "" ? (
              <label className="mt-2 block">
                <span className={LABEL}>
                  Reason or notes {cap.reasonRequired ? "(required by this practice)" : "(optional)"}
                </span>
                <input className={input} value={draft.reason ?? ""}
                  onChange={e => setDraft(d => ({ ...d, reason: e.target.value }))} />
              </label>
            ) : (
              <button type="button" data-step="notes-toggle" className={`${QUIET} mt-2`}
                onClick={() => setNotesOpen(true)}>
                + Instructions / notes
              </button>
            )}

            {/* ══ s13's ADVANCED TOOLS, OFF THE DEFAULT FORM ══════════════════════════════════════
                ⚠ THE WEIGHT-BASED DOSE BUTTON WAS PERMANENT ON EVERY PRESCRIPTION and was paid for by
                the overwhelming majority that never open it. s13 moves it; it does NOT remove it, and
                the spec says so in as many words -- "Do not remove the underlying capability". The
                arithmetic is still medication.ts's, called rather than copied. */}
            {shape.prescribing && props.canPrescribe && (
              <div className="mt-2">
                <button type="button" data-step="more-options" className={QUIET}
                  onClick={() => setMoreOpen(o => !o)}>
                  {moreOpen ? "Fewer options" : "More options"}
                </button>
                {moreOpen && (
                <div className="mt-2">
                <button type="button" className={QUIET} onClick={() => setCalcOpen(o => !o)}>
                  {calcOpen ? "Close the dose calculator" : "Work out a weight-based dose"}
                </button>
                {calcOpen && (
                  <div className="mt-2 rounded-lg border border-gray-200 p-2.5">
                    <p className="text-[10.5px] text-gray-600">{med.weight.text}</p>
                    <div className="mt-2 grid gap-2 sm:grid-cols-3">
                      <label>
                        <span className={LABEL}>Basis</span>
                        <select className={input} value={calc.basis}
                          onChange={e => setCalc(c => ({ ...c, basis: e.target.value }))}>
                          {DOSE_BASES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                        </select>
                      </label>
                      {calc.basis === "fixed" ? (
                        <label>
                          <span className={LABEL}>Dose</span>
                          <input className={input} inputMode="decimal" value={calc.fixedDose}
                            onChange={e => setCalc(c => ({ ...c, fixedDose: e.target.value }))} />
                        </label>
                      ) : (
                        <label>
                          <span className={LABEL}>Rate</span>
                          <input className={input} inputMode="decimal" value={calc.rateValue}
                            onChange={e => setCalc(c => ({ ...c, rateValue: e.target.value }))} />
                        </label>
                      )}
                      <label>
                        <span className={LABEL}>Unit</span>
                        <input className={input} value={calc.doseUnit}
                          onChange={e => setCalc(c => ({ ...c, doseUnit: e.target.value }))} />
                      </label>
                      {calc.basis === "mg_per_kg_per_day" && (
                        <label>
                          <span className={LABEL}>Doses a day</span>
                          <input className={input} inputMode="decimal" value={calc.dosesPerDay}
                            onChange={e => setCalc(c => ({ ...c, dosesPerDay: e.target.value }))} />
                        </label>
                      )}
                    </div>

                    {/* ⚠ ROADS THAT END IN A REFUSAL ARE CLOSED BEFORE THEY ARE WALKED, exactly as
                        MedicationConsole closes them. The same verdicts, from the same payload. */}
                    {bsaImpossible && (
                      <div className="mt-2 rounded-lg bg-[var(--cmp-surface-warning)] px-2.5 py-2">
                        <p className="text-[11px] font-bold text-[var(--cmp-text-warning)]">
                          A body surface area dose cannot be recorded for this patient.
                        </p>
                        <p className="mt-1 text-[11px] text-gray-700">{BSA_NEEDS_MEASUREMENTS}</p>
                      </div>
                    )}
                    {adultNoWeight && (
                      <div className="mt-2 rounded-lg bg-[var(--cmp-surface-warning)] px-2.5 py-2">
                        <p className="text-[11px] font-bold text-[var(--cmp-text-warning)]">
                          A weight-based dose cannot be worked out for this patient.
                        </p>
                        <p className="mt-1 text-[11px] text-gray-700">{ADULT_NO_WEIGHT_REFUSED}</p>
                      </div>
                    )}
                    {decisionRequired && (
                      <div className="mt-2 rounded-lg border border-amber-300 bg-amber-50 p-2.5">
                        <p className="text-[11px] font-bold text-amber-900">{weightDecisionHeadline(med.weight.state)}</p>
                        <p className="mt-1 text-[11px] text-gray-700">{WEIGHT_DECISION_ASK}</p>
                        <textarea className={`${input} mt-1 min-h-[52px]`} value={calc.weightDecision}
                          onChange={e => setCalc(c => ({ ...c, weightDecision: e.target.value }))}
                          placeholder="In your own words — what are you prescribing on?" />
                      </div>
                    )}

                    <button type="button" className={`${BTN} mt-2`}
                      disabled={busy || bsaImpossible || adultNoWeight || decisionMissing}
                      onClick={async () => {
                        const body = await post("/api/v1/practice/medications", {
                          action: "calculateDose", patientId: props.patientId, encounterId: props.encounterId,
                          basis: calc.basis, rateValue: calc.rateValue || null, fixedDose: calc.fixedDose || null,
                          doseUnit: calc.doseUnit || "mg", dosesPerDay: calc.dosesPerDay || null,
                          weightDecision: decisionRequired ? (calc.weightDecision || null) : null,
                        });
                        if (body) setDose(body as unknown as DoseCalculationResult);
                      }}>
                      {decisionRequired ? "Record this decision" : "Calculate"}
                    </button>

                    {/* ⚠ THE FIGURE, ITS WORKING AND ITS NOTICE ARE ONE BLOCK. Nothing renders the
                        number alone -- MedicationConsole's rule 1, and it holds here for the same
                        reason: a dose with no working beside it is unverifiable six months later. */}
                    {dose && (
                      <div className="mt-2 rounded-lg bg-gray-50 p-2.5">
                        <p className="text-[13px] font-bold text-gray-900">
                          {dose.perDose !== null ? `${dose.perDose} ${dose.unit} per dose`
                            : dose.dailyTotal !== null ? `${dose.dailyTotal} ${dose.unit} per day`
                              : dose.weightDecision ? "No dose figure — a decision was recorded instead"
                                : "no figure"}
                        </p>
                        <ol className="mt-1 flex flex-col gap-0.5">
                          {dose.working.map((w, i) => <li key={i} className="font-mono text-[10px] text-gray-700">{w}</li>)}
                        </ol>
                        <p className="mt-2 rounded bg-white px-2 py-1.5 text-[10px] text-slate-600">{doseSafetyNotice()}</p>
                        {(dose.perDose !== null || dose.dailyTotal !== null) && (
                          <button type="button" className={`${QUIET} mt-2`}
                            onClick={() => setDraft(d => ({
                              ...d,
                              dose: d.dose || (dose.perDose !== null ? String(dose.perDose) : String(dose.dailyTotal)),
                              doseUnit: d.doseUnit || dose.unit,
                            }))}>
                            Use this as the dose
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )}
                </div>
                )}
              </div>
            )}

            <button type="button" data-step="add-to-plan" className={`${QUIET} mt-3`}
              disabled={busy || !draft.label?.trim()} onClick={commitDraft}>
              Add to the plan
            </button>
          </div>

          {/* ══ s9's PENDING PLAN AND ONE BATCH RECORD ═══════════════════════════════════════════ */}
          <div className={`${CARD} mt-3`}>
            <div className="flex items-baseline gap-2 flex-wrap">
              <h4 className="text-[12px] font-bold text-gray-900">
                {recordCount === 0 ? "Nothing to record yet" : `${recordCount} to record`}
              </h4>
            </div>

            {/* ⚠ THIS SENTENCE ONCE SAID "Nothing is written until you do" -- true of the two-step form,
                and FALSE the moment the record button started accepting the draft. Guidance describing
                behaviour the product no longer has is worse than none: it is read as authoritative and
                it teaches the wrong model. It is replaced, not merely reworded, and "Add to the plan"
                is now correctly described as OPTIONAL -- it is for building several, not a toll gate. */}
            {plan.length === 0 && !!draft.label?.trim() && (
              <p className="mt-1 text-[11.5px] text-gray-600">
                <strong>{draft.label.trim()}</strong> will be recorded when you press the button below.
                Use <strong>Add to the plan</strong> first only to build up several together.
              </p>
            )}
            {recordCount === 0 && (
              <p className="mt-1 text-[11.5px] text-gray-500">
                Build a treatment above, then record it. Use <strong>Add to the plan</strong> if you
                want several recorded together.
              </p>
            )}

            {plan.length > 0 && (
              <ul className="mt-2 flex flex-col gap-1">
                {plan.map((p, i) => (
                  <li key={i} className="flex items-start gap-2 rounded-lg bg-gray-50 px-2.5 py-1.5">
                    <div className="min-w-0">
                      <span className="text-[12px] font-semibold text-gray-800">{p.label}</span>
                      <span className="ml-1.5 rounded bg-white px-1.5 py-0.5 text-[9px] font-semibold text-gray-500">
                        {String(p.treatmentType).replace(/_/g, " ")}
                      </span>
                      <p className="text-[11px] text-gray-600">
                        {[p.formulation, [p.dose, p.doseUnit].filter(Boolean).join(" "), p.route,
                          p.frequencyText, p.duration, p.nonDrugCategory].filter(Boolean).join(" · ")}
                      </p>
                      {p.reason && <p className="text-[10.5px] text-gray-500">{p.reason}</p>}
                    </div>
                    <div className="ml-auto flex shrink-0 gap-1">
                      <button type="button" className={QUIET}
                        onClick={() => { setDraft(p); setPlan(list => list.filter((_, n) => n !== i)); }}>
                        Edit
                      </button>
                      <button type="button" className={QUIET}
                        onClick={() => setPlan(list => list.filter((_, n) => n !== i))}>
                        Remove
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}

            <p className="mt-2 text-[10px] text-gray-500">{BATCH_BOUNDARY}</p>

            {/* ⚠ ENABLED BY WHAT IT WILL WRITE, not by the plan alone. A finished draft used to leave
                this DISABLED, and a disabled control cannot explain itself: the press produced no
                write, no refusal and no message, which is exactly how a working screen came to be
                reported as broken. STILL DISABLED AT recordCount === 0 -- there is genuinely nothing
                to write then, and the sentence above says what to do. */}
            <button type="button" data-step="record-batch" className={`${BTN} mt-2`}
              disabled={busy || recordCount === 0} onClick={record}>
              {busy ? "Recording…" : `Record ${recordCount || ""} treatment${recordCount === 1 ? "" : "s"}`}
            </button>

            {itemResults.length > 0 && (
              <ul className="mt-2 flex flex-col gap-1">
                {itemResults.map((r, i) => (
                  <li key={i} className={`text-[11px] ${r.ok ? "text-gray-600" : "text-[var(--cmp-text-critical)]"}`}>
                    <strong>{r.label}</strong> — {r.ok ? (r.message ?? "recorded") : r.message}
                  </li>
                ))}
              </ul>
            )}

            {plan.length > 0 && (
              <div className="mt-2">
                {savingTemplate ? (
                  <form className="flex flex-wrap items-center gap-1.5"
                    onSubmit={async ev => {
                      ev.preventDefault();
                      const body = await post("/api/v1/practice/treatment-capture", {
                        action: "saveTemplate", name: templateName, ownerType: "practitioner", items: plan,
                      });
                      if (body) { setSavingTemplate(false); setTemplateName(""); setNotice({ kind: "ok", text: "Template saved." }); router.refresh(); }
                    }}>
                    <input autoFocus className={`${input} max-w-[260px]`} value={templateName}
                      onChange={e => setTemplateName(e.target.value)} placeholder="Name this template" />
                    <button type="submit" className={QUIET} disabled={busy || !templateName.trim()}>Save</button>
                    <button type="button" className={QUIET} onClick={() => setSavingTemplate(false)}>Cancel</button>
                  </form>
                ) : (
                  <button type="button" className={QUIET} onClick={() => setSavingTemplate(true)}>
                    Save this plan as a template
                  </button>
                )}
              </div>
            )}
          </div>

          {/* ⚠ WHAT THIS CAPABILITY DECLINES TO DO, ON THE SCREEN. */}
          <ul className="mt-3 flex flex-col gap-1">
            {TREATMENT_REFUSALS.map(r => (
              <li key={r.key} className="text-[10.5px] text-gray-500">
                <span className="font-semibold text-gray-700">{r.what}</span> {r.why}
              </li>
            ))}
          </ul>
        </>
      )}
      </div>
    </section>
  );
}

/**
 * One configured list, drawn as taps with the Other escape hatch already inside it.
 *
 * ⚠ IT TAKES THE OPTIONS AS DATA AND KNOWS NOTHING ABOUT WHAT THEY MEAN. That is CPR-TREAT-001 s6's
 * frozen requirement expressed as a component boundary: this function cannot hard-code a clinical value
 * because it has never been told what one looks like.
 */
/**
 * CPR-TRT-UI-002 s8's PROGRESSIVE DISCLOSURE. Common choices are drawn; the rest are one tap away.
 *
 * ⚠ THE QUICK SET IS THE FIRST N IN THE PRACTICE'S OWN ORDER, WHICH NEEDS NO NEW CONFIGURATION.
 * s17 requires the quick subset to be configurable, and it already is: loadTreatmentOptions sorts by
 * sort_order with each practice's sort_order_override applied, so a practice that wants BD first moves
 * it on the configuration screen it already has. A `quick boolean` column would have been a second
 * thing to configure that says the same thing as the first, and two sources for one answer drift.
 *
 * ⚠ THE SELECTED OPTION IS ALWAYS DRAWN, even when it sorts outside the quick set. Without this,
 * choosing a rare route from More and then re-rendering would show nothing selected -- the practitioner
 * reads their own choice as lost and picks again, and the second pick is the one that gets recorded.
 *
 * ⚠ NOTHING IS PRE-SELECTED HERE. s9 permits pre-populating a configured default, but s9 also REQUIRES
 * the source of any default to be preserved for audit, and s20 wants to know whether each value was
 * typed, taken from the catalogue or loaded from a shortcut. There is nowhere to record that yet, and a
 * default nobody can trace is worse than a field the practitioner filled -- it would be indistinguishable


/**
 * One configured field as a labelled dropdown -- the comp's shape for dose unit, frequency, duration,
 * route and formulation.
 *
 * ⚠ THIS REPLACED A CHIP ROW WITH A "N more" DISCLOSURE, AND THE PROPERTY IT GUARANTEED SURVIVES.
 * s21 requires every configured value to stay reachable within one additional interaction: one click on
 * a closed select is that, and unlike the chips it costs one line rather than five. The practice's own
 * sort_order still decides what sits at the top of the list, so which values come first is configured
 * where it always was, with no second place to set it.
 *
 * ⚠ THE PLACEHOLDER IS "Choose", NOT THE FIRST OPTION. A select that opens already showing a value has
 * made a clinical choice on the practitioner's behalf and recorded it as theirs. s9 permits a default
 * only where its SOURCE can be preserved for audit, and nothing here can record that yet.
 *
 * ⚠ AND IT IS A REAL <select>, so it is keyboard-operable, type-ahead searchable and readable by a
 * screen reader without any work -- which the chip row only approximated.
 */
function PickSelect({ label, options, value, onPick, step, byCode }: {
  label: string;
  options: TreatmentOption[];
  value: string | null | undefined;
  onPick: (o: TreatmentOption | null) => void;
  step: string;
  byCode?: boolean;
}) {
  if (options.length === 0) return null;
  const current = options.find(o => (byCode ? value === o.code : value === o.label));
  return (
    <label className="block">
      <span className={LABEL}>{label}</span>
      <select className={input} data-step={step} value={current?.id ?? ""}
        onChange={e => onPick(options.find(o => o.id === e.target.value) ?? null)}>
        <option value="">Choose</option>
        {options.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
      </select>
    </label>
  );
}
