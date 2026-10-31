import { describe, expect, it } from "vitest";
import { applyLayout, byOrder, classifyReorder, densePlan, mergeLayout, pruneLayout, type LayoutTree } from "./layout-order";

// FRAMEWORK-DESIGN-STUDIO-01 slice B: the system, not the editor, decides what a reorder is (owner rulings 1-2).

const tree = (): LayoutTree => ({
  registry: ["clinical_skills", "knowledge", "knowledge_application"], componentOrder: null,
  domains: [
    { id: "d2", name: "Second", sortOrder: 2, competencies: [] },
    { id: "d1", name: "First", sortOrder: 1, competencies: [
      { id: "c1", name: "Alpha", sortOrder: 1, criteria: [
        { id: "k1", name: "s one", sortOrder: 1, component: "clinical_skills" },
        { id: "k2", name: "k one", sortOrder: 2, component: "knowledge" },
        { id: "k3", name: "s two", sortOrder: 3, component: "clinical_skills" },
      ] },
      { id: "c2", name: "Beta", sortOrder: 1, criteria: [{ id: "k9", name: "x", sortOrder: 1, component: "knowledge" }] },
    ] },
  ],
});

describe("the stable order", () => {
  it("sort_order, then name, then id; no sort_order last", () => {
    const rows = [{ id: "b", name: "Same", sortOrder: 1 }, { id: "a", name: "Same", sortOrder: 1 }, { id: "z", name: "Aaa", sortOrder: 1 }, { id: "n", name: "First", sortOrder: null }, { id: "m", name: "Zed", sortOrder: 0 }];
    expect([...rows].sort(byOrder).map(r => r.id)).toEqual(["m", "z", "a", "b", "n"]);
  });
  it("ties are broken the same way every time (c1 Alpha before c2 Beta at the same sort_order)", () => {
    expect(applyLayout(tree()).domains[0].competencies.map(c => c.id)).toEqual(["c1", "c2"]);
  });
});

describe("classifyReorder", () => {
  it("a reorder within the same parent is presentation", () => {
    const d = classifyReorder(tree(), null, { level: "domains", order: ["d2", "d1"] });
    expect(d).toEqual({ ok: true, patch: { key: "domains", ids: ["d2", "d1"] }, unchanged: false });
    const c = classifyReorder(tree(), null, { level: "competencies", parentId: "d1", order: ["c2", "c1"] });
    expect(c.ok && c.patch).toEqual({ key: "competencies", parentId: "d1", ids: ["c2", "c1"] });
    expect(classifyReorder(tree(), null, { level: "domains", order: ["d1", "d2"] })).toMatchObject({ ok: true, unchanged: true });
  });
  it("criteria move only within their section, and keep the other sections' slots", () => {
    const k = classifyReorder(tree(), null, { level: "criteria", parentId: "c1", component: "clinical_skills", order: ["k3", "k1"] });
    expect(k.ok && k.patch).toEqual({ key: "criteria", parentId: "c1", ids: ["k3", "k2", "k1"] });
  });
  it("learning outcome order is clinical, and refused", () => {
    expect(classifyReorder(tree(), null, { level: "outcomes", parentId: "c1", order: ["x"] })).toMatchObject({ ok: false, clinical: true });
  });
  it("a cross-parent move is clinical, and refused", () => {
    // a competency into another domain
    expect(classifyReorder(tree(), null, { level: "competencies", parentId: "d2", order: ["c1"] })).toMatchObject({ ok: false, clinical: true });
    // a criterion into another section of the same competency
    expect(classifyReorder(tree(), null, { level: "criteria", parentId: "c1", component: "knowledge", order: ["k2", "k1"] })).toMatchObject({ ok: false, clinical: true });
    // a criterion into another competency
    expect(classifyReorder(tree(), null, { level: "criteria", parentId: "c2", component: "knowledge", order: ["k9", "k2"] })).toMatchObject({ ok: false, clinical: true });
  });
  it("an incomplete, repeated or foreign list is refused (not clinical)", () => {
    expect(classifyReorder(tree(), null, { level: "domains", order: ["d1"] })).toMatchObject({ ok: false, clinical: false });
    expect(classifyReorder(tree(), null, { level: "domains", order: ["d1", "d1"] })).toMatchObject({ ok: false, clinical: false });
    expect(classifyReorder(tree(), null, { level: "sections", order: ["made_up"] })).toMatchObject({ ok: false, clinical: false });
  });
  it("sections: named first, then the rest of the registry", () => {
    const s = classifyReorder(tree(), null, { level: "sections", order: ["knowledge"] });
    expect(s.ok && s.patch).toEqual({ key: "componentOrder", codes: ["knowledge", "clinical_skills", "knowledge_application"] });
  });
  it("builds on the pending draft", () => {
    const draft = mergeLayout(null, { key: "domains", ids: ["d2", "d1"] });
    expect(classifyReorder(tree(), draft, { level: "domains", order: ["d2", "d1"] })).toMatchObject({ ok: true, unchanged: true });
  });
});

describe("layout drafts and the dense renumber", () => {
  it("renumbers only the named parents densely 1..n, writing only what changes", () => {
    const plan = densePlan(tree(), mergeLayout(null, { key: "competencies", parentId: "d1", ids: ["c2", "c1"] }));
    expect(plan.writes).toEqual([
      { table: "framework_competencies", id: "c2", from: 1, to: 1 },
      { table: "framework_competencies", id: "c1", from: 1, to: 2 },
    ].filter(w => w.from !== w.to));
    expect(plan.componentOrder).toBeUndefined();
  });
  it("a partial list keeps the rest in order, and a deleted id is skipped", () => {
    const a = applyLayout(tree(), { v: 1, criteria: { c1: ["k3", "gone"] } });
    expect(a.domains[0].competencies[0].criteria.map(k => k.id)).toEqual(["k3", "k1", "k2"]);
  });
  it("a draft that equals the live order is nothing pending", () => {
    expect(pruneLayout(tree(), { v: 1, domains: ["d1", "d2"] })).toBeNull();
    expect(pruneLayout(tree(), { v: 1, domains: ["d2", "d1"], competencies: { d1: ["c1", "c2"] } })).toEqual({ v: 1, domains: ["d2", "d1"] });
  });
});
