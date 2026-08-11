import type { WorkspaceContext } from "@/lib/practice/access";
import { dashboardReadModel } from "@/lib/practice/dashboard";
import { zonedDayRange } from "@/lib/practice/practice-time";
import { formatMinuteOfDay } from "@/lib/datetime";
import {
  ageYearsFrom, projectOfflineDay, type CohortSource, type OfflineDay, type SessionSource,
} from "@/lib/practice/offline-projection";

// CP-OFFLINE-SURVEY-001 s3.3 — the SERVER half of phase one's read-only cache.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// IT ASSEMBLES NO FIGURE OF ITS OWN. The day, its scope, its as_of instant and its per-card degradation
// all come from `dashboardReadModel` -- the same assembler /practice/today, /practice/home and
// GET /api/v1/practice/dashboard already call. CORE-001 s16 forbids a second implementation of a shared
// metric, and an offline path that re-counted anything would be exactly that, in the one place nothing
// can test it.
//
// What this file DOES own is the cohort read, and it owns it because the dashboard payload does not carry
// one. s3.2.1 is right that there is no patient-list endpoint -- `GET /patients?q=` is a ranked search --
// and the day payload names patients only incidentally, in the timeline's labels and in the live queue.
// Neither carries an identifier, an age, a duration or an appointment status, so neither can answer "is
// that the right record" (s3.8.7's second objection). So the cohort is read here, from the appointments
// of the cached day, and it is the ONLY new read in phase one.
//
// ⚠ THE PROJECTION HAPPENS HERE AS WELL AS IN THE BROWSER, and that is not belt-and-braces theatre. A
// date of birth, a phone number and a free-text reason for visit are all on `practice_appointment` and
// `practice_patient`. Projecting only in the browser would put every one of them on the wire and in the
// browser's HTTP cache, where the allow-list cannot reach. Age is DERIVED HERE so that the date of birth
// never leaves the server at all.
//
// ⚠ CANCELLED APPOINTMENTS ARE NOT CACHED. A cancelled booking is not part of the day's work, and a name
// held on a device has to earn its place. Cancellations that happen AFTER capture are a different problem
// and the only honest answer to it is the age stamp -- which is why the age stamp is not optional.

/* eslint-disable @typescript-eslint/no-explicit-any -- the Supabase admin client is untyped; every
   engine in src/lib/practice does the same. */

/**
 * Which identifier is THE identifier, when a patient has several.
 *
 * ⚠ Phone and e-mail are absent by construction, not by ordering. They are contact details, dropped in
 * s3.8.1, and they must not become the cached identifier merely because a patient has nothing else.
 */
const IDENTIFIER_PREFERENCE = [
  "practice_id", "hospital_mrn", "national_id", "passport", "insurance", "qr_code", "other",
] as const;

export type CohortRead = {
  patients: CohortSource[];
  /** ⚠ A FAILED READ IS NOT AN EMPTY CLINIC. */
  unavailable: boolean;
  /**
   * ⚠ WHY IT IS UNAVAILABLE, BECAUSE TWO VERY DIFFERENT THINGS SET THE FLAG ABOVE.
   *
   *   "refused"  this account does not hold practice.calendar.view. Permanent, expected, and nothing is
   *              wrong -- an administrator who is not a clinician is a role this product supports.
   *   "failed"   the read did not work. Transient, and somebody should look.
   *
   * They rendered identically until 2026-08-11: both produced "The appointment list could not be read in
   * full", which tells a practice manager the system is broken when they are simply not entitled to the
   * list. Three states, and a refusal is not a fault.
   */
  reason: "refused" | "failed" | null;
};

/**
 * The patients today's appointments name, with the eight fields s3.8.1 allows and nothing else.
 *
 * Requires `practice.calendar.view` -- the capability the diary is already gated on everywhere. No new
 * capability code is invented (s8: "For phase one: introduce no new capability code").
 */
export async function todaysCohort(
  admin: any, ctx: WorkspaceContext, opts: { date: string; timezone: string; at?: Date },
): Promise<CohortRead> {
  if (!ctx.capabilities.includes("practice.calendar.view"))
    return { patients: [], unavailable: true, reason: "refused" };

  const at = opts.at ?? new Date();
  const { startIso, endIso } = zonedDayRange(opts.date, opts.timezone);

  const { data: appts, error } = await admin.from("practice_appointment")
    .select("id, patient_id, patient_name, appointment_type, scheduled_at, duration_minutes, status")
    .eq("workspace_id", ctx.workspaceId)
    .gte("scheduled_at", startIso).lt("scheduled_at", endIso)
    .neq("status", "CANCELLED")
    .order("scheduled_at", { ascending: true });

  // ⚠ The error is read, not discarded. Without this an unreadable table becomes "no patients today",
  // cached, and shown on a device with no way to find out otherwise.
  if (error) return { patients: [], unavailable: true, reason: "failed" };

  const rows = (appts ?? []) as any[];
  if (rows.length === 0) return { patients: [], unavailable: false, reason: null };

  const patientIds = [...new Set(rows.map(r => r.patient_id).filter(Boolean))] as string[];
  const apptIds = rows.map(r => r.id) as string[];

  const [people, identifiers, encounters] = await Promise.all([
    patientIds.length
      ? admin.from("practice_patient")
        .select("id, birth_date, age_estimate_years")
        .eq("workspace_id", ctx.workspaceId).in("id", patientIds)
      : Promise.resolve({ data: [], error: null }),
    patientIds.length
      ? admin.from("practice_patient_identifier")
        .select("patient_id, identifier_type, value, valid_to")
        .eq("workspace_id", ctx.workspaceId).in("patient_id", patientIds)
      : Promise.resolve({ data: [], error: null }),
    admin.from("practice_encounter")
      .select("id, appointment_id, started_at")
      .eq("workspace_id", ctx.workspaceId).in("appointment_id", apptIds)
      .not("status", "in", "(CANCELLED,ENTERED_IN_ERROR)")
      .order("started_at", { ascending: true }),
  ]);

  // ⚠ An enrichment that failed makes its OWN field null -- it does not blank the list. Losing the
  // identifier for everybody is a real degradation; losing the whole clinic day over it is worse. But
  // "no identifier recorded" and "the identifier table could not be read" must not render alike, so the
  // failure is reported through `unavailable` on the cohort as a whole.
  const enrichmentFailed = !!(people as any).error || !!(identifiers as any).error || !!(encounters as any).error;

  const ageById = new Map<string, number | null>();
  for (const p of (((people as any).data ?? []) as any[]))
    ageById.set(p.id, ageYearsFrom(p.birth_date, p.age_estimate_years, at));

  const idById = new Map<string, { type: string; value: string }>();
  for (const row of (((identifiers as any).data ?? []) as any[])) {
    if (row.valid_to && Date.parse(row.valid_to) <= at.getTime()) continue;
    const rank = IDENTIFIER_PREFERENCE.indexOf(row.identifier_type);
    if (rank < 0) continue; // phone and e-mail are not in the preference list, so they cannot win
    const held = idById.get(row.patient_id);
    if (!held || IDENTIFIER_PREFERENCE.indexOf(held.type as any) > rank)
      idById.set(row.patient_id, { type: row.identifier_type, value: row.value });
  }

  const encByAppt = new Map<string, string>();
  for (const e of (((encounters as any).data ?? []) as any[]))
    if (e.appointment_id) encByAppt.set(e.appointment_id, e.id);

  const patients: CohortSource[] = rows.map((r): CohortSource => {
    const id = r.patient_id ? idById.get(r.patient_id) ?? null : null;
    return {
      appointmentId: r.id,
      name: r.patient_name,
      identifierType: id?.type ?? null,
      identifierValue: id?.value ?? null,
      // A name-only booking has no patient record, so it has no age. Null, never a guess.
      ageYears: r.patient_id ? ageById.get(r.patient_id) ?? null : null,
      timeLabel: new Date(r.scheduled_at).toLocaleTimeString("en-GB", {
        hour: "2-digit", minute: "2-digit", timeZone: opts.timezone || "UTC",
      }),
      durationMinutes: typeof r.duration_minutes === "number" ? r.duration_minutes : null,
      status: r.status,
      encounterId: encByAppt.get(r.id) ?? null,
      visitKind: r.appointment_type,
    };
  });

  return { patients, unavailable: enrichmentFailed, reason: enrichmentFailed ? "failed" : null };
}

export type OfflineDayResult =
  | { ok: true; day: OfflineDay }
  /** The read model itself could not be assembled at all. Nothing is cached; nothing is claimed. */
  | { ok: false; reason: string };

/**
 * The whole cached record for one workspace-day, projected and ready to be written verbatim.
 *
 * ⚠ It refuses to produce a record when EVERY feeder failed. Caching a payload that is entirely holes
 * would put a screen of "could not be read" on a device for the rest of the day, which is worse than
 * having nothing cached: the device would stop trying and the practitioner would read the holes as
 * "nothing on today".
 */
export async function offlineDayPayload(
  admin: any, ctx: WorkspaceContext, opts: { at?: Date } = {},
): Promise<OfflineDayResult> {
  const at = opts.at ?? new Date();
  const model = await dashboardReadModel(admin, ctx, { at });

  if (model.unavailable)
    return { ok: false, reason: "Today's day could not be read just now, so nothing was stored on this device." };

  const cohort = await todaysCohort(admin, ctx, { date: model.plan.date, timezone: model.timezone, at });

  const sessions: SessionSource[] = model.plan.activities.map((a): SessionSource => ({
    id: a.id,
    // ⚠ THE ACTIVITY TYPE, NEVER THE PRACTITIONER'S OWN TITLE. See offline-projection.ts's header: a
    // free-text session title printed above a list of names re-supplies the clinical context that
    // suppressing the per-patient visit kind removed.
    kindLabel: a.label,
    startLabel: formatMinuteOfDay(a.plannedStartMinute),
    endLabel: formatMinuteOfDay(a.plannedEndMinute),
    state: a.state,
  }));

  return {
    ok: true,
    day: projectOfflineDay({
      workspaceId: ctx.workspaceId,
      date: model.plan.date,
      timezone: model.timezone,
      asOf: model.asOf,
      sessions,
      patients: cohort.patients,
      feeders: model.feeders,
      patientsUnavailable: cohort.unavailable,
      patientsUnavailableReason: cohort.reason,
      sessionsUnavailable: model.plan.unavailable,
    }),
  };
}
