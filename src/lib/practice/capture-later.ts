// CPR-ADOPT-001 section 2 - Capture Later.
//
// "A practitioner may mark a scheduled or walk-in patient as Seen without completing clinical capture. CP
// creates an encounter shell linked to patient, date, location, practitioner and appointment context."
//
// ⚠ THE SHELL ASSERTS NOTHING CLINICAL, AND THE PRODUCT HAS TO BE ABLE TO PROVE THAT. Section 7: "a Seen
// status must not imply that diagnoses, medications or investigations were reviewed unless explicitly
// confirmed". So the shell is written with capture_mode = 'capture_later' and NOTHING in any clinical
// field -- no outcome, no reason, no note. Everything on it is derived from the booking, which section 7
// also requires to stay distinguishable from what a practitioner confirmed.
/* eslint-disable @typescript-eslint/no-explicit-any */

export type EngineResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; code: string; message: string };

/** Statuses that mean the encounter still needs a practitioner. Everything else has been dealt with. */
export const OPEN_ENCOUNTER_STATUSES = ["DRAFT", "ACTIVE", "PAUSED"];

export type SeenResult = { encounterId: string; created: boolean };

/**
 * One tap: mark a patient Seen.
 *
 * ⚠ IT DOES NOT CREATE A SECOND SHELL FOR THE SAME VISIT. Tapping Seen twice, or tapping it on an
 * appointment a practitioner had already opened properly, must not produce two encounters for one
 * consultation -- the To Complete queue would then show the patient twice and closing one would leave the
 * other looking unfinished for ever. An existing open encounter for the same appointment is returned
 * instead, with created:false.
 */
export async function markSeen(admin: any, args: {
  workspaceId: string;
  patientId: string;
  actorId: string;
  appointmentId?: string | null;
  locationId?: string | null;
}): Promise<EngineResult<SeenResult>> {
  if (!args.workspaceId || !args.patientId)
    return { ok: false, status: 400, code: "MISSING", message: "workspace and patient are required" };

  // An existing open encounter for this visit wins. Matched on the appointment when there is one, because
  // that is what identifies "this visit" -- a walk-in has no appointment and is matched on the patient
  // within this workspace instead.
  let existing: any = null;
  {
    let q = admin.from("practice_encounter")
      .select("id, status, capture_mode")
      .eq("workspace_id", args.workspaceId)
      .in("status", OPEN_ENCOUNTER_STATUSES)
      .limit(1);
    q = args.appointmentId
      ? q.eq("appointment_id", args.appointmentId)
      : q.eq("patient_id", args.patientId).is("appointment_id", null);
    const { data, error } = await q;
    // ⚠ A FAILED READ MUST NOT BECOME A SECOND ENCOUNTER. If we cannot tell whether one already exists, we
    // refuse rather than risk duplicating a clinical record -- the safer branch is to do nothing.
    if (error) return { ok: false, status: 503, code: "READ_FAILED", message: error.message };
    existing = (data ?? [])[0] ?? null;
  }
  if (existing) return { ok: true, data: { encounterId: existing.id, created: false } };

  const { data, error } = await admin.from("practice_encounter").insert({
    workspace_id: args.workspaceId,
    patient_id: args.patientId,
    appointment_id: args.appointmentId ?? null,
    location_id: args.locationId ?? null,
    status: "DRAFT",
    capture_mode: "capture_later",
    seen_at: new Date().toISOString(),
    seen_by: args.actorId,
    created_by: args.actorId,
    // ⚠ NOTHING CLINICAL IS SET. No outcome, no reason_for_visit, no note. A shell that arrived with a
    // reason nobody typed would be exactly the system-derived-passing-as-confirmed data section 7 forbids.
  }).select("id").single();

  if (error) return { ok: false, status: 500, code: "WRITE_FAILED", message: error.message };
  return { ok: true, data: { encounterId: data.id, created: true } };
}

export type ToCompleteItem = {
  encounterId: string;
  patientId: string;
  appointmentId: string | null;
  seenAt: string | null;
  status: string;
  captureMode: string;
  deferredReason: string | null;
};

export type ToCompleteQueue =
  | { ok: true; items: ToCompleteItem[]; truncated: boolean }
  | { ok: false; message: string };

/**
 * The "To Complete" list - every encounter still awaiting a practitioner.
 *
 * ⚠ IT INCLUDES ORDINARY DRAFTS, NOT ONLY CAPTURE-LATER SHELLS. A consultation somebody started and did not
 * finish needs closing just as much as a one-tap shell, and a queue that showed only shells would let the
 * other kind accumulate invisibly. captureMode is carried on each item so the screen can still tell the two
 * apart, which section 7 requires it to be able to do.
 *
 * ⚠ AND IT REPORTS TRUNCATION. PostgREST caps at 1000 rows and a silently capped queue reads as a finished
 * day.
 */
export async function toCompleteQueue(admin: any, args: {
  workspaceId: string; practitionerId?: string | null; limit?: number;
}): Promise<ToCompleteQueue> {
  const limit = args.limit ?? 200;
  try {
    const { data, error } = await admin.from("practice_encounter")
      .select("id, patient_id, appointment_id, seen_at, status, capture_mode, deferred_reason, created_at")
      .eq("workspace_id", args.workspaceId)
      .in("status", OPEN_ENCOUNTER_STATUSES)
      .order("seen_at", { ascending: true, nullsFirst: false })
      .limit(limit + 1);
    if (error) return { ok: false, message: error.message };
    const rows = (data ?? []) as any[];
    const truncated = rows.length > limit;
    return {
      ok: true,
      truncated,
      items: rows.slice(0, limit).map(r => ({
        encounterId: r.id,
        patientId: r.patient_id,
        appointmentId: r.appointment_id ?? null,
        seenAt: r.seen_at ?? null,
        status: r.status,
        captureMode: r.capture_mode ?? "full",
        deferredReason: r.deferred_reason ?? null,
      })),
    };
  } catch (e: any) {
    return { ok: false, message: e?.message ?? "read threw" };
  }
}
