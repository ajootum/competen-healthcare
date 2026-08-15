import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { requirePracticeContext, isDenied } from "@/lib/practice/api-context";
import {
  ATTACHMENT_BUCKET, ATTACHMENT_MIME, MAX_ATTACHMENT_BYTES,
  ensureAttachmentBucket, recordAttachment, listAttachments, removeAttachment, signedAttachmentUrl,
  setAttachmentVisibility,
} from "@/lib/practice/documentation-tools";
import { logAccess } from "@/lib/practice/privacy";

// GET    /api/v1/practice/attachments?encounterId=|patientId=  -- list
// GET    /api/v1/practice/attachments?id=                      -- a 60-second signed link to the bytes
// POST   /api/v1/practice/attachments                          -- multipart upload
// DELETE /api/v1/practice/attachments?id=                      -- remove, with a reason
// PATCH  /api/v1/practice/attachments                          -- show or hide in patient Documents
//
// UPLOADING TAKES encounter.edit, NOT A NEW CAPABILITY. Attaching a photograph to a consultation IS
// writing to the clinical record; minting attachment.upload would let a practice grant the ability to
// add clinical content to somebody it had not trusted with clinical content.
//
// ⚠ AND LISTING TAKES encounter.list, FOR THE SAME REASON AND A SHARPER ONE. This route shipped naming
// `encounter.view`, which is not a capability and never has been -- migration 194 seeds encounter.create,
// encounter.edit, encounter.list and encounter.sign, and nothing anywhere grants encounter.view. So
// hasCapability returned false for EVERY caller including the practice owner, and every GET here answered
// 403: no attachment could be listed and no signed link could be obtained, by anybody. The third time
// this codebase has invented a plausible capability code and silently disabled a feature with it
// (`practice.calendar.manage`, `appointment.view`), which is why the audit harness now checks every code
// this product names against practice_role_capabilities rather than against a list somebody re-typed.
//
// OPENING ONE IS A READ OF A PATIENT RECORD and is logged (CPR-370), like any other.

export async function GET(req: NextRequest) {
  const auth = await requirePracticeContext("encounter.list");
  if (isDenied(auth)) return auth;

  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (id) {
    const signed = await signedAttachmentUrl(auth.caller.admin, auth.ctx.workspaceId, id);
    if (!signed) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const rows = await listAttachments(auth.caller.admin, auth.ctx.workspaceId, {});
    const row = rows.find(r => r.id === id);
    await logAccess(auth.caller.admin, {
      workspaceId: auth.ctx.workspaceId, actorId: auth.caller.userId, subjectKind: "document",
      subjectId: id, patientId: row?.patient_id ?? null, action: "view",
      route: "/api/v1/practice/attachments", correlationId: auth.caller.traceId,
    });
    // The link, and how long it lasts, so a client cannot cache it as though it were permanent.
    return NextResponse.json({ url: signed, expiresInSeconds: 60, correlationId: auth.caller.traceId });
  }

  const attachments = await listAttachments(auth.caller.admin, auth.ctx.workspaceId, {
    encounterId: url.searchParams.get("encounterId") ?? undefined,
    patientId: url.searchParams.get("patientId") ?? undefined,
    includeRemoved: url.searchParams.get("includeRemoved") === "1",
  });
  // The storage path never leaves the server: it is an internal address, and a client that had it would
  // be one refactor away from constructing its own links. Listed explicitly rather than deleted from the
  // row, so a column added later is not published by accident.
  return NextResponse.json({
    attachments: attachments.map(a => ({
      id: a.id, patient_id: a.patient_id, encounter_id: a.encounter_id, procedure_id: a.procedure_id,
      file_name: a.file_name, mime_type: a.mime_type, byte_size: a.byte_size,
      kind: a.kind, caption: a.caption, removed_at: a.removed_at, removed_reason: a.removed_reason,
      title: a.title, tags: a.tags, patient_visible: a.patient_visible,
      created_at: a.created_at, created_by: a.created_by,
    })),
    correlationId: auth.caller.traceId,
  });
}

export async function POST(req: NextRequest) {
  const auth = await requirePracticeContext("encounter.edit");
  if (isDenied(auth)) return auth;

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  const encounterId = String(form?.get("encounterId") ?? "");
  if (!form || !(file instanceof File))
    return NextResponse.json({ error: "a file is required (form field 'file')" }, { status: 400 });
  if (!encounterId) return NextResponse.json({ error: "encounterId is required" }, { status: 400 });

  // CHECKED BEFORE ANY BYTES ARE STORED. A rejected file that had already been written would leave an
  // orphan in the bucket with a patient's photograph in it.
  if (!ATTACHMENT_MIME.has(file.type))
    return NextResponse.json({ error: `this record takes images and PDFs${file.type ? `, not ${file.type}` : ""}` }, { status: 400 });
  if (file.size === 0 || file.size > MAX_ATTACHMENT_BYTES)
    return NextResponse.json({ error: `a file must be between 1 byte and ${MAX_ATTACHMENT_BYTES / (1024 * 1024)} MB` }, { status: 400 });

  const bucket = await ensureAttachmentBucket(auth.caller.admin);
  if (!bucket.ok) return NextResponse.json({ error: `storage unavailable: ${bucket.error}` }, { status: 500 });

  const safeName = file.name.replace(/[^\w.\-()+ ]/g, "_").slice(0, 120) || "file";
  // Workspace-prefixed and randomised: the path is not guessable from a patient id, and one practice's
  // objects never share a prefix with another's.
  const path = `${auth.ctx.workspaceId}/${encounterId}/${crypto.randomUUID()}-${safeName}`;

  // ⚠ THE HASH IS COMPUTED HERE, FROM THE BYTES THE SERVER RECEIVED -- never accepted from the browser.
  // A client-supplied hash would let a caller attach one file while recording the fingerprint of
  // another, which turns the duplicate guard into a lie about what is in the bucket.
  const bytes = Buffer.from(await file.arrayBuffer());
  const contentHash = createHash("sha256").update(bytes).digest("hex");

  const { error: upErr } = await auth.caller.admin.storage.from(ATTACHMENT_BUCKET)
    .upload(path, bytes, { contentType: file.type });
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

  const result = await recordAttachment(auth.caller.admin, {
    workspaceId: auth.ctx.workspaceId, encounterId, storagePath: path, fileName: safeName,
    mimeType: file.type, byteSize: file.size,
    kind: form.get("kind") ? String(form.get("kind")) : undefined,
    caption: form.get("caption") ? String(form.get("caption")) : undefined,
    // CPR-ATT-HFE-009 s8/s10/s13 (migration 300).
    title: form.get("title") ? String(form.get("title")) : undefined,
    tags: form.get("tags") ? String(form.get("tags")).split(",").map(t => t.trim()).filter(Boolean) : undefined,
    patientVisible: String(form.get("patientVisible") ?? "true") !== "false",
    contentHash,
    allowDuplicate: String(form.get("allowDuplicate") ?? "") === "true",
    // ATT-009 s12: forwarded whole, checked by the ENGINE against workspace and patient. This line is
    // load-bearing -- the route silently dropping an engine's field is the middle-layer class the
    // follow-ups route fell to with all six of 299's fields.
    procedureId: form.get("procedureId") ? String(form.get("procedureId")) : null,
    actorId: auth.caller.userId, correlationId: auth.caller.traceId,
  });
  // ⚠ A DUPLICATE REFUSAL ALSO CLEANS UP ITS OBJECT, through the same branch a failed insert uses. The
  // bytes were uploaded before the engine could rule, so a refused duplicate would otherwise leave an
  // orphan copy in the bucket that no row points at.
  // The row is what makes the bytes findable. If it fails, the object is removed rather than left in the
  // bucket as something nobody can reach and nobody knows is there.
  if (!result.ok) {
    await auth.caller.admin.storage.from(ATTACHMENT_BUCKET).remove([path]).catch(() => {});
    return NextResponse.json({ error: { code: result.code, message: result.message } }, { status: result.status });
  }
  return NextResponse.json({ attachment: result.data, correlationId: auth.caller.traceId }, { status: 201 });
}

export async function DELETE(req: NextRequest) {
  const auth = await requirePracticeContext("encounter.edit");
  if (isDenied(auth)) return auth;

  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  const result = await removeAttachment(auth.caller.admin, {
    workspaceId: auth.ctx.workspaceId, attachmentId: id,
    reason: url.searchParams.get("reason") ?? "",
    actorId: auth.caller.userId, correlationId: auth.caller.traceId,
  });
  if (!result.ok) return NextResponse.json({ error: { code: result.code, message: result.message } }, { status: result.status });
  return NextResponse.json({ ...result.data, correlationId: auth.caller.traceId });
}

/**
 * CPR-ATT-HFE-009 s10/s15: show or hide one attachment in the patient's Documents.
 *
 * A PROJECTION change, not a removal -- see setAttachmentVisibility for why the two are separate
 * functions with separate audit events. Gated on encounter.edit exactly as attaching is: deciding what
 * an encounter's record projects is part of editing that encounter.
 */
export async function PATCH(req: NextRequest) {
  const auth = await requirePracticeContext("encounter.edit");
  if (isDenied(auth)) return auth;

  const body = await req.json().catch(() => null);
  const id = String(body?.id ?? "");
  if (!id || typeof body?.patientVisible !== "boolean")
    return NextResponse.json({ error: "id and patientVisible (boolean) are required" }, { status: 400 });

  const result = await setAttachmentVisibility(auth.caller.admin, {
    workspaceId: auth.ctx.workspaceId, attachmentId: id, patientVisible: body.patientVisible,
    actorId: auth.caller.userId, correlationId: auth.caller.traceId,
  });
  if (!result.ok) return NextResponse.json({ error: { code: result.code, message: result.message } }, { status: result.status });
  return NextResponse.json({ ...result.data, correlationId: auth.caller.traceId });
}
