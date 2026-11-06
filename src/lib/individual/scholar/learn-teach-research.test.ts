/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Passage } from "./generation";

// SCHOLAR-RESEARCH-TEACH-001 P1: the Learn act route, end to end with a fake database, a fake model and a fake evidence pack.
// Off changes nothing. On: a first Teach Me prepares a pack once; reopening, a saved lesson and a prepared lesson never search;
// when research cannot be part of the lesson it is taught from the notes and says so; and the references stay in two categories.

const U = "aaaaaaaa-0000-4000-8000-00000000000a";
const S = "bbbbbbbb-0000-4000-8000-00000000000b";
const C = ["cccccccc-0000-4000-8000-000000000001", "cccccccc-0000-4000-8000-000000000002", "cccccccc-0000-4000-8000-000000000003"];

const db = vi.hoisted(() => ({
  audit: [] as { id: string; created_at: string; action: string; entity_type: string; new_value: Record<string, unknown> }[],
  artefacts: new Map<string, Record<string, unknown>>(),
  events: [] as unknown[], sessionUpdates: [] as unknown[],
  aiCalls: 0, aiText: "", aiGate: null as null | Promise<void>, aiStarted: null as null | (() => void),
  policy: {} as Record<string, unknown>, currentStep: 1, clock: 0,
  pack: { calls: [] as { search: boolean }[], state: "ready" as string, complete: true }, riskClear: true, withinRisk: true, aiTexts: [] as string[],
}));

vi.mock("@/lib/trace", () => ({ currentTraceId: async () => "trace-test" }));
vi.mock("@/lib/individual/guard", () => ({
  requireIndividualContext: async () => ({ admin: fakeAdmin(), userId: U, profile: { fullName: "Learner" } }),
  isGuardRefusal: (x: unknown) => x instanceof Response,
}));
vi.mock("@/lib/individual/policy", async orig => {
  const real = await orig<typeof import("@/lib/individual/policy")>();
  return { ...real, loadIndividualPolicy: async () => ({ ...real.DEFAULT_POLICY, ...db.policy }) };
});
const passage = (i: number): Passage => ({
  chunkId: C[i], materialId: "mmmmmmmm-0000-4000-8000-000000000001", materialTitle: "Just Culture", ordinal: i + 14, pageFrom: i + 14, pageTo: i + 14, unit: "slide",
  content: ["Just Culture. A just culture balances accountability and learning. Staff report errors without fear of blame.",
    "Human error is consoled, at-risk behaviour is coached, and reckless behaviour is sanctioned.",
    "Learning systems. Reports are reviewed so the organisation learns from errors and near misses."][i],
});
vi.mock("@/lib/individual/scholar/store", async orig => {
  const real = await orig<typeof import("./store")>();
  return {
    ...real,
    getLearningSession: async () => ({ ok: true, data: {
      session: { id: S, topic: "Just Culture", title: "Just Culture", currentStep: db.currentStep },
      steps: [0, 1, 2].map(i => ({ step: i + 1, sections: [{ chunkId: C[i], materialId: passage(i).materialId, ordinal: i + 14 }] })),
    } }),
    getPassage: async (_a: unknown, _u: string, id: string) => { const i = C.indexOf(id); return i < 0 ? null : passage(i); },
    getLearningPreference: async () => null,
    topicsOfSections: async () => new Map(),
    searchCandidates: async () => ({ ok: true, data: [] }),
    listExamPapers: async () => ({ ok: true, data: [] }),
    toPassages: async () => [],
    listArtefacts: async () => ({ ok: true, data: [] }),
    findArtefact: async (_a: unknown, _u: string, key: string) => (db.artefacts.get(key) as never) ?? null,
    // SCHOLAR-PERSISTENT-LEARNING-01: the fallback's read, over the same saved rows, with the real pure match.
    findSavedLesson: async (_a: unknown, _u: string, q: { action: string; materialId: string | null; chunkIds: string[] }) =>
      (await import("./learn-journey")).newestSavedLesson([...db.artefacts.values()] as never[], q),
    saveArtefact: async (_a: unknown, _u: string, a: Record<string, unknown>) => {
      db.artefacts.set(a.dedupeKey as string, { id: `art-${db.artefacts.size + 1}`, materialId: a.materialId, action: a.action, depth: a.depth, content: a.content, background: a.background,
        flags: a.flags, refs: a.refs, model: a.model, promptVersion: a.promptVersion, reviewStatus: "private_formative", createdAt: "2026-10-31T00:00:00Z", sources: a.chunkIds });
      return "ok";
    },
    recordLearningEvent: async (_a: unknown, _u: string, e: unknown) => { db.events.push(e); return "ok"; },
    updateLearningSession: async (_a: unknown, _u: string, _s: string, p: unknown) => { db.sessionUpdates.push(p); return "ok"; },
  };
});
vi.mock("@/lib/individual/scholar/ai-standing", () => ({
  getScholarAiStanding: async () => ({}), activityState: () => ({ available: true, message: null, insufficient: false }),
}));
vi.mock("@/lib/individual/scholar/http", async orig => {
  const real = await orig<typeof import("./http")>();
  return {
    ...real,
    aiPreflight: async () => null,
    scholarRisk: async () => ({ text: "", requestText: "", competencyIds: [], topicTerms: [], actorId: U, purpose: null }),
    withinRequestRisk: async (_a: unknown, _b: unknown, _c: unknown, texts: readonly string[]) => texts.map(() => db.withinRisk),
    scholarRiskGate: async () => null,
    scholarRiskClear: async () => db.riskClear,
    scholarAiRunner: () => ({
      run: async (_g: unknown, part?: string) => {
        db.aiCalls++;
        return { ok: true, text: part === "verify" ? "[]" : (db.aiTexts.shift() ?? db.aiText), model: "fake-model", provider: "fake", usage: { input: 1, output: 1 } };
      },
      refusal: () => null, actionId: `action-${db.aiCalls + 1}`, calls: () => ({ main: 1 }),
    }),
  };
});
vi.mock("@/lib/individual/scholar/competency-view", () => ({ loadLearnerCatalogue: async () => ({ competencies: [] }), loadTutorContext: async () => null }));
vi.mock("@/lib/individual/scholar/learn", async orig => ({ ...(await orig<typeof import("./learn")>()), governedReferences: async () => [] }));
vi.mock("@/lib/individual/scholar/learn-research", async orig => ({ ...(await orig<typeof import("./learn-research")>()), scholarResearchOperational: async () => false }));
vi.mock("@/lib/individual/scholar/evidence-pack-service", () => ({
  prepareEvidencePack: async (_c: unknown, _p: unknown, input: { search: boolean }) => {
    db.pack.calls.push({ search: input.search });
    const ready = db.pack.state === "ready";
    return {
      state: db.pack.state, topics: ["critical-sensitive-periods"], searched: input.search ? 1 : 0, reused: 0, complete: db.pack.complete, codes: [], ms: 1,
      items: ready ? [{ pmid: "1" }] : [],
      evidence: ready ? [{ title: "Learning systems", journal: "J", year: 2022, kind: "systematic review", abstract: "Reports are reviewed so the organisation learns from errors." }] : [],
      references: (cited: readonly number[]) => (ready && cited.includes(1) ? [{ kind: "external", tag: "E1", provider: "PubMed", title: "Learning systems", journal: "J", year: 2022, authors: ["Ng A"], pmid: "1", doi: null, url: "https://pubmed.ncbi.nlm.nih.gov/1/", evidence: true, excerpt: null, verified: { pmid: true, doi: null }, retrievedAt: "x", sourceVersion: null, reuse: "private_evidence_excerpt_only", notUsed: null, openAccess: null, relevanceChecked: true, studyKind: "systematic review", accessed: "abstract" }] : []),
    };
  },
}));
vi.mock("@/lib/individual/scholar/outcome", () => ({ recordScholarOutcome: async () => {} }));
vi.mock("@/lib/individual/scholar/study-context", () => ({ studySessionBlock: async () => null }));

/** audit_log in memory: insert (returning id, created_at), eq (including new_value->>key), gte, order, limit. */
function fakeAdmin() {
  return {
    from(table: string) {
      let rows: Record<string, unknown>[] = table === "audit_log" ? [...db.audit] : [];
      let inserted: Record<string, unknown> | null = null;
      const q: Record<string, unknown> = {};
      const val = (r: Record<string, unknown>, c: string) => c.includes("->>") ? (r[c.split("->>")[0]] as Record<string, unknown> | null)?.[c.split("->>")[1]] : r[c];
      q.insert = (r: Record<string, unknown>) => {
        db.clock++;
        inserted = { id: `row-${String(db.clock).padStart(4, "0")}`, created_at: new Date(Date.UTC(2026, 9, 31, 12, 0, 0, db.clock)).toISOString(), ...r };
        if (table === "audit_log") db.audit.push(inserted as never);
        return q;
      };
      q.select = () => q;
      q.eq = (c: string, v: unknown) => { rows = rows.filter(r => val(r, c) === v); return q; };
      q.in = (c: string, vs: unknown[]) => { rows = rows.filter(r => vs.includes(val(r, c))); return q; };
      q.gte = (c: string, v: string) => { rows = rows.filter(r => String(val(r, c)) >= v); return q; };
      q.order = (c: string, o?: { ascending?: boolean }) => { rows.sort((a, b) => (String(a[c]) < String(b[c]) ? -1 : 1) * (o?.ascending === false ? -1 : 1)); return q; };
      q.limit = () => q;
      q.single = async () => ({ data: inserted ?? rows[0] ?? null, error: null });
      q.maybeSingle = q.single;
      q.then = (res: (x: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve({ data: inserted ? [inserted] : rows, error: null }).then(res, rej);
      return q;
    },
    rpc: async () => ({ data: null, error: null }),
  };
}


const NOTES = "OVERVIEW: A just culture balances accountability and learning [S1].\nKEY POINTS:\n- Staff report errors without fear of blame [S1].\nCHECK YOUR UNDERSTANDING:\n- Why do staff report errors without fear? [S1]";
const WITH_EVIDENCE = "OVERVIEW: A just culture balances accountability and learning [S1].\nUNDERSTANDING: Staff report errors without fear of blame [S1]. Reports are reviewed so the organisation learns from errors [E1]. Trust grows when people see what is done with what they report [AI].\n\nKEY POINTS:\n- Staff report errors without fear of blame [S1].\nCHECK YOUR UNDERSTANDING:\n- Why do staff report errors without fear? [S1]";

const post = async (body: Record<string, unknown>) => {
  const { POST } = await import("@/app/api/individual/scholar/learn/act/route");
  const res = await POST(new Request("http://x/api/individual/scholar/learn/act", { method: "POST", body: JSON.stringify(body) }));
  return { status: res.status, json: await res.json() as Record<string, any> };
};
const teach = (extra: Record<string, unknown> = {}) => post({ action: "teach", sessionId: S, step: 1, depth: "standard", ...extra });
const ON = { scholarTeachResearch: { on: true, maxSearches: 4, dailyCostCents: 100 } };

beforeEach(() => {
  db.audit = []; db.artefacts = new Map(); db.events = []; db.sessionUpdates = []; db.aiCalls = 0; db.aiText = WITH_EVIDENCE; db.aiTexts = [];
  db.policy = {}; db.currentStep = 1; db.clock = 0; db.pack = { calls: [], state: "ready", complete: true }; db.riskClear = true; db.withinRisk = true;
});

describe("off, the default", () => {
  it("makes no pack and no search, and teaches exactly as before", async () => {
    db.aiText = NOTES;
    const r = await teach();
    expect(db.pack.calls).toEqual([]);
    expect(db.aiCalls).toBe(1);
    expect(r.json.research).toBeNull();
    expect(r.json.provenance.promptVersion).not.toContain("research-teach");
  }, 30000);
});

describe("on", () => {
  beforeEach(() => { db.policy = ON; });

  it("a first Teach Me prepares one pack, writes the lesson, checks its citations, and keeps the references in two categories", async () => {
    const r = await teach();
    expect(db.pack.calls).toEqual([{ search: true }]);
    expect(db.aiCalls).toBe(2);
    expect(r.json.answer).toContain("[E1]");
    expect(r.json.answer).toContain("[S1]");
    expect(r.json.answer).toContain("[AI]");
    expect(r.json.research.integrated).toBe(true);
    expect(r.json.research.label).toBe("Scientific evidence and references");
    expect(r.json.research.references.map((x: any) => x.tag)).toEqual(["E1"]);
    expect(r.json.research.accessNote).toMatch(/Abstract reviewed/);
    expect(r.json.research.notice).toMatch(/subject terms only/);
    expect(r.json.research.query).toBeNull();
    expect(r.json.sources.map((s: any) => s.tag)).toContain("S1");
    expect(r.json.provenance.promptVersion).toContain("research-teach");
  }, 30000);

  it("reopening never searches and never calls the AI: the second Teach Me, and an open, both read what was saved", async () => {
    await teach();
    const calls = db.aiCalls, packs = db.pack.calls.length;
    const again = await teach();
    const opened = await teach({ open: true });
    expect(db.aiCalls).toBe(calls);
    expect(db.pack.calls).toHaveLength(packs);
    for (const r of [again, opened]) {
      expect(r.json.cached).toBe(true);
      expect(r.json.answer).toContain("[E1]");
      expect(r.json.research.references.map((x: any) => x.tag)).toEqual(["E1"]);
    }
  }, 30000);

  it("an open with nothing saved never searches, and tells the page what the wait is for", async () => {
    const r = await teach({ open: true });
    expect(r.json.open).toBe("generate");
    expect(r.json.teachResearch).toBe(true);
    expect(db.pack.calls).toEqual([]);
    expect(db.aiCalls).toBe(0);
  }, 30000);

  it("turning it on retires nothing: a lesson saved from the notes before is served with no search and no AI, and says research is not in it", async () => {
    db.policy = {}; db.aiText = NOTES;
    await teach();
    db.policy = ON;
    const calls = db.aiCalls;
    const r = await teach();
    expect(r.json.cached).toBe(true);
    expect(db.aiCalls).toBe(calls);
    expect(db.pack.calls).toEqual([]);
    expect(r.json.research.integrated).toBe(false);
    expect(r.json.research.message).toMatch(/External research was not included/);
  }, 30000);

  it("a pack that fails costs the research, not the lesson: taught from the notes, and said plainly", async () => {
    db.pack.state = "failed"; db.aiText = NOTES;
    const r = await teach();
    expect(r.json.answer).toContain("[S1]");
    expect(r.json.answer).not.toContain("[E1]");
    expect(r.json.research.integrated).toBe(false);
    expect(r.json.research.message).toMatch(/External research was not included/);
  }, 30000);

  it("a request the clinical gate would refuse sends nothing to any source", async () => {
    db.riskClear = false; db.aiText = NOTES;
    await teach();
    expect(db.pack.calls).toEqual([]);
  }, 30000);

  it("research that would lift the request above its own risk tier is not shown: the lesson falls back to its notes sentences", async () => {
    db.withinRisk = false;
    const r = await teach();
    expect(r.json.answer).toContain("[S1]");
    expect(r.json.answer).not.toMatch(/\[E1\]|\[AI\]/);
    expect(r.json.research.integrated).toBe(false);
  }, 30000);

  it("a lesson with evidence that cannot stand is taught again from the notes, once", async () => {
    db.aiTexts = ["OVERVIEW: Reports are reviewed so the organisation learns from errors [E1]. Trust grows slowly [AI]. People notice what is done [AI]. Learning takes time [AI]. Blame closes mouths [AI]. Fear hides errors [AI]."];
    db.aiText = NOTES;
    const r = await teach();
    expect(r.json.answer).toContain("[S1]");
    expect(r.json.answer).not.toContain("[E1]");
    expect(r.json.research.integrated).toBe(false);
    expect(db.aiCalls).toBe(2);
  }, 30000);

  it("a prepared lesson asks for what is shared, never searches, and waits for the learner when it is not all there", async () => {
    db.policy = { ...ON, scholarLearnPrepareNext: true }; db.pack.complete = false; db.pack.state = "none";
    const r = await post({ action: "teach", sessionId: S, step: 1, depth: "standard", prepare: true });
    expect(db.pack.calls).toEqual([{ search: false }]);
    expect(r.json.prepared).toBe(false);
    expect(r.json.reason).toBe("no_evidence_pack");
    expect(db.aiCalls).toBe(0);
  }, 30000);

  it("the audit row holds counts, codes and list entries only", async () => {
    await teach();
    const row = db.audit.find(a => (a.new_value as any).teach_research);
    expect((row!.new_value as any).teach_research).toMatchObject({ state: "ready", topics: ["critical-sensitive-periods"], searched: 1, cited: 1 });
    expect(JSON.stringify((row!.new_value as any).teach_research)).not.toMatch(/just culture|blame/i);
  }, 30000);

  it("Research & Explain stays its own path", async () => {
    db.policy = { ...ON, scholarResearch: { modes: ["notes"], dailyMax: 5, dailyCostCents: 25, relevance: "standard" } };
    const r = await teach({ mode: "research" });
    expect(r.status).toBe(403);
    expect(db.pack.calls).toEqual([]);
  }, 30000);
});
