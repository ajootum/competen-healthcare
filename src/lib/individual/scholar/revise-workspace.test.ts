import { describe, expect, it } from "vitest";
import { buildCatalogue, buildStudiedThisMonth, buildTodayQueue, daysLeftLabel, dueLabel, filterCatalogue, matchesPriority, parseCatalogueFilters, parseReviseView, shortDate, type TodayInput } from "./revise-workspace";
import { retrievalLine, type RetrievalItem } from "./retrieval-schedule";
import { reviewStateOf } from "./flashcards";

const empty: TodayInput = { resume: [], resumeAllHref: "/all", dueCards: 0, dueCardsHref: "/cards", retrieval: [], repeated: [], weakOffered: true, mistakes: null, mistakesHref: "/m", plan: [], recommended: [], priorities: [] };
const TODAY = "2026-11-05";

describe("the views", () => {
  it("open on Today, and read only what they know", () => {
    expect(parseReviseView(undefined)).toBe("today");
    expect(parseReviseView("nonsense")).toBe("today");
    for (const v of ["today", "priorities", "month", "topics", "insights"]) expect(parseReviseView(v)).toBe(v);
  });
});

describe("dates mean one thing", () => {
  it("never calls a future date due today", () => {
    expect(dueLabel("2026-11-12", TODAY)).toBe("Next review 12 Nov");
    expect(dueLabel("2026-11-05", TODAY)).toBe("Due today");
    expect(dueLabel("2026-11-01", TODAY)).toBe("Due since 1 Nov");
    expect(dueLabel(null, TODAY)).toBe("Not scheduled");
    expect(dueLabel("2026-11-12T00:00:00Z", TODAY)).toBe("Next review 12 Nov");
  });
  const item = (over: Partial<RetrievalItem>) => ({ state: "due", dueOn: TODAY, suggestedOn: TODAY, overdueDays: 0, ...over }) as RetrievalItem;
  it("does not say Due today beside a later date, the contradiction on the old page", () => {
    expect(retrievalLine(item({ suggestedOn: "2026-11-12" }), TODAY)).toBe("Planned for 12 Nov");
    expect(retrievalLine(item({ dueOn: "2026-11-01", overdueDays: 4, suggestedOn: "2026-11-07" }), TODAY)).toBe("Planned for 7 Nov, was due 1 Nov");
  });
  it("says what is really due", () => {
    expect(retrievalLine(item({}), TODAY)).toBe("Due today");
    expect(retrievalLine(item({ dueOn: "2026-11-01", overdueDays: 4 }), TODAY)).toBe("Due since 1 Nov");
    expect(retrievalLine(item({ state: "upcoming", dueOn: "2026-11-09", suggestedOn: "2026-11-09" }), TODAY)).toBe("Due 9 Nov");
  });
  it("leaves a card's state to the date it holds", () => {
    const card = { id: "c", nextReviewAt: "2026-11-12", lastReviewedAt: null, lastQuality: 4, reviews: 2, intervalDays: 7, ease: 2.5, status: "active" as const };
    expect(reviewStateOf(card, TODAY)).toBe("remembered");
    expect(reviewStateOf({ ...card, nextReviewAt: TODAY }, TODAY)).toBe("due");
  });
  it("reads a date the same in every time zone", () => {
    expect(shortDate("2026-11-01")).toBe("1 Nov");
    expect(daysLeftLabel("2026-11-12", TODAY)).toBe("in 7 days");
    expect(daysLeftLabel(TODAY, TODAY)).toBe("today");
    expect(daysLeftLabel("2026-11-01", TODAY)).toBeNull();
  });
});

describe("the queue", () => {
  it("is empty when nothing needs attention, rather than inventing something", () => {
    expect(buildTodayQueue(empty)).toEqual([]);
  });
  it("puts unfinished work first, then what is due, then gaps, then the plan, then a suggestion", () => {
    const q = buildTodayQueue({
      ...empty, dueCards: 3, mistakes: 2, repeated: [{ materialTitle: "Renal" }],
      resume: [{ key: "s1", title: "Quick Practice", position: 2, total: 5, lastActiveDay: "2026-11-04", href: "/s1" }],
      retrieval: [{ key: "t", label: "Sepsis", status: "Due today", why: "w", more: [], href: "/t", actionLabel: "Practise", priorityFlag: false }],
      plan: [{ key: "p", title: "Study oxygen", why: "w", href: "/p" }],
      recommended: [{ key: "r", title: "Teach me", why: "w", action: { kind: "link", href: "/r", label: "Go" } }],
    });
    expect(q.map(i => i.kind)).toEqual(["resume", "cards", "retrieval", "weak", "mistakes", "plan", "recommended"]);
    expect(q[0].why).toContain("2 of 5 answered");
    expect(q[0].action).toEqual({ kind: "link", href: "/s1", label: "Resume" });
  });
  it("gives the two newest unfinished sessions a row each and gathers the rest into one, so they do not fill the queue", () => {
    const s = (key: string) => ({ key, title: "Quick practice", position: 1, total: 3, lastActiveDay: TODAY, href: `/${key}` });
    expect(buildTodayQueue({ ...empty, resume: [s("a"), s("b")] }).map(i => i.key)).toEqual(["resume-a", "resume-b"]);
    const q = buildTodayQueue({ ...empty, dueCards: 1, resume: [s("a"), s("b"), s("c"), s("d")] });
    expect(q.map(i => i.key)).toEqual(["resume-a", "resume-b", "resume-more", "cards"]);
    expect(q[2].title).toBe("2 more unfinished sessions");
    expect(q[2].action).toEqual({ kind: "link", href: "/all", label: "See them all" });
    expect(buildTodayQueue({ ...empty, resume: [s("a"), s("b"), s("c")] })[2].title).toBe("1 more unfinished session");
  });
  it("says why each thing matters and gives one way to begin", () => {
    for (const i of buildTodayQueue({ ...empty, dueCards: 1, mistakes: 1, repeated: [{ materialTitle: null }] })) {
      expect(i.why.length).toBeGreaterThan(5);
      expect(i.action.label.length).toBeGreaterThan(2);
    }
  });
  it("consolidates due cards into one row, however many are due", () => {
    const q = buildTodayQueue({ ...empty, dueCards: 40 });
    expect(q).toHaveLength(1);
    expect(q[0].title).toBe("Review 40 due cards");
  });
  it("does not offer weak-area practice when HQ does not offer that mode", () => {
    expect(buildTodayQueue({ ...empty, repeated: [{ materialTitle: "Renal" }], weakOffered: false })).toEqual([]);
  });
  it("puts the learner's priorities first within a kind, and never above unfinished work", () => {
    const r = (label: string) => ({ key: label, label, status: "Due today", why: "w", more: [], href: "/", actionLabel: "Go", priorityFlag: false });
    const q = buildTodayQueue({ ...empty, priorities: ["sepsis"], resume: [{ key: "a", title: "Mock", position: 0, total: 1, lastActiveDay: TODAY, href: "/" }], retrieval: [r("Burns"), r("Sepsis care")] });
    expect(q.map(i => i.title)).toEqual(["Carry on: Mock", "Sepsis care", "Burns"]);
    expect(q[1].priority).toBe(true);
    expect(q[2].priority).toBe(false);
  });
  it("matches a priority by whole words", () => {
    expect(matchesPriority("Care in sepsis", ["Sepsis"])).toBe(true);
    expect(matchesPriority("Antisepsis", ["sepsis"])).toBe(false);
    expect(matchesPriority("Anything", ["a"])).toBe(false);
  });
});

const mats = [
  { id: "old", title: "Older notes", createdAt: "2026-09-01T10:00:00Z" },
  { id: "new", title: "Uploaded now", createdAt: "2026-11-02T10:00:00Z" },
  { id: "both", title: "Both", createdAt: "2026-11-03T10:00:00Z" },
];
const questions = [{ id: "q1", materialId: "old", competencyId: "c1" }, { id: "q2", materialId: "both", competencyId: null }];

describe("studied this month", () => {
  const base = { today: TODAY, tz: "UTC", materials: mats, questions, reviews: [], sessions: [], cards: [] };
  it("counts an old material studied this month, and not a material only uploaded", () => {
    const v = buildStudiedThisMonth({ ...base, attempts: [{ questionId: "q1", correct: true, answeredAt: "2026-11-04T09:00:00Z" }] });
    expect(v.groups.map(g => g.materialId)).toEqual(["old"]);
    expect(v.groups[0]).toMatchObject({ days: ["2026-11-04"], uploadedOn: "2026-09-01", consolidation: "up_to_date" });
    expect(v.uploadedNotStudied.map(m => m.id)).toEqual(["new", "both"]);
  });
  it("leaves out last month's learning", () => {
    const v = buildStudiedThisMonth({ ...base, attempts: [{ questionId: "q1", correct: true, answeredAt: "2026-10-31T09:00:00Z" }] });
    expect(v.groups).toEqual([]);
  });
  it("uses the learner's local date at the edge of a month", () => {
    const answeredAt = "2026-10-31T22:30:00Z";
    expect(buildStudiedThisMonth({ ...base, tz: "Africa/Kampala", attempts: [{ questionId: "q1", correct: true, answeredAt }] }).groups[0].days).toEqual(["2026-11-01"]);
    expect(buildStudiedThisMonth({ ...base, tz: "UTC", attempts: [{ questionId: "q1", correct: true, answeredAt }] }).groups).toEqual([]);
  });
  it("groups a lesson under its material, as learnt but not revised, and lists one it cannot place apart", () => {
    const v = buildStudiedThisMonth({ ...base, attempts: [], sessions: [
      { id: "s1", title: "Lesson one", status: "active", lastActiveAt: "2026-11-02T08:00:00Z", materialIds: ["old"] },
      { id: "s2", title: "Elsewhere", status: "completed", lastActiveAt: "2026-11-03T08:00:00Z", materialIds: [] },
    ] });
    expect(v.groups[0]).toMatchObject({ materialId: "old", consolidation: "not_revised", lessons: [{ id: "s1", title: "Lesson one", completed: false }] });
    expect(v.unplaced).toEqual([{ id: "s2", title: "Elsewhere", day: "2026-11-03", completed: true }]);
  });
  it("shows what needs consolidating, cards first", () => {
    const v = buildStudiedThisMonth({ ...base, attempts: [{ questionId: "q1", correct: false, answeredAt: "2026-11-04T09:00:00Z" }, { questionId: "q2", correct: false, answeredAt: "2026-11-03T09:00:00Z" }],
      cards: [{ nextReviewAt: TODAY, status: "active", materialId: "both" }, { nextReviewAt: "2026-11-20", status: "active", materialId: "old" }] });
    expect(Object.fromEntries(v.groups.map(g => [g.materialId, g.consolidation]))).toEqual({ old: "missed", both: "due" });
    expect(v.groups[0].materialId).toBe("old");
  });
});

describe("all topics", () => {
  const rows = buildCatalogue({
    today: TODAY, tz: "UTC", materials: mats, questions, reviews: [],
    attempts: [{ questionId: "q1", correct: false, answeredAt: "2026-10-04T09:00:00Z" }, { questionId: "q1", correct: true, answeredAt: "2026-10-05T09:00:00Z" }, { questionId: "q2", correct: false, answeredAt: "2026-11-01T09:00:00Z" }],
    cards: [{ nextReviewAt: "2026-11-30", status: "active", materialId: "old" }],
    topicsOf: id => (id === "old" ? ["Oxygen therapy", "Sepsis"] : []), competenciesOf: id => (id === "both" ? ["c2"] : []),
  });
  const f = (p: Record<string, string> = {}) => filterCatalogue(rows, parseCatalogueFilters(p));
  it("includes older learning and shows where each stands, a future card not being due", () => {
    expect(rows.map(r => [r.materialId, r.status])).toEqual([["both", "needs_practice"], ["old", "revised"], ["new", "not_revised"]]);
    expect(rows.find(r => r.materialId === "old")?.dueCards).toBe(0);
  });
  it("uses the latest answer: a question answered right after a miss is not a gap", () => {
    expect(rows.find(r => r.materialId === "old")?.status).toBe("revised");
  });
  it("searches titles and topics, and filters each way", () => {
    expect(f({ q: "oxygen" }).rows.map(r => r.materialId)).toEqual(["old"]);
    expect(f({ q: "older oxygen" }).rows.map(r => r.materialId)).toEqual(["old"]);
    expect(f({ m: "new" }).rows.map(r => r.materialId)).toEqual(["new"]);
    expect(f({ t: "Sepsis" }).rows.map(r => r.materialId)).toEqual(["old"]);
    expect(f({ c: "c1" }).rows.map(r => r.materialId)).toEqual(["old"]);
    expect(f({ c: "c2" }).rows.map(r => r.materialId)).toEqual(["both"]);
    expect(f({ status: "not_revised" }).rows.map(r => r.materialId)).toEqual(["new"]);
    expect(f({ from: "2026-10-10" }).rows.map(r => r.materialId)).toEqual(["both"]);
    expect(f({}).total).toBe(3);
  });
  it("ignores what it cannot read in the address", () => {
    expect(parseCatalogueFilters({ status: "nope", from: "yesterday", page: "x" })).toMatchObject({ status: null, from: null, page: 1 });
  });
});
