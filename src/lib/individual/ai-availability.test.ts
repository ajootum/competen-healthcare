import { describe, expect, it } from "vitest";
import { aiReasonCopy, availabilityFromStanding, reasonFromRefusal } from "./ai-availability";
import { meteredRefusalBody, type AiStanding } from "@/lib/ai/allowance";

const standing = (o: Partial<AiStanding> = {}): AiStanding => ({
  readable: true, metered: false, level: "full", remaining: { band: "plenty", percent: null }, resetsAt: null,
  activities: { ask: { label: "Ask", available: true, via: "included", reason: null } }, message: null, policyPublished: true, ...o,
});

describe("HFE-01 Wave 1: AI availability", () => {
  it("is available only when the standing says so and consent is on", () => {
    expect(availabilityFromStanding(standing(), "ask")).toEqual({ available: true });
    expect(availabilityFromStanding(standing(), "ask", "on")).toEqual({ available: true });
  });

  it("distinguishes the four headline reasons the owner named", () => {
    expect(availabilityFromStanding(standing({ policyPublished: false, activities: {} }), "ask")).toEqual({ available: false, reason: "policy_unpublished" });
    expect(availabilityFromStanding(standing(), "ask", "off")).toEqual({ available: false, reason: "consent_off" });
    expect(availabilityFromStanding(standing({ activities: { ask: { label: "Ask", available: false, via: null, reason: "Used up" } } }), "ask")).toEqual({ available: false, reason: "allowance_exhausted" });
    expect(availabilityFromStanding(standing(), "teach")).toEqual({ available: false, reason: "activity_unsupported" });
  });

  it("consent wins over everything (a person who has not agreed is never told about allowances)", () => {
    expect(availabilityFromStanding(standing({ policyPublished: false }), "ask", "outdated")).toEqual({ available: false, reason: "consent_outdated" });
    expect(availabilityFromStanding(null, "ask", "awaiting_legal")).toEqual({ available: false, reason: "consent_awaiting_legal" });
  });

  it("maps clinical eligibility, level and unreadable states", () => {
    expect(availabilityFromStanding(standing({ activities: { ask: { label: "Ask", available: false, via: null, reason: "This needs an AI model approved for clinical content, and none is approved for it yet." } } }), "ask")).toEqual({ available: false, reason: "not_eligible" });
    expect(availabilityFromStanding(standing({ activities: { ask: { label: "Ask", available: false, via: null, reason: "level_insufficient" } } }), "ask")).toEqual({ available: false, reason: "level_insufficient" });
    expect(availabilityFromStanding(standing({ readable: false }), "teach")).toEqual({ available: false, reason: "unreadable" });
    expect(availabilityFromStanding(null, "ask")).toEqual({ available: false, reason: "unreadable" });
  });

  it("reads the reason from a server refusal, and the engine now marks the unpublished policy", () => {
    const body = meteredRefusalBody({ ok: false, error: "unknown_activity", standing: standing({ policyPublished: false, activities: {} }) }).body;
    expect(body.code).toBe("policy_unpublished");
    expect(body.error).toMatch(/not switched on/);
    expect(reasonFromRefusal(body)).toBe("policy_unpublished");
    const published = meteredRefusalBody({ ok: false, error: "unknown_activity", standing: standing() }).body;
    expect(published.code).toBe("unknown_activity");
    expect(reasonFromRefusal(published)).toBe("activity_unsupported");
    expect(reasonFromRefusal(meteredRefusalBody({ ok: false, error: "allowance_exhausted", standing: standing() }).body)).toBe("allowance_exhausted");
    expect(reasonFromRefusal({ error: "Ask a question" })).toBeNull();
  });

  it("speaks in the person's terms, with a next step only where they can act", () => {
    const reasons = ["policy_unpublished", "consent_off", "consent_outdated", "consent_awaiting_legal", "allowance_exhausted", "level_insufficient", "activity_unsupported", "not_eligible", "unreadable", "not_entitled"] as const;
    for (const r of reasons) {
      const c = aiReasonCopy(r, "professional");
      expect(c.text.length).toBeGreaterThan(20);
      expect(c.text).not.toMatch(/environment|unknown_activity|policy/i);
    }
    expect(aiReasonCopy("consent_off", "scholar").next?.href).toBe("/individual/scholar/settings");
    expect(aiReasonCopy("allowance_exhausted", "professional").next?.href).toBe("/individual/professional/ai-allowance");
    expect(aiReasonCopy("policy_unpublished", "scholar").next).toBeNull();
  });
});
