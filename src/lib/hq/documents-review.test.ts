import { describe, expect, it } from "vitest";
import { documentsPathway, effectiveReview, plainReviewError, type DocumentsReviewRow } from "./documents-review";

const ME = "u-me";
const OTHER = "u-other";
const names = { [ME]: "Me", [OTHER]: "Ada Other" };
const row = (o: Partial<DocumentsReviewRow> = {}): DocumentsReviewRow => ({
  id: "r1", draftHash: "h1", submittedBy: OTHER, submittedAt: "2026-11-03T08:00:00Z", note: null, decidedBy: null, decision: null, decidedAt: null, decisionNote: null, ...o,
});
const state = (review: DocumentsReviewRow | null, o: { pending?: boolean; draftHash?: string | null } = {}) => ({ pending: o.pending ?? true, draftHash: o.draftHash === undefined ? "h1" : o.draftHash, review, names });
const holder = { userId: ME, canManage: true };
const statuses = (p: ReturnType<typeof documentsPathway>) => p.stages.map((s) => s.status);

describe("documentsPathway", () => {
  it("has three stages named Prepare, Review & Approve, Publish", () => {
    expect(documentsPathway(state(null), holder).stages.map((s) => s.label)).toEqual(["Prepare", "Review & Approve", "Publish"]);
  });
  it("nothing pending: no action", () => {
    const p = documentsPathway(state(null, { pending: false }), holder);
    expect(p.next.action).toBe("none");
    expect(statuses(p)).toEqual(["not_started", "not_started", "not_started"]);
  });
  it("pending draft with no review: Prepare is current and the holder submits", () => {
    const p = documentsPathway(state(null), holder);
    expect(statuses(p)).toEqual(["current", "not_started", "not_started"]);
    expect(p.next.action).toBe("submit");
    expect(p.next.viewer.canAct).toBe(true);
  });
  it("pending draft, viewer holds no right: no action and the right is named", () => {
    const p = documentsPathway(state(null), { userId: ME, canManage: false });
    expect(p.next.action).toBe("none");
    expect(p.next.viewer.canAct).toBe(false);
    expect(p.next.viewer.reason).toContain("hq.individual.config.manage");
  });
  it("no saved draft: save first, no submit", () => {
    const p = documentsPathway(state(null, { draftHash: null }), holder);
    expect(p.next.action).toBe("none");
    expect(p.next.headline).toBe("Save a draft");
  });
  it("changes requested on this draft: Prepare current again, Review blocked with the note, submit again", () => {
    const p = documentsPathway(state(row({ decision: "changes_requested", decidedBy: OTHER, decidedAt: "2026-11-03T09:00:00Z", decisionNote: "Fix the footer" })), holder);
    expect(statuses(p)).toEqual(["current", "blocked", "not_started"]);
    expect(p.stages[1].note).toContain("Fix the footer");
    expect(p.stages[1].note).toContain("Ada Other");
    expect(p.next.action).toBe("submit");
  });
  it("submitted by someone else: Review is current and the viewer reviews", () => {
    const p = documentsPathway(state(row()), holder);
    expect(statuses(p)).toEqual(["done", "current", "not_started"]);
    expect(p.next.action).toBe("review");
    expect(p.stages[0].note).toContain("Ada Other");
  });
  it("submitted by the viewer: cannot decide, and is told another holder must approve", () => {
    const p = documentsPathway(state(row({ submittedBy: ME })), holder);
    expect(statuses(p)).toEqual(["done", "current", "not_started"]);
    expect(p.next.action).toBe("none");
    expect(p.next.viewer.canAct).toBe(false);
    expect(p.next.viewer.reason).toBe("You submitted this draft, so another holder of the Competen Individual policy right must approve it.");
    expect(p.stages[0].note).toContain("you");
  });
  it("approved on this draft: Publish is current for any holder", () => {
    const approved = row({ decision: "approved", decidedBy: OTHER, decidedAt: "2026-11-03T09:00:00Z" });
    const p = documentsPathway(state(approved), holder);
    expect(statuses(p)).toEqual(["done", "done", "current"]);
    expect(p.next.action).toBe("publish");
    expect(p.stages[1].note).toContain("Ada Other");
  });
  it("approved, viewer is the submitter: may publish and is told so", () => {
    const p = documentsPathway(state(row({ submittedBy: ME, decision: "approved", decidedBy: OTHER, decidedAt: "2026-11-03T09:00:00Z" })), holder);
    expect(p.next.action).toBe("publish");
    expect(p.next.viewer.canAct).toBe(true);
    expect(p.next.detail).toContain("You submitted it");
    expect(p.stages[2].note).toContain("You submitted it and may publish it");
  });
  it("approved, viewer holds no right: cannot publish", () => {
    const p = documentsPathway(state(row({ decision: "approved", decidedBy: OTHER, decidedAt: "2026-11-03T09:00:00Z" })), { userId: ME, canManage: false });
    expect(p.next.action).toBe("none");
    expect(p.next.viewer.canAct).toBe(false);
  });
});

describe("effectiveReview", () => {
  const sub = (id: string, at: string) => row({ id, submittedAt: at });
  it("none for no rows", () => expect(effectiveReview([])).toBeNull());
  it("an approval stands over an older request for changes", () => {
    const cr = row({ id: "a", decision: "changes_requested", decidedBy: OTHER, decidedAt: "2026-11-03T09:00:00Z", decisionNote: "x" });
    const ap = row({ id: "b", decision: "approved", decidedBy: OTHER, decidedAt: "2026-11-03T10:00:00Z" });
    expect(effectiveReview([cr, ap])?.id).toBe("b");
  });
  it("a later request for changes withdraws an approval, as the publish guard does", () => {
    const ap = row({ id: "a", decision: "approved", decidedBy: OTHER, decidedAt: "2026-11-03T09:00:00Z" });
    const cr = row({ id: "b", decision: "changes_requested", decidedBy: OTHER, decidedAt: "2026-11-03T10:00:00Z", decisionNote: "x" });
    expect(effectiveReview([ap, cr])?.id).toBe("b");
  });
  it("an undecided resubmission is awaiting a decision after a request for changes", () => {
    const cr = row({ id: "a", decision: "changes_requested", decidedBy: OTHER, decidedAt: "2026-11-03T09:00:00Z", decisionNote: "x" });
    expect(effectiveReview([cr, sub("b", "2026-11-03T10:00:00Z")])?.id).toBe("b");
  });
});

describe("plainReviewError", () => {
  it("strips the function prefix", () => {
    expect(plainReviewError("hq_config_review: not independent. The person who submitted the draft cannot decide it")).toBe("not independent. The person who submitted the draft cannot decide it");
    expect(plainReviewError("hq_config_publish: not approved. Submit it for review first")).toBe("not approved. Submit it for review first");
  });
  it("never returns an empty sentence", () => expect(plainReviewError("")).not.toBe(""));
});
