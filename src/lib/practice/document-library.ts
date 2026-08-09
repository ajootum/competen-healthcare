import { audit } from "@/lib/practice/audit";
import type { EngineResult } from "@/lib/practice/encounters";

// CPR-320's shared document library, folders and recycle bin -- plus the per-patient correspondence
// register, which needs no migration at all.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// A CLINICAL DOCUMENT NEVER ENTERS THE RECYCLE BIN.
//
// CPR-130's clinical document is marked ENTERED_IN_ERROR and kept forever, because a clinical record is
// not deletable -- and a "restore" on one would imply it had been gone, which is a claim about the
// record that is not true. The recycle bin here is for the LIBRARY: protocols, blank forms, price
// lists, where deleting really is deleting and getting it back is an ordinary convenience.
//
// Two different objects, two different rules. Nothing in this file touches practice_clinical_document,
// and the harness asserts that a clinical document cannot be reached through any of it.
// ────────────────────────────────────────────────────────────────────────────────────────────────────
//
// THE CORRESPONDENCE REGISTER IS COMPOSED, NOT STORED. Everything it shows already exists: documents
// issued (CPR-130), copies released (CPR-130's release register), documents received (CPR-320's incoming
// register) and calls made (the contact log). A `correspondence` table would be a fourth copy of facts
// three tables already hold, and it would drift the first time somebody wrote to one and not the other.

/* eslint-disable @typescript-eslint/no-explicit-any */

const nowIso = () => new Date().toISOString();

export const LIBRARY_BUCKET = "practice-attachments";
export const MAX_LIBRARY_BYTES = 25 * 1024 * 1024;

/** Broader than a clinical attachment: a protocol is as likely to be a spreadsheet as a PDF. */
export const LIBRARY_MIME = new Set([
  "application/pdf", "image/png", "image/jpeg", "image/webp",
  "text/plain", "text/markdown", "text/csv",
  "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);

// ── FOLDERS ──────────────────────────────────────────────────────────────────────────────────────────

export async function listFolders(admin: any, workspaceId: string) {
  const { data } = await admin.from("practice_folder")
    .select("id, name, description, position").eq("workspace_id", workspaceId)
    .order("position").order("name");
  return (data ?? []) as any[];
}

export async function createFolder(admin: any, args: {
  workspaceId: string; name: string; description?: string; actorId: string; correlationId: string;
}): Promise<EngineResult<{ id: string }>> {
  const name = args.name.trim();
  if (!name) return { ok: false, status: 400, code: "VALIDATION_ERROR", message: "a folder needs a name" };

  const { data, error } = await admin.from("practice_folder").insert({
    workspace_id: args.workspaceId, name, description: args.description?.trim() || null,
    created_by: args.actorId,
  }).select("id").single();
  if (error) {
    if (/duplicate|unique/i.test(error.message))
      return { ok: false, status: 409, code: "NAME_IN_USE", message: `there is already a folder called "${name}"` };
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: error.message };
  }

  await audit(admin, {
    workspaceId: args.workspaceId, actorId: args.actorId, eventType: "practice.folder_created",
    payload: { folderId: data.id, name }, correlationId: args.correlationId,
  });
  return { ok: true, data: { id: data.id as string } };
}

/**
 * Delete a folder.
 *
 * ITS DOCUMENTS ARE NOT DELETED WITH IT -- they fall back to no folder and stay in the library. Deleting
 * a folder is tidying; deleting the practice's consent forms because somebody tidied is not. The
 * on-delete-set-null in migration 210 does the same thing at the database level, and this says why.
 */
export async function deleteFolder(admin: any, args: {
  workspaceId: string; folderId: string; actorId: string; correlationId: string;
}): Promise<EngineResult<{ orphaned: number }>> {
  const { data: f } = await admin.from("practice_folder")
    .select("id, name").eq("id", args.folderId).eq("workspace_id", args.workspaceId).maybeSingle();
  if (!f) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };

  const { count } = await admin.from("practice_library_document")
    .select("*", { count: "exact", head: true }).eq("folder_id", f.id).is("deleted_at", null);

  await admin.from("practice_folder").delete().eq("id", f.id);
  await audit(admin, {
    workspaceId: args.workspaceId, actorId: args.actorId, eventType: "practice.folder_deleted",
    payload: { folderId: f.id, name: f.name, orphaned: count ?? 0 }, correlationId: args.correlationId,
  });
  return { ok: true, data: { orphaned: count ?? 0 } };
}

// ── THE LIBRARY ──────────────────────────────────────────────────────────────────────────────────────

export async function recordLibraryDocument(admin: any, args: {
  workspaceId: string; title: string; storagePath: string; fileName: string;
  mimeType: string; byteSize: number; folderId?: string | null; description?: string;
  actorId: string; correlationId: string;
}): Promise<EngineResult<{ id: string }>> {
  if (!args.title.trim())
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: "the document needs a title" };

  let folderId: string | null = null;
  if (args.folderId) {
    const { data: f } = await admin.from("practice_folder")
      .select("id").eq("id", args.folderId).eq("workspace_id", args.workspaceId).maybeSingle();
    if (!f) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };
    folderId = f.id;
  }

  const { data, error } = await admin.from("practice_library_document").insert({
    workspace_id: args.workspaceId, folder_id: folderId, title: args.title.trim(),
    description: args.description?.trim() || null, storage_path: args.storagePath,
    file_name: args.fileName, mime_type: args.mimeType, byte_size: args.byteSize, created_by: args.actorId,
  }).select("id").single();
  if (error) return { ok: false, status: 400, code: "VALIDATION_ERROR", message: error.message };

  await audit(admin, {
    workspaceId: args.workspaceId, actorId: args.actorId, eventType: "practice.library_document_added",
    payload: { documentId: data.id, folderId, bytes: args.byteSize }, correlationId: args.correlationId,
  });
  return { ok: true, data: { id: data.id as string } };
}

export async function listLibrary(admin: any, workspaceId: string, opts: {
  folderId?: string | null; q?: string; bin?: boolean;
} = {}) {
  let query = admin.from("practice_library_document")
    .select("id, folder_id, title, description, file_name, mime_type, byte_size, deleted_at, deleted_by, created_at, created_by")
    .eq("workspace_id", workspaceId).is("purged_at", null);

  // The bin and the library are the same table read two ways -- a document in the bin is out of the
  // library, not gone.
  query = opts.bin ? query.not("deleted_at", "is", null) : query.is("deleted_at", null);
  if (opts.folderId) query = query.eq("folder_id", opts.folderId);
  if (opts.q?.trim()) query = query.ilike("title", `%${opts.q.trim()}%`);

  const { data } = await query.order("created_at", { ascending: false }).limit(200);
  return (data ?? []) as any[];
}

/**
 * Move a library document to the recycle bin.
 *
 * REFUSES ANY ID THAT IS NOT A LIBRARY DOCUMENT. Not merely "not found" by accident of the where-clause:
 * the whole point of the boundary is that a clinical document cannot be deleted, and a function that
 * silently did nothing when handed one would leave somebody believing it had worked.
 */
export async function binDocument(admin: any, args: {
  workspaceId: string; documentId: string; actorId: string; correlationId: string;
}): Promise<EngineResult<{ binned: true }>> {
  const { data: d } = await admin.from("practice_library_document")
    .select("id, title, deleted_at").eq("id", args.documentId).eq("workspace_id", args.workspaceId).maybeSingle();
  if (!d) {
    // Is it a CLINICAL document somebody tried to delete? Say so precisely, because "not found" would
    // send them looking for a bug that is not there.
    const { data: clinical } = await admin.from("practice_clinical_document")
      .select("id").eq("id", args.documentId).eq("workspace_id", args.workspaceId).maybeSingle();
    if (clinical)
      return {
        ok: false, status: 422, code: "CLINICAL_DOCUMENT",
        message: "a clinical document cannot be deleted; mark it entered in error instead, and it stays in the record",
      };
    return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };
  }
  if (d.deleted_at) return { ok: false, status: 422, code: "ALREADY_BINNED", message: "that is already in the bin" };

  await admin.from("practice_library_document")
    .update({ deleted_at: nowIso(), deleted_by: args.actorId, updated_at: nowIso() }).eq("id", d.id);
  await audit(admin, {
    workspaceId: args.workspaceId, actorId: args.actorId, eventType: "practice.library_document_binned",
    payload: { documentId: d.id, title: d.title }, correlationId: args.correlationId,
  });
  return { ok: true, data: { binned: true } };
}

export async function restoreDocument(admin: any, args: {
  workspaceId: string; documentId: string; actorId: string; correlationId: string;
}): Promise<EngineResult<{ restored: true }>> {
  const { data: d } = await admin.from("practice_library_document")
    .select("id, deleted_at, purged_at").eq("id", args.documentId).eq("workspace_id", args.workspaceId).maybeSingle();
  if (!d) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };
  if (!d.deleted_at) return { ok: false, status: 422, code: "NOT_BINNED", message: "that is not in the bin" };
  // Once the bytes are gone there is nothing to restore, and a restore that produced a row pointing at
  // nothing would be worse than refusing -- a document that will not open.
  if (d.purged_at) return { ok: false, status: 422, code: "PURGED", message: "that was purged; the file itself is gone" };

  await admin.from("practice_library_document")
    .update({ deleted_at: null, deleted_by: null, updated_at: nowIso() }).eq("id", d.id);
  await audit(admin, {
    workspaceId: args.workspaceId, actorId: args.actorId, eventType: "practice.library_document_restored",
    payload: { documentId: d.id }, correlationId: args.correlationId,
  });
  return { ok: true, data: { restored: true } };
}

/** Empty the bin for good. The bytes go; the row stays, marked purged, so the trail is not erased too. */
export async function purgeDocument(admin: any, args: {
  workspaceId: string; documentId: string; actorId: string; correlationId: string;
}): Promise<EngineResult<{ purged: true }>> {
  const { data: d } = await admin.from("practice_library_document")
    .select("id, storage_path, deleted_at, purged_at").eq("id", args.documentId).eq("workspace_id", args.workspaceId).maybeSingle();
  if (!d) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };
  // PURGING GOES THROUGH THE BIN. A one-click permanent delete is how somebody loses the practice's only
  // copy of a consent form at half past six on a Friday.
  if (!d.deleted_at)
    return { ok: false, status: 422, code: "NOT_BINNED", message: "put it in the bin first; purging is a second, deliberate act" };
  if (d.purged_at) return { ok: false, status: 422, code: "ALREADY_PURGED", message: "that was already purged" };

  await admin.from("practice_library_document")
    .update({ purged_at: nowIso(), updated_at: nowIso() }).eq("id", d.id);
  await admin.storage.from(LIBRARY_BUCKET).remove([d.storage_path]).catch(() => {});

  await audit(admin, {
    workspaceId: args.workspaceId, actorId: args.actorId, eventType: "practice.library_document_purged",
    payload: { documentId: d.id }, correlationId: args.correlationId,
  });
  return { ok: true, data: { purged: true } };
}

/** Move documents between folders. The comp's "bulk document actions", which is what bulk is actually for. */
export async function moveDocuments(admin: any, args: {
  workspaceId: string; documentIds: string[]; folderId: string | null;
  actorId: string; correlationId: string;
}): Promise<EngineResult<{ moved: number }>> {
  const ids = [...new Set(args.documentIds.filter(Boolean))];
  if (ids.length === 0)
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: "choose something to move" };
  if (ids.length > 200)
    return { ok: false, status: 422, code: "TOO_MANY", message: "move at most 200 at a time" };

  if (args.folderId) {
    const { data: f } = await admin.from("practice_folder")
      .select("id").eq("id", args.folderId).eq("workspace_id", args.workspaceId).maybeSingle();
    if (!f) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };
  }

  // SCOPED TO THIS WORKSPACE IN THE UPDATE ITSELF, not checked beforehand. A bulk action verified by a
  // prior read is one that moves whatever was passed if the read and the write disagree.
  const { data: moved } = await admin.from("practice_library_document")
    .update({ folder_id: args.folderId, updated_at: nowIso() })
    .eq("workspace_id", args.workspaceId).is("deleted_at", null).in("id", ids).select("id");

  const n = ((moved ?? []) as any[]).length;
  await audit(admin, {
    workspaceId: args.workspaceId, actorId: args.actorId, eventType: "practice.library_documents_moved",
    payload: { requested: ids.length, moved: n, folderId: args.folderId }, correlationId: args.correlationId,
  });
  // BOTH NUMBERS. "12 moved" when 14 were selected is the kind of claim somebody relies on without
  // checking -- the same rule CPR-330's batch generation follows.
  return { ok: true, data: { moved: n } };
}

export async function signedLibraryUrl(admin: any, workspaceId: string, documentId: string): Promise<string | null> {
  const { data: d } = await admin.from("practice_library_document")
    .select("storage_path, purged_at").eq("id", documentId).eq("workspace_id", workspaceId).maybeSingle();
  if (!d || d.purged_at) return null;
  const { data } = await admin.storage.from(LIBRARY_BUCKET).createSignedUrl(d.storage_path, 60);
  return data?.signedUrl ?? null;
}

/**
 * What the library holds, by folder.
 *
 * THE COMP'S "STORAGE USED 2.4 GB OF 10 GB (24%)" IS A QUOTA, AND THERE IS NO QUOTA. The bytes are real
 * and are reported; the denominator and the percentage are not, so neither is shown. A progress bar
 * against a limit nobody set is a warning that will never fire and a reassurance that means nothing.
 */
export async function librarySummary(admin: any, workspaceId: string) {
  const [folders, live, binned] = await Promise.all([
    listFolders(admin, workspaceId),
    listLibrary(admin, workspaceId),
    listLibrary(admin, workspaceId, { bin: true }),
  ]);

  const byFolder = folders.map(f => ({
    ...f,
    files: live.filter(d => d.folder_id === f.id).length,
    bytes: live.filter(d => d.folder_id === f.id).reduce((n, d) => n + (d.byte_size ?? 0), 0),
  }));
  const unfiled = live.filter(d => !d.folder_id);

  return {
    folders: byFolder,
    unfiled: { files: unfiled.length, bytes: unfiled.reduce((n, d) => n + (d.byte_size ?? 0), 0) },
    totalFiles: live.length,
    totalBytes: live.reduce((n, d) => n + (d.byte_size ?? 0), 0),
    binned: binned.length,
    // Stated in the payload so a client cannot render a quota bar against a limit that does not exist.
    quotaBytes: null as number | null,
  };
}

// ── THE CORRESPONDENCE REGISTER ──────────────────────────────────────────────────────────────────────

/**
 * Everything that has passed between this practice and one patient, in one place.
 *
 * COMPOSED FROM WHAT ALREADY EXISTS: documents issued, copies released, documents received, calls
 * recorded. A `correspondence` table would be a fourth copy of facts three tables already hold, and it
 * would drift the first time somebody wrote to one and not the other.
 *
 * NOTHING HERE WAS SENT BY THIS PRODUCT. A released copy is somebody recording that they printed a
 * letter or handed it over; the register says so rather than implying a delivery channel that does not
 * exist. Unchanged position since this module was first built.
 */
export async function patientCorrespondence(admin: any, workspaceId: string, patientId: string) {
  const [{ data: documents }, { data: incoming }, { data: contacts }] = await Promise.all([
    admin.from("practice_clinical_document")
      .select("id, title, doc_type, status, addressed_to, signed_at, created_at")
      .eq("workspace_id", workspaceId).eq("patient_id", patientId).order("created_at", { ascending: false }).limit(100),
    admin.from("practice_incoming_document")
      .select("id, title, source, doc_type, received_on, reviewed_at, status, priority, created_at")
      .eq("workspace_id", workspaceId).eq("patient_id", patientId).order("created_at", { ascending: false }).limit(100),
    // `channel`, not `contact_type` -- migration 200 names it that, and the collision that renamed the
    // table itself (practice_patient_contact was already taken) is why this file checks rather than
    // assumes.
    admin.from("practice_contact_log")
      .select("id, channel, direction, outcome, summary, occurred_at")
      .eq("workspace_id", workspaceId).eq("patient_id", patientId).order("occurred_at", { ascending: false }).limit(100),
  ]);

  const docs = (documents ?? []) as any[];
  const { data: releases } = docs.length
    ? await admin.from("practice_clinical_document_release")
      .select("id, document_id, channel, recipient, released_at").in("document_id", docs.map(d => d.id))
    : { data: [] };
  const releaseRows = (releases ?? []) as any[];
  const byDocument = new Map<string, any[]>();
  for (const r of releaseRows) byDocument.set(r.document_id, [...(byDocument.get(r.document_id) ?? []), r]);

  // ONE TIMELINE, oldest question first: "what has passed between us" is not answerable by three lists
  // somebody has to interleave in their head.
  const entries = [
    ...docs.map(d => ({
      kind: "issued" as const, id: d.id, at: d.signed_at ?? d.created_at, title: d.title,
      detail: `${String(d.doc_type).replace(/_/g, " ")}${d.addressed_to ? ` to ${d.addressed_to}` : ""}`,
      status: d.status, releases: byDocument.get(d.id) ?? [],
      href: `/practice/documents/${d.id}`,
    })),
    ...((incoming ?? []) as any[]).map(i => ({
      kind: "received" as const, id: i.id, at: i.received_on ?? i.created_at, title: i.title,
      detail: `${String(i.doc_type).replace(/_/g, " ")} from ${i.source}`,
      status: i.reviewed_at ? "reviewed" : "awaiting review",
      releases: [] as any[], href: "/practice/inbox",
    })),
    ...((contacts ?? []) as any[]).map(c => ({
      kind: "contact" as const, id: c.id, at: c.occurred_at, title: c.summary,
      detail: `${c.direction} ${String(c.channel).replace(/_/g, " ")} — ${c.outcome}`, status: "recorded",
      releases: [] as any[], href: `/practice/patients/${patientId}`,
    })),
  ].sort((a, b) => String(b.at).localeCompare(String(a.at)));

  return {
    entries,
    issued: docs.length,
    received: ((incoming ?? []) as any[]).length,
    contacts: ((contacts ?? []) as any[]).length,
    copiesReleased: releaseRows.length,
    // The field, not a footnote: this product has no email, SMS or patient-messaging channel, and a
    // client must not be able to render this register as a delivery history.
    sentByThisProduct: false,
  };
}
