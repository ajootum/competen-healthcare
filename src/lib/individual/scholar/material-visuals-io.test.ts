import { beforeEach, describe, expect, it, vi } from "vitest";
import { randomBytes } from "node:crypto";
import JSZip from "jszip";
import sharp from "sharp";
import { PDFDocument } from "pdf-lib";
import { PDF_MIME, PPTX_MIME } from "./config";

// SCHOLAR-LESSON-VISUALS-01: the visuals routes' service, end to end over a real generated presentation. The store reads are
// keyed on the caller (as in production): learner B asking for learner A's material gets a plain 404 and no file is read.

const h = vi.hoisted(() => ({
  A: "aaaaaaaa-0000-4000-8000-00000000000a", B: "bbbbbbbb-0000-4000-8000-00000000000b",
  PPTX_ID: "aaaaaaaa-0000-4000-8000-0000000000a1", PDF_ID: "aaaaaaaa-0000-4000-8000-0000000000a2", DOCX_ID: "aaaaaaaa-0000-4000-8000-0000000000a3",
  files: new Map<string, Uint8Array>(), reads: [] as string[], policy: { on: true }, quality: { emptyUnits: [2], aiReadUnits: [5] } as { emptyUnits: number[]; aiReadUnits: number[] },
  classify: "on" as "on" | "off",
  chunks: [] as { id: string; ordinal: number; pageFrom: number; pageTo: number; content: string }[],
}));
vi.mock("./store", async orig => {
  const real = await orig<typeof import("./store")>();
  const rows: Record<string, { mimeType: string; byteSize: number }> = {
    [h.PPTX_ID]: { mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation", byteSize: 1 },
    [h.PDF_ID]: { mimeType: "application/pdf", byteSize: 1 },
    [h.DOCX_ID]: { mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", byteSize: 1 },
  };
  return {
    ...real,
    // Only learner A owns these rows.
    getMaterial: async (_a: unknown, userId: string, id: string) => ({ ok: true, data: userId === h.A && rows[id] ? { id, title: "Deck", fileName: "d", pageCount: null, chunkCount: 1, createdAt: "2026-11-01T00:00:00Z", ...rows[id] } : null }),
    materialExtras: async (_a: unknown, userId: string, ids: string[]) => ({ qualityOn: true, collectionsOn: true, byId: new Map(ids.map(id => [id, { collectionId: null, quality: userId === h.A ? { unit: "slide", units: 9, sections: 1, chars: 1, ...h.quality } : null }])) }),
    listChunks: async (_a: unknown, userId: string) => ({ ok: true, data: userId === h.A ? h.chunks : [] }),
    materialBytes: async (_a: unknown, userId: string, id: string) => { h.reads.push(`${userId}:${id}`); return userId === h.A ? h.files.get(id) ?? null : null; },
  };
});
vi.mock("../policy", async orig => {
  const real = await orig<typeof import("../policy")>();
  return { ...real, loadIndividualPolicy: async () => ({ ...real.resolvePolicy([]), scholarLessonVisuals: h.policy.on ? "on" : "off", scholarVisualClassify: h.classify }) };
});

const { A, B, PPTX_ID, PDF_ID, DOCX_ID } = h;
import { clearVisualsCache, materialVisualFile, materialVisuals } from "./material-visuals-io";

const noise = (w: number, hgt: number) => sharp(randomBytes(w * hgt * 3), { raw: { width: w, height: hgt, channels: 3 } });
const IMG = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image";

async function buildDeck(): Promise<{ bytes: Uint8Array; photoSha: string }> {
  const photo = await noise(300, 200).png().toBuffer();
  const icon = await noise(40, 40).png().toBuffer();
  const logo = await noise(200, 200).png().toBuffer();
  const banner = await noise(1600, 100).png().toBuffer();
  const tif = await noise(160, 120).tiff().toBuffer();
  const zip = new JSZip();
  zip.file("ppt/presentation.xml", "<p/>");
  const media: Record<string, Uint8Array | Buffer> = { "photo.png": photo, "icon.png": icon, "logo.png": logo, "banner.png": banner, "scan.tif": tif, "vector.emf": randomBytes(6000) };
  for (const [k, v] of Object.entries(media)) zip.file(`ppt/media/${k}`, v);
  const slideUses: string[][] = [["logo.png", "photo.png", "icon.png"], ["logo.png", "vector.emf", "banner.png"], ["logo.png", "scan.tif"], ["logo.png"]];
  slideUses.forEach((uses, i) => {
    zip.file(`ppt/slides/slide${i + 1}.xml`, `<p:sld>${uses.map((_, j) => `<a:blip r:embed="rId${j + 1}"/>`).join("")}</p:sld>`);
    zip.file(`ppt/slides/_rels/slide${i + 1}.xml.rels`, `<Relationships>${uses.map((u, j) => `<Relationship Id="rId${j + 1}" Type="${IMG}" Target="../media/${u}"/>`).join("")}</Relationships>`);
  });
  const { createHash } = await import("node:crypto");
  return { bytes: new Uint8Array(await zip.generateAsync({ type: "uint8array" })), photoSha: createHash("sha256").update(photo).digest("hex").slice(0, 16) };
}

const ctx = (userId: string) => ({ admin: {}, userId }) as never;
let photoSha = "";
let jpeg: Buffer = Buffer.alloc(0);
beforeEach(async () => {
  h.reads.length = 0; h.policy.on = true; h.classify = "on"; h.quality = { emptyUnits: [2], aiReadUnits: [5] };
  clearVisualsCache();
  const deck = await buildDeck();
  photoSha = deck.photoSha;
  h.files.set(PPTX_ID, deck.bytes);
  const pdf = await PDFDocument.create();
  for (let i = 0; i < 6; i++) pdf.addPage([960, 540]);
  jpeg = await sharp(randomBytes(300 * 200 * 3), { raw: { width: 300, height: 200, channels: 3 } }).jpeg({ quality: 90 }).toBuffer();
  pdf.getPage(0).drawImage(await pdf.embedJpg(jpeg), { x: 0, y: 0, width: 300, height: 200 });
  h.files.set(PDF_ID, new Uint8Array(await pdf.save()));
  h.chunks = [
    { id: "c1", ordinal: 1, pageFrom: 1, pageTo: 1, content: "NEWS Observation Chart" },
    { id: "c5", ordinal: 2, pageFrom: 5, pageTo: 5, content: "Early warning scores detect deterioration in adult patients. Each observation is given a score and the scores are added together. A higher total means a greater risk and a faster response. Staff should escalate according to local policy and record the outcome, and review the patient again soon after." },
  ];
});

describe("GET visuals", () => {
  it("lists a presentation's content pictures: the logo, icon and banner are left out, the vector is counted, nothing is invented", async () => {
    const r = await materialVisuals(ctx(A), PPTX_ID);
    expect(r.status).toBe(200);
    const body = r.body as { unit: string; visuals: { key: string; n: number; media: string; kind: string; aiRead: boolean }[]; notShown: number };
    expect(body.unit).toBe("slide");
    expect(body.visuals.map(v => [v.n, v.media, v.kind])).toEqual([[1, "ppt/media/photo.png", "png"], [3, "ppt/media/scan.tif", "tiff"]]);
    expect(body.visuals[0].key).toBe(`1-${photoSha}`);
    expect(body.notShown).toBe(1); // the EMF on slide 2
  });
  it("a PDF's visuals are its pictures and its image-only pages, each classified from the stored text", async () => {
    const r = await materialVisuals(ctx(A), PDF_ID);
    const body = r.body as { unit: string; visuals: { key: string; n: number; kind: string; aiRead: boolean; category: string; behaviour: string; label: string; caption: string }[] };
    expect(body.unit).toBe("page");
    expect(body.visuals.map(v => [v.n, v.kind, v.aiRead, v.category, v.behaviour])).toEqual([
      [1, "jpeg", false, "visual", "image"], [2, "pdf_page", false, "visual", "image"], [5, "pdf_page", true, "text_picture", "text"],
    ]);
    expect(body.visuals[0]).toMatchObject({ label: "Observation chart or scoring tool", caption: "NEWS Observation Chart · page 1" });
    expect(body.visuals[0].key).toMatch(/^p1-[0-9a-f]{16}$/);
  });
  it("classification off: the same pictures, all simply shown", async () => {
    h.classify = "off";
    const body = (await materialVisuals(ctx(A), PDF_ID)).body as { visuals: { category: string; behaviour: string }[] };
    expect(body.visuals.every(v => v.category === "visual" && v.behaviour === "image")).toBe(true);
  });
  it("another person's material is a plain 404 and no file is read", async () => {
    const r = await materialVisuals(ctx(B), PPTX_ID);
    expect(r.status).toBe(404);
    expect(h.reads).toEqual([]);
    expect((await materialVisuals(ctx(A), "aaaaaaaa-0000-4000-8000-0000000000ff")).status).toBe(404);
  });
  it("policy off answers an empty list marked off; a Word file has no pictures here", async () => {
    h.policy.on = false;
    expect((await materialVisuals(ctx(A), PPTX_ID)).body).toEqual({ visuals: [], off: true });
    h.policy.on = true;
    expect((await materialVisuals(ctx(A), DOCX_ID)).body).toMatchObject({ visuals: [] });
  });
  it("caches the measured presentation: a second list reads the file once", async () => {
    await materialVisuals(ctx(A), PPTX_ID);
    await materialVisuals(ctx(A), PPTX_ID);
    expect(h.reads).toHaveLength(1);
  });
});

describe("GET visuals/[key]", () => {
  it("serves the ORIGINAL bytes of a PNG, unmodified", async () => {
    const f = await materialVisualFile(ctx(A), PPTX_ID, `1-${photoSha}`);
    expect(f.status).toBe(200);
    expect(f.type).toBe("image/png");
    const meta = await sharp(f.bytes as Uint8Array).metadata();
    expect([meta.width, meta.height]).toEqual([300, 200]);
    const { createHash } = await import("node:crypto");
    expect(createHash("sha256").update(f.bytes as Uint8Array).digest("hex").slice(0, 16)).toBe(photoSha);
    expect(f.maxAge).toBe("immutable");
  });
  it("a TIFF becomes lossless PNG at its own size", async () => {
    const list = (await materialVisuals(ctx(A), PPTX_ID)).body as { visuals: { key: string }[] };
    const f = await materialVisualFile(ctx(A), PPTX_ID, list.visuals[1].key);
    expect(f.type).toBe("image/png");
    const meta = await sharp(f.bytes as Uint8Array).metadata();
    expect([meta.format, meta.width, meta.height]).toEqual(["png", 160, 120]);
  });
  it("a picture inside a PDF is served in its original form, byte for byte", async () => {
    const list = (await materialVisuals(ctx(A), PDF_ID)).body as { visuals: { key: string }[] };
    const f = await materialVisualFile(ctx(A), PDF_ID, list.visuals[0].key);
    expect(f).toMatchObject({ status: 200, type: "image/jpeg", maxAge: "immutable" });
    expect(Buffer.from(f.bytes as Uint8Array).equals(jpeg)).toBe(true);
  });
  it("a PDF page is that page alone, as a PDF", async () => {
    const f = await materialVisualFile(ctx(A), PDF_ID, "p5");
    expect(f).toMatchObject({ status: 200, type: "application/pdf", maxAge: "short" });
    expect((await PDFDocument.load(f.bytes as Uint8Array)).getPageCount()).toBe(1);
    expect((await materialVisualFile(ctx(A), PDF_ID, "p3")).status).toBe(404); // a text page is not a visual
  });
  it("another person, a decorative picture, a wrong digest and a malformed key are all 404", async () => {
    expect((await materialVisualFile(ctx(B), PPTX_ID, `1-${photoSha}`)).status).toBe(404);
    expect(h.reads.filter(r => r.startsWith(B))).toEqual([]);
    expect((await materialVisualFile(ctx(A), PPTX_ID, "1-0000000000000000")).status).toBe(404);
    expect((await materialVisualFile(ctx(A), PPTX_ID, "../../etc/passwd")).status).toBe(404);
    expect((await materialVisualFile(ctx(A), PPTX_ID, `2-${photoSha}`)).status).toBe(404);
  });
  it("policy off serves nothing", async () => {
    h.policy.on = false;
    expect((await materialVisualFile(ctx(A), PPTX_ID, `1-${photoSha}`)).status).toBe(404);
  });
});

describe("constants the routes depend on", () => {
  it("the material types match config", () => {
    expect(PDF_MIME).toBe("application/pdf");
    expect(PPTX_MIME).toContain("presentationml");
  });
});
