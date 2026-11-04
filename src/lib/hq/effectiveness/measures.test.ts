/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from "vitest";
import { MEASURES, NOT_985, READ_ERROR, cellOf, cellsOf, compareFlows, figureText, loadEffectiveness, parseDays, sampleCaution } from "./measures";
import { reportCsv, reportMarkdown } from "./report";
import type { ActivityCost } from "@/lib/ai/activity-cost";

const RULES = { minCohort: 10, roundTo: 5 as const };
const row = (measure: string, arm: string, extra: Record<string, unknown> = {}) => ({ measure, arm, cell_state: "reported", learners: 40, denominator: 120, numerator: 60, rate: 50, value: null, ...extra });

describe("SALE-15 effectiveness cells", () => {
  it("covers the fifteen catalogue rows 985 returns, in order, with a caution on each", () => {
    expect(MEASURES).toHaveLength(15);
    expect(new Set(MEASURES.map(m => `${m.measure}:${m.arm}`)).size).toBe(15);
    for (const m of MEASURES) expect(m.caution.length).toBeGreaterThan(20);
  });

  it("a suppressed cell carries no figure even when the row has numbers", () => {
    const c = cellOf({ ...row("transfer", "all"), cell_state: "below_floor" }, 10)!;
    expect(c).toMatchObject({ state: "below_floor", learners: null, denominator: null, numerator: null, rate: null, value: null });
    expect(figureText(c, 10)).toBe("Fewer than 10 learners");
    expect(c.sample).toMatch(/fewer than 10 consenting learners/i);
  });

  it("a missing row reads none, never zero", () => {
    const cells = cellsOf([row("immediate_understanding", "all")], 10);
    expect(cells).toHaveLength(15);
    const none = cells.find(c => c.measure === "delayed_recall" && c.arm === "flashcards")!;
    expect(none.state).toBe("none");
    expect(figureText(none, 10)).toBe("No data yet");
    expect(figureText(none, 10)).not.toMatch(/0/);
  });

  it("ignores rows outside the catalogue (no unknown column can reach the page)", () => {
    expect(cellOf({ measure: "user_id", arm: "x", cell_state: "reported" }, 10)).toBeNull();
  });

  it("study efficiency shows a per-hour value and no rate", () => {
    const c = cellOf(row("study_efficiency", "all", { rate: 77, value: 4.2 }), 10)!;
    expect(c.rate).toBeNull();
    expect(figureText(c, 10)).toBe("4.2 per active hour");
  });

  it("every result carries a sample-size caution, cautious below 100 learners", () => {
    expect(sampleCaution("reported", 12, 10)).toMatch(/very small sample/i);
    expect(sampleCaution("reported", 60, 10)).toMatch(/interpret cautiously/i);
    expect(sampleCaution("reported", 400, 10)).toMatch(/not a controlled study/i);
    expect(sampleCaution("none", null, 10)).toMatch(/no data yet/i);
  });
});

describe("standard against adaptive comparison", () => {
  it("compares only when both arms are reported", () => {
    const both = cellsOf([row("corrective_followup", "adaptive", { rate: 64 }), row("corrective_followup", "standard", { rate: 51 })], 10);
    expect(compareFlows(both)).toMatchObject({ differencePoints: 13, reason: null });
    const one = cellsOf([row("corrective_followup", "adaptive", { rate: 64 }), { measure: "corrective_followup", arm: "standard", cell_state: "below_floor" }], 10);
    const c = compareFlows(one);
    expect(c.differencePoints).toBeNull();
    expect(c.reason).toMatch(/standard: suppressed/);
  });
  it("says it is observational and does not claim adaptation improves learning", () => {
    const c = compareFlows(cellsOf([], 10));
    expect(c.caution).toMatch(/observational/i);
    expect(c.caution).toMatch(/not proof/i);
  });
});

describe("loadEffectiveness", () => {
  const admin = (r: unknown) => ({ rpc: async (fn: string, args: Record<string, unknown>) => { (admin as any).last = { fn, args }; return r; } });
  it("calls 985 with the CKRI floor (never below 5) and rounding", async () => {
    const a = admin({ data: [row("immediate_understanding", "all")], error: null }) as any;
    const r = await loadEffectiveness(a, { minCohort: 3, roundTo: 1 }, 30);
    expect(r.measured).toBe(true);
    expect((admin as any).last.fn).toBe("ckri_scholar_effectiveness_stats");
    expect((admin as any).last.args).toMatchObject({ p_min: 5, p_round: 1 });
    expect(r.floor).toBe(5);
  });
  it("fails closed without 985 and on a read error", async () => {
    expect(await loadEffectiveness(admin({ data: null, error: { code: "PGRST202", message: "Could not find the function" } }) as any, RULES)).toMatchObject({ measured: false, reason: NOT_985 });
    expect(await loadEffectiveness(admin({ data: null, error: { message: "timeout" } }) as any, RULES)).toMatchObject({ measured: false, reason: READ_ERROR });
    expect(await loadEffectiveness({ rpc: async () => { throw new Error("x"); } } as any, RULES)).toMatchObject({ measured: false, reason: READ_ERROR });
  });
  it("parses the window, defaulting to 90 days", () => {
    expect(parseDays("30")).toBe(30);
    expect(parseDays("7")).toBe(90);
    expect(parseDays(undefined)).toBe(90);
  });
});

describe("SALE-18 report export", () => {
  const off = { measured: false as const, reason: "Metering off, no data. AI metering is off on this environment, so the ledger records no spend (this is not zero)." };
  const cost: ActivityCost = { days: 30, meteringOn: false, perEvaluatedAnswer: off, perCompletedSession: off, perLessonTaught: off,
    reuse: { measured: true, served: 3, generated: 9, percent: 25 }, latency: { measured: true, rows: [{ activity: "learn", n: 4, p50: 1200, p90: 3000, small: true }] }, truncated: false };
  const cells = cellsOf([row("immediate_understanding", "all"), { measure: "transfer", arm: "all", cell_state: "below_floor", learners: 3, rate: 100 }], 10);
  const readout = { measured: true as const, days: 90, floor: 10, roundTo: 5, cells, comparison: compareFlows(cells) };
  it("Markdown keeps suppression, sample sizes, cautions and metering off (never $0)", () => {
    const md = reportMarkdown({ readout, cost, generatedAt: "2026-11-04T00:00:00Z" });
    expect(md).toContain("Fewer than 10 learners");
    expect(md).toContain("Metering off, no data");
    expect(md).not.toMatch(/\$0(\.0+)?\b/);
    expect(md).toMatch(/Engagement and activity are not learning/);
    expect(md).toMatch(/No targets are set/);
    expect(md).toContain("25% of 12 lessons");
    expect(md).not.toMatch(/user_id|learner id:/i);
  });
  it("CSV has one row per figure with state and caution, and neutralises spreadsheet formulas", () => {
    const csv = reportCsv({ readout, cost, generatedAt: "2026-11-04T00:00:00Z" });
    const lines = csv.trim().split("\r\n");
    expect(lines[0]).toMatch(/^section,measure,arm,state,figure,learners/);
    expect(csv).toMatch(/outcome,transfer,all,below_floor,Fewer than 10 learners,,,,,/);
    expect(csv).toMatch(/cost,per_lesson_taught,usd,metering_off/);
    expect(csv).not.toMatch(/,=/);
  });
  it("an unmeasured readout says so instead of figures", () => {
    const md = reportMarkdown({ readout: { measured: false, days: 90, floor: 10, roundTo: 5, reason: NOT_985 }, cost, generatedAt: "x" });
    expect(md).toContain(NOT_985);
  });
});
