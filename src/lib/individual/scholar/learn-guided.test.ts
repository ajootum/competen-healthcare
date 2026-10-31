/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Passage } from "./generation";

// SCHOLAR-GUIDED-LEARNING-01 slice G-A: the Learn act route, end to end with a fake database and a fake model.
//   cache first (zero AI for a saved lesson, an earlier prompt version included), open (never AI), dedupe (two identical
//   requests, one AI call), prepare-next (off by default, one ahead, never twice), salvage through the route, timings.

const U = "aaaaaaaa-0000-4000-8000-00000000000a";
const S = "bbbbbbbb-0000-4000-8000-00000000000b";
const C = ["cccccccc-0000-4000-8000-000000000001", "cccccccc-0000-4000-8000-000000000002", "cccccccc-0000-4000-8000-000000000003"];

const db = vi.hoisted(() => ({
  audit: [] as { id: string; created_at: string; action: string; entity_type: string; new_value: Record<string, unknown> }[],
  artefacts: new Map<string, Record<string, unknown>>(),
  events: [] as unknown[], sessionUpdates: [] as unknown[],
  aiCalls: 0, aiText: "", aiGate: null as null | Promise<void>, aiStarted: null as null | (() => void),
  policy: {} as Record<string, unknown>, currentStep: 1, clock: 0,
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
    withinRequestRisk: async (_a: unknown, _b: unknown, _c: unknown, texts: readonly string[]) => texts.map(() => true),
    scholarRiskGate: async () => null,
    scholarAiRunner: () => ({
      run: async () => {
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

const GOOD = "OVERVIEW: A just culture balances accountability and learning [S1].\nKEY POINTS:\n- Staff report errors without fear of blame [S1].\nCHECK YOUR UNDERSTANDING:\n- Why do staff report errors without fear? [S1]";
const TWO = "OVERVIEW: A just culture balances accountability and learning [S1].\nKEY POINTS:\n- The idea was set out two decades ago [S1].\n- Staff report errors without fear of blame [S1].";

const post = async (body: Record<string, unknown>) => {
  const { POST } = await import("@/app/api/individual/scholar/learn/act/route");
  const res = await POST(new Request("http://x/api/individual/scholar/learn/act", { method: "POST", body: JSON.stringify(body) }));
  return { status: res.status, json: await res.json() as Record<string, any> };
};
const teach = (extra: Record<string, unknown> = {}) => post({ action: "teach", sessionId: S, step: 1, depth: "standard", ...extra });
const settle = () => new Promise(r => setTimeout(r, 20));
const rows = (action: string) => db.audit.filter(r => r.action === action).map(r => r.new_value);

beforeEach(() => {
  db.audit = []; db.artefacts = new Map(); db.events = []; db.sessionUpdates = []; db.aiCalls = 0; db.aiText = GOOD; db.aiGate = null; db.aiStarted = null;
  db.policy = {}; db.currentStep = 1; db.clock = 0;
});

describe("cache first: a saved lesson opens with no AI call", () => {
  it("the second identical Teach is served from the saved lesson: one AI call in all, cached flags and a served row", async () => {
    const a = await teach();
    expect(a.json.cached).toBe(false);
    expect(a.json.savedForLater).toBe(true);
    const b = await teach();
    expect(db.aiCalls).toBe(1);
    expect(b.json).toMatchObject({ cached: true, artefactId: "art-1", answer: a.json.answer });
    await settle();
    const served = rows("scholar_learn_served");
    expect(served).toHaveLength(1);
    expect(served[0]).toMatchObject({ cached: true, artefact_id: "art-1", legacy: false });
    expect(Object.keys(served[0].timing_ms as object)).toEqual(expect.arrayContaining(["auth_policy", "cache", "total"]));
    expect(db.events).toHaveLength(2); // learning recorded both times, as before
  });
  it("a lesson saved under the previous Teach Me version (v1) is still served with no AI call", async () => {
    await teach();
    const [[key, row]] = [...db.artefacts];
    const { artefactKey } = await import("./learn");
    const { DEFAULT_POLICY } = await import("@/lib/individual/policy");
    const { PROMPT_VERSIONS } = await import("./config");
    const v1 = artefactKey({ action: "teach", depth: "standard", chunkIds: [C[0]], promptVersion: `${PROMPT_VERSIONS.learn}:teach+scholar-learn-teach-v1`, references: [], background: DEFAULT_POLICY.scholarBeyondNotes === "labelled", mode: "notes" });
    db.artefacts = new Map([[v1, { ...row, id: "art-v1", promptVersion: `${PROMPT_VERSIONS.learn}:teach+scholar-learn-teach-v1` }]]);
    expect(key).not.toBe(v1);
    db.aiCalls = 0;
    const b = await teach();
    expect(db.aiCalls).toBe(0);
    expect(b.json).toMatchObject({ cached: true, artefactId: "art-v1" });
  });
  it("open: nothing saved says generate (no AI, no allowance read); once saved, open serves it", async () => {
    const o = await teach({ open: true });
    expect(o.json).toMatchObject({ open: "generate", cached: false });
    expect(db.aiCalls).toBe(0);
    expect(rows("scholar_learn_inflight")).toHaveLength(0);
    await teach();
    const o2 = await teach({ open: true });
    expect(o2.json).toMatchObject({ cached: true, artefactId: "art-1" });
    expect(db.aiCalls).toBe(1);
  });
});

describe("dedupe: two identical requests never both call the AI", () => {
  it("the later request waits and is served the first one's lesson", async () => {
    let release!: () => void, started!: () => void;
    db.aiGate = new Promise<void>(r => { release = r; });
    const aiStarted = new Promise<void>(r => { started = r; });
    db.aiStarted = started;
    const first = teach();
    await aiStarted;
    const second = teach();
    await new Promise(r => setTimeout(r, 50)); // the second has claimed and found the first in flight
    release();
    const [a, b] = await Promise.all([first, second]);
    expect(db.aiCalls).toBe(1);
    expect(a.json.cached).toBe(false);
    expect(b.json).toMatchObject({ cached: true, duplicateSuppressed: true, artefactId: "art-1" });
    await settle();
    expect(rows("scholar_learn_served")[0]).toMatchObject({ duplicate_suppressed: true });
    // the first's flight is closed with its outcome, the duplicate's own row at once
    expect(rows("scholar_learn_inflight").filter(v => v.phase === "end").map(v => v.outcome).sort()).toEqual(["duplicate", "shown"]);
  }, 10000);
});

describe("prepare-next", () => {
  it("is off by default: nothing is read beyond the policy, nothing is generated", async () => {
    const p = await teach({ prepare: true });
    expect(p.json).toEqual({ prepared: false, reason: "off" });
    expect(db.aiCalls).toBe(0);
    expect(db.audit).toHaveLength(0);
  });
  it("on: prepares the NEXT lesson only, records no learning, marks the row prepared; never twice; one ahead only", async () => {
    db.policy = { scholarLearnPrepareNext: true };
    const p = await teach({ prepare: true });
    expect(p.json).toMatchObject({ prepared: true, step: 2 });
    expect(db.aiCalls).toBe(1);
    expect(db.events).toHaveLength(0);
    expect(db.sessionUpdates).toHaveLength(0);
    expect(rows("ai_assistant_query")[0]).toMatchObject({ prepared: true, step: 2, cached: false, recorded: false });
    const again = await teach({ prepare: true });
    expect(again.json).toMatchObject({ prepared: false, reason: "saved", step: 2 });
    expect(db.aiCalls).toBe(1);
    // not from where the learner is: refused, never two ahead
    expect((await teach({ prepare: true, step: 2 })).json).toMatchObject({ prepared: false, reason: "not_current" });
    db.currentStep = 3;
    expect((await teach({ prepare: true, step: 3 })).json).toMatchObject({ prepared: false, reason: "no_next" });
    // the learner moves on: the prepared lesson opens with no AI call, and the served row joins it by key
    const opened = await teach({ step: 2 });
    expect(opened.json).toMatchObject({ cached: true, step: 2 });
    expect(db.aiCalls).toBe(1);
    await settle();
    expect(rows("scholar_learn_served")[0].dedupe_key).toBe(rows("ai_assistant_query")[0].dedupe_key);
  });
  it("only Teach Me is prepared, and only in a recorded session", async () => {
    db.policy = { scholarLearnPrepareNext: true };
    expect((await post({ action: "explain", sessionId: S, step: 1, prepare: true })).json).toMatchObject({ prepared: false, reason: "not_teach" });
    expect((await post({ action: "teach", chunkIds: [C[0]], prepare: true })).json).toMatchObject({ prepared: false, reason: "no_session" });
    expect(db.aiCalls).toBe(0);
  });
});

describe("salvage through the route, and the timings", () => {
  it("'the number two': the lesson is shown partial with a note and a count, saved as partial, and reopens so", async () => {
    db.aiText = TWO;
    const a = await teach();
    expect(a.json.withheld).toBeUndefined();
    expect(a.json.answer).not.toMatch(/two decades/);
    expect(a.json.salvage).toEqual({ removed: 1, note: "Some statements were left out because your notes don't support them." });
    expect(a.json.grounding).toMatchObject({ outcome: "partial", removed: 1 });
    const audit = rows("ai_assistant_query")[0];
    expect(audit).toMatchObject({ outcome: "shown", salvage_removed: 1 });
    expect(String(audit.salvage_detail)).toMatch(/two/);
    expect(JSON.stringify(audit)).not.toMatch(/decades/);
    expect(Object.keys(audit.timing_ms as object)).toEqual(expect.arrayContaining(["auth_policy", "references", "cache", "standing_preflight", "dedupe_claim", "context", "risk", "ai", "generate", "save", "total"]));
    const b = await teach();
    expect(b.json).toMatchObject({ cached: true, salvage: { removed: 1 } });
    expect(String(b.json.provenance.promptVersion)).toMatch(/\+partial:1$/);
  });
});
