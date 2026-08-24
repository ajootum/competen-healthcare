import { audit } from "@/lib/practice/audit";
import { emitAudited } from "@/lib/practice/events";
import { editableEncounter, type EngineResult } from "@/lib/practice/encounters";
import { NOTE_TYPES } from "@/lib/practice/encounter-constants";
import { doseWithUnit } from "@/lib/practice/medication-constants";
import {
  DOCUMENT_TRANSITIONS, LOCKED_DOCUMENT_STATUSES, AMEND_ONLY_STATUSES, NOTE_SOURCES,
} from "@/lib/practice/document-constants";

// CPR-130 CLINICAL DOCUMENTATION. Three things, and the fourth that is deliberately absent.
//
//   TEMPLATE LIBRARY   platform templates plus workspace-authored ones, applied to an encounter to
//                      structure a note or to a document to start one.
//   NOTE VERSIONING    every committed save of a SOAP segment is kept, so "what did the note say when I
//                      signed it" is answerable. Through Phase 3 it was not: the segment was upserted in
//                      place and the previous text was simply gone.
//   DOCUMENTS          the sign-and-lock artefact -- referral letters, sick notes, summaries. The thing
//                      that LEAVES the practice. Amendment produces a new linked version, never an edit.
//
//   DICTATION          has no server component and no code in this file. It is the browser's speech
//                      recognition writing into a textarea, which the practitioner then saves like any
//                      other text. What IS recorded here is that a version came from dictation, because
//                      speech-assembled text has a different error profile from typed text and a reader
//                      of a clinical record is entitled to know which they are looking at.
//
// APPLYING A TEMPLATE NEVER OVERWRITES CLINICAL TEXT. This is the single most important rule in the file.
// A practitioner who types three sentences and then picks the wrong template must not lose them, so
// applyTemplate fills only EMPTY segments by default and refuses to touch anything already written. The
// "replace" mode exists, requires an explicit choice, and still versions the old text first -- so even
// the destructive path is recoverable from the history.
//
// THE DEPENDENCY RUNS ONE WAY: this module imports editableEncounter from encounters.ts and encounters.ts
// imports nothing from here.

/* eslint-disable @typescript-eslint/no-explicit-any */

const nowIso = () => new Date().toISOString();

// ── TEMPLATES ────────────────────────────────────────────────────────────────────────────────────────

/**
 * The library a workspace can see: the platform templates plus its own. Two queries rather than an `.or()`
 * because PostgREST's or-filter with a null test is easy to write in a way that quietly matches every row,
 * and a template list that leaks across workspaces is a leak of what a practice writes about.
 */
/**
 * The library, optionally with the caller's specialty first.
 *
 * CPR-360's specialty profile HAS TO CHANGE SOMETHING or it is a form that stores words. It reorders
 * this list and nothing else: a neurosurgeon sees neurosurgery templates at the top and still sees every
 * other one, because filtering them away would hide the sick note behind a preference.
 */
export async function listTemplates(admin: any, workspaceId: string, opts: {
  kind?: string; includeUnpublished?: boolean; specialty?: string | null;
} = {}) {
  const statuses = opts.includeUnpublished ? ["draft", "published"] : ["published"];

  const build = (q: any) => {
    let out = q.select("id, workspace_id, code, title, description, kind, specialty, status, version, updated_at, body_template")
      .in("status", statuses);
    if (opts.kind) out = out.eq("kind", opts.kind);
    return out.order("title");
  };
  const [platform, mine] = await Promise.all([
    build(admin.from("practice_note_template")).is("workspace_id", null),
    build(admin.from("practice_note_template")).eq("workspace_id", workspaceId),
  ]);

  const rows = [...((platform.data ?? []) as any[]), ...((mine.data ?? []) as any[])];
  // `mergeable` is the boolean, never the body: a LIST does not ship every template's full text to the
  // page, and generateFromTemplate re-checks the real column at generation time anyway.
  const mapped = rows.map(({ body_template, ...r }) => ({
    ...r,
    scope: r.workspace_id === null ? "platform" : "workspace",
    mergeable: !!(body_template && String(body_template).trim()),
  }));

  const specialty = (opts.specialty ?? "").trim().toLowerCase();
  if (!specialty) return mapped;
  // Stable within each group: a specialty match keeps the alphabetical order it arrived in.
  const mine_ = mapped.filter(r => String(r.specialty ?? "").toLowerCase() === specialty);
  const rest = mapped.filter(r => String(r.specialty ?? "").toLowerCase() !== specialty);
  return [...mine_, ...rest];
}

/** One template with its sections, resolved only if this workspace may see it. */
export async function getTemplate(admin: any, workspaceId: string, templateId: string) {
  const { data: t } = await admin.from("practice_note_template")
    .select("id, workspace_id, code, title, description, kind, specialty, status, version")
    .eq("id", templateId).maybeSingle();
  if (!t) return null;
  if (t.workspace_id !== null && t.workspace_id !== workspaceId) return null;

  const { data: sections } = await admin.from("practice_note_template_section")
    .select("id, note_type, heading, prompt, default_body, position, required")
    .eq("template_id", templateId).order("position");
  return { ...t, scope: t.workspace_id === null ? "platform" : "workspace", sections: sections ?? [] };
}

export type SectionInput = {
  noteType?: string; heading: string; prompt?: string; defaultBody?: string; required?: boolean;
};

export async function createTemplate(admin: any, args: {
  workspaceId: string; code: string; title: string; description?: string; kind?: string;
  specialty?: string; sections: SectionInput[]; bodyTemplate?: string; includeLetterhead?: boolean;
  actorId: string; correlationId: string;
}): Promise<EngineResult<{ id: string }>> {
  const code = args.code.trim().toLowerCase().replace(/[^a-z0-9_]+/g, "_");
  if (!code) return { ok: false, status: 400, code: "VALIDATION_ERROR", message: "a code is required" };
  if (!args.title.trim()) return { ok: false, status: 400, code: "VALIDATION_ERROR", message: "a title is required" };

  // TWO SHAPES OF TEMPLATE, and which one applies is decided by `kind` (CPR-330, migration 204).
  // An encounter note fills five SOAP boxes and needs SECTIONS. A letter is one flowing body with fields
  // merged into it and needs a BODY. Requiring both would make every referral template carry five empty
  // headings; requiring neither would let somebody publish a template that applies nothing.
  const kind = args.kind ?? "encounter_note";
  const body = (args.bodyTemplate ?? "").trim();
  if (kind === "encounter_note" && args.sections.length === 0)
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: "a template with no sections would apply nothing" };
  if (kind !== "encounter_note" && !body && args.sections.length === 0)
    return {
      ok: false, status: 400, code: "VALIDATION_ERROR",
      message: "a document template needs a body to merge into",
    };

  const bad = args.sections.find(s => s.noteType && !(NOTE_TYPES as readonly string[]).includes(s.noteType));
  if (bad) return { ok: false, status: 400, code: "VALIDATION_ERROR", message: `noteType must be one of: ${NOTE_TYPES.join(", ")}` };

  // A workspace template may not shadow a platform code: the two would be indistinguishable in a list
  // that shows the code, and "which one did I apply" is not a question a clinical record should raise.
  const { data: clash } = await admin.from("practice_note_template")
    .select("id").eq("code", code).is("workspace_id", null).maybeSingle();
  if (clash) return { ok: false, status: 409, code: "CODE_RESERVED", message: `"${code}" is the code of a platform template; choose another` };

  const { data: t, error } = await admin.from("practice_note_template").insert({
    workspace_id: args.workspaceId, code, title: args.title.trim(),
    description: args.description ?? null, kind,
    specialty: args.specialty ?? null, status: "draft", created_by: args.actorId, updated_by: args.actorId,
    body_template: body || null,
    include_letterhead: args.includeLetterhead !== false,
  }).select("id").single();
  if (error) {
    if (/duplicate|unique/i.test(error.message))
      return { ok: false, status: 409, code: "CODE_IN_USE", message: `this workspace already has a template coded "${code}"` };
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: error.message };
  }

  // Skipped entirely for a body-only document template -- an insert of no rows is not a thing to ask
  // PostgREST for, and its answer would be indistinguishable from a failure.
  const { error: sectionError } = args.sections.length === 0
    ? { error: null }
    : await admin.from("practice_note_template_section").insert(
      args.sections.map((s, i) => ({
        template_id: t.id, note_type: s.noteType ?? "narrative", heading: s.heading.trim(),
        prompt: s.prompt ?? null, default_body: s.defaultBody ?? "", position: i + 1, required: s.required === true,
      })),
    );
  // A template with no sections applies nothing, so a half-created one is worse than none at all.
  if (sectionError) {
    await admin.from("practice_note_template").delete().eq("id", t.id);
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: sectionError.message };
  }

  await audit(admin, {
    workspaceId: args.workspaceId, actorId: args.actorId, eventType: "practice.template_created",
    payload: { templateId: t.id, code }, correlationId: args.correlationId,
  });
  return { ok: true, data: { id: t.id as string } };
}

/**
 * Publish or retire. PLATFORM TEMPLATES ARE NOT A WORKSPACE'S TO CHANGE -- refused here by workspace id,
 * not by hiding the button, because the API is reachable without the button.
 */
export async function setTemplateStatus(admin: any, args: {
  workspaceId: string; templateId: string; status: "draft" | "published" | "retired";
  actorId: string; correlationId: string;
}): Promise<EngineResult<{ status: string; version: number }>> {
  const { data: t } = await admin.from("practice_note_template")
    .select("id, workspace_id, status, version").eq("id", args.templateId).maybeSingle();
  if (!t) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };
  if (t.workspace_id === null)
    return { ok: false, status: 403, code: "PLATFORM_TEMPLATE", message: "platform templates are read-only; copy it into your practice to change it" };
  if (t.workspace_id !== args.workspaceId) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };

  // Publishing is what bumps the version: a draft edited five times is still version 1 of nothing.
  const version = args.status === "published" && t.status !== "published" ? t.version + 1 : t.version;
  const { error } = await admin.from("practice_note_template")
    .update({ status: args.status, version, updated_at: nowIso(), updated_by: args.actorId })
    .eq("id", t.id);
  if (error) return { ok: false, status: 400, code: "VALIDATION_ERROR", message: error.message };

  await audit(admin, {
    workspaceId: args.workspaceId, actorId: args.actorId, eventType: `practice.template_${args.status}`,
    payload: { templateId: t.id, version }, correlationId: args.correlationId,
  });
  return { ok: true, data: { status: args.status, version } };
}

// ── NOTE SEGMENTS AND THEIR HISTORY ──────────────────────────────────────────────────────────────────

/**
 * Save one SOAP segment and keep the old text. Replaces the Phase-3 saveNote.
 *
 * A NO-OP SAVE WRITES NO VERSION. Clicking Save twice on unchanged text used to be harmless; with a
 * history behind it, it would fill the record with identical versions and make the useful ones hard to
 * find. Identity is checked against the stored body, not against a client-supplied "dirty" flag.
 */
export async function saveNoteSegment(admin: any, args: {
  workspaceId: string; encounterId: string; noteType: string; body: string;
  source?: string; templateId?: string | null; actorId: string; correlationId: string;
}): Promise<EngineResult<{ noteType: string; version: number; changed: boolean }>> {
  if (!(NOTE_TYPES as readonly string[]).includes(args.noteType))
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: `noteType must be one of: ${NOTE_TYPES.join(", ")}` };
  const source = (NOTE_SOURCES as readonly string[]).includes(args.source ?? "") ? args.source! : "typed";

  const guard = await editableEncounter(admin, args.workspaceId, args.encounterId);
  if (!guard.ok) return guard;

  const { data: existing } = await admin.from("practice_encounter_note")
    .select("id, body, version").eq("encounter_id", args.encounterId).eq("note_type", args.noteType).maybeSingle();

  if (existing && existing.body === args.body)
    return { ok: true, data: { noteType: args.noteType, version: existing.version, changed: false } };

  // UPSERT rather than the update/insert the read above would suggest, because two saves that both find
  // no row must not both insert. The conflict target is ux_practice_note_segment (194 s2), a full unique
  // index on exactly these two columns -- not a partial one, which is the shape that fails silently.
  const version = (existing?.version ?? 0) + 1;
  const { data: note, error } = await admin.from("practice_encounter_note").upsert({
    workspace_id: args.workspaceId, encounter_id: args.encounterId, note_type: args.noteType,
    body: args.body, version, last_source: source,
    ...(args.templateId ? { template_id: args.templateId } : {}),
    authored_by: args.actorId, updated_at: nowIso(),
  }, { onConflict: "encounter_id,note_type" }).select("id").single();
  if (error) return { ok: false, status: 400, code: "VALIDATION_ERROR", message: error.message };

  // NEVER DISCARDED. A version write that fails silently is a history with a hole in it, and a hole in a
  // history is worse than no history: it looks complete.
  const { error: versionError } = await admin.from("practice_encounter_note_version").insert({
    workspace_id: args.workspaceId, note_id: note.id, encounter_id: args.encounterId,
    note_type: args.noteType, body: args.body, version, source, authored_by: args.actorId,
  });
  if (versionError)
    return { ok: false, status: 500, code: "VERSION_NOT_RECORDED", message: `the text was saved but its version was not recorded: ${versionError.message}` };

  // THE DRAFT IS DELETED THE MOMENT ITS TEXT REACHES A VERSION (CPR-130, migration 207). Here rather
  // than in the route, because "a draft exists only until it is saved" is the invariant that keeps a
  // draft from ever being mistaken for the record -- and an invariant enforced by whoever remembers to
  // call the tidy-up is not one.
  await admin.from("practice_note_draft").delete()
    .eq("encounter_id", args.encounterId).eq("note_type", args.noteType).eq("author_id", args.actorId);

  // CPR-CORE-001 s13: a state-changing action leaves an audit entry. The version row above is not it, and
  // the difference is not pedantry -- a version is CLINICAL history, read by whoever opens the note and
  // scoped to one encounter, so answering "who wrote in this practice's records on Tuesday" from it means
  // opening every record to find out. The workspace trail answers that without opening any.
  //
  // ⚠ THE BODY IS NOT IN THE PAYLOAD. Anybody holding access.review can read this trail; a note's text is
  // the clinical content the trail exists to account for, not something to copy into it. The version
  // number is what points at the text for a reader who is entitled to it.
  //
  // A NO-OP SAVE RETURNED EARLIER and writes nothing here either: an entry saying somebody changed a note
  // they did not change is a false entry, and the trail is worth exactly what its worst row is worth.
  await audit(admin, {
    workspaceId: args.workspaceId, actorId: args.actorId, eventType: "practice.note_saved",
    payload: { encounterId: args.encounterId, noteType: args.noteType, version, source },
    correlationId: args.correlationId,
  });

  return { ok: true, data: { noteType: args.noteType, version, changed: true } };
}

/** Every recorded version of every segment of one encounter, newest first within each segment. */
export async function noteHistory(admin: any, workspaceId: string, encounterId: string) {
  const { data } = await admin.from("practice_encounter_note_version")
    .select("id, note_type, body, version, source, created_at, authored_by")
    .eq("workspace_id", workspaceId).eq("encounter_id", encounterId)
    .order("note_type").order("version", { ascending: false });

  const byType: Record<string, any[]> = {};
  for (const v of (data ?? []) as any[]) (byType[v.note_type] ??= []).push(v);
  return byType;
}

/**
 * Apply a template's sections to an encounter's note segments.
 *
 * `fill_empty` (the default) writes only where there is nothing. `replace` overwrites, and is a separate
 * word the caller has to type -- see the header. Either way every write goes through saveNoteSegment, so
 * the replaced text is in the history before the new text lands.
 */
export async function applyTemplate(admin: any, args: {
  workspaceId: string; encounterId: string; templateId: string; mode?: "fill_empty" | "replace";
  actorId: string; correlationId: string;
}): Promise<EngineResult<{ applied: string[]; skipped: string[] }>> {
  const mode = args.mode === "replace" ? "replace" : "fill_empty";
  const guard = await editableEncounter(admin, args.workspaceId, args.encounterId);
  if (!guard.ok) return guard;

  const template = await getTemplate(admin, args.workspaceId, args.templateId);
  if (!template) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };
  if (template.status !== "published")
    return { ok: false, status: 422, code: "TEMPLATE_NOT_PUBLISHED", message: "this template is not published" };
  if (template.kind !== "encounter_note")
    return { ok: false, status: 422, code: "WRONG_TEMPLATE_KIND", message: "only an encounter-note template can be applied to an encounter" };

  const { data: current } = await admin.from("practice_encounter_note")
    .select("note_type, body").eq("encounter_id", args.encounterId);
  const bodyByType = new Map<string, string>(((current ?? []) as any[]).map(n => [n.note_type, n.body ?? ""]));

  // Sections are grouped by note_type first: SOAP has five boxes and a template may put two headings in
  // one of them, so writing per-section would have the second heading overwrite the first.
  const composed = new Map<string, string>();
  for (const s of template.sections as any[]) {
    const piece = [`${s.heading}`, s.default_body].filter(x => String(x ?? "").trim()).join("\n");
    composed.set(s.note_type, [composed.get(s.note_type), piece].filter(Boolean).join("\n\n"));
  }

  const applied: string[] = [];
  const skipped: string[] = [];
  for (const [noteType, text] of composed) {
    const existing = (bodyByType.get(noteType) ?? "").trim();
    if (existing && mode === "fill_empty") { skipped.push(noteType); continue; }

    const body = existing && mode === "replace" ? text : existing ? `${existing}\n\n${text}` : text;
    const res = await saveNoteSegment(admin, {
      workspaceId: args.workspaceId, encounterId: args.encounterId, noteType, body,
      source: "template", templateId: template.id, actorId: args.actorId, correlationId: args.correlationId,
    });
    if (!res.ok) return res;
    applied.push(noteType);
  }

  await audit(admin, {
    workspaceId: args.workspaceId, actorId: args.actorId, eventType: "practice.template_applied",
    payload: { encounterId: args.encounterId, templateId: template.id, mode, applied, skipped },
    correlationId: args.correlationId,
  });
  return { ok: true, data: { applied, skipped } };
}

// ── CLINICAL DOCUMENTS ───────────────────────────────────────────────────────────────────────────────

/**
 * Compose a document body from what the encounter ACTUALLY holds. Sections with no content are omitted
 * rather than rendered as an empty heading: a referral letter with "Examination and findings:" and
 * nothing under it says something false about the consultation.
 *
 * Returns an empty string when the encounter holds nothing, and the caller decides what that means.
 */
export async function composeFromEncounter(admin: any, workspaceId: string, encounterId: string): Promise<string> {
  const [{ data: enc }, { data: notes }, { data: diagnoses }, { data: treatments }] = await Promise.all([
    admin.from("practice_encounter").select("reason_for_visit, started_at").eq("id", encounterId).eq("workspace_id", workspaceId).maybeSingle(),
    admin.from("practice_encounter_note").select("note_type, body").eq("workspace_id", workspaceId).eq("encounter_id", encounterId),
    admin.from("practice_diagnosis").select("label, certainty, is_primary").eq("workspace_id", workspaceId).eq("encounter_id", encounterId).order("created_at"),
    // ⚠ dose_unit AND THE NON-DRUG DETAIL ARE SELECTED BECAUSE THIS TEXT LEAVES THE BUILDING. What this
    // composes becomes a referral letter to another clinician, a discharge summary, or the consultation
    // summary handed to the patient. Without the unit it printed "Amoxicillin (3, Oral, TDS)" -- three
    // of something, to a reader who cannot ask.
    admin.from("practice_treatment").select("treatment_type, label, dose, dose_unit, route, frequency, duration, non_drug_category").eq("workspace_id", workspaceId).eq("encounter_id", encounterId).order("created_at"),
  ]);
  if (!enc) return "";

  const LABEL: Record<string, string> = {
    subjective: "History", objective: "Examination and findings",
    assessment: "Impression", plan: "Plan", narrative: "Notes",
  };
  const parts: string[] = [];
  if (enc.reason_for_visit) parts.push(`Reason for visit: ${enc.reason_for_visit}`);

  const byType = new Map(((notes ?? []) as any[]).map(n => [n.note_type, String(n.body ?? "").trim()]));
  for (const t of ["subjective", "objective", "assessment", "plan", "narrative"]) {
    const body = byType.get(t);
    if (body) parts.push(`${LABEL[t]}\n${body}`);
  }

  const dx = (diagnoses ?? []) as any[];
  if (dx.length) {
    parts.push(["Diagnoses", ...dx.map(d => `- ${d.label} (${d.certainty}${d.is_primary ? ", primary" : ""})`)].join("\n"));
  }
  const tx = (treatments ?? []) as any[];
  if (tx.length) {
    // ⚠ THE DOSE CARRIES ITS UNIT, AND A NON-DRUG CARRIES ITS OWN DETAIL. A wound dressing used to
    // print as a bare label in a discharge summary -- the site and method it was recorded with simply
    // absent from the letter, because this line only knew how to describe a medication.
    parts.push(["Treatment and plan", ...tx.map(t => {
      const detail = [
        doseWithUnit(t.dose, t.dose_unit),
        t.non_drug_category, t.route, t.frequency, t.duration,
      ].filter(Boolean);
      return `- ${t.label}${detail.length ? ` (${detail.join(", ")})` : ""}`;
    })].join("\n"));
  }
  return parts.join("\n\n");
}

export async function createDocument(admin: any, args: {
  workspaceId: string; patientId: string; encounterId?: string | null; templateId?: string | null;
  docType?: string; title: string; addressedTo?: string; body?: string; composeFrom?: boolean;
  actorId: string; correlationId: string;
}): Promise<EngineResult<{ id: string; composed: boolean }>> {
  if (!args.title.trim()) return { ok: false, status: 400, code: "VALIDATION_ERROR", message: "a title is required" };

  const { data: patient } = await admin.from("practice_patient")
    .select("id, status").eq("id", args.patientId).eq("workspace_id", args.workspaceId).maybeSingle();
  if (!patient) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };
  if (patient.status !== "active")
    return { ok: false, status: 422, code: "PATIENT_NOT_ACTIVE", message: "this patient record is not active (archived or merged)" };

  // A named encounter must belong to this workspace AND this patient. A referral letter filed against
  // someone else's consultation is the same class of error as an encounter on the wrong appointment.
  let encounterId: string | null = null;
  if (args.encounterId) {
    const { data: enc } = await admin.from("practice_encounter")
      .select("id, patient_id").eq("id", args.encounterId).eq("workspace_id", args.workspaceId).maybeSingle();
    if (!enc) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };
    if (enc.patient_id !== args.patientId)
      return { ok: false, status: 422, code: "ENCOUNTER_PATIENT_MISMATCH", message: "that encounter belongs to a different patient" };
    encounterId = enc.id;
  }

  let body = args.body ?? "";
  let composed = false;
  if (args.composeFrom && encounterId) {
    body = await composeFromEncounter(admin, args.workspaceId, encounterId);
    composed = true;
  } else if (!body && args.templateId) {
    const template = await getTemplate(admin, args.workspaceId, args.templateId);
    if (!template) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };
    body = (template.sections as any[])
      .map(s => [s.heading, String(s.default_body ?? "").trim()].filter(Boolean).join("\n"))
      .join("\n\n");
  }

  const { data: doc, error } = await admin.from("practice_clinical_document").insert({
    workspace_id: args.workspaceId, patient_id: args.patientId, encounter_id: encounterId,
    template_id: args.templateId ?? null, doc_type: args.docType ?? "consultation_summary",
    title: args.title.trim(), body, addressed_to: args.addressedTo ?? null,
    status: "DRAFT", version: 1, created_by: args.actorId, updated_by: args.actorId,
  }).select("id").single();
  if (error) return { ok: false, status: 400, code: "VALIDATION_ERROR", message: error.message };

  await audit(admin, {
    workspaceId: args.workspaceId, actorId: args.actorId, eventType: "practice.document_created",
    payload: { documentId: doc.id, patientId: args.patientId, encounterId, docType: args.docType ?? "consultation_summary", composed },
    correlationId: args.correlationId,
  });

  // ── s9 DOMAIN EVENT ───────────────────────────────────────────────────────────────────────────
  //
  // Recent Documents names document.created as its trigger. This is the DRAFT existing, not the
  // document being finished -- document.signed is the second of the three, and document.issued the
  // third, and the catalogue keeps them separate because a card that showed drafts as issued letters
  // would be claiming things had been sent that are still being written.
  await emitAudited(admin, [{
    eventType: "document.created", practiceId: args.workspaceId,
    practitionerId: args.actorId, actorId: args.actorId, source: "web",
    patientId: args.patientId ?? null, encounterId,
    payload: { documentId: doc.id, docType: args.docType ?? "consultation_summary", composed, status: "DRAFT" },
  }], args.correlationId);
  return { ok: true, data: { id: doc.id as string, composed } };
}

/** Edit a document that is not yet signed. Optimistic concurrency, as everywhere else in this schema. */
export async function updateDocument(admin: any, args: {
  workspaceId: string; documentId: string; title?: string; body?: string; addressedTo?: string | null;
  docType?: string; recordVersion?: number; actorId: string; correlationId: string;
}): Promise<EngineResult<{ recordVersion: number }>> {
  const { data: doc } = await admin.from("practice_clinical_document")
    .select("id, status, record_version").eq("id", args.documentId).eq("workspace_id", args.workspaceId).maybeSingle();
  if (!doc) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };
  if (LOCKED_DOCUMENT_STATUSES.includes(doc.status))
    return { ok: false, status: 422, code: "DOCUMENT_LOCKED", message: "this document is issued; amend it to make changes" };

  const patch: Record<string, unknown> = {
    record_version: doc.record_version + 1, updated_at: nowIso(), updated_by: args.actorId,
  };
  if (args.title !== undefined) {
    if (!args.title.trim()) return { ok: false, status: 400, code: "VALIDATION_ERROR", message: "a title is required" };
    patch.title = args.title.trim();
  }
  if (args.body !== undefined) patch.body = args.body;
  if (args.addressedTo !== undefined) patch.addressed_to = args.addressedTo;
  if (args.docType !== undefined) patch.doc_type = args.docType;

  const expected = args.recordVersion ?? doc.record_version;
  const { data: updated, error } = await admin.from("practice_clinical_document")
    .update(patch).eq("workspace_id", args.workspaceId).eq("id", doc.id).eq("record_version", expected).select("id").maybeSingle();
  if (error) return { ok: false, status: 422, code: "REFUSED_BY_DATABASE", message: error.message };
  if (!updated) return { ok: false, status: 409, code: "VERSION_CONFLICT", message: "the document changed underneath you; reload and retry" };

  // s13 again. Creating, signing, issuing and amending a document each left an entry; EDITING one did
  // not, so the trail read as though a letter sprang into existence and was signed unchanged. WHICH
  // FIELDS MOVED, NOT WHAT THEY BECAME -- the body of a referral is clinical content and the trail is
  // readable by anybody holding access.review; the record version is the pointer for a reader entitled
  // to the text itself.
  await audit(admin, {
    workspaceId: args.workspaceId, actorId: args.actorId, eventType: "practice.document_updated",
    payload: {
      documentId: doc.id, recordVersion: doc.record_version + 1,
      fields: ["title", "body", "addressedTo", "docType"].filter(
        f => (args as Record<string, unknown>)[f] !== undefined),
    },
    correlationId: args.correlationId,
  });
  return { ok: true, data: { recordVersion: doc.record_version + 1 } };
}

export async function transitionDocument(admin: any, args: {
  workspaceId: string; documentId: string; to: string; actorId: string; correlationId: string;
}): Promise<EngineResult<{ status: string }>> {
  // patient_id and encounter_id are selected for the domain event below.
  const { data: doc } = await admin.from("practice_clinical_document")
    .select("id, status, body, patient_id, encounter_id, record_version").eq("id", args.documentId).eq("workspace_id", args.workspaceId).maybeSingle();
  if (!doc) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };

  if (AMEND_ONLY_STATUSES.includes(args.to))
    return { ok: false, status: 422, code: "USE_AMEND", message: "amending a document creates a new version; use the amend action" };
  if (!(DOCUMENT_TRANSITIONS[doc.status] ?? []).includes(args.to))
    return { ok: false, status: 422, code: "ILLEGAL_TRANSITION", message: `${doc.status} cannot become ${args.to}` };
  // Signing an empty document would put a signature on nothing at all.
  if (args.to === "SIGNED" && !String(doc.body ?? "").trim())
    return { ok: false, status: 422, code: "EMPTY_DOCUMENT", message: "this document has no content to sign" };

  const patch: Record<string, unknown> = {
    status: args.to, record_version: doc.record_version + 1, updated_at: nowIso(), updated_by: args.actorId,
  };
  if (args.to === "SIGNED") { patch.signed_at = nowIso(); patch.signed_by = args.actorId; }

  const { data: updated, error } = await admin.from("practice_clinical_document")
    .update(patch).eq("workspace_id", args.workspaceId).eq("id", doc.id).eq("record_version", doc.record_version).select("id").maybeSingle();
  if (error) return { ok: false, status: 422, code: "REFUSED_BY_DATABASE", message: error.message };
  if (!updated) return { ok: false, status: 409, code: "VERSION_CONFLICT", message: "the document changed underneath you; reload and retry" };

  await audit(admin, {
    workspaceId: args.workspaceId, actorId: args.actorId,
    eventType: `practice.document_${args.to.toLowerCase()}`, payload: { documentId: doc.id },
    correlationId: args.correlationId,
  });

  // ── s9 DOMAIN EVENT ───────────────────────────────────────────────────────────────────────────
  //
  // ⚠ SIGNED ONLY, AND THE OTHER TRANSITIONS ARE NOT NEAR-MISSES. DOCUMENT_TRANSITIONS also reaches
  // FINAL, DRAFT and ENTERED_IN_ERROR, and the catalogue has no type for any of them. FINAL is not a
  // signature -- migration 195 keeps signed_at and signed_by for the moment a name goes on the record
  // -- and announcing it as one would put an unsigned document into whatever counts signed ones.
  if (args.to === "SIGNED") {
    await emitAudited(admin, [{
      eventType: "document.signed", practiceId: args.workspaceId,
      practitionerId: args.actorId, actorId: args.actorId, source: "web",
      patientId: doc.patient_id ?? null, encounterId: doc.encounter_id ?? null,
      payload: { documentId: doc.id, from: doc.status },
    }], args.correlationId);
  }

  return { ok: true, data: { status: args.to } };
}

/**
 * Amend a signed document: create the successor, then move the original to AMENDED.
 *
 * IN THAT ORDER, DELIBERATELY. If the successor insert fails, the original is still SIGNED and the
 * practitioner tries again -- the record is unchanged. Moving the original first and then failing to
 * create the successor would leave a document marked "replaced" by nothing, which is a record that
 * contradicts itself and cannot be repaired from the app.
 */
export async function amendDocument(admin: any, args: {
  workspaceId: string; documentId: string; reason: string; actorId: string; correlationId: string;
}): Promise<EngineResult<{ id: string; version: number }>> {
  if (!args.reason.trim())
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: "an amendment must say why" };

  const { data: doc } = await admin.from("practice_clinical_document")
    .select("id, status, record_version, patient_id, encounter_id, template_id, doc_type, title, body, addressed_to, version")
    .eq("id", args.documentId).eq("workspace_id", args.workspaceId).maybeSingle();
  if (!doc) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };
  if (doc.status !== "SIGNED")
    return { ok: false, status: 422, code: "NOT_SIGNED", message: "only a signed document can be amended" };

  const { data: successor, error } = await admin.from("practice_clinical_document").insert({
    workspace_id: args.workspaceId, patient_id: doc.patient_id, encounter_id: doc.encounter_id,
    template_id: doc.template_id, doc_type: doc.doc_type, title: doc.title, body: doc.body,
    addressed_to: doc.addressed_to, status: "DRAFT", version: doc.version + 1,
    supersedes_document_id: doc.id, amendment_reason: args.reason.trim(),
    created_by: args.actorId, updated_by: args.actorId,
  }).select("id, version").single();
  if (error) {
    // The partial unique index on supersedes_document_id is the backstop for two concurrent amendments.
    if (/duplicate|unique/i.test(error.message))
      return { ok: false, status: 409, code: "ALREADY_AMENDED", message: "this document has already been amended; open the newer version" };
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: error.message };
  }

  const { data: moved, error: moveError } = await admin.from("practice_clinical_document")
    .update({ status: "AMENDED", record_version: doc.record_version + 1, updated_at: nowIso(), updated_by: args.actorId }).eq("workspace_id", args.workspaceId)
    .eq("id", doc.id).eq("record_version", doc.record_version).select("id").maybeSingle();
  if (moveError || !moved) {
    await admin.from("practice_clinical_document").delete().eq("workspace_id", args.workspaceId).eq("id", successor.id);
    return { ok: false, status: 409, code: "VERSION_CONFLICT", message: "the document changed underneath you; reload and retry" };
  }

  await audit(admin, {
    workspaceId: args.workspaceId, actorId: args.actorId, eventType: "practice.document_amended",
    payload: { documentId: doc.id, successorId: successor.id, version: successor.version, reason: args.reason.trim() },
    correlationId: args.correlationId,
  });
  return { ok: true, data: { id: successor.id as string, version: successor.version as number } };
}

/**
 * Record that a copy left the practice. Only a SIGNED document can be released -- issuing a draft is how
 * a patient ends up holding a letter the practitioner never stood behind.
 */
export async function recordRelease(admin: any, args: {
  workspaceId: string; documentId: string; channel: string; recipient?: string; note?: string;
  actorId: string; correlationId: string;
}): Promise<EngineResult<{ id: string }>> {
  // patient_id and encounter_id are selected for the domain event below.
  const { data: doc } = await admin.from("practice_clinical_document")
    .select("id, status, patient_id, encounter_id").eq("id", args.documentId).eq("workspace_id", args.workspaceId).maybeSingle();
  if (!doc) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };
  if (doc.status !== "SIGNED")
    return { ok: false, status: 422, code: "NOT_SIGNED", message: "only a signed document can be issued" };

  const { data: rel, error } = await admin.from("practice_clinical_document_release").insert({
    workspace_id: args.workspaceId, document_id: doc.id, channel: args.channel,
    recipient: args.recipient ?? null, note: args.note ?? null, released_by: args.actorId,
  }).select("id").single();
  if (error) return { ok: false, status: 400, code: "VALIDATION_ERROR", message: error.message };

  await audit(admin, {
    workspaceId: args.workspaceId, actorId: args.actorId, eventType: "practice.document_released",
    payload: { documentId: doc.id, channel: args.channel }, correlationId: args.correlationId,
  });

  // ── s9 DOMAIN EVENT: ISSUED ───────────────────────────────────────────────────────────────────
  //
  // ⚠ RELEASE IS WHAT "ISSUED" MEANS HERE, and it is worth saying because there is no ISSUED status
  // to look for. DOCUMENT_TRANSITIONS runs DRAFT -> FINAL -> SIGNED -> AMENDED and stops; the moment
  // a document leaves the practice is a row in practice_clinical_document_release, and this function
  // is the only thing that writes one. Its own refusal above says "only a signed document can be
  // issued", so the vocabulary was already agreed -- there was simply nothing announcing it.
  await emitAudited(admin, [{
    eventType: "document.issued", practiceId: args.workspaceId,
    practitionerId: args.actorId, actorId: args.actorId, source: "web",
    patientId: doc.patient_id ?? null, encounterId: doc.encounter_id ?? null,
    payload: { documentId: doc.id, releaseId: rel.id, channel: args.channel, recipient: args.recipient ?? null },
  }], args.correlationId);
  return { ok: true, data: { id: rel.id as string } };
}

/** One document with its patient, its releases, and both ends of its version chain. */
export async function getDocument(admin: any, workspaceId: string, documentId: string) {
  const { data: doc } = await admin.from("practice_clinical_document")
    .select("id, patient_id, encounter_id, template_id, doc_type, title, body, addressed_to, status, version, supersedes_document_id, content_model, style_id, amendment_reason, signed_at, signed_by, record_version, created_at, updated_at")
    .eq("id", documentId).eq("workspace_id", workspaceId).maybeSingle();
  if (!doc) return null;

  const [{ data: patient }, { data: releases }, { data: successor }, { data: predecessor }] = await Promise.all([
    admin.from("practice_patient").select("id, display_name, sex, birth_date, age_estimate_years").eq("workspace_id", workspaceId).eq("id", doc.patient_id).maybeSingle(),
    admin.from("practice_clinical_document_release").select("id, channel, recipient, note, released_at").eq("workspace_id", workspaceId).eq("document_id", documentId).order("released_at"),
    admin.from("practice_clinical_document").select("id, version, status").eq("workspace_id", workspaceId).eq("supersedes_document_id", documentId).maybeSingle(),
    doc.supersedes_document_id
      ? admin.from("practice_clinical_document").select("id, version, status").eq("workspace_id", workspaceId).eq("id", doc.supersedes_document_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  return { document: doc, patient, releases: releases ?? [], successor: successor ?? null, predecessor: predecessor ?? null };
}

export async function listDocuments(admin: any, workspaceId: string, filter: {
  patientId?: string; encounterId?: string; status?: string; limit?: number;
} = {}) {
  let q = admin.from("practice_clinical_document")
    .select("id, patient_id, encounter_id, doc_type, title, status, version, signed_at, created_at, supersedes_document_id")
    .eq("workspace_id", workspaceId);
  if (filter.patientId) q = q.eq("patient_id", filter.patientId);
  if (filter.encounterId) q = q.eq("encounter_id", filter.encounterId);
  if (filter.status) q = q.eq("status", filter.status);

  const { data } = await q.order("created_at", { ascending: false }).limit(filter.limit ?? 50);
  const docs = (data ?? []) as any[];
  if (docs.length === 0) return [];

  // Names in one query rather than one per row.
  const { data: patients } = await admin.from("practice_patient")
    .select("id, display_name").eq("workspace_id", workspaceId).in("id", [...new Set(docs.map(d => d.patient_id))]);
  const nameById = new Map(((patients ?? []) as any[]).map(p => [p.id, p.display_name]));
  return docs.map(d => ({ ...d, patient_name: nameById.get(d.patient_id) ?? null }));
}
