import { describe, expect, it } from "vitest";
import { engagementFrom } from "./progress-data";
import { buildEngagement } from "./intelligence";
import { monthActivity, type ActivityRecords } from "./monthly-review";
import {
  activeWeeksIn, assessmentPerformance, isCompletedSession, isLessonCompleted, isRevisionActivity, lastStudyDay, learnerTimeZone, learnerToday, localDay, selfReportedStudy,
  studyActivityDays, studyDaysInWindow, validTimeZone,
} from "./learning-definitions";
import type { Occurrence } from "../learning-plan/types";

const headers = (tz: string | null) => ({ get: (n: string) => (n === "x-vercel-ip-timezone" ? tz : null) });

describe("the learner's local day", () => {
  it("is the UTC day by default and for an unknown zone", () => {
    expect(localDay("2026-11-02T23:30:00Z")).toBe("2026-11-02");
    expect(localDay("2026-11-02T23:30:00Z", "Not/AZone")).toBe("2026-11-02");
    expect(localDay("garbage")).toBe("");
  });
  it("moves a late-evening UTC instant to the next day in Nairobi (UTC+3) and an early one to the previous day in Los Angeles", () => {
    expect(localDay("2026-11-02T22:30:00Z", "Africa/Nairobi")).toBe("2026-11-03");
    expect(localDay("2026-11-02T02:30:00Z", "America/Los_Angeles")).toBe("2026-11-01");
    expect(localDay("2026-11-02T02:30:00Z", "Asia/Kolkata")).toBe("2026-11-02");
  });
  it("validates a time zone with Intl and never trusts a header blindly", () => {
    expect(validTimeZone("Africa/Nairobi")).toBe("Africa/Nairobi");
    expect(validTimeZone("Mars/Olympus")).toBeNull();
    expect(validTimeZone("x".repeat(100))).toBeNull();
    expect(validTimeZone("UTC; DROP")).toBeNull();
    expect(validTimeZone(undefined)).toBeNull();
  });
  it("learnerToday reads x-vercel-ip-timezone, falling back to UTC", () => {
    const now = new Date("2026-11-02T22:30:00Z");
    expect(learnerTimeZone(headers("Africa/Nairobi"))).toBe("Africa/Nairobi");
    expect(learnerToday(headers("Africa/Nairobi"), now)).toBe("2026-11-03");
    expect(learnerToday(headers(null), now)).toBe("2026-11-02");
    expect(learnerToday(headers("bogus"), now)).toBe("2026-11-02");
    expect(learnerToday(undefined, now)).toBe("2026-11-02");
  });
});

describe("a study-activity day", () => {
  const at = (kind: "lesson" | "answer" | "review" | "decision" | "check", iso: string) => ({ kind, at: iso });
  it("is a local day with a lesson event, an answer, a review, a case decision or a check", () => {
    const days = studyActivityDays([
      at("lesson", "2026-11-01T10:00:00Z"), at("answer", "2026-11-01T11:00:00Z"), at("review", "2026-11-02T09:00:00Z"), at("decision", "2026-11-03T09:00:00Z"), at("check", "2026-11-04T09:00:00Z"),
    ]);
    expect(days).toEqual(["2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04"]);
  });
  it("uses the local day, so one late-evening session and one early-morning session in Nairobi are two days, not one", () => {
    const stamps = [at("answer", "2026-11-02T20:30:00Z"), at("answer", "2026-11-03T02:00:00Z")];
    expect(studyActivityDays(stamps, "UTC")).toEqual(["2026-11-02", "2026-11-03"]);
    expect(studyActivityDays(stamps, "Africa/Nairobi")).toEqual(["2026-11-02", "2026-11-03"]);
    expect(studyActivityDays([at("answer", "2026-11-02T20:30:00Z"), at("answer", "2026-11-02T22:30:00Z")], "UTC")).toEqual(["2026-11-02"]);
    expect(studyActivityDays([at("answer", "2026-11-02T20:30:00Z"), at("answer", "2026-11-02T22:30:00Z")], "Africa/Nairobi")).toEqual(["2026-11-02", "2026-11-03"]);
  });
  it("never counts an upload or any unknown kind", () => {
    expect(studyActivityDays([{ kind: "upload" as never, at: "2026-11-01T10:00:00Z" }])).toEqual([]);
  });
  it("counts the window in local days ending today, weeks and the last study day", () => {
    const days = ["2026-10-10", "2026-10-30", "2026-11-02"];
    expect(studyDaysInWindow(days, "2026-11-02", 28)).toBe(3);
    expect(studyDaysInWindow(days, "2026-11-02", 7)).toBe(2);
    expect(activeWeeksIn(days, "2026-11-02", 4)).toBe(2);
    expect(lastStudyDay(days, "2026-11-01")).toBe("2026-10-30");
    expect(lastStudyDay([], "2026-11-01")).toBeNull();
  });
});

describe("Progress, Learning Intelligence and the monthly review share the one definition", () => {
  const attempts = [{ answeredAt: "2026-11-02T22:30:00Z" }];
  it("Progress counts a study day from a lesson event too, and in the learner's day", () => {
    const e = engagementFrom({ attempts, reviews: [], decisions: [], checks: [] }, ["2026-11-01T08:00:00Z"], 28, "2026-11-02T23:00:00Z");
    expect(e.studyDays).toBe(2);
    // the same data on the learner's own (Nairobi) day: now is already 3 November there, and the answer belongs to it
    const k = engagementFrom({ attempts, reviews: [], decisions: [], checks: [] }, ["2026-11-01T08:00:00Z"], 28, "2026-11-02T23:00:00Z", "Africa/Nairobi");
    expect(k.studyDays).toBe(2);
    expect(k.lastStudied).toBe("2026-11-02T22:30:00Z");
  });
  it("Learning Intelligence counts the other recorded learning when it is given, and the learner's day", () => {
    const base = { materials: [{ id: "m1", title: "M" }], attempts: [{ questionId: "q", correct: true, answeredAt: "2026-11-02T22:30:00Z" }], reviews: null, cards: [], windowDays: 28 };
    const plain = buildEngagement({ ...base, today: "2026-11-03" });
    expect(plain.state === "measured" && plain.studyDays).toBe(1);
    const withLessons = buildEngagement({ ...base, today: "2026-11-03", activity: [{ kind: "lesson", at: "2026-11-01T08:00:00Z" }, { kind: "decision", at: "2026-10-31T08:00:00Z" }] });
    expect(withLessons.state === "measured" && withLessons.studyDays).toBe(3);
    // Nairobi: 22:30 UTC on the 2nd is already the 3rd
    const nairobi = buildEngagement({ ...base, today: "2026-11-03", tz: "Africa/Nairobi" });
    expect(nairobi.state === "measured" && nairobi.lastStudied).toBe("2026-11-03");
  });
  it("the monthly review's active days exclude uploads and sessions with no answer, and use the learner's day", () => {
    const rec = (o: Partial<ActivityRecords>): ActivityRecords => ({ sections: [{ chunkId: "c1", materialId: "m1", materialTitle: "M", label: "Renal" }], lessons: [], materials: [], answers: [], reviews: [], revisionSessions: [], caseSessions: [], topics: {}, links: [], competencies: [], ...o });
    const r = rec({
      lessons: [{ sessionId: "s", step: 1, title: "L", chunkIds: ["c1"], at: "2026-11-03T10:00:00Z" }],
      materials: [{ id: "m1", title: "M", at: "2026-11-05T10:00:00Z" }],                       // an upload: no
      revisionSessions: [{ id: "r1", mode: "mock", at: "2026-11-06T10:00:00Z" }],             // a session started, nothing answered: no
      answers: [{ questionId: "q", chunkId: "c1", at: "2026-11-07T10:00:00Z", sessionId: null }],
      reviews: [{ chunkId: "c1", at: "2026-11-30T22:30:00Z" }],
    });
    expect(monthActivity(r, "2026-11").activeDays).toEqual(["2026-11-03", "2026-11-07", "2026-11-30"]);
    // Nairobi: the review at 22:30 UTC on the 30th is the 1st of December there, so it is not a November day
    expect(monthActivity(r, "2026-11", "Africa/Nairobi").activeDays).toEqual(["2026-11-03", "2026-11-07"]);
  });
});

describe("self-reported study is counted apart, never as a study day", () => {
  const occ = (o: Partial<Occurrence>): Occurrence => ({
    key: "k", entryId: "e", experience: "scholar", entryType: "study_session", title: "t", description: null, date: "2026-11-03", occurrenceDate: "2026-11-03", startTime: "09:00", endTime: "09:45",
    allDay: false, durationMinutes: 45, link: null, status: "planned", selfReported: false, moved: false, edited: false, recurring: false, ...o,
  });
  it("counts only study sessions the learner marked completed", () => {
    const r = selfReportedStudy([
      occ({ status: "completed", selfReported: true }), occ({ date: "2026-11-04", status: "completed", selfReported: true, durationMinutes: null }),
      occ({ date: "2026-11-05" }),                                                      // planned only
      occ({ date: "2026-11-06", entryType: "busy", status: "completed", selfReported: true }),
      occ({ date: "2026-11-07", entryType: "exam", status: "completed", selfReported: true }),
    ]);
    expect(r).toEqual({ days: ["2026-11-03", "2026-11-04"], sessions: 2, minutes: 45 });
  });
  it("has null minutes when none of them states a length, and nothing when there are none", () => {
    expect(selfReportedStudy([occ({ status: "completed", selfReported: true, durationMinutes: null })]).minutes).toBeNull();
    expect(selfReportedStudy([])).toEqual({ days: [], sessions: 0, minutes: null });
  });
  it("planned time never creates a study-activity day", () => {
    // there is no stamp kind for a calendar entry: creating or planning one cannot reach studyActivityDays
    expect(studyActivityDays([])).toEqual([]);
  });
});

describe("the other definitions", () => {
  it("a completed session is finished or answered in full", () => {
    expect(isCompletedSession({ finishedAt: "2026-11-02T10:00:00Z", answered: 0 })).toBe(true);
    expect(isCompletedSession({ answered: 10, planned: 10 })).toBe(true);
    expect(isCompletedSession({ answered: 4, planned: 10 })).toBe(false);
    expect(isCompletedSession({ answered: 0, planned: 0 })).toBe(false);
  });
  it("a lesson is completed only when the records say so; revision activity is a review or a revision-session answer", () => {
    expect(isLessonCompleted({ read: true, completed: false })).toBe(false);
    expect(isLessonCompleted({ read: true, completed: true })).toBe(true);
    expect(isRevisionActivity({ kind: "review" })).toBe(true);
    expect(isRevisionActivity({ kind: "answer", revisionSessionId: "r" })).toBe(true);
    expect(isRevisionActivity({ kind: "answer" })).toBe(false);
  });
  it("assessment performance is over code-marked answers only, and null with none (never zero)", () => {
    expect(assessmentPerformance([])).toBeNull();
    expect(assessmentPerformance([{ marking: "ai_evaluation", correct: true }, { marking: "self_graded", correct: false }])).toBeNull();
    expect(assessmentPerformance([{ marking: "deterministic", correct: true }, { marking: "deterministic", correct: false }, { marking: "ai_evaluation", correct: false }])).toEqual({ percent: 50, answered: 2 });
    expect(assessmentPerformance([{ marking: "deterministic", correct: false }])).toEqual({ percent: 0, answered: 1 });
  });
});
