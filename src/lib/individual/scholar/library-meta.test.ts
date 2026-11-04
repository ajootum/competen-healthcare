import { describe, expect, it } from "vitest";
import { checkLibraryMeta, fitsLearner, metaFromFields, metaOf, metaSummary, qualificationOf } from "./library-meta";
import { libraryCopyOf, validateLibraryQuestion } from "./library-format";
import { fieldsFromQuestionContent, questionContentFromFields } from "@/lib/knowledge/question-format";
import { adaptiveLibraryFits } from "./library-questions";

// SQIE-CLOSE-2026-11 WS-E / WS-F: programme, qualification level and difficulty on library items, and reuse by learner fit.

describe("checkLibraryMeta", () => {
  it("absent or empty is no metadata, never a refusal", () => {
    expect(checkLibraryMeta(undefined)).toEqual({ ok: true, meta: null });
    expect(checkLibraryMeta({})).toEqual({ ok: true, meta: null });
    expect(checkLibraryMeta({ programmes: [], level: "", difficulty: "" })).toEqual({ ok: true, meta: null });
  });
  it("normalises programmes (distinct, sorted) and keeps level and difficulty", () => {
    expect(checkLibraryMeta({ programmes: ["bsc-nursing", "diploma-nursing", "bsc-nursing"], level: "degree", difficulty: 3 }))
      .toEqual({ ok: true, meta: { programmes: ["bsc-nursing", "diploma-nursing"], level: "degree", difficulty: 3 } });
  });
  it("refuses what 995 refuses", () => {
    expect(checkLibraryMeta({ programmes: ["Not A Code"] }).ok).toBe(false);
    expect(checkLibraryMeta({ programmes: Array.from({ length: 11 }, (_, i) => `p-${i}x`) }).ok).toBe(false);
    expect(checkLibraryMeta({ level: "phd" }).ok).toBe(false);
    expect(checkLibraryMeta({ difficulty: 4 }).ok).toBe(false);
    expect(checkLibraryMeta({ difficulty: true }).ok).toBe(false);
    expect(checkLibraryMeta(["x"]).ok).toBe(false);
  });
});

describe("qualificationOf", () => {
  it("reads the same words as the generation difficulty rule", () => {
    expect(qualificationOf("BSc Nursing", "Year 2")).toBe("degree");
    expect(qualificationOf("Diploma in Nursing")).toBe("diploma");
    expect(qualificationOf("Enrolled Nurse certificate")).toBe("certificate");
    expect(qualificationOf("MSc Advanced Practice")).toBe("postgraduate");
    expect(qualificationOf("Nursing", null)).toBeNull();
    expect(qualificationOf(null, undefined)).toBeNull();
  });
});

describe("fitsLearner: only a KNOWN mismatch excludes", () => {
  const meta = { programmes: ["bsc-nursing"], level: "degree" as const };
  it("matches, unknowns and untagged items are offered", () => {
    expect(fitsLearner(meta, { programmeCode: "bsc-nursing", level: "degree" })).toBe(true);
    expect(fitsLearner(meta, { programmeCode: null, level: null })).toBe(true);
    expect(fitsLearner(null, { programmeCode: "x-y", level: "certificate" })).toBe(true);
    expect(fitsLearner(meta, null)).toBe(true);
  });
  it("another programme or level is not offered", () => {
    expect(fitsLearner(meta, { programmeCode: "diploma-nursing", level: null })).toBe(false);
    expect(fitsLearner(meta, { programmeCode: null, level: "certificate" })).toBe(false);
  });
});

const calcLike = {
  format: "short", stem: "What is the normal adult resting respiratory rate range?", options: [], answerKey: { accepted: ["12 to 20 breaths per minute"] },
  marking: "deterministic", rationale: "Adults normally breathe 12 to 20 times a minute at rest.",
};

describe("validateLibraryQuestion keeps meta and the learner copy is unchanged by it", () => {
  it("a format question with meta: meta normalised and kept, copy identical to the untagged one", () => {
    const tagged = validateLibraryQuestion({ ...calcLike, meta: { programmes: ["bsc-nursing"], level: "degree", difficulty: 2 } });
    const plain = validateLibraryQuestion(calcLike);
    expect(tagged.ok && plain.ok).toBe(true);
    if (!tagged.ok || !plain.ok) return;
    expect(tagged.content.meta).toEqual({ programmes: ["bsc-nursing"], level: "degree", difficulty: 2 });
    expect(libraryCopyOf(tagged.content)).toEqual(libraryCopyOf(plain.content));
  });
  it("a legacy 442 question: unchanged without meta, meta kept with it, bad meta refused", () => {
    const legacy = { stem: "Which vein is used for most adult cannulations?", options: ["Cephalic", "Femoral", "Jugular", "Saphenous"], correct_index: 0, rationale: "The cephalic vein is commonly used." };
    const a = validateLibraryQuestion(legacy);
    expect(a.ok && a.content).toBe(legacy);
    const b = validateLibraryQuestion({ ...legacy, meta: { difficulty: 1 } });
    expect(b.ok && b.content.meta).toEqual({ difficulty: 1 });
    expect(validateLibraryQuestion({ ...legacy, meta: { level: "nope" } }).ok).toBe(false);
  });
  it("the HQ form fields round-trip programme, level and difficulty", () => {
    const content = questionContentFromFields({ format: "short", stem: calcLike.stem, accepted: "12 to 20 breaths per minute", rationale: calcLike.rationale, programmes: ["bsc-nursing"], level: "degree", difficulty: "3" });
    const v = validateLibraryQuestion(content);
    expect(v.ok && metaOf(v.content)).toEqual({ programmes: ["bsc-nursing"], level: "degree", difficulty: 3 });
    expect(fieldsFromQuestionContent(v.ok ? v.content : {})).toMatchObject({ programmes: ["bsc-nursing"], level: "degree", difficulty: "3" });
    expect(metaFromFields({ programmes: "", level: "", difficulty: "" })).toBeUndefined();
  });
  it("a short summary for lists", () => {
    expect(metaSummary({ level: "degree", difficulty: 3, programmes: ["a-b", "c-d"] })).toBe("Degree (bachelor's) · Harder · 2 programmes");
    expect(metaSummary(null)).toBeNull();
  });
});

describe("adaptiveLibraryFits (WS-F): every exam format, never a look-alike", () => {
  const lib = (["mcq", "mrq", "short", "match", "sequence", "structured", "cloze", "true_false", "extended", "flashcard"] as const).map(format => ({ format }));
  it("reuses the exam's formats, not only mcq", () => {
    expect(adaptiveLibraryFits(lib, ["mcq", "mrq", "short", "match", "sequence", "structured"]).map(x => x.format)).toEqual(["mcq", "mrq", "short", "match", "sequence", "structured"]);
  });
  it("cloze, true/false and extended (stored as short) and flashcards are not the short answer an exam asked for", () => {
    expect(adaptiveLibraryFits(lib, ["short"]).map(x => x.format)).toEqual(["short"]);
  });
  it("a legacy item (no format) is a single best answer", () => {
    expect(adaptiveLibraryFits([{}], ["mcq"]).length).toBe(1);
    expect(adaptiveLibraryFits([{}], ["mrq"]).length).toBe(0);
  });
});
