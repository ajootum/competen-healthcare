import { describe, expect, it } from "vitest";
import { SCHOLAR_AI_ACTIVITIES, activityOrFallback, policyTierFor } from "./ai-standing";

const standing = (activities: Record<string, { available: boolean }>, readable = true) =>
  ({ readable, activities: Object.fromEntries(Object.entries(activities).map(([k, v]) => [k, { label: k, available: v.available, via: null, reason: null }])) });

describe("SCHOLAR-INDEPENDENT-LEARNING-01 P3: the activity and the tier are configuration", () => {
  it("flashcards is an approved activity code", () => {
    expect(SCHOLAR_AI_ACTIVITIES).toContain("flashcards");
    expect(SCHOLAR_AI_ACTIVITIES).toContain("questions");
    expect(SCHOLAR_AI_ACTIVITIES).toContain("scenarios");
  });
  it("uses flashcards only where the published policy offers it, else questions as before", () => {
    expect(activityOrFallback(standing({ flashcards: { available: true }, questions: { available: true } }), "flashcards", "questions")).toBe("flashcards");
    expect(activityOrFallback(standing({ questions: { available: true } }), "flashcards", "questions")).toBe("questions");
    expect(activityOrFallback(standing({ flashcards: { available: false }, questions: { available: true } }), "flashcards", "questions")).toBe("questions");
    // an unreadable standing proves nothing: the code's own activity, so the engine's refusal (not this helper) decides
    expect(activityOrFallback(standing({ flashcards: { available: true } }, false), "flashcards", "questions")).toBe("questions");
  });
  it("the tier comes from the policy's activity, never from code", () => {
    const policy = { activities: { flashcards: { tier: "cheap" as const }, questions: { tier: "reasoning" as const }, deeper: { tier: "reasoning" as const } } };
    expect(policyTierFor(policy, "flashcards")).toBe("cheap");
    expect(policyTierFor(policy, "deeper")).toBe("reasoning");
    expect(policyTierFor(policy, "not_defined")).toBeNull();
    expect(policyTierFor(null, "flashcards")).toBeNull();
  });
});
