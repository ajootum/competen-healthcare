import { describe, expect, it } from "vitest";
import {
  assessSufficiency, externalEvidence, generationInputs, keyTermsOf, matchedTerms, parseRecoveryMode, recoveryKey, retrievedOf, runRecovery,
  suggestedActions, summariseRecovery, tierPlan, topicKeywords, widerMode, restatesOnly, withoutQuestion, type RecoverySources, type RecoveryOutcomeRow,
} from "./evidence-recovery";
import { narrowPlan, type LearnResearch } from "./learn-research";
import type { Passage } from "./generation";
import { DEFAULT_POLICY, type IndividualPolicy } from "../policy";
import { parsePmcIdconv, parsePmcOa, type FetchLike, type ResearchItem } from "@/lib/holdings/research/providers";
import { runResearch, type ResearchPlan } from "@/lib/holdings/research/service";
import { SEED_REGISTRY, resolveRegistry, type Registry } from "@/lib/holdings/research/registry";
import { DEFAULT_POLICY as RESEARCH_DEFAULT, resolveWorkflows } from "@/lib/holdings/research/engine-config";

// SCHOLAR-SQIE-02 s5-8: evidence recovery. No database, no network: the readers are injected, the providers canned.

const policyWith = (r: Partial<IndividualPolicy["scholarRecovery"]> = {}, researchModes: IndividualPolicy["scholarResearch"]["modes"] = ["notes", "library", "research"]): IndividualPolicy => ({
  ...DEFAULT_POLICY,
  scholarRecovery: { ...DEFAULT_POLICY.scholarRecovery, ...r },
  scholarResearch: { ...DEFAULT_POLICY.scholarResearch, modes: researchModes },
});
const OPEN = policyWith({ external: "offer", providers: ["pubmed", "crossref", "pmc", "google_scholar_link", "guidelines"] });

const passage = (id: string, content: string, materialId = "m1"): Passage => ({ chunkId: id, materialId, materialTitle: "Respiratory notes", ordinal: 1, pageFrom: 3, pageTo: 3, content });
const item = (over: Partial<ResearchItem>): ResearchItem => ({
  provider: "pubmed", sourceId: "1", pmid: "1", doi: null, title: "Oxygen therapy in COPD", journal: "Thorax", year: 2022, authors: ["Smith A"],
  url: "https://pubmed.ncbi.nlm.nih.gov/1/", abstract: null, verified: { pmid: true, doi: null }, retrievedAt: "2026-10-30T00:00:00Z", ...over,
});
const research = (items: ResearchItem[], evidence: number[], over: Partial<LearnResearch> = {}): LearnResearch => ({
  state: "searched", message: null, query: "oxygen copd", scholarLink: null, items, evidence, calls: [], codes: [], sourceVersions: { pubmed: "pubmed@v1" },
  excerptChars: 320, furtherReading: true, licensing: { pubmed: "NLM terms" }, ...over,
});

/** Readers that record the order they were called in, and what the external one was given. */
function fakeSources(o: { notes?: Passage[]; library?: Awaited<ReturnType<RecoverySources["library"]>>; research?: LearnResearch } = {}) {
  const log: string[] = [], sent: (readonly string[])[] = [];
  const sources: RecoverySources = {
    notes: async () => { log.push("notes"); return o.notes ?? []; },
    library: async () => { log.push("library"); return o.library ?? []; },
    external: async k => { log.push("external"); sent.push(k); return o.research ?? research([], []); },
    guidelines: () => [{ kind: "guideline", label: "Approved guideline publisher: who.int", url: "https://who.int/" }],
  };
  return { sources, log, sent };
}

describe("tierPlan and the sequence: notes, then library, then external only when every gate allows it", () => {
  it("notes only reads the notes and the approved library, and never anything external", async () => {
    const f = fakeSources();
    const r = await runRecovery({ question: "oxygen therapy in copd", mode: "notes_only" }, tierPlan("notes_only", OPEN, true), f.sources, { wider: null });
    expect(f.log).toEqual(["notes", "library"]);
    expect(r.external.reason).toBe("not_chosen");
  });
  it("notes + library reads notes then the library, never external", async () => {
    const f = fakeSources();
    await runRecovery({ question: "oxygen therapy in copd", mode: "notes_and_library" }, tierPlan("notes_and_library", OPEN, true), f.sources, { wider: null });
    expect(f.log).toEqual(["notes", "library"]);
  });
  it("references runs external last, and only with HQ on, a search source enabled, Research & Explain offered and the engine operational", async () => {
    const f = fakeSources();
    const r = await runRecovery({ question: "oxygen therapy in copd", mode: "notes_and_references" }, tierPlan("notes_and_references", OPEN, true), f.sources, { wider: null });
    expect(f.log).toEqual(["notes", "library", "external"]);
    expect(r.external.reason).toBe("ran");
    expect(tierPlan("notes_and_references", policyWith(), true)).toMatchObject({ external: false, externalReason: "off" }); // the default
    expect(tierPlan("notes_and_references", policyWith({ external: "offer", providers: ["crossref", "pmc"] }), true)).toMatchObject({ external: false, externalReason: "no_source" });
    expect(tierPlan("notes_and_references", OPEN, false)).toMatchObject({ external: false, externalReason: "unavailable" });
    expect(tierPlan("notes_and_references", policyWith({ external: "offer", providers: ["pubmed"] }, ["notes"]), true)).toMatchObject({ external: false, externalReason: "unavailable" });
    expect(tierPlan("notes_and_library", OPEN, true)).toMatchObject({ external: false, externalReason: "not_chosen", guidelines: false });
  });
  it("defaults: notes + library, external off, no source enabled", () => {
    expect(DEFAULT_POLICY.scholarRecovery).toEqual({ defaultMode: "notes_and_library", external: "off", providers: [], maxResults: 5, timeoutMs: 6000 });
  });
  it("modes: the recovery words and Learn's own words; anything else is the fallback", () => {
    expect(parseRecoveryMode("research", "notes_only")).toBe("notes_and_references");
    expect(parseRecoveryMode("notes_and_library", "notes_only")).toBe("notes_and_library");
    expect(parseRecoveryMode("everything", "notes_only")).toBe("notes_only");
  });
  it("offers a wider tier only when one could run", () => {
    expect(widerMode("notes_only", OPEN, true)).toBeNull(); // notes only is never widened to external sources
    expect(widerMode("notes_and_library", policyWith(), true)).toBeNull();
    expect(widerMode("notes_and_library", OPEN, true)).toBe("notes_and_references");
  });
});

describe("no notes ever go to an external source", () => {
  it("the external reader receives the question's keywords only, never words that are only in the notes", async () => {
    const f = fakeSources({ notes: [passage("c1", "Zebrafinch protocol: oxygen via venturi for the COPD patient on ward Kiwi.")] });
    await runRecovery({ question: "Why is controlled oxygen used in COPD?", mode: "notes_and_references" }, tierPlan("notes_and_references", OPEN, true), f.sources, { wider: null });
    expect(f.sent).toHaveLength(1);
    const sent = f.sent[0].join(" ");
    expect(sent).not.toMatch(/zebrafinch|venturi|kiwi|ward/);
    expect(f.sent[0]).toEqual(expect.arrayContaining(["controlled", "oxygen", "copd"]));
  });
  it("a question that identifies a patient sends nothing at all", async () => {
    const f = fakeSources();
    const r = await runRecovery({ question: "NHS number 943 476 5919 low oxygen", mode: "notes_and_references" }, tierPlan("notes_and_references", OPEN, true), f.sources, { wider: null });
    expect(f.log).not.toContain("external");
    expect(r.external).toMatchObject({ ran: false, reason: "refused" });
  });
});

describe("topicKeywords: names, numbers and dates are stripped", () => {
  it("drops titles and names, ages, dates, months and durations", () => {
    const k = topicKeywords("Mr John Okello, 67 years old, was admitted on 12/03/2026 with a COPD exacerbation. Sarah has asthma since March 2019.");
    expect(k.ok).toBe(true);
    const words = k.ok ? k.keywords : [];
    for (const bad of ["john", "okello", "67", "years", "12", "2026", "sarah", "march", "2019"]) expect(words).not.toContain(bad);
    expect(words).toEqual(expect.arrayContaining(["copd", "exacerbation", "asthma"]));
  });
  it("keeps eponyms with their noun, acronyms and a capitalised first topic word", () => {
    const k = topicKeywords("Heart failure and Parkinson's disease: what does the Glasgow Coma Scale measure? Explain NEWS2.");
    const words = k.ok ? k.keywords : [];
    expect(words).toEqual(expect.arrayContaining(["heart", "failure", "parkinson", "glasgow", "coma", "news2"]));
  });
  it("drops a capitalised name inside a sentence and a possessive name", () => {
    const k = topicKeywords("How should I teach Amina about inhaler technique? Peter's spacer keeps failing.");
    const words = k.ok ? k.keywords : [];
    expect(words).not.toContain("amina");
    expect(words).not.toContain("peter");
    expect(words).toEqual(expect.arrayContaining(["inhaler", "technique"]));
  });
  it("refuses a labelled identifier, and says empty when nothing is left", () => {
    expect(topicKeywords("Patient DOB: 01/02/1990 with sepsis")).toEqual({ ok: false, reason: "identifier" });
    expect(topicKeywords("Mr Smith, 42, 3 May")).toEqual({ ok: false, reason: "empty" });
  });
  it("is deterministic", () => {
    const q = "Explain oxygen targets in COPD for Mrs Achieng aged 70";
    expect(topicKeywords(q)).toEqual(topicKeywords(q));
  });
});

describe("labels: metadata and an abstract are never full text", () => {
  it("retrievedOf says full text only when full text was retrieved", () => {
    expect(retrievedOf({ abstract: null })).toBe("metadata");
    expect(retrievedOf({ abstract: "An abstract." })).toBe("abstract");
    expect(retrievedOf({ abstract: "An abstract.", fullText: "" })).toBe("abstract");
    expect(retrievedOf({ fullText: "The whole article." })).toBe("full_text");
  });
  it("engine references: an abstract is 'abstract' evidence, a record without one is 'metadata' reading, an open-access link stays a link", () => {
    const r = research([
      item({ sourceId: "1", pmid: "1", abstract: "Controlled oxygen reduced hypercapnia in COPD.", openAccess: { pmcid: "PMC9", licence: "CC BY", url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC9/", retracted: false } }),
      item({ sourceId: "2", pmid: "2", url: "https://pubmed.ncbi.nlm.nih.gov/2/", title: "Oxygen alerts in COPD" }),
    ], [0]);
    const e = externalEvidence(r, keyTermsOf("controlled oxygen copd"));
    expect(e.map(x => x.retrieved)).toEqual(["abstract", "metadata"]);
    expect(e.map(x => x.evidence)).toEqual([true, false]);
    expect(e.every(x => x.retrieved !== "full_text")).toBe(true);
    expect(e[0].openAccess).toEqual({ url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC9/", licence: "CC BY" });
  });
  it("an unverified reference (no PubMed id, DOI not confirmed) is dropped, not shown", () => {
    const r = research([item({ provider: "openalex", sourceId: "W1", pmid: null, doi: "10.1/x", url: "https://doi.org/10.1/x", verified: { pmid: false, doi: null }, abstract: "x" })], []);
    expect(externalEvidence(r, ["x"])).toEqual([]);
  });
});

describe("the sufficiency decision is deterministic", () => {
  const empty = { notes: [], library: [], external: [] };
  it("no evidence: insufficient, nothing to explain from, every key term unanswered", () => {
    const s = assessSufficiency("hypercapnic respiratory failure", empty);
    expect(s).toMatchObject({ verdict: "insufficient", canExplain: false });
    expect(s.unanswered).toEqual(keyTermsOf("hypercapnic respiratory failure"));
  });
  it("SQIE D-4: notes alone are not an approved reference: insufficient, all unanswered, never sufficient beside unanswered", async () => {
    const f = fakeSources({ notes: [passage("c1", "Hypercapnic respiratory failure follows uncontrolled oxygen.")] });
    const all = await runRecovery({ question: "hypercapnic respiratory failure", mode: "notes_only" }, tierPlan("notes_only", OPEN, true), f.sources, { wider: null });
    // The notes are still shown, with what they mention; they just cannot ground an explanation on their own.
    expect(all.evidence.notes[0].matched).toEqual(["hypercapnic", "respiratory", "failure"]);
    expect(all.sufficiency).toMatchObject({ verdict: "insufficient", canExplain: false, covered: [], unanswered: ["hypercapnic", "respiratory", "failure"] });
    expect([all.explainable, all.state, all.generation]).toEqual([false, "unanswered", null]);
  });
  it("notes with an approved library reference: sufficient when most key terms are covered, else partial with what remains", async () => {
    const lib = (title: string) => [{ origin: "library" as const, kind: "competency" as const, itemId: "k1", version: "1", code: "R1", title, outcome: null, text: title, status: "Clinically approved", approved: true }];
    const f = fakeSources({ notes: [passage("c1", "Hypercapnic respiratory failure follows uncontrolled oxygen.")], library: lib("Respiratory failure") });
    const all = await runRecovery({ question: "hypercapnic respiratory failure", mode: "notes_and_library" }, tierPlan("notes_and_library", OPEN, true), f.sources, { wider: null });
    expect(all.sufficiency).toMatchObject({ verdict: "sufficient", canExplain: true, unanswered: [] });
    expect([all.explainable, all.state]).toEqual([true, "explanation_available"]);
    const g = fakeSources({ notes: [passage("c1", "Respiratory assessment is routine.")], library: lib("Respiratory assessment") });
    const part = await runRecovery({ question: "hypercapnic respiratory failure", mode: "notes_and_library" }, tierPlan("notes_and_library", OPEN, true), g.sources, { wider: null });
    expect(part.sufficiency).toMatchObject({ verdict: "partial", canExplain: true });
    expect(part.sufficiency.unanswered).toEqual(["hypercapnic", "failure"]);
  });
  it("SQIE D-4: a chunk that only restates the question (the learner's own paper) is not evidence for it", async () => {
    const q = "Question 1: Antibiotic choice in pyelonephritis";
    const f = fakeSources({ notes: [passage("p1", "1. Antibiotic choice in pyelonephritis (4 marks)", "paper"), passage("n1", "Antibiotic choice in pyelonephritis\nAntibiotics follow the local guideline; send an MSU for culture first.", "notes")] });
    const r = await runRecovery({ question: q, mode: "notes_only" }, tierPlan("notes_only", OPEN, true), f.sources, { wider: null });
    expect(r.evidence.notes.find(n => n.chunkId === "p1")?.matched).toEqual([]);
    // A note with the question as its heading and an explanation under it stays evidence, with all it mentions.
    expect(r.evidence.notes.find(n => n.chunkId === "n1")?.matched).toEqual(["antibiotic", "choice", "pyelonephritis"]);
    expect(withoutQuestion("Antibiotic choice in pyelonephritis (4 marks)", q)).toBe("4 marks");
    // A short topic is what notes say: never taken out.
    expect(restatesOnly("Hypercapnic respiratory failure follows uncontrolled oxygen.", "hypercapnic respiratory failure", ["hypercapnic", "respiratory", "failure"])).toBe(false);
  });
  it("a details-only external reference is reading, never evidence; an unapproved library item never counts", () => {
    const s = assessSufficiency("oxygen copd", {
      notes: [], library: [{ origin: "library", tag: "L1", kind: "competency", itemId: "x", version: null, code: null, title: "Oxygen in COPD", outcome: null, text: "Oxygen in COPD", status: "Draft", approved: false, matched: ["oxygen", "copd"] }],
      external: externalEvidence(research([item({ abstract: null })], []), ["oxygen", "copd"]),
    });
    expect(s.canExplain).toBe(false);
  });
  it("without evidence the learner gets reading and what remains unanswered, never an explanation input", async () => {
    const f = fakeSources({ research: research([item({})], [], { scholarLink: "https://scholar.google.com/scholar?q=x" }) });
    const r = await runRecovery({ question: "oxygen copd", mode: "notes_and_references" }, tierPlan("notes_and_references", OPEN, true), f.sources, { wider: null });
    expect(r.state).toBe("reading_only");
    expect(r.generation).toBeNull();
    expect(r.actions.map(a => a.action)).toEqual(["find_resources", "continue_with_notes"]); // reading to show, nothing to explain from
    expect(r.reading.map(x => x.kind)).toEqual(["search_link", "guideline"]);
  });
  it("a library case is practice to read, never the source of an explanation", async () => {
    const f = fakeSources({ library: [{ origin: "library", kind: "case", itemId: "v1", version: "v1", code: "C1", title: "COPD oxygen case", outcome: null, text: "A breathless COPD patient on oxygen", status: "Clinically approved", approved: true }] });
    const r = await runRecovery({ question: "oxygen copd", mode: "notes_and_library" }, tierPlan("notes_and_library", OPEN, true), f.sources, { wider: null });
    expect(r.sufficiency.canExplain).toBe(false);
    expect(r.state).toBe("reading_only");
  });
  it("an external source that fails leaves the notes and library results standing", async () => {
    const f = fakeSources({ notes: [passage("c1", "Oxygen in COPD is titrated.")] });
    f.sources.external = async () => { throw new Error("network"); };
    const r = await runRecovery({ question: "oxygen copd", mode: "notes_and_references" }, tierPlan("notes_and_references", OPEN, true), f.sources, { wider: null });
    expect(r.external).toMatchObject({ ran: false, reason: "unavailable" });
    expect(r.evidence.notes.map(n => n.matched)).toEqual([["oxygen", "copd"]]);
    // SQIE D-4: notes alone are not an approved reference, so the state and the verdict agree: nothing to explain from.
    expect([r.sufficiency.verdict, r.sufficiency.canExplain, r.state]).toEqual(["insufficient", false, "reading_only"]);
  });
  it("actions: wider first, explain only with evidence, continue always", () => {
    expect(suggestedActions(true, "notes_and_references").map(a => a.action)).toEqual(["find_resources", "explain_with_references", "continue_with_notes"]);
    expect(suggestedActions(false, null).map(a => a.action)).toEqual(["continue_with_notes"]);
    expect(suggestedActions(false, null, 2).map(a => a.action)).toEqual(["find_resources", "continue_with_notes"]); // reading to show
  });
  it("explanation inputs: only evidence items, notes by chunk id, approved library as references, verified abstracts as research", () => {
    const r = research([item({ abstract: "Controlled oxygen in COPD." })], [0]);
    const ev = {
      notes: [{ origin: "notes" as const, tag: "N1", chunkId: "c1", materialId: "m", materialTitle: "t", citation: "t, page 1", excerpt: "", matched: ["oxygen"] },
        { origin: "notes" as const, tag: "N2", chunkId: "c2", materialId: "m", materialTitle: "t", citation: "t, page 2", excerpt: "", matched: [] }],
      library: [{ origin: "library" as const, tag: "L1", kind: "competency" as const, itemId: "k1", version: "1.0.0", code: "R1", title: "Oxygen therapy", outcome: "Explains targets", text: "Oxygen therapy: Explains targets", status: "Clinically approved", approved: true, matched: ["oxygen"] }],
      external: externalEvidence(r, ["oxygen"]),
    };
    const g = generationInputs({ evidence: ev, sufficiency: assessSufficiency("oxygen", ev) }, r);
    expect(g?.chunkIds).toEqual(["c1"]);
    expect(g?.references).toEqual([expect.objectContaining({ competencyId: "k1", outcome: "Explains targets", approved: true, library: true })]);
    expect(g?.research).toEqual([{ title: "Oxygen therapy in COPD", journal: "Thorax", year: 2022, abstract: "Controlled oxygen in COPD." }]);
  });
  it("matchedTerms reads by prefix, as retrieval ranks", () => {
    expect(matchedTerms("Hypercapnia develops", ["hypercapnic"])).toEqual(["hypercapnic"]);
  });
});

describe("safe withholding is counted apart from answers, and recovery outcomes are linked", () => {
  it("summarises the rates and the recovery chain", () => {
    const id1 = "11111111-1111-4111-8111-111111111111", id2 = "22222222-2222-4222-8222-222222222222", id3 = "33333333-3333-4333-8333-333333333333";
    const row = (o: Partial<RecoveryOutcomeRow>): RecoveryOutcomeRow => ({ product: "scholar", activity: "explain", output_kind: "explanation", outcome: "accepted", rejection_reasons: [], material_key: null, ...o });
    const rows = [
      row({}), row({ outcome: "rejected", rejection_reasons: ["ungrounded"] }), row({ outcome: "rejected", rejection_reasons: ["not_in_notes"] }), row({ outcome: "partial" }),
      row({ activity: "evidence_recovery", output_kind: "other", outcome: "redirected", rejection_reasons: ["recovery_explanation_available"], material_key: recoveryKey(id1) }),
      row({ activity: "evidence_recovery_result", output_kind: "other", outcome: "accepted", rejection_reasons: ["recovery_recovered_explanation"], material_key: recoveryKey(id1) }),
      row({ activity: "evidence_recovery", output_kind: "other", outcome: "redirected", rejection_reasons: ["recovery_reading_only"], material_key: recoveryKey(id2) }),
      row({ activity: "evidence_recovery", output_kind: "other", outcome: "redirected", rejection_reasons: ["recovery_explanation_available"], material_key: recoveryKey(id3) }),
    ];
    const s = summariseRecovery(rows);
    expect(s.answers).toEqual({ actions: 4, answered: 2, safeWithheld: 1, declined: 1, answerRate: 50, safeWithholdingRate: 25 });
    expect(s.recovery).toEqual({ requests: 3, recoveredExplanation: 1, readingOnly: 1, unanswered: 0, explanationNotRequested: 1, recoveryRate: 33 });
  });
  it("nothing measured is null, never zero", () => {
    expect(summariseRecovery([]).answers.answerRate).toBeNull();
    expect(summariseRecovery([]).recovery.recoveryRate).toBeNull();
  });
});

// ── through the existing engine: Crossref verification, PubMed Central links, Scholar's narrowing ──────────────────

const ok1 = { at: "2026-10-28T00:00:00Z", by: "owner", ok: true, detail: "test" };
const activeRegistry = (ids: string[]): Registry =>
  resolveRegistry(Object.fromEntries(ids.map(id => [id, { ...SEED_REGISTRY[id], status: "active", checks: { connectivity: ok1, approval: ok1, activation: ok1 } }])));
const planOf = (reg: Registry): ResearchPlan => ({ product: "scholar", activity: "learn", registry: reg, policy: RESEARCH_DEFAULT, workflow: resolveWorkflows({ basic: { status: "active" } }).basic });
const NOW = () => new Date("2026-10-30T10:00:00Z");
function fakeFetch(route: (url: string) => unknown, log: string[]): FetchLike {
  return async url => {
    log.push(url);
    const b = route(url);
    if (b === undefined) return { ok: false, status: 404, text: async () => "" };
    return { ok: true, status: 200, text: async () => (typeof b === "string" ? b : JSON.stringify(b)) };
  };
}
const OPENALEX = { results: [
  { id: "https://openalex.org/W1", doi: "https://doi.org/10.1000/oxy.2022", title: "Controlled oxygen therapy in COPD exacerbations", publication_year: 2022, abstract_inverted_index: { Controlled: [0], oxygen: [1] } },
  { id: "https://openalex.org/W2", doi: "https://doi.org/10.2000/fake", title: "Controlled oxygen and hypercapnia", publication_year: 2021, abstract_inverted_index: { Oxygen: [0] } },
] };
const PUBMED = {
  esearch: { esearchresult: { idlist: ["111"] } },
  esummary: { result: { "111": { uid: "111", title: "Oxygen targets in COPD", fulljournalname: "Thorax", pubdate: "2023", authors: [], articleids: [] } } },
  efetch: `<PubmedArticleSet><PubmedArticle><PMID Version="1">111</PMID><Abstract><AbstractText>Lower oxygen targets in COPD.</AbstractText></Abstract></PubmedArticle></PubmedArticleSet>`,
};
const route = (url: string): unknown => {
  if (url.includes("esearch")) return PUBMED.esearch;
  if (url.includes("esummary")) return PUBMED.esummary;
  if (url.includes("efetch")) return PUBMED.efetch;
  if (url.includes("api.openalex.org")) return OPENALEX;
  if (url.includes("api.crossref.org") && url.includes(encodeURIComponent("10.1000/oxy.2022"))) return { message: { title: ["Controlled oxygen therapy in COPD exacerbations"], issued: { "date-parts": [[2022]] } } };
  if (url.includes("api.crossref.org") && url.includes(encodeURIComponent("10.2000/fake"))) return { message: { title: ["Bananas in the tropics"], issued: { "date-parts": [[2021]] } } };
  if (url.includes("idconv")) return { status: "ok", records: [{ pmid: "111", pmcid: "PMC777" }] };
  if (url.includes("oa.fcgi")) return `<OA><records><record id="PMC777" citation="x" license="CC BY" retracted="no"><link format="tgz" href="ftp://x"/></record></records></OA>`;
  return undefined;
};

describe("citation verification through the engine (mock fetch)", () => {
  it("a DOI Crossref confirms is verified; one Crossref contradicts is dropped before anything is shown", async () => {
    const log: string[] = [];
    const r = await runResearch("controlled oxygen copd", planOf(activeRegistry(["openalex", "crossref"])), { fetch: fakeFetch(route, log), now: NOW });
    expect(r.items.map(i => i.doi)).toEqual(["10.1000/oxy.2022"]);
    expect(r.items[0].verified.doi).toBe(true);
    expect(r.codes).toContain("dropped_identity");
  });
  it("without Crossref a DOI stays unchecked, and recovery shows nothing it could not verify", async () => {
    const r = await runResearch("controlled oxygen copd", planOf(activeRegistry(["openalex"])), { fetch: fakeFetch(route, []), now: NOW });
    expect(r.items.every(i => i.verified.doi === null)).toBe(true);
    const lr = research(r.items, r.evidence, { sourceVersions: {} });
    expect(externalEvidence(lr, ["oxygen"])).toEqual([]);
  });
});

describe("PubMed Central: open-access links through the one gate, never full text", () => {
  it("parses the ID converter and the OA service", () => {
    expect([...parsePmcIdconv({ records: [{ pmid: "111", pmcid: "PMC777" }, { pmid: "2", status: "error" }] })]).toEqual([["111", "PMC777"]]);
    expect(parsePmcOa(`<record id="PMC777" license="CC BY-NC" retracted="no">`, "PMC777")).toEqual({ pmcid: "PMC777", licence: "CC BY-NC", url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC777/", retracted: false });
    expect(parsePmcOa(`<OA><error code="idIsNotOpenAccess">x</error></OA>`, "PMC777")).toBeNull();
  });
  it("Active: the PubMed item gets its open-access link; the abstract stays an abstract", async () => {
    const r = await runResearch("oxygen copd", planOf(activeRegistry(["pubmed", "pmc"])), { fetch: fakeFetch(route, []), now: NOW });
    expect(r.items[0].openAccess).toMatchObject({ pmcid: "PMC777", licence: "CC BY" });
    const e = externalEvidence(research(r.items, r.evidence), ["oxygen"]);
    expect(e[0]).toMatchObject({ retrieved: "abstract", openAccess: { licence: "CC BY" } });
  });
  it("not Active (the default): no request reaches PubMed Central", async () => {
    const log: string[] = [];
    await runResearch("oxygen copd", planOf(activeRegistry(["pubmed"])), { fetch: fakeFetch(route, log), now: NOW });
    expect(log.some(u => /idconv|oa\.fcgi/.test(u))).toBe(false);
    expect(SEED_REGISTRY.pmc.status).toBe("configured");
  });
});

describe("Scholar's narrowing only ever narrows the engine's plan", () => {
  const plan = planOf(activeRegistry(["pubmed", "openalex", "crossref", "pmc", "google_scholar_link"]));
  it("keeps only the enabled sources, turns off what is not enabled, and lowers limits", () => {
    const n = narrowPlan(plan, { providers: ["openalex"], maxResults: 3, timeoutMs: 20000 });
    expect(n.policy.sources.scholar.providers).toEqual(["openalex"]);
    expect(n.policy.rules).toMatchObject({ doiVerification: false, openAccessLinks: false, scholarLink: false });
    expect(n.policy.limits.maxResultsPerRequest).toBe(3);
    expect(n.policy.limits.timeoutMs).toBe(RESEARCH_DEFAULT.limits.timeoutMs); // never raised above the engine's
  });
  it("an engine rule that is off stays off", () => {
    const off = { ...plan, policy: { ...plan.policy, rules: { ...plan.policy.rules, doiVerification: false } } };
    expect(narrowPlan(off, { providers: ["pubmed", "crossref"], maxResults: 5, timeoutMs: 5000 }).policy.rules.doiVerification).toBe(false);
  });
});

// SQIE D-3 (staging 30 Oct): "Question 1: antibiotic choice in pyelonephritis" gave key terms with the numbering.
describe("SQIE D-3: key terms and topic keywords leave out labels, numbering and command words", () => {
  it("a paper question gives its topic words only", () => {
    const q = "Question 1: Antibiotic choice in pyelonephritis (4 marks)";
    expect(keyTermsOf(q)).toEqual(["antibiotic", "choice", "pyelonephritis"]);
    const k = topicKeywords(q);
    expect(k.ok && k.keywords).toEqual(["antibiotic", "choice", "pyelonephritis"]);
  });
  it("drops Q and part labels, roman numerals and command words", () => {
    expect(keyTermsOf("Q2 Part b (iii) Explain and describe how ascending infection reaches the kidney. List the symptoms.")).toEqual(["ascending", "infection", "reaches", "kidney", "symptoms"]);
    expect(keyTermsOf("Outline and discuss: why is an MSU culture sent before antibiotics?")).toEqual(["msu", "culture", "sent", "antibiotics"]);
  });
  it("keeps a clinical word that is also a command word where it is not one ('mental state')", () => {
    expect(keyTermsOf("State the parts of a mental state examination")).toEqual(["mental", "state", "examination"]);
  });
});
