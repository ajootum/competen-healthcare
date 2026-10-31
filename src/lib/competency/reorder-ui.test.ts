import { describe, expect, it } from "vitest";
import { announceMove, moveInArray, shortName, stepTarget } from "./reorder-ui";

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
