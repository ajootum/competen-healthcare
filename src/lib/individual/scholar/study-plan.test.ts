import { describe, expect, it } from "vitest";
import { buildStudyPlan, unstartedMappedSections, type StudyPlanInput, type StudyPlanSettings, type UnstartedSection } from "./study-plan";
import type { MasteryEntry } from "./mastery";

const TODAY = "2026-11-02";
const MAT = "11111111-1111-4111-8111-111111111111";
const STUDY = "22222222-2222-4222-8222-222222222222";

const entry = (label: string, status: MasteryEntry["status"], o: Partial<MasteryEntry> = {}): MasteryEntry => ({
  kind: "topic", key: label.toLowerCase(), label, materialId: MAT, chunkId: null, topicSource: "topic", status,
  attempts: status === "not_started" ? 0 : 6, recentAccuracy: status === "not_started" ? null : status === "needs_work" ? 40 : status === "developing" ? 65 : 90,
  byLevel: [], highestLevel: null, byMarking: { code: 0, ai_evaluation: 0, self: 0 }, weakConcepts: [], last: { n: 0, wrong: 0 }, lastAt: null, basis: "", ...o,
});
const settings = (o: Partial<StudyPlanSettings> = {}): StudyPlanSettings => ({ examDate: null, examLabel: null, weeklyMinutes: 250, daysPerWeek: 5, goal: null, priorities: [], ...o });
const section = (n: number): UnstartedSection => ({ chunkId: `00000000-0000-4000-8000-00000000000${n}`, label: `Section ${n}`, competencyTitle: "Wound care" });
const plan = (o: Partial<StudyPlanInput> & { settings?: Partial<StudyPlanSettings> } = {}) =>
  buildStudyPlan({ plan: settings(o.settings), entries: [], dueCards: 0, unstarted: [], today: TODAY, ...o });
const all = (r: ReturnType<typeof plan>) => r.thisWeek.flatMap(d => d.activities);
const titles = (r: ReturnType<typeof plan>) => all(r).map(a => a.title);

describe("study plan: time", () => {
  it("a session is weekly minutes over days per week, split into activities of 15 to 30 minutes", () => {
    for (const [weekly, days] of [[250, 5], [300, 3], [600, 6], [90, 2], [1000, 7], [30, 1]] as const) {
      const r = plan({ settings: { weeklyMinutes: weekly, daysPerWeek: days } });
      expect(r.sessionMinutes).toBe(Math.round(weekly / Math.min(days, Math.max(1, Math.floor(weekly / 15)))));
      for (const d of r.thisWeek) {
        expect(d.minutes).toBe(r.sessionMinutes);
        for (const a of d.activities) { expect(a.minutes).toBeGreaterThanOrEqual(15); expect(a.minutes).toBeLessThanOrEqual(30); }
      }
      expect(r.thisWeek).toHaveLength(r.studyDays);
    }
  });
  it("uses fewer days, and says so, when the time is too short for the days chosen", () => {
    const r = plan({ settings: { weeklyMinutes: 30, daysPerWeek: 7 } });
    expect(r.studyDays).toBe(2);
    expect(r.sessionMinutes).toBe(15);
    expect(r.notes.join(" ")).toMatch(/too little for 7 days/);
  });
  it("spreads the study days across the next seven days, starting today, in order", () => {
    const r = plan({ settings: { daysPerWeek: 3 } });
    expect(r.thisWeek.map(d => d.day)).toEqual(["2026-11-02", "2026-11-04", "2026-11-06"]);
    expect(plan({ settings: { daysPerWeek: 7 } }).thisWeek.map(d => d.day)).toHaveLength(7);
  });
  it("is deterministic", () => {
    const i = { settings: { priorities: ["Renal"] }, entries: [entry("Renal", "needs_work"), entry("Cardiac", "developing")], dueCards: 4, unstarted: [section(1), section(2)] };
    expect(plan(i)).toEqual(plan(i));
  });
});

describe("study plan: what goes in", () => {
  it("puts the learner's priorities first", () => {
    const r = plan({
      settings: { priorities: ["Cardiac"] },
      entries: [entry("Renal", "needs_work", { recentAccuracy: 20 }), entry("Cardiac", "secure")],
    });
    expect(all(r)[0].title).toBe("Revise Cardiac");
    expect(all(r)[0].reason).toMatch(/You put Cardiac first/);
  });
  it("a priority that needs work or is not started is Learn, a developing one below application is Apply", () => {
    const r = plan({
      settings: { priorities: ["Renal", "Cardiac", "Skin"] },
      entries: [entry("Renal", "needs_work"), entry("Cardiac", "developing"), entry("Skin", "not_started")],
    });
    const t = titles(r);
    expect(t).toContain("Learn Renal");
    expect(t).toContain("Use Cardiac in a scenario");
    expect(t).toContain("Learn Skin");
  });
  it("a priority that matches no topic is still planned, as Learn", () => {
    expect(titles(plan({ settings: { priorities: ["Burns"] } }))[0]).toBe("Learn Burns");
  });
  it("needs-work topics are Learn then Revise, with the reason in the learner's numbers", () => {
    const r = plan({ entries: [entry("Renal", "needs_work", { recentAccuracy: 42, attempts: 7 })] });
    const t = titles(r);
    expect(t.indexOf("Learn Renal")).toBeGreaterThanOrEqual(0);
    expect(t.indexOf("Check Renal has stuck")).toBeGreaterThan(t.indexOf("Learn Renal"));
    expect(all(r).find(a => a.title === "Learn Renal")!.reason).toMatch(/42%.*7 answers/);
    expect(all(r).find(a => a.title === "Learn Renal")!.space).toBe("learn");
    expect(all(r).find(a => a.title === "Check Renal has stuck")!.space).toBe("revise");
  });
  it("developing topics below application get an Apply activity, and ones already at application do not", () => {
    const below = plan({ entries: [entry("Cardiac", "developing", { highestLevel: "understanding" })] });
    expect(all(below).find(a => a.space === "apply")?.title).toBe("Use Cardiac in a scenario");
    const at = plan({ entries: [entry("Cardiac", "developing", { highestLevel: "application" })] });
    expect(all(at).some(a => a.space === "apply")).toBe(false);
  });
  it("starts every session with the due cards while cards are due", () => {
    const r = plan({ dueCards: 12, entries: [entry("Renal", "needs_work")] });
    for (const d of r.thisWeek) expect(d.activities[0].title).toBe("Review your due cards");
    expect(r.thisWeek[0].activities[0].reason).toMatch(/12 cards have reached their review date/);
    expect(all(plan({ dueCards: 0 })).some(a => a.title === "Review your due cards")).toBe(false);
  });
  it("alternates due cards with new study when a session holds one activity", () => {
    const r = plan({ settings: { weeklyMinutes: 100, daysPerWeek: 5 }, dueCards: 3, entries: [entry("Renal", "needs_work")] });
    expect(r.thisWeek.map(d => d.activities.length)).toEqual([1, 1, 1, 1, 1]);
    expect(r.thisWeek.map(d => d.activities[0].title === "Review your due cards")).toEqual([true, false, true, false, true]);
    expect(r.notes.join(" ")).toMatch(/alternates/);
  });
  it("links carry ?study= when a connected session is active, and not otherwise", () => {
    const entries = [entry("Renal", "needs_work")];
    for (const a of all(plan({ entries, studyId: STUDY }))) expect(a.href).toContain(`study=${STUDY}`);
    for (const a of all(plan({ entries }))) expect(a.href).not.toContain("study=");
  });
  it("does not blame a missing topic: with no evidence at all it starts with mixed practice and says why", () => {
    const r = plan();
    expect(all(r).every(a => a.title === "Mixed practice across your topics")).toBe(true);
    expect(all(r)[0].reason).toMatch(/little practice recorded/);
  });
});

describe("study plan: not-started sections are spread across the weeks remaining", () => {
  const sections = Array.from({ length: 8 }, (_, i) => section(i + 1));
  const started = (r: ReturnType<typeof plan>) => all(r).filter(a => a.title.startsWith("Start on Section")).length;
  it("with an exam in 8 weeks, about an eighth to a quarter of them each week, not all", () => {
    const r = plan({ settings: { examDate: "2026-12-28" }, unstarted: sections });
    expect(r.phase).toBe("build");
    expect(started(r)).toBe(1);
  });
  it("with an exam in 2 weeks, half of them this week", () => {
    const r = plan({ settings: { examDate: "2026-11-15", weeklyMinutes: 600, daysPerWeek: 6 }, unstarted: sections });
    expect(r.phase).toBe("consolidate");
    expect(started(r)).toBe(4);
  });
  it("with no date the spread is over four weeks", () => {
    expect(started(plan({ unstarted: sections }))).toBe(2);
  });
  it("urgent items never push new ground out of the week entirely", () => {
    const weak = ["A", "B", "C", "D", "E", "F"].map(t => entry(t, "needs_work"));
    expect(started(plan({ entries: weak, unstarted: sections }))).toBeGreaterThanOrEqual(1);
  });
  it("tells the learner how many remain and how they are spread", () => {
    expect(plan({ settings: { examDate: "2026-12-28" }, unstarted: sections }).notes.join(" ")).toMatch(/8 sections.*no practice yet.*each week over the 8 weeks/);
  });
});

describe("study plan: phases", () => {
  it("no date: a rolling plan", () => {
    const r = plan();
    expect(r.phase).toBe("no_date");
    expect(r.daysLeft).toBeNull();
    expect(r.summary).toMatch(/Rolling weekly plan/);
  });
  it("phase follows the days left: build over 21, consolidate 8 to 21, final week 7 or fewer", () => {
    expect(plan({ settings: { examDate: "2026-11-24" } }).phase).toBe("build");     // 22
    expect(plan({ settings: { examDate: "2026-11-23" } }).phase).toBe("consolidate"); // 21
    expect(plan({ settings: { examDate: "2026-11-10" } }).phase).toBe("consolidate"); // 8
    expect(plan({ settings: { examDate: "2026-11-09" } }).phase).toBe("final_week");  // 7
    expect(plan({ settings: { examDate: "2026-11-09" } }).daysLeft).toBe(7);
  });
  it("a date that has passed is a rolling plan with a note, not a negative count", () => {
    const r = plan({ settings: { examDate: "2026-10-01" } });
    expect(r.phase).toBe("no_date");
    expect(r.examPassed).toBe(true);
    expect(r.daysLeft).toBeNull();
    expect(r.notes.join(" ")).toMatch(/has passed/);
  });
  it("final week: mixed practice, weak-topic review and exactly one evaluate activity, all before the exam", () => {
    const r = plan({
      settings: { examDate: "2026-11-08", examLabel: "NCK licensing", weeklyMinutes: 300, daysPerWeek: 5 },
      entries: [entry("Renal", "needs_work"), entry("Cardiac", "developing"), entry("Skin", "secure")],
      unstarted: [section(1)],
    });
    expect(r.phase).toBe("final_week");
    const acts = all(r);
    expect(acts.filter(a => a.space === "evaluate")).toHaveLength(1);
    expect(acts.find(a => a.space === "evaluate")!.title).toMatch(/NCK licensing/);
    expect(acts.some(a => a.title === "Mixed practice across your topics")).toBe(true);
    expect(acts.some(a => a.title === "Review Renal")).toBe(true);
    expect(acts.some(a => a.space === "learn")).toBe(false);
    expect(Math.max(...r.thisWeek.map(d => d.day.localeCompare("2026-11-08")))).toBeLessThan(0);
    expect(r.thisWeek.length).toBeLessThanOrEqual(6);
  });
  it("final week, reviews the weakest topic first and leaves out topics that are going well", () => {
    const r = plan({
      settings: { examDate: "2026-11-06", weeklyMinutes: 400, daysPerWeek: 4 },
      entries: [entry("Cardiac", "developing"), entry("Renal", "needs_work"), entry("Skin", "secure")],
    });
    const reviews = titles(r).filter(t => t.startsWith("Review ") && t !== "Review your due cards");
    expect(reviews[0]).toBe("Review Renal");
    expect(reviews).not.toContain("Review Skin");
  });
  it("the exam is today: nothing to plan, and said so", () => {
    const r = plan({ settings: { examDate: TODAY, examLabel: "OSCE" } });
    expect(r.thisWeek).toEqual([]);
    expect(r.summary).toMatch(/OSCE is today/);
  });
  it("the exam is tomorrow: one study day today", () => {
    const r = plan({ settings: { examDate: "2026-11-03" } });
    expect(r.thisWeek.map(d => d.day)).toEqual([TODAY]);
  });
  it("consolidate checks and applies before it starts new ground", () => {
    const r = plan({
      settings: { examDate: "2026-11-15", weeklyMinutes: 600, daysPerWeek: 6 },
      entries: [entry("Cardiac", "developing", { highestLevel: "recall" }), entry("Renal", "needs_work")],
      unstarted: [section(1), section(2)],
    });
    const t = titles(r);
    expect(t.indexOf("Use Cardiac in a scenario")).toBeLessThan(t.indexOf("Start on Section 1"));
  });
});

describe("study plan: the words", () => {
  it("the summary names the exam, the days left, the load and the goal", () => {
    const r = plan({ settings: { examDate: "2026-12-28", examLabel: "Midwifery finals", goal: "Pass first time", weeklyMinutes: 250, daysPerWeek: 5 } });
    expect(r.summary).toMatch(/56 days until Midwifery finals/);
    expect(r.summary).toMatch(/5 study days in the next seven days, about 50 minutes each \(250 minutes in all\)/);
    expect(r.summary).toMatch(/Your goal: Pass first time/);
  });
  it("never calls a plan an assessment or a measure of competence", () => {
    const r = plan({ settings: { examDate: "2026-11-08" }, entries: [entry("Renal", "needs_work")] });
    const text = JSON.stringify(r).toLowerCase();
    expect(text).not.toMatch(/competent|you are ready|you will pass|mastery|mastered/);
  });
});

describe("unstartedMappedSections", () => {
  const c = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;
  const comps = [{ id: "k1", title: "Wound care" }, { id: "k2", title: "Pain" }];
  const mappings = [
    { chunkId: c(1), competencyId: "k1", state: "accepted" }, { chunkId: c(2), competencyId: "k1", state: "accepted" },
    { chunkId: c(3), competencyId: "k2", state: "accepted" }, { chunkId: c(4), competencyId: "k2", state: "proposed" },
    { chunkId: c(5), competencyId: "gone", state: "accepted" },
  ];
  it("lists accepted sections of programme competencies with no answered question, the competency with most first, then by title", () => {
    const r = unstartedMappedSections({
      mappings, concepts: new Map([[c(1), ["Dressings"]], [c(3), [" "]]]), competencies: comps,
      questions: [{ id: "q2", chunkId: c(2) }], attempts: [{ questionId: "q2" }],
    });
    expect(r.map(x => x.chunkId)).toEqual([c(3), c(1)]);
    expect(r[1]).toEqual({ chunkId: c(1), label: "Dressings", competencyTitle: "Wound care" });
    expect(r[0].label).toBe("a section of your notes");
  });
  it("a question that was never answered does not count as practice", () => {
    const r = unstartedMappedSections({ mappings, concepts: new Map(), competencies: comps, questions: [{ id: "q1", chunkId: c(1) }], attempts: [] });
    expect(r.map(x => x.chunkId)).toContain(c(1));
  });
});
