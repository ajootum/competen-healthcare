// Extraction of a large PDF can take a while on a cold function.
export const maxDuration = 60;

import { NextResponse } from "next/server";
import { requireIndividualContext, isGuardRefusal } from "@/lib/individual/guard";
import { createMaterial, discardUpload, isUuid, readUpload, uploadPath } from "@/lib/individual/scholar/store";
import { ALLOWED_MIME, MAX_UPLOAD_BYTES, type MaterialMime, UPLOAD_ATTESTATION_REQUIRED } from "@/lib/individual/scholar/config";
import { EXTRACTION_MESSAGE, PII_LABEL, chunkPages, extractMaterial, findPatientIdentifiers, sniffMime, titleFromFileName } from "@/lib/individual/scholar/extract";
import { audit } from "@/lib/individual/scholar/http";

// Request-time only: it reads the release gate and the session, and must never be prerendered at build
// (a build-time render would fail without the service key, or freeze the gate into static HTML).
export const dynamic = "force-dynamic";

// POST /api/individual/scholar/materials -- COMPETEN-IND-004 s1, step two of an upload: process it.
//
// Body { uploadId, mime, fileName, piiAttested: true }. The object path is REBUILT here from the caller's
// own id and the upload id, never taken from the body, so nobody can point processing at another
// person's object. Then, in order: read the bytes, check what they really are (magic bytes, not the
// browser's label), extract page by page, run the patient-identifier check, chunk, store. Any refusal
// deletes the uploaded object, so a refused file does not linger in storage.
//
// Extraction runs on this server. Nothing is sent to an AI provider here.

export async function POST(req: Request) {
  const ctx = await requireIndividualContext("scholar");
  if (isGuardRefusal(ctx)) return ctx;
  const body = await req.json().catch(() => ({}));
  const uploadId = body?.uploadId;
  const declared = body?.mime as MaterialMime;
  const fileName = typeof body?.fileName === "string" && body.fileName.trim() ? body.fileName.trim() : "material";
  if (!isUuid(uploadId) || !(ALLOWED_MIME as readonly string[]).includes(declared))
    return NextResponse.json({ error: "That upload could not be found." }, { status: 400 });
  if (body?.piiAttested !== true)
    return NextResponse.json({ error: UPLOAD_ATTESTATION_REQUIRED }, { status: 400 });

  const path = uploadPath(ctx.userId, uploadId, declared);
  const bytes = await readUpload(ctx.admin, path);
  if (!bytes) return NextResponse.json({ error: "That upload could not be found. Try uploading the file again." }, { status: 404 });

  const refuse = async (status: number, error: string, reason: string) => {
    await discardUpload(ctx.admin, path);
    await audit(ctx, "individual_scholar_material_refused", "individual_scholar_material", null, { reason, mime: declared, bytes: bytes.byteLength });
    return NextResponse.json({ error }, { status });
  };

  if (bytes.byteLength === 0 || bytes.byteLength > MAX_UPLOAD_BYTES) return refuse(400, "That file is empty or too large.", "size");
  const mime = sniffMime(bytes);
  if (mime !== declared) return refuse(400, "That file is not a readable PDF or Word (.docx) document.", "type_mismatch");

  const extraction = await extractMaterial(mime, bytes);
  if (!extraction.ok) return refuse(422, EXTRACTION_MESSAGE[extraction.reason], extraction.reason);

  const allText = extraction.pages.map(p => p.text).join("\n");
  const pii = findPatientIdentifiers(allText);
  if (pii.length)
    return refuse(422, `This file appears to contain ${pii.map(k => PII_LABEL[k]).join(" and ")}, so it was not kept. Remove anything that identifies a patient and upload it again.`, `pii:${pii.join(",")}`);

  const chunks = chunkPages(extraction.pages);
  if (!chunks.length) return refuse(422, EXTRACTION_MESSAGE.no_text, "no_chunks");

  const created = await createMaterial(ctx.admin, ctx.userId, {
    id: uploadId, path, title: titleFromFileName(fileName), fileName, mime, bytes,
    pageCount: extraction.pageCount, extractor: extraction.extractor, chunks,
  });
  if (!created.ok) {
    // The database's reason goes to the server log and the audit row, never to the person.
    console.error(`[scholar] material ${uploadId} not saved: ${created.error} ${created.detail ?? ""}`);
    await audit(ctx, "individual_scholar_material_refused", "individual_scholar_material", null, { reason: `save:${created.error}`, mime, bytes: bytes.byteLength });
    return NextResponse.json({ error: "Your material could not be saved. Nothing was kept. Try again shortly." }, { status: 500 });
  }

  await audit(ctx, "individual_scholar_material_uploaded", "individual_scholar_material", created.id,
    { mime, bytes: bytes.byteLength, pages: extraction.pageCount, chunks: chunks.length, extractor: extraction.extractor });
  return NextResponse.json({ ok: true, id: created.id, chunks: chunks.length, pages: extraction.pageCount });
}
