"use client";

import { useCallback, useMemo, useState } from "react";
import FormFieldInput from "@/components/practice/FormFieldInput";
import { resolveApplicable, clearedNotice } from "@/lib/practice/registration-condition";
import {
  INTAKE_FIELDS_ALWAYS_REQUIRED, intakeDerivedValues, intakeField,
} from "@/lib/practice/booking-rule-constants";
import { validateAnswer, isBlankAnswer } from "@/lib/practice/form-field";
import { appointmentTypeLabel } from "@/lib/practice/practice-session-constants";

/* eslint-disable @typescript-eslint/no-explicit-any */

// ────────────────────────────────────────────────────────────────────────────────────────────────────
// CPB-001's booking wizard: WHERE AND WHAT -> WHEN -> WHO YOU ARE -> PROVE IT (or ASK) -> CONFIRMATION.
//
// ---- ⚠ WHAT THIS COMPONENT IS NOT ALLOWED TO BE -----------------------------------------------------
//
//   1. ⚠ IT IS NOT A SECOND FORMS RUNTIME. This codebase has been bitten twice. The questions come from
//      the server (which resolves the practice's own rule), the CONTROLS come from the one closed
//      catalogue, the conditions are evaluated by registration-condition.ts's `resolveApplicable`, the
//      values are checked by form-field.ts's `validateAnswer`, and every control is drawn by
//      FormFieldInput. Nothing on this screen is a copy of any of those.
//   2. ⚠ IT IS NOT A GATE. Every refusal a patient can receive is decided on the server at the moment of
//      the write. What is drawn here is a convenience, and the server re-decides all of it.
//   3. ⚠ IT DOES NOT INVENT A SENTENCE ABOUT A PRACTICE. Every line of copy below is either fixed text
//      about this product's own behaviour, or a string the server returned. There is no "we have texted
//      you", because nothing texts anybody.
//   4. ⚠ IT NEVER DRAWS AN EMPTY LIST AS "NO TIMES". A failed read and an empty diary are different
//      sentences and the state below keeps them apart -- `slots: null` with `slotsProblem` set is an
//      outage, `slots: []` is a practice with nothing free.
//
// ---- ⚠ THE TWO DOORS, AND WHY THEY LOOK DIFFERENT ON PURPOSE ---------------------------------------
//
//   BOOK      needs a code sent to a phone or an inbox, and makes an appointment.
//   REQUEST   needs nothing, makes no appointment, and holds no time. Only where the practice turned it
//             on, and the server refuses it everywhere else however this screen is edited.
//
// They are drawn as two different things with two different consequences, because a patient who thinks
// they have an appointment when they have left a message is a patient who turns up to a closed door.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

const CONTROL =
  "w-full rounded-lg border border-gray-200 px-2.5 py-2 text-[13px] outline-none focus:border-[var(--cp-primary)] focus:ring-2 focus:ring-[var(--cp-primary)]/10";
const PRIMARY =
  "rounded-lg bg-[var(--cp-primary)] px-4 py-2 text-[12.5px] font-semibold text-white disabled:opacity-50";
const SECONDARY =
  "rounded-lg border border-gray-200 bg-white px-4 py-2 text-[12.5px] font-semibold text-gray-700 disabled:opacity-50";

type Slot = {
  sourceSlotId: string; startsAt: string; endsAt: string; minutes: number;
  locationId: string | null; locationName: string | null;
};

type Question = { fieldKey: string; label: string; level: string; condition?: unknown };

export default function BookingWizard(props: {
  handle: string;
  practitioner: string;
  displayName: string | null;
  instructions: string | null;
  privacyNotice: string | null;
  locations: { id: string; name: string }[];
  appointmentTypes: string[];
  canBook: boolean;
  canRequestWithoutCode: boolean;
  requestNote: string | null;
  /** The way through when the diary cannot help (migration 291). Either, both, or neither. */
  fallbackEmail: string | null;
  fallbackPhone: string | null;
  bookingWhyNot: string | null;
}) {
  const [step, setStep] = useState(1);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  // Step 1
  const [locationId, setLocationId] = useState<string>(props.locations[0]?.id ?? "");
  const [appointmentType, setAppointmentType] = useState<string>(props.appointmentTypes[0] ?? "");

  // Step 2 -- ⚠ THREE STATES. null means nobody has looked or the look failed; [] means nothing is free.
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [slotsProblem, setSlotsProblem] = useState<string | null>(null);
  const [timezone, setTimezone] = useState<string>("UTC");
  const [chosen, setChosen] = useState<Slot | null>(null);
  const [weekFrom, setWeekFrom] = useState(0);
  /** How many weeks the forward search covered, so the empty state can say how far it looked. */
  const [searchedWeeks, setSearchedWeeks] = useState(0);

  // Step 3
  const [questions, setQuestions] = useState<Question[] | null>(null);
  const [consentRequired, setConsentRequired] = useState(true);
  const [consentText, setConsentText] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [consent, setConsent] = useState(false);
  const [clearedNote, setClearedNote] = useState<string | null>(null);

  // Step 4
  const [channel, setChannel] = useState<"sms" | "email">("sms");
  const [destination, setDestination] = useState("");
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [token, setToken] = useState<string | null>(null);

  // Step 5
  const [done, setDone] = useState<any>(null);
  const [doneKind, setDoneKind] = useState<"booked" | "requested" | null>(null);

  const fmt = useCallback((iso: string) => {
    try {
      return new Date(iso).toLocaleString(undefined, {
        weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
        timeZone: timezone,
      });
    } catch { return iso; }
  }, [timezone]);

  // ── THE QUESTIONS, AS FIELDS THE ONE RENDERER UNDERSTANDS ──────────────────────────────────────
  //
  // ⚠ THE LABEL AND LEVEL COME FROM THE SERVER, THE CONTROL COMES FROM THE CATALOGUE. The catalogue is a
  // constant compiled into both halves, so a question that exists in one and not the other is impossible
  // -- and a key the catalogue does not know is DROPPED rather than drawn as an untyped text box, which
  // would collect an answer nobody can interpret.
  const fields = useMemo(() => (questions ?? []).map(q => {
    const f = intakeField(q.fieldKey);
    if (!f) return null;
    return {
      ...f,
      label: q.label || f.label,
      // `is_core` keeps the two questions a booking cannot exist without out of the clearing walk.
      is_core: INTAKE_FIELDS_ALWAYS_REQUIRED.includes(q.fieldKey),
      condition: q.condition,
      _level: q.level,
    };
  }).filter(Boolean) as (ReturnType<typeof intakeField> & { is_core: boolean; condition?: unknown; _level: string })[],
  [questions]);

  const onDate = chosen ? chosen.startsAt.slice(0, 10) : new Date().toISOString().slice(0, 10);

  // ⚠ THE SERVER'S OWN EVALUATOR, OVER THE SERVER'S OWN DERIVED FACT. `_is_child` is computed by
  // intakeDerivedValues -- the same function the rule engine calls -- so a guardian question appears here
  // for exactly the people it would be required of there.
  const resolved = useMemo(() => {
    const derived = intakeDerivedValues(values, onDate);
    return resolveApplicable(fields as any, { ...values, ...derived });
  }, [fields, values, onDate]);

  const applicable = resolved.applicable as typeof fields;

  // ── ONE WRITE PATH FOR EVERY ANSWER, so a withdrawn question's answer cannot survive by a handler
  //    that wrote to state directly. RegistrationForm.tsx makes the same argument at length.
  const edit = useCallback((key: string, value: unknown) => {
    const next = { ...values, [key]: value };
    const derived = intakeDerivedValues(next, onDate);
    const r = resolveApplicable(fields as any, { ...next, ...derived });
    const kept: Record<string, unknown> = {};
    for (const k of Object.keys(next)) if (k in r.values) kept[k] = next[k];
    setValues(kept);
    setClearedNote(clearedNotice((r.cleared as any[]).map(f => String(f.label ?? f.field_key))));
  }, [values, fields, onDate]);

  const missing = useMemo(() => applicable
    .filter(f => f._level === "required" && isBlankAnswer(values[f.field_key]))
    .map(f => f.label), [applicable, values]);

  const badAnswers = useMemo(() => applicable
    .filter(f => !isBlankAnswer(values[f.field_key]))
    .map(f => validateAnswer(f as any, values[f.field_key]))
    .filter(v => !v.ok).map(v => v.message), [applicable, values]);

  const contact = String(values.contact_phone ?? "").trim() || String(values.contact_email ?? "").trim();

  async function call(body: any) {
    setBusy(true); setProblem(null);
    try {
      const res = await fetch("/api/v1/practice/public/booking", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ handle: props.handle, ...body }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        // ⚠ THE SERVER'S SENTENCE, NOT A REWRITE OF IT. Replacing it with "something went wrong" throws
        // away the only part of the answer that tells somebody what to do next.
        setProblem(data?.error?.message ?? `That did not work (${res.status}).`);
        return null;
      }
      return data;
    } catch (e) {
      setProblem(`Nothing could be sent just now: ${e instanceof Error ? e.message : String(e)}`);
      return null;
    } finally { setBusy(false); }
  }

  /**
   * ⚠ IT SKIPS FORWARD TO THE FIRST WEEK THAT HAS SOMETHING, RATHER THAN SHOWING AN EMPTY ONE.
   *
   * The owner, 2026-08-12: "They should be automatically offered spaces if all the slots are filled."
   * A patient landing on an empty week has to work out that clicking "next" repeatedly might help, and
   * a quiet fortnight reads as a practice that is closed. So one call becomes at most SEARCH_WEEKS
   * calls, stopping at the first week with a free time.
   *
   * ⚠ AND THE SEARCH IS BOUNDED AND SAYS SO. Walking forward until something turns up would hammer the
   * endpoint against a practice with no availability at all. When the bound is reached the screen says
   * how far it looked -- "nothing in the next eight weeks" is a fact a patient can act on, whereas an
   * empty list is not.
   *
   * ⚠ AN OUTAGE STOPS THE SEARCH IMMEDIATELY. Treating a failed read as "this week is empty, try the
   * next" would turn one broken request into eight, and would end by reporting an outage as an
   * absence -- the exact conflation `slots: null` versus `slots: []` exists to prevent.
   */
  const SEARCH_WEEKS = 8;

  async function loadSlots(weekOffset: number, opts: { search?: boolean } = {}) {
    setBusy(true); setProblem(null); setSlotsProblem(null); setSearchedWeeks(0);
    try {
      const last = opts.search ? weekOffset + SEARCH_WEEKS - 1 : weekOffset;
      for (let w = weekOffset; w <= last; w++) {
        const from = new Date(Date.now() + w * 7 * 86400000);
        const to = new Date(from.getTime() + 7 * 86400000);
        const q = new URLSearchParams({
          handle: props.handle, appointmentType,
          from: from.toISOString(), to: to.toISOString(),
        });
        if (locationId) q.set("locationId", locationId);
        const res = await fetch(`/api/v1/practice/public/booking?${q}`, { cache: "no-store" });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          // ⚠ AN OUTAGE IS NOT AN EMPTY DIARY, AND THE TWO ARE HELD IN DIFFERENT STATE ON PURPOSE.
          setSlots(null);
          setSlotsProblem(data?.error?.message ?? `The times could not be read (${res.status}).`);
          return;
        }
        setTimezone(String(data.timezone ?? "UTC"));
        const found = (data.slots ?? []) as Slot[];
        if (found.length > 0 || w === last) {
          setSlots(found);
          setWeekFrom(w);
          setSearchedWeeks(opts.search ? w - weekOffset + 1 : 0);
          return;
        }
      }
    } catch (e) {
      setSlots(null);
      setSlotsProblem(`The times could not be read: ${e instanceof Error ? e.message : String(e)}`);
    } finally { setBusy(false); }
  }

  async function loadQuestions(slot: Slot) {
    setBusy(true); setProblem(null);
    try {
      const q = new URLSearchParams({
        action: "intake", handle: props.handle, appointmentType, scheduledAt: slot.startsAt,
      });
      if (locationId) q.set("locationId", locationId);
      const res = await fetch(`/api/v1/practice/public/booking?${q}`, { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setProblem(data?.error?.message ?? `The form could not be prepared (${res.status}).`);
        return false;
      }
      setQuestions((data.questions ?? []) as Question[]);
      setConsentRequired(data.consentRequired !== false);
      setConsentText(data.consentText ?? null);
      return true;
    } catch (e) {
      setProblem(`The form could not be prepared: ${e instanceof Error ? e.message : String(e)}`);
      return false;
    } finally { setBusy(false); }
  }

  const intakePayload = () => {
    const camel: Record<string, string> = {
      given_name: "givenName", family_name: "familyName", birth_date: "birthDate", age_years: "ageYears",
      sex: "sex", contact_phone: "contactPhone", contact_email: "contactEmail",
      representative_name: "representativeName", representative_relationship: "representativeRelationship",
      representative_phone: "representativePhone", reason_for_visit: "reasonForVisit",
      referral_source: "referralSource", stated_diagnosis: "statedDiagnosis",
      stated_treatment: "statedTreatment", stated_hospital_number: "statedHospitalNumber",
      consent_communication: "consentCommunication",
    };
    const out: Record<string, unknown> = { consentDataCapture: consent };
    // ⚠ ONLY WHAT IS ON SCREEN. `edit` has already cleared withdrawn answers from state, and this is the
    // second half of the same guarantee: a key that is not in `applicable` never reaches the wire.
    for (const f of applicable) {
      const k = camel[f.field_key];
      if (k && f.field_key in values) out[k] = values[f.field_key];
    }
    return out;
  };

  // ══ THE STEPS ══════════════════════════════════════════════════════════════════════════════════

  if (doneKind && done) return <Confirmation kind={doneKind} data={done} fmt={fmt} handle={props.handle} />;

  return (
    <div>
      <ol className="mb-5 flex flex-wrap gap-1.5 text-[10.5px] font-semibold uppercase tracking-wide">
        {["Where & what", "When", "About you", props.canBook ? "Verify" : "Send"].map((s, i) => (
          <li key={s} className={`rounded-lg px-2 py-1 ${step === i + 1
            ? "bg-[var(--cp-primary)]/12 text-[var(--cp-primary-deep)]"
            : step > i + 1 ? "bg-emerald-50 text-emerald-700" : "bg-gray-100 text-gray-500"}`}>
            {i + 1}. {s}
          </li>
        ))}
      </ol>

      {props.instructions && step === 1 && (
        <p className="mb-4 whitespace-pre-wrap rounded-lg border border-gray-200 bg-white p-3 text-[12.5px] leading-relaxed text-gray-700">
          {props.instructions}
        </p>
      )}

      {/* ⚠ THE REASON BOOKING IS SHUT IS SAID EVEN WHERE A REQUEST IS OPEN. Being offered a message
          instead of an appointment, with no account of why, reads as the product being broken. */}
      {!props.canBook && props.canRequestWithoutCode && props.bookingWhyNot && (
        <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50/70 p-3 text-[12.5px] leading-relaxed text-amber-900">
          <span className="font-bold">You cannot book online here.</span> {props.bookingWhyNot}{" "}
          What you can do is send this practice a request, and they will contact you.
        </p>
      )}

      {step === 1 && (
        <section className="rounded-xl border border-gray-200 bg-white p-4">
          <h1 className="text-[14px] font-bold text-gray-900">Where, and what kind of appointment</h1>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col text-[10.5px] font-semibold uppercase tracking-wide text-gray-500">
              Where
              <select value={locationId} onChange={e => setLocationId(e.target.value)} className={`mt-0.5 ${CONTROL}`}>
                {props.locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </label>
            <label className="flex flex-col text-[10.5px] font-semibold uppercase tracking-wide text-gray-500">
              What kind
              <select value={appointmentType} onChange={e => setAppointmentType(e.target.value)} className={`mt-0.5 ${CONTROL}`}>
                {props.appointmentTypes.map(t => <option key={t} value={t}>{appointmentTypeLabel(t)}</option>)}
              </select>
            </label>
          </div>
          <div className="mt-4">
            <button type="button" className={PRIMARY} disabled={busy || !appointmentType}
              onClick={async () => { setStep(2); await loadSlots(0, { search: true }); }}>
              Continue
            </button>
          </div>
        </section>
      )}

      {step === 2 && (
        <section className="rounded-xl border border-gray-200 bg-white p-4">
          <h1 className="text-[14px] font-bold text-gray-900">Choose a time</h1>
          <p className="mt-1 text-[11.5px] text-gray-500">
            Times are shown in this practice&rsquo;s own timezone ({timezone}). Choosing one does not
            reserve it &mdash; it is still free until a booking is actually made.
          </p>

          <div className="mt-3 flex items-center gap-2">
            <button type="button" className={SECONDARY} disabled={busy || weekFrom === 0}
              onClick={async () => { const w = Math.max(0, weekFrom - 1); setWeekFrom(w); await loadSlots(w); }}>
              Earlier
            </button>
            <span className="text-[11.5px] text-gray-600">
              {weekFrom === 0 ? "The next seven days" : `Week ${weekFrom + 1}`}
            </span>
            <button type="button" className={SECONDARY} disabled={busy || weekFrom >= 16}
              onClick={async () => { const w = weekFrom + 1; setWeekFrom(w); await loadSlots(w); }}>
              Later
            </button>
          </div>

          {/* ⚠ THREE DIFFERENT SENTENCES FOR THREE DIFFERENT STATES. */}
          {busy && <p className="mt-3 text-[12.5px] text-gray-500">Reading this practice&rsquo;s diary&hellip;</p>}
          {!busy && slotsProblem && (
            <p className="mt-3 rounded-lg border border-slate-300 bg-slate-50 p-3 text-[12.5px] leading-relaxed text-slate-700">
              <span className="font-bold">The times could not be read.</span> {slotsProblem} That is not
              the same as this practice having nothing free &mdash; nobody could tell. Please try again
              shortly.
            </p>
          )}
          {/* ⚠ THE ESCAPE ROUTE IS A ROUTE, NOT AN INSTRUCTION TO FIND ONE. This said "contact the
              practice directly" and gave no number and no address anywhere on the page -- an action
              named for somebody who cannot take it. It now says HOW FAR IT LOOKED (a bounded search
              reporting "nothing in eight weeks" is a fact a patient can act on) and offers whichever
              of the two contacts the practice has set. With neither set it falls back to the old
              sentence rather than drawing an empty "call" label. */}
          {!busy && !slotsProblem && slots !== null && slots.length === 0 && (
            <div className="mt-3 rounded-lg border border-gray-200 bg-gray-50/70 p-3 text-[12.5px] leading-relaxed text-gray-700">
              <p>
                {searchedWeeks > 1
                  ? `Nothing is free in the next ${searchedWeeks} weeks.`
                  : "Nothing is free in this week."}
                {" "}You can look further ahead with the arrows.
              </p>
              {(props.fallbackEmail || props.fallbackPhone) ? (
                <p className="mt-1.5">
                  If you need to be seen sooner than anything shown here, contact the practice
                  {props.fallbackPhone && (
                    <> on <a className="font-semibold text-[var(--cp-primary-deep)] underline" href={`tel:${props.fallbackPhone.replace(/\s+/g, "")}`}>{props.fallbackPhone}</a></>
                  )}
                  {props.fallbackPhone && props.fallbackEmail && " or"}
                  {props.fallbackEmail && (
                    <> at <a className="font-semibold text-[var(--cp-primary-deep)] underline" href={`mailto:${props.fallbackEmail}`}>{props.fallbackEmail}</a></>
                  )}.
                </p>
              ) : (
                <p className="mt-1.5">Try a later week, or contact the practice directly.</p>
              )}
            </div>
          )}
          {!busy && slots !== null && slots.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {slots.map(s => (
                <button key={`${s.sourceSlotId}-${s.startsAt}`} type="button"
                  onClick={() => setChosen(s)}
                  className={`rounded-lg px-2.5 py-1.5 text-[12px] font-semibold ${
                    chosen?.startsAt === s.startsAt
                      ? "bg-[var(--cp-primary)]/12 text-[var(--cp-primary-deep)] ring-1 ring-[var(--cp-primary)]/30"
                      : "bg-gray-100 text-gray-700"}`}>
                  {fmt(s.startsAt)}
                </button>
              ))}
            </div>
          )}

          {problem && <Problem text={problem} />}

          <div className="mt-4 flex gap-2">
            <button type="button" className={SECONDARY} onClick={() => setStep(1)}>Back</button>
            <button type="button" className={PRIMARY} disabled={busy || !chosen}
              onClick={async () => { if (chosen && await loadQuestions(chosen)) setStep(3); }}>
              Continue
            </button>
          </div>
        </section>
      )}

      {step === 3 && (
        <section className="rounded-xl border border-gray-200 bg-white p-4">
          <h1 className="text-[14px] font-bold text-gray-900">About you</h1>
          {chosen && (
            <p className="mt-1 text-[12px] text-gray-600">
              {fmt(chosen.startsAt)} &middot; {appointmentTypeLabel(appointmentType)}
              {chosen.locationName ? ` · ${chosen.locationName}` : ""}
            </p>
          )}
          <p className="mt-1 text-[11.5px] text-gray-500">
            {questions === null
              ? "The questions this practice asks are being read."
              : `This practice asks ${applicable.length} question${applicable.length === 1 ? "" : "s"}. Nothing else is collected.`}
          </p>

          <div className="mt-3 space-y-3">
            {applicable.map(f => (
              <label key={f.field_key} className="block">
                <span className="text-[11px] font-semibold text-gray-700">
                  {f.label}
                  {f._level === "required" && <span className="ml-1 text-rose-600">*</span>}
                </span>
                {f.help && <span className="mt-0.5 block text-[10.5px] leading-relaxed text-gray-500">{f.help}</span>}
                <span className="mt-1 block">
                  {/* ⚠ THE ONE RENDERER. Eleven field types, one component, validated by the server's own
                      function -- see FormFieldInput.tsx's header. */}
                  <FormFieldInput field={f as any} value={values[f.field_key]}
                    onChange={v => edit(f.field_key, v)} />
                </span>
              </label>
            ))}
          </div>

          {clearedNote && (
            <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50/70 px-3 py-2 text-[11.5px] leading-relaxed text-amber-900">
              {clearedNote}
            </p>
          )}

          {props.privacyNotice && (
            <details className="mt-3">
              <summary className="cursor-pointer text-[11.5px] font-semibold text-[var(--cp-primary)]">
                What this practice does with your details
              </summary>
              <p className="mt-1 whitespace-pre-wrap text-[11.5px] leading-relaxed text-gray-600">{props.privacyNotice}</p>
            </details>
          )}

          <label className="mt-3 flex items-start gap-2 text-[12px] leading-relaxed text-gray-700">
            <input type="checkbox" className="mt-0.5" checked={consent} onChange={e => setConsent(e.target.checked)} />
            <span>
              {consentText ?? "I agree to this practice keeping the details I have entered so that it can arrange this appointment."}
              {consentRequired && <span className="ml-1 text-rose-600">*</span>}
            </span>
          </label>

          {/* ⚠ WHAT IS STILL MISSING IS NAMED BEFORE THE BUTTON IS PRESSED, not after the server refuses. */}
          {missing.length > 0 && (
            <p className="mt-3 text-[11.5px] text-gray-600">Still needed: {missing.join(", ")}.</p>
          )}
          {badAnswers.length > 0 && (
            <p className="mt-1 text-[11.5px] text-rose-700">{badAnswers.join(" ")}</p>
          )}
          {!contact && (
            <p className="mt-1 text-[11.5px] text-gray-600">
              Give a phone number or an email address &mdash; the practice has no other way to reach you.
            </p>
          )}

          {problem && <Problem text={problem} />}

          <div className="mt-4 flex gap-2">
            <button type="button" className={SECONDARY} onClick={() => setStep(2)}>Back</button>
            <button type="button" className={PRIMARY}
              disabled={busy || missing.length > 0 || badAnswers.length > 0 || !contact || (consentRequired && !consent)}
              onClick={() => {
                setDestination(String(values.contact_phone ?? "").trim() || String(values.contact_email ?? "").trim());
                setChannel(String(values.contact_phone ?? "").trim() ? "sms" : "email");
                setStep(4);
              }}>
              Continue
            </button>
          </div>
        </section>
      )}

      {step === 4 && (
        <section className="rounded-xl border border-gray-200 bg-white p-4">
          {props.canBook ? (
            <>
              <h1 className="text-[14px] font-bold text-gray-900">Confirm it is you</h1>
              <p className="mt-1 text-[12px] leading-relaxed text-gray-600">
                This practice sends a code to your phone or inbox before it takes a booking. Enter the
                code and the appointment is made.
              </p>

              {!challengeId ? (
                <>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <label className="flex flex-col text-[10.5px] font-semibold uppercase tracking-wide text-gray-500">
                      Send it by
                      <select value={channel} onChange={e => setChannel(e.target.value as "sms" | "email")} className={`mt-0.5 ${CONTROL}`}>
                        <option value="sms">Text message</option>
                        <option value="email">Email</option>
                      </select>
                    </label>
                    <label className="flex flex-col text-[10.5px] font-semibold uppercase tracking-wide text-gray-500">
                      To
                      <input value={destination} onChange={e => setDestination(e.target.value)} className={`mt-0.5 ${CONTROL}`} />
                    </label>
                  </div>
                  {/* ⚠ THE SAME ADDRESS OR THE BOOKING IS REFUSED, AND SAYING SO BEATS A 403 LATER. The
                      session proves control of the address the code went to, and the booking must claim
                      that same one. */}
                  <p className="mt-1.5 text-[11px] leading-relaxed text-gray-500">
                    This must be the number or address you gave above &mdash; the code proves that one is
                    yours, and a booking made with a different one is refused.
                  </p>
                  <div className="mt-3">
                    <button type="button" className={PRIMARY} disabled={busy || !destination.trim()}
                      onClick={async () => {
                        const r = await call({ action: "request_code", channel, destination });
                        if (r?.challengeId) setChallengeId(String(r.challengeId));
                      }}>
                      {busy ? "Sending…" : "Send me a code"}
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <label className="mt-3 flex flex-col text-[10.5px] font-semibold uppercase tracking-wide text-gray-500">
                    The six-digit code
                    <input value={code} onChange={e => setCode(e.target.value)} inputMode="numeric"
                      maxLength={6} className={`mt-0.5 ${CONTROL}`} />
                  </label>
                  <div className="mt-3 flex gap-2">
                    <button type="button" className={PRIMARY} disabled={busy || code.trim().length !== 6}
                      onClick={async () => {
                        const v = token ? { token } : await call({ action: "confirm_code", challengeId, code });
                        const t = token ?? (v?.token ? String(v.token) : null);
                        if (!t) return;
                        setToken(t);
                        const r = await call({
                          action: "book", token: t, ...intakePayload(),
                          scheduledAt: chosen?.startsAt, appointmentType, locationId: locationId || null,
                          durationMinutes: chosen?.minutes ?? null,
                        });
                        if (r) { setDone(r); setDoneKind("booked"); }
                      }}>
                      {busy ? "Checking…" : "Confirm and book"}
                    </button>
                  </div>
                </>
              )}
            </>
          ) : (
            <>
              <h1 className="text-[14px] font-bold text-gray-900">Send your request</h1>
              {/* ⚠ THE SERVER'S OWN SENTENCE ABOUT WHAT THIS IS. Written once, in the engine, so this
                  screen cannot promise something the record does not do. */}
              <p className="mt-1 rounded-lg border border-amber-200 bg-amber-50/70 p-3 text-[12.5px] leading-relaxed text-amber-900">
                {props.requestNote}
              </p>
              <div className="mt-3">
                <button type="button" className={PRIMARY} disabled={busy}
                  onClick={async () => {
                    const r = await call({
                      action: "request_without_code", ...intakePayload(),
                      scheduledAt: chosen?.startsAt, appointmentType, locationId: locationId || null,
                    });
                    if (r) { setDone(r); setDoneKind("requested"); }
                  }}>
                  {busy ? "Sending…" : "Send this request"}
                </button>
              </div>
            </>
          )}

          {problem && <Problem text={problem} />}

          <div className="mt-4">
            <button type="button" className={SECONDARY} onClick={() => setStep(3)}>Back</button>
          </div>
        </section>
      )}
    </div>
  );
}

function Problem({ text }: { text: string }) {
  return (
    <p className="mt-3 rounded-lg border border-rose-200 bg-rose-50/70 px-3 py-2 text-[12px] leading-relaxed text-rose-800">
      {text}
    </p>
  );
}

/**
 * ⚠ TWO DIFFERENT CONFIRMATIONS, BECAUSE THEY CONFIRM TWO DIFFERENT THINGS.
 *
 * A booking says an appointment exists. A request says one does not, that the time is not held, and that
 * somebody will be in touch. Drawing them the same way -- one green tick, one "thank you" -- is how a
 * patient turns up to a practice that never booked them.
 */
function Confirmation({ kind, data, fmt, handle }: {
  kind: "booked" | "requested"; data: any; fmt: (iso: string) => string; handle: string;
}) {
  const booked = kind === "booked";
  return (
    <section className={`rounded-xl border p-4 ${booked ? "border-emerald-200 bg-emerald-50/60" : "border-amber-200 bg-amber-50/60"}`}>
      <h1 className={`text-[15px] font-bold ${booked ? "text-emerald-900" : "text-amber-950"}`}>
        {booked ? "Your appointment is booked" : "Your request has been sent"}
      </h1>

      <p className="mt-2 text-[13px] text-gray-800">
        <span className="font-bold">{data.reference}</span> &mdash; write this down.
      </p>
      <p className="mt-1 text-[12.5px] text-gray-700">
        {fmt(String(booked ? data.scheduledAt : data.requestedStart))}
        {data.locationName ? ` · ${data.locationName}` : ""}
      </p>

      {/* ⚠ NOT VERIFIED, SAID ON THE PATIENT'S OWN CONFIRMATION AS WELL AS ON THE PRACTICE'S SCREEN. It
          is read from the row rather than assumed by this component. */}
      {!booked && data.verificationState === "unverified" && (
        <p className="mt-2 rounded-lg border border-amber-300 bg-white/70 px-3 py-2 text-[11.5px] font-semibold text-amber-900">
          Nothing has been verified. This practice will contact you before anything is arranged.
        </p>
      )}

      <p className="mt-3 text-[12.5px] leading-relaxed text-gray-700">
        {booked ? data.confirmationNote : data.note}
      </p>

      {data.answersNotKept && (
        <p className="mt-2 text-[11.5px] leading-relaxed text-gray-600">{data.answersNotKept}</p>
      )}

      <p className="mt-4 text-[11px] text-gray-500">
        <a href={`/practice/book/@${handle}`} className="hover:underline">Back to this practice&rsquo;s page</a>
      </p>
    </section>
  );
}
