import { describe, expect, it } from "vitest";
import { INTENT_SURFACES } from "@/lib/ai/request-intent";
import {
  ASK_CHUNK_MAX, ASK_INTENT_SURFACE, ASK_SURFACES, askPrefill, askRequestBody, ownedPassages, parseAskContext, safeRefLabel, sectionIdsInHref, sessionIdInHref,
} from "./ask-context";
import { QUESTION_MAX } from "./config";

// SCHOLAR-CE-2026 CE-01: the typed context an in-place "Ask about this" question carries. Pure.

const id = (n: number) => `aaaaaaaa-0000-4000-8000-${String(n).padStart(12, "0")}`;

describe("parseAskContext", () => {
  it("absent is fine (the route behaves as before); a non-object or unknown surface is refused", () => {
    expect(parseAskContext(undefined)).toEqual({ ok: true, value: null });
    expect(parseAskContext(null)).toEqual({ ok: true, value: null });
    expect(parseAskContext("revise").ok).toBe(false);
    expect(parseAskContext([]).ok).toBe(false);
    expect(parseAskContext({ surface: "billing", chunkIds: [id(1)] }).ok).toBe(false);
    expect(parseAskContext({}).ok).toBe(false);
  });

  it("caps the sections at six, de-duplicates and drops anything that is not a well-formed id", () => {
    const many = Array.from({ length: 12 }, (_, i) => id(i + 1));
    const r = parseAskContext({ surface: "revise", chunkIds: [...many, id(1), "not-an-id", 7, null, "x or 1=1"] });
    expect(r.ok && r.value!.chunkIds).toEqual(many.slice(0, ASK_CHUNK_MAX));
    expect(ASK_CHUNK_MAX).toBe(6);
    const d = parseAskContext({ surface: "flashcards", chunkIds: [id(1), id(1), id(1).toUpperCase()] });
    expect(d.ok && d.value!.chunkIds).toEqual([id(1)]);
    expect(parseAskContext({ surface: "case", chunkIds: "nope" })).toMatchObject({ ok: true, value: { chunkIds: [] } });
  });

  it("bounds the free text and ignores malformed material and study ids", () => {
    const r = parseAskContext({ surface: "osce", refLabel: `  ${"x".repeat(500)}  `, prefill: "y".repeat(5000), materialId: "bad", studyId: id(9) });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value!.refLabel!.length).toBe(120);
    expect(r.value!.prefill!.length).toBe(QUESTION_MAX);
    expect(r.value!.materialId).toBeNull();
    expect(r.value!.studyId).toBe(id(9));
    expect(parseAskContext({ surface: "osce", refLabel: "   " })).toMatchObject({ value: { refLabel: null } });
  });
});

describe("surface mapping", () => {
  it("maps every ask surface onto an EXISTING intent surface (framing only)", () => {
    for (const s of ASK_SURFACES) expect(INTENT_SURFACES).toContain(ASK_INTENT_SURFACE[s]);
    expect(ASK_INTENT_SURFACE).toMatchObject({ revise: "revise", flashcards: "revise", case: "apply", osce: "apply", plan: "learn", library: "learn", learn: "learn", personal_ai: "personal_ai" });
  });
  it("a patient-identifier shape never reaches the intent layer as framing", () => {
    expect(safeRefLabel("Question feedback")).toBe("Question feedback");
    expect(safeRefLabel("Bed 4 NHS number 943 476 5919")).toBeNull();
    expect(safeRefLabel(null)).toBeNull();
  });
});

describe("ownedPassages: the client's ids are claims", () => {
  const A = new Map([[id(1), { chunkId: id(1) }], [id(2), { chunkId: id(2) }]]);
  const readAs = (owner: Map<string, { chunkId: string }>) => async (c: string) => owner.get(c) ?? null;

  it("keeps the caller's own sections, in order, and drops the rest without failing", async () => {
    const r = await ownedPassages([id(2), id(3), id(1)], readAs(A));
    expect(r.passages.map(p => p.chunkId)).toEqual([id(2), id(1)]);
    expect(r.dropped).toBe(1);
  });
  it("learner B naming learner A's sections gets nothing (a read that fails is also a drop)", async () => {
    const B = new Map<string, { chunkId: string }>();
    expect(await ownedPassages([id(1), id(2)], readAs(B))).toEqual({ passages: [], dropped: 2 });
    expect((await ownedPassages([id(1)], async () => { throw new Error("db"); })).passages).toEqual([]);
  });
});

describe("askRequestBody", () => {
  it("grounded questions ask, ungrounded ones teach; the context is typed and capped", () => {
    const grounded = askRequestBody({ question: "Why?", context: { surface: "revise", chunkIds: Array.from({ length: 9 }, (_, i) => id(i + 1)), refLabel: "Q" }, depth: "quick" });
    expect(grounded.mode).toBe("ask");
    expect((grounded.askContext as { chunkIds: string[] }).chunkIds).toHaveLength(6);
    const general = askRequestBody({ question: "Why?", context: { surface: "osce", chunkIds: [] } });
    expect(general.mode).toBe("teach");
    expect(askRequestBody({ question: "Why?", context: { surface: "library" }, sessionId: id(5), step: 2 })).toMatchObject({ mode: "ask", sessionId: id(5), step: 2 });
  });
});

describe("prefill and plan links", () => {
  it("offers a short editable question, bounded", () => {
    expect(askPrefill("revise", { stem: "Which finding defines stage 3 AKI?", correct: false })).toContain("Which finding defines stage 3 AKI?");
    expect(askPrefill("revise", { correct: true })).toBe("Explain why this answer is right.");
    expect(askPrefill("flashcard", { stem: "Front", answer: "Back" })).toContain("Back");
    expect(askPrefill("flashcard", { stem: "x".repeat(9000) }).length).toBeLessThanOrEqual(QUESTION_MAX);
    expect(askPrefill("plan", { title: "Revisit renal" })).toContain("Revisit renal");
  });
  it("reads the section and session out of a plan link", () => {
    expect(sectionIdsInHref(`/individual/scholar/study/learn?section=${id(4)}&x=1`)).toEqual([id(4)]);
    expect(sectionIdsInHref("/individual/scholar/study/learn?topic=renal")).toEqual([]);
    expect(sessionIdInHref(`/individual/scholar/study/learn?session=${id(6)}`)).toBe(id(6));
    expect(sessionIdInHref(null)).toBeNull();
  });
});
