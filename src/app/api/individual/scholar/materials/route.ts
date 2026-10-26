// Extraction of a large PDF can take a while on a cold function, and a scanned examination paper may be transcribed
// here (policy-gated, COMPETEN-SCHOLAR-EXAM-PAPERS-01): up to the revision ceiling.
export const maxDuration = 300;

import { NextResponse } from "next/server";
import { requireIndividualContext, isGuardRefusal } from "@/lib/individual/guard";
import { createMaterial, discardUpload, findDuplicate, isUuid, readUpload, recentUploads, sha256Hex, uploadPath } from "@/lib/individual/scholar/store";
import { type MaterialMime, PDF_MIME, UPLOAD_ATTESTATION_REQUIRED, UPLOAD_SESSION_MINUTES, sessionRefusal, uploadRules } from "@/lib/individual/scholar/config";
import { loadIndividualPolicy } from "@/lib/individual/policy";
import { EXTRACTION_MESSAGE, PII_LABEL, chunkPages, extractMaterial, extractionQuality, findPatientIdentifiers, qualitySummary, sniffUpload, titleFromFileName } from "@/lib/individual/scholar/extract";
import { audit } from "@/lib/individual/scholar/http";
import { transcribeScannedUpload } from "@/lib/individual/scholar/exam-service";

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
  // Stage 2: the policy is checked again here, so a format switched off between the two steps is refused.
  const policy = await loadIndividualPolicy(ctx.admin);
  const rules = uploadRules(policy);
  if (!isUuid(uploadId) || !(rules.mimes as readonly string[]).includes(declared))
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

  if (bytes.byteLength === 0 || bytes.byteLength > rules.maxBytes) return refuse(400, "That file is empty or too large.", "size");
  // Upload limits: the session is decided HERE, on the bytes actually uploaded -- slots requested together all pass
  // the early check before any of them is kept.
  const recent = await recentUploads(ctx.admin, ctx.userId, new Date(Date.now() - UPLOAD_SESSION_MINUTES * 60_000).toISOString());
  if (!recent) return refuse(503, "Your study space could not be read just now. Try again shortly.", "session_unreadable");
  const overSession = sessionRefusal(rules, recent, bytes.byteLength);
  if (overSession) return refuse(429, overSession, "session_limit");
  // UPLOAD-01 U1: a ZIP is opened (screened first) to tell a Word file from a PowerPoint.
  const sniffed = await sniffUpload(bytes);
  if (sniffed.unsafe) return refuse(422, EXTRACTION_MESSAGE.unsafe, `unsafe:${sniffed.unsafe}`);
  const mime = sniffed.mime;
  if (mime !== declared) return refuse(400, `That file is not a readable ${rules.describe} file.`, "type_mismatch");

  // UPLOAD-01 U1: the same bytes twice are one material. The person is sent to the one they already have.
  const duplicate = await findDuplicate(ctx.admin, ctx.userId, sha256Hex(bytes));
  if (duplicate) {
    await discardUpload(ctx.admin, path);
    await audit(ctx, "individual_scholar_material_refused", "individual_scholar_material", duplicate.id, { reason: "duplicate", mime: declared, bytes: bytes.byteLength });
    return NextResponse.json({ error: `This file is already in your library as "${duplicate.title}".`, duplicateOf: duplicate }, { status: 409 });
  }

  let extraction = await extractMaterial(mime, bytes, policy.scholarPdfMaxPages, policy.scholarPptxMaxSlides);
  // COMPETEN-SCHOLAR-EXAM-PAPERS-01: a fully scanned examination paper, transcribed by AI only where policy turns that
  // on and the student attested it is a practice paper (exam-service.ts). Otherwise refused exactly as before.
  const scanned = (!extraction.ok && extraction.reason === "no_text") || (extraction.ok && !chunkPages(extraction.pages).length);
  if (scanned && mime === PDF_MIME && body?.examPaper === true && body?.examAttested === true) {
    const t = await transcribeScannedUpload(ctx, req, bytes, policy);
    if (t && "status" in t) { await discardUpload(ctx.admin, path); return NextResponse.json(t.body, { status: t.status }); }
    if (t && t.pages.length) extraction = { ok: true, pages: t.pages.map(p => ({ page: p.page, text: p.text })), pageCount: Math.max(...t.pages.map(p => p.page)), extractor: `ai-transcription-v1:${t.model}`.slice(0, 80) };
  }
  if (!extraction.ok) return refuse(422, EXTRACTION_MESSAGE[extraction.reason], extraction.detail && extraction.reason === "unsafe" ? `unsafe:${extraction.detail}` : extraction.reason);

  const allText = extraction.pages.map(p => p.text).join("\n");
  const pii = findPatientIdentifiers(allText);
  if (pii.length)
    return refuse(422, `This file appears to contain ${pii.map(k => PII_LABEL[k]).join(" and ")}, so it was not kept. Remove anything that identifies a patient and upload it again.`, `pii:${pii.join(",")}`);

  const chunks = chunkPages(extraction.pages);
  if (!chunks.length) return refuse(422, EXTRACTION_MESSAGE.no_text, "no_chunks");

  // UPLOAD-01 U2: how completely it was read, stored with it and returned -- "partial" is never reported as clean.
  const quality = extractionQuality(mime, extraction.pages, chunks);
  const created = await createMaterial(ctx.admin, ctx.userId, {
    id: uploadId, path, title: titleFromFileName(fileName), fileName, mime, bytes,
    pageCount: extraction.pageCount, extractor: extraction.extractor, chunks, quality,
  });
  if (!created.ok) {
    // The database's reason goes to the server log and the audit row, never to the person.
    console.error(`[scholar] material ${uploadId} not saved: ${created.error} ${created.detail ?? ""}`);
    await audit(ctx, "individual_scholar_material_refused", "individual_scholar_material", null, { reason: `save:${created.error}`, mime, bytes: bytes.byteLength });
    return NextResponse.json({ error: "Your material could not be saved. Nothing was kept. Try again shortly." }, { status: 500 });
  }

  const summary = qualitySummary(quality);
  await audit(ctx, "individual_scholar_material_uploaded", "individual_scholar_material", created.id,
    { mime, bytes: bytes.byteLength, pages: extraction.pageCount, chunks: chunks.length, extractor: extraction.extractor, partial: summary.partial, empty_units: quality.emptyUnits.length });
  return NextResponse.json({ ok: true, id: created.id, chunks: chunks.length, pages: extraction.pageCount,
    status: summary.partial ? "partial" : "ready", quality: { ...quality, recorded: created.qualityStored, summary: summary.text } });
}
