/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it, vi } from "vitest";
import { eligibilityOf, outcomeCounts, previewOf, runSubmission } from "./review-batch";

// CFCA-STUDIO-UX-02: whole-framework, domain and selected-competency submission for clinical review -- a thin
// coordinator over the existing per-competency operation, with eligibility previews and retry-safe processing.

const st = (state: string) => ({ state, approvals: 0, required: 1, versionId: null, approvedAt: null }) as any;
const FW = {
  id: "f", name: "Nursing", code: "NUR-CCF", pubStatus: "draft",
  domains: [
    { id: "d1", name: "Breathing", competencies: [{ id: "a", code: "A", name: "Assess", clinical: st("unreviewed") }, { id: "b", code: "B", name: "Intervene", clinical: st("in_review") }] },
    { id: "d2", name: "Circulation", competencies: [{ id: "c", code: "C", name: "Haemo", clinical: st("stale") }, { id: "d", code: "D", name: "Fluids", clinical: st("changes_requested") }, { id: "e", code: "E", name: "Shock", clinical: st("approved") }] },
  ],
};
const HASH = new Map([["a", "ha"], ["b", "hb"], ["c", "hc"], ["d", "hd"], ["e", "he"]]);

describe("eligibility is the existing rule", () => {
  it("unreviewed and changed-since-approval are eligible; in review, approved and changes-requested are not; a locked framework is not", () => {
    expect(eligibilityOf(st("unreviewed"), "draft")).toBe("eligible");
    expect(eligibilityOf(st("stale"), "published")).toBe("eligible");
    expect(eligibilityOf(st("in_review"), "draft")).toBe("in_review");
    expect(eligibilityOf(st("approved"), "draft")).toBe("approved");
    expect(eligibilityOf(st("changes_requested"), "draft")).toBe("changes_requested");
    expect(eligibilityOf(st("unreviewed"), "in_review")).toBe("framework_locked");
    expect(eligibilityOf(null, "draft")).toBe("unreadable");
  });
});

describe("the preview, for each scope", () => {
  it("framework: every competency, with its exact hash and the reason it is or is not put forward", () => {
    const p: any = previewOf(FW, { kind: "framework" }, HASH);
    expect(p.counts).toEqual({ inScope: 5, eligible: 2, excluded: 3, withChecks: 0 });
    expect(p.items.find((i: any) => i.competencyId === "a")).toMatchObject({ hash: "ha", eligibility: "eligible" });
    expect(p.items.find((i: any) => i.competencyId === "d").reason).toMatch(/Revise the content/);
  });
  it("domain and selection narrow it; a competency outside the framework refuses the whole preview", () => {
    expect((previewOf(FW, { kind: "domain", domainId: "d2" }, HASH) as any).counts).toEqual({ inScope: 3, eligible: 1, excluded: 2, withChecks: 0 });
    expect((previewOf(FW, { kind: "competencies", ids: ["a", "b"] }, HASH) as any).counts.inScope).toBe(2);
    expect(previewOf(FW, { kind: "competencies", ids: ["a", "zzz"] }, HASH)).toHaveProperty("error");
    expect(previewOf(FW, { kind: "domain", domainId: "nope" }, HASH)).toHaveProperty("error");
  });
});

// A database double: current hashes, and the 395 versions and decisions loadClinicalReviews reads.
function db(hashes: Record<string, string>, versions: any[] = []) {
  return {
    rpc: async (_: string, a: any) => ({ data: a.p_ids.map((id: string) => ({ competency_id: id, content_hash: hashes[id] })), error: null }),
    from: (t: string) => {
      const q: any = { select: () => q, in: () => q };
      q.then = (ok: any) => Promise.resolve({ data: t === "clinical_content_version" ? versions : [], error: null }).then(ok);
      return q;
    },
  };
}

describe("submission: each item re-checked at its boundary, retry-safe, within a budget", () => {
  const items = [{ competencyId: "a", code: "A", name: "Assess", hash: "ha" }, { competencyId: "c", code: "C", name: "Haemo", hash: "hc" }];

  it("puts forward each eligible item through the existing per-competency operation", async () => {
    const submit = vi.fn(async () => ({ ok: true as const, versionId: "v", required: 2 }));
    const r = await runSubmission(db({ a: "ha", c: "hc" }), "me", "draft", items, { submit });
    expect(r.map(x => x.outcome)).toEqual(["submitted", "submitted"]);
    expect(submit).toHaveBeenCalledTimes(2);
  });

  it("content changed since the preview is reported stale and NOT put forward", async () => {
    const submit = vi.fn(async () => ({ ok: true as const, versionId: "v", required: 1 }));
    const r = await runSubmission(db({ a: "CHANGED", c: "hc" }), "me", "draft", items, { submit });
    expect(r[0]).toMatchObject({ outcome: "stale" });
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it("running it again puts nothing forward twice: an item now in review is skipped, not failed", async () => {
    const submit = vi.fn(async () => ({ ok: true as const, versionId: "v", required: 1 }));
    const inReview = [{ id: "va", competency_id: "a", content_hash: "ha", required_approvals: 1, created_at: "x" }];
    const r = await runSubmission(db({ a: "ha", c: "hc" }, inReview), "me", "draft", items, { submit });
    expect(r[0]).toMatchObject({ outcome: "skipped" });
    expect(submit).toHaveBeenCalledTimes(1);
    const dup = vi.fn(async () => ({ ok: false as const, error: "This exact content is already in clinical review." }));
    expect((await runSubmission(db({ a: "ha" }), "me", "draft", [items[0]], { submit: dup }))[0].outcome).toBe("skipped");
  });

  it("a refusal is reported per item; what the budget did not reach is returned, not dropped", async () => {
    const clock = [0, 0, 100]; let i = 0;
    const submit = vi.fn(async () => ({ ok: false as const, error: "The authorship trail could not be read, so nothing was put forward." }));
    const r = await runSubmission(db({ a: "ha", c: "hc" }), "me", "draft", items, { submit, budgetMs: 5, now: () => clock[Math.min(i++, clock.length - 1)] });
    expect(r.map(x => x.outcome)).toEqual(["failed", "not_reached"]);
    expect(outcomeCounts(r)).toMatchObject({ failed: 1, not_reached: 1, submitted: 0 });
  });

  it("a framework under governance review puts nothing forward", async () => {
    const submit = vi.fn();
    const r = await runSubmission(db({ a: "ha" }), "me", "in_review", [items[0]], { submit: submit as any });
    expect(r[0].outcome).toBe("excluded");
    expect(submit).not.toHaveBeenCalled();
  });
});
