import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { citedSources, dropUnknownTags, numberPassages } from "@/lib/individual/personal-ai-sources";
import { assistantSystemPrompt } from "@/lib/individual/personal-ai";
import { ASK_CHUNK_MAX, askRequestBody, parseAskContext } from "./ask-context";
import { GROUNDING_LABELS, answerLabel, askSectionIds, groundingOf, savedLessonChunkIds } from "./ask-grounding";
import { PERSONAL_AI_LABEL, PERSONAL_AI_LABEL_CITED, PERSONAL_AI_LABEL_UNCITED } from "./config";

// SCHOLAR-CE-2026 CE-01 (ask-grounding-01): a saved lesson's ask carries its source chunks, and the label follows what happened.

const id = (n: number) => `bbbbbbbb-0000-4000-8000-${String(n).padStart(12, "0")}`;
const passage = (n: number) => ({ materialTitle: "Quality Improvement Science and Methods", ordinal: n, pageFrom: n, pageTo: n, content: `Section ${n} says PDSA tests a change in the real work setting.` });

describe("savedLessonChunkIds: a saved lesson asks about the chunks it was taught from", () => {
  it("carries its source links in order, well-formed, distinct and at most six", () => {
    const many = Array.from({ length: 9 }, (_, i) => id(i + 1));
    expect(savedLessonChunkIds([...many, id(1), "nope", ""])).toEqual(many.slice(0, ASK_CHUNK_MAX));
    expect(savedLessonChunkIds([id(2).toUpperCase(), id(2)])).toEqual([id(2)]);
  });
  it("a lesson with no source links, or an unreadable list, grounds nothing", () => {
    expect(savedLessonChunkIds([])).toEqual([]);
    expect(savedLessonChunkIds(undefined)).toEqual([]);
    expect(savedLessonChunkIds(null)).toEqual([]);
  });
  it("its ids reach the request body, and survive the server's parse", () => {
    const body = askRequestBody({ question: "What is Study?", context: { surface: "library", chunkIds: savedLessonChunkIds([id(1), id(2)]), materialId: id(7), refLabel: "Saved lesson: PDSA" } });
    expect(body.mode).toBe("ask");
    const parsed = parseAskContext(body.askContext);
    expect(parsed.ok && parsed.value!.chunkIds).toEqual([id(1), id(2)]);
    // and with nothing linked the panel asks as "teach", which is the general explanation it says it is
    expect(askRequestBody({ question: "q", context: { surface: "library", chunkIds: savedLessonChunkIds([]) } }).mode).toBe("teach");
  });
});

describe("askSectionIds: a connected lesson with no section falls back to the panel's own ids", () => {
  it("uses the session's sections when it has some (read by the learner's own id)", () => {
    expect(askSectionIds({ hasSession: true, sessionIds: [id(1)], claimedIds: [id(2)] })).toEqual({ ids: [id(1)], viaClaims: false });
  });
  it("uses the claimed ids, to be ownership-checked, when the session step has none or there is no session", () => {
    expect(askSectionIds({ hasSession: true, sessionIds: [], claimedIds: [id(2)] })).toEqual({ ids: [id(2)], viaClaims: true });
    expect(askSectionIds({ hasSession: false, sessionIds: [], claimedIds: [id(2), id(3)] })).toEqual({ ids: [id(2), id(3)], viaClaims: true });
    expect(askSectionIds({ hasSession: true, sessionIds: [], claimedIds: [] })).toEqual({ ids: [], viaClaims: true });
  });
});

describe("the label decision: provided AND cited", () => {
  it("nothing given: the original general-explanation label", () => {
    expect(groundingOf(0, 0)).toBe("none");
    expect(answerLabel(0, 0)).toBe(PERSONAL_AI_LABEL);
    // cannot cite what was not given, whatever the text says
    expect(groundingOf(0, 2)).toBe("none");
  });
  it("given but not cited (the production case): said so, and NOT claimed as from the notes", () => {
    expect(groundingOf(3, 0)).toBe("uncited");
    const label = answerLabel(3, 0);
    expect(label).toBe(PERSONAL_AI_LABEL_UNCITED);
    expect(label.toLowerCase()).toContain("cited none");
    expect(label.toLowerCase()).toContain("not confirmed as from your notes");
    expect(label).not.toBe(PERSONAL_AI_LABEL_CITED);
  });
  it("given and cited: draws on what it cites, the rest is background", () => {
    expect(groundingOf(3, 1)).toBe("cited");
    expect(answerLabel(3, 1)).toBe(PERSONAL_AI_LABEL_CITED);
  });
  it("the three labels differ, and only the cited one speaks of citing", () => {
    expect(new Set(Object.values(GROUNDING_LABELS)).size).toBe(3);
    expect(PERSONAL_AI_LABEL.toLowerCase()).not.toContain("cites");
  });
  it("composes with the citation parser: an invented tag counts as not cited, a real one as cited", () => {
    const n = numberPassages([passage(1), passage(2)]);
    const none = dropUnknownTags("The Study phase is where you review the data.", n.sources.length);
    expect(answerLabel(n.sources.length, citedSources(none, n.sources).length)).toBe(PERSONAL_AI_LABEL_UNCITED);
    const invented = dropUnknownTags("You review the data [S9].", n.sources.length);
    expect(answerLabel(n.sources.length, citedSources(invented, n.sources).length)).toBe(PERSONAL_AI_LABEL_UNCITED);
    const real = dropUnknownTags("You review the data [S2].", n.sources.length);
    expect(answerLabel(n.sources.length, citedSources(real, n.sources).length)).toBe(PERSONAL_AI_LABEL_CITED);
  });
});

describe("the prompt asks for [S#] markers at every depth, quick included", () => {
  it("Quick mode with passages still requires the tag; without passages no tag rule is added", () => {
    const quick = assistantSystemPrompt("scholar", "ask", { depth: "quick", passages: true });
    expect(quick).toContain("Depth: quick");
    expect(quick).toContain("EVERY depth, quick included");
    expect(quick).toContain("[S1], [S2]");
    expect(assistantSystemPrompt("scholar", "ask", { depth: "quick" })).not.toContain("EVERY depth");
  });
});

describe("the route decides the label from what happened (wiring)", () => {
  const src = readFileSync("src/app/api/individual/scholar/learn/assistant/route.ts", "utf8");
  it("uses answerLabel on both the JSON and the streamed answer, never the constant", () => {
    expect(src).toContain("answerLabel(given(out), cited)");
    expect(src).toContain("...shown(out, a.sources.length), sources");
    expect(src).toContain("...shown(out, a.sources.length), timing");
    expect(src).not.toMatch(/label: PERSONAL_AI_LABEL/);
  });
  it("counts sections as given only when the study material scope was read", () => {
    expect(src).toContain('out.scopesRead.includes("study_context")');
  });
});
