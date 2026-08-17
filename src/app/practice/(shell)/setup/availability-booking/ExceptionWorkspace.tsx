"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatDayTime } from "@/lib/datetime";
import { ACTIVITY_TYPES, ACTIVITY_LABEL, type ActivityType } from "@/lib/practice/activity-constants";
import {
  EXCEPTION_KINDS, RESOLUTIONS, RESOLUTIONS_AT_COMMIT, RESOLUTIONS_PER_BOOKING,
  IMPACT_STATE_CHIP, resolutionLabel, exceptionKindLabel,
} from "@/lib/practice/schedule-exception-constants";
// ⚠ THE 24-HOUR CONTROL, NOT THE NATIVE TIME PICKER, which draws itself in the OPERATING SYSTEM's
// locale -- so a machine set to en-US renders "11:00 AM" on a screen whose every other clock is
// 24-hour. The value shape is unchanged ("09:00"), so nothing downstream moves. HHMM_RE is the same
// expression the control's own `pattern` attribute is compiled from -- imported, never re-typed.
import { TimeInput } from "@/components/ui/wall-clock";
import { HHMM_RE } from "@/lib/practice/practice-time";

/* eslint-disable @typescript-eslint/no-explicit-any */

// ────────────────────────────────────────────────────────────────────────────────────────────────────
// CPR-V5-007 s5 -- LAYER 2's CENTRE WORKSPACE. The change form, the impact preview, and the queue of
// people a change has left waiting on a decision.
//
// ---- THE ORDER ON THIS SCREEN IS s5.3's ORDER, AND IT IS NOT NEGOTIABLE ------------------------------
//
//   1. describe the change            the form
//   2. see who is in it               "Check who is affected", and the list it returns
//   3. say what happens to them       the resolution, which cannot be chosen before step 2 has run
//   4. make the change                and only then
//
// AC-04: "Before committing a change, the system identifies affected bookings and REQUIRES a resolution
// strategy." So the commit button does not exist until the impact has been calculated, and editing any
// field of the change THROWS THE PREVIEW AWAY. A count that was true of a different Friday is worse than
// no count at all, because it is a number somebody would act on.
//
// The server refuses independently -- commitScheduleChange recalculates rather than trusting anything
// sent to it. This form not offering the shortcut is a courtesy; the engine refusing it is the guarantee.
//
// ---- FOUR THINGS THIS SCREEN WILL NOT DO ------------------------------------------------------------
//
//   1. IT WILL NOT SHOW A NOUGHT FOR AN UNREADABLE COUNT. A failed impact query renders as a refusal
//      with the reason, and the commit stays unavailable.
//   2. IT WILL NOT DRAW AN UNREVIEWED CHANGE AS "NOBODY AFFECTED". Those are different answers and only
//      one of them is safe. Unreviewed is its own slate chip, and it says so in words.
//   3. IT WILL NOT SHOW A PATIENT'S NAME TO SOMEBODY WITHOUT patient.view. The count, the day and the
//      time are complete; the name is replaced by the booking's own reference, which is enough to act on.
//   4. IT WILL NOT OFFER A RESOLUTION THIS BUILD CANNOT CARRY OUT. "Offer next available" and "Move to
//      waiting list" are drawn as what they are, with the reason, rather than as radio buttons that
//      would store a decision nothing acts on.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

const field = "mt-0.5 w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-[12px] text-gray-800";
const labelCls = "flex flex-col text-[10px] font-semibold uppercase tracking-wide text-gray-500";
const card = "rounded-xl border border-gray-200 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]";

type Draft = {
  kind: string;
  fromDate: string;
  toDate: string;
  locationId: string;
  from: string;
  to: string;
  wholeDay: boolean;
  replacementLocationId: string;
  replacementActivityType: string;
  reason: string;
};

const blank = (today: string): Draft => ({
  kind: "leave", fromDate: today, toDate: today, locationId: "",
  from: "09:00", to: "13:00", wholeDay: true,
  replacementLocationId: "", replacementActivityType: "", reason: "",
});

const toMinutes = (v: string) => {
  const [h, m] = v.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
};

export default function ExceptionWorkspace({
  changes, queue, locations, today, timezone, mayEdit, namesVisible,
  changesUnreadable, queueUnreadable,
}: {
  changes: any[]; queue: any[]; locations: any[];
  today: string; timezone: string; mayEdit: boolean; namesVisible: boolean;
  changesUnreadable: string | null; queueUnreadable: string | null;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [impact, setImpact] = useState<any | null>(null);
  const [impactError, setImpactError] = useState<string | null>(null);
  const [resolution, setResolution] = useState<string>("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const kind = EXCEPTION_KINDS.find(k => k.code === draft?.kind) ?? EXCEPTION_KINDS[0];

  /**
   * ⚠ A TEXT CONTROL DOES NOT GUARANTEE WHAT THE NATIVE PICKER GUARANTEED, AND NOTHING ELSE ON THIS PATH
   * CATCHES IT. There is no <form> here -- both buttons are type="button" with onClick handlers -- so
   * `pattern` on the control is a validation bubble that never fires and the guard has to live in the
   * handler. And the thing it is guarding against is not a visible error: `toMinutes` reads "9am" as
   * NOUGHT, because Number("9am") is NaN and `NaN || 0` is 0. So an unguarded "9am" would post
   * startsMinute: 0 -- a perfectly valid number -- and the practitioner would be shown the impact of
   * cancelling from MIDNIGHT, then commit it.
   *
   * The ordering check is here for a second reason: the engine refuses end <= start on commit
   * (schedule-exceptions.ts), but preview_impact does NOT, so a reversed window previews as "nobody is
   * affected" and is only refused one button later. Saying it at the field is the honest moment.
   */
  const windowShown = !!draft && (kind.needsWindow || !draft.wholeDay);
  const windowProblem: string | null = (() => {
    if (!draft || !windowShown) return null;
    if (!HHMM_RE.test(draft.from) || !HHMM_RE.test(draft.to))
      return "Both times need to be on the 24-hour clock, written as HH:MM — for example 09:00 or 14:30.";
    if (toMinutes(draft.to) <= toMinutes(draft.from))
      return "The end of the window has to be after its start.";
    return null;
  })();

  /**
   * ⚠ EVERY EDIT THROWS THE PREVIEW AWAY. The count belongs to one exact change; the moment the dates,
   * the place or the window move it is a count of a different Friday, and a stale number under a live
   * commit button is the whole failure AC-04 describes.
   */
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => {
    setDraft(d => (d ? { ...d, [k]: v } : d));
    setImpact(null); setImpactError(null); setResolution("");
  };

  const payloadFor = (d: Draft) => ({
    kind: d.kind, fromDate: d.fromDate, toDate: d.toDate,
    locationId: d.locationId || null,
    startsMinute: d.wholeDay && !kind.needsWindow ? null : toMinutes(d.from),
    endsMinute: d.wholeDay && !kind.needsWindow ? null : toMinutes(d.to),
    replacementLocationId: kind.needsReplacementLocation ? (d.replacementLocationId || null) : null,
    replacementActivityType: kind.needsReplacementActivity ? (d.replacementActivityType || null) : null,
    reason: d.reason.trim() || null,
  });

  async function post(body: Record<string, unknown>) {
    const res = await fetch("/api/v1/practice/exceptions", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, data };
  }

  // ══ s5.3 STEPS 1 AND 2 ═════════════════════════════════════════════════════════════════════════
  async function checkImpact() {
    if (!draft) return;
    // ⚠ REFUSED HERE, NOT SILENTLY POSTED. The sentence is already on screen beside the field; saying it
    // again at the top is what a person who pressed the button gets, rather than a button that does
    // nothing.
    if (windowProblem) { setNotice({ kind: "err", text: windowProblem }); return; }
    setBusy(true); setNotice(null); setImpact(null); setImpactError(null);
    const { ok, data } = await post({ action: "preview_impact", ...payloadFor(draft) });
    setBusy(false);
    if (!ok) {
      // THE SERVER'S OWN WORDS. "An unread booking is not an absent one" is the content of the refusal.
      setImpactError(data?.error?.message ?? "The affected bookings could not be worked out.");
      return;
    }
    setImpact(data.impact);
    // A change nobody is booked into has exactly one true answer, and it is pre-selected rather than
    // demanded -- s5.3 allows "no patient impact" only here, and the engine refuses it anywhere else.
    setResolution(data.impact.count === 0 ? "no_patient_impact" : "");
  }

  // ══ s5.3 STEPS 3, 4 AND 5 ══════════════════════════════════════════════════════════════════════
  async function commit() {
    if (!draft || !impact || !resolution) return;
    // Transitively covered -- every edit throws the impact away and the commit needs one -- but the
    // write is the step that cannot be taken back, so it checks the value it is about to send.
    if (windowProblem) { setNotice({ kind: "err", text: windowProblem }); return; }
    setBusy(true); setNotice(null);
    const { ok, data } = await post({
      action: "commit_change", ...payloadFor(draft), resolution, note: note.trim() || null,
    });
    setBusy(false);
    if (!ok) {
      setNotice({ kind: "err", text: data?.error?.message ?? "That change was not made." });
      return;
    }
    const c = data.change;
    setNotice({
      kind: "ok",
      text: `Change recorded. ${c.affected === 0 ? "Nobody was booked into it." : `${c.affected} booking${c.affected === 1 ? "" : "s"} affected — ${resolutionLabel(c.resolution).toLowerCase()}.`}`
        + (data.generationFailed ? ` The diary has NOT been rebuilt: ${data.generationFailed}` : ""),
    });
    setDraft(null); setImpact(null); setResolution(""); setNote("");
    router.refresh();
  }

  /**
   * s17: "Exception processing is retryable and idempotent."
   *
   * A change recorded on Monday cannot know about a booking made into it on Tuesday -- the calculation
   * ran once, before that patient existed. This is the button that catches up, and running it twice
   * creates nothing the second time.
   */
  async function recheck(exceptionId: string) {
    setBusy(true); setNotice(null);
    const { ok, data } = await post({ action: "recalculate_impact", exceptionId });
    setBusy(false);
    if (!ok) {
      setNotice({ kind: "err", text: data?.error?.message ?? "That change could not be re-checked." });
      return;
    }
    const r = data.recalculated;
    setNotice({
      kind: "ok",
      text: r.created > 0
        ? `${r.created} booking${r.created === 1 ? "" : "s"} made since this change was recorded ${r.created === 1 ? "has" : "have"} been added to the queue, undecided.`
        : `Re-checked. ${r.affected} booking${r.affected === 1 ? " is" : "s are"} in that time, and ${r.affected === 1 ? "it was" : "they were"} already accounted for.`,
    });
    router.refresh();
  }

  async function resolveOne(actionId: string, chosen: string, extra: Record<string, unknown> = {}) {
    setBusy(true); setNotice(null);
    const { ok, data } = await post({ action: "resolve_booking", actionId, resolution: chosen, ...extra });
    setBusy(false);
    if (!ok) {
      setNotice({ kind: "err", text: data?.error?.message ?? "That decision was not recorded." });
      return;
    }
    setNotice({ kind: "ok", text: `Recorded: ${resolutionLabel(chosen).toLowerCase()}.` });
    router.refresh();
  }

  const commitReady = !!impact && !!resolution;

  return (
    <div className="flex flex-col gap-4">

      {notice && (
        <p className={`rounded-lg px-3.5 py-2.5 text-[12px] leading-relaxed ${
          notice.kind === "ok"
            ? "bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200"
            : "bg-rose-50 text-rose-800 ring-1 ring-rose-200"}`}>
          {notice.text}
        </p>
      )}

      {/* ══ THE CHANGE FORM ═══════════════════════════════════════════════════════════════════════ */}
      <section className={card}>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span aria-hidden className="flex h-7 w-7 items-center justify-center rounded-lg bg-amber-100 text-[14px] text-amber-700">⚑</span>
          <div className="min-w-0">
            <h3 className="text-[14px] font-bold text-gray-900">Change a date</h3>
            <p className="text-[11px] text-gray-500">
              This changes one date or a run of them. Your regular week is untouched.
            </p>
          </div>
          {mayEdit && !draft && (
            <button type="button" onClick={() => { setDraft(blank(today)); setImpact(null); setResolution(""); }}
              className="ml-auto rounded-lg bg-[var(--cp-primary)] px-3.5 py-2 text-[12px] font-semibold text-white hover:bg-[var(--cp-primary-deep)]">
              Add a change
            </button>
          )}
        </div>

        {!mayEdit && (
          <p className="text-[12px] text-gray-500">
            You can see the changes below but not make one. Creating an exception needs appointment.manage.
          </p>
        )}

        {draft && (
          <div className="rounded-lg border border-gray-200 p-3.5">
            {/* ---- 1. WHAT KIND OF CHANGE (s5.2's six categories, as seven stored values) ---- */}
            <fieldset>
              <legend className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                What is different
              </legend>
              <div className="mt-1.5 grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
                {EXCEPTION_KINDS.map(k => (
                  <label key={k.code}
                    className={`cursor-pointer rounded-lg border px-2.5 py-2 text-[11.5px] ${
                      draft.kind === k.code
                        ? "border-amber-300 bg-amber-50/70 ring-1 ring-amber-200"
                        : "border-gray-200 hover:bg-gray-50"}`}>
                    <span className="flex items-center gap-1.5">
                      <input type="radio" name="kind" value={k.code} checked={draft.kind === k.code}
                        onChange={() => set("kind", k.code)} className="h-3 w-3" />
                      <span className="font-bold text-gray-900">{k.label}</span>
                    </span>
                    <span className="mt-0.5 block leading-snug text-gray-500">{k.blurb}</span>
                  </label>
                ))}
              </div>
            </fieldset>

            {/* ---- 2. WHEN AND WHERE ---- */}
            <div className="mt-3 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
              <label className={labelCls}>
                First date
                <input type="date" value={draft.fromDate} className={field}
                  onChange={e => set("fromDate", e.target.value)} />
              </label>
              <label className={labelCls}>
                Last date
                <input type="date" value={draft.toDate} className={field}
                  onChange={e => set("toDate", e.target.value)} />
              </label>
              <label className={labelCls}>
                Where
                <select value={draft.locationId} className={field}
                  onChange={e => set("locationId", e.target.value)}>
                  <option value="">Everywhere I work</option>
                  {locations.filter(l => l.active).map(l => (
                    <option key={l.id} value={l.id}>{l.name}</option>
                  ))}
                </select>
              </label>
              <label className={labelCls}>
                Reason (optional)
                <input type="text" value={draft.reason} className={field} maxLength={200}
                  placeholder="Conference, illness…"
                  onChange={e => set("reason", e.target.value)} />
              </label>
            </div>

            {/* ---- 3. THE WINDOW. Adding time has to say when; removing it does not. ---- */}
            <div className="mt-3 flex flex-wrap items-end gap-2.5">
              {!kind.needsWindow && (
                <label className="flex items-center gap-1.5 text-[11.5px] text-gray-700">
                  <input type="checkbox" checked={draft.wholeDay} className="h-3.5 w-3.5"
                    onChange={e => set("wholeDay", e.target.checked)} />
                  The whole day
                </label>
              )}
              {(kind.needsWindow || !draft.wholeDay) && (
                <>
                  <label className={labelCls}>
                    From
                    <TimeInput value={draft.from} className={field}
                      onChange={v => set("from", v)} />
                  </label>
                  <label className={labelCls}>
                    To
                    <TimeInput value={draft.to} className={field} placeholder="13:00"
                      onChange={v => set("to", v)} />
                  </label>
                </>
              )}
            </div>
            {/* ⚠ SAID AT THE FIELD, AS IT IS TYPED. The two buttons refuse the same thing, but a
                refusal that only arrives on a click is a refusal somebody has already committed to. */}
            {windowProblem && (
              <p role="alert" className="mt-1.5 text-[11px] leading-relaxed text-rose-700">
                {windowProblem}
              </p>
            )}

            {/* ---- 4. WHAT IT BECOMES (s5.2's location change and activity substitution) ---- */}
            {kind.needsReplacementLocation && (
              <label className={`${labelCls} mt-3 max-w-sm`}>
                Moved to
                <select value={draft.replacementLocationId} className={field}
                  onChange={e => set("replacementLocationId", e.target.value)}>
                  <option value="">Choose where the session moves to</option>
                  {locations.filter(l => l.active && l.id !== draft.locationId).map(l => (
                    <option key={l.id} value={l.id}>{l.name}</option>
                  ))}
                </select>
                <span className="mt-1 text-[10px] font-normal normal-case tracking-normal text-gray-500">
                  Everyone already booked is expecting the old address. That is what the next step is for.
                </span>
              </label>
            )}
            {kind.needsReplacementActivity && (
              <label className={`${labelCls} mt-3 max-w-sm`}>
                Replaced by
                <select value={draft.replacementActivityType} className={field}
                  onChange={e => set("replacementActivityType", e.target.value)}>
                  <option value="">Choose what the session becomes</option>
                  {ACTIVITY_TYPES.map(a => (
                    <option key={a} value={a}>{ACTIVITY_LABEL[a as ActivityType]}</option>
                  ))}
                </select>
                <span className="mt-1 text-[10px] font-normal normal-case tracking-normal text-gray-500">
                  The time stays in your diary — you are still busy — but nobody can be booked into it.
                </span>
              </label>
            )}

            {/* ---- 5. s5.3 STEP 2: THE COUNT AND THE PATIENT-SAFE SUMMARY ---- */}
            <div className="mt-4 border-t border-gray-100 pt-3">
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" onClick={checkImpact} disabled={busy}
                  className="rounded-lg border border-gray-300 bg-white px-3.5 py-2 text-[12px] font-semibold text-gray-800 hover:bg-gray-50 disabled:opacity-50">
                  {busy ? "Checking…" : "Check who is affected"}
                </button>
                <button type="button" onClick={() => { setDraft(null); setImpact(null); setResolution(""); }}
                  className="text-[11.5px] font-semibold text-gray-500 hover:underline">
                  Cancel
                </button>
                {!impact && !impactError && (
                  <p className="text-[11px] text-gray-500">
                    Nothing is written until you have seen who is in this time and said what happens to them.
                  </p>
                )}
              </div>

              {impactError && (
                <p className="mt-2.5 rounded-lg border border-rose-300 bg-rose-50 px-3.5 py-2.5 text-[12px] leading-relaxed text-rose-800">
                  <span className="font-bold">This change was not made.</span> {impactError} Nothing here is
                  a count of nought — it is no count at all, so the change stays unmade until it loads.
                </p>
              )}

              {impact && (
                <div className={`mt-3 rounded-lg border p-3.5 ${
                  impact.count === 0 ? "border-emerald-200 bg-emerald-50/60" : "border-rose-200 bg-rose-50/60"}`}>
                  <p className={`text-[13px] font-bold ${impact.count === 0 ? "text-emerald-900" : "text-rose-900"}`}>
                    <span className={`text-[22px] leading-none ${impact.count === 0 ? "text-emerald-700" : "text-rose-700"}`}>
                      {impact.count}
                    </span>
                    {" "}
                    {impact.count === 1 ? "booking is in this time" : "bookings are in this time"}
                  </p>

                  {impact.count > 0 && (
                    <ul className="mt-2 space-y-1.5">
                      {impact.bookings.map((b: any) => (
                        <li key={b.appointmentId}
                          className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 rounded-md bg-white/70 px-2.5 py-1.5 text-[11.5px]">
                          <span className="font-bold text-gray-900">
                            {b.patientName ?? `Booking ${b.reference}`}
                          </span>
                          <span className="text-gray-600">{b.date} at {b.timeOfDay}</span>
                          <span className="text-gray-500">
                            · {String(b.appointmentType).replace(/_/g, " ")} · {String(b.status).toLowerCase()}
                            {b.locationName ? ` · ${b.locationName}` : ""}
                          </span>
                          {b.followUpLinked === true && (
                            <span className="rounded bg-violet-100 px-1.5 py-px text-[9px] font-bold uppercase text-violet-700">
                              follow-up
                            </span>
                          )}
                          {b.followUpLinked === null && (
                            <span className="rounded bg-slate-100 px-1.5 py-px text-[9px] font-bold uppercase text-slate-500">
                              follow-up unknown
                            </span>
                          )}
                          {b.locationUncertain && (
                            <span className="rounded bg-amber-100 px-1.5 py-px text-[9px] font-bold uppercase text-amber-700">
                              no location recorded
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}

                  {/* Every caveat the engine attached, in its own words. */}
                  <ul className="mt-2 space-y-0.5 border-t border-black/5 pt-2 text-[10px] leading-relaxed text-gray-500">
                    {impact.notes.map((n: string, i: number) => <li key={i}>· {n}</li>)}
                  </ul>

                  {/* ---- 6. s5.3 STEP 3: THE RESOLUTION. REQUIRED. ---- */}
                  <fieldset className="mt-3 border-t border-black/5 pt-3">
                    <legend className="text-[11px] font-bold text-gray-900">
                      {impact.count === 0
                        ? "Record what you found"
                        : `What happens to ${impact.count === 1 ? "this patient" : "these patients"}?`}
                    </legend>
                    <div className="mt-1.5 space-y-1.5">
                      {RESOLUTIONS.map(r => {
                        const offered = impact.count === 0
                          ? r.code === "no_patient_impact"
                          : RESOLUTIONS_AT_COMMIT.includes(r.code) && r.code !== "no_patient_impact";
                        if (offered) {
                          return (
                            <label key={r.code}
                              className={`flex cursor-pointer items-start gap-2 rounded-lg border px-2.5 py-2 text-[11.5px] ${
                                resolution === r.code ? "border-[var(--cp-primary)]/40 bg-white" : "border-gray-200 bg-white/60 hover:bg-white"}`}>
                              <input type="radio" name="resolution" value={r.code} checked={resolution === r.code}
                                onChange={() => setResolution(r.code)} className="mt-0.5 h-3 w-3" />
                              <span className="min-w-0">
                                <span className="font-bold text-gray-900">{r.label}</span>
                                {!r.resolves && (
                                  <span className="ml-1.5 rounded bg-violet-100 px-1.5 py-px text-[9px] font-bold uppercase text-violet-700">
                                    stays in the queue
                                  </span>
                                )}
                                <span className="mt-0.5 block leading-snug text-gray-500">{r.blurb}</span>
                              </span>
                            </label>
                          );
                        }
                        // Not built, or not a decision about a group. Drawn as what it is.
                        if (impact.count === 0 || r.code === "no_patient_impact") return null;
                        return (
                          <div key={r.code}
                            className="rounded-lg border border-dashed border-slate-300 bg-slate-50/70 px-2.5 py-2 text-[11px]">
                            <span className="font-bold text-slate-600">{r.label}</span>
                            <span className="ml-1.5 rounded bg-white px-1.5 py-px text-[9px] font-bold uppercase tracking-wide text-slate-500 ring-1 ring-slate-200">
                              {r.built ? "one patient at a time" : "not built"}
                            </span>
                            <span className="mt-0.5 block leading-snug text-slate-500">{r.detail}</span>
                          </div>
                        );
                      })}
                    </div>

                    {impact.count > 0 && (
                      <label className={`${labelCls} mt-2.5`}>
                        Note recorded against each patient (optional)
                        <input type="text" value={note} maxLength={500} className={field}
                          placeholder="Clinic moved after theatre list was added"
                          onChange={e => setNote(e.target.value)} />
                      </label>
                    )}
                  </fieldset>

                  <button type="button" onClick={commit} disabled={busy || !commitReady}
                    className="mt-3 rounded-lg bg-[var(--cp-primary)] px-3.5 py-2 text-[12px] font-semibold text-white hover:bg-[var(--cp-primary-deep)] disabled:cursor-not-allowed disabled:opacity-40">
                    {busy ? "Working…" : "Make this change"}
                  </button>
                  {!resolution && (
                    <p className="mt-1.5 text-[10.5px] text-gray-500">
                      Choose what happens to {impact.count === 1 ? "this booking" : "these bookings"} first.
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </section>

      {/* ══ THE CHANGES THEMSELVES ════════════════════════════════════════════════════════════════ */}
      <section className={card}>
        <h3 className="text-[14px] font-bold text-gray-900">Upcoming changes</h3>
        <p className="mb-3 text-[11px] text-gray-500">
          Dates that are not like your regular week. All times are in {timezone}.
        </p>
        {changesUnreadable ? (
          <p className="rounded-lg border border-slate-300 bg-slate-50 px-3.5 py-2.5 text-[12px] leading-relaxed text-slate-600">
            <span className="font-bold">Could not be read.</span> {changesUnreadable} This is not a count
            of nothing — it is no count at all.
          </p>
        ) : changes.length === 0 ? (
          <p className="text-[12px] text-gray-400">
            Nothing upcoming. Leave, closures, one-off clinics, moves and substitutions all go here, and
            none of them is required.
          </p>
        ) : (
          <ul className="space-y-2">
            {changes.map(c => {
              const chip = IMPACT_STATE_CHIP[c.impactState];
              return (
                <li key={c.id} className="flex flex-wrap items-start gap-3 rounded-lg border border-gray-200 px-3 py-2.5">
                  <div className="w-[52px] shrink-0 text-center">
                    <p className="text-[15px] font-bold leading-none text-amber-700">{c.fromDate.slice(8, 10)}</p>
                    <p className="text-[9px] font-bold uppercase tracking-wide text-gray-500">
                      {new Date(`${c.fromDate}T12:00:00Z`).toLocaleString("en-GB", { month: "short", timeZone: "UTC" })}
                    </p>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-1.5 text-[12.5px] font-bold text-gray-900">
                      {c.kindLabel}
                      {c.reason ? <span className="font-normal text-gray-600">— {c.reason}</span> : null}
                      <span className={`rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide ${chip.chip}`}>
                        {chip.label}
                      </span>
                    </p>
                    <p className="text-[11px] text-gray-600">
                      {c.fromDate === c.toDate ? c.fromDate : `${c.fromDate} → ${c.toDate}`}
                      {` · ${c.window} · ${c.locationName ?? "everywhere"}`}
                      {c.replacementLocationName ? ` → moved to ${c.replacementLocationName}` : ""}
                      {c.replacementActivityLabel ? ` → becomes ${c.replacementActivityLabel}` : ""}
                    </p>
                    {/* ⚠ THE THREE STATES SPELLED OUT. Never a tick for an unasked question. */}
                    <p className="mt-0.5 text-[10.5px] leading-relaxed text-gray-500">
                      {c.impactState === "unreviewed"
                        ? "Nobody has checked who was booked into this. That is not the same as nobody being booked into it."
                        : c.impactState === "pending"
                          ? `${c.pending} of ${c.actions} booking${c.actions === 1 ? "" : "s"} still waiting on a decision.`
                          : c.impactState === "settled"
                            ? `${c.actions} booking${c.actions === 1 ? "" : "s"} affected, all decided.`
                            : "Checked when it was made — nobody was booked into it."}
                    </p>
                  </div>
                  {mayEdit && (
                    <button type="button" disabled={busy} onClick={() => recheck(c.id)}
                      className="shrink-0 self-center rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-40"
                      title="Bookings made after a change was recorded are not in its queue until this is run.">
                      Re-check who is affected
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* ══ s5.3's ACTION QUEUE ═══════════════════════════════════════════════════════════════════ */}
      <section className={card}>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span aria-hidden className="flex h-7 w-7 items-center justify-center rounded-lg bg-rose-100 text-[14px] text-rose-700">☎</span>
          <div className="min-w-0">
            <h3 className="text-[14px] font-bold text-gray-900">Patients waiting on a decision</h3>
            <p className="text-[11px] text-gray-500">
              One row per person a schedule change put in the way of. They stay here until somebody
              decides — keeping them pending is a decision, not a resolution.
            </p>
          </div>
        </div>
        {queueUnreadable ? (
          <p className="rounded-lg border border-slate-300 bg-slate-50 px-3.5 py-2.5 text-[12px] leading-relaxed text-slate-600">
            <span className="font-bold">Could not be read.</span> {queueUnreadable} An empty queue and an
            unreadable one are not the same answer.
          </p>
        ) : queue.length === 0 ? (
          <p className="text-[12px] text-gray-400">
            Nobody is waiting. Every change so far either affected nobody or has been settled.
          </p>
        ) : (
          <ul className="space-y-2">
            {queue.map(q => <QueueRow key={q.id} q={q} busy={busy} namesVisible={namesVisible}
              timezone={timezone} onResolve={resolveOne} />)}
          </ul>
        )}
      </section>
    </div>
  );
}

/**
 * ONE PERSON, AND WHAT MAY BE DECIDED ABOUT THEM.
 *
 * s5.3's "bulk reschedule" is per-patient by the specification's own wording -- "user selects another
 * session and CONFIRMS PATIENT-BY-PATIENT EXCEPTIONS" -- so it lives here and not on the commit form.
 * It asks for the appointment the patient was actually moved to, because a reschedule with no
 * destination is a word rather than a move, and the engine refuses it without one.
 */
function QueueRow({ q, busy, namesVisible, timezone, onResolve }: {
  q: any; busy: boolean; namesVisible: boolean; timezone: string;
  onResolve: (id: string, resolution: string, extra?: Record<string, unknown>) => void;
}) {
  const [open, setOpen] = useState(false);
  const [chosen, setChosen] = useState("");
  const [note, setNote] = useState("");
  const [destination, setDestination] = useState("");

  const needsDestination = chosen === "bulk_reschedule";

  return (
    <li className="rounded-lg border border-gray-200 px-3 py-2.5">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <p className="text-[12.5px] font-bold text-gray-900">
          {q.patientName ?? `Booking ${q.reference}`}
        </p>
        {!namesVisible && (
          <span className="rounded bg-slate-100 px-1.5 py-px text-[9px] font-bold uppercase text-slate-500">
            name withheld
          </span>
        )}
        <p className="text-[11px] text-gray-600">
          {q.scheduledAt ? formatDayTime(q.scheduledAt, timezone) : "time unknown"}
          {q.appointmentStatus ? ` · ${String(q.appointmentStatus).toLowerCase()}` : ""}
        </p>
        <p className="ml-auto text-[10.5px] text-gray-500">
          {exceptionKindLabel(q.exceptionKind)}
          {q.exceptionFromDate ? ` · ${q.exceptionFromDate}` : ""}
          {q.exceptionReason ? ` · ${q.exceptionReason}` : ""}
        </p>
      </div>
      <p className="mt-0.5 text-[10.5px] text-gray-500">
        Currently: <span className="font-semibold text-violet-700">{resolutionLabel(q.resolution)}</span>
        {q.resolved ? " · resolved" : " · unresolved"}
        {q.note ? ` · ${q.note}` : ""}
      </p>

      {!open ? (
        <button type="button" onClick={() => setOpen(true)}
          className="mt-1.5 text-[11px] font-semibold text-[var(--cp-primary)] hover:underline">
          Decide →
        </button>
      ) : (
        <div className="mt-2 flex flex-wrap items-end gap-2 border-t border-gray-100 pt-2">
          <label className={labelCls}>
            Decision
            <select value={chosen} className={field} onChange={e => setChosen(e.target.value)}>
              <option value="">Choose…</option>
              {RESOLUTIONS.filter(r => RESOLUTIONS_PER_BOOKING.includes(r.code)).map(r => (
                <option key={r.code} value={r.code}>{r.label}</option>
              ))}
            </select>
          </label>
          {needsDestination && (
            <label className={labelCls}>
              The appointment they were moved to
              <input type="text" value={destination} className={field}
                placeholder="Appointment id from the calendar"
                onChange={e => setDestination(e.target.value)} />
            </label>
          )}
          <label className={`${labelCls} min-w-[180px] flex-1`}>
            Note (optional)
            <input type="text" value={note} maxLength={500} className={field}
              onChange={e => setNote(e.target.value)} />
          </label>
          <button type="button" disabled={busy || !chosen || (needsDestination && !destination.trim())}
            onClick={() => onResolve(q.id, chosen, {
              note: note.trim() || null,
              rescheduledAppointmentId: needsDestination ? destination.trim() : null,
            })}
            className="rounded-lg bg-[var(--cp-primary)] px-3 py-1.5 text-[11.5px] font-semibold text-white hover:bg-[var(--cp-primary-deep)] disabled:opacity-40">
            Record
          </button>
          <button type="button" onClick={() => setOpen(false)}
            className="text-[11px] font-semibold text-gray-500 hover:underline">
            Close
          </button>
        </div>
      )}
    </li>
  );
}
