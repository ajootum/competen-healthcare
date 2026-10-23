import { describe, expect, it } from "vitest";
import { projectForProgramme, type CatalogueCompetency, type ProgrammeConfig, type S1Competency } from "./catalogue";
import {
  checkCaseTitle, checkSupplementary, explainPromptVersion, explainSystem, parseCase, splitSupplementary, CASE_FALLBACK_TITLE, EXPLAIN_SYSTEM, type Passage,
} from "./generation";
import { buildCompetencyProgress } from "./competency-progress";
import { PROMPT_VERSIONS } from "./config";
import { MAPPING_PROMPT_VERSION } from "@/lib/competency/mapping";

// COMPETEN-SCHOLAR-01 S2-S4: competency proposals, explanation modes, multi-step cases, progress by competency.

const RESP = "Respiratory assessment includes respiratory rate, oxygen saturation and the use of accessory muscles. Wheeze suggests narrowed airways. Position the patient upright to ease breathing.";

const comp = (id: string, layer: CatalogueCompetency["layer"], title: string, outcomes: string[] = []): CatalogueCompetency => ({
  id, layer, profession: "Nursing", catalogue: "Test", frameworkId: "f", domain: "D", code: null, title, outcomes,
});
const COMPS = [
  comp("u-anat", "foundational", "Respiratory anatomy and physiology"),
  comp("u-assess", "profession", "Respiratory assessment", ["Measures respiratory rate"]),
  comp("u-ipc", "profession", "Infection prevention and control"),
];

describe("the S1 catalogue, narrowed by a programme", () => {
  it("a programme narrows S1's Scholar catalogue and never widens it; S1's layer wins, the programme's fills a gap", () => {
    const s1 = (id: string, fw: string, layer: S1Competency["layer"]): S1Competency => ({
      competencyId: id, code: null, title: id, layer, profession: layer === "foundational" ? null : { label: "From S1" },
      catalogue: { id: fw, name: fw }, domain: { name: "D" }, outcomes: ["o"],
    });
    const programme: ProgrammeConfig = {
      code: "p", label: "P", profession: "From programme", country: null, level: null,
      frameworks: [{ frameworkId: "fw-prof", layer: "profession", sortOrder: 0 }, { frameworkId: "fw-found", layer: "profession", sortOrder: 1 }, { frameworkId: "fw-unclassified", layer: "specialty", sortOrder: 2 }],
    };
    const out = projectForProgramme([s1("a", "fw-prof", "profession"), s1("b", "fw-found", "foundational"), s1("c", "fw-other", "profession"), s1("d", "fw-unclassified", null)], programme);
    expect(out.map(c => c.id)).toEqual(["b", "a", "d"]);
    expect(out[0]).toMatchObject({ layer: "foundational", profession: "From programme", outcomes: ["o"] });
    expect(out[1]).toMatchObject({ layer: "profession", profession: "From S1" });
    expect(out[2].layer).toBe("specialty");
  });
});

describe("provenance", () => {
  it("the map prompt version Scholar records is the Holdings engine's own", () => {
    expect(PROMPT_VERSIONS.map).toBe(MAPPING_PROMPT_VERSION);
  });
});

describe("explanation modes and what lies beyond the notes", () => {
  it("explain keeps the v2 prompt and version; every other mode adds to it and has its own version", () => {
    expect(explainSystem("explain")).toBe(EXPLAIN_SYSTEM);
    expect(explainPromptVersion("explain")).toBe("scholar-explain-v2");
    expect(explainSystem("summary").startsWith(EXPLAIN_SYSTEM)).toBe(true);
    expect(explainPromptVersion("tutor")).toBe("scholar-explain-modes-v4:tutor");
  });

  it("splits the background off the answer at the marker line", () => {
    expect(splitSupplementary("Answer [S1].\n\n**BEYOND THE NOTES:**\nAirways carry air to the lungs.")).toEqual({ main: "Answer [S1].", extra: "Airways carry air to the lungs." });
    expect(splitSupplementary("Answer [S1].")).toEqual({ main: "Answer [S1].", extra: null });
  });

  it("withholds background with a figure, a dose, a citation tag, or in a notes-only mode", () => {
    expect(checkSupplementary("Airways carry air to the lungs.", "deeper")).toEqual({ ok: true, text: "Airways carry air to the lungs." });
    expect(checkSupplementary("A normal rate is 12 to 20.", "deeper")).toEqual({ ok: false, reason: "figures" });
    expect(checkSupplementary("A typical salbutamol dose is given by inhaler.", "tutor")).toEqual({ ok: false, reason: "dosing" });
    expect(checkSupplementary("As your notes say [S1], airways narrow.", "deeper")).toEqual({ ok: false, reason: "citation" });
    expect(checkSupplementary("Airways carry air.", "summary")).toEqual({ ok: false, reason: "not_this_mode" });
  });
});

describe("multi-step practice cases", () => {
  const P: Passage = { chunkId: "k1", materialId: "m1", materialTitle: "Respiratory notes", ordinal: 1, pageFrom: 2, pageTo: 2, content: RESP };

  it("parses the case object, and refuses anything else", () => {
    expect(parseCase('```json\n{"title": "Wheeze", "steps": [{"stem": "x"}]}\n```')).toEqual({ title: "Wheeze", steps: [{ stem: "x" }] });
    expect(parseCase("[1, 2]")).toBeNull();
    expect(parseCase('{"title": "x"}')).toBeNull();
  });

  it("a title that adds a figure or an identifier becomes the neutral fallback", () => {
    expect(checkCaseTitle("A patient with wheeze", P)).toBe("A patient with wheeze");
    expect(checkCaseTitle("A 67 year old with wheeze", P)).toBe(CASE_FALLBACK_TITLE);
    expect(checkCaseTitle("NHS 943 476 5919 wheeze", P)).toBe(CASE_FALLBACK_TITLE);
  });
});

describe("progress by competency", () => {
  it("counts linked sections and latest-try accuracy, and leaves the unmeasured null", () => {
    const p = buildCompetencyProgress({
      competencies: COMPS,
      mappings: [
        { competencyId: "u-assess", chunkId: "k1", state: "accepted" },
        { competencyId: "u-anat", chunkId: "k1", state: "proposed" },
        { competencyId: "u-ipc", chunkId: "k2", state: "rejected" },
        { competencyId: "gone", chunkId: "k1", state: "accepted" },
      ],
      questions: [
        { id: "q1", chunkId: "k1", competencyId: "u-assess" }, { id: "q2", chunkId: "k1", competencyId: "u-assess" },
        { id: "q3", chunkId: "k1", competencyId: "gone" }, { id: "q4", chunkId: "k1", competencyId: null },
        // Practised through a link the person has not accepted (proposed) or has rejected: counts for nothing.
        { id: "q5", chunkId: "k1", competencyId: "u-anat" }, { id: "q6", chunkId: "k2", competencyId: "u-ipc" },
      ],
      attempts: [
        { questionId: "q1", correct: false, answeredAt: "2026-10-01T10:00:00Z" },
        { questionId: "q1", correct: true, answeredAt: "2026-10-02T10:00:00Z" },
        { questionId: "q5", correct: true, answeredAt: "2026-10-02T10:00:00Z" },
        { questionId: "q6", correct: true, answeredAt: "2026-10-02T10:00:00Z" },
      ],
    });
    const rows = p.layers.flatMap(l => l.rows);
    expect(p.layers.map(l => l.layer)).toEqual(["foundational", "profession"]);
    expect(rows.find(r => r.id === "u-assess")).toMatchObject({ sectionsAccepted: 1, questions: 2, answered: 1, latestCorrect: 1, latestAccuracy: 100, status: "practising" });
    expect(rows.find(r => r.id === "u-anat")).toMatchObject({ sectionsProposed: 1, latestAccuracy: null, status: "notes_linked" });
    expect(rows.find(r => r.id === "u-ipc")).toMatchObject({ sectionsAccepted: 0, sectionsProposed: 0, latestAccuracy: null, status: "no_notes" });
    expect(p.totals).toEqual({ competencies: 3, withNotes: 2, practising: 1 });
    expect(p.outsideProgramme).toBe(1);
  });
});
