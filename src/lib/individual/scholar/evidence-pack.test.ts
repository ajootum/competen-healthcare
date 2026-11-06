import { describe, expect, it } from "vitest";
import { resolvePolicy } from "../policy";
import { SUBJECT_PHRASES } from "@/lib/holdings/research/subject-phrases";
import { SUBJECT_TOPICS, approvedQuery, evidenceKind, lessonTopics, readShared, selectPack, shareable, topicKey, type SharedRecord } from "./evidence-pack";
import type { ResearchItem } from "@/lib/holdings/research/providers";

const item = (pmid: string, over: Partial<ResearchItem> = {}): ResearchItem => ({
  provider: "pubmed", sourceId: pmid, pmid, doi: `10.1000/${pmid}`, title: `Title ${pmid}`, journal: "J", year: 2022, authors: ["A B"], url: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`,
  abstract: "PUBLISHER TEXT", verified: { pmid: true, doi: true }, retrievedAt: "2026-11-06T00:00:00Z", pubTypes: ["Review"], ...over,
});

const GROWTH = {
  headings: ["Principles of growth and development", "Critical and sensitive periods"],
  body: [
    "Cephalocaudal development proceeds from the head downward. Proximal distal development moves from the centre outward.",
    "A critical period begins and ends quickly. A sensitive period begins and ends gradually. The first year is a critical, sensitive period for infant caregiver attachment.",
    "Reactive attachment disorder is seen in children with early experience in foster care or orphanages. Attachment depends on consistent care.",
    "Language development is a critical, sensitive period. Language is acquired in a sequence: phonology, semantics, syntax.",
  ],
};

describe("what may leave Competen", () => {
  it("the Growth and Development notes reach the expected topics of the closed list", () => {
    const ids = lessonTopics(GROWTH, 4).map(t => t.id);
    expect(ids).toEqual(expect.arrayContaining(["critical-sensitive-periods", "infant-attachment-caregiving", "language-development", "motor-development-principles"]));
  });

  it("the same topics come from the same notes, every time", () => {
    expect(lessonTopics(GROWTH, 4).map(t => t.id)).toEqual(lessonTopics(GROWTH, 4).map(t => t.id));
  });

  it("nothing of a hostile lesson can reach an outgoing query: names, places, ages and numbers in the notes never appear", () => {
    const hostile = { headings: ["Mrs Nambi Sarah Okello, Mulago ward 5", "Critical period lesson for Peter"],
      body: ["mrs nambi age 72 at mulago ward 5, NHS 943 476 5919, critical period. sarah okello has reactive attachment disorder. attachment in peter, foster care, kampala."] };
    const queries = lessonTopics(hostile, 5).map(t => approvedQuery(t.id, 15)!);
    expect(queries.length).toBeGreaterThan(0);
    for (const q of queries) expect(q).not.toMatch(/nambi|okello|mulago|sarah|peter|kampala|943|\b72\b|ward 5/i);
    // Every query is one the list could have made without ever seeing the lesson.
    const all = new Set(SUBJECT_TOPICS.map(t => approvedQuery(t.id, 15)));
    for (const q of queries) expect(all.has(q)).toBe(true);
  });

  it("an id not on the list makes no query at all", () => {
    expect(approvedQuery("mrs nambi", 15)).toBeNull();
    expect(approvedQuery("", 15)).toBeNull();
  });

  it("a word mentioned once in passing is not what a lesson is about: no search, so no citation for its own sake", () => {
    expect(lessonTopics({ headings: ["Hand hygiene on the ward"], body: ["Wash your hands. Heart failure was mentioned once."] }, 5).map(t => t.id)).not.toContain("heart-failure");
  });

  it("the list holds no digit, no single word as a phrase and no duplicate, so a lone name cannot match", () => {
    for (const p of SUBJECT_PHRASES) expect(p).toMatch(/^[a-z][a-z-]*( [a-z-]+)+$/);
    expect(new Set(SUBJECT_PHRASES).size).toBe(SUBJECT_PHRASES.length);
    for (const t of SUBJECT_TOPICS) expect(t.query).not.toMatch(/\d/);
    expect(new Set(SUBJECT_TOPICS.map(t => t.id)).size).toBe(SUBJECT_TOPICS.length);
  });

  it("the only figure in a query is the recency limit the registry sets", () => {
    expect(approvedQuery("critical-sensitive-periods", 15)).toContain('"last 15 years"[dp]');
    expect(approvedQuery("critical-sensitive-periods", 0)).not.toContain('"last ');
  });
});

describe("the shared pack", () => {
  const plan = { sources: ["pubmed", "crossref", "pmc"], freshnessYears: 15, maxResults: 5 };

  it("a topic's key is about the topic and the settings, the same for any learner", () => {
    expect(topicKey({ id: "language-development" }, plan)).toBe(topicKey({ id: "language-development" }, plan));
    expect(topicKey({ id: "language-development" }, plan)).toMatch(/^[0-9a-f]{64}$/);
    expect(topicKey({ id: "language-development" }, plan)).not.toBe(topicKey({ id: "infant-attachment-caregiving" }, plan));
    expect(topicKey({ id: "language-development" }, plan)).not.toBe(topicKey({ id: "language-development" }, { ...plan, freshnessYears: 20 }));
  });

  it("abstract text never goes into what is shared", () => {
    const s = shareable(item("1", { abstractFrom: "openalex" }), "t", 4);
    expect(s.abstract).toBeNull();
    expect(JSON.stringify(s)).not.toContain("PUBLISHER TEXT");
    expect("abstractFrom" in s).toBe(false);
  });

  it("an abstract planted in a shared row is not read back", () => {
    const rows = readShared([{ ...shareable(item("1"), "t", 4), abstract: "PLANTED" }, { junk: true }, null]);
    expect(rows).toHaveLength(1);
    expect(rows[0].abstract).toBeNull();
  });

  const rec = (pmid: string, topic: string, over: Partial<SharedRecord> = {}): SharedRecord => ({ ...shareable(item(pmid), topic, 4), ...over });

  it("one rich topic cannot crowd out the rest", () => {
    const picked = selectPack([{ topic: "a", records: ["1", "2", "3", "4"].map(p => rec(p, "a")) }, { topic: "b", records: [rec("9", "b")] }], 3, new Date("2026-11-06"));
    expect(picked.map(x => x.topic)).toContain("b");
    expect(picked).toHaveLength(3);
  });

  it("a work found under two topics is taken once, by PMID or DOI", () => {
    const picked = selectPack([{ topic: "a", records: [rec("1", "a")] }, { topic: "b", records: [rec("1", "b"), rec("2", "b", { doi: "10.1000/1" }), rec("3", "b")] }], 5, new Date("2026-11-06"));
    expect(picked.map(x => x.pmid)).toEqual(["1", "3"]);
  });

  it("the type of work counts, a citation count plays no part, and a much better match can still win: a hierarchy, not a rule", () => {
    const review = rec("1", "a", { authority: 4, relevance: 4 }), trial = rec("2", "a", { authority: 2, relevance: 4 });
    const cited = { ...trial, citations: 100000 } as SharedRecord;
    expect(selectPack([{ topic: "a", records: [cited, review] }], 1, new Date("2026-11-06"))[0].pmid).toBe("1");
    expect(selectPack([{ topic: "a", records: [{ ...trial, relevance: 8 }, { ...review, relevance: 2 }] }], 1, new Date("2026-11-06"))[0].pmid).toBe("2");
  });

  it("a record about a narrower group, or not about people, ranks below a general one for a general lesson", () => {
    const narrow = rec("1", "a", { authority: 4, relevance: 8, title: "Motor development of preterm infants: a systematic review" });
    const general = rec("2", "a", { authority: 3, relevance: 3, title: "Early human motor development" });
    expect(selectPack([{ topic: "a", records: [narrow, general] }], 1, new Date("2026-11-06"))[0].pmid).toBe("2");
  });

  it("says what kind of work a record is from PubMed's own types", () => {
    expect(evidenceKind(["Practice Guideline"])).toBe("guideline");
    expect(evidenceKind(["Review", "Systematic Review"])).toBe("systematic review");
    expect(evidenceKind(["Review"])).toBe("narrative review");
    expect(evidenceKind(undefined)).toBe("published study");
  });
});

describe("the switch", () => {
  it("is off unless published, and its own: Research & Explain's setting does not turn it on", () => {
    expect(resolvePolicy([]).scholarTeachResearch.on).toBe(false);
    const p = resolvePolicy([{ config_path: "individual.policy.scholar_learn_source_modes", published: { enabled: ["notes", "library", "research"] } }]);
    expect(p.scholarTeachResearch.on).toBe(false);
  });
});
