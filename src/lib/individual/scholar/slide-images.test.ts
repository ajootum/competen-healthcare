import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import sharp from "sharp";
import { MAX_AI_SLIDES_PER_MATERIAL, hasReadableText, imageKind, mediaPart, parseRels, planChunkInsertion, planPictureSlides, slidePictures } from "./slide-images";
import { aiReadSlides, pictureSlideImages, qualitySummary, slidePartNames } from "./extract";
import { slideSkipReason } from "./slide-reading";
import { CONVERT_MAX_DIMENSION, MAX_CONVERT_INPUT_BYTES, convertToPng } from "./slide-convert";

// SCHOLAR-UPLOAD-FIX: the picture-only slide reader's pure parts -- which pictures, which slides, where the sections go.

const IMG = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image";
const rels = (...r: string[]) => `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${r.join("")}</Relationships>`;
const rel = (id: string, target: string, type = IMG, extra = "") => `<Relationship Id="${id}" Type="${type}" Target="${target}"${extra}/>`;
const slide = (...ids: string[]) => `<p:sld><p:cSld><p:spTree>${ids.map(id => `<p:pic><p:blipFill><a:blip r:embed="${id}"/></p:blipFill></p:pic>`).join("")}</p:spTree></p:cSld></p:sld>`;
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0]);

describe("slide pictures from the slide's own .rels", () => {
  it("reads image relationships by id, any attribute order, and marks linked ones", () => {
    const r = parseRels(rels(rel("rId2", "../media/image1.png"), `<Relationship Target="../notesSlides/notesSlide1.xml" Id="rId3" Type="http://x/relationships/notesSlide"/>`, rel("rId4", "http://example.org/a.png", IMG, ' TargetMode="External"')));
    expect(r.get("rId2")).toEqual({ target: "../media/image1.png", image: true, external: false });
    expect(r.get("rId3")?.image).toBe(false);
    expect(r.get("rId4")?.external).toBe(true);
  });
  it("only parts inside ppt/media are ever opened", () => {
    expect(mediaPart("../media/image1.png")).toBe("ppt/media/image1.png");
    expect(mediaPart("/ppt/media/image2.jpeg")).toBe("ppt/media/image2.jpeg");
    expect(mediaPart("../../../etc/passwd")).toBeNull();
    expect(mediaPart("../slides/slide2.xml")).toBeNull();
    expect(mediaPart("../media/sub/x.png")).toBeNull();
  });
  it("PNG and JPEG are used, in the order the slide shows them; EMF, WMF, SVG and linked pictures are said, not guessed", () => {
    const p = slidePictures(slide("rId5", "rId2", "rId3", "rId4", "rId6", "rId9"), rels(
      rel("rId2", "../media/image1.png"), rel("rId3", "../media/image2.emf"), rel("rId4", "../media/image3.svg"),
      rel("rId5", "../media/image4.JPG"), rel("rId6", "http://x/y.png", IMG, ' TargetMode="External"'), rel("rId7", "../media/unused.png"),
    ));
    expect(p.images).toEqual(["ppt/media/image4.JPG", "ppt/media/image1.png"]); // rId7 is not shown on the slide; rId9 has no relationship
    expect(p.unsupported).toEqual(["emf", "svg", "linked"]);
    expect(slidePictures(slide(), null)).toEqual({ images: [], unsupported: [] });
  });
  it("the bytes decide the kind, not the name", () => {
    expect(imageKind(PNG)).toBe("png");
    expect(imageKind(JPG)).toBe("jpeg");
    expect(imageKind(new Uint8Array([0x01, 0x00, 0x00, 0x00, 0, 0, 0, 0]))).toBeNull(); // an EMF header
  });
  it("TIFF (both byte orders), BMP, GIF and WebP are recognised by their magic bytes", () => {
    const pad = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    expect(imageKind(new Uint8Array([0x49, 0x49, 0x2a, 0x00, ...pad]))).toBe("tiff");
    expect(imageKind(new Uint8Array([0x4d, 0x4d, 0x00, 0x2a, ...pad]))).toBe("tiff");
    expect(imageKind(new Uint8Array([0x42, 0x4d, ...pad]))).toBe("bmp");
    expect(imageKind(new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, ...pad]))).toBe("gif");
    expect(imageKind(new Uint8Array([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50, ...pad]))).toBe("webp");
    expect(imageKind(new Uint8Array([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x41, 0x56, 0x45, ...pad]))).toBeNull(); // RIFF WAVE
    expect(imageKind(new Uint8Array([0x4d, 0x4d, 0x00, 0x2b, ...pad]))).toBeNull(); // BigTIFF is not claimed
  });
  it("tif / tiff / bmp / gif / webp are convertible; emf, wmf, svg and linked stay unsupported", () => {
    const names = ["tif", "tiff", "bmp", "gif", "webp", "emf", "wmf", "svg"];
    const p = slidePictures(slide(...names.map((_, i) => `rId${i + 1}`), "rId20"), rels(
      ...names.map((n, i) => rel(`rId${i + 1}`, `../media/image${i + 1}.${n}`)), rel("rId20", "http://x/y.tif", IMG, ' TargetMode="External"'),
    ));
    expect(p.images).toEqual(names.slice(0, 5).map((n, i) => `ppt/media/image${i + 1}.${n}`));
    expect(p.unsupported).toEqual(["emf", "wmf", "svg", "linked"]);
  });
});

describe("which slides may be read", () => {
  it("only slides recorded as empty, in order, never one attempted or one that has a section", () => {
    expect(planPictureSlides({ emptyUnits: [38, 33, 12], triedUnits: [12], slidesWithSections: [1, 2, 38] })).toEqual({ slides: [33], beyondCap: 0 });
  });
  it(`at most ${MAX_AI_SLIDES_PER_MATERIAL} per material, ever, counting earlier attempts`, () => {
    const empty = Array.from({ length: 15 }, (_, i) => i + 1);
    expect(planPictureSlides({ emptyUnits: empty })).toEqual({ slides: empty.slice(0, 10), beyondCap: 5 });
    expect(planPictureSlides({ emptyUnits: empty.slice(4), triedUnits: [1, 2, 3, 4] })).toEqual({ slides: [5, 6, 7, 8, 9, 10], beyondCap: 5 });
    expect(planPictureSlides({ emptyUnits: [11, 12], triedUnits: empty.slice(0, 10) }).slides).toEqual([]);
  });

  // The control can fail: a planner that also sends a slide that HAD text is caught by the same check.
  const onlyEmpty = (planner: typeof planPictureSlides) => {
    const cases: { emptyUnits: number[]; triedUnits?: number[]; slidesWithSections?: number[] }[] = [{ emptyUnits: [33, 38] }, { emptyUnits: [2], triedUnits: [5] }, { emptyUnits: [], slidesWithSections: [1, 2] }];
    return cases.every(c => planner(c).slides.every(s => c.emptyUnits.includes(s) && !(c.triedUnits ?? []).includes(s)));
  };
  it("the empty-slides-only check passes the real planner and goes red on a planted one", () => {
    expect(onlyEmpty(planPictureSlides)).toBe(true);
    const planted: typeof planPictureSlides = i => { const p = planPictureSlides(i); return { ...p, slides: [...p.slides, 1] }; };
    expect(onlyEmpty(planted)).toBe(false);
  });
});

describe("where the new sections go", () => {
  const existing = [
    { id: "a", ordinal: 1, pageFrom: 1 }, { id: "b", ordinal: 2, pageFrom: 1 }, { id: "c", ordinal: 3, pageFrom: 32 },
    { id: "d", ordinal: 4, pageFrom: 34 }, { id: "e", ordinal: 5, pageFrom: 39 },
  ];
  it("in slide order, existing ids kept, later ordinals only raised, moves last-first", () => {
    const p = planChunkInsertion(existing, [{ pageFrom: 38, pageTo: 38, content: "x38" }, { pageFrom: 33, pageTo: 33, content: "x33" }]);
    expect(p.inserts).toEqual([{ pageFrom: 33, pageTo: 33, content: "x33", ordinal: 4 }, { pageFrom: 38, pageTo: 38, content: "x38", ordinal: 6 }]);
    expect(p.moves).toEqual([{ id: "e", from: 5, to: 7 }, { id: "d", from: 4, to: 5 }]);
  });
  it("applied one row at a time, no two rows ever share an ordinal, and the result is in slide order", () => {
    const p = planChunkInsertion(existing, [{ pageFrom: 33, pageTo: 33, content: "x" }, { pageFrom: 38, pageTo: 38, content: "y" }, { pageFrom: 99, pageTo: 99, content: "z" }]);
    const at = new Map(existing.map(c => [c.id, c.ordinal]));
    for (const m of p.moves) {
      expect([...at.values()]).not.toContain(m.to);
      at.set(m.id, m.to);
    }
    for (const i of p.inserts) expect([...at.values()]).not.toContain(i.ordinal);
    const all = [...existing.map(c => ({ ord: at.get(c.id)!, page: c.pageFrom })), ...p.inserts.map(i => ({ ord: i.ordinal, page: i.pageFrom }))].sort((a, b) => a.ord - b.ord);
    expect(all.map(r => r.page)).toEqual([1, 1, 32, 33, 34, 38, 39, 99]);
  });
  it("with gaps already in the ordinals, nothing is lowered", () => {
    const p = planChunkInsertion([{ id: "a", ordinal: 1, pageFrom: 1 }, { id: "b", ordinal: 9, pageFrom: 5 }], [{ pageFrom: 3, pageTo: 3, content: "x" }]);
    expect(p).toEqual({ moves: [], inserts: [{ pageFrom: 3, pageTo: 3, content: "x", ordinal: 2 }] });
  });
});

describe("the transcription and the record", () => {
  it("figure or unreadable markers alone are no text to teach from", () => {
    expect(hasReadableText("[FIGURE: run chart]\n[UNREADABLE]")).toBe(false);
    expect(hasReadableText("PDSA cycle\n[FIGURE: cycle diagram]")).toBe(true);
  });
  it("sections read by AI are labelled, and the summary says so every time", () => {
    const q = { unit: "slide" as const, units: 49, emptyUnits: [38], chars: 100, sections: 48, aiReadUnits: [33], aiTriedUnits: [33] };
    expect([...aiReadSlides(q)].sort()).toEqual([33, 38]); // a section on a slide still recorded empty can only be AI-read
    expect(qualitySummary(q).text).toContain("Slide 33 was read by AI from a picture: check it against the slide.");
    expect(qualitySummary({ ...q, emptyUnits: [] }).partial).toBe(false);
    expect(aiReadSlides({ unit: "page", units: 3, emptyUnits: [2], chars: 1, sections: 1 }).size).toBe(0);
  });
  it("a slide with no usable picture is skipped with its reason", () => {
    expect(slideSkipReason({ slide: 3, images: [], unsupported: ["emf"], tooLarge: false })).toBe("unsupported");
    expect(slideSkipReason({ slide: 3, images: [], unsupported: [], tooLarge: true })).toBe("too_large");
    expect(slideSkipReason({ slide: 3, images: [], unsupported: [], tooLarge: false })).toBe("no_picture");
    expect(slideSkipReason({ slide: 3, images: [{ bytes: PNG, kind: "png" }], unsupported: ["emf"], tooLarge: false })).toBeNull();
  });
});

describe("converting a picture to PNG", () => {
  const raw = (w: number, h: number) => ({ create: { width: w, height: h, channels: 3 as const, background: "#336699" } });
  it("a TIFF becomes a PNG no larger than 2000 px, never enlarged", async () => {
    const tiff = await sharp(raw(3000, 1500)).tiff().toBuffer();
    expect(imageKind(tiff)).toBe("tiff");
    const png = await convertToPng(tiff);
    expect(png).not.toBeNull();
    expect(imageKind(png!)).toBe("png");
    const m = await sharp(png!).metadata();
    expect(Math.max(m.width!, m.height!)).toBeLessThanOrEqual(CONVERT_MAX_DIMENSION);
    expect([m.width, m.height]).toEqual([2000, 1000]);
    const small = await convertToPng(await sharp(raw(40, 30)).tiff().toBuffer());
    expect((await sharp(small!).metadata()).width).toBe(40);
  });
  it("GIF, BMP and WebP convert too; garbage and oversized input are refused, not thrown", async () => {
    for (const buf of [await sharp(raw(20, 20)).gif().toBuffer(), await sharp(raw(20, 20)).webp().toBuffer()]) expect(imageKind((await convertToPng(buf))!)).toBe("png");
    expect(await convertToPng(new Uint8Array([0x4d, 0x4d, 0x00, 0x2a, 1, 2, 3, 4, 5, 6]))).toBeNull();
    expect(await convertToPng(new Uint8Array(MAX_CONVERT_INPUT_BYTES + 1))).toBeNull();
  });
});

describe("from a real .pptx archive", () => {
  it("slide N is the Nth slide part by number, as the extractor numbers it; its pictures resolve through its .rels", async () => {
    const zip = new JSZip();
    zip.file("[Content_Types].xml", "<Types/>");
    zip.file("ppt/presentation.xml", "<p:presentation/>");
    zip.file("ppt/slides/slide1.xml", "<p:sld><a:p><a:t>Hello</a:t></a:p></p:sld>");
    zip.file("ppt/slides/slide10.xml", slide("rId2"));
    zip.file("ppt/slides/slide2.xml", slide("rId2", "rId3"));
    zip.file("ppt/slides/_rels/slide2.xml.rels", rels(rel("rId2", "../media/image1.jpeg"), rel("rId3", "../media/image2.wmf")));
    zip.file("ppt/slides/_rels/slide10.xml.rels", rels(rel("rId2", "../media/image3.png")));
    zip.file("ppt/media/image1.jpeg", JPG);
    zip.file("ppt/media/image2.wmf", new Uint8Array([0xd7, 0xcd, 0xc6, 0x9a]));
    zip.file("ppt/media/image3.png", new Uint8Array([0x00, 0x01, 0x02, 0x03])); // named .png, not a PNG
    const bytes = await zip.generateAsync({ type: "uint8array" });
    expect(slidePartNames(Object.keys(zip.files))).toEqual(["ppt/slides/slide1.xml", "ppt/slides/slide2.xml", "ppt/slides/slide10.xml"]);
    const r = await pictureSlideImages(bytes, [2, 3, 7]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.slides.map(s => ({ slide: s.slide, kinds: s.images.map(i => i.kind), unsupported: s.unsupported }))).toEqual([
      { slide: 2, kinds: ["jpeg"], unsupported: ["wmf"] },
      { slide: 3, kinds: [], unsupported: ["png"] },
      { slide: 7, kinds: [], unsupported: [] },
    ]);
  });
});
