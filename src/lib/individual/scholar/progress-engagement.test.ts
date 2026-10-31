import { describe, expect, it } from "vitest";
import { engagementFrom } from "./progress-data";

// Progress engagement: Learn sessions count as study days and "last studied", and nothing else.
const NOW = "2026-10-31T12:00:00Z";
const none = { attempts: [], reviews: [], decisions: [], checks: [] };

describe("engagementFrom", () => {
  it("a learner with only Learn sessions has study days and a last studied date", () => {
    const e = engagementFrom(none, ["2026-10-29T09:00:00Z", "2026-10-29T09:30:00Z", "2026-10-30T08:00:00Z"], 28, NOW);
    expect(e.studyDays).toBe(2);
    expect(e.lastStudied).toBe("2026-10-30T08:00:00Z");
  });

  it("Learn events do not change the answer, review, decision or check counts", () => {
    const e = engagementFrom(none, ["2026-10-30T08:00:00Z"], 28, NOW);
    expect([e.answers, e.reviews, e.decisions, e.checks]).toEqual([0, 0, 0, 0]);
  });

  it("merges with other activity on the same day and respects the window", () => {
    const e = engagementFrom({ ...none, attempts: [{ answeredAt: "2026-10-30T20:00:00Z" }] }, ["2026-10-30T08:00:00Z", "2026-08-01T08:00:00Z"], 28, NOW);
    expect(e.studyDays).toBe(1);
    expect(e.answers).toBe(1);
  });

  it("with nothing at all there is no last studied", () => {
    expect(engagementFrom(none, [], 28, NOW)).toMatchObject({ studyDays: 0, lastStudied: null });
  });
});
