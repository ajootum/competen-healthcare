import { audit } from "@/lib/practice/audit";
import { hasCapability, type WorkspaceContext } from "@/lib/practice/access";
import { messagingStatus } from "@/lib/practice/messaging";
import type { EngineResult } from "@/lib/practice/encounters";

// CPR-370 SECURITY, PRIVACY AND PRACTITIONER CONTROL.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// THE OTHER HALF OF THE TRAIL. practice_audit_event has recorded every WRITE since Phase 0. Nothing has
// ever recorded a READ -- and for a clinical record the harm is almost always a read: the staff member
// who opens a neighbour's file, an ex-partner's, somebody in the news. "Who has opened this person's
// record" is the question a patient is most entitled to ask, and until now this product could not
// answer it.
// ────────────────────────────────────────────────────────────────────────────────────────────────────
//
// THREE RULES THAT SHAPE EVERY FUNCTION HERE.
//
//   1. LOGGING NEVER BLOCKS A CLINICIAN. If the log write fails the page still renders -- a doctor
//      staring at an error while a patient waits is the worse harm. But the gap is never silent: the
//      failure goes to the audit trail, so "the trail has a hole here" is visible rather than assumed.
//
//   2. THE REVIEWER OF A PRIVACY CONTROL MUST NOT BE ITS EASIEST BYPASS. An access log is a list of who
//      your patients are -- every row names somebody who attends this practice. So reviewing it shows
//      NAMES only to a caller who already holds patient.view; everybody else sees stable references.
//      Reviewing is itself logged, for the same reason.
//
//   3. AN EXPORT IS THE LARGEST READ THERE IS, and is logged as loudly as it deserves.

/* eslint-disable @typescript-eslint/no-explicit-any */

export type AccessSubject =
  | "patient" | "encounter" | "document" | "incoming_document" | "search" | "export" | "access_review";

/**
 * Record a read. Fire-and-forget from the caller's point of view -- it never throws and never returns a
 * failure the page has to handle. See rule 1.
 */
export async function logAccess(admin: any, args: {
  workspaceId: string; actorId: string; subjectKind: AccessSubject; subjectId?: string | null;
  patientId?: string | null; action?: "view" | "search" | "export" | "review";
  route?: string; detail?: string; correlationId?: string;
}): Promise<void> {
  const { error } = await admin.from("practice_access_log").insert({
    workspace_id: args.workspaceId, actor_id: args.actorId,
    subject_kind: args.subjectKind, subject_id: args.subjectId ?? null,
    patient_id: args.patientId ?? null, action: args.action ?? "view",
    route: args.route ?? null, detail: args.detail ?? null,
    correlation_id: args.correlationId ?? null,
  });

  // THE GAP IS RECORDED RATHER THAN SWALLOWED. If this second write also fails there is nothing further
  // to do that would not defeat rule 1, and at that point the database is unreachable and the page is
  // failing anyway.
  if (error) {
    try {
      await audit(admin, {
        workspaceId: args.workspaceId, actorId: args.actorId, eventType: "practice.access_log_failed",
        payload: { subjectKind: args.subjectKind, subjectId: args.subjectId ?? null, reason: error.message },
        correlationId: args.correlationId ?? "access-log",
      });
    } catch { /* the database is unreachable; the page's own error handling takes it from here */ }
  }
}

/**
 * Who has opened this patient's record, and when.
 *
 * THE PATIENT-FACING ANSWER, even though no patient can sign in yet: the shape is what a practitioner
 * needs to answer the question on their behalf, which is how a practice actually handles it.
 */
export async function patientAccessHistory(admin: any, workspaceId: string, patientId: string, limit = 50) {
  const { data } = await admin.from("practice_access_log")
    .select("id, actor_id, subject_kind, subject_id, action, route, occurred_at")
    .eq("workspace_id", workspaceId).eq("patient_id", patientId)
    .order("occurred_at", { ascending: false }).limit(limit);
  const rows = (data ?? []) as any[];
  if (rows.length === 0) return { entries: [], distinctActors: 0, firstAt: null, lastAt: null };

  const actorIds = [...new Set(rows.map(r => r.actor_id))];
  const { data: profiles } = await admin.from("profiles").select("id, full_name").in("id", actorIds);
  const nameOf = new Map(((profiles ?? []) as any[]).map(p => [p.id, p.full_name]));

  return {
    entries: rows.map(r => ({ ...r, actor_name: nameOf.get(r.actor_id) ?? null })),
    distinctActors: actorIds.length,
    firstAt: rows[rows.length - 1].occurred_at,
    lastAt: rows[0].occurred_at,
  };
}

/**
 * The practice-wide access review.
 *
 * DE-IDENTIFIED UNLESS THE CALLER ALREADY HOLDS patient.view. See rule 2: an access log is a list of
 * who your patients are, and a reviewer without clinical access must be able to audit WHO LOOKED
 * without thereby learning WHO ATTENDS. The reference is the patient's own id, which is stable enough
 * to group by and useless as an identity.
 *
 * Reviewing is itself a read of the practice, so it is logged. The caller passes their own context, and
 * the function decides -- rather than every page remembering to.
 */
export async function reviewAccess(admin: any, ctx: WorkspaceContext, opts: {
  actorId?: string; patientId?: string; sinceIso?: string; limit?: number; correlationId?: string;
} = {}) {
  const identified = hasCapability(ctx, "patient.view");

  let q = admin.from("practice_access_log")
    .select("id, actor_id, subject_kind, subject_id, patient_id, action, route, detail, occurred_at")
    .eq("workspace_id", ctx.workspaceId);
  if (opts.actorId) q = q.eq("actor_id", opts.actorId);
  if (opts.patientId) q = q.eq("patient_id", opts.patientId);
  if (opts.sinceIso) q = q.gte("occurred_at", opts.sinceIso);

  const { data } = await q.order("occurred_at", { ascending: false }).limit(opts.limit ?? 200);
  const rows = (data ?? []) as any[];

  const actorIds = [...new Set(rows.map(r => r.actor_id))];
  const { data: profiles } = actorIds.length
    ? await admin.from("profiles").select("id, full_name").in("id", actorIds)
    : { data: [] };
  const actorName = new Map(((profiles ?? []) as any[]).map(p => [p.id, p.full_name]));

  // Patient names are fetched ONLY when the caller may see them. Not fetched and hidden -- not fetched.
  let patientName = new Map<string, string>();
  if (identified) {
    const patientIds = [...new Set(rows.map(r => r.patient_id).filter(Boolean))];
    if (patientIds.length > 0) {
      const { data: patients } = await admin.from("practice_patient")
        .select("id, display_name").eq("workspace_id", ctx.workspaceId).in("id", patientIds);
      patientName = new Map(((patients ?? []) as any[]).map(p => [p.id, p.display_name]));
    }
  }

  await logAccess(admin, {
    workspaceId: ctx.workspaceId, actorId: ctx.userId, subjectKind: "access_review", action: "review",
    route: "/practice/privacy", detail: opts.patientId ? "filtered to one patient" : "practice-wide",
    correlationId: opts.correlationId,
  });

  // WHO LOOKED AT WHOM, counted. The summary is the useful artefact -- a thousand rows of "viewed" is
  // not something anybody reviews, and "one person opened forty different records last Tuesday" is.
  const byActor = new Map<string, { actorId: string; name: string | null; views: number; patients: Set<string> }>();
  for (const r of rows) {
    const e = byActor.get(r.actor_id) ?? { actorId: r.actor_id, name: actorName.get(r.actor_id) ?? null, views: 0, patients: new Set<string>() };
    e.views++;
    if (r.patient_id) e.patients.add(r.patient_id);
    byActor.set(r.actor_id, e);
  }

  return {
    identified,
    entries: rows.map(r => ({
      ...r,
      actor_name: actorName.get(r.actor_id) ?? null,
      // A stable reference, not a name, when the caller may not see names.
      patient_label: r.patient_id
        ? (identified ? (patientName.get(r.patient_id) ?? "Unknown patient") : `patient ${String(r.patient_id).slice(0, 8)}`)
        : null,
    })),
    byActor: [...byActor.values()]
      .map(e => ({ actorId: e.actorId, name: e.name, views: e.views, distinctPatients: e.patients.size }))
      .sort((a, b) => b.views - a.views),
  };
}

// ── PRACTITIONER CONTROL: EXPORT ─────────────────────────────────────────────────────────────────────

/**
 * Everything this practice holds about one patient, in one structure.
 *
 * THE PRODUCT'S PREMISE IS PORTABILITY -- "the practitioner's own record of their own practice" -- and a
 * record you cannot get out is not one you own. This is the honest minimum of that claim: complete,
 * machine-readable, and generated from the same tables the app reads rather than from a summary
 * somebody would have to keep in step.
 *
 * IT IS NOT A CLINICAL DOCUMENT. No signature, no letterhead, no version chain -- CPR-130 owns those.
 * This is a data export, and calling it anything else would invite it into a clinical conversation it
 * has no standing in.
 */
export async function exportPatientRecord(admin: any, ctx: WorkspaceContext, patientId: string, opts: {
  correlationId?: string;
} = {}): Promise<EngineResult<Record<string, unknown>>> {
  const { data: patient } = await admin.from("practice_patient")
    .select("*").eq("id", patientId).eq("workspace_id", ctx.workspaceId).maybeSingle();
  if (!patient) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };

  const [
    { data: identifiers }, { data: contacts }, { data: appointments }, { data: encounters },
    { data: problems }, { data: diagnoses }, { data: treatments }, { data: procedures },
    { data: documents }, { data: followUps }, { data: contactLog },
  ] = await Promise.all([
    admin.from("practice_patient_identifier").select("*").eq("workspace_id", ctx.workspaceId).eq("patient_id", patientId),
    admin.from("practice_patient_contact").select("*").eq("workspace_id", ctx.workspaceId).eq("patient_id", patientId),
    admin.from("practice_appointment").select("*").eq("workspace_id", ctx.workspaceId).eq("patient_id", patientId),
    admin.from("practice_encounter").select("*").eq("workspace_id", ctx.workspaceId).eq("patient_id", patientId).order("started_at"),
    admin.from("practice_problem").select("*").eq("workspace_id", ctx.workspaceId).eq("patient_id", patientId),
    admin.from("practice_diagnosis").select("*").eq("workspace_id", ctx.workspaceId).eq("patient_id", patientId),
    admin.from("practice_treatment").select("*").eq("workspace_id", ctx.workspaceId).eq("patient_id", patientId),
    admin.from("practice_procedure").select("*").eq("workspace_id", ctx.workspaceId).eq("patient_id", patientId),
    admin.from("practice_clinical_document").select("*").eq("workspace_id", ctx.workspaceId).eq("patient_id", patientId),
    admin.from("practice_follow_up").select("*").eq("workspace_id", ctx.workspaceId).eq("patient_id", patientId),
    admin.from("practice_contact_log").select("*").eq("workspace_id", ctx.workspaceId).eq("patient_id", patientId),
  ]);

  // The notes hang off encounters rather than the patient, so they need the encounter ids.
  const encounterIds = ((encounters ?? []) as any[]).map(e => e.id);
  const [{ data: notes }, { data: noteVersions }] = encounterIds.length
    ? await Promise.all([
      admin.from("practice_encounter_note").select("*").eq("workspace_id", ctx.workspaceId).in("encounter_id", encounterIds),
      admin.from("practice_encounter_note_version").select("*").eq("workspace_id", ctx.workspaceId).in("encounter_id", encounterIds),
    ])
    : [{ data: [] }, { data: [] }];

  await logAccess(admin, {
    workspaceId: ctx.workspaceId, actorId: ctx.userId, subjectKind: "export", subjectId: patientId,
    patientId, action: "export", route: "/api/v1/practice/patients/export",
    detail: `${encounterIds.length} encounters`, correlationId: opts.correlationId,
  });
  await audit(admin, {
    workspaceId: ctx.workspaceId, actorId: ctx.userId, eventType: "practice.patient_exported",
    payload: { patientId, encounters: encounterIds.length }, correlationId: opts.correlationId ?? "export",
  });

  return {
    ok: true,
    data: {
      // WHAT THIS IS, inside the file itself. An export that travels without saying where it came from
      // and when is one somebody will later mistake for current.
      export: {
        format: "competen-practice-patient-record",
        version: 1,
        generatedAt: new Date().toISOString(),
        workspaceId: ctx.workspaceId,
        generatedBy: ctx.userId,
        note: "A data export, not a clinical document. It carries no signature and is a snapshot of the moment above.",
      },
      patient,
      identifiers: identifiers ?? [],
      contactDetails: contacts ?? [],
      appointments: appointments ?? [],
      encounters: encounters ?? [],
      encounterNotes: notes ?? [],
      encounterNoteVersions: noteVersions ?? [],
      problems: problems ?? [],
      diagnoses: diagnoses ?? [],
      treatments: treatments ?? [],
      procedures: procedures ?? [],
      documents: documents ?? [],
      followUps: followUps ?? [],
      contactLog: contactLog ?? [],
    },
  };
}

/**
 * What the practice can see about itself: counts, and the honest list of what this product does NOT do
 * with the data.
 *
 * EVERY LINE HERE IS CHECKABLE IN THE CODEBASE. A privacy page whose claims cannot be verified is a
 * marketing page in the settings menu, and the one place a practice will look when it is deciding
 * whether to trust this thing with a real patient.
 */
export async function privacyPosture(admin: any, ctx: WorkspaceContext) {
  const [{ count: accessEntries }, { count: patients }, { data: oldest }] = await Promise.all([
    admin.from("practice_access_log").select("*", { count: "exact", head: true }).eq("workspace_id", ctx.workspaceId),
    admin.from("practice_patient").select("*", { count: "exact", head: true }).eq("workspace_id", ctx.workspaceId),
    admin.from("practice_access_log").select("occurred_at").eq("workspace_id", ctx.workspaceId)
      .order("occurred_at").limit(1).maybeSingle(),
  ]);

  // ⚠ THE SENDING GUARANTEE IS NOW READ, NOT TYPED.
  //
  // This line used to say "there is no delivery channel of any kind", and it was written when that was
  // literally true of the codebase. Migration 224 then shipped Twilio, Africa's Talking and Resend
  // adapters, and the sentence survived unchanged -- so the strongest promise on this page was being
  // kept only by the accident of nobody having set an environment variable. Setting RESEND_API_KEY would
  // have made a practice's privacy page lie, silently, with nothing failing.
  //
  // So it is derived from the two facts that actually decide it: whether this deployment has a provider,
  // and whether THIS PRACTICE has switched a channel on. Both are read; a failed read produces the
  // cautious sentence rather than the reassuring one, because a guarantee nobody could verify is not one.
  const env = messagingStatus();
  const { data: channelRows, error: channelErr } = await admin.from("practice_message_channel")
    .select("kind, enabled").eq("workspace_id", ctx.workspaceId);
  const providerConfigured = env.sms.configured || env.email.configured;
  const channelsReadable = !channelErr && channelRows != null;
  const practiceEnabled = channelsReadable && ((channelRows ?? []) as any[]).some(r => r.enabled);

  const sendingGuarantee = !channelsReadable
    ? "Whether this practice can send messages could not be checked just now, so nothing is claimed about it here."
    : providerConfigured && practiceEnabled
      ? "This practice HAS switched on messaging, and a provider is configured -- so appointment messages and one-time codes can leave this practice. What was sent, and what was refused, is listed in the message log."
      : providerConfigured
        ? "A message provider is configured for this deployment, but this practice has not switched any channel on -- so nothing is sent to your patients."
        : "Nothing in this product sends email, SMS or messages to patients: no gateway or mail provider is configured for this deployment, so there is nothing to send with.";

  return {
    accessEntries: accessEntries ?? 0,
    patients: patients ?? 0,
    loggingSince: oldest?.occurred_at ?? null,
    // ⚠ THE STATE BEHIND THE SENTENCE, AS FIELDS. A claim a reader cannot check is a claim they have to
    // take on trust, which is the opposite of what this page is for.
    messaging: {
      providerConfigured,
      practiceEnabled: channelsReadable ? practiceEnabled : null,
      readable: channelsReadable,
    },
    // Facts about the code, each one true at the commit that shipped this file.
    guarantees: [
      "Reads of a patient record, a consultation, a document, a search and an export are all logged.",
      "The access log is append-only: the database refuses an update or a delete of any entry.",
      "Reviewing the access log is itself logged, and shows patient names only to a reviewer who already holds clinical access.",
      sendingGuarantee,
      "One-time codes are never stored: only a salted hash of one is kept, it is single-use, it expires, and a guess that could not be counted is refused rather than judged.",
      "Dictation uses your browser's own speech recognition; no audio reaches Competen or is stored anywhere.",
      "Signed encounters and issued documents cannot be edited, enforced by database triggers rather than by application code.",
      "Every table is deny-by-default at the row level; nothing is readable without going through the capability checks.",
      // ── RETENTION, CODIFIED (owner decision, 2026-08-16). This used to sit in the gaps list as "a
      // legal question this product has not been given an answer to". The answer was given: the
      // status quo IS the policy, stated rather than left as an accident of nobody deciding.
      "Clinical records are not aged out: nothing here deletes patient data on a timer, and a record is kept for as long as the practice's own record exists. That is a decision of record, not an accident -- closing a practice keeps its records readable and exportable rather than destroying them.",
      "The access log is kept for the life of the practice, by the same decision: append-only and undeleted is the retention policy, not a gap waiting for one.",
      "Deleting a Competen account is immediate and permanent. There is no soft-delete and no grace period.",
    ],
    // Named rather than implied. A practice deciding whether to trust this deserves the gaps too.
    notYetTrue: [
      "The access log records reads made through this application. It cannot see a database console.",
      "There is no patient-facing view -- a patient asking who opened their record is answered by a practitioner reading it to them.",
      // ⚠ REWRITTEN 2026-08-16: this line used to say patients cannot book AT ALL, which became false
      // when the published booking page shipped (/practice/book/[handle], migration 254's publish
      // states). What is still true is narrower, and it is the delivery half.
      "Booking confirmations and one-time codes cannot be SENT: no mail or SMS provider is configured for this deployment. Patients can reach a published booking page and ask; what cannot happen yet is this product messaging them back.",
    ],
  };
}
