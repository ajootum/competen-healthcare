import { describe, expect, it } from "vitest";
import { announceMove, DRAG_THRESHOLD, dropOf, movePointerDrag, moveInArray, readDropTarget, shortName, startPointerDrag, stepTarget } from "./reorder-ui";

describe("reorder-ui (pure)", () => {
  it("moves an item and leaves the input alone", () => {
    const a = ["a", "b", "c", "d"];
    expect(moveInArray(a, 0, 2)).toEqual(["b", "c", "a", "d"]);
    expect(moveInArray(a, 3, 0)).toEqual(["d", "a", "b", "c"]);
    expect(a).toEqual(["a", "b", "c", "d"]);
  });
  it("ignores a move that goes nowhere or off the list", () => {
    expect(moveInArray(["a", "b"], 1, 1)).toEqual(["a", "b"]);
    expect(moveInArray(["a", "b"], 0, 5)).toEqual(["a", "b"]);
    expect(moveInArray(["a", "b"], -1, 0)).toEqual(["a", "b"]);
  });
  it("steps up and down and stops at the ends", () => {
    expect(stepTarget(1, -1, 3)).toBe(0);
    expect(stepTarget(1, 1, 3)).toBe(2);
    expect(stepTarget(0, -1, 3)).toBeNull();
    expect(stepTarget(2, 1, 3)).toBeNull();
    expect(stepTarget(0, 1, 1)).toBeNull();
    expect(stepTarget(5, -1, 3)).toBeNull();
  });
  it("announces one-based positions", () => {
    expect(announceMove("Hand hygiene", 0, 4)).toBe("Moved Hand hygiene to position 1 of 4.");
    expect(announceMove("X", 3, 4)).toBe("Moved X to position 4 of 4.");
  });
  it("shortens long names on one line", () => {
    expect(shortName("  a \n b  ")).toBe("a b");
    const s = shortName("w ".repeat(100));
    expect(s.length).toBeLessThanOrEqual(60);
    expect(s.endsWith("…")).toBe(true);
  });
});

describe("pointer drag (FDS-02 S2)", () => {
  it("stays a press until the pointer has moved past the threshold", () => {
    const s = startPointerDrag("k", 1, 10, 10);
    expect(movePointerDrag(s, 10 + DRAG_THRESHOLD - 2, 10, { key: "k", index: 3 }).active).toBe(false);
    expect(dropOf(movePointerDrag(s, 11, 11, { key: "k", index: 3 }))).toBeNull();
  });
  it("drops on another row of the same list only", () => {
    const s = startPointerDrag("k", 1, 0, 0);
    expect(dropOf(movePointerDrag(s, 0, 30, { key: "k", index: 3 }))).toEqual({ from: 1, to: 3 });
    expect(dropOf(movePointerDrag(s, 0, 30, { key: "other", index: 3 }))).toBeNull();
    expect(dropOf(movePointerDrag(s, 0, 30, null))).toBeNull();
    expect(dropOf(movePointerDrag(s, 0, 30, { key: "k", index: 1 }))).toBeNull();
  });
  it("keeps the drag active once started and follows the latest target", () => {
    let s = movePointerDrag(startPointerDrag("k", 0, 0, 0), 0, 20, { key: "k", index: 2 });
    s = movePointerDrag(s, 0, 21, null);
    expect(s.active).toBe(true);
    expect(dropOf(s)).toBeNull();
  });
  it("reads row attributes defensively", () => {
    expect(readDropTarget("k", "2")).toEqual({ key: "k", index: 2 });
    expect(readDropTarget(undefined, "2")).toBeNull();
    expect(readDropTarget("k", "x")).toBeNull();
    expect(readDropTarget("k", "")).toBeNull();
    expect(readDropTarget("k", "-1")).toBeNull();
  });
});
