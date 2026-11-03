import { describe, expect, it } from "vitest";
import type { Term } from "./classify";
import { childrenOf, depthOf, forbiddenParents, termPath, topLevel, treeOrder } from "./hierarchy";

const t = (id: string, label: string, parentId: string | null = null, position = 0): Term =>
  ({ id, dimensionCode: "domain", code: id, label, parentId, sourceKind: null, sourceRef: null, isActive: true, position });

const terms: Term[] = [
  t("cns", "Core skills", null, 5), t("resp", "Respiratory", null, 10),
  t("pa", "Patient assessment", "cns", 10), t("vs", "Vital signs monitoring", "cns", 20), t("vs-bp", "Blood pressure", "vs", 10),
  t("orphan", "Orphan", "missing", 99),
];

describe("term hierarchy", () => {
  it("lists top-level terms in position order, treating a term with a missing parent as top-level", () => {
    expect(topLevel(terms).map((x) => x.id)).toEqual(["cns", "resp", "orphan"]);
  });
  it("walks children and paths", () => {
    expect(childrenOf("cns", terms).map((x) => x.id)).toEqual(["pa", "vs"]);
    expect(termPath(terms[4], terms)).toEqual(["Core skills", "Vital signs monitoring", "Blood pressure"]);
    expect(depthOf(terms[4], terms)).toBe(2);
    expect(depthOf(terms[0], terms)).toBe(0);
  });
  it("orders the tree parent first and forbids a term from becoming its own descendant's child", () => {
    expect(treeOrder(terms).map((x) => `${x.depth}:${x.term.id}`)).toEqual(["0:cns", "1:pa", "1:vs", "2:vs-bp", "0:resp", "0:orphan"]);
    expect([...forbiddenParents(terms[3], terms)].sort()).toEqual(["vs", "vs-bp"]);
  });
  it("survives a loop", () => {
    const loop = [t("a", "A", "b"), t("b", "B", "a")];
    expect(termPath(loop[0], loop)).toEqual(["B", "A"]);
    expect(treeOrder(loop).length).toBe(2);
  });
});
