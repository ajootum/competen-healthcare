import { audit } from "@/lib/practice/audit";
import { NOTE_TYPES } from "@/lib/practice/encounter-constants";
import type { EngineResult } from "@/lib/practice/encounters";
import { saveNoteSegment } from "@/lib/practice/documentation";

// ── FILING AN OFFLINE VISIT ── CP offline capture, entity two (owner: "Encounters then follow-up") ──
//
// ⚠ THIS IS THE POST-HOC PATH, AND IT NEVER TOUCHES THE LIVE LIFECYCLE. A visit captured offline is a
// PAST, COMPLETED consultation -- paper notes typed up later. launchEncounter's resume-before-create
// would file them into whatever encounter happens to be OPEN for that patient today, which is exactly
// the wrong record. So this inserts status COMPLETED directly: the live-status partial index
// (ux_practice_encounter_live spans only DRAFT/ACTIVE/PAUSED) never sees it, a running consultation
// is never disturbed, and signing stays a live, deliberate act performed after review.
//
// ⚠ ITS OWN MODULE, NOT A NEW EXPORT OF encounters.ts, BECAUSE OF A ONE-WAY RULE ALREADY WRITTEN DOWN.
// The notes go through saveNoteSegment -- the same versioned write the online product uses, because a
// raw insert here would be the lenient way into the record: no version row (documentation.ts: "a
// history with a hole in it is worse than no history: it looks complete"), no note audit. But
// saveNoteSegment lives in documentation.ts, which imports editableEncounter FROM encounters.ts and
// records that "the dependency runs one way only". This module sits above both, so that stays true.
//
// ⚠ IDEMPOTENT ALL THE WAY THROUGH, NOT JUST AT THE FRONT. The sync ledger writes its row AFTER the
// apply, so a crash anywhere inside this function retries the WHOLE call. The natural key
// (workspace, patient, filed-by, exact started_at, COMPLETED) finds the half-filed encounter; the
// history rows are backfilled only if absent; and the notes converge because saveNoteSegment treats
// an identical body as a no-op that writes no version. A retry therefore completes a partial filing
// instead of duplicating it -- which is also why a note failure below maps to 500-retryable rather
// than a terminal refusal: at that point nothing is wrong with what the practitioner recorded.

/* eslint-disable @typescript-eslint/no-explicit-any */

// The DB CHECK constraints on practice_encounter, restated here so an out-of-vocabulary payload is
// REFUSED in words rather than thrown at the database -- a CHECK violation surfaces as a 500, the
// applier maps 500 to retryable, and the same payload would then poison the queue forever.
const PATHWAYS = ["booked", "new_walk_in", "walk_in_followup", "scheduled_followup"];
const MODES = ["in_person", "teleconsultation", "outreach", "home_visit", "hospital"];

const CLOCK_SKEW_MS = 5 * 60_000;

export async function fileOfflineEncounter(admin: any, args: {
  workspaceId: string; patientId: string;
  pathway?: string | null; encounterMode?: string | null; reasonForVisit?: string | null;
  startedAtIso: string; endedAtIso: string;
  notes: Partial<Record<(typeof NOTE_TYPES)[number], string>>;
  actorId: string; correlationId: string;
}): Promise<EngineResult<{ id: string; replayed: boolean }>> {
  const { data: patient } = await admin.from("practice_patient")
    .select("id, status").eq("id", args.patientId).eq("workspace_id", args.workspaceId).maybeSingle();
  if (!patient)
    return { ok: false, status: 404, code: "BAD_PATIENT", message: "that patient is not in this practice, so the visit cannot be filed" };
  // ⚠ NOT launchEncounter's "active only" rule. A visit with an ARCHIVED patient is refused live
  // because the archiving came first; here the VISIT came first -- it happened while the record may
  // still have been active -- and refusing to file real care against a since-archived record would
  // lose the notes. Only a MERGED record is refused, because it has a surviving twin the visit
  // belongs on, and filing against the dead half would split the patient's history in two.
  if (patient.status === "merged")
    return { ok: false, status: 422, code: "PATIENT_MERGED", message: "that patient record was merged into another. File this visit against the surviving record" };

  // ⚠ THE TIMES COME FROM THE DEVICE AND ARE REQUIRED, NOT DEFAULTED -- same doctrine as the
  // measurement applier. For a visit synced three days late, stamping NOW would file it as though
  // the patient was seen at the moment of the upload, which is a lie recorded as a clinical fact.
  const started = Date.parse(args.startedAtIso ?? "");
  const ended = Date.parse(args.endedAtIso ?? "");
  if (Number.isNaN(started) || Number.isNaN(ended))
    return { ok: false, status: 422, code: "NO_TIME", message: "this visit does not say when it started and ended, and filing it under today would be wrong" };
  if (ended < started)
    return { ok: false, status: 422, code: "END_BEFORE_START", message: "this visit ends before it starts, which usually means one of the two times was mistyped. It has not been filed" };
  if (ended > Date.now() + CLOCK_SKEW_MS)
    return { ok: false, status: 422, code: "FUTURE_TIME", message: "this visit is dated in the future, which usually means the clock on the device that recorded it was wrong. It has not been filed" };

  const noteEntries = NOTE_TYPES
    .map((t) => [t, (args.notes?.[t] ?? "").trim()] as const)
    .filter(([, body]) => body.length > 0);
  if (noteEntries.length === 0)
    return { ok: false, status: 422, code: "NO_CONTENT", message: "this visit carries no notes at all, so there is nothing to file" };

  // Absent metadata gets the same defaults the online engine uses; PRESENT-but-unrecognised metadata
  // is refused, never silently rewritten into something the practitioner did not record.
  const pathway = args.pathway?.trim() || "new_walk_in";
  const mode = args.encounterMode?.trim() || "in_person";
  if (!PATHWAYS.includes(pathway) || !MODES.includes(mode))
    return { ok: false, status: 422, code: "BAD_KIND", message: "this visit was recorded as a kind of visit this practice does not recognise, so it cannot be filed as captured" };

  // The natural-key replay check. String equality is safe here because BOTH sides are the same
  // normalisation of the same device timestamp -- this function is the only writer of these rows.
  const startedIso = new Date(started).toISOString();
  const endedIso = new Date(ended).toISOString();
  const { data: existing, error: findError } = await admin.from("practice_encounter")
    .select("id").eq("workspace_id", args.workspaceId).eq("patient_id", args.patientId)
    .eq("created_by", args.actorId).eq("started_at", startedIso).eq("status", "COMPLETED").maybeSingle();
  // ⚠ A FAILED read is not an EMPTY read. Treating it as "no duplicate" and inserting would mint the
  // twin this check exists to prevent, on exactly the flaky infrastructure that makes retries likely.
  if (findError)
    return { ok: false, status: 500, code: "REPLAY_CHECK_FAILED", message: findError.message };

  let encounterId = existing?.id as string | undefined;
  const replayed = Boolean(encounterId);

  if (!encounterId) {
    const { data: enc, error } = await admin.from("practice_encounter").insert({
      workspace_id: args.workspaceId, patient_id: args.patientId,
      entry_pathway: pathway, encounter_mode: mode,
      reason_for_visit: args.reasonForVisit?.trim() || null,
      status: "COMPLETED", started_at: startedIso, completed_at: endedIso,
      // ⚠ NO activity_id, AND THAT IS A STATEMENT, NOT AN OMISSION. The activity an encounter inherits
      // is "where the work started"; the actor's CURRENT running session is where the UPLOAD started.
      // encounters.ts already says null is an ordinary answer for an encounter outside any session.
      created_by: args.actorId,
    }).select("id").single();
    if (error)
      return { ok: false, status: 500, code: "WRITE_FAILED", message: error.message };
    encounterId = enc.id as string;
  }

  // The history walk, with the DEVICE's times. averageConsultMinutes reads this log, and an encounter
  // whose rows carried server time would report a three-day consultation. Backfilled on replay too,
  // because the crash window between the insert above and here is real.
  const { count: historyCount, error: historyReadError } = await admin.from("practice_encounter_status_history")
    .select("id", { count: "exact", head: true }).eq("encounter_id", encounterId);
  if (historyReadError)
    return { ok: false, status: 500, code: "HISTORY_READ_FAILED", message: historyReadError.message };
  if ((historyCount ?? 0) === 0) {
    const { error: historyError } = await admin.from("practice_encounter_status_history").insert([
      { workspace_id: args.workspaceId, encounter_id: encounterId, from_status: null, to_status: "DRAFT", actor_id: args.actorId, occurred_at: startedIso },
      { workspace_id: args.workspaceId, encounter_id: encounterId, from_status: "DRAFT", to_status: "ACTIVE", actor_id: args.actorId, occurred_at: startedIso },
      { workspace_id: args.workspaceId, encounter_id: encounterId, from_status: "ACTIVE", to_status: "COMPLETED", actor_id: args.actorId, occurred_at: endedIso },
    ]);
    if (historyError)
      return { ok: false, status: 500, code: "HISTORY_NOT_RECORDED", message: historyError.message };
  }

  // ⚠ THE SAME VERSIONED WRITE THE ONLINE PRODUCT USES. editableEncounter admits COMPLETED, the
  // version row and the practice.note_saved audit happen because they happen there, and the no-op
  // check is what makes a replay converge instead of stacking identical versions.
  //
  // source stays "typed" -- the practitioner DID type these notes, and the version table's CHECK
  // holds exactly the four online vocabularies. That the visit arrived offline is the ENCOUNTER's
  // story, carried by the audit event below and by the gap between started_at and created_at.
  for (const [noteType, body] of noteEntries) {
    const saved = await saveNoteSegment(admin, {
      workspaceId: args.workspaceId, encounterId, noteType, body,
      source: "typed", actorId: args.actorId, correlationId: args.correlationId,
    });
    // ⚠ MAPPED TO RETRYABLE WHATEVER saveNoteSegment SAID. Every payload fault was refused above,
    // so a failure here is infrastructure -- and a terminal refusal at this point would strand an
    // encounter that EXISTS with notes that do not, telling the practitioner their visit was
    // rejected when most of it is already in the record. The retry finds the encounter by natural
    // key and finishes the notes.
    if (!saved.ok)
      return { ok: false, status: 500, code: "NOTES_NOT_FILED", message: `the visit was filed but its notes were not all recorded, so it will be retried: ${saved.message}` };
  }

  if (!replayed) {
    await audit(admin, {
      workspaceId: args.workspaceId, actorId: args.actorId, eventType: "practice.encounter_filed_offline",
      payload: {
        encounterId, patientId: args.patientId,
        startedAt: startedIso, endedAt: endedIso,
        noteTypes: noteEntries.map(([t]) => t),
      },
      correlationId: args.correlationId,
    });
  }

  return { ok: true, data: { id: encounterId, replayed } };
}
