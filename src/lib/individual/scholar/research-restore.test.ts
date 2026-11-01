import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { NO_RELEVANT_RESEARCH, externalReferences, relevant, restoreResearch, withLessonScope, withdrawDeclaredIrrelevant, contextOf, type ExternalReference, type LearnResearch } from "./learn-research";
import { declaresIrrelevant, lessonConcepts, lessonVocabulary, scoreRelevance, type LessonContext } from "./research-relevance";
import type { ResearchItem } from "@/lib/holdings/research/providers";

// SCHOLAR-RESEARCH-RELEVANCE-02. Incident (saved teach artefact 5bd0a632): two ICU guidelines (PMID 30113379, 35119438) were
// listed as "Sources cited in this research summary" beneath a summary that said they were not relevant to the lesson.

const LESSON: LessonContext = {
  title: "Donabedian model: structure, process and outcome",
  objective: "Use the Donabedian model to evaluate the quality of healthcare and to plan quality improvement",
  concepts: ["structure", "process", "outcome", "quality improvement"],
  topics: ["quality", "safety", "care"],
};
const INCIDENT = "The abstracts retrieved are not relevant to the topic your notes cover, so no research findings can be meaningfully added [E1] [E2].";

const ref = (over: Partial<ExternalReference>): ExternalReference => ({
  kind: "external", tag: null, provider: "PubMed", title: "x", journal: "J", year: 2018, authors: ["A"], pmid: "1", doi: null, url: "https://pubmed.ncbi.nlm.nih.gov/1/",
  evidence: false, excerpt: null, verified: { pmid: true, doi: null }, retrievedAt: "2026-11-01T07:41:00Z", sourceVersion: null, reuse: "private_evidence_excerpt_only", notUsed: null, openAccess: null, ...over,
});
const E1 = ref({ tag: "E1", evidence: true, pmid: "30113379", title: "Clinical Practice Guidelines for the Prevention and Management of Pain, Agitation/Sedation, Delirium, Immobility, and Sleep Disruption in Adult Patients in the ICU", excerpt: "Guideline on sedation, analgesia and delirium in critically ill adults." });
const E2 = ref({ tag: "E2", evidence: true, pmid: "35119438", title: "Pediatric ICU sedation, analgesia and delirium management: the PANDEM guidelines", excerpt: "Recommendations for paediatric intensive care sedation and delirium." });
const DONA = ref({ tag: "E3", evidence: true, pmid: "12", title: "Evaluating the quality of medical care: the Donabedian model revisited", excerpt: "Donabedian proposed that quality of care can be assessed through structure, process and outcome." });

describe("declaresIrrelevant: the model saying its own sources do not apply", () => {
  it("catches the exact incident sentence", () => {
    expect(declaresIrrelevant(INCIDENT)).toBe(true);
    expect(declaresIrrelevant("These abstracts are not relevant to the topic your notes cover, and no research findings can be meaningfully added [E1] [E2]")).toBe(true);
    expect(declaresIrrelevant("The abstracts [E1] [E2] are unrelated to the Donabedian model.")).toBe(true);
    expect(declaresIrrelevant("Neither abstract addresses the topic.")).toBe(false);
    expect(declaresIrrelevant("The abstracts do not address the lesson topic [E1].")).toBe(true);
  });
  it("leaves real findings and honest limitation statements alone", () => {
    expect(declaresIrrelevant("Donabedian proposed that quality can be judged by structure, process and outcome [E1].")).toBe(false);
    expect(declaresIrrelevant("The review found limited evidence for long-term outcomes [E1]. Results were mixed across settings [E2].")).toBe(false);
    expect(declaresIrrelevant("Studies did not address cost effectiveness [E1].")).toBe(false);
    expect(declaresIrrelevant(null)).toBe(false);
  });
  it("needs a citation near the phrase (no source cited, nothing to withdraw)", () => {
    expect(declaresIrrelevant("This is not relevant to the topic.")).toBe(false);
  });
});

describe("generation: a summary that declares its sources irrelevant cites nothing", () => {
  const item = (pmid: string, title: string): ResearchItem => ({ provider: "pubmed", sourceId: pmid, pmid, doi: null, title, journal: "J", year: 2018, authors: ["A"], url: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`, abstract: "Donabedian structure process outcome quality improvement.", verified: { pmid: true, doi: null }, retrievedAt: "2026-11-01T00:00:00Z" });
  const base: LearnResearch = { state: "searched", message: null, query: "q", scholarLink: null, items: [item("1", "Donabedian structure process outcome"), item("2", "Quality improvement and Donabedian")], evidence: [0, 1], calls: [], codes: [], sourceVersions: {}, excerptChars: 320, furtherReading: true, licensing: {} };
  it("the incident sentence empties the sources, says the plain sentence and records every source as model_declared_irrelevant", () => {
    const w = withdrawDeclaredIrrelevant(base, INCIDENT);
    expect(w.items).toEqual([]);
    expect(w.evidence).toEqual([]);
    expect(w.state).toBe("not_found");
    expect(w.message).toBe(NO_RELEVANT_RESEARCH);
    expect(w.accepted).toBe(0);
    expect(w.excluded?.map(x => x.reason)).toEqual(["model_declared_irrelevant", "model_declared_irrelevant"]);
    expect(externalReferences(w)).toEqual([]);
  });
  it("a real summary is returned unchanged", () => {
    expect(withdrawDeclaredIrrelevant(base, "Donabedian proposed three components of care quality [E1].")).toBe(base);
  });
});

describe("relevant() reports retrieved / accepted / excluded with a reason", () => {
  const padis: ResearchItem = { provider: "pubmed", sourceId: "30113379", pmid: "30113379", doi: null, title: E1.title, journal: "J", year: 2018, authors: ["A"], url: "u", abstract: "Sedation, analgesia and delirium in the ICU, with quality improvement.", verified: { pmid: true, doi: null }, retrievedAt: "2026-11-01T00:00:00Z", pubTypes: ["Practice Guideline"] };
  const dona: ResearchItem = { ...padis, sourceId: "12", pmid: "12", title: DONA.title, abstract: DONA.excerpt, pubTypes: ["Review"] };
  const r: LearnResearch = { state: "searched", message: null, query: "q", scholarLink: null, items: [padis, dona], evidence: [0, 1], calls: [], codes: [], sourceVersions: {}, excerptChars: 320, furtherReading: true, licensing: {} };
  it("keeps the Donabedian paper, excludes the ICU guideline with its PMID and a reason", () => {
    const g = relevant(r, LESSON);
    expect(g.retrieved).toBe(2);
    expect(g.accepted).toBe(1);
    expect(g.items.map(i => i.pmid)).toEqual(["12"]);
    expect(g.excluded).toHaveLength(1);
    expect(g.excluded?.[0]).toMatchObject({ pmid: "30113379" });
    expect(["specialty_mismatch", "off_topic", "insufficient_concepts"]).toContain(g.excluded?.[0].reason);
    expect(relevant(g, LESSON)).toMatchObject({ retrieved: 2, accepted: 1 });
    expect(externalReferences(g).every(x => x.relevanceChecked)).toBe(true);
  });
  it("nothing relevant: not_found with the plain sentence", () => {
    const g = relevant({ ...r, items: [padis], evidence: [0] }, LESSON);
    expect(g).toMatchObject({ state: "not_found", message: NO_RELEVANT_RESEARCH, retrieved: 1, accepted: 0, items: [] });
  });
});

describe("restoreResearch: a saved artefact is filtered on read", () => {
  const text = "Guidelines recommend light sedation in ventilated adults [E1]. Paediatric ICU delirium should be screened routinely [E2]. Donabedian described structure, process and outcome as the three parts of quality [E3].";
  it("the incident artefact: both ICU references leave, the research part is the plain sentence", () => {
    const r = restoreResearch([E1, E2], `${INCIDENT}`, LESSON);
    expect(r.references).toEqual([]);
    expect(r.text).toBeNull();
    expect(r.message).toBe(NO_RELEVANT_RESEARCH);
    expect(r.excluded.map(x => x.pmid)).toEqual(["30113379", "35119438"]);
    expect(r.retrieved).toBe(2);
    expect(r.accepted).toBe(0);
  });
  it("without the declaration it is the relevance score that excludes the ICU references", () => {
    const r = restoreResearch([E1, E2], "Light sedation is recommended in ventilated adults [E1]. Delirium should be screened [E2].", LESSON);
    expect(r.references).toEqual([]);
    expect(r.text).toBeNull();
    expect(r.message).toBe(NO_RELEVANT_RESEARCH);
    expect(r.excluded.every(x => x.reason !== "model_declared_irrelevant")).toBe(true);
  });
  it("a relevant source stays; the excluded tags and the sentences that cited only them are removed", () => {
    const r = restoreResearch([E1, E2, DONA], text, LESSON);
    expect(r.references.map(x => x.pmid)).toEqual(["12"]);
    expect(r.text).toBe("Donabedian described structure, process and outcome as the three parts of quality [E3].");
    expect(r.text).not.toMatch(/\[E[12]\]/);
    expect(r.message).toBeNull();
  });
  it("a sentence citing an excluded and a kept source keeps the kept tag only", () => {
    const r = restoreResearch([E1, DONA], "Quality can be judged by structure, process and outcome [E1] [E3].", LESSON);
    expect(r.text).toBe("Quality can be judged by structure, process and outcome [E3].");
  });
  it("does not mutate what it was given (the stored record is immutable)", () => {
    const refs = [E1, E2, DONA], before = JSON.stringify(refs);
    restoreResearch(refs, text, LESSON);
    expect(JSON.stringify(refs)).toBe(before);
  });
  it("references saved after the filter existed are not re-scored against their short excerpt", () => {
    const checked = { ...E1, relevanceChecked: true };
    expect(restoreResearch([checked], "Something supported [E1].", LESSON).references).toHaveLength(1);
  });
  it("a lesson that yields no concept cannot judge: nothing is removed", () => {
    expect(restoreResearch([E1], "Something [E1].", { topics: ["care"] }).references).toHaveLength(1);
  });
});

describe("the request is grounded in the lesson, not the deck", () => {
  it("a lesson scope replaces the deck title and topics", () => {
    const i = withLessonScope({ topics: ["sepsis", "ICU", "ventilation"], title: "Quality Improvement Science and Methods" }, { title: "Donabedian model", objective: "Use the model", focus: ["Donabedian", "structure process outcome"] });
    expect(i.title).toBe("Donabedian model");
    expect(i.topics).toEqual(["Donabedian", "structure process outcome"]);
    expect(contextOf(i).objective).toBe("Use the model");
  });
  it("no scope (an Ask) leaves the input as it was", () => {
    const i = { topics: ["a"], title: "T", question: "q" };
    expect(withLessonScope(i, null)).toBe(i);
  });
});

describe("restoreResearch: the claims go with their sources, the rest keep their own numbers", () => {
  const INCIDENT_FULL = "These abstracts do not address process measures or outcome measures in quality improvement [E1] [E2]. They are not relevant to the Donabedian model ... [E1] [E2]";
  it("the incident text: nothing of it is shown, the plain sentence stands in", () => {
    const r = restoreResearch([E1, E2], INCIDENT_FULL, LESSON);
    expect(r.text).toBeNull();
    expect(r.references).toEqual([]);
    expect(r.message).toBe(NO_RELEVANT_RESEARCH);
    expect(r.excluded).toHaveLength(2);
  });
  it("uncited sentences of a research section with no surviving source are dropped too", () => {
    const r = restoreResearch([E1], "Sedation protocols vary [E1].\nOverall the picture is mixed.", LESSON);
    expect(r.text).toBeNull();
  });
  it("bullets: a bullet citing only excluded sources goes, a mixed one keeps its accepted tag, numbers do not change", () => {
    const DONA2 = ref({ tag: "E4", evidence: true, pmid: "13", title: "Improvement science in healthcare: quality improvement methods", excerpt: "Quality improvement methods including plan do study act." });
    const text = "- Sedation depth matters in ventilated adults [E1]\n- Structure, process and outcome are the Donabedian components [E3]\n- Quality improvement uses PDSA cycles [E2] [E4]";
    const r = restoreResearch([E1, E2, DONA, DONA2], text, LESSON);
    expect(r.references.map(x => x.tag)).toEqual(["E3", "E4"]);
    expect(r.text).toBe("- Structure, process and outcome are the Donabedian components [E3]\n- Quality improvement uses PDSA cycles [E4]");
    // each claim still points at the source that supports it
    expect(r.references.find(x => x.tag === "E3")?.pmid).toBe("12");
    expect(r.references.find(x => x.tag === "E4")?.pmid).toBe("13");
  });
});

describe("equivalent terminology and spelling", () => {
  const sc = (title: string, abstract: string, ctx: LessonContext = LESSON) => scoreRelevance({ title, abstract }, lessonConcepts(ctx), lessonVocabulary(ctx));
  it("structure-process-outcome is the Donabedian model, and the reverse", () => {
    expect(sc("The structure-process-outcome framework for evaluating health services", "A review.").pass).toBe(true);
    expect(sc("Evaluating care: Donabedian revisited", "Quality of care.", { title: "Structure, process and outcome of care", topics: [] }).pass).toBe(true);
  });
  it("improvement science, QI and plan-do-study-act match quality improvement and PDSA", () => {
    const ctx: LessonContext = { title: "Quality improvement and PDSA cycles", objective: "Explain the model for improvement" };
    expect(sc("Improvement science in practice", "Methods.", ctx).pass).toBe(true);
    expect(sc("Plan-do-study-act cycles in hospital teams", "A trial.", ctx).pass).toBe(true);
  });
  it("process indicators / outcome indicators / health outcomes match process and outcome measures", () => {
    const ctx: LessonContext = { title: "Process measures and outcome measures in quality improvement" };
    expect(sc("Process indicators for stroke services", "Indicators of quality improvement.", ctx).pass).toBe(true);
    expect(sc("Health outcomes and quality improvement indicators", "", ctx).pass).toBe(true);
  });
  it("British and American spellings are one word", () => {
    const ctx: LessonContext = { title: "Person-centred care and programme evaluation" };
    expect(sc("Patient-centered care program evaluation", "", ctx).pass).toBe(true);
  });
  it("a short acronym alternative (QI, RCA) never matches a source on its own", () => {
    expect(sc("Qi gong exercise for back pain", "A trial of qi gong.", { title: "Quality improvement methods" }).pass).toBe(false);
  });
  it("the ICU guidelines still fail whatever the equivalents", () => {
    expect(sc(E1.title, E1.excerpt ?? "").pass).toBe(false);
    expect(sc(E2.title, E2.excerpt ?? "").pass).toBe(false);
  });
  it("a lesson writing QI gets quality improvement as a concept", () => {
    expect(lessonConcepts({ title: "QI basics" }).map(c => c.text)).toContain("quality improvement");
  });
});

describe("wiring: the route filters what it serves and what it generates", () => {
  const route = readFileSync("src/app/api/individual/scholar/learn/act/route.ts", "utf8");
  it("a saved artefact is restored through restoreResearch; a declared-irrelevant summary is withdrawn before it is saved; the lesson scope reaches the search", () => {
    expect(route).toMatch(/restoreResearch\(a\.refs\.filter/);
    expect(route).toMatch(/withdrawDeclaredIrrelevant\(research, rr\.text\)/);
    expect(route.indexOf("withdrawDeclaredIrrelevant(research")).toBeLessThan(route.indexOf("saveArtefact(ctx.admin"));
    expect(route).toMatch(/qualityOf\(policy\.scholarRecovery\), lessonScope\)/);
  });
  it("PLANT: without the restore filter the saved references are served as stored", () => {
    expect(route.replace("restoreResearch(", "passThrough(")).not.toMatch(/restoreResearch\(a\.refs\.filter/);
  });
});
