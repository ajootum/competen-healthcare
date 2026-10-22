import { describe, expect, it } from "vitest";
import { rankChunks, searchTerms, toTsQuery } from "./retrieval";
import { checkExplanation, checkQuestions, groundingViolations, NOT_IN_NOTES, parseJsonArray, type Passage } from "./generation";
import { buildProgress, weekStartOf } from "./progress";
import { sm2 } from "@/lib/delivery/reinforcement";

// COMPETEN-IND-004 s2-s6: retrieval, the grounding controls, and progress.

const passage = (content: string, i = 0): Passage => ({
  chunkId: `c${i}`, materialId: "m1", materialTitle: "Renal notes", ordinal: i + 1, pageFrom: i + 4, pageTo: i + 4, content,
});
const AKI = passage("Acute kidney injury is staged by the rise in serum creatinine and by urine output. Stage 3 is a rise to three times baseline. Common causes are prerenal, renal and postrenal.");

describe("retrieval", () => {
  it("drops question words and stopwords, and ORs what is left", () => {
    expect(searchTerms("Can you explain the stages of acute kidney injury?")).toEqual(["stages", "acute", "kidney", "injury"]);
    expect(toTsQuery("explain the stages of AKI")).toBe("stages | aki");
    expect(toTsQuery("explain it to me")).toBeNull();
  });

  it("keeps only letters and digits, so nothing reaches to_tsquery unescaped", () => {
    expect(toTsQuery("sepsis' | !(drop) & table:*")).toBe("sepsis | drop | table");
  });

  it("ranks by distinct terms matched, then frequency, then document order, and drops non-matches", () => {
    const c = (id: string, ordinal: number, content: string) => ({ id, materialId: "m", ordinal, pageFrom: 1, pageTo: 1, content });
    const ranked = rankChunks("acute kidney injury staging", [
      c("a", 1, "Kidney anatomy."),
      c("b", 2, "Acute kidney injury staging uses creatinine."),
      c("c", 3, "Unrelated: asthma inhalers."),
      c("d", 4, "Kidney kidney kidney."),
    ], 5);
    expect(ranked.map(r => r.id)).toEqual(["b", "d", "a"]);
  });
});

describe("explanation grounding", () => {
  it("shows an answer that cites given passages and adds nothing", () => {
    const r = checkExplanation("AKI is staged by the rise in serum creatinine and by urine output [S1].", "explain AKI", [AKI]);
    expect(r).toEqual({ ok: true, text: expect.any(String), cited: [1] });
  });

  it("⚠ withholds an answer with a number the notes do not contain", () => {
    const r = checkExplanation("Stage 3 is a creatinine above 354 umol/L [S1].", "explain AKI stage 3", [AKI]);
    expect(r).toMatchObject({ ok: false, reason: "ungrounded" });
  });

  it("⚠ withholds an answer that asserts a finding-word the notes do not use", () => {
    const r = checkExplanation("Potassium is usually raised in AKI [S1].", "explain AKI", [AKI]);
    expect(r).toMatchObject({ ok: false, reason: "ungrounded", violations: [{ kind: "asserted_finding", token: "raised" }] });
  });

  it("withholds an answer with no citation, or citing a passage it was not given", () => {
    expect(checkExplanation("AKI is staged by creatinine.", "q", [AKI])).toMatchObject({ ok: false, reason: "no_citation" });
    expect(checkExplanation("AKI is staged by creatinine [S2].", "q", [AKI])).toMatchObject({ ok: false, reason: "bad_citation" });
  });

  it("passes on the model's 'not in your notes' answer as exactly that", () => {
    expect(checkExplanation(NOT_IN_NOTES, "q", [AKI])).toEqual({ ok: false, reason: "not_in_notes" });
  });

  it("excuses only the modal verb 'may' from the month check", () => {
    expect(groundingViolations("This may happen.", ["nothing"])).toEqual([]);
    expect(groundingViolations("It happened in June.", ["nothing"])).toEqual([{ kind: "ungrounded_month", token: "june" }]);
  });

  it("treats the citation line the model was shown as grounding, so 'page 4' is not an invented number", () => {
    const r = checkExplanation("As your notes say on page 4, AKI is staged by serum creatinine [S1].", "q", [AKI]);
    expect(r.ok).toBe(true);
  });
});

describe("question checks", () => {
  const good = {
    stem: "How is acute kidney injury staged?",
    options: ["By the rise in serum creatinine and by urine output", "By blood pressure", "By heart rate", "By temperature"],
    correctIndex: 0,
    rationale: "Your notes say it is staged by the rise in serum creatinine and by urine output.",
    sourceQuote: "Acute kidney injury is staged by the rise in serum creatinine and by urine output.",
  };

  it("keeps a well-formed question whose quote is in the passage", () => {
    const r = checkQuestions(JSON.stringify([good]), AKI);
    expect(r.kept).toHaveLength(1);
    expect(r.dropped).toHaveLength(0);
  });

  it("⚠ drops a question whose 'quote' is not actually in the passage", () => {
    const r = checkQuestions(JSON.stringify([{ ...good, sourceQuote: "AKI is diagnosed by ultrasound in all patients." }]), AKI);
    expect(r.kept).toHaveLength(0);
    expect(r.dropped[0].reason).toBe("quote_not_in_passage");
  });

  it("⚠ drops a question that invents a number", () => {
    const r = checkQuestions(JSON.stringify([{ ...good, options: ["Creatinine above 354", "B", "C", "D"] }]), AKI);
    expect(r.dropped[0].reason).toBe("ungrounded");
  });

  it("drops malformed questions: wrong option count, duplicate options, bad index", () => {
    const r = checkQuestions(JSON.stringify([
      { ...good, options: ["a", "b", "c"] },
      { ...good, options: ["a", "a", "b", "c"] },
      { ...good, correctIndex: 4 },
    ]), AKI);
    expect(r.kept).toHaveLength(0);
    expect(r.dropped.map(d => d.reason)).toEqual(["malformed", "malformed", "malformed"]);
  });

  it("reads a JSON array out of a fenced or chatty reply, and refuses non-JSON", () => {
    expect(parseJsonArray("Here you go:\n```json\n[1,2]\n```")).toEqual([1, 2]);
    expect(parseJsonArray("no json")).toBeNull();
    expect(checkQuestions("sorry", AKI).dropped).toEqual([{ reason: "malformed" }]);
  });
});

describe("revision uses the estate's SM-2, unchanged", () => {
  it("a miss (quality 1) restarts the schedule, a good recall extends it", () => {
    expect(sm2({ ease: 2.5, interval: 6, reps: 2 }, 1)).toMatchObject({ reps: 0, interval: 1 });
    expect(sm2({ ease: 2.5, interval: 1, reps: 1 }, 4)).toMatchObject({ reps: 2, interval: 6 });
  });
});

describe("progress", () => {
  const today = "2026-10-22";
  it("⚠ reports not-measured as null, never as zero", () => {
    const p = buildProgress({ materials: [{ id: "m1", title: "Renal" }], questions: [{ id: "q1", materialId: "m1", kind: "mcq" }], attempts: [], cards: [], today });
    expect(p.materials[0]).toMatchObject({ mastery: null, latestCorrect: null, answered: 0, questions: 1 });
    expect(p.trend.every(w => w.accuracy === null && w.attempts === 0)).toBe(true);
    expect(p.trend).toHaveLength(8);
  });

  it("measures mastery from the LATEST answer to each question, and counts due cards", () => {
    const p = buildProgress({
      materials: [{ id: "m1", title: "Renal" }],
      questions: [{ id: "q1", materialId: "m1", kind: "mcq" }, { id: "q2", materialId: "m1", kind: "case" }],
      attempts: [
        { questionId: "q1", correct: false, answeredAt: "2026-10-20T10:00:00Z" },
        { questionId: "q1", correct: true, answeredAt: "2026-10-21T10:00:00Z" },
        { questionId: "q2", correct: false, answeredAt: "2026-10-21T11:00:00Z" },
      ],
      cards: [{ materialId: "m1", status: "active", nextReviewAt: "2026-10-22" }, { materialId: "m1", status: "active", nextReviewAt: "2026-10-30" }],
      today,
    });
    expect(p.materials[0]).toMatchObject({ answered: 2, latestCorrect: 1, mastery: 50, cardsDue: 1, cardsActive: 2 });
    expect(p.trend.at(-1)).toMatchObject({ weekStart: "2026-10-19", attempts: 3, correct: 1, accuracy: 33 });
  });

  it("weeks start on Monday", () => {
    expect(weekStartOf("2026-10-25T23:00:00Z")).toBe("2026-10-19");
    expect(weekStartOf("2026-10-19T00:00:00Z")).toBe("2026-10-19");
  });
});
