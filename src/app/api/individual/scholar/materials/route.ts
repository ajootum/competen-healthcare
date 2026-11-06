// Extraction of a large PDF can take a while on a cold function, and a scanned examination paper may be transcribed
// here (policy-gated, COMPETEN-SCHOLAR-EXAM-PAPERS-01): up to the revision ceiling.
export const maxDuration = 300;

import { NextResponse } from "next/server";
import { requireIndividualContext, isGuardRefusal } from "@/lib/individual/guard";
import { claimUpload, createMaterial, discardUpload, findDuplicate, isUuid, keptMaterial, readUpload, recentUploads, releaseUpload, settleUpload, sha256Hex, uploadPath } from "@/lib/individual/scholar/store";
import { finishDecision, isSha256 } from "@/lib/individual/scholar/upload-record";
import { type MaterialMime, PDF_MIME, PPTX_MIME, UPLOAD_INTEGRITY_MESSAGE, UPLOAD_ATTESTATION_REQUIRED, UPLOAD_SESSION_MINUTES, sessionRefusal, uploadRules } from "@/lib/individual/scholar/config";
import { loadIndividualPolicy } from "@/lib/individual/policy";
import { applySlideFacts, picturesCanBeRead } from "@/lib/individual/scholar/slide-classify";
import { readSlideFacts } from "@/lib/individual/scholar/slide-structure";
import { EXTRACTION_MESSAGE, PII_LABEL, chunkPages, extractMaterial, extractionQuality, findPatientIdentifiers, qualitySummary, sniffUpload, titleFromFileName } from "@/lib/individual/scholar/extract";
import { audit } from "@/lib/individual/scholar/http";
import type { ExtractionQuality } from "@/lib/individual/scholar/extract";
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

  // SCHOLAR-CE07C: the finish is idempotent. A retry after a lost answer (slow network, closed tab) gets the answer
  // the first finish gave, and nothing is read, extracted or removed again. The material id IS the upload id.
  const already = await keptMaterial(ctx.admin, ctx.userId, uploadId);
  if (already === "unreadable") return NextResponse.json({ error: "Your study space could not be read just now. Try again shortly.", retryable: true }, { status: 503 });
  if (already) return keptAnswer(already, policy.scholarMaterialImageSlides === "ai_transcription", policy.scholarLessonVisuals === "on");

  // The single finish claim (migration 960): one finish reads and extracts an upload, any other waits for its answer.
  const now = Date.now();
  const claim = await claimUpload(ctx.admin, ctx.userId, uploadId, now);
  const record = claim && claim !== "absent" ? claim.row : null;
  if (claim && claim !== "absent" && !claim.claimed) {
    const d = finishDecision(claim.row, now);
    if (d.kind === "busy") return NextResponse.json({ processing: true, retryAfterMs: 5000 }, { status: 202 });
    if (d.kind === "refused") return NextResponse.json({ error: d.message }, { status: d.status });
    if (d.kind === "cancelled") return NextResponse.json({ error: "This upload was cancelled. Nothing was kept." }, { status: 410 });
    return NextResponse.json({ error: "That upload could not be found. Try uploading the file again." }, { status: 404 });
  }
  const claimed = !!(claim && claim !== "absent" && claim.claimed);
  const settle = async (status: number, error: string) => { if (claimed) await settleUpload(ctx.admin, ctx.userId, uploadId, { state: "refused", status, message: error }, Date.now()); };
  // A transient failure gives the claim back and KEEPS the object, so the learner retries without sending the file again.
  const later = async (status: number, error: string) => {
    if (claimed) await releaseUpload(ctx.admin, ctx.userId, uploadId, Date.now());
    return NextResponse.json({ error, retryable: status >= 500 }, { status });
  };

  const path = uploadPath(ctx.userId, uploadId, declared);
  const bytes = await readUpload(ctx.admin, path);
  if (!bytes) return later(404, "That upload could not be found. Try uploading the file again.");

  const refuse = async (status: number, error: string, reason: string) => {
    await discardUpload(ctx.admin, path);
    await settle(status, error);
    await audit(ctx, "individual_scholar_material_refused", "individual_scholar_material", null, { reason, mime: declared, bytes: bytes.byteLength });
    return NextResponse.json({ error }, { status });
  };

  if (bytes.byteLength === 0 || bytes.byteLength > rules.maxBytes) return refuse(400, "That file is empty or too large.", "size");
  // SCHOLAR-CE07C integrity: the bytes in storage are exactly the bytes the browser had (size and sha256 recorded at the
  // slot, or sent with the finish by a client without 960), checked BEFORE any extraction. A torn or mixed-up upload is
  // removed and never read.
  const expectSize = record ? Number(record.byte_size) : Number.isFinite(Number(body?.size)) && Number(body?.size) > 0 ? Number(body.size) : null;
  const expectSha = record ? record.sha256 : isSha256(body?.sha256) ? (body.sha256 as string) : null;
  if ((expectSize !== null && bytes.byteLength !== expectSize) || (expectSha && sha256Hex(bytes) !== expectSha))
    return refuse(422, UPLOAD_INTEGRITY_MESSAGE, "integrity");
  // Upload limits: the session is decided HERE, on the bytes actually uploaded -- slots requested together all pass
  // the early check before any of them is kept.
  const recent = await recentUploads(ctx.admin, ctx.userId, new Date(Date.now() - UPLOAD_SESSION_MINUTES * 60_000).toISOString());
  if (!recent) return later(503, "Your study space could not be read just now. Try again shortly.");
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
    await settle(409, `This file is already in your library as "${duplicate.title}".`);
    await audit(ctx, "individual_scholar_material_refused", "individual_scholar_material", duplicate.id, { reason: "duplicate", mime: declared, bytes: bytes.byteLength });
    return NextResponse.json({ error: `This file is already in your library as "${duplicate.title}".`, duplicateOf: duplicate }, { status: 409 });
  }

  let extraction = await extractMaterial(mime, bytes, policy.scholarPdfMaxPages, policy.scholarPptxMaxSlides);
  // COMPETEN-SCHOLAR-EXAM-PAPERS-01: a fully scanned examination paper, transcribed by AI only where policy turns that
  // on and the student attested it is a practice paper (exam-service.ts). Otherwise refused exactly as before.
  const scanned = (!extraction.ok && extraction.reason === "no_text") || (extraction.ok && !chunkPages(extraction.pages).length);
  if (scanned && mime === PDF_MIME && body?.examPaper === true && body?.examAttested === true) {
    const t = await transcribeScannedUpload(ctx, req, bytes, policy);
    if (t && "status" in t) {
      await discardUpload(ctx.admin, path);
      await settle(t.status, String((t.body as { error?: unknown } | null)?.error ?? "That file was not kept."));
      return NextResponse.json(t.body, { status: t.status });
    }
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
  // SCHOLAR-PPTX-READING-01: and what each slide holds, so a blank slide is not reported as unread. A file it cannot open keeps the plain record.
  const facts = mime === PPTX_MIME ? await readSlideFacts(bytes, extraction.pages, new Date().toISOString()) : null;
  if (facts) Object.assign(quality, applySlideFacts(quality, facts));
  const created = await createMaterial(ctx.admin, ctx.userId, {
    id: uploadId, path, title: titleFromFileName(fileName), fileName, mime, bytes,
    pageCount: extraction.pageCount, extractor: extraction.extractor, chunks, quality,
  });
  if (!created.ok) {
    // The database's reason goes to the server log and the audit row, never to the person.
    console.error(`[scholar] material ${uploadId} not saved: ${created.error} ${created.detail ?? ""}`);
    await audit(ctx, "individual_scholar_material_refused", "individual_scholar_material", null, { reason: `save:${created.error}`, mime, bytes: bytes.byteLength });
    await settle(500, "Your material could not be saved. Nothing was kept. Try again shortly.");
    return NextResponse.json({ error: "Your material could not be saved. Nothing was kept. Try again shortly." }, { status: 500 });
  }
  if (claimed) await settleUpload(ctx.admin, ctx.userId, uploadId, { state: "kept" }, Date.now());
  // SCHOLAR-CE07C: another finish of this upload kept it first (possible only without 960's claim). Its answer, its audit.
  if (created.existing) {
    const kept = await keptMaterial(ctx.admin, ctx.userId, uploadId);
    if (kept && kept !== "unreadable") return keptAnswer(kept, policy.scholarMaterialImageSlides === "ai_transcription", policy.scholarLessonVisuals === "on");
  }

  // SCHOLAR-IMAGE-RECOVERY: where the image-only pages (or picture-only slides) can be read on request, the summary says so.
  const recoverable = policy.scholarMaterialImageSlides === "ai_transcription" && picturesCanBeRead(quality)
    && ((mime === PDF_MIME && quality.unit === "page") || (mime === PPTX_MIME && quality.unit === "slide"));
  const summary = qualitySummary(quality, { recoverable, picturesShown: policy.scholarLessonVisuals === "on" });
  await audit(ctx, "individual_scholar_material_uploaded", "individual_scholar_material", created.id,
    { mime, bytes: bytes.byteLength, pages: extraction.pageCount, chunks: chunks.length, extractor: extraction.extractor, partial: summary.partial, empty_units: quality.emptyUnits.length });
  return NextResponse.json({ ok: true, id: created.id, chunks: chunks.length, pages: extraction.pageCount,
    status: summary.partial ? "partial" : "ready", quality: { ...quality, recorded: created.qualityStored, summary: summary.text } });
}

/** SCHOLAR-CE07C: the answer a kept upload's finish gives, rebuilt from the stored material for a retried finish. */
function keptAnswer(m: { id: string; mime: MaterialMime; chunks: number; pages: number | null; quality: ExtractionQuality | null }, imageSlidesAi: boolean, picturesShown: boolean) {
  if (!m.quality) return NextResponse.json({ ok: true, id: m.id, chunks: m.chunks, pages: m.pages, status: "ready", already: true });
  const recoverable = imageSlidesAi && picturesCanBeRead(m.quality)
    && ((m.mime === PDF_MIME && m.quality.unit === "page") || (m.mime === PPTX_MIME && m.quality.unit === "slide"));
  const summary = qualitySummary(m.quality, { recoverable, picturesShown });
  // The same partial/ready rule as a first finish (U2: partial is never a bare success).
  const state = summary.partial ? "partial" : "ready";
  return NextResponse.json({ ok: true, id: m.id, chunks: m.chunks, pages: m.pages, status: state,
    quality: { ...m.quality, recorded: true, summary: summary.text }, already: true });
}
