"use client";

import { useCallback, useMemo, useState } from "react";
import FormFieldInput from "@/components/practice/FormFieldInput";
import { resolveApplicable, clearedNotice } from "@/lib/practice/registration-condition";
import {
  INTAKE_FIELDS_ALWAYS_REQUIRED, intakeDerivedValues, intakeField,
} from "@/lib/practice/booking-rule-constants";
import { validateAnswer, isBlankAnswer } from "@/lib/practice/form-field";
import { appointmentTypeLabel } from "@/lib/practice/practice-session-constants";
import { practiceDayOf, practiceToday } from "@/lib/practice/practice-time";
import DetailsStep from "./DetailsStep";
import { IdentityStrip, AppointmentSummary, type SummaryIdentity } from "./BookingSummary";
import { buildIcs, directionsUrl } from "@/lib/practice/calendar-invite";

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
  /** s3: the practitioner strip that persists through every step, from the public projection. */
  identity: SummaryIdentity;
  displayName: string | null;
  instructions: string | null;
  privacyNotice: string | null;
  locations: {
    id: string; name: string; mode: "in_person" | "virtual";
    address: string | null; mapUrl: string | null;
  }[];
  appointmentTypes: string[];
  canBook: boolean;
  canRequestWithoutCode: boolean;
  requestNote: string | null;
  /** The way through when the diary cannot help (migration 291). Either, both, or neither. */
  fallbackEmail: string | null;
  fallbackPhone: string | null;
  bookingWhyNot: string | null;
  /**
   * s8.5's emergency statement, from the practice's own instructions where it set one.
   *
   * ⚠ NOT A HARD-CODED NUMBER. "Call 911" under a booking form in Kampala is worse than saying nothing,
   * and the spec says so in as many words: the wording must be deployment-appropriate and configurable.
   * Null means the practice has not written one, and nothing is invented on its behalf.
   */
  safetyNote: string | null;
}) {
  const [step, setStep] = useState(1);
  // s19 asks for time-to-complete. Without a journey id the SERVER cannot know when this patient
  // started, so the client reports the elapsed seconds on the final step -- a duration, never an
  // identifier. It is read once at mount and never sent for an abandoned journey, because there is no
  // final step to attach it to.
  const [startedAt] = useState(() => Date.now());
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
  /**
   * ⚠ WHICH DATE THE PATIENT IS LOOKING AT. Until now there was no such thing: every day the window
   * happened to contain was printed one under another, and choosing a date meant scrolling to it. A
   * person booking an appointment picks a DAY first and a time second, and the screen now works that way.
   * Null until the slots arrive, then the first day that has any.
   */
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

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

  // ⚠ THE DATE THE INTAKE RULES ARE EVALUATED ON, so it decides which questions this patient is
  // asked -- a guardian question turns on whether they are a child ON THIS DATE. Both halves were
  // the UTC day: a chosen slot at 21:30 Kampala sliced to the following date, and the no-slot case
  // used the browser's UTC. The practice's zone is already in state below and is already shown to
  // the patient in as many words ("Times are shown in this practice's own timezone").
  //
  // It starts as "UTC" until the practice's config arrives; the value corrects itself on that
  // response, and no booking is submitted before it does.
  const onDate = chosen
    ? practiceDayOf(timezone, chosen.startsAt) ?? practiceToday(timezone)
    : practiceToday(timezone);

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

  // ⚠ THE PATIENT'S NAME FOR THE FIELD, NOT THE PRACTITIONER'S. "Still needed: Who referred them" names
  // a question this form does not ask -- it asks "Who referred you?" -- so the one place a person looks
  // when the button will not enable would have pointed at a label that is not on screen.
  const missing = useMemo(() => applicable
    .filter(f => f._level === "required" && isBlankAnswer(values[f.field_key]))
    .map(f => (f as any).patientLabel ?? f.label), [applicable, values]);

  const badAnswers = useMemo(() => applicable
    .filter(f => !isBlankAnswer(values[f.field_key]))
    .map(f => validateAnswer(f as any, values[f.field_key]))
    .filter(v => !v.ok).map(v => v.message), [applicable, values]);

  const contact = String(values.contact_phone ?? "").trim() || String(values.contact_email ?? "").trim();

  // ⚠ THE ENGINE'S OWN DERIVED FACT, PASSED DOWN RATHER THAN RECOMPUTED. `_is_child` decides whether a
  // guardian section is shown, and a second age calculation in the view layer is how a form comes to
  // disagree with the rule that will judge it.
  const isChild = useMemo(
    () => intakeDerivedValues(values, onDate)._is_child === true,
    [values, onDate]);

  /**
   * The timezone as a patient reads it (s6): "East Africa Time (EAT)", not "Africa/Kampala".
   *
   * ⚠ DERIVED FROM THE PRACTICE'S CANONICAL ZONE, never hard-coded for this deployment. Intl supplies
   * the long and short names, so a practice in Lagos or Nairobi gets its own without a lookup table
   * here; the identifier is the fallback when a runtime cannot name it.
   */
  const timezoneLabel = useMemo(() => {
    const nameOf = (style: "long" | "short") => {
      try {
        const parts = new Intl.DateTimeFormat("en-GB", { timeZone: timezone, timeZoneName: style })
          .formatToParts(new Date());
        return parts.find(p => p.type === "timeZoneName")?.value ?? null;
      } catch { return null; }
    };
    const long = nameOf("long");
    const short = nameOf("short");
    // ⚠ THE ABBREVIATION ONLY WHERE IT IS ONE. Intl returns "GMT+3" as the short name for Africa/Kampala
    // on most runtimes, and "East Africa Time (GMT+3)" tells a patient nothing the first three words did
    // not -- while "East Africa Time (EAT)" does, where the runtime knows it.
    if (long && short && long !== short && !/^GMT|^UTC/.test(short)) return `${long} (${short})`;
    return long ?? short ?? timezone;
  }, [timezone]);

  /** Just the clock time, for slots already grouped under their date. */
  const timeOf = useCallback((iso: string) => {
    try {
      return new Date(iso).toLocaleTimeString(undefined, {
        hour: "numeric", minute: "2-digit", timeZone: timezone,
      });
    } catch { return iso; }
  }, [timezone]);

  /**
   * s6: "Group time slots under their date." A flat run of forty buttons reading "Wed 9 Sep, 08:30" is
   * the same information with the scanning done by the patient instead of the page.
   */
  const slotDays = useMemo(() => {
    if (!slots) return [];
    const days = new Map<string, { label: string; slots: Slot[] }>();
    for (const s of slots) {
      const key = practiceDayOf(timezone, s.startsAt) ?? s.startsAt.slice(0, 10);
      if (!days.has(key)) {
        let label = key;
        try {
          label = new Date(s.startsAt).toLocaleDateString(undefined, {
            weekday: "long", day: "numeric", month: "long", timeZone: timezone,
          });
        } catch { /* the key is still a true date */ }
        days.set(key, { label, slots: [] });
      }
      days.get(key)!.slots.push(s);
    }
    return [...days.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([key, v]) => ({ key, ...v }));
  }, [slots, timezone]);

  /**
   * The day whose times are on screen. DERIVED rather than held in an effect, so it cannot lag the
   * window: when a new window arrives with different dates, a stale selection is simply not among them
   * and the first available day takes over on the same render.
   */
  const activeDay = selectedDay && slotDays.some(d => d.key === selectedDay)
    ? selectedDay
    : (slotDays[0]?.key ?? null);
  const activeDaySlots = slotDays.find(d => d.key === activeDay)?.slots ?? [];

  /** A date chip's two lines: "Wed" over "9 Sep". Short, because there may be a month of them. */
  const chipLabel = (isoDay: string, sample: string) => {
    try {
      const d = new Date(sample);
      return {
        weekday: d.toLocaleDateString(undefined, { weekday: "short", timeZone: timezone }),
        day: d.toLocaleDateString(undefined, { day: "numeric", month: "short", timeZone: timezone }),
      };
    } catch { return { weekday: "", day: isoDay }; }
  };

  const locationOf = (id: string) => props.locations.find(l => l.id === id) ?? null;
  const MODE_WORD: Record<string, string> = { in_person: "In-person", virtual: "Online consultation" };

  /** What the persistent summary shows (s7). Every value is state, never a re-derivation. */
  const summaryFacts = {
    locationName: locationOf(locationId)?.name ?? null,
    mode: locationOf(locationId) ? MODE_WORD[locationOf(locationId)!.mode] ?? null : null,
    appointmentTypeLabel: appointmentType ? appointmentTypeLabel(appointmentType) : null,
    when: chosen ? fmt(chosen.startsAt) : null,
    minutes: chosen?.minutes ?? null,
  };

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
   * ⚠ IT LOOKS EIGHT WEEKS AHEAD AT ONCE, RATHER THAN A WEEK AT A TIME.
   *
   * The owner, 2026-08-12: "They should be automatically offered spaces if all the slots are filled."
   * A patient landing on an empty week has to work out that clicking "next" repeatedly might help, and
   * a quiet fortnight reads as a practice that is closed.
   *
   * ⚠ THIS USED TO BE A LOOP -- up to eight one-week calls, stopping at the first week with something --
   * and the loop was answering the owner's point at the price of up to eight round trips. It was built on
   * the assumption that a wider range costs more, and it does not: see loadSlots for the measurements.
   * The whole window is now one call, which is faster AND is what lets the patient see every available
   * date at once instead of discovering them one week at a time.
   *
   * ⚠ THE SEARCH IS STILL BOUNDED AND STILL SAYS SO. "Nothing is free in the next eight weeks" is a fact
   * a patient can act on, whereas an empty list is not -- and the arrows move a whole window at a time
   * for anybody who needs to look further.
   *
   * ⚠ AN OUTAGE IS STILL NOT AN ABSENCE. A failed read sets `slots: null` and its own sentence, never
   * `[]` -- the conflation that distinction exists to prevent.
   */
  const SEARCH_WEEKS = 8;

  /**
   * ⚠ ONE REQUEST FOR THE WHOLE WINDOW, WHERE THIS USED TO MAKE UP TO EIGHT.
   *
   * The loop this replaces asked for one week, and if that week was empty asked for the next, up to
   * SEARCH_WEEKS times -- built on the reasonable assumption that a wider range costs more.
   *
   * IT DOES NOT. Measured against production on 2026-09-02: a 7-day window took 2761ms, a 28-day window
   * 2724ms and a 56-day window 2813ms. The cost is resolving the practice's rules and diary, paid once
   * per call whatever the range. So the old shape charged a patient with a quiet fortnight ~8 seconds of
   * "Reading this practice's diary" -- and up to ~22 for a genuinely empty two months -- to learn
   * something a single call answers in under three.
   *
   * The window is asked for whole, once. That is faster, it is fewer requests against an unauthenticated
   * endpoint, and it is what makes a date PICKER possible at all: you cannot offer somebody a choice of
   * dates while you are still discovering them one week at a time.
   */
  const WINDOW_WEEKS = SEARCH_WEEKS;

  async function loadSlots(weekOffset: number, _opts: { search?: boolean } = {}) {
    setBusy(true); setProblem(null); setSlotsProblem(null); setSearchedWeeks(0);
    try {
      const from = new Date(Date.now() + weekOffset * 7 * 86400000);
      const to = new Date(from.getTime() + WINDOW_WEEKS * 7 * 86400000);
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
      setSlots(found);
      setWeekFrom(weekOffset);
      // The window really was searched, so the empty state can still say how far it looked.
      setSearchedWeeks(WINDOW_WEEKS);
      // ⚠ THE CHOSEN DAY IS CLEARED WITH THE WINDOW. Keeping it would leave a date selected that the new
      // window does not contain, and the times panel would render nothing with no explanation.
      setSelectedDay(null);
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

  if (doneKind && done) {
    const where = locationOf(locationId);
    return (
      <Confirmation kind={doneKind} data={done} fmt={fmt} handle={props.handle}
        practitioner={props.identity.displayName}
        location={where ? { name: where.name, address: where.address, mapUrl: where.mapUrl } : null} />
    );
  }

  // s4/AC-01: the four patient-facing steps. "Where & what / When / About you / Verify" described the
  // form's own construction; these describe what the patient is doing.
  const STEP_LABELS = ["Appointment", "Date & time", "Your details", props.canBook ? "Confirm" : "Send"];

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-xl border border-gray-200 bg-white p-3.5">
        <IdentityStrip identity={props.identity} locationName={summaryFacts.locationName} />
      </div>

      {/* ⚠ THE STEPPER CARRIES A MARK AS WELL AS A COLOUR (s4). A completed step that differs only in
          hue is a step nobody colour-blind can distinguish from the one they are on. On a narrow screen
          the labels collapse to "Step 2 of 4 - Date & time", which stays legible where four chips do not. */}
      <nav aria-label="Booking progress">
        <p className="text-[11.5px] font-semibold text-[var(--cp-primary-deep)] sm:hidden">
          Step {step} of 4 &middot; {STEP_LABELS[step - 1]}
        </p>
        <ol className="hidden flex-wrap gap-1.5 text-[10.5px] font-semibold uppercase tracking-wide sm:flex">
          {STEP_LABELS.map((s, i) => {
            const done = step > i + 1;
            const current = step === i + 1;
            return (
              <li key={s} aria-current={current ? "step" : undefined}
                className={`rounded-lg px-2 py-1 ${current
                  ? "bg-[var(--cp-primary)] text-white"
                  : done ? "bg-emerald-50 text-emerald-700" : "bg-gray-100 text-gray-500"}`}>
                <span aria-hidden>{done ? "✓" : i + 1}</span> {s}
              </li>
            );
          })}
        </ol>
      </nav>

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

      {/* ⚠ THE SUMMARY IS RENDERED ONCE, ABOVE THE STEPS, AND ONLY FROM STEP 2 (s7). On a phone it sits
          where the patient's thumb already is; on a desktop the journey column and the summary sit side
          by side, which is what the 65/35 split in s3 asks for without a second component. */}
      {step > 1 && (
        <div className="md:hidden">
          <AppointmentSummary facts={summaryFacts} onChange={s => setStep(s)} compact />
        </div>
      )}

      <div className={step > 1 ? "grid gap-4 md:grid-cols-[minmax(0,1fr)_300px]" : ""}>
        {step > 1 && (
          <aside className="hidden md:order-2 md:block">
            <AppointmentSummary facts={summaryFacts} onChange={s => setStep(s)} />
          </aside>
        )}
        <div className="flex flex-col gap-4 md:order-1">

      {step === 1 && (
        <section className="rounded-xl border border-gray-200 bg-white p-4">
          <h1 className="text-[15px] font-bold text-gray-900">What would you like to book?</h1>

          {/* ⚠ ONE LOCATION IS STATED, NOT ASKED (s5). A dropdown with a single option is a control that
              looks like a decision and has none, and it costs a tap on a phone. */}
          {props.locations.length === 1 ? (
            <p className="mt-2 text-[12.5px] text-gray-700">
              <span className="font-semibold">{props.locations[0].name}</span>
              <span className="text-gray-500"> &middot; {MODE_WORD[props.locations[0].mode] ?? "In-person"}</span>
            </p>
          ) : props.locations.length > 1 && (
            <label className="mt-3 block">
              <span className="text-[12px] font-semibold text-gray-800">Location</span>
              <select value={locationId} onChange={e => { setLocationId(e.target.value); setChosen(null); }}
                className={`mt-1 ${CONTROL}`}>
                {props.locations.map(l => (
                  <option key={l.id} value={l.id}>
                    {l.name} — {MODE_WORD[l.mode] ?? "In-person"}
                  </option>
                ))}
              </select>
            </label>
          )}

          {/* s5: selectable cards rather than a dropdown while the eligible set is small -- a patient
              choosing what kind of appointment they need is making the decision this page exists for. */}
          <fieldset className="mt-4">
            <legend className="text-[12px] font-semibold text-gray-800">Appointment type</legend>
            <div className="mt-2 flex flex-col gap-2" role="radiogroup" aria-label="Appointment type">
              {props.appointmentTypes.map(t => (
                <button key={t} type="button" role="radio" aria-checked={appointmentType === t}
                  onClick={() => { setAppointmentType(t); setChosen(null); }}
                  className={`rounded-lg border px-3.5 py-3 text-left ${
                    appointmentType === t
                      ? "border-[var(--cp-primary)] bg-[var(--cp-primary)]/8 ring-1 ring-[var(--cp-primary)]/30"
                      : "border-gray-200 bg-white hover:bg-gray-50"}`}>
                  <span className="flex items-center gap-2">
                    <span aria-hidden className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
                      appointmentType === t ? "border-[var(--cp-primary)]" : "border-gray-300"}`}>
                      {appointmentType === t && <span className="h-2 w-2 rounded-full bg-[var(--cp-primary)]" />}
                    </span>
                    <span className="text-[13px] font-semibold text-gray-900">{appointmentTypeLabel(t)}</span>
                  </span>
                </button>
              ))}
            </div>
          </fieldset>

          {problem && <Problem text={problem} />}

          <div className="mt-4">
            <button type="button" className={PRIMARY} disabled={busy || !appointmentType}
              onClick={async () => { setStep(2); await loadSlots(0, { search: true }); }}>
              Continue to date &amp; time →
            </button>
          </div>
        </section>
      )}

      {step === 2 && (
        <section className="rounded-xl border border-gray-200 bg-white p-4">
          <h1 className="text-[15px] font-bold text-gray-900">Choose a date &amp; time</h1>
          {/* s6: the zone in the words a patient uses, and the non-reservation stated as a fact about
              when the appointment becomes theirs rather than as a note about how the engine works. */}
          <p className="mt-1 text-[11.5px] leading-relaxed text-gray-500">
            Times shown in {timezoneLabel}. Your appointment time is confirmed when booking is completed.
          </p>

          {/* ⚠ "WEEK 2" WAS AN IMPLEMENTATION CONCEPT ON A PATIENT'S SCREEN (s6). The window is described
              by the dates it covers, which is the thing the patient is actually looking at. */}
          {/* ⚠ THE ARROWS MOVE A WHOLE WINDOW, NOT A WEEK. They used to step seven days at a time, which
              is why reaching a date a month out took four clicks and four waits. Each click now covers
              eight weeks, for the same cost as the one week it used to fetch. */}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button type="button" className={SECONDARY} disabled={busy || weekFrom === 0}
              onClick={async () => { const w = Math.max(0, weekFrom - WINDOW_WEEKS); await loadSlots(w); }}>
              ← Earlier
            </button>
            <span className="text-[11.5px] text-gray-600">
              {weekFrom === 0 ? "The next eight weeks" : `Weeks ${weekFrom + 1}–${weekFrom + WINDOW_WEEKS} from now`}
            </span>
            <button type="button" className={SECONDARY} disabled={busy || weekFrom + WINDOW_WEEKS >= 24}
              onClick={async () => { const w = weekFrom + WINDOW_WEEKS; await loadSlots(w); }}>
              Later →
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
                {/* ⚠ IT SAYS WHICH WEEKS WERE SEARCHED, NOT JUST HOW MANY. "Nothing in the next eight
                    weeks" is false once the patient has already paged forward -- the window then covers
                    weeks nine to sixteen, and reporting it as "the next eight" would tell somebody
                    looking at March that February is empty. */}
                {weekFrom === 0
                  ? `Nothing is free in the next ${searchedWeeks} weeks.`
                  : `Nothing is free in weeks ${weekFrom + 1} to ${weekFrom + searchedWeeks} from now.`}
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
          {/* ── s6: THE DATE IS CHOSEN, THEN THE TIME ────────────────────────────────────────────────
              ⚠ THIS USED TO PRINT EVERY DAY IN THE WINDOW ONE UNDER ANOTHER, and "choosing a date"
              meant scrolling to it. A person booking an appointment picks a day first and a time
              second; the screen now asks in that order.

              ⚠ ONLY DAYS THAT HAVE SOMETHING FREE ARE OFFERED. A calendar greying out three weeks of
              unavailable dates makes a patient hunt for the ones that work. This lists exactly the days
              they can actually be seen, so every chip on the row is a real choice. */}
          {!busy && slots !== null && slots.length > 0 && (
            <div className="mt-3">
              <h2 className="text-[11.5px] font-bold text-gray-700">
                {slotDays.length === 1 ? "One date is available" : `${slotDays.length} dates are available`}
              </h2>
              <div role="radiogroup" aria-label="Available dates"
                className="mt-1.5 flex gap-1.5 overflow-x-auto pb-1">
                {slotDays.map(day => {
                  const on = day.key === activeDay;
                  const { weekday, day: dayLabel } = chipLabel(day.key, day.slots[0].startsAt);
                  return (
                    <button key={day.key} type="button" role="radio" aria-checked={on}
                      onClick={() => { setSelectedDay(day.key); setChosen(null); }}
                      className={`shrink-0 rounded-lg border px-3 py-2 text-center ${
                        on
                          ? "border-[var(--cp-primary)] bg-[var(--cp-primary)] text-white"
                          : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50"}`}>
                      <span className="block text-[10.5px] uppercase tracking-wide opacity-80">{weekday}</span>
                      <span className="block text-[12.5px] font-bold">{dayLabel}</span>
                      {/* The count is why this beats a calendar: a patient can see where the choice is. */}
                      <span className={`block text-[10px] ${on ? "opacity-80" : "text-gray-500"}`}>
                        {day.slots.length} time{day.slots.length === 1 ? "" : "s"}
                      </span>
                    </button>
                  );
                })}
              </div>

              {activeDay && (
                <div className="mt-3">
                  <h2 className="text-[11.5px] font-bold text-gray-700">
                    {slotDays.find(d => d.key === activeDay)?.label}
                  </h2>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {activeDaySlots.map(s => {
                      const selected = chosen?.startsAt === s.startsAt;
                      return (
                        <button key={`${s.sourceSlotId}-${s.startsAt}`} type="button"
                          aria-pressed={selected}
                          onClick={() => setChosen(s)}
                          className={`rounded-lg px-3 py-2 text-[12.5px] font-semibold ${
                            selected
                              ? "bg-[var(--cp-primary)] text-white ring-1 ring-[var(--cp-primary)]"
                              : "bg-gray-100 text-gray-700 hover:bg-gray-200"}`}>
                          {/* Selection carries a mark as well as a fill, so it does not rest on colour. */}
                          {selected && <span aria-hidden className="mr-1">✓</span>}
                          {timeOf(s.startsAt)}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {chosen && (
            <p className="mt-3 rounded-lg bg-[var(--cp-primary)]/8 px-3 py-2 text-[12px] font-semibold text-[var(--cp-primary-deep)]">
              Selected: {fmt(chosen.startsAt)}
            </p>
          )}

          {problem && <Problem text={problem} />}

          <div className="mt-4 flex gap-2">
            <button type="button" className={SECONDARY} onClick={() => setStep(1)}>← Back</button>
            <button type="button" className={PRIMARY} disabled={busy || !chosen}
              onClick={async () => { if (chosen && await loadQuestions(chosen)) setStep(3); }}>
              Continue with this time →
            </button>
          </div>
        </section>
      )}

      {step === 3 && (
        <div className="flex flex-col gap-4">
          <div>
            <h1 className="text-[15px] font-bold text-gray-900">Your details</h1>
            <p className="mt-0.5 text-[11.5px] text-gray-500">
              {questions === null
                ? "Preparing the form…"
                : "Tell us about yourself so we can arrange your appointment."}
            </p>
          </div>

          {/* s8: the sections, the conditional reveals and the patient-facing copy. Which questions
              exist, and which are required, is still the server's answer. */}
          <DetailsStep
            applicable={applicable as any}
            values={values}
            edit={edit}
            isChild={isChild}
            consent={consent}
            setConsent={setConsent}
            consentRequired={consentRequired}
            consentText={consentText}
            privacyNotice={props.privacyNotice}
            safetyNote={props.safetyNote}
          />

          {clearedNote && (
            <p className="rounded-lg border border-amber-200 bg-amber-50/70 px-3 py-2 text-[11.5px] leading-relaxed text-amber-900">
              {clearedNote}
            </p>
          )}

          {/* ⚠ WHAT IS STILL MISSING IS NAMED BEFORE THE BUTTON IS PRESSED (s14), not after the server
              refuses -- and in the patient's words for the field, not the practitioner's. */}
          {missing.length > 0 && (
            <p className="text-[11.5px] text-gray-600">Still needed: {missing.join(", ")}.</p>
          )}
          {badAnswers.length > 0 && (
            <p className="text-[11.5px] text-rose-700">{badAnswers.join(" ")}</p>
          )}
          {!contact && (
            <p className="text-[11.5px] text-gray-600">
              Add a mobile number or an email address &mdash; the practice has no other way to reach you.
            </p>
          )}

          {problem && <Problem text={problem} />}

          <div className="flex gap-2">
            <button type="button" className={SECONDARY} onClick={() => setStep(2)}>← Back</button>
            <button type="button" className={PRIMARY}
              disabled={busy || missing.length > 0 || badAnswers.length > 0 || !contact || (consentRequired && !consent)}
              onClick={() => {
                setDestination(String(values.contact_phone ?? "").trim() || String(values.contact_email ?? "").trim());
                setChannel(String(values.contact_phone ?? "").trim() ? "sms" : "email");
                setStep(4);
              }}>
              Continue to review →
            </button>
          </div>
        </div>
      )}

      {step === 4 && (
        <section className="rounded-xl border border-gray-200 bg-white p-4">
          {props.canBook ? (
            <>
              {!challengeId ? (
                <>
                  {/* ══ THE REVIEW (s11/AC-15) ══════════════════════════════════════════════════════
                      ⚠ STEP 4 IS THE PATIENT'S LAST DECISION POINT, NOT AN OTP SCREEN WITH A HEADING.
                      Before this, the only place their answers appeared was the form they typed them
                      into, so the first time anybody saw the booking as a whole was after it existed. */}
                  <h1 className="text-[15px] font-bold text-gray-900">Review your appointment</h1>
                  <p className="mt-1 text-[12px] leading-relaxed text-gray-600">
                    Please check your details before we send a verification code to your email.
                  </p>

                  <dl className="mt-3 grid gap-3 sm:grid-cols-2">
                    {[
                      { k: "Practitioner", v: `${props.identity.displayName}${props.identity.credentials ? `, ${props.identity.credentials}` : ""}`, step: null },
                      { k: "Appointment", v: appointmentTypeLabel(appointmentType), step: 1 as const },
                      { k: "Where", v: [summaryFacts.locationName, summaryFacts.mode].filter(Boolean).join(" · "), step: 1 as const },
                      { k: "When", v: chosen ? `${fmt(chosen.startsAt)} (${timezoneLabel})` : "", step: 2 as const },
                      { k: "Patient", v: `${String(values.given_name ?? "")} ${String(values.family_name ?? "")}`.trim(), step: 3 as const },
                      { k: "Contact", v: [maskEmail(String(values.contact_email ?? "")), maskPhone(String(values.contact_phone ?? ""))].filter(Boolean).join(" · "), step: 3 as const },
                    ].filter(r => r.v).map(r => (
                      <div key={r.k}>
                        <dt className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">{r.k}</dt>
                        <dd className="flex items-baseline justify-between gap-2">
                          <span className="text-[12.5px] font-semibold text-gray-800">{r.v}</span>
                          {r.step !== null && (
                            <button type="button" onClick={() => setStep(r.step!)}
                              className="shrink-0 text-[10.5px] font-semibold text-[var(--cp-primary)] hover:underline">
                              Change
                            </button>
                          )}
                        </dd>
                      </div>
                    ))}
                  </dl>

                  {String(values.reason_for_visit ?? "").trim() && (
                    <div className="mt-3">
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">Reason for visit</p>
                      <p className="text-[12.5px] leading-relaxed text-gray-800">{String(values.reason_for_visit)}</p>
                    </div>
                  )}

                  {/* ⚠ THE CODE GOES WHERE THE PATIENT SAID, AND THE BOOKING MUST CLAIM THE SAME ADDRESS.
                      The session proves control of the destination the code reached, so a booking naming
                      a different one is refused by the server -- said here rather than as a 403 later. */}
                  <details className="mt-3">
                    <summary className="cursor-pointer text-[11.5px] font-semibold text-[var(--cp-primary)]">
                      Send the code somewhere else
                    </summary>
                    <div className="mt-2 grid gap-3 sm:grid-cols-2">
                      <label className="flex flex-col text-[11px] font-semibold text-gray-700">
                        Send it by
                        <select value={channel} onChange={e => setChannel(e.target.value as "sms" | "email")} className={`mt-0.5 ${CONTROL}`}>
                          <option value="email">Email</option>
                          <option value="sms">Text message</option>
                        </select>
                      </label>
                      <label className="flex flex-col text-[11px] font-semibold text-gray-700">
                        To
                        <input value={destination} onChange={e => setDestination(e.target.value)} className={`mt-0.5 ${CONTROL}`} />
                      </label>
                    </div>
                    <p className="mt-1.5 text-[11px] leading-relaxed text-gray-500">
                      This must be one of the contact details you gave &mdash; the code proves that one is
                      yours, and a booking made with a different one is refused.
                    </p>
                  </details>

                  <div className="mt-4">
                    <button type="button" className={PRIMARY} disabled={busy || !destination.trim()}
                      onClick={async () => {
                        const r = await call({ action: "request_code", channel, destination });
                        if (r?.challengeId) setChallengeId(String(r.challengeId));
                      }}>
                      {busy ? "Sending…" : channel === "email" ? "Confirm and verify email →" : "Confirm and send me a code →"}
                    </button>
                  </div>
                </>
              ) : (
                <>
                  {/* ══ THE CODE (s12) ══════════════════════════════════════════════════════════════ */}
                  <h1 className="text-[15px] font-bold text-gray-900">
                    {channel === "email" ? "Check your email" : "Check your phone"}
                  </h1>
                  <p className="mt-1 text-[12px] leading-relaxed text-gray-600">
                    We sent a 6-digit code to{" "}
                    <span className="font-semibold text-gray-800">
                      {channel === "email" ? maskEmail(destination) : maskPhone(destination)}
                    </span>.
                  </p>

                  <label className="mt-3 flex flex-col text-[11px] font-semibold text-gray-700">
                    Enter the code
                    {/* inputMode + autocomplete let a phone offer the code from the message itself. */}
                    <input value={code} onChange={e => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                      inputMode="numeric" autoComplete="one-time-code" maxLength={6}
                      aria-label="Six-digit verification code"
                      className={`mt-0.5 max-w-[220px] tracking-[0.4em] ${CONTROL}`} />
                  </label>

                  <div className="mt-2 flex flex-wrap items-center gap-3 text-[11.5px]">
                    <button type="button" disabled={busy}
                      onClick={async () => {
                        const r = await call({ action: "request_code", channel, destination, resend: true });
                        if (r?.challengeId) { setChallengeId(String(r.challengeId)); setCode(""); }
                      }}
                      className="font-semibold text-[var(--cp-primary)] hover:underline disabled:opacity-50">
                      Resend code
                    </button>
                    {/* ⚠ CHANGING THE ADDRESS DISCARDS THE VERIFICATION (s12). The old challenge proved
                        control of a different destination, and carrying it forward would let somebody
                        verify one address and book against another. */}
                    <button type="button" disabled={busy}
                      onClick={() => { setChallengeId(null); setCode(""); setToken(null); }}
                      className="font-semibold text-[var(--cp-primary)] hover:underline disabled:opacity-50">
                      {channel === "email" ? "Change email" : "Change number"}
                    </button>
                  </div>

                  <p className="mt-2 rounded-lg border border-gray-200 bg-gray-50/70 px-3 py-2 text-[11px] leading-relaxed text-gray-600">
                    Not arrived? Check your spam folder. The code expires a few minutes after it is sent.
                  </p>

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
                          elapsedSeconds: Math.round((Date.now() - startedAt) / 1000),
                        });
                        if (r) { setDone(r); setDoneKind("booked"); }
                      }}>
                      {busy ? "Checking…" : "Verify & book appointment"}
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
            <button type="button" className={SECONDARY} onClick={() => setStep(3)}>← Back</button>
          </div>
        </section>
      )}
        </div>
      </div>
    </div>
  );
}

/**
 * s11/s12: contact details are SUMMARISED, not reprinted.
 *
 * ⚠ ENOUGH TO RECOGNISE, NOT ENOUGH TO READ OVER A SHOULDER. A review screen and an OTP screen are both
 * places a patient may be standing in a waiting room, and the address is already known to whoever typed
 * it -- so the mask confirms which one was used without publishing it to the room.
 */
export function maskEmail(value: string): string {
  const v = value.trim();
  if (!v || !v.includes("@")) return "";
  const [name, domain] = v.split("@");
  const head = name.slice(0, 1);
  return `${head}${"•".repeat(Math.max(3, Math.min(6, name.length - 1)))}@${domain}`;
}

export function maskPhone(value: string): string {
  const v = value.trim();
  if (!v) return "";
  const digits = v.replace(/\D/g, "");
  if (digits.length < 4) return v;
  return `${"•".repeat(Math.max(3, digits.length - 3))}${digits.slice(-3)}`;
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
function Confirmation({ kind, data, fmt, handle, practitioner, location }: {
  kind: "booked" | "requested"; data: any; fmt: (iso: string) => string; handle: string;
  practitioner: string;
  location: { name: string; address: string | null; mapUrl: string | null } | null;
}) {
  const booked = kind === "booked";

  // ⚠ THE CALENDAR FILE IS BUILT HERE, FROM WHAT THIS SCREEN ALREADY HOLDS (s13). A route that served
  // it would be a new public endpoint returning a named patient's appointment, addressable by whatever
  // it took as a parameter -- an enumeration surface this product went to some trouble not to have.
  //
  // ⚠ AND ONLY FOR A BOOKING. A request holds no time and makes no appointment, so there is nothing to
  // put in a calendar; offering one would be the same lie as calling a request a booking.
  const addToCalendar = () => {
    const ics = buildIcs({
      reference: String(data.reference),
      practitioner,
      startsAt: String(data.scheduledAt),
      minutes: Number(data.durationMinutes ?? data.minutes ?? 30),
      locationName: location?.name ?? data.locationName ?? null,
      address: location?.address ?? null,
    }, new Date().toISOString());
    const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `appointment-${String(data.reference)}.ics`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Revoked on the next tick: released immediately, some browsers cancel the download.
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  };

  const directions = location ? directionsUrl(location) : null;

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

      {/* ── s13: WHAT TO DO NEXT ────────────────────────────────────────────────────────────────
          Each of these appears only where it can actually do something. "View or change" arrived with
          the manage screen; before that it was deliberately absent, because s13 says in as many words
          not to promise functionality that is not live. */}
      {booked && (
        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" onClick={addToCalendar}
            className="rounded-lg border border-emerald-300 bg-white px-3.5 py-2 text-[12.5px] font-semibold text-emerald-900 hover:bg-emerald-50">
            Add to calendar
          </button>
          <a href={`/practice/book/@${handle}/manage`}
            className="rounded-lg border border-gray-300 bg-white px-3.5 py-2 text-[12.5px] font-semibold text-gray-800 hover:bg-gray-50">
            View or change this booking
          </a>
          {directions && (
            // ⚠ noreferrer AS WELL AS noopener. The destination is a link the practice configured, and a
            // patient's booking confirmation is not a page whose URL should travel to it.
            <a href={directions} target="_blank" rel="noopener noreferrer"
              className="rounded-lg border border-gray-300 bg-white px-3.5 py-2 text-[12.5px] font-semibold text-gray-800 hover:bg-gray-50">
              Get directions ↗
            </a>
          )}
        </div>
      )}

      {/* The address as text, so somebody without a maps app still knows where to go. */}
      {booked && location?.address && (
        <p className="mt-2 text-[11.5px] leading-relaxed text-gray-600">{location.address}</p>
      )}

      <p className="mt-4 text-[11px] text-gray-500">
        <a href={`/practice/book/@${handle}`} className="hover:underline">Back to this practice&rsquo;s page</a>
      </p>
    </section>
  );
}
