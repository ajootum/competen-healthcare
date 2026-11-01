import { describe, expect, it } from "vitest";
import { authorityOf, buildResearchQuery, lessonConcepts, rankRelevant, scoreRelevance, lessonVocabulary, type LessonContext } from "./research-relevance";
import { NO_RELEVANT_RESEARCH, lessonQuery, relevant, type LearnResearch } from "./learn-research";
import { gateResearch, queryKeywords } from "./source-quality";
import type { ResearchItem } from "@/lib/holdings/research/providers";

// SCHOLAR-RESEARCH-RELEVANCE-01. Incident: a lesson on the Donabedian model was "supported" by ICU sedation and delirium guidelines.

const LESSON: LessonContext = {
  title: "Donabedian model: structure, process and outcome",
  objective: "Use the Donabedian model to evaluate the quality of healthcare and to plan quality improvement",
  concepts: ["structure", "process", "outcome", "quality improvement"],
  topics: ["quality", "safety", "care"],
};

const item = (over: Partial<ResearchItem>): ResearchItem => ({
  provider: "pubmed", sourceId: "1", pmid: "1", doi: null, title: "x", journal: "J", year: 2020, authors: ["A"],
  url: "https://pubmed.ncbi.nlm.nih.gov/1/", abstract: "An abstract.", verified: { pmid: true, doi: null }, retrievedAt: "2026-11-01T00:00:00Z", pubTypes: ["Journal Article"], ...over,
});
const padis = item({
  sourceId: "10", pmid: "10", title: "Clinical Practice Guidelines for the Prevention and Management of Pain, Agitation/Sedation, Delirium, Immobility, and Sleep Disruption in Adult Patients in the ICU",
  abstract: "Guideline for the quality of care of critically ill adults on sedation, analgesia and delirium, with quality improvement and patient safety implications.", pubTypes: ["Practice Guideline"],
});
const sedation = item({
  sourceId: "11", pmid: "11", title: "Light versus deep sedation in mechanically ventilated patients: a systematic review",
  abstract: "Outcomes of sedation depth on mortality and ventilator days in intensive care. Process and structure of care are discussed.", pubTypes: ["Systematic Review"],
});
const donabedian = item({
  sourceId: "12", pmid: "12", title: "Evaluating the quality of medical care: the Donabedian model revisited",
  abstract: "Donabedian proposed that the quality of care can be assessed through structure, process and outcome.", pubTypes: ["Review"],
});
const improvement = item({
  sourceId: "13", pmid: "13", title: "Improvement science in healthcare: a systematic review of quality improvement methods",
  abstract: "Quality improvement methods are compared, including plan do study act cycles, across hospital settings.", pubTypes: ["Systematic Review"],
});
const FIXTURE = [padis, sedation, donabedian, improvement];

describe("lesson concepts and the grounded query", () => {
  it("keeps Donabedian and the multi-word concepts; generic words alone are never concepts", () => {
    const c = lessonConcepts(LESSON);
    const texts = c.map(x => x.text);
    expect(texts).toContain("donabedian");
    expect(texts).toContain("structure process outcome");
    expect(texts).toContain("quality improvement");
    for (const generic of ["quality", "safety", "care", "structure", "process", "outcome", "healthcare"]) expect(c.filter(x => !x.phrase).map(x => x.text)).not.toContain(generic);
  });
  it("builds a query of quoted phrases then distinctive words, with no generic words", () => {
    const q = buildResearchQuery(LESSON);
    expect(q).toContain('"');
    expect(q.toLowerCase()).toMatch(/donabedian/);
    expect(q.replace(/"[^"]*"/g, " ").split(/\s+/).filter(Boolean)).not.toEqual(expect.arrayContaining(["quality", "safety", "care"]));
  });
  it("generic topics alone never build a search of bare generic words", () => {
    expect(buildResearchQuery({ topics: ["care", "quality", "safety"] })).toBe("");
  });
  it("a question adds its own distinctive terms to the lesson's", () => {
    expect(buildResearchQuery({ ...LESSON, question: "How does the Donabedian model treat patient experience?" })).toMatch(/donabedian/);
  });
  it("lessonQuery refuses text that may identify a patient and falls back to plain keywords when no concept exists", () => {
    expect(lessonQuery({ topics: [], title: "Mrs Jones NHS number 943 476 5919 has low oxygen" })).toMatchObject({ ok: false, reason: "identifier" });
    expect(lessonQuery({ topics: ["care", "quality"], title: null })).toMatchObject({ ok: true });
    expect(lessonQuery({ topics: [], title: null })).toMatchObject({ ok: false, reason: "empty" });
    expect(lessonQuery({ topics: [], title: LESSON.title, objective: LESSON.objective, concepts: LESSON.concepts })).toMatchObject({ ok: true, query: expect.stringContaining("donabedian") });
  });
});

describe("relevance filter: the Donabedian lesson", () => {
  for (const level of ["standard", "strict"] as const) {
    it(`${level}: the ICU sedation and delirium guidelines are excluded, the Donabedian and improvement-science papers kept`, () => {
      const { kept, dropped } = rankRelevant(FIXTURE, LESSON, level);
      expect(kept.map(k => k.item.sourceId).sort()).toEqual(["12", "13"]);
      expect(dropped).toBe(2);
    });
  }
  it("a specialty mismatch counts against an item even when it mentions a lesson phrase (the PADIS abstract names quality improvement)", () => {
    const c = lessonConcepts(LESSON), v = lessonVocabulary(LESSON);
    const s = scoreRelevance(padis, c, v);
    expect(s.score).toBeGreaterThan(0);
    expect(s.penalty).toBeGreaterThanOrEqual(4);
    expect(s.pass).toBe(false);
  });
  it("the same ICU guideline is relevant to a lesson that is about sedation", () => {
    const { kept } = rankRelevant([padis], { title: "Sedation and delirium in the ICU", objective: "Assess agitation and sedation in critically ill adults" });
    expect(kept).toHaveLength(1);
  });
  it("ranks by relevance, then authority", () => {
    const weaker = item({ sourceId: "14", pmid: "14", title: "A note on the Donabedian approach", abstract: "Structure, process and outcome in brief.", pubTypes: ["Journal Article"] });
    const { kept } = rankRelevant([weaker, improvement, donabedian], LESSON);
    expect(kept[0].item.sourceId).toBe("12");
    expect(kept.map(k => k.relevance.net)).toEqual([...kept.map(k => k.relevance.net)].sort((a, b) => b - a));
    expect(authorityOf(padis)).toBe(4);
    expect(authorityOf(donabedian)).toBe(3);
    expect(authorityOf(item({ pubTypes: [] }))).toBe(0);
  });
  it("a lesson with a single distinctive concept needs that concept in the item; two or more needs two", () => {
    const one = { title: "Pyelonephritis in adults" };
    expect(rankRelevant([item({ title: "Acute pyelonephritis: a review" }), item({ title: "Gout: a review" })], one).kept).toHaveLength(1);
    const two = { title: "Pyelonephritis and urosepsis" };
    expect(rankRelevant([item({ title: "Acute pyelonephritis: a review", abstract: "A review." })], two).kept).toHaveLength(0);
    expect(rankRelevant([item({ title: "Acute pyelonephritis: a review", abstract: "Urosepsis is covered." })], two).kept).toHaveLength(1);
  });
  it("no distinctive concept in the lesson: nothing can be shown as relevant", () => {
    expect(rankRelevant(FIXTURE, { topics: ["care", "quality", "safety"] }).kept).toHaveLength(0);
  });
});

describe("relevant(): research as presented", () => {
  const research = (items: ResearchItem[]): LearnResearch => ({
    state: "searched", message: null, query: '"donabedian model"', scholarLink: null, items, evidence: items.map((_, i) => i), calls: [], codes: [], sourceVersions: {}, excerptChars: 320, furtherReading: true, licensing: {},
  });
  it("drops irrelevant items entirely, re-ranks, and remaps the evidence indexes", () => {
    const r = relevant(research(FIXTURE), LESSON);
    expect(r.items.map(i => i.sourceId).sort()).toEqual(["12", "13"]);
    expect(r.evidence.map(i => r.items[i].sourceId).sort()).toEqual(["12", "13"]);
    expect(r.codes).toContain("relevance_dropped_2");
    expect(r.state).toBe("searched");
  });
  it("is idempotent and keeps the source-quality reasons attached to the right item", () => {
    const gated = gateResearch(relevant(research(FIXTURE), LESSON), queryKeywords("donabedian"), { evidenceIndexed: "pubmed_only", evidenceTypes: ["review"], evidenceOnTopic: "title" });
    expect(relevant(gated, LESSON)).toBe(gated);
  });
  it("nothing relevant: not_found with the plain sentence, no items to show, and no refusal", () => {
    const r = relevant(research([padis, sedation]), LESSON);
    expect(r).toMatchObject({ state: "not_found", message: NO_RELEVANT_RESEARCH, items: [], evidence: [] });
    expect(NO_RELEVANT_RESEARCH).toBe("No additional research directly relevant to this lesson was found.");
  });
});
