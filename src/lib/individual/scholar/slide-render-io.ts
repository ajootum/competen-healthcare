import { createHash } from "node:crypto";
import type { IndividualContext } from "../guard";
import { isNotProvisioned } from "../access";
import { loadIndividualPolicy } from "../policy";
import { BUCKET, PDF_MIME, PPTX_MIME } from "./config";
import { openOfficeZip, slidePartNames } from "./extract";
import { buildVisuals } from "./material-visuals";
import { scanPdfImages } from "./material-visuals-pdf";
import { scanDeck } from "./material-visuals-io";
import { deckToPdf, openPdfDrawing, releaseEngine, RenderError, reserveEngine, type PdfDrawing } from "./slide-render-engine";
import {
  FONT_PARTS, PDF_RENDER_ENGINE, RENDER_BUDGET_MS, RENDER_ENGINE, RENDER_ENGINE_TRIES, RENDER_MAX_BYTES, RENDER_RETRY_MIN_MS, RENDER_STALE_MS, admission, aliasFonts, claimDecision, layoutMatters, mergeUnits, pagesExpected, pdfPagesToDraw, renderPath, renderTestHook, slidePageMap, slidesToDraw,
  type RenderRow, type RenderUnit, type RunningJob,
} from "./slide-render";
import { startMemLog, type MemLog } from "./slide-render-mem";
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

/** Every job running now, across all learners. Only ids and a time, for counting, and nothing of them leaves the server. Null when it cannot be read. */
async function runningJobs(ctx: IndividualContext, nowMs: number): Promise<RunningJob[] | null> {
  const { data, error } = await ctx.admin.from(TABLE).select("material_id, user_id, claimed_at").eq("status", "running").gt("claimed_at", new Date(nowMs - RENDER_STALE_MS).toISOString()).limit(500);
  if (error) return null;
  return ((data ?? []) as { material_id: string; user_id: string; claimed_at: string }[]).map(j => ({ materialId: j.material_id, userId: j.user_id, claimedAt: j.claimed_at }));
}

/** Gives a claim back unspent, so being told to wait never uses up one of a file's attempts. */
async function unclaim(ctx: IndividualContext, materialId: string, attempts: number, row: RenderRow | null): Promise<void> {
  if (attempts === 1) await ctx.admin.from(TABLE).delete().eq("user_id", ctx.userId).eq("material_id", materialId).eq("attempts", attempts);
  else if (row) await ctx.admin.from(TABLE).update({ status: row.status, attempts: row.attempts, claimed_at: row.claimedAt, finished_at: row.finishedAt, reason: row.reason })
    .eq("user_id", ctx.userId).eq("material_id", materialId).eq("attempts", attempts).select("material_id");
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
  // One job per learner, and a limit on the platform. Over either: the original pictures stay, the page asks again later, and no claim is spent. Unreadable: nothing starts.
  const me = { materialId, userId: ctx.userId, claimedAt: new Date(now).toISOString() };
  const before = await runningJobs(ctx, now);
  if (!before || admission([...before, me], me, policy.scholarWholeSlidesConcurrent) !== "go") return { out: json(200, { state: "busy" }) };
  // The engine needs most of the function's memory. Another job here: the same.
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
  // Counted again with the claim on record, because two requests can pass the first count together. Both now see both, and the older goes.
  const after = await runningJobs(ctx, now);
  if (!after || admission(after, me, policy.scholarWholeSlidesConcurrent) !== "go") {
    await unclaim(ctx, materialId, attempts, row).catch(() => {});
    releaseEngine();
    return { out: json(200, { state: "busy" }) };
  }
  const material = r.data;
  return { out: json(202, { state: "running" }), run: () => (material.mimeType === PDF_MIME ? drawPdf : drawDeck)(ctx, material, attempts, now, policy, row?.units ?? []).finally(releaseEngine) };
}

type DrawPolicy = { scholarWholeSlidesMax: number; scholarLessonVisualsMinPx: number };

/**
 * Writes the outcome. False when the row is gone (the learner deleted the material meanwhile) or another attempt owns it. Without `units`, the slides already
 * recorded stay: a job that fails keeps what it finished.
 */
async function finish(ctx: IndividualContext, materialId: string, attempts: number, fields: { status: "done" | "partial" | "failed"; units?: RenderUnit[]; notDrawn?: number[]; reason?: string | null }): Promise<boolean> {
  const { data, error } = await ctx.admin.from(TABLE).update({
    status: fields.status, finished_at: new Date().toISOString(), reason: fields.reason ?? null,
    ...(fields.units ? { units: fields.units } : {}), ...(fields.notDrawn ? { not_drawn: fields.notDrawn } : {}),
  }).eq("user_id", ctx.userId).eq("material_id", materialId).eq("attempts", attempts).select("material_id");
  return !error && (data ?? []).length === 1;
}

/** Records the slides drawn so far, after each one. "gone": the row is no longer this job's, so nothing it stored has a record. Throws if it cannot be written. */
async function record(ctx: IndividualContext, materialId: string, attempts: number, units: RenderUnit[]): Promise<"recorded" | "gone"> {
  const { data, error } = await ctx.admin.from(TABLE).update({ units }).eq("user_id", ctx.userId).eq("material_id", materialId).eq("attempts", attempts).select("material_id");
  if (error) throw new RenderError("engine_failed");
  return (data ?? []).length === 1 ? "recorded" : "gone";
}

type Drawn = { outcome: "drawn" | "gone"; units: RenderUnit[]; missed: number[] };

/**
 * Draws what is left, one page at a time, and records each as soon as it is stored, so a job that dies keeps every slide it finished and a retry does only
 * the rest. An image is named by its digest and stored with upsert, so drawing a slide again can never make a second one.
 */
async function drawAndRecord(ctx: IndividualContext, material: MaterialRow, attempts: number, input: {
  drawing: PdfDrawing; todo: number[]; total: number; pageOf: (n: number) => number; prior: RenderUnit[]; left: () => number; mem: MemLog; maxBytes?: number; skipFailedPage?: boolean; killAfterSlides?: number;
}): Promise<Drawn> {
  let units = input.prior;
  const stored: string[] = [];
  const missed: number[] = [];
  let bytes = input.prior.reduce((sum, u) => sum + u.bytes, 0);
  let made = 0;
  input.mem.slides(units.length, input.total);
  for (const n of input.todo) {
    if (input.left() < 5000 || (input.maxBytes && bytes >= input.maxBytes)) { missed.push(n); continue; }
    // A PDF page that cannot be drawn keeps its button, and does not cost the other pages their drawing.
    const shown = input.skipFailedPage ? await input.drawing.draw(input.pageOf(n)).catch(() => null) : await input.drawing.draw(input.pageOf(n));
    // Flat colour on a slide known to hold something: not drawn, not stored. Its original pictures stay.
    if (!shown || shown.blank || (input.maxBytes && bytes + shown.bytes.byteLength > input.maxBytes)) { missed.push(n); continue; }
    const sha = sha16(shown.bytes);
    const path = renderPath(ctx.userId, material.id, n, sha);
    const up = await ctx.admin.storage.from(BUCKET).upload(path, Buffer.from(shown.bytes), { contentType: "image/webp", upsert: true });
    if (up.error) throw new RenderError("engine_failed");
    const next = mergeUnits(units, [{ n, path, sha, width: shown.width, height: shown.height, bytes: shown.bytes.byteLength }]);
    let answer: "recorded" | "gone";
    try {
      answer = await record(ctx, material.id, attempts, next);
    } catch (e) {
      // Stored and not recorded: nothing could ever show or erase it.
      await ctx.admin.storage.from(BUCKET).remove([path]).catch(() => {});
      throw e;
    }
    // The learner deleted the file while it was being drawn. Then no record points at these images, so they go now.
    if (answer === "gone") { await ctx.admin.storage.from(BUCKET).remove([...stored, path]).catch(() => {}); return { outcome: "gone", units: [], missed: [] }; }
    stored.push(path);
    units = next;
    bytes += shown.bytes.byteLength;
    input.mem.slides(units.length, input.total);
    // A preview's forced kill: the instance dies with these slides recorded, as it does when it runs out of memory.
    if (input.killAfterSlides && ++made >= input.killAfterSlides) process.kill(process.pid, "SIGKILL");
  }
  return { outcome: "drawn", units, missed };
}

const budgetFrom = (started: number) => {
  // A development machine can be far slower than a function. Production always has the fixed budget, against the route's 300 s.
  const devBudget = process.env.NODE_ENV === "production" ? 0 : Number(process.env.SCHOLAR_RENDER_DEV_BUDGET_MS) || 0;
  return () => (devBudget || RENDER_BUDGET_MS) - (Date.now() - started);
};

const reasonOf = (e: unknown) => (e instanceof RenderError ? e.code : "engine_failed");

/**
 * The job for a PDF: its pages that nothing else can show inline, drawn by PDFium. No LibreOffice. A page that draws as one flat colour is not stored: it
 * may hold something that could not be decoded, and the button to the original page stays. A missing picture is never passed off as a blank page.
 */
async function drawPdf(ctx: IndividualContext, material: MaterialRow, attempts: number, started: number, policy: DrawPolicy, prior: RenderUnit[]): Promise<void> {
  const mem = startMemLog(attempts);
  let end = "failed";
  try {
    const bytes = await materialBytes(ctx.admin, ctx.userId, material.id);
    if (!bytes) { await finish(ctx, material.id, attempts, { status: "failed", reason: "file_unreadable" }); return; }
    const extras = await materialExtras(ctx.admin, ctx.userId, [material.id]);
    const quality = extras.byId.get(material.id)?.quality ?? null;
    const empty = quality?.emptyUnits ?? [], aiRead = quality?.aiReadUnits ?? [];
    const scan = await scanPdfImages(bytes);
    const { visuals } = buildVisuals(scan, { unit: "page", minPx: policy.scholarLessonVisualsMinPx, maxPerSlide: 99, aiRead: new Set(aiRead), emptyUnits: empty, classify: false });
    const { draw, notDrawn } = pdfPagesToDraw({ visuals, textless: [...new Set([...empty, ...aiRead])], max: policy.scholarWholeSlidesMax });
    const have = new Set(prior.map(u => u.n));
    const drawing = await openPdfDrawing(bytes);
    let drawn: Drawn;
    try {
      drawn = await drawAndRecord(ctx, material, attempts, { drawing, todo: draw.filter(n => !have.has(n)), total: draw.length, pageOf: n => n, prior, left: budgetFrom(started), mem, maxBytes: RENDER_MAX_BYTES, skipFailedPage: true });
    } finally {
      drawing.close();
    }
    if (drawn.outcome === "gone") { end = "gone"; return; }
    const missed = [...notDrawn, ...drawn.missed].sort((a, b) => a - b);
    end = missed.length ? "partial" : "done";
    await finish(ctx, material.id, attempts, { status: missed.length ? "partial" : "done", units: drawn.units, notDrawn: missed });
  } catch (e) {
    end = `failed_${reasonOf(e)}`;
    await finish(ctx, material.id, attempts, { status: "failed", reason: reasonOf(e) });
  } finally {
    mem.stop(end);
  }
}

/** Converts the deck, starting the engine a second time if the first stopped working and there is time. Only a stall or low memory is worth another start: a bad file is still bad. */
async function convertDeck(copy: Uint8Array, left: () => number, mem: MemLog, stallTries: number): Promise<Uint8Array> {
  for (let n = 1; ; n++) {
    mem.engineTry(n);
    try {
      return await deckToPdf(copy, Math.max(1000, left() - 20_000), n <= stallTries ? { stallAfterMs: 8000 } : {});
    } catch (e) {
      const again = e instanceof RenderError && (e.code === "stalled" || e.code === "memory_low") && n < RENDER_ENGINE_TRIES && left() >= RENDER_RETRY_MIN_MS;
      if (!again) throw e;
      mem.mark(e.code);
    }
  }
}

/** The job. Anything that goes wrong leaves the learner with the original pictures and every slide already drawn, and a reason on the row: never a half-truth on the page. */
async function drawDeck(ctx: IndividualContext, material: MaterialRow, attempts: number, started: number, policy: DrawPolicy, prior: RenderUnit[]): Promise<void> {
  const mem = startMemLog(attempts);
  const hook = renderTestHook(material.fileName ?? "");
  let end = "failed";
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
    const have = new Set(prior.map(u => u.n));
    const todo = draw.filter(n => !have.has(n));
    mem.slides(draw.length - todo.length, draw.length);
    // Nothing left to draw, on a first job or a retry: no engine, and no memory spent on one.
    if (!todo.length) {
      end = notDrawn.length ? "partial" : "done";
      await finish(ctx, material.id, attempts, { status: notDrawn.length ? "partial" : "done", units: prior, notDrawn });
      return;
    }

    // A working copy with its fonts named for the engine. The stored file is never written to.
    for (const name of Object.keys(zip.files)) {
      if (!FONT_PARTS.test(name)) continue;
      const xml = await zip.file(name)!.async("string");
      const aliased = aliasFonts(xml);
      if (aliased !== xml) zip.file(name, aliased);
    }
    const copy = await zip.generateAsync({ type: "uint8array", compression: "STORE" });

    const left = budgetFrom(started);
    const pdf = await convertDeck(copy, left, mem, hook?.stallTries ?? 0);
    mem.mark("pdf");
    const drawing = await openPdfDrawing(pdf);
    let drawn: Drawn;
    try {
      // A page count that differs from the deck's means a page number is no longer a place in the deck: nothing is stored.
      if (drawing.pageCount !== pagesExpected(pages)) { end = "failed_page_count"; await finish(ctx, material.id, attempts, { status: "failed", reason: "page_count_differs" }); return; }
      drawn = await drawAndRecord(ctx, material, attempts, { drawing, todo, total: draw.length, pageOf: n => pages.get(n) as number, prior, left, mem, killAfterSlides: hook?.killAfterSlides });
    } finally {
      drawing.close();
    }
    if (drawn.outcome === "gone") { end = "gone"; return; }
    mem.mark("drawn");
    const missed = [...notDrawn, ...drawn.missed].sort((a, b) => a - b);
    end = missed.length ? "partial" : "done";
    await finish(ctx, material.id, attempts, { status: missed.length ? "partial" : "done", units: drawn.units, notDrawn: missed });
  } catch (e) {
    end = `failed_${reasonOf(e)}`;
    await finish(ctx, material.id, attempts, { status: "failed", reason: reasonOf(e) });
  } finally {
    mem.stop(end);
  }
}
