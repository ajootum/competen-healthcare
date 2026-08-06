"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  SESSION_ACTIVITY_TYPES, SESSION_ACTIVITY_LABEL, BOOKING_MODES, BOOKING_MODES_LIVE,
  SESSION_APPOINTMENT_TYPES, WEEKDAY_SHORT, ACTIVITY_HUE, ACTIVITY_HUE_UNSET,
  bookingModeLabel, appointmentTypeLabel,
} from "@/lib/practice/practice-session-constants";

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
//   2. IT WILL NOT OFFER "Public" OR "Link only" AS WORKING CHOICES. s8's patient-facing access is
//      Phase 4 and is not started, so those two are shown as what they are -- decisions this build
//      cannot honour -- rather than as switches that store a promise. The engine refuses them too; the
//      form not offering them is a courtesy, the engine refusing them is the guarantee.
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
};

const blankDraft = (weekday: number, locationId: string): Draft => ({
  templateId: null, weekday, from: "09:00", to: "13:00",
  locationId, clinicId: "", sessionName: "", activityType: "",
  // ⚠ 'none', ALWAYS. Never default a session to bookable.
  bookingMode: "none", appointmentTypes: [],
  capacityManual: "", appointmentMinutes: "", walkInsAllowed: false, walkInLimit: "",
  effectiveFrom: "", effectiveTo: "", sessionNote: "", status: "active",
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
});

const field = "mt-0.5 w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-[12px] text-gray-800";
const labelCls = "flex flex-col text-[10px] font-semibold uppercase tracking-wide text-gray-500";

export default function SessionWorkspace({ sessions, locations, clinics, today, defaultMinutes, mayEdit }: {
  sessions: any[]; locations: any[]; clinics: any[];
  today: string; defaultMinutes: number | null; mayEdit: boolean;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) =>
    setDraft(d => (d ? { ...d, [k]: v } : d));

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
    }, d => {
      const created = d.session?.created;
      const slots = d.generation?.slotsCreated ?? 0;
      return `${created ? "Session created" : "Session saved"}.${slots ? ` ${slots} bookable slot${slots === 1 ? "" : "s"} rebuilt.` : ""}`;
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
        <p role="status" className={`rounded-lg px-3.5 py-2.5 text-[12px] leading-relaxed ${
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
            <p className="text-[11px] text-gray-500">A session is a day and a time, not fifty-two copies.</p>
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
                              background: dim ? "var(--cp-slate-50, #f8fafc)" : `color-mix(in srgb, ${hue} 7%, white)`,
                              borderColor: `color-mix(in srgb, ${hue} 22%, white)`,
                              borderLeftColor: dim ? "var(--cp-slate-300)" : hue,
                            }}>
                            <p className="truncate text-[11px] font-bold text-gray-900">
                              {s.sessionName ?? s.suggestedName}
                            </p>
                            <p className="text-[10px] text-gray-600">
                              {toTime(s.startsMinute)} – {toTime(s.endsMinute)}
                            </p>
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
        <form onSubmit={save}
          className="rounded-xl border border-[var(--cp-primary)]/25 bg-white p-4 shadow-[0_2px_8px_rgba(15,23,42,0.06)]">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <span aria-hidden className="flex h-7 w-7 items-center justify-center rounded-lg bg-[var(--cp-primary)]/12 text-[14px] text-[var(--cp-primary-deep)]">✎</span>
            <h3 className="text-[14px] font-bold text-gray-900">
              {draft.templateId ? "Edit this session" : "New session"}
            </h3>
            <button type="button" onClick={() => setDraft(null)}
              className="ml-auto rounded-lg border border-gray-200 px-3 py-1.5 text-[12px] text-gray-600 hover:bg-gray-50">
              Close
            </button>
          </div>

          {/* ── Identity ─────────────────────────────────────────────────────────────────────── */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className={`${labelCls} sm:col-span-2`}>
              Session name
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
            </label>

            <label className={labelCls}>
              Day of week
              <select value={draft.weekday} onChange={e => set("weekday", Number(e.target.value))} className={field}>
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
          </div>

          {/* ── s4.3's recurrence dates -- WHY ENDING IS A DATE ─────────────────────────────────── */}
          <fieldset className="mt-4 rounded-lg border border-gray-200 p-3">
            <legend className="px-1 text-[10px] font-bold uppercase tracking-wide text-gray-500">
              When this pattern applies
            </legend>
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
                    const live = BOOKING_MODES_LIVE.includes(m.code);
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
                          {!live && (
                            <span className="mt-0.5 block text-[9.5px] font-semibold text-slate-400">
                              CPR-V5-007 Phase 4 — not built
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
