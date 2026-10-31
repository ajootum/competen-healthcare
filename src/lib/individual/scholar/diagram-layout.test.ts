import { describe, expect, it } from "vitest";
import type { FlowData, MapData } from "./answer-format";
import { flowLayers, flowOutline, layoutFlow, layoutMap, mapOutline, wrapText, type Box, type Pt } from "./diagram-layout";

const flow = (nodes: Array<[string, string?]>, edges: Array<[string, string, string?]>, direction: "down" | "right" = "down"): FlowData => ({
  title: "t", direction,
  nodes: nodes.map(([id, kind]) => ({ id, label: `Label ${id}`, kind: (kind ?? "step") as FlowData["nodes"][number]["kind"] })),
  edges: edges.map(([from, to, label]) => (label ? { from, to, label } : { from, to })),
});
const overlap = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const inside = (b: Box, p: Pt, eps = 0.001) => p.x > b.x + eps && p.x < b.x + b.w - eps && p.y > b.y + eps && p.y < b.y + b.h - eps;
const onEdge = (b: Box, p: Pt, eps = 0.01) => p.x >= b.x - eps && p.x <= b.x + b.w + eps && p.y >= b.y - eps && p.y <= b.y + b.h + eps && !inside(b, p, eps);

describe("wrapText", () => {
  it("wraps greedily on the character budget", () => {
    expect(wrapText("aa bb cc dd", 5, 4)).toEqual(["aa bb", "cc dd"]);
  });
  it("cuts words longer than a line", () => {
    expect(wrapText("abcdefghij", 4, 5)).toEqual(["abcd", "efgh", "ij"]);
  });
  it("ends the last allowed line in an ellipsis", () => {
    const l = wrapText("one two three four five six seven", 7, 2);
    expect(l).toHaveLength(2);
    expect(l[1].endsWith("…")).toBe(true);
    expect(l.every(x => x.length <= 7)).toBe(true);
  });
  it("never returns no lines", () => {
    expect(wrapText("   ", 10, 3)).toEqual([""]);
  });
});

describe("flow layering", () => {
  it("longest path from the sources", () => {
    const { layerOf, back } = flowLayers(flow([["a"], ["b"], ["c"], ["d"]], [["a", "b"], ["b", "c"], ["a", "c"], ["c", "d"]]));
    expect([...layerOf.entries()]).toEqual([["a", 0], ["b", 1], ["c", 2], ["d", 3]]);
    expect(back.size).toBe(0);
  });
  it("a loop becomes a back edge and layering terminates", () => {
    const { layerOf, back } = flowLayers(flow([["a"], ["b"], ["c"]], [["a", "b"], ["b", "c"], ["c", "a"]]));
    expect([...back]).toEqual([2]);
    expect(layerOf.get("c")).toBe(2);
  });
  it("a graph that is all loops still gets layers", () => {
    const { layerOf } = flowLayers(flow([["a"], ["b"]], [["a", "b"], ["b", "a"]]));
    expect(layerOf.get("a")).toBe(0);
    expect(layerOf.get("b")).toBe(1);
  });
});

describe("flow layout", () => {
  const branch = flow([["s", "start"], ["d", "decision"], ["y"], ["n"], ["e", "end"]], [["s", "d"], ["d", "y", "yes"], ["d", "n", "no"], ["y", "e"], ["n", "e"]]);

  it("goes down layer by layer, one centre column for a chain", () => {
    const L = layoutFlow(flow([["a"], ["b"], ["c"]], [["a", "b"], ["b", "c"]]), "down");
    const [a, b, c] = L.nodes;
    expect(a.y).toBeLessThan(b.y);
    expect(b.y).toBeLessThan(c.y);
    expect(a.x + a.w / 2).toBeCloseTo(b.x + b.w / 2);
    expect(L.edges[0].points).toEqual([{ x: a.x + a.w / 2, y: a.y + a.h }, { x: b.x + b.w / 2, y: b.y }]);
  });
  it("right swaps the axes", () => {
    const L = layoutFlow(flow([["a"], ["b"]], [["a", "b"]]), "right");
    expect(L.nodes[0].x + L.nodes[0].w).toBeLessThan(L.nodes[1].x);
    expect(L.nodes[0].y).toBeCloseTo(L.nodes[1].y);
    expect(L.direction).toBe("right");
  });
  it("is deterministic", () => {
    expect(layoutFlow(branch)).toEqual(layoutFlow(structuredClone(branch)));
  });
  it("branches sit side by side in edge order and rejoin", () => {
    const L = layoutFlow(branch);
    const get = (id: string) => L.nodes.find(n => n.id === id)!;
    expect(get("y").y).toBeCloseTo(get("n").y);
    expect(get("y").x).toBeLessThan(get("n").x);
    expect(get("e").y).toBeGreaterThan(get("y").y);
  });
  it("nodes never overlap and everything is inside the box", () => {
    const g = flow(Array.from({ length: 12 }, (_, i) => [`n${i}`] as [string]), [
      ["n0", "n1"], ["n0", "n2"], ["n0", "n3"], ["n1", "n4"], ["n2", "n4"], ["n3", "n5"], ["n4", "n6"], ["n5", "n6"], ["n6", "n7"], ["n7", "n8"], ["n0", "n8"], ["n8", "n9"], ["n9", "n10"], ["n10", "n11"], ["n9", "n3"],
    ]);
    for (const dir of ["down", "right"] as const) {
      const L = layoutFlow(g, dir);
      for (const [i, a] of L.nodes.entries()) {
        expect(a.x).toBeGreaterThanOrEqual(0);
        expect(a.y).toBeGreaterThanOrEqual(0);
        expect(a.x + a.w).toBeLessThanOrEqual(L.width);
        expect(a.y + a.h).toBeLessThanOrEqual(L.height);
        for (const b of L.nodes.slice(i + 1)) expect(overlap(a, b)).toBe(false);
      }
      for (const e of L.edges) for (const p of e.points) {
        expect(p.x).toBeGreaterThanOrEqual(0); expect(p.x).toBeLessThanOrEqual(L.width);
        expect(p.y).toBeGreaterThanOrEqual(0); expect(p.y).toBeLessThanOrEqual(L.height);
      }
    }
  });
  it("edges start and end on their nodes' borders and are orthogonal", () => {
    const L = layoutFlow(branch);
    const get = (id: string) => L.nodes.find(n => n.id === id)!;
    for (const e of L.edges) {
      expect(onEdge(get(e.from), e.points[0])).toBe(true);
      expect(onEdge(get(e.to), e.points[e.points.length - 1])).toBe(true);
      for (let i = 0; i + 1 < e.points.length; i++) expect(e.points[i].x === e.points[i + 1].x || e.points[i].y === e.points[i + 1].y).toBe(true);
    }
  });
  it("a long edge routes around the nodes in the layers it passes", () => {
    const L = layoutFlow(flow([["a"], ["b"], ["c"], ["d"]], [["a", "b"], ["b", "c"], ["c", "d"], ["a", "d"]]));
    const long = L.edges[3];
    expect(long.points.length).toBeGreaterThan(2);
    for (const n of L.nodes.filter(x => x.id !== "a" && x.id !== "d")) {
      for (let i = 0; i + 1 < long.points.length; i++) {
        const p = long.points[i], q = long.points[i + 1];
        for (let t = 0; t <= 1; t += 0.02) expect(inside(n, { x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t })).toBe(false);
      }
    }
  });
  it("a loop edge ends at its original target, the arrow end", () => {
    const L = layoutFlow(flow([["a"], ["b"], ["c"]], [["a", "b"], ["b", "c"], ["c", "a", "retry"]]));
    const loop = L.edges[2], a = L.nodes.find(n => n.id === "a")!, c = L.nodes.find(n => n.id === "c")!;
    expect(onEdge(c, loop.points[0])).toBe(true);
    expect(onEdge(a, loop.points[loop.points.length - 1])).toBe(true);
    expect(loop.labelBox).toBeDefined();
  });
  it("edge labels get a box, unlabelled edges do not", () => {
    const L = layoutFlow(branch);
    expect(L.edges.filter(e => e.labelBox).map(e => e.label)).toEqual(["yes", "no"]);
  });
  it("right layout leaves room for edge labels", () => {
    const L = layoutFlow(flow([["a"], ["b"]], [["a", "b", "a fairly long label"]]), "right");
    const gap = L.nodes[1].x - (L.nodes[0].x + L.nodes[0].w);
    expect(gap).toBeGreaterThan(L.edges[0].labelBox!.w);
  });
  it("decisions are taller than steps and wrap inside the width", () => {
    const L = layoutFlow(branch);
    const d = L.nodes.find(n => n.id === "d")!;
    expect(d.h).toBeGreaterThanOrEqual(72);
    expect(d.lines.every(l => l.length <= 14)).toBe(true);
  });
});

describe("flowOutline", () => {
  it("numbers steps in layer order with where each leads", () => {
    const o = flowOutline(flow([["a", "start"], ["b", "decision"], ["c"]], [["a", "b"], ["b", "c", "yes"], ["b", "a", "no"]]));
    expect(o.map(s => s.n)).toEqual([1, 2, 3]);
    expect(o[1].goes).toEqual([{ to: 3, toLabel: "Label c", label: "yes", loop: false }, { to: 1, toLabel: "Label a", label: "no", loop: true }]);
    expect(o[2].goes).toEqual([]);
  });
});

const map = (n: number, groups: MapData["nodes"][number]["group"][] = ["other"]): MapData => ({
  title: "m", center: "Central idea",
  nodes: Array.from({ length: n }, (_, i) => ({ id: `x${i}`, label: `Concept number ${i} with some words`, group: groups[i % groups.length] })),
  edges: Array.from({ length: n }, (_, i) => ({ from: i % 2 ? `x${i}` : "center", to: i % 2 ? "center" : `x${i}`, label: i % 3 ? "causes" : undefined })).map(e => (e.label ? e : { from: e.from, to: e.to })),
});

describe("map layout", () => {
  it.each([1, 3, 6, 9, 12])("%i nodes: no overlap, all inside the box", n => {
    const L = layoutMap(map(n, ["cause", "feature", "treatment", "other"]));
    expect(L.nodes).toHaveLength(n + 1);
    for (const [i, a] of L.nodes.entries()) {
      expect(a.x).toBeGreaterThanOrEqual(0);
      expect(a.y).toBeGreaterThanOrEqual(0);
      expect(a.x + a.w).toBeLessThanOrEqual(L.width);
      expect(a.y + a.h).toBeLessThanOrEqual(L.height);
      for (const b of L.nodes.slice(i + 1)) expect(overlap(a, b)).toBe(false);
    }
  });
  it("orders nodes around the ring by group, centre in the middle", () => {
    const data = map(4, ["other", "cause"]);
    const L = layoutMap(data);
    const ids = L.nodes.slice(1).map(n => n.id);
    expect(ids).toEqual(["x1", "x3", "x0", "x2"]);
    const c = L.nodes[0];
    expect(c.id).toBe("center");
    expect(c.x + c.w / 2).toBeGreaterThan(L.width / 4);
  });
  it("edges leave the boxes and carry labels at the middle", () => {
    const L = layoutMap(map(5));
    const get = (id: string) => L.nodes.find(n => n.id === id)!;
    for (const e of L.edges) {
      expect(onEdge(get(e.from), e.points[0])).toBe(true);
      expect(onEdge(get(e.to), e.points[1])).toBe(true);
    }
    expect(L.edges.some(e => e.labelBox)).toBe(true);
  });
  it("group tags only on grouped nodes, and the text sits inside the box", () => {
    const L = layoutMap(map(4, ["cause", "other"]));
    for (const n of L.nodes) {
      expect(n.lineY.every(y => y > n.y && y < n.y + n.h)).toBe(true);
      if (n.tag) expect(n.tagY).toBeLessThan(n.lineY[0]);
      else expect(n.tagY).toBeUndefined();
    }
    expect(L.nodes.filter(n => n.tag).map(n => n.tag)).toEqual(["Cause", "Cause"]);
  });
  it("is deterministic", () => {
    expect(layoutMap(map(8))).toEqual(layoutMap(structuredClone(map(8))));
  });
});

describe("mapOutline", () => {
  it("relations by name, groups, and concepts with no relation", () => {
    const data: MapData = {
      title: "m", center: "Sepsis",
      nodes: [{ id: "a", label: "Infection", group: "cause" }, { id: "b", label: "Fluids", group: "treatment" }, { id: "c", label: "Lonely", group: "other" }],
      edges: [{ from: "a", to: "center", label: "triggers" }, { from: "center", to: "b" }],
    };
    expect(mapOutline(data)).toEqual({
      center: "Sepsis",
      relations: [{ from: "Infection", to: "Sepsis", label: "triggers" }, { from: "Sepsis", to: "Fluids" }],
      alone: ["Lonely"],
      groups: [{ group: "cause", label: "Cause", items: ["Infection"] }, { group: "treatment", label: "Treatment", items: ["Fluids"] }, { group: "other", label: "Other", items: ["Lonely"] }],
    });
  });
});
