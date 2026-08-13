"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  SESSION_ACTIVITY_TYPES, SESSION_ACTIVITY_LABEL, BOOKING_MODES, BOOKING_MODES_LIVE,
  SESSION_APPOINTMENT_TYPES, WEEKDAY_SHORT, ACTIVITY_HUE, ACTIVITY_HUE_UNSET,
  bookingModeLabel, appointmentTypeLabel,
} from "@/lib/practice/practice-session-constants";
// CPR-RECUR-001 (migration 274). ⚠ THE SAME ARITHMETIC THE GENERATOR USES, from the file that touches no
// database. The dates this form promises and the dates the diary holds have to be worked out by one
// function, or the screen and the slots will disagree about somebody's month.
import {
  RECURRENCE_INTERVALS, nextOccurrences, nextWeekdayOnOrAfter, alignAnchorToWeekday,
  describeRecurrence, isDateIso, shortDate, addDaysIso,
} from "@/lib/practice/recurrence";
import { retimingClause } from "@/lib/practice/generation-report-text";

/* eslint-disable @typescript-eslint/no-explicit-any */

// ────────────────────────────────────────────────────────────────────────────────────────────────────
// CPR-V5-007 s4 -- LAYER 1's CENTRE WORKSPACE. The weekly board, and the session editor behind it.
//
// s4.3's field list, all of it, in one form: name, day, start and end, location, activity type,
// recurrence dates, appointment types offered, booking mode, capacity, walk-ins and an operational note.
//
// ---- FOUR THINGS THIS FORM WILL NOT DO -------------------------------------------------------------
//
//   1. IT WILL NOT WRITE THE SUGGESTED NAME FOR YOU. s4.3 says the name may be SUGGESTED from location +
//      activity + day; the suggestion is offered as placeholder text and as a one-click fill. A
//      suggestion silently saved becomes a name nobody chose, and the next person cannot tell it from
//      one somebody typed.
//   2. ⚠ THIS ENTRY SAID "Public" AND "Link only" WERE NOT OFFERED BECAUSE PHASE 4 WAS NOT STARTED, AND
//      IT OUTLIVED ITS REASON. Phase 4 shipped: practice-sessions.ts removed its own PHASE_NOT_BUILT
//      gate and records why, the handle is claimed in Practice Setup, migration 254 landed the stores,
//      and patient-booking.ts carries the intake and the confirmation. This form went on greying both
//      modes out and captioning them "Phase 4 -- not built", because it decided liveness from
//      BOOKING_MODES_LIVE, which means something else entirely and says so in its own comment.
//      All four modes are now selectable. What replaces the greying is a SENTENCE: a session opened to
//      patients reaches nobody until the booking page is published. That is a fact about the practice
//      rather than about the mode, and stating it is more use than a disabled radio giving no reason.
//   3. IT WILL NOT DELETE A SESSION SOMEBODY IS BOOKED INTO (s4.4). It asks the server how many first,
//      says the number in the confirmation, and the server refuses independently -- a client-side check
//      alone is a suggestion.
//   4. IT WILL NOT PRESENT DELETING AS THE NORMAL WAY TO STOP A SESSION (s4.1). An end DATE is the
//      primary action and deletion is the quiet one, because ending keeps every past occurrence and
//      deleting erases them.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

const toMinutes = (v: string) => {
  const [h, m] = v.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
};
const toTime = (m: number) =>
  `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

type Draft = {
  templateId: string | null;
  weekday: number;
  from: string;
  to: string;
  locationId: string;
  clinicId: string;
  sessionName: string;
  activityType: string;
  bookingMode: string;
  appointmentTypes: string[];
  capacityManual: string;
  appointmentMinutes: string;
  walkInsAllowed: boolean;
  walkInLimit: string;
  effectiveFrom: string;
  effectiveTo: string;
  sessionNote: string;
  status: "active" | "suspended";
  /** CPR-RECUR-001: repeat every N weeks. 1 is the weekly session this form has always made. */
  recurrenceWeeks: number;
  /** The first occurrence. Always on `weekday` -- the control offers no other kind of date. */
  recurrenceAnchorDate: string;
  /** Set only when this draft began as a copy. Display only -- never sent to the server. */
  copiedFrom?: string;
};

const blankDraft = (weekday: number, locationId: string): Draft => ({
  templateId: null, weekday, from: "09:00", to: "13:00",
  locationId, clinicId: "", sessionName: "", activityType: "",
  // ⚠ 'none', ALWAYS. Never default a session to bookable.
  bookingMode: "none", appointmentTypes: [],
  capacityManual: "", appointmentMinutes: "", walkInsAllowed: false, walkInLimit: "",
  effectiveFrom: "", effectiveTo: "", sessionNote: "", status: "active",
  // ⚠ WEEKLY, ALWAYS, AND WITH NO ANCHOR. A new session repeats every week unless somebody says
  // otherwise, which is what every session in this product has done since it was written.
  recurrenceWeeks: 1, recurrenceAnchorDate: "",
});

const draftFrom = (s: any): Draft => ({
  templateId: s.id,
  weekday: s.weekday,
  from: toTime(s.startsMinute), to: toTime(s.endsMinute),
  locationId: s.locationId ?? "", clinicId: s.clinicId ?? "",
  sessionName: s.sessionName ?? "", activityType: s.activityType ?? "",
  bookingMode: s.bookingMode ?? "none",
  appointmentTypes: [...(s.appointmentTypes ?? [])],
  capacityManual: s.capacity?.manual != null ? String(s.capacity.manual) : "",
  appointmentMinutes: s.capacity?.appointmentMinutesSource === "session" && s.capacity.appointmentMinutes != null
    ? String(s.capacity.appointmentMinutes) : "",
  walkInsAllowed: s.walkInsAllowed === true,
  walkInLimit: s.walkInLimit != null ? String(s.walkInLimit) : "",
  effectiveFrom: s.effectiveFrom ?? "", effectiveTo: s.effectiveTo ?? "",
  sessionNote: s.sessionNote ?? "",
  status: s.status === "suspended" ? "suspended" : "active",
  recurrenceWeeks: Number(s.recurrenceWeeks ?? 1) || 1,
  recurrenceAnchorDate: s.recurrenceAnchorDate ?? "",
});

/**
 * A session copied from another one: every operational field, and deliberately not two of them.
 *
 * ⚠ THE NAME IS DROPPED, AND THAT IS THE POINT OF WRITING THIS AS A FUNCTION RATHER THAN A SPREAD.
 * A session named "Nsambya Hospital Wednesday Ward Round", copied to Thursday, would carry Wednesday in
 * its name onto a Thursday card -- a label that contradicts the row it sits on, and the kind of small
 * false statement nobody reads twice. Cleared, the suggestion regenerates from location + day + activity
 * and reads correctly for the new day. A practitioner who wants a custom name types one, as before.
 *
 * ⚠ AND templateId IS NULL, so this SAVES AS A NEW SESSION. Carrying the id would silently MOVE the
 * original instead of copying it -- the same click, the opposite outcome, and the week would look right
 * until somebody noticed Wednesday was empty.
 */
const copyOf = (s: any): Draft => ({
  ...draftFrom(s),
  templateId: null,
  sessionName: "",
  copiedFrom: `${["", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"][s.weekday]} ${toTime(s.startsMinute)}`,
});

const field = "mt-0.5 w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-[12px] text-gray-800";
const labelCls = "flex flex-col text-[10px] font-semibold uppercase tracking-wide text-gray-500";

export default function SessionWorkspace({
  sessions, locations, clinics, today, defaultMinutes, mayEdit, recurrenceAvailable = false,
}: {
  sessions: any[]; locations: any[]; clinics: any[];
  today: string; defaultMinutes: number | null; mayEdit: boolean;
  /**
   * ⚠ WHETHER THIS DATABASE CAN STORE A PATTERN OTHER THAN WEEKLY. Migration 274 is applied by hand, and
   * a control offered against a database that cannot hold the answer would take the choice, fail on
   * save, and leave a practitioner believing their Saturdays were now alternate. Where it is false the
   * screen says what is true instead of drawing a dead switch.
   */
  recurrenceAvailable?: boolean;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  // ⚠ THE PAGE HAS TO GO WHERE THE ACTION WENT. Found by the practice owner walking the product: they
  // pressed "+ Add session", the form rendered BELOW the week grid and off the bottom of the window, the
  // page did not move, and the only thing visible was the panel's top edge. Their words were "i dont see
  // create" -- the Create button was three hundred lines further down a page that had not scrolled.
  //
  // The notice had the same fault in reverse: it renders near the TOP of this component and the submit
  // button is far below it, so the server's refusal -- which this file goes to some trouble to quote
  // exactly -- appeared where nobody was looking. A refusal you cannot see is the same as no refusal.
  //
  // Both are one bug: a control that changes the page somewhere else must take the eye with it.
  const draftRef = useRef<HTMLFormElement | null>(null);
  const noticeRef = useRef<HTMLParagraphElement | null>(null);

  // Honours prefers-reduced-motion rather than smooth-scrolling everybody: for a reader who has asked
  // for less movement, a page that slides is worse than one that jumps.
  const bring = (el: HTMLElement | null) => {
    if (!el) return;
    const reduce = typeof window !== "undefined"
      && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "center" });
  };

  // Keyed on the draft's IDENTITY, not on its contents: `draft` is replaced on every keystroke, and
  // scrolling on each one would fight the practitioner for control of the page while they typed.
  const draftKey = draft ? (draft.templateId ?? `new:${draft.weekday}`) : null;
  useEffect(() => { if (draftKey) bring(draftRef.current); }, [draftKey]);
  useEffect(() => { if (notice) bring(noticeRef.current); }, [notice]);

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) =>
    setDraft(d => (d ? { ...d, [k]: v } : d));

  // ── CPR-RECUR-001 ────────────────────────────────────────────────────────────────────────────────
  //
  // ⚠ CHANGING THE DAY MOVES THE ANCHOR ONTO THAT DAY AND LEAVES IT IN THE SAME WEEK. Without this, a
  // practitioner moving an alternate-Saturday clinic to a Sunday would be sending a Saturday as the
  // first occurrence of a Sunday session -- which the engine refuses and the database's own constraint
  // refuses after it. The week is the part they chose, so the week is the part that survives.
  const setWeekday = (n: number) => setDraft(d => (d ? {
    ...d, weekday: n,
    recurrenceAnchorDate: d.recurrenceAnchorDate && isDateIso(d.recurrenceAnchorDate)
      ? alignAnchorToWeekday(d.recurrenceAnchorDate, n) : "",
  } : d));

  /**
   * ⚠ CHOOSING AN INTERVAL PROPOSES A FIRST DATE AND SHOWS IT. The engine refuses an interval with no
   * first date rather than picking a fortnight on somebody's behalf -- correct there, because a server
   * cannot show its working. Here it can: the proposal appears in a control the practitioner can change
   * and in a list of the dates it produces, so nothing is decided out of sight.
   */
  const setInterval = (n: number) => setDraft(d => (d ? {
    ...d, recurrenceWeeks: n,
    recurrenceAnchorDate: n > 1 && !d.recurrenceAnchorDate
      ? nextWeekdayOnOrAfter(d.effectiveFrom && isDateIso(d.effectiveFrom) ? d.effectiveFrom : today, d.weekday)
      : d.recurrenceAnchorDate,
  } : d));

  /** Where the pattern starts being drawn from: its own start date if that is still ahead, else today. */
  const previewFrom = draft
    ? (draft.effectiveFrom && isDateIso(draft.effectiveFrom) && draft.effectiveFrom > today
      ? draft.effectiveFrom : today)
    : today;

  /**
   * ⚠ REAL DATES, NOT A FREE-TEXT DATE FIELD. A date input cannot be told "Saturdays only", so it would
   * happily take a Tuesday as the first occurrence of a Saturday clinic and hand the practitioner a
   * refusal for something they could not have known. Every option here is an occurrence of the chosen
   * day, so a mismatch is not reachable through this screen.
   */
  const anchorChoices = draft ? (() => {
    const first = nextWeekdayOnOrAfter(previewFrom, draft.weekday);
    const list = Array.from({ length: 10 }, (_, i) => addDaysIso(first, i * 7));
    // A session already running keeps its own anchor on the list even when it is in the past -- dropping
    // it would silently re-phase the pattern the moment somebody opened the form to change the room.
    if (draft.recurrenceAnchorDate && !list.includes(draft.recurrenceAnchorDate))
      list.unshift(draft.recurrenceAnchorDate);
    return list;
  })() : [];

  /** What the practitioner is actually choosing, worked out by the generator's own function. */
  const falls = draft
    ? nextOccurrences(previewFrom, draft.weekday, {
      everyWeeks: draft.recurrenceWeeks,
      anchorDate: draft.recurrenceAnchorDate || null,
    }, 5)
    : [];

  async function send(payload: Record<string, unknown>, describe: (d: any) => string) {
    setBusy(true); setNotice(null);
    const res = await fetch("/api/v1/practice/sessions", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      // THE SERVER'S OWN WORDS. A generic "that did not work" would hide "four patients are booked into
      // this session, the first on Tuesday" -- which is the whole content of the refusal.
      setNotice({ kind: "err", text: data?.error?.message ?? "That did not work." });
      return false;
    }
    setNotice({ kind: "ok", text: describe(data) });
    router.refresh();
    return true;
  }

  function save(e: React.FormEvent) {
    e.preventDefault();
    if (!draft) return;
    void send({
      action: "save_session",
      templateId: draft.templateId,
      weekday: draft.weekday,
      startsMinute: toMinutes(draft.from), endsMinute: toMinutes(draft.to),
      locationId: draft.locationId || null,
      clinicId: draft.clinicId || null,
      sessionName: draft.sessionName.trim() || null,
      activityType: draft.activityType || null,
      bookingMode: draft.bookingMode,
      appointmentTypes: draft.appointmentTypes,
      capacityManual: draft.capacityManual === "" ? null : Number(draft.capacityManual),
      appointmentMinutes: draft.appointmentMinutes === "" ? null : Number(draft.appointmentMinutes),
      walkInsAllowed: draft.walkInsAllowed,
      walkInLimit: draft.walkInsAllowed && draft.walkInLimit !== "" ? Number(draft.walkInLimit) : null,
      effectiveFrom: draft.effectiveFrom || null,
      effectiveTo: draft.effectiveTo || null,
      sessionNote: draft.sessionNote.trim() || null,
      status: draft.status,
      recurrenceWeeks: draft.recurrenceWeeks,
      // Null at weekly, because a weekly session has no on-week and off-week to tell apart.
      recurrenceAnchorDate: draft.recurrenceWeeks > 1 ? (draft.recurrenceAnchorDate || null) : null,
      todayDate: today,
    }, d => {
      const created = d.session?.created;
      const slots = d.generation?.slotsCreated ?? 0;
      // ⚠ THE SKIPPED WEEKS ARE NAMED. "3 bookable slots rebuilt" on a Saturday clinic reads like
      // something went wrong until you know the other Saturdays were deliberately left out.
      //
      // ⚠ AND IT IS NOT SAID TO BE THIS SESSION'S. The generator counts every off-week it skipped across
      // the whole regular week, so attributing the number to the session just saved would be a claim the
      // figure does not support.
      const skipped = d.generation?.occurrencesSkippedForInterval ?? 0;
      return `${created ? "Session created" : "Session saved"}.`
        + (slots ? ` ${slots} bookable slot${slots === 1 ? "" : "s"} rebuilt.` : "")
        + (skipped ? ` ${skipped} off-week day${skipped === 1 ? "" : "s"} left out, because not every session repeats weekly.` : "")
        // ⚠ CHANGING THE HOURS IS WHAT STRANDS A WINDOW, and this is the screen that changes them.
        // Saying it only on the Availability console would tell the right thing to somebody who did
        // not make the edit, at a moment they were not looking for it.
        + retimingClause(d.generation);
    }).then(ok => { if (ok) setDraft(null); });
  }

  /**
   * s4.4 -- ASK HOW MANY BEFORE ASKING WHETHER.
   *
   * The count comes from the server, is put into the confirmation, and the server refuses again on the
   * delete itself. A confirmation dialog that says "are you sure?" without a number is asking somebody
   * to guess what it will cost.
   */
  async function remove(session: any) {
    setBusy(true); setNotice(null);
    const res = await fetch("/api/v1/practice/sessions", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "future_bookings", templateId: session.id }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setNotice({ kind: "err", text: data?.error?.message ?? "The bookings could not be counted, so nothing was deleted." });
      return;
    }
    const n = data?.futureBookings?.count ?? 0;
    const name = session.sessionName || session.suggestedName;
    if (n > 0) {
      setNotice({
        kind: "err",
        text: `${n} patient${n === 1 ? " is" : "s are"} booked into "${name}". Move or cancel ${n === 1 ? "that appointment" : "those appointments"} in the calendar first, or set an end date instead so past occurrences are kept.`,
      });
      return;
    }
    if (!window.confirm(`Delete "${name}" permanently? Nobody is booked into it. Every past occurrence of this session goes too — an end date keeps them.`)) return;
    void send({ action: "delete_session", templateId: session.id }, () => "Session deleted.")
      .then(ok => { if (ok) setDraft(null); });
  }

  const suggestion = draft
    ? [
      locations.find(l => l.id === draft.locationId)?.name ?? null,
      ["", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"][draft.weekday],
      draft.activityType ? SESSION_ACTIVITY_LABEL[draft.activityType as never] : null,
    ].filter(Boolean).join(" ")
    : "";

  // The live derivation, shown as the form is typed so s7.4's "stricter wins" is visible rather than
  // discovered later.
  const derived = (() => {
    if (!draft) return null;
    const minutes = draft.appointmentMinutes !== "" ? Number(draft.appointmentMinutes) : defaultMinutes;
    const span = toMinutes(draft.to) - toMinutes(draft.from);
    if (!minutes || minutes <= 0 || span <= 0) return null;
    return { count: Math.floor(span / minutes), minutes, fromDefault: draft.appointmentMinutes === "" };
  })();
  const manualNum = draft && draft.capacityManual !== "" ? Number(draft.capacityManual) : null;

  return (
    <div className="flex flex-col gap-4">

      {notice && (
        <p ref={noticeRef} role="status" className={`rounded-lg px-3.5 py-2.5 text-[12px] leading-relaxed ${
          notice.kind === "ok" ? "bg-emerald-50 text-emerald-900" : "bg-rose-50 text-rose-900"}`}>
          {notice.text}
        </p>
      )}

      {/* ── THE REGULAR WEEK AT A GLANCE ─────────────────────────────────────────────────────────── */}
      <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span aria-hidden className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-100 text-[14px] text-emerald-700">▦</span>
          <div className="min-w-0">
            <h2 className="text-[14px] font-bold text-gray-900">Your regular week at a glance</h2>
            {/* ⚠ THIS SENTENCE USED TO END AT "a day and a time", WHICH IS NO LONGER THE WHOLE OF IT. A
                session now also carries how often it repeats, and a subtitle that says otherwise on the
                very screen where the interval is chosen would contradict the control beneath it. */}
            <p className="text-[11px] text-gray-500">
              A session is a day, a time and how often it repeats — not fifty-two copies.
            </p>
          </div>
          {mayEdit && (
            <button type="button"
              onClick={() => { setNotice(null); setDraft(blankDraft(1, locations[0]?.id ?? "")); }}
              className="ml-auto rounded-lg bg-[var(--cp-primary)] px-3.5 py-2 text-[12px] font-semibold text-white hover:bg-[var(--cp-primary-deep)]">
              + Add session
            </button>
          )}
        </div>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
          {[1, 2, 3, 4, 5, 6, 7].map(n => {
            const onDay = sessions.filter(s => s.weekday === n)
              .sort((a, b) => a.startsMinute - b.startsMinute);
            return (
              <div key={n} className={`min-h-[180px] rounded-xl border p-2 ${
                onDay.length === 0 ? "border-dashed border-gray-200 bg-[var(--cp-canvas)]" : "border-gray-200 bg-white"}`}>
                <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-gray-500">{WEEKDAY_SHORT[n]}</p>
                {onDay.length === 0 ? (
                  <div className="flex h-[120px] flex-col items-center justify-center gap-1 text-gray-400">
                    <span aria-hidden className="text-[18px] opacity-60">☕</span>
                    <span className="text-[10px] font-semibold">Day off</span>
                  </div>
                ) : (
                  <ul className="space-y-1.5">
                    {onDay.map(s => {
                      const hue = s.activityType ? ACTIVITY_HUE[s.activityType] ?? ACTIVITY_HUE_UNSET : ACTIVITY_HUE_UNSET;
                      const dim = s.status === "suspended" || s.effectiveState !== "current";
                      return (
                        <li key={s.id}>
                          <button type="button" disabled={!mayEdit}
                            onClick={() => { setNotice(null); setDraft(draftFrom(s)); }}
                            className="w-full rounded-lg border border-l-[3px] px-2 py-1.5 text-left transition hover:shadow-sm disabled:cursor-default"
                            style={{
                              background: dim ? "var(--cp-slate-50)" : `color-mix(in srgb, ${hue} 7%, white)`,
                              borderColor: `color-mix(in srgb, ${hue} 22%, white)`,
                              borderLeftColor: dim ? "var(--cp-slate-300)" : hue,
                            }}>
                            <p className="truncate text-[11px] font-bold text-gray-900">
                              {s.sessionName ?? s.suggestedName}
                            </p>
                            <p className="text-[10px] text-gray-600">
                              {toTime(s.startsMinute)} – {toTime(s.endsMinute)}
                            </p>
                            {/* ⚠ THE GRID MUST NOT CLAIM A FORTNIGHTLY CLINIC IS WEEKLY. Its whole
                                subject is when this practitioner is available, and a card that reads the
                                same for both patterns is the lie the workaround produced -- a weekly
                                Saturday corrected one closure at a time. The next date is named because
                                "alternate weeks" alone still leaves WHICH weeks unanswered. */}
                            {s.recurrenceBadge && (
                              <p className="text-[9.5px] font-semibold text-violet-700">
                                {s.recurrenceBadge}
                                {s.nextOccurrences?.[0] ? ` · next ${shortDate(s.nextOccurrences[0])}` : ""}
                              </p>
                            )}
                            <p className="truncate text-[9.5px]" style={{ color: dim ? "var(--cp-slate-500)" : hue }}>
                              {s.activityType ? SESSION_ACTIVITY_LABEL[s.activityType as never] : "No activity type"}
                            </p>
                            <p className="mt-0.5 flex flex-wrap items-center gap-1 text-[9px] text-gray-500">
                              <span className={`rounded px-1 py-px font-semibold ${
                                s.bookingMode === "none" ? "bg-slate-100 text-slate-500" : "bg-emerald-100 text-emerald-700"}`}>
                                {bookingModeLabel(s.bookingMode)}
                              </span>
                              {s.capacity?.effective != null && <span>{s.capacity.effective} places</span>}
                              {s.walkInsAllowed && <span>walk-ins</span>}
                            </p>
                            {s.status === "suspended" && (
                              <p className="mt-0.5 text-[9px] font-semibold text-amber-700">Suspended</p>
                            )}
                            {s.effectiveState === "ended" && (
                              <p className="mt-0.5 text-[9px] font-semibold text-slate-500">Ended {s.effectiveTo}</p>
                            )}
                            {s.effectiveState === "not_yet_started" && (
                              <p className="mt-0.5 text-[9px] font-semibold text-slate-500">From {s.effectiveFrom}</p>
                            )}
                          </button>

                          {/* ⚠ COPY OPENS A DRAFT, IT DOES NOT SAVE ONE. Asked for while walking the
                              product: "make it possible to duplicate a session and move it around, in
                              this case I would like to duplicate wednesday for thursday." A one-click
                              silent create would put a second session into a week without anybody
                              choosing its day, and on a screen whose whole subject is when a
                              practitioner is available that is the wrong way round. So it fills the form
                              and leaves the day to be chosen -- which is also why the day is now the
                              first field in it. */}
                          {mayEdit && (
                            <button type="button"
                              onClick={() => { setNotice(null); setDraft(copyOf(s)); }}
                              className="mt-0.5 w-full rounded px-1 py-px text-left text-[9px] font-semibold text-gray-400 hover:text-[var(--cp-primary)]">
                              Copy to another day
                            </button>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
                {mayEdit && (
                  <button type="button"
                    onClick={() => { setNotice(null); setDraft(blankDraft(n, locations[0]?.id ?? "")); }}
                    className="mt-1.5 w-full rounded-lg border border-dashed border-gray-200 py-1 text-[10px] text-gray-400 hover:border-[var(--cp-primary)]/40 hover:text-[var(--cp-primary)]">
                    + Add session
                  </button>
                )}
              </div>
            );
          })}
        </div>

        {/* The legend, by activity type -- which is what the colour on those cards means. */}
        <ul className="mt-3 flex flex-wrap gap-x-3 gap-y-1">
          {[...new Set(sessions.map(s => s.activityType).filter(Boolean))].map(a => (
            <li key={a as string} className="flex items-center gap-1.5 text-[10px] text-gray-600">
              <span aria-hidden className="h-2 w-2 rounded-full" style={{ background: ACTIVITY_HUE[a as string] ?? ACTIVITY_HUE_UNSET }} />
              {SESSION_ACTIVITY_LABEL[a as never]}
            </li>
          ))}
          {sessions.some(s => !s.activityType) && (
            <li className="flex items-center gap-1.5 text-[10px] text-gray-500">
              <span aria-hidden className="h-2 w-2 rounded-full" style={{ background: ACTIVITY_HUE_UNSET }} />
              No activity type — a Current Activity started from these inherits nothing
            </li>
          )}
        </ul>
      </section>

      {/* ── THE SESSION EDITOR ───────────────────────────────────────────────────────────────────── */}
      {draft && (
        <form ref={draftRef} onSubmit={save}
          className="rounded-xl border border-[var(--cp-primary)]/25 bg-white p-4 shadow-[0_2px_8px_rgba(15,23,42,0.06)]">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <span aria-hidden className="flex h-7 w-7 items-center justify-center rounded-lg bg-[var(--cp-primary)]/12 text-[14px] text-[var(--cp-primary-deep)]">✎</span>
            <h3 className="text-[14px] font-bold text-gray-900">
              {draft.templateId ? "Edit this session" : draft.copiedFrom ? "Copy of a session" : "New session"}
            </h3>
            {/* ⚠ SAYS WHERE IT CAME FROM AND WHAT IS STILL TO DECIDE. A pre-filled form that looks like a
                blank one invites somebody to press Create without noticing every field is already
                answered -- including the day, which is the one thing a copy exists to change. */}
            {draft.copiedFrom && (
              <span className="text-[10px] font-normal text-gray-500">
                Copied from {draft.copiedFrom}. Choose the day it belongs on, then create it.
              </span>
            )}
            <button type="button" onClick={() => setDraft(null)}
              className="ml-auto rounded-lg border border-gray-200 px-3 py-1.5 text-[12px] text-gray-600 hover:bg-gray-50">
              Close
            </button>
          </div>

          {/* ── Identity ─────────────────────────────────────────────────────────────────────── */}
          {/* ⚠ THE NAME USED TO BE FIRST AND HALF THE ROW, AND THAT IS WHY IT READ AS REDUNDANT.
              The practice owner, walking the product: "I think we can remove session name here, seems
              redundant" -- having typed "Nsambya Hospital" into it while LOCATION on the same row already
              said Nsambya Hospital.

              It is optional and always was: leave it blank and the week grid shows the suggested name
              instead. But every affordance saying so was suppressed at the moment it mattered. The
              suggestion appears as PLACEHOLDER text, which an existing session's stored name hides, and
              the one-click "Use ..." button only renders when the field is empty. So when EDITING -- the
              case they were in -- nothing indicated the field could be left alone, while its position
              said the opposite: first field, spanning half the row, where a form puts what it requires.

              Demoted rather than deleted. A custom name still earns its place for "Tuesday evening extra
              clinic", and four existing sessions carry real names that would be orphaned by removing the
              only control that edits them. What changed is that the facts DEFINING a session -- day,
              activity, times, location -- now come first, and the name comes after them, saying it is
              optional and saying what happens if it is left blank. */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className={labelCls}>
              Day of week
              {/* setWeekday, not set("weekday") -- the recurrence anchor has to move with the day. */}
              <select value={draft.weekday} onChange={e => setWeekday(Number(e.target.value))} className={field}>
                {[1, 2, 3, 4, 5, 6, 7].map(n => (
                  <option key={n} value={n}>
                    {["", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"][n]}
                  </option>
                ))}
              </select>
            </label>

            <label className={labelCls}>
              Activity type
              <select value={draft.activityType} onChange={e => set("activityType", e.target.value)} className={field}>
                <option value="">Not said</option>
                {SESSION_ACTIVITY_TYPES.map(a => (
                  <option key={a} value={a}>{SESSION_ACTIVITY_LABEL[a]}</option>
                ))}
              </select>
              <span className="mt-0.5 text-[9.5px] font-normal normal-case tracking-normal text-gray-400">
                A Current Activity started from this session inherits it.
              </span>
            </label>

            <label className={labelCls}>
              Starts
              <input type="time" required value={draft.from}
                onChange={e => set("from", e.target.value)} className={field} />
            </label>
            <label className={labelCls}>
              Ends
              <input type="time" required value={draft.to}
                onChange={e => set("to", e.target.value)} className={field} />
            </label>

            <label className={labelCls}>
              Location
              <select value={draft.locationId} onChange={e => set("locationId", e.target.value)} className={field}>
                <option value="">Not said</option>
                {locations.filter(l => l.active).map(l => (
                  <option key={l.id} value={l.id}>{l.name}</option>
                ))}
              </select>
            </label>
            <label className={labelCls}>
              Room or clinic
              <select value={draft.clinicId} onChange={e => set("clinicId", e.target.value)} className={field}>
                <option value="">Not said</option>
                {clinics.filter(c => !draft.locationId || c.location_id === draft.locationId)
                  .map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>

            {/* Last, and optional, and it says so both ways round: in the label, and by naming what
                happens if it is left alone. A field that only tells you it is optional when it is already
                empty tells the one person who needs to know -- somebody editing -- nothing at all. */}
            <label className={`${labelCls} sm:col-span-2`}>
              Session name <span className="font-normal normal-case tracking-normal text-gray-400">(optional)</span>
              <input type="text" value={draft.sessionName} maxLength={120}
                placeholder={suggestion || "Name this session"}
                onChange={e => set("sessionName", e.target.value)} className={field} />
              {/* SUGGESTED, NOT WRITTEN. */}
              {suggestion && draft.sessionName.trim() === "" && (
                <button type="button" onClick={() => set("sessionName", suggestion)}
                  className="mt-1 self-start text-[10px] font-semibold normal-case tracking-normal text-[var(--cp-primary)] hover:underline">
                  Use &ldquo;{suggestion}&rdquo;
                </button>
              )}
              {suggestion && (
                <span className="mt-0.5 text-[9.5px] font-normal normal-case tracking-normal text-gray-400">
                  Leave blank and this is listed as &ldquo;{suggestion}&rdquo;.
                </span>
              )}
            </label>
          </div>

          {/* ── s4.3's recurrence dates -- WHY ENDING IS A DATE ─────────────────────────────────── */}
          <fieldset className="mt-4 rounded-lg border border-gray-200 p-3">
            <legend className="px-1 text-[10px] font-bold uppercase tracking-wide text-gray-500">
              When this pattern applies
            </legend>

            {/* ── CPR-RECUR-001: HOW OFTEN, AND WHICH WEEKS ────────────────────────────────────────
                The practice owner, walking the product: "I would like to set my weekly plan as
                alternate Saturdays to be at TMR, not every Saturday. How do we do this?" -- and the
                answer was that you could not. A session was a day and a time and it ran EVERY week.

                ⚠ THE SECOND CONTROL IS THE WHOLE DESIGN. "Every other Saturday" is not a fact until you
                say WHICH Saturday, and the tempting way to avoid asking -- odd and even ISO week numbers
                -- is wrong: a 53-week year puts two odd weeks side by side and moves every session after
                it, for ever. A first date cannot drift, and it is the thing a practitioner actually has
                in mind. So the form asks for it, and then SHOWS the dates it produces, because
                "alternate Saturdays" is a phrase and "Sat 15 Aug, Sat 29 Aug, Sat 12 Sep" is a fact
                somebody can check against the calendar on their wall. */}
            <div className="mb-3 rounded-lg border border-violet-200/70 bg-violet-50/40 p-2.5">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className={labelCls}>
                  Repeats
                  <select value={draft.recurrenceWeeks} disabled={!recurrenceAvailable}
                    onChange={e => setInterval(Number(e.target.value))}
                    className={`${field} disabled:bg-slate-50 disabled:text-slate-400`}>
                    {RECURRENCE_INTERVALS.map(n => (
                      <option key={n} value={n}>
                        {n === 1 ? "Every week" : n === 2 ? "Every other week" : `Every ${n} weeks`}
                      </option>
                    ))}
                  </select>
                </label>

                {draft.recurrenceWeeks > 1 && (
                  <label className={labelCls}>
                    First one on
                    <select value={draft.recurrenceAnchorDate}
                      onChange={e => set("recurrenceAnchorDate", e.target.value)} className={field}>
                      {anchorChoices.map(d => (
                        <option key={d} value={d}>{shortDate(d)}</option>
                      ))}
                    </select>
                    <span className="mt-0.5 text-[9.5px] font-normal normal-case tracking-normal text-gray-500">
                      Every week is counted from this one, so it never shifts at new year.
                    </span>
                  </label>
                )}
              </div>

              {/* WHAT THE CHOICE ACTUALLY MEANS, in dates, worked out by the same function the generator
                  uses. A phrase a practitioner has to trust is worse than four dates they can check. */}
              <p className="mt-2 text-[10.5px] leading-relaxed text-gray-700">
                <span className="font-semibold">
                  {describeRecurrence(
                    { everyWeeks: draft.recurrenceWeeks, anchorDate: draft.recurrenceAnchorDate || null },
                    draft.weekday,
                  )}
                </span>
                {falls.length > 0
                  ? <> — falls on {falls.map(shortDate).join(", ")}…</>
                  : <> — no dates fall in the period ahead.</>}
              </p>

              {!recurrenceAvailable && (
                // ⚠ NOT "coming soon". What is TRUE is that this practice repeats every week, and the
                // control is disabled rather than absent so the sentence has something to explain.
                <p className="mt-1.5 text-[10px] leading-relaxed text-amber-700">
                  Sessions here repeat every week. Alternate-week patterns are not yet switched on for
                  this practice, so nothing else can be chosen.
                </p>
              )}

              {draft.recurrenceWeeks > 1 && draft.templateId && (
                // ⚠ SAID BEFORE THE SAVE, not discovered from a refusal afterwards. The server refuses
                // the change while anybody is booked on a week it would drop, and a practitioner who
                // reads that here can go and move the appointment first.
                <p className="mt-1.5 text-[10px] leading-relaxed text-gray-500">
                  The weeks this leaves out lose their bookable time. If a patient is already booked on
                  one, the change is refused and says who — nothing is cancelled for you.
                </p>
              )}
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <label className={labelCls}>
                From (optional)
                <input type="date" value={draft.effectiveFrom}
                  onChange={e => set("effectiveFrom", e.target.value)} className={field} />
              </label>
              <label className={labelCls}>
                Until (optional)
                <input type="date" value={draft.effectiveTo} min={draft.effectiveFrom || undefined}
                  onChange={e => set("effectiveTo", e.target.value)} className={field} />
              </label>
              <label className={labelCls}>
                Status
                <select value={draft.status}
                  onChange={e => set("status", e.target.value as "active" | "suspended")} className={field}>
                  <option value="active">Running</option>
                  <option value="suspended">Suspended — generates nothing, stays here</option>
                </select>
              </label>
              <div className="flex items-end">
                <p className="text-[10px] leading-relaxed text-gray-500">
                  An end date stops the pattern and keeps every occurrence it has already had. Deleting
                  erases them.
                </p>
              </div>
            </div>
          </fieldset>

          {/* ── s4.3 booking + s4.5 appointment types ───────────────────────────────────────────── */}
          <fieldset className="mt-3 rounded-lg border border-gray-200 p-3">
            <legend className="px-1 text-[10px] font-bold uppercase tracking-wide text-gray-500">
              Who may book into it
            </legend>
            <div className="grid gap-3 lg:grid-cols-[240px_minmax(0,1fr)]">
              <div>
                <div className="space-y-1.5">
                  {BOOKING_MODES.map(m => {
                    // ⚠ EVERY MODE IS SELECTABLE. This used to read
                    //   const live = BOOKING_MODES_LIVE.includes(m.code)
                    // and greyed out Link only and Public with "Phase 4 — not built". Phase 4 SHIPPED:
                    // practice-sessions.ts removed its own PHASE_NOT_BUILT gate and says why, and that
                    // constant does not mean what this line assumed. Its comment says so in terms — it is
                    // "the modes that need no patient-facing surface", kept deliberately unchanged so the
                    // publish check does not answer a wrong nought. Reading it as "modes we can honour"
                    // left the form refusing what the engine accepts.
                    //
                    // The dependency is real and is stated instead of enforced: a session opened to
                    // patients reaches nobody until the booking page is published. That is a fact about
                    // the practice, not about the mode, so it belongs in a sentence rather than in a
                    // disabled radio that gives no reason.
                    const needsPage = !BOOKING_MODES_LIVE.includes(m.code);
                    const live = true;
                    return (
                      <label key={m.code}
                        className={`flex items-start gap-2 rounded-lg border px-2.5 py-1.5 ${
                          live ? "border-gray-200 hover:bg-gray-50 cursor-pointer"
                            : "border-dashed border-slate-300 bg-slate-50"}`}>
                        <input type="radio" name="bookingMode" value={m.code} disabled={!live}
                          checked={draft.bookingMode === m.code}
                          onChange={() => set("bookingMode", m.code)} className="mt-0.5" />
                        <span className="min-w-0">
                          <span className={`block text-[11.5px] font-semibold ${live ? "text-gray-800" : "text-slate-500"}`}>
                            {m.label}
                          </span>
                          <span className="block text-[10px] leading-relaxed text-gray-500">{m.blurb}</span>
                          {/* NOT A CONTROL. Named with its phase, not greyed out with no reason. */}
                          {needsPage && (
                            <span className="mt-0.5 block text-[9.5px] font-semibold text-amber-600">
                              Reaches patients only once your booking page is published
                            </span>
                          )}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>

              <div>
                <p className="text-[10px] font-bold uppercase tracking-wide text-gray-500">Appointment types offered</p>
                <p className="mb-1.5 text-[10px] text-gray-500">
                  Zero means this session is not patient-bookable, whatever the mode says.
                </p>
                <ul className="flex flex-wrap gap-1.5">
                  {SESSION_APPOINTMENT_TYPES.map(([code, label]) => {
                    const on = draft.appointmentTypes.includes(code);
                    return (
                      <li key={code}>
                        <button type="button"
                          onClick={() => set("appointmentTypes", on
                            ? draft.appointmentTypes.filter(t => t !== code)
                            : [...draft.appointmentTypes, code])}
                          className={`rounded-lg border px-2.5 py-1 text-[11px] font-semibold transition ${
                            on ? "border-[var(--cp-primary)]/40 bg-[var(--cp-primary)]/10 text-[var(--cp-primary-deep)]"
                              : "border-gray-200 text-gray-600 hover:bg-gray-50"}`}>
                          {on ? "✓ " : ""}{label}
                        </button>
                      </li>
                    );
                  })}
                </ul>
                <p className="mt-1.5 text-[10px] text-gray-400">
                  {draft.appointmentTypes.length === 0
                    ? "None offered."
                    : `Offering ${draft.appointmentTypes.map(appointmentTypeLabel).join(", ")}.`}
                </p>
              </div>
            </div>
          </fieldset>

          {/* ── s7.4 capacity, with the derivation shown ────────────────────────────────────────── */}
          <fieldset className="mt-3 rounded-lg border border-gray-200 p-3">
            <legend className="px-1 text-[10px] font-bold uppercase tracking-wide text-gray-500">
              How many people fit
            </legend>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <label className={labelCls}>
                Appointment length
                <input type="number" min={5} max={480} value={draft.appointmentMinutes}
                  placeholder={defaultMinutes != null ? `${defaultMinutes} (practice default)` : "not set"}
                  onChange={e => set("appointmentMinutes", e.target.value)} className={field} />
              </label>
              <label className={labelCls}>
                Manual limit (optional)
                <input type="number" min={0} max={500} value={draft.capacityManual}
                  placeholder="derive it from the time"
                  onChange={e => set("capacityManual", e.target.value)} className={field} />
              </label>
              <div className="sm:col-span-2">
                <p className="text-[10px] font-bold uppercase tracking-wide text-gray-500">What that works out as</p>
                {derived === null && manualNum === null ? (
                  <p className="mt-0.5 text-[11px] text-amber-700">
                    No appointment length and no manual limit — this session holds an unknown number.
                  </p>
                ) : (
                  <p className="mt-0.5 text-[11px] leading-relaxed text-gray-700">
                    {derived && (
                      <>Time and length give <span className="font-bold text-cyan-700">{derived.count}</span>{" "}
                        ({derived.minutes} min each{derived.fromDefault ? ", the practice default" : ""}).{" "}</>
                    )}
                    {manualNum !== null && (
                      <>You have capped it at <span className="font-bold text-amber-700">{manualNum}</span>.{" "}</>
                    )}
                    {derived && manualNum !== null && (
                      <>The stricter applies: <span className="font-bold text-gray-900">{Math.min(derived.count, manualNum)}</span>.</>
                    )}
                  </p>
                )}
              </div>

              <label className="flex items-center gap-2 text-[11.5px] font-semibold text-gray-700">
                <input type="checkbox" checked={draft.walkInsAllowed}
                  onChange={e => set("walkInsAllowed", e.target.checked)} />
                Walk-ins allowed
              </label>
              <label className={labelCls}>
                Walk-in limit
                <input type="number" min={0} max={100} value={draft.walkInLimit} disabled={!draft.walkInsAllowed}
                  placeholder={draft.walkInsAllowed ? "no limit" : "walk-ins are off"}
                  onChange={e => set("walkInLimit", e.target.value)}
                  className={`${field} disabled:bg-slate-50 disabled:text-slate-400`} />
              </label>
              <label className={`${labelCls} sm:col-span-2`}>
                Operational note
                <input type="text" maxLength={1000} value={draft.sessionNote}
                  placeholder="How this session runs. Never clinical information."
                  onChange={e => set("sessionNote", e.target.value)} className={field} />
              </label>
            </div>
          </fieldset>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button type="submit" disabled={busy}
              className="rounded-lg bg-[var(--cp-primary)] px-4 py-2 text-[12px] font-semibold text-white hover:bg-[var(--cp-primary-deep)] disabled:opacity-50">
              {busy ? "Saving…" : draft.templateId ? "Save session" : "Create session"}
            </button>
            {draft.templateId && (
              <>
                {/* THE PRIMARY WAY TO STOP A SESSION. */}
                <button type="button" disabled={busy || !draft.effectiveTo}
                  onClick={() => void send(
                    { action: "end_session", templateId: draft.templateId, effectiveTo: draft.effectiveTo },
                    d => d.ended?.bookingsAfter > 0
                      ? `Ends ${draft.effectiveTo}. ${d.ended.bookingsAfter} booking${d.ended.bookingsAfter === 1 ? "" : "s"} fall after that date and will need attention.`
                      : `Ends ${draft.effectiveTo}. Every past occurrence is kept.`,
                  )}
                  title={draft.effectiveTo ? undefined : "Set an end date above first"}
                  className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-[12px] font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-40">
                  End on {draft.effectiveTo || "a date…"}
                </button>
                <button type="button" disabled={busy}
                  onClick={() => remove(sessions.find(s => s.id === draft.templateId))}
                  className="ml-auto rounded-lg border border-rose-300 bg-white px-3.5 py-2 text-[12px] font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-50">
                  Delete permanently
                </button>
              </>
            )}
          </div>
          <p className="mt-2 text-[10px] leading-relaxed text-gray-400">
            Today is {today}. Saving rebuilds the bookable slots for the next 90 days before it returns,
            and never removes one somebody is booked into.
          </p>
        </form>
      )}

      {!mayEdit && (
        <p className="rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-[12px] text-slate-600">
          You can see this practice&apos;s regular week and cannot change it — that needs the
          appointment.manage permission.
        </p>
      )}
    </div>
  );
}
