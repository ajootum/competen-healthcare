import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MasteryEntry } from "./mastery";

// loadToday / loadProposal / loadInsights over the real event and entry stores (an in-memory client) and stubbed Scholar reads.

const h = vi.hoisted(() => ({
  A: "aaaaaaaa-0000-4000-8000-00000000000a", MAT: "aaaaaaaa-0000-4000-8000-0000000000a1", MAT2: "aaaaaaaa-0000-4000-8000-0000000000a2",
  plan: null as Record<string, unknown> | null, topics: [] as unknown[], due: 0,
  sections: [] as { chunkId: string; materialId: string; ordinal: number }[], topicOf: new Map<string, string[]>(),
}));
vi.mock("./store", () => ({
  studyPlanSchema: async () => true, calendarSchema: async () => false,
  getStudyPlan: async () => ({ ok: true, data: h.plan }),
  listMaterials: async () => ({ ok: true, data: [{ id: h.MAT, title: "Renal notes", chunkCount: 3 }, { id: h.MAT2, title: "Medicine notes", chunkCount: 2 }] }),
  competencyProgressRows: async () => ({ ok: true, data: { mappings: [], concepts: new Map(), questions: [], attempts: [] } }),
  countDue: async () => h.due,
  sectionsOf: async (_a: unknown, _u: string, ids: string[]) => ({ ok: true, data: h.sections.filter(s => ids.includes(s.materialId)) }),
  topicsOfSections: async () => h.topicOf,
  listLearningSessions: async () => ({ ok: true, data: [] }), listRevisionSessions: async () => ({ ok: true, data: [] }),
  getEvaluation: async () => ({ ok: true, data: null }),
  evaluationEvidence: async () => ({ ok: true, data: { attempts: [{ marking: "deterministic", correct: true, answeredAt: "2026-11-01T10:00:00Z" }], reviews: [], checks: [], decisions: [] } }),
  learningEventTimes: async () => ({ ok: true, data: [] }), caseDecisionTimes: async () => ({ ok: true, data: [] }),
}));
vi.mock("./mastery-data", () => ({ loadMastery: async () => ({ ok: true, data: { topics: h.topics, competencies: [], studyNext: [] } }) }));
vi.mock("./competency-view", () => ({ loadLearnerCatalogue: async () => ({ provisioned: false, programme: null, competencies: null }) }));
vi.mock("./monthly-review-data", () => ({ loadMonthlyOverview: async () => null, listMonthlyReviews: async () => [], monthlyReviewOn: () => false }));

import { fakeAdmin } from "../learning-plan/fake-admin";
import { appendPlanEvent, resetLearningPlanSchema } from "../learning-plan/event-store";
import { createEntry, resetLearnerCalendarSchema } from "../learning-plan/entry-store";
import { resolvePolicy } from "../policy";
import { loadInsights, loadProposal, loadToday } from "./plan-data";
import { refKey } from "./study-plan";

const { A, MAT, MAT2 } = h;
const NOW = new Date("2026-11-02T09:00:00Z");
const O = { now: NOW, tz: "UTC", today: "2026-11-02" };
const policy = { ...resolvePolicy([]), scholarStudyPlan: true };
let admin: ReturnType<typeof fakeAdmin>;
const ctx = () => ({ admin, userId: A });
const entry = (label: string, status: MasteryEntry["status"], o: Partial<MasteryEntry> = {}): MasteryEntry => ({
  kind: "topic", key: label.toLowerCase(), label, materialId: MAT, chunkId: null, topicSource: "topic", status, attempts: 6, recentAccuracy: status === "needs_work" ? 40 : 90,
  byLevel: [], highestLevel: null, byMarking: { code: 0, ai_evaluation: 0, self: 0 }, weakConcepts: [], last: { n: 0, wrong: 0 }, lastAt: null, basis: "", ...o,
});
const appliedEvents = () => (admin.tables.individual_learning_plan_event ?? []).filter(e => e.kind === "auto_adjust");

beforeEach(() => {
  admin = fakeAdmin({}, { individual_learning_calendar_entry: { status: "planned" } });
  resetLearningPlanSchema(); resetLearnerCalendarSchema();
  h.plan = { examDate: null, examLabel: null, weeklyMinutes: 150, daysPerWeek: 7, goal: null, priorities: [], goalType: "learn", sessionMinutes: 30 };
  h.topics = [entry("Renal", "needs_work")]; h.due = 0; h.sections = []; h.topicOf = new Map();
});

describe("loadToday", () => {
  it("is off without the policy, and says so rather than drawing an empty plan", async () => {
    expect(await loadToday(ctx(), { ...policy, scholarMyPlan: "off" }, O)).toEqual({ ok: false, reason: "off" });
    expect(await loadToday(ctx(), { ...policy, scholarStudyPlan: false }, O)).toEqual({ ok: false, reason: "off" });
  });
  it("gives one next activity with why / why now / if postponed, two alternatives, and the cards due", async () => {
    h.due = 5;
    const v = await loadToday(ctx(), policy, O);
    if (!v.ok) throw new Error("setup");
    expect(v.next?.rule).toBe("due_revision");
    expect(v.next!.why).toMatch(/5 cards/);
    expect(v.alternatives.length).toBeGreaterThan(0);
    expect(v.dueCards).toBe(5);
    expect(v.hasPlan).toBe(true);
    expect(v.week?.thisWeek.length).toBeGreaterThan(0);
  });
  it("records ONE carry-over event the first time it is shown (idempotent), with an undo token in the notes", async () => {
    const first = await loadToday(ctx(), policy, O);
    if (!first.ok) throw new Error("setup");
    const key = `learn:${refKey("renal")}@2026-11-01`;
    const note = first.notes.find(n => n.undo?.ref === key);
    expect(note).toBeTruthy();
    expect(note!.undo).toEqual({ kind: "auto_adjust", ref: key });
    expect(appliedEvents()).toHaveLength(1);
    expect(appliedEvents()[0]).toMatchObject({ ref: key, status: "applied", user_id: A, experience: "scholar", value: { from: "2026-11-01", activityRef: `learn:${refKey("renal")}` } });
    await loadToday(ctx(), policy, O);
    await loadToday(ctx(), policy, O);
    expect(appliedEvents()).toHaveLength(1);
    expect(first.week?.thisWeek.flatMap(d => d.activities).some(a => a.title === "Learn Renal")).toBe(true);
  });
  it("after an undo the activity is not carried: it is left out of the plan and shown as Missed, with no undo note", async () => {
    await loadToday(ctx(), policy, O);
    const key = `learn:${refKey("renal")}@2026-11-01`;
    await appendPlanEvent(admin, A, "scholar", { kind: "auto_adjust", ref: key, status: "undone", value: {} });
    const v = await loadToday(ctx(), policy, O);
    if (!v.ok) throw new Error("setup");
    expect(v.missed.map(m => m.key)).toEqual([key]);
    expect(v.notes.some(n => n.undo)).toBe(false);
    expect(v.notes.some(n => /Missed, not rescheduled/.test(n.text))).toBe(true);
    expect(v.week?.thisWeek.flatMap(d => d.activities).some(a => a.title === "Learn Renal")).toBe(false);
    expect(appliedEvents().filter(e => e.status === "applied")).toHaveLength(1);   // nothing new was written
  });
  it("without migration 840 there are no carry-over notices and no event is written; the plan recomputes as before", async () => {
    resetLearningPlanSchema(false);
    h.plan = { ...h.plan!, goalType: null, sessionMinutes: null };
    const v = await loadToday(ctx(), policy, O);
    if (!v.ok) throw new Error("setup");
    expect(v.features).toMatchObject({ decisions: false, settingsExtras: false });
    expect(v.notes.some(n => n.undo)).toBe(false);
    expect(v.reflection.enabled).toBe(false);
    expect(admin.tables.individual_learning_plan_event ?? []).toHaveLength(0);
    expect(v.week?.thisWeek.flatMap(d => d.activities).some(a => a.title === "Learn Renal")).toBe(true);
  });
  it("a declined suggestion is not offered again until its evidence changes, and a postponed topic is left out", async () => {
    h.due = 3;
    const first = await loadToday(ctx(), policy, O);
    if (!first.ok) throw new Error("setup");
    await appendPlanEvent(admin, A, "scholar", { kind: "recommendation_declined", ref: first.next!.ref, status: "declined", value: { fingerprint: first.next!.fingerprint } });
    const second = await loadToday(ctx(), policy, O);
    if (!second.ok) throw new Error("setup");
    expect(second.next?.ref).not.toBe(first.next!.ref);
    expect(second.declinedHidden).toBe(1);
    h.due = 4;
    const third = await loadToday(ctx(), policy, O);
    expect(third.ok && third.next?.ref).toBe(first.next!.ref);
    await appendPlanEvent(admin, A, "scholar", { kind: "topic_postponed", ref: "renal", status: "deferred", value: { until: "2026-11-05", label: "Renal" } });
    const fourth = await loadToday(ctx(), policy, O);
    if (!fourth.ok) throw new Error("setup");
    expect([fourth.next, ...fourth.alternatives].some(r => r?.title.includes("Renal"))).toBe(false);
    expect(fourth.week?.thisWeek.flatMap(d => d.activities).some(a => /Renal/.test(a.title))).toBe(false);
  });
  it("with no saved plan it still answers (hasPlan false) from the learner's own evidence", async () => {
    h.plan = null; h.due = 2;
    const v = await loadToday(ctx(), policy, O);
    if (!v.ok) throw new Error("setup");
    expect(v.hasPlan).toBe(false);
    expect(v.week).toBeNull();
    expect(v.next?.rule).toBe("due_revision");
  });
  it("an all-day busy day in the learner's calendar says nothing is planned today; a deadline becomes a candidate", async () => {
    await createEntry(admin, A, "scholar", { entryType: "busy", title: "Away", description: null, entryDate: "2026-11-02", startTime: null, endTime: null, durationMinutes: null, link: null, recurrence: null });
    await createEntry(admin, A, "scholar", { entryType: "deadline", title: "Essay", description: null, entryDate: "2026-11-09", startTime: null, endTime: null, durationMinutes: null, link: { kind: "topic", id: "sepsis", label: "Sepsis" }, recurrence: null });
    h.topics = [];
    const v = await loadToday(ctx(), policy, O);
    if (!v.ok) throw new Error("setup");
    expect(v.notes.some(n => /marked it as busy/.test(n.text))).toBe(true);
    expect(v.week?.thisWeek.some(d => d.day === "2026-11-02")).toBe(false);
    expect(v.next?.rule).toBe("deadline");
  });
});

describe("loadProposal", () => {
  const secs = (mat: string, n: number, prefix: string) => Array.from({ length: n }, (_, i) => ({ chunkId: `${prefix}${i + 1}`, materialId: mat, ordinal: i + 1 }));
  beforeEach(() => {
    h.sections = [...secs(MAT, 3, "r"), ...secs(MAT2, 2, "m")];
    h.topicOf = new Map([["r1", ["Acute kidney injury"]], ["r2", ["Fluid balance"]], ["r3", ["Dialysis"]], ["m1", ["acute kidney injury"]], ["m2", ["Heart failure"]]]);
  });
  it("is the first plan when none is saved, and uses the starting suggestion", async () => {
    h.plan = null;
    const v = await loadProposal(ctx(), policy, MAT, O);
    if (!v.ok) throw new Error("setup");
    expect(v.hasPlan).toBe(false);
    expect(v.proposal.firstPlan).toBe(true);
    expect(v.proposal.sessions.usingDefaults).toBe(true);
    expect(v.proposal.workloadMinutes).toBe(36);
    expect(v.decision).toBeNull();
    expect(v.recordable).toBe(true);
  });
  it("a later upload sees the current decision and does not count a topic an accepted material already covers", async () => {
    await appendPlanEvent(admin, A, "scholar", { kind: "proposal", ref: MAT, status: "accepted", value: {} });
    const v = await loadProposal(ctx(), policy, MAT2, O);
    if (!v.ok) throw new Error("setup");
    expect(v.hasPlan).toBe(true);
    expect(v.proposal.sequence[0]).toMatchObject({ label: "acute kidney injury", minutes: 0, coveredIn: ["Renal notes"] });
    expect(v.proposal.newSections).toBe(1);
    const own = await loadProposal(ctx(), policy, MAT, O);
    expect(own.ok && own.decision).toBe("accepted");
  });
  it("another learner's material, an unknown one, and the switch off are refused", async () => {
    expect(await loadProposal(ctx(), policy, "cccccccc-0000-4000-8000-0000000000c1", O)).toEqual({ ok: false, reason: "not_found" });
    expect(await loadProposal(ctx(), { ...policy, scholarPlanProposal: "off" }, MAT, O)).toEqual({ ok: false, reason: "off" });
  });
  it("is shown but cannot be remembered without 840", async () => {
    resetLearningPlanSchema(false);
    const v = await loadProposal(ctx(), policy, MAT, O);
    expect(v.ok && v.recordable).toBe(false);
  });
});

describe("loadInsights", () => {
  it("returns the measures, with not measured where there is no evidence", async () => {
    const v = await loadInsights(ctx(), policy, O);
    if (!v.ok) throw new Error("setup");
    expect(v.insights.consistency).toMatchObject({ state: "measured", studyDays: 1 });
    expect(v.insights.practice).toMatchObject({ state: "measured", percent: 100, answered: 1, lowEvidence: true });
    expect(v.insights.retention).toMatchObject({ state: "not_measured" });
    expect(v.insights.selfReported).toBeNull();
  });
  it("counts a completed personal study session only as self-reported, never as a study day", async () => {
    const made = await createEntry(admin, A, "scholar", { entryType: "study_session", title: "My session", description: null, entryDate: "2026-10-30", startTime: "09:00", endTime: "09:45", durationMinutes: null, link: null, recurrence: null });
    if (!made.ok) throw new Error("setup");
    const { updateEntry } = await import("../learning-plan/entry-store");
    await updateEntry(admin, A, "scholar", made.entry.id, { status: "completed" });
    const v = await loadInsights(ctx(), policy, O);
    if (!v.ok) throw new Error("setup");
    expect(v.insights.selfReported).toMatchObject({ sessions: 1, minutes: 45 });
    expect(v.insights.consistency).toMatchObject({ state: "measured", studyDays: 1 });     // only the recorded answer on 1 November
  });
});
