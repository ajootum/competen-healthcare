/* eslint-disable @typescript-eslint/no-explicit-any */
import type { IndividualContext } from "../guard";
import { loadIndividualPolicy } from "../policy";
import { PPTX_MIME } from "./config";
import { chunkPages, findPatientIdentifiers, pictureSlideImages, type SlideImages } from "./extract";
import { addPictureSlideSections, getMaterial, listChunks, materialBytes, materialExtras } from "./store";
import { AI_ERROR, SCHOLAR_AI_AUDIT_ACTION, aiPreflight, audit, meteredRefusal, scholarAiRunner, scholarRisk } from "./http";
import { TRANSCRIBE_PROMPT_VERSION, runTranscription } from "./exam-answer";
import { EXAM_ACTIVITY, TRANSCRIBE_BATCH } from "./exam-service";
import { MAX_AI_SLIDES_PER_MATERIAL, SLIDE_IMAGE_LIMITS, hasReadableText, isConvertibleKind, planPictureSlides, type NewChunk } from "./slide-images";
import { convertToPng } from "./slide-convert";

// ── READING PICTURE-ONLY SLIDES WITH AI ── SCHOLAR-UPLOAD-FIX ──────────────────────────────────────────────────────
//
// On the learner's request, for a PowerPoint whose extraction recorded slides with no text. NO NEW AI SUBSYSTEM: the
// slides' own pictures (PNG / JPEG from ppt/media, through each slide's .rels) are put one slide per page into a PDF
// and read by the EXISTING examination-page transcription runner (runTranscription, prompt exam-transcribe-v1),
// through the same metered Scholar runner as every Scholar AI call, under the transcription activity
// (EXAM_ACTIVITY.transcribe). Two slides per request, as the exam path batches pages; the page calls until done.
//
// ⚠ GATES, IN ORDER: policy scholar_material_image_slides = ai_transcription (default off) -> the caller's own
// PowerPoint -> slides recorded as empty, never attempted, at most MAX_AI_SLIDES_PER_MATERIAL per material -> AI
// consent, quota and configuration (aiPreflight) -> the metered runner.
// ⚠ PATIENT IDENTIFIERS: each slide's transcription is screened with the SAME screen as an upload
// (findPatientIdentifiers). A slide with a match is not kept -- it stays unread, and the learner is told.
// ⚠ LABELLED: a section added here is recorded on the material (extraction_quality.ai_read_units) and every surface
// that shows the section says it was read by AI from a picture, to be checked against the slide.

type Out = { status: number; body: Record<string, unknown> };
const json = (status: number, body: Record<string, unknown>): Out => ({ status, body });

export type SlideSkip = { slide: number; reason: "no_picture" | "unsupported" | "too_large" | "patient_identifier" | "no_text" };
export const SLIDE_EXTRACTOR_TAG = "ai-slides-v1";

/** Pure. Why a slide could not be sent at all, or null when it has a picture to read. */
export function slideSkipReason(s: SlideImages): SlideSkip["reason"] | null {
  if (s.images.length) return null;
  if (s.tooLarge) return "too_large";
  return s.unsupported.length ? "unsupported" : "no_picture";
}

/** What the material page needs to offer a reading: the slides it would read now, and how many the cap leaves out. */
export async function pictureSlidePlan(admin: any, userId: string, materialId: string): Promise<{ slides: number[]; beyondCap: number } | null> {
  const [extras, chunks] = await Promise.all([materialExtras(admin, userId, [materialId]), listChunks(admin, userId, materialId)]);
  const q = extras.byId.get(materialId)?.quality ?? null;
  if (!q || q.unit !== "slide" || !q.emptyUnits.length || !chunks.ok) return null;
  return planPictureSlides({ emptyUnits: q.emptyUnits, triedUnits: q.aiTriedUnits, slidesWithSections: chunks.data.map(c => c.pageFrom ?? 0), cap: MAX_AI_SLIDES_PER_MATERIAL });
}

/** One page per slide, each slide's pictures stacked in the order the slide shows them. */
async function slidesPdf(slides: SlideImages[]): Promise<{ base64: string; pages: number[] } | null> {
  const { PDFDocument } = await import("pdf-lib");
  const doc = await PDFDocument.create();
  const pages: number[] = [];
  const W = 960, GAP = 12, MAX_H = 14000;
  for (const s of slides) {
    const embedded = [];
    let bytes = 0;
    for (const img of s.images) {
      try {
        // TIFF / BMP / GIF / WebP become PNG first; one sharp or pdf-lib cannot read is left out, never a crash.
        const data = isConvertibleKind(img.kind) ? await convertToPng(img.bytes) : img.bytes;
        if (!data) continue;
        if (bytes + data.byteLength > SLIDE_IMAGE_LIMITS.bytesPerSlide) continue; // the slide's combined size stays bounded
        const e = img.kind === "jpeg" ? await doc.embedJpg(data) : await doc.embedPng(data);
        bytes += data.byteLength;
        embedded.push(e);
      } catch { /* an image pdf-lib cannot read is left out */ }
    }
    if (!embedded.length) continue;
    const dims = embedded.map(e => ({ e, w: W, h: (e.height / e.width) * W }));
    const total = dims.reduce((n, d) => n + d.h, 0) + GAP * (dims.length - 1);
    const k = total > MAX_H ? MAX_H / total : 1;
    const page = doc.addPage([W * k, total * k]);
    let y = total * k;
    for (const d of dims) {
      y -= d.h * k;
      page.drawImage(d.e, { x: 0, y, width: d.w * k, height: d.h * k });
      y -= GAP * k;
    }
    pages.push(s.slide);
  }
  if (!pages.length) return null;
  return { base64: Buffer.from(await doc.save()).toString("base64"), pages };
}

/**
 * Read the next picture-only slides of the caller's own PowerPoint. Answers what was read, what was skipped and why,
 * and how many remain for the next request.
 */
export async function readPictureSlides(ctx: IndividualContext, req: Request, materialId: string): Promise<Out> {
  const policy = await loadIndividualPolicy(ctx.admin);
  if (policy.scholarMaterialImageSlides !== "ai_transcription") return json(403, { error: "Reading picture-only slides with AI is not turned on." });
  const material = await getMaterial(ctx.admin, ctx.userId, materialId);
  if (!material.ok) return json(503, { error: "That material could not be read just now." });
  if (!material.data) return json(404, { error: "Not found" });
  if (material.data.mimeType !== PPTX_MIME) return json(409, { error: "Only a PowerPoint's picture-only slides can be read this way." });
  const plan = await pictureSlidePlan(ctx.admin, ctx.userId, materialId);
  if (!plan) return json(503, { error: "Which slides held no text could not be read just now." });
  if (!plan.slides.length) return json(200, { read: [], skipped: [], remaining: 0, beyondCap: plan.beyondCap });

  const pre = await aiPreflight(ctx);
  if (pre) return json(pre.status, await pre.json());
  const bytes = await materialBytes(ctx.admin, ctx.userId, materialId);
  if (!bytes) return json(503, { error: "Your original file could not be read just now. Try again shortly." });

  const batch = plan.slides.slice(0, TRANSCRIBE_BATCH);
  const images = await pictureSlideImages(bytes, batch);
  if (!images.ok) return json(422, { error: "The slides' pictures could not be read from your file." });
  const skipped: SlideSkip[] = [];
  const sendable: SlideImages[] = [];
  for (const s of images.slides) {
    const why = slideSkipReason(s);
    if (why) skipped.push({ slide: s.slide, reason: why }); else sendable.push(s);
  }
  const pdf = sendable.length ? await slidesPdf(sendable) : null;
  for (const s of sendable) if (!pdf?.pages.includes(s.slide)) skipped.push({ slide: s.slide, reason: "unsupported" });

  const read: number[] = [];
  const additions: NewChunk[] = [];
  let model = "";
  if (pdf) {
    const ai = scholarAiRunner(ctx, req, EXAM_ACTIVITY.transcribe, await scholarRisk(ctx.admin, ctx.userId, { text: null, passages: [] }));
    const r = await runTranscription(ai.run, ctx.userId, { pdfBase64: pdf.base64, pages: pdf.pages.map((_, i) => i + 1) });
    const refused = meteredRefusal(ai.refusal());
    if (refused) return json(refused.status, await refused.json());
    if (!r.ok) {
      await audit(ctx, SCHOLAR_AI_AUDIT_ACTION, "individual_scholar_slide_transcribe", materialId, { asked: pdf.pages, outcome: `error:${r.error}` });
      return json(AI_ERROR[r.error].status, { error: AI_ERROR[r.error].error });
    }
    model = r.model;
    const byPage = new Map(r.pages.map(p => [p.page, p.text]));
    pdf.pages.forEach((slide, i) => {
      const text = byPage.get(i + 1) ?? "";
      // The upload's own screen, on the transcribed words: a slide that names a patient is not kept.
      if (findPatientIdentifiers(text).length) { skipped.push({ slide, reason: "patient_identifier" }); return; }
      if (!hasReadableText(text)) { skipped.push({ slide, reason: "no_text" }); return; }
      const chunks = chunkPages([{ page: slide, text }]);
      if (!chunks.length) { skipped.push({ slide, reason: "no_text" }); return; }
      read.push(slide);
      additions.push(...chunks.map(c => ({ pageFrom: slide, pageTo: slide, content: c.content })));
    });
  }

  const tried = [...read, ...skipped.map(s => s.slide)];
  const saved = await addPictureSlideSections(ctx.admin, ctx.userId, materialId, { additions, read, tried, extractorTag: SLIDE_EXTRACTOR_TAG });
  await audit(ctx, SCHOLAR_AI_AUDIT_ACTION, "individual_scholar_slide_transcribe", materialId, {
    asked: batch, read, skipped: skipped.map(s => `${s.slide}:${s.reason}`), model, prompt_version: model ? TRANSCRIBE_PROMPT_VERSION : null,
    saved: saved.ok ? saved.added : `error:${saved.error}`, recorded: saved.ok ? saved.recorded : false,
  });
  if (!saved.ok) return json(500, { error: "The slides were read but could not be saved. Nothing was added. Try again shortly." });
  return json(200, { read, skipped: skipped.sort((a, b) => a.slide - b.slide), remaining: Math.max(0, plan.slides.length - batch.length), beyondCap: plan.beyondCap });
}
