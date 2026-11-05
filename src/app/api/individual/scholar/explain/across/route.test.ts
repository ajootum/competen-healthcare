import { beforeEach, describe, expect, it, vi } from "vitest";

// SCHOLAR-ASK-SOURCES-01: the route with its sources replaced by recorders, so what reaches the model and what reaches the learner
// are what is asserted. Staging can reach no approved library content, so the library path is proved here.

const h = vi.hoisted(() => ({
  policy: { scholarResearch: { modes: ["notes", "library", "research"] }, scholarRecovery: {}, scholarCaseEntries: [] },
  aiCalls: [] as { passages: { chunkId: string }[]; research: unknown[] }[],
  researchCalls: 0,
  research: null as unknown,
  materials: [] as { chunkId: string; materialId: string; materialTitle: string; ordinal: number; pageFrom: null; pageTo: null; content: string }[],
  library: [] as { approved: boolean; title: string; code: string | null; outcome: string | null; status: string; kind: string; text: string }[],
  libraryReady: true,
  researchOperational: true,
  reply: { ok: true, check: { ok: false, reason: "not_in_notes" }, research: null, model: "m", promptVersion: "v+across-v1" } as Record<string, unknown>,
  refs: [] as Record<string, unknown>[],
  gate: null as unknown,
}));

vi.mock("@/lib/individual/guard", () => ({ requireIndividualContext: async () => ({ admin: {}, userId: "u1", profile: {}, live: ["scholar"] }), isGuardRefusal: () => false }));
vi.mock("@/lib/individual/policy", () => ({ loadIndividualPolicy: async () => h.policy }));
vi.mock("@/lib/individual/scholar/outcome", () => ({ recordScholarOutcome: async () => {} }));
vi.mock("@/lib/individual/scholar/store", () => ({
  isUuid: (v: unknown) => typeof v === "string" && v.length === 36,
  librarySchema: async () => true,
  savedLearningRows: async () => ({ ok: true, data: [] }),
  competencyChunks: async () => ({ ok: true, data: [] }),
  searchCandidates: async () => ({ ok: true, data: h.materials }),
  toPassages: async () => h.materials,
}));
vi.mock("@/lib/individual/scholar/retrieval", () => ({ rankChunks: (_q: string, x: unknown[]) => x, spreadAcrossMaterials: (x: unknown[]) => x, toTsQuery: (q: string) => q }));
vi.mock("@/lib/individual/scholar/http", () => ({
  AI_ERROR: {}, SCHOLAR_AI_AUDIT_ACTION: "a", aiPreflight: async () => null, audit: async () => {}, meteredRefusal: (r: unknown) => (r ? new Response(JSON.stringify({ error: "refused" }), { status: 403 }) : null),
  scholarAiRunner: () => ({ actionId: "act", run: async () => ({}), refusal: () => null }), scholarRisk: async () => ({}), scholarRiskGate: async () => h.gate, withinRequestRisk: async () => [true],
}));
vi.mock("@/lib/individual/scholar/generation", () => ({
  ASK_LIBRARY_LABEL: "library label", ASK_RESEARCH_LABEL: "research label", EXPLAIN_REFUSAL: { ungrounded: "withheld" }, RESEARCH_WITHHELD: { dosing: "dose" },
  isExplainMode: (m: string) => ["explain", "summary", "simplify", "deeper", "tutor"].includes(m),
  passageCitation: (p: { materialTitle: string }) => p.materialTitle, passageTag: (i: number) => `S${i + 1}`,
  savedLearningPassage: (r: unknown) => r,
  runAskAcross: async (_u: string, a: { passages: { chunkId: string }[]; research: unknown[] }) => { h.aiCalls.push(a); return h.reply; },
}));
vi.mock("@/lib/individual/scholar/extract", () => ({ findPatientIdentifiers: (t: string) => (t.includes("NHS") ? ["x"] : []) }));
vi.mock("@/lib/individual/scholar/config", () => ({ AI_LABEL: "AI", QUESTION_MAX: 500, RETRIEVAL_LIMIT: 5 }));
vi.mock("@/lib/individual/scholar/learn-research", () => ({
  learnResearch: async () => { h.researchCalls++; return h.research; }, researchEvidence: (r: { evidence: unknown[] }) => r.evidence, externalReferences: () => h.refs, scholarResearchOperational: async () => h.researchOperational,
}));
vi.mock("@/lib/individual/scholar/evidence-recovery", () => ({
  askLibraryReady: async () => h.libraryReady, keyTermsOf: () => ["a"], liveSources: () => ({ library: async () => h.library }),
}));
vi.mock("@/lib/individual/scholar/competency-view", () => ({ loadLearnerCatalogue: async () => ({ competencies: [] }) }));
vi.mock("@/lib/individual/scholar/source-quality", () => ({ qualityOf: () => ({}) }));

import { POST } from "./route";

const ask = async (body: Record<string, unknown>) => {
  const res = await POST(new Request("http://x/api", { method: "POST", body: JSON.stringify({ question: "What about oxygen?", ...body }) }));
  return { status: res.status, json: await res.json() };
};
const entry = { approved: true, title: "Oxygen therapy", code: "RS-1", outcome: "Give oxygen safely", status: "Clinically approved", kind: "competency", text: "Oxygen therapy: Give oxygen safely" };
const stateOf = (json: { searched: { source: string; state: string }[] }, s: string) => json.searched.find(x => x.source === s)?.state;

beforeEach(() => {
  h.aiCalls = []; h.researchCalls = 0; h.research = null; h.materials = []; h.library = []; h.libraryReady = true; h.researchOperational = true; h.refs = []; h.gate = null;
  h.reply = { ok: true, check: { ok: false, reason: "not_in_notes" }, research: null, model: "m", promptVersion: "v+across-v1" };
});

describe("Competen Library", () => {
  it("is listed with no AI call when it is the only source chosen", async () => {
    h.library = [entry];
    const { status, json } = await ask({ sources: ["library"] });
    expect(status).toBe(200);
    expect(h.aiCalls).toHaveLength(0);
    expect(json.library.items).toEqual([{ title: "Oxygen therapy", code: "RS-1", outcome: "Give oxygen safely", status: "Clinically approved", kind: "competency" }]);
    expect(stateOf(json, "library")).toBe("listed");
    expect(json.message).toBeUndefined();
  });
  it("lists only approved entries", async () => {
    h.library = [entry, { ...entry, approved: false, title: "Not approved" }];
    const { json } = await ask({ sources: ["library"] });
    expect(json.library.items.map((i: { title: string }) => i.title)).toEqual(["Oxygen therapy"]);
  });
  it("is never given to the model, when another source is also chosen", async () => {
    h.library = [entry];
    h.materials = [{ chunkId: "c1", materialId: "m1", materialTitle: "Notes", ordinal: 1, pageFrom: null, pageTo: null, content: "x" }];
    h.reply = { ok: true, check: { ok: true, text: "Answer [S1].", cited: [1] }, research: null, model: "m", promptVersion: "v" };
    const { json } = await ask({ sources: ["materials", "library"] });
    expect(h.aiCalls).toHaveLength(1);
    expect(JSON.stringify(h.aiCalls[0])).not.toContain("Oxygen therapy");
    expect(json.answer).toBe("Answer [S1].");
    expect(json.library.items).toHaveLength(1);
  });
  it("says nothing matched rather than showing an empty part", async () => {
    const { json } = await ask({ sources: ["library"] });
    expect(json.library).toBeNull();
    expect(stateOf(json, "library")).toBe("no_match");
    expect(json.message).toContain("None of the sources");
  });
  it("is refused as not searched for a learner who can reach no approved content", async () => {
    h.libraryReady = false;
    const { json } = await ask({ sources: ["library"] });
    expect(stateOf(json, "library")).toBe("not_run");
    expect(json.message).toContain("could not be searched");
  });
});

describe("research", () => {
  const found = { state: "searched", items: [{}, {}], evidence: [{ title: "T", abstract: "A" }] };
  const refs = [
    { kind: "external", tag: "E1", evidence: true, title: "Read and used", journal: "J", year: 2024, provider: "PubMed", url: "https://x/1", excerpt: "e" },
    { kind: "external", tag: null, evidence: false, title: "Only found", journal: null, year: null, provider: "OpenAlex", url: "https://x/2", excerpt: null },
  ];
  it("tells what was used as evidence from what was only found", async () => {
    h.research = found; h.refs = refs;
    h.reply = { ok: true, check: { ok: false, reason: "not_in_notes" }, research: { ok: true, text: "Said [E1].", cited: [1] }, model: "m", promptVersion: "v" };
    const { json } = await ask({ sources: ["research"] });
    expect(json.research.used.map((u: { title: string }) => u.title)).toEqual(["Read and used"]);
    expect(json.research.found.map((u: { title: string }) => u.title)).toEqual(["Only found"]);
    expect(json.answer).toBeNull();
    expect(stateOf(json, "research")).toBe("used");
  });
  it("does not list evidence the answer did not cite as used", async () => {
    h.research = found; h.refs = refs;
    h.reply = { ok: true, check: { ok: true, text: "Notes [S1].", cited: [1] }, research: null, model: "m", promptVersion: "v" };
    h.materials = [{ chunkId: "c1", materialId: "m1", materialTitle: "Notes", ordinal: 1, pageFrom: null, pageTo: null, content: "x" }];
    const { json } = await ask({ sources: ["materials", "research"] });
    expect(json.research.used).toEqual([]);
    expect(json.research.found.map((u: { title: string }) => u.title)).toEqual(["Read and used", "Only found"]);
  });
  it("makes no AI call when providers are down and nothing else was chosen, and says it was not searched", async () => {
    h.research = { state: "failed", items: [], evidence: [] };
    const { json } = await ask({ sources: ["research"] });
    expect(h.aiCalls).toHaveLength(0);
    expect(stateOf(json, "research")).toBe("not_run");
    expect(json.message).toContain("could not be searched");
  });
  it("keeps the notes answer when providers are down", async () => {
    h.research = { state: "failed", items: [], evidence: [] };
    h.materials = [{ chunkId: "c1", materialId: "m1", materialTitle: "Notes", ordinal: 1, pageFrom: null, pageTo: null, content: "x" }];
    h.reply = { ok: true, check: { ok: true, text: "Notes [S1].", cited: [1] }, research: null, model: "m", promptVersion: "v" };
    const { json } = await ask({ sources: ["materials", "research"] });
    expect(json.answer).toBe("Notes [S1].");
    expect(stateOf(json, "materials")).toBe("used");
    expect(stateOf(json, "research")).toBe("not_run");
  });
  it("does not say the sources had nothing when one was never searched", async () => {
    h.research = { state: "failed", items: [], evidence: [] };
    h.materials = [{ chunkId: "c1", materialId: "m1", materialTitle: "Notes", ordinal: 1, pageFrom: null, pageTo: null, content: "x" }];
    const { json } = await ask({ sources: ["materials", "research"] });
    expect(json.message).toContain("could not be searched");
    expect(json.message).not.toContain("None of the sources");
  });
  it("sends nothing out when the request's risk is refused", async () => {
    h.gate = { error: "refused" };
    const { status } = await ask({ sources: ["research"] });
    expect(status).toBe(403);
    expect(h.researchCalls).toBe(0);
  });
  it("is not searched when the engine is not operational", async () => {
    h.researchOperational = false;
    const { json } = await ask({ sources: ["research"] });
    expect(h.researchCalls).toBe(0);
    expect(stateOf(json, "research")).toBe("not_run");
  });
});

describe("the request", () => {
  it("refuses a patient identifier before any search", async () => {
    const { status } = await ask({ question: "NHS number query", sources: ["research"] });
    expect(status).toBe(422);
    expect(h.researchCalls).toBe(0);
  });
  it("refuses no source, and the tutor mode", async () => {
    expect((await ask({ sources: [] })).status).toBe(400);
    expect((await ask({ sources: ["materials"], mode: "tutor" })).status).toBe(400);
  });
  it("reports web as not searched, and never searches it", async () => {
    const { json } = await ask({ sources: ["web"] });
    expect(stateOf(json, "web")).toBe("not_run");
    expect(h.aiCalls).toHaveLength(0);
  });
});
