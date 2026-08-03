import { NextRequest, NextResponse } from "next/server";
import { requirePracticeContext, isDenied } from "@/lib/practice/api-context";
import { ensureAttachmentBucket } from "@/lib/practice/documentation-tools";
import {
  LIBRARY_BUCKET, LIBRARY_MIME, MAX_LIBRARY_BYTES,
  listFolders, createFolder, deleteFolder,
  recordLibraryDocument, listLibrary, librarySummary, signedLibraryUrl,
  binDocument, restoreDocument, purgeDocument, moveDocuments, patientCorrespondence,
} from "@/lib/practice/document-library";

// GET    /api/v1/practice/library                    -- the library and its folders
// GET    /api/v1/practice/library?bin=1              -- the recycle bin
// GET    /api/v1/practice/library?id=                -- a 60-second signed link
// GET    /api/v1/practice/library?patientId=         -- one patient's correspondence register
// POST   /api/v1/practice/library                    -- upload a document, or create a folder
// PATCH  /api/v1/practice/library                    -- bin, restore, purge, or move in bulk
// DELETE /api/v1/practice/library?folderId=          -- remove a folder (its documents survive)
//
// READING takes document.view -- a protocol is something everybody who reads documents should be able to
// find. MANAGING takes template.manage, already the "this is how this practice does things" permission.

export async function GET(req: NextRequest) {
  const auth = await requirePracticeContext("document.view");
  if (isDenied(auth)) return auth;

  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (id) {
    const signed = await signedLibraryUrl(auth.caller.admin, auth.ctx.workspaceId, id);
    if (!signed) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ url: signed, expiresInSeconds: 60, correlationId: auth.caller.traceId });
  }

  const patientId = url.searchParams.get("patientId");
  if (patientId) {
    const register = await patientCorrespondence(auth.caller.admin, auth.ctx.workspaceId, patientId);
    return NextResponse.json({ ...register, correlationId: auth.caller.traceId });
  }

  const bin = url.searchParams.get("bin") === "1";
  const [documents, folders, summary] = await Promise.all([
    listLibrary(auth.caller.admin, auth.ctx.workspaceId, {
      bin, folderId: url.searchParams.get("folderId") ?? undefined, q: url.searchParams.get("q") ?? undefined,
    }),
    listFolders(auth.caller.admin, auth.ctx.workspaceId),
    librarySummary(auth.caller.admin, auth.ctx.workspaceId),
  ]);
  // The storage path never leaves the server -- an internal address a client would be one refactor away
  // from constructing its own links against.
  return NextResponse.json({
    documents: documents.map(d => ({
      id: d.id, folder_id: d.folder_id, title: d.title, description: d.description,
      file_name: d.file_name, mime_type: d.mime_type, byte_size: d.byte_size,
      deleted_at: d.deleted_at, created_at: d.created_at, created_by: d.created_by,
    })),
    folders, summary, correlationId: auth.caller.traceId,
  });
}

export async function POST(req: NextRequest) {
  const auth = await requirePracticeContext("template.manage");
  if (isDenied(auth)) return auth;

  const contentType = req.headers.get("content-type") ?? "";
  const ctx = { workspaceId: auth.ctx.workspaceId, actorId: auth.caller.userId, correlationId: auth.caller.traceId };

  if (contentType.includes("application/json")) {
    let body: Record<string, unknown>;
    try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }
    const result = await createFolder(auth.caller.admin, {
      ...ctx, name: String(body.name ?? ""), description: body.description ? String(body.description) : undefined,
    });
    if (!result.ok) return NextResponse.json({ error: { code: result.code, message: result.message } }, { status: result.status });
    return NextResponse.json({ folder: result.data, correlationId: auth.caller.traceId }, { status: 201 });
  }

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!form || !(file instanceof File))
    return NextResponse.json({ error: "a file is required (form field 'file')" }, { status: 400 });

  // Checked before any bytes are stored, so a rejected file leaves no orphan in the bucket.
  if (!LIBRARY_MIME.has(file.type))
    return NextResponse.json({ error: `the library does not take ${file.type || "that file type"}` }, { status: 400 });
  if (file.size === 0 || file.size > MAX_LIBRARY_BYTES)
    return NextResponse.json({ error: `a file must be between 1 byte and ${MAX_LIBRARY_BYTES / (1024 * 1024)} MB` }, { status: 400 });

  const bucket = await ensureAttachmentBucket(auth.caller.admin);
  if (!bucket.ok) return NextResponse.json({ error: `storage unavailable: ${bucket.error}` }, { status: 500 });

  const safeName = file.name.replace(/[^\w.\-()+ ]/g, "_").slice(0, 120) || "file";
  const path = `${auth.ctx.workspaceId}/library/${crypto.randomUUID()}-${safeName}`;
  const { error: upErr } = await auth.caller.admin.storage.from(LIBRARY_BUCKET)
    .upload(path, Buffer.from(await file.arrayBuffer()), { contentType: file.type });
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

  const result = await recordLibraryDocument(auth.caller.admin, {
    ...ctx, title: String(form.get("title") ?? safeName), storagePath: path, fileName: safeName,
    mimeType: file.type, byteSize: file.size,
    folderId: form.get("folderId") ? String(form.get("folderId")) : null,
    description: form.get("description") ? String(form.get("description")) : undefined,
  });
  if (!result.ok) {
    // The row is what makes the bytes findable; without it the object is unreachable and unknown.
    await auth.caller.admin.storage.from(LIBRARY_BUCKET).remove([path]).catch(() => {});
    return NextResponse.json({ error: { code: result.code, message: result.message } }, { status: result.status });
  }
  return NextResponse.json({ document: result.data, correlationId: auth.caller.traceId }, { status: 201 });
}

export async function PATCH(req: NextRequest) {
  const auth = await requirePracticeContext("template.manage");
  if (isDenied(auth)) return auth;

  let body: Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }

  const ctx = { workspaceId: auth.ctx.workspaceId, actorId: auth.caller.userId, correlationId: auth.caller.traceId };
  const fail = (r: { code: string; message: string; status: number }) =>
    NextResponse.json({ error: { code: r.code, message: r.message } }, { status: r.status });

  if (Array.isArray(body.documentIds)) {
    const result = await moveDocuments(auth.caller.admin, {
      ...ctx, documentIds: body.documentIds.map(String), folderId: body.folderId ?? null,
    });
    if (!result.ok) return fail(result);
    // Both numbers travel: "12 moved" when 14 were selected is a claim somebody relies on unchecked.
    return NextResponse.json({ ...result.data, requested: body.documentIds.length, correlationId: auth.caller.traceId });
  }

  if (!body.documentId) return NextResponse.json({ error: "documentId or documentIds is required" }, { status: 400 });
  const id = String(body.documentId);

  const result = body.action === "restore" ? await restoreDocument(auth.caller.admin, { ...ctx, documentId: id })
    : body.action === "purge" ? await purgeDocument(auth.caller.admin, { ...ctx, documentId: id })
      : await binDocument(auth.caller.admin, { ...ctx, documentId: id });
  if (!result.ok) return fail(result);
  return NextResponse.json({ ...result.data, correlationId: auth.caller.traceId });
}

export async function DELETE(req: NextRequest) {
  const auth = await requirePracticeContext("template.manage");
  if (isDenied(auth)) return auth;

  const folderId = new URL(req.url).searchParams.get("folderId");
  if (!folderId) return NextResponse.json({ error: "folderId is required" }, { status: 400 });

  const result = await deleteFolder(auth.caller.admin, {
    workspaceId: auth.ctx.workspaceId, folderId,
    actorId: auth.caller.userId, correlationId: auth.caller.traceId,
  });
  if (!result.ok) return NextResponse.json({ error: { code: result.code, message: result.message } }, { status: result.status });
  // How many documents fell out of the folder and stayed in the library -- deleting a folder is tidying,
  // not deleting the practice's consent forms.
  return NextResponse.json({ ...result.data, correlationId: auth.caller.traceId });
}
