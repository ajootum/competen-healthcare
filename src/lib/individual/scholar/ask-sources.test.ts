import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ASK_SOURCES, DEFAULT_ASK_SOURCES, internalSearched, isDefaultSources, libraryListed, offeredAskSources, parseAskSources, researchSearched, searchedLine, toggleAskSource } from "./ask-sources";
import { askAcrossInstruction, askAcrossUserPrompt, runAskAcross, savedLearningPassage, splitAskParts, type Passage } from "./generation";
import { validateCapture } from "./search-history";
import { lessonQuery } from "./learn-research";
import { recordSearchCapture, resetSearchHistorySchema } from "./store";

const NL = String.fromCharCode(10);
const lines = (...x: string[]) => x.join(NL);
const passage: Passage = { chunkId: "c1", materialId: "m1", materialTitle: "Renal notes", ordinal: 1, pageFrom: 2, pageTo: 2, content: "Escherichia coli is the commonest cause of pyelonephritis." };
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
    expect(offeredAskSources({ savedReady: true, sourceModes: ["notes", "library", "research"], researchOperational: true, libraryReady: true })).toEqual(["materials", "saved", "library", "research"]);
    expect(offeredAskSources({ savedReady: false, sourceModes: ["notes"], researchOperational: true, libraryReady: true })).toEqual(["materials"]);
    expect(offeredAskSources({ savedReady: true, sourceModes: ["notes", "research"], researchOperational: false, libraryReady: false })).toEqual(["materials", "saved"]);
    for (const on of [true, false]) expect(offeredAskSources({ savedReady: on, sourceModes: ["notes", "library", "research", "web"], researchOperational: on, libraryReady: on })).not.toContain("web");
  });
  it("does not offer Competen Library to a learner who could only ever find nothing in it", () => {
    expect(offeredAskSources({ savedReady: true, sourceModes: ["notes", "library"], researchOperational: true, libraryReady: false })).toEqual(["materials", "saved"]);
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
    expect(internalSearched("materials", { failed: false, found: 2, shown: false, withheld: false }).state).toBe("no_match");
    expect(internalSearched("materials", { failed: false, found: 2, shown: false, withheld: true }).state).toBe("withheld");
    expect(internalSearched("saved", { failed: true, found: 0, shown: false, withheld: false }).state).toBe("not_run");
  });
  it("reports library entries as listed, never as used", () => {
    expect(libraryListed(false, 2)).toMatchObject({ state: "listed", count: 2 });
    expect(searchedLine(libraryListed(false, 2))).toBe("Competen Library: searched, matching entries listed");
    expect(libraryListed(false, 0).state).toBe("no_match");
    expect(libraryListed(true, 0).state).toBe("not_run");
  });
});

describe("keeping sources apart", () => {
  it("tags each source its own way in the prompt, and names research as not the notes", () => {
    const u = askAcrossUserPrompt("Why image?", [passage], research);
    expect(u).toContain("[S1] (Renal notes");
    expect(u).toContain("EXTERNAL RESEARCH (published abstracts, not my notes)");
    expect(u).toContain("[E1] A cohort study");
  });
  it("asks only for the parts it was given", () => {
    const none = askAcrossInstruction({ passages: false, research: true });
    expect(none).toContain("There are no passages");
    expect(none).toContain("FROM RESEARCH:");
    expect(askAcrossInstruction({ passages: true, research: false })).not.toContain("FROM RESEARCH:");
  });
  it("splits the parts in any order", () => {
    expect(splitAskParts(lines("Notes [S1].", "BEYOND THE NOTES:", "B.", "FROM RESEARCH:", "R [E1]."))).toEqual({ main: "Notes [S1].", background: "B.", research: "R [E1]." });
  });
  it("never shows the name of the first part, if the model echoes it", () => {
    expect(splitAskParts(lines("PART ONE", "", "Notes [S1]."))).toMatchObject({ main: "Notes [S1]." });
    expect(splitAskParts("**PART ONE:** Notes [S1].")).toMatchObject({ main: "Notes [S1]." });
    expect(splitAskParts("Part one of the kidney is the cortex [S1].").main).toBe("Part one of the kidney is the cortex [S1].");
  });
  it("withholds research that cites the notes, and keeps the notes answer", async () => {
    const r = await runAskAcross("u", { question: "Which organism causes pyelonephritis?", mode: "explain", passages: [passage], research }, ai(lines("Escherichia coli is the commonest cause of pyelonephritis [S1].", "FROM RESEARCH:", "Early imaging changed management [E1] and the notes agree [S1].")));
    expect(r.ok && r.check.ok).toBe(true);
    expect(r.ok && r.research).toEqual({ ok: false, reason: "mixed" });
  });
  it("withholds a notes answer that cites research", async () => {
    const r = await runAskAcross("u", { question: "Which organism causes pyelonephritis?", mode: "explain", passages: [passage], research }, ai("Escherichia coli is the commonest cause of pyelonephritis [S1] [E1]."));
    expect(r.ok && r.check).toEqual({ ok: false, reason: "ungrounded" });
  });
  it("answers from research alone when no learner source was chosen, with nothing passed off as notes", async () => {
    const r = await runAskAcross("u", { question: "Does imaging help?", mode: "summary", passages: [], research }, ai(lines("NOT_IN_NOTES", "FROM RESEARCH:", "Early imaging changed management in a cohort of adults with pyelonephritis [E1].")));
    expect(r.ok && r.check).toEqual({ ok: false, reason: "not_in_notes" });
    expect(r.ok && r.research).toMatchObject({ ok: true, cited: [1] });
  });
  it("keeps the mode: each of the four ways of explaining reaches the model and the record", async () => {
    for (const mode of ["explain", "summary", "simplify", "deeper"] as const) {
      let system = "";
      const run = (async (g: { system: string }) => { system = g.system; return { ok: true, text: "NOT_IN_NOTES", model: "m", provider: "p" }; }) as never;
      const r = await runAskAcross("u", { question: "q", mode, passages: [passage], research }, run);
      expect(system).toContain("SOURCES THE STUDENT CHOSE");
      expect(r.ok && r.promptVersion).toContain("+across-v1");
      if (mode !== "explain") expect(r.ok && r.promptVersion).toContain(mode);
    }
  });
});

describe("what leaves Competen for research", () => {
  const Q = "How do nurses prevent pressure ulcers in critically ill patients?";
  it("searches a learner's sentence as keywords, never a quoted run of its words", () => {
    const r = lessonQuery({ question: Q, topics: [], title: null, plainKeywords: true });
    expect(r.ok && r.query).not.toContain('"');
    expect(r.ok && r.query).toContain("pressure");
    expect(r.ok && r.query).toContain("ulcers");
  });
  it("leaves a lesson's query as it was", () => {
    const r = lessonQuery({ question: Q, topics: [], title: null });
    expect(r.ok && r.query).toContain('"');
  });
  it("refuses a question that may identify a patient, either way", () => {
    expect(lessonQuery({ question: "Why did John Smith, NHS number 943 476 5919, deteriorate?", topics: [], title: null, plainKeywords: true })).toMatchObject({ ok: false, reason: "identifier" });
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
  it("classifies what the research part says", () => {
    expect(route).toContain("withinRequestRisk(ctx.admin, mode, risk,");
  });
  it("never gives Competen Library entries to the model", () => {
    expect(route).toContain("runAskAcross(ctx.userId, { question, mode, passages, research: evidence }, ai.run)");
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

describe("search history, kept in the database", () => {
  const USER = "11111111-1111-4111-8111-111111111111", NOW = "2026-11-05T10:00:00.000Z", AT = "2026-11-05T09:59:30.000Z";
  // A small stand-in for the table: answers the latest row and the sources read, and records what is written.
  const tableWith = (o: { latest?: { activity: string; query: string; created_at: string; request_key: string }; sources?: unknown; sourcesError?: boolean; noColumn?: boolean }) => {
    const written: Record<string, unknown>[] = [];
    const admin = {
      rpc: async () => ({ data: [], error: null }),
      from: () => {
        let cols = "";
        const q: Record<string, unknown> = {
          select: (c: string) => { cols = c; return q; }, eq: () => q, order: () => q, limit: () => q,
          maybeSingle: async () => cols === "sources" ? (o.sourcesError ? { data: null, error: { message: "column sources does not exist" } } : { data: { sources: o.sources ?? null }, error: null }) : { data: o.latest ?? null, error: null },
          upsert: (row: Record<string, unknown>) => ({
            select: async () => {
              if (o.noColumn && "sources" in row) return { data: null, error: { message: "Could not find the 'sources' column in the schema cache" } };
              written.push(row);
              return { data: [{ id: "h1" }], error: null };
            },
          }),
        };
        return q;
      },
    };
    return { admin, written };
  };
  const entry = (sources?: ("materials" | "research")[]) => {
    const v = validateCapture({ activity: "ask", query: "Why image?", requestKey: "c:abcdefghijklmnop", ...(sources ? { sources } : {}) });
    if (!v.ok) throw new Error("bad entry");
    return v.entry;
  };
  const latest = { activity: "ask", query: "why image?", created_at: AT, request_key: "c:earlierearlierearlier" };

  it("writes the chosen categories with the question", async () => {
    resetSearchHistorySchema(true);
    const t = tableWith({});
    expect(await recordSearchCapture(t.admin, USER, entry(["materials", "research"]), NOW)).toBe("kept");
    expect(t.written[0]).toMatchObject({ query: "Why image?", sources: ["materials", "research"] });
  });
  it("still keeps the question before 999 is applied, without its sources", async () => {
    resetSearchHistorySchema(true);
    const t = tableWith({ noColumn: true });
    expect(await recordSearchCapture(t.admin, USER, entry(["materials", "research"]), NOW)).toBe("kept");
    expect(t.written[0].query).toBe("Why image?");
    expect("sources" in t.written[0]).toBe(false);
  });
  it("treats the same words asked of different sources as a new question", async () => {
    resetSearchHistorySchema(true);
    const t = tableWith({ latest, sources: ["materials"] });
    expect(await recordSearchCapture(t.admin, USER, entry(["materials", "research"]), NOW)).toBe("kept");
    expect(t.written).toHaveLength(1);
  });
  it("still collapses a double submit of the same words and sources", async () => {
    resetSearchHistorySchema(true);
    const t = tableWith({ latest, sources: ["materials", "research"] });
    expect(await recordSearchCapture(t.admin, USER, entry(["materials", "research"]), NOW)).toBe("repeat");
    expect(t.written).toHaveLength(0);
  });
  it("collapses as before where the earlier sources cannot be read, or none were recorded", async () => {
    resetSearchHistorySchema(true);
    expect(await recordSearchCapture(tableWith({ latest, sourcesError: true }).admin, USER, entry(["research"]), NOW)).toBe("repeat");
    expect(await recordSearchCapture(tableWith({ latest, sources: null }).admin, USER, entry(["research"]), NOW)).toBe("repeat");
    expect(await recordSearchCapture(tableWith({ latest }).admin, USER, entry(), NOW)).toBe("repeat");
  });
});
