import { describe, expect, it } from "vitest";
import { notebookBackPath, parseNotebookReturn, pastMisconceptions, practicePath, practiceScopes, relatedFor, withNotebook, type KeptCheckInput, type LibraryIndex } from "./notebook";
import { validateNote } from "./saved-library";

const M1 = "11111111-1111-4111-8111-111111111111", M2 = "22222222-2222-4222-8222-222222222222";
const C1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1", C2 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2", C3 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3", C4 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4";
const N1 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";

const kept = (o: Partial<KeptCheckInput>): KeptCheckInput => ({
  attemptId: "a1", questionId: "q1", question: "Why?", at: "2026-11-03T10:00:00Z", sessionId: "s1", step: 1, materialId: M1, chunkId: C1, outcome: "wrong",
  adaptiveMisconception: null, feedbackMisconceptions: [], ...o,
});

describe("SALE-12 revisit previous misconceptions", () => {
  it("groups the misconceptions of wrong or partly right checks by wording, counting different questions, newest first", () => {
    const r = pastMisconceptions([
      kept({ adaptiveMisconception: "Preload is the same as afterload" }),
      kept({ attemptId: "a2", questionId: "q2", at: "2026-11-04T09:00:00Z", feedbackMisconceptions: ["preload is the SAME as afterload."] }),
      kept({ attemptId: "a3", questionId: "q3", at: "2026-11-01T09:00:00Z", outcome: "partly", feedbackMisconceptions: ["Diuretics cure heart failure"] }),
      kept({ attemptId: "a4", questionId: "q4", outcome: "right", feedbackMisconceptions: ["Ignored on a right answer"] }),
      kept({ attemptId: "a5", questionId: "q5", feedbackMisconceptions: ["Nothing to correct — your answer stayed close to the notes"] }),
    ]);
    expect(r.map(m => [m.text, m.questions])).toEqual([["Preload is the same as afterload", 2], ["Diuretics cure heart failure", 1]]);
    expect(r[0].latest.attemptId).toBe("a2");
  });
  it("marks one answered well since in the same lesson, and lists it after the open ones", () => {
    const r = pastMisconceptions([
      kept({ adaptiveMisconception: "Old idea", at: "2026-11-04T08:00:00Z" }),
      kept({ attemptId: "a2", questionId: "q2", outcome: "right", at: "2026-11-04T09:00:00Z" }),
      kept({ attemptId: "a3", questionId: "q3", sessionId: "s2", adaptiveMisconception: "Open idea", at: "2026-11-01T08:00:00Z" }),
    ]);
    expect(r.map(m => [m.text, m.answeredWellSince])).toEqual([["Open idea", false], ["Old idea", true]]);
  });
});

describe("SALE-12 find related materials (the learner's own library only)", () => {
  const idx: LibraryIndex = {
    sections: [
      { chunkId: C1, materialId: M1, topics: ["Preload"] }, { chunkId: C2, materialId: M1, topics: ["Preload", "Starling"] },
      { chunkId: C3, materialId: M2, topics: ["preload"] }, { chunkId: C4, materialId: M2, topics: ["Renal"] },
    ],
    artefacts: [{ id: "art1", materialId: M1, sources: [C1], title: "Preload explained" }, { id: "art2", materialId: M2, sources: [C4], title: "Kidneys" }],
    notes: [{ id: N1, materialId: M1, chunkIds: [C1] }, { id: "n2", materialId: M1, chunkIds: [C1] }, { id: "n3", materialId: M1, chunkIds: [] }, { id: "n4", materialId: M2, chunkIds: [C4] }],
    materialTitle: new Map([[M1, "Cardio notes"], [M2, "Pharm notes"]]),
  };
  it("saved lessons on the same section first, then shared-topic sections (other materials first), then the learner's other notes", () => {
    const r = relatedFor({ id: N1, materialId: M1, chunkIds: [C1] }, idx, 10);
    expect(r.map(x => x.kind === "section" ? `section:${x.chunkId}` : `${x.kind}:${x.id}`)).toEqual([
      "saved_lesson:art1", `section:${C3}`, `section:${C2}`, "note:n2", "note:n3",
    ]);
    expect(r.find(x => x.kind === "section")!.why).toBe("Also about preload");
    expect(r.some(x => "id" in x && x.id === N1)).toBe(false);
    expect(r.some(x => "id" in x && (x.id === "art2" || x.id === "n4"))).toBe(false);
  });
  it("keeps to the maximum", () => {
    expect(relatedFor({ id: N1, materialId: M1, chunkIds: [C1] }, idx, 2)).toHaveLength(2);
  });
});

describe("SALE-12 generate practice from selected notes (through the existing Revise builder)", () => {
  it("one scope per material with the notes' sections, notes on a whole material left out and counted", () => {
    const r = practiceScopes([
      { id: "1", materialId: M1, chunkIds: [C1, C2] }, { id: "2", materialId: M1, chunkIds: [C2] }, { id: "3", materialId: M2, chunkIds: [C3] }, { id: "4", materialId: M2, chunkIds: [] },
    ]);
    expect(r).toEqual({ scopes: [{ materialId: M1, chunkIds: [C1, C2], notes: 2 }, { materialId: M2, chunkIds: [C3], notes: 1 }], withoutSection: 1 });
  });
  it("opens Revise on the material and only those sections, carrying the way back", () => {
    expect(practicePath({ materialId: M1, chunkIds: [C1, C2], notes: 2 }, "1")).toBe(`study/revise?material=${M1}&sections=${C1},${C2}&nb=1`);
  });
  it("caps the notes and the sections", () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ id: String(i), materialId: M1, chunkIds: [`c${i}`] }));
    const r = practiceScopes(many);
    expect(r.scopes[0].notes).toBe(20);
    expect(r.scopes[0].chunkIds.length).toBe(20);
  });
});

describe("SALE-12 keeping context between the Notebook, lessons and questions", () => {
  it("adds nb before any #anchor and reads it back, refusing anything but 1 or a note id", () => {
    expect(withNotebook("study/learn?session=s#lesson-2", N1)).toBe(`study/learn?session=s&nb=${N1}#lesson-2`);
    expect(withNotebook(`study/${M1}`, "1")).toBe(`study/${M1}?nb=1`);
    expect(parseNotebookReturn("1")).toEqual({ note: null });
    expect(parseNotebookReturn(N1.toUpperCase())).toEqual({ note: N1 });
    expect(parseNotebookReturn("https://evil.example")).toBeNull();
    expect(parseNotebookReturn(null)).toBeNull();
    expect(notebookBackPath({ note: N1 })).toBe(`study/saved?view=notebook#n-${N1}`);
  });
});

describe("SALE-12 personal summaries (975 note kind summary)", () => {
  it("validates a summary like a note: body required, no quote kept", () => {
    expect(validateNote({ kind: "summary", targetKind: "material", materialId: M1, body: " My summary ", quote: "x" })).toEqual({ ok: true, note: { targetKind: "material", materialId: M1, kind: "summary", body: "My summary", quote: null } });
    expect(validateNote({ kind: "summary", targetKind: "material", materialId: M1, body: "  " })).toMatchObject({ ok: false, problem: "body" });
    expect(validateNote({ kind: "summaries", targetKind: "material", materialId: M1, body: "x" })).toMatchObject({ ok: false, problem: "kind" });
  });
});
