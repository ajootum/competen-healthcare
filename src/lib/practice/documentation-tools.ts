import { audit } from "@/lib/practice/provisioning";
import type { EngineResult } from "@/lib/practice/encounters";
import { NOTE_TYPES } from "@/lib/practice/encounter-constants";
import { LOCKED_STATUSES } from "@/lib/practice/encounter-constants";

// CPR-130's documentation tools: autosave drafts, smart text, attachments.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// A DRAFT IS NOT A VERSION, AND IT IS NOT THE RECORD.
//
// Autosave was designed against on the grounds that saving every two minutes would write a version
// every two minutes and bury the meaningful ones. That was true of the design being imagined, and the
// requirement was still real -- CPR-130 s3 lists autosave first, and CPR-360's comp independently sets
// the interval at two minutes.
//
// The two objects answer different questions. A VERSION answers "what did the record say at 10:55, and
// who wrote it": deliberate, immutable, append-only, clinical. A DRAFT answers "what was in the box
// when the browser closed": overwritten in place, private to its author, and not part of the record
// until somebody saves it. So the version history stays exactly as clean as it was, and an hour of work
// survives a closed laptop.
//
// A DRAFT IS PRIVATE TO ITS AUTHOR. Not a permission subtlety -- the point. Unsaved text is a thought in
// progress; showing a colleague half a sentence about a differential nobody has settled on is worse than
// showing them nothing.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

/* eslint-disable @typescript-eslint/no-explicit-any */

const nowIso = () => new Date().toISOString();

async function editableEncounter(admin: any, workspaceId: string, encounterId: string) {
  const { data: enc } = await admin.from("practice_encounter")
    .select("id, patient_id, status").eq("id", encounterId).eq("workspace_id", workspaceId).maybeSingle();
  if (!enc) return { ok: false as const, status: 404, code: "NOT_FOUND", message: "Not found" };
  if (LOCKED_STATUSES.includes(enc.status))
    return { ok: false as const, status: 422, code: "ENCOUNTER_LOCKED", message: `a ${enc.status.toLowerCase()} consultation cannot be changed; amend it instead` };
  return { ok: true as const, encounter: enc };
}

// ── AUTOSAVE ─────────────────────────────────────────────────────────────────────────────────────────

export async function saveDraft(admin: any, args: {
  workspaceId: string; encounterId: string; noteType: string; body: string;
  basedOnVersion?: number | null; actorId: string;
}): Promise<EngineResult<{ savedAt: string }>> {
  if (!(NOTE_TYPES as readonly string[]).includes(args.noteType))
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: `noteType must be one of: ${NOTE_TYPES.join(", ")}` };

  // A SIGNED CONSULTATION TAKES NO DRAFTS. Autosaving into one would accumulate text that can never be
  // saved, and offer it back later as though it could be.
  const guard = await editableEncounter(admin, args.workspaceId, args.encounterId);
  if (!guard.ok) return guard;

  // Upsert on the full unique index (207 s1) -- three columns, not partial. The trap migration 186
  // recorded is a partial index as a conflict target; this one is complete on purpose.
  const { error } = await admin.from("practice_note_draft").upsert({
    workspace_id: args.workspaceId, encounter_id: args.encounterId, note_type: args.noteType,
    author_id: args.actorId, body: args.body,
    based_on_version: args.basedOnVersion ?? null, updated_at: nowIso(),
  }, { onConflict: "encounter_id,note_type,author_id" });
  // NEVER DISCARDED. An autosave that silently failed would be worse than no autosave: somebody would
  // stop worrying about losing their work at exactly the moment they had started losing it.
  if (error) return { ok: false, status: 400, code: "DRAFT_NOT_SAVED", message: error.message };

  // NOT AUDITED, deliberately. An autosave every two minutes would drown the trail that exists to answer
  // who changed the clinical record -- and a draft is not the clinical record. The save that promotes it
  // is audited, as it always was.
  return { ok: true, data: { savedAt: nowIso() } };
}

/**
 * The caller's own unsaved text for one encounter.
 *
 * SCOPED TO THE CALLER, always. There is no argument for a parameter here: a function that could return
 * somebody else's drafts is one that will eventually be called with the wrong id.
 */
export async function myDrafts(admin: any, workspaceId: string, encounterId: string, actorId: string) {
  const { data } = await admin.from("practice_note_draft")
    .select("note_type, body, based_on_version, updated_at")
    .eq("workspace_id", workspaceId).eq("encounter_id", encounterId).eq("author_id", actorId);

  const rows = (data ?? []) as any[];
  if (rows.length === 0) return { drafts: [] as any[] };

  // Compared against what is SAVED, so the UI can say "this differs from the note" rather than offering
  // a restore that would change nothing.
  const { data: saved } = await admin.from("practice_encounter_note")
    .select("note_type, body, version").eq("encounter_id", encounterId);
  const savedByType = new Map(((saved ?? []) as any[]).map(s => [s.note_type, s]));

  return {
    drafts: rows.map(d => {
      const current = savedByType.get(d.note_type);
      return {
        noteType: d.note_type, body: d.body, updatedAt: d.updated_at,
        differsFromSaved: (current?.body ?? "") !== d.body,
        // The note moved on while this draft sat unsaved -- somebody else saved, or the author did from
        // another tab. Restoring would overwrite that, so the UI has to say so rather than just offer it.
        savedMovedOn: d.based_on_version != null && current?.version != null && current.version !== d.based_on_version,
        savedVersion: current?.version ?? null,
      };
    }),
  };
}

export async function discardDraft(admin: any, args: {
  workspaceId: string; encounterId: string; noteType: string; actorId: string;
}): Promise<EngineResult<{ discarded: boolean }>> {
  const { data } = await admin.from("practice_note_draft").delete()
    .eq("workspace_id", args.workspaceId).eq("encounter_id", args.encounterId)
    .eq("note_type", args.noteType).eq("author_id", args.actorId).select("id");
  return { ok: true, data: { discarded: ((data ?? []) as any[]).length > 0 } };
}

// ── SMART TEXT ───────────────────────────────────────────────────────────────────────────────────────

/** Shared phrases plus the caller's own. A personal shortcut shadows a shared one of the same name. */
export async function listPhrases(admin: any, workspaceId: string, actorId: string) {
  const { data } = await admin.from("practice_smart_phrase")
    .select("id, author_id, shortcut, body, description, used_count")
    .eq("workspace_id", workspaceId).or(`author_id.is.null,author_id.eq.${actorId}`)
    .order("shortcut");

  const rows = ((data ?? []) as any[]).map(p => ({ ...p, scope: p.author_id === null ? "practice" : "personal" }));

  // A PERSONAL SHORTCUT WINS OVER A SHARED ONE OF THE SAME NAME. Somebody who has written their own
  // version of the practice's normal-examination paragraph means to use theirs; silently expanding the
  // practice's would put words in their note they did not write.
  const personal = new Set(rows.filter(p => p.scope === "personal").map(p => p.shortcut));
  return rows.filter(p => p.scope === "personal" || !personal.has(p.shortcut));
}

export async function createPhrase(admin: any, args: {
  workspaceId: string; shortcut: string; body: string; description?: string;
  shared?: boolean; actorId: string; correlationId: string;
}): Promise<EngineResult<{ id: string }>> {
  // A shortcut is a token typed into prose, so it may not contain whitespace -- ".normal exam" would
  // expand halfway through a sentence and leave the rest behind.
  const shortcut = args.shortcut.trim().toLowerCase();
  if (!/^[.a-z0-9_-]{2,40}$/.test(shortcut))
    return {
      ok: false, status: 400, code: "VALIDATION_ERROR",
      message: "a shortcut is 2 to 40 characters, letters, digits, dot, dash or underscore, and no spaces",
    };
  if (!args.body.trim())
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: "a phrase needs some text to expand to" };

  const { data, error } = await admin.from("practice_smart_phrase").insert({
    workspace_id: args.workspaceId, author_id: args.shared ? null : args.actorId,
    shortcut, body: args.body.trim(), description: args.description?.trim() || null,
    created_by: args.actorId,
  }).select("id").single();
  if (error) {
    if (/duplicate|unique/i.test(error.message))
      return { ok: false, status: 409, code: "SHORTCUT_IN_USE", message: `"${shortcut}" is already in use here` };
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: error.message };
  }

  await audit(admin, {
    workspaceId: args.workspaceId, actorId: args.actorId, eventType: "practice.smart_phrase_created",
    payload: { shortcut, shared: args.shared === true }, correlationId: args.correlationId,
  });
  return { ok: true, data: { id: data.id as string } };
}

export async function deletePhrase(admin: any, args: {
  workspaceId: string; phraseId: string; actorId: string; correlationId: string;
}): Promise<EngineResult<{ deleted: true }>> {
  const { data: p } = await admin.from("practice_smart_phrase")
    .select("id, author_id, shortcut").eq("id", args.phraseId).eq("workspace_id", args.workspaceId).maybeSingle();
  if (!p) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };
  // A shared phrase belongs to the practice; a personal one belongs to its author and nobody else may
  // remove it, because it is not visible to them to have an opinion about.
  if (p.author_id !== null && p.author_id !== args.actorId)
    return { ok: false, status: 403, code: "NOT_YOURS", message: "that is somebody else's personal phrase" };

  await admin.from("practice_smart_phrase").delete().eq("id", p.id);
  await audit(admin, {
    workspaceId: args.workspaceId, actorId: args.actorId, eventType: "practice.smart_phrase_deleted",
    payload: { shortcut: p.shortcut }, correlationId: args.correlationId,
  });
  return { ok: true, data: { deleted: true } };
}

/**
 * Expand every shortcut in a block of text.
 *
 * PURE, AND EXPORTED FOR THE CLIENT. The expansion happens in the box the practitioner is typing in, so
 * they SEE the result before anything is saved -- which is the whole difference between smart text and
 * the letter generator, where an unresolved field has to be marked because nobody will re-read it.
 *
 * A shortcut only expands when it stands alone. "u.bp" inside a word, or ".bp" glued to a preceding
 * letter, is left exactly as typed: a rule that rewrote arbitrary substrings of a clinical note would be
 * the single most alarming feature in this product.
 */
export function expandPhrases(text: string, phrases: { shortcut: string; body: string }[]): {
  text: string; expanded: string[];
} {
  const expanded: string[] = [];
  let out = text;
  // Longest first, so ".exam_normal" is not eaten by ".exam".
  for (const p of [...phrases].sort((a, b) => b.shortcut.length - a.shortcut.length)) {
    const escaped = p.shortcut.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(`(^|[\\s(\\[])${escaped}(?=$|[\\s.,;:)\\]])`, "gi");
    if (!pattern.test(out)) continue;
    pattern.lastIndex = 0;
    out = out.replace(pattern, (_m, lead: string) => `${lead}${p.body}`);
    expanded.push(p.shortcut);
  }
  return { text: out, expanded };
}

/** Bumped when a phrase is actually used, for the "most used" ordering the comp shows. */
export async function recordPhraseUse(admin: any, workspaceId: string, shortcuts: string[], actorId: string) {
  if (shortcuts.length === 0) return;
  const { data } = await admin.from("practice_smart_phrase")
    .select("id, used_count, shortcut, author_id").eq("workspace_id", workspaceId).in("shortcut", shortcuts);
  for (const p of ((data ?? []) as any[])) {
    if (p.author_id !== null && p.author_id !== actorId) continue;
    await admin.from("practice_smart_phrase").update({ used_count: (p.used_count ?? 0) + 1 }).eq("id", p.id);
  }
}

// ── ATTACHMENTS ──────────────────────────────────────────────────────────────────────────────────────

export const ATTACHMENT_BUCKET = "practice-attachments";
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

/**
 * What may be attached to a clinical record.
 *
 * DELIBERATELY NARROW: images and PDFs, which is what CPR-130 s3 asks for. The platform's asset
 * repository allows archives and office documents; a clinical attachment allowing a .zip would be a
 * place to put things nobody can read from the record they are filed against.
 */
export const ATTACHMENT_MIME = new Set([
  "image/png", "image/jpeg", "image/webp", "image/heic", "application/pdf",
]);

export const ATTACHMENT_KINDS = [
  ["photograph", "Clinical photograph"],
  ["scan", "Scan or imaging"],
  ["result", "Result or report"],
  ["consent", "Consent form"],
  ["referral", "Referral or letter"],
  ["other", "Other"],
] as const;

export async function ensureAttachmentBucket(admin: any): Promise<{ ok: boolean; error?: string }> {
  try {
    const { data: buckets, error } = await admin.storage.listBuckets();
    if (error) return { ok: false, error: error.message };
    if ((buckets ?? []).some((b: any) => b.name === ATTACHMENT_BUCKET)) return { ok: true };
    // PRIVATE. A public URL on a clinical image is a permanent, unauthenticated link to a patient's
    // body; every read goes through a short-lived signed URL issued server-side.
    const { error: mkErr } = await admin.storage.createBucket(ATTACHMENT_BUCKET, { public: false });
    if (mkErr && !/exist/i.test(mkErr.message)) return { ok: false, error: mkErr.message };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "storage unavailable" };
  }
}

export async function recordAttachment(admin: any, args: {
  workspaceId: string; encounterId: string; storagePath: string; fileName: string;
  mimeType: string; byteSize: number; kind?: string; caption?: string;
  actorId: string; correlationId: string;
}): Promise<EngineResult<{ id: string; patientId: string }>> {
  const guard = await editableEncounter(admin, args.workspaceId, args.encounterId);
  if (!guard.ok) return guard;

  const kind = ATTACHMENT_KINDS.some(([k]) => k === args.kind) ? args.kind! : "other";
  const { data, error } = await admin.from("practice_attachment").insert({
    workspace_id: args.workspaceId, patient_id: guard.encounter.patient_id, encounter_id: args.encounterId,
    storage_path: args.storagePath, file_name: args.fileName, mime_type: args.mimeType,
    byte_size: args.byteSize, kind, caption: args.caption?.trim() || null, created_by: args.actorId,
  }).select("id").single();
  if (error) return { ok: false, status: 400, code: "VALIDATION_ERROR", message: error.message };

  await audit(admin, {
    workspaceId: args.workspaceId, actorId: args.actorId, eventType: "practice.attachment_added",
    payload: { attachmentId: data.id, encounterId: args.encounterId, kind, bytes: args.byteSize },
    correlationId: args.correlationId,
  });
  return { ok: true, data: { id: data.id as string, patientId: guard.encounter.patient_id } };
}

export async function listAttachments(admin: any, workspaceId: string, filter: {
  encounterId?: string; patientId?: string; includeRemoved?: boolean;
}) {
  let q = admin.from("practice_attachment")
    .select("id, patient_id, encounter_id, procedure_id, storage_path, file_name, mime_type, byte_size, kind, caption, removed_at, removed_reason, created_at, created_by")
    .eq("workspace_id", workspaceId);
  if (filter.encounterId) q = q.eq("encounter_id", filter.encounterId);
  if (filter.patientId) q = q.eq("patient_id", filter.patientId);
  if (!filter.includeRemoved) q = q.is("removed_at", null);

  const { data } = await q.order("created_at", { ascending: false }).limit(100);
  return (data ?? []) as any[];
}

/**
 * A short-lived link to the bytes.
 *
 * SIXTY SECONDS. Long enough to open, short enough that a URL pasted into a chat window is useless by
 * the time anybody clicks it.
 */
export async function signedAttachmentUrl(admin: any, workspaceId: string, attachmentId: string): Promise<string | null> {
  const { data: a } = await admin.from("practice_attachment")
    .select("storage_path, removed_at").eq("id", attachmentId).eq("workspace_id", workspaceId).maybeSingle();
  if (!a || a.removed_at) return null;

  const { data } = await admin.storage.from(ATTACHMENT_BUCKET).createSignedUrl(a.storage_path, 60);
  return data?.signedUrl ?? null;
}

/**
 * Remove an attachment.
 *
 * THE BYTES GO; THE ROW STAYS, carrying who removed it and why. An attachment filed against the wrong
 * patient is exactly the case this exists for, and a record that simply forgot it had ever held a
 * photograph of somebody else could not answer the question afterwards.
 */
export async function removeAttachment(admin: any, args: {
  workspaceId: string; attachmentId: string; reason: string; actorId: string; correlationId: string;
}): Promise<EngineResult<{ removed: true }>> {
  const reason = args.reason.trim();
  if (!reason)
    return { ok: false, status: 400, code: "REASON_REQUIRED", message: "say why this is being removed" };

  const { data: a } = await admin.from("practice_attachment")
    .select("id, storage_path, removed_at").eq("id", args.attachmentId).eq("workspace_id", args.workspaceId).maybeSingle();
  if (!a) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };
  if (a.removed_at) return { ok: false, status: 422, code: "ALREADY_REMOVED", message: "that attachment is already removed" };

  await admin.from("practice_attachment").update({
    removed_at: nowIso(), removed_by: args.actorId, removed_reason: reason,
  }).eq("id", a.id);

  // The row is marked first and the bytes deleted second. The other order leaves a live row pointing at
  // nothing if the storage call fails, which reads as an attachment that will not open.
  await admin.storage.from(ATTACHMENT_BUCKET).remove([a.storage_path]).catch(() => {});

  await audit(admin, {
    workspaceId: args.workspaceId, actorId: args.actorId, eventType: "practice.attachment_removed",
    payload: { attachmentId: a.id, reason }, correlationId: args.correlationId,
  });
  return { ok: true, data: { removed: true } };
}
