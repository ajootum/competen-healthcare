// COMPETEN-DIG-001 proof of concept. One scenario per process, so a container's own figures describe that scenario alone (run.mjs starts it in a limited, offline container).
// Writes <out>/<scenario>.json. Words and pictures stay in the scratchpad; only numbers reach the evidence folder.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { join } from "node:path";
import { PPTX_MIME } from "@/lib/individual/scholar/config";
import { chunkPages, extractMaterial, extractionQuality, normaliseText, openOfficeZip, slidePartNames, findPatientIdentifiers, type ExtractedPage } from "@/lib/individual/scholar/extract";
import { readSlideFacts } from "@/lib/individual/scholar/slide-structure";
import { applySlideFacts } from "@/lib/individual/scholar/slide-classify";
import { scanDeck } from "@/lib/individual/scholar/material-visuals-io";
import { BROWSER_KINDS, buildVisuals } from "@/lib/individual/scholar/material-visuals";
import { aliasFonts, FONT_PARTS, layoutMatters, slidePageMap, slidesToDraw } from "@/lib/individual/scholar/slide-render";
import { deckToPdf, openPdfDrawing, RenderError } from "@/lib/individual/scholar/slide-render-engine";
import { CANONICAL_SCHEMA, CANONICAL_VERSION, blockWords, conversionKey, toMarkdown, validateCanonical, type CanonicalAsset, type CanonicalDocument, type CanonicalUnit } from "@/lib/holdings/document-intelligence/canonical";
import { readDeck, slideFactsOf } from "@/lib/holdings/document-intelligence/pptx-reader";
import { reconcile, type UnitFacts } from "@/lib/holdings/document-intelligence/quality";
import { chooseRepresentation, picturePlan, worthKeeping } from "@/lib/holdings/document-intelligence/visual-policy";
import { EngineFailure, processDocument, type ConversionStore, type EngineAdapter } from "@/lib/holdings/document-intelligence/gateway";
import { SEED_ENGINES, type EngineRecord } from "@/lib/holdings/document-intelligence/engine-registry";
import { breakerHealth, NEW_BREAKER, type Breaker } from "@/lib/holdings/document-intelligence/routing";

const [scenario, deckPath, out, ...rest] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const bytes = new Uint8Array(readFileSync(deckPath));
const sourceSha = createHash("sha256").update(bytes).digest("hex");
const label = process.env.DIG_LABEL ?? scenario;
const result: Record<string, unknown> = { scenario, label, deckBytes: bytes.byteLength, sourceSha16: sourceSha.slice(0, 16), stages: {} as Record<string, number> };
const stage = async <T>(name: string, f: () => Promise<T>): Promise<T> => {
  const t = performance.now();
  const r = await f();
  (result.stages as Record<string, number>)[name] = Math.round(performance.now() - t);
  return r;
};
const gz = (s: string) => gzipSync(Buffer.from(s)).byteLength;
const PIPELINE = "dig-poc-1";
const save = () => writeFileSync(join(out, `${label}.json`), JSON.stringify(result, null, 1));

/** Exactly what the upload route does after screening, minus the database. */
async function uploadPath() {
  const extraction = await stage("extract", () => extractMaterial(PPTX_MIME, bytes));
  if (!extraction.ok) throw new Error(`extract ${extraction.reason}`);
  await stage("identifiers", async () => findPatientIdentifiers(extraction.pages.map(p => p.text).join("\n")));
  const chunks = chunkPages(extraction.pages);
  const quality = extractionQuality(PPTX_MIME, extraction.pages, chunks);
  const facts = await stage("slide_facts", () => readSlideFacts(bytes, extraction.pages, "2026-11-07T00:00:00Z"));
  if (facts) Object.assign(quality, applySlideFacts(quality, facts));
  return { extraction, chunks, quality, facts };
}

/** What a browser gets for a section's pictures today. */
async function shownToday() {
  const scan = await scanDeck(bytes);
  const { visuals, notShown } = buildVisuals(scan, { unit: "slide", classify: false });
  return { scan, visuals, notShown };
}

/** A working copy of the deck holding only `keep`, with fonts named for the engine. Nothing else is read or kept: its pages run in deck order. */
async function workingCopy(keep: readonly number[] | null): Promise<{ copy: Uint8Array; pageOf: Map<number, number> }> {
  const z = await openOfficeZip(bytes);
  if (!z.ok) throw new Error(z.reason);
  const { zip } = z;
  const parts = slidePartNames(Object.keys(zip.files));
  const presentation = await zip.file("ppt/presentation.xml")!.async("string");
  const rels = await zip.file("ppt/_rels/presentation.xml.rels")!.async("string");
  const positions = slidePageMap(presentation, rels, parts);
  if (!positions) throw new Error("order unknown");
  let pageOf = new Map(positions);
  if (keep) {
    const wanted = new Set(keep);
    const drop = parts.map((name, i) => ({ name, n: i + 1 })).filter(p => !wanted.has(p.n));
    let pres = presentation, r = rels, ct = await zip.file("[Content_Types].xml")!.async("string");
    for (const d of drop) {
      const file = d.name.replace("ppt/", "");
      const id = new RegExp(`<(?:\\w+:)?Relationship\\b[^>]*\\bId="([^"]+)"[^>]*\\bTarget="/?(?:ppt/)?${file.replace(/\//g, "\\/")}"|<(?:\\w+:)?Relationship\\b[^>]*\\bTarget="/?(?:ppt/)?${file.replace(/\//g, "\\/")}"[^>]*\\bId="([^"]+)"`).exec(r);
      const rid = id?.[1] ?? id?.[2];
      if (!rid) throw new Error(`no rel for ${d.name}`);
      pres = pres.replace(new RegExp(`<p:sldId\\b[^>]*\\br:id="${rid}"[^>]*/>`), "");
      r = r.replace(new RegExp(`<(?:\\w+:)?Relationship\\b[^>]*\\b(?:Id="${rid}")[^>]*/>`), "");
      ct = ct.replace(new RegExp(`<Override\\b[^>]*PartName="/${d.name}"[^>]*/>`), "");
      const notes = (await zip.file(d.name.replace("ppt/slides/", "ppt/slides/_rels/") + ".rels")?.async("string"))?.match(/notesSlides\/(notesSlide\d+\.xml)/)?.[1];
      if (notes) { zip.remove(`ppt/notesSlides/${notes}`); zip.remove(`ppt/notesSlides/_rels/${notes}.rels`); ct = ct.replace(new RegExp(`<Override\\b[^>]*PartName="/ppt/notesSlides/${notes}"[^>]*/>`), ""); }
      zip.remove(d.name);
      zip.remove(d.name.replace("ppt/slides/", "ppt/slides/_rels/") + ".rels");
    }
    zip.file("ppt/presentation.xml", pres);
    zip.file("ppt/_rels/presentation.xml.rels", r);
    zip.file("[Content_Types].xml", ct);
    // Pictures no remaining slide, layout or master names go too, so the engine does not load them.
    const remaining = Object.keys(zip.files).filter(n => n.endsWith(".rels"));
    const named = new Set<string>();
    for (const n of remaining) for (const m of (await zip.file(n)!.async("string")).matchAll(/media\/([^"]+)"/g)) named.add(m[1]);
    for (const n of Object.keys(zip.files)) if (n.startsWith("ppt/media/") && !named.has(n.slice("ppt/media/".length))) zip.remove(n);
    const ordered = [...keep].sort((a, b) => positions.get(a)! - positions.get(b)!);
    pageOf = new Map(ordered.map((n, i) => [n, i + 1]));
  }
  for (const name of Object.keys(zip.files)) {
    if (!FONT_PARTS.test(name) || !zip.file(name)) continue;
    const xml = await zip.file(name)!.async("string");
    const aliased = aliasFonts(xml);
    if (aliased !== xml) zip.file(name, aliased);
  }
  const copy = await zip.generateAsync({ type: "uint8array", compression: "STORE" });
  return { copy, pageOf };
}

async function slidesWorthDrawing() {
  const z = await openOfficeZip(bytes);
  if (!z.ok) throw new Error(z.reason);
  const { zip } = z;
  const parts = slidePartNames(Object.keys(zip.files));
  const presentation = await zip.file("ppt/presentation.xml")!.async("string");
  const rels = await zip.file("ppt/_rels/presentation.xml.rels")!.async("string");
  const pages = slidePageMap(presentation, rels, parts)!;
  const scan = (await scanDeck(bytes))!;
  const layout = new Set<number>();
  for (const [i, name] of parts.entries()) if (layoutMatters(await zip.file(name)!.async("string"))) layout.add(i + 1);
  const extraction = await extractMaterial(PPTX_MIME, bytes);
  const facts = extraction.ok ? await readSlideFacts(bytes, extraction.pages, "2026-11-07T00:00:00Z") : null;
  return slidesToDraw({ scan, facts: facts ?? undefined, layout, pages, minPx: 120, max: 80 });
}

/** Store the drawn pages in `dir`. A lossless WebP at each display width too, kept only where it saves enough. */
async function drawPages(pdf: Uint8Array, pageOf: ReadonlyMap<number, number>, draw: readonly number[], dir: string) {
  const sharp = (await import("sharp")).default;
  mkdirSync(dir, { recursive: true });
  const drawing = await openPdfDrawing(pdf);
  const rows: { n: number; bytes: number; blank: boolean; sha: string; widths: Record<string, number> }[] = [];
  let drawMs = 0, displayMs = 0;
  try {
    for (const n of draw) {
      const t0 = performance.now();
      const shown = await drawing.draw(pageOf.get(n)!);
      drawMs += performance.now() - t0;
      writeFileSync(join(dir, `slide-${n}.webp`), shown.bytes);
      const t1 = performance.now();
      const widths: Record<string, number> = {};
      for (const w of [640, 1280]) {
        const small = await sharp(shown.bytes).resize({ width: w }).webp({ lossless: true, effort: 4 }).toBuffer();
        if (worthKeeping(small.byteLength, shown.bytes.byteLength)) { widths[w] = small.byteLength; writeFileSync(join(dir, `slide-${n}-${w}.webp`), small); }
      }
      displayMs += performance.now() - t1;
      rows.push({ n, bytes: shown.bytes.byteLength, blank: shown.blank, sha: createHash("sha256").update(shown.bytes).digest("hex").slice(0, 16), widths });
    }
    result.drawOnlyMs = Math.round(drawMs);
    result.displayFormsMs = Math.round(displayMs);
    return { rows, pageCount: drawing.pageCount };
  } finally {
    drawing.close();
  }
}

/** The canonical document from the native reader, and its derived Markdown. */
async function canonical() {
  const read = await stage("canonical_read", () => readDeck(bytes, "native_drawingml"));
  if (!read.ok) throw new Error(read.reason);
  const { reading } = read;
  const doc: CanonicalDocument = {
    schema: CANONICAL_SCHEMA, schemaVersion: CANONICAL_VERSION,
    source: { sha256: sourceSha, bytes: bytes.byteLength, mime: PPTX_MIME, unit: "slide", units: reading.units.length },
    conversion: { key: conversionKey({ sourceSha256: sourceSha, pipelineVersion: PIPELINE, requirement: "text", scope: "poc" }), pipelineVersion: PIPELINE, configVersion: 1, requirement: "text", engines: [{ engine: "native_drawingml", version: "pptx-canonical@1", role: "primary", units: "all", ok: true, reason: null, ms: null, peakMb: null }] },
    units: reading.units, assets: reading.assets, interpretations: [], quality: { passed: false, textRecall: null, issues: [] },
  };
  doc.quality = reconcile(doc, reading.facts, 0.98);
  return { doc, reading };
}

const census = (units: readonly CanonicalUnit[]) => {
  const has = (u: CanonicalUnit, t: string) => u.blocks.some(b => b.type === t);
  const words = (u: CanonicalUnit) => u.blocks.filter(b => b.type !== "notes" && b.type !== "figure").map(blockWords).join(" ").trim();
  return {
    blank: units.filter(u => u.status === "blank").map(u => u.n),
    textOnly: units.filter(u => words(u) && !has(u, "figure")).map(u => u.n),
    pictureOnly: units.filter(u => !words(u) && has(u, "figure")).map(u => u.n),
    mixed: units.filter(u => words(u) && has(u, "figure")).map(u => u.n),
    grouped: units.filter(u => u.blocks.some(b => b.source.groupPath.length)).map(u => u.n),
    tables: units.filter(u => has(u, "table")).map(u => u.n),
    charts: units.filter(u => has(u, "chart")).map(u => u.n),
    diagrams: units.filter(u => has(u, "diagram")).map(u => u.n),
    unread: units.filter(u => has(u, "unread")).map(u => u.n),
    hidden: units.filter(u => u.hidden).map(u => u.n),
    moved: units.filter(u => u.position !== null && u.position !== u.n).map(u => u.n),
  };
};

/** Words per unit, for the comparison against PowerPoint. In the scratchpad only. */
const dumpUnits = (name: string, units: readonly { n: number; text: string }[]) => writeFileSync(join(out, `${name}.units.json`), JSON.stringify(units));

// ── A: today's pipeline ─────────────────────────────────────────────────────────────────────────────
async function scenarioA() {
  const { extraction, chunks, quality, facts } = await uploadPath();
  const shown = await stage("visual_scan", shownToday);
  dumpUnits(label, (extraction.pages as ExtractedPage[]).map(p => ({ n: p.page ?? 0, text: normaliseText(p.text) })));
  const text = JSON.stringify(chunks.map(c => c.content));
  Object.assign(result, {
    slides: extraction.pageCount, chunks: chunks.length, chars: quality.chars, emptyUnits: quality.emptyUnits, facts: facts ? { blank: facts.blank, mixed: facts.mixed, grouped: facts.grouped, decorativeOnly: facts.decorativeOnly, review: facts.review } : null,
    storedTextBytes: Buffer.byteLength(text), storedTextGzBytes: gz(text),
    visualsShown: shown.visuals.length, visualsNotShown: shown.notShown, visualBytes: shown.visuals.reduce((n, v) => n + (v.bytes ?? 0), 0),
    visualsByKind: shown.visuals.reduce<Record<string, number>>((o, v) => { o[v.kind] = (o[v.kind] ?? 0) + 1; return o; }, {}),
  });
}

// ── A, repeat access: what serving one picture and one index costs today, once the deck is cold in the instance's cache ─
async function scenarioAView() {
  const t0 = performance.now();
  const scan = await scanDeck(bytes);
  const { visuals } = buildVisuals(scan, { unit: "slide", classify: false });
  const scanMs = performance.now() - t0;
  // The file route: fetch the whole deck, open it, inflate the one picture, digest it (material-visuals-io.materialVisualFile).
  const perPicture: number[] = [];
  const shown = visuals.filter(v => v.kind !== "pdf_page" && v.media && (BROWSER_KINDS as readonly string[]).includes(v.kind));
  for (const v of shown) {
    const t = performance.now();
    const z = await openOfficeZip(bytes);
    if (!z.ok) throw new Error(z.reason);
    const data = await z.zip.file(v.media!)!.async("uint8array");
    createHash("sha256").update(data).digest("hex");
    perPicture.push(performance.now() - t);
  }
  const sorted = [...perPicture].sort((a, b) => a - b);
  Object.assign(result, {
    indexColdMs: Math.round(scanMs), pictures: shown.length, pictureMsMedian: +(sorted[Math.floor(sorted.length / 2)] ?? 0).toFixed(1), pictureMsTotal: Math.round(perPicture.reduce((a, b) => a + b, 0)),
    storageReadBytesPerPicture: bytes.byteLength, storageReadBytesForAllPictures: bytes.byteLength * shown.length, bytesToLearner: shown.reduce((n, v) => n + (v.bytes ?? 0), 0),
  });
}

// ── B: today's pipeline plus the canonical document and the display forms ────────────────────────────
async function scenarioB() {
  const { chunks, extraction } = await uploadPath();
  const { doc, reading } = await canonical();
  const shape = validateCanonical(doc);
  const markdown = toMarkdown(doc);
  const assetsDir = join(out, `${label}-assets`);
  mkdirSync(assetsDir, { recursive: true });
  const sharp = (await import("sharp")).default;
  const z = await openOfficeZip(bytes);
  if (!z.ok) throw new Error(z.reason);
  const rows: { id: string; class: string; width: number | null; format: string; originalBytes: number; kept: { width: number; bytes: number }[]; lossyBytes: number | null; notIdentical?: number; identicalPixels?: boolean }[] = [];
  await stage("assets", async () => {
    for (const a of doc.assets) {
      const original = a.representations[0];
      const plan = picturePlan({ class: a.class, width: original.width, format: original.format });
      const row = { id: a.id, class: a.class, width: original.width, format: original.format, originalBytes: original.bytes, kept: [] as { width: number; bytes: number }[], lossyBytes: null as number | null, notIdentical: undefined as number | undefined, identicalPixels: undefined as boolean | undefined };
      if (plan.display.length && original.path) {
        const data = await z.zip.file(original.path)!.async("nodebuffer");
        for (const d of plan.display) {
          const made = await sharp(data, { limitInputPixels: 100_000_000 }).resize({ width: d.width }).webp({ lossless: true, effort: 4 }).toBuffer();
          // A same-size form must be the same pixels, or it does not count as lossless.
          if (d.width === original.width) {
            const [x, y] = await Promise.all([sharp(data).ensureAlpha().raw().toBuffer(), sharp(made).ensureAlpha().raw().toBuffer()]);
            if (!x.equals(y)) { row.notIdentical = (row.notIdentical ?? 0) + 1; continue; }
            row.identicalPixels = true;
          }
          if (worthKeeping(made.byteLength, original.bytes)) {
            writeFileSync(join(assetsDir, `${a.id}-${d.width}.webp`), made);
            row.kept.push({ width: d.width, bytes: made.byteLength });
            a.representations.push({ role: "display", path: `${a.id}-${d.width}.webp`, sha256: createHash("sha256").update(made).digest("hex").slice(0, 16), bytes: made.byteLength, format: "webp", width: d.width, height: null, lossless: true, location: "stored" });
          }
        }
        // For comparison only: what a lossy form would have saved had the picture been known to be general. Never stored or served here.
        row.lossyBytes = (await sharp(data, { limitInputPixels: 100_000_000 }).resize({ width: Math.min(1280, original.width ?? 1280) }).webp({ quality: 80 }).toBuffer()).byteLength;
      }
      rows.push(row);
    }
  });
  const json = JSON.stringify(doc);
  writeFileSync(join(out, `${label}.canonical.json`), json);
  writeFileSync(join(out, `${label}.md`), markdown);
  dumpUnits(label, doc.units.map(u => ({ n: u.n, text: u.blocks.map(blockWords).join("\n"), notes: u.blocks.filter(b => b.type === "notes").map(blockWords).join("\n") })));
  const storedAssets = rows.flatMap(r => r.kept).reduce((n, k) => n + k.bytes, 0);
  const shown = doc.assets.filter(a => a.class !== "decorative");
  // The fewest bytes among the forms wide enough for the slot, the original included: never upscaled, never a larger file than the original.
  const smallestFor = (a: CanonicalAsset, px: number) => {
    const enough = a.representations.filter(r => (r.width ?? 0) >= px);
    return Math.min(...(enough.length ? enough : [chooseRepresentation(a.representations, px, 1)!]).map(r => r.bytes));
  };
  Object.assign(result, {
    slides: doc.units.length, chunks: chunks.length, extractedChars: extraction.pages.reduce((n, p) => n + normaliseText(p.text).length, 0), census: census(doc.units), shapeProblems: shape, quality: doc.quality,
    canonicalJsonBytes: Buffer.byteLength(json), canonicalJsonGzBytes: gz(json), markdownBytes: Buffer.byteLength(markdown), markdownGzBytes: gz(markdown),
    assets: rows, assetsStoredBytes: storedAssets, picturesOriginalBytes: shown.reduce((n, a) => n + a.representations[0].bytes, 0),
    picturesToSlot: Object.fromEntries([[358, 2], [358, 3], [720, 1], [720, 2]].map(([css, dpr]) => [`${css}@${dpr}x`, shown.reduce((n, a) => n + smallestFor(a, css * dpr), 0)])), lossyComparisonBytes: rows.reduce((n, r) => n + (r.lossyBytes ?? 0), 0),
    factsChecked: reading.facts.length,
  });
}

// ── B, repeat access: the stored forms are read and sent. No deck, no archive, no digest ──────────────
async function scenarioBView() {
  const t0 = performance.now();
  const doc = JSON.parse(readFileSync(join(out, rest[0] ?? "b.canonical.json"), "utf8")) as CanonicalDocument;
  const opened = performance.now() - t0;
  const section = doc.units.filter(u => u.n <= 4).map(u => u.blocks.map(blockWords).join("\n")).join("\n\n");
  const perPicture: number[] = [];
  for (const a of doc.assets) for (const r of a.representations) if (r.location === "stored" && r.path) {
    const t = performance.now();
    readFileSync(join(out, `${(rest[0] ?? "b.canonical.json").replace(".canonical.json", "")}-assets`, r.path));
    perPicture.push(performance.now() - t);
  }
  Object.assign(result, { openDocMs: +opened.toFixed(1), sectionChars: section.length, pictures: perPicture.length, pictureMsMedian: +([...perPicture].sort((a, b) => a - b)[Math.floor(perPicture.length / 2)] ?? 0).toFixed(2) });
}

// ── The rendering engine, whole deck, as it runs today ───────────────────────────────────────────────
async function scenarioRender() {
  const { draw } = await stage("choose", slidesWorthDrawing);
  const { copy, pageOf } = await stage("working_copy", () => workingCopy(null));
  const pdf = await stage("engine_pdf", () => deckToPdf(copy, 280_000));
  writeFileSync(join(out, `${label}.pdf`), pdf);
  const drawn = await stage("draw", () => drawPages(pdf, pageOf, draw, join(out, `${label}-pages`)));
  Object.assign(result, { draw, pdfBytes: pdf.byteLength, pageCount: drawn.pageCount, pages: drawn.rows, drawnBytes: drawn.rows.reduce((n, r) => n + r.bytes, 0), display640: drawn.rows.reduce((n, r) => n + (r.widths[640] ?? r.bytes), 0), display1280: drawn.rows.reduce((n, r) => n + (r.widths[1280] ?? r.bytes), 0) });
}

// ── Only the slides that need drawing go to the engine. Does a smaller deck ease the memory? ─────────
async function scenarioRenderSub() {
  const chosen = rest.length ? rest.map(Number) : (await stage("choose", slidesWorthDrawing)).draw;
  const { copy, pageOf } = await stage("working_copy", () => workingCopy(chosen));
  const pdf = await stage("engine_pdf", () => deckToPdf(copy, 280_000));
  writeFileSync(join(out, `${label}.pdf`), pdf);
  const drawn = await stage("draw", () => drawPages(pdf, pageOf, chosen, join(out, `${label}-pages`)));
  Object.assign(result, { draw: chosen, workingCopyBytes: copy.byteLength, pdfBytes: pdf.byteLength, pageCount: drawn.pageCount, pages: drawn.rows, drawnBytes: drawn.rows.reduce((n, r) => n + r.bytes, 0) });
}

// ── Page-level recovery from the kept PDF: no LibreOffice ────────────────────────────────────────────
async function scenarioRecoverPages() {
  const pdf = new Uint8Array(readFileSync(join(out, rest[0])));
  const want = rest.slice(1).map(Number);
  const z = await openOfficeZip(bytes);
  if (!z.ok) throw new Error(z.reason);
  const parts = slidePartNames(Object.keys(z.zip.files));
  const pageOf = slidePageMap(await z.zip.file("ppt/presentation.xml")!.async("string"), await z.zip.file("ppt/_rels/presentation.xml.rels")!.async("string"), parts)!;
  const drawn = await stage("draw", () => drawPages(pdf, pageOf, want, join(out, `${label}-pages`)));
  Object.assign(result, { draw: want, pages: drawn.rows });
}

// ── The kept PDF as a reader of last resort: one page per slide, its text layer ──────────────────────
async function pdfTextOf(pdf: Uint8Array) {
  const { getDocumentProxy, extractText } = await import("unpdf");
  const doc = await getDocumentProxy(pdf.slice());
  const { text } = await extractText(doc, { mergePages: false });
  await doc.cleanup().catch(() => {});
  return text as string[];
}
async function scenarioPdfText() {
  const pdf = new Uint8Array(readFileSync(join(out, rest[0])));
  const text = await stage("pdf_text", () => pdfTextOf(pdf));
  const z = await openOfficeZip(bytes);
  if (!z.ok) throw new Error(z.reason);
  const parts = slidePartNames(Object.keys(z.zip.files));
  const pageOf = slidePageMap(await z.zip.file("ppt/presentation.xml")!.async("string"), await z.zip.file("ppt/_rels/presentation.xml.rels")!.async("string"), parts)!;
  dumpUnits(label, parts.map((_, i) => ({ n: i + 1, text: text[pageOf.get(i + 1)! - 1] ?? "" })));
  Object.assign(result, { pages: text.length, chars: text.join("").length });
}

// ── D: the gateway with real engines and injected faults ─────────────────────────────────────────────
function fileStore(dir: string): ConversionStore & { hits: () => number } {
  mkdirSync(dir, { recursive: true });
  let hits = 0;
  const file = (key: string, kind: string) => join(dir, `${key.slice(0, 24)}.${kind}.json`);
  const held = new Set<string>();
  return {
    hits: () => hits,
    complete: async key => { if (!existsSync(file(key, "complete"))) return null; hits++; return JSON.parse(readFileSync(file(key, "complete"), "utf8")); },
    partial: async key => existsSync(file(key, "partial")) ? JSON.parse(readFileSync(file(key, "partial"), "utf8")) : null,
    savePartial: async (key, units, assets) => writeFileSync(file(key, "partial"), JSON.stringify({ units, assets })),
    saveComplete: async (key, doc) => writeFileSync(file(key, "complete"), JSON.stringify(doc)),
    claim: async key => { if (held.has(key)) return false; held.add(key); return true; },
    release: async key => { held.delete(key); },
  };
}

type Faults = { nativeThrows?: boolean; nativeFailsUnits?: readonly number[]; existingThrows?: boolean; existingFailsUnits?: readonly number[]; engineThrows?: boolean };

/** The real engines, each able to be made to fail. */
function adapters(faults: Faults, counts: Record<string, number>, keptPdf: { pdf: Uint8Array | null; pageOf: Map<number, number> | null }): Map<string, EngineAdapter> {
  const bump = (id: string) => { counts[id] = (counts[id] ?? 0) + 1; };
  const native: EngineAdapter = { id: "native_drawingml", convert: async input => {
    bump("native_drawingml");
    if (faults.nativeThrows) throw new EngineFailure("error", "injected");
    const r = await readDeck(input.bytes, "native_drawingml", input.units === "all" ? undefined : input.units);
    if (!r.ok) throw new EngineFailure("error", r.reason);
    const failing = new Set(faults.nativeFailsUnits ?? []);
    return { version: "pptx-canonical@1", assets: r.reading.assets, units: r.reading.units.map(u => failing.has(u.n) ? { ...u, status: "failed", blocks: [] } : u) };
  } };
  const existing: EngineAdapter = { id: "existing_drawingml", convert: async input => {
    bump("existing_drawingml");
    if (faults.existingThrows) throw new EngineFailure("error", "injected");
    const e = await extractMaterial(PPTX_MIME, input.bytes);
    if (!e.ok) throw new EngineFailure("error", e.reason);
    const wanted = input.units === "all" ? null : new Set(input.units);
    const failing = new Set(faults.existingFailsUnits ?? []);
    const units: CanonicalUnit[] = e.pages.filter(p => !wanted || wanted.has(p.page!)).map(p => ({
      n: p.page!, position: null, hidden: false, status: failing.has(p.page!) ? "failed" : "complete", engine: "existing_drawingml",
      blocks: failing.has(p.page!) || !normaliseText(p.text) ? [] : [{ type: "paragraph", text: normaliseText(p.text), source: { unit: p.page!, part: null, shapeId: null, shapeName: null, box: null, groupPath: [] } }],
    }));
    return { version: "pptx-drawingml@1", assets: [], units };
  } };
  const render: EngineAdapter = { id: "libreoffice_wasm_pdfium", convert: async input => {
    bump("libreoffice_wasm_pdfium");
    if (faults.engineThrows) throw new EngineFailure("error", "injected");
    const keep = input.units === "all" ? null : input.units;
    let pdf = keptPdf.pdf, pageOf = keptPdf.pageOf;
    if (!pdf || !pageOf) {
      const w = await workingCopy(keep);
      try { pdf = await deckToPdf(w.copy, input.budgetMs); } catch (e) {
        const code = e instanceof RenderError ? e.code as string : "engine_failed";
        throw new EngineFailure(code === "timed_out" ? "timeout" : code === "stalled" ? "stall" : code === "memory_low" ? "memory" : "error", code);
      }
      pageOf = w.pageOf;
    } else counts.pdf_reused = (counts.pdf_reused ?? 0) + 1;
    const text = await pdfTextOf(pdf);
    const units: CanonicalUnit[] = [...pageOf].filter(([n]) => !keep || keep.includes(n)).map(([n, page]) => ({
      n, position: null, hidden: false, status: "complete", engine: "libreoffice_wasm_pdfium",
      blocks: normaliseText(text[page - 1] ?? "") ? [{ type: "paragraph", text: normaliseText(text[page - 1] ?? ""), source: { unit: n, part: null, shapeId: null, shapeName: null, box: null, groupPath: [] } }] : [],
    }));
    return { version: "libreoffice-wasm-2.7.2", assets: [], units };
  } };
  return new Map([[native.id, native], [existing.id, existing], [render.id, render]]);
}

async function factsOf(): Promise<UnitFacts[]> {
  const z = await openOfficeZip(bytes);
  if (!z.ok) return [];
  const names = slidePartNames(Object.keys(z.zip.files));
  const out2: UnitFacts[] = [];
  for (const [i, name] of names.entries()) out2.push(slideFactsOf(i + 1, await z.zip.file(name)!.async("string")));
  return out2;
}

async function gatewayRun(faults: Faults, opts: { kept?: boolean; store?: string; scope?: string; repeat?: number; engineStatus?: EngineRecord["status"] } = {}) {
  const facts = await factsOf();
  const counts: Record<string, number> = {};
  const store = fileStore(join(out, opts.store ?? `${label}-store`));
  const keptPdf = { pdf: null as Uint8Array | null, pageOf: null as Map<number, number> | null };
  if (opts.kept) {
    keptPdf.pdf = new Uint8Array(readFileSync(join(out, "render-full.pdf")));
    keptPdf.pageOf = (await workingCopy(null)).pageOf;
  }
  // The rendering engine is registered as evaluated. For this test only it is active, in this process: nothing is written anywhere.
  const engines = SEED_ENGINES.map(e => e.id === "libreoffice_wasm_pdfium" ? { ...e, status: opts.engineStatus ?? "active" as const } : e);
  const breakers = new Map<string, Breaker>();
  const t = performance.now();
  const runs = [];
  for (let i = 0; i < (opts.repeat ?? 1); i++) {
    const r = await processDocument({
      bytes, sourceSha256: sourceSha, format: "pptx", mime: PPTX_MIME, unit: "slide", units: facts.length, scope: opts.scope ?? "poc", requirement: "text",
      pipelineVersion: PIPELINE, configVersion: 1, needs: ["text"], facts, budgetMs: 280_000, minRecall: 0.98,
    }, { engines, adapters: adapters(faults, counts, keptPdf), store, breakers, now: () => Date.now() });
    runs.push({ outcome: r.outcome, invocations: r.invocations, ...("log" in r ? { log: r.log.map(l => ({ engine: l.engine, role: l.role, ok: l.ok, reason: l.reason, units: l.units, ms: l.ms })), unresolved: r.unresolved } : {}),
      ...("doc" in r ? { byEngine: r.doc.units.reduce<Record<string, number>>((o, u) => { o[u.engine] = (o[u.engine] ?? 0) + 1; return o; }, {}), textRecall: r.doc.quality.textRecall, passed: r.doc.quality.passed, issues: r.doc.quality.issues.length } : {}) });
  }
  Object.assign(result, { ms: Math.round(performance.now() - t), invocationsByEngine: counts, runs, breakerAfter: Object.fromEntries([...breakers].map(([k, b]) => [k, { ...b, open: breakerHealth(b, Date.now()).open }])), newBreaker: NEW_BREAKER.failures });
}

// ── The engine alone, many times: how often does it stall here? With DIG_ENGINE_SRC=reliability, the paused SCHOLAR-VISUAL-001 watchdog is in the path. ──
async function scenarioEngineOnly() {
  const keep = rest.length ? rest.map(Number) : null;
  const { copy } = await workingCopy(keep);
  const t = performance.now();
  try {
    const pdf = await (deckToPdf as unknown as (b: Uint8Array, ms: number, o?: { stallAfterMs?: number }) => Promise<Uint8Array>)(copy, 280_000, process.env.DIG_STALL_AFTER_MS ? { stallAfterMs: Number(process.env.DIG_STALL_AFTER_MS) } : {});
    Object.assign(result, { engineMs: Math.round(performance.now() - t), outcome: "pdf", pdfBytes: pdf.byteLength });
  } catch (e) {
    Object.assign(result, { engineMs: Math.round(performance.now() - t), outcome: e instanceof RenderError ? e.code : String(e) });
  }
}

const SCENARIOS: Record<string, () => Promise<void>> = {
  "engine-only": scenarioEngineOnly,
  a: scenarioA, "a-view": scenarioAView, b: scenarioB, "b-view": scenarioBView, render: scenarioRender, "render-sub": scenarioRenderSub, "recover-pages": scenarioRecoverPages, "pdf-text": scenarioPdfText,
  "d-clean": () => gatewayRun({}),
  "d-reuse": () => gatewayRun({}, { repeat: 3 }),
  "d-other-scope": async () => { await gatewayRun({}, { store: "d-reuse-store", scope: "another-owner" }); },
  "d-native-fails": () => gatewayRun({ nativeThrows: true }),
  "d-three-slides": () => gatewayRun({ nativeFailsUnits: rest.map(Number) }),
  "d-three-slides-engine": () => gatewayRun({ nativeFailsUnits: rest.map(Number), existingFailsUnits: rest.map(Number) }),
  "d-three-slides-kept-pdf": () => gatewayRun({ nativeFailsUnits: rest.map(Number), existingFailsUnits: rest.map(Number) }, { kept: true }),
  "d-all-fail": () => gatewayRun({ nativeThrows: true, existingThrows: true, engineThrows: true }),
  "d-engine-off": () => gatewayRun({ nativeThrows: true, existingThrows: true }, { engineStatus: "evaluated" }),
  "d-breaker": () => gatewayRun({ nativeThrows: true, existingThrows: true, engineThrows: true }, { repeat: 6 }),
};

const run = SCENARIOS[scenario];
if (!run) { console.error(`unknown scenario ${scenario}`); process.exit(2); }
run().then(() => { result.ok = true; save(); process.exit(0); }, e => { result.ok = false; result.error = e instanceof Error ? `${e.name}: ${e.message}` : String(e); save(); console.error(result.error); process.exit(1); });
