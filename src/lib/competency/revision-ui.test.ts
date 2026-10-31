import { describe, expect, it } from "vitest";
import { markOf, movedPosition, overlayDomains, revisionCounts, revisionSummary, revisionTags, type RevCompetencyView, type RevisionView } from "./revision-ui";

type C = Parameters<typeof overlayDomains>[0][number]["competencies"][number];
const live = (id: string, over: Partial<C> = {}): C => ({
  id, code: id.toUpperCase(), name: `Live ${id}`, description: "d", learningOutcomes: ["o"], expectedLevelId: null, riskCategory: "standard", sortOrder: 0, cpuId: null,
  status: "approved", statusText: "approved",
  criteria: [{ id: `${id}-k1`, component: "k", text: "one", sourceRef: null, active: true }, { id: `${id}-k2`, component: "k", text: "two", sourceRef: null, active: true }], ...over,
});
const rc = (id: string, over: Partial<RevCompetencyView> = {}): RevCompetencyView => ({
  id, isNew: false, domainId: null, sortOrder: 0, code: id.toUpperCase(), name: `Live ${id}`, description: "d", learningOutcomes: ["o"], expectedLevelId: null, riskCategory: "standard", practiceId: null, cpuId: null,
  proposedHash: "p", liveHash: "l", changed: true, clinical: { tag: "rev" },
  criteria: [{ id: `${id}-k1`, isNew: false, text: "one", component: "k", sourceRef: null, sortOrder: 1, active: true }, { id: `${id}-k2`, isNew: false, text: "two", component: "k", sourceRef: null, sortOrder: 2, active: true }], ...over,
});
const rv = (competencies: RevCompetencyView[]): RevisionView => ({ id: "r1", createdBy: "u", createdAt: "t", updatedAt: "t", competencies });
const st = (c: unknown) => ({ status: (c as { tag?: string } | null)?.tag === "rev" ? "eligible" : "approved", statusText: "proposed" });

describe("markOf", () => {
  it("counts added, reworded, retired and restored criteria against the published ones", () => {
    const l = live("a", { criteria: [{ id: "a-k1", component: "k", text: "one", sourceRef: null, active: true }, { id: "a-k2", component: "k", text: "two", sourceRef: null, active: true }, { id: "a-k3", component: "k", text: "three", sourceRef: null, active: false }] });
    const m = markOf(l, rc("a", { criteria: [
      { id: "a-k1", isNew: false, text: "one changed", component: "k", sourceRef: null, sortOrder: 1, active: true },
      { id: "a-k2", isNew: false, text: "two", component: "k", sourceRef: null, sortOrder: 2, active: false },
      { id: "a-k3", isNew: false, text: "three", component: "k", sourceRef: null, sortOrder: 3, active: true },
      { id: "n1", isNew: true, text: "new", component: "k", sourceRef: null, sortOrder: 4, active: true },
    ] }));
    expect(m).toEqual({ state: "changed", added: 1, retired: 1, restored: 1, reworded: 1 });
  });
  it("a new competency is new, an unchanged hash is only touched", () => {
    expect(markOf(null, rc("n", { isNew: true })).state).toBe("new");
    expect(markOf(live("a"), rc("a", { changed: false })).state).toBe("touched");
  });
});

describe("overlayDomains", () => {
  it("returns the live tree when there is no revision", () => {
    const d = [{ id: "d1", competencies: [live("a")] }];
    expect(overlayDomains(d, null, st)[0].competencies[0]).toBe(d[0].competencies[0]);
  });
  it("lays proposed values over a held competency and keeps the published ones", () => {
    const out = overlayDomains([{ id: "d1", competencies: [live("a"), live("b")] }], rv([rc("a", { name: "Proposed a" })]), st)[0].competencies;
    expect(out[0].name).toBe("Proposed a");
    expect(out[0].published?.name).toBe("Live a");
    expect(out[0].status).toBe("eligible");
    expect(out[0].rev?.state).toBe("changed");
    expect(out[1].rev).toBeUndefined();
    expect(out[1].status).toBe("approved");
  });
  it("adds a new competency at the end of its domain, marked, with no published version", () => {
    const out = overlayDomains([{ id: "d1", competencies: [live("a")] }, { id: "d2", competencies: [] }], rv([rc("z", { isNew: true, domainId: "d2" })]), st);
    expect(out[0].competencies).toHaveLength(1);
    expect(out[1].competencies[0].id).toBe("z");
    expect(out[1].competencies[0].published).toBeNull();
    expect(out[1].competencies[0].rev?.state).toBe("new");
  });
  it("takes a moved criterion out of the competency the revision does not hold", () => {
    const a = live("a"), b = live("b");
    const moved = rc("b", { criteria: [...rc("b").criteria, { id: "a-k1", isNew: false, text: "one", component: "k", sourceRef: null, sortOrder: 3, active: true }] });
    // a is held too (the server copies both sides), but a competency left out must not keep a criterion that now lives elsewhere.
    const out = overlayDomains([{ id: "d1", competencies: [a, b] }], rv([moved]), st)[0].competencies;
    expect(out[0].criteria.map(k => k.id)).toEqual(["a-k2"]);
    expect(out[1].criteria.map(k => k.id)).toEqual(["b-k1", "b-k2", "a-k1"]);
  });
  it("marks each changed criterion", () => {
    const out = overlayDomains([{ id: "d1", competencies: [live("a")] }], rv([rc("a", { criteria: [
      { id: "a-k1", isNew: false, text: "one", component: "k", sourceRef: null, sortOrder: 1, active: true },
      { id: "a-k2", isNew: false, text: "two", component: "k", sourceRef: null, sortOrder: 2, active: false },
      { id: "n", isNew: true, text: "fresh", component: "k", sourceRef: null, sortOrder: 3, active: true },
    ] })]), st)[0].competencies[0];
    expect(out.criteria.map(k => k.mark)).toEqual([undefined, "retired", "new"]);
  });
});

describe("counts and words", () => {
  it("counts competencies and criteria", () => {
    const c = revisionCounts([{ state: "changed", added: 1, retired: 2, restored: 0, reworded: 1 }, { state: "new", added: 3, retired: 0, restored: 0, reworded: 0 }, { state: "touched", added: 0, retired: 0, restored: 0, reworded: 0 }]);
    expect(c).toEqual({ changed: 1, added: 1, touched: 1, criteriaAdded: 4, criteriaRetired: 2, criteriaRestored: 0, criteriaReworded: 1 });
    expect(revisionSummary(c)).toBe("1 competency changed · 1 new competency · 4 criteria added · 1 criterion reworded · 2 criteria retired");
  });
  it("does not claim no change when a competency is only opened", () => {
    expect(revisionSummary(revisionCounts([{ state: "touched", added: 0, retired: 0, restored: 0, reworded: 0 }]))).toMatch(/opened in the revision/);
    expect(revisionSummary(revisionCounts([]))).toBe("No change yet");
  });
  it("tags a row", () => {
    expect(revisionTags({ state: "changed", added: 1, retired: 2, restored: 0, reworded: 0 })).toEqual(["Changed", "1 added", "2 retired"]);
    expect(revisionTags({ state: "new", added: 3, retired: 0, restored: 0, reworded: 0 })).toEqual(["New"]);
    expect(revisionTags(undefined)).toEqual([]);
  });
});

describe("movedPosition", () => {
  it("finds a criterion moved down or up and its place in the whole section", () => {
    expect(movedPosition(["a", "b", "c"], ["b", "c", "a"], ["b", "c", "a"])).toEqual({ id: "a", position: 3 });
    expect(movedPosition(["a", "b", "c"], ["c", "a", "b"], ["c", "a", "b"])).toEqual({ id: "c", position: 1 });
    // a retired criterion keeps its slot: the position counts it
    expect(movedPosition(["a", "b"], ["b", "a"], ["x", "b", "a"])).toEqual({ id: "b", position: 2 });
  });
  it("refuses anything that is not one criterion moving", () => {
    expect(movedPosition(["a", "b"], ["a", "b"], ["a", "b"])).toBeNull();
    expect(movedPosition(["a", "b", "c", "d"], ["b", "a", "d", "c"], ["b", "a", "d", "c"])).toBeNull();
    expect(movedPosition(["a"], ["a", "b"], ["a", "b"])).toBeNull();
  });
});
