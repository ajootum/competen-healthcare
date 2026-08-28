"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import StartEncounterAction from "../../encounters/StartEncounterAction";
import { TimeInput } from "@/components/ui/wall-clock";

// The patient's action panel: starting a consultation, demographic edit (optimistic-concurrency
// guarded), book-for-patient (writes the registry link, so the diary carries the registry's name), and
// the privileged merge -- which asks for the OTHER record's Practice ID rather than offering a browse,
// because merging is a deliberate act performed on a known duplicate, not something to stumble into
// from a list.
//
// STARTING A CONSULTATION IS THE ONE ACT HERE THAT IS NOT THIS PANEL'S OWN. Four screens open an
// encounter for a patient they can already name, and this was one of three hand-written copies of that
// act; the copies had drifted. It is <StartEncounterAction/> over startEncounterFor() now, reporting
// into this panel's existing notice line rather than drawing a second one.

/* eslint-disable @typescript-eslint/no-explicit-any */

// max-md:min-h is CPR-MOB-001 s4's 44px floor, a no-op at md and up. The TIME field stays the
// text-pattern 24-hour idiom regardless of size -- never type="time".
// ⚠ THE VALUE COLOUR IS EXPLICIT, NOT INHERITED — 2026-08-28, found by the owner on a real phone during
// the pilot acceptance's H2 run: with no colour of its own, every control inherited a muted tone and a
// FILLED date/time/select was indistinguishable from an empty one ("data is difficult to read"). Mobile
// browsers render unstyled date and select controls dimmer still. Values are gray-900 on white;
// placeholders alone stay muted, because the distinction between typed and not-typed IS the information.
const input = "w-full rounded-lg border border-gray-200 bg-white px-2.5 py-2 text-[13px] text-gray-900 placeholder:text-gray-400 outline-none focus:border-[var(--cp-primary)] focus:ring-2 focus:ring-[var(--cp-primary)]/10 max-md:min-h-[var(--cp-touch)]";

export default function PatientActions(props: {
  patientId: string; displayName: string; sex: string; birthDate: string | null;
  ageEstimateYears: number | null; recordVersion: number;
  canEdit: boolean; canMerge: boolean; canBook: boolean; canStartEncounter: boolean;
  /**
   * CP-BOOKING-TAXONOMY-001: the practice's own configured dimensions, resolved on the SERVER and handed
   * down as plain data. The old card hard-coded four values into the markup, which is how
   * "teleconsultation" -- a MODE -- came to sit in a list of clinical purposes, and why three of the
   * engine's seven accepted types were unreachable from this screen at all.
   *
   * ⚠ readable=false MEANS THE LOOKUP FAILED, not that the practice configured nothing. The card
   * refuses to offer a booking rather than showing two empty dropdowns.
   */
  taxonomy: {
    visitTypes: { id: string; label: string }[];
    modes: { id: string; label: string }[];
    defaultVisitTypeId: string | null;
    defaultModeId: string | null;
    readable: boolean;
  };
  /**
   * Walkthrough 2026-08-17 #15: WHERE, on every booking surface. Left empty the engine still derives
   * the place from the regular week -- the zero-click ordinary case -- but an outside-hours booking
   * ("no location was assumed") no longer needs a trip to the planner to become visible under its
   * hospital.
   */
  locations: { id: string; name: string }[];
  /** The practice's today, from the workspace clock -- never UTC's, which is yesterday until 03:00. */
  todayDate: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [edit, setEdit] = useState({ displayName: props.displayName, sex: props.sex, birthDate: props.birthDate ?? "" });
  const [book, setBook] = useState({
    // ⚠ THE PRACTICE'S TODAY, handed down by the server. new Date().toISOString() is UTC's date,
    // which in Kampala is YESTERDAY until 03:00 -- the 21-hours-a-day class, in a default.
    date: props.todayDate, time: "09:00",
    // The legacy string still travels until every reader is off it -- see BookInput in scheduling.ts.
    type: "scheduled_followup",
    visitTypeId: props.taxonomy.defaultVisitTypeId ?? "",
    modeId: props.taxonomy.defaultModeId ?? "",
    locationId: "",
  });
  const [mergeTarget, setMergeTarget] = useState("");

  // ⚠ SUCCESS IS SAID, NOT IMPLIED (the owner, 2026-08-11: "give a message to let us know it has been
  // saved"). This used to window.location.reload() on success -- which wiped the "Saved." notice before
  // a human could see it, so only FAILURES ever showed a message and a successful save looked like
  // nothing happening. router.refresh() re-fetches the server-rendered record while keeping this
  // panel's state, so the confirmation and the updated page arrive together.
  async function call(fn: () => Promise<Response>, okText: string) {
    setBusy(true); setNotice(null);
    const res = await fn();
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { setNotice({ kind: "err", text: data?.error?.message ?? data?.error ?? "That did not work." }); setBusy(false); return; }
    setNotice({ kind: "ok", text: okText });
    setBusy(false);
    router.refresh();
  }

  const saveEdit = () => call(() => fetch(`/api/v1/practice/patients/${props.patientId}`, {
    method: "PATCH", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      recordVersion: props.recordVersion,
      displayName: edit.displayName, sex: edit.sex, birthDate: edit.birthDate || null,
    }),
  }), "Saved.");

  // ⚠ WALL-CLOCK SENT AS date+time, COMPOSED ON THE SERVER in the practice timezone. This used to send
  // `${date}T${time}:00.000Z` -- declaring a Kampala 09:00 to be 09:00 UTC, which the diary then
  // honestly rendered as 12:00. A client must never stamp a zone it does not know.
  // ⚠ THE OUT-OF-HOURS WARNING IS SHOWN, NOT SWALLOWED (the owner, 2026-08-12). Booking outside the
  // regular week is ALLOWED here -- a practitioner may genuinely see somebody late -- but the desk is
  // told at the moment it happens, because the booking will carry no location and will not appear in
  // any per-hospital list until one is set by hand.
  async function bookAppt() {
    setBusy(true); setNotice(null);
    const res = await fetch("/api/v1/practice/appointments", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        patientId: props.patientId,
        appointmentType: book.type,
        visitTypeId: book.visitTypeId || null,
        consultationModeId: book.modeId || null,
        date: book.date, time: book.time,
        // #15: empty means the regular week decides, exactly as before this select existed.
        locationId: book.locationId || undefined,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setNotice({ kind: "err", text: data?.error?.message ?? data?.error ?? "That did not work." });
      setBusy(false); return;
    }
    const outside = data?.appointment?.outsideRegularWeek as string | null | undefined;
    setNotice(outside
      ? { kind: "err", text: `Booked — but ${outside}. It has no location, so it will not show under a hospital until you set one.` }
      : { kind: "ok", text: "Booked." });
    setBusy(false);
    router.refresh();
  }

  async function doMerge() {
    // Resolve the duplicate by its patient number (or a legacy Practice ID) first -- merging by uuid
    // paste is error-prone. The comparison accepts the normalised number forms search accepts.
    setBusy(true); setNotice(null);
    const typed = mergeTarget.trim();
    const asNumber = /^(\d{2})[-\s]?(\d{1,6})$/.exec(typed);
    const canonical = asNumber ? `${asNumber[1]}-${asNumber[2].padStart(6, "0")}` : null;
    const search = await fetch(`/api/v1/practice/patients?q=${encodeURIComponent(typed)}`);
    const found = search.ok ? (await search.json()).results : [];
    const target = (found as any[]).find(r =>
      (canonical && r.patientNumber === canonical) || r.practiceId?.toLowerCase() === typed.toLowerCase());
    if (!target) { setNotice({ kind: "err", text: "No patient with that patient number (or legacy Practice ID)." }); setBusy(false); return; }
    if (target.id === props.patientId) { setNotice({ kind: "err", text: "That is this patient." }); setBusy(false); return; }
    await call(() => fetch(`/api/v1/practice/patients/${props.patientId}/merge`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ duplicatePatientId: target.id, reason: "confirmed duplicate" }),
    }), "Merged.");
  }

  return (
    <section id="record-actions" className="scroll-mt-4 rounded-xl border border-gray-200 bg-white p-4">
      {notice && (
        <p className={`mb-3 rounded-lg px-3 py-2 text-[12px] ${notice.kind === "ok" ? "bg-[var(--cmp-surface-success)] text-[var(--cmp-text-success)]" : "bg-[var(--cmp-surface-critical)] text-[var(--cmp-text-critical)]"}`}>{notice.text}</p>
      )}

      {/* FLOW-001 pathways 2 and 4, and the refusal when the record could not be read, both now in
          startEncounterFor(). This panel USED to decide the pathway from a `hasPriorEncounter` prop the
          server computed at page load -- correct, and stale by however long the tab had been open. The
          shared control reads the history at the moment somebody presses it. */}
      {/* max-md:hidden: below md the record page mounts this SAME shared control at thumb size
          directly under the patient's identity (CPR-MOB-001 s9's consistently-positioned primary
          action), and one viewport must not carry the act twice (s4). Desktop keeps this copy. */}
      {props.canStartEncounter && (
        <div className="mb-4 max-md:hidden">
          <StartEncounterAction
            patientId={props.patientId}
            note="Opens the consultation record now. If one is already open for this patient it is resumed, never duplicated."
            disabled={busy}
            onNotice={setNotice}
            onBusy={setBusy}
          />
        </div>
      )}

      {/* ⚠ THREE STATES. An unreadable taxonomy is not a practice with nothing configured, and the
          difference matters here more than anywhere: two empty dropdowns look like a setup task, so
          somebody would go to Practice Setup, find six visit types already there, and be none the wiser.
          The form is withheld and the reason is named. */}
      {props.canBook && !props.taxonomy.readable && (
        <p className="rounded-lg border border-[var(--cmp-color-critical)] bg-[var(--cmp-surface-critical)] p-3 text-[12px] text-[var(--cmp-text-critical)]">
          Booking is unavailable because this practice&rsquo;s visit types and consultation modes could
          not be read. This is not a setup problem &mdash; nothing has been lost. Reload, and if it
          persists the appointment can still be made from the Planner.
        </p>
      )}

      {props.canBook && props.taxonomy.readable && (
        <>
          <h2 className="text-[13px] font-bold text-gray-900">Book for this patient</h2>
          <form className="mt-2 grid grid-cols-2 gap-2" onSubmit={e => { e.preventDefault(); bookAppt(); }}>
            <input type="date" value={book.date} onChange={e => setBook(p => ({ ...p, date: e.target.value }))} className={input} />
            {/* THE SHARED CONTROL, NOT type="time": the native picker renders 12-hour on many
                machines and the owner asked for the 24-hour clock. TimeInput holds it to HH:MM off
                the one imported pattern; the server composes the instant in the practice timezone
                either way. */}
            <TimeInput value={book.time} onChange={v => setBook(p => ({ ...p, time: v }))}
              className={input} required placeholder="09:00" />
            {/* ⚠ TWO FIELDS, NOT ONE (s3). WHY the patient is being seen and HOW the consultation
                happens are independent: a follow-up may be in person, by telephone or at home, and the
                single list made those the same kind of thing -- so a teleconsultation recorded no
                clinical purpose and a follow-up recorded no mode. */}
            <label className="flex flex-col gap-1">
              <span className="text-[10.5px] font-semibold text-gray-500">Visit type</span>
              <select value={book.visitTypeId} required className={input}
                onChange={e => setBook(p => ({ ...p, visitTypeId: e.target.value }))}>
                {props.taxonomy.visitTypes.map(v => <option key={v.id} value={v.id}>{v.label}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[10.5px] font-semibold text-gray-500">Mode</span>
              <select value={book.modeId} required className={input}
                onChange={e => setBook(p => ({ ...p, modeId: e.target.value }))}>
                {props.taxonomy.modes.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
              </select>
            </label>
            {/* #15: WHERE, without leaving this card. The empty choice is the ordinary case and
                changes nothing -- the regular week still decides. Choosing is for the booking the
                pink notice warns about: outside the week, where no location can be assumed. */}
            {props.locations.length > 0 && (
              <label className="col-span-2 flex flex-col gap-1">
                <span className="text-[10.5px] font-semibold text-gray-500">Location</span>
                <select value={book.locationId} className={input}
                  onChange={e => setBook(p => ({ ...p, locationId: e.target.value }))}>
                  <option value="">Decided by the regular week</option>
                  {props.locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                </select>
              </label>
            )}
            <button type="submit" disabled={busy}
              className="col-span-2 rounded-lg bg-[var(--cp-primary)] py-2 text-[12px] font-semibold text-white hover:bg-[var(--cp-primary-deep)] disabled:opacity-50 max-md:min-h-[var(--cp-touch)]">
              Book appointment
            </button>
          </form>
        </>
      )}

      {props.canEdit && (
        <>
          <h2 className="mt-4 text-[13px] font-bold text-gray-900">Edit demographics</h2>
          <form className="mt-2 flex flex-col gap-2" onSubmit={e => { e.preventDefault(); saveEdit(); }}>
            <input value={edit.displayName} onChange={e => setEdit(p => ({ ...p, displayName: e.target.value }))} className={input} />
            <div className="grid grid-cols-2 gap-2">
              <select value={edit.sex} onChange={e => setEdit(p => ({ ...p, sex: e.target.value }))} className={input}>
                {["unspecified", "female", "male", "other", "unknown"].map(s => <option key={s} value={s}>{s}</option>)}
              </select>
              <input type="date" value={edit.birthDate} onChange={e => setEdit(p => ({ ...p, birthDate: e.target.value }))} className={input} />
            </div>
            <button type="submit" disabled={busy || !edit.displayName.trim()}
              className="rounded-lg border border-gray-200 py-2 text-[12px] font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50 max-md:min-h-[var(--cp-touch)]">
              Save changes
            </button>
          </form>
        </>
      )}

      {props.canMerge && (
        <>
          <h2 className="mt-4 text-[13px] font-bold text-gray-900">Merge a duplicate into this record</h2>
          <p className="mt-1 text-[10px] text-gray-400">
            Enter the duplicate&apos;s patient number (or a legacy Practice ID). Its identifiers, contacts and
            appointments move here; the duplicate is kept as a merged pointer, fully audited. This is a
            clinical decision.
          </p>
          <div className="mt-2 flex gap-2">
            <input placeholder="26-000184 or P-XXXXXX" value={mergeTarget} onChange={e => setMergeTarget(e.target.value)} className={input} />
            <button type="button" disabled={busy || !mergeTarget.trim()} onClick={doMerge}
              className="shrink-0 rounded-lg border border-[var(--cmp-color-warning)] px-3 py-2 text-[12px] font-semibold text-[var(--cmp-text-warning)] hover:bg-[var(--cmp-surface-warning)] disabled:opacity-50 max-md:min-h-[var(--cp-touch)]">
              Merge
            </button>
          </div>
        </>
      )}
    </section>
  );
}
