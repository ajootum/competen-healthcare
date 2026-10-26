import { describe, expect, it } from "vitest";
import { leadInFor, linesFromChunks, paperFlagText, parsePaper, questionText, UNREADABLE_MARK } from "./exam-paper";

const chunk = (id: string, page: number, content: string) => ({ id, pageFrom: page, content });

const MCQ = [
  chunk("c1", 1, [
    "Diploma in Nursing: Final Examination",
    "Instructions to candidates",
    "1. Answer ALL questions.",
    "2. Write your answers in the booklet provided.",
    "Time allowed: 2 hours",
    "Section A: Multiple choice",
    "1. Which of the following is the first step in assessing a breathless patient?",
    "A. Give antibiotics",
    "B. Assess the airway",
    "C. Arrange a chest X-ray",
    "D. Record the temperature",
    "2. Choose the best answer. The normal adult respiratory rate is measured over",
    "A. 10 seconds",
    "B. 30 seconds and doubled,",
    "or estimated",
    "C. a full minute",
  ].join("\n")),
  chunk("c2", 2, [
    "Section B: Structured questions",
    "4. A 60-year-old woman is admitted with cough and fever. [10 marks]",
    "(a) List the observations you would record.",
    "(b) Explain why the oxygen saturation matters.",
    "(i) at rest",
    "(ii) on exertion",
    "5. Study the ECG shown in Figure 1 and describe the rhythm. (4 marks)",
  ].join("\n")),
];

describe("parsePaper: reading an examination paper's structure without guessing", () => {
  const paper = parsePaper(linesFromChunks(MCQ), { emptyPages: [3] });
  const byNo = new Map(paper.questions.map(q => [q.number, q]));

  it("keeps the printed instructions, and does not read the numbered instructions as questions", () => {
    expect(paper.instructions).toContain("Answer ALL questions.");
    expect(paper.instructions).toContain("Time allowed: 2 hours");
    expect(byNo.get("1")!.stem).toMatch(/^Which of the following/);
  });

  it("reads numbering, sections, options and option continuation lines as printed", () => {
    const q1 = byNo.get("1")!;
    expect(q1.section).toBe("Section A: Multiple choice");
    expect(q1.options.map(o => o.label)).toEqual(["A", "B", "C", "D"]);
    expect(q1.options[1].text).toBe("Assess the airway");
    expect(q1.pageFrom).toBe(1);
    expect(q1.chunkId).toBe("c1");
    expect(byNo.get("2")!.options[1].text).toBe("B. 30 seconds and doubled, or estimated".slice(3));
  });

  it("separates question-level instructions, and reads marks", () => {
    expect(byNo.get("4")!.marks).toBe(10);
    expect(byNo.get("4")!.stem).not.toMatch(/marks/);
    expect(byNo.get("5")!.marks).toBe(4);
  });

  it("keeps parts and sub-parts with their printed numbers, and the shared lead-in as context", () => {
    expect([...byNo.keys()]).toEqual(expect.arrayContaining(["4", "4(a)", "4(b)", "4(b)(i)", "4(b)(ii)"]));
    expect(byNo.get("4")!.flags.map(f => f.kind)).toContain("lead_in");
    expect(byNo.get("4(b)")!.flags.map(f => f.kind)).toContain("lead_in");
    const lead = leadInFor(byNo.get("4(b)(ii)")!, paper.questions);
    expect(lead).toContain("A 60-year-old woman");
    expect(lead).toContain("Explain why the oxygen saturation matters.");
    expect(questionText(byNo.get("4(a)")!, leadInFor(byNo.get("4(a)")!, paper.questions))).toMatch(/^Context: A 60-year-old woman[\s\S]*Question 4\(a\): List the observations/);
  });

  it("flags what it cannot read instead of guessing: unreadable pages, numbering gaps, figures", () => {
    expect(paper.flags).toContainEqual({ kind: "unreadable_page", page: 3 });
    expect(paper.flags).toContainEqual({ kind: "numbering_gap", after: "2", missing: "3" });
    expect(byNo.get("5")!.flags.map(f => f.kind)).toContain("figure_referenced");
    expect(byNo.get("1")!.flags.map(f => f.kind)).toContain("figure_referenced"); // "chest X-ray" is named: check the page
    expect(paperFlagText({ kind: "unreadable_page", page: 3 })).toMatch(/Nothing was guessed/);
  });

  it("does not take a numbered list inside a stem for new questions", () => {
    const p = parsePaper(linesFromChunks([chunk("x", 1, "1. Describe the steps of hand hygiene.\n5. moments apply in every setting\n2. Name the moments of hand hygiene.")]));
    expect(p.questions.map(q => q.number)).toEqual(["1", "2"]);
    expect(p.questions[0].stem).toContain("5. moments apply");
  });

  it("reads lower-case items as options only when the question asks for a choice, and says so", () => {
    const p = parsePaper(linesFromChunks([chunk("x", 1, "1. Select the correct statement.\na) Oxygen is a medicine\nb) Oxygen needs no prescription")]));
    expect(p.questions[0].options.map(o => o.label)).toEqual(["A", "B"]);
    expect(p.questions[0].flags.map(f => f.kind)).toContain("structure_inferred");
  });

  it("flags a choice question with no options found, and marks transcription and unreadable text", () => {
    const p = parsePaper(linesFromChunks([chunk("x", 1, `1. Which one of the following is correct?\n2. Name a sign of sepsis ${UNREADABLE_MARK}`)]), { transcribedPages: [1] });
    expect(p.questions[0].flags.map(f => f.kind)).toEqual(expect.arrayContaining(["options_missing", "transcribed"]));
    expect(p.questions[1].flags.map(f => f.kind)).toContain("unreadable_text");
    expect(p.flags).toContainEqual({ kind: "transcribed_pages", pages: [1] });
  });

  it("never writes question text that was not there", () => {
    const p = parsePaper(linesFromChunks([chunk("x", 1, "1.\nA. One\nB. Two")]));
    expect(p.questions[0].stem).toBe(UNREADABLE_MARK);
    expect(p.questions[0].flags.map(f => f.kind)).toContain("unreadable_text");
  });

  it("says when no numbered questions were found", () => {
    const p = parsePaper(linesFromChunks([chunk("x", 1, "Notes on asthma.\nInhalers relieve symptoms.")]));
    expect(p.questions).toEqual([]);
    expect(p.flags).toContainEqual({ kind: "no_questions_found" });
  });
});
