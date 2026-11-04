import { describe, expect, it } from "vitest";
import { METERING_OFF, costText, latencyActivityOf, lessonsDelivered, percentile, summariseActivityCost, summariseLatency } from "./activity-cost";
import type { SqieCost } from "./sqie-cost";

const sqieOn: SqieCost = { days: 30, meteringOn: true, perEvaluatedAnswer: { measured: true, usd: 0.4, cau: 4, per: 0.02, n: 20 },
  perCompletedSession: { measured: true, usd: 1, cau: 10, per: 0.5, n: 2, basis: "b" }, adaptiveCompleted: 1, truncated: false };
const sqieOff: SqieCost = { ...sqieOn, meteringOn: false, perEvaluatedAnswer: { measured: false, reason: "off" }, perCompletedSession: { measured: false, reason: "off" } };
const trail = [
  { action: "ai_assistant_query", act: "teach", outcome: "shown" },
  { action: "ai_assistant_query", act: "teach", outcome: "withheld:grounding" },
  { action: "ai_assistant_query", act: "check", outcome: "shown" },
  { action: "ai_assistant_query", act: "explain", outcome: "shown" },
  { action: "scholar_learn_served", act: "teach", outcome: null },
  { action: "scholar_learn_served", act: "simplify", outcome: null },
];

describe("SALE-16 cost per useful activity", () => {
  it("metering off: every cost reads 'Metering off, no data', never $0, while reuse and latency still read", () => {
    const r = summariseActivityCost({ meteringOn: false, days: 30, sqie: sqieOff, ledger: null, trail, gateway: [{ operation: "individual_scholar_learn:teach", latency_ms: 900, status: "ok" }] });
    for (const f of [r.perEvaluatedAnswer, r.perCompletedSession, r.perLessonTaught]) {
      expect(f.measured).toBe(false);
      expect(costText(f)).toBe(METERING_OFF);
      expect(costText(f)).not.toMatch(/\$0/);
    }
    expect(r.reuse).toMatchObject({ measured: true, served: 2, generated: 2, percent: 50 });
    expect(r.latency.measured).toBe(true);
  });

  it("lessons delivered count shown teaching outputs and saved lessons served, not checks or withheld answers", () => {
    expect(lessonsDelivered(trail)).toEqual({ generated: 2, served: 2 });
  });

  it("cost per lesson taught = settled teaching spend / lessons delivered, labelled as a window ratio", () => {
    const r = summariseActivityCost({ meteringOn: true, days: 30, sqie: sqieOn, trail, gateway: [],
      ledger: [{ activity: "teach", cost_usd: 0.03, settled_cau: 3 }, { activity: "explain", cost_usd: "0.01", settled_cau: 1 }, { activity: "evaluate", cost_usd: 9, settled_cau: 9 }] });
    expect(r.perLessonTaught).toMatchObject({ measured: true, usd: 0.04, per: 0.01, n: 4 });
    expect((r.perLessonTaught as { basis: string }).basis).toMatch(/window ratio/);
    expect(r.perEvaluatedAnswer).toMatchObject({ measured: true, per: 0.02 });
  });

  it("an unreadable source is not measured, never zero", () => {
    const r = summariseActivityCost({ meteringOn: true, days: 30, sqie: sqieOn, ledger: null, trail: null, gateway: null });
    expect(r.perLessonTaught.measured).toBe(false);
    expect(r.reuse.measured).toBe(false);
    expect(r.latency.measured).toBe(false);
  });

  it("no lesson delivered: reuse and cost per lesson say so", () => {
    const r = summariseActivityCost({ meteringOn: true, days: 30, sqie: sqieOn, ledger: [], trail: [], gateway: [] });
    expect(r.reuse).toMatchObject({ measured: false, reason: expect.stringMatching(/no lesson/i) });
    expect(r.perLessonTaught).toMatchObject({ measured: false });
  });
});

describe("SALE-16 latency", () => {
  it("nearest-rank percentiles", () => {
    const s = [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000];
    expect(percentile(s, 50)).toBe(500);
    expect(percentile(s, 90)).toBe(900);
    expect(percentile([42], 90)).toBe(42);
  });
  it("groups by activity without the product prefix or the action suffix, ok calls only, small samples flagged", () => {
    expect(latencyActivityOf("individual_scholar_learn:teach")).toBe("learn");
    expect(latencyActivityOf("individual_scholar_mcq_verify")).toBe("mcq");
    const rows = summariseLatency([
      ...Array.from({ length: 20 }, (_, i) => ({ operation: "individual_scholar_evaluate", latency_ms: (i + 1) * 100, status: "ok" })),
      { operation: "individual_scholar_learn:teach", latency_ms: 4000, status: "ok" },
      { operation: "individual_scholar_learn:teach", latency_ms: 99999, status: "error" },
      { operation: "individual_scholar_learn:explain", latency_ms: null, status: "ok" },
    ]);
    expect(rows[0]).toEqual({ activity: "evaluate", n: 20, p50: 1000, p90: 1800, small: false });
    expect(rows[1]).toEqual({ activity: "learn", n: 1, p50: 4000, p90: 4000, small: true });
  });
});
