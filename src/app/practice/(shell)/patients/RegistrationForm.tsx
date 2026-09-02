"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { RELATIONSHIP_TYPES, GUARDIAN_TYPES } from "@/lib/practice/relationships-constants";
import Link from "next/link";
import { SECTION_BADGE, BUTTON } from "@/lib/practice/palette";
import { resolveApplicable, clearedNotice } from "@/lib/practice/registration-condition";
import FormFieldInput from "@/components/practice/FormFieldInput";
import SchedulingCard, { type SchedulingChoice } from "./SchedulingCard";

// CPR-PRM-001 s4/s5/s6 -- the registration form.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// THE AGE IS COMPUTED HERE WITH THE SAME ARITHMETIC THE SERVER USES, so the number on screen and the
// number that decides whether a guardian is required cannot disagree. If they could, somebody would fill
// in a form that says "17 years" and be refused by a server that thinks 18, with nothing on the page
// explaining why.
//
// THE GUARDIAN BLOCK IS NOT A SETTING. Which fields appear is the practice's template; whether a
// guardian is REQUIRED is the date of birth, and no configuration can switch that off -- the same floor
// the server enforces.
//
// A CONDITIONAL FIELD IS DRAWN CONDITIONALLY, USING THE SERVER'S OWN EVALUATOR -- see `valuesOf` and
// `edit` below. It was not: every field the template carried was rendered every time, so a practice
// that configured "ask for the guardian's name only when the patient is a minor" showed that question
// to everybody, and the only thing the condition did was decide whether the answer was REQUIRED. The
// rule was enforced on submission and invisible on screen.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

/* eslint-disable @typescript-eslint/no-explicit-any */

const input = "w-full rounded-lg border border-gray-200 bg-white text-gray-900 placeholder:text-gray-400 px-2.5 py-2 text-[14px] outline-none focus:border-[var(--cp-primary)] focus:ring-2 focus:ring-[var(--cp-primary)]/10";
const label = "block text-[12px] font-semibold text-gray-600";

/**
 * ⚠ DERIVED FROM THE CANONICAL LIST, NOT A COPY OF IT.
 *
 * This was a hand-written duplicate of relationships.ts's RELATIONSHIP_TYPES, and migration 364 is
 * exactly the change that would have broken it: adding 'parent' and 'other_relative' to the vocabulary
 * would have left this form offering the old fifteen while the booking form offered seventeen, with
 * nothing failing and nobody told. The order differs from the canonical list on purpose -- guardians
 * first, because this form is usually reached for a minor -- but the MEMBERSHIP is no longer a second
 * opinion.
 */
export const RELATIONSHIP_OPTIONS: [string, string][] = (() => {
  const canonical = new Map(RELATIONSHIP_TYPES.map(([k, l]) => [k as string, l as string]));
  const first = ["guardian", "parent", "mother", "father", "grandparent", "carer", "social_worker"];
  const ordered = [...first, ...[...canonical.keys()].filter(k => !first.includes(k))];
  return ordered.map(k => [k, canonical.get(k)!] as [string, string]);
})();

// Only these can hold legal authority -- the server refuses the rest, and the form should not offer
// what the server will reject. IMPORTED rather than restated, for the reason above: a second copy of
// an authority set is a place where this form and the server can quietly disagree about who may consent
// for a child.

type Relation = {
  relationshipType: string; fullName: string; phone: string; secondaryPhone: string;
  email: string; isLegalGuardian: boolean; mayReceiveInformation: boolean; isPrimary: boolean;
};

const emptyRelation = (asGuardian: boolean): Relation => ({
  relationshipType: asGuardian ? "mother" : "emergency_contact", fullName: "",
  phone: "", secondaryPhone: "", email: "",
  isLegalGuardian: asGuardian, mayReceiveInformation: true, isPrimary: false,
});

type PatientDraft = {
  givenName: string; middleName: string; familyName: string; sex: string;
  birthDate: string; ageEstimateYears: string; phone: string; email: string; nationalId: string;
  reasonForVisit: string;
};

const composeName = (s: PatientDraft) =>
  [s.givenName, s.middleName, s.familyName].map(x => x.trim()).filter(Boolean).join(" ");

/**
 * The form, keyed the way the template keys its fields -- which is what a condition names.
 *
 * ⚠ BUILT TO MATCH register()'s OWN MAP, KEY FOR KEY AND EMPTY-FOR-EMPTY. The server evaluates the
 * same conditions against the map IT builds, so if the two disagreed about whether an untouched phone
 * box is `""` or absent, a field could be on screen and not applicable on the server, or required on
 * the server and absent from the screen. The `|| undefined`s here mirror the `|| undefined`s in
 * submit() below, which are what register() actually receives.
 */
function valuesOf(s: PatientDraft, custom: Record<string, unknown>): Record<string, unknown> {
  return {
    display_name: composeName(s) || undefined,
    sex: s.sex,
    birth_date: s.birthDate || undefined,
    age_estimate_years: s.ageEstimateYears ? Number(s.ageEstimateYears) : undefined,
    phone: s.phone || undefined,
    email: s.email || undefined,
    ...custom,
  };
}

/** The same arithmetic as relationships.ts ageFrom(). Years, months and days -- s4. */
function ageFrom(birthDate: string, today: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(birthDate) || !/^\d{4}-\d{2}-\d{2}$/.test(today)) return null;
  const [by, bm, bd] = birthDate.split("-").map(Number);
  const [ty, tm, td] = today.split("-").map(Number);
  if (birthDate > today) return null;
  let years = ty - by, months = tm - bm, days = td - bd;
  if (days < 0) {
    months -= 1;
    days += new Date(Date.UTC(tm === 1 ? ty - 1 : ty, tm === 1 ? 12 : tm - 1, 0)).getUTCDate();
  }
  if (months < 0) { years -= 1; months += 12; }
  if (years < 0) return null;
  const label = years >= 2 ? `${years} years, ${months} months, ${days} days`
    : years === 1 ? `1 year, ${months} months, ${days} days`
    : months >= 1 ? `${months} months, ${days} days`
    : `${days} days`;
  return { years, months, days, label };
}

export default function RegistrationForm({ form, majorityAge, today, mode = "full", canStartEncounter = false, canBook = false, onRegistered, onNotice, onBirthDateChange }: {
  form: { template: any; fields: any[] };
  majorityAge: number;
  today: string;
  /** CPR-REG-002: quick hides the hospital identifiers card -- "minimum information, complete later". */
  mode?: "quick" | "full";
  /**
   * encounter.create. Without it the "start the consultation" action is not rendered at all, because
   * launchEncounter would refuse it -- and a receptionist who registers all day is exactly the role that
   * has patient.create and does not have this one.
   */
  canStartEncounter?: boolean;
  /**
   * appointment.manage. CP-SCHED-001's card reads the practitioner's diary and its primary action puts an
   * appointment in it, so without the capability the card is not rendered at all -- rather than rendered
   * and then failing at the last press with a 403.
   */
  canBook?: boolean;
  onRegistered: (r: any) => void;
  onNotice?: (n: { kind: "ok" | "err"; text: string }) => void;
  /**
   * ⚠ THE ADAPTIVE WORKFLOW LIVES OR DIES ON THIS CALLBACK (CPR-V5-006 s7).
   *
   * steps() decides "Guardian" against "Next of kin" from the birth date, and the step list is drawn by
   * the PARENT while the birth date is typed HERE. Without a way up, the parent called steps(mode) with
   * no date, `minor` was always null, and the list read "Guardian or next of kin" for a newborn and a
   * pensioner alike -- the adaptive registration existed in the engine and never once fired on screen.
   */
  onBirthDateChange?: (birthDate: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<any[] | null>(null);

  const [p, setP] = useState<PatientDraft>({
    givenName: "", middleName: "", familyName: "", sex: "unspecified",
    birthDate: "", ageEstimateYears: "", phone: "", email: "", nationalId: "",
    reasonForVisit: "",
  });

  // ── CP-SCHED-001 s6: THE CHOSEN SLOT, AND THE TWO THINGS A LOST RACE NEEDS ──────────────────────
  //
  // `booking` is what the card returned -- a time the SERVER offered, never one typed here. `nonce`
  // makes the card re-read after a refusal, and `alternatives` are the times the server sent back WITH
  // that refusal so the desk sees replacements before any new read lands.
  const [booking, setBooking] = useState<SchedulingChoice | null>(null);
  const [nonce, setNonce] = useState(0);
  const [alternatives, setAlternatives] = useState<any[] | null>(null);
  const [relations, setRelations] = useState<Relation[]>([]);
  const [custom, setCustom] = useState<Record<string, unknown>>({});
  // The sentence shown when a question was withdrawn and its answer thrown away -- see `edit` below.
  const [clearedNote, setClearedNote] = useState<string | null>(null);
  // Set once a draft has been saved, so pressing Save again updates it rather than leaving a trail of
  // half-finished copies of the same person on somebody's desk.
  const [draftId, setDraftId] = useState<string | null>(null);

  // Told to the parent so the step list beside this form can adapt as the date is typed. An effect
  // rather than a call inside the change handler, because the birth date is set from more than one place
  // (typing it, and restoring a draft) and only one of those would have remembered to fire it.
  useEffect(() => { onBirthDateChange?.(p.birthDate); }, [p.birthDate, onBirthDateChange]);

  const age = useMemo(() => p.birthDate ? ageFrom(p.birthDate, today) : null, [p.birthDate, today]);
  const isMinor = age ? age.years < majorityAge
    : p.ageEstimateYears ? Number(p.ageEstimateYears) < majorityAge - 2 : false;
  const boundary = !age && p.ageEstimateYears &&
    Math.abs(Number(p.ageEstimateYears) - majorityAge) <= 2;

  const hasGuardian = relations.some(r => r.isLegalGuardian && GUARDIAN_TYPES.has(r.relationshipType) && r.fullName.trim());
  const name = composeName(p);

  // ── WHICH OF THIS PRACTICE'S OWN QUESTIONS APPLY RIGHT NOW ──────────────────────────────────────
  const formValues = useMemo(() => valuesOf(p, custom), [p, custom]);
  const resolved = useMemo(() => resolveApplicable(form.fields ?? [], formValues), [form.fields, formValues]);
  const customFields = resolved.applicable.filter((f: any) => !f.is_core);

  // ── ONE WRITE PATH FOR EVERY ANSWER ON THIS FORM ────────────────────────────────────────────────
  //
  // Every change to the patient's details and every change to a configured question goes through
  // `edit`, and `edit` is where a withdrawn question's answer is thrown away. Two reasons it is here
  // rather than in an effect watching the state:
  //
  //   1. React 19 refuses it. Clearing state from an effect is a cascading render, and this project's
  //      lint says so as an error rather than a warning. "You might not need an effect" is right here:
  //      the only thing that can withdraw a question is somebody changing an answer, and that is an
  //      event, not a synchronisation.
  //   2. ONE PLACE MEANS ONE PLACE TO GET WRONG. Every input below calls `edit`; a handler that wrote
  //      to setP directly would silently opt out of the clearing, and the next person adding a field
  //      to this form would have to know that.
  const edit = useCallback((patch: Partial<PatientDraft>, customPatch?: Record<string, unknown>) => {
    const nextP = { ...p, ...patch };
    const nextCustom = customPatch ? { ...custom, ...customPatch } : custom;
    const { cleared, values } = resolveApplicable(form.fields ?? [], valuesOf(nextP, nextCustom));

    setP(nextP);
    if (cleared.length === 0) { if (customPatch) setCustom(nextCustom); return; }

    // THE ANSWER GOES, and it is SAID. A question disappearing takes what somebody typed with it, and
    // a screen that does neither of those things out loud is how a form loses a minute of work with no
    // account of where it went.
    const kept: Record<string, unknown> = {};
    for (const k of Object.keys(nextCustom)) if (k in values) kept[k] = nextCustom[k];
    setCustom(kept);
    setClearedNote(clearedNotice(cleared.map((f: any) => String(f.label ?? f.field_key))));
  }, [p, custom, form.fields]);

  const editCustom = (key: string, value: unknown) => edit({}, { [key]: value });

  // WHAT ACTUALLY GOES IN THE PAYLOAD: a whitelist of the questions on screen. `edit` has already
  // cleared the state, so the two agree -- but only one of them stays right if somebody later decides
  // clearing was too aggressive, and it is not the state map.
  const applicableCustom = useMemo(() => {
    const out: Record<string, unknown> = {};
    for (const f of customFields) if (f.field_key in custom) out[f.field_key] = custom[f.field_key];
    return out;
  }, [customFields, custom]);

  // A CHILD'S CONTACT IS THEIR GUARDIAN'S. A six-month-old has no phone, and demanding one makes this
  // form unusable for exactly the patients whose records matter most.
  const guardianContact = relations.some(r => r.fullName.trim() && (r.phone.trim() || r.email.trim()));
  const hasContact = !!p.phone.trim() || !!p.email.trim() || guardianContact;

  // WHAT IS MISSING, NAMED. A greyed-out primary action with nothing saying why is the failure this
  // screen actually had: everything looked filled in, and the button simply would not press.
  const missing = [
    !name && "a name",
    !p.birthDate && !p.ageEstimateYears && "a date of birth or an estimated age",
    !hasContact && (isMinor ? "a contact for the guardian" : "a phone number or an email"),
    isMinor && !hasGuardian && "a guardian with legal authority",
  ].filter(Boolean) as string[];

  const canSubmit = missing.length === 0 && !busy;

  function setRelation(i: number, patch: Partial<Relation>) {
    setRelations(rs => rs.map((r, j) => j === i ? { ...r, ...patch } : r));
  }

  // A BOOKING FOR ANOTHER DAY IS NOT THE START OF A CONSULTATION. See the action row below.
  const bookedForLater = !!booking && booking.date > today;

  /** Everything about the person, shared by the sequential route and the transactional one. */
  const personBody = () => ({
    givenName: p.givenName || undefined, middleName: p.middleName || undefined,
    familyName: p.familyName || undefined, sex: p.sex,
    birthDate: p.birthDate || undefined,
    ageEstimateYears: p.ageEstimateYears ? Number(p.ageEstimateYears) : undefined,
    phone: p.phone || undefined, email: p.email || undefined,
    nationalId: p.nationalId || undefined,
    relationships: relations.filter(r => r.fullName.trim()).map(r => ({
      relationshipType: r.relationshipType, fullName: r.fullName,
      phone: r.phone || undefined, secondaryPhone: r.secondaryPhone || undefined,
      email: r.email || undefined,
      isLegalGuardian: r.isLegalGuardian && GUARDIAN_TYPES.has(r.relationshipType),
      mayReceiveInformation: r.mayReceiveInformation, isPrimary: r.isPrimary,
    })),
    reasonForVisit: p.reasonForVisit || undefined,
    // ⚠ NOT `custom`. Only the questions this form is actually asking travel -- an answer to a
    // question the form withdrew must not reach the server, which would both store it and use it
    // to decide that some OTHER conditional field is required.
    custom: applicableCustom,
  });

  // ── ⚠ REGISTER AND BOOK IS ONE ACT, SO IT IS ONE REQUEST ────────────────────────────────────────
  //
  // CP-SCHED-001 s10: "Use an atomic transaction for registration + booking WHERE THE UI PROMISES A
  // COMBINED ACTION." This button promises one, so it goes to the transactional route rather than
  // registering and then booking. The difference is only visible when the race happens -- and when it
  // does, the whole thing rolls back and this screen can say so truthfully instead of reporting a
  // patient who exists with an appointment that does not.
  async function submitBooking(confirmNew: boolean) {
    if (!booking) return;
    setBusy(true); setError(null); setCandidates(null); setAlternatives(null);
    const res = await fetch("/api/v1/practice/register-and-book", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...personBody(), confirmNew,
        scheduledAt: booking.startsAt, locationId: booking.locationId,
        durationMinutes: booking.minutes,
      }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);

    if (res.status === 409 && Array.isArray(data.candidates) && data.candidates.length) {
      setCandidates(data.candidates.map((c: any) => ({ ...c, hardBlock: data?.error?.code === "DUPLICATE_IDENTIFIER", booked: true })));
      return;
    }
    if (!res.ok) {
      setError(data?.error?.message ?? "The registration was not saved.");
      // ⚠ A LOST SLOT REFRESHES THE CARD. Leaving the old list on screen invites a second press on a
      // minute that has gone, and a second refusal that reads as the product being broken.
      if (data?.error?.code === "SLOT_TAKEN" || data?.error?.code === "TIME_NOT_OFFERED") {
        setAlternatives(Array.isArray(data.alternatives) ? data.alternatives : null);
        setBooking(null);
        setNonce(n => n + 1);
      }
      return;
    }
    onRegistered(data);
  }

  async function submit(confirmNew: boolean, action: "register" | "queue" | "encounter" = "register") {
    setBusy(true); setError(null); setCandidates(null);
    const res = await fetch("/api/v1/practice/registration", {
      method: "POST", headers: { "content-type": "application/json" },
      // ⚠ NO appointmentAt ON THIS PATH ANY MORE, AND THAT IS THE WHOLE POINT OF THE CARD.
      //
      // This route books by calling bookAppointment with whatever instant it is handed and a null
      // location, which is how a free-form datetime box got a time judged that no session covered.
      // A booking now goes to /register-and-book with a slot the SERVER offered. This path registers,
      // and registering is all it does.
      body: JSON.stringify({ ...personBody(), confirmNew }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (res.status === 409 && Array.isArray(data.candidates) && data.candidates.length) {
      setCandidates(data.candidates.map((c: any) => ({ ...c, hardBlock: data?.error?.code === "DUPLICATE_IDENTIFIER" })));
      return;
    }
    if (!res.ok) { setError(data?.error?.message ?? "Registration failed."); return; }

    // REGISTER AND QUEUE IS TWO ACTS, AND THE SECOND IS REPORTED SEPARATELY. If queueing fails the
    // patient still exists -- and telling somebody they are in the queue when they are not is how a
    // person sits in a waiting room nobody is watching.
    if (action === "queue" && data.patientId) {
      const q = await fetch("/api/v1/practice/registration-workspace", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ queuePatientId: data.patientId }),
      });
      if (!q.ok) {
        const qd = await q.json().catch(() => ({}));
        onNotice?.({ kind: "err", text: `Registered, but not added to the queue: ${qd?.error?.message ?? "unknown reason"}` });
      }
    }

    // ── "Encounter launches immediately after registration" -- as an ACT, not as a side effect ───────
    //
    // CPR-V5-006's acceptance criterion asks for this, and the obvious reading of it -- launch an
    // encounter unconditionally at the end of every registration -- is wrong, for three reasons that all
    // point the same way:
    //
    //   1. AN ENCOUNTER IS A CLINICAL RECORD. Registering somebody at a desk for an appointment next
    //      month is not the start of a consultation, and an encounter opened by accident is a record
    //      that has to be explained, cancelled or signed by somebody who was never in the room. This
    //      product makes a signed encounter immutable in the database; the cost of an accidental one is
    //      not symmetrical with the cost of an extra click.
    //   2. IT WOULD FAIL FOR THE PERSON WHO REGISTERS MOST PATIENTS. launchEncounter requires
    //      encounter.create. A receptionist has patient.create and not that, so an unconditional launch
    //      would either error on every registration they perform or be swallowed silently.
    //   3. THE FORM ALREADY COLLECTS THE VISIT CONTEXT. An appointment dated for another day is a
    //      statement that this visit is not now, and the button says so rather than deciding quietly.
    //
    // So it is one explicit press that does both -- registration never delays care, which is what the
    // criterion is protecting, and nothing opens a consultation nobody asked for. If the launch fails
    // the registration still stands and is reported separately: telling somebody a consultation is open
    // when it is not is how a patient waits for a clinician who is not expecting them.
    if (action === "encounter" && data.patientId) {
      const enc = await fetch("/api/v1/practice/encounters", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          patientId: data.patientId,
          // A patient registered a moment ago has no prior encounter here, by definition.
          pathway: "new_walk_in",
          reasonForVisit: p.reasonForVisit || undefined,
        }),
      });
      const ed = await enc.json().catch(() => ({}));
      if (!enc.ok || !ed?.encounter?.id) {
        onNotice?.({
          kind: "err",
          text: `Registered, but the consultation did not open: ${ed?.error?.message ?? `HTTP ${enc.status}`}. The patient record was created.`,
        });
        onRegistered(data);
        return;
      }
      window.location.assign(`/practice/encounters/${ed.encounter.id}`);
      return;
    }

    onRegistered(data);
  }

  return (
    // ⚠ ENTER DOES WHAT THE PRIMARY BUTTON DOES. It used to call submit(false) unconditionally, which
    // with a time chosen would register the patient and quietly throw the appointment away -- the desk
    // would land on the patient's page with no booking and nothing saying one was dropped.
    <form className="mt-3 flex flex-col gap-4"
      onSubmit={e => { e.preventDefault(); if (booking) submitBooking(false); else submit(false); }}>
      {/* ── Identity (comp: a titled card) ─────────────────────────────── */}
      <h3 className="flex items-center gap-2 text-[13px] font-bold text-gray-900"><span aria-hidden className={`flex h-6 w-6 items-center justify-center rounded-md text-[12px] ${SECTION_BADGE.identity.badge}`}>{SECTION_BADGE.identity.icon}</span>Identity</h3>

      {/* ── Name: one row, three parts ────────────────────────────────────────────────────────── */}
      <div>
        <div className="grid sm:grid-cols-3 gap-2">
          <label className={label}>First name
            <input value={p.givenName} onChange={e => edit({ givenName: e.target.value })} className={`mt-1 ${input}`} />
          </label>
          <label className={label}>Middle name
            <input value={p.middleName} onChange={e => edit({ middleName: e.target.value })} className={`mt-1 ${input}`} />
          </label>
          <label className={label}>Last name
            <input value={p.familyName} onChange={e => edit({ familyName: e.target.value })} className={`mt-1 ${input}`} />
          </label>
        </div>
        {/* MONONYMS ARE REAL. Any one of the three is enough, and the form says so rather than starring
            all three and forcing somebody to invent a surname. */}
        <p className="mt-1 text-[11px] text-gray-400">
          {name ? <>Will be recorded as <span className="font-semibold text-gray-600">{name}</span>.</>
            : "Any one of these is enough — a patient known by a single name is registered under it."}
        </p>
      </div>

      {/* ── Date of birth and the live age ─────────────────────────────────────────────────────── */}
      <div className="grid sm:grid-cols-3 gap-2">
        <label className={label}>Date of birth
          <input type="date" max={today} value={p.birthDate}
            onChange={e => edit({ birthDate: e.target.value })} className={`mt-1 ${input}`} />
        </label>
        <label className={label}>…or estimated age
          <input type="number" min={0} max={130} value={p.ageEstimateYears}
            onChange={e => edit({ ageEstimateYears: e.target.value })} className={`mt-1 ${input}`} />
        </label>
        <label className={label}>Sex
          <select value={p.sex} onChange={e => edit({ sex: e.target.value })} className={`mt-1 ${input}`}>
            {[["unspecified", "Not stated"], ["female", "Female"], ["male", "Male"], ["other", "Other"], ["unknown", "Unknown"]]
              .map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </label>
      </div>
      {age && (
        <p className="-mt-2 text-[13px] text-gray-700">
          Age: <span className="font-semibold">{age.label}</span>
          {age.years < majorityAge && <span className="ml-2 rounded bg-[var(--cmp-surface-warning)] px-1.5 py-0.5 text-[11px] font-semibold text-[var(--cmp-text-warning)]">under {majorityAge} — a guardian is required</span>}
        </p>
      )}
      {boundary && (
        <p className="-mt-2 text-[13px] text-[var(--cmp-text-warning)]">
          An estimate this close to {majorityAge} cannot settle whether a guardian is needed. Record a
          date of birth, or add a guardian to be safe.
        </p>
      )}

      <h3 className="mt-1 flex items-center gap-2 text-[13px] font-bold text-gray-900"><span aria-hidden className={`flex h-6 w-6 items-center justify-center rounded-md text-[12px] ${SECTION_BADGE.contact.badge}`}>{SECTION_BADGE.contact.icon}</span>Contact details</h3>

      {/* ── Contact ───────────────────────────────────────────────────────────────────────────── */}
      <div className="grid sm:grid-cols-3 gap-2">
        <label className={label}>Phone
          <input value={p.phone} onChange={e => edit({ phone: e.target.value })} className={`mt-1 ${input}`} />
        </label>
        <label className={label}>Email
          <input value={p.email} onChange={e => edit({ email: e.target.value })} className={`mt-1 ${input}`} />
        </label>
        <label className={label}>National ID
          <input value={p.nationalId} onChange={e => edit({ nationalId: e.target.value })} className={`mt-1 ${input}`} />
        </label>
      </div>
      <p className="-mt-3 text-[11px] text-gray-400">
        {isMinor
          ? "A child has no phone of their own. Record the guardian's contact below — that satisfies this."
          : "A phone or an email is required — one contact, either kind."}
      </p>

      {/* ── Guardians and next of kin (s6) ─────────────────────────────────────────────────────── */}
      <section className={`rounded-lg border p-3 ${isMinor && !hasGuardian ? "border-[var(--cmp-color-warning)] bg-[var(--cmp-surface-warning)]" : "border-gray-200 bg-gray-50/60"}`}>
        <div className="flex items-baseline justify-between gap-2 flex-wrap">
          <h3 className="text-[13px] font-bold text-gray-900">
            {isMinor ? "Guardian" : "Next of kin and contacts"}
            {isMinor && <span className="ml-1 font-normal text-[var(--cmp-text-warning)]">required</span>}
          </h3>
          <div className="flex gap-2">
            <button type="button" onClick={() => setRelations(r => [...r, emptyRelation(true)])}
              className="rounded-lg border border-gray-200 bg-white px-2.5 py-1 text-[12px] font-semibold text-gray-700 hover:bg-gray-50">
              + Guardian
            </button>
            <button type="button" onClick={() => setRelations(r => [...r, emptyRelation(false)])}
              className="rounded-lg border border-gray-200 bg-white px-2.5 py-1 text-[12px] font-semibold text-gray-700 hover:bg-gray-50">
              + Other contact
            </button>
          </div>
        </div>

        {relations.length === 0 ? (
          <p className="mt-2 text-[12px] text-gray-500">
            {isMinor
              ? `This patient is under ${majorityAge}. Add the parent, guardian or carer who has legal authority.`
              : "Add a next of kin, an emergency contact, an interpreter — as many as apply."}
          </p>
        ) : (
          <ul className="mt-2 flex flex-col gap-3">
            {relations.map((r, i) => (
              <li key={i} className="rounded-lg border border-gray-200 bg-white p-2.5">
                <div className="grid sm:grid-cols-2 gap-2">
                  <label className={label}>Relationship
                    <select value={r.relationshipType}
                      onChange={e => setRelation(i, {
                        relationshipType: e.target.value,
                        // AN INTERPRETER CANNOT BE A LEGAL GUARDIAN, and the server refuses it. Cleared
                        // here so the checkbox cannot be left ticked against a type that will be rejected.
                        isLegalGuardian: r.isLegalGuardian && GUARDIAN_TYPES.has(e.target.value),
                      })}
                      className={`mt-1 ${input}`}>
                      {RELATIONSHIP_OPTIONS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                    </select>
                  </label>
                  <label className={label}>Full name
                    <input value={r.fullName} onChange={e => setRelation(i, { fullName: e.target.value })} className={`mt-1 ${input}`} />
                  </label>
                  <label className={label}>Primary contact
                    <input value={r.phone} onChange={e => setRelation(i, { phone: e.target.value })} className={`mt-1 ${input}`} />
                  </label>
                  <label className={label}>Secondary contact
                    <input value={r.secondaryPhone} onChange={e => setRelation(i, { secondaryPhone: e.target.value })} className={`mt-1 ${input}`} />
                  </label>
                  <label className={`${label} sm:col-span-2`}>Email
                    <input value={r.email} onChange={e => setRelation(i, { email: e.target.value })} className={`mt-1 ${input}`} />
                  </label>
                </div>
                <div className="mt-2 flex items-center gap-3 flex-wrap text-[12px] text-gray-700">
                  <label className={`flex items-center gap-1.5 ${GUARDIAN_TYPES.has(r.relationshipType) ? "" : "opacity-40"}`}>
                    <input type="checkbox" checked={r.isLegalGuardian}
                      disabled={!GUARDIAN_TYPES.has(r.relationshipType)}
                      onChange={e => setRelation(i, { isLegalGuardian: e.target.checked })} />
                    Has legal authority
                  </label>
                  <label className="flex items-center gap-1.5">
                    <input type="checkbox" checked={r.mayReceiveInformation}
                      onChange={e => setRelation(i, { mayReceiveInformation: e.target.checked })} />
                    May be told clinical information
                  </label>
                  <label className="flex items-center gap-1.5">
                    <input type="radio" name="primary-contact" checked={r.isPrimary}
                      onChange={() => setRelations(rs => rs.map((x, j) => ({ ...x, isPrimary: j === i })))} />
                    Ring first
                  </label>
                  <button type="button" onClick={() => setRelations(rs => rs.filter((_, j) => j !== i))}
                    className="ml-auto text-[12px] font-semibold text-gray-400 hover:text-[var(--cmp-text-critical)]">
                    Remove
                  </button>
                </div>
                {/* THE TWO AUTHORITIES ARE DIFFERENT QUESTIONS, and conflating them is how an emergency
                    contact ends up consenting to surgery. */}
                {!GUARDIAN_TYPES.has(r.relationshipType) && r.relationshipType !== "emergency_contact" && (
                  <p className="mt-1 text-[11px] text-gray-400">
                    A {RELATIONSHIP_OPTIONS.find(([k]) => k === r.relationshipType)?.[1].toLowerCase()} cannot hold legal authority for a patient.
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── Hospital identifiers (s22) -- full registration only ───────────────────────────────── */}
      {mode === "full" && (
        <section className="rounded-lg border border-gray-200 bg-gray-50/60 p-3">
          <h3 className="flex items-center gap-2 text-[13px] font-bold text-gray-900"><span aria-hidden className={`flex h-6 w-6 items-center justify-center rounded-md text-[12px] ${SECTION_BADGE.identifiers.badge}`}>{SECTION_BADGE.identifiers.icon}</span>Hospital numbers</h3>
          <p className="mt-0.5 text-[12px] text-gray-500">
            A patient carries a different number at every hospital. Add them once the record exists
            &mdash; each one has to name the facility that issued it, or it cannot be checked against
            anything.
          </p>
          <p className="mt-1.5 text-[11px] text-gray-400">
            The national ID above is not facility-issued and is recorded here. Hospital MRNs, clinic and
            outpatient numbers are added from the patient&rsquo;s own page, where the facility list lives.
          </p>
        </section>
      )}

      {/* ── The photograph the comp asks for, in its designed position ──────────────────────────── */}
      <section className="rounded-lg border border-dashed border-gray-200 bg-gray-50/60 p-4">
        <h3 className="flex items-center gap-2 text-[13px] font-bold text-gray-900"><span aria-hidden className={`flex h-6 w-6 items-center justify-center rounded-md text-[12px] ${SECTION_BADGE.photo.badge}`}>{SECTION_BADGE.photo.icon}</span>Patient photograph</h3>
        <p className="mt-0.5 text-[12px] text-gray-600">
          The design offers Take Photo and Upload Photo. There is no file storage in this product, and a
          photograph of a patient is the most identifying file a practice could hold &mdash; so it is
          absent rather than behind a button that fails at the last step.
        </p>
      </section>

      {/* ── The visit ─────────────────────────────────────────────────────────────────────────────
          CP-SCHED-001 s6: "Reason for visit remains above it." The free-form datetime box that used to
          sit here is gone -- see the scheduling card's own header for what it could not know. */}
      <div className="grid gap-2">
        <label className={label}>Reason for visit
          <textarea rows={2} value={p.reasonForVisit}
            onChange={e => edit({ reasonForVisit: e.target.value })}
            placeholder="In their words, if you can" className={`mt-1 ${input}`} />
        </label>
      </div>

      {canBook ? (
        <SchedulingCard value={booking} onChange={setBooking}
          refreshNonce={nonce} alternatives={alternatives} />
      ) : (
        // ⚠ SAID, NOT SILENTLY ABSENT. Somebody who may register but not book should know why there is
        // no appointment section rather than assume the practice cannot take one.
        <p className="rounded-lg border border-dashed border-gray-200 bg-gray-50/60 px-3 py-2 text-[12px] text-gray-500">
          You can register this patient but not book an appointment for them &mdash; that needs the
          appointment permission. Somebody who has it can book from the calendar.
        </p>
      )}

      {/* ── Whatever this practice added to its own form (s9) ────────────────────────────────────
          RENDERED OUTSIDE THE SECTION, because the last conditional question disappearing is exactly
          when the section disappears too -- and that is the moment the sentence is most needed. */}
      {clearedNote && (
        <p className="rounded-lg bg-[var(--cmp-surface-warning)] px-3 py-2 text-[12px] text-[var(--cmp-text-warning)]">
          {clearedNote}
        </p>
      )}
      {customFields.length > 0 && (
        <section className="rounded-lg border border-gray-200 bg-gray-50/60 p-3">
          <h3 className="text-[13px] font-bold text-gray-900">
            {form.template?.name ?? "This practice's own fields"}
          </h3>
          <div className="mt-2 grid sm:grid-cols-2 gap-2">
            {customFields.map((f: any) => (
              <label key={f.field_key} className={label}>
                {f.label}{f.required ? " *" : ""}
                {/* ⚠ THE ONE FIELD RENDERER, SHARED WITH PRACTICE FORMS (CPR-KS-001 Phase 3).
                    This was an inline ternary handling three of the nine types a practice can author:
                    a multi-select drew a single-line text box, and so did a long text, and phone and
                    email drew untyped text. Every type is drawn properly now, and it is drawn by the
                    same component and validated by the same function that a consent form uses.
                    ⚠ IT STILL GOES THROUGH `editCustom`, which is `edit`, which is the ONE write path
                    where a withdrawn question's answer is thrown away. A control writing to setCustom
                    directly would silently opt out of the clearing. */}
                <span className="mt-1 block">
                  <FormFieldInput
                    field={f}
                    value={custom[f.field_key]}
                    onChange={v => editCustom(f.field_key, v)}
                  />
                </span>
                {f.help && <span className="mt-0.5 block font-normal text-[11px] text-gray-400">{f.help}</span>}
              </label>
            ))}
          </div>
        </section>
      )}

      {error && <p className="rounded-lg bg-[var(--cmp-surface-critical)] px-3 py-2 text-[13px] text-[var(--cmp-text-critical)]">{error}</p>}

      {candidates && (
        <div className="rounded-lg border border-[var(--cmp-color-warning)] bg-[var(--cmp-surface-warning)] p-3">
          <p className="text-[13px] font-bold text-[var(--cmp-text-warning)]">
            {candidates[0]?.hardBlock ? "That identifier already belongs to:" : "A very similar patient already exists:"}
          </p>
          <ul className="mt-1.5 flex flex-col gap-1">
            {candidates.map((c: any) => (
              <li key={c.id}>
                {/* ⚠ THIS SHOWED ONLY THE RETIRED IDENTIFIER, ON THE ONE SCREEN WHERE THAT COSTS MOST.
                    Migration 289 made patient_number the identifier and retired P-XXXXXX to a legacy
                    alias, so every candidate registered since August rendered as a bare NAME AND DATE
                    OF BIRTH -- on the list a person reads to answer "is this the same patient?", with
                    "This is a different person, register anyway" underneath it.

                    Candidate.patientNumber has carried the value since that day and this screen did not
                    read it. The type's own comment says why it was added: "THE ONE A HUMAN MATCHES ON
                    since migration 289 retired the P-XXXXXX below... every candidate screen was
                    type-blind to the identifier it is meant to show." The type stopped being blind; the
                    screen did not.

                    Same patientNumber ?? practiceId ladder as CohortTable, ContextBanner and
                    SearchSection. The legacy alias still shows for a record that predates the
                    numbering, because that is the number on that patient's older documents. */}
                <Link href={`/practice/patients/${c.id}`} className="text-[13px] font-semibold text-gray-800 hover:underline">
                  {c.displayName}
                  {(c.patientNumber ?? c.practiceId) ? ` · ${c.patientNumber ?? c.practiceId}` : ""}
                  {c.birthDate ? ` · b. ${c.birthDate}` : ""} ({c.matchedBy})
                </Link>
                {/* ⚠ A BLANK PRACTICE ID AND AN UNREADABLE ONE LOOKED IDENTICAL HERE, on the one screen
                    where somebody decides whether this is the same patient. The practice id is what they
                    match on, so a failed read made a real match look like a stranger -- and the button
                    below then creates the second record.

                    ⚠ STILL SHOWN EVEN NOW THE NUMBER LEADS, and deliberately: practiceIdUnknown means a
                    READ FAILED, and a candidate whose legacy alias could not be read is still harder to
                    judge than one that simply never had one. Suppressing the warning because a patient
                    number happens to be present would hide a failure behind an unrelated success. */}
                {c.practiceIdUnknown && (
                  <span className="ml-1 text-[11px] font-semibold text-[var(--cmp-text-critical)]">
                    · practice ID could not be read
                  </span>
                )}
              </li>
            ))}
          </ul>
          {candidates.some((c: any) => c.practiceIdUnknown) && (
            <p className="mt-1.5 text-[12px] text-[var(--cmp-text-critical)]">
              Some practice IDs could not be read, so this list may be harder to judge than usual. Open the
              patient before deciding they are a different person.
            </p>
          )}
          {!candidates[0]?.hardBlock && (
            // ⚠ THE CONFIRMATION RETURNS TO THE ACT IT CAME FROM. A duplicate warning raised while
            // booking must resume the booking -- sending it to the plain registration would silently
            // drop the appointment the desk had just chosen, and nothing on screen would say so.
            <button type="button" disabled={busy}
              onClick={() => (candidates[0]?.booked ? submitBooking(true) : submit(true))}
              className="mt-2 rounded-lg border border-[var(--cmp-color-warning)] px-3 py-1.5 text-[12px] font-semibold text-[var(--cmp-text-warning)] hover:bg-white/40">
              This is a different person — register {candidates[0]?.booked ? "and book " : ""}anyway
            </button>
          )}
        </div>
      )}

      {/* ── The actions ─────────────────────────────────────────────────────────────────────────
          CP-SCHED-001 s6 step 4: "Primary CTA becomes contextual, e.g. 'Register & book 10:20'.
          Secondary action: 'Register only'." Plus s6's separate operational action, "Add to today's
          queue", which uses today's active session and is not a booking at all.

          ⚠ THE PRIMARY ACTION MOVES WITH THE STATE OF THE CARD. With a time chosen, the consequential
          act is the booking and it names the minute -- a button that says "Register and book" without
          saying WHAT is a button somebody presses to find out. With no time chosen there is nothing to
          book, so the primary is the queue: that is what a walk-in desk presses most. */}
      <div className="flex items-center gap-2 flex-wrap border-t border-gray-100 pt-3">
        {booking && (
          <button type="button" disabled={busy || !canSubmit}
            onClick={() => submitBooking(false)}
            className={`rounded-lg px-4 py-2 text-[14px] font-semibold ${BUTTON.primary}`}>
            {busy ? "Saving…" : `Register & book ${booking.timeLabel}`}
          </button>
        )}

        {/* TWO PRIMARY ACTIONS, TWO COLOURS, because they are not the same act: one puts a person into
            today's clinic, the other files a record. The comp gives them indigo and violet; rendering
            both in one hue at a walk-in desk makes the more consequential of the two a coin toss, and
            rendering the second as a quiet outline (which it was) reads as "cancel". */}
        <button type="button" disabled={busy || !canSubmit}
          onClick={() => submit(false, "queue")}
          className={`rounded-lg px-4 py-2 text-[14px] font-semibold ${booking ? BUTTON.secondaryAction : BUTTON.primary}`}>
          {busy ? "Checking for duplicates…" : "Add to today's queue"}
        </button>
        <button type="button" disabled={busy || !canSubmit} onClick={() => submit(false)}
          className={`rounded-lg px-4 py-2 text-[14px] font-semibold ${booking ? BUTTON.quiet : BUTTON.secondaryAction}`}>
          Register only
        </button>

        {/* THE THIRD ACT, AND IT IS EXPLICIT ON PURPOSE -- see the reasoning in submit(). It is offered
            only to somebody who may open an encounter, and refused while the form is booking the visit
            for a later day, because that visit is not this one. */}
        {canStartEncounter && (
          <button type="button" disabled={busy || !canSubmit || bookedForLater}
            onClick={() => submit(false, "encounter")}
            className={`rounded-lg px-4 py-2 text-[14px] font-semibold ${BUTTON.quiet}`}>
            Register and start the consultation
          </button>
        )}

        <button type="button" disabled={busy || !name.trim()}
          onClick={async () => {
            const r = await fetch("/api/v1/practice/registration-workspace", {
              method: "POST", headers: { "content-type": "application/json" },
              body: JSON.stringify({ draftId, payload: { ...p, relations }, label: name }),
            });
            const d = await r.json().catch(() => ({}));
            if (!r.ok) { setError(d?.error?.message ?? "The draft could not be saved."); return; }
            setDraftId(d.id);
            onNotice?.({ kind: "ok", text: "Draft saved. It holds this person's details, so finish or discard it." });
          }}
          className="rounded-lg border border-gray-200 px-3 py-2 text-[13px] font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-40">
          {draftId ? "Update draft" : "Save draft"}
        </button>

        {missing.length > 0 && (
          <span className="text-[12px] font-semibold text-[var(--cmp-text-warning)]">
            Still needs {missing.join(", ")}.
          </span>
        )}
        {canStartEncounter && bookedForLater && missing.length === 0 && (
          <span className="text-[12px] text-gray-500">
            The appointment above is for another day, so this is not the start of a consultation.
          </span>
        )}
      </div>
      {/* A DRAFT HOLDS SOMEBODY'S DETAILS OUTSIDE THE PATIENT RECORD -- outside the access log, outside
          the merge machinery, outside every retention rule. Said here, where it is created. */}
      <p className="-mt-2 text-[11px] text-gray-400">
        A draft keeps what you have typed on your own desk. It is this person&rsquo;s details held
        outside the patient record, so finish it or discard it &mdash; nothing deletes drafts on a timer.
      </p>
    </form>
  );
}
