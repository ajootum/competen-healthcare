/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CE04_DEMO } from "@/lib/cases/fixtures";
import { composeHandover } from "@/lib/cases/handover";

// SCHOLAR-CE-2026 CE-04: the server side of "Talk to the patient" with the store, the policy, the AI standing and the AI
// runner stood in for. What is proved here: the AI is asked ONLY with the grounded prompt, a refusal or an unavailable
// AI is a plain reason and never a made-up reply, the per-stage cap stops the AI being called, a reply that would voice
// something the persona may not know is replaced and kept as screened, and every turn is kept.

const st = vi.hoisted(() => ({
  policy: { scholarCaseConversation: "on", scholarCaseConversationTurns: 3, scholarCaseReasoningFeedback: "ai_then_self" } as any,
  aiAvailable: true, preflight: null as any, entries: [] as any[], provisioned: true, calls: [] as any[], reply: "I have had a dry cough for two days." as string, refusal: null as string | null,
  session: { status: "active", reached: ["s1"], revealed: [] as string[] }, insertFails: false,
}));
vi.mock("../policy", () => ({ loadIndividualPolicy: async () => st.policy }));
vi.mock("./ai-standing", () => ({ getScholarAiStanding: async () => ({}), activityState: () => (st.aiAvailable ? { available: true, message: null, insufficient: false } : { available: false, message: "AI help is off for you right now.", insufficient: false }) }));
vi.mock("./extract", () => ({ findPatientIdentifiers: (t: string) => (/\b07\d{9}\b/.test(t) ? ["phone"] : []) }));
vi.mock("./clinical", () => ({ markHandoverAnswer: () => ({ correct: true, score: 1 }) }));
vi.mock("./http", () => ({
  SCHOLAR_AI_AUDIT_ACTION: "ai_assistant_query",
  aiPreflight: async () => st.preflight,
  audit: async () => {},
  refusalWords: (r: any) => ({ message: `refused ${r.error}`, insufficient: false }),
  scholarRisk: async () => ({}),
  scholarRequestId: () => "req-1",
  scholarOwnedRunner: () => { throw new Error("library path not used here"); },
  scholarAiRunner: (_c: any, _r: any, activity: string, _risk: any, callKey: string) => ({
    run: async (g: any) => { st.calls.push({ activity, callKey, system: g.system, user: g.user, tier: g.tier, maxTokens: g.maxTokens }); return st.refusal ? { ok: false, error: "failed" } : { ok: true, text: st.reply, model: "m-test", provider: "p" }; },
    refusal: () => (st.refusal ? { error: st.refusal } : null), risk: {},
  }),
}));
vi.mock("./store", () => ({
  getPrivateCase: async () => ({ id: "c1", title: "Demo", blueprint: CE04_DEMO, competencyIds: [] }),
  getPrivateCaseSession: async () => ({ session: { caseId: "c1", status: st.session.status, reachedStageIds: st.session.reached, revealedFactIds: st.session.revealed, viewSalt: "salt-salt-salt-salt-salt-1" }, answers: [] }),
  listCaseConversation: async () => (st.provisioned ? { ok: true, data: st.entries } : { ok: false, notProvisioned: true }),
  insertCaseConversation: async (_a: any, _u: string, i: any) => {
    if (st.insertFails) return { ok: false, reason: "refused" };
    st.entries.push({ id: `e${st.entries.length}`, kind: i.entry, seq: st.entries.length + 1, stageId: i.stageId ?? null, decisionPointId: i.decisionPointId ?? null, question: i.question ?? null, reply: i.reply, screened: i.screened === true, model: i.model ?? null, createdAt: "t" });
    return { ok: true };
  },
}));
vi.mock("@/lib/cases/library", () => ({ caseSessionRecord: () => ({}), sessionAttemptSource: async () => null }));
vi.mock("@/lib/ai/consumption", () => ({ resolveOwner: async () => ({}) }));

import { askPatient, communicationNote, handoverFeedbackNote, loadTalkSource, talkState } from "./case-talk";

const ctx: any = { admin: {}, userId: "u1", profile: { fullName: "T" } };
const req = new Request("http://x/");
const src = async () => (await loadTalkSource({}, "u1", "private", "11111111-1111-1111-1111-111111111111"))!;

beforeEach(() => {
  st.policy = { scholarCaseConversation: "on", scholarCaseConversationTurns: 3, scholarCaseReasoningFeedback: "ai_then_self" };
  st.aiAvailable = true; st.preflight = null; st.entries = []; st.provisioned = true; st.calls = []; st.refusal = null; st.insertFails = false;
  st.reply = "I have had a dry cough for two days."; st.session = { status: "active", reached: ["s1"], revealed: [] };
});

describe("asking the patient", () => {
  it("asks the AI once, on the case-feedback path (evaluate, reasoning tier), with ONLY the grounded prompt, and keeps the turn", async () => {
    const r = await askPatient(ctx, req, await src(), "Do you have a cough?");
    expect(r).toMatchObject({ ok: true, turn: { stageId: "s1", question: "Do you have a cough?", reply: "I have had a dry cough for two days.", screened: false }, stage: { used: 1, cap: 3, left: 2, full: false } });
    expect(st.calls).toHaveLength(1);
    expect(st.calls[0]).toMatchObject({ activity: "evaluate", tier: "reasoning", maxTokens: 220, callKey: "t1" });
    const sent = `${st.calls[0].system}\n${st.calls[0].user}`;
    for (const never of ["No chest pain", "very tired now", "Chest infection", "Airway and breathing", "e_urgent", "Drowsy, opens eyes"]) expect(sent, never).not.toContain(never);
    expect(sent).toContain("A dry cough for two days");
    expect(st.entries).toHaveLength(1);
    expect(st.entries[0]).toMatchObject({ kind: "turn", stageId: "s1", model: "m-test", screened: false });
  });
  it("a later stage's knowledge reaches the prompt only once that stage is reached", async () => {
    st.session = { status: "active", reached: ["s1", "s2"], revealed: [] };
    await askPatient(ctx, req, await src(), "How do you feel now?");
    expect(`${st.calls[0].system}`).toContain("very tired now");
    expect(st.entries[0].stageId).toBe("s2");
  });
  it("stops at the per-stage cap without calling the AI, and the cap counts the current stage only", async () => {
    for (let i = 0; i < 3; i++) expect((await askPatient(ctx, req, await src(), `Question ${i} here`)).ok).toBe(true);
    expect(st.calls).toHaveLength(3);
    const r = await askPatient(ctx, req, await src(), "One more question");
    expect(r).toMatchObject({ ok: false, status: 200 });
    expect((r as any).error).toMatch(/used your 3 questions/);
    expect(st.calls).toHaveLength(3);
    st.session = { status: "active", reached: ["s1", "s2"], revealed: [] };
    expect((await askPatient(ctx, req, await src(), "How are you now?")).ok).toBe(true);
  });
  it("is a plain 'unavailable' with the reason when the switch is off, the AI is off, or the allowance refuses, and never makes up a reply", async () => {
    st.policy.scholarCaseConversation = "off";
    expect(await askPatient(ctx, req, await src(), "Hello there")).toMatchObject({ ok: false, unavailable: true, error: expect.stringMatching(/not switched on/) });
    st.policy.scholarCaseConversation = "on"; st.aiAvailable = false;
    expect(await askPatient(ctx, req, await src(), "Hello there")).toMatchObject({ ok: false, unavailable: true, error: "AI help is off for you right now." });
    st.aiAvailable = true; st.refusal = "no_allowance";
    expect(await askPatient(ctx, req, await src(), "Hello there")).toMatchObject({ ok: false, unavailable: true, error: "refused no_allowance" });
    expect(st.entries).toHaveLength(0);
  });
  it("880 absent: unavailable with the reason, and no AI call is made", async () => {
    st.provisioned = false;
    const r = await askPatient(ctx, req, await src(), "Hello there");
    expect(r).toMatchObject({ ok: false, unavailable: true });
    expect((r as any).error).toMatch(/has not been installed/);
    expect(st.calls).toHaveLength(0);
  });
  it("replaces a reply that would voice a finding the persona may not know, and keeps it marked as screened", async () => {
    st.reply = "My saturation is 88 % on room air.";
    const r = await askPatient(ctx, req, await src(), "What is your saturation?");
    expect(r).toMatchObject({ ok: true, turn: { reply: "I'm sorry, I don't know. Nobody has told me.", screened: true } });
    expect(st.entries[0]).toMatchObject({ screened: true });
  });
  it("refuses a finished case, a patient identifier and an empty or over-long question before any AI call", async () => {
    st.session = { status: "completed", reached: ["s1", "s2"], revealed: [] };
    expect(await askPatient(ctx, req, await src(), "Hello")).toMatchObject({ ok: false, status: 409 });
    st.session = { status: "active", reached: ["s1"], revealed: [] };
    expect(await askPatient(ctx, req, await src(), "My number is 07123456789")).toMatchObject({ ok: false, status: 422 });
    expect(await askPatient(ctx, req, await src(), " ")).toMatchObject({ ok: false, status: 400 });
    expect(await askPatient(ctx, req, await src(), "x".repeat(401))).toMatchObject({ ok: false, status: 400 });
    expect(st.calls).toHaveLength(0);
  });
  it("a turn that cannot be kept is not shown", async () => {
    st.insertFails = true;
    expect(await askPatient(ctx, req, await src(), "Do you have a cough?")).toMatchObject({ ok: false, unavailable: true });
  });
  it("a case with no voice has no conversation at all", async () => {
    const orig = CE04_DEMO.aiBoundary.patientVoice;
    CE04_DEMO.aiBoundary.patientVoice = false;
    try { expect(await askPatient(ctx, req, await src(), "Hello")).toMatchObject({ ok: false, status: 404 }); } finally { CE04_DEMO.aiBoundary.patientVoice = orig; }
  });
});

describe("the state, the communication note and the handover note", () => {
  it("the state shows the cap, and after the case the key-question review by code", async () => {
    await askPatient(ctx, req, await src(), "When did it start?");
    const s = await talkState(ctx, await src());
    expect(s).toMatchObject({ unavailable: null, stage: { used: 1, left: 2 }, debrief: null });
    st.session = { status: "completed", reached: ["s1", "s2"], revealed: [] };
    const done = await talkState(ctx, await src());
    expect((done as any).debrief.asked.map((q: any) => q.id)).toEqual(["q_onset"]);
    expect((done as any).debrief.missed.map((q: any) => q.id).sort()).toEqual(["q_cough", "q_pain"]);
    expect((done as any).debrief.note).toBeNull();
  });
  it("the note comes once, after the case, and the second request does not call the AI again", async () => {
    await askPatient(ctx, req, await src(), "When did it start?");
    expect(await communicationNote(ctx, req, await src())).toMatchObject({ status: 409 });
    st.session = { status: "completed", reached: ["s1", "s2"], revealed: [] };
    st.calls = []; st.reply = "You asked when it started, which was good. You did not ask about pain or a cough, so try those next.";
    const a = await communicationNote(ctx, req, await src());
    expect((a as any).debrief.note.text).toMatch(/You asked when it started/);
    expect(st.calls).toHaveLength(1);
    expect(st.calls[0].system).toMatch(/formative feedback/);
    await communicationNote(ctx, req, await src());
    expect(st.calls).toHaveLength(1);
    expect(st.entries.filter(e => e.kind === "communication_note")).toHaveLength(1);
  });
  it("a handover gets an AI comment only when policy and the AI allow, never changes the marks, and is kept beside the answer", async () => {
    const text = composeHandover({ situation: "He is more breathless now.", background: "Admitted two days ago.", assessment: "Rate 34, drowsy.", recommendation: "Please review urgently." });
    st.session = { status: "active", reached: ["s1", "s2"], revealed: [] };
    st.reply = "Clear and ordered. You could add the oxygen saturation and what support he needs.";
    const token = (await import("@/lib/cases/blueprint")).viewToken("salt-salt-salt-salt-salt-1", "decision", "d2");
    const n = await handoverFeedbackNote(ctx, req, "private", "11111111-1111-1111-1111-111111111111", token, text);
    expect(n).toMatchObject({ text: expect.stringMatching(/Clear and ordered/) });
    expect(st.entries.at(-1)).toMatchObject({ kind: "handover_note", decisionPointId: "d2" });
    expect(st.calls.at(-1).user).toContain("POINTS A GOOD HANDOVER MENTIONS");
    st.policy.scholarCaseReasoningFeedback = "self";
    expect(await handoverFeedbackNote(ctx, req, "private", "11111111-1111-1111-1111-111111111111", token, text)).toBeNull();
    st.policy.scholarCaseReasoningFeedback = "ai_then_self"; st.aiAvailable = false;
    expect(await handoverFeedbackNote(ctx, req, "private", "11111111-1111-1111-1111-111111111111", token, text)).toBeNull();
    // a decision that is not a handover gets nothing
    st.aiAvailable = true;
    const other = (await import("@/lib/cases/blueprint")).viewToken("salt-salt-salt-salt-salt-1", "decision", "d1");
    expect(await handoverFeedbackNote(ctx, req, "private", "11111111-1111-1111-1111-111111111111", other, text)).toBeNull();
  });
});
