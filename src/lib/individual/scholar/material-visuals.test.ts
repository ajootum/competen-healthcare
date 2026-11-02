import { describe, expect, it } from "vitest";
import {
  MIN_VISUAL_BYTES, canServeVisual, deckVisuals, decorativeReason, pagesOfCitation, parseVisualKey, pdfVisuals, slideMedia,
  visualUrl, visualsForPages, visualsForSections, type DeckScan, type PictureFact,
} from "./material-visuals";

// SCHOLAR-LESSON-VISUALS-01: which of a file's pictures count as content, deterministically and without AI.

const fact = (n: number, media: string, over: Partial<PictureFact> = {}): PictureFact =>
  ({ n, media, kind: "png", width: 800, height: 600, bytes: 50_000, sha: media.replace(/\W/g, "").padEnd(16, "0").slice(0, 16), ...over });
const scan = (slides: number, pictures: PictureFact[], undisplayable: DeckScan["undisplayable"] = []): DeckScan => ({ slides, pictures, undisplayable });

describe("the decorative filter", () => {
  it("drops a tiny icon, a tiny file, and a banner; keeps a normal picture", () => {
    expect(decorativeReason(fact(1, "a", { width: 60, height: 400 }), 120)).toBe("tiny");
    expect(decorativeReason(fact(1, "a", { bytes: MIN_VISUAL_BYTES - 1 }), 120)).toBe("small_file");
    expect(decorativeReason(fact(1, "a", { width: 2000, height: 200 }), 120)).toBe("banner");
    expect(decorativeReason(fact(1, "a", { width: 1000, height: 125 }), 120)).toBeNull(); // exactly 8:1 is allowed
    expect(decorativeReason(fact(1, "a"), 120)).toBeNull();
    expect(decorativeReason(fact(1, "a", { width: null, height: null }), 120)).toBeNull(); // unmeasured: not guessed away
  });
  it("the smallest side is held to the policy minimum (scholar_lesson_visuals_min_px)", () => {
    const s = scan(2, [fact(1, "ppt/media/a.png", { width: 200, height: 200 })]);
    expect(deckVisuals(s, { minPx: 120 }).visuals).toHaveLength(1);
    expect(deckVisuals(s, { minPx: 300 }).visuals).toHaveLength(0);
  });
  it("a picture repeated on three or more slides AND 40% of them is a logo; fewer, or a small share, is not", () => {
    const logo = (n: number) => fact(n, "ppt/media/logo.png");
    expect(deckVisuals(scan(5, [logo(1), logo(2), logo(3)])).visuals).toHaveLength(0); // 3 of 5 = 60%
    expect(deckVisuals(scan(4, [logo(1), logo(2)])).visuals).toHaveLength(2); // only two slides
    expect(deckVisuals(scan(20, [logo(1), logo(2), logo(3)])).visuals).toHaveLength(3); // 15% of 20
  });
  it("shows at most maxPerSlide per slide, largest first, and orders by slide", () => {
    const pics = [
      fact(2, "ppt/media/s.png", { width: 200, height: 200 }), fact(2, "ppt/media/l.png", { width: 1600, height: 900 }),
      fact(2, "ppt/media/m.png", { width: 800, height: 600 }), fact(2, "ppt/media/x.png", { width: 400, height: 300 }), fact(1, "ppt/media/one.png"),
    ];
    const r = deckVisuals(scan(6, pics), { maxPerSlide: 3 });
    expect(r.visuals.map(v => v.media)).toEqual(["ppt/media/one.png", "ppt/media/l.png", "ppt/media/m.png", "ppt/media/x.png"]);
    expect(deckVisuals(scan(6, pics), { maxPerSlide: 1 }).visuals.filter(v => v.n === 2)).toHaveLength(1);
  });
  it("EMF / WMF / SVG / unknown bytes are counted as not shown, never listed; a repeated one (a logo) is not counted", () => {
    const r = deckVisuals(scan(10, [fact(1, "ppt/media/ok.png"), fact(2, "ppt/media/bad.png", { kind: null })], [{ n: 3, media: "ppt/media/d.emf" }, { n: 4, media: null }]));
    expect(r.visuals.map(v => v.n)).toEqual([1]);
    expect(r.notShown).toBe(3);
    const logo = [1, 2, 3, 4].map(n => ({ n, media: "ppt/media/logo.emf" }));
    expect(deckVisuals(scan(5, [], logo)).notShown).toBe(0);
  });
  it("keys are the slide and the first 16 hex of the digest; the same picture twice on a slide is listed once", () => {
    const a = fact(3, "ppt/media/a.png", { sha: "0123456789abcdef" }), b = fact(3, "ppt/media/b.png", { sha: "0123456789abcdef" });
    const r = deckVisuals(scan(3, [a, b]));
    expect(r.visuals).toHaveLength(1);
    expect(r.visuals[0]).toMatchObject({ key: "3-0123456789abcdef", unit: "slide", decorative: false, aiRead: false });
  });
  it("marks a slide whose text was read by AI", () => {
    const r = deckVisuals(scan(3, [fact(2, "ppt/media/a.png")]), { aiRead: new Set([2]) });
    expect(r.visuals[0].aiRead).toBe(true);
  });
  it("is deterministic: the same scan gives the same list", () => {
    const s = scan(4, [fact(1, "ppt/media/b.png"), fact(1, "ppt/media/a.png"), fact(2, "ppt/media/c.png")]);
    expect(deckVisuals(s)).toEqual(deckVisuals(structuredClone(s)));
  });
});

describe("slide media from the slide's own relationships", () => {
  const IMG = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image";
  const rels = `<Relationships>${["rId1|../media/a.png", "rId2|../media/b.emf", "rId3|../media/c.svg"].map(x => `<Relationship Id="${x.split("|")[0]}" Type="${IMG}" Target="${x.split("|")[1]}"/>`).join("")}<Relationship Id="rId4" Type="${IMG}" Target="http://x/y.png" TargetMode="External"/></Relationships>`;
  const xml = `<p:sld>${["rId1", "rId2", "rId3", "rId4"].map(i => `<a:blip r:embed="${i}"/>`).join("")}</p:sld>`;
  it("lists the displayable pictures, the undisplayable parts and the linked count", () => {
    expect(slideMedia(xml, rels)).toEqual({ images: ["ppt/media/a.png"], undisplayable: ["ppt/media/b.emf", "ppt/media/c.svg"], linked: 1 });
    expect(slideMedia("<p:sld/>", null)).toEqual({ images: [], undisplayable: [], linked: 0 });
  });
});

describe("a PDF's visuals are its image-only pages", () => {
  it("one page card for each page with no text or read by AI; none for text pages", () => {
    const v = pdfVisuals({ emptyUnits: [7, 3], aiReadUnits: [3, 12] });
    expect(v.map(x => [x.key, x.n, x.kind, x.aiRead])).toEqual([["p3", 3, "pdf_page", true], ["p7", 7, "pdf_page", false], ["p12", 12, "pdf_page", true]]);
    expect(v.every(x => x.unit === "page" && x.media === null)).toBe(true);
    expect(pdfVisuals({})).toEqual([]);
  });
});

describe("visualsForPages and visualsForSections", () => {
  const all = deckVisuals(scan(9, [fact(2, "ppt/media/a.png"), fact(3, "ppt/media/b.png"), fact(3, "ppt/media/c.png", { width: 400, height: 300 }), fact(8, "ppt/media/d.png")])).visuals;
  it("returns the visuals of a slide range in order", () => {
    expect(visualsForPages(all, 3, 3).map(v => v.media)).toEqual(["ppt/media/b.png", "ppt/media/c.png"]);
    expect(visualsForPages(all, 2, 3)).toHaveLength(3);
    expect(visualsForPages(all, 4, 7)).toEqual([]);
    expect(visualsForPages(all, 8, null).map(v => v.n)).toEqual([8]);
    expect(visualsForPages(all, 3, 2).map(v => v.n)).toEqual([3, 3]); // a reversed range is one page
    expect(visualsForPages(all, null, null)).toEqual([]);
  });
  it("joins several sections without repeats", () => {
    expect(visualsForSections(all, [{ pageFrom: 2, pageTo: 3 }, { pageFrom: 3, pageTo: 3 }, { pageFrom: 8, pageTo: 8 }])).toHaveLength(4);
  });
});

describe("keys, URLs and citations", () => {
  it("only well-formed keys are looked up", () => {
    expect(parseVisualKey("3-0123456789abcdef")).toEqual({ kind: "slide", n: 3, sha: "0123456789abcdef" });
    expect(parseVisualKey("p12")).toEqual({ kind: "page", n: 12 });
    for (const bad of ["", "../x", "3-xyz", "3-0123456789ABCDEF", "p0", "0-0123456789abcdef", "p1/../2", "3-0123456789abcdef0"]) expect(parseVisualKey(bad)).toBeNull();
    expect(visualUrl("m1", "p3")).toBe("/api/individual/scholar/materials/m1/visuals/p3");
  });
  it("reads the unit and range from a citation; a Word section names none", () => {
    expect(pagesOfCitation("Respiratory deck, slide 12")).toEqual({ unit: "slide", from: 12, to: 12 });
    expect(pagesOfCitation("Notes, pages 3-4")).toEqual({ unit: "page", from: 3, to: 4 });
    expect(pagesOfCitation("Notes, section 2")).toBeNull();
  });
});

describe("who may be served", () => {
  const PPTX = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
  it("another person's material, or none, is not found; a Word file is not supported", () => {
    expect(canServeVisual(null, "u1")).toBe("not_found");
    expect(canServeVisual({ userId: "u2", mimeType: PPTX }, "u1")).toBe("not_found");
    expect(canServeVisual({ userId: "u1", mimeType: PPTX }, "u1")).toBe("ok");
    expect(canServeVisual({ mimeType: "application/pdf" }, "u1")).toBe("ok");
    expect(canServeVisual({ userId: "u1", mimeType: "text/plain" }, "u1")).toBe("not_supported");
  });
});
