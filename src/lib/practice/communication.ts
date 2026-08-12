import { audit } from "@/lib/practice/audit";
import type { EngineResult } from "@/lib/practice/encounters";
import { listMembers } from "@/lib/practice/tasks";
import {
  CONTACT_CHANNELS, CONTACT_DIRECTIONS, CONTACT_OUTCOMES,
  INCOMING_DOC_TYPES, INCOMING_TRANSITIONS, INCOMING_PRIORITIES,
} from "@/lib/practice/communication-constants";

// CPR-320 COMMUNICATION AND DOCUMENT MANAGEMENT. Migration 200's header carries the five boundary
// decisions; the short forms:
//
//   CPR-130 OWNS WHAT LEAVES; THIS OWNS WHAT ARRIVES. An incoming lab result is not the practice's
//   authored artefact -- no signature, no supersession chain, just a register of what arrived, from
//   whom, and whether anybody has looked at it.
//
//   A CONTACT IS RECORDED, NOT PERFORMED. The phone call happened in the world; the row records it.
//   Nothing in this file sends anything, to anyone, through any channel.
//
//   UNREAD IS DERIVED from a per-person read cursor, never stored on the message and never written as
//   a notification -- CPR-340's rule that anything derivable is derived, or two sources of truth
//   disagree the moment one is cleared.
//
//   THE UNREVIEWED RESULT IS THE MISSED-RESULT HARM. "Received and nobody has looked" is derived onto
//   the operations home, and REVIEWED is a stamp with a name on it, never skippable.

/* eslint-disable @typescript-eslint/no-explicit-any */

const nowIso = () => new Date().toISOString();

// ── THREADS ──────────────────────────────────────────────────────────────────────────────────────────

async function verifyAnchors(admin: any, workspaceId: string, args: {
  patientId?: string | null; encounterId?: string | null; documentId?: string | null;
}): Promise<EngineResult<{ patientId: string | null; encounterId: string | null; documentId: string | null }>> {
  // Named subjects must belong to this workspace -- an anchor pointing at another practice's patient
  // would leak that the row exists. And a named encounter must belong to the named patient, so a
  // conversation cannot mislabel whose consultation it is about.
  let patientId: string | null = null;
  if (args.patientId) {
    const { data } = await admin.from("practice_patient").select("id").eq("id", args.patientId).eq("workspace_id", workspaceId).maybeSingle();
    if (!data) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };
    patientId = data.id;
  }
  let encounterId: string | null = null;
  if (args.encounterId) {
    const { data } = await admin.from("practice_encounter").select("id, patient_id").eq("id", args.encounterId).eq("workspace_id", workspaceId).maybeSingle();
    if (!data) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };
    if (patientId && data.patient_id !== patientId)
      return { ok: false, status: 422, code: "ENCOUNTER_PATIENT_MISMATCH", message: "that encounter belongs to a different patient" };
    encounterId = data.id;
  }
  let documentId: string | null = null;
  if (args.documentId) {
    const { data } = await admin.from("practice_clinical_document").select("id").eq("id", args.documentId).eq("workspace_id", workspaceId).maybeSingle();
    if (!data) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };
    documentId = data.id;
  }
  return { ok: true, data: { patientId, encounterId, documentId } };
}

/**
 * Start a conversation. The first message is required -- a thread with a subject and no body is a
 * heading waiting for somebody else to do the work of saying the thing.
 */
export async function createThread(admin: any, args: {
  workspaceId: string; subject: string; body: string;
  patientId?: string | null; encounterId?: string | null; documentId?: string | null;
  actorId: string; correlationId: string;
}): Promise<EngineResult<{ id: string }>> {
  if (!args.subject.trim()) return { ok: false, status: 400, code: "VALIDATION_ERROR", message: "a thread needs a subject" };
  if (!args.body.trim()) return { ok: false, status: 400, code: "VALIDATION_ERROR", message: "say the thing -- a subject alone is not a message" };

  const anchors = await verifyAnchors(admin, args.workspaceId, args);
  if (!anchors.ok) return anchors;

  const { data: thread, error } = await admin.from("practice_thread").insert({
    workspace_id: args.workspaceId, subject: args.subject.trim(),
    patient_id: anchors.data.patientId, encounter_id: anchors.data.encounterId, document_id: anchors.data.documentId,
    created_by: args.actorId,
  }).select("id").single();
  if (error) return { ok: false, status: 400, code: "VALIDATION_ERROR", message: error.message };

  const posted = await postMessage(admin, {
    workspaceId: args.workspaceId, threadId: thread.id, body: args.body,
    actorId: args.actorId, correlationId: args.correlationId,
  });
  if (!posted.ok) {
    // A thread whose first message failed is a heading with nothing under it -- worse than no thread.
    await admin.from("practice_thread").delete().eq("id", thread.id);
    return posted;
  }

  await audit(admin, {
    workspaceId: args.workspaceId, actorId: args.actorId, eventType: "practice.thread_created",
    payload: { threadId: thread.id, patientId: anchors.data.patientId }, correlationId: args.correlationId,
  });
  return { ok: true, data: { id: thread.id as string } };
}

export async function postMessage(admin: any, args: {
  workspaceId: string; threadId: string; body: string; actorId: string; correlationId: string;
}): Promise<EngineResult<{ id: string }>> {
  if (!args.body.trim()) return { ok: false, status: 400, code: "VALIDATION_ERROR", message: "an empty message says nothing" };

  const { data: thread } = await admin.from("practice_thread")
    .select("id").eq("id", args.threadId).eq("workspace_id", args.workspaceId).maybeSingle();
  if (!thread) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };

  const { data: message, error } = await admin.from("practice_thread_message").insert({
    workspace_id: args.workspaceId, thread_id: thread.id, body: args.body.trim(), author_id: args.actorId,
  }).select("id, created_at").single();
  if (error) return { ok: false, status: 400, code: "VALIDATION_ERROR", message: error.message };

  await admin.from("practice_thread").update({ last_message_at: message.created_at }).eq("workspace_id", args.workspaceId).eq("id", thread.id);
  // Your own message is read by definition -- otherwise every reply marks your own thread unread at you.
  await markThreadRead(admin, { workspaceId: args.workspaceId, threadId: thread.id, userId: args.actorId });

  return { ok: true, data: { id: message.id as string } };
}

/**
 * Move the caller's cursor. Scoped to the caller: nobody can mark a thread read on a colleague's behalf.
 *
 * THE CURSOR TAKES THE THREAD'S OWN last_message_at, NOT THE APP SERVER'S CLOCK. "Read" means "I have
 * seen everything up to the current last message", and writing that as `new Date()` compares a JS-clock
 * timestamp against a database-clock timestamp -- with the database a second ahead, every author saw
 * their own thread flagged unread at them. The harness caught it; using the same clock on both sides of
 * the comparison removes the race entirely rather than shrinking it.
 */
export async function markThreadRead(admin: any, args: {
  workspaceId: string; threadId: string; userId: string;
}): Promise<EngineResult<{ readAt: string }>> {
  const { data: thread } = await admin.from("practice_thread")
    .select("id, last_message_at").eq("id", args.threadId).eq("workspace_id", args.workspaceId).maybeSingle();
  if (!thread) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };

  // ux_practice_thread_read is a FULL unique index, so this conflict target is real. The error is still
  // checked, per the standing rule: an upsert whose error is discarded is a write that silently did not
  // happen.
  const { error } = await admin.from("practice_thread_read").upsert({
    workspace_id: args.workspaceId, thread_id: thread.id, user_id: args.userId,
    last_read_at: thread.last_message_at,
  }, { onConflict: "thread_id,user_id" });
  if (error) return { ok: false, status: 400, code: "VALIDATION_ERROR", message: error.message };
  return { ok: true, data: { readAt: thread.last_message_at as string } };
}

/** Threads newest-activity-first, each carrying whether THIS CALLER has unread messages in it. */
export async function listThreads(admin: any, workspaceId: string, userId: string, opts: { limit?: number } = {}) {
  const { data: threads } = await admin.from("practice_thread")
    .select("id, subject, patient_id, encounter_id, document_id, last_message_at, created_by, created_at")
    .eq("workspace_id", workspaceId).order("last_message_at", { ascending: false }).limit(opts.limit ?? 100);
  const rows = (threads ?? []) as any[];
  if (rows.length === 0) return [];

  const { data: cursors } = await admin.from("practice_thread_read")
    .select("thread_id, last_read_at").eq("workspace_id", workspaceId).eq("user_id", userId)
    .in("thread_id", rows.map(t => t.id));
  const cursorOf = new Map(((cursors ?? []) as any[]).map(c => [c.thread_id, c.last_read_at]));

  const patientIds = [...new Set(rows.map(t => t.patient_id).filter(Boolean))];
  const { data: patients } = patientIds.length
    ? await admin.from("practice_patient").select("id, display_name").eq("workspace_id", workspaceId).in("id", patientIds)
    : { data: [] };
  const nameOf = new Map(((patients ?? []) as any[]).map(p => [p.id, p.display_name]));

  return rows.map(t => {
    const cursor = cursorOf.get(t.id);
    return {
      ...t,
      patient_name: t.patient_id ? (nameOf.get(t.patient_id) ?? "Unknown patient") : null,
      // UNREAD IS DERIVED: no cursor means never opened, a cursor older than the last message means
      // there is something new. Nothing stores this; nothing has to clear it.
      unread: !cursor || cursor < t.last_message_at,
    };
  });
}

/** How many threads hold something this caller has not seen. The operations-home figure. */
export async function unreadThreadCount(admin: any, workspaceId: string, userId: string): Promise<number> {
  const threads = await listThreads(admin, workspaceId, userId, { limit: 200 });
  return threads.filter(t => t.unread).length;
}

export async function getThread(admin: any, workspaceId: string, threadId: string) {
  const { data: thread } = await admin.from("practice_thread")
    .select("id, subject, patient_id, encounter_id, document_id, last_message_at, created_by, created_at")
    .eq("id", threadId).eq("workspace_id", workspaceId).maybeSingle();
  if (!thread) return null;

  const [{ data: messages }, members, { data: patient }] = await Promise.all([
    admin.from("practice_thread_message")
      .select("id, body, author_id, created_at").eq("workspace_id", workspaceId).eq("thread_id", threadId).order("created_at"),
    listMembers(admin, workspaceId),
    thread.patient_id
      ? admin.from("practice_patient").select("id, display_name").eq("workspace_id", workspaceId).eq("id", thread.patient_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const nameOf = new Map(members.map(m => [m.userId, m.name]));

  return {
    thread: { ...thread, patient_name: (patient as any)?.display_name ?? null },
    messages: ((messages ?? []) as any[]).map(m => ({
      ...m, author_name: nameOf.get(m.author_id) ?? null,
    })),
  };
}

// ── THE PATIENT CONTACT REGISTER ─────────────────────────────────────────────────────────────────────

export async function recordContact(admin: any, args: {
  workspaceId: string; patientId: string; followUpId?: string | null; encounterId?: string | null;
  channel?: string; direction?: string; outcome?: string; summary: string; occurredAt?: string;
  actorId: string; correlationId: string;
}): Promise<EngineResult<{ id: string }>> {
  if (!args.summary.trim())
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: "say what happened -- a contact with no words is a tally mark" };

  const { data: patient } = await admin.from("practice_patient")
    .select("id, status").eq("id", args.patientId).eq("workspace_id", args.workspaceId).maybeSingle();
  if (!patient) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };
  if (patient.status !== "active")
    return { ok: false, status: 422, code: "PATIENT_NOT_ACTIVE", message: "this patient record is not active (archived or merged)" };

  // The follow-up being chased must belong to the person being called. Filed against another patient's
  // commitment, "three calls, no answer" evidences the wrong record.
  let followUpId: string | null = null;
  if (args.followUpId) {
    const { data: fu } = await admin.from("practice_follow_up")
      .select("id, patient_id").eq("id", args.followUpId).eq("workspace_id", args.workspaceId).maybeSingle();
    if (!fu) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };
    if (fu.patient_id !== args.patientId)
      return { ok: false, status: 422, code: "FOLLOWUP_PATIENT_MISMATCH", message: "that follow-up belongs to a different patient" };
    followUpId = fu.id;
  }

  const channel = CONTACT_CHANNELS.some(([c]) => c === args.channel) ? args.channel! : "phone";
  const direction = CONTACT_DIRECTIONS.some(([d]) => d === args.direction) ? args.direction! : "outgoing";
  const outcome = CONTACT_OUTCOMES.some(([o]) => o === args.outcome) ? args.outcome! : "reached";

  const { data: contact, error } = await admin.from("practice_contact_log").insert({
    workspace_id: args.workspaceId, patient_id: args.patientId,
    follow_up_id: followUpId, encounter_id: args.encounterId ?? null,
    channel, direction, outcome, summary: args.summary.trim(),
    ...(args.occurredAt ? { occurred_at: args.occurredAt } : {}),
    recorded_by: args.actorId,
  }).select("id").single();
  if (error) return { ok: false, status: 400, code: "VALIDATION_ERROR", message: error.message };

  await audit(admin, {
    workspaceId: args.workspaceId, actorId: args.actorId, eventType: "practice.contact_recorded",
    payload: { contactId: contact.id, patientId: args.patientId, channel, outcome }, correlationId: args.correlationId,
  });
  return { ok: true, data: { id: contact.id as string } };
}

export async function listContacts(admin: any, workspaceId: string, filter: {
  patientId?: string; followUpId?: string; limit?: number;
} = {}) {
  let q = admin.from("practice_contact_log")
    .select("id, patient_id, follow_up_id, encounter_id, channel, direction, outcome, summary, occurred_at, recorded_by")
    .eq("workspace_id", workspaceId);
  if (filter.patientId) q = q.eq("patient_id", filter.patientId);
  if (filter.followUpId) q = q.eq("follow_up_id", filter.followUpId);
  const { data } = await q.order("occurred_at", { ascending: false }).limit(filter.limit ?? 50);
  return (data ?? []) as any[];
}

// ── THE INCOMING DOCUMENT REGISTER ───────────────────────────────────────────────────────────────────

export async function recordIncoming(admin: any, args: {
  workspaceId: string; patientId?: string | null; docType?: string; source: string; title: string;
  summary?: string; receivedOn?: string; whereHeld?: string; priority?: string;
  actorId: string; correlationId: string;
}): Promise<EngineResult<{ id: string }>> {
  if (!args.title.trim()) return { ok: false, status: 400, code: "VALIDATION_ERROR", message: "a title is required" };
  if (!args.source.trim())
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: "say where it came from -- a result with no source cannot be queried" };

  // Must exist here; NOT required to be active. See migration 200: a result can arrive for a patient
  // who has since been archived, and refusing it would lose the fact that it arrived.
  let patientId: string | null = null;
  if (args.patientId) {
    const { data } = await admin.from("practice_patient").select("id").eq("id", args.patientId).eq("workspace_id", args.workspaceId).maybeSingle();
    if (!data) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };
    patientId = data.id;
  }

  const docType = INCOMING_DOC_TYPES.some(([t]) => t === args.docType) ? args.docType! : "letter";
  const priority = (INCOMING_PRIORITIES as readonly string[]).includes(args.priority ?? "") ? args.priority! : "routine";

  const { data: doc, error } = await admin.from("practice_incoming_document").insert({
    workspace_id: args.workspaceId, patient_id: patientId, doc_type: docType,
    source: args.source.trim(), title: args.title.trim(), summary: args.summary?.trim() || null,
    ...(args.receivedOn ? { received_on: args.receivedOn } : {}),
    where_held: args.whereHeld?.trim() || null, priority, status: "RECEIVED", created_by: args.actorId,
  }).select("id").single();
  if (error) return { ok: false, status: 400, code: "VALIDATION_ERROR", message: error.message };

  await audit(admin, {
    workspaceId: args.workspaceId, actorId: args.actorId, eventType: "practice.incoming_recorded",
    payload: { incomingId: doc.id, docType, priority }, correlationId: args.correlationId,
  });
  return { ok: true, data: { id: doc.id as string } };
}

/**
 * The clinical stamp. RECEIVED -> REVIEWED, stamping who and when; the transition table refuses a jump
 * to ACTIONED, so the register can always answer "who looked at this result".
 */
export async function reviewIncoming(admin: any, args: {
  workspaceId: string; incomingId: string; note?: string; actorId: string; correlationId: string;
}): Promise<EngineResult<{ status: string }>> {
  const { data: doc } = await admin.from("practice_incoming_document")
    .select("id, status").eq("id", args.incomingId).eq("workspace_id", args.workspaceId).maybeSingle();
  if (!doc) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };
  if (!(INCOMING_TRANSITIONS[doc.status] ?? []).includes("REVIEWED"))
    return { ok: false, status: 422, code: "ILLEGAL_TRANSITION", message: `${doc.status} cannot become REVIEWED` };

  const { error } = await admin.from("practice_incoming_document")
    .update({ status: "REVIEWED", reviewed_by: args.actorId, reviewed_at: nowIso(), review_note: args.note?.trim() || null }).eq("workspace_id", args.workspaceId)
    .eq("id", doc.id);
  if (error) return { ok: false, status: 400, code: "VALIDATION_ERROR", message: error.message };

  await audit(admin, {
    workspaceId: args.workspaceId, actorId: args.actorId, eventType: "practice.incoming_reviewed",
    payload: { incomingId: doc.id }, correlationId: args.correlationId,
  });
  return { ok: true, data: { status: "REVIEWED" } };
}

/** What was done about it. Words required: "actioned" with nothing attached records a click. */
export async function actionIncoming(admin: any, args: {
  workspaceId: string; incomingId: string; note: string; actorId: string; correlationId: string;
}): Promise<EngineResult<{ status: string }>> {
  if (!args.note.trim())
    return { ok: false, status: 400, code: "NOTE_REQUIRED", message: "say what was done about it" };

  const { data: doc } = await admin.from("practice_incoming_document")
    .select("id, status").eq("id", args.incomingId).eq("workspace_id", args.workspaceId).maybeSingle();
  if (!doc) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };
  if (!(INCOMING_TRANSITIONS[doc.status] ?? []).includes("ACTIONED"))
    return { ok: false, status: 422, code: "ILLEGAL_TRANSITION", message: `${doc.status} cannot become ACTIONED` };

  const { error } = await admin.from("practice_incoming_document")
    .update({ status: "ACTIONED", actioned_by: args.actorId, actioned_at: nowIso(), action_note: args.note.trim() }).eq("workspace_id", args.workspaceId)
    .eq("id", doc.id);
  if (error) return { ok: false, status: 400, code: "VALIDATION_ERROR", message: error.message };

  await audit(admin, {
    workspaceId: args.workspaceId, actorId: args.actorId, eventType: "practice.incoming_actioned",
    payload: { incomingId: doc.id }, correlationId: args.correlationId,
  });
  return { ok: true, data: { status: "ACTIONED" } };
}

export async function listIncoming(admin: any, workspaceId: string, filter: {
  status?: string[]; patientId?: string; limit?: number;
} = {}) {
  let q = admin.from("practice_incoming_document")
    .select("id, patient_id, doc_type, source, title, summary, received_on, where_held, priority, status, reviewed_by, reviewed_at, review_note, actioned_at, action_note, created_at")
    .eq("workspace_id", workspaceId);
  if (filter.status?.length) q = q.in("status", filter.status);
  if (filter.patientId) q = q.eq("patient_id", filter.patientId);

  const { data } = await q.order("received_on", { ascending: false }).limit(filter.limit ?? 100);
  const rows = (data ?? []) as any[];
  if (rows.length === 0) return [];

  const patientIds = [...new Set(rows.map(r => r.patient_id).filter(Boolean))];
  const { data: patients } = patientIds.length
    ? await admin.from("practice_patient").select("id, display_name").eq("workspace_id", workspaceId).in("id", patientIds)
    : { data: [] };
  const nameOf = new Map(((patients ?? []) as any[]).map(p => [p.id, p.display_name]));

  return rows.map(r => ({
    ...r,
    patient_name: r.patient_id ? (nameOf.get(r.patient_id) ?? "Unknown patient") : null,
  }));
}

/** The missed-result figure: received, nobody has looked. Derived; nothing has to run. */
export async function unreviewedIncoming(admin: any, workspaceId: string) {
  const rows = await listIncoming(admin, workspaceId, { status: ["RECEIVED"] });
  return { rows, anyUrgent: rows.some((r: any) => r.priority === "urgent") };
}
