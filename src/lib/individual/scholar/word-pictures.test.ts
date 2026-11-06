import { describe, expect, it } from "vitest";
import { placeWordPictures, wordMediaPart, wordPictures } from "./word-pictures";
import { buildVisuals, canServeVisual, pagesOfCitation, parseVisualKey, visualsForSection } from "./material-visuals";

const image = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image";
const rels = (pairs: [string, string, string?][]) => `<Relationships>${pairs.map(([id, t, mode]) => `<Relationship Id="${id}" Type="${image}" Target="${t}"${mode ? ` TargetMode="${mode}"` : ""}/>`).join("")}<Relationship Id="rIdX" Type="x/styles" Target="styles.xml"/></Relationships>`;
const blip = (id: string) => `<w:drawing><a:blip r:embed="${id}"/></w:drawing>`;
const t = (s: string) => `<w:r><w:t xml:space="preserve">${s}</w:t></w:r>`;

describe("reading the pictures of a Word file", () => {
  const r = rels([["rId1", "media/a.png"], ["rId2", "media/b.jpg"], ["rId3", "media/c.emf"], ["rId4", "https://example.org/x.png", "External"]]);
  it("in document order, each after the text before it", () => {
    const got = wordPictures(`${blip("rId1")}${t("Alpha one.")}${blip("rId2")}${t("Beta &amp; two.")}${blip("rId3")}`, r);
    expect(got.map(p => p.part)).toEqual(["word/media/a.png", "word/media/b.jpg", "word/media/c.emf"]);
    expect(got.map(p => p.before)).toEqual(["", "Alphaone.", "Alphaone.Beta&two."]);
    expect(got.map(p => p.offset)).toEqual([0, 9, 18]);
  });
  it("Word's two forms of one shape count once", () => {
    const xml = `<mc:AlternateContent><mc:Choice Requires="wps">${blip("rId1")}</mc:Choice><mc:Fallback><v:imagedata r:id="rId1"/></mc:Fallback></mc:AlternateContent>`;
    expect(wordPictures(xml, r)).toHaveLength(1);
  });
  it("an empty fallback swallows nothing after it", () => {
    const xml = `<mc:AlternateContent><mc:Choice Requires="wps">${blip("rId1")}</mc:Choice><mc:Fallback/></mc:AlternateContent>${t("Between.")}${blip("rId2")}<mc:AlternateContent><mc:Choice Requires="wps">${blip("rId1")}</mc:Choice><mc:Fallback><v:imagedata r:id="rId1"/></mc:Fallback></mc:AlternateContent>`;
    expect(wordPictures(xml, r).map(p => p.part)).toEqual(["word/media/a.png", "word/media/b.jpg", "word/media/a.png"]);
  });
  it("a shape whose picture is only in the fallback is still found", () => {
    const xml = `<mc:AlternateContent><mc:Choice Requires="wpi"><w:contentPart r:id="rIdInk"/></mc:Choice><mc:Fallback><v:imagedata r:id="rId2"/></mc:Fallback></mc:AlternateContent>`;
    expect(wordPictures(xml, r).map(p => p.part)).toEqual(["word/media/b.jpg"]);
  });
  it("an old-style picture alone is found", () => {
    expect(wordPictures(`<w:pict><v:imagedata r:id="rId2"/></w:pict>`, r).map(p => p.part)).toEqual(["word/media/b.jpg"]);
  });
  it("a linked picture is known to be outside the file", () => {
    expect(wordPictures(`<a:blip r:link="rId4"/>`, r)).toEqual([{ part: null, before: "", offset: 0 }]);
  });
  it("a chart or a diagram is known to be there, though it has no picture to show", () => {
    const uri = "http://schemas.openxmlformats.org/drawingml/2006";
    expect(wordPictures(`${t("Before.")}<a:graphicData uri="${uri}/chart"></a:graphicData><a:graphicData uri="${uri}/diagram"></a:graphicData><a:graphicData uri="${uri}/picture"></a:graphicData>`, r))
      .toEqual([{ part: null, before: "Before.", offset: 7 }, { part: null, before: "Before.", offset: 7 }]);
  });
  it("a reference to something not a picture is ignored", () => {
    expect(wordPictures(`<a:blip r:embed="rIdX"/><a:blip r:embed="rIdMissing"/>`, r)).toEqual([]);
  });
  it("a target that climbs out of the media folder is never opened", () => {
    expect(wordMediaPart("media/a.png")).toBe("word/media/a.png");
    expect(wordMediaPart("/word/media/a.png")).toBe("word/media/a.png");
    expect(wordMediaPart("../customXml/item1.xml")).toBeNull();
    expect(wordMediaPart("media/../../secret.png")).toBeNull();
    expect(wordMediaPart("../../../etc/passwd")).toBeNull();
  });
});

describe("finding each picture's section", () => {
  const chunks = [
    { ordinal: 1, content: "Alpha one is here. Alpha goes on." },
    { ordinal: 2, content: "• Beta two is here.\nBeta goes on." },
    { ordinal: 3, content: "Gamma three is here." },
  ];
  it("the section holding the text before it", () => {
    expect(placeWordPictures([{ before: "Alphagoeson.", offset: 27 }, { before: "Betagoeson.", offset: 50 }, { before: "Gammathreeishere.", offset: 67 }], chunks)).toEqual([1, 2, 3]);
  });
  it("before any text: the first section", () => {
    expect(placeWordPictures([{ before: "", offset: 0 }], chunks)).toEqual([1]);
  });
  it("text ending exactly at a section's end stays with that section", () => {
    expect(placeWordPictures([{ before: "Alphagoeson.", offset: 27 }], chunks)).toEqual([1]);
  });
  it("bullets and spaces do not get in the way", () => {
    expect(placeWordPictures([{ before: "Betatwoishere.", offset: 41 }], chunks)).toEqual([2]);
  });
  it("text that cannot be found falls back to where it should be, and never past the end", () => {
    expect(placeWordPictures([{ before: "NOT IN THE STORED TEXT", offset: 60 }], chunks)).toEqual([3]);
    expect(placeWordPictures([{ before: "NOT IN THE STORED TEXT", offset: 2 }], chunks)).toEqual([1]);
    expect(placeWordPictures([{ before: "NOT IN THE STORED TEXT", offset: 9999 }], chunks)).toEqual([3]);
  });
  it("footnotes do not move a picture: markers are ignored, and notes appended at the end do not stretch the document", () => {
    const body = "One sentence about growth here. ";
    const notes = [
      { ordinal: 1, content: `${body.repeat(3)}Marked point.[1]` },
      { ordinal: 2, content: body.repeat(4) },
      { ordinal: 3, content: body.repeat(4) },
      { ordinal: 4, content: "A long footnote appended to the stored text. ".repeat(20) },
    ];
    const unit = "Onesentenceaboutgrowthhere.".length;
    const first = "Onesentenceaboutgrowthhere.".repeat(2) + "Markedpoint.";
    expect(placeWordPictures([{ before: first.slice(-60), offset: unit * 3 + 12 }, { before: "Onesentenceaboutgrowthhere.".repeat(2), offset: unit * 8 + 12 }], notes)).toEqual([1, 3]);
  });
  it("when the longer text reads differently, the last words still find it", () => {
    expect(placeWordPictures([{ before: "SOMETHING DIFFERENT HEREBetagoeson.", offset: 50 }], chunks)).toEqual([2]);
  });
  it("order is kept even where the same text comes twice", () => {
    const twice = [{ ordinal: 1, content: "Repeat me here." }, { ordinal: 2, content: "Middle." }, { ordinal: 3, content: "Repeat me here." }];
    expect(placeWordPictures([{ before: "Repeatmehere.", offset: 13 }, { before: "Repeatmehere.", offset: 32 }], twice)).toEqual([1, 3]);
  });
  it("words that repeat through the notes: the match nearest to how far through the picture is", () => {
    const same = "The same sentence again. ";
    const repeated = [{ ordinal: 1, content: same.repeat(4) }, { ordinal: 2, content: same.repeat(4) }, { ordinal: 3, content: same.repeat(4) }];
    const before = "Thesamesentenceagain.".repeat(3);
    const one = "Thesamesentenceagain.".length;
    expect(placeWordPictures([{ before, offset: one * 8 }], repeated)).toEqual([2]);
    expect(placeWordPictures([{ before, offset: one * 11 }], repeated)).toEqual([3]);
    expect(placeWordPictures([{ before, offset: one * 4 }, { before, offset: one * 7 }, { before, offset: one * 12 }], repeated)).toEqual([1, 2, 3]);
  });
  it("pictures with no text between them stay together", () => {
    expect(placeWordPictures([{ before: "Alphagoeson.", offset: 27 }, { before: "Alphagoeson.", offset: 27 }, { before: "Alphagoeson.", offset: 27 }], chunks)).toEqual([1, 1, 1]);
  });
  it("never moves backwards", () => {
    expect(placeWordPictures([{ before: "Gammathreeishere.", offset: 67 }, { before: "NOT THERE", offset: 1 }], chunks)).toEqual([3, 3]);
  });
  it("no sections: nothing to place", () => {
    expect(placeWordPictures([{ before: "x", offset: 0 }], [])).toEqual([]);
  });
});

describe("a Word picture among the visuals", () => {
  const photo = (n: number, media: string, sha: string, width = 800) => ({ n, media, kind: "png" as const, width, height: 600, bytes: 90_000, sha });
  const scan = { slides: 3, pictures: [photo(1, "word/media/b.png", "bbbbbbbbbbbbbbbb", 300), photo(1, "word/media/a.png", "aaaaaaaaaaaaaaaa", 900), photo(2, "word/media/c.png", "cccccccccccccccc")], undisplayable: [{ n: 3, media: "word/media/d.emf" }] };
  it("keeps the document's order inside a section, not largest first", () => {
    const { visuals } = buildVisuals(scan, { unit: "section", classify: false, maxPerSlide: 20 });
    expect(visuals.map(v => v.media)).toEqual(["word/media/b.png", "word/media/a.png", "word/media/c.png"]);
  });
  it("a small, wide or repeated picture stays: a Word file has no whole-page fallback, and an ECG strip or a formula is meaningful", () => {
    const strip = { n: 1, media: "word/media/ecg.png", kind: "png" as const, width: 1600, height: 90, bytes: 3000, sha: "dddddddddddddddd" };
    const formula = { n: 2, media: "word/media/f.png", kind: "png" as const, width: 200, height: 40, bytes: 900, sha: "eeeeeeeeeeeeeeee" };
    const again = [1, 2, 3].map(n => ({ n, media: "word/media/g.png", kind: "png" as const, width: 500, height: 400, bytes: 50_000, sha: "ffffffffffffffff" }));
    const { visuals } = buildVisuals({ slides: 3, pictures: [strip, formula, ...again], undisplayable: [] }, { unit: "section", classify: false, maxPerSlide: 20 });
    expect(visuals.map(v => v.media)).toEqual(expect.arrayContaining(["word/media/ecg.png", "word/media/f.png"]));
    expect(visuals.filter(v => v.media === "word/media/g.png")).toHaveLength(3);
  });
  it("only a bullet or an icon is dropped", () => {
    const icon = { n: 1, media: "word/media/i.png", kind: "png" as const, width: 24, height: 24, bytes: 300, sha: "1111111111111111" };
    expect(buildVisuals({ slides: 1, pictures: [icon], undisplayable: [] }, { unit: "section", classify: false }).visuals).toEqual([]);
  });
  it("has its own key, and says it is from a section", () => {
    const { visuals, notShown } = buildVisuals(scan, { unit: "section", classify: false, maxPerSlide: 20 });
    expect(visuals[0]).toMatchObject({ key: "s1-bbbbbbbbbbbbbbbb", unit: "section", n: 1, caption: "Section 1 · original picture from your document" });
    expect(parseVisualKey(visuals[0].key)).toEqual({ kind: "section", n: 1, sha: "bbbbbbbbbbbbbbbb" });
    expect(parseVisualKey("s0-bbbbbbbbbbbbbbbb")).toBeNull();
    expect(parseVisualKey("s1-../../x")).toBeNull();
    expect(notShown).toBe(1);
  });
  it("shows with its own section", () => {
    const { visuals } = buildVisuals(scan, { unit: "section", classify: false, maxPerSlide: 20 });
    expect(visualsForSection(visuals, [], { from: 2, to: 2, first: true, last: true }).map(v => v.n)).toEqual([2]);
  });
  it("a Word file's pictures may be served, to its owner", () => {
    const docx = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    expect(canServeVisual({ userId: "a", mimeType: docx }, "a")).toBe("ok");
    expect(canServeVisual({ userId: "a", mimeType: docx }, "b")).toBe("not_found");
    expect(canServeVisual({ userId: "a", mimeType: "text/plain" }, "a")).toBe("not_supported");
  });
  it("a citation of a section can be looked up", () => {
    expect(pagesOfCitation("Notes, section 4")).toEqual({ unit: "section", from: 4, to: 4 });
  });
});
