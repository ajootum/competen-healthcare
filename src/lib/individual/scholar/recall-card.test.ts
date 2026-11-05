import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { RECALL } from "./recall-choices";
import * as flashcards from "./flashcards";

// ONE FLASHCARD (owner, 5 Nov 2026): every flashcard activity uses recall-card.tsx. Asserted on the source, as flashcards-layout.test.ts does.
const STUDY = "src/app/individual/(app)/[experience]/(scholar)/study/_components";
const read = (f: string) => readFileSync(`${STUDY}/${f}`, "utf8");
const card = read("recall-card.tsx"), fcClient = read("flashcards-client.tsx"), revision = read("revision-client.tsx"), client = read("client.tsx"), inline = read("learn-inline-check.tsx");

describe("the shared recall card", () => {
  it("Standard Recall is two buttons on qualities 1 and 4, shared with flashcards.ts", () => {
    expect(RECALL.again.quality).toBe(1);
    expect(RECALL.remembered.quality).toBe(4);
    expect(flashcards.RECALL).toBe(RECALL);
    expect(card).toContain("RECALL.again.label");
    expect(card).toContain("RECALL.remembered.label");
  });
  it("the flip control is named, the hidden face is aria-hidden, the back is aria-live, motion is reduced, touch targets are 44px", () => {
    expect(card).toContain('aria-label={revealed ? "Show the question again" : "Reveal the answer"}');
    expect(card).toContain("aria-hidden={hidden}");
    expect(card).toMatch(/aria-live=\{side === "back" \? "polite" : undefined\}/);
    expect(card).toContain("motion-reduce:transition-none");
    expect(card).toMatch(/pointer-coarse:min-h-\[var\(--cmp-touch-min\)\]/);
  });
  it("the recall buttons appear only after the flip, and not once rated", () => {
    expect(card).toContain("{revealed && !rated && <RatingButtons");
  });
  it("it imports nothing from the screens that use it (no import cycle)", () => {
    expect(card).not.toMatch(/from "\.\/(flashcards-client|client|revision-client|learn-inline-check)"/);
  });
  it("the study session, Revise, cards due and the lesson check all render it", () => {
    expect(fcClient).toContain("<FlipCard");
    expect(fcClient).toContain("<RatingButtons");
    expect(revision).toContain("<RecallCard front={item.stem}");
    expect(client).toContain("<RecallCard front={card.stem}");
    expect(inline).toContain("<RecallCard front={card.front}");
  });
  it("a Revise flashcard rates with RECALL qualities and its prompt is not shown twice; cards due has no five-grade scale", () => {
    expect(revision).toContain("send({ quality: RECALL[c].quality })");
    expect(revision).toContain('(item.kind !== "flashcard" || answered) &&');
    expect(revision).not.toContain("Show the answer</button>: ");
    expect(client).not.toContain("const GRADES");
    expect(client).toContain("RECALL[choice].quality");
    expect(client).toContain('aria-label="Previous card"');
    expect(client).toContain('aria-label="Next card"');
    expect(inline).toContain("Your own judgement — not a test score.");
  });
});

describe("evidence honesty", () => {
  const route = readFileSync("src/app/api/individual/scholar/revision/sessions/[id]/route.ts", "utf8");
  it("the session summary leaves self-rated flashcards out of 'matched your notes' and reports them apart", () => {
    expect(route).toContain("correct: marked.filter(a => !recallIds.has(a.questionId) && a.correct).length");
    expect(route).toContain("selfRated: rated.length");
    expect(revision).toContain("that is your own judgement, not a marked answer");
  });
  it("Knowledge accuracy, mastery and learning state do not count a flashcard rating twice or as a marked answer", () => {
    expect(readFileSync("src/lib/individual/scholar/intelligence.ts", "utf8")).toContain('(q.kind as string) !== "flashcard"');
    for (const f of ["mastery-data.ts", "learning-state-data.ts"]) expect(readFileSync(`src/lib/individual/scholar/${f}`, "utf8")).toContain('if (q.kind === "flashcard") continue;');
  });
});
