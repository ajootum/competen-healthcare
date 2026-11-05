import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ASK_SOURCES, DEFAULT_ASK_SOURCES, internalSearched, isDefaultSources, offeredAskSources, parseAskSources, researchSearched, searchedLine, toggleAskSource } from "./ask-sources";
import { askAcrossInstruction, askAcrossUserPrompt, checkLibraryPart, runAskAcross, savedLearningPassage, splitAskParts, type Passage } from "./generation";
import { validateCapture } from "./search-history";

const NL = String.fromCharCode(10);
const lines = (...x: string[]) => x.join(NL);
const passage: Passage = { chunkId: "c1", materialId: "m1", materialTitle: "Renal notes", ordinal: 1, pageFrom: 2, pageTo: 2, content: "Escherichia coli is the commonest cause of pyelonephritis." };
const library = [{ title: "Recognise pyelonephritis", text: "Recognise pyelonephritis: identify fever and loin pain in a patient with a urinary infection.", status: "Clinically approved" }];
const research = [{ title: "A cohort study", journal: "J Renal", year: 2024, abstract: "Early imaging changed management in a cohort of adults with pyelonephritis." }];
const ai = (text: string) => (async () => ({ ok: true, text, model: "m", provider: "p" })) as never;

describe("the choice", () => {
  it("starts on the learner's materials, the existing behaviour", () => {
    expect(DEFAULT_ASK_SOURCES).toEqual(["materials"]);
    expect(isDefaultSources(["materials"])).toBe(true);
    expect(isDefaultSources(["materials", "research"])).toBe(false);
    expect(isDefaultSources(["research"])).toBe(false);
  });
  it("reads known sources once each, in the fixed order, and nothing else", () => {
    expect(parseAskSources(["research", "materials", "research", "everything", 3])).toEqual(["materials", "research"]);
    expect(parseAskSources("materials")).toEqual([]);
    expect(parseAskSources(null)).toEqual([]);
  });
  it("allows one or several, and keeps the last one on", () => {
    expect(toggleAskSource(["materials"], "research")).toEqual(["materials", "research"]);
    expect(toggleAskSource(["materials", "research"], "materials")).toEqual(["research"]);
    expect(toggleAskSource(["research"], "research")).toEqual(["research"]);
  });
  it("offers only what can run, and never web, which Ask has no path for", () => {
    expect(offeredAskSources({ savedReady: true, sourceModes: ["notes", "library", "research"], researchOperational: true })).toEqual(["materials", "saved", "library", "research"]);
    expect(offeredAskSources({ savedReady: false, sourceModes: ["notes"], researchOperational: true })).toEqual(["materials"]);
    expect(offeredAskSources({ savedReady: true, sourceModes: ["notes", "research"], researchOperational: false })).toEqual(["materials", "saved"]);
    for (const on of [true, false]) expect(offeredAskSources({ savedReady: on, sourceModes: ["notes", "library", "research", "web"], researchOperational: on })).not.toContain("web");
    expect(ASK_SOURCES).toContain("web");
  });
});

describe("what was searched", () => {
  it("tells found from read: a source only found is never reported as used", () => {
    expect(researchSearched({ state: "searched", evidence: 2, items: 5, shown: true, withheld: false })).toMatchObject({ state: "used", note: "abstracts only, full text not read" });
    expect(researchSearched({ state: "searched", evidence: 0, items: 5, shown: false, withheld: false }).state).toBe("found_only");
    expect(researchSearched({ state: "not_found", evidence: 0, items: 0, shown: false, withheld: false }).state).toBe("no_match");
    expect(researchSearched({ state: "searched", evidence: 2, items: 2, shown: false, withheld: true }).state).toBe("withheld");
  });
  it("says research did not run, and why, when it did not", () => {
    for (const state of ["off", "refused", "limit", "failed"]) expect(researchSearched({ state, evidence: 0, items: 0, shown: false, withheld: false }).state).toBe("not_run");
    expect(searchedLine(researchSearched({ state: "limit", evidence: 0, items: 0, shown: false, withheld: false }))).toBe("Research literature: not searched (today's research allowance is used)");
  });
  it("does not call a source used when its part was not shown", () => {
    expect(internalSearched("library", { failed: false, found: 2, shown: false, withheld: false }).state).toBe("no_match");
    expect(internalSearched("library", { failed: false, found: 2, shown: false, withheld: true }).state).toBe("withheld");
    expect(internalSearched("saved", { failed: true, found: 0, shown: false, withheld: false }).state).toBe("not_run");
  });
});

describe("keeping sources apart", () => {
  it("tags each source its own way in the prompt, and names research as not the notes", () => {
    const u = askAcrossUserPrompt("Why image?", [passage], library, research);
    expect(u).toContain("[S1] (Renal notes");
    expect(u).toContain("[C1] Recognise pyelonephritis");
    expect(u).toContain("EXTERNAL RESEARCH (published abstracts, not my notes)");
    expect(u).toContain("[E1] A cohort study");
  });
  it("asks only for the parts it was given", () => {
    const none = askAcrossInstruction({ passages: false, library: false, research: true });
    expect(none).toContain("There are no passages");
    expect(none).toContain("FROM RESEARCH:");
    expect(none).not.toContain("FROM COMPETEN LIBRARY:");
  });
  it("splits the parts in any order", () => {
    expect(splitAskParts(lines("Notes [S1].", "FROM RESEARCH:", "R [E1].", "FROM COMPETEN LIBRARY:", "L [C1]."))).toEqual({ main: "Notes [S1].", background: null, research: "R [E1].", library: "L [C1]." });
  });
  it("refuses a library part that cites research or the notes, and keeps its own tags", () => {
    expect(checkLibraryPart("A patient may have fever and loin pain [E1].", library, [], "q")).toEqual({ ok: false, reason: "mixed" });
    expect(checkLibraryPart("Identify fever and loin pain in a patient [S1].", library, [], "q")).toMatchObject({ ok: false });
    const ok = checkLibraryPart("Identify fever and loin pain in a patient with a urinary infection [C1].", library, [], "q");
    expect(ok).toMatchObject({ ok: true, cited: [1] });
    expect(ok.ok && ok.text).toContain("[C1]");
  });
  it("withholds research that cites the library, and keeps the notes answer", async () => {
    const r = await runAskAcross("u", { question: "Which organism causes pyelonephritis?", mode: "explain", passages: [passage], library, research }, ai(lines("Escherichia coli is the commonest cause of pyelonephritis [S1].", "FROM RESEARCH:", "Early imaging changed management [E1] and fever matters [C1].")));
    expect(r.ok && r.check.ok).toBe(true);
    expect(r.ok && r.research).toEqual({ ok: false, reason: "mixed" });
  });
  it("answers from research alone when no learner source was chosen, with nothing passed off as notes", async () => {
    const r = await runAskAcross("u", { question: "Does imaging help?", mode: "summary", passages: [], library: [], research }, ai(lines("NOT_IN_NOTES", "FROM RESEARCH:", "Early imaging changed management in a cohort of adults with pyelonephritis [E1].")));
    expect(r.ok && r.check).toEqual({ ok: false, reason: "not_in_notes" });
    expect(r.ok && r.research).toMatchObject({ ok: true, cited: [1] });
  });
  it("keeps the mode: each of the four ways of explaining reaches the model and the record", async () => {
    for (const mode of ["explain", "summary", "simplify", "deeper"] as const) {
      let system = "";
      const run = (async (g: { system: string }) => { system = g.system; return { ok: true, text: "NOT_IN_NOTES", model: "m", provider: "p" }; }) as never;
      const r = await runAskAcross("u", { question: "q", mode, passages: [passage], library: [], research }, run);
      expect(system).toContain("SOURCES THE STUDENT CHOSE");
      expect(r.ok && r.promptVersion).toContain("+across-v1");
      if (mode !== "explain") expect(r.ok && r.promptVersion).toContain(mode);
    }
  });
});

describe("saved learning", () => {
  it("is the notes part of a saved teaching, without its old tags or its research", () => {
    const p = savedLearningPassage({ id: "a1", kind: "artefact", materialId: "m1", createdAt: "2026-11-03T10:00:00Z", content: lines("Coli is common [S1].", "FROM RESEARCH:", "A study said so [E1].") });
    expect(p.content).toBe("Coli is common.");
    expect(p.materialTitle).toBe("Saved teaching, 2026-11-03");
  });
  it("names a learner's own note as theirs", () => {
    expect(savedLearningPassage({ id: "n1", kind: "note", materialId: null, createdAt: "2026-11-03T10:00:00Z", content: "My note" })).toMatchObject({ materialTitle: "Your note, 2026-11-03", materialId: "" });
  });
});

describe("the route", () => {
  const route = readFileSync("src/app/api/individual/scholar/explain/across/route.ts", "utf8");
  const client = readFileSync("src/app/individual/(app)/[experience]/(scholar)/study/_components/client.tsx", "utf8");
  it("runs consent and allowance before any AI or outside search", () => {
    const pre = route.indexOf("await aiPreflight(ctx)");
    expect(pre).toBeGreaterThan(0);
    expect(route.indexOf("await learnResearch(")).toBeGreaterThan(pre);
    expect(route.indexOf("await runAskAcross(")).toBeGreaterThan(pre);
    expect(route.indexOf("await scholarRiskGate(")).toBeLessThan(route.indexOf("await learnResearch("));
  });
  it("screens the question for patient details before anything else reads it", () => {
    expect(route.indexOf("findPatientIdentifiers(question)")).toBeLessThan(route.indexOf("parseAskSources(body?.sources)"));
  });
  it("re-reads what is operational on the server, and reports a refused source as not searched", () => {
    expect(route).toContain("offeredAskSources({");
    expect(route).toContain('state: "not_run"');
  });
  it("classifies what the external parts say", () => {
    expect(route).toContain("withinRequestRisk(ctx.admin, mode, risk,");
  });
  it("sends only materials alone to the existing explain route", () => {
    expect(client).toContain('across ? "/api/individual/scholar/explain/across" : "/api/individual/scholar/explain"');
    expect(client).toContain("const across = !isDefaultSources(looked);");
    expect(client).toContain("setLooked([...DEFAULT_ASK_SOURCES]);");
  });
});

describe("search history", () => {
  const KEY = "c:abcdefghijklmnop";
  it("keeps the chosen categories with an Ask question, known ones only", () => {
    expect(validateCapture({ activity: "ask", query: "Why image?", requestKey: KEY, sources: ["research", "nonsense", "materials"] })).toMatchObject({ ok: true, entry: { sources: ["materials", "research"] } });
  });
  it("adds nothing where none were given, or for a search", () => {
    const a = validateCapture({ activity: "ask", query: "Why image?", requestKey: KEY });
    expect(a.ok && "sources" in a.entry).toBe(false);
    const b = validateCapture({ activity: "material_search", query: "imaging", requestKey: KEY, sources: ["research"] });
    expect(b.ok && "sources" in b.entry).toBe(false);
  });
});
