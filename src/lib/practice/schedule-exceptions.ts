import type { WorkspaceContext } from "@/lib/practice/access";
import { audit } from "@/lib/practice/provisioning";
import { practiceToday, zonedDayRange } from "@/lib/practice/practice-time";
import { ACTIVITY_TYPES, ACTIVITY_LABEL, type ActivityType } from "@/lib/practice/activity-constants";
import {
  EXCEPTION_KINDS, EXCEPTION_KIND_CODES, IMPACTING_KINDS, ADDS_TIME,
  RESOLUTIONS, RESOLUTIONS_BUILT, RESOLUTIONS_AT_COMMIT, RESOLUTIONS_PER_BOOKING,
  LIVE_BOOKING_STATUSES, exceptionKind, exceptionDates, hhmmOfDay,
} from "@/lib/practice/schedule-exception-constants";

/* eslint-disable @typescript-eslint/no-explicit-any */

// ────────────────────────────────────────────────────────────────────────────────────────────────────
// CPR-V5-007 PHASE 2 -- LAYER 2, "CHANGES & EXCEPTIONS". Migration 242.
//
// ---- THE POINT OF THIS FILE IS THE PATIENTS, NOT THE EXCEPTIONS --------------------------------------
//
// practice_availability_exception (migration 230) already closed and opened days before any of this
// existed, and the generator already honoured it. What did not exist is the thing s5.3 spends its whole
// section on, and which s2.1 states as the defect: "No exception impact handling -- SCHEDULE CHANGES CAN
// STRAND BOOKED PATIENTS -- affected-booking workflow with notify, reschedule and waiting-list actions."
//
// So the deliverable is a WORKFLOW, in s5.3's own order, and commitScheduleChange() below runs it in
// exactly that order:
//
//   1. Calculate all confirmed, requested, wait-listed and follow-up-linked bookings affected.
//   2. Present the count and patient-safe summary BEFORE the change is committed.
//   3. REQUIRE the user to select a resolution strategy for affected bookings.
//   4. Apply the schedule change, create patient actions and log the decision.
//   5. Rebuild bookable availability and notify relevant operational workspaces.
//
// Step 5's rebuild is the ROUTE's job, as it is for every other write in this area: the API regenerates
// its own window before returning, so the response cannot come back before the diary agrees. Doing it in
// here would make this module import availability-config.ts, which imports this module -- and a cycle
// through two engines is a bug waiting for a cold start to expose it.
//
// ---- AC-04 IS THE ACCEPTANCE TEST ------------------------------------------------------------------
//
// "Before committing a change, the system identifies affected bookings and REQUIRES a resolution
// strategy." A preview that can be skipped fails it. There is therefore ONE door that writes an
// exception -- this one -- and availability-config.ts's addException() is a thin delegate to it rather
// than a second writer. Two writers would mean two places to forget the requirement, and the one that
// forgot it would be the one somebody's integration called.
//
// ---- THREE RULES THIS FILE EXISTS TO ENFORCE ---------------------------------------------------------
//
//   1. `keep_pending` IS NOT RESOLVED. Migration 242's CHECK says so in SQL and this file says so in
//      TypeScript. Parking a patient is a decision, not a resolution; if the two collapsed, a
//      practitioner could clear the queue by deciding to do nothing, and the queue is the whole feature.
//   2. `impact_reviewed_at` NULL MEANS NOT REVIEWED, NEVER "nobody was affected". Those are different
//      answers and only one of them is safe. Nothing in this file ever infers the second from the first.
//   3. A FAILED READ IS NEVER A ZERO. If the bookings query fails, calculateImpact returns UNREADABLE and
//      commitScheduleChange REFUSES. A preview that reported nought because the database did not answer
//      would cancel a clinic and tell the practitioner nobody was in it.
//
// ---- WHAT IS HONESTLY ABSENT -------------------------------------------------------------------------
//
//   s5.3 names six resolutions. Three of them are BUILT (keep pending, cancel, moved-to-another-
//   appointment) and three are not: "offer next available" needs s7's rule engine to generate and hold
//   offers, and "move to waiting list" needs a waiting list, which this schema does not have. They are
//   REFUSED with the reason named rather than stored as words -- a resolution that stores a decision
//   nothing acts on is worse than an absent one, because the queue then shows the patient as handled.
//
//   s5.3 also asks for "wait-listed" bookings to be counted. practice_appointment has six statuses and
//   none of them is wait-listed, so there is nothing to count; the note on every preview says so rather
//   than letting a silent nought stand in for a missing concept.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

export type EngineResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; code: string; message: string };

/** The three states, as practice-sessions.ts defines them. `ok` with an empty value is not `unreadable`. */
export type Reading<T> =
  | { state: "ok"; value: T }
  | { state: "unreadable"; reason: string };

export const impactReadingValue = <T>(r: Reading<T>, fallback: T): T =>
  r.state === "ok" ? r.value : fallback;

const nowIso = () => new Date().toISOString();

// ── WHO IS IN THE TIME BEING CHANGED ─────────────────────────────────────────────────────────────────

/**
 * ONE AFFECTED BOOKING, in the form a screen may show it.
 *
 * ⚠ `patientName` IS NULL UNLESS THE CALLER HOLDS `patient.view`. s5.3 asks for a "patient-safe summary",
 * s14 says patient-facing errors "must never reveal internal capacity, other patients or hidden schedule
 * details", and the person who may edit a diary is not automatically the person who may read a patient
 * list. `reference` is always present so a booking can be discussed, counted and resolved without a name.
 */
export type AffectedBooking = {
  appointmentId: string;
  patientId: string | null;
  /** Null when the caller may not see patient names. Absence of a name is not absence of a patient. */
  patientName: string | null;
  /** Always present. The last six characters of the appointment id -- enough to point at one row. */
  reference: string;
  scheduledAt: string;
  /** The practice's own date for that instant, so a summary reads in the practitioner's calendar. */
  date: string;
  timeOfDay: string;
  durationMinutes: number;
  appointmentType: string;
  status: string;
  locationId: string | null;
  locationName: string | null;
  /**
   * ⚠ TRUE means this appointment carries no location at all, and the change names one. It is INCLUDED
   * rather than excluded: over-reporting puts a patient in front of a human, under-reporting strands
   * them. The screen says which ones these are.
   */
  locationUncertain: boolean;
  /** s5.3's "follow-up-linked". Null means the follow-up table could not be read -- not "no". */
  followUpLinked: boolean | null;
  /** The decision already recorded against this booking for this change, if there is one. */
  resolution: string | null;
  resolved: boolean;
};

export type ImpactPreview = {
  kind: string;
  fromDate: string;
  toDate: string;
  startsMinute: number | null;
  endsMinute: number | null;
  locationId: string | null;
  /** THE COUNT IS THE LENGTH OF `bookings`, always. It is never computed a second way. */
  count: number;
  bookings: AffectedBooking[];
  /** Whether this caller was shown names. False is a permission fact, not a data fact. */
  namesVisible: boolean;
  /** True when the kind only ADDS time, so nobody already booked can be disturbed by it. */
  addsTimeOnly: boolean;
  /** Whether the follow-up linkage could be read. False leaves every `followUpLinked` null. */
  followUpsReadable: boolean;
  /** Said on every preview, because a nought needs its own caveats stated. */
  notes: string[];
};

/**
 * s5.3 step 1 -- "Calculate all confirmed, requested, wait-listed and follow-up-linked bookings affected
 * by the proposed change."
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────────────
 * ⚠ THIS RETURNS A Reading, AND AN UNREADABLE ANSWER IS NOT A ZERO.
 *
 * "The database did not answer" and "nobody is booked" are the same number and opposite facts. The
 * direction that costs a patient their appointment is the one that guesses, so every caller that acts on
 * this must refuse when it is unreadable -- and commitScheduleChange does.
 * ────────────────────────────────────────────────────────────────────────────────────────────────────
 *
 * It works for a PROPOSAL as well as a stored exception, which is what makes the preview possible: the
 * argument is the shape of the change, not the id of a row, so the same calculation runs before the
 * insert and after it.
 */
export async function calculateImpact(admin: any, ctx: WorkspaceContext, args: {
  kind: string;
  fromDate: string;
  toDate: string;
  locationId?: string | null;
  startsMinute?: number | null;
  endsMinute?: number | null;
  /** When given, decisions already recorded for that exception are joined on. */
  exceptionId?: string | null;
}): Promise<Reading<ImpactPreview>> {
  const namesVisible = ctx.capabilities.includes("patient.view");
  const startsMinute = args.startsMinute ?? null;
  const endsMinute = args.endsMinute ?? null;
  const locationId = args.locationId ?? null;

  const notes: string[] = [];
  const base: Omit<ImpactPreview, "count" | "bookings" | "followUpsReadable" | "notes"> = {
    kind: args.kind, fromDate: args.fromDate, toDate: args.toDate,
    startsMinute, endsMinute, locationId,
    namesVisible,
    addsTimeOnly: ADDS_TIME.includes(args.kind),
  };

  // ── A KIND THAT ONLY ADDS TIME CANNOT STRAND ANYBODY, and that is a DERIVATION rather than a guess.
  //
  // Running the bookings query for a one-off Saturday clinic would find every appointment already in
  // that window and report them as "affected" by time being ADDED to the week. The nought here is
  // computed from the kind, is labelled as such, and is not the same nought a failed read would produce.
  if (ADDS_TIME.includes(args.kind)) {
    return {
      state: "ok",
      value: {
        ...base, count: 0, bookings: [], followUpsReadable: true,
        notes: [
          `${exceptionKind(args.kind)?.label ?? args.kind} only adds time to the week, so no existing booking can be disturbed by it. This nought is derived from the kind of change, not from an empty query.`,
        ],
      },
    };
  }

  const { data: ws, error: wsErr } = await admin.from("practice_workspace")
    .select("timezone").eq("id", ctx.workspaceId).maybeSingle();
  if (wsErr)
    return { state: "unreadable", reason: `the practice timezone could not be read: ${wsErr.message}` };
  const timezone = (ws?.timezone as string) || "UTC";

  const dates = exceptionDates(args.fromDate, args.toDate);
  if (dates.length === 0)
    return { state: "unreadable", reason: "the change covers no dates, so nothing could be calculated" };

  // A coarse window for the query, narrowed per day in TypeScript. One query rather than one per day:
  // a fortnight of leave would otherwise be fourteen round trips to answer one question.
  const coarseFrom = zonedDayRange(dates[0], timezone).startIso;
  const coarseTo = zonedDayRange(dates[dates.length - 1], timezone).endIso;

  const { data: appts, error: apptErr } = await admin.from("practice_appointment")
    .select("id, patient_id, patient_name, scheduled_at, duration_minutes, appointment_type, status, location_id")
    .eq("workspace_id", ctx.workspaceId)
    // s5.3's "confirmed, requested" plus the patient already at the desk. CANCELLED, NO_SHOW and
    // COMPLETED are excluded -- cancelling Friday does not strand the patient who cancelled on Tuesday.
    .in("status", LIVE_BOOKING_STATUSES)
    .gte("scheduled_at", coarseFrom).lt("scheduled_at", coarseTo)
    .order("scheduled_at");
  if (apptErr)
    return { state: "unreadable", reason: `the bookings in that window could not be read: ${apptErr.message}` };

  // Per-day windows, computed once.
  const dayWindows = new Map<string, { start: number; end: number }>();
  for (const d of dates) {
    const range = zonedDayRange(d, timezone);
    const dayStart = Date.parse(range.startIso);
    dayWindows.set(d, startsMinute != null && endsMinute != null
      ? { start: dayStart + startsMinute * 60000, end: dayStart + endsMinute * 60000 }
      : { start: dayStart, end: Date.parse(range.endIso) });
  }

  const rows = (appts ?? []) as any[];
  const hits: any[] = [];
  for (const a of rows) {
    const s = Date.parse(a.scheduled_at);
    const e = s + ((a.duration_minutes as number | null) ?? 20) * 60000;
    const date = new Date(s).toLocaleDateString("en-CA", { timeZone: timezone });
    const w = dayWindows.get(date);
    if (!w) continue;
    // Half-open overlap, the same test the slot generator and the booking preview use.
    if (!(s < w.end && e > w.start)) continue;

    const apptLocation = (a.location_id as string | null) ?? null;
    if (locationId) {
      // A change scoped to one place. An appointment somewhere ELSE is not affected -- that is the
      // assertion this whole branch exists for. An appointment with NO location recorded is included
      // and flagged, because the alternative is to decide on a patient's behalf that they are elsewhere.
      if (apptLocation !== null && apptLocation !== locationId) continue;
    }
    hits.push({ row: a, date, locationUncertain: locationId !== null && apptLocation === null });
  }

  // ── s5.3's "follow-up-linked". An ANNOTATION, not the count -- so a follow-up outage marks the flag
  // unknown and says so, rather than blocking every schedule change in the practice.
  let followUpsReadable = true;
  const followUpLinked = new Set<string>();
  if (hits.length > 0) {
    const { data: fups, error: fupErr } = await admin.from("practice_follow_up")
      .select("appointment_id")
      .eq("workspace_id", ctx.workspaceId)
      .in("appointment_id", hits.map(h => h.row.id as string));
    if (fupErr) followUpsReadable = false;
    else for (const f of ((fups ?? []) as any[])) followUpLinked.add(f.appointment_id as string);
  }

  // Location names, so a summary can say where rather than which uuid.
  const { data: locs } = await admin.from("practice_location")
    .select("id, name").eq("workspace_id", ctx.workspaceId);
  const locName = new Map(((locs ?? []) as any[]).map(l => [l.id as string, l.name as string]));

  // Decisions already recorded against this exception, when there is one.
  const decided = new Map<string, { resolution: string; resolved: boolean }>();
  if (args.exceptionId) {
    const { data: actions, error: actErr } = await admin.from("practice_affected_booking_action")
      .select("appointment_id, resolution, resolved")
      .eq("workspace_id", ctx.workspaceId).eq("exception_id", args.exceptionId);
    if (actErr)
      return { state: "unreadable", reason: `the decisions already recorded for this change could not be read: ${actErr.message}` };
    for (const r of ((actions ?? []) as any[]))
      decided.set(r.appointment_id as string, { resolution: r.resolution as string, resolved: r.resolved === true });
  }

  const bookings: AffectedBooking[] = hits.map(h => {
    const a = h.row;
    const s = Date.parse(a.scheduled_at);
    const d = decided.get(a.id as string) ?? null;
    return {
      appointmentId: a.id as string,
      patientId: (a.patient_id as string | null) ?? null,
      patientName: namesVisible ? ((a.patient_name as string | null) ?? null) : null,
      reference: String(a.id).slice(-6).toUpperCase(),
      scheduledAt: a.scheduled_at as string,
      date: h.date as string,
      timeOfDay: new Date(s).toLocaleTimeString("en-GB", {
        timeZone: timezone, hour: "2-digit", minute: "2-digit", hour12: false,
      }),
      durationMinutes: (a.duration_minutes as number | null) ?? 20,
      appointmentType: (a.appointment_type as string) ?? "new_consultation",
      status: (a.status as string) ?? "REQUESTED",
      locationId: (a.location_id as string | null) ?? null,
      locationName: a.location_id ? locName.get(a.location_id as string) ?? null : null,
      locationUncertain: h.locationUncertain === true,
      followUpLinked: followUpsReadable ? followUpLinked.has(a.id as string) : null,
      resolution: d?.resolution ?? null,
      resolved: d?.resolved ?? false,
    } satisfies AffectedBooking;
  });

  if (!namesVisible)
    notes.push("Patient names are hidden because this account does not hold patient.view. The count and the times are complete; only the names are withheld.");
  if (!followUpsReadable)
    notes.push("Whether any of these is linked to a follow-up plan could not be read, so that column is unknown rather than no.");
  if (bookings.some(b => b.locationUncertain))
    notes.push("Some of these appointments have no location recorded. They are listed because a change that names a place cannot prove they are somewhere else.");
  // s5.3 asks for wait-listed bookings too. Stated rather than silently absent.
  notes.push("A waiting list is not part of this schema, so no wait-listed booking is included -- there is no such status on an appointment to include.");

  return { state: "ok", value: { ...base, count: bookings.length, bookings, followUpsReadable, notes } };
}

// ── COMMITTING A CHANGE ──────────────────────────────────────────────────────────────────────────────

export type CommitReport = {
  exceptionId: string;
  kind: string;
  days: number;
  /** The number that was shown before the commit, and the number acted on. One figure, not two. */
  affected: number;
  resolution: string;
  actionsCreated: number;
  /** Rows that already existed for this exception and booking. Re-running does not duplicate them. */
  actionsAlreadyPresent: number;
  appointmentsCancelled: number;
  impactReviewedAt: string;
};

/**
 * s5.3 IN ITS OWN ORDER, and the only door that writes practice_availability_exception.
 *
 * ⚠ THE RESOLUTION IS REQUIRED WHENEVER ANYBODY IS AFFECTED (AC-04). Omitting it is refused with the
 * count in the refusal, so the message is an instruction rather than a wall. When NOBODY is affected the
 * only permitted answer is s5.3's own `no_patient_impact` -- "allowed only when no active booking is
 * affected" -- which makes the two directions symmetrical: you cannot claim no impact when there is one,
 * and you cannot claim a reschedule when there is nothing to reschedule.
 *
 * ⚠ `impact_reviewed_at` IS WRITTEN BY THIS FUNCTION AND BY NOTHING ELSE. It records that a human was
 * shown the number and answered it. A row where it is null has not been reviewed, and no screen may read
 * that as "nobody was affected".
 */
export async function commitScheduleChange(admin: any, ctx: WorkspaceContext, args: {
  kind: string;
  fromDate: string;
  toDate: string;
  locationId?: string | null;
  clinicId?: string | null;
  startsMinute?: number | null;
  endsMinute?: number | null;
  slotKind?: string;
  appointmentMinutes?: number | null;
  reason?: string | null;
  replacementLocationId?: string | null;
  replacementActivityType?: string | null;
  /** s5.3 step 3. Required whenever the calculated impact is above nought. */
  resolution?: string | null;
  /** Recorded on every action row created by this commit. */
  note?: string | null;
  actorId: string;
  correlationId: string;
}): Promise<EngineResult<CommitReport>> {
  // s14: "Create exception -- account owner: yes; authorised staff: PERMISSION-DEPENDENT."
  if (!ctx.capabilities.includes("appointment.manage"))
    return { ok: false, status: 403, code: "FORBIDDEN", message: "appointment.manage is required" };

  const kind = exceptionKind(args.kind);
  if (!kind)
    return {
      ok: false, status: 400, code: "VALIDATION_ERROR",
      message: `kind must be one of: ${EXCEPTION_KIND_CODES.join(", ")}`,
    };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(args.fromDate) || !/^\d{4}-\d{2}-\d{2}$/.test(args.toDate))
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: "a change needs a first and last date, as YYYY-MM-DD" };
  if (args.toDate < args.fromDate)
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: "the last date cannot be before the first" };

  // ADDING TIME REQUIRES SAYING WHEN; REMOVING IT DOES NOT. Leave takes the day.
  const startsMinute = args.startsMinute ?? null;
  const endsMinute = args.endsMinute ?? null;
  if (kind.needsWindow && (startsMinute == null || endsMinute == null))
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: `${kind.label.toLowerCase()} needs a start and an end` };
  if (startsMinute != null && endsMinute != null && endsMinute <= startsMinute)
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: "a session must end after it starts" };

  // ── s5.2's TWO RESHAPING KINDS MUST SAY WHAT THEY BECOME. Migration 242 refuses these in SQL too;
  // refusing them here as well is what makes the message readable instead of a constraint name.
  const replacementLocationId = args.replacementLocationId ?? null;
  const replacementActivityType = args.replacementActivityType ?? null;
  if (kind.needsReplacementLocation && !replacementLocationId)
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: "a location change has to say where the session moves to" };
  if (kind.needsReplacementActivity && !replacementActivityType)
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: "an activity substitution has to say what the session becomes" };
  if (!kind.needsReplacementLocation && replacementLocationId)
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: `a ${kind.label.toLowerCase()} does not move anywhere, so it cannot name a replacement location` };
  if (!kind.needsReplacementActivity && replacementActivityType)
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: `a ${kind.label.toLowerCase()} does not change what the session is, so it cannot name a replacement activity` };
  if (replacementActivityType && !ACTIVITY_TYPES.includes(replacementActivityType as ActivityType))
    return {
      ok: false, status: 400, code: "VALIDATION_ERROR",
      message: `"${replacementActivityType}" is not an activity this practice recognises, so a day substituted to it is a day nobody could start`,
    };

  for (const [id, what] of [[args.locationId ?? null, "location"], [replacementLocationId, "replacement location"]] as const) {
    if (!id) continue;
    const { data: loc, error } = await admin.from("practice_location")
      .select("id, active, name").eq("id", id).eq("workspace_id", ctx.workspaceId).maybeSingle();
    if (error) return { ok: false, status: 500, code: "READ_FAILED", message: `the ${what} could not be read: ${error.message}` };
    if (!loc) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };
    if (what === "replacement location" && !loc.active)
      return { ok: false, status: 422, code: "LOCATION_CLOSED", message: `${loc.name} is closed, so a session cannot be moved to it` };
  }
  if (replacementLocationId && replacementLocationId === (args.locationId ?? null))
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: "the session is already there; a location change has to move it somewhere else" };

  // ══ s5.3 STEP 1: CALCULATE ═══════════════════════════════════════════════════════════════════════
  const impact = await calculateImpact(admin, ctx, {
    kind: args.kind, fromDate: args.fromDate, toDate: args.toDate,
    locationId: args.locationId ?? null, startsMinute, endsMinute,
  });
  // ⚠ A FAILED READ IS NEVER A ZERO. Committing here would cancel a clinic and report that nobody was in
  // it, which is the one outcome this whole module exists to prevent.
  if (impact.state !== "ok")
    return {
      ok: false, status: 503, code: "IMPACT_UNREADABLE",
      message: `this change was not made because ${impact.reason} — and an unread booking is not an absent one`,
    };
  const affected = impact.value.count;

  // ══ s5.3 STEP 3: REQUIRE A RESOLUTION ════════════════════════════════════════════════════════════
  const chosen = args.resolution ?? (affected === 0 ? "no_patient_impact" : null);
  if (!chosen)
    return {
      ok: false, status: 422, code: "RESOLUTION_REQUIRED",
      message: `${affected} booking${affected === 1 ? " is" : "s are"} in the time you are changing. Choose what happens to ${affected === 1 ? "it" : "them"} before this change is made: ${RESOLUTIONS_AT_COMMIT.filter(c => c !== "no_patient_impact").join(", ")}.`,
    };
  if (!RESOLUTIONS.some(r => r.code === chosen))
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: `"${chosen}" is not one of the resolutions in s5.3` };
  if (!RESOLUTIONS_BUILT.includes(chosen)) {
    const r = RESOLUTIONS.find(x => x.code === chosen)!;
    return { ok: false, status: 422, code: "RESOLUTION_NOT_BUILT", message: `"${r.label}" is not built. ${r.detail}` };
  }
  if (!RESOLUTIONS_AT_COMMIT.includes(chosen)) {
    const r = RESOLUTIONS.find(x => x.code === chosen)!;
    return {
      ok: false, status: 422, code: "RESOLUTION_PER_PATIENT",
      message: `"${r.label}" is a decision about one patient, not a strategy for a group. Commit the change with another strategy and then choose it for each booking in the action queue.`,
    };
  }
  // s5.3: "No patient impact -- ALLOWED ONLY WHEN NO ACTIVE BOOKING IS AFFECTED." Both directions.
  if (chosen === "no_patient_impact" && affected > 0)
    return {
      ok: false, status: 422, code: "PATIENTS_ARE_AFFECTED",
      message: `${affected} booking${affected === 1 ? " is" : "s are"} in the time you are changing, so "no patient impact" is not true of it. Choose what happens to ${affected === 1 ? "that patient" : "those patients"}.`,
    };
  if (chosen !== "no_patient_impact" && affected === 0)
    return {
      ok: false, status: 422, code: "NOBODY_IS_AFFECTED",
      message: "nobody is booked into the time you are changing, so there is nothing to reschedule or cancel. Record it as no patient impact.",
    };

  // ══ s5.3 STEP 4: APPLY THE CHANGE ════════════════════════════════════════════════════════════════
  const reviewedAt = nowIso();
  const { data: created, error: insErr } = await admin.from("practice_availability_exception").insert({
    workspace_id: ctx.workspaceId,
    location_id: args.locationId ?? null,
    clinic_id: args.clinicId ?? null,
    kind: args.kind,
    from_date: args.fromDate, to_date: args.toDate,
    starts_minute: startsMinute, ends_minute: endsMinute,
    slot_kind: args.slotKind ?? (args.kind === "leave" ? "leave" : "clinic"),
    appointment_minutes: args.appointmentMinutes ?? null,
    reason: args.reason ?? null,
    replacement_location_id: replacementLocationId,
    replacement_activity_type: replacementActivityType,
    // ⚠ WRITTEN IN THE SAME STATEMENT AS THE CHANGE. A second UPDATE could fail and leave a committed
    // change whose impact reads as never reviewed -- which is exactly the state a screen must treat as
    // "not ready", so the row would be permanently wrong about itself.
    impact_reviewed_at: reviewedAt,
    impact_reviewed_by: args.actorId,
    created_by: args.actorId,
  }).select("id").maybeSingle();
  if (insErr) return { ok: false, status: 422, code: "REFUSED_BY_DATABASE", message: insErr.message };
  if (!created) return { ok: false, status: 500, code: "INSERT_FAILED", message: "the change was not made" };
  const exceptionId = created.id as string;

  // ══ s5.3 STEP 4 CONTINUED: CREATE PATIENT ACTIONS AND LOG THE DECISION ═══════════════════════════
  const applied = await applyImpact(admin, ctx, {
    exceptionId, bookings: impact.value.bookings, resolution: chosen,
    note: args.note ?? null, actorId: args.actorId, correlationId: args.correlationId,
  });
  if (!applied.ok) return applied;

  await audit(admin, {
    workspaceId: ctx.workspaceId, actorId: args.actorId,
    eventType: "practice.schedule_change_committed",
    payload: {
      exceptionId, kind: args.kind, fromDate: args.fromDate, toDate: args.toDate,
      locationId: args.locationId ?? null,
      window: startsMinute != null && endsMinute != null
        ? `${hhmmOfDay(startsMinute)}-${hhmmOfDay(endsMinute)}` : "whole day",
      replacementLocationId, replacementActivityType,
      // THE DECISION, LOGGED WITH THE NUMBER IT WAS MADE ABOUT. s5.3 step 4 asks for the decision to be
      // logged; a decision without the count it answered cannot afterwards be judged.
      affected, resolution: chosen,
      actionsCreated: applied.data.created, appointmentsCancelled: applied.data.cancelled,
      // s14: "Every configuration change records actor, timestamp, before/after values."
      impactReviewedAt: reviewedAt,
      // Named ids, so an auditor can see WHICH bookings rather than how many.
      appointmentIds: impact.value.bookings.map(b => b.appointmentId),
    },
    correlationId: args.correlationId,
  });

  return {
    ok: true,
    data: {
      exceptionId, kind: args.kind,
      days: exceptionDates(args.fromDate, args.toDate).length,
      affected, resolution: chosen,
      actionsCreated: applied.data.created,
      actionsAlreadyPresent: applied.data.alreadyPresent,
      appointmentsCancelled: applied.data.cancelled,
      impactReviewedAt: reviewedAt,
    },
  };
}

/**
 * RE-RUN THE CALCULATION FOR A CHANGE THAT IS ALREADY RECORDED.
 *
 * A change is committed on Monday and somebody books into the Friday it closes on Tuesday. The action
 * queue would never know: the calculation ran once, before that booking existed. This is the door that
 * catches up, and s17 asks for exactly this property in so many words -- "exception processing and
 * notifications are RETRYABLE AND IDEMPOTENT".
 *
 * ⚠ IT ADDS AND NEVER REPLACES. A booking that already has an action row keeps the decision recorded
 * against it; only bookings with no row at all get one, and they get `keep_pending` -- because nobody
 * has decided about them yet, and inheriting the strategy the original commit used would be the engine
 * deciding on a practitioner's behalf about a patient who was not in the room.
 */
export async function recalculateImpact(admin: any, ctx: WorkspaceContext, args: {
  exceptionId: string; actorId: string; correlationId: string;
}): Promise<EngineResult<{ exceptionId: string; affected: number; created: number; alreadyPresent: number }>> {
  if (!ctx.capabilities.includes("appointment.manage"))
    return { ok: false, status: 403, code: "FORBIDDEN", message: "appointment.manage is required" };

  const { data: e, error } = await admin.from("practice_availability_exception")
    .select("id, kind, from_date, to_date, location_id, starts_minute, ends_minute")
    .eq("id", args.exceptionId).eq("workspace_id", ctx.workspaceId).maybeSingle();
  if (error) return { ok: false, status: 500, code: "READ_FAILED", message: `the change could not be read: ${error.message}` };
  if (!e) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };

  const impact = await calculateImpact(admin, ctx, {
    kind: e.kind as string, fromDate: e.from_date as string, toDate: e.to_date as string,
    locationId: (e.location_id as string | null) ?? null,
    startsMinute: (e.starts_minute as number | null) ?? null,
    endsMinute: (e.ends_minute as number | null) ?? null,
  });
  if (impact.state !== "ok")
    return { ok: false, status: 503, code: "IMPACT_UNREADABLE", message: impact.reason };

  const applied = await applyImpact(admin, ctx, {
    exceptionId: e.id as string, bookings: impact.value.bookings,
    resolution: "keep_pending", note: null,
    actorId: args.actorId, correlationId: args.correlationId,
  });
  if (!applied.ok) return applied;

  return {
    ok: true,
    data: {
      exceptionId: e.id as string, affected: impact.value.count,
      created: applied.data.created, alreadyPresent: applied.data.alreadyPresent,
    },
  };
}

/**
 * ONE ROW PER AFFECTED BOOKING, AND EXACTLY ONE.
 *
 * ⚠ IDEMPOTENT, and it has to be. Migration 242's unique index on (exception_id, appointment_id) is the
 * backstop -- a second row would let two decisions about one patient both look current, and the queue
 * could not say which was acted on -- but a backstop that fires as an error is a 500 on a re-run. So the
 * existing rows are read first and only the missing ones are inserted, and the insert's error is READ:
 * this project has twice shipped a write whose error was discarded and which therefore never happened.
 */
async function applyImpact(admin: any, ctx: WorkspaceContext, args: {
  exceptionId: string;
  bookings: AffectedBooking[];
  resolution: string;
  note: string | null;
  actorId: string;
  correlationId: string;
}): Promise<EngineResult<{ created: number; alreadyPresent: number; cancelled: number }>> {
  if (args.bookings.length === 0) return { ok: true, data: { created: 0, alreadyPresent: 0, cancelled: 0 } };

  const { data: existing, error: readErr } = await admin.from("practice_affected_booking_action")
    .select("appointment_id").eq("workspace_id", ctx.workspaceId).eq("exception_id", args.exceptionId);
  if (readErr)
    return { ok: false, status: 500, code: "READ_FAILED", message: `the actions already recorded could not be read: ${readErr.message}` };
  const have = new Set(((existing ?? []) as any[]).map(r => r.appointment_id as string));

  const missing = args.bookings.filter(b => !have.has(b.appointmentId));
  const resolves = args.resolution !== "keep_pending";
  const decidedAt = nowIso();

  let created = 0;
  if (missing.length > 0) {
    const { data: rows, error } = await admin.from("practice_affected_booking_action").insert(
      missing.map(b => ({
        workspace_id: ctx.workspaceId,
        exception_id: args.exceptionId,
        appointment_id: b.appointmentId,
        patient_id: b.patientId,
        resolution: args.resolution,
        // ⚠ DERIVED FROM THE RESOLUTION, NEVER PASSED IN. Migration 242's CHECK enforces the same fact;
        // computing it here means the two can never disagree, and `keep_pending` can never arrive as
        // resolved because somebody sent a boolean.
        resolved: resolves,
        decided_at: resolves ? decidedAt : null,
        decided_by: resolves ? args.actorId : null,
        note: args.note && args.note.trim() ? args.note.trim().slice(0, 500) : null,
        created_by: args.actorId,
      })),
    ).select("id");
    if (error) return { ok: false, status: 422, code: "REFUSED_BY_DATABASE", message: error.message };
    created = (rows ?? []).length;
  }

  // s5.3's "Cancel and notify -- cancel with reason and trigger configured message". The cancellation is
  // real; the message is not built and the caller is told so rather than shown a tick.
  let cancelled = 0;
  if (args.resolution === "cancel_and_notify") {
    for (const b of missing) {
      const done = await cancelAppointment(admin, ctx, {
        appointmentId: b.appointmentId,
        reason: args.note ?? "The clinic was changed.",
        actorId: args.actorId, correlationId: args.correlationId,
      });
      if (!done.ok) return done;
      if (done.data.cancelled) cancelled++;
    }
  }

  return { ok: true, data: { created, alreadyPresent: args.bookings.length - missing.length, cancelled } };
}

/**
 * Cancel one appointment because a schedule change removed the time under it.
 *
 * ⚠ WRITTEN HERE RATHER THAN CALLED FROM scheduling.ts, AND THAT IS AN IMPORT-CYCLE DECISION, NOT A
 * PREFERENCE. scheduling.ts imports availability-config.ts for resolveBookingRule, and
 * availability-config.ts imports THIS module so that addException has one writer -- so importing
 * transitionAppointment would close the loop availability-config -> schedule-exceptions -> scheduling ->
 * availability-config. The behaviour kept is the part that matters: the live-status guard and the
 * optimistic version check, so two desks acting at once cannot both win silently.
 */
async function cancelAppointment(admin: any, ctx: WorkspaceContext, args: {
  appointmentId: string; reason: string; actorId: string; correlationId: string;
}): Promise<EngineResult<{ cancelled: boolean }>> {
  const { data: appt, error } = await admin.from("practice_appointment")
    .select("id, status, record_version, reason")
    .eq("id", args.appointmentId).eq("workspace_id", ctx.workspaceId).maybeSingle();
  if (error)
    return { ok: false, status: 500, code: "READ_FAILED", message: `an appointment could not be read: ${error.message}` };
  if (!appt) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };
  // Already gone by another route. Not an error, and not a cancellation either.
  if (!LIVE_BOOKING_STATUSES.includes(appt.status as string)) return { ok: true, data: { cancelled: false } };

  const { data: updated, error: upErr } = await admin.from("practice_appointment")
    .update({
      status: "CANCELLED",
      reason: args.reason.slice(0, 500),
      record_version: (appt.record_version as number) + 1,
      updated_at: nowIso(), updated_by: args.actorId,
    })
    .eq("id", appt.id).eq("record_version", appt.record_version).select("id").maybeSingle();
  if (upErr) return { ok: false, status: 422, code: "REFUSED_BY_DATABASE", message: upErr.message };
  if (!updated)
    return { ok: false, status: 409, code: "VERSION_CONFLICT", message: "an appointment changed underneath you; reload and try again" };

  await audit(admin, {
    workspaceId: ctx.workspaceId, actorId: args.actorId, eventType: "practice.appointment_cancelled",
    payload: { appointmentId: appt.id, because: "schedule_change", reason: args.reason },
    correlationId: args.correlationId,
  });
  return { ok: true, data: { cancelled: true } };
}

// ── THE ACTION QUEUE ─────────────────────────────────────────────────────────────────────────────────

export type QueuedAction = {
  id: string;
  exceptionId: string;
  exceptionKind: string;
  exceptionFromDate: string;
  exceptionToDate: string;
  exceptionReason: string | null;
  appointmentId: string;
  patientId: string | null;
  patientName: string | null;
  reference: string;
  scheduledAt: string | null;
  appointmentStatus: string | null;
  resolution: string;
  resolved: boolean;
  note: string | null;
  decidedAt: string | null;
  createdAt: string;
};

/**
 * s5.3: "Bookings remain unresolved and APPEAR IN AN ACTION QUEUE."
 *
 * ⚠ THE COUNT ON THE LAYER CARD IS THE LENGTH OF THIS LIST. It is never computed with a head+count query
 * beside it -- two ways to count one thing is how a figure and the list under it come to disagree, and
 * the practitioner then trusts neither.
 */
export async function affectedBookingQueue(
  admin: any, ctx: WorkspaceContext, opts: { includeResolved?: boolean } = {},
): Promise<Reading<QueuedAction[]>> {
  const namesVisible = ctx.capabilities.includes("patient.view");

  let q = admin.from("practice_affected_booking_action")
    .select("id, exception_id, appointment_id, patient_id, resolution, resolved, note, decided_at, created_at")
    .eq("workspace_id", ctx.workspaceId).order("created_at", { ascending: false });
  if (!opts.includeResolved) q = q.eq("resolved", false);
  const { data: actions, error } = await q;
  if (error)
    return { state: "unreadable", reason: `the action queue could not be read: ${error.message}` };

  const rows = (actions ?? []) as any[];
  if (rows.length === 0) return { state: "ok", value: [] };

  const [{ data: excs, error: excErr }, { data: appts, error: apptErr }] = await Promise.all([
    admin.from("practice_availability_exception")
      .select("id, kind, from_date, to_date, reason")
      .eq("workspace_id", ctx.workspaceId).in("id", [...new Set(rows.map(r => r.exception_id as string))]),
    admin.from("practice_appointment")
      .select("id, patient_name, scheduled_at, status")
      .eq("workspace_id", ctx.workspaceId).in("id", [...new Set(rows.map(r => r.appointment_id as string))]),
  ]);
  // ⚠ REFUSES RATHER THAN RENDERING A QUEUE OF UNNAMED ROWS. A queue entry a practitioner cannot
  // identify is a queue entry they cannot act on, so a half-read queue is not a shorter queue.
  if (excErr) return { state: "unreadable", reason: `the changes behind the queue could not be read: ${excErr.message}` };
  if (apptErr) return { state: "unreadable", reason: `the appointments in the queue could not be read: ${apptErr.message}` };

  const exc = new Map(((excs ?? []) as any[]).map(e => [e.id as string, e]));
  const appt = new Map(((appts ?? []) as any[]).map(a => [a.id as string, a]));

  return {
    state: "ok",
    value: rows.map(r => {
      const e = exc.get(r.exception_id as string);
      const a = appt.get(r.appointment_id as string);
      return {
        id: r.id as string,
        exceptionId: r.exception_id as string,
        exceptionKind: (e?.kind as string) ?? "unknown",
        exceptionFromDate: (e?.from_date as string) ?? "",
        exceptionToDate: (e?.to_date as string) ?? "",
        exceptionReason: (e?.reason as string | null) ?? null,
        appointmentId: r.appointment_id as string,
        patientId: (r.patient_id as string | null) ?? null,
        patientName: namesVisible ? ((a?.patient_name as string | null) ?? null) : null,
        reference: String(r.appointment_id).slice(-6).toUpperCase(),
        scheduledAt: (a?.scheduled_at as string | null) ?? null,
        appointmentStatus: (a?.status as string | null) ?? null,
        resolution: r.resolution as string,
        resolved: r.resolved === true,
        note: (r.note as string | null) ?? null,
        decidedAt: (r.decided_at as string | null) ?? null,
        createdAt: r.created_at as string,
      } satisfies QueuedAction;
    }),
  };
}

/**
 * s5.3's per-patient decision. "Bulk reschedule -- user selects another session and CONFIRMS
 * PATIENT-BY-PATIENT EXCEPTIONS", which is why the unit of the decision is a person and not a strategy.
 *
 * ⚠ `keep_pending` LEAVES `resolved` FALSE. Moving an action back to pending is a legitimate thing to do
 * -- a practitioner who cancelled the wrong patient must be able to put the question back -- and the
 * flag follows the resolution rather than the act of pressing a button.
 */
export async function resolveAffectedBooking(admin: any, ctx: WorkspaceContext, args: {
  actionId: string;
  resolution: string;
  note?: string | null;
  /** Required by `bulk_reschedule`: the appointment this patient was actually moved to. */
  rescheduledAppointmentId?: string | null;
  actorId: string;
  correlationId: string;
}): Promise<EngineResult<{ id: string; resolution: string; resolved: boolean; cancelled: boolean }>> {
  if (!ctx.capabilities.includes("appointment.manage"))
    return { ok: false, status: 403, code: "FORBIDDEN", message: "appointment.manage is required" };

  const r = RESOLUTIONS.find(x => x.code === args.resolution);
  if (!r) return { ok: false, status: 400, code: "VALIDATION_ERROR", message: `"${args.resolution}" is not one of the resolutions in s5.3` };
  if (!RESOLUTIONS_BUILT.includes(r.code))
    return { ok: false, status: 422, code: "RESOLUTION_NOT_BUILT", message: `"${r.label}" is not built. ${r.detail}` };
  if (!RESOLUTIONS_PER_BOOKING.includes(r.code))
    return {
      ok: false, status: 422, code: "RESOLUTION_AT_COMMIT_ONLY",
      message: `"${r.label}" is an answer about a whole change, not about one patient.`,
    };

  const { data: action, error } = await admin.from("practice_affected_booking_action")
    .select("id, exception_id, appointment_id, resolution, resolved")
    .eq("id", args.actionId).eq("workspace_id", ctx.workspaceId).maybeSingle();
  if (error) return { ok: false, status: 500, code: "READ_FAILED", message: `the action could not be read: ${error.message}` };
  if (!action) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };

  let rescheduledAppointmentId: string | null = null;
  if (r.code === "bulk_reschedule") {
    if (!args.rescheduledAppointmentId)
      return {
        ok: false, status: 400, code: "VALIDATION_ERROR",
        message: "say which appointment this patient was moved to; a reschedule with no destination is not a reschedule",
      };
    const { data: dest, error: destErr } = await admin.from("practice_appointment")
      .select("id, status").eq("id", args.rescheduledAppointmentId)
      .eq("workspace_id", ctx.workspaceId).maybeSingle();
    if (destErr) return { ok: false, status: 500, code: "READ_FAILED", message: `the new appointment could not be read: ${destErr.message}` };
    if (!dest) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };
    if (dest.id === action.appointment_id)
      return { ok: false, status: 422, code: "VALIDATION_ERROR", message: "that is the same appointment; a reschedule has to point somewhere else" };
    if (!LIVE_BOOKING_STATUSES.includes(dest.status as string))
      return {
        ok: false, status: 422, code: "DESTINATION_NOT_LIVE",
        message: `the appointment you pointed at is ${String(dest.status).toLowerCase()}, so this patient has not been moved to it`,
      };
    rescheduledAppointmentId = dest.id as string;
  }

  // ⚠ DERIVED, NEVER PASSED IN -- the same rule applyImpact obeys, and the same rule migration 242's
  // CHECK enforces. `keep_pending` is a decision and it is not a resolution.
  const resolves = r.resolves;
  const decidedAt = resolves ? nowIso() : null;

  let cancelled = false;
  if (r.code === "cancel_and_notify") {
    const done = await cancelAppointment(admin, ctx, {
      appointmentId: action.appointment_id as string,
      reason: args.note ?? "The clinic was changed.",
      actorId: args.actorId, correlationId: args.correlationId,
    });
    if (!done.ok) return done;
    cancelled = done.data.cancelled;
  }

  const { error: upErr } = await admin.from("practice_affected_booking_action").update({
    resolution: r.code,
    resolved: resolves,
    decided_at: decidedAt,
    decided_by: resolves ? args.actorId : null,
    rescheduled_appointment_id: rescheduledAppointmentId,
    note: args.note && args.note.trim() ? args.note.trim().slice(0, 500) : null,
  }).eq("id", action.id);
  if (upErr) return { ok: false, status: 422, code: "REFUSED_BY_DATABASE", message: upErr.message };

  await audit(admin, {
    workspaceId: ctx.workspaceId, actorId: args.actorId,
    eventType: "practice.affected_booking_resolved",
    payload: {
      actionId: action.id, exceptionId: action.exception_id, appointmentId: action.appointment_id,
      from: action.resolution, to: r.code, resolved: resolves,
      rescheduledAppointmentId, cancelled,
    },
    correlationId: args.correlationId,
  });
  return { ok: true, data: { id: action.id as string, resolution: r.code, resolved: resolves, cancelled } };
}

// ── WHAT LAYER 2 DRAWS ───────────────────────────────────────────────────────────────────────────────

export type ScheduleChangeView = {
  id: string;
  kind: string;
  kindLabel: string;
  effect: string;
  fromDate: string;
  toDate: string;
  days: number;
  startsMinute: number | null;
  endsMinute: number | null;
  window: string;
  locationId: string | null;
  locationName: string | null;
  replacementLocationId: string | null;
  replacementLocationName: string | null;
  replacementActivityType: string | null;
  replacementActivityLabel: string | null;
  reason: string | null;
  /** Null MEANS NOT REVIEWED. It never means nobody was affected. */
  impactReviewedAt: string | null;
  /** How many bookings this change has action rows for, and how many are still unresolved. */
  actions: number;
  pending: number;
  /** The chip key. `unreviewed` is its own state and is never drawn as `clear`. */
  impactState: "clear" | "pending" | "settled" | "unreviewed";
  /** Where the practitioner's own day is relative to it. */
  timing: "past" | "current" | "upcoming";
};

/**
 * Layer 2's whole read: the changes, what each one did to real patients, and what is still open.
 *
 * ⚠ EVERY READ CARRIES ITS OUTCOME. A setup screen that renders a database outage as "0 upcoming
 * changes · nobody affected" tells a practitioner that a clinic they cancelled is uncancelled and that
 * the people in it are fine.
 */
export async function scheduleChanges(admin: any, ctx: WorkspaceContext, opts: { horizonDays?: number } = {}) {
  const { data: ws } = await admin.from("practice_workspace")
    .select("timezone").eq("id", ctx.workspaceId).maybeSingle();
  const timezone = (ws?.timezone as string) || "UTC";
  const today = practiceToday(timezone);
  const horizon = opts.horizonDays ?? 180;
  const horizonDate = new Date(Date.parse(`${today}T12:00:00Z`) + horizon * 86400000).toISOString().slice(0, 10);

  const [exceptions, actions, locations] = await Promise.all([
    admin.from("practice_availability_exception")
      .select("id, location_id, clinic_id, kind, from_date, to_date, starts_minute, ends_minute, reason, replacement_location_id, replacement_activity_type, impact_reviewed_at, impact_reviewed_by")
      .eq("workspace_id", ctx.workspaceId).gte("to_date", today).lte("from_date", horizonDate)
      .order("from_date"),
    admin.from("practice_affected_booking_action")
      .select("id, exception_id, resolved").eq("workspace_id", ctx.workspaceId),
    admin.from("practice_location").select("id, name").eq("workspace_id", ctx.workspaceId),
  ]);

  const locName = new Map(((locations.data ?? []) as any[]).map(l => [l.id as string, l.name as string]));

  const actionsReading: Reading<any[]> = actions.error
    ? { state: "unreadable", reason: `the affected-booking actions could not be read: ${actions.error.message}` }
    : { state: "ok", value: (actions.data ?? []) as any[] };

  const byException = new Map<string, { total: number; pending: number }>();
  for (const a of impactReadingValue(actionsReading, [] as any[])) {
    const cur = byException.get(a.exception_id as string) ?? { total: 0, pending: 0 };
    cur.total++;
    if (a.resolved !== true) cur.pending++;
    byException.set(a.exception_id as string, cur);
  }

  const changes: Reading<ScheduleChangeView[]> = exceptions.error
    ? { state: "unreadable", reason: `your schedule changes could not be read: ${exceptions.error.message}` }
    : {
      state: "ok",
      value: ((exceptions.data ?? []) as any[]).map(e => {
        const k = exceptionKind(e.kind as string);
        const counts = byException.get(e.id as string) ?? { total: 0, pending: 0 };
        const reviewed = (e.impact_reviewed_at as string | null) ?? null;

        // ⚠ THE FOUR STATES, AND THE ORDER MATTERS. "Not reviewed" is checked FIRST, so a change with no
        // action rows and no review can never fall through to "nobody affected" -- which is the reading
        // that would let an unasked question look like an answered one.
        const impactState: ScheduleChangeView["impactState"] =
          reviewed === null ? "unreviewed"
            : counts.pending > 0 ? "pending"
              : counts.total > 0 ? "settled"
                : "clear";

        return {
          id: e.id as string,
          kind: e.kind as string,
          kindLabel: k?.label ?? String(e.kind).replace(/_/g, " "),
          effect: k?.effect ?? "removes",
          fromDate: e.from_date as string,
          toDate: e.to_date as string,
          days: exceptionDates(e.from_date as string, e.to_date as string).length,
          startsMinute: (e.starts_minute as number | null) ?? null,
          endsMinute: (e.ends_minute as number | null) ?? null,
          window: e.starts_minute != null && e.ends_minute != null
            ? `${hhmmOfDay(e.starts_minute as number)}–${hhmmOfDay(e.ends_minute as number)}`
            : "the whole day",
          locationId: (e.location_id as string | null) ?? null,
          locationName: e.location_id ? locName.get(e.location_id as string) ?? null : null,
          replacementLocationId: (e.replacement_location_id as string | null) ?? null,
          replacementLocationName: e.replacement_location_id
            ? locName.get(e.replacement_location_id as string) ?? null : null,
          replacementActivityType: (e.replacement_activity_type as string | null) ?? null,
          replacementActivityLabel: e.replacement_activity_type
            ? ACTIVITY_LABEL[e.replacement_activity_type as ActivityType] ?? (e.replacement_activity_type as string)
            : null,
          reason: (e.reason as string | null) ?? null,
          impactReviewedAt: reviewed,
          actions: counts.total,
          pending: counts.pending,
          impactState,
          timing: (e.to_date as string) < today ? "past"
            : (e.from_date as string) <= today ? "current" : "upcoming",
        } satisfies ScheduleChangeView;
      }),
    };

  const queue = await affectedBookingQueue(admin, ctx);

  return {
    timezone, today, horizonDays: horizon,
    mayEdit: ctx.capabilities.includes("appointment.manage"),
    namesVisible: ctx.capabilities.includes("patient.view"),
    changes,
    queue,
    /**
     * ⚠ COUNTED FROM THE LIST, NOT FROM A SECOND QUERY. One way to count one thing.
     */
    unreviewed: changes.state === "ok"
      ? changes.value.filter(c => c.impactState === "unreviewed").length : null,
    kinds: EXCEPTION_KINDS,
    impactingKinds: IMPACTING_KINDS,
    readFailures: [changes, queue, actionsReading]
      .filter(r => r.state === "unreadable").map(r => (r as { reason: string }).reason),
  };
}
