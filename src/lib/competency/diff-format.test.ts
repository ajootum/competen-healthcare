import { describe, expect, it } from "vitest";
import { canConfirm, diffSummary, formatSheetError, formatValue, previewSummary, type SheetPreview } from "./diff-format";
import type { FrameworkDiff } from "./framework-diff";

const empty: FrameworkDiff = {
  framework: [], domains: { added: [], removed: [], renamed: [], reordered: false }, competencies: { added: [], removed: [], changed: [] }, sectionOrderChanged: false,
  counts: { competenciesAdded: 0, competenciesRemoved: 0, competenciesChanged: 0, criteriaAdded: 0, criteriaRetired: 0, criteriaRemoved: 0, criteriaTextChanged: 0, criteriaMoved: 0 }, unchanged: true,
};

describe("diff-format (pure)", () => {
  it("summarises a diff, singular and plural", () => {
    expect(diffSummary(empty)).toBe("No difference from the published version.");
    const d = { ...empty, unchanged: false, counts: { ...empty.counts, competenciesAdded: 1, criteriaMoved: 2, competenciesChanged: 3 }, sectionOrderChanged: true };
    expect(diffSummary(d)).toBe("1 competency added, 3 competencies changed, 2 criteria moved, section order changed.");
    expect(diffSummary({ ...empty, unchanged: false, framework: [{ field: "name", before: "a", after: "b" }] })).toBe("Only names, descriptions or order changed.");
  });
  it("formats values", () => {
    expect(formatValue(null)).toBe("Not set");
    expect(formatValue([])).toBe("Not set");
    expect(formatValue(["a", "b"])).toBe("a\nb");
    expect(formatValue("id1", id => (id === "id1" ? "Level 3" : undefined))).toBe("Level 3");
  });
  it("formats sheet errors with and without a row", () => {
    expect(formatSheetError({ row: 4, column: "component", message: "Unknown." })).toBe("Row 4, component: Unknown.");
    expect(formatSheetError({ row: 4, column: null, message: "Bad." })).toBe("Row 4: Bad.");
    expect(formatSheetError({ row: null, column: null, message: "Bad." })).toBe("Sheet: Bad.");
  });
  const ok: SheetPreview = {
    framework: { id: "f", code: "F", name: "F" }, unchanged: 2, errors: [],
    adds: { competencies: [{ row: 2, code: "A", name: "A", domain: "D", criteria: { knowledge: 2 }, newDomain: true }], criteria: { byComponent: { knowledge: 2 }, total: 2 }, domains: ["D"] },
  };
  it("words the preview and gates confirmation on no errors and something to add", () => {
    expect(previewSummary(ok)).toBe("1 competency and 2 criteria would be added, with 1 new domain. 2 competencies already in the draft stay untouched.");
    expect(canConfirm(ok)).toBe(true);
    const bad = { ...ok, errors: [{ row: 3, column: "x", message: "m" }] };
    expect(previewSummary(bad)).toMatch(/^1 problem found\. Nothing can be imported/);
    expect(canConfirm(bad)).toBe(false);
    expect(canConfirm({ ...ok, adds: { ...ok.adds, competencies: [] } })).toBe(false);
    expect(canConfirm(null)).toBe(false);
  });
});
