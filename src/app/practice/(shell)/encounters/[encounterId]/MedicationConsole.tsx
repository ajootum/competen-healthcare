"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  DOSE_BASES, MEDICATION_SOURCES, MEDICATION_STATUS_CHIP, MEDICATION_STATUS_LABEL,
  WEIGHT_TONE, NOT_CHECKED_TONE, NOT_CHECKED_LABEL, doseSafetyNotice,
  WEIGHT_STATES_NEEDING_DECISION, weightDecisionHeadline, WEIGHT_DECISION_ASK,
  BSA_NEEDS_MEASUREMENTS, ADULT_NO_WEIGHT_REFUSED,
} from "@/lib/practice/medication-constants";
import { NotCheckedPanel } from "../../patients/[patientId]/MedicationPanel";
import type { PatientMedications, DoseCalculationResult } from "@/lib/practice/medication";

// CPR-MED-001 -- PRESCRIBING, INSIDE THE CONSULTATION.
//
// The record is a tab in the Patient Workspace. THE ACT OF PRESCRIBING BELONGS HERE, because it is a
// decision taken with a patient in front of you, and MED s9's "minimal-click workflow" means not leaving
// the consultation to make it.
//
// ⚠ FOUR RULES THIS COMPONENT ENFORCES BY WHAT IT DOES AND DOES NOT DRAW:
//
//  1. THE DOSE FIGURE IS NEVER SHOWN WITHOUT ITS WORKING AND ITS NOTICE. doseSafetyNotice() is rendered
//     immediately beside every computed number, and the working -- every step of the multiplication --
//     is above it. A dose with no working beside it is unverifiable by the person who produced it, six
//     months later, and this is the one domain where that is directly a harm.
//
//  2. THE NINE DEFERRED CHECKS ARE ON THE PRESCRIBING SCREEN, NOT IN A DOCUMENT. An unwarned screen
//     reads as a cleared screen. The panel says, in those words, that the absence of a warning here
//     carries no information about safety.
//
//  3. THE ALLERGIES ARE BESIDE THE FORM AND ARE NOT MATCHED. Migration 238 made the substance free text
//     deliberately, and a medication name is free text for the same reason. A person does the comparison
//     a computer cannot honestly do here, so the list is put where they will read it.
//
//  4. THE WEIGHT VERDICT IS SHOWN BEFORE THE CALCULATOR, NOT AFTER THE ERROR. LCP s9: "A weight-
//     dependent paediatric dose requires a usable dosing weight." A prescriber should know the weight is
//     three months old before they type a rate, not when the server refuses them.
//
//  5. WITH NO WEIGHT, THE SCREEN ASKS FOR A DECISION -- AND STILL PRODUCES NO NUMBER. The user's ruling
//     of 2026-08-08. Refusing outright was considered and rejected: a prescriber who cannot get an answer
//     out of the product works the dose out on paper, and then the decision has happened anyway with
//     nothing recording that it did. So the prompt appears, the words are recorded on the calculation and
//     on the override register, and NO FIGURE IS INVENTED -- the field asks what the prescriber is
//     working from, never for a weight to multiply by.
//
// ⚠ AND THE SCREEN NEVER OFFERS A ROAD THAT ENDS IN A REFUSAL IT COULD HAVE PREDICTED. mg/m2 with no
// weight cannot be recorded at all -- migration 265 keeps bsa_m2 required, because a decision may stand
// in for a missing measurement but not for the arithmetic -- so that combination is explained and the
// button is disabled, rather than asking for a decision and then throwing it away.
//
// ⚠ TYPE-ONLY IMPORT FROM THE ENGINE -- see the note in ParameterCollection.tsx.

const CARD = "mt-4 rounded-xl border border-gray-200 bg-white p-4";
// ⚠ CPR-MOB-001 s4/s16, ON THE PRESCRIBING SURFACE — WHICH IS WHY IT IS ONLY THE CLASSES.
// This console is pinned expression-by-expression by three harnesses and it is the one form on this
// screen where a mistyped character is a dose. So nothing here changes except the size of the targets:
// 44px on the fields (s4's floor; the dose calculator's inputs were ~30px), 48px on the primary
// actions, and the 16px field size that stops iOS zooming the page on focus mid-prescription. Every
// suffix is `max-md:` — inert at md and up. No field was reordered, retyped, rebound or removed, and
// the inputMode="decimal" this file already carries on every numeric field is what s16 asks for.
const input = "w-full rounded-lg border border-gray-200 bg-white text-gray-900 placeholder:text-gray-400 px-2.5 py-1.5 text-[12px] outline-none focus:border-[var(--cp-primary)] focus:ring-2 focus:ring-[var(--cp-primary)]/10 max-md:min-h-[var(--cp-touch)] max-md:text-[16px]";
const BTN = "rounded-lg bg-[var(--cp-primary)] px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-[var(--cp-primary-deep)] disabled:opacity-50 max-md:inline-flex max-md:min-h-[var(--cp-touch-primary)] max-md:items-center max-md:justify-center max-md:px-4 max-md:text-[14px]";
const QUIET = "rounded-lg border border-gray-200 px-2.5 py-1.5 text-[11px] font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50 max-md:inline-flex max-md:min-h-[var(--cp-touch)] max-md:items-center max-md:justify-center max-md:px-3.5 max-md:text-[12.5px]";
const LABEL = "block text-[10px] font-semibold uppercase tracking-wide text-gray-500";

export default function MedicationConsole({ record, patientId, encounterId, canRecord, locked }: {
  record: PatientMedications;
  patientId: string;
  encounterId: string;
  canRecord: boolean;
  locked: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dose, setDose] = useState<DoseCalculationResult | null>(null);

  const [form, setForm] = useState({
    genericName: "", brandName: "", strengthText: "", doseText: "", route: "", frequency: "",
    frequencyPerDay: "", durationText: "", indication: "", source: "practitioner",
  });
  const [calc, setCalc] = useState({ basis: "mg_per_kg", rateValue: "", fixedDose: "", doseUnit: "mg", dosesPerDay: "", overrideReason: "", weightDecision: "" });
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }));
  const setC = (k: keyof typeof calc) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setCalc(c => ({ ...c, [k]: e.target.value }));

  async function post(action: string, payload: Record<string, unknown>): Promise<Record<string, unknown> | null> {
    setBusy(true); setError(null);
    try {
      const res = await fetch("/api/v1/practice/medications", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, ...payload }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setError(body?.error?.message ?? `That did not work (${res.status}).`); return null; }
      return body;
    } finally { setBusy(false); }
  }

  if (!record.permitted) return null;

  const weightTone = WEIGHT_TONE[record.weight.state] ?? { chip: NOT_CHECKED_TONE, mark: "–", label: NOT_CHECKED_LABEL };
  const needsWeight = calc.basis === "mg_per_kg" || calc.basis === "mg_per_kg_per_day" || calc.basis === "mg_per_m2";
  const overrideOffered = needsWeight && (record.weight.state === "stale" || record.weight.state === "implausible");
  // ⚠ THE SAME TWO STATES THE ENGINE AND MIGRATION 259 USE, IMPORTED RATHER THAN RETYPED. A screen with
  // its own copy of this list is a screen that stops asking the day a sixth weight state is added.
  const noWeightAtAll = needsWeight
    && (WEIGHT_STATES_NEEDING_DECISION as readonly string[]).includes(record.weight.state);
  // mg/m2 with no weight cannot be recorded by anybody, decision or not. Explained, never asked for.
  const bsaImpossible = noWeightAtAll && calc.basis === "mg_per_m2";
  // ⚠ THE USER'S NARROWING OF 2026-08-08: the decision path is for children only, and for patients whose
  // age nothing states. The screen reads the SAME verdict the engine gates on -- a screen with its own
  // age arithmetic is a screen that offers a door the server closes.
  const adultNoWeight = noWeightAtAll && !bsaImpossible && !record.age.decisionPathOffered;
  const decisionRequired = noWeightAtAll && !bsaImpossible && record.age.decisionPathOffered;
  const decisionMissing = decisionRequired && !calc.weightDecision.trim();

  return (
    <section className={CARD}>
      <div className="flex items-baseline gap-2 flex-wrap">
        <h2 className="text-[13px] font-bold text-gray-900">Medication</h2>
        <span className="text-[11px] text-gray-500">
          {record.storeState === "present" ? `${record.active.length} in use` : "record unavailable"}
        </span>
        <Link href={`/practice/patients/${patientId}`} className="ml-auto text-[11px] font-semibold text-[var(--cp-primary-deep)] hover:underline">
          Full record &rarr;
        </Link>
      </div>

      {record.storeState === "absent" && (
        <p className="mt-2 rounded-lg bg-[var(--cmp-surface-warning)] px-3 py-2 text-[12px] text-[var(--cmp-text-warning)]">
          {record.storeNotice}
        </p>
      )}
      {record.unavailable && (
        <p className="mt-2 rounded-lg bg-[var(--cmp-surface-critical)] px-3 py-2 text-[12px] text-[var(--cmp-text-critical)]">
          {record.detail} This is <strong>not</strong> the same as this patient taking nothing.
        </p>
      )}
      {error && (
        <p className="mt-2 rounded-lg bg-[var(--cmp-surface-critical)] px-3 py-2 text-[12px] text-[var(--cmp-text-critical)]">{error}</p>
      )}

      {/* ── WHAT THEY ARE ALREADY ON. Read before prescribing, so it is above the form. ──────────── */}
      {record.active.length > 0 && (
        <ul className="mt-2 flex flex-col">
          {record.active.map(m => (
            <li key={m.id} className="flex items-baseline gap-2 border-b border-gray-100 py-1 last:border-0">
              <span className="truncate text-[12px] text-gray-800">
                <span className="font-semibold">{m.genericName}</span>{" "}
                <span className="text-gray-500">{[m.doseText, m.route, m.frequency].filter(Boolean).join(" · ")}</span>
              </span>
              <span className={`ml-auto shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold ${MEDICATION_STATUS_CHIP[m.status] ?? "bg-slate-100 text-slate-600"}`}>
                {MEDICATION_STATUS_LABEL[m.status] ?? m.status}
              </span>
            </li>
          ))}
        </ul>
      )}

      {/* ── ALLERGIES: DISPLAYED, NEVER MATCHED, AND BESIDE THE FORM RATHER THAN A TAB AWAY. ────── */}
      <div className="mt-3 rounded-lg bg-gray-50 p-3">
        <span className="text-[11px] font-bold text-gray-900">Allergies</span>{" "}
        {record.allergies.unavailable ? (
          <span className="text-[11px] text-[var(--cmp-text-critical)]">{record.allergies.detail}</span>
        ) : record.allergies.items.length === 0 ? (
          <span className="text-[11px] text-gray-500">none listed &mdash; which is not the same as none existing</span>
        ) : (
          <span className="text-[11px] text-gray-800">
            {record.allergies.items.map(a => `${a.substance}${a.severity ? ` (${a.severity})` : ""}`).join(" · ")}
          </span>
        )}
        <p className="mt-1 text-[10px] text-gray-500">{record.allergyNotice}</p>
      </div>

      {/* ── LCP s9's WEIGHT VERDICT, BEFORE THE CALCULATOR. ─────────────────────────────────────── */}
      <div className="mt-3 flex items-start gap-2">
        <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold ${weightTone.chip}`}>
          {weightTone.mark} {weightTone.label}
        </span>
        <span className="text-[11px] text-gray-600">{record.weight.text}</span>
      </div>

      {canRecord && !locked && (
        <>
          {/* ── s3 THE DOSE CALCULATOR ────────────────────────────────────────────────────────── */}
          <div className="mt-4 rounded-lg border border-gray-200 p-3">
            <h3 className="text-[12px] font-bold text-gray-900">Work out a dose</h3>
            <div className="mt-2 grid sm:grid-cols-3 gap-2">
              <label>
                <span className={LABEL}>Basis</span>
                <select className={input} value={calc.basis} onChange={setC("basis")}>
                  {DOSE_BASES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select>
              </label>
              {calc.basis === "fixed" ? (
                <label>
                  <span className={LABEL}>Dose</span>
                  <input className={input} value={calc.fixedDose} onChange={setC("fixedDose")} inputMode="decimal" placeholder="500" />
                </label>
              ) : (
                <label>
                  <span className={LABEL}>Rate</span>
                  <input className={input} value={calc.rateValue} onChange={setC("rateValue")} inputMode="decimal" placeholder="15" />
                </label>
              )}
              <label>
                <span className={LABEL}>Unit</span>
                <input className={input} value={calc.doseUnit} onChange={setC("doseUnit")} placeholder="mg" />
              </label>
              {calc.basis === "mg_per_kg_per_day" && (
                <label>
                  <span className={LABEL}>Doses a day</span>
                  <input className={input} value={calc.dosesPerDay} onChange={setC("dosesPerDay")} inputMode="decimal" placeholder="3" />
                </label>
              )}
            </div>

            {/* ⚠ THE OVERRIDE FIELD APPEARS ONLY WHEN SOMETHING WAS ACTUALLY SAID ABOUT THE WEIGHT. A
                reason box on every prescription would train people to type into it, and the register of
                real overrides would be buried in noise. */}
            {overrideOffered && (
              <label className="mt-2 block">
                <span className={LABEL}>Why prescribe on this weight anyway</span>
                <input className={input} value={calc.overrideReason} onChange={setC("overrideReason")}
                  placeholder="Recorded on this medication's timeline and on the practice override register" />
              </label>
            )}

            {/* ⚠ THE ROAD THAT ENDS NOWHERE, CLOSED BEFORE IT IS WALKED. No decision field is drawn here,
                because writing one would not produce a row: a surface area is arithmetic, not a
                judgement, and there is nothing to compute it from. */}
            {bsaImpossible && (
              <div className="mt-2 rounded-lg bg-[var(--cmp-surface-warning)] px-3 py-2">
                <p className="text-[11px] font-bold text-[var(--cmp-text-warning)]">
                  A body surface area dose cannot be recorded for this patient.
                </p>
                <p className="mt-1 text-[11px] text-gray-700">{record.weight.text}</p>
                <p className="mt-1 text-[11px] text-gray-700">{BSA_NEEDS_MEASUREMENTS}</p>
              </div>
            )}

            {/* ⚠ THE ADULT BRANCH, AND IT OFFERS NOTHING TO TYPE. The user's narrowing of 2026-08-08
                confines the recorded decision to children. For an adult this is the refusal that stood
                before migration 265, and naming the other road -- even to rule it out -- would teach a
                prescriber that a form of words exists which gets a number out of this product. */}
            {adultNoWeight && (
              <div className="mt-2 rounded-lg bg-[var(--cmp-surface-warning)] px-3 py-2">
                <p className="text-[11px] font-bold text-[var(--cmp-text-warning)]">
                  A weight-based dose cannot be worked out for this patient.
                </p>
                <p className="mt-1 text-[11px] text-gray-700">{record.weight.text}</p>
                <p className="mt-1 text-[11px] text-gray-700">{ADULT_NO_WEIGHT_REFUSED}</p>
              </div>
            )}

            {/* ⚠ THE PROMPT THE RULING OF 2026-08-08 ASKS FOR. It appears ONLY when the basis is a
                function of weight AND there is no weight to work from -- never on a fixed dose, whose
                patients have mostly never been weighed and for whom nothing is wrong.

                ⚠ FREE TEXT AND A TEXTAREA, NOT A DROPDOWN. Migration 259's reasoning: the reasons are not
                enumerable in advance, and a closed list would be excuses to pick from with the one that
                mattered always missing. */}
            {decisionRequired && (
              <div className="mt-2 rounded-lg border border-amber-300 bg-amber-50 p-3">
                <p className="text-[11px] font-bold text-amber-900">{weightDecisionHeadline(record.weight.state)}</p>
                <p className="mt-1 text-[11px] text-gray-700">{WEIGHT_DECISION_ASK}</p>
                <label className="mt-2 block">
                  <span className={LABEL}>What are you prescribing on</span>
                  <textarea className={`${input} min-h-[56px]`} value={calc.weightDecision} onChange={setC("weightDecision")}
                    placeholder="In your own words — for example: mother reports 12 kg weighed at the health centre last week; no scale here today." />
                </label>
              </div>
            )}

            <button className={`${BTN} mt-2`} disabled={busy || bsaImpossible || adultNoWeight || decisionMissing}
              onClick={async () => {
                const body = await post("calculateDose", {
                  patientId, encounterId, basis: calc.basis,
                  rateValue: calc.rateValue || null, fixedDose: calc.fixedDose || null,
                  doseUnit: calc.doseUnit || "mg", dosesPerDay: calc.dosesPerDay || null,
                  overrideReason: calc.overrideReason || null,
                  // ⚠ SENT ONLY WHERE IT MEANS SOMETHING. The engine REFUSES a decision supplied against a
                  // weight that exists rather than dropping it, so a sticky form field must not leak into
                  // the next patient's prescription.
                  weightDecision: decisionRequired ? (calc.weightDecision || null) : null,
                });
                if (body) setDose(body as unknown as DoseCalculationResult);
              }}>
              {busy ? "Working…" : decisionRequired ? "Record this decision" : "Calculate"}
            </button>
            {decisionMissing && (
              <p className="mt-1 text-[10px] text-amber-800">
                There is nothing to record until you have said what you are prescribing on. The decision is
                the record here &mdash; no figure is produced.
              </p>
            )}

            {/* ⚠ THE FIGURE, ITS WORKING AND ITS NOTICE ARE ONE BLOCK. Nothing renders the number alone. */}
            {dose && (
              <div className="mt-3 rounded-lg bg-gray-50 p-3">
                {/* ⚠ "no figure" IS A SENTENCE HERE, NOT A DASH. With a recorded decision both numbers are
                    null BY DESIGN, and a screen that printed a blank would read as a calculation that
                    failed rather than one this product declined to invent. */}
                <p className="text-[13px] font-bold text-gray-900">
                  {dose.perDose !== null ? `${dose.perDose} ${dose.unit} per dose`
                    : dose.dailyTotal !== null ? `${dose.dailyTotal} ${dose.unit} per day`
                      : dose.weightDecision ? "No dose figure — a decision was recorded instead"
                        : "no figure"}
                </p>
                <ol className="mt-1 flex flex-col gap-0.5">
                  {dose.working.map((w, i) => <li key={i} className="font-mono text-[10px] text-gray-700">{w}</li>)}
                </ol>
                {dose.weightDecision && (
                  <p className="mt-1 text-[10px] font-semibold text-amber-800">
                    Recorded on this calculation and on the practice override register: &ldquo;{dose.weightDecision}&rdquo;
                    {" "}Any dose you give is yours, not one this product worked out.
                  </p>
                )}
                {dose.overridden && (
                  <p className="mt-1 text-[10px] font-semibold text-rose-700">
                    Recorded as a safety override: this was calculated on a weight the record flagged.
                  </p>
                )}
                {/* ⚠ THE REASON, NOT A GUESS AT IT. This used to assert the store was missing whatever
                    had actually gone wrong, which would send somebody hunting for an applied migration. */}
                {dose.notStored && (
                  <p className="mt-1 text-[10px] font-semibold text-amber-700">{dose.notStored}</p>
                )}
                <p className="mt-2 rounded bg-white px-2 py-1.5 text-[10px] text-slate-600">{doseSafetyNotice()}</p>
                {/* ⚠ OFFERED ONLY WHEN THERE IS A FIGURE TO CARRY. With both totals null this button used
                    to write the literal string "null mg per day" into the dose on the prescription. */}
                {(dose.perDose !== null || dose.dailyTotal !== null) && (
                  <button className={`${QUIET} mt-2`} onClick={() => setForm(f => ({
                    ...f,
                    doseText: f.doseText || (dose.perDose !== null ? `${dose.perDose} ${dose.unit}` : `${dose.dailyTotal} ${dose.unit} per day`),
                  }))}>
                    Use this as the dose
                  </button>
                )}
              </div>
            )}
          </div>

          {/* ── s2 RECORD THE MEDICATION ──────────────────────────────────────────────────────── */}
          <div className="mt-3 grid sm:grid-cols-3 gap-2">
            <label className="sm:col-span-2">
              <span className={LABEL}>Medication</span>
              <input className={input} value={form.genericName} onChange={set("genericName")} placeholder="Generic name" />
            </label>
            <label>
              <span className={LABEL}>Brand</span>
              <input className={input} value={form.brandName} onChange={set("brandName")} />
            </label>
            <label>
              <span className={LABEL}>Strength</span>
              <input className={input} value={form.strengthText} onChange={set("strengthText")} placeholder="250 mg/5 mL" />
            </label>
            <label>
              <span className={LABEL}>Dose</span>
              <input className={input} value={form.doseText} onChange={set("doseText")} placeholder="375 mg" />
            </label>
            <label>
              <span className={LABEL}>Route</span>
              <input className={input} value={form.route} onChange={set("route")} placeholder="oral" />
            </label>
            <label>
              <span className={LABEL}>Frequency</span>
              <input className={input} value={form.frequency} onChange={set("frequency")} placeholder="three times a day" />
            </label>
            <label>
              <span className={LABEL}>Doses a day</span>
              <input className={input} value={form.frequencyPerDay} onChange={set("frequencyPerDay")} inputMode="decimal" placeholder="3" />
            </label>
            <label>
              <span className={LABEL}>Duration</span>
              <input className={input} value={form.durationText} onChange={set("durationText")} placeholder="5 days" />
            </label>
            <label>
              <span className={LABEL}>Indication</span>
              <input className={input} value={form.indication} onChange={set("indication")} />
            </label>
            <label>
              <span className={LABEL}>How this was recorded</span>
              <select className={input} value={form.source} onChange={set("source")}>
                {MEDICATION_SOURCES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </label>
          </div>
          <p className="mt-1 text-[10px] text-gray-500">
            {MEDICATION_SOURCES.find(([k]) => k === form.source)?.[2]}
          </p>

          <button className={`${BTN} mt-2`} disabled={busy || !form.genericName.trim() || !form.doseText.trim()}
            onClick={async () => {
              const body = await post("record", {
                patientId, encounterId,
                genericName: form.genericName, brandName: form.brandName,
                strengthText: form.strengthText, doseText: form.doseText,
                route: form.route, frequency: form.frequency,
                frequencyPerDay: form.frequencyPerDay || null,
                durationText: form.durationText, indication: form.indication, source: form.source,
              });
              if (body) {
                setForm({
                  genericName: "", brandName: "", strengthText: "", doseText: "", route: "", frequency: "",
                  frequencyPerDay: "", durationText: "", indication: "", source: "practitioner",
                });
                setDose(null);
                router.refresh();
              }
            }}>
            {busy ? "Saving…" : "Add to the medication record"}
          </button>
        </>
      )}

      {locked && (
        <p className="mt-2 text-[11px] text-gray-500">
          This consultation is signed, so nothing can be added to it. The medication record itself is
          still open from the patient&rsquo;s page.
        </p>
      )}

      {/* ⚠ ALWAYS, ON THE PRESCRIBING SCREEN ABOVE ALL. */}
      <NotCheckedPanel checks={record.notChecked} />
    </section>
  );
}
