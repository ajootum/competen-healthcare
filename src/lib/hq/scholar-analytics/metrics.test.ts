import { describe, expect, it } from "vitest";
import { buildActivities, learnerRow, summaryCards, kindBreakdown, costByActivity, type RawRows } from "./metrics";
import { parseRange } from "./range";

const U = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", V = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const NOW = new Date("2026-11-03T12:00:00Z");
const t = (iso: string) => iso;
const empty = (): RawRows => ({ materials: [], learnSessions: [], learnEvents: [], artefacts: [], reviews: [], revisionSessions: [], caseSessions: [], osceAttempts: [], selfAssessments: [], evaluations: [], planEdits: [] });

describe("buildActivities", () => {
  it("counts one activity per record and never twice for the same record", () => {
    const raw = empty();
    raw.materials = [{ id: "m1", user_id: U, created_at: t("2026-11-01T08:00:00Z") }, { id: "m1", user_id: U, created_at: t("2026-11-01T08:00:00Z") }];
    expect(buildActivities(raw, NOW)).toHaveLength(1);
  });
  it("a Learn session with no step is not an activity, and active time follows the steps with the idle gap capped", () => {
    const raw = empty();
    raw.learnSessions = [
      { id: "s0", user_id: U, created_at: t("2026-11-01T08:00:00Z"), last_active_at: null, status: "active" },
      { id: "s1", user_id: U, created_at: t("2026-11-01T09:00:00Z"), last_active_at: t("2026-11-01T11:00:00Z"), status: "active" },
    ];
    raw.learnEvents = [
      { session_id: "s1", user_id: U, action: "teach", created_at: t("2026-11-01T09:10:00Z") },   // 10 min
      { session_id: "s1", user_id: U, action: "resume", created_at: t("2026-11-01T11:00:00Z") },  // 110 min gap -> capped at 30
    ];
    const acts = buildActivities(raw, NOW);
    expect(acts.map(a => a.ref)).toEqual(["s1"]);
    expect(acts[0].seconds).toBe((10 + 30 + 5) * 60);
    expect(acts[0].resumed).toBe(1);
    expect(acts[0].status).toBe("started");
  });
  it("an open session untouched for more than 7 days is abandoned, a completed one is completed", () => {
    const raw = empty();
    raw.revisionSessions = [
      { id: "r1", user_id: U, created_at: t("2026-10-01T08:00:00Z"), last_active_at: t("2026-10-01T08:30:00Z"), completed_at: null, status: "active" },
      { id: "r2", user_id: U, created_at: t("2026-11-02T08:00:00Z"), last_active_at: t("2026-11-02T08:20:00Z"), completed_at: t("2026-11-02T08:20:00Z"), status: "completed" },
    ];
    const acts = buildActivities(raw, NOW);
    expect(acts.find(a => a.ref === "r1")?.status).toBe("abandoned");
    expect(acts.find(a => a.ref === "r2")?.status).toBe("completed");
    expect(acts.find(a => a.ref === "r2")?.seconds).toBe(20 * 60);
  });
  it("flashcard reviews bundle into one activity per reporting day", () => {
    const raw = empty();
    raw.reviews = [
      { user_id: U, reviewed_at: t("2026-11-01T20:00:00Z") }, { user_id: U, reviewed_at: t("2026-11-01T20:05:00Z") },
      { user_id: U, reviewed_at: t("2026-11-01T21:30:00Z") }, // 00:30 the next day in Africa/Nairobi
    ];
    const acts = buildActivities(raw, NOW);
    expect(acts).toHaveLength(2);
    expect(acts[0].items).toBe(2);
  });
  it("only a self-assessment (respondent is the subject) counts, assessor-led records do not", () => {
    const raw = empty();
    raw.selfAssessments = [
      { id: "i1", respondent_id: U, subject_user_id: U, started_at: t("2026-11-01T08:00:00Z"), submitted_at: t("2026-11-01T08:40:00Z"), status: "submitted" },
      { id: "i2", respondent_id: V, subject_user_id: U, started_at: t("2026-11-01T08:00:00Z"), submitted_at: null, status: "in_progress" },
    ];
    expect(buildActivities(raw, NOW).map(a => a.ref)).toEqual(["i1"]);
  });
});

describe("per learner and summary", () => {
  const range = parseRange({ range: "7d" }, NOW);
  const raw = empty();
  raw.materials = [{ id: "m1", user_id: U, created_at: t("2026-10-30T08:00:00Z") }];
  raw.osceAttempts = [{ id: "o1", user_id: U, started_at: t("2026-11-01T08:00:00Z"), finished_at: t("2026-11-01T08:12:00Z"), duration_seconds: 720, created_at: t("2026-11-01T08:00:00Z") }];
  raw.caseSessions = [{ id: "c1", user_id: V, created_at: t("2026-09-01T08:00:00Z"), last_active_at: t("2026-09-01T08:10:00Z"), completed_at: t("2026-09-01T08:10:00Z"), status: "completed" }];
  const acts = buildActivities(raw, NOW);
  const ai = [{ userId: U, at: t("2026-11-01T08:05:00Z"), operation: "individual_scholar_learn", tokens: 1200, costUsd: 0.012 }, { userId: V, at: t("2026-11-02T08:05:00Z"), operation: "personal_ai_scholar_ask", tokens: 100, costUsd: 0.001 }];

  it("counts active days, sessions, estimated minutes and AI inside the range only", () => {
    const row = learnerRow({ userId: U, activities: acts, ai, settled: [], range }, "Learner 1", "Learner 1");
    expect(row.activeDays).toBe(2);
    expect(row.sessions).toBe(1);
    expect(row.activeMinutes).toBe(12);
    expect(row.activities).toBe(2);
    expect(row.aiRequests).toBe(1);
    expect(row.aiCostUsd).toBe(0.012);
    expect(row.lastActive).toBe("2026-11-01T08:12:00Z");
  });
  it("summary: new, returning, active and the AI figures agree with the rows", () => {
    const learners = [
      { userId: U, classification: "human", createdAt: t("2026-10-31T00:00:00Z"), accountStatus: "active", fullName: "A" },
      { userId: V, classification: "unclassified", createdAt: t("2026-08-01T00:00:00Z"), accountStatus: "active", fullName: "B" },
    ];
    const c = summaryCards({ learners, activities: acts, ai, settled: [], range, now: NOW });
    expect(c.learners).toBe(2);
    expect(c.unclassifiedIncluded).toBe(1);
    expect(c.newLearners).toBe(1);
    expect(c.activeInRange).toBe(2); // U by activity, V by an AI request
    expect(c.returningLearners).toBe(1); // V had a case in September
    expect(c.activities).toBe(2);
    expect(c.aiRequests).toBe(2);
    expect(c.aiCostUsd).toBe(0.013);
    expect(c.aiCostPerActiveLearner).toBe(0.0065);
    expect(c.wau).toBe(2);
  });
  it("breakdowns", () => {
    expect(kindBreakdown(acts).map(k => `${k.kind}:${k.started}/${k.completed}`)).toEqual(["upload:1/1", "case:1/1", "osce:1/1"]);
    expect(costByActivity(ai, range)[0]).toEqual({ operation: "individual_scholar_learn", requests: 1, costUsd: 0.012 });
  });
});

describe("parseRange", () => {
  it("presets and a bounded custom range, never a future end", () => {
    expect(parseRange({ range: "7d" }, NOW).label).toBe("Last 7 days");
    const c = parseRange({ range: "custom", from: "2026-10-01", to: "2026-12-31" }, NOW);
    expect(c.preset).toBe("custom");
    expect(c.to <= NOW.toISOString()).toBe(true);
    expect(parseRange({ range: "custom", from: "2026-12-01", to: "2026-10-01" }, NOW).preset).toBe("30d");
  });
});
