// Instrument import: the deterministic parser against the owner's acceptance workbook (three nursing instruments and a
// record sheet). The fixture is the file as received, copied under __fixtures__, so the test reads what the import reads.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { readWorkbookGrids } from "./grid";
import { detectSheet, fieldHintFor, fieldKeyFrom, optionFrom, titleFromSheetName } from "./detect";
import { draftWorkbook, moveSheet, newGroupFor, readinessProblems, suggestFamily } from "./workbook";
import { buildInstrumentPlan, fieldsFor } from "./to-content";
import type { SheetDraft, WorkbookDraft } from "./types";

const FIXTURE = join(__dirname, "__fixtures__", "nursing-assessment-audits.xlsx");
const grids = readWorkbookGrids(new Uint8Array(readFileSync(FIXTURE)));
const FAMILIES = [
  { code: "CA", label: "Competency Assessment", isActive: true }, { code: "CPA", label: "Clinical Practice Audit", isActive: true },
  { code: "DA", label: "Documentation Audit", isActive: true }, { code: "KA", label: "Knowledge Assessment", isActive: true },
  { code: "QCA", label: "Quality & Compliance Audit", isActive: true },
];
const draft = draftWorkbook(grids, { fileName: "Nursing Assessment Audits.xlsx", sha256: "a".repeat(64), byteSize: 1 }, FAMILIES);
const sheet = (name: string): SheetDraft => { const s = draft.sheets.find((x) => x.name === name); if (!s) throw new Error(name); return s; };
let n = 0;
const key = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;

describe("workbook grids", () => {
  it("reads the four sheets with merges filled", () => {
    expect(grids.map((g) => g.name)).toEqual(["1 Nursing Assessment Audit", "2 Concurrent Nursing Audit", "3 Retrospective Chart Audit", "Daily Audits"]);
    const g1 = grids[0];
    // B50:E60 is merged: row 55 (index 54) carries the section text with its origin at row 50 (index 49)
    expect(g1.rows[54][1]?.v).toBe("Step 2: Primary – Disability");
    expect(g1.rows[54][1]?.origin).toEqual({ r: 49, c: 1 });
  });
});

describe("sheet 1: assessment with an achievement scale", () => {
  const s = sheet("1 Nursing Assessment Audit");
  it("is an instrument of 62 numbered items in 13 sections with subsections", () => {
    expect(s.kind).toBe("instrument");
    expect(s.items).toHaveLength(62);
    expect(s.items.map((i) => i.number)).toEqual(Array.from({ length: 62 }, (_, i) => String(i + 1)));
    expect(s.sections.filter((x) => x.parentKey === null)).toHaveLength(13);
    expect(s.sections.filter((x) => x.parentKey === null).map((x) => x.title)[0]).toBe("Safety & Preparation");
    expect(s.sections.find((x) => x.title === "GI/Feeding & Renal Systems")).toBeTruthy();
    const gi = s.sections.find((x) => x.title === "GI/Feeding & Renal Systems")!;
    expect(s.sections.filter((x) => x.parentKey === gi.key).map((x) => x.title)).toEqual(["Gastrointestinal - Assess correctly", "Renal - Assesses correctly"]);
  });
  it("turns a sole leading sub-heading into the section's guidance", () => {
    const airway = s.sections.find((x) => x.title === "Step 2: Primary – Airway")!;
    expect(airway.guidance).toBe("Assesses correctly");
    expect(s.sections.filter((x) => x.parentKey === airway.key)).toHaveLength(0);
    expect(s.items.filter((i) => i.sectionKey === airway.key)).toHaveLength(3);
  });
  it("keeps the indented sub-points of item 29 as expected performance, not as items", () => {
    const motor = s.items.find((i) => i.number === "29")!;
    expect(motor.prompt).toBe("Motor function:");
    expect(motor.subPoints).toEqual(["Muscle bulk", "Power (scores appropriately 0–5 scale).", "Tone", "Reflexes- deep tendon and primitive reflexes for the newborn."]);
  });
  it("finds the 0 to 6 achievement scale with its competence level labels and descriptions", () => {
    expect(s.scale?.levels.map((l) => l.value)).toEqual(["0", "1", "2", "3", "4", "5", "6"]);
    expect(s.scale?.levels.map((l) => l.label)).toEqual(["Novice", "Novice", "Advanced Beginner", "Competent", "Competent", "Proficient", "Expert"]);
    expect(s.scale?.levels[0].description).toMatch(/^Requires training/);
    expect(s.response.primary).toBe("rating_scale");
    expect(s.response.allowNa).toBe(true);
  });
  it("classifies the columns: section, number, seven rating values, NA, evidence text, sign-off", () => {
    const uses = Object.fromEntries(s.columns.map((c) => [c.letter, c.use]));
    expect(uses).toMatchObject({ B: "section", F: "number", R: "rating", X: "rating", Y: "na", Z: "text", AI: "signoff" });
    expect(s.columns.find((c) => c.letter === "Z")?.fieldKey).toBe("evidence_comments");
  });
  it("records identifiers, the sheet-name title and no unplaced text", () => {
    expect(s.identifiers).toEqual(["Name", "Unit", "Co-worker Number", "Date"]);
    expect(s.title).toBe("Nursing Assessment Audit");
    expect(s.titleSource).toBe("sheet_name");
    expect(s.unplaced).toEqual([]);
    expect(s.flags.map((f) => f.code)).toContain("title_from_sheet_name");
  });
});

describe("sheet 2: concurrent audit with documented versus observed findings", () => {
  const s = sheet("2 Concurrent Nursing Audit");
  it("has 51 items, Yes / No / Partial as the response and three free text fields", () => {
    expect(s.kind).toBe("instrument");
    expect(s.items).toHaveLength(51);
    expect(s.response.primary).toBe("multiple_choice");
    expect(s.response.options.map((o) => [o.code, o.satisfactory])).toEqual([["yes", true], ["no", false], ["partial", null]]);
    expect(s.columns.filter((c) => c.use === "text").map((c) => c.fieldKey)).toEqual(["documented_finding", "observed_finding", "discrepancy_action"]);
    expect(s.columns.find((c) => c.use === "option")?.groupHeader).toMatch(/^Match\?/);
  });
  it("reads headings in the number column as sections and colon headings as subsections", () => {
    const pat = s.sections.find((x) => x.title === "Initial Impression (PAT)")!;
    expect(s.sections.find((x) => x.parentKey === pat.key)?.title).toBe("Airway Categorised appropriately as");
    expect(s.sections.find((x) => x.title === "Renal")?.guidance).toBe("Renal - Assessed correctly");
    expect(s.items.find((i) => i.number === "20")?.subPoints).toHaveLength(4);
    expect(s.flags.map((f) => f.code)).toContain("section_and_number_column");
  });
});

describe("sheet 3: retrospective chart audit", () => {
  const s = sheet("3 Retrospective Chart Audit");
  it("has 48 items in 12 sections with a deficiency / evidence field and a sign-off column", () => {
    expect(s.items).toHaveLength(48);
    expect(s.sections).toHaveLength(12);
    expect(s.sections[0].title).toBe("Timing of Assessments");
    expect(s.items.filter((i) => i.sectionKey === s.sections[0].key)).toHaveLength(4);
    expect(s.columns.find((c) => c.letter === "Q")).toMatchObject({ use: "text", fieldKey: "evidence_comments" });
    expect(s.columns.find((c) => c.letter === "R")?.use).toBe("signoff");
    expect(s.response.primary).toBe("multiple_choice");
  });
});

describe("the fourth sheet is not assumed to be an instrument", () => {
  const s = sheet("Daily Audits");
  it("is reported as a record log, with every cell of text kept as unplaced", () => {
    expect(s.kind).toBe("record_log");
    expect(s.title).toBe("Daily Audits");
    expect(s.items).toHaveLength(0);
    expect(s.unplaced.map((u) => u.text)).toContain("ICU Nursing Assessment - upon arrival to ICU");
    expect(s.unplaced).toHaveLength(10);
  });
  it("is proposed for exclusion and needs the person's confirmation", () => {
    expect(draft.groups.map((g) => g.sheets)).toEqual([["1 Nursing Assessment Audit"], ["2 Concurrent Nursing Audit"], ["3 Retrospective Chart Audit"]]);
    expect(draft.excluded).toEqual([{ sheet: "Daily Audits", reason: expect.stringMatching(/record or tally/), confirmed: false }]);
    expect(readinessProblems(draft)).toContain('Confirm that the sheet "Daily Audits" is left out (The sheet is a record or tally table, not an instrument with criteria. It stays in the stored workbook.).');
  });
  it("can be moved into a group, or made a group of its own, by the person", () => {
    const moved = moveSheet(draft, "Daily Audits", "g-2");
    expect(moved.groups.find((g) => g.key === "g-2")?.sheets).toEqual(["3 Retrospective Chart Audit", "Daily Audits"]);
    expect(moved.excluded).toEqual([]);
    const own = newGroupFor(draft, "Daily Audits", FAMILIES);
    expect(own.groups).toHaveLength(4);
    expect(own.groups[3].sheets).toEqual(["Daily Audits"]);
  });
});

describe("family suggestion is only ever a unique word match", () => {
  it("suggests nothing for titles that only share audit or assessment", () => {
    expect(suggestFamily("Nursing Assessment Audit", FAMILIES)).toBeNull();
    expect(suggestFamily("Retrospective Chart Audit", FAMILIES)).toBeNull();
    expect(suggestFamily("Hand hygiene compliance audit", FAMILIES)).toBe("QCA");
    expect(suggestFamily("Pharmacology knowledge test", FAMILIES)).toBe("KA");
  });
});

describe("the plan for a confirmed group uses the existing Studio model", () => {
  const ready: WorkbookDraft = {
    ...draft,
    groups: draft.groups.map((g) => ({ ...g, family: "CA", purposeCode: "summative", respondentRoles: ["assessor"], confirmed: true })),
    excluded: draft.excluded.map((e) => ({ ...e, confirmed: true })),
  };
  it("is ready once every group and exclusion is confirmed", () => {
    expect(readinessProblems(ready)).toEqual([]);
  });
  it("builds rating items on one imported scale with NA allowed and an evidence field", () => {
    n = 0;
    const plan = buildInstrumentPlan(ready, ready.groups[0], key, "2026-11-03T10:00:00Z");
    expect(plan.content.items).toHaveLength(62);
    expect(plan.content.sections.filter((s) => !s.parent_section_key)).toHaveLength(13);
    expect(plan.ratingItems).toBe(62);
    expect(plan.content.items[0]).toMatchObject({ code: "1", prompt: "Ensures Hand hygiene precautions", response_type: "rating_scale", mandatory: true, config: { allowedStates: ["not_applicable"], naReasonRequired: true } });
    expect(plan.content.items[0].fields?.map((f) => f.field_key)).toEqual(["evidence_comments"]);
    expect(plan.content.items.find((i) => i.code === "29")?.expected_performance).toHaveLength(4);
    expect(plan.scale?.levels.map((l) => [l.code, l.label, l.numeric_value, l.satisfactory])).toEqual([
      ["0", "Novice", 0, null], ["1", "Novice", 1, null], ["2", "Advanced Beginner", 2, null], ["3", "Competent", 3, null], ["4", "Competent", 4, null], ["5", "Proficient", 5, null], ["6", "Expert", 6, null],
    ]);
    expect(plan.scale?.states).toEqual([{ state: "not_applicable", label: "NA" }]);
    expect(plan.summary).toMatch(/Form identifiers on the original: Name, Unit, Co-worker Number, Date/);
    expect(plan.summary).toMatch(/Sign-off column on the original: Auditor Initials/);
    // every item sits in a section that exists and every key is unique
    const keys = new Set(plan.content.sections.map((s) => s.stable_key));
    expect(plan.content.items.every((i) => keys.has(i.section_key))).toBe(true);
    expect(new Set(plan.content.items.map((i) => i.stable_key)).size).toBe(62);
  });
  it("builds the concurrent audit as a choice item with three text fields", () => {
    n = 0;
    const plan = buildInstrumentPlan(ready, ready.groups[1], key, "2026-11-03T10:00:00Z");
    expect(plan.scale).toBeNull();
    expect(plan.content.items[0]).toMatchObject({ response_type: "multiple_choice", config: { select: "single" } });
    expect((plan.content.items[0].config.options ?? []).map((o) => o.code)).toEqual(["yes", "no", "partial"]);
    expect(plan.content.items[0].fields?.map((f) => f.field_key)).toEqual(["documented_finding", "observed_finding", "discrepancy", "action_needed", "explainable_change", "clinical_context"]);
  });
  it("puts two grouped sheets under one top-level section each", () => {
    n = 0;
    const merged = moveSheet(ready, "3 Retrospective Chart Audit", "g-1");
    const g = { ...merged.groups.find((x) => x.key === "g-1")!, confirmed: true };
    const plan = buildInstrumentPlan(merged, g, key, "2026-11-03T10:00:00Z");
    const top = plan.content.sections.filter((s) => !s.parent_section_key);
    expect(top.map((s) => s.title)).toEqual(["Concurrent Nursing Audit", "Retrospective Chart Audit"]);
    expect(plan.content.items).toHaveLength(51 + 48);
  });
});

describe("small helpers", () => {
  it("names fields and options deterministically", () => {
    expect(fieldHintFor("Nurse's Documented Finding (copy verbatim)")).toBe("documented_finding");
    expect(fieldHintFor("Auditor's Independent Bedside Finding")).toBe("observed_finding");
    expect(fieldKeyFrom("Deficiency / Evidence", null)).toBe("deficiency_evidence");
    expect(fieldKeyFrom("2nd reviewer note", null)).toBe("f_2nd_reviewer_note");
    expect(optionFrom("Non-compliant")).toEqual({ code: "non_compliant", label: "Non-compliant", satisfactory: false });
    expect(titleFromSheetName("3 - Retrospective Chart Audit")).toBe("Retrospective Chart Audit");
    expect(fieldsFor([{ col: 1, letter: "B", header: "Primary", use: "text", value: null, fieldKey: "primary", fieldLabel: "Primary", fieldHint: null, groupHeader: null }])[0].field_key).toBe("field_1");
  });
  it("gives an empty grid an empty draft", () => {
    const d = detectSheet({ name: "Blank", index: 9, rows: [], rowCount: 0, colCount: 0 });
    expect(d.kind).toBe("empty");
    expect(d.items).toEqual([]);
  });
});
