import { describe, expect, it } from "vitest";
import { buildEvidence, checkAnswer, checkCitedText, matchLibrary, splitTranscription } from "./exam-answer";
import type { Passage } from "./generation";

const passage: Passage = {
  chunkId: "c1", materialId: "m1", materialTitle: "Respiratory notes", ordinal: 2, pageFrom: 4, pageTo: 4,
  content: "Measure the respiratory rate for a full minute. A low oxygen saturation shows hypoxaemia.",
};
const evidence = buildEvidence(
  [passage],
  [{ id: "k1", code: "RS1", title: "Assess respiratory status", outcome: "Records the respiratory rate", contentStatus: "approved" }],
  [{ url: "https://www.who.int/x", title: "WHO guidance", publisher: "www.who.int", published: "2025-03-01", retrievedAt: "2026-10-26T10:00:00Z", excerpt: "Count the respiratory rate over a full minute." }],
);
const Q = "Question 2: The adult respiratory rate is measured over\nA. 10 seconds\nB. 30 seconds\nC. a full minute";
const answer = (o: Record<string, unknown>) => JSON.stringify({
  option: "C", examAnswer: "Over a full minute [N1].", explanation: "Your notes say to measure it for a full minute [N1].",
  optionNotes: [{ label: "C", note: "Matches the notes [N1]." }], currentGuidance: "Current guidance also counts over a full minute [W1].",
  guidanceStatus: "agrees", conflicts: [], unsupported: [], uncertainty: [], ...o,
});

describe("exam evidence: three kinds, each tagged and cited by its tag", () => {
  it("tags notes N, library L and web W, with provenance kept", () => {
    expect(evidence.map(e => e.tag)).toEqual(["N1", "L1", "W1"]);
    expect(evidence[0]).toMatchObject({ kind: "notes", chunkId: "c1", citation: "Respiratory notes, page 4" });
    expect(evidence[1]).toMatchObject({ kind: "library", status: "approved" });
    expect(evidence[2]).toMatchObject({ kind: "web", url: "https://www.who.int/x", published: "2025-03-01", retrievedAt: "2026-10-26T10:00:00Z" });
  });

  it("matches library entries to the question by shared words, never by one word", () => {
    const entries = [
      { id: "a", code: null, title: "Assess respiratory status", outcomes: ["Measures the respiratory rate accurately"], contentStatus: "draft" },
      { id: "b", code: null, title: "Wound care", outcomes: [], contentStatus: "approved" },
    ];
    expect(matchLibrary("How is the respiratory rate measured accurately?", entries).map(e => e.id)).toEqual(["a"]);
    expect(matchLibrary("respiratory", entries)).toEqual([]);
  });
});

describe("checkAnswer: shown only when it cites its evidence and adds nothing to it", () => {
  it("accepts a cited, grounded answer and keeps exam context apart from current guidance", () => {
    const r = checkAnswer(answer({}), evidence, Q, ["A", "B", "C"]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.content.option).toBe("C");
    expect(r.content.guidanceStatus).toBe("agrees");
    expect(r.content.cited).toEqual(expect.arrayContaining(["N1", "W1"]));
  });

  it("withholds an answer that cites nothing, or a tag it was not given", () => {
    expect(checkAnswer(answer({ examAnswer: "Over a full minute.", explanation: "", optionNotes: [], currentGuidance: null }), evidence, Q, ["A", "B", "C"])).toMatchObject({ ok: false, reason: "no_citation" });
    expect(checkAnswer(answer({ examAnswer: "Over a full minute [W7]." }), evidence, Q, ["A", "B", "C"])).toMatchObject({ ok: false, reason: "bad_citation" });
    expect(checkAnswer(answer({ conflicts: [{ claim: "x [N1]", tags: ["L9"] }] }), evidence, Q, ["A", "B", "C"])).toMatchObject({ ok: false, reason: "bad_citation" });
  });

  it("withholds an answer carrying a number the evidence does not contain", () => {
    expect(checkAnswer(answer({ explanation: "Count for 45 seconds and multiply [N1]." }), evidence, Q, ["A", "B", "C"])).toMatchObject({ ok: false, reason: "ungrounded" });
  });

  it("does not show guidance that cites no current source, and says why", () => {
    const r = checkAnswer(answer({ currentGuidance: "Guidance says a full minute [N1].", guidanceStatus: "agrees" }), evidence, Q, ["A", "B", "C"]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.content.currentGuidance).toBeNull();
    expect(r.content.guidanceStatus).toBe("no_current_source");
    expect(r.content.uncertainty.join(" ")).toMatch(/cited no current source/);
  });

  it("drops an option label the question does not have, and reads malformed output as malformed", () => {
    const r = checkAnswer(answer({ option: "E", optionNotes: [{ label: "E", note: "x [N1]" }] }), evidence, Q, ["A", "B", "C"]);
    expect(r.ok && r.content.option).toBeNull();
    expect(r.ok && r.content.optionNotes).toEqual([]);
    expect(checkAnswer("not json", evidence, Q, ["A"])).toMatchObject({ ok: false, reason: "malformed" });
  });

  it("refuses output that looks like it identifies a patient", () => {
    expect(checkAnswer(answer({ explanation: "As for NHS number 943 476 5919 [N1]." }), evidence, Q, ["A", "B", "C"])).toMatchObject({ ok: false });
  });
});

describe("follow-ups and guides use the same check", () => {
  it("needs a citation and nothing ungrounded", () => {
    expect(checkCitedText("A full minute is counted [N1].", evidence, [Q])).toMatchObject({ ok: true, cited: ["N1"] });
    expect(checkCitedText("A full minute is counted.", evidence, [Q])).toMatchObject({ ok: false, reason: "no_citation" });
    expect(checkCitedText("Count for 15 seconds [N1].", evidence, [Q])).toMatchObject({ ok: false, reason: "ungrounded" });
  });
});

describe("transcription: pages kept by their markers, nothing else", () => {
  it("splits by PAGE markers, keeps only the pages asked for, and bounds figure notes", () => {
    const raw = "Here is the transcription\nPAGE 3\n1. Name a sign of sepsis [UNREADABLE]\n[FIGURE: chart]\nPAGE 4\n2. Define hypoxaemia\nPAGE 9\nnot asked";
    expect(splitTranscription(raw, [3, 4])).toEqual([
      { page: 3, text: "1. Name a sign of sepsis [UNREADABLE]\n[FIGURE: chart]" },
      { page: 4, text: "2. Define hypoxaemia" },
    ]);
  });
});
