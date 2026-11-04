/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from "vitest";

// SCHOLAR-CE-2026 CE-05: the scenario stage route. REVEAL ORDER IS A SERVER RULE: a later stage is sent only in reply to a valid answer to the one
// before it, under a signed token; the key never travels; one attempt is recorded, at the last stage, with every stage as marked. The store and
// the AI are replaced by recorders, so what the browser WOULD have been sent is what is asserted.

const h = vi.hoisted(() => ({
  user: "u1", question: null as any, session: null as any, recorded: [] as any[], snapshots: 0, positions: [] as number[], marking: "self" as string, evals: 0, parts: null as any,
}));

vi.mock("@/lib/individual/guard", () => ({
  requireIndividualContext: async () => ({ admin: {}, userId: h.user, profile: { fullName: "T" }, live: ["scholar"] }),
  isGuardRefusal: () => false,
}));
vi.mock("@/lib/individual/policy", () => ({
  loadIndividualPolicy: async () => ({ scholarShortAnswerMarking: h.marking, scholarSrsMasteryReps: 3, scholarSrsMasteryDays: 21, scholarSrsMaxIntervalDays: 180, scholarSrsHarderIntervalPercent: 20 }),
}));
vi.mock("@/lib/individual/scholar/store", () => ({
  isUuid: (v: unknown) => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v),
  getQuestion: async (_a: unknown, userId: string, id: string) => (h.question && h.question.id === id && userId === h.question.owner ? h.question : null),
  getRevisionSession: async () => ({ ok: true, data: h.session }),
  getPassage: async () => ({ chunkId: "c1", materialId: "m1", materialTitle: "Notes", ordinal: 1, pageFrom: 1, pageTo: 1, content: "Urinary retention raises the risk." }),
  updateRevisionSession: async (_a: unknown, _u: string, _id: string, p: { position?: number }) => { h.positions.push(p.position ?? -1); return true; },
  recordRevisionAttempt: async (_a: unknown, _u: string, _q: unknown, a: unknown) => { h.recorded.push(a); return { ok: true, card: null, attempt: { id: "att1", answeredAt: "2026-11-02T10:00:00Z" } }; },
}));
vi.mock("@/lib/individual/scholar/attempt-integrity", () => ({ keepAttemptSnapshot: async () => { h.snapshots++; return "ok"; } }));
vi.mock("@/lib/individual/scholar/revision-links", () => ({ questionLinks: async () => new Map() }));
vi.mock("@/lib/individual/scholar/ai-standing", () => ({ getScholarAiStanding: async () => ({}), activityState: () => ({ available: true, message: null, insufficient: false }) }));
vi.mock("@/lib/individual/scholar/http", () => ({
  SCHOLAR_AI_AUDIT_ACTION: "ai_assistant_query", aiPreflight: async () => null, audit: async () => {},
  scholarRisk: async () => ({ topicTerms: [] }), scholarAiRunner: () => ({ run: async () => ({}), risk: {}, refusal: () => null }),
}));
vi.mock("@/lib/individual/scholar/outcome", () => ({ answerOutcome: () => ({ outcome: "accepted", reasons: [] }), recordScholarOutcome: async () => {} }));
vi.mock("@/lib/individual/scholar/generation", () => ({
  runEvaluate: async () => { h.evals++; return { ok: true, model: "m", promptVersion: "p", evaluation: { ok: true, verdict: "partly", score: 0.5, feedback: "Partly right: it names the risk.", ...(h.parts ? { parts: h.parts } : {}) } }; },
}));

import { POST } from "./route";
import { parseScenarioRaw, scenarioAnswer, scenarioSpecOf } from "@/lib/individual/scholar/scenario";

const RAW = {
  situation: "Pyelonephritis spreads from the bladder to one or both kidneys.",
  stages: [
    { reveal: "", prompt: "What is the commonest cause?", kind: "mcq", options: ["Escherichia coli", "Fever", "Dysuria", "Antibiotics"], correct: [0], weight: 1, keyPoint: "KEYPOINT-ONE" },
    { reveal: "REVEAL-TWO urine stays in the bladder.", prompt: "PROMPT-TWO what does urinary retention raise?", kind: "short", accepted: ["the risk"], weight: 2, keyPoint: "KEYPOINT-TWO" },
    { reveal: "REVEAL-THREE treatment is needed.", prompt: "PROMPT-THREE which treatment is given?", kind: "mrq", options: ["Antibiotics", "Fluids", "Dysuria", "Fever"], correct: [0, 1], weight: 2, keyPoint: "KEYPOINT-THREE" },
  ],
};
const answer = scenarioAnswer(parseScenarioRaw(RAW)!.stages);
const spec = scenarioSpecOf(answer)!;
const mkQuestion = () => ({
  id: "11111111-1111-4111-8111-111111111111", owner: "u1", materialId: "m1", chunkId: "c1", kind: "short", stem: RAW.situation, options: [], correctIndex: null, rationale: "Because.", sourceQuote: "q",
  model: "m", promptVersion: "v", createdAt: "2026-10-01T00:00:00Z", answer, difficulty: 2, materialTitle: "Notes", ordinal: 1, pageFrom: 1, pageTo: 1, unit: "page", latest: null,
  competencyId: null, caseId: null, caseStep: null, caseTitle: null,
});
const QID = "11111111-1111-4111-8111-111111111111";
const SID = "22222222-2222-4222-8222-222222222222";

const post = async (body: Record<string, unknown>) => {
  const res = await POST(new Request("http://localhost/api/individual/scholar/revision/scenario", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ questionId: QID, ...body }) }));
  const text = await res.text();
  return { status: res.status, text, json: JSON.parse(text) as any };
};
const right = (i: number) => (i === 0 ? { index: spec.stages[0].correct[0] } : i === 2 ? { indexes: spec.stages[2].correct } : { text: "the risk" });

beforeEach(() => {
  h.user = "u1"; h.question = mkQuestion(); h.session = null; h.recorded.length = 0; h.snapshots = 0; h.positions.length = 0; h.marking = "self"; h.evals = 0; h.parts = null;
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key-not-a-real-one"; // gitleaks:allow
});

describe("POST revision/scenario -- the reveal order", () => {
  it("answering stage 1 sends stage 2 and ONLY stage 2: nothing of stage 3, no key, no key point, no accepted answer", async () => {
    const r = await post({ response: right(0) });
    expect(r.status).toBe(200);
    expect(r.json.recorded).toBe(false);
    expect(r.json.next).toMatchObject({ index: 1, kind: "short", weight: 2 });
    expect(r.json.next.reveal).toContain("REVEAL-TWO");
    for (const secret of ["REVEAL-THREE", "PROMPT-THREE", "KEYPOINT", "the risk", "correct", "accepted"]) expect(r.text, secret).not.toContain(secret);
    expect(h.recorded).toHaveLength(0);
  });
  it("stage 3 is sent only in reply to a valid answer to stage 2, under the token stage 1's reply carried", async () => {
    const r0 = await post({ response: right(0) });
    const r1 = await post({ token: r0.json.token, response: right(1) });
    expect(r1.status).toBe(200);
    expect(r1.json.next).toMatchObject({ index: 2, kind: "mrq" });
    expect(r1.json.next.reveal).toContain("REVEAL-THREE");
    expect(r1.text).not.toContain("KEYPOINT");
    expect(h.recorded).toHaveLength(0);
  });
  it("a later stage cannot be asked for: with no token the answer is read as stage 1's, and a stage-shaped wrong answer is refused", async () => {
    const r = await post({ response: { indexes: [0, 1] } }); // stage 3's shape, no token
    expect(r.status).toBe(400);
    expect(r.text).not.toContain("REVEAL-");
    const s = await post({ response: { text: "the risk" } }); // stage 2's shape, no token
    expect(s.status).toBe(400);
    expect(s.text).not.toContain("REVEAL-");
  });
  it("an altered token, another learner's, or one for another scenario reveals nothing and asks for a restart", async () => {
    const r0 = await post({ response: right(0) });
    const [body, sig] = (r0.json.token as string).split(".");
    const c = JSON.parse(Buffer.from(body, "base64url").toString("utf8")); c.n = 2; c.r.push({ s: 1, b: "code", a: "x" });
    const forged = `${Buffer.from(JSON.stringify(c)).toString("base64url")}.${sig}`;
    const f = await post({ token: forged, response: right(2) });
    expect(f.status).toBe(409);
    expect(f.json.restart).toBe(true);
    expect(f.text).not.toContain("REVEAL-THREE");
    h.user = "u2"; h.question.owner = "u2";
    const other = await post({ token: r0.json.token, response: right(1) });
    expect(other.status).toBe(409);
    expect(other.text).not.toContain("REVEAL-");
  });
  it("is refused where the service has no secret to sign with", async () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    expect((await post({ response: right(0) })).status).toBe(503);
  });
  it("a question that is not a scenario is not served here", async () => {
    h.question = { ...mkQuestion(), answer: { accepted: ["x"] } };
    expect((await post({ response: { text: "x" } })).status).toBe(404);
  });
});

describe("POST revision/scenario -- marking, the record and the feedback", () => {
  it("records ONE attempt, at the last stage, with every stage as marked; the feedback shows each stage's key point and the weighted marks", async () => {
    const r0 = await post({ response: right(0) });
    const r1 = await post({ token: r0.json.token, response: right(1) });
    const r2 = await post({ token: r1.json.token, response: right(2) });
    expect(r2.status).toBe(200);
    expect(r2.json.recorded).toBe(true);
    expect(h.recorded).toHaveLength(1);
    expect(h.snapshots).toBe(1);
    const a = h.recorded[0];
    expect(a).toMatchObject({ chosenIndex: null, correct: true, score: 1, marking: "deterministic", evaluator: null });
    expect(a.response.stages.map((s: any) => [s.s, s.by])).toEqual([[1, "code"], [1, "code"], [1, "code"]]);
    expect(a.response.rubric.hash).toMatch(/^[0-9a-f]{16}$/);
    const f = r2.json.feedback;
    expect(f.scenario.stages.map((s: any) => s.keyPoint)).toEqual(["KEYPOINT-ONE", "KEYPOINT-TWO", "KEYPOINT-THREE"]);
    expect(f.scenario.practiceMarks).toMatchObject({ awarded: 5, total: 5 });
    expect(f.markedAgainst).toMatch(/^Marked stage by stage \(3 stages, weighted 1 \/ 2 \/ 2\) against each stage's key, by code \(the guide as saved when you answered, [0-9a-f]{8}\)\.$/);
  });
  it("a heavy stage missed costs more: stage scores are summed with the weights", async () => {
    const r0 = await post({ response: right(0) });
    const r1 = await post({ token: r0.json.token, response: right(1) });
    const wrong = spec.stages[2].options.findIndex((_, i) => !spec.stages[2].correct.includes(i));
    const r2 = await post({ token: r1.json.token, response: { indexes: [wrong] } });
    expect(h.recorded[0]).toMatchObject({ correct: false, score: 0.6 });
    expect(r2.json.feedback.scenario.practiceMarks).toMatchObject({ awarded: 3, total: 5 });
  });
  it("a short stage code cannot mark goes to the learner (policy: self) and the scenario waits for their judgement; the stage is not passed", async () => {
    const r0 = await post({ response: right(0) });
    const r1 = await post({ token: r0.json.token, response: { text: "something else entirely" } });
    expect(r1.status).toBe(200);
    expect(r1.json.needsSelfGrade).toBe(true);
    expect(r1.json.stage).toBe(1);
    expect(r1.json.accepted).toEqual(["the risk"]);
    expect(r1.json.next).toBeUndefined();
    expect(r1.json.token).toBeUndefined();
    expect(r1.text).not.toContain("REVEAL-THREE");
    const r1b = await post({ token: r0.json.token, response: { text: "something else entirely" }, selfGrade: true });
    expect(r1b.json.next).toMatchObject({ index: 2 });
    const r2 = await post({ token: r1b.json.token, response: right(2) });
    expect(h.recorded[0].marking).toBe("self_graded");
    expect(r2.json.feedback.scenario.stages[1].by).toBe("self");
  });
  it("with AI on (ai_then_self) an unmatched short stage is judged by the formative evaluator, once, and the attempt is labelled AI evaluation", async () => {
    h.marking = "ai_then_self";
    const r0 = await post({ response: right(0) });
    const r1 = await post({ token: r0.json.token, response: { text: "it increases chances" } });
    expect(h.evals).toBe(1);
    expect(r1.json.next).toMatchObject({ index: 2 });
    const r2 = await post({ token: r1.json.token, response: right(2) });
    expect(h.evals).toBe(1);
    expect(h.recorded[0]).toMatchObject({ marking: "ai_evaluation", evaluator: { model: "m", promptVersion: "p" } });
    expect(h.recorded[0].response.stages[1]).toMatchObject({ s: 0.5, by: "ai" });
    expect(h.recorded[0].response.formative.items[0].part).toBe(2);
    expect(r2.json.feedback.scenario.stages[1].evaluation.feedback).toContain("Partly right");
    expect(r2.json.feedback.scenario.practiceMarks.awarded).toBe(4);
  });
  it("SQIE WS-D: an AI-judged stage keeps its five-part feedback in the attempt response, carried across stages by the signed token", async () => {
    h.marking = "ai_then_self";
    h.parts = { right: ["names the risk"], missing: ["infection"], misconceptions: [], why: "Retained urine lets bacteria grow.", next: "Name the infection." };
    const r0 = await post({ response: right(0) });
    const r1 = await post({ token: r0.json.token, response: { text: "it increases chances" } });
    expect(r1.text).not.toContain("infection"); // the parts ride inside the signed token, never as readable fields
    await post({ token: r1.json.token, response: right(2) });
    const item = h.recorded[0].response.formative.items[0];
    expect(item).toMatchObject({ part: 2, parts: h.parts, summary: null });
  });
  it("patient identifiers are refused before anything is sent to a model", async () => {
    h.marking = "ai_then_self";
    const r0 = await post({ response: right(0) });
    const r1 = await post({ token: r0.json.token, response: { text: "Seen on ward, NHS number 943 476 5919" } });
    expect(r1.status).toBe(422);
    expect(h.evals).toBe(0);
  });
});

describe("POST revision/scenario -- the session", () => {
  const session = (feedback: "immediate" | "end", attempts: unknown[] = []) => ({ session: { id: SID, feedback, status: "active" }, questionIds: [QID], attempts, held: [] });
  it("is answered in sessions with feedback after each answer", async () => {
    h.session = session("end");
    expect((await post({ sessionId: SID, response: right(0) })).status).toBe(409);
  });
  it("is answered once in a session, and moves its position at the last stage only", async () => {
    h.session = session("immediate", [{ questionId: QID }]);
    expect((await post({ sessionId: SID, response: right(0) })).status).toBe(409);
    h.session = session("immediate");
    const r0 = await post({ sessionId: SID, response: right(0) });
    expect(h.positions).toHaveLength(0);
    const r1 = await post({ sessionId: SID, token: r0.json.token, response: right(1) });
    await post({ sessionId: SID, token: r1.json.token, response: right(2) });
    expect(h.positions).toEqual([1]);
    expect(h.recorded[0].sessionId).toBe(SID);
  });
  it("a question that is not in the session is not served", async () => {
    h.session = { ...session("immediate"), questionIds: ["33333333-3333-4333-8333-333333333333"] };
    expect((await post({ sessionId: SID, response: right(0) })).status).toBe(404);
  });
});
