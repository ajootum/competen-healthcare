import { describe, expect, it } from "vitest";
import { buildStudyPlan, refKey, PLAN_REF, type StudyPlanInput, type StudyPlanSettings, type UnstartedSection } from "./study-plan";
import { buildCalendar, planKey, type CalendarEntryRow, type CalendarInput } from "./study-calendar";
import type { MasteryEntry } from "./mastery";
import { examOffers, planCalendarFrom } from "./plan-calendar";
import { acceptedMaterialIds, acceptedUnstarted, buildProposal, dedupeTopics, postponedTopics, proposalDecisions, topicKey, type MaterialIn } from "./plan-proposal";
import { chooseToday, candidatesByRule, type RecommendInput } from "./plan-recommend";
import { buildInsights } from "./plan-insights";
import { detectCarryOvers } from "./plan-carry";
import { cleanPlanSettings, increaseNeedsConfirmation, sessionMinutesOf, settingsDiff, settingsFromRow } from "./plan-settings";
import { cleanReflection, isoWeek, reflectionOffer } from "./plan-reflection";
import { expandEntry } from "../learning-plan/recurrence";
import type { CalendarEntry, Occurrence, PlanEvent } from "../learning-plan/types";

const TODAY = "2026-11-02";   // a Monday
const MAT = "11111111-1111-4111-8111-111111111111";
const entry = (label: string, status: MasteryEntry["status"], o: Partial<MasteryEntry> = {}): MasteryEntry => ({
  kind: "topic", key: label.toLowerCase(), label, materialId: MAT, chunkId: null, topicSource: "topic", status,
  attempts: status === "not_started" ? 0 : 6, recentAccuracy: status === "not_started" ? null : status === "needs_work" ? 40 : status === "developing" ? 65 : 90,
  byLevel: [], highestLevel: null, byMarking: { code: 0, ai_evaluation: 0, self: 0 }, weakConcepts: [], last: { n: 0, wrong: 0 }, lastAt: null, basis: "", ...o,
});
const settings = (o: Partial<StudyPlanSettings> = {}): StudyPlanSettings => ({ examDate: null, examLabel: null, weeklyMinutes: 250, daysPerWeek: 5, goal: null, priorities: [], ...o });
const plan = (o: Partial<StudyPlanInput> & { settings?: Partial<StudyPlanSettings> } = {}) =>
  buildStudyPlan({ plan: settings(o.settings), entries: [], dueCards: 0, unstarted: [], today: TODAY, ...o });
const acts = (r: ReturnType<typeof plan>) => r.thisWeek.flatMap(d => d.activities);
const occ = (o: Partial<Occurrence>): Occurrence => ({
  key: "e1@2026-11-03", entryId: "e1", experience: "scholar", entryType: "busy", title: "Away", description: null, date: "2026-11-03", occurrenceDate: "2026-11-03", startTime: null, endTime: null,
  allDay: true, durationMinutes: null, link: null, status: "planned", selfReported: false, moved: false, edited: false, recurring: false, ...o,
});

describe("stable activity refs", () => {
  it("every activity has a ref of the form space:key that matches the calendar rule, and a title change does not change it", () => {
    const r = plan({ entries: [entry("Renal", "needs_work"), entry("Cardiac", "developing")], dueCards: 3, unstarted: [{ chunkId: "00000000-0000-4000-8000-000000000001", label: "Wounds" }] });
    for (const a of acts(r)) expect(`${a.ref}|0`).toMatch(/^(learn|revise|apply|evaluate):[a-z0-9-]{1,80}\|[0-9]{1,3}$/);
    const renal = acts(r).find(a => a.title === "Learn Renal")!;
    expect(renal.ref).toBe(`learn:${refKey("renal")}`);
    expect(PLAN_REF.test(renal.ref)).toBe(true);
    // the same topic under different wording of the surrounding text keeps its ref
    const again = plan({ entries: [entry("Renal", "needs_work", { recentAccuracy: 20, attempts: 9 })] });
    expect(acts(again).find(a => a.title === "Learn Renal")!.ref).toBe(renal.ref);
  });
  it("the due-card activity, mixed practice, a section and the evaluation have their fixed refs", () => {
    const r = plan({ dueCards: 4, unstarted: [{ chunkId: "00000000-0000-4000-8000-000000000001", label: "Wounds" }] });
    expect(acts(r).find(a => a.title === "Review your due cards")?.ref).toBe("revise:due");
    expect(acts(r).some(a => a.ref === "revise:mixed")).toBe(true);
    expect(acts(r).find(a => a.title === "Start on Wounds")?.ref).toBe("learn:00000000-0000-4000-8000-000000000001");
    const fw = plan({ settings: { examDate: "2026-11-06", daysPerWeek: 7, weeklyMinutes: 700 } });
    expect(acts(fw).find(a => a.space === "evaluate")?.ref).toBe("evaluate:eval");
  });
  it("refKey is a short a-z0-9- key that differs for different words", () => {
    expect(refKey("Acute Kidney Injury (AKI)")).toMatch(/^[a-z0-9-]{1,60}$/);
    expect(refKey("Renal")).not.toBe(refKey("Renal!!x"));
    expect(refKey("x".repeat(400)).length).toBeLessThanOrEqual(60);
  });
});

describe("the plan reads the learner's own calendar", () => {
  const base = { settings: { weeklyMinutes: 150, daysPerWeek: 3 }, entries: [entry("Renal", "needs_work"), entry("Cardiac", "needs_work")] };
  it("an all-day busy day plans nothing, and the week's minutes are shared across the days left, never above the agreed time", () => {
    const free = plan(base);
    const days = free.thisWeek.map(d => d.day);
    expect(days).toEqual(["2026-11-02", "2026-11-04", "2026-11-06"]);
    const busy = plan({ ...base, calendar: planCalendarFrom([occ({ date: "2026-11-04" })]) });
    expect(busy.thisWeek.map(d => d.day)).not.toContain("2026-11-04");
    expect(busy.thisWeek.length).toBe(3);   // three study days are still available among the other six
    const heavy = plan({ ...base, settings: { weeklyMinutes: 150, daysPerWeek: 3 }, calendar: planCalendarFrom([2, 3, 4, 5, 6].map(n => occ({ date: `2026-11-0${n}`, key: `e${n}@x` }))) });
    expect(heavy.thisWeek.length).toBe(2);   // only 2 free days (Mon 2 and Sun 8): minutes shared
    expect(heavy.thisWeek.reduce((n, d) => n + d.minutes, 0)).toBeLessThanOrEqual(150);
    expect(heavy.notes.join(" ")).toMatch(/shared across/);
    expect(heavy.notes.join(" ")).toMatch(/Nothing is planned on/);
  });
  it("a timed placement leaves the day open and the day's activities carry a note", () => {
    const r = plan({ ...base, calendar: planCalendarFrom([occ({ date: "2026-11-04", allDay: false, startTime: "14:00", endTime: "18:00", entryType: "placement", title: "Ward" })]) });
    const wed = r.thisWeek.find(d => d.day === "2026-11-04")!;
    expect(wed).toBeTruthy();
    expect(wed.activities.every(a => a.note === "around your 14:00–18:00 placement")).toBe(true);
    expect(r.thisWeek.find(d => d.day === "2026-11-02")!.activities.some(a => a.note)).toBe(false);
  });
  it("a personal study session takes its minutes off that day, and its topic is not planned the same day", () => {
    const sess = occ({ date: "2026-11-02", entryType: "study_session", allDay: false, startTime: "09:00", endTime: "10:00", durationMinutes: 20, link: { kind: "topic", id: "renal", label: "Renal" } });
    const r = plan({ ...base, calendar: planCalendarFrom([sess]) });
    const mon = r.thisWeek.find(d => d.day === "2026-11-02")!;
    expect(mon.minutes).toBe(30);                                   // 50-minute sessions less 20 minutes of the learner's own
    expect(mon.activities.some(a => /Renal/.test(a.title))).toBe(false);
    expect(acts(r).some(a => /Renal/.test(a.title))).toBe(true);    // it is planned on another day
    const covered = plan({ ...base, calendar: planCalendarFrom([occ({ ...sess, durationMinutes: 90 })]) });
    expect(covered.thisWeek.find(d => d.day === "2026-11-02")).toBeUndefined();
    expect(covered.notes.join(" ")).toMatch(/cover/);
  });
  it("busy, exam, deadline and other entries never reduce or add study minutes by themselves, and planned time is not study", () => {
    const cal = planCalendarFrom([occ({ date: "2026-11-02", allDay: false, startTime: "09:00", entryType: "exam" }), occ({ date: "2026-11-02", entryType: "deadline" }), occ({ date: "2026-11-02", entryType: "other" })]);
    expect(cal.blockedDays).toEqual([]);
    expect(cal.personalMinutes).toEqual({});
  });
  it("a cancelled entry is ignored", () => {
    expect(planCalendarFrom([occ({ status: "cancelled" })]).blockedDays).toEqual([]);
  });
  it("without a calendar, postponed topics or exclusions the plan is exactly what it was", () => {
    const a = plan(base), b = plan({ ...base, calendar: null, postponed: new Set(), excludeRefs: new Set() });
    expect(b).toEqual(a);
  });
  it("a postponed topic and an excluded ref are left out of the plan", () => {
    const r = plan({ ...base, postponed: new Set([topicKey("Renal")]) });
    expect(acts(r).some(a => /Renal/.test(a.title))).toBe(false);
    expect(acts(r).some(a => /Cardiac/.test(a.title))).toBe(true);
    const x = plan({ ...base, excludeRefs: new Set([`learn:${refKey("cardiac")}`]) });
    expect(acts(x).some(a => a.title === "Learn Cardiac")).toBe(false);
  });
  it("offers an exam entry as the plan's exam date, and never applies it", () => {
    const o = examOffers([occ({ date: "2026-12-01", entryType: "exam", title: "Final OSCE" }), occ({ key: "p", date: "2026-10-01", entryType: "exam" }), occ({ key: "q", date: "2026-12-02", entryType: "exam", status: "cancelled" })], { examDate: null, goalType: null }, TODAY);
    expect(o).toHaveLength(1);
    expect(o[0]).toMatchObject({ date: "2026-12-01", goalType: "exam", applied: false });
    expect(examOffers([occ({ date: "2026-12-01", entryType: "exam" })], { examDate: "2026-12-01", goalType: "exam" }, TODAY)[0].applied).toBe(true);
  });
});

describe("the calendar: stable keys and old title-keyed moves", () => {
  const input = (o: Partial<CalendarInput> = {}): CalendarInput => ({
    month: "2026-11", today: TODAY,
    plan: { settings: settings({ daysPerWeek: 3, weeklyMinutes: 150 }), entries: [entry("Renal", "needs_work"), entry("Cardiac", "needs_work")], unstarted: [] },
    dueByDate: {}, completed: [], entries: [], canMove: true, flashcardsHref: "/cards",
    review: { recommendDays: 5, reminders: true, optedOut: false, hasActivity: false, taken: null, startHref: "/eval" }, ...o,
  });
  const planned = (v: ReturnType<typeof buildCalendar>) => v.days.flatMap(d => d.items).filter(i => i.kind === "planned");

  it("new moves are keyed ref|nth and re-keyed by a stable ref, not by wording", () => {
    const v = buildCalendar(input());
    const first = planned(v)[0];
    expect(first.entry!.ref).toMatch(/^(learn|revise|apply):[a-z0-9-]+\|[0-9]+$/);
    const e: CalendarEntryRow = { kind: "plan_activity", ref: first.entry!.ref, originalDate: first.entry!.originalDate, scheduledDate: "2026-11-20" };
    const moved = buildCalendar(input({ entries: [e] }));
    expect(moved.days.find(d => d.date === first.entry!.originalDate)!.items.some(i => i.key === first.key)).toBe(false);
    expect(moved.days.find(d => d.date === "2026-11-20")!.items.some(i => i.key === first.key && i.movedFrom === first.entry!.originalDate)).toBe(true);
    expect(moved.unattached).toEqual([]);
  });
  it("an old-format move that matches exactly one activity on its original date is re-keyed", () => {
    const first = planned(buildCalendar(input()))[0];
    const legacy = planKey(first.space!, first.title, 0);
    const moved = buildCalendar(input({ entries: [{ kind: "plan_activity", ref: legacy, originalDate: first.entry!.originalDate, scheduledDate: "2026-11-20" }] }));
    expect(moved.days.find(d => d.date === "2026-11-20")!.items.some(i => i.key === first.key)).toBe(true);
    expect(moved.unattached).toEqual([]);
  });
  it("an old-format move whose original date does not match, or that names nothing in the run, is left unattached and applied to nothing", () => {
    const first = planned(buildCalendar(input()))[0];
    const wrongDay = buildCalendar(input({ entries: [{ kind: "plan_activity", ref: planKey(first.space!, first.title, 0), originalDate: "2026-11-30", scheduledDate: "2026-11-20" }] }));
    expect(wrongDay.unattached).toHaveLength(1);
    expect(wrongDay.days.find(d => d.date === "2026-11-20")!.items.some(i => i.kind === "planned" && i.key === first.key)).toBe(false);
    expect(wrongDay.notes.join(" ")).toMatch(/earlier move could not be matched/i);
    const gone = buildCalendar(input({ entries: [{ kind: "plan_activity", ref: "learn|nothing-like-it|0", originalDate: first.entry!.originalDate, scheduledDate: "2026-11-20" }] }));
    expect(gone.unattached.map(u => u.ref)).toEqual(["learn|nothing-like-it|0"]);
    expect(planned(gone)).toEqual(planned(buildCalendar(input())));
  });
  it("an old-format move is unattached when there is no plan at all", () => {
    const v = buildCalendar(input({ plan: null, entries: [{ kind: "plan_activity", ref: "learn|x|0", originalDate: TODAY, scheduledDate: "2026-11-05" }] }));
    expect(v.unattached).toHaveLength(1);
  });
  it("a legacy key is unique to one activity of the run, so a match is never a guess: a shifted nth on the same date is still the one activity or none", () => {
    const v = planned(buildCalendar(input({ plan: { settings: settings({ daysPerWeek: 1, weeklyMinutes: 150 }), entries: [], unstarted: [] } })));
    const sameDay = v.filter(i => i.entry!.originalDate === TODAY);
    const legacy = sameDay.map(i => planKey(i.space!, i.title, 0));
    expect(sameDay.length).toBeGreaterThan(1);
    // two mixed-practice slots on one day have the legacy nths 0 and 1: a move saved as nth 1 attaches to the second only
    const second = buildCalendar(input({
      plan: { settings: settings({ daysPerWeek: 1, weeklyMinutes: 150 }), entries: [], unstarted: [] },
      entries: [{ kind: "plan_activity", ref: planKey(sameDay[1].space!, sameDay[1].title, 1), originalDate: TODAY, scheduledDate: "2026-11-20" }],
    }));
    expect(second.unattached).toEqual([]);
    expect(second.days.find(d => d.date === "2026-11-20")!.items.filter(i => i.kind === "planned")).toHaveLength(1);
    expect(legacy.length).toBe(sameDay.length);
  });
  it("the learner's own entries appear as their own kind, with the occurrence, and a plan key can never equal an entry key", () => {
    const e: CalendarEntry = {
      id: "11111111-1111-4111-8111-111111111111", experience: "scholar", entryType: "study_session", title: "My own session", description: null, entryDate: "2026-11-10", startTime: "09:00", endTime: "09:30",
      durationMinutes: null, link: null, recurrence: null, status: "planned", completedAt: null, createdAt: "", updatedAt: "",
    };
    const personal = expandEntry(e, [], "2026-11-01", "2026-11-30");
    const v = buildCalendar(input({ personal }));
    const mine = v.days.flatMap(d => d.items).filter(i => i.kind === "personal");
    expect(mine).toHaveLength(1);
    expect(mine[0].occurrence?.entryId).toBe(e.id);
    expect(mine[0].detail).toMatch(/Planned by you/);
    const keys = v.days.flatMap(d => d.items.map(i => i.key));
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.filter(k => k.startsWith("plan:")).every(k => !k.includes("@"))).toBe(true);
    const done = buildCalendar(input({ personal: expandEntry({ ...e, status: "completed" }, [], "2026-11-01", "2026-11-30") }));
    expect(done.days.flatMap(d => d.items).find(i => i.kind === "personal")!.detail).toMatch(/self-reported/);
  });
});

// ── the proposal ──
const mat = (id: string, title: string, sections: [string, string[], boolean?][]): MaterialIn => ({ materialId: id, title, sections: sections.map(([chunkId, topics, started], i) => ({ chunkId, ordinal: i + 1, topics, started })) });

describe("the plan proposal", () => {
  const A = mat("mat-a", "Renal notes", [["a1", ["Acute kidney injury"]], ["a2", ["Fluid balance"]], ["a3", ["Dialysis"]]]);
  const B = mat("mat-b", "Medicine notes", [["b1", ["acute  kidney injury!"]], ["b2", ["Heart failure"]], ["b3", []]]);

  it("dedupes topics across materials by normalised label and keeps every source material", () => {
    const t = dedupeTopics([A, B]);
    expect(t.map(x => x.label)).toEqual(["Acute kidney injury", "Fluid balance", "Dialysis", "Heart failure"]);
    const aki = t[0];
    expect(aki.materialIds).toEqual(["mat-a", "mat-b"]);
    expect(aki.sections).toBe(2);
    expect(topicKey("Acute  Kidney Injury!")).toBe(topicKey("acute kidney injury"));
  });
  it("proposes the sequence in section order, an estimate of sections x minutes, sessions, and revision points at +1, +3 and +7 days", () => {
    const p = buildProposal({ material: A, earlier: [], settings: { sessionMinutes: 30, daysPerWeek: 3 }, sectionMinutes: 12, firstPlan: true });
    expect(p.sequence.map(s => s.label)).toEqual(["Acute kidney injury", "Fluid balance", "Dialysis"]);
    expect(p.workloadMinutes).toBe(36);
    expect(p.sessions).toMatchObject({ sessionMinutes: 30, daysPerWeek: 3, sessionsNeeded: 2, weeksNeeded: 1, usingDefaults: false });
    expect(p.revisionPoints.map(r => r.afterDays)).toEqual([1, 3, 7]);
    expect(p.firstPlan).toBe(true);
  });
  it("uses the starting plan (30 minutes x 5 days) when there are no settings, and says so", () => {
    const p = buildProposal({ material: A, earlier: [], settings: null, sectionMinutes: 12, firstPlan: true });
    expect(p.sessions).toMatchObject({ sessionMinutes: 30, daysPerWeek: 5, usingDefaults: true });
    expect(p.summary).toMatch(/starting suggestion/);
  });
  it("a topic an earlier accepted material already covers is listed as covered and not counted twice", () => {
    const p = buildProposal({ material: B, earlier: [A], settings: null, sectionMinutes: 12, firstPlan: false });
    const aki = p.sequence.find(s => s.chunkId === "b1")!;
    expect(aki.coveredIn).toEqual(["Renal notes"]);
    expect(aki.minutes).toBe(0);
    expect(p.newSections).toBe(2);            // Heart failure and "Section 3"
    expect(p.workloadMinutes).toBe(24);
    expect(p.firstPlan).toBe(false);
  });
  it("a material with nothing new, or no sections, says so", () => {
    expect(buildProposal({ material: mat("c", "Copy", [["c1", ["Dialysis"]]]), earlier: [A], settings: null, sectionMinutes: 12, firstPlan: false }).summary).toMatch(/already covers/);
    expect(buildProposal({ material: mat("d", "Empty", []), earlier: [], settings: null, sectionMinutes: 12, firstPlan: true }).summary).toMatch(/no sections/);
  });
  it("accepted materials feed the plan's unstarted sections in order, a repeated topic once, with every source kept", () => {
    const u = acceptedUnstarted([A, B], []);
    expect(u.map(s => s.label)).toEqual(["Acute kidney injury", "Fluid balance", "Dialysis", "Heart failure", "Section 3"]);
    expect(u[0].materialIds).toEqual(["mat-a", "mat-b"]);
  });
  it("sections already practised, and sections the programme mapping lists, are not added again", () => {
    const started = mat("mat-a", "Renal notes", [["a1", ["Acute kidney injury"], true], ["a2", ["Fluid balance"]]]);
    const mapped: UnstartedSection[] = [{ chunkId: "a2", label: "Fluid balance", competencyTitle: "Renal" }];
    const u = acceptedUnstarted([started], mapped);
    expect(u).toHaveLength(1);
    expect(u[0].competencyTitle).toBe("Renal");
  });
  it("only an accepted proposal feeds the plan; the latest answer wins; a declined or deferred one does not", () => {
    const ev = (ref: string, status: PlanEvent["status"], at: string): PlanEvent => ({ id: ref + at, experience: "scholar", kind: "proposal", ref, status, value: {}, createdAt: at });
    const events = [ev("m1", "accepted", "2026-11-01T10:00:00Z"), ev("m2", "declined", "2026-11-01T11:00:00Z"), ev("m3", "accepted", "2026-11-01T12:00:00Z"), ev("m3", "deferred", "2026-11-01T13:00:00Z"), ev("m4", "accepted", "2026-11-01T09:00:00Z")];
    expect(acceptedMaterialIds(events)).toEqual(["m4", "m1"]);
    expect(proposalDecisions(events).get("m3")).toBe("deferred");
  });
  it("postponed topics are excluded until the chosen date, then come back", () => {
    const ev: PlanEvent = { id: "1", experience: "scholar", kind: "topic_postponed", ref: topicKey("Renal"), status: "deferred", value: { until: "2026-11-05", label: "Renal" }, createdAt: "2026-11-02T00:00:00Z" };
    expect(postponedTopics([ev], "2026-11-02").has(topicKey("Renal"))).toBe(true);
    expect(postponedTopics([ev], "2026-11-04").has(topicKey("Renal"))).toBe(true);
    expect(postponedTopics([ev], "2026-11-05").has(topicKey("Renal"))).toBe(false);
  });
});

// ── the recommendation engine ──
const rec = (o: Partial<RecommendInput> = {}): RecommendInput => ({
  today: TODAY, ruleOrder: ["due_revision", "gaps", "unfinished", "exam", "deadline", "consolidate", "coverage"], settings: null, plan: null,
  entries: [], dueCards: 0, unfinished: [], monthlyWeak: null, coverage: [], calendar: [], events: [], postponed: new Set(), fallbackMinutes: 25, ...o,
});
const declineEvent = (ref: string, fingerprint: string): PlanEvent => ({ id: ref, experience: "scholar", kind: "recommendation_declined", ref, status: "declined", value: { fingerprint }, createdAt: "2026-11-02T08:00:00Z" });

describe("the next-activity engine", () => {
  const input = rec({
    dueCards: 7, entries: [entry("Renal", "needs_work"), entry("Cardiac", "developing", { lastAt: "2026-11-01T10:00:00Z" })],
    unfinished: [{ id: "learn-s1", title: "Wound care", kind: "lesson", lastAt: "2026-10-31T10:00:00Z", href: "/l" }],
    coverage: [{ chunkId: "00000000-0000-4000-8000-000000000009", label: "Sepsis", materialIds: ["mat-a"] }],
  });
  it("puts the rules in the policy order and gives one next activity and two alternatives, each with why / why now / if postponed", () => {
    const c = chooseToday(input);
    expect(c.next?.rule).toBe("due_revision");
    expect(c.alternatives.map(a => a.rule)).toEqual(["gaps", "unfinished"]);
    for (const x of [c.next!, ...c.alternatives]) { expect(x.why.length).toBeGreaterThan(10); expect(x.whyNow.length).toBeGreaterThan(5); expect(x.ifPostponed.length).toBeGreaterThan(5); expect(x.experience).toBe("scholar"); }
    expect(c.next!.why).toMatch(/7 cards have reached their review date/);
    expect(c.alternatives[0].why).toMatch(/40% over 6 answers/);
  });
  it("a different configured order gives a different first activity; rules left out are not used", () => {
    expect(chooseToday({ ...input, ruleOrder: ["gaps", "due_revision"] }).next?.rule).toBe("gaps");
    expect(chooseToday({ ...input, ruleOrder: ["coverage", "gaps"] }).next?.rule).toBe("coverage");
    const only = chooseToday({ ...input, ruleOrder: ["gaps"] });
    expect(only.next?.rule).toBe("gaps");
    expect([only.next, ...only.alternatives].some(x => x?.rule === "due_revision")).toBe(false);
    expect(chooseToday({ ...input, ruleOrder: [] }).next).toBeNull();
  });
  it("is deterministic", () => {
    expect(chooseToday(input)).toEqual(chooseToday(input));
  });
  it("does not offer a declined suggestion again while its evidence is unchanged, and offers it again when the evidence changes", () => {
    const due = candidatesByRule(input).due_revision[0];
    const declined = chooseToday({ ...input, events: [declineEvent(due.ref, due.fingerprint)] });
    expect(declined.next?.rule).toBe("gaps");
    expect(declined.declined).toBe(1);
    const changed = chooseToday({ ...input, dueCards: 9, events: [declineEvent(due.ref, due.fingerprint)] });
    expect(changed.next?.rule).toBe("due_revision");
    expect(changed.next!.why).toMatch(/9 cards/);
  });
  it("a declined gap returns when the learner's accuracy on that topic changes", () => {
    const gap = candidatesByRule(input).gaps[0];
    const same = chooseToday({ ...input, dueCards: 0, events: [declineEvent(gap.ref, gap.fingerprint)] });
    expect(same.next?.rule).toBe("unfinished");
    const after = chooseToday({ ...input, dueCards: 0, entries: [entry("Renal", "needs_work", { recentAccuracy: 35, attempts: 9 }), entry("Cardiac", "developing")], events: [declineEvent(gap.ref, gap.fingerprint)] });
    expect(after.next?.rule).toBe("gaps");
  });
  it("leaves out a postponed topic", () => {
    const c = chooseToday({ ...input, dueCards: 0, postponed: new Set([topicKey("Renal")]) });
    expect(c.next?.rule).not.toBe("gaps");
  });
  it("uses the monthly review's weak topics, consolidation of a topic practised yesterday, and the exam", () => {
    const m = candidatesByRule(rec({ monthlyWeak: { month: "2026-10", topics: ["Sepsis"] } }));
    expect(m.gaps[0].why).toMatch(/monthly review for 2026-10/);
    const c = candidatesByRule(input).consolidate;
    expect(c.map(x => x.title)).toEqual(["Revise Cardiac"]);
    expect(c[0].why).toMatch(/yesterday/);
    const exam = candidatesByRule(rec({
      settings: { goalType: "exam", sessionMinutes: 30, daysPerWeek: 3, weeklyMinutes: 90, examDate: "2026-11-12", examLabel: "OSCE", goal: null, priorities: [] },
      plan: buildStudyPlan({ plan: settings({ examDate: "2026-11-12", examLabel: "OSCE" }), entries: [entry("Renal", "needs_work")], dueCards: 0, unstarted: [], today: TODAY }),
      entries: [entry("Renal", "needs_work")],
    })).exam;
    expect(exam[0].why).toMatch(/10 days until OSCE/);
    expect(exam[0].ifPostponed).toMatch(/9 days/);
  });
  it("a deadline within 14 days linked to a topic or material is a candidate placed by the policy order, before coverage by default", () => {
    const dl = occ({ key: "d1@2026-11-10", entryType: "deadline", title: "Essay", date: "2026-11-10", link: { kind: "topic", id: "sepsis", label: "Sepsis" } });
    const far = occ({ key: "d2@2026-12-30", entryType: "deadline", title: "Far", date: "2026-12-30", link: { kind: "topic", id: "x", label: "X" } });
    const unlinked = occ({ key: "d3@2026-11-09", entryType: "deadline", title: "Unlinked", date: "2026-11-09" });
    const c = chooseToday(rec({ calendar: [dl, far, unlinked], coverage: [{ chunkId: "00000000-0000-4000-8000-000000000009", label: "Sepsis", materialIds: ["m"] }] }));
    expect(c.next?.rule).toBe("deadline");
    expect(c.next!.why).toMatch(/Essay.*2026-11-10.*Sepsis/);
    expect(c.next!.whyNow).toBe("8 days left.");
    expect(c.next!.ifPostponed).toMatch(/7 days/);
    expect(c.alternatives[0].rule).toBe("coverage");
    expect(candidatesByRule(rec({ calendar: [far, unlinked] })).deadline).toEqual([]);
  });
  it("with nothing to suggest there is no next activity (never an invented one)", () => {
    expect(chooseToday(rec())).toEqual({ next: null, alternatives: [], declined: 0 });
  });
});

describe("routine carry-over with undo", () => {
  const sets = { examDate: null, examLabel: null, weeklyMinutes: 150, daysPerWeek: 7, goal: null, priorities: [] };
  const mk = (day: string, e: MasteryEntry[]) => buildStudyPlan({ plan: sets, entries: e, dueCards: 0, unstarted: [], today: day });
  const entries = [entry("Renal", "needs_work")];
  const ev = (ref: string, status: PlanEvent["status"], at = "2026-11-02T08:00:00Z"): PlanEvent => ({ id: ref + status, experience: "scholar", kind: "auto_adjust", ref, status, value: {}, createdAt: at });

  it("an activity planned yesterday that is still in today's plan is a carry-over, with its event ref and undo token", () => {
    const past = mk("2026-11-01", entries), current = mk(TODAY, entries);
    const r = detectCarryOvers({ past, current, yesterday: "2026-11-01", events: [] });
    const renal = r.carried.find(c => c.title === "Learn Renal")!;
    expect(renal).toMatchObject({ key: `learn:${refKey("renal")}@2026-11-01`, from: "2026-11-01", recorded: false });
    expect(renal.reason).toMatch(/did not finish/);
    // due cards, mixed practice and the evaluation come back by design and are never carry-overs
    expect(r.carried.some(c => c.ref === "revise:mixed" || c.ref === "revise:due")).toBe(false);
  });
  it("is idempotent: an applied event on record marks it recorded, so it is not written again", () => {
    const past = mk("2026-11-01", entries), current = mk(TODAY, entries);
    const key = `learn:${refKey("renal")}@2026-11-01`;
    const r = detectCarryOvers({ past, current, yesterday: "2026-11-01", events: [ev(key, "applied")] });
    expect(r.carried.find(c => c.key === key)?.recorded).toBe(true);
  });
  it("an undone carry-over is not carried: it is Missed, not rescheduled, and its ref is excluded from the plan", () => {
    const past = mk("2026-11-01", entries), current = mk(TODAY, entries);
    const key = `learn:${refKey("renal")}@2026-11-01`;
    const r = detectCarryOvers({ past, current, yesterday: "2026-11-01", events: [ev(key, "applied", "2026-11-02T08:00:00Z"), ev(key, "undone", "2026-11-02T09:00:00Z")] });
    expect(r.carried.some(c => c.key === key)).toBe(false);
    expect(r.missed.map(m => m.key)).toEqual([key]);
    expect(r.excludeRefs).toEqual([`learn:${refKey("renal")}`]);
    const without = buildStudyPlan({ plan: sets, entries, dueCards: 0, unstarted: [], today: TODAY, excludeRefs: new Set(r.excludeRefs) });
    expect(without.thisWeek.flatMap(d => d.activities).some(a => a.title === "Learn Renal")).toBe(false);
  });
  it("nothing is carried when the activity is no longer needed today", () => {
    const past = mk("2026-11-01", entries), current = mk(TODAY, [entry("Renal", "secure")]);
    expect(detectCarryOvers({ past, current, yesterday: "2026-11-01", events: [] }).carried.some(c => c.title === "Learn Renal")).toBe(false);
  });
  it("with no plan yesterday there is nothing to carry", () => {
    expect(detectCarryOvers({ past: null, current: mk(TODAY, entries), yesterday: "2026-11-01", events: [] })).toEqual({ carried: [], missed: [], excludeRefs: [] });
  });
});

describe("insights: not measured is never zero", () => {
  const empty = { studyDays: [], today: TODAY, attempts: [], reviews: [], selfReported: null };
  it("with no evidence every measure is not measured, with a reason", () => {
    const i = buildInsights(empty);
    expect(i.consistency).toMatchObject({ state: "not_measured" });
    expect(i.practice).toMatchObject({ state: "not_measured" });
    expect(i.retention).toMatchObject({ state: "not_measured" });
    expect(JSON.stringify(i)).not.toMatch(/"percent":0|"studyDays":0|"rememberedPercent":0/);
    expect(i.recommendations).toEqual([]);
    expect(i.selfReported).toBeNull();
  });
  it("a learner who has studied before but not lately has a measured zero in the window (a real measurement), not a missing one", () => {
    const i = buildInsights({ ...empty, studyDays: ["2026-08-01"] });
    expect(i.consistency).toMatchObject({ state: "measured", studyDays: 0, activeWeeks: 0 });
    expect(i.recommendations.map(r => r.id)).toContain("restart");
  });
  it("consistency counts local study days of the last 28 and the active weeks of the last 4", () => {
    const i = buildInsights({ ...empty, studyDays: ["2026-10-10", "2026-10-30", "2026-11-01", "2026-11-02"] });
    expect(i.consistency).toMatchObject({ state: "measured", studyDays: 4, activeWeeks: 2, lastStudied: "2026-11-02" });
  });
  it("practice performance is over code-marked answers only; AI-evaluated and self-marked answers are not in it", () => {
    const att = (marking: string, correct: boolean, n: number) => ({ marking, correct, answeredAt: `2026-10-${String(10 + n).padStart(2, "0")}T10:00:00Z` });
    const only = buildInsights({ ...empty, attempts: [att("ai_evaluation", true, 1), att("self_graded", true, 2)] });
    expect(only.practice).toMatchObject({ state: "not_measured" });
    const mixed = buildInsights({ ...empty, attempts: [att("deterministic", true, 1), att("deterministic", false, 2), att("deterministic", true, 3), att("deterministic", true, 4), att("deterministic", false, 5), att("ai_evaluation", false, 6)] });
    expect(mixed.practice).toMatchObject({ state: "measured", percent: 60, answered: 5, lowEvidence: false });
    expect(buildInsights({ ...empty, attempts: [att("deterministic", false, 1)] }).practice).toMatchObject({ state: "measured", percent: 0, answered: 1, lowEvidence: true });
  });
  it("retention is the share of spaced reviews rated remembered in the last 90 days", () => {
    const rv = (q: number, d: string) => ({ quality: q, reviewedAt: `${d}T10:00:00Z` });
    const i = buildInsights({ ...empty, reviews: [rv(4, "2026-10-30"), rv(2, "2026-10-31"), rv(5, "2026-11-01"), rv(3, "2026-11-02"), rv(0, "2025-01-01")] });
    expect(i.retention).toMatchObject({ state: "measured", rememberedPercent: 75, reviews: 4 });
    expect(buildInsights({ ...empty, reviews: [rv(5, "2025-01-01")] }).retention).toMatchObject({ state: "not_measured" });
  });
  it("gives at most three deterministic recommendations, each with its basis, and labels self-reported study apart", () => {
    const att = (n: number) => ({ marking: "deterministic", correct: n === 0, answeredAt: `2026-10-${String(10 + n).padStart(2, "0")}T10:00:00Z` });
    const i = buildInsights({
      ...empty, studyDays: ["2026-10-20"], attempts: [0, 1, 2, 3, 4, 5].map(att),
      reviews: [0, 1, 2, 3, 4].map(n => ({ quality: 1, reviewedAt: `2026-10-2${n}T10:00:00Z` })),
      selfReported: { days: ["2026-11-01"], sessions: 2, minutes: 90 },
    });
    expect(i.recommendations.length).toBeLessThanOrEqual(3);
    expect(i.recommendations.every(r => r.basis.length > 0 && r.text.length > 0)).toBe(true);
    expect(i.selfReported).toMatchObject({ sessions: 2, minutes: 90 });
    expect(i.selfReported!.label).toMatch(/Self-reported/);
    expect(i).toEqual(buildInsights({ ...empty, studyDays: ["2026-10-20"], attempts: [0, 1, 2, 3, 4, 5].map(att), reviews: [0, 1, 2, 3, 4].map(n => ({ quality: 1, reviewedAt: `2026-10-2${n}T10:00:00Z` })), selfReported: { days: ["2026-11-01"], sessions: 2, minutes: 90 } }));
  });
  it("self-reported sessions never raise the consistency figure", () => {
    const a = buildInsights({ ...empty, studyDays: ["2026-11-01"] }), b = buildInsights({ ...empty, studyDays: ["2026-11-01"], selfReported: { days: ["2026-11-02", "2026-11-03"], sessions: 2, minutes: null } });
    expect(b.consistency).toEqual(a.consistency);
  });
});

describe("the simplified settings and the approval rule", () => {
  const ok = { goalType: "learn", sessionMinutes: 30, daysPerWeek: 4 };
  it("takes three answers and sets weekly minutes to session minutes x days", () => {
    const r = cleanPlanSettings(ok, TODAY);
    expect(r.ok && r.shape).toBe("new");
    expect(r.ok && r.value).toMatchObject({ goalType: "learn", sessionMinutes: 30, daysPerWeek: 4, weeklyMinutes: 120, examDate: null });
  });
  it("requires an exam date only for an exam, and drops one given for another aim", () => {
    expect(cleanPlanSettings({ ...ok, goalType: "exam" }, TODAY).ok).toBe(false);
    const e = cleanPlanSettings({ ...ok, goalType: "exam", examDate: "2026-12-10", examLabel: "OSCE" }, TODAY);
    expect(e.ok && e.value).toMatchObject({ goalType: "exam", examDate: "2026-12-10", examLabel: "OSCE" });
    const l = cleanPlanSettings({ ...ok, examDate: "2026-12-10" }, TODAY);
    expect(l.ok && l.value.examDate).toBeNull();
    expect(cleanPlanSettings({ ...ok, goalType: "exam", examDate: "2026-10-01" }, TODAY).ok).toBe(false);
  });
  it("checks the three answers and the advanced fields (priorities, goal text, patient identifiers)", () => {
    expect(cleanPlanSettings({ ...ok, goalType: "sprint" }, TODAY).ok).toBe(false);
    expect(cleanPlanSettings({ ...ok, sessionMinutes: 5 }, TODAY).ok).toBe(false);
    expect(cleanPlanSettings({ ...ok, sessionMinutes: 241 }, TODAY).ok).toBe(false);
    expect(cleanPlanSettings({ ...ok, daysPerWeek: 8 }, TODAY).ok).toBe(false);
    expect(cleanPlanSettings({ ...ok, sessionMinutes: 10, daysPerWeek: 2 }, TODAY).ok).toBe(false);   // 20 a week is under the 780 minimum of 30
    expect(cleanPlanSettings({ ...ok, priorities: ["Renal", "renal", "Cardiac"], goal: "Pass first time" }, TODAY)).toMatchObject({ ok: true, value: { priorities: ["Renal", "Cardiac"], goal: "Pass first time" } });
    const id = cleanPlanSettings({ ...ok, goal: "Understand why Mrs Jane Smith MRN 4455667 deteriorated" }, TODAY);
    expect(id.ok).toBe(false);
  });
  it("still accepts the old shape, with no goal type or session minutes", () => {
    const r = cleanPlanSettings({ weeklyMinutes: 200, daysPerWeek: 4, examDate: "2026-12-10" }, TODAY);
    expect(r).toMatchObject({ ok: true, shape: "old", value: { weeklyMinutes: 200, goalType: null, sessionMinutes: null, examDate: "2026-12-10" } });
    expect(cleanPlanSettings({}, TODAY).ok).toBe(false);
  });
  it("a workload increase beyond the maximum needs confirmation; a decrease, an increase within it, or an already-higher plan does not", () => {
    expect(increaseNeedsConfirmation({ weeklyMinutes: 300 }, { weeklyMinutes: 900 }, 600)).toMatchObject({ needsConfirmation: true, from: 300, to: 900, max: 600 });
    expect(increaseNeedsConfirmation(null, { weeklyMinutes: 700 }, 600).needsConfirmation).toBe(true);
    expect(increaseNeedsConfirmation({ weeklyMinutes: 300 }, { weeklyMinutes: 600 }, 600).needsConfirmation).toBe(false);
    expect(increaseNeedsConfirmation({ weeklyMinutes: 900 }, { weeklyMinutes: 900 }, 600).needsConfirmation).toBe(false);
    expect(increaseNeedsConfirmation({ weeklyMinutes: 900 }, { weeklyMinutes: 700 }, 600).needsConfirmation).toBe(false);
    expect(increaseNeedsConfirmation({ weeklyMinutes: 900 }, { weeklyMinutes: 1000 }, 600).needsConfirmation).toBe(true);
  });
  it("describes the change before and after for the settings-change record, and reads a stored row", () => {
    const row = settingsFromRow({ examDate: null, examLabel: null, weeklyMinutes: 90, daysPerWeek: 3, goal: null, priorities: [] });
    expect(row).toMatchObject({ goalType: null, sessionMinutes: null });
    expect(sessionMinutesOf(row)).toBe(30);
    const next = cleanPlanSettings({ goalType: "revise", sessionMinutes: 40, daysPerWeek: 3 }, TODAY);
    if (!next.ok) throw new Error("setup");
    const d = settingsDiff(row, next.value);
    expect(d.changed.sort()).toEqual(["goalType", "sessionMinutes", "weeklyMinutes"]);
    expect(d.before).toMatchObject({ weeklyMinutes: 90 });
    expect(d.after).toMatchObject({ weeklyMinutes: 120, goalType: "revise" });
    expect(settingsDiff(null, next.value).before).toBeNull();
  });
});

describe("the weekly reflection and its offer", () => {
  const cur = { sessionMinutes: 40, weeklyMinutes: 160, daysPerWeek: 4 };
  it("names the ISO week", () => {
    expect(isoWeek("2026-11-02")).toBe("2026-W45");
    expect(isoWeek("2026-01-01")).toBe("2026-W01");
    expect(isoWeek("2027-01-01")).toBe("2026-W53");
    expect(isoWeek("2026-12-28")).toBe("2026-W53");
  });
  it("validates the week, the answer and the note (500, no patient identifiers)", () => {
    expect(cleanReflection({ week: "2026-W45", workload: "manageable" }, "2026-W45")).toMatchObject({ ok: true, value: { note: null } });
    expect(cleanReflection({ week: "2026-W46", workload: "manageable" }, "2026-W45").ok).toBe(false);
    expect(cleanReflection({ week: "2026-W45", workload: "easy" }, "2026-W45").ok).toBe(false);
    expect(cleanReflection({ week: "2026-45", workload: "manageable" }, "2026-W45").ok).toBe(false);
    expect(cleanReflection({ week: "2026-W45", workload: "too_light", note: "x".repeat(501) }, "2026-W45").ok).toBe(false);
    expect(cleanReflection({ week: "2026-W45", workload: "too_light", note: "x".repeat(500) }, "2026-W45").ok).toBe(true);
    const id = cleanReflection({ week: "2026-W45", workload: "too_demanding", note: "Hard week after the shift with Mrs Jane Smith, MRN 4455667" }, "2026-W45");
    expect(id.ok).toBe(false);
  });
  it("too demanding offers shorter sessions, never applied", () => {
    const o = reflectionOffer("too_demanding", cur, 600)!;
    expect(o).toMatchObject({ kind: "session_minutes", currentSessionMinutes: 40, proposedSessionMinutes: 30, weeklyMinutesAfter: 120, applied: false });
    expect(o.message).toMatch(/Nothing changes unless you save it/);
  });
  it("too light offers longer sessions within the maximum, and nothing when already at the limit", () => {
    expect(reflectionOffer("too_light", cur, 600)).toMatchObject({ proposedSessionMinutes: 50, weeklyMinutesAfter: 200, applied: false });
    expect(reflectionOffer("too_light", cur, 170)).toBeNull();
    const capped = reflectionOffer("too_light", { sessionMinutes: 100, weeklyMinutes: 500, daysPerWeek: 5 }, 600);
    expect(capped?.proposedSessionMinutes).toBe(120);
    expect(capped!.weeklyMinutesAfter).toBeLessThanOrEqual(600);
    expect(reflectionOffer("too_light", { sessionMinutes: 120, weeklyMinutes: 600, daysPerWeek: 5 }, 600)).toBeNull();
  });
  it("manageable, no settings, or sessions already at the minimum offer nothing", () => {
    expect(reflectionOffer("manageable", cur, 600)).toBeNull();
    expect(reflectionOffer("too_demanding", null, 600)).toBeNull();
    expect(reflectionOffer("too_demanding", { sessionMinutes: 10, weeklyMinutes: 40, daysPerWeek: 4 }, 600)).toBeNull();
  });
});

describe("calendar route references", () => {
  it("accepts the new ref|nth form, and the old title form only to put an earlier move back", async () => {
    const { PLAN_ACTIVITY_REF, LEGACY_PLAN_ACTIVITY_REF } = await import("./study-calendar");
    expect(PLAN_ACTIVITY_REF.test(`learn:${refKey("renal")}|0`)).toBe(true);
    expect(PLAN_ACTIVITY_REF.test("revise:due|12")).toBe(true);
    expect(PLAN_ACTIVITY_REF.test("learn|renal|0")).toBe(false);
    expect(PLAN_ACTIVITY_REF.test("learn:Renal|0")).toBe(false);
    expect(PLAN_ACTIVITY_REF.test("learn:renal")).toBe(false);
    expect(LEGACY_PLAN_ACTIVITY_REF.test("learn|renal|0")).toBe(true);
    expect(LEGACY_PLAN_ACTIVITY_REF.test(`learn:${refKey("renal")}|0`)).toBe(false);
  });
});
