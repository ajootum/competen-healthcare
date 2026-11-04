import { describe, expect, it } from "vitest";
import { buildRetrievalSchedule, isHarderTopic, qualityOf, repeatedMisconception, replayRecall, retrievalCapacity, retrievalLine, DEFAULT_RETRIEVAL_POLICY, type RetrievalPlan } from "./retrieval-schedule";
import { SRS_DEFAULTS } from "./revision";
import type { StateEvidence, StateTopic } from "./learning-state";

const ev = (o: Partial<StateEvidence> & { at: string }): StateEvidence => ({
  itemId: "q1", attemptId: null, topicKey: "oxygen therapy", chunkId: "c1", materialId: "m1", source: "practice", level: "understanding",
  outcome: 1, marking: "code", confidence: null, misconceptions: [], ...o,
});
const topic: StateTopic = { key: "oxygen therapy", label: "Oxygen therapy", materialId: "m1", chunkIds: ["c1", "c2"] };
const hrefs = { questions: (m: string | null, c: readonly string[]) => `/revise?material=${m}&sections=${c.join(",")}`, cards: (m: string | null) => `/revise?material=${m}` };
const build = (evidence: StateEvidence[], today: string, o: { plan?: RetrievalPlan | null; topics?: StateTopic[]; cards?: { topicKey: string; nextReviewAt: string; status: string }[]; policy?: object } = {}) =>
  buildRetrievalSchedule({ topics: o.topics ?? [topic], evidence, cards: o.cards ?? [], today, plan: o.plan ?? null, hrefs, policy: o.policy });

describe("SALE-08 retrieval: the shared SM-2 over the topic's answers", () => {
  it("maps a day's mean outcome to an SM-2 quality", () => {
    expect(qualityOf(1)).toBe(4); expect(qualityOf(0.6)).toBe(3); expect(qualityOf(0.2)).toBe(1);
  });
  it("counts same-day answers as one retrieval (a lesson's checks are not spaced practice)", () => {
    const r = replayRecall([ev({ at: "2026-11-01T09:00:00Z" }), ev({ itemId: "q2", at: "2026-11-01T09:05:00Z" }), ev({ itemId: "q3", at: "2026-11-01T10:00:00Z" })], null);
    expect(r).toMatchObject({ lastDay: "2026-11-01", days: 1, recalled: 1, lapses: 0, interval: 1 });
  });
  it("expands the interval after successful recall on separate days: 1, 6, then x ease", () => {
    expect(replayRecall([ev({ at: "2026-10-01T09:00:00Z" }), ev({ at: "2026-10-02T09:00:00Z" })], null)?.interval).toBe(6);
    expect(replayRecall([ev({ at: "2026-10-01T09:00:00Z" }), ev({ at: "2026-10-02T09:00:00Z" }), ev({ at: "2026-10-08T09:00:00Z" })], null)?.interval).toBe(15);
  });
  it("restarts at one day after a miss", () => {
    const r = replayRecall([ev({ at: "2026-10-01T09:00:00Z" }), ev({ at: "2026-10-02T09:00:00Z" }), ev({ at: "2026-10-08T09:00:00Z", outcome: 0 })], null);
    expect(r).toMatchObject({ interval: 1, recalled: 2, lapses: 1 });
  });
  it("ignores unmarked answers; none marked means nothing to schedule", () => {
    expect(replayRecall([ev({ at: "2026-10-01T09:00:00Z", marking: "unmarked", outcome: null })], null)).toBeNull();
  });
  it("applies the SRS harder-interval share to a harder topic", () => {
    const rows = [ev({ at: "2026-10-01T09:00:00Z", level: "application" }), ev({ at: "2026-10-02T09:00:00Z", level: "application" })];
    expect(isHarderTopic(rows)).toBe(true);
    expect(replayRecall(rows, 3, { ...SRS_DEFAULTS, harderIntervalPercent: 50 })?.interval).toBe(3);
  });
});

describe("SALE-08 retrieval: the schedule", () => {
  it("is due once the interval since the last practice has passed, with the reason in words", () => {
    const s = build([ev({ at: "2026-10-20T09:00:00Z" }), ev({ itemId: "q2", at: "2026-10-21T09:00:00Z" })], "2026-11-04");
    expect(s.due).toHaveLength(1);
    const i = s.due[0];
    expect(i).toMatchObject({ dueOn: "2026-10-27", state: "due", overdueDays: 8, intervalDays: 6, lastPracticedOn: "2026-10-21" });
    expect(i.reasons[0]).toMatch(/Last practised 14 days ago\. Recalled well on 2 of 2 practice days/);
    expect(i.rules).toEqual(["S1"]);
    expect(i.action).toEqual({ kind: "questions", label: "Recall it now", href: "/revise?material=m1&sections=c1,c2" });
  });
  it("is upcoming when not yet due, and later beyond seven days", () => {
    expect(build([ev({ at: "2026-11-03T09:00:00Z" }), ev({ at: "2026-11-04T08:00:00Z" })], "2026-11-04").upcoming[0]).toMatchObject({ dueOn: "2026-11-10", state: "upcoming" });
    const later = build([ev({ at: "2026-10-01T09:00:00Z" }), ev({ at: "2026-10-02T09:00:00Z" }), ev({ at: "2026-10-08T09:00:00Z" }), ev({ at: "2026-11-03T09:00:00Z" })], "2026-11-04");
    expect(later.later).toBe(1);
  });
  it("S3: a misconception repeated on different questions, not yet corrected, brings it back sooner", () => {
    const rows = [
      ev({ at: "2026-10-20T09:00:00Z" }), ev({ itemId: "q2", at: "2026-10-21T09:00:00Z" }),
      ev({ itemId: "q3", at: "2026-10-28T09:00:00Z", outcome: 0, misconceptions: ["Oxygen is always safe at any flow"] }),
      ev({ itemId: "q4", at: "2026-10-28T10:00:00Z", outcome: 0, misconceptions: ["oxygen is always safe at any flow"] }),
    ];
    expect(repeatedMisconception(rows)).toMatch(/always safe/);
    const plain = build(rows.map(r => ({ ...r, misconceptions: [] })), "2026-11-04").due[0] ?? build(rows.map(r => ({ ...r, misconceptions: [] })), "2026-11-04").upcoming[0];
    const s = build(rows, "2026-11-04", { policy: { misconceptionPercent: 50 } });
    const i = s.due[0];
    expect(i.flags.misconception).toBe(true);
    expect(i.rules).toContain("S3");
    expect(i.intervalDays).toBeLessThanOrEqual(plain.intervalDays);
    expect(i.reasons.join(" ")).toMatch(/same misconception/);
  });
  it("S3 does not fire once the latest answer is right (corrected), nor for a single miss", () => {
    const rows = [ev({ itemId: "q3", at: "2026-10-28T09:00:00Z", outcome: 0, misconceptions: ["X"] }), ev({ itemId: "q4", at: "2026-10-28T10:00:00Z", outcome: 0, misconceptions: ["X"] }), ev({ itemId: "q5", at: "2026-10-29T10:00:00Z" })];
    expect(repeatedMisconception(rows)).toBeNull();
    expect(repeatedMisconception([ev({ at: "2026-10-28T09:00:00Z", outcome: 0, misconceptions: ["X"] })])).toBeNull();
  });
  it("S4: brought forward to before the exam", () => {
    const rows = [ev({ at: "2026-10-01T09:00:00Z" }), ev({ at: "2026-10-02T09:00:00Z" }), ev({ at: "2026-11-03T09:00:00Z" })];
    const plan: RetrievalPlan = { examDate: "2026-11-09", examLabel: "UNMEB", daysPerWeek: 5, sessionMinutes: 40, weeklyMinutes: 200, priorities: [] };
    const i = build(rows, "2026-11-04", { plan }).upcoming[0];
    expect(i).toMatchObject({ dueOn: "2026-11-07", flags: { exam: true } });
    expect(i.rules).toContain("S4");
    expect(i.reasons.join(" ")).toMatch(/UNMEB exam is on 2026-11-09/);
  });
  it("S4 ignores an exam already past", () => {
    const rows = [ev({ at: "2026-10-01T09:00:00Z" }), ev({ at: "2026-10-02T09:00:00Z" }), ev({ at: "2026-11-03T09:00:00Z" })];
    const i = build(rows, "2026-11-04", { plan: { examDate: "2026-11-01", examLabel: null, daysPerWeek: null, sessionMinutes: null, weeklyMinutes: null, priorities: [] } });
    expect([...i.due, ...i.upcoming].some(x => x.rules.includes("S4"))).toBe(false);
  });
  it("S5: a priority topic says so and comes first among equally due ones", () => {
    const other: StateTopic = { key: "asthma", label: "Asthma", materialId: "m1", chunkIds: ["c9"] };
    const rows = [ev({ at: "2026-10-20T09:00:00Z" }), ev({ topicKey: "asthma", itemId: "a1", at: "2026-10-20T09:00:00Z" })];
    const s = build(rows, "2026-11-04", { topics: [other, topic], plan: { examDate: null, examLabel: null, daysPerWeek: 7, sessionMinutes: 60, weeklyMinutes: 420, priorities: ["oxygen"] } });
    expect(s.due.map(d => d.label)).toEqual(["Oxygen therapy", "Asthma"]);
    expect(s.due[0].rules).toContain("S5");
  });
  it("S6: beyond one session's capacity, the rest go to following study days spaced by days a week", () => {
    const topics = Array.from({ length: 4 }, (_, k) => ({ key: `t${k}`, label: `T${k}`, materialId: "m1", chunkIds: [`c${k}`] }));
    const rows = topics.map((t, k) => ev({ topicKey: t.key, itemId: `q${k}`, at: "2026-10-20T09:00:00Z" }));
    const s = build(rows, "2026-11-04", { topics, plan: { examDate: null, examLabel: null, daysPerWeek: 3, sessionMinutes: 20, weeklyMinutes: 60, priorities: [] }, policy: { minutesPerTopic: 5, sharePercent: 50 } });
    expect(s.capacity.perDay).toBe(2);
    expect(s.due.map(d => d.suggestedOn)).toEqual(["2026-11-04", "2026-11-04", "2026-11-06", "2026-11-06"]);
    expect(s.due[2].rules).toContain("S6");
    expect(retrievalLine(s.due[2], s.today)).toMatch(/for 2026-11-06/);
  });
  it("S7: a topic known only from card reviews follows its cards and points to them", () => {
    const rows = [ev({ source: "review", marking: "self", at: "2026-10-30T09:00:00Z" })];
    const s = build(rows, "2026-11-04", { cards: [{ topicKey: "oxygen therapy", nextReviewAt: "2026-11-03", status: "active" }] });
    expect(s.due[0]).toMatchObject({ dueOn: "2026-11-03", flags: { cardsOnly: true }, action: { kind: "cards" } });
    expect(s.due[0].rules).toContain("S7");
  });
  it("does not schedule topics met but never assessed with a mark", () => {
    const s = build([], "2026-11-04");
    expect(s).toMatchObject({ due: [], upcoming: [], later: 0, notAssessed: 1 });
  });
  it("has no percentage or score in any reason, and says it is never competence", () => {
    const s = build([ev({ at: "2026-10-20T09:00:00Z" })], "2026-11-04");
    expect(s.due[0].reasons.join(" ")).not.toMatch(/%|score|master/i);
    expect(s.note).toMatch(/never a judgement of competence/);
    expect(s.note).toMatch(/nothing is added to your plan/);
  });
  it("capacity: from the learner's session, else 30 minutes, never below one topic", () => {
    expect(retrievalCapacity(null, DEFAULT_RETRIEVAL_POLICY)).toMatchObject({ perDay: 1, minutesPerDay: 9 });
    expect(retrievalCapacity({ examDate: null, examLabel: null, daysPerWeek: 5, sessionMinutes: 60, weeklyMinutes: 300, priorities: [] }, DEFAULT_RETRIEVAL_POLICY)).toMatchObject({ perDay: 3, minutesPerDay: 18 });
    expect(retrievalCapacity({ examDate: null, examLabel: null, daysPerWeek: 4, sessionMinutes: null, weeklyMinutes: 400, priorities: [] }, DEFAULT_RETRIEVAL_POLICY).minutesPerDay).toBe(30);
  });
});
