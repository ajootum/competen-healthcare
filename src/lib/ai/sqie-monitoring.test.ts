import { describe, expect, it } from "vitest";
import { formatOf, percentile, summariseSqie, type SqieAudit, type SqieOutcome, type SqieRequest } from "./sqie-monitoring";

const req = (operation: string, cost: number, latency: number | null, action: string | null): SqieRequest => ({ operation, cost_usd: cost, latency_ms: latency, action_id: action });
const out = (action: string, operation: string, outcome: string, acc: number, rej: number, reasons: string[], verify = 0): SqieOutcome =>
  ({ action_id: action, operation, activity: operation.replace("individual_scholar_", ""), outcome, accepted_count: acc, rejected_count: rej, rejection_reasons: reasons, verify_attempts: verify });

describe("formatOf and percentile", () => {
  it("derives the format from the operation, verify calls included, and ignores non-SQIE operations", () => {
    expect(formatOf("individual_scholar_mcq")).toBe("mcq");
    expect(formatOf("individual_scholar_revision_mrq_verify")).toBe("mrq");
    expect(formatOf("individual_scholar_case_steps_verify")).toBe("case_steps");
    expect(formatOf("individual_scholar_learn_research")).toBeNull();
    expect(formatOf("personal_ai_chat")).toBeNull();
    expect(formatOf(null)).toBeNull();
  });
  it("nearest-rank percentiles; none is null", () => {
    expect(percentile([], 50)).toBeNull();
    expect(percentile([10, 20, 30, 40, 50, 60, 70, 80, 90, 100], 50)).toBe(50);
    expect(percentile([10, 20, 30, 40, 50, 60, 70, 80, 90, 100], 90)).toBe(90);
  });
});

describe("summariseSqie", () => {
  const requests = [
    req("individual_scholar_revision_mrq", 0.02, 1000, "a1"), req("individual_scholar_revision_mrq_verify", 0.01, 400, "a1"),
    req("individual_scholar_revision_mrq", 0.02, 3000, "a2"), req("individual_scholar_revision_mrq_verify", 0.01, 500, "a2"),
    req("individual_scholar_osce_station", 0.1, 8000, null),
  ];
  const outcomes = [
    out("a1", "individual_scholar_revision_mrq", "accepted", 4, 0, [], 1),
    out("a2", "individual_scholar_revision_mrq", "rejected", 0, 3, ["failed_verification", "ungrounded"], 1),
    out("a3", "individual_scholar_revision_mrq", "redirected", 0, 0, []),
  ];
  const s = summariseSqie({ requests, outcomes, audits: [], days: 30 });
  const mrq = s.formats.find(f => f.format === "mrq")!;
  it("counts generated, accepted, rejected, reasons and verification failures (redirects excluded)", () => {
    expect(mrq).toMatchObject({ actions: 2, accepted: 4, rejected: 3, rejectionRate: 43, verified: 2, verificationFailures: 1, verificationFailureRate: 50 });
    expect(mrq.topReasons[0]).toEqual({ reason: "failed_verification", n: 1 });
  });
  it("latency is of the generation calls; cost totals every call; cost per accepted is attributed spend over kept questions", () => {
    expect(mrq.p50).toBe(1000); expect(mrq.p90).toBe(3000);
    expect(mrq.cost).toBe(0.06);
    expect(mrq.costPerAccepted).toBeCloseTo(0.06 / 4, 4);
  });
  it("a format with spend but no outcomes says no data, not zero", () => {
    const osce = s.formats.find(f => f.format === "osce_station")!;
    expect(osce).toMatchObject({ accepted: null, rejected: null, rejectionRate: null, verified: null, costPerAccepted: null, calls: 1 });
  });
  it("unreadable outcomes (600 absent) are null everywhere, never zero", () => {
    const u = summariseSqie({ requests, outcomes: null, audits: null, days: 30 });
    expect(u.outcomesMeasured).toBe(false);
    expect(u.formats.every(f => f.accepted === null && f.rejectionRate === null && f.costPerAccepted === null)).toBe(true);
    expect(u.library).toBeNull(); expect(u.legacy).toBeNull();
  });
  it("library reuse sums the codes-only audit; none is null", () => {
    const audits: SqieAudit[] = [
      { action: "individual_scholar_revision_library", new_value: { offered: 5, picked: 2, copied: 1, reused: 2 }, created_at: "x" },
      { action: "individual_scholar_revision_library", new_value: { adaptive: true, offered: 3, picked: 1, copied: 1, reused: 1 }, created_at: "x" },
    ];
    expect(summariseSqie({ requests: [], outcomes: [], audits, days: 30 }).library).toEqual({ sessions: 2, offered: 8, picked: 3, copied: 2, reused: 3 });
    expect(summariseSqie({ requests: [], outcomes: [], audits: [], days: 30 }).library).toBeNull();
  });
  it("legacy coverage: checked and redirected from the new rows; before it, checked is not recorded rather than zero", () => {
    const chk = (result: string): SqieAudit => ({ action: "individual_scholar_exam_paper_legacy_checked", new_value: { result }, created_at: "x" });
    expect(summariseSqie({ requests: [], outcomes: [], audits: [chk("clean"), chk("clean"), chk("redirected")], days: 30 }).legacy).toEqual({ checked: 3, redirected: 1 });
    const old: SqieAudit[] = [{ action: "individual_scholar_exam_paper_legacy_redirected", new_value: {}, created_at: "x" }];
    expect(summariseSqie({ requests: [], outcomes: [], audits: old, days: 30 }).legacy).toEqual({ checked: null, redirected: 1 });
    expect(summariseSqie({ requests: [], outcomes: [], audits: [], days: 30 }).legacy).toBeNull();
  });
});
