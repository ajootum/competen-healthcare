"use client";

import { useMemo, useState } from "react";
import FormFieldInput from "@/components/practice/FormFieldInput";

/* eslint-disable @typescript-eslint/no-explicit-any */

// ────────────────────────────────────────────────────────────────────────────────────────────────────
// CPR-BOOK-FLOW-002 s8 -- "YOUR DETAILS", THE PRINCIPAL HFE REDESIGN.
//
// The same questions, asked in a shape a person can answer. What was a flat list of sixteen controls
// with a paragraph of rule-engine reasoning under each is now five sections with three conditional
// reveals -- and the questions themselves are unchanged, because the practice chose them.
//
// ---- ⚠ WHAT THIS COMPONENT DOES NOT DECIDE ---------------------------------------------------------
//
// WHICH questions are asked, and which are required, is the server's answer (resolveApplicable over the
// practice's own registration rule). This file decides only how they are GROUPED and WHEN a group is
// revealed. A field the server did not send cannot be shown here whatever a patient clicks, and a field
// the server marked required is never hidden behind a disclosure -- see `showRepresentative` and
// `medicalRequired`, both of which are forced open in that case.
//
// ---- ⚠ AND IT NEVER WRITES DIRECTLY TO STATE -------------------------------------------------------
//
// Every answer goes through the wizard's `edit`, which re-runs the condition engine and clears answers
// to questions that have just been withdrawn. A handler here that set state itself would let a
// withdrawn answer survive, which is the one thing this form's design is for.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

type Field = {
  field_key: string;
  label: string;
  patientLabel?: string;
  patientHelp?: string | null;
  help: string;
  field_type: string;
  options?: { value: string; label: string }[];
  patientOptions?: { value: string; label: string }[];
  _level: string;
};

const SECTION = "rounded-xl border border-gray-200 bg-white p-4";
const LEGEND = "text-[13px] font-bold text-gray-900";

/** The patient's words where there are any, the practitioner's where there are not. */
const labelOf = (f: Field) => f.patientLabel ?? f.label;
/**
 * ⚠ `patientHelp: null` IS A DECISION, NOT A MISSING VALUE, so it must not fall through to `help`.
 * "First name" needs no explanation, and a sentence under it saying so is noise. Only a field with no
 * patient copy AT ALL falls back -- and every field in the catalogue has some.
 */
const helpOf = (f: Field) => (f.patientHelp !== undefined ? f.patientHelp : f.help);

function FieldRow({ f, value, onChange }: {
  f: Field; value: unknown; onChange: (v: unknown) => void;
}) {
  const help = helpOf(f);
  // The patient-facing option list where the catalogue curates one (s8.4).
  const field = f.patientOptions ? { ...f, options: f.patientOptions } : f;
  return (
    <label className="block">
      <span className="text-[12px] font-semibold text-gray-800">
        {labelOf(f)}
        {f._level === "required" && <span className="ml-1 text-rose-600" aria-hidden>*</span>}
        {f._level === "required" && <span className="sr-only"> (required)</span>}
      </span>
      {help && <span className="mt-0.5 block text-[11px] leading-relaxed text-gray-500">{help}</span>}
      <span className="mt-1.5 block">
        <FormFieldInput field={field as any} value={value} onChange={onChange} />
      </span>
    </label>
  );
}

export default function DetailsStep({
  applicable, values, edit, isChild,
  consent, setConsent, consentRequired, consentText, privacyNotice, safetyNote,
}: {
  applicable: Field[];
  values: Record<string, unknown>;
  edit: (key: string, value: unknown) => void;
  /** The engine's own derived fact, not a re-computation of it. */
  isChild: boolean;
  consent: boolean;
  setConsent: (v: boolean) => void;
  consentRequired: boolean;
  consentText: string | null;
  privacyNotice: string | null;
  safetyNote: string | null;
}) {
  const by = useMemo(() => {
    const m = new Map<string, Field>();
    for (const f of applicable) m.set(f.field_key, f);
    return m;
  }, [applicable]);
  const get = (k: string) => by.get(k) ?? null;
  const has = (k: string) => by.has(k);

  // ── The three conditional reveals ──────────────────────────────────────────
  //
  // ⚠ EACH IS SEEDED FROM THE ANSWERS ALREADY GIVEN, so going Back and returning does not collapse a
  // section a patient has filled in (s4: "Back navigation must preserve valid data already entered").
  const repKeys = ["representative_name", "representative_relationship", "representative_phone"];
  const repFields = repKeys.map(get).filter(Boolean) as Field[];
  const repRequired = repFields.some(f => f._level === "required");
  const repAnswered = repKeys.some(k => String(values[k] ?? "").trim() !== "");
  const [forSomeoneElse, setForSomeoneElse] = useState(repAnswered);
  // A child's booking asks for a guardian whatever the patient clicks; an adult's asks only if they say
  // somebody else is arranging it (s8.3).
  const showRepresentative = repFields.length > 0 && (repRequired || isChild || forSomeoneElse);

  const dobKnownInitial = String(values.birth_date ?? "").trim() !== ""
    || String(values.age_years ?? "").trim() === "";
  const [dobKnown, setDobKnown] = useState(dobKnownInitial);

  const referralAnsweredYes = String(values.referral_source ?? "").trim() !== "";
  const [referred, setReferred] = useState<boolean | null>(referralAnsweredYes ? true : null);

  const medicalKeys = ["stated_diagnosis", "stated_treatment", "stated_hospital_number"];
  const medicalFields = medicalKeys.map(get).filter(Boolean) as Field[];
  const medicalRequired = medicalFields.some(f => f._level === "required");
  const medicalAnswered = medicalKeys.some(k => String(values[k] ?? "").trim() !== "");
  const [medicalOpen, setMedicalOpen] = useState(medicalRequired || medicalAnswered);

  /** Clearing on hide, so a withdrawn section leaves no half-entered answers behind. */
  const clearAll = (keys: string[]) => { for (const k of keys) if (k in values) edit(k, ""); };

  const row = (key: string) => {
    const f = get(key);
    if (!f) return null;
    return <FieldRow key={key} f={f} value={values[key]} onChange={v => edit(key, v)} />;
  };

  const identityRows = ["given_name", "family_name"].filter(has);
  const contactRows = ["contact_phone", "contact_email"].filter(has);

  return (
    <div className="flex flex-col gap-4">

      {/* ══ A. ABOUT THE PATIENT (s8.1) ═══════════════════════════════════════════════════════════ */}
      {(identityRows.length > 0 || has("birth_date") || has("age_years") || has("sex")) && (
        <fieldset className={SECTION}>
          <legend className={LEGEND}>About the patient</legend>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {identityRows.map(row)}
          </div>

          {/* ⚠ DATE OF BIRTH AND AGE ARE NOT BOTH ASKED (s8.2/AC-09). The old form put them side by side
              with a note explaining that neither is inferred from the other, which is true of the data
              model and irrelevant to a person filling in a form. Age is offered only to somebody who
              says they do not know the date. */}
          {(has("birth_date") || has("age_years")) && (
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {dobKnown && has("birth_date") && row("birth_date")}
              {(!dobKnown || !has("birth_date")) && has("age_years") && row("age_years")}
              {has("birth_date") && has("age_years") && (
                <label className="flex items-start gap-2 self-end pb-1 text-[11.5px] text-gray-600">
                  <input type="checkbox" className="mt-0.5" checked={!dobKnown}
                    onChange={e => {
                      const unknown = e.target.checked;
                      setDobKnown(!unknown);
                      // Only one of the pair is ever carried forward.
                      clearAll(unknown ? ["birth_date"] : ["age_years"]);
                    }} />
                  <span>I do not know the exact date of birth</span>
                </label>
              )}
            </div>
          )}

          {has("sex") && <div className="mt-3 sm:max-w-[50%]">{row("sex")}</div>}
        </fieldset>
      )}

      {/* ══ B. CONTACT DETAILS (s8.2) ═════════════════════════════════════════════════════════════ */}
      {contactRows.length > 0 && (
        <fieldset className={SECTION}>
          <legend className={LEGEND}>Contact details</legend>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {contactRows.map(row)}
          </div>
        </fieldset>
      )}

      {/* ══ C. PARENT, GUARDIAN OR REPRESENTATIVE (s8.3/AC-10) ════════════════════════════════════ */}
      {repFields.length > 0 && (
        <fieldset className={SECTION}>
          <legend className={LEGEND}>
            {isChild || repRequired ? "Parent or guardian" : "Who is arranging this appointment?"}
          </legend>

          {/* The question is asked only where the answer is the patient's to give. When the practice's
              own rule already requires a guardian -- a child's booking -- there is nothing to choose. */}
          {!repRequired && !isChild && (
            <div className="mt-2 flex flex-wrap gap-2" role="radiogroup" aria-label="Who is arranging this appointment">
              {[{ v: false, label: "I am booking for myself" }, { v: true, label: "I am booking for someone else" }].map(o => (
                <button key={String(o.v)} type="button" role="radio" aria-checked={forSomeoneElse === o.v}
                  onClick={() => {
                    setForSomeoneElse(o.v);
                    if (!o.v) clearAll(repKeys);
                  }}
                  className={`rounded-lg border px-3 py-2 text-[12px] font-semibold ${
                    forSomeoneElse === o.v
                      ? "border-[var(--cp-primary)] bg-[var(--cp-primary)]/10 text-[var(--cp-primary-deep)]"
                      : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50"}`}>
                  {o.label}
                </button>
              ))}
            </div>
          )}

          {isChild && !repRequired && (
            <p className="mt-2 text-[11.5px] leading-relaxed text-gray-600">
              This practice needs an adult&rsquo;s details for a patient of this age.
            </p>
          )}

          {showRepresentative && (
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {repKeys.filter(has).map(row)}
              {/* s8.3's duplicate-entry saver. Only offered where both numbers are on the form. */}
              {has("representative_phone") && has("contact_phone") && (
                <label className="flex items-start gap-2 self-end pb-1 text-[11.5px] text-gray-600">
                  <input type="checkbox" className="mt-0.5"
                    checked={!!values.representative_phone
                      && values.representative_phone === values.contact_phone}
                    onChange={e => edit("representative_phone", e.target.checked ? (values.contact_phone ?? "") : "")} />
                  <span>Use the same number as above</span>
                </label>
              )}
            </div>
          )}
        </fieldset>
      )}

      {/* ══ D. ABOUT THIS APPOINTMENT (s8.5) ══════════════════════════════════════════════════════ */}
      {(has("reason_for_visit") || has("referral_source")) && (
        <fieldset className={SECTION}>
          <legend className={LEGEND}>About this appointment</legend>
          <div className="mt-3">{row("reason_for_visit")}</div>

          {/* s8.5's safety statement, from the practice's own configuration -- never a hard-coded number
              for a country this deployment does not serve. */}
          {safetyNote && (
            <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50/70 px-3 py-2 text-[11.5px] leading-relaxed text-amber-900">
              {safetyNote}
            </p>
          )}

          {/* ⚠ A STRUCTURED QUESTION, THEN THE FIELD (s8.5/AC-12). The old form asked "Who referred them"
              of everybody and explained, underneath, that the answer does not drive any rule. */}
          {has("referral_source") && (
            <div className="mt-3">
              <span className="text-[12px] font-semibold text-gray-800">Were you referred for this appointment?</span>
              <div className="mt-1.5 flex flex-wrap gap-2" role="radiogroup" aria-label="Were you referred for this appointment">
                {[{ v: false, label: "No" }, { v: true, label: "Yes" }].map(o => (
                  <button key={String(o.v)} type="button" role="radio" aria-checked={referred === o.v}
                    onClick={() => {
                      setReferred(o.v);
                      if (!o.v) clearAll(["referral_source"]);
                    }}
                    className={`rounded-lg border px-4 py-2 text-[12px] font-semibold ${
                      referred === o.v
                        ? "border-[var(--cp-primary)] bg-[var(--cp-primary)]/10 text-[var(--cp-primary-deep)]"
                        : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50"}`}>
                    {o.label}
                  </button>
                ))}
              </div>
              {referred === true && <div className="mt-3">{row("referral_source")}</div>}
            </div>
          )}
        </fieldset>
      )}

      {/* ══ E/F. OPTIONAL MEDICAL INFORMATION (s8.6, s8.7/AC-13) ══════════════════════════════════
          Collapsed by default, and NOT collapsible when the practice made any of it required -- a
          required question behind a disclosure is a form that refuses to submit for a reason nobody
          can see. */}
      {medicalFields.length > 0 && (
        <section className={SECTION}>
          {medicalRequired ? (
            <h2 className={LEGEND}>Medical information</h2>
          ) : (
            <button type="button" onClick={() => setMedicalOpen(o => !o)}
              aria-expanded={medicalOpen}
              className="flex w-full items-center justify-between gap-2 text-left">
              <span className={LEGEND}>Add medical information (optional)</span>
              <span aria-hidden className="text-[12px] text-gray-400">{medicalOpen ? "−" : "+"}</span>
            </button>
          )}
          {!medicalOpen && !medicalRequired && (
            <p className="mt-1 text-[11px] leading-relaxed text-gray-500">
              You can share a condition, current treatment or your patient number if it would help the
              practitioner prepare. Booking works without it.
            </p>
          )}
          {(medicalOpen || medicalRequired) && (
            <div className="mt-3 flex flex-col gap-3">
              {medicalKeys.filter(has).map(row)}
            </div>
          )}
        </section>
      )}

      {/* ══ CONSENT AND COMMUNICATIONS (s10/AC-14) ════════════════════════════════════════════════
          ⚠ TWO DIFFERENT THINGS, SEPARATED. The required acknowledgement is about this practice keeping
          what was typed in order to arrange the appointment. The communication preference is about
          OPTIONAL updates -- and it is stated beside the fact that the verification code and the
          confirmation are part of booking and arrive either way, which the old copy got backwards by
          claiming nothing was ever sent. */}
      <section className={SECTION}>
        <h2 className={LEGEND}>Before you continue</h2>

        {has("consent_communication") && <div className="mt-3">{row("consent_communication")}</div>}

        <label className="mt-3 flex items-start gap-2 text-[12px] leading-relaxed text-gray-700">
          <input type="checkbox" className="mt-0.5" checked={consent}
            onChange={e => setConsent(e.target.checked)} />
          <span>
            {consentText ?? "I agree to this practice using the information I have provided to arrange this appointment."}
            {consentRequired && <span className="ml-1 text-rose-600" aria-hidden>*</span>}
          </span>
        </label>

        {privacyNotice && (
          <details className="mt-2">
            <summary className="cursor-pointer text-[11.5px] font-semibold text-[var(--cp-primary)]">
              Privacy notice
            </summary>
            <p className="mt-1 whitespace-pre-wrap text-[11.5px] leading-relaxed text-gray-600">{privacyNotice}</p>
          </details>
        )}
      </section>
    </div>
  );
}
