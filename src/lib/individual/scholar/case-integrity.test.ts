/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Blueprint } from "@/lib/cases/blueprint";
import { blueprintFromDraft } from "./clinical";
import type { Passage } from "./generation";

// SCHOLAR-CASE-INTEGRITY-01 (810): the attempt record, the reason kept beside a choice, resume from server state only,
// the snapshot kept once, and corrections. The store is an in-memory stand-in with the same contract the database
// enforces (one reason per decision, one snapshot per session, append-only corrections). The database side itself is
// proven on staging by VERIFY-810.

const db = vi.hoisted(() => ({
  cases: new Map<string, any>(), sessions: new Map<string, any>(), answers: [] as any[], reasons: [] as any[], snapshots: [] as any[], corrections: [] as any[],
  reasonWorks: true, snapshotProvisioned: true, n: 0,
}));
vi.mock("./store", () => ({
  getPrivateCase: async (_a: any, u: string, id: string) => { const c = db.cases.get(id); return c && c.userId === u ? c : null; },
  getPrivateCaseSession: async (_a: any, u: string, id: string) => {
    const s = db.sessions.get(id);
    if (!s || s.userId !== u) return null;
    return {
      session: JSON.parse(JSON.stringify(s)),
      answers: db.answers.filter(a => a.sid === id).map(a => ({ ...a.row, reason: db.reasons.find(r => r.sid === id && r.dp === a.row.decisionPointId)?.reason ?? null })),
    };
  },
  createPrivateCaseSession: async () => ({ ok: false, notProvisioned: true }),
  insertCaseAnswer: async (_a: any, _u: string, sid: string, a: any) => {
    if (db.answers.some(x => x.sid === sid && x.row.decisionPointId === a.decisionPointId)) return false;
    db.answers.push({ sid, row: { decisionPointId: a.decisionPointId, chosen: a.chosen ?? [], reasoning: a.reasoning, marking: a.marking, correct: a.correct, score: a.score, safety: a.safety, aiFeedback: a.aiFeedback ?? null, evaluatorModel: a.evaluator?.model ?? null, createdAt: new Date(Date.now() + db.n++).toISOString() } });
    return true;
  },
  insertCaseReason: async (_a: any, _u: string, sid: string, dp: string, reason: string) => {
    if (!db.reasonWorks || db.reasons.some(r => r.sid === sid && r.dp === dp)) return false;
    if (!db.answers.some(a => a.sid === sid && a.row.decisionPointId === dp && a.row.chosen.length)) return false;
    db.reasons.push({ sid, dp, reason }); return true;
  },
  updatePrivateCaseSession: async (_a: any, _u: string, id: string, p: any) => {
    const s = db.sessions.get(id);
    if (p.reached) s.reachedStageIds = p.reached;
    if (p.revealed) s.revealedFactIds = p.revealed;
    if (p.current !== undefined) s.currentStageId = p.current;
    if (p.completed) { s.status = "completed"; s.completedAt = "2026-11-01T10:00:00.000Z"; }
    if (p.debrief !== undefined) s.debrief = p.debrief;
    return true;
  },
  insertCaseAttemptSnapshot: async (_a: any, u: string, x: any) => {
    if (!db.snapshotProvisioned) return { ok: false, reason: "not_provisioned" };
    if (db.snapshots.some(s => s.sessionId === x.sessionId)) return { ok: false, reason: "exists" };
    const s = db.sessions.get(x.sessionId); const c = db.cases.get(s?.caseId);
    if (!s || s.userId !== u || s.status !== "completed" || c?.blueprintHash !== x.contentHash) return { ok: false, reason: "refused" };
    const id = `snap-${db.snapshots.length + 1}`;
    db.snapshots.push({ id, kind: x.kind, sessionId: x.sessionId, caseRef: x.caseRef, contentHash: x.contentHash, record: JSON.parse(JSON.stringify(x.record)), rubric: x.rubric, rubricHash: null, standing: "formative", completedAt: s.completedAt, createdAt: "2026-11-01T10:00:01.000Z", userId: u });
    return { ok: true, id };
  },
  getCaseAttemptSnapshot: async (_a: any, u: string, _k: string, sid: string) => {
    if (!db.snapshotProvisioned) return { ok: false, notProvisioned: true };
    const s = db.snapshots.find(x => x.sessionId === sid && x.userId === u);
    return { ok: true, data: s ? { ...s, corrections: db.corrections.filter(c => c.snapshotId === s.id) } : null };
  },
  insertCaseAttemptCorrection: async (_a: any, _u: string, x: any) => {
    const s = db.snapshots.find(y => y.id === x.snapshotId);
    const d = s?.record.decisions.find((y: any) => y.id === x.decisionPointId);
    if (!d) return { ok: false, reason: "not_found" };
    const last = db.corrections.filter(c => c.snapshotId === x.snapshotId && c.decisionPointId === x.decisionPointId).at(-1);
    const prev = last ? last.correctedOutcome : d.correct === null ? "unmarked" : d.correct ? "correct" : (d.score ?? 0) > 0 ? "partial" : "incorrect";
    if (prev === x.correctedOutcome && (last ? last.correctedScore : d.score) === x.correctedScore) return { ok: false, reason: "unchanged" };
    const row = { id: `c${db.corrections.length + 1}`, snapshotId: x.snapshotId, decisionPointId: x.decisionPointId, previousOutcome: prev, previousScore: null, correctedOutcome: x.correctedOutcome, correctedScore: x.correctedScore, reason: x.reason, basis: x.basis, correctedByKind: x.actorId ? "hq_actor" : "system_rule", createdAt: `2026-11-02T00:00:0${db.corrections.length}.000Z` };
    db.corrections.push(row);
    return { ok: true, id: row.id, previousOutcome: prev };
  },
}));

import { answerPrivate, privatePlayView, revealPrivate } from "./clinical-play";
import {
  attemptView, buildCaseAttemptRecord, CASE_AI_FEEDBACK_LABEL, CASE_ATTEMPT_FORMATIVE_LABEL, CASE_ATTEMPT_MAX_BYTES, effectiveDecisions, keepCaseAttemptSnapshot,
  outcomeOf, readCaseAttempt, recordCaseAttemptCorrection,
} from "./case-integrity";

const P = (i: number, content: string): Passage => ({ chunkId: `00000000-0000-4000-8000-00000000000${i}`, materialId: "m", materialTitle: "Notes", ordinal: i, pageFrom: i, pageTo: i, content });
const DRAFT = {
  title: "Breathless on the ward", intro: "A patient on the ward is breathless.",
  stages: ["Recognise the problem", "Decide what to do"],
  facts: [
    { ref: "F1", kind: "observation", label: "Oxygen saturation", value: "low", shown: "request", safetyCritical: true },
    { ref: "F2", kind: "observation", label: "Respiratory rate", value: "monitored", shown: "start" },
  ],
  decisions: [
    { stage: 1, prompt: "What does a low oxygen saturation show?", kind: "single", dimension: "interpretation", canAskFor: ["F1"], sources: ["S2"],
      options: [{ text: "Hypoxaemia", correct: true }, { text: "A target saturation range", correct: false }], rationale: "A low oxygen saturation shows hypoxaemia." },
    { stage: 2, prompt: "Hypoxaemia worsens. What do you do?", kind: "single", dimension: "escalation", sources: ["S2"], safety: "Escalate to the nurse in charge if hypoxaemia worsens.",
      options: [{ text: "Escalate to the nurse in charge", correct: true }, { text: "Monitor the oxygen saturation", correct: false }], rationale: "Escalate if hypoxaemia worsens." },
  ],
};
const U = "11111111-1111-4111-8111-111111111111", CASE = "22222222-2222-4222-8222-222222222222", SID = "33333333-3333-4333-8333-333333333333";
const HASH = "0123456789abcdef0123456789abcdef";
const judge = async () => ({ kind: "self" as const });

function blueprint(): Blueprint {
  const b = blueprintFromDraft(DRAFT, { passages: [P(1, "x"), P(2, "y")], competencies: [] })!;
  b.decisionPoints[0].askReason = true;
  return b;
}
function seed() {
  db.cases.clear(); db.sessions.clear(); db.answers.length = 0; db.reasons.length = 0; db.snapshots.length = 0; db.corrections.length = 0;
  db.reasonWorks = true; db.snapshotProvisioned = true;
  const b = blueprint();
  db.cases.set(CASE, { id: CASE, userId: U, materialId: "m", title: b.title, origin: "notes", context: "general", blueprint: b, blueprintHash: HASH, model: "m", promptVersion: "p", createdAt: "", chunkIds: [], competencyIds: [] });
  db.sessions.set(SID, { id: SID, userId: U, caseId: CASE, mode: "guided", status: "active", viewSalt: "salt-salt-salt-salt-salt-1", currentStageId: "s1", reachedStageIds: ["s1"], revealedFactIds: [], debrief: null, createdAt: "", lastActiveAt: "", completedAt: null });
  return b;
}
const pick = (view: any, stage: number, text: string) => { const d = view.stages[stage].decisionPoints[0]; return { decisionToken: d.token, optionTokens: [d.options.find((o: any) => o.text === text).token] }; };

describe("a private case: the reason for a choice is kept, and the play resumes from the server alone", () => {
  beforeEach(() => { seed(); });

  it("keeps the reason beside the choice (askReason only), and a fresh view on another device restores stage, findings, answers and reasons", async () => {
    let v = (await privatePlayView({}, U, SID))!;
    const ask = v.view.stages[0].decisionPoints[0].canReveal[0].token;
    v = (await revealPrivate({}, U, SID, ask)) as any;
    const r1 = await answerPrivate({}, U, SID, { ...pick(v.view, 0, "Hypoxaemia"), reason: "  The saturation is low, so oxygen is short.  " }, judge);
    expect("error" in r1).toBe(false);
    expect(db.reasons).toEqual([{ sid: SID, dp: "d1", reason: "The saturation is low, so oxygen is short." }]);

    // "another device": nothing but what the server holds
    const resumed = (await privatePlayView({}, U, SID))!;
    expect(resumed.status).toBe("active");
    expect(resumed.view.stages.map(s => s.title)).toEqual(["Recognise the problem", "Decide what to do"]);
    expect(resumed.view.facts.map(f => f.label).sort()).toEqual(["Oxygen saturation", "Respiratory rate"]);
    const d1 = resumed.view.stages[0].decisionPoints[0].token;
    expect(resumed.answered).toEqual([d1]);
    expect(resumed.reasons).toEqual({ [d1]: "The saturation is low, so oxygen is short." });
    expect(resumed.feedback[0].correct).toBe(true);

    // a decision that does not ask for a reason keeps none, even if one is sent
    const r2 = await answerPrivate({}, U, SID, { ...pick(resumed.view, 1, "Monitor the oxygen saturation"), reason: "not asked" }, judge);
    expect("error" in r2 && r2.error).toBe(false);
    expect(db.reasons).toHaveLength(1);
  });

  it("where the reason cannot be kept (810 absent), the answer still stands with no error", async () => {
    db.reasonWorks = false;
    const v = (await privatePlayView({}, U, SID))!;
    const r = await answerPrivate({}, U, SID, { ...pick(v.view, 0, "Hypoxaemia"), reason: "Because." }, judge);
    expect("error" in r).toBe(false);
    expect(db.answers).toHaveLength(1);
    expect((r as any).play.reasons).toEqual({});
  });

  it("keeps the completed attempt exactly once, reads it back on the finished play, and refuses before completion", async () => {
    expect(await keepCaseAttemptSnapshot({}, U, "private", SID)).toBe("not_completed");
    let v = (await privatePlayView({}, U, SID))!;
    await answerPrivate({}, U, SID, { ...pick(v.view, 0, "Hypoxaemia"), reason: "Low saturation." }, judge);
    v = (await privatePlayView({}, U, SID))!;
    await answerPrivate({}, U, SID, pick(v.view, 1, "Monitor the oxygen saturation"), judge);
    expect(await keepCaseAttemptSnapshot({}, U, "private", SID)).toBe("kept");
    expect(await keepCaseAttemptSnapshot({}, U, "private", SID)).toBe("exists");
    expect(db.snapshots).toHaveLength(1);
    const s = db.snapshots[0];
    expect(s.caseRef).toBe(`own:${CASE}`);
    expect(s.contentHash).toBe(HASH);
    expect(s.record.decisions.map((d: any) => [d.id, d.correct, d.reason, d.marking])).toEqual([["d1", true, "Low saturation.", "deterministic"], ["d2", false, null, "deterministic"]]);
    expect(s.record.decisions[1].safety).toEqual(["c1"]);
    expect(s.record.debrief.safetyEvents).toEqual(["Escalate to the nurse in charge if hypoxaemia worsens."]);

    const done = (await privatePlayView({}, U, SID))!;
    expect(done.status).toBe("completed");
    expect(done.attempt).toMatchObject({ changed: false, corrected: [], completedAt: "2026-11-01T10:00:00.000Z", label: CASE_ATTEMPT_FORMATIVE_LABEL });
    expect(done.debrief?.answered).toBe(2);
  });

  it("a finished attempt with no record (finished before 810, or a failed write) is kept when it is next opened", async () => {
    let v = (await privatePlayView({}, U, SID))!;
    await answerPrivate({}, U, SID, pick(v.view, 0, "Hypoxaemia"), judge);
    v = (await privatePlayView({}, U, SID))!;
    await answerPrivate({}, U, SID, pick(v.view, 1, "Escalate to the nurse in charge"), judge);
    expect(db.snapshots).toHaveLength(0);
    const a = await readCaseAttempt({}, U, "private", SID, { contentHash: HASH, current: true });
    expect(a?.view.changed).toBe(false);
    expect(db.snapshots).toHaveLength(1);
    db.snapshotProvisioned = false;
    expect(await readCaseAttempt({}, U, "private", SID)).toBeNull();
  });
});

describe("the attempt record builder", () => {
  const b = blueprint();
  const base = {
    kind: "library" as const, blueprint: b, mode: null, variation: { f1: "88%" }, reached: ["s1", "s2"], revealed: ["f1"],
    answers: [
      { decisionPointId: "d1", chosen: ["d1a"], text: null, reason: "Low.", marking: "deterministic", correct: true, score: 1, safety: [], aiFeedback: null, at: "t1" },
      { decisionPointId: "d2", chosen: ["d2b"], text: null, reason: null, marking: "deterministic", correct: false, score: 0, safety: ["c1"], aiFeedback: { text: "Think about escalation.", model: "m1" }, at: "t2" },
    ],
    aiDebrief: { text: "Overall reasonable.", model: "m1" },
  };
  it("holds the case as played: stages, findings, decisions with the option text, rubric excerpt, debrief, formative labels", () => {
    const { record, rubric } = buildCaseAttemptRecord(base);
    expect(record.stagesReached.map(s => s.title)).toEqual(["Recognise the problem", "Decide what to do"]);
    expect(record.factsShown.sort()).toEqual(["f1", "f2"]);
    expect(record.factsRequested).toEqual(["f1"]);
    expect(record.variation).toEqual({ f1: "88%" });
    expect(record.decisions[0]).toMatchObject({ id: "d1", prompt: "What does a low oxygen saturation show?", chosenText: ["Hypoxaemia"], reason: "Low.", dimension: "interpretation" });
    expect(record.decisions[1].aiFeedback).toEqual({ label: CASE_AI_FEEDBACK_LABEL, text: "Think about escalation.", model: "m1" });
    expect(record.aiDebrief?.label).toBe(CASE_AI_FEEDBACK_LABEL);
    expect(record.completion).toEqual({ state: "completed", answered: 2, of: 2 });
    expect(record.label).toBe(CASE_ATTEMPT_FORMATIVE_LABEL);
    expect(record.debrief).not.toHaveProperty("objectives");
    expect(rubric.decisions.map(d => [d.id, d.key])).toEqual([["d1", ["d1a"]], ["d2", ["d2a"]]]);
    expect(rubric.safetyCriteria.map(c => c.decisionPointId)).toEqual(["d2"]);
  });
  it("keeps only the answered decisions' rubric", () => {
    const { record, rubric } = buildCaseAttemptRecord({ ...base, answers: base.answers.slice(0, 1) });
    expect(record.decisions.map(d => d.id)).toEqual(["d1"]);
    expect(rubric.decisions.map(d => d.id)).toEqual(["d1"]);
    expect(rubric.safetyCriteria).toEqual([]);
  });
  it("stays inside the database bound by cutting long texts, never by dropping a decision", () => {
    const big = { ...base, answers: base.answers.map(a => ({ ...a, reason: "r".repeat(1500), aiFeedback: { text: "x".repeat(200000), model: "m" } })) };
    const { record, rubric } = buildCaseAttemptRecord(big);
    expect(record.decisions).toHaveLength(2);
    expect(Buffer.byteLength(JSON.stringify(record)) + Buffer.byteLength(JSON.stringify(rubric))).toBeLessThanOrEqual(CASE_ATTEMPT_MAX_BYTES);
  });
});

describe("corrections: the effective result, the original beside it", () => {
  const rec = { decisions: [{ id: "d1", prompt: "P1", correct: false, score: 0.5 }, { id: "d2", prompt: "P2", correct: null, score: null }] } as any;
  const c = (id: string, dp: string, from: string, to: string, score: number | null, at: string) => ({ id, decisionPointId: dp, previousOutcome: from, previousScore: null, correctedOutcome: to, correctedScore: score, reason: "Reviewed against the key.", basis: "key_error", correctedByKind: "system_rule", createdAt: at });
  it("outcomeOf reads a result the way the 810 guard does", () => {
    expect([outcomeOf(true, 1), outcomeOf(false, 0.5), outcomeOf(false, 0), outcomeOf(null, null)]).toEqual(["correct", "partial", "incorrect", "unmarked"]);
  });
  it("is the latest correction, else the attempt as kept", () => {
    const e = effectiveDecisions(rec, [c("b", "d1", "correct", "incorrect", 0, "2026-11-02T00:00:02Z"), c("a", "d1", "partial", "correct", 1, "2026-11-02T00:00:01Z")]);
    expect(e[0]).toMatchObject({ original: { outcome: "partial", score: 0.5 }, effective: { outcome: "incorrect", score: 0 } });
    expect(e[0].corrections.map(x => x.to)).toEqual(["correct", "incorrect"]);
    expect(e[1]).toMatchObject({ original: { outcome: "unmarked" }, effective: { outcome: "unmarked" }, corrections: [] });
  });
  it("the view says when the case changed since, and lists only corrected decisions", () => {
    const s = { contentHash: HASH, record: rec, corrections: [c("a", "d2", "unmarked", "correct", 1, "t")], createdAt: "k", completedAt: "d" } as any;
    expect(attemptView(s, { contentHash: HASH, current: true }).changed).toBe(false);
    expect(attemptView(s, { contentHash: "f".repeat(32), current: true }).changed).toBe(true);
    expect(attemptView(s, { contentHash: HASH, current: false }).changed).toBe(true);
    expect(attemptView(s, { contentHash: HASH, current: true }).corrected).toEqual([{ id: "d2", prompt: "P2", original: "unmarked", effective: "correct", corrections: [expect.objectContaining({ to: "correct" })] }]);
  });

  it("recordCaseAttemptCorrection: validated, appended, a no-op refused, one codes-only audit row", async () => {
    seed();
    let v = (await privatePlayView({}, U, SID))!;
    await answerPrivate({}, U, SID, pick(v.view, 0, "Hypoxaemia"), judge);
    v = (await privatePlayView({}, U, SID))!;
    await answerPrivate({}, U, SID, pick(v.view, 1, "Monitor the oxygen saturation"), judge);
    await keepCaseAttemptSnapshot({}, U, "private", SID);
    const audits: any[] = [];
    const admin = { from: (t: string) => ({ insert: (row: any) => { audits.push({ t, row }); return Promise.resolve({ error: null }); } }) };
    const args = { learnerId: U, kind: "private" as const, sessionId: SID, decisionPointId: "d2", correctedOutcome: "correct" as const, correctedScore: 1, reason: "The key named the wrong option.", basis: "key_error" as const, actor: { id: "44444444-4444-4444-8444-444444444444", name: "Reviewer" } };
    expect(await recordCaseAttemptCorrection(admin, { ...args, reason: "short" })).toEqual({ ok: false, error: "invalid" });
    expect(await recordCaseAttemptCorrection(admin, { ...args, decisionPointId: "d9" })).toEqual({ ok: false, error: "not_found" });
    expect(await recordCaseAttemptCorrection(admin, args)).toMatchObject({ ok: true, previousOutcome: "incorrect" });
    expect(await recordCaseAttemptCorrection(admin, args)).toEqual({ ok: false, error: "unchanged" });
    expect(db.snapshots[0].record.decisions[1].correct).toBe(false);           // the original is never rewritten
    expect(audits).toHaveLength(1);
    expect(audits[0].row.new_value).toEqual({ kind: "private", decision: "d2", basis: "key_error", from: "incorrect", to: "correct", by: "hq_actor" });
    expect(JSON.stringify(audits[0].row)).not.toContain("wrong option");
    const done = (await privatePlayView({}, U, SID))!;
    expect(done.attempt?.corrected).toEqual([expect.objectContaining({ id: "d2", original: "incorrect", effective: "correct" })]);
  });
});
