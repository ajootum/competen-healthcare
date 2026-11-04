import { describe, expect, it } from "vitest";
import { actionOfRequest, summariseSqieCost } from "./sqie-cost";

describe("SQIE cost per evaluated answer and per completed session (WS-G)", () => {
  it("metering off: no data, never zero", () => {
    const c = summariseSqieCost({ meteringOn: false, ledger: [{ request_id: "r1", activity: "evaluate", cost_usd: 1, settled_cau: 1 }], completed: [], days: 30 });
    expect(c.meteringOn).toBe(false);
    expect(c.perEvaluatedAnswer).toEqual({ measured: false, reason: expect.stringMatching(/metering is off.*no data/i) });
    expect(c.perCompletedSession.measured).toBe(false);
  });
  it("one answer is one request id, whatever its parts", () => { expect(actionOfRequest("abc:main:verify")).toBe("abc"); });
  it("measured: spend over answers, and the window ratio over completed sessions", () => {
    const c = summariseSqieCost({
      meteringOn: true, days: 30,
      ledger: [
        { request_id: "e1", activity: "evaluate", cost_usd: "0.010", settled_cau: 1 }, { request_id: "e1:part", activity: "evaluate", cost_usd: 0.002, settled_cau: 0.2 },
        { request_id: "e2", activity: "evaluate", cost_usd: 0.012, settled_cau: 1 }, { request_id: "q1:a1", activity: "questions", cost_usd: 0.1, settled_cau: 10 },
      ],
      completed: [{ new_value: { adaptive: true } }, { new_value: { adaptive: false } }],
    });
    expect(c.perEvaluatedAnswer).toMatchObject({ measured: true, n: 2, usd: 0.024, per: 0.012 });
    expect(c.perCompletedSession).toMatchObject({ measured: true, n: 2, usd: 0.124, per: 0.062 });
    expect(c.adaptiveCompleted).toBe(1);
  });
  it("nothing evaluated or completed: said so, not zero", () => {
    const c = summariseSqieCost({ meteringOn: true, ledger: [], completed: [], days: 30 });
    expect(c.perEvaluatedAnswer).toEqual({ measured: false, reason: "No answer was evaluated by AI in this window." });
    expect(c.perCompletedSession.measured).toBe(false);
  });
  it("an unreadable ledger is not measured", () => {
    expect(summariseSqieCost({ meteringOn: true, ledger: null, completed: [], days: 30 }).perEvaluatedAnswer.measured).toBe(false);
  });
});
