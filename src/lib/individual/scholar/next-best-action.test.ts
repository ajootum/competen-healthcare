import { describe, expect, it } from "vitest";
import type { PlanEvent } from "../learning-plan/types";
import { BASE, chooseNextActions, nbaCandidates, nbaDates, retrievalMinutes, snoozeUntil, type NbaCheck, type NbaInput, type NbaTopic } from "./next-best-action";

const S1 = "11111111-1111-4111-8111-111111111111", S2 = "22222222-2222-4222-8222-222222222222";
const C1 = "33333333-3333-4333-8333-333333333333";
const check = (o: Partial<NbaCheck>): NbaCheck => ({
  attemptId: "a1", sessionId: S1, step: 2, sessionTitle: "Heart failure", question: "Why does preload rise?", at: "2026-11-03T10:00:00Z", outcome: "wrong",
  adaptive: { need: "misconception", misconception: "More fluid always helps a failing heart" }, ...o,
});
const topic = (o: Partial<NbaTopic>): NbaTopic => ({
  key: "preload", label: "Preload", chunkIds: [C1], lastAt: "2026-11-03T10:00:00Z", understanding: "some", application: "none", misconceptions: "none", repeatedMisconception: null, ...o,
});
const base = (o: Partial<NbaInput> = {}): NbaInput => ({
  today: "2026-11-04", settings: { goalType: null, sessionMinutes: 20, priorities: [] }, dates: [], retrieval: null, checks: [], topics: [], unfinished: [],
  applyChunks: new Set(), decisions: [], max: 3, ...o,
});
const ev = (ref: string, status: PlanEvent["status"], value: Record<string, unknown>, at = "2026-11-04T08:00:00Z"): PlanEvent =>
  ({ id: `e-${ref}-${at}`, experience: "scholar", kind: "next_action", ref, status, value, createdAt: at });

describe("SALE-11 next best actions: each names an ACTION with a short reason", () => {
  it("a kept misconception (R1 response.adaptive) becomes 'Review this misconception' back to that lesson", () => {
    const r = chooseNextActions(base({ checks: [check({})] }));
    expect(r.items).toHaveLength(1);
    const m = r.items[0];
    expect(m.kind).toBe("misconception");
    expect(m.action).toBe("Review this misconception");
    expect(m.reason).toContain("More fluid always helps a failing heart");
    expect(m.href).toContain(`study/learn?session=${S1}#lesson-2`);
    expect(m.link).toEqual({ kind: "lesson", id: S1, label: "Heart failure, lesson 3" });
  });

  it("is not suggested once a later answer in the same lesson was right, or when it is older than 30 days", () => {
    expect(chooseNextActions(base({ checks: [check({}), check({ attemptId: "a2", at: "2026-11-03T11:00:00Z", outcome: "right", adaptive: null })] })).items).toEqual([]);
    expect(chooseNextActions(base({ checks: [check({ at: "2026-09-01T10:00:00Z" })] })).items).toEqual([]);
  });

  it("a possible missing foundation becomes 'Revisit a prerequisite' pointing at the lesson before; never on the first lesson", () => {
    const r = chooseNextActions(base({ checks: [check({ adaptive: { need: "prerequisite_gap", misconception: null } })] }));
    expect(r.items[0].kind).toBe("prerequisite");
    expect(r.items[0].action).toBe("Revisit a prerequisite before going on");
    expect(r.items[0].href).toContain("#lesson-1");
    expect(chooseNextActions(base({ checks: [check({ step: 0, adaptive: { need: "prerequisite_gap", misconception: null } })] })).items).toEqual([]);
  });

  it("due cards become an N-minute retrieval exercise sized by the cards and the learner's session", () => {
    expect(retrievalMinutes(12, null)).toBe(8);
    expect(retrievalMinutes(1, null)).toBe(3);
    expect(retrievalMinutes(100, null)).toBe(15);
    expect(retrievalMinutes(100, 10)).toBe(10);
    const r = chooseNextActions(base({ retrieval: { due: 12, source: "cards" }, settings: { goalType: null, sessionMinutes: 30, priorities: [] } }));
    expect(r.items[0].action).toBe("8-minute retrieval exercise");
    expect(r.items[0].reason).toMatch(/12 cards have reached their review date/);
    expect(r.items[0].because).toContain("Counted from your revision cards.");
  });

  it("an unfinished lesson becomes 'Continue your unfinished lesson'; one left over 14 days ago does not", () => {
    const r = chooseNextActions(base({ unfinished: [{ sessionId: S2, title: "Renal physiology", lastAt: "2026-11-02T09:00:00Z" }, { sessionId: S1, title: "Old", lastAt: "2026-10-01T09:00:00Z" }] }));
    expect(r.items.map(i => i.action)).toEqual(["Continue your unfinished lesson"]);
    expect(r.items[0].about).toBe("Renal physiology");
  });

  it("apply is offered only where understanding is shown, application is not, and the section has an accepted mapping", () => {
    expect(chooseNextActions(base({ topics: [topic({})] })).items).toEqual([]);
    const r = chooseNextActions(base({ topics: [topic({})], applyChunks: new Set([C1]) }));
    expect(r.items[0].action).toBe("Apply Preload in a case");
    expect(r.items[0].href).toContain(`section=${C1}`);
    expect(chooseNextActions(base({ topics: [topic({ understanding: "thin" })], applyChunks: new Set([C1]) })).items).toEqual([]);
    expect(chooseNextActions(base({ topics: [topic({ application: "some" })], applyChunks: new Set([C1]) })).items).toEqual([]);
  });

  it("a misconception named on different questions of a topic (R1 M1 stronger) is suggested once, to the mistake notebook", () => {
    const r = chooseNextActions(base({ topics: [topic({ misconceptions: "stronger", repeatedMisconception: "Afterload equals preload" })] }));
    expect(r.items[0].kind).toBe("misconception");
    expect(r.items[0].href).toContain("study/revise/mistakes");
  });
});

describe("SALE-11 priority: goals, exam and placement dates, available time, priorities", () => {
  const all = (o: Partial<NbaInput> = {}) => base({
    checks: [check({})], retrieval: { due: 6, source: "cards" }, unfinished: [{ sessionId: S2, title: "Renal physiology", lastAt: "2026-11-02T09:00:00Z" }],
    topics: [topic({})], applyChunks: new Set([C1]), max: 5, ...o,
  });
  it("orders by the transparent base without adjustments", () => {
    expect(BASE.prerequisite > BASE.misconception && BASE.misconception > BASE.retrieval && BASE.retrieval > BASE.continue && BASE.continue > BASE.apply).toBe(true);
    expect(chooseNextActions(all()).items.map(i => i.kind)).toEqual(["misconception", "retrieval", "continue", "apply"]);
  });
  it("an exam in 5 days lifts retrieval above a misconception from last week (a fresh one still comes first), and says why", () => {
    const r = chooseNextActions(all({ checks: [check({ at: "2026-10-28T10:00:00Z" })], dates: [{ kind: "exam", title: "Cardio OSCE", date: "2026-11-09" }] }));
    expect(r.items[0].kind).toBe("retrieval");
    expect(r.items[0].because.join(" ")).toContain('Your exam "Cardio OSCE" is in 5 days');
    expect(chooseNextActions(all({ dates: [{ kind: "exam", title: "Cardio OSCE", date: "2026-11-09" }] })).items[0].kind).toBe("misconception");
  });
  it("a placement soon lifts applying it in a case", () => {
    const r = chooseNextActions(all({ dates: [{ kind: "placement", title: "Ward 4", date: "2026-11-06" }] }));
    expect(r.items.findIndex(i => i.kind === "apply")).toBeLessThan(r.items.findIndex(i => i.kind === "continue"));
  });
  it("a learn goal lifts continuing; a learner priority lifts its topic; a long action in a short session is lowered", () => {
    const learn = chooseNextActions(all({ settings: { goalType: "learn", sessionMinutes: 20, priorities: [] } }));
    expect(learn.items[1].kind).toBe("continue");
    const prio = chooseNextActions(all({ settings: { goalType: null, sessionMinutes: 20, priorities: ["Renal physiology"] } }));
    expect(prio.items.find(i => i.kind === "continue")!.because).toContain("You chose Renal physiology as a priority.");
    const short = chooseNextActions(all({ settings: { goalType: null, sessionMinutes: 8, priorities: [] } }));
    expect(short.items.find(i => i.kind === "continue")!.because.join(" ")).toContain("longer than your usual 8-minute session");
  });
  it("is deterministic and keeps to the maximum", () => {
    expect(chooseNextActions(all({ max: 2 })).items).toHaveLength(2);
    expect(JSON.stringify(chooseNextActions(all()))).toBe(JSON.stringify(chooseNextActions(all())));
  });
});

describe("SALE-11 the learner's choices: accept, snooze, dismiss (975 next_action events)", () => {
  const fp = nbaCandidates(base({ checks: [check({})] }))[0].fingerprint;
  const ref = `nba:mis:${S1}:2`;
  it("dismiss hides it until its evidence changes", () => {
    expect(chooseNextActions(base({ checks: [check({})], decisions: [ev(ref, "declined", { fingerprint: fp })] }))).toMatchObject({ items: [], dismissed: 1 });
    const newer = check({ attemptId: "a9", at: "2026-11-04T07:00:00Z" });
    expect(chooseNextActions(base({ checks: [check({}), newer], decisions: [ev(ref, "declined", { fingerprint: fp })] })).items).toHaveLength(1);
  });
  it("snooze hides it until the date chosen, then it returns", () => {
    expect(chooseNextActions(base({ checks: [check({})], decisions: [ev(ref, "deferred", { fingerprint: fp, until: "2026-11-05" })] }))).toMatchObject({ items: [], snoozed: 1 });
    expect(chooseNextActions(base({ today: "2026-11-05", checks: [check({})], decisions: [ev(ref, "deferred", { fingerprint: fp, until: "2026-11-05" })] })).items).toHaveLength(1);
  });
  it("accept shows it as planned for its day, and drops it once that day has passed", () => {
    expect(chooseNextActions(base({ checks: [check({})], decisions: [ev(ref, "accepted", { fingerprint: fp, date: "2026-11-04", entryId: "x" })] })).items[0]).toMatchObject({ state: "planned", plannedFor: "2026-11-04" });
    expect(chooseNextActions(base({ today: "2026-11-06", checks: [check({ at: "2026-11-05T10:00:00Z", attemptId: "a1" })], decisions: [ev(ref, "accepted", { fingerprint: fp, date: "2026-11-05" })] })).items).toEqual([]);
  });
  it("only the newest choice counts", () => {
    const decisions = [ev(ref, "declined", { fingerprint: fp }, "2026-11-04T08:00:00Z"), ev(ref, "deferred", { fingerprint: fp, until: "2026-11-04" }, "2026-11-04T09:00:00Z")];
    expect(chooseNextActions(base({ checks: [check({})], decisions })).items).toHaveLength(1);
  });
  it("snooze dates are 1, 3 or 7 days on", () => {
    expect(snoozeUntil("2026-11-04", undefined)).toBe("2026-11-05");
    expect(snoozeUntil("2026-11-04", 7)).toBe("2026-11-11");
    expect(snoozeUntil("2026-11-04", 2)).toBeNull();
  });
  it("reads the exam date from settings and the learner's exam and placement entries, not cancelled ones", () => {
    expect(nbaDates({ examDate: "2026-12-01", examLabel: null, occurrences: [
      { entryType: "placement", status: "planned", title: "Ward 4", date: "2026-11-10" }, { entryType: "exam", status: "cancelled", title: "x", date: "2026-11-11" },
      { entryType: "study_session", status: "planned", title: "y", date: "2026-11-12" },
    ] })).toEqual([{ kind: "exam", title: "your exam", date: "2026-12-01" }, { kind: "placement", title: "Ward 4", date: "2026-11-10" }]);
  });
});
