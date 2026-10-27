import { describe, expect, it, vi } from "vitest";
import { activityOf, feedbackKey, feedbackReasons, materialKey, outcomeOf, priorRejection, productOf, reasonCodes, recordAiOutcome, summariseQuality, type OutcomeRow, type RequestRow } from "./outcomes";

// COMPETEN-SCHOLAR-AI-OPT-01 Wave 1: the outcome record and the Holdings quality-and-cost view.

describe("what an outcome row may hold", () => {
  it("keeps reason CODES only: the detail after ':' or '(' is cut off, and nothing else gets through", () => {
    expect(reasonCodes(["ungrounded:the number 28", "failed_verification (option B)", "malformed", "malformed", "Ungrounded"])).toEqual(["ungrounded", "failed_verification", "malformed"]);
    expect(reasonCodes(["respiratory rate of 28 in a patient"])).toEqual(["respiratory"]);
  });
  it("a material key is a one-way digest, the same for the same sections in another order, and changes with the prompt", () => {
    const a = materialKey({ userId: "u1", activity: "case_steps", versions: ["v2"], contents: ["Section A", "Section  B"] });
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(materialKey({ userId: "u1", activity: "case_steps", versions: ["v2"], contents: ["Section B", "Section A"] })).toBe(a);
    expect(materialKey({ userId: "u1", activity: "case_steps", versions: ["v3"], contents: ["Section A", "Section B"] })).not.toBe(a);
    expect(materialKey({ userId: "u2", activity: "case_steps", versions: ["v2"], contents: ["Section A", "Section B"] })).not.toBe(a);
    expect(a).not.toContain("Section");
  });
  it("feedback keeps only the fixed reason codes, and its key never contains the user id", () => {
    expect(feedbackReasons(["unclear", "free text here", "unclear", "evidence"])).toEqual(["unclear", "evidence"]);
    expect(feedbackKey("user-1", "question", "q1")).not.toContain("user-1");
  });
  it("accepted / partial / rejected from counts", () => {
    expect([outcomeOf(2, 0), outcomeOf(1, 2), outcomeOf(0, 3), outcomeOf(0, 0)]).toEqual(["accepted", "partial", "rejected", "rejected"]);
  });
  it("is fail-soft before migration 600: a missing table is not reported as a fault and never throws", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const admin = { from: () => ({ insert: async () => ({ error: { code: "PGRST205", message: "Could not find the table 'public.plat_ai_outcomes' in the schema cache" } }) }) };
    await recordAiOutcome(admin, { actionId: "a", product: "scholar", activity: "case_steps", outputKind: "case", outcome: "rejected" });
    expect(err).not.toHaveBeenCalled();
    err.mockRestore();
  });
});

describe("the identical-retry guard", () => {
  const admin = (rows: { outcome: string }[] | null, error: unknown = null) => {
    const filters: unknown[][] = [];
    const chain: Record<string, unknown> = {};
    for (const m of ["select", "eq", "in", "gte", "order"]) chain[m] = (...a: unknown[]) => { filters.push([m, ...a]); return chain; };
    chain.limit = async () => ({ data: rows, error });
    return { admin: { from: () => chain }, filters };
  };
  it("stops only when the latest generation on this exact material was rejected", async () => {
    expect(await priorRejection(admin([{ outcome: "rejected" }]).admin, "k")).toBe(true);
    expect(await priorRejection(admin([{ outcome: "accepted" }]).admin, "k")).toBe(false);
    expect(await priorRejection(admin([]).admin, "k")).toBe(false);
  });
  it("ignores redirects and errors (they sent nothing, or were an outage)", async () => {
    const a = admin([{ outcome: "rejected" }]);
    await priorRejection(a.admin, "k");
    expect(a.filters).toContainEqual(["in", "outcome", ["accepted", "partial", "rejected"]]);
  });
  it("unreadable is never a block", async () => {
    expect(await priorRejection(admin(null, { code: "PGRST205" }).admin, "k")).toBe(false);
  });
});

describe("the quality-and-cost view", () => {
  const now = Date.parse("2026-10-27T12:00:00Z");
  const at = "2026-10-27T09:00:00Z";
  // The acceptance run's shape: an explanation kept, questions partly kept, a case question kept, two cases rejected.
  const requests: RequestRow[] = [
    { operation: "individual_scholar_learn:teach", cost_usd: 0.01, action_id: "e1", created_at: at },
    { operation: "individual_scholar_mcq", cost_usd: 0.02, action_id: "q1", created_at: at },
    { operation: "individual_scholar_mcq_verify", cost_usd: 0.01, action_id: "q1", created_at: at },
    { operation: "individual_scholar_case_steps", cost_usd: 0.04, action_id: "c1", created_at: at },
    { operation: "individual_scholar_case_steps", cost_usd: 0.03, action_id: "c1", created_at: at },
    { operation: "individual_scholar_case_blueprint", cost_usd: 0.05, action_id: "c2", created_at: at },
    { operation: "individual_scholar_case_blueprint", cost_usd: 0.04, action_id: "c3", created_at: at },
    { operation: "practice_ai_summary", attribution_scope: "workspace", cost_usd: 0.5, action_id: null, created_at: at },
  ];
  const o = (action_id: string, output_kind: OutcomeRow["output_kind"], outcome: OutcomeRow["outcome"], accepted: number, rejected: number, reasons: string[] = []): OutcomeRow =>
    ({ action_id, product: "scholar", activity: "x", output_kind, outcome, accepted_count: accepted, rejected_count: rejected, rejection_reasons: reasons, sufficiency: "not_assessed", created_at: at });
  const outcomes = [
    o("e1", "explanation", "accepted", 1, 0), o("q1", "question", "partial", 1, 2, ["failed_verification"]),
    o("c1", "case", "rejected", 0, 1, ["ungrounded"]), o("c2", "case", "rejected", 0, 1, ["ungrounded", "source_insufficient"]),
    o("c3", "case", "accepted", 1, 0), o("r1", "case", "redirected", 0, 0, ["sufficiency_insufficient"]),
  ];
  const v = summariseQuality(requests, outcomes, [{ output_kind: "case", rating: "negative", reasons: ["relevance"], created_at: at }], { days: 3, now });

  it("counts total spend and spend by product, including calls no outcome covers", () => {
    expect(v.totalSpend).toBe(0.7);
    expect(v.byProduct.map(p => p.label)).toEqual(["Practice", "Scholar"]);
    expect(v.attributedSpend).toBe(0.2);
  });
  it("puts a verification call with the activity it checks", () => {
    expect(activityOf("individual_scholar_mcq_verify")).toBe("mcq");
    expect(v.byActivity.find(a => a.activity === "mcq")).toMatchObject({ n: 2, cost: 0.03 });
    expect(productOf("individual_scholar_case_steps")).toBe("Scholar");
  });
  it("cost per ACCEPTED output is every call of the action over what was kept, and failed actions carry their cost", () => {
    const k = Object.fromEntries(v.perKind.map(x => [x.kind, x]));
    expect(k.question).toMatchObject({ actions: 1, accepted: 1, costPerAccepted: 0.03, rejectedActions: 0 });
    expect(k.case).toMatchObject({ actions: 3, accepted: 1, rejectedActions: 2, rejectionRate: 67, spend: 0.16, costPerAccepted: 0.16, unsuccessfulCost: 0.12, redirected: 1 });
    expect(k.case.feedback).toEqual({ n: 1, positive: 0 });
  });
  it("a kind with nothing kept shows no per-output cost rather than zero", () => {
    const none = summariseQuality(requests, [o("c1", "case", "rejected", 0, 1)], [], { days: 1, now });
    expect(none.perKind.find(x => x.kind === "case")!.costPerAccepted).toBeNull();
    expect(none.perKind.find(x => x.kind === "explanation")!.rejectionRate).toBeNull();
  });
  it("P8/P10: per active Scholar learner -- counted, never listed", () => {
    const withActors = requests.map((r, i) => ({ ...r, actor_id: r.operation?.startsWith("practice") ? "staff-1" : i < 4 ? "L1" : "L2" }));
    const w = summariseQuality(withActors, outcomes, [{ output_kind: "case", rating: "negative", reasons: [], created_at: at }], { days: 1, now });
    expect(w.learners).toEqual({ scholar: 2, costPerLearner: 0.1, callsPerLearner: 3.5 });
    expect(w.byProduct.find(p => p.label === "Scholar")).toMatchObject({ learners: 2, costPerLearner: 0.1 });
    const k = Object.fromEntries(w.perKind.map(x => [x.kind, x]));
    expect(k.case).toMatchObject({ actionsPerLearner: 1.5, acceptedPerLearner: 0.5, feedbackRate: 100 });
    expect(k.explanation.feedbackRate).toBe(0);
    expect(w.trend[0].learners).toBe(2);
    expect(JSON.stringify(w)).not.toMatch(/L1|L2|staff-1/);
  });
  it("with no learner ids, per-learner figures are absent, not zero", () => {
    expect(v.learners).toEqual({ scholar: 0, costPerLearner: null, callsPerLearner: null });
    expect(v.perKind[0].actionsPerLearner).toBeNull();
  });
  it("tallies reasons and gives a daily trend", () => {
    expect(v.reasons[0]).toEqual({ label: "ungrounded", n: 2 });
    expect(v.trend).toHaveLength(3);
    expect(v.trend[2]).toMatchObject({ day: "2026-10-27", accepted: 3, positiveRate: 0 });
  });
});
