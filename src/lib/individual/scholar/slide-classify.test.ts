import { describe, expect, it } from "vitest";
import type { ExtractionQuality } from "./extract";
import { qualitySummary } from "./extract";
import { applySlideFacts, buildSlideFacts, pictureReadingInput, readingAttention, slideContent, slideCounts, slideExtracts, slideRows, slideSummary, type SlideStructure } from "./slide-classify";
import { planPictureSlides } from "./slide-images";

const REL_PNG = `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.png"/>`;
const RELS = `<Relationships>${REL_PNG}</Relationships>`;
const REL_EMF = `<Relationships><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.emf"/></Relationships>`;
const PH = `<p:sp><p:nvSpPr><p:nvPr><p:ph type="body"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:p><a:endParaRPr/></a:p></p:txBody></p:sp>`;
const PIC = `<p:pic><p:blipFill><a:blip r:embed="rId2"/></p:blipFill></p:pic>`;
const DRAWN = `<p:sp><p:nvSpPr><p:nvPr/></p:nvSpPr><p:spPr><a:prstGeom prst="rect"/></p:spPr></p:sp>`;
const INVISIBLE = `<p:sp><p:nvSpPr><p:nvPr/></p:nvSpPr><p:spPr><a:prstGeom prst="rect"/><a:noFill/><a:ln><a:noFill/></a:ln></p:spPr></p:sp>`;
const group = (inner: string) => `<p:grpSp><p:grpSpPr/>${inner}</p:grpSp>`;
const frame = (uri: string) => `<p:graphicFrame><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/${uri}"/></a:graphic></p:graphicFrame>`;
const slide = (body: string) => `<p:sld><p:cSld><p:spTree>${body}</p:spTree></p:cSld></p:sld>`;
const AT = "2026-11-06T00:00:00.000Z";

const blank = (s: SlideStructure) => buildSlideFacts([s], new Set(), AT).blank.includes(s.slide);

describe("what a slide holds", () => {
  it("⚠ two empty placeholders are blank", () => {
    expect(blank(slideContent(37, slide(PH + PH), null, false))).toBe(true);
    expect(blank(slideContent(1, slide(""), null, false))).toBe(true);
    expect(blank(slideContent(1, slide(INVISIBLE), null, false))).toBe(true);
  });
  it("⚠ never calls a slide blank while it holds anything else", () => {
    for (const body of [PIC, group(PIC), group(group(PIC)), group(DRAWN), DRAWN, frame("chart"), frame("diagram"), `<p:cxnSp/>`, `<p:contentPart/>`, `<p:graphicFrame><p:oleObj/></p:graphicFrame>`, `<a:videoFile r:link="rId9"/>`])
      expect(blank(slideContent(1, slide(body), RELS, false))).toBe(false);
  });
  it("\u26a0 an outline that comes only from the shape's style is still something on the slide", () => {
    const curve = `<p:sp><p:nvSpPr><p:nvPr/></p:nvSpPr><p:spPr><a:custGeom/><a:noFill/></p:spPr><p:style><a:lnRef idx="2"/></p:style></p:sp>`;
    expect(blank(slideContent(1, slide(curve), null, false))).toBe(false);
    const noLine = `<p:sp><p:nvSpPr><p:nvPr/></p:nvSpPr><p:spPr><a:custGeom/><a:noFill/></p:spPr><p:style><a:lnRef idx="0"/></p:style></p:sp>`;
    expect(blank(slideContent(1, slide(noLine), null, false))).toBe(true);
  });
  it("\u26a0 a frame of a kind Scholar does not read is never blank; a table's text is read", () => {
    const chartex = `<a:graphicData uri="http://schemas.microsoft.com/office/drawing/2014/chartex"/>`;
    expect(slideContent(1, slide(chartex), null, false).kinds).toEqual(["chart"]);
    expect(slideContent(1, slide(`<a:graphicData uri="http://example.com/new/thing"/>`), null, false).kinds).toEqual(["embedded"]);
    expect(slideContent(1, slide(frame("table")), null, true).kinds).toEqual([]);
  });
  it("finds a picture at any depth in a group, and says the slide was grouped", () => {
    const s = slideContent(36, slide(group(group(PIC))), RELS, true);
    expect(s).toMatchObject({ pictures: 1, grouped: true, kinds: [] });
  });
  it("names what it cannot read", () => {
    expect(slideContent(1, slide(frame("chart")), null, true).kinds).toEqual(["chart"]);
    expect(slideContent(1, slide(frame("diagram")), null, true).kinds).toEqual(["diagram"]);
    expect(slideContent(1, slide(PIC), REL_EMF, false).kinds).toEqual(["unsupported_picture"]);
  });
  it("does not treat a labelled slide's shapes as waiting content", () => {
    expect(slideContent(1, slide(DRAWN), null, true).kinds).toEqual([]);
    expect(slideContent(1, slide(DRAWN), null, false).kinds).toEqual(["drawing"]);
  });
});

const quality = (o: Partial<ExtractionQuality> & { units: number }): ExtractionQuality => ({ unit: "slide", emptyUnits: [], chars: 10, sections: 1, ...o });
const S = (slide: number, o: Partial<SlideStructure> = {}): SlideStructure => ({ slide, grouped: false, pictures: 0, decorative: 0, kinds: [], ...o });

/** The confirmed example's shape: text, picture-only, text with a picture in a group, blank. */
function example(o: Partial<ExtractionQuality> = {}) {
  const facts = buildSlideFacts([S(1), S(2, { pictures: 1 }), S(3, { pictures: 2, grouped: true }), S(4)], new Set([1, 3]), AT);
  return applySlideFacts(quality({ units: 4, emptyUnits: [2, 4], ...o }), facts);
}

describe("one status for each slide", () => {
  it("⚠ a blank slide leaves the unread list and raises no warning", () => {
    const q = applySlideFacts(quality({ units: 2, emptyUnits: [2] }), buildSlideFacts([S(1), S(2)], new Set([1]), AT));
    expect(q.emptyUnits).toEqual([]);
    expect(readingAttention(q)).toBe(0);
    expect(qualitySummary(q)).toEqual({ partial: false, heading: "Ready to learn", text: "Your presentation has been processed. 1 blank slide was skipped because it contained no learning content." });
  });
  it("⚠ a picture not read yet is not called read, and a text slide with one is not fully processed", () => {
    const rows = slideRows(example())!;
    expect(rows.map(r => r.status)).toEqual(["text", "preserved", "preserved", "blank"]);
    expect(rows[2].grouped).toBe(true);
    expect(rows[2].methods).toEqual(["slide_text"]);
    expect(rows[1].pictureWaiting && rows[2].pictureWaiting).toBe(true);
    const s = qualitySummary(example(), { recoverable: true });
    expect(s.partial).toBe(false);
    expect(s.heading).toBe("Ready to learn");
    expect(s.text).toContain("Slides 2, 3: the original pictures are kept in your notes and lessons, and Scholar has not interpreted them yet. To have Scholar read them, choose Read the pictures.");
    expect(s.text).toContain("1 blank slide was skipped");
    expect(readingAttention(example())).toBe(0);
    // Where lessons do not show pictures, a picture not read is really unavailable: said as a warning.
    const off = qualitySummary(example(), { picturesShown: false });
    expect(off.partial).toBe(true);
    expect(off.text).toContain("Slides 2, 3: a picture Scholar has not read yet");
    expect(s.text).not.toMatch(/4\b.*not read/);
  });
  it("uses what actually happened to each picture", () => {
    const rows = slideRows(example({ emptyUnits: [], aiReadUnits: [2, 3], aiTriedUnits: [2, 3] }))!;
    expect(rows.map(r => r.status)).toEqual(["text", "image", "mixed", "blank"]);
    expect(rows[2].methods).toEqual(["slide_text", "ai_picture"]);
    const s = qualitySummary(example({ emptyUnits: [], aiReadUnits: [2, 3], aiTriedUnits: [2, 3] }));
    expect(s).toEqual({ partial: false, heading: "Ready to learn", text: "Your presentation has been processed. 1 blank slide was skipped because it contained no learning content. Some slides were interpreted from pictures. You can review these against your original slides." });
  });
  it("gives the specific reason a reading was not kept, and never says a read picture cannot be read", () => {
    const q = example({ aiTriedUnits: [2, 3], aiSkipped: [{ unit: 2, reason: "patient_identifier" }] });
    const rows = slideRows(q)!;
    expect(rows[1].reasons).toEqual(["what looked like patient details, so the reading was not kept"]);
    expect(rows[2].reasons).toEqual(["a picture Scholar could not read reliably"]);
    expect(rows[1].pictureWaiting).toBe(false);
    expect(qualitySummary(q).text).not.toContain("Read the pictures");
    expect(qualitySummary(example({ emptyUnits: [], aiReadUnits: [2, 3], aiTriedUnits: [2, 3] })).text).not.toMatch(/cannot be read|cannot read/);
  });
  it("⚠ the counts are exclusive and add up to the slides", () => {
    const rows = slideRows(example({ emptyUnits: [2], aiReadUnits: [3], aiTriedUnits: [3] }), { processing: [2] })!;
    const c = slideCounts(rows);
    expect(c.text + c.image + c.mixed + c.blank + c.review + c.processing).toBe(c.total);
    expect(c).toMatchObject({ total: 4, text: 1, mixed: 1, blank: 1, processing: 1, review: 0 });
    expect(slideSummary(rows).heading).toBe("Still reading");
  });
  it("a chart on a text slide is under review, with its reason, and offers no AI reading it cannot do", () => {
    const facts = buildSlideFacts([S(1, { kinds: ["chart"] }), S(2, { kinds: ["drawing"] })], new Set([1]), AT);
    const q = applySlideFacts(quality({ units: 2, emptyUnits: [2] }), facts);
    expect(slideRows(q)!.map(r => r.reasons)).toEqual([["a chart Scholar cannot read yet"], ["shapes or a drawing Scholar cannot read yet"]]);
    expect(pictureReadingInput(q)).toMatchObject({ emptyUnits: [], mixedUnits: [] });
  });
  it("a slide with only a logo is not blank, not called kept in lessons, and costs no AI reading", () => {
    const facts = buildSlideFacts([S(1), S(2, { decorative: 1 })], new Set([1]), AT);
    const q = applySlideFacts(quality({ units: 2, emptyUnits: [2] }), facts);
    expect(facts.blank).toEqual([]);
    const [, row] = slideRows(q)!;
    expect(row.status).toBe("review");
    expect(row.reasons).toEqual(["only a small picture or logo, which lessons do not show"]);
    expect(pictureReadingInput(q).emptyUnits).toEqual([]);
  });
  it("a photo with no words on a slide with text stays calm, and is not offered again", () => {
    const q = example({ emptyUnits: [], aiReadUnits: [2], aiTriedUnits: [2, 3], aiSkipped: [{ unit: 3, reason: "no_text" }] });
    const rows = slideRows(q)!;
    expect(rows[2].status).toBe("preserved");
    expect(rows[2].pictureWaiting).toBe(false);
    expect(qualitySummary(q, { recoverable: true }).partial).toBe(false);
    expect(qualitySummary(q, { recoverable: true }).text).not.toContain("Read the pictures");
  });
  it("leaves a material uploaded before this reading as it was", () => {
    const q = quality({ units: 3, emptyUnits: [2] });
    expect(slideRows(q)).toBeNull();
    expect(readingAttention(q)).toBe(1);
    expect(qualitySummary(q).text).toMatch(/^Partly read: 1 of 3 slides held no readable text/);
    expect(qualitySummary({ ...q, unit: "page" }).text).toMatch(/^Partly read: 1 of 3 pages/);
  });
});

describe("checking a stored presentation again", () => {
  it("⚠ changes the record only, gives the same answer twice, and keeps what was read", () => {
    const facts = buildSlideFacts([S(1), S(2, { pictures: 1 }), S(3)], new Set([1]), AT);
    const stored = quality({ units: 3, emptyUnits: [3], aiReadUnits: [2], aiTriedUnits: [2, 3], aiProvenance: [{ units: [2], model: "m", promptVersion: "p", extractedAt: AT }], chars: 99, sections: 5 });
    const once = applySlideFacts(stored, facts, [1, 2]);
    expect(once).toMatchObject({ emptyUnits: [], aiReadUnits: [2], aiTriedUnits: [2], chars: 99, sections: 5, aiProvenance: stored.aiProvenance });
    expect(applySlideFacts(once, facts, [1, 2])).toEqual(once);
  });
  it("⚠ a slide holding a section or an AI reading is never made blank", () => {
    const facts = buildSlideFacts([S(1), S(2)], new Set(), AT);
    const q = applySlideFacts(quality({ units: 2, emptyUnits: [1, 2], aiReadUnits: [2] }), facts, [1]);
    expect(q.slideFacts!.blank).toEqual([]);
    expect(q.emptyUnits).toEqual([1, 2]);
  });
});

describe("what may be read with AI", () => {
  it("offers picture-only slides first, then pictures on text slides, and never a blank one", () => {
    const q = example();
    const plan = planPictureSlides({ ...pictureReadingInput(q), slidesWithSections: [1, 3], cap: 10 });
    expect(plan).toEqual({ slides: [2, 3], beyondCap: 0 });
    expect(planPictureSlides({ ...pictureReadingInput(q), slidesWithSections: [1, 3], cap: 1 })).toEqual({ slides: [2], beyondCap: 1 });
  });
  it("does not offer a picture twice", () => {
    expect(planPictureSlides({ ...pictureReadingInput(example({ aiTriedUnits: [2, 3] })), slidesWithSections: [1, 3], cap: 10 }).slides).toEqual([]);
  });
});

describe("what the learner sees for a slide", () => {
  it("shows what was taken from an affected slide, cut short, from sections already stored", () => {
    const rows = slideRows(example())!;
    const x = slideExtracts(rows, [{ pageFrom: 1, pageTo: 1, content: "one" }, { pageFrom: 3, pageTo: 3, content: "z".repeat(900) }]);
    expect(Object.keys(x)).toEqual(["3"]);
    expect(x[3].length).toBe(701);
  });
});
