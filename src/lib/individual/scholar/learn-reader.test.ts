import { describe, expect, it } from "vitest";
import { competencyLines, independentNotice, readAnchor, READ_ANCHOR, readerOpenByDefault, readerSections, relatedWords, splitSectionText } from "./learn-reader";

describe("SCHOLAR-INDEPENDENT-LEARNING-01: the independent reader model", () => {
  it("anchors are valid 790 card-id parts, one per section ordinal", () => {
    expect(readAnchor(14)).toBe("s14");
    expect(READ_ANCHOR.test(readAnchor(3))).toBe(true);
    expect(/^[a-z0-9][a-z0-9_-]{0,39}$/.test(readAnchor(120))).toBe(true);
  });
  it("splits a slide into heading, text and speaker notes without losing words", () => {
    const r = splitSectionText("Eye care\nClean from inner to outer canthus.\nSpeaker notes:\nUse sterile water.", "Eye care");
    expect(r.body).toBe("Clean from inner to outer canthus.");
    expect(r.notes).toBe("Use sterile water.");
    const noHeading = splitSectionText("The nurse must assess the airway first.", null);
    expect(noHeading.body).toBe("The nurse must assess the airway first.");
    expect(noHeading.notes).toBeNull();
  });
  it("orders sections by ordinal and keeps the AI-read note with the section", () => {
    const rows = readerSections([
      { chunkId: "b", materialId: "m", materialTitle: "Deck", unit: "slide", ordinal: 2, pageFrom: 2, pageTo: 2, content: "Second", heading: null, citation: "Deck, slide 2", aiReadNote: "Read by AI from the slide picture" },
      { chunkId: "a", materialId: "m", materialTitle: "Deck", unit: "slide", ordinal: 1, pageFrom: 1, pageTo: 1, content: "First", heading: null, citation: "Deck, slide 1", aiReadNote: null },
    ]);
    expect(rows.map(r => r.chunkId)).toEqual(["a", "b"]);
    expect(rows[1].aiReadNote).toMatch(/Read by AI/);
    expect(rows[0].anchor).toBe("s1");
  });
  it("keeps accepted links apart from proposed ones and never counts a proposal as a link", () => {
    const lines = competencyLines(
      [{ chunkId: "a", competencyId: "c1", accepted: true }, { chunkId: "b", competencyId: "c1", accepted: false }, { chunkId: "a", competencyId: "c2", accepted: false }],
      new Map([["c1", { title: "Airway", code: "A1" }], ["c2", { title: "Breathing", code: null }]]),
    );
    expect(lines.map(l => [l.id, l.accepted, l.sections])).toEqual([["c1", true, 2], ["c2", false, 1]]);
  });
  it("says what exists in words, and nothing when nothing does", () => {
    expect(relatedWords({ cards: 3, questions: 5, attempts: 2, cases: 1, stations: 0, savedLessons: 0 })).toBe("3 flashcards · 5 questions (2 attempted) · 1 case");
    expect(relatedWords({ cards: 0, questions: 0, attempts: 0, cases: 0, stations: 0, savedLessons: 0 })).toBeNull();
    expect(relatedWords({ cards: 1, questions: 0, attempts: 0, cases: 0, stations: 2, savedLessons: 1 })).toBe("1 flashcard · 2 OSCE stations · 1 saved explanation");
  });
  it("opens the original text by itself when nothing is taught or AI is off", () => {
    expect(readerOpenByDefault({ hasLesson: false, aiAvailable: true })).toBe(true);
    expect(readerOpenByDefault({ hasLesson: true, aiAvailable: false })).toBe(true);
    expect(readerOpenByDefault({ hasLesson: true, aiAvailable: true })).toBe(false);
  });
  it("the notice says what works, then the shared reason", () => {
    const n = independentNotice({ text: "AI help is off for your account.", next: { label: "Review AI help in Settings", href: "/x" } });
    expect(n.text).toMatch(/^Your notes, saved lessons.*New AI explanations are off: AI help is off/);
    expect(n.next?.href).toBe("/x");
    expect(independentNotice(null).next).toBeNull();
  });
});
