import { describe, expect, it } from "vitest";
import type { GenerateArgs, GenerateResult } from "@/lib/ai/client";
import {
  LEARN_RESEARCH_OPERATION, RESEARCH_MARKER, checkLearnMain, checkResearchPart, learnPromptVersion, learnResearchPromptVersion, learnSystem, runLearn, splitLearnAnswer,
  type Passage, type ResearchEvidence,
} from "./generation";
import { artefactKey, libraryReferences, relabelReferences } from "./learn";
import { externalReferences, researchEvidence, type LearnResearch } from "./learn-research";
import { policyPath, resolvePolicy } from "../policy";

// COMPETEN-RESEARCH-01: Research & Explain on the ONE Learn engine. The research part is its own kind of content,
// checked on its own; the notes part is unchanged and may never cite external research.

const P = (i: number, content: string): Passage => ({ chunkId: `c${i}`, materialId: "m", materialTitle: "Respiratory notes", ordinal: i, pageFrom: i, pageTo: i, content });
const NOTES = [P(1, "Oxygen is a drug and is given to a target saturation range. Too much oxygen can cause harm.")];
const EV: ResearchEvidence[] = [
  { title: "Oxygen saturation targets in acute illness: a systematic review", journal: "Respiratory Care", year: 2022, abstract: "Conservative oxygen targets were compared with liberal targets. Liberal oxygen was associated with higher mortality in acutely ill adults." },
  { title: "Patient experience of oxygen therapy", journal: "Thorax", year: 2021, abstract: "Patients described oxygen masks as uncomfortable and reported dry mouth." },
];

describe("checkResearchPart: every sentence cited, only from the given abstracts", () => {
  it("accepts a cited summary of what the abstracts say", () => {
    const r = checkResearchPart("Studies comparing targets found liberal oxygen was associated with higher mortality in acutely ill adults [E1]. Patients described oxygen masks as uncomfortable [E2].", EV, NOTES, "");
    expect(r).toEqual({ ok: true, text: expect.any(String), cited: [1, 2] });
  });
  it("a tag after the full stop still counts for its sentence", () => {
    expect(checkResearchPart("Liberal oxygen was associated with higher mortality in acutely ill adults. [E1]", EV, NOTES, "")).toMatchObject({ ok: true });
  });
  it("withholds an uncited sentence, a tag it was not given, a notes tag, dosing and an invented figure", () => {
    expect(checkResearchPart("Liberal oxygen was associated with higher mortality [E1]. Everyone agrees this is settled practice now.", EV, NOTES, "")).toMatchObject({ ok: false, reason: "uncited_sentence" });
    expect(checkResearchPart("Liberal oxygen was associated with higher mortality [E3].", EV, NOTES, "")).toMatchObject({ ok: false, reason: "bad_citation" });
    expect(checkResearchPart("Liberal oxygen was associated with higher mortality [E1] as your notes say [S1].", EV, NOTES, "")).toMatchObject({ ok: false, reason: "mixed" });
    expect(checkResearchPart("Give oxygen at a dose titrated to the target [E1].", EV, NOTES, "")).toMatchObject({ ok: false, reason: "dosing" });
    expect(checkResearchPart("Liberal oxygen raised mortality by 40 percent in adults [E1].", EV, NOTES, "")).toMatchObject({ ok: false, reason: "ungrounded" });
    expect(checkResearchPart("No sources here at all.", EV, NOTES, "")).toMatchObject({ ok: false, reason: "no_citation" });
  });
});

describe("the notes part is kept apart", () => {
  it("never cites external research", () => {
    expect(checkLearnMain("Oxygen is given to a target saturation range [S1] [E1].", "", NOTES, [])).toMatchObject({ ok: false, reason: "bad_citation" });
  });
  it("the answer splits into notes, research and flags in any order", () => {
    const s = splitLearnAnswer(`From the notes [S1].\n\n${RESEARCH_MARKER}\nResearch [E1].\n\nCHECK THIS:\n- a flag [S1]`);
    expect(s).toEqual({ main: "From the notes [S1].", research: "Research [E1].", flags: "- a flag [S1]", background: null });
  });
  it("the research instruction appears only in research mode", () => {
    expect(learnSystem("teach", { depth: "standard", background: false, references: false })).not.toContain(RESEARCH_MARKER);
    expect(learnSystem("teach", { depth: "standard", background: false, references: false, research: true })).toContain(RESEARCH_MARKER);
    expect(learnSystem("check", { depth: "standard", background: false, references: false, research: true })).not.toContain(RESEARCH_MARKER);
  });
});

describe("runLearn with research: its own operation and prompt version, both parts checked", () => {
  const run = (text: string, seen: GenerateArgs[] = []) => async (g: GenerateArgs): Promise<GenerateResult> => { seen.push(g); return { ok: true, text, model: "m", provider: "anthropic" } as GenerateResult; };
  it("thin notes: the notes part is withheld, the research part is shown", async () => {
    const seen: GenerateArgs[] = [];
    const r = await runLearn("u", { action: "teach", question: "Teach me", passages: NOTES, references: [], depth: "standard", background: false, history: [], learnerContext: null, research: EV },
      run(`NOT_IN_NOTES\n\n${RESEARCH_MARKER}\nLiberal oxygen was associated with higher mortality in acutely ill adults [E1].`, seen));
    if (!r.ok) throw new Error("expected ok");
    expect(r.check).toMatchObject({ ok: false, reason: "not_in_notes" });
    expect(r.research).toMatchObject({ ok: true, cited: [1] });
    expect(r.promptVersion).toBe(learnResearchPromptVersion("teach"));
    expect(seen[0].context?.operation).toBe(LEARN_RESEARCH_OPERATION);
    expect(seen[0].user).toContain("[E1] Oxygen saturation targets");
  });
  it("no research given: exactly the notes-only request as before", async () => {
    const seen: GenerateArgs[] = [];
    const r = await runLearn("u", { action: "teach", question: "Teach me", passages: NOTES, references: [], depth: "standard", background: false, history: [], learnerContext: null },
      run("Oxygen is given to a target saturation range [S1].", seen));
    if (!r.ok) throw new Error("expected ok");
    expect(r.research).toBeNull();
    expect(r.promptVersion).toBe(learnPromptVersion("teach"));
    expect(seen[0].context?.operation).toBe("individual_scholar_learn");
    expect(seen[0].user).not.toContain("EXTERNAL RESEARCH");
  });
});

describe("references: real records only, labelled, saved apart", () => {
  const item = (n: number, abstract: string | null, verified = { pmid: true, doi: null as boolean | null }) => ({
    provider: "pubmed" as const, sourceId: String(n), pmid: String(n), doi: null, title: `Title ${n}`, journal: "J", year: 2022, authors: ["A"],
    url: `https://pubmed.ncbi.nlm.nih.gov/${n}/`, abstract, verified, retrievedAt: "2026-10-28T00:00:00Z",
  });
  const R: LearnResearch = { state: "searched", message: null, query: "oxygen", scholarLink: "https://scholar.google.com/scholar?q=oxygen", items: [item(1, null), item(2, "Abstract two")], evidence: [1], calls: [], codes: [] };
  it("evidence first and tagged E1, further reading untagged, with the provider's own ids and link", () => {
    const refs = externalReferences(R);
    expect(refs.map(r => [r.tag, r.pmid, r.evidence])).toEqual([["E1", "2", true], [null, "1", false]]);
    expect(refs[0]).toMatchObject({ kind: "external", provider: "PubMed", url: "https://pubmed.ncbi.nlm.nih.gov/2/", excerpt: "Abstract two" });
    expect(researchEvidence(R)).toEqual([{ title: "Title 2", journal: "J", year: 2022, abstract: "Abstract two" }]);
  });
  it("a saved answer's external references are never relabelled as governed ones", () => {
    expect(relabelReferences(externalReferences(R), { collections: false, catalogue: [] })).toEqual([]);
  });
  it("a notes-only key is unchanged; library and research answers have their own", () => {
    const k = { action: "teach", depth: "standard", chunkIds: ["c1"], promptVersion: "v", references: [], background: false };
    expect(artefactKey({ ...k, mode: "notes" })).toBe(artefactKey(k));
    expect(artefactKey({ ...k, mode: "research" })).not.toBe(artefactKey(k));
    expect(artefactKey({ ...k, mode: "library" })).not.toBe(artefactKey({ ...k, mode: "research" }));
  });
  it("the library mode matches governed entries by topic and labels them", () => {
    const source = { collections: false as const, catalogue: [{ id: "k1", code: "RESP-1", title: "Oxygen therapy administration", outcomes: ["Explain oxygen target saturation"], contentStatus: "approved" }] as never };
    const refs = libraryReferences("oxygen target saturation therapy", source, []);
    expect(refs).toEqual([expect.objectContaining({ competencyId: "k1", library: true, approved: true })]);
  });
});

describe("policy: research is OFF until the owner publishes a mode AND a provider", () => {
  it("defaults to notes only, no provider", () => {
    const p = resolvePolicy([]).scholarResearch;
    expect(p).toMatchObject({ modes: ["notes"], providers: [], abstracts: true, verifyDoi: true, maxResults: 5, cacheDays: 30, dailyMax: 5, dailyCostCents: 25 });
  });
  it("research mode needs a provider; notes is always offered", () => {
    const modes = { config_path: policyPath("scholar_learn_source_modes"), published: { enabled: ["research", "library"] } };
    expect(resolvePolicy([modes]).scholarResearch.modes).toEqual(["notes", "library"]);
    const providers = { config_path: policyPath("scholar_research_providers"), published: { order: ["openalex", "pubmed", "google"] } };
    expect(resolvePolicy([modes, providers]).scholarResearch).toMatchObject({ modes: ["notes", "library", "research"], providers: ["openalex", "pubmed"] });
  });
  it("ranges are enforced", () => {
    const big = { config_path: policyPath("scholar_research_max_results"), published: { value: 500 } };
    expect(resolvePolicy([big]).scholarResearch.maxResults).toBeLessThanOrEqual(10);
  });
});
