import { createHash } from "node:crypto";
import type { IndividualContext } from "../guard";
import { isNotProvisioned } from "../access";
import { loadIndividualPolicy } from "../policy";
import { BUCKET, PDF_MIME, PPTX_MIME } from "./config";
import { openOfficeZip, slidePartNames } from "./extract";
import { buildVisuals } from "./material-visuals";
import { scanPdfImages } from "./material-visuals-pdf";
import { scanDeck } from "./material-visuals-io";
import { deckToPdf, openPdfDrawing, releaseEngine, RenderError, reserveEngine } from "./slide-render-engine";
import {
  FONT_PARTS, PDF_RENDER_ENGINE, RENDER_BUDGET_MS, RENDER_ENGINE, RENDER_MAX_BYTES, aliasFonts, claimDecision, layoutMatters, pagesExpected, pdfPagesToDraw, renderPath, slidePageMap, slidesToDraw,
  type RenderUnit,
} from "./slide-render";
import { startMemLog } from "./slide-render-mem";
import { readRender } from "./slide-render-read";
import { getMaterial, materialBytes, materialExtras, type MaterialRow } from "./store";

// ── WHOLE SLIDES: THE RECORD, THE JOB, THE STORED IMAGES ── SCHOLAR-VISUAL-001 phase 2 ───────────────────────────────────
//
// Owner-only, by the caller's own id, as every other Scholar read. A job is started by a person opening their own material, runs at most once
// for it (the row's primary key is the claim), calls no AI, and stores each drawn slide privately beside the file. A lesson holds no copy: it reads
// the record whenever it opens, so saved lessons show drawn slides with no regeneration.

type Out = { status: number; body: Record<string, unknown> };
const json = (status: number, body: Record<string, unknown>): Out => ({ status, body });
const TABLE = "individual_scholar_material_render";
const sha16 = (b: Uint8Array) => createHash("sha256").update(b).digest("hex").slice(0, 16);

/** Takes the claim, or says why not. Insert is atomic on the primary key; a reclaim only succeeds against the row just read. */
async function claim(ctx: IndividualContext, material: MaterialRow, attempts: number, nowIso: string): Promise<boolean | "unavailable"> {
  if (attempts === 1) {
    const { error } = await ctx.admin.from(TABLE).insert({ material_id: material.id, user_id: ctx.userId, status: "running", attempts: 1, claimed_at: nowIso, engine: material.mimeType === PDF_MIME ? PDF_RENDER_ENGINE : RENDER_ENGINE });
    if (!error) return true;
    return isNotProvisioned(error) ? "unavailable" : false;
  }
  const { data, error } = await ctx.admin.from(TABLE).update({ status: "running", attempts, claimed_at: nowIso, finished_at: null, reason: null })
    .eq("user_id", ctx.userId).eq("material_id", material.id).eq("attempts", attempts - 1).select("material_id");
  return !error && (data ?? []).length === 1;
}

/**
 * POST .../materials/[id]/whole-slides: starts the drawing if it may start. `run` is the job, for the route to hand to after(), so the person does
 * not wait for it. Nothing to do, or someone else doing it, is a 200 that says so.
 */
export async function startWholeSlides(ctx: IndividualContext, materialId: string): Promise<{ out: Out; run?: () => Promise<void> }> {
  const r = await getMaterial(ctx.admin, ctx.userId, materialId);
  if (!r.ok) return { out: json(503, { error: "That material could not be read just now." }) };
  if (!r.data) return { out: json(404, { error: "Not found" }) };
  const policy = await loadIndividualPolicy(ctx.admin);
  if (policy.scholarWholeSlides !== "on" || policy.scholarLessonVisuals !== "on") return { out: json(200, { state: "off" }) };
  if (r.data.mimeType !== PPTX_MIME && r.data.mimeType !== PDF_MIME) return { out: json(200, { state: "not_needed" }) };
  const row = await readRender(ctx, materialId);
  const now = Date.now();
  const decision = claimDecision(row, now);
  if (decision === "running" || decision === "finished") return { out: json(200, { state: decision }) };
  // The engine needs most of the function's memory. Another job here: the page asks again later, and no claim is spent.
  if (!reserveEngine()) return { out: json(200, { state: "busy" }) };
  const attempts = decision === "claim" ? 1 : (row?.attempts ?? 1) + 1;
  let claimed: boolean | "unavailable" = false;
  try {
    claimed = await claim(ctx, r.data, attempts, new Date(now).toISOString());
  } finally {
    if (claimed !== true) releaseEngine();
  }
  if (claimed === "unavailable") return { out: json(200, { state: "off" }) };
  if (!claimed) return { out: json(200, { state: "running" }) };
  const material = r.data;
  return { out: json(202, { state: "running" }), run: () => (material.mimeType === PDF_MIME ? drawPdf : drawDeck)(ctx, material, attempts, now, policy).finally(releaseEngine) };
}

type DrawPolicy = { scholarWholeSlidesMax: number; scholarLessonVisualsMinPx: number };

/** Writes the outcome. False when the row is gone (the learner deleted the material meanwhile) or another attempt owns it. */
async function finish(ctx: IndividualContext, materialId: string, attempts: number, fields: { status: "done" | "partial" | "failed"; units?: RenderUnit[]; notDrawn?: number[]; reason?: string | null }): Promise<boolean> {
  const { data, error } = await ctx.admin.from(TABLE).update({
    status: fields.status, finished_at: new Date().toISOString(), units: fields.units ?? [], not_drawn: fields.notDrawn ?? [], reason: fields.reason ?? null,
  }).eq("user_id", ctx.userId).eq("material_id", materialId).eq("attempts", attempts).select("material_id");
  return !error && (data ?? []).length === 1;
}

/**
 * The job for a PDF: its pages that nothing else can show inline, drawn by PDFium. No LibreOffice. A page that draws as one flat colour is not stored: it
 * may hold something that could not be decoded, and the button to the original page stays. A missing picture is never passed off as a blank page.
 */
async function drawPdf(ctx: IndividualContext, material: MaterialRow, attempts: number, started: number, policy: DrawPolicy): Promise<void> {
  const stored: string[] = [];
  try {
    const bytes = await materialBytes(ctx.admin, ctx.userId, material.id);
    if (!bytes) { await finish(ctx, material.id, attempts, { status: "failed", reason: "file_unreadable" }); return; }
    const extras = await materialExtras(ctx.admin, ctx.userId, [material.id]);
    const quality = extras.byId.get(material.id)?.quality ?? null;
    const empty = quality?.emptyUnits ?? [], aiRead = quality?.aiReadUnits ?? [];
    const scan = await scanPdfImages(bytes);
    const { visuals } = buildVisuals(scan, { unit: "page", minPx: policy.scholarLessonVisualsMinPx, maxPerSlide: 99, aiRead: new Set(aiRead), emptyUnits: empty, classify: false });
    const { draw, notDrawn } = pdfPagesToDraw({ visuals, textless: [...new Set([...empty, ...aiRead])], max: policy.scholarWholeSlidesMax });
    const devBudget = process.env.NODE_ENV === "production" ? 0 : Number(process.env.SCHOLAR_RENDER_DEV_BUDGET_MS) || 0;
    const left = () => (devBudget || RENDER_BUDGET_MS) - (Date.now() - started);
    const units: RenderUnit[] = [];
    const missed: number[] = [...notDrawn];
    let total = 0;
    const drawing = await openPdfDrawing(bytes);
    try {
      for (const n of draw) {
        if (left() < 5000 || total >= RENDER_MAX_BYTES) { missed.push(n); continue; }
        // One page that cannot be drawn keeps its button. It does not cost the other pages their drawing.
        const shown = await drawing.draw(n).catch(() => null);
        if (!shown || shown.blank || total + shown.bytes.byteLength > RENDER_MAX_BYTES) { missed.push(n); continue; }
        const { bytes: webp, width, height } = shown;
        const sha = sha16(webp);
        const path = renderPath(ctx.userId, material.id, n, sha);
        const up = await ctx.admin.storage.from(BUCKET).upload(path, Buffer.from(webp), { contentType: "image/webp", upsert: true });
        if (up.error) throw new RenderError("engine_failed");
        stored.push(path);
        total += webp.byteLength;
        units.push({ n, path, sha, width, height, bytes: webp.byteLength });
      }
    } finally {
      drawing.close();
    }
    missed.sort((a, b) => a - b);
    if (!(await finish(ctx, material.id, attempts, { status: missed.length ? "partial" : "done", units, notDrawn: missed }))) await ctx.admin.storage.from(BUCKET).remove(stored).catch(() => {});
  } catch (e) {
    if (stored.length) await ctx.admin.storage.from(BUCKET).remove(stored).catch(() => {});
    await finish(ctx, material.id, attempts, { status: "failed", reason: e instanceof RenderError ? e.code : "engine_failed" });
  }
}

/** The job. Anything that goes wrong leaves the learner with the original pictures, and a reason on the row: never a half-truth on the page. */
async function drawDeck(ctx: IndividualContext, material: MaterialRow, attempts: number, started: number, policy: DrawPolicy): Promise<void> {
  const stored: string[] = [];
  const mem = startMemLog();
  try {
    const bytes = await materialBytes(ctx.admin, ctx.userId, material.id);
    if (!bytes) { await finish(ctx, material.id, attempts, { status: "failed", reason: "file_unreadable" }); return; }
    const z = await openOfficeZip(bytes);
    if (!z.ok) { await finish(ctx, material.id, attempts, { status: "failed", reason: "file_unreadable" }); return; }
    const { zip } = z;
    const parts = slidePartNames(Object.keys(zip.files));
    const presentation = await zip.file("ppt/presentation.xml")?.async("string");
    const rels = await zip.file("ppt/_rels/presentation.xml.rels")?.async("string");
    const pages = presentation && rels ? slidePageMap(presentation, rels, parts) : null;
    if (!pages) { await finish(ctx, material.id, attempts, { status: "failed", reason: "order_unknown" }); return; }

    const scan = await scanDeck(bytes);
    if (!scan) { await finish(ctx, material.id, attempts, { status: "failed", reason: "file_unreadable" }); return; }
    const layout = new Set<number>();
    for (const [i, name] of parts.entries()) if (layoutMatters(await zip.file(name)!.async("string"))) layout.add(i + 1);
    const extras = await materialExtras(ctx.admin, ctx.userId, [material.id]);
    const facts = extras.byId.get(material.id)?.quality?.slideFacts;
    const { draw, notDrawn } = slidesToDraw({ scan, facts, layout, pages, minPx: policy.scholarLessonVisualsMinPx, max: policy.scholarWholeSlidesMax });
    if (!draw.length) { await finish(ctx, material.id, attempts, { status: "done" }); return; }

    // A working copy with its fonts named for the engine. The stored file is never written to.
    for (const name of Object.keys(zip.files)) {
      if (!FONT_PARTS.test(name)) continue;
      const xml = await zip.file(name)!.async("string");
      const aliased = aliasFonts(xml);
      if (aliased !== xml) zip.file(name, aliased);
    }
    const copy = await zip.generateAsync({ type: "uint8array", compression: "STORE" });

    // A development machine can be far slower than a function. Production always has the fixed budget, against the route's 300 s.
    const devBudget = process.env.NODE_ENV === "production" ? 0 : Number(process.env.SCHOLAR_RENDER_DEV_BUDGET_MS) || 0;
    const left = () => (devBudget || RENDER_BUDGET_MS) - (Date.now() - started);
    const pdf = await deckToPdf(copy, Math.max(1000, left() - 20_000));
    mem.mark("pdf");
    const drawing = await openPdfDrawing(pdf);
    const units: RenderUnit[] = [];
    const missed: number[] = [...notDrawn];
    try {
      // A page count that differs from the deck's means a page number is no longer a place in the deck: nothing is stored.
      if (drawing.pageCount !== pagesExpected(pages)) { await finish(ctx, material.id, attempts, { status: "failed", reason: "page_count_differs" }); return; }
      for (const n of draw) {
        if (left() < 5000) { missed.push(n); continue; }
        const { bytes: webp, width, height, blank } = await drawing.draw(pages.get(n) as number);
        // Flat colour on a slide known to hold something: not drawn, not stored. Its original pictures stay.
        if (blank) { missed.push(n); continue; }
        const sha = sha16(webp);
        const path = renderPath(ctx.userId, material.id, n, sha);
        const up = await ctx.admin.storage.from(BUCKET).upload(path, Buffer.from(webp), { contentType: "image/webp", upsert: true });
        if (up.error) throw new RenderError("engine_failed");
        stored.push(path);
        units.push({ n, path, sha, width, height, bytes: webp.byteLength });
      }
    } finally {
      drawing.close();
    }
    mem.mark("drawn");
    missed.sort((a, b) => a - b);
    // The learner may have deleted the file while it was being drawn. Then no record points at these images, so they go now.
    if (!(await finish(ctx, material.id, attempts, { status: missed.length ? "partial" : "done", units, notDrawn: missed }))) await ctx.admin.storage.from(BUCKET).remove(stored).catch(() => {});
  } catch (e) {
    // Nothing half-stored stays behind: the row records no units, so the images would never be shown or erased.
    if (stored.length) await ctx.admin.storage.from(BUCKET).remove(stored).catch(() => {});
    await finish(ctx, material.id, attempts, { status: "failed", reason: e instanceof RenderError ? e.code : "engine_failed" });
    mem.mark("failed");
  } finally {
    mem.stop();
  }
}
