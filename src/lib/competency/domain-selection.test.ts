import { describe, expect, it } from "vitest";
import { announceBulkDone, announceBulkStopped, bulkProgress, clearSelection, groupState, keepVisible, selectAllIn, toggleId, toMove } from "./domain-selection";

const doms = [{ id: "a", areaId: "x" }, { id: "b", areaId: "x" }, { id: "c", areaId: null }, { id: "d" }];

describe("domain selection", () => {
  it("toggles without mutating", () => {
    const s = new Set(["a"]);
    expect([...toggleId(s, "b")]).toEqual(["a", "b"]);
    expect([...toggleId(s, "a")]).toEqual([]);
    expect([...s]).toEqual(["a"]);
  });
  it("select all in a group adds only that group and keeps other selections", () => {
    expect([...selectAllIn(new Set(["c"]), ["a", "b"])].sort()).toEqual(["a", "b", "c"]);
  });
  it("clear empties", () => { expect(clearSelection().size).toBe(0); });
  it("a filtered list keeps no hidden selection", () => {
    expect([...keepVisible(new Set(["a", "b", "zz"]), ["b", "c"])]).toEqual(["b"]);
    expect(keepVisible(new Set(["a"]), []).size).toBe(0);
  });
  it("group state", () => {
    expect(groupState(new Set(), ["a", "b"])).toBe("none");
    expect(groupState(new Set(["a"]), ["a", "b"])).toBe("some");
    expect(groupState(new Set(["a", "b"]), ["a", "b"])).toBe("all");
  });
  it("toMove skips domains already in the target and keeps display order", () => {
    expect(toMove(new Set(["c", "a", "b"]), doms, "x")).toEqual(["c"]);
    expect(toMove(new Set(["d", "c", "a"]), doms, null)).toEqual(["a"]);
    expect(toMove(new Set(["b", "a"]), doms, "y")).toEqual(["a", "b"]);
  });
  it("messages", () => {
    expect(bulkProgress(2, 13)).toBe("Moving 3 of 13…");
    expect(announceBulkDone(1, "Clinical")).toBe("Moved 1 domain to the Area Clinical.");
    expect(announceBulkDone(3, null)).toContain("unassigned");
    expect(announceBulkStopped(2, 5, "Safety", "refused")).toBe("Moved 2 of 5. Stopped at Safety: refused");
  });
});
