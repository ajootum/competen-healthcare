import { describe, expect, it } from "vitest";
import { keepSources, researchKey, researchRequest, runResearch, webResearchState } from "./exam-research";
import { runTranscription } from "./exam-answer";
import type { GenerateArgs, GenerateResult } from "@/lib/ai/client";
import { webSourcesOf, webSearchToolType } from "@/lib/ai/client";
import type { ScholarExamPolicy } from "../policy";

const policy = (o: Partial<ScholarExamPolicy> = {}): ScholarExamPolicy => ({
  enabled: true, sources: ["notes", "library"], webProvider: "none", depth: "standard", domains: ["who.int", "nice.org.uk"],
  webDailyMax: 10, cacheDays: 30, scannedPages: "off", ...o,
});

describe("web research is off until policy turns it on, both halves", () => {
  it("needs web among the sources AND a provider AND approved domains", () => {
    expect(webResearchState(policy()).on).toBe(false);
    expect(webResearchState(policy({ sources: ["web"] })).on).toBe(false);
    expect(webResearchState(policy({ webProvider: "anthropic_web_search" })).on).toBe(false);
    expect(webResearchState(policy({ sources: ["web"], webProvider: "anthropic_web_search", domains: [] })).on).toBe(false);
    expect(webResearchState(policy({ sources: ["notes", "web"], webProvider: "anthropic_web_search" })).on).toBe(true);
  });
});

describe("only the examination question leaves, and never one that identifies a patient", () => {
  it("builds the request from the question alone, tidied and bounded", () => {
    const r = researchRequest("  Question 4:  What is the target   oxygen saturation?\nA. 88-92%  ");
    expect(r).toEqual({ ok: true, query: "Question 4: What is the target oxygen saturation? A. 88-92%" });
    expect((researchRequest("x".repeat(5000)) as { query: string }).query.length).toBe(1200);
  });
  it("refuses a request that looks like it identifies a patient", () => {
    expect(researchRequest("Mr Smith, NHS number 943 476 5919, has a low saturation. Why?")).toEqual({ ok: false, reason: "identifier" });
    expect(researchRequest("   ")).toEqual({ ok: false, reason: "empty" });
  });
  it("keys the public cache by what decides the result, case and spacing aside", () => {
    const a = researchKey("What is sepsis?", "anthropic_web_search", ["who.int", "nice.org.uk"], "standard");
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(researchKey("what  is SEPSIS?", "anthropic_web_search", ["nice.org.uk", "who.int"], "standard")).toBe(a);
    expect(researchKey("What is sepsis?", "anthropic_web_search", ["who.int"], "standard")).not.toBe(a);
    expect(researchKey("What is sepsis?", "anthropic_web_search", ["who.int", "nice.org.uk"], "deep")).not.toBe(a);
  });
});

describe("sources are what the search returned, from approved domains only", () => {
  const content = [
    { type: "server_tool_use", name: "web_search" },
    { type: "web_search_tool_result", content: [
      { type: "web_search_result", url: "https://www.who.int/sepsis", title: "Sepsis", page_age: "March 2025" },
      { type: "web_search_result", url: "https://blog.example.com/sepsis", title: "A blog", page_age: null },
      { type: "web_search_result", url: "http://www.nice.org.uk/insecure", title: "Insecure", page_age: null },
    ] },
    { type: "text", text: "Sepsis is...", citations: [{ type: "web_search_result_location", url: "https://www.who.int/sepsis", title: "Sepsis", cited_text: "Sepsis is a life-threatening condition." }] },
  ];
  it("reads results and cited text from the provider's blocks", () => {
    const found = webSourcesOf(content);
    expect(found.map(s => s.url)).toEqual(["https://www.who.int/sepsis", "https://blog.example.com/sepsis", "http://www.nice.org.uk/insecure"]);
    expect(found[0].citedText).toEqual(["Sepsis is a life-threatening condition."]);
  });
  it("keeps https sources on approved domains (and their subdomains) only, bounded", () => {
    const kept = keepSources(webSourcesOf(content), ["who.int", "nice.org.uk"], 6, "2026-10-26T10:00:00Z");
    expect(kept).toEqual([{ url: "https://www.who.int/sepsis", title: "Sepsis", publisher: "www.who.int", published: "March 2025", retrievedAt: "2026-10-26T10:00:00Z", excerpt: "Sepsis is a life-threatening condition." }]);
    expect(keepSources(webSourcesOf(content), ["who.int"], 0, "t")).toEqual([]);
    expect(keepSources([{ url: "https://evilwho.int/x", title: "x", pageAge: null, citedText: [] }], ["who.int"], 6, "t")).toEqual([]);
  });
  it("uses the current web search tool on current models", () => {
    expect(webSearchToolType("claude-sonnet-4-6")).toBe("web_search_20260209");
    expect(webSearchToolType("claude-opus-5-5")).toBe("web_search_20260209");
    expect(webSearchToolType("claude-3-5-haiku")).toBe("web_search_20250305");
  });
});

describe("what the research and transcription calls actually send", () => {
  it("research sends the question only, with the depth's search limit and the approved domains", async () => {
    const seen: GenerateArgs[] = [];
    const run = async (g: GenerateArgs): Promise<GenerateResult> => {
      seen.push(g);
      return { ok: true, text: "summary", provider: "anthropic", model: "claude-sonnet-4-6", usage: { input: 1, output: 1 }, searches: 2,
        sources: [{ url: "https://www.who.int/a", title: "A", pageAge: null, citedText: ["x"] }, { url: "https://other.org/b", title: "B", pageAge: null, citedText: [] }] };
    };
    const r = await runResearch(run, "u1", { query: "What is sepsis?", depth: "quick", domains: ["who.int"], now: "2026-10-26T00:00:00Z" });
    expect(seen[0].user).toBe("EXAMINATION QUESTION:\nWhat is sepsis?");
    expect(seen[0].webSearch).toEqual({ maxUses: 1, allowedDomains: ["who.int"] });
    expect(seen[0].documents).toBeUndefined();
    expect(r.ok && r.sources.map(s => s.url)).toEqual(["https://www.who.int/a"]);
  });

  it("transcription sends the PDF and asks only for the pages wanted, keeping only those back", async () => {
    const seen: GenerateArgs[] = [];
    const run = async (g: GenerateArgs): Promise<GenerateResult> => {
      seen.push(g);
      return { ok: true, text: "PAGE 1\n1. Define sepsis\nPAGE 2\n2. List two signs\nPAGE 5\nextra", provider: "anthropic", model: "m", usage: { input: 1, output: 1 } };
    };
    const r = await runTranscription(run, "u1", { pdfBase64: "JVBERi0=", pages: [1, 2] });
    expect(seen[0].documents).toEqual([{ mediaType: "application/pdf", data: "JVBERi0=" }]);
    expect(seen[0].webSearch).toBeUndefined();
    expect(seen[0].user).toBe("Transcribe pages 1, 2 of this paper.");
    expect(r.ok && r.pages.map(p => p.page)).toEqual([1, 2]);
  });
});
