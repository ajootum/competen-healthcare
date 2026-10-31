import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

// SCHOLAR-SESSION-AI-02 slice C (owner D4): the study-session block reaches the learn/act ask ONLY for the caller's own
// connected session (policy on, 740 present), is built from store reads alone, and travels under the learner-context
// rule with its own prompt version. Over a mocked store; the route's wiring is read statically, as the recovery wiring is.

const store = vi.hoisted(() => ({
  studySessionSchema: vi.fn(), getConnectedSession: vi.fn(), getLearningSession: vi.fn(), listStudyLinks: vi.fn(), learningEvents: vi.fn(),
  topicsOfSections: vi.fn(), revisionPool: vi.fn(), getOsceAttempt: vi.fn(), setLastSpace: vi.fn(), addStudyLink: vi.fn(), latestConnectedSession: vi.fn(), recentWrittenFeedback: vi.fn(),
}));
vi.mock("./store", () => store);
vi.mock("./learn-search", () => ({ displaySessionTitle: (t: string) => t }));
vi.mock("@/lib/individual/policy", () => ({
  loadIndividualPolicy: vi.fn(async () => ({ scholarStudySessions: true })),
  isStudySessionsOn: (p: { scholarStudySessions: boolean }, s: boolean) => p.scholarStudySessions && s,
}));

import { studySessionBlock } from "./study-context";
import { runLearn } from "./generation";
import { CONTEXT_PREAMBLE } from "./learner-context";
import { PROMPT_VERSIONS } from "./config";

const U = "11111111-1111-4111-8111-111111111111";
const S = "22222222-2222-4222-8222-222222222222";
const C = "33333333-3333-4333-8333-333333333333";
const O = "44444444-4444-4444-8444-444444444444";
const ON = { scholarStudySessions: true };
const session = {
  id: S, scopeKind: "topic", title: "Acute kidney injury", topic: "AKI", competencyId: "k1", currentStep: 1, status: "active", createdAt: "", lastActiveAt: "",
  connected: true, lastSpace: "learn", objectiveOutcome: "Explains the stages of acute kidney injury", objectiveText: null,
};

beforeEach(() => {
  for (const f of Object.values(store)) f.mockReset();
  store.studySessionSchema.mockResolvedValue(true);
  store.getConnectedSession.mockResolvedValue(session);
  store.getLearningSession.mockResolvedValue({ ok: true, data: { session, steps: [{ step: 0, sections: [{ chunkId: C, materialId: "m1", materialTitle: "Renal notes", ordinal: 1 }] }, { step: 1, sections: [{ chunkId: C, materialId: "m1", materialTitle: "Renal notes", ordinal: 1 }] }] } });
  store.listStudyLinks.mockResolvedValue([{ kind: "osce_attempt", refId: O, createdAt: "2026-10-31T10:00:00Z" }]);
  store.learningEvents.mockResolvedValue({ ok: true, data: [{ step: 0, action: "clarify", verdict: "not_yet", createdAt: "2026-10-31T09:00:00Z" }] });
  store.topicsOfSections.mockResolvedValue(new Map([[C, ["Staging"]]]));
  store.revisionPool.mockResolvedValue({ ok: true, data: {
    questions: [{ id: "q1", chunkId: C, stem: "Which finding defines the most severe stage?", answer: { rubric: { level: "recall", misconceptions: ["Confusing creatinine with urine output"] } } }],
    stats: new Map([["q1", { misses: 2, latestCorrect: false, lastAnsweredAt: "2026-10-31T08:00:00Z", due: false }]]),
  } });
  store.getOsceAttempt.mockResolvedValue({ id: O, startedAt: "2026-10-31T10:00:00Z", finishedAt: "2026-10-31T10:10:00Z", snapshot: { title: "Fluid assessment" },
    gaps: [{ itemId: "i1", text: "Check capillary refill", critical: true, mark: "missed" }], revisionSuggestions: [{ label: "Learn: Check capillary refill" }] });
});

describe("studySessionBlock: the caller's own connected session only", () => {
  it("builds the block from store reads keyed on the caller", async () => {
    const r = await studySessionBlock({}, U, S, { policy: ON, competencyTitle: id => (id === "k1" ? "Renal assessment" : null) });
    expect(r?.sections).toEqual(["focus", "sources", "misconceptions", "feedback", "progress"]);
    expect(r?.text).toContain("Explains the stages of acute kidney injury");
    expect(r?.text).toContain("Competencies: Renal assessment.");
    expect(r?.text).toContain("Renal notes (sections on Staging)");
    expect(r?.text).toContain("I missed: Staging: Which finding defines the most severe stage?");
    expect(r?.text).toContain("A mistake to avoid: Confusing creatinine with urine output");
    expect(r?.text).toContain("My check was not yet right on: Staging");
    expect(r?.text).toContain("OSCE practice on Fluid assessment: gaps: Check capillary refill (missed, critical)");
    expect(r?.text).toContain("I have done one of two learning steps.");
    for (const f of [store.getConnectedSession, store.getLearningSession, store.listStudyLinks, store.learningEvents]) expect(f).toHaveBeenCalledWith({}, U, S);
    expect(store.revisionPool).toHaveBeenCalledWith({}, U, expect.objectContaining({ chunkIds: [C] }));
    expect(store.getOsceAttempt).toHaveBeenCalledWith({}, U, O);
  });
  it("adds the formative AI feedback kept on the caller's own written answers in the session's sections", async () => {
    store.revisionPool.mockResolvedValue({ ok: true, data: {
      questions: [{ id: "q2", chunkId: C, kind: "short", stem: "Why does oliguria matter?", answer: null }, { id: "q3", chunkId: C, kind: "mcq", stem: "Pick one", answer: null }],
      stats: new Map(),
    } });
    store.recentWrittenFeedback.mockResolvedValue({ ok: true, data: [{ id: "a1", questionId: "q2", answeredAt: "2026-10-31T11:00:00Z",
      formative: { kind: "ai_formative", model: "m", promptVersion: "p", items: [{ part: null, summary: null, parts: { right: [], missing: ["Urine output threshold"], misconceptions: [], why: null, next: "Revise staging" } }] } }] });
    const r = await studySessionBlock({}, U, S, { policy: ON });
    expect(store.recentWrittenFeedback).toHaveBeenCalledWith({}, U, ["q2"]);
    expect(r?.text).toContain('Formative AI feedback on my written answer on Staging to "Why does oliguria matter?": missing Urine output threshold. revise next Revise staging');
  });
  it("null, with nothing else read, for a session that is not the caller's own connected one", async () => {
    store.getConnectedSession.mockResolvedValue(null);
    expect(await studySessionBlock({}, U, S, { policy: ON })).toBeNull();
    expect(store.getLearningSession).not.toHaveBeenCalled();
    expect(store.revisionPool).not.toHaveBeenCalled();
  });
  it("null with the policy off, 740 absent, or no study id; and never throws into the ask", async () => {
    expect(await studySessionBlock({}, U, S, { policy: { scholarStudySessions: false } })).toBeNull();
    store.studySessionSchema.mockResolvedValue(false);
    expect(await studySessionBlock({}, U, S, { policy: ON })).toBeNull();
    expect(await studySessionBlock({}, U, null, { policy: ON })).toBeNull();
    expect(store.getConnectedSession).not.toHaveBeenCalled();
    store.studySessionSchema.mockResolvedValue(true);
    store.getLearningSession.mockRejectedValue(new Error("boom"));
    expect(await studySessionBlock({}, U, S, { policy: ON })).toBeNull();
  });
});

describe("runLearn: the block is emphasis under CONTEXT_PREAMBLE, for an ask only, with its own prompt version", () => {
  const P = { chunkId: C, materialId: "m1", materialTitle: "Renal notes", ordinal: 1, pageFrom: 1, pageTo: 1, content: "Stage three is the most severe stage." };
  const call = async (action: "ask" | "teach", studyContext: string | null) => {
    const seen: { user: string }[] = [];
    const r = await runLearn(U, { action, question: "What is the most severe stage?", passages: [P], references: [], depth: "standard", background: false, history: [], learnerContext: null, studyContext },
      async (req: { user: string }) => { seen.push(req); return { ok: true as const, text: "Stage three is the most severe stage [S1].", model: "m", provider: "p", usage: { input: 0, output: 0 } }; }) as { ok: true; promptVersion: string; check: { ok: boolean } };
    return { r, user: seen[0].user };
  };
  it("an ask with the block: under the preamble, before the passages, never grounding, versioned", async () => {
    const { r, user } = await call("ask", "MY STUDY SESSION: I missed staging.");
    expect(user.startsWith(`${CONTEXT_PREAMBLE}\nMY STUDY SESSION: I missed staging.\n\nPASSAGES FROM MY NOTES:`)).toBe(true);
    expect(r.promptVersion).toBe(`${PROMPT_VERSIONS.learn}:ask+${PROMPT_VERSIONS.studySession}`);
    expect(r.check.ok).toBe(true);
  });
  it("no block, or any other action: the prompt and version exactly as before", async () => {
    const none = await call("ask", null);
    expect(none.user).not.toContain(CONTEXT_PREAMBLE);
    expect(none.r.promptVersion).toBe(`${PROMPT_VERSIONS.learn}:ask`);
    const teach = await call("teach", "MY STUDY SESSION: x");
    expect(teach.user).not.toContain("MY STUDY SESSION");
    expect(teach.r.promptVersion).toBe(`${PROMPT_VERSIONS.learn}:teach+${PROMPT_VERSIONS.learnTeach}`);
  });
});

describe("the wiring, as written", () => {
  const read = (f: string) => readFileSync(f, "utf8").replace(/\r\n/g, "\n");
  it("learn/act builds the block only for an ask on a recorded (caller-owned) session, and passes it as studyContext", () => {
    const s = read("src/app/api/individual/scholar/learn/act/route.ts");
    expect(s).toMatch(/const study = action === "ask" && recorded && sessionId\s*\? await studySessionBlock\(ctx\.admin, ctx\.userId, sessionId, \{ policy,/);
    expect(s).toContain("studyContext: study?.text ?? null,");
    expect(s).toContain("study_context: study ? study.sections : null");
    // the block is built after the preflight, never before it, and is not classified as the request
    expect(s.indexOf("const pre = await aiPreflight(ctx)")).toBeLessThan(s.indexOf("await studySessionBlock("));
    expect(s).not.toMatch(/scholarRisk\([^)]*study/);
  });
  it("the shared assistant reads the block only under the study_session scope, which is authorised but off by default", async () => {
    const pa = await import("@/lib/ai/personal-assistant");
    expect(pa.AUTHORISED_SCOPES.scholar).toContain("study_session");
    expect(pa.AUTHORISED_SCOPES.professional).not.toContain("study_session");
    expect(pa.DEFAULT_PROFILE.scholar.scopes).not.toContain("study_session");
    expect(read("src/lib/individual/personal-ai.ts")).toMatch(/if \(scopes\.includes\("study_session"\) && r\.studySession\)/);
  });
  it("the builder and loader import nothing Professional, employer, passport or own-development", () => {
    for (const f of ["src/lib/individual/scholar/study-session-context.ts", "src/lib/individual/scholar/study-context.ts"]) {
      const imports = read(f).split("\n").filter(l => /^import /.test(l)).join("\n");
      expect(imports).not.toMatch(/professional|own-learning|passport|employer|estate|admin\.from/i);
      expect(read(f)).not.toMatch(/\.from\("/);
    }
  });
});
