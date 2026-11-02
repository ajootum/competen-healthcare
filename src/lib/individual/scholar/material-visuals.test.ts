import { describe, expect, it } from "vitest";
import {
  KEEP_PICTURE_NOTE, LABEL_CHART, LABEL_CLINICAL, LABEL_DIAGRAM, LABEL_SCORING, LABEL_TABLE, arrangeStrip, buildVisuals, classifyPage, effectiveBehaviour, isProse, labelOf, pageInfoOf, plannedPages,
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
    expect(parseVisualKey("p12")).toEqual({ kind: "page", n: 12, sha: null });
    expect(parseVisualKey("p12-0123456789abcdef")).toEqual({ kind: "page", n: 12, sha: "0123456789abcdef" });
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

// ── SCHOLAR-VISUAL-CLASSIFY-01 ───────────────────────────────────────────────────────────────────────────────────────

const PROSE = "Early warning scores are used to detect deterioration in adult patients. Each observation is given a score, and the scores are added together. A higher total means a greater risk and a faster response is needed. Staff should escalate according to their local policy and record the outcome.";
const TABLE = ["NEWS2 scoring table", "Respiration rate 12-20 : 0", "SpO2 96+ : 0", "Systolic BP 111-219 : 0", "Pulse 51-90 : 0", "Temp 36.1-38.0 : 0"].join("\n");

describe("classifying a page from its own text", () => {
  it("labels from keywords in the page's own title: NEWS, PEWS and ADDS stay distinct by their own titles", () => {
    expect(labelOf("NEWS Observation Chart")).toBe(LABEL_SCORING);
    expect(labelOf("Pediatric Early Warning Score (PEWS)")).toBe(LABEL_SCORING);
    expect(labelOf("ADDS")).toBe(LABEL_SCORING);
    expect(labelOf("Summary table of drugs")).toBe(LABEL_TABLE);
    expect(labelOf("Survival From Cardiac Arrest")).toBe(LABEL_CHART);
    expect(labelOf("Chest x-ray findings")).toBe(LABEL_CLINICAL);
    expect(labelOf("The nursing process")).toBe(LABEL_DIAGRAM);
  });
  it("a title-only page with a picture is a visual shown as an image, captioned with its own title", () => {
    const info = pageInfoOf([{ pageFrom: 23, content: "NEWS Observation Chart" }], [], []);
    expect(classifyPage(info.get(23))).toMatchObject({ category: "visual", behaviour: "image", label: LABEL_SCORING, title: "NEWS Observation Chart", hasText: false });
    const r = buildVisuals({ slides: 40, pictures: [fact(23, "x1", { sha: "aaaaaaaaaaaaaaaa" })], undisplayable: [] }, { unit: "page", pages: info });
    expect(r.visuals[0]).toMatchObject({ key: "p23-aaaaaaaaaaaaaaaa", caption: "NEWS Observation Chart · page 23", behaviour: "image", safeText: null });
  });
  it("strips a bullet from the title", () => {
    expect(classifyPage({ text: "• Respiratory Rate", textLayer: true, aiRead: false }).title).toBe("Respiratory Rate");
  });
  it("a textless page whose existing reading is prose is a picture of text: the section text teaches", () => {
    const info = pageInfoOf([{ pageFrom: 5, content: PROSE }], [], [5]);
    expect(isProse(PROSE, 40)).toBe(true);
    expect(classifyPage(info.get(5), 40)).toMatchObject({ category: "text_picture", behaviour: "text", hasText: true });
  });
  it("prose needs enough words, few digits and two sentences", () => {
    expect(isProse("Too short. Really.", 40)).toBe(false);
    expect(isProse(PROSE, 200)).toBe(false);
    expect(isProse(`${"12 34 56 78 ".repeat(20)}. And. Again.`, 10)).toBe(false);
    expect(isProse(PROSE.replace(/\. /g, ", ").replace(/\.$/, ""), 20)).toBe(false); // one sentence
  });
  it("a textless page whose reading is a table of numbers is mixed: the picture first, the text behind a warning", () => {
    const info = pageInfoOf([{ pageFrom: 9, content: TABLE }], [9], [9]);
    expect(classifyPage(info.get(9))).toMatchObject({ category: "mixed", behaviour: "both", label: LABEL_SCORING });
    const r = buildVisuals({ slides: 20, pictures: [fact(9, "x9", { sha: "bbbbbbbbbbbbbbbb" })], undisplayable: [] }, { unit: "page", pages: info, aiRead: new Set([9]), emptyUnits: [9] });
    expect(r.visuals[0].aiRead).toBe(true);
    expect(r.visuals[0].safeText).toContain("Respiration rate");
  });
  it("the AI-read text of an ordinary diagram page is not set aside as chart text", () => {
    const info = pageInfoOf([{ pageFrom: 9, content: ["Airway", "Breathing 12 20 25", "Circulation 90 100"].join("\n") }], [9], [9]);
    const r = buildVisuals({ slides: 20, pictures: [fact(9, "x9")], undisplayable: [] }, { unit: "page", pages: info, aiRead: new Set([9]), emptyUnits: [9] });
    expect(r.visuals[0]).toMatchObject({ category: "mixed", behaviour: "both", safeText: null });
  });
  it("a page with a text layer of 150 characters or more and a picture is mixed", () => {
    const info = pageInfoOf([{ pageFrom: 3, content: "Oxygen therapy".padEnd(200, "x") }], [], []);
    expect(classifyPage(info.get(3))).toMatchObject({ category: "mixed", behaviour: "both", hasText: true });
  });
  it("a textless page not yet read is a visual with no text", () => {
    expect(classifyPage(pageInfoOf([], [26], []).get(26))).toMatchObject({ category: "visual", behaviour: "image", hasText: false });
    expect(classifyPage(undefined)).toMatchObject({ category: "visual", behaviour: "image" });
  });
  it("a 898x89 banner is decorative, and a textless page that yields no picture is itself the visual", () => {
    const banner = fact(24, "x76", { width: 898, height: 89 });
    const r = buildVisuals({ slides: 40, pictures: [banner], undisplayable: [] }, { unit: "page", emptyUnits: [24] });
    expect(r.visuals.map(v => [v.key, v.kind])).toEqual([["p24", "pdf_page"]]);
    expect(buildVisuals({ slides: 40, pictures: [banner], undisplayable: [] }, { unit: "page" }).visuals).toEqual([]);
  });
  it("an image the browser cannot be handed is stood for by its page, once", () => {
    const jpx = (m: string) => fact(7, m, { kind: null, via: "page", sha: m.padEnd(16, "0").slice(0, 16) });
    const r = buildVisuals({ slides: 40, pictures: [jpx("x1"), jpx("x2")], undisplayable: [] }, { unit: "page" });
    expect(r.visuals.map(v => v.key)).toEqual(["p7"]);
    expect(r.notShown).toBe(0);
  });
  it("classification off: every picture simply shown", () => {
    const info = pageInfoOf([{ pageFrom: 5, content: PROSE }], [], [5]);
    const r = buildVisuals({ slides: 6, pictures: [fact(5, "x5")], undisplayable: [] }, { unit: "page", pages: info, aiRead: new Set([5]), classify: false });
    expect(r.visuals[0]).toMatchObject({ category: "visual", behaviour: "image", label: LABEL_DIAGRAM, safeText: null });
  });
});

describe("the learner's override and the lesson strip", () => {
  const v = (n: number, behaviour: "image" | "text" | "both") => ({ n, behaviour, key: `p${n}` }) as never;
  it("an override replaces each picture's own behaviour; null keeps it", () => {
    expect(effectiveBehaviour({ behaviour: "text" }, null)).toBe("text");
    expect(effectiveBehaviour({ behaviour: "text" }, "both")).toBe("both");
  });
  it("shows image and both pictures in page order up to the maximum; text ones are kept apart as links", () => {
    const list = [v(1, "text"), v(2, "image"), v(3, "both"), v(4, "image"), v(5, "image")];
    const r = arrangeStrip(list, null, 3);
    expect(r.shown.map(x => x.n)).toEqual([2, 3, 4]);
    expect(r.more).toBe(1);
    expect(r.textOnly.map(x => x.n)).toEqual([1]);
    expect(arrangeStrip(list, "text", 3)).toMatchObject({ shown: [], more: 0 });
    expect(arrangeStrip(list, "image", 10).textOnly).toEqual([]);
  });
});

describe("the recovery card's page list", () => {
  it("labels each planned page from the index; a chart or table page is unticked by default", () => {
    const info = pageInfoOf([{ pageFrom: 9, content: "NEWS2 scoring table" }, { pageFrom: 12, content: "Summary table" }], [26], []);
    const list = plannedPages([9, 12, 26], info, "page");
    expect(list.map(p => [p.n, p.label, p.keep])).toEqual([[9, LABEL_SCORING, true], [12, LABEL_TABLE, true], [26, LABEL_DIAGRAM, false]]);
    expect(list[2].caption).toBe("Page 26 · Diagram or picture");
    expect(plannedPages([3], new Map(), "slide")[0].caption).toBe("Slide 3 · Diagram or picture");
    expect(KEEP_PICTURE_NOTE).toContain("scores and thresholds are not read from charts");
  });
  it("Deterioration.pdf layout: a textless page next to chart pages is kept as a picture; research screenshots stay ticked", () => {
    const sections = [
      { pageFrom: 6, content: "How Do Patients Deteriorate • Patients admitted to hospital" }, { pageFrom: 9, content: "Vital Signs • Vital signs monitoring" },
      { pageFrom: 10, content: "• Respiratory Rate • Heart rate • Age" }, { pageFrom: 12, content: "Recognizing patient deterioration" },
      { pageFrom: 25, content: "NEWS Observation Chart" }, { pageFrom: 27, content: "Clinical Response to NEWS Triggers" },
      { pageFrom: 35, content: "Pediatric Early Warning Score (PEWS)" }, { pageFrom: 37, content: "ADDS" },
    ];
    const list = plannedPages([7, 8, 11, 26, 36], pageInfoOf(sections, [7, 8, 11, 26, 36], []), "page");
    expect(list.map(p => [p.n, p.keep])).toEqual([[7, false], [8, false], [11, false], [26, true], [36, true]]);
    expect(list[3].caption).toBe("Page 26 · Likely an observation chart, scoring tool or table (next to page 25)");
    expect(list[4].caption).toBe("Page 36 · Likely an observation chart, scoring tool or table (next to page 35)");
    expect(list.map(p => p.caption).join(" ")).not.toMatch(/\bNEWS|PEWS|ADDS\b/);
  });
});
