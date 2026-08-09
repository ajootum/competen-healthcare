"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PATIENT_ACCESS_MODES } from "@/lib/practice/patient-access-constants";
import {
  PUBLISH_STATES, PUBLISH_STATE_SWATCH, PUBLISH_STATES_LIVE, PUBLISHABLE_CONSTRAINT,
} from "@/lib/practice/publish-constants";
import { SESSION_APPOINTMENT_TYPES, appointmentTypeLabel } from "@/lib/practice/practice-session-constants";

/* eslint-disable @typescript-eslint/no-explicit-any */

// ────────────────────────────────────────────────────────────────────────────────────────────────────
// CPR-V5-007 PHASE 6 -- s10.2's PUBLISH READINESS, AS A SCREEN.
//
// ⚠ THREE MARKS, NOT TWO. Pass, fail and NOT CHECKED, and the third is slate with a hollow ring -- never
// green, never a tick, never omitted. A checklist that quietly dropped the rows it could not perform
// would render a shorter, cleaner, wronger list, and nobody looking at it would know which questions had
// gone unasked. An unwarned screen reads as a cleared screen.
//
// ⚠ AND THE VERDICT IS THE SERVER'S. This component does not add up severities: `verdict`,
// `blockersFailing`, `blockersNotChecked` and `notChecked` all arrive computed, because a second copy of
// that arithmetic is a second thing to keep in step with the engine that actually refuses the write.
//
// ⚠ EVERY PROP IS JSON-SAFE. Nothing here receives a function, a Map or a Date -- the boundary that
// killed the Follow-ups board. The payload is walked by the harness rather than trusted.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

const card = "rounded-xl border border-gray-200 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]";

const VERDICT: Record<string, { label: string; blurb: string; box: string; text: string }> = {
  ready: {
    label: "Ready to publish", blurb: "Every check passed.",
    box: "border-emerald-200 bg-emerald-50/70", text: "text-emerald-800",
  },
  ready_with_warnings: {
    label: "Ready, with something outstanding",
    blurb: "Nothing is blocking, but at least one check did not pass or could not be performed. Publishing over it records that you accepted it.",
    box: "border-amber-200 bg-amber-50/70", text: "text-amber-900",
  },
  not_ready: {
    label: "Not ready", blurb: "At least one blocking check failed.",
    box: "border-rose-200 bg-rose-50/70", text: "text-rose-800",
  },
  cannot_say: {
    // ⚠ THE ONE THAT MUST NEVER READ AS A PASS.
    label: "Cannot say", blurb:
      "A blocking check could not be performed, so this screen does not know whether the page is ready. That is not the same as it being ready, and publishing is refused rather than guessed at.",
    box: "border-slate-300 bg-slate-50", text: "text-slate-700",
  },
};

export default function PublishWorkspace({ readiness, locations, mayPublish }: {
  readiness: any;
  locations: { id: string; name: string; active: boolean }[];
  mayPublish: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: "ok" | "bad"; text: string } | null>(null);
  const [open, setOpen] = useState(false);

  const p = readiness.profile;
  const [draft, setDraft] = useState({
    mode: p?.mode ?? "internal_only",
    otpRequired: p?.otpRequired ?? true,
    guestBookingAllowed: p?.guestBookingAllowed ?? true,
    existingPatientMatching: p?.existingPatientMatching ?? false,
    consentRequired: p?.consentRequired ?? true,
    // ⚠ FALSE WHEN UNSET, ALWAYS. SessionWorkspace's blankDraft makes the same point about bookability:
    // never default a control to the open position. A practice turns this on deliberately or not at all.
    unverifiedRequestsAllowed: p?.unverifiedRequestsAllowed === true,
    brandDisplayName: p?.brandDisplayName ?? "",
    instructions: p?.instructions ?? "",
    visibleLocationIds: (p?.visibleLocationIds ?? []) as string[],
    visibleAppointmentTypes: (p?.visibleAppointmentTypes ?? []) as string[],
  });

  async function send(method: "POST" | "PATCH", body: any) {
    setBusy(true); setNotice(null);
    const res = await fetch("/api/v1/practice/booking-access", {
      method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (res.ok) { setNotice({ kind: "ok", text: "Saved." }); router.refresh(); }
    // ⚠ THE SERVER'S SENTENCE, NOT A REWRITE OF IT. When the database refuses a publish, the message
    // names the constraint, and a screen that replaced it with "something went wrong" would throw away
    // the only part of the answer that says what to do.
    else setNotice({ kind: "bad", text: data.error ?? `Refused (${res.status}).` });
    return res.ok;
  }

  const toggle = (list: string[], v: string) =>
    list.includes(v) ? list.filter(x => x !== v) : [...list, v];

  const verdict = VERDICT[readiness.verdict] ?? VERDICT.cannot_say;
  const live = PUBLISH_STATES_LIVE.includes(p?.publishState ?? "");

  return (
    <section className={card}>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span aria-hidden className="flex h-7 w-7 items-center justify-center rounded-lg bg-violet-100 text-[14px] text-violet-700">◈</span>
        <div className="min-w-0">
          <h3 className="text-[14px] font-bold text-gray-900">Preview &amp; publish</h3>
          <p className="text-[11px] text-gray-500">
            s10.2&apos;s publish checks, run against this practice. {readiness.checks.length} of them.
          </p>
        </div>
        <span className="ml-auto rounded-lg bg-gray-100 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-gray-600">
          {readiness.publishStateLabel}
        </span>
      </div>

      {/* ── THE VERDICT, FROM THE SERVER ──────────────────────────────────────────────────────── */}
      <div className={`rounded-lg border p-3 ${verdict.box}`}>
        <p className={`text-[12.5px] font-bold ${verdict.text}`}>{verdict.label}</p>
        <p className={`mt-0.5 text-[11px] leading-relaxed ${verdict.text}/90`}>{verdict.blurb}</p>
        <p className="mt-1.5 text-[10.5px] leading-relaxed text-gray-600">
          <span className="font-bold">{readiness.blockersFailing.length}</span> blocking check
          {readiness.blockersFailing.length === 1 ? "" : "s"} failed ·{" "}
          <span className="font-bold">{readiness.notChecked.length}</span> could not be checked ·{" "}
          <span className="font-bold">{readiness.warningsFailing.length}</span> warning
          {readiness.warningsFailing.length === 1 ? "" : "s"}
        </p>
      </div>

      {readiness.profileUnreadable && (
        <p className="mt-2 rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-[11px] leading-relaxed text-slate-600">
          <span className="font-bold">Your booking page could not be read.</span>{" "}
          {readiness.profileUnreadable} That is not the same as not having one, and every row below that
          depended on it says so rather than guessing.
        </p>
      )}

      {/* ── THE CHECKLIST ─────────────────────────────────────────────────────────────────────── */}
      <ul className="mt-3 space-y-1.5">
        {readiness.checks.map((c: any) => {
          const sw = PUBLISH_STATE_SWATCH[c.state];
          return (
            <li key={c.code} className={`rounded-lg border px-3 py-2 ${sw.box}`}>
              <div className="flex flex-wrap items-baseline gap-1.5">
                <span aria-hidden className={`flex h-4 w-4 shrink-0 items-center justify-center rounded text-[10px] ${sw.badge}`}>
                  {sw.icon}
                </span>
                <p className="text-[12px] font-semibold text-gray-900">{c.requirement}</p>
                <span className={`rounded px-1 py-px text-[9px] font-bold uppercase tracking-wide ${sw.badge}`}>
                  {c.state === "not_checked" ? "not checked" : c.state}
                </span>
                <span className="rounded bg-white/70 px-1 py-px text-[9px] font-semibold uppercase tracking-wide text-gray-500 ring-1 ring-black/5">
                  {c.severity}
                </span>
                {c.authority === "database" && (
                  <span className="rounded bg-white/70 px-1 py-px text-[9px] font-semibold text-gray-500 ring-1 ring-black/5"
                    title={`Enforced by ${PUBLISHABLE_CONSTRAINT}. This screen reports it; the database decides it.`}>
                    the database decides this
                  </span>
                )}
                {c.found !== null && (
                  <span className="ml-auto text-[10.5px] font-bold text-gray-700">
                    {c.found}{c.of !== null ? ` of ${c.of}` : ""}
                  </span>
                )}
              </div>
              {(c.state !== "pass") && (
                <p className={`mt-1 text-[10.5px] leading-relaxed ${sw.text}`}>
                  {c.because ?? c.detail}
                </p>
              )}
              {c.wouldNeed && (
                <p className="mt-1 text-[10px] leading-relaxed text-slate-500">
                  <span className="font-bold">To check it:</span> {c.wouldNeed}
                </p>
              )}
            </li>
          );
        })}
      </ul>

      {/* ── s8.1's ACCESS CONFIGURATION. Only the fields that have a column. ───────────────────── */}
      <div className="mt-3 border-t border-gray-100 pt-3">
        <button type="button" onClick={() => setOpen(o => !o)}
          className="text-[11.5px] font-semibold text-[var(--cp-primary)] hover:underline">
          {open ? "Hide booking page settings" : "Booking page settings →"}
        </button>

        {open && (
          <div className="mt-2.5 space-y-3">
            {!mayPublish && (
              <p className="rounded-lg border border-amber-200 bg-amber-50/70 px-3 py-2 text-[11px] text-amber-900">
                You may read this. Changing it needs the permission that governs what this practice
                exposes to the outside, and you do not hold it — so the controls below are disabled
                rather than failing when you press them.
              </p>
            )}

            <div className="grid gap-2.5 sm:grid-cols-2">
              <label className="flex flex-col text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                Who may reach the page
                <select value={draft.mode} disabled={!mayPublish}
                  onChange={e => setDraft(d => ({ ...d, mode: e.target.value }))}
                  className="mt-0.5 rounded-lg border border-gray-200 px-2.5 py-1.5 text-[12px] text-gray-800">
                  {PATIENT_ACCESS_MODES.map(m => (
                    <option key={m.code} value={m.code}>
                      {m.label}{m.reachable ? "" : " — nothing behind it yet"}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                What the page calls this practice
                <input value={draft.brandDisplayName} disabled={!mayPublish}
                  onChange={e => setDraft(d => ({ ...d, brandDisplayName: e.target.value }))}
                  placeholder="Left blank, the page has no name"
                  className="mt-0.5 rounded-lg border border-gray-200 px-2.5 py-1.5 text-[12px] text-gray-800" />
              </label>
            </div>

            <div className="flex flex-wrap gap-3 text-[11.5px] text-gray-700">
              {([
                ["otpRequired", "Require a one-time code"],
                ["guestBookingAllowed", "Allow booking without an account"],
                ["existingPatientMatching", "Match against existing patients"],
                ["consentRequired", "Require the consent tick"],
              ] as const).map(([k, label]) => (
                <label key={k} className="flex items-center gap-1.5">
                  <input type="checkbox" checked={(draft as any)[k]} disabled={!mayPublish}
                    onChange={e => setDraft(d => ({ ...d, [k]: e.target.checked }))} />
                  {label}
                </label>
              ))}
            </div>

            {/* ── MIGRATION 272: THE UNVERIFIED REQUEST ────────────────────────────────────────
                ⚠ NOT A TICK BOX IN THE ROW ABOVE, AND THAT IS DELIBERATE. It is the only setting on this
                screen that lets somebody who has proved nothing write a row at this practice, so it is
                drawn with the consequence beside it rather than as a fifth checkbox somebody skims. */}
            <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-3">
              <label className="flex items-start gap-2 text-[12px] font-semibold text-amber-950">
                <input type="checkbox" className="mt-0.5"
                  checked={draft.unverifiedRequestsAllowed}
                  disabled={!mayPublish || p?.unverifiedRequestsAllowed === null}
                  onChange={e => setDraft(d => ({ ...d, unverifiedRequestsAllowed: e.target.checked }))} />
                Accept a request from somebody who has not entered a code
              </label>
              <p className="mt-1.5 text-[11px] leading-relaxed text-amber-900">
                Booking still needs a code, and this does not change that. This is a second, smaller
                thing: a message asking for a time. It does <span className="font-bold">not</span> become
                an appointment, it does <span className="font-bold">not</span> hold the time, and two
                people may ask for the same one. What arrives is a name, a number and a reason that
                nobody has checked &mdash; every request is permanently marked as unverified, and you
                answer it yourself.
              </p>
              <p className="mt-1 text-[11px] leading-relaxed text-amber-900">
                Turn it on if you have no way to send a code and would rather take messages than nothing.
                Requests appear under <span className="font-semibold">Booking requests</span>.
              </p>
              {/* ⚠ THE ABSENCE IS DRAWN AS AN ABSENCE. A switch that cannot move because the column is
                  not there must say so, not sit greyed out looking like a choice somebody made. */}
              {p?.unverifiedRequestsAllowed === null && (
                <p className="mt-1.5 rounded border border-slate-300 bg-white/70 px-2 py-1.5 text-[10.5px] leading-relaxed text-slate-700">
                  This setting is not available on this deployment yet &mdash; the column it lives in has
                  not been created. Nothing here is off because you chose it.
                </p>
              )}
              {p?.unverifiedRequestsAllowedAt && (
                <p className="mt-1.5 text-[10.5px] text-amber-900/80">
                  Open since {new Date(p.unverifiedRequestsAllowedAt).toLocaleDateString()}.
                </p>
              )}
            </div>

            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                Locations a patient may see
              </p>
              <p className="text-[10px] leading-relaxed text-gray-500">
                Empty means none is visible, not all of them. Each id is checked against this practice
                before it is written — the column is an array, so the database cannot check it itself.
              </p>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {locations.length === 0 && <span className="text-[11px] text-gray-500">No location yet.</span>}
                {locations.map(l => (
                  <button key={l.id} type="button" disabled={!mayPublish}
                    onClick={() => setDraft(d => ({ ...d, visibleLocationIds: toggle(d.visibleLocationIds, l.id) }))}
                    className={`rounded-lg px-2 py-1 text-[11px] font-semibold ${
                      draft.visibleLocationIds.includes(l.id)
                        ? "bg-[var(--cp-primary)]/12 text-[var(--cp-primary-deep)] ring-1 ring-[var(--cp-primary)]/30"
                        : "bg-gray-100 text-gray-600"}`}>
                    {l.name}{l.active ? "" : " (closed)"}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                Appointment types a patient may choose
              </p>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {SESSION_APPOINTMENT_TYPES.map(([code]) => (
                  <button key={code} type="button" disabled={!mayPublish}
                    onClick={() => setDraft(d => ({ ...d, visibleAppointmentTypes: toggle(d.visibleAppointmentTypes, code) }))}
                    className={`rounded-lg px-2 py-1 text-[11px] font-semibold ${
                      draft.visibleAppointmentTypes.includes(code)
                        ? "bg-[var(--cp-primary)]/12 text-[var(--cp-primary-deep)] ring-1 ring-[var(--cp-primary)]/30"
                        : "bg-gray-100 text-gray-600"}`}>
                    {appointmentTypeLabel(code)}
                  </button>
                ))}
              </div>
            </div>

            <label className="flex flex-col text-[10px] font-semibold uppercase tracking-wide text-gray-500">
              What the page tells a patient before they start
              <textarea rows={3} value={draft.instructions} disabled={!mayPublish}
                onChange={e => setDraft(d => ({ ...d, instructions: e.target.value }))}
                className="mt-0.5 rounded-lg border border-gray-200 px-2.5 py-1.5 text-[12px] text-gray-800" />
            </label>

            <div className="flex flex-wrap items-center gap-2">
              <button type="button" disabled={busy || !mayPublish}
                onClick={() => send("POST", draft)}
                className="rounded-lg bg-[var(--cp-primary)] px-3.5 py-2 text-[12px] font-semibold text-white disabled:opacity-50">
                {busy ? "Saving…" : "Save booking page settings"}
              </button>

              {/* ⚠ PUBLISHING IS ITS OWN ACT, and it is only offered when there is a row to publish.
                  A button that would always be refused is a control that does nothing. */}
              {p && (
                <>
                  <button type="button" disabled={busy || !mayPublish}
                    onClick={() => send("PATCH", { to: "published", acceptWarnings: readiness.verdict === "ready_with_warnings" })}
                    className="rounded-lg border border-gray-200 bg-white px-3.5 py-2 text-[12px] font-semibold text-gray-700 disabled:opacity-50">
                    Publish
                  </button>
                  <button type="button" disabled={busy || !mayPublish}
                    onClick={() => send("PATCH", { to: live ? "paused" : "ready" })}
                    className="rounded-lg border border-gray-200 bg-white px-3.5 py-2 text-[12px] font-semibold text-gray-700 disabled:opacity-50">
                    {live ? "Pause the page" : "Mark ready"}
                  </button>
                </>
              )}
            </div>

            {!p && (
              <p className="text-[11px] leading-relaxed text-gray-500">
                There is nothing to publish yet. Saving the settings above creates the booking page in
                draft; publishing is a separate press afterwards.
              </p>
            )}

            {notice && (
              <p className={`rounded-lg px-3 py-2 text-[11.5px] leading-relaxed ${
                notice.kind === "ok" ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-rose-800"}`}>
                {notice.text}
              </p>
            )}

            <p className="border-t border-gray-100 pt-2 text-[10px] leading-relaxed text-gray-500">
              The states are:{" "}
              {PUBLISH_STATES.map(s => `${s.label} — ${s.meaning}`).join(" ")}
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
