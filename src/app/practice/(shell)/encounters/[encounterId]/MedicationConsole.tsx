"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  DOSE_BASES, MEDICATION_SOURCES, MEDICATION_STATUS_CHIP, MEDICATION_STATUS_LABEL,
  WEIGHT_TONE, NOT_CHECKED_TONE, NOT_CHECKED_LABEL, doseSafetyNotice,
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
// ⚠ TYPE-ONLY IMPORT FROM THE ENGINE -- see the note in ParameterCollection.tsx.

const CARD = "mt-4 rounded-xl border border-gray-200 bg-white p-4";
const input = "w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-[12px] outline-none focus:border-[var(--cp-primary)] focus:ring-2 focus:ring-[var(--cp-primary)]/10";
const BTN = "rounded-lg bg-[var(--cp-primary)] px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-[var(--cp-primary-deep)] disabled:opacity-50";
const QUIET = "rounded-lg border border-gray-200 px-2.5 py-1.5 text-[11px] font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50";
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
  const [calc, setCalc] = useState({ basis: "mg_per_kg", rateValue: "", fixedDose: "", doseUnit: "mg", dosesPerDay: "", overrideReason: "" });
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }));
  const setC = (k: keyof typeof calc) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
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

            <button className={`${BTN} mt-2`} disabled={busy}
              onClick={async () => {
                const body = await post("calculateDose", {
                  patientId, encounterId, basis: calc.basis,
                  rateValue: calc.rateValue || null, fixedDose: calc.fixedDose || null,
                  doseUnit: calc.doseUnit || "mg", dosesPerDay: calc.dosesPerDay || null,
                  overrideReason: calc.overrideReason || null,
                });
                if (body) setDose(body as unknown as DoseCalculationResult);
              }}>
              {busy ? "Working…" : "Calculate"}
            </button>

            {/* ⚠ THE FIGURE, ITS WORKING AND ITS NOTICE ARE ONE BLOCK. Nothing renders the number alone. */}
            {dose && (
              <div className="mt-3 rounded-lg bg-gray-50 p-3">
                <p className="text-[13px] font-bold text-gray-900">
                  {dose.perDose !== null ? `${dose.perDose} ${dose.unit} per dose` : dose.dailyTotal !== null ? `${dose.dailyTotal} ${dose.unit} per day` : "no figure"}
                </p>
                <ol className="mt-1 flex flex-col gap-0.5">
                  {dose.working.map((w, i) => <li key={i} className="font-mono text-[10px] text-gray-700">{w}</li>)}
                </ol>
                {dose.overridden && (
                  <p className="mt-1 text-[10px] font-semibold text-rose-700">
                    Recorded as a safety override: this was calculated on a weight the record flagged.
                  </p>
                )}
                {dose.id === null && (
                  <p className="mt-1 text-[10px] font-semibold text-amber-700">
                    This calculation was NOT saved &mdash; the medication store is not in this deployment.
                    The arithmetic above is correct, but nothing has recorded that you were shown it.
                  </p>
                )}
                <p className="mt-2 rounded bg-white px-2 py-1.5 text-[10px] text-slate-600">{doseSafetyNotice()}</p>
                <button className={`${QUIET} mt-2`} onClick={() => setForm(f => ({
                  ...f,
                  doseText: f.doseText || (dose.perDose !== null ? `${dose.perDose} ${dose.unit}` : `${dose.dailyTotal} ${dose.unit} per day`),
                }))}>
                  Use this as the dose
                </button>
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
