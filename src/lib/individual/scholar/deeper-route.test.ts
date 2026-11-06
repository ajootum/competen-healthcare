/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Passage } from "./generation";

// SCHOLAR-GO-DEEPER-001: the Learn act route, end to end with a fake database and a fake model (the fakes are learn-guided.test.ts's).
//   policy off is Go deeper as it was; policy on is a structured round at the asked level; one AI call; saved rounds of either form kept and counted;
//   the published risk rules read Scholar's own sections.

vi.setConfig({ testTimeout: 120_000 }); // the first import of the route is slow
const U = "aaaaaaaa-0000-4000-8000-00000000000a";
const S = "bbbbbbbb-0000-4000-8000-00000000000b";
const C = ["cccccccc-0000-4000-8000-000000000001", "cccccccc-0000-4000-8000-000000000002", "cccccccc-0000-4000-8000-000000000003"];

const db = vi.hoisted(() => ({
  audit: [] as { id: string; created_at: string; action: string; entity_type: string; new_value: Record<string, unknown> }[],
  artefacts: new Map<string, Record<string, unknown>>(),
  events: [] as unknown[], sessionUpdates: [] as unknown[],
  aiCalls: 0, aiText: "", aiGate: null as null | Promise<void>, aiStarted: null as null | (() => void),
  policy: {} as Record<string, unknown>, currentStep: 1, clock: 0, list: [] as Record<string, unknown>[], riskRaisedBy: null as string | null, systems: [] as string[],
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
    listArtefacts: async () => ({ ok: true, data: db.list }),
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
    withinRequestRisk: async (_a: unknown, _b: unknown, _c: unknown, texts: readonly string[]) => texts.map(t => !db.riskRaisedBy || !t.includes(db.riskRaisedBy)),
    scholarRiskGate: async () => null,
    scholarAiRunner: () => ({
      run: async (g: { system: string }) => {
        db.systems.push(g.system);
        db.aiCalls++; db.aiStarted?.();
        if (db.aiGate) await db.aiGate;
        return { ok: true, text: db.aiText, model: "fake-model", provider: "fake" };
      },
      refusal: () => null, actionId: `action-${db.aiCalls + 1}`, calls: () => ({ main: 1 }),
    }),
  };
});
vi.mock("@/lib/individual/scholar/competency-view", () => ({ loadLearnerCatalogue: async () => ({ competencies: [] }), loadTutorContext: async () => null }));
vi.mock("@/lib/individual/scholar/learn", async orig => ({ ...(await orig<typeof import("./learn")>()), governedReferences: async () => [] }));
vi.mock("@/lib/individual/scholar/learn-research", async orig => ({ ...(await orig<typeof import("./learn-research")>()), scholarResearchOperational: async () => false }));
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


const V2 = "OVERVIEW: A just culture balances accountability and learning [S1].\nKEY POINTS:\n- Staff report errors without fear of blame [S1].";
const ROUND = [
  "FOCUS QUESTION: Why does blame make an organisation less safe?",
  "COVERS: How reporting and learning depend on each other.",
  "SECTION: principle | notes | What a just culture balances",
  "A just culture balances accountability and learning [S1]. Staff report errors without fear of blame [S1].",
  "SECTION: science | scholar | Why fear silences reports",
  "People hide what they expect to be punished for, so the organisation loses sight of its own weak points.",
  "CHECK YOUR REASONING:",
  "- Why would reports fall if staff feared blame? [S1]",
  "KEY TAKEAWAYS:",
  "- Staff report errors without fear of blame [S1]",
].join("\n");
const deeper = (extra: Record<string, unknown> = {}) => post({ action: "deeper", sessionId: S, step: 1, ...extra });
const ON = { scholarGoDeeperStructured: true };
const saved = (content: string, promptVersion: string, id = "old-1") => ({ id, materialId: passage(0).materialId, action: "deeper", depth: "standard", content, background: null, flags: [], refs: [], model: "m", promptVersion, reviewStatus: "private_formative", createdAt: "2026-11-01T00:00:00Z", sources: [C[0]] });
const V2_VERSION = "scholar-learn-v3:deeper+scholar-learn-deeper-v2+scholar-learn-cumulative-v1";

const post = async (body: Record<string, unknown>) => {
  const { POST } = await import("@/app/api/individual/scholar/learn/act/route");
  const res = await POST(new Request("http://x/api/individual/scholar/learn/act", { method: "POST", body: JSON.stringify(body) }));
  return { status: res.status, json: await res.json() as Record<string, any> };
};

beforeEach(() => {
  db.audit = []; db.artefacts = new Map(); db.events = []; db.sessionUpdates = []; db.aiCalls = 0; db.aiText = ROUND; db.aiGate = null; db.aiStarted = null;
  db.policy = {}; db.currentStep = 1; db.clock = 0; db.list = []; db.riskRaisedBy = null; db.systems = [];
});

describe("policy off: Go deeper is as it was", () => {
  it("the default: v2's prompt and version, no level control, one call", async () => {
    db.aiText = V2;
    const r = await deeper({ depth: "standard" });
    expect(db.aiCalls).toBe(1);
    expect(r.json.provenance.promptVersion).toContain("scholar-learn-deeper-v2");
    expect(r.json.goDeeperLevels).toBeUndefined();
    expect(db.systems[0]).not.toContain("FOCUS QUESTION");
    expect(r.json.answer).toContain("OVERVIEW:");
  });
  it("a saved structured round stays readable with the policy off, with no AI and no level control", async () => {
    db.artefacts.set("x", saved(ROUND, "scholar-learn-v3:deeper+scholar-learn-deeper-v3+scholar-learn-cumulative-v1"));
    const r = await deeper({ open: true, depth: "standard" });
    expect(db.aiCalls).toBe(0);
    expect(r.json.answer).toContain("FOCUS QUESTION:");
    expect(r.json.goDeeperLevels).toBeUndefined();
  });
});

describe("policy on: a structured round", () => {
  beforeEach(() => { db.policy = ON; });
  it("one call, the structured prompt and version, the level control, saved for next time", async () => {
    const r = await deeper({ depth: "standard" });
    expect(db.aiCalls).toBe(1);
    expect(db.systems[0]).toContain("FOCUS QUESTION:");
    expect(r.json).toMatchObject({ goDeeperLevels: true, savedForLater: true, depth: "standard" });
    expect(r.json.provenance.promptVersion).toContain("scholar-learn-deeper-v3");
    expect(r.json.answer).toContain("SECTION: science | scholar | Why fear silences reports");
    expect(r.json.background).toBeNull();
  });
  it("reuse: the same request again is the saved round, no second call", async () => {
    await deeper({ depth: "standard" });
    const b = await deeper({ depth: "standard" });
    expect(db.aiCalls).toBe(1);
    expect(b.json).toMatchObject({ cached: true, goDeeperLevels: true });
  });
  it("each level is its depth: another level is its own round, saved under that depth", async () => {
    await deeper({ depth: "standard" });
    const adv = await deeper({ depth: "detailed" });
    expect(db.aiCalls).toBe(2);
    expect(adv.json.depth).toBe("detailed");
    expect(db.systems[1]).toContain("LEVEL: ADVANCED");
    expect([...db.artefacts.values()].map(a => a.depth).sort()).toEqual(["detailed", "standard"]);
  });
  it("a saved v2 round is not retired: it opens with no AI, unchanged, under the new policy", async () => {
    db.artefacts.set("old", saved(V2, V2_VERSION));
    const r = await deeper({ open: true, depth: "standard" });
    expect(db.aiCalls).toBe(0);
    expect(r.json).toMatchObject({ cached: true, answer: V2 });
    expect(r.json.provenance.promptVersion).toBe(V2_VERSION);
    expect([...db.artefacts.values()][0].content).toBe(V2);
  });
  it("saved rounds of both forms count towards the round limit, past which there is no call", async () => {
    db.policy = { ...ON, scholarLearnDeeperRoundsMax: 2 };
    db.list = [saved(V2, V2_VERSION, "a"), saved(ROUND, "scholar-learn-v3:deeper+scholar-learn-deeper-v3", "b")];
    const r = await deeper({ depth: "standard" });
    expect(db.aiCalls).toBe(0);
    expect(r.json.depthReached.rounds).toBe(2);
  });
  it("taught ground from a saved v2 round reaches the structured prompt, and moves the saved key", async () => {
    db.list = [saved(V2, V2_VERSION)];
    await deeper({ depth: "standard" });
    expect(db.aiCalls).toBe(1);
    expect(db.systems[0]).toContain("ALREADY been taught");
    expect(([...db.artefacts.values()][0].promptVersion as string)).toContain("scholar-learn-deeper-v3+scholar-learn-cumulative-v1");
  });
  it("the published risk rules read Scholar's sections: one that lifts the request is left out and counted, and is not saved", async () => {
    db.riskRaisedBy = "People hide";
    const r = await deeper({ depth: "standard" });
    expect(r.json.answer).not.toContain("People hide");
    expect(r.json.answer).toContain("A just culture balances");
    expect(r.json.salvage.removed).toBe(1);
    expect([...db.artefacts.values()][0].content).not.toContain("People hide");
    expect(db.aiCalls).toBe(1);
  });
  it("a round that rests on nothing in the notes is withheld and not saved", async () => {
    db.aiText = "FOCUS QUESTION: Why?\nSECTION: science | scholar | Own words\nPeople hide what they expect to be punished for.";
    const r = await deeper({ depth: "standard" });
    expect(r.json.withheld).toBe(true);
    expect(db.artefacts.size).toBe(0);
  });
  it("only Go deeper changes: Teach me keeps its own prompt", async () => {
    db.aiText = "OVERVIEW: A just culture balances accountability and learning [S1].\nKEY POINTS:\n- Staff report errors without fear of blame [S1].";
    const r = await post({ action: "teach", sessionId: S, step: 1, depth: "standard" });
    expect(db.systems[0]).not.toContain("FOCUS QUESTION");
    expect(r.json.goDeeperLevels).toBeUndefined();
  });
});
