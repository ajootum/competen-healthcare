import { describe, expect, it } from "vitest";
import { notesBlocks, shortRef, sourceWords, wordsOf } from "./notes-layout";

const SAMPLES = [
  "Personal hygiene\nBathing gives the nurse an opportunity to assess skin\nand tissue, and pick up vital clues.\n\n• Wash from clean to dirty\n• Keep the patient warm\n• Change the water when soapy",
  "Grade 0: lids completely closed\nGrade 1: any conjunctival exposure\nGrade 2: any corneal exposure",
  "1. Assess the eye\n2) Clean with gauze\na) Lacrilube applied every four hours",
  "A long paragraph of slide text that runs well beyond one hundred and ten characters so that it is shown as a paragraph rather than a point.\nAnd a second long line that is also more than one hundred and ten characters, so it too remains its own paragraph.",
  "Intro line\n- dash item\n– en dash item\nWell-known hyphen-words stay",
  "",
];

describe("notesBlocks: layout only, never the words", () => {
  it("keeps every word, in order, for every sample (bullet glyphs become list styling)", () => {
    for (const s of SAMPLES) expect(wordsOf(notesBlocks(s))).toEqual(sourceWords(s));
  });
  it("joins a wrapped line and turns bullets into a marked list", () => {
    const b = notesBlocks(SAMPLES[0]);
    expect(b[0]).toEqual({ kind: "para", text: "Personal hygiene" });
    expect(b[1]).toEqual({ kind: "para", text: "Bathing gives the nurse an opportunity to assess skin and tissue, and pick up vital clues." });
    expect(b[2]).toEqual({ kind: "list", marked: true, items: ["Wash from clean to dirty", "Keep the patient warm", "Change the water when soapy"] });
  });
  it("shows short plain lines as the slide's points, without inventing bullets in the text", () => {
    expect(notesBlocks(SAMPLES[1])).toEqual([{ kind: "list", marked: false, items: ["Grade 0: lids completely closed", "Grade 1: any conjunctival exposure", "Grade 2: any corneal exposure"] }]);
  });
  it("keeps the source's own numbers and letters", () => {
    expect(notesBlocks(SAMPLES[2])).toEqual([{ kind: "list", marked: true, items: ["1. Assess the eye", "2) Clean with gauze", "a) Lacrilube applied every four hours"] }]);
  });
  it("keeps long lines as paragraphs, and hyphenated words are not bullets", () => {
    expect(notesBlocks(SAMPLES[3]).every(x => x.kind === "para")).toBe(true);
    const b = notesBlocks(SAMPLES[4]);
    expect(b.find(x => x.kind === "list")).toEqual({ kind: "list", marked: true, items: ["dash item", "en dash item"] });
    expect(b.some(x => x.kind === "para" && x.text === "Well-known hyphen-words stay")).toBe(true);
  });
  it("a lower-case line after a bullet continues that bullet (a wrapped point)", () => {
    expect(notesBlocks(["• Keep the eye moist and", "closed with tape"].join(String.fromCharCode(10)))).toEqual([{ kind: "list", marked: true, items: ["Keep the eye moist and closed with tape"] }]);
  });
  it("a lead-in line ending ':' introduces the short lines after it as its points (real slide text)", () => {
    const slide = ["Timing of a bed-bath and personal hygiene is important.", "If more than one nurse is needed.", "Personal hygiene involves:", "Washing hair (as necessary),", "Shaving the patient,", "Management of cerumen in ears and", "Care of finger and toe nails."].join(String.fromCharCode(10));
    const b = notesBlocks(slide);
    expect(b).toEqual([
      { kind: "para", text: "Timing of a bed-bath and personal hygiene is important." },
      { kind: "para", text: "If more than one nurse is needed." },
      { kind: "para", text: "Personal hygiene involves:" },
      { kind: "list", marked: false, items: ["Washing hair (as necessary),", "Shaving the patient,", "Management of cerumen in ears and", "Care of finger and toe nails."] },
    ]);
    expect(wordsOf(b)).toEqual(sourceWords(slide));
  });
  it("an empty text has no blocks", () => { expect(notesBlocks("")).toEqual([]); });
});

describe("shortRef", () => {
  it("names the slide or page range, and nothing for a section", () => {
    expect(shortRef("slide", 14, 14)).toBe("Slide 14");
    expect(shortRef("page", 3, 4)).toBe("Pages 3–4");
    expect(shortRef("section", 2, null)).toBeNull();
  });
});
