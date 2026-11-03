import { describe, expect, it } from "vitest";
import { newestFirst, requiredFor } from "./governance-inbox";

describe("governance inbox: pure pieces", () => {
  it("the required action follows the state (spec section 5)", () => {
    expect(requiredFor("draft", 1)).toBe("Complete and submit v1 for review");
    expect(requiredFor("in_review", 2)).toBe("Review & approve v2, or request changes");
    expect(requiredFor("approved", 3)).toBe("Publish v3");
    expect(requiredFor("published", 1)).toMatch(/new version/);
    expect(requiredFor("retired", 1)).toBe("");
  });
  it("tasks are ordered newest first, undated last", () => {
    const xs = newestFirst([{ at: null, id: "n" }, { at: "2026-11-01", id: "a" }, { at: "2026-11-03", id: "c" }]);
    expect(xs.map((x) => x.id)).toEqual(["c", "a", "n"]);
  });
});
