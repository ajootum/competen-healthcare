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
import {
  lookupOfflineClinical, offlineAllergySentence, offlineBloodGroupSentence, offlineMedicationSentence,
  OFFLINE_CLINICAL_MAX_DAYS,
  type OfflineClinicalPack, type OfflineClinicalReadResult,
} from "@/lib/practice/offline-clinical";
import type { SafetyLine } from "@/lib/practice/longitudinal-constants";
import { guidanceType } from "@/lib/practice/knowledge-constants";
import { OFFLINE_ENCRYPTION_NOTE } from "@/lib/practice/offline-crypto";
import {
  cachedBillingCapture, cachedIdentity, cachedOfflineParameters, lastCachedWorkspace, loadOfflineClinical, loadOfflineDay,
  loadOfflineGuidance, type DeviceIdentity,
} from "@/lib/practice/offline-store";
import {
  offlinePlausibility, type OfflineParametersReadResult,
} from "@/lib/practice/offline-parameters";
import { captureMeasurement, captureEncounter, captureFollowUp, captureCollection, CAPTURE_HELD_NOTE } from "@/lib/practice/offline-capture";
import { FOLLOW_UP_CATEGORIES, FOLLOW_UP_PRIORITIES } from "@/lib/practice/follow-up-constants";
import { PAYMENT_METHODS, CURRENCY_EXPONENT, formatMinor } from "@/lib/practice/billing-constants";
import { TimeInput } from "@/components/ui/wall-clock";
import { HHMM_RE, instantInZone, practiceToday, wallClockInZone } from "@/lib/practice/practice-time";

/**
 * Now, as a wall-clock date and 24-hour time in the PRACTICE's timezone.
 *
 * ⚠ THIS REPLACED THREE COPIES OF A HELPER THAT READ THE DEVICE'S CLOCK (`now.getHours()`), one inside
 * each capture form. On a device sitting in the practice that is the same answer; on one that has
 * travelled, or whose clock zone was never set, it is not -- and the value it prefills is the moment a
 * clinical observation gets filed at. The practice's zone travels with the day pack, so this is
 * answerable with no network, which is the whole reason it is done here rather than deferred to sync.
 *
 * ⚠ Called from the OPEN handler rather than an effect: a setState in an effect body is a cascading
 * render the lint rule rejects, and the value is genuinely a consequence of the click.
 */
function nowInPractice(timezone: string, offsetMinutes = 0): { date: string; time: string } {
  const at = new Date(Date.now() + offsetMinutes * 60_000);
  return { date: practiceToday(timezone, at), time: wallClockInZone(timezone, at) };
}

/**
 * The composed instant for a capture form, or a REFUSAL SENTENCE naming what is wrong.
 *
 * ⚠ A text time field does not guarantee what type="time" guaranteed -- the browser no longer enforces
 * HH:MM -- and these forms save from an onClick handler, so `pattern` blocks nothing. The check is made
 * here, from the single definition, and a bad value is refused rather than composed into a wrong
 * moment. Offline this matters more than anywhere: there is no server about to disagree.
 */
function composeCapture(date: string, time: string, timezone: string): { at: string } | { problem: string } {
  if (!date.trim() || !time.trim()) return { problem: "Enter the date and the time this was taken." };
  if (!HHMM_RE.test(time.trim()))
    return { problem: "Enter the time on the 24-hour clock, as HH:MM -- for example 09:00 or 14:30." };
  const at = instantInZone(date.trim(), time.trim(), timezone);
  if (!at) return { problem: `That date and time could not be read as a moment in ${timezone || "this practice's timezone"}.` };
  return { at };
}

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
  const [clinical, setClinical] = useState<OfflineClinicalReadResult | null>(null);
  /** Held so a capture can name the workspace it belongs to. Opaque uuid, nothing else. */
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [opened, setOpened] = useState<string | null>(null);
  const [openedDoc, setOpenedDoc] = useState<string | null>(null);
  const [online, setOnline] = useState(true);

  const reread = useCallback(async () => {
    const workspaceId = await lastCachedWorkspace();
    setWorkspaceId(workspaceId ?? null);
    if (!workspaceId) {
      setResult({ state: "none", purge: false, reason: "Nothing has been cached on this device yet." });
      setGuidance({ state: "none", purge: false, reason: "No practice guidance has been stored on this device yet." });
      setClinical({ state: "none", purge: false, reason: "No clinical records have been stored on this device yet." });
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
    // ⚠ INDEPENDENT AGAIN, AND ON ITS OWN FIVE-DAY CLOCK. An expired day must not take the clinical pack
    // with it: the pack is what makes a patient in front of you safe to prescribe for, and it is valid
    // for days after the schedule that named them stopped being true.
    setClinical(await loadOfflineClinical(workspaceId, now, cacheKey ?? undefined));
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

            {/* ⚠ THE CLINICAL STAMP SITS WITH THE LIST IT DESCRIBES, NOT AT THE TOP OF THE PAGE.
                It ages on a different clock from the day above it, and the hazard it names is a
                different hazard -- a medicine stopped since capture, not an appointment moved. A single
                merged banner would have to pick one of those sentences and would be wrong about the
                other. */}
            <ClinicalStamp clinical={clinical} />

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
                    // ⚠ THE PACK, NOT A LOOKED-UP RECORD. The lookup happens inside the row, behind the
                    // "open" toggle, so a rendered list never touches the clinical data at all.
                    clinicalPack={clinical?.state === "ok" ? clinical.pack : null}
                    workspaceId={workspaceId}
                    timezone={result.day.timezone}
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
  { patient, clinicalPack, workspaceId, timezone, open, onToggle }:
  {
    patient: OfflinePatient; clinicalPack: OfflineClinicalPack | null;
    workspaceId: string | null;
    /**
     * ⚠ THE PRACTICE'S TIMEZONE, CARRIED IN THE DAY PACK -- and the reason it has to be threaded this
     * far down is that the capture forms compose instants. `new Date("2026-08-18T14:30")` reads an
     * offsetless string in the DEVICE's zone, which is the one zone that is not evidence of anything:
     * a phone that has travelled, or was never set, files a clinical observation at a moment nobody
     * chose. The pack knows where the practice is, so the device can compose correctly even with no
     * network -- which is the whole point of composing here rather than deferring it to sync.
     */
    timezone: string;
    open: boolean; onToggle: () => void;
  },
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
          {/* ⚠ THE SENTENCE THAT USED TO SIT HERE SAID "Allergies, current medicines and diagnoses are
              not held on this device... they are deliberately not stored here". It was true when it was
              written and became FALSE in the same change that shipped the clinical carry. Removing it in
              that change rather than later is the whole of the "every user-facing sentence must be true
              today" rule -- a stale reassurance about what is NOT stored is as dangerous as a stale
              clinical fact, because it tells a practitioner not to bother looking. */}
          <ClinicalPanel pack={clinicalPack} patientId={detail.patientId} />

          {/* ⚠ THE ONLY ENABLED WRITES ON THIS SCREEN, and they sit BELOW the clinical panel on purpose:
              allergies and current medication are what a reading -- or a whole visit -- should be
              recorded in the light of. */}
          <CaptureReading
            workspaceId={workspaceId} patientId={detail.patientId} patientName={row.name}
            timezone={timezone}
          />
          <CaptureVisit
            workspaceId={workspaceId} patientId={detail.patientId} patientName={row.name}
            timezone={timezone}
          />
          <CaptureFollowUp
            workspaceId={workspaceId} patientId={detail.patientId} patientName={row.name}
          />
          <CaptureCollection
            workspaceId={workspaceId} patientId={detail.patientId} patientName={row.name}
            timezone={timezone}
          />
        </div>
      )}
    </li>
  );
}

/**
 * ⚠⚠ THE ONE PLACE IN THIS PRODUCT THAT ACCEPTS A CLINICAL WRITE WITH NO CONNECTION.
 *
 * It may exist because all seven of CP-OFFLINE-SURVEY-001 s5's preconditions hold -- they are listed,
 * with what proves each, at the top of offline-capture.ts. If one is ever weakened this component is what
 * has to be withdrawn.
 *
 * ── THE SENTENCES, WHICH ARE THE PART MOST LIKELY TO GO WRONG ───────────────────────────────────────
 *
 * ⚠ NOTHING HERE SAYS "SAVED", "SENT" OR "SYNCED". Nothing has left the device. The only true statement
 * is CAPTURE_HELD_NOTE's -- held here, filed when there is a connection, kept until that is confirmed.
 * s5: the line is crossed by the ACCEPTANCE, so a screen that announces success optimistically has
 * crossed it whatever the store did.
 *
 * ⚠ AND THE BUTTON SAYS SO TOO. "Save" would be the wrong verb before anything is saved anywhere.
 */
function CaptureReading(
  { workspaceId, patientId, patientName, timezone }:
  { workspaceId: string | null; patientId: string | null; patientName: string; timezone: string },
) {
  const [params, setParams] = useState<OfflineParametersReadResult | null>(null);
  const [identity, setIdentity] = useState<DeviceIdentity | null>(null);
  const [open, setOpen] = useState(false);
  const [definitionId, setDefinitionId] = useState("");
  const [value, setValue] = useState("");
  const [unit, setUnit] = useState("");
  const [takenDate, setTakenDate] = useState("");
  const [takenTime, setTakenTime] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [held, setHeld] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    void cachedOfflineParameters().then(setParams);
    void cachedIdentity().then(setIdentity);
  }, [open]);

  /**
   * (The local-clock prefill helper that sat here is now `nowInPractice` at module scope -- one copy,
   * reading the practice's zone from the day pack rather than the device's.)
   */
  const chosen = params?.state === "ok"
    ? params.set.parameters.find(p => p.id === definitionId) ?? null
    : null;
  // ⚠ WARNS, NEVER BLOCKS -- migration 246's rule, and offline the argument is stronger, not weaker: a
  // form that locks in a clinic with no signal cannot be argued with and the reading is simply lost.
  const plausibility = chosen && chosen.dataType !== "text"
    ? offlinePlausibility(chosen, value.trim() === "" ? null : Number(value))
    : { level: "ok" as const, text: null };

  async function submit() {
    if (!workspaceId || !patientId || !identity || !chosen) return;
    // ⚠ THE PRACTITIONER'S WALL CLOCK, COMPOSED IN THE PRACTICE'S ZONE. Sending the raw offsetless
    // string would let the server read a 09:00 reading as 09:00 UTC; composing it with `new Date()`
    // read it in the DEVICE's zone, which is right only while the device is where the practice is.
    const when = composeCapture(takenDate, takenTime, timezone);
    if ("problem" in when) { setProblem(when.problem); return; }
    setBusy(true); setProblem(null); setHeld(null);
    const numeric = chosen.dataType === "decimal" || chosen.dataType === "integer";
    const result = await captureMeasurement({
      workspaceId, deviceId: identity.deviceId, userId: identity.userId,
      patientId, definitionId: chosen.id,
      value: numeric ? Number(value) : value.trim(),
      unit: unit || chosen.canonicalUnit,
      effectiveAt: when.at,
    });
    setBusy(false);
    if (!result.ok) { setProblem(result.reason); return; }
    // ⚠ ONLY AFTER `ok: true`. See captureMeasurement's contract.
    setHeld(CAPTURE_HELD_NOTE);
    setValue("");
  }

  if (!patientId) return null;

  if (!open)
    return (
      <button type="button"
        onClick={() => { const n = nowInPractice(timezone); setTakenDate(n.date); setTakenTime(n.time); setOpen(true); }}
        className="mt-2 rounded-lg border border-[var(--cp-primary)] px-2.5 py-1 text-[11.5px] font-semibold text-[var(--cp-primary)]">
        Record a reading
      </button>
    );

  // ⚠ EVERY REASON THE FORM CANNOT BE SHOWN IS SAID, NOT LEFT AS AN ABSENCE. A missing form on a screen
  // that offered a button reads as a broken product; each of these is a different, fixable state.
  if (params && params.state !== "ok")
    return <p className="mt-2 rounded-lg border border-amber-400 bg-amber-50 px-3 py-2 text-[11.5px] leading-relaxed text-amber-900">{params.reason}</p>;
  if (params?.state === "ok" && params.set.parameters.length === 0)
    return <p className="mt-2 rounded-lg border border-amber-400 bg-amber-50 px-3 py-2 text-[11.5px] leading-relaxed text-amber-900">This practice has no measurements set up that can be recorded, so there is nothing to record here.</p>;
  if (params && !identity)
    return <p className="mt-2 rounded-lg border border-amber-400 bg-amber-50 px-3 py-2 text-[11.5px] leading-relaxed text-amber-900">This device does not know who is signed in, so a reading recorded now could not say who took it. Open Practice once while online and it will remember.</p>;
  if (!params) return <p className="mt-2 text-[11.5px] text-gray-500">Reading what this device can record&hellip;</p>;

  return (
    <div className="mt-2 rounded-lg border border-gray-300 bg-white px-3 py-2">
      <p className="text-[11px] font-semibold text-gray-500">Record a reading for {patientName}</p>

      <label className="mt-1.5 block">
        <span className="text-[11px] text-gray-600">Measurement</span>
        <select value={definitionId} onChange={e => { setDefinitionId(e.target.value); setUnit(""); setHeld(null); }}
          className="mt-0.5 w-full rounded border border-gray-300 px-2 py-1 text-[12px]">
          <option value="">Choose&hellip;</option>
          {params.set.parameters.map(p => (
            <option key={p.id} value={p.id}>{p.displayName}{p.canonicalUnit ? ` (${p.canonicalUnit})` : ""}</option>
          ))}
        </select>
      </label>
      {/* ⚠ NO SILENT CAP -- a practitioner who cannot find one must know the list is partial. */}
      {params.set.dropped && <p className="mt-1 text-[10.5px] text-gray-600">{params.set.dropped.reason}</p>}

      {chosen && (
        <>
          <label className="mt-1.5 block">
            <span className="text-[11px] text-gray-600">Value</span>
            {chosen.dataType === "single_choice" || chosen.dataType === "multi_choice" ? (
              <select value={value} onChange={e => { setValue(e.target.value); setHeld(null); }}
                className="mt-0.5 w-full rounded border border-gray-300 px-2 py-1 text-[12px]">
                <option value="">Choose&hellip;</option>
                {chosen.options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            ) : (
              <input
                type={chosen.dataType === "decimal" || chosen.dataType === "integer" ? "number" : "text"}
                inputMode={chosen.dataType === "integer" ? "numeric" : undefined}
                value={value} onChange={e => { setValue(e.target.value); setHeld(null); }}
                className="mt-0.5 w-full rounded border border-gray-300 px-2 py-1 text-[12px]" />
            )}
          </label>

          {chosen.permittedUnits.length > 0 && (
            <label className="mt-1.5 block">
              <span className="text-[11px] text-gray-600">Unit</span>
              {/* ⚠ THE DEVICE DOES NOT CONVERT. It records the unit chosen; the server converts once, at
                  write time. offline-parameters.ts withholds the conversion table for that reason -- a
                  third copy of it on hardware that may not reconnect is how a wrong dose happens. */}
              <select value={unit || (chosen.canonicalUnit ?? "")} onChange={e => setUnit(e.target.value)}
                className="mt-0.5 w-full rounded border border-gray-300 px-2 py-1 text-[12px]">
                {[...new Set([chosen.canonicalUnit, ...chosen.permittedUnits].filter(Boolean))].map(u => (
                  <option key={u as string} value={u as string}>{u}</option>
                ))}
              </select>
            </label>
          )}

          <label className="mt-1.5 block">
            {/* ⚠ REQUIRED AND EDITABLE. The applier refuses a reading with no time rather than stamping
                it with today's date, because a three-day-old observation filed as today is a lie
                recorded as a clinical fact. So it must be possible to correct it here. */}
            <span className="text-[11px] text-gray-600">When it was taken</span>
            {/* ⚠ A DATE AND A 24-HOUR TIME, NOT datetime-local -- the native control draws the OS
                locale, so this asked for the time in AM/PM on any US-locale device in a product that
                speaks 24-hour everywhere else. type="date" stays: its value carries no zone to get
                wrong and the native calendar is genuinely the better control on a phone. */}
            <div className="mt-0.5 flex gap-1">
              <input type="date" value={takenDate} onChange={e => setTakenDate(e.target.value)}
                aria-label="Date it was taken"
                className="min-w-0 flex-1 rounded border border-gray-300 px-2 py-1 text-[12px]" />
              <TimeInput value={takenTime} onChange={setTakenTime}
                ariaLabel="Time it was taken, 24-hour clock"
                className="min-w-0 flex-1 rounded border border-gray-300 px-2 py-1 text-[12px]" />
            </div>
          </label>

          {plausibility.text && (
            <p className="mt-1 rounded border border-amber-400 bg-amber-50 px-2 py-1 text-[11px] leading-relaxed text-amber-900">
              {plausibility.text}
            </p>
          )}
        </>
      )}

      {problem && <p className="mt-1.5 text-[11.5px] leading-relaxed text-rose-700">{problem}</p>}
      {held && <p className="mt-1.5 rounded border border-gray-300 bg-gray-50 px-2 py-1 text-[11.5px] leading-relaxed text-gray-800">{held}</p>}

      <div className="mt-2 flex items-center gap-2">
        <button type="button" disabled={busy || !chosen || value.trim() === "" || !takenDate || !takenTime} onClick={submit}
          className="rounded-lg bg-[var(--cp-primary)] px-3 py-1.5 text-[12px] font-semibold text-white disabled:opacity-40">
          {/* ⚠ NOT "Save". Nothing is saved anywhere until this device reaches the practice. */}
          {busy ? "Holding…" : "Hold on this device"}
        </button>
        <button type="button" onClick={() => { setOpen(false); setHeld(null); setProblem(null); }}
          className="text-[11.5px] text-gray-500 hover:underline">Close</button>
      </div>
    </div>
  );
}

/**
 * ⚠ ENTITY TWO OF OFFLINE CAPTURE: A WHOLE VISIT (owner's order: "Encounters then follow-up").
 *
 * Everything CaptureReading's header says binds here too -- the seven preconditions, the sentences,
 * the acceptance line. What is different is WHAT this becomes on the server: a PAST, COMPLETED
 * encounter, filed by offline-filing.ts without ever touching the live lifecycle. It cannot resume,
 * open or disturb a consultation somebody is running right now -- which is the property that makes
 * capturing a whole visit offline safe at all, and the harness pins it.
 *
 * ⚠ THE TIMES ARE THE PRACTITIONER'S, BOTH OF THEM, AND BOTH REQUIRED. A visit synced three days
 * late that was stamped with upload time would claim the patient was seen at the moment of the sync.
 *
 * ⚠ ONE NOTES BOX, FILED AS THE NARRATIVE SEGMENT. Offline capture is typing up a visit that already
 * happened -- a narrative is what a practitioner writes on paper. The full SOAP editor stays online,
 * where the encounter opens for review, and a captured narrative never blocks later structured notes.
 */
function CaptureVisit(
  { workspaceId, patientId, patientName, timezone }:
  { workspaceId: string | null; patientId: string | null; patientName: string; timezone: string },
) {
  const [identity, setIdentity] = useState<DeviceIdentity | null>(null);
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState("in_person");
  const [pathway, setPathway] = useState("new_walk_in");
  const [reason, setReason] = useState("");
  const [startedDate, setStartedDate] = useState("");
  const [startedTime, setStartedTime] = useState("");
  const [endedDate, setEndedDate] = useState("");
  const [endedTime, setEndedTime] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [held, setHeld] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    void cachedIdentity().then(setIdentity);
  }, [open]);

  async function submit() {
    if (!workspaceId || !patientId || !identity) return;
    // Both instants composed in the practice's zone, and BOTH refused by name rather than one of them
    // silently becoming "" -- an encounter with a start and no end is a different, later argument.
    const from = composeCapture(startedDate, startedTime, timezone);
    if ("problem" in from) { setProblem(`Started: ${from.problem}`); return; }
    const to = composeCapture(endedDate, endedTime, timezone);
    if ("problem" in to) { setProblem(`Ended: ${to.problem}`); return; }
    setBusy(true); setProblem(null); setHeld(null);
    const result = await captureEncounter({
      workspaceId, deviceId: identity.deviceId, userId: identity.userId,
      patientId, pathway, encounterMode: mode,
      reasonForVisit: reason.trim() || null,
      startedAt: from.at, endedAt: to.at,
      notes: { narrative: notes },
    });
    setBusy(false);
    if (!result.ok) { setProblem(result.reason); return; }
    // ⚠ ONLY AFTER `ok: true`, and only ever CAPTURE_HELD_NOTE's sentence.
    setHeld(CAPTURE_HELD_NOTE);
    setNotes(""); setReason("");
  }

  if (!patientId) return null;

  if (!open)
    return (
      <button type="button"
        onClick={() => {
          // Half an hour ago to now -- the shape of a visit just finished, both on the practice's clock.
          const began = nowInPractice(timezone, -30), ended = nowInPractice(timezone);
          setStartedDate(began.date); setStartedTime(began.time);
          setEndedDate(ended.date); setEndedTime(ended.time);
          setOpen(true);
        }}
        className="mt-2 ml-2 rounded-lg border border-[var(--cp-primary)] px-2.5 py-1 text-[11.5px] font-semibold text-[var(--cp-primary)]">
        Record a visit
      </button>
    );

  if (!identity)
    return <p className="mt-2 rounded-lg border border-amber-400 bg-amber-50 px-3 py-2 text-[11.5px] leading-relaxed text-amber-900">This device does not know who is signed in, so a visit recorded now could not say who saw the patient. Open Practice once while online and it will remember.</p>;

  return (
    <div className="mt-2 rounded-lg border border-gray-300 bg-white px-3 py-2">
      <p className="text-[11px] font-semibold text-gray-500">Record a visit with {patientName}</p>
      <p className="mt-0.5 text-[10.5px] leading-snug text-gray-500">
        For a consultation that has already happened. It is filed as a completed visit when this
        device reaches the practice, where it can be reviewed and signed.
      </p>

      <div className="mt-1.5 grid grid-cols-2 gap-2">
        <label className="block">
          <span className="text-[11px] text-gray-600">Kind of visit</span>
          {/* ⚠ FIXED PICKERS, NEVER FREE TEXT. These are the database's own vocabularies; anything
              else would be refused at sync, days from now, when it can no longer be corrected. */}
          <select value={mode} onChange={e => { setMode(e.target.value); setHeld(null); }}
            className="mt-0.5 w-full rounded border border-gray-300 px-2 py-1 text-[12px]">
            <option value="in_person">In person</option>
            <option value="home_visit">Home visit</option>
            <option value="outreach">Outreach</option>
            <option value="teleconsultation">Teleconsultation</option>
            <option value="hospital">Hospital</option>
          </select>
        </label>
        <label className="block">
          <span className="text-[11px] text-gray-600">How they came</span>
          <select value={pathway} onChange={e => { setPathway(e.target.value); setHeld(null); }}
            className="mt-0.5 w-full rounded border border-gray-300 px-2 py-1 text-[12px]">
            <option value="new_walk_in">Walk-in</option>
            <option value="booked">Booked</option>
            <option value="walk_in_followup">Follow-up (walk-in)</option>
            <option value="scheduled_followup">Follow-up (scheduled)</option>
          </select>
        </label>
      </div>

      <label className="mt-1.5 block">
        <span className="text-[11px] text-gray-600">Reason for visit</span>
        <input type="text" value={reason} onChange={e => { setReason(e.target.value); setHeld(null); }}
          className="mt-0.5 w-full rounded border border-gray-300 px-2 py-1 text-[12px]" />
      </label>

      {/* ⚠ REQUIRED AND EDITABLE, both of them -- the server refuses a visit with no times rather than
          stamping it with the upload moment. See the reading's time field for the doctrine, and for
          why each is now a date beside a 24-hour time rather than one datetime-local. */}
      <div className="mt-1.5 grid gap-2 sm:grid-cols-2">
        <label className="block">
          <span className="text-[11px] text-gray-600">Started</span>
          <div className="mt-0.5 flex gap-1">
            <input type="date" value={startedDate} aria-label="Date the visit started"
              onChange={e => { setStartedDate(e.target.value); setHeld(null); }}
              className="min-w-0 flex-1 rounded border border-gray-300 px-2 py-1 text-[12px]" />
            <TimeInput value={startedTime} ariaLabel="Time the visit started, 24-hour clock"
              onChange={v => { setStartedTime(v); setHeld(null); }}
              className="min-w-0 flex-1 rounded border border-gray-300 px-2 py-1 text-[12px]" />
          </div>
        </label>
        <label className="block">
          <span className="text-[11px] text-gray-600">Ended</span>
          <div className="mt-0.5 flex gap-1">
            <input type="date" value={endedDate} aria-label="Date the visit ended"
              onChange={e => { setEndedDate(e.target.value); setHeld(null); }}
              className="min-w-0 flex-1 rounded border border-gray-300 px-2 py-1 text-[12px]" />
            <TimeInput value={endedTime} ariaLabel="Time the visit ended, 24-hour clock"
              onChange={v => { setEndedTime(v); setHeld(null); }}
              className="min-w-0 flex-1 rounded border border-gray-300 px-2 py-1 text-[12px]" />
          </div>
        </label>
      </div>

      <label className="mt-1.5 block">
        <span className="text-[11px] text-gray-600">What happened</span>
        <textarea value={notes} onChange={e => { setNotes(e.target.value); setHeld(null); }} rows={4}
          className="mt-0.5 w-full rounded border border-gray-300 px-2 py-1 text-[12px]" />
      </label>

      {problem && <p className="mt-1.5 text-[11.5px] leading-relaxed text-rose-700">{problem}</p>}
      {held && <p className="mt-1.5 rounded border border-gray-300 bg-gray-50 px-2 py-1 text-[11.5px] leading-relaxed text-gray-800">{held}</p>}

      <div className="mt-2 flex items-center gap-2">
        <button type="button" onClick={submit}
          disabled={busy || notes.trim() === "" || !startedDate || !startedTime || !endedDate || !endedTime}
          className="rounded-lg bg-[var(--cp-primary)] px-3 py-1.5 text-[12px] font-semibold text-white disabled:opacity-40">
          {/* ⚠ NOT "Save". Nothing is saved anywhere until this device reaches the practice. */}
          {busy ? "Holding…" : "Hold on this device"}
        </button>
        <button type="button" onClick={() => { setOpen(false); setHeld(null); setProblem(null); }}
          className="text-[11.5px] text-gray-500 hover:underline">Close</button>
      </div>
    </div>
  );
}

/**
 * ⚠ ENTITY THREE OF OFFLINE CAPTURE: A FOLLOW-UP (owner's order: "Encounters then follow-up").
 *
 * Everything CaptureReading's header says binds here too. This one RAISES an obligation and can never
 * close, reschedule or defer one -- create-only keeps the conflict surface structurally closed. On
 * sync it goes through createFollowUp, the same engine the online board is built from.
 *
 * ⚠ A PAST DUE DATE IS ALLOWED ON PURPOSE. "Should have been seen last week" is a legitimate
 * obligation that arrives overdue; refusing it at the bedside would lose it.
 *
 * ⚠ AND ONE TRUTH THIS ENTITY OWNS: until this device syncs, the obligation is on NO board and can
 * remind NOBODY. The sentence under the date says so, because a practitioner who writes "review in
 * two days" onto a device that may not connect for four needs to know which of those wins.
 */
function CaptureFollowUp(
  { workspaceId, patientId, patientName }:
  { workspaceId: string | null; patientId: string | null; patientName: string },
) {
  const [identity, setIdentity] = useState<DeviceIdentity | null>(null);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [dueOn, setDueOn] = useState("");
  const [kind, setKind] = useState("clinical_condition");
  const [priority, setPriority] = useState("routine");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [held, setHeld] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    void cachedIdentity().then(setIdentity);
  }, [open]);

  async function submit() {
    if (!workspaceId || !patientId || !identity) return;
    setBusy(true); setProblem(null); setHeld(null);
    const result = await captureFollowUp({
      workspaceId, deviceId: identity.deviceId, userId: identity.userId,
      patientId, reason, dueOn, kind, priority,
    });
    setBusy(false);
    if (!result.ok) { setProblem(result.reason); return; }
    // ⚠ ONLY AFTER `ok: true`, and only ever CAPTURE_HELD_NOTE's sentence.
    setHeld(CAPTURE_HELD_NOTE);
    setReason("");
  }

  if (!patientId) return null;

  if (!open)
    return (
      <button type="button" onClick={() => setOpen(true)}
        className="mt-2 ml-2 rounded-lg border border-[var(--cp-primary)] px-2.5 py-1 text-[11.5px] font-semibold text-[var(--cp-primary)]">
        Record a follow-up
      </button>
    );

  if (!identity)
    return <p className="mt-2 rounded-lg border border-amber-400 bg-amber-50 px-3 py-2 text-[11.5px] leading-relaxed text-amber-900">This device does not know who is signed in, so a follow-up recorded now could not say who committed to it. Open Practice once while online and it will remember.</p>;

  return (
    <div className="mt-2 rounded-lg border border-gray-300 bg-white px-3 py-2">
      <p className="text-[11px] font-semibold text-gray-500">Record a follow-up for {patientName}</p>

      <label className="mt-1.5 block">
        <span className="text-[11px] text-gray-600">What it is for</span>
        <input type="text" value={reason} maxLength={400}
          onChange={e => { setReason(e.target.value); setHeld(null); }}
          className="mt-0.5 w-full rounded border border-gray-300 px-2 py-1 text-[12px]" />
      </label>

      <div className="mt-1.5 grid grid-cols-3 gap-2">
        <label className="block">
          <span className="text-[11px] text-gray-600">Due on</span>
          <input type="date" value={dueOn} onChange={e => { setDueOn(e.target.value); setHeld(null); }}
            className="mt-0.5 w-full rounded border border-gray-300 px-2 py-1 text-[12px]" />
        </label>
        <label className="block">
          <span className="text-[11px] text-gray-600">Kind</span>
          {/* ⚠ FIXED PICKERS, NEVER FREE TEXT -- the database's own vocabularies. */}
          <select value={kind} onChange={e => { setKind(e.target.value); setHeld(null); }}
            className="mt-0.5 w-full rounded border border-gray-300 px-2 py-1 text-[12px]">
            {FOLLOW_UP_CATEGORIES.map(([code, label]) => <option key={code} value={code}>{label}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="text-[11px] text-gray-600">Priority</span>
          <select value={priority} onChange={e => { setPriority(e.target.value); setHeld(null); }}
            className="mt-0.5 w-full rounded border border-gray-300 px-2 py-1 text-[12px]">
            {FOLLOW_UP_PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        </label>
      </div>

      {/* The truth this entity owns -- see the component header. */}
      <p className="mt-1 text-[10.5px] leading-snug text-gray-500">
        Until this device syncs, this follow-up is held here and is on no practice board, so no
        reminder can fire. If it is due very soon, plan for that.
      </p>

      {problem && <p className="mt-1.5 text-[11.5px] leading-relaxed text-rose-700">{problem}</p>}
      {held && <p className="mt-1.5 rounded border border-gray-300 bg-gray-50 px-2 py-1 text-[11.5px] leading-relaxed text-gray-800">{held}</p>}

      <div className="mt-2 flex items-center gap-2">
        <button type="button" disabled={busy || reason.trim() === "" || !dueOn} onClick={submit}
          className="rounded-lg bg-[var(--cp-primary)] px-3 py-1.5 text-[12px] font-semibold text-white disabled:opacity-40">
          {/* ⚠ NOT "Save". Nothing is saved anywhere until this device reaches the practice. */}
          {busy ? "Holding…" : "Hold on this device"}
        </button>
        <button type="button" onClick={() => { setOpen(false); setHeld(null); setProblem(null); }}
          className="text-[11.5px] text-gray-500 hover:underline">Close</button>
      </div>
    </div>
  );
}

/**
 * ⚠ ENTITY FOUR OF OFFLINE CAPTURE: MONEY TAKEN IN THE FIELD (docs/CPR-PAY-PBI-SURVEY-001 D1).
 *
 * Everything CaptureReading's header says binds here too. On sync this becomes charge + payment
 * through the practice's own billing engines, collector welded to the practitioner, and the
 * NUMBERED RECEIPT IS ISSUED AT SYNC -- never here. Nothing on this screen may look like, be named
 * as, or be printable as a receipt: a receipt number belongs to the practice's counter, and a
 * receipt-shaped rendering without one is the fraud surface the survey ruled out.
 *
 * ⚠ AMOUNTS ARE ENTERED IN MAJOR UNITS and converted with CURRENCY_EXPONENT, the same arithmetic the
 * online fees form uses -- UGX has exponent 0, so a shilling figure IS the minor figure. The preview
 * line shows formatMinor of exactly what will be filed, so what the practitioner reads is what the
 * books will say.
 */
function CaptureCollection(
  { workspaceId, patientId, patientName, timezone }:
  { workspaceId: string | null; patientId: string | null; patientName: string; timezone: string },
) {
  const [identity, setIdentity] = useState<DeviceIdentity | null>(null);
  const [open, setOpen] = useState(false);
  const [description, setDescription] = useState("");
  const [amountMajor, setAmountMajor] = useState("");
  const [currency, setCurrency] = useState("UGX");
  const [method, setMethod] = useState("cash");
  const [takenDate, setTakenDate] = useState("");
  const [takenTime, setTakenTime] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [held, setHeld] = useState<string | null>(null);
  // D6 (owner decision 2026-08-16): the shell's last-known verdict on the billing capabilities.
  // ⚠ A WARNING, NEVER A GATE. It changes one sentence on this screen and nothing else -- the
  // capture still holds, the sync still decides, and an absent verdict says nothing rather than
  // guessing. The harness pins that the submit button's disabled expression never references it.
  const [billingVerdict, setBillingVerdict] = useState<{ allowed: boolean; cachedAt: string } | null>(null);

  useEffect(() => {
    if (!open) return;
    void cachedIdentity().then(setIdentity);
    void cachedBillingCapture().then(setBillingVerdict);
  }, [open]);

  // The one conversion, done where the preview can show its result. Math.round holds the "money is
  // integers" rule against float entry; a figure that rounds to nothing is refused by the capture.
  const exp = CURRENCY_EXPONENT[currency] ?? 2;
  const amountMinor = amountMajor.trim() === "" ? 0 : Math.round(Number(amountMajor) * 10 ** exp);
  const amountReadable = Number.isInteger(amountMinor) && amountMinor > 0 ? formatMinor(amountMinor, currency) : null;

  async function submit() {
    if (!workspaceId || !patientId || !identity) return;
    // The practice's zone, not the device's -- a receipt is numbered against this moment at sync.
    const when = composeCapture(takenDate, takenTime, timezone);
    if ("problem" in when) { setProblem(when.problem); return; }
    setBusy(true); setProblem(null); setHeld(null);
    const result = await captureCollection({
      workspaceId, deviceId: identity.deviceId, userId: identity.userId,
      patientId, description, amountMinor, currency, method,
      collectedAt: when.at,
    });
    setBusy(false);
    if (!result.ok) { setProblem(result.reason); return; }
    // ⚠ ONLY AFTER `ok: true`, and only ever CAPTURE_HELD_NOTE's sentence.
    setHeld(CAPTURE_HELD_NOTE);
    setDescription(""); setAmountMajor("");
  }

  if (!patientId) return null;

  if (!open)
    return (
      <button type="button"
        onClick={() => { const n = nowInPractice(timezone); setTakenDate(n.date); setTakenTime(n.time); setOpen(true); }}
        className="mt-2 ml-2 rounded-lg border border-[var(--cp-primary)] px-2.5 py-1 text-[11.5px] font-semibold text-[var(--cp-primary)]">
        Record money taken
      </button>
    );

  if (!identity)
    return <p className="mt-2 rounded-lg border border-amber-400 bg-amber-50 px-3 py-2 text-[11.5px] leading-relaxed text-amber-900">This device does not know who is signed in, so money recorded now could not say who took it. Open Practice once while online and it will remember.</p>;

  return (
    <div className="mt-2 rounded-lg border border-gray-300 bg-white px-3 py-2">
      <p className="text-[11px] font-semibold text-gray-500">Record money taken from {patientName}</p>
      <p className="mt-0.5 text-[10.5px] leading-snug text-gray-500">
        This is not a receipt. The numbered receipt is issued by the practice when this device
        syncs — the practice&apos;s books do not know about this money until then.
      </p>
      {/* D6: the bedside warning that would otherwise arrive DAYS LATER as a sync refusal about
          money a patient already handed over. Rendered only when the cached verdict says the
          permission was missing; an absent verdict says nothing, because a guess is worse. */}
      {billingVerdict !== null && !billingVerdict.allowed && (
        <p className="mt-1.5 rounded-lg border border-amber-400 bg-amber-50 px-3 py-2 text-[11.5px] leading-relaxed text-amber-900">
          When this device was last connected, this account did not hold the billing permission for
          this practice. You can still record money taken &mdash; nothing here blocks a capture &mdash;
          but the practice will refuse to file it at sync until somebody grants the permission. If
          that has changed since, this note is stale.
        </p>
      )}

      <label className="mt-1.5 block">
        <span className="text-[11px] text-gray-600">What the money was for</span>
        <input type="text" value={description} onChange={e => { setDescription(e.target.value); setHeld(null); }}
          className="mt-0.5 w-full rounded border border-gray-300 px-2 py-1 text-[12px]" />
      </label>

      <div className="mt-1.5 grid grid-cols-3 gap-2">
        <label className="block">
          <span className="text-[11px] text-gray-600">Amount</span>
          <input type="number" min={0} inputMode="decimal" value={amountMajor}
            onChange={e => { setAmountMajor(e.target.value); setHeld(null); }}
            className="mt-0.5 w-full rounded border border-gray-300 px-2 py-1 text-[12px]" />
        </label>
        <label className="block">
          <span className="text-[11px] text-gray-600">Currency</span>
          <select value={currency} onChange={e => { setCurrency(e.target.value); setHeld(null); }}
            className="mt-0.5 w-full rounded border border-gray-300 px-2 py-1 text-[12px]">
            {Object.keys(CURRENCY_EXPONENT).map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="text-[11px] text-gray-600">How it was paid</span>
          <select value={method} onChange={e => { setMethod(e.target.value); setHeld(null); }}
            className="mt-0.5 w-full rounded border border-gray-300 px-2 py-1 text-[12px]">
            {PAYMENT_METHODS.map(([code, label]) => <option key={code} value={code}>{label}</option>)}
          </select>
        </label>
      </div>
      {/* What will actually be filed, in the one formatter the books use. */}
      {amountReadable && <p className="mt-1 text-[11px] text-gray-700">Will be filed as <span className="font-semibold tabular-nums">{amountReadable}</span></p>}

      <label className="mt-1.5 block">
        <span className="text-[11px] text-gray-600">When it was taken</span>
        {/* Date beside a 24-hour time -- see the reading's field for why datetime-local is gone. */}
        <div className="mt-0.5 flex gap-1">
          <input type="date" value={takenDate} aria-label="Date the money was taken"
            onChange={e => { setTakenDate(e.target.value); setHeld(null); }}
            className="min-w-0 flex-1 rounded border border-gray-300 px-2 py-1 text-[12px]" />
          <TimeInput value={takenTime} ariaLabel="Time the money was taken, 24-hour clock"
            onChange={v => { setTakenTime(v); setHeld(null); }}
            className="min-w-0 flex-1 rounded border border-gray-300 px-2 py-1 text-[12px]" />
        </div>
      </label>

      {problem && <p className="mt-1.5 text-[11.5px] leading-relaxed text-rose-700">{problem}</p>}
      {held && <p className="mt-1.5 rounded border border-gray-300 bg-gray-50 px-2 py-1 text-[11.5px] leading-relaxed text-gray-800">{held}</p>}

      <div className="mt-2 flex items-center gap-2">
        <button type="button"
          disabled={busy || description.trim() === "" || !takenDate || !takenTime
            || !Number.isInteger(amountMinor) || amountMinor <= 0}
          onClick={submit}
          className="rounded-lg bg-[var(--cp-primary)] px-3 py-1.5 text-[12px] font-semibold text-white disabled:opacity-40">
          {/* ⚠ NOT "Save", and NEVER "Issue receipt". Nothing is saved anywhere until sync. */}
          {busy ? "Holding…" : "Hold on this device"}
        </button>
        <button type="button" onClick={() => { setOpen(false); setHeld(null); setProblem(null); }}
          className="text-[11.5px] text-gray-500 hover:underline">Close</button>
      </div>
    </div>
  );
}

/**
 * How the four SafetyLine tones are allowed to LOOK.
 *
 * ⚠ ONLY `none` MAY BE NEUTRAL, AND NOTHING MAY BE GREEN. `safeToRead` is true for exactly one tone --
 * somebody was asked and said there were none -- and every other tone must carry visible weight, because
 * the failure this whole design guards against is a reassuring-looking blank. A green tick beside
 * "Allergy status not recorded" would undo in one stylesheet what three files were written to prevent.
 */
const SAFETY_TONE: Record<SafetyLine["tone"], string> = {
  none: "border-gray-300 bg-white text-gray-800",
  present: "border-amber-400 bg-amber-50 text-amber-900",
  unknown: "border-amber-400 bg-amber-50 text-amber-900",
  unreadable: "border-red-500 bg-red-50 text-red-900",
};

/** The stamp for the clinical pack. Its own clock, its own hazard -- see the call site. */
function ClinicalStamp({ clinical }: { clinical: OfflineClinicalReadResult | null }) {
  if (clinical === null) return null;

  if (clinical.state !== "ok")
    return (
      <p className="mt-1 rounded-lg border border-gray-300 bg-white px-3 py-2 text-[12px] leading-relaxed text-gray-700">
        {clinical.reason} Names and times below are unaffected — what is missing is the clinical record
        behind them.
      </p>
    );

  const { pack, notice } = clinical;
  return (
    <div className={`mt-1 rounded-xl border px-4 py-3 ${TONE[notice.tone]}`} role="status">
      <p className="text-[13px] font-semibold">{notice.sentence}</p>
      <p className="mt-1 text-[12px] opacity-90">
        Clinical records held for {pack.records.length} patient{pack.records.length === 1 ? "" : "s"}
        {" "}booked up to {pack.horizonDate}. Removed after {OFFLINE_CLINICAL_MAX_DAYS} days without
        reaching the practice.
      </p>
      {/* ⚠ NO SILENT CAP, and this one matters more than the guidance library's: a practitioner who
          opens a patient and finds no allergy panel must be able to tell "not held" from "none". */}
      {pack.dropped && <p className="mt-1 text-[12px] opacity-90">{pack.dropped.reason}</p>}
    </div>
  );
}

/**
 * One patient's clinical carry, inside their opened record.
 *
 * ⚠ EVERY SENTENCE HERE COMES FROM A PURE FUNCTION IN offline-clinical.ts OR longitudinal-constants.ts.
 * None is composed in this file. That is deliberate: the allergy sentence in particular is the one place
 * in this product where getting the wording wrong is a clinical harm rather than an inconvenience, and it
 * is chosen by the same allergyLine() the online screens use, from a status the cache preserved as three
 * separate facts rather than as a list that might be empty.
 */
function ClinicalPanel(
  { pack, patientId }: { pack: OfflineClinicalPack | null; patientId: string | null },
) {
  // A name-only booking has no patient record, so there is nothing to look up and nothing to imply.
  if (!patientId)
    return (
      <p className="mt-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-[11.5px] leading-relaxed text-gray-700">
        This is a name-only booking with no patient record at the practice, so there is no clinical record
        to hold for it.
      </p>
    );

  const found = lookupOfflineClinical(pack, patientId);
  if (found.state === "not_held")
    return (
      // ⚠ AMBER, NOT GREY. "No clinical record is held" is a warning, not a neutral fact: the
      // practitioner must not read a quiet grey line as "nothing to report about this patient".
      <p className="mt-2 rounded-lg border border-amber-400 bg-amber-50 px-3 py-2 text-[11.5px] leading-relaxed text-amber-900">
        {found.reason} That is not a statement about this patient — it is a statement about this device.
      </p>
    );

  const rec = found.record;
  const allergy = offlineAllergySentence(rec);
  const blood = offlineBloodGroupSentence(rec);
  const meds = offlineMedicationSentence(rec);

  return (
    <div className="mt-2 space-y-2">
      {/* ── ALLERGIES. First, always, and never collapsed behind another toggle. ───────────────── */}
      <div className={`rounded-lg border px-3 py-2 ${SAFETY_TONE[allergy.tone]}`}>
        <p className="text-[12px] font-bold">{allergy.text}</p>
        {rec.allergies.length > 0 && (
          <ul className="mt-1 space-y-0.5">
            {rec.allergies.map(a => (
              <li key={a.id} className="text-[11.5px] leading-relaxed">
                <span className="font-semibold">{a.substance}</span>
                {a.reaction ? ` — ${a.reaction}` : ""}
                {a.severity ? ` · ${a.severity}` : ""}
                {/* ⚠ THE CERTAINTY IS ALWAYS PRINTED, including `refuted`. "Somebody checked and it was
                    not real" is a different answer from silence and changes what happens next. */}
                <span className="opacity-75"> · {a.certainty}</span>
              </li>
            ))}
          </ul>
        )}
        {blood.tone !== "unknown" && <p className="mt-1 text-[11px] opacity-90">Blood group: {blood.text}</p>}
      </div>

      {/* ── CURRENT MEDICATION ─────────────────────────────────────────────────────────────────── */}
      <div className={`rounded-lg border px-3 py-2 ${SAFETY_TONE[meds.tone]}`}>
        <p className="text-[12px] font-bold">{meds.text}</p>
        {rec.medications.length > 0 && (
          <ul className="mt-1 space-y-0.5">
            {rec.medications.map(m => (
              <li key={m.id} className="text-[11.5px] leading-relaxed">
                <span className="font-semibold">{m.genericName}</span>
                {m.brandName ? ` (${m.brandName})` : ""} — {m.doseText}
                {m.route ? ` · ${m.route}` : ""}{m.frequency ? ` · ${m.frequency}` : ""}
                {m.indication ? <span className="opacity-75"> · for {m.indication}</span> : null}
                {/* ⚠ A PAUSED COURSE IS LABELLED WHEREVER IT APPEARS. It is carried because it can still
                    interact and the patient may resume it, and it is marked because reading it as
                    something they are taking today is the opposite error. */}
                {m.status !== "active" && (
                  <span className="ml-1 rounded bg-amber-200 px-1 py-0.5 text-[10px] font-bold uppercase text-amber-900">
                    {m.status}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* ── PROBLEMS ───────────────────────────────────────────────────────────────────────────── */}
      {rec.problemsUnavailable ? (
        <p className="rounded-lg border border-red-500 bg-red-50 px-3 py-2 text-[11.5px] text-red-900">
          The problem list could not be read when this was captured.
        </p>
      ) : rec.problems.length > 0 ? (
        <div className="rounded-lg border border-gray-300 bg-white px-3 py-2">
          <p className="text-[11px] font-semibold text-gray-500">Active problems</p>
          <ul className="mt-0.5 space-y-0.5">
            {rec.problems.map(p => (
              <li key={p.id} className="text-[11.5px] text-gray-800">
                {p.label}{p.onsetOn ? <span className="text-gray-500"> · since {p.onsetOn}</span> : null}
              </li>
            ))}
          </ul>
          {rec.problemsDropped > 0 && (
            <p className="mt-1 text-[11px] text-gray-600">
              {rec.problemsDropped} more not held on this device.
            </p>
          )}
        </div>
      ) : null}

      {/* ── THE LAST VISIT. One, as the owner bounded it. ──────────────────────────────────────── */}
      {rec.lastVisitUnavailable ? (
        <p className="rounded-lg border border-red-500 bg-red-50 px-3 py-2 text-[11.5px] text-red-900">
          The last visit could not be read when this was captured, so nothing about it is shown. This is
          not a statement that there was no previous visit.
        </p>
      ) : rec.lastVisit ? (
        <div className="rounded-lg border border-gray-300 bg-white px-3 py-2">
          <p className="text-[11px] font-semibold text-gray-500">
            Last visit · {rec.lastVisit.date} · {rec.lastVisit.kindLabel}
          </p>
          {rec.lastVisit.diagnoses.length > 0 && (
            <p className="mt-0.5 text-[11.5px] text-gray-800">
              {rec.lastVisit.diagnoses.join(", ")}
            </p>
          )}
          {/* ⚠ ABSENCE IS NAMED RATHER THAN LEFT BLANK. A heading with nothing under it reads as "there
              was nothing to conclude"; this says nobody wrote one, which is a different fact. */}
          <p className="mt-1 whitespace-pre-wrap text-[11.5px] leading-relaxed text-gray-800">
            <span className="font-semibold">Assessment: </span>
            {rec.lastVisit.assessment ?? <span className="text-gray-500">not recorded at that visit</span>}
          </p>
          <p className="mt-0.5 whitespace-pre-wrap text-[11.5px] leading-relaxed text-gray-800">
            <span className="font-semibold">Plan: </span>
            {rec.lastVisit.plan ?? <span className="text-gray-500">not recorded at that visit</span>}
          </p>
        </div>
      ) : (
        <p className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-[11.5px] text-gray-700">
          No earlier visit is recorded for this patient at this practice.
        </p>
      )}
    </div>
  );
}
