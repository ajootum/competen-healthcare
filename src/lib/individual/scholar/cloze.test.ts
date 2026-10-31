import { describe, expect, it } from "vitest";
import {
  CLOZE_BLANK, clozeDraft, clozeNorm, clozeVariants, isClozeQuestion, markCloze, pickClozeItems, splitSentences, termsFromQuestions, termsInText,
} from "./cloze";
import { answerText, effectiveKind, keyOf, learnerItem, markResponse, parseResponse, pickQuestions, planGeneration, type PoolItem, type RevisionQuestion } from "./revision";

// SCHOLAR-COMPANION-01 P1: cloze recall, written by a rule from the learner's own notes. Pure rules only.

const NOTES = [
  "The trachea divides into the right and left main bronchi at the carina.",
  "Bronchioles end in alveoli, where gas exchange happens between air and blood.",
  "Oxygen is prescribed to a target saturation range and reviewed at least every four hours.",
  "Short line.",
  "Is the airway clear before you start the assessment today?",
  "A Glasgow Coma Scale score is recorded for every patient with a head injury on admission.",
  "Hand hygiene is performed before and after every patient contact in the ward.",
].join("\n");

const cloze = (over: Partial<RevisionQuestion> = {}): RevisionQuestion => ({
  id: "c1", kind: "short", stem: `The trachea divides into the right and left main ${CLOZE_BLANK} at the carina.`, options: [], correctIndex: null,
  answer: { accepted: ["bronchi", "bronchus"], format: "cloze" }, rationale: "Your notes say: ...", difficulty: 2, ...over,
});

describe("cloze: sentences and terms", () => {
  it("splits on sentence ends and line breaks, whitespace collapsed", () => {
    expect(splitSentences("One thing is true.  Another is   also true!\nA third line")).toEqual(["One thing is true.", "Another is also true!", "A third line"]);
  });
  it("finds acronyms and capitalised names, but not a phrase that merely starts with The", () => {
    const t = termsInText("The Glasgow Coma Scale is used. MRSA spreads by contact. The Patient Record was seen. Glasgow Coma Scale again.");
    expect(t).toContain("Glasgow Coma Scale");
    expect(t).toContain("MRSA");
    expect(t).not.toContain("The Patient Record");
  });
});

describe("cloze: picking items", () => {
  it("blanks the given term in a sentence of the notes and quotes that sentence", () => {
    const items = pickClozeItems({ text: NOTES, terms: ["bronchi", "alveoli"], max: 5 });
    const bronchi = items.find(i => i.term.toLowerCase() === "bronchi")!;
    expect(bronchi.stem).toBe(`The trachea divides into the right and left main ${CLOZE_BLANK} at the carina.`);
    expect(bronchi.sentence).toBe("The trachea divides into the right and left main bronchi at the carina.");
    expect(bronchi.stem).not.toMatch(/bronchi/i);
    expect(items.find(i => i.term === "alveoli")!.stem).toContain(CLOZE_BLANK);
  });
  it("never offers a too-short sentence, a question, or a term that is not a whole word", () => {
    expect(pickClozeItems({ text: NOTES, terms: ["Short"], max: 3 }).filter(i => i.term === "Short")).toEqual([]);
    expect(pickClozeItems({ text: NOTES, terms: ["airway"], max: 3 }).filter(i => i.term === "airway")).toEqual([]);
    expect(pickClozeItems({ text: NOTES, terms: ["bronch"], max: 3 }).filter(i => i.term === "bronch")).toEqual([]);
  });
  it("falls back to terms found in the text, and respects max, existing stems and the reject screen", () => {
    const found = pickClozeItems({ text: NOTES, terms: [], max: 5 });
    expect(found.map(i => i.term)).toContain("Glasgow Coma Scale");
    expect(pickClozeItems({ text: NOTES, terms: ["bronchi", "alveoli", "saturation"], max: 2 })).toHaveLength(2);
    const one = NOTES.split("\n")[0];
    const first = pickClozeItems({ text: one, terms: ["bronchi"], max: 1 })[0];
    expect(pickClozeItems({ text: one, terms: ["bronchi"], max: 1, existing: new Set([clozeNorm(first.stem)]) })).toEqual([]);
    expect(pickClozeItems({ text: one, terms: ["bronchi"], max: 1, reject: s => /carina/.test(s) })).toEqual([]);
  });
  it("is deterministic", () => {
    expect(pickClozeItems({ text: NOTES, terms: ["bronchi", "alveoli"], max: 4 })).toEqual(pickClozeItems({ text: NOTES, terms: ["bronchi", "alveoli"], max: 4 }));
  });
  it("blanks every occurrence of the term so the sentence does not give it away", () => {
    const [i] = pickClozeItems({ text: "Hand hygiene is the single most effective step, and hand hygiene is checked on every shift.", terms: ["hand hygiene"], max: 1 });
    expect(i.stem.match(/_____/g)).toHaveLength(2);
    expect(i.stem.toLowerCase()).not.toContain("hygiene");
  });
});

describe("cloze: normalised marking by code", () => {
  it("ignores case, hyphens, punctuation, a leading article and a plural", () => {
    expect(markCloze("  The Bronchus. ", ["bronchus"])).toBe(true);
    expect(markCloze("beta blocker", ["beta-blockers"])).toBe(true);
    expect(markCloze("BRONCHI", ["bronchi"])).toBe(true);
    expect(markCloze("alveolus", ["alveoli"])).toBe(false);
    expect(markCloze("", ["bronchi"])).toBe(false);
    expect(markCloze("trachea", ["bronchi", "bronchus"])).toBe(false);
  });
  it("keeps at most eight accepted variants, the written term first", () => {
    const v = clozeVariants("beta-blocker");
    expect(v[0]).toBe("beta-blocker");
    expect(v).toContain("beta blocker");
    expect(v).toContain("beta-blockers");
    expect(v.length).toBeLessThanOrEqual(8);
    expect(clozeVariants("antibiotic")).toContain("antibiotics");
    expect(clozeVariants("antibiotics")).toContain("antibiotic");
    expect(clozeVariants("therapy")).toContain("therapies");
  });
});

describe("cloze: stored as the existing short kind", () => {
  it("the draft satisfies the 416/710 short CHECK shape and carries the sentence as its quote", () => {
    const [item] = pickClozeItems({ text: NOTES, terms: ["bronchi"], max: 1 });
    const d = clozeDraft(item);
    expect(d.options).toEqual([]);
    const accepted = (d.answer as { accepted: string[] }).accepted;
    expect(Array.isArray(accepted)).toBe(true);
    expect(accepted.length).toBeGreaterThanOrEqual(1);
    expect(accepted.length).toBeLessThanOrEqual(8);
    expect((d.answer as { format: string }).format).toBe("cloze");
    expect(d.sourceQuote).toBe(item.sentence);
    expect(NOTES).toContain(d.sourceQuote);
  });
  it("a cloze question is a short whose key says cloze; a plain short is not", () => {
    expect(isClozeQuestion(cloze())).toBe(true);
    expect(isClozeQuestion(cloze({ answer: { accepted: ["x"] } }))).toBe(false);
    expect(isClozeQuestion(cloze({ kind: "flashcard" }))).toBe(false);
    expect(effectiveKind(cloze())).toBe("cloze");
    expect(effectiveKind(cloze({ answer: { accepted: ["x"] } }))).toBe("short");
  });
  it("is keyed, shown and answered as a cloze item, and marked by code either way", () => {
    expect(keyOf(cloze())).toEqual({ kind: "accepted", answers: ["bronchi", "bronchus"] });
    expect(answerText(cloze())).toBe("bronchi");
    const item = learnerItem(cloze());
    expect(item.kind).toBe("cloze");
    expect(item.options).toEqual([]);
    expect(JSON.stringify(item)).not.toContain("bronchus");
    const r = parseResponse(cloze(), { text: " Bronchi " })!;
    expect(r).toEqual({ kind: "text", text: "Bronchi" });
    expect(markResponse(cloze(), r)).toEqual({ correct: true, score: 1, marking: "deterministic" });
    expect(markResponse(cloze(), { kind: "text", text: "trachea" })).toEqual({ correct: false, score: 0, marking: "deterministic" });
  });
  it("a plain short answer is still never marked wrong by code", () => {
    const plain = cloze({ stem: "Name the airway.", answer: { accepted: ["trachea"] } });
    expect(markResponse(plain, { kind: "text", text: "windpipe" })).toEqual({ needsJudgement: true });
  });
  it("terms come from existing short answers and short card backs, never from cloze items", () => {
    expect(termsFromQuestions([
      { kind: "short", answer: { accepted: ["bronchi", "bronchus"] } }, { kind: "flashcard", answer: { back: "Alveoli" } },
      { kind: "flashcard", answer: { back: "A very long explanation that is certainly not a single key term worth blanking in any sentence" } },
      cloze(),
    ])).toEqual(["bronchi", "Alveoli"]);
  });
});

describe("cloze: sessions", () => {
  const pool: PoolItem[] = [
    { id: "a", kind: "cloze", difficulty: 2, chunkId: "c", createdAt: "2026-10-01", latestCorrect: null, misses: 0, lastAnsweredAt: null, due: false },
    { id: "b", kind: "short", difficulty: 2, chunkId: "c", createdAt: "2026-10-02", latestCorrect: null, misses: 0, lastAnsweredAt: null, due: false },
  ];
  it("offers cloze items only when cloze was chosen, and short answers only when short was", () => {
    expect(pickQuestions({ mode: "quick", pool, quantity: 5, formats: ["cloze"], difficulty: "any", seed: "s" }).ids).toEqual(["a"]);
    expect(pickQuestions({ mode: "quick", pool, quantity: 5, formats: ["short"], difficulty: "any", seed: "s" }).ids).toEqual(["b"]);
  });
  it("is never planned for AI generation: the plan is over the written formats only", () => {
    const plan = planGeneration({ shortfall: 3, chunkIds: ["c"], formats: ["cloze", "mcq"], existing: new Set() });
    expect(plan.length).toBeGreaterThan(0);
    expect(plan.every(p => p.kind === "mcq")).toBe(true);
    expect(planGeneration({ shortfall: 3, chunkIds: ["c"], formats: ["cloze"], existing: new Set() })).toEqual([]);
  });
});
