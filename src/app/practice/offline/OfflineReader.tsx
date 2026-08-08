"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  offlineControls, offlineListRow, offlineRecordDetail,
  type OfflinePatient, type OfflineReadResult,
} from "@/lib/practice/offline-projection";
import { OFFLINE_ENCRYPTION_NOTE } from "@/lib/practice/offline-crypto";
import { lastCachedWorkspace, loadOfflineDay } from "@/lib/practice/offline-store";

// CP-OFFLINE-SURVEY-001 s3.4 — the cached clinic day, and its age, on one screen.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// ⚠ NOTHING THAT WOULD READ AS A CURRENT CLINICAL FACT IS RENDERED WITHOUT ITS AGE.
//
// The banner is not decoration and it is not a follow-up. s3.8.3: the freshness indicator, the escalating
// age treatment and the hard expiry ship in the same change as the cache, or the cache does not ship. A
// cached schedule shown at 16:00 with no indication that it was captured at 08:14 is worse than an empty
// screen, because a practitioner may act on an appointment cancelled two hours ago.
//
// ── FOUR THINGS THIS SCREEN REFUSES TO DO ───────────────────────────────────────────────────────────
//
//   1. It shows NO WAITING QUEUE. "3 waiting" is a claim about NOW, and it is the most staleness-prone
//      thing in the payload. The queue is not cached at all (offline-projection.ts drops its feeder), so
//      there is nothing here that could accidentally render it.
//   2. It shows NO METRICS. Twelve management figures with no value to a practitioner mid-clinic, and a
//      large free reduction in what a lost device discloses.
//   3. It shows NO CLINICAL SERVICE LABEL IN THE LIST. The visit kind is on the record and appears only
//      when one patient is opened deliberately -- s3.8.7: the clinic context supplies the *who* for free,
//      so a service label beside a name on a waiting-room screen is more disclosive than the name.
//   4. It ACCEPTS NOTHING. Every control that would change a record is rendered disabled with a reason.
//      There is no form, no input, no draft, no queue and no "sync now".
//
// ⚠ AND WHEN THE DAY HAS EXPIRED IT RENDERS NOTHING AT ALL except why. s3.4.3: an empty screen with a
// reason is safe; a stale screen is not.

/** Re-evaluated on a timer so the label escalates, and so expiry fires, while the page is left open. */
const RECHECK_MS = 60_000;

const TONE: Record<"amber" | "orange" | "red", string> = {
  amber: "border-amber-300 bg-amber-50 text-amber-900",
  orange: "border-orange-400 bg-orange-50 text-orange-900",
  red: "border-red-500 bg-red-50 text-red-900",
};

const STATUS_LABEL: Record<string, string> = {
  REQUESTED: "Requested", CONFIRMED: "Booked", ARRIVED: "Arrived",
  NO_SHOW: "Did not attend", COMPLETED: "Seen",
};

const VISIT_KIND_LABEL: Record<string, string> = {
  new_consultation: "First consultation", scheduled_followup: "Scheduled follow-up",
  walk_in: "Walk-in", emergency: "Emergency", hospital_consultation: "Hospital consultation",
  teleconsultation: "Teleconsultation", home_visit: "Home visit",
};

const SESSION_STATE_LABEL: Record<string, string> = {
  planned: "Planned", running: "Was running at capture", done: "Finished",
};

export default function OfflineReader() {
  const [result, setResult] = useState<OfflineReadResult | null>(null);
  const [opened, setOpened] = useState<string | null>(null);
  const [online, setOnline] = useState(true);

  const reread = useCallback(async () => {
    const workspaceId = await lastCachedWorkspace();
    if (!workspaceId) {
      setResult({ state: "none", purge: false, reason: "Nothing has been cached on this device yet." });
      return;
    }
    setResult(await loadOfflineDay(workspaceId, new Date()));
  }, []);

  useEffect(() => {
    // Deferred by a tick rather than called in the effect body: a setState during the same commit
    // cascades a second render before the first has painted. Both of these are that case.
    queueMicrotask(() => { void reread(); setOnline(navigator.onLine); });
    const t = setInterval(() => { void reread(); }, RECHECK_MS);
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => { clearInterval(t); window.removeEventListener("online", up); window.removeEventListener("offline", down); };
  }, [reread]);

  return (
    <div>
      <h1 className="text-xl font-bold text-gray-900">Today, from this device</h1>

      {result === null && (
        <p className="mt-3 text-[13px] text-gray-500">Reading what is stored on this device…</p>
      )}

      {/* ⚠ THREE STATES, AND "nothing stored" IS NOT "nothing on today". */}
      {result && result.state !== "ok" && (
        <div className="mt-4 rounded-xl border border-gray-300 bg-gray-50 px-4 py-3">
          <p className="text-[13px] font-semibold text-gray-900">Today&rsquo;s list is not shown</p>
          <p className="mt-1 text-[12.5px] leading-relaxed text-gray-700">{result.reason}</p>
          <p className="mt-2 text-[12px] text-gray-600">
            This is not a claim that your day is empty. It is a claim that this device cannot say what your
            day is.
          </p>
        </div>
      )}

      {result && result.state === "ok" && (
        <>
          {/* ── THE STAMP. Absolute, local, in the content area, escalating with age. ─────────── */}
          <div className={`mt-4 rounded-xl border px-4 py-3 ${TONE[result.freshness.tone]}`} role="status">
            <p className="text-[13px] font-semibold">{result.freshness.sentence}</p>
            <p className="mt-1 text-[12px] opacity-90">
              {result.day.date} · {result.day.timezone} · captured {result.freshness.minutes} minute
              {result.freshness.minutes === 1 ? "" : "s"} ago. This list is removed from the device at the
              end of this clinic day, whether or not it reconnects.
            </p>
          </div>

          {/* Per-card honesty, captured at cache time (s3.4.5). */}
          {Object.entries(result.day.feeders).some(([, s]) => s === "unavailable") && (
            <p className="mt-3 rounded-lg border border-gray-300 bg-white px-3 py-2 text-[12px] text-gray-700">
              Some parts of the day could not be read when this was captured
              ({Object.entries(result.day.feeders).filter(([, s]) => s === "unavailable").map(([k]) => k).join(", ")}),
              so they are missing here rather than empty.
            </p>
          )}

          {/* ── THE PRACTITIONER'S OWN BLOCKS. Care setting and times; no session title. ──────── */}
          <section className="mt-4" aria-labelledby="off-sessions">
            <h2 id="off-sessions" className="text-[13px] font-bold text-gray-900">Your day</h2>
            {result.day.sessionsUnavailable ? (
              <p className="mt-1 text-[12px] text-gray-600">Your planned sessions could not be read when this was captured.</p>
            ) : result.day.sessions.length === 0 ? (
              <p className="mt-1 text-[12px] text-gray-600">Nothing was planned for this day when it was captured.</p>
            ) : (
              <ul className="mt-1 space-y-0.5">
                {result.day.sessions.map(s => (
                  <li key={s.id} className="flex items-center gap-2 text-[12.5px] text-gray-800">
                    <span className="w-24 shrink-0 tabular-nums text-gray-500">{s.startLabel}–{s.endLabel}</span>
                    <span className="font-medium">{s.kindLabel}</span>
                    <span className="text-[11px] text-gray-500">{SESSION_STATE_LABEL[s.state] ?? s.state}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* ── THE LIST. Time, name, identifier, age, status. NOTHING ELSE. ─────────────────── */}
          <section className="mt-5" aria-labelledby="off-patients">
            <h2 id="off-patients" className="text-[13px] font-bold text-gray-900">Who was expected</h2>
            {result.day.patientsUnavailable ? (
              <p className="mt-1 text-[12px] text-gray-600">
                The appointment list could not be read in full when this was captured, so what is below may
                be incomplete. It is not a claim that nobody else is coming.
              </p>
            ) : null}
            {result.day.patients.length === 0 ? (
              <p className="mt-1 text-[12px] text-gray-600">
                No appointments were on this day when it was captured.
              </p>
            ) : (
              <ul className="mt-1 divide-y divide-gray-200 rounded-xl border border-gray-200 bg-white">
                {result.day.patients.map(p => (
                  <PatientRow
                    key={p.id} patient={p}
                    open={opened === p.id}
                    onToggle={() => setOpened(opened === p.id ? null : p.id)}
                  />
                ))}
              </ul>
            )}
          </section>

          <p className="mt-4 text-[11px] leading-relaxed text-gray-500">
            Nothing on this screen can be changed while the device is offline. Nothing typed here could be
            delivered to the practice, so nothing is accepted — there is no draft, no queue and nothing
            waiting to be sent.
          </p>
          <p className="mt-2 text-[11px] leading-relaxed text-gray-500">{OFFLINE_ENCRYPTION_NOTE}</p>
        </>
      )}

      {/* A plain link, not an action. It navigates; it changes nothing. */}
      <p className="mt-5 text-[12px]">
        {online
          // prefetch={false}: this page exists because the network is unreliable, and a prefetch fired
          // from it would be a request nobody asked for at the worst possible moment.
          ? <Link prefetch={false} className="font-semibold text-[var(--cp-primary)] underline" href="/practice/today">This device is online again — open the live list →</Link>
          : <span className="text-gray-500">This device has no connection. It will keep checking on its own; there is nothing to send.</span>}
      </p>
    </div>
  );
}

/**
 * One row.
 *
 * ⚠ THE LIST CELL IS BUILT FROM `offlineListRow`, WHICH CANNOT RETURN THE VISIT KIND. The detail panel
 * below it is built from `offlineRecordDetail`, which can. That separation is the control -- not a
 * conditional on one object -- so that showing the kind in the list would take a deliberate change to a
 * function's return type rather than a flipped boolean.
 */
function PatientRow(
  { patient, open, onToggle }: { patient: OfflinePatient; open: boolean; onToggle: () => void },
) {
  const row = offlineListRow(patient);
  const detail = offlineRecordDetail(patient);
  const controls = offlineControls(patient);
  const openControl = controls.find(c => !c.mutating)!;
  const mutating = controls.filter(c => c.mutating);

  return (
    <li className="px-3 py-2">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="w-12 shrink-0 text-[12px] tabular-nums text-gray-500">{row.timeLabel}</span>
        <span className="text-[13px] font-semibold text-gray-900">{row.name}</span>
        {row.identifierValue && <span className="font-mono text-[11px] text-gray-500">{row.identifierValue}</span>}
        <span className="text-[11.5px] text-gray-600">
          {row.ageYears === null ? "age not recorded" : `${row.ageYears}y`}
        </span>
        <span className="text-[11.5px] text-gray-600">{STATUS_LABEL[row.status] ?? row.status}</span>
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          className="ml-auto rounded border border-gray-300 px-2 py-0.5 text-[11px] font-semibold text-gray-700"
        >
          {open ? "Hide" : openControl.label}
        </button>
      </div>

      {open && (
        <div className="mt-2 rounded-lg bg-gray-50 px-3 py-2">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-[12px]">
            <dt className="text-gray-500">Visit</dt>
            <dd className="text-gray-900">{VISIT_KIND_LABEL[detail.visitKind] ?? detail.visitKind}</dd>
            <dt className="text-gray-500">Length</dt>
            <dd className="text-gray-900">{detail.durationMinutes === null ? "not recorded" : `${detail.durationMinutes} min`}</dd>
            <dt className="text-gray-500">Identifier</dt>
            <dd className="text-gray-900">
              {detail.identifierValue ? `${detail.identifierValue} (${detail.identifierType})` : "none recorded"}
            </dd>
          </dl>
          <div className="mt-2 flex flex-wrap gap-2">
            {mutating.map(c => (
              <span key={c.key} className="inline-flex flex-col">
                {/* ⚠ DISABLED, NOT HIDDEN, AND NEVER AN INPUT. `disabled` comes from the control data, so
                    enabling one would mean changing offline-projection.ts -- where the harness asserts
                    that a mutating control is never enabled. */}
                <button type="button" disabled={!c.enabled}
                  className="cursor-not-allowed rounded border border-gray-300 bg-gray-100 px-2 py-0.5 text-[11px] font-semibold text-gray-400">
                  {c.label}
                </button>
                <span className="mt-0.5 max-w-[16rem] text-[10.5px] leading-snug text-gray-500">{c.reason}</span>
              </span>
            ))}
          </div>
          <p className="mt-2 text-[10.5px] text-gray-500">
            Allergies, current medicines and diagnoses are not held on this device. They are not missing
            from the record — they are deliberately not stored here, because a stale one is a medication
            error.
          </p>
        </div>
      )}
    </li>
  );
}
