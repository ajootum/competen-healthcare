import { describe, expect, it } from "vitest";
import { decidePrerequisite, frameworkPrerequisite, latestByItem, repeatedNamed, type CatalogueNode, type LinkedSection } from "./prerequisite";
import type { StateEvidence } from "./learning-state";

const ev = (o: Partial<StateEvidence> & { itemId: string }): StateEvidence => ({
  attemptId: null, topicKey: "oxygen therapy", chunkId: "c-oxy", materialId: "m1", source: "check", level: "understanding",
  outcome: 0, marking: "ai_evaluation", at: "2026-11-01T09:00:00Z", confidence: null, misconceptions: [], ...o,
});
const catalogue = new Map<string, CatalogueNode>([
  ["oxy", { id: "oxy", title: "Assess oxygen requirement", framework: "Nursing: Respiratory Care", prerequisites: ["resp", "outside-catalogue"] }],
  ["resp", { id: "resp", title: "Performs a systematic respiratory assessment", framework: "Nursing: Respiratory Care", prerequisites: [] }],
]);
const sections: LinkedSection[] = [
  { chunkId: "c-oxy", materialId: "m1", competencyId: "oxy", label: "Respiratory notes: oxygen" },
  { chunkId: "c-resp", materialId: "m1", competencyId: "resp", label: "Respiratory notes: assessment" },
];
const topic = { key: "oxygen therapy", label: "Oxygen therapy", chunkIds: ["c-oxy"] };
const missed3 = [ev({ itemId: "a" }), ev({ itemId: "b" }), ev({ itemId: "c", outcome: 0.5 })];
const decide = (rows: StateEvidence[], o: { competencies?: string[]; byChunk?: Map<string, StateEvidence[]>; cat?: Map<string, CatalogueNode> } = {}) =>
  decidePrerequisite({ topic, rows, topicCompetencies: o.competencies ?? ["oxy"], catalogue: o.cat ?? catalogue, sections, evidenceByChunk: o.byChunk ?? new Map(), thresholds: { misses: 3, distinctQuestions: 2 } });

describe("SALE-09 prerequisite suggestions", () => {
  it("latestByItem reads the latest marked answer per question", () => {
    expect(latestByItem([ev({ itemId: "a" }), ev({ itemId: "a", outcome: 1, at: "2026-11-02T00:00:00Z" }), ev({ itemId: "b" })])).toEqual({ missed: ["b"], right: ["a"], latestRight: true });
  });
  it("P4: several different misses + a framework prerequisite the answers do not show = a focused review of the learner's own notes", () => {
    const d = decide(missed3);
    expect(d.kind).toBe("suggest");
    if (d.kind !== "suggest") return;
    expect(d.suggestion).toMatchObject({ rule: "P4", prerequisite: { id: "resp", framework: "Nursing: Respiratory Care" }, competency: { id: "oxy" }, section: { chunkId: "c-resp" } });
    expect(d.suggestion.reason).toMatch(/framework lists "Performs a systematic respiratory assessment" as coming first/);
    expect(d.suggestion.evidence[0]).toMatch(/3 different questions/);
  });
  it("P0: one or two misses are never read as a missing foundation", () => {
    expect(decide([ev({ itemId: "a" })])).toMatchObject({ kind: "none", rule: "P0" });
    expect(decide([ev({ itemId: "a" }), ev({ itemId: "b" })])).toMatchObject({ kind: "none", rule: "P0" });
    // the same question missed three times is still one question
    expect(decide([ev({ itemId: "a" }), ev({ itemId: "a", at: "2026-11-02T00:00:00Z" }), ev({ itemId: "a", at: "2026-11-03T00:00:00Z" })])).toMatchObject({ rule: "P0" });
  });
  it("P1: a misconception repeated on different questions explains it better: no prerequisite", () => {
    const rows = [ev({ itemId: "a", misconceptions: ["More oxygen is always better"] }), ev({ itemId: "b", misconceptions: ["more oxygen is always better"] }), ev({ itemId: "c" })];
    expect(repeatedNamed(rows)).toMatch(/always better/);
    expect(decide(rows)).toMatchObject({ kind: "none", rule: "P1" });
  });
  it("P2: no framework link (or only to a competency outside the catalogue): no suggestion here", () => {
    expect(decide(missed3, { competencies: [] })).toMatchObject({ kind: "none", rule: "P2" });
    const cat = new Map([["oxy", { ...catalogue.get("oxy")!, prerequisites: ["outside-catalogue"] }]]);
    expect(decide(missed3, { cat })).toMatchObject({ kind: "none", rule: "P2" });
  });
  it("P3: the learner's answers already show the prerequisite: the difficulty is likely elsewhere", () => {
    const byChunk = new Map([["c-resp", [ev({ itemId: "r1", chunkId: "c-resp", outcome: 1 }), ev({ itemId: "r2", chunkId: "c-resp", outcome: 1 })]]]);
    expect(decide(missed3, { byChunk })).toMatchObject({ kind: "none", rule: "P3" });
  });
  it("still suggests when the prerequisite's own evidence is thin or its latest answer missed", () => {
    const byChunk = new Map([["c-resp", [ev({ itemId: "r1", chunkId: "c-resp", outcome: 1 }), ev({ itemId: "r2", chunkId: "c-resp", outcome: 1, at: "2026-10-01T00:00:00Z" }), ev({ itemId: "r3", chunkId: "c-resp", outcome: 0, at: "2026-11-03T00:00:00Z" })]]]);
    const d = decide(missed3, { byChunk });
    expect(d.kind).toBe("suggest");
    if (d.kind === "suggest") expect(d.suggestion.evidence[2]).toMatch(/2 questions answered well, not yet enough/);
  });
  it("with no notes linked to the prerequisite, suggests learning it by name", () => {
    const d = frameworkPrerequisite({ topic, missed: 3, topicCompetencies: ["oxy"], catalogue, sections: sections.filter(s => s.competencyId !== "resp"), evidenceByChunk: new Map() });
    expect(d.kind).toBe("suggest");
    if (d.kind === "suggest") { expect(d.suggestion.section).toBeNull(); expect(d.suggestion.reason).toMatch(/None of your notes covers it yet/); }
  });
  it("never suggests the topic's own section as its prerequisite", () => {
    const self = new Map([["oxy", { ...catalogue.get("oxy")!, prerequisites: ["resp"] }], ["resp", catalogue.get("resp")!]]);
    const d = frameworkPrerequisite({ topic: { ...topic, chunkIds: ["c-oxy", "c-resp"] }, missed: 3, topicCompetencies: ["oxy"], catalogue: self, sections, evidenceByChunk: new Map() });
    expect(d.kind === "suggest" && d.suggestion.section).toBeNull();
  });
});
