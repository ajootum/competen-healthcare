import { describe, expect, it } from "vitest";
import { NOT_ELIGIBLE_REASON, type AiStanding } from "@/lib/ai/allowance";
import { SUPPORTIVE_REFUSAL } from "@/lib/ai/operating-mode";
import { aiReasonCopy, isGovernanceNotEligible, paperAiCopy, refusalCopy, studentAiText } from "../ai-availability";
import { activityState } from "./ai-standing";
import { SCHOLAR_EDU_AI } from "./config";
import { refusalWords, studentRefusalBody } from "./http";

// SCHOLAR-EDU-AI-01 (owner, 30 Oct 2026, s3, s4, s6): a student never sees the governance reason for "no eligible
// model"; HQ's precise reason stays on the standing; an operating mode's supportive words are kept as that mode words them.

const OWNED_NOT_ELIGIBLE = "This activity needs an AI model approved for clinical content, and none is available for it right now. Nothing was sent.";
const GOVERNANCE = /approved for clinical content|none is approved/i;
const standing = (o: Partial<AiStanding> = {}): AiStanding => ({
  readable: true, metered: false, level: "full", remaining: { band: "plenty", percent: null }, resetsAt: null, message: null, policyPublished: true,
  activities: { deeper: { label: "Go deeper", available: false, via: null, reason: NOT_ELIGIBLE_REASON } }, ...o,
});

describe("SCHOLAR-EDU-AI-01 s6: the student's words for an AI that is not available", () => {
  it("recognises both governance wordings and swaps them; anything else passes through unchanged", () => {
    expect(isGovernanceNotEligible(NOT_ELIGIBLE_REASON)).toBe(true);
    expect(isGovernanceNotEligible(OWNED_NOT_ELIGIBLE)).toBe(true);
    expect(isGovernanceNotEligible(null)).toBe(false);
    expect(studentAiText(NOT_ELIGIBLE_REASON)).toBe(SCHOLAR_EDU_AI.unavailable.general);
    expect(studentAiText(OWNED_NOT_ELIGIBLE, "professional")).not.toMatch(GOVERNANCE);
    expect(studentAiText(SUPPORTIVE_REFUSAL)).toBe(SUPPORTIVE_REFUSAL);
    expect(studentAiText("Your AI allowance resets on Monday.")).toBe("Your AI allowance resets on Monday.");
  });

  it("the shared copy for not_eligible is the plain words, for both experiences", () => {
    expect(aiReasonCopy("not_eligible", "scholar")).toEqual({ text: SCHOLAR_EDU_AI.unavailable.general, next: null });
    expect(aiReasonCopy("not_eligible", "professional").text).not.toMatch(GOVERNANCE);
  });

  it("activityState (every Scholar route and page) never passes the governance reason on", () => {
    expect(activityState(standing(), "deeper")).toEqual({ available: false, insufficient: false, message: SCHOLAR_EDU_AI.unavailable.general });
  });

  it("a refusal body keeps its code, status and HQ's per-activity reason, with the student words as its message", () => {
    const m = studentRefusalBody({ ok: false, error: "not_eligible", standing: standing({ message: NOT_ELIGIBLE_REASON }) });
    expect(m.status).toBe(503);
    expect(m.body.code).toBe("not_eligible");
    expect(m.body.error).toBe(SCHOLAR_EDU_AI.unavailable.general);
    expect(m.body.standing.message).toBe(SCHOLAR_EDU_AI.unavailable.general);
    expect(m.body.standing.activities.deeper.reason).toBe(NOT_ELIGIBLE_REASON);
    expect(refusalWords({ ok: false, error: "not_eligible", standing: standing({ message: NOT_ELIGIBLE_REASON }) }).message).toBe(SCHOLAR_EDU_AI.unavailable.general);
    // A pilot-mode supportive answer is the mode's own words, kept.
    const s = studentRefusalBody({ ok: false, error: "not_eligible", standing: standing({ message: SUPPORTIVE_REFUSAL }) });
    expect(s.body.error).toBe(SUPPORTIVE_REFUSAL);
  });

  it("refusalCopy: the plain words for a governance refusal, the mode's own for a supportive one, null for a non-AI error", () => {
    expect(refusalCopy({ code: "not_eligible", error: NOT_ELIGIBLE_REASON }, "scholar")?.text).toBe(SCHOLAR_EDU_AI.unavailable.general);
    expect(refusalCopy({ code: "not_eligible", error: SUPPORTIVE_REFUSAL }, "scholar")?.text).toBe(SUPPORTIVE_REFUSAL);
    expect(refusalCopy({ error: "That question could not be found." }, "scholar")).toBeNull();
  });

  it("the paper's own words point at what still works without AI, before or after a click", () => {
    expect(paperAiCopy({ reason: "not_eligible" }, false)?.text).toBe(SCHOLAR_EDU_AI.unavailable.paper(false));
    expect(paperAiCopy({ reason: "not_eligible" }, false)?.text).toMatch(/your notes or the original paper/);
    expect(paperAiCopy({ reason: "not_eligible" }, true)?.text).toMatch(/the suggested answer you saved/);
    expect(paperAiCopy({ body: { code: "not_eligible", error: SCHOLAR_EDU_AI.unavailable.general } }, false)?.text).toBe(SCHOLAR_EDU_AI.unavailable.paper(false));
    expect(paperAiCopy({ body: { code: "not_eligible", error: SUPPORTIVE_REFUSAL } }, false)?.text).toBe(SUPPORTIVE_REFUSAL);
    expect(paperAiCopy({ reason: "consent_off" }, false)).toEqual(aiReasonCopy("consent_off", "scholar"));
    expect(paperAiCopy({ body: { error: "No evidence." } }, false)).toBeNull();
    for (const t of [paperAiCopy({ reason: "not_eligible" }, false)!.text, paperAiCopy({ reason: "not_eligible" }, true)!.text]) expect(t).not.toMatch(GOVERNANCE);
  });
});

describe("SCHOLAR-EDU-AI-01 s3, s4: the notice, the disclaimer and the formative label", () => {
  it("is versioned and says every point the owner set", () => {
    expect(SCHOLAR_EDU_AI.version).toMatch(/^scholar-edu-ai-v\d+$/);
    expect(SCHOLAR_EDU_AI.notice).toMatch(/For learning only/);
    const full = SCHOLAR_EDU_AI.disclaimer.join(" ");
    for (const p of [/for education/i, /incomplete or inaccurate/i, /course materials/i, /recognised references/i, /local clinical guidelines/i,
      /real-time patient management/i, /prescribing/i, /treatment decisions/i, /local policy and your clinical team/i, /formative/i, /formal examination result/i, /verified competency/i])
      expect(full).toMatch(p);
    expect(SCHOLAR_EDU_AI.formative).toBe("Practice feedback from AI — not a formal exam result or a verified competency.");
    expect(SCHOLAR_EDU_AI.formativeEvaluation).toMatch(/not a formal exam result or a verified competency/);
  });
});
