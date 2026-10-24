/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from "vitest";
import { clinicalCaseState, extractJson, promotedDraft, reusePotential, windowRange, caseTemplate } from "./studio";
import { estimateAvoided, measuredSpend } from "./analytics";
import { validateBlueprint } from "./blueprint";

// C2 studio rules that need no database, and s11's line between measured spend and estimated savings.

describe("the educator studio (C2)", () => {
  it("the queue windows: 24 hours, 7 days, 30 days, or a custom range in order and within a year", () => {
    const now = new Date("2026-10-24T12:00:00Z");
    expect(windowRange({ window: "24h" }, now)).toEqual({ from: "2026-10-23T12:00:00.000Z", to: "2026-10-24T12:00:00.000Z" });
    expect(windowRange({ window: "7d" }, now)!.from).toBe("2026-10-17T12:00:00.000Z");
    expect(windowRange({ window: "custom", from: "2026-10-01", to: "2026-10-10" }, now)).toEqual({ from: "2026-10-01T00:00:00.000Z", to: "2026-10-10T00:00:00.000Z" });
    expect(windowRange({ window: "custom", from: "2026-10-10", to: "2026-10-01" }, now)).toBeNull();
    expect(windowRange({ window: "custom", from: "2024-01-01", to: "2026-01-01" }, now)).toBeNull();
  });

  it("reuse potential is a deterministic score from metadata, favouring what the library lacks", () => {
    const rich = { competencyIds: ["c1"], snapshot: { decisionPoints: [1, 2, 3], safetyCriteria: [1], progression: [1] } };
    expect(reusePotential(rich, new Set()).band).toBe("high");
    expect(reusePotential(rich, new Set(["c1"])).band).toBe("high");                       // 3 for structure alone
    expect(reusePotential({ competencyIds: ["c1"], snapshot: {} }, new Set(["c1"])).band).toBe("low");
    expect(reusePotential({ competencyIds: [], snapshot: { decisionPoints: [1, 2, 3] } }, new Set()).reasons).toContain("names no CFCA competency yet");
  });

  it("a promoted draft drops source references and rests on the rights the student attested", () => {
    const d = promotedDraft({ title: "x", decisionPoints: [{ id: "d1", sourceRefs: ["s:1"] }], metadata: { provenance: { kind: "private", rights: "student_private" } } }, "cand-1", "own_notes");
    expect((d.decisionPoints[0] as any).sourceRefs).toBeUndefined();
    expect(d.metadata.provenance).toEqual({ kind: "candidate", candidateId: "cand-1", rights: "own_notes", note: null });
    expect(validateBlueprint(d, "library").join(" ")).not.toMatch(/private case cannot be a library case/);
  });

  it("a version is approved only when the 395 record says so, and a rejection is changes requested", () => {
    expect(clinicalCaseState("submitted", [], 1)).toBe("in_review");
    expect(clinicalCaseState("submitted", [{ decision: "approved" }], 2)).toBe("in_review");
    expect(clinicalCaseState("submitted", [{ decision: "approved" }, { decision: "approved" }], 2)).toBe("approved");
    expect(clinicalCaseState("submitted", [{ decision: "approved" }, { decision: "rejected" }], 1)).toBe("changes_requested");
    expect(clinicalCaseState("published", [], 1)).toBe("published");
    expect(clinicalCaseState("submitted", [{ decision: "approved" }], null)).toBe("in_review");
  });

  it("an AI draft is read from the first JSON object, and the template is a private-valid start", () => {
    expect(extractJson('Here it is: {"schema":"case-blueprint/1","title":"t"} done')).toEqual({ schema: "case-blueprint/1", title: "t" });
    expect(extractJson("no json")).toBeNull();
    expect(validateBlueprint(caseTemplate("New case"), "library").length).toBeGreaterThan(0);   // a template is not a finished case
  });
});

describe("case intelligence (s11): measured is not estimated", () => {
  it("metering off is not measured, never zero", () => {
    expect(measuredSpend([], false)).toEqual({ measured: false, reason: "AI metering is off, so the ledger records no spend" });
    expect(measuredSpend([{ settled_cau: 10, cost_usd: 0.002 }, { settled_cau: 5.5, cost_usd: 0.001 }], true)).toEqual({ measured: true, cau: 15.5, usd: 0.003, requests: 2 });
  });

  it("the avoided cost is an estimate with its basis, and absent without a measured mean", () => {
    expect(estimateAvoided(4, { measured: true, generations: 2, meanCau: 36.6, meanUsd: 0.0085 })).toEqual({ estimated: true, cau: 146.4, usd: 0.034,
      basis: "4 library sessions × the measured mean of 2 private case generations in the period" });
    expect(estimateAvoided(4, { measured: true, generations: 0, meanCau: 0, meanUsd: 0 }).estimated).toBe(false);
    expect(estimateAvoided(4, { measured: false, reason: "AI metering is off" })).toEqual({ estimated: false, reason: "No measured cost of generating a private case to estimate from (AI metering is off)" });
  });
});
