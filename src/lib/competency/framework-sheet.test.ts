import { describe, expect, it, vi } from "vitest";
import { parseCsv, parseFrameworkSheet, SHEET_COLUMNS, templateCsv, toCsv } from "./framework-sheet";

vi.mock("@/lib/trace", () => ({ currentTraceId: async () => "trace-test" }));

const COMPONENTS = { clinical_skills: "Clinical Skills", knowledge: "Knowledge" };
const H = [...SHEET_COLUMNS];
const row = (o: Partial<Record<(typeof SHEET_COLUMNS)[number], string>>) => H.map(c => o[c] ?? "");
const base = { framework_code: "EX-FW", domain: "Communication", competency_code: "EX-001", competency_name: "Communicates clearly" };
const parse = (rows: string[][]) => parseFrameworkSheet(toCsv([H, ...rows]), { frameworkCode: "EX-FW", components: COMPONENTS });

describe("the spreadsheet template", () => {
  it("round-trips: the template parses into an append package with no errors", () => {
    const r = parseFrameworkSheet(templateCsv(Object.keys(COMPONENTS)), { frameworkCode: "EXAMPLE-FW", components: COMPONENTS });
    expect(r.errors).toEqual([]);
    expect(r.package?.domains).toHaveLength(1);
    expect(r.package?.domains[0]).toMatchObject({ name: "Communication", area: "Core Practice" });
    const c = r.package!.domains[0].competencies[0];
    expect(c).toMatchObject({ code: "EX-COM-001", expectedLevel: { score: 3 }, riskCategory: "standard" });
    expect(c.criteria!.map(k => k.component)).toEqual(["clinical_skills", "knowledge"]);
    expect(r.competencies[0].criteria).toEqual({ clinical_skills: 1, knowledge: 1 });
  });
  it("reads quoted cells with commas, quotes and line breaks", () => {
    expect(parseCsv('a,"b, c","say ""hi""\nthere"\r\nd,e,f\n')).toEqual([["a", "b, c", 'say "hi"\nthere'], ["d", "e", "f"]]);
  });
});

describe("row-numbered errors", () => {
  it("missing required, unknown component, duplicate criterion code, text length, inconsistent fields", () => {
    const r = parse([
      row({ ...base, component: "knowledge", criterion_code: "K-1", criterion_text: "Knows the policy" }),
      row({ ...base, competency_name: "" }),
      row({ ...base, component: "nonsense", criterion_text: "Some valid text" }),
      row({ ...base, component: "Clinical Skills", criterion_code: "k-1", criterion_text: "Another criterion" }),
      row({ ...base, component: "knowledge", criterion_text: "ab" }),
      row({ ...base, competency_name: "A different name", component: "knowledge", criterion_text: "Fine text" }),
      row({ ...base, framework_code: "OTHER", component: "knowledge", criterion_text: "Fine text" }),
    ]);
    expect(r.package).toBeNull();
    expect(r.errors.map(e => [e.row, e.column])).toEqual([[3, "competency_name"], [4, "component"], [5, "criterion_code"], [6, "criterion_text"], [7, "competency_name"], [8, "framework_code"]]);
    expect(r.errors.find(e => e.row === 5)?.message).toMatch(/row 2/);
  });
  it("a missing header column is reported on row 1", () => {
    const r = parseFrameworkSheet("framework_code,domain\nEX-FW,Communication\n", { frameworkCode: "EX-FW", components: COMPONENTS });
    expect(r.errors[0]).toMatchObject({ row: 1, message: expect.stringMatching(/competency_code/) });
  });
  it("a competency with no criteria is one row; criterion_code becomes the source when source_ref is blank", () => {
    const r = parse([row({ ...base }), row({ ...base, competency_code: "EX-002", competency_name: "Second one", component: "knowledge", criterion_code: "EX-002-1", criterion_text: "Knows it" })]);
    expect(r.errors).toEqual([]);
    expect(r.package!.domains[0].competencies.map(c => [c.code, c.criteria!.length])).toEqual([["EX-001", 0], ["EX-002", 1]]);
    expect(r.package!.domains[0].competencies[1].criteria![0].sourceRef).toBe("EX-002-1");
  });
});
