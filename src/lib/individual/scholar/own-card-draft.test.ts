import { describe, expect, it } from "vitest";
import { draftOwnCard } from "./own-card-draft";
import { checkPersonalCard } from "./flashcards";

describe("draftOwnCard (Practise this lesson: the learner's own card)", () => {
  const points = [
    "The natural blink reflex moistens the eyes and protects against infection [S2].",
    "In critical care the reflex may be slowed or absent because of sedatives or muscle relaxants.",
    "Eyes that cannot close lose their tear film faster, raising the risk of keratopathy.",
  ];

  it("asks for the key points on the front and lists exactly those points on the back, one per line", () => {
    const d = draftOwnCard("Eye care", points, "Explain eye care in the critically ill");
    expect(d.front).toBe("What are the key points of Eye care?");
    expect(d.back.split("\n")).toEqual([
      "- The natural blink reflex moistens the eyes and protects against infection.",
      "- In critical care the reflex may be slowed or absent because of sedatives or muscle relaxants.",
      "- Eyes that cannot close lose their tear film faster, raising the risk of keratopathy.",
    ]);
  });

  it("never pairs a check question with the key points (the old mismatch)", () => {
    const d = draftOwnCard("Eye care", points, null);
    expect(d.front).not.toMatch(/grading system/i);
    expect(d.front.startsWith("What are the key points of")).toBe(true);
  });

  it("cuts at a whole point within 600 characters, never mid-sentence", () => {
    const long = Array.from({ length: 12 }, (_, i) => `Point ${i + 1}: ${"word ".repeat(18).trim()}.`);
    const d = draftOwnCard("Long lesson", long, null);
    expect(d.back.length).toBeLessThanOrEqual(600);
    for (const line of d.back.split("\n")) expect(line).toMatch(/^- Point \d+: .*\.$/);
  });

  it("falls back to the objective when the lesson has no key points", () => {
    expect(draftOwnCard("Bed bath", [], "Plan a safe bed bath")).toEqual({ front: "What is Bed bath about?", back: "Plan a safe bed bath" });
    expect(draftOwnCard(null, [], null)).toEqual({ front: "What is this lesson about?", back: "" });
  });

  it("produces a card the save route accepts as written", () => {
    const d = draftOwnCard("Eye care", points, null);
    const r = checkPersonalCard(d, new Set());
    expect(r.ok).toBe(true);
  });
});
