// Instrument import: the corrections a person may make to a draft, and what stays as extracted. Pure part of store.ts.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { readWorkbookGrids } from "./grid";
import { draftWorkbook } from "./workbook";
import { fileProblem, mergeCorrections } from "./store";

const grids = readWorkbookGrids(new Uint8Array(readFileSync(join(__dirname, "__fixtures__", "nursing-assessment-audits.xlsx"))));
const saved = draftWorkbook(grids, { fileName: "Nursing Assessment Audits.xlsx", sha256: "b".repeat(64), byteSize: 10 }, [{ code: "CA", label: "Competency Assessment", isActive: true }]);

describe("mergeCorrections", () => {
  it("takes titles, prompts, inclusion, column roles, grouping and settings from the person, and keeps the extracted structure", () => {
    const sheet1 = saved.sheets[0];
    const incoming = {
      sheets: [{
        name: sheet1.name, title: "  Nursing Assessment  ",
        columns: [{ col: 25, header: "Evidence / Comments", use: "ignore" }, { col: 1, header: "Policy Section & Critical Elements", use: "nonsense" }],
        sections: [{ key: sheet1.sections[0].key, title: "Safety and preparation", include: true }],
        items: [{ key: sheet1.items[0].key, prompt: "Performs hand hygiene", include: false }, { key: "i-9999", prompt: "injected" }],
        scale: { levels: [{ value: "0", label: null, description: "Needs training" }] },
        flags: [], unplaced: [], items_extra: "ignored",
      }],
      groups: [{ key: "g-0", title: "Nursing Assessment", sheets: [sheet1.name, "No such sheet"], family: "CA", purposeCode: "summative", respondentRoles: ["assessor", "bogus"], terms: [{ termId: "11111111-1111-4111-8111-111111111111", isPrimary: true }, { termId: "nope" }], confirmed: true }],
      excluded: [{ sheet: "Daily Audits", confirmed: true }],
    };
    const m = mergeCorrections(saved, incoming);
    const s = m.sheets[0];
    expect(s.title).toBe("Nursing Assessment");
    expect(s.columns.find((c) => c.col === 25)?.use).toBe("ignore");
    expect(s.columns.find((c) => c.col === 1)?.use).toBe("section");
    expect(s.sections[0].title).toBe("Safety and preparation");
    expect(s.items[0]).toMatchObject({ prompt: "Performs hand hygiene", include: false, number: "1", row: 14 });
    expect(s.items).toHaveLength(62);
    expect(s.scale?.levels[0]).toMatchObject({ label: null, description: "Needs training" });
    expect(s.scale?.levels[1].label).toBe("Novice");
    expect(s.flags).toEqual(sheet1.flags);
    expect(m.groups).toHaveLength(1);
    expect(m.groups[0]).toMatchObject({ sheets: [sheet1.name], family: "CA", purposeCode: "summative", respondentRoles: ["assessor"], confirmed: true });
    expect(m.groups[0].terms).toEqual([{ termId: "11111111-1111-4111-8111-111111111111", isPrimary: true }]);
    // the two sheets no group names are excluded, with the parser's reason where it had one
    expect(m.excluded.map((e) => [e.sheet, e.confirmed])).toEqual([["2 Concurrent Nursing Audit", false], ["3 Retrospective Chart Audit", false], ["Daily Audits", true]]);
    expect(m.excluded[2].reason).toMatch(/record or tally/);
  });
  it("keeps the saved groups when the person sends none", () => {
    const m = mergeCorrections(saved, { sheets: [] });
    expect(m.groups).toEqual(saved.groups);
    expect(m.excluded).toEqual(saved.excluded);
  });
});

describe("fileProblem", () => {
  it("accepts a workbook and refuses anything else", () => {
    expect(fileProblem({ name: "a.xlsx", size: 100 })).toBeNull();
    expect(fileProblem({ name: "a.csv", size: 100 })).toMatch(/Excel workbook/);
    expect(fileProblem({ name: "a.xlsx", size: 0 })).toMatch(/empty/);
    expect(fileProblem({ name: "a.xlsx", size: 26 * 1024 * 1024 })).toMatch(/25 MB/);
  });
});
