import { describe, expect, it } from "vitest";
import { aiReasonCopy, availabilityFromStanding, clarifyFrom, reasonFromRefusal } from "./ai-availability";
import { meteredRefusalBody, type AiStanding } from "@/lib/ai/allowance";
import { CLARIFY, SUPPORTIVE_REFUSAL } from "@/lib/ai/operating-mode";

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

  it("a mode that answers the educational part words the same refusal supportively, and it is still not_eligible", () => {
    expect(availabilityFromStanding(standing({ activities: { ask: { label: "Ask", available: false, via: null, reason: SUPPORTIVE_REFUSAL } } }), "ask")).toEqual({ available: false, reason: "not_eligible" });
    expect(aiReasonCopy("not_eligible", "scholar")).toEqual({ text: SUPPORTIVE_REFUSAL, next: null });
    expect(aiReasonCopy("not_eligible", "scholar").text).not.toMatch(/none is approved/);
  });

  it("a clarify question is not a refusal: it carries its question and answers, and shows no unavailable reason", () => {
    const m = meteredRefusalBody({ ok: false, error: "clarify_purpose", standing: standing({ message: CLARIFY.question }), clarify: CLARIFY });
    expect(m.status).toBe(409);
    expect(m.body).toMatchObject({ code: "clarify_purpose", clarify: { question: CLARIFY.question, education: CLARIFY.education, patient: CLARIFY.patient, patientAnswer: CLARIFY.patientAnswer } });
    expect(reasonFromRefusal(m.body)).toBeNull();
    expect(clarifyFrom(m.body)).toEqual({ question: CLARIFY.question, education: CLARIFY.education, patient: CLARIFY.patient, patientAnswer: CLARIFY.patientAnswer });
    expect(clarifyFrom({ code: "clarify_purpose", clarify: { question: "Q" } })).toBeNull();
    expect(clarifyFrom({ code: "not_eligible", clarify: CLARIFY })).toBeNull();
    expect(clarifyFrom(null)).toBeNull();
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
