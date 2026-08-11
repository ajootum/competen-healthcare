"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  offlineControls, offlineListRow, offlineRecordDetail,
  type OfflinePatient, type OfflineReadResult,
} from "@/lib/practice/offline-projection";
import {
  offlineGuidanceControls, offlineGuidanceRow, offlineGuidanceReviewNote,
  OFFLINE_GUIDANCE_MAX_DAYS,
  type OfflineGuidanceDoc, type OfflineGuidanceReadResult,
} from "@/lib/practice/offline-guidance";
import { guidanceType } from "@/lib/practice/knowledge-constants";
import { OFFLINE_ENCRYPTION_NOTE } from "@/lib/practice/offline-crypto";
import { lastCachedWorkspace, loadOfflineDay, loadOfflineGuidance } from "@/lib/practice/offline-store";

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

export default function OfflineReader({ cacheKey }: { cacheKey?: CryptoKey | null }) {
  const [result, setResult] = useState<OfflineReadResult | null>(null);
  const [guidance, setGuidance] = useState<OfflineGuidanceReadResult | null>(null);
  const [opened, setOpened] = useState<string | null>(null);
  const [openedDoc, setOpenedDoc] = useState<string | null>(null);
  const [online, setOnline] = useState(true);

  const reread = useCallback(async () => {
    const workspaceId = await lastCachedWorkspace();
    if (!workspaceId) {
      setResult({ state: "none", purge: false, reason: "Nothing has been cached on this device yet." });
      setGuidance({ state: "none", purge: false, reason: "No practice guidance has been stored on this device yet." });
      return;
    }
    // ⚠ READ INDEPENDENTLY, AND THE DAY'S VERDICT NEVER DECIDES THE GUIDANCE'S. They expire on different
    // clocks -- the day at the end of the clinic day, the guidance after a week -- so an expired day must
    // still render a valid library. Reading them together and gating one on the other would throw away a
    // week of protocols every midnight.
    const now = new Date();
    // ⚠ THE UNWRAPPED DATA KEY, WHERE THIS TAB HAS ONE. With no PIN enrolled it is undefined and the
    // store falls back to the per-workspace key it generated, which is phase one behaviour unchanged.
    // ⚠ AND IT MUST BE IN THE DEPENDENCY LIST: without it the first read runs before the PIN is entered,
    // finds nothing openable, and never runs again -- the screen would sit empty behind a solved lock.
    setResult(await loadOfflineDay(workspaceId, now, cacheKey ?? undefined));
    setGuidance(await loadOfflineGuidance(workspaceId, now, cacheKey ?? undefined));
  }, [cacheKey]);

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
            {/* ⚠ A REFUSAL AND A FAULT ARE DIFFERENT SENTENCES, and until 2026-08-11 both produced the
                second one. Telling an administrator who is not a clinician that the list "could not be
                read" says the system is broken when nothing is; telling somebody with a real fault that
                they lack permission sends them to the wrong person. `todaysCohort` sets one flag for
                both, so the REASON travels with it. */}
            {result.day.patientsUnavailable ? (
              <p className="mt-1 text-[12px] text-gray-600">
                {result.day.patientsUnavailableReason === "refused"
                  ? "This account does not have access to the appointment list, so no patients are held on this device. That is a permission rather than a fault — nothing is missing that you were meant to see."
                  : "The appointment list could not be read in full when this was captured, so what is below may be incomplete. It is not a claim that nobody else is coming."}
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

      {/* ── PRACTICE GUIDANCE ─────────────────────────────────────────────────────────────────────
          ⚠ RENDERED OUTSIDE THE DAY'S BLOCK ON PURPOSE. A device whose clinic day has expired still
          holds a week of protocols, and the survey ranks a clinician who cannot look something up as a
          real loss: "in a setting with intermittent connectivity a clinician who cannot look something
          up simply does not look it up". Nesting this inside the day would delete that value nightly. */}
      <GuidanceSection
        guidance={guidance}
        opened={openedDoc}
        onToggle={id => setOpenedDoc(openedDoc === id ? null : id)}
      />

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
 * The cached guidance library.
 *
 * ⚠ IT NAMES NOBODY. Not a patient, not an author, not an approver — the projection drops all of them, so
 * there is nothing on this part of the screen that a bystander reading over a shoulder could use. That is
 * why it carries no equivalent of the list-row/detail split the patient list needs.
 *
 * ⚠ AND IT ACCEPTS NOTHING. The online version of this screen carries Edit, Send for approval, Publish
 * and Withdraw, over a rich-text body. Reusing that component here would put a box on the screen that
 * somebody could type a protocol revision into, believe they had updated the practice, and lose.
 */
function GuidanceSection(
  { guidance, opened, onToggle }:
  { guidance: OfflineGuidanceReadResult | null; opened: string | null; onToggle: (id: string) => void },
) {
  if (guidance === null) return null;

  if (guidance.state !== "ok")
    return (
      <section className="mt-6" aria-labelledby="off-guidance">
        <h2 id="off-guidance" className="text-[13px] font-bold text-gray-900">Practice guidance</h2>
        <p className="mt-1 text-[12px] leading-relaxed text-gray-600">{guidance.reason}</p>
      </section>
    );

  const { library, notice } = guidance;

  return (
    <section className="mt-6" aria-labelledby="off-guidance">
      <h2 id="off-guidance" className="text-[13px] font-bold text-gray-900">Practice guidance</h2>

      {/* The stamp, naming the hazard that actually applies to a protocol rather than a generic one. */}
      <div className={`mt-2 rounded-xl border px-4 py-3 ${TONE[notice.tone]}`} role="status">
        <p className="text-[13px] font-semibold">{notice.sentence}</p>
        <p className="mt-1 text-[12px] opacity-90">
          {library.documents.length} document{library.documents.length === 1 ? "" : "s"} held on this
          device. Guidance is removed after {OFFLINE_GUIDANCE_MAX_DAYS} days without reaching the practice.
        </p>
      </div>

      {/* ⚠ NO SILENT CAP. A reference library that quietly holds part of itself is worse than one that
          holds none: the practitioner searches, does not find, and concludes there is no protocol. */}
      {library.dropped && (
        <p className="mt-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-[12px] text-gray-700">
          {library.dropped.reason}
        </p>
      )}

      {library.documents.length === 0 ? (
        <p className="mt-2 text-[12px] text-gray-600">
          No guidance was in force at this practice when this was captured. That is what the practice
          library said — it is not a claim that this device failed to read it.
        </p>
      ) : (
        <ul className="mt-2 divide-y divide-gray-200 rounded-xl border border-gray-200 bg-white">
          {library.documents.map(doc => (
            <GuidanceRow
              key={doc.id} doc={doc} timezone={library.timezone}
              open={opened === doc.id} onToggle={() => onToggle(doc.id)}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function GuidanceRow(
  { doc, timezone, open, onToggle }:
  { doc: OfflineGuidanceDoc; timezone: string; open: boolean; onToggle: () => void },
) {
  // ⚠ `new Date()` AT RENDER, NOT AT CAPTURE. The review verdict has to be able to change while the
  // device is away — a document can pass its review date offline, and a verdict frozen into the record
  // would read "in date" for the rest of the week.
  const row = offlineGuidanceRow(doc, new Date(), timezone);
  const reviewNote = offlineGuidanceReviewNote(row);
  const controls = offlineGuidanceControls(doc);
  const readControl = controls.find(c => !c.mutating)!;
  const mutating = controls.filter(c => c.mutating);

  return (
    <li className="px-3 py-2">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="font-mono text-[11px] text-gray-500">{row.code}</span>
        <span className="text-[13px] font-semibold text-gray-900">{row.title}</span>
        <span className="text-[11.5px] text-gray-600">{guidanceType(row.docType)?.label ?? row.docType}</span>
        {row.specialty && <span className="text-[11.5px] text-gray-500">{row.specialty}</span>}
        {row.reviewOverdue && (
          <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10.5px] font-semibold text-amber-900">
            Past its review date
          </span>
        )}
        <button
          type="button" onClick={onToggle} aria-expanded={open}
          className="ml-auto rounded border border-gray-300 px-2 py-0.5 text-[11px] font-semibold text-gray-700"
        >
          {open ? "Close" : readControl.label}
        </button>
      </div>

      {row.summary && !open && (
        <p className="mt-1 text-[12px] leading-relaxed text-gray-600">{row.summary}</p>
      )}

      {open && (
        <div className="mt-2 rounded-lg bg-gray-50 px-3 py-2">
          <p className="text-[11px] text-gray-500">
            Version {doc.version}
            {doc.effectiveFrom ? ` · in force from ${doc.effectiveFrom}` : " · no effective date recorded"}
          </p>
          {reviewNote && (
            <p className="mt-1 text-[11.5px] leading-relaxed text-amber-900">{reviewNote}</p>
          )}

          {doc.sections.map(s => (
            <div key={s.key} className="mt-2">
              <h3 className="text-[12px] font-bold text-gray-900">{s.heading}</h3>
              {/* whitespace-pre-wrap: the bodies are authored prose with real paragraphing. */}
              <p className="mt-0.5 whitespace-pre-wrap text-[12px] leading-relaxed text-gray-800">{s.body}</p>
            </div>
          ))}

          <div className="mt-3 flex flex-wrap gap-2">
            {mutating.map(c => (
              <span key={c.key} className="inline-flex flex-col">
                {/* ⚠ DISABLED, NOT HIDDEN, AND NEVER AN INPUT — the same rule and the same data-driven
                    mechanism as the patient controls above. `enabled` comes from offline-guidance.ts,
                    where the harness asserts no mutating control is ever enabled. */}
                <button type="button" disabled={!c.enabled}
                  className="cursor-not-allowed rounded border border-gray-300 bg-gray-100 px-2 py-0.5 text-[11px] font-semibold text-gray-400">
                  {c.label}
                </button>
                <span className="mt-0.5 max-w-[16rem] text-[10.5px] leading-snug text-gray-500">{c.reason}</span>
              </span>
            ))}
          </div>
        </div>
      )}
    </li>
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
