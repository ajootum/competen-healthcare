import { describe, expect, it } from "vitest";
import { LIKELY_DUPLICATE, MAX_ITEMS, SIMILAR, bandOf, findDuplicatePairs, findSimilar, jaccard, questionFingerprint, similarity, tokens } from "./question-similarity";

const q = (stem: string, options: string[], correct = 0) => ({ stem, options, correct_index: correct, rationale: "because" });
const A = q("A 62-year-old man presents with crushing chest pain radiating to the left arm. What is the most likely diagnosis?", ["Acute myocardial infarction", "Pericarditis", "Aortic dissection", "Pulmonary embolism"]);
const A2 = q("A 62 year old man presents with crushing chest pain radiating to his left arm. Which is the most likely diagnosis?", ["Acute myocardial infarction", "Pericarditis", "Aortic dissection", "Pneumothorax"]);
const A3 = q("A 62-year-old man presents with crushing chest pain radiating to the left arm. What is the most likely diagnosis?", ["Pericarditis", "Acute myocardial infarction", "Aortic dissection", "Pulmonary embolism"], 0);
const B = q("Which electrolyte disturbance is typically associated with peaked T waves on an ECG?", ["Hyperkalaemia", "Hypokalaemia", "Hypocalcaemia", "Hypernatraemia"]);

describe("tokens and fingerprint", () => {
  it("drops stopwords, short tokens and punctuation", () => {
    expect(tokens("What is the MOST likely diagnosis? A 62-year-old")).toEqual(["diagnosis", "62", "year", "old"]);
  });
  it("is null for something that is not a four-option question", () => {
    expect(questionFingerprint({ body: "x" })).toBeNull();
    expect(questionFingerprint({ stem: "the a of", options: [] })).toBeNull();
  });
  it("jaccard of nothing is 0, never 1", () => {
    expect(jaccard(new Set(), new Set())).toBe(0);
    expect(jaccard(new Set(["a"]), new Set(["a"]))).toBe(1);
  });
});

describe("similarity bands", () => {
  const fa = questionFingerprint(A)!;
  it("the same question is a likely duplicate (1.0)", () => { expect(similarity(fa, fa)).toBe(1); expect(bandOf(1)).toBe("likely_duplicate"); });
  it("a light rewording with the same key is a likely duplicate", () => {
    expect(similarity(fa, questionFingerprint(A2)!)).toBeGreaterThanOrEqual(LIKELY_DUPLICATE);
  });
  it("same stem but a different key scores lower than the same stem and key, and is still similar", () => {
    expect(similarity(fa, questionFingerprint(A3)!)).toBeLessThan(similarity(fa, questionFingerprint(A2)!));
    expect(similarity(fa, questionFingerprint(A3)!)).toBeGreaterThanOrEqual(SIMILAR);
  });
  it("unrelated questions are distinct", () => { expect(bandOf(similarity(fa, questionFingerprint(B)!))).toBe("distinct"); });
  it("thresholds are 0.8 and 0.6", () => { expect([LIKELY_DUPLICATE, SIMILAR]).toEqual([0.8, 0.6]); expect(bandOf(0.79)).toBe("similar"); expect(bandOf(0.59)).toBe("distinct"); });
});

describe("findSimilar", () => {
  it("returns matches best first, skips itself, ignores distinct and unreadable", () => {
    const m = findSimilar(A, [{ id: "a", content: A }, { id: "a2", content: A2 }, { id: "b", content: B }, { id: "x", content: { body: "no" } }], { exceptId: "a" });
    expect(m.map(x => x.id)).toEqual(["a2"]);
    expect(m[0].band).toBe("likely_duplicate");
  });
});

describe("findDuplicatePairs is bounded and uses rare tokens", () => {
  it("finds the planted pair among unrelated questions", () => {
    const filler = Array.from({ length: 40 }, (_, i) => ({ id: `f${i}`, content: q(`Filler ${i} question about topic${i} organ${i} drug${i} dose${i} measure${i}`, [`alpha${i}`, "b", "c", "d"]) }));
    const { pairs, truncated } = findDuplicatePairs([...filler, { id: "p1", content: A }, { id: "p2", content: A2 }]);
    expect(truncated).toBe(false);
    expect(pairs).toHaveLength(1);
    expect([pairs[0].a, pairs[0].b].sort()).toEqual(["p1", "p2"]);
    expect(pairs[0].band).toBe("likely_duplicate");
  });
  it("two questions sharing only one rare token are never compared", () => {
    expect(findDuplicatePairs([{ id: "1", content: q("zebra crossing safety rules", ["x1", "y", "z", "w"]) }, { id: "2", content: q("zebra stripes camouflage theory", ["x2", "y", "z", "w"]) }]).pairs).toEqual([]);
  });
  it("caps the work and says so", () => {
    const many = Array.from({ length: MAX_ITEMS + 5 }, (_, i) => ({ id: `i${i}`, content: q(`Unique stem number${i} concerning item${i}`, ["a1", "b", "c", "d"]) }));
    expect(findDuplicatePairs(many).truncated).toBe(true);
  });
});
