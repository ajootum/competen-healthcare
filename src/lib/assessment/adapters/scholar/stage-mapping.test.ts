import { describe, expect, it } from "vitest";
import { bandsFromAssignments } from "./stage-mapping";

const levels = [0, 1, 2, 3, 4, 5, 6].map((n) => ({ code: String(n), ordinal: n }));
const stages = ["novice", "advanced_beginner", "competent", "proficient", "expert"];

describe("bandsFromAssignments (owner decision 2: explicit, never inferred)", () => {
  it("turns hand assignments into contiguous bands and leaves unassigned levels unmapped", () => {
    const r = bandsFromAssignments(levels, stages, [
      { levelCode: "0", stageCode: "novice" }, { levelCode: "1", stageCode: "novice" }, { levelCode: "2", stageCode: "advanced_beginner" },
      { levelCode: "3", stageCode: "competent" }, { levelCode: "4", stageCode: "competent" }, { levelCode: "5", stageCode: "proficient" }, { levelCode: "6", stageCode: null },
    ]);
    expect(r.problems).toEqual([]);
    expect(r.bands).toEqual([
      { stageCode: "novice", fromOrdinal: 0, toOrdinal: 1 }, { stageCode: "advanced_beginner", fromOrdinal: 2, toOrdinal: 2 },
      { stageCode: "competent", fromOrdinal: 3, toOrdinal: 4 }, { stageCode: "proficient", fromOrdinal: 5, toOrdinal: 5 },
    ]);
  });
  it("never produces a band from matching numbers alone", () => {
    const r = bandsFromAssignments(levels, stages, []);
    expect(r.bands).toEqual([]);
    expect(r.problems).toEqual(["Assign at least one rating level to a stage."]);
  });
  it("refuses unknown stages, unknown levels, a level assigned twice and a stage split across two runs", () => {
    const r = bandsFromAssignments(levels, stages, [
      { levelCode: "0", stageCode: "novice" }, { levelCode: "0", stageCode: "novice" }, { levelCode: "9", stageCode: "novice" },
      { levelCode: "2", stageCode: "wizard" }, { levelCode: "1", stageCode: "expert" }, { levelCode: "3", stageCode: "novice" },
    ]);
    expect(r.problems).toEqual(expect.arrayContaining([
      "Level 0 is assigned twice.", "Level 9 is not on the rating scale.", "Stage wizard is not on the stage scale.",
      "Stage novice is given to two separate runs of levels. A stage is one contiguous band.",
    ]));
  });
});
